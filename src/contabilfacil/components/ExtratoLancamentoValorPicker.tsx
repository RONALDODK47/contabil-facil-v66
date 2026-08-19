import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search } from 'lucide-react';
import { DynamicStyleDiv } from '../lib/dynamicStyle';
import { cn } from '../lib/utils';

/** Lançamento do extrato apresentado para criar regra POR VALOR. */
export type ExtratoLancamentoValor = {
  descricao: string;
  nature: 'D' | 'C';
  valor: number;
  ocorrencias: number;
  /** Datas (dd/mm/aaaa) em que esse valor apareceu no extrato, em ordem. */
  datas?: string[];
  /** Nenhuma regra cobre este lançamento ainda. */
  semRegra: boolean;
};

const PANEL_W_PX = 560;
const PANEL_H_PX = 320;
const FILTER_LIMIT = 60;

export function formatValorBR(valor: number): string {
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function lancamentoValorKey(l: ExtratoLancamentoValor): string {
  return `${l.nature}|${Math.round(l.valor * 100)}|${l.descricao}`;
}

/** Tolerância da busca aproximada: 2% do valor procurado, com piso de R$ 1,00. */
const APROX_PCT = 0.02;
const APROX_MIN = 1;

/**
 * Lê o que foi digitado como valor em pt-BR ("1.873,32", "1873,32", "1873").
 * Retorna undefined quando não é um número (aí só a busca por histórico vale).
 */
export function parseValorBuscado(raw: string): number | undefined {
  const txt = raw.trim();
  if (!txt || !/\d/.test(txt)) return undefined;
  if (/[^\d.,\s]/.test(txt)) return undefined;
  const limpo = txt.replace(/\s/g, '');
  let normalizado: string;
  if (limpo.includes(',')) {
    normalizado = limpo.replace(/\./g, '').replace(',', '.');
  } else if ((limpo.match(/\./g) || []).length > 1) {
    normalizado = limpo.replace(/\./g, '');
  } else {
    normalizado = limpo;
  }
  const n = Number(normalizado);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

/** Quanto o valor procurado pode variar e ainda ser considerado "aproximado". */
export function toleranciaAproximada(alvo: number): number {
  return Math.max(APROX_MIN, Math.abs(alvo) * APROX_PCT);
}

/**
 * Busca pelo valor (exato, por dígitos ou aproximado) ou pelo histórico dono do
 * valor. Digitando um número, valores próximos entram no resultado e a lista é
 * ordenada do mais próximo para o mais distante.
 */
function filterLancamentos(
  lancamentos: ExtratoLancamentoValor[],
  query: string,
): ExtratoLancamentoValor[] {
  const raw = query.trim();
  if (!raw) return lancamentos.slice(0, FILTER_LIMIT);
  const q = normalizeSearch(raw);
  const digits = raw.replace(/[^\d]/g, '');
  const alvo = parseValorBuscado(raw);
  const tolerancia = alvo === undefined ? 0 : toleranciaAproximada(alvo);
  const hits: Array<{ l: ExtratoLancamentoValor; dist: number }> = [];
  for (const l of lancamentos) {
    const valorTxt = formatValorBR(l.valor);
    const valorDigits = valorTxt.replace(/[^\d]/g, '');
    const desc = normalizeSearch(l.descricao);
    const casaValor = digits.length > 0 && valorDigits.includes(digits);
    const casaDesc = desc.split(/\s+/).some((w) => w.startsWith(q)) || valorTxt.includes(raw);
    const dist = alvo === undefined ? Number.POSITIVE_INFINITY : Math.abs(l.valor - alvo);
    const casaAprox = alvo !== undefined && dist <= tolerancia;
    if (casaValor || casaDesc || casaAprox) hits.push({ l, dist });
  }
  if (alvo !== undefined) hits.sort((a, b) => a.dist - b.dist);
  return hits.slice(0, FILTER_LIMIT).map((h) => h.l);
}

/** Datas vêm do extrato em ISO (2026-05-12) ou já em BR — a lista mostra sempre em BR. */
export function formatDataBR(data: string): string {
  const iso = data.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return data.trim();
}

/** Resumo das datas do lançamento para a linha da lista (limita o texto). */
function resumoDatas(datas: string[] | undefined): string {
  const list = (datas || []).filter(Boolean).map(formatDataBR);
  if (list.length === 0) return '';
  if (list.length <= 3) return list.join(' · ');
  return `${list.slice(0, 3).join(' · ')} +${list.length - 3}`;
}

type Props = {
  buttonId?: string;
  lancamentos: ExtratoLancamentoValor[];
  value: string;
  disabled?: boolean;
  placeholder?: string;
  onSelect: (lancamento: ExtratoLancamentoValor) => void;
  onClear?: () => void;
};

export default memo(function ExtratoLancamentoValorPicker({
  buttonId,
  lancamentos,
  value,
  disabled = false,
  placeholder = 'Buscar lançamento por valor…',
  onSelect,
  onClear,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  /**
   * Lançamento que já tem regra não polui a busca: some da lista por padrão.
   * Ver todos continua a um clique, para conferência.
   */
  const [mostrarComRegra, setMostrarComRegra] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const selected = useMemo(
    () => lancamentos.find((l) => lancamentoValorKey(l) === value),
    [lancamentos, value],
  );

  const disponiveis = useMemo(
    () => (mostrarComRegra ? lancamentos : lancamentos.filter((l) => l.semRegra)),
    [lancamentos, mostrarComRegra],
  );

  const comRegraCount = useMemo(
    () => lancamentos.filter((l) => !l.semRegra).length,
    [lancamentos],
  );

  const filtered = useMemo(
    () => filterLancamentos(disponiveis, query),
    [disponiveis, query],
  );

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
    if (disabled || lancamentos.length === 0) return;
    updatePos();
    setQuery('');
    setMostrarComRegra(false);
    setOpen(true);
  }, [disabled, lancamentos.length, updatePos]);

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
    open && lancamentos.length > 0
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
                placeholder="Valor aproximado (ex.: 1.873) ou histórico…"
                className="w-full bg-transparent text-[10px] font-semibold text-brand-text outline-none placeholder:text-brand-text/45"
                aria-label="Buscar lançamento do extrato por valor"
              />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-white">
              {filtered.length === 0 ? (
                <p className="p-3 text-[10px] text-brand-text/60 uppercase text-center font-semibold">
                  {!mostrarComRegra && comRegraCount > 0
                    ? 'Nenhum lançamento sem regra — marque "incluir os que já têm regra" abaixo'
                    : 'Nenhum lançamento encontrado'}
                </p>
              ) : (
                filtered.map((l) => {
                  const key = lancamentoValorKey(l);
                  const active = value === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={cn(
                        'w-full text-left px-2 py-2 border-b border-brand-border/40 transition-colors',
                        active
                          ? 'bg-brand-text text-white'
                          : 'bg-white hover:bg-brand-sidebar text-brand-text',
                      )}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        onSelect(l);
                        setOpen(false);
                      }}
                    >
                      <div className="flex items-start gap-1.5">
                        <span
                          className={cn(
                            'shrink-0 text-[8px] font-black px-1 py-0.5 border',
                            l.nature === 'D'
                              ? active
                                ? 'border-white/40 bg-red-600 text-white'
                                : 'border-red-300 bg-red-50 text-red-700'
                              : active
                                ? 'border-white/40 bg-blue-600 text-white'
                                : 'border-blue-300 bg-blue-50 text-blue-700',
                          )}
                        >
                          {l.nature}
                        </span>
                        <span className="text-[9px] font-semibold uppercase leading-snug flex-1 min-w-0 break-words">
                          {l.descricao || 'SEM HISTÓRICO'}
                          {resumoDatas(l.datas) ? (
                            <span
                              className={cn(
                                'ml-1 text-[8px] font-bold tabular-nums align-middle',
                                active ? 'text-white/75' : 'text-brand-text/55',
                              )}
                            >
                              {resumoDatas(l.datas)}
                            </span>
                          ) : null}
                          {l.semRegra ? (
                            <span
                              className={cn(
                                'ml-1 text-[7px] font-black uppercase px-1 py-0.5 border align-middle',
                                active
                                  ? 'border-white/40 text-white'
                                  : 'border-amber-300 bg-amber-50 text-amber-800',
                              )}
                            >
                              sem regra
                            </span>
                          ) : null}
                        </span>
                        <span
                          className={cn(
                            'shrink-0 text-[9px] font-black tabular-nums',
                            active ? 'text-white' : 'text-brand-text',
                          )}
                        >
                          {formatValorBR(l.valor)}
                        </span>
                        {l.ocorrencias > 1 ? (
                          <span
                            className={cn(
                              'shrink-0 text-[8px] font-bold tabular-nums',
                              active ? 'text-white/80' : 'text-brand-text/50',
                            )}
                          >
                            {l.ocorrencias}x
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
            <div className="px-2 py-1 border-t border-brand-border shrink-0 bg-brand-sidebar flex items-center justify-between gap-2">
              <span className="text-[8px] text-brand-text/55 font-semibold min-w-0 truncate">
                {query.trim()
                  ? 'Valores próximos (±2%) também aparecem, do mais perto para o mais longe'
                  : `${disponiveis.length} lançamento(s) sem regra — digite um valor aproximado ou o histórico`}
              </span>
              {comRegraCount > 0 ? (
                <label className="text-[8px] font-bold uppercase text-brand-text/70 inline-flex items-center gap-1 shrink-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mostrarComRegra}
                    onChange={(e) => setMostrarComRegra(e.target.checked)}
                    className="accent-brand-text"
                  />
                  Incluir os que já têm regra ({comRegraCount})
                </label>
              ) : null}
            </div>
          </DynamicStyleDiv>,
          document.body,
        )
      : null;

  const displayLabel = selected
    ? `[${selected.nature}] ${formatValorBR(selected.valor)} — ${selected.descricao || 'SEM HISTÓRICO'}`
    : '';

  return (
    <div ref={wrapRef} className="flex items-stretch gap-0.5 w-full min-w-0">
      <button
        id={buttonId}
        type="button"
        disabled={disabled || lancamentos.length === 0}
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={cn(
          'flex-1 min-w-0 min-h-[26px] border border-brand-border bg-white px-2 py-1 text-left text-[9px] font-semibold uppercase leading-snug whitespace-normal break-words',
          disabled && 'opacity-40 cursor-not-allowed',
          !selected && 'text-brand-text/45',
        )}
        aria-label="Escolher lançamento do extrato pelo valor"
        title={displayLabel || placeholder}
      >
        {displayLabel || placeholder}
      </button>
      {selected && onClear ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onClear()}
          className="shrink-0 px-1.5 border border-brand-border bg-brand-sidebar hover:bg-brand-sidebar/80 text-[9px] font-bold"
          aria-label="Limpar lançamento selecionado"
        >
          ×
        </button>
      ) : null}
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled || lancamentos.length === 0}
        className="shrink-0 px-1 border border-brand-border bg-brand-sidebar hover:bg-brand-sidebar/80 disabled:opacity-40"
        aria-label="Abrir lista de lançamentos do extrato"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? setOpen(false) : openPanel())}
      >
        <ChevronDown size={10} aria-hidden />
      </button>
      {panel}
    </div>
  );
});
