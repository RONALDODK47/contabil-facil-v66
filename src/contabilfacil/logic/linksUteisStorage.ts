import { generateUUID } from '../../lib/uuid';
import { readPersistedLocalStorageJson, writePersistedLocalStorageJson } from '../../lib/persistentLocalStorage';

export interface LinkUtilItem {
  id: string;
  descricao: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

// Ferramentas não é escopada por empresa — uma única lista global compartilhada.
const STORAGE_KEY = 'contabilfacil_ferramentas_links_uteis_v1';

export function loadLinksUteis(): LinkUtilItem[] {
  const list = readPersistedLocalStorageJson<LinkUtilItem[]>(STORAGE_KEY, []);
  return Array.isArray(list) ? list : [];
}

export function saveLinksUteis(items: LinkUtilItem[]): void {
  writePersistedLocalStorageJson(STORAGE_KEY, items);
}

export function createLinkUtilItem(): LinkUtilItem {
  const now = new Date().toISOString();
  return {
    id: generateUUID(),
    descricao: '',
    url: '',
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeLinkUrl(url: string): string {
  const trimmed = (url ?? '').trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
