import { describe, it, expect } from 'vitest';
import { calculateLoan } from '../loanCalculator';
import type { LoanParams } from '../loanCalculator';

/**
 * Regressão: contrato SICREDI C30530597-9 (R$ 40.288,00 / 48x / PRICE / spread 1,9231% a.m.)
 * com taxas indexadas históricas MENORES que a taxa contratada.
 *
 * Com PMT fixa da 1ª competência (R$ 1.292,99), a amortização acelera e o contrato
 * quitava no mês 38 — 10 parcelas a menos que o contratado. Com `recalculo_pmt`
 * (padrão para PRICE indexado), a PMT é refeita a cada competência e o saldo devedor
 * zera exatamente na parcela 48.
 */
const TAXAS_HISTORICAS: Record<string, number> = {
  '2024-01': 0.80, '2024-02': 0.83, '2024-03': 0.89, '2024-04': 0.83,
  '2024-05': 0.79, '2024-06': 0.91, '2024-07': 0.87, '2024-08': 0.84,
  '2024-09': 0.93, '2024-10': 0.79, '2024-11': 0.93, '2024-12': 1.01,
  '2025-01': 0.99, '2025-02': 0.96, '2025-03': 1.06, '2025-04': 1.14,
  '2025-05': 1.10, '2025-06': 1.28, '2025-07': 1.16, '2025-08': 1.22,
  '2025-09': 1.28, '2025-10': 1.05, '2025-11': 1.22, '2025-12': 1.16,
  '2026-01': 1.00, '2026-02': 1.21, '2026-03': 1.09, '2026-04': 1.07,
  '2026-05': 1.12, '2026-06': 1.22, '2026-07': 0.11,
};

function baseParams(overrides: Partial<LoanParams> = {}): LoanParams {
  return {
    principal: 40288,
    months: 48,
    fixedRateMonth: 1.9231,
    fixedRateType: 'percent',
    varRateMonth: 0,
    gracePeriod: 0,
    graceType: 'capitalized',
    system: 'PRICE',
    monthlyOperationCost: 0,
    monthlyOpCostType: 'percent',
    graceFixedRateMonth: 0,
    graceFixedRateType: 'percent',
    graceMonthlyOperationCost: 0,
    graceMonthlyOpCostType: 'percent',
    proRataDieMode: 'linear',
    operationalCostDayBasis: 'commercial30',
    contractDate: new Date(Date.UTC(2023, 11, 14)),
    firstInstallmentDate: new Date(Date.UTC(2024, 0, 14)),
    monthlyRateMap: new Map(Object.entries(TAXAS_HISTORICAS)),
    ...overrides,
  } as LoanParams;
}

describe('PRICE indexado — recálculo de PMT', () => {
  it('gera exatamente as 48 parcelas contratadas, sem pular competência', () => {
    const amort = calculateLoan(baseParams()).filter((r) => r.month > 0);

    expect(amort).toHaveLength(48);
    expect(amort.map((r) => r.month)).toEqual(
      Array.from({ length: 48 }, (_, i) => i + 1),
    );
  });

  it('zera o saldo devedor na última parcela — sem quitação antecipada', () => {
    const amort = calculateLoan(baseParams()).filter((r) => r.month > 0);

    // Nenhuma parcela intermediária pode zerar o saldo
    for (const row of amort.slice(0, -1)) {
      expect(row.finalBalance).toBeGreaterThan(0);
    }
    expect(amort[47].finalBalance).toBe(0);
  });

  it('recalcula a PMT conforme a taxa vigente e o prazo remanescente', () => {
    const amort = calculateLoan(baseParams()).filter((r) => r.month > 0);

    // Mês 1: spread 1,9231% + CDI 0,80% de jan/2024 = 2,7231% sobre 48 competências
    expect(amort[0].effectivePctInPeriod).toBeCloseTo(2.7231, 4);
    expect(amort[0].installment).toBeCloseTo(1514.01, 1);

    // Mês 32: fora da série histórica — spread + variação projetada (0%)
    expect(amort[31].effectivePctInPeriod).toBeCloseTo(1.9231, 4);

    // PMT nunca fica travada na parcela da 1ª competência
    expect(amort[0].installment).not.toBeCloseTo(amort[31].installment, 1);
  });

  it('nunca gera parcela zerada nem saldo devedor negativo', () => {
    const amort = calculateLoan(baseParams()).filter((r) => r.month > 0);

    for (const row of amort) {
      expect(row.installment).toBeGreaterThan(0);
      expect(row.finalBalance).toBeGreaterThanOrEqual(0);
    }
  });

  it('mantém o curto prazo dentro do saldo devedor da competência', () => {
    const amort = calculateLoan(baseParams()).filter((r) => r.month > 0);

    for (const row of amort) {
      expect(row.shortTermBalance).toBeLessThanOrEqual(row.finalBalance + 0.01);
    }
  });

  it('com pmt_fixo mantém o comportamento de PMT travada', () => {
    const amort = calculateLoan(
      baseParams({ priceSelicAdjustment: 'pmt_fixo' }),
    ).filter((r) => r.month > 0);

    // PMT única calculada com a taxa contratada
    expect(amort[0].installment).toBeCloseTo(1292.99, 1);
    // Ainda assim a tabela exibe todas as competências contratadas
    expect(amort).toHaveLength(48);
    expect(amort.map((r) => r.month)).toEqual(
      Array.from({ length: 48 }, (_, i) => i + 1),
    );
  });
});
