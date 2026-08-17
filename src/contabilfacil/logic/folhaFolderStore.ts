import { companyStorageSlug } from './companyWorkspace';
import {
  clearFolderHandleForKey,
  loadFolderHandleForKey,
  saveFolderHandleForKey,
} from '../../lib/localFolderDbHandleStore';

export type FolhaFolderSettings = {
  folderLabel: string;
  automationEnabled: boolean;
  lastSyncAt: string | null;
};

const DEFAULT_SETTINGS: FolhaFolderSettings = {
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
  return `folha_folder_settings_${companyStorageSlug(companyName)}`;
}

function handleKey(companyName: string): string {
  return `folha-import-folder-${companyStorageSlug(companyName)}`;
}

export function isFolhaFolderSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export function loadFolhaFolderSettings(companyName: string): FolhaFolderSettings {
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

export function saveFolhaFolderSettings(
  companyName: string,
  patch: Partial<FolhaFolderSettings>,
): FolhaFolderSettings {
  const prev = loadFolhaFolderSettings(companyName);
  const next = { ...prev, ...patch };
  // ⚠️ DISABLED: Salva SOMENTE no Docker
  // localStorage.setItem(settingsKey(companyName), JSON.stringify(next));
  return next;
}

export function isFolhaFolderConfigured(companyName: string): boolean {
  return Boolean(loadFolhaFolderSettings(companyName).folderLabel);
}

async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const opts = { mode: 'read' as const };
  const current = await (handle as any).queryPermission(opts);
  if (current === 'granted') return true;
  const requested = await (handle as any).requestPermission(opts);
  return requested === 'granted';
}

export async function pickFolhaImportFolder(companyName: string): Promise<FolhaFolderSettings> {
  if (!isFolhaFolderSupported()) {
    throw new Error('Seu navegador não suporta escolha de pasta (use Chrome ou Edge).');
  }
  const handle = await (window as any).showDirectoryPicker({ mode: 'read' });
  await saveFolderHandleForKey(handleKey(companyName), handle);
  return saveFolhaFolderSettings(companyName, {
    folderLabel: handle.name,
    lastSyncAt: null,
  });
}

export async function clearFolhaImportFolder(companyName: string): Promise<void> {
  await clearFolderHandleForKey(handleKey(companyName));
  saveFolhaFolderSettings(companyName, { folderLabel: '', lastSyncAt: null });
}

export async function readFolhaTxtFilesFromFolder(companyName: string): Promise<File[]> {
  const handle = await loadFolderHandleForKey(handleKey(companyName));
  if (!handle) return [];
  const ok = await ensurePermission(handle);
  if (!ok) return [];

  const out: File[] = [];
  for await (const entry of (handle as any).values()) {
    if (entry.kind !== 'file') continue;
    const name = entry.name;
    if (!/\.txt$/i.test(name)) continue;
    const file = await entry.getFile();
    out.push(file);
  }
  return out;
}
