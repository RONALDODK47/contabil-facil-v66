import { companyStorageSlug } from './companyWorkspace';
import type { ExtratoContaMappingCache } from './extratoContaResolver';
import { writePersistedLocalStorageJson } from '../../lib/persistentLocalStorage';

function storageKey(companyName: string): string {
  return `contabilfacil_${companyStorageSlug(companyName)}_extrato_conta_map_v1`;
}

export function loadExtratoContaMappingCache(companyName: string): ExtratoContaMappingCache {
  try {
    const raw = localStorage.getItem(storageKey(companyName));
    if (!raw?.trim()) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as ExtratoContaMappingCache;
  } catch {
    return {};
  }
}

export function saveExtratoContaMappingCache(
  companyName: string,
  cache: ExtratoContaMappingCache,
): void {
  writePersistedLocalStorageJson(storageKey(companyName), cache);
}
