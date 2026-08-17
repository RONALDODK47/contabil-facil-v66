import { collectWorkspaceMaterialShortages } from './pricingCalculator';
import type {
  PricingWorkspace,
  StockItem,
  StockItemPreReplenishSnapshot,
} from './pricingTypes';
import {
  isStockCatalogPricingCategory,
  normalizeStockItem,
  roundStockMoney,
  stockTotalMeasure,
} from './pricingTypes';

export type { StockItemPreReplenishSnapshot };

const RESTORE_EPS = 1e-6;

export function extractStockItemPreReplenishSnapshot(item: StockItem): StockItemPreReplenishSnapshot {
  const unitsPurchased = item.unitsPurchased > 0 ? item.unitsPurchased : 0;
  const measureQuantity = item.measureQuantity > 0 ? item.measureQuantity : 0;
  return {
    unitPrice: item.unitPrice,
    purchasePrice: item.purchasePrice,
    priceInputMode: item.priceInputMode,
    unitsPurchased,
    measureQuantity,
    packageSize: stockTotalMeasure(item),
    savedAt: new Date().toISOString(),
  };
}

export function applyStockItemPreReplenishSnapshot(
  item: StockItem,
  snap: StockItemPreReplenishSnapshot,
): StockItem {
  return normalizeStockItem({
    ...item,
    unitPrice: snap.unitPrice,
    purchasePrice: snap.purchasePrice,
    priceInputMode: snap.priceInputMode,
    unitsPurchased: snap.unitsPurchased,
    measureQuantity: snap.measureQuantity,
    packageSize: snap.packageSize,
  });
}

/** Quanto o «acrescentar» provavelmente somou (simula estoque zerado nos PA). */
export function estimateReplenishQtyAdded(
  item: StockItem,
  allItems: StockItem[],
): number {
  const zeroed: StockItem = {
    ...item,
    unitsPurchased: 0,
    measureQuantity: 0,
    packageSize: 0,
  };
  const virtualItems = allItems.map((s) => (s.id === item.id ? zeroed : s));
  const shortages = collectWorkspaceMaterialShortages(virtualItems);
  const row = shortages.find((s) => s.stockItemId === item.id);
  return row?.shortfallQty ?? 0;
}

/**
 * Reconstrói preço e quantidade como antes do «acrescentar» (desfaz soma e inflação de R$).
 */
