import { describe, expect, it } from 'vitest';
import { construirHistoricosFolha, type FolhaRegra } from './folhaContasAutomacaoStorage';

/**
 * Lançamentos como chegam da importação do "Resumo Mensal" (competência 01/2026 do cliente).
 * O seletor "Puxar histórico da folha" é montado a partir deles.
 */
const LINHAS: Array<{ description: string; tipo: 'PROVENTOS' | 'DESCONTOS' | 'INFORMATIVA' }> = [
  { description: '20 - GRATIFICACOES1', tipo: 'PROVENTOS' },
  { description: '229 - FERIAS PROPORCIONAIS', tipo: 'PROVENTOS' },
  { description: '243 - DESCANSO SEMANAL REMUNERADO2', tipo: 'PROVENTOS' },
  { description: '249 - GRATIFICACAO', tipo: 'PROVENTOS' },
  { description: '274 - GRATIFICAÇÃO DE FUNÇÃO', tipo: 'PROVENTOS' },
  { description: '995 - SALARIO FAMILIA .', tipo: 'PROVENTOS' },
  { description: '28169 - 1/3 FERIAS PROPORCIONAIS RESCISAO', tipo: 'PROVENTOS' },
  { description: '58550 - 13 SALARIO INTEGRAL RESCISAO', tipo: 'PROVENTOS' },
  { description: '8781 - SALARIO EMPREGADO 2', tipo: 'PROVENTOS' },
  { description: '9179 - SALDO DE SALARIO HORAS2', tipo: 'PROVENTOS' },
  { description: '9180 - SALDO DE SALARIO DIAS.2', tipo: 'PROVENTOS' },
  { description: '51 - LIQUIDO RESCISAO', tipo: 'DESCONTOS' },
  { description: '360 - DESC. EMP. CRED. TRAB Nº 0000001054844453', tipo: 'DESCONTOS' },
  { description: '362 - DESC. EMP. CRED. TRAB Nº 0000001079740603', tipo: 'DESCONTOS' },
  { description: '2826 - INSS SOBRE RESCISAO', tipo: 'DESCONTOS' },
  { description: '2989 - INSS 13 SAL.RESCISAO', tipo: 'DESCONTOS' },
  { description: '998 - I.N.S.S.', tipo: 'DESCONTOS' },
  { description: '750 - DESC. EMP. CRED. TRAB Nº 00000001191563497', tipo: 'DESCONTOS' },
  { description: '123 - F.G.T.S DE RESCISAO', tipo: 'INFORMATIVA' },
  { description: '135 - FGTS 13o SALARIO RESCISAO', tipo: 'INFORMATIVA' },
  { description: '996 - F.G.T.S DO MES', tipo: 'INFORMATIVA' },
];

function labels(regras: FolhaRegra[] = []): string[] {
  return construirHistoricosFolha(LINHAS, regras).map((o) => o.descricao);
}

describe('construirHistoricosFolha — o que aparece em "Puxar histórico da folha"', () => {
  it('substitui as rubricas cruas por históricos consolidados', () => {
    const opcoes = construirHistoricosFolha(LINHAS, []);

    // Nenhuma rubrica crua sobrou na lista
    expect(opcoes.map((o) => o.descricao)).not.toContain('8781 - SALARIO EMPREGADO 2');
    expect(opcoes.map((o) => o.descricao)).not.toContain('243 - DESCANSO SEMANAL REMUNERADO2');

    // 21 lançamentos viram 10 históricos a cadastrar
    expect(opcoes.length).toBe(10);
    expect(opcoes.every((o) => o.destino)).toBe(true);
  });

  it('salário, saldo de salário e DSR aparecem como UMA linha só', () => {
    const remuneracao = construirHistoricosFolha(LINHAS, []).filter(
      (o) => o.destino === 'REMUNERACAO',
    );

    expect(remuneracao).toHaveLength(1);
    // DSR + salário empregado + saldo horas + saldo dias
    expect(remuneracao[0]?.ocorrencias).toBe(4);
  });

  it('as gratificações saem da remuneração e formam o próprio histórico', () => {
    const gratificacoes = construirHistoricosFolha(LINHAS, []).filter(
      (o) => o.destino === 'GRATIFICACOES_PREMIOS',
    );

    expect(gratificacoes).toHaveLength(1);
    expect(gratificacoes[0]?.ocorrencias).toBe(3);
  });

  it('salário-família aparece separado, e não dentro do histórico de salários', () => {
    const opcoes = construirHistoricosFolha(LINHAS, []);
    const beneficio = opcoes.find((o) => o.destino === 'BENEFICIO_INSS');

    expect(beneficio).toBeDefined();
    expect(beneficio?.ocorrencias).toBe(1);
    expect(opcoes.find((o) => o.destino === 'REMUNERACAO')?.ocorrencias).toBe(4);
  });

  it('os 3 contratos de consignado viram um histórico só', () => {
    const consignado = construirHistoricosFolha(LINHAS, []).find((o) => o.destino === 'CONSIGNADO');
    expect(consignado?.ocorrencias).toBe(3);
  });

  it('o líquido da rescisão É oferecido — é ele que separa a folha mensal da rescisão', () => {
    const opcoes = construirHistoricosFolha(LINHAS, []);
    const liquido = opcoes.find((o) => o.destino === 'LIQUIDO_RESCISAO');

    expect(liquido).toBeDefined();
    expect(liquido?.descricao).toBe('Líquido da rescisão (transferir para rescisões a pagar)');
    // mas a rubrica crua não aparece: entra consolidada como qualquer outro histórico
    expect(labels()).not.toContain('51 - LIQUIDO RESCISAO');
  });

  it('totalizadores de verdade continuam fora da lista', () => {
    const comTotal = [...LINHAS, { description: 'LIQUIDO GERAL', tipo: 'DESCONTOS' as const }];
    expect(construirHistoricosFolha(comTotal, []).some((o) => o.destino === 'NAO_CONTABILIZA')).toBe(false);
  });

  it('histórico já cadastrado some da lista', () => {
    const comRegra: FolhaRegra[] = [
      { id: '1', descricao: 'Salários e remuneração', contaDebito: '1', contaCredito: '2', destino: 'REMUNERACAO' },
    ];
    const antes = construirHistoricosFolha(LINHAS, []);
    const depois = construirHistoricosFolha(LINHAS, comRegra);

    expect(depois.some((o) => o.destino === 'REMUNERACAO')).toBe(false);
    expect(depois.length).toBe(antes.length - 1);
  });

  it('rubrica que o sistema não classifica continua aparecendo sozinha, para regra manual', () => {
    const opcoes = construirHistoricosFolha(
      [...LINHAS, { description: '7777 - VERBA INTERNA XYZ', tipo: 'PROVENTOS' }],
      [],
    );
    const avulsa = opcoes.find((o) => o.descricao === '7777 - VERBA INTERNA XYZ');

    expect(avulsa).toBeDefined();
    expect(avulsa?.destino).toBeUndefined();
    // Avulsos vão para o fim da lista — o caminho normal são os consolidados
    expect(opcoes[opcoes.length - 1]?.descricao).toBe('7777 - VERBA INTERNA XYZ');
  });

  it('ordena os consolidados pelos que cobrem mais lançamentos', () => {
    const opcoes = construirHistoricosFolha(LINHAS, []);
    expect(opcoes[0]?.destino).toBe('REMUNERACAO');
    const ocorrencias = opcoes.filter((o) => o.destino).map((o) => o.ocorrencias);
    expect([...ocorrencias].sort((a, b) => b - a)).toEqual(ocorrencias);
  });
});
