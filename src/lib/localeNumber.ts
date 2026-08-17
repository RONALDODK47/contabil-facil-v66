/**
 * Parsing numérico tolerante: aceita vírgula ou ponto como decimal
 * e também separadores de milhar (30.000 / 30,000).
 */

function stripNonNumeric(raw: string): string {
  let s = raw.trim().replace(/\s/g, '');
  const negative = s.startsWith('-');
  if (negative) s = s.slice(1);
  s = s.replace(/[^\d,.]/g, '');
  return negative ? `-${s}` : s;
}

function normalizeNumericToken(token: string): string {
  const t = token.trim();
  if (!t || t === '-' || t === ',' || t === '.') return '';

  const negative = t.startsWith('-');
  let s = negative ? t.slice(1) : t;
  if (!s) return '';

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  let normalized: string;

  if (hasComma && hasDot) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      normalized = s.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    const parts = s.split(',');
    const last = parts[parts.length - 1] ?? '';
    if (parts.length > 1 && last.length === 3 && parts.slice(0, -1).every((p) => p.length > 0)) {
      normalized = parts.join('');
    } else if (parts.length > 1) {
      normalized = `${parts.slice(0, -1).join('')}.${last}`;
    } else {
      normalized = s.replace(',', '.');
    }
  } else if (hasDot) {
    const parts = s.split('.');
    const last = parts[parts.length - 1] ?? '';
    if (parts.length > 1 && last.length === 3 && parts.slice(0, -1).every((p) => p.length > 0)) {
      normalized = parts.join('');
    } else if (parts.length > 1 && last.length <= 2) {
      normalized = s;
    } else if (parts.length > 1) {
      normalized = parts.join('');
    } else {
      normalized = s;
    }
  } else {
    normalized = s;
  }

  return negative ? `-${normalized}` : normalized;
}

/** Mantém dígitos, vírgulas, pontos e sinal negativo (no início). */
export function sanitizeNumericDraft(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if ((ch >= '0' && ch <= '9') || ch === ',' || ch === '.') {
      out += ch;
    } else if (ch === '-' && out.length === 0) {
      out += ch;
    }
  }
  return out;
}

/**
 * Taxa/percentual (ex.: "1,25" ou "1.25" = 1,25%). Nunca trata ponto como separador de
 * milhar — diferente de valores monetários, uma taxa nunca é "mil e tantos por cento",
 * então "1.032" tem que virar 1,032 e não 1032 (bug que gerava parcelas absurdas).
 */
export function parseLocaleRatePercent(raw: string, fallback = 0): number {
  const cleaned = stripNonNumeric(raw);
  if (!cleaned || cleaned === '-' || cleaned === ',' || cleaned === '.') return fallback;

  const negative = cleaned.startsWith('-');
  const s = negative ? cleaned.slice(1) : cleaned;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  let normalized: string;
  if (hasComma && hasDot) {
    normalized =
      s.lastIndexOf(',') > s.lastIndexOf('.')
        ? s.replace(/\./g, '').replace(',', '.')
        : s.replace(/,/g, '');
  } else if (hasComma) {
    normalized = s.replace(',', '.');
  } else {
    normalized = s; // ponto isolado (com qualquer nº de casas) = sempre decimal em taxa
  }

  const n = Number(negative ? `-${normalized}` : normalized);
  return Number.isFinite(n) ? n : fallback;
}

export function parseLocaleNumber(raw: string, fallback = 0): number {
  const cleaned = stripNonNumeric(raw);
  if (!cleaned || cleaned === '-' || cleaned === ',' || cleaned === '.') return fallback;

  const normalized = normalizeNumericToken(cleaned);
  if (!normalized || normalized === '-' || normalized === '.' || normalized === '-.') {
    return fallback;
  }

  const n = Number(normalized);
  return Number.isFinite(n) ? n : fallback;
}

/** Retorna null se o texto ainda é digitação parcial (ex.: termina em ","). */
export function tryParseLocaleNumber(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return 0;
  if (t === '-' || t === ',' || t === '.') return null;
  if (t.endsWith(',') || t.endsWith('.')) {
    const head = t.slice(0, -1);
    if (head === '' || head === '-') return null;
    const n = parseLocaleNumber(head, Number.NaN);
    return Number.isFinite(n) ? n : null;
  }
  const n = parseLocaleNumber(t, Number.NaN);
  return Number.isFinite(n) ? n : null;
}

/**
 * Formata número para exibição em input no padrão BR:
 * ponto de milhar + vírgula decimal (ex.: 6.268,75).
 * Aceita o mesmo formato de volta em parseLocaleNumber.
 */
export function formatLocaleNumberForInput(value: number, maxDecimals = 6): string {
  if (!Number.isFinite(value) || value === 0) return '';
  const factor = 10 ** maxDecimals;
  const rounded = Math.round(value * factor) / factor;
  return rounded.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
    useGrouping: true,
  });
}
