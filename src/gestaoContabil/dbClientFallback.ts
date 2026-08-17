/**
 * Fallback local — só usado se Postgres/Docker estiver desligado.
 * Com VITE_STORAGE_BACKEND=postgres o dbClient NÃO grava workspace aqui no navegador.
 */
import {
  listMemoryFallbackEntries,
  safeLocalStorageGetItem,
  safeLocalStorageRemoveItem,
  safeLocalStorageSetItem,
} from '../lib/safeLocalStorage';

type GenericRecord = Record<string, unknown>;

const CLOUD_ACCESS_CONFIG_KEY = 'gc_cloud_access_config';
const USER_PROFILES_KEY = 'gc_cloud_user_profiles';
const WORKSPACE_OFFICE_PREFIX = 'gc_cloud_workspace_office_';
const WORKSPACE_MANAGER_PREFIX = 'gc_cloud_workspace_manager_';

function safeRead<T>(key: string, fallback: T): T {
  try {
    const raw = safeLocalStorageGetItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWrite(key: string, value: unknown): void {
  // ⚠️ DISABLED: Workspace keys são operacionais - Salva SOMENTE no Docker
  // safeLocalStorageSetItem(key, JSON.stringify(value));
}

function nowIso(): string {
  return new Date().toISOString();
}

function officeKey(token: string): string {
  return `${WORKSPACE_OFFICE_PREFIX}${token}`;
}

function managerKey(token: string, slug: string): string {
  return `${WORKSPACE_MANAGER_PREFIX}${token}::${slug}`;
}

function nextToken(prefix: string): string {
  const left = Math.random().toString(36).slice(2, 6).toUpperCase();
  const right = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${String(prefix || 'TOK').toUpperCase()}-${left}-${right}`;
}

async function getConfig(): Promise<GenericRecord> {
  return safeRead<GenericRecord>(CLOUD_ACCESS_CONFIG_KEY, {});
}

async function updateConfig({
  adminUid,
  patch,
}: {
  adminUid: string;
  patch: GenericRecord;
}): Promise<GenericRecord> {
  const current = await getConfig();
  const next: GenericRecord = {
    ...current,
    ...patch,
    updated_at: nowIso(),
    updated_by: String(adminUid || '').trim(),
  };
  safeWrite(CLOUD_ACCESS_CONFIG_KEY, next);
  return next;
}

async function upsertClient({
  adminUid,
  email,
  patch,
}: {
  adminUid: string;
  email: string;
  patch: GenericRecord;
}): Promise<GenericRecord> {
  const key = String(email || '').trim().toLowerCase();
  if (!key) return {};

  const current = await getConfig();
  const clients =
    current.clients && typeof current.clients === 'object'
      ? ({ ...(current.clients as GenericRecord) } as GenericRecord)
      : {};
  const row =
    clients[key] && typeof clients[key] === 'object'
      ? ({ ...(clients[key] as GenericRecord) } as GenericRecord)
      : {};

  clients[key] = {
    ...row,
    ...patch,
    email: key,
    updated_at: nowIso(),
    updated_by: String(adminUid || '').trim(),
  };

  return updateConfig({ adminUid, patch: { clients } });
}

async function setOffice(
  officeToken: string,
  payload: GenericRecord,
  uid: string,
): Promise<{ updated_at: string }> {
  const token = String(officeToken || '').trim();
  const updated_at = nowIso();
  if (!token) return { updated_at };

  const row = {
    ...payload,
    office_token: token,
    updated_at,
    updated_by: String(uid || '').trim(),
  };
  safeWrite(officeKey(token), row);
  return { updated_at };
}

async function getOffice(officeToken: string): Promise<GenericRecord | null> {
  const token = String(officeToken || '').trim();
  if (!token) return null;
  return safeRead<GenericRecord | null>(officeKey(token), null);
}

async function setManager(
  officeToken: string,
  companySlug: string,
  payload: GenericRecord,
  uid: string,
): Promise<{ updated_at: string }> {
  const token = String(officeToken || '').trim();
  const slug = String(companySlug || '').trim();
  const updated_at = nowIso();
  if (!token || !slug) return { updated_at };

  const row = {
    ...payload,
    office_token: token,
    company_slug: slug,
    updated_at,
    updated_by: String(uid || '').trim(),
  };
  safeWrite(managerKey(token, slug), row);
  return { updated_at };
}

async function listManagerByOffice(officeToken: string): Promise<GenericRecord[]> {
  const token = String(officeToken || '').trim();
  if (!token) return [];

  const prefix = `${WORKSPACE_MANAGER_PREFIX}${token}::`;
  const keys = new Set<string>();
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) keys.add(key);
    }
  } catch {
    /* ignore */
  }
  for (const [key] of listMemoryFallbackEntries()) {
    if (key.startsWith(prefix)) keys.add(key);
  }

  const rows: GenericRecord[] = [];
  for (const key of keys) {
    const row = safeRead<GenericRecord | null>(key, null);
    if (row) rows.push(row);
  }
  rows.sort((a, b) => String(a.company_slug || '').localeCompare(String(b.company_slug || ''), 'pt-BR'));
  return rows;
}

async function deleteManager(
  officeToken: string,
  companySlug: string,
  _uid: string,
): Promise<{ updated_at: string }> {
  const token = String(officeToken || '').trim();
  const slug = String(companySlug || '').trim();
  const updated_at = nowIso();
  if (!token || !slug) return { updated_at };
  safeLocalStorageRemoveItem(managerKey(token, slug));
  return { updated_at };
}

async function listAllProfiles(): Promise<GenericRecord[]> {
  const rows = safeRead<unknown[]>(USER_PROFILES_KEY, []);
  return Array.isArray(rows)
    ? rows.filter((row) => row && typeof row === 'object').map((row) => row as GenericRecord)
    : [];
}

export const dbClient = {
  entities: {
    EyeVisionWorkspace: {
      setOffice,
      getOffice,
      setManager,
      listManagerByOffice,
      deleteManager,
    },
    UserProfile: {
      listAll: listAllProfiles,
    },
    CloudAccessControl: {
      getConfig,
      updateConfig,
      upsertClient,
      generateToken: nextToken,
    },
  },
};
