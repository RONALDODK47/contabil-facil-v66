/**
 * Sincroniza o catálogo de empresas/tokens do Setup Controle → Interface.
 * O Admin grava em localStorage; a Interface precisa do mesmo catálogo para validar login.
 */
import {
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
} from '../lib/safeLocalStorage';
import { CLOUD_ACCESS_CONFIG_KEY } from './localAuthStore';

type GenericRecord = Record<string, unknown>;

/** Setup Controle (admin-server.js) — só existe se o app desktop estiver a correr. */
const CONTROLE_CATALOG_URL = 'http://127.0.0.1:4900/api/empresas-catalogo';
const FEED_CATALOG_URL = 'http://127.0.0.1:4901/empresas-catalogo';
/**
 * Ponte via agent-api — mesmo processo (:8790) para qualquer origem local
 * nesta máquina (ex.: `npm run dev` :3000 e `npm run preview` :4173 ao
 * mesmo tempo, cada um com seu próprio localStorage). Não depende do Setup
 * Controle estar a correr.
 */
const AGENT_API_CATALOG_URL = '/api/agent/empresas-catalogo';
const AGENT_API_STAFF_LOGIN_URL = '/api/agent/staff-login';

function asRecord(value: unknown): GenericRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as GenericRecord)
    : {};
}

function tokenListFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((x) => String(x || '').trim()).filter(Boolean);
}

/** Extrai catálogo partilhável: empresas + equipa (quem entrou com o token). */
export function buildEmpresasCatalogoPayload(config: GenericRecord): GenericRecord {
  const offices = asRecord(config.eye_vision_offices);
  const tokens = new Set<string>(tokenListFrom(config.company_access_tokens));
  const legacy = String(config.company_access_token || '').trim();
  if (legacy) tokens.add(legacy);

  const slimOffices: GenericRecord = {};
  for (const [key, row] of Object.entries(offices)) {
    const storageKey = String(key || '').trim();
    if (!storageKey) continue;
    const rec = asRecord(row);
    const access = String(rec.access_token || '').trim();
    const sk = String(rec.storage_key || storageKey).trim();
    if (access) tokens.add(access);
    if (sk) tokens.add(sk);
    slimOffices[storageKey] = {
      name: String(rec.name || storageKey).trim(),
      storage_key: sk,
      access_token: access || sk,
      module_access: rec.module_access,
      gestao_tab_access: rec.gestao_tab_access,
      manager_tab_access: rec.manager_tab_access,
      pricing_tab_access: rec.pricing_tab_access,
      created_at: rec.created_at,
    };
  }

  const slimClients: GenericRecord = {};
  const clients = asRecord(config.clients);
  for (const [key, row] of Object.entries(clients)) {
    const email = String(key || '').trim().toLowerCase();
    if (!email || !email.includes('@')) continue;
    const rec = asRecord(row);
    if (String(rec.account_type || 'user').toLowerCase() === 'client') continue;
    const assigned = String(rec.assigned_company_token || '').trim();
    if (!assigned) continue;
    slimClients[email] = {
      email,
      account_type: 'user',
      assigned_company_token: assigned,
      display_name: String(rec.display_name || email.split('@')[0]).trim(),
      is_active: rec.is_active !== false,
      last_login_at: rec.last_login_at || null,
      tab_access: rec.tab_access,
      manager_tab_access: rec.manager_tab_access,
      pricing_tab_access: rec.pricing_tab_access,
      eye_vision_module_access: rec.eye_vision_module_access,
    };
  }

  return {
    updated_at: new Date().toISOString(),
    company_access_tokens: Array.from(tokens),
    eye_vision_offices: slimOffices,
    clients: slimClients,
  };
}

/** Publica o catálogo no Setup Controle (disco + feed) e no agent-api. Só funciona nesta máquina. */
export function publishEmpresasCatalogo(config: GenericRecord): void {
  if (typeof window === 'undefined') return;
  const payload = buildEmpresasCatalogoPayload(config);
  for (const url of [CONTROLE_CATALOG_URL, AGENT_API_CATALOG_URL]) {
    try {
      void fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {
        /* servidor pode estar parado */
      });
    } catch {
      /* ignore */
    }
  }
}

