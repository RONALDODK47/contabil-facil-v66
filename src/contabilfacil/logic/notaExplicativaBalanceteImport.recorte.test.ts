import { describe, expect, it, vi } from 'vitest';

// pdfjs-dist exige DOM (DOMMatrix) — aqui só testamos o parser de linhas.
vi.mock('pdfjs-dist', () => ({ getDocument: vi.fn() }));

import { parseBalanceteTextLines } from './notaExplicativaBalanceteImport';

/**
 * Linhas REAIS do balancete Domínio (BESSA & GOMIDE LTDA, 12/2025) extraídas do
 * PDF com as colunas coladas — ordem do texto: [SaldoAtual, Crédito, Débito,
 * SaldoAnterior] + código reduzido + descrição. O recorte precisa reproduzir
 * exatamente o que está impresso no PDF, coluna por coluna.
 */
const LINHAS_PDF_COLADAS = [
  'BALANCETE',
  'Código',
  'Empresa:',
  'C.N.P.J.:33.369.075/0001-01',
  'Período:01/12/2025 - 31/12/2025',
  'Descrição da contaCréditoSaldo AtualSaldo AnteriorDébito',
  'BESSA & GOMIDE LTDA',
  '230.199,52D9.536,3419.779,94219.955,92D1  ATIVO',
  'ATIVO CIRCULANTE',
  '230.199,52D9.536,3419.779,94219.955,92D2ATIVO CIRCULANTE',
  '218.239,57D9.109,347.819,99219.528,92D3DISPONÍVEL',
  '214.386,28D4.078,460,00218.464,74D4CAIXA',
  '214.386,28D4.078,460,00218.464,74D5CAIXA GERAL',
  '3.853,29D5.030,887.819,991.064,18D9CAIXA ECONÔMICA FEDERAL CC: 1001-8 OP/003',
  '11.959,95D427,0011.959,95427,00D12CONTAS A RECEBER',
  '11.959,95D0,0011.959,950,001000CLIENTES DIVERSOS',
  '0,00427,000,00427,00D1007ADIANTAMENTOS',
  '0,000,000,000,00501ATIVO NÃO-CIRCULANTE',
  '4.500,00C0,000,004.500,00C125(-) DEPRECIAÇÕES, AMORT. E EXAUS. ACUMUL',
  '0,00854,00854,000,0019513º SALARIO A PAGAR',
  '0,00854,00854,000,0030113º SALÁRIO',
  '32.085,94D7.819,994.940,0034.965,93D1057CONTA TRANSITORIA CAIXA PRESTADORA 043',
  '4.684,60C0,000,004.684,60C1062EMPRÉSTIMO GIRO CAIXA Nº 2104538',
  '170.828,12C146.273,1073.136,5597.691,57C265LUCROS OU PREJUÍZOS ACUMULADOS',
  '0,0080.489,02146.419,4565.930,43C402RESULTADO LÍQUIDO DO PERÍODO ANTES DO IRPJ, CSLL E PARTICIP.',
  '0,0011.959,95141.665,62129.705,67C411SERVIÇOS PRESTADOS',
  '0,00141.665,62141.665,620,00473RESULTADO DO EXERCÍCIO',
  'Sistema licenciado para INOV CONSULTORIA E SERVICOS ADMINISTRATIVOS LTDA',
];

function signed(valor: number, natureza?: 'D' | 'C'): number {
  return natureza === 'C' ? -valor : valor;
}

