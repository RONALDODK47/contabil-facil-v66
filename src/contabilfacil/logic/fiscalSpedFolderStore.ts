import { companyStorageSlug } from './companyWorkspace';
import {
  clearFolderHandleForKey,
  loadFolderHandleForKey,
  saveFolderHandleForKey,
} from '../../lib/localFolderDbHandleStore';
import {
  selectLatestSpedFilesPerFolder,
  type FiscalSpedFolderScanResult,
  type FiscalSpedTxtCandidate,
} from './fiscalSpedFolderScan';
import { walkFiscalDirectoryFiles } from './fiscalDirectoryWalk';

export type FiscalSpedFolderSettings = {
  folderLabel: string;
  /** Importação + pasta → lançar no balancete quando contas estiverem preenchidas. */
  automationEnabled: boolean;
  lastSyncAt: string | null;
};

const DEFAULT_SETTINGS: FiscalSpedFolderSettings = {
  folderLabel: '',
  automationEnabled: true,
  lastSyncAt: null,
};

function resolveAutomationEnabled(parsed: Record<string, unknown>): boolean {
  if (typeof parsed.automationEnabled === 'boolean') return parsed.automationEnabled;
  const legacySync = parsed.autoSyncOnOpen !== false;
  const legacyPost = parsed.autoPostRazao !== false;
  if ('autoSyncOnOpen' in parsed || 'autoPostRazao' in parsed) {
    return legacySync && legacyPost;
  }
  return true;
}

function settingsKey(companyName: string): string {
  return `fiscal_sped_folder_settings_${companyStorageSlug(companyName)}`;
}

function handleKey(companyName: string): string {
  return `fiscal-sped-folder-${companyStorageSlug(companyName)}`;
}

export function isFiscalSpedFolderSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export function loadFiscalSpedFolderSettings(companyName: string): FiscalSpedFolderSettings {
  try {
    const raw = localStorage.getItem(settingsKey(companyName));
    if (!raw?.trim()) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      folderLabel: String(parsed.folderLabel ?? '').trim(),
      automationEnabled: resolveAutomationEnabled(parsed),
      lastSyncAt: (parsed.lastSyncAt as string | null) ?? null,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveFiscalSpedFolderSettings(
  companyName: string,
  patch: Partial<FiscalSpedFolderSettings>,
): FiscalSpedFolderSettings {
  const prev = loadFiscalSpedFolderSettings(companyName);
  const next = { ...prev, ...patch };
  // ⚠️ DISABLED: Salva SOMENTE no Docker
  // localStorage.setItem(settingsKey(companyName), JSON.stringify(next));
  return next;
}

export function isFiscalSpedFolderConfigured(companyName: string): boolean {
  return Boolean(loadFiscalSpedFolderSettings(companyName).folderLabel);
}

async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const opts = { mode: 'read' as const };
  const current = await (handle as any).queryPermission(opts);
  if (current === 'granted') return true;
  const requested = await (handle as any).requestPermission(opts);
  return requested === 'granted';
}

export async function pickFiscalSpedImportFolder(companyName: string): Promise<FiscalSpedFolderSettings> {
  if (!isFiscalSpedFolderSupported()) {
    throw new Error('Seu navegador não suporta escolha de pasta (use Chrome ou Edge).');
  }
  const handle = await (window as any).showDirectoryPicker({ mode: 'read' });
  await saveFolderHandleForKey(handleKey(companyName), handle);
  return saveFiscalSpedFolderSettings(companyName, {
    folderLabel: handle.name,
    lastSyncAt: null,
  });
}

export async function clearFiscalSpedImportFolder(companyName: string): Promise<void> {
  await clearFolderHandleForKey(handleKey(companyName));
  saveFiscalSpedFolderSettings(companyName, { folderLabel: '', lastSyncAt: null });
}

async function collectTxtFilesRecursive(
  dir: FileSystemDirectoryHandle,
): Promise<{ candidates: FiscalSpedTxtCandidate[]; foldersVisited: number; errors: string[] }> {
  const walked = await walkFiscalDirectoryFiles(dir, (name) => /\.txt$/i.test(name));
  return {
    candidates: walked.files,
    foldersVisited: walked.foldersVisited,
    errors: walked.errors,
  };
}

/** Varre a pasta escolhida e todas as subpastas (qualquer nível). */
export async function scanFiscalSpedFolder(companyName: string): Promise<FiscalSpedFolderScanResult> {
  const handle = await loadFolderHandleForKey(handleKey(companyName));
  if (!handle) {
    return { files: [], messages: ['Pasta de importação SPED não configurada.'], totalEncontrados: 0 };
  }
  const ok = await ensurePermission(handle);
  if (!ok) {
    return { files: [], messages: ['Sem permissão de leitura na pasta SPED.'], totalEncontrados: 0 };
  }

  const { candidates, foldersVisited, errors } = await collectTxtFilesRecursive(handle);
  const result = await selectLatestSpedFilesPerFolder(candidates);
  const messages = [
    `${candidates.length} .txt em ${foldersVisited} pasta(s) (busca recursiva em subpastas).`,
    ...errors.slice(0, 3),
    ...result.messages,
  ];
  return { ...result, messages, foldersVisited };
}

export async function readFiscalSpedTxtFilesFromFolder(companyName: string): Promise<File[]> {
  const scan = await scanFiscalSpedFolder(companyName);
  return scan.files;
}
