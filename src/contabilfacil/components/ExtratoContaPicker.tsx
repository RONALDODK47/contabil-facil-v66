import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search } from 'lucide-react';
import { DynamicStyleDiv } from '../lib/dynamicStyle';
import { cn } from '../lib/utils';
import { sanitizeCodigoReduzido, normalizeExtratoContaParaGravacao, sameCodigoReduzido } from '../logic/planoContasMapper';
import { buildPlanoCodeIndex, canonizarContaPlano } from '../logic/extratoContaResolver';

export type ExtratoPlanoContaOption = {
  code: string;
  name: string;
  codigoReduzido?: string;
  tipo?: 'S' | 'A';
  nivel?: number;
  group?: string;
};

const PANEL_W_PX = 360;
const PANEL_H_PX = 280;
const FILTER_LIMIT = 80;

const INPUT_CLS =
  'w-full min-w-0 h-[26px] bg-brand-sidebar/50 px-2 py-0.5 border border-brand-border text-[10px] font-bold font-mono';

function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normContaCode(code: string): string {
  return code.replace(/[^\d]/g, '').trim();
}

function reduzidoKeyVariants(reduzido: string): string[] {
  const keys = new Set<string>();
  const r = reduzido.trim();
  if (!r) return [];
  keys.add(r);
  keys.add(normContaCode(r));
  const asInt = String(parseInt(normContaCode(r) || r, 10));
  if (asInt && Number.isFinite(Number(asInt))) keys.add(asInt);
  // Domínio 7 dígitos com zero à esquerda
  if (/^\d{1,7}$/.test(asInt)) keys.add(asInt.padStart(7, '0'));
  return [...keys].filter(Boolean);
}

/** Valor usado na conciliação: CÓDIGO REDUZIDO (nunca classificação). */
export function contaValueForConciliacao(p: ExtratoPlanoContaOption): string {
  return sanitizeCodigoReduzido(p.codigoReduzido) || '';
}

/** Mapa código (reduzido/classificação) → nome da conta no plano. */
export function buildPlanoNomeLookup(
  options: ExtratoPlanoContaOption[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of options) {
    const reduzido = sanitizeCodigoReduzido(p.codigoReduzido);
    const code = p.code.trim();
    const name = p.name.trim() || code || reduzido || '';
    if (!name) continue;
    if (reduzido) {
      for (const k of reduzidoKeyVariants(reduzido)) map.set(k, name);
    }
    if (code) {
      if (!map.has(code)) map.set(code, name);
      const norm = normContaCode(code);
      if (norm && !map.has(norm)) map.set(norm, name);
    }
  }
  return map;
}

function findContaNoPlano(
  code: string,
  plano: ExtratoPlanoContaOption[],
): ExtratoPlanoContaOption | undefined {
  const c = code.trim();
  if (!c || !plano.length) return undefined;
  const digits = normContaCode(c);

  const byReduzido = plano.find((p) => {
    const red = sanitizeCodigoReduzido(p.codigoReduzido);
    return Boolean(red && (sameCodigoReduzido(red, c) || sameCodigoReduzido(red, digits)));
  });
  if (byReduzido) return byReduzido;

  const byCode = plano.find((p) => {
    const codeP = p.code.trim();
    return codeP === c || normContaCode(codeP) === digits;
  });
  if (byCode) return byCode;

  const index = buildPlanoCodeIndex(plano);
  const canon = canonizarContaPlano(c, index) || normalizeExtratoContaParaGravacao(c, plano);
  if (!canon) return undefined;
  const byCanonReduzido = plano.find((p) => {
    const red = sanitizeCodigoReduzido(p.codigoReduzido);
    return Boolean(red && sameCodigoReduzido(red, canon));
  });
  if (byCanonReduzido) return byCanonReduzido;
  return plano.find((p) => {
    const codeP = p.code.trim();
    return codeP === canon || normContaCode(codeP) === normContaCode(canon);
  });
}

function contaDisplayLabel(conta: ExtratoPlanoContaOption): string {
  return conta.name.trim() || conta.code.trim() || sanitizeCodigoReduzido(conta.codigoReduzido) || '';
}