function mergeCatalogIntoLocal(remote: GenericRecord): void {
  let current: GenericRecord = {};
  try {
    const raw = safeLocalStorageGetItem(CLOUD_ACCESS_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') current = parsed as GenericRecord;
    }
  } catch {
    current = {};
  }

  const offices = {
    ...asRecord(current.eye_vision_offices),
    ...asRecord(remote.eye_vision_offices),
  };
  const tokens = new Set<string>([
    ...tokenListFrom(current.company_access_tokens),
    ...tokenListFrom(remote.company_access_tokens),
  ]);
  const legacyRemote = String(remote.company_access_token || '').trim();
  const legacyLocal = String(current.company_access_token || '').trim();
  if (legacyRemote) tokens.add(legacyRemote);
  if (legacyLocal) tokens.add(legacyLocal);

  for (const row of Object.values(offices)) {
    const rec = asRecord(row);
    const access = String(rec.access_token || '').trim();
    const sk = String(rec.storage_key || '').trim();
    if (access) tokens.add(access);
    if (sk) tokens.add(sk);
  }

  const next: GenericRecord = {
    ...current,
    eye_vision_offices: offices,
    company_access_tokens: Array.from(tokens),
    catalog_synced_at: new Date().toISOString(),
  };
  if (legacyRemote && !legacyLocal) next.company_access_token = legacyRemote;

  // Equipa que entrou com o token (Interface → Controle).
  const remoteClients = asRecord(remote.clients);
  if (Object.keys(remoteClients).length > 0) {
    const localClients = asRecord(current.clients);
    const mergedClients: GenericRecord = { ...localClients };
    for (const [email, row] of Object.entries(remoteClients)) {
      const key = String(email || '').trim().toLowerCase();
      if (!key) continue;
      const remoteRec = asRecord(row);
      const localRec = asRecord(localClients[key]);
      mergedClients[key] = {
        ...localRec,
        ...remoteRec,
        email: key,
        // Mantém overrides locais de permissões se já existirem.
        tab_access: localRec.tab_access ?? remoteRec.tab_access,
        manager_tab_access: localRec.manager_tab_access ?? remoteRec.manager_tab_access,
        pricing_tab_access: localRec.pricing_tab_access ?? remoteRec.pricing_tab_access,
        eye_vision_module_access:
          localRec.eye_vision_module_access ?? remoteRec.eye_vision_module_access,
      };
    }
    next.clients = mergedClients;
  }

  safeLocalStorageSetItem(CLOUD_ACCESS_CONFIG_KEY, JSON.stringify(next));
  try {
    window.dispatchEvent(new Event('gc-cloud-access-config-changed'));
  } catch {
    /* ignore */
  }
}

function catalogLooksValid(data: unknown): data is GenericRecord {
  if (!data || typeof data !== 'object') return false;
  const rec = data as GenericRecord;
  const hasOffices =
    rec.eye_vision_offices &&
    typeof rec.eye_vision_offices === 'object' &&
    Object.keys(rec.eye_vision_offices as object).length > 0;
  const hasTokens = tokenListFrom(rec.company_access_tokens).length > 0;
  const hasClients =
    rec.clients && typeof rec.clients === 'object' && Object.keys(rec.clients as object).length > 0;
  return Boolean(hasOffices || hasTokens || hasClients);
}

/**
 * Reporta login de equipa ao Setup Controle (lista "Selecionar pessoas").
 */
export function reportStaffLoginToControle(params: {
  email: string;
  displayName: string;
  accessToken: string;
}): void {
  if (typeof window === 'undefined') return;
  const body = JSON.stringify({
    email: String(params.email || '').trim().toLowerCase(),
    displayName: String(params.displayName || '').trim(),
    accessToken: String(params.accessToken || '').trim(),
  });
  const urls = ['/api/staff-login', 'http://127.0.0.1:4900/api/staff-login', AGENT_API_STAFF_LOGIN_URL];
  for (const url of urls) {
    try {
      void fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }).catch(() => {
        /* tenta o próximo */
      });
    } catch {
      /* ignore */
    }
  }
}

/** Evita martelar portas locais (4900/4901) que não respondem — silencia ruído no console. */
const CATALOG_URL_COOLDOWN_MS = 60_000;
const catalogUrlFailedAt = new Map<string, number>();

async function fetchCatalog(url: string): Promise<GenericRecord | null> {
  const failedAt = catalogUrlFailedAt.get(url);
  if (failedAt && Date.now() - failedAt < CATALOG_URL_COOLDOWN_MS) return null;
  try {
    const ctrl = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
      ? { signal: AbortSignal.timeout(4000) }
      : {};
    const r = await fetch(url, { method: 'GET', ...ctrl });
    if (!r.ok) {
      catalogUrlFailedAt.set(url, Date.now());
      return null;
    }
    const data = await r.json();
    catalogUrlFailedAt.delete(url);
    return catalogLooksValid(data) ? (data as GenericRecord) : null;
  } catch {
    catalogUrlFailedAt.set(url, Date.now());
    return null;
  }
}

function collectCatalogUrls(): string[] {
  // Mesma origem primeiro (server.js da Interface já lê o arquivo local),
  // depois o Setup Controle (4900/4901, se estiver a correr) e por fim o
  // agent-api local — ponte entre origens diferentes nesta máquina (ex.:
  // dev :3000 + preview :4173 ao mesmo tempo).
  return ['/api/empresas-catalogo', CONTROLE_CATALOG_URL, FEED_CATALOG_URL, AGENT_API_CATALOG_URL];
}

/**
 * Puxa o catálogo do Setup Controle / feed e funde no localStorage.
 * Deve correr antes de validar o token no login da Interface.
 * Preferência: o catálogo com mais equipa (clients) — evita ficar preso num espelho velho.
 */
export async function hydrateCompanyCatalogFromRemote(): Promise<boolean> {
  let best: GenericRecord | null = null;
  let bestScore = -1;
  for (const url of collectCatalogUrls()) {
    const data = await fetchCatalog(url);
    if (!data) continue;
    const clientCount = Object.keys(asRecord(data.clients)).length;
    const officeCount = Object.keys(asRecord(data.eye_vision_offices)).length;
    const score = clientCount * 1000 + officeCount;
    if (score > bestScore) {
      best = data;
      bestScore = score;
    }
  }
  if (!best) return false;
  mergeCatalogIntoLocal(best);
  return true;
}
