import { format, isAfter, isValid, isBefore, lastDayOfMonth, parseISO, setDate, startOfDay } from 'date-fns';
import { LoanRow } from './loanCalculator';
import type { DiagnosticoExportItem } from './exportDiagnostico';
import {
  anosOperacionaisNoCronograma,
  calcTransferencia31DezAno,
  obterMaxMesCarencia,
  indiceLinhaDezembroNoAno,
  indiceUltimaLinhaOperacionalNoAno,
} from './cpcFiscalYearEnd';

export interface DominioExportConfig {
  accJurosAproDebit: string;
  accJurosAproCredit: string;
  accApropriacaoDebit: string;
  accApropriacaoCredit: string;
  accTransferenciaDebit: string;
  accTransferenciaCredit: string;
  accEmprestimoDebit: string;
  accEmprestimoCredit: string;
  /** IOF do contrato (valor único na data do contrato) — usado só no cálculo do saldo/curto prazo, não gera lançamento próprio. */
  valorIof?: number;
  /**
   * Partida dobrada (;): coluna 5 (código) e/ou prefixo da coluna 6 (histórico).
   * Só dígitos (e espaços) ⇒ código nos lançamentos; com letras ⇒ código "0" e este texto antes do histórico gerado («texto — HISTÓRICO»).
   */
  codigoHistoricoDominio?: string;
  /** Partida dobrada (;): coluna complemento após o texto do histórico. */
  complementoHistoricoDominio?: string;
  /** Opcional (yyyy-MM-dd): só lançamentos com data ≥ esta (inclusive). */
  dataGerarLancamentosAPartirStr?: string;
  /** Opcional (yyyy-MM-dd): só lançamentos com data ≤ esta (inclusive). */
  dataGerarLancamentosAteStr?: string;
  /** Parcela bruta não paga: reclassifica CP → LP (débito LP / crédito CP). */
  accNaoPagoDebit?: string;
  accNaoPagoCredit?: string;
  /** Pagamento atrasado quitado: reverte LP → CP (débito CP / crédito LP). */
  accAtrasadoPagoDebit?: string;
  accAtrasadoPagoCredit?: string;
  /**
   * Legado / testes: quando verdadeiro, não gera «TRANSFERENCIA DO LONGO PARA O CURTO PRAZO».
   * A exportação da UI sempre usa false (CPC fiscal único).
   */
  omitTransferenciaLongoParaCurto?: boolean;
}

export type DominioLancamentoPlain = {
  date: Date;
  debContaStr: string;
  credContaStr: string;
  value: number;
  historico: string;
};

function formatDominioNumber(value: number): string {
  return value.toFixed(2).replace('.', ',');
}

/** Campo conta no TXT separador (;) — apenas dígitos, como exige validação típica do Domínio. */
function contaSeparadorDominio(raw: string): string {
  return (raw ?? '').replace(/\D/g, '');
}

/** Campo único da UI: código só-dígitos → coluna 5; texto livre → coluna 5 = "0" e prefixo na coluna 6. */
function parseHistoricoDominioField(raw: string | undefined): { codHist: string; prefixoHistorico: string } {
  const s = String(raw ?? '').trim();
  if (!s) return { codHist: '0', prefixoHistorico: '' };
  if (/^[\d\s]+$/.test(s)) {
    const d = s.replace(/\D/g, '');
    return { codHist: d.length ? d.slice(0, 15) : '0', prefixoHistorico: '' };
  }
  return { codHist: '0', prefixoHistorico: s };
}

/**
 * Aceita apenas valores com pelo menos R$ 0,01 após arredondar a centavo (Domínio rejeita 0,00).
 */
function parseDataGerarLancamentosApartir(config: DominioExportConfig): Date | null {
  const raw = config.dataGerarLancamentosAPartirStr?.trim();
  if (!raw) return null;
  const d = parseISO(raw.slice(0, 10));
  return isValid(d) ? startOfDay(d) : null;
}

function parseDataGerarLancamentosAte(config: DominioExportConfig): Date | null {
  const raw = config.dataGerarLancamentosAteStr?.trim();
  if (!raw) return null;
  const d = parseISO(raw.slice(0, 10));
  return isValid(d) ? startOfDay(d) : null;
}

function incluirLancamentoNaDataCorte(lancDate: Date, cut: Date | null, cutEnd: Date | null = null): boolean {
  if (cut && isBefore(startOfDay(lancDate), cut)) return false;
  if (cutEnd && isAfter(startOfDay(lancDate), cutEnd)) return false;
  return true;
}

function valorMinimoUmCentavo(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const cent = Math.round(value * 100);
  return cent >= 1 ? cent / 100 : null;
}

