import type {
  PricingSegment,
  PricingWorkspace,
  StockCategory,
  StockItem,
  StockItemCredit,
} from './pricingTypes';
import { PRICING_SEGMENT_FILTERS } from './pricingTypes';

export type { StockItemCredit };

export interface StockCreditCardRow {
  stockItemId: string;
  stockName: string;
  category: StockCategory;
  segment: PricingSegment | null;
  creditKind: string;
  name: string;
  amount: number;
  taxRegime?: string;
}

export interface StockCreditsSummary {
  total: number;
  bySegment: Record<PricingSegment, number>;
  rows: StockCreditCardRow[];
}

const STOCK_CREDIT_CATEGORIES = new Set<StockCategory>([
  'insumo',
  'materia_prima',
  'produto_acabado',
  'mercadoria',
]);

export function stockCategoryToPricingSegment(
  category: StockCategory,
): PricingSegment | null {
  if (category === 'produto_acabado' || category === 'mercadoria') return category;
  return null;
}

export function stockItemCreditsTotal(item: StockItem): number {
  return (item.recoverableCredits ?? []).reduce((s, c) => s + Math.max(0, c.amount), 0);
}

export function computeStockCreditsSummary(
  workspace: PricingWorkspace,
  scope: PricingSegment | 'geral' | 'all' = 'all',
): StockCreditsSummary {
  const bySegment: Record<PricingSegment, number> = {
    produto_acabado: 0,
    mercadoria: 0,
    servico: 0,
  };
  const rows: StockCreditCardRow[] = [];

  for (const item of workspace.stockItems) {
    if (!STOCK_CREDIT_CATEGORIES.has(item.category)) continue;
    const segment = stockCategoryToPricingSegment(item.category);
    if (scope !== 'all' && scope !== 'geral') {
      if (!segment || segment !== scope) continue;
    }
    for (const credit of item.recoverableCredits ?? []) {
      if (credit.amount <= 0) continue;
      if (segment) bySegment[segment] += credit.amount;
      rows.push({
        stockItemId: item.id,
        stockName: item.name?.trim() || 'Sem nome',
        category: item.category,
        segment,
        creditKind: credit.creditKind,
        name: credit.name,
        amount: credit.amount,
        taxRegime: credit.taxRegime,
      });
    }
  }

  const legacy = workspace.credits ?? [];
  for (const credit of legacy) {
    if (credit.monthlyAmount <= 0) continue;
    const segments =
      credit.applicableSegments.length === 0 ? PRICING_SEGMENT_FILTERS : credit.applicableSegments;
    for (const seg of segments) {
      if (scope !== 'all' && scope !== 'geral' && seg !== scope) continue;
      bySegment[seg] += credit.monthlyAmount;
      rows.push({
        stockItemId: `legacy-${credit.id}`,
        stockName: credit.name || 'Crédito geral (legado)',
        category: seg === 'mercadoria' ? 'mercadoria' : 'produto_acabado',
        segment: seg,
        creditKind: credit.creditKind,
        name: credit.name,
        amount: credit.monthlyAmount,
        taxRegime: credit.taxRegime,
      });
    }
  }

  const total = rows.reduce((s, r) => s + r.amount, 0);
  return { total, bySegment, rows };
}

export function listLicitanteInstitutions(workspace: PricingWorkspace): string[] {
  const fromRegistry = workspace.licitanteInstitutions ?? [];
  const fromItems = workspace.stockItems
    .map((s) => s.licitanteInstitution?.trim())
    .filter((s): s is string => !!s);
  return [...new Set([...fromRegistry, ...fromItems])].sort((a, b) =>
    a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }),
  );
}

export function stockMatchesLicitanteFilter(item: StockItem, filter: string): boolean {
  if (!filter.trim()) return true;
  const norm = filter.trim().toUpperCase();
  return (item.licitanteInstitution ?? '').trim().toUpperCase() === norm;
}
