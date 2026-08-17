import * as XLSX from 'xlsx';
import { format } from 'date-fns';

function cellToDisplay(v: unknown): string {
  if (v == null || v === '') return '';
  if (v instanceof Date) return format(v, 'dd/MM/yyyy');
  if (typeof v === 'number' && Number.isFinite(v))
    return String(v).includes('e') ? v.toFixed(2).replace('.', ',') : String(v);
  return String(v).trim();
}

/** Lê a primeira planilha do arquivo Excel e devolve linhas como string[][]. */
export async function excelFileToRows(file: File, maxRows = 50000): Promise<string[][]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true, dense: false });
  const first = wb.SheetNames[0];
  if (!first) return [];
  const ws = wb.Sheets[first];
  const raw = XLSX.utils.sheet_to_json<(string | number | boolean | Date | null | undefined)[]>(ws, {
    header: 1,
    defval: '',
    raw: false,
  }) as unknown[][];

  const out: string[][] = [];
  for (let i = 0; i < raw.length && out.length < maxRows; i++) {
    const line = raw[i];
    if (!line || !line.length) continue;
    const strRow = line.map((c) => cellToDisplay(c as unknown));
    if (strRow.some((x) => x !== '')) out.push(strRow);
  }
  return out;
}
