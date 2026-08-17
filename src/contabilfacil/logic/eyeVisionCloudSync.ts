/**
 * Coleta/aplicação de dados locais — sem sincronização remota.
 * As funções de coleta são usadas por TabLauncher e ModuleShell.
 */
import {
  listMemoryFallbackEntries,
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
} from '../../lib/safeLocalStorage';
import {
  COMPANIES_REGISTRY_KEY,
  DELETED_COMPANIES_KEY,
  SELECTED_COMPANY_KEY,
  MANAGER_DATA_SUFFIXES,
  companyManagerStorageKey,
  companyStorageSlug,
  canonicalCompanyStorageSlug,
  findCompanyRecordByStorageSlug,
  listManagerCacheSlugs,
  loadCompaniesRegistry,
  loadDeletedCompanies,
  normalizeCompanyName,
  readManagerData,
  type CompanyRecord,
  type DeletedCompanyRecord,
} from './companyWorkspace';
import { PRICING_STORAGE_KEY } from './pricingStorage';
import {
  PRICING_COMPANIES_REGISTRY_KEY,
  PRICING_SELECTED_COMPANY_KEY,
  loadPricingCompaniesRegistry,
  loadPricingSelectedCompanyName,
} from './pricingCompanyWorkspace';
import {
  SIMULADOR_CANONICAL_STORAGE_KEYS,
  SIMULADOR_EXTRA_STORAGE_KEYS,
  readOperationalStorageParsed,
} from '../../lib/simuladorFullBackup';

export const EYE_VISION_CLOUD_HYDRATED_EVENT = 'contabilfacil:data-hydrated';

type OfficeCloudPayload = {
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

type ManagerCloudPayload = {
  company_slug?: string;
  company_name?: string;
  data?: Partial<Record<(typeof MANAGER_DATA_SUFFIXES)[number], unknown[]>>;
  updated_at?: string;
};

/** Chaves contabilfacil_{slug}_{suffix} vão para manager, não extra_storage. */
export function isContabilfacilManagerDataKey(key: string): boolean {
  if (!key.startsWith('contabilfacil_')) return false;
  const rest = key.slice('contabilfacil_'.length);
  return MANAGER_DATA_SUFFIXES.some((suffix) => rest.endsWith(`_${suffix}`));
}

const OFFICE_EXPLICIT_STORAGE_KEYS = new Set([
  COMPANIES_REGISTRY_KEY,
  DELETED_COMPANIES_KEY,
  SELECTED_COMPANY_KEY,
  PRICING_COMPANIES_REGISTRY_KEY,
  PRICING_SELECTED_COMPANY_KEY,
  'simulador_contracts',
  'simulador_parcelamentos',
  'simulador_aplicacoes',
  PRICING_STORAGE_KEY,
]);

export function collectLocalOfficePayload(): OfficeCloudPayload {
  const storage: Record<string, unknown> = {};
  for (const key of [...SIMULADOR_CANONICAL_STORAGE_KEYS, ...SIMULADOR_EXTRA_STORAGE_KEYS, PRICING_STORAGE_KEY]) {
    const value = readOperationalStorageParsed(key);
    if (value !== undefined) storage[key] = value;
  }

  const extra: Record<string, unknown> = {};
  const keys = new Set<string>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) keys.add(key);
    }
  } catch { /* ignore */ }
  for (const [key] of listMemoryFallbackEntries()) keys.add(key);

  for (const key of keys) {
    if (OFFICE_EXPLICIT_STORAGE_KEYS.has(key)) continue;
    if (isContabilfacilManagerDataKey(key)) continue;
    if (!key.startsWith('contabilfacil_') && !key.startsWith('gc_') && !key.startsWith('extratoVision_')) {
      continue;
    }
    if (key.includes('password') || key.includes('secret')) continue;
    const value = readOperationalStorageParsed(key);
    if (value !== undefined) extra[key] = value;
  }

  return {
    companies_registry: loadCompaniesRegistry(),
    deleted_companies: loadDeletedCompanies(),
    selected_company: safeLocalStorageGetItem(SELECTED_COMPANY_KEY) || '',
    pricing_companies_registry: loadPricingCompaniesRegistry(),
    pricing_selected_company: loadPricingSelectedCompanyName(),
    simulador_contracts: (storage.simulador_contracts as unknown[]) ?? [],
    simulador_parcelamentos: (storage.simulador_parcelamentos as unknown[]) ?? [],
    simulador_aplicacoes: (storage.simulador_aplicacoes as unknown[]) ?? [],
    simulador_precificacao: (storage[PRICING_STORAGE_KEY] as unknown[]) ?? [],
    extra_storage: extra,
  };
}

export function collectLocalManagerPayload(companySlug: string, companyName?: string): ManagerCloudPayload {
  const slug = canonicalCompanyStorageSlug(companySlug.trim());
  let resolvedName = companyName?.trim() || '';
  if (!resolvedName) {
    resolvedName = findCompanyRecordByStorageSlug(slug)?.name || slug.replace(/_/g, ' ');
  }
  resolvedName = normalizeCompanyName(resolvedName);

  const data: Partial<Record<(typeof MANAGER_DATA_SUFFIXES)[number], unknown[]>> = {};
  for (const suffix of MANAGER_DATA_SUFFIXES) {
    const list = readManagerData(resolvedName, suffix);
    if (list.length > 0) data[suffix] = list;
  }

  return { company_slug: slug, company_name: resolvedName, data };
}

