/**
 * Serviço de Sincronização Automática Global
 * DESABILITADO - Mantém dados apenas no localStorage offline
 */

const API_BASE = '/api/agent';

interface SyncData {
  officeToken: string;
  officeData: Record<string, unknown>;
  managers?: unknown[];
}

/**
 * Agendada sincronização com debounce (2s) - DESABILITADA
 */
export function scheduleSync(data: SyncData, delayMs: number = 2000): void {
  // Desabilitado
  return;
}

/**
 * Sincroniza imediatamente (sem debounce) - DESABILITADA
 */
export async function syncNow(data: SyncData): Promise<boolean> {
  // Desabilitado
  return false;
}

/**
 * Restaura último backup de um office - DESABILITADA
 */
export async function restoreLatestBackup(officeToken: string): Promise<SyncData | null> {
  // Desabilitado
  return null;
}

/**
 * Lista todos os backups - DESABILITADA
 */
export async function listAllBackups(): Promise<Array<{ id: string; name: string }>> {
  // Desabilitado
  return [];
}

/**
 * Status da sincronização - DESABILITADA
 */
export async function getSyncStatus(): Promise<{ ok: boolean; storage: string; mode: string }> {
  // Desabilitado
  return { ok: false, storage: 'offline', mode: 'localStorage' };
}

/**
 * Inicializa o serviço - DESABILITADA
 */
export function initAutoSync(): void {
  console.log('[autoSyncService] ✅ Modo offline - sem sincronização');
}
