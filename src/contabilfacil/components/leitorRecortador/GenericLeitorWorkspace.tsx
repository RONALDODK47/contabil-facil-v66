/**
 * Workspace genérico do leitor-recortador (N colunas).
 * Espelha a UX do LeitorRecortadorWorkspace do extrato, sem acoplar a date/history/value.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Files, HelpCircle, Layers, Maximize2, Move, RefreshCw } from 'lucide-react';
import { columnBandColor } from '../../../lib/leitorRecortador/columnDefaults';
import { rowIntersectsCropBand } from '../../../lib/leitorRecortador/cropper';
import { PageRangeNumberInput } from './PageRangeNumberInput';
import type { ColumnMapping, ColumnRange, LeitorColumnDef } from '../../../lib/leitorRecortador/types';
import { DynamicStyleDiv } from '../../lib/dynamicStyle';

interface WorkspaceProps {
  canvasElement: HTMLCanvasElement | null;
  columnDefs: LeitorColumnDef[];
  allColumnDefs: LeitorColumnDef[];
  columns: ColumnMapping;
  setColumns: React.Dispatch<React.SetStateAction<ColumnMapping>>;
  detectedRowYs: { y: number; height: number }[];
  isProcessing: boolean;
  onApplyCrop: () => void;
  onApplyCropAll?: () => void;
  docType: 'pdf' | 'image' | 'sample';
  cropStartPct: number;
  setCropStartPct: (pct: number) => void;
  cropEndPct: number;
  setCropEndPct: (pct: number) => void;
  pdfPages?: { pageNumber: number; canvas: HTMLCanvasElement; textItems: unknown[]; width: number; height: number }[];
  currentPage?: number;
  onSelectPage?: (pageNumber: number) => void;
  cropStartPage: number;
  setCropStartPage: (page: number) => void;
  cropEndPage: number;
  setCropEndPage: (page: number) => void;

  // Crop preview gating: user must click "Recortar PDF" before extracting all pages
  cropPreviewApplied?: boolean;
  onCropPreviewToggle?: (applied: boolean) => void;
}

type DragType = 'move' | 'resize-left' | 'resize-right' | 'drag-h-start' | 'drag-h-end' | null;
type DraggedTarget = string | 'h-start' | 'h-end' | null;

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return `rgba(37, 99, 235, ${alpha})`;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function GenericLeitorWorkspace({
  canvasElement,
  columnDefs,
  allColumnDefs,
  columns,
  setColumns,
  detectedRowYs,
  isProcessing,
  onApplyCrop,
  onApplyCropAll,
  docType,
  cropStartPct,
  setCropStartPct,
  cropEndPct,
  setCropEndPct,
  pdfPages = [],
  currentPage = 1,
  onSelectPage,
  cropStartPage,
  setCropStartPage,
  cropEndPage,
  setCropEndPage,
  cropPreviewApplied = false,
  onCropPreviewToggle,
}: WorkspaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasDisplayRef = useRef<HTMLCanvasElement>(null);
  const [draggedCol, setDraggedCol] = useState<DraggedTarget>(null);
  const [dragType, setDragType] = useState<DragType>(null);
  const [startX, setStartX] = useState(0);
  const [startY, setStartY] = useState(0);
  const [startColState, setStartColState] = useState<ColumnRange | null>(null);
  const [startHState, setStartHState] = useState(0);
  const [showGuides, setShowGuides] = useState(true);
  const [isCroppedPDF, setIsCroppedPDF] = useState(cropPreviewApplied);

  useEffect(() => {
    if (!canvasElement || !canvasDisplayRef.current) return;
    const displayCanvas = canvasDisplayRef.current;
    const ctx = displayCanvas.getContext('2d');
    if (!ctx) return;
    const w = canvasElement.width;
    const h = canvasElement.height;
    displayCanvas.width = w;
    displayCanvas.height = h;

    if (isCroppedPDF) {
      ctx.clearRect(0, 0, w, h);

      let syTop = 0;
      let syBot = h;
      if (currentPage === cropStartPage && cropStartPct > 0)
        syTop = Math.round((cropStartPct / 100) * h);
      if (currentPage === cropEndPage && cropEndPct < 100)
        syBot = Math.round((cropEndPct / 100) * h);
      const stripH = Math.max(0, syBot - syTop);
      if (stripH <= 0) return;

      allColumnDefs.forEach((def) => {
        const col = columns[def.id];
        if (!col) return;
        const startX = Math.round((col.startX / 100) * w);
        const width = Math.round((col.width / 100) * w);
        const safeX = Math.max(0, startX);
        const safeW = Math.min(width, w - safeX);
        if (safeW <= 0) return;
        ctx.drawImage(canvasElement, safeX, syTop, safeW, stripH, safeX, syTop, safeW, stripH);
      });
    } else {
      ctx.drawImage(canvasElement, 0, 0);
    }
  }, [canvasElement, isCroppedPDF, columns, allColumnDefs, currentPage, cropStartPage, cropEndPage, cropStartPct, cropEndPct]);

  useEffect(() => {
    setIsCroppedPDF(cropPreviewApplied);
  }, [cropPreviewApplied]);

  const handleMouseDown = (
    e: React.MouseEvent | React.TouchEvent,
    columnKey: string | 'h-start' | 'h-end',
    type: DragType,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const clientX = 'touches' in e ? e.touches[0]!.clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0]!.clientY : e.clientY;
    setDraggedCol(columnKey);
    setDragType(type);
    setStartX(clientX);
    setStartY(clientY);
    if (columnKey === 'h-start') setStartHState(cropStartPct);
    else if (columnKey === 'h-end') setStartHState(cropEndPct);
    else setStartColState(columns[columnKey] ? { ...columns[columnKey]! } : null);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent | TouchEvent) => {
      if (!draggedCol || !dragType || !containerRef.current) return;
      const clientX = 'touches' in e ? e.touches[0]!.clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0]!.clientY : e.clientY;
      const containerRect = containerRef.current.getBoundingClientRect();

      if (draggedCol === 'h-start' || draggedCol === 'h-end') {
        const deltaYPercent = ((clientY - startY) / containerRect.height) * 100;
        const isSamePage = cropStartPage === cropEndPage;
        if (draggedCol === 'h-start') {
          const maxLimit = isSamePage ? cropEndPct - 2 : 100;
          setCropStartPct(Number(Math.max(0, Math.min(maxLimit, startHState + deltaYPercent)).toFixed(2)));
        } else {
          const minLimit = isSamePage ? cropStartPct + 2 : 0;
          setCropEndPct(Number(Math.max(minLimit, Math.min(100, startHState + deltaYPercent)).toFixed(2)));
        }
        return;
      }

      if (!startColState) return;
      const deltaXPercent = ((clientX - startX) / containerRect.width) * 100;
      setColumns((prev) => {
        const col = prev[draggedCol];
        if (!col) return prev;
        let newStartX = col.startX;
        let newWidth = col.width;
        if (dragType === 'move') {
          newStartX = Math.max(0, Math.min(100 - col.width, startColState.startX + deltaXPercent));
        } else if (dragType === 'resize-left') {
          const maxLeft = startColState.startX + startColState.width - 2;
          newStartX = Math.max(0, Math.min(maxLeft, startColState.startX + deltaXPercent));
          newWidth = Math.max(2, startColState.width - (newStartX - startColState.startX));
        } else if (dragType === 'resize-right') {
          newWidth = Math.max(2, Math.min(100 - col.startX, startColState.width + deltaXPercent));
        }
        return {
          ...prev,
          [draggedCol]: {
            startX: Number(newStartX.toFixed(2)),
            width: Number(newWidth.toFixed(2)),
          },
        };
      });
    };

    const handleMouseUp = () => {
      setDraggedCol(null);
      setDragType(null);
      setStartColState(null);
    };

    if (draggedCol) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleMouseMove, { passive: false });
      window.addEventListener('touchend', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleMouseMove);
      window.removeEventListener('touchend', handleMouseUp);
    };
  }, [
    draggedCol,
    dragType,
    startX,
    startY,
    startColState,
    startHState,
    cropStartPct,
    cropEndPct,
    cropStartPage,
    cropEndPage,
    setColumns,
    setCropStartPct,
    setCropEndPct,
  ]);

  return (
    <div className="flex flex-col bg-white border border-brand-border shadow-[2px_2px_0_0_#141414] overflow-hidden flex-1 min-h-0 w-full h-full">
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 bg-white border-b border-brand-border shrink-0">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-brand-text/60" />
          <h2 className="font-semibold text-brand-text text-base">Alinhador & Recortador</h2>
          <span className="text-xs bg-brand-sidebar text-brand-text/60 font-mono px-2 py-0.5 border border-brand-border">
            {docType === 'pdf' ? `Pág. ${currentPage} de ${pdfPages.length}` : docType === 'image' ? 'Imagem' : 'Exemplo'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs font-medium text-brand-text/60 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showGuides}
              onChange={(e) => setShowGuides(e.target.checked)}
              className="bg-brand-sidebar border-brand-border text-brand-text focus:ring-brand-text h-4 w-4"
              aria-label="Mostrar guias de linhas"
              title="Mostrar guias de linhas"
            />
            Guias de Linhas
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const next = !isCroppedPDF;
                setIsCroppedPDF(next);
                onCropPreviewToggle?.(next);
              }}
              disabled={!canvasElement}
              className={`technical-button flex items-center gap-1.5 px-3 py-2 text-xs font-semibold cursor-pointer ${isCroppedPDF ? 'bg-orange-500/10 border-orange-500 text-orange-400 font-bold' : ''
                }`}
              title="Deixar visível somente as colunas demarcadas e ocultar o resto do PDF"
            >
              <Maximize2 className={`w-3.5 h-3.5 ${isCroppedPDF ? 'text-orange-400' : ''}`} />
              {isCroppedPDF ? 'Restaurar PDF Completo' : 'Recortar PDF'}
            </button>

            {pdfPages.length > 1 && onApplyCropAll ? (
              <>
                <button
                  type="button"
                  onClick={onApplyCropAll}
                  disabled={isProcessing || !isCroppedPDF}
                  className="technical-button-primary flex items-center gap-1.5 px-4.5 py-2.5 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  title={isCroppedPDF ? 'Extrair dados de todas as páginas do recorte' : 'Clique em "Recortar PDF" primeiro para habilitar'}
                >
                  <Files className="w-3.5 h-3.5" />
                  Recortar Todas as Páginas
                </button>
                <button
                  type="button"
                  onClick={onApplyCrop}
                  disabled={isProcessing || !canvasElement}
                  className="technical-button flex items-center gap-1.5 px-3 py-2 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  Recortar Pág. {currentPage}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onApplyCrop}
                disabled={isProcessing || !canvasElement}
                className="technical-button-primary flex items-center gap-1.5 px-4.5 py-2.5 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Processando...
                  </>
                ) : (
                  <>
                    <Maximize2 className="w-3.5 h-3.5" />
                    Recortar Documento
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden bg-brand-bg">
        {pdfPages.length > 1 && (
          <div className="w-full md:w-44 md:h-full border-b md:border-b-0 md:border-r border-brand-border p-4 flex flex-col gap-3 bg-brand-sidebar/40 flex-shrink-0 min-h-0 max-h-[180px] md:max-h-none overflow-hidden relative">
            <div className="flex items-center justify-between shrink-0">
              <span className="text-[10px] font-bold text-brand-text/50 uppercase tracking-wider flex items-center gap-1">
                <Files className="w-3.5 h-3.5" />
                Páginas do PDF
              </span>
              <span className="text-[9px] bg-brand-sidebar text-brand-text font-mono px-1.5 py-0.5 border border-brand-border font-bold">
                {pdfPages.length} pág.
              </span>
            </div>
            <div className="relative flex-1 min-h-0">
              <div className="absolute inset-0 flex md:flex-col gap-3.5 overflow-x-auto md:overflow-y-auto pr-1 pb-2 md:pb-0 overscroll-contain">
                {pdfPages.map((page) => (
                  <PageThumbnail
                    key={`thumb-${page.pageNumber}`}
                    canvas={page.canvas}
                    pageNumber={page.pageNumber}
                    isActive={currentPage === page.pageNumber}
                    onClick={() => onSelectPage?.(page.pageNumber)}
                    cropStartPct={cropStartPct}
                    cropEndPct={cropEndPct}
                    cropStartPage={cropStartPage}
                    cropEndPage={cropEndPage}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 relative overflow-hidden">
          <div className="absolute inset-0 overflow-y-auto overflow-x-auto p-6 flex flex-col items-center justify-start gap-4 overscroll-contain">
            {pdfPages.length > 1 && (
              <div className="flex flex-col items-center justify-center gap-4 bg-white border border-brand-border p-4 w-full max-w-[800px] shadow-[2px_2px_0_0_#141414] text-center">
                <span className="text-xs font-bold text-brand-text flex items-center justify-center gap-2">
                  <Files className="w-4 h-4" />
                  Mapeamento de Páginas para Extração
                </span>
                <div className="flex items-center gap-4 bg-brand-sidebar/40 p-2.5 border border-brand-border w-fit rounded">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-orange-500 font-bold">Início:</span>
                    <PageRangeNumberInput
                      value={cropStartPage}
                      max={pdfPages.length}
                      onChange={(val) => {
                        setCropStartPage(val);
                        if (val > cropEndPage) setCropEndPage(val);
                      }}
                      onNavigate={(val) => onSelectPage?.(val)}
                      className="w-16 h-8 px-2 bg-white border-2 border-orange-400 text-brand-text text-xs font-mono font-bold text-center focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 rounded"
                      aria-label="Página inicial do recorte"
                      title="Digite a página inicial"
                    />
                  </div>
                  <div className="h-5 w-px bg-brand-border" />
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-rose-500 font-bold">Pág. Fim:</span>
                    <PageRangeNumberInput
                      value={cropEndPage}
                      max={pdfPages.length}
                      onChange={(val) => {
                        setCropEndPage(val);
                        if (val < cropStartPage) setCropStartPage(val);
                      }}
                      onNavigate={(val) => onSelectPage?.(val)}
                      className="w-16 h-8 px-2 bg-white border-2 border-rose-400 text-brand-text text-xs font-mono font-bold text-center focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500 rounded"
                      aria-label="Página final do recorte"
                      title="Digite a página final"
                    />
                  </div>
                </div>
              </div>
            )}

            {canvasElement ? (
              <div className="relative shadow-[2px_2px_0_0_#141414] border border-brand-border bg-white w-full max-w-[800px] select-none">
                <div ref={containerRef} className="absolute inset-0 z-20 pointer-events-auto">
                  {pdfPages.length > 1 && (currentPage < cropStartPage || currentPage > cropEndPage) && (
                    <div className="absolute inset-0 bg-brand-text/80 backdrop-blur-[1.5px] flex flex-col items-center justify-center text-center p-6 z-40">
                      <span className="text-sm font-extrabold text-white mb-2 bg-brand-sidebar px-3 py-1.5 border border-brand-border text-brand-text shadow-[2px_2px_0_0_#141414]">
                        PÁGINA FORA DO INTERVALO
                      </span>
                      <p className="text-xs text-white/80 max-w-xs leading-relaxed">
                        Intervalo ativo: páginas {cropStartPage} a {cropEndPage}.
                      </p>
                    </div>
                  )}

                  {currentPage === cropStartPage && (
                    <DynamicStyleDiv
                      layout={{ top: 0, height: `${cropStartPct}%` }}
                      layoutDeps={[cropStartPct]}
                      className="absolute inset-x-0 bg-brand-text/70 pointer-events-none border-b border-orange-500/30 z-10"
                    />
                  )}
                  {currentPage === cropEndPage && (
                    <DynamicStyleDiv
                      layout={{ top: `${cropEndPct}%`, bottom: 0 }}
                      layoutDeps={[cropEndPct]}
                      className="absolute inset-x-0 bg-brand-text/70 pointer-events-none border-t border-rose-500/30 z-10"
                    />
                  )}

                  {currentPage === cropStartPage && (
                    <DynamicStyleDiv
                      layout={{ top: `${cropStartPct}%` }}
                      layoutDeps={[cropStartPct]}
                      className="absolute inset-x-0 h-1 bg-orange-500 z-30 cursor-ns-resize flex items-center justify-start"
                      onMouseDown={(e) => handleMouseDown(e, 'h-start', 'drag-h-start')}
                      onTouchStart={(e) => handleMouseDown(e, 'h-start', 'drag-h-start')}
                    >
                      <div className="absolute left-6 -top-3 px-2 py-0.5 bg-orange-600 border border-orange-500 text-white text-[9px] font-mono font-bold shadow-[2px_2px_0_0_#141414] flex items-center gap-1 pointer-events-none">
                        <Move className="w-2.5 h-2.5 rotate-90" />
                        INÍCIO ({cropStartPct.toFixed(0)}%)
                      </div>
                    </DynamicStyleDiv>
                  )}
                  {currentPage === cropEndPage && (
                    <DynamicStyleDiv
                      layout={{ top: `${cropEndPct}%` }}
                      layoutDeps={[cropEndPct]}
                      className="absolute inset-x-0 h-1 bg-rose-500 z-30 cursor-ns-resize flex items-center justify-end"
                      onMouseDown={(e) => handleMouseDown(e, 'h-end', 'drag-h-end')}
                      onTouchStart={(e) => handleMouseDown(e, 'h-end', 'drag-h-end')}
                    >
                      <div className="absolute right-6 -top-3 px-2 py-0.5 bg-rose-600 border border-rose-500 text-white text-[9px] font-mono font-bold shadow-[2px_2px_0_0_#141414] flex items-center gap-1 pointer-events-none">
                        <Move className="w-2.5 h-2.5 rotate-90" />
                        FIM ({cropEndPct.toFixed(0)}%)
                      </div>
                    </DynamicStyleDiv>
                  )}

                  {columnDefs.map((def, i) => {
                    const col = columns[def.id];
                    if (!col) return null;
                    const color = def.color || columnBandColor(i);
                    const handleBg = hexToRgba(color, 0.3);
                    return (
                      <DynamicStyleDiv
                        key={def.id}
                        layout={{
                          left: `${col.startX}%`,
                          width: `${col.width}%`,
                          borderColor: color,
                          backgroundColor: hexToRgba(color, 0.12),
                        }}
                        layoutDeps={[col.startX, col.width, color]}
                        className="absolute inset-y-0 border-x-2 border-dashed flex flex-col justify-between group transition-shadow duration-150 hover:shadow-lg"
                      >
                        <DynamicStyleDiv
                          onMouseDown={(e) => handleMouseDown(e, def.id, 'move')}
                          onTouchStart={(e) => handleMouseDown(e, def.id, 'move')}
                          layout={{ backgroundColor: color, borderColor: color }}
                          layoutDeps={[color]}
                          className="absolute -top-3.5 left-1/2 -translate-x-1/2 flex items-center gap-1 text-white px-2.5 py-0.5 text-[10px] font-bold tracking-wider shadow-[2px_2px_0_0_#141414] cursor-grab active:cursor-grabbing border whitespace-nowrap z-30"
                        >
                          <Move className="w-2.5 h-2.5" />
                          {def.name.toUpperCase()}
                        </DynamicStyleDiv>
                        <DynamicStyleDiv
                          onMouseDown={(e) => handleMouseDown(e, def.id, 'resize-left')}
                          onTouchStart={(e) => handleMouseDown(e, def.id, 'resize-left')}
                          layout={{ backgroundColor: handleBg }}
                          layoutDeps={[handleBg]}
                          className="absolute inset-y-0 -left-1 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-30"
                        >
                          <DynamicStyleDiv className="w-1 h-8" layout={{ backgroundColor: color }} layoutDeps={[color]} />
                        </DynamicStyleDiv>
                        <DynamicStyleDiv
                          onMouseDown={(e) => handleMouseDown(e, def.id, 'resize-right')}
                          onTouchStart={(e) => handleMouseDown(e, def.id, 'resize-right')}
                          layout={{ backgroundColor: handleBg }}
                          layoutDeps={[handleBg]}
                          className="absolute inset-y-0 -right-1 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-30"
                        >
                          <DynamicStyleDiv className="w-1 h-8" layout={{ backgroundColor: color }} layoutDeps={[color]} />
                        </DynamicStyleDiv>
                      </DynamicStyleDiv>
                    );
                  })}

                  {showGuides &&
                    detectedRowYs.map((row, i) => {
                      if (!canvasDisplayRef.current) return null;
                      const h = canvasDisplayRef.current.height;
                      const startYPx =
                        currentPage === cropStartPage ? (cropStartPct / 100) * h : 0;
                      const endYPx =
                        currentPage === cropEndPage ? (cropEndPct / 100) * h : h;
                      const isFilteredOut = !rowIntersectsCropBand(row, startYPx, endYPx);
                      const pctY = (row.y / canvasDisplayRef.current.height) * 100;
                      const pctH = (row.height / canvasDisplayRef.current.height) * 100;
                      return (
                        <DynamicStyleDiv
                          key={`guide-${i}`}
                          layout={{ top: `${pctY}%`, height: `${pctH}%` }}
                          layoutDeps={[pctY, pctH]}
                          className={`absolute inset-x-0 border-y border-dashed flex items-center justify-end pointer-events-none ${isFilteredOut
                            ? 'border-brand-border/20 opacity-20'
                            : 'border-rose-500/25 bg-rose-500/[0.015]'
                            }`}
                        >
                          <span className="text-[7px] bg-brand-sidebar text-brand-text/60 font-mono px-1 opacity-30">
                            Linha {i + 1}
                            {isFilteredOut ? ' (Excluída)' : ''}
                          </span>
                        </DynamicStyleDiv>
                      );
                    })}
                </div>
                <canvas ref={canvasDisplayRef} className="block w-full h-auto" />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center p-8 border-2 border-dashed border-brand-border bg-white max-w-md">
                <div className="w-12 h-12 bg-brand-sidebar text-brand-text/60 flex items-center justify-center mb-4 border border-brand-border shadow-[2px_2px_0_0_#141414]">
                  <Layers className="w-6 h-6" />
                </div>
                <h3 className="font-semibold text-brand-text text-sm mb-1.5">Nenhum Documento Carregado</h3>
                <p className="text-brand-text/60 text-xs leading-relaxed">
                  Faça upload de um PDF ou imagem para alinhar as colunas e recortar as linhas.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="px-6 py-3.5 bg-white border-t border-brand-border flex flex-wrap items-center gap-4 text-xs text-brand-text/60 shrink-0">
        <div className="flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-brand-text/50 flex-shrink-0" />
          <span>
            Arraste as faixas coloridas para alinhar as colunas. Delimitadores de início/fim excluem
            só linhas inteiramente fora da faixa — se o valor cruza a linha, entra no recorte.
          </span>
        </div>
      </div>
    </div>
  );
}

function PageThumbnail({
  canvas,
  pageNumber,
  isActive,
  onClick,
  cropStartPct,
  cropEndPct,
  cropStartPage,
  cropEndPage,
}: {
  canvas: HTMLCanvasElement;
  pageNumber: number;
  isActive: boolean;
  onClick: () => void;
  cropStartPct: number;
  cropEndPct: number;
  cropStartPage: number;
  cropEndPage: number;
}) {
  const thumbCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvas || !thumbCanvasRef.current) return;
    const thumbCanvas = thumbCanvasRef.current;
    const ctx = thumbCanvas.getContext('2d');
    if (!ctx) return;
    const thumbWidth = 110;
    const scale = thumbWidth / canvas.width;
    thumbCanvas.width = thumbWidth;
    thumbCanvas.height = canvas.height * scale;
    ctx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
    if (pageNumber < cropStartPage || pageNumber > cropEndPage) {
      ctx.fillStyle = 'rgba(8, 9, 12, 0.82)';
      ctx.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height);
      return;
    }
    if (pageNumber === cropStartPage) {
      const startY = (cropStartPct / 100) * thumbCanvas.height;
      ctx.fillStyle = 'rgba(8, 9, 12, 0.72)';
      ctx.fillRect(0, 0, thumbCanvas.width, startY);
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, startY);
      ctx.lineTo(thumbCanvas.width, startY);
      ctx.stroke();
    }
    if (pageNumber === cropEndPage) {
      const endY = (cropEndPct / 100) * thumbCanvas.height;
      ctx.fillStyle = 'rgba(8, 9, 12, 0.72)';
      ctx.fillRect(0, endY, thumbCanvas.width, thumbCanvas.height - endY);
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, endY);
      ctx.lineTo(thumbCanvas.width, endY);
      ctx.stroke();
    }
  }, [canvas, cropStartPct, cropEndPct, cropStartPage, cropEndPage, pageNumber]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 p-2 border transition-all w-[124px] md:w-full text-left group flex-shrink-0 ${isActive
        ? 'border-brand-text bg-brand-sidebar/40 text-brand-text shadow-[2px_2px_0_0_#141414]'
        : 'border-brand-border bg-white hover:border-brand-border text-brand-text/60 hover:text-brand-text'
        }`}
    >
      <div className="relative w-full overflow-hidden border border-brand-border bg-brand-bg">
        <canvas ref={thumbCanvasRef} className="block w-full h-auto opacity-70 group-hover:opacity-90" />
        <div
          className={`absolute top-1.5 left-1.5 font-mono text-[9px] px-1.5 py-0.5 border ${isActive
            ? 'bg-brand-text text-white border-brand-border font-bold'
            : 'bg-brand-sidebar text-brand-text/80 border-brand-border'
            }`}
        >
          Pág. {pageNumber}
        </div>
      </div>
    </button>
  );
}
