import { getDeployDataBundle } from '../../lib/deployDataBundle';
import { generateUUID } from '../../lib/uuid';
import { loadContractsFromBrowserStorage, saveContractsToBrowserStorage } from '../../lib/savedContractStorage';
import { loadAplicacoesFromBrowserStorage } from './aplicacaoStorage';
import { loadParcelamentosFromBrowserStorage } from './parcelamentoStorage';
import { persistCanonicalList } from '../../lib/simuladorBrowserStorage';
import {
  safeLocalStorageGetItem,
  safeLocalStorageRemoveItem,
  safeLocalStorageSetItem,
} from '../../lib/safeLocalStorage';
import { repairPortugueseDeep } from '../../lib/repairPortugueseText';
import { scheduleEyeVisionOperationalSave } from './eyeVisionOperationalSave';

export const COMPANIES_REGISTRY_KEY = 'contabilfacil_companies_registry_v1';
export const DELETED_COMPANIES_KEY = 'contabilfacil_deleted_companies_v1';
export const SELECTED_COMPANY_KEY = 'contabilfacil_selected_company_v1';
export const MANAGER_MIGRATION_FLAG = 'contabilfacil_manager_migrated_v1';
export const PARCELAMENTO_MIGRATION_FLAG = 'contabilfacil_parcelamento_company_migrated_v1';
export const APLICACAO_MIGRATION_FLAG = 'contabilfacil_aplicacao_sindicato_migrated_v2';

export interface CompanyRecord {
  id: string;
  name: string;
  createdAt: string;
}

export interface DeletedCompanyRecord {
  name: string;
  slug: string;
  deletedAt: string;
}

/** Empresa demo — nunca deve sobrescrever o office no Docker. */
export const DEMO_TECHNOVA_NAME = 'TECHNOVA INDÚSTRIA LTDA';

export function isDemoTechnovaCompany(name: string): boolean {
  const n = normalizeCompanyName(name);
  return n === DEMO_TECHNOVA_NAME || companyStorageSlug(n) === 'TECHNOVA_INDUSTRIA_LTDA';
}

function parseDeletedCompanyRows(rows: unknown[]): DeletedCompanyRecord[] {
  return rows
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const r = row as Record<string, unknown>;
      const name = normalizeCompanyName(String(r.name ?? ''));
      const slug = String(r.slug ?? '').trim() || companyStorageSlug(name);
      if (!name || !slug) return null;
      return {
        name,
        slug,
        deletedAt: String(r.deletedAt ?? new Date().toISOString()),
      } satisfies DeletedCompanyRecord;
    })
    .filter((row): row is DeletedCompanyRecord => row != null);
}

export function loadDeletedCompanies(): DeletedCompanyRecord[] {
  try {
    const raw = safeLocalStorageGetItem(DELETED_COMPANIES_KEY);
    if (!raw?.trim()) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parseDeletedCompanyRows(parsed);
  } catch {
    return [];
  }
}

export function mergeDeletedCompaniesRecords(...lists: DeletedCompanyRecord[][]): DeletedCompanyRecord[] {
  const bySlug = new Map<string, DeletedCompanyRecord>();
  for (const list of lists) {
    for (const item of list) {
      const name = normalizeCompanyName(item?.name ?? '');
      const slug = String(item?.slug ?? '').trim() || companyStorageSlug(name);
      if (!name || !slug) continue;
      const prev = bySlug.get(slug);
      if (!prev || String(item.deletedAt) > String(prev.deletedAt)) {
        bySlug.set(slug, { name, slug, deletedAt: String(item.deletedAt || new Date().toISOString()) });
      }
    }
  }
  return Array.from(bySlug.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
}

export function saveDeletedCompanies(list: DeletedCompanyRecord[]): void {
  const merged = mergeDeletedCompaniesRecords(list);
  safeLocalStorageSetItem(DELETED_COMPANIES_KEY, JSON.stringify(merged));
  scheduleEyeVisionOperationalSave();
}

export function recordCompanyDeletion(name: string): void {
  const norm = normalizeCompanyName(name);
  if (!norm || norm === 'SEM EMPRESA') return;
  const slug = companyStorageSlug(norm);
  saveDeletedCompanies([
    ...loadDeletedCompanies(),
    { name: norm, slug, deletedAt: new Date().toISOString() },
  ]);
}

/** Remove marcação de exclusão quando a empresa volta ao cadastro. */
export function clearCompanyDeletion(nameOrSlug: string): void {
  const norm = normalizeCompanyName(nameOrSlug);
  const slug = companyStorageSlug(nameOrSlug);
  const next = loadDeletedCompanies().filter((item) => item.name !== norm && item.slug !== slug);
  if (next.length !== loadDeletedCompanies().length) {
    saveDeletedCompanies(next);
  }
}

function countManagerDataForCompany(name: string): number {
  let score = 0;
  for (const suffix of MANAGER_DATA_SUFFIXES) {
    if (readManagerData(name, suffix).length > 0) score += 1;
  }
  const pastasKey = `contabilfacil_${canonicalCompanyStorageSlug(name)}_extrato_pastas_v1`;
  const pastasRaw = safeLocalStorageGetItem(pastasKey);
  if (pastasRaw && pastasRaw.length > 2 && pastasRaw !== '[]') score += 2;
  return score;
}

/** Escolhe o melhor rótulo quando há nomes diferentes com o mesmo slug de armazenamento. */
export function pickCanonicalCompanyName(candidates: string[]): string {
  const unique = [...new Set(candidates.map((name) => normalizeCompanyName(name)).filter(Boolean))];
  if (unique.length === 0) return '';
  if (unique.length === 1) return unique[0];

  const selected = loadSelectedCompanyName();
  const selectedMatch = unique.find((name) => name === selected);
  if (selectedMatch) return selectedMatch;

  const ranked = unique
    .map((name) => ({
      name,
      dataScore: countManagerDataForCompany(name),
      accentScore: (name.match(/[À-ÿ]/g) || []).length,
      length: name.length,
    }))
    .sort(
      (a, b) =>
        b.dataScore - a.dataScore ||
        b.accentScore - a.accentScore ||
        b.length - a.length ||
        a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }),
    );

  return ranked[0]?.name ?? unique[0];
}

