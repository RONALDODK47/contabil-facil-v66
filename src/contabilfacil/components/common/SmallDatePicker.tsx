import React, { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';

type Props = {
  value: string; // ISO date YYYY-MM-DD or empty
  onChange: (iso: string) => void;
  className?: string;
};

function toDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad2(n: number) { return n < 10 ? `0${n}` : `${n}`; }

export default function SmallDatePicker({ value, onChange, className }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const parsed = toDate(value) ?? new Date();
  const [viewMonth, setViewMonth] = useState(() => new Date(parsed.getFullYear(), parsed.getMonth(), 1));

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    const d = toDate(value);
    if (d) setViewMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  }, [value]);

  const selDate = toDate(value);

  const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

  const handlePick = (d: number) => {
    const iso = `${viewMonth.getFullYear()}-${pad2(viewMonth.getMonth() + 1)}-${pad2(d)}`;
    onChange(iso);
    setOpen(false);
  };

  const prevMonth = () => setViewMonth((s) => new Date(s.getFullYear(), s.getMonth() - 1, 1));
  const nextMonth = () => setViewMonth((s) => new Date(s.getFullYear(), s.getMonth() + 1, 1));

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`${className ?? ''} text-[11px] text-left bg-white`}
      >
        {selDate ? format(selDate, 'dd/MM/yyyy') : 'Selecione'}
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-40 bg-white border border-brand-border shadow-sm p-2 text-[11px]">
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={prevMonth} className="px-1">◀</button>
            <div className="font-bold">{format(viewMonth, 'MMMM yyyy')}</div>
            <button type="button" onClick={nextMonth} className="px-1">▶</button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px]">
            {['D','S','T','Q','Q','S','S'].map((d) => (
              <div key={d} className="opacity-60 text-[9px]">{d}</div>
            ))}
            {(() => {
              const y = viewMonth.getFullYear();
              const m = viewMonth.getMonth();
              const firstDay = new Date(y, m, 1).getDay();
              const total = daysInMonth(y, m);
              const cells: Array<React.ReactNode> = [];
              for (let i = 0; i < firstDay; i++) cells.push(<div key={`emp-${i}`} />);
              for (let d = 1; d <= total; d++) {
                const isSel = selDate && selDate.getFullYear() === y && selDate.getMonth() === m && selDate.getDate() === d;
                cells.push(
                  <button
                    key={d}
                    type="button"
                    onClick={() => handlePick(d)}
                    className={`h-7 w-7 leading-7 rounded ${isSel ? 'bg-brand-sidebar/60 text-white' : 'hover:bg-brand-sidebar/10'}`}
                  >
                    {d}
                  </button>
                );
              }
              return cells;
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
