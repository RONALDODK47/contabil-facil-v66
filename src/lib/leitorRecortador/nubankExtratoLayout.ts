import type { PDFTextItem, DocumentColumns, ExtractedRow } from './types';
import { detectRowsFromText } from './cropper';
import { parseExtratoDataOcrText } from '../ocrExtratoPositional';
import { parseExtratoMoneyValue } from '../../extratoVision/utils/extratoMoneyParse';

export type PosicionadoLike = { str: string; x: number; y: number; w: number; h: number };

const RE_NUBANK_DATE = /^\d{1,2}\s+[A-ZÁÉÍÓÚÇ]{3,9}\s+\d{4}$/i;
const RE_NUBANK_VAL = /^[+-]?\s*\d{1,3}(?:\.\d{3})*,\d{2}$/;

/** Padrões de lançamento real (não totais/resumo). */
const RE_NUBANK_TX_HINT =
  /transfer[eê]ncia|pagamento de fatura|valor adicionado|pix|tarifa|compra|estorno|recebido|enviad/i;

export const NUBANK_EXCLUSION_RULES = [
  'SALDO ANTERIOR',
  'SALDO DO DIA',
  'SALDO ATUAL',
  'SALDO FINAL',
  'SALDO INICIAL',
  'SALDO FINAL DO PERÍODO',
  'RENDIMENTO LÍQUIDO',
  'VALORES EM R$',
  'MOVIMENTAÇÕES',
  'TEM ALGUMA DÚVIDA',
  'EXTRATO GERADO',
  'OUVIDORIA',
  'NU PAGAMENTOS',
  'NU FINANCEIRA',
];

/** Limites horizontais calibrados a partir do PDF (px). */
export type NubankGeometry = {
  imgWidth: number;
  /** Coluna data: tokens «08 JUN 2026» — x ≈ 87 */
  dateMaxX: number;
  /** Coluna histórico: x ≈ 180 e continuação x ≈ 392 */
  histMinX: number;
  /** Coluna valor: x ≈ 736–780 */
  valueMinX: number;
  movimentacoesY: number | null;
  faixaStart: number;
  faixaEnd: number;
  columns: DocumentColumns;
};

export function pdfTextItemsToPosicionado(items: PDFTextItem[]): PosicionadoLike[] {
  return items.map((t) => ({ str: t.text, x: t.x, y: t.y, w: t.width, h: t.height }));
}

function normVal(str: string): string {
  return str.trim().replace(/\s+/g, ' ');
}

function isValueToken(str: string): boolean {
  return RE_NUBANK_VAL.test(normVal(str));
}

export type NubankLayoutDetectOptions = {
  /** Quando a página 1 já foi identificada como Nubank, páginas seguintes herdam. */
  documentIsNubank?: boolean;
};

function hasNubankTransactionPattern(items: PosicionadoLike[], imgWidth: number): boolean {
  return items.some(
    (it) =>
      RE_NUBANK_TX_HINT.test(it.str) &&
      items.some(
        (o) =>
          Math.abs(o.y - it.y) < 14 &&
          o.x > imgWidth * 0.65 &&
          isValueToken(o.str),
      ),
  );
}

export function isNubankExtratoLayout(
  items: PosicionadoLike[],
  imgWidth: number,
  options?: NubankLayoutDetectOptions,
): boolean {
  if (options?.documentIsNubank) return true;
  if (items.length < 15 || imgWidth <= 0) return false;
  const blob = items.map((i) => i.str).join(' ').toUpperCase();
  const looksNu =
    /NUBANK|NU\s+PAGAMENTOS|NU\s+FINANCEIRA|4020\s+0185|0800\s+591\s+2117|NUPAGAMENTOS/i.test(blob);
  const hasMov = /MOVIMENTAÇÕES|VALORES EM R\$/i.test(blob);
  const nubankDates = items.filter(
    (it) => it.x < imgWidth * 0.2 && RE_NUBANK_DATE.test(it.str.trim()),
  );
  const hasDayTotals = /TOTAL DE ENTRADAS|TOTAL DE SAÍDAS/i.test(blob);
  const hasTxRows = hasNubankTransactionPattern(items, imgWidth);
  return looksNu && hasMov && (nubankDates.length >= 1 || hasTxRows || hasDayTotals);
}

