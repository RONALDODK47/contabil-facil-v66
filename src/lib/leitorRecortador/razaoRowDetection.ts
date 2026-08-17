/**
 * Detecção de lançamentos do Razão Domínio — agrupa histórico multi-linha por data/número.
 */
import { splitClusterPorLinhasY, type OcrPosicionadoItem } from '../ocrExtratoPositional';
import {
  assignRazaoRowTokens,
  mappingToRazaoColPixels,
} from './razaoColumnPrecision';
import {
  extractClassificacaoContaFromCluster,
  extractCodigoReduzidoContaFromCluster,
  linhaEhMetadadoRazaoDominio,
  mergeRazaoFieldsFromLine,
} from './razaoLineParser';
import type { ColumnMapping, GenericExtractedRow, PDFTextItem } from './types';

const RE_DATA = /\b\d{2}\/\d{2}\/\d{4}\b/;
const RE_MOEDA = /[0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2}|[0-9]+\.[0-9]{2}/;
const RE_LOTE = /^\d{4,6}$/;

export type RazaoTextRow = {
  y: number;
  height: number;
  items: PDFTextItem[];
  classificacaoConta?: string;
  /** Código reduzido da conta, lido do cabeçalho "Conta: 5 - 1.1.1.01.00001". */
  codigoReduzidoConta?: string;
};

function toPosicionado(item: PDFTextItem, scale = 1.0): OcrPosicionadoItem {
  return { str: item.text, x: item.x / scale, y: item.y / scale, w: item.width / scale, h: item.height / scale };
}

function fromPosicionado(item: OcrPosicionadoItem, scale = 1.0): PDFTextItem {
  return { text: item.str, x: item.x * scale, y: item.y * scale, width: item.w * scale, height: item.h * scale };
}

