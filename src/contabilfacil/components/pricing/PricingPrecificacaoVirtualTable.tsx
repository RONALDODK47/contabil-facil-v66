import { memo, useMemo } from 'react';
import { cn, formatCurrency } from '../../lib/utils';
import { useVirtualWindow, VirtualSpacerRow } from '../../lib/useVirtualWindow';
import {
  formatAllocationSharePercent,
  resolvePricingMonthlyQty,
  resolvePricingMonthlyTotal,
  resolveDisplayedUnitPrice,
  formatPricingMaterialUnitCell,
  resolveMercadoriaPurchaseUnitCost,
  precificacaoTableColumnCount,
  pricingCostColumnValues,
  showMarginColumn,
  showMarkupColumn,
} from '../../logic/pricingPrecificacaoTable';
import {
  monthlyQtyLooksLikeRecipeYield,
  resolveRecipeBatchYield,
} from '../../logic/pricingCalculator';
import type { PricingBreakdown, PricingMode, PricingWorkspace } from '../../logic/pricingTypes';
import { PRICING_SEGMENT_LABELS } from '../../logic/pricingTypes';

const ROW_HEIGHT_PX = 40;

const HEADERS: Array<[string, string | undefined]> = [
  ['Produto', undefined],
  ['Segmento', undefined],
  [
    'Qtd/mês',
    'Vendas estimadas no mês (rateio dos custos fixos). Não use o rendimento da receita (ex.: 7) — use o volume mensal (ex.: 100).',
  ],
  ['% rateio', 'Percentual do pool de custos+despesas do segmento usado neste produto no cálculo'],
  [
    'Custo material (un.)',
    'Por 1 un. pronta = soma da composição (receita) ÷ rendimento. Não inclui custos nem despesas da aba Custos e Despesas',
  ],
  [
    'Custos gerais (un.)',
    'Produto acabado: rateio custos+despesas/un. Mercadoria: valor de compra/un. (original, sem markup/margem).',
  ],
];

