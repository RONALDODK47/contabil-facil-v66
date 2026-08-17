import { addDays, format, startOfDay } from 'date-fns';

/** Feriados nacionais (YYYY-MM-DD) — inclui móveis por ano para acúmulo Selic. */
const BR_NATIONAL_HOLIDAYS = new Set([
  // 2023
  '2023-01-01',
  '2023-02-20',
  '2023-02-21',
  '2023-04-07',
  '2023-04-21',
  '2023-05-01',
  '2023-06-08',
  '2023-09-07',
  '2023-10-12',
  '2023-11-02',
  '2023-11-15',
  '2023-12-25',
  // 2024
  '2024-01-01',
  '2024-02-12',
  '2024-02-13',
  '2024-03-29',
  '2024-04-21',
  '2024-05-01',
  '2024-05-30',
  '2024-09-07',
  '2024-10-12',
  '2024-11-02',
  '2024-11-15',
  '2024-11-20',
  '2024-12-25',
  // 2025
  '2025-01-01',
  '2025-03-03',
  '2025-03-04',
  '2025-04-18',
  '2025-04-21',
  '2025-05-01',
  '2025-06-19',
  '2025-09-07',
  '2025-10-12',
  '2025-11-02',
  '2025-11-15',
  '2025-11-20',
  '2025-12-25',
  // 2026–2027 (alinhado ao calendário já usado no ecossistema)
  '2026-01-01',
  '2026-02-16',
  '2026-02-17',
  '2026-04-03',
  '2026-04-21',
  '2026-05-01',
  '2026-06-04',
  '2026-09-07',
  '2026-10-12',
  '2026-11-02',
  '2026-11-15',
  '2026-11-20',
  '2026-12-25',
  '2027-01-01',
  '2027-02-08',
  '2027-02-09',
  '2027-03-26',
  '2027-04-21',
  '2027-05-01',
  '2027-05-27',
  '2027-09-07',
  '2027-10-12',
  '2027-11-02',
  '2027-11-15',
  '2027-11-20',
  '2027-12-25',
]);

/** Feriados extras (calendário dinâmico + opcional localStorage). */
const EXTRA_BANKING_HOLIDAYS = new Set<string>();

/** Inclui feriados nacionais calculados ou personalizados (chamado na inicialização do app). */
export function mergeBankingHolidays(dates: Iterable<string>): void {
  for (const d of dates) {
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
      EXTRA_BANKING_HOLIDAYS.add(d);
    }
  }
}

export function clearMergedBankingHolidays(): void {
  EXTRA_BANKING_HOLIDAYS.clear();
}

export function toYmd(date: Date): string {
  return format(startOfDay(date), 'yyyy-MM-dd');
}

export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

export function isBrazilNationalHoliday(date: Date): boolean {
  const ymd = toYmd(date);
  return BR_NATIONAL_HOLIDAYS.has(ymd) || EXTRA_BANKING_HOLIDAYS.has(ymd);
}

/** Dia útil para acúmulo de indexador (seg–sex, exceto feriado nacional). */
export function isBusinessDay(date: Date): boolean {
  return !isWeekend(date) && !isBrazilNationalHoliday(date);
}

/**
 * Próximo dia útil a partir de `date` (inclusive) — fins de semana e feriados nacionais.
 * Alinha com BB: ex. 10/02/2024 (sáb.) + Carnaval → 14/02/2024.
 */
export function toNextBusinessDay(date: Date): Date {
  let cursor = startOfDay(date);
  let guard = 0;
  while (!isBusinessDay(cursor) && guard < 366) {
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return guard >= 366 ? startOfDay(date) : cursor;
}

/** Dia útil imediatamente anterior a `date` (exclui `date`). */
export function previousBusinessDay(date: Date): Date {
  let cursor = addDays(startOfDay(date), -1);
  let guard = 0;
  while (!isBusinessDay(cursor) && guard < 366) {
    cursor = addDays(cursor, -1);
    guard += 1;
  }
  return guard >= 366 ? startOfDay(date) : cursor;
}

/** Último dia útil no mesmo mês civil de `date` (inclusive). */
function toPreviousBusinessDaySameMonth(date: Date): Date {
  const nominal = startOfDay(date);
  const month = nominal.getMonth();
  const year = nominal.getFullYear();
  let cursor = nominal;
  let guard = 0;
  while (guard < 31) {
    if (isBusinessDay(cursor) && cursor.getMonth() === month && cursor.getFullYear() === year) {
      return cursor;
    }
    cursor = addDays(cursor, -1);
    guard += 1;
  }
  return toNextBusinessDay(nominal);
}

/**
 * Vencimento de parcela: posterga para o próximo dia útil.
 * Se a postergação cair no mês seguinte (ex.: 31/01 domingo → 01/02), antecipa para o
 * último dia útil do mês nominal — evita pular competência mensal no cronograma.
 */
export function adjustInstallmentDueDate(date: Date): Date {
  const nominal = startOfDay(date);
  const forward = toNextBusinessDay(nominal);
  if (forward.getMonth() === nominal.getMonth() && forward.getFullYear() === nominal.getFullYear()) {
    return forward;
  }
  return toPreviousBusinessDaySameMonth(nominal);
}
