/**
 * Persistência local — fonte de verdade única, agora que a sincronização em
 * nuvem foi removida (Exportar/Importar backup JSON é a única forma manual
 * de mover dados entre navegadores).
 *
 * O localStorage puro do navegador é limitado a ~5-10MB, fixo, independente
 * do disco disponível — com várias empresas isso estoura fácil e os dados
 * grandes (extrato, plano, OCR) somem sem aviso. Por isso o backend real é
 * IndexedDB (cota ligada ao disco, tipicamente centenas de MB a poucos GB):
 * - O Map em memória (`memoryFallback`) é o que todo o app lê/escreve de
 *   forma síncrona durante a sessão — hidratado do IndexedDB no boot.
 * - Toda gravação também é replicada (debounced) no IndexedDB em background.
 * - O localStorage do navegador ainda recebe uma cópia best-effort (não
 *   crítica) só para compatibilidade com código legado que lê `localStorage`
 *   diretamente; falhas nele nunca são reportadas como perda de dado.
 */
import { idbGetAll, idbRemoveItem, idbSetItem } from './indexedDbKvStore';

const memoryFallback = new Map<string, string>();

/** Dados que podem ir para o localStorage do navegador (leves) */
const BROWSER_ALLOWED_PREFIXES = ['gc_auth_', 'cf-autobot-', 'contabilfacil_'] as const;

export function isBrowserAllowedStorageKey(key: string): boolean {
  // Agora permitimos quase tudo, exceto talvez payloads gigantes que o usuário queira evitar no LS
  // Mas para o sistema de "Saves" manual, queremos que tudo esteja acessível.
  return true;
}

export function isOperationalStorageKey(key: string): boolean {
  return false;
}

let hydrated = false;
let hydratePromise: Promise<void> | null = null;

/**
 * Carrega todo o IndexedDB no Map em memória — deve ser aguardado antes do
 * app renderizar (ver main.tsx), senão a primeira leitura síncrona de uma
 * chave que só existe no IndexedDB (porque não coube no localStorage antes
 * dessa correção) retornaria vazia.
 */
export function hydrateSafeStorageFromIndexedDb(): Promise<void> {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const entries = await idbGetAll();
      for (const [key, value] of entries) {
        // localStorage (se ainda tiver a chave) é só um espelho — o valor do
        // IndexedDB é sempre o mais completo/atual, então ele prevalece.
        memoryFallback.set(key, value);
      }
    } catch (err) {
      console.warn('[storage] falha ao hidratar do IndexedDB:', err);
    } finally {
      hydrated = true;
    }
  })();
  return hydratePromise;
}

export function isSafeStorageHydrated(): boolean {
  return hydrated;
}

const idbWriteTimers = new Map<string, ReturnType<typeof setTimeout>>();
const IDB_WRITE_DEBOUNCE_MS = 250;

function scheduleIdbWrite(key: string, value: string): void {
  const pending = idbWriteTimers.get(key);
  if (pending) clearTimeout(pending);
  idbWriteTimers.set(
    key,
    setTimeout(() => {
      idbWriteTimers.delete(key);
      void idbSetItem(key, value);
    }, IDB_WRITE_DEBOUNCE_MS),
  );
}

/** Grava imediatamente no IndexedDB, sem debounce — usar antes de fechar/recarregar a página. */
export function flushPendingIndexedDbWrites(): void {
  for (const [key, timer] of idbWriteTimers) {
    clearTimeout(timer);
    idbWriteTimers.delete(key);
    const value = memoryFallback.get(key);
    if (value != null) void idbSetItem(key, value);
  }
}

/**
 * Grava no Map em memória (síncrono, sempre "funciona") e replica em
 * background no IndexedDB (backend real) e no localStorage (best-effort,
 * cópia legada). O retorno indica se o valor está seguro na sessão atual —
 * não reflete mais o resultado do localStorage puro, que não é mais a fonte
 * de verdade.
 */
export function safeLocalStorageSetItem(key: string, value: string): boolean {
  memoryFallback.set(key, value);
  scheduleIdbWrite(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    // Best-effort — o dado já está seguro no Map + IndexedDB.
  }
  return true;
}

export function safeLocalStorageGetItem(key: string): string | null {
  const mem = memoryFallback.get(key);
  if (mem != null) return mem;

  try {
    const raw = localStorage.getItem(key);
    if (raw != null) {
      memoryFallback.set(key, raw);
      return raw;
    }
    return null;
  } catch {
    return null;
  }
}

export function safeLocalStorageRemoveItem(key: string): void {
  memoryFallback.delete(key);
  const pending = idbWriteTimers.get(key);
  if (pending) {
    clearTimeout(pending);
    idbWriteTimers.delete(key);
  }
  void idbRemoveItem(key);
  try {
    localStorage.removeItem(key);
  } catch { /* ignore */ }
}

/** Todas as chaves em memória (para backup). */
export function listMemoryFallbackEntries(): Array<[string, string]> {
  return Array.from(memoryFallback.entries());
}

export function getMemoryFallbackValue(key: string): string | undefined {
  return memoryFallback.get(key);
}

export function setMemoryStorageValue(key: string, value: string): void {
  memoryFallback.set(key, value);
}

// Stubs for removed functions to avoid breakage
export function purgeOperationalLocalStorage(): number { return 0; }
export function reclaimLocalStorageSpace(): number { return 0; }
export function isOperationalBrowserStorageBlocked(): boolean { return false; }
export function attachRawBrowserStorage(): void {}
