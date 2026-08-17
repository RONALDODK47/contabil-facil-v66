/**
 * Tabela genérica de recortes (N colunas) — lado a lado: imagens + campos editáveis.
 * Paginação obrigatória em volumes grandes (ex.: plano de contas com 900+ linhas).
 */

import React from 'react';
import { ChevronLeft, ChevronRight, FileSpreadsheet, Filter, HelpCircle, Image, PencilLine, Plus, Trash2, X } from 'lucide-react';
import type { GenericExtractedRow, LeitorColumnDef, RenderedPDFPage } from '../../../lib/leitorRecortador/types';
import { loadSavedTextFilterRules, saveTextFilterRules } from '../../../lib/leitorRecortador/savedTextFilters';
import { DynamicStyleTable, DynamicStyleTh } from '../../lib/dynamicStyle';

interface CellCropImageProps {
  canvas: HTMLCanvasElement | null | undefined;
  bounds: { x: number; y: number; w: number; h: number } | null | undefined;
  alt: string;
  invert?: boolean;
}

function CellCropImage({ canvas, bounds, alt, invert }: CellCropImageProps) {
  const [url, setUrl] = React.useState<string>('');

  React.useEffect(() => {
    if (!canvas || !bounds) {
      setUrl('');
      return;
    }
    try {
      const docWidth = canvas.width;
      const docHeight = canvas.height;
      const x = Math.max(0, Math.min(bounds.x, docWidth - 1));
      const y = Math.max(0, Math.min(bounds.y, docHeight - 1));
      const w = Math.max(1, Math.min(bounds.w, docWidth - x));
      const h = Math.max(1, Math.min(bounds.h, docHeight - y));

      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = w;
      cropCanvas.height = h;
      const cropCtx = cropCanvas.getContext('2d');
      if (cropCtx) {
        cropCtx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
        setUrl(cropCanvas.toDataURL('image/png'));
      }
    } catch (e) {
      console.error('Lazy crop error:', e);
      setUrl('');
    }
  }, [canvas, bounds]);

  if (!url) {
    return <span className="text-[10px] text-brand-text/40 italic">Carregando...</span>;
  }

  const scale = canvas ? (canvas.width > 1000 ? 2.0 : 1.0) : 1.0;
  const displayHeight = bounds ? bounds.h / scale : 36;

  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      style={{
        height: `${displayHeight}px`,
        maxHeight: '40px',
        width: 'auto',
        maxWidth: '100%',
        imageRendering: 'auto',
      }}
      className={`${invert ? 'invert hue-rotate-180 brightness-125' : ''}`}
    />
  );
}

interface TableViewerProps {
  rows: GenericExtractedRow[];
  setRows: React.Dispatch<React.SetStateAction<GenericExtractedRow[]>>;
  columnDefs: LeitorColumnDef[];
  exclusionRules: string[];
  setExclusionRules: React.Dispatch<React.SetStateAction<string[]>>;
  fileName?: string;
  pdfPages?: RenderedPDFPage[];
  /** Escopo (ex.: empresa + tipo de documento) usado para Salvar/Carregar os filtros
   * manualmente — nunca preenche os filtros sozinho, só quando o usuário clica em
   * "Carregar salvos". */
  filterStorageScope?: string;
}

const PAGE_SIZE = 40;
/** Altura fixa por linha — igual nas duas tabelas (imagem/texto) para manter alinhamento exato. */
const ROW_H = 56;
const rowCellStyle: React.CSSProperties = { height: ROW_H, boxSizing: 'border-box' };

