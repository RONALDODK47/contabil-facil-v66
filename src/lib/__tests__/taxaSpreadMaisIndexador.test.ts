import { describe, it, expect } from 'vitest';
import { calculateLoan } from '../loanCalculator';
import type { LoanParams } from '../loanCalculator';

/**
 * Regressão: o campo de juros da UI é um SPREAD — rotulado
 * "Spread Mensal s/ Carência % (+ CDI)" — e precisa SOMAR ao indexador.
 *
 * `getTaxaForPeriod` retornava apenas o valor da série do BCB quando ela cobria
 * a competência, descartando o spread. Como a série cobre quase toda a tabela,
 * alterar o juros no formulário não mudava nem a parcela nem os juros.
 */
function params(overrides: Partial<LoanParams> = {}): LoanParams {
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
    ...overrides,
  } as LoanParams;
}

/** Série do BCB cobrindo as 12 primeiras competências. */
const serieBcb = new Map<string, number>([
  ['2024-01', 0.80], ['2024-02', 0.83], ['2024-03', 0.89], ['2024-04', 0.83],
  ['2024-05', 0.79], ['2024-06', 0.91], ['2024-07', 0.87], ['2024-08', 0.84],
  ['2024-09', 0.93], ['2024-10', 0.79], ['2024-11', 0.93], ['2024-12', 1.01],
]);

const primeiraLinha = (p: LoanParams) => calculateLoan(p).filter((r) => r.month > 0)[0];

describe('Taxa da competência = spread + indexador', () => {
  it('soma o spread ao indexador nas competências cobertas pela série', () => {
    const linha = primeiraLinha(params({ monthlyRateMap: serieBcb }));

    // 1,9231% de spread + 0,80% de CDI em jan/2024
    expect(linha.effectivePctInPeriod).toBeCloseTo(2.7231, 4);
    expect(linha.interest).toBeCloseTo(40288 * 0.027231, 2);
  });

  it('alterar o juros muda a parcela e os juros mesmo com série do BCB', () => {
    const comSpreadBaixo = primeiraLinha(
      params({ fixedRateMonth: 1.0, monthlyRateMap: serieBcb }),
    );
    const comSpreadAlto = primeiraLinha(
      params({ fixedRateMonth: 3.0, monthlyRateMap: serieBcb }),
    );

    expect(comSpreadAlto.interest).toBeGreaterThan(comSpreadBaixo.interest);
    expect(comSpreadAlto.installment).toBeGreaterThan(comSpreadBaixo.installment);

    // A diferença de juros é exatamente 2 pontos percentuais sobre o saldo
    expect(comSpreadAlto.interest - comSpreadBaixo.interest).toBeCloseTo(40288 * 0.02, 2);
  });

  it('usa a variação projetada nas competências sem série', () => {
    // Competência 13 (jan/2025) está fora da série: spread + projeção
    const linhas = calculateLoan(
      params({ monthlyRateMap: serieBcb, varRateMonth: 0 }),
    ).filter((r) => r.month > 0);

    expect(linhas[12].effectivePctInPeriod).toBeCloseTo(1.9231, 4);

    const comProjecao = calculateLoan(
      params({ monthlyRateMap: serieBcb, varRateMonth: 0.5 }),
    ).filter((r) => r.month > 0);

    expect(comProjecao[12].effectivePctInPeriod).toBeCloseTo(2.4231, 4);
  });

  it('sem indexador algum, a taxa é o próprio spread', () => {
    const linha = primeiraLinha(params({ varRateMonth: 0 }));

    expect(linha.effectivePctInPeriod).toBeCloseTo(1.9231, 4);
    expect(linha.interest).toBeCloseTo(40288 * 0.019231, 2);
  });

  it('o spread da carência é somado ao indexador da carência', () => {
    const linhas = calculateLoan(
      params({
        gracePeriod: 2,
        graceFixedRateMonth: 0.5,
        firstInstallmentDate: new Date(Date.UTC(2024, 2, 14)),
        monthlyRateMap: serieBcb,
      }),
    );
    const carencia = linhas.filter((r) => r.isGrace);

    expect(carencia).toHaveLength(2);
    // 0,50% de spread de carência + 0,80% de CDI em jan/2024 = 1,30%
    // (a linha de carência não preenche effectivePctInPeriod — confere pelos juros)
    expect(carencia[0].interest).toBeCloseTo(40288 * 0.013, 2);
  });
});
