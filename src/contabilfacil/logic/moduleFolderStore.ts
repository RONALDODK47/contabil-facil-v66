/**
 * Pasta de dados por módulo e empresa.
 *
 * A pasta é a fonte de dados do sistema: o que não está gravado nela não
 * existe. Cada aba escolhe a sua pasta, e o agente RPA sincroniza o conteúdo
 * dessa pasta com o módulo correspondente.
 *
 * Um único store atende todas as abas — cada módulo entra no registro em
 * `moduleFolderRegistry.ts` informando o que grava e o que lê.
 */
import { companyStorageSlug } from './companyWorkspace';
import {
  clearFolderHandleForKey,
  ensureFolderPermission,
  loadFolderHandleForKey,
  saveFolderHandleForKey,
} from '../../lib/localFolderDbHandleStore';

export type ModuleFolderSettings = {
  /** Nome da pasta escolhida — só rótulo, o acesso real vem do handle. */
  folderLabel: string;
  /** Agente RPA pode sincronizar esta pasta automaticamente. */
  automationEnabled: boolean;
  lastSyncAt: string | null;
  /** Resumo da última sincronização, exibido no painel. */
  lastSyncSummary: string | null;
};

const DEFAULT_SETTINGS: ModuleFolderSettings = {
  folderLabel: '',
  automationEnabled: true,
  lastSyncAt: null,
  lastSyncSummary: null,
};

function settingsKey(moduleId: string, companyName: string): string {
  return `contabilfacil_${companyStorageSlug(companyName)}_pasta_${moduleId}_v1`;
}

function handleKey(moduleId: string, companyName: string): string {
  return `modulo-${moduleId}-${companyStorageSlug(companyName)}`;
}