function pct(startPx: number, endPx: number, imgWidth: number): { startX: number; width: number } {
  const startX = Math.max(0, (startPx / imgWidth) * 100);
  const endPct = Math.min(100, (endPx / imgWidth) * 100);
  return { startX: Number(startX.toFixed(2)), width: Number((endPct - startX).toFixed(2)) };
}

/**
 * Calibra colunas a partir das posições reais do PDF Nubank.
 * Layout típico (893px): data x≈87 | hist x≈180 + x≈392 | valor x≈736–780
 */
export function calibrateNubankGeometry(
  items: PosicionadoLike[],
  imgWidth: number,
  imgHeight: number,
  pageNumber = 1,
): NubankGeometry {
  const heights = items.map((i) => i.h).filter((h) => h > 0).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 12;
  const pad = Math.max(6, medianH * 0.35);

  const dateTokens = items.filter(
    (it) => it.x < imgWidth * 0.22 && RE_NUBANK_DATE.test(it.str.trim()),
  );
  const valTokens = items.filter(
    (it) => it.x > imgWidth * 0.65 && isValueToken(it.str),
  );
  const histTokens = items.filter(
    (it) => it.x >= imgWidth * 0.17 && it.x < imgWidth * 0.72 && it.str.trim().length > 2,
  );

  const dateMaxX =
    dateTokens.length > 0
      ? Math.max(...dateTokens.map((t) => t.x + t.w)) + pad
      : imgWidth * 0.175;

  const valueMinX =
    valTokens.length > 0
      ? Math.min(...valTokens.map((t) => t.x)) - pad
      : imgWidth * 0.815;

  const histMinX =
    histTokens.length > 0
      ? Math.min(...histTokens.map((t) => t.x)) - pad * 0.5
      : imgWidth * 0.19;

  const mov = items.find((it) => /^movimenta/i.test(it.str.trim()));
  const movimentacoesY = mov ? mov.y : null;

  const footerYs = items
    .filter((it) =>
      /tem alguma dúvida|extrato gerado|ouvidoria|nubank\.com\.br\/contatos|o saldo líquido corresponde|não nos responsabilizamos|asseguramos a autenticidade/i.test(
        it.str,
      ),
    )
    .map((it) => it.y);

  const firstTx = items
    .filter((it) => {
      if (it.x < histMinX || it.x >= valueMinX) return false;
      if (!RE_NUBANK_TX_HINT.test(it.str)) return false;
      return items.some(
        (o) =>
          Math.abs(o.y - it.y) < medianH * 0.65 &&
          o.x >= valueMinX &&
          isValueToken(o.str),
      );
    })
    .sort((a, b) => a.y - b.y)[0];

  let faixaStart = pad;
  if (mov != null && pageNumber <= 1) {
    faixaStart = mov.y + mov.h + pad;
  } else if (firstTx) {
    faixaStart = Math.max(pad, firstTx.y - pad * 0.5);
  } else if (dateTokens.length > 0) {
    faixaStart = Math.max(pad, Math.min(...dateTokens.map((d) => d.y)) - pad);
  }

  const bodyBottom = items.length ? Math.max(...items.map((i) => i.y + i.h)) : imgHeight;
  let faixaEnd =
    footerYs.length > 0 && Math.min(...footerYs) > faixaStart + medianH * 2
      ? Math.min(...footerYs) - pad
      : bodyBottom - pad;
  faixaEnd = Math.max(faixaEnd, faixaStart + medianH * 3);

  const columns: DocumentColumns = {
    date: pct(0, dateMaxX, imgWidth),
    history: pct(histMinX, valueMinX, imgWidth),
    value: pct(valueMinX, imgWidth, imgWidth),
  };

  return {
    imgWidth,
    dateMaxX,
    histMinX,
    valueMinX,
    movimentacoesY,
    faixaStart,
    faixaEnd,
    columns,
  };
}

