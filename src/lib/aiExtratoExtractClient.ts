/**
 * Cliente browser — extração de extrato via IA (visão + OCR).
 */
import type { GenericOcrRow } from './parcelamentoColunasExtract';

const AGENT_BASE =
  typeof import.meta.env.VITE_AGENT_API_URL === 'string' && import.meta.env.VITE_AGENT_API_URL
    ? import.meta.env.VITE_AGENT_API_URL.replace(/\/$/, '')
    : '/api/agent';

/** Alinhado ao servidor — extração IA otimizada por página.
 * Pode ser sobrescrito em tempo de build com a variável `VITE_EXTRACT_REQUEST_TIMEOUT_MS` (ms).
 */
const EXTRACT_REQUEST_TIMEOUT_MS = (() => {
  try {
    const v = (import.meta as any).env?.VITE_EXTRACT_REQUEST_TIMEOUT_MS;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  } catch { }
  return 120_000;
})();

export type AiExtractImage = {
  base64: string;
  mimeType: string;
};

/** Marca linhas vindas da extração IA (visão/refino híbrido) para regras de coluna D/C. */
export function marcarRowsExtracaoAi<T extends GenericOcrRow>(rows: T[]): T[] {
  return rows.map((r) => ({ ...r, _extratoAiExtract: '1' as const }));
}

export type AiExtractPlanoResult = {
  ok: boolean;
  rows?: GenericOcrRow[];
  model?: string;
  provider?: string;
  rowCount?: number;
  reason?: string;
  detail?: string;
};

export type AiExtractLoanContractResult = {
  ok: boolean;
  data?: {
    contractNumber?: string;
    bankName?: string;
    principal?: number;
    installments?: number;
    startDate?: string;
    interestRate?: number;
    gracePeriod?: number;
    graceType?: 'paid' | 'capitalized';
    amortizationType?: 'PRICE' | 'SAC';
    indexType?: 'CDI' | 'SELIC' | 'FIXED' | 'NONE';
    iof?: number;
    costs?: number;
  };
  model?: string;
  provider?: string;
  reason?: string;
  detail?: string;
};

export type AiExtractExtratoResult = {
  ok: boolean;
  rows?: GenericOcrRow[];
  saldoAnterior?: number | null;
  saldoFinal?: number | null;
  conciliacao?: {
    ok?: boolean;
    delta?: number | null;
    saldoConciliado?: number;
    saldoFinal?: number | null;
    creditos?: number;
    debitos?: number;
  } | null;
  model?: string;
  provider?: string;
  rowCount?: number;
  reason?: string;
  detail?: string;
};

import type { ExtratoEscalationKind, ExtratoExtractQuality } from '../contabilfacil/logic/extratoQualityGate';

export type ExtratoExtractDiagnostic = {
  engine: string;
  scale?: number;
  escalations: ExtratoEscalationKind[];
  quality: ExtratoExtractQuality;
};

export type OcrConfirmMeta = {
  conciliacaoRawRows?: GenericOcrRow[];
  saldoAnterior?: number | null;
  saldoFinalEsperado?: number | null;
  extractDiagnostic?: ExtratoExtractDiagnostic;
  /** Texto OCR agregado — usado na revisão para achar lançamentos faltantes. */
  ocrTextBlob?: string;
};

/** Converte preview URL/blob/data URL para base64 JPEG (com redimensionamento). */
export async function previewUrlToBase64(
  previewUrl: string,
  maxLongEdge = 3600,
): Promise<AiExtractImage | null> {
  if (!previewUrl?.trim()) return null;

  const viaCanvas = async (): Promise<AiExtractImage | null> => {
    if (typeof document === 'undefined') return null;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Falha ao carregar imagem da prévia'));
      img.src = previewUrl;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return null;
    const scale = Math.min(1, maxLongEdge / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, cw, ch);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const base64 = dataUrl.split(',')[1] ?? '';
    if (!base64) return null;
    return { base64, mimeType: 'image/jpeg' };
  };

  try {
    return await viaCanvas();
  } catch {
    try {
      const res = await fetch(previewUrl);
      const blob = await res.blob();
      const mimeType = blob.type || 'image/png';
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
      return { base64: btoa(binary), mimeType };
    } catch {
      return null;
    }
  }
}

