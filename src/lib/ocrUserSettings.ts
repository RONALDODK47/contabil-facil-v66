import {
  readPersistedLocalStorageJson,
  writePersistedLocalStorageJson,
} from './persistentLocalStorage';
import type { AiOcrDocumentType } from './aiOcrTypes';
import {
  IMAGE_OCR_LONG_EDGE_4K,
  IMAGE_OCR_LONG_EDGE_FHD,
  IMAGE_OCR_LONG_EDGE_NATIVE,
  IMAGE_OCR_LONG_EDGE_2K5,
  PDF_RENDER_SCALE_MAX,
  PDF_RENDER_SCALE_MIN,
  type OcrPreprocessMode,
  type OcrResolutionPreset,
} from './imageOcrExtract';
import {
  getOcrRefineMode,
  setOcrRefineMode,
  type OcrRefineMode,
} from './ocrLayeredRefine';
import { ITAU_EXTRATO_IGNORE_LINE_WORDS_TEXT } from './itauExtratoProfile';
import type {
  LoadParcelamentoPreviewOptions,
  OcrPreviewOptions,
  OcrPreviewQuality,
} from './parcelamentoColunasExtract';

export type PdfPageOcrAutoOptions = {
  autoUpgradeResolution: boolean;
  resolutionPreset?: import('./imageOcrExtract').OcrResolutionPreset;
  pdfRenderScale?: number;
  quality?: OcrPreviewQuality;
  preprocessMode?: OcrPreprocessMode;
  psmMode?: OcrPsmMode;
  preferNativePdfText?: boolean;
};

export type OcrResolutionMode = 'auto' | OcrResolutionPreset | 'custom';

export type OcrPsmMode = 'auto' | '3' | '4' | '5' | '6' | '11';

export type OcrColumnReadMode = 'unified' | 'perColumn';

export interface OcrUserSettings {
  resolutionMode: OcrResolutionMode;
  /** Escala PDF manual (3–16) quando resolutionMode = custom. */
  pdfRenderScale: number;
  /** Maior lado da imagem em px (0 = original) quando resolutionMode = custom. */
  imageLongEdgePx: number;
  quality: OcrPreviewQuality;
  /** Amplia FHD → 4K automaticamente se o OCR não encontrar texto. */
  autoUpgradeResolution: boolean;
  preprocessMode: OcrPreprocessMode;
  psmMode: OcrPsmMode;
  refineMode: OcrRefineMode;
  /** Extrato: leitura unificada da faixa vs OCR coluna a coluna. */
  columnReadMode: OcrColumnReadMode;
  /** Exige faixa vertical marcada (sem fallback para página inteira). */
  strictFaixaVertical: boolean;
  /** PDF: tenta texto nativo antes do OCR na imagem. */
  preferNativePdfText: boolean;
  /** Tenta motor Extrato Vision quando o mapeamento colunar falha. */
  tryVisionFallback: boolean;
  /**
   * Palavras/frases para ignorar linhas inteiras no OCR (vírgula ou quebra de linha).
   * Correspondência sem distinção de maiúsculas/minúsculas.
   */
  ignoreLineWords: string;
}

const STORAGE_KEY = 'contabilfacil_ocr_user_settings';

export const DEFAULT_OCR_USER_SETTINGS: OcrUserSettings = {
  resolutionMode: 'auto',
  pdfRenderScale: 6,
  imageLongEdgePx: IMAGE_OCR_LONG_EDGE_FHD,
  quality: 'high',
  autoUpgradeResolution: false,
  preprocessMode: 'scan',
  psmMode: 'auto',
  refineMode: 'inteligente',
  columnReadMode: 'unified',
  strictFaixaVertical: false,
  preferNativePdfText: false,
  tryVisionFallback: true,
  ignoreLineWords: ITAU_EXTRATO_IGNORE_LINE_WORDS_TEXT,
};

export const OCR_RESOLUTION_MODE_LABELS: Record<OcrResolutionMode, string> = {
  auto: 'Automático (recomendado — escala adaptativa ~FHD/2,5K)',
  hd: 'HD (~1280 px)',
  fhd: 'Full HD (~1920 px)',
  '4k': '4K (~3840 px)',
  custom: 'Personalizado (escala manual)',
};

export const OCR_QUALITY_LABELS: Record<OcrPreviewQuality, string> = {
  fast: 'Rápido (reduz imagem)',
  balanced: 'Balanceado',
  high: 'Alto (mais lento, mais preciso)',
};

export const OCR_PREPROCESS_LABELS: Record<OcrPreprocessMode, string> = {
  auto: 'Automático',
  scan: 'Documento escaneado',
  light: 'Leve',
  extrato: 'Extrato bancário',
};

export const OCR_PSM_LABELS: Record<OcrPsmMode, string> = {
  auto: 'Automático (detecta layout)',
  '3': 'PSM 3 — página inteira',
  '4': 'PSM 4 — colunas variáveis',
  '5': 'PSM 5 — coluna vertical',
  '6': 'PSM 6 — bloco uniforme',
  '11': 'PSM 11 — texto esparso',
};

export const OCR_COLUMN_READ_LABELS: Record<OcrColumnReadMode, string> = {
  unified: 'Unificada (faixa inteira — recomendado extrato)',
  perColumn: 'Coluna a coluna (parcelamento / faixas estreitas)',
};

