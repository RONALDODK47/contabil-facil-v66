import { addDays, format, startOfDay } from 'date-fns';

/** Domingo de Páscoa (calendário gregoriano) — base dos feriados móveis nacionais. */
export function easterSundayUtc(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return startOfDay(new Date(year, month - 1, day));
}

function toYmd(date: Date): string {
  return format(startOfDay(date), 'yyyy-MM-dd');
}

/**
 * Feriados nacionais fixos + móveis (CMN / calendário bancário Febraban–ANBIMA).
 * Inclui Consciência Negra (20/11) a partir de 2024.
 */
export function computeNationalBankingHolidaysForYear(year: number): string[] {
  const fixed = [
    `${year}-01-01`,
    `${year}-04-21`,
    `${year}-05-01`,
    `${year}-09-07`,
    `${year}-10-12`,
    `${year}-11-02`,
    `${year}-12-25`,
  ];
  if (year >= 2024) fixed.push(`${year}-11-20`);

  const easter = easterSundayUtc(year);
  const movable = [
    addDays(easter, -48),
    addDays(easter, -47),
    addDays(easter, -2),
    addDays(easter, 60),
  ].map(toYmd);

  return [...fixed, ...movable];
}
