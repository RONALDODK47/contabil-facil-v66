import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import {
  formatLocaleNumberForInput,
  parseLocaleNumber,
  sanitizeNumericDraft,
} from '../../lib/localeNumber';
import { cn } from '../lib/utils';

type FreeNumericInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'inputMode'
> & {
  value: number;
  onChange: (value: number) => void;
  inputMode?: 'decimal' | 'numeric';
  /** Quando true (padrão), exibe vazio se o valor armazenado for 0. */
  hideZeroWhenBlurred?: boolean;
  /** Casas decimais na exibição após blur (padrão 6). */
  displayDecimals?: number;
  /** Confirma o valor enquanto digita (debounce), sem esperar blur. */
  commitWhileFocused?: boolean;
  /** Debounce em ms quando commitWhileFocused (padrão 350). */
  commitDebounceMs?: number;
};

/**
 * Campo numérico livre: aceita vírgula decimal e ponto de milhar (ex.: 6.268,75).
 * Confirma o valor só no blur — não interfere enquanto digita.
 */
export function FreeNumericInput({
  value,
  onChange,
  className,
  inputMode = 'decimal',
  hideZeroWhenBlurred = true,
  displayDecimals = 6,
  commitWhileFocused = false,
  commitDebounceMs = 350,
  onFocus,
  onBlur,
  ...rest
}: FreeNumericInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const focused = useRef(false);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const formatStored = (n: number) => {
    if (hideZeroWhenBlurred && n === 0) return '';
    return formatLocaleNumberForInput(n, displayDecimals);
  };

  useEffect(() => {
    if (!focused.current) setDraft(null);
  }, [value]);

  useEffect(() => {
    return () => {
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    };
  }, []);

  const display = draft !== null ? draft : formatStored(value);

  const parseDraftValue = (raw: string): number => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '-' || trimmed === ',' || trimmed === '.') return 0;
    return parseLocaleNumber(raw, 0);
  };

  const queueCommit = (raw: string) => {
    if (!commitWhileFocused) return;
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(() => {
      commitTimerRef.current = null;
      const parsed = parseDraftValue(raw);
      if (parsed !== value) onChange(parsed);
    }, commitDebounceMs);
  };

  return (
    <input
      {...rest}
      type="text"
      inputMode={inputMode}
      autoComplete="off"
      spellCheck={false}
      className={cn(className)}
      value={display}
      onFocus={(e) => {
        focused.current = true;
        setDraft(formatStored(value));
        onFocus?.(e);
      }}
      onBlur={(e) => {
        focused.current = false;
        if (commitTimerRef.current) {
          clearTimeout(commitTimerRef.current);
          commitTimerRef.current = null;
        }
        const parsed = parseDraftValue(draft ?? display);
        onChange(parsed);
        setDraft(null);
        onBlur?.(e);
      }}
      onChange={(e) => {
        const nextDraft = sanitizeNumericDraft(e.target.value);
        setDraft(nextDraft);
        queueCommit(nextDraft);
      }}
    />
  );
}