/** Une registros que colidem no mesmo slug (ex.: POLO SUL CLIMATIZAÇAO / CLIMATIZAÇÃO). */
export function dedupeCompaniesBySlug(list: CompanyRecord[]): CompanyRecord[] {
  const bySlug = new Map<string, CompanyRecord[]>();
  for (const item of list) {
    const name = normalizeCompanyName(item.name);
    if (!name || isDemoTechnovaCompany(name)) continue;
    const slug = canonicalCompanyStorageSlug(name);
    if (!slug) continue;
    const group = bySlug.get(slug) ?? [];
    group.push({ ...item, name });
    bySlug.set(slug, group);
  }

  const result: CompanyRecord[] = [];
  for (const group of bySlug.values()) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }
    const canonicalName = pickCanonicalCompanyName(group.map((item) => item.name));
    // createdAt pode faltar em registros antigos/migrados — sort não pode quebrar
    // a hidratação inteira por causa disso (undefined.localeCompare lançava aqui).
    const oldest = [...group].sort((a, b) =>
      String(a.createdAt || '').localeCompare(String(b.createdAt || '')),
    )[0];
    result.push({ ...oldest, name: canonicalName });
  }

  return result.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
}

/** Empresas ativas não podem permanecer na lista de excluídas (evita sumir extrato/plano). */
export function reconcileDeletedCompaniesWithRegistry(registry?: CompanyRecord[]): void {
  const companies = registry ?? loadCompaniesRegistry();
  const activeSlugs = new Set(companies.map((c) => canonicalCompanyStorageSlug(c.name)));
  const activeNames = new Set(companies.map((c) => normalizeCompanyName(c.name)));
  const kept = loadDeletedCompanies().filter(
    (item) => !activeSlugs.has(item.slug) && !activeNames.has(item.name),
  );
  if (kept.length !== loadDeletedCompanies().length) {
    saveDeletedCompanies(kept);
  }
}

export function isCompanyDeleted(nameOrSlug: string): boolean {
  const norm = normalizeCompanyName(nameOrSlug);
  const slug = companyStorageSlug(nameOrSlug);
  return loadDeletedCompanies().some((item) => item.name === norm || item.slug === slug);
}

export function filterOutDeletedCompanies(list: CompanyRecord[]): CompanyRecord[] {
  return list.filter((item) => !isCompanyDeleted(item.name));
}

export function mergeCompaniesRegistryLists(...lists: CompanyRecord[][]): CompanyRecord[] {
  const byName = new Map<string, CompanyRecord>();
  for (const list of lists) {
    for (const item of list) {
      const name = normalizeCompanyName(item?.name ?? '');
      if (!name || isDemoTechnovaCompany(name) || isCompanyDeleted(name)) continue;
      if (!byName.has(name)) {
        byName.set(name, {
          id: String(item.id || crypto.randomUUID()),
          name,
          createdAt: String(item.createdAt || new Date().toISOString()),
        });
      }
    }
  }
  return dedupeCompaniesBySlug(
    Array.from(byName.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }),
    ),
  );
}

const LEGACY_MANAGER_KEYS = {
  plano: 'plano_contas_central',
  extrato: 'extrato_lancamentos',
  folha: 'folha_payroll_central',
  folhaRelatorio: 'folha_relatorio_lancamentos',
  razao: 'razao_lancamentos',
  balancete: 'balancete_rows',
  fiscalSped: 'fiscal_sped_import',
  fiscalPgdas: 'fiscal_pgdas_import',
  fiscalOcr: 'fiscal_ocr_relatorio',
  fiscalNfe: 'fiscal_nfe_cache',
  fiscalContasImposto: 'fiscal_contas_imposto',
  fiscalCfopDescricoes: 'fiscal_cfop_descricoes',
  folhaContasAutomacao: 'folha_contas_automacao',
  folhaRegras: 'folha_regras',
  honorariosLancamentos: 'honorarios_lancamentos',
  honorariosContasAutomacao: 'honorarios_contas_automacao',
  spedParserProData: 'sped_parser_pro_data',
  custos: 'custos_faturamento',
  loans: 'loans_contracts',
} as const;

export function normalizeCompanyName(name: string): string {
  return String(name ?? '').trim().replace(/\s+/g, ' ').toUpperCase() || 'SEM EMPRESA';
}

