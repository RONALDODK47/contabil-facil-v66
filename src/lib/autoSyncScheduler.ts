/**
 * Agendador de Salvamento Automático
 *
 * Responsabilidades:
 * 1. Salvar dados a cada 1 minuto (se houver empresa selecionada)
 *
 * NÃO faz hidratação inicial — isso é responsabilidade do EyeVisionCloudBootstrap.
 * NÃO sobrescreve dados em memória com dados do servidor durante uma sessão ativa.
 */

let saveTimer: ReturnType<typeof setInterval> | null = null;

const SAVE_INTERVAL_MS = 60 * 1000; // 1 minuto

interface SyncData {
  officeToken: string;
  officeData: Record<string, unknown>;
  managers?: unknown[];
}

/**
 * Coleta dados do localStorage para salvar
 */
async function collectOfficeData(): Promise<SyncData | null> {
  try {
    const officeToken = String(localStorage.getItem('gc_company_access_token') || '').trim();
    if (!officeToken) {
      return null;
    }

    // Importar dinamicamente para evitar circular dependencies
    const { collectLocalOfficePayload, collectLocalManagerPayload, listLocalManagerSlugs }
      = await import('../contabilfacil/logic/eyeVisionCloudSync');

    const office = collectLocalOfficePayload();
    const slugs = listLocalManagerSlugs();
    const managers = slugs.map((slug: string) => collectLocalManagerPayload(slug));

    return {
      officeToken,
      officeData: office,
      managers,
    };
  } catch (err) {
    console.warn('[autoSyncScheduler] Erro ao coletar dados:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Registra tentativa de sincronização
 */
function saveLastSyncAttempt(officeToken: string, status: 'success' | 'failed-server' | 'failed-response'): void {
  try {
    const key = `sync_last_${officeToken}`;
    localStorage.setItem(key, JSON.stringify({
      status,
      timestamp: new Date().toISOString(),
    }));
  } catch {
    // ignore
  }
}

/**
 * Salva dados no servidor (1 minuto)
 */
async function performSave(): Promise<void> {
  try {
    // Bloqueia salvamento antes da hidratação — evita salvar dados vazios
    const { isHydrationComplete } = await import('../contabilfacil/logic/eyeVisionOperationalSave');
    if (!isHydrationComplete()) {
      return;
    }

    const data = await collectOfficeData();
    if (!data) return;

    const res = await fetch('/api/agent/sync/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      saveLastSyncAttempt(data.officeToken, 'failed-server');
      return;
    }

    const result = await res.json();
    if (result.ok) {
      saveLastSyncAttempt(data.officeToken, 'success');
    } else {
      saveLastSyncAttempt(data.officeToken, 'failed-response');
    }
  } catch (err) {
    console.warn('[autoSyncScheduler] Erro durante salvamento:', err instanceof Error ? err.message : err);
  }
}

/**
 * Inicia o agendador de salvamento automático
 */
export function startAutoSync(): void {
  if (typeof window === 'undefined') {
    return;
  }

  // Timer de salvamento (1 minuto)
  if (!saveTimer) {
    console.log(
      `[autoSyncScheduler] Iniciando sincronização automática (salvamento a cada ${SAVE_INTERVAL_MS / 1000}s)`,
    );
    saveTimer = setInterval(() => {
      void performSave();
    }, SAVE_INTERVAL_MS);
  }
}

/**
 * Para o agendador de salvamento automático
 */
export function stopAutoSync(): void {
  if (saveTimer) {
    clearInterval(saveTimer);
    saveTimer = null;
  }
}

/**
 * Força um salvamento imediato
 */
export async function saveNow(): Promise<void> {
  await performSave();
}

/** @deprecated use saveNow */
export async function syncNow(): Promise<void> {
  await performSave();
}
