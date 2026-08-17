/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ColumnRange,
  ExtractedRow,
  GenericExtractedRow,
  PDFTextItem,
  DocumentColumns,
  ColumnMapping,
} from './types';
import { isBankStatementNoiseLine, isDailySummaryOrTotalLine } from './noiseFiltering';
import { parseMoneyValueOcrTolerant } from './valueParsing';

/**
 * Groups text items into horizontal rows based on their vertical coordinates.
 */
export function detectRowsFromText(textItems: PDFTextItem[], toleranceY: number = 12): { y: number; height: number; items: PDFTextItem[] }[] {
  if (textItems.length === 0) return [];

  // Sort items primarily by Y coordinate of their center
  const sortedItems = [...textItems].sort((a, b) => {
    const centerY_A = a.y + a.height / 2;
    const centerY_B = b.y + b.height / 2;
    return centerY_A - centerY_B;
  });

  const rows: { y: number; height: number; items: PDFTextItem[] }[] = [];

  sortedItems.forEach((item) => {
    const itemCenterY = item.y + item.height / 2;
    
    // Check if there is an existing row whose center is close to this item's center
    let foundRow = rows.find((r) => {
      const rowCenterY = r.y + r.height / 2;
      return Math.abs(rowCenterY - itemCenterY) <= toleranceY;
    });

    if (foundRow) {
      foundRow.items.push(item);
      // Recalculate average Y, starting X, and max height based on the items in this row
      const minY = Math.min(...foundRow.items.map(i => i.y));
      const maxY = Math.max(...foundRow.items.map(i => i.y + i.height));
      foundRow.y = minY;
      foundRow.height = Math.max(maxY - minY, foundRow.height);
    } else {
      rows.push({
        y: item.y,
        height: item.height,
        items: [item],
      });
    }
  });

  // Post-processing merge: sometimes adjacent lines are still too close.
  // Sort detected rows and merge any rows where distance between centers is very small.
  let mergedRows: typeof rows = [];
  const sortedRows = [...rows].sort((a, b) => a.y - b.y);

  sortedRows.forEach((row) => {
    if (mergedRows.length === 0) {
      mergedRows.push(row);
      return;
    }

    const lastRow = mergedRows[mergedRows.length - 1];
    const lastRowCenter = lastRow.y + lastRow.height / 2;
    const currentRowCenter = row.y + row.height / 2;

    // If the distance between centers is extremely small (e.g. less than 20px), merge them
    if (Math.abs(lastRowCenter - currentRowCenter) < 20) {
      lastRow.items = [...lastRow.items, ...row.items];
      const minY = Math.min(lastRow.y, row.y);
      const maxY = Math.max(lastRow.y + lastRow.height, row.y + row.height);
      lastRow.y = minY;
      lastRow.height = maxY - minY;
    } else {
      mergedRows.push(row);
    }
  });

  // Filter out noise rows (e.g., extremely empty, or rows without enough text spaced out)
  return mergedRows
    .filter((r) => r.items.length > 0)
    .sort((a, b) => a.y - b.y);
}

const RE_ROW_VALUE = /\d{1,3}(\.\d{3})*,\d{2}/;
/** Data completa (com ano), ANCORADA no início do texto do item — a data de um
 *  lançamento é sempre o primeiro token da linha. Evita falso positivo com
 *  datas soltas no MEIO do texto de uma continuação, ex.: histórico de tarifa
 *  "Cobrança referente 10/06/2026" ou "Tar. agrupadas - ocorrência 23/06/2026"
 *  — aí a data é só a referência da cobrança, não o início de um lançamento. */
const RE_FULL_DATE_LEADING = /^\d{1,2}\/\d{1,2}\/\d{2,4}\b/;
/** Mesma data completa, mas sem exigir início de linha — só usada quando o
 *  item já está posicionado dentro da coluna de data configurada (sinal
 *  posicional independente do texto, cobre colunas levemente desalinhadas). */
const RE_FULL_DATE_ANYWHERE = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/;

/**
 * Consolida linhas VISUAIS em linhas de LANÇAMENTO — extratos como o do BB usam
 * 2 linhas por transação (1ª: data/histórico/valor; 2ª: hora + contraparte).
 * Sem isso o recorte corta o lançamento no meio e duplica faixas.
 *
 * Prioridade #1: NUNCA perder uma transação. É preferível deixar uma faixa
 * "solta" (separada demais) do que fundir/descartar uma faixa que carrega sua
 * própria data ou valor — cada uma dessas evidências pertence a um lançamento
 * único e nunca pode ser silenciosamente absorvida por outro.
 *
 * Regras:
 * 0. Faixa bruta que já vem com DUAS (ou mais) datas completas diferentes —
 *    porque o agrupador de linhas de texto (`detectRowsFromText`) tem uma
 *    caixa delimitadora que cresce a cada item incluído e pode "engolir" o
 *    início do lançamento seguinte — é DESMEMBRADA de volta em uma faixa por
 *    data, antes de qualquer outra regra rodar.
 * 1. Faixas que se sobrepõem só são fundidas (dedup) se forem de fato a MESMA
 *    transação — nunca quando cada uma carrega uma data completa (com ano)
 *    ou um valor diferentes entre si (isso seria apagar um lançamento real).
 * 2. Faixa SEM data completa em nenhum lugar da linha E SEM valor na coluna de
 *    valor é continuação → funde na faixa do lançamento anterior.
 */