export function companyStorageSlug(companyName: string): string {
  return normalizeCompanyName(companyName)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

/** Variantes de slug que apontam para o mesmo conjunto de dados no Postgres. */
export const COMPANY_STORAGE_SLUG_ALIASES: Record<string, string> = {
  POLO_SUL_CLIMATIZA_AO: 'POLO_SUL_CLIMATIZACAO',
};

export function canonicalCompanyStorageSlug(companyNameOrSlug: string): string {
  const raw = String(companyNameOrSlug || '').trim();
  const slug = /^[A-Z0-9_]+$/.test(raw) ? raw : companyStorageSlug(raw);
  return COMPANY_STORAGE_SLUG_ALIASES[slug] || slug;
}

export function isCompanySlugInAllowedSet(slug: string, allowedSlugs: Set<string>): boolean {
  const canonical = canonicalCompanyStorageSlug(slug);
  if (allowedSlugs.has(canonical)) return true;
  if (allowedSlugs.has(slug)) return true;
  for (const [alias, target] of Object.entries(COMPANY_STORAGE_SLUG_ALIASES)) {
    if (target === canonical && allowedSlugs.has(alias)) return true;
  }
  return false;
}

export function companyManagerStorageKey(companyName: string, suffix: keyof typeof LEGACY_MANAGER_KEYS): string {
  const slug = canonicalCompanyStorageSlug(companyName);
  return `contabilfacil_${slug}_${suffix}`;
}

/** Nome normalizado da empresa — obrigatório para leitura/gravação isolada por empresa. */
export function requireCompanyScope(companyName: string): string {
  const norm = normalizeCompanyName(companyName);
  if (!norm || norm === 'SEM EMPRESA') {
    throw new Error('Empresa inválida — plano, regras e dados gerenciais são exclusivos por empresa.');
  }
  return norm;
}

export const MANAGER_DATA_SUFFIXES = Object.keys(LEGACY_MANAGER_KEYS) as (keyof typeof LEGACY_MANAGER_KEYS)[];

function parseCompaniesRows(rows: unknown[]): CompanyRecord[] {
  return rows
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const r = row as Record<string, unknown>;
      const name = normalizeCompanyName(String(r.name ?? ''));
      if (!name) return null;
      return {
        id: String(r.id ?? generateUUID()),
        name,
        createdAt: String(r.createdAt ?? new Date().toISOString()),
      } satisfies CompanyRecord;
    })
    .filter((row): row is CompanyRecord => row != null);
}

function loadBundledDeployCompanies(): CompanyRecord[] {
  return parseCompaniesRows(getDeployDataBundle().companies as unknown[]);
}

export function loadCompaniesRegistry(): CompanyRecord[] {
  let local: CompanyRecord[] = [];
  try {
    const raw = safeLocalStorageGetItem(COMPANIES_REGISTRY_KEY);
    if (raw?.trim()) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) local = parseCompaniesRows(parsed);
    }
  } catch {
    local = [];
  }

  const bundled = loadBundledDeployCompanies();
  const map = new Map<string, CompanyRecord>();
  for (const item of bundled) map.set(item.name, item);
  for (const item of local) map.set(item.name, item);
  return filterOutDeletedCompanies(Array.from(map.values()));
}

export function saveCompaniesRegistry(
  list: CompanyRecord[],
  options?: { replace?: boolean },
): void {
  const incoming = mergeCompaniesRegistryLists(list);
  const existing = mergeCompaniesRegistryLists(loadCompaniesRegistry());

  if (options?.replace) {
    if (incoming.length === 0 && existing.length === 0) return;
    safeLocalStorageSetItem(COMPANIES_REGISTRY_KEY, JSON.stringify(incoming));
    scheduleEyeVisionOperationalSave();
    return;
  }

  // Nunca substitui 2+ empresas reais por lista menor (ex.: só TECHNOVA após hydrate parcial).
  const merged =
    incoming.length >= existing.length
      ? mergeCompaniesRegistryLists(incoming, existing)
      : mergeCompaniesRegistryLists(existing, incoming);
  if (merged.length === 0 && existing.length === 0) return;
  safeLocalStorageSetItem(COMPANIES_REGISTRY_KEY, JSON.stringify(merged));
  scheduleEyeVisionOperationalSave();
}

export function loadSelectedCompanyName(): string {
  const stored = safeLocalStorageGetItem(SELECTED_COMPANY_KEY);
  if (stored?.trim()) return normalizeCompanyName(stored);
  return '';
}

export function saveSelectedCompanyName(name: string): void {
  safeLocalStorageSetItem(SELECTED_COMPANY_KEY, normalizeCompanyName(name));
  scheduleEyeVisionOperationalSave();
}

export function discoverCompanyNamesFromStorage(): string[] {
  const names = new Set<string>();

  for (const contract of loadContractsFromBrowserStorage()) {
    const name = normalizeCompanyName(contract.companyName);
    if (!isCompanyDeleted(name)) names.add(name);
  }

  for (const app of loadAplicacoesFromBrowserStorage()) {
    if (app.sindicatoName?.trim()) {
      const name = normalizeCompanyName(app.sindicatoName);
      if (!isCompanyDeleted(name)) names.add(name);
    }
  }

  for (const parcel of loadParcelamentosFromBrowserStorage()) {
    const scoped = (parcel as { companyName?: string }).companyName;
    if (scoped?.trim()) {
      const name = normalizeCompanyName(scoped);
      if (!isCompanyDeleted(name)) names.add(name);
    }
  }

  for (const slug of listManagerCacheSlugs()) {
    if (slug === 'TECHNOVA_INDUSTRIA_LTDA' || isCompanyDeleted(slug)) continue;
    const fromExisting = loadCompaniesRegistry().find(
      (c) => canonicalCompanyStorageSlug(c.name) === canonicalCompanyStorageSlug(slug),
    );
    const label = fromExisting?.name || slug.replace(/_/g, ' ');
    const norm = normalizeCompanyName(label);
    if (!isCompanyDeleted(norm)) names.add(norm);
  }

  return Array.from(names).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
}

