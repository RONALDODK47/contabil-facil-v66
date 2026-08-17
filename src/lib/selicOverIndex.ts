import { addDays, format, isAfter, isBefore, isEqual, startOfDay } from 'date-fns';
import { isBusinessDay, previousBusinessDay } from './brBusinessDays';

/** Ponto da série BCB 11 — Selic Over (% a.a., base 252 dias úteis). */
export interface SelicDailyPoint {
  /** yyyy-MM-dd */
  date: string;
  /** Taxa anual % divulgada pelo BCB na data. */
  annualRatePct: number;
}

export type VarIndexMode = 'none' | 'mensal' | 'selic_over_diaria' | 'selic_mensal' | 'cdi_mensal';

/** Memória de cálculo por competência (auditoria). */
export type SelicOverAccrualMode = 'daily' | 'periodOpening';

export interface PeriodRateMemory {
  rateDecimal: number;
  selicAccumulatedFactor: number;
  selicBusinessDays: number;
  spreadPctInPeriod: number;
  selicPctInPeriod: number;
  effectivePctInPeriod: number;
}

/** Fator diário Selic Over: (1 + taxa_a.a./100)^(1/252). */
export function selicDailyFactorFromAnnualPct(annualRatePct: number): number {
  if (!Number.isFinite(annualRatePct)) return 1;
  // A taxa da Série 11 do BCB já é expressa em porcentagem ao dia (% a.d.).
  // Portanto, o fator diário é simplesmente 1 + taxa/100, sem aplicar o expoente (1/252).
  return 1 + annualRatePct / 100;
}

export function selicPointsToMap(points: SelicDailyPoint[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of points) {
    if (p.date && Number.isFinite(p.annualRatePct)) {
      map.set(p.date, p.annualRatePct);
    }
  }
  return map;
}

/** Última taxa divulgada em ou antes de `date` (carry-forward para lacunas na série 11). */
export function lastSelicRateOnOrBefore(
  selicByDate: Map<string, number>,
  date: Date
): number | undefined {
  const limit = format(startOfDay(date), 'yyyy-MM-dd');
  let bestDate = '';
  let bestRate: number | undefined;
  for (const [d, rate] of selicByDate) {
    if (d <= limit && d >= bestDate && Number.isFinite(rate)) {
      bestDate = d;
      bestRate = rate;
    }
  }
  return bestRate;
}

/**
 * Acumula fatores diários entre (start, end] em dias úteis (BR).
 * Usa carry-forward da última cotação BCB quando um dia útil não tem publicação.
 */
/**
 * Acumula Selic Over entre vencimentos.
 * Convenção BB/PRONAMPE: (data_vencimento_anterior, data_vencimento_atual] em dias úteis.
 * O dia do desembolso/vencimento anterior não entra; o dia do vencimento atual entra.
 */
export function accumulateSelicOverBetween(
  selicByDate: Map<string, number>,
  accrualStart: Date,
  accrualEnd: Date,
  mode: 'daily' | 'periodOpening' = 'daily',
): { factor: number; businessDays: number } {
  const start = startOfDay(accrualStart);
  const end = startOfDay(accrualEnd);
  if (!isBefore(start, end) && !isEqual(start, end)) {
    return { factor: 1, businessDays: 0 };
  }

  let product = 1;
  let businessDays = 0;
  const openingRate = lastSelicRateOnOrBefore(selicByDate, start);
  let cursor = addDays(start, 1);

  while (isBefore(cursor, end) || isEqual(cursor, end)) {
    if (isBusinessDay(cursor)) {
      if (mode === 'periodOpening') {
        if (openingRate != null && Number.isFinite(openingRate)) {
          product *= selicDailyFactorFromAnnualPct(openingRate);
          businessDays += 1;
        }
      } else {
        /**
         * BB/SISBB: cotação publicada no dia D passa a valer no DU seguinte.
         * No 1º período (DU anterior ≤ início do accrual), usa cotação do próprio DU.
         */
        const prevBu = previousBusinessDay(cursor);
        const refForRate = isAfter(prevBu, start) ? prevBu : cursor;
        const effectiveRate = lastSelicRateOnOrBefore(selicByDate, refForRate);
        if (effectiveRate != null && Number.isFinite(effectiveRate)) {
          product *= selicDailyFactorFromAnnualPct(effectiveRate);
          businessDays += 1;
        }
      }
    }
    if (isEqual(cursor, end)) break;
    cursor = addDays(cursor, 1);
    if (isAfter(cursor, end)) break;
  }

  return { factor: product, businessDays };
}

/**
 * CDI/Selic mensal BCB por competência (yyyy-MM).
 * Meses sem publicação usam a última taxa conhecida (carry-forward — projeção bancária).
 */
