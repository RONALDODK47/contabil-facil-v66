/** Persistência interna: Pastas .data/internal-data/ + .data/internal-backups/ */
export type StorageBackendMode = 'internal';

export function resolveStorageBackendMode(): StorageBackendMode {
  return 'internal';
}

export function storageBackendLabel(mode: StorageBackendMode = resolveStorageBackendMode()): string {
  return 'Armazenamento Interno';
}

export function storageBackendShortLabel(mode: StorageBackendMode = resolveStorageBackendMode()): string {
  return 'Interno';
}

/** Postgres + MinIO via agent-api local (sem Docker). */
export function isRemoteWorkspaceStorageEnabled(): boolean {
  return false;
}

