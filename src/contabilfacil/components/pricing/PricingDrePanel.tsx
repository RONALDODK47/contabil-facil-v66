import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { cn, formatCurrency } from '../../lib/utils';
import { CF_LABEL, CF_SELECT_WIDE_RESPONSIVE } from '../../lib/formFieldClasses';
import { computePricingDre, type PricingDreScope } from '../../logic/pricingDre';
import type { PricingBreakdown, PricingWorkspace } from '../../logic/pricingTypes';
import { PRICING_SEGMENT_FILTERS, PRICING_SEGMENT_LABELS } from '../../logic/pricingTypes';

type PricingDrePanelProps = {
  breakdowns: PricingBreakdown[];
  workspace: PricingWorkspace;
  companyName: string;
  onExportPdf?: () => void;
};

function lineValueClass(kind: string, value: number): string {
  if (kind === 'total') return value >= 0 ? 'text-emerald-800' : 'text-red-800';
  if (kind === 'subtotal') return 'text-brand-border';
  if (kind === 'subtract') return 'text-red-600';
  if (kind === 'add') return 'text-blue-700';
  return '';
}

function linePrefix(kind: string, value: number): string {
  if (kind === 'subtract') return '−';
  if (kind === 'add' && value >= 0) return '+';
  if (kind === 'total' || kind === 'subtotal') return '=';
  return '';
}

