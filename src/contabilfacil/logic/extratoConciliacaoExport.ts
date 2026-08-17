import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export type ExtratoConciliacaoExportRow = {
  date: string;
  description: string;
  value: number;
  nature: 'D' | 'C';
  accountDebit: string;
  accountCredit: string;
  accountDebitName: string;
  accountCreditName: string;
  operationName?: string;
};

export type ExtratoConciliacaoExportParams = {
  rows: ExtratoConciliacaoExportRow[];
  empresa?: string;
  bancoConta?: string;
  bancoNome?: string;
  saldoAnterior?: number;
  geradoEm?: Date;
};

function pdfText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\xFF]/g, '?');
}

function fmtDateBr(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return iso;
}

function fmtMoney(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtGeneratedAt(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function buildSummary(params: ExtratoConciliacaoExportParams): string[] {
  const now = params.geradoEm ?? new Date();
  const totalDeb = params.rows.filter((r) => r.nature === 'D').reduce((s, r) => s + r.value, 0);
  const totalCred = params.rows.filter((r) => r.nature === 'C').reduce((s, r) => s + r.value, 0);
  const pendentes = params.rows.filter(
    (r) => !r.accountDebit.trim() || !r.accountCredit.trim(),
  ).length;
  const lines = [
    `Empresa: ${params.empresa?.trim() || 'Nao informada'}`,
    `Gerado em: ${fmtGeneratedAt(now)}`,
    `Lancamentos: ${params.rows.length} · Debitos: ${fmtMoney(totalDeb)} · Creditos: ${fmtMoney(totalCred)}`,
  ];
  if (params.bancoConta?.trim()) {
    lines.push(
      `Conta banco: ${params.bancoConta.trim()}${params.bancoNome?.trim() ? ` — ${params.bancoNome.trim()}` : ''}`,
    );
  }
  if (params.saldoAnterior != null && params.saldoAnterior > 0) {
    lines.push(`Saldo anterior informado: ${fmtMoney(params.saldoAnterior)}`);
  }
  if (pendentes > 0) {
    lines.push(`Pendentes (sem par debito/credito): ${pendentes}`);
  }
  return lines;
}

function buildTableBody(rows: ExtratoConciliacaoExportRow[]): string[][] {
  return rows.map((r) => [
    pdfText(fmtDateBr(r.date)),
    pdfText(truncate(r.description, 120)),
    pdfText(fmtMoney(r.value)),
    r.nature,
    pdfText(r.accountDebit),
    pdfText(truncate(r.accountDebitName, 48)),
    pdfText(r.accountCredit),
    pdfText(truncate(r.accountCreditName, 48)),
    pdfText(truncate(r.operationName || r.description, 80)),
  ]);
}

/** Relatório PDF da conciliação bancária (partida dobrada sugerida). */
export function buildExtratoConciliacaoPdfDoc(
  params: ExtratoConciliacaoExportParams,
): { doc: jsPDF; filename: string } {
  if (params.rows.length === 0) {
    throw new Error('Nenhum lancamento para exportar.');
  }

  const now = params.geradoEm ?? new Date();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 32;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(pdfText('Conciliacao bancaria — Extrato Vision'), margin, 34);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);

  let y = 50;
  for (const line of buildSummary(params)) {
    doc.text(pdfText(line), margin, y);
    y += 11;
  }
  y += 6;

  autoTable(doc, {
    startY: y,
    head: [
      [
        'Data',
        'Historico',
        'Valor',
        'D/C',
        'Conta debito',
        'Desc. debito',
        'Conta credito',
        'Desc. credito',
        'Operacao (TXT)',
      ],
    ],
    body: buildTableBody(params.rows),
    styles: { fontSize: 6.5, cellPadding: 2, overflow: 'linebreak' },
    headStyles: { fillColor: [20, 20, 20], fontSize: 6.5 },
    columnStyles: {
      0: { cellWidth: 42 },
      1: { cellWidth: 130 },
      2: { cellWidth: 52, halign: 'right' },
      3: { cellWidth: 22, halign: 'center' },
      4: { cellWidth: 58 },
      5: { cellWidth: 72 },
      6: { cellWidth: 58 },
      7: { cellWidth: 72 },
      8: { cellWidth: 90 },
    },
    tableWidth: pageW - margin * 2,
    horizontalPageBreak: true,
  });

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p += 1) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    doc.text(
      pdfText(`ContabilFacil · Extrato conciliado · Pagina ${p}/${totalPages}`),
      margin,
      pageH - 16,
    );
  }

  const stamp = fmtGeneratedAt(now).replace(/[/:\s]/g, '-');
  return { doc, filename: `extrato_conciliado_${stamp}.pdf` };
}