export function nubankDefaultColumns(): DocumentColumns {
  return {
    date: { startX: 0, width: 17.5 },
    history: { startX: 17, width: 64.5 },
    value: { startX: 81.5, width: 18.5 },
  };
}

export type NubankPageLayout = {
  columns: DocumentColumns;
  faixaStartPct: number;
  faixaEndPct: number;
  geometry: NubankGeometry;
};

export function suggestNubankExtratoPageLayout(
  items: PosicionadoLike[],
  imgWidth: number,
  imgHeight: number,
  pageNumber = 1,
): NubankPageLayout {
  const geo = calibrateNubankGeometry(items, imgWidth, imgHeight, pageNumber);
  return {
    columns: geo.columns,
    faixaStartPct: Math.max(0, (geo.faixaStart / imgHeight) * 100),
    faixaEndPct: Math.min(100, (geo.faixaEnd / imgHeight) * 100),
    geometry: geo,
  };
}

export type NubankFlowSign = 'entrada' | 'saida';

export type NubankRowConfig = {
  y: number;
  height: number;
  anchorDate: string;
  /** Posição Y da data no PDF (linha «Total de entradas», não na linha do Pix). */
  anchorDateY?: number;
  anchorDateH?: number;
  /** Sinal herdado do bloco «Total de entradas» (+) ou «Total de saídas» (−). */
  flowSign?: NubankFlowSign | null;
};

function rowBlob(items: PDFTextItem[]): string {
  return [...items]
    .sort((a, b) => a.x - b.x)
    .map((i) => i.text)
    .join(' ')
    .toUpperCase();
}

function inZoneDate(item: PDFTextItem, geo: NubankGeometry): boolean {
  return item.x + item.width <= geo.dateMaxX + 4;
}

function inZoneHist(item: PDFTextItem, geo: NubankGeometry): boolean {
  const cx = item.x + item.width / 2;
  return cx >= geo.histMinX && cx < geo.valueMinX;
}

function inZoneValue(item: PDFTextItem, geo: NubankGeometry): boolean {
  return item.x >= geo.valueMinX - 4;
}

function detectFlowFromRow(blob: string): NubankFlowSign | null {
  if (/TOTAL DE ENTRADAS/i.test(blob)) return 'entrada';
  if (/TOTAL DE SAÍDAS/i.test(blob)) return 'saida';
  return null;
}

function isFlowTotalRow(blob: string, items: PDFTextItem[], geo: NubankGeometry): boolean {
  if (!detectFlowFromRow(blob)) return false;
  return items.some(
    (it) =>
      inZoneHist(it, geo) &&
      /^TOTAL DE ENTRADAS$|^TOTAL DE SAÍDAS$/i.test(it.text.trim()),
  );
}

function shouldSkipNubankRow(
  blob: string,
  items: PDFTextItem[],
  geo: NubankGeometry,
  rowCenterY: number,
): boolean {
  if (rowCenterY < geo.faixaStart || rowCenterY > geo.faixaEnd) return true;
  if (!blob.trim()) return true;

  if (geo.movimentacoesY != null && rowCenterY < geo.movimentacoesY) return true;

  if (/^CASTELO DE ACUCAR|^CNPJ\s|^AGÊNCIA\s|^CONTA\s|^\d{2}\.\d{3}\.\d{3}/i.test(blob)) return true;
  if (/^\d{1,2}\s+DE\s+[A-Z]+\s+DE\s+\d{4}\s+A\s/i.test(blob)) return true;
  if (/^R\$/.test(blob) && /TOTAL DE ENTRADAS|SALDO FINAL/.test(blob)) return true;

  if (isFlowTotalRow(blob, items, geo) && rowHasTransactionValue(items, geo)) return false;

  if (
    /SALDO INICIAL|RENDIMENTO LÍQUIDO|SALDO FINAL DO PERÍODO|SALDO DO DIA|VALORES EM R\$|^MOVIMENTAÇÕES$/i.test(
      blob,
    )
  ) {
    return true;
  }
  if (/TEM ALGUMA DÚVIDA|EXTRATO GERADO|OUVIDORIA|NU PAGAMENTOS|NU FINANCEIRA|NUPAGAMENTOS|O SALDO LÍQUIDO/i.test(blob)) {
    return true;
  }
  return false;
}

