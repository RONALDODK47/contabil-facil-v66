/**
 * Regras OCR customizadas — persistidas na nuvem (Firestore via extra_storage).
 */
import {
  readPersistedLocalStorageJson,
  writePersistedLocalStorageJson,
} from './persistentLocalStorage';

export type OcrCustomRule = { from: string; to: string };

export type OcrDatePropagationMode = 'propagate' | 'one-per-tx';

const REPLACEMENTS_KEY = 'contabilfacil_ocr_custom_replacements_v1';
const DATE_MODE_KEY = 'contabilfacil_ocr_date_propagation_mode_v1';
const LEGACY_REPLACEMENTS_KEY = 'ocr_custom_replacements';
const LEGACY_DATE_MODE_KEY = 'ocr_date_propagation_mode';

export function getOcrCustomReplacements(): OcrCustomRule[] | null {
  const stored = readPersistedLocalStorageJson<OcrCustomRule[] | null>(REPLACEMENTS_KEY, null);
  if (Array.isArray(stored) && stored.length > 0) return stored;

  if (typeof localStorage === 'undefined') return null;
  try {
    const legacy = localStorage.getItem(LEGACY_REPLACEMENTS_KEY);
    if (!legacy?.trim()) return null;
    const parsed = JSON.parse(legacy) as OcrCustomRule[];
    if (Array.isArray(parsed) && parsed.length > 0) {
      writePersistedLocalStorageJson(REPLACEMENTS_KEY, parsed);
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function setOcrCustomReplacements(rules: OcrCustomRule[]): void {
  writePersistedLocalStorageJson(REPLACEMENTS_KEY, rules);
}

export function getOcrDatePropagationMode(): OcrDatePropagationMode {
  const stored = readPersistedLocalStorageJson<OcrDatePropagationMode | null>(DATE_MODE_KEY, null);
  if (stored === 'propagate' || stored === 'one-per-tx') return stored;

  if (typeof localStorage !== 'undefined') {
    const legacy = localStorage.getItem(LEGACY_DATE_MODE_KEY);
    if (legacy === 'propagate' || legacy === 'one-per-tx') {
      writePersistedLocalStorageJson(DATE_MODE_KEY, legacy);
      return legacy;
    }
  }
  return 'propagate';
}

export function setOcrDatePropagationMode(mode: OcrDatePropagationMode): void {
  writePersistedLocalStorageJson(DATE_MODE_KEY, mode);
}
