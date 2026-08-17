/**
 * Detecção de linhas físicas do plano de contas Domínio — uma linha do PDF = uma conta.
 * Evita fundir subcontas (ex.: DESPESAS COM PESSOAL → SALÁRIOS, INSS, FGTS…).
 */
import { splitClusterPorLinhasY, type OcrPosicionadoItem } from '../ocrExtratoPositional';
import {
  assignPlanoRowTokens,
  cropBoundsForColumnItems,
  mappingToPlanoColPixels,
} from './planoColumnPrecision';
import {
  mergePlanoFieldsFromLine,
  isValidPlanoDominioAccountRow,
  parsePlanoDominioLineText,
  isPlanoMetadataLine,
} from './planoLineParser';
import { stripTrailingPlanoTipoFromName } from './planoDominioRowParser';
import {
  calibrateDominioPlanoBounds,
  extractPlanoDominioFieldsFromItems,
} from './planoDominioRowParser';
import type { ColumnMapping, GenericExtractedRow, PDFTextItem } from './types';

// Exige ao menos um ponto: reduzido (1889) e nível (5) não podem disparar divisão de linha.
const RE_PLANO_CLASSIFICACAO_TOKEN = /^\d+(?:\.\d+){1,6}(?:\.\d{2,5})?$/;

export type PlanoTextRow = {
  y: number;
  height: number;
  items: PDFTextItem[];
};

function toPosicionado(item: PDFTextItem): OcrPosicionadoItem {
  return { str: item.text, x: item.x, y: item.y, w: item.width, h: item.height };
}

function fromPosicionado(item: OcrPosicionadoItem): PDFTextItem {
  return { text: item.str, x: item.x, y: item.y, width: item.w, height: item.h };
}

function filtrarMarcadorMargemPlanoDominio(row: OcrPosicionadoItem[]): OcrPosicionadoItem[] {
  if (row.length < 2) return row;
  const sorted = [...row].sort((a, b) => a.x - b.x);
  const first = sorted[0]!;
  if (first.str.trim() === '1' && first.x < 16) {
    const hasData = sorted.some((it) => it !== first && it.x > 18);
    if (hasData) return sorted.slice(1);
  }
  return row;
}

function splitPlanoLinhaSeVariasContas(row: OcrPosicionadoItem[]): OcrPosicionadoItem[][] {
  if (row.length < 5) return [row];
  const sorted = [...row].sort((a, b) => a.x - b.x);
  const classItems = sorted.filter((it) => {
    const t = it.str.trim().replace(/\s/g, '');
    return RE_PLANO_CLASSIFICACAO_TOKEN.test(t);
  });
  if (classItems.length < 2) return [row];

  const boundaries: number[] = [];
  for (let i = 0; i < classItems.length - 1; i++) {
    const a = classItems[i]!;
    const b = classItems[i + 1]!;
    if (b.x - (a.x + a.w) > 16) {
      boundaries.push((a.x + a.w + b.x) / 2);
    }
  }
  if (boundaries.length === 0) return [row];

  const parts: OcrPosicionadoItem[][] = Array.from({ length: boundaries.length + 1 }, () => []);
  for (const it of sorted) {
    const cx = it.x + it.w / 2;
    let slot = 0;
    for (let bi = 0; bi < boundaries.length; bi++) {
      if (cx >= boundaries[bi]!) slot = bi + 1;
    }
    parts[slot]!.push(it);
  }
  return parts.filter((p) => p.length > 0);
}

