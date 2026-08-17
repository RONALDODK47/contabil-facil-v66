import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format, isValid } from 'date-fns';
import type { LoanRow } from '../../lib/loanCalculator';
import { VirtualSpacerRow } from '../lib/useVirtualWindow';
import { cn, formatCurrency } from '../lib/utils';


const ROW_HEIGHT_PX = 36;
const OVERSCAN = 12;
/** Abaixo deste limite renderiza todas as linhas (evita bugs de virtualização em contratos curtos). */
const VIRTUAL_THRESHOLD = 80;

export interface ScheduleColumn {
  key: string;
  label: string;
  align: 'center' | 'right';
}

interface OcorrenciaHandlers {
  onTogglePaid?: (month: number) => void;
  onToggleUnpaid?: (month: number) => void;
  onSetInterestAdjustment?: (month: number, amount: number) => void;
  onSetPrepayment?: (month: number, amount: number) => void;
}

interface LoanScheduleVirtualTableProps extends OcorrenciaHandlers {
  rows: LoanRow[];
  columns: ScheduleColumn[];
  emptyMessage?: string;
  /** paid = parcela com juros na carência; capitalized = parcela e parcela líq. vazias. */
  graceType?: 'capitalized' | 'paid';
  onUpdatePaymentAmount?: (month: number, amount: number) => void;
}

function formatRowDate(date: Date): string {
  return isValid(date) ? format(date, 'dd/MM/yyyy') : '—';
}

function hasMoney(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) >= 0.005;
}

/**
 * Parcela = fluxo de caixa pago.
 * Carência capitalizada: sem parcela (juros só na coluna Juros / saldo).
 * Carência paga: parcela = juros + custo operacional.
 * Considera ajustes de juros: positivo soma, negativo subtrai.
 */
function displayInstallment(row: LoanRow, graceType: 'capitalized' | 'paid'): number {
  // row.interest já inclui o ajuste de juros do mês (positivo ou negativo).
  const adjustedInterest = row.interest ?? 0;
  
  if (row.isGrace) {
    if (graceType === 'paid') {
      if (hasMoney(row.installment)) return row.installment;
      const composite = adjustedInterest + row.monthlyCost;
      return hasMoney(composite) ? composite : 0;
    }
    return 0;
  }
  // Não pago: se houver pagamento atrasado parcial, exibe o valor efetivamente pago.
  if (row.isUnpaid) {
    if (row.paymentAmount != null && row.paymentAmount > 0) {
      return row.paymentAmount;
    }
    if (row.expectedAmortization != null) {
      const expected = row.expectedAmortization + adjustedInterest + (row.monthlyCost ?? 0);
      return hasMoney(expected) ? expected : 0;
    }
  }
  if (hasMoney(row.installment)) return row.installment;
  const composite = row.amortization + adjustedInterest + row.monthlyCost;
  return hasMoney(composite) ? composite : 0;
}

function displayAmortization(
  row: LoanRow,
  graceType: 'capitalized' | 'paid',
): number {
  // row.interest já inclui o ajuste de juros do mês (positivo ou negativo).
  const adjustedInterest = row.interest ?? 0;

  if (row.isGrace) return 0;
  // Parcela Líq.: referência fixa (valor financiado ÷ parcelas), igual em SAC e PRICE.
  if (row.fixedInstallmentReference != null) return row.fixedInstallmentReference;
  // Não pago: amortization foi zerado — usa expectedAmortization diretamente
  if (row.isUnpaid && row.expectedAmortization != null) {
    return hasMoney(row.expectedAmortization) ? row.expectedAmortization : 0;
  }
  if (hasMoney(row.amortization)) return row.amortization;
  const installment = displayInstallment(row, graceType);
  if (!hasMoney(installment)) return 0;
  const derived = installment - adjustedInterest - row.monthlyCost;
  return hasMoney(derived) ? derived : 0;
}

function formatMoneyCell(value: number, options?: { showZero?: boolean }): string {
  if (hasMoney(value)) return formatCurrency(value);
  if (options?.showZero) return formatCurrency(0);
  return '—';
}

