/** Parse data BR dd/mm/aaaa no início da célula */
export function parseBrDateIso(s: string): string | null {
  const t = (s ?? '').trim();
  if (!t) return null;
  const chunk = t.split(/\s+/)[0];
  const m = chunk.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (!m) return null;
  let d = parseInt(m[1], 10);
  let mo = parseInt(m[2], 10);
  let y = parseInt(m[3], 10);
  if (y < 100) y += y < 75 ? 2000 : 1900;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  const mm = String(mo).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

/** Valores tipo 1.234,56 ou 1234.56 */
export function parseBrMoneyCell(s: string): number | null {
  const raw = (s ?? '').trim().replace(/\xa0/g, '');
  if (!raw || /^[-–—]+$/.test(raw)) return null;
  let t = raw.replace(/[^\d,.\-+]/g, '');
  if (!t || t === '-' || t === '+') return null;
  if (t.includes(',')) {
    t = t.replace(/\./g, '').replace(',', '.');
  }
  const v = Number(t);
  if (!Number.isFinite(v) || Math.abs(v) > 1e14) return null;
  const rounded = Math.round(v * 100) / 100;
  return rounded;
}

function padRow(row: string[], n: number): string[] {
  const r = [...row];
  while (r.length < n) r.push('');
  return r;
}

export interface MapRowsParams {
  dateCol: number;
  historicoCol: number;
  debitoCol: number;
  creditoCol: number;
  codigoHistoricoCol: number;
  complementoCol: number;
  skipHeaderRows: number;
  maxRows: number;
}

export interface BankStatementRecord {
  data: string | null;
  historico: string;
  valor_debito: number | null;
  valor_credito: number | null;
  codigo_historico: string | null;
  complemento: string | null;
  /** Trechos da linha que não pertencem aos campos mapeados (outras colunas ou resíduos). */
  ignorar: string | null;
}

export function matrixMaxCols(rows: string[][]): number {
  return rows.reduce((m, r) => Math.max(m, r.length), 0);
}

export function padMatrix(rows: string[][], ncol: number): string[][] {
  return rows.map((r) => padRow(r, ncol));
}

/** Converte grade (string[][]) em registros para conciliação / CSV Domínio. */
export function mapMatrixToBankRecords(rows: string[][], opts: MapRowsParams): BankStatementRecord[] {
  const ncol = matrixMaxCols(rows);
  const skip = Math.max(0, opts.skipHeaderRows);
  const cap = Math.max(1, Math.min(opts.maxRows || 50000, 100000));
  const body = padMatrix(rows, ncol).slice(skip, skip + cap);

  const usedCols = new Set<number>();
  for (const i of [
    opts.dateCol,
    opts.historicoCol,
    opts.debitoCol,
    opts.creditoCol,
    opts.codigoHistoricoCol,
    opts.complementoCol,
  ]) {
    if (i >= 0) usedCols.add(i);
  }

  function cell(row: string[], i: number): string {
    if (i < 0 || i >= row.length) return '';
    return String(row[i] ?? '').trim();
  }

  const trailingMoneyTail = /\s+(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s*$/;

  const out: BankStatementRecord[] = [];

  for (const r of body) {
    const dIso = opts.dateCol >= 0 ? parseBrDateIso(cell(r, opts.dateCol)) : null;
    if (opts.dateCol >= 0 && !dIso) continue;

    const ignorarPieces: string[] = [];

    for (let j = 0; j < ncol; j++) {
      if (usedCols.has(j)) continue;
      const c = cell(r, j);
      if (c) ignorarPieces.push(c);
    }

    let hist = opts.historicoCol >= 0 ? cell(r, opts.historicoCol) : '';
    const dv = opts.debitoCol >= 0 ? parseBrMoneyCell(cell(r, opts.debitoCol)) : null;
    const cv = opts.creditoCol >= 0 ? parseBrMoneyCell(cell(r, opts.creditoCol)) : null;
    const ch = opts.codigoHistoricoCol >= 0 ? cell(r, opts.codigoHistoricoCol) || null : null;
    const comp = opts.complementoCol >= 0 ? cell(r, opts.complementoCol) || null : null;

    if (opts.debitoCol >= 0) {
      const rawD = cell(r, opts.debitoCol);
      if (rawD && dv == null && /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(rawD)) ignorarPieces.push(rawD);
    }
    if (opts.creditoCol >= 0) {
      const rawC = cell(r, opts.creditoCol);
      if (rawC && cv == null && /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(rawC)) ignorarPieces.push(rawC);
    }

    if (hist && (dv != null || cv != null)) {
      const m = hist.match(trailingMoneyTail);
      if (m?.[1]) {
        const tailVal = parseBrMoneyCell(m[1]);
        if (tailVal != null && Math.abs(tailVal) > 0) {
          ignorarPieces.push(m[1]);
          hist = hist.slice(0, m.index).trim();
        }
      }
    }

    const ignorarJoined = ignorarPieces.map((x) => x.trim()).filter(Boolean);
    const ignorar = ignorarJoined.length ? ignorarJoined.join(' | ') : null;

    if (!hist && dv == null && cv == null) continue;

    out.push({
      data: dIso,
      historico: hist,
      valor_debito: dv,
      valor_credito: cv,
      codigo_historico: ch,
      complemento: comp,
      ignorar,
    });
  }

  return out;
}

export function bankRecordsToCsvSemi(rows: BankStatementRecord[]): string {
  const head = [
    'data',
    'historico',
    'valor_debito',
    'valor_credito',
    'codigo_historico',
    'complemento',
    'ignorar',
  ];
  const esc = (x: string | number | null | undefined) => {
    const t = String(x ?? '');
    if (/[;",\r\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
    return t;
  };
  const lines = [
    head.join(';'),
    ...rows.map((r) =>
      [
        r.data,
        r.historico,
        r.valor_debito ?? '',
        r.valor_credito ?? '',
        r.codigo_historico ?? '',
        r.complemento ?? '',
        r.ignorar ?? '',
      ]
        .map(esc)
        .join(';')
    ),
  ];
  return lines.join('\r\n');
}
