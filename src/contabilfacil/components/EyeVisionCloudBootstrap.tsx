/**
 * Bootstrap de sincronização — carrega dados do armazenamento interno (agent-api)
 * na inicialização e registra ciclo de auto-save periódico.
 */
import { useEffect, useRef } from 'react';
import {
  safeLocalStorageSetItem,
  safeLocalStorageGetItem,
} from '../../lib/safeLocalStorage';
import {
  COMPANIES_REGISTRY_KEY,
  SELECTED_COMPANY_KEY,
  MANAGER_DATA_SUFFIXES,
  companyManagerStorageKey,
  canonicalCompanyStorageSlug,
  dedupeCompaniesBySlug,
  filterOutDeletedCompanies,
  invalidateManagerDataCache,
  setManagerMemoryCacheEntry,
  saveDeletedCompanies,
  loadDeletedCompanies,
  mergeDeletedCompaniesRecords,
  loadCompaniesRegistry,
  mergeCompaniesRegistryLists,
  type CompanyRecord,
  type DeletedCompanyRecord,
} from '../logic/companyWorkspace';
import { PRICING_COMPANIES_REGISTRY_KEY, PRICING_SELECTED_COMPANY_KEY } from '../logic/pricingCompanyWorkspace';
import { markHydrationComplete } from '../logic/eyeVisionOperationalSave';
import { registerEyeVisionAutoSaveLifecycle } from '../logic/eyeVisionPersistenceFlush';

const AGENT_API_BASE = '/api/agent';

type OfficeData = {
  companies_registry?: CompanyRecord[];
  deleted_companies?: DeletedCompanyRecord[];
  selected_company?: string;
  pricing_companies_registry?: CompanyRecord[];
  pricing_selected_company?: string;
  simulador_contracts?: unknown[];
  simulador_parcelamentos?: unknown[];
  simulador_aplicacoes?: unknown[];
  simulador_precificacao?: unknown[];
  extra_storage?: Record<string, unknown>;
};

type ManagerData = {
  company_slug?: string;
  company_name?: string;
  data?: Partial<Record<(typeof MANAGER_DATA_SUFFIXES)[number], unknown[]>>;
};

/** Aplica dados de office vindos do servidor na memória/localStorage. */
function applyOfficeData(office: OfficeData): void {
  if (Array.isArray(office.deleted_companies)) {
    saveDeletedCompanies(
      mergeDeletedCompaniesRecords(loadDeletedCompanies(), office.deleted_companies),
    );
  }
  if (Array.isArray(office.companies_registry)) {
    const deduped = dedupeCompaniesBySlug(office.companies_registry);
    const merged = filterOutDeletedCompanies(
      mergeCompaniesRegistryLists(deduped, loadCompaniesRegistry()),
    );
    safeLocalStorageSetItem(COMPANIES_REGISTRY_KEY, JSON.stringify(merged));
  }
  if (typeof office.selected_company === 'string' && office.selected_company.trim()) {
    const current = safeLocalStorageGetItem(SELECTED_COMPANY_KEY);
    if (!current?.trim()) {
      safeLocalStorageSetItem(SELECTED_COMPANY_KEY, office.selected_company.trim());
    }
  }
  if (Array.isArray(office.pricing_companies_registry)) {
    safeLocalStorageSetItem(PRICING_COMPANIES_REGISTRY_KEY, JSON.stringify(office.pricing_companies_registry));
  }
  if (typeof office.pricing_selected_company === 'string' && office.pricing_selected_company.trim()) {
    safeLocalStorageSetItem(PRICING_SELECTED_COMPANY_KEY, office.pricing_selected_company.trim());
  }
  for (const key of ['simulador_contracts', 'simulador_parcelamentos', 'simulador_aplicacoes'] as const) {
    const val = office[key as keyof OfficeData];
    if (Array.isArray(val)) {
      safeLocalStorageSetItem(key, JSON.stringify(val));
    }
  }
  // extra_storage: aplica chaves contabilfacil_* e extratoVision_*
  if (office.extra_storage && typeof office.extra_storage === 'object') {
    for (const [key, value] of Object.entries(office.extra_storage)) {
      if (value === undefined || value === null) continue;
      // Extrato pastas: mescla — nunca sobrescreve dados locais mais recentes
      if (key.includes('_extrato_pastas_v1') && Array.isArray(value)) {
        const localRaw = safeLocalStorageGetItem(key);
        let localItems: unknown[] = [];
        try {
          const parsed = localRaw ? (JSON.parse(localRaw) as unknown) : null;
          if (Array.isArray(parsed)) localItems = parsed;
        } catch { /* ignore */ }
        if (localItems.length > 0) {
          const serverIds = new Set(
            (value as Array<Record<string, unknown>>)
              .map((i) => String(i.id || ''))
              .filter(Boolean),
          );
          const onlyLocal = (localItems as Array<Record<string, unknown>>).filter(
            (li) => li.id && !serverIds.has(String(li.id)),
          );
          const merged = [...(value as Array<Record<string, unknown>>), ...onlyLocal];
          safeLocalStorageSetItem(key, JSON.stringify(merged));
          continue;
        }
      }
      // Regras de contas, sem-nota, cache e demais chaves contabilfacil_*:
      // só preenche se não houver dado local — preserva trabalho recém-salvo.
      const localRaw = safeLocalStorageGetItem(key);
      if (localRaw != null && localRaw.trim() && localRaw.trim() !== '[]') continue;
      const raw = typeof value === 'string' ? value : JSON.stringify(value);
      safeLocalStorageSetItem(key, raw);
    }
  }
}