export function consolidateTransactionRows(
  rows: { y: number; height: number; items?: PDFTextItem[] }[],
  canvasWidth: number,
  columns: DocumentColumns,
): { y: number; height: number }[] {
  if (rows.length === 0) return [];

  type Band = { y: number; height: number; items: PDFTextItem[] };
  const sorted: Band[] = [...rows]
    .sort((a, b) => a.y - b.y)
    .map((r) => ({ y: r.y, height: r.height, items: r.items ? [...r.items] : [] }));

  const colX = (col: ColumnRange) => {
    const x0 = (col.startX / 100) * canvasWidth;
    return { x0, x1: x0 + (col.width / 100) * canvasWidth };
  };
  const dateBounds = colX(columns.date);
  const valueBounds = colX(columns.value);
  const itemInDateCol = (it: PDFTextItem, b: { x0: number; x1: number }) => {
    const cx = it.x + it.width / 2;
    return cx >= b.x0 - 15 && cx <= b.x1 + 20;
  };
  const itemInValueCol = (it: PDFTextItem, b: { x0: number; x1: number }) => {
    const hasDigits = /\d/.test(it.text);
    if (hasDigits && it.x > b.x1) return false;

    const cx = it.x + it.width / 2;
    const isSignOnly = /^[CD\-+]$/.test(it.text.trim().toUpperCase()) || /^(DEBITO|CREDITO|DÉBITO|CRÉDITO)$/i.test(it.text.trim());
    const limitRight = isSignOnly ? b.x1 + 75 : b.x1 + 24;
    const centerMatched = cx >= b.x0 - 35 && cx <= limitRight;
    const startMatched = it.x >= b.x0 - 35 && it.x <= b.x1;
    return centerMatched || startMatched;
  };

  /**
   * Data completa de INÍCIO de lançamento presente no item, ou null.
   * Só conta como data de início se: (a) é o primeiro token do texto do item
   * (nunca uma data solta no meio, tipo referência de cobrança), OU (b) o
   * item está posicionado dentro da coluna de data configurada.
   */
  const startDateOfItem = (it: PDFTextItem): string | null => {
    const leading = RE_FULL_DATE_LEADING.exec(it.text.trim());
    if (leading) return leading[0];
    if (itemInDateCol(it, dateBounds)) {
      const anywhere = RE_FULL_DATE_ANYWHERE.exec(it.text);
      if (anywhere) return anywhere[0];
    }
    return null;
  };
  /** Texto da 1ª data completa de início de lançamento encontrada na faixa. */
  const fullDateOf = (band: Band): string | null => {
    for (const it of band.items) {
      const d = startDateOfItem(it);
      if (d) return d;
    }
    return null;
  };
  /** Texto do 1º valor monetário encontrado na coluna de valor. */
  const valueOf = (band: Band): string | null => {
    for (const it of band.items) {
      if (!itemInValueCol(it, valueBounds)) continue;
      const m = RE_ROW_VALUE.exec(it.text);
      if (m) return m[0];
    }
    return null;
  };
  const isHeaderOrBannerOrBalance = (band: Band): boolean => {
    if (band.items.length === 0) return false;
    const text = band.items.map(i => i.text).join(' ').toUpperCase();
    if (
      text.includes('SALDO DIA') ||
      text.includes('SALDO ANTERIOR') ||
      text.includes('SALDO DO DIA') ||
      text.includes('SALDO FINAL') ||
      text.includes('SALDO ATUAL') ||
      text.includes('SALDO DE') ||
      text.includes('SALDO DA CONTA')
    ) {
      return true;
    }
    if (
      text.includes('DATA/HORA') ||
      text.includes('NR. DOC.') ||
      text.includes('DESCRIÇÃO') ||
      text.includes('VALOR (R$)') ||
      text.includes('SALDO(R$)')
    ) {
      return true;
    }
    if (
      /FEIRA\b/i.test(text) ||
      /\bDE (JANEIRO|FEVEREIRO|MARCO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO) DE\b/i.test(text)
    ) {
      return true;
    }
    // Lista ampla de ruído de cabeçalho/rodapé/impressão/SAC/subtotal, portada do motor de
    // referência — cobre padrões de outros bancos além dos já tratados acima manualmente.
    if (isDailySummaryOrTotalLine(text) || isBankStatementNoiseLine(text)) {
      return true;
    }
    return false;
  };
  /** true = linha claramente inicia um lançamento (tem sua própria data/valor). */
  const isTransactionStart = (band: Band): boolean => {
    // Sem texto (página escaneada) não dá para classificar — mantém como está.
    if (band.items.length === 0) return true;
    if (isHeaderOrBannerOrBalance(band)) return false;
    return fullDateOf(band) != null || valueOf(band) != null;
  };

  // 0) Desmembra faixas brutas com múltiplas datas completas distintas — o
  // agrupador de texto de origem pode ter fundido 2+ lançamentos numa só
  // faixa. Reagrupa os itens pela âncora de data mais próxima em Y.
  const split: Band[] = [];
  for (const raw of sorted) {
    const dateItems = raw.items
      .map((it) => ({ it, dateText: startDateOfItem(it) }))
      .filter((x): x is { it: PDFTextItem; dateText: string } => x.dateText != null);
    const distinctDates = new Set(dateItems.map((x) => x.dateText));
    if (distinctDates.size <= 1) {
      split.push(raw);
      continue;
    }
    // Uma âncora (posição Y) por data completa distinta, na ordem em que aparecem.
    const anchors: { anchorY: number; items: PDFTextItem[] }[] = [];
    const seenDates = new Set<string>();
    for (const { it, dateText } of dateItems) {
      if (seenDates.has(dateText)) continue;
      seenDates.add(dateText);
      anchors.push({ anchorY: it.y + it.height / 2, items: [] });
    }
    anchors.sort((a, b) => a.anchorY - b.anchorY);
    // Cada item vai para a âncora de data IMEDIATAMENTE ANTERIOR (a última
    // com anchorY <= itemY) — nunca para a data seguinte, mesmo que ela
    // esteja numericamente mais próxima. Extrato é sempre cronológico: uma
    // linha de continuação pertence à transação de cima, nunca "adianta"
    // para a de baixo.
    for (const it of raw.items) {
      const itemY = it.y + it.height / 2;
      let best = anchors[0]!;
      for (const a of anchors) {
        if (a.anchorY <= itemY) best = a;
        else break;
      }
      best.items.push(it);
    }
    for (const a of anchors) {
      if (!a.items.length) continue;
      const minY = Math.min(...a.items.map((i) => i.y));
      const maxY = Math.max(...a.items.map((i) => i.y + i.height));
      split.push({ y: minY, height: maxY - minY, items: a.items });
    }
  }
  split.sort((a, b) => a.y - b.y);

  // 1) Dedup de faixas sobrepostas — só quando é comprovadamente a MESMA
  // transação (nenhuma das duas tem evidência própria, ou as evidências batem).
  const deduped: Band[] = [];
  for (const r of split) {
    const prev = deduped[deduped.length - 1];
    if (prev) {
      const top = Math.max(prev.y, r.y);
      const bottom = Math.min(prev.y + prev.height, r.y + r.height);
      const overlap = Math.max(0, bottom - top);
      const minH = Math.min(prev.height, r.height);
      const prevDate = fullDateOf(prev);
      const rDate = fullDateOf(r);
      const prevValue = valueOf(prev);
      const rValue = valueOf(r);
      const bothStartLikeButDifferent =
        isTransactionStart(prev) &&
        isTransactionStart(r) &&
        ((prevDate != null && rDate != null && prevDate !== rDate) ||
          (prevValue != null && rValue != null && prevValue !== rValue));
      if (minH > 0 && overlap >= minH * 0.6 && !bothStartLikeButDifferent) {
        const yEnd = Math.max(prev.y + prev.height, r.y + r.height);
        prev.y = Math.min(prev.y, r.y);
        prev.height = yEnd - prev.y;
        prev.items.push(...r.items);
        continue;
      }
    }
    deduped.push(r);
  }

  // 2) Continuações → funde no lançamento anterior (exceto se for linha especial)
  const out: { y: number; height: number; isSpecial?: boolean }[] = [];
  for (const band of deduped) {
    const isSpecial = isHeaderOrBannerOrBalance(band);
    if (out.length === 0 || isTransactionStart(band) || isSpecial) {
      out.push({ y: band.y, height: band.height, isSpecial });
    } else {
      const prev = out[out.length - 1]!;
      if (prev.isSpecial) {
        out.push({ y: band.y, height: band.height, isSpecial: false });
      } else {
        const yEnd = Math.max(prev.y + prev.height, band.y + band.height);
        prev.height = yEnd - prev.y;
      }
    }
  }
  return out.map(({ y, height }) => ({ y, height }));
}

/**
 * Detecta linhas por análise de PIXELS (projeção horizontal de tinta) — funciona
 * em QUALQUER documento renderizado: PDF nativo, PDF escaneado e foto/imagem,
 * porque lê a imagem em si e não depende da camada de texto.
 *
 * Método: para cada linha-y do canvas conta os pixels "com tinta" (luminância
 * baixa). Faixas contíguas com tinta = linhas de texto; vãos em branco = separadores.
 * O resultado acompanha exatamente o layout visual, mesmo com espaçamentos
 * irregulares — muito mais preciso que grade de passo fixo.
 */
export function detectRowsFromPixels(
  canvas: HTMLCanvasElement,
  options?: {
    /** Luminância (0-255) abaixo da qual o pixel conta como tinta. Default 160. */
    inkLuminance?: number;
    /** Mínimo de pixels de tinta na linha-y para contar como texto. Default 3. */
    minInkPerRow?: number;
    /** Vão em branco mínimo (px) que separa duas linhas. Default 3. */
    minGapPx?: number;
    /** Altura mínima da faixa para não ser descartada como ruído/régua. Default 5. */
    minRowHeightPx?: number;
    /** Faixa horizontal analisada em % da largura (ignora margens). Default 2–98. */
    xStartPct?: number;
    xEndPct?: number;
  },
): { y: number; height: number }[] {
  const inkLuminance = options?.inkLuminance ?? 160;
  const minInkPerRow = options?.minInkPerRow ?? 3;
  const minGapPx = options?.minGapPx ?? 3;
  const minRowHeightPx = options?.minRowHeightPx ?? 5;
  const xStartPct = options?.xStartPct ?? 2;
  const xEndPct = options?.xEndPct ?? 98;

  const w = canvas.width;
  const h = canvas.height;
  if (w <= 0 || h <= 0) return [];
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  const x0 = Math.max(0, Math.floor((xStartPct / 100) * w));
  const x1 = Math.min(w, Math.ceil((xEndPct / 100) * w));
  const bandW = x1 - x0;
  if (bandW <= 0) return [];

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(x0, 0, bandW, h).data;
  } catch {
    return [];
  }

  // Amostra 1 a cada 2 colunas — corta o custo pela metade sem perder linhas de texto.
  const colStep = bandW > 600 ? 2 : 1;
  const ink = new Int32Array(h);
  for (let y = 0; y < h; y++) {
    const rowOff = y * bandW * 4;
    let count = 0;
    for (let x = 0; x < bandW; x += colStep) {
      const i = rowOff + x * 4;
      const a = data[i + 3]!;
      if (a < 128) continue; // transparente = fundo
      const lum = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      if (lum < inkLuminance) count++;
    }
    ink[y] = count;
  }

  const sampledW = Math.ceil(bandW / colStep);
  return inkProfileToRowBands(ink, h, sampledW, { minInkPerRow, minGapPx, minRowHeightPx });
}

