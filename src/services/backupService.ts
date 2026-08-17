import { listMemoryFallbackEntries, safeLocalStorageGetItem, safeLocalStorageSetItem } from '../lib/safeLocalStorage';
import { migrateKey, migrateBackupEntries } from './backupDataMigration';
import {
  setManagerMemoryCacheEntry,
  invalidateManagerDataCache,
  clearCompanyDeletion,
  mergeCompaniesRegistryLists,
  COMPANIES_REGISTRY_KEY,
} from '../contabilfacil/logic/companyWorkspace';

export interface BackupData {
  version: string;
  timestamp: string;
  entries: [string, string][];
  /** Nome da pasta escolhida pelo usuário para exportação (quando disponível via File System Access API). */
  exportFolder?: string;
}

export interface BackupImportResult {
  ok: boolean;
  /** Chaves que o backup trouxe mas não couberam no localStorage (quota do navegador). */
  failedKeys: string[];
}

export const BackupService = {
  /**
   * Coleta todos os dados do localStorage e do memoryFallback.
   */
  exportAllData(exportFolder?: string): string {
    const entries: [string, string][] = [];
    
    // 1. Coleta do localStorage
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const val = localStorage.getItem(key);
        if (val !== null) {
          entries.push([key, val]);
        }
      }
    }
    
    // 2. Coleta do memoryFallback (pode ter dados que não foram pro LS)
    const memEntries = listMemoryFallbackEntries();
    for (const [key, val] of memEntries) {
      // Evita duplicatas, memoryFallback tem prioridade
      const existingIdx = entries.findIndex(([k]) => k === key);
      if (existingIdx !== -1) {
        entries[existingIdx] = [key, val];
      } else {
        entries.push([key, val]);
      }
    }
    
    const backup: BackupData = {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      entries,
      ...(exportFolder ? { exportFolder } : {}),
    };

    return JSON.stringify(backup, null, 2);
  },

  /**
   * Mescla os dados do backup com os dados atuais do sistema.
   * - Chaves com arrays (extrato, plano, contratos, etc.): itens do backup são mesclados
   *   pelo campo `id` — sobreescreve o que já existe com o mesmo id e acrescenta o que
   *   ainda não existe; registros presentes apenas no sistema atual são preservados.
   * - Demais chaves: o valor do backup sobreescreve o valor atual.
   */
  importData(json: string): BackupImportResult {
    const fail: BackupImportResult = { ok: false, failedKeys: [] };
    try {
      if (!json || typeof json !== 'string') return fail;
      const clean = json.trim().replace(/^[\uFEFF\u200B-\u200D]/, '');
      if (!clean) return fail;

      const backup: any = JSON.parse(clean);
      if (!backup || typeof backup !== 'object') return fail;

      // Suporta múltiplos formatos históricos de backup:
      // 1) Array de entradas [ [key, val], ... ]
      // 2) Objeto com propriedade `entries` (BackupData tradicional)
      // 3) Objeto com propriedade `storage` (SimuladorFullBackup)
      // 4) Objeto com propriedade `data`
      // 5) Objeto plano { key1: val1, key2: val2 }
      let rawEntries: Array<[unknown, unknown]> = [];
      if (Array.isArray(backup)) {
        rawEntries = backup;
      } else if (Array.isArray(backup.entries)) {
        rawEntries = backup.entries;
      } else if (backup.storage && typeof backup.storage === 'object') {
        rawEntries = Object.entries(backup.storage);
      } else if (backup.data && typeof backup.data === 'object') {
        rawEntries = Object.entries(backup.data);
      } else {
        rawEntries = Object.entries(backup).filter(
          ([k]) => k !== 'version' && k !== 'timestamp' && k !== 'exportedAt',
        );
      }

      if (!rawEntries.length) {
        console.warn('[BackupService] Nenhum registro encontrado no arquivo de backup');
        return fail;
      }

      // Normaliza entradas para o formato [string, string]
      const formattedEntries: Array<[string, string]> = [];
      for (const item of rawEntries) {
        if (!item || typeof item !== 'object') continue;
        let k: string;
        let v: unknown;

        if (Array.isArray(item)) {
          if (item.length < 2) continue;
          k = String(item[0] ?? '').trim();
          v = item[1];
        } else {
          // Trata objetos { key, value } ou similares
          const obj = item as Record<string, unknown>;
          k = String(obj.key ?? obj.k ?? '').trim();
          v = obj.value ?? obj.val ?? obj.v;
        }

        if (!k) continue;
        const stringVal = typeof v === 'string' ? v : JSON.stringify(v ?? '');
        formattedEntries.push([k, stringVal]);
      }

      if (!formattedEntries.length) {
        console.warn('[BackupService] Nenhuma chave válida no backup');
        return fail;
      }

      console.info('[BackupService] Mesclando', formattedEntries.length, 'chaves de backup...');

      // Aplica pipeline completo: migração de chaves + migração de dados
      // (normaliza campos renomeados, defaults ausentes, chaves globais legadas).
      const migratedEntries = migrateBackupEntries(formattedEntries, migrateKey);
      const failedKeys: string[] = [];

      // Limpa marcações de exclusão ANTES do loop de escrita, para que
      // mergeCompaniesRegistryLists não filtre nenhuma empresa do backup por
      // estar marcada como excluída no dispositivo atual.
      try {
        const registryEntryPre = migratedEntries.find(([k]) => k === COMPANIES_REGISTRY_KEY);
        if (registryEntryPre) {
          const registryPre = JSON.parse(registryEntryPre[1]);
          if (Array.isArray(registryPre)) {
            for (const item of registryPre) {
              const name = (item as Record<string, unknown>)?.name;
              if (typeof name === 'string' && name.trim()) clearCompanyDeletion(name);
            }
          }
        }
      } catch {
        /* ok */
      }

      for (const [key, val] of migratedEntries) {
        let finalVal = val;

        // Trata o registro de empresas com merge por nome (não por id), porque o mesmo
        // id nunca é garantido entre dispositivos diferentes — empresa A no device 1
        // e empresa A no device 2 têm ids distintos mas devem ser tratadas como a mesma.
        // Backup vence em caso de conflito de nome; empresas que só existem localmente
        // são preservadas.
        if (key === COMPANIES_REGISTRY_KEY) {
          try {
            const backupRegistry = JSON.parse(val);
            const existingRaw = safeLocalStorageGetItem(key);
            const existingRegistry = existingRaw ? JSON.parse(existingRaw) : [];
            if (Array.isArray(backupRegistry) && Array.isArray(existingRegistry)) {
              // backup tem prioridade (é passado primeiro): empresas do backup sobrescrevem
              // as locais pelo nome; empresas que só existem localmente são mantidas.
              const merged = mergeCompaniesRegistryLists(backupRegistry, existingRegistry);
              finalVal = JSON.stringify(merged);
            }
          } catch {
            /* mantém o valor original do backup */
          }
        } else {
        // Tenta mesclar arrays pelo campo `id` para preservar dados locais ausentes no backup.
        try {
          const backupParsed = JSON.parse(val);
          if (Array.isArray(backupParsed) && backupParsed.length > 0 && backupParsed[0]?.id != null) {
            const existingRaw = safeLocalStorageGetItem(key);
            if (existingRaw) {
              const existingParsed: unknown = JSON.parse(existingRaw);
              if (Array.isArray(existingParsed)) {
                // Constrói mapa com dados atuais e sobreescreve com dados do backup (backup vence no mesmo id)
                const mergedMap = new Map<string, unknown>();
                for (const item of existingParsed) {
                  const id = String((item as Record<string, unknown>)?.id ?? '').trim();
                  if (id) mergedMap.set(id, item);
                }
                for (const item of backupParsed) {
                  const id = String((item as Record<string, unknown>)?.id ?? '').trim();
                  if (id) mergedMap.set(id, item);
                }
                finalVal = JSON.stringify(Array.from(mergedMap.values()));
              }
            }
          }
        } catch {
          /* mantém o valor original do backup */
        }
        }

        const wrote = safeLocalStorageSetItem(key, finalVal);
        if (!wrote) failedKeys.push(key);
        try {
          if (key.startsWith('contabilfacil_')) {
            const parsed = JSON.parse(finalVal);
            if (Array.isArray(parsed)) {
              setManagerMemoryCacheEntry(key, parsed);
            }
          }
        } catch {
          /* ok */
        }
      }

      // Empresas trazidas pelo backup nunca podem permanecer marcadas como excluídas
      // — senão a hidratação seguinte (Docker/Supabase) pode remover a empresa
      // recém-importada da lista por causa de um registro de exclusão antigo,
      // mesmo com os dados (plano, extrato, etc.) já gravados no localStorage.
      // (clearCompanyDeletion já foi chamado antes do loop; este bloco garante
      //  que qualquer empresa que ficou fora do registry também seja limpa.)
      try {
        const registryEntry = migratedEntries.find(([key]) => key === COMPANIES_REGISTRY_KEY);
        if (registryEntry) {
          const registry = JSON.parse(registryEntry[1]);
          if (Array.isArray(registry)) {
            for (const item of registry) {
              const name = (item as Record<string, unknown>)?.name;
              if (typeof name === 'string' && name.trim()) clearCompanyDeletion(name);
            }
          }
        }
      } catch {
        /* ok — não bloqueia o restante do import */
      }

      invalidateManagerDataCache();
      if (failedKeys.length > 0) {
        console.warn(
          '[BackupService] Backup importado, mas',
          failedKeys.length,
          'chave(s) não couberam no localStorage (armazenamento do navegador cheio):',
          failedKeys,
        );
      } else {
        console.info('[BackupService] Backup importado com sucesso! Chaves:', migratedEntries.length);
      }
      return { ok: true, failedKeys };
    } catch (err) {
      console.error('[BackupService] Falha ao importar backup:', err);
      return fail;
    }
  },

  /**
   * Aciona o download do arquivo JSON.
   */
  downloadBackup(exportFolder?: string): void {
    const data = this.exportAllData(exportFolder);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `backup_gestao_contabil_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  /**
   * Grava o backup direto num diretório escolhido pelo usuário via File System Access API
   * (Chrome/Edge). Retorna o nome do arquivo gravado.
   */
  async writeBackupToDirectory(dirHandle: FileSystemDirectoryHandle): Promise<string> {
    const data = this.exportAllData();
    const filename = `backup_gestao_contabil_${new Date().toISOString().split('T')[0]}.json`;
    const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(data);
    await writable.close();
    return filename;
  },
};
