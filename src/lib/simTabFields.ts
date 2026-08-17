import type {
  CpcPresentationMode,
  GraceInterestRoundingMode,
  IofTreatmentMode,
  OperationalCostDayBasis,
  ProRataDieMode,
  SacInterestAccrual,
  SacMoneyRoundingMode,
} from './loanCalculator';
import type { MonthlyAdjustments } from '../contabilfacil/types';
import { parseLocaleNumber, parseLocaleRatePercent } from './localeNumber';

export type SimVarMode = 'none' | 'selic' | 'pronampe' | 'cdi' | 'custom';

export const SIM_VAR_MODE_OPTIONS: { value: SimVarMode; label: string }[] = [
  { value: 'none', label: 'Sem indexador (taxa fixa pura)' },
  { value: 'cdi', label: 'CDI (% a.m. BCB + spread)' },
  { value: 'selic', label: 'SELIC mensal (BCB + spread)' },
  { value: 'pronampe', label: 'PRONAMPE — Selic Over (DU + fatores)' },
  { value: 'custom', label: 'IPCA / taxa fixa acordada' },
];

const SIM_VAR_MODES: SimVarMode[] = ['none', 'selic', 'pronampe', 'cdi', 'custom'];

/** Normaliza `selic_over` (legado) → `pronampe`. Preserva `none` (sem indexador). */
export function normalizeSimVarMode(mode: string | undefined): SimVarMode {
  if (mode === 'selic_over') return 'pronampe';
  if (SIM_VAR_MODES.includes(mode as SimVarMode)) return mode as SimVarMode;
  return 'cdi';
}

export function usesSelicOverDailyVarMode(varMode: SimVarMode): boolean {
  return varMode === 'pronampe';
}

export function usesSpreadPlusIndexador(varMode: SimVarMode): boolean {
  return varMode === 'cdi' || varMode === 'selic' || varMode === 'pronampe';
}

/** Valor efetivo da base SAC (respeita escolha do usuário, inclusive com Selic Over). */
export function resolveSacAmortizationBase(
  tab: Pick<SimTabFields, 'sacAmortizationBase'>,
): SimTabFields['sacAmortizationBase'] {
  return tab.sacAmortizationBase;
}

export function spreadIndexadorShortLabel(varMode: SimVarMode): string {
  if (varMode === 'cdi') return 'CDI';
  if (varMode === 'pronampe') return 'PRONAMPE';
  if (varMode === 'selic') return 'SELIC';
  return '';
}

export type SimPriceSelicAdjustment = 'recalculo_pmt' | 'pmt_fixo';
export type SimCalculationMode = 'parcel' | 'value';

export interface SimTabFields {
  principalStr: string;
  targetInstallmentStr: string;
  system: 'SAC' | 'PRICE';
  fixedRateMonthStr: string;
  fixedRateAnnualStr: string;
  fixedRateType: 'percent' | 'value';
  varMode: SimVarMode;
  customVarRateStr: string;
  priceSelicAdjustment: SimPriceSelicAdjustment;
  gracePeriodStr: string;
  /** @deprecated legado — use gracePeriodStr (meses). */
  graceDaysStr: string;
  graceType: 'capitalized' | 'paid';
  gracePreserveInstallmentAfterCapitalization: boolean;
  graceFixedRateMonthStr: string;
  graceFixedRateAnnualStr: string;
  graceFixedRateType: 'percent' | 'value';
  graceMonthlyOperationCostStr: string;
  graceMonthlyOpCostType: 'percent' | 'value';
  graceInterestRoundingMode: GraceInterestRoundingMode;
  graceInterestDecimalPlacesStr: string;
  monthlyOperationCostStr: string;
  monthlyOpCostType: 'percent' | 'value';
  proRataDieMode: ProRataDieMode;
  operationalCostDayBasis: OperationalCostDayBasis;
  sacInterestAccrual: SacInterestAccrual;
  sacMoneyRounding: SacMoneyRoundingMode;
  /** SAC: saldo após carência ÷ parcelas ou principal do contrato ÷ parcelas. */
  sacAmortizationBase: 'incorporated' | 'contractPrincipal';
  priceInterestAccrual: SacInterestAccrual;
  priceMoneyRounding: SacMoneyRoundingMode;
  cpcPresentationMode: CpcPresentationMode;
  cpcRollingMonthsStr: string;
  iofMode: IofTreatmentMode;
  valorIofStr: string;
  accJurosAproDebit: string;
  accJurosAproCredit: string;
  accApropriacaoDebit: string;
  accApropriacaoCredit: string;
  accTransferenciaDebit: string;
  accTransferenciaCredit: string;
  accEmprestimoDebit: string;
  accEmprestimoCredit: string;
  /** Parcela bruta não paga: reclassifica CP → LP. */
  accNaoPagoDebit: string;
  accNaoPagoCredit: string;
  /** Pagamento atrasado quitado: reverte LP → CP. */
  accAtrasadoPagoDebit: string;
  accAtrasadoPagoCredit: string;
  dominioCodigoHistoricoStr: string;
  dominioComplementoHistoricoStr: string;
  /** Opcional: TXT+ Domínio só com lançamentos cuja data for ≥ esta (yyyy-MM-dd). */
  dataGerarLancamentosAPartirStr: string;
  /** Opcional: TXT+ Domínio só com lançamentos cuja data for ≤ esta (yyyy-MM-dd). */
  dataGerarLancamentosAteStr: string;
  monthlyAdjustments?: MonthlyAdjustments;
}

