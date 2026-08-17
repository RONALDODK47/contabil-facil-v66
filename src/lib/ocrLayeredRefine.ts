import type { AiOcrDocumentType } from './aiOcrTypes';
import { notifyValidationIssue } from './aiProactiveNotify';
import {
  readPersistedLocalStorageJson,
  writePersistedLocalStorageJson,
} from './persistentLocalStorage';

export type OcrRefineMode = 'turbo' | 'inteligente' | 'maximo';

const STORAGE_KEY = 'contabilfacil_ocr_refine_mode_v1';
const LEGACY_STORAGE_KEY = 'ocr_refine_mode';

export const OCR_REFINE_MODE_LABELS: Record<OcrRefineMode, string> = {
  turbo: 'Turbo (sem Llama)',
  inteligente: 'Inteligente',
  maximo: 'Precisão máxima',
};

function readStoredRefineMode(): OcrRefineMode {
  const v = readPersistedLocalStorageJson<string | null>(STORAGE_KEY, null);
  if (v === 'turbo' || v === 'inteligente' || v === 'maximo') return v;
  if (typeof localStorage !== 'undefined') {
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy === 'turbo' || legacy === 'inteligente' || legacy === 'maximo') {
      writePersistedLocalStorageJson(STORAGE_KEY, legacy);
      return legacy;
    }
  }
  return 'inteligente';
}

export function getOcrRefineMode(): OcrRefineMode {
  if (typeof localStorage === 'undefined') return 'inteligente';
  return readStoredRefineMode();
}

export function setOcrRefineMode(mode: OcrRefineMode): void {
  if (typeof localStorage !== 'undefined') {
    writePersistedLocalStorageJson(STORAGE_KEY, mode);
  }
}

/** dd/mm com ano opcional — padrão Bradesco e demais extratos. */
const RE_DATA = /\d{1,2}\s*[/.-]\s*\d{1,2}(?:\s*[/.-]\s*\d{2,4})?/;
const RE_DATA_INICIO = /^\s*\d{1,2}\s*[/.-]\s*\d{1,2}(?:\s*[/.-]\s*\d{2,4})?/;
const RE_MOEDA =
  /\d{1,3}(?:\.\d{3})*(?:,\s*\d{2}|\s*,\s*\d{2})|\d{1,11}\s*,\s*\d{2}|\d{4,}(?:,\s*\d{2}|\s*,\s*\d{2})/;