function discoverCompanyNamesFromManagerSlugs(includeDeletedSlugs = false): string[] {
  const names = new Set<string>();
  for (const slug of listManagerCacheSlugs()) {
    if (slug === 'TECHNOVA_INDUSTRIA_LTDA') continue;
    if (!includeDeletedSlugs && isCompanyDeleted(slug)) continue;
    const label = slug.replace(/_/g, ' ');
    const norm = normalizeCompanyName(label);
    if (norm) names.add(norm);
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
}

export function syncCompanyRegistry(): CompanyRecord[] {
  const existing = loadCompaniesRegistry();
  const byName = new Map(existing.map((c) => [c.name, c]));

  for (const name of discoverCompanyNamesFromStorage()) {
    if (byName.has(name)) continue;
    byName.set(name, {
      id: generateUUID(),
      name,
      createdAt: new Date().toISOString(),
    });
  }

  const deduped = dedupeCompaniesBySlug(Array.from(byName.values()));
  reconcileDeletedCompaniesWithRegistry(deduped);
  const merged = filterOutDeletedCompanies(
    deduped.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })),
  );

  // Não grava/push lista vazia — evita apagar o Docker antes do hydrate.
  if (merged.length > 0 || existing.length > 0) {
    saveCompaniesRegistry(merged);
  }
  return merged;
}

export function repairCompanyWorkspaceState(): CompanyRecord[] {
  let local: CompanyRecord[] = [];
  try {
    const raw = safeLocalStorageGetItem(COMPANIES_REGISTRY_KEY);
    if (raw?.trim()) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) local = parseCompaniesRows(parsed);
    }
  } catch {
    local = [];
  }

  const bundled = loadBundledDeployCompanies();
  const discovered = [
    ...discoverCompanyNamesFromStorage(),
    ...discoverCompanyNamesFromManagerSlugs(true),
  ].map((name) => createCompanyRecord(name));
  const deduped = dedupeCompaniesBySlug(mergeCompaniesRegistryLists(bundled, local, discovered));
  reconcileDeletedCompaniesWithRegistry(deduped);
  const merged = filterOutDeletedCompanies(deduped);
  if (merged.length > 0) {
    saveCompaniesRegistry(merged);
    const selected = resolveSelectedCompany(merged);
    if (selected) saveSelectedCompanyName(selected);
  }
  repairIsolatedManagerStoragePerCompany();
  return merged;
}

export function resolveSelectedCompany(companies: CompanyRecord[]): string {
  const stored = loadSelectedCompanyName();
  if (stored && companies.some((c) => c.name === stored)) {
    return stored;
  }

  const real = companies.filter((c) => !isDemoTechnovaCompany(c.name));
  const fallback = real[0]?.name ?? companies[0]?.name ?? '';
  if (fallback) saveSelectedCompanyName(fallback);
  return fallback;
}

export function createCompanyRecord(name: string): CompanyRecord {
  return {
    id: crypto.randomUUID(),
    name: normalizeCompanyName(name),
    createdAt: new Date().toISOString(),
  };
}

export function belongsToCompany(
  itemCompany: string | undefined,
  selectedCompany: string,
  legacyFallback = false,
): boolean {
  const selected = normalizeCompanyName(selectedCompany);
  const item = normalizeCompanyName(itemCompany ?? '');
  if (item === selected) return true;
  if (!itemCompany?.trim() && legacyFallback) return true;
  return false;
}

export function isSameCompanyScope(a: string, b: string): boolean {
  return normalizeCompanyName(a) === normalizeCompanyName(b);
}

/** Mesma empresa no armazenamento (slug canônico). */
export function isSameCompanyStorageScope(a: string, b: string): boolean {
  const slugA = canonicalCompanyStorageSlug(a);
  const slugB = canonicalCompanyStorageSlug(b);
  return Boolean(slugA && slugB && slugA === slugB);
}

export function findCompanyRecordByStorageSlug(
  slug: string,
  registry: CompanyRecord[] = loadCompaniesRegistry(),
): CompanyRecord | undefined {
  const canonical = canonicalCompanyStorageSlug(slug);
  if (!canonical) return undefined;
  return registry.find((c) => canonicalCompanyStorageSlug(c.name) === canonical);
}

export function belongsToSindicato(
  sindicatoName: string | undefined,
  selectedCompany: string,
  legacyFallback = false,
): boolean {
  return belongsToCompany(sindicatoName, selectedCompany, legacyFallback);
}

export function getAplicacaoFolderName(app: { nomeEmpresa?: string; nomeAplicacao?: string }): string {
  const folder = String(app.nomeEmpresa ?? '').trim();
  if (folder) return folder.toUpperCase();
  const fromName = String(app.nomeAplicacao ?? '').trim();
  if (fromName) return fromName.toUpperCase();
  return 'APLICAÇÕES GERAIS';
}

export function migrateOrphanAplicacoes(defaultSindicato: string): void {
  if (safeLocalStorageGetItem(APLICACAO_MIGRATION_FLAG)) return;

  const all = loadAplicacoesFromBrowserStorage();
  const contractCompanies = new Set(
    loadContractsFromBrowserStorage().map((c) => normalizeCompanyName(c.companyName)),
  );
  let changed = false;
  const fallback = normalizeCompanyName(defaultSindicato);

  const migrated = all.map((item) => {
    if (item.sindicatoName?.trim()) return item;
    changed = true;
    const empresa = normalizeCompanyName(item.nomeEmpresa);
    if (empresa && contractCompanies.has(empresa)) {
      return { ...item, sindicatoName: empresa };
    }
    return { ...item, sindicatoName: fallback };
  });

  if (changed) {
    persistCanonicalList('simulador_aplicacoes', migrated);
  }

  safeLocalStorageSetItem(APLICACAO_MIGRATION_FLAG, '1');
}

