/**
 * @deprecated Pasta local removida — persistência só via Docker local.
 * Mantido para compatibilidade de imports; todas as funções são no-op.
 */

export const LOCAL_FOLDER_DB_CHANGED = 'eye-vision:local-folder-db-changed';

export type LocalFolderSavePhase = 'idle' | 'scheduled' | 'saving' | 'saved' | 'error';

export type LocalFolderDbMeta = {
  folderLabel?: string;
  lastSavedAt?: string | null;
  lastLoadedAt?: string | null;
  localDbActivated?: boolean;
};

export function isLocalFolderDbSupported(): boolean {
  return false;
}

export function isLocalFolderDbConfigured(): boolean {
  return false;
}

export function isLocalFolderDbActivated(): boolean {
  return false;
}

export function getLocalFolderDbMeta(): LocalFolderDbMeta | null {
  return null;
}

export function getLocalFolderSavePhase(): LocalFolderSavePhase {
  return 'idle';
}

export function getLocalFolderSaveError(): string | null {
  return null;
}

export function subscribeLocalFolderDb(_listener: () => void): () => void {
  return () => {};
}

export function shouldAutoLoadLocalFolder(): boolean {
  return false;
}

export async function hydrateFromLocalDatabaseFolder(): Promise<boolean> {
  return false;
}

export function scheduleLocalDatabaseSave(_delayMs?: number): void {
  /* no-op — pasta local desativada */
}

export async function flushLocalDatabaseSave(_options?: {
  light?: boolean;
  force?: boolean;
}): Promise<void> {
  /* no-op */
}

export async function configureLocalDatabaseFolder(): Promise<{
  folderName: string;
  hasExistingFile: boolean;
}> {
  throw new Error(
    'Salvamento em pasta local foi desativado. Use Docker (local).',
  );
}

export async function activateAndSaveLocalDatabase(): Promise<{
  folderName: string;
  savedAt: string;
}> {
  throw new Error(
    'Salvamento em pasta local foi desativado. Os dados vão para Docker automaticamente.',
  );
}

export async function loadAndActivateLocalDatabase(): Promise<void> {
  throw new Error('Restauração por pasta local foi desativada.');
}

export async function loadLocalDatabaseFromFolder(): Promise<null> {
  return null;
}
