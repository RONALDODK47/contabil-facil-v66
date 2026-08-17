import type { BankStatementRecord } from './bankStatementParse';
import { parseBrMoneyCell } from './bankStatementParse';

/** Converte período opcional tipo MM/AAAA, DD/MM/AAAA em limites inclusivos (UTC meio-dia local). */
export function parseBrPeriodBounds(fromStr: string, toStr: string): { t0: number; t1: number } | null {
  const f = fromStr.trim();
  const t = toStr.trim();
  if (!f || !t) return null;

  const parseSide = (
    raw: string,
    which: 'from' | 'to'
  ): { y: number; m: number; d: number } | null => {
    const parts = raw.split('/');
    if (parts.length >= 3) {
      const d = parseInt(parts[0], 10);
      const mo = parseInt(parts[1], 10);
      let y = parseInt(parts[2], 10);
      if (parts[2].length === 2) y += y < 75 ? 2000 : 1900;
      if (!Number.isFinite(d) || !Number.isFinite(mo) || !Number.isFinite(y)) return null;
      return { y, m: mo, d };
    }
    if (parts.length === 2) {
      const mo = parseInt(parts[0], 10);
      let y = parseInt(parts[1], 10);
      if (parts[1].length === 2) y += y < 75 ? 2000 : 1900;
      if (!Number.isFinite(mo) || !Number.isFinite(y)) return null;
      if (which === 'from') return { y, m: mo, d: 1 };
      const last = new Date(y, mo, 0).getDate();
      return { y, m: mo, d: last };
    }
    return null;
  };

  const fs = parseSide(f, 'from');
  const ts = parseSide(t, 'to');
  if (!fs || !ts) return null;

  const t0 = new Date(fs.y, fs.m - 1, fs.d).getTime();
  const t1 = new Date(ts.y, ts.m - 1, ts.d).setHours(23, 59, 59, 999);
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t0 > t1) return null;
  return { t0, t1 };
}

export function filterBankRecordsByPeriod(
  rows: BankStatementRecord[],
  fromStr: string,
  toStr: string
): BankStatementRecord[] {
  const b = parseBrPeriodBounds(fromStr, toStr);
  if (!b) return rows;
  return rows.filter((r) => {
    if (!r.data || !/^\d{4}-\d{2}-\d{2}$/.test(r.data)) return true;
    const [y, m, d] = r.data.split('-').map((x) => parseInt(x, 10));
    const time = new Date(y, m - 1, d).getTime();
    return time >= b.t0 && time <= b.t1;
  });
}

/** Quebra OCR em linhas não vazias. */
export function plainTextLinesToMatrix(text: string): string[][] {
  const lines = text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 3);
  return lines.map((l) => {
    const parts = l.split(/\s{2,}|\t+/).map((x) => x.trim()).filter(Boolean);
    if (parts.length >= 2) return parts;
    return [l];
  });
}

function isoFromParts(d: number, mo: number, y: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Parser genérico estilo “Extrato Vision”: linha com data inicial, histórico e valor monetário BR no fim;
 * sufixo opcional D (débito) / C (crédito).
 */
export function parsePlainTextToBankRecords(
  text: string,
  options?: { inferredYear?: string; dateFrom?: string; dateTo?: string }
): BankStatementRecord[] {
  const defaultY =
    options?.inferredYear && /^\d{4}$/.test(options.inferredYear)
      ? parseInt(options.inferredYear, 10)
      : new Date().getFullYear();

  const lines = text.split(/\r?\n/);
  const out: BankStatementRecord[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length < 6) continue;

    const dm = line.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?(?:\s+|$)/);
    if (!dm) continue;

    const d = parseInt(dm[1], 10);
    const mo = parseInt(dm[2], 10);
    let y = dm[3] != null && dm[3] !== '' ? parseInt(dm[3], 10) : defaultY;
    if (dm[3] != null && dm[3].length === 2) y = 2000 + y;

    const dataIso = isoFromParts(d, mo, y);
    if (!dataIso) continue;

    const rest = line.slice(dm[0].length).trim();
    if (!rest) continue;

    const moneyDc = rest.match(
      /\s+([\d]{1,3}(?:\.[\d]{3})*,\d{2}|\d+,\d{2})\s*([DC])\s*$/i
    );
    const moneyOnly = rest.match(/\s+([\d]{1,3}(?:\.[\d]{3})*,\d{2}|\d+,\d{2})\s*$/i);

    let historico: string;
    let valorRaw: string;
    let tipo: string | null = null;

    if (moneyDc) {
      historico = rest.slice(0, rest.length - moneyDc[0].length).trim();
      valorRaw = moneyDc[1];
      tipo = (moneyDc[2] || '').toUpperCase();
    } else if (moneyOnly) {
      historico = rest.slice(0, rest.length - moneyOnly[0].length).trim();
      valorRaw = moneyOnly[1];
    } else continue;

    if (!historico) continue;

    const valor = parseBrMoneyCell(valorRaw);
    if (valor == null || valor === 0) continue;

    let valor_debito: number | null = null;
    let valor_credito: number | null = null;
    if (tipo === 'D') valor_debito = Math.abs(valor);
    else if (tipo === 'C') valor_credito = Math.abs(valor);
    else {
      if (valor < 0) valor_debito = Math.abs(valor);
      else valor_credito = Math.abs(valor);
    }

    out.push({
      data: dataIso,
      historico,
      valor_debito,
      valor_credito,
      codigo_historico: null,
      complemento: null,
      ignorar: null,
    });
  }

  const filtered = filterBankRecordsByPeriod(out, options?.dateFrom ?? '', options?.dateTo ?? '');
  return filtered;
}
