import { resolveEffectivePricingQty } from './pricingCalculator';
import type { PricingBreakdown, PricingMode, PricingWorkspace } from './pricingTypes';
import { PRICING_SEGMENT_LABELS, roundStockMoney } from './pricingTypes';

const PRECIFICACAO_TABLE_BASE_HEADERS = [
  'Produto',
  'Segmento',
  'Qtd/mês',
  '% rateio',
  'Custo material (un.)',
  'Custos gerais (un.)',
] as const;

function getPriceBlockHeaders(mode: PricingMode): string[] {
  const tail = ['Valor unitário (venda)', 'Venda total (mês)'];
  if (mode === 'markup_only') {
    return ['Markup %', ...tail];
  }
  if (mode === 'margin_only') {
    return ['Margem %', ...tail];
  }
  return ['Markup %', 'Margem %', ...tail];
}

/** Cabeçalhos da tabela conforme a regra de preço (markup e/ou margem). */
export function getPrecificacaoTableHeaders(mode: PricingMode): string[] {
  return [...PRECIFICACAO_TABLE_BASE_HEADERS, ...getPriceBlockHeaders(mode)];
}

export function precificacaoTableColumnCount(mode: PricingMode): number {
  return getPrecificacaoTableHeaders(mode).length;
}

export function showMarkupColumn(mode: PricingMode): boolean {
  return mode !== 'margin_only';
}

export function showMarginColumn(mode: PricingMode): boolean {
  return mode !== 'markup_only';
}

/** @deprecated use getPrecificacaoTableHeaders(mode) */
export const PRECIFICACAO_TABLE_HEADERS = getPrecificacaoTableHeaders('both');

/** @deprecated use precificacaoTableColumnCount(mode) */
export const PRECIFICACAO_TABLE_COLUMN_COUNT = precificacaoTableColumnCount('both');

/** Custo material/un. na tabela (= `materialCost` do cálculo, não o total do lote). */
export function pricingMaterialUnitCost(b: PricingBreakdown): number {
  return b.materialCost;
}

/** Custo de compra/un. para mercadoria (revenda) — base original antes do markup/margem. */
export function resolveMercadoriaPurchaseUnitCost(b: PricingBreakdown): number {
  if (b.materialCost > 0) return b.materialCost;
  return Math.max(0, b.totalUnitCost - Math.max(0, b.displayUnitCosts));
}

/** Colunas de custo na tabela de precificação (valores por unidade). */
export function pricingCostColumnValues(b: PricingBreakdown): {
  /** Custo de composição (PA). Null = não se aplica (mercadoria). */
  materialUnit: number | null;
  /** PA: rateio custos+despesas/un. Mercadoria: valor de compra/un. (+ rateio se houver). */
  generalCostsUnit: number;
  allocatedCostsUnit: number;
  allocatedExpensesUnit: number;
} {
  if (b.category === 'mercadoria') {
    const purchaseUnit = resolveMercadoriaPurchaseUnitCost(b);
    const rateioUnit = Math.max(0, b.displayUnitCosts);
    return {
      materialUnit: null,
      generalCostsUnit: roundStockMoney(purchaseUnit + rateioUnit, 2),
      allocatedCostsUnit: b.allocatedCosts,
      allocatedExpensesUnit: b.allocatedExpenses,
    };
  }

  return {
    materialUnit: pricingMaterialUnitCost(b),
    generalCostsUnit: Math.max(0, b.displayUnitCosts),
    allocatedCostsUnit: b.allocatedCosts,
    allocatedExpensesUnit: b.allocatedExpenses,
  };
}

export function formatPricingMaterialUnitCell(
  materialUnit: number | null,
  fmt: { money: (n: number) => string },
): string {
  return materialUnit != null && materialUnit > 0 ? fmt.money(materialUnit) : '—';
}

/**
 * Quantidade ideal de vendas/mês para cobrir material (qtd base) + custos + despesas do mês.
 */
export function resolveExpectedQtyDisplay(
  b: PricingBreakdown,
  _qtyInformed?: number,
): number | null {
  const target = b.monthlyTargetQty;
  return target != null && target > 0 ? target : null;
}

/**
 * Faturamento mensal na meta (quantidade ideal × preço unitário de venda).
 */
