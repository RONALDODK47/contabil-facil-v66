import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { addMonths, format, isValid, parseISO } from 'date-fns';
import type { EconomicIndicators } from '../../services/bcbService';
import {
  fetchCdiMonthlySeries,
  fetchEconomicIndicatorsFromBcb,
  fetchSelicMonthlySeries,
  fetchSelicOverDailySeries,
  getLastMonthlyFetchMeta,
  getLastSelicOverFetchMeta,
} from '../../services/bcbService';
import {
  loadMonthlySerieFromStorageForRange,
  loadSerie11FromStorageForRange,
} from '../../services/bcbSeriesStorage';
import {
  evaluateBcbReadiness,
  type BcbLoadState,
} from '../../services/bcbIndexadorReadiness';
import { downloadDominioTXT, generateDominioTXT, diagnosticarExportEmprestimo } from '../../lib/dominioExporter';
import { formatarDiagnosticoExport } from '../../lib/exportDiagnostico';
import { calculateLoan, type LoanParams, type LoanRow } from '../../lib/loanCalculator';
import { loanParamsDatesValid } from '../../lib/loanParamsCodec';
import { exportToPDF } from '../../lib/pdfExporter';
import {
  downloadDeployContractsBundle,
  loadLocalContractsFromBrowserStorage,
  loadContractsFromBrowserStorage,
  saveContractsToBrowserStorage,
  type SavedContract,
} from '../../lib/savedContractStorage';
import type { SelicDailyPoint, VarIndexMode } from '../../lib/selicOverIndex';
import {
  createDefaultSimTabFields,
  formatCurrencyInput,
  formatRateMonthStorage,
  mergeStoredSimTab,
  resolveSacAmortizationBase,
  parseCurrency,
  parseGenericNumber,
  parseGenericRatePercent,
  pickSimTabForEditor,
  resolveGraceMonthlyRateStr,
  resolveMonthlyRateStr,
  type SimTabFields,
  type SimVarMode,
} from '../../lib/simTabFields';
import type { LoanContract } from '../types';
import {
  belongsToCompany,
  loadCompaniesRegistry,
  normalizeCompanyName,
  syncCompanyRegistry,
} from './companyWorkspace';
import {
  computeFirstInstallmentDate,
  resolveGraceMonths,
} from './loanScheduleDates';
import { useAsyncLoanSchedule } from './useAsyncLoanSchedule';
import { postEmprestimoNoRazao } from './loanBalanceteAutomation';
import { flushPersistenceAfterCriticalWrite } from './eyeVisionPersistenceFlush';
import { generateBalancetePreview } from './loanBalancetePreview';

export interface LoanScheduleRow {
  month: number;
  payment: number;
  balance: number;
  interest: number;
  amortization: number;
}

export interface UseLoanModuleStateOptions {
  selectedCompany?: string;
  storageVersion?: number;
}

function resolveVarIndexMode(varMode: SimVarMode): VarIndexMode {
  if (varMode === 'none') return 'none';
  if (varMode === 'pronampe') return 'selic_over_diaria';
  if (varMode === 'cdi') return 'cdi_mensal';
  if (varMode === 'selic') return 'selic_mensal';
  return 'mensal';
}

function varModeToIndexType(varMode: SimVarMode): LoanContract['indexType'] {
  if (varMode === 'cdi') return 'CDI';
  if (varMode === 'selic' || varMode === 'pronampe') return 'SELIC';
  if (varMode === 'custom') return 'FIXED';
  return 'NONE';
}

function indexTypeToVarMode(indexType: LoanContract['indexType']): SimVarMode {
  if (indexType === 'CDI') return 'cdi';
  if (indexType === 'SELIC') return 'pronampe';
  if (indexType === 'FIXED') return 'custom';
  return 'none';
}

/** CDI/SELIC do BCB compõem com o spread digitado (padrão bancário). IPCA fixo usa só spread. */
function usesBcbIndexador(tab: SimTabFields): boolean {
  return tab.varMode === 'cdi' || tab.varMode === 'selic' || tab.varMode === 'pronampe';
}

function savedContractToLoanContract(c: SavedContract): LoanContract {
  const tab = pickSimTabForEditor(c.formState);

  const costs =
    tab.monthlyOpCostType === 'value'
      ? parseCurrency(tab.monthlyOperationCostStr)
      : parseCurrency(tab.monthlyOperationCostStr);

  return {
    id: c.id,
    companyName: c.companyName,
    contractNumber: c.contractNumber,
    bankName: c.bankName ?? '',
    type: tab.system,
    principal: parseCurrency(tab.principalStr),
    interestRate: resolveMonthlyRateStr(tab).trim()
      ? parseGenericRatePercent(resolveMonthlyRateStr(tab))
      : 0,
    installments: Math.max(1, parseGenericNumber(c.formState.monthsStr) || 12),
    startDate: c.formState.contractDateStr,
    gracePeriod: resolveGraceMonths(tab.gracePeriodStr, tab.graceDaysStr),
    graceType: tab.graceType,
    indexType: varModeToIndexType(tab.varMode),
    iof: parseCurrency(tab.valorIofStr),
    iofMode: tab.iofMode,
    costs,
    customVarRate: parseGenericRatePercent(tab.customVarRateStr),
    monthlyAdjustments: tab.monthlyAdjustments,
  };
}