function linhaTexto(cluster: OcrPosicionadoItem[]): string {
  return cluster
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((i) => i.str)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLancamentoAnchor(cluster: OcrPosicionadoItem[]): boolean {
  const hasDate = cluster.some((it) => it.x < 50 && RE_DATA.test(it.str));
  if (!hasDate) return false;
  return cluster.some(
    (it) =>
      (it.x >= 40 && it.x < 100 && RE_LOTE.test(it.str.trim())) ||
      (it.x > 280 && RE_MOEDA.test(it.str)),
  );
}

function isHistoricoContinuation(cluster: OcrPosicionadoItem[]): boolean {
  if (isLancamentoAnchor(cluster)) return false;
  if (extractClassificacaoContaFromCluster(cluster)) return false;
  const texto = linhaTexto(cluster);
  if (linhaEhMetadadoRazaoDominio(texto)) return false;
  return cluster.some((it) => it.x >= 35 && it.x < 290 && it.str.trim().length > 2);
}

function clusterRazaoLinhasFisicas(items: OcrPosicionadoItem[]): OcrPosicionadoItem[][] {
  if (items.length === 0) return [];
  const heights = items.map((i) => i.h).filter((h) => h > 0).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 12;
  const yTol = Math.max(3, medianH * 0.35);
  return splitClusterPorLinhasY(items, yTol);
}

/** Agrupa lançamentos do Razão Domínio (data + histórico multi-linha). */
export function detectRazaoRowsFromText(textItems: PDFTextItem[]): RazaoTextRow[] {
  if (textItems.length === 0) return [];
  const maxX = Math.max(...textItems.map((item) => item.x + item.width));
  const scale = maxX > 950 ? 2.0 : 1.0;

  const lines = clusterRazaoLinhasFisicas(textItems.map((it) => toPosicionado(it, scale)));
  const rows: RazaoTextRow[] = [];
  let currentClassificacao = '';
  let currentCodigoReduzido = '';
  let pending: OcrPosicionadoItem[] | null = null;

  const flushPending = () => {
    if (!pending?.length) return;
    const texto = linhaTexto(pending);
    if (linhaEhMetadadoRazaoDominio(texto)) {
      pending = null;
      return;
    }
    const minY = Math.min(...pending.map((i) => i.y));
    const maxY = Math.max(...pending.map((i) => i.y + i.h));
    rows.push({
      y: minY * scale,
      height: Math.max(maxY - minY, 8) * scale,
      items: pending.map((it) => fromPosicionado(it, scale)),
      classificacaoConta: currentClassificacao || undefined,
      codigoReduzidoConta: currentCodigoReduzido || undefined,
    });
    pending = null;
  };

  for (const line of lines) {
    const texto = linhaTexto(line);
    if (linhaEhMetadadoRazaoDominio(texto)) continue;

    const classHeader = extractClassificacaoContaFromCluster(line);
    if (classHeader) {
      flushPending();
      currentClassificacao = classHeader;
      currentCodigoReduzido = extractCodigoReduzidoContaFromCluster(line) ?? '';
      continue;
    }

    if (isLancamentoAnchor(line)) {
      flushPending();
      pending = [...line];
      continue;
    }

    if (isHistoricoContinuation(line) && pending) {
      pending.push(...line);
      continue;
    }

    if (isLancamentoAnchor(line) || line.some((it) => it.x < 50 && RE_DATA.test(it.str))) {
      flushPending();
      pending = [...line];
    }
  }

  flushPending();
  return rows;
}

/**
 * Linha "crua" usada pelo fallback por regex (mergeRazaoFieldsFromLine).
 *
 * O Razão do Domínio repete o histórico em vários x da mesma linha, então sem
 * deduplicar a linha chega como "PAGAMENTO PIX ... PAGAMENTO PIX ... 300,00
 * PAGAMENTO PIX ..." e o regex casa no lugar errado. Só texto é deduplicado:
 * dois valores iguais na linha (ex.: saldo do período igual ao do exercício)
 * são legítimos e precisam ser preservados.
 */
function linhaCompletaFromItems(items: PDFTextItem[]): string {
  const vistos = new Set<string>();
  const tokens: string[] = [];
  for (const item of [...items].sort((a, b) => a.x - b.x)) {
    const texto = item.text.trim();
    if (!texto) continue;
    if (/[A-Za-zÀ-ÿ]{3}/.test(texto)) {
      if (vistos.has(texto)) continue;
      vistos.add(texto);
    }
    tokens.push(texto);
  }
  return tokens.join(' ').replace(/\s+/g, ' ').trim();
}

export function extractRazaoDataFromCanvas(
  canvas: HTMLCanvasElement,
  columnIds: string[],
  columns: ColumnMapping,
  rowClusters: RazaoTextRow[],
  pageNumber = 1,
): GenericExtractedRow[] {
  const ctx = canvas.getContext('2d');
  if (!ctx || columnIds.length === 0) return [];

  const docWidth = canvas.width;
  const docHeight = canvas.height;
  const colPixels = mappingToRazaoColPixels(columns, columnIds, docWidth);

  const cropCanvasSection = (srcX: number, srcY: number, srcW: number, srcH: number): string => {
    try {
      const x = Math.max(0, Math.min(srcX, docWidth - 1));
      const y = Math.max(0, Math.min(srcY, docHeight - 1));
      const w = Math.max(1, Math.min(srcW, docWidth - x));
      const h = Math.max(1, Math.min(srcH, docHeight - y));
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = w;
      cropCanvas.height = h;
      const cropCtx = cropCanvas.getContext('2d');
      if (!cropCtx) return '';
      cropCtx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
      return cropCanvas.toDataURL('image/png');
    } catch {
      return '';
    }
  };

  return rowClusters.map((row, index) => {
    const rowItems = [...row.items].sort((a, b) => a.x - b.x);
    const linhaCompleta = linhaCompletaFromItems(rowItems);
    const fields: Record<string, string> = {};
    const cropUrls: Record<string, string> = {};
    const cropBounds: Record<string, { x: number; y: number; w: number; h: number }> = {};

    const partsByCol = assignRazaoRowTokens(rowItems, colPixels, docWidth, columnIds);
    columnIds.forEach((id) => {
      fields[id] = (partsByCol[id] || []).join(' ').trim();
    });

    Object.assign(
      fields,
      mergeRazaoFieldsFromLine(fields, linhaCompleta, row.classificacaoConta, row.codigoReduzidoConta),
    );
    fields._linhaOcr = linhaCompleta;

    const verticalPadding = Math.min(2, Math.max(1, row.height * 0.08));
    const cropY = row.y - verticalPadding;
    const cropH = row.height + verticalPadding * 2;

    columnIds.forEach((id) => {
      const col = colPixels.find((c) => c.id === id);
      if (!col) {
        cropUrls[id] = '';
        return;
      }
      cropUrls[id] = '';
      cropBounds[id] = { x: col.startX, y: cropY, w: col.width, h: cropH };
    });

    return {
      id: `p${pageNumber}-r${index + 1}`,
      fields,
      cropUrls,
      cropBounds,
      y: row.y,
      height: row.height,
      pageNumber,
    };
  });
}
