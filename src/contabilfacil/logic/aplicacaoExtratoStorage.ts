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
  /** Conta contábil da aplicação em código reduzido — análogo da conta banco. */
  contaContabil?: string;
  saldoAnteriorManual: number | null;
  /** Saldo final digitado à mão; quando nulo, é calculado (anterior + débitos - créditos). */
  saldoFinalManual?: number | null;
  rows: AplicacaoExtratoRow[];
  /**
   * Gerar o estorno das provisões no primeiro dia do mês seguinte. A provisão
   * do fim do mês é uma competência que não virou caixa; compensá-la na virada
   * evita que ela fique acumulada no saldo da aplicação.
   */
  compensarProvisao?: boolean;
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
  conta: {
    id?: string;
    nome: string;
    contaContabil?: string;
    saldoAnteriorManual?: number | null;
    saldoFinalManual?: number | null;
    rows?: AplicacaoExtratoRow[];
    compensarProvisao?: boolean;
  },
): AplicacaoContaExtrato[] {
  const all = loadAplicacaoContasExtrato(company);
  const now = new Date().toISOString();
  const idx = conta.id ? all.findIndex((c) => c.id === conta.id) : -1;
  if (idx >= 0) {
    all[idx] = {
      ...all[idx],
      nome: conta.nome,
      contaContabil: conta.contaContabil ?? all[idx].contaContabil,
      saldoAnteriorManual:
        conta.saldoAnteriorManual !== undefined ? conta.saldoAnteriorManual : all[idx].saldoAnteriorManual,
      saldoFinalManual:
        conta.saldoFinalManual !== undefined ? conta.saldoFinalManual : all[idx].saldoFinalManual ?? null,
      rows: conta.rows ?? all[idx].rows,
      compensarProvisao:
        conta.compensarProvisao !== undefined ? conta.compensarProvisao : all[idx].compensarProvisao,
      atualizadoEm: now,
    };
  } else {
    all.push({
      id: conta.id ?? generateUUID(),
      nome: conta.nome,
      contaContabil: conta.contaContabil ?? '',
      saldoAnteriorManual: conta.saldoAnteriorManual ?? null,
      saldoFinalManual: conta.saldoFinalManual ?? null,
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
  const calculado = saldoAnterior + totalEntradas - totalSaidas;
  const saldoFinal = conta.saldoFinalManual ?? calculado;
  return { saldoAnterior, totalEntradas, totalSaidas, saldoFinal };
}
