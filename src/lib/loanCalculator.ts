/**
 * SISTEMA DE CÁLCULO PRICE E SAC — PADRÃO BANCÁRIO BRASILEIRO
 *
 * Fórmulas conforme os bancos realmente calculam:
 *
 * PRICE (Tabela Price / Sistema Francês):
 *   PMT = PV × i × (1+i)^n / ((1+i)^n - 1)   ← calculado uma única vez com a taxa do contrato
 *   J_k  = SD_(k-1) × i                        ← juros sobre saldo devedor (sem pro rata die)
 *   A_k  = PMT - J_k                            ← amortização crescente
 *   SD_k = SD_(k-1) - A_k
 *
 * SAC (Sistema de Amortização Constante):
 *   A_k  = PV / n                               ← amortização constante
 *   J_k  = SD_(k-1) × i                        ← juros sobre saldo devedor
 *   PMT_k = A_k + J_k                           ← parcela decrescente
 *   SD_k = SD_(k-1) - A_k
 *
 * CPC: CP = Σ A_k (parcelas do mesmo ano civil); LP = SD - CP
 */

import { addMonths, differenceInCalendarDays, format } from 'date-fns';
import {
  resolvePeriodRateMemory,
  selicPointsToMap,
  type SelicDailyPoint,
  type VarIndexMode,
} from './selicOverIndex';

// Tipos mantidos da interface original
export type ProRataDieMode = 'linear' | 'compound';
export type SacInterestAccrual = 'proRataCorridos' | 'mensalContrato' | 'proRataMesCivil';
export type SacMoneyRoundingMode = 'halfAwayFromZero' | 'truncateCentavos';
export type GraceInterestRoundingMode = 'none' | 'halfAwayFromZero' | 'truncate' | 'floor' | 'ceil';
export type OperationalCostDayBasis = 'commercial30' | 'calendar365';
export type IofTreatmentMode = 'financed' | 'paid';
export type CpcPresentationMode = 'contabil' | 'fiscal';

export interface LoanParams {
  principal: number;
  valorIof?: number;
  iofMode?: IofTreatmentMode;
  months: number;
  fixedRateMonth: number;
  fixedRateType: 'percent' | 'value';
  varRateMonth: number;
  gracePeriod: number;
  graceType: 'capitalized' | 'paid';
  system: 'SAC' | 'PRICE';
  monthlyOperationCost: number;
  monthlyOpCostType: 'percent' | 'value';
  graceFixedRateMonth: number;
  graceFixedRateType: 'percent' | 'value';
  graceMonthlyOperationCost: number;
  graceMonthlyOpCostType: 'percent' | 'value';
  proRataDieMode: ProRataDieMode;
  operationalCostDayBasis: OperationalCostDayBasis;
  graceInterestRoundingMode: GraceInterestRoundingMode;
  graceInterestDecimalPlaces: number;
  contractDate: Date;
  firstInstallmentDate: Date;
  sacInterestAccrual?: SacInterestAccrual;
  sacMoneyRounding?: SacMoneyRoundingMode;
  priceInterestAccrual?: SacInterestAccrual;
  priceMoneyRounding?: SacMoneyRoundingMode;
  preserveInstallmentAfterCapitalizedGrace?: boolean;
  sacAmortizationBase?: 'incorporated' | 'contractPrincipal';
  preservePriceInstallmentAfterCapitalizedGrace?: boolean;
  cpcPresentationMode?: CpcPresentationMode;
  cpcRollingMonths?: number;
  varIndexMode?: any;
  selicDailySeries?: any[];
  selicOverAccrualMode?: any;
  monthlyRateMap?: Map<string, number> | null;
  monthlyIndexFallbackPct?: number;
  priceSelicAdjustment?: 'recalculo_pmt' | 'pmt_fixo';
  monthlyAdjustments?: MonthlyAdjustments;
}

export type MonthlyAdjustments = Record<number, MonthlyAdjustment>;

export interface MonthlyAdjustment {
  unpaid?: boolean;
  paymentAmount?: number;
  interestAdjustment?: number;
  extraPayment?: number;
  prepaymentAmount?: number;
}

export interface LoanRow {
  month: number;
  date: Date;
  fixedInstallmentReference?: number;
  accrualDays: number;
  referenceMonthDays: number;
  die30Factor: number;
  opCostPeriodFactor: number;
  initialBalance: number;
  interest: number;
  amortization: number;
  monthlyCost: number;
  iof: number;
  installment: number;
  finalBalance: number;
  shortTermBalance: number;
  longTermBalance: number;
  cpcShortTermWindowMonths: number[];
  cpcShortTermWindowDescribe: string;
  isGrace: boolean;
  selicAccumulatedFactor?: number;
  selicBusinessDays?: number;
  spreadPctInPeriod?: number;
  selicPctInPeriod?: number;
  effectivePctInPeriod?: number;
  pricePmtRecalculated?: boolean;
  isUnpaid?: boolean;
  unpaidAmount?: number;
  expectedAmortization?: number;
  paymentAmount?: number;
  interestAdjustment?: number;
  extraPayment?: number;
  prepaymentAmount?: number;
  isDelayedPayment?: boolean;
  /**
   * LP congelado antes da reclassificação de fim de ano.
   * Presente apenas nas linhas de dezembro que disparam reclassificação.
   * Permite à camada de exibição mostrar o valor pré-reclas separado do pós-reclas.
   */
  longTermBalanceBeforeReclas?: number;
  /** Parcela além do prazo original, gerada por inadimplência não quitada */
  isOverdue?: boolean;
  overdueInstallmentNumber?: number;
  competenceDate?: Date;
  accrualStartDate?: Date;
  jurosApropriar?: number; // mantido por compatibilidade — não exibido na tabela
}

