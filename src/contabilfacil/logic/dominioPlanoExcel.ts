import * as XLSX from 'xlsx';
import type { VisionPlanoRow } from '../../extratoVision/types/accounting';
import { acceptCodigoReduzidoFromFile } from './planoContasMapper';
import { inferAccountTypes } from '../../extratoVision/utils/planilhaModelo';

function normCell(val: unknown): string {
  return String(val ?? '')
    .trim()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

function cellStr(val: unknown): string {
  return String(val ?? '').trim();
}

function codeLengthToLevel(len: number): number {
  if (len <= 1) return 1;
  if (len <= 2) return 2;
  if (len <= 3) return 3;
  if (len <= 5) return 4;
  if (len <= 10) return 5;
  return 6;
}

/** Arquivo OLE (.xls legado) — inclusive exportação Domínio salva como .csv. */
export function isOleCompoundFile(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

export function extractOleWorkbookStream(bytes: Uint8Array): Uint8Array | null {
  try {
    const cfb = XLSX.CFB.read(bytes, { type: 'array' });
    const pathIdx = cfb.FullPaths.findIndex((p: string) => /workbook$/i.test(p));
    if (pathIdx < 0) return null;
    const entry = cfb.FileIndex[pathIdx];
    if (!entry?.content) return null;
    return entry.content as Uint8Array;
  } catch {
    return null;
  }
}

function rkValue(rk: number): number {
  if (rk & 2) {
    let val = rk >> 2;
    if (rk & 1) val /= 100;
    return val;
  }
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(0, (rk & 0xfffffffc) >>> 0, true);
  view.setUint32(4, 0, true);
  return view.getFloat64(0, true);
}

function readXlUnicode(payload: Uint8Array, start: number, slen: number, is16: boolean): string {
  if (is16) {
    const slice = payload.subarray(start, start + slen * 2);
    return new TextDecoder('utf-16le').decode(slice);
  }
  return new TextDecoder('latin1').decode(payload.subarray(start, start + slen));
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** Concatena SST + registros CONTINUE seguintes (BIFF8). */
function slurpSstPayload(bytes: Uint8Array, pos: number): { payload: Uint8Array; nextPos: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [];
  let p = pos;
  const rlen = view.getUint16(p + 2, true);
  parts.push(bytes.subarray(p + 4, p + 4 + rlen));
  p += 4 + rlen;
  while (p + 4 <= bytes.length) {
    const nt = view.getUint16(p, true);
    if (nt !== 0x003c) break;
    const nl = view.getUint16(p + 2, true);
    parts.push(bytes.subarray(p + 4, p + 4 + nl));
    p += 4 + nl;
  }
  return { payload: concatChunks(parts), nextPos: p };
}

function parseSst(payload: Uint8Array): string[] {
  if (payload.length < 8) return [];
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const unique = view.getUint32(4, true);
  const strs: string[] = [];
  let p = 8;
  while (strs.length < unique && p < payload.length) {
    if (p + 3 > payload.length) break;
    const cch = view.getUint16(p, true);
    p += 2;
    const flags = payload[p]!;
    p += 1;
    const is16 = (flags & 1) === 1;
    const rich = (flags >> 3) & 0xf;
    const ext = (flags >> 2) & 1;
    if (ext) p += 4;
    if (rich) p += 2 * rich;
    const byteLen = is16 ? cch * 2 : cch;
    if (p + byteLen > payload.length) break;
    strs.push(readXlUnicode(payload, p, cch, is16));
    p += byteLen;
  }
  return strs;
}

function biffBytes(data: Uint8Array): Uint8Array {
  return data.byteOffset === 0 && data.byteLength === data.buffer.byteLength && data.buffer instanceof ArrayBuffer
    ? data
    : new Uint8Array(data);
}

/** Lê planilha BIFF8 (exportação Domínio em .xls). */
export function parseBiff8SheetToGrid(data: Uint8Array): unknown[][] {
  const bytes = biffBytes(data);
  const sst: string[] = [];
  const cells = new Map<string, string | number>();

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  while (pos + 4 <= bytes.length) {
    const rtype = view.getUint16(pos, true);
    const rlen = view.getUint16(pos + 2, true);

    if (rtype === 0x00fc) {
      const { payload: sstPayload, nextPos } = slurpSstPayload(bytes, pos);
      sst.push(...parseSst(sstPayload));
      pos = nextPos;
      continue;
    }

    pos += 4;
    const payload = bytes.subarray(pos, pos + rlen);
    pos += rlen;

    // CONTINUE já absorvido no slurp do SST
    if (rtype === 0x003c) continue;

    const pv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

    if (rtype === 0x0204 && payload.length >= 8) {
      const row = pv.getUint16(0, true);
      const col = pv.getUint16(2, true);
      const slen = pv.getUint16(6, true);
      let p = 8;
      const flags = payload[p]!;
      p += 1;
      cells.set(`${row},${col}`, readXlUnicode(payload, p, slen, (flags & 1) === 1).trim());
      continue;
    }

    if (rtype === 0x00fd && payload.length >= 10) {
      const row = pv.getUint16(0, true);
      const col = pv.getUint16(2, true);
      const idx = pv.getUint32(6, true);
      if (idx < sst.length) cells.set(`${row},${col}`, sst[idx]!);
      continue;
    }

    if (rtype === 0x0203 && payload.length >= 14) {
      const row = pv.getUint16(0, true);
      const col = pv.getUint16(2, true);
      const num = pv.getFloat64(6, true);
      cells.set(`${row},${col}`, Math.abs(num - Math.round(num)) < 1e-9 ? Math.round(num) : num);
      continue;
    }

    if (rtype === 0x027e && payload.length >= 10) {
      const row = pv.getUint16(0, true);
      const col = pv.getUint16(2, true);
      const rk = pv.getUint32(6, true);
      const val = rkValue(rk);
      cells.set(`${row},${col}`, Math.abs(val - Math.round(val)) < 1e-9 ? Math.round(val) : val);
      continue;
    }

    if (rtype === 0x00bd && payload.length >= 6) {
      const row = pv.getUint16(0, true);
      const colFirst = pv.getUint16(2, true);
      let p = 6;
      let c = colFirst;
      while (p + 6 <= payload.length - 2) {
        const rk = pv.getUint32(p + 2, true);
        const val = rkValue(rk);
        cells.set(`${row},${c}`, Math.abs(val - Math.round(val)) < 1e-9 ? Math.round(val) : val);
        p += 6;
        c += 1;
      }
    }
  }

  if (cells.size === 0) return [];

  let maxR = 0;
  let maxC = 0;
  for (const key of cells.keys()) {
    const [rs, cs] = key.split(',');
    maxR = Math.max(maxR, Number.parseInt(rs!, 10));
    maxC = Math.max(maxC, Number.parseInt(cs!, 10));
  }

  const grid: unknown[][] = [];
  for (let r = 0; r <= maxR; r++) {
    const row: unknown[] = [];
    for (let c = 0; c <= maxC; c++) {
      row.push(cells.get(`${r},${c}`) ?? '');
    }
    grid.push(row);
  }
  return grid;
}

export function readSpreadsheetGrid(bytes: Uint8Array): unknown[][] {
  try {
    const wb = XLSX.read(bytes, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]!];
    if (sheet) {
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
      if (rows.length > 0) return rows;
    }
  } catch {
    /* tenta OLE abaixo */
  }

  if (isOleCompoundFile(bytes)) {
    const stream = extractOleWorkbookStream(bytes);
    if (stream) {
      const biffRows = parseBiff8SheetToGrid(stream);
      if (biffRows.length > 0) return biffRows;
      try {
        const wb = XLSX.read(stream, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]!];
        if (sheet) {
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
          if (rows.length > 0) return rows;
        }
      } catch {
        /* ignore */
      }
    }
  }

  return [];
}

type DominioPlanoCols = {
  codigoReduzido: number;
  tipo: number;
  classificacao: number;
  nomeBase: number;
  grau: number;
};

function inferCodigoReduzidoCol(rows: unknown[][], headerRow: number, headerCol: number): number {
  for (let ri = headerRow + 1; ri < Math.min(rows.length, headerRow + 10); ri++) {
    const row = rows[ri];
    if (!Array.isArray(row)) continue;
    const c0 = cellStr(row[0]);
    if (/^\d{1,7}$/.test(c0) && !c0.includes('.')) return 0;
    if (headerCol >= 0) {
      const ch = cellStr(row[headerCol]);
      if (/^\d{1,7}$/.test(ch)) return headerCol;
    }
  }
  return headerCol >= 0 ? headerCol : 0;
}

export function findDominioPlanoColumns(rows: unknown[][]): { headerRow: number; cols: DominioPlanoCols } | null {
  for (let ri = 0; ri < Math.min(rows.length, 40); ri++) {
    const row = rows[ri];
    if (!Array.isArray(row)) continue;
    const norms = row.map(normCell);
    const hasPlano = norms.some((h) => h.includes('plano de contas'));
    const ciCodigo = norms.findIndex((h) => /codigo|reduzido/.test(h));
    const ciClass = norms.findIndex((h) => /classifica/.test(h));
    const ciNome = norms.findIndex((h) => /nome|descri/.test(h));
    const ciTipo = norms.findIndex((h) => h === 't' || /^tipo$/.test(h));
    const ciGrau = norms.findIndex((h) => /grau|nivel/.test(h));
    if (!hasPlano && ciClass < 0 && ciNome < 0) continue;
    if (ciClass < 0 || ciNome < 0) continue;

    const codigoReduzido = inferCodigoReduzidoCol(rows, ri, ciCodigo);

    return {
      headerRow: ri,
      cols: {
        codigoReduzido,
        tipo: ciTipo >= 0 ? ciTipo : 3,
        classificacao: ciClass,
        nomeBase: ciNome,
        grau: ciGrau >= 0 ? ciGrau : ciNome + 10,
      },
    };
  }
  return null;
}

function isClassificationCode(raw: string): boolean {
  const s = raw.replace(/\s/g, '');
  return /^\d+(\.\d+)+$/.test(s) || /^\d+$/.test(s);
}

function parseTipo(raw: unknown): 'S' | 'A' | undefined {
  const t = cellStr(raw).toUpperCase();
  if (t === 'S' || t.startsWith('SINT')) return 'S';
  if (t === 'A' || t.startsWith('ANAL')) return 'A';
  return undefined;
}

function parseGrau(raw: unknown): number | undefined {
  const n = Number.parseInt(cellStr(raw), 10);
  return Number.isFinite(n) && n >= 1 && n <= 9 ? n : undefined;
}

/** Detecta relatório Excel Domínio (Contas.xls / exportação sistema Domínio). */
export function isPlanoDominioExcelGrid(rows: unknown[][]): boolean {
  if (!rows?.length) return false;
  const text = rows
    .slice(0, 12)
    .flatMap((r) => (Array.isArray(r) ? r : []))
    .map(cellStr)
    .join(' ')
    .toLowerCase();
  if (text.includes('plano de contas') && (text.includes('classifica') || text.includes('grau'))) {
    return true;
  }
  return findDominioPlanoColumns(rows) !== null;
}

/** Converte grade Domínio (Código · T · Classificação · Nome · Grau) em linhas do plano. */
export function parsePlanoDominioExcelGrid(rows: unknown[][]): VisionPlanoRow[] {
  const layout = findDominioPlanoColumns(rows);
  if (!layout) return [];

  const { headerRow, cols } = layout;
  const out: VisionPlanoRow[] = [];
  const seen = new Set<string>();

  for (let ri = headerRow + 1; ri < rows.length; ri++) {
    const row = rows[ri];
    if (!Array.isArray(row)) continue;

    const classificacao = cellStr(row[cols.classificacao]);
    if (!classificacao || !isClassificationCode(classificacao)) continue;

    const grau = parseGrau(row[cols.grau]);
    const nomeCol =
      grau !== undefined ? cols.nomeBase + Math.max(0, grau - 1) : cols.nomeBase;
    let nome = cellStr(row[nomeCol]);
    if (!nome) {
      for (let c = cols.nomeBase; c < cols.grau; c++) {
        const candidate = cellStr(row[c]);
        if (candidate && !/^\d+$/.test(candidate)) {
          nome = candidate;
          break;
        }
      }
    }
    if (!nome) continue;

    const reduzidoRaw = cellStr(row[cols.codigoReduzido]);
    const codigoReduzido = acceptCodigoReduzidoFromFile(reduzidoRaw, classificacao, 'excel_column');
    let tipo = parseTipo(row[cols.tipo]);
    if (!tipo) {
      const segments = classificacao.split('.').length;
      tipo = segments >= 5 || Number.parseInt(reduzidoRaw, 10) >= 1000 ? 'A' : 'S';
    }

    const key = `${classificacao}::${nome}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const nivel = grau ?? codeLengthToLevel(classificacao.replace(/\./g, '').length);
    out.push({
      codigo: classificacao,
      nome,
      codigoReduzido,
      tipo,
      nivel,
    });
  }

  return inferAccountTypes(out);
}

export async function readPlanoSpreadsheetFile(file: File): Promise<unknown[][]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return readSpreadsheetGrid(bytes);
}