/** Escolher pasta exige File System Access API — hoje só Chrome e Edge. */
export function isModuleFolderSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export function loadModuleFolderSettings(
  moduleId: string,
  companyName: string,
): ModuleFolderSettings {
  try {
    const raw = localStorage.getItem(settingsKey(moduleId, companyName));
    if (!raw?.trim()) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      folderLabel: String(parsed.folderLabel ?? '').trim(),
      automationEnabled: parsed.automationEnabled !== false,
      lastSyncAt: (parsed.lastSyncAt as string | null) ?? null,
      lastSyncSummary: (parsed.lastSyncSummary as string | null) ?? null,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Grava as configurações da pasta.
 *
 * O `folhaFolderStore` mantinha esta gravação comentada ("salva somente no
 * Docker") e por isso a pasta escolhida sumia a cada recarga. Aqui ela grava
 * de verdade: sem isso o usuário reescolhe a pasta toda vez que abre a aba.
 */
export function saveModuleFolderSettings(
  moduleId: string,
  companyName: string,
  patch: Partial<ModuleFolderSettings>,
): ModuleFolderSettings {
  const next = { ...loadModuleFolderSettings(moduleId, companyName), ...patch };
  try {
    localStorage.setItem(settingsKey(moduleId, companyName), JSON.stringify(next));
  } catch (e) {
    console.warn(`[pasta] não foi possível gravar configuração de ${moduleId}:`, e);
  }
  return next;
}

export function isModuleFolderConfigured(moduleId: string, companyName: string): boolean {
  return Boolean(loadModuleFolderSettings(moduleId, companyName).folderLabel);
}

/** Abre o seletor de pasta. Precisa ser chamado dentro de um clique do usuário. */
export async function pickModuleFolder(
  moduleId: string,
  companyName: string,
): Promise<ModuleFolderSettings> {
  if (!isModuleFolderSupported()) {
    throw new Error(
      'Este navegador não permite escolher pasta. Use o Google Chrome ou o Microsoft Edge.',
    );
  }
  const picker = (window as unknown as {
    showDirectoryPicker: (o: unknown) => Promise<FileSystemDirectoryHandle>;
  }).showDirectoryPicker;

  const handle = await picker({ mode: 'readwrite', id: `contabilfacil-${moduleId}` });
  await saveFolderHandleForKey(handleKey(moduleId, companyName), handle);
  return saveModuleFolderSettings(moduleId, companyName, {
    folderLabel: handle.name,
    lastSyncAt: null,
    lastSyncSummary: null,
  });
}

export async function clearModuleFolder(moduleId: string, companyName: string): Promise<void> {
  await clearFolderHandleForKey(handleKey(moduleId, companyName));
  saveModuleFolderSettings(moduleId, companyName, {
    folderLabel: '',
    lastSyncAt: null,
    lastSyncSummary: null,
  });
}

/**
 * Handle da pasta, já com permissão garantida.
 *
 * `request` só funciona dentro de um clique. Numa carga de página use
 * request=false para descobrir se a permissão ainda vale sem incomodar o
 * usuário; no botão Sincronizar use request=true.
 */
export async function getModuleFolderHandle(
  moduleId: string,
  companyName: string,
  options?: { write?: boolean; request?: boolean },
): Promise<FileSystemDirectoryHandle | null> {
  const handle = await loadFolderHandleForKey(handleKey(moduleId, companyName));
  if (!handle) return null;
  const ok = await ensureFolderPermission(
    handle,
    options?.write ? 'readwrite' : 'read',
    options?.request ?? false,
  );
  return ok ? handle : null;
}

/** Lê os arquivos da pasta que casam com as extensões do módulo. */
export async function readModuleFolderFiles(
  moduleId: string,
  companyName: string,
  extensions: string[],
  options?: { request?: boolean },
): Promise<File[]> {
  const handle = await getModuleFolderHandle(moduleId, companyName, {
    request: options?.request,
  });
  if (!handle) return [];

  const exts = extensions.map((e) => e.toLowerCase().replace(/^\./, ''));
  const out: File[] = [];
  const dir = handle as unknown as {
    values: () => AsyncIterable<FileSystemHandle>;
  };
  for await (const entry of dir.values()) {
    if (entry.kind !== 'file') continue;
    const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
    if (exts.length && !exts.includes(ext)) continue;
    out.push(await (entry as FileSystemFileHandle).getFile());
  }
  return out;
}

/**
 * Grava um arquivo na pasta do módulo — é assim que regras de conciliação e
 * contratos de empréstimo passam a existir de forma durável.
 */
export async function writeModuleFolderFile(
  moduleId: string,
  companyName: string,
  fileName: string,
  content: string | Blob,
  options?: { request?: boolean },
): Promise<boolean> {
  const handle = await getModuleFolderHandle(moduleId, companyName, {
    write: true,
    request: options?.request,
  });
  if (!handle) return false;
  try {
    const dir = handle as unknown as {
      getFileHandle: (n: string, o: { create: boolean }) => Promise<FileSystemFileHandle>;
    };
    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const writable = await (fileHandle as unknown as {
      createWritable: () => Promise<FileSystemWritableFileStream>;
    }).createWritable();
    await writable.write(content);
    await writable.close();
    return true;
  } catch (e) {
    console.warn(`[pasta] falha ao gravar ${fileName} em ${moduleId}:`, e);
    return false;
  }
}

/** Lê um arquivo específico da pasta. Devolve null se não existir. */
export async function readModuleFolderFile(
  moduleId: string,
  companyName: string,
  fileName: string,
  options?: { request?: boolean },
): Promise<string | null> {
  const handle = await getModuleFolderHandle(moduleId, companyName, {
    request: options?.request,
  });
  if (!handle) return null;
  try {
    const dir = handle as unknown as {
      getFileHandle: (n: string, o?: { create: boolean }) => Promise<FileSystemFileHandle>;
    };
    const fileHandle = await dir.getFileHandle(fileName);
    return await (await fileHandle.getFile()).text();
  } catch {
    return null;
  }
}
