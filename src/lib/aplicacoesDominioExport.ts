import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { addMonths, differenceInCalendarDays, format, lastDayOfMonth, parseISO, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { downloadDominioTXT } from './dominioExporter';
import { montarLinhaTxtDominio } from './dominioTxtLinha';
import type { DiagnosticoExportItem } from './exportDiagnostico';

/**
 * Aplicações financeiras (CDB, LCI, LCA, Tesouro etc.) — TXT+ Domínio.
 * Layout reaproveitado do `parcelamentoDominioExport`, mas sem provisão/apropriação
 * de juros e sem transferência LP→CP. Sobram:
 *  - Linha inicial "APLICACAO FINANCEIRA" (valor acumulado na 1ª data);
 *  - Opcionalmente "APLICACAO DO MES" por competência do cronograma;
 *  - IRRF da aplicação (opcional);
 *  - IOF da aplicação (opcional).
 */

export type VariacaoValorParcelas = 'fixo' | 'selic_dias';

export interface AplicacaoExportInput {
  nomeEmpresa: string;
  nomeAplicacao: string;
  numeroAplicacao?: string;
  valorParcelaStr: string;

  /** Valor da «aplicação do mês» — por competência do cronograma (TXT histórico APLICACAO DO MES). */
  valorAplicacaoMesStr?: string;

  /**
   * Ano civil dos vencimentos mensais quando se usa grade Jan–Dez (último dia de cada mês no TXT).
   * yyyy — ex.: 2026.
   */
  anoCompetenciaMensaisStr?: string;

  /** JSON com array de 12 strings (Jan–Dez), valores em R$ da aplicação do mês em cada célula. */
  valorPorMesAplicacao12Str?: string;

  variacaoValorParcelas?: VariacaoValorParcelas;
  selicMensalPercent?: number | null;

  numeroPrimeiraParcelaStr: string;
  /** Primeira competência (yyyy-MM-dd). Base do cronograma e da 1ª data dos lançamentos de aplicação. */
  dataInicioPrimeiraParcelaStr: string;
  quantidadeParcelasStr: string;

  /** Conta principal da aplicação (entrada — total do cronograma na 1ª data). */
  accAplicacaoDebit: string;
  accAplicacaoCredit: string;

  /**
   * Se verdadeiro, não inclui no TXT+ o lançamento APLICACAO FINANCEIRA (valor acumulado).
   * Não altera receita de juros, IOF nem IRRF — continuam sendo gerados se configurados.
   */
  naoGerarLancamentoAplicacao?: boolean;

  /**
   * Se verdadeiro, não inclui no TXT+ os lançamentos APLICACAO DO MES nas datas do cronograma.
   * Não altera receita de juros, IOF nem IRRF — continuam sendo gerados se configurados.
   */
  naoGerarLancamentoAplicacaoMes?: boolean;

  /**
   * Receita de juros da aplicação (apropriação mensal como receita financeira).
   * Gera 1 lançamento no último dia de cada mês do cronograma com o mesmo valor.
   * Histórico: «RECEITA DE JUROS APLICACAO».
   */
  temReceitaJuros?: boolean;
  valorReceitaJurosMensalStr?: string;
  /** Ano competência opcional quando se usa grade de 12 valores de receita (substitui o valor único por mês nos lançamentos). */
  anoReceitaJurosMensaisStr?: string;
  /** JSON array 12 strings (Jan–Dez) — valores distintos de receita por mês. */
  valorReceitaJurosPorMes12Str?: string;
  accReceitaJurosDebit?: string;
  accReceitaJurosCredit?: string;

  /** IRRF da aplicação (opcional). */
  temIRRF?: boolean;
  valorIRRFStr?: string;
  anoIRRFPorMes12Str?: string;
  valorIRRFPorMes12Str?: string;
  accIRRFDebit?: string;
  accIRRFCredit?: string;

  /** IOF da aplicação (opcional). */
  temIOF?: boolean;
  valorIOFStr?: string;
  anoIOPorMes12Str?: string;
  valorIOPorMes12Str?: string;
  accIOFDebit?: string;
  accIOFCredit?: string;

  /**
   * Código reduzido do **item da Estrutura DFC** (Relatórios > Demonstrativos > DFC) — só dígitos.
   * Quando informado, cada linha do TXT+ ganha sufixo `;codigo_item;valor` (detalhamento DFC, registro 6130 do leiaute Domínio),
   * evitando a advertência de contas de fluxo de caixa sem detalhe na importação.
   */
  dominioCodigoItemDfcStr?: string;
  dominioCodigoHistoricoStr?: string;
  dominioComplementoHistoricoStr?: string;
}

export type AplicacaoLinha = { n: number; date: Date; valor: number };

/** Indica se ano e grade de 12 meses geram pelo menos uma linha de cronograma. */
export function aplicaTemGradeMensal12(
  inp: Pick<AplicacaoExportInput, 'anoCompetenciaMensaisStr' | 'valorPorMesAplicacao12Str'> & {
    numeroPrimeiraParcelaStr?: string;
  },
  parseCurrency: (s: string) => number
): boolean {
  return cronogramaPorGrade12Meses(inp, parseCurrency) !== null;
}

function parseValorMes12Array(
  raw: string | undefined,
  parseCurrency: (s: string) => number
): number[] | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 12) return null;
    const out = parsed.map((x) => parseCurrency(String(x ?? '0')));
    return out.some((v) => v > 0) ? out : null;
  } catch {
    return null;
  }
}

