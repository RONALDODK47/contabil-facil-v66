import type { ActiveTab } from '../contabilfacil/types';
import { pingBankingCalendarApi } from './bankingCalendarService';
import { pingBcbApi } from './bcbService';
import { getEmbeddedSerie11Count, hydrateBcbSeriesFromBundledAssets } from './bcbSeriesStorage';
import { pingReceitaFederalApi } from './receitaFederalApi';
import { pingSefazIcmsApi } from './sefazIcmsApi';
import { pingSpedReceitaApi } from './spedReceitaApi';

const PING_TIMEOUT_MS = 2_500;
const REMOTE_PING_TIMEOUT_MS = 15_000;

async function pingWithTimeout(ping: () => Promise<boolean>, timeoutMs = PING_TIMEOUT_MS): Promise<boolean> {
  try {
    return await Promise.race([
      ping(),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } catch {
    return false;
  }
}

/** Render free tier pode demorar na 1ª requisição — tenta de novo uma vez. */
async function pingWithRetry(
  ping: () => Promise<boolean>,
  timeoutMs = PING_TIMEOUT_MS,
  retries = 0,
): Promise<boolean> {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const ok = await pingWithTimeout(ping, timeoutMs);
    if (ok) return true;
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, 2_500));
    }
  }
  return false;
}

export type ApiStatusValue = 'checking' | 'online' | 'offline';

export interface ApiStatusEntry {
  id: string;
  /** Rótulo curto no cabeçalho (ex.: BCB, PDF). */
  label: string;
  /** Porta local, “remoto” ou “API” (Gemini via Vite). */
  port?: string;
  ping: () => Promise<boolean>;
  timeoutMs?: number;
}

/** Todas as integrações HTTP usadas pelo sistema (ordem de exibição no cabeçalho). */
export const API_STATUS_REGISTRY: ApiStatusEntry[] = [
  {
    id: 'bcb',
    label: 'BCB',
    port: 'remoto',
    timeoutMs: 8_000,
    ping: async () => {
      if (await pingBcbApi()) return true;
      /** PRONAMPE / Selic Over: pacote embutido no build permite calcular sem API ao vivo. */
      await hydrateBcbSeriesFromBundledAssets().catch(() => undefined);
      return getEmbeddedSerie11Count() > 0;
    },
  },
  {
    id: 'calendario',
    label: 'Calendário',
    port: 'remoto',
    ping: pingBankingCalendarApi,
  },
  {
    id: 'receita-federal',
    label: 'Receita Federal',
    port: '8780',
    ping: pingReceitaFederalApi,
  },
  {
    id: 'sefaz-icms',
    label: 'SEFAZ ICMS',
    port: '8780',
    ping: pingSefazIcmsApi,
  },
  {
    id: 'sped',
    label: 'SPED',
    port: '8780',
    ping: pingSpedReceitaApi,
  },
];

/** Escopo lógico de APIs — uma aba do launcher pode mapear para o mesmo escopo. */
export type ApiStatusScope = 'manager' | 'none';

/** IDs de API visíveis por escopo (ordem preservada do registry). */
export const API_IDS_BY_SCOPE: Record<Exclude<ApiStatusScope, 'none'>, readonly string[]> = {
  manager: ['bcb', 'calendario', 'receita-federal', 'sped'],
};

export function apiStatusScopeForTab(tab: ActiveTab): ApiStatusScope {
  switch (tab) {
    case 'manager':
      return 'manager';
    case 'admin':
    default:
      return 'none';
  }
}

export function getApiStatusRegistryForTab(
  tab: ActiveTab,
  registry: ApiStatusEntry[] = API_STATUS_REGISTRY,
): ApiStatusEntry[] {
  const scope = apiStatusScopeForTab(tab);
  if (scope === 'none') return [];
  const allowed = new Set<string>(API_IDS_BY_SCOPE[scope]);
  return registry.filter((entry) => allowed.has(entry.id));
}

export type ApiStatusMap = Record<string, ApiStatusValue>;

export async function probeAllApiStatuses(
  registry: ApiStatusEntry[] = API_STATUS_REGISTRY,
): Promise<ApiStatusMap> {
  const results = await Promise.all(
    registry.map(async (entry) => {
      const remote = entry.port === '8780' || entry.port === 'remoto';
      const timeout = entry.timeoutMs ?? (remote && !import.meta.env.DEV ? REMOTE_PING_TIMEOUT_MS : PING_TIMEOUT_MS);
      const retries = remote && !import.meta.env.DEV ? 1 : 0;
      const ok = await pingWithRetry(() => entry.ping(), timeout, retries);
      return [entry.id, ok ? 'online' : 'offline'] as const;
    }),
  );
  return Object.fromEntries(results) as ApiStatusMap;
}

export function initialApiStatusMap(
  registry: ApiStatusEntry[] = API_STATUS_REGISTRY,
): ApiStatusMap {
  return Object.fromEntries(registry.map((e) => [e.id, 'checking'])) as ApiStatusMap;
}
