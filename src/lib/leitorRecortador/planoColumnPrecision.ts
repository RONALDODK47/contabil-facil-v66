/**
 * Colunas do plano de contas com precisão máxima — alinhamento por página e por token.
 */
import {
  realignPlanoColumnsToPageOcr,
  suggestPlanoContasColumns,
} from '../pdfNativeTextItems';
import type { PosicionadoItem } from '../parcelamentoColunasExtract';
import { genericColumnsToPercentMapping, mappingToGenericColumns } from './layoutBridge';
import type { ColumnMapping, PDFTextItem } from './types';

export function toPosicionadoItems(textItems: PDFTextItem[]): PosicionadoItem[] {
  return textItems.map((t) => ({ str: t.text, x: t.x, y: t.y, w: t.width, h: t.height }));
}

/** Margem horizontal mínima — só cobre micro-deslocamento do OCR. */
export function padPlanoColuna(imgWidth: number): number {
  return Math.min(6, Math.max(1.5, imgWidth * 0.003));
}

function horizontalOverlap(aLeft: number, aRight: number, bLeft: number, bRight: number): number {
  return Math.max(0, Math.min(aRight, bRight) - Math.max(aLeft, bLeft));
}

function fracInColumn(
  item: PDFTextItem,
  colLeft: number,
  colRight: number,
  pad: number,
): number {
  const overlap = horizontalOverlap(item.x, item.x + item.width, colLeft - pad, colRight + pad);
  if (overlap <= 0) return 0;
  return overlap / Math.max(item.width, 1);
}

export function itemInPlanoColumn(
  item: PDFTextItem,
  colLeft: number,
  colRight: number,
  imgWidth: number,
): boolean {
  const pad = padPlanoColuna(imgWidth);
  if (fracInColumn(item, colLeft, colRight, pad) >= 0.42) return true;
  const cx = item.x + item.width / 2;
  return cx >= colLeft + pad * 0.5 && cx <= colRight - pad * 0.5;
}

export type PlanoColPixel = { id: string; startX: number; endX: number; width: number };

export function mappingToPlanoColPixels(
  columns: ColumnMapping,
  columnIds: string[],
  imgWidth: number,
): PlanoColPixel[] {
  return columnIds
    .filter((id) => columns[id])
    .map((id) => {
      const col = columns[id]!;
      const startX = (col.startX / 100) * imgWidth;
      const endX = ((col.startX + col.width) / 100) * imgWidth;
      return { id, startX, endX, width: endX - startX };
    });
}

/**
 * Ajusta colunas da página atual com base nos tokens OCR (sem alterar a estrutura do template).
 */
export function resolvePlanoColumnsForPage(
  textItems: PDFTextItem[],
  imgWidth: number,
  columnIds: string[],
  templateColumns: ColumnMapping,
): ColumnMapping {
  if (imgWidth <= 0 || textItems.length < 10) return templateColumns;

  const posItems = toPosicionadoItems(textItems);
  const templatePx = mappingToGenericColumns(templateColumns, columnIds, imgWidth);

  const realigned = realignPlanoColumnsToPageOcr(templatePx, imgWidth, posItems, imgWidth);
  if (realigned?.some((c) => c.start !== c.end)) {
    return tightenPlanoColumnsFromTokens(
      textItems,
      imgWidth,
      columnIds,
      genericColumnsToPercentMapping(realigned, imgWidth),
    );
  }

  const suggested = suggestPlanoContasColumns(posItems, imgWidth);
  if (suggested?.columns.some((c) => c.start !== c.end)) {
    return tightenPlanoColumnsFromTokens(
      textItems,
      imgWidth,
      columnIds,
      genericColumnsToPercentMapping(suggested.columns, imgWidth),
    );
  }

  return tightenPlanoColumnsFromTokens(textItems, imgWidth, columnIds, templateColumns);
}