export function migrateLegacyManagerData(targetCompany: string): void {
  if (safeLocalStorageGetItem(MANAGER_MIGRATION_FLAG)) return;

  const company = normalizeCompanyName(targetCompany);
  for (const suffix of Object.keys(LEGACY_MANAGER_KEYS) as (keyof typeof LEGACY_MANAGER_KEYS)[]) {
    const legacyKey = LEGACY_MANAGER_KEYS[suffix];
    const raw = safeLocalStorageGetItem(legacyKey);
    if (raw?.trim()) {
      const scopedKey = companyManagerStorageKey(company, suffix);
      if (!safeLocalStorageGetItem(scopedKey)) {
        // ⚠️ DISABLED: Salva SOMENTE no Docker, não em localStorage
        // safeLocalStorageSetItem(scopedKey, raw);
        managerMemoryCache.set(scopedKey, JSON.parse(raw));
        scheduleEyeVisionOperationalSave();
      }
    }
    // Chaves globais legadas (ex.: plano_contas_central) — nunca compartilhar entre empresas.
    safeLocalStorageRemoveItem(legacyKey);
  }

  safeLocalStorageSetItem(MANAGER_MIGRATION_FLAG, '1');
}

export function migrateOrphanParcelamentos(defaultCompany: string): void {
  if (safeLocalStorageGetItem(PARCELAMENTO_MIGRATION_FLAG)) return;

  const all = loadParcelamentosFromBrowserStorage();
  let changed = false;
  const company = normalizeCompanyName(defaultCompany);

  const migrated = all.map((item) => {
    const scoped = (item as { companyName?: string }).companyName;
    if (scoped?.trim()) return item;
    changed = true;
    return { ...item, companyName: company };
  });

  if (changed) {
    // ⚠️ DISABLED: Salva SOMENTE no Docker, não em localStorage
    // safeLocalStorageSetItem('simulador_parcelamentos', JSON.stringify(migrated));
    scheduleEyeVisionOperationalSave();
  }

  safeLocalStorageSetItem(PARCELAMENTO_MIGRATION_FLAG, '1');
}

const TEXT_REPAIR_SUFFIXES = new Set<keyof typeof LEGACY_MANAGER_KEYS>([
  'plano',
  'extrato',
  'folha',
  'folhaRelatorio',
  'razao',
  'balancete',
]);

function repairManagerRows<T>(suffix: keyof typeof LEGACY_MANAGER_KEYS, list: T[]): T[] {
  if (!TEXT_REPAIR_SUFFIXES.has(suffix) || list.length === 0) return list;
  return repairPortugueseDeep(list);
}

function suffixFromManagerKey(key: string): keyof typeof LEGACY_MANAGER_KEYS | null {
  for (const suffix of TEXT_REPAIR_SUFFIXES) {
    if (key.endsWith(`_${suffix}`)) return suffix;
  }
  return null;
}

const managerMemoryCache = new Map<string, unknown[]>();

/** Slugs com dados em memória (hydrate Docker). */
export function listManagerCacheSlugs(): string[] {
  const slugs = new Set<string>();
  const re =
    /^contabilfacil_(.+)_(plano|extrato|folha|folhaRelatorio|razao|balancete|fiscalSped|fiscalPgdas|fiscalOcr|fiscalNfe|fiscalContasImposto|fiscalCfopDescricoes|folhaContasAutomacao|folhaRegras|honorariosLancamentos|honorariosContasAutomacao)$/;
  for (const key of managerMemoryCache.keys()) {
    const m = key.match(re);
    if (m?.[1]) slugs.add(m[1]);
  }
  return Array.from(slugs);
}
const pendingManagerWrites = new Map<string, ReturnType<typeof setTimeout>>();
export function readManagerMemoryEntry(key: string): unknown[] | undefined {
  const cached = managerMemoryCache.get(key);
  return cached !== undefined ? cached : undefined;
}

export function listManagerMemoryCacheKeys(): string[] {
  return Array.from(managerMemoryCache.keys());
}

export function hasAnyManagerMemoryData(): boolean {
  for (const rows of managerMemoryCache.values()) {
    if (Array.isArray(rows) && rows.length > 0) return true;
  }
  return false;
}

const MANAGER_WRITE_DEBOUNCE_MS = 450;

function readManagerRowsFromStorageKey<T>(key: string, suffix: keyof typeof LEGACY_MANAGER_KEYS): T[] {
  try {
    const raw = safeLocalStorageGetItem(key);
    if (!raw?.trim()) return [];
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? (parsed as T[]) : [];
    return repairManagerRows(suffix, list);
  } catch {
    return [];
  }
}

function managerPlanoFingerprint(list: unknown[]): string {
  if (!Array.isArray(list) || list.length === 0) return '';
  try {
    return JSON.stringify(list);
  } catch {
    return String(list.length);
  }
}

function companyHasOperationalDataBesidesPlano(companyName: string): boolean {
  for (const suffix of MANAGER_DATA_SUFFIXES) {
    if (suffix === 'plano') continue;
    const rows = readManagerRowsFromStorageKey<unknown>(
      companyManagerStorageKey(companyName, suffix),
      suffix,
    );
    if (rows.length > 0) return true;
  }
  const slug = canonicalCompanyStorageSlug(companyName);
  const pastasKey = `contabilfacil_${slug}_extrato_pastas_v1`;
  const pastasRaw = safeLocalStorageGetItem(pastasKey);
  if (pastasRaw && pastasRaw.length > 2 && pastasRaw !== '[]') return true;
  return false;
}

