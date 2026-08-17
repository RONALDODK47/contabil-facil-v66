import { assertSomenteCodigoReduzido, sanitizeCodigoReduzido } from './planoContasMapper';
import { readManagerData, writeManagerData } from './companyWorkspace';
import { generateUUID } from '../../lib/uuid';
import { normalizeExtratoMatchText } from './extratoRegrasContasStorage';
import {
  emptyFolhaContasAutomacao,
  FOLHA_RUBRICAS,
  type FolhaContasAutomacaoConfig,
} from './folhaContasAutomacao';

// ---------------------------------------------------------------------------
// FolhaRegra — regras dinâmicas por histórico com débito + crédito
// (similar às regras de extrato bancário, mas com as duas pernas contábeis)
// ---------------------------------------------------------------------------

export type FolhaRegra = {
  id: string;
  /** Trecho do histórico/descrição do lançamento da folha (match por substring, uppercase). */
  descricao: string;
  contaDebito: string;
  contaCredito: string;
};

function sanitizeFolhaRegra(raw: Partial<FolhaRegra>): FolhaRegra | null {
  const descricao = String(raw.descricao ?? '').trim();
  const contaDebito = sanitizeCodigoReduzido(String(raw.contaDebito ?? '').trim()) ?? String(raw.contaDebito ?? '').trim();
  const contaCredito = sanitizeCodigoReduzido(String(raw.contaCredito ?? '').trim()) ?? String(raw.contaCredito ?? '').trim();
  if (!descricao || !contaDebito || !contaCredito) return null;
  return {
    id: String(raw.id ?? '').trim() || generateUUID(),
    descricao,
    contaDebito,
    contaCredito,
  };
}

export function loadFolhaRegras(companyName: string): FolhaRegra[] {
  const rows = readManagerData<Partial<FolhaRegra>>(companyName, 'folhaRegras');
  return rows.map(sanitizeFolhaRegra).filter((r): r is FolhaRegra => Boolean(r));
}

export function saveFolhaRegras(companyName: string, regras: FolhaRegra[]): FolhaRegra[] {
  const sanitized = regras.map(sanitizeFolhaRegra).filter((r): r is FolhaRegra => Boolean(r));
  writeManagerData(companyName, 'folhaRegras', sanitized);
  return sanitized;
}

export function addFolhaRegra(
  companyName: string,
  draft: Omit<FolhaRegra, 'id'>,
): FolhaRegra[] {
  const regra = sanitizeFolhaRegra({ ...draft, id: generateUUID() });
  if (!regra) return loadFolhaRegras(companyName);
  const current = loadFolhaRegras(companyName);
  // Evita duplicatas exatas (mesma descrição + débito + crédito)
  const dup = current.some(
    (r) =>
      r.descricao.toUpperCase() === regra.descricao.toUpperCase() &&
      r.contaDebito === regra.contaDebito &&
      r.contaCredito === regra.contaCredito,
  );
  if (dup) return current;
  return saveFolhaRegras(companyName, [...current, regra]);
}

export function removeFolhaRegra(companyName: string, id: string): FolhaRegra[] {
  return saveFolhaRegras(companyName, loadFolhaRegras(companyName).filter((r) => r.id !== id));
}

export function updateFolhaRegra(
  companyName: string,
  id: string,
  patch: Partial<Omit<FolhaRegra, 'id'>>,
): FolhaRegra[] {
  const next = loadFolhaRegras(companyName).map((r) => {
    if (r.id !== id) return r;
    return sanitizeFolhaRegra({ ...r, ...patch, id }) ?? r;
  });
  return saveFolhaRegras(companyName, next);
}

/**
 * Resolve a regra (débito+crédito) de uma linha da folha pelo histórico — mesmo esquema de
 * casamento por substring usado nas regras de extrato/fiscal. Entre várias regras que batem,
 * prioriza a de descrição mais longa (mais específica).
 */
export function resolveFolhaRegraContas(historico: string, regras: FolhaRegra[]): FolhaRegra | null {
  const norm = normalizeExtratoMatchText(historico);
  if (!norm) return null;
  let best: FolhaRegra | null = null;
  for (const r of regras) {
    const descNorm = normalizeExtratoMatchText(r.descricao);
    if (!descNorm || !norm.includes(descNorm)) continue;
    if (!best || descNorm.length > normalizeExtratoMatchText(best.descricao).length) best = r;
  }
  return best;
}

function loadPlanoCompletoForContaResolve(companyName: string): Array<{
  code: string;
  name: string;
  codigoReduzido?: string;
  tipo?: string;
}> {
  return readManagerData<{
    code?: string;
    name?: string;
    codigoReduzido?: string;
    tipo?: string;
  }>(companyName, 'plano')
    .map((r) => ({
      code: String(r.code ?? '').trim(),
      name: String(r.name ?? '').trim(),
      codigoReduzido: sanitizeCodigoReduzido(r.codigoReduzido),
      tipo: r.tipo,
    }))
    .filter((r) => r.code || r.codigoReduzido);
}

function normalizeContaCampo(raw: string, plano: ReturnType<typeof loadPlanoCompletoForContaResolve>): string {
  const v = String(raw ?? '').trim();
  if (!v) return '';
  return assertSomenteCodigoReduzido(v, plano);
}

export function loadFolhaContasAutomacao(companyName: string): FolhaContasAutomacaoConfig {
  const base = emptyFolhaContasAutomacao();
  const plano = loadPlanoCompletoForContaResolve(companyName);
  const rows = readManagerData<Partial<FolhaContasAutomacaoConfig>>(companyName, 'folhaContasAutomacao');
  const stored = rows[0];
  if (!stored || typeof stored !== 'object') return base;
  for (const id of FOLHA_RUBRICAS) {
    const par = stored[id];
    if (par && typeof par === 'object') {
      base[id] = {
        debito: normalizeContaCampo(String(par.debito ?? ''), plano),
        credito: normalizeContaCampo(String(par.credito ?? ''), plano),
      };
    }
  }
  return base;
}

export function saveFolhaContasAutomacao(companyName: string, config: FolhaContasAutomacaoConfig): void {
  writeManagerData(companyName, 'folhaContasAutomacao', [config]);
}
