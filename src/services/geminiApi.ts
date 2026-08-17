/**
 * Ping da API Gemini (via Vite /api/agent/gemini ou Render em produção).
 */
import { getAgentApiBase } from '../lib/agentApiBase';

export interface GeminiApiHealth {
  ok: boolean;
  configured?: boolean;
  provider?: string;
  model?: string;
  detail?: string;
}

export async function fetchGeminiApiHealth(deep = false): Promise<GeminiApiHealth> {
  try {
    const qs = deep ? '?deep=1' : '';
    const res = await fetch(`${getAgentApiBase()}/gemini/health${qs}`, { method: 'GET', cache: 'no-store' });
    if (!res.ok) return { ok: false, configured: false };
    return (await res.json()) as GeminiApiHealth;
  } catch {
    return { ok: false, configured: false };
  }
}

/** Ping Gemini — status bar usa só /gemini/health (free tier). */
export async function pingGeminiApi(): Promise<boolean> {
  const health = await fetchGeminiApiHealth();
  return Boolean(health.ok && health.configured !== false);
}

export function geminiStatusTitle(health: GeminiApiHealth, online: boolean): string {
  if (online) {
    const model = health.model ? ` (${health.model})` : '';
    return health.detail ?? `Gemini AI free tier online${model}`;
  }
  if (health.detail) return health.detail;
  if (health.configured === false) {
    return 'Modo Offline: Recursos de IA desativados.';
  }
  return 'Modo Offline';
}