/**
 * Converte o perfil de tinta por linha-y em faixas de texto (linhas detectadas).
 * Pura — separada para permitir teste sem canvas.
 */
export function inkProfileToRowBands(
  ink: ArrayLike<number>,
  h: number,
  sampledW: number,
  opts: { minInkPerRow: number; minGapPx: number; minRowHeightPx: number },
): { y: number; height: number }[] {
  const { minInkPerRow, minGapPx, minRowHeightPx } = opts;
  // Réguas horizontais de tabela: linhas-y quase 100% preenchidas. Não são texto —
  // zera para não colar duas linhas de texto adjacentes numa faixa só.
  const profile = new Int32Array(h);
  for (let y = 0; y < h; y++) {
    const v = Number(ink[y] ?? 0);
    profile[y] = v >= sampledW * 0.85 ? 0 : v;
  }

  const bands: { y: number; height: number }[] = [];
  let bandStart = -1;
  let gapRun = 0;
  for (let y = 0; y < h; y++) {
    const hasInk = profile[y]! >= minInkPerRow;
    if (hasInk) {
      if (bandStart < 0) bandStart = y;
      gapRun = 0;
    } else if (bandStart >= 0) {
      gapRun++;
      if (gapRun >= minGapPx) {
        const end = y - gapRun + 1;
        if (end - bandStart >= minRowHeightPx) {
          bands.push({ y: bandStart, height: end - bandStart });
        }
        bandStart = -1;
        gapRun = 0;
      }
    }
  }
  if (bandStart >= 0) {
    // Fecha a última faixa (desconta o gap pendente, se houver)
    const end = h - gapRun;
    if (end - bandStart >= minRowHeightPx) {
      bands.push({ y: bandStart, height: end - bandStart });
    }
  }

  return bands;
}

/**
 * Bucketing "cirúrgico" por coluna — portado de `findStrictColumn` do motor de referência
 * (extratoVision/utils/parser.ts). Em vez de testar cada coluna de forma independente (o que
 * pode fazer um mesmo item de texto "pertencer" a duas colunas ao mesmo tempo quando as faixas
 * de tolerância se sobrepõem), calcula a SOBREPOSIÇÃO HORIZONTAL do item com cada banda de
 * coluna candidata e atribui o item à banda de MAIOR sobreposição — atribuição mutuamente
 * exclusiva, uma única banda vence. Item sem overlap com nenhuma banda cai no fallback de
 * "centro dentro da banda" (ainda mutuamente exclusivo: primeira banda cujo centro contém o
 * item). As bandas continuam sendo as faixas com tolerância (padding) já usadas neste arquivo —
 * só a REGRA DE DECISÃO entre bandas concorrentes é que muda para "maior overlap vence".
 */
export function findStrictColumn<TCol extends { x0: number; x1: number }>(
  item: { x: number; width: number },
  columns: TCol[],
): TCol | null {
  const itemLeft = item.x;
  const itemRight = item.x + item.width;
  const itemCenterX = item.x + item.width / 2;

  let maxOverlap = 0;
  let bestCol: TCol | null = null;
  for (const col of columns) {
    const overlapStart = Math.max(itemLeft, col.x0);
    const overlapEnd = Math.min(itemRight, col.x1);
    const overlap = overlapEnd - overlapStart;
    if (overlap > maxOverlap) {
      maxOverlap = overlap;
      bestCol = col;
    }
  }
  if (!bestCol) {
    bestCol = columns.find((c) => itemCenterX >= c.x0 && itemCenterX <= c.x1) || null;
  }
  return bestCol;
}

function detectColorFromCanvas(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number
): 'red' | 'blue' | 'black' {
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'black';
    const rx = Math.max(0, Math.floor(x));
    const ry = Math.max(0, Math.floor(y));
    const rw = Math.max(1, Math.min(Math.floor(w), canvas.width - rx));
    const rh = Math.max(1, Math.min(Math.floor(h), canvas.height - ry));
    const imgData = ctx.getImageData(rx, ry, rw, rh);
    const data = imgData.data;
    let redCount = 0;
    let blueCount = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i+1]!;
      const b = data[i+2]!;
      // Red: high R compared to G and B
      if (r > 130 && r > g + 40 && r > b + 40) {
        redCount++;
      }
      // Blue: high B compared to R and G
      else if (b > 130 && b > r + 40 && b > g + 25) {
        blueCount++;
      }
    }
    if (redCount > 5 && redCount > blueCount) return 'red';
    if (blueCount > 5 && blueCount > redCount) return 'blue';
  } catch (e) {
    console.error('Error detecting color from canvas:', e);
  }
  return 'black';
}

/**
 * Extracts text and crops images for each column of a row.
 * Esta versÃ£o foi substituÃ­da pela lÃ³gica "cirÃºrgica" do software de referÃªncia.
 */