/**
 * Calcula cronograma com SELIC/CDI do Banco Central
 * Integra automaticamente com taxas reais do BCB por período
 */
export function calculateLoan(params: LoanParams): LoanRow[] {
  const {
    principal,
    months,
    contractDate,
    firstInstallmentDate,
    system,
    gracePeriod: gracePeriodMonths = 0,
    graceType: graceTypeParam = 'capitalized',
    monthlyRateMap, // Taxa SELIC/CDI por mês do Banco Central (yyyy-MM → %)
    monthlyIndexFallbackPct = 0.5, // Fallback: 0.5% a.m. se não houver dado BCB
    priceSelicAdjustment = 'recalculo_pmt', // PRICE indexado: recalcula PMT a cada competência
    sacInterestAccrual = 'mensalContrato', // SAC: modo de juros (mensal ou pro-rata dias corridos/30)
  } = params;

  // graceType só é válido quando há período de carência. Sem carência, força 'paid'
  // para garantir que nenhum juro seja capitalizado na fase de amortização.
  const graceType = gracePeriodMonths > 0 ? graceTypeParam : 'paid';

  if (principal <= 0 || months <= 0) {
    return [];
  }

  const schedule: LoanRow[] = [];
  let currentBalance = principal;
  let accrualStartDate = contractDate;


  // ========== Funções Auxiliares ==========

  /** Mapa yyyy-MM-dd → taxa diária (série 11 BCB) para PRONAMPE. */
  const selicByDate =
    params.varIndexMode === 'selic_over_diaria' && params.selicDailySeries?.length
      ? selicPointsToMap(params.selicDailySeries as SelicDailyPoint[])
      : null;

  const varIndexMode: VarIndexMode =
    (params.varIndexMode as VarIndexMode | undefined) ?? 'none';

  /**
   * Obtém taxa do spread (% a.m.) do contrato para o período.
   * Para CDI/SELIC/PRONAMPE, este valor é o spread sobre o indexador BCB.
   */
  const getFixedRatePct = (isGrace: boolean): number => {
    if (isGrace && params.graceFixedRateType && params.graceFixedRateMonth !== undefined) {
      return params.graceFixedRateType === 'value'
        ? (params.graceFixedRateMonth / principal) * 100
        : params.graceFixedRateMonth;
    }
    return params.fixedRateType === 'value'
      ? (params.fixedRateMonth / principal) * 100
      : params.fixedRateMonth;
  };

  /**
   * Taxa efetiva do período em % — via resolvePeriodRateMemory para CDI/SELIC/PRONAMPE,
   * ou soma direta spread+índice para modos legados.
   *
   * PRONAMPE: acumula fatores diários da série 11 BCB entre [accrualStart, accrualEnd].
   * CDI/SELIC mensal: composição multiplicativa (1+spread)*(1+índice)-1, com proRataDie.
   * Legado (none/custom): spread + varRateMonth (soma direta, comportamento anterior).
   */
  const getTaxaForPeriod = (
    date: Date,
    isGrace = false,
    accrualStart?: Date,
  ): number => {
    const spreadPct =
      params.fixedRateMonth !== undefined && params.fixedRateType
        ? getFixedRatePct(isGrace)
        : 0;

    const usesIndexador =
      varIndexMode === 'selic_over_diaria' ||
      varIndexMode === 'cdi_mensal' ||
      varIndexMode === 'selic_mensal';

    if (usesIndexador) {
      const accrualStartResolved = accrualStart ?? contractDate;
      const days = differenceInCalendarDays(date, accrualStartResolved);
      const temporalFactor = days > 0 ? days / 30 : 1;
      const mem = resolvePeriodRateMemory({
        spreadMonthPct: spreadPct,
        varRateMonthPct: params.varRateMonth ?? 0,
        varIndexMode,
        temporalFactor,
        proRataDieMode: params.proRataDieMode ?? 'linear',
        selicByDate,
        monthlyRateMap: monthlyRateMap ?? null,
        monthlyIndexFallbackPct,
        accrualStart: accrualStartResolved,
        accrualEnd: date,
        selicOverAccrualMode: params.selicOverAccrualMode,
      });
      return mem.rateDecimal * 100;
    }

    // Legado / custom: soma direta spread + índice
    let indexPct: number | undefined;
    if (monthlyRateMap) {
      indexPct = monthlyRateMap.get(format(date, 'yyyy-MM'));
    }
    indexPct ??= params.varRateMonth;
    indexPct ??= monthlyIndexFallbackPct;

    return spreadPct + (indexPct ?? 0);
  };

  /**
   * Calcula juros conforme modo de acumulação do contrato:
   * - 'mensalContrato': J_k = SD × (taxa / 100)  — taxa mensal plana
   * - 'proRataCorridos': J_k = SD × (taxa / 100) × (dias / 30)  — pro rata dias corridos / 30
   */
  function calculateInterest(sd: number, ratePct: number, days?: number): number {
    if (system === 'SAC' && sacInterestAccrual === 'proRataCorridos' && days !== undefined) {
      return sd * (ratePct / 100) * (days / 30);
    }
    return sd * (ratePct / 100);
  }

  /**
   * Calcula dias corridos entre datas (mantido para campos de exibição)
   */
  function getDaysBetween(startDate: Date, endDate: Date): number {
    return Math.max(0, differenceInCalendarDays(endDate, startDate));
  }

  /**
   * Arredonda para 2 casas decimais (centavos)
   */
  function roundCentavos(value: number): number {
    return Math.round(value * 100) / 100;
  }

  // ========== Helper: Curto Prazo via Ano Civil ==========
  /**
   * Calcula o Curto Prazo como a soma das amortizações líquidas constantes
   * (amortBase / meses) dos meses FUTUROS que caem no mesmo ANO CIVIL de refDate.
   *
   * Se não houver meses futuros no mesmo ano (Dezembro ou último mês do ano),
   * provisiona automaticamente os meses do ANO SEGUINTE (reclassificação anual).
   *
   * @param paidAmortMonths - Número do mês de amortização já pago (antes da atual)
   * @param refDate         - Data de referência para determinar o ano civil
   * @param remainingBalance - Saldo devedor remanescente (CP nunca excede este valor)
   * @param amortBase       - Saldo base para cálculo da amortização líquida por parcela.
   *                          Padrão: principal original. Passar saldo pós-carência quando
   *                          houver carência capitalizada, para que CP/LP reflitam o saldo real.
   */
  function computeShortTerm(
    paidAmortMonths: number,
    refDate: Date,
    remainingBalance?: number,
    amortBase?: number,
  ): { shortTermBalance: number; cpcMonths: number[]; targetYear: number } {
    // Usa amortBase quando fornecido (saldo pós-carência no SAC capitalizado),
    // senão usa amortizationSacBase quando > 0 (SAC com saldo real), senão principal.
    // Para PRICE, amortizationSacBase = 0 — usa principal para calcular CP por ano civil.
    const liqAmort = roundCentavos((amortBase ?? (amortizationSacBase || principal)) / months);
    let st = 0;
    const cpcM: number[] = [];
    let targetYear = refDate.getUTCFullYear();

    // 1º: tentar provisionar meses do mesmo ano civil da refDate
    for (let futureM = paidAmortMonths + 1; futureM <= months; futureM++) {
      const fd = addMonths(firstInstallmentDate, futureM - 1);
      if (fd.getUTCFullYear() === targetYear) {
        st += liqAmort;
        cpcM.push(gracePeriodMonths + futureM);
      } else {
        break; // mêses são sequenciais, ao sair do ano, parar
      }
    }

    // 2º: se não houver meses no ano corrente, provisionar o próximo ano (até 12 meses)
    if (st < 0.005) {
      targetYear = targetYear + 1;
      let countNextYear = 0;
      for (let futureM = paidAmortMonths + 1; futureM <= months && countNextYear < 12; futureM++) {
        const fd = addMonths(firstInstallmentDate, futureM - 1);
        if (fd.getUTCFullYear() === targetYear) {
          st += liqAmort;
          cpcM.push(gracePeriodMonths + futureM);
          countNextYear++;
        } else if (fd.getUTCFullYear() > targetYear) {
          break;
        }
      }
    }

    // CP nunca pode exceder o saldo devedor remanescente.
    // Quando todos os meses restantes caem no mesmo período (CP cobre praticamente todo
    // o saldo), usa o saldo real como CP para eliminar resíduos de arredondamento de centavo.
    if (remainingBalance !== undefined) {
      const rem = Math.max(0, remainingBalance);
      // Se o CP acumulado é ≥ saldo real, ou está dentro de R$ 1,00 de diferença
      // (resíduo de roundCentavos sobre N parcelas), usa o saldo real diretamente.
      if (st >= rem || (rem > 0 && rem - st < 1.0)) {
        st = rem;
      } else {
        st = Math.min(st, rem);
      }
    }

    return { shortTermBalance: roundCentavos(st), cpcMonths: cpcM, targetYear };
  }

  // ========== Cálculos Preliminares ==========

  // Saldo base para amortização SAC:
  // - 'contractPrincipal': A = principal / n (padrão Bradesco — amortização sobre o principal original)
  // - 'incorporated' (padrão): A = saldo_pós_carência / n (parcelas quitem o saldo inflado)
  const amortizationSacBase = (() => {
    if (system !== 'SAC') return 0;
    if (params.sacAmortizationBase === 'contractPrincipal') return principal;
    if (gracePeriodMonths === 0 || graceType !== 'capitalized') return principal;
    let bal = principal;
    for (let g = 1; g <= gracePeriodMonths; g++) {
      const r = params.graceFixedRateMonth > 0
        ? params.graceFixedRateMonth / 100
        : params.fixedRateMonth / 100;
      bal = bal + bal * r;
    }
    return Math.round(bal * 100) / 100;
  })();
  const amortizationSac = system === 'SAC' ? amortizationSacBase / months : 0;

  // Para PRICE: PMT calculado UMA VEZ com a taxa contratual fixa (padrão bancário)
  // PMT = PV × i × (1+i)^n / ((1+i)^n - 1)
  let pricePayment = 0;
  if (system === 'PRICE') {
    const contractRate = getFixedRatePct(false) / 100; // taxa mensal do contrato
    if (contractRate > 0) {
      const pow = Math.pow(1 + contractRate, months);
      pricePayment = (principal * contractRate * pow) / (pow - 1);
    } else {
      pricePayment = principal / months;
    }
  }

  // Mapa de LP congelado por ano: <year> → LP value (fica fixo durante o ano)
  const frozenLongTermByYear = new Map<number, number>();

  // ========== Linha 0: Contrato ==========
  // Quando há carência, todo o saldo fica em LP na data do contrato.
  // A reclassificação para CP ocorre apenas no último mês de carência (g === gracePeriodMonths).
  // Quando não há carência, calcular CP/LP normalmente pelo ano civil.
  let initST: number;
  let initLT: number;
  let initCpcMonths: number[];
  let initYear: number;
  if (gracePeriodMonths > 0) {
    initST = 0;
    initLT = roundCentavos(principal);
    initCpcMonths = [];
    initYear = contractDate.getUTCFullYear();
    // Não congela LP agora — será congelado no último mês de carência com o saldo real.
  } else {
    // Sem carência: CP inicial = amortizações do primeiro ano civil
    const r = computeShortTerm(0, contractDate, principal);
    initST = r.shortTermBalance;
    initCpcMonths = r.cpcMonths;
    initYear = r.targetYear;
    initLT = roundCentavos(Math.max(0, principal - initST));
    frozenLongTermByYear.set(initYear, initLT);
  }

  schedule.push({
    month: 0,
    date: contractDate,
    accrualDays: 0,
    referenceMonthDays: 0,
    die30Factor: 0,
    opCostPeriodFactor: 0,
    initialBalance: principal,
    interest: 0,
    amortization: 0,
    monthlyCost: 0,
    iof: 0,
    installment: 0,
    finalBalance: principal,
    shortTermBalance: initST,
    longTermBalance: initLT,
    cpcShortTermWindowMonths: initCpcMonths,
    cpcShortTermWindowDescribe: initCpcMonths.length > 0
      ? `Parcelas do ${initYear === contractDate.getUTCFullYear() ? '1º ano' : `ano ${initYear}`}: M${initCpcMonths.join(', M')}`
      : '—',
    isGrace: false,
  });

  // ========== Fase de Carência ==========
  for (let g = 1; g <= gracePeriodMonths; g++) {
    const rowDate = addMonths(contractDate, g);
    const periodStartDate = accrualStartDate;
    const periodEndDate = rowDate;
    const days = getDaysBetween(periodStartDate, periodEndDate);
    const rate = getTaxaForPeriod(rowDate, true, periodStartDate); // Taxa do período de carência

    const initialBalance = currentBalance;
    // Juros: mensal plano ou pro rata dias corridos/30 conforme sacInterestAccrual
    const baseInterest = calculateInterest(initialBalance, rate, days);

    // ========== Ajuste de Juros na Carência ==========
    // monthlyAdjustments[g] corresponde ao mês de carência g (1-indexed).
    const graceMonthAdj = params.monthlyAdjustments?.[g];
    const graceInterestAdj = graceMonthAdj?.interestAdjustment ?? 0;
    const interest = baseInterest + graceInterestAdj;

    let installment = 0;
    if (graceType === 'paid') {
      installment = interest;
    } else {
      currentBalance = currentBalance + interest;
    }

    let graceShortTerm = 0;
    let graceLongTerm = roundCentavos(currentBalance);
    let graceCpcMonths: number[] = [];
    let graceTargetYear = rowDate.getUTCFullYear();
    // No último mês de carência: provisionar CP igual ao início da amortização
    if (g === gracePeriodMonths) {
      const { shortTermBalance: gst, cpcMonths: gcpc, targetYear: gty } = computeShortTerm(0, rowDate);
      graceShortTerm = gst;
      graceLongTerm = roundCentavos(Math.max(0, currentBalance - graceShortTerm));
      graceCpcMonths = gcpc;
      graceTargetYear = gty;
      // Congelar LP para o ano da amortização — sempre sobrescreve para que o valor
      // pós-capitalização (saldo maior) prevaleça sobre qualquer valor inicial congelado.
      frozenLongTermByYear.set(gty, graceLongTerm);
    } else if (graceType === 'capitalized') {
      // Carência capitalizada: o saldo devedor cresce a cada mês com os juros incorporados.
      // CP = 0 (ainda não há amortizações previstas dentro da carência),
      // LP = saldo devedor corrente (já inclui os juros capitalizados até aqui).
      graceLongTerm = roundCentavos(currentBalance);
    } else {
      // Carência paga: saldo não cresce — usa LP congelado do contrato se disponível.
      const rowYear = rowDate.getUTCFullYear();
      if (frozenLongTermByYear.has(rowYear)) {
        graceLongTerm = frozenLongTermByYear.get(rowYear)!;
      }
    }

    const graceRow: LoanRow = {
      month: g,
      date: rowDate,
      accrualDays: days,
      referenceMonthDays: 30,
      die30Factor: days / 30,
      opCostPeriodFactor: 0,
      initialBalance,
      interest: roundCentavos(interest),
      amortization: 0,
      monthlyCost: 0,
      iof: 0,
      installment: roundCentavos(installment),
      finalBalance: roundCentavos(currentBalance),
      shortTermBalance: graceShortTerm,
      longTermBalance: graceLongTerm,
      cpcShortTermWindowMonths: graceCpcMonths,
      cpcShortTermWindowDescribe: graceCpcMonths.length > 0
        ? `Carência — parcelas do ano ${graceTargetYear}: M${graceCpcMonths.join(', M')}`
        : '—',
      isGrace: true,
      effectivePctInPeriod: rate,
      ...(graceInterestAdj !== 0 ? { interestAdjustment: graceInterestAdj } : {}),
    };

    schedule.push(graceRow);
    accrualStartDate = periodEndDate;
  }

  // ========== Fase de Amortização ==========
  // Rastreia o LP da última linha do schedule para uso no cálculo de parcela não paga.
  let prevLongTermBalance: number = schedule.length > 0 ? schedule[schedule.length - 1].longTermBalance : 0;

  for (let m = 1; m <= months; m++) {
    // Se saldo já quitado, parar cálculo (vai adicionar linhas vazias depois)
    if (currentBalance <= 0.005 && m > 1) {
      break;
    }

    const rowDate = addMonths(firstInstallmentDate, m - 1);
    const periodStartDate = accrualStartDate;
    const periodEndDate = rowDate;
    const days = getDaysBetween(periodStartDate, periodEndDate);
    const rate = getTaxaForPeriod(rowDate, false, periodStartDate); // Taxa do período

    const initialBalance = currentBalance;

    // J_k = SD_(k-1) × taxa_mensal  (mensal plano ou pro rata dias/30 conforme sacInterestAccrual)
    const interest = calculateInterest(initialBalance, rate, days);

    // Verificar antecipadamente se este mês é marcado como não pago.
    // Quando for, amortização = 0 e o saldo NÃO diminui — o cálculo normal de
    // amortização é ignorado. Só os juros são calculados (para exibição).
    const monthAdjKey = gracePeriodMonths + m;
    const isThisMonthUnpaid = !!(params.monthlyAdjustments?.[monthAdjKey]?.unpaid);

    let amortization: number;
    let installment: number;

    if (isThisMonthUnpaid) {
      // Parcela não paga: sem amortização, sem pagamento — saldo fica intacto.
      amortization = 0;
      installment = 0;
      currentBalance = initialBalance; // saldo não muda
    } else if (system === 'SAC') {
      // SAC: A_k = principal / n (constante — padrão bancário)
      amortization = amortizationSac;
      installment = amortization + interest;

      // Verificar se a parcela calculada ultrapassaria o saldo devedor.
      const forceFinalQuitacao =
        amortization > initialBalance ||
        m === months;
      if (forceFinalQuitacao) {
        amortization = roundCentavos(initialBalance);
        installment = roundCentavos(amortization + interest);
      }

      currentBalance = roundCentavos(initialBalance - amortization);
    } else if (priceSelicAdjustment === 'recalculo_pmt') {
      // PRICE indexado (CDI/SELIC + spread): a PMT é recalculada a cada competência
      // com a taxa vigente e o prazo remanescente.
      const i = rate / 100;
      const remaining = months - m + 1;
      if (i > 0 && remaining > 0) {
        const pow = Math.pow(1 + i, remaining);
        installment = (initialBalance * i * pow) / (pow - 1);
      } else {
        installment = remaining > 0 ? initialBalance / remaining : initialBalance;
      }
      amortization = Math.max(0, installment - interest);

      const forceFinalQuitacao = amortization > initialBalance || m === months;
      if (forceFinalQuitacao) {
        amortization = roundCentavos(initialBalance);
        installment = roundCentavos(amortization + interest);
      }

      currentBalance = roundCentavos(initialBalance - amortization);
    } else {
      // PRICE com PMT fixa da 1ª competência: A_k = PMT - J_k
      // No PRICE fixo a última parcela NÃO é forçada (mantém PMT uniforme).
      installment = pricePayment;
      amortization = Math.max(0, installment - interest);

      if (amortization > initialBalance) {
        amortization = roundCentavos(initialBalance);
        installment = roundCentavos(amortization + interest);
      }

      currentBalance = roundCentavos(initialBalance - amortization);
    }

    // ========== SEGREGAÇÃO CPC POR ANO CIVIL ==========
    // CP = soma das amortizações líquidas (principal/meses) dos meses futuros
    // no mesmo ano civil. Ao virar o ano provisiona o próximo.
    const { shortTermBalance: stRaw, cpcMonths, targetYear } = computeShortTerm(m, rowDate, currentBalance);
    const rowYear = rowDate.getUTCFullYear();

    // Na última parcela SAC com saldo residual (carência capitalizada): todo o saldo
    // restante passa para CP — é a última obrigação, vence no período imediato.
    const isLastSacWithResidue = system === 'SAC' && m === months && currentBalance > 0.005;
    const shortTermBalance = isLastSacWithResidue ? currentBalance : stRaw;

    // Verificar se há inadimplência ativa neste mês (parcela não paga sem quitação)
    const hasActiveUnpaid = Object.entries(params.monthlyAdjustments ?? {}).some(([k, adj]) => {
      const mn = Number(k);
      return adj.unpaid &&
        !(adj.paymentAmount && adj.paymentAmount > 0) &&
        mn <= gracePeriodMonths + m;
    });

    // Quando uma parcela é marcada como não paga, forçar atualização do LP congelado.
    // O LP correto = LP_anterior + amortização_não_realizada (a parcela que não saiu do LP).
    // Não podemos usar currentBalance inteiro pois parte já era CP.
    // O cálculo de normalAmort é feito depois (bloco de ajustes mensais), por isso
    // usamos prevLongTermBalance + amortizationSac / recalculado mais abaixo.
    // Por ora, apenas marcamos; o valor real é aplicado em amortRow.longTermBalance abaixo.

    // Saldo quitado: LP = 0.
    // Enquanto houver inadimplência ativa, LP nunca pode zerar por causa do CP
    // — o valor congelado prevalece sobre a condição shortTermBalance >= currentBalance.
    let longTermBalance: number;
    if (currentBalance <= 0) {
      longTermBalance = 0;
    } else if (!hasActiveUnpaid && shortTermBalance >= currentBalance) {
      longTermBalance = 0;
    } else {
      // LP congelado durante o ano (inclui o valor atualizado pela inadimplência acima).
      longTermBalance = frozenLongTermByYear.get(rowYear) ?? roundCentavos(Math.max(0, currentBalance - shortTermBalance));
    }

    // Detectar reclassificação: último dia de dezembro ou último mês do empréstimo em dezembro
    const isYearEndReclassification = rowDate.getUTCMonth() === 11 &&
      (m === months || (m < months && addMonths(firstInstallmentDate, m).getUTCMonth() !== 11));

    // LP pré-reclas: capturar antes de sobrescrever com o valor do próximo ano.
    let preReclasLT: number | undefined;

    if (isYearEndReclassification) {
      preReclasLT = longTermBalance;
      // Reclassificação: recalcular LP para o próximo ano com base no LP corrente.
      // Quando há inadimplência ativa, o LP corrente já reflete o saldo inflado
      // (frozenLT congelado no mês do não-pago). O próximo LP = LP_atual − CP,
      // garantindo que 62.310,07 − 18.703,80 = 43.606,27 (e não currentBalance − CP).
      const reclasBase = hasActiveUnpaid ? longTermBalance : currentBalance;
      const nextYearLT = shortTermBalance >= reclasBase
        ? 0
        : roundCentavos(Math.max(0, reclasBase - shortTermBalance));
      frozenLongTermByYear.set(targetYear, nextYearLT);
      longTermBalance = nextYearLT;
    }

    const amortRow: LoanRow = {
      month: gracePeriodMonths + m,
      date: rowDate,
      fixedInstallmentReference: roundCentavos(principal / months),
      accrualDays: days,
      referenceMonthDays: 30,
      die30Factor: days / 30,
      opCostPeriodFactor: 0,
      initialBalance: roundCentavos(initialBalance),
      interest: roundCentavos(interest),
      amortization: roundCentavos(amortization),
      monthlyCost: 0,
      iof: 0,
      installment: roundCentavos(installment),
      finalBalance: currentBalance,
      shortTermBalance,
      longTermBalance,
      longTermBalanceBeforeReclas: preReclasLT,
      cpcShortTermWindowMonths: cpcMonths,
      cpcShortTermWindowDescribe:
        cpcMonths.length > 0
          ? `Parcelas do mesmo ano (${targetYear}): M${cpcMonths.join(', M')}`
          : `Sem parcelas em ${targetYear}`,
      isGrace: false,
      effectivePctInPeriod: rate,
    };

    // ========== Aplicar Ajustes Mensais ==========
    const monthAdj = params.monthlyAdjustments?.[amortRow.month];
    if (monthAdj) {
      if (monthAdj.unpaid) {
        // Amortização já foi zerada antecipadamente no topo do loop.
        // Registrar metadados da inadimplência para exibição na tabela.
        amortRow.isUnpaid = true;
        // unpaidAmount = o que seria a parcela normal (sem inadimplência)
        const normalAmort = system === 'SAC' ? amortizationSac
          : priceSelicAdjustment === 'recalculo_pmt'
            ? (() => {
                const i = rate / 100;
                const rem = months - m + 1;
                const pmt = i > 0 && rem > 0
                  ? (initialBalance * i * Math.pow(1 + i, rem)) / (Math.pow(1 + i, rem) - 1)
                  : rem > 0 ? initialBalance / rem : initialBalance;
                return Math.max(0, pmt - interest);
              })()
            : Math.max(0, pricePayment - interest);
        const normalInstallment = roundCentavos(normalAmort + interest);
        amortRow.expectedAmortization = roundCentavos(normalAmort);
        amortRow.unpaidAmount = normalInstallment;
        // LP correto = LP_anterior + amortização_não_realizada.
        // A parcela que não foi paga incluía uma amortização que deveria ter saído do LP;
        // como não saiu, o LP cresce exatamente pelo valor de normalAmort (não pelo saldo total).
        const correctLT = roundCentavos(prevLongTermBalance + roundCentavos(normalAmort));
        amortRow.longTermBalance = correctLT;
        // Congelar LP atualizado para os meses seguintes do mesmo ano.
        frozenLongTermByYear.set(rowYear, correctLT);

        if (monthAdj.interestAdjustment) {
          amortRow.interestAdjustment = monthAdj.interestAdjustment;
        }

        // ── Pagamento atrasado: abate o saldo e gera linha LP→CP ──
        if (monthAdj.paymentAmount && monthAdj.paymentAmount > 0) {
          amortRow.paymentAmount = monthAdj.paymentAmount;

          // Valor efetivamente amortizado (limitado ao saldo para não ir negativo)
          const paidAmort = roundCentavos(Math.min(monthAdj.paymentAmount, currentBalance));
          currentBalance = roundCentavos(currentBalance - paidAmort);

          // Linha extra: registo do pagamento atrasado — reclassifica LP→CP
          schedule.push(amortRow);
          accrualStartDate = periodEndDate;

          const delayedRow: LoanRow = {
            month: amortRow.month,
            date: amortRow.date,
            fixedInstallmentReference: 0,
            accrualDays: 0,
            referenceMonthDays: 30,
            die30Factor: 0,
            opCostPeriodFactor: 0,
            initialBalance: roundCentavos(currentBalance + paidAmort),
            interest: 0,
            amortization: paidAmort,
            monthlyCost: 0,
            iof: 0,
            installment: monthAdj.paymentAmount,
            finalBalance: currentBalance,
            // LP→CP: o valor pago sai do LP; o restante permanece em LP
            shortTermBalance: paidAmort,
            longTermBalance: roundCentavos(Math.max(0, currentBalance)),
            cpcShortTermWindowMonths: [],
            cpcShortTermWindowDescribe: '—',
            isGrace: false,
            effectivePctInPeriod: 0,
            isDelayedPayment: true,
          };
          schedule.push(delayedRow);
          accrualStartDate = periodEndDate;
          continue;
        }
      } else {
        if (monthAdj.extraPayment && monthAdj.extraPayment > 0) {
          amortRow.extraPayment = monthAdj.extraPayment;
          amortRow.amortization = roundCentavos(amortRow.amortization + monthAdj.extraPayment);
          amortRow.installment = roundCentavos(amortRow.installment + monthAdj.extraPayment);
          currentBalance = roundCentavos(currentBalance - monthAdj.extraPayment);
          amortRow.finalBalance = currentBalance;
        }

        if (monthAdj.prepaymentAmount && monthAdj.prepaymentAmount > 0) {
          amortRow.prepaymentAmount = monthAdj.prepaymentAmount;
          currentBalance = roundCentavos(currentBalance - monthAdj.prepaymentAmount);
          amortRow.finalBalance = currentBalance;
        }

        if (monthAdj.interestAdjustment) {
          amortRow.interestAdjustment = monthAdj.interestAdjustment;
          amortRow.interest = roundCentavos(amortRow.interest + monthAdj.interestAdjustment);
          amortRow.installment = roundCentavos(amortRow.installment + monthAdj.interestAdjustment);
        }
      }
    }

    schedule.push(amortRow);
    prevLongTermBalance = amortRow.longTermBalance;
    accrualStartDate = periodEndDate;
  }

  // Se o empréstimo quitou antes de `months` (pagamento extra / antecipação),
  // preencher as competências restantes com saldo zero — a tabela sempre exibe
  // todas as `months` parcelas contratadas.
  // schedule = 1 linha de contrato + gracePeriodMonths + N linhas de amortização
  if (schedule.length < 1 + gracePeriodMonths + months) {
    for (let m = schedule.length - gracePeriodMonths; m <= months; m++) {
      const rowDate = addMonths(firstInstallmentDate, m - 1);
      const remainingRow: LoanRow = {
        month: gracePeriodMonths + m,
        date: rowDate,
        fixedInstallmentReference: 0,
        accrualDays: 0,
        referenceMonthDays: 30,
        die30Factor: 0,
        opCostPeriodFactor: 0,
        initialBalance: 0,
        interest: 0,
        amortization: 0,
        monthlyCost: 0,
        iof: 0,
        installment: 0,
        finalBalance: 0,
        shortTermBalance: 0,
        longTermBalance: 0,
        cpcShortTermWindowMonths: [],
        cpcShortTermWindowDescribe: 'Empréstimo já quitado',
        isGrace: false,
        effectivePctInPeriod: 0,
      };
      schedule.push(remainingRow);
    }
  }

  // ========== Extensão por Inadimplência ==========
  // Se ainda há saldo devedor após todas as parcelas contratadas (causado por
  // parcelas não pagas não quitadas), gerar uma linha por parcela em atraso.
  // Cada linha provisiona a quitação dessa parcela: LP→CP (o valor da parcela
  // sai do LP e vai para CP para quitação sequencial).
  if (currentBalance > 0.005) {
    const unpaidMonths = Object.entries(params.monthlyAdjustments ?? {})
      .filter(([, adj]) => adj.unpaid && !(adj.paymentAmount && adj.paymentAmount > 0))
      .map(([k]) => Number(k))
      .sort((a, b) => a - b);

    let overdueBalance = currentBalance;
    let overdueSeq = 0;

    for (const unpaidMonth of unpaidMonths) {
      if (overdueBalance <= 0.005) break;
      overdueSeq += 1;

      const originalRow = schedule.find((r) => r.month === unpaidMonth);
      const overdueInstallment = originalRow?.unpaidAmount ?? 0;

      const lastContractDate = addMonths(firstInstallmentDate, months - 1);
      const overdueDate = addMonths(lastContractDate, overdueSeq);

      // O valor da parcela é provisionado no CP desta linha (reclassifica LP→CP)
      const overdueCP = roundCentavos(Math.min(overdueBalance, overdueInstallment));
      overdueBalance = roundCentavos(overdueBalance - overdueCP);

      schedule.push({
        month: gracePeriodMonths + months + overdueSeq,
        date: overdueDate,
        fixedInstallmentReference: 0,
        accrualDays: 0,
        referenceMonthDays: 30,
        die30Factor: 0,
        opCostPeriodFactor: 0,
        initialBalance: roundCentavos(overdueBalance + overdueCP),
        interest: 0,
        amortization: overdueCP,
        monthlyCost: 0,
        iof: 0,
        installment: roundCentavos(overdueInstallment),
        finalBalance: overdueBalance,
        // CP = valor desta parcela (provisionando quitação); LP = saldo restante em atraso
        shortTermBalance: overdueCP,
        longTermBalance: roundCentavos(Math.max(0, overdueBalance)),
        cpcShortTermWindowMonths: [],
        cpcShortTermWindowDescribe: '—',
        isGrace: false,
        effectivePctInPeriod: 0,
        isOverdue: true,
        overdueInstallmentNumber: unpaidMonth,
      });
    }
  }

  return schedule;
}