export interface SavedContractFormState {
  monthsStr: string;
  contractDateStr: string;
  firstInstallmentDateStr: string;
  calculationMode?: SimCalculationMode;
  parcelTab: SimTabFields;
  valueTab: SimTabFields;
  savedDisplayPrincipalStr?: string;
}


export function parseCurrency(value: string): number {
  const s = String(value ?? '').trim();
  if (!s) return 0;
  return parseLocaleNumber(s, 0);
}

export function parseGenericNumber(value: string): number {
  return parseLocaleNumber(String(value ?? ''), 0);
}

/** Taxa (% a.m.): "1.032" tem que virar 1,032, nunca 1032 (ver parseLocaleRatePercent). */
export function parseGenericRatePercent(value: string): number {
  return parseLocaleRatePercent(String(value ?? ''), 0);
}

export function formatCurrencyInput(value: number): string {
  if (!Number.isFinite(value)) return '0,00';
  return (Math.round(value * 100) / 100).toFixed(2).replace('.', ',');
}

export function monthlyRateToAnnualPercent(monthlyPct: number): number {
  if (!Number.isFinite(monthlyPct) || monthlyPct === 0) return 0;
  return (Math.pow(1 + monthlyPct / 100, 12) - 1) * 100;
}

export function annualPercentToMonthlyRate(annualPct: number): number {
  if (!Number.isFinite(annualPct) || annualPct === 0) return 0;
  return (Math.pow(1 + annualPct / 100, 1 / 12) - 1) * 100;
}

/** Exibe taxa anual legível (máx. 4 casas) — só para contratos antigos sem `fixedRateAnnualStr`. */
export function formatAnnualRateDisplay(annual: number): string {
  if (!Number.isFinite(annual) || annual === 0) return '';
  const rounded = Math.round(annual * 10000) / 10000;
  return String(rounded).replace('.', ',');
}

/** Taxa mensal interna com precisão suficiente para o cálculo. */
export function formatRateMonthStorage(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0';
  const rounded = Math.round(value * 1e10) / 1e10;
  return String(rounded).replace('.', ',');
}

/** Valor exibido no campo Taxa Mensal % — preserva o que o usuário digitou (% a.m.). */
export function resolveMonthlyRateStr(tab: SimTabFields): string {
  const stored = tab.fixedRateAnnualStr?.trim();
  if (stored) return stored;
  const legacy = tab.fixedRateMonthStr?.trim();
  if (legacy) return legacy;
  return '';
}

/** Valor exibido no campo Taxa Mensal Carência % (% a.m.). */
export function resolveGraceMonthlyRateStr(tab: SimTabFields): string {
  const stored = tab.graceFixedRateAnnualStr?.trim();
  if (stored) return stored;
  const legacy = tab.graceFixedRateMonthStr?.trim();
  if (legacy) return legacy;
  return '';
}

/** @deprecated use resolveMonthlyRateStr */
export function resolveAnnualRateStr(tab: SimTabFields): string {
  return resolveMonthlyRateStr(tab);
}

/** @deprecated use resolveGraceMonthlyRateStr */
export function resolveGraceAnnualRateStr(tab: SimTabFields): string {
  return resolveGraceMonthlyRateStr(tab);
}

