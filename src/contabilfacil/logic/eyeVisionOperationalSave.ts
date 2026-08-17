/** Stub - Sincronização em nuvem removida a pedido do usuário */
export const OPERATIONAL_SAVE_DEBOUNCE_MS = 2500;

export function markHydrationComplete(): void {}
export function isHydrationComplete(): boolean { return true; }
export function markOperationalStorageDirty(): void {}
export function hasOperationalStorageDirty(): boolean { return false; }
export function hasOperationalCloudDirty(): boolean { return false; }
export function markOperationalCloudFlushed(): void {}
export function markOperationalFolderFlushed(): void {}
export function hasOperationalFolderDirty(): boolean { return false; }
export function scheduleEyeVisionOperationalSave(_delayMs?: number): void {}

export async function flushEyeVisionOperationalSave(_options?: { force?: boolean; light?: boolean }): Promise<void> {
  const { flushManagerDataWrites } = await import('./companyWorkspace');
  flushManagerDataWrites();
}
