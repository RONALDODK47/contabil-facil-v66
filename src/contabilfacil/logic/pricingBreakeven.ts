import type { PricingBreakdown, PricingMode } from './pricingTypes';

function projectionQty(monthlyQty: number): number {
  return monthlyQty > 0 ? monthlyQty : 1;
}

/** Margem efetiva (%) usada no cálculo de receita consolidada no dashboard. */
export function resolveEffectiveMarginPercent(settings: {
  markupPercent: number;
  marginPercent: number;
  mode: PricingMode;
}): number {
  const markupAsMargin =
    settings.markupPercent > 0
      ? (settings.markupPercent / (100 + settings.markupPercent)) * 100
      : 0;
  if (settings.mode === 'margin_only') return settings.marginPercent;
  if (settings.mode === 'markup_only') return markupAsMargin;
  return Math.max(settings.marginPercent, markupAsMargin);
}

export interface BreakevenMetrics {
  /** Unidades/mês para cobrir material + custos + despesas do mês (não ficar no vermelho). */
  monthlyTargetQty: number | null;
  /** Provisão: quantas unidades/mês ainda faltam (meta − qtd/mês na tabela). */
  provisionQtyPerMonth: number | null;
  /** Receita mensal necessária na meta (≈ custo total do mês no ponto de equilíbrio). */
  monthlyTargetRevenue: number | null;
  /** Receita que ainda falta para atingir a meta. */
  provisionRevenue: number | null;
}

export type BreakevenMetricsInput = {
  materialCost: number;
  /** Custo completo/un. (material + rateio − créditos) — base do preço de venda. */
  totalUnitCost: number;
  pricedUnitPrice: number;
  monthlyCostsUsed: number;
  monthlyExpensesUsed: number;
  creditsRecovery: number;
  /** Qtd/mês exibida na tabela (pode incluir vezes em dobro). */
  monthlyQty: number;
  /** Qtd base usada no rateio (sem vezes em dobro) — custo fixo do mês. */
  baseQty: number;
};

/**
 * Meta de vendas/mês: se o preço cobre o custo total/un., a meta é a qtd atual;
 * se não cobre, usa margem de contribuição (preço − material) para absorver o fixo do mês.
 */
export function computeBreakevenMetrics(input: BreakevenMetricsInput): BreakevenMetrics {
  const currentQty = input.monthlyQty > 0 ? input.monthlyQty : 0;
  const baseQtyProj = projectionQty(input.baseQty);
  const pricePerUnit = input.pricedUnitPrice;

  /** Custos + despesas rateados no mês (já na qtd base do rateio; não muda com “vezes em dobro”). */
  const monthlyOverhead = Math.max(
    0,
    input.monthlyCostsUsed +
      input.monthlyExpensesUsed -
      input.creditsRecovery * baseQtyProj,
  );
  const profitAfterFullCost = pricePerUnit - input.totalUnitCost;
  const contributionPerUnit = pricePerUnit - input.materialCost;

  if (pricePerUnit <= 0) {
    return {
      monthlyTargetQty: null,
      provisionQtyPerMonth: null,
      monthlyTargetRevenue: null,
      provisionRevenue: null,
    };
  }

  let monthlyTargetQty: number;

  if (monthlyOverhead <= 0 && profitAfterFullCost >= 0) {
    monthlyTargetQty = currentQty > 0 ? currentQty : 1;
  } else if (profitAfterFullCost >= 0) {
    monthlyTargetQty = Math.max(1, currentQty > 0 ? currentQty : 1);
  } else if (contributionPerUnit > 0) {
    monthlyTargetQty = Math.max(1, Math.ceil(monthlyOverhead / contributionPerUnit));
  } else {
    const monthlyTotalCost = monthlyOverhead + input.materialCost * baseQtyProj;
    monthlyTargetQty = Math.max(1, Math.ceil(monthlyTotalCost / pricePerUnit));
  }

  const monthlyTargetRevenue = monthlyTargetQty * pricePerUnit;
  const provisionQtyPerMonth = Math.max(0, monthlyTargetQty - currentQty);
  const provisionRevenue = Math.max(0, monthlyTargetRevenue - currentQty * pricePerUnit);

  return {
    monthlyTargetQty,
    provisionQtyPerMonth,
    monthlyTargetRevenue,
    provisionRevenue,
  };
}

/** Meta de receita mensal consolidada (antes de descontar o já projetado). */
export function computeMonthlyTargetRevenue(
  monthlyCostsPlusExpensesNet: number,
  marginPercent: number,
): number {
  return computeRequiredRevenueToCoverAndProfit(monthlyCostsPlusExpensesNet, marginPercent);
}

/** Receita mensal consolidada para cobrir custos + despesas rateados e lucro na margem global. */
export function computeRequiredRevenueToCoverAndProfit(
  monthlyCostsPlusExpensesNet: number,
  marginPercent: number,
): number {
  if (monthlyCostsPlusExpensesNet <= 0) return 0;
  const m = Math.min(Math.max(marginPercent, 0), 99.9) / 100;
  if (m >= 0.999) return monthlyCostsPlusExpensesNet;
  return monthlyCostsPlusExpensesNet / (1 - m);
}

/** Provisão consolidada = meta de receita − receita já projetada nos produtos. */
export function computeConsolidatedProvisionRevenue(
  monthlyOperatingBurden: number,
  marginPercent: number,
  projectedMonthlyRevenue: number,
): number {
  const target = computeRequiredRevenueToCoverAndProfit(monthlyOperatingBurden, marginPercent);
  return Math.max(0, target - projectedMonthlyRevenue);
}