/** Consolida chaves alias → canônica e remove plano duplicado entre empresas distintas. */
export function repairIsolatedManagerStoragePerCompany(): void {
  const registry = loadCompaniesRegistry();
  const validCanonicalSlugs = new Set(
    registry.map((c) => canonicalCompanyStorageSlug(c.name)).filter(Boolean),
  );

  const re =
    /^contabilfacil_(.+)_(plano|extrato|folha|folhaRelatorio|razao|balancete|fiscalSped|fiscalPgdas|fiscalOcr|fiscalNfe|fiscalContasImposto|fiscalCfopDescricoes|folhaContasAutomacao|folhaRegras|honorariosLancamentos|honorariosContasAutomacao)$/;
  const keys = new Set<string>(listManagerMemoryCacheKeys());
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('contabilfacil_')) keys.add(key);
    }
  } catch {
    /* ignore */
  }

  for (const key of keys) {
    const match = key.match(re);
    if (!match?.[1]) continue;
    const rawSlug = match[1];
    const suffix = match[2] as keyof typeof LEGACY_MANAGER_KEYS;
    const canonical = canonicalCompanyStorageSlug(rawSlug);
    if (!validCanonicalSlugs.has(canonical)) {
      safeLocalStorageRemoveItem(key);
      managerMemoryCache.delete(key);
      continue;
    }
    if (rawSlug === canonical) continue;
    const canonicalKey = `contabilfacil_${canonical}_${suffix}`;
    const aliasRows = readManagerRowsFromStorageKey<unknown>(key, suffix);
    if (aliasRows.length === 0) {
      safeLocalStorageRemoveItem(key);
      managerMemoryCache.delete(key);
      continue;
    }
    const canonicalRows = readManagerRowsFromStorageKey<unknown>(canonicalKey, suffix);
    if (canonicalRows.length === 0) {
      persistManagerKey(canonicalKey, JSON.stringify(aliasRows), false);
      setManagerMemoryCacheEntry(canonicalKey, aliasRows);
    }
    safeLocalStorageRemoveItem(key);
    managerMemoryCache.delete(key);
  }

  const planoOwners = new Map<string, { slug: string; name: string; score: number }>();
  for (const company of registry) {
    const slug = canonicalCompanyStorageSlug(company.name);
    if (!slug) continue;
    const plano = readManagerRowsFromStorageKey<unknown>(companyManagerStorageKey(company.name, 'plano'), 'plano');
    const fingerprint = managerPlanoFingerprint(plano);
    if (!fingerprint || plano.length < 5) continue;
    const score = countManagerDataForCompany(company.name);
    const prev = planoOwners.get(fingerprint);
    if (!prev || score > prev.score) {
      planoOwners.set(fingerprint, { slug, name: company.name, score });
    }
  }

  for (const company of registry) {
    const slug = canonicalCompanyStorageSlug(company.name);
    if (!slug) continue;
    const key = companyManagerStorageKey(company.name, 'plano');
    const plano = readManagerRowsFromStorageKey<unknown>(key, 'plano');
    const fingerprint = managerPlanoFingerprint(plano);
    if (!fingerprint || plano.length < 5) continue;
    const owner = planoOwners.get(fingerprint);
    if (!owner || owner.slug === slug) continue;
    if (companyHasOperationalDataBesidesPlano(company.name)) continue;
    writeManagerDataNow(company.name, 'plano', []);
    invalidateManagerDataCache(company.name, 'plano');
  }
}

export function readManagerData<T>(companyName: string, suffix: keyof typeof LEGACY_MANAGER_KEYS): T[] {
  const norm = normalizeCompanyName(companyName);
  if (!norm || norm === 'SEM EMPRESA') return [];
  const key = companyManagerStorageKey(norm, suffix);
  const cached = managerMemoryCache.get(key);
  if (cached) return cached as T[];

  const canonicalRaw = safeLocalStorageGetItem(key);
  let list = readManagerRowsFromStorageKey<T>(key, suffix);

  // Uma lista canônica explicitamente salva como [] representa exclusão intencional.
  // Só consulta a chave alias quando a chave canônica realmente não existe.
  if (list.length === 0 && canonicalRaw == null) {
    const rawSlug = companyStorageSlug(norm);
    const canonical = canonicalCompanyStorageSlug(norm);
    if (rawSlug && rawSlug !== canonical) {
      const aliasKey = `contabilfacil_${rawSlug}_${suffix}`;
      const aliasRows = readManagerRowsFromStorageKey<T>(aliasKey, suffix);
      if (aliasRows.length > 0) {
        list = aliasRows;
        managerMemoryCache.set(key, list);
        persistManagerKey(key, JSON.stringify(list));
        safeLocalStorageRemoveItem(aliasKey);
        managerMemoryCache.delete(aliasKey);
      }
    }
  }

  managerMemoryCache.set(key, list);
  return list;
}

function persistManagerKey(key: string, payload: string, schedule = true): void {
  safeLocalStorageSetItem(key, payload);
  if (schedule) scheduleEyeVisionOperationalSave();
}

/** Grava na memória; serialização JSON só após debounce (não bloqueia digitação). */
export function writeManagerData<T>(
  companyName: string,
  suffix: keyof typeof LEGACY_MANAGER_KEYS,
  list: T[],
): void {
  const company = requireCompanyScope(companyName);
  const key = companyManagerStorageKey(company, suffix);
  managerMemoryCache.set(key, list);
  const pending = pendingManagerWrites.get(key);
  if (pending) clearTimeout(pending);
  const timer = setTimeout(() => {
    pendingManagerWrites.delete(key);
    const data = managerMemoryCache.get(key);
    if (data) persistManagerKey(key, JSON.stringify(data));
  }, MANAGER_WRITE_DEBOUNCE_MS);
  pendingManagerWrites.set(key, timer);
}

