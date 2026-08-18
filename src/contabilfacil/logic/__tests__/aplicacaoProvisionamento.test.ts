/**
 * Depósito a Prazo (SICREDINVEST): o que é movimento do mês e o que é provisão.
 *
 * Conferido contra os PDFs reais de 06/2026 e 07/2026. Do quadro mensal só
 * entram Rendimentos Pagos, IRRF e IOF — Aplicações e Resgates são
 * totalizadores que já vêm pelo extrato da conta corrente. O quadro traz só
 * "MM/AAAA", então o lançamento é datado no último dia do mês.
 */
import { describe, it, expect } from 'vitest';
import {
  parseAplicacaoExtratoText,
  aplicacaoRowEntraNaContabilidade,
} from '../aplicacaoExtratoParser';
import { buildAplicacaoLancamentoContabil } from '../aplicacaoExtratoLancamentos';
import type { AplicacaoContaExtrato } from '../aplicacaoExtratoStorage';

const extrato = (mesAno: string, linha: string, provisoes: string) => [
  'Extrato de Aplicação - Depósito a Prazo - Detalhado - Consolidado',
  'Produto:', 'SICREDINVEST AUTOMATICO',
  'Período de Consulta:', mesAno, 'a', mesAno,
  'Movimentações', 'Tributação', 'Rendimentos Provisionados',
  'Mês/Ano', 'Aplicações', 'Resgates', 'Rendimentos Pagos', 'IRRF', 'IOF',
  'No Mês', 'Acumulado', 'Saldo Atual',
  linha,
  provisoes,
].join(' ');

// 07/2026: Aplic 470.164,64 · Resg 446.078,12 · RendPagos 483,73 · IRRF 104,26 · IOF 19,98
const JULHO = extrato(
  '07/2026',
  '07/2026 470.164,64 446.078,12 483,73 104,26 19,98 576,96 379,09 407.524,40',
  'Posição para Saque Posição em 31/07/2026 Valor (R$) Saldo Atual 407.524,40 Rendimentos Provisionados 379,09 Saldo Bruto 407.903,49 Provisão IRRF 67,25 Provisão IOF 79,88',
);

// 06/2026: Aplic 391.302,79 · Resg 377.802,06 · RendPagos 396,94 · IRRF 72,89 · IOF 72,67
const JUNHO = extrato(
  '06/2026',
  '06/2026 391.302,79 377.802,06 396,94 72,89 72,67 504,75 285,86 383.078,39',
  'Posição para Saque Posição em 30/06/2026 Valor (R$) Saldo Atual 383.078,39 Rendimentos Provisionados 285,86 Saldo Bruto 383.364,25 Provisão IRRF 43,21 Provisão IOF 93,37',
);

describe.each([
  ['07/2026', JULHO, '31/07/2026', 483.73, 104.26, 19.98, 379.09, 67.25, 79.88],
  ['06/2026', JUNHO, '30/06/2026', 396.94, 72.89, 72.67, 285.86, 43.21, 93.37],
])('SICREDINVEST %s', (_m, texto, dataFim, rend, irrf, iof, pRend, pIrrf, pIof) => {
  const r = parseAplicacaoExtratoText(texto);

  it('data cai no último dia do mês (o quadro só traz MM/AAAA)', () => {
    expect(r.rows.length).toBeGreaterThan(0);
    for (const row of r.rows) expect(row.data).toBe(dataFim);
  });

  it('do quadro mensal só entram Rendimentos Pagos, IRRF e IOF', () => {
    const reais = r.rows.filter((x) => !x.provisionado);
    expect(reais.map((x) => x.historico)).toEqual(['RENDIMENTOS PAGOS', 'IRRF', 'IOF']);
    expect(reais[0].entrada).toBeCloseTo(rend, 2);
    expect(reais[1].saida).toBeCloseTo(irrf, 2);
    expect(reais[2].saida).toBeCloseTo(iof, 2);
  });

  it('aplicações e resgates não viram lançamento (já vêm pela conta corrente)', () => {
    expect(r.rows.some((x) => /APLICA[ÇC]|RESGATE/i.test(x.historico))).toBe(false);
  });

  it('as provisões aparecem, marcadas e bloqueadas', () => {
    const prov = r.rows.filter((x) => x.provisionado);
    expect(prov.map((x) => x.historico)).toEqual([
      'RENDIMENTOS PROVISIONADOS', 'PROVISÃO IRRF', 'PROVISÃO IOF',
    ]);
    expect(prov[0].entrada).toBeCloseTo(pRend, 2);
    expect(prov[1].saida).toBeCloseTo(pIrrf, 2);
    expect(prov[2].saida).toBeCloseTo(pIof, 2);
    for (const p of prov) expect(aplicacaoRowEntraNaContabilidade(p)).toBe(false);
  });

  it('provisão bloqueada fica fora dos totais; desbloqueada entra', () => {
    const conta = { id: 'c', nome: 'SICREDINVEST', contaContabil: '1051', rows: r.rows } as unknown as AplicacaoContaExtrato;
    const somaDebitos = (rows: typeof r.rows) =>
      rows
        .map((row) => buildAplicacaoLancamentoContabil(row, conta, []))
        .filter((l) => l.contabiliza && l.nature === 'D')
        .reduce((s, l) => s + l.valor, 0);

    expect(somaDebitos(r.rows)).toBeCloseTo(rend, 2);

    const liberado = r.rows.map((row) =>
      row.provisionado ? { ...row, desbloqueado: true } : row,
    );
    expect(somaDebitos(liberado)).toBeCloseTo(rend + pRend, 2);
  });
});
