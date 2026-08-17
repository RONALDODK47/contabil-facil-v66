import { writePersistedLocalStorageJson } from '../../lib/persistentLocalStorage';
import { generateUUID } from '../../lib/uuid';
import { companyStorageSlug } from './companyWorkspace';
import { sanitizeCodigoReduzido } from './planoContasMapper';
import { safeLocalStorageGetItem } from '../../lib/safeLocalStorage';

/**
 * Regras de conciliação para extratos de Aplicação Financeira.
 *
 * Diferença em relação às regras de extrato bancário (extratoRegrasContasStorage.ts):
 * uma aplicação sempre movimenta DOIS lados (débito e crédito) para cada tipo de
 * lançamento — ex.: "APLICAÇÃO" (entrada no extrato de aplicação) debita a conta de
 * Aplicação Financeira e credita Banco Conta Movimento; "RESGATE" faz o inverso;
 * "IOF"/"IRRF" debita a despesa correspondente e credita a Aplicação. Por isso a
 * regra aqui guarda contaDebito + contaCredito em vez de uma única contrapartida.
 */

export type AplicacaoRegraConta = {
  id: string;
  nome: string;
  /** Padrão de histórico/descrição do extrato de aplicação a ser casado. */
  descricao: string;
  /** Conta de aplicação (produto) a que a regra pertence — nome/identificador livre. */
  contaAplicacao: string;
  /** Código reduzido do plano de contas a debitar quando a regra casar. */
  contaDebito: string;
  /** Código reduzido do plano de contas a creditar quando a regra casar. */
  contaCredito: string;
};

const RE_RUIDO = /\b(saldo\s+do\s+dia|saldo\s+anterior|saldo\s+atual)\b/gi;

function storageKey(company: string): string {
  return `contabilfacil_${companyStorageSlug(company)}_aplicacao_regras_contas_v1`;
}

function selectedContaKey(company: string): string {
  return `contabilfacil_${companyStorageSlug(company)}_aplicacao_regras_conta_ativa_v1`;
}

export function normalizeAplicacaoRegraTexto(texto: string): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(RE_RUIDO, ' ')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normAplicacaoContaCode(code: string): string {
  return String(code ?? '').trim().toUpperCase();
}

function sanitizeRegra(
  raw: Partial<AplicacaoRegraConta>,
  defaultConta = '',
): AplicacaoRegraConta | null {
  const descricao = String(raw.descricao ?? '').trim();
  const descricaoNorm = normalizeAplicacaoRegraTexto(descricao);
  const contaAplicacao = String(raw.contaAplicacao ?? defaultConta).trim();
  let contaDebito = String(raw.contaDebito ?? '').trim();
  let contaCredito = String(raw.contaCredito ?? '').trim();
  if (!descricaoNorm || !contaAplicacao || !contaDebito || !contaCredito) return null;

  const redDeb = sanitizeCodigoReduzido(contaDebito);
  if (redDeb) contaDebito = redDeb;
  const redCred = sanitizeCodigoReduzido(contaCredito);
  if (redCred) contaCredito = redCred;

  const nome = String(raw.nome ?? '').trim() || descricao.slice(0, 40);
  return {
    id: raw.id?.trim() || generateUUID(),
    nome,
    descricao,
    contaAplicacao,
    contaDebito,
    contaCredito,
  };
}

export function loadAplicacaoRegrasContas(company: string, defaultConta = ''): AplicacaoRegraConta[] {
  try {
    const raw = safeLocalStorageGetItem(storageKey(company));
    if (!raw?.trim()) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: AplicacaoRegraConta[] = [];
    for (const item of parsed) {
      const r = sanitizeRegra(item as Partial<AplicacaoRegraConta>, defaultConta);
      if (r) out.push(r);
    }
    return out;
  } catch {
    return [];
  }
}

export function saveAplicacaoRegrasContas(
  company: string,
  regras: AplicacaoRegraConta[],
): AplicacaoRegraConta[] {
  const sanitized = regras
    .map((r) => sanitizeRegra(r))
    .filter((r): r is AplicacaoRegraConta => Boolean(r));
  writePersistedLocalStorageJson(storageKey(company), sanitized);
  return sanitized;
}

export function filterAplicacaoRegrasPorConta(
  regras: AplicacaoRegraConta[] | null | undefined,
  contaAplicacao: string,
): AplicacaoRegraConta[] {
  if (!regras?.length) return [];
  const norm = normAplicacaoContaCode(contaAplicacao);
  if (!norm) return regras;
  return regras.filter((r) => normAplicacaoContaCode(r.contaAplicacao) === norm);
}

export function addAplicacaoRegraConta(
  company: string,
  draft: Omit<AplicacaoRegraConta, 'id'> & { id?: string },
): AplicacaoRegraConta[] {
  const regra = sanitizeRegra({ ...draft, id: draft.id ?? generateUUID() });
  if (!regra) return loadAplicacaoRegrasContas(company);
  const current = loadAplicacaoRegrasContas(company);
  const duplicate = current.some(
    (item) =>
      normalizeAplicacaoRegraTexto(item.descricao) === normalizeAplicacaoRegraTexto(regra.descricao) &&
      normAplicacaoContaCode(item.contaAplicacao) === normAplicacaoContaCode(regra.contaAplicacao),
  );
  if (duplicate) return current;
  return saveAplicacaoRegrasContas(company, [...current, regra]);
}

export function updateAplicacaoRegraConta(
  company: string,
  id: string,
  patch: Partial<Omit<AplicacaoRegraConta, 'id'>>,
): AplicacaoRegraConta[] {
  const next = loadAplicacaoRegrasContas(company).map((r) => {
    if (r.id !== id) return r;
    return sanitizeRegra({ ...r, ...patch, id }) ?? r;
  });
  return saveAplicacaoRegrasContas(company, next);
}

export function removeAplicacaoRegraConta(company: string, id: string): AplicacaoRegraConta[] {
  return saveAplicacaoRegrasContas(
    company,
    loadAplicacaoRegrasContas(company).filter((r) => r.id !== id),
  );
}

export function loadAplicacaoRegrasContaSelecionada(company: string, fallback = ''): string {
  try {
    const raw = safeLocalStorageGetItem(selectedContaKey(company));
    return raw?.trim() || fallback;
  } catch {
    return fallback;
  }
}

export function saveAplicacaoRegrasContaSelecionada(company: string, contaAplicacao: string): void {
  try {
    writePersistedLocalStorageJson(selectedContaKey(company), contaAplicacao.trim());
  } catch (e) {
    console.warn('[aplicacao-regras] não foi possível gravar conta selecionada:', e);
  }
}

/** Aplica as regras cadastradas a uma linha de histórico, retornando débito/crédito se casar. */
export function matchAplicacaoRegra(
  regras: AplicacaoRegraConta[],
  historico: string,
): AplicacaoRegraConta | null {
  const alvo = normalizeAplicacaoRegraTexto(historico);
  if (!alvo) return null;
  for (const r of regras) {
    const padrao = normalizeAplicacaoRegraTexto(r.descricao);
    if (padrao && alvo.includes(padrao)) return r;
  }
  return null;
}
