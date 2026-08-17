import { effectiveProjectionQty } from './pricingCalculator';
import { computeStockCreditsSummary } from './pricingStockCredits';
import type {
  CostExpenseKindTotals,
  PricingBreakdown,
  PricingSegment,
  PricingWorkspace,
} from './pricingTypes';
import { computeCostExpenseKindTotals } from './pricingTypes';

export type PricingDreScope = PricingSegment | 'geral';

export type PricingDreLineKind = 'header' | 'add' | 'subtract' | 'subtotal' | 'total';

export interface PricingDreLine {
  id: string;
  label: string;
  value: number;
  kind: PricingDreLineKind;
  indent?: number;
}

export interface PricingDreSummary {
  scope: PricingDreScope;
  scopeLabel: string;
  productName?: string;
  lines: PricingDreLine[];
  grossRevenue: number;
  grossProfit: number;
  netResult: number;
  netMarginPct: number;
  pricingProfitTotal: number;
}

function materialMonthlyTotal(rows: PricingBreakdown[]): number {
  return rows.reduce(
    (s, b) => s + b.materialCost * effectiveProjectionQty(b.monthlyQty),
    0,
  );
}

function filterBreakdownRows(
  breakdowns: PricingBreakdown[],
  scope: PricingDreScope,
  productId?: string,
): PricingBreakdown[] {
  if (productId) {
    const row = breakdowns.find((b) => b.productId === productId);
    return row ? [row] : [];
  }
  if (scope === 'geral') return breakdowns;
  return breakdowns.filter((b) => b.category === scope);
}

function costKindTotalsForScope(
  workspace: PricingWorkspace,
  scope: PricingDreScope,
): CostExpenseKindTotals {
  if (scope === 'geral') return computeCostExpenseKindTotals(workspace.costExpenses);
  return computeCostExpenseKindTotals(workspace.costExpenses, scope);
}

export function computePricingDre(
  breakdowns: PricingBreakdown[],
  workspace: PricingWorkspace,
  scope: PricingDreScope = 'geral',
  productId?: string,
): PricingDreSummary {
  const rows = filterBreakdownRows(breakdowns, scope, productId);
  const kindTotals = costKindTotalsForScope(workspace, scope);
  const credits = computeStockCreditsSummary(
    workspace,
    scope === 'geral' ? 'all' : scope,
  ).total;

  const grossRevenue = rows.reduce((s, b) => s + b.monthlyRevenue, 0);
  const costOfSales = materialMonthlyTotal(rows);
  const grossProfit = grossRevenue - costOfSales;

  const operationalCosts = kindTotals.fixedCosts + kindTotals.variableCosts;
  const operationalExpenses = kindTotals.fixedExpenses + kindTotals.variableExpenses;
  const netResult = grossProfit - operationalCosts - operationalExpenses + credits;
  const netMarginPct = grossRevenue > 0 ? (netResult / grossRevenue) * 100 : 0;
  const pricingProfitTotal = rows.reduce((s, b) => s + b.monthlyProfit, 0);

  const scopeLabel =
    scope === 'geral'
      ? 'Geral'
      : scope === 'produto_acabado'
        ? 'Produto acabado'
        : scope === 'mercadoria'
          ? 'Mercadoria'
          : 'Serviço';

  const lines: PricingDreLine[] = [
    {
      id: 'revenue',
      label: '(+) Receita operacional bruta projetada',
      value: grossRevenue,
      kind: 'add',
    },
    {
      id: 'cmv',
      label: '(−) Custo dos produtos / mercadorias / serviços (CMV)',
      value: costOfSales,
      kind: 'subtract',
      indent: 1,
    },
    {
      id: 'gross',
      label: '(=) Lucro bruto',
      value: grossProfit,
      kind: 'subtotal',
    },
    {
      id: 'costs-fixed',
      label: '(−) Custos operacionais — fixos',
      value: kindTotals.fixedCosts,
      kind: 'subtract',
      indent: 1,
    },
    {
      id: 'costs-variable',
      label: '(−) Custos operacionais — variáveis',
      value: kindTotals.variableCosts,
      kind: 'subtract',
      indent: 1,
    },
    {
      id: 'expenses-fixed',
      label: '(−) Despesas operacionais — fixas',
      value: kindTotals.fixedExpenses,
      kind: 'subtract',
      indent: 1,
    },
    {
      id: 'expenses-variable',
      label: '(−) Despesas operacionais — variáveis',
      value: kindTotals.variableExpenses,
      kind: 'subtract',
      indent: 1,
    },
    {
      id: 'credits',
      label: '(+) Créditos tributários a recuperar',
      value: credits,
      kind: 'add',
      indent: 1,
    },
    {
      id: 'net',
      label: '(=) Resultado líquido projetado (DRE)',
      value: netResult,
      kind: 'total',
    },
  ];

  return {
    scope,
    scopeLabel,
    productName: rows.length === 1 ? rows[0]!.name : undefined,
    lines,
    grossRevenue,
    grossProfit,
    netResult,
    netMarginPct,
    pricingProfitTotal,
  };
}