export function createDefaultSimTabFields(): SimTabFields {
  return {
    principalStr: '0,00',
    targetInstallmentStr: '',
    system: 'PRICE',
    fixedRateMonthStr: '1,00',
    fixedRateAnnualStr: '',
    fixedRateType: 'percent',
    varMode: 'cdi',
    customVarRateStr: '0,00',
    priceSelicAdjustment: 'recalculo_pmt',
    gracePeriodStr: '0',
    graceDaysStr: '0',
    graceType: 'capitalized',
    gracePreserveInstallmentAfterCapitalization: false,
    graceFixedRateMonthStr: '1,00',
    graceFixedRateAnnualStr: '',
    graceFixedRateType: 'percent',
    graceMonthlyOperationCostStr: '0,00',
    graceMonthlyOpCostType: 'percent',
    graceInterestRoundingMode: 'halfAwayFromZero',
    graceInterestDecimalPlacesStr: '2',
    monthlyOperationCostStr: '0,00',
    monthlyOpCostType: 'percent',
    proRataDieMode: 'linear',
    operationalCostDayBasis: 'commercial30',
    sacInterestAccrual: 'mensalContrato',
    sacMoneyRounding: 'halfAwayFromZero',
    sacAmortizationBase: 'incorporated',
    priceInterestAccrual: 'proRataCorridos',
    priceMoneyRounding: 'halfAwayFromZero',
    cpcPresentationMode: 'fiscal',
    cpcRollingMonthsStr: '12',
    iofMode: 'financed',
    valorIofStr: '0,00',
    accJurosAproDebit: '',
    accJurosAproCredit: '',
    accApropriacaoDebit: '',
    accApropriacaoCredit: '',
    accTransferenciaDebit: '',
    accTransferenciaCredit: '',
    accEmprestimoDebit: '',
    accEmprestimoCredit: '',
    accNaoPagoDebit: '',
    accNaoPagoCredit: '',
    accAtrasadoPagoDebit: '',
    accAtrasadoPagoCredit: '',
    dominioCodigoHistoricoStr: '',
    dominioComplementoHistoricoStr: '',
    dataGerarLancamentosAPartirStr: '',
    dataGerarLancamentosAteStr: '',
  };
}

