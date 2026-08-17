function parseBrOrIso(s: string): Date | null {
  const t = s.trim();
  if (!t) return null;

  const br = t.match(/^(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2,4})$/);
  if (br) {
    const dd = br[1].padStart(2, '0');
    const mm = br[2].padStart(2, '0');
    let yyyy = br[3];
    if (yyyy.length === 2) yyyy = `20${yyyy}`;
    const d = new Date(`${yyyy}-${mm}-${dd}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

/** Interpreta data única ou intervalo «dd/mm/aaaa — dd/mm/aaaa». */
export function parseFiscalDataRef(data: string): { start: Date | null; end: Date | null } {
  const s = (data ?? '').trim();
  if (!s || s === '—') return { start: null, end: null };

  const parts = s.split(/\s*[—–]\s*/);
  if (parts.length === 2) {
    const start = parseBrOrIso(parts[0]!);
    const end = parseBrOrIso(parts[1]!);
    return { start, end: end ?? start };
  }

  const d = parseBrOrIso(s);
  return { start: d, end: d };
}

/** Verifica se a referência de data intersecta o intervalo do filtro (ISO yyyy-mm-dd). */
export function fiscalDataNoIntervalo(
  data: string,
  inicioIso?: string,
  fimIso?: string,
): boolean {
  if (!inicioIso && !fimIso) return true;

  const { start, end } = parseFiscalDataRef(data);
  const rowStart = start ?? end;
  const rowEnd = end ?? start;
  if (!rowStart && !rowEnd) return true;

  const filterStart = inicioIso ? new Date(`${inicioIso}T00:00:00`) : null;
  const filterEnd = fimIso ? new Date(`${fimIso}T23:59:59.999`) : null;

  const rs = rowStart ?? rowEnd!;
  const re = rowEnd ?? rowStart!;

  if (filterStart && re < filterStart) return false;
  if (filterEnd && rs > filterEnd) return false;
  return true;
}
