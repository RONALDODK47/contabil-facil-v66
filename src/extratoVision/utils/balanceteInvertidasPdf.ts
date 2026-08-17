import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { VisionBalanceteRow, VisionPlanoRow } from '../types/accounting';
import { filtrarRazaoPorPeriodo, montarBalanceteComPeriodo } from './razaoContabil';
import {
  analisarSaldoContabil,
  contaInvertidaNoPeriodoMensal,
  enrichNaturezaSaldoImportado,
  formatSaldoContabil,
  formatNaturezaConta,
} from './naturezaContabil';

type Periodo = { label: string; de: string; ate: string };

function parseDataBrToKey(data: string): { year: number; month: number } | null {
  const m = data.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const month = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if (month < 1 || month > 12 || year < 1900) return null;
  return { year, month };
}

function buildPeriodosMensais(razaoRows: VisionBalanceteRow[]): Periodo[] {
  const set = new Set<string>();
  for (const r of razaoRows) {
    const d = r.data?.trim();
    if (!d) continue;
    const key = parseDataBrToKey(d);
    if (!key) continue;
    set.add(`${String(key.month).padStart(2, '0')}/${key.year}`);
  }

  const ordered = [...set].sort((a, b) => {
    const [ma, ya] = a.split('/').map((v) => parseInt(v, 10));
    const [mb, yb] = b.split('/').map((v) => parseInt(v, 10));
    if (ya !== yb) return ya - yb;
    return ma - mb;
  });

  return ordered.map((mmYyyy) => {
    const [mm, yyyy] = mmYyyy.split('/');
    const start = `01/${mm}/${yyyy}`;
    const endDate = new Date(parseInt(yyyy, 10), parseInt(mm, 10), 0).getDate();
    const end = `${String(endDate).padStart(2, '0')}/${mm}/${yyyy}`;
    return { label: mmYyyy, de: start, ate: end };
  });
}

export function exportBalanceteInvertidasPdf(params: {
  razaoRows: VisionBalanceteRow[];
  planoRows: VisionPlanoRow[];
  empresa?: string;
}): void {
  const { razaoRows, planoRows, empresa } = params;
  const periodos = buildPeriodosMensais(razaoRows);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const now = new Date();
  const generatedAt = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Relatorio de Contas Invertidas por Mes/Ano', 40, 38);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Empresa: ${empresa?.trim() || 'Nao informada'}`, 40, 56);
  doc.text(`Gerado em: ${generatedAt}`, 40, 70);

  if (periodos.length === 0) {
    doc.setFontSize(11);
    doc.text('Sem datas validas no razao para montar periodos mensais.', 40, 100);
    doc.save('balancete_contas_invertidas.pdf');
    return;
  }

  const resumo: Array<[string, string]> = [];
  const detalhado: Array<{ periodo: string; base: VisionBalanceteRow[]; invertidas: VisionBalanceteRow[] }> = [];

  for (const p of periodos) {
    const razaoPeriodo = filtrarRazaoPorPeriodo(razaoRows, p.de, p.ate);
    const balancetePeriodo = montarBalanceteComPeriodo(razaoRows, razaoPeriodo, planoRows, p.de, p.ate);
    const enriched = balancetePeriodo.map((r) => enrichNaturezaSaldoImportado(r, balancetePeriodo));
    const invertidasNoMes = enriched.filter((r) => contaInvertidaNoPeriodoMensal(r, enriched));

    if (invertidasNoMes.length > 0) {
      resumo.push([p.label, String(invertidasNoMes.length)]);
      detalhado.push({ periodo: p.label, base: enriched, invertidas: invertidasNoMes });
    }
  }

  if (resumo.length === 0) {
    resumo.push(['Sem período com inversão', '0']);
  }

  autoTable(doc, {
    startY: 84,
    head: [['Data/Periodo', 'Lancamentos Invertidos']],
    body: resumo,
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [30, 41, 59] },
  });

  let y = (doc as any).lastAutoTable.finalY + 18;
  for (const item of detalhado) {
    if (y > 500) {
      doc.addPage();
      y = 40;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`Periodo ${item.periodo}`, 40, y);
    y += 8;

    const rows = item.invertidas.map((r) => {
      const analise = analisarSaldoContabil(r, item.base);
      const natureza = formatNaturezaConta(r, item.base);
      return [
        r.classificacao || r.codigo || '—',
        r.nome || '—',
        formatSaldoContabil(r, item.base),
        natureza.codigo,
        analise.natureza,
        'Saldo com natureza oposta ao esperado',
      ];
    });

    autoTable(doc, {
      startY: y + 4,
      head: [['Classificacao/Codigo', 'Conta', 'Saldo', 'Esperada', 'Apurada', 'Motivo']],
      body: rows,
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [127, 29, 29] },
      columnStyles: {
        0: { cellWidth: 110 },
        1: { cellWidth: 200 },
        2: { cellWidth: 80 },
        3: { cellWidth: 60, halign: 'center' },
        4: { cellWidth: 60, halign: 'center' },
        5: { cellWidth: 220 },
      },
    });

    y = (doc as any).lastAutoTable.finalY + 14;
  }

  doc.save('balancete_contas_invertidas.pdf');
}