export function extractDataFromCanvas(
  canvas: HTMLCanvasElement,
  textItems: PDFTextItem[],
  columns: DocumentColumns,
  rowConfigs: { y: number; height: number }[],
  isPercent: boolean = true,
  bandStartY?: number,
  bandEndY?: number,
  options?: { valorSignHeuristic?: 'automatic' | 'color_blue_c_red_d' | 'color_blue_d_red_c' }
): ExtractedRow[] {
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  const docWidth  = canvas.width;
  const docHeight = canvas.height;

  // Pre-filter text items to strictly within the crop band before any processing.
  const bandedItems = (bandStartY != null || bandEndY != null)
    ? textItems.filter((item) => {
        const centerY = item.y + item.height / 2;
        if (bandStartY != null && centerY < bandStartY) return false;
        if (bandEndY   != null && centerY > bandEndY)   return false;
        return true;
      })
    : textItems;

  // Deduplicate text items that have identical text and very close coordinates
  const uniqueTextItems: PDFTextItem[] = [];
  bandedItems.forEach((item) => {
    const isDuplicate = uniqueTextItems.some((existing) => {
      return (
        existing.text === item.text &&
        Math.abs(existing.x - item.x) < 2 &&
        Math.abs(existing.y - item.y) < 2
      );
    });
    if (!isDuplicate) {
      uniqueTextItems.push(item);
    }
  });

  // Helper to convert column percentage coordinates to pixels
  const getColPixels = (col: ColumnRange) => {
    if (isPercent) {
      return {
        startX: (col.startX / 100) * docWidth,
        width: (col.width / 100) * docWidth,
      };
    }
    return {
      startX: col.startX,
      width: col.width,
    };
  };

  const dateCol = getColPixels(columns.date);
  const histCol = getColPixels(columns.history);
  const valCol  = getColPixels(columns.value);

  // Helper function to crop a section of the canvas with super-sampling for high quality
  const cropCanvasSection = (
    srcX: number,
    srcY: number,
    srcW: number,
    srcH: number
  ): string => {
    try {
      const x = Math.max(0, Math.min(Math.round(srcX), docWidth - 1));
      const y = Math.max(0, Math.min(Math.round(srcY), docHeight - 1));
      const w = Math.max(1, Math.min(Math.round(srcW), docWidth - x));
      const h = Math.max(1, Math.min(Math.round(srcH), docHeight - y));

      const scale = 2; // 2x super-sampling for better quality when zoomed
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = w * scale;
      cropCanvas.height = h * scale;
      
      const cropCtx = cropCanvas.getContext('2d');
      if (!cropCtx) return '';

      cropCtx.imageSmoothingEnabled = true;
      cropCtx.imageSmoothingQuality = 'high';
      
      cropCtx.fillStyle = 'white';
      cropCtx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);

      cropCtx.drawImage(canvas, x, y, w, h, 0, 0, w * scale, h * scale);
      
      return cropCanvas.toDataURL('image/png', 0.95);
    } catch (e) {
      console.error('Error cropping canvas:', e);
      return '';
    }
  };

  // Helper to calculate horizontal overlap with a column
  const getColumnOverlap = (item: PDFTextItem, col: { startX: number; width: number }) => {
    const itemLeft = item.x;
    const itemRight = item.x + item.width;
    const colLeft = col.startX;
    const colRight = col.startX + col.width;

    const overlapLeft = Math.max(itemLeft, colLeft);
    const overlapRight = Math.min(itemRight, colRight);
    return Math.max(0, overlapRight - overlapLeft);
  };

  // 1. Group text items by row — o histórico de uma linha termina exatamente
  // onde começa a linha seguinte (posição Y real da próxima linha detectada),
  // não numa altura de grade fixa. Isso evita que o texto de uma linha "vaze"
  // para a de baixo (ex.: "SALDO DO DIA" herdando parte do histórico anterior)
  // — não existe conceito de grade de linhas aqui, só a ordem real das linhas.
  const rowItemsMap = new Map<number, PDFTextItem[]>();
  rowConfigs.forEach((_, idx) => rowItemsMap.set(idx, []));

  const sortedRowOrder = rowConfigs
    .map((row, idx) => ({ idx, y: row.y }))
    .sort((a, b) => a.y - b.y);

  const rowBounds = new Map<number, { start: number; end: number }>();
  let prevEnd = -Infinity;
  sortedRowOrder.forEach((entry, i) => {
    const row = rowConfigs[entry.idx];
    const nextY = i + 1 < sortedRowOrder.length ? sortedRowOrder[i + 1].y : Infinity;
    const configuredEnd = row.y + row.height;
    // Nunca deixa o limite inferior passar do início da próxima linha (mesmo que
    // a altura configurada desta linha tenha sido alargada por uma consolidação
    // anterior) — e nunca invade o território já atribuído à linha anterior.
    const end = Math.min(configuredEnd + 20, nextY);
    const start = Math.max(row.y - 20, prevEnd);
    rowBounds.set(entry.idx, { start, end });
    prevEnd = end;
  });

  uniqueTextItems.forEach((item) => {
    const itemCenterY = item.y + item.height / 2;
    let closestRowIndex = -1;
    let minDistance = Infinity;

    rowConfigs.forEach((row, idx) => {
      const bounds = rowBounds.get(idx)!;
      const isInsideRow = itemCenterY >= bounds.start && itemCenterY < bounds.end;
      if (!isInsideRow) return;

      const rowCenterY = row.y + row.height / 2;
      const distance = Math.abs(itemCenterY - rowCenterY);
      if (distance < minDistance) {
        minDistance = distance;
        closestRowIndex = idx;
      }
    });

    // Rede de segurança: a regra de "corta na próxima linha" nunca pode fazer
    // um item de texto ser descartado por inteiro. Se nenhuma faixa estrita
    // capturou o item (ex.: item caiu exatamente numa fronteira entre linhas),
    // atribui à linha mais próxima por distância absoluta — melhor um item na
    // linha vizinha do que sumir a informação inteira da tabela.
    if (closestRowIndex === -1) {
      rowConfigs.forEach((row, idx) => {
        const rowCenterY = row.y + row.height / 2;
        const distance = Math.abs(itemCenterY - rowCenterY);
        if (distance < minDistance) {
          minDistance = distance;
          closestRowIndex = idx;
        }
      });
    }

    if (closestRowIndex !== -1) {
      rowItemsMap.get(closestRowIndex)!.push(item);
    }
  });

  const rawExtractedRows = rowConfigs.map((row, index) => {
    const rowItems = rowItemsMap.get(index) || [];

    // 1.5 Pre-process items to split merged columns (e.g. date prefix or value suffix in a single PDF text block)
    const processedRowItems: PDFTextItem[] = [];

    rowItems.forEach((item) => {
      let currentText = item.text;
      let currentX = item.x;
      let currentWidth = item.width;

      // Check for date at the start (e.g. "05/06/20 " or "05/06/2020 ")
      const dateMatch = currentText.match(/^(\d{2}\/\d{2}(?:\/\d{2,4})?)\s+/);
      if (dateMatch) {
        const dateText = dateMatch[1]!;
        const dateLen = dateText.length;
        const totalLen = currentText.length;
        const dateWidth = (dateLen / totalLen) * currentWidth;

        processedRowItems.push({
          text: dateText,
          x: currentX,
          y: item.y,
          width: dateWidth,
          height: item.height,
        });

        const consumedLen = dateMatch[0]!.length;
        currentText = currentText.substring(consumedLen);
        currentX += (consumedLen / totalLen) * currentWidth;
        currentWidth -= (consumedLen / totalLen) * currentWidth;
      }

      // Check for value at the end (e.g. " 26.875,00 C", "496 26.875,00 C", " 46,86 D", " 150,00", "26875 C")
      const valueMatch = currentText.match(/(-?[0-9][0-9.,]*(?:[0-9]+,[0-9]{2}|,[0-9]{2})\s*[CDcd]?)$/) || 
                         currentText.match(/(-?[0-9]+(?:\s*[CDcd]))$/);

      if (valueMatch && valueMatch.index !== undefined && valueMatch.index > 0) {
        const valText = valueMatch[1]!;
        const valLen = valText.length;
        const totalLen = currentText.length;
        const valIndex = valueMatch.index;

        const prefixLen = valIndex; 
        const prefixWidth = (prefixLen / totalLen) * currentWidth;
        const valWidth = (valLen / totalLen) * currentWidth;

        const prefixText = currentText.substring(0, prefixLen).trim();
        if (prefixText) {
          processedRowItems.push({
            text: prefixText,
            x: currentX,
            y: item.y,
            width: prefixWidth,
            height: item.height,
          });
        }

        processedRowItems.push({
          text: valText,
          x: currentX + prefixWidth,
          y: item.y,
          width: valWidth,
          height: item.height,
        });
      } else {
        if (currentText.trim()) {
          processedRowItems.push({
            text: currentText,
            x: currentX,
            y: item.y,
            width: currentWidth,
            height: item.height,
          });
        }
      }
    });

    processedRowItems.sort((a, b) => a.x - b.x);

    // 2. Map items to columns via bucketing mutuamente exclusivo (findStrictColumn, portado do
    // motor de referência): cada item vai para a banda de MAIOR sobreposição horizontal, e não
    // mais para qualquer banda cujo teste independente "passe" (o que antes podia fazer um mesmo
    // item satisfazer duas colunas simultaneamente quando as tolerâncias se sobrepunham). As
    // bandas abaixo mantêm exatamente as mesmas tolerâncias (padding) já calibradas para os
    // extratos bancários suportados — só a decisão entre bandas concorrentes muda.
    type StrictBand = { id: 'date' | 'history' | 'value'; x0: number; x1: number };
    const dateBand: StrictBand = { id: 'date', x0: dateCol.startX - 15, x1: dateCol.startX + dateCol.width + 20 };
    const valueBand: StrictBand = { id: 'value', x0: valCol.startX - 35, x1: valCol.startX + valCol.width + 35 };
    const histBand: StrictBand = {
      id: 'history',
      x0: Math.min(histCol.startX, dateCol.startX + dateCol.width),
      x1: Math.max(histCol.startX + histCol.width, valCol.startX),
    };
    const strictBands: StrictBand[] = [dateBand, histBand, valueBand];
    const itemBand = new Map<PDFTextItem, StrictBand | null>();
    processedRowItems.forEach((item) => {
      itemBand.set(item, findStrictColumn(item, strictBands));
    });

    // 2.1 Date Column
    const rowDateItems = processedRowItems.filter((item) => {
      if (itemBand.get(item) === dateBand) return true;
      // Rede de segurança: mantém o teste de overlap por largura mínima do item original para
      // não perder itens que a banda estrita (mutuamente exclusiva) tenha deixado de fora por
      // pouco — mesma tolerância de antes, agora como fallback e não como regra primária.
      const dateOverlap = getColumnOverlap(item, dateCol);
      const overlapThreshold = item.width * 0.4;
      return itemBand.get(item) == null && dateOverlap > 0 && dateOverlap >= overlapThreshold;
    });

    // 2.2 Value Column Candidates (items that contain digits and are near/in the valCol)
    const valCandidatesInBand = processedRowItems.filter((item) => {
      const cleanText = item.text.trim();
      if (!cleanText || !/\d/.test(cleanText)) return false;
      if (itemBand.get(item) === valueBand) return true;
      const itemCenterX = item.x + item.width / 2;
      return itemBand.get(item) == null && itemCenterX >= valueBand.x0 && itemCenterX <= valueBand.x1;
    });

    const looksLikeNonMonetaryCode = (text: string) => /^\d{1,3}(?:\.\d{3})+$/.test(text.trim());
    const valCandidatesMonetary = valCandidatesInBand.filter((item) => !looksLikeNonMonetaryCode(item.text));
    const valCandidates = (valCandidatesMonetary.length > 0 ? valCandidatesMonetary : valCandidatesInBand)
      .sort((a, b) => a.x - b.x);

    const rowValItems: PDFTextItem[] = [];
    if (valCandidates.length > 0) {
      rowValItems.push(valCandidates[0]!);
      
      for (let i = 1; i < valCandidates.length; i++) {
        const prevItem = rowValItems[rowValItems.length - 1]!;
        const currentItem = valCandidates[i]!;
        const gap = currentItem.x - (prevItem.x + prevItem.width);
        
        if (gap <= 6) {
          rowValItems.push(currentItem);
        } else {
          break;
        }
      }
    }

    // 2.3 Add signs adjacent to rowValItems (if we found a main value)
    if (rowValItems.length > 0) {
      const minValX = rowValItems[0]!.x;
      const maxValX = rowValItems[rowValItems.length - 1]!.x + rowValItems[rowValItems.length - 1]!.width;

      const leftSignItem = processedRowItems.find((item) => {
        const isToLeft = item.x + item.width >= minValX - 20 && item.x + item.width <= minValX + 2;
        const cleanText = item.text.trim();
        return isToLeft && (cleanText === '-' || cleanText === '+');
      });
      if (leftSignItem && !rowValItems.includes(leftSignItem)) {
        rowValItems.unshift(leftSignItem);
      }

      const rightSignItem = processedRowItems.find((item) => {
        const isToRight = item.x >= maxValX - 2 && item.x <= maxValX + 55;
        const cleanText = item.text.trim().toUpperCase();
        const isSign = /^[CDCDcd\-+]$/.test(cleanText) || 
                        cleanText === 'DÉBITO' || cleanText === 'DEBITO' || 
                        cleanText === 'CRÉDITO' || cleanText === 'CREDITO';
        const hasDigits = /\d/.test(cleanText);
        return isToRight && isSign && !hasDigits;
      });
      if (rightSignItem && !rowValItems.includes(rightSignItem)) {
        rowValItems.push(rightSignItem);
      }

      rowValItems.sort((a, b) => a.x - b.x);
    }

    // 2.4 History Column — tudo que não foi capturado como data/valor e cuja banda estrita
    // vencedora é a de histórico (ou que caiu no vão entre data e valor, mesma regra de antes).
    const rowHistItems = processedRowItems.filter((item) => {
      if (rowDateItems.includes(item) || rowValItems.includes(item)) return false;
      if (itemBand.get(item) === histBand) return true;

      const itemCenterX = item.x + item.width / 2;
      const histOverlap = getColumnOverlap(item, histCol);
      const overlapThreshold = item.width * 0.4;
      const inHistCenter = itemCenterX >= histCol.startX && itemCenterX <= histCol.startX + histCol.width;

      if (inHistCenter || (histOverlap > 0 && histOverlap >= overlapThreshold)) {
        return true;
      }

      const dateEndX = dateCol.startX + dateCol.width;
      const valStartX = valCol.startX;
      return itemCenterX >= dateEndX && itemCenterX <= valStartX;
    });

    const dateText = rowDateItems.map(i => i.text).join(' ').trim();
    const historyText = rowHistItems.map(i => i.text).join(' ').trim();
    const rawValText = rowValItems.map(i => i.text).join(' ').trim();

    const valTextMatches = rawValText.match(/\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/g);
    let cleanValText =
      valTextMatches && valTextMatches.length > 0
        ? valTextMatches[0]!
        : rawValText.replace(/[^0-9.,]/g, '').trim();

    // 3. Extract exact visual crops - using dynamic boundaries from classified text items
    const verticalPadding = 2;
    const horizontalPadding = 12;
    
    let cropY = row.y - verticalPadding;
    let cropH = row.height + verticalPadding * 2;

    if (processedRowItems.length > 0) {
      const minYItem = Math.min(...processedRowItems.map(i => i.y));
      const maxYItem = Math.max(...processedRowItems.map(i => i.y + i.height));
      const itemsHeight = maxYItem - minYItem;
      
      cropY = minYItem - verticalPadding;
      cropH = itemsHeight + verticalPadding * 2;
    }

    if (cropH < 20) {
      const diff = 20 - cropH;
      cropY -= diff / 2;
      cropH = 20;
    }

    if (bandStartY !== undefined) {
      if (cropY < bandStartY) {
        const diff = bandStartY - cropY;
        cropY = bandStartY;
        cropH = Math.max(1, cropH - diff);
      }
    }
    if (bandEndY !== undefined) {
      if (cropY + cropH > bandEndY) {
        cropH = Math.max(1, bandEndY - cropY);
      }
    }

    // Limita a altura para nunca passar da próxima linha Y (regra de ouro do recorte perfeito)
    // Mesmo que consolidateTransactionRows tenha alargado a altura para fusão de continuações,
    // o recorte visual nunca pode sangrar na linha seguinte
    if (index + 1 < rowConfigs.length) {
      const nextRowY = rowConfigs[index + 1]!.y;
      const maxCropEnd = nextRowY - 2; // deixa 2px de margem
      const currentCropEnd = cropY + cropH;
      if (currentCropEnd > maxCropEnd) {
        cropH = Math.max(1, maxCropEnd - cropY);
      }
    }

    // Crop columns are excluded per user request. We keep urls empty to avoid slow canvas cropping.
    const dateCropUrl = '';
    const historyCropUrl = '';
    const valueCropUrl = '';
    const valCropBoundsX = valCol.startX;
    const valCropBoundsW = valCol.width;

    // 4. Analyze value sign
    let { isNegative, parsedValue } = analyzeValueString(rawValText);

    const upperVal = rawValText.toUpperCase();
    let isExplicitlyPositive = /\bC\b/.test(upperVal) || upperVal.endsWith('C') || upperVal.includes('CRÉDITO') || upperVal.includes('CREDITO') || upperVal.includes('+');
    let isExplicitlyNegative = /\bD\b/.test(upperVal) || upperVal.endsWith('D') || upperVal.includes('DÉBITO') || upperVal.includes('DEBITO') || upperVal.includes('-');

    // Heurística baseada no histórico (gabaritos Banco do Brasil, Santander, Sicredi e Nubank)
    if (!isExplicitlyPositive && !isExplicitlyNegative && historyText) {
      const upperHist = historyText.toUpperCase();
      const isExpenseKeyword = /\b(PAGAMENTO|PAGTO|PGTO|ENVIADO|ENVIADA|SAIDA|SAÍDA|APLICACAO|APLICAÇÃO|TARIFA|CUSTO|DESPESA|IMPOSTO|DARF|GPS|FGTS|BOLETO|COMPRA)\b/i.test(upperHist);
      const isIncomeKeyword = /\b(RECEBIDO|RECEBIDA|ENTRADA|RESGATE|RECEBIMENTO|RENDIMENTO)\b/i.test(upperHist);
      
      if (isExpenseKeyword && !isIncomeKeyword) {
        isExplicitlyNegative = true;
      } else if (isIncomeKeyword && !isExpenseKeyword) {
        isExplicitlyPositive = true;
      }
    }

    if (isExplicitlyPositive && !isExplicitlyNegative) {
      isNegative = false;
      if (parsedValue !== null) parsedValue = Math.abs(parsedValue);
    } else if (isExplicitlyNegative) {
      isNegative = true;
      if (parsedValue !== null) parsedValue = -Math.abs(parsedValue);
    } else if (rawValText) {
      const valEndX = valCol.startX + valCol.width;
      const rightItems = processedRowItems.filter((item) => {
        const itemLeft = item.x;
        return itemLeft >= valEndX - 5 && itemLeft <= valEndX + 55;
      });

      const signItem = rightItems.find((item) => {
        const clean = item.text.toUpperCase().trim();
        const isSign = /^[CDCDcd\-+]$/.test(clean) || 
                        clean === 'DÉBITO' || clean === 'DEBITO' || 
                        clean === 'CRÉDITO' || clean === 'CREDITO';
        const hasDigits = /\d/.test(clean);
        return isSign && !hasDigits;
      });

      if (signItem) {
        const signText = signItem.text.toUpperCase().trim();
        if (
          signText.includes('-') ||
          /\bD\b/.test(signText) ||
          signText.endsWith('D') ||
          signText.includes('DÉBITO') ||
          signText.includes('DEBITO')
        ) {
          isNegative = true;
          if (parsedValue !== null) parsedValue = -Math.abs(parsedValue);
        } else if (
          signText.includes('+') ||
          /\bC\b/.test(signText) ||
          signText.endsWith('C') ||
          signText.includes('CRÉDITO') ||
          signText.includes('CREDITO')
        ) {
          isNegative = false;
          if (parsedValue !== null) parsedValue = Math.abs(parsedValue);
        }
      }
    }

    // 4.5 Heurística de cor (D/C por texto azul/vermelho) — quando o usuário
    // seleciona essa opção no dropdown, ela tem prioridade sobre o texto "C"/"D"
    // detectado acima, pois o extrato pode não ter letra explícita e usar só cor.
    if (
      rawValText &&
      (options?.valorSignHeuristic === 'color_blue_c_red_d' || options?.valorSignHeuristic === 'color_blue_d_red_c')
    ) {
      const detectedColor = detectColorFromCanvas(canvas, valCropBoundsX, cropY, valCropBoundsW, cropH);
      if (detectedColor === 'blue') {
        isNegative = options.valorSignHeuristic === 'color_blue_d_red_c';
        if (parsedValue !== null) parsedValue = isNegative ? -Math.abs(parsedValue) : Math.abs(parsedValue);
      } else if (detectedColor === 'red') {
        isNegative = options.valorSignHeuristic === 'color_blue_c_red_d';
        if (parsedValue !== null) parsedValue = isNegative ? -Math.abs(parsedValue) : Math.abs(parsedValue);
      }
    }

    if (isNegative && cleanValText !== '' && !/^0(?:[.,]00?)?$/.test(cleanValText) && !cleanValText.startsWith('-')) {
      cleanValText = '-' + cleanValText;
    }

    return {
      id: `row-${index}-${Date.now()}`,
      dateText,
      historyText,
      valueText: cleanValText || rawValText,
      dateCropUrl,
      historyCropUrl,
      valueCropUrl,
      isNegative,
      parsedValue,
      y: row.y,
      height: row.height,
    };
  });

  // 5. Merge continuation rows (rows with no value yet — a transaction split across several
  // PDF text lines with the value landing on only one of them).
  // Two directions are possible for a valueless line:
  //   (a) trailing continuation — e.g. "REF: NOTA FISCAL 123" or a wrapped company name below a
  //       COMPLETE transaction line → belongs to the PREVIOUS row (original behavior). Signature:
  //       no date of its own, no upcoming value close by.
  //   (b) leading fragment — a label ("Pix - Recebido"), a lone date, or both, sitting on their
  //       own line(s) ABOVE the line that finally carries the value for that same lançamento →
  //       belongs to the NEXT row that has the value. Forcing it backward glues it onto the
  //       wrong (already-complete) transaction and leaves this row with an empty Valor.
  // The reliable signal for (b) is simply "this row already carries its own date but no value
  // yet" — it's still waiting on the rest of its own transaction, not trailing a finished one.
  // A bare label with no date at all (rare) is also accepted via a generic operation-keyword
  // fallback. Either way, a bounded lookahead must actually find the value nearby before
  // committing — otherwise the row is left alone and falls through to (a) or stays standalone.
  const RE_OPERACAO_LABEL =
    /\b(PIX|TED|DOC|BOLETO|PAGAMENTO|PAGTO|RECEB(?:IDO|IMENTO)?|TRANSFER[EÊ]NCIA|TRANSF|SAQUE|DEP[OÓ]SITO|COMPRA|VENDA|APLICACAO|RESGATE|TARIFA|SISPAG|COBRANCA)\b/i;
  // A well-formed date (DD/MM or DD/MM/AAAA) — used to prefer a real date over a stray numeric
  // fragment (lote/documento number) that a loose column boundary misclassified as "date".
  const RE_DATA_VALIDA = /^\d{1,2}\s*\/\s*\d{1,2}(?:\s*\/\s*\d{2,4})?$/;
  const isValidDateText = (t?: string) => !!t && RE_DATA_VALIDA.test(t.trim());
  const hasValueText = (r: ExtractedRow) => !!r.valueText && r.valueText.trim() !== '';
  const hasHistoryText = (r: ExtractedRow) => !!r.historyText && r.historyText.trim() !== '';

  const mergedExtractedRows: ExtractedRow[] = [];
  let pendingHistory = '';
  let pendingHistoryCropUrl = '';
  let pendingDate = '';
  let pendingDateCropUrl = '';
  let pendingHolding = false;

  const flushPendingInto = (row: ExtractedRow) => {
    if (!pendingHolding) return;
    row.historyText = pendingHistory ? `${pendingHistory} ${row.historyText || ''}`.trim() : row.historyText;
    row.historyCropUrl = row.historyCropUrl || pendingHistoryCropUrl;
    if (!isValidDateText(row.dateText) && isValidDateText(pendingDate)) {
      row.dateText = pendingDate;
      row.dateCropUrl = pendingDateCropUrl || row.dateCropUrl;
    } else if (!(row.dateText && row.dateText.trim() !== '')) {
      row.dateText = pendingDate;
      row.dateCropUrl = row.dateCropUrl || pendingDateCropUrl;
    }
    pendingHistory = '';
    pendingHistoryCropUrl = '';
    pendingDate = '';
    pendingDateCropUrl = '';
    pendingHolding = false;
  };

  rawExtractedRows.forEach((row, index) => {
    const hasValue = hasValueText(row);
    const hasDate = !!row.dateText && row.dateText.trim() !== '';
    const hasHistory = hasHistoryText(row);
    const canHold = !hasValue && (hasDate || (hasHistory && RE_OPERACAO_LABEL.test(row.historyText)));

    if (canHold) {
      // Bounded lookahead: bail out if an unrelated (non-date, non-keyword) row shows up before
      // any value does — that means this isn't actually a leading fragment of an upcoming
      // transaction, and it falls through to the trailing-continuation path below instead.
      let j = index + 1;
      let sawValue = false;
      while (j < rawExtractedRows.length && j <= index + 3) {
        const r = rawExtractedRows[j]!;
        const rHasDate = !!r.dateText && r.dateText.trim() !== '';
        if (rHasDate && row.dateText && row.dateText.trim() !== '' && r.dateText.trim() !== row.dateText.trim()) {
          // Different dates -> cannot belong to the same transaction
          break;
        }
        if (hasValueText(r)) { sawValue = true; break; }
        const rHasHistory = hasHistoryText(r);
        if (rHasHistory && !rHasDate && !RE_OPERACAO_LABEL.test(r.historyText)) break;
        j++;
      }
      if (sawValue) {
        if (hasHistory) {
          pendingHistory = pendingHistory ? `${pendingHistory} ${row.historyText}`.trim() : row.historyText.trim();
          pendingHistoryCropUrl = pendingHistoryCropUrl || row.historyCropUrl;
        }
        if (row.dateText && row.dateText.trim() !== '' && (isValidDateText(row.dateText) || !isValidDateText(pendingDate))) {
          pendingDate = row.dateText.trim();
          pendingDateCropUrl = row.dateCropUrl;
        }
        pendingHolding = true;
        return;
      }
    }

    flushPendingInto(row);

    const hasValueNow = hasValueText(row);
    const hasDateNow = !!row.dateText && row.dateText.trim() !== '';
    const hasHistoryNow = hasHistoryText(row);
    if (mergedExtractedRows.length === 0) { mergedExtractedRows.push(row); return; }
    const prev = mergedExtractedRows[mergedExtractedRows.length - 1]!;
    if (!hasValueNow && !hasDateNow && hasHistoryNow && !RE_OPERACAO_LABEL.test(row.historyText)) {
      prev.historyText = `${prev.historyText} ${row.historyText}`.trim();
    } else {
      mergedExtractedRows.push(row);
    }
  });
  if (pendingHolding) {
    mergedExtractedRows.push({
      id: `row-pending-${Date.now()}`,
      dateText: pendingDate,
      historyText: pendingHistory,
      valueText: '',
      dateCropUrl: pendingDateCropUrl,
      historyCropUrl: pendingHistoryCropUrl,
      valueCropUrl: '',
      isNegative: false,
      parsedValue: null,
      y: 0,
      height: 0,
    });
  }

  // 6. Propagate last seen date to subsequent rows in the same day grouping
  let lastSeenDate = '';
  mergedExtractedRows.forEach((row) => {
    if (row.dateText && row.dateText.trim() !== '') {
      lastSeenDate = row.dateText.trim();
    } else if (lastSeenDate) {
      row.dateText = lastSeenDate;
    }
  });

  // 7. Filtra rigorosamente linhas de ruído (cabeçalhos, rodapés, saldos, totais e linhas sem valores)
  return mergedExtractedRows.filter((row) => {
    // Deve possuir um histórico válido e não ser ruído institucional do extrato
    if (!row.historyText || row.historyText.trim() === '') return false;
    const cleanHist = row.historyText.trim();
    if (isBankStatementNoiseLine(cleanHist)) return false;
    if (isDailySummaryOrTotalLine(cleanHist)) return false;

    // Lançamentos contábeis reais obrigatoriamente possuem um valor numérico válido
    if (!row.valueText || row.valueText.trim() === '') return false;
    if (!/\d/.test(row.valueText)) return false;

    return true;
  });
}

