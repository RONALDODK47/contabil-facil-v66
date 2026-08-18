import { writePersistedLocalStorageJson } from '../../lib/persistentLocalStorage';
import { generateUUID } from '../../lib/uuid';
import { companyStorageSlug } from './companyWorkspace';
import { sanitizeCodigoReduzido } from './planoContasMapper';
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from '../../lib/safeLocalStorage';

/**
 * Regras de conciliação de extratos de Aplicação Financeira.
 *
 * MESMO modelo das regras de extrato bancário (extratoRegrasContasStorage.ts):
 * histórico + natureza (D/C) + UMA contrapartida em código reduzido. O outro lado
 * do lançamento é sempre a própria conta de aplicação — exatamente como, no extrato
 * bancário, o outro lado é sempre a conta banco. `contaAplicacao` é o análogo de
 * `contaBanco`: agrupa as regras por produto/conta de aplicação.
 */

export type AplicacaoRegraContaNature = 'D' | 'C';

export type AplicacaoRegraConta = {
  id: string;
  nome: string;
  /** Padrão de histórico/descrição do extrato de aplicação a ser casado. */
  descricao: string;
  nature: AplicacaoRegraContaNature;
  /** Conta de aplicação (produto) a que a regra pertence — análogo da conta banco. */
  contaAplicacao: string;
  /** Contrapartida — OBRIGATÓRIO código reduzido (nunca classificação 1.1.10…). */
  contaContrapartida: string;
};

/** Formato antigo (débito + crédito) — lido só para migração. */
type AplicacaoRegraContaLegacy = AplicacaoRegraConta & {
  contaDebito?: string;
  contaCredito?: string;
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
  raw: Partial<AplicacaoRegraContaLegacy>,
  defaultConta = '',
): AplicacaoRegraConta | null {
  const descricao = String(raw.descricao ?? '').trim();
  const descricaoNorm = normalizeAplicacaoRegraTexto(descricao);
  const contaAplicacao = String(raw.contaAplicacao ?? defaultConta).trim();
  // Migração do formato antigo (contaDebito/contaCredito): a contrapartida é o lado
  // informado; a natureza fica 'D' por padrão e pode ser corrigida na tela.
  let contaContrapartida = String(
    raw.contaContrapartida ?? raw.contaDebito ?? raw.contaCredito ?? '',
  ).trim();
  if (!descricaoNorm || !contaAplicacao || !contaContrapartida) return null;

  const red = sanitizeCodigoReduzido(contaContrapartida);
  if (red) contaContrapartida = red;

  const nome = String(raw.nome ?? '').trim() || descricao.slice(0, 40);
  const nature: AplicacaoRegraContaNature = raw.nature === 'C' ? 'C' : 'D';
  return {
    id: raw.id?.trim() || generateUUID(),
    nome,
    descricao,
    nature,
    contaAplicacao,
    contaContrapartida,
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
      const r = sanitizeRegra(item as Partial<AplicacaoRegraContaLegacy>, defaultConta);
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
      item.nature === regra.nature &&
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

export function removeAplicacaoRegrasPorConta(
  company: string,
  contaAplicacao: string,
): AplicacaoRegraConta[] {
  const norm = normAplicacaoContaCode(contaAplicacao);
  if (!norm) return loadAplicacaoRegrasContas(company);
  return saveAplicacaoRegrasContas(
    company,
    loadAplicacaoRegrasContas(company).filter(
      (r) => normAplicacaoContaCode(r.contaAplicacao) !== norm,
    ),
  );
}

function regraDedupKey(r: AplicacaoRegraConta): string {
  const desc = normalizeAplicacaoRegraTexto(r.descricao);
  const contra = sanitizeCodigoReduzido(r.contaContrapartida) || r.contaContrapartida.trim();
  return `${r.nature}|${desc}|${contra}`;
}

/**
 * Copia as regras de uma conta de aplicação para outra (mesma mecânica de
 * "replicar regras para outro banco" na conciliação bancária).
 */
export function replicateAplicacaoRegrasParaConta(
  company: string,
  fromConta: string,
  toConta: string,
  sourceOverride?: AplicacaoRegraConta[],
): { regras: AplicacaoRegraConta[]; added: number; skipped: number } {
  const from = fromConta.trim();
  const to = toConta.trim();
  const all = loadAplicacaoRegrasContas(company);
  if (!from || !to || normAplicacaoContaCode(from) === normAplicacaoContaCode(to)) {
    return { regras: all, added: 0, skipped: 0 };
  }

  const source =
    sourceOverride && sourceOverride.length > 0
      ? sourceOverride
      : filterAplicacaoRegrasPorConta(all, from);
  if (source.length === 0) return { regras: all, added: 0, skipped: 0 };

  const existingKeys = new Set(filterAplicacaoRegrasPorConta(all, to).map(regraDedupKey));
  const copies: AplicacaoRegraConta[] = [];
  let skipped = 0;
  for (const r of source) {
    const copy = sanitizeRegra({ ...r, id: generateUUID(), contaAplicacao: to }, to);
    if (!copy) continue;
    const key = regraDedupKey(copy);
    if (existingKeys.has(key)) {
      skipped += 1;
      continue;
    }
    existingKeys.add(key);
    copies.push(copy);
  }
  if (copies.length === 0) return { regras: all, added: 0, skipped };

  return {
    regras: saveAplicacaoRegrasContas(company, [...all, ...copies]),
    added: copies.length,
    skipped,
  };
}

export function loadAplicacaoRegrasContaSelecionada(company: string, fallback = ''): string {
  try {
    const raw = safeLocalStorageGetItem(selectedContaKey(company));
    if (!raw?.trim()) return fallback;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === 'string' && parsed.trim()) return parsed.trim();
    } catch {
      /* valor legado sem JSON */
    }
    return raw.replace(/^"|"$/g, '').trim() || fallback;
  } catch {
    return fallback;
  }
}

