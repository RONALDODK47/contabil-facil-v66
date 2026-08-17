/**
 * Cliente HTTP do workspace (PostgreSQL + MinIO via agent-api).
 */
import {
  isRemoteWorkspaceStorageEnabled,
  resolveStorageBackendMode,
  type StorageBackendMode,
} from '../lib/storageBackend';

const AGENT_API_BASE =
  typeof import.meta.env.VITE_AGENT_API_URL === 'string' && import.meta.env.VITE_AGENT_API_URL
    ? import.meta.env.VITE_AGENT_API_URL.replace(/\/$/, '')
    : '/api/agent';

export function getStorageBackendMode(): StorageBackendMode {
  return resolveStorageBackendMode();
}

export function isPostgresStorageClientEnabled(): boolean {
  return isRemoteWorkspaceStorageEnabled();
}

type GenericRecord = Record<string, unknown>;

export async function workspaceFetch(
  path: string,
  opts: {
    method?: string;
    officeToken: string;
    uid?: string;
    body?: unknown;
    /** Timeout em ms — padrão 5 min para suportar grandes volumes de importação. */
    timeoutMs?: number;
  },
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Office-Token': opts.officeToken,
  };
  if (opts.uid) headers['X-User-Id'] = opts.uid;
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000; // 5 min default
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${AGENT_API_BASE}${path}`, {
      method: opts.method || 'GET',
      headers,
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

let healthCache: { at: number; ok: boolean } | null = null;

/** Invalida cache do health (após subir Docker / agent-api). */
export function resetWorkspaceHealthCache(): void {
  healthCache = null;
}

export async function probeWorkspaceStorageHealth(): Promise<boolean> {
  const now = Date.now();
  if (healthCache && now - healthCache.at < 8_000) return healthCache.ok;
  try {
    const res = await fetch(`${AGENT_API_BASE}/workspace/health`, { method: 'GET' });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean };
    const ok = res.ok && json.ok === true;
    healthCache = { at: now, ok };
    return ok;
  } catch {
    // Quando falhar (backend offline), mantem cache por 10s para evitar tempestade de requisiçoes no console
    healthCache = { at: now, ok: false };
    return false;
  }
}

/** Aguarda Postgres/MinIO via agent-api (ex.: logo após npm run dev). */
export async function waitForWorkspaceStorageHealth(
  timeoutMs = 15_000,
  intervalMs = 3_000,
): Promise<boolean> {
  if (!isPostgresStorageClientEnabled()) return false;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await probeWorkspaceStorageHealth()) return true;
    resetWorkspaceHealthCache();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }
  return false;
}

async function setOffice(
  officeToken: string,
  payload: GenericRecord,
  uid: string,
): Promise<{ updated_at: string }> {
  const token = String(officeToken || '').trim();
  if (!token) return { updated_at: new Date().toISOString() };
  const res = await workspaceFetch('/workspace/office', {
    method: 'PUT',
    officeToken: token,
    uid,
    body: { payload, uid },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(String((err as { error?: string }).error || `HTTP ${res.status}`));
  }
  const json = (await res.json()) as { updated_at?: string };
  return { updated_at: json.updated_at || new Date().toISOString() };
}

async function getOffice(officeToken: string): Promise<GenericRecord | null> {
  const token = String(officeToken || '').trim();
  if (!token) return null;
  const res = await workspaceFetch('/workspace/office', {
    method: 'GET',
    officeToken: token,
  });
  if (!res.ok) {
    if (res.status === 503) return null;
    const err = await res.json().catch(() => ({}));
    throw new Error(String((err as { error?: string }).error || `HTTP ${res.status}`));
  }
  const json = (await res.json()) as { office?: GenericRecord | null };
  return json.office ?? null;
}

async function setManager(
  officeToken: string,
  companySlug: string,
  payload: GenericRecord,
  uid: string,
): Promise<{ updated_at: string }> {
  const token = String(officeToken || '').trim();
  const slug = String(companySlug || '').trim();
  if (!token || !slug) return { updated_at: new Date().toISOString() };
  const res = await workspaceFetch(`/workspace/manager/${encodeURIComponent(slug)}`, {
    method: 'PUT',
    officeToken: token,
    uid,
    body: { payload, uid },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(String((err as { error?: string }).error || `HTTP ${res.status}`));
  }
  const json = (await res.json()) as { updated_at?: string };
  return { updated_at: json.updated_at || new Date().toISOString() };
}

async function listManagerByOffice(officeToken: string): Promise<GenericRecord[]> {
  const token = String(officeToken || '').trim();
  if (!token) return [];
  const res = await workspaceFetch('/workspace/manager', {
    method: 'GET',
    officeToken: token,
  });
  if (!res.ok) {
    if (res.status === 503) return [];
    const err = await res.json().catch(() => ({}));
    throw new Error(String((err as { error?: string }).error || `HTTP ${res.status}`));
  }
  const json = (await res.json()) as { managers?: GenericRecord[] };
  return Array.isArray(json.managers) ? json.managers : [];
}

async function deleteManager(
  officeToken: string,
  companySlug: string,
  uid: string,
): Promise<{ updated_at: string }> {
  const token = String(officeToken || '').trim();
  const slug = String(companySlug || '').trim();
  if (!token || !slug) return { updated_at: new Date().toISOString() };
  const res = await workspaceFetch(`/workspace/manager/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
    officeToken: token,
    uid,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(String((err as { error?: string }).error || `HTTP ${res.status}`));
  }
  const json = (await res.json()) as { updated_at?: string };
  return { updated_at: json.updated_at || new Date().toISOString() };
}