/** Converte File para base64 (uso interno — não altera a interface visual). */
export async function fileToBase64Payload(
  file: File,
): Promise<{ fileBase64: string; mimeType: string } | null> {
  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
    const fileBase64 = btoa(binary);
    if (!fileBase64) return null;
    const mimeType =
      file.type ||
      (/\.pdf$/i.test(file.name)
        ? 'application/pdf'
        : /\.png$/i.test(file.name)
          ? 'image/png'
          : /\.jpe?g$/i.test(file.name)
            ? 'image/jpeg'
            : 'application/octet-stream');
    return { fileBase64, mimeType };
  } catch {
    return null;
  }
}

export async function extractExtratoWithAi(params: {
  ocrText?: string;
  images?: AiExtractImage[];
  statementYear?: string;
  fileName?: string;
  providerId?: string;
  model?: string;
  perPage?: boolean;
  mode?: 'surgical' | 'standard';
  bankHint?: string;
  signal?: AbortSignal;
  /** PDF/planilha original — motor erp.contabil processa nativamente (melhor precisão). */
  fileBase64?: string;
  mimeType?: string;
}): Promise<AiExtractExtratoResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXTRACT_REQUEST_TIMEOUT_MS + 15_000);
    const signal = params.signal ?? controller.signal;
    try {
      const res = await fetch(`${AGENT_BASE}/ai/extract-extrato`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ocrText: params.ocrText,
          images: params.images,
          statementYear: params.statementYear,
          fileName: params.fileName,
          providerId: params.providerId,
          model: params.model,
          perPage: params.perPage === true,
          mode: params.mode,
          bankHint: params.bankHint,
          fileBase64: params.fileBase64,
          mimeType: params.mimeType,
        }),
        signal,
      });
      const data = (await res.json()) as AiExtractExtratoResult;
      if (!res.ok) {
        return {
          ok: false,
          reason: data.reason ?? 'request_failed',
          detail: data.detail ?? `HTTP ${res.status}`,
        };
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const raw = err instanceof Error ? err.message : 'Falha na extração IA';
    const detail = /signal timed out|aborted|timeout/i.test(raw)
      ? 'A IA demorou demais para responder (limite ~3 min). Tente com menos páginas, aumente a resolução do PDF ou verifique a chave API em Contábil → IA.'
      : raw;
    return {
      ok: false,
      reason: 'network_error',
      detail,
    };
  }
}