// Funções auxiliares exportadas mantidas para compatibilidade
export function resolveAccrualEndDate(accrualStart: Date, rowDate: Date): Date {
  return differenceInCalendarDays(rowDate, accrualStart) > 0 ? rowDate : addMonths(rowDate, 1);
}

export function calendarAccrualMetrics(
  accrualStart: Date,
  accrualEnd: Date
): { days: number; refMonthDays: number; factor: number } {
  const daysInPeriod = differenceInCalendarDays(accrualEnd, accrualStart);
  const referenceMonthDays = differenceInCalendarDays(accrualEnd, addMonths(accrualEnd, -1));
  const denom = referenceMonthDays > 0 ? referenceMonthDays : 1;
  if (daysInPeriod <= 0) {
    return { days: Math.max(0, daysInPeriod), refMonthDays: denom, factor: 0 };
  }
  return { days: daysInPeriod, refMonthDays: denom, factor: daysInPeriod / denom };
}

export function proRataDie30Factor(accrualStart: Date, accrualEnd: Date): number {
  const dias = differenceInCalendarDays(accrualEnd, accrualStart);
  return dias <= 0 ? 0 : dias / 30;
}

export function priceAnnuityPayment(
  principal: number,
  n: number,
  monthlyRateDecimal: number
): number {
  if (principal <= 0 || n <= 0) return 0;
  if (monthlyRateDecimal === 0) return principal / n;
  const pow = Math.pow(1 + monthlyRateDecimal, n);
  return (principal * monthlyRateDecimal * pow) / (pow - 1);
}

