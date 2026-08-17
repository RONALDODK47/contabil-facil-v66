import { useLayoutEffect, type RefObject } from 'react';

type LayoutStyle = Partial<
  Record<'width' | 'height' | 'minWidth' | 'minHeight' | 'top' | 'left', string | number>
>;

function toCssValue(value: string | number): string {
  return typeof value === 'number' ? `${value}px` : value;
}

/** Aplica dimensões/posição via DOM (evita `style={{}}` no JSX — Edge Tools no-inline-styles). */
export function useElementLayoutStyle(
  ref: RefObject<HTMLElement | null>,
  style: LayoutStyle,
  deps: unknown[],
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    for (const [key, value] of Object.entries(style) as Array<[keyof LayoutStyle, string | number]>) {
      if (value == null) continue;
      el.style[key] = toCssValue(value);
    }
  }, [ref, ...deps]);
}