export function mergeStoredSimTab(partial: Partial<SimTabFields> | null | undefined): SimTabFields {
  const base = createDefaultSimTabFields();
  if (!partial || typeof partial !== 'object') return base;
  const merged: SimTabFields = { ...base, ...partial };

  if (merged.system !== 'SAC' && merged.system !== 'PRICE') merged.system = base.system;
  if (merged.fixedRateType !== 'percent' && merged.fixedRateType !== 'value') {
    merged.fixedRateType = base.fixedRateType;
  }
  merged.varMode = normalizeSimVarMode(merged.varMode);
  if (!SIM_VAR_MODES.includes(merged.varMode)) {
    merged.varMode = base.varMode;
  }
  if (!(['recalculo_pmt', 'pmt_fixo'] as const).includes(merged.priceSelicAdjustment)) {
    merged.priceSelicAdjustment = base.priceSelicAdjustment;
  }
  if (merged.graceType !== 'capitalized' && merged.graceType !== 'paid') {
    merged.graceType = base.graceType;
  }
  if (merged.graceFixedRateType !== 'percent' && merged.graceFixedRateType !== 'value') {
    merged.graceFixedRateType = base.graceFixedRateType;
  }
  if (merged.graceMonthlyOpCostType !== 'percent' && merged.graceMonthlyOpCostType !== 'value') {
    merged.graceMonthlyOpCostType = base.graceMonthlyOpCostType;
  }
  if (merged.monthlyOpCostType !== 'percent' && merged.monthlyOpCostType !== 'value') {
    merged.monthlyOpCostType = base.monthlyOpCostType;
  }
  if (merged.proRataDieMode !== 'linear' && merged.proRataDieMode !== 'compound') {
    merged.proRataDieMode = base.proRataDieMode;
  }
  if (merged.varMode === 'pronampe' || merged.varMode === 'selic') {
    merged.proRataDieMode = 'compound';
    if (merged.graceInterestRoundingMode === 'none') {
      merged.graceInterestRoundingMode = 'halfAwayFromZero';
    }
  }
  if (merged.operationalCostDayBasis !== 'commercial30' && merged.operationalCostDayBasis !== 'calendar365') {
    merged.operationalCostDayBasis = base.operationalCostDayBasis;
  }
  if (!(['financed', 'paid'] as IofTreatmentMode[]).includes(merged.iofMode)) {
    merged.iofMode = base.iofMode;
  }
  if (merged.cpcPresentationMode !== 'contabil' && merged.cpcPresentationMode !== 'fiscal') {
    merged.cpcPresentationMode = base.cpcPresentationMode;
  }
  merged.cpcPresentationMode = 'fiscal';

  // Validar gracePeriodStr - se estiver vazio ou inválido, usar padrão
  const gracePeriodNum = Math.max(0, Math.floor(Number(String(merged.gracePeriodStr ?? '').replace(/\D/g, '')) || 0));
  if (gracePeriodNum > 120) {
    // Limite de 120 meses (10 anos) - se maior, provavelmente dados corrompidos
    merged.gracePeriodStr = base.gracePeriodStr;
  } else {
    merged.gracePeriodStr = String(gracePeriodNum);
  }

  const sacAccruals: SacInterestAccrual[] = ['proRataCorridos', 'mensalContrato', 'proRataMesCivil'];
  if (!sacAccruals.includes(merged.sacInterestAccrual)) merged.sacInterestAccrual = base.sacInterestAccrual;
  if (!sacAccruals.includes(merged.priceInterestAccrual)) merged.priceInterestAccrual = base.priceInterestAccrual;

  const sacRounds: SacMoneyRoundingMode[] = ['halfAwayFromZero', 'truncateCentavos'];
  if (!sacRounds.includes(merged.sacMoneyRounding)) merged.sacMoneyRounding = base.sacMoneyRounding;
  if (merged.sacAmortizationBase !== 'incorporated' && merged.sacAmortizationBase !== 'contractPrincipal') {
    merged.sacAmortizationBase = base.sacAmortizationBase;
  }
  if (
    merged.varMode === 'pronampe' &&
    merged.system === 'SAC' &&
    partial &&
    !('sacAmortizationBase' in partial)
  ) {
    merged.sacAmortizationBase = 'contractPrincipal';
  }
  if (!sacRounds.includes(merged.priceMoneyRounding)) merged.priceMoneyRounding = base.priceMoneyRounding;

  const graceModes: GraceInterestRoundingMode[] = ['none', 'halfAwayFromZero', 'truncate', 'floor', 'ceil'];
  if (!graceModes.includes(merged.graceInterestRoundingMode)) {
    merged.graceInterestRoundingMode = base.graceInterestRoundingMode;
  }

  const rollStr = String(merged.cpcRollingMonthsStr ?? '').trim();
  merged.cpcRollingMonthsStr = rollStr || base.cpcRollingMonthsStr;

  return merged;
}

export function pickSimTabForEditor(formState: SavedContractFormState): SimTabFields {
  const mode = formState.calculationMode ?? 'parcel';
  if (mode === 'value' && formState.valueTab) {
    return mergeStoredSimTab(formState.valueTab);
  }
  return mergeStoredSimTab(formState.parcelTab);
}