export function extractGenericDataFromCanvas(
  canvas: HTMLCanvasElement,
  textItems: PDFTextItem[],
  columnIds: string[],
  columns: DocumentColumns | ColumnMapping,
  rowConfigs: { y: number; height: number }[],
  pageNumber?: number,
  isPercent: boolean = true,
  options?: { valorSignHeuristic?: 'automatic' | 'color_blue_c_red_d' | 'color_blue_d_red_c'; bandStartY?: number; bandEndY?: number }
): GenericExtractedRow[] {
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  const docWidth = canvas.width;
  const docHeight = canvas.height;

  // Pre-filter text items to strictly within the crop band before any processing.
  const bandStartY = options?.bandStartY;
  const bandEndY   = options?.bandEndY;
  const bandedItems = (bandStartY != null || bandEndY != null)
    ? textItems.filter((item) => {
        const centerY = item.y + item.height / 2;
        if (bandStartY != null && centerY < bandStartY) return false;
        if (bandEndY   != null && centerY > bandEndY)   return false;
        return true;
      })
    : textItems;



  const parseNum = (str: string | undefined): number => {
    if (!str) return 0;
    const clean = str.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
    const val = parseFloat(clean);
    return isNaN(val) ? 0 : val;
  };

  return rowConfigs
    .map((row, index) => {
      const fields: Record<string, string> = {};
      const cropUrls: Record<string, string> = {};
      const cropBounds: Record<string, { x: number; y: number; w: number; h: number }> = {};

      const verticalPadding = 2;
      const cropY = Math.max(0, row.y - verticalPadding);
      const cropH = Math.min(docHeight - cropY, row.height + verticalPadding * 2);

      // Itens de texto desta linha (mesma faixa Y) — o bucketing por coluna abaixo é
      // mutuamente exclusivo (findStrictColumn, portado do motor de referência): cada item vai
      // para a UMA coluna de maior sobreposição horizontal, em vez do teste anterior onde cada
      // coluna testava "centro do item dentro da minha banda" de forma independente (o que podia
      // duplicar um item em duas colunas quando bandas vizinhas se tocam).
      type StrictBand = { id: string; x0: number; x1: number };
      const bands: StrictBand[] = columnIds
        .map((id) => {
          const col = (columns as any)[id];
          if (!col) return null;
          const startX = isPercent ? (col.startX / 100) * docWidth : col.startX;
          const width = isPercent ? (col.width / 100) * docWidth : col.width;
          return { id, x0: startX, x1: startX + width };
        })
        .filter((b): b is StrictBand => b != null);

      const rowItems = bandedItems.filter((item) => {
        const itemCenterY = item.y + item.height / 2;
        return itemCenterY >= row.y && itemCenterY <= row.y + row.height;
      });

      const textByCol = new Map<string, string[]>();
      bands.forEach((b) => textByCol.set(b.id, []));
      rowItems.forEach((item) => {
        const best = findStrictColumn(item, bands);
        if (best) textByCol.get(best.id)!.push(item.text);
      });

      columnIds.forEach((id) => {
        const col = (columns as any)[id];
        if (!col) return;

        const startX = isPercent ? (col.startX / 100) * docWidth : col.startX;
        const width = isPercent ? (col.width / 100) * docWidth : col.width;

        const colText = (textByCol.get(id) || [])
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();

        fields[id] = colText;
        cropUrls[id] = '';
        cropBounds[id] = { x: startX, y: cropY, w: width, h: cropH };
      });

      // Se temos colunas individuais de debito e credito, combinamos em valorDc
      if (fields.debito || fields.credito) {
        const dVal = parseNum(fields.debito);
        const cVal = parseNum(fields.credito);
        if (dVal > 0) {
          fields.valorDc = fields.debito;
        } else if (cVal > 0) {
          fields.valorDc = '-' + fields.credito;
        }
      }

      // Se a heurÃ­stica de sinal for por cor, aplicamos na coluna valorDc
      if (fields.valorDc && (options?.valorSignHeuristic === 'color_blue_c_red_d' || options?.valorSignHeuristic === 'color_blue_d_red_c')) {
        const col = (columns as any)['valorDc'];
        if (col) {
          const startX = isPercent ? (col.startX / 100) * docWidth : col.startX;
          const width = isPercent ? (col.width / 100) * docWidth : col.width;
          const detectedColor = detectColorFromCanvas(canvas, startX, cropY, width, cropH);
          let isNegativeVal = false;
          if (detectedColor === 'blue') {
            isNegativeVal = options.valorSignHeuristic === 'color_blue_d_red_c';
          } else if (detectedColor === 'red') {
            isNegativeVal = options.valorSignHeuristic === 'color_blue_c_red_d';
          }
          
          let cleanVal = fields.valorDc.replace(/[CDcd]/g, '').trim();
          if (isNegativeVal) {
            if (!cleanVal.startsWith('-')) {
              cleanVal = '-' + cleanVal;
            }
          } else {
            if (cleanVal.startsWith('-')) {
              cleanVal = cleanVal.substring(1);
            }
          }
          fields.valorDc = cleanVal;
        }
      }

      // Se a coluna de data estiver mapeada, exigimos formato de data vÃ¡lido (filtra cabeÃ§alhos/textos)
      if (fields.data !== undefined) {
        const dStr = fields.data.trim();
        const isDate = /^\s*\d{2}\s*[\/\-]\s*\d{2}\s*[\/\-]\s*\d{2,4}\s*$/.test(dStr);
        if (!isDate) {
          return null;
        }
      }

      return {
        id: `row-${index}-${Date.now()}`,
        fields,
        cropUrls,
        cropBounds,
        y: row.y,
        height: row.height,
        pageNumber,
      };
    })
    .filter((row): row is Exclude<typeof row, null> => row !== null);
}