describe('parseBalanceteTextLines — recorte do balancete Domínio em PDF', () => {
  const rows = parseBalanceteTextLines(LINHAS_PDF_COLADAS);
  const byCodigo = new Map(rows.map((r) => [r.codigo, r]));

  it('recorta todas as contas do PDF, sem perder nenhuma linha de dados', () => {
    const esperados = ['1', '2', '3', '4', '5', '9', '12', '1000', '1007', '501', '125', '195', '301', '1057', '1062', '265', '402', '411', '473'];
    for (const cod of esperados) {
      expect(byCodigo.has(cod), `conta ${cod} não foi recortada`).toBe(true);
    }
    expect(rows).toHaveLength(esperados.length);
  });

  it('ignora cabeçalho, rodapé e títulos de grupo sem valores', () => {
    expect(rows.some((r) => /licenciado|^empresa|^descri[çc][ãa]o da conta/i.test(r.nome))).toBe(false);
    expect(byCodigo.has('33')).toBe(false); // CNPJ não vira conta
  });

  it('recorta as 4 colunas exatamente como impressas no PDF (linha 1 ATIVO)', () => {
    const ativo = byCodigo.get('1')!;
    expect(ativo.nome).toBe('ATIVO');
    expect(ativo.saldoInicial).toBeCloseTo(219955.92, 2);
    expect(ativo.naturezaSaldoInicial).toBe('D');
    expect(ativo.debito).toBeCloseTo(19779.94, 2);
    expect(ativo.credito).toBeCloseTo(9536.34, 2);
    expect(ativo.saldoFinal).toBeCloseTo(230199.52, 2);
    expect(ativo.naturezaSaldoFinal).toBe('D');
  });

  it('não perde contas cujo nome começa com número (13º salário)', () => {
    const r195 = byCodigo.get('195')!;
    expect(r195.nome).toBe('13º SALARIO A PAGAR');
    expect(r195.debito).toBeCloseTo(854.0, 2);
    expect(r195.credito).toBeCloseTo(854.0, 2);
    const r301 = byCodigo.get('301')!;
    expect(r301.nome).toBe('13º SALÁRIO');
  });

  it('não confunde números da descrição com colunas de valor', () => {
    const r9 = byCodigo.get('9')!;
    expect(r9.nome).toBe('CAIXA ECONÔMICA FEDERAL CC: 1001-8 OP/003');
    expect(r9.saldoFinal).toBeCloseTo(3853.29, 2);
    const r1057 = byCodigo.get('1057')!;
    expect(r1057.nome).toBe('CONTA TRANSITORIA CAIXA PRESTADORA 043');
    const r1062 = byCodigo.get('1062')!;
    expect(r1062.nome).toBe('EMPRÉSTIMO GIRO CAIXA Nº 2104538');
    expect(r1062.saldoFinal).toBeCloseTo(4684.6, 2);
    expect(r1062.naturezaSaldoFinal).toBe('C');
  });

  it('recorta nomes iniciados por parêntese ("(-) DEPRECIAÇÕES...")', () => {
    const r125 = byCodigo.get('125')!;
    expect(r125.nome).toBe('(-) DEPRECIAÇÕES, AMORT. E EXAUS. ACUMUL');
    expect(r125.naturezaSaldoFinal).toBe('C');
  });

  it('toda linha recortada fecha a partida: SaldoAnterior + Débito − Crédito = SaldoAtual', () => {
    for (const r of rows) {
      const esperado =
        signed(r.saldoInicial ?? 0, r.naturezaSaldoInicial) + r.debito - r.credito;
      expect(
        Math.abs(esperado - signed(r.saldoFinal ?? 0, r.naturezaSaldoFinal)),
        `partida não fecha na conta ${r.codigo} ${r.nome}`,
      ).toBeLessThanOrEqual(0.02);
    }
  });

  it('aceita o mesmo balancete com valores espaçados (ordem Domínio)', () => {
    const [r] = parseBalanceteTextLines(['230.199,52D 9.536,34 19.779,94 219.955,92D 1 ATIVO']);
    expect(r!.saldoInicial).toBeCloseTo(219955.92, 2);
    expect(r!.debito).toBeCloseTo(19779.94, 2);
    expect(r!.credito).toBeCloseTo(9536.34, 2);
    expect(r!.saldoFinal).toBeCloseTo(230199.52, 2);
  });

  it('aceita a ordem visual impressa (código + descrição + valores no fim)', () => {
    const [r] = parseBalanceteTextLines(['1 ATIVO 219.955,92D 19.779,94 9.536,34 230.199,52D']);
    expect(r!.codigo).toBe('1');
    expect(r!.nome).toBe('ATIVO');
    expect(r!.saldoInicial).toBeCloseTo(219955.92, 2);
    expect(r!.debito).toBeCloseTo(19779.94, 2);
    expect(r!.credito).toBeCloseTo(9536.34, 2);
    expect(r!.saldoFinal).toBeCloseTo(230199.52, 2);
  });
});
