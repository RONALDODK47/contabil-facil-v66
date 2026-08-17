import { describe, expect, it } from 'vitest';
import type { VisionBalanceteRow } from '../../../extratoVision/types/accounting';
import {
  buildBalanceteTxtFilename,
  prepareBalanceteTxtExport,
} from '../balanceteTxtExport';
import { buildTxtPlusFromRazaoVision } from '../dominioTxtIO';

function row(partial: Partial<VisionBalanceteRow>): VisionBalanceteRow {
  return {
    codigo: '1101',
    nome: 'LANCAMENTO TESTE',
    saldoInicial: 0,
    debito: 0,
    credito: 0,
    saldoFinal: 0,
    ...partial,
  };
}

describe('buildBalanceteTxtFilename', () => {
  it('inclui o nome da empresa no arquivo', () => {
    expect(buildBalanceteTxtFilename('ACME INDUSTRIA LTDA')).toBe('Balancete_ACME_INDUSTRIA_LTDA.txt');
  });

  it('sanitiza caracteres inválidos para nome de arquivo', () => {
    expect(buildBalanceteTxtFilename('Empresa / Teste & Cia')).toBe('Balancete_EMPRESA_TESTE_CIA.txt');
  });
});

describe('prepareBalanceteTxtExport', () => {
  const rows = [
    row({ data: '08/01/2026', codigo: '1101', debito: 100, credito: 0, ordem: 1 }),
    row({ data: '08/01/2026', codigo: '2101', debito: 0, credito: 100, ordem: 1 }),
    row({ data: '15/02/2026', codigo: '1101', debito: 50, credito: 0, ordem: 2 }),
    row({ data: '15/02/2026', codigo: '2101', debito: 0, credito: 50, ordem: 2 }),
  ];

  it('exporta só lançamentos dentro do período De/Até do balancete', () => {
    const result = prepareBalanceteTxtExport(
      rows,
      { de: '01/01/2026', ate: '31/01/2026' },
      'ACME INDUSTRIA LTDA',
    );
    expect(result.filename).toBe('Balancete_ACME_INDUSTRIA_LTDA.txt');
    expect(result.count).toBe(2);
    expect(result.content).toContain('08/01/2026');
    expect(result.content).not.toContain('15/02/2026');
  });

  it('rejeita exportação sem período confirmado', () => {
    expect(() => prepareBalanceteTxtExport(rows, null, 'ACME')).toThrow(/período/i);
  });

  it('rejeita quando não há lançamentos no período visualizado', () => {
    expect(() =>
      prepareBalanceteTxtExport(rows, { de: '01/03/2026', ate: '31/03/2026' }, 'ACME'),
    ).toThrow(/Nenhum lançamento/i);
  });

  it('reporta em naoExportados o lançamento cuja contraparte ficou fora do período', () => {
    // A contraparte de crédito (ordem 2, 22/02/2026) fica FORA do período De/Até
    // pedido — o débito (ordem 2, 15/02/2026) não acha par e não pode ser exportado.
    const rowsComContraparteForaDoPeriodo = [
      row({ data: '08/01/2026', codigo: '1101', nome: 'A', debito: 100, credito: 0, ordem: 1 }),
      row({ data: '08/01/2026', codigo: '2101', nome: 'A', debito: 0, credito: 100, ordem: 1 }),
      row({ data: '15/02/2026', codigo: '3101', nome: 'ORFAO', debito: 480.75, credito: 0, ordem: 2 }),
    ];
    const result = prepareBalanceteTxtExport(
      rowsComContraparteForaDoPeriodo,
      { de: '01/01/2026', ate: '28/02/2026' },
      'ACME',
    );
    expect(result.naoExportados).toHaveLength(1);
    expect(result.naoExportados[0]).toMatchObject({
      data: '15/02/2026',
      conta: '3101',
      historico: 'ORFAO',
      valor: 480.75,
    });
    expect(result.content).not.toContain('480,75');
  });
});