/** Estreita cada coluna até a faixa real dos tokens (p5–p95), sem invadir a vizinha. */
function tightenPlanoColumnsFromTokens(
  textItems: PDFTextItem[],
  imgWidth: number,
  columnIds: string[],
  base: ColumnMapping,
): ColumnMapping {
  const colPixels = mappingToPlanoColPixels(base, columnIds, imgWidth);
  if (!colPixels.length) return base;

  const buckets = new Map<string, PDFTextItem[]>();
  columnIds.forEach((id) => buckets.set(id, []));

  for (const item of textItems) {
    const colId = guessPlanoColumnByContent(item.text);
    if (!colId) continue;
    const col = colPixels.find((c) => c.id === colId);
    if (!col) continue;
    if (itemInPlanoColumn(item, col.startX, col.endX, imgWidth)) {
      buckets.get(colId)!.push(item);
    }
  }

  const out: ColumnMapping = { ...base };
  const pad = padPlanoColuna(imgWidth);

  for (const col of colPixels) {
    if (col.id === 'descricao') continue;
    const items = buckets.get(col.id) ?? [];
    if (items.length < 3) continue;

    const lefts = items.map((i) => i.x).sort((a, b) => a - b);
    const rights = items.map((i) => i.x + i.width).sort((a, b) => a - b);
    const p5 = lefts[Math.floor(lefts.length * 0.05)] ?? lefts[0]!;
    const p95 = rights[Math.floor(rights.length * 0.95)] ?? rights[rights.length - 1]!;
    const tightLeft = Math.max(col.startX, p5 - pad);
    const tightRight = Math.min(col.endX, p95 + pad);
    if (tightRight - tightLeft < 6) continue;

    out[col.id] = {
      startX: (tightLeft / imgWidth) * 100,
      width: ((tightRight - tightLeft) / imgWidth) * 100,
    };
  }

  return out;
}

/** Infere coluna pelo conteúdo do token (Domínio). */
export function guessPlanoColumnByContent(text: string): string | null {
  const raw = text.trim();
  const compact = raw.replace(/\s/g, '');
  if (/^[SA]$/i.test(raw)) return 'tipo';
  if (/^[1-6]$/.test(raw)) return 'nivel';
  if (/^\d+(?:\.\d+){1,}$/.test(compact)) return 'codigoClassificacao';
  if (/^\d{1,7}$/.test(compact)) return 'codigoReduzido';
  if (/[A-Za-zÀ-ÿ]{2,}/.test(raw)) return 'descricao';
  return null;
}

/**
 * Atribui tokens da linha às colunas: conteúdo primeiro, posição como validação.
 */
export function assignPlanoRowTokens(
  rowItems: PDFTextItem[],
  colPixels: PlanoColPixel[],
  imgWidth: number,
  columnIds: string[],
): Record<string, string[]> {
  const parts: Record<string, string[]> = {};
  columnIds.forEach((id) => {
    parts[id] = [];
  });

  const sorted = [...rowItems].sort((a, b) => a.x - b.x);
  let reduzidoAssigned = false;

  for (const item of sorted) {
    const raw = item.text.trim();
    let colId = guessPlanoColumnByContent(raw);

    if (colId === 'codigoReduzido') {
      if (reduzidoAssigned) colId = null;
      else reduzidoAssigned = true;
    }

    if (colId) {
      const col = colPixels.find((c) => c.id === colId);
      if (col && itemInPlanoColumn(item, col.startX, col.endX, imgWidth)) {
        parts[colId]!.push(raw);
        continue;
      }
    }

    const cx = item.x + item.width / 2;
    let best: PlanoColPixel | null = null;
    let bestDist = Infinity;
    for (const col of colPixels) {
      if (cx >= col.startX && cx <= col.endX) {
        best = col;
        break;
      }
      const colCx = (col.startX + col.endX) / 2;
      const dist = Math.abs(cx - colCx);
      if (dist < bestDist) {
        bestDist = dist;
        best = col;
      }
    }
    if (best) parts[best.id]!.push(raw);
    else if (/[A-Za-zÀ-ÿ]/.test(raw)) parts.descricao!.push(raw);
  }

  return parts;
}

/** Recorte horizontal exato dos tokens atribuídos à coluna na linha. */
export function cropBoundsForColumnItems(
  items: PDFTextItem[],
  col: PlanoColPixel,
  fallbackPad = 1,
  expandToTokenWidth = false,
): { x: number; w: number } {
  if (!items.length) {
    return { x: col.startX, w: col.width };
  }
  const minX = Math.min(...items.map((i) => i.x));
  const maxX = Math.max(...items.map((i) => i.x + i.width));
  const left = Math.max(col.startX, minX - fallbackPad);
  const right = expandToTokenWidth ? maxX + fallbackPad : Math.min(col.endX, maxX + fallbackPad);
  return { x: left, w: Math.max(4, right - left) };
}
