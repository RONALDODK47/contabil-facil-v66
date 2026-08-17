/**
 * Ferramentas passou a ser global (não mais por empresa). Dados antigos
 * gravados sob chaves por empresa (ex.: "COMERCIAL FERNANDES") ficaram
 * "invisíveis" depois da mudança — esta migração roda uma vez, varre todas
 * as chaves legadas `contabilfacil_<EMPRESA>_<sufixo>` e junta os itens no
 * armazenamento global novo, sem apagar as chaves antigas.
 */
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from '../../lib/safeLocalStorage';

function readLegacyKeys(suffix: string): { key: string; raw: string }[] {
  const found: { key: string; raw: string }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (!key.startsWith('contabilfacil_') || !key.endsWith(`_${suffix}`)) continue;
      if (key === `contabilfacil_ferramentas_${suffix}`) continue; // já é a chave global nova
      const raw = safeLocalStorageGetItem(key);
      if (raw?.trim()) found.push({ key, raw });
    }
  } catch {
    /* ignore */
  }
  return found;
}

/** Junta listas de itens (com `id`) de todas as chaves legadas na chave global, sem duplicar. */
export function migrateLegacyFerramentasList<T extends { id: string }>(
  suffix: string,
  currentGlobal: T[],
): T[] {
  const migrationFlag = `contabilfacil_ferramentas_${suffix}_migrated_v1`;
  if (safeLocalStorageGetItem(migrationFlag)) return currentGlobal;

  const byId = new Map<string, T>();
  for (const item of currentGlobal) byId.set(item.id, item);

  for (const { raw } of readLegacyKeys(suffix)) {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed as T[]) {
        if (item && typeof item === 'object' && 'id' in item && !byId.has(item.id)) {
          byId.set(item.id, item);
        }
      }
    } catch {
      /* ignore chave corrompida */
    }
  }

  safeLocalStorageSetItem(migrationFlag, '1');
  return Array.from(byId.values());
}

/** Junta quadros de "Gestão de Tarefas" (colunas + tarefas) de todas as chaves legadas. */
export function migrateLegacyGestaoTarefasBoard<
  B extends { colunas: { id: string }[]; tarefas: { id: string }[] },
>(suffix: string, currentGlobal: B): B {
  const migrationFlag = `contabilfacil_ferramentas_${suffix}_migrated_v1`;
  if (safeLocalStorageGetItem(migrationFlag)) return currentGlobal;

  const colunasById = new Map(currentGlobal.colunas.map((c) => [c.id, c]));
  const tarefasById = new Map(currentGlobal.tarefas.map((t) => [t.id, t]));

  for (const { raw } of readLegacyKeys(suffix)) {
    try {
      const parsed = JSON.parse(raw) as { colunas?: unknown[]; tarefas?: unknown[] };
      for (const col of parsed.colunas ?? []) {
        if (col && typeof col === 'object' && 'id' in col) {
          const c = col as { id: string };
          if (!colunasById.has(c.id)) colunasById.set(c.id, c as B['colunas'][number]);
        }
      }
      for (const tarefa of parsed.tarefas ?? []) {
        if (tarefa && typeof tarefa === 'object' && 'id' in tarefa) {
          const t = tarefa as { id: string };
          if (!tarefasById.has(t.id)) tarefasById.set(t.id, t as B['tarefas'][number]);
        }
      }
    } catch {
      /* ignore chave corrompida */
    }
  }

  safeLocalStorageSetItem(migrationFlag, '1');
  return {
    ...currentGlobal,
    colunas: Array.from(colunasById.values()),
    tarefas: Array.from(tarefasById.values()),
  };
}