/** Ano yyyy + JSON de 12 células com pelo menos um valor > 0. */
export function temGradeValorMesPopulados(
  anoStr: string | undefined,
  valor12Json: string | undefined,
  parseCurrency: (s: string) => number
): boolean {
  const a = anoStr?.trim();
  if (!a || !/^\d{4}$/.test(a)) return false;
  const y = parseInt(a, 10);
  if (y < 1900 || y > 2200) return false;
  return parseValorMes12Array(valor12Json, parseCurrency) !== null;
}

function cronogramaPorGrade12Meses(
  inp: Pick<AplicacaoExportInput, 'anoCompetenciaMensaisStr' | 'valorPorMesAplicacao12Str'> & {
    numeroPrimeiraParcelaStr?: string;
  },
  parseCurrency: (s: string) => number,
  limiteLinhas = 480
): AplicacaoLinha[] | null {
  const anoS = inp.anoCompetenciaMensaisStr?.trim();
  if (!anoS || !/^\d{4}$/.test(anoS)) return null;
  const anoNum = parseInt(anoS, 10);
  if (anoNum < 1900 || anoNum > 2200) return null;
  const nums = parseValorMes12Array(inp.valorPorMesAplicacao12Str, parseCurrency);
  if (!nums) return null;

  const startNum = Math.max(
    1,
    parseInt(String(inp.numeroPrimeiraParcelaStr ?? '1').replace(/\D/g, ''), 10) || 1
  );
  const rows: AplicacaoLinha[] = [];
  let seq = startNum;
  for (let m = 1; m <= 12; m += 1) {
    const v = nums[m - 1];
    if (!(v > 0)) continue;
    const date = lastDayOfMonth(new Date(anoNum, m - 1, 1));
    rows.push({ n: seq, date, valor: v });
    seq += 1;
    if (rows.length >= limiteLinhas) break;
  }
  return rows.length > 0 ? rows : null;
}

function contaSomenteDigitos(raw?: string): string {
  return (raw ?? '').replace(/\D/g, '');
}

