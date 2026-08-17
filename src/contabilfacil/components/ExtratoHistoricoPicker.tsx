import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search } from 'lucide-react';
import { DynamicStyleDiv } from '../lib/dynamicStyle';
import { cn } from '../lib/utils';

export type ExtratoHistoricoPadrao = {
  descricao: string;
  nature: 'D' | 'C';
  ocorrencias: number;
};

const PANEL_W_PX = 560;
const PANEL_H_PX = 320;
const FILTER_LIMIT = 60;

function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function padraoKey(p: ExtratoHistoricoPadrao): string {
  return `${p.nature}|${p.descricao}`;
}

function filterPadroes(padroes: ExtratoHistoricoPadrao[], query: string): ExtratoHistoricoPadrao[] {
  const q = normalizeSearch(query.trim());
  if (!q) return padroes.slice(0, FILTER_LIMIT);
  const out: ExtratoHistoricoPadrao[] = [];
  for (const p of padroes) {
    const desc = normalizeSearch(p.descricao);
    const words = desc.split(/\s+/);
    if (words.some((w) => w.startsWith(q))) {
      out.push(p);
      if (out.length >= FILTER_LIMIT) break;
    }
  }
  return out;
}

type Props = {
  buttonId?: string;
  padroes: ExtratoHistoricoPadrao[];
  value: string;
  disabled?: boolean;
  placeholder?: string;
  onSelect: (padrao: ExtratoHistoricoPadrao) => void;
  onClear?: () => void;
};

export default memo(function ExtratoHistoricoPicker({
  buttonId,
  padroes,
  value,
  disabled = false,
  placeholder = 'Buscar histórico do extrato…',
  onSelect,
  onClear,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const selected = useMemo(
    () => padroes.find((p) => padraoKey(p) === value),
    [padroes, value],
  );

  const filtered = useMemo(() => filterPadroes(padroes, query), [padroes, query]);

  const updatePos = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + 4;
    if (left + PANEL_W_PX > window.innerWidth - 8) left = window.innerWidth - PANEL_W_PX - 8;
    if (top + PANEL_H_PX > window.innerHeight - 8) top = Math.max(8, rect.top - PANEL_H_PX - 4);
    setPos({ top, left: Math.max(8, left) });
  }, []);

  const openPanel = useCallback(() => {
    if (disabled || padroes.length === 0) return;
    updatePos();
    setQuery('');
    setOpen(true);
  }, [disabled, padroes.length, updatePos]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const panel =
    open && padroes.length > 0
      ? createPortal(
          <DynamicStyleDiv
            ref={panelRef}
            className="fixed z-[9999] border-2 border-brand-border bg-white shadow-[4px_4px_0_0_#141414] flex flex-col overflow-hidden w-[560px] max-w-[calc(100vw-16px)] h-[320px] max-h-[calc(100vh-16px)]"
            layout={{ top: pos.top, left: pos.left }}
            layoutDeps={[pos.top, pos.left]}
          >
            <div className="p-1.5 border-b border-brand-border flex items-center gap-1 shrink-0 bg-brand-sidebar">
              <Search size={11} className="text-brand-text/70 shrink-0" aria-hidden />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Digite o histórico da conciliação…"
                className="w-full bg-transparent text-[10px] font-semibold text-brand-text outline-none placeholder:text-brand-text/45"
                aria-label="Buscar histórico do extrato"
              />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-white">
              {filtered.length === 0 ? (
                <p className="p-3 text-[10px] text-brand-text/60 uppercase text-center font-semibold">
                  Nenhum histórico encontrado
                </p>
              ) : (
                filtered.map((p) => {
                  const key = padraoKey(p);
                  const active = value === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={cn(
                        'w-full text-left px-2 py-2 border-b border-brand-border/40 transition-colors',
                        active ? 'bg-brand-text text-white' : 'bg-white hover:bg-brand-sidebar text-brand-text',
                      )}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        onSelect(p);
                        setOpen(false);
                      }}
                    >
                      <div className="flex items-start gap-1.5">
                        <span
                          className={cn(
                            'shrink-0 text-[8px] font-black px-1 py-0.5 border',
                            p.nature === 'D'
                              ? active
                                ? 'border-white/40 bg-red-600 text-white'
                                : 'border-red-300 bg-red-50 text-red-700'
                              : active
                                ? 'border-white/40 bg-blue-600 text-white'
                                : 'border-blue-300 bg-blue-50 text-blue-700',
                          )}
                        >
                          {p.nature}
                        </span>
                        <span className="text-[9px] font-semibold uppercase leading-snug flex-1 min-w-0 break-words">
                          {p.descricao}
                        </span>
                        <span
                          className={cn(
                            'shrink-0 text-[8px] font-bold tabular-nums',
                            active ? 'text-white/80' : 'text-brand-text/50',
                          )}
                        >
                          {p.ocorrencias}x
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
            {padroes.length > FILTER_LIMIT && !query.trim() ? (
              <p className="text-[8px] px-2 py-1 border-t border-brand-border text-brand-text/55 text-center shrink-0 bg-brand-sidebar font-semibold">
                {padroes.length} histórico(s) — digite para buscar
              </p>
            ) : null}
          </DynamicStyleDiv>,
          document.body,
        )
      : null;

  const displayLabel = selected ? `[${selected.nature}] ${selected.descricao}` : '';

  return (
    <div ref={wrapRef} className="flex items-stretch gap-0.5 w-full min-w-0">
      <button
        id={buttonId}
        type="button"
        disabled={disabled || padroes.length === 0}
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={cn(
          'flex-1 min-w-0 min-h-[26px] border border-brand-border bg-white px-2 py-1 text-left text-[9px] font-semibold uppercase leading-snug whitespace-normal break-words',
          disabled && 'opacity-40 cursor-not-allowed',
          !selected && 'text-brand-text/45',
        )}
        aria-label="Escolher histórico do extrato"
        title={selected?.descricao || placeholder}
      >
        {displayLabel || placeholder}
      </button>
      {selected && onClear ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onClear()}
          className="shrink-0 px-1.5 border border-brand-border bg-brand-sidebar hover:bg-brand-sidebar/80 text-[9px] font-bold"
          aria-label="Limpar histórico selecionado"
        >
          ×
        </button>
      ) : null}
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled || padroes.length === 0}
        className="shrink-0 px-1 border border-brand-border bg-brand-sidebar hover:bg-brand-sidebar/80 disabled:opacity-40"
        aria-label="Abrir lista de históricos"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? setOpen(false) : openPanel())}
      >
        <ChevronDown size={10} aria-hidden />
      </button>
      {panel}
    </div>
  );
});
