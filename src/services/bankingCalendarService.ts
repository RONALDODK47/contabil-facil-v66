import { clearMergedBankingHolidays, mergeBankingHolidays } from '../lib/brBusinessDays';
import { computeNationalBankingHolidaysForYear } from '../lib/brazilianEaster';

const STORAGE_KEY = 'contabilfacil_banking_calendar_extra_v1';
const API_CACHE_KEY = 'contabilfacil_banking_calendar_api_v1';
export const YEAR_FROM = 2018;
export const YEAR_TO = 2035;

const BRASIL_API_BASES = ['/api/brasilapi', 'https://brasilapi.com.br'] as const;

export type BankingCalendarSource = 'computed' | 'api' | 'api+cache' | 'cache';

let lastCalendarSource: BankingCalendarSource = 'computed';
let lastCalendarUpdatedAt: string | null = null;

export function getBankingCalendarMeta(): { source: BankingCalendarSource; updatedAt: string | null } {
  return { source: lastCalendarSource, updatedAt: lastCalendarUpdatedAt };
}

interface ApiCachePayload {
  updatedAt: string;
  years: Record<string, string[]>;
}

function readApiCache(): ApiCachePayload | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(API_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ApiCachePayload;
    if (!parsed?.years || typeof parsed.years !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeApiCache(payload: ApiCachePayload): void {
  if (typeof localStorage === 'undefined') return;
  try {
    // ⚠️ DISABLED: Salva SOMENTE no Docker, não em localStorage
    // localStorage.setItem(API_CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

function normalizeHolidayDate(value: string): string | null {
  if (typeof value !== 'string') return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Feriados nacionais de um ano (Brasil API — móveis + fixos). */
export async function fetchNationalHolidaysForYear(year: number): Promise<string[]> {
  let lastErr: unknown;
  for (const base of BRASIL_API_BASES) {
    try {
      const res = await fetch(`${base}/api/feriados/v1/${year}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as Array<{ date?: string }>;
      if (!Array.isArray(data)) throw new Error('resposta inválida');
      const dates = data
        .map((row) => normalizeHolidayDate(row.date ?? ''))
        .filter((d): d is string => d != null);
      return [...new Set(dates)];
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Brasil API indisponível');
}

/** Ping para barra de status (ano corrente). */
export async function pingBankingCalendarApi(): Promise<boolean> {
  const year = new Date().getFullYear();
  try {
    await fetchNationalHolidaysForYear(year);
    return true;
  } catch {
    return computeNationalBankingHolidaysForYear(year).length > 0;
  }
}

function applyComputedHolidays(yearFrom: number, yearTo: number): void {
  for (let year = yearFrom; year <= yearTo; year++) {
    mergeBankingHolidays(computeNationalBankingHolidaysForYear(year));
  }
}

function applyCachedApiHolidays(cache: ApiCachePayload, yearFrom: number, yearTo: number): number {
  let count = 0;
  for (let year = yearFrom; year <= yearTo; year++) {
    const list = cache.years[String(year)];
    if (list?.length) {
      mergeBankingHolidays(list);
      count += list.length;
    }
  }
  if (count > 0) {
    lastCalendarUpdatedAt = cache.updatedAt;
  }
  return count;
}

/**
 * Calendário bancário local (Páscoa + feriados fixos + extras do usuário).
 * Rápido e offline — base para contagem de DU.
 */
export function hydrateBankingCalendarFromStorage(): void {
  clearMergedBankingHolidays();
  applyComputedHolidays(YEAR_FROM, YEAR_TO);
  lastCalendarSource = 'computed';
  lastCalendarUpdatedAt = null;

  const apiCache = readApiCache();
  if (apiCache && applyCachedApiHolidays(apiCache, YEAR_FROM, YEAR_TO) > 0) {
    lastCalendarSource = 'api+cache';
  }

  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      mergeBankingHolidays(parsed);
    }
  } catch {
    /* ignore corrupt storage */
  }
}

/**
 * Atualiza feriados via Brasil API (feriados nacionais) e persiste cache local.
 * Falha silenciosa: mantém calendário computado já carregado.
 */
export async function hydrateBankingCalendarFromRemote(
  yearFrom = YEAR_FROM,
  yearTo = YEAR_TO,
): Promise<boolean> {
  hydrateBankingCalendarFromStorage();
  const years: number[] = [];
  for (let y = yearFrom; y <= yearTo; y++) years.push(y);

  const cache: ApiCachePayload = { updatedAt: new Date().toISOString(), years: {} };
  let fetched = 0;

  await Promise.all(
    years.map(async (year) => {
      try {
        const dates = await fetchNationalHolidaysForYear(year);
        cache.years[String(year)] = dates;
        mergeBankingHolidays(dates);
        fetched += 1;
      } catch {
        /* mantém computado + cache parcial */
      }
    }),
  );

  if (fetched > 0) {
    writeApiCache(cache);
    lastCalendarSource = 'api';
    lastCalendarUpdatedAt = cache.updatedAt;
    return true;
  }
  return false;
}

/** Persiste feriados adicionais (YYYY-MM-DD) para o próximo carregamento. */
export function saveExtraBankingHolidays(dates: string[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    // ⚠️ DISABLED: Salva SOMENTE no Docker, não em localStorage
    // localStorage.setItem(STORAGE_KEY, JSON.stringify(dates));
  } catch {
    /* quota / private mode */
  }
  hydrateBankingCalendarFromStorage();
}