export function GenericLeitorTable({
  rows,
  setRows,
  columnDefs,
  exclusionRules,
  setExclusionRules,
  fileName,
  pdfPages,
  filterStorageScope = '',
}: TableViewerProps) {
  const [invertCrops, setInvertCrops] = React.useState(false);
  const [hoveredRowId, setHoveredRowId] = React.useState<string | null>(null);
  const [newRule, setNewRule] = React.useState('');
  const [page, setPage] = React.useState(0);
  const [showCrops, setShowCrops] = React.useState(true);

  const filteredRows = React.useMemo(() => {
    return rows.filter((row) => {
      const textToSearch = columnDefs.map((c) => row.fields[c.id] || '').join(' ').toUpperCase();
      return !exclusionRules.some((rule) => {
        if (!rule.trim()) return false;
        const ruleUpper = rule.trim().toUpperCase();

        // Se a regra tem espaços, busca exata da frase (contém a frase completa)
        // Se a regra é só uma palavra, busca parcial (word-like, pode ter simbolos anexos)
        if (ruleUpper.includes(' ')) {
          // Busca exata: "IOF BLOQUEADO" só encontra "IOF BLOQUEADO", não "IOF" sozinho
          return textToSearch.includes(ruleUpper);
        } else {
          // Busca parcial com word boundary: "IOF" encontra "IOF/2-3", "DÉB.IOF", etc
          // mas não encontraria algo como "IOFX" se fosse só "IOF" (protege de substrings acidentais)
          const wordBoundaryRegex = new RegExp(`\\b${ruleUpper}\\b|${ruleUpper}[^A-Z0-9]|[^A-Z0-9]${ruleUpper}\\b`);
          return wordBoundaryRegex.test(textToSearch);
        }
      });
    });
  }, [rows, columnDefs, exclusionRules]);

  const excludedRowsCount = rows.length - filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filteredRows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const pageStart = filteredRows.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const pageEnd = Math.min(filteredRows.length, (safePage + 1) * PAGE_SIZE);

  React.useEffect(() => {
    setPage(0);
  }, [exclusionRules, rows.length]);

  React.useEffect(() => {
    if (page > totalPages - 1) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);

  const handleAddRule = (ruleText: string) => {
    const trimmed = ruleText.trim();
    if (!trimmed) return;
    if (exclusionRules.some((r) => r.toUpperCase() === trimmed.toUpperCase())) {
      setNewRule('');
      return;
    }
    setExclusionRules((prev) => [...prev, trimmed]);
    setNewRule('');
  };

  const handleRemoveRule = (ruleToRemove: string) => {
    setExclusionRules((prev) => prev.filter((r) => r !== ruleToRemove));
  };

  const handleSaveExclusionRules = () => {
    saveTextFilterRules(filterStorageScope, 'exclusao', exclusionRules);
  };
  const handleLoadExclusionRules = () => {
    setExclusionRules(loadSavedTextFilterRules(filterStorageScope, 'exclusao'));
  };

  const handleFieldChange = (rowId: string, fieldId: string, newVal: string) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row;
        return {
          ...row,
          fields: { ...row.fields, [fieldId]: newVal },
        };
      }),
    );
  };

  const handleDeleteRow = (rowId: string) => {
    setRows((prev) => prev.filter((row) => row.id !== rowId));
  };

  const handleAddRow = () => {
    const fields: Record<string, string> = {};
    const cropUrls: Record<string, string> = {};
    columnDefs.forEach((c) => {
      fields[c.id] = '';
      cropUrls[c.id] = '';
    });
    setRows((prev) => [
      ...prev,
      {
        id: `manual-row-${Date.now()}`,
        fields,
        cropUrls,
        y: 0,
        height: 0,
      },
    ]);
  };

  const handleClearAll = () => {
    if (rows.length === 0) return;
    if (window.confirm('Limpar todas as linhas recortadas?')) {
      setRows([]);
    }
  };

  const colMinWidth = Math.max(80, Math.floor(520 / Math.max(1, columnDefs.length)));

  return (
    <div className="bg-white border border-brand-border shadow-[2px_2px_0_0_#141414] overflow-hidden flex flex-col flex-1 min-h-0 w-full h-full">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-white border-b border-brand-border shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <FileSpreadsheet className="w-4 h-4 text-brand-text/60" />
          <h2 className="font-semibold text-brand-text text-sm">Dados Recortados & Tabelados</h2>
          {fileName ? <span className="text-[10px] opacity-50 truncate max-w-[200px]">{fileName}</span> : null}
          {rows.length > 0 && (
            <span className="text-xs bg-brand-sidebar text-brand-text font-semibold px-2 py-0.5 border border-brand-border">
              {filteredRows.length} {filteredRows.length === 1 ? 'linha' : 'linhas'}
              {excludedRowsCount > 0 ? (
                <span className="text-[10px] text-amber-600 font-medium ml-1.5 border-l border-brand-border pl-1.5">
                  ({excludedRowsCount} filtrada{excludedRowsCount === 1 ? '' : 's'})
                </span>
              ) : null}
            </span>
          )}
        </div>
        {rows.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setShowCrops((v) => !v)}
              className={`technical-button flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                showCrops ? 'bg-brand-sidebar text-brand-text' : 'text-brand-text/60'
              }`}
            >
              {showCrops ? 'Ocultar imagens' : 'Mostrar imagens'}
            </button>
            <button
              type="button"
              onClick={() => setInvertCrops(!invertCrops)}
              disabled={!showCrops}
              className={`technical-button flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold cursor-pointer disabled:opacity-40 ${
                invertCrops ? 'bg-brand-sidebar text-brand-text' : 'text-brand-text/60'
              }`}
            >
              Inverter cores
            </button>
            <button
              type="button"
              onClick={handleAddRow}
              className="technical-button flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold"
            >
              <Plus className="w-3.5 h-3.5" />
              Inserir Linha
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              className="technical-button flex items-center gap-1.5 px-2.5 py-1 text-rose-600 text-[11px] font-semibold hover:bg-rose-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Limpar Tudo
            </button>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className="px-4 py-2 bg-white/60 border-b border-brand-border flex flex-wrap items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5 text-amber-700">
            <Filter className="w-3.5 h-3.5" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Filtros</span>
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={handleSaveExclusionRules}
              className="technical-button px-2 py-1 text-[9px] font-bold uppercase"
              title="Salvar esta lista de filtros para reutilizar depois"
            >
              Salvar
            </button>
            <button
              type="button"
              onClick={handleLoadExclusionRules}
              className="technical-button px-2 py-1 text-[9px] font-bold uppercase"
              title="Carregar a última lista de filtros salva (não é automático)"
            >
              Carregar salvos
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleAddRule(newRule);
            }}
            className="flex gap-1.5 items-center"
          >
            <input
              type="text"
              value={newRule}
              onChange={(e) => setNewRule(e.target.value)}
              placeholder="Ex: TOTAL"
              className="w-36 text-xs font-semibold bg-white border border-brand-border px-2 py-1 text-brand-text outline-none"
            />
            <button type="submit" className="technical-button-primary px-2.5 py-1 text-[10px] font-bold">
              Adicionar
            </button>
          </form>
          <div className="flex flex-wrap gap-1 items-center flex-1 min-w-0">
            {exclusionRules.length === 0 ? (
              <span className="text-[10px] text-brand-text/50 italic">Nenhum filtro ativo</span>
            ) : (
              exclusionRules.map((rule, idx) => (
                <div
                  key={`${rule}-${idx}`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-brand-sidebar/50 text-brand-text border border-brand-border text-[10px] font-semibold"
                >
                  <span>{rule}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveRule(rule)}
                    className="p-0.5 hover:bg-rose-50 hover:text-rose-600 text-brand-text cursor-pointer"
                    aria-label={`Remover filtro ${rule}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto bg-brand-bg p-3 overscroll-contain">
        {rows.length > 0 ? (
          <div
            className={`grid gap-4 items-start pb-2 ${
              showCrops ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'
            }`}
          >
            {showCrops ? (
              <div className="flex flex-col gap-1.5 min-w-0">
                <h3 className="text-[10px] font-bold text-brand-text uppercase tracking-wider px-1 flex items-center gap-1">
                  <Image className="w-3 h-3 shrink-0" aria-hidden />
                  Imagens originais (recorte) — pág. {safePage + 1}
                </h3>
                <div className="overflow-x-auto border border-brand-border bg-brand-sidebar/30 shadow-[2px_2px_0_0_#141414]">
                  <DynamicStyleTable
                    className="w-full text-left border-collapse"
                    layout={{ minWidth: columnDefs.length * colMinWidth + 40 }}
                    layoutDeps={[columnDefs.length, colMinWidth]}
                  >
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-white border-b border-brand-border text-[10px] font-bold text-brand-text/60 uppercase tracking-wider">
                        <th className="py-2 px-2 w-10 text-center">Nº</th>
                        {columnDefs.map((c) => (
                          <DynamicStyleTh
                            key={c.id}
                            className="py-2 px-2"
                            layout={{ minWidth: colMinWidth }}
                            layoutDeps={[colMinWidth]}
                          >
                            {c.name}
                          </DynamicStyleTh>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((row, index) => {
                        const rowNum = safePage * PAGE_SIZE + index + 1;
                        return (
                          <tr
                            key={`crop-${row.id}`}
                            onMouseEnter={() => setHoveredRowId(row.id)}
                            onMouseLeave={() => setHoveredRowId(null)}
                            className={`border-b border-brand-border ${
                              hoveredRowId === row.id ? 'bg-brand-sidebar/40' : 'hover:bg-brand-sidebar/20'
                            }`}
                          >
                            <td className="px-2 text-center text-xs font-mono text-brand-text/50 font-bold">
                              <div className="flex items-center justify-center" style={rowCellStyle}>
                                {rowNum}
                              </div>
                            </td>
                            {columnDefs.map((c) => {
                              const url = row.cropUrls[c.id];
                              const bounds = row.cropBounds?.[c.id];
                              const pageCanvas = row.pageNumber
                                ? pdfPages?.find((p) => p.pageNumber === row.pageNumber)?.canvas
                                : null;
                              return (
                                <td key={c.id} className="px-2">
                                  <div className="flex items-center justify-center" style={rowCellStyle}>
                                    {url ? (
                                      <div className="bg-white p-1 border border-brand-border flex items-center justify-center max-w-full overflow-hidden h-11">
                                        <img
                                          src={url}
                                          alt={`Recorte ${c.name}`}
                                          loading="lazy"
                                          className={`max-h-10 object-contain ${
                                            invertCrops ? 'invert hue-rotate-180 brightness-125' : ''
                                          }`}
                                        />
                                      </div>
                                    ) : bounds && pageCanvas ? (
                                      <div className="bg-white p-1 border border-brand-border flex items-center justify-center max-w-full overflow-hidden h-11">
                                        <CellCropImage
                                          canvas={pageCanvas}
                                          bounds={bounds}
                                          alt={`Recorte ${c.name}`}
                                          invert={invertCrops}
                                        />
                                      </div>
                                    ) : (
                                      <div className="text-[10px] text-brand-text/40 italic flex items-center justify-center">
                                        Sem recorte
                                      </div>
                                    )}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </DynamicStyleTable>
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5 min-w-0">
              <h3 className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider px-1 flex items-center gap-1">
                <PencilLine className="w-3 h-3 shrink-0" aria-hidden />
                Dados convertidos (editável) — {pageStart}–{pageEnd} de {filteredRows.length}
              </h3>
              <div className="overflow-x-auto border border-brand-border bg-brand-sidebar/30 shadow-[2px_2px_0_0_#141414]">
                <DynamicStyleTable
                  className="w-full text-left border-collapse"
                  layout={{ minWidth: columnDefs.length * colMinWidth + 80 }}
                  layoutDeps={[columnDefs.length, colMinWidth]}
                >
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-white border-b border-brand-border text-[10px] font-bold text-brand-text/60 uppercase tracking-wider">
                      <th className="py-2 px-2 w-10 text-center">Nº</th>
                      {columnDefs.map((c) => (
                        <DynamicStyleTh
                          key={c.id}
                          className="py-2 px-2"
                          layout={{ minWidth: colMinWidth }}
                          layoutDeps={[colMinWidth]}
                        >
                          {c.name}
                        </DynamicStyleTh>
                      ))}
                      <th className="py-2 px-2 w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((row, index) => {
                      const rowNum = safePage * PAGE_SIZE + index + 1;
                      return (
                        <tr
                          key={row.id}
                          onMouseEnter={() => setHoveredRowId(row.id)}
                          onMouseLeave={() => setHoveredRowId(null)}
                          className={`border-b border-brand-border ${
                            hoveredRowId === row.id ? 'bg-brand-sidebar/40' : 'hover:bg-brand-sidebar/20'
                          }`}
                        >
                          <td className="px-2 text-center text-xs font-mono text-brand-text/50 font-bold">
                            <div className="flex items-center justify-center" style={rowCellStyle}>
                              {rowNum}
                            </div>
                          </td>
                          {columnDefs.map((c) => (
                            <td key={c.id} className="px-2">
                              <div className="flex items-center" style={rowCellStyle}>
                                <input
                                  type="text"
                                  value={row.fields[c.id] || ''}
                                  onChange={(e) => handleFieldChange(row.id, c.id, e.target.value)}
                                  className="text-xs font-medium text-brand-text bg-white border border-brand-border px-2 py-1 outline-none w-full"
                                  placeholder={c.name}
                                  aria-label={`${c.name} linha ${rowNum}`}
                                />
                              </div>
                            </td>
                          ))}
                          <td className="px-2 text-center">
                            <div className="flex items-center justify-center" style={rowCellStyle}>
                              <button
                                type="button"
                                onClick={() => handleDeleteRow(row.id)}
                                className="p-1 text-brand-text/40 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                                title="Remover linha"
                                aria-label={`Remover linha ${rowNum}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </DynamicStyleTable>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center text-center p-12 bg-white max-w-lg mx-auto my-8 border border-brand-border min-h-[280px]">
            <div className="w-14 h-14 bg-brand-sidebar text-brand-text/50 flex items-center justify-center mb-4 border border-brand-border shadow-[2px_2px_0_0_#141414]">
              <FileSpreadsheet className="w-7 h-7" />
            </div>
            <h3 className="font-semibold text-brand-text text-sm mb-1.5">Tabela vazia</h3>
            <p className="text-brand-text/60 text-xs leading-relaxed mb-6">
              Alinhe as colunas e clique em <strong>Recortar Documento</strong> para preencher a tabela.
            </p>
            <button type="button" onClick={handleAddRow} className="technical-button px-4 py-2 font-semibold text-xs">
              Inserir linha manual
            </button>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className="px-4 py-2 bg-white border-t border-brand-border flex flex-wrap items-center justify-between gap-2 shrink-0">
          <p className="text-[10px] text-brand-text/60 inline-flex items-center gap-1.5">
            <HelpCircle className="w-3 h-3" />
            Edite os campos antes de confirmar a importação.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage <= 0}
              className="technical-button p-1.5 disabled:opacity-40"
              aria-label="Página anterior"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[10px] font-bold uppercase tabular-nums">
              Página {safePage + 1} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              className="technical-button p-1.5 disabled:opacity-40"
              aria-label="Próxima página"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
