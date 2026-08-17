import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatCurrency } from '../lib/utils';
import {
  chartPlotSize,
  DEFAULT_MARGINS,
  drawHorizontalGrid,
  drawXAxisLabels,
  drawYAxisLabels,
  indexToX,
  niceTicks,
  setupHiDpiCanvas,
  useCanvasChartHost,
  valueToY,
} from '../lib/canvasChartCore';

export interface LoanAmortizationChartProps {
  data: Array<{ name: string; saldo: number; parcela: number }>;
}

export default function LoanAmortizationChart({ data }: LoanAmortizationChartProps) {
  const margins = DEFAULT_MARGINS;
  const { containerRef, canvasRef, size, hoverIndex, onMouseMove, onMouseLeave } = useCanvasChartHost(200);
  const tipRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; visible: boolean }>({ x: 0, y: 0, visible: false });

  const yDomain = useMemo(() => {
    let min = 0;
    let max = 0;
    for (const d of data) {
      min = Math.min(min, d.saldo, d.parcela);
      max = Math.max(max, d.saldo, d.parcela);
    }
    if (max === min) max = min + 1;
    return { min, max };
  }, [data]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width < 2 || size.height < 2 || data.length === 0) return;
    const ctx = setupHiDpiCanvas(canvas, size.width, size.height);
    if (!ctx) return;

    ctx.clearRect(0, 0, size.width, size.height);
    const plot = chartPlotSize(size.width, size.height, margins);
    const ticks = niceTicks(yDomain.min, yDomain.max, 5);

    drawHorizontalGrid(ctx, ticks, yDomain.min, yDomain.max, plot.x, plot.y, plot.w, plot.h, '#14141422');
    drawYAxisLabels(
      ctx,
      ticks,
      yDomain.min,
      yDomain.max,
      plot.x,
      plot.y,
      plot.h,
      (v) => `${v / 1000}k`,
      '#141414',
      '9px JetBrains Mono, monospace',
    );
    drawXAxisLabels(
      ctx,
      data.map((d) => d.name),
      plot.x,
      plot.y,
      plot.w,
      plot.h,
      '#141414',
      '9px JetBrains Mono, monospace',
    );

    // Área saldo (step)
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = indexToX(i, data.length, plot.x, plot.w);
      const y = valueToY(data[i].saldo, yDomain.min, yDomain.max, plot.y, plot.h);
      if (i === 0) ctx.moveTo(x, y);
      else {
        const prevX = indexToX(i - 1, data.length, plot.x, plot.w);
        ctx.lineTo(x, valueToY(data[i - 1].saldo, yDomain.min, yDomain.max, plot.y, plot.h));
        ctx.lineTo(x, y);
      }
    }
    const lastX = indexToX(data.length - 1, data.length, plot.x, plot.w);
    ctx.lineTo(lastX, plot.y + plot.h);
    ctx.lineTo(indexToX(0, data.length, plot.x, plot.w), plot.y + plot.h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(20, 20, 20, 0.1)';
    ctx.fill();
    ctx.restore();

    // Linha saldo (step)
    ctx.save();
    ctx.strokeStyle = '#141414';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = indexToX(i, data.length, plot.x, plot.w);
      const y = valueToY(data[i].saldo, yDomain.min, yDomain.max, plot.y, plot.h);
      if (i === 0) ctx.moveTo(x, y);
      else {
        const prevY = valueToY(data[i - 1].saldo, yDomain.min, yDomain.max, plot.y, plot.h);
        ctx.lineTo(x, prevY);
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.restore();

    // Linha parcela
    ctx.save();
    ctx.strokeStyle = '#2563EB';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = indexToX(i, data.length, plot.x, plot.w);
      const y = valueToY(data[i].parcela, yDomain.min, yDomain.max, plot.y, plot.h);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    if (hoverIndex >= 0 && hoverIndex < data.length) {
      const hx = indexToX(hoverIndex, data.length, plot.x, plot.w);
      ctx.save();
      ctx.strokeStyle = '#14141444';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(hx, plot.y);
      ctx.lineTo(hx, plot.y + plot.h);
      ctx.stroke();
      ctx.restore();
    }
  }, [canvasRef, data, hoverIndex, margins, size.height, size.width, yDomain.max, yDomain.min]);

  useEffect(() => {
    draw();
  }, [draw]);

  const handleMove = onMouseMove(data.length, margins, (idx) => {
    if (idx < 0) {
      setTip((t) => ({ ...t, visible: false }));
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const plot = chartPlotSize(size.width, size.height, margins);
    setTip({
      x: indexToX(idx, data.length, plot.x, plot.w),
      y: plot.y + 8,
      visible: true,
    });
    void rect;
  });

  const hover = hoverIndex >= 0 ? data[hoverIndex] : null;

  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!el) return;
    el.style.left = `${tip.x}px`;
    el.style.top = `${tip.y}px`;
  }, [tip.x, tip.y]);

  return (
    <div ref={containerRef} className="canvas-chart-host w-full h-full min-w-0 relative">
      <canvas
        ref={canvasRef}
        className="block w-full h-full"
        onMouseMove={handleMove}
        onMouseLeave={() => {
          onMouseLeave();
          setTip((t) => ({ ...t, visible: false }));
        }}
      />
      {tip.visible && hover ? (
        <div ref={tipRef} className="canvas-chart-tip-amort">
          <div className="font-bold mb-1">{hover.name}</div>
          <div>Saldo Devedor: {formatCurrency(hover.saldo)}</div>
          <div className="canvas-chart-tip-amort-accent">Prestação: {formatCurrency(hover.parcela)}</div>
        </div>
      ) : null}
    </div>
  );
}
