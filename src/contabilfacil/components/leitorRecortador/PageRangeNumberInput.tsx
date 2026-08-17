/**
 * Campo de página editável — permite apagar e digitar qualquer número (valida no blur/Enter).
 */
import React, { useEffect, useState } from 'react';

type PageRangeNumberInputProps = {
  id?: string;
  value: number;
  min?: number;
  max: number;
  onChange: (value: number) => void;
  onNavigate?: (value: number) => void;
  className?: string;
  'aria-label'?: string;
  title?: string;
  placeholder?: string;
};

export function PageRangeNumberInput({
  id,
  value,
  min = 1,
  max,
  onChange,
  onNavigate,
  className = '',
  placeholder,
  ...a11y
}: PageRangeNumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? String(value);

  useEffect(() => {
    if (draft !== null && String(value) === draft) {
      setDraft(null);
    }
  }, [value, draft]);

  const commit = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    let val = parseInt(digits, 10);
    if (!Number.isFinite(val)) val = value;
    val = Math.max(min, Math.min(max, val));
    onChange(val);
    onNavigate?.(val);
    setDraft(null);
  };

  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      value={display}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit((e.target as HTMLInputElement).value);
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          setDraft(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={`${className} outline-none disabled:opacity-50`}
      style={{
        WebkitAppearance: 'none',
        MozAppearance: 'textfield',
        appearance: 'none',
      }}
      {...a11y}
    />
  );
}
