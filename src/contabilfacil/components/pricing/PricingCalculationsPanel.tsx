import { useMemo, useState, type ReactNode } from 'react';
import { Calculator } from 'lucide-react';
import {
  CF_CALC_PANEL,
  CF_CALC_SHELL,
  CF_CALC_TABS,
  CF_FIELD_COL,
  CF_FIELD_ROW,
  CF_INPUT_NUM,
  CF_INPUT_PCT,
  CF_INPUT_SHORT,
  CF_LABEL,
} from '../../lib/formFieldClasses';
import { cn, formatCurrency, parseLocaleNumber } from '../../lib/utils';
import { calcBasic, type BasicCalcMode } from '../../logic/pricingMeasureCalculator';

const CALC_MODES: { id: BasicCalcMode; label: string; hint: string }[] = [
  { id: 'adicao', label: 'Adição', hint: 'Some dois valores (A + B).' },
  { id: 'subtracao', label: 'Subtração', hint: 'Subtraia o segundo valor do primeiro (A − B).' },
  { id: 'multiplicacao', label: 'Multiplicação', hint: 'Multiplique dois valores (A × B).' },
  { id: 'divisao', label: 'Divisão', hint: 'Divida o primeiro valor pelo segundo (A ÷ B).' },
  { id: 'porcentagem', label: 'Porcentagem', hint: 'Calcule quanto é X% de um valor.' },
];

function parseNum(raw: string): number {
  return parseLocaleNumber(raw, 0);
}

function ResultCard({
  title,
  value,
  detail,
  error,
}: {
  title: string;
  value: string | null;
  detail?: string;
  error?: string;
}) {
  return (
    <div className="inline-block w-fit min-w-[120px] max-w-[220px] border border-brand-border bg-white/90 px-3 py-2 space-y-1 shadow-[2px_2px_0_0_rgba(20,20,20,0.08)]">
      <p className="text-[8px] font-black uppercase tracking-wide opacity-50">{title}</p>
      {error ? (
        <p className="text-[9px] font-bold text-red-700 leading-snug">{error}</p>
      ) : (
        <>
          <p className="text-[14px] font-mono font-black tabular-nums">{value ?? '—'}</p>
          {detail && <p className="text-[7px] font-bold uppercase opacity-45 leading-snug">{detail}</p>}
        </>
      )}
    </div>
  );
}

function CalcFormBody({ children }: { children: ReactNode }) {
  return <div className="w-fit max-w-full flex-1 flex flex-col gap-3 min-h-0">{children}</div>;
}

function CalcResults({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2 mt-auto pt-1">{children}</div>;
}

function formatResult(mode: BasicCalcMode, value: number): string {
  if (mode === 'porcentagem') return formatCurrency(value);
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 6 });
}

function BasicCalc({ mode }: { mode: BasicCalcMode }) {
  const [valueA, setValueA] = useState('');
  const [valueB, setValueB] = useState('');

  const result = useMemo(
    () =>
      calcBasic({
        mode,
        a: parseNum(valueA),
        b: parseNum(valueB),
      }),
    [mode, valueA, valueB],
  );

  const labelA =
    mode === 'porcentagem'
      ? 'Percentual (%)'
      : mode === 'divisao'
        ? 'Dividendo (A)'
        : 'Valor A';
  const labelB =
    mode === 'porcentagem'
      ? 'Valor base (R$)'
      : mode === 'divisao'
        ? 'Divisor (B)'
        : 'Valor B';

  return (
    <CalcFormBody>
      <div className={CF_FIELD_ROW}>
        <label className={CF_FIELD_COL}>
          <span className={CF_LABEL}>{labelA}</span>
          <input
            aria-label={labelA}
            type="text"
            inputMode="decimal"
            className={mode === 'porcentagem' ? CF_INPUT_PCT : CF_INPUT_SHORT}
            placeholder={mode === 'porcentagem' ? '30' : '100,00'}
            value={valueA}
            onChange={(e) => setValueA(e.target.value)}
          />
        </label>
        <label className={CF_FIELD_COL}>
          <span className={CF_LABEL}>{labelB}</span>
          <input
            aria-label={labelB}
            type="text"
            inputMode="decimal"
            className={CF_INPUT_SHORT}
            placeholder="100,00"
            value={valueB}
            onChange={(e) => setValueB(e.target.value)}
          />
        </label>
      </div>
      <CalcResults>
        <ResultCard
          title="Resultado"
          value={result.error ? null : formatResult(mode, result.value)}
          detail={result.error ? undefined : result.formula}
          error={result.error}
        />
      </CalcResults>
    </CalcFormBody>
  );
}

export default function PricingCalculationsPanel() {
  const [mode, setMode] = useState<BasicCalcMode>('adicao');
  const active = CALC_MODES.find((m) => m.id === mode)!;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Calculator size={14} className="opacity-50" />
        <span className="text-[10px] font-black uppercase">Calculadora</span>
      </div>
      <p className="text-[9px] opacity-60 uppercase font-bold leading-relaxed">{active.hint}</p>

      <div className={CF_CALC_SHELL}>
        <div className={CF_CALC_TABS}>
          {CALC_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={cn(
                'px-2.5 py-1.5 text-[8px] font-bold uppercase tracking-wide',
                mode === m.id ? 'bg-brand-border text-brand-bg' : 'opacity-60 hover:opacity-100',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className={CF_CALC_PANEL}>
          <BasicCalc mode={mode} />
        </div>
      </div>
    </div>
  );
}
