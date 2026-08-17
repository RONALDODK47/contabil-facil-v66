import { createElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

export const DEFAULT_ROW_HEIGHT_PX = 36;
export const DEFAULT_OVERSCAN = 10;
/** Extrato com pickers pesados: virtualiza cedo para não montar dezenas de linhas. */
export const DEFAULT_VIRTUAL_THRESHOLD = 24;

export interface VirtualWindow {
  startIndex: number;
  endIndex: number;
  paddingTop: number;
  paddingBottom: number;
  useVirtual: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  resetScroll: () => void;
}

/** Windowing estilo Power BI: só renderiza linhas visíveis + overscan. */
export function useVirtualWindow(
  totalRows: number,
  options?: {
    rowHeightPx?: number;
    overscan?: number;
    threshold?: number;
    resetKey?: string | number;
  },
): VirtualWindow {
  const rowHeightPx = options?.rowHeightPx ?? DEFAULT_ROW_HEIGHT_PX;
  const overscan = options?.overscan ?? DEFAULT_OVERSCAN;
  const threshold = options?.threshold ?? DEFAULT_VIRTUAL_THRESHOLD;
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setScrollTop(0);
  }, [options?.resetKey, totalRows]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewportHeight(el.clientHeight || 480);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [totalRows]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      setScrollTop(el.scrollTop);
    });
  }, []);

  const resetScroll = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setScrollTop(0);
  }, []);

  const { startIndex, endIndex, paddingTop, paddingBottom } = useMemo(() => {
    if (totalRows <= 0) {
      return { startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0 };
    }
    const start = Math.max(0, Math.floor(scrollTop / rowHeightPx) - overscan);
    const visible = Math.ceil(viewportHeight / rowHeightPx) + overscan * 2;
    const end = Math.min(totalRows, start + visible);
    return {
      startIndex: start,
      endIndex: end,
      paddingTop: start * rowHeightPx,
      paddingBottom: Math.max(0, (totalRows - end) * rowHeightPx),
    };
  }, [totalRows, scrollTop, viewportHeight, rowHeightPx, overscan]);

  return {
    startIndex,
    endIndex,
    paddingTop,
    paddingBottom,
    useVirtual: totalRows > threshold,
    scrollRef,
    onScroll,
    resetScroll,
  };
}

export function VirtualSpacerRow({ colSpan, height }: { colSpan: number; height: number }) {
  const ref = useRef<HTMLTableCellElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = `${height}px`;
    el.style.padding = '0';
    el.style.border = 'none';
  }, [height]);
  if (height <= 0) return null;
  return createElement(
    'tr',
    { 'aria-hidden': true, className: 'virtual-table-spacer' },
    createElement('td', { ref, colSpan, className: 'p-0 border-0' }),
  );
}
