import { generateUUID } from '../../lib/uuid';
import { readPersistedLocalStorageJson, writePersistedLocalStorageJson } from '../../lib/persistentLocalStorage';

export type RecadoPendenciaTipo = 'PENDENCIA' | 'RECADO';
export type RecadoPendenciaCor = 'amarelo' | 'vermelho' | 'verde';

export interface RecadoPendenciaItem {
  id: string;
  tipo: RecadoPendenciaTipo;
  complemento: string;
  texto: string;
  cor: RecadoPendenciaCor;
  createdAt: string;
  updatedAt: string;
}

// Ferramentas não é escopada por empresa — um único quadro global compartilhado.
const STORAGE_KEY = 'contabilfacil_ferramentas_recados_pendencias_v1';

export function loadRecadosPendencias(): RecadoPendenciaItem[] {
  const list = readPersistedLocalStorageJson<RecadoPendenciaItem[]>(STORAGE_KEY, []);
  return Array.isArray(list) ? list : [];
}

export function saveRecadosPendencias(items: RecadoPendenciaItem[]): void {
  writePersistedLocalStorageJson(STORAGE_KEY, items);
}

export function createRecadoPendenciaItem(tipo: RecadoPendenciaTipo): RecadoPendenciaItem {
  const now = new Date().toISOString();
  return {
    id: generateUUID(),
    tipo,
    complemento: '',
    texto: '',
    cor: 'amarelo',
    createdAt: now,
    updatedAt: now,
  };
}
