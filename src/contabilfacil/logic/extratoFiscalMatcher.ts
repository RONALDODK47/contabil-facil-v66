import type { ExtratoFiscalContext, ExtratoFiscalIndexEntry } from './extratoFiscalContext';
import { extratoMesReferencia } from './extratoFiscalContext';
import { normalizeSignificadoExtrato, tokensSignificadoExtrato } from './extratoContaResolver';
import { matchFiscalAcumuladorRegra } from './fiscalAcumuladorRegrasStorage';

export type ExtratoFiscalMatchKind = 'com_nf' | 'imposto' | 'sem_nf';

export type ExtratoFiscalMatchResult = {
  kind: ExtratoFiscalMatchKind;
  contaContrapartida: string;
  entry?: ExtratoFiscalIndexEntry;
  score: number;
};

const VALOR_TOL_ABS = 0.05;
const VALOR_TOL_REL = 0.005;

function valorCompativel(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  const tol = Math.max(VALOR_TOL_ABS, Math.max(a, b) * VALOR_TOL_REL);
  return diff <= tol;
}

function normDesc(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function scoreDescricao(historico: string, entry: ExtratoFiscalIndexEntry): number {
  const tokens = tokensSignificadoExtrato(normalizeSignificadoExtrato(historico));
  if (!tokens.length) return 0;
  const blob = normDesc(`${entry.descricao} ${entry.imposto} ${entry.registro} ${entry.codigo}`);
  let score = 0;
  for (const tok of tokens) {
    if (blob.includes(tok.toLowerCase())) score += tok.length >= 5 ? 2 : 1;
  }
  const h = normDesc(historico);
  if (/\bdarf\b|\bgps\b|\bimposto\b|\btributo\b/.test(h) && entry.kind === 'imposto') score += 4;
  if (/\bicms\b/.test(h) && /icms/i.test(entry.imposto)) score += 3;
  if (/\bpis\b|\bpasep\b/.test(h) && /pis/i.test(entry.imposto)) score += 3;
  if (/\bcofins\b/.test(h) && /cofins/i.test(entry.imposto)) score += 3;
  if (/\bcode\b/i.test(h) && entry.kind === 'imposto') score += 10;
  if (/\bsispag\b/i.test(h) && entry.kind === 'imposto') score += 4;
  return score;
}

function contaContrapartidaFiscal(
  nature: 'D' | 'C',
  entry: ExtratoFiscalIndexEntry,
  ctx?: ExtratoFiscalContext | null,
  historico?: string,
): string {
  const regra = ctx?.acumuladorRegras?.length
    ? matchFiscalAcumuladorRegra(ctx.acumuladorRegras, historico ?? '', entry.acumuladorKey)
    : null;
  if (regra?.contaContrapartida) return regra.contaContrapartida;

  if (nature === 'D') {
    if (entry.naturezaFiscal === 'credora') return entry.contaCredito || entry.contaDebito;
    return entry.contaDebito || entry.contaCredito;
  }
  if (entry.naturezaFiscal === 'devedora') return entry.contaCredito || entry.contaDebito;
  return entry.contaDebito || entry.contaCredito;
}

function candidatosPorNatureza(
  ctx: ExtratoFiscalContext,
  nature: 'D' | 'C',
  mesRef: string | null,
  kind?: ExtratoFiscalIndexEntry['kind'],
): ExtratoFiscalIndexEntry[] {
  return ctx.entries.filter((e) => {
    if (kind && e.kind !== kind) return false;
    if (mesRef && e.mesRef && e.mesRef !== mesRef) return false;
    if (nature === 'D') {
      if (kind === 'acumulador') return e.naturezaFiscal === 'devedora';
      return e.naturezaFiscal === 'devedora';
    }
    return e.naturezaFiscal === 'devedora';
  });
}

/** Pagamento com valor igual a acumulador fiscal (NF/documento no SPED). */
export function matchExtratoAcumuladorFornecedor(
  ctx: ExtratoFiscalContext | null | undefined,
  params: {
    date?: string;
    value?: number;
    description?: string;
  },
): ExtratoFiscalIndexEntry | null {
  if (!ctx?.entries.length) return null;
  const valor = Math.abs(params.value ?? 0);
  if (valor < 0.01) return null;

  const mesRef = extratoMesReferencia(params.date ?? '');
  const historico = params.description ?? '';
  const pool = candidatosPorNatureza(ctx, 'D', mesRef, 'acumulador');

  let best: ExtratoFiscalIndexEntry | null = null;
  let bestScore = 0;

  for (const entry of pool) {
    if (!valorCompativel(valor, entry.valor)) continue;
    const descScore = scoreDescricao(historico, entry);
    const score = 100 + descScore;
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  return best;
}

export function temAcumuladorFiscalParaValor(
  ctx: ExtratoFiscalContext | null | undefined,
  date: string | undefined,
  value: number | undefined,
): boolean {
  return Boolean(matchExtratoAcumuladorFornecedor(ctx, { date, value }));
}

export function temImpostoFiscalParaValor(
  ctx: ExtratoFiscalContext | null | undefined,
  date: string | undefined,
  value: number | undefined,
  description?: string,
): boolean {
  return Boolean(
    matchExtratoImpostoFiscal(ctx, { date, value, nature: 'D', description }),
  );
}

export function temMatchFiscalExtratoParaValor(
  ctx: ExtratoFiscalContext | null | undefined,
  params: {
    date?: string;
    value?: number;
    description?: string;
  },
): boolean {
  return (
    temAcumuladorFiscalParaValor(ctx, params.date, params.value) ||
    temImpostoFiscalParaValor(ctx, params.date, params.value, params.description)
  );
}

/** Imposto a recolher (E116, DARF, etc.) — usa contas configuradas na aba Fiscal. */
export function matchExtratoImpostoFiscal(
  ctx: ExtratoFiscalContext | null | undefined,
  params: {
    date?: string;
    value?: number;
    nature: 'D' | 'C';
    description?: string;
  },
): ExtratoFiscalMatchResult | null {
  if (!ctx?.entries.length) return null;
  const valor = Math.abs(params.value ?? 0);
  if (valor < 0.01) return null;

  const mesRef = extratoMesReferencia(params.date ?? '');
  const historico = params.description ?? '';
  const pool = ctx.entries.filter((e) => {
    if (e.naturezaFiscal !== 'credora') return false;
    if (mesRef && e.mesRef && e.mesRef !== mesRef) return false;
    return params.nature === 'D';
  });

  let best: ExtratoFiscalMatchResult | null = null;

  for (const entry of pool) {
    if (!valorCompativel(valor, entry.valor)) continue;
    const conta = contaContrapartidaFiscal(params.nature, entry, ctx, historico);
    if (!conta.trim()) continue;
    const descScore = scoreDescricao(historico, entry);
    const score = 100 + descScore + 5;
    if (!best || score > best.score) {
      best = { kind: 'imposto', contaContrapartida: conta, entry, score };
    }
  }

  return best;
}

export function matchExtratoComFiscal(
  ctx: ExtratoFiscalContext | null | undefined,
  params: {
    date?: string;
    value?: number;
    nature: 'D' | 'C';
    description?: string;
  },
): ExtratoFiscalMatchResult | null {
  const imposto = matchExtratoImpostoFiscal(ctx, params);
  if (imposto) return imposto;

  if (params.nature !== 'D') return null;

  const acum = matchExtratoAcumuladorFornecedor(ctx, {
    date: params.date,
    value: params.value,
    description: params.description,
  });
  if (!acum) return null;

  const historico = params.description ?? '';
  const conta =
    contaContrapartidaFiscal(params.nature, acum, ctx, historico) ||
    acum.contaDebito ||
    acum.contaCredito;

  return {
    kind: 'com_nf',
    contaContrapartida: conta,
    entry: acum,
    score: 100,
  };
}
