/**
 * Cliente de assistência — somente Gemini (free tier via Vite /api/agent).
 */

export type AiAssistTask = 'ocr_refine' | 'extract_validate' | 'proactive_hint';

export interface AiAssistOcrRefinePayload {
  lines: string[];
  documentType: string;
  pageHint?: string;
}

export interface AiAssistResponse {
  ok: boolean;
  lines?: string[];
  text?: string;
  detail?: string;
  skipped?: boolean;
  reason?: string;
  provider?: string;
}

const AGENT_BASE =
  typeof import.meta.env.VITE_AGENT_API_URL === 'string' && import.meta.env.VITE_AGENT_API_URL
    ? import.meta.env.VITE_AGENT_API_URL.replace(/\/$/, '')
    : '/api/agent';

let assistOnlineCache: { at: number; online: boolean } | null = null;
const ASSIST_CACHE_MS = 20_000;

export function invalidateAiAssistCache(): void {
  assistOnlineCache = null;
}

export async function isAiAssistOnline(force = false): Promise<boolean> {
  if (!force && assistOnlineCache && Date.now() - assistOnlineCache.at < ASSIST_CACHE_MS) {
    return assistOnlineCache.online;
  }
  try {
    const res = await fetch(`${AGENT_BASE}/gemini/health`, { method: 'GET', cache: 'no-store' });
    if (!res.ok) {
      assistOnlineCache = { at: Date.now(), online: false };
      return false;
    }
    const data = (await res.json()) as { ok?: boolean };
    const online = Boolean(data.ok);
    assistOnlineCache = { at: Date.now(), online };
    return online;
  } catch {
    assistOnlineCache = { at: Date.now(), online: false };
    return false;
  }
}

export async function ensureOcrAiReady(onProgress?: (message: string) => void): Promise<void> {
  onProgress?.('Verificando Gemini…');
  await isAiAssistOnline(true);
}

export async function callAiAssist(
  task: AiAssistTask,
  payload: AiAssistOcrRefinePayload | Record<string, unknown>,
): Promise<AiAssistResponse> {
  if (task === 'ocr_refine') {
    return {
      ok: true,
      skipped: true,
      reason: 'ocr_refine_disabled',
      lines: Array.isArray((payload as AiAssistOcrRefinePayload).lines)
        ? (payload as AiAssistOcrRefinePayload).lines
        : [],
    };
  }

  try {
    const res = await fetch(`${AGENT_BASE}/assist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, payload }),
    });
    const data = (await res.json()) as AiAssistResponse;
    if (!res.ok) {
      return {
        ok: false,
        skipped: true,
        reason: data.reason ?? 'assist_failed',
        detail: data.detail ?? `HTTP ${res.status}`,
      };
    }
    return data;
  } catch (err) {
    return {
      ok: false,
      skipped: true,
      reason: 'network',
      detail: err instanceof Error ? err.message : 'Gemini offline',
    };
  }
}

export async function callOcrRefineAssist(
  payload: AiAssistOcrRefinePayload,
): Promise<AiAssistResponse> {
  return {
    ok: true,
    skipped: true,
    reason: 'ocr_refine_disabled',
    lines: payload.lines,
  };
}
