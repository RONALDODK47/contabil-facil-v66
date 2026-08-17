/**
 * true em dev do Vite E no app desktop instalado (Setup Interface) — ambos servem
 * a página em localhost/127.0.0.1. O server.js do instalador faz proxy de
 * /api/agent/* para a agent-api local (127.0.0.1:8790), então o mesmo caminho
 * relativo funciona nos dois casos.
 */
export function isLocalhostRuntime(): boolean {
  if (import.meta.env.DEV) return true;
  if (typeof window === 'undefined') return false;
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

/** Base URL da Agent API (Render quando hospedado na web, proxy local em dev/app desktop). */
export function getAgentApiBase(): string {
  const raw = import.meta.env.VITE_AGENT_API_URL;
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim().replace(/\/$/, '');
  }
  if (isLocalhostRuntime()) return '/api/agent';
  /** Fallback quando o build não embutiu VITE_AGENT_API_URL (GitHub Pages). */
  return 'https://contabil-erp-nova-versao-v1-0-8.onrender.com/api/agent';
}

/** Origem do serviço backend (ex.: https://eye-vision-agent-api.onrender.com). */
export function getAgentApiOrigin(): string | null {
  const base = getAgentApiBase();
  if (base.startsWith('http://') || base.startsWith('https://')) {
    try {
      return new URL(base).origin;
    } catch {
      return null;
    }
  }
  return null;
}
