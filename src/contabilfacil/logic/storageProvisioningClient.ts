/**
 * Stub para evitar erros de importação após a remoção do sistema de armazenamento legado.
 * O novo sistema utiliza BackupService para exportar/importar saves em JSON.
 */

export function isStorageProvisioningAvailable(): boolean {
  return false;
}

export type StorageStatus = {
  ok: boolean;
  dockerInstalled: boolean;
  dockerRunning: boolean;
  containersUp: boolean;
  supabaseConnected: boolean;
  mode: 'nenhum' | 'docker' | 'pasta';
  folderPath: string | null;
};

export type FolderConfig = {
  ok: boolean;
  folderPath: string | null;
  mode: 'nenhum' | 'docker' | 'pasta' | 'supabase' | 'firebase';
  supabaseUrl?: string | null;
};

export function fetchStorageStatus(): Promise<StorageStatus> {
  return Promise.resolve({
    ok: true,
    dockerInstalled: false,
    dockerRunning: false,
    containersUp: false,
    supabaseConnected: false,
    mode: 'nenhum',
    folderPath: null
  });
}

export function fetchFolderConfig(): Promise<FolderConfig> {
  return Promise.resolve({
    ok: true,
    folderPath: null,
    mode: 'nenhum'
  });
}

export function fetchDefaultStorageFolder(): Promise<{ ok: boolean; folderPath?: string }> {
  return Promise.resolve({ ok: true, folderPath: '' });
}

export function startDockerStorage(): Promise<any> { return Promise.resolve({ ok: true }); }
export function startLocalFolderStorage(): Promise<any> { return Promise.resolve({ ok: true }); }
export function stopLocalFolderStorage(): Promise<any> { return Promise.resolve({ ok: true }); }
export function resetStorage(): Promise<any> { return Promise.resolve({ ok: true }); }
