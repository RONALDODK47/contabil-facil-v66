/**
 * Hook de Sincronização Automática
 * 
 * Monitora mudanças nos dados e sincroniza automaticamente com o agent API
 * - Salva em dados rápidos (.data/internal-data/)
 * - Cria backup automático (.data/internal-backups/)
 */

import { useEffect, useRef, useCallback } from 'react';

const API_BASE = '/api/agent';
const SYNC_DEBOUNCE_MS = 2000; // Aguarda 2s após última mudança antes de sincronizar

interface SyncData {
  officeToken: string;
  officeData: Record<string, unknown>;
  managers?: unknown[];
}

/**
 * Sincroniza dados automaticamente com o agent API
 */
async function syncDataToApi(data: SyncData): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/sync/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      console.warn('[useAutoSync] Erro na sincronização:', res.statusText);
      return false;
    }

    const result = await res.json();
    console.log('[useAutoSync] ✅ Sincronizado:', data.officeToken);
    return result.ok === true;
  } catch (err) {
    console.warn('[useAutoSync] Erro ao sincronizar:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Hook que sincroniza automaticamente dados quando mudam
 */
export function useAutoSync(data: SyncData | null, enabled: boolean = true) {
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncRef = useRef<string>('');

  const performSync = useCallback(async () => {
    if (!data || !enabled) return;

    const dataStr = JSON.stringify(data);
    
    // Evita sincronizar se nada mudou
    if (dataStr === lastSyncRef.current) {
      console.log('[useAutoSync] Sem mudanças, pulando sincronização');
      return;
    }

    lastSyncRef.current = dataStr;

    console.log('[useAutoSync] 🔄 Sincronizando:', data.officeToken);
    const success = await syncDataToApi(data);

    if (!success) {
      console.warn('[useAutoSync] ⚠️  Falha na sincronização');
    }
  }, [data, enabled]);

  useEffect(() => {
    if (!data || !enabled) {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
      return;
    }

    // Limpar timer anterior
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    // Agendar nova sincronização com debounce
    debounceTimer.current = setTimeout(() => {
      void performSync();
    }, SYNC_DEBOUNCE_MS);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
    };
  }, [data, enabled, performSync]);
}

/**
 * Sincroniza manualmente (sem debounce)
 */
export async function syncNow(data: SyncData): Promise<boolean> {
  return syncDataToApi(data);
}
