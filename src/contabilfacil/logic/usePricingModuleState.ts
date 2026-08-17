import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  applyStockItemsUpdatePreservingPaCadastro,
  applyStockMaterialShortfallsForProduct,
  applyStockMaterialShortfallsToItems,
  applyStockReplenishOnlyThisItem,
  applyStockReplenishForSourceItem,
  collectWorkspaceMaterialShortages,
  computeDashboardBySegment,
  computeDashboardSummary,
  computePricingBreakdowns,
  dedupePricingWorkspaceStock,
  resolvePricingSettingsOnModeChange,
  sortByRentability,
  validateBomMaterialCoverage,
  type BomMaterialShortage,
} from './pricingCalculator';
import type { BomLine } from './pricingTypes';
import { loadPricingWorkspace, savePricingWorkspace } from './pricingStorage';
import type {
  CostExpenseItem,
  GlobalPricingSettings,
  PricingSegment,
  PricingWorkspace,
  ProductPricingOverride,
  RecoverableCredit,
  ServiceItem,
  StockCategory,
  StockItem,
} from './pricingTypes';
import {
  createEmptyServiceItem,
  createEmptyStockItem,
  normalizeGlobalPricingSettings,
  normalizeStockItem,
} from './pricingTypes';

export type PricingMainTab =
  | 'dashboard'
  | 'estoque'
  | 'custos'
  | 'creditos'
  | 'dre'
  | 'precificacao'
  | 'comparacao-aliquotas'
  | 'calculos'
  | 'roa';

export interface UsePricingModuleStateOptions {
  selectedCompany: string;
  storageVersion?: number;
}

/** Grava estoque já commitado (sem snapshots de «antes do acrescentar»). */
function commitWorkspaceStock(
  prev: PricingWorkspace,
  stockItems: StockItem[],
): PricingWorkspace {
  return dedupePricingWorkspaceStock({
    ...prev,
    stockItems,
    stockBeforeReplenish: undefined,
  }).workspace;
}

