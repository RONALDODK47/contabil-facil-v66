import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Command, Search } from 'lucide-react';
import { DynamicStyleDiv } from '../lib/dynamicStyle';
import { cn } from '../lib/utils';

export type AcaoMenuItem = {
  id: string;
  label: string;
  /** Linha de apoio — também entra na busca. */
  descricao?: string;
  /** Contador ao lado do nome (ex.: quantidade de pastas). */
  badge?: string | number;
  icone?: ReactNode;
  /** Sinônimos/termos que o usuário pode digitar (entram na busca). */
  palavras?: string[];
  /** Ação principal — fica destacada no topo do grupo. */
  destaque?: boolean;
  /** Agrupador opcional exibido como cabeçalho na lista. */
  grupo?: string;
  disabled?: boolean;
  /** Por que está desabilitada (mostrado no lugar da descrição). */
  motivoDisabled?: string;
  onSelect: () => void;
};

const PANEL_W_PX = 460;
const PANEL_H_PX = 400;

function normalizar(texto: string): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Todas as letras do termo aparecem na ordem (busca tolerante a abreviação). */
function subsequencia(texto: string, termo: string): boolean {
  let i = 0;
  for (const ch of texto) {
    if (ch === termo[i]) i += 1;
    if (i === termo.length) return true;
  }
  return false;
}

/**
 * Pontua a opção contra o termo digitado. 0 = não serve.
 *
 * A busca é "inteligente" no sentido prático: ignora acento e maiúscula, aceita
 * as palavras em qualquer ordem ("balancete importar" acha "Importar para o
 * balancete"), procura também nos sinônimos e, em último caso, aceita
 * abreviação por subsequência ("pdfcon" acha "PDF conciliado").
 */
