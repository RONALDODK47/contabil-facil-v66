/**
 * Agente RPA de Sincronização — desabilitado (sem backend remoto).
 */

export interface SyncRpaStatus {
  active: boolean;
  lastSyncAt: string | null;
  dockerConnected: boolean;
  companiesCount: number;
  syncing: boolean;
  lastError: string | null;
}

export const SYNC_RPA_EVENT = 'contabilfacil:sync-rpa-cycle';

export function startSyncRpaAgent(_officeToken: string, _uid: string): void {
  /* sem sincronização remota */
}

export function stopSyncRpaAgent(): void {
  /* sem sincronização remota */
}

export function getSyncRpaStatus(): SyncRpaStatus {
  return {
    active: false,
    lastSyncAt: null,
    dockerConnected: false,
    companiesCount: 0,
    syncing: false,
    lastError: null,
  };
}