export function applySacMoneyRound(value: number, mode: SacMoneyRoundingMode): number {
  if (!Number.isFinite(value)) return 0;
  const k = 100;
  const scaled = value * k;
  if (mode === 'truncateCentavos') {
    return (Math.sign(scaled >= 0 ? 1 : -1) * Math.floor(Math.abs(scaled) + 1e-12)) / k;
  }
  return (scaled >= 0 ? Math.floor(scaled + 0.5 + 1e-12) : Math.ceil(scaled - 0.5 - 1e-12)) / k;
}

export function installmentFirstAmortizationMonth(params: LoanParams): number {
  const schedule = calculateLoan(params);
  const row = schedule.find(r => r.month > 0 && !r.isGrace);
  return row ? row.installment : 0;
}

export function solvePrincipalForTargetFirstInstallment(
  base: Omit<LoanParams, 'principal'>,
  targetInstallment: number
): number {
  if (!Number.isFinite(targetInstallment) || targetInstallment <= 0 || base.months <= 0) return 0;

  const f = (principal: number) => {
    const p = Math.max(principal, 1e-6);
    return installmentFirstAmortizationMonth({ ...base, principal: p });
  };

  let lo = 1e-6;
  if (f(lo) >= targetInstallment) return 0;

  let hi = Math.max(targetInstallment * 4, 100);
  let guard = 0;
  while (f(hi) < targetInstallment && hi < 1e14 && guard++ < 70) {
    hi *= 2;
  }
  if (f(hi) < targetInstallment) return hi;

  for (let i = 0; i < 85; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.abs(fm - targetInstallment) < 0.01) return mid;
    if (fm < targetInstallment) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export { adjustInstallmentDueDate } from './brBusinessDays';
