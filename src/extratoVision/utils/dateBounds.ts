/** Converte DD/MM/AAAA, ano 2 dígitos ou ISO YYYY-MM-DD em timestamp; null se inválido. */
export function parseBrDateToTime(data: string): number | null {
  const raw = data.trim();
  if (!raw) return null;

  // ISO YYYY-MM-DD (extrato/OFX) — antes do split por "/", evita 2026-06-01 → inválido
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (iso) {
    const year = parseInt(iso[1], 10);
    const month = parseInt(iso[2], 10);
    const day = parseInt(iso[3], 10);
    if (Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year)) return null;
    const t = new Date(year, month - 1, day).getTime();
    return Number.isNaN(t) ? null : t;
  }

  const dParts = raw.split('/');
  if (dParts.length !== 3) return null;
  let cYear = dParts[2].trim();
  if (cYear.length === 2) cYear = '20' + cYear;
  const day = parseInt(dParts[0], 10);
  const month = parseInt(dParts[1], 10);
  const year = parseInt(cYear, 10);
  if (Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year)) return null;
  const t = new Date(year, month - 1, day).getTime();
  return Number.isNaN(t) ? null : t;
}

export function resolveDateRangeBounds(dateRange?: {
  from: string;
  to: string;
}): { fTime: number; tTime: number } {
  let fTime = 0;
  let tTime = 0;
  if (!dateRange?.from || !dateRange?.to) return { fTime, tTime };

  const fParts = dateRange.from.split('/');
  const tParts = dateRange.to.split('/');
  if (fParts.length < 2 || tParts.length < 2) return { fTime, tTime };

  let fDay = 1;
  let fMonth = 1;
  let fYear = new Date().getFullYear();
  if (fParts.length === 3) {
    fDay = parseInt(fParts[0], 10);
    fMonth = parseInt(fParts[1], 10);
    fYear = parseInt(fParts[2].length === 2 ? '20' + fParts[2] : fParts[2], 10);
  } else if (fParts.length === 2) {
    fDay = 1;
    fMonth = parseInt(fParts[0], 10);
    fYear = parseInt(fParts[1].length === 2 ? '20' + fParts[1] : fParts[1], 10);
  }

  let tDay = 31;
  let tMonth = 12;
  let tYear = new Date().getFullYear();
  if (tParts.length === 3) {
    tDay = parseInt(tParts[0], 10);
    tMonth = parseInt(tParts[1], 10);
    tYear = parseInt(tParts[2].length === 2 ? '20' + tParts[2] : tParts[2], 10);
  } else if (tParts.length === 2) {
    tMonth = parseInt(tParts[0], 10);
    tYear = parseInt(tParts[1].length === 2 ? '20' + tParts[1] : tParts[1], 10);
    tDay = new Date(tYear, tMonth, 0).getDate();
  }

  if (
    Number.isNaN(fDay) ||
    Number.isNaN(fMonth) ||
    Number.isNaN(fYear) ||
    Number.isNaN(tDay) ||
    Number.isNaN(tMonth) ||
    Number.isNaN(tYear)
  ) {
    return { fTime: 0, tTime: 0 };
  }

  fTime = new Date(fYear, fMonth - 1, fDay).getTime();
  tTime = new Date(tYear, tMonth - 1, tDay).getTime();
  if (Number.isNaN(fTime) || Number.isNaN(tTime)) return { fTime: 0, tTime: 0 };
  return { fTime, tTime };
}

export function isTransactionInDateRange(
  data: string,
  fTime: number,
  tTime: number
): boolean {
  if (fTime <= 0 || tTime <= 0) return true;
  const dTime = parseBrDateToTime(data);
  if (dTime === null) return true;
  return dTime >= fTime && dTime <= tTime;
}
