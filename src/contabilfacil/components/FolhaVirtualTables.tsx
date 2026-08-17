import { memo, useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import { cn, formatCurrency, formatDate } from '../lib/utils';
import { useVirtualWindow, VirtualSpacerRow } from '../lib/useVirtualWindow';
import { normalizeExtratoMatchText } from '../logic/extratoRegrasContasStorage';
import type { FolhaRegra } from '../logic/folhaContasAutomacaoStorage';

const REL_COL_SPAN = 7;
const PAYROLL_COL_SPAN = 7;
const ROW_HEIGHT_PX = 40;

export interface FolhaRelatorioRow {
  id: string;
  date: string;
  description: string;
  debito: number;
  credito: number;
  tipo?: 'PROVENTOS' | 'DESCONTOS' | 'INFORMATIVA';
}

const TIPO_LABEL: Record<string, string> = {
  PROVENTOS: 'Provento',
  DESCONTOS: 'Desconto',
  INFORMATIVA: 'Informativo',
};

const TIPO_CLS: Record<string, string> = {
  PROVENTOS: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  DESCONTOS: 'border-red-300 bg-red-50 text-red-700',
  INFORMATIVA: 'border-blue-300 bg-blue-50 text-blue-700',
};

export interface FolhaPayrollRow {
  id: string;
  name: string;
  baseSalary: number;
  inss: number;
  fgts: number;
  irrf: number;
  net: number;
}

function findMatchingRegra(description: string, regras: FolhaRegra[]): FolhaRegra | undefined {
  const descNorm = normalizeExtratoMatchText(description);
  return regras.find((r) => {
    const rNorm = normalizeExtratoMatchText(r.descricao);
    return rNorm && descNorm.includes(rNorm);
  });
}

const RelatorioRow = memo(function RelatorioRow({
  row,
  regras,
  onDelete,
  fixedHeight,
}: {
  row: FolhaRelatorioRow;
  regras: FolhaRegra[];
  onDelete: (id: string) => void;
  fixedHeight?: boolean;
}) {
  const tipoKey = row.tipo ?? '';
  const tipoLabel = TIPO_LABEL[tipoKey] ?? '—';
  const tipoCls = TIPO_CLS[tipoKey] ?? 'border-brand-border/40 bg-brand-sidebar/30 text-brand-text/50';
  const valor = row.debito > 0 ? row.debito : row.credito;
  const valorCls = row.debito > 0 ? 'text-red-600' : 'text-emerald-700';
  const regra = findMatchingRegra(row.description, regras);
  return (
    <tr className={cn('technical-grid-row', fixedHeight && 'h-10 max-h-10')}>
      <td className="px-4 py-3 border-r border-brand-border/10 whitespace-nowrap">{formatDate(row.date)}</td>
      <td className="px-4 py-3 border-r border-brand-border/10 uppercase italic font-bold truncate max-w-[240px]" title={row.description}>
        {row.description}
      </td>
      <td className="px-4 py-3 border-r border-brand-border/10 text-center">
        <span className={cn('inline-block text-[8px] font-black uppercase px-1.5 py-0.5 border', tipoCls)}>
          {tipoLabel}
        </span>
      </td>
      <td className={cn('px-4 py-3 border-r border-brand-border/10 text-right font-bold', valorCls)}>
        {formatCurrency(valor)}
      </td>
      <td className="px-4 py-3 border-r border-brand-border/10 text-right font-mono text-[10px] text-rose-700">
        {regra ? regra.contaDebito : <span className="text-brand-text/30">—</span>}
      </td>
      <td className="px-4 py-3 border-r border-brand-border/10 text-right font-mono text-[10px] text-emerald-700">
        {regra ? regra.contaCredito : <span className="text-brand-text/30">—</span>}
      </td>
      <td className="px-4 py-3 text-center">
        <button
          type="button"
          onClick={() => onDelete(row.id)}
          className="text-red-600 hover:text-red-800"
          aria-label="Excluir lançamento"
          title="Excluir lançamento"
        >
          <Trash2 size={12} />
        </button>
      </td>
    </tr>
  );
});

export const FolhaRelatorioVirtualTable = memo(function FolhaRelatorioVirtualTable({
  rows,
  regras = [],
  onDelete,
}: {
  rows: FolhaRelatorioRow[];
  regras?: FolhaRegra[];
  onDelete: (id: string) => void;
}) {
  const resetKey = useMemo(() => `${rows.length}:${rows[0]?.id ?? ''}`, [rows]);
  const virtual = useVirtualWindow(rows.length, { rowHeightPx: ROW_HEIGHT_PX, resetKey });

  const head = (
    <thead className="technical-grid-header sticky top-0 z-10">
      <tr>
        <th className="px-4 py-3 border-r border-brand-border bg-brand-sidebar">Data</th>
        <th className="px-4 py-3 border-r border-brand-border bg-brand-sidebar">Descrição</th>
        <th className="px-4 py-3 border-r border-brand-border text-center bg-brand-sidebar">Tipo</th>
        <th className="px-4 py-3 border-r border-brand-border text-right bg-brand-sidebar">Valor</th>
        <th className="px-4 py-3 border-r border-brand-border text-right bg-brand-sidebar">
          <span className="text-rose-700">Déb.</span> Conta
        </th>
        <th className="px-4 py-3 border-r border-brand-border text-right bg-brand-sidebar">
          <span className="text-emerald-700">Créd.</span> Conta
        </th>
        <th className="px-4 py-3 text-center bg-brand-sidebar">Excluir</th>
      </tr>
    </thead>
  );

  if (rows.length === 0) {
    return (
      <div className="module-table-viewport">
        <table className="w-full min-w-[780px] text-left text-sm border-collapse">
          {head}
          <tbody>
            <tr>
              <td colSpan={REL_COL_SPAN} className="py-12 text-center font-bold text-slate-400 uppercase tracking-widest text-[10px]">
                Sem lançamentos importados. Use OCR/PDF na coluna ao lado.
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
      {virtual.useVirtual && <VirtualSpacerRow colSpan={REL_COL_SPAN} height={virtual.paddingTop} />}
      {visibleRows.map((row, i) => {
        const index = virtual.useVirtual ? virtual.startIndex + i : i;
        return <RelatorioRow key={row.id || `rel-${index}`} row={row} regras={regras} onDelete={onDelete} fixedHeight={virtual.useVirtual} />;
      })}
      {virtual.useVirtual && <VirtualSpacerRow colSpan={REL_COL_SPAN} height={virtual.paddingBottom} />}
    </tbody>
  );

  if (!virtual.useVirtual) {
    return (
      <div className="module-table-viewport">
        <table className="w-full min-w-[780px] text-left text-sm border-collapse">
          {head}
          {body}
        </table>
      </div>
    );
  }

  return (
    <div ref={virtual.scrollRef} className="module-table-viewport" onScroll={virtual.onScroll}>
      <table className="w-full min-w-[780px] text-left text-sm border-collapse">
        {head}
        {body}
      </table>
    </div>
  );
});

const PayrollRow = memo(function PayrollRow({
  row,
  onDelete,
  fixedHeight,
}: {
  row: FolhaPayrollRow;
  onDelete: (id: string) => void;
  fixedHeight?: boolean;
}) {
  return (
    <tr className={cn('technical-grid-row', fixedHeight && 'h-10 max-h-10')}>
      <td className="px-6 py-3 border-r border-brand-border/10 font-bold uppercase italic truncate max-w-[200px]" title={row.name}>
        {row.name}
      </td>
      <td className="px-6 py-3 border-r border-brand-border/10 text-right">{formatCurrency(row.baseSalary)}</td>
      <td className="px-6 py-3 border-r border-brand-border/10 text-right text-red-655 italic">-{formatCurrency(row.inss)}</td>
      <td className="px-6 py-3 border-r border-brand-border/10 text-right text-red-655 italic">-{formatCurrency(row.irrf)}</td>
      <td className="px-6 py-3 border-r border-brand-border/10 text-right text-blue-600">{formatCurrency(row.fgts)}</td>
      <td className="px-6 py-3 border-r border-brand-border/10 text-right text-green-700 font-bold">{formatCurrency(row.net)}</td>
      <td className="px-6 py-3 text-center">
        <button type="button" onClick={() => onDelete(row.id)} className="text-red-600 hover:text-red-800">
          <Trash2 size={12} />
        </button>
      </td>
    </tr>
  );
});

function PayrollTotalsRow({ totals }: { totals: { base: number; inss: number; irrf: number; fgts: number; net: number } }) {
  return (
    <tr className="bg-brand-sidebar/20 font-bold">
      <td className="px-6 py-3 border-r border-brand-border/10 uppercase">Gasto Total Provisionado</td>
      <td className="px-6 py-3 border-r border-brand-border/10 text-right">{formatCurrency(totals.base)}</td>
      <td className="px-6 py-3 border-r border-brand-border/10 text-right text-red-600">-{formatCurrency(totals.inss)}</td>
      <td className="px-6 py-3 border-r border-brand-border/10 text-right text-red-600">-{formatCurrency(totals.irrf)}</td>
      <td className="px-6 py-3 border-r border-brand-border/10 text-right text-blue-600">{formatCurrency(totals.fgts)}</td>
      <td className="px-6 py-3 border-r border-brand-border/10 text-right text-green-755">{formatCurrency(totals.net)}</td>
      <td />
    </tr>
  );
}

export const FolhaPayrollVirtualTable = memo(function FolhaPayrollVirtualTable({
  rows,
  onDelete,
}: {
  rows: FolhaPayrollRow[];
  onDelete: (id: string) => void;
}) {
  const resetKey = useMemo(() => `${rows.length}:${rows[0]?.id ?? ''}`, [rows]);
  const virtual = useVirtualWindow(rows.length, { rowHeightPx: ROW_HEIGHT_PX, resetKey });

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          base: acc.base + r.baseSalary,
          inss: acc.inss + r.inss,
          irrf: acc.irrf + r.irrf,
          fgts: acc.fgts + r.fgts,
          net: acc.net + r.net,
        }),
        { base: 0, inss: 0, irrf: 0, fgts: 0, net: 0 },
      ),
    [rows],
  );

  const head = (
    <thead className="technical-grid-header sticky top-0 z-10">
      <tr>
        <th className="px-6 py-3 border-r border-brand-border bg-brand-sidebar">Colaborador</th>
        <th className="px-6 py-3 border-r border-brand-border text-right bg-brand-sidebar">Salário Nominal</th>
        <th className="px-6 py-3 border-r border-brand-border text-right bg-brand-sidebar">Dedução INSS</th>
        <th className="px-6 py-3 border-r border-brand-border text-right bg-brand-sidebar">Imposto de Renda RF</th>
        <th className="px-6 py-3 border-r border-brand-border text-right bg-brand-sidebar">Provisão FGTS (8%)</th>
        <th className="px-6 py-3 text-right bg-brand-sidebar">SALDO LÍQUIDO</th>
        <th className="px-6 py-3 text-center bg-brand-sidebar">Deletar</th>
      </tr>
    </thead>
  );

  if (rows.length === 0) {
    return (
      <div className="module-table-viewport">
        <table className="w-full min-w-[980px] text-left text-sm border-collapse">
          {head}
          <tbody>
            <tr>
              <td colSpan={PAYROLL_COL_SPAN} className="py-20 text-center font-bold text-slate-400 uppercase tracking-widest text-[10px]">
                Sem funcionários na folha gerencial atualmente.
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
      {virtual.useVirtual && <VirtualSpacerRow colSpan={PAYROLL_COL_SPAN} height={virtual.paddingTop} />}
      {visibleRows.map((row, i) => {
        const index = virtual.useVirtual ? virtual.startIndex + i : i;
        return (
          <PayrollRow key={row.id || `pay-${index}`} row={row} onDelete={onDelete} fixedHeight={virtual.useVirtual} />
        );
      })}
      {virtual.useVirtual && <VirtualSpacerRow colSpan={PAYROLL_COL_SPAN} height={virtual.paddingBottom} />}
      {!virtual.useVirtual && <PayrollTotalsRow totals={totals} />}
    </tbody>
  );

  if (!virtual.useVirtual) {
    return (
      <div className="module-table-viewport">
        <table className="w-full min-w-[980px] text-left text-sm border-collapse">
          {head}
          {body}
        </table>
      </div>
    );
  }

  return (
    <div>
      <div ref={virtual.scrollRef} className="module-table-viewport" onScroll={virtual.onScroll}>
        <table className="w-full min-w-[980px] text-left text-sm border-collapse">
          {head}
          {body}
        </table>
      </div>
      <table className="w-full min-w-[980px] text-left text-sm border-collapse border-t border-brand-border/30">
        <tbody className="font-mono text-[11px]">
          <PayrollTotalsRow totals={totals} />
        </tbody>
      </table>
    </div>
  );
});
