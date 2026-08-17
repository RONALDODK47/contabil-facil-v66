import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { cn } from '../lib/utils';

type SidebarInfoHintProps = {
  /** Texto para leitores de tela / `aria-label`. */
  label: string;
  children: ReactNode;
  className?: string;
  /** Alinhar o painel à direita do botão (útil no fim de linhas). */
  align?: 'left' | 'right';
  /** Largura máxima do painel em px (padrão 320). */
  panelMaxWidthPx?: number;
  /** Classes extras no painel (ex.: altura máx. e scroll). */
  panelClassName?: string;
};

type PopoverPos = { top: number; left: number; width: number };

/**
 * Botão (i) ao lado de rótulos: ao clicar, abre um popover com o texto de ajuda.
 * O popover é renderizado em portal (no `body`) para evitar corte por containers
 * com `overflow-hidden`. Clicar fora fecha; ESC também fecha.
 */
export function SidebarInfoHint({
  label,
  children,
  className,
  align = 'left',
  panelMaxWidthPx,
  panelClassName,
}: SidebarInfoHintProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PopoverPos | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const computePos = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const cap = panelMaxWidthPx ?? 320;
    const maxWidth = Math.min(cap, vw - margin * 2);
    let left = align === 'right' ? rect.right - maxWidth : rect.left;
    if (left + maxWidth > vw - margin) left = vw - margin - maxWidth;
    if (left < margin) left = margin;
    setPos({ top: rect.bottom + 6, left, width: maxWidth });
  }, [align, panelMaxWidthPx]);

  useLayoutEffect(() => {
    if (!open) return;
    computePos();
  }, [open, computePos]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onScrollOrResize = () => computePos();
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open, computePos]);

  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open ? 'true' : 'false'}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-600 bg-slate-900 text-cyan-400 hover:bg-slate-800 hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500"
      >
        <Info className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
      </button>
      {open && pos && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={panelRef}
            role="region"
            aria-label={label}
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
            className={cn(
              'z-[1000] rounded-lg border border-slate-600 bg-slate-950 p-3 text-[11px] leading-snug text-slate-300 shadow-2xl shadow-black/60 normal-case tracking-normal',
              panelClassName
            )}
          >
            {children}
          </div>,
          document.body
        )}
    </span>
  );
}