/**
 * Analyzes a monetary value string (Portuguese format) to check if it's positive or negative.
 */
export function analyzeValueString(valStr: string): { isNegative: boolean; parsedValue: number | null } {
  if (!valStr || valStr.trim() === '') {
    return { isNegative: false, parsedValue: null };
  }

  const clean = valStr.toUpperCase().trim();
  let isNegative = false;
  if (
    clean.includes('-') ||
    /\bD\b/.test(clean) ||
    clean.endsWith('D') ||
    clean.includes('DÉBITO') ||
    clean.includes('DEBITO') ||
    (clean.startsWith('(') && clean.endsWith(')'))
  ) {
    isNegative = true;
  }

  try {
    // Extrai o PRIMEIRO trecho em formato monetário BR válido (X.XXX,XX ou X,XX) em vez de
    // remover espaços e colar tudo — evita grudar um código/documento adjacente ao valor real
    // (ex.: recorte largo demais pega "9.903 13.630,00 D" e não pode virar 990.313.630,00).
    const matches = clean.match(/\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/g);
    let numericPart: string;
    if (matches && matches.length > 0) {
      numericPart = matches[0]!.replace(/\./g, '').replace(',', '.');
    } else {
      numericPart = clean
        .replace(/R\$/g, '')
        .replace(/\$/g, '')
        .replace(/C/g, '')
        .replace(/D/g, '')
        .replace(/-/g, '')
        .replace(/\(/g, '')
        .replace(/\)/g, '')
        .replace(/\s/g, '')
        .trim();
      numericPart = numericPart.replace(/\./g, '').replace(',', '.');
    }
    let parsedValue = parseFloat(numericPart);

    // Fallback tolerante a OCR (texto vindo de reconhecimento de imagem, ex.: Tesseract):
    // quando o parsing estrito acima não achou nada usável, tenta o parser que corrige trocas
    // de caractere comuns em OCR (O/Q->0, l/I->1, S->5, B->8, Z->2, G->6, T->7, g/q->9) e trata
    // espaço como separador decimal — portado do motor de referência (extratoVision).
    if (isNaN(parsedValue) || parsedValue === 0) {
      const ocrValue = parseMoneyValueOcrTolerant(valStr);
      if (ocrValue !== 0) {
        parsedValue = Math.abs(ocrValue);
      }
    }

    return {
      isNegative,
      parsedValue: isNaN(parsedValue) ? null : (isNegative ? -parsedValue : parsedValue),
    };
  } catch (e) {
    return {
      isNegative,
      parsedValue: null,
    };
  }
}

