import type { ExtratoFaixaPaginaSaved, ExtratoOcrLayoutSaved } from './extratoOcrLayoutStorage';

export type PageFaixaSnapshot = {
  columns: import('../../lib/parcelamentoColunasExtract').GenericColunaDef[];
  faixaStart: number;
  faixaEnd: number;
  faixaInicioMarcado: boolean;
  faixaFimMarcado: boolean;
  semDelimitacaoVertical: boolean;
  imgWidth: number;
  imgHeight: number;
};

export function pageSnapshotHasFaixa(snap: PageFaixaSnapshot | undefined): boolean {
  if (!snap) return false;
  return snap.faixaInicioMarcado || snap.faixaFimMarcado || snap.semDelimitacaoVertical;
}

/** Coleta faixa normalizada de cada página mapeada (verde na pág. 1, vermelha na última, etc.). */
export function collectFaixaPorPaginaFromStates(
  pageStates: Map<number, PageFaixaSnapshot>,
): Record<string, ExtratoFaixaPaginaSaved> {
  const out: Record<string, ExtratoFaixaPaginaSaved> = {};
  for (const [page, snap] of pageStates.entries()) {
    if (!pageSnapshotHasFaixa(snap)) continue;
    const h = snap.imgHeight;
    if (h <= 0) continue;
    out[String(page)] = {
      faixaStartNorm: snap.faixaStart / h,
      faixaEndNorm: snap.faixaEnd / h,
      faixaInicioMarcado: snap.faixaInicioMarcado,
      faixaFimMarcado: snap.faixaFimMarcado,
      semDelimitacaoVertical: snap.semDelimitacaoVertical,
    };
  }
  return out;
}

/** Layouts antigos: início na pág. 1, fim na última página conhecida ao salvar. */
export function resolveFaixaPorPaginaFromLayout(
  layout: ExtratoOcrLayoutSaved,
  totalPages = 1,
): Record<string, ExtratoFaixaPaginaSaved> {
  if (layout.faixaPorPagina && Object.keys(layout.faixaPorPagina).length > 0) {
    return layout.faixaPorPagina;
  }

  const h = layout.imgHeight;
  if (h <= 0) return {};

  const startN =
    layout.faixaStartNorm != null ? layout.faixaStartNorm : layout.faixaStart / h;
  const endN = layout.faixaEndNorm != null ? layout.faixaEndNorm : layout.faixaEnd / h;
  const out: Record<string, ExtratoFaixaPaginaSaved> = {};

  if (layout.faixaInicioMarcado && !layout.semDelimitacaoVertical) {
    out['1'] = {
      faixaStartNorm: startN,
      faixaEndNorm: 1,
      faixaInicioMarcado: true,
      faixaFimMarcado: false,
      semDelimitacaoVertical: false,
    };
  }

  if (layout.faixaFimMarcado && !layout.semDelimitacaoVertical) {
    const fimPage = layout.faixaFimPagina ?? totalPages;
    out[String(fimPage)] = {
      faixaStartNorm: 0,
      faixaEndNorm: endN,
      faixaInicioMarcado: false,
      faixaFimMarcado: true,
      semDelimitacaoVertical: false,
    };
  }

  if (layout.semDelimitacaoVertical) {
    out['1'] = {
      faixaStartNorm: 0,
      faixaEndNorm: 1,
      faixaInicioMarcado: false,
      faixaFimMarcado: false,
      semDelimitacaoVertical: true,
    };
  }

  return out;
}

export function findFaixaInicioPagina(
  faixaPorPagina: Record<string, ExtratoFaixaPaginaSaved>,
): number {
  const pages = Object.entries(faixaPorPagina)
    .filter(([, f]) => f.faixaInicioMarcado)
    .map(([p]) => Number(p))
    .filter((p) => Number.isFinite(p) && p >= 1);
  return pages.length > 0 ? Math.min(...pages) : 1;
}

export function findFaixaFimPagina(
  faixaPorPagina: Record<string, ExtratoFaixaPaginaSaved>,
  totalPages: number,
): number {
  const pages = Object.entries(faixaPorPagina)
    .filter(([, f]) => f.faixaFimMarcado)
    .map(([p]) => Number(p))
    .filter((p) => Number.isFinite(p) && p >= 1);
  return pages.length > 0 ? Math.max(...pages) : totalPages;
}

/** Intervalo de páginas para extração (verde → vermelho, ou documento inteiro). */
export function resolveExtractPageRange(
  pageStates: Map<number, PageFaixaSnapshot>,
  totalPages: number,
): { startPage: number; endPage: number } {
  const safeTotal = Math.max(1, totalPages);
  const faixaPorPagina = collectFaixaPorPaginaFromStates(pageStates);
  let startPage = findFaixaInicioPagina(faixaPorPagina);
  let endPage = findFaixaFimPagina(faixaPorPagina, safeTotal);
  startPage = Math.min(Math.max(1, startPage), safeTotal);
  endPage = Math.min(Math.max(startPage, endPage), safeTotal);
  return { startPage, endPage };
}

