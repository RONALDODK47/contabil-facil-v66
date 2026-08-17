/**
 * Testes do Sistema de Cálculo PRICE e SAC
 * Valida as fórmulas conforme especificação
 */

import { describe, it, expect } from 'vitest';
import { calculateLoan, type LoanParams } from '../loanCalculator';

describe('Cálculo de Cronogramas PRICE e SAC', () => {
  /**
   * Exemplo de teste: Empréstimo SAC
   * Principal: R$ 100.000
   * Prazo: 12 meses
   * Taxa: 1% a.m.
   * Sem carência
   * 
   * Fórmula SAC:
   * - Amortização: A = 100.000 / 12 = 8.333,33
   * - Juros: J_k = SD × (Taxa/100) × (Dias/30)
   * - Parcela: PMT = A + J
   */
  it('SAC: Calcula cronograma correto com amortização constante', () => {
    const params: LoanParams = {
      principal: 100_000,
      months: 12,
      fixedRateMonth: 1.0, // 1% a.m.
      fixedRateType: 'percent',
      contractDate: new Date('2026-01-01'),
      firstInstallmentDate: new Date('2026-02-01'),
      system: 'SAC',
      gracePeriod: 0,
      graceType: 'capitalized',
      varRateMonth: 0,
      monthlyOperationCost: 0,
      monthlyOpCostType: 'percent',
      graceFixedRateMonth: 0,
      graceFixedRateType: 'percent',
      graceMonthlyOperationCost: 0,
      graceMonthlyOpCostType: 'percent',
      proRataDieMode: 'linear',
      operationalCostDayBasis: 'commercial30',
      graceInterestRoundingMode: 'none',
      graceInterestDecimalPlaces: 2,
    };

    const schedule = calculateLoan(params);

    // Deve ter: linha 0 (contrato) + 12 parcelas = 13 linhas
    expect(schedule).toHaveLength(13);

    // Linha 0: Contrato
    expect(schedule[0].month).toBe(0);
    expect(schedule[0].initialBalance).toBe(100_000);
    expect(schedule[0].finalBalance).toBe(100_000);

    // Linha 1: Primeira parcela de amortização
    const row1 = schedule[1];
    expect(row1.month).toBe(1);
    expect(row1.initialBalance).toBe(100_000);
    
    // Juros padrão bancário: 100.000 × (1/100) = 1.000,00
    const expectedInterest1 = 100_000 * 0.01;
    expect(Math.abs(row1.interest - expectedInterest1)).toBeLessThan(0.1);

    // Amortização SAC: 100.000 / 12 = 8.333,33
    const expectedAmortization = 100_000 / 12;
    expect(Math.abs(row1.amortization - expectedAmortization)).toBeLessThan(0.01);

    // Parcela = Amortização + Juros
    const expectedInstallment1 = expectedAmortization + expectedInterest1;
    expect(Math.abs(row1.installment - expectedInstallment1)).toBeLessThan(0.1);

    // Saldo final = SD inicial - Amortização
    const expectedFinalBalance1 = 100_000 - expectedAmortization;
    expect(Math.abs(row1.finalBalance - expectedFinalBalance1)).toBeLessThan(0.01);

    // Última parcela (mês 12)
    const rowLast = schedule[12];
    expect(rowLast.month).toBe(12);
    expect(Math.abs(rowLast.finalBalance)).toBeLessThan(0.01); // Deve ser ~zero
  });

  /**
   * Exemplo PRICE: Tabela Price
   * Principal: R$ 100.000
   * Prazo: 12 meses
   * Taxa: 1% a.m.
   * Sem carência
   * 
   * Fórmula PRICE:
   * PMT = 100.000 × [ 0.01(1.01)^12 / ((1.01)^12 - 1) ] ≈ 8.885,30
   * A_k = PMT - J_k
   */
  it('PRICE: Calcula cronograma com parcela fixa', () => {
    const params: LoanParams = {
      principal: 100_000,
      months: 12,
      fixedRateMonth: 1.0, // 1% a.m.
      fixedRateType: 'percent',
      contractDate: new Date('2026-01-01'),
      firstInstallmentDate: new Date('2026-02-01'),
      system: 'PRICE',
      gracePeriod: 0,
      graceType: 'capitalized',
      varRateMonth: 0,
      monthlyOperationCost: 0,
      monthlyOpCostType: 'percent',
      graceFixedRateMonth: 0,
      graceFixedRateType: 'percent',
      graceMonthlyOperationCost: 0,
      graceMonthlyOpCostType: 'percent',
      proRataDieMode: 'linear',
      operationalCostDayBasis: 'commercial30',
      graceInterestRoundingMode: 'none',
      graceInterestDecimalPlaces: 2,
    };

    const schedule = calculateLoan(params);

    // Deve ter 13 linhas
    expect(schedule).toHaveLength(13);

    // Linha 1: Primeira parcela
    const row1 = schedule[1];
    expect(row1.month).toBe(1);
    expect(row1.initialBalance).toBe(100_000);

    // PMT ≈ 8.885,30
    // Validar que parcela é aproximadamente constante
    const installment1 = row1.installment;

    // Linha 2: Verificar parcela constante
    const row2 = schedule[2];
    expect(Math.abs(row2.installment - installment1)).toBeLessThan(1); // Dentro de R$ 1

    // Linha 12: Última parcela deve fechar o saldo
    const rowLast = schedule[12];
    expect(Math.abs(rowLast.finalBalance)).toBeLessThan(0.01);
  });

  /**
   * Teste de Segregação CPC
   * Valida que CP + LP = SD_Final
   */
  it('CPC: Segregação Curto/Longo Prazo está correta', () => {
    const params: LoanParams = {
      principal: 100_000,
      months: 24,
      fixedRateMonth: 1.0,
      fixedRateType: 'percent',
      contractDate: new Date('2026-01-01'),
      firstInstallmentDate: new Date('2026-02-01'),
      system: 'SAC',
      gracePeriod: 0,
      graceType: 'capitalized',
      varRateMonth: 0,
      monthlyOperationCost: 0,
      monthlyOpCostType: 'percent',
      graceFixedRateMonth: 0,
      graceFixedRateType: 'percent',
      graceMonthlyOperationCost: 0,
      graceMonthlyOpCostType: 'percent',
      proRataDieMode: 'linear',
      operationalCostDayBasis: 'commercial30',
      graceInterestRoundingMode: 'none',
      graceInterestDecimalPlaces: 2,
    };

    const schedule = calculateLoan(params);

    // Validar cada linha
    for (let i = 1; i < schedule.length; i++) {
      const row = schedule[i];

      // CP + LP deve estar próximo de SD_Final
      const sum = row.shortTermBalance + row.longTermBalance;
      expect(Math.abs(sum - row.finalBalance)).toBeLessThan(0.1);

      // CP não pode ser negativo
      expect(row.shortTermBalance).toBeGreaterThanOrEqual(0);

      // LP não pode ser negativo
      expect(row.longTermBalance).toBeGreaterThanOrEqual(0);
    }
  });

  /**
   * Teste com Carência Paga
   */
  it('Carência Paga: Saldo não capitaliza, apenas parcelas de juros', () => {
    const params: LoanParams = {
      principal: 100_000,
      months: 12,
      fixedRateMonth: 1.0,
      fixedRateType: 'percent',
      contractDate: new Date('2026-01-01'),
      firstInstallmentDate: new Date('2026-05-01'), // 4 meses após contrato
      system: 'SAC',
      gracePeriod: 4,
      graceType: 'paid', // Carência paga
      varRateMonth: 0,
      monthlyOperationCost: 0,
      monthlyOpCostType: 'percent',
      graceFixedRateMonth: 0,
      graceFixedRateType: 'percent',
      graceMonthlyOperationCost: 0,
      graceMonthlyOpCostType: 'percent',
      proRataDieMode: 'linear',
      operationalCostDayBasis: 'commercial30',
      graceInterestRoundingMode: 'none',
      graceInterestDecimalPlaces: 2,
    };

    const schedule = calculateLoan(params);

    // Linha 0: Contrato
    expect(schedule[0].finalBalance).toBe(100_000);

    // Linhas 1-4: Carência paga
    // Amortização = 0, Parcela = apenas juros
    for (let i = 1; i <= 4; i++) {
      const row = schedule[i];
      expect(row.isGrace).toBe(true);
      expect(row.amortization).toBe(0);
      expect(row.installment).toBeCloseTo(row.interest, 1); // Parcela ≈ Juros
      expect(row.finalBalance).toBe(100_000); // Saldo não muda
    }

    // Linhas 5+: Amortização inicia
    const row5 = schedule[5];
    expect(row5.isGrace).toBe(false);
    expect(row5.amortization).toBeGreaterThan(0);
  });

  /**
   * Teste com Carência Capitalizada
   */
  it('Carência Capitalizada: Saldo aumenta com juros capitalizados', () => {
    const params: LoanParams = {
      principal: 100_000,
      months: 12,
      fixedRateMonth: 1.5, // 1.5% a.m. — taxa maior para garantir capitalização visível
      fixedRateType: 'percent',
      contractDate: new Date('2026-01-01'),
      firstInstallmentDate: new Date('2026-04-01'), // 3 meses após contrato
      system: 'SAC',
      gracePeriod: 3,
      graceType: 'capitalized', // Carência capitalizada
      varRateMonth: 0,
      monthlyOperationCost: 0,
      monthlyOpCostType: 'percent',
      graceFixedRateMonth: 1.5,
      graceFixedRateType: 'percent',
      graceMonthlyOperationCost: 0,
      graceMonthlyOpCostType: 'percent',
      proRataDieMode: 'linear',
      operationalCostDayBasis: 'commercial30',
      graceInterestRoundingMode: 'none',
      graceInterestDecimalPlaces: 2,
    };

    const schedule = calculateLoan(params);

    // Linha 0: Contrato - 100.000
    expect(schedule[0].finalBalance).toBe(100_000);

    // Linhas 1-3: Carência capitalizada
    // Saldo aumenta com juros: 100.000 × 1.015 = 101.500, depois 101.500 × 1.015...
    let prevBalance = 100_000;
    for (let i = 1; i <= 3; i++) {
      const row = schedule[i];
      expect(row.isGrace).toBe(true);
      expect(row.amortization).toBe(0);
      expect(row.installment).toBe(0); // Sem parcela
      expect(row.finalBalance).toBeGreaterThan(prevBalance); // Saldo aumenta
      prevBalance = row.finalBalance;
    }

    // Linha 4: Começa amortização com saldo capitalizado
    const row4 = schedule[4];
    expect(row4.isGrace).toBe(false);
    expect(row4.initialBalance).toBeGreaterThan(100_000); // Saldo capitalizado
  });

  /**
   * Validação de Fórmula: Juros Padrão Bancário
   * J_k = SD × (Taxa_mensal / 100) — sem pro rata die
   */
  it('Fórmula de Juros: Valida cálculo J_k = SD × (i/100)', () => {
    const params: LoanParams = {
      principal: 10_000,
      months: 6,
      fixedRateMonth: 2.0, // 2% a.m.
      fixedRateType: 'percent',
      contractDate: new Date('2026-01-15'),
      firstInstallmentDate: new Date('2026-02-15'),
      system: 'SAC',
      gracePeriod: 0,
      graceType: 'capitalized',
      varRateMonth: 0,
      monthlyOperationCost: 0,
      monthlyOpCostType: 'percent',
      graceFixedRateMonth: 0,
      graceFixedRateType: 'percent',
      graceMonthlyOperationCost: 0,
      graceMonthlyOpCostType: 'percent',
      proRataDieMode: 'linear',
      operationalCostDayBasis: 'commercial30',
      graceInterestRoundingMode: 'none',
      graceInterestDecimalPlaces: 2,
    };

    const schedule = calculateLoan(params);
    const row1 = schedule[1];

    // J_1 = 10.000 × (2/100) = 200,00  (padrão bancário — sem pro rata die)
    const expectedInterest = 10_000 * 0.02;
    expect(Math.abs(row1.interest - expectedInterest)).toBeLessThan(0.1);
  });

  /**
   * Teste de consistência: SD_Final sempre diminui
   */
  it('Consistência: Saldo Devedor sempre diminui até zero', () => {
    const params: LoanParams = {
      principal: 50_000,
      months: 10,
      fixedRateMonth: 1.5,
      fixedRateType: 'percent',
      contractDate: new Date('2026-01-01'),
      firstInstallmentDate: new Date('2026-02-01'),
      system: 'PRICE',
      gracePeriod: 0,
      graceType: 'capitalized',
      varRateMonth: 0,
      monthlyOperationCost: 0,
      monthlyOpCostType: 'percent',
      graceFixedRateMonth: 0,
      graceFixedRateType: 'percent',
      graceMonthlyOperationCost: 0,
      graceMonthlyOpCostType: 'percent',
      proRataDieMode: 'linear',
      operationalCostDayBasis: 'commercial30',
      graceInterestRoundingMode: 'none',
      graceInterestDecimalPlaces: 2,
    };

    const schedule = calculateLoan(params);

    for (let i = 1; i < schedule.length; i++) {
      const prevBalance = schedule[i - 1].finalBalance;
      const currBalance = schedule[i].finalBalance;

      // Saldo deve diminuir ou manter-se (nunca aumentar)
      expect(currBalance).toBeLessThanOrEqual(prevBalance + 0.01); // +0.01 tolera arredondamento
    }

    // Última parcela deve fechar em ~zero
    const lastRow = schedule[schedule.length - 1];
    expect(Math.abs(lastRow.finalBalance)).toBeLessThan(0.01);
  });
});