function linhaOcrTextoFromCluster(row: OcrPosicionadoItem[]): string {
  return row
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((i) => i.str)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function linhaEhMetadadoPlano(rowIn: OcrPosicionadoItem[]): boolean {
  const texto = linhaOcrTextoFromCluster(rowIn);
  return isPlanoMetadataLine(texto);
}

function clusterPlanoLinhasFisicas(items: OcrPosicionadoItem[]): OcrPosicionadoItem[][] {
  if (items.length === 0) return [];
  const heights = items.map((i) => i.h).filter((h) => h > 0).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 12;
  const yTol = Math.max(3, medianH * 0.32);
  const physicalLines = splitClusterPorLinhasY(items, yTol);
  const out: OcrPosicionadoItem[][] = [];
  for (const line of physicalLines) {
    for (const part of splitPlanoLinhaSeVariasContas(line)) {
      if (part.length > 0) out.push(part);
    }
  }
  return out;
}

/** Uma linha física do PDF = uma conta (tolerância Y apertada, sem fundir subcontas). */
export function detectPlanoRowsFromText(textItems: PDFTextItem[]): PlanoTextRow[] {
  const clusters = clusterPlanoLinhasFisicas(textItems.map(toPosicionado));
  return clusters
    .map((cluster) => filtrarMarcadorMargemPlanoDominio(cluster))
    .filter((cluster) => !linhaEhMetadadoPlano(cluster))
    .map((cluster) => {
      const minY = Math.min(...cluster.map((i) => i.y));
      const maxY = Math.max(...cluster.map((i) => i.y + i.h));
      return {
        y: minY,
        height: Math.max(maxY - minY, 8),
        items: cluster.map(fromPosicionado),
      };
    });
}

function linhaCompletaFromItems(items: PDFTextItem[]): string {
  return [...items]
    .sort((a, b) => a.x - b.x)
    .map((i) => i.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extrai colunas usando os tokens já agrupados por linha física (sem reatribuir entre linhas).
 */
export function extractPlanoDataFromCanvas(
  canvas: HTMLCanvasElement,
  columnIds: string[],
  columns: ColumnMapping,
  rowClusters: PlanoTextRow[],
  pageNumber = 1,
): GenericExtractedRow[] {
  const ctx = canvas.getContext('2d');
  if (!ctx || columnIds.length === 0) return [];

  const docWidth = canvas.width;
  const docHeight = canvas.height;
  const colPixels = mappingToPlanoColPixels(columns, columnIds, docWidth);
  const pageItems = rowClusters.flatMap((r) => r.items);
  const pageBounds = calibrateDominioPlanoBounds(pageItems, docWidth);

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

  return rowClusters
    .map((row, index) => {
    const rowItems = [...row.items].sort((a, b) => a.x - b.x);
    const linhaCompleta = linhaCompletaFromItems(rowItems);
    const positional = extractPlanoDominioFieldsFromItems(rowItems, docWidth, pageBounds);
    const fields: Record<string, string> = { ...positional };
    const cropUrls: Record<string, string> = {};
    const cropBounds: Record<string, { x: number; y: number; w: number; h: number }> = {};

    const partsByCol = assignPlanoRowTokens(rowItems, colPixels, docWidth, columnIds);
    columnIds.forEach((id) => {
      const fromCol = (partsByCol[id] || []).join(' ').trim();
      if (fromCol && !fields[id]) fields[id] = fromCol;
    });

    const merged = mergePlanoFieldsFromLine(fields, linhaCompleta);
    Object.assign(fields, merged);

    // Posicional tem prioridade sobre colunas desalinhadas.
    if (positional.codigoClassificacao) fields.codigoClassificacao = positional.codigoClassificacao;
    if (positional.codigoReduzido) fields.codigoReduzido = positional.codigoReduzido;
    if (positional.descricao) fields.descricao = positional.descricao;
    if (positional.tipo) fields.tipo = positional.tipo;
    if (positional.nivel) fields.nivel = positional.nivel;

    const parsedLine = parsePlanoDominioLineText(linhaCompleta);
    if (parsedLine?.name) {
      const atual = fields.descricao?.trim() ?? '';
      if (!atual || parsedLine.name.length > atual.length) {
        fields.descricao = stripTrailingPlanoTipoFromName(parsedLine.name);
      }
    }
    if (fields.descricao) {
      fields.descricao = stripTrailingPlanoTipoFromName(fields.descricao);
    }

    const verticalPadding = Math.min(2, Math.max(1, row.height * 0.08));
    const cropY = row.y - verticalPadding;
    const cropH = row.height + verticalPadding * 2;

    columnIds.forEach((id) => {
      const col = colPixels.find((c) => c.id === id);
      if (!col) {
        cropUrls[id] = '';
        return;
      }
      let colItems = rowItems.filter((item) => (partsByCol[id] || []).includes(item.text.trim()));
      if (id === 'descricao') {
        const grauCol = colPixels.find((c) => c.id === 'nivel');
        const grauLeft = grauCol?.startX ?? pageBounds.grauMin;
        const classCol = colPixels.find((c) => c.id === 'codigoClassificacao');
        const nomeMinX = (classCol?.endX ?? pageBounds.classificacaoMax) + 4;
        colItems = rowItems.filter((item) => {
          const cx = item.x + item.width / 2;
          const raw = item.text.trim();
          if (item.x + item.width < nomeMinX) return false;
          if (cx >= grauLeft - 8 && /^[1-6]$/.test(raw)) return false;
          return /[A-Za-zÀ-ÿ]/.test(raw);
        });
      }
      const cb = cropBoundsForColumnItems(colItems, col, 1, id === 'descricao');
      cropUrls[id] = '';
      cropBounds[id] = { x: cb.x, y: cropY, w: cb.w, h: cropH };
    });

    fields._linhaOcr = linhaCompleta;

    return {
      id: `plano-${pageNumber}-${index}-${Date.now()}`,
      fields,
      cropUrls,
      cropBounds,
      y: row.y,
      height: row.height,
      pageNumber,
    };
  })
    .filter((row) => isValidPlanoDominioAccountRow(row.fields, row.fields._linhaOcr || ''));
}