/** Remove acentos e mantém texto imprimível (compatível com Domínio em TXT ANSI comum). */
function toDominioHistoricoAscii(s: string): string {
  let t = (s ?? '').normalize('NFD').replace(/\p{M}/gu, '');
  const map: Record<string, string> = {
    Ç: 'C',
    ç: 'C',
    ß: 'SS',
    '–': '-',
    '—': '-',
  };
  t = t.replace(/[Ççß–—]/g, (ch) => map[ch] ?? ch);
  t = t.replace(/[^\x20-\x7E]/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * Curto prazo usado nas transferências LP→CP do TXT: coluna Curto da tabela menos o IOF do contrato.
 * `iofContrato` só é > 0 em contratos legados que ainda têm valor de IOF no cálculo do saldo — em
 * contratos novos (sem IOF, que agora usam Ajustes de Juros Positivos/Negativo) fica sempre 0 e essa
 * subtração não tem efeito.
 */
function curtoPrazoParaDominio(row: LoanRow, iofContrato: number): number {
  const curtoTabela = Math.max(0, row.shortTermBalance);
  if (iofContrato <= 0) return curtoTabela;
  return Math.max(0, curtoTabela - iofContrato);
}

/** Saldo de longo prazo para o TXT (saldo devedor − curto Domínio, alinhado à tabela). */
function longoPrazoParaDominio(row: LoanRow, iofContrato: number): number {
  const saldo = Math.max(0, row.finalBalance);
  return Math.max(0, saldo - curtoPrazoParaDominio(row, iofContrato));
}

function transferenciaJaLancadaEm(lista: DominioLancamentoPlain[], date: Date): boolean {
  const target = format(date, 'yyyy-MM-dd');
  return lista.some(
    (l) =>
      l.historico === 'TRANSFERENCIA DO LONGO PARA O CURTO PRAZO' &&
      format(l.date, 'yyyy-MM-dd') === target,
  );
}

function calcValorTransferencia31DezAno(
  schedule: LoanRow[],
  year: number,
  iofContrato: number,
): number {
  return calcTransferencia31DezAno(schedule, year, (row) => curtoPrazoParaDominio(row, iofContrato));
}

function appendTransferenciasFechamentoAnual(
  lista: DominioLancamentoPlain[],
  schedule: LoanRow[],
  config: DominioExportConfig,
  iofContrato: number,
  cut: Date | null,
  cutEnd: Date | null,
): void {
  if (config.omitTransferenciaLongoParaCurto) return;
  if (!config.accTransferenciaDebit?.trim() || !config.accTransferenciaCredit?.trim()) return;

  const years = anosOperacionaisNoCronograma(schedule);

  for (const year of years) {
    const decIdx = indiceLinhaDezembroNoAno(schedule, year);
    const closeIdx = decIdx >= 0 ? decIdx : indiceUltimaLinhaOperacionalNoAno(schedule, year);
    if (closeIdx >= 0) {
      const row = schedule[closeIdx];
      const maxGrace = obterMaxMesCarencia(schedule);
      if (row.isGrace && row.month < maxGrace) {
        continue;
      }
    }

    const dec31 = lastDayOfMonth(new Date(year, 11, 1));
    if (!incluirLancamentoNaDataCorte(dec31, cut, cutEnd)) continue;
    if (transferenciaJaLancadaEm(lista, dec31)) continue;

    const valor = calcValorTransferencia31DezAno(schedule, year, iofContrato);
    const v = valorMinimoUmCentavo(valor);
    if (v === null) continue;

    lista.push({
      date: dec31,
      debContaStr: config.accTransferenciaDebit,
      credContaStr: config.accTransferenciaCredit,
      value: v,
      historico: 'TRANSFERENCIA DO LONGO PARA O CURTO PRAZO',
    });
  }
}

/**
 * Classificação na data do contrato: saldo em longo prazo.
 * Transferência LP→CP só no fechamento de 31/12 (ver loop mensal).
 */
function pushClassificacaoCpcDataContrato(
  lista: DominioLancamentoPlain[],
  row0: LoanRow,
  iofContrato: number,
  config: DominioExportConfig
): void {
  if (config.omitTransferenciaLongoParaCurto || !row0.date) return;
  if (!config.accTransferenciaDebit?.trim()) return;

  const vLongo = valorMinimoUmCentavo(longoPrazoParaDominio(row0, iofContrato));
  if (vLongo !== null && config.accEmprestimoDebit?.trim()) {
    lista.push({
      date: row0.date,
      debContaStr: config.accTransferenciaDebit,
      credContaStr: config.accEmprestimoDebit,
      value: vLongo,
      historico: 'SALDO LONGO PRAZO EMPRESTIMO',
    });
  }
}

/**
 * Passivo na data do contrato (linha 0):
 * - VALOR DO EMPRESTIMO = principal (saldo inicial)
 * Soma = `finalBalance` (saldo devedor). Tabela: coluna Curto = parcelas líquidas CPC.
 */
export function coletarLancamentosDominio(schedule: LoanRow[], config: DominioExportConfig): DominioLancamentoPlain[] {
  const lista: DominioLancamentoPlain[] = [];
  const cut = parseDataGerarLancamentosApartir(config);
  const cutEnd = parseDataGerarLancamentosAte(config);
  const iofContrato = Math.max(0, schedule[0]?.iof ?? config.valorIof ?? 0);

  if (schedule.length > 0) {
    const row0 = schedule[0];
    let dataContrato = row0.date;
    if (dataContrato && cut && isBefore(startOfDay(dataContrato), cut)) {
      dataContrato = cut;
    }
    const vIni = valorMinimoUmCentavo(row0.initialBalance ?? 0);
    if (
      dataContrato &&
      incluirLancamentoNaDataCorte(dataContrato, cut, cutEnd) &&
      vIni !== null &&
      config.accEmprestimoDebit &&
      config.accEmprestimoCredit
    ) {
      lista.push({
        date: dataContrato,
        debContaStr: config.accEmprestimoDebit,
        credContaStr: config.accEmprestimoCredit,
        value: vIni,
        historico: 'VALOR DO EMPRESTIMO',
      });
    }

    if (dataContrato && incluirLancamentoNaDataCorte(dataContrato, cut, cutEnd)) {
      pushClassificacaoCpcDataContrato(lista, { ...row0, date: dataContrato }, iofContrato, config);
    }
  }

  schedule.forEach((row) => {
    if (row.month === 0 || !row.date) return;

    // Carência capitalizada: juros são incorporados ao saldo devedor (longo prazo) e NÃO
    // são pagos separadamente. Gerar PROVISAO/APROPRIACÃO duplicaria o valor — os juros
    // já estão embutidos no LP. Só gera lançamentos de juros para carência PAGA (installment > 0).
    if (row.isGrace && row.installment === 0) return;

    const firstDay = setDate(row.date, 1);
    const lastDay = lastDayOfMonth(row.date);

    // row.interest já inclui o ajuste do mês (coluna Ajustes de Juros Positivos/Negativo) —
    // mesmo valor mostrado na coluna "Juros" da tabela do cronograma.
    const valorJuros = valorMinimoUmCentavo(row.interest ?? 0);
    if (
      valorJuros !== null &&
      config.accJurosAproDebit &&
      config.accJurosAproCredit &&
      incluirLancamentoNaDataCorte(firstDay, cut, cutEnd)
    ) {
      lista.push({
        date: firstDay,
        debContaStr: config.accJurosAproDebit,
        credContaStr: config.accJurosAproCredit,
        value: valorJuros,
        historico: 'PROVISAO DE JUROS A APROPRIAR',
      });
    }

    // Parcela não paga: juros ficam apenas provisionados — não apropriar na despesa,
    // pois não houve pagamento. A apropriação ocorre somente quando a parcela for paga.
    if (
      !row.isUnpaid &&
      valorJuros !== null &&
      config.accApropriacaoDebit &&
      config.accApropriacaoCredit &&
      incluirLancamentoNaDataCorte(lastDay, cut, cutEnd)
    ) {
      lista.push({
        date: lastDay,
        debContaStr: config.accApropriacaoDebit,
        credContaStr: config.accApropriacaoCredit,
        value: valorJuros,
        historico: 'APROPRIACAO DE JUROS',
      });
    }

    // ─── Mês Não Pago: transfere parcela bruta CP → LP no último dia do mês ───
    if (
      row.isUnpaid &&
      row.unpaidAmount != null &&
      row.unpaidAmount > 0 &&
      config.accNaoPagoDebit?.trim() &&
      config.accNaoPagoCredit?.trim() &&
      incluirLancamentoNaDataCorte(lastDay, cut, cutEnd)
    ) {
      const v = valorMinimoUmCentavo(row.unpaidAmount);
      if (v !== null) {
        lista.push({
          date: lastDay,
          debContaStr: config.accNaoPagoDebit,
          credContaStr: config.accNaoPagoCredit,
          value: v,
          historico: 'PARCELA NAO PAGA - TRANSFERENCIA CP PARA LP',
        });
      }
    }

    // ─── Pagamento Atrasado: reverte LP → CP pelo valor efetivamente pago ───
    // paymentAmount > 0 em uma linha marcada como unpaid = pagamento atrasado parcial/total.
    if (
      row.isUnpaid &&
      row.paymentAmount != null &&
      row.paymentAmount > 0 &&
      config.accAtrasadoPagoDebit?.trim() &&
      config.accAtrasadoPagoCredit?.trim() &&
      incluirLancamentoNaDataCorte(lastDay, cut, cutEnd)
    ) {
      const v = valorMinimoUmCentavo(row.paymentAmount);
      if (v !== null) {
        lista.push({
          date: lastDay,
          debContaStr: config.accAtrasadoPagoDebit,
          credContaStr: config.accAtrasadoPagoCredit,
          value: v,
          historico: 'PAGAMENTO ATRASADO - RETORNO LP PARA CP',
        });
      }
    }
  });

  /** Uma transferência LP→CP por ano civil, sempre em 31/12. */
  appendTransferenciasFechamentoAnual(lista, schedule, config, iofContrato, cut, cutEnd);

  return lista;
}

/** Quantidade de linhas «TRANSFERENCIA DO LONGO PARA O CURTO PRAZO» que o TXT geraria. */
export function contarTransferenciasLpCp(schedule: LoanRow[], config: DominioExportConfig): number {
  return coletarLancamentosDominio(schedule, config).filter(
    (l) => l.historico === 'TRANSFERENCIA DO LONGO PARA O CURTO PRAZO',
  ).length;
}

/** Verifica pré-requisitos antes de exportar TXT+ Domínio (empréstimos). */
export function diagnosticarExportEmprestimo(
  schedule: LoanRow[],
  config: DominioExportConfig,
): DiagnosticoExportItem[] {
  const items: DiagnosticoExportItem[] = [];

  // ── Contas de provisão e apropriação de juros (obrigatórias para gerar os lançamentos) ──
  const jurosAproDeb = config.accJurosAproDebit?.trim();
  const jurosAproCred = config.accJurosAproCredit?.trim();
  items.push({
    ok: !!(jurosAproDeb && jurosAproCred),
    label:
      jurosAproDeb && jurosAproCred
        ? 'Contas de provisão de juros a apropriar (1º dia do mês)'
        : 'Preencha débito e crédito da PROVISÃO DE JUROS A APROPRIAR (aba Contas) — sem isso nenhum lançamento de juros será gerado',
  });

  const apropriacaoDeb = config.accApropriacaoDebit?.trim();
  const apropriacaoCred = config.accApropriacaoCredit?.trim();
  items.push({
    ok: !!(apropriacaoDeb && apropriacaoCred),
    label:
      apropriacaoDeb && apropriacaoCred
        ? 'Contas de apropriação de juros (último dia do mês)'
        : 'Preencha débito e crédito da APROPRIAÇÃO DE JUROS (aba Contas) — sem isso a apropriação de juros será omitida do TXT',
  });

  // ── Contas de transferência LP→CP ──
  const deb = config.accTransferenciaDebit?.trim();
  const cred = config.accTransferenciaCredit?.trim();
  items.push({
    ok: !!(deb && cred),
    label:
      deb && cred
        ? 'Contas de transferência LP→CP'
        : 'Preencha débito e crédito da transferência LP→CP (aba Contas)',
  });

  if (config.omitTransferenciaLongoParaCurto) return items;

  const qtd = contarTransferenciasLpCp(schedule, config);
  items.push({
    ok: qtd > 0,
    label:
      qtd > 0
        ? `${qtd} transferência(s) LP→CP em 31/12 no TXT`
        : 'Nenhuma transferência LP→CP será gerada — confira coluna Curto na tabela/PDF e datas do cronograma',
  });

  return items;
}

/** Gera TXT partida dobrada (separadores `;`). */
export function generateDominioTXT(schedule: LoanRow[], config: DominioExportConfig): string {
  const lista = coletarLancamentosDominio(schedule, config);
  const { codHist, prefixoHistorico } = parseHistoricoDominioField(config.codigoHistoricoDominio);
  const prefLimpo = prefixoHistorico ? `${toDominioHistoricoAscii(prefixoHistorico).replace(/;/g, ' ')} — ` : '';
  const compl = toDominioHistoricoAscii(config.complementoHistoricoDominio ?? '').replace(/;/g, ' ');
  const lines = lista.map((l) => {
    const d = contaSeparadorDominio(l.debContaStr);
    const c = contaSeparadorDominio(l.credContaStr);
    const nucleo = toDominioHistoricoAscii(l.historico).replace(/;/g, ' ');
    const histTxt = toDominioHistoricoAscii(`${prefLimpo}${nucleo}`)
      .replace(/;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return `${format(l.date, 'dd/MM/yyyy')};${d};${c};${formatDominioNumber(l.value)};${codHist};${histTxt};${compl}`;
  });

  const body = lines.join('\r\n');
  /** Sempre sem cabeçalho — importação típica do Domínio exige que a linha 1 seja já um lançamento. */
  return body;
}

export function downloadDominioTXT(content: string, filename: string = 'lancamentos_dominio.txt') {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
