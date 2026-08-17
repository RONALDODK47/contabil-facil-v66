import type {
  BomLine,
  CostAllocationMode,
  GlobalPricingSettings,
  PricingBreakdown,
  PricingDashboardSummary,
  PriceDrivingFactor,
  PricingMode,
  PricingSegment,
  PricingWorkspace,
  ProductPricingOverride,
  SegmentDashboardSummary,
  ServiceItem,
  StockCategory,
  StockItem,
} from './pricingTypes';
import {
  computeStockCreditsSummary,
  stockItemCreditsTotal,
} from './pricingStockCredits';
import {
  computeBreakevenMetrics,
  computeConsolidatedProvisionRevenue,
  computeRequiredRevenueToCoverAndProfit,
  resolveEffectiveMarginPercent,
} from './pricingBreakeven';
import {
  BOM_LINE_UNIT_OPTIONS,
  PRICING_SEGMENT_FILTERS,
  PRICING_SEGMENT_LABELS,
  catalogStockMeasure,
  deriveStockUnitPrice,
  isStockCatalogPricingCategory,
  isStockMeasureCadastroComplete,
  isStockMeasureZeroedWithLegacy,
  resolveMeasurePerUnitForReplenish,
  resolveStockPriceInputMode,
  roundStockMoney,
  stockOnHandMeasure,
  stockPurchaseTotal,
  stockTotalMeasure,
  type MeasureDimension,
  type MeasureUnit,
  normalizePricingMode,
  normalizePricingPercent,
  normalizeStockItem,
} from './pricingTypes';

const UNIT_DIMENSION: Record<MeasureUnit, MeasureDimension> = {
  un: 'count',
  kg: 'mass',
  g: 'mass',
  l: 'volume',
  ml: 'volume',
  m: 'length',
  cm: 'length',
};

export function getMeasureDimension(unit: MeasureUnit): MeasureDimension {
  return UNIT_DIMENSION[unit];
}

export function measureUnitsSameDimension(a: MeasureUnit, b: MeasureUnit): boolean {
  return UNIT_DIMENSION[a] === UNIT_DIMENSION[b] && UNIT_DIMENSION[a] !== 'count';
}

/** Unidades disponíveis na linha da BOM (produto acabado). */
export function compatibleBomUnitsForStock(_item: StockItem | undefined): MeasureUnit[] {
  return [...BOM_LINE_UNIT_OPTIONS];
}

export function defaultBomUnitForStock(item: StockItem | undefined): MeasureUnit {
  if (!item) return 'un';
  const dim = UNIT_DIMENSION[item.packageUnit];
  if (dim === 'length') return item.packageUnit === 'm' ? 'cm' : item.packageUnit;
  if (dim === 'mass') return item.packageUnit === 'kg' ? 'g' : item.packageUnit;
  if (dim === 'volume') return item.packageUnit === 'l' ? 'ml' : item.packageUnit;
  return 'un';
}

interface PricedUnit {
  id: string;
  name: string;
  segment: PricingSegment;
  materialCost: number;
  bomDetail: { name: string; qty: string; cost: number }[];
  monthlyQty: number;
}

/** Unidade base interna: g (massa), ml (volume), cm (comprimento), un (contagem). */
export function toBaseUnit(quantity: number, unit: MeasureUnit): number {
  if (unit === 'kg') return quantity * 1000;
  if (unit === 'l') return quantity * 1000;
  if (unit === 'm') return quantity * 100;
  return quantity;
}

export function fromBaseUnit(baseQty: number, unit: MeasureUnit): number {
  if (unit === 'kg') return baseQty / 1000;
  if (unit === 'l') return baseQty / 1000;
  if (unit === 'm') return baseQty / 100;
  return baseQty;
}

export function convertMeasureQuantity(
  qty: number,
  from: MeasureUnit,
  to: MeasureUnit,
): number | null {
  if (from === to) return qty;
  if (UNIT_DIMENSION[from] !== UNIT_DIMENSION[to]) return null;
  if (UNIT_DIMENSION[from] === 'count') return null;
  return fromBaseUnit(toBaseUnit(qty, from), to);
}

export function formatQtyUnit(quantity: number, unit: MeasureUnit): string {
  const rounded = Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(3).replace(/\.?0+$/, '');
  return `${rounded} ${unit}`;
}

function roundPurchaseUnits(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 10) return n.toFixed(1).replace(/\.?0+$/, '');
  return n.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * Medida (g, ml, kg…) e quantidade em unidades compradas (un), para alertas de estoque.
 */
export function formatStockMaterialDemandLabel(source: StockItem, qtyInSourceUnit: number): string {
  if (qtyInSourceUnit <= 0) return '0';
  const dim = UNIT_DIMENSION[source.packageUnit];
  if (dim === 'count') {
    return formatQtyUnit(qtyInSourceUnit, 'un');
  }
  const measureLabel = formatQtyUnit(qtyInSourceUnit, source.packageUnit);
  const perPurchase =
    source.measureQuantity > 0
      ? source.measureQuantity
      : source.unitsPurchased > 0 && stockTotalMeasure(source) > 0
        ? stockTotalMeasure(source) / source.unitsPurchased
        : 0;
  if (perPurchase <= 0) return measureLabel;
  const purchaseUnits = qtyInSourceUnit / perPurchase;
  return `${measureLabel} (${roundPurchaseUnits(purchaseUnits)} un)`;
}

export function unitCostPerBase(item: StockItem): number {
  const catUnit = item.catalogUnitPrice ?? deriveStockUnitPrice(item);
  const perUnit = resolveMeasurePerUnitForReplenish(item);
  if (perUnit > 0 && catUnit > 0) {
    const perUnitBase = toBaseUnit(perUnit, item.packageUnit);
    if (perUnitBase > 0) return catUnit / perUnitBase;
  }
  const catalogPurchase =
    item.catalogPurchasePrice != null && item.catalogPurchasePrice > 0
      ? item.catalogPurchasePrice
      : stockPurchaseTotal(item);
  if (catalogPurchase <= 0) return 0;
  const catalog = catalogStockMeasure(item);
  if (catalog > 0) {
    const catalogBase = toBaseUnit(catalog, item.packageUnit);
    if (catalogBase > 0) return catalogPurchase / catalogBase;
  }
  const onHand = stockOnHandMeasure(item);
  if (onHand > 0) {
    const onHandBase = toBaseUnit(onHand, item.packageUnit);
    if (onHandBase > 0) return catalogPurchase / onHandBase;
  }
  return 0;
}

export function measureProrationCost(item: StockItem, qty: number, unit: MeasureUnit): number {
  if (qty <= 0) return 0;
  const lineDim = UNIT_DIMENSION[unit];
  if (lineDim === 'count') {
    return bomLineCostByCount(item, qty);
  }
  const sourceDim = UNIT_DIMENSION[item.packageUnit];
  if (sourceDim !== lineDim) return 0;
  return toBaseUnit(qty, unit) * unitCostPerBase(item);
}

/**
 * Base para rateio de linhas da BOM em un.
 * - Caixa/dúzia (1 un × 12 ovos): usa total contável (12).
 * - Saca com 80 ovos ou cadastro em g com 80 un: usa unidades compradas (80), não gramas totais.
 */
function totalCountableStockForUnBomLine(source: StockItem): number {
  const units = source.unitsPurchased > 0 ? source.unitsPurchased : 0;
  const perUnit = source.measureQuantity > 0 ? source.measureQuantity : 0;
  const measureTotal = stockTotalMeasure(source);
  const pkgDim = UNIT_DIMENSION[source.packageUnit];

  if (units > 0 && pkgDim === 'count' && perUnit > 1) {
    return measureTotal > 0 ? measureTotal : units * perUnit;
  }
  if (units > 0) return units;
  if (measureTotal > 0) return measureTotal;
  return 0;
}

/** Custo proporcional quando a linha da BOM usa un (ex.: 3 ovos de uma dúzia a R$ 15). */
function bomLineCostByCount(source: StockItem, lineQty: number): number {
  const purchase = stockPurchaseTotal(source) || source.purchasePrice;
  if (purchase <= 0 || lineQty <= 0) return 0;
  const total = totalCountableStockForUnBomLine(source);
  if (total <= 0) return 0;
  return (lineQty / total) * purchase;
}

export interface StockBomUsageLine {
  productId: string;
  productName: string;
  quantityLabel: string;
  quantityInItemUnit: number;
  cost: number;
  remainingPerPackageUnit: number;
}

/** Demanda mensal do insumo/MP (mesma regra do alerta de falta: qtd/mês ÷ rendimento × BOM). */
export function totalMonthlyMaterialDemandForSource(
  sourceId: string,
  allItems: StockItem[],
): number {
  const stockById = new Map(allItems.map((s) => [s.id, s]));
  let total = 0;
  for (const product of allItems) {
    if (product.category !== 'produto_acabado' || !product.useBom) continue;
    const scaled = scaledBomForFinishedTarget(product);
    if (!scaled) continue;
    const req = requiredMaterialBySourceId(scaled.bom, stockById);
    total += req.get(sourceId) ?? 0;
  }
  return total;
}

/** Uso do insumo/MP nas composições (BOM) de produtos acabados — alinhado a validateBomMaterialCoverage. */
export function computeStockBomMeasureUsage(
  item: StockItem,
  allItems: StockItem[],
): {
  lines: StockBomUsageLine[];
  remainingPerUnit: number;
  remainingTotal: number;
} {
  const stockById = new Map(allItems.map((s) => [s.id, s]));
  const available = availableStockQtyForSource(item, allItems);
  const unitsPurchased = item.unitsPurchased > 0 ? item.unitsPurchased : 0;
  const measurePerUnit =
    item.measureQuantity > 0
      ? item.measureQuantity
      : unitsPurchased > 0 && available > 0
        ? available / unitsPurchased
        : 0;
  const lines: StockBomUsageLine[] = [];

  for (const product of allItems) {
    if (product.category !== 'produto_acabado' || !product.useBom) continue;
    const scaled = scaledBomForFinishedTarget(product);
    if (!scaled) continue;

    const req = requiredMaterialBySourceId(scaled.bom, stockById);
    const need = req.get(item.id) ?? 0;
    if (need <= 0) continue;

    let cost = 0;
    for (const line of scaled.bom) {
      if (line.stockItemId !== item.id || line.quantity <= 0) continue;
      cost += bomLineCost(stockById, line.quantity, line.unit, line.stockItemId);
    }

    lines.push({
      productId: product.id,
      productName: product.name || 'Sem nome',
      quantityLabel: formatStockMaterialDemandLabel(item, need),
      quantityInItemUnit: need,
      cost,
      remainingPerPackageUnit: Math.max(0, measurePerUnit - need),
    });
  }

  const totalUsed = lines.reduce((sum, line) => sum + line.quantityInItemUnit, 0);
  const remainingTotal = Math.max(0, available - totalUsed);
  const remainingPerUnit =
    unitsPurchased > 0 ? remainingTotal / unitsPurchased : remainingTotal;

  return { lines, remainingPerUnit, remainingTotal };
}

export interface StockRemainingAfterBom {
  measurePerUnit: number;
  measureTotal: number;
  valuePerUnit: number;
  valueTotal: number;
  usedCostTotal: number;
  usage: ReturnType<typeof computeStockBomMeasureUsage>;
}

/** Medida e valor restantes do insumo/MP após uso nas composições (BOM). */
export function computeStockRemainingAfterBom(
  item: StockItem,
  allItems: StockItem[],
): StockRemainingAfterBom {
  const available = availableStockQtyForSource(item, allItems);
  const unitsPurchased = item.unitsPurchased > 0 ? item.unitsPurchased : 0;
  const storedMeasureTotal = stockTotalMeasure(item);
  const measureQuantity =
    item.measureQuantity > 0
      ? item.measureQuantity
      : unitsPurchased > 0 && available > 0
        ? available / unitsPurchased
        : 0;
  const unitPrice = deriveStockUnitPrice(item);
  const purchaseTotal = stockPurchaseTotal(item);
  const usage = computeStockBomMeasureUsage(item, allItems);
  const totalUsed = totalMonthlyMaterialDemandForSource(item.id, allItems);

  if (usage.lines.length === 0 || totalUsed <= BOM_COVERAGE_EPS) {
    return {
      measurePerUnit: measureQuantity,
      measureTotal: available > 0 ? available : storedMeasureTotal,
      valuePerUnit: unitPrice,
      valueTotal: purchaseTotal,
      usedCostTotal: 0,
      usage,
    };
  }

  const usedCostTotal = roundStockMoney(
    usage.lines.reduce((sum, line) => sum + line.cost, 0),
    2,
  );
  const valueTotal = roundStockMoney(Math.max(0, purchaseTotal - usedCostTotal), 2);
  const remainingQty = Math.max(0, available - totalUsed);
  const valuePerUnit =
    unitsPurchased > 0
      ? roundStockMoney(valueTotal / unitsPurchased, 6)
      : remainingQty > 0
        ? roundStockMoney(valueTotal / remainingQty, 6)
        : 0;

  return {
    measurePerUnit: usage.remainingPerUnit,
    measureTotal: usage.remainingTotal,
    valuePerUnit,
    valueTotal,
    usedCostTotal,
    usage,
  };
}

