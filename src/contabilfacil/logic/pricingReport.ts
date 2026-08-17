import {
  countSegmentAllocationParticipants,
  getSegmentMonthlyOverheadPool,
  priceFromMargin,
  priceFromMarkup,
  priceFromMarkupAndMargin,
  recipeDoublesToScaleFactor,
  resolveRecipeYieldQty,
} from './pricingCalculator';
import { resolvePricingMonthlyQty } from './pricingPrecificacaoTable';
import type {
  CostAllocationMode,
  GlobalPricingSettings,
  PricingBreakdown,
  PricingMode,
  PricingWorkspace,
  StockItem,
} from './pricingTypes';
import { PRICING_SEGMENT_LABELS } from './pricingTypes';

export type PricingReportLine = {
  label: string;
  value: string;
  formula?: string;
};

export type PricingReportSection = {
  title: string;
  lines: PricingReportLine[];
};

export type PricingProductReport = {
  productId: string;
  productName: string;
  segmentLabel: string;
  sections: PricingReportSection[];
};

export type PricingReportFormatters = {
  money: (n: number) => string;
  qty: (n: number) => string;
  pct: (n: number) => string;
};

const ALLOCATION_MODE_LABELS: Record<CostAllocationMode, string> = {
  por_volume: 'Por volume (custo material × qtd/mês)',
  por_custo_material: 'Por custo de material no mês',
  por_unidades_mes: 'Por unidades/mês informadas',
};

const PRICE_MODE_LABELS: Record<PricingMode, string> = {
  markup_only: 'Somente markup',
  margin_only: 'Somente margem de lucro',
  both: 'Markup + margem (os dois no preço)',
};

function line(label: string, value: string, formula?: string): PricingReportLine {
  return { label, value, formula };
}

function resolveQtyContext(
  b: PricingBreakdown,
  workspace: PricingWorkspace,
  stockItem: StockItem | undefined,
  qtyInformed: number,
): {
  baseMonthlyQty: number;
  doubles: number;
  scaleFactor: number;
  qtyOverride: number | undefined;
} {
  const qtyOverride = workspace.productOverrides[b.productId]?.monthlyQty;
  const doubles = stockItem?.recipeQuantityDoubles ?? 0;
  const baseMonthlyQty =
    stockItem && stockItem.monthlyQty > 0
      ? stockItem.monthlyQty
      : qtyInformed > 0 && doubles > 0
        ? Math.round(qtyInformed / recipeDoublesToScaleFactor(doubles))
        : qtyInformed;
  return {
    baseMonthlyQty,
    doubles,
    scaleFactor: recipeDoublesToScaleFactor(doubles),
    qtyOverride,
  };
}

function contributionPerUnit(b: PricingBreakdown): number {
  return b.pricedUnitPrice - b.materialCost;
}

function monthlyOverheadForReport(b: PricingBreakdown): number {
  const qtyProj = b.monthlyQty > 0 ? b.monthlyQty : 1;
  return Math.max(
    0,
    b.monthlyCostsUsed + b.monthlyExpensesUsed - b.creditsRecovery * qtyProj,
  );
}

export function buildGlobalPricingReportIntro(
  settings: GlobalPricingSettings,
  fmt: PricingReportFormatters,
): PricingReportSection {
  return {
    title: 'Parâmetros globais',
    lines: [
      line('Markup', fmt.pct(settings.markupPercent)),
      line('Margem de lucro', fmt.pct(settings.marginPercent)),
      line('Regra de preço', PRICE_MODE_LABELS[settings.mode]),
      line(
        'Rateio de custos/despesas',
        ALLOCATION_MODE_LABELS[settings.costAllocationMode ?? 'por_unidades_mes'],
      ),
    ],
  };
}

