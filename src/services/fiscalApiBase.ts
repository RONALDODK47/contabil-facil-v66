import { getAgentApiOrigin } from '../lib/agentApiBase';

const RENDER_FISCAL_FALLBACK =
  'https://contabil-erp-nova-versao-v1-0-8.onrender.com/api/fiscal-nfe';

function resolveFiscalApiBase(): string {
  const explicit =
    (typeof import.meta.env.VITE_FISCAL_API_URL === 'string' && import.meta.env.VITE_FISCAL_API_URL) ||
    (typeof import.meta.env.VITE_FISCAL_NFE_URL === 'string' && import.meta.env.VITE_FISCAL_NFE_URL);
  if (explicit) return explicit.trim().replace(/\/$/, '');

  const agentOrigin = getAgentApiOrigin();
  if (agentOrigin) return `${agentOrigin}/api/fiscal-nfe`;

  if (import.meta.env.DEV) return '/api/fiscal-nfe';

  /** GitHub Pages — stubs fiscais no agent-api Render. */
  return RENDER_FISCAL_FALLBACK;
}

/** Base URL da API fiscal (Render ou proxy Vite em dev). */
export const FISCAL_API_BASE: string = resolveFiscalApiBase();

function isBrowserLocalHost(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1';
}

/** Bases HTTP(S) candidatas — evita mixed-content (HTTPS → HTTP localhost bloqueado). */
export function fiscalApiCandidateBases(): string[] {
  const bases: string[] = [];

  if (import.meta.env.DEV || isBrowserLocalHost()) {
    bases.push('/api/fiscal-nfe');
    bases.push('http://127.0.0.1:8780');
    bases.push('http://127.0.0.1:8790/api/fiscal-nfe');
  }

  if (FISCAL_API_BASE) bases.push(FISCAL_API_BASE);

  return [...new Set(bases.map((b) => b.replace(/\/$/, '')))];
}

export type FiscalApiProbe = {
  online: boolean;
  /** Base que responde Distribuição DF-e (não só health stub). */
  nfeBase?: string;
  mode?: 'local' | 'proxy' | 'remote';
  service?: string;
};

async function readFiscalHealthJson(res: Response): Promise<{ ok?: boolean; service?: string } | null> {
  try {
    const text = (await res.text()).trim();
    if (!text || text.startsWith('<')) return null;
    return JSON.parse(text) as { ok?: boolean; service?: string };
  } catch {
    return null;
  }
}

/** Verifica se a base expõe POST /sefaz/nfe/distribuicao (JSON, não stub 404 HTML). */
async function baseSupportsNfeDistribuicao(base: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/sefaz/nfe/distribuicao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const text = (await res.text()).trim();
    if (text.startsWith('<') || text.toLowerCase().startsWith('<!doctype')) return false;
    try {
      const data = JSON.parse(text) as { mensagem?: string };
      return typeof data.mensagem === 'string';
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/** Health + rota NF-e — ignora stub Render que só responde /health. */
export async function probeFiscalNfeApi(): Promise<FiscalApiProbe> {
  for (const base of fiscalApiCandidateBases()) {
    try {
      const res = await fetch(`${base}/health`, { cache: 'no-store' });
      if (!res.ok) continue;
      const health = await readFiscalHealthJson(res);
      if (!health?.ok || health.service === 'fiscal-api-stub') continue;

      const nfeOk = await baseSupportsNfeDistribuicao(base);
      if (!nfeOk) continue;

      let mode: FiscalApiProbe['mode'] = 'remote';
      if (base.startsWith('http://127.0.0.1:8780')) mode = 'local';
      else if (base.startsWith('/') || base.includes('127.0.0.1:8790')) mode = 'proxy';

      return {
        online: true,
        nfeBase: base,
        mode,
        service: health.service,
      };
    } catch {
      // próxima base
    }
  }
  return { online: false };
}

/** Bases com Distribuição DF-e — ordem de tentativa na busca SEFAZ. */
export async function fiscalNfeCandidateBases(): Promise<string[]> {
  const probe = await probeFiscalNfeApi();
  if (probe.nfeBase) return [probe.nfeBase];
  return fiscalApiCandidateBases();
}

/** Verifica se alguma base fiscal responde no endpoint de health. */
export async function pingFiscalHealth(path: string): Promise<boolean> {
  const healthPath = path.startsWith('/') ? path : `/${path}`;
  for (const base of fiscalApiCandidateBases()) {
    try {
      const res = await fetch(`${base}${healthPath}`, { method: 'GET', cache: 'no-store' });
      if (!res.ok) continue;
      const data = (await res.json()) as { ok?: boolean; online?: boolean };
      if (data.online === false || data.ok === false) continue;
      return true;
    } catch {
      // próxima base
    }
  }
  return false;
}