function formatScheduleCell(
  row: any,
  key: string,
  graceType: 'capitalized' | 'paid',
  displayMonthLabel: string | null,
): string {
  if (row.isReclas) {
    switch (key) {
      case 'month':
        return 'Reclas.';
      case 'date':
        return formatRowDate(row.date);
      case 'initial':
        return hasMoney(row.initialBalance) ? formatCurrency(row.initialBalance) : '—';
      case 'final':
        return hasMoney(row.finalBalance) ? formatCurrency(row.finalBalance) : '—';
      case 'short':
        return row.shortTermBalance >= 0.005 ? formatCurrency(row.shortTermBalance) : '—';
      case 'long':
        return row.longTermBalance >= 0.005 ? formatCurrency(row.longTermBalance) : '—';
      default:
        return '—';
    }
  }

  if (row.month === 0 && !['month', 'date', 'initial', 'final', 'short', 'long'].includes(key)) {
    if (key === 'iof' && hasMoney(row.iof)) return formatCurrency(row.iof);
    return '—';
  }
  switch (key) {
    case 'month': {
      if (row.isDelayedPayment) return 'Pgto Atrasado';
      if (row.isOverdue) return `Parcela Atrasada ${row.overdueInstallmentNumber}`;
      if (row.month === 0 || row.isGrace) return '—';
      if (displayMonthLabel) return displayMonthLabel;
      const monthValue = Number(row.month);
      if (!Number.isFinite(monthValue) || monthValue <= 0) return '—';
      const gracePeriodMonths = Number(row.gracePeriodMonths || 0);
      if (gracePeriodMonths > 0 && monthValue > gracePeriodMonths) {
        return String(monthValue - gracePeriodMonths);
      }
      return String(monthValue);
    }
    case 'date':
      return formatRowDate(row.date);
    case 'days': {
      if (row.month === 0) return '—';
      const du =
        row.selicBusinessDays != null && row.selicBusinessDays > 0
          ? row.selicBusinessDays
          : row.accrualDays;
      return String(du);
    }
    case 'selic':
      return row.selicAccumulatedFactor != null && row.selicAccumulatedFactor !== 1
        ? row.selicAccumulatedFactor.toFixed(6)
        : '—';
    case 'rate': {
      if (row.isGrace && graceType === 'capitalized') return '—';
      if (row.effectivePctInPeriod == null) return '—';
      const dec =
        row.selicBusinessDays != null && row.selicBusinessDays > 0 ? 6 : 4;
      return `${row.effectivePctInPeriod.toFixed(dec)}%`;
    }
    case 'initial':
      return formatCurrency(row.initialBalance);
    case 'installment':
      return formatMoneyCell(displayInstallment(row, graceType));
    case 'amortization':
      return formatMoneyCell(displayAmortization(row, graceType), {
        showZero: row.isGrace && graceType === 'paid',
      });
    case 'prepayment':
      return row.prepaymentAmount != null && row.prepaymentAmount > 0
        ? formatCurrency(row.prepaymentAmount)
        : '—';
    case 'unpaid':
      return row.unpaidAmount != null && row.unpaidAmount > 0
        ? formatCurrency(row.unpaidAmount)
        : '—';
    case 'interest':
      // row.interest já inclui o ajuste de juros do mês (positivo ou negativo).
      return formatMoneyCell(row.interest ?? 0);
    case 'ajusteJuros':
      return row.interestAdjustment != null && row.interestAdjustment < 0
        ? formatCurrency(row.interestAdjustment)
        : '—';
    case 'ajustes':
      return row.interestAdjustment != null && row.interestAdjustment > 0
        ? `+${formatCurrency(row.interestAdjustment)}`
        : '—';
    case 'final':
      return formatCurrency(row.finalBalance);
    case 'short':
      return formatMoneyCell(row.shortTermBalance);
    case 'long':
      return formatMoneyCell(row.longTermBalance);
    case 'ocorrencia':
      return '—';
    default:
      return '—';
  }
}

/**
 * Célula de ocorrência — três estados:
 *  1. Neutro (padrão): só exibe "—" e, ao passar o mouse, um botão "NÃO PAGO"
 *  2. Não Pago (isUnpaid, sem paymentAmount): badge vermelho "NÃO PAGO" clicável para desfazer
 *  3. Pago atrasado (isUnpaid + paymentAmount > 0): badge verde "PAGO" (somente leitura na célula)
 */
