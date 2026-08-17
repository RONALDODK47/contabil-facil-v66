import { readPersistedLocalStorageJson, writePersistedLocalStorageJson } from '../persistentLocalStorage';

export type TextFilterKind = 'exclusao' | 'limpeza';

/** Listas de filtro de texto (exclusão / limpeza de histórico) NUNCA são preenchidas
 * automaticamente — só existem quando o usuário digita e clica em "Salvar". Esta storage só
 * é lida quando o usuário clica explicitamente em "Carregar salvos". */
function storageKey(scope: string, kind: TextFilterKind): string {
  return `contabilfacil_filtro_texto_${kind}_${scope.trim() || 'global'}`;
}

export function loadSavedTextFilterRules(scope: string, kind: TextFilterKind): string[] {
  return readPersistedLocalStorageJson<string[]>(storageKey(scope, kind), []);
}

export function saveTextFilterRules(scope: string, kind: TextFilterKind, rules: string[]): void {
  writePersistedLocalStorageJson(storageKey(scope, kind), rules);
}