/** Repõe pageStates a partir do layout salvo (coordenadas absolutas na altura de cada página). */
export function applyFaixaPorPaginaToStates(
  faixaPorPagina: Record<string, ExtratoFaixaPaginaSaved>,
  pageStates: Map<number, PageFaixaSnapshot>,
  columns: PageFaixaSnapshot['columns'],
  refW: number,
  refH: number,
): void {
  for (const [key, faixa] of Object.entries(faixaPorPagina)) {
    const page = Number(key);
    if (!Number.isFinite(page) || page < 1) continue;
    const existing = pageStates.get(page);
    const h = existing?.imgHeight && existing.imgHeight > 0 ? existing.imgHeight : refH;
    const w = existing?.imgWidth && existing.imgWidth > 0 ? existing.imgWidth : refW;
    if (h <= 0) continue;

    pageStates.set(page, {
      columns: existing?.columns?.length ? existing.columns : columns,
      faixaStart: faixa.faixaStartNorm * h,
      faixaEnd: faixa.faixaEndNorm * h,
      faixaInicioMarcado: faixa.faixaInicioMarcado,
      faixaFimMarcado: faixa.faixaFimMarcado,
      semDelimitacaoVertical: faixa.semDelimitacaoVertical ?? false,
      imgWidth: w,
      imgHeight: h,
    });
  }
}

/** Prévia UI: só a faixa marcada NA própria página. */
export function buildPageMappingSnapshotForUi(
  pageStates: Map<number, PageFaixaSnapshot>,
  page: number,
  refW: number,
  refH: number,
  preferPage1Columns = page > 1,
): PageFaixaSnapshot | null {
  const columnTemplate = resolveColumnTemplate(pageStates, page, preferPage1Columns);
  if (!columnTemplate) return null;

  const scaledCols = scaleSnapshot(columnTemplate, refW, refH);
  const own = pageStates.get(page);

  if (own && pageSnapshotHasFaixa(own)) {
    const scaledOwn = scaleSnapshot(own, refW, refH);
    return {
      columns: scaledCols.columns,
      faixaStart: scaledOwn.faixaStart,
      faixaEnd: scaledOwn.faixaEnd,
      faixaInicioMarcado: scaledOwn.faixaInicioMarcado,
      faixaFimMarcado: scaledOwn.faixaFimMarcado,
      semDelimitacaoVertical: scaledOwn.semDelimitacaoVertical,
      imgWidth: refW,
      imgHeight: refH,
    };
  }

  return {
    columns: scaledCols.columns,
    faixaStart: 0,
    faixaEnd: refH,
    faixaInicioMarcado: false,
    faixaFimMarcado: false,
    semDelimitacaoVertical: false,
    imgWidth: refW,
    imgHeight: refH,
  };
}

/** Extração: início da pág. 1 (ou da página com verde), fim na última (ou página com vermelho). */
export function buildPageMappingSnapshotForExtract(
  pageStates: Map<number, PageFaixaSnapshot>,
  page: number,
  totalPages: number,
  refW: number,
  refH: number,
  preferPage1Columns = true,
): PageFaixaSnapshot | null {
  const columnTemplate = resolveColumnTemplate(pageStates, page, preferPage1Columns);
  if (!columnTemplate) return null;

  const scaledCols = scaleSnapshot(columnTemplate, refW, refH);
  const own = pageStates.get(page);
  const p1 = pageStates.get(1);

  if (own?.semDelimitacaoVertical || p1?.semDelimitacaoVertical) {
    return {
      columns: scaledCols.columns,
      faixaStart: 0,
      faixaEnd: refH,
      faixaInicioMarcado: false,
      faixaFimMarcado: false,
      semDelimitacaoVertical: true,
      imgWidth: refW,
      imgHeight: refH,
    };
  }

  let faixaStart = 0;
  let faixaEnd = refH;
  let faixaInicioMarcado = false;
  let faixaFimMarcado = false;

  const faixaPorPagina = collectFaixaPorPaginaFromStates(pageStates);
  const inicioPage = findFaixaInicioPagina(faixaPorPagina);
  const fimPage = findFaixaFimPagina(faixaPorPagina, totalPages);
  const inicioState = pageStates.get(inicioPage);
  const fimState = pageStates.get(fimPage);

  if (page === inicioPage && inicioState?.faixaInicioMarcado) {
    faixaStart = scaleY(inicioState.faixaStart, inicioState.imgHeight, refH);
    faixaInicioMarcado = true;
  }

  if (page === fimPage && fimState?.faixaFimMarcado) {
    faixaEnd = scaleY(fimState.faixaEnd, fimState.imgHeight, refH);
    faixaFimMarcado = true;
  }

  return {
    columns: scaledCols.columns,
    faixaStart,
    faixaEnd,
    faixaInicioMarcado,
    faixaFimMarcado,
    semDelimitacaoVertical: false,
    imgWidth: refW,
    imgHeight: refH,
  };
}