const RE_SUSPEITO = /[|@#~`{}[\]\\^]/;
const RE_OCR_NUM = /[OIlSBGQZ][0-9]|[0-9][OIlSBGQZ]/;

const TABULAR_TYPES = new Set<AiOcrDocumentType>([
  'extrato',
  'parcelamento',
  'balancete',
  'folha',
]);

/** 0–100 — quanto maior, mais confiável a linha do Tesseract. */
export function scoreOcrLineQuality(line: string, documentType: AiOcrDocumentType): number {
  const t = line.replace(/\s+/g, ' ').trim();
  if (!t) return 0;
  if (t.length < 3) return 15;

  let score = 55;

  if (RE_DATA.test(t)) score += 22;
  if (RE_MOEDA.test(t)) score += 22;

  if (RE_SUSPEITO.test(t)) score -= 28;
  if (RE_OCR_NUM.test(t)) score -= 18;
  if (/\d{1,2}\s+\d{1,2}\s+\d{2,4}/.test(t) && !RE_DATA.test(t)) score -= 15;
  if (/,\s*,|\.\s*\./.test(t)) score -= 12;
  if (/\?\?\?|xxx/i.test(t)) score -= 25;

  if (TABULAR_TYPES.has(documentType)) {
    const hasDate = RE_DATA.test(t);
    const hasMoney = RE_MOEDA.test(t);
    if (hasDate && hasMoney) score += 12;
    else if (/\d/.test(t) && (!hasDate || !hasMoney)) score -= 10;
  }

  if (/^(saldo|total|subtotal|pagina|página)\b/i.test(t)) score += 8;

  return Math.max(0, Math.min(100, score));
}

export function lineNeedsLlamaRefine(
  line: string,
  documentType: AiOcrDocumentType,
  tessConf?: number,
): boolean {
  const t = line.trim();
  if (!t) return false;

  const quality = scoreOcrLineQuality(t, documentType);

  if (tessConf != null && tessConf >= 90 && quality >= 82) return false;
  if (tessConf != null && tessConf < 72) return true;

  return quality < 72;
}

function isExtratoHeaderOrNoise(t: string): boolean {
  if (/^(data|hist|valor|saldo|total|lancamento|dcto|credito|debito|agencia|conta)\b/i.test(t)) {
    return true;
  }
  if (/^saldo anterior/i.test(t)) return true;
  if (/^total\s*\(/i.test(t)) return true;
  return false;
}

function lineHasExtratoDate(t: string): boolean {
  return RE_DATA_INICIO.test(t) || RE_DATA.test(t);
}

function lineHasExtratoMoney(t: string): boolean {
  return RE_MOEDA.test(t);
}

/** Validação leve pós-OCR — avisa no MindFlow, não bloqueia importação. */
export function validateOcrLinesAccounting(
  lines: string[],
  documentType: AiOcrDocumentType,
): void {
  if (!TABULAR_TYPES.has(documentType) || lines.length < 3) return;

  if (documentType === 'extrato') {
    let rowsWithMoney = 0;
    let rowsWithMoneyNoDate = 0;
    let rowsWithDate = 0;
    let rowsWithDateNoMoney = 0;

    for (const line of lines) {
      const t = line.trim();
      if (!t || t.length < 4) continue;
      if (!/\d/.test(t)) continue;
      if (isExtratoHeaderOrNoise(t)) continue;

      const hasDate = lineHasExtratoDate(t);
      const hasMoney = lineHasExtratoMoney(t);
      if (!hasDate && !hasMoney) continue;

      if (hasMoney) {
        rowsWithMoney++;
        if (!hasDate) rowsWithMoneyNoDate++;
      }
      if (hasDate) {
        rowsWithDate++;
        if (!hasMoney) rowsWithDateNoMoney++;
      }
    }

    if (rowsWithMoney >= 4 && rowsWithMoneyNoDate / rowsWithMoney >= 0.55) {
      notifyValidationIssue(
        'ocr',
        'Várias linhas sem data legível — revise colunas ou use modo Precisão máxima.',
      );
    }
    if (rowsWithDate >= 4 && rowsWithDateNoMoney / rowsWithDate >= 0.55) {
      notifyValidationIssue(
        'ocr',
        'Várias linhas sem valor legível — confira delimitação vertical e coluna de valores.',
      );
    }
    return;
  }

  let dataRows = 0;
  let missingDate = 0;
  let missingMoney = 0;

  for (const line of lines) {
    const t = line.trim();
    if (!t || t.length < 6) continue;
    if (!/\d/.test(t)) continue;
    if (/^(data|hist|valor|saldo|total)\b/i.test(t)) continue;

    dataRows++;
    if (!RE_DATA.test(t)) missingDate++;
    if (!RE_MOEDA.test(t)) missingMoney++;
  }

  if (dataRows >= 4 && missingDate / dataRows >= 0.45) {
    notifyValidationIssue(
      'ocr',
      'Várias linhas sem data legível — revise colunas ou use modo Precisão máxima.',
    );
  }
  if (dataRows >= 4 && missingMoney / dataRows >= 0.45) {
    notifyValidationIssue(
      'ocr',
      'Várias linhas sem valor legível — confira delimitação vertical e coluna de valores.',
    );
  }
}

export function pickLinesForLlamaRefine(
  lines: string[],
  documentType: AiOcrDocumentType,
  mode: OcrRefineMode,
  lineConfidences?: (number | undefined)[],
): number[] {
  if (mode === 'turbo') return [];
  const indices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (mode === 'maximo' || lineNeedsLlamaRefine(lines[i], documentType, lineConfidences?.[i])) {
      indices.push(i);
    }
  }
  return indices;
}