/**
 * Resolve o NOME da conta a partir do código (reduzido ou classificação).
 * Sempre tenta o plano completo — nunca deixa DESC. DÉBITO/CRÉDITO em branco se a conta existir.
 */
export function resolveContaNome(
  lookup: Map<string, string>,
  code: string,
  plano?: ExtratoPlanoContaOption[],
): string {
  const c = code.trim();
  if (!c) return '';

  if (plano?.length) {
    const hit = findContaNoPlano(c, plano);
    if (hit) return contaDisplayLabel(hit);
  }

  for (const k of reduzidoKeyVariants(c)) {
    const hit = lookup.get(k);
    if (hit) return hit;
  }
  const byClassif = lookup.get(c) ?? lookup.get(normContaCode(c)) ?? '';
  if (byClassif) return byClassif;

  if (plano?.length) {
    const index = buildPlanoCodeIndex(plano);
    const canon =
      canonizarContaPlano(c, index) ||
      normalizeExtratoContaParaGravacao(c, plano) ||
      c;

    for (const k of reduzidoKeyVariants(canon)) {
      const byRed = lookup.get(k);
      if (byRed) return byRed;
    }
  }

  if (plano?.length) {
    const red = normalizeExtratoContaParaGravacao(c, plano);
    if (red) {
      for (const k of reduzidoKeyVariants(red)) {
        const byRed = lookup.get(k);
        if (byRed) return byRed;
      }
      const hitRed = findContaNoPlano(red, plano);
      if (hitRed) return contaDisplayLabel(hitRed);
    }
    const hit = findContaNoPlano(c, plano);
    if (hit) return contaDisplayLabel(hit);
  }

  return '';
}

export function dedupePlanoOptions(options: ExtratoPlanoContaOption[]): ExtratoPlanoContaOption[] {
  const seen = new Set<string>();
  const out: ExtratoPlanoContaOption[] = [];
  for (const p of options) {
    const key = contaValueForConciliacao(p) || p.code.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ code: p.code, name: p.name, codigoReduzido: p.codigoReduzido });
  }
  return out;
}

function filterPlanoOptions(options: ExtratoPlanoContaOption[], query: string): ExtratoPlanoContaOption[] {
  const q = normalizeSearch(query.trim());
  const withReduzido = options.filter((p) => Boolean(sanitizeCodigoReduzido(p.codigoReduzido)));
  const source = withReduzido.length > 0 ? withReduzido : options;
  if (!q) return source;
  // Busca por palavras (qualquer ordem) na descrição, além de código/reduzido — mostra
  // TODAS as contas que baterem, sem limite, para nunca esconder uma conta que existe.
  const tokens = q.split(/\s+/).filter(Boolean);
  const out: ExtratoPlanoContaOption[] = [];
  for (const p of source) {
    const red = sanitizeCodigoReduzido(p.codigoReduzido) || '';
    const name = normalizeSearch(p.name);
    const nameHit = tokens.length > 0 ? tokens.every((t) => name.includes(t)) : name.includes(q);
    if (normalizeSearch(red).includes(q) || normalizeSearch(p.code).includes(q) || nameHit) {
      out.push(p);
    }
  }
  return out;
}

function isContaSintetica(p: ExtratoPlanoContaOption): boolean {
  if (p.tipo === 'S') return true;
  if (p.tipo === 'A') return false;
  return !sanitizeCodigoReduzido(p.codigoReduzido);
}

function classifDepth(code: string): number {
  return code.trim().split('.').filter(Boolean).length;
}

function isClassifDescendant(ancestor: string, descendant: string): boolean {
  const a = ancestor.trim();
  const d = descendant.trim();
  if (!a || !d || a === d) return false;
  return d.startsWith(`${a}.`);
}

function isClassifAncestor(ancestor: string, descendant: string): boolean {
  return isClassifDescendant(ancestor, descendant);
}

function rowMatchesQuery(p: ExtratoPlanoContaOption, q: string): boolean {
  const red = sanitizeCodigoReduzido(p.codigoReduzido) || '';
  const name = normalizeSearch(p.name);
  const tokens = q.split(/\s+/).filter(Boolean);
  const nameHit = tokens.length > 0 ? tokens.every((t) => name.includes(t)) : name.includes(q);
  return (
    normalizeSearch(red).includes(q) ||
    normalizeSearch(p.code).includes(q) ||
    nameHit ||
    (p.group ? normalizeSearch(p.group).includes(q) : false)
  );
}

