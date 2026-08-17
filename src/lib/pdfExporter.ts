import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { LoanParams, LoanRow } from './loanCalculator';
import {
  anosOperacionaisNoCronograma,
  indiceLinhaDezembroNoAno,
  obterMaxMesCarencia,
} from './cpcFiscalYearEnd';

interface PdfContractMeta {
  companyName?: string;
  contractNumber?: string;
  bankName?: string;
  valorIof?: number;
}

/**
 * jsPDF usa fontes padrão com encoding limitado; símbolos como × ÷ − (Unicode) quebram a saída.
 * Normaliza para ASCII na exportação (evita caracteres "fantasma" / corrupção no leitor).
 */
function pdfSafe(str: string): string {
  return str
    .replace(/\u00D7/g, 'x')
    .replace(/\u00F7/g, '/')
    .replace(/\u2212/g, '-')
    .replace(/\u2013/g, '-')
    .replace(/\u2014/g, '-')
    .replace(/\u00A0/g, ' ');
}

const formatCurrency = (value: number) => {
  return pdfSafe(
    value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\s/g, '\u00A0')
  );
};

function formatRowDate(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  return isValid(d) ? format(d, 'dd/MM/yyyy') : '—';
}

function hasMoney(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) >= 0.005;
}

function displayInstallment(row: LoanRow, graceType: 'capitalized' | 'paid'): number {
  const adjustedInterest = row.interest ?? 0;
  if (row.isGrace) {
    if (graceType === 'paid') {
      if (hasMoney(row.installment)) return row.installment;
      const composite = adjustedInterest + row.monthlyCost;
      return hasMoney(composite) ? composite : 0;
    }
    return 0;
  }
  if (row.isUnpaid) {
    if (row.paymentAmount != null && row.paymentAmount > 0) {
      return row.paymentAmount;
    }
    if (row.expectedAmortization != null) {
      const expected = row.expectedAmortization + adjustedInterest + (row.monthlyCost ?? 0);
      return hasMoney(expected) ? expected : 0;
    }
  }
  if (hasMoney(row.installment)) return row.installment;
  const composite = row.amortization + adjustedInterest + row.monthlyCost;
  return hasMoney(composite) ? composite : 0;
}

function displayAmortization(
  row: LoanRow,
  graceType: 'capitalized' | 'paid',
): number {
  const adjustedInterest = row.interest ?? 0;
  if (row.isGrace) return 0;
  if (row.fixedInstallmentReference != null) return row.fixedInstallmentReference;
  if (row.isUnpaid && row.expectedAmortization != null) {
    return hasMoney(row.expectedAmortization) ? row.expectedAmortization : 0;
  }
  if (hasMoney(row.amortization)) return row.amortization;
  const installment = displayInstallment(row, graceType);
  if (!hasMoney(installment)) return 0;
  const derived = installment - adjustedInterest - row.monthlyCost;
  return hasMoney(derived) ? derived : 0;
}

function formatMoneyCell(value: number, options?: { showZero?: boolean }): string {
  if (hasMoney(value)) return formatCurrency(value);
  if (options?.showZero) return formatCurrency(0);
  return '—';
}