export function buildPreReplenishSnapshotForItem(
  item: StockItem,
  allItems: StockItem[],
): StockItemPreReplenishSnapshot {
  const currentTotal = stockTotalMeasure(item);
  const units = item.unitsPurchased > 0 ? item.unitsPurchased : 0;
  const purchase = item.purchasePrice > 0 ? item.purchasePrice : 0;
  const mode = item.priceInputMode ?? 'unit';

  const catalogTotal =
    item.catalogPackageSizeAtPricing != null && item.catalogPackageSizeAtPricing > 0
      ? item.catalogPackageSizeAtPricing
      : item.catalogUnitsAtPricing != null &&
          item.catalogUnitsAtPricing > 0 &&
          item.catalogMeasureAtPricing != null &&
          item.catalogMeasureAtPricing > 0
        ? item.catalogUnitsAtPricing * item.catalogMeasureAtPricing
        : null;

  const estimatedAdded = estimateReplenishQtyAdded(item, allItems);
  const addedByReplenish =
    catalogTotal != null && currentTotal > catalogTotal + RESTORE_EPS
      ? currentTotal - catalogTotal
      : estimatedAdded > RESTORE_EPS &&
          currentTotal <= estimatedAdded * 1.01 + RESTORE_EPS
        ? Math.min(estimatedAdded, currentTotal)
        : 0;

  let beforeUnits = units;
  let beforeMeasure = item.measureQuantity > 0 ? item.measureQuantity : 0;
  let beforeTotal = currentTotal;

  if (addedByReplenish > RESTORE_EPS && currentTotal >= addedByReplenish - RESTORE_EPS) {
    const afterSubtract = Math.max(0, currentTotal - addedByReplenish);
    if (afterSubtract <= RESTORE_EPS) {
      beforeUnits = 0;
      beforeTotal = 0;
      if (catalogTotal != null && catalogTotal > 0) {
        beforeUnits = item.catalogUnitsAtPricing ?? 0;
        beforeMeasure = item.catalogMeasureAtPricing ?? beforeMeasure;
        beforeTotal = catalogTotal;
      } else if (beforeMeasure > 0) {
        beforeTotal = 0;
      }
    } else {
      beforeTotal = afterSubtract;
      beforeUnits = units > 0 ? units : 0;
      beforeMeasure = item.measureQuantity > 0 ? item.measureQuantity : beforeMeasure;
    }
  } else if (catalogTotal != null) {
    beforeTotal = catalogTotal;
    beforeUnits = item.catalogUnitsAtPricing ?? units;
    beforeMeasure =
      item.catalogMeasureAtPricing ??
      (beforeUnits > 0 ? beforeTotal / beforeUnits : beforeMeasure);
  }

  let beforeUnit = item.unitPrice;
  let beforePurchase = purchase;

  if (item.catalogUnitPrice != null && item.catalogUnitPrice > 0) {
    beforeUnit = roundStockMoney(item.catalogUnitPrice, 6);
    if (item.catalogPurchasePrice != null && item.catalogPurchasePrice > 0) {
      beforePurchase = roundStockMoney(item.catalogPurchasePrice, 2);
    } else if (beforeUnits > 0) {
      beforePurchase = roundStockMoney(beforeUnit * beforeUnits, 2);
    }
  } else if (item.catalogPurchasePrice != null && item.catalogPurchasePrice > 0) {
    beforePurchase = roundStockMoney(item.catalogPurchasePrice, 2);
    beforeUnit =
      beforeUnits > 0
        ? roundStockMoney(beforePurchase / beforeUnits, 6)
        : beforeUnit;
  } else if (
    purchase > 0 &&
    currentTotal > RESTORE_EPS &&
    beforeTotal < currentTotal - RESTORE_EPS
  ) {
    beforePurchase = roundStockMoney((purchase * beforeTotal) / currentTotal, 2);
    beforeUnit =
      beforeUnits > 0
        ? roundStockMoney(beforePurchase / beforeUnits, 6)
        : beforeUnit;
  } else if (mode === 'unit' && beforeUnit > 0 && beforeUnits > 0) {
    beforePurchase = roundStockMoney(beforeUnit * beforeUnits, 2);
  }

  return {
    unitPrice: beforeUnit,
    purchasePrice: beforePurchase,
    priceInputMode: mode,
    unitsPurchased: beforeUnits,
    measureQuantity: beforeMeasure,
    packageSize: beforeTotal,
    savedAt: new Date().toISOString(),
  };
}

export function revertWorkspaceStockBeforeReplenish(
  workspace: PricingWorkspace,
): PricingWorkspace {
  const snapshots: Record<string, StockItemPreReplenishSnapshot> = {
    ...(workspace.stockBeforeReplenish ?? {}),
  };

  const stockItems = workspace.stockItems.map((item) => {
    if (!isStockCatalogPricingCategory(item.category)) return item;

    const snap =
      snapshots[item.id] ?? buildPreReplenishSnapshotForItem(item, workspace.stockItems);
    snapshots[item.id] = snap;
    return applyStockItemPreReplenishSnapshot(item, snap);
  });

  return {
    ...workspace,
    stockItems,
    stockBeforeReplenish: snapshots,
  };
}

export function capturePreReplenishSnapshotsForShortages(
  stockItems: StockItem[],
  stockItemIds: string[],
): Record<string, StockItemPreReplenishSnapshot> {
  const out: Record<string, StockItemPreReplenishSnapshot> = {};
  for (const id of stockItemIds) {
    const item = stockItems.find((s) => s.id === id);
    if (!item || !isStockCatalogPricingCategory(item.category)) continue;
    out[id] = extractStockItemPreReplenishSnapshot(item);
  }
  return out;
}