/** Utility functions needed by other parts of the system */
export function rowIntersectsCropBand(
  row: { y: number; height: number },
  startY: number,
  endY: number,
): boolean {
  const rowTop = row.y;
  const rowBottom = row.y + row.height;

  // Accepts any row that overlaps with the vertical crop delimitation band [startY, endY]
  return rowBottom >= startY && rowTop <= endY;
}

export function filterRowsInCropBand<T extends { y: number; height: number }>(
  rows: T[],
  startY: number,
  endY: number,
): T[] {
  return rows.filter((row) => rowIntersectsCropBand(row, startY, endY));
}

export type ExtractedRowPrunePrefs = {
  removeNoNumericValue?: boolean;
  removeNoHistory?: boolean;
  removeNoDate?: boolean;
  prunedRowIds?: string[];
};

/** Valor monetÃ¡rio real â€” precisa ter dÃ­gito e parse vÃ¡lido (exclui Â«AgÃªnciaÂ», Â«VALORESÂ»). */
export function rowHasNumericValue(
  row: Pick<ExtractedRow, 'valueText' | 'parsedValue'>,
): boolean {
  const v = (row.valueText || '').trim();
  if (!v || !/\d/.test(v)) return false;

  let parsedValue = row.parsedValue;
  if (parsedValue == null || Number.isNaN(parsedValue)) {
    const result = analyzeValueString(v);
    parsedValue = result.parsedValue;
  }

  // Valor válido: tem número E não é zero
  return parsedValue != null && !Number.isNaN(parsedValue) && parsedValue !== 0;
}