function rowHasTransactionValue(items: PDFTextItem[], geo: NubankGeometry): boolean {
  return items.some((it) => inZoneValue(it, geo) && isValueToken(it.text));
}

function rowHasHistory(items: PDFTextItem[], geo: NubankGeometry): boolean {
  return items.some((it) => inZoneHist(it, geo) && it.text.trim().length > 1);
}

function isContinuationRow(items: PDFTextItem[], geo: NubankGeometry): boolean {
  if (rowHasTransactionValue(items, geo)) return false;
  return rowHasHistory(items, geo);
}

function isTransactionStartRow(items: PDFTextItem[], geo: NubankGeometry, blob: string): boolean {
  if (!rowHasTransactionValue(items, geo)) return false;
  if (/SALDO DO DIA|TOTAL DE ENTRADAS|TOTAL DE SAÍDAS|RENDIMENTO|SALDO FINAL|SALDO INICIAL/i.test(blob)) {
    return false;
  }
  if (rowHasHistory(items, geo)) return true;
  return RE_NUBANK_TX_HINT.test(blob);
}

function medianTokenHeight(items: PosicionadoLike[]): number {
  const heights = items.map((i) => i.h).filter((h) => h > 0).sort((a, b) => a - b);
  return heights[Math.floor(heights.length / 2)] || 12;
}

function captureDateAnchor(
  items: PDFTextItem[],
  geo: NubankGeometry,
): { text: string; y: number; h: number } | null {
  const tok = items.find(
    (it) => inZoneDate(it, geo) && RE_NUBANK_DATE.test(it.text.trim()),
  );
  if (!tok) return null;
  return { text: tok.text.trim(), y: tok.y, h: tok.height };
}

function findDateAnchorOnPage(
  textItems: PDFTextItem[],
  geo: NubankGeometry,
  dateText?: string,
): { text: string; y: number; h: number } | null {
  const normalized = dateText?.trim().toUpperCase();
  const candidates = textItems.filter(
    (it) => inZoneDate(it, geo) && RE_NUBANK_DATE.test(it.text.trim()),
  );
  if (!candidates.length) return null;
  if (normalized) {
    const exact = candidates.find((it) => it.text.trim().toUpperCase() === normalized);
    if (exact) return { text: exact.text.trim(), y: exact.y, h: exact.height };
  }
  const sorted = [...candidates].sort((a, b) => b.y - a.y);
  const tok = sorted[0];
  return { text: tok.text.trim(), y: tok.y, h: tok.height };
}

function findLastDayDateInPage(items: PosicionadoLike[], geo: NubankGeometry): string {
  const minY = geo.movimentacoesY ?? geo.faixaStart;
  const dates = items
    .filter(
      (it) =>
        it.x < geo.dateMaxX &&
        RE_NUBANK_DATE.test(it.str.trim()) &&
        it.y >= minY - 4 &&
        it.y <= geo.faixaEnd + 4,
    )
    .sort((a, b) => b.y - a.y);
  return dates[0]?.str.trim() ?? '';
}

/** Última âncora de data visível na página (texto + posição para recorte). */
export function getNubankLastDateAnchor(
  textItems: PDFTextItem[],
  imgWidth: number,
  imgHeight: number,
  pageNumber: number,
): { text: string; y: number; h: number } | null {
  const pos = pdfTextItemsToPosicionado(textItems);
  const geo = calibrateNubankGeometry(pos, imgWidth, imgHeight, pageNumber);
  return findDateAnchorOnPage(textItems, geo);
}

/** Última data de dia visível na página (para propagar à página seguinte). */
export function getNubankLastDayDate(
  textItems: PDFTextItem[],
  imgWidth: number,
  imgHeight: number,
  pageNumber: number,
): string {
  const pos = pdfTextItemsToPosicionado(textItems);
  const geo = calibrateNubankGeometry(pos, imgWidth, imgHeight, pageNumber);
  return findLastDayDateInPage(pos, geo);
}

