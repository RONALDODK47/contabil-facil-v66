import { writePersistedLocalStorageJson } from '../../lib/persistentLocalStorage';
import { companyStorageSlug } from './companyWorkspace';

export type ExtratoSemNotaPolicy = 'fornecedor' | 'despesa_generica';

export type ExtratoSemNotaDecisions = Record<string, ExtratoSemNotaPolicy>;

export type ExtratoSemNotaRowRef = {
  id?: string;
  date?: string;
  value?: number;
  nature?: 'D' | 'C';
};

export function buildSemNotaRowKey(row: ExtratoSemNotaRowRef): string {
  if (row.id?.trim()) return row.id.trim();
  const date = (row.date ?? '').trim();
  const val = Math.abs(row.value ?? 0).toFixed(2);
  const nat = row.nature ?? 'D';
  return `${date}|${val}|${nat}`;
}

function storageKey(company: string): string {
  return `contabilfacil_${companyStorageSlug(company)}_extrato_sem_nota_v1`;
}

export function loadExtratoSemNotaDecisions(company: string): ExtratoSemNotaDecisions {
  try {
    const raw = localStorage.getItem(storageKey(company));
    if (!raw?.trim()) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as ExtratoSemNotaDecisions;
  } catch {
    return {};
  }
}

export function saveExtratoSemNotaDecisions(
  company: string,
  decisions: ExtratoSemNotaDecisions,
): void {
  writePersistedLocalStorageJson(storageKey(company), decisions);
}

export function mergeExtratoSemNotaDecision(
  company: string,
  rowKey: string,
  policy: ExtratoSemNotaPolicy,
): ExtratoSemNotaDecisions {
  const next = { ...loadExtratoSemNotaDecisions(company), [rowKey]: policy };
  saveExtratoSemNotaDecisions(company, next);
  return next;
}