/**
 * Aplica dados de manager (empresa) vindos do servidor.
 * force=true: sobrescreve mesmo que já exista dado em memória.
 * force=false (padrão): local wins — só preenche chaves vazias, preservando
 * edições ainda não sincronizadas com o servidor.
 */
function applyManagerData(manager: ManagerData, force = false): void {
  const slug = canonicalCompanyStorageSlug(String(manager.company_slug || '').trim());
  if (!slug || !manager.data) return;
  const companyName = String(manager.company_name || '').trim() || slug.replace(/_/g, ' ');
  for (const suffix of MANAGER_DATA_SUFFIXES) {
    const rows = manager.data[suffix];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const key = companyManagerStorageKey(companyName, suffix);
    if (!force) {
      // Só aplica se não houver dado local — preserva trabalho não sincronizado.
      const existing = safeLocalStorageGetItem(key);
      if (existing != null && existing.trim() && existing.trim() !== '[]') continue;
    }
    safeLocalStorageSetItem(key, JSON.stringify(rows));
    setManagerMemoryCacheEntry(key, rows);
  }
}

export default function EyeVisionCloudBootstrap() {
  const hydratedRef = useRef(false);

  useEffect(() => {
    const cleanup = registerEyeVisionAutoSaveLifecycle();

    // Só hidrata uma vez por sessão (React StrictMode chama efeito duas vezes em dev)
    if (hydratedRef.current) {
      return cleanup;
    }
    hydratedRef.current = true;

    void (async () => {
      try {
        // 1. Verifica o modo de storage configurado
        const cfgRes = await fetch(`${AGENT_API_BASE}/storage/folder-config`).catch(() => null);
        const cfg = cfgRes?.ok ? await cfgRes.json().catch(() => null) : null;
        const mode: string = cfg?.mode ?? 'docker';

        // 2. Escolhe a rota de restore conforme o modo configurado.
        type RestorePayload = {
          ok?: boolean;
          office?: OfficeData;
          managers?: ManagerData[];
          extratoPastas?: Record<string, unknown[]>;
        };

        async function tryRestore(url: string): Promise<RestorePayload | null> {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3000); // 3s timeout
            const res = await fetch(url, {
              signal: controller.signal,
              headers: {
                // Aceita resposta comprimida (reduz ~70-80% de banda)
                'Accept-Encoding': 'gzip, deflate, br',
              }
            });
            clearTimeout(timeout);
            if (!res.ok) return null;
            const payload = (await res.json()) as RestorePayload;
            if (!payload?.ok) return null;
            return payload;
          } catch {
            return null;
          }
        }

        function isEmptyPayload(p: RestorePayload | null): boolean {
          if (!p?.office) return true;
          const companies = Array.isArray(p.office.companies_registry) ? p.office.companies_registry.length : 0;
          const managersCount = Array.isArray(p.managers) ? p.managers.length : 0;
          return companies === 0 && managersCount === 0;
        }

        let payload: RestorePayload | null = null;
        let successBackend = '';

        // ========== ESTRATÉGIA DE FALLBACK AUTOMÁTICO ==========
        // 1. Tenta o modo configurado
        // 2. Se falhar, tenta Supabase (fallback para deploy)
        // 3. Se Supabase falhar, tenta Docker
        // 4. Se todos falharem, usa dados locais do localStorage

        if (mode === 'supabase') {
          // Modo Supabase — tenta Supabase, depois Docker como fallback
          payload = await tryRestore(`${AGENT_API_BASE}/storage/restore-from-supabase`);
          if (payload) successBackend = 'supabase';

          if (!payload) {
            console.warn('[Bootstrap] Supabase falhou, tentando Docker como fallback...');
            payload = await tryRestore(`${AGENT_API_BASE}/storage/restore-from-docker-direct`);
            if (payload) successBackend = 'docker (fallback)';
          }
        } else if (mode === 'docker' || !mode) {
          // Modo Docker (padrão) — tenta Docker, depois Supabase como fallback
          payload = await tryRestore(`${AGENT_API_BASE}/storage/restore-from-docker-direct`);
          if (payload) successBackend = 'docker';

          // Durante deploy, Docker pode estar down — fallback automático para Supabase
          if (!payload) {
            console.warn('[Bootstrap] Docker falhou (deploy?), tentando Supabase como fallback...');
            payload = await tryRestore(`${AGENT_API_BASE}/storage/restore-from-supabase`);
            if (payload) successBackend = 'supabase (fallback deploy)';
          }
        } else if (mode === 'pasta' || mode === 'pasta-local') {
          // Modo Pasta Local — tenta pasta, depois Docker, depois Supabase
          payload = await tryRestore(`${AGENT_API_BASE}/storage/restore-from-postgres-minio`);
          if (payload) successBackend = 'local-folder';

          if (!payload) {
            console.warn('[Bootstrap] Pasta Local falhou, tentando Docker...');
            payload = await tryRestore(`${AGENT_API_BASE}/storage/restore-from-docker-direct`);
            if (payload) successBackend = 'docker (fallback)';
          }

          if (!payload) {
            console.warn('[Bootstrap] Docker falhou, tentando Supabase...');
            payload = await tryRestore(`${AGENT_API_BASE}/storage/restore-from-supabase`);
            if (payload) successBackend = 'supabase (fallback)';
          }
        }

        // Se todos os fallbacks falharem, usar dados locais do localStorage
        if (!payload) {
          console.warn('[Bootstrap] Nenhum backend respondeu. Usando dados locais do localStorage.');
          successBackend = 'localStorage (offline)';
          // Não retorna — continua com dados locais existentes
        } else {
          console.info(`[Bootstrap] ✅ Dados carregados de: ${successBackend}`);
        }

        // 4. Aplica office data (se payload existe)
        // NÃO purga o localStorage antes de hidratar: uma edição feita nos
        // segundos anteriores ao F5 pode ainda não ter sido confirmada no
        // servidor (auto-save roda a cada 60s / debounce de 2.5s), e o
        // beforeunload não espera o fetch assíncrono terminar. Purgar aqui
        // apagaria essa edição e o passo seguinte a substituiria pelo
        // snapshot antigo do servidor — perda de dados no F5.
        if (payload?.office) {
          applyOfficeData(payload.office);
        }

        // 5. Aplica manager data (plano, extrato, razão, etc.)
        // force=false: dado local (possivelmente ainda não sincronizado)
        // sempre ganha do snapshot do servidor — só preenche chaves vazias.
        if (Array.isArray(payload?.managers)) {
          for (const mgr of payload.managers) {
            applyManagerData(mgr, false);
          }
        }

        // 6. Aplica extratoPastas por empresa
        if (payload?.extratoPastas && typeof payload.extratoPastas === 'object') {
          for (const [slug, pastas] of Object.entries(payload.extratoPastas)) {
            if (!Array.isArray(pastas) || pastas.length === 0) continue;
            // Chave usada por TabLauncher / ModuleShell
            const storageKey = `contabilfacil_${slug}_extrato_pastas_v1`;
            const localRaw = safeLocalStorageGetItem(storageKey);
            let localItems: unknown[] = [];
            try {
              const parsed = localRaw ? (JSON.parse(localRaw) as unknown) : null;
              if (Array.isArray(parsed)) localItems = parsed;
            } catch { /* ignore */ }
            if (localItems.length === 0) {
              safeLocalStorageSetItem(storageKey, JSON.stringify(pastas));
            } else {
              const serverIds = new Set(
                pastas.map((i) => String((i as Record<string, unknown>).id ?? '')).filter(Boolean),
              );
              const onlyLocal = (localItems as Array<Record<string, unknown>>).filter(
                (li) => li.id && !serverIds.has(String(li.id)),
              );
              safeLocalStorageSetItem(storageKey, JSON.stringify([...pastas, ...onlyLocal]));
            }
          }
        }

        // 7. Invalida cache de manager para forçar releitura
        invalidateManagerDataCache();

        // 8. Libera o salvamento — agora que os dados foram carregados, pode salvar
        markHydrationComplete();

        console.info(`[Bootstrap] ✅ Hydrate concluído (${successBackend})`);
      } catch (err) {
        console.warn('[Bootstrap] Erro ao hidratar do Docker:', err instanceof Error ? err.message : err);
      } finally {
        // Sempre marca hidratação completa — mesmo se o restore falhou (app continua com dados locais)
        markHydrationComplete();
        // Sempre dispara o evento — mesmo se o restore falhou (app continua com dados locais)
        window.dispatchEvent(new CustomEvent('contabilfacil:data-hydrated'));
      }
    })();

    return cleanup;
  }, []);

  return null;
}