/** Último bloco de fluxo (entradas/saídas) visível na página. */
export function getNubankLastFlowSign(
  textItems: PDFTextItem[],
  imgWidth: number,
  imgHeight: number,
  pageNumber: number,
): NubankFlowSign | null {
  const pos = pdfTextItemsToPosicionado(textItems);
  const geo = calibrateNubankGeometry(pos, imgWidth, imgHeight, pageNumber);
  const medianH = medianTokenHeight(pos);
  const rawRows = detectRowsFromText(textItems, 8);
  const flowZoneMinY =
    geo.movimentacoesY != null && pageNumber <= 1
      ? geo.movimentacoesY
      : Math.max(0, geo.faixaStart - medianH * 4);
  let lastFlow: NubankFlowSign | null = null;
  for (const row of rawRows) {
    const rowCenterY = row.y + row.height / 2;
    if (rowCenterY < flowZoneMinY || rowCenterY > geo.faixaEnd + medianH) continue;
    const flow = detectFlowFromRow(rowBlob(row.items));
    if (flow) lastFlow = flow;
  }
  return lastFlow;
}

/**
 * Detecta lançamentos reais na faixa «Movimentações», agrupando descrição multilinha (Pix).
 * `carryDate` propaga a data do último dia da página anterior (ex.: 16 JUN continua na pág. 2).
 * `carryFlow` propaga o bloco «Total de entradas/saídas» da página anterior.
 */
export function detectNubankTransactionRows(
  textItems: PDFTextItem[],
  imgWidth: number,
  imgHeight?: number,
  pageNumber = 1,
  carryDate = '',
  carryFlow: NubankFlowSign | null = null,
  carryDateY = 0,
  carryDateH = 0,
): NubankRowConfig[] {
  if (!textItems.length) return [];

  const pos = pdfTextItemsToPosicionado(textItems);
  const h = imgHeight ?? Math.max(...pos.map((i) => i.y + i.h), 400);
  const geo = calibrateNubankGeometry(pos, imgWidth, h, pageNumber);
  const medianH = medianTokenHeight(pos);

  const rawRows = detectRowsFromText(textItems, 8);
  const pageDateAnchor = findDateAnchorOnPage(textItems, geo);
  let currentDate = carryDate.trim() || findLastDayDateInPage(pos, geo);
  let currentDateY = carryDateY > 0 ? carryDateY : pageDateAnchor?.y ?? 0;
  let currentDateH =
    carryDateH > 0 ? carryDateH : pageDateAnchor?.h ?? medianH;
  let currentFlow: NubankFlowSign | null = carryFlow;
  const out: NubankRowConfig[] = [];
  let pending: NubankRowConfig | null = null;

  const flowZoneMinY =
    geo.movimentacoesY != null && pageNumber <= 1
      ? geo.movimentacoesY
      : Math.max(0, geo.faixaStart - medianH * 4);

  const flush = () => {
    if (pending) {
      out.push(pending);
      pending = null;
    }
  };

  for (const row of rawRows) {
    const rowCenterY = row.y + row.height / 2;
    const blob = rowBlob(row.items);

    const anchorHit = captureDateAnchor(row.items, geo);
    if (anchorHit) {
      currentDate = anchorHit.text;
      currentDateY = anchorHit.y;
      currentDateH = anchorHit.h;
    }

    const flowHit = detectFlowFromRow(blob);
    if (flowHit && rowCenterY >= flowZoneMinY && rowCenterY <= geo.faixaEnd + medianH) {
      currentFlow = flowHit;
      flush();
      if (isFlowTotalRow(blob, row.items, geo) && rowHasTransactionValue(row.items, geo)) {
        const dateAnchor =
          findDateAnchorOnPage(textItems, geo, currentDate) ??
          (currentDateY > 0
            ? { text: currentDate, y: currentDateY, h: currentDateH }
            : null);
        out.push({
          y: row.y,
          height: row.height,
          anchorDate: currentDate,
          anchorDateY: dateAnchor?.y ?? currentDateY,
          anchorDateH: dateAnchor?.h ?? currentDateH,
          flowSign: flowHit,
        });
      }
      continue;
    }

    if (shouldSkipNubankRow(blob, row.items, geo, rowCenterY)) {
      flush();
      continue;
    }

    if (isTransactionStartRow(row.items, geo, blob)) {
      flush();
      const dateAnchor =
        findDateAnchorOnPage(textItems, geo, currentDate) ??
        (currentDateY > 0
          ? { text: currentDate, y: currentDateY, h: currentDateH }
          : null);
      pending = {
        y: row.y,
        height: row.height,
        anchorDate: currentDate,
        anchorDateY: dateAnchor?.y ?? currentDateY,
        anchorDateH: dateAnchor?.h ?? currentDateH,
        flowSign: currentFlow,
      };
      continue;
    }

    if (pending && isContinuationRow(row.items, geo)) {
      const bottom = row.y + row.height;
      pending.height = bottom - pending.y;
      continue;
    }

    flush();
  }

  flush();
  return out.map((r) => ({
    ...r,
    anchorDate: r.anchorDate || currentDate,
    anchorDateY: r.anchorDateY ?? currentDateY,
    anchorDateH: r.anchorDateH ?? currentDateH,
    flowSign: r.flowSign ?? currentFlow,
  }));
}

