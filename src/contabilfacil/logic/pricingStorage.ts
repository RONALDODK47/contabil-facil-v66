import { persistCanonicalList } from '../../lib/simuladorBrowserStorage';
import { scheduleEyeVisionCloudPush } from './eyeVisionCloudPush';
import { belongsToCompany, normalizeCompanyName } from './companyWorkspace';
import { dedupePricingWorkspaceStock } from './pricingCalculator';
import { revertWorkspaceStockBeforeReplenish } from './pricingPreReplenishRestore';
import {
  createDefaultPricingWorkspace,
  normalizeGlobalPricingSettings,
  normalizeStockItem,
  type PricingSegment,
  type PricingWorkspace,
  type ServiceItem,
  type StockItem,
} from './pricingTypes';

export const PRICING_STORAGE_KEY = 'simulador_precificacao_v1';

type LegacyStockItem = Omit<StockItem, 'category'> & { category?: string };
type LegacyWorkspace = Omit<PricingWorkspace, 'stockItems' | 'serviceItems' | 'costExpenses'> & {
  serviceItems?: ServiceItem[];
  stockItems?: LegacyStockItem[];
  costExpenses?: Array<PricingWorkspace['costExpenses'][number] & { segment?: PricingSegment }>;
};

function stockItemToService(item: LegacyStockItem): ServiceItem {
  return {
    id: item.id,
    companyName: item.companyName,
    name: item.name,
    sku: item.sku,
    directCost: item.directCost > 0 ? item.directCost : item.purchasePrice,
    monthlyQty: item.monthlyQty,
    notes: item.notes,
    createdAt: item.createdAt,
  };
}

function mapLegacyStockItems(raw: LegacyStockItem[]): StockItem[] {
  return raw
    .filter((s) => s.category !== 'servico')
    .map((s) =>
      normalizeStockItem({
        ...s,
        category: (s.category ?? 'mercadoria') as StockItem['category'],
        unitPrice: s.unitPrice ?? 0,
        unitsPurchased: s.unitsPurchased ?? 0,
        measureQuantity: s.measureQuantity ?? 0,
      }),
    );
}

function normalizeWorkspace(raw: LegacyWorkspace): PricingWorkspace {
  const base = createDefaultPricingWorkspace(raw.companyName ?? '');
  const company = raw.companyName ?? '';

  let stockItems = mapLegacyStockItems(raw.stockItems ?? []);

  let workspace: PricingWorkspace = {
    ...base,
    ...raw,
    stockItems,
    serviceItems: [],
    costExpenses: (raw.costExpenses ?? []).map((c) => ({
      ...c,
      segment: (c.segment ?? 'mercadoria') as PricingSegment,
      kind: c.kind === 'variavel' ? 'variavel' : 'fixo',
    })),
    credits: raw.credits ?? [],
    settings: normalizeGlobalPricingSettings(raw.settings, base.settings),
    productOverrides: raw.productOverrides ?? {},
    // Snapshots legados não reverterão o estoque ao abrir — o que vale é stockItems gravado.
    stockBeforeReplenish: undefined,
  };

  const migratedServices = (raw.stockItems ?? [])
    .filter((s) => s.category === 'servico')
    .map(stockItemToService);
  workspace.serviceItems = [...(raw.serviceItems ?? []), ...migratedServices];

  const deduped = dedupePricingWorkspaceStock(workspace);
  return deduped.workspace;
}

export function loadAllPricingWorkspaces(): PricingWorkspace[] {
  try {
    const raw = localStorage.getItem(PRICING_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as LegacyWorkspace[]).map(normalizeWorkspace);
  } catch {
    return [];
  }
}

export function loadPricingWorkspace(companyName: string): PricingWorkspace {
  const normalized = normalizeCompanyName(companyName);
  const found = loadAllPricingWorkspaces().find((w) =>
    belongsToCompany(w.companyName, normalized),
  );
  return found ?? createDefaultPricingWorkspace(normalized);
}

export function savePricingWorkspace(workspace: PricingWorkspace): void {
  const normalized = normalizeCompanyName(workspace.companyName);
  const scoped: PricingWorkspace = {
    ...workspace,
    companyName: normalized,
    serviceItems: workspace.serviceItems ?? [],
    updatedAt: new Date().toISOString(),
  };
  const all = loadAllPricingWorkspaces();
  const others = all.filter((w) => !belongsToCompany(w.companyName, normalized));
  persistCanonicalList(PRICING_STORAGE_KEY, [...others, scoped]);
  scheduleEyeVisionCloudPush();
}

export function renamePricingWorkspaceCompany(oldName: string, newName: string): boolean {
  const oldNorm = normalizeCompanyName(oldName);
  const newNorm = normalizeCompanyName(newName);
  if (!oldNorm || !newNorm || oldNorm === newNorm) return false;

  const all = loadAllPricingWorkspaces();
  const found = all.find((w) => belongsToCompany(w.companyName, oldNorm));
  if (!found) return false;
  if (all.some((w) => belongsToCompany(w.companyName, newNorm) && !belongsToCompany(w.companyName, oldNorm))) {
    return false;
  }

  const others = all.filter((w) => !belongsToCompany(w.companyName, oldNorm));
  const renamed: PricingWorkspace = {
    ...found,
    companyName: newNorm,
    stockItems: found.stockItems.map((item) => ({ ...item, companyName: newNorm })),
    serviceItems: (found.serviceItems ?? []).map((item) => ({ ...item, companyName: newNorm })),
    costExpenses: found.costExpenses.map((item) => ({ ...item, companyName: newNorm })),
    credits: found.credits.map((item) => ({ ...item, companyName: newNorm })),
    updatedAt: new Date().toISOString(),
  };
  persistCanonicalList(PRICING_STORAGE_KEY, [...others, renamed]);
  scheduleEyeVisionCloudPush();
  return true;
}

export function deletePricingWorkspace(companyName: string): void {
  const normalized = normalizeCompanyName(companyName);
  const all = loadAllPricingWorkspaces();
  const next = all.filter((w) => !belongsToCompany(w.companyName, normalized));
  persistCanonicalList(PRICING_STORAGE_KEY, next);
  scheduleEyeVisionCloudPush();
}

/** Restaura manualmente insumo/MP ao estado antes do «acrescentar». */
export function restorePricingWorkspaceBeforeReplenish(
  companyName: string,
): PricingWorkspace | null {
  const normalized = normalizeCompanyName(companyName);
  const all = loadAllPricingWorkspaces();
  const found = all.find((w) => belongsToCompany(w.companyName, normalized));
  if (!found) return null;
  const restored = revertWorkspaceStockBeforeReplenish(found);
  savePricingWorkspace(restored);
  return restored;
}