function PricingDrePanelBody({
  breakdowns,
  workspace,
  onExportPdf,
}: Omit<PricingDrePanelProps, 'companyName'>) {
  const [scope, setScope] = useState<PricingDreScope>('geral');
  const [productId, setProductId] = useState('');

  const breakdownsInScope = useMemo(() => {
    if (scope === 'geral') return breakdowns;
    return breakdowns.filter((b) => b.category === scope);
  }, [breakdowns, scope]);

  useEffect(() => {
    if (scope === 'geral') {
      setProductId('');
      return;
    }
    setProductId((prev) => {
      if (prev && breakdownsInScope.some((b) => b.productId === prev)) return prev;
      return breakdownsInScope[0]?.productId ?? '';
    });
  }, [scope, breakdownsInScope]);

  const dre = useMemo(
    () => computePricingDre(breakdowns, workspace, scope, productId || undefined),
    [breakdowns, workspace, scope, productId],
  );

  const productSelectLabel =
    scope === 'produto_acabado'
      ? 'Produto acabado'
      : scope === 'mercadoria'
        ? 'Mercadoria'
        : scope === 'servico'
          ? 'Serviço'
          : '';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest">DRE — Demonstração do Resultado</p>
          <p className="text-[8px] font-bold uppercase opacity-45 mt-1 max-w-2xl">
            Projeção mensal com base na precificação, custos/despesas cadastrados e créditos do estoque.
            Custos e despesas seguem o segmento selecionado; receita e CMV seguem o item quando escolhido.
          </p>
        </div>
        {onExportPdf ? (
          <button
            type="button"
            onClick={onExportPdf}
            className="technical-button-primary text-[9px] py-1 px-3 flex items-center gap-1 shrink-0"
          >
            <Download size={12} /> PDF
          </button>
        ) : null}
      </div>

      <div className="cf-scroll-tabs flex flex-wrap gap-1 border border-brand-border p-1 bg-brand-sidebar/20">
        {(
          [{ id: 'geral' as PricingDreScope, label: 'Geral' }].concat(
            PRICING_SEGMENT_FILTERS.map((seg) => ({
              id: seg as PricingDreScope,
              label: PRICING_SEGMENT_LABELS[seg],
            })),
          )
        ).map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setScope(id)}
            className={cn(
              'px-3 py-1.5 text-[9px] font-black uppercase tracking-wide shrink-0',
              scope === id
                ? 'bg-brand-border text-brand-bg shadow-[2px_2px_0_0_rgba(0,0,0,0.15)]'
                : 'opacity-55 hover:opacity-100',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {scope !== 'geral' ? (
        <label className="flex flex-col sm:flex-row sm:items-center gap-2 max-w-md">
          <span className={CF_LABEL}>{productSelectLabel}</span>
          <select
            aria-label={`Filtrar DRE por ${productSelectLabel.toLowerCase()}`}
            className={CF_SELECT_WIDE_RESPONSIVE}
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            disabled={breakdownsInScope.length === 0}
          >
            <option value="">Todos do segmento</option>
            {breakdownsInScope.map((b) => (
              <option key={b.productId} value={b.productId}>
                {b.name?.trim() || 'Sem nome'}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="technical-panel p-4 shadow-[2px_2px_0_0_#141414]">
          <span className="text-[9px] font-black uppercase opacity-50 block mb-1">Receita bruta</span>
          <span className="text-lg font-black font-mono text-blue-700">
            {formatCurrency(dre.grossRevenue)}
          </span>
        </div>
        <div className="technical-panel p-4 shadow-[2px_2px_0_0_#141414]">
          <span className="text-[9px] font-black uppercase opacity-50 block mb-1">Lucro bruto</span>
          <span className="text-lg font-black font-mono">{formatCurrency(dre.grossProfit)}</span>
        </div>
        <div className="technical-panel p-4 shadow-[2px_2px_0_0_#141414]">
          <span className="text-[9px] font-black uppercase opacity-50 block mb-1">Margem líquida</span>
          <span
            className={cn(
              'text-lg font-black font-mono',
              dre.netMarginPct >= 0 ? 'text-emerald-700' : 'text-red-700',
            )}
          >
            {dre.netMarginPct.toFixed(1)}%
          </span>
        </div>
      </div>

      <div className="technical-panel shadow-[3px_3px_0_0_#141414] overflow-hidden">
        <div className="px-4 py-3 border-b border-brand-border bg-brand-sidebar/20 flex flex-wrap justify-between gap-2">
          <span className="text-[10px] font-black uppercase">
            DRE — {dre.scopeLabel}
            {dre.productName ? ` · ${dre.productName}` : ''}
          </span>
          <span className="text-[9px] font-mono opacity-50 uppercase">Projeção mensal</span>
        </div>
        <div className="divide-y divide-brand-border/10">
          {dre.lines.map((line) => (
            <div
              key={line.id}
              className={cn(
                'flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-[10px] font-mono',
                line.indent === 1 && 'pl-7',
                line.indent === 2 && 'pl-10',
                line.kind === 'total' && 'bg-brand-sidebar/15 font-black text-[11px] py-3',
                line.kind === 'subtotal' && 'font-bold bg-brand-sidebar/5',
              )}
            >
              <span className="uppercase tracking-wide opacity-90 min-w-0 flex-1">{line.label}</span>
              <span className={cn('font-bold tabular-nums shrink-0', lineValueClass(line.kind, line.value))}>
                {line.kind === 'subtract' ? '−' : ''}
                {line.kind !== 'subtract' && linePrefix(line.kind, line.value) ? `${linePrefix(line.kind, line.value)} ` : ''}
                {formatCurrency(Math.abs(line.value))}
              </span>
            </div>
          ))}
        </div>
        <div className="px-4 py-3 border-t border-brand-border/20 bg-brand-sidebar/10 text-[9px] font-mono opacity-60">
          Lucro projetado na tabela de precificação (referência):{' '}
          <span className="font-bold">{formatCurrency(dre.pricingProfitTotal)}</span>
        </div>
      </div>
    </div>
  );
}

const PricingDrePanelLazy = lazy(async () => ({
  default: PricingDrePanelBody,
}));

export default function PricingDrePanel(props: PricingDrePanelProps) {
  return (
    <Suspense
      fallback={
        <p className="text-[10px] uppercase text-slate-400 font-bold py-8 text-center">
          Carregando DRE…
        </p>
      }
    >
      <PricingDrePanelLazy {...props} />
    </Suspense>
  );
}
