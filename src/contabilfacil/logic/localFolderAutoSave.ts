import { SIMULADOR_ALL_MANAGED_STORAGE_KEYS } from '../../lib/simuladorFullBackup';
import { isOperationalStorageKey } from '../../lib/safeLocalStorage';

const CONTABILFACIL_PREFIX = 'contabilfacil_';
const MANAGED_PREFIXES = [
  CONTABILFACIL_PREFIX,
  'extratoVision_',
  'eye_vision_',
  'eye-vision_',
  'manager_',
  'simulador_',
] as const;

function isManagedStorageKey(key: string): boolean {
  if ((SIMULADOR_ALL_MANAGED_STORAGE_KEYS as readonly string[]).includes(key)) return true;
  return MANAGED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

let storagePatchInstalled = false;

/**
 * Intercepta localStorage: dados operacionais → memória + Docker.
 * Nunca gravam no disco do navegador.
 */
export function installBrowserOperationalStorageGuard(): void {
  // ⚠️ DISABLED: localStorage ZERO writes (QuotaExceededError)
  // Sistema agora salva SOMENTE no Docker via eyeVisionCloudPush
  if (storagePatchInstalled || typeof localStorage === 'undefined') return;
  storagePatchInstalled = true;
  // Hook desabilitado - todos os dados vão para Docker
  return;
}

/**
 * Remove do localStorage quaisquer chaves operacionais pesadas que possam ter
 * sido gravadas por versões antigas (antes de safeLocalStorage bloquear o prefix
 * 'contabilfacil_'). Roda uma única vez por sessão.
 */
let _bootPurgeDone = false;
function bootPurgeHeavyLocalStorageKeys(): void {
  if (_bootPurgeDone || typeof localStorage === 'undefined') return;
  _bootPurgeDone = true;
  try {
    const toDrop: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (isOperationalStorageKey(k)) toDrop.push(k);
    }
    for (const k of toDrop) {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

/** Instala guard de memória e faz purge boot de chaves pesadas residuais. */
export function registerOperationalStorageLifecycle(): () => void {
  installBrowserOperationalStorageGuard();
  bootPurgeHeavyLocalStorageKeys();
  return () => {};
}

/** @deprecated use registerOperationalStorageLifecycle */
export function registerLocalFolderDatabaseLifecycle(): () => void {
  return registerOperationalStorageLifecycle();
}
