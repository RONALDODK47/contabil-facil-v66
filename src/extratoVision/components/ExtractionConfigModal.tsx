import React, { useState, useRef, useEffect } from 'react';
import { ExtractionConfig, ColumnDef, SavedLayout, HorizontalRegionDef } from '../types';
import { X, Play, Settings2, Info, MousePointer2, Save, Search, LayoutTemplate, Trash2, ZoomIn, ZoomOut, Maximize, Square } from 'lucide-react';

interface ExtractionConfigModalProps {
  file: File;
  onConfirm: (config: ExtractionConfig) => void;
  onCancel: () => void;
}

const INITIAL_PREDEFINED_COLUMNS = [
  { id: 'date', name: 'Data', color: 'bg-blue-500', borderColor: 'border-blue-500', textColor: 'text-blue-500' },
  { id: 'description', name: 'Histórico', color: 'bg-emerald-500', borderColor: 'border-emerald-500', textColor: 'text-emerald-500' },
  { id: 'indicator', name: 'Sinal (C/D) / Valor Misto', color: 'bg-purple-500', borderColor: 'border-purple-500', textColor: 'text-purple-500' },
  { id: 'credit', name: 'Crédito', color: 'bg-green-500', borderColor: 'border-green-500', textColor: 'text-green-500' },
  { id: 'debit', name: 'Débito', color: 'bg-red-500', borderColor: 'border-red-500', textColor: 'text-red-500' },
  { id: 'ignore1', name: 'Ignorar 1', color: 'bg-slate-500', borderColor: 'border-slate-500', textColor: 'text-slate-500' },
  { id: 'ignore2', name: 'Ignorar 2', color: 'bg-slate-500', borderColor: 'border-slate-500', textColor: 'text-slate-500' },
  { id: 'ignore3', name: 'Ignorar 3', color: 'bg-slate-500', borderColor: 'border-slate-500', textColor: 'text-slate-500' },
  { id: 'ignore4', name: 'Ignorar 4', color: 'bg-slate-500', borderColor: 'border-slate-500', textColor: 'text-slate-500' },
];

const INITIAL_PREDEFINED_HORIZONTAL = [
  { id: 'h_ignore1', name: 'Ignorar Linha 1', color: 'bg-orange-500', borderColor: 'border-orange-500', textColor: 'text-orange-500' },
  { id: 'h_ignore2', name: 'Ignorar Linha 2', color: 'bg-orange-500', borderColor: 'border-orange-500', textColor: 'text-orange-500' },
];

