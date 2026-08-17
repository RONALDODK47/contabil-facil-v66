import { describe, expect, it } from 'vitest';
import { calculateLoan, type LoanParams } from '../loanCalculator';
import { coletarLancamentosDominio } from '../dominioExporter';

describe('calculateLoan - Monthly Adjustments (Unpaid Months & Extra Payments)', () => {
  const baseParams: LoanParams = {
    principal: 10000,
    months: 5,
    fixedRateMonth: 1.0,
    fixedRateType: 'percent',
    varRateMonth: 0,
    gracePeriod: 0,
    graceType: 'capitalized',
    system: 'PRICE',
    monthlyOperationCost: 0,
    monthlyOpCostType: 'percent',
    graceFixedRateMonth: 1.0,
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

  it('calcula o fluxo padrão sem ajustes quando monthlyAdjustments está vazio ou indefinido', () => {
    const schedule = calculateLoan(baseParams);
    expect(schedule.length).toBe(6); // Month 0 + 5 months
    expect(schedule[1]?.isUnpaid).toBeUndefined();
    expect(schedule[1]?.extraPayment).toBeUndefined();
    expect(schedule[5]?.finalBalance).toBe(0);
  });

  it('marca o Mês 2 como NÃO PAGO: zera parcela/amortização, saldo NÃO muda, parcela bruta vai para curto prazo', () => {
    const params: LoanParams = {
      ...baseParams,
      monthlyAdjustments: {
        2: { unpaid: true },
      },
    };

    const normalSchedule = calculateLoan(baseParams);
    const schedule = calculateLoan(params);
    const m2 = schedule[2]!;
    const m2Normal = normalSchedule[2]!;

    expect(m2.isUnpaid).toBe(true);
    expect(m2.installment).toBe(0);
    expect(m2.amortization).toBe(0);
    // Saldo final do Mês 2 NÃO muda (sem capitalização de juros)
    expect(m2.finalBalance).toBe(m2.initialBalance);
    // Juros continuam calculados normalmente (não mudam)
    expect(m2.interest).toBeCloseTo(m2Normal.interest, 1);
    // unpaidAmount registra a parcela bruta esperada
    expect(m2.unpaidAmount).toBeCloseTo(m2Normal.installment, 1);
  });

  it('NÃO PAGO no Mês 3: curto inalterado em todos os meses, parcela bruta soma ao longo prazo do mês não pago', () => {
    const params: LoanParams = {
      ...baseParams,
      monthlyAdjustments: {
        3: { unpaid: true },
      },
    };

    const normalSchedule = calculateLoan(baseParams);
    const schedule = calculateLoan(params);

    // Meses ANTERIORES: curto idêntico ao normal
    expect(schedule[1]!.shortTermBalance).toBeCloseTo(normalSchedule[1]!.shortTermBalance, 1);
    expect(schedule[2]!.shortTermBalance).toBeCloseTo(normalSchedule[2]!.shortTermBalance, 1);

    // Mês 3 (não pago): a parcela bruta é RECLASSIFICADA do curto para o longo prazo —
    // sai do curto (que não foi amortizado por pagamento) e entra no longo.
    const parcelaBruta = normalSchedule[3]!.installment;
    expect(schedule[3]!.unpaidAmount).toBeCloseTo(parcelaBruta, 1);
    expect(schedule[3]!.shortTermBalance).toBeCloseTo(normalSchedule[3]!.shortTermBalance, 1);
    expect(schedule[3]!.amortization).toBe(0);
    expect(schedule[3]!.installment).toBe(0);

    // Meses POSTERIORES: juros continuam sendo calculados
    expect(schedule[4]!.interest).toBeGreaterThan(0);
  });

  it('acumula o LP não pago em meses seguintes sem alterar o curto prazo', () => {
    const params: LoanParams = {
      ...baseParams,
      cpcPresentationMode: 'fiscal',
      monthlyAdjustments: {
        3: { unpaid: true },
      },
    };

    const normalSchedule = calculateLoan(baseParams);
    const schedule = calculateLoan(params);

    const scheduledRows = schedule.filter((row) => !row.isDelayedPayment && row.month >= 3);
    for (const row of scheduledRows) {
      expect(row.shortTermBalance).toBeCloseTo(normalSchedule[row.month]!.shortTermBalance, 1);
    }

    const delayedRows = schedule.filter((row) => row.isDelayedPayment);
    expect(delayedRows.length).toBe(0);
  });

  it('o ajuste de juros (positivo ou negativo) soma/subtrai juros e parcela bruta — mas nunca reclassifica curto/longo prazo', () => {
    const normalSchedule = calculateLoan(baseParams);

    const positivoParams: LoanParams = {
      ...baseParams,
      monthlyAdjustments: {
        3: { interestAdjustment: 120 },
      },
    };
    const positivoSchedule = calculateLoan(positivoParams);
    const positivoRow = positivoSchedule[3]!;
    const normalRow = normalSchedule[3]!;

    expect(positivoRow.interestAdjustment).toBe(120);
    expect(positivoRow.interest).toBeCloseTo(normalRow.interest + 120, 1);
    expect(positivoRow.installment).toBeCloseTo(normalRow.installment + 120, 1);
    expect(positivoRow.shortTermBalance).toBeCloseTo(normalRow.shortTermBalance, 1);

    const negativoParams: LoanParams = {
      ...baseParams,
      monthlyAdjustments: {
        3: { interestAdjustment: -120 },
      },
    };
    const negativoSchedule = calculateLoan(negativoParams);
    const negativoRow = negativoSchedule[3]!;

    expect(negativoRow.interestAdjustment).toBe(-120);
    expect(negativoRow.interest).toBeCloseTo(normalRow.interest - 120, 1);
    expect(negativoRow.installment).toBeCloseTo(normalRow.installment - 120, 1);
    expect(negativoRow.shortTermBalance).toBeCloseTo(normalRow.shortTermBalance, 1);

    const unpaidParams: LoanParams = {
      ...baseParams,
      monthlyAdjustments: {
        3: { interestAdjustment: 120, unpaid: true },
      },
    };
    const unpaidSchedule = calculateLoan(unpaidParams);
    const unpaidRow = unpaidSchedule[3]!;

    expect(unpaidRow.isUnpaid).toBe(true);
    expect(unpaidRow.shortTermBalance).toBeCloseTo(normalSchedule[3]!.shortTermBalance, 1);
  });

  it('aplica um PAGAMENTO EXTRA no Mês 3: reduz o saldo devedor e abate nas parcelas', () => {
    const params: LoanParams = {
      ...baseParams,
      monthlyAdjustments: {
        3: { extraPayment: 2000 },
      },
    };

    const normalSchedule = calculateLoan(baseParams);
    const adjustedSchedule = calculateLoan(params);

    const m3Normal = normalSchedule[3]!;
    const m3Adjusted = adjustedSchedule[3]!;

    expect(m3Adjusted.extraPayment).toBe(2000);
    expect(m3Adjusted.amortization).toBe(m3Normal.amortization + 2000);
    expect(m3Adjusted.installment).toBe(m3Normal.installment + 2000);
    expect(m3Adjusted.finalBalance).toBe(m3Normal.finalBalance - 2000);

    // No mês 4 os juros devem ser menores devido ao saldo reduzido
    const m4Normal = normalSchedule[4]!;
    const m4Adjusted = adjustedSchedule[4]!;
    expect(m4Adjusted.interest).toBeLessThan(m4Normal.interest);
  });

  it('aplica um ADIANTAMENTO no Mês 3: reduz saldo sem alterar a parcela do mês', () => {
    const params: LoanParams = {
      ...baseParams,
      monthlyAdjustments: {
        3: { prepaymentAmount: 1000 },
      },
    };

    const normalSchedule = calculateLoan(baseParams);
    const adjustedSchedule = calculateLoan(params);

    const m3Normal = normalSchedule[3]!;
    const m3Adjusted = adjustedSchedule[3]!;

    expect(m3Adjusted.prepaymentAmount).toBe(1000);
    expect(m3Adjusted.installment).toBe(m3Normal.installment);
    expect(m3Adjusted.finalBalance).toBe(m3Normal.finalBalance - 1000);

    const m4Normal = normalSchedule[4]!;
    const m4Adjusted = adjustedSchedule[4]!;
    expect(m4Adjusted.interest).toBeLessThan(m4Normal.interest);
  });

  it('marca o PAGAMENTO ATRASADO parcial e exporta LP→CP proporcional ao valor pago', () => {
    const params: LoanParams = {
      ...baseParams,
      monthlyAdjustments: {
        2: { unpaid: true, paymentAmount: 150 },
      },
    };

    const schedule = calculateLoan(params);
    const row2 = schedule[2]!;
    const expectedInstallment = schedule[2]!.expectedAmortization! + row2.interest + row2.monthlyCost;

    expect(row2.isUnpaid).toBe(true);
    expect(row2.paymentAmount).toBe(150);
    expect(row2.installment).toBe(0);
    expect(row2.unpaidAmount).toBeCloseTo(expectedInstallment, 1);

    const dominioConfig = {
      accJurosAproDebit: '300',
      accJurosAproCredit: '400',
      accApropriacaoDebit: '300',
      accApropriacaoCredit: '400',
      accTransferenciaDebit: '500',
      accTransferenciaCredit: '600',
      accEmprestimoDebit: '100',
      accEmprestimoCredit: '200',
      accNaoPagoDebit: '900',
      accNaoPagoCredit: '910',
      accAtrasadoPagoDebit: '920',
      accAtrasadoPagoCredit: '930',
    };

    const lancamentos = coletarLancamentosDominio(schedule, dominioConfig);
    const unpaidTransfer = lancamentos.find((l) => l.historico === 'PARCELA NAO PAGA - TRANSFERENCIA CP PARA LP' && l.value === parseFloat(expectedInstallment.toFixed(2)));
    const latePayment = lancamentos.find((l) => l.historico === 'PAGAMENTO ATRASADO - RETORNO LP PARA CP' && l.value === 150);

    expect(unpaidTransfer).toBeDefined();
    expect(latePayment).toBeDefined();
  });

  it('aplica ajuste de juros na carência capitalizada: aumenta o valor dos juros e o saldo incorporado', () => {
    const graceParams: LoanParams = {
      ...baseParams,
      gracePeriod: 2,
      graceType: 'capitalized',
      monthlyAdjustments: {
        1: { interestAdjustment: 50 },
      },
    };

    const normalSchedule = calculateLoan({ ...graceParams, monthlyAdjustments: {} });
    const adjustedSchedule = calculateLoan(graceParams);

    const g1Normal = normalSchedule[1]!;
    const g1Adjusted = adjustedSchedule[1]!;

    expect(g1Adjusted.isGrace).toBe(true);
    expect(g1Adjusted.interestAdjustment).toBe(50);
    expect(g1Adjusted.interest).toBeCloseTo(g1Normal.interest + 50, 2);
    expect(g1Adjusted.installment).toBe(0);
    expect(g1Adjusted.finalBalance).toBeCloseTo(g1Normal.finalBalance + 50, 2);
  });

  it('aplica ajuste de juros na carência paga: altera os juros e o valor da parcela paga sem mudar o saldo devedor', () => {
    const graceParams: LoanParams = {
      ...baseParams,
      gracePeriod: 2,
      graceType: 'paid',
      monthlyAdjustments: {
        1: { interestAdjustment: -30 },
      },
    };

    const normalSchedule = calculateLoan({ ...graceParams, monthlyAdjustments: {} });
    const adjustedSchedule = calculateLoan(graceParams);

    const g1Normal = normalSchedule[1]!;
    const g1Adjusted = adjustedSchedule[1]!;

    expect(g1Adjusted.isGrace).toBe(true);
    expect(g1Adjusted.effectivePctInPeriod).toBe(1.0);
    expect(g1Adjusted.interestAdjustment).toBe(-30);
    expect(g1Adjusted.interest).toBeCloseTo(g1Normal.interest - 30, 2);
    expect(g1Adjusted.installment).toBeCloseTo(g1Normal.installment - 30, 2);
    expect(g1Adjusted.finalBalance).toBeCloseTo(baseParams.principal, 2);
  });
});