function remainingRatio(remaining: number, original: number): number {
  if (original <= 0) return 1;
  return Math.max(0, Math.min(1, remaining / original));
}

export function bomLineCost(
  stockById: Map<string, StockItem>,
  lineQty: number,
  lineUnit: MeasureUnit,
  sourceId: string,
): number {
  const source = stockById.get(sourceId);
  if (!source || lineQty <= 0) return 0;
  const lineDim = UNIT_DIMENSION[lineUnit];
  if (lineDim === 'count') {
    return bomLineCostByCount(source, lineQty);
  }
  const sourceDim = UNIT_DIMENSION[source.packageUnit];
  if (sourceDim !== lineDim) return 0;
  const usedBase = toBaseUnit(lineQty, lineUnit);
  return usedBase * unitCostPerBase(source);
}

function materialCostFromBomLines(
  bomLines: BomLine[],
  stockById: Map<string, StockItem>,
): { cost: number; detail: { name: string; qty: string; cost: number }[]; compositionTotal: number } {
  const detail = bomLines.map((line) => {
    const src = stockById.get(line.stockItemId);
    const cost = bomLineCost(stockById, line.quantity, line.unit, line.stockItemId);
    return {
      name: src?.name ?? 'Item removido',
      qty: formatQtyUnit(line.quantity, line.unit),
      cost,
    };
  });
  const compositionTotal = sumBomDetailCosts(detail);
  return { cost: compositionTotal, detail, compositionTotal };
}

/** Custo material = soma do custo (R$) de cada linha da composição ×1. */
export function sumBomDetailCosts(detail: ReadonlyArray<{ cost: number }>): number {
  return detail.reduce((s, d) => s + d.cost, 0);
}

/** Soma dos R$ de cada linha da BOM como exibida (composição na tela). */
export function compositionMaterialTotalFromBom(
  bom: BomLine[],
  stockById: Map<string, StockItem>,
): number {
  return bom.reduce(
    (sum, line) => sum + bomLineCost(stockById, line.quantity, line.unit, line.stockItemId),
    0,
  );
}

/** Custo material por unidade pronta = total da composição ÷ quantidade de produção. */
export function materialUnitCostFromCompositionTotal(
  compositionTotal: number,
  productionQty: number,
): number {
  if (compositionTotal <= 0) return 0;
  const qty = productionQty > 0 ? productionQty : 1;
  return compositionTotal / qty;
}

export type CompositionCostSummary = {
  /** Rendimento informado (un. de produto acabado por receita). */
  recipeYieldQty: number;
  /** Soma em R$ das linhas da BOM (receita inteira). */
  recipeBatchTotalCost: number;
  /** Custo por 1 un. pronta = recipeBatchTotalCost ÷ recipeYieldQty. */
  unitMaterialCost: number;
};

/** Resumo de custo da composição: total da receita e valor por unidade (sem rendimento no divisor da qtd). */
export function compositionCostSummary(
  bom: BomLine[],
  stockById: Map<string, StockItem>,
  yieldQty: number,
): CompositionCostSummary {
  const recipeYieldQty = yieldQty > 0 ? yieldQty : 1;
  const recipeBatchTotalCost = compositionMaterialTotalFromBom(bom, stockById);
  return {
    recipeYieldQty,
    recipeBatchTotalCost,
    unitMaterialCost: materialUnitCostFromCompositionTotal(
      recipeBatchTotalCost,
      recipeYieldQty,
    ),
  };
}

/** Custo da composição: total do lote da receita (insumos para o rendimento), custo/un. = total ÷ rendimento. */
export function compositionCostSummaryForStockItem(
  item: Pick<
    StockItem,
    | 'bom'
    | 'monthlyQty'
    | 'recipeYieldQty'
    | 'recipeQuantityBaseBom'
    | 'recipeQuantityBaseProductionQty'
  >,
  stockById: Map<string, StockItem>,
): CompositionCostSummary {
  const recipeYieldQty = resolveRecipeYieldQty(item);
  const recipeBatchTotalCost = compositionMaterialTotalFromBom(item.bom, stockById);
  return {
    recipeYieldQty,
    recipeBatchTotalCost,
    unitMaterialCost: materialUnitCostFromCompositionTotal(
      recipeBatchTotalCost,
      recipeYieldQty,
    ),
  };
}

/** Linhas da BOM parecem multiplicadas pela qtd/mês (ex.: 7 un de MP para 7 pudins). */
export function bomLinesScaledByMonthlyQty(bom: BomLine[], baseQty: number): boolean {
  if (baseQty <= 1 || bom.length === 0) return false;
  const isIntegerMultiple = (lineQty: number) => {
    const ratio = lineQty / baseQty;
    return ratio >= 1 && Math.abs(ratio - Math.round(ratio)) < 0.001;
  };
  return bom.every((line) => line.quantity > 0 && isIntegerMultiple(line.quantity));
}

/**
 * BOM na tela salva como lote do mês (soma das linhas ≈ receita ×1 × qtd base),
 * e não como receita para 1 unidade.
 */
export function bomStoredAsMonthlyBatch(
  bom: BomLine[],
  bomTotal: number,
  recipeUnitCost: number,
  baseQty: number,
): boolean {
  if (baseQty <= 1 || bomTotal <= 0 || recipeUnitCost <= 0) return false;
  if (bomLinesScaledByMonthlyQty(bom, baseQty)) return true;
  const batchTol = Math.max(0.05, recipeUnitCost * baseQty * 0.02);
  if (Math.abs(bomTotal - recipeUnitCost * baseQty) <= batchTol) return true;
  const unitTol = Math.max(0.02, recipeUnitCost * 0.02);
  return bomTotal > recipeUnitCost * 1.02 && Math.abs(bomTotal - recipeUnitCost) <= unitTol;
}

/**
 * Unidades por lançamento de estoque (produto acabado: qtd em estoque; legado: recipeYieldQty).
 * Substitui o campo “rendimento” na UI — use vários lançamentos + multiplicador.
 */
export function resolveRecipeYieldQty(
  item: Pick<
    StockItem,
    'recipeYieldQty' | 'recipeQuantityBaseProductionQty'
  >,
): number {
  if (item.recipeYieldQty != null && item.recipeYieldQty > 0) return item.recipeYieldQty;
  if (item.recipeQuantityBaseProductionQty != null && item.recipeQuantityBaseProductionQty > 0) {
    return item.recipeQuantityBaseProductionQty;
  }
  return 1;
}

/** Rendimento da receita (un./lote) — não usa qtd de produtos acabados em estoque. */
export function resolveRecipeBatchYield(
  item: Pick<StockItem, 'recipeYieldQty' | 'recipeQuantityBaseProductionQty'>,
): number {
  if (item.recipeYieldQty != null && item.recipeYieldQty > 0) return item.recipeYieldQty;
  if (item.recipeQuantityBaseProductionQty != null && item.recipeQuantityBaseProductionQty > 0) {
    return item.recipeQuantityBaseProductionQty;
  }
  return 1;
}

/** Quantas vezes a receita (BOM) é repetida no mês: qtd/mês ÷ rendimento. */
export function recipeBatchesPerMonth(
  item: Pick<StockItem, 'monthlyQty' | 'recipeYieldQty' | 'recipeQuantityBaseProductionQty'>,
): number {
  const batchYield = resolveRecipeBatchYield(item);
  if (batchYield <= 0) return 1;
  if (item.monthlyQty > 0) return item.monthlyQty / batchYield;
  return 1;
}

/** Unidades prontas demandadas no mês (qtd/mês) ou um lote (rendimento) se vendas não informadas. */
export function resolveMaterialDemandFinishedUnits(
  item: Pick<StockItem, 'monthlyQty' | 'recipeYieldQty' | 'recipeQuantityBaseProductionQty'>,
): number {
  if (item.monthlyQty > 0) return item.monthlyQty;
  return resolveRecipeBatchYield(item);
}

/** @deprecated Use resolveMaterialDemandFinishedUnits */
export function resolveFinishedProductionTarget(
  item: Pick<StockItem, 'monthlyQty' | 'recipeYieldQty' | 'recipeQuantityBaseProductionQty'>,
): number {
  return resolveMaterialDemandFinishedUnits(item);
}

function bomLineQtyInSourceUnit(line: BomLine, source: StockItem): number | null {
  if (line.quantity <= 0) return 0;
  if (UNIT_DIMENSION[line.unit] === 'count' && source.unitsPurchased > 0) {
    return line.quantity;
  }
  let qty = convertMeasureQuantity(line.quantity, line.unit, source.packageUnit);
  if (qty === null && UNIT_DIMENSION[line.unit] === 'count' && UNIT_DIMENSION[source.packageUnit] === 'count') {
    qty = line.quantity;
  }
  if (qty === null && UNIT_DIMENSION[line.unit] === 'count') {
    qty = line.quantity;
  }
  return qty;
}

function stockQtyAvailableRaw(source: StockItem): number {
  return stockOnHandMeasure(source);
}

/** Estoque disponível para BOM e cards (sem teto artificial). */
function availableStockQtyForSource(source: StockItem, _allItems?: StockItem[]): number {
  return stockQtyAvailableRaw(source);
}

/** Estoque já reposto — «Acrescentar» não passa do uso mensal dos PA. */
function availableStockQtyForReplenishCap(
  source: StockItem,
  allItems: StockItem[],
): number {
  const raw = stockQtyAvailableRaw(source);
  const monthly = monthlyMaterialDemandForSource(source.id, allItems);
  if (monthly > 0) return Math.min(raw, monthly);
  return raw;
}

/** Estoque disponível na mesma base da linha da BOM (un vs g/ml). */
function availableStockQtyForBomLine(source: StockItem, line: BomLine): number {
  return availableStockQtyForSource(source);
}

function requiredMaterialBySourceId(
  bom: BomLine[],
  stockById: Map<string, StockItem>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of bom) {
    if (!line.stockItemId || line.quantity <= 0) continue;
    const src = stockById.get(line.stockItemId);
    if (!src) continue;
    const qty = bomLineQtyInSourceUnit(line, src);
    if (qty === null) continue;
    map.set(line.stockItemId, (map.get(line.stockItemId) ?? 0) + qty);
  }
  return map;
}

function scaledBomForFinishedTarget(
  product: StockItem,
  bomOverride?: BomLine[],
): { bom: BomLine[]; scaleFactor: number; baseProductionQty: number } | null {
  const resolved = resolveRecipeQuantityBase(
    bomOverride ? { ...product, bom: bomOverride } : product,
  );
  const baseBom = bomOverride ?? resolved.bom;
  const baseProductionQty = resolved.productionQty > 0 ? resolved.productionQty : 1;
  if (baseBom.length === 0 || baseBom.every((l) => l.quantity <= 0 || !l.stockItemId)) {
    return null;
  }
  const target = resolveMaterialDemandFinishedUnits(product);
  const scaleFactor = target / baseProductionQty;
  const scaled = scaleBomRecipe(baseBom, baseProductionQty, scaleFactor);
  return { bom: scaled.bom, scaleFactor, baseProductionQty };
}

export type BomMaterialShortage = {
  stockItemId: string;
  name: string;
  category: StockCategory;
  /** Falta na unidade interna do item (packageUnit / medida total). */
  shortfallQty: number;
  /** Quantidade usada na composição por receita (não altera ao repor estoque). */
  perRecipeLabel?: string;
  requiredLabel: string;
  availableLabel: string;
  shortfallLabel: string;
};

const BOM_COVERAGE_EPS = 1e-6;

/** Quantidade a acrescentar no estoque (arredonda para cima — evita falta residual por float). */
function shortfallQtyForReplenish(qty: number): number {
  if (qty <= BOM_COVERAGE_EPS) return 0;
  return Math.ceil(qty * 1_000_000) / 1_000_000;
}

/** Unidades compradas a somar a partir da falta em g/ml. */
function unitsToAddForGramShortfall(perUnit: number, shortfallG: number): number {
  if (perUnit <= BOM_COVERAGE_EPS || shortfallG <= BOM_COVERAGE_EPS) return 0;
  return Math.ceil(shortfallG / perUnit - BOM_COVERAGE_EPS);
}

/** Gramas já no estoque físico (não usa cadastro qtd×medida como saldo). */
function replenishStockOnHandBase(
  item: Pick<StockItem, 'unitsPurchased' | 'measureQuantity' | 'packageSize' | 'packageUnit'>,
): number {
  if (isStockMeasureZeroedWithLegacy(item)) return 0;
  return item.packageSize > 0 ? item.packageSize : 0;
}

/** Consumo mensal do insumo/MP em todas as composições (qtd/mês ÷ rendimento × BOM). */
export function monthlyMaterialDemandForSource(
  sourceId: string,
  allItems: StockItem[],
): number {
  return totalMonthlyMaterialDemandForSource(sourceId, allItems);
}