export const postgresEyeVisionWorkspace = {
  setOffice,
  getOffice,
  setManager,
  listManagerByOffice,
  deleteManager,
};

export type ExtratoPastaApiItem = {
  id: string;
  contaBanco: string;
  bancoNome: string;
  label: string;
  createdAt: string;
  saldoAnterior: number;
  total: number;
  conciliadas: number;
  pendentes: number;
  rows: unknown[];
  pdfObjectKey?: string;
  pdfFilename?: string;
  pdfBase64?: string;
};

export async function apiListExtratoPastas(
  officeToken: string,
  companySlug: string,
): Promise<ExtratoPastaApiItem[]> {
  const res = await workspaceFetch(
    `/workspace/extrato-pastas?companySlug=${encodeURIComponent(companySlug)}`,
    { method: 'GET', officeToken },
  );
  if (!res.ok) throw new Error(`list pastas HTTP ${res.status}`);
  const json = (await res.json()) as { items?: ExtratoPastaApiItem[] };
  return Array.isArray(json.items) ? json.items : [];
}

export async function apiSaveExtratoPasta(
  officeToken: string,
  companySlug: string,
  input: Record<string, unknown>,
): Promise<ExtratoPastaApiItem> {
  const res = await workspaceFetch('/workspace/extrato-pastas', {
    method: 'POST',
    officeToken,
    body: { ...input, companySlug },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(String((err as { error?: string }).error || `HTTP ${res.status}`));
  }
  const json = (await res.json()) as { item: ExtratoPastaApiItem };
  return json.item;
}

export async function apiRemoveExtratoPasta(officeToken: string, id: string): Promise<boolean> {
  const res = await workspaceFetch(`/workspace/extrato-pastas/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    officeToken,
  });
  if (!res.ok) return false;
  const json = (await res.json()) as { removed?: boolean };
  return Boolean(json.removed);
}

export async function apiDownloadExtratoPastaPdf(
  officeToken: string,
  id: string,
  filename?: string,
): Promise<void> {
  const res = await workspaceFetch(`/workspace/extrato-pastas/${encodeURIComponent(id)}/pdf`, {
    method: 'GET',
    officeToken,
  });
  if (!res.ok) throw new Error('PDF não encontrado no servidor');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `extrato_${id.slice(0, 8)}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function apiMigrateFromLocal(
  officeToken: string,
  body: {
    uid?: string;
    office?: GenericRecord;
    managers?: GenericRecord[];
    extratoPastas?: Array<Record<string, unknown>>;
  },
): Promise<void> {
  const res = await workspaceFetch('/workspace/migrate-from-local', {
    method: 'POST',
    officeToken,
    uid: body.uid,
    body,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(String((err as { error?: string }).error || `HTTP ${res.status}`));
  }
}

/** Dev local: migra dados do Firestore legado para o Docker. */
export async function apiMigrateFromFirebase(
  officeToken: string,
  opts?: { force?: boolean },
): Promise<{ ok?: boolean; migrated?: number; skipped?: boolean; reason?: string }> {
  const res = await workspaceFetch('/workspace/migrate-from-firebase', {
    method: 'POST',
    officeToken,
    body: { force: Boolean(opts?.force) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(String((err as { error?: string }).error || `HTTP ${res.status}`));
  }
  return (await res.json()) as {
    ok?: boolean;
    migrated?: number;
    skipped?: boolean;
    reason?: string;
  };
}

/** Copia sufixos gerenciais ausentes entre tokens alias (INOV ↔ CL-FN14). */
export async function apiMergeOfficeManagerSuffixes(
  fromToken: string,
  toToken: string,
  uid?: string,
): Promise<{ ok?: boolean; copiedSuffixes?: number; skipped?: boolean }> {
  try {
    const res = await fetch(`${AGENT_API_BASE}/workspace/merge-office-suffixes`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Office-Token': toToken,
        ...(uid ? { 'X-User-Id': uid } : {}),
      },
      body: JSON.stringify({ fromToken, toToken, uid }),
    });
    if (!res.ok) {
      if (res.status === 404) {
        return { ok: true, skipped: true, copiedSuffixes: 0 };
      }
      const err = await res.json().catch(() => ({}));
      throw new Error(String((err as { error?: string }).error || `HTTP ${res.status}`));
    }
    return (await res.json()) as { ok?: boolean; copiedSuffixes?: number; skipped?: boolean };
  } catch {
    return { ok: true, skipped: true, copiedSuffixes: 0 };
  }
}

/** Copia dados de um token para outro (ex.: legado → INOV) se destino vazio. */
export async function apiCloneOfficeWorkspace(
  fromToken: string,
  toToken: string,
  uid?: string,
): Promise<{ ok?: boolean; skipped?: boolean; copiedManagers?: number; copiedPastas?: number }> {
  try {
    const res = await fetch(`${AGENT_API_BASE}/workspace/clone-office`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Office-Token': toToken,
        ...(uid ? { 'X-User-Id': uid } : {}),
      },
      body: JSON.stringify({ fromToken, toToken, uid }),
    });
    if (!res.ok) {
      if (res.status === 404) {
        return { ok: true, skipped: true, copiedManagers: 0, copiedPastas: 0 };
      }
      const err = await res.json().catch(() => ({}));
      throw new Error(String((err as { error?: string }).error || `HTTP ${res.status}`));
    }
    return (await res.json()) as {
      ok?: boolean;
      skipped?: boolean;
      copiedManagers?: number;
      copiedPastas?: number;
    };
  } catch {
    return { ok: true, skipped: true, copiedManagers: 0, copiedPastas: 0 };
  }
}
