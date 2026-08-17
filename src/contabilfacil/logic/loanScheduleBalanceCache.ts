import { format } from 'date-fns';
import type { LoanRow } from '../../lib/loanCalculator';
import { normalizeCompanyName } from './companyWorkspace';
import { writePersistedLocalStorageJson } from '../../lib/persistentLocalStorage';

/**
 * Cache do saldo devedor (curto + longo prazo) que a TABELA do empréstimo calcula
 * mês a mês — gravado toda vez que o cronograma é enviado ao balancete (única hora
 * em que os indicadores do BCB já foram resolvidos). Permite comparar "saldo real do
 * razão" contra "saldo da tabela" em telas que não têm acesso aos indicadores
 * (ex.: Automação do Balancete), sem recalcular o empréstimo.
 */
export interface LoanScheduleBalancePoint {
  /** yyyy-MM-dd — data da linha do cronograma. */
  data: string;
  saldoTotal: number;
  saldoCurto: number;
  saldoLongo: number;
}

export interface LoanScheduleBalanceCache {
  contratoId: string;
  atualizadoEm: string;
  pontos: LoanScheduleBalancePoint[];
}

const STORAGE_KEY = 'contabilfacil_loan_schedule_balance_cache_v1';

type Payload = Record<string, Record<string, LoanScheduleBalanceCache>>;

function readRaw(): Payload {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Payload) : {};
  } catch {
    return {};
  }
}

/** Grava o cronograma recém-calculado (com indicadores já resolvidos) para este contrato. */
export function salvarLoanScheduleBalanceCache(
  companyName: string,
  contratoId: string,
  schedule: LoanRow[],
): void {
  const company = normalizeCompanyName(companyName);
  const id = contratoId.trim();
  if (!company || !id) return;

  const pontos: LoanScheduleBalancePoint[] = schedule
    .filter((r) => r.date instanceof Date && !Number.isNaN(r.date.getTime()))
    .map((r) => ({
      data: format(r.date, 'yyyy-MM-dd'),
      saldoTotal: r.finalBalance ?? 0,
      saldoCurto: r.shortTermBalance ?? 0,
      saldoLongo: r.longTermBalance ?? 0,
    }));
  if (!pontos.length) return;

  const all = readRaw();
  if (!all[company]) all[company] = {};
  all[company][id] = {
    contratoId: id,
    atualizadoEm: new Date().toISOString(),
    pontos,
  };
  writePersistedLocalStorageJson(STORAGE_KEY, all);
}

export function lerLoanScheduleBalanceCache(
  companyName: string,
  contratoId: string,
): LoanScheduleBalanceCache | null {
  const company = normalizeCompanyName(companyName);
  const id = contratoId.trim();
  if (!company || !id) return null;
  return readRaw()[company]?.[id] ?? null;
}

/**
 * Saldo total esperado (curto + longo prazo) na data de referência (padrão: hoje) —
 * usa o ponto do cronograma mais próximo sem ultrapassar a referência; se a
 * referência for anterior a todos os pontos, usa o primeiro (saldo inicial).
 */
export function saldoTabelaNaData(
  cache: LoanScheduleBalanceCache | null,
  referencia: Date = new Date(),
): number | null {
  if (!cache || !cache.pontos.length) return null;
  const refTime = referencia.getTime();
  let melhor: LoanScheduleBalancePoint | null = null;
  for (const p of cache.pontos) {
    const t = new Date(p.data).getTime();
    if (t <= refTime && (!melhor || t > new Date(melhor.data).getTime())) {
      melhor = p;
    }
  }
  return melhor ? melhor.saldoTotal : cache.pontos[0].saldoTotal;
}

/**
 * Saldo curto prazo esperado na data de referência (padrão: hoje).
 */
export function saldoCurtoTabelaNaData(
  cache: LoanScheduleBalanceCache | null,
  referencia: Date = new Date(),
): number | null {
  if (!cache || !cache.pontos.length) return null;
  const refTime = referencia.getTime();
  let melhor: LoanScheduleBalancePoint | null = null;
  for (const p of cache.pontos) {
    const t = new Date(p.data).getTime();
    if (t <= refTime && (!melhor || t > new Date(melhor.data).getTime())) {
      melhor = p;
    }
  }
  return melhor ? melhor.saldoCurto : cache.pontos[0].saldoCurto;
}

/**
 * Saldo longo prazo esperado na data de referência (padrão: hoje).
 */
export function saldoLongoTabelaNaData(
  cache: LoanScheduleBalanceCache | null,
  referencia: Date = new Date(),
): number | null {
  if (!cache || !cache.pontos.length) return null;
  const refTime = referencia.getTime();
  let melhor: LoanScheduleBalancePoint | null = null;
  for (const p of cache.pontos) {
    const t = new Date(p.data).getTime();
    if (t <= refTime && (!melhor || t > new Date(melhor.data).getTime())) {
      melhor = p;
    }
  }
  return melhor ? melhor.saldoLongo : cache.pontos[0].saldoLongo;
}