/**
 * «Acrescentar» só pode somar até o uso mensal do sistema e só o que falta para cobrir um mês.
 * Medida/un do cadastro não muda; sobe packageSize (se medida/un preenchida) e/ou qtd comprada.
 */
export function replenishQtyCappedForMonthlyUse(
  item: StockItem,
  allItems: StockItem[],
  proposedQty: number,
): number {
  if (!isStockMeasureCadastroComplete(item)) return 0;
  if (proposedQty <= BOM_COVERAGE_EPS) return 0;
  const monthly = monthlyMaterialDemandForSource(item.id, allItems);
  if (monthly <= BOM_COVERAGE_EPS) {
    return shortfallQtyForReplenish(proposedQty);
  }
  const available = availableStockQtyForReplenishCap(item, allItems);
  const needToCoverMonth = Math.max(0, monthly - available);
  const depleted = stockItemDepletedByBom(item, allItems);
  if (!depleted && needToCoverMonth <= BOM_COVERAGE_EPS) return 0;
  const cap = depleted && needToCoverMonth <= BOM_COVERAGE_EPS
    ? monthly
    : Math.min(proposedQty, monthly, needToCoverMonth);
  return shortfallQtyForReplenish(cap);
}

function bomMaterialShortageWithQty(
  item: StockItem,
  allItems: StockItem[],
  shortfallQty: number,
  labels?: Partial<Pick<BomMaterialShortage, 'requiredLabel' | 'availableLabel' | 'perRecipeLabel'>>,
): BomMaterialShortage {
  const need = monthlyMaterialDemandForSource(item.id, allItems);
  const available = availableStockQtyForSource(item, allItems);
  return {
    stockItemId: item.id,
    name: item.name || 'Sem nome',
    category: item.category,
    shortfallQty,
    perRecipeLabel: labels?.perRecipeLabel,
    requiredLabel: labels?.requiredLabel ?? formatStockMaterialDemandLabel(item, need),
    availableLabel: labels?.availableLabel ?? formatStockMaterialDemandLabel(item, available),
    shortfallLabel: formatStockMaterialDemandLabel(item, shortfallQty),
  };
}

/** Campos do produto acabado que só o usuário altera na aba PA — estoque/BOM de consumo não podem sobrescrever. */
export type ProdutoAcabadoCadastroSnapshot = Pick<
  StockItem,
  | 'bom'
  | 'recipeQuantityBaseBom'
  | 'recipeQuantityBaseProductionQty'
  | 'recipeYieldQty'
  | 'monthlyQty'
  | 'useBom'
  | 'directCost'
  | 'recipeQuantityDoubles'
>;

export function snapshotProdutoAcabadoCadastro(item: StockItem): ProdutoAcabadoCadastroSnapshot {
  return {
    bom: cloneBomLines(item.bom),
    recipeQuantityBaseBom: item.recipeQuantityBaseBom?.map((line) => ({ ...line })),
    recipeQuantityBaseProductionQty: item.recipeQuantityBaseProductionQty,
    recipeYieldQty: item.recipeYieldQty,
    monthlyQty: item.monthlyQty,
    useBom: item.useBom,
    directCost: item.directCost,
    recipeQuantityDoubles: item.recipeQuantityDoubles,
  };
}

export function restoreProdutoAcabadoCadastro(
  item: StockItem,
  snap: ProdutoAcabadoCadastroSnapshot,
): StockItem {
  return {
    ...item,
    ...snap,
    recipeQuantityBaseBom: snap.recipeQuantityBaseBom?.map((line) => ({ ...line })),
    bom: cloneBomLines(snap.bom),
  };
}

function snapshotAllProdutoAcabadoCadastro(
  stockItems: StockItem[],
): Map<string, ProdutoAcabadoCadastroSnapshot> {
  return new Map(
    stockItems
      .filter((s) => s.category === 'produto_acabado')
      .map((s) => [s.id, snapshotProdutoAcabadoCadastro(s)] as const),
  );
}

function restoreAllProdutoAcabadoCadastro(
  stockItems: StockItem[],
  snapshots: Map<string, ProdutoAcabadoCadastroSnapshot>,
): StockItem[] {
  return stockItems.map((item) => {
    const snap = snapshots.get(item.id);
    return snap ? restoreProdutoAcabadoCadastro(item, snap) : item;
  });
}

/**
 * Após repor insumo/MP/mercadoria ou deduplicar estoque, mantém o cadastro digitado na aba PA.
 */
export function applyStockItemsUpdatePreservingPaCadastro(
  beforeItems: StockItem[],
  afterItems: StockItem[],
): StockItem[] {
  return restoreAllProdutoAcabadoCadastro(afterItems, snapshotAllProdutoAcabadoCadastro(beforeItems));
}

/** Escopo da reposição: workspace = todos os PA; product = só a composição do PA em edição. */
export type StockReplenishScope = 'workspace' | 'product';

/**
 * Aplica falta de material no estoque já deduplicado (ids remapeados para o lançamento mantido).
 * Nunca altera composição (BOM) de produto acabado — só insumo/MP/mercadoria.
 */
export function applyStockMaterialShortfallsToItems(
  stockItems: StockItem[],
  shortages: Pick<BomMaterialShortage, 'stockItemId' | 'shortfallQty'>[],
  options?: { scope?: StockReplenishScope },
): StockItem[] {
  const scope = options?.scope ?? 'workspace';
  if (shortages.length === 0) return stockItems;

  const paSnapshots = snapshotAllProdutoAcabadoCadastro(stockItems);

  const { items: dedupedItems, idRemap } = dedupeStockItemsByName(stockItems);
  const addByTargetId = new Map<string, number>();

  for (const s of shortages) {
    if (s.shortfallQty <= BOM_COVERAGE_EPS) continue;
    const targetId = idRemap.get(s.stockItemId) ?? s.stockItemId;
    addByTargetId.set(targetId, (addByTargetId.get(targetId) ?? 0) + s.shortfallQty);
  }

  return dedupedItems.map((item) => {
    const paSnap = paSnapshots.get(item.id);
    if (paSnap) {
      return restoreProdutoAcabadoCadastro(item, paSnap);
    }
    if (item.category === 'produto_acabado') {
      return item;
    }
    const add = addByTargetId.get(item.id);
    if (add == null || add <= BOM_COVERAGE_EPS) return item;
    const capped =
      scope === 'product'
        ? shortfallQtyForReplenish(add)
        : replenishQtyCappedForMonthlyUse(item, stockItems, add);
    if (capped <= BOM_COVERAGE_EPS) return item;
    return applyMaterialShortfallToStock(item, capped, stockItems, { scope });
  });
}

/**
 * Repõe em um único passo todo material que falta para o PA (composição + qtd/mês atuais).
 */
export function applyStockMaterialShortfallsForProduct(
  stockItems: StockItem[],
  product: StockItem,
  options?: { bomOverride?: BomLine[] },
): StockItem[] {
  const coverage = validateBomMaterialCoverage(product, stockItems, options);
  if (coverage.ok || coverage.shortages.length === 0) return stockItems;
  return applyStockMaterialShortfallsToItems(
    stockItems,
    coverage.shortages.map((s) => ({
      stockItemId: s.stockItemId,
      shortfallQty: s.shortfallQty,
    })),
    { scope: 'product' },
  );
}

/**
 * R$/un comprada — usa o total pago ÷ qtd (respeita cadastro em Total R$ ou Unitário).
 */
export function resolveStockUnitPriceFromPurchase(
  item: Pick<StockItem, 'unitPrice' | 'purchasePrice' | 'unitsPurchased'>,
): number {
  if (item.unitPrice > 0) return roundStockMoney(item.unitPrice, 6);
  const units = item.unitsPurchased > 0 ? item.unitsPurchased : 0;
  if (units <= 0) return 0;
  const purchase = stockPurchaseTotal(item);
  if (purchase > 0) return roundStockMoney(purchase / units, 6);
  return deriveStockUnitPrice(item);
}

function lockStockUnitPriceForReplenish(item: StockItem): number {
  if (item.catalogUnitPrice != null && item.catalogUnitPrice > 0) {
    return roundStockMoney(item.catalogUnitPrice, 6);
  }
  if (item.unitPrice > 0) return roundStockMoney(item.unitPrice, 6);
  return resolveStockUnitPriceFromPurchase(item);
}

function lockStockPurchaseForReplenish(item: StockItem): number {
  if (item.catalogPurchasePrice != null && item.catalogPurchasePrice > 0) {
    return roundStockMoney(item.catalogPurchasePrice, 2);
  }
  return stockPurchaseTotal(item);
}

/** Aplica quantidade reposta e restaura preço do catálogo (não recalcula unitário pelo total÷un). */
function finishReplenishStockItem(
  item: StockItem,
  qtyPatch: Pick<StockItem, 'unitsPurchased' | 'measureQuantity' | 'packageSize'>,
  options?: { purchasePrice?: number },
): StockItem {
  const next: StockItem = { ...item, ...qtyPatch };
  const purchase =
    options?.purchasePrice != null ? options.purchasePrice : item.purchasePrice;

  if (!isStockCatalogPricingCategory(item.category)) {
    return normalizeStockItem({ ...next, purchasePrice: purchase });
  }

  const mode = resolveStockPriceInputMode(item);
  const catUnit = item.catalogUnitPrice;
  const catalogUnits = next.unitsPurchased > 0 ? next.unitsPurchased : 0;

  if (mode === 'unit' && catUnit != null && catUnit > 0) {
    const purchasePrice =
      purchase > 0
        ? roundStockMoney(purchase, 2)
        : catalogUnits > 0
          ? roundStockMoney(catUnit * catalogUnits, 2)
          : 0;
    return normalizeStockItem({
      ...next,
      unitPrice: roundStockMoney(catUnit, 6),
      purchasePrice,
      priceInputMode: 'unit',
      catalogUnitPrice: roundStockMoney(catUnit, 6),
      catalogPurchasePrice:
        item.catalogPurchasePrice != null && item.catalogPurchasePrice > 0
          ? roundStockMoney(item.catalogPurchasePrice, 2)
          : purchasePrice,
      catalogUnitsAtPricing: catalogUnits,
    });
  }

  const purchasePrice = roundStockMoney(purchase, 2);
  const lockedUnit = lockStockUnitPriceForReplenish(item);
  const unitPrice =
    lockedUnit > 0
      ? roundStockMoney(lockedUnit, 6)
      : catalogUnits > 0
        ? roundStockMoney(purchasePrice / catalogUnits, 6)
        : catUnit != null && catUnit > 0
          ? roundStockMoney(catUnit, 6)
          : item.unitPrice;
  return {
    ...next,
    purchasePrice,
    unitPrice,
    priceInputMode: mode === 'total' ? 'total' : item.priceInputMode,
  };
}

/** Custo em R$ por unidade de medida no estoque (g, ml…) com base no total pago. */
export function resolveStockCostPerMeasureUnit(
  item: Pick<
    StockItem,
    'unitPrice' | 'purchasePrice' | 'unitsPurchased' | 'measureQuantity' | 'packageSize' | 'packageUnit'
  >,
): number {
  const purchase = stockPurchaseTotal(item);
  const total = stockTotalMeasure(item);
  if (total > 0 && purchase > 0) return purchase / total;
  const units = item.unitsPurchased > 0 ? item.unitsPurchased : 0;
  const unitPrice = resolveStockUnitPriceFromPurchase(item);
  if (units > 0 && item.measureQuantity > 0 && unitPrice > 0) {
    return unitPrice / item.measureQuantity;
  }
  return 0;
}

/**
 * Soma ao estoque a quantidade que falta (medida ou un).
 * Mantém R$/un e a taxa do total pago — só aumenta qtd/medida e o total em R$.
 */
