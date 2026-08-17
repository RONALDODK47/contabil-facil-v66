import { memo, useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import { cn, formatDate } from '../lib/utils';
import { formatExtratoValorAssinadoPt } from '../../extratoVision/utils/extratoMoneyParse';
import { useVirtualWindow, VirtualSpacerRow } from '../lib/useVirtualWindow';
import {
  buildPlanoNomeLookup,
  resolveContaNome,
  type ExtratoPlanoContaOption,
} from './ExtratoContaPicker';
import { resolveExtratoRowContas } from '../logic/extratoConciliacaoBank';

const COL_SPAN = 9;
const DESC_CLS =
  'px-2 py-3 border-r border-brand-border/10 text-[9px] uppercase whitespace-normal break-words min-w-[100px] max-w-[200px] align-top leading-snug text-slate-600';
const ROW_HEIGHT_PX = 52;
const EMPTY_PLANO_LOOKUP = new Map<string, string>();

export interface ExtratoLancamentoRow {
  id: string;
  date: string;
  description: string;
  value: number;
  nature: 'D' | 'C';
  accountCode: string;
  accountDebit?: string;
  accountCredit?: string;
  operationName?: string;
}

export type { ExtratoPlanoContaOption };

const ExtratoLancamentoTableRow = memo(function ExtratoLancamentoTableRow({
  item,
  onDelete,
  planoParaNome = [],
  planoNomeLookup = EMPTY_PLANO_LOOKUP,
  fixedHeight,
}: {
  item: ExtratoLancamentoRow;
  onDelete: (id: string) => void;
  planoParaNome?: ExtratoPlanoContaOption[];
  planoNomeLookup?: Map<string, string>;
  fixedHeight?: boolean;
}) {
  const { accountDebit: debValue, accountCredit: credValue } = resolveExtratoRowContas(item);
  const debNome = resolveContaNome(planoNomeLookup, debValue, planoParaNome);
  const credNome = resolveContaNome(planoNomeLookup, credValue, planoParaNome);
  const debTitle = debNome || (debValue ? `Conta ${debValue} — verifique o plano de contas` : undefined);
  const credTitle = credNome || (credValue ? `Conta ${credValue} — verifique o plano de contas` : undefined);
  return (
    <tr className={cn('technical-grid-row', fixedHeight && 'min-h-[52px]')}>
      <td className="px-4 py-3 border-r border-brand-border/10 whitespace-nowrap">{formatDate(item.date)}</td>
      <td className="px-4 py-3 border-r border-brand-border/10 font-bold italic uppercase tracking-tighter whitespace-normal break-words min-w-[180px] max-w-[480px] align-top leading-snug">
        {item.description}
      </td>
      <td
        className={cn(
          'px-4 py-3 border-r border-brand-border/10 text-right font-bold italic tabular-nums',
          item.nature === 'D' ? 'text-red-700' : 'text-green-700',
        )}
      >
        {formatExtratoValorAssinadoPt(item.value, item.nature)}
      </td>
      <td className="px-4 py-3 border-r border-brand-border/10 text-center font-black">{item.nature}</td>
      <td className="px-2 py-3 border-r border-brand-border/10 min-w-[96px]">
        <span
          className="block w-full min-w-0 h-[26px] bg-brand-sidebar/30 px-2 py-0.5 border border-brand-border/40 text-[10px] font-bold font-mono text-slate-700"
          title={debTitle}
        >
          {debValue || '—'}
        </span>
      </td>
      <td className={DESC_CLS} title={debTitle}>
        {debNome || (debValue ? `Cód. ${debValue}` : '—')}
      </td>
      <td className="px-2 py-3 border-r border-brand-border/10 min-w-[96px]">
        <span
          className="block w-full min-w-0 h-[26px] bg-brand-sidebar/30 px-2 py-0.5 border border-brand-border/40 text-[10px] font-bold font-mono text-slate-700"
          title={credTitle}
        >
          {credValue || '—'}
        </span>
      </td>
      <td className={DESC_CLS} title={credTitle}>
        {credNome || (credValue ? `Cód. ${credValue}` : '—')}
      </td>
      <td className="px-4 py-3 text-right">
        <button
          type="button"
          onClick={() => onDelete(item.id)}
          className="text-red-600 hover:text-red-800 p-1"
          aria-label={`Excluir lançamento ${item.description}`}
          title="Excluir lançamento"
        >
          <Trash2 size={12} aria-hidden="true" />
        </button>
      </td>
    </tr>
  );
});

function TableHead() {
  return (
    <thead className="technical-grid-header sticky top-0 z-10">
      <tr>
        <th className="px-4 py-3 border-r border-brand-border bg-brand-sidebar">Data</th>
        <th className="px-4 py-3 border-r border-brand-border bg-brand-sidebar">Histórico</th>
        <th className="px-4 py-3 border-r border-brand-border text-right bg-brand-sidebar">Valor</th>
        <th className="px-4 py-3 border-r border-brand-border text-center w-16 bg-brand-sidebar">Tipo</th>
        <th className="px-2 py-3 border-r border-brand-border bg-brand-sidebar">Conta débito</th>
        <th className="px-2 py-3 border-r border-brand-border bg-brand-sidebar">Desc. débito</th>
        <th className="px-2 py-3 border-r border-brand-border bg-brand-sidebar">Conta crédito</th>
        <th className="px-2 py-3 border-r border-brand-border bg-brand-sidebar">Desc. crédito</th>
        <th className="px-4 py-3 text-right w-16 bg-brand-sidebar">Ação</th>
      </tr>
    </thead>
  );
}

interface ExtratoLancamentosVirtualTableProps {
  rows: ExtratoLancamentoRow[];
  onDelete: (id: string) => void;
  /** Plano completo para resolver nomes (Desc. débito/crédito). */
  planoNomeOptions?: ExtratoPlanoContaOption[];
}

export default memo(function ExtratoLancamentosVirtualTable({
  rows,
  onDelete,
  planoNomeOptions,
}: ExtratoLancamentosVirtualTableProps) {
  const planoParaNome = useMemo(() => planoNomeOptions ?? [], [planoNomeOptions]);
  const planoNomeLookup = useMemo(
    () => buildPlanoNomeLookup(planoParaNome),
    [planoParaNome],
  );
  const resetKey = useMemo(() => `${rows.length}:${rows[0]?.id ?? ''}`, [rows]);
  const virtual = useVirtualWindow(rows.length, { rowHeightPx: ROW_HEIGHT_PX, resetKey });

  if (rows.length === 0) {
    return (
      <div className="module-table-viewport">
        <table className="w-full min-w-[1180px] text-left text-sm border-collapse">
          <TableHead />
          <tbody>
            <tr>
              <td colSpan={COL_SPAN} className="py-20 text-center font-bold text-slate-400 uppercase tracking-widest text-[10px]">
                Base de Extrato Vazia. Adicione manualmente ou carregue o modelo para conciliar.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  const visibleRows = virtual.useVirtual ? rows.slice(virtual.startIndex, virtual.endIndex) : rows;

  const body = (
    <tbody className="font-mono text-[11px] divide-y divide-brand-border/10">
      {virtual.useVirtual && <VirtualSpacerRow colSpan={COL_SPAN} height={virtual.paddingTop} />}
      {visibleRows.map((item) => (
          <ExtratoLancamentoTableRow
            key={item.id}
            item={item}
            onDelete={onDelete}
            planoParaNome={planoParaNome}
            planoNomeLookup={planoNomeLookup}
            fixedHeight={virtual.useVirtual}
          />
      ))}
      {virtual.useVirtual && <VirtualSpacerRow colSpan={COL_SPAN} height={virtual.paddingBottom} />}
    </tbody>
  );

  if (!virtual.useVirtual) {
    return (
      <div className="module-table-viewport">
        <table className="w-full min-w-[1180px] text-left text-sm border-collapse">
          <TableHead />
          {body}
        </table>
      </div>
    );
  }

  return (
    <div ref={virtual.scrollRef} className="module-table-viewport" onScroll={virtual.onScroll}>
      <table className="w-full min-w-[1180px] text-left text-sm border-collapse">
        <TableHead />
        {body}
      </table>
      <p className="text-[9px] p-2 border-t border-brand-border/30 text-slate-500 font-mono sticky bottom-0 bg-brand-bg/95">
        {rows.length.toLocaleString('pt-BR')} lançamento(s) · modo leve
      </p>
    </div>
  );
});