export function buildPricingProductReport(
  b: PricingBreakdown,
  workspace: PricingWorkspace,
  fmt: PricingReportFormatters,
): PricingProductReport {
  const stockItem = workspace.stockItems.find((s) => s.id === b.productId);
  const qtyInformed = resolvePricingMonthlyQty(b, workspace);
  const qtyCtx = resolveQtyContext(b, workspace, stockItem, qtyInformed);
  const projectionQty = b.monthlyQty > 0 ? b.monthlyQty : 1;
  const costBase = b.totalUnitCost;
  const byMarkup = priceFromMarkup(costBase, b.markupPercent);
  const byMargin = priceFromMargin(costBase, b.marginPercent);
  const byCombined = priceFromMarkupAndMargin(costBase, b.markupPercent, b.marginPercent);
  const overhead = monthlyOverheadForReport(b);
  const contribution = contributionPerUnit(b);
  const provisionQty = b.provisionQtyPerMonth ?? Math.max(0, (b.monthlyTargetQty ?? 0) - qtyInformed);
  const segmentPool = getSegmentMonthlyOverheadPool(workspace, b.category);
  const segmentParticipants = countSegmentAllocationParticipants(workspace, b.category);
  const allocatedMonthly = b.monthlyCostsUsed + b.monthlyExpensesUsed;
  const materialMonthly = b.materialCost * projectionQty;

  const priceRuleDetail =
    b.mode === 'both'
      ? `Markup ${fmt.pct(b.markupPercent)} e margem ${fmt.pct(b.marginPercent)} aplicados juntos`
      : undefined;

  const sections: PricingReportSection[] = [
    {
      title: '1. Quantidade na precificação',
      lines: [
        ...(stockItem?.category === 'produto_acabado' && stockItem.useBom
          ? [
              line(
                'Rendimento (un./receita)',
                fmt.qty(resolveRecipeYieldQty(stockItem)),
                'Divide o custo dos insumos da composição',
              ),
              line('Qtd/mês (estoque)', fmt.qty(qtyCtx.baseMonthlyQty), 'Projeção de vendas; rateio'),
              line(
                'Qtd/mês na tabela',
                fmt.qty(qtyInformed),
                qtyCtx.scaleFactor !== 1
                  ? `${fmt.qty(qtyCtx.baseMonthlyQty)} × ${qtyCtx.scaleFactor} = ${fmt.qty(qtyInformed)}`
                  : fmt.qty(qtyInformed),
              ),
            ]
          : [
              line('Qtd/mês informada', fmt.qty(qtyInformed)),
            ]),
        ...(qtyCtx.qtyOverride != null && qtyCtx.qtyOverride > 0
          ? [line('Override de qtd (produto)', fmt.qty(qtyCtx.qtyOverride), 'Substitui qtd/mês do estoque')]
          : []),
        line('Qtd usada no rateio', fmt.qty(projectionQty), 'Mínimo 1 un. se qtd/mês = 0'),
      ],
    },
    {
      title: '2. Custo unitário',
      lines: [
        ...(b.bomDetail.length > 0
          ? [
              line(
                'Total composição (receita)',
                fmt.money(b.bomDetail.reduce((s, row) => s + row.cost, 0)),
                'Soma dos insumos/MP na composição para o rendimento informado',
              ),
              ...b.bomDetail.map((row) =>
                line(`  · ${row.name}`, fmt.money(row.cost), row.qty),
              ),
              line(
                'Material por unidade (1 un.)',
                fmt.money(b.materialCost),
                'Total da receita ÷ rendimento (un./receita no cadastro)',
              ),
            ]
          : [
              line('Material (BOM / direto)', fmt.money(b.materialCost)),
            ]),
        line('Custos rateados / un.', fmt.money(b.allocatedCosts)),
        line('Despesas rateadas / un.', fmt.money(b.allocatedExpenses)),
        line('Crédito recuperável / un.', fmt.money(-b.creditsRecovery)),
        line('Custo unitário total', fmt.money(b.totalUnitCost), 'Material + custos + despesas − crédito'),
      ],
    },
    {
      title: '3. Formação do preço',
      lines: [
        line(
          'Preço por markup',
          fmt.money(byMarkup),
          `Custo unitário total × (1 + ${fmt.pct(b.markupPercent)})`,
        ),
        line(
          'Preço por margem',
          fmt.money(byMargin),
          `Custo unitário total ÷ (1 − ${fmt.pct(b.marginPercent)})`,
        ),
        ...(b.mode === 'both'
          ? [
              line(
                'Preço combinado (adotado)',
                fmt.money(byCombined),
                `Custo unitário total × (1 + ${fmt.pct(b.markupPercent)}) ÷ (1 − ${fmt.pct(b.marginPercent)})`,
              ),
            ]
          : []),
        line(
          'Preço unitário adotado',
          fmt.money(b.pricedUnitPrice),
          priceRuleDetail ?? 'Markup/margem sobre custo unitário total (material + rateio − créditos).',
        ),
        line('Markup configurado', fmt.pct(b.markupPercent)),
        line('Margem configurada', fmt.pct(b.marginPercent)),
      ],
    },
    {
      title: '4. Projeção do mês',
      lines: [
        line(
          'Valor total precificado',
          fmt.money(b.pricedMonthlyTotal),
          `${fmt.money(b.pricedUnitPrice)} × ${fmt.qty(projectionQty)}`,
        ),
        line(
          'Pool custos+despesas do segmento',
          fmt.money(segmentPool.overhead),
          PRICING_SEGMENT_LABELS[b.category],
        ),
        line(
          'Produtos com qtd/mês no segmento',
          `${segmentParticipants.withQty} de ${segmentParticipants.registered}`,
          'Só estes dividem o rateio; os demais ficam com 0%',
        ),
        line('% rateio neste produto', fmt.pct(b.allocationShare * 100)),
        line(
          'Fixos absorvidos (custos+despesas)',
          fmt.money(allocatedMonthly),
          segmentParticipants.withQty <= 1
            ? 'Único produto ativo — explica 100% do pool'
            : undefined,
        ),
        line('Material do mês (un. × qtd)', fmt.money(materialMonthly)),
        line('Custos rateados no mês', fmt.money(b.monthlyCostsUsed)),
        line('Despesas rateadas no mês', fmt.money(b.monthlyExpensesUsed)),
        line('Lucro projetado no mês', fmt.money(b.monthlyProfit)),
      ],
    },
    {
      title: '5. Meta sem prejuízo (qtd e valor esperados)',
      lines: [
        line('Overhead mensal do produto', fmt.money(overhead), 'Custos + despesas do mês − créditos'),
        line(
          'Contribuição / un.',
          fmt.money(contribution),
          'Preço unitário − material (paga o rateio fixo)',
        ),
        ...(b.monthlyTargetQty != null && b.monthlyTargetQty > 0
          ? [
              line(
                'Mínimo de un./mês (meta)',
                fmt.qty(b.monthlyTargetQty),
                `Teto(${fmt.money(overhead)} ÷ ${fmt.money(contribution)})`,
              ),
              line(
                'Ainda faltam (provisão)',
                provisionQty > 0 ? fmt.qty(provisionQty) : '0 — meta atingida',
                `Meta − qtd/mês informada (${fmt.qty(qtyInformed)})`,
              ),
            ]
          : [
              line(
                'Mínimo de un./mês',
                '—',
                'Contribuição ≤ 0 ou preço inválido — revise custos/preço',
              ),
            ]),
      ],
    },
  ];

  return {
    productId: b.productId,
    productName: b.name || '—',
    segmentLabel: PRICING_SEGMENT_LABELS[b.category],
    sections,
  };
}
