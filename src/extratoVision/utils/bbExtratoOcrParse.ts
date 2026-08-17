/**
 * Parser de linhas OCR para extrato Banco do Brasil (Internet Banking / PDF escaneado).
 * Formato: Data | Ag/Lote/Histórico | Documento | Valor R$ C/D | Saldo
 */
import { fixOcrHistoricoLine } from '../../lib/ocrExtratoTokenFix';
import { type OcrPosicionadoItem } from '../../lib/ocrExtratoPositional';
import { moedaExtratoPlausivel } from './extratoMoneyParse';
import {
  collapseBbExtratoOcrLineDuplication,
  linhaPareceExtratoBbOcr,
  normalizeBbExtratoLineOcrForValorScan,
} from './bbExtratoOcrNormalize';

export type BbExtratoOcrRow = Record<string, string>;

const RE_DATE_START = /^(\d{2}\/\d{2}\/\d{4})\s+/;
const RE_MONEY_CD =
  /(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s*([DC])\b/gi;
const RE_MONEY_SIGNED = /([-−]?\d{1,3}(?:\.\d{3})*,\d{2}|[-−]?\d+,\d{2})/g;

function normalizeBbOcrLine(line: string): string {
  let t = line
    .replace(/\s+/g, ' ')
    .replace(/(\d{1,3}(?:\.\d{3})*)\s+(\d{2})\s*([DC])\b/gi, '$1,$2 $3')
    .trim();
  if (linhaPareceExtratoBbOcr(t)) {
    t = normalizeBbExtratoLineOcrForValorScan(t);
  }
  return t;
}

function isBbHeaderOrNoise(line: string): boolean {
  const t = line.toLowerCase();
  if (/saldo\s+anterior/.test(t)) return true;
  if (/^https?:\/\//i.test(line)) return true;
  if (
    /consultas\s*-\s*extrato|conta corrente|ag[eê]ncia|cliente\s*-\s*conta|visualizar pix|internet banking|sisbb|template\//i.test(
      t,
    ) &&
    !RE_DATE_START.test(line)
  ) {
    return true;
  }
  if (/^(data|lan[cç]amento|documento|valor\s*r|hist[oó]rico|saldo)\b/i.test(t)) return true;
  return false;
}

function extractHistoricoBb(raw: string, dateLen: number, valueStart: number): string {
  let hist = raw.slice(dateLen, valueStart).trim();
  hist = fixOcrHistoricoLine(hist).replace(/\s+/g, ' ').trim();
  if (!hist) return '';
  if (hist.length > 180) hist = hist.slice(0, 180).trim();
  return hist;
}

/** Interpreta uma linha OCR do extrato BB (texto já unido). */
export function parseBbExtratoOcrLine(line: string): BbExtratoOcrRow | null {
  const raw = normalizeBbOcrLine(line);
  if (!raw || isBbHeaderOrNoise(raw)) return null;

  const dateM = raw.match(RE_DATE_START);
  if (!dateM) return null;

  const pairs: { value: string; cd: 'C' | 'D'; index: number }[] = [];
  for (const m of raw.matchAll(RE_MONEY_CD)) {
    if (m.index == null) continue;
    pairs.push({
      value: m[1],
      cd: m[2].toUpperCase() as 'C' | 'D',
      index: m.index,
    });
  }

  if (pairs.length === 0) {
    const signed: { value: string; negative: boolean; index: number }[] = [];
    for (const m of raw.matchAll(RE_MONEY_SIGNED)) {
      if (m.index == null) continue;
      const token = m[1];
      const negative = /^[-−]/.test(token);
      const core = token.replace(/^[-−]/, '');
      if (moedaExtratoPlausivel(core) <= 0) continue;
      signed.push({ value: core, negative, index: m.index });
    }
    if (signed.length === 0) return null;
    const tx = signed.length >= 2 ? signed[signed.length - 2]! : signed[signed.length - 1]!;
    const descricao = extractHistoricoBb(raw, dateM[0].length, tx.index);
    if (!descricao) return null;
    const row: BbExtratoOcrRow = {
      data: dateM[1],
      descricao,
      _linhaOcr: raw,
      valorMisto: tx.negative ? `-${tx.value}` : tx.value,
    };
    if (tx.negative) {
      row.valorDebito = tx.value;
      row.valorCredito = '';
    } else {
      row.valorCredito = tx.value;
      row.valorDebito = '';
    }
    return row;
  }

  const txPair = pairs.length >= 2 ? pairs[pairs.length - 2] : pairs[pairs.length - 1];
  const valor = moedaExtratoPlausivel(txPair.value);
  if (valor <= 0) return null;

  const descricao = extractHistoricoBb(raw, dateM[0].length, txPair.index);
  if (!descricao) return null;

  const row: BbExtratoOcrRow = {
    data: dateM[1],
    descricao,
    _linhaOcr: raw,
  };
  if (txPair.cd === 'D') {
    row.valorDebito = txPair.value;
    row.valorCredito = '';
  } else {
    row.valorCredito = txPair.value;
    row.valorDebito = '';
  }
  return row;
}

function rowClusterToLine(row: OcrPosicionadoItem[]): string {
  return row
    .slice()
    .sort((a, b) => a.x - b.x)
    .map((it) => it.str)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Agrupa tokens por faixa Y sem dividir linhas (evita fragmentação do extrato posicional). */
function clusterLinhasBbOcr(items: OcrPosicionadoItem[]): OcrPosicionadoItem[][] {
  if (items.length === 0) return [];
  const heights = items.map((i) => i.h).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 12;
  const tol = Math.max(6, medianH * 0.55);
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: OcrPosicionadoItem[][] = [];
  for (const it of sorted) {
    const cy = it.y + it.h / 2;
    let row = rows.find((r) => Math.abs(r[0].y + r[0].h / 2 - cy) <= tol);
    if (!row) rows.push([it]);
    else row.push(it);
  }
  for (const r of rows) r.sort((a, b) => a.x - b.x);
  return rows;
}

function parseBbLines(lines: string[]): BbExtratoOcrRow[] {
  const rows: BbExtratoOcrRow[] = [];
  for (const line of lines) {
    const parsed = parseBbExtratoOcrLine(line);
    if (parsed) rows.push(parsed);
  }
  return rows;
}

/** Extrai lançamentos BB a partir de tokens OCR posicionados (Tesseract). */
export function extractBbExtratoRowsFromOcrItems(
  items: OcrPosicionadoItem[],
  _imgWidth?: number,
  _statementYear?: string,
  ocrFullText?: string,
): BbExtratoOcrRow[] {
  if (ocrFullText?.trim()) {
    const fromText = parseBbExtratoOcrText(ocrFullText);
    if (fromText.length >= 1) return fromText;
  }

  const simpleLines = clusterLinhasBbOcr(items).map(rowClusterToLine);
  const fromSimple = parseBbLines(simpleLines);
  if (fromSimple.length >= 1) return fromSimple;

  const fromJoined = parseBbExtratoOcrText(simpleLines.join('\n'));
  if (fromJoined.length >= 1) return fromJoined;

  return [];
}

/** Extrai lançamentos BB a partir do texto OCR completo (modo linha a linha). */
export function parseBbExtratoOcrText(text: string): BbExtratoOcrRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => collapseBbExtratoOcrLineDuplication(l.trim()))
    .filter(Boolean);
  const rows: BbExtratoOcrRow[] = [];
  for (const line of lines) {
    const parsed = parseBbExtratoOcrLine(line);
    if (parsed) rows.push(parsed);
  }
  return rows;
}