export function applyMaterialShortfallToStock(
  item: StockItem,
  shortfallInSourceUnit: number,
  allItems: StockItem[] = [],
  options?: { scope?: StockReplenishScope },
): StockItem {
  if (shortfallInSourceUnit <= BOM_COVERAGE_EPS) return normalizeStockItem(item);
  if (!isStockMeasureCadastroComplete(item)) return normalizeStockItem(item);

  const scope = options?.scope ?? 'workspace';
  let toAdd = shortfallInSourceUnit;
  if (allItems.length > 0 && scope === 'workspace') {
    toAdd = replenishQtyCappedForMonthlyUse(item, allItems, shortfallInSourceUnit);
    if (toAdd <= BOM_COVERAGE_EPS) return normalizeStockItem(item);
  } else {
    toAdd = shortfallQtyForReplenish(shortfallInSourceUnit);
  }

  const dim = UNIT_DIMENSION[item.packageUnit];
  const catalogPurchase = lockStockPurchaseForReplenish(item);
  const unitPriceLocked = lockStockUnitPriceForReplenish(item);
  const purchaseBefore = stockPurchaseTotal(item);
  const units = item.unitsPurchased > 0 ? item.unitsPurchased : 0;
  const measureQuantity = item.measureQuantity;
  const perUnit = resolveMeasurePerUnitForReplenish(item);
  const monthly =
    scope === 'workspace' && allItems.length > 0
      ? monthlyMaterialDemandForSource(item.id, allItems)
      : 0;

  const onHandBefore = stockOnHandMeasure(item);
  const unitsToAdd =
    dim === 'count'
      ? toAdd
      : perUnit > 0
        ? unitsToAddForGramShortfall(perUnit, toAdd)
        : shortfallQtyForReplenish(toAdd);
  let newUnits = units + unitsToAdd;
  if (scope === 'workspace' && monthly > 0 && perUnit > 0) {
    const maxUnits = Math.ceil(monthly / perUnit - BOM_COVERAGE_EPS);
    newUnits = Math.min(newUnits, Math.max(units, maxUnits));
  } else if (scope === 'workspace' && monthly > 0 && dim === 'count') {
    newUnits = Math.min(newUnits, Math.max(units, Math.ceil(monthly - BOM_COVERAGE_EPS)));
  }
  const unitsAdded = Math.max(0, newUnits - units);
  let massAdded = perUnit > 0 ? unitsAdded * perUnit : toAdd;
  if (scope === 'workspace' && monthly > 0 && perUnit <= 0 && dim !== 'count') {
    massAdded = Math.min(massAdded, Math.max(0, monthly - onHandBefore));
  }

  let newPackageSize = 0;
  if (measureQuantity > 0) {
    newPackageSize = newUnits * measureQuantity;
  } else if (dim === 'count') {
    newPackageSize = newUnits;
  } else if (massAdded > 0) {
    newPackageSize = onHandBefore + massAdded;
  }

  const catalogMeasure = catalogStockMeasure(item);
  const catalogPurchaseBase =
    catalogPurchase > 0
      ? roundStockMoney(catalogPurchase, 2)
      : unitPriceLocked > 0 && units > 0
        ? roundStockMoney(unitPriceLocked * units, 2)
        : purchaseBefore;
  let purchasePrice = 0;
  if (catalogMeasure > 0 && catalogPurchaseBase > 0 && massAdded > 0) {
    purchasePrice = roundStockMoney(
      purchaseBefore + (massAdded / catalogMeasure) * catalogPurchaseBase,
      2,
    );
  } else if (unitPriceLocked > 0 && unitsAdded > 0) {
    purchasePrice = roundStockMoney(purchaseBefore + unitPriceLocked * unitsAdded, 2);
  } else if (purchaseBefore > 0 && units > 0 && newUnits > units) {
    purchasePrice = roundStockMoney((purchaseBefore / units) * newUnits, 2);
  }

  return finishReplenishStockItem(
    item,
    { unitsPurchased: newUnits, measureQuantity, packageSize: newPackageSize },
    { purchasePrice },
  );
}

export type BomMaterialCoverageResult = {
  ok: boolean;
  batchYield: number;
  monthlyQty: number;
  batchesPerMonth: number;
  targetFinishedQty: number;
  /** Máximo de PA fabricáveis com insumo/MP livre no estoque (receita × rendimento). */
  maxFinishedFromStock: number;
  scaleFactor: number;
  shortages: BomMaterialShortage[];
};

function reservedMaterialFromOtherProducts(
  excludeProductId: string,
  allItems: StockItem[],
  stockById: Map<string, StockItem>,
): Map<string, number> {
  const reserved = new Map<string, number>();
  for (const other of allItems) {
    if (other.id === excludeProductId || other.category !== 'produto_acabado' || !other.useBom) {
      continue;
    }
    const otherScaled = scaledBomForFinishedTarget(other);
    if (!otherScaled) continue;
    const otherReq = requiredMaterialBySourceId(otherScaled.bom, stockById);
    for (const [id, qty] of otherReq) {
      reserved.set(id, (reserved.get(id) ?? 0) + qty);
    }
  }
  return reserved;
}

/** Quantos produtos acabados cabem no estoque atual (ingrediente mais limitante). */
export function maxFinishedUnitsFromCurrentStock(
  product: StockItem,
  allItems: StockItem[],
  options?: { bomOverride?: BomLine[]; excludeProductId?: string },
): number {
  const resolved = resolveRecipeQuantityBase(
    options?.bomOverride ? { ...product, bom: options.bomOverride } : product,
  );
  const baseBom = options?.bomOverride ?? resolved.bom;
  const unitsPerBatch =
    resolved.productionQty > 0 ? resolved.productionQty : resolveRecipeBatchYield(product);
  if (baseBom.length === 0 || baseBom.every((l) => !l.stockItemId || l.quantity <= 0)) {
    return 0;
  }

  const stockById = new Map(allItems.map((s) => [s.id, s]));
  const excludeId = options?.excludeProductId ?? product.id;
  const reserved = reservedMaterialFromOtherProducts(excludeId, allItems, stockById);

  let maxBatches = Number.POSITIVE_INFINITY;
  let hasMaterial = false;
  for (const line of baseBom) {
    if (!line.stockItemId || line.quantity <= 0) continue;
    const src = stockById.get(line.stockItemId);
    if (!src) return 0;
    const perBatch = bomLineQtyInSourceUnit(line, src);
    if (perBatch === null || perBatch <= 0) continue;
    hasMaterial = true;
    const available = Math.max(
      0,
      availableStockQtyForBomLine(src, line) - (reserved.get(line.stockItemId) ?? 0),
    );
    maxBatches = Math.min(maxBatches, available / perBatch);
  }

  if (!hasMaterial || !Number.isFinite(maxBatches) || maxBatches <= 0) return 0;
  const finished = maxBatches * unitsPerBatch;
  return Math.floor(finished * 100) / 100;
}

/** Verifica insumo/MP para qtd/mês: (qtd/mês ÷ rendimento) × composição. */
export function validateBomMaterialCoverage(
  product: StockItem,
  allItems: StockItem[],
  options?: { bomOverride?: BomLine[]; excludeProductId?: string },
): BomMaterialCoverageResult {
  const emptyOk = (
    batchYield: number,
    monthlyQty: number,
    target: number,
    maxFinishedFromStock: number,
  ): BomMaterialCoverageResult => ({
    ok: true,
    batchYield,
    monthlyQty,
    batchesPerMonth: monthlyQty > 0 && batchYield > 0 ? monthlyQty / batchYield : 1,
    targetFinishedQty: target,
    maxFinishedFromStock,
    scaleFactor: 1,
    shortages: [],
  });

  if (product.category !== 'produto_acabado' || !product.useBom) {
    return emptyOk(1, 0, 1, 0);
  }

  const batchYield = resolveRecipeBatchYield(product);
  const monthlyQty = product.monthlyQty > 0 ? product.monthlyQty : 0;
  const batchesPerMonth = recipeBatchesPerMonth(product);
  const targetFinishedQty = resolveMaterialDemandFinishedUnits(product);
  const maxFinishedFromStock = maxFinishedUnitsFromCurrentStock(product, allItems, options);
  const scaled = scaledBomForFinishedTarget(product, options?.bomOverride);
  if (!scaled) {
    return emptyOk(batchYield, monthlyQty, targetFinishedQty, maxFinishedFromStock);
  }

  const stockById = new Map(allItems.map((s) => [s.id, s]));
  const required = requiredMaterialBySourceId(scaled.bom, stockById);
  const excludeId = options?.excludeProductId ?? product.id;
  const reserved = reservedMaterialFromOtherProducts(excludeId, allItems, stockById);

  const recipeBase = resolveRecipeQuantityBase(product);
  const shortages: BomMaterialShortage[] = [];
  for (const [sourceId, need] of required) {
    const src = stockById.get(sourceId);
    if (!src) continue;
    const refLine = scaled.bom.find((l) => l.stockItemId === sourceId && l.quantity > 0);
    const availableBase = refLine
      ? availableStockQtyForBomLine(src, refLine)
      : availableStockQtyForSource(src);
    const reservedQty = reserved.get(sourceId) ?? 0;
    const available = Math.max(0, availableBase - reservedQty);
    if (need <= available + BOM_COVERAGE_EPS) continue;
    /** Estoque físico deve cobrir esta meta + o que outros PA já consomem no mês. */
    const shortfall = shortfallQtyForReplenish(
      Math.max(0, need + reservedQty - availableBase),
    );
    const perRecipeLine = recipeBase.bom.find((l) => l.stockItemId === sourceId && l.quantity > 0);
    const perRecipeQty = perRecipeLine ? bomLineQtyInSourceUnit(perRecipeLine, src) : null;
    shortages.push({
      stockItemId: sourceId,
      name: src.name || 'Sem nome',
      category: src.category,
      shortfallQty: shortfall,
      perRecipeLabel:
        perRecipeQty != null && perRecipeQty > 0
          ? formatStockMaterialDemandLabel(src, perRecipeQty)
          : undefined,
      requiredLabel: formatStockMaterialDemandLabel(src, need),
      availableLabel: formatStockMaterialDemandLabel(src, available),
      shortfallLabel: formatStockMaterialDemandLabel(src, shortfall),
    });
  }

  shortages.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  return {
    ok: shortages.length === 0,
    batchYield,
    monthlyQty,
    batchesPerMonth,
    targetFinishedQty,
    maxFinishedFromStock,
    scaleFactor: scaled.scaleFactor,
    shortages,
  };
}

const STOCK_DEPLETED_CATEGORIES: StockCategory[] = ['insumo', 'materia_prima', 'mercadoria'];

/** Insumo/MP/mercadoria sem estoque físico para cobrir a composição (vai para Faltantes). */
export function stockItemDepletedByBom(item: StockItem, allItems: StockItem[]): boolean {
  if (!STOCK_DEPLETED_CATEGORIES.includes(item.category)) return false;
  const remaining = computeStockRemainingAfterBom(item, allItems);
  if (remaining.usage.lines.length === 0) return false;
  return stockOnHandMeasure(item) <= BOM_COVERAGE_EPS;
}