export const IMAGE_LONG_EDGE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: IMAGE_OCR_LONG_EDGE_NATIVE, label: 'Original (sem ampliar)' },
  { value: IMAGE_OCR_LONG_EDGE_FHD, label: 'Full HD (1920 px)' },
  { value: IMAGE_OCR_LONG_EDGE_2K5, label: '2,5K (2560 px)' },
  { value: IMAGE_OCR_LONG_EDGE_4K, label: '4K (3840 px)' },
];

function normalizeRefineMode(raw: unknown): OcrRefineMode {
  if (raw === 'turbo' || raw === 'inteligente' || raw === 'maximo') return raw;
  if (raw === 'completo') return 'maximo';
  if (raw === 'padrao') return 'inteligente';
  return 'inteligente';
}

function clampSettings(raw: Partial<OcrUserSettings>): OcrUserSettings {
  const base = { ...DEFAULT_OCR_USER_SETTINGS, ...raw };
  const preprocessMode =
    base.preprocessMode === 'auto' || base.preprocessMode === 'extrato'
      ? 'scan'
      : base.preprocessMode;
  return {
    ...base,
    preprocessMode,
    pdfRenderScale: Math.min(
      PDF_RENDER_SCALE_MAX,
      Math.max(PDF_RENDER_SCALE_MIN, Number(base.pdfRenderScale) || DEFAULT_OCR_USER_SETTINGS.pdfRenderScale),
    ),
    imageLongEdgePx: Math.max(0, Math.min(8192, Math.round(Number(base.imageLongEdgePx) || 0))),
    refineMode: normalizeRefineMode(base.refineMode),
    ignoreLineWords:
      typeof base.ignoreLineWords === 'string'
        ? base.ignoreLineWords
        : DEFAULT_OCR_USER_SETTINGS.ignoreLineWords,
  };
}

export function getOcrUserSettings(): OcrUserSettings {
  if (typeof localStorage === 'undefined') {
    return { ...DEFAULT_OCR_USER_SETTINGS, refineMode: getOcrRefineMode() };
  }
  try {
    const parsed = readPersistedLocalStorageJson<Partial<OcrUserSettings> | null>(STORAGE_KEY, null);
    if (!parsed) {
      return { ...DEFAULT_OCR_USER_SETTINGS, refineMode: getOcrRefineMode() };
    }
    return clampSettings({ ...parsed, refineMode: parsed.refineMode ?? getOcrRefineMode() });
  } catch {
    return { ...DEFAULT_OCR_USER_SETTINGS, refineMode: getOcrRefineMode() };
  }
}

export function setOcrUserSettings(partial: Partial<OcrUserSettings>): OcrUserSettings {
  const next = clampSettings({ ...getOcrUserSettings(), ...partial });
  if (partial.refineMode != null) {
    setOcrRefineMode(next.refineMode);
  }
  if (typeof localStorage !== 'undefined') {
    writePersistedLocalStorageJson(STORAGE_KEY, next);
  }
  return next;
}

export function resetOcrUserSettings(): OcrUserSettings {
  if (typeof localStorage !== 'undefined') {
    writePersistedLocalStorageJson(STORAGE_KEY, DEFAULT_OCR_USER_SETTINGS);
  }
  setOcrRefineMode(DEFAULT_OCR_USER_SETTINGS.refineMode);
  return { ...DEFAULT_OCR_USER_SETTINGS };
}

export function ocrSettingsToLoadOptions(
  settings: OcrUserSettings,
  extra?: Partial<LoadParcelamentoPreviewOptions>,
): LoadParcelamentoPreviewOptions {
  const opts: LoadParcelamentoPreviewOptions = { ...extra };
  if (settings.resolutionMode === 'custom') {
    opts.pdfRenderScale = settings.pdfRenderScale;
    opts.imageOcrLongEdgePx = settings.imageLongEdgePx;
  } else if (settings.resolutionMode !== 'auto') {
    opts.resolutionPreset = settings.resolutionMode;
  }
  return opts;
}

export function ocrSettingsToPreviewOptions(
  settings: OcrUserSettings,
  _documentType?: AiOcrDocumentType,
): OcrPreviewOptions {
  return {
    quality: settings.quality,
    preprocessMode: settings.preprocessMode,
  };
}

export function ocrSettingsToPdfAutoOptions(settings: OcrUserSettings): PdfPageOcrAutoOptions {
  return {
    autoUpgradeResolution: settings.autoUpgradeResolution,
    resolutionPreset: settings.resolutionMode !== 'auto' && settings.resolutionMode !== 'custom'
      ? settings.resolutionMode
      : undefined,
    pdfRenderScale: settings.resolutionMode === 'custom' ? settings.pdfRenderScale : undefined,
    quality: settings.quality,
    preprocessMode: settings.preprocessMode,
    psmMode: settings.psmMode,
    preferNativePdfText: settings.preferNativePdfText,
  };
}

export type OcrColumnStripSettings = {
  preprocessMode?: OcrPreprocessMode;
  columnReadMode?: OcrColumnReadMode;
};

export function ocrSettingsToColumnStripOptions(settings: OcrUserSettings): OcrColumnStripSettings {
  return {
    preprocessMode: settings.preprocessMode,
    columnReadMode: settings.columnReadMode,
  };
}
