import { describe, expect, it } from 'vitest';
import { calculateLoan, type LoanParams } from '../loanCalculator';

describe('interestAdjustment', () => {
  const baseParams: LoanParams = {
    principal: 100000,
    months: 24,
    fixedRateMonth: 1.5,
    fixedRateType: 'percent',
    varRateMonth: 0,
    gracePeriod: 0,
    graceType: 'capitalized',
    system: 'PRICE',
    monthlyOperationCost: 0,
    monthlyOpCostType: 'percent',
    graceFixedRateMonth: 1.5,
    graceFixedRateType: 'percent',
    graceMonthlyOperationCost: 0,
    graceMonthlyOpCostType: 'percent',
    proRataDieMode: 'linear',
    operationalCostDayBasis: 'commercial30',
    graceInterestRoundingMode: 'halfAwayFromZero',
    graceInterestDecimalPlaces: 2,
    contractDate: new Date('2025-01-01'),
    firstInstallmentDate: new Date('2025-02-01'),
  };

  it('variacaoMonetaria aumenta juros e parcela bruta sem alterar saldo devedor', () => {
    const normalSchedule = calculateLoan(baseParams);
    const adj = 143.06;
    const adjustedSchedule = calculateLoan({
      ...baseParams,
      monthlyAdjustments: { 5: { interestAdjustment: adj } },
    });

    const m5Normal = normalSchedule[5]!;
    const m5Adjusted = adjustedSchedule[5]!;

    // Juros aumenta pelo valor do ajuste
    expect(m5Adjusted.interest).toBeCloseTo(m5Normal.interest + adj, 1);
    // Parcela bruta deve aumentar pelo valor do ajuste
    expect(m5Adjusted.installment).toBeCloseTo(m5Normal.installment + adj, 1);
    // Saldo final NÃO deve mudar
    expect(m5Adjusted.finalBalance).toBeCloseTo(m5Normal.finalBalance, 1);
    // O ajuste fica registrado na linha
    expect(m5Adjusted.interestAdjustment).toBe(adj);
    // Meses seguintes: saldo igual → juros iguais (sem cascata)
    const m6Normal = normalSchedule[6]!;
    const m6Adjusted = adjustedSchedule[6]!;
    expect(m6Adjusted.interest).toBeCloseTo(m6Normal.interest, 1);
    expect(m6Adjusted.finalBalance).toBeCloseTo(m6Normal.finalBalance, 1);
  });

  it('variacaoMonetaria negativa reduz juros apenas no mês sem alterar saldo devedor', () => {
    const normalSchedule = calculateLoan(baseParams);
    const adj = -50;
    const adjustedSchedule = calculateLoan({
      ...baseParams,
      monthlyAdjustments: { 3: { interestAdjustment: adj } },
    });

    const m3Normal = normalSchedule[3]!;
    const m3Adjusted = adjustedSchedule[3]!;

    expect(m3Adjusted.interest).toBeCloseTo(m3Normal.interest + adj, 1);
    expect(m3Adjusted.installment).toBeCloseTo(m3Normal.installment + adj, 1);
    expect(m3Adjusted.finalBalance).toBeCloseTo(m3Normal.finalBalance, 1);
    expect(m3Adjusted.interestAdjustment).toBe(adj);
  });
});