export function lookupMonthlyIndexPct(
  monthKey: string,
  monthlyRateMap: Map<string, number> | null,
  fallbackPct?: number,
): number | undefined {
  if (monthlyRateMap && monthlyRateMap.size > 0) {
    const exact = monthlyRateMap.get(monthKey);
    if (Number.isFinite(exact)) return exact;

    let bestMonth = '';
    let bestRate: number | undefined;
    for (const [m, rate] of monthlyRateMap) {
      if (m <= monthKey && m >= bestMonth && Number.isFinite(rate)) {
        bestMonth = m;
        bestRate = rate;
      }
    }
    if (bestRate !== undefined) return bestRate;
  }

  return Number.isFinite(fallbackPct) ? fallbackPct : undefined;
}

export function resolvePeriodRateMemory(input: {
  spreadMonthPct: number;
  varRateMonthPct: number;
  varIndexMode: VarIndexMode;
  temporalFactor: number;
  proRataDieMode: 'linear' | 'compound';
  selicByDate: Map<string, number> | null;
  monthlyRateMap: Map<string, number> | null;
  /** Último CDI/Selic % a.m. do BCB quando a competência ainda não foi divulgada. */
  monthlyIndexFallbackPct?: number;
  accrualStart: Date;
  accrualEnd: Date;
  /** BB/PRONAMPE: taxa Selic do 1º DU do período (ignora cortes intra-competência). */
  selicOverAccrualMode?: SelicOverAccrualMode;
}): PeriodRateMemory {
  const tf = Math.max(0, input.temporalFactor);
  const spreadPeriod = (input.spreadMonthPct / 100) * tf;

  if (input.varIndexMode === 'selic_over_diaria' && input.selicByDate && input.selicByDate.size > 0) {
    const { factor, businessDays } = accumulateSelicOverBetween(
      input.selicByDate,
      input.accrualStart,
      input.accrualEnd,
      input.selicOverAccrualMode ?? 'daily',
    );
    const selicPeriod = factor - 1;
    /** BB/PRONAMPE: spread e Selic multiplicam fatores; spread pró-rata DU÷252. */
    const spreadExponent = businessDays > 0 ? (12 * businessDays) / 252 : 0;
    const spreadPeriodFactor = Math.pow(1 + input.spreadMonthPct / 100, spreadExponent);
    const rateDecimal = spreadPeriodFactor * factor - 1;
    return {
      rateDecimal,
      selicAccumulatedFactor: factor,
      selicBusinessDays: businessDays,
      spreadPctInPeriod: (spreadPeriodFactor - 1) * 100,
      selicPctInPeriod: selicPeriod * 100,
      effectivePctInPeriod: rateDecimal * 100,
    };
  }

  const monthKey = format(input.accrualEnd, 'yyyy-MM');
  const monthlyIndexPct =
    input.varIndexMode === 'selic_mensal' || input.varIndexMode === 'cdi_mensal'
      ? lookupMonthlyIndexPct(
          monthKey,
          input.monthlyRateMap,
          input.monthlyIndexFallbackPct,
        )
      : undefined;
  const bcbMonthlyOnly =
    input.varIndexMode === 'selic_mensal' || input.varIndexMode === 'cdi_mensal';
  /** Séries BCB mensais: sem taxa na competência = 0 (não estima). Modo `mensal` legado: usa varRateMonthPct digitado. */
  const varRatePct = Number.isFinite(monthlyIndexPct)
    ? monthlyIndexPct!
    : bcbMonthlyOnly
      ? 0
      : input.varRateMonthPct;

  const iMonthly =
    input.varIndexMode === 'none'
      ? input.spreadMonthPct / 100
      : (1 + input.spreadMonthPct / 100) * (1 + varRatePct / 100) - 1;

  const rateDecimal =
    input.proRataDieMode === 'compound' ? Math.pow(1 + iMonthly, tf) - 1 : iMonthly * tf;

  return {
    rateDecimal,
    selicAccumulatedFactor: 1,
    selicBusinessDays: 0,
    spreadPctInPeriod: spreadPeriod * 100,
    selicPctInPeriod:
      input.varIndexMode === 'none'
        ? 0
        : input.proRataDieMode === 'compound'
          ? ((1 + varRatePct / 100) ** tf - 1) * 100
          : varRatePct * tf,
    effectivePctInPeriod: rateDecimal * 100,
  };
}

export function interestFromPeriodRate(
  balance: number,
  period: PeriodRateMemory,
  _proRataDieMode: 'linear' | 'compound',
  _varIndexMode: VarIndexMode
): number {
  if (balance <= 0 || period.rateDecimal <= 0) return 0;
  return balance * period.rateDecimal;
}

/**
 * Taxa % exibida = juros arredondados ÷ saldo (coerente centavo a centavo com a coluna Juros).
 * Arredonda só para exibição; o motor usa juros monetários arredondados, não taxa intermediária.
 */
export function effectivePctFromRoundedInterest(balance: number, interest: number): number | undefined {
  if (balance <= 0 || interest <= 0) return undefined;
  return (interest / balance) * 100;
}

/** Verifica se SD × taxa% (2 casas na taxa) reproduz os juros exibidos (auditoria). */
export function interestMatchesDisplayedRate(
  balance: number,
  interest: number,
  displayedPct: number
): boolean {
  if (balance <= 0) return interest <= 0;
  const implied = balance * (displayedPct / 100);
  return Math.abs(implied - interest) < 0.005;
}
