/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect, memo } from 'react';
import type { ColumnRange, DocumentColumns } from '../../../lib/leitorRecortador/types';
import { rowIntersectsCropBand } from '../../../lib/leitorRecortador/cropper';
import { DynamicStyleDiv } from '../../lib/dynamicStyle';
import { PageRangeNumberInput } from './PageRangeNumberInput';
import { Maximize2, Move, HelpCircle, RefreshCw, Layers, Files, FileSpreadsheet } from 'lucide-react';

interface WorkspaceProps {
  canvasElement: HTMLCanvasElement | null;
  columns: DocumentColumns;
  setColumns: React.Dispatch<React.SetStateAction<DocumentColumns>>;
  detectedRowYs: { y: number; height: number }[];
  isProcessing: boolean;
  onApplyCrop: () => void;
  onApplyCropAll?: () => void;
  docType: 'pdf' | 'image' | 'sample';

  // Crop limit lines
  cropStartPct: number;
  setCropStartPct: (pct: number) => void;
  cropEndPct: number;
  setCropEndPct: (pct: number) => void;

  // Pages state
  pdfPages?: { pageNumber: number; canvas: HTMLCanvasElement; textItems: any[]; width: number; height: number }[];
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
type DraggedColumn = 'date' | 'history' | 'value' | 'h-start' | 'h-end' | null;

export function LeitorRecortadorWorkspace({
  canvasElement,
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

  const [draggedCol, setDraggedCol] = useState<DraggedColumn>(null);
  const [dragType, setDragType] = useState<DragType>(null);
  const [startX, setStartX] = useState<number>(0);
  const [startY, setStartY] = useState<number>(0);
  const [startColState, setStartColState] = useState<ColumnRange | null>(null);
  const [startHState, setStartHState] = useState<number>(0);
  const [showGuides, setShowGuides] = useState<boolean>(true);
  const [isCroppedPDF, setIsCroppedPDF] = useState<boolean>(cropPreviewApplied);
  const dragRafRef = useRef<number | null>(null);
  const cropStartPctRef = useRef(cropStartPct);
  const cropEndPctRef = useRef(cropEndPct);
  const cropStartPageRef = useRef(cropStartPage);
  const cropEndPageRef = useRef(cropEndPage);

  useEffect(() => {
    cropStartPctRef.current = cropStartPct;
  }, [cropStartPct]);
  useEffect(() => {
    cropEndPctRef.current = cropEndPct;
  }, [cropEndPct]);
  useEffect(() => {
    cropStartPageRef.current = cropStartPage;
  }, [cropStartPage]);
  useEffect(() => {
    cropEndPageRef.current = cropEndPage;
  }, [cropEndPage]);

  useEffect(() => {
    setIsCroppedPDF(cropPreviewApplied);
  }, [cropPreviewApplied]);

  // Render original canvas onto our display canvas with correct fitting & optional visual crop masking
  useEffect(() => {
    if (!canvasElement || !canvasDisplayRef.current) return;

    const displayCanvas = canvasDisplayRef.current;
    const ctx = displayCanvas.getContext('2d');
    if (!ctx) return;

    const w = canvasElement.width;
    const h = canvasElement.height;

    // Set internal dimensions equal to the source canvas
    displayCanvas.width = w;
    displayCanvas.height = h;

    // Draw the source canvas content
    ctx.drawImage(canvasElement, 0, 0);


  }, [canvasElement, isCroppedPDF, columns, currentPage, cropStartPage, cropEndPage, cropStartPct, cropEndPct]);

  const handleMouseDown = (
    e: React.MouseEvent | React.TouchEvent,
    columnKey: 'date' | 'history' | 'value' | 'h-start' | 'h-end',
    type: DragType
  ) => {
    e.stopPropagation();
    e.preventDefault();

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    setDraggedCol(columnKey);
    setDragType(type);
    setStartX(clientX);
    setStartY(clientY);

    if (columnKey === 'h-start') {
      setStartHState(cropStartPct);
    } else if (columnKey === 'h-end') {
      setStartHState(cropEndPct);
    } else {
      setStartColState({ ...columns[columnKey as 'date' | 'history' | 'value'] });
    }
  };

  useEffect(() => {
    const applyPointer = (clientX: number, clientY: number) => {
      if (!draggedCol || !dragType || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();

      if (draggedCol === 'h-start' || draggedCol === 'h-end') {
        const deltaYPixels = clientY - startY;
        const deltaYPercent = (deltaYPixels / containerRect.height) * 100;
        const isSamePage = cropStartPageRef.current === cropEndPageRef.current;
        if (draggedCol === 'h-start') {
          const maxLimit = isSamePage ? cropEndPctRef.current - 2 : 100;
          const newPct = Math.max(0, Math.min(maxLimit, startHState + deltaYPercent));
          setCropStartPct(Number(newPct.toFixed(2)));
        } else {
          const minLimit = isSamePage ? cropStartPctRef.current + 2 : 0;
          const newPct = Math.max(minLimit, Math.min(100, startHState + deltaYPercent));
          setCropEndPct(Number(newPct.toFixed(2)));
        }
        return;
      }

      if (!startColState) return;
      const deltaXPixels = clientX - startX;
      const deltaXPercent = (deltaXPixels / containerRect.width) * 100;

      setColumns((prev) => {
        const col = prev[draggedCol as 'date' | 'history' | 'value'];
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

    const handleMouseMove = (e: MouseEvent | TouchEvent) => {
      if (!draggedCol || !dragType) return;
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      if (dragRafRef.current != null) return;
      dragRafRef.current = requestAnimationFrame(() => {
        dragRafRef.current = null;
        applyPointer(clientX, clientY);
      });
    };

    const handleMouseUp = () => {
      if (dragRafRef.current != null) {
        cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = null;
      }
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
      if (dragRafRef.current != null) {
        cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = null;
      }
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleMouseMove);
      window.removeEventListener('touchend', handleMouseUp);
    };
  }, [draggedCol, dragType, startX, startY, startColState, startHState, setColumns, setCropStartPct, setCropEndPct]);

  const columnStyles = {
    date: {
      color: 'border-blue-500 bg-blue-500/15 text-blue-400',
      tag: 'bg-blue-600 text-white border-blue-700',
      bg: 'blue',
    },
    history: {
      color: 'border-purple-500 bg-purple-500/15 text-purple-400',
      tag: 'bg-purple-600 text-white border-purple-700',
      bg: 'purple',
    },
    value: {
      color: 'border-emerald-500 bg-emerald-500/15 text-emerald-400',
      tag: 'bg-emerald-600 text-white border-emerald-700',
      bg: 'emerald',
    },
  };

  return (
    <div id="workspace-card" className="flex flex-col bg-white border border-brand-border shadow-[2px_2px_0_0_#141414] overflow-hidden h-full">
      {/* Workspace Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 bg-white border-b border-brand-border">
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
              id="run-ocr-btn"
              onClick={onApplyCropAll || onApplyCrop}
              disabled={isProcessing || !canvasElement}
              className="technical-button-primary flex items-center gap-2 px-5 py-2.5 text-xs font-bold disabled:opacity-40 cursor-pointer"
              title="Executar OCR usando PDF.js e Tesseract nas colunas mapeadas"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Processando OCR...
                </>
              ) : (
                <>
                  <Layers className="w-3.5 h-3.5" />
                  Executar OCR
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Main Workspace split: sidebar for pages, right for interactive canvas */}
      <div className="flex-1 flex flex-col md:flex-row min-h-[450px] overflow-hidden bg-brand-bg">
        
        {/* PDF Vertical Scrollbar Sidebar */}
        {pdfPages && pdfPages.length > 1 && (
          <div className="w-full md:w-44 border-b md:border-b-0 md:border-r border-brand-border p-4 flex flex-col gap-3 bg-brand-sidebar/40 flex-shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-brand-text/50 uppercase tracking-wider flex items-center gap-1">
                <Files className="w-3.5 h-3.5" />
                Páginas do PDF
              </span>
              <span className="text-[9px] bg-brand-sidebar text-brand-text font-mono px-1.5 py-0.5 border border-brand-border font-bold">
                {pdfPages.length} pág.
              </span>
            </div>
            <div className="flex md:flex-col gap-3.5 overflow-x-auto md:overflow-y-auto max-h-[160px] md:max-h-[600px] pr-1 pb-2 md:pb-0 scrollbar-thin">
              {pdfPages.map((page) => (
                <PageThumbnail
                  key={`thumb-${page.pageNumber}`}
                  canvas={page.canvas}
                  pageNumber={page.pageNumber}
                  isActive={currentPage === page.pageNumber}
                  onClick={() => onSelectPage && onSelectPage(page.pageNumber)}
                  cropStartPct={page.pageNumber === cropStartPage ? cropStartPct : -1}
                  cropEndPct={page.pageNumber === cropEndPage ? cropEndPct : -1}
                  cropStartPage={cropStartPage}
                  cropEndPage={cropEndPage}
                />
              ))}
            </div>
          </div>
        )}

        {/* Central interactive canvas */}
        <div className="flex-1 overflow-auto p-6 flex flex-col items-center justify-start gap-4">
          {pdfPages && (
            <div className="flex flex-col items-center justify-center gap-4 bg-white border border-brand-border p-4 w-full max-w-[800px] shadow-[2px_2px_0_0_#141414] text-center">
              <div className="flex flex-col items-center gap-1.5 w-full">
                <span className="text-xs font-bold text-brand-text flex items-center justify-center gap-2">
                  <Files className="w-4 h-4 text-brand-text" />
                  Mapeamento de Páginas para Extração
                </span>
                <span className="text-[11px] text-brand-text/60 leading-normal max-w-md">
                  Defina o início (filtra cabeçalho) e o fim (filtra rodapé) digitando ou clicando nas páginas abaixo:
                </span>
                
                {/* Inputs diretos para digitar o número da página */}
                <div className="flex items-center gap-4 mt-1 bg-brand-sidebar/40 p-2.5 border border-brand-border w-fit">
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor="leitor-crop-start-page"
                      className="text-[11px] text-orange-400 font-bold flex items-center gap-1"
                    >
                      📍 Início:
                    </label>
                    <PageRangeNumberInput
                      id="leitor-crop-start-page"
                      value={cropStartPage}
                      max={pdfPages.length}
                      onChange={(val) => {
                        setCropStartPage(val);
                        if (val > cropEndPage) setCropEndPage(val);
                      }}
                      onNavigate={(val) => onSelectPage?.(val)}
                      className="w-16 h-8 px-2 bg-white border border-brand-border text-brand-text text-xs font-mono font-bold text-center focus:outline-none focus:ring-2 focus:ring-orange-400"
                      aria-label="Página inicial do recorte"
                      title="Digite a página inicial e pressione Enter"
                      placeholder="1"
                    />
                  </div>
                  <div className="h-5 w-[1px] bg-brand-sidebar" />
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor="leitor-crop-end-page"
                      className="text-[11px] text-rose-400 font-bold flex items-center gap-1"
                    >
                      🏁 Pág. Fim:
                    </label>
                    <PageRangeNumberInput
                      id="leitor-crop-end-page"
                      value={cropEndPage}
                      max={pdfPages.length}
                      onChange={(val) => {
                        setCropEndPage(val);
                        if (val < cropStartPage) setCropStartPage(val);
                      }}
                      onNavigate={(val) => onSelectPage?.(val)}
                      className="w-16 h-8 px-2 bg-white border border-brand-border text-brand-text text-xs font-mono font-bold text-center focus:outline-none focus:ring-2 focus:ring-rose-400"
                      aria-label="Página final do recorte"
                      title="Digite a página final e pressione Enter"
                      placeholder={String(pdfPages.length)}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {canvasElement ? (
            <div className="relative shadow-[2px_2px_0_0_#141414] border border-brand-border bg-white w-full max-w-[800px] select-none">
              
              {/* Draggable Bands & Lines Layer */}
              <div
                ref={containerRef}
                className="absolute inset-0 z-20 pointer-events-auto"
              >
                {/* Full dark overlay if page is excluded from the active range */}
                {pdfPages && pdfPages.length > 1 && (currentPage < cropStartPage || currentPage > cropEndPage) && (
                  <div className="absolute inset-0 bg-brand-text/80 backdrop-blur-[1.5px] flex flex-col items-center justify-center text-center p-6 z-40">
                    <span className="text-sm font-extrabold text-brand-text/60 mb-2 flex items-center gap-2 bg-brand-sidebar px-3 py-1.5 border border-brand-border shadow-[2px_2px_0_0_#141414]">
                      🚫 PÁGINA FORA DO INTERVALO
                    </span>
                    <p className="text-xs text-brand-text/50 max-w-xs leading-relaxed">
                      Esta página está ignorada porque o intervalo do extrato está configurado para ir da <strong>Página {cropStartPage}</strong> até a <strong>Página {cropEndPage}</strong>.
                    </p>
                  </div>
                )}

                {/* Visual shade overlay for Top Inactive Zone (Only on Start Page) */}
                {currentPage === cropStartPage && (
                  <DynamicStyleDiv
                    layout={{ top: 0, height: `${cropStartPct}%` }}
                    layoutDeps={[cropStartPct]}
                    className="absolute inset-x-0 bg-brand-text/70 pointer-events-none border-b border-orange-500/30 backdrop-blur-[0.5px] z-10 transition-all duration-100"
                  />
                )}

                {/* Visual shade overlay for Bottom Inactive Zone (Only on End Page) */}
                {currentPage === cropEndPage && (
                  <DynamicStyleDiv
                    layout={{ top: `${cropEndPct}%`, bottom: 0 }}
                    layoutDeps={[cropEndPct]}
                    className="absolute inset-x-0 bg-brand-text/70 pointer-events-none border-t border-rose-500/30 backdrop-blur-[0.5px] z-10 transition-all duration-100"
                  />
                )}

                {/* Horizontal Delimiter - START LINE (Only on Start Page) */}
                {currentPage === cropStartPage && (
                  <DynamicStyleDiv
                    layout={{ top: `${cropStartPct}%` }}
                    layoutDeps={[cropStartPct]}
                    className="absolute inset-x-0 h-1 bg-orange-500 hover:bg-orange-400 group/hstart z-30 cursor-ns-resize transition-all duration-75 flex items-center justify-start"
                    onMouseDown={(e) => handleMouseDown(e, 'h-start', 'drag-h-start')}
                    onTouchStart={(e) => handleMouseDown(e, 'h-start', 'drag-h-start')}
                  >
                    <div className="absolute left-6 -top-3 px-2 py-0.5 bg-orange-600 border border-orange-500 text-white text-[9px] font-mono font-bold tracking-wider shadow-[2px_2px_0_0_#141414] flex items-center gap-1 select-none pointer-events-none">
                      <Move className="w-2.5 h-2.5 rotate-90" />
                      DELIMITADOR INÍCIO DO RECORTE ({cropStartPct.toFixed(0)}%)
                    </div>
                  </DynamicStyleDiv>
                )}

                {/* Horizontal Delimiter - END LINE (Only on End Page) */}
                {currentPage === cropEndPage && (
                  <DynamicStyleDiv
                    layout={{ top: `${cropEndPct}%` }}
                    layoutDeps={[cropEndPct]}
                    className="absolute inset-x-0 h-1 bg-rose-50 hover:bg-rose-400 group/hend z-30 cursor-ns-resize transition-all duration-75 flex items-center justify-end"
                    onMouseDown={(e) => handleMouseDown(e, 'h-end', 'drag-h-end')}
                    onTouchStart={(e) => handleMouseDown(e, 'h-end', 'drag-h-end')}
                  >
                    <div className="absolute right-6 -top-3 px-2 py-0.5 bg-rose-600 border border-rose-500 text-white text-[9px] font-mono font-bold tracking-wider shadow-[2px_2px_0_0_#141414] flex items-center gap-1 select-none pointer-events-none">
                      <Move className="w-2.5 h-2.5 rotate-90" />
                      DELIMITADOR FIM DO RECORTE ({cropEndPct.toFixed(0)}%)
                    </div>
                  </DynamicStyleDiv>
                )}
                {/* Date Band */}
                <DynamicStyleDiv
                  layout={{
                    left: `${columns.date.startX}%`,
                    width: `${columns.date.width}%`,
                  }}
                  layoutDeps={[columns.date.startX, columns.date.width]}
                  className={`absolute inset-y-0 border-x-2 border-dashed ${columnStyles.date.color} flex flex-col justify-between group transition-shadow duration-150 hover:shadow-lg`}
                >
                  {/* Header label */}
                  <div
                    onMouseDown={(e) => handleMouseDown(e, 'date', 'move')}
                    onTouchStart={(e) => handleMouseDown(e, 'date', 'move')}
                    className={`absolute -top-3.5 left-1/2 -translate-x-1/2 flex items-center gap-1 ${columnStyles.date.tag} px-2.5 py-0.5 text-[10px] font-bold tracking-wider shadow-[2px_2px_0_0_#141414] cursor-grab active:cursor-grabbing border whitespace-nowrap z-30`}
                  >
                    <Move className="w-2.5 h-2.5" />
                    DATA
                  </div>

                  {/* Resize Left Handle */}
                  <div
                    onMouseDown={(e) => handleMouseDown(e, 'date', 'resize-left')}
                    onTouchStart={(e) => handleMouseDown(e, 'date', 'resize-left')}
                    className="absolute inset-y-0 -left-1 w-2 cursor-ew-resize bg-blue-500/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-30"
                  >
                    <div className="w-1 h-8 bg-blue-500" />
                  </div>

                  {/* Resize Right Handle */}
                  <div
                    onMouseDown={(e) => handleMouseDown(e, 'date', 'resize-right')}
                    onTouchStart={(e) => handleMouseDown(e, 'date', 'resize-right')}
                    className="absolute inset-y-0 -right-1 w-2 cursor-ew-resize bg-blue-500/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-30"
                  >
                    <div className="w-1 h-8 bg-blue-500" />
                  </div>
                </DynamicStyleDiv>

                {/* History Band */}
                <DynamicStyleDiv
                  layout={{
                    left: `${columns.history.startX}%`,
                    width: `${columns.history.width}%`,
                  }}
                  layoutDeps={[columns.history.startX, columns.history.width]}
                  className={`absolute inset-y-0 border-x-2 border-dashed ${columnStyles.history.color} flex flex-col justify-between group transition-shadow duration-150 hover:shadow-lg`}
                >
                  {/* Header label */}
                  <div
                    onMouseDown={(e) => handleMouseDown(e, 'history', 'move')}
                    onTouchStart={(e) => handleMouseDown(e, 'history', 'move')}
                    className={`absolute -top-3.5 left-1/2 -translate-x-1/2 flex items-center gap-1 ${columnStyles.history.tag} px-2.5 py-0.5 text-[10px] font-bold tracking-wider shadow-[2px_2px_0_0_#141414] cursor-grab active:cursor-grabbing border whitespace-nowrap z-30`}
                  >
                    <Move className="w-2.5 h-2.5" />
                    HISTÓRICO
                  </div>

                  {/* Resize Left Handle */}
                  <div
                    onMouseDown={(e) => handleMouseDown(e, 'history', 'resize-left')}
                    onTouchStart={(e) => handleMouseDown(e, 'history', 'resize-left')}
                    className="absolute inset-y-0 -left-1 w-2 cursor-ew-resize bg-purple-500/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-30"
                  >
                    <div className="w-1 h-8 bg-purple-500" />
                  </div>

                  {/* Resize Right Handle */}
                  <div
                    onMouseDown={(e) => handleMouseDown(e, 'history', 'resize-right')}
                    onTouchStart={(e) => handleMouseDown(e, 'history', 'resize-right')}
                    className="absolute inset-y-0 -right-1 w-2 cursor-ew-resize bg-purple-500/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-30"
                  >
                    <div className="w-1 h-8 bg-purple-500" />
                  </div>
                </DynamicStyleDiv>

                {/* Value Band */}
                <DynamicStyleDiv
                  layout={{
                    left: `${columns.value.startX}%`,
                    width: `${columns.value.width}%`,
                  }}
                  layoutDeps={[columns.value.startX, columns.value.width]}
                  className={`absolute inset-y-0 border-x-2 border-dashed ${columnStyles.value.color} flex flex-col justify-between group transition-shadow duration-150 hover:shadow-lg`}
                >
                  {/* Header label */}
                  <div
                    onMouseDown={(e) => handleMouseDown(e, 'value', 'move')}
                    onTouchStart={(e) => handleMouseDown(e, 'value', 'move')}
                    className={`absolute -top-3.5 left-1/2 -translate-x-1/2 flex items-center gap-1 ${columnStyles.value.tag} px-2.5 py-0.5 text-[10px] font-bold tracking-wider shadow-[2px_2px_0_0_#141414] cursor-grab active:cursor-grabbing border whitespace-nowrap z-30`}
                  >
                    <Move className="w-2.5 h-2.5" />
                    VALOR
                  </div>

                  {/* Resize Left Handle */}
                  <div
                    onMouseDown={(e) => handleMouseDown(e, 'value', 'resize-left')}
                    onTouchStart={(e) => handleMouseDown(e, 'value', 'resize-left')}
                    className="absolute inset-y-0 -left-1 w-2 cursor-ew-resize bg-emerald-500/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-30"
                  >
                    <div className="w-1 h-8 bg-emerald-50" />
                  </div>

                  {/* Resize Right Handle */}
                  <div
                    onMouseDown={(e) => handleMouseDown(e, 'value', 'resize-right')}
                    onTouchStart={(e) => handleMouseDown(e, 'value', 'resize-right')}
                    className="absolute inset-y-0 -right-1 w-2 cursor-ew-resize bg-emerald-500/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-30"
                  >
                    <div className="w-1 h-8 bg-emerald-550" />
                  </div>
                </DynamicStyleDiv>

                {/* Horizontal Row Guides Overlay */}
                {showGuides && detectedRowYs.map((row, i) => {
                  if (!canvasDisplayRef.current) return null;
                  const h = canvasDisplayRef.current.height;
                  const startY =
                    currentPage === cropStartPage ? (cropStartPct / 100) * h : 0;
                  const endY =
                    currentPage === cropEndPage ? (cropEndPct / 100) * h : h;
                  const isFilteredOut = !rowIntersectsCropBand(row, startY, endY);

                  const pctY = (row.y / canvasDisplayRef.current.height) * 100;
                  const pctH = (row.height / canvasDisplayRef.current.height) * 100;
                  
                  return (
                    <DynamicStyleDiv
                      key={`guide-${i}`}
                      layout={{
                        top: `${pctY}%`,
                        height: `${pctH}%`,
                      }}
                      layoutDeps={[pctY, pctH]}
                      className={`absolute inset-x-0 border-y border-dashed flex items-center justify-end pointer-events-none transition-opacity ${ isFilteredOut ? 'border-brand-border/20 bg-transparent opacity-20' : 'border-rose-500/25 bg-rose-500/[0.015]' }`}
                    >
                      <span className="text-[7px] bg-brand-sidebar text-brand-text/60 font-mono px-1 opacity-30">
                        Linha {i + 1} {isFilteredOut && '(Excluída)'}
                      </span>
                    </DynamicStyleDiv>
                  );
                })}
              </div>

              {/* Document display Canvas */}
              <canvas
                ref={canvasDisplayRef}
                className="block w-full h-auto bg-white"
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-center p-8 border-2 border-dashed border-brand-border bg-white max-w-md">
              <div className="w-12 h-12 bg-brand-sidebar text-brand-text/60 flex items-center justify-center mb-4 border border-brand-border shadow-[2px_2px_0_0_#141414]">
                <Layers className="w-6 h-6" />
              </div>
              <h3 className="font-semibold text-brand-text text-sm mb-1.5">Nenhum Documento Carregado</h3>
              <p className="text-brand-text/60 text-xs leading-relaxed mb-4">
                Faça upload de um extrato em PDF ou imagem no painel lateral para usar as ferramentas de recorte.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Workspace Footer instructions */}
      <div className="px-6 py-3.5 bg-white border-t border-brand-border flex flex-wrap items-center justify-between gap-4 text-xs text-brand-text/60">
        <div className="flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-brand-text/50 flex-shrink-0" />
          <span>
            <strong>Processamento Inteligente:</strong> Os delimitadores (<span className="text-orange-400 font-bold">Início</span> e <span className="text-rose-400 font-semibold">Fim</span>) excluem apenas linhas totalmente fora da faixa — valores que cruzam a linha permanecem no recorte.
          </span>
        </div>
        {pdfPages && pdfPages.length > 1 && (
          <div className="text-[10px] bg-brand-sidebar/40 text-brand-text border border-brand-border px-2.5 py-1 font-semibold shadow-inner">
            Selecione o intervalo de páginas desejado e clique em <strong>Recortar Todas as Páginas</strong>!
          </div>
        )}
      </div>
    </div>
  );
}

interface PageThumbnailProps {
  key?: string;
  canvas: HTMLCanvasElement;
  pageNumber: number;
  isActive: boolean;
  onClick: () => void;
  cropStartPct: number;
  cropEndPct: number;
  cropStartPage: number;
  cropEndPage: number;
}

const PageThumbnail = memo(function PageThumbnail({
  canvas,
  pageNumber,
  isActive,
  onClick,
  cropStartPct,
  cropEndPct,
  cropStartPage,
  cropEndPage,
}: PageThumbnailProps) {
  const thumbCanvasRef = useRef<HTMLCanvasElement>(null);
  const baseDrawnRef = useRef(false);

  useEffect(() => {
    if (!canvas || !thumbCanvasRef.current) return;
    const thumbCanvas = thumbCanvasRef.current;
    const ctx = thumbCanvas.getContext('2d');
    if (!ctx) return;

    const thumbWidth = 110;
    const scale = thumbWidth / canvas.width;
    if (!baseDrawnRef.current || thumbCanvas.width !== thumbWidth) {
      thumbCanvas.width = thumbWidth;
      thumbCanvas.height = canvas.height * scale;
      ctx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
      baseDrawnRef.current = true;
    } else {
      ctx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
    }
  }, [canvas]);

  useEffect(() => {
    if (!canvas || !thumbCanvasRef.current || !baseDrawnRef.current) return;
    const thumbCanvas = thumbCanvasRef.current;
    const ctx = thumbCanvas.getContext('2d');
    if (!ctx) return;

    const thumbWidth = thumbCanvas.width;
    ctx.drawImage(canvas, 0, 0, thumbWidth, thumbCanvas.height);

    if (pageNumber < cropStartPage || pageNumber > cropEndPage) {
      ctx.fillStyle = 'rgba(8, 9, 12, 0.82)';
      ctx.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height);
      return;
    }

    if (pageNumber === cropStartPage && cropStartPct >= 0) {
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

    if (pageNumber === cropEndPage && cropEndPct >= 0) {
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
  }, [canvas, pageNumber, cropStartPct, cropEndPct, cropStartPage, cropEndPage]);

  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 p-2 border transition-all w-[124px] md:w-full text-left group flex-shrink-0 ${ isActive ? 'border-brand-text bg-brand-sidebar/40 text-brand-text shadow-[2px_2px_0_0_#141414] ' : 'border-brand-border bg-white hover:border-brand-border text-brand-text/60 hover:text-brand-text' }`}
    >
      <div className="relative w-full overflow-hidden border border-brand-border bg-brand-bg flex items-center justify-center">
        <canvas ref={thumbCanvasRef} className="block w-full h-auto opacity-70 group-hover:opacity-90 transition-opacity" />
        
        {/* Page Badge */}
        <div className={`absolute top-1.5 left-1.5 font-mono text-[9px] px-1.5 py-0.5 border ${ isActive ? 'bg-brand-text text-white border-brand-border font-bold' : 'bg-brand-sidebar text-brand-text/80 border-brand-border' }`}>
          Pág. {pageNumber}
        </div>

        {/* Start page marker */}
        {pageNumber === cropStartPage && (
          <div className="absolute bottom-1.5 left-1.5 bg-orange-600 text-white border border-orange-500 text-[8px] font-bold px-1.5 py-0.5 shadow-[2px_2px_0_0_#141414]">
            📍 INÍCIO
          </div>
        )}

        {/* End page marker */}
        {pageNumber === cropEndPage && (
          <div className="absolute bottom-1.5 right-1.5 bg-rose-600 text-white border border-rose-500 text-[8px] font-bold px-1.5 py-0.5 shadow-[2px_2px_0_0_#141414]">
            🏁 FIM
          </div>
        )}

        {/* Excluded overlay text */}
        {(pageNumber < cropStartPage || pageNumber > cropEndPage) && (
          <div className="absolute inset-0 bg-brand-text/50 flex items-center justify-center">
            <span className="bg-brand-sidebar/90 text-brand-text/50 border border-brand-border text-[8px] px-1.5 py-0.5 font-bold uppercase">
              Ignorada
            </span>
          </div>
        )}
      </div>
    </button>
  );
});