function OcorrenciaCell({
  row,
  handlers,
}: {
  row: any;
  handlers: OcorrenciaHandlers;
}) {
  // Parcela quitada com atraso — mostra badge "PAGO" estático
  if (row.isUnpaid && row.paymentAmount != null && row.paymentAmount > 0) {
    return (
      <div className="flex items-center justify-center">
        <span className="px-2 py-0.5 text-[9px] font-bold rounded uppercase tracking-wider border bg-emerald-600 text-white border-emerald-700">
          Pago
        </span>
      </div>
    );
  }

  // Parcela marcada como não paga — badge vermelho clicável para reverter
  if (row.isUnpaid) {
    return (
      <div className="flex items-center justify-center">
        <button
          type="button"
          onClick={() => handlers.onToggleUnpaid?.(row.month)}
          className="px-2 py-0.5 text-[9px] font-bold rounded uppercase tracking-wider border bg-red-600 text-white border-red-700 hover:bg-red-700 transition-all"
        >
          Não Pago
        </button>
      </div>
    );
  }

  // Estado neutro — traço; ao hover mostra botão "NÃO PAGO" discreto (não para carência)
  if (row.isGrace) {
    return <span className="text-slate-300 select-none">—</span>;
  }
  return (
    <div className="group flex items-center justify-center">
      <span className="group-hover:hidden text-slate-300 select-none">—</span>
      <button
        type="button"
        onClick={() => handlers.onToggleUnpaid?.(row.month)}
        className="hidden group-hover:inline-flex px-2 py-0.5 text-[9px] font-bold rounded uppercase tracking-wider border bg-white text-red-500 border-red-300 hover:bg-red-50 transition-all"
      >
        Não Pago
      </button>
    </div>
  );
}

const ScheduleRow = memo(function ScheduleRow({
  row,
  columns,
  graceType,
  fixedHeight,
  handlers,
  displayMonthLabel,
}: {
  row: any;
  columns: ScheduleColumn[];
  graceType: 'capitalized' | 'paid';
  fixedHeight?: boolean;
  handlers: OcorrenciaHandlers;
  displayMonthLabel: string | null;
}) {
  return (
    <tr
      className={cn(
        'technical-grid-row',
        fixedHeight && 'h-9 max-h-9 overflow-hidden',
        row.isGrace && 'bg-amber-50/40',
        row.isOverdue && 'bg-orange-100/80 border-l-4 border-l-orange-600',
        row.isUnpaid && !row.isOverdue && 'bg-red-100/70 border-l-4 border-l-red-600',
        row.isPaid && !row.isUnpaid && 'bg-emerald-50/60 border-l-4 border-l-emerald-500',
        row.prepaymentAmount && row.prepaymentAmount > 0 && !row.isUnpaid && !row.isPaid && 'bg-sky-50/70 border-l-4 border-l-sky-600',
        row.extraPayment && row.extraPayment > 0 && !row.isUnpaid && !row.isPaid && 'bg-emerald-50/70 border-l-4 border-l-emerald-600',
        row.month === 0 && 'bg-brand-sidebar/10',
        row.isReclas && 'bg-slate-100 font-medium',
      )}
    >
      {columns.map((col) => (
        <td
          key={col.key}
          className={cn(
            'px-3 py-2 border-r border-brand-border/10 whitespace-nowrap',
            fixedHeight && 'py-1.5 leading-tight',
            col.align === 'center' ? 'text-center font-bold' : 'text-right',
            col.key === 'interest' && 'text-red-700',
            col.key === 'varMonetaria' && 'text-orange-700',
            col.key === 'amortization' && 'text-blue-700',
          )}
        >
          {col.key === 'ocorrencia' && row.month > 0 && !row.isReclas && !row.isOverdue && !row.isDelayedPayment ? (
            <OcorrenciaCell row={row} handlers={handlers} />
          ) : col.key === 'ocorrencia' && row.isDelayedPayment ? (
            <div className="flex items-center justify-center">
              <span className="px-2 py-0.5 text-[9px] font-bold rounded uppercase tracking-wider border bg-emerald-600 text-white border-emerald-700">
                Pago
              </span>
            </div>
          ) : (
            formatScheduleCell(row, col.key, graceType, displayMonthLabel)
          )}
        </td>
      ))}
    </tr>
  );
});