function renderTextCrop(text: string, width: number, height: number): string {
  try {
    const c = document.createElement('canvas');
    c.width = Math.max(96, Math.round(width));
    c.height = Math.max(22, Math.round(height));
    const ctx = c.getContext('2d');
    if (!ctx) return '';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#141414';
    ctx.font = '600 11px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 4, c.height / 2);
    return c.toDataURL('image/png');
  } catch {
    return '';
  }
}

function resolveNubankDateCrop(
  canvas: HTMLCanvasElement,
  textItems: PDFTextItem[],
  geo: NubankGeometry,
  cfg: NubankRowConfig,
  dPx: { x: number; w: number },
  pad: number,
): string {
  const medianH = medianTokenHeight(pdfTextItemsToPosicionado(textItems));
  let dateH = cfg.anchorDateH ?? medianH;

  const pageAnchor = findDateAnchorOnPage(textItems, geo, cfg.anchorDate);
  if (pageAnchor) {
    return cropSection(canvas, dPx.x, pageAnchor.y - pad, dPx.w, pageAnchor.h + pad * 2);
  }

  let dateY = cfg.anchorDateY ?? 0;
  if (dateY <= 0 && cfg.anchorDate) {
    const normalized = cfg.anchorDate.trim().toUpperCase();
    const tok = textItems
      .filter(
        (it) =>
          inZoneDate(it, geo) &&
          it.text.trim().toUpperCase() === normalized,
      )
      .sort((a, b) => Math.abs(a.y - cfg.y) - Math.abs(b.y - cfg.y))[0];
    if (tok) {
      dateY = tok.y;
      dateH = tok.height;
    }
  }

  if (dateY > 0) {
    return cropSection(canvas, dPx.x, dateY - pad, dPx.w, dateH + pad * 2);
  }

  if (cfg.anchorDate.trim()) {
    return renderTextCrop(cfg.anchorDate, dPx.w, dateH + pad * 2);
  }

  return '';
}

function cropSection(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
): string {
  try {
    const docW = canvas.width;
    const docH = canvas.height;
    const sx = Math.max(0, Math.min(x, docW - 1));
    const sy = Math.max(0, Math.min(y, docH - 1));
    const sw = Math.max(1, Math.min(w, docW - sx));
    const sh = Math.max(1, Math.min(h, docH - sy));
    const c = document.createElement('canvas');
    c.width = sw;
    c.height = sh;
    const ctx = c.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    return c.toDataURL('image/png');
  } catch {
    return '';
  }
}

