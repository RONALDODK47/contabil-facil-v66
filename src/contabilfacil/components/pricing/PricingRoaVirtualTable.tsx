import { memo, useMemo } from 'react';
import { cn, formatCurrency } from '../../lib/utils';
import { useVirtualWindow, VirtualSpacerRow } from '../../lib/useVirtualWindow';
import type { PricingBreakdown } from '../../logic/pricingTypes';
import { PRICING_SEGMENT_LABELS } from '../../logic/pricingTypes';

const COL_SPAN = 8;
const ROW_HEIGHT_PX = 36;

const RoaRow = memo(function RoaRow({
  b,
  rank,
  fixedHeight,
}: {
  b: PricingBreakdown;
  rank: number;
  fixedHeight?: boolean;
}) {
  return (
    <tr className={cn('technical-grid-row', rank === 1 && b.roaPct < 10 && 'bg-red-50/50', fixedHeight && 'h-9')}>
      <td className="px-3 py-2">{rank}</td>
      <td className="px-3 py-2 font-bold">{b.name}</td>
      <td className="px-3 py-2">{PRICING_SEGMENT_LABELS[b.category]}</td>
      <td className="px-3 py-2 text-right">{formatCurrency(b.totalUnitCost)}</td>
      <td className="px-3 py-2 text-right">{formatCurrency(b.finalPrice)}</td>
      <td className="px-3 py-2 text-right">{formatCurrency(b.profitPerUnit)}</td>
      <td className={cn('px-3 py-2 text-right font-bold', b.roaPct < 15 ? 'text-red-700' : 'text-emerald-700')}>
        {b.roaPct.toFixed(1)}%
      </td>
      <td className="px-3 py-2 text-right">{formatCurrency(b.monthlyRevenue)}</td>
    </tr>
  );
});

function TableHead() {
  return (
    <thead className="technical-grid-header sticky top-0 z-10">
      <tr>
        {['#', 'Produto', 'Segmento', 'Custo', 'Preço', 'Lucro/un', 'ROA %', 'Receita/mês'].map((h) => (
          <th key={h} className="px-3 py-2 text-[9px] font-black uppercase border-r border-brand-border bg-brand-sidebar">
            {h}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export default memo(function PricingRoaVirtualTable({ rows }: { rows: PricingBreakdown[] }) {
  const resetKey = useMemo(() => `${rows.length}:${rows[0]?.productId ?? ''}`, [rows]);
  const virtual = useVirtualWindow(rows.length, { rowHeightPx: ROW_HEIGHT_PX, threshold: 50, resetKey });

  const visible = virtual.useVirtual ? rows.slice(virtual.startIndex, virtual.endIndex) : rows;

  const body = (
    <tbody className="font-mono text-[10px] divide-y divide-brand-border/10">
      {virtual.useVirtual && <VirtualSpacerRow colSpan={COL_SPAN} height={virtual.paddingTop} />}
      {visible.map((b, i) => {
        const index = virtual.useVirtual ? virtual.startIndex + i : i;
        return <RoaRow key={b.productId} b={b} rank={index + 1} fixedHeight={virtual.useVirtual} />;
      })}
      {virtual.useVirtual && <VirtualSpacerRow colSpan={COL_SPAN} height={virtual.paddingBottom} />}
    </tbody>
  );

  const table = (
    <table className="w-full text-left">
      <TableHead />
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