const PrecificacaoRow = memo(function PrecificacaoRow({
  b,
  workspace,
  mode,
  fixedHeight,
}: {
  b: PricingBreakdown;
  workspace: PricingWorkspace;
  mode: PricingMode;
  fixedHeight?: boolean;
}) {
  const qtyDisplay = resolvePricingMonthlyQty(b, workspace);
  const monthlyTotalDisplay = resolvePricingMonthlyTotal(b, qtyDisplay);
  const costs = pricingCostColumnValues(b);
  const unitPriceDisplay = resolveDisplayedUnitPrice(b, qtyDisplay);
  const sellsBelowCost = unitPriceDisplay > 0 && unitPriceDisplay < b.totalUnitCost - 0.01;
  const priceFormulaBase = b.totalUnitCost;
  const stockForRow = workspace.stockItems.find((s) => s.id === b.productId);
  const qtyLikeYield = stockForRow ? monthlyQtyLooksLikeRecipeYield(stockForRow) : false;
  const recipeYieldForRow = stockForRow && stockForRow.useBom ? resolveRecipeBatchYield(stockForRow) : 0;
  const recipeMaterialTotal =
    b.bomDetail.length > 0 ? b.bomDetail.reduce((sum, row) => sum + row.cost, 0) : 0;
  const materialUnitTitle =
    b.category === 'mercadoria'
      ? 'Mercadoria revenda: custo de compra aparece em Custos gerais (un.)'
      : recipeMaterialTotal > 0 && recipeYieldForRow > 0
        ? `Receita (${recipeYieldForRow} un.): ${formatCurrency(recipeMaterialTotal)} ÷ ${recipeYieldForRow} = ${formatCurrency(costs.materialUnit ?? 0)}/un.`
        : 'Custo material por unidade pronta (composição ÷ rendimento)';
  const generalCostsTitle =
    b.category === 'mercadoria'
      ? costs.generalCostsUnit > 0
        ? `Valor de compra/un. ${formatCurrency(resolveMercadoriaPurchaseUnitCost(b))}${
            costs.generalCostsUnit > resolveMercadoriaPurchaseUnitCost(b) + 0.01
              ? ` + rateio ${formatCurrency(costs.generalCostsUnit - resolveMercadoriaPurchaseUnitCost(b))}/un.`
              : ''
          } → base antes do markup/margem`
        : 'Informe valor de compra (R$/un ou total) no cadastro da mercadoria'
      : `Rateio custos ${formatCurrency(costs.allocatedCostsUnit)}/un. + despesas ${formatCurrency(costs.allocatedExpensesUnit)}/un.${
          b.creditsRecovery > 0 ? ` − crédito ${formatCurrency(b.creditsRecovery)}/un.` : ''
        } → custo total/un. ${formatCurrency(b.totalUnitCost)}`;

  return (
    <tr
      className={cn(
        'technical-grid-row',
        sellsBelowCost && 'bg-red-50/90',
        qtyLikeYield && !sellsBelowCost && 'bg-amber-50/80',
        fixedHeight && 'h-10',
      )}
    >
      <td className="px-3 py-2 font-bold">{b.name || '—'}</td>
      <td className="px-3 py-2">{PRICING_SEGMENT_LABELS[b.category]}</td>
      <td
        className={cn('px-3 py-2 text-right', qtyLikeYield && 'text-amber-900 font-bold')}
        title={
          qtyLikeYield
            ? `Qtd/mês (${qtyDisplay}) igual ao rendimento da receita — informe vendas mensais (ex.: 100) no cadastro do produto para reduzir custos gerais/un.`
            : 'Quantidade de vendas no mês (rateio + venda total)'
        }
      >
        {qtyDisplay > 0 ? qtyDisplay : '—'}
        {qtyLikeYield ? ' ⚠' : ''}
      </td>
      <td className="px-3 py-2 text-right font-bold tabular-nums" title="Percentual do pool de custos+despesas do segmento aplicado a este produto">
        {formatAllocationSharePercent(b.allocationShare)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums font-bold text-brand-black" title={materialUnitTitle}>
        {formatPricingMaterialUnitCell(costs.materialUnit, { money: formatCurrency })}
      </td>
      <td
        className="px-3 py-2 text-right tabular-nums text-slate-600"
        title={generalCostsTitle}
      >
        {formatCurrency(costs.generalCostsUnit)}
      </td>
      {showMarkupColumn(mode) ? (
        <td className="px-3 py-2 text-right">{b.markupPercent.toFixed(1)}%</td>
      ) : null}
      {showMarginColumn(mode) ? (
        <td className="px-3 py-2 text-right">{b.marginPercent.toFixed(1)}%</td>
      ) : null}
      <td
        className={cn('px-3 py-2 text-right font-bold tabular-nums', sellsBelowCost && 'text-red-800')}
        title={
          sellsBelowCost
            ? `Prejuízo por unidade: preço ${formatCurrency(unitPriceDisplay)} < custo total ${formatCurrency(b.totalUnitCost)}. Aumente markup/margem ou o volume.`
            : b.mode === 'both'
              ? `${formatCurrency(priceFormulaBase)} × (1 + ${b.markupPercent}%) ÷ (1 − ${b.marginPercent}%) = ${formatCurrency(unitPriceDisplay)}`
              : b.mode === 'margin_only'
                ? `${formatCurrency(priceFormulaBase)} ÷ (1 − ${b.marginPercent}%)`
                : `${formatCurrency(priceFormulaBase)} × (1 + ${b.markupPercent}%)`
        }
      >
        {formatCurrency(unitPriceDisplay)}
      </td>
      <td
        className="px-3 py-2 text-right font-bold tabular-nums"
        title={
          monthlyTotalDisplay != null
            ? `${formatCurrency(unitPriceDisplay)} × ${qtyDisplay} un. = ${formatCurrency(monthlyTotalDisplay)}`
            : 'Informe Qtd/mês no cadastro do produto para calcular a venda total do mês'
        }
      >
        {monthlyTotalDisplay != null ? formatCurrency(monthlyTotalDisplay) : '—'}
      </td>
    </tr>
  );
});

function TableHead({ mode }: { mode: PricingMode }) {
  const extra: Array<[string, string | undefined]> = [];
  if (showMarkupColumn(mode)) extra.push(['Markup', 'Markup % nos parâmetros globais']);
  if (showMarginColumn(mode)) extra.push(['Margem', 'Margem de lucro % nos parâmetros globais']);
  extra.push([
    'Valor unitário (venda)',
    mode === 'both'
      ? 'Sobre custo total/un.: × (1 + markup%) ÷ (1 − margem%)'
      : mode === 'markup_only'
        ? 'Sobre custo total/un.: × (1 + markup%)'
        : 'Sobre custo total/un.: ÷ (1 − margem%)',
  ]);
  extra.push(['Venda total (mês)', 'Qtd/mês × valor unitário de venda']);

  return (
    <thead className="technical-grid-header sticky top-0 z-10">
      <tr>
        {[...HEADERS, ...extra].map(([h, title]) => (
          <th
            key={h}
            title={title}
            className="px-3 py-2 text-[9px] font-black uppercase border-r border-brand-border bg-brand-sidebar"
          >
            {h}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export default memo(function PricingPrecificacaoVirtualTable({
  rows,
  workspace,
  mode,
}: {
  rows: PricingBreakdown[];
  workspace: PricingWorkspace;
  mode: PricingMode;
}) {
  const colSpan = precificacaoTableColumnCount(mode);
  const resetKey = useMemo(
    () => `${rows.length}:${mode}:${rows[0]?.productId ?? ''}`,
    [rows, mode],
  );
  const virtual = useVirtualWindow(rows.length, { rowHeightPx: ROW_HEIGHT_PX, threshold: 50, resetKey });

  if (rows.length === 0) {
    return (
      <div className="module-table-viewport">
        <table className="w-full min-w-[1280px] text-left text-sm">
          <TableHead mode={mode} />
          <tbody>
            <tr>
              <td colSpan={colSpan} className="py-16 text-center text-slate-400 uppercase text-[10px]">
                Cadastre produtos no estoque e custos/despesas na aba Custos e Despesas (por segmento).
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  const visible = virtual.useVirtual ? rows.slice(virtual.startIndex, virtual.endIndex) : rows;

  const body = (
    <tbody className="font-mono text-[10px] divide-y divide-brand-border/10">
      {virtual.useVirtual && <VirtualSpacerRow colSpan={colSpan} height={virtual.paddingTop} />}
      {visible.map((b) => (
        <PrecificacaoRow
          key={b.productId}
          b={b}
          workspace={workspace}
          mode={mode}
          fixedHeight={virtual.useVirtual}
        />
      ))}
      {virtual.useVirtual && <VirtualSpacerRow colSpan={colSpan} height={virtual.paddingBottom} />}
    </tbody>
  );

  const table = (
    <table className="w-full min-w-[1280px] text-left text-sm">
      <TableHead mode={mode} />
      {body}
    </table>
  );

  if (!virtual.useVirtual) {
    return <div className="module-table-viewport">{table}</div>;
  }

  return (
    <div ref={virtual.scrollRef} className="module-table-viewport" onScroll={virtual.onScroll}>
      {table}
      <p className="text-[9px] p-2 border-t border-brand-border/30 text-slate-500 font-mono sticky bottom-0 bg-brand-bg/95">
        {rows.length.toLocaleString('pt-BR')} produto(s) · modo leve
      </p>
    </div>
  );
});
