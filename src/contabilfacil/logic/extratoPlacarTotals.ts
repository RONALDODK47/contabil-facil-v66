/** Totais do placar (Conciliador) — mesma regra da conciliação pós-import. */

import {
  isExtratoLancamentoConciliado,
  type ExtratoBankRow,
} from './extratoConciliacaoBank';

export type ExtratoPlacarRow = {
  id?: string;
  date?: string;
  description?: string;
  value?: number | string;
  nature?: string;
  accountCode?: string;
  accountDebit?: string;
  accountCredit?: string;
  status?: 'CONCILIADO' | 'PENDENTE' | string;
};

function parsePlacarValor(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.abs(value) : 0;
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const n = Number(raw.replace(/\./g, '').replace(',', '.'));
  if (Number.isFinite(n)) return Math.abs(n);
  return 0;
}

function normalizeNature(nature: unknown): 'D' | 'C' | '' {
  const n = String(nature ?? '').trim().toUpperCase();
  if (n === 'D' || n === 'DEBITO' || n === 'DÉBITO') return 'D';
  if (n === 'C' || n === 'CREDITO' || n === 'CRÉDITO') return 'C';
  return '';
}

function lancamentoEhSaldoInformativo(description: string): boolean {
  const d = description.toUpperCase();
  return (
    /SALDO\s+ANTERIOR/.test(d) ||
    /SALDO\s+TOTAL\s+DISPON/.test(d) ||
    /SALDO\s+DO\s+DIA/.test(d) ||
    /^SALDO\s*$/.test(d.trim())
  );
}

function chaveDedup(row: ExtratoPlacarRow): string {
  const v = parsePlacarValor(row.value).toFixed(2);
  const nat = normalizeNature(row.nature) || 'X';
  const desc = String(row.description ?? '').trim().toUpperCase().slice(0, 40);
  const date = String(row.date ?? '').trim();
  return `${date}|${v}|${nat}|${desc}`;
}

export function sumExtratoPlacarTotais(rows: ExtratoPlacarRow[]): {
  creditos: number;
  debitos: number;
  lancamentosConsiderados: number;
} {
  const vistos = new Set<string>();
  let creditos = 0;
  let debitos = 0;
  let lancamentosConsiderados = 0;

  for (const row of rows) {
    const desc = String(row.description ?? '').trim();
    if (lancamentoEhSaldoInformativo(desc)) continue;

    const rawNum =
      typeof row.value === 'number'
        ? row.value
        : Number(String(row.value ?? '').trim().replace(/\./g, '').replace(',', '.'));
    const value = parsePlacarValor(row.value);
    if (value <= 0.0001) continue;

    const key = row.id ? `id:${row.id}` : chaveDedup(row);
    if (vistos.has(key)) continue;
    vistos.add(key);

    // Natureza explícita D/C; se faltar, sinal do valor (negativo = saída/D).
    let nature = normalizeNature(row.nature);
    if (!nature) {
      nature = Number.isFinite(rawNum) && rawNum < 0 ? 'D' : 'C';
    }
    if (nature === 'D') debitos += value;
    else creditos += value;
    lancamentosConsiderados += 1;
  }

  return {
    creditos: Math.round(creditos * 100) / 100,
    debitos: Math.round(debitos * 100) / 100,
    lancamentosConsiderados,
  };
}

export function calcExtratoSaldoConciliado(
  saldoAnterior: number,
  creditos: number,
  debitos: number,
): number {
  const sa = Number.isFinite(saldoAnterior) ? saldoAnterior : 0;
  return Math.round((sa + creditos - debitos) * 100) / 100;
}

/**
 * Linha conta para o placar "Saldo Conciliado" só se já tem as duas contas
 * preenchidas na linha (não basta accountCode legado / só banco).
 */
export function isExtratoLinhaConciliadaParaPlacar(row: ExtratoBankRow): boolean {
  const deb = row.accountDebit?.trim() || '';
  const cred = row.accountCredit?.trim() || '';
  if (!deb || !cred) return false;
  if (deb.replace(/\D/g, '') === cred.replace(/\D/g, '')) return false;
  return isExtratoLancamentoConciliado(row);
}

/** Totais só das linhas já conciliadas (débito + crédito preenchidos e distintos). */
export function sumExtratoPlacarTotaisConciliados(rows: ExtratoBankRow[]): {
  creditos: number;
  debitos: number;
  lancamentosConsiderados: number;
} {
  const conciliados = rows.filter(isExtratoLinhaConciliadaParaPlacar);
  return sumExtratoPlacarTotais(conciliados);
}

/**
 * Saldo do que já foi conciliado até o momento.
 * Sem nenhum lançamento com contas → R$ 0 (não repete o saldo final / anterior).
 * Com conciliados → anterior + créditos conciliados − débitos conciliados.
 */
export function calcSaldoConciliadoAteMomento(
  saldoAnterior: number,
  rows: ExtratoBankRow[],
): number {
  const { creditos, debitos, lancamentosConsiderados } =
    sumExtratoPlacarTotaisConciliados(rows);
  if (lancamentosConsiderados === 0) return 0;
  return calcExtratoSaldoConciliado(saldoAnterior, creditos, debitos);
}

/**
 * Saldo final do extrato no placar: SEMPRE calculado.
 * Anterior + créditos − débitos (nunca OCR / saldo lido do PDF).
 */
export function resolveSaldoFinalExtrato(params: {
  saldoAnterior: number;
  creditos: number;
  debitos: number;
  /** @deprecated Ignorado — placar não usa saldo de arquivo/OCR. */
  saldoFinalArquivo?: number | null;
}): { valor: number; origem: 'calculado' } {
  return {
    valor: calcExtratoSaldoConciliado(params.saldoAnterior, params.creditos, params.debitos),
    origem: 'calculado',
  };
}