/** Falta de material agregada de todos os produtos acabados com composição. */
export function collectWorkspaceMaterialShortages(allItems: StockItem[]): BomMaterialShortage[] {
  const stockById = new Map(allItems.map((s) => [s.id, s]));
  const byId = new Map<string, BomMaterialShortage>();
  for (const product of allItems) {
    if (product.category !== 'produto_acabado' || !product.useBom) continue;
    const coverage = validateBomMaterialCoverage(product, allItems);
    for (const s of coverage.shortages) {
      const src = stockById.get(s.stockItemId);
      if (!src) continue;
      const qty = replenishQtyCappedForMonthlyUse(src, allItems, s.shortfallQty);
      if (qty <= BOM_COVERAGE_EPS) continue;
      const capped = bomMaterialShortageWithQty(src, allItems, qty, {
        perRecipeLabel: s.perRecipeLabel,
        requiredLabel: s.requiredLabel,
        availableLabel: s.availableLabel,
      });
      const prev = byId.get(s.stockItemId);
      if (!prev || capped.shortfallQty > prev.shortfallQty) {
        byId.set(s.stockItemId, capped);
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

/**
 * Falta para o botão «Acrescentar» (≤ uso mensal; só repõe o que falta para um mês).
 */
export function resolveReplenishShortageForStockItem(
  item: StockItem,
  allItems: StockItem[],
): BomMaterialShortage | null {
  if (!isStockMeasureCadastroComplete(item)) return null;
  const need = monthlyMaterialDemandForSource(item.id, allItems);
  if (need <= BOM_COVERAGE_EPS) return null;

  const remaining = computeStockRemainingAfterBom(item, allItems);
  if (remaining.usage.lines.length === 0) return null;

  const existing = collectWorkspaceMaterialShortages(allItems).find(
    (s) => s.stockItemId === item.id,
  );
  if (existing) return existing;

  const available = availableStockQtyForReplenishCap(item, allItems);
  const monthlyGap = Math.max(0, need - available);
  const depleted = stockItemDepletedByBom(item, allItems);
  const proposed = monthlyGap > BOM_COVERAGE_EPS ? monthlyGap : depleted ? need : 0;
  const shortfallQty = replenishQtyCappedForMonthlyUse(item, allItems, proposed);
  if (shortfallQty <= BOM_COVERAGE_EPS) return null;

  return bomMaterialShortageWithQty(item, allItems, shortfallQty);
}

/** Falta agregada de todos os PA que usam este insumo/MP (um clique «Acrescentar»). */
export function workspaceReplenishShortageForStockItem(
  item: StockItem,
  allItems: StockItem[],
): BomMaterialShortage | null {
  const fromWorkspace = collectWorkspaceMaterialShortages(allItems).find(
    (s) => s.stockItemId === item.id,
  );
  if (fromWorkspace) return fromWorkspace;
  return resolveReplenishShortageForStockItem(item, allItems);
}

/** Repõe um insumo/MP/mercadoria o suficiente para todos os PA com composição. */
export function applyStockReplenishForSourceItem(
  stockItems: StockItem[],
  stockItemId: string,
): StockItem[] {
  const item = stockItems.find((s) => s.id === stockItemId);
  if (!item) return stockItems;
  const shortage = workspaceReplenishShortageForStockItem(item, stockItems);
  if (!shortage || shortage.shortfallQty <= BOM_COVERAGE_EPS) return stockItems;
  return applyStockMaterialShortfallsToItems(stockItems, [
    { stockItemId, shortfallQty: shortage.shortfallQty },
  ]);
}

/** Um clique no card: repõe somente este lançamento (não os demais faltantes). */
export function applyStockReplenishOnlyThisItem(
  stockItems: StockItem[],
  stockItemId: string,
): StockItem[] {
  const item = stockItems.find((s) => s.id === stockItemId);
  if (!item) return stockItems;
  const shortage = resolveReplenishShortageForStockItem(item, stockItems);
  if (!shortage || shortage.shortfallQty <= BOM_COVERAGE_EPS) return stockItems;
  return applyStockMaterialShortfallsToItems(stockItems, [
    { stockItemId: item.id, shortfallQty: shortage.shortfallQty },
  ]);
}

/** Chave de duplicidade: mesma categoria + mesmo nome + mesmo PA (ignora maiúsculas/espaços). */
export function stockDuplicateNameKey(
  item: Pick<StockItem, 'category' | 'name' | 'stockScopeProductId'>,
): string {
  const name = item.name.trim().toLowerCase();
  if (!name) return '';
  const scope = item.stockScopeProductId ?? '';
  return `${item.category}:${scope}:${name}`;
}

/** Insumos/MP disponíveis na composição de um produto acabado (escopo do PA + legado sem vínculo). */
export function bomSourcesForProduct(
  stockItems: StockItem[],
  productId: string,
): StockItem[] {
  return stockItems.filter(
    (s) =>
      (s.category === 'insumo' || s.category === 'materia_prima') &&
      (!s.stockScopeProductId || s.stockScopeProductId === productId),
  );
}

function remapBomLineStockIds(item: StockItem, idRemap: Map<string, string>): StockItem {
  if (idRemap.size === 0) return item;
  const remapLine = (line: BomLine): BomLine => {
    const nextId = idRemap.get(line.stockItemId);
    return nextId ? { ...line, stockItemId: nextId } : line;
  };
  return {
    ...item,
    bom: item.bom.map(remapLine),
    recipeQuantityBaseBom: item.recipeQuantityBaseBom?.map(remapLine),
  };
}

function mergeDuplicateStockIntoKeeper(keeper: StockItem, duplicates: StockItem[]): StockItem {
  const group = [keeper, ...duplicates];
  let purchase = 0;
  let onHandTotal = 0;
  let directCost = keeper.directCost > 0 ? keeper.directCost : 0;

  for (const it of group) {
    if (it.purchasePrice > 0) purchase += it.purchasePrice;
    onHandTotal += stockOnHandMeasure(it);
    if (directCost <= 0 && it.directCost > 0) directCost = it.directCost;
  }

  const hasMeasureCatalog =
    keeper.measureQuantity > 0 && keeper.unitsPurchased > 0;

  if (hasMeasureCatalog) {
    return normalizeStockItem({
      ...keeper,
      packageSize: onHandTotal,
      purchasePrice: purchase > 0 ? purchase : keeper.purchasePrice,
      directCost,
    });
  }

  let units = 0;
  for (const it of group) {
    if (it.unitsPurchased > 0) units += it.unitsPurchased;
  }
  if (units <= 0 && onHandTotal > 0) units = 1;

  return normalizeStockItem({
    ...keeper,
    unitsPurchased: units > 0 ? units : keeper.unitsPurchased,
    packageSize: onHandTotal > 0 ? onHandTotal : units,
    purchasePrice: purchase > 0 ? purchase : keeper.purchasePrice,
    directCost,
  });
}

/**
 * Remove lançamentos repetidos (mesmo nome na mesma categoria).
 * Mantém o mais antigo, soma qtd/valor dos demais e remapeia referências na BOM.
 */
export function dedupeStockItemsByName(stockItems: StockItem[]): {
  items: StockItem[];
  removedIds: string[];
  idRemap: Map<string, string>;
} {
  const groups = new Map<string, StockItem[]>();
  const withoutNameKey: StockItem[] = [];

  for (const item of stockItems) {
    if (item.category === 'produto_acabado') {
      withoutNameKey.push(item);
      continue;
    }
    const key = stockDuplicateNameKey(item);
    if (!key) {
      withoutNameKey.push(item);
      continue;
    }
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  const idRemap = new Map<string, string>();
  const removedIds: string[] = [];
  const merged: StockItem[] = [...withoutNameKey];

  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0]!);
      continue;
    }
    group.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const keeper = group[0]!;
    const duplicates = group.slice(1);
    for (const dup of duplicates) {
      removedIds.push(dup.id);
      idRemap.set(dup.id, keeper.id);
    }
    merged.push(mergeDuplicateStockIntoKeeper(keeper, duplicates));
  }

  return {
    items: merged.map((item) => remapBomLineStockIds(item, idRemap)),
    removedIds,
    idRemap,
  };
}

/** Aplica deduplicação de estoque e ajusta overrides / BOM. */
export function dedupePricingWorkspaceStock(workspace: PricingWorkspace): {
  workspace: PricingWorkspace;
  removedCount: number;
} {
  const { items, removedIds, idRemap } = dedupeStockItemsByName(workspace.stockItems);
  if (removedIds.length === 0) {
    return { workspace, removedCount: 0 };
  }

  const productOverrides = { ...workspace.productOverrides };
  for (const removedId of removedIds) {
    const keptId = idRemap.get(removedId);
    if (keptId && productOverrides[removedId]) {
      productOverrides[keptId] = {
        ...(productOverrides[keptId] ?? {}),
        ...productOverrides[removedId],
      };
    }
    delete productOverrides[removedId];
  }

  return {
    workspace: {
      ...workspace,
      stockItems: items,
      productOverrides,
    },
    removedCount: removedIds.length,
  };
}

/** Cópia de lançamento de estoque (novo id) — para multiplicador na lista do catálogo. */
export function cloneStockItemEntry(item: StockItem): StockItem {
  return {
    ...item,
    id: crypto.randomUUID(),
    bom: item.bom.map((line) => ({ ...line })),
    recipeQuantityBaseBom: item.recipeQuantityBaseBom?.map((line) => ({ ...line })),
    createdAt: new Date().toISOString(),
  };
}

/** Total de lançamentos desejados (≥2); retorna quantas cópias adicionar além do original. */
export function stockMultiplierCopiesToAdd(totalEntries: number): number {
  const n = Math.floor(totalEntries);
  if (!Number.isFinite(n) || n < 2) return 0;
  return Math.min(98, n - 1);
}

/** Divisor do custo material: rendimento explícito ou detecção de lote legado. */
export function resolveMaterialCostDivisor(
  item: StockItem,
  workspace: Pick<PricingWorkspace, 'stockItems' | 'serviceItems' | 'productOverrides'>,
  bomTotal: number,
  recipeUnitCost: number,
): number {
  const yieldQty = resolveRecipeYieldQty(item);
  const userSetYield =
    (item.recipeYieldQty != null && item.recipeYieldQty > 1) ||
    (item.recipeQuantityBaseProductionQty != null && item.recipeQuantityBaseProductionQty > 1);

  if (userSetYield) return yieldQty;

  const baseQty = resolveBasePricingQty(item.id, workspace);
  if (
    baseQty > 1 &&
    bomTotal > 0 &&
    recipeUnitCost > 0 &&
    bomStoredAsMonthlyBatch(item.bom, bomTotal, recipeUnitCost, baseQty)
  ) {
    return baseQty;
  }

  if (recipeUnitCost > 0 && bomTotal <= recipeUnitCost * 1.05) return 1;

  return yieldQty;
}

/**
 * Custo material/un. = total da composição ÷ rendimento (não usa qtd/mês de vendas).
 */
export function resolvePricingMaterialUnitCost(
  item: StockItem,
  stockById: Map<string, StockItem>,
  workspace: Pick<PricingWorkspace, 'stockItems' | 'serviceItems' | 'productOverrides'>,
): number {
  if (item.category !== 'produto_acabado' || !item.useBom || item.bom.length === 0) {
    const { cost, detail } = computeMaterialCost(item, stockById);
    return detail.length > 0 ? sumBomDetailCosts(detail) : cost;
  }

  const summary = compositionCostSummaryForStockItem(item, stockById);
  if (summary.recipeBatchTotalCost <= 0) return 0;

  const { bom: baseBom } = resolveRecipeQuantityBase(item);
  const recipeUnit = materialCostFromBomLines(baseBom, stockById).cost;
  const inflatedTotal = compositionMaterialTotalFromBom(item.bom, stockById);
  const divisor = resolveMaterialCostDivisor(item, workspace, inflatedTotal, recipeUnit);

  return materialUnitCostFromCompositionTotal(summary.recipeBatchTotalCost, divisor);
}

export function computeMaterialCost(
  item: StockItem,
  stockById: Map<string, StockItem>,
): { cost: number; detail: { name: string; qty: string; cost: number }[]; compositionTotal?: number } {
  if (item.category === 'produto_acabado' && item.useBom) {
    if (item.bom.length === 0) {
      return { cost: 0, detail: [], compositionTotal: 0 };
    }
    const summary = compositionCostSummaryForStockItem(item, stockById);
    const { bom: bomLines } = resolveRecipeQuantityBase(item);
    const scaled = materialCostFromBomLines(bomLines, stockById);
    return {
      cost: summary.unitMaterialCost,
      detail: scaled.detail,
      compositionTotal: summary.recipeBatchTotalCost,
    };
  }

  if (item.category === 'mercadoria') {
    const unit = deriveStockUnitPrice(item);
    if (unit > 0) return { cost: unit, detail: [] };
    if (item.directCost > 0) return { cost: item.directCost, detail: [] };
    if (item.purchasePrice > 0) {
      const units = item.unitsPurchased > 0 ? item.unitsPurchased : 1;
      return { cost: roundStockMoney(item.purchasePrice / units, 6), detail: [] };
    }
    return { cost: 0, detail: [] };
  }

  if (item.category === 'insumo' || item.category === 'materia_prima') {
    const cost =
      item.purchasePrice > 0
        ? unitCostPerBase(item) * toBaseUnit(1, item.packageUnit)
        : item.directCost;
    return { cost, detail: [] };
  }

  const cost = item.directCost > 0 ? item.directCost : item.purchasePrice;
  return { cost, detail: [] };
}

/** Quantidade usada na projeção mensal do dashboard (1 un/mês se não informado). */
export function effectiveProjectionQty(monthlyQty: number): number {
  return monthlyQty > 0 ? monthlyQty : 1;
}

/**
 * Multiplica a receita (BOM + qtd produzida) por um fator.
 * Ex.: fator 2 → dobra insumos/MP e a qtd produzida; custo/un. permanece o mesmo.
 */
export function cloneBomLines(bom: BomLine[]): BomLine[] {
  return bom.map((line) => ({ ...line }));
}

export function scaleBomRecipe(
  bom: BomLine[],
  productionQty: number,
  factor: number,
): { bom: BomLine[]; productionQty: number } {
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) {
    return { bom: cloneBomLines(bom), productionQty };
  }
  return {
    bom: bom.map((line) => ({
      ...line,
      quantity: line.quantity * factor,
    })),
    productionQty: productionQty > 0 ? productionQty * factor : productionQty,
  };
}

/**
 * Converte o campo "vezes em dobro" em fator multiplicador.
 * 0 ou vazio = ×1 (receita original); 1 = uma dobra (×2); 2 = dobrar duas vezes (×4); etc.
 */
export function recipeDoublesToScaleFactor(doubles: number): number {
  if (!Number.isFinite(doubles) || doubles <= 0) return 1;
  return 2 ** doubles;
}

/** Aplica o fator sobre a receita base (não acumula cliques anteriores). Fator 1 restaura a base. */
export function applyRecipeScaleFromBaseline(
  baseline: { bom: BomLine[]; productionQty: number },
  factor: number,
): { bom: BomLine[]; productionQty: number } {
  const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;
  if (safeFactor === 1) {
    return {
      bom: cloneBomLines(baseline.bom),
      productionQty: baseline.productionQty,
    };
  }
  return scaleBomRecipe(baseline.bom, baseline.productionQty, safeFactor);
}

export const RECIPE_QTY_SANE_MAX = 50_000;
export const RECIPE_PRODUCTION_SANE_MAX = 100_000;

export function bomLooksInflated(bom: BomLine[], productionQty: number): boolean {
  if (bom.some((line) => line.quantity > RECIPE_QTY_SANE_MAX)) return true;
  if (productionQty > RECIPE_PRODUCTION_SANE_MAX) return true;
  return false;
}

function isSaneRecipeCandidate(bom: BomLine[], productionQty: number): boolean {
  if (bom.length === 0) return false;
  if (productionQty < 1 || productionQty > RECIPE_PRODUCTION_SANE_MAX) return false;
  return bom.every((line) => line.quantity >= 1 && line.quantity <= RECIPE_QTY_SANE_MAX);
}