export function usePricingModuleState({
  selectedCompany,
  storageVersion = 0,
}: UsePricingModuleStateOptions) {
  const [workspace, setWorkspace] = useState<PricingWorkspace>(() =>
    loadPricingWorkspace(selectedCompany),
  );

  useEffect(() => {
    const loaded = loadPricingWorkspace(selectedCompany);
    const { workspace: deduped, removedCount } = dedupePricingWorkspaceStock(loaded);
    setWorkspace(deduped);
    if (removedCount > 0) {
      savePricingWorkspace(deduped);
    }
  }, [selectedCompany]);

  const persist = useCallback(
    (next: PricingWorkspace | ((prev: PricingWorkspace) => PricingWorkspace)) => {
      setWorkspace((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        savePricingWorkspace({ ...resolved, companyName: selectedCompany });
        return resolved;
      });
    },
    [selectedCompany],
  );

  const breakdowns = useMemo(() => computePricingBreakdowns(workspace), [workspace]);
  const dashboard = useMemo(() => computeDashboardSummary(breakdowns, workspace), [breakdowns, workspace]);
  const dashboardBySegment = useMemo(
    () => computeDashboardBySegment(breakdowns, workspace),
    [breakdowns, workspace],
  );
  const roaRanking = useMemo(() => sortByRentability(breakdowns, true), [breakdowns]);

  const upsertStock = useCallback(
    (item: StockItem) => {
      const normalized = normalizeStockItem(item);
      persist((prev) => {
        const merged = prev.stockItems.some((s) => s.id === normalized.id)
          ? prev.stockItems.map((s) => (s.id === normalized.id ? normalized : s))
          : [...prev.stockItems, { ...normalized, companyName: selectedCompany }];
        return commitWorkspaceStock(prev, merged);
      });
    },
    [persist, selectedCompany],
  );

  const removeStock = useCallback(
    (id: string) => {
      persist((prev) =>
        commitWorkspaceStock(
          {
            ...prev,
            productOverrides: Object.fromEntries(
              Object.entries(prev.productOverrides).filter(([k]) => k !== id),
            ),
          },
          prev.stockItems.filter((s) => s.id !== id),
        ),
      );
    },
    [persist],
  );

  const removeStocks = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      persist((prev) =>
        commitWorkspaceStock(
          {
            ...prev,
            productOverrides: Object.fromEntries(
              Object.entries(prev.productOverrides).filter(([k]) => !idSet.has(k)),
            ),
          },
          prev.stockItems.filter((s) => !idSet.has(s.id)),
        ),
      );
    },
    [persist],
  );

  const addStockMaterialShortfalls = useCallback(
    (shortages: Pick<BomMaterialShortage, 'stockItemId' | 'shortfallQty'>[]) => {
      if (shortages.length === 0) return;
      persist((prev) =>
        commitWorkspaceStock(
          prev,
          applyStockItemsUpdatePreservingPaCadastro(
            prev.stockItems,
            applyStockMaterialShortfallsToItems(prev.stockItems, shortages),
          ),
        ),
      );
    },
    [persist],
  );

  const addStockMaterialShortfallsForProduct = useCallback(
    (product: StockItem, options?: { bomOverride?: BomLine[] }) => {
      persist((prev) => {
        const coverage = validateBomMaterialCoverage(product, prev.stockItems, options);
        if (coverage.ok || coverage.shortages.length === 0) return prev;
        return commitWorkspaceStock(
          prev,
          applyStockItemsUpdatePreservingPaCadastro(
            prev.stockItems,
            applyStockMaterialShortfallsForProduct(prev.stockItems, product, options),
          ),
        );
      });
    },
    [persist],
  );

  /** Um clique no card: repõe só este insumo/MP/mercadoria (não os outros faltantes). */
  const replenishSingleStockItem = useCallback(
    (stockItemId: string) => {
      persist((prev) => {
        const nextItems = applyStockReplenishOnlyThisItem(prev.stockItems, stockItemId);
        if (nextItems === prev.stockItems) return prev;
        return commitWorkspaceStock(
          prev,
          applyStockItemsUpdatePreservingPaCadastro(prev.stockItems, nextItems),
        );
      });
    },
    [persist],
  );

  /** Repõe de uma vez o que falta para todos os PA com composição (recalcula no clique). */
  const addAllWorkspaceMaterialShortfalls = useCallback(() => {
    persist((prev) => {
      const shortages = collectWorkspaceMaterialShortages(prev.stockItems);
      if (shortages.length === 0) return prev;
      return commitWorkspaceStock(
        prev,
        applyStockItemsUpdatePreservingPaCadastro(
          prev.stockItems,
          applyStockMaterialShortfallsToItems(
            prev.stockItems,
            shortages.map((s) => ({
              stockItemId: s.stockItemId,
              shortfallQty: s.shortfallQty,
            })),
          ),
        ),
      );
    });
  }, [persist]);

  const addStock = useCallback(
    (category: StockCategory, stockScopeProductId?: string) => {
      const item = createEmptyStockItem(selectedCompany, category, stockScopeProductId);
      upsertStock(item);
      return item.id;
    },
    [selectedCompany, upsertStock],
  );

  const upsertService = useCallback(
    (item: ServiceItem) => {
      persist((prev) => ({
        ...prev,
        serviceItems: prev.serviceItems.some((s) => s.id === item.id)
          ? prev.serviceItems.map((s) => (s.id === item.id ? item : s))
          : [...prev.serviceItems, { ...item, companyName: selectedCompany }],
      }));
    },
    [persist, selectedCompany],
  );

  const removeService = useCallback(
    (id: string) => {
      persist((prev) => ({
        ...prev,
        serviceItems: prev.serviceItems.filter((s) => s.id !== id),
        productOverrides: Object.fromEntries(
          Object.entries(prev.productOverrides).filter(([k]) => k !== id),
        ),
      }));
    },
    [persist],
  );

  const addService = useCallback(() => {
    const item = createEmptyServiceItem(selectedCompany);
    upsertService(item);
    return item.id;
  }, [selectedCompany, upsertService]);

  const upsertCostExpense = useCallback(
    (item: CostExpenseItem) => {
      persist((prev) => ({
        ...prev,
        costExpenses: prev.costExpenses.some((c) => c.id === item.id)
          ? prev.costExpenses.map((c) => (c.id === item.id ? item : c))
          : [...prev.costExpenses, { ...item, companyName: selectedCompany }],
      }));
    },
    [persist, selectedCompany],
  );

  const removeCostExpense = useCallback(
    (id: string) => {
      persist((prev) => ({
        ...prev,
        costExpenses: prev.costExpenses.filter((c) => c.id !== id),
      }));
    },
    [persist],
  );

  const upsertCredit = useCallback(
    (item: RecoverableCredit) => {
      persist((prev) => ({
        ...prev,
        credits: prev.credits.some((c) => c.id === item.id)
          ? prev.credits.map((c) => (c.id === item.id ? item : c))
          : [...prev.credits, { ...item, companyName: selectedCompany }],
      }));
    },
    [persist, selectedCompany],
  );

  const removeCredit = useCallback(
    (id: string) => {
      persist((prev) => ({
        ...prev,
        credits: prev.credits.filter((c) => c.id !== id),
      }));
    },
    [persist],
  );

  const updateSettings = useCallback(
    (patch: Partial<GlobalPricingSettings>) => {
      persist((prev) => {
        let merged = { ...prev.settings, ...patch };
        if (patch.mode != null && patch.mode !== prev.settings.mode) {
          merged = { ...merged, ...resolvePricingSettingsOnModeChange(prev.settings, patch.mode) };
        }
        return {
          ...prev,
          settings: normalizeGlobalPricingSettings(merged, prev.settings),
        };
      });
    },
    [persist],
  );

  const updateProductOverride = useCallback(
    (productId: string, patch: ProductPricingOverride) => {
      persist((prev) => ({
        ...prev,
        productOverrides: {
          ...prev.productOverrides,
          [productId]: { ...prev.productOverrides[productId], ...patch },
        },
      }));
    },
    [persist],
  );

  const updateWorkspace = useCallback(
    (next: PricingWorkspace) => {
      persist(next);
    },
    [persist],
  );

  return {
    workspace,
    breakdowns,
    dashboard,
    dashboardBySegment,
    roaRanking,
    updateWorkspace,
    upsertStock,
    removeStock,
    removeStocks,
    addStockMaterialShortfalls,
    addStockMaterialShortfallsForProduct,
    addAllWorkspaceMaterialShortfalls,
    replenishSingleStockItem,
    addStock,
    upsertService,
    removeService,
    addService,
    upsertCostExpense,
    removeCostExpense,
    upsertCredit,
    removeCredit,
    updateSettings,
    updateProductOverride,
  };
}
