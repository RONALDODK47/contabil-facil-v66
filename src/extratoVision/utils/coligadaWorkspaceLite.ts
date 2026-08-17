/**
 * Leitura leve de dados gerenciais para automação coligada (Web Worker).
 * Evita importar companyWorkspace.ts (cadeia pesada com cloud sync / gestão).
 */
import { safeLocalStorageGetItem } from '../../lib/safeLocalStorage';

const COMPANIES_REGISTRY_KEY = 'contabilfacil_companies_registry_v1';

const SLUG_ALIASES: Record<string, string> = {
  POLO_SUL_CLIMATIZA_AO: 'POLO_SUL_CLIMATIZACAO',
};

export function normalizeCompanyName(name: string): string {
  return String(name ?? '').trim().replace(/\s+/g, ' ').toUpperCase() || 'SEM EMPRESA';
}

function companyStorageSlug(companyName: string): string {
  return normalizeCompanyName(companyName)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

function canonicalCompanyStorageSlug(companyNameOrSlug: string): string {
  const raw = String(companyNameOrSlug || '').trim();
  const slug = /^[A-Z0-9_]+$/.test(raw) ? raw : companyStorageSlug(raw);
  return SLUG_ALIASES[slug] || slug;
}

function managerStorageKey(companyName: string, suffix: 'extrato' | 'razao'): string {
  return `contabilfacil_${canonicalCompanyStorageSlug(companyName)}_${suffix}`;
}

export function loadCompaniesRegistryLite(): { name: string }[] {
  try {
    const raw = safeLocalStorageGetItem(COMPANIES_REGISTRY_KEY);
    if (!raw?.trim()) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => {
        if (!row || typeof row !== 'object') return null;
        const name = normalizeCompanyName(String((row as Record<string, unknown>).name ?? ''));
        return name && name !== 'SEM EMPRESA' ? { name } : null;
      })
      .filter((x): x is { name: string } => Boolean(x));
  } catch {
    return [];
  }
}

export function readManagerDataLite<T>(companyName: string, suffix: 'extrato' | 'razao'): T[] {
  const norm = normalizeCompanyName(companyName);
  if (!norm || norm === 'SEM EMPRESA') return [];
  const key = managerStorageKey(norm, suffix);
  try {
    const raw = safeLocalStorageGetItem(key);
    if (!raw?.trim()) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}
