import { scheduleEyeVisionCloudPush } from './eyeVisionCloudPush';
import {
  createCompanyRecord,
  normalizeCompanyName,
  type CompanyRecord,
} from './companyWorkspace';
import {
  deletePricingWorkspace,
  loadAllPricingWorkspaces,
  renamePricingWorkspaceCompany,
} from './pricingStorage';

import {
  safeLocalStorageGetItem,
  safeLocalStorageRemoveItem,
  safeLocalStorageSetItem,
} from '../../lib/safeLocalStorage';

export const PRICING_COMPANIES_REGISTRY_KEY = 'contabilfacil_pricing_companies_registry_v1';
export const PRICING_SELECTED_COMPANY_KEY = 'contabilfacil_pricing_selected_company_v1';

export function pricingIcmsUfStorageKey(company: string): string {
  return `contabilfacil_icms_uf_${normalizeCompanyName(company).replace(/\W/g, '_')}`;
}

export type PricingIcmsUfPrefs = {
  ufOrigem?: string;
  ufDestino?: string;
};

export function loadPricingIcmsUfPrefs(company: string): PricingIcmsUfPrefs {
  try {
    const raw = safeLocalStorageGetItem(pricingIcmsUfStorageKey(company));
    if (!raw?.trim()) return {};
    return JSON.parse(raw) as PricingIcmsUfPrefs;
  } catch {
    return {};
  }
}

export function savePricingIcmsUfPrefs(company: string, prefs: PricingIcmsUfPrefs): void {
  try {
    safeLocalStorageSetItem(pricingIcmsUfStorageKey(company), JSON.stringify(prefs));
    scheduleEyeVisionCloudPush();
  } catch {
    /* ignore quota */
  }
}

function parseCompaniesRows(rows: unknown[]): CompanyRecord[] {
  return rows
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const r = row as Record<string, unknown>;
      const name = normalizeCompanyName(String(r.name ?? ''));
      if (!name) return null;
      return {
        id: String(r.id ?? crypto.randomUUID()),
        name,
        createdAt: String(r.createdAt ?? new Date().toISOString()),
      } satisfies CompanyRecord;
    })
    .filter((row): row is CompanyRecord => row != null);
}

export function loadPricingCompaniesRegistry(): CompanyRecord[] {
  try {
    const raw = safeLocalStorageGetItem(PRICING_COMPANIES_REGISTRY_KEY);
    if (!raw?.trim()) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parseCompaniesRows(parsed);
  } catch {
    return [];
  }
}

export function savePricingCompaniesRegistry(list: CompanyRecord[]): void {
  const deduped = new Map<string, CompanyRecord>();
  for (const item of list) {
    const name = normalizeCompanyName(item.name);
    if (!deduped.has(name)) {
      deduped.set(name, { ...item, name });
    }
  }
  const merged = Array.from(deduped.values());
  safeLocalStorageSetItem(PRICING_COMPANIES_REGISTRY_KEY, JSON.stringify(merged));
  scheduleEyeVisionCloudPush();
}

export function loadPricingSelectedCompanyName(): string {
  const stored = safeLocalStorageGetItem(PRICING_SELECTED_COMPANY_KEY);
  if (stored?.trim()) return normalizeCompanyName(stored);
  return '';
}

export function savePricingSelectedCompanyName(name: string): void {
  safeLocalStorageSetItem(PRICING_SELECTED_COMPANY_KEY, normalizeCompanyName(name));
  scheduleEyeVisionCloudPush();
}

function discoverPricingCompanyNamesFromStorage(): string[] {
  const names = new Set<string>();
  for (const ws of loadAllPricingWorkspaces()) {
    if (ws.companyName?.trim()) {
      names.add(normalizeCompanyName(ws.companyName));
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
}

export function syncPricingCompanyRegistry(): CompanyRecord[] {
  const existing = loadPricingCompaniesRegistry();
  const byName = new Map(existing.map((c) => [c.name, c]));

  for (const name of discoverPricingCompanyNamesFromStorage()) {
    if (!byName.has(name)) {
      byName.set(name, createCompanyRecord(name));
    }
  }

  const merged = Array.from(byName.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }),
  );

  savePricingCompaniesRegistry(merged);
  return merged;
}

export function resolvePricingSelectedCompany(companies: CompanyRecord[]): string {
  const stored = loadPricingSelectedCompanyName();
  if (stored && companies.some((c) => c.name === stored)) {
    return stored;
  }
  const fallback = companies[0]?.name ?? 'SINDICATO';
  savePricingSelectedCompanyName(fallback);
  return fallback;
}

export function renamePricingCompanyInStorage(oldName: string, newName: string): boolean {
  const oldNorm = normalizeCompanyName(oldName);
  const newNorm = normalizeCompanyName(newName);

  if (!oldNorm || !newNorm || oldNorm === newNorm || newNorm === 'SEM EMPRESA') {
    return false;
  }

  const registry = loadPricingCompaniesRegistry();
  if (registry.some((c) => c.name === newNorm && c.name !== oldNorm)) {
    return false;
  }

  if (!renamePricingWorkspaceCompany(oldNorm, newNorm)) {
    return false;
  }

  const icmsRaw = safeLocalStorageGetItem(pricingIcmsUfStorageKey(oldNorm));
  if (icmsRaw?.trim() && !safeLocalStorageGetItem(pricingIcmsUfStorageKey(newNorm))) {
    safeLocalStorageSetItem(pricingIcmsUfStorageKey(newNorm), icmsRaw);
  }
  safeLocalStorageRemoveItem(pricingIcmsUfStorageKey(oldNorm));

  savePricingCompaniesRegistry(
    registry.map((company) => (company.name === oldNorm ? { ...company, name: newNorm } : company)),
  );

  if (loadPricingSelectedCompanyName() === oldNorm) {
    savePricingSelectedCompanyName(newNorm);
  }

  scheduleEyeVisionCloudPush();
  return true;
}

export function deletePricingCompanyInStorage(name: string): boolean {
  const norm = normalizeCompanyName(name);
  if (!norm || norm === 'SEM EMPRESA') return false;

  const registry = loadPricingCompaniesRegistry();
  if (!registry.some((c) => c.name === norm)) return false;

  deletePricingWorkspace(norm);
  safeLocalStorageRemoveItem(pricingIcmsUfStorageKey(norm));

  const nextRegistry = registry.filter((c) => c.name !== norm);
  savePricingCompaniesRegistry(nextRegistry);

  const selected = loadPricingSelectedCompanyName();
  if (selected === norm) {
    const fallback = nextRegistry[0]?.name ?? '';
    if (fallback) savePricingSelectedCompanyName(fallback);
    else safeLocalStorageRemoveItem(PRICING_SELECTED_COMPANY_KEY);
  }

  scheduleEyeVisionCloudPush();
  return true;
}