/** Gravação síncrona (importações críticas: plano, extrato, etc.). */
export function writeManagerDataNow<T>(
  companyName: string,
  suffix: keyof typeof LEGACY_MANAGER_KEYS,
  list: T[],
): void {
  const company = requireCompanyScope(companyName);
  const key = companyManagerStorageKey(company, suffix);
  const pending = pendingManagerWrites.get(key);
  if (pending) {
    clearTimeout(pending);
    pendingManagerWrites.delete(key);
  }
  managerMemoryCache.set(key, list);
  persistManagerKey(key, JSON.stringify(list));

  if (suffix === 'plano' && Array.isArray(list) && list.length > 0) {
    for (const other of loadCompaniesRegistry()) {
      if (isSameCompanyStorageScope(other.name, company)) continue;
      if (companyHasOperationalDataBesidesPlano(other.name)) continue;
      const otherPlano = readManagerRowsFromStorageKey<unknown>(
        companyManagerStorageKey(other.name, 'plano'),
        'plano',
      );
      if (managerPlanoFingerprint(otherPlano) === managerPlanoFingerprint(list)) {
        const otherKey = companyManagerStorageKey(other.name, 'plano');
        safeLocalStorageRemoveItem(otherKey);
        managerMemoryCache.delete(otherKey);
      }
    }
  }
}

export function hasPendingManagerWrites(): boolean {
  return pendingManagerWrites.size > 0;
}

/** Força gravação imediata (ex.: antes de fechar aba). */
export function flushManagerDataWrites(): void {
  for (const [key, timer] of pendingManagerWrites) {
    clearTimeout(timer);
    const data = managerMemoryCache.get(key);
    if (data) {
      safeLocalStorageSetItem(key, JSON.stringify(data));
    }
  }
  pendingManagerWrites.clear();
}

export function invalidateManagerDataCache(companyName?: string, suffix?: keyof typeof LEGACY_MANAGER_KEYS): void {
  flushManagerDataWrites();
  if (!companyName) {
    managerMemoryCache.clear();
    return;
  }
  const norm = normalizeCompanyName(companyName);
  if (suffix) {
    managerMemoryCache.delete(companyManagerStorageKey(norm, suffix));
    return;
  }
  for (const s of Object.keys(LEGACY_MANAGER_KEYS) as (keyof typeof LEGACY_MANAGER_KEYS)[]) {
    managerMemoryCache.delete(companyManagerStorageKey(norm, s));
  }
}

/** Atualiza cache após hydrate Docker → memória. */
export function setManagerMemoryCacheEntry(key: string, rows: unknown[]): void {
  const list = Array.isArray(rows) ? rows : [];
  const suffix = suffixFromManagerKey(key);
  const repaired = suffix ? repairManagerRows(suffix, list) : list;
  managerMemoryCache.set(key, repaired);
}

export function renameCompanyInStorage(oldName: string, newName: string): boolean {
  const oldNorm = normalizeCompanyName(oldName);
  const newNorm = normalizeCompanyName(newName);

  if (!oldNorm || !newNorm || oldNorm === newNorm || newNorm === 'SEM EMPRESA') {
    return false;
  }

  const registry = loadCompaniesRegistry();
  if (registry.some((c) => c.name === newNorm && c.name !== oldNorm)) {
    return false;
  }

  const contracts = loadContractsFromBrowserStorage();
  saveContractsToBrowserStorage(
    contracts.map((contract) =>
      normalizeCompanyName(contract.companyName) === oldNorm
        ? { ...contract, companyName: newNorm }
        : contract,
    ),
  );

  const aplicacoes = loadAplicacoesFromBrowserStorage();
  persistCanonicalList(
    'simulador_aplicacoes',
    aplicacoes.map((item) => {
      const scopedSindicato = item.sindicatoName;
      const scopedEmpresa = normalizeCompanyName(item.nomeEmpresa) === oldNorm;
      if (normalizeCompanyName(scopedSindicato ?? '') === oldNorm) {
        return { ...item, sindicatoName: newNorm };
      }
      if (scopedEmpresa && !scopedSindicato?.trim()) {
        return { ...item, nomeEmpresa: newNorm };
      }
      return item;
    }),
  );

  const parcelamentos = loadParcelamentosFromBrowserStorage();
  persistCanonicalList(
    'simulador_parcelamentos',
    parcelamentos.map((item) => {
      const scoped = (item as { companyName?: string }).companyName;
      return normalizeCompanyName(scoped ?? '') === oldNorm ? { ...item, companyName: newNorm } : item;
    }),
  );

  for (const suffix of Object.keys(LEGACY_MANAGER_KEYS) as (keyof typeof LEGACY_MANAGER_KEYS)[]) {
    const oldKey = companyManagerStorageKey(oldNorm, suffix);
    const newKey = companyManagerStorageKey(newNorm, suffix);
    const raw = safeLocalStorageGetItem(oldKey);
    if (!raw?.trim()) continue;
    if (!safeLocalStorageGetItem(newKey)) {
      safeLocalStorageSetItem(newKey, raw);
    }
    safeLocalStorageRemoveItem(oldKey);
  }

  saveCompaniesRegistry(
    dedupeCompaniesBySlug(
      registry.map((company) =>
        company.name === oldNorm ? { ...company, name: newNorm } : company,
      ),
    ),
    { replace: true },
  );

  clearCompanyDeletion(newNorm);

  if (loadSelectedCompanyName() === oldNorm) {
    saveSelectedCompanyName(newNorm);
  }

  invalidateManagerDataCache();

  scheduleEyeVisionOperationalSave();

  return true;
}