function toHistoricoAscii(s: string): string {
  let t = (s ?? '').normalize('NFD').replace(/\p{M}/gu, '');
  const map: Record<string, string> = { Ç: 'C', ç: 'C', ß: 'SS', '–': '-', '—': '-' };
  t = t.replace(/[Ççß–—]/g, (ch) => map[ch] ?? ch);
  t = t.replace(/[^\x20-\x7E]/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

function formatDominioNumber(value: number): string {
  return value.toFixed(2).replace('.', ',');
}

function valorMinUmCentavo(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const cent = Math.round(value * 100);
  return cent >= 1 ? cent / 100 : null;
}

function parseISOOrNull(s?: string): Date | null {
  if (!s) return null;
  const d = parseISO(s.slice(0, 10));
  return isValid(d) ? d : null;
}

/** Lê { id, nomeEmpresa, ... } no formato SavedAplicacao em ExportInput. */
export function fromSavedAplicacaoLike(p: {
  nomeEmpresa: string;
  nomeAplicacao: string;
  numeroAplicacao?: string;
  valorParcelaStr: string;
  valorAplicacaoMesStr?: string;
  numeroPrimeiraParcelaStr: string;
  dataInicioPrimeiraParcelaStr: string;
  quantidadeParcelasStr: string;
  variacaoValorParcelas?: VariacaoValorParcelas;
  accAplicacaoDebit?: string;
  accAplicacaoCredit?: string;
  temReceitaJuros?: boolean;
  valorReceitaJurosMensalStr?: string;
  anoReceitaJurosMensaisStr?: string;
  valorReceitaJurosPorMes12Str?: string;
  accReceitaJurosDebit?: string;
  accReceitaJurosCredit?: string;
  temIRRF?: boolean;
  valorIRRFStr?: string;
  anoIRRFPorMes12Str?: string;
  valorIRRFPorMes12Str?: string;
  accIRRFDebit?: string;
  accIRRFCredit?: string;
  temIOF?: boolean;
  valorIOFStr?: string;
  anoIOPorMes12Str?: string;
  valorIOPorMes12Str?: string;
  accIOFDebit?: string;
  accIOFCredit?: string;
  dominioCodigoItemDfcStr?: string;
  dominioCodigoHistoricoStr?: string;
  dominioComplementoHistoricoStr?: string;
  naoGerarLancamentoAplicacao?: boolean;
  naoGerarLancamentoAplicacaoMes?: boolean;
  anoCompetenciaMensaisStr?: string;
  valorPorMesAplicacao12Str?: string;
}): AplicacaoExportInput {
  return {
    nomeEmpresa: p.nomeEmpresa,
    nomeAplicacao: p.nomeAplicacao,
    numeroAplicacao: p.numeroAplicacao,
    valorParcelaStr: p.valorParcelaStr,
    valorAplicacaoMesStr: p.valorAplicacaoMesStr,
    anoCompetenciaMensaisStr: p.anoCompetenciaMensaisStr,
    valorPorMesAplicacao12Str: p.valorPorMesAplicacao12Str,
    variacaoValorParcelas: p.variacaoValorParcelas === 'selic_dias' ? 'selic_dias' : 'fixo',
    selicMensalPercent: null,
    numeroPrimeiraParcelaStr: p.numeroPrimeiraParcelaStr,
    dataInicioPrimeiraParcelaStr: p.dataInicioPrimeiraParcelaStr,
    quantidadeParcelasStr: p.quantidadeParcelasStr,
    accAplicacaoDebit: String(p.accAplicacaoDebit ?? ''),
    accAplicacaoCredit: String(p.accAplicacaoCredit ?? ''),
    naoGerarLancamentoAplicacao: !!p.naoGerarLancamentoAplicacao,
    naoGerarLancamentoAplicacaoMes: !!p.naoGerarLancamentoAplicacaoMes,
    temReceitaJuros: !!p.temReceitaJuros,
    valorReceitaJurosMensalStr: p.valorReceitaJurosMensalStr,
    anoReceitaJurosMensaisStr: p.anoReceitaJurosMensaisStr,
    valorReceitaJurosPorMes12Str: p.valorReceitaJurosPorMes12Str,
    accReceitaJurosDebit: p.accReceitaJurosDebit,
    accReceitaJurosCredit: p.accReceitaJurosCredit,
    temIRRF: !!p.temIRRF,
    valorIRRFStr: p.valorIRRFStr,
    anoIRRFPorMes12Str: p.anoIRRFPorMes12Str,
    valorIRRFPorMes12Str: p.valorIRRFPorMes12Str,
    accIRRFDebit: p.accIRRFDebit,
    accIRRFCredit: p.accIRRFCredit,
    temIOF: !!p.temIOF,
    valorIOFStr: p.valorIOFStr,
    anoIOPorMes12Str: p.anoIOPorMes12Str,
    valorIOPorMes12Str: p.valorIOPorMes12Str,
    accIOFDebit: p.accIOFDebit,
    accIOFCredit: p.accIOFCredit,
    dominioCodigoItemDfcStr: p.dominioCodigoItemDfcStr,
    dominioCodigoHistoricoStr: p.dominioCodigoHistoricoStr,
    dominioComplementoHistoricoStr: p.dominioComplementoHistoricoStr,
  };
}

export type PreviewValoresAplicacaoLinha = { juros: number; iof: number; irrf: number };

function valorGradeNaData(
  anoStr: string | undefined,
  valor12Json: string | undefined,
  date: Date,
  parseCurrency: (s: string) => number
): number {
  const a = anoStr?.trim();
  if (!a || !/^\d{4}$/.test(a)) return 0;
  if (date.getFullYear() !== parseInt(a, 10)) return 0;
  const nums = parseValorMes12Array(valor12Json, parseCurrency);
  if (!nums) return 0;
  const v = nums[date.getMonth()];
  return v > 0 ? v : 0;
}

/** Juros, IOF e IRRF por linha do cronograma (grades mensais ou valor único). */
export function previewValoresPorLinhaAplicacao(
  inp: AplicacaoExportInput,
  cron: AplicacaoLinha[],
  parseCurrency: (s: string) => number
): PreviewValoresAplicacaoLinha[] {
  const jurosUniform = inp.temReceitaJuros
    ? parseCurrency(inp.valorReceitaJurosMensalStr ?? '')
    : 0;
  const iofUniform = inp.temIOF ? parseCurrency(inp.valorIOFStr ?? '') : 0;
  const irrfUniform = inp.temIRRF ? parseCurrency(inp.valorIRRFStr ?? '') : 0;

  const gradeJuros =
    inp.temReceitaJuros &&
    temGradeValorMesPopulados(
      inp.anoReceitaJurosMensaisStr,
      inp.valorReceitaJurosPorMes12Str,
      parseCurrency
    );
  const gradeIOF =
    inp.temIOF &&
    temGradeValorMesPopulados(inp.anoIOPorMes12Str, inp.valorIOPorMes12Str, parseCurrency);
  const gradeIRRF =
    inp.temIRRF &&
    temGradeValorMesPopulados(inp.anoIRRFPorMes12Str, inp.valorIRRFPorMes12Str, parseCurrency);

  const lastIdx = cron.length - 1;
  return cron.map((linha, i) => {
    const dRef = lastDayOfMonth(linha.date);
    let juros = 0;
    if (inp.temReceitaJuros) {
      if (gradeJuros) {
        juros = valorGradeNaData(
          inp.anoReceitaJurosMensaisStr,
          inp.valorReceitaJurosPorMes12Str,
          dRef,
          parseCurrency
        );
      } else if (jurosUniform > 0) juros = jurosUniform;
    }
    let iof = 0;
    if (inp.temIOF) {
      if (gradeIOF) {
        iof = valorGradeNaData(inp.anoIOPorMes12Str, inp.valorIOPorMes12Str, dRef, parseCurrency);
      } else if (iofUniform > 0 && i === 0) iof = iofUniform;
    }
    let irrf = 0;
    if (inp.temIRRF) {
      if (gradeIRRF) {
        irrf = valorGradeNaData(
          inp.anoIRRFPorMes12Str,
          inp.valorIRRFPorMes12Str,
          dRef,
          parseCurrency
        );
      } else if (irrfUniform > 0 && i === lastIdx) irrf = irrfUniform;
    }
    return { juros, iof, irrf };
  });
}

/**
 * Cronograma de aportes/competências da aplicação.
 * - `fixo`: todas as parcelas iguais (1.500,00 × N).
 * - `selic_dias`: cada parcela = anterior × (1 + Selic%/100)^(dias / 30).
 */
export function cronogramaAplicacao(
  inp: AplicacaoExportInput,
  parseCurrency: (s: string) => number,
  limiteLinhas = 480
): AplicacaoLinha[] {
  const peloGrade = cronogramaPorGrade12Meses(inp, parseCurrency, limiteLinhas);
  if (peloGrade) return peloGrade;

  const qtyRaw = parseInt(String(inp.quantidadeParcelasStr).replace(/\D/g, ''), 10);
  const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.min(480, qtyRaw) : 0;
  const show = Math.min(qty, limiteLinhas);
  const vMes = parseCurrency(inp.valorAplicacaoMesStr ?? '');
  const valor = vMes > 0 ? vMes : parseCurrency(inp.valorParcelaStr);
  const base = parseISOOrNull(inp.dataInicioPrimeiraParcelaStr);
  if (!base || qty === 0 || !(valor > 0)) return [];

  const startNum = Math.max(
    1,
    parseInt(String(inp.numeroPrimeiraParcelaStr).replace(/\D/g, ''), 10) || 1
  );
  const modo = inp.variacaoValorParcelas === 'selic_dias' ? 'selic_dias' : 'fixo';
  const selic = typeof inp.selicMensalPercent === 'number' ? inp.selicMensalPercent : 0;

  const rows: AplicacaoLinha[] = [];
  let prevDate = base;
  let prevValor = valor;
  for (let i = 0; i < show; i += 1) {
    const date = i === 0 ? base : addMonths(base, i);
    let vLinha = valor;
    if (modo === 'selic_dias' && i > 0 && selic > 0) {
      const dias = Math.max(0, differenceInCalendarDays(date, prevDate));
      const factor = Math.pow(1 + selic / 100, dias / 30);
      vLinha = Math.round(prevValor * factor * 100) / 100;
    } else if (modo === 'selic_dias') {
      vLinha = prevValor;
    }
    rows.push({ n: startNum + i, date, valor: vLinha });
    prevDate = date;
    prevValor = vLinha;
  }
  return rows;
}

export function mergeSelicAoVivoParaAplicacaoExport(
  inp: AplicacaoExportInput,
  selicMensalPainel: number | undefined | null
): AplicacaoExportInput {
  if (inp.variacaoValorParcelas !== 'selic_dias') return inp;
  const v = selicMensalPainel;
  const ok = v != null && typeof v === 'number' && Number.isFinite(v) ? v > 0 : false;
  return { ...inp, selicMensalPercent: ok ? v : null };
}

export type LancAplicacaoPlain = {
  date: Date;
  debContaStr: string;
  credContaStr: string;
  value: number;
  historico: string;
};

function listaLancGradeMesHistorico(
  anoStr: string | undefined,
  valor12Json: string | undefined,
  parseCurrency: (s: string) => number,
  debitoRaw: string | undefined,
  creditoRaw: string | undefined,
  historico: string
): LancAplicacaoPlain[] {
  const dD = contaSomenteDigitos(debitoRaw);
  const cD = contaSomenteDigitos(creditoRaw);
  if (!dD || !cD) return [];
  const a = anoStr?.trim();
  if (!a || !/^\d{4}$/.test(a)) return [];
  const anoNum = parseInt(a, 10);
  if (anoNum < 1900 || anoNum > 2200) return [];
  const nums = parseValorMes12Array(valor12Json, parseCurrency);
  if (!nums) return [];
  const out: LancAplicacaoPlain[] = [];
  for (let m = 1; m <= 12; m += 1) {
    const v = valorMinUmCentavo(nums[m - 1]);
    if (v === null) continue;
    out.push({
      date: lastDayOfMonth(new Date(anoNum, m - 1, 1)),
      debContaStr: dD,
      credContaStr: cD,
      value: v,
      historico,
    });
  }
  return out;
}

export function coletarLancamentosAplicacao(
  inp: AplicacaoExportInput,
  parseCurrency: (s: string) => number,
  cronograma?: AplicacaoLinha[]
): LancAplicacaoPlain[] {
  const cron = cronograma ?? cronogramaAplicacao(inp, parseCurrency);
  const lista: LancAplicacaoPlain[] = [];

  if (cron.length > 0 && !inp.naoGerarLancamentoAplicacao) {
    const lump = valorMinUmCentavo(parseCurrency(inp.valorParcelaStr ?? ''));
    const dA = contaSomenteDigitos(inp.accAplicacaoDebit);
    const cA = contaSomenteDigitos(inp.accAplicacaoCredit);
    const d0 =
      parseISOOrNull(inp.dataInicioPrimeiraParcelaStr ?? '') ?? cron[0]?.date;
    if (lump !== null && dA && cA && d0) {
      lista.push({
        date: d0,
        debContaStr: dA,
        credContaStr: cA,
        value: lump,
        historico: 'APLICACAO FINANCEIRA',
      });
    }
  }

  if (cron.length > 0 && !inp.naoGerarLancamentoAplicacaoMes) {
    const dA = contaSomenteDigitos(inp.accAplicacaoDebit);
    const cA = contaSomenteDigitos(inp.accAplicacaoCredit);
    if (dA && cA) {
      const anoG = inp.anoCompetenciaMensaisStr?.trim();
      const gradeAtiva =
        !!anoG &&
        /^\d{4}$/.test(anoG) &&
        parseValorMes12Array(inp.valorPorMesAplicacao12Str, parseCurrency) !== null;
      const mesUnicoAtivo = parseCurrency(inp.valorAplicacaoMesStr ?? '') > 0;

      if (gradeAtiva || mesUnicoAtivo) {
        for (const linha of cron) {
          const vLin = valorMinUmCentavo(linha.valor);
          if (vLin === null) continue;
          lista.push({
            date: linha.date,
            debContaStr: dA,
            credContaStr: cA,
            value: vLin,
            historico: 'APLICACAO DO MES',
          });
        }
      }
    }
  }

  // Receita de juros, IRRF e IOF são independentes de naoGerarLancamentoAplicacao /
  // naoGerarLancamentoAplicacaoMes (essas flags valem apenas para FINANCEIRA e DO MES).

  if (inp.temReceitaJuros) {
    const jurosPorGrade = listaLancGradeMesHistorico(
      inp.anoReceitaJurosMensaisStr,
      inp.valorReceitaJurosPorMes12Str,
      parseCurrency,
      inp.accReceitaJurosDebit,
      inp.accReceitaJurosCredit,
      'RECEITA DE JUROS APLICACAO'
    );
    if (jurosPorGrade.length > 0) {
      lista.push(...jurosPorGrade);
    } else {
      const v = valorMinUmCentavo(parseCurrency(inp.valorReceitaJurosMensalStr ?? ''));
      const dD = contaSomenteDigitos(inp.accReceitaJurosDebit ?? '');
      const cD = contaSomenteDigitos(inp.accReceitaJurosCredit ?? '');
      if (v !== null && dD && cD && cron.length > 0) {
        for (const linha of cron) {
          lista.push({
            date: lastDayOfMonth(linha.date),
            debContaStr: dD,
            credContaStr: cD,
            value: v,
            historico: 'RECEITA DE JUROS APLICACAO',
          });
        }
      }
    }
  }

  if (inp.temIRRF) {
    const irrfPorGrade = listaLancGradeMesHistorico(
      inp.anoIRRFPorMes12Str,
      inp.valorIRRFPorMes12Str,
      parseCurrency,
      inp.accIRRFDebit,
      inp.accIRRFCredit,
      'IRRF APLICACAO'
    );
    if (irrfPorGrade.length > 0) {
      lista.push(...irrfPorGrade);
    } else {
      const v = valorMinUmCentavo(parseCurrency(inp.valorIRRFStr ?? ''));
      const d = cron.length > 0 ? cron[cron.length - 1].date : null;
      const dD = contaSomenteDigitos(inp.accIRRFDebit ?? '');
      const cD = contaSomenteDigitos(inp.accIRRFCredit ?? '');
      if (v !== null && d && dD && cD) {
        lista.push({
          date: d,
          debContaStr: dD,
          credContaStr: cD,
          value: v,
          historico: 'IRRF APLICACAO',
        });
      }
    }
  }

  if (inp.temIOF) {
    const iofPorGrade = listaLancGradeMesHistorico(
      inp.anoIOPorMes12Str,
      inp.valorIOPorMes12Str,
      parseCurrency,
      inp.accIOFDebit,
      inp.accIOFCredit,
      'IOF APLICACAO'
    );
    if (iofPorGrade.length > 0) {
      lista.push(...iofPorGrade);
    } else {
      const v = valorMinUmCentavo(parseCurrency(inp.valorIOFStr ?? ''));
      const d = cron.length > 0 ? cron[0].date : null;
      const dD = contaSomenteDigitos(inp.accIOFDebit ?? '');
      const cD = contaSomenteDigitos(inp.accIOFCredit ?? '');
      if (v !== null && d && dD && cD) {
        lista.push({
          date: d,
          debContaStr: dD,
          credContaStr: cD,
          value: v,
          historico: 'IOF APLICACAO',
        });
      }
    }
  }

  return lista.sort((a, b) => {
    const da = a.date.getTime();
    const db = b.date.getTime();
    if (da !== db) return da - db;
    return a.historico.localeCompare(b.historico);
  });
}

/** Detalhe DFC por linha: `;código_do_item;valor` (leiaute registro filho 6130 — importadores que esperam partida estendida). */
function sufixoDetalheDfcTxtLinha(inp: Pick<AplicacaoExportInput, 'dominioCodigoItemDfcStr'>, valorLinha: number): string {
  const cod = contaSomenteDigitos(inp.dominioCodigoItemDfcStr ?? '');
  if (!cod) return '';
  const v = valorMinUmCentavo(valorLinha);
  if (v === null) return '';
  return `;${cod};${formatDominioNumber(v)}`;
}

export function generateAplicacaoTxtPlus(
  inp: AplicacaoExportInput,
  parseCurrency: (s: string) => number,
  cronograma?: AplicacaoLinha[]
): string {
  const lista = coletarLancamentosAplicacao(inp, parseCurrency, cronograma);
  const compl = inp.dominioComplementoHistoricoStr ?? '';
  const codigo = inp.dominioCodigoHistoricoStr ?? '';
  const lines = lista.map((l) => {
    const dfcEx = sufixoDetalheDfcTxtLinha(inp, l.value);
    return montarLinhaTxtDominio({
      date: l.date,
      debContaStr: l.debContaStr,
      credContaStr: l.credContaStr,
      value: l.value,
      historico: l.historico,
      codigoHistoricoStr: codigo,
      complementoHistoricoStr: compl,
      sufixoExtra: dfcEx,
    });
  });
  return lines.join('\r\n');
}

export function diagnosticarExportAplicacao(
  inp: AplicacaoExportInput,
  parseCurrency: (s: string) => number,
  cronograma?: AplicacaoLinha[]
): DiagnosticoExportItem[] {
  const cron = cronograma ?? cronogramaAplicacao(inp, parseCurrency);
  const lanc = coletarLancamentosAplicacao(inp, parseCurrency, cron);
  const vAcum = parseCurrency(inp.valorParcelaStr);
  const gradeAtiva = aplicaTemGradeMensal12(inp, parseCurrency);
  const vMes = parseCurrency(inp.valorAplicacaoMesStr ?? '');
  const temAplicacao =
    !inp.naoGerarLancamentoAplicacao || !inp.naoGerarLancamentoAplicacaoMes;
  return [
    {
      ok: cron.length > 0 || vAcum > 0 || gradeAtiva,
      label: 'Valor acumulado, grade mensal ou cronograma configurado',
    },
    { ok: lanc.length > 0, label: 'Ao menos um lançamento Domínio gerável' },
    {
      ok:
        !temAplicacao ||
        vAcum <= 0 ||
        inp.naoGerarLancamentoAplicacao ||
        (!!contaSomenteDigitos(inp.accAplicacaoDebit) &&
          !!contaSomenteDigitos(inp.accAplicacaoCredit)),
      label: 'Contas da APLICACAO FINANCEIRA (débito e crédito)',
    },
    {
      ok:
        !temAplicacao ||
        inp.naoGerarLancamentoAplicacaoMes ||
        !(vMes > 0 || gradeAtiva) ||
        (!!contaSomenteDigitos(inp.accAplicacaoDebit) &&
          !!contaSomenteDigitos(inp.accAplicacaoCredit)),
      label: 'Contas da APLICACAO DO MES (débito e crédito)',
    },
    {
      ok:
        !inp.temReceitaJuros ||
        (!!contaSomenteDigitos(inp.accReceitaJurosDebit) &&
          !!contaSomenteDigitos(inp.accReceitaJurosCredit)),
      label: 'Contas da receita de juros (débito e crédito)',
    },
    {
      ok:
        !inp.temIRRF ||
        (!!contaSomenteDigitos(inp.accIRRFDebit) && !!contaSomenteDigitos(inp.accIRRFCredit)),
      label: 'Contas do IRRF (débito e crédito)',
    },
    {
      ok:
        !inp.temIOF ||
        (!!contaSomenteDigitos(inp.accIOFDebit) && !!contaSomenteDigitos(inp.accIOFCredit)),
      label: 'Contas do IOF (débito e crédito)',
    },
  ];
}

export function downloadAplicacaoTxtPlus(filename: string, content: string) {
  downloadDominioTXT(content, filename);
}

function pdfSafe(str: string): string {
  return str
    .replace(/\u00D7/g, 'x')
    .replace(/\u2212/g, '-')
    .replace(/\u2013/g, '-')
    .replace(/\u2014/g, '-')
    .replace(/\u00A0/g, ' ');
}

export function downloadAplicacaoRelatorioPdf(
  inp: AplicacaoExportInput,
  parseCurrency: (s: string) => number,
  formatCurrencyFn: (n: number) => string,
  arquivoBaseNome: string
) {
  const cron = cronogramaAplicacao(inp, parseCurrency);
  const lanc = coletarLancamentosAplicacao(inp, parseCurrency, cron);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let y = 16;
  doc.setFontSize(16);
  doc.setTextColor(16, 100, 80);
  doc.text(pdfSafe('Relatorio Aplicacao Financeira'), 14, y);
  y += 8;
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text(
    pdfSafe(`Gerado em ${format(new Date(), "dd/MM/yyyy 'as' HH:mm", { locale: ptBR })}`),
    14,
    y
  );
  y += 10;

  doc.setFontSize(10);
  doc.setTextColor(20, 20, 20);
  const num = (inp.numeroAplicacao ?? '').trim();
  if (num) {
    doc.text(pdfSafe(`Nº da aplicacao: ${num}`), 14, y);
    y += 5;
  }
  doc.text(pdfSafe(`Empresa: ${inp.nomeEmpresa || '-'}`), 14, y);
  y += 5;
  doc.text(pdfSafe(`Aplicacao: ${inp.nomeAplicacao || '-'}`), 14, y);
  y += 5;
  if (inp.naoGerarLancamentoAplicacao) {
    doc.setTextColor(120, 80, 0);
    doc.setFontSize(8);
    doc.text(
      pdfSafe(
        'Valor acumulado da aplicacao: sem lancamento APLICACAO FINANCEIRA (modo apenas conferencia no TXT+).'
      ),
      14,
      y
    );
    y += 6;
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(10);
  }
  if (inp.naoGerarLancamentoAplicacaoMes && parseCurrency(inp.valorAplicacaoMesStr ?? '') > 0) {
    doc.setTextColor(120, 80, 0);
    doc.setFontSize(8);
    doc.text(
      pdfSafe(
        'Aplicacao do mes: sem lancamentos APLICACAO DO MES no TXT+ (modo apenas conferencia).'
      ),
      14,
      y
    );
    y += 6;
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(10);
  }
  const tot = cron.reduce((a, x) => a + x.valor, 0);
  const vCadaCron = cron[0]?.valor ?? 0;
  if (cron.length > 0) {
    doc.text(
      pdfSafe(
        `${cron.length} aportes · Valor cada (cronograma) ${formatCurrencyFn(vCadaCron)} · Total ${formatCurrencyFn(tot)}`
      ),
      14,
      y
    );
  } else {
    doc.text(
      pdfSafe(
        'Cronograma de aporte sem linhas nesta configuração (apenas outros lançamentos conforme formulário — ex.: grades de IOF/IRRF ou receita por mês).'
      ),
      14,
      y
    );
  }
  y += 8;

  // Resumo contas
  const linhasContas: [string, string, string][] = [];
  const par = (lab: string, d?: string, c?: string) => {
    const dd = contaSomenteDigitos(d);
    const cc = contaSomenteDigitos(c);
    if (dd || cc) linhasContas.push([lab, dd || '-', cc || '-']);
  };
  par(
    inp.naoGerarLancamentoAplicacao
      ? 'Conta aplicacao (referencia — nao vai para TXT+)'
      : 'Conta aplicacao (total na 1a data)',
    inp.accAplicacaoDebit,
    inp.accAplicacaoCredit
  );
  if (inp.temReceitaJuros)
    par('Receita de juros (mensal)', inp.accReceitaJurosDebit, inp.accReceitaJurosCredit);
  if (inp.temIRRF) par('IRRF aplicacao', inp.accIRRFDebit, inp.accIRRFCredit);
  if (inp.temIOF) par('IOF aplicacao', inp.accIOFDebit, inp.accIOFCredit);

  if (linhasContas.length > 0) {
    doc.setFontSize(11);
    doc.text(pdfSafe('Contas Domínio'), 14, y);
    y += 3;
    autoTable(doc, {
      startY: y,
      head: [['Trecho', 'Debito', 'Credito']],
      body: linhasContas.map((row) => row.map((c) => pdfSafe(String(c)))),
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 100, 80] },
      margin: { left: 14, right: 14 },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  if (cron.length > 0) {
    doc.setFontSize(11);
    doc.setTextColor(20, 20, 20);
    doc.text(pdfSafe('Cronograma de aportes'), 14, y);
    y += 3;
    const slice = cron.slice(0, Math.min(cron.length, 60));
    const head = [['N', 'Venc.', 'Valor', 'Tot.aplic.']];
    let runTot = 0;
    const body = slice.map((r) => {
      runTot += r.valor;
      return [
        String(r.n),
        format(r.date, 'dd/MM/yyyy'),
        formatCurrencyFn(r.valor).replace(/\u00a0/g, ' '),
        formatCurrencyFn(runTot).replace(/\u00a0/g, ' '),
      ].map((c) => pdfSafe(String(c)));
    });
    autoTable(doc, {
      startY: y,
      head,
      body,
      styles: { fontSize: 7, cellPadding: 1 },
      headStyles: { fillColor: [40, 40, 60] },
      margin: { left: 14, right: 14 },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
    if (cron.length > slice.length) {
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text(pdfSafe(`... e mais ${cron.length - slice.length} linhas`), 14, y);
      y += 6;
    }
  }

  if (lanc.length > 0) {
    doc.setFontSize(11);
    doc.setTextColor(20, 20, 20);
    doc.text(pdfSafe('Previa linhas TXT+ Dominio (ordenadas por data)'), 14, y);
    y += 3;
    const cap = Math.min(lanc.length, 40);
    autoTable(doc, {
      startY: y,
      head: [['Data', 'Deb', 'Cred', 'Valor', 'Historico']],
      body: lanc.slice(0, cap).map((l) =>
        [
          format(l.date, 'dd/MM/yyyy'),
          l.debContaStr,
          l.credContaStr,
          formatDominioNumber(l.value),
          l.historico,
        ].map((c) => pdfSafe(String(c)))
      ),
      styles: { fontSize: 7, cellPadding: 1 },
      headStyles: { fillColor: [40, 40, 60] },
      margin: { left: 14, right: 14 },
    });
  }

  doc.save(`${arquivoBaseNome}.pdf`);
}