export async function extractLoanContractWithAi(params: {
  images?: AiExtractImage[];
  fileName?: string;
  providerId?: string;
  model?: string;
  signal?: AbortSignal;
}): Promise<AiExtractLoanContractResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXTRACT_REQUEST_TIMEOUT_MS + 15_000);
    const signal = params.signal ?? controller.signal;
    try {
      const res = await fetch(`${AGENT_BASE}/ai/extract-loan-contract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: params.images,
          fileName: params.fileName,
          providerId: params.providerId,
          model: params.model,
        }),
        signal,
      });
      const data = (await res.json()) as AiExtractLoanContractResult;
      if (!res.ok) {
        return {
          ok: false,
          reason: data.reason ?? 'request_failed',
          detail: data.detail ?? `HTTP ${res.status}`,
        };
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const raw = err instanceof Error ? err.message : 'Falha na extração IA do contrato';
    const detail = /signal timed out|aborted|timeout/i.test(raw)
      ? 'A IA demorou demais para responder. Tente com um arquivo menor ou verifique a chave API.'
      : raw;
    return {
      ok: false,
      reason: 'network_error',
      detail,
    };
  }
}

export async function extractPlanoWithAi(params: {
  ocrText?: string;
  images?: AiExtractImage[];
  fileName?: string;
  providerId?: string;
  model?: string;
  perPage?: boolean;
  signal?: AbortSignal;
  fileBase64?: string;
  mimeType?: string;
}): Promise<AiExtractPlanoResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXTRACT_REQUEST_TIMEOUT_MS + 15_000);
    const signal = params.signal ?? controller.signal;
    try {
      const res = await fetch(`${AGENT_BASE}/ai/extract-plano`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ocrText: params.ocrText,
          images: params.images,
          fileName: params.fileName,
          providerId: params.providerId,
          model: params.model,
          perPage: params.perPage === true,
          fileBase64: params.fileBase64,
          mimeType: params.mimeType,
        }),
        signal,
      });
      const data = (await res.json()) as AiExtractPlanoResult;
      if (!res.ok) {
        return {
          ok: false,
          reason: data.reason ?? 'request_failed',
          detail: data.detail ?? `HTTP ${res.status}`,
        };
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const raw = err instanceof Error ? err.message : 'Falha na extração IA';
    const detail = /signal timed out|aborted|timeout/i.test(raw)
      ? 'A IA demorou demais para responder (limite ~3 min). Tente com menos páginas ou use modo Híbrido.'
      : raw;
    return {
      ok: false,
      reason: 'network_error',
      detail,
    };
  }
}

/** Refino híbrido — corrige linhas OCR via IA. */
export async function refineOcrRowsWithAi(params: {
  lines: GenericOcrRow[];
  ocrText?: string;
  providerId?: string;
  model?: string;
  documentType?: 'extrato' | 'plano';
}): Promise<{ ok: boolean; rows: GenericOcrRow[]; skipped?: boolean; detail?: string }> {
  try {
    const res = await fetch(`${AGENT_BASE}/assist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'ocr_refine',
        payload: {
          lines: params.lines,
          ocrText: params.ocrText,
          providerId: params.providerId,
          model: params.model,
          documentType: params.documentType ?? 'extrato',
        },
      }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      rows?: GenericOcrRow[];
      skipped?: boolean;
      detail?: string;
    };
    if (data.rows?.length) {
      return { ok: true, rows: data.rows };
    }
    return {
      ok: Boolean(data.ok),
      rows: params.lines,
      skipped: data.skipped,
      detail: data.detail,
    };
  } catch {
    return { ok: false, rows: params.lines, detail: 'Refino IA indisponível' };
  }
}

export type AiOcrBlock = {
  text: string;
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
};

export type AiOcrOverlayResult = {
  ok: boolean;
  blocks?: AiOcrBlock[];
  model?: string;
  provider?: string;
  reason?: string;
  detail?: string;
};

export async function extractOcrOverlayWithAi(params: {
  images?: AiExtractImage[];
  fileName?: string;
  providerId?: string;
  model?: string;
  signal?: AbortSignal;
}): Promise<AiOcrOverlayResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXTRACT_REQUEST_TIMEOUT_MS + 15_000);
    const signal = params.signal ?? controller.signal;
    try {
      const res = await fetch(`${AGENT_BASE}/ai/ocr-overlay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: params.images,
          fileName: params.fileName,
          providerId: params.providerId,
          model: params.model,
        }),
        signal,
      });
      const data = (await res.json()) as AiOcrOverlayResult;
      if (!res.ok) {
        return {
          ok: false,
          reason: data.reason ?? 'request_failed',
          detail: data.detail ?? `HTTP ${res.status}`,
        };
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const raw = err instanceof Error ? err.message : 'Falha no OCR IA';
    const detail = /signal timed out|aborted|timeout/i.test(raw)
      ? 'A IA demorou demais para responder. Tente com um arquivo menor ou verifique a chave API.'
      : raw;
    return {
      ok: false,
      reason: 'network_error',
      detail,
    };
  }
}