function collectAnaliticasFilhas(
  sorted: ExtratoPlanoContaOption[],
  sintetica: ExtratoPlanoContaOption,
): ExtratoPlanoContaOption[] {
  const prefix = sintetica.code.trim();
  const out: ExtratoPlanoContaOption[] = [];
  for (const child of sorted) {
    if (isContaSintetica(child)) continue;
    if (!sanitizeCodigoReduzido(child.codigoReduzido)) continue;
    const childCode = child.code.trim();
    if (childCode === prefix || isClassifDescendant(prefix, childCode)) {
      out.push(child);
    }
  }
  return out;
}

/** Lista em ordem do plano: sintéticas (referência) + analíticas selecionáveis por código reduzido. */
function filterPlanoComSinteticas(
  options: ExtratoPlanoContaOption[],
  query: string,
): ExtratoPlanoContaOption[] {
  const q = normalizeSearch(query.trim());
  const sorted = [...options].sort((a, b) =>
    a.code.localeCompare(b.code, 'pt-BR', { numeric: true }),
  );

  if (!q) {
    const out: ExtratoPlanoContaOption[] = [];
    for (const p of sorted) {
      if (isContaSintetica(p)) {
        out.push(p);
      } else if (sanitizeCodigoReduzido(p.codigoReduzido)) {
        out.push(p);
      }
    }
    return out;
  }

  const directMatches = new Set<string>();
  for (const p of sorted) {
    if (rowMatchesQuery(p, q)) directMatches.add(p.code.trim());
  }

  const matchedCodes = new Set<string>(directMatches);

  for (const code of directMatches) {
    const p = sorted.find((x) => x.code.trim() === code);
    if (!p) continue;

    if (isContaSintetica(p)) {
      for (const child of collectAnaliticasFilhas(sorted, p)) {
        matchedCodes.add(child.code.trim());
      }
    } else {
      for (const s of sorted) {
        if (isContaSintetica(s) && isClassifAncestor(s.code, p.code)) {
          matchedCodes.add(s.code.trim());
        }
      }
    }
  }

  const out: ExtratoPlanoContaOption[] = [];
  for (const p of sorted) {
    if (!matchedCodes.has(p.code.trim())) continue;
    if (!isContaSintetica(p) && !sanitizeCodigoReduzido(p.codigoReduzido)) continue;
    out.push(p);
  }
  return out;
}

type ExtratoContaPickerProps = {
  value: string;
  options: ExtratoPlanoContaOption[];
  /** Plano ampliado só para resolver o nome da conta (ex.: plano completo). */
  lookupOptions?: ExtratoPlanoContaOption[];
  inputId?: string;
  inputName?: string;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  /** Metade do campo para código e metade para o nome da conta no plano. */
  showNomeInline?: boolean;
  /** Exibe grupos sintéticos na lista (referência de hierarquia); seleção só em analíticas. */
  includeSinteticas?: boolean;
  onChange: (code: string) => void;
  bgWhite?: boolean;
};

type HorizontalDragTextProps = {
  text: string;
  title?: string;
  dimmed?: boolean;
  bgWhite?: boolean;
};

function HorizontalDragText({ text, title, dimmed = false, bgWhite = false }: HorizontalDragTextProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ active: boolean; startX: number; startScrollLeft: number }>({
    active: false,
    startX: 0,
    startScrollLeft: 0,
  });

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startScrollLeft: el.scrollLeft,
    };
    el.setPointerCapture?.(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    const drag = dragRef.current;
    if (!el || !drag.active) return;
    el.scrollLeft = drag.startScrollLeft - (e.clientX - drag.startX);
  }, []);

  const finishDrag = useCallback((e?: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current.active = false;
    if (e && scrollRef.current?.hasPointerCapture?.(e.pointerId)) {
      scrollRef.current.releasePointerCapture(e.pointerId);
    }
  }, []);

  return (
    <div
      ref={scrollRef}
      className={cn(
        'min-w-0 h-[26px] overflow-x-auto overflow-y-hidden whitespace-nowrap border border-brand-border/30 px-2 text-[9px] uppercase leading-[24px] cursor-grab active:cursor-grabbing [scrollbar-width:none] [-ms-overflow-style:none]',
        bgWhite ? 'bg-white' : 'bg-brand-sidebar/20',
        dimmed ? 'text-brand-text/70' : 'text-brand-text/80',
      )}
      title={title}
      aria-label="Descrição da conta"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onPointerLeave={(e) => {
        if (dragRef.current.active) finishDrag(e);
      }}
    >
      <div className="inline-block min-w-full select-none">{text || '—'}</div>
    </div>
  );
}