export function resolveFaixaVerticalFromSnapshot(
  snap: PageFaixaSnapshot,
  refH: number,
): { startY: number; endY: number } | undefined {
  if (snap.semDelimitacaoVertical) return undefined;
  if (!snap.faixaInicioMarcado && !snap.faixaFimMarcado) return undefined;
  const y0 = snap.faixaInicioMarcado ? Math.min(snap.faixaStart, snap.faixaEnd) : 0;
  const y1 = snap.faixaFimMarcado ? Math.max(snap.faixaStart, snap.faixaEnd) : refH;
  if (y1 <= y0 + 2) return undefined;
  return { startY: y0, endY: y1 };
}

export function isStrictFaixaSnapshot(snap: PageFaixaSnapshot): boolean {
  return (
    !snap.semDelimitacaoVertical && snap.faixaInicioMarcado && snap.faixaFimMarcado
  );
}

/** Início/fim marcados em qualquer página do PDF (ex.: verde pág. 1 + vermelha na última). */
export function collectFaixaMarcadoresGlobais(
  pageStates: Map<number, PageFaixaSnapshot>,
  current: Pick<PageFaixaSnapshot, 'faixaInicioMarcado' | 'faixaFimMarcado' | 'semDelimitacaoVertical'>,
): { inicioMarcado: boolean; fimMarcado: boolean; semDelimitacaoVertical: boolean } {
  if (current.semDelimitacaoVertical) {
    return { inicioMarcado: false, fimMarcado: false, semDelimitacaoVertical: true };
  }
  let inicioMarcado = current.faixaInicioMarcado;
  let fimMarcado = current.faixaFimMarcado;
  for (const snap of pageStates.values()) {
    if (snap.semDelimitacaoVertical) {
      return { inicioMarcado: false, fimMarcado: false, semDelimitacaoVertical: true };
    }
    if (snap.faixaInicioMarcado) inicioMarcado = true;
    if (snap.faixaFimMarcado) fimMarcado = true;
  }
  return { inicioMarcado, fimMarcado, semDelimitacaoVertical: false };
}

function snapshotHasMappedColumns(snap: PageFaixaSnapshot): boolean {
  return snap.columns.some((c) => !c.id.startsWith('ignorar') && c.start !== c.end);
}

/** Colunas mapeadas na página (para herança multi-página). */
export function pageSnapshotHasMappedColumns(snap: PageFaixaSnapshot | undefined): boolean {
  return !!snap && snapshotHasMappedColumns(snap);
}

/** Escala colunas absolutas da página de referência para outra largura de imagem. */
export function scaleColumnBoundsToPageWidth(
  columns: PageFaixaSnapshot['columns'],
  sourceWidth: number,
  targetWidth: number,
): PageFaixaSnapshot['columns'] {
  if (sourceWidth <= 0 || targetWidth <= 0 || Math.abs(sourceWidth - targetWidth) < 0.5) {
    return columns.map((c) => ({ ...c }));
  }
  const sx = targetWidth / sourceWidth;
  return columns.map((c) =>
    c.start === c.end && c.start === 0
      ? c
      : { ...c, start: c.start * sx, end: c.end * sx },
  );
}

function resolveColumnTemplate(
  pageStates: Map<number, PageFaixaSnapshot>,
  page: number,
  preferPage1Columns: boolean,
): PageFaixaSnapshot | undefined {
  const fromFirst = pageStates.get(1);
  if (page > 1 && fromFirst && snapshotHasMappedColumns(fromFirst)) {
    return fromFirst;
  }
  if (preferPage1Columns) {
    if (fromFirst && snapshotHasMappedColumns(fromFirst)) return fromFirst;
  }
  const own = pageStates.get(page);
  if (own && snapshotHasMappedColumns(own)) return own;
  if (fromFirst && snapshotHasMappedColumns(fromFirst)) return fromFirst;
  for (const [num, snap] of [...pageStates.entries()].sort(([a], [b]) => a - b)) {
    if (num !== page && snapshotHasMappedColumns(snap)) return snap;
  }
  return own ?? fromFirst;
}

function scaleY(value: number, fromH: number, toH: number): number {
  if (fromH <= 0 || toH <= 0 || fromH === toH) return value;
  return value * (toH / fromH);
}

function scaleSnapshot(snap: PageFaixaSnapshot, newW: number, newH: number): PageFaixaSnapshot {
  if (snap.imgWidth <= 0 || snap.imgHeight <= 0 || (snap.imgWidth === newW && snap.imgHeight === newH)) {
    return snap;
  }
  const sx = newW / snap.imgWidth;
  const sy = newH / snap.imgHeight;
  return {
    ...snap,
    imgWidth: newW,
    imgHeight: newH,
    faixaStart: snap.faixaStart * sy,
    faixaEnd: snap.faixaEnd * sy,
    columns: snap.columns.map((col) => ({
      ...col,
      start: col.start * sx,
      end: col.end * sx,
    })),
  };
}