/** Tenta recuperar receita ×1 dividindo uma composição salva já multiplicada (mesmo fator em todas as linhas). */
export function tryRecoverInflatedRecipeBase(
  bom: BomLine[],
  productionQty: number,
): { bom: BomLine[]; productionQty: number; recoveredFactor: number } | null {
  if (!bomLooksInflated(bom, productionQty)) return null;

  const factors: number[] = [];
  for (let p = 1; p <= 24; p++) factors.push(2 ** p);
  for (let f = 3; f <= 120; f++) factors.push(f);

  const tryFactor = (f: number) => {
    if (f <= 1) return null;
    const candidateBom = bom.map((line) => ({ ...line, quantity: line.quantity / f }));
    const candidateQty = productionQty > 0 ? productionQty / f : productionQty;
    if (!isSaneRecipeCandidate(candidateBom, candidateQty)) return null;
    const nearInteger =
      Math.abs(candidateQty - Math.round(candidateQty)) < 1e-4 &&
      candidateBom.every(
        (line) => Math.abs(line.quantity - Math.round(line.quantity * 1e6) / 1e6) < 1e-4,
      );
    if (!nearInteger) return null;
    return {
      bom: candidateBom,
      productionQty: candidateQty,
      recoveredFactor: f,
    };
  };

  const verifies = (hit: NonNullable<ReturnType<typeof tryFactor>>) => {
    const re = applyRecipeScaleFromBaseline(
      { bom: hit.bom, productionQty: hit.productionQty },
      hit.recoveredFactor,
    );
    const qtyOk =
      Math.abs(re.productionQty - productionQty) < 1e-4 &&
      re.bom.every((line, i) => Math.abs(line.quantity - bom[i]!.quantity) < 1e-4);
    return qtyOk;
  };

  let best: { bom: BomLine[]; productionQty: number; recoveredFactor: number } | null = null;
  for (let p = 1; p <= 24; p++) {
    const hit = tryFactor(2 ** p);
    if (hit && verifies(hit)) best = hit;
  }
  if (best) return best;

  for (let f = 2; f <= 120; f++) {
    if ((f & (f - 1)) === 0) continue;
    const hit = tryFactor(f);
    if (hit && verifies(hit)) best = hit;
  }
  return best;
}

/** Aplica o fator de multiplicador só para exibição (lista/cards) — não altera o item salvo. */
export function stockItemWithRecipeScale<T extends { category: string; useBom: boolean; bom: BomLine[]; monthlyQty: number }>(
  item: T,
  baseline: { bom: BomLine[]; productionQty: number } | null | undefined,
  factor: number,
): T {
  if (!baseline || item.category !== 'produto_acabado' || !item.useBom) {
    return item;
  }
  const scaled = applyRecipeScaleFromBaseline(
    baseline,
    Number.isFinite(factor) && factor > 0 ? factor : 1,
  );
  /** Só escala a composição; qtd/mês de vendas vem de `effectiveMonthlyQtyForPricing`. */
  return { ...item, bom: scaled.bom };
}

/** “Vezes em dobro” do PA (edição em curso ou valor salvo / mapa em memória). */
export function resolveRecipeDoublesForStockItem(
  item: { id: string; recipeQuantityDoubles?: number },
  editingProductId: string | null,
  editingDoubles: number,
  doublesById: ReadonlyMap<string, number>,
): number {
  if (editingProductId && item.id === editingProductId) return editingDoubles;
  return doublesById.get(item.id) ?? item.recipeQuantityDoubles ?? 0;
}

/** Lista de estoque com consumo de BOM atualizado (PA em edição usa dados ao vivo). */
export function buildStockItemsForBomUsage(
  stockItems: StockItem[],
  options?: {
    editingProductId?: string | null;
    editingProductLive?: StockItem | null;
    editingDoubles?: number;
    doublesById?: ReadonlyMap<string, number>;
  },
): StockItem[] {
  const editingId = options?.editingProductId ?? null;
  const doubles = options?.editingDoubles ?? 0;
  const doublesById = options?.doublesById ?? new Map<string, number>();

  return stockItems.map((item) => {
    let row = item;
    if (editingId && item.id === editingId && options?.editingProductLive) {
      row = options.editingProductLive;
    }
    return stockItemWithAppliedRecipeDoubles(row, editingId, doubles, doublesById);
  });
}

/** PA com qtd/mês e composição escaladas para listas, insumos/MP e editor. */
export function stockItemWithAppliedRecipeDoubles<
  T extends { id: string; category: string; useBom: boolean; bom: BomLine[]; monthlyQty: number; recipeQuantityDoubles?: number },
>(
  item: T,
  editingProductId: string | null,
  editingDoubles: number,
  doublesById: ReadonlyMap<string, number>,
): T {
  if (item.category !== 'produto_acabado' || !item.useBom || item.bom.length === 0) {
    return item;
  }
  const doubles = resolveRecipeDoublesForStockItem(item, editingProductId, editingDoubles, doublesById);
  const multiplier = recipeDoublesToScaleFactor(doubles);
  if (multiplier === 1) return item;
  const resolved = resolveRecipeQuantityBase(item);
  return stockItemWithRecipeScale(
    item,
    { bom: resolved.bom, productionQty: resolved.productionQty },
    multiplier,
  );
}

export function resolveRecipeQuantityBase(item: {
  bom: BomLine[];
  monthlyQty: number;
  recipeYieldQty?: number;
  recipeQuantityBaseBom?: BomLine[];
  recipeQuantityBaseProductionQty?: number;
}): { bom: BomLine[]; productionQty: number; recoveredFactor?: number } {
  const yieldQty = resolveRecipeYieldQty(item);

  if (item.recipeQuantityBaseBom && item.recipeQuantityBaseBom.length > 0) {
    return {
      bom: cloneBomLines(item.recipeQuantityBaseBom),
      productionQty: item.recipeQuantityBaseProductionQty ?? yieldQty,
    };
  }

  const recovered =
    tryRecoverInflatedRecipeBase(item.bom, yieldQty) ??
    (item.monthlyQty > 0 && item.monthlyQty !== yieldQty
      ? tryRecoverInflatedRecipeBase(item.bom, item.monthlyQty)
      : null);
  if (recovered) {
    return {
      bom: recovered.bom,
      productionQty: recovered.productionQty,
      recoveredFactor: recovered.recoveredFactor,
    };
  }
  return {
    bom: cloneBomLines(item.bom),
    productionQty: yieldQty,
  };
}

/** Peso do produto no rateio de custos/despesas do segmento (antes de dividir pela qtd/mês). */
export function costAllocationWeight(
  materialCostPerUnit: number,
  monthlyQty: number,
  mode: CostAllocationMode,
): number {
  if (monthlyQty <= 0) return 0;
  if (mode === 'por_unidades_mes') {
    return monthlyQty;
  }
  if (mode === 'por_custo_material') {
    return materialCostPerUnit > 0 ? materialCostPerUnit * monthlyQty : 0;
  }
  return materialCostPerUnit * monthlyQty;
}

/** Participação no rateio do segmento pela qtd/mês (0–1). */
export function segmentQtyAllocationShare(monthlyQty: number, totalActiveQty: number): number {
  if (monthlyQty <= 0 || totalActiveQty <= 0) return 0;
  return monthlyQty / totalActiveQty;
}

function resolveMonthlyQtyForUnit(unit: PricedUnit, workspace: PricingWorkspace): number {
  return resolveEffectivePricingQty(unit.id, workspace);
}

/** Soma das qtd/mês efetivas no segmento (com vezes em dobro). */
export function segmentActiveMonthlyQtyTotal(
  segmentUnits: PricedUnit[],
  workspace: PricingWorkspace,
): number {
  let sum = 0;
  for (const unit of segmentUnits) {
    const mq = resolveMonthlyQtyForUnit(unit, workspace);
    if (mq > 0) sum += mq;
  }
  return sum;
}

/** Soma das qtd/mês base no segmento (sem vezes em dobro) — rateio e custos/un. */
export function segmentBaseMonthlyQtyTotal(
  segmentUnits: PricedUnit[],
  workspace: PricingWorkspace,
): number {
  let sum = 0;
  for (const unit of segmentUnits) {
    const mq = resolveBasePricingQty(unit.id, workspace);
    if (mq > 0) sum += mq;
  }
  return sum;
}

/** Valor em R$ do item na aba Estoque (tudo entra como custo no consolidado). */
export function stockItemInventoryValue(item: StockItem, allItems: StockItem[]): number {
  const purchased = stockPurchaseTotal(item);
  if (purchased > 0) return purchased;

  if (item.category === 'insumo' || item.category === 'materia_prima') {
    const remaining = computeStockRemainingAfterBom(item, allItems);
    if (remaining.valueTotal > 0) return remaining.valueTotal;
    if (item.purchasePrice > 0) return item.purchasePrice;
    if (item.directCost > 0) return item.directCost;
    const units = item.unitsPurchased > 0 ? item.unitsPurchased : 0;
    return deriveStockUnitPrice(item) * units;
  }

  if (item.category === 'mercadoria') {
    if (item.directCost > 0) return item.directCost;
    return deriveStockUnitPrice(item);
  }

  if (item.category === 'produto_acabado') {
    const stockById = new Map(allItems.map((s) => [s.id, s]));
    const material = computeMaterialCost(item, stockById);
    const inventoryValue =
      material.compositionTotal != null && material.compositionTotal > 0
        ? material.compositionTotal
        : material.cost;
    if (inventoryValue > 0) return inventoryValue;
    return item.directCost > 0 ? item.directCost : 0;
  }

  return 0;
}

/** Valor unitário de aquisição (R$/un.) de produto acabado ou mercadoria. */
export function stockItemAcquisitionUnitValue(item: StockItem, allItems: StockItem[]): number {
  if (item.category !== 'produto_acabado' && item.category !== 'mercadoria') return 0;

  const unit = deriveStockUnitPrice(item);
  if (unit > 0) return unit;

  if (item.category === 'mercadoria') {
    if (item.directCost > 0) return item.directCost;
    return 0;
  }

  const stockById = new Map(allItems.map((s) => [s.id, s]));
  const material = computeMaterialCost(item, stockById);
  if (material.cost > 0) return material.cost;
  return item.directCost > 0 ? item.directCost : 0;
}

/** Valor de aquisição (compra) de produto acabado ou mercadoria — qtd × preço ou total informado. */
export function stockItemAcquisitionValue(item: StockItem, allItems: StockItem[]): number {
  if (item.category !== 'produto_acabado' && item.category !== 'mercadoria') return 0;

  const purchased = stockPurchaseTotal(item);
  if (purchased > 0) return purchased;

  if (item.category === 'mercadoria') {
    if (item.directCost > 0) return item.directCost;
    const units = item.unitsPurchased > 0 ? item.unitsPurchased : 0;
    return units > 0 ? deriveStockUnitPrice(item) * units : deriveStockUnitPrice(item);
  }

  const stockById = new Map(allItems.map((s) => [s.id, s]));
  const material = computeMaterialCost(item, stockById);
  const inventoryValue =
    material.compositionTotal != null && material.compositionTotal > 0
      ? material.compositionTotal
      : material.cost;
  if (inventoryValue > 0) return inventoryValue;
  return item.directCost > 0 ? item.directCost : 0;
}

export function computeAcquisitionTotal(
  workspace: PricingWorkspace,
  segment?: PricingSegment,
): number {
  let sum = 0;
  for (const item of workspace.stockItems) {
    if (segment) {
      if (item.category !== segment) continue;
    } else if (item.category !== 'produto_acabado' && item.category !== 'mercadoria') {
      continue;
    }
    sum += stockItemAcquisitionValue(item, workspace.stockItems);
  }
  return sum;
}

export function computeStockInventoryTotal(workspace: PricingWorkspace): number {
  return workspace.stockItems.reduce(
    (sum, item) => sum + stockItemInventoryValue(item, workspace.stockItems),
    0,
  );
}

/** Qtd/mês base no estoque (sem “vezes em dobro”). */
export function baseMonthlyQtyFromStock(item: StockItem): number {
  return item.monthlyQty > 0 ? item.monthlyQty : 0;
}

/**
 * Qtd/mês igual ao rendimento da receita costuma ser erro de cadastro
 * (rendimento ≠ projeção de vendas no mês).
 */
export function monthlyQtyLooksLikeRecipeYield(
  item: Pick<StockItem, 'category' | 'useBom' | 'monthlyQty' | 'recipeYieldQty' | 'recipeQuantityBaseProductionQty'>,
): boolean {
  if (item.category !== 'produto_acabado' || !item.useBom) return false;
  const yieldQty = resolveRecipeYieldQty(item);
  if (yieldQty <= 1) return false;
  const base = baseMonthlyQtyFromStock(item as StockItem);
  return base > 0 && base === yieldQty;
}

/** Qtd/mês para precificação (base × vezes em dobro — não divide a BOM). */
export function effectiveMonthlyQtyForPricing(item: StockItem): number {
  return baseMonthlyQtyFromStock(item) * recipeDoublesToScaleFactor(item.recipeQuantityDoubles ?? 0);
}

/**
 * Qtd/mês base (estoque/override), sem “vezes em dobro” — usada no rateio e custos/un.
 */
