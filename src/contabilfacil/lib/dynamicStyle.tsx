import {
  forwardRef,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type Ref,
  type RefObject,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';

const UNITLESS = new Set([
  'opacity',
  'zIndex',
  'fontWeight',
  'lineHeight',
  'flex',
  'flexGrow',
  'flexShrink',
  'order',
  'zoom',
]);

function applyLayout(el: HTMLElement, layout: CSSProperties): void {
  for (const [key, value] of Object.entries(layout)) {
    if (value == null || value === '') continue;
    const cssVal =
      typeof value === 'number' && !UNITLESS.has(key) ? `${value}px` : String(value);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- CSSStyleDeclaration index
    (el.style as any)[key] = cssVal;
  }
}

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (node: T) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === 'function') ref(node);
      else (ref as { current: T }).current = node;
    }
  };
}

/** Aplica CSS dinâmico via DOM (evita `style={{}}` no JSX — Edge Tools no-inline-styles). */
export function useDynamicLayoutStyle(
  ref: RefObject<HTMLElement | null>,
  layout: CSSProperties,
  deps: unknown[],
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    applyLayout(el, layout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps explícitos do caller
  }, [ref, ...deps]);
}

type DivProps = HTMLAttributes<HTMLDivElement> & {
  layout: CSSProperties;
  layoutDeps?: unknown[];
};

/** `<div>` com layout dinâmico sem `style` no JSX. */
export const DynamicStyleDiv = forwardRef<HTMLDivElement, DivProps>(
  function DynamicStyleDiv({ layout, layoutDeps, ...rest }, outerRef) {
    const ref = useRef<HTMLDivElement>(null);
    useDynamicLayoutStyle(ref, layout, layoutDeps ?? Object.values(layout));
    return <div ref={mergeRefs(ref, outerRef)} {...rest} />;
  },
);

type TableProps = HTMLAttributes<HTMLTableElement> & {
  layout: CSSProperties;
  layoutDeps?: unknown[];
};

export const DynamicStyleTable = forwardRef<HTMLTableElement, TableProps>(
  function DynamicStyleTable({ layout, layoutDeps, ...rest }, outerRef) {
    const ref = useRef<HTMLTableElement>(null);
    useDynamicLayoutStyle(ref, layout, layoutDeps ?? Object.values(layout));
    return <table ref={mergeRefs(ref, outerRef)} {...rest} />;
  },
);

type ThProps = ThHTMLAttributes<HTMLTableCellElement> & {
  layout: CSSProperties;
  layoutDeps?: unknown[];
};

export const DynamicStyleTh = forwardRef<HTMLTableCellElement, ThProps>(
  function DynamicStyleTh({ layout, layoutDeps, ...rest }, outerRef) {
    const ref = useRef<HTMLTableCellElement>(null);
    useDynamicLayoutStyle(ref, layout, layoutDeps ?? Object.values(layout));
    return <th ref={mergeRefs(ref, outerRef)} {...rest} />;
  },
);

type TdProps = TdHTMLAttributes<HTMLTableCellElement> & {
  layout: CSSProperties;
  layoutDeps?: unknown[];
};

export const DynamicStyleTd = forwardRef<HTMLTableCellElement, TdProps>(
  function DynamicStyleTd({ layout, layoutDeps, ...rest }, outerRef) {
    const ref = useRef<HTMLTableCellElement>(null);
    useDynamicLayoutStyle(ref, layout, layoutDeps ?? Object.values(layout));
    return <td ref={mergeRefs(ref, outerRef)} {...rest} />;
  },
);
