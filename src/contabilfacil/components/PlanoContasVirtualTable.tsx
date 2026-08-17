import { memo, useMemo, useState as import_react_useState, type ReactNode, type RefObject, type UIEventHandler } from 'react';
import { PlanoContaEditModal } from './PlanoContaEditModal';
import { Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  DEFAULT_ROW_HEIGHT_PX,
  useVirtualWindow,
  VirtualSpacerRow,
} from '../lib/useVirtualWindow';
import {
  planoNivelCodeClass,
  planoNivelDescClass,
  planoNivelIndentClass,
} from '../logic/planoContasMapper';

export const PLANO_CONTAS_TABLE_COLS = 6;

export interface PlanoContaRow {
  code: string;
  name: string;
  codigoReduzido?: string;
  tipo?: 'S' | 'A';
  nivel?: number;
}

interface PlanoContasVirtualTableProps {
  rows: PlanoContaRow[];
  codeLengthToLevel: (code: string) => number;
  onDelete: (code: string) => void;
  onEdit?: (oldCode: string, updates: Partial<PlanoContaRow>) => void;
}

const TH =
  'px-3 py-3 border-r border-brand-border bg-brand-sidebar text-[10px] font-bold uppercase tracking-wide whitespace-nowrap';

function PlanoTableColGroup() {
  return (
    <colgroup>
      <col className="w-[7.5rem]" />
      <col className="w-[11rem]" />
      <col />
      <col className="w-[4.5rem]" />
      <col className="w-[4.5rem]" />
      <col className="w-[6.5rem]" />
    </colgroup>
  );
}

const PlanoRow = memo(function PlanoRow({
  acc,
  codeLengthToLevel,
  onDelete,
  onEditClick,
}: {
  acc: PlanoContaRow;
  codeLengthToLevel: (code: string) => number;
  onDelete: (code: string) => void;
  onEditClick: (acc: PlanoContaRow) => void;
}) {
  const nivel = acc.nivel ?? codeLengthToLevel(acc.code);
  const sintetica = acc.tipo === 'S';

  return (
    <tr
      className={cn('technical-grid-row group cursor-pointer', sintetica && 'bg-amber-50/50')}
      onClick={() => onEditClick(acc)}
    >
      <td className="px-3 py-2 border-r border-brand-border/10 text-center text-[10px] text-slate-500 group-hover:text-white whitespace-nowrap">
        {acc.codigoReduzido?.trim() ? acc.codigoReduzido : '—'}
      </td>
      <td
        className={cn(
          'px-3 py-2 border-r border-brand-border/10 whitespace-nowrap group-hover:text-white',
          planoNivelIndentClass(nivel),
          planoNivelCodeClass(nivel, acc.tipo),
        )}
      >
        {acc.code}
      </td>
      <td
        className={cn(
          'px-3 py-2 border-r border-brand-border/10 italic text-brand-text group-hover:text-white whitespace-normal break-words align-top',
          planoNivelIndentClass(nivel),
          planoNivelDescClass(nivel, acc.tipo),
        )}
      >
        {acc.name}
      </td>
      <td className="px-3 py-2 border-r border-brand-border/10 text-center">
        {acc.tipo === 'S' ? (
          <span className="px-1.5 py-0.5 text-[8px] font-black bg-amber-100 text-amber-800 border border-amber-300">
            S
          </span>
        ) : acc.tipo === 'A' ? (
          <span className="px-1.5 py-0.5 text-[8px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300">
            A
          </span>
        ) : (
          <span className="text-[10px] text-slate-400 group-hover:text-white/70">—</span>
        )}
      </td>
      <td className="px-3 py-2 border-r border-brand-border/10 text-center text-[10px] text-slate-500 group-hover:text-white">
        {nivel ?? '—'}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEditClick(acc);
          }}
          className="text-brand-primary hover:text-brand-primary/80 group-hover:text-white p-1 mr-1"
          aria-label={`Editar conta ${acc.code}`}
        >
          <span className="text-[10px] font-bold uppercase underline">Editar</span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(acc.code);
          }}
          className="text-red-600 hover:text-red-800 group-hover:text-red-300 p-1"
          aria-label={`Excluir conta ${acc.code}`}
        >
          <Trash2 size={12} />
        </button>
      </td>
    </tr>
  );
});