describe('buildTxtPlusFromRazaoVision — partidas válidas', () => {
  it('não emite linha com conta 0 (partida incompleta)', () => {
    const orphan = [
      row({
        data: '21/01/2026',
        codigo: '8',
        nome: 'PAGAMENTO DE BOLETO INOV SERVICOS',
        debito: 0,
        credito: 742.11,
        ordem: 79,
      }),
    ];
    expect(buildTxtPlusFromRazaoVision(orphan).trim()).toBe('');
  });

  it('emparelha débito/crédito do extrato mesmo com ordem diferente', () => {
    const extratoLike = [
      row({
        data: '21/01/2026',
        codigo: '1102001',
        nome: 'PAGAMENTO DE BOLETO INOV SERVICOS',
        debito: 742.11,
        credito: 0,
        ordem: 10,
        contaDeb: '1102001',
        contaCred: '2103008',
      }),
      row({
        data: '21/01/2026',
        codigo: '2103008',
        nome: 'PAGAMENTO DE BOLETO INOV SERVICOS',
        debito: 0,
        credito: 742.11,
        ordem: 11,
        contaDeb: '1102001',
        contaCred: '2103008',
      }),
    ];
    const txt = buildTxtPlusFromRazaoVision(extratoLike);
    expect(txt).toContain('21/01/2026;1102001;2103008;742,11');
    // Contas preenchidas (débito/crédito); o ";0;" do código de histórico Domínio é esperado.
    expect(txt).not.toMatch(/;\d+;0;\d+,/);
    expect(txt).not.toMatch(/;0;\d+;\d+,/);
  });

  it('emparelha por data+valor+histórico quando ordem diverge e não há contaDeb/Cred', () => {
    const rows = [
      row({
        data: '21/01/2026',
        codigo: '1102001',
        nome: 'PAGAMENTO DE BOLETO',
        debito: 742.11,
        credito: 0,
        ordem: 10,
      }),
      row({
        data: '21/01/2026',
        codigo: '2103008',
        nome: 'PAGAMENTO DE BOLETO',
        debito: 0,
        credito: 742.11,
        ordem: 11,
      }),
    ];
    const txt = buildTxtPlusFromRazaoVision(rows);
    expect(txt).toContain('21/01/2026;1102001;2103008;742,11');
  });

  it('não perde partida composta (rateio): 1 débito dividido em várias contas de crédito', () => {
    // Cenário real do Domínio: "lote de crédito puro" — um recebimento de banco é
    // rateado em 3 contas de receita distintas. Cada conta vem em um registro "03"
    // separado (ordem própria, sem contaDeb/contaCred), e a soma dos créditos bate
    // com o único débito. Antes da correção essas 4 linhas somem do TXT porque o
    // pareamento só aceitava débito == crédito exatamente 1 para 1.
    const rows = [
      row({ data: '10/03/2026', codigo: '1102001', nome: 'RECEBIMENTO CLIENTE', debito: 1000, credito: 0, ordem: 501 }),
      row({ data: '10/03/2026', codigo: '3101001', nome: 'RECEITA A', debito: 0, credito: 400, ordem: 502 }),
      row({ data: '10/03/2026', codigo: '3101002', nome: 'RECEITA B', debito: 0, credito: 350, ordem: 503 }),
      row({ data: '10/03/2026', codigo: '3101003', nome: 'RECEITA C', debito: 0, credito: 250, ordem: 504 }),
    ];
    const txt = buildTxtPlusFromRazaoVision(rows);
    const linhas = txt.split('\r\n').filter(Boolean);
    expect(linhas).toHaveLength(3);
    expect(txt).toContain('10/03/2026;1102001;3101001;400,00');
    expect(txt).toContain('10/03/2026;1102001;3101002;350,00');
    expect(txt).toContain('10/03/2026;1102001;3101003;250,00');
  });

  it('não perde partida composta (rateio): várias contas de débito para 1 crédito', () => {
    const rows = [
      row({ data: '12/03/2026', codigo: '4101001', nome: 'DESPESA A', debito: 600, credito: 0, ordem: 601 }),
      row({ data: '12/03/2026', codigo: '4101002', nome: 'DESPESA B', debito: 300, credito: 0, ordem: 602 }),
      row({ data: '12/03/2026', codigo: '1102001', nome: 'PAGAMENTO FORNECEDOR', debito: 0, credito: 900, ordem: 603 }),
    ];
    const txt = buildTxtPlusFromRazaoVision(rows);
    const linhas = txt.split('\r\n').filter(Boolean);
    expect(linhas).toHaveLength(2);
    expect(txt).toContain('12/03/2026;4101001;1102001;600,00');
    expect(txt).toContain('12/03/2026;4101002;1102001;300,00');
  });

  it('não fabrica pareamento quando sobras da mesma data não fecham em valor (dados órfãos)', () => {
    const rows = [
      row({ data: '15/03/2026', codigo: '1102001', nome: 'A', debito: 100, credito: 0, ordem: 701 }),
      row({ data: '15/03/2026', codigo: '2101001', nome: 'B', debito: 0, credito: 999, ordem: 702 }),
    ];
    // Débito e crédito não fecham (100 x 999) — não deve inventar uma linha com valor errado.
    expect(buildTxtPlusFromRazaoVision(rows).trim()).toBe('');
  });

  it('empareiha boleto cuja perna do banco compensa alguns dias depois (mesmo valor, data diferente)', () => {
    // Cenário real: despesa/fornecedor lançada na data de pagamento; o banco só
    // compensa (e é lançado no razão) 2 dias depois. Mesmo valor, contas
    // diferentes, histórico igual — antes ficava de fora por exigir data igual.
    const rows = [
      row({ data: '13/02/2026', codigo: '4101001', nome: 'PAGAMENTO DE BOLETO GAZIN', debito: 160.25, credito: 0, ordem: 801 }),
      row({ data: '15/02/2026', codigo: '0000008', nome: 'PAGAMENTO DE BOLETO GAZIN', debito: 0, credito: 160.25, ordem: 950 }),
    ];
    const txt = buildTxtPlusFromRazaoVision(rows);
    expect(txt.trim()).not.toBe('');
    expect(txt).toContain('13/02/2026;4101001;0000008;160,25');
  });

  it('empareiha corretamente 3 boletos idênticos (mesma conta/valor/histórico) cada um com sua própria compensação', () => {
    // Reprodução exata do caso relatado: 3 pagamentos de R$160,25 pro mesmo
    // fornecedor no mesmo dia, cada um com sua compensação bancária em dias
    // diferentes — não pode nem sumir, nem cruzar a compensação errada.
    const rows = [
      row({ data: '13/02/2026', codigo: '4101001', nome: 'PAGAMENTO DE BOLETO GAZIN', debito: 160.25, credito: 0, ordem: 1 }),
      row({ data: '13/02/2026', codigo: '4101001', nome: 'PAGAMENTO DE BOLETO GAZIN', debito: 160.25, credito: 0, ordem: 2 }),
      row({ data: '13/02/2026', codigo: '4101001', nome: 'PAGAMENTO DE BOLETO GAZIN', debito: 160.25, credito: 0, ordem: 3 }),
      row({ data: '14/02/2026', codigo: '0000008', nome: 'COMPENSACAO', debito: 0, credito: 160.25, ordem: 951 }),
      row({ data: '15/02/2026', codigo: '0000008', nome: 'COMPENSACAO', debito: 0, credito: 160.25, ordem: 952 }),
      row({ data: '16/02/2026', codigo: '0000008', nome: 'COMPENSACAO', debito: 0, credito: 160.25, ordem: 953 }),
    ];
    const txt = buildTxtPlusFromRazaoVision(rows);
    const linhas = txt.split('\r\n').filter(Boolean);
    expect(linhas).toHaveLength(3);
    linhas.forEach((l) => expect(l).toContain(';4101001;0000008;160,25'));
  });

  it('NÃO empareiha quando a compensação está fora da janela de dias tolerada', () => {
    const rows = [
      row({ data: '13/02/2026', codigo: '4101001', nome: 'A', debito: 160.25, credito: 0, ordem: 1 }),
      row({ data: '01/03/2026', codigo: '0000008', nome: 'A', debito: 0, credito: 160.25, ordem: 2 }),
    ];
    expect(buildTxtPlusFromRazaoVision(rows).trim()).toBe('');
  });

  it('evita duplicidade e consumo duplo quando debito e credito estao preenchidos em linhas separadas da mesma transacao', () => {
    const rows = [
      row({
        data: '13/02/2026',
        codigo: '4101001',
        nome: 'PAGAMENTO DE BOLETO GAZIN',
        debito: 160.25,
        credito: 0,
        ordem: 1,
        contaDeb: '4101001',
        contaCred: '0000008',
      }),
      row({
        data: '13/02/2026',
        codigo: '0000008',
        nome: 'PAGAMENTO DE BOLETO GAZIN',
        debito: 0,
        credito: 160.25,
        ordem: 2,
        contaDeb: '4101001',
        contaCred: '0000008',
      }),
    ];
    const txt = buildTxtPlusFromRazaoVision(rows);
    const linhas = txt.split('\r\n').filter(Boolean);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toContain('13/02/2026;4101001;0000008;160,25');

    // Nao deve ter nenhum nao exportado (ambas as pernas consumidas)
    const result = prepareBalanceteTxtExport(rows, { de: '01/02/2026', ate: '28/02/2026' }, 'ACME');
    expect(result.naoExportados).toHaveLength(0);
  });

  it('evita duplicidade e consumo duplo quando debito e credito estao preenchidos em linhas separadas da mesma transacao e com datas diferentes (janela de compensacao)', () => {
    const rows = [
      row({
        data: '13/02/2026',
        codigo: '4101001',
        nome: 'PAGAMENTO DE BOLETO GAZIN',
        debito: 160.25,
        credito: 0,
        ordem: 1,
        contaDeb: '4101001',
        contaCred: '0000008',
      }),
      row({
        data: '15/02/2026',
        codigo: '0000008',
        nome: 'COMPENSACAO BOLETO GAZIN',
        debito: 0,
        credito: 160.25,
        ordem: 2,
        contaDeb: '4101001',
        contaCred: '0000008',
      }),
    ];
    const txt = buildTxtPlusFromRazaoVision(rows);
    const linhas = txt.split('\r\n').filter(Boolean);
    expect(linhas).toHaveLength(1);
    // Deve manter a data do debito (vencimento/pagamento)
    expect(linhas[0]).toContain('13/02/2026;4101001;0000008;160,25');

    // Nao deve ter nenhum nao exportado (ambas as pernas consumidas)
    const result = prepareBalanceteTxtExport(rows, { de: '01/02/2026', ate: '28/02/2026' }, 'ACME');
    expect(result.naoExportados).toHaveLength(0);
  });
});