export function listLocalManagerSlugs(): string[] {
  const slugs = new Set<string>();
  const prefix = 'contabilfacil_';
  const keys = new Set<string>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) keys.add(key);
    }
  } catch { /* ignore */ }
  for (const [key] of listMemoryFallbackEntries()) {
    if (key.startsWith(prefix)) keys.add(key);
  }
  for (const key of keys) {
    const rest = key.slice(prefix.length);
    const match = rest.match(/^(.+)_(plano|extrato|folha|folhaRelatorio|razao|balancete|fiscalSped|fiscalPgdas|fiscalOcr|fiscalNfe|fiscalContasImposto|folhaContasAutomacao|honorariosLancamentos|honorariosContasAutomacao)$/);
    if (match?.[1]) slugs.add(canonicalCompanyStorageSlug(match[1]));
  }
  for (const slug of listManagerCacheSlugs()) {
    slugs.add(canonicalCompanyStorageSlug(slug));
  }
  for (const company of loadCompaniesRegistry()) {
    slugs.add(canonicalCompanyStorageSlug(company.name));
  }
  return Array.from(slugs).filter(Boolean);
}

/** No-op — sem backend remoto. */
export function isCloudHydrateReady(): boolean {
  return true;
}

/** No-op — sem backend remoto. */
export async function hydrateEyeVisionFromCloud(
  _officeToken: string,
  _uid: string,
): Promise<boolean> {
  return false;
}

/** No-op — sem backend remoto. */
export function configureEyeVisionCloudSync(_officeToken: string, _uid: string): void {
  /* sem sincronização remota */
}

/** No-op — sem backend remoto. */
export function scheduleEyeVisionCloudPush(): void {
  /* sem sincronização remota */
}

/** No-op — sem backend remoto. */
export async function flushEyeVisionCloudPush(_options?: { force?: boolean }): Promise<void> {
  /* sem sincronização remota */
}

/** No-op — sem backend remoto. */
export async function purgeCompanyFromCloudImmediately(_companyName: string): Promise<void> {
  /* sem sincronização remota */
}

export function isEyeVisionCloudPushPaused(): boolean {
  return false;
}

export function isFirestoreQuotaError(_err: unknown): boolean {
  return false;
}

/**
 * Aplica dados recuperados do PostgreSQL/MinIO ou do JSON de backup no localStorage,
 * sem precisar de nenhum agente de sincronização automático.
 * Após chamar esta função, recarregue a página para o app refletir os dados.
 */
export function hydrateOfficeFromRestoreResult(
  office: Record<string, unknown>,
  managers: Array<{ company_slug: string; company_name?: string; data?: Record<string, unknown[]> }>,
): void {
  // Campos explícitos do office
  const fieldMap: Record<string, string> = {
    companies_registry:        COMPANIES_REGISTRY_KEY,
    deleted_companies:         DELETED_COMPANIES_KEY,
    selected_company:          SELECTED_COMPANY_KEY,
    pricing_companies_registry: PRICING_COMPANIES_REGISTRY_KEY,
    pricing_selected_company:   PRICING_SELECTED_COMPANY_KEY,
  };
  for (const [field, storageKey] of Object.entries(fieldMap)) {
    const v = office[field];
    if (v !== undefined && v !== null) {
      safeLocalStorageSetItem(storageKey, typeof v === 'string' ? v : JSON.stringify(v));
    }
  }

  // Simulador & pricing
  const simFields: Record<string, string> = {
    simulador_contracts:    'simulador_contracts',
    simulador_parcelamentos: 'simulador_parcelamentos',
    simulador_aplicacoes:   'simulador_aplicacoes',
    simulador_precificacao: 'simulador_precificacao_v1',
  };
  for (const [field, storageKey] of Object.entries(simFields)) {
    const v = office[field];
    if (Array.isArray(v)) {
      safeLocalStorageSetItem(storageKey, JSON.stringify(v));
    }
  }

  // extra_storage — chaves arbitrárias (contabilfacil_*, extratoVision_*, gc_*)
  const extra = office.extra_storage as Record<string, unknown> | undefined;
  if (extra && typeof extra === 'object') {
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined && value !== null) {
        safeLocalStorageSetItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      }
    }
  }

  // Dados dos managers (por empresa/slug)
  for (const manager of managers) {
    const slug = String(manager.company_slug || '').trim();
    if (!slug) continue;
    const data = manager.data;
    if (!data || typeof data !== 'object') continue;
    for (const [suffix, rows] of Object.entries(data)) {
      if (Array.isArray(rows)) {
        const key = `contabilfacil_${slug}_${suffix}`;
        safeLocalStorageSetItem(key, JSON.stringify(rows));
      }
    }
  }
}