/** Remove regras de extrato, inteligência IA e demais chaves auxiliares da empresa. */
export function purgeCompanyScopedAuxiliaryData(companyName: string): void {
  const norm = normalizeCompanyName(companyName);
  if (!norm || norm === 'SEM EMPRESA') return;

  const slug = canonicalCompanyStorageSlug(norm);
  const extraKeys = [
    `contabilfacil_${slug}_extrato_ocr_layouts_v1`,
    `contabilfacil_${slug}_extrato_regras_contas_v2`,
    `contabilfacil_${slug}_extrato_regras_contas_v1`,
    `contabilfacil_${slug}_extrato_regras_banco_v1`,
    `contabilfacil_${slug}_extrato_pastas_v1`,
    `contabilfacil_${slug}_extrato_saldo_anterior`,
    `contabilfacil_${slug}_ai_inteligencia_v1`,
  ];
  for (const key of extraKeys) {
    safeLocalStorageRemoveItem(key);
  }

  void import('./aiInteligenciaStorage').then(({ purgeAiInteligenciaCachesForCompany }) => {
    purgeAiInteligenciaCachesForCompany(norm);
  });
}

export function deleteManagerCompanyInStorage(name: string): boolean {
  const norm = normalizeCompanyName(name);
  if (!norm || norm === 'SEM EMPRESA') return false;

  const registry = loadCompaniesRegistry();
  if (!registry.some((c) => c.name === norm)) return false;

  const slug = canonicalCompanyStorageSlug(norm);
  const nextRegistry = dedupeCompaniesBySlug(registry.filter((c) => c.name !== norm));
  const stillHasSlug = nextRegistry.some(
    (c) => canonicalCompanyStorageSlug(c.name) === slug,
  );

  if (!stillHasSlug) {
    for (const suffix of MANAGER_DATA_SUFFIXES) {
      const key = companyManagerStorageKey(norm, suffix);
      safeLocalStorageRemoveItem(key);
      managerMemoryCache.delete(key);
      const pending = pendingManagerWrites.get(key);
      if (pending) {
        clearTimeout(pending);
        pendingManagerWrites.delete(key);
      }
    }

    saveContractsToBrowserStorage(
      loadContractsFromBrowserStorage().filter(
        (contract) => normalizeCompanyName(contract.companyName) !== norm,
      ),
    );

    const parcelamentos = loadParcelamentosFromBrowserStorage().filter(
      (item) => normalizeCompanyName((item as { companyName?: string }).companyName ?? '') !== norm,
    );
    if (parcelamentos.length === 0) {
      safeLocalStorageSetItem('simulador_parcelamentos', JSON.stringify([]));
    } else {
      persistCanonicalList('simulador_parcelamentos', parcelamentos);
    }

    const aplicacoes = loadAplicacoesFromBrowserStorage().filter(
      (item) => normalizeCompanyName(item.sindicatoName ?? '') !== norm,
    );
    if (aplicacoes.length === 0) {
      safeLocalStorageSetItem('simulador_aplicacoes', JSON.stringify([]));
    } else {
      persistCanonicalList('simulador_aplicacoes', aplicacoes);
    }

    recordCompanyDeletion(norm);
    purgeCompanyScopedAuxiliaryData(norm);
    void import('./eyeVisionCloudSync').then(({ purgeCompanyFromCloudImmediately }) =>
      purgeCompanyFromCloudImmediately(norm),
    );
  }

  saveCompaniesRegistry(nextRegistry, { replace: true });
  reconcileDeletedCompaniesWithRegistry(nextRegistry);

  if (loadSelectedCompanyName() === norm) {
    const fallback = nextRegistry[0]?.name ?? '';
    if (fallback) saveSelectedCompanyName(fallback);
    else safeLocalStorageRemoveItem(SELECTED_COMPANY_KEY);
  }

  invalidateManagerDataCache();
  scheduleEyeVisionOperationalSave();
  void import('./eyeVisionPersistenceFlush').then(({ flushAllEyeVisionPersistence }) =>
    flushAllEyeVisionPersistence(),
  );
  return true;
}

/** Valida e limpa contas órfâs inválidas do plano (contas com classificação sem pontos). */
export function validarElimparPlanoContas(plano: any[]): any[] {
  if (!Array.isArray(plano)) return plano;

  // Remove contas onde o "code" (classificação) é apenas dígitos sem pontos
  // Essas são contas órfâs mal formadas que devem ser recriadas corretamente
  return plano.filter(conta => {
    if (!conta || typeof conta !== 'object') return true;
    const cls = (conta.code || '').trim();
    // Se está vazio → remove
    if (!cls) return false;
    // Se tem pontos → é uma classificação estruturada válida
    if (cls.includes('.')) return true;
    // Se não tem pontos mas é muito curto (1-2 dígitos) → é um grupo válido
    if (cls.length <= 2 && /^\d+$/.test(cls)) return true;
    // Caso contrário → é código reduzido inválido como classificação → remove
    return false;
  });
}

/** Dev (Vite HMR): grava pendências antes do hot reload para não perder dados em memória. */
if (typeof import.meta !== 'undefined' && import.meta.hot) {
  import.meta.hot.dispose(() => {
    flushManagerDataWrites();
  });
}