function loanContractToSavedContract(
  view: LoanContract,
  previous?: SavedContract
): SavedContract {
  const tabBase = previous ? pickSimTabForEditor(previous.formState) : createDefaultSimTabFields();
  const monthlyStr = tabBase.fixedRateAnnualStr ?? '';
  const monthlyRate = monthlyStr.trim() ? parseGenericRatePercent(monthlyStr) : 0;
  const prevIndexType = varModeToIndexType(tabBase.varMode);
  const nextIndexType = view.indexType;

  const tab: SimTabFields = mergeStoredSimTab({
    ...tabBase,
    system: view.type,
    principalStr: formatCurrencyInput(view.principal),
    fixedRateAnnualStr: monthlyStr,
    fixedRateMonthStr: formatRateMonthStorage(monthlyRate),
    fixedRateType: 'percent',
    varMode: indexTypeToVarMode(view.indexType),
    customVarRateStr:
      nextIndexType === 'FIXED'
        ? view.customVarRate !== undefined
          ? formatCurrencyInput(view.customVarRate)
          : (tabBase.customVarRateStr || '0,00')
        : nextIndexType !== prevIndexType
          ? '0,00'
          : tabBase.customVarRateStr,
    graceDaysStr: String(Math.max(0, view.gracePeriod)),
    gracePeriodStr: String(Math.max(0, view.gracePeriod)),
    graceType: view.graceType,
    valorIofStr: formatCurrencyInput(view.iof),
    iofMode: view.iofMode ?? tabBase.iofMode,
    monthlyOperationCostStr: formatCurrencyInput(view.costs),
    monthlyOpCostType: tabBase.monthlyOpCostType,
    monthlyAdjustments: view.monthlyAdjustments,
  });

  const contractDateStr = (() => {
    const next = view.startDate?.trim().slice(0, 10) ?? '';
    if (next && isValid(parseISO(next))) return next;
    const prev = previous?.formState.contractDateStr?.trim().slice(0, 10) ?? '';
    if (prev && isValid(parseISO(prev))) return prev;
    return format(new Date(), 'yyyy-MM-dd');
  })();

  const formState = {
    monthsStr: String(Math.max(1, view.installments)),
    contractDateStr,
    firstInstallmentDateStr: computeFirstInstallmentDate(
      contractDateStr,
      Math.max(0, view.gracePeriod),
    ),
    calculationMode: previous?.formState.calculationMode ?? ('parcel' as const),
    parcelTab: tab,
    valueTab: tab,
    savedDisplayPrincipalStr: formatCurrencyInput(view.principal),
  };

  return {
    id: view.id,
    companyName: view.companyName.toUpperCase(),
    contractNumber: view.contractNumber,
    bankName: view.bankName.trim(),
    formState,
    createdAt: previous?.createdAt ?? new Date().toISOString(),
  };
}

function resolveGraceMonthlyRate(tab: SimTabFields): number {
  const monthlyStr = resolveGraceMonthlyRateStr(tab).trim();
  if (!monthlyStr) return 0;
  return parseGenericRatePercent(monthlyStr);
}

/** Taxa fixa (% a.m.) só na fase pós-carência. */
function resolvePostGraceMonthlyRate(tab: SimTabFields): number {
  const monthlyStr = resolveMonthlyRateStr(tab).trim();
  if (!monthlyStr) return 0;
  return parseGenericRatePercent(monthlyStr);
}

/** Custo operacional na carência — herda o pós-carência se a carência estiver zerada. */
function resolveGraceOperationalCost(tab: SimTabFields): {
  cost: number;
  type: SimTabFields['graceMonthlyOpCostType'];
} {
  const graceType = tab.graceMonthlyOpCostType;
  const graceVal =
    graceType === 'percent'
      ? parseGenericNumber(tab.graceMonthlyOperationCostStr)
      : parseCurrency(tab.graceMonthlyOperationCostStr);
  if (graceVal > 0) return { cost: graceVal, type: graceType };

  const postType = tab.monthlyOpCostType;
  const postVal =
    postType === 'percent'
      ? parseGenericNumber(tab.monthlyOperationCostStr)
      : parseCurrency(tab.monthlyOperationCostStr);
  return { cost: postVal, type: postType };
}

export function buildLoanParams(
  saved: SavedContract,
  tab: SimTabFields,
  selicDailySeries: SelicDailyPoint[],
  monthlyIndexMap: Map<string, number> | null,
  monthlyIndexFallbackPct?: number,
): LoanParams {
  const principal = parseCurrency(tab.principalStr);
  const gracePeriod = resolveGraceMonths(tab.gracePeriodStr, tab.graceDaysStr);
  const months = Math.max(1, parseGenericNumber(saved.formState.monthsStr));

  const useBcbIndex = usesBcbIndexador(tab);
  /** Indexador BCB vem só das séries históricas/diárias — nunca do “último valor” estimado. */
  const varRateMonth =
    tab.varMode === 'custom' ? parseGenericRatePercent(tab.customVarRateStr) : 0;
  const useDailySelicSeries = tab.varMode === 'pronampe' && selicDailySeries.length > 0;
  const varIndexMode = useDailySelicSeries
    ? 'selic_over_diaria'
    : resolveVarIndexMode(tab.varMode);
  const proRataDieMode = tab.proRataDieMode;

  const contractDateStr = String(saved.formState.contractDateStr ?? '').trim().slice(0, 10);
  const contractDateParsed = parseISO(contractDateStr);
  const contractDate = isValid(contractDateParsed) ? contractDateParsed : new Date(Number.NaN);

  const firstInstallmentParsed = parseISO(
    computeFirstInstallmentDate(
      isValid(contractDateParsed) ? contractDateStr : '',
      gracePeriod,
    ),
  );
  const firstInstallmentDate = isValid(firstInstallmentParsed)
    ? firstInstallmentParsed
    : isValid(contractDateParsed)
      ? contractDateParsed
      : new Date(Number.NaN);

  const rollingParsed = parseGenericNumber(tab.cpcRollingMonthsStr);
  const cpcRollingMonths = Math.max(1, rollingParsed || 2);

  return {
    principal,
    valorIof: parseCurrency(tab.valorIofStr),
    iofMode: tab.iofMode,
    months,
    fixedRateMonth: resolvePostGraceMonthlyRate(tab),
    fixedRateType: 'percent',
    varRateMonth,
    gracePeriod,
    // graceType só tem efeito durante a carência; sem carência força 'paid' para evitar
    // que juros capitalizados sejam aplicados indevidamente na fase de amortização.
    graceType: gracePeriod > 0 ? tab.graceType : 'paid',
    system: tab.system,
    monthlyOperationCost:
      tab.monthlyOpCostType === 'percent'
        ? parseGenericNumber(tab.monthlyOperationCostStr)
        : parseCurrency(tab.monthlyOperationCostStr),
    monthlyOpCostType: tab.monthlyOpCostType,
    graceFixedRateMonth: resolveGraceMonthlyRate(tab),
    graceFixedRateType: 'percent',
    ...(() => {
      const graceCost = resolveGraceOperationalCost(tab);
      return {
        graceMonthlyOperationCost: graceCost.cost,
        graceMonthlyOpCostType: graceCost.type,
      };
    })(),
    proRataDieMode,
    operationalCostDayBasis: tab.operationalCostDayBasis,
    graceInterestRoundingMode:
      useDailySelicSeries && tab.graceInterestRoundingMode === 'none'
        ? 'halfAwayFromZero'
        : tab.graceInterestRoundingMode,
    graceInterestDecimalPlaces: Math.max(0, parseGenericNumber(tab.graceInterestDecimalPlacesStr)),
    contractDate,
    firstInstallmentDate,
    sacInterestAccrual: tab.sacInterestAccrual,
    sacMoneyRounding: tab.sacMoneyRounding,
    sacAmortizationBase: resolveSacAmortizationBase(tab),
    priceInterestAccrual: tab.priceInterestAccrual,
    priceMoneyRounding: tab.priceMoneyRounding,
    preserveInstallmentAfterCapitalizedGrace: tab.gracePreserveInstallmentAfterCapitalization,
    cpcPresentationMode: 'fiscal',
    cpcRollingMonths,
    varIndexMode,
    monthlyRateMap:
      useBcbIndex && tab.varMode === 'cdi'
        ? monthlyIndexMap
        : useBcbIndex && tab.varMode === 'selic' && !useDailySelicSeries
          ? monthlyIndexMap
          : null,
    monthlyIndexFallbackPct:
      useBcbIndex && tab.varMode === 'cdi'
        ? monthlyIndexFallbackPct
        : useBcbIndex && tab.varMode === 'selic' && !useDailySelicSeries
          ? monthlyIndexFallbackPct
          : undefined,
    selicDailySeries: useBcbIndex && tab.varMode === 'pronampe' ? selicDailySeries : undefined,
    priceSelicAdjustment: tab.priceSelicAdjustment,
    monthlyAdjustments: tab.monthlyAdjustments,
  };
}

