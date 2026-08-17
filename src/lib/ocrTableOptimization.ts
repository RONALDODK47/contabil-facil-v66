/**
 * Otimizações de OCR para leitura de tabelas em parcelamentos e extratos escaneados.
 */
import { OcrPositionedWord } from './imageOcrExtract';

/**
 * Detecta estrutura de tabela: colunas verticais claras e/ou linhas horizontais regulares.
 */
export function detectTableStructure(
  gray: Uint8Array,
  w: number,
  h: number,
): { isTable: boolean; estimatedColumns: number } {
  const colDarkness = new Float32Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      colDarkness[x] += gray[y * w + x] / h;
    }
  }

  const colThreshold = 195;
  let whiteColCount = 0;
  let prevWhite = false;
  const xStart = Math.max(1, Math.floor(w * 0.04));
  const xEnd = Math.floor(w * 0.96);
  for (let x = xStart; x < xEnd; x++) {
    const isWhite = colDarkness[x] > colThreshold;
    if (isWhite && !prevWhite && x - xStart > w * 0.06) {
      whiteColCount++;
    }
    prevWhite = isWhite;
  }

  const rowDarkness = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      rowDarkness[y] += gray[y * w + x] / w;
    }
  }
  let rowSeparators = 0;
  prevWhite = false;
  const yStart = Math.floor(h * 0.08);
  const yEnd = Math.floor(h * 0.92);
  for (let y = yStart; y < yEnd; y++) {
    const isWhite = rowDarkness[y] > colThreshold;
    if (isWhite && !prevWhite) rowSeparators++;
    prevWhite = isWhite;
  }

  const wideLayout = w > h * 0.85;
  const isTable =
    whiteColCount >= 2 ||
    (wideLayout && whiteColCount >= 1 && rowSeparators >= 4) ||
    rowSeparators >= 8;

  return {
    isTable,
    estimatedColumns: Math.max(2, Math.min(8, whiteColCount + 1)),
  };
}

export function groupWordsByTableColumns(
  words: OcrPositionedWord[],
  estimatedColumns: number,
): OcrPositionedWord[][] {
  if (words.length === 0) return [];

  const xPositions = words.map((w) => w.x).sort((a, b) => a - b);
  const minX = xPositions[0];
  const maxX = Math.max(...words.map((w) => w.x + w.w));
  const totalWidth = maxX - minX;
  const colWidth = totalWidth / Math.max(estimatedColumns, 2);

  const columns: OcrPositionedWord[][] = Array.from({ length: estimatedColumns }, () => []);

  for (const word of words) {
    const colIndex = Math.min(
      estimatedColumns - 1,
      Math.floor((word.x - minX) / colWidth),
    );
    columns[colIndex].push(word);
  }

  for (const col of columns) {
    col.sort((a, b) => b.y - a.y);
  }

  return columns;
}

export function alignTableRows(
  words: OcrPositionedWord[],
  rowTolerance: number = 10,
): OcrPositionedWord[][] {
  if (words.length === 0) return [];

  const sorted = [...words].sort((a, b) => b.y - a.y);

  const rows: OcrPositionedWord[][] = [];
  let currentRow: OcrPositionedWord[] = [sorted[0]];
  let rowAvgY = sorted[0].y;

  for (let i = 1; i < sorted.length; i++) {
    const word = sorted[i];
    const yDiff = Math.abs(word.y - rowAvgY);

    if (yDiff < rowTolerance) {
      currentRow.push(word);
      rowAvgY = currentRow.reduce((sum, w) => sum + w.y, 0) / currentRow.length;
    } else {
      currentRow.sort((a, b) => a.x - b.x);
      rows.push(currentRow);
      currentRow = [word];
      rowAvgY = word.y;
    }
  }

  currentRow.sort((a, b) => a.x - b.x);
  rows.push(currentRow);

  return rows;
}

export function wordsToTableText(columns: OcrPositionedWord[][]): string {
  if (columns.length === 0) return '';

  const allLines = new Map<number, OcrPositionedWord[]>();

  for (const col of columns) {
    for (const word of col) {
      const lineY = Math.round(word.y / 5) * 5;
      if (!allLines.has(lineY)) {
        allLines.set(lineY, []);
      }
      allLines.get(lineY)!.push(word);
    }
  }

  const lines: string[] = [];
  Array.from(allLines.entries())
    .sort((a, b) => b[0] - a[0])
    .forEach(([, wordsInLine]) => {
      const sorted = wordsInLine.sort((a, b) => a.x - b.x);
      lines.push(sorted.map((w) => w.str).join('\t'));
    });

  return lines.join('\n');
}

/** PSM 6 = bloco uniforme (tabelas); PSM 3 = automático (scan denso); PSM 4 = coluna variável. */
export function recommendPsm(isTable: boolean, isScanned = false): string {
  if (isTable) return '6';
  if (isScanned) return '3';
  return '6';
}

export async function detectRecommendedPsmFromBlob(blob: Blob): Promise<string> {
  try {
    const bmp = await createImageBitmap(blob);
    const w = bmp.width;
    const h = bmp.height;
    const canvas = document.createElement('canvas');
    const sampleW = Math.min(640, w);
    const sampleH = Math.min(900, h);
    canvas.width = sampleW;
    canvas.height = sampleH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      bmp.close();
      return '4';
    }
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, sampleW, sampleH);
    ctx.drawImage(bmp, 0, 0, sampleW, sampleH);
    bmp.close();
    const img = ctx.getImageData(0, 0, sampleW, sampleH);
    const d = img.data;
    const gray = new Uint8Array(sampleW * sampleH);
    for (let p = 0, i = 0; p < sampleW * sampleH; p++, i += 4) {
      gray[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    }
    const { looksLikeScannedDocument } = await import('./imageOcrExtract');
    const scanned = looksLikeScannedDocument(gray, gray.length);
    const { isTable } = detectTableStructure(gray, sampleW, sampleH);
    return recommendPsm(isTable, scanned);
  } catch {
    return '4';
  }
}