function OverdueHeaderRow({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="px-3 py-2 bg-orange-700 text-white text-[9px] font-black uppercase tracking-widest border-y-2 border-orange-800"
      >
        ▼ Saldo Parcelas Atrasadas — Ciclo de Quitação
      </td>
    </tr>
  );
}

function TableHead({ columns }: { columns: ScheduleColumn[] }) {
  return (
    <thead className="technical-grid-header sticky top-0 z-10">
      <tr>
        {columns.map((col) => (
          <th
            key={col.key}
            className={cn(
              'px-3 py-2.5 border-r border-brand-border whitespace-nowrap text-[9px] bg-brand-sidebar',
              col.align === 'center' ? 'text-center' : 'text-right',
            )}
          >
            {col.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export default memo(function LoanScheduleVirtualTable({
  rows,
  columns,
  emptyMessage = 'Nenhum registro a exibir. Insira um Valor Principal > 0.',
  graceType = 'capitalized',
  onTogglePaid,
  onToggleUnpaid,
  onSetInterestAdjustment,
  onSetPrepayment,
  onUpdatePaymentAmount,
}: LoanScheduleVirtualTableProps) {
  const handlers: OcorrenciaHandlers = useMemo(
    () => ({ onTogglePaid, onToggleUnpaid, onSetInterestAdjustment, onSetPrepayment }),
    [onTogglePaid, onToggleUnpaid, onSetInterestAdjustment, onSetPrepayment],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(560);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
    };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewportHeight(el.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      setScrollTop(el.scrollTop);
    });
  }, []);

  // Process rows to inject Reclas. rows just like in the PDF
  const processedRows = useMemo(() => {
    if (rows.length === 0) return [];

    const decemberIndices = new Set<number>();
    const years = new Set<number>();
    rows.forEach((r) => {
      if (r.month > 0 && r.date) {
        const d = r.date instanceof Date ? r.date : new Date(r.date);
        years.add(d.getUTCFullYear());
      }
    });

    for (const year of years) {
      let bestIdx = -1;
      let bestDay = -1;
      rows.forEach((row, idx) => {
        if (row.month <= 0 || !row.date) return;
        const d = row.date instanceof Date ? row.date : new Date(row.date);
        if (d.getUTCFullYear() !== year || d.getUTCMonth() !== 11) return;
        const day = d.getDate();
        if (day > bestDay) {
          bestDay = day;
          bestIdx = idx;
        }
      });
      if (bestIdx >= 0) decemberIndices.add(bestIdx);
    }

    let maxGrace = 0;
    rows.forEach((r) => {
      if (r.isGrace && r.month > maxGrace) {
        maxGrace = r.month;
      }
    });

    const result: any[] = [];
    let overdueHeaderInserted = false;
    rows.forEach((row, idx) => {
      // Inserir cabeçalho separador antes da primeira linha isOverdue
      if (row.isOverdue && !overdueHeaderInserted) {
        overdueHeaderInserted = true;
        result.push({ _isOverdueHeader: true });
      }

      const isDec = decemberIndices.has(idx);
      const isLastGraceMonth = row.isGrace && row.month === maxGrace;
      const isGraceNotLast = row.isGrace && row.month < maxGrace;

      const isReclas = (isDec && !isGraceNotLast) || isLastGraceMonth;

      if (!isReclas) {
        result.push({ ...row });
        return;
      }

      // Normal row before reclassification: CP = 0
      // - Linha de carência: LP = saldo total (todo o saldo fica em LP antes da reclas)
      // - Linha de amortização dezembro: LP = valor congelado do ano corrente
      //   (longTermBalanceBeforeReclas), não o saldo atual — o LP fica imutável até a reclas.
      const longoAntes = row.isGrace
        ? Math.max(0, row.finalBalance)
        : (row.longTermBalanceBeforeReclas ?? row.longTermBalance);
      result.push({
        ...row,
        shortTermBalance: 0,
        longTermBalance: longoAntes,
      });

      // Reclassification row
      const curtoAlvo = row.shortTermBalance;
      if (curtoAlvo >= 0.005) {
        // Usar row.longTermBalance calculado pelo loanCalculator (já correto para inadimplência).
        // row.longTermBalance = LP pós-reclas = LP_base − CP, onde LP_base é o LP congelado
        // (que inclui parcelas não pagas) e não simplesmente o saldo final devedor.
        result.push({
          isReclas: true,
          month: -1,
          date: row.date,
          accrualDays: 0,
          referenceMonthDays: 0,
          die30Factor: 0,
          opCostPeriodFactor: 0,
          initialBalance: row.finalBalance,
          interest: 0,
          amortization: 0,
          monthlyCost: 0,
          iof: 0,
          installment: 0,
          finalBalance: row.finalBalance,
          shortTermBalance: curtoAlvo,
          longTermBalance: row.longTermBalance,
          isGrace: false,
        });
      }
    });

    return result;
  }, [rows]);

  const gracePeriodMonths = useMemo(() => {
    return rows.reduce((maxGrace, row) => {
      const monthValue = Number(row.month);
      if (row.isGrace && Number.isFinite(monthValue) && monthValue > maxGrace) {
        return monthValue;
      }
      return maxGrace;
    }, 0);
  }, [rows]);

  const displayMonthLabels = useMemo(() => {
    let installmentNumber = 0;
    return processedRows.map((row) => {
      if (row._isOverdueHeader || row.isReclas || row.month === 0 || row.isGrace || row.isDelayedPayment || row.isOverdue) return null;
      installmentNumber += 1;
      return String(installmentNumber);
    });
  }, [processedRows]);

  const { startIndex, endIndex, paddingTop, paddingBottom } = useMemo(() => {
    const total = processedRows.length;
    if (total === 0) {
      return { startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0 };
    }
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT_PX) - OVERSCAN);
    const visible = Math.ceil(viewportHeight / ROW_HEIGHT_PX) + OVERSCAN * 2;
    const end = Math.min(total, start + visible);
    return {
      startIndex: start,
      endIndex: end,
      paddingTop: start * ROW_HEIGHT_PX,
      paddingBottom: Math.max(0, (total - end) * ROW_HEIGHT_PX),
    };
  }, [processedRows.length, scrollTop, viewportHeight]);

  const visibleRows = useMemo(
    () => processedRows.slice(startIndex, endIndex),
    [processedRows, startIndex, endIndex],
  );

  if (processedRows.length === 0) {
    return (
      <div className="module-table-viewport flex items-center justify-center py-20">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 text-center px-4">
          {emptyMessage}
        </p>
      </div>
    );
  }

  const useVirtual = processedRows.length > VIRTUAL_THRESHOLD;

  if (!useVirtual) {
    return (
      <div ref={scrollRef} className="module-table-viewport" onScroll={onScroll}>
        <table className="w-full min-w-[1100px] text-left text-sm border-collapse">
          <TableHead columns={columns} />
          <tbody className="font-mono text-[10px] divide-y divide-brand-border/10">
            {processedRows.map((row, idx) =>
              row._isOverdueHeader ? (
                <OverdueHeaderRow key={`overdue-header-${idx}`} colSpan={columns.length} />
              ) : (
                <ScheduleRow
                  key={`${idx}-${row.month}-${formatRowDate(row.date)}`}
                  row={row}
                  columns={columns}
                  graceType={graceType}
                  handlers={handlers}
                  displayMonthLabel={displayMonthLabels[idx] ?? null}
                />
              ),
            )}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="module-table-viewport" onScroll={onScroll}>
      <table className="w-full min-w-[1100px] text-left text-sm border-collapse">
        <TableHead columns={columns} />
        <tbody className="font-mono text-[10px] divide-y divide-brand-border/10">
          <VirtualSpacerRow colSpan={columns.length} height={paddingTop} />
          {visibleRows.map((row, i) => {
            const absoluteIndex = startIndex + i;
            return row._isOverdueHeader ? (
              <OverdueHeaderRow key={`overdue-header-${absoluteIndex}`} colSpan={columns.length} />
            ) : (
              <ScheduleRow
                key={`${absoluteIndex}-${row.month}-${formatRowDate(row.date)}`}
                row={row}
                columns={columns}
                graceType={graceType}
                handlers={handlers}
                fixedHeight
                displayMonthLabel={displayMonthLabels[absoluteIndex] ?? null}
              />
            );
          })}
          <VirtualSpacerRow colSpan={columns.length} height={paddingBottom} />
        </tbody>
      </table>
    </div>
  );
});