export function pontuarAcao(item: AcaoMenuItem, termo: string): number {
  const q = normalizar(termo).trim();
  if (!q) return 1;

  const label = normalizar(item.label);
  const descricao = normalizar(item.descricao ?? '');
  const palavras = (item.palavras ?? []).map(normalizar).join(' ');
  const alvo = `${label} ${descricao} ${palavras}`;

  const termos = q.split(/\s+/).filter(Boolean);
  // Todo termo digitado precisa aparecer em algum lugar da opção.
  const todosPresentes = termos.every((t) => alvo.includes(t));

  if (todosPresentes) {
    if (label === q) return 1000;
    if (label.startsWith(q)) return 900;
    if (new RegExp(`(^|\\s)${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(label)) return 800;
    if (label.includes(q)) return 700;
    if (termos.every((t) => label.includes(t))) return 600;
    if (descricao.includes(q)) return 500;
    if (palavras.includes(q)) return 450;
    return 400;
  }

  // Abreviação: "impbal" → "importar para o balancete"
  if (termos.length === 1 && q.length >= 3 && subsequencia(label.replace(/\s+/g, ''), q)) {
    return 200;
  }
  return 0;
}

export function filtrarAcoes(itens: AcaoMenuItem[], termo: string): AcaoMenuItem[] {
  return itens
    .map((item, ordem) => ({ item, ordem, score: pontuarAcao(item, termo) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.ordem - b.ordem)
    .map((r) => r.item);
}

type Props = {
  itens: AcaoMenuItem[];
  label?: string;
  buttonId?: string;
  className?: string;
};

export default memo(function AcoesCommandMenu({
  itens,
  label = 'Ações',
  buttonId,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [ativo, setAtivo] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const filtrados = useMemo(() => filtrarAcoes(itens, query), [itens, query]);
  const disponiveis = useMemo(() => itens.filter((i) => !i.disabled).length, [itens]);

  const updatePos = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = rect.right - PANEL_W_PX;
    let top = rect.bottom + 4;
    if (left + PANEL_W_PX > window.innerWidth - 8) left = window.innerWidth - PANEL_W_PX - 8;
    if (top + PANEL_H_PX > window.innerHeight - 8) top = Math.max(8, rect.top - PANEL_H_PX - 4);
    setPos({ top, left: Math.max(8, left) });
  }, []);

  const abrir = useCallback(() => {
    updatePos();
    setQuery('');
    setAtivo(0);
    setOpen(true);
  }, [updatePos]);

  const executar = useCallback((item: AcaoMenuItem) => {
    if (item.disabled) return;
    setOpen(false);
    item.onSelect();
  }, []);

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

  useEffect(() => {
    setAtivo(0);
  }, [query]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (filtrados.length === 0) return;
        const passo = e.key === 'ArrowDown' ? 1 : -1;
        setAtivo((cur) => (cur + passo + filtrados.length) % filtrados.length);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const alvo = filtrados[ativo];
        if (alvo) executar(alvo);
      }
    },
    [ativo, executar, filtrados],
  );

  const panel = open
    ? createPortal(
        <DynamicStyleDiv
          ref={panelRef}
          className="fixed z-[9999] border-2 border-brand-border bg-white shadow-[4px_4px_0_0_#141414] flex flex-col overflow-hidden w-[460px] max-w-[calc(100vw-16px)] h-[400px] max-h-[calc(100vh-16px)]"
          layout={{ top: pos.top, left: pos.left }}
          layoutDeps={[pos.top, pos.left]}
        >
          <div className="p-1.5 border-b border-brand-border flex items-center gap-1 shrink-0 bg-brand-sidebar">
            <Search size={12} className="text-brand-text/70 shrink-0" aria-hidden />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Buscar ação… (ex.: pdf, balancete, regras, pastas)"
              className="w-full bg-transparent text-[10px] font-semibold text-brand-text outline-none placeholder:text-brand-text/45"
              aria-label="Buscar ação da conciliação"
              role="combobox"
              aria-expanded
              aria-controls="acoes-command-lista"
            />
          </div>
          <div
            id="acoes-command-lista"
            role="listbox"
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-white"
          >
            {filtrados.length === 0 ? (
              <p className="p-4 text-[10px] text-brand-text/60 uppercase text-center font-semibold">
                Nenhuma ação encontrada
              </p>
            ) : (
              filtrados.map((item, i) => {
                const selecionado = i === ativo;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={selecionado}
                    disabled={item.disabled}
                    onMouseEnter={() => setAtivo(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => executar(item)}
                    className={cn(
                      'w-full text-left px-2 py-2 border-b border-brand-border/40 flex items-start gap-2 transition-colors',
                      item.disabled && 'opacity-45 cursor-not-allowed',
                      selecionado && !item.disabled
                        ? 'bg-brand-text text-white'
                        : 'bg-white text-brand-text',
                    )}
                  >
                    <span className="shrink-0 mt-[1px]">{item.icone}</span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-black uppercase leading-snug">
                          {item.label}
                        </span>
                        {item.badge !== undefined && item.badge !== '' ? (
                          <span
                            className={cn(
                              'text-[8px] font-black px-1 py-0.5 border tabular-nums',
                              selecionado
                                ? 'border-white/40 text-white'
                                : 'border-brand-border/50 text-brand-text/60',
                            )}
                          >
                            {item.badge}
                          </span>
                        ) : null}
                        {item.destaque ? (
                          <span
                            className={cn(
                              'text-[7px] font-black uppercase px-1 py-0.5',
                              selecionado ? 'bg-white text-brand-text' : 'bg-brand-text text-white',
                            )}
                          >
                            principal
                          </span>
                        ) : null}
                      </span>
                      {item.disabled && item.motivoDisabled ? (
                        <span className="block text-[8px] leading-snug mt-0.5 text-amber-700 font-semibold uppercase">
                          {item.motivoDisabled}
                        </span>
                      ) : item.descricao ? (
                        <span
                          className={cn(
                            'block text-[8px] leading-snug mt-0.5',
                            selecionado ? 'text-white/75' : 'text-brand-text/55',
                          )}
                        >
                          {item.descricao}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          <p className="text-[8px] px-2 py-1 border-t border-brand-border text-brand-text/55 text-center shrink-0 bg-brand-sidebar font-semibold uppercase">
            ↑↓ navegar · Enter executar · Esc fechar
          </p>
        </DynamicStyleDiv>,
        document.body,
      )
    : null;

  return (
    <div ref={wrapRef} className={cn('inline-flex', className)}>
      <button
        id={buttonId}
        type="button"
        onClick={() => (open ? setOpen(false) : abrir())}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="technical-button text-[9px] py-1 px-2 inline-flex items-center gap-1"
        title="Todas as ações da conciliação — com busca"
      >
        <Command size={11} aria-hidden="true" />
        {label}
        <span className="text-[8px] opacity-70 tabular-nums">({disponiveis})</span>
        <ChevronDown size={10} aria-hidden="true" />
      </button>
      {panel}
    </div>
  );
});