export function saveAplicacaoRegrasContaSelecionada(company: string, contaAplicacao: string): void {
  try {
    safeLocalStorageSetItem(selectedContaKey(company), contaAplicacao.trim());
  } catch (e) {
    console.warn('[aplicacao-regras] não foi possível gravar conta selecionada:', e);
  }
}

/**
 * Casa um lançamento do extrato de aplicação com as regras cadastradas.
 * Mesma semântica do extrato bancário: natureza precisa bater e o padrão da
 * regra precisa estar contido no histórico normalizado.
 */
export function matchAplicacaoRegra(
  regras: AplicacaoRegraConta[],
  historico: string,
  nature?: AplicacaoRegraContaNature,
): AplicacaoRegraConta | null {
  const alvo = normalizeAplicacaoRegraTexto(historico);
  if (!alvo) return null;
  let melhor: AplicacaoRegraConta | null = null;
  let melhorTam = 0;
  for (const r of regras) {
    if (nature && r.nature !== nature) continue;
    const padrao = normalizeAplicacaoRegraTexto(r.descricao);
    if (!padrao || !alvo.includes(padrao)) continue;
    // Padrão mais longo = mais específico, igual à conciliação bancária.
    if (padrao.length > melhorTam) {
      melhorTam = padrao.length;
      melhor = r;
    }
  }
  return melhor;
}

/** Lançamentos do extrato de aplicação ainda sem regra (para "puxar histórico"). */
export function findAplicacaoLinhasSemRegra(
  linhas: Array<{ description: string; nature: AplicacaoRegraContaNature; value: number }>,
  regrasDaConta: AplicacaoRegraConta[],
): Array<{ description: string; nature: AplicacaoRegraContaNature; value: number }> {
  const out: typeof linhas = [];
  for (const row of linhas) {
    if (!normalizeAplicacaoRegraTexto(row.description)) continue;
    if (matchAplicacaoRegra(regrasDaConta, row.description, row.nature)) continue;
    out.push({ ...row, description: String(row.description ?? '').replace(/\s+/g, ' ').trim() });
  }
  return out;
}