function formatScheduleCell(
  row: any,
  key: string,
  graceType: 'capitalized' | 'paid',
  displayMonthLabel: string | null,
): string {
  if (row.isReclas) {
    switch (key) {
      case 'month':
        return 'Reclas.';
      case 'date':
        return formatRowDate(row.date);
      case 'initial':
        return hasMoney(row.initialBalance) ? formatCurrency(row.initialBalance) : '—';
      case 'final':
        return hasMoney(row.finalBalance) ? formatCurrency(row.finalBalance) : '—';
      case 'short':
        return row.shortTermBalance >= 0.005 ? formatCurrency(row.shortTermBalance) : '—';
      case 'long':
        return row.longTermBalance >= 0.005 ? formatCurrency(row.longTermBalance) : '—';
      default:
        return '—';
    }
  }

  if (row.month === 0 && !['month', 'date', 'initial', 'final', 'short', 'long'].includes(key)) {
    if (key === 'iof' && hasMoney(row.iof)) return formatCurrency(row.iof);
    return '—';
  }
  switch (key) {
    case 'month': {
      if (row.isDelayedPayment) return 'Pgto Atrasado';
      if (row.isOverdue) return `Parcela Atrasada ${row.overdueInstallmentNumber}`;
      if (row.month === 0 || row.isGrace) return '—';
      if (displayMonthLabel) return displayMonthLabel;
      const monthValue = Number(row.month);
      if (!Number.isFinite(monthValue) || monthValue <= 0) return '—';
      const gracePeriodMonths = Number(row.gracePeriodMonths || 0);
      if (gracePeriodMonths > 0 && monthValue > gracePeriodMonths) {
        return String(monthValue - gracePeriodMonths);
      }
      return String(monthValue);
    }
    case 'date':
      return formatRowDate(row.date);
    case 'days': {
      if (row.month === 0) return '—';
      const du =
        row.selicBusinessDays != null && row.selicBusinessDays > 0
          ? row.selicBusinessDays
          : row.accrualDays;
      return String(du);
    }
    case 'selic':
      return row.selicAccumulatedFactor != null && row.selicAccumulatedFactor !== 1
        ? row.selicAccumulatedFactor.toFixed(6)
        : '—';
    case 'rate': {
      if (row.isGrace && graceType === 'capitalized') return '—';
      if (row.effectivePctInPeriod == null) return '—';
      const dec =
        row.selicBusinessDays != null && row.selicBusinessDays > 0 ? 6 : 4;
      return `${row.effectivePctInPeriod.toFixed(dec)}%`;
    }
    case 'initial':
      return formatCurrency(row.initialBalance);
    case 'installment':
      return formatMoneyCell(displayInstallment(row, graceType));
    case 'amortization':
      return formatMoneyCell(displayAmortization(row, graceType), {
        showZero: row.isGrace && graceType === 'paid',
      });
    case 'prepayment':
      return row.prepaymentAmount != null && row.prepaymentAmount > 0
        ? formatCurrency(row.prepaymentAmount)
        : '—';
    case 'interest':
      return formatMoneyCell(row.interest ?? 0);
    case 'ajusteJuros':
      return row.interestAdjustment != null && row.interestAdjustment < 0
        ? formatCurrency(row.interestAdjustment)
        : '—';
    case 'ajustes':
      return row.interestAdjustment != null && row.interestAdjustment > 0
        ? `+${formatCurrency(row.interestAdjustment)}`
        : '—';
    case 'final':
      return formatCurrency(row.finalBalance);
    case 'short':
      return formatMoneyCell(row.shortTermBalance);
    case 'long':
      return formatMoneyCell(row.longTermBalance);
    case 'ocorrencia': {
      if (row.isUnpaid && row.paymentAmount != null && row.paymentAmount > 0) return 'Pago';
      if (row.isUnpaid) return 'Não Pago';
      if (row.isDelayedPayment) return 'Pago';
      return '—';
    }
    default:
      return '—';
  }
}