function TableHead() {
  return (
    <thead className="technical-grid-header sticky top-0 z-10">
      <tr>
        <th className={cn(TH, 'w-[7.5rem] text-center')}>Código Reduzido</th>
        <th className={cn(TH, 'w-[11rem]')}>Código de Classificação</th>
        <th className={TH}>Descrição</th>
        <th className={cn(TH, 'w-[4.5rem] text-center')}>Tipo</th>
        <th className={cn(TH, 'w-[4.5rem] text-center')}>Nível</th>
        <th className={cn(TH, 'w-[4.5rem] text-right border-r-0')}>Ação</th>
      </tr>
    </thead>
  );
}

function PlanoTableShell({
  children,
  footer,
  scrollRef,
  onScroll,
}: {
  children: ReactNode;
  footer?: ReactNode;
  scrollRef?: RefObject<HTMLDivElement | null>;
  onScroll?: UIEventHandler<HTMLDivElement>;
}) {
  return (
    <div ref={scrollRef} className="module-table-viewport" onScroll={onScroll}>
      <table className="w-full min-w-[920px] table-fixed text-left text-sm border-collapse">
        <PlanoTableColGroup />
        <TableHead />
        {children}
      </table>
      {footer}
    </div>
  );
}

export default memo(function PlanoContasVirtualTable({
  rows,
  codeLengthToLevel,
  onDelete,
  onEdit,
}: PlanoContasVirtualTableProps) {
  const resetKey = useMemo(() => `${rows.length}:${rows[0]?.code ?? ''}`, [rows]);
  const [editingAccount, setEditingAccount] = import_react_useState<PlanoContaRow | null>(null);
  const virtual = useVirtualWindow(rows.length, {
    rowHeightPx: DEFAULT_ROW_HEIGHT_PX,
    resetKey,
  });

  if (rows.length === 0) {
    return (
      <PlanoTableShell>
        <tbody>
          <tr>
            <td
              colSpan={PLANO_CONTAS_TABLE_COLS}

              className="py-20 text-center font-bold text-slate-400 uppercase tracking-widest text-[10px] leading-relaxed px-6"
            >
              Sem Plano Carregado. Adicione ou importe o plano de contas para habilitar as demais telas do
              Extrato Vision.
            </td>
          </tr>
        </tbody>
      </PlanoTableShell>
    );
  }

  const visibleRows = virtual.useVirtual
    ? rows.slice(virtual.startIndex, virtual.endIndex)
    : rows;

  const body = (
    <tbody className="font-mono text-[11px] divide-y divide-brand-border/10">
      {virtual.useVirtual && (
        <VirtualSpacerRow colSpan={PLANO_CONTAS_TABLE_COLS} height={virtual.paddingTop} />
      )}
      {visibleRows.map((acc, i) => {
        const index = virtual.useVirtual ? virtual.startIndex + i : i;
        return (
          <PlanoRow
            key={`${acc.code}-${index}`}
            acc={acc}
            codeLengthToLevel={codeLengthToLevel}
            onDelete={onDelete}
            onEditClick={setEditingAccount}
          />
        );
      })}
      {virtual.useVirtual && (
        <VirtualSpacerRow colSpan={PLANO_CONTAS_TABLE_COLS} height={virtual.paddingBottom} />
      )}
    </tbody>
  );

  const footer = (
    <p className="text-[9px] p-2 border-t border-brand-border/30 text-slate-500 font-mono sticky bottom-0 bg-brand-bg/95">
      {rows.length.toLocaleString('pt-BR')} conta(s)
      {virtual.useVirtual ? ' · renderizando janela visível (modo leve)' : ''}
    </p>
  );

  if (!virtual.useVirtual) {
    return (
      <>
        <PlanoTableShell footer={footer}>{body}</PlanoTableShell>
        {editingAccount && onEdit && (
          <PlanoContaEditModal
            acc={editingAccount}
            onSave={onEdit}
            onClose={() => setEditingAccount(null)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <PlanoTableShell scrollRef={virtual.scrollRef} onScroll={virtual.onScroll} footer={footer}>
        {body}
      </PlanoTableShell>
      {editingAccount && onEdit && (
        <PlanoContaEditModal
          acc={editingAccount}
          onSave={onEdit}
          onClose={() => setEditingAccount(null)}
        />
      )}
    </>
  );
});