function mapScheduleRows(rows: LoanRow[]): LoanScheduleRow[] {
  return rows
    .filter((r) => r.month > 0)
    .map((r) => ({
      month: r.month,
      payment: r.installment,
      balance: r.finalBalance,
      interest: r.interest,
      amortization: r.amortization,
    }));
}


/** Chave estável para séries BCB — evita refetch a cada alteração nos parâmetros SAC/PRICE. */
function buildBcbSeriesFetchKey(
  saved: SavedContract | undefined,
  tab: SimTabFields | null,
): string | null {
  if (!saved || !tab) return null;
  if (tab.varMode !== 'cdi' && tab.varMode !== 'selic' && tab.varMode !== 'pronampe') return null;
  return [
    saved.id,
    saved.formState.contractDateStr,
    String(resolveGraceMonths(tab.gracePeriodStr, tab.graceDaysStr)),
    saved.formState.monthsStr,
    tab.varMode,
  ].join('|');
}

export function useLoanModuleState(options: UseLoanModuleStateOptions = {}) {
  const { selectedCompany: selectedCompanyRaw = '', storageVersion = 0 } = options;
  const selectedCompany = normalizeCompanyName(selectedCompanyRaw);

  const [savedContracts, setSavedContracts] = useState<SavedContract[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [indicators, setIndicators] = useState<EconomicIndicators | null>(null);
  const [indicatorsLoadState, setIndicatorsLoadState] = useState<BcbLoadState>('idle');
  const [selicDailySeries, setSelicDailySeries] = useState<SelicDailyPoint[]>([]);
  const [selicSeriesLoadState, setSelicSeriesLoadState] = useState<BcbLoadState>('idle');
  const [monthlyIndexMap, setMonthlyIndexMap] = useState<Map<string, number> | null>(null);
  const [monthlySeriesLoadState, setMonthlySeriesLoadState] = useState<BcbLoadState>('idle');

  useEffect(() => {
    const loaded = loadContractsFromBrowserStorage();
    setSavedContracts(loaded);
    const companyContracts = loaded.filter((c) =>
      belongsToCompany(c.companyName, selectedCompany),
    );
    if (companyContracts.length > 0) {
      setSelectedId((prev) =>
        prev && companyContracts.some((c) => c.id === prev) ? prev : companyContracts[0].id,
      );
    } else {
      setSelectedId('');
    }
  }, [storageVersion, selectedCompany]);

  useEffect(() => {
    let cancelled = false;
    setIndicatorsLoadState('loading');
    fetchEconomicIndicatorsFromBcb()
      .then((data) => {
        if (cancelled) return;
        setIndicators(data);
        setIndicatorsLoadState(data ? 'ok' : 'error');
      })
      .catch(() => {
        if (!cancelled) {
          setIndicators(null);
          setIndicatorsLoadState('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(
    (
      next: SavedContract[] | ((prev: SavedContract[]) => SavedContract[]),
      options?: { syncRegistry?: boolean },
    ) => {
      const syncRegistry = options?.syncRegistry ?? false;
      setSavedContracts((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        saveContractsToBrowserStorage(resolved);
        if (syncRegistry) syncCompanyRegistry();
        return resolved;
      });
    },
    [],
  );

  const companySavedContracts = useMemo(
    () => savedContracts.filter((c) => belongsToCompany(c.companyName, selectedCompany)),
    [savedContracts, selectedCompany],
  );

  const persistForCompany = useCallback(
    (
      companyList:
        | SavedContract[]
        | ((prevCompany: SavedContract[]) => SavedContract[]),
      options?: { syncRegistry?: boolean },
    ) => {
      persist((allSaved) => {
        const prevCompany = allSaved.filter((c) =>
          belongsToCompany(c.companyName, selectedCompany),
        );
        const others = allSaved.filter(
          (c) => !belongsToCompany(c.companyName, selectedCompany),
        );
        const resolvedCompany =
          typeof companyList === 'function' ? companyList(prevCompany) : companyList;
        const scoped = resolvedCompany.map((c) => ({
          ...c,
          companyName: normalizeCompanyName(c.companyName || selectedCompany),
        }));
        return [...others, ...scoped];
      }, options);
    },
    [selectedCompany, persist],
  );

  const activeSaved = useMemo(
    () => companySavedContracts.find((c) => c.id === selectedId),
    [companySavedContracts, selectedId],
  );

  const activeTab = useMemo(
    () => (activeSaved ? pickSimTabForEditor(activeSaved.formState) : null),
    [activeSaved]
  );

  const bcbSeriesFetchKey = useMemo(
    () => buildBcbSeriesFetchKey(activeSaved, activeTab),
    [activeSaved, activeTab],
  );

  const applyOfflineSelicForKey = useCallback((key: string) => {
    const [, contractDateStr, gracePeriodStr, monthsStr, varMode] = key.split('|');
    if (varMode !== 'pronampe') {
      setSelicDailySeries([]);
      setSelicSeriesLoadState('idle');
      return null;
    }
    const contractDate = parseISO(contractDateStr);
    const grace = Math.max(0, parseGenericNumber(gracePeriodStr));
    const firstInstallmentDate = parseISO(
      computeFirstInstallmentDate(contractDateStr, grace),
    );
    const nMonths = Math.max(1, parseGenericNumber(monthsStr));
    const end = addMonths(firstInstallmentDate, nMonths);
    const cachedSelic = loadSerie11FromStorageForRange(contractDate, end);
    if (cachedSelic?.length) {
      setSelicDailySeries(cachedSelic);
      setSelicSeriesLoadState('ok');
    }
    return { contractDate, end, cachedSelic };
  }, []);

  useLayoutEffect(() => {
    if (!bcbSeriesFetchKey) {
      setSelicDailySeries([]);
      setSelicSeriesLoadState('idle');
      return;
    }
    applyOfflineSelicForKey(bcbSeriesFetchKey);
  }, [bcbSeriesFetchKey, applyOfflineSelicForKey]);

  useEffect(() => {
    if (!bcbSeriesFetchKey) {
      return;
    }
    const parsed = applyOfflineSelicForKey(bcbSeriesFetchKey);
    if (!parsed) return;
    const { contractDate, end, cachedSelic } = parsed;
    if (!cachedSelic?.length) {
      setSelicSeriesLoadState('loading');
    }
    let cancelled = false;
    fetchSelicOverDailySeries(contractDate, end)
      .then((pts) => {
        if (cancelled) return;
        setSelicDailySeries(pts);
        setSelicSeriesLoadState(pts.length > 0 ? 'ok' : 'error');
      })
      .catch(() => {
        if (!cancelled && !cachedSelic?.length) {
          setSelicDailySeries([]);
          setSelicSeriesLoadState('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [bcbSeriesFetchKey, applyOfflineSelicForKey]);

  useEffect(() => {
    if (!bcbSeriesFetchKey) {
      setMonthlyIndexMap(null);
      setMonthlySeriesLoadState('idle');
      return;
    }
    const [, contractDateStr, gracePeriodStr, monthsStr, varMode] = bcbSeriesFetchKey.split('|');
    if (varMode !== 'cdi' && varMode !== 'selic') {
      setMonthlyIndexMap(null);
      setMonthlySeriesLoadState('idle');
      return;
    }
    const contractDate = parseISO(contractDateStr);
    const grace = Math.max(0, parseGenericNumber(gracePeriodStr));
    const firstInstallmentDate = parseISO(
      computeFirstInstallmentDate(contractDateStr, grace),
    );
    const nMonths = Math.max(1, parseGenericNumber(monthsStr));
    const end = addMonths(firstInstallmentDate, nMonths);
    let cancelled = false;
    const serieCode = varMode === 'cdi' ? 4391 : 4390;
    const cachedMonthly = loadMonthlySerieFromStorageForRange(serieCode, contractDate, end);
    if (cachedMonthly?.length) {
      const map = new Map<string, number>();
      for (const row of cachedMonthly) map.set(row.month, row.ratePct);
      setMonthlyIndexMap(map);
      setMonthlySeriesLoadState('ok');
    } else {
      setMonthlySeriesLoadState('loading');
    }
    const fetchFn = varMode === 'cdi' ? fetchCdiMonthlySeries : fetchSelicMonthlySeries;
    fetchFn(contractDate, end)
      .then((rows) => {
        if (cancelled) return;
        const map = new Map<string, number>();
        for (const row of rows) {
          map.set(row.month, row.ratePct);
        }
        setMonthlyIndexMap(map);
        setMonthlySeriesLoadState(map.size > 0 ? 'ok' : 'error');
      })
      .catch(() => {
        if (!cancelled && !cachedMonthly?.length) {
          setMonthlyIndexMap(null);
          setMonthlySeriesLoadState('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [bcbSeriesFetchKey]);

  const bcbReadiness = useMemo(
    () =>
      evaluateBcbReadiness({
        tab: activeTab,
        selicLoadState: selicSeriesLoadState,
        selicDailyCount: selicDailySeries.length,
        monthlyLoadState: monthlySeriesLoadState,
        monthlyIndexCount: monthlyIndexMap?.size ?? 0,
        indicators,
        indicatorsLoadState,
        selicFetchMeta: getLastSelicOverFetchMeta(),
        monthlyFetchMeta: getLastMonthlyFetchMeta(),
      }),
    [
      activeTab,
      selicSeriesLoadState,
      selicDailySeries.length,
      monthlySeriesLoadState,
      monthlyIndexMap,
      indicators,
      indicatorsLoadState,
    ],
  );

  const contracts = useMemo(
    () => companySavedContracts.map(savedContractToLoanContract),
    [companySavedContracts],
  );

  const activeContract = useMemo(
    () => contracts.find((c) => c.id === selectedId),
    [contracts, selectedId]
  );

  const loanParams = useMemo(() => {
    if (!activeSaved || !activeTab) return null;
    if (!bcbReadiness.ready && usesBcbIndexador(activeTab)) return null;
    const monthlyFallback =
      activeTab.varMode === 'cdi'
        ? indicators?.cdiMensal
        : activeTab.varMode === 'selic'
          ? indicators?.selicMensal
          : undefined;
    const params = buildLoanParams(
      activeSaved,
      activeTab,
      selicDailySeries,
      monthlyIndexMap,
      monthlyFallback,
    );
    if (!loanParamsDatesValid(params)) return null;
    return params;
  }, [
    activeSaved,
    activeTab,
    selicDailySeries,
    monthlyIndexMap,
    bcbReadiness.ready,
    indicators,
  ]);

  const { rawSchedule, isCalculating } = useAsyncLoanSchedule(loanParams, selectedId);

  const schedule = useMemo(() => mapScheduleRows(rawSchedule), [rawSchedule]);

  /**
   * Informativo SAC com carência capitalizada.
   * O calculador já usa balanceAfterGrace/months como amortização, então qualquer N
   * de parcelas quita o contrato corretamente. Exibe o saldo pós-carência como aviso
   * informativo para o usuário entender o impacto da capitalização.
   */
  const sacUnderpaymentWarning = useMemo((): {
    active: boolean;
    balanceAfterGrace: number;
    shortfall: number;
    minInstallments: number;
  } | null => {
    if (!loanParams) return null;
    if (loanParams.system !== 'SAC') return null;
    if ((loanParams.gracePeriod ?? 0) === 0) return null;
    if ((loanParams.graceType ?? 'paid') !== 'capitalized') return null;

    // Simula a carência para obter o saldo pós-carência
    let bal = loanParams.principal;
    const gracePeriod = loanParams.gracePeriod ?? 0;
    for (let g = 1; g <= gracePeriod; g++) {
      const rate = loanParams.graceFixedRateMonth > 0
        ? loanParams.graceFixedRateMonth / 100
        : loanParams.fixedRateMonth / 100;
      bal = bal + bal * rate;
    }
    bal = Math.round(bal * 100) / 100;

    const shortfall = Math.round((bal - loanParams.principal) * 100) / 100;
    if (shortfall < 0.01) return null;

    // Com a correção do calculador, qualquer N quita — minInstallments = months atual.
    return { active: true, balanceAfterGrace: bal, shortfall, minInstallments: loanParams.months };
  }, [loanParams]);

  const upsertFromView = useCallback(
    (view: LoanContract, baseId?: string) => {
      const id = baseId ?? view.id;
      persistForCompany(
        (companyList) => {
          const previous = companyList.find((c) => c.id === id);
          const saved = loanContractToSavedContract(
            { ...view, id, companyName: selectedCompany },
            previous,
          );
          return previous
            ? companyList.map((c) => (c.id === id ? saved : c))
            : [...companyList, saved];
        },
        { syncRegistry: true },
      );
      setSelectedId(id);
    },
    [persistForCompany, selectedCompany],
  );

  const handleCreate = useCallback(() => {
    const newView: LoanContract = {
      id: crypto.randomUUID(),
      companyName: selectedCompany || 'SEM EMPRESA',
      contractNumber: `CTR-${Math.floor(1000 + Math.random() * 9000)}`,
      bankName: '',
      type: 'PRICE',
      principal: 0,
      interestRate: 0,
      installments: 12,
      startDate: format(new Date(), 'yyyy-MM-dd'),
      gracePeriod: 0,
      graceType: 'capitalized',
      indexType: 'NONE',
      iof: 0,
      iofMode: 'financed',
      costs: 0,
    };
    upsertFromView(newView);
  }, [upsertFromView, selectedCompany]);

  const handleDuplicate = useCallback(() => {
    if (!activeContract) return;
    const duplicated: LoanContract = {
      ...activeContract,
      id: crypto.randomUUID(),
      contractNumber: `${activeContract.contractNumber}-COPIA`,
    };
    upsertFromView(duplicated);
  }, [activeContract, upsertFromView]);

  const handleDelete = useCallback(() => {
    if (!selectedId) return;
    const next = companySavedContracts.filter((c) => c.id !== selectedId);
    persistForCompany(next, { syncRegistry: true });
    setSelectedId(next.length > 0 ? next[0].id : '');
  }, [selectedId, companySavedContracts, persistForCompany]);

  const handleUpdateInterestRate = useCallback(
    (raw: string) => {
      if (!selectedId) return;
      persistForCompany((companyList) => {
        const previous = companyList.find((c) => c.id === selectedId);
        if (!previous) return companyList;
        const tab = pickSimTabForEditor(previous.formState);
        const monthlyRate = parseGenericRatePercent(raw);
        const nextTab = mergeStoredSimTab({
          ...tab,
          fixedRateAnnualStr: raw,
          fixedRateType: 'percent',
          fixedRateMonthStr: formatRateMonthStorage(monthlyRate),
        });
        const nextSaved: SavedContract = {
          ...previous,
          formState: {
            ...previous.formState,
            parcelTab: nextTab,
            valueTab: nextTab,
          },
        };
        return companyList.map((c) => (c.id === selectedId ? nextSaved : c));
      });
    },
    [selectedId, persistForCompany],
  );

  const handleUpdateGraceInterestRate = useCallback(
    (raw: string) => {
      if (!selectedId) return;
      persistForCompany((companyList) => {
        const previous = companyList.find((c) => c.id === selectedId);
        if (!previous) return companyList;
        const tab = pickSimTabForEditor(previous.formState);
        const monthlyRate = parseGenericRatePercent(raw);
        const nextTab = mergeStoredSimTab({
          ...tab,
          graceFixedRateAnnualStr: raw,
          graceFixedRateType: 'percent',
          graceFixedRateMonthStr: formatRateMonthStorage(monthlyRate),
        });
        const nextSaved: SavedContract = {
          ...previous,
          formState: {
            ...previous.formState,
            parcelTab: nextTab,
            valueTab: nextTab,
          },
        };
        return companyList.map((c) => (c.id === selectedId ? nextSaved : c));
      });
    },
    [selectedId, persistForCompany],
  );

  const graceInterestRateStr = useMemo(
    () => (activeTab ? resolveGraceMonthlyRateStr(activeTab) : ''),
    [activeTab],
  );

  const interestRateStr = useMemo(
    () => (activeTab ? resolveMonthlyRateStr(activeTab) : ''),
    [activeTab],
  );
  const handleUpdate = useCallback(
    (updatedFields: Partial<LoanContract>) => {
      if (!selectedId) return;
      persistForCompany((companyList) => {
        const previous = companyList.find((c) => c.id === selectedId);
        if (!previous) return companyList;
        const view = savedContractToLoanContract(previous);
        const { companyName: _ignored, interestRate: _rateIgnored, ...rest } = updatedFields;
        const saved = loanContractToSavedContract(
          { ...view, ...rest, companyName: selectedCompany, id: selectedId },
          previous,
        );
        return companyList.map((c) => (c.id === selectedId ? saved : c));
      });
    },
    [selectedId, persistForCompany, selectedCompany],
  );

  const clearAll = useCallback(() => {
    persistForCompany([], { syncRegistry: true });
    setSelectedId('');
  }, [persistForCompany]);

  const importLoanContracts = useCallback(
    (items: LoanContract[]) => {
      if (items.length === 0) return;
      const mapped = items.map((item) =>
        loanContractToSavedContract({
          ...item,
          id: item.id || crypto.randomUUID(),
          companyName: selectedCompany,
        }),
      );
      const next = [...companySavedContracts, ...mapped];
      persistForCompany(next, { syncRegistry: true });
      setSelectedId(mapped[0].id);
    },
    [companySavedContracts, persistForCompany, selectedCompany],
  );

  const handleExportDominio = useCallback((onAlert?: (opts: { title: string; body: string; type?: 'info' | 'success' | 'warning' | 'error' }) => void) => {
    if (!activeSaved || !activeTab || !loanParams || loanParams.principal <= 0) return;

    const exportConfig = {
      accJurosAproDebit: activeTab.accJurosAproDebit,
      accJurosAproCredit: activeTab.accJurosAproCredit,
      accApropriacaoDebit: activeTab.accApropriacaoDebit,
      accApropriacaoCredit: activeTab.accApropriacaoCredit,
      accTransferenciaDebit: activeTab.accTransferenciaDebit,
      accTransferenciaCredit: activeTab.accTransferenciaCredit,
      accEmprestimoDebit: activeTab.accEmprestimoDebit,
      accEmprestimoCredit: activeTab.accEmprestimoCredit,
      valorIof: parseCurrency(activeTab.valorIofStr),
      accNaoPagoDebit: activeTab.accNaoPagoDebit,
      accNaoPagoCredit: activeTab.accNaoPagoCredit,
      accAtrasadoPagoDebit: activeTab.accAtrasadoPagoDebit,
      accAtrasadoPagoCredit: activeTab.accAtrasadoPagoCredit,
      codigoHistoricoDominio: activeTab.dominioCodigoHistoricoStr,
      complementoHistoricoDominio: activeTab.dominioComplementoHistoricoStr,
      dataGerarLancamentosAPartirStr: activeTab.dataGerarLancamentosAPartirStr?.trim() || undefined,
      dataGerarLancamentosAteStr: activeTab.dataGerarLancamentosAteStr?.trim() || undefined,
      omitTransferenciaLongoParaCurto: false,
    };

    const diag = formatarDiagnosticoExport(diagnosticarExportEmprestimo(rawSchedule, exportConfig));
    if (diag) {
      const faltaJuros =
        !activeTab.accJurosAproDebit?.trim() || !activeTab.accJurosAproCredit?.trim() ||
        !activeTab.accApropriacaoDebit?.trim() || !activeTab.accApropriacaoCredit?.trim();
      const faltaTransferencia =
        !activeTab.accTransferenciaDebit?.trim() || !activeTab.accTransferenciaCredit?.trim();
      const bloqueia = faltaJuros || faltaTransferencia;
      const msg = bloqueia
        ? `Não foi possível exportar o TXT — contas obrigatórias não configuradas:\n\n${diag}`
        : `Atenção — o TXT pode estar incompleto:\n\n${diag}`;
      if (onAlert) {
        onAlert({ title: 'Aviso de Exportação', body: msg, type: bloqueia ? 'error' : 'warning' });
      } else {
        window.alert(msg);
      }
      if (bloqueia) return;
    }

    const content = generateDominioTXT(rawSchedule, exportConfig);
    downloadDominioTXT(content, `${activeContract?.contractNumber ?? 'contrato'}_dominio_import.txt`);
  }, [activeSaved, activeTab, loanParams, rawSchedule, activeContract?.contractNumber]);

  const handleExportPDF = useCallback(() => {
    if (!activeSaved || !loanParams || loanParams.principal <= 0) return;
    exportToPDF(loanParams, rawSchedule, {
      companyName: activeSaved.companyName,
      contractNumber: activeSaved.contractNumber,
      bankName: activeSaved.bankName ?? activeContract?.bankName ?? '',
      valorIof: parseCurrency(activeTab?.valorIofStr ?? '0'),
    });
  }, [activeSaved, activeTab, loanParams, rawSchedule, activeContract?.bankName]);

  const handleExportForDeploy = useCallback(() => {
    const contracts = loadLocalContractsFromBrowserStorage();
    const companies = loadCompaniesRegistry();
    downloadDeployContractsBundle(contracts, companies);
  }, []);

  const patchActiveSimTab = useCallback(
    (patch: Partial<SimTabFields>) => {
      if (!selectedId) return;
      persistForCompany((companyList) => {
        const active = companyList.find((c) => c.id === selectedId);
        if (!active) return companyList;
        const tab = pickSimTabForEditor(active.formState);
        const nextTab = mergeStoredSimTab({ ...tab, ...patch });
        const nextSaved: SavedContract = {
          ...active,
          formState: {
            ...active.formState,
            parcelTab: nextTab,
            valueTab: nextTab,
          },
        };
        return companyList.map((c) => (c.id === selectedId ? nextSaved : c));
      });
    },
    [selectedId, persistForCompany],
  );

  const loanAccountFields = useMemo(() => {
    if (!activeTab) return null;
    return {
      accJurosAproDebit: activeTab.accJurosAproDebit,
      accJurosAproCredit: activeTab.accJurosAproCredit,
      accApropriacaoDebit: activeTab.accApropriacaoDebit,
      accApropriacaoCredit: activeTab.accApropriacaoCredit,
      accTransferenciaDebit: activeTab.accTransferenciaDebit,
      accTransferenciaCredit: activeTab.accTransferenciaCredit,
      accEmprestimoDebit: activeTab.accEmprestimoDebit,
      accEmprestimoCredit: activeTab.accEmprestimoCredit,
      accNaoPagoDebit: activeTab.accNaoPagoDebit,
      accNaoPagoCredit: activeTab.accNaoPagoCredit,
      accAtrasadoPagoDebit: activeTab.accAtrasadoPagoDebit,
      accAtrasadoPagoCredit: activeTab.accAtrasadoPagoCredit,
    };
  }, [activeTab]);

  const handleMandarTodosEmprestimosBalancete = useCallback((): {
    gerados: number;
    erros: string[];
  } => {
    if (companySavedContracts.length === 0) {
      return { gerados: 0, erros: ['Nenhum contrato cadastrado para enviar ao balancete.'] };
    }

    let totalGerados = 0;
    const mensagensErro: string[] = [];

    for (const saved of companySavedContracts) {
      const tab = pickSimTabForEditor(saved.formState);
      const principal = parseCurrency(tab.principalStr);
      if (principal <= 0) {
        mensagensErro.push(`Contrato ${saved.contractNumber || saved.id}: principal deve ser maior que 0.`);
        continue;
      }

      const params = buildLoanParams(
        saved,
        tab,
        selicDailySeries,
        monthlyIndexMap,
        tab.varMode === 'cdi' ? indicators?.cdiMensal : indicators?.selicMensal
      );

      if (!loanParamsDatesValid(params)) {
        mensagensErro.push(`Contrato ${saved.contractNumber || saved.id}: datas inválidas.`);
        continue;
      }

      const schedule = calculateLoan(params);
      if (!schedule.length) {
        mensagensErro.push(`Contrato ${saved.contractNumber || saved.id}: cronograma vazio.`);
        continue;
      }

      const exportConfig = {
        accJurosAproDebit: tab.accJurosAproDebit,
        accJurosAproCredit: tab.accJurosAproCredit,
        accApropriacaoDebit: tab.accApropriacaoDebit,
        accApropriacaoCredit: tab.accApropriacaoCredit,
        accTransferenciaDebit: tab.accTransferenciaDebit,
        accTransferenciaCredit: tab.accTransferenciaCredit,
        accEmprestimoDebit: tab.accEmprestimoDebit,
        accEmprestimoCredit: tab.accEmprestimoCredit,
        valorIof: parseCurrency(tab.valorIofStr),
        accNaoPagoDebit: tab.accNaoPagoDebit,
        accNaoPagoCredit: tab.accNaoPagoCredit,
        accAtrasadoPagoDebit: tab.accAtrasadoPagoDebit,
        accAtrasadoPagoCredit: tab.accAtrasadoPagoCredit,
        codigoHistoricoDominio: tab.dominioCodigoHistoricoStr,
        complementoHistoricoDominio: tab.dominioComplementoHistoricoStr,
        dataGerarLancamentosAPartirStr: tab.dataGerarLancamentosAPartirStr?.trim() || undefined,
        dataGerarLancamentosAteStr: tab.dataGerarLancamentosAteStr?.trim() || undefined,
        omitTransferenciaLongoParaCurto: false,
      };

      const { gerados, pendencias } = postEmprestimoNoRazao(
        selectedCompany,
        saved.id,
        schedule,
        exportConfig
      );
      totalGerados += gerados;
      if (pendencias.length) {
        mensagensErro.push(`Contrato ${saved.contractNumber || saved.id}: ${pendencias.join(', ')}`);
      }
    }

    void flushPersistenceAfterCriticalWrite();
    return { gerados: totalGerados, erros: mensagensErro };
  }, [companySavedContracts, selectedCompany, selicDailySeries, monthlyIndexMap, indicators]);

  /**
   * Gera o preview dos lançamentos que serão enviados ao balancete, sem gravar nada.
   * Retornado para que o LoanModule mostre o BalanceteEnvioModal de confirmação.
   */
  const handleGerarPreviewBalancete = useCallback(
    () =>
      generateBalancetePreview({
        companySavedContracts,
        companyName: selectedCompany,
        selicDailySeries,
        monthlyIndexMap,
        indicators,
        buildLoanParamsFn: buildLoanParams,
      }),
    [companySavedContracts, selectedCompany, selicDailySeries, monthlyIndexMap, indicators],
  );

  /**
   * Exporta os contratos cujos IDs estão em `contractIds` como um único arquivo TXT
   * no formato de importação Domínio.
   */
  const handleExportSelecionadosDominioTXT = useCallback(
    (
      contractIds: string[],
      onAlert?: (opts: { title: string; body: string; type?: 'info' | 'success' | 'warning' | 'error' }) => void,
    ) => {
      const displayAlert = onAlert || ((opts) => window.alert(opts.body));
      if (!contractIds.length) {
        displayAlert({ title: 'Atenção', body: 'Selecione ao menos um contrato para exportar.', type: 'warning' });
        return;
      }

      const selected = companySavedContracts.filter((c) => contractIds.includes(c.id));
      if (!selected.length) {
        displayAlert({ title: 'Erro', body: 'Nenhum contrato encontrado para os IDs selecionados.', type: 'error' });
        return;
      }

      const allBlocks: string[] = [];
      const erros: string[] = [];

      for (const saved of selected) {
        const tab = pickSimTabForEditor(saved.formState);
        const principal = parseCurrency(tab.principalStr);
        if (principal <= 0) {
          erros.push(`${saved.contractNumber || saved.id}: principal inválido, pulado.`);
          continue;
        }

        const params = buildLoanParams(
          saved,
          tab,
          selicDailySeries,
          monthlyIndexMap,
          tab.varMode === 'cdi' ? indicators?.cdiMensal : indicators?.selicMensal,
        );

        if (!loanParamsDatesValid(params)) {
          erros.push(`${saved.contractNumber || saved.id}: datas inválidas, pulado.`);
          continue;
        }

        const sched = calculateLoan(params);
        if (!sched.length) {
          erros.push(`${saved.contractNumber || saved.id}: cronograma vazio, pulado.`);
          continue;
        }

        const exportConfig = {
          accJurosAproDebit: tab.accJurosAproDebit,
          accJurosAproCredit: tab.accJurosAproCredit,
          accApropriacaoDebit: tab.accApropriacaoDebit,
          accApropriacaoCredit: tab.accApropriacaoCredit,
          accTransferenciaDebit: tab.accTransferenciaDebit,
          accTransferenciaCredit: tab.accTransferenciaCredit,
          accEmprestimoDebit: tab.accEmprestimoDebit,
          accEmprestimoCredit: tab.accEmprestimoCredit,
          valorIof: parseCurrency(tab.valorIofStr),
          accNaoPagoDebit: tab.accNaoPagoDebit,
          accNaoPagoCredit: tab.accNaoPagoCredit,
          accAtrasadoPagoDebit: tab.accAtrasadoPagoDebit,
          accAtrasadoPagoCredit: tab.accAtrasadoPagoCredit,
          codigoHistoricoDominio: tab.dominioCodigoHistoricoStr,
          complementoHistoricoDominio: tab.dominioComplementoHistoricoStr,
          dataGerarLancamentosAPartirStr: tab.dataGerarLancamentosAPartirStr?.trim() || undefined,
          dataGerarLancamentosAteStr: tab.dataGerarLancamentosAteStr?.trim() || undefined,
          omitTransferenciaLongoParaCurto: false,
        };

        const block = generateDominioTXT(sched, exportConfig);
        if (block.trim()) allBlocks.push(block.trim());
      }

      if (erros.length) {
        const msg = `Atenção — ${erros.length} contrato(s) ignorado(s):\n${erros.join('\n')}`;
        if (allBlocks.length === 0) {
          displayAlert({ title: 'Exportação Falhou', body: msg, type: 'error' });
          return;
        }
        displayAlert({ title: 'Exportação com Pendências', body: msg + '\n\nOs demais foram incluídos no TXT.', type: 'warning' });
      }

      const content = allBlocks.join('\n');
      const label =
        selected.length === 1
          ? (selected[0].contractNumber || 'contrato')
          : `${selected.length}_contratos`;
      downloadDominioTXT(content, `${label}_dominio_import.txt`);
    },
    [companySavedContracts, selicDailySeries, monthlyIndexMap, indicators],
  );

  const handleToggleUnpaidMonth = useCallback(
    (month: number) => {
      if (!activeContract) return;
      const currentAdj = activeContract.monthlyAdjustments ?? {};
      const existing = currentAdj[month] ?? {};
      const nextUnpaid = !existing.unpaid;
      const updatedMap = {
        ...currentAdj,
        [month]: { ...existing, unpaid: nextUnpaid },
      };
      // Only delete the entry when toggling OFF and there are no other adjustments remaining
      if (
        !nextUnpaid &&
        !existing.extraPayment &&
        !existing.prepaymentAmount &&
        !existing.paymentAmount &&
        !existing.interestAdjustment
      ) {
        delete updatedMap[month];
      }
      handleUpdate({ monthlyAdjustments: updatedMap });
    },
    [activeContract, handleUpdate],
  );

  const handleTogglePaidMonth = useCallback(
    (month: number) => {
      if (!activeContract) return;
      const currentAdj = activeContract.monthlyAdjustments ?? {};
      const existing = currentAdj[month] ?? {};
      const nextPaid = !existing.paid;
      const updatedMap = {
        ...currentAdj,
        [month]: { ...existing, paid: nextPaid },
      };
      if (!nextPaid && !existing.unpaid && !existing.extraPayment && !existing.prepaymentAmount && !existing.paymentAmount) {
        delete updatedMap[month];
      }
      handleUpdate({ monthlyAdjustments: updatedMap });
    },
    [activeContract, handleUpdate],
  );

  const handleSetPaymentAmountMonth = useCallback(
    (month: number, amount: number) => {
      if (!activeContract) return;
      const currentAdj = activeContract.monthlyAdjustments ?? {};
      const existing = currentAdj[month] ?? {};
      const paymentAmount = amount > 0 ? amount : undefined;
      const updatedMap = {
        ...currentAdj,
        [month]: {
          ...existing,
          paymentAmount,
          extraPayment: paymentAmount != null ? undefined : existing.extraPayment,
          prepaymentAmount: paymentAmount != null ? undefined : existing.prepaymentAmount,
        },
      };
      if (!existing.unpaid && !paymentAmount && !existing.extraPayment && !existing.prepaymentAmount) {
        delete updatedMap[month];
      }
      handleUpdate({ monthlyAdjustments: updatedMap });
    },
    [activeContract, handleUpdate],
  );

  const handleSetPrepaymentAmountMonth = useCallback(
    (month: number, amount: number) => {
      if (!activeContract) return;
      const currentAdj = activeContract.monthlyAdjustments ?? {};
      const existing = currentAdj[month] ?? {};
      const prepaymentAmount = amount > 0 ? amount : undefined;
      const updatedMap = {
        ...currentAdj,
        [month]: {
          ...existing,
          prepaymentAmount,
          paymentAmount: undefined,
          extraPayment: undefined,
          interestAdjustment: undefined,
        },
      };
      if (!existing.unpaid && !prepaymentAmount) {
        delete updatedMap[month];
      }
      handleUpdate({ monthlyAdjustments: updatedMap });
    },
    [activeContract, handleUpdate],
  );

  const handleSetInterestAdjustmentMonth = useCallback(
    (month: number, amount: number) => {
      if (!activeContract) return;
      const currentAdj = activeContract.monthlyAdjustments ?? {};
      const existing = currentAdj[month] ?? {};
      const interestAdjustment = amount !== 0 ? amount : undefined;
      const updatedMap = {
        ...currentAdj,
        [month]: {
          ...existing,
          interestAdjustment,
        },
      };
      // Only delete the entry when there's nothing else meaningful left
      if (
        !existing.unpaid &&
        !interestAdjustment &&
        !existing.paymentAmount &&
        !existing.extraPayment &&
        !existing.prepaymentAmount
      ) {
        delete updatedMap[month];
      }
      handleUpdate({ monthlyAdjustments: updatedMap });
    },
    [activeContract, handleUpdate],
  );

  /**
   * Registra pagamento atrasado: mantém unpaid=true (para gerar CP→LP da parcela bruta)
   * e salva o valor efetivamente pago (para gerar o LP→CP proporcional).
   * Se amount <= 0, remove apenas o paymentAmount mas mantém unpaid.
   */
  const handleSetAtrasadoPagoMonth = useCallback(
    (month: number, amount: number) => {
      if (!activeContract) return;
      const currentAdj = activeContract.monthlyAdjustments ?? {};
      const existing = currentAdj[month] ?? {};
      const paymentAmount = amount > 0 ? amount : undefined;
      const updatedMap = {
        ...currentAdj,
        [month]: {
          ...existing,
          unpaid: true,
          paymentAmount,
        },
      };
      handleUpdate({ monthlyAdjustments: updatedMap });
    },
    [activeContract, handleUpdate],
  );

  const handleClearMonthlyAdjustments = useCallback(() => {
    if (!activeContract) return;
    handleUpdate({ monthlyAdjustments: {} });
  }, [activeContract, handleUpdate]);

  /** Remove all adjustments for a single month in one atomic update. */
  const handleRemoveMonthAdjustment = useCallback(
    (month: number) => {
      if (!activeContract) return;
      const currentAdj = { ...(activeContract.monthlyAdjustments ?? {}) };
      delete currentAdj[month];
      handleUpdate({ monthlyAdjustments: currentAdj });
    },
    [activeContract, handleUpdate],
  );

  return {
    contracts,
    selectedId,
    setSelectedId,
    activeContract,
    schedule,
    rawSchedule,
    isCalculating,
    loanParams,
    loanAccountFields,
    activeTab,
    handleCreate,
    handleDuplicate,
    handleDelete,
    handleUpdate,
    handleUpdateInterestRate,
    handleUpdateGraceInterestRate,
    interestRateStr,
    graceInterestRateStr,
    patchActiveSimTab,
    clearAll,
    importLoanContracts,
    handleExportDominio,
    handleExportPDF,
    handleExportForDeploy,
    bcbReadiness,
    indicators,
    handleMandarTodosEmprestimosBalancete,
    handleExportSelecionadosDominioTXT,
    handleGerarPreviewBalancete,
    handleTogglePaidMonth,
    handleToggleUnpaidMonth,
    handleSetPaymentAmountMonth,
    handleSetAtrasadoPagoMonth,
    handleSetPrepaymentAmountMonth,
    handleSetInterestAdjustmentMonth,
    handleClearMonthlyAdjustments,
    handleRemoveMonthAdjustment,
    sacUnderpaymentWarning,
  };
}