function analyzeNubankValue(
  valStr: string,
  flowSign?: NubankFlowSign | null,
): { isNegative: boolean; parsedValue: number | null } {
  const t = normVal(valStr);
  if (!t) return { isNegative: false, parsedValue: null };

  const parsed = parseExtratoMoneyValue(t.replace(/^[+-]\s*/, ''));
  if (parsed == null || Number.isNaN(parsed)) {
    const legacy = analyzeNubankValueLegacy(t);
    return legacy;
  }

  const absVal = Math.abs(parsed);
  const explicitNegative = /^-/.test(t) || /^\(\s*/.test(t);
  const explicitPositive = /^\+/.test(t);

  if (flowSign === 'saida') {
    return { isNegative: true, parsedValue: -absVal };
  }
  if (flowSign === 'entrada') {
    return { isNegative: false, parsedValue: absVal };
  }

  if (explicitNegative) return { isNegative: true, parsedValue: -absVal };
  if (explicitPositive) return { isNegative: false, parsedValue: absVal };
  return { isNegative: false, parsedValue: absVal };
}

function analyzeNubankValueLegacy(valStr: string): { isNegative: boolean; parsedValue: number | null } {
  const t = normVal(valStr);
  const isNegative = /^-/.test(t) || /^\(\s*/.test(t);
  const parsed = parseExtratoMoneyValue(t.replace(/^[+]\s*/, ''));
  if (parsed == null || Number.isNaN(parsed)) return { isNegative, parsedValue: null };
  return { isNegative: parsed < 0 || isNegative, parsedValue: isNegative ? -Math.abs(parsed) : parsed };
}

/** Extração por zonas calibradas — precisão no layout Nubank. */
export function extractNubankDataFromCanvas(
  canvas: HTMLCanvasElement,
  textItems: PDFTextItem[],
  columns: DocumentColumns,
  rowConfigs: NubankRowConfig[],
  statementYear?: string,
  pageNumber = 1,
): ExtractedRow[] {
  const pos = pdfTextItemsToPosicionado(textItems);
  const geo = calibrateNubankGeometry(pos, canvas.width, canvas.height, pageNumber);
  const pad = 7;

  return rowConfigs.map((cfg, index) => {
    const y0 = cfg.y - pad;
    const y1 = cfg.y + cfg.height + pad;

    const rowItems = textItems.filter((it) => {
      const cy = it.y + it.height / 2;
      return cy >= cfg.y - 2 && cy <= cfg.y + cfg.height + 2;
    });

    const dateParts: string[] = [];
    const histParts: string[] = [];
    const valParts: string[] = [];

    for (const it of rowItems.sort((a, b) => a.x - b.x || a.y - b.y)) {
      if (inZoneValue(it, geo) && isValueToken(it.text)) {
        valParts.push(normVal(it.text));
      } else if (inZoneHist(it, geo)) {
        histParts.push(it.text.trim());
      } else if (inZoneDate(it, geo) && !RE_NUBANK_DATE.test(it.text.trim())) {
        dateParts.push(it.text.trim());
      }
    }

    const dateFromAnchor = cfg.anchorDate
      ? parseExtratoDataOcrText(cfg.anchorDate, statementYear)
      : '';
    const dateText = dateFromAnchor || dateParts.join(' ').trim();
    const historyText = histParts.join(' ').replace(/\s+/g, ' ').trim();
    const valueText = valParts.join(' ').trim();
    const { isNegative, parsedValue } = analyzeNubankValue(valueText, cfg.flowSign);

    const dateCol = columns.date;
    const histCol = columns.history;
    const valCol = columns.value;
    const toPx = (col: { startX: number; width: number }) => ({
      x: (col.startX / 100) * canvas.width,
      w: (col.width / 100) * canvas.width,
    });
    const dPx = toPx(dateCol);
    const hPx = toPx(histCol);
    const vPx = toPx(valCol);
    const dateCropUrl = resolveNubankDateCrop(canvas, textItems, geo, cfg, dPx, pad);

    return {
      id: `nubank-row-${index}-${Date.now()}`,
      dateText,
      historyText,
      valueText,
      dateCropUrl,
      historyCropUrl: cropSection(canvas, hPx.x, y0, hPx.w, y1 - y0),
      valueCropUrl: cropSection(canvas, vPx.x, y0, vPx.w, y1 - y0),
      isNegative,
      parsedValue,
      y: cfg.y,
      height: cfg.height,
      pageNumber,
    };
  });
}