export function rowHasMeaningfulHistory(row: Pick<ExtractedRow, 'historyText'>): boolean {
  return (row.historyText || '').trim().length > 0;
}

export function rowHasMeaningfulDate(row: Pick<ExtractedRow, 'dateText'>): boolean {
  const d = (row.dateText || '').trim();
  return d.length > 0 && /\d/.test(d);
}

/**
 * PersistÃªncia de linhas removidas (pruned) pelo usuÃ¡rio.
 */
export function loadExtractedRowPrunePrefs(storageKey: string): ExtractedRowPrunePrefs {
  if (!storageKey) return {};
  try {
    const data = localStorage.getItem(`prune::${storageKey}`);
    return data ? (JSON.parse(data) as ExtractedRowPrunePrefs) : {};
  } catch {
    return {};
  }
}

export function saveExtractedRowPrunePrefs(
  storageKey: string,
  patch: ExtractedRowPrunePrefs,
): ExtractedRowPrunePrefs {
  if (!storageKey) return patch;
  const merged = { ...loadExtractedRowPrunePrefs(storageKey), ...patch };
  try {
    localStorage.setItem(`prune::${storageKey}`, JSON.stringify(merged));
  } catch (e) {
    console.error('Failed to save prune prefs', e);
  }
  return merged;
}

export function clearExtractedRowPrunePrefs(storageKey: string): void {
  if (!storageKey) return;
  try {
    localStorage.removeItem(`prune::${storageKey}`);
  } catch {
    /* ignore */
  }
}

export function pruneExtractedRows(
  rows: ExtractedRow[],
  prefs: ExtractedRowPrunePrefs,
): ExtractedRow[] {
  return rows.filter((row) => {
    if (prefs.removeNoNumericValue && !rowHasNumericValue(row)) return false;
    if (prefs.removeNoHistory) {
      const hasHist = (row.historyText || '').trim().length > 0;
      if (!hasHist) return false;
    }
    if (prefs.removeNoDate) {
      const d = (row.dateText || '').trim();
      const hasDate = d.length > 0 && /\d/.test(d);
      if (!hasDate) return false;
    }
    if (prefs.prunedRowIds && prefs.prunedRowIds.includes(row.id)) return false;
    return true;
  });
}

/**
 * Propaga a Ãºltima data vÃ¡lida para linhas com data vazia.
 */
export function propagateExtractedRowDates(rows: ExtractedRow[], stmtYear?: string): ExtractedRow[] {
  let lastDate = '';
  return rows.map((row) => {
    let current = row.dateText?.trim() || '';
    if (current) {
      // Se tiver ano no formato DD/MM e stmtYear for passado, completa
      if (stmtYear && /^\d{2}\/\d{2}$/.test(current)) {
        current = `${current}/${stmtYear}`;
      }
      lastDate = current;
      return { ...row, dateText: current };
    }
    return { ...row, dateText: lastDate };
  });
}