export function resolveBasePricingQty(
  productId: string,
  workspace: Pick<PricingWorkspace, 'stockItems' | 'serviceItems' | 'productOverrides'>,
): number {
  const qtyOverride = workspace.productOverrides[productId]?.monthlyQty;
  if (qtyOverride != null && qtyOverride > 0) return qtyOverride;
  const stockItem = workspace.stockItems.find((s) => s.id === productId);
  if (stockItem) return baseMonthlyQtyFromStock(stockItem);
  const serviceItem = workspace.serviceItems.find((s) => s.id === productId);
  return serviceItem?.monthlyQty ?? 0;
}

/**
 * Qtd/mês na tabela e na receita mensal (base × vezes em dobro no PA com BOM).
 */
export function resolveEffectivePricingQty(
  productId: string,
  workspace: Pick<PricingWorkspace, 'stockItems' | 'serviceItems' | 'productOverrides'>,
): number {
  const stockItem = workspace.stockItems.find((s) => s.id === productId);
  if (stockItem?.category === 'produto_acabado') {
    return (
      resolveBasePricingQty(productId, workspace) *
      recipeDoublesToScaleFactor(stockItem.recipeQuantityDoubles ?? 0)
    );
  }
  return resolveBasePricingQty(productId, workspace);
}

/** Aplica “vezes em dobro” persistidas ou em memória antes de calcular a precificação. */
export function workspaceWithRecipeDoubles(
  workspace: PricingWorkspace,
  doublesByProductId: ReadonlyMap<string, number>,
): PricingWorkspace {
  if (doublesByProductId.size === 0) {
    const anySaved = workspace.stockItems.some((s) => (s.recipeQuantityDoubles ?? 0) > 0);
    if (!anySaved) return workspace;
  }
  let changed = false;
  const stockItems = workspace.stockItems.map((item) => {
    if (item.category !== 'produto_acabado' || !item.useBom) return item;
    const fromMap = doublesByProductId.get(item.id);
    const doubles = fromMap !== undefined ? fromMap : (item.recipeQuantityDoubles ?? 0);
    if ((item.recipeQuantityDoubles ?? 0) === doubles) return item;
    changed = true;
    return { ...item, recipeQuantityDoubles: doubles };
  });
  return changed ? { ...workspace, stockItems } : workspace;
}

/** Aplica só a qtd/mês efetiva na precificação (× vezes em dobro). BOM ×1 para custo material. */
export function stockItemForPricingProjection(item: StockItem): StockItem {
  return {
    ...item,
    monthlyQty: effectiveMonthlyQtyForPricing(item),
  };
}

function buildPricedUnits(workspace: PricingWorkspace): PricedUnit[] {
  const stockById = new Map(workspace.stockItems.map((s) => [s.id, s]));
  const units: PricedUnit[] = [];

  for (const item of workspace.stockItems) {
    if (item.category !== 'produto_acabado' && item.category !== 'mercadoria') continue;
    const { detail } = computeMaterialCost(item, stockById);
    const materialCost = resolvePricingMaterialUnitCost(item, stockById, workspace);
    units.push({
      id: item.id,
      name: item.name,
      segment: item.category,
      materialCost,
      bomDetail: detail,
      monthlyQty: baseMonthlyQtyFromStock(item),
    });
  }

  for (const svc of workspace.serviceItems ?? []) {
    units.push({
      id: svc.id,
      name: svc.name,
      segment: 'servico',
      materialCost: svc.directCost,
      bomDetail: [],
      monthlyQty: svc.monthlyQty,
    });
  }

  return units;
}

function resolveProductSettings(
  productId: string,
  global: GlobalPricingSettings,
  overrides: Record<string, ProductPricingOverride>,
): Required<Pick<GlobalPricingSettings, 'markupPercent' | 'marginPercent' | 'mode'>> & {
  monthlyQty?: number;
} {
  const o = overrides[productId];
  return {
    markupPercent: normalizePricingPercent(o?.markupPercent ?? global.markupPercent),
    marginPercent: normalizePricingPercent(o?.marginPercent ?? global.marginPercent),
    mode: normalizePricingMode(o?.mode ?? global.mode),
    monthlyQty: o?.monthlyQty,
  };
}

/** Preço de venda conforme a regra (exportado para preview na UI). */
export function resolveSellingUnitPrice(
  materialCost: number,
  settings: Pick<GlobalPricingSettings, 'markupPercent' | 'marginPercent' | 'mode'>,
): number {
  return resolveFinalPrice(
    Math.max(0, materialCost),
    settings.markupPercent,
    settings.marginPercent,
    settings.mode,
  ).final;
}

export function priceFromMarkup(cost: number, markupPct: number): number {
  if (cost <= 0) return 0;
  return cost * (1 + markupPct / 100);
}

export function priceFromMargin(cost: number, marginPct: number): number {
  if (cost <= 0) return 0;
  const m = Math.min(marginPct, 99.9) / 100;
  if (m >= 1) return cost * 10;
  return cost / (1 - m);
}

/** Margem sobre preço de venda (%) → markup equivalente sobre o custo. */
export function marginPercentToMarkupPercent(marginPct: number): number {
  const m = normalizePricingPercent(marginPct);
  if (m <= 0) return 0;
  if (m >= 99.9) return 999;
  return (m / (100 - m)) * 100;
}

/** Markup sobre custo (%) → margem sobre preço de venda equivalente. */
export function markupPercentToMarginPercent(markupPct: number): number {
  const mk = normalizePricingPercent(markupPct);
  if (mk <= 0) return 0;
  return (mk / (100 + mk)) * 100;
}

/** Ao trocar a regra de preço, preenche o % ativo a partir do outro quando estiver zerado. */
export function resolvePricingSettingsOnModeChange(
  prev: Pick<GlobalPricingSettings, 'markupPercent' | 'marginPercent' | 'mode'>,
  nextMode: PricingMode,
): Partial<GlobalPricingSettings> {
  const patch: Partial<GlobalPricingSettings> = { mode: nextMode };
  if (nextMode === 'markup_only' && prev.markupPercent <= 0 && prev.marginPercent > 0) {
    patch.markupPercent = marginPercentToMarkupPercent(prev.marginPercent);
  } else if (nextMode === 'margin_only' && prev.marginPercent <= 0 && prev.markupPercent > 0) {
    patch.marginPercent = markupPercentToMarginPercent(prev.markupPercent);
  }
  return patch;
}

/** Markup no custo e margem no preço de venda: custo × (1 + markup%) ÷ (1 − margem%). */
export function priceFromMarkupAndMargin(
  cost: number,
  markupPct: number,
  marginPct: number,
): number {
  if (cost <= 0) return 0;
  const mk = Math.max(0, markupPct) / 100;
  const m = Math.min(Math.max(0, marginPct), 99.9) / 100;
  if (m >= 1) return cost * (1 + mk) * 10;
  return (cost * (1 + mk)) / (1 - m);
}

export function resolveFinalPrice(
  cost: number,
  markupPct: number,
  marginPct: number,
  mode: PricingMode,
): { byMarkup: number; byMargin: number; final: number; priceDrivingFactor: PriceDrivingFactor } {
  const byMarkup = priceFromMarkup(cost, markupPct);
  const byMargin = priceFromMargin(cost, marginPct);
  if (mode === 'markup_only') {
    return { byMarkup, byMargin, final: byMarkup, priceDrivingFactor: 'markup_only' };
  }
  if (mode === 'margin_only') {
    return { byMarkup, byMargin, final: byMargin, priceDrivingFactor: 'margin_only' };
  }
  return {
    byMarkup,
    byMargin,
    final: priceFromMarkupAndMargin(cost, markupPct, marginPct),
    priceDrivingFactor: 'both',
  };
}

function segmentCostTotal(workspace: PricingWorkspace, segment: PricingSegment, type: 'custo' | 'despesa'): number {
  return workspace.costExpenses
    .filter((c) => c.segment === segment && c.type === type)
    .reduce((s, c) => s + c.monthlyAmount, 0);
}

function segmentCreditsTotal(workspace: PricingWorkspace, segment: PricingSegment): number {
  return workspace.credits
    .filter((c) => c.applicableSegments.length === 0 || c.applicableSegments.includes(segment))
    .reduce((s, c) => s + c.monthlyAmount, 0);
}

/** Soma mensal de todos os lançamentos da aba Custos e Despesas (todos os segmentos). */
export function computeWorkspaceCostExpenseTotals(workspace: PricingWorkspace): {
  totalCosts: number;
  totalExpenses: number;
} {
  let totalCosts = 0;
  let totalExpenses = 0;
  for (const row of workspace.costExpenses) {
    if (row.type === 'custo') totalCosts += row.monthlyAmount;
    else if (row.type === 'despesa') totalExpenses += row.monthlyAmount;
  }
  return { totalCosts, totalExpenses };
}

function workspaceCreditsTotal(workspace: PricingWorkspace): number {
  return computeStockCreditsSummary(workspace, 'all').total;
}

/** Pool mensal de custos + despesas do segmento (base do % rateio). */
export function getSegmentMonthlyOverheadPool(
  workspace: PricingWorkspace,
  segment: PricingSegment,
): { costs: number; expenses: number; credits: number; overhead: number } {
  const costs = segmentCostTotal(workspace, segment, 'custo');
  const expenses = segmentCostTotal(workspace, segment, 'despesa');
  const credits = segmentCreditsTotal(workspace, segment);
  return { costs, expenses, credits, overhead: costs + expenses };
}

/** Quantos produtos do segmento entram no rateio (qtd/mês &gt; 0) vs cadastrados. */
export function countSegmentAllocationParticipants(
  workspace: PricingWorkspace,
  segment: PricingSegment,
): { withQty: number; registered: number } {
  if (segment === 'servico') {
    const list = workspace.serviceItems ?? [];
    const withQty = list.filter((s) => (s.monthlyQty ?? 0) > 0).length;
    return { withQty, registered: list.length };
  }
  const category = segment === 'produto_acabado' ? 'produto_acabado' : 'mercadoria';
  const items = workspace.stockItems.filter((s) => s.category === category);
  const withQty = items.filter((s) => resolveEffectivePricingQty(s.id, workspace) > 0).length;
  return { withQty, registered: items.length };
}

function breakdownForUnit(
  unit: PricedUnit,
  workspace: PricingWorkspace,
  segmentCosts: number,
  segmentExpenses: number,
  segmentCredits: number,
  weight: number,
  fixedPerUnit?: { allocatedCosts: number; allocatedExpenses: number; creditsRecovery: number },
): PricingBreakdown {
  const settings = resolveProductSettings(unit.id, workspace.settings, workspace.productOverrides);
  const effectiveQty = resolveEffectivePricingQty(unit.id, workspace);
  const baseQty = resolveBasePricingQty(unit.id, workspace);
  const revenueQty = effectiveProjectionQty(effectiveQty);
  const rateioQty = effectiveProjectionQty(baseQty > 0 ? baseQty : effectiveQty);

  /** Rateio por unidade usa qtd base; “vezes em dobro” não altera custo nem preço/un. */
  const allocationQty =
    baseQty > 0 ? baseQty : weight > 0 ? effectiveProjectionQty(effectiveQty) : 0;
  const allocatedCosts =
    allocationQty <= 0
      ? 0
      : fixedPerUnit
        ? fixedPerUnit.allocatedCosts
        : (segmentCosts * weight) / allocationQty;
  const allocatedExpenses =
    allocationQty <= 0
      ? 0
      : fixedPerUnit
        ? fixedPerUnit.allocatedExpenses
        : (segmentExpenses * weight) / allocationQty;
  const segmentCreditsPerUnit =
    allocationQty <= 0
      ? 0
      : fixedPerUnit
        ? fixedPerUnit.creditsRecovery
        : (segmentCredits * weight) / allocationQty;
  const stockItem = workspace.stockItems.find((s) => s.id === unit.id);
  const stockCreditsBundle = stockItem ? stockItemCreditsTotal(stockItem) : 0;
  const itemCreditsPerUnit =
    stockCreditsBundle > 0 && revenueQty > 0 ? stockCreditsBundle / revenueQty : 0;
  const creditsRecovery = segmentCreditsPerUnit + itemCreditsPerUnit;
  /** Coluna "Custo total": só material − crédito (custos rateados na coluna Custos). */
  const unitCostExclExpenses = Math.max(0, unit.materialCost - creditsRecovery);
  const totalUnitCost = Math.max(
    0,
    unit.materialCost + allocatedCosts + allocatedExpenses - creditsRecovery,
  );
  /**
   * Preço de venda: markup/margem sobre o custo unitário total
   * (material + custos + despesas rateados − créditos).
   */
  const pricingCostBase = totalUnitCost;
  const { byMarkup, byMargin, final, priceDrivingFactor } = resolveFinalPrice(
    pricingCostBase,
    settings.markupPercent,
    settings.marginPercent,
    settings.mode,
  );
  const pricedUnitPrice = final;
  const pricedMonthlyTotal = pricedUnitPrice * revenueQty;
  const profitPerUnit = pricedUnitPrice - totalUnitCost;
  const profitOnTotalPrice = pricedMonthlyTotal - totalUnitCost * revenueQty;
  const profitOnPricingBase = pricedUnitPrice - pricingCostBase;
  const achievedMarkupPct =
    pricingCostBase > 0 ? (profitOnPricingBase / pricingCostBase) * 100 : 0;
  const achievedMarginPct =
    pricedUnitPrice > 0 ? (profitOnPricingBase / pricedUnitPrice) * 100 : 0;
  const monthlyRevenue = pricedMonthlyTotal;
  const monthlyProfit = monthlyRevenue - totalUnitCost * revenueQty;
  const roaPct = totalUnitCost > 0 ? (profitPerUnit / totalUnitCost) * 100 : 0;
  const monthlyCostsUsed = allocatedCosts * rateioQty;
  const monthlyExpensesUsed = allocatedExpenses * rateioQty;
  const segmentOverhead = segmentCosts + segmentExpenses;
  const allocationShare =
    segmentOverhead > 0
      ? (monthlyCostsUsed + monthlyExpensesUsed) / segmentOverhead
      : segmentCosts > 0
        ? monthlyCostsUsed / segmentCosts
        : segmentExpenses > 0
          ? monthlyExpensesUsed / segmentExpenses
          : weight;

  const displayUnitCosts = Math.max(0, totalUnitCost - unit.materialCost);
  const displayMonthlyExpensesTotal = monthlyExpensesUsed;

  const {
    monthlyTargetQty,
    provisionQtyPerMonth,
    monthlyTargetRevenue,
    provisionRevenue,
  } = computeBreakevenMetrics({
    materialCost: unit.materialCost,
    totalUnitCost,
    pricedUnitPrice,
    monthlyQty: effectiveQty,
    baseQty,
    monthlyCostsUsed,
    monthlyExpensesUsed,
    creditsRecovery,
  });

  return {
    productId: unit.id,
    name: unit.name,
    category: unit.segment,
    materialCost: unit.materialCost,
    bomDetail: unit.bomDetail,
    allocatedCosts,
    allocatedExpenses,
    allocationShare,
    monthlyCostsUsed,
    monthlyExpensesUsed,
    creditsRecovery,
    unitCostExclExpenses,
    displayUnitCosts,
    displayMonthlyExpensesTotal,
    totalUnitCost,
    markupPercent: settings.markupPercent,
    marginPercent: settings.marginPercent,
    mode: settings.mode,
    priceDrivingFactor,
    priceByMarkup: byMarkup,
    priceByMargin: byMargin,
    finalPrice: pricedUnitPrice,
    pricedMonthlyTotal,
    pricedUnitPrice,
    profitPerUnit,
    achievedMarkupPct,
    achievedMarginPct,
    monthlyQty: effectiveQty,
    monthlyRevenue,
    monthlyProfit,
    roaPct,
    monthlyTargetQty,
    provisionQtyPerMonth,
    monthlyTargetRevenue,
    provisionRevenue,
  };
}

