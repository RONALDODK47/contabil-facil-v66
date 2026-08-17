import { writePersistedLocalStorageJson } from '../../lib/persistentLocalStorage';
import { safeLocalStorageGetItem } from '../../lib/safeLocalStorage';
import { companyStorageSlug } from './companyWorkspace';
import { generateUUID } from '../../lib/uuid';
import type { AplicacaoExtratoRow } from './aplicacaoExtratoParser';

/**
 * Contas de aplicação (produtos) e seus extratos importados, por empresa.
 * Modelado como a conciliação de extrato bancário: cada "conta de aplicação"
 * (ex.: SICREDINVEST EXCLUSIVO, POUPANÇA INTEGRADA) tem seu próprio saldo
 * anterior, lançamentos e resumo — sem consolidar entre contas.
 */

export type AplicacaoContaExtrato = {
  id: string;
  nome: string;
  saldoAnteriorManual: number | null;
  rows: AplicacaoExtratoRow[];
  atualizadoEm: string;
};

function storageKey(company: string): string {
  return `contabilfacil_${companyStorageSlug(company)}_aplicacao_extrato_contas_v1`;
}

export function loadAplicacaoContasExtrato(company: string): AplicacaoContaExtrato[] {
  try {
    const raw = safeLocalStorageGetItem(storageKey(company));
    if (!raw?.trim()) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AplicacaoContaExtrato[]) : [];
  } catch {
    return [];
  }
}

function saveAll(company: string, contas: AplicacaoContaExtrato[]): AplicacaoContaExtrato[] {
  writePersistedLocalStorageJson(storageKey(company), contas);
  return contas;
}

export function upsertAplicacaoContaExtrato(
  company: string,
  conta: { id?: string; nome: string; saldoAnteriorManual?: number | null; rows?: AplicacaoExtratoRow[] },
): AplicacaoContaExtrato[] {
  const all = loadAplicacaoContasExtrato(company);
  const now = new Date().toISOString();
  const idx = conta.id ? all.findIndex((c) => c.id === conta.id) : -1;
  if (idx >= 0) {
    all[idx] = {
      ...all[idx],
      nome: conta.nome,
      saldoAnteriorManual: conta.saldoAnteriorManual ?? all[idx].saldoAnteriorManual,
      rows: conta.rows ?? all[idx].rows,
      atualizadoEm: now,
    };
  } else {
    all.push({
      id: conta.id ?? generateUUID(),
      nome: conta.nome,
      saldoAnteriorManual: conta.saldoAnteriorManual ?? null,
      rows: conta.rows ?? [],
      atualizadoEm: now,
    });
  }
  return saveAll(company, all);
}

export function removeAplicacaoContaExtrato(company: string, id: string): AplicacaoContaExtrato[] {
  return saveAll(company, loadAplicacaoContasExtrato(company).filter((c) => c.id !== id));
}

export function computeResumoConta(conta: AplicacaoContaExtrato): {
  saldoAnterior: number;
  totalEntradas: number;
  totalSaidas: number;
  saldoFinal: number;
} {
  const saldoAnterior = conta.saldoAnteriorManual ?? 0;
  const totalEntradas = conta.rows.reduce((s, r) => s + (r.entrada || 0), 0);
  const totalSaidas = conta.rows.reduce((s, r) => s + (r.saida || 0), 0);
  const saldoFinal = saldoAnterior + totalEntradas - totalSaidas;
  return { saldoAnterior, totalEntradas, totalSaidas, saldoFinal };
}
