/**
 * Layout "Movimento Poupança" (SICREDI POUPANCA INTEGRADA), conferido contra o
 * PDF real de 07/2026.
 *
 * O mesmo texto é testado nas DUAS formas em que ele chega ao parser, porque
 * elas são bem diferentes e já quebraram o parser antes: o `extractPdfText`
 * junta a página inteira numa linha só (`items.join(' ')`), enquanto a extração
 * nativa/OCR devolve uma célula por linha.
 */
import { describe, it, expect } from 'vitest';
import { parseAplicacaoExtratoText } from '../aplicacaoExtratoParser';

const NATIVO = [
  'Extrato de Aplicação - Movimento Poupança',
  'Produto:', 'SICREDI POUPANCA INTEGRADA',
  'Período de Consulta:', '07/2026', 'a', '07/2026',
  'Movimentação',
  'Data', 'Histórico', 'Valor (R$)', 'Saldo',
  '30/06/2026', 'SALDO ANTERIOR', '10.806,08', '10.806,08',
  '10/07/2026', 'CAPITALIZ. REND. JR', '10,04', '10.816,12',
  '10/07/2026', 'CAPITALIZ. REND. CM', '3,46', '10.819,58',
  '10/07/2026', 'ENCARGOS DE IRRF', '3,04', '10.816,54',
  '14/07/2026', 'CAPITALIZ. REND. JR', '13,01', '10.829,55',
  '14/07/2026', 'CAPITALIZ. REND. CM', '4,43', '10.833,98',
  '14/07/2026', 'ENCARGOS DE IRRF', '3,92', '10.830,06',
  '15/07/2026', 'CAPITALIZ. REND. JR', '19,53', '10.849,59',
  '15/07/2026', 'CAPITALIZ. REND. CM', '6,71', '10.856,30',
  '15/07/2026', 'ENCARGOS DE IRRF', '5,90', '10.850,40',
  '17/07/2026', 'CAPITALIZ. REND. JR', '11,55', '10.861,95',
  '17/07/2026', 'CAPITALIZ. REND. CM', '3,96', '10.865,91',
  '17/07/2026', 'ENCARGOS DE IRRF', '3,49', '10.862,42',
  '31/07/2026', 'SALDO ATUAL', '10.862,42', '10.862,42',
  // Resumo por Período e Posição para Saque: números SEM data, não podem virar lançamento
  'Resumo por Período',
  'Aniversário', 'Saldo Anterior', 'Aplicações', 'Resgates', 'Rendimentos', 'IRRF', 'Saldo Atual',
  '10.806,08', '0,00', '0,00', '72,69', '16,35', '10.862,42',
  '10', '2.004,99', '0,00', '0,00', '13,50', '3,04', '2.015,45',
  'Posição para Saque', 'Posição em 31/07/2026', 'Valor (R$)',
  'Saldo até 03/05/12', '0,00',
  'Saldo a partir de 04/05/12', '10.862,42',
  'Saldo Bruto', '10.862,42',
  'Líquido para Saque', '10.862,42',
].join('\n');

/** Como o extractPdfText do app entrega: tudo numa linha. */
const PDFJS = NATIVO.split('\n').join(' ');

const ESPERADO: Array<[string, string, number, number, number]> = [
  ['10/07/2026', 'CAPITALIZ. REND. JR', 10.04, 0, 10816.12],
  ['10/07/2026', 'CAPITALIZ. REND. CM', 3.46, 0, 10819.58],
  ['10/07/2026', 'ENCARGOS DE IRRF', 0, 3.04, 10816.54],
  ['14/07/2026', 'CAPITALIZ. REND. JR', 13.01, 0, 10829.55],
  ['14/07/2026', 'CAPITALIZ. REND. CM', 4.43, 0, 10833.98],
  ['14/07/2026', 'ENCARGOS DE IRRF', 0, 3.92, 10830.06],
  ['15/07/2026', 'CAPITALIZ. REND. JR', 19.53, 0, 10849.59],
  ['15/07/2026', 'CAPITALIZ. REND. CM', 6.71, 0, 10856.30],
  ['15/07/2026', 'ENCARGOS DE IRRF', 0, 5.90, 10850.40],
  ['17/07/2026', 'CAPITALIZ. REND. JR', 11.55, 0, 10861.95],
  ['17/07/2026', 'CAPITALIZ. REND. CM', 3.96, 0, 10865.91],
  ['17/07/2026', 'ENCARGOS DE IRRF', 0, 3.49, 10862.42],
];

describe.each([
  ['texto do pdfjs (uma linha só)', PDFJS],
  ['texto nativo (uma célula por linha)', NATIVO],
])('Movimento Poupança — %s', (_nome, texto) => {
  it('extrai os 12 lançamentos com data, histórico, valor e saldo', () => {
    const r = parseAplicacaoExtratoText(texto);
    expect(r.layout).toBe('movimento');
    expect(r.rows).toHaveLength(ESPERADO.length);
    r.rows.forEach((row, i) => {
      const [data, historico, entrada, saida, saldo] = ESPERADO[i];
      expect([row.data, row.historico]).toEqual([data, historico]);
      expect(row.entrada).toBeCloseTo(entrada, 2);
      expect(row.saida).toBeCloseTo(saida, 2);
      expect(row.saldo).toBeCloseTo(saldo, 2);
    });
  });

  it('o sinal vem do saldo: rendimento entra, encargo sai', () => {
    const r = parseAplicacaoExtratoText(texto);
    for (const row of r.rows) {
      if (/ENCARGO/i.test(row.historico)) expect(row.saida).toBeGreaterThan(0);
      if (/CAPITALIZ/i.test(row.historico)) expect(row.entrada).toBeGreaterThan(0);
    }
  });

  it('lê o saldo anterior e o SALDO ATUAL impressos', () => {
    const r = parseAplicacaoExtratoText(texto);
    expect(r.saldoAnterior).toBeCloseTo(10806.08, 2);
    expect(r.saldoFinal).toBeCloseTo(10862.42, 2);
  });

  it('a cadeia fecha e bate com o Resumo por Período do PDF', () => {
    const r = parseAplicacaoExtratoText(texto);
    expect(r.totalEntradas).toBeCloseTo(72.69, 2); // Rendimentos
    expect(r.totalSaidas).toBeCloseTo(16.35, 2); // IRRF
    expect(r.saldoAnterior! + r.totalEntradas - r.totalSaidas).toBeCloseTo(r.saldoFinal!, 2);
  });

  it('não transforma linha de saldo, resumo ou posição para saque em lançamento', () => {
    const r = parseAplicacaoExtratoText(texto);
    expect(r.rows.some((x) => /SALDO/i.test(x.historico))).toBe(false);
    expect(r.rows.some((x) => /Saque|Bruto|Bloque|Aniversário/i.test(x.historico))).toBe(false);
  });
});