export function exportExtratoConciliacaoPdf(params: ExtratoConciliacaoExportParams): void {
  const { doc, filename } = buildExtratoConciliacaoPdfDoc(params);
  doc.save(filename);
}

/** PDF em base64 (sem prefixo data:) para salvar na pasta de extratos. */
export function buildExtratoConciliacaoPdfBase64(
  params: ExtratoConciliacaoExportParams,
): { base64: string; filename: string } {
  const { doc, filename } = buildExtratoConciliacaoPdfDoc(params);
  const dataUri = doc.output('datauristring') as string;
  const base64 = dataUri.includes(',') ? dataUri.split(',')[1]! : dataUri;
  return { base64, filename };
}

const PNG_MAX_ROWS = 400;
const PNG_COLS = [
  { label: 'Data', w: 62 },
  { label: 'Historico', w: 200 },
  { label: 'Valor', w: 78 },
  { label: 'D/C', w: 28 },
  { label: 'Deb', w: 82 },
  { label: 'Desc deb', w: 110 },
  { label: 'Cred', w: 82 },
  { label: 'Desc cred', w: 110 },
] as const;

/** Imagem PNG da conciliacao (ate ~400 linhas; acima disso use PDF). */
export function exportExtratoConciliacaoPng(params: ExtratoConciliacaoExportParams): void {
  if (params.rows.length === 0) {
    throw new Error('Nenhum lancamento para exportar.');
  }
  if (params.rows.length > PNG_MAX_ROWS) {
    throw new Error(
      `Muitas linhas (${params.rows.length}). Exporte em PDF ou filtre o extrato (limite PNG: ${PNG_MAX_ROWS}).`,
    );
  }

  const pad = 20;
  const metaStartY = 46;
  const metaLineH = 14;
  const summaryLines = buildSummary(params);
  const headerBlock = metaStartY + summaryLines.length * metaLineH + 24;
  const rowH = 20;
  const tableW = PNG_COLS.reduce((s, c) => s + c.w, 0);
  const canvasW = tableW + pad * 2;
  const canvasH = headerBlock + params.rows.length * rowH + pad * 2 + 24;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Nao foi possivel gerar a imagem.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasW, canvasH);

  ctx.fillStyle = '#141414';
  ctx.font = 'bold 14px Consolas, monospace';
  ctx.fillText('Conciliacao bancaria — Extrato Vision', pad, 28);

  ctx.font = '10px Consolas, monospace';
  ctx.fillStyle = '#334155';
  let metaY = metaStartY;
  for (const line of summaryLines) {
    ctx.fillText(line, pad, metaY);
    metaY += metaLineH;
  }

  let x = pad;
  const headY = headerBlock - 18;
  ctx.fillStyle = '#141414';
  ctx.font = 'bold 9px Consolas, monospace';
  for (const col of PNG_COLS) {
    ctx.fillText(col.label, x + 2, headY);
    x += col.w;
  }

  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1;
  ctx.strokeRect(pad, headerBlock - 26, tableW, rowH + 26);

  params.rows.forEach((row, i) => {
    const y = headerBlock + i * rowH;
    if (i % 2 === 1) {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(pad, y, tableW, rowH);
    }
    ctx.fillStyle = row.nature === 'D' ? '#dc2626' : '#2563eb';
    ctx.font = '9px Consolas, monospace';

    const cells = [
      fmtDateBr(row.date),
      truncate(row.description, 42),
      fmtMoney(row.value),
      row.nature,
      row.accountDebit,
      truncate(row.accountDebitName, 22),
      row.accountCredit,
      truncate(row.accountCreditName, 22),
    ];

    let cx = pad;
    ctx.fillStyle = '#0f172a';
    for (let c = 0; c < cells.length; c += 1) {
      const cell = cells[c]!;
      if (c === 2) ctx.textAlign = 'right';
      else ctx.textAlign = 'left';
      const tx = c === 2 ? cx + PNG_COLS[c]!.w - 4 : cx + 2;
      if (c === 3) ctx.fillStyle = row.nature === 'D' ? '#dc2626' : '#2563eb';
      else ctx.fillStyle = '#0f172a';
      ctx.fillText(cell, tx, y + 14);
      cx += PNG_COLS[c]!.w;
    }
    ctx.textAlign = 'left';
    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(pad, y + rowH);
    ctx.lineTo(pad + tableW, y + rowH);
    ctx.stroke();
  });

  ctx.fillStyle = '#64748b';
  ctx.font = '8px Consolas, monospace';
  ctx.fillText('ContabilFacil · gerado automaticamente', pad, canvasH - 10);

  const stamp = fmtGeneratedAt(params.geradoEm ?? new Date()).replace(/[/:\s]/g, '-');
  const link = document.createElement('a');
  link.download = `extrato_conciliado_${stamp}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}