export default memo(function ExtratoContaPicker({
  value,
  options,
  lookupOptions,
  inputId,
  inputName,
  placeholder,
  ariaLabel,
  className,
  showNomeInline = false,
  includeSinteticas = false,
  onChange,
  bgWhite = false,
}: ExtratoContaPickerProps) {
  const autoInputId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  /** Digitação local — só grava no pai no blur / Enter / escolha da lista. */
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const focusedRef = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const resolvedInputId = inputId ?? autoInputId.replace(/:/g, '-');
  const resolvedInputName = inputName ?? `${resolvedInputId}-value`;
  const resolvedSearchId = `${resolvedInputId}-search`;
  const resolvedSearchName = `${resolvedInputName}-search`;

  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(value);
      draftRef.current = value;
    }
  }, [value]);

  const nomePlano = lookupOptions ?? options;

  const commit = useCallback(
    (code: string) => {
      const raw = code.trim();
      if (!raw) {
        draftRef.current = '';
        setDraft('');
        if (value.trim()) onChange('');
        return;
      }
      const planoCommit = nomePlano.length > 0 ? nomePlano : options;
      const hit = findContaNoPlano(raw, planoCommit);
      if (hit && isContaSintetica(hit)) return;
      const next =
        normalizeExtratoContaParaGravacao(raw, planoCommit) ||
        sanitizeCodigoReduzido(raw) ||
        '';
      if (!next) return;
      if (hit && !sanitizeCodigoReduzido(hit.codigoReduzido) && hit.code.includes('.')) return;
      draftRef.current = next;
      setDraft(next);
      if (next !== value.trim()) onChange(next);
    },
    [onChange, nomePlano, options, value],
  );

  const displayOptions = includeSinteticas && nomePlano.length > 0 ? nomePlano : options;
  const filtered = useMemo(
    () =>
      includeSinteticas
        ? filterPlanoComSinteticas(displayOptions, query)
        : filterPlanoOptions(options, query),
    [displayOptions, includeSinteticas, options, query],
  );
  const nomeLookup = useMemo(() => buildPlanoNomeLookup(nomePlano), [nomePlano]);
  const contaNome = useMemo(
    () => resolveContaNome(nomeLookup, draft.trim() || value.trim(), nomePlano),
    [draft, nomeLookup, nomePlano, value],
  );
  const contaGrupoSintetico = useMemo(() => {
    if (!includeSinteticas) return '';
    const hit = findContaNoPlano(draft.trim() || value.trim(), nomePlano);
    const code = hit?.code?.trim();
    if (!code || !code.includes('.')) return '';
    const parts = code.split('.');
    for (let d = parts.length - 1; d >= 1; d--) {
      const prefix = parts.slice(0, d).join('.');
      const syn = nomePlano.find((p) => p.code.trim() === prefix && isContaSintetica(p));
      if (syn) return `${syn.code} — ${syn.name}`;
    }
    return '';
  }, [draft, includeSinteticas, nomePlano, value]);

  const contaNomeTitle = contaGrupoSintetico
    ? `${contaGrupoSintetico} › ${contaNome || ''}`
    : contaNome || undefined;

  const updatePos = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    // Horizontal: align to input left, but clamp so panel doesn't overflow viewport edge.
    let left = rect.left;
    if (left + PANEL_W_PX > window.innerWidth - 8) left = window.innerWidth - PANEL_W_PX - 8;

    // Vertical: prefer opening ABOVE the input when there is more space above than below,
    // or when there isn't enough room below. This keeps the panel away from the rules list
    // that sits beneath the picker inside the modal.
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const fitsBelow  = spaceBelow >= PANEL_H_PX;
    const fitsAbove  = spaceAbove >= PANEL_H_PX;

    let top: number;
    if (fitsAbove && (!fitsBelow || spaceAbove >= spaceBelow)) {
      // Open above the input
      top = rect.top - PANEL_H_PX - 4;
    } else if (fitsBelow) {
      // Open below the input
      top = rect.bottom + 4;
    } else {
      // Neither fits cleanly — pick whichever side has more room and clamp
      if (spaceAbove >= spaceBelow) {
        top = Math.max(8, rect.top - PANEL_H_PX - 4);
      } else {
        top = rect.bottom + 4;
      }
    }

    setPos({ top, left: Math.max(8, left) });
  }, []);

  const openPanel = useCallback(() => {
    updatePos();
    setQuery('');
    setOpen(true);
  }, [updatePos]);

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
    open && options.length > 0
      ? createPortal(
          <DynamicStyleDiv
            ref={panelRef}
            className="fixed z-[9999] border-2 border-brand-border bg-white shadow-[4px_4px_0_0_#141414] flex flex-col overflow-hidden w-[360px] h-[280px]"
            layout={{ top: pos.top, left: pos.left }}
            layoutDeps={[pos.top, pos.left]}
          >
            <div className="p-1.5 border-b border-brand-border flex items-center gap-1 shrink-0 bg-brand-sidebar">
              <Search size={11} className="text-brand-text/70 shrink-0" aria-hidden />
              <input
                ref={searchRef}
                id={resolvedSearchId}
                name={resolvedSearchName}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar código reduzido ou nome..."
                className="w-full bg-transparent text-[10px] font-mono font-semibold text-brand-text outline-none placeholder:text-brand-text/45"
                aria-label="Buscar conta no plano"
              />
            </div>
            {includeSinteticas ? (
              <div
                className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 px-2 py-1 border-b border-brand-border bg-brand-sidebar/90 shrink-0 text-[7px] font-black uppercase tracking-wide text-brand-text/50"
                aria-hidden
              >
                <span>Cód. reduzido</span>
                <span>Descrição da conta</span>
              </div>
            ) : null}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-white">
              {filtered.length === 0 ? (
                <p className="p-3 text-[10px] text-brand-text/60 uppercase text-center font-semibold">
                  Nenhuma conta encontrada
                </p>
              ) : (
                filtered.map((p, i) => {
                  const red = contaValueForConciliacao(p);
                  const sintetica = isContaSintetica(p);
                  const depth = classifDepth(p.code);
                  const indentPx = Math.min(depth, 6) * 6;
                  const rowPad = { paddingLeft: 8 + indentPx, paddingRight: 8 };

                  if (sintetica) {
                    return (
                      <div
                        key={`s-${p.code}-${i}`}
                        role="presentation"
                        aria-disabled
                        className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 py-1.5 border-b border-brand-border/50 bg-brand-sidebar/80 cursor-default select-none items-start"
                        style={rowPad}
                      >
                        <div className="text-[9px] font-mono font-black text-brand-text/50 tabular-nums leading-tight">
                          —
                        </div>
                        <div className="min-w-0">
                          <div className="text-[9px] font-black font-mono leading-tight text-brand-text/85">
                            {p.code}
                            <span className="ml-1 text-[7px] uppercase tracking-wide text-amber-700/80">
                              sintética
                            </span>
                            {p.group ? (
                              <span className="ml-1 text-[7px] font-bold uppercase text-brand-text/60">
                                {p.group}
                              </span>
                            ) : null}
                          </div>
                          <div className="text-[9px] font-black uppercase truncate text-brand-text/80 leading-tight">
                            {p.name}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  if (!red) return null;

                  return (
                    <button
                      key={`${red}-${i}`}
                      type="button"
                      className={cn(
                        'w-full grid grid-cols-[72px_minmax(0,1fr)] gap-2 py-1.5 border-b border-brand-border/40 transition-colors text-left items-start',
                        value === red
                          ? 'bg-brand-text text-white'
                          : 'bg-white text-brand-text hover:bg-brand-sidebar',
                      )}
                      style={rowPad}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        commit(red);
                        setOpen(false);
                        inputRef.current?.blur();
                      }}
                    >
                      <div className="text-[11px] font-black font-mono leading-tight tabular-nums">
                        {red}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[9px] font-semibold uppercase truncate leading-tight opacity-90">
                          {p.name}
                        </div>
                        {p.code.includes('.') ? (
                          <div className="text-[7px] font-mono truncate opacity-60">{p.code}</div>
                        ) : null}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
            {includeSinteticas ? (
              <p className="text-[7px] px-2 py-1 border-t border-brand-border text-brand-text/50 text-center shrink-0 bg-brand-sidebar font-semibold leading-snug">
                Sintéticas são só referência — selecione contas analíticas (com código reduzido).
              </p>
            ) : null}
            {(includeSinteticas ? displayOptions.length : options.length) > FILTER_LIMIT && !query.trim() && (
              <p className="text-[8px] px-2 py-1 border-t border-brand-border text-brand-text/55 text-center shrink-0 bg-brand-sidebar font-semibold">
                {includeSinteticas
                  ? `${displayOptions.length.toLocaleString('pt-BR')} contas — digite para buscar`
                  : `${options.length.toLocaleString('pt-BR')} contas — digite para filtrar`}
              </p>
            )}
          </DynamicStyleDiv>,
          document.body,
        )
      : null;

  const inputHandlers = {
    onFocus: () => {
      focusedRef.current = true;
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      draftRef.current = e.target.value;
      setDraft(e.target.value);
    },
    onBlur: () => {
      focusedRef.current = false;
      commit(draftRef.current);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit(draftRef.current);
        e.currentTarget.blur();
      }
      if (e.key === 'Escape') {
        draftRef.current = value;
        setDraft(value);
        setOpen(false);
        e.currentTarget.blur();
      }
    },
  };

  if (options.length === 0) {
    if (showNomeInline) {
      return (
        <div className={cn('grid grid-cols-[minmax(72px,1fr)_minmax(0,2fr)] gap-1 w-full min-w-0', className)}>
          <input
            id={resolvedInputId}
            name={resolvedInputName}
            type="text"
            className={cn(INPUT_CLS, bgWhite && 'bg-white')}
            value={draft}
            placeholder={placeholder ?? 'Código…'}
            aria-label={ariaLabel}
            {...inputHandlers}
          />
          <HorizontalDragText text={contaNome || '—'} title={contaNomeTitle} dimmed bgWhite={bgWhite} />
        </div>
      );
    }
    return (
      <input
        id={resolvedInputId}
        name={resolvedInputName}
        type="text"
        className={cn(INPUT_CLS, bgWhite && 'bg-white')}
        value={draft}
        placeholder={placeholder ?? 'Código reduzido…'}
        aria-label={ariaLabel}
        {...inputHandlers}
      />
    );
  }

  const codeField = (
    <div className={cn('flex items-stretch gap-0.5 min-w-0', showNomeInline ? 'w-full' : 'w-full')}>
      <input
        ref={inputRef}
        id={resolvedInputId}
        name={resolvedInputName}
        type="text"
        className={cn(INPUT_CLS, 'flex-1 min-w-0', bgWhite && 'bg-white')}
        value={draft}
        placeholder={placeholder ?? 'Código reduzido (não use classificação)…'}
        aria-label={ariaLabel}
        {...inputHandlers}
      />
      <button
        type="button"
        tabIndex={-1}
        className={cn(
          "shrink-0 px-1 border border-brand-border/20 hover:bg-brand-sidebar/80",
          bgWhite ? "bg-white" : "bg-brand-sidebar/50"
        )}
        aria-label="Abrir lista de contas"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? setOpen(false) : openPanel())}
      >
        <ChevronDown size={10} aria-hidden />
      </button>
    </div>
  );

  if (showNomeInline) {
    return (
      <div ref={wrapRef} className={cn('grid grid-cols-[minmax(72px,1fr)_minmax(0,2fr)] gap-1 w-full min-w-0', className)}>
        {codeField}
        <HorizontalDragText text={contaNome || '—'} title={contaNomeTitle} bgWhite={bgWhite} />
        {panel}
      </div>
    );
  }

  return (
    <div ref={wrapRef} className={cn('flex items-stretch gap-0.5 w-full min-w-0', className)}>
      {codeField}
      {panel}
    </div>
  );
});
