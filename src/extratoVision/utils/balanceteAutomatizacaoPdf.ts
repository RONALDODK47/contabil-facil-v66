import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getClassificacao } from './demonstracoesContabeis';
import type { ResultadoAutomatizacaoCompleta } from './balanceteAutomatizacaoCompleta';

function pdfText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\xFF]/g, '?');
}

function fmtMoeda(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function classificarAcao(historico: string): string {
  const h = historico.toLowerCase();
  if (h.includes('utilizacao garantia') || h.includes('utilização garantia'))
    return 'Banco / Garantida — Utilizacao';
  if (h.includes('devolucao garantia') || h.includes('devolução garantia'))
    return 'Banco / Garantida — Devolucao';
  if (h.includes('[auto folha]')) return 'Relatorio Folha';
  if (h.includes('[auto fiscal]')) return 'Relatorio Fiscal';
  if (h.includes('provisao') || h.includes('provisão')) return 'Ajuste Provisao';
  if (h.includes('pagamento') || h.includes('recebimento')) return 'Caixa / Pagamento';
  if (h.includes('ajuste saldo')) return 'Ajuste Saldo';
  return 'Correcao automatica';
}

function ensureSpace(doc: jsPDF, y: number, need = 80): number {
  if (y > 720 - need) {
    doc.addPage();
    return 40;
  }
  return y;
}

/** PDF: contas automatizadas (com descricao) + advertencias por mes sem lancamento. */
export function exportAutomatizacaoBalancetePdf(params: {
  resultado: ResultadoAutomatizacaoCompleta;
  empresa?: string;
  periodoDe?: string;
  periodoAte?: string;
}): void {
  const { resultado, empresa, periodoDe, periodoAte } = params;
  const lancamentos = resultado.lancamentosGerados ?? [];
  const contas = resultado.contasCorrigidas ?? [];
  const advertencias = resultado.advertencias ?? [];
  const erros = resultado.erros ?? [];
  const now = new Date();
  const generatedAt = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(pdfText('Relatorio de Automatizacao do Balancete'), 40, 42);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  let headerY = 58;
  doc.text(pdfText(`Empresa: ${empresa?.trim() || 'Nao informada'}`), 40, headerY);
  headerY += 14;
  if (periodoDe && periodoAte) {
    doc.text(pdfText(`Periodo: ${periodoDe} a ${periodoAte}`), 40, headerY);
    headerY += 14;
  }
  doc.text(pdfText(`Gerado em: ${generatedAt}`), 40, headerY);
  headerY += 14;
  doc.text(pdfText(resultado.mensagem), 40, headerY, { maxWidth: pageW - 80 });
  headerY += 22;

  let y = headerY;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(6, 95, 70);
  doc.text(pdfText(`1. Contas automatizadas (${contas.length})`), 40, y);
  doc.setTextColor(0, 0, 0);
  y += 10;

  if (contas.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [
        [
          'Classificacao',
          'Codigo',
          'Descricao da conta',
          'Tipo correcao',
          'Meses c/ lanc.',
          'Lanc.',
          'Debito',
          'Credito',
        ],
      ],
      body: contas.map((c) => [
        c.classificacao || '—',
        c.codigo || '—',
        pdfText((c.descricaoConta || c.nome || '—').slice(0, 48)),
        pdfText(c.tipoAcao),
        pdfText((c.mesesComLancamento ?? []).join(', ') || '—'),
        String(c.qtdLancamentos),
        fmtMoeda(c.totalDebito),
        fmtMoeda(c.totalCredito),
      ]),
      styles: { fontSize: 7.5, cellPadding: 3, overflow: 'linebreak' },
      headStyles: { fillColor: [6, 95, 70] },
      columnStyles: {
        4: { cellWidth: 52 },
        5: { halign: 'center', cellWidth: 28 },
        6: { halign: 'right' },
        7: { halign: 'right' },
      },
    });
    y = (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable!.finalY + 18;
  } else {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'italic');
    doc.text(pdfText('Nenhuma conta recebeu lancamento nesta execucao.'), 40, y + 4);
    y += 28;
  }

  y = ensureSpace(doc, y, 120);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(180, 83, 9);
  doc.text(
    pdfText(`2. Advertencias — meses sem lancamento (${advertencias.length})`),
    40,
    y,
  );
  doc.setTextColor(0, 0, 0);
  y += 10;

  if (advertencias.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [['Mes', 'Conta', 'Classificacao', 'Motivo (nao lancado)']],
      body: advertencias.map((a) => [
        a.mes,
        pdfText((a.conta || '—').slice(0, 42)),
        a.classificacao || '—',
        pdfText(a.motivo.slice(0, 90)),
      ]),
      styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
      headStyles: { fillColor: [180, 83, 9] },
      columnStyles: {
        0: { cellWidth: 42 },
        3: { cellWidth: pageW - 40 - 40 - 42 - 90 - 70 },
      },
    });
    y = (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable!.finalY + 18;
  } else {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'italic');
    doc.text(pdfText('Nenhuma advertencia de mes sem lancamento registrada.'), 40, y + 4);
    y += 28;
  }

  if (lancamentos.length > 0) {
    y = ensureSpace(doc, y, 100);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(30, 41, 59);
    doc.text(pdfText(`3. Detalhamento dos lancamentos (${lancamentos.length})`), 40, y);
    doc.setTextColor(0, 0, 0);
    y += 10;

    autoTable(doc, {
      startY: y,
      head: [['Data', 'Classificacao', 'Descricao / historico', 'Acao', 'Debito', 'Credito']],
      body: lancamentos.map((l) => [
        l.data ?? '—',
        getClassificacao(l) || l.codigo || '—',
        pdfText((l.nome ?? '').slice(0, 65)),
        pdfText(classificarAcao(l.nome ?? '')),
        l.debito > 0.001 ? fmtMoeda(l.debito) : '—',
        l.credito > 0.001 ? fmtMoeda(l.credito) : '—',
      ]),
      styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak' },
      headStyles: { fillColor: [30, 41, 59] },
    });
    y = (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable!.finalY + 18;
  }

  if (erros.length > 0 && erros.length !== advertencias.length) {
    y = ensureSpace(doc, y, 80);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(185, 28, 28);
    doc.text(pdfText(`4. Outros erros (${erros.length})`), 40, y);
    doc.setTextColor(0, 0, 0);
    y += 10;

    const errosExtras = erros.filter(
      (e) => !advertencias.some((a) => a.textoCompleto === e),
    );
    if (errosExtras.length > 0) {
      autoTable(doc, {
        startY: y,
        head: [['#', 'Descricao']],
        body: errosExtras.map((e, i) => [String(i + 1), pdfText(e)]),
        styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
        headStyles: { fillColor: [185, 28, 28] },
        columnStyles: {
          0: { cellWidth: 28, halign: 'center' },
        },
      });
    }
  }

  doc.save(`relatorio_automatizacao_${now.getTime()}.pdf`);
}
