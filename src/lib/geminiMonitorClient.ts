/**
 * Cliente browser — diagnóstico Gemini via Vite /api/agent (sem servidor :8790).
 */

const AGENT_BASE =
  typeof import.meta.env.VITE_AGENT_API_URL === 'string' && import.meta.env.VITE_AGENT_API_URL
    ? import.meta.env.VITE_AGENT_API_URL.replace(/\/$/, '')
    : '/api/agent';

export type GeminiIssueSeverity = 'error' | 'warning' | 'info';
export type GeminiTipoCorrecao = 'usuario' | 'codigo' | 'reimportar';

export interface GeminiAuditIssue {
  severity: GeminiIssueSeverity;
  title: string;
  detail: string;
  /** Local exato: linha OCR, página PDF, tela UI ou trecho do código */
  onde?: string;
  /** Arquivo ou módulo onde corrigir (ex.: src/lib/ocrExtratoPositional.ts) */
  moduloOuArquivo?: string;
  /** Instrução clara de correção */
  comoCorrigir?: string;
  /** Passos numerados para resolver */
  passos?: string[];
  /** Quem deve agir: interface, código ou reimportação */
  tipoCorrecao?: GeminiTipoCorrecao;
  /** @deprecated use comoCorrigir */
  suggestion?: string;
}

export interface GeminiAuditResultBase {
  ok: boolean;
  provider?: 'gemini';
  model?: string;
  /** Relatório narrativo completo */
  relatorio?: string;
  summary?: string;
  issues?: GeminiAuditIssue[];
  acoesRecomendadas?: string[];
  diagnosticoTecnico?: string;
  skipped?: boolean;
  reason?: string;
  detail?: string;
}

export interface ExtratoGeminiAuditResult extends GeminiAuditResultBase {
  saldoCoerente?: boolean | null;
  lancamentosEsperados?: number | null;
}

export interface ExtratoGeminiAuditPayload {
  company?: string;
  fileName?: string;
  importSummary: {
    lancamentosCount: number;
    creditosTotal: number;
    debitosTotal: number;
    saldoAnterior?: number;
    saldoFinal?: number;
    skippedCount: number;
    warningsCount: number;
    errorsCount: number;
  };
  skippedLog: Array<{
    line: number;
    category?: string;
    reason: string;
    detail?: string;
    preview?: string;
    severity?: string;
  }>;
  sampleLancamentos?: Array<{
    date: string;
    description: string;
    value: number;
    nature: 'D' | 'C';
  }>;
}

export interface GeminiDebugAuditPayload {
  entries: Array<{
    kind: string;
    message: string;
    at?: string;
    source?: string;
    details?: string;
  }>;
  context?: string;
}

export type GeminiDebugAuditResult = GeminiAuditResultBase;

export async function fetchGeminiHealth(): Promise<{ ok: boolean; configured?: boolean; model?: string }> {
  try {
    const res = await fetch(`${AGENT_BASE}/gemini/health`, { method: 'GET' });
    if (!res.ok) return { ok: false };
    return (await res.json()) as { ok: boolean; configured?: boolean; model?: string };
  } catch {
    return { ok: false };
  }
}

export async function auditExtratoImportWithGemini(
  payload: ExtratoGeminiAuditPayload,
  signal?: AbortSignal,
): Promise<ExtratoGeminiAuditResult> {
  try {
    const res = await fetch(`${AGENT_BASE}/gemini/analyze-extrato-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
    const data = (await res.json()) as ExtratoGeminiAuditResult;
    if (!res.ok) {
      return {
        ok: false,
        detail: data.detail ?? `HTTP ${res.status}`,
        reason: data.reason ?? 'request_failed',
      };
    }
    return data;
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : 'Falha na conexão com Gemini',
      reason: 'network',
    };
  }
}

export async function auditDebugEntriesWithGemini(
  payload: GeminiDebugAuditPayload,
  signal?: AbortSignal,
): Promise<GeminiDebugAuditResult> {
  try {
    const res = await fetch(`${AGENT_BASE}/gemini/analyze-debug`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
    const data = (await res.json()) as GeminiDebugAuditResult;
    if (!res.ok) {
      return {
        ok: false,
        detail: data.detail ?? `HTTP ${res.status}`,
        reason: data.reason ?? 'request_failed',
      };
    }
    return data;
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : 'Falha na conexão com Gemini',
      reason: 'network',
    };
  }
}
