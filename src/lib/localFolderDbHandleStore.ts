/**
 * Persiste handles de pasta (File System Access API) em IndexedDB.
 *
 * FileSystemDirectoryHandle é structured-cloneable, então sobrevive em
 * IndexedDB — mas NÃO em localStorage, que só guarda string. Como a pasta é a
 * fonte de dados do sistema, o handle precisa sobreviver ao F5: guardar só em
 * memória fazia o usuário reescolher a pasta a cada recarga.
 *
 * A permissão concedida à pasta não é restaurada automaticamente pelo
 * navegador — depois de recarregar, o handle volta com permissão 'prompt' e é
 * preciso chamar requestPermission() num gesto do usuário. Por isso o
 * `ensureFolderPermission` abaixo é exportado: quem usa o handle precisa
 * chamá-lo antes de ler/gravar.
 */

const DB_NAME = 'contabilfacil-folders';
const DB_VERSION = 1;
const STORE = 'handles';
const FOLDER_KEY = 'data-folder';

/** Cache em memória — evita ida ao IndexedDB a cada leitura. */
const memoryCache = new Map<string, FileSystemDirectoryHandle>();

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return Promise.resolve(null);
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function runTx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        let req: IDBRequest<T>;
        try {
          req = fn(db.transaction(STORE, mode).objectStore(STORE));
        } catch {
          db.close();
          resolve(null);
          return;
        }
        req.onsuccess = () => {
          resolve(req.result ?? null);
          db.close();
        };
        req.onerror = () => {
          resolve(null);
          db.close();
        };
      }),
  );
}

export async function saveFolderHandleForKey(
  key: string,
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  memoryCache.set(key, handle);
  await runTx('readwrite', (store) => store.put(handle, key) as IDBRequest<IDBValidKey>);
}

export async function loadFolderHandleForKey(
  key: string,
): Promise<FileSystemDirectoryHandle | null> {
  const cached = memoryCache.get(key);
  if (cached) return cached;
  const stored = await runTx<FileSystemDirectoryHandle>('readonly', (store) => store.get(key));
  if (stored) memoryCache.set(key, stored);
  return stored ?? null;
}

export async function clearFolderHandleForKey(key: string): Promise<void> {
  memoryCache.delete(key);
  await runTx('readwrite', (store) => store.delete(key) as unknown as IDBRequest<undefined>);
}

export async function saveFolderHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await saveFolderHandleForKey(FOLDER_KEY, handle);
}

export async function loadFolderHandle(): Promise<FileSystemDirectoryHandle | null> {
  return loadFolderHandleForKey(FOLDER_KEY);
}

export async function clearFolderHandle(): Promise<void> {
  await clearFolderHandleForKey(FOLDER_KEY);
}

/** Lista as chaves de pasta já persistidas (para o painel de sincronização). */
export async function listFolderHandleKeys(): Promise<string[]> {
  const keys = await runTx<IDBValidKey[]>('readonly', (store) => store.getAllKeys());
  if (keys?.length) return keys.map((k) => String(k));
  return [...memoryCache.keys()];
}

export type FolderPermissionMode = 'read' | 'readwrite';

/**
 * Garante permissão de acesso à pasta.
 *
 * `request` só pode ser true dentro de um gesto do usuário (clique) — fora
 * disso o navegador rejeita silenciosamente. Ao restaurar do IndexedDB numa
 * carga de página, chame com request=false para apenas consultar; peça a
 * permissão quando o usuário clicar em Sincronizar.
 */
export async function ensureFolderPermission(
  handle: FileSystemDirectoryHandle,
  mode: FolderPermissionMode = 'read',
  request = false,
): Promise<boolean> {
  const opts = { mode };
  const h = handle as unknown as {
    queryPermission?: (o: unknown) => Promise<PermissionState>;
    requestPermission?: (o: unknown) => Promise<PermissionState>;
  };
  try {
    const current = await h.queryPermission?.(opts);
    if (current === 'granted') return true;
    if (!request) return false;
    const asked = await h.requestPermission?.(opts);
    return asked === 'granted';
  } catch {
    return false;
  }
}
