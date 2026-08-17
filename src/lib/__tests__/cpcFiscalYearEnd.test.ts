import { describe, it, expect } from 'vitest';
import { calculateLoan } from '../loanCalculator';
import type { LoanParams } from '../loanCalculator';
import { obterMaxMesCarencia } from '../cpcFiscalYearEnd';
import { coletarLancamentosDominio } from '../dominioExporter';

describe('CPC Fiscal Year End and Grace Period Reclassification', () => {
  it('correctly manages grace period, short term provisioning, and zeroes out in December', () => {
    // 1. Setup a loan with 9 months grace period, starting in June 2026 (Month 0 is June).
    // Grace period ends in March 2027 (9 months).
    // Amortizations start in April 2027 (Month 10).
    const params: LoanParams = {
      principal: 100000,
      months: 24, // 24 payments
      fixedRateMonth: 1,
      fixedRateType: 'percent',
      varRateMonth: 0,
      gracePeriod: 9,
      graceType: 'capitalized',
      system: 'SAC',
      monthlyOperationCost: 0,
      monthlyOpCostType: 'percent',
      graceFixedRateMonth: 1,
      graceFixedRateType: 'percent',
      graceMonthlyOperationCost: 0,
      graceMonthlyOpCostType: 'percent',
      proRataDieMode: 'linear',
      operationalCostDayBasis: 'commercial30',
      graceInterestRoundingMode: 'none',
      graceInterestDecimalPlaces: 2,
      contractDate: new Date(2026, 5, 15), // June 15, 2026
      firstInstallmentDate: new Date(2027, 3, 15), // April 15, 2027 (June + 9 + 1 = 10 months after June)
    };

    const schedule = calculateLoan(params);

    // Verify obterMaxMesCarencia returns 9
    expect(obterMaxMesCarencia(schedule)).toBe(9);

    // Month 6 is December 2026 (contract in June 2026, month 1 July, month 6 Dec).
    const decRow2026 = schedule.find((r) => r.isGrace && r.month === 6);
    expect(decRow2026).toBeDefined();
    expect(decRow2026?.date.getFullYear()).toBe(2026);
    expect(decRow2026?.date.getMonth()).toBe(11); // December

    // Check December 2026 (in grace period, not last month) has 0 short term
    expect(decRow2026?.shortTermBalance).toBe(0);
    expect(decRow2026?.longTermBalance).toBe(decRow2026?.finalBalance);

    // Month 9 is March 2027 (last month of grace period)
    const lastGraceRow = schedule.find((r) => r.isGrace && r.month === 9);
    expect(lastGraceRow).toBeDefined();
    expect(lastGraceRow?.date.getFullYear()).toBe(2027);
    expect(lastGraceRow?.date.getMonth()).toBe(2); // March

    // Last month of grace period must trigger reclassification from long to short term.
    // The short term should only provision remaining amortizations of the same calendar year 2027.
    // Remaining months in 2027 are April to December (9 payments: months 10 to 18).
    const amortRows2027 = schedule.filter(
      (r) => !r.isGrace && r.month > 9 && r.date.getFullYear() === 2027
    );
    expect(amortRows2027).toHaveLength(9);
    // Com carência capitalizada (SAC), a amortização por parcela usa o saldo pós-carência,
    // não o principal original — usa amortization diretamente.
    const expectedShortTermGraceEnd = amortRows2027[0].amortization * 9;

    expect(lastGraceRow?.shortTermBalance).toBeCloseTo(expectedShortTermGraceEnd, 2);

    // Month 18 is December 2027 (final balance of December 2027)
    // BEFORE reclassification (which is how the schedule calculates internally and is corrected in PDF),
    // wait, in the schedule itself, the December row contains the AFTER-reclassification value (provision for 2028).
    // Let's verify that the provision for 2028 is correct.
    const decRow2027 = schedule.find((r) => !r.isGrace && r.month === 18);
    expect(decRow2027).toBeDefined();
    expect(decRow2027?.date.getFullYear()).toBe(2027);
    expect(decRow2027?.date.getMonth()).toBe(11); // December

    // The provision in Dec 2027 should be the sum of amortizations in 2028 (January to December 2028).
    const amortRows2028 = schedule.filter(
      (r) => !r.isGrace && r.date.getFullYear() === 2028
    );
    expect(amortRows2028).toHaveLength(12);
    const expectedShortTermDec2027 = amortRows2028[0].amortization * 12;
    expect(decRow2027?.shortTermBalance).toBeCloseTo(expectedShortTermDec2027, 2);

    // Month 17 is November 2027 (penult month of the year)
    const novRow2027 = schedule.find((r) => !r.isGrace && r.month === 17);
    expect(novRow2027).toBeDefined();

    // Mês 10 (1º após a carência): o curto líquido provisionado reduz pela parcela líquida (amortização)
    const month10Row = schedule.find((r) => !r.isGrace && r.month === 10);
    expect(month10Row).toBeDefined();
    expect(month10Row?.shortTermBalance).toBeCloseTo(
      Math.max(0, (lastGraceRow?.shortTermBalance ?? 0) - (month10Row?.amortization ?? 0)),
      2
    );

    // Invariante geral: fora dos pontos de reprovisão (fechamento 31/12), a cada mês o curto líquido
    // reduz pela parcela líquida (amortização de referência).
    const linhasAmortizacao = schedule.filter((r) => !r.isGrace && r.month >= 10);
    for (let k = 1; k < linhasAmortizacao.length; k++) {
      const anterior = linhasAmortizacao[k - 1]!;
      const atual = linhasAmortizacao[k]!;
      if (atual.date.getMonth() === 11) continue; // fechamento 31/12: ponto de reprovisão
      if (atual.finalBalance <= 0.005) continue; // quitação: curto e longo zeram juntos

      const netAmort = atual.amortization;
      const amortizouPelaParcelaLiquida =
        Math.abs(atual.shortTermBalance - Math.max(0, anterior.shortTermBalance - netAmort)) < 0.02;
      const reclassificouLpParaCp =
        atual.shortTermBalance > anterior.shortTermBalance &&
        atual.longTermBalance < anterior.longTermBalance;
      expect(amortizouPelaParcelaLiquida || reclassificouLpParaCp).toBe(true);
    }

    // Ao final do contrato o passivo está totalmente quitado nas duas colunas.
    const ultimaLinha = schedule[schedule.length - 1]!;
    expect(ultimaLinha.finalBalance).toBeCloseTo(0, 2);
    expect(ultimaLinha.shortTermBalance).toBeCloseTo(0, 2);
    expect(ultimaLinha.longTermBalance).toBeCloseTo(0, 2);

    // Let's test the Domínio exporter logic:
    // It should NOT generate a LP->CP transfer in December 2026 (falls within grace period and not last month).
    // It SHOULD generate a LP->CP transfer in December 2027 (post grace period closing).
    const dominioConfig = {
      accJurosAproDebit: '300',
      accJurosAproCredit: '400',
      accApropriacaoDebit: '300',
      accApropriacaoCredit: '400',
      accTransferenciaDebit: '500',
      accTransferenciaCredit: '600',
      accEmprestimoDebit: '100',
      accEmprestimoCredit: '200',
    };
    const lancamentos = coletarLancamentosDominio(schedule, dominioConfig);
    const transferencias = lancamentos.filter(
      (l) => l.historico === 'TRANSFERENCIA DO LONGO PARA O CURTO PRAZO'
    );

    // No transfer in 2026 (since Dec 2026 is in grace period and not last month)
    const transfer2026 = transferencias.find((t) => t.date.getFullYear() === 2026);
    expect(transfer2026).toBeUndefined();

    // Transfer in 2027 (since Dec 2027 is the normal closing)
    const transfer2027 = transferencias.find((t) => t.date.getFullYear() === 2027);
    expect(transfer2027).toBeDefined();
  });
});
