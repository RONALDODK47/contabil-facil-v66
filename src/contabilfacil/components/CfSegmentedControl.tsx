import { cn } from '../lib/utils';

export type CfSegmentedOption<T extends string> = {
  value: T;
  label: string;
  title?: string;
};

type CfSegmentedControlProps<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  options: CfSegmentedOption<T>[];
  'aria-label': string;
  className?: string;
};

/** Alternância de 2+ opções (substitui select curto — evita bug visual do dropdown nativo). */
export function CfSegmentedControl<T extends string>({
  value,
  onChange,
  options,
  'aria-label': ariaLabel,
  className,
}: CfSegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex h-[26px] min-h-[26px] shrink-0 border border-brand-border divide-x divide-brand-border',
        className,
      )}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        const btnClass = cn(
          'px-2 text-[9px] font-bold uppercase font-mono whitespace-nowrap transition-colors leading-none',
          active
            ? 'bg-brand-border text-brand-bg'
            : 'bg-white text-brand-text hover:bg-brand-sidebar/40',
        );
        return active ? (
          <button
            key={opt.value}
            type="button"
            title={opt.title ?? opt.label}
            aria-pressed="true"
            className={btnClass}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ) : (
          <button
            key={opt.value}
            type="button"
            title={opt.title ?? opt.label}
            aria-pressed="false"
            className={btnClass}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