export function exportToPDF(params: LoanParams, schedule: LoanRow[], meta?: PdfContractMeta) {
  const doc = new jsPDF({ orientation: 'landscape' });
  const pageWidth = doc.internal.pageSize.getWidth();
  
  // Título e logo placeholders
  doc.setFontSize(22);
  doc.setTextColor(30, 64, 175); // Azul escuro
  doc.text(pdfSafe('Relatório Profissional de Empréstimo'), 14, 22);
  
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(
    pdfSafe(`Gerado em: ${format(new Date(), "dd 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR })}`),
    14,
    30
  );
  
  // Resumo dos Parâmetros
  doc.setFontSize(12);
  doc.setTextColor(20, 20, 20);
  doc.text(pdfSafe('Parâmetros da Simulação'), 14, 45);
  doc.setLineWidth(0.5);
  doc.line(14, 47, 283, 47);
  
  doc.setFontSize(10);
  
  const effectiveFixedRateStr = params.fixedRateType === 'value' 
    ? `${formatCurrency(params.fixedRateMonth)} (Taxa efe. ${((params.fixedRateMonth / params.principal)*100).toFixed(4)}% a.m.)` 
    : `${params.fixedRateMonth.toFixed(4)}% a.m.`;

  const opCostStr =
    params.monthlyOperationCost === 0
      ? params.monthlyOpCostType === 'percent'
        ? '0% a.m. s/ saldo (ref. mensal)'
        : `${formatCurrency(0)} tarifa mensal (ref.)`
      : params.monthlyOpCostType === 'percent'
        ? `${params.monthlyOperationCost}% a.m. s/ saldo (pós-car.)`
        : `${formatCurrency(params.monthlyOperationCost)} tarifa mensal (pós-car.)`;

  const custoRateioCurto =
    params.operationalCostDayBasis === 'calendar365' ? 'Calendário' : 'Mês comercial';

  const graceRateStrPdf =
    params.graceFixedRateType === 'value'
      ? `${formatCurrency(params.graceFixedRateMonth)} (${params.principal > 0 ? ((params.graceFixedRateMonth / params.principal) * 100).toFixed(4) : '0'}% a.m. car.)`
      : `${params.graceFixedRateMonth.toFixed(4)}% a.m. (car.)`;
  const graceCostStrPdf =
    params.graceMonthlyOpCostType === 'percent'
      ? `${params.graceMonthlyOperationCost}% s/ saldo (car.)`
      : `${formatCurrency(params.graceMonthlyOperationCost)} (car.)`;

  const iofModePdf = params.iofMode ?? 'financed';
  const valorIofPdf = Math.max(0, params.valorIof ?? meta?.valorIof ?? 0);
  const valorContratoTotalPdf =
    params.principal + (iofModePdf === 'financed' ? valorIofPdf : 0);

  const graceTipoLabelPdf = params.graceType === 'paid' ? 'Juros Pagos' : 'Capitalizado';

  const leftCol = [
    `Empresa: ${meta?.companyName?.trim() || '-'}`,
    `Contrato: Nr. ${meta?.contractNumber?.trim() || '-'}`,
    `Banco: ${meta?.bankName?.trim() || '-'}`,
    `Sistema: ${params.system}`,
    `Valor Financiado: ${formatCurrency(params.principal)}`,
    `Prazo de Amortização: ${params.months} meses`,
    ...(params.gracePeriod > 0
      ? [
          `Carência: ${params.gracePeriod} meses (${graceTipoLabelPdf})`,
          `Juros base (carência): ${graceRateStrPdf}`,
          `Custo op. (carência): ${graceCostStrPdf}`,
        ]
      : []),
  ];
  
  const effectiveFixed = params.fixedRateType === 'value' ? (params.fixedRateMonth / params.principal)*100 : params.fixedRateMonth;

  const modoJuros = params.proRataDieMode === 'compound' ? 'Exponencial' : 'Linear';

  const sacRoundPdf =
    params.system === 'SAC'
      ? params.sacMoneyRounding === 'truncateCentavos'
        ? 'truncado para baixo nos centavos'
        : 'meia-distância em centavos'
      : '';

  const sacAccrPdfParts: string[] = [];
  if (params.system === 'SAC') {
    let base = '';
    if (params.sacInterestAccrual === 'proRataMesCivil')
      base = 'Amortização SAC: juros com dias corridos / dias do mês civil';
    else if (params.sacInterestAccrual === 'proRataCorridos')
      base = 'Amortização SAC: juros proporcionais dias corridos ÷30';
    else base = 'Amortização SAC: juros mensal inteiro (saldo x taxa x 1)';
    sacAccrPdfParts.push(base);
    if (sacRoundPdf) sacAccrPdfParts.push(`Arredondamento SAC: ${sacRoundPdf}`);
  }
  const sacAccrPdf = sacAccrPdfParts.join(' — ');

  const priceAccrPdf =
    params.system === 'PRICE'
      ? params.priceInterestAccrual === 'proRataMesCivil'
        ? 'PRICE amort.: juros com dias corridos / dias mes civil'
        : params.priceInterestAccrual === 'mensalContrato'
          ? 'PRICE amort.: juros competencia inteira (fator 1)'
          : 'PRICE amort.: juros proporcionais dias corridos /30'
      : '';

  const mesmoAnoPdf = 'parcelas restantes no mesmo ano civil da linha';
  const curtoPdfHead = 'Curto';
  const cpcDemoLines = [
    'Demonstracao curto/longo (CPC fiscal):',
    `Curto = soma das parcelas liquidas restantes no mesmo ano civil (${mesmoAnoPdf}). O saldo de curto diminui a cada pagamento.`,
    'Em 31/12: uma reclassificacao anual — provisiona parcelas liquidas do ano civil seguinte (ate 12). Se o emprestimo encerrar no ano, provisiona so o restante.',
    'Longo = saldo devedor menos curto. Export TXT: transferencia LP para CP somente em 31/12 (uma vez por ano).',
  ];

  const indexadorPdf =
    params.varIndexMode === 'selic_over_diaria'
      ? 'Selic Over diaria BCB 11 (fator acumulado entre vencimentos)'
      : params.varIndexMode === 'none'
        ? 'Sem indexador'
        : `Indexador mensal ${params.varRateMonth.toFixed(4)}% a.m.`;

  const rightCol = [
    `Spread/Juros Base: ${effectiveFixedRateStr}`,
    `Indexador Projetado: ${indexadorPdf}`,
    ...(params.varIndexMode !== 'selic_over_diaria'
      ? [
          `Proj. variação (% a.m.): ${params.varRateMonth.toFixed(4)}%`,
          `Taxa efetiva mensal (legado): ${(((1 + effectiveFixed / 100) * (1 + params.varRateMonth / 100) - 1) * 100).toFixed(4)}%`,
        ]
      : [
          `PRICE + Selic: ${params.priceSelicAdjustment === 'recalculo_pmt' ? 'recalculo PMT mensal' : 'PMT fixa 1a competencia'}`,
        ]),
    `Custo op. (pós-car.): ${opCostStr}`,
    `Juros (pós-car.): ${modoJuros}`,
    ...(params.system === 'SAC' ? [`${sacAccrPdf}` as const] : []),
    ...(params.system === 'PRICE' && priceAccrPdf ? [`${priceAccrPdf}` as const] : []),
    `Rateio custo op.: ${custoRateioCurto}`,
  ];

  const drawWrappedColumn = (items: string[], x: number, startY: number, maxWidth: number) => {
    let y = startY;
    for (const item of items) {
      const lines = doc.splitTextToSize(pdfSafe(item), maxWidth) as string[];
      doc.text(lines, x, y);
      y += lines.length * 5 + 2;
    }
    return y;
  };

  const marginRight = 14;
  const gap = 12;
  const leftX = 14;
  const rightX = 145;
  const rightMaxWidth = pageWidth - rightX - marginRight;
  const leftMaxWidth = rightX - leftX - gap;

  const leftEndY = drawWrappedColumn(leftCol, leftX, 55, leftMaxWidth);
  const rightEndY = drawWrappedColumn(rightCol, rightX, 55, rightMaxWidth);
  const fullTextWidth = pageWidth - leftX - marginRight;
  const cpcEndY = drawWrappedColumn(cpcDemoLines, leftX, Math.max(leftEndY, rightEndY) + 4, fullTextWidth);
  const totalsY = cpcEndY + 3;

  // Totais
  const totalGeralPago = schedule.reduce((acc, row) => acc + row.installment, 0);
  const totalJuros = schedule.reduce((acc, row) => acc + row.interest, 0);
  const totalCustos = schedule.reduce((acc, row) => acc + row.monthlyCost, 0);
  
  doc.text(pdfSafe(`Total Pago: ${formatCurrency(totalGeralPago)}`), 14, totalsY);
  doc.text(pdfSafe(`Total de Juros: ${formatCurrency(totalJuros)}`), 105, totalsY);
  doc.text(pdfSafe(`Total Custos Op.: ${formatCurrency(totalCustos)}`), 195, totalsY);

  // Tabela única — colunas exatamente iguais à aba Tabela do empréstimo na web.
  const columns = [
    { key: 'month', label: 'Nº Parcela' },
    { key: 'date', label: 'Data' },
    {
      key: 'days',
      label: params?.varIndexMode === 'selic_over_diaria' ? 'Dias (DU)' : 'Dias',
    },
    { key: 'selic', label: 'Fator SELIC' },
    { key: 'rate', label: 'Taxa %' },
    { key: 'initial', label: 'SD Inicial' },
    { key: 'installment', label: 'Parcela Bruta' },
    { key: 'amortization', label: 'Parcela Líq.' },
    { key: 'prepayment', label: 'Adiantado' },
    { key: 'interest', label: 'Juros' },
    { key: 'ajusteJuros', label: 'Aj. Neg.' },
    { key: 'ajustes', label: 'Aj. Pos.' },
    { key: 'final', label: 'SD Final' },
    { key: 'short', label: 'Curto' },
    { key: 'long', label: 'Longo' },
    { key: 'ocorrencia', label: 'Parcela Atrasada' },
  ];

  const decemberIndices = new Set<number>();
  const years = new Set<number>();
  schedule.forEach((r) => {
    if (r.month > 0 && r.date) {
      const d = r.date instanceof Date ? r.date : new Date(r.date);
      years.add(d.getUTCFullYear());
    }
  });

  for (const year of years) {
    let bestIdx = -1;
    let bestDay = -1;
    schedule.forEach((row, idx) => {
      if (row.month <= 0 || !row.date) return;
      const d = row.date instanceof Date ? row.date : new Date(row.date);
      if (d.getUTCFullYear() !== year || d.getUTCMonth() !== 11) return;
      const day = d.getDate();
      if (day > bestDay) {
        bestDay = day;
        bestIdx = idx;
      }
    });
    if (bestIdx >= 0) decemberIndices.add(bestIdx);
  }

  let maxGrace = 0;
  schedule.forEach((r) => {
    if (r.isGrace && r.month > maxGrace) {
      maxGrace = r.month;
    }
  });

  const OVERDUE_HEADER_MARKER = '__OVERDUE_HEADER__';
  const processedRows: any[] = [];
  let overdueHeaderInserted = false;
  schedule.forEach((row, idx) => {
    if (row.isOverdue && !overdueHeaderInserted) {
      overdueHeaderInserted = true;
      processedRows.push({ _isOverdueHeader: true });
    }

    const isDec = decemberIndices.has(idx);
    const isLastGraceMonth = row.isGrace && row.month === maxGrace;
    const isGraceNotLast = row.isGrace && row.month < maxGrace;

    const isReclas = (isDec && !isGraceNotLast) || isLastGraceMonth;

    if (!isReclas) {
      processedRows.push({ ...row });
      return;
    }

    const longoAntes = row.isGrace
      ? Math.max(0, row.finalBalance)
      : (row.longTermBalanceBeforeReclas ?? row.longTermBalance);
    processedRows.push({
      ...row,
      shortTermBalance: 0,
      longTermBalance: longoAntes,
    });

    const curtoAlvo = row.shortTermBalance;
    if (curtoAlvo >= 0.005) {
      processedRows.push({
        isReclas: true,
        month: -1,
        date: row.date,
        accrualDays: 0,
        referenceMonthDays: 0,
        die30Factor: 0,
        opCostPeriodFactor: 0,
        initialBalance: row.finalBalance,
        interest: 0,
        amortization: 0,
        monthlyCost: 0,
        iof: 0,
        installment: 0,
        finalBalance: row.finalBalance,
        shortTermBalance: curtoAlvo,
        longTermBalance: row.longTermBalance,
        isGrace: false,
      });
    }
  });

  let installmentNumber = 0;
  const displayMonthLabels = processedRows.map((row) => {
    if (row._isOverdueHeader || row.isReclas || row.month === 0 || row.isGrace || row.isDelayedPayment || row.isOverdue) return null;
    installmentNumber += 1;
    return String(installmentNumber);
  });

  const graceType = params.graceType ?? 'capitalized';

  const tableData: string[][] = processedRows.map((row, idx) => {
    if (row._isOverdueHeader) {
      return [OVERDUE_HEADER_MARKER, ...Array(columns.length - 1).fill('')];
    }
    return columns.map((col) =>
      pdfSafe(formatScheduleCell(row, col.key, graceType, displayMonthLabels[idx] ?? null)),
    );
  });

  autoTable(doc, {
    startY: totalsY + 8,
    margin: { left: 8, right: 8, top: 10, bottom: 10 },
    head: [columns.map((col) => pdfSafe(col.label))],
    body: tableData,
    theme: 'grid',
    headStyles: { fillColor: [30, 64, 175], fontSize: 6.5, fontStyle: 'bold', halign: 'center' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    styles: { fontSize: 6, cellPadding: { top: 1.2, right: 1, bottom: 1.2, left: 1 }, halign: 'right', overflow: 'linebreak' },
    columnStyles: {
      0: { halign: 'center' },
      1: { halign: 'center' },
      15: { halign: 'center' },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && Array.isArray(data.row.raw) && (data.row.raw as string[])[0] === OVERDUE_HEADER_MARKER) {
        data.cell.colSpan = columns.length;
        data.cell.styles.fillColor = [194, 65, 12]; // orange-700
        data.cell.styles.textColor = [255, 255, 255];
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.halign = 'left';
        if (data.column.index === 0) {
          data.cell.text = ['Saldo Parcelas Atrasadas — Ciclo de Quitação'];
        } else {
          data.cell.text = [];
        }
      }
      const rawRow = data.row.raw as string[];
      if (data.section === 'body' && Array.isArray(rawRow) && rawRow[0] === 'Reclas.') {
        data.cell.styles.fillColor = [241, 245, 249]; // slate-100
        data.cell.styles.fontStyle = 'bold';
      }
      if (
        data.section === 'body' &&
        data.column.index === 15 &&
        Array.isArray(rawRow) &&
        typeof rawRow[15] === 'string'
      ) {
        if (rawRow[15] === 'Não Pago') {
          data.cell.styles.fillColor = [254, 202, 202]; // red-200
          data.cell.styles.textColor = [153, 27, 27];   // red-800
          data.cell.styles.fontStyle = 'bold';
        } else if (rawRow[15] === 'Pago') {
          data.cell.styles.fillColor = [209, 250, 229]; // emerald-100
          data.cell.styles.textColor = [6, 95, 70];     // emerald-800
          data.cell.styles.fontStyle = 'bold';
        }
      }
    },
  });

  doc.save(buildPdfFileName(params, meta));
}

/** Nome de arquivo seguro (sem acentos/caracteres especiais) com banco e nº do contrato. */
function sanitizeFileNamePart(raw: string | undefined): string {
  return (raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos combinantes (á→a, ç→c, ...)
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function buildPdfFileName(params: LoanParams, meta?: PdfContractMeta): string {
  const banco = sanitizeFileNamePart(meta?.bankName);
  const contrato = sanitizeFileNamePart(meta?.contractNumber);
  const parts = [params.system.toLowerCase(), banco, contrato].filter(Boolean);
  return `${parts.join('_') || 'simulacao'}.pdf`;
}
