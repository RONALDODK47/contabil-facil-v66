/**
 * Armazenamento chave/valor em IndexedDB — usado como backend real de
 * persistência agora que o localStorage (limitado a ~5-10MB pelo navegador,
 * fixo, independente do disco) é a causa do erro "armazenamento cheio".
 * IndexedDB usa a cota de disco do navegador (tipicamente centenas de MB a
 * vários GB), então suporta o volume de dados de várias empresas sem estourar.
 */
const DB_NAME = 'contabilfacil_kv_store';
const DB_VERSION = 1;
const STORE_NAME = 'kv';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        console.warn('[indexedDbKvStore] falha ao abrir IndexedDB:', req.error);
        resolve(null);
      };
    } catch (err) {
      console.warn('[indexedDbKvStore] IndexedDB indisponível:', err);
      resolve(null);
    }
  });
  return dbPromise;
}

/** Lê todas as chaves/valores do banco — usado uma vez, na hidratação inicial. */
export async function idbGetAll(): Promise<Array<[string, string]>> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const entries: Array<[string, string]> = [];
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          entries.push([String(cursor.key), String(cursor.value)]);
          cursor.continue();
        } else {
          resolve(entries);
        }
      };
      cursorReq.onerror = () => {
        console.warn('[indexedDbKvStore] falha ao ler entradas:', cursorReq.error);
        resolve(entries);
      };
    } catch (err) {
      console.warn('[indexedDbKvStore] falha na leitura completa:', err);
      resolve([]);
    }
  });
}

export async function idbSetItem(key: string, value: string): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => {
        console.warn(`[indexedDbKvStore] falha ao gravar ${key}:`, tx.error);
        resolve(false);
      };
    } catch (err) {
      console.warn(`[indexedDbKvStore] falha ao gravar ${key}:`, err);
      resolve(false);
    }
  });
}

export async function idbRemoveItem(key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
