import { useCallback, useEffect, useRef, useState } from 'react';

export interface ChartMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_MARGINS: ChartMargins = { top: 8, right: 8, bottom: 28, left: 48 };

export function setupHiDpiCanvas(canvas: HTMLCanvasElement, cssW: number, cssH: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.floor(cssW * dpr));
  canvas.height = Math.max(1, Math.floor(cssH * dpr));
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (min === max) return [min];
  const range = max - min;
  const step = Math.pow(10, Math.floor(Math.log10(range / count)));
  const err = (range / count) / step;
  const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
  const tickStep = step * mult;
  const lo = Math.floor(min / tickStep) * tickStep;
  const hi = Math.ceil(max / tickStep) * tickStep;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + tickStep * 0.5; v += tickStep) ticks.push(v);
  return ticks;
}

export function chartPlotSize(width: number, height: number, margins: ChartMargins) {
  return {
    x: margins.left,
    y: margins.top,
    w: Math.max(1, width - margins.left - margins.right),
    h: Math.max(1, height - margins.top - margins.bottom),
  };
}

export function valueToY(val: number, min: number, max: number, plotY: number, plotH: number) {
  if (max === min) return plotY + plotH / 2;
  return plotY + plotH - ((val - min) / (max - min)) * plotH;
}

export function indexToX(index: number, count: number, plotX: number, plotW: number) {
  if (count <= 1) return plotX + plotW / 2;
  return plotX + (index / (count - 1)) * plotW;
}

export function drawHorizontalGrid(
  ctx: CanvasRenderingContext2D,
  ticks: number[],
  min: number,
  max: number,
  plotX: number,
  plotY: number,
  plotW: number,
  plotH: number,
  color: string,
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  for (const t of ticks) {
    const y = valueToY(t, min, max, plotY, plotH);
    ctx.beginPath();
    ctx.moveTo(plotX, y);
    ctx.lineTo(plotX + plotW, y);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawYAxisLabels(
  ctx: CanvasRenderingContext2D,
  ticks: number[],
  min: number,
  max: number,
  plotX: number,
  plotY: number,
  plotH: number,
  format: (v: number) => string,
  color: string,
  font: string,
) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of ticks) {
    const y = valueToY(t, min, max, plotY, plotH);
    ctx.fillText(format(t), plotX - 6, y);
  }
  ctx.restore();
}

export function drawXAxisLabels(
  ctx: CanvasRenderingContext2D,
  labels: string[],
  plotX: number,
  plotY: number,
  plotW: number,
  plotH: number,
  color: string,
  font: string,
  maxLabels = 12,
) {
  if (labels.length === 0) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const step = Math.max(1, Math.ceil(labels.length / maxLabels));
  for (let i = 0; i < labels.length; i += step) {
    const x = indexToX(i, labels.length, plotX, plotW);
    ctx.fillText(labels[i], x, plotY + plotH + 6);
  }
  ctx.restore();
}

export function hitTestIndex(mouseX: number, count: number, plotX: number, plotW: number): number {
  if (count <= 0) return -1;
  const ratio = (mouseX - plotX) / plotW;
  const idx = Math.round(ratio * (count - 1));
  return Math.max(0, Math.min(count - 1, idx));
}

/** Container + canvas com ResizeObserver — sem animações, leve em PC fraco. */
export function useCanvasChartHost(debounceMs = 200) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoverIndex, setHoverIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.floor(rect.width);
      const h = Math.floor(rect.height);
      if (w > 0 && h > 0) setSize({ width: w, height: h });
    };
    update();
    const ro = new ResizeObserver(() => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(update, debounceMs);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [debounceMs]);

  const onMouseMove = useCallback(
    (count: number, margins: ChartMargins, onIndex: (idx: number) => void) =>
      (ev: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas || count <= 0) return;
        const rect = canvas.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const plot = chartPlotSize(size.width, size.height, margins);
        const idx = hitTestIndex(x, count, plot.x, plot.w);
        setHoverIndex(idx);
        onIndex(idx);
      },
    [size.width, size.height],
  );

  const onMouseLeave = useCallback(() => setHoverIndex(-1), []);

  return { containerRef, canvasRef, size, hoverIndex, onMouseMove, onMouseLeave, setHoverIndex };
}