export function resolveExpectedRevenueDisplay(
  b: PricingBreakdown,
  _qtyInformed?: number,
): number | null {
  if (b.monthlyTargetRevenue != null && b.monthlyTargetRevenue > 0) {
    return b.monthlyTargetRevenue;
  }
  const qty = resolveExpectedQtyDisplay(b);
  const unit = b.pricedUnitPrice;
  if (qty == null || qty <= 0 || unit <= 0) return null;
  return qty * unit;
}

/**
 * Qtd/mês exibida na tabela — mesma usada no cálculo da linha (`b.monthlyQty`).
 */
export function resolvePricingMonthlyQty(
  b: PricingBreakdown,
  workspace: Pick<PricingWorkspace, 'stockItems' | 'serviceItems' | 'productOverrides'>,
): number {
  if (b.monthlyQty > 0) return b.monthlyQty;
  return resolveEffectivePricingQty(b.productId, workspace);
}

/** Preço/un. de venda (markup/margem conforme regra global). */
export function resolveDisplayedUnitPrice(b: PricingBreakdown, _qtyDisplay?: number): number {
  return b.pricedUnitPrice;
}

/** Venda total (mês) = preço unitário × qtd/mês informada; sem qtd, não projeta valor. */
export function resolvePricingMonthlyTotal(
  b: PricingBreakdown,
  qtyDisplay: number,
): number | null {
  if (qtyDisplay <= 0 || b.pricedUnitPrice <= 0) return null;
  return roundStockMoney(b.pricedUnitPrice * qtyDisplay, 2);
}

export function pricingRowArithmeticCheck(
  b: PricingBreakdown,
  qtyDisplay: number,
): { unitFromTotal: number; product: number; matches: boolean } {
  const unitFromTotal = resolveDisplayedUnitPrice(b, qtyDisplay);
  const monthlyTotal = resolvePricingMonthlyTotal(b, qtyDisplay);
  const product = monthlyTotal ?? 0;
  const matches =
    qtyDisplay > 0 &&
    monthlyTotal != null &&
    Math.abs(product - monthlyTotal) < 0.02 &&
    Math.abs(unitFromTotal - b.pricedUnitPrice) < 0.05;
  return { unitFromTotal, product, matches };
}

/** % do pool de custos+despesas do segmento usada neste produto no cálculo. */
export function formatAllocationSharePercent(share: number): string {
  if (share <= 0) return '0%';
  const pct = share * 100;
  const text = pct >= 100 ? pct.toFixed(1) : pct.toFixed(2);
  return `${text.replace('.', ',')}%`;
}

/** @deprecated use formatAllocationSharePercent */
export function formatAllocationShareDecimal(share: number): string {
  return formatAllocationSharePercent(share);
}

export type PrecificacaoRowFormatters = {
  money: (n: number) => string;
  qty: (n: number) => string;
  pct: (n: number) => string;
  share: (n: number) => string;
};

export function formatExpectedQtyCell(value: number | null, fmt: PrecificacaoRowFormatters): string {
  return value != null && value > 0 ? fmt.qty(value) : '—';
}

export function formatExpectedRevenueCell(value: number | null, fmt: PrecificacaoRowFormatters): string {
  return value != null && value > 0 ? fmt.money(value) : '—';
}

export function buildPrecificacaoTableRow(
  b: PricingBreakdown,
  monthlyQty: number,
  fmt: PrecificacaoRowFormatters,
  mode: PricingMode = b.mode,
): string[] {
  const costs = pricingCostColumnValues(b);
  const row: string[] = [
    b.name || '—',
    PRICING_SEGMENT_LABELS[b.category],
    fmt.qty(monthlyQty),
    fmt.pct(b.allocationShare * 100),
    formatPricingMaterialUnitCell(costs.materialUnit, fmt),
    fmt.money(costs.generalCostsUnit),
  ];
  if (showMarkupColumn(mode)) row.push(fmt.pct(b.markupPercent));
  if (showMarginColumn(mode)) row.push(fmt.pct(b.marginPercent));
  row.push(fmt.money(resolveDisplayedUnitPrice(b, monthlyQty)));
  const monthlyTotal = resolvePricingMonthlyTotal(b, monthlyQty);
  row.push(monthlyTotal != null ? fmt.money(monthlyTotal) : '—');
  return row;
}
