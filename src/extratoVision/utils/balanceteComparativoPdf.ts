import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { AuditoriaBalanceteResumo } from './auditoriaBalanceteContinua';
import {
  agruparAchadosAuditoriaPorTipo,
  formatContasAgrupadasPdf,
  fundamentacaoNormativaAgrupadaPdf,
} from './auditoriaAchadosAgrupados';
import type { LinhaComparativoMensal, PeriodoMensal, SaldoMensalCelula } from './balanceteComparativoMensal';

const MARGEM = 32;
const MESES_POR_BLOCO = 6;

function pdfText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\xFF]/g, '?');
}

function mesCurto(label: string): string {
  const m = label.match(/^(\d{2})\/(\d{4})$/);
  if (m) return `${m[1]}/${m[2].slice(-2)}`;
  return label.length > 7 ? label.slice(0, 7) : label;
}

function fmtSaldoPdf(cel: SaldoMensalCelula | null | undefined, natEsp: 'D' | 'C'): string {
  if (!cel || cel.valor < 0.001) return '-';
  const v = cel.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const inv = cel.invertido === true || cel.natureza !== natEsp;
  return inv ? `${v} ${cel.natureza}*` : `${v} ${cel.natureza}`;
}

function celulaInvertida(
  cel: SaldoMensalCelula | null | undefined,
  natEsp: 'D' | 'C',
): boolean {
  if (!cel || cel.valor < 0.01) return false;
  return cel.invertido === true || cel.natureza !== natEsp;
}

function linhaTemMovimento(linha: LinhaComparativoMensal, periodos: PeriodoMensal[]): boolean {
  return periodos.some((p) => (linha.saldosPorMes[p.label]?.valor ?? 0) >= 0.01);
}

function linhaTemInversao(linha: LinhaComparativoMensal, periodos: PeriodoMensal[]): boolean {
  const nat = linha.naturezaCodigo ?? 'D';
  return periodos.some((p) => celulaInvertida(linha.saldosPorMes[p.label], nat));
}

function severidadePdfLabel(sev: 'critico' | 'alerta' | 'info'): string {
  if (sev === 'critico') return 'CRITICO';
  if (sev === 'alerta') return 'ALERTA';
  return 'INFO';
}

function blocosMeses(periodos: PeriodoMensal[]): PeriodoMensal[][] {
  const blocos: PeriodoMensal[][] = [];
  for (let i = 0; i < periodos.length; i += MESES_POR_BLOCO) {
    blocos.push(periodos.slice(i, i + MESES_POR_BLOCO));
  }
  return blocos.length ? blocos : [[]];
}

function buildColumnStyles(
  numMeses: number,
  pageW: number,
): Record<number, { cellWidth: number; halign?: 'left' | 'right' | 'center'; overflow?: 'linebreak' | 'ellipsize' }> {
  const fixo = 42 + 88 + 130 + 20;
  const restante = Math.max(60, pageW - MARGEM * 2 - fixo);
  const mesW = Math.max(48, Math.floor(restante / Math.max(1, numMeses)));
  const styles: Record<number, { cellWidth: number; halign?: 'left' | 'right' | 'center'; overflow?: 'linebreak' | 'ellipsize' }> = {
    0: { cellWidth: 42, overflow: 'ellipsize' },
    1: { cellWidth: 88, overflow: 'ellipsize' },
    2: { cellWidth: 130, overflow: 'linebreak' },
    3: { cellWidth: 20, halign: 'center' },
  };
  for (let i = 0; i < numMeses; i += 1) {
    styles[4 + i] = { cellWidth: mesW, halign: 'right', overflow: 'linebreak' };
  }
  return styles;
}

