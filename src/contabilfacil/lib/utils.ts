import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  formatLocaleNumberForInput,
  parseLocaleNumber,
  tryParseLocaleNumber,
} from '../../lib/localeNumber';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export { formatLocaleNumberForInput, parseLocaleNumber, tryParseLocaleNumber };

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

/** Exibe vazio quando o valor é 0, para não atrapalhar a digitação em inputs numéricos. */
export function emptyIfZero(n: number | undefined | null): string {
  if (n == null || n === 0) return '';
  return String(n);
}

/** Formata número de estoque/preço para input sem artefatos de float (ex.: 5.7349999 → 5.735). */
export function formatStockNumberForInput(value: number, decimals = 6): string {
  return formatLocaleNumberForInput(value, decimals);
}

/** @deprecated Use parseLocaleNumber — mantido para compatibilidade. */
export function parseOptionalNumber(raw: string, fallback = 0): number {
  return parseLocaleNumber(raw, fallback);
}

/**
 * Mesmo parser usado por `formatDate` — exportado para que a exportação TXT
 * Domínio leia a data EXATAMENTE como a tabela da conciliação a interpreta.
 * Sem isso, tela e arquivo podiam discordar (tabela certa, TXT com ano errado).
 */
export function parseDateInput(date: string | Date | null | undefined): Date | null {
  if (date == null) return null;
  if (date instanceof Date) {
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const s = String(date).trim();
  if (!s) return null;

  const br = s.match(/^(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2,4})$/);
  if (br) {
    const dd = br[1].padStart(2, '0');
    const mm = br[2].padStart(2, '0');
    let yyyy = br[3];
    if (yyyy.length === 2) yyyy = `20${yyyy}`;
    const d = new Date(`${yyyy}-${mm}-${dd}T12:00:00`);
    if (!Number.isNaN(d.getTime())) return d;
  }

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T12:00:00`);
    if (!Number.isNaN(d.getTime())) return d;
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(date: string | Date | null | undefined, fallback = '—') {
  const d = parseDateInput(date);
  if (!d) return fallback;
  return new Intl.DateTimeFormat('pt-BR').format(d);
}

export function normalizeDateIso(s: string | undefined): string {
  const today = new Date().toISOString().split('T')[0];
  if (!s?.trim()) return today;
  const d = parseDateInput(s);
  if (!d) return today;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
