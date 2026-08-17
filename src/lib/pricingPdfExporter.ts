import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  buildPrecificacaoTableRow,
  getPrecificacaoTableHeaders,
  resolvePricingMonthlyQty,
} from '../contabilfacil/logic/pricingPrecificacaoTable';
import type { PricingProductReport, PricingReportSection } from '../contabilfacil/logic/pricingReport';
import type {
  PricingBreakdown,
  PricingDashboardSummary,
  PricingSegment,
  PricingWorkspace,
} from '../contabilfacil/logic/pricingTypes';
import { PRICING_SEGMENT_LABELS } from '../contabilfacil/logic/pricingTypes';

function pdfSafe(str: string): string {
  return str
    .replace(/\u00D7/g, 'x')
    .replace(/\u2212/g, '-')
    .replace(/\u2013/g, '-')
    .replace(/\u2014/g, '-');
}

const fmt = (n: number) =>
  pdfSafe(n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

export type PricingPdfSection =
  | 'dashboard'
  | 'estoque'
  | 'custos'
  | 'creditos'
  | 'dre'
  | 'precificacao'
  | 'roa'
  | 'all';

export interface PricingPdfPayload {
  companyName: string;
  section: PricingPdfSection;
  categories?: PricingSegment[];
  breakdowns: PricingBreakdown[];
  dashboard: PricingDashboardSummary;
  /** Usado para Qtd/mês na tabela de precificação (overrides + estoque). */
  workspace?: Pick<
    PricingWorkspace,
    'stockItems' | 'serviceItems' | 'productOverrides' | 'settings'
  >;
  stockRows?: { name: string; category: string; purchase: string; package: string }[];
  costRows?: { type: string; name: string; amount: string }[];
  creditRows?: { name: string; kind: string; amount: string; segments: string }[];
  dreRows?: { label: string; value: string }[];
}

export function downloadPricingPdf(payload: PricingPdfPayload): void {
  const doc = new jsPDF({ orientation: 'landscape' });
  const titleMap: Record<PricingPdfSection, string> = {
    dashboard: 'Dashboard — Custos x Receita',
    estoque: 'Estoque',
    custos: 'Custos e Despesas',
    creditos: 'Créditos Recuperáveis',
    dre: 'DRE — Demonstração do Resultado',
    precificacao: 'Precificação',
    roa: 'ROA — Rentabilidade',
    all: 'Relatório Completo de Precificação',
  };

  doc.setFontSize(18);
  doc.text(pdfSafe(titleMap[payload.section]), 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  doc.text(pdfSafe(`${payload.companyName} · ${format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR })}`), 14, 26);
  doc.setTextColor(0, 0, 0);

  let y = 34;

  const addSectionTitle = (label: string) => {
    doc.setFontSize(12);
    doc.text(pdfSafe(label), 14, y);
    y += 6;
  };

  const filteredBreakdowns =
    payload.categories && payload.categories.length > 0
      ? payload.breakdowns.filter((b) => payload.categories!.includes(b.category))
      : payload.breakdowns;

  if (payload.section === 'dashboard' || payload.section === 'all') {
    addSectionTitle('Resumo financeiro');
    autoTable(doc, {
      startY: y,
      head: [['Indicador', 'Valor']],
      body: [
        ['Valor em estoque (custos)', fmt(payload.dashboard.totalStockInventory)],
        ['Custo materiais (mensal proj.)', fmt(payload.dashboard.totalMaterialCost)],
        ['Custos rateados', fmt(payload.dashboard.totalCosts)],
        ['Despesas rateadas', fmt(payload.dashboard.totalExpenses)],
        ['Aquisição (compras PA/mercadoria)', fmt(payload.dashboard.totalAcquisitionCost)],
        ['Custos + despesas + material (mês)', fmt(payload.dashboard.totalConsolidatedCosts)],
        ['Créditos recuperados', fmt(payload.dashboard.totalCredits)],
        ['Receita projetada', fmt(payload.dashboard.totalMonthlyRevenue)],
        ['Lucro / Prejuízo', fmt(payload.dashboard.totalMonthlyProfit)],
      ],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [20, 20, 20] },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
  }

  if ((payload.section === 'estoque' || payload.section === 'all') && payload.stockRows?.length) {
    addSectionTitle('Estoque');
    autoTable(doc, {
      startY: y,
      head: [['Item', 'Categoria', 'Embalagem', 'Valor compra']],
      body: payload.stockRows.map((r) => [r.name, r.category, r.package, r.purchase]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [20, 20, 20] },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
  }

  if ((payload.section === 'custos' || payload.section === 'all') && payload.costRows?.length) {
    addSectionTitle('Custos e despesas');
    autoTable(doc, {
      startY: y,
      head: [['Tipo', 'Nome', 'Valor mensal']],
      body: payload.costRows.map((r) => [r.type, r.name, r.amount]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [20, 20, 20] },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
  }

  if ((payload.section === 'creditos' || payload.section === 'all') && payload.creditRows?.length) {
    addSectionTitle('Créditos recuperáveis');
    autoTable(doc, {
      startY: y,
      head: [['Nome', 'Tipo', 'Valor', 'Segmentos']],
      body: payload.creditRows.map((r) => [r.name, r.kind, r.amount, r.segments]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [20, 20, 20] },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
  }

  if ((payload.section === 'dre' || payload.section === 'all') && payload.dreRows?.length) {
    addSectionTitle('DRE — projeção mensal');
    autoTable(doc, {
      startY: y,
      head: [['Conta', 'Valor']],
      body: payload.dreRows.map((r) => [r.label, r.value]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [20, 20, 20] },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
  }

  if (payload.section === 'precificacao' || payload.section === 'roa' || payload.section === 'all') {
    const precificacaoFmt = {
      money: fmt,
      qty: (n: number) => (n > 0 ? String(n) : '—'),
      pct: (n: number) => `${n.toFixed(1)}%`,
      share: (n: number) => (n <= 0 ? '0' : n.toFixed(4).replace('.', ',')),
    };

    const head =
      payload.section === 'roa'
        ? [['Produto', 'Segmento', 'Custo', 'Preço', 'Lucro/un', 'ROA %']]
        : [
            getPrecificacaoTableHeaders(
              payload.workspace?.settings.mode ?? filteredBreakdowns[0]?.mode ?? 'both',
            ),
          ];

    const body =
      payload.section === 'roa'
        ? filteredBreakdowns.map((b) => [
            b.name,
            PRICING_SEGMENT_LABELS[b.category],
            fmt(b.totalUnitCost),
            fmt(b.finalPrice),
            fmt(b.profitPerUnit),
            `${b.roaPct.toFixed(1)}%`,
          ])
        : filteredBreakdowns.map((b) => {
            const monthlyQty = payload.workspace
              ? resolvePricingMonthlyQty(b, payload.workspace)
              : b.monthlyQty;
            const mode = payload.workspace?.settings.mode ?? b.mode;
            return buildPrecificacaoTableRow(b, monthlyQty, precificacaoFmt, mode);
          });

    addSectionTitle(payload.section === 'roa' ? 'Ranking ROA' : 'Precificação');
    autoTable(doc, {
      startY: y,
      head,
      body,
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [20, 20, 20], fontSize: 7 },
      tableWidth: 'auto',
      horizontalPageBreak: true,
    });
  }

  const suffix = payload.section === 'all' ? 'completo' : payload.section;
  doc.save(pdfSafe(`precificacao_${suffix}_${format(new Date(), 'yyyy-MM-dd')}.pdf`));
}

export interface PricingCalculationReportPdfPayload {
  companyName: string;
  globalIntro: PricingReportSection;
  productReports: PricingProductReport[];
}

function addReportSectionTable(
  doc: jsPDF,
  startY: number,
  section: PricingReportSection,
): number {
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(pdfSafe(section.title), 14, startY);
  autoTable(doc, {
    startY: startY + 4,
    head: [['Campo', 'Valor', 'Como foi calculado']],
    body: section.lines.map((row) => [
      pdfSafe(row.label),
      pdfSafe(row.value),
      pdfSafe(row.formula ?? ''),
    ]),
    styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
    headStyles: { fillColor: [20, 20, 20], fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 62 },
      1: { cellWidth: 38, halign: 'right' },
      2: { cellWidth: 'auto' },
    },
    margin: { left: 14, right: 14 },
  });
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
}

/** PDF do relatório passo a passo (subaba Relatório do cálculo). */
export function downloadPricingCalculationReportPdf(
  payload: PricingCalculationReportPdfPayload,
): void {
  const doc = new jsPDF({ orientation: 'portrait' });
  const pageHeight = doc.internal.pageSize.getHeight();
  const bottomMargin = 20;

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(pdfSafe('Relatório do cálculo — Precificação'), 14, 18);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(80, 80, 80);
  doc.text(
    pdfSafe(`${payload.companyName} · ${format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR })}`),
    14,
    26,
  );
  doc.setTextColor(0, 0, 0);

  let y = addReportSectionTable(doc, 34, payload.globalIntro);

  for (const report of payload.productReports) {
    if (y > pageHeight - 40) {
      doc.addPage();
      y = 20;
    }

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(pdfSafe(`${report.productName} — ${report.segmentLabel}`), 14, y);
    y += 8;
    doc.setFont('helvetica', 'normal');

    for (const section of report.sections) {
      const estimatedHeight = 12 + section.lines.length * 10;
      if (y + estimatedHeight > pageHeight - bottomMargin) {
        doc.addPage();
        y = 20;
      }
      y = addReportSectionTable(doc, y, section);
    }
    y += 4;
  }

  doc.save(pdfSafe(`precificacao_relatorio_calculo_${format(new Date(), 'yyyy-MM-dd')}.pdf`));
}
