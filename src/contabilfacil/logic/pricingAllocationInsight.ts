import {
  countSegmentAllocationParticipants,
  getSegmentMonthlyOverheadPool,
} from './pricingCalculator';
import type { PricingBreakdown, PricingSegment, PricingWorkspace } from './pricingTypes';
import { PRICING_SEGMENT_LABELS } from './pricingTypes';

export type RateioConcentrationAlert = {
  productId: string;
  productName: string;
  segment: PricingSegment;
  sharePct: number;
  poolOverhead: number;
  allocatedMonthly: number;
  materialMonthly: number;
  rateioPerUnit: number;
  activeProductsInSegment: number;
  registeredProductsInSegment: number;
  soleActiveProduct: boolean;
};

export function buildRateioConcentrationAlerts(
  breakdowns: PricingBreakdown[],
  workspace: PricingWorkspace,
  minShare = 0.9,
): RateioConcentrationAlert[] {
  return breakdowns
    .filter((b) => b.allocationShare >= minShare && b.pricedUnitPrice > 0)
    .map((b) => {
      const pool = getSegmentMonthlyOverheadPool(workspace, b.category);
      const participants = countSegmentAllocationParticipants(workspace, b.category);
      const qty = b.monthlyQty > 0 ? b.monthlyQty : 0;
      const allocatedMonthly = b.monthlyCostsUsed + b.monthlyExpensesUsed;
      const materialMonthly = b.materialCost * qty;
      const rateioPerUnit = qty > 0 ? allocatedMonthly / qty : 0;
      return {
        productId: b.productId,
        productName: b.name || '—',
        segment: b.category,
        sharePct: b.allocationShare * 100,
        poolOverhead: pool.overhead,
        allocatedMonthly,
        materialMonthly,
        rateioPerUnit,
        activeProductsInSegment: participants.withQty,
        registeredProductsInSegment: participants.registered,
        soleActiveProduct: participants.withQty <= 1,
      };
    });
}

export function formatRateioConcentrationSummary(
  alert: RateioConcentrationAlert,
  fmtMoney: (n: number) => string,
): string {
  const seg = PRICING_SEGMENT_LABELS[alert.segment];
  if (alert.soleActiveProduct && alert.sharePct >= 99.5) {
    return (
      `${alert.productName}: ${alert.sharePct.toFixed(1)}% do rateio do segmento «${seg}» — ` +
      `é o único produto com qtd/mês > 0 (${alert.registeredProductsInSegment} cadastrado(s) no segmento). ` +
      `Pool fixo do segmento: ${fmtMoney(alert.poolOverhead)}; absorvido por este produto: ${fmtMoney(alert.allocatedMonthly)} ` +
      `(≈ ${fmtMoney(alert.rateioPerUnit)}/un. só de rateio; material do mês ≈ ${fmtMoney(alert.materialMonthly)}).`
    );
  }
  return (
    `${alert.productName}: ${alert.sharePct.toFixed(1)}% do pool «${seg}» ` +
    `(${fmtMoney(alert.allocatedMonthly)} de ${fmtMoney(alert.poolOverhead)}). ` +
    `${alert.activeProductsInSegment} de ${alert.registeredProductsInSegment} produto(s) com qtd/mês no segmento.`
  );
}