/** Converte formState legado (campos flat) para `parcelTab`. */
export function legacyFormStateToParcelTab(raw: Record<string, unknown>): SimTabFields {
  const base = createDefaultSimTabFields();
  const legacy = raw ?? {};

  const str = (key: string, fallback = '') => String(legacy[key] ?? fallback);
  const bool = (key: string, fallback = false) =>
    legacy[key] === true || legacy[key] === 'true' ? true : fallback;

  const varMode = normalizeSimVarMode(String(legacy.varMode ?? '').toLowerCase()) || base.varMode;

  return mergeStoredSimTab({
    principalStr: str('principalStr', str('principal', base.principalStr)),
    targetInstallmentStr: str('targetInstallmentStr', base.targetInstallmentStr),
    system: String(legacy.system ?? base.system).toUpperCase() === 'SAC' ? 'SAC' : 'PRICE',
    fixedRateMonthStr: str('fixedRateMonthStr', str('fixedRateMonth', base.fixedRateMonthStr)),
    fixedRateType:
      String(legacy.fixedRateType ?? base.fixedRateType) === 'value' ? 'value' : 'percent',
    varMode,
    customVarRateStr: str('customVarRateStr', base.customVarRateStr),
    priceSelicAdjustment:
      String(legacy.priceSelicAdjustment ?? base.priceSelicAdjustment) === 'pmt_fixo'
        ? 'pmt_fixo'
        : 'recalculo_pmt',
    gracePeriodStr: str('gracePeriodStr', str('gracePeriod', base.gracePeriodStr)),
    graceDaysStr: str('graceDaysStr', base.graceDaysStr || base.gracePeriodStr),
    graceType: String(legacy.graceType ?? base.graceType) === 'paid' ? 'paid' : 'capitalized',
    gracePreserveInstallmentAfterCapitalization: bool(
      'gracePreserveInstallmentAfterCapitalization',
      base.gracePreserveInstallmentAfterCapitalization
    ),
    graceFixedRateMonthStr: str('graceFixedRateMonthStr', base.graceFixedRateMonthStr),
    graceFixedRateType:
      String(legacy.graceFixedRateType ?? base.graceFixedRateType) === 'value' ? 'value' : 'percent',
    graceMonthlyOperationCostStr: str('graceMonthlyOperationCostStr', base.graceMonthlyOperationCostStr),
    graceMonthlyOpCostType:
      String(legacy.graceMonthlyOpCostType ?? base.graceMonthlyOpCostType) === 'value'
        ? 'value'
        : 'percent',
    graceInterestRoundingMode: str(
      'graceInterestRoundingMode',
      base.graceInterestRoundingMode
    ) as GraceInterestRoundingMode,
    graceInterestDecimalPlacesStr: str('graceInterestDecimalPlacesStr', base.graceInterestDecimalPlacesStr),
    monthlyOperationCostStr: str('monthlyOperationCostStr', base.monthlyOperationCostStr),
    monthlyOpCostType:
      String(legacy.monthlyOpCostType ?? base.monthlyOpCostType) === 'value' ? 'value' : 'percent',
    proRataDieMode: String(legacy.proRataDieMode ?? base.proRataDieMode) === 'compound' ? 'compound' : 'linear',
    operationalCostDayBasis:
      String(legacy.operationalCostDayBasis ?? base.operationalCostDayBasis) === 'calendar365'
        ? 'calendar365'
        : 'commercial30',
    sacInterestAccrual: str('sacInterestAccrual', base.sacInterestAccrual) as SacInterestAccrual,
    sacMoneyRounding: str('sacMoneyRounding', base.sacMoneyRounding) as SacMoneyRoundingMode,
    sacAmortizationBase:
      legacy.sacAmortizationBase === 'contractPrincipal' ? 'contractPrincipal' : base.sacAmortizationBase,
    priceInterestAccrual: str('priceInterestAccrual', base.priceInterestAccrual) as SacInterestAccrual,
    priceMoneyRounding: str('priceMoneyRounding', base.priceMoneyRounding) as SacMoneyRoundingMode,
    cpcPresentationMode: 'fiscal',
    cpcRollingMonthsStr: str('cpcRollingMonthsStr', base.cpcRollingMonthsStr),
    iofMode: String(legacy.iofMode ?? base.iofMode) === 'paid' ? 'paid' : 'financed',
    valorIofStr: str('valorIofStr', str('valorIof', base.valorIofStr)),
    accJurosAproDebit: str('accJurosAproDebit'),
    accJurosAproCredit: str('accJurosAproCredit'),
    accApropriacaoDebit: str('accApropriacaoDebit'),
    accApropriacaoCredit: str('accApropriacaoCredit'),
    accTransferenciaDebit: str('accTransferenciaDebit'),
    accTransferenciaCredit: str('accTransferenciaCredit'),
    accEmprestimoDebit: str('accEmprestimoDebit'),
    accEmprestimoCredit: str('accEmprestimoCredit'),
    accNaoPagoDebit: str('accNaoPagoDebit'),
    accNaoPagoCredit: str('accNaoPagoCredit'),
    accAtrasadoPagoDebit: str('accAtrasadoPagoDebit'),
    accAtrasadoPagoCredit: str('accAtrasadoPagoCredit'),
    dominioCodigoHistoricoStr: str('dominioCodigoHistoricoStr'),
    dominioComplementoHistoricoStr: str('dominioComplementoHistoricoStr'),
    dataGerarLancamentosAPartirStr: str('dataGerarLancamentosAPartirStr').slice(0, 10),
    dataGerarLancamentosAteStr: str('dataGerarLancamentosAteStr').slice(0, 10),
  });
}
