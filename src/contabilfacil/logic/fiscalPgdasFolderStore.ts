import { companyStorageSlug } from './companyWorkspace';
import {
  clearFolderHandleForKey,
  loadFolderHandleForKey,
  saveFolderHandleForKey,
} from '../../lib/localFolderDbHandleStore';
import {
  isPgdasCandidateFileName,
  selectLatestPgdasFilesPerFolder,
  type FiscalPgdasFileCandidate,
  type FiscalPgdasFolderScanResult,
} from './fiscalPgdasFolderScan';
import { walkFiscalDirectoryFiles } from './fiscalDirectoryWalk';

export type FiscalPgdasFolderSettings = {
  folderLabel: string;
  automationEnabled: boolean;
  lastSyncAt: string | null;
};

const DEFAULT_SETTINGS: FiscalPgdasFolderSettings = {
  folderLabel: '',
  automationEnabled: true,
  lastSyncAt: null,
};

function settingsKey(companyName: string): string {
  return `fiscal_pgdas_folder_settings_${companyStorageSlug(companyName)}`;
}

function handleKey(companyName: string): string {
  return `fiscal-pgdas-folder-${companyStorageSlug(companyName)}`;
}

export function isFiscalPgdasFolderSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export function loadFiscalPgdasFolderSettings(companyName: string): FiscalPgdasFolderSettings {
  try {
    const raw = localStorage.getItem(settingsKey(companyName));
    if (!raw?.trim()) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      folderLabel: String(parsed.folderLabel ?? '').trim(),
      automationEnabled: parsed.automationEnabled !== false,
      lastSyncAt: (parsed.lastSyncAt as string | null) ?? null,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveFiscalPgdasFolderSettings(
  companyName: string,
  patch: Partial<FiscalPgdasFolderSettings>,
): FiscalPgdasFolderSettings {
  const prev = loadFiscalPgdasFolderSettings(companyName);
  const next = { ...prev, ...patch };
  // ⚠️ DISABLED: Salva SOMENTE no Docker
  // localStorage.setItem(settingsKey(companyName), JSON.stringify(next));
  return next;
}

export function isFiscalPgdasFolderConfigured(companyName: string): boolean {
  return Boolean(loadFiscalPgdasFolderSettings(companyName).folderLabel);
}

async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const opts = { mode: 'read' as const };
  const current = await (handle as any).queryPermission(opts);
  if (current === 'granted') return true;
  const requested = await (handle as any).requestPermission(opts);
  return requested === 'granted';
}

export async function pickFiscalPgdasImportFolder(companyName: string): Promise<FiscalPgdasFolderSettings> {
  if (!isFiscalPgdasFolderSupported()) {
    throw new Error('Seu navegador não suporta escolha de pasta (use Chrome ou Edge).');
  }
  const handle = await (window as any).showDirectoryPicker({ mode: 'read' });
  await saveFolderHandleForKey(handleKey(companyName), handle);
  return saveFiscalPgdasFolderSettings(companyName, {
    folderLabel: handle.name,
    lastSyncAt: null,
  });
}

export async function clearFiscalPgdasImportFolder(companyName: string): Promise<void> {
  await clearFolderHandleForKey(handleKey(companyName));
  saveFiscalPgdasFolderSettings(companyName, { folderLabel: '', lastSyncAt: null });
}

async function collectPgdasFilesRecursive(
  dir: FileSystemDirectoryHandle,
): Promise<{ candidates: FiscalPgdasFileCandidate[]; foldersVisited: number; errors: string[] }> {
  const walked = await walkFiscalDirectoryFiles(dir, isPgdasCandidateFileName);
  return {
    candidates: walked.files,
    foldersVisited: walked.foldersVisited,
    errors: walked.errors,
  };
}

export async function scanFiscalPgdasFolder(companyName: string): Promise<FiscalPgdasFolderScanResult> {
  const handle = await loadFolderHandleForKey(handleKey(companyName));
  if (!handle) {
    return { files: [], messages: ['Pasta de importação PGDAS não configurada.'], totalEncontrados: 0 };
  }
  const ok = await ensurePermission(handle);
  if (!ok) {
    return { files: [], messages: ['Sem permissão de leitura na pasta PGDAS.'], totalEncontrados: 0 };
  }

  const { candidates, foldersVisited, errors } = await collectPgdasFilesRecursive(handle);
  const result = await selectLatestPgdasFilesPerFolder(candidates);
  const messages = [
    `${candidates.length} arquivo(s) PGDAS em ${foldersVisited} pasta(s) (busca recursiva em subpastas).`,
    ...errors.slice(0, 3),
    ...result.messages,
  ];
  return { ...result, messages, foldersVisited };
}
