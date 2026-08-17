import * as XLSX from 'xlsx';
import type { VisionBalanceteRow } from '../types/accounting';

function normalizeHeader(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function parseDateToBr(v: unknown): string | undefined {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const d = String(v.getDate()).padStart(2, '0');
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const y = v.getFullYear();
    return `${d}/${m}/${y}`;
  }
  const raw = String(v ?? '').trim();
  if (!raw) return undefined;
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return raw;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return undefined;
}

function parseMoney(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const raw = String(v ?? '').trim();
  if (!raw) return 0;
  const negative = raw.includes('-') || raw.includes('(');
  const clean = raw.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  const n = Number(clean);
  if (!Number.isFinite(n)) return 0;
  return negative ? -Math.abs(n) : n;
}

export async function parseRelatorioImpostosSimples(file: File): Promise<VisionBalanceteRow[]> {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  let grid: unknown[][] = [];

  if (['xlsx', 'xls', 'csv'].includes(ext)) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return [];
    grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' }) as unknown[][];
  } else {
    throw new Error('Formato inválido. Use planilha .xlsx, .xls ou .csv.');
  }

  if (!Array.isArray(grid) || grid.length === 0) return [];

  const headerLine = grid.slice(0, 8).find((r) =>
    Array.isArray(r) &&
    r.some((c) => /(data|descricao|hist|valor|imposto|tribut)/i.test(normalizeHeader(c))),
  ) ?? [];
  const headerIdx = grid.indexOf(headerLine);
  const header = Array.isArray(headerLine) ? headerLine.map(normalizeHeader) : [];

  const findCol = (patterns: RegExp[]): number =>
    header.findIndex((h) => patterns.some((p) => p.test(h)));

  const colData = findCol([/\bdata\b/, /\bcompetencia\b/, /\bemissao\b/]);
  const colDesc = findCol([/\bdescricao\b/, /\bhistorico\b/, /\bimposto\b/, /\btribut/]);
  const colValor = findCol([/\bvalor\b/, /\btotal\b/, /\bmontante\b/, /\bvl\b/]);

  const start = Math.max(0, headerIdx + 1);
  const rows = grid.slice(start).filter((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== ''));

  const out: VisionBalanceteRow[] = [];
  for (const r of rows) {
    const data = parseDateToBr(colData >= 0 ? r[colData] : undefined);
    const nome = String(colDesc >= 0 ? r[colDesc] ?? '' : '').trim();
    const valorRaw = colValor >= 0 ? parseMoney(r[colValor]) : 0;
    const valor = Math.abs(valorRaw);
    if (!nome || valor <= 0.0001) continue;

    // Regra do usuário: no fiscal/folha é provisão/obrigação a pagar (passivo).
    out.push({
      codigo: '',
      classificacao: '',
      nome,
      data,
      saldoInicial: 0,
      debito: 0,
      credito: valor,
      saldoFinal: valor,
      naturezaSaldoFinal: 'C',
      tipo: 'A',
    });
  }

  return out;
}