function desenharTabelaComparativo(
  doc: jsPDF,
  startY: number,
  linhas: LinhaComparativoMensal[],
  periodosBloco: PeriodoMensal[],
  tituloBloco: string,
  indiceBloco: number,
  totalBlocos: number,
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const somenteRelevantes = linhas.filter(
    (l) => linhaTemMovimento(l, periodosBloco) || linhaTemInversao(l, periodosBloco),
  );
  const rows = somenteRelevantes.length > 0 ? somenteRelevantes : linhas.slice(0, 500);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text(
    pdfText(
      totalBlocos > 1
        ? `${tituloBloco} (parte ${indiceBloco + 1}/${totalBlocos})`
        : tituloBloco,
    ),
    MARGEM,
    startY,
  );
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(
    pdfText('Colunas: Cod reduzido | Classificacao | Conta | Nat esperada | saldo final do mes. * = invertida'),
    MARGEM,
    startY + 12,
  );

  const head = [
    'Cod',
    'Classificacao',
    'Conta',
    'Nat',
    ...periodosBloco.map((p) => mesCurto(p.label)),
  ];

  const body = rows.map((linha) => {
    const natEsp = linha.naturezaCodigo ?? 'D';
    return [
      pdfText((linha.codigo || '-').slice(0, 12)),
      pdfText((linha.classificacao || '-').slice(0, 16)),
      pdfText((linha.nome || '-').slice(0, 38)),
      natEsp,
      ...periodosBloco.map((p) => pdfText(fmtSaldoPdf(linha.saldosPorMes[p.label], natEsp))),
    ];
  });

  const fontSize = periodosBloco.length > 5 ? 6 : 7;
  const columnStyles = buildColumnStyles(periodosBloco.length, pageW);

  autoTable(doc, {
    startY: startY + 18,
    head: [head],
    body,
    theme: 'grid',
    styles: {
      fontSize,
      cellPadding: 2,
      overflow: 'linebreak',
      valign: 'middle',
      lineColor: [200, 200, 200],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: [20, 20, 20],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: fontSize + 0.5,
      halign: 'center',
    },
    columnStyles,
    margin: { left: MARGEM, right: MARGEM },
    tableWidth: pageW - MARGEM * 2,
    horizontalPageBreak: true,
    horizontalPageBreakRepeat: 3,
    showHead: 'everyPage',
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      if (data.column.index < 4) return;
      const raw = String(data.cell.raw ?? '');
      if (raw.includes('*')) {
        data.cell.styles.textColor = [153, 27, 27];
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  return (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable!.finalY + 14;
}

/** PDF legível do comparativo mensal + auditoria RF/CPC. */
export function exportBalanceteComparativoPdf(params: {
  linhas: LinhaComparativoMensal[];
  periodos: PeriodoMensal[];
  empresa?: string;
  periodoDe?: string;
  periodoAte?: string;
  auditoria?: AuditoriaBalanceteResumo | null;
}): void {
  const { linhas, periodos, empresa, periodoDe, periodoAte, auditoria } = params;
  const now = new Date();
  const generatedAt = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const addRodape = () => {
    const total = doc.getNumberOfPages();
    for (let p = 1; p <= total; p += 1) {
      doc.setPage(p);
      doc.setFontSize(7);
      doc.setTextColor(100, 100, 100);
      doc.text(
        pdfText(`* = saldo invertido (CPC 26) · Pagina ${p}/${total}`),
        MARGEM,
        pageH - 18,
      );
    }
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(pdfText('Balancete comparativo mensal'), MARGEM, 34);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  let y = 48;
  doc.text(pdfText(`Empresa: ${empresa?.trim() || 'Nao informada'}`), MARGEM, y);
  y += 11;
  if (periodoDe && periodoAte) {
    doc.text(pdfText(`Periodo: ${periodoDe} a ${periodoAte}`), MARGEM, y);
    y += 11;
  }
  doc.text(pdfText(`Gerado em: ${generatedAt}`), MARGEM, y);
  y += 11;
  const qtdInv = linhas.filter((l) => linhaTemInversao(l, periodos)).length;
  doc.text(
    pdfText(
      `Contas com movimento: ${linhas.filter((l) => linhaTemMovimento(l, periodos)).length} · ` +
        `Com inversao (*): ${qtdInv} · Meses: ${periodos.length}`,
    ),
    MARGEM,
    y,
  );
  y += 16;

  if (auditoria && auditoria.total > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(153, 27, 27);
    doc.text(
      pdfText(
        `Auditoria RF + CPC: ${auditoria.criticos} critico(s), ${auditoria.alertas} alerta(s) · score ${auditoria.score}`,
      ),
      MARGEM,
      y,
    );
    doc.setTextColor(0, 0, 0);
    y += 10;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(80, 80, 80);
    const grupos = agruparAchadosAuditoriaPorTipo(auditoria.achados);
    doc.text(
      pdfText(
        `${grupos.length} tipo(s) de problema · ${auditoria.total} ocorrencia(s) em contas · fundamentacao CPC/RF uma vez por tipo.`,
      ),
      MARGEM,
      y,
    );
    doc.setTextColor(0, 0, 0);
    y += 10;

    const tableW = pageW - MARGEM * 2;
    const colGrav = 42;
    const colProblema = 118;
    const colFund = tableW - colGrav - colProblema;

    autoTable(doc, {
      startY: y,
      head: [['Grav.', 'Problema e contas afetadas', 'Fundamentacao normativa (por que + paragrafo + trecho)']],
      body: grupos.map((g) => [
        severidadePdfLabel(g.severidade),
        pdfText(`PROBLEMA: ${g.titulo}\n\n${formatContasAgrupadasPdf(g.contas)}`),
        pdfText(fundamentacaoNormativaAgrupadaPdf(g)),
      ]),
      styles: {
        fontSize: 6.5,
        cellPadding: 3,
        overflow: 'linebreak',
        valign: 'top',
      },
      headStyles: { fillColor: [153, 27, 27], fontSize: 7, valign: 'middle' },
      columnStyles: {
        0: { cellWidth: colGrav, fontStyle: 'bold' },
        1: { cellWidth: colProblema },
        2: { cellWidth: colFund },
      },
      margin: { left: MARGEM, right: MARGEM },
      tableWidth: tableW,
    });
    y = (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable!.finalY + 18;
  }

  const blocos = blocosMeses(periodos);
  blocos.forEach((periodosBloco, idx) => {
    if (y > pageH - 120) {
      doc.addPage();
      y = 40;
    }
    const de = periodosBloco[0]?.label ?? '';
    const ate = periodosBloco[periodosBloco.length - 1]?.label ?? '';
    y = desenharTabelaComparativo(
      doc,
      y,
      linhas,
      periodosBloco,
      pdfText(`Saldos por mes ${de}${ate && de !== ate ? ` a ${ate}` : ''}`),
      idx,
      blocos.length,
    );
  });

  if (qtdInv > 0) {
    const invertidas = linhas.filter((l) => linhaTemInversao(l, periodos));
    if (y > pageH - 100) {
      doc.addPage();
      y = 40;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(pdfText(`Resumo contas invertidas (${invertidas.length})`), MARGEM, y);
    y += 12;

    autoTable(doc, {
      startY: y,
      head: [['Cod', 'Conta', 'Meses com *']],
      body: invertidas.slice(0, 80).map((linha) => {
        const mesesInv = periodos
          .filter((p) => celulaInvertida(linha.saldosPorMes[p.label], linha.naturezaCodigo ?? 'D'))
          .map((p) => mesCurto(p.label));
        const resumo =
          mesesInv.length <= 4
            ? mesesInv.join(' ')
            : `${mesesInv.length} meses: ${mesesInv[0]} … ${mesesInv[mesesInv.length - 1]}`;
        return [
          pdfText((linha.codigo || '-').slice(0, 12)),
          pdfText((linha.nome || '-').slice(0, 45)),
          pdfText(resumo),
        ];
      }),
      styles: { fontSize: 7, cellPadding: 2.5, overflow: 'linebreak' },
      headStyles: { fillColor: [153, 27, 27] },
      columnStyles: {
        0: { cellWidth: 50 },
        1: { cellWidth: 200 },
        2: { cellWidth: pageW - MARGEM * 2 - 250 },
      },
      margin: { left: MARGEM, right: MARGEM },
      tableWidth: pageW - MARGEM * 2,
    });
  }

  addRodape();

  const slug = (empresa?.trim() || 'empresa')
    .replace(/[^\w\-]+/g, '_')
    .slice(0, 40);
  doc.save(`balancete_comparativo_${slug}_${now.getTime()}.pdf`);
}