describe('parseTxtPlusToRazaoVision — geração correta de partidas', () => {
  it('gera linhas com contaDeb/contaCred e mesma ordem para cada partida', async () => {
    const { parseTxtPlusToRazaoVision } = await import('../contabilPipeline');

    const rows = parseTxtPlusToRazaoVision([
      { date: '2026-02-15', description: 'PAGAMENTO FORNECEDOR', value: 500, accountDebit: '4101001', accountCredit: '1102001' },
    ]);

    // Deve gerar 2 linhas (uma por conta da partida)
    expect(rows.length).toBe(2);

    const debRow = rows.find((r) => r.debito > 0);
    const credRow = rows.find((r) => r.credito > 0);

    expect(debRow).toBeDefined();
    expect(credRow).toBeDefined();

    // Mesma ordem nas duas linhas (par natural para o Passo 1/2 do pareamento)
    expect(debRow!.ordem).toBe(credRow!.ordem);

    // contaDeb e contaCred preenchidos em ambas
    expect(debRow!.contaDeb).toBe('4101001');
    expect(debRow!.contaCred).toBe('1102001');
    expect(credRow!.contaDeb).toBe('4101001');
    expect(credRow!.contaCred).toBe('1102001');

    // Débito na conta correta, crédito na conta correta
    expect(debRow!.codigo).toBe('4101001');
    expect(credRow!.codigo).toBe('1102001');
    expect(debRow!.debito).toBe(500);
    expect(credRow!.credito).toBe(500);
  });

  it('lançamentos TXT+ importados saem completos no TXT exportado', async () => {
    const { parseTxtPlusToRazaoVision } = await import('../contabilPipeline');
    const { buildTxtPlusFromRazaoVision } = await import('../dominioTxtIO');

    const razao = parseTxtPlusToRazaoVision([
      { date: '2026-01-10', description: 'RECEITA SERVICOS', value: 1000, accountDebit: '1102001', accountCredit: '3101001' },
      { date: '2026-01-15', description: 'PAGAMENTO ALUGUEL', value: 800, accountDebit: '4201001', accountCredit: '1102001' },
    ]);

    const txt = buildTxtPlusFromRazaoVision(razao);
    const linhas = txt.split('\r\n').filter(Boolean);

    // Ambos os lançamentos devem sair no TXT
    expect(linhas).toHaveLength(2);
    expect(txt).toContain('10/01/2026;1102001;3101001;1000,00');
    expect(txt).toContain('15/01/2026;4201001;1102001;800,00');
  });

  it('não perde lançamentos quando contraparte natural coincide por ordem — não deve consumir par errado', async () => {
    const { buildTxtPlusFromRazaoVision } = await import('../dominioTxtIO');

    // Dois lançamentos com MESMAS contas, MESMO valor, MESMA data mas ordens distintas
    // (situação real: dois pagamentos idênticos ao mesmo fornecedor no mesmo dia)
    const rows = [
      { codigo: '4101001', nome: 'PAGTO FORNECEDOR X', data: '10/01/2026', debito: 250, credito: 0, saldoInicial: 0, saldoFinal: 0, ordem: 10, contaDeb: '4101001', contaCred: '1102001' },
      { codigo: '1102001', nome: 'PAGTO FORNECEDOR X', data: '10/01/2026', debito: 0, credito: 250, saldoInicial: 0, saldoFinal: 0, ordem: 10, contaDeb: '4101001', contaCred: '1102001' },
      { codigo: '4101001', nome: 'PAGTO FORNECEDOR X', data: '10/01/2026', debito: 250, credito: 0, saldoInicial: 0, saldoFinal: 0, ordem: 20, contaDeb: '4101001', contaCred: '1102001' },
      { codigo: '1102001', nome: 'PAGTO FORNECEDOR X', data: '10/01/2026', debito: 0, credito: 250, saldoInicial: 0, saldoFinal: 0, ordem: 20, contaDeb: '4101001', contaCred: '1102001' },
    ] satisfies import('../../../extratoVision/types/accounting').VisionBalanceteRow[];

    const txt = buildTxtPlusFromRazaoVision(rows);
    const linhas = txt.split('\r\n').filter(Boolean);

    // Ambos os lançamentos devem sair (não pode perder um por dedup)
    expect(linhas).toHaveLength(2);
    linhas.forEach((l) => expect(l).toContain('10/01/2026;4101001;1102001;250,00'));
  });

  it('lançamento reclassificado sai na conta NOVA, sem duplicar na antiga', async () => {
    const { buildTxtPlusFromRazaoVision } = await import('../dominioTxtIO');

    // Recebimento banco (8) × clientes (1000) reclassificado para a conta 444:
    // a linha de clientes foi movida para 444, mas as duas linhas ainda carregam
    // contaDeb/contaCred da partida ORIGINAL (8 × 1000) — como grava a tela de
    // reclassificação. O TXT tem que emitir 8 → 444, uma única vez.
    const rows = [
      { codigo: '8', nome: 'RECEBIMENTO PIX FULANO', data: '04/05/2026', debito: 110, credito: 0, saldoInicial: 0, saldoFinal: 0, ordem: 18, contaDeb: '8', contaCred: '1000' },
      { codigo: '444', nome: 'TRANSFERÊNCIA · RECEBIMENTO PIX FULANO', data: '04/05/2026', debito: 0, credito: 110, saldoInicial: 0, saldoFinal: 0, ordem: 428, contaDeb: '8', contaCred: '1000' },
    ] satisfies import('../../../extratoVision/types/accounting').VisionBalanceteRow[];

    const linhas = buildTxtPlusFromRazaoVision(rows).split('\r\n').filter(Boolean);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toContain('04/05/2026;8;444;110,00');
  });

  it('não rouba a contraparte de outro dia quando existe par no mesmo dia', async () => {
    const { buildTxtPlusFromRazaoVision } = await import('../dominioTxtIO');

    // O par natural de 26/05 é 8 → 444 (mesmo dia). A linha de clientes (1000) de
    // 20/05 tem o mesmo valor e está dentro da janela de 10 dias: não pode ser
    // consumida no lugar do par do próprio dia, senão sobra órfã e o valor duplica.
    const rows = [
      { codigo: '8', nome: 'RECEBIMENTO PIX A', data: '26/05/2026', debito: 110, credito: 0, saldoInicial: 0, saldoFinal: 0, ordem: 198, contaDeb: '8', contaCred: '1000' },
      { codigo: '444', nome: 'TRANSFERÊNCIA · RECEBIMENTO PIX A', data: '26/05/2026', debito: 0, credito: 110, saldoInicial: 0, saldoFinal: 0, ordem: 547, contaDeb: '8', contaCred: '1000' },
      { codigo: '8', nome: 'RECEBIMENTO PIX B', data: '20/05/2026', debito: 110, credito: 0, saldoInicial: 0, saldoFinal: 0, ordem: 100, contaDeb: '8', contaCred: '1000' },
      { codigo: '1000', nome: 'RECEBIMENTO PIX B', data: '20/05/2026', debito: 0, credito: 110, saldoInicial: 0, saldoFinal: 0, ordem: 100, contaDeb: '8', contaCred: '1000' },
    ] satisfies import('../../../extratoVision/types/accounting').VisionBalanceteRow[];

    const linhas = buildTxtPlusFromRazaoVision(rows).split('\r\n').filter(Boolean);
    expect(linhas).toHaveLength(2);
    expect(linhas.some((l) => l.includes('26/05/2026;8;444;110,00'))).toBe(true);
    expect(linhas.some((l) => l.includes('20/05/2026;8;1000;110,00'))).toBe(true);
  });
});