export const ExtractionConfigModal: React.FC<ExtractionConfigModalProps> = ({ file, onConfirm, onCancel }) => {
  const [predefinedColumns, setPredefinedColumns] = useState(INITIAL_PREDEFINED_COLUMNS);
  const [predefinedHorizontalRegions, setPredefinedHorizontalRegions] = useState(INITIAL_PREDEFINED_HORIZONTAL);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imgSize, setImgSize] = useState({ width: 0, height: 0 });
  
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [columns, setColumns] = useState<ColumnDef[]>([]);
  const [horizontalRegions, setHorizontalRegions] = useState<HorizontalRegionDef[]>([]);
  const [activeColumnId, setActiveColumnId] = useState<string>('date');
  const [clickStep, setClickStep] = useState<'start' | 'end'>('start');
  const [mousePos, setMousePos] = useState<{x: number; y: number} | null>(null);

  const [historyLines, setHistoryLines] = useState(1);
  const [historyMode, setHistoryMode] = useState<'fixed' | 'smart'>('fixed');
  const [dateMode, setDateMode] = useState<'one-per-tx' | 'one-for-many'>('one-for-many');
  const [startLine, setStartLine] = useState(0);
  const [endLine, setEndLine] = useState(100);
  const [startPage, setStartPage] = useState<number>(1);
  const [endPage, setEndPage] = useState<number>(0);
  const [ignoreWords, setIgnoreWords] = useState<string>('');

  const [savedLayouts, setSavedLayouts] = useState<SavedLayout[]>([]);
  const [layoutSearch, setLayoutSearch] = useState('');
  const [newLayoutName, setNewLayoutName] = useState('');
  const [showSavedLayouts, setShowSavedLayouts] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  
  const [zoomLevel, setZoomLevel] = useState(1);

  const containerRef = useRef<HTMLDivElement>(null);

  const handleZoomIn = () => setZoomLevel(prev => Math.min(prev + 0.25, 4));
  const handleZoomOut = () => setZoomLevel(prev => Math.max(prev - 0.25, 0.25));
  const handleZoomReset = () => setZoomLevel(1);

  useEffect(() => {
    const loaded = localStorage.getItem('pdfLayouts');
    if (loaded) {
      try {
        setSavedLayouts(JSON.parse(loaded));
      } catch (e) {
        console.error("Failed to load layouts", e);
      }
    }
  }, []);

  useEffect(() => {
    const loadPreview = async () => {
      setPreviewUrl(null);
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === 'pdf') {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await (window as any).pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        setPdfDoc(pdf);
        setTotalPages(pdf.numPages);
        setEndPage(pdf.numPages);
        renderPage(pdf, 1);
      } else if (['png', 'jpg', 'jpeg'].includes(ext || '')) {
        setPreviewUrl(URL.createObjectURL(file));
      }
    };
    loadPreview();
  }, [file]);

  const renderPage = async (pdf: any, pageNum: number) => {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 4 }); // Increased from 2 to 4 for better quality
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext('2d');
    await page.render({ canvasContext: context!, viewport }).promise;
    setPreviewUrl(canvas.toDataURL());
  };

  const handlePrevPage = () => {
    if (currentPage > 1 && pdfDoc) {
      setCurrentPage(prev => prev - 1);
      renderPage(pdfDoc, currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages && pdfDoc) {
      setCurrentPage(prev => prev + 1);
      renderPage(pdfDoc, currentPage + 1);
    }
  };

  const handleLastPage = () => {
    if (pdfDoc) {
      setCurrentPage(totalPages);
      renderPage(pdfDoc, totalPages);
    }
  };

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    setImgSize({ width: naturalWidth, height: naturalHeight });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const scale = imgSize.width / rect.width;
    const scaleY = imgSize.height / rect.height;
    setMousePos({ x: x * scale, y: y * scaleY });
  };

  const handleMouseLeave = () => {
    setMousePos(null);
  };

  const handleImageClick = (e: React.MouseEvent) => {
    if (!containerRef.current || !activeColumnId) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const scale = imgSize.width / rect.width;
    const scaleY = imgSize.height / rect.height;
    const realX = x * scale;
    const realY = y * scaleY;
    
    if (activeColumnId.startsWith('h_')) {
      setHorizontalRegions(prev => {
        const existing = prev.find(r => r.id === activeColumnId);
        const refColor = predefinedHorizontalRegions.find(p => p.id === activeColumnId);
        const color = refColor?.color || 'bg-orange-500';
        const name = refColor?.name || 'Ignorar';
        
        if (!existing || clickStep === 'start') {
          setClickStep('end');
          return [
            ...prev.filter(r => r.id !== activeColumnId), 
            { id: activeColumnId, name, start: realY, end: realY, color }
          ];
        } else {
          setClickStep('start');
          const newStart = Math.min(existing.start, realY);
          const newEnd = Math.max(existing.start, realY);
          
          const currentIndex = predefinedHorizontalRegions.findIndex(p => p.id === activeColumnId);
          if (currentIndex < predefinedHorizontalRegions.length - 1) {
            setActiveColumnId(predefinedHorizontalRegions[currentIndex + 1].id);
          }

          return prev.map(r => r.id === activeColumnId ? { ...r, start: newStart, end: newEnd } : r);
        }
      });
    } else {
      setColumns(prev => {
        const existing = prev.find(c => c.id === activeColumnId);
        const color = predefinedColumns.find(p => p.id === activeColumnId)?.color || 'bg-slate-500';
        
        if (!existing || clickStep === 'start') {
          setClickStep('end');
          return [
            ...prev.filter(c => c.id !== activeColumnId), 
            { id: activeColumnId, start: realX, end: realX, color }
          ];
        } else {
          setClickStep('start');
          const newStart = Math.min(existing.start, realX);
          const newEnd = Math.max(existing.start, realX);
          
          const currentIndex = predefinedColumns.findIndex(p => p.id === activeColumnId);
          if (currentIndex < predefinedColumns.length - 1) {
            setActiveColumnId(predefinedColumns[currentIndex + 1].id);
          }

          return prev.map(c => c.id === activeColumnId ? { ...c, start: newStart, end: newEnd } : c);
        }
      });
    }
  };

  const handleConfirm = () => {
    const hasDate = columns.some(c => c.id === 'date' && c.start !== c.end);
    const hasDesc = columns.some(c => c.id === 'description' && c.start !== c.end);
    const hasMixedValue = columns.some(c => c.id === 'indicator' && c.start !== c.end);
    const hasSplitValue = columns.some(c => c.id === 'credit' && c.start !== c.end) && columns.some(c => c.id === 'debit' && c.start !== c.end);
    
    if (!hasDate || !hasDesc || (!hasMixedValue && !hasSplitValue)) {
      alert("Por favor, configure as colunas de Data, Histórico e Valores (ou Sinal (C/D) / Valor Misto, ou Crédito/Débito separadamente).");
      return;
    }

    const config: ExtractionConfig = {
      columns: columns.filter(c => c.start !== c.end),
      horizontalRegions: horizontalRegions.filter(r => r.start !== r.end),
      columnMapping: {
        date: 'date',
        description: 'description',
        indicator: columns.some(c => c.id === 'indicator' && c.start !== c.end) ? 'indicator' : undefined,
        credit: columns.some(c => c.id === 'credit' && c.start !== c.end) ? 'credit' : undefined,
        debit: columns.some(c => c.id === 'debit' && c.start !== c.end) ? 'debit' : undefined,
      },
      historyLines,
      historyMode,
      dateMode,
      startLine,
      endLine,
      startPage,
      endPage,
      ignoreWords: ignoreWords.split('\n').map(w => w.trim()).filter(w => w.length > 0)
    };

    onConfirm(config);
  };

  const handleSaveLayout = () => {
    if (!newLayoutName.trim()) {
      alert("Por favor, insira um nome para o layout.");
      return;
    }

    const config: ExtractionConfig = {
      columns: columns.filter(c => c.start !== c.end),
      horizontalRegions: horizontalRegions.filter(r => r.start !== r.end),
      columnMapping: {
        date: 'date',
        description: 'description',
        indicator: columns.some(c => c.id === 'indicator' && c.start !== c.end) ? 'indicator' : undefined,
        credit: columns.some(c => c.id === 'credit' && c.start !== c.end) ? 'credit' : undefined,
        debit: columns.some(c => c.id === 'debit' && c.start !== c.end) ? 'debit' : undefined,
      },
      historyLines,
      historyMode,
      dateMode,
      startLine,
      endLine,
      startPage,
      endPage,
      ignoreWords: ignoreWords.split('\n').map(w => w.trim()).filter(w => w.length > 0)
    };

    const newLayout: SavedLayout = {
      id: Date.now().toString(),
      name: newLayoutName.trim(),
      config,
      createdAt: Date.now()
    };

    const updatedLayouts = [...savedLayouts, newLayout];
    setSavedLayouts(updatedLayouts);
    localStorage.setItem('pdfLayouts', JSON.stringify(updatedLayouts));
    setNewLayoutName('');
    // Fechar aviso ou dar alert amigável sem usar window.alert que bloqueia no iframe
    setShowConfig(false);
    setShowSavedLayouts(true);
  };

  const handleLoadLayout = (layout: SavedLayout) => {
    setColumns(layout.config.columns);
    setHorizontalRegions(layout.config.horizontalRegions || []);
    setHistoryLines(layout.config.historyLines);
    setHistoryMode(layout.config.historyMode || 'fixed');
    setDateMode(layout.config.dateMode);
    setStartLine(layout.config.startLine || 0);
    setEndLine(layout.config.endLine || 100);
    setStartPage(layout.config.startPage || 1);
    setEndPage(layout.config.endPage || totalPages);
    setIgnoreWords(layout.config.ignoreWords?.join('\n') || '');
    setShowSavedLayouts(false);
  };

  const handleDeleteLayout = (e: React.MouseEvent, layoutId: string) => {
    e.stopPropagation(); // Prevent loading the layout when clicking delete
    // Removed window.confirm due to iframe restrictions
    const updatedLayouts = savedLayouts.filter(l => l.id !== layoutId);
    setSavedLayouts(updatedLayouts);
    localStorage.setItem('pdfLayouts', JSON.stringify(updatedLayouts));
  };

  const filteredLayouts = savedLayouts.filter(l => l.name.toLowerCase().includes(layoutSearch.toLowerCase()));

  return (
    <div className="fixed inset-0 z-[300] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 rounded-[2.5rem] shadow-2xl border border-slate-800 w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Settings2 className="text-white w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black text-white tracking-tight uppercase">Configuração de Extração</h2>
              <p className="text-slate-400 text-xs font-medium">Mapeie as colunas e defina as regras de leitura para este documento</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setShowConfig(true)} 
              className="px-4 py-2 text-xs font-bold text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition-all uppercase tracking-widest flex items-center gap-2 border border-slate-700"
            >
              <i className="fas fa-cog"></i> Configurações
            </button>
            <button 
              onClick={() => setShowSavedLayouts(true)}
              className="px-4 py-2 text-xs font-bold text-blue-400 hover:text-white hover:bg-blue-900/50 rounded-xl transition-all uppercase tracking-widest flex items-center gap-2"
            >
              <LayoutTemplate className="w-4 h-4" /> Layouts Salvos
            </button>
            <button 
              onClick={() => { setColumns([]); setClickStep('start'); setActiveColumnId('date'); }}
              className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-all uppercase tracking-widest"
            >
              Resetar Colunas
            </button>
            <button onClick={onCancel} className="p-2 hover:bg-slate-800 rounded-xl transition-colors text-slate-400 hover:text-white">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Left: Visual Config */}
          <div className="flex-1 flex flex-col bg-slate-950/50 relative overflow-hidden">
            <div className="p-4 border-b border-slate-800/50 flex items-center justify-between flex-wrap gap-4 shrink-0">
              <h3 className="text-sm font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                <Play className="w-4 h-4 text-blue-500 fill-blue-500" /> Visualização do Documento
              </h3>
              
              <div className="flex items-center gap-3 ml-auto">
                {totalPages > 1 && (
                  <div className="flex items-center gap-2 bg-slate-900 px-3 py-1 rounded-full border border-slate-800 shadow-lg">
                    <button 
                      onClick={handlePrevPage}
                      disabled={currentPage === 1}
                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded text-[10px] font-bold text-white transition-colors"
                    >
                      Anterior
                    </button>
                    <span className="text-[10px] font-bold text-slate-400 px-2">
                      Página {currentPage} de {totalPages}
                    </span>
                    <button 
                      onClick={handleNextPage}
                      disabled={currentPage === totalPages}
                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded text-[10px] font-bold text-white transition-colors"
                    >
                      Próxima
                    </button>
                    <button 
                      onClick={handleLastPage}
                      disabled={currentPage === totalPages}
                      className="px-2 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-[10px] font-bold text-white transition-colors ml-1"
                    >
                      Última
                    </button>
                  </div>
                )}

                <div className="text-[10px] text-slate-500 bg-slate-800 px-3 py-1 rounded-full border border-slate-700 flex items-center gap-2">
                  <MousePointer2 className="w-3 h-3" />
                  {clickStep === 'start' ? 'Início da coluna' : 'Fim da coluna'}
                </div>

                {/* Zoom Controls */}
                <div className="flex items-center gap-1 bg-slate-800 rounded-full border border-slate-700 p-1 shadow-lg">
                  <button
                    onClick={handleZoomOut}
                    title="Diminuir Zoom"
                    className="p-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded-full transition-colors"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <div 
                    onClick={handleZoomReset}
                    className="text-[10px] font-bold text-white px-2 cursor-pointer hover:text-blue-400 transition-colors"
                    title="Resetar Zoom"
                  >
                    {Math.round(zoomLevel * 100)}%
                  </div>
                  <button
                    onClick={handleZoomIn}
                    title="Aumentar Zoom"
                    className="p-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded-full transition-colors"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
            
            <div className="flex-1 overflow-auto p-8 custom-scrollbar">
              <div 
                ref={containerRef}
                className="relative border border-slate-800 rounded-xl overflow-hidden shadow-2xl cursor-crosshair group mx-auto"
                style={{ width: `${Math.max(100, zoomLevel * 100)}%`, minWidth: zoomLevel > 1 ? `${zoomLevel * 100}%` : '100%' }}
                onClick={handleImageClick}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
              >
              {previewUrl ? (
                <>
                  <img 
                    src={previewUrl} 
                    alt="Preview" 
                    onLoad={handleImageLoad}
                    className="w-full h-auto block select-none"
                    draggable={false}
                  />
                  
                  {/* Render Columns */}
                  {columns.map(col => {
                    if (col.start === col.end && clickStep === 'start') return null; // Don't render zero-width columns unless actively drawing
                    
                    const isDrawing = col.id === activeColumnId && clickStep === 'end';
                    const currentEnd = isDrawing && mousePos !== null ? mousePos.x : col.end;
                    
                    const actualStart = Math.min(col.start, currentEnd);
                    const actualEnd = Math.max(col.start, currentEnd);
                    
                    const leftPercent = (actualStart / imgSize.width) * 100;
                    const widthPercent = ((actualEnd - actualStart) / imgSize.width) * 100;
                    
                    const pCol = predefinedColumns.find(p => p.id === col.id);
                    
                    return (
                      <div 
                        key={col.id}
                        className={`absolute top-0 bottom-0 ${col.color} opacity-30 border-l-2 border-r-2 ${pCol?.borderColor}`}
                        style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
                      >
                        <div className={`absolute top-4 left-1/2 -translate-x-1/2 ${col.color} text-white text-[10px] font-bold px-2 py-1 rounded shadow-lg whitespace-nowrap opacity-100`}>
                          {pCol?.name}
                        </div>
                      </div>
                    );
                  })}

                  {/* Render Horizontal Regions */}
                  {horizontalRegions.map(reg => {
                    if (reg.start === reg.end && clickStep === 'start') return null;
                    
                    const isDrawing = reg.id === activeColumnId && clickStep === 'end';
                    const currentEnd = isDrawing && mousePos !== null ? mousePos.y : reg.end;
                    
                    const actualStart = Math.min(reg.start, currentEnd);
                    const actualEnd = Math.max(reg.start, currentEnd);
                    
                    const topPercent = (actualStart / imgSize.height) * 100;
                    const heightPercent = ((actualEnd - actualStart) / imgSize.height) * 100;
                    
                    const pReg = predefinedHorizontalRegions.find(p => p.id === reg.id);
                    
                    return (
                      <div 
                        key={reg.id}
                        className={`absolute left-0 right-0 ${reg.color} opacity-30 border-t-2 border-b-2 ${pReg?.borderColor || 'border-orange-500'} z-10`}
                        style={{ top: `${topPercent}%`, height: `${heightPercent}%` }}
                      >
                        <div className={`absolute left-4 top-1/2 -translate-y-1/2 ${reg.color} text-white text-[10px] font-bold px-2 py-1 rounded shadow-lg whitespace-nowrap opacity-100`}>
                          {pReg?.name || reg.name}
                        </div>
                      </div>
                    );
                  })}

                  {/* Mouse Guide Line */}
                  {mousePos !== null && activeColumnId && !activeColumnId.startsWith('h_') && (
                    <div 
                      className="absolute top-0 bottom-0 w-px bg-white/50 border-l border-dashed border-white pointer-events-none"
                      style={{ left: `${(mousePos.x / imgSize.width) * 100}%` }}
                    />
                  )}
                  {mousePos !== null && activeColumnId?.startsWith('h_') && (
                    <div 
                      className="absolute left-0 right-0 h-px bg-white/50 border-t border-dashed border-white pointer-events-none"
                      style={{ top: `${(mousePos.y / imgSize.height) * 100}%` }}
                    />
                  )}

                  {/* Horizontal Start/End Lines */}
                  {currentPage === startPage && (
                    <div 
                      className="absolute left-0 right-0 h-1 bg-emerald-500/60 shadow-[0_0_10px_rgba(16,185,129,0.5)]"
                      style={{ top: `${startLine}%` }}
                    >
                      <div className="absolute -top-6 left-4 bg-emerald-600 text-[10px] font-bold px-2 py-1 rounded text-white uppercase tracking-tighter shadow-lg">
                        Início da Extração (Página {startPage})
                      </div>
                    </div>
                  )}
                  {currentPage === endPage && (
                    <div 
                      className="absolute left-0 right-0 h-1 bg-red-500/60 shadow-[0_0_10px_rgba(239,68,68,0.5)]"
                      style={{ top: `${endLine}%` }}
                    >
                      <div className="absolute -bottom-6 left-4 bg-red-600 text-[10px] font-bold px-2 py-1 rounded text-white uppercase tracking-tighter shadow-lg">
                        Fim da Extração (Página {endPage})
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="w-[600px] h-[800px] bg-slate-900 flex items-center justify-center">
                  <div className="w-12 h-12 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
                </div>
              )}
            </div>
          </div>
          </div>

          {/* Right: Controls */}
          <div className="w-96 border-l border-slate-800 p-8 flex flex-col bg-slate-900/80 backdrop-blur-sm">
            <div className="flex-1 space-y-8 overflow-y-auto pr-2 custom-scrollbar">
              
              {/* Instructions */}
              <section>
                <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Info className="w-3 h-3" /> Como Configurar
                </h3>
                <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-4 text-[10px] text-slate-400 leading-relaxed space-y-2">
                  <p>1. Selecione a coluna que deseja configurar abaixo.</p>
                  <p>2. Clique na imagem para marcar o <b>início</b> da coluna (linha esquerda).</p>
                  <p>3. Mova o mouse e clique novamente para marcar o <b>fim</b> da coluna (linha direita).</p>
                  <p>4. Repita para as colunas obrigatórias (Data, Histórico, Valor).</p>
                </div>
              </section>

              {/* Column Mapping */}
              <section>
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Settings2 className="w-3 h-3" /> Colunas
                </h3>
                <div className="space-y-2">
                  {predefinedColumns.map(pCol => {
                    const colState = columns.find(c => c.id === pCol.id);
                    const isConfigured = colState && colState.start !== colState.end;
                    const isActive = activeColumnId === pCol.id;
                    
                    return (
                      <button
                        key={pCol.id}
                        onClick={() => { setActiveColumnId(pCol.id); setClickStep('start'); }}
                        className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${isActive ? `${pCol.borderColor} bg-slate-800 shadow-lg` : 'border-slate-700 bg-slate-900 hover:border-slate-600'}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-3 h-3 rounded-full ${pCol.color} ${isActive && clickStep === 'end' ? 'animate-pulse' : ''}`} />
                          <span className={`text-sm font-bold ${isActive ? 'text-white' : 'text-slate-400'}`}>{pCol.name}</span>
                        </div>
                        {isConfigured ? (
                          <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest bg-emerald-500/10 px-2 py-1 rounded-md">Configurado</span>
                        ) : (
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Pendente</span>
                        )}
                      </button>
                    );
                  })}
                  
                  <button
                    onClick={() => {
                      const nextIgnoreIndex = predefinedColumns.filter(c => c.id.startsWith('ignore')).length + 1;
                      setPredefinedColumns([
                        ...predefinedColumns,
                        { id: `ignore${nextIgnoreIndex}`, name: `Ignorar ${nextIgnoreIndex}`, color: 'bg-slate-500', borderColor: 'border-slate-500', textColor: 'text-slate-500' }
                      ]);
                    }}
                    className="w-full flex items-center justify-center p-3 rounded-xl border border-dashed border-slate-700 hover:border-slate-500 text-slate-400 hover:text-white transition-all text-xs font-bold uppercase tracking-widest mt-4"
                  >
                    + Adicionar Coluna a Ignorar
                  </button>
                </div>
              </section>

              {/* Horizontal Regions */}
              <section>
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Square className="w-3 h-3" /> Regiões Horizontais a Ignorar
                </h3>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    {predefinedHorizontalRegions.map(reg => {
                      const isActive = activeColumnId === reg.id;
                      const hasValue = horizontalRegions.some(r => r.id === reg.id && r.start !== r.end);
                      
                      return (
                        <button
                          key={reg.id}
                          onClick={() => setActiveColumnId(reg.id)}
                          className={`flex items-center gap-2 p-3 rounded-xl border transition-all text-left ${isActive ? `${reg.color} border-transparent text-white shadow-lg` : hasValue ? `bg-slate-800 ${reg.borderColor} ${reg.textColor}` : 'bg-slate-900 border-slate-700 text-slate-400 hover:bg-slate-800'}`}
                        >
                          <div className={`w-3 h-3 rounded bg-current ${hasValue ? 'opacity-100' : 'opacity-40'} flex-none`} />
                          <div className="flex-1 overflow-hidden">
                            <div className="text-[10px] font-bold uppercase tracking-wider truncate">{reg.name}</div>
                            <div className="text-[8px] opacity-75 truncate">{hasValue ? '✅ CONFIGURADO' : 'PENDENTE'}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  
                  <button
                    onClick={() => {
                      const nextIgnoreIndex = predefinedHorizontalRegions.filter(c => c.id.startsWith('h_ignore')).length + 1;
                      setPredefinedHorizontalRegions([
                        ...predefinedHorizontalRegions,
                        { id: `h_ignore${nextIgnoreIndex}`, name: `Ign. Linha ${nextIgnoreIndex}`, color: 'bg-orange-500', borderColor: 'border-orange-500', textColor: 'text-orange-500' }
                      ]);
                    }}
                    className="w-full flex items-center justify-center p-3 rounded-xl border border-dashed border-slate-700 hover:border-slate-500 text-slate-400 hover:text-white transition-all text-xs font-bold uppercase tracking-widest mt-4"
                  >
                    + Adicionar Linha a Ignorar
                  </button>
                </div>
              </section>

              {/* Extraction Rules */}
              <section>
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Info className="w-3 h-3" /> Regras de Extração
                </h3>
                <div className="space-y-4">
                  <div className="bg-slate-800/50 p-4 rounded-2xl border border-slate-700/50">
                    <label className="text-[10px] font-bold text-slate-500 uppercase mb-2 block">Tipo de Histórico</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button 
                        onClick={() => setHistoryMode('fixed')}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${historyMode === 'fixed' ? 'bg-blue-600 text-white' : 'bg-slate-900 text-slate-400 border border-slate-700'}`}
                      >
                        Fixo
                      </button>
                      <button 
                        onClick={() => setHistoryMode('smart')}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${historyMode === 'smart' ? 'bg-blue-600 text-white' : 'bg-slate-900 text-slate-400 border border-slate-700'}`}
                      >
                        Misto (Inteligente)
                      </button>
                    </div>
                  </div>

                  <div className="bg-slate-800/50 p-4 rounded-2xl border border-slate-700/50">
                    <label className="text-[10px] font-bold text-slate-500 uppercase mb-2 block">
                      {historyMode === 'fixed' ? 'Linhas de Histórico por Lançamento' : 'Limite de Linhas (Automático)'}
                    </label>
                    <div className="flex items-center gap-3">
                      <input 
                        type="number" 
                        min="1" 
                        max="10"
                        disabled={historyMode === 'smart'}
                        value={historyLines}
                        onChange={e => setHistoryLines(parseInt(e.target.value))}
                        className={`w-20 bg-slate-900 border border-slate-700 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500 ${historyMode === 'smart' ? 'opacity-50 cursor-not-allowed' : ''}`}
                      />
                      <span className="text-xs text-slate-400">linhas</span>
                    </div>
                    {historyMode === 'smart' && (
                      <p className="text-[9px] text-emerald-500 mt-2 italic font-medium">
                        * No modo misto, o sistema detecta automaticamente o fim do histórico analisando o espaço entre os valores.
                      </p>
                    )}
                  </div>
                  
                  <div className="bg-slate-800/50 p-4 rounded-2xl border border-slate-700/50">
                    <label className="text-[10px] font-bold text-slate-500 uppercase mb-2 block">Modo de Data</label>
                    <div className="grid grid-cols-1 gap-2">
                      <button 
                        onClick={() => setDateMode('one-per-tx')}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${dateMode === 'one-per-tx' ? 'bg-blue-600 text-white' : 'bg-slate-900 text-slate-400 border border-slate-700'}`}
                      >
                        Uma data por lançamento
                      </button>
                      <button 
                        onClick={() => setDateMode('one-for-many')}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${dateMode === 'one-for-many' ? 'bg-blue-600 text-white' : 'bg-slate-900 text-slate-400 border border-slate-700'}`}
                      >
                        Uma data para vários lançamentos
                      </button>
                    </div>
                  </div>

                  <div className="bg-slate-800/50 p-4 rounded-2xl border border-slate-700/50">
                    <label className="text-[10px] font-bold text-slate-500 uppercase mb-2 block">Limites de Página e Corte Horizontal (%)</label>
                    <div className="space-y-4">
                      <div>
                        <div className="flex justify-between items-center mb-2 gap-2">
                          <span className="text-[10px] text-emerald-500 font-bold uppercase">Pág. Inicial</span>
                          <input type="number" min="1" max={totalPages} value={startPage} onChange={e => setStartPage(Math.max(1, parseInt(e.target.value) || 1))} className="w-16 bg-slate-900 border border-emerald-500/50 rounded px-2 py-0.5 text-xs text-white outline-none" />
                          <div className="flex-1"></div>
                          <span className="text-[10px] text-slate-500">Corte Início: {startLine}%</span>
                        </div>
                        <input 
                          type="range" 
                          min="0" 
                          max="100" 
                          value={startLine}
                          onChange={e => setStartLine(parseInt(e.target.value))}
                          className="w-full accent-emerald-500"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between items-center mb-2 gap-2">
                          <span className="text-[10px] text-red-500 font-bold uppercase">Pág. Final</span>
                          <input type="number" min="1" max={totalPages} value={endPage} onChange={e => setEndPage(Math.max(1, parseInt(e.target.value) || 1))} className="w-16 bg-slate-900 border border-red-500/50 rounded px-2 py-0.5 text-xs text-white outline-none" />
                          <div className="flex-1"></div>
                          <span className="text-[10px] text-slate-500">Corte Fim: {endLine}%</span>
                        </div>
                        <input 
                          type="range" 
                          min="0" 
                          max="100" 
                          value={endLine}
                          onChange={e => setEndLine(parseInt(e.target.value))}
                          className="w-full accent-red-500"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-800/50 p-4 rounded-2xl border border-slate-700/50">
                    <label className="text-[10px] font-bold text-slate-500 uppercase mb-2 block">Salvar Configuração</label>
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        value={newLayoutName}
                        onChange={e => setNewLayoutName(e.target.value)}
                        placeholder="Nome do layout"
                        className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                      />
                      <button 
                        onClick={handleSaveLayout}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors"
                      >
                        <Save className="w-3 h-3" /> Salvar
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <button 
              onClick={handleConfirm}
              className="mt-8 w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-2xl uppercase tracking-widest transition-all shadow-xl shadow-blue-500/20 flex items-center justify-center gap-3"
            >
              <Play className="w-5 h-5 fill-white" /> Aplicar e Extrair
            </button>
          </div>
        </div>
      </div>

      {showConfig && (
        <div className="fixed inset-0 z-[400] bg-slate-900/95 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-3xl shadow-2xl border border-slate-700 w-full max-w-2xl p-8">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
                  <i className="fas fa-filter text-white"></i>
                </div>
                <div>
                  <h2 className="text-lg font-black text-white uppercase tracking-tight">Filtros de Histórico</h2>
                  <p className="text-slate-400 text-xs">Linhas que correspondam exatamente a estas palavras serão ignoradas</p>
                </div>
              </div>
              <button onClick={() => setShowConfig(false)} className="text-slate-400 hover:text-white transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="mb-6">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Palavras-chave (uma por linha)</label>
              <textarea
                value={ignoreWords}
                onChange={e => setIgnoreWords(e.target.value)}
                className="w-full h-64 bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-blue-500 transition-colors resize-none"
                placeholder="Ex:&#10;SALDO&#10;TOTAL&#10;RESUMO&#10;LIMITE"
              />
              <p className="text-[10px] text-slate-500 mt-2 italic">* Linhas que CONTENHAM qualquer uma das palavras acima serão descartadas (não precisa ser exato).</p>
            </div>

            <button
              onClick={() => setShowConfig(false)}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-2xl uppercase tracking-widest transition-all shadow-xl"
            >
              Salvar Configurações
            </button>
          </div>
        </div>
      )}

      {showSavedLayouts && (
        <div className="fixed inset-0 z-[400] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 rounded-[2rem] shadow-2xl border border-slate-800 w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
              <h2 className="text-xl font-black text-white tracking-tight uppercase flex items-center gap-3">
                <LayoutTemplate className="w-6 h-6 text-blue-500" /> Layouts Salvos
              </h2>
              <button onClick={() => setShowSavedLayouts(false)} className="p-2 hover:bg-slate-800 rounded-xl transition-colors text-slate-400 hover:text-white">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 border-b border-slate-800">
              <div className="relative">
                <Search className="w-5 h-5 text-slate-500 absolute left-4 top-1/2 -translate-y-1/2" />
                <input 
                  type="text" 
                  value={layoutSearch}
                  onChange={e => setLayoutSearch(e.target.value)}
                  placeholder="Buscar layout..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-12 pr-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              {filteredLayouts.length === 0 ? (
                <div className="text-center text-slate-500 py-10">
                  Nenhum layout encontrado.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {filteredLayouts.map(layout => (
                    <div key={layout.id} className="bg-slate-800/50 border border-slate-700 rounded-2xl p-4 hover:border-blue-500 transition-colors cursor-pointer group relative" onClick={() => handleLoadLayout(layout)}>
                      <button 
                        onClick={(e) => handleDeleteLayout(e, layout.id)}
                        className="absolute top-4 right-4 p-1.5 bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white rounded-lg transition-all"
                        title="Excluir Layout"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <h3 className="text-white font-bold mb-2 pr-8">{layout.name}</h3>
                      <div className="h-24 bg-slate-950 rounded-xl border border-slate-800 relative overflow-hidden mb-3">
                        {/* Mini representation of columns */}
                        {layout.config.columns.map(col => {
                          const pCol = predefinedColumns.find(p => p.id === col.id);
                          // Assuming a standard width of 1000 for the mini representation if we don't know the original image size
                          // We'll just use the relative positions if they are small, but they are absolute pixels.
                          // Let's just show colored blocks proportionally if we can, or just a list of columns.
                          return (
                            <div key={col.id} className="flex items-center gap-2 mb-1 px-2 pt-1">
                              <div className={`w-3 h-3 rounded-full ${pCol?.color || 'bg-slate-500'}`}></div>
                              <span className="text-[10px] text-slate-400">{pCol?.name || col.id}</span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="text-[10px] text-slate-500 flex justify-between">
                        <span>{new Date(layout.createdAt).toLocaleDateString()}</span>
                        <span className="text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity">Carregar Layout &rarr;</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
