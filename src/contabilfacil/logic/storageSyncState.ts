/**
 * Stub para o estado de sincronização legado.
 */

export type StorageBusyState = 'docker' | 'pasta' | 'stop' | 'reset' | null;

const state = { busy: null, progressLog: [], erro: null, needsInstall: false };

export function getStorageSyncState() {
  return state;
}

export function subscribeStorageSyncState(fn: () => void) {
  return () => {};
}

export function isStorageSyncBusy() {
  return false;
}

export async function iniciarSincronizacaoStorage() {}
export async function conectarDockerInterno() {}
export async function pararEmbeddedStorage() {}
export async function removerConfiguracaoStorage() {}
export function clearStorageSyncError() {}
export async function ensureDockerAutoConnect() {}