export function computePricingBreakdowns(workspace: PricingWorkspace): PricingBreakdown[] {
  const units = buildPricedUnits(workspace);
  const breakdowns: PricingBreakdown[] = [];

  for (const segment of PRICING_SEGMENT_FILTERS) {
    const segmentUnits = units.filter((u) => u.segment === segment);
    if (segmentUnits.length === 0) continue;

    const segmentCosts = segmentCostTotal(workspace, segment, 'custo');
    const segmentExpenses = segmentCostTotal(workspace, segment, 'despesa');
    const segmentCredits = segmentCreditsTotal(workspace, segment);
    const allocationMode = workspace.settings.costAllocationMode ?? 'por_unidades_mes';
    const totalBaseQty = segmentBaseMonthlyQtyTotal(segmentUnits, workspace);
    const totalActiveQty = segmentActiveMonthlyQtyTotal(segmentUnits, workspace);

    const usePlanningQty = totalBaseQty <= 0;
    const planningQtyTotal = usePlanningQty
      ? segmentUnits.reduce(
          (s, u) => s + effectiveProjectionQty(resolveMonthlyQtyForUnit(u, workspace)),
          0,
        )
      : 0;
    const rateioQtyDenominator = totalBaseQty > 0 ? totalBaseQty : planningQtyTotal;

    const unitWeights = segmentUnits.map((u) => {
      const baseQty = resolveBasePricingQty(u.id, workspace);
      const qtyForWeight =
        baseQty > 0 ? baseQty : usePlanningQty ? effectiveProjectionQty(resolveMonthlyQtyForUnit(u, workspace)) : 0;
      return costAllocationWeight(u.materialCost, qtyForWeight, allocationMode);
    });
    const weightSum = unitWeights.reduce((s, w) => s + w, 0);

    for (let i = 0; i < segmentUnits.length; i++) {
      const unit = segmentUnits[i]!;
      const baseQty = resolveBasePricingQty(unit.id, workspace);
      const w = unitWeights[i]!;
      const qtyForShare =
        baseQty > 0 ? baseQty : usePlanningQty ? effectiveProjectionQty(resolveMonthlyQtyForUnit(unit, workspace)) : 0;
      const weight = weightSum > 0 && qtyForShare > 0 ? w / weightSum : 0;
      const qtyShare =
        allocationMode === 'por_unidades_mes' && rateioQtyDenominator > 0
          ? qtyForShare / rateioQtyDenominator
          : weight;
      breakdowns.push(
        breakdownForUnit(unit, workspace, segmentCosts, segmentExpenses, segmentCredits, qtyShare),
      );
    }
  }

  return breakdowns;
}

/**
 * Métricas do dashboard a partir de linhas de precificação.
 * Custos/despesas cadastrados = totais do workspace (fixos em todas as subabas).
 * Card consolidado = custos + despesas (workspace) + material mensal total do(s) item(ns) em foco.
 */
export function computeDashboardFromBreakdownRows(
  rows: PricingBreakdown[],
  workspace: PricingWorkspace,
): PricingDashboardSummary {
  const workspaceTotals = computeWorkspaceCostExpenseTotals(workspace);
  const totalMaterialCost = rows.reduce(
    (s, b) => s + b.materialCost * effectiveProjectionQty(b.monthlyQty),
    0,
  );
  const productAllocatedCosts = rows.reduce((s, b) => s + b.monthlyCostsUsed, 0);
  const productAllocatedExpenses = rows.reduce((s, b) => s + b.monthlyExpensesUsed, 0);
  const totalMonthlyRevenue = rows.reduce((s, b) => s + b.monthlyRevenue, 0);
  const totalMonthlyProfit = rows.reduce((s, b) => s + b.monthlyProfit, 0);
  const totalCredits = workspaceCreditsTotal(workspace);
  const totalStockInventory = computeStockInventoryTotal(workspace);
  const totalAcquisitionCost =
    rows.length === 1
      ? (() => {
          const item = workspace.stockItems.find((s) => s.id === rows[0]!.productId);
          return item ? stockItemAcquisitionValue(item, workspace.stockItems) : 0;
        })()
      : computeAcquisitionTotal(workspace);
  const acquisitionUnitCost =
    rows.length === 1
      ? (() => {
          const item = workspace.stockItems.find((s) => s.id === rows[0]!.productId);
          if (!item || (item.category !== 'produto_acabado' && item.category !== 'mercadoria')) {
            return undefined;
          }
          const unit = stockItemAcquisitionUnitValue(item, workspace.stockItems);
          return unit > 0 ? unit : undefined;
        })()
      : undefined;
  const totalConsolidatedCosts =
    workspaceTotals.totalCosts + workspaceTotals.totalExpenses + totalMaterialCost;
  const monthlyOperatingBurden =
    workspaceTotals.totalCosts + workspaceTotals.totalExpenses - totalCredits;
  const marginForBreakeven = resolveEffectiveMarginPercent(workspace.settings);
  const monthlyTargetRevenue = computeRequiredRevenueToCoverAndProfit(
    monthlyOperatingBurden,
    marginForBreakeven,
  );
  const provisionRevenueToCover = computeConsolidatedProvisionRevenue(
    monthlyOperatingBurden,
    marginForBreakeven,
    totalMonthlyRevenue,
  );

  return {
    totalMaterialCost,
    totalStockInventory,
    totalCosts: workspaceTotals.totalCosts,
    totalExpenses: workspaceTotals.totalExpenses,
    totalCredits,
    totalAcquisitionCost,
    acquisitionUnitCost,
    totalConsolidatedCosts,
    totalMonthlyRevenue,
    totalMonthlyProfit,
    isProfit: totalMonthlyProfit >= 0,
    monthlyOperatingBurden,
    monthlyTargetRevenue,
    provisionRevenueToCover,
    productAllocatedCosts,
    productAllocatedExpenses,
    materialUnitCost: rows.length === 1 ? rows[0]!.materialCost : undefined,
    selectedProductName: rows.length === 1 ? rows[0]!.name : undefined,
  };
}

export function computeDashboardSummary(
  breakdowns: PricingBreakdown[],
  workspace?: PricingWorkspace,
): PricingDashboardSummary {
  if (workspace) {
    return computeDashboardFromBreakdownRows(breakdowns, workspace);
  }

  const totalMaterialCost = breakdowns.reduce(
    (s, b) => s + b.materialCost * effectiveProjectionQty(b.monthlyQty),
    0,
  );
  const productAllocatedCosts = breakdowns.reduce((s, b) => s + b.monthlyCostsUsed, 0);
  const productAllocatedExpenses = breakdowns.reduce((s, b) => s + b.monthlyExpensesUsed, 0);
  const totalCosts = productAllocatedCosts;
  const totalExpenses = productAllocatedExpenses;
  const totalCredits = breakdowns.reduce(
    (s, b) => s + b.creditsRecovery * effectiveProjectionQty(b.monthlyQty),
    0,
  );
  const totalMonthlyRevenue = breakdowns.reduce((s, b) => s + b.monthlyRevenue, 0);
  const totalMonthlyProfit = breakdowns.reduce((s, b) => s + b.monthlyProfit, 0);
  const totalConsolidatedCosts =
    productAllocatedCosts + productAllocatedExpenses + totalMaterialCost;
  const monthlyOperatingBurden = totalCosts + totalExpenses - totalCredits;
  const marginForBreakeven =
    breakdowns.length > 0
      ? resolveEffectiveMarginPercent({
          markupPercent: breakdowns[0]!.markupPercent,
          marginPercent: breakdowns[0]!.marginPercent,
          mode: breakdowns[0]!.mode,
        })
      : 0;
  const monthlyTargetRevenue = computeRequiredRevenueToCoverAndProfit(
    monthlyOperatingBurden,
    marginForBreakeven,
  );
  const provisionRevenueToCover = computeConsolidatedProvisionRevenue(
    monthlyOperatingBurden,
    marginForBreakeven,
    totalMonthlyRevenue,
  );

  return {
    totalMaterialCost,
    totalStockInventory: 0,
    totalCosts,
    totalExpenses,
    totalCredits,
    totalAcquisitionCost: 0,
    totalConsolidatedCosts,
    totalMonthlyRevenue,
    totalMonthlyProfit,
    isProfit: totalMonthlyProfit >= 0,
    monthlyOperatingBurden,
    monthlyTargetRevenue,
    provisionRevenueToCover,
    productAllocatedCosts,
    productAllocatedExpenses,
  };
}

export function computeDashboardBySegment(
  breakdowns: PricingBreakdown[],
  workspace?: PricingWorkspace,
): SegmentDashboardSummary[] {
  if (!workspace) {
    return PRICING_SEGMENT_FILTERS.map((segment) => {
      const segmentRows = breakdowns.filter((b) => b.category === segment);
      const summary = computeDashboardSummary(segmentRows);
      return {
        ...summary,
        segment,
        label: PRICING_SEGMENT_LABELS[segment],
        itemCount: segmentRows.length,
      };
    });
  }

  return PRICING_SEGMENT_FILTERS.map((segment) => {
    const segmentRows = breakdowns.filter((b) => b.category === segment);
    const summary = computeDashboardFromBreakdownRows(segmentRows, workspace);
    const segmentStock =
      segment === 'servico'
        ? []
        : workspace.stockItems.filter((item) => item.category === segment);
    const segmentStockValue = segmentStock.reduce(
      (sum, item) => sum + stockItemInventoryValue(item, workspace.stockItems),
      0,
    );
    const totalAcquisitionCost = computeAcquisitionTotal(workspace, segment);
    return {
      ...summary,
      totalStockInventory: segmentStockValue,
      totalAcquisitionCost,
      segment,
      label: PRICING_SEGMENT_LABELS[segment],
      itemCount: segmentRows.length,
    };
  });
}

export function sortByRentability(breakdowns: PricingBreakdown[], ascending = true): PricingBreakdown[] {
  return [...breakdowns].sort((a, b) => (ascending ? a.roaPct - b.roaPct : b.roaPct - a.roaPct));
}

export function breakdownsForSegment(
  breakdowns: PricingBreakdown[],
  segment: PricingSegment | 'all',
): PricingBreakdown[] {
  if (segment === 'all') return breakdowns;
  return breakdowns.filter((b) => b.category === segment);
}
