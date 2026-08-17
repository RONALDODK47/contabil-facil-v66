/**
 * Extração extrato — mesmo pipeline do DocumentColunasModal (OCR + colunas manuais + auditoria).
 */
import type { GenericColunaDef, GenericOcrRow, PdfPagePreviewResult } from './parcelamentoColunasExtract';
import {
  extractGenericRowsFromMapping,
  mappingGenericoEmCoordsOcr,
  recoverExtratoPageRowsComAuditoria,
} from './parcelamentoColunasExtract';
import { extractStatementYear } from '../extratoVision/utils/parser';
import {
  enrichItauExtratoRowsFromPageItems,
  injectDataColumnIfMissing,
  mergeExtratoValorColumnsParaMisto,
} from './pdfNativeTextItems';
import {
  enrichExtratoHistoricoLinhaOcrFromPageItems,
  resolveExtratoValorColBoundsFromColumns,
} from './ocrExtratoPositional';
import { getItauExtratoExtractGenericOptions } from './itauExtratoProfile';

export type ExtratoPageMappingSnapshot = {
  columns: GenericColunaDef[];
  faixaStart: number;
  faixaEnd: number;
  faixaInicioMarcado: boolean;
  faixaFimMarcado: boolean;
  imgWidth: number;
  imgHeight: number;
};

function extratoColumnPad(items: { h: number }[]): number {
  const heights = items.map((i) => i.h).filter((h) => h > 0).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 12;
  return Math.max(10, medianH * 0.9);
}

/** Mesma lógica de columnsParaExtratoItau no modal. */
export function columnsParaExtratoItauModal(
  cols: GenericColunaDef[],
  items: PdfPagePreviewResult['items'],
  imgWidth: number,
): GenericColunaDef[] {
  if (items.length === 0 || imgWidth <= 0) return cols;
  const pad = extratoColumnPad(items);
  const withData = injectDataColumnIfMissing(cols, items, imgWidth, pad);
  return mergeExtratoValorColumnsParaMisto(withData, items, imgWidth, pad);
}

export function resolveFaixaFromSnapshot(
  snap: ExtratoPageMappingSnapshot,
  pageImgHeight: number,
): { startY: number; endY: number } | undefined {
  if (!snap.faixaInicioMarcado && !snap.faixaFimMarcado) return undefined;
  const sy = pageImgHeight / (snap.imgHeight || pageImgHeight || 1);
  return {
    startY: Math.min(snap.faixaStart, snap.faixaEnd) * sy,
    endY: Math.max(snap.faixaStart, snap.faixaEnd) * sy,
  };
}

export type ExtractExtratoModalPageOptions = {
  itauProfile?: boolean;
  ignoreLineWords?: string[];
  dataColIds?: string[];
  headerKeywords?: string[];
  allowFaixaFallback?: boolean;
  strictFaixaVertical?: boolean;
};

/** Replica extractRowsFromPageData + enrich + auditoria do DocumentColunasModal. */
export function extractExtratoRowsFromPageLikeModal(
  pageData: PdfPagePreviewResult,
  snap: ExtratoPageMappingSnapshot,
  options: ExtractExtratoModalPageOptions = {},
): GenericOcrRow[] {
  if (pageData.itemCount === 0) return [];

  const faixaSnap = resolveFaixaFromSnapshot(snap, pageData.imgHeight);
  const colsExtrato = columnsParaExtratoItauModal(
    snap.columns,
    pageData.items,
    pageData.imgWidth,
  );
  const mapping = mappingGenericoEmCoordsOcr(
    colsExtrato,
    faixaSnap,
    snap.imgWidth,
    snap.imgHeight,
    pageData.imgWidth,
    pageData.imgHeight,
  );

  const stmtYear =
    extractStatementYear(pageData.items.map((it) => it.str).join(' ')) ||
    String(new Date().getFullYear());
  const ignoreLineWords = options.ignoreLineWords ?? [];
  const itauOpts = options.itauProfile
    ? getItauExtratoExtractGenericOptions(stmtYear, ignoreLineWords, pageData.ocrFullText)
    : null;

  let rows = extractGenericRowsFromMapping(
    pageData.items,
    mapping,
    pageData.imgHeight,
    pageData.imgWidth,
    {
      dataColIds: itauOpts?.dataColIds ??
        options.dataColIds ?? ['data', 'descricao', 'valorCredito', 'valorDebito', 'valorMisto'],
      headerKeywords:
        itauOpts?.headerKeywords ??
        options.headerKeywords ??
        ['saldo anterior', 'data', 'historico', 'valor'],
      allowFaixaFallback:
        itauOpts?.allowFaixaFallback ?? options.allowFaixaFallback ?? true,
      strictFaixaVertical: options.strictFaixaVertical ?? false,
      extratoPositional: true,
      extratoPreserveSegmentRows: true,
      statementYear: stmtYear,
      ocrFullText: pageData.ocrFullText || pageData.items.map((it) => it.str).join('\n'),
      ignoreLineWords,
    },
  );

  if (rows.length > 0) {
    rows = enrichItauExtratoRowsFromPageItems(pageData.items, rows, pageData.imgWidth);
    const valorBounds = resolveExtratoValorColBoundsFromColumns(mapping.columns, pageData.imgWidth);
    rows = enrichExtratoHistoricoLinhaOcrFromPageItems(
      pageData.items,
      rows,
      pageData.imgWidth,
      valorBounds,
    );
    rows = recoverExtratoPageRowsComAuditoria(
      pageData.items,
      rows,
      mapping,
      pageData.imgHeight,
      pageData.imgWidth,
      ignoreLineWords,
    );
  }

  return rows;
}
