/** Grava JSON no localStorage e agenda sync na nuvem (Eye Vision). */
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from './safeLocalStorage';
import {
  markOperationalStorageDirty,
  scheduleEyeVisionOperationalSave,
} from '../contabilfacil/logic/eyeVisionOperationalSave';

export function readPersistedLocalStorageJson<T>(key: string, fallback: T): T {
  try {
    const raw = safeLocalStorageGetItem(key);
    if (!raw?.trim()) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writePersistedLocalStorageJson(key: string, value: unknown): void {
  const ok = safeLocalStorageSetItem(key, JSON.stringify(value));
  if (!ok) {
    console.warn(`[storage] ${key} não coube no localStorage — mantido em memória / pasta.`);
  }
  // Import estático (não dinâmico): evita perder o agendamento de sync se a
  // aba for atualizada/fechada antes do import() dinâmico resolver.
  markOperationalStorageDirty();
  scheduleEyeVisionOperationalSave();
}
