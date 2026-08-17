import { addMonths, differenceInCalendarDays, format, isAfter, isBefore, isValid, lastDayOfMonth, parseISO, setDate, startOfDay } from 'date-fns';
import {
  parseCronogramaPlanilhaJson,
  parcelaPlanilhaToLinhasCronograma,
  jurosPorPagamentoMenosParcelaBase,
} from './parcelamentoPlanilha';
import { ptBR } from 'date-fns/locale';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { downloadDominioTXT } from './dominioExporter';
import { montarLinhaTxtDominio } from './dominioTxtLinha';
import type { DiagnosticoExportItem } from './exportDiagnostico';

/**
 * Parcelamento TXT+ Domínio: mesma lógica de datas e históricos que `dominioExporter` (empréstimo).
 * Juros: valor base informado; com `selic_dias`, reajustam como as parcelas (1ª competência com juros = base;
 * seguintes × `(1+Selic)^(dias÷30)` entre vencimentos). LP→CP é **valor da parcela × 12** em **31/12**;
 * abertura (CONTA PARCELAMENTOS) na 1ª data com total do cronograma.
 */

/** Moeda pt-BR: 12 × valor da parcela (reclassificação LP→CP anual no TXT+, 31/12). */
export function valorTransferenciaAnualFromParcelaStr(valorParcelaStr: string): string {
  const raw = String(valorParcelaStr ?? '')
    .replace(/[^\d.,-]/g, '')
    .trim();
  if (!raw) return '0,00';
  const normalized = raw.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(normalized);
  if (!Number.isFinite(n) || n <= 0) return '0,00';
  return (Math.round(n * 12 * 100) / 100).toFixed(2).replace('.', ',');
}

export type VariacaoValorParcelas = 'fixo' | 'selic_dias' | 'por_faixa';

/** Intervalo de números de parcela com valor base fixo (ex.: parcelas 1–8 = 1.500,00). */
export type ParcelamentoFaixaValor = {
  parcelaDe: number;
  parcelaAte: number;
  valorStr: string;
};

export function parseFaixasValorParcelaJson(raw: string | undefined): ParcelamentoFaixaValor[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: ParcelamentoFaixaValor[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const de = parseInt(String(o.parcelaDe ?? o.de ?? ''), 10);
      const ate = parseInt(String(o.parcelaAte ?? o.ate ?? ''), 10);
      const valorStr = String(o.valorStr ?? o.valor ?? '').trim();
      if (!Number.isFinite(de) || !Number.isFinite(ate) || de < 1 || ate < de) continue;
      out.push({ parcelaDe: de, parcelaAte: ate, valorStr });
    }
    return out.sort((a, b) => a.parcelaDe - b.parcelaDe);
  } catch {
    return [];
  }
}

export function serializeFaixasValorParcela(faixas: ParcelamentoFaixaValor[]): string {
  return JSON.stringify(faixas);
}

export function temFaixasValorParcelaPopuladas(
  raw: string | undefined,
  parseCurrency: (s: string) => number
): boolean {
  return parseFaixasValorParcelaJson(raw).some((f) => parseCurrency(f.valorStr) > 0);
}

/** Valor da parcela `n` conforme faixas; se não houver faixa, usa `fallback`. */
export function valorParcelaPorNumeroFaixa(
  nParcela: number,
  faixas: ParcelamentoFaixaValor[],
  parseCurrency: (s: string) => number,
  fallback: number
): number {
  for (const f of faixas) {
    if (nParcela >= f.parcelaDe && nParcela <= f.parcelaAte) {
      const v = parseCurrency(f.valorStr);
      if (v > 0) return Math.round(v * 100) / 100;
    }
  }
  return fallback > 0 ? Math.round(fallback * 100) / 100 : 0;
}

/** `valor_fixo` = R$ mensal (ou cadeia SELIC sobre o valor fixo). `percentual_faixa` = % × valor total financiado (soma das parcelas). */
export type ModoCalculoJurosParcelamento = 'valor_fixo' | 'percentual_faixa';

export type ParcelamentoFaixaJurosPercent = {
  parcelaDe: number;
  parcelaAte: number;
  jurosPercentStr: string;
};

export function parsePercentualStr(raw: string | undefined): number {
  const t = String(raw ?? '')
    .replace(/%/g, '')
    .replace(/\s/g, '')
    .replace(',', '.');
  const n = parseFloat(t);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function parseFaixasJurosPercentualJson(raw: string | undefined): ParcelamentoFaixaJurosPercent[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: ParcelamentoFaixaJurosPercent[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const de = parseInt(String(o.parcelaDe ?? o.de ?? ''), 10);
      const ate = parseInt(String(o.parcelaAte ?? o.ate ?? ''), 10);
      const jurosPercentStr = String(o.jurosPercentStr ?? o.percent ?? o.pct ?? '').trim();
      if (!Number.isFinite(de) || !Number.isFinite(ate) || de < 1 || ate < de) continue;
      out.push({ parcelaDe: de, parcelaAte: ate, jurosPercentStr });
    }
    return out.sort((a, b) => a.parcelaDe - b.parcelaDe);
  } catch {
    return [];
  }
}

export function serializeFaixasJurosPercentual(faixas: ParcelamentoFaixaJurosPercent[]): string {
  return JSON.stringify(faixas);
}

export function temFaixasJurosPercentualPopuladas(raw: string | undefined): boolean {
  return parseFaixasJurosPercentualJson(raw).some((f) => parsePercentualStr(f.jurosPercentStr) > 0);
}

export function jurosPercentPorNumeroParcela(
  nParcela: number,
  faixas: ParcelamentoFaixaJurosPercent[],
  percentPadrao: number
): number {
  for (const f of faixas) {
    if (nParcela >= f.parcelaDe && nParcela <= f.parcelaAte) {
      const p = parsePercentualStr(f.jurosPercentStr);
      if (p > 0) return p;
    }
  }
  return percentPadrao > 0 ? percentPadrao : 0;
}

export function parcelamentoTemJurosConfigurados(
  inp: ParcelamentoExportInput,
  parseCurrency: (s: string) => number,
  cron: ParcelaLinha[]
): boolean {
  if ((inp.modoCalculoJuros ?? 'valor_fixo') === 'percentual_faixa') {
    const padrao = parsePercentualStr(inp.valorJurosMensalStr);
    if (temFaixasJurosPercentualPopuladas(inp.faixasJurosPercentualJson)) return true;
    return padrao > 0 && cron.some((r) => r.valor > 0);
  }
  return parseCurrency(inp.valorJurosMensalStr) > 0;
}

export interface ParcelamentoExportInput {
  nomeParcelamento: string;
  /** Número/identificador do parcelamento — entra no nome dos arquivos exportados e no cabeçalho do PDF. */
  numeroParcelamento?: string;
  clienteNome: string;
  valorParcelaStr: string;
  /** `fixo` (padrão): todas parcelas iguais. `selic_dias`: 1ª = valor inicial; seguintes com (1+p/100)^(diasEntreVencimentos/30); p = Selic mensal % ao exportar (`mergeSelicAoVivoParaExport`). */
  variacaoValorParcelas?: VariacaoValorParcelas;
  /** Selic mensal % a.m.; só usada com `selic_dias`. */
  selicMensalPercent?: number | null;
  /** JSON: array de `{ parcelaDe, parcelaAte, valorStr }` — modo `por_faixa`. */
  faixasValorParcelaJson?: string;

  numeroPrimeiraParcelaStr: string;
  dataInicioPrimeiraParcelaStr: string;
  quantidadeParcelasStr: string;
  dominioComplementoStr?: string;
  /** Código ou texto livre do histórico Domínio (coluna 5 / prefixo coluna 6). */
  dominioCodigoHistoricoStr?: string;

  accJurosAproDebit: string;
  accJurosAproCredit: string;
  /** Montante base dos juros (R$) ou % padrão fora das faixas (modo `percentual_faixa`). */
  valorJurosMensalStr: string;
  modoCalculoJuros?: ModoCalculoJurosParcelamento;
  /** JSON: `{ parcelaDe, parcelaAte, jurosPercentStr }` — juros = valor total financiado × (% ÷ 100). */
  faixasJurosPercentualJson?: string;
  /** Quando `true`, pula provisão+apropriação de juros da **1ª parcela** (mantém os juros das demais). */
  primeiraParcelaSemJuros?: boolean;

  accApropriacaoDebit: string;
  accApropriacaoCredit: string;

  accTransferenciaDebit: string;
  accTransferenciaCredit: string;
  /** Legado / PDF: sempre 12× parcela (o TXT+ ignora e recalcula). */
  valorTransferenciaMensalStr: string;

  accEmprestimoDebit: string;
  accEmprestimoCredit: string;

  accParcelaDebit: string;
  accParcelaCredit: string;

  accPagamentoDebit: string;
  accPagamentoCredit: string;

  /** Cronograma linha a linha importado de planilha (JSON). */
  cronogramaPlanilhaJson?: string;
  /**
   * Se informado (AAAA-MM-DD), o TXT+ só gera provisão/apropriação de juros, multa, transferência 31/12 e
   * ajusta a data da abertura CONTA PARCELAMENTOS para competências com vencimento da parcela **a partir** desta data (inclusive).
   */
  dataGerarLancamentosAPartirStr?: string;
  /** Se informado (AAAA-MM-DD), só gera lançamentos com vencimento da parcela **até** esta data (inclusive). */
  dataGerarLancamentosAteStr?: string;
  /** Valor total do parcelamento (informado pelo usuário). Incluído no lançamento inicial se configurado. */
  valorTotalParcelamentoStr?: string;
}

/** Lê objeto legado { contaDebitoStr, contaCreditoStr, valorMensalStr }. */
function readLegacyBloc(b: unknown): { deb: string; cred: string; val: string } {
  if (!b || typeof b !== 'object') return { deb: '', cred: '', val: '0,00' };
  const o = b as Record<string, unknown>;
  return {
    deb: String(o.contaDebitoStr ?? '').trim(),
    cred: String(o.contaCreditoStr ?? '').trim(),
    val: String(o.valorMensalStr ?? '0,00'),
  };
}

export function fromSavedParcelamentoLike(p: {
  nomeParcelamento: string;
  numeroParcelamento?: string;
  clienteNome: string;
  valorParcelaStr: string;
  numeroPrimeiraParcelaStr: string;
  dataInicioPrimeiraParcelaStr: string;
  quantidadeParcelasStr: string;
  dominioComplementoStr?: string;
  dominioComplementoHistoricoStr?: string;
  dominioCodigoHistoricoStr?: string;
  accJurosAproDebit?: string;
  accJurosAproCredit?: string;
  accApropriacaoDebit?: string;
  accApropriacaoCredit?: string;
  valorJurosMensalStr?: string;
  primeiraParcelaSemJuros?: boolean;
  accTransferenciaDebit?: string;
  accTransferenciaCredit?: string;
  valorTransferenciaMensalStr?: string;
  accEmprestimoDebit?: string;
  accEmprestimoCredit?: string;
  accParcelaDebit?: string;
  accParcelaCredit?: string;
  accPagamentoDebit?: string;
  accPagamentoCredit?: string;
  cronogramaPlanilhaJson?: string;
  dataGerarLancamentosAPartirStr?: string;
  dataGerarLancamentosAteStr?: string;
  variacaoValorParcelas?: VariacaoValorParcelas;
  faixasValorParcelaJson?: string;
  modoCalculoJuros?: ModoCalculoJurosParcelamento;
  faixasJurosPercentualJson?: string;
  valorTotalParcelamentoStr?: string;

  /** Modelo anterior (CP/LP) — migra só para campos compatíveis. */
  jurosApropriarCurtoPrazo?: unknown;
  jurosApropriarLongoPrazo?: unknown;
  jurosApropriadoValorCurtoPrazo?: unknown;
  jurosApropriadoValorLongoPrazo?: unknown;
}): ParcelamentoExportInput {
  const acp = readLegacyBloc(p.jurosApropriarCurtoPrazo);
  const alp = readLegacyBloc(p.jurosApropriarLongoPrazo);
  const ocp = readLegacyBloc(p.jurosApropriadoValorCurtoPrazo);

  const valJuros =
    p.valorJurosMensalStr ??
    (acp.val && acp.val !== '0,00' ? acp.val : alp.val !== '0,00' ? alp.val : '0,00');

  const modoRaw = String(p.variacaoValorParcelas ?? '').trim().toLowerCase();
  const modo: VariacaoValorParcelas =
    modoRaw === 'selic_dias' ? 'selic_dias' : modoRaw === 'por_faixa' ? 'por_faixa' : 'fixo';

  return {
    nomeParcelamento: p.nomeParcelamento,
    numeroParcelamento: (p.numeroParcelamento ?? '').trim() || undefined,
    clienteNome: p.clienteNome,
    valorParcelaStr: p.valorParcelaStr,
    variacaoValorParcelas: modo,
    selicMensalPercent: null,
    faixasValorParcelaJson: p.faixasValorParcelaJson?.trim() || undefined,

    numeroPrimeiraParcelaStr: p.numeroPrimeiraParcelaStr,
    dataInicioPrimeiraParcelaStr: p.dataInicioPrimeiraParcelaStr,
    quantidadeParcelasStr: p.quantidadeParcelasStr,
    dominioComplementoStr:
      (p.dominioComplementoStr ?? p.dominioComplementoHistoricoStr ?? '').trim(),
    dominioCodigoHistoricoStr: String(p.dominioCodigoHistoricoStr ?? '').trim(),

    accJurosAproDebit: String(p.accJurosAproDebit ?? acp.deb ?? ''),
    accJurosAproCredit: String(p.accJurosAproCredit ?? acp.cred ?? ''),
    valorJurosMensalStr: String(valJuros),
    modoCalculoJuros:
      String(p.modoCalculoJuros ?? '').trim().toLowerCase() === 'percentual_faixa'
        ? 'percentual_faixa'
        : 'valor_fixo',
    faixasJurosPercentualJson: p.faixasJurosPercentualJson?.trim() || undefined,
    primeiraParcelaSemJuros: !!p.primeiraParcelaSemJuros,

    accApropriacaoDebit: String(p.accApropriacaoDebit ?? ocp.deb ?? ''),
    accApropriacaoCredit: String(p.accApropriacaoCredit ?? ocp.cred ?? ''),

    accTransferenciaDebit: String(p.accTransferenciaDebit ?? alp.deb ?? ''),
    accTransferenciaCredit: String(p.accTransferenciaCredit ?? alp.cred ?? ''),
    valorTransferenciaMensalStr: valorTransferenciaAnualFromParcelaStr(p.valorParcelaStr),

    accEmprestimoDebit: String(p.accEmprestimoDebit ?? ''),
    accEmprestimoCredit: String(p.accEmprestimoCredit ?? ''),
    accParcelaDebit: String(p.accParcelaDebit ?? ''),
    accParcelaCredit: String(p.accParcelaCredit ?? ''),
    accPagamentoDebit: String(p.accPagamentoDebit ?? ''),
    accPagamentoCredit: String(p.accPagamentoCredit ?? ''),
    cronogramaPlanilhaJson: p.cronogramaPlanilhaJson?.trim() || undefined,
    dataGerarLancamentosAPartirStr: p.dataGerarLancamentosAPartirStr?.trim().slice(0, 10) || undefined,
    dataGerarLancamentosAteStr: p.dataGerarLancamentosAteStr?.trim().slice(0, 10) || undefined,
    valorTotalParcelamentoStr: p.valorTotalParcelamentoStr?.trim() || undefined,
  };
}

export type ParcelaLinha = {
  n: number;
  date: Date;
  valor: number;
  /** Valor pago (importação OCR coluna Pagamento). */
  pagamento?: number;
  /** Juros (R$) só da coluna “Juros” na importação (prévia). */
  jurosImportado?: number;
  /** Juros + encargos + honorários da importação (base para juros no TXT+ quando vier do cronograma). */
  jurosPlanilha?: number;
  multa?: number;
  encargos?: number;
  honorarios?: number;
  contaDebito?: string;
  contaCredito?: string;
};

/** Soma das 12 primeiras parcelas do cronograma (LP→CP anual com SELIC). */
export function valorTransferenciaAnualFromCronograma(cron: ParcelaLinha[]): number {
  if (cron.length === 0) return 0;
  const slice = cron.slice(0, 12);
  const sum = slice.reduce((s, r) => s + r.valor, 0);
  return Math.round(sum * 100) / 100;
}

export function cronogramaParcelamento(
  inp: ParcelamentoExportInput,
  parseCurrency: (s: string) => number,
  limiteLinhas = 480
): ParcelaLinha[] {
  const variacao = inp.variacaoValorParcelas ?? 'fixo';

  const planilhaLinhas = parseCronogramaPlanilhaJson(inp.cronogramaPlanilhaJson);
  if (planilhaLinhas.length > 0) {
    const rows = parcelaPlanilhaToLinhasCronograma(planilhaLinhas).slice(0, limiteLinhas);
    const faixas = variacao === 'por_faixa' ? parseFaixasValorParcelaJson(inp.faixasValorParcelaJson) : [];
    const fallback = parseCurrency(inp.valorParcelaStr);
    const selicPm =
      inp.selicMensalPercent != null &&
      Number.isFinite(inp.selicMensalPercent) &&
      inp.selicMensalPercent > 0
        ? inp.selicMensalPercent / 100
        : 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (variacao === 'por_faixa') {
        row.valor = valorParcelaPorNumeroFaixa(row.n, faixas, parseCurrency, fallback);
      } else if (variacao === 'selic_dias') {
        if (i === 0) {
          row.valor = row.valor > 0 ? row.valor : fallback;
        } else {
          const prev = rows[i - 1];
          const dias = Math.max(1, differenceInCalendarDays(row.date, prev.date));
          row.valor = Math.round(prev.valor * Math.pow(1 + selicPm, dias / 30) * 100) / 100;
        }
      } else {
        if (!(row.valor > 0)) {
          row.valor = fallback;
        }
      }
    }
    return rows;
  }

  const qtyRaw = parseInt(String(inp.quantidadeParcelasStr).replace(/\D/g, ''), 10);
  const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.min(480, qtyRaw) : 0;
  const show = Math.min(qty, limiteLinhas);
  const valor = parseCurrency(inp.valorParcelaStr);
  const base = parseISO(inp.dataInicioPrimeiraParcelaStr.slice(0, 10));
  const startNum = Math.max(
    1,
    Math.floor(Number(String(inp.numeroPrimeiraParcelaStr).replace(/\D/g, '')) || 1)
  );
  if (!isValid(base) || qty < 1) return [];

  if (variacao === 'por_faixa') {
    const faixas = parseFaixasValorParcelaJson(inp.faixasValorParcelaJson);
    const fallback = parseCurrency(inp.valorParcelaStr);
    const selicPm =
      inp.selicMensalPercent != null &&
      Number.isFinite(inp.selicMensalPercent) &&
      inp.selicMensalPercent > 0
        ? inp.selicMensalPercent / 100
        : 0;
    const rows: ParcelaLinha[] = [];
    for (let i = 0; i < show; i += 1) {
      const n = startNum + i;
      const date = addMonths(base, i);
      let vLinha = valorParcelaPorNumeroFaixa(n, faixas, parseCurrency, fallback);
      if (!(vLinha > 0)) continue;
      if (i > 0 && selicPm > 0 && rows.length > 0) {
        const prev = rows[rows.length - 1];
        const dias = Math.max(1, differenceInCalendarDays(date, prev.date));
        vLinha = Math.round(prev.valor * Math.pow(1 + selicPm, dias / 30) * 100) / 100;
      }
      rows.push({ n, date, valor: vLinha });
    }
    return rows;
  }

  const selicPm =
    variacao === 'selic_dias' &&
    inp.selicMensalPercent != null &&
    Number.isFinite(inp.selicMensalPercent) &&
    inp.selicMensalPercent > 0
      ? inp.selicMensalPercent / 100
      : 0;

  const rows: ParcelaLinha[] = [];
  for (let i = 0; i < show; i++) {
    const date = addMonths(base, i);
    let vLinha: number;

    if (i === 0) {
      vLinha = valor;
    } else if (selicPm > 0) {
      const prev = rows[i - 1];
      const dias = Math.max(1, differenceInCalendarDays(date, prev.date));
      vLinha = Math.round(prev.valor * Math.pow(1 + selicPm, dias / 30) * 100) / 100;
    } else {
      vLinha = valor;
    }

    rows.push({ n: startNum + i, date, valor: vLinha });
  }
  return rows;
}

function selicMensalFatorFracao(inp: ParcelamentoExportInput): number {
  const p = inp.selicMensalPercent;
  if (p == null || !Number.isFinite(p) || p <= 0) return 0;
  return p / 100;
}

/**
 * Juros por linha: `percentual_faixa` = % × valor total financiado (soma das parcelas); `valor_fixo` = R$ (com SELIC opcional na cadeia de juros).
 */
export function jurosPorCompetenciaParcelamento(
  inp: ParcelamentoExportInput,
  cron: ParcelaLinha[],
  parseCurrency: (s: string) => number
): number[] {
  if (cron.length === 0) return [];

  const parcelaBaseForm = parseCurrency(inp.valorParcelaStr);
  const comPagamento = cron.some((r) => (r.pagamento ?? 0) > 0);
  
  if (comPagamento) {
    return cron.map((row, i) => {
      if (!!inp.primeiraParcelaSemJuros && i === 0) return 0;
      const pag = row.pagamento ?? 0;
      const baseDaLinha = row.valor > 0 ? row.valor : parcelaBaseForm;
      if (pag > 0 && baseDaLinha > 0) return jurosPorPagamentoMenosParcelaBase(pag, baseDaLinha);
      const jp = row.jurosPlanilha ?? 0;
      if (jp > 0) return Math.round(jp * 100) / 100;
      const ji = row.jurosImportado ?? 0;
      return Math.round(ji * 100) / 100;
    });
  }

  const usaJurosPlanilha = cron.some(
    (r) => (r.jurosPlanilha ?? 0) > 0 || (r.jurosImportado ?? 0) > 0
  );
  if (usaJurosPlanilha) {
    return cron.map((row, i) => {
      if (!!inp.primeiraParcelaSemJuros && i === 0) return 0;
      const jp = row.jurosPlanilha ?? 0;
      if (jp > 0) return Math.round(jp * 100) / 100;
      const ji = row.jurosImportado ?? 0;
      return Math.round(ji * 100) / 100;
    });
  }

  const pularPrimeira = !!inp.primeiraParcelaSemJuros;
  const modoJuros = inp.modoCalculoJuros ?? 'valor_fixo';

  if (modoJuros === 'percentual_faixa') {
    const faixas = parseFaixasJurosPercentualJson(inp.faixasJurosPercentualJson);
    const pctPadrao = parsePercentualStr(inp.valorJurosMensalStr);
    // Total financiado = soma de todas as parcelas do cronograma
    const totalFinanciado = cron.reduce((s, r) => s + r.valor, 0);
    return cron.map((row, i) => {
      if (pularPrimeira && i === 0) return 0;
      const pct = jurosPercentPorNumeroParcela(row.n, faixas, pctPadrao);
      if (!(pct > 0) || !(totalFinanciado > 0)) return 0;
      return Math.round(totalFinanciado * (pct / 100) * 100) / 100;
    });
  }

  const base = parseCurrency(inp.valorJurosMensalStr);
  if (!(base > 0)) return cron.map(() => 0);

  const selicPm = selicMensalFatorFracao(inp);
  const out: number[] = [];
  let prevJuros: number | null = null;
  let prevDate: Date | null = null;

  for (let i = 0; i < cron.length; i++) {
    if (pularPrimeira && i === 0) {
      out.push(0);
      continue;
    }

    let v: number;
    if (prevJuros === null) {
      v = base;
    } else if (selicPm > 0 && prevDate) {
      const dias = Math.max(1, differenceInCalendarDays(cron[i].date, prevDate));
      v = Math.round(prevJuros * Math.pow(1 + selicPm, dias / 30) * 100) / 100;
    } else {
      v = base;
    }
    out.push(v);
    prevJuros = v;
    prevDate = cron[i].date;
  }
  return out;
}

/** Une taxa SELIC mensal atual do painel ao input já montado do formulário. */
export function mergeSelicAoVivoParaExport(
  inp: ParcelamentoExportInput,
  selicMensalPainel: number | undefined | null,
  aplicarReajusteSelic = false
): ParcelamentoExportInput {
  const usaSelic =
    aplicarReajusteSelic || inp.variacaoValorParcelas === 'selic_dias';
  if (!usaSelic) return inp;

  const v = selicMensalPainel;
  const ok =
    v != null && typeof v === 'number' && Number.isFinite(v) ? v > 0 : false;
  return { ...inp, selicMensalPercent: ok ? v : null };
}

/**
 * Curto / longo prazo no espírito CPC 03 (mesma regra da simulação em `loanCalculator`):
 * **curto** = soma dos `valor` das próximas `rollingCpcMonths` parcelas **depois** da linha `rowIndex`,
 * apenas enquanto o vencimento estiver no **mesmo ano civil** da linha atual;
 * **longo** = soma dos `valor` de todas as parcelas futuras menos o curto (proxy de passivo remanescente).
 */
export function parcelamentoCpcCurtoLongo(
  rows: ParcelaLinha[],
  rowIndex: number,
  rollingCpcMonths = 2
): { curto: number; longo: number } {
  const n = rows.length;
  if (n === 0 || rowIndex < 0 || rowIndex >= n) return { curto: 0, longo: 0 };
  
  let saldoProx = 0;
  for (let k = rowIndex + 1; k < n; k++) saldoProx += rows[k].valor;

  // Se o saldo restante será pago em até 12 meses, tudo é curto prazo
  const remainingInstallments = n - rowIndex - 1;
  if (remainingInstallments <= 12) {
    return { curto: saldoProx, longo: 0 };
  }

  const rolling = Math.max(
    1,
    Math.min(
      120,
      Math.floor(
        Number.isFinite(rollingCpcMonths) && rollingCpcMonths > 0 ? rollingCpcMonths : 2
      )
    )
  );
  const refYear = rows[rowIndex].date.getFullYear();
  let curto = 0;
  let took = 0;
  for (let k = rowIndex + 1; k < n && took < rolling; k++) {
    if (rows[k].date.getFullYear() !== refYear) break;
    curto += rows[k].valor;
    took++;
  }
  const longo = Math.max(0, saldoProx - curto);
  return { curto, longo };
}

function formatDominioNumber(value: number): string {
  return value.toFixed(2).replace('.', ',');
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

function valorMinUmCentavo(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const cent = Math.round(value * 100);
  return cent >= 1 ? cent / 100 : null;
}

function parseDataGerarLancamentosApartir(inp: ParcelamentoExportInput): Date | null {
  const raw = inp.dataGerarLancamentosAPartirStr?.trim();
  if (!raw) return null;
  const d = parseISO(raw.slice(0, 10));
  return isValid(d) ? startOfDay(d) : null;
}

function parseDataGerarLancamentosAte(inp: ParcelamentoExportInput): Date | null {
  const raw = inp.dataGerarLancamentosAteStr?.trim();
  if (!raw) return null;
  const d = parseISO(raw.slice(0, 10));
  return isValid(d) ? startOfDay(d) : null;
}

/** Vencimento da parcela na data de corte ou depois/antes (inclusive). */
function incluirLancParcelaNaDataCorte(parcelaDate: Date, cut: Date | null, cutEnd: Date | null = null): boolean {
  if (cut && isBefore(startOfDay(parcelaDate), cut)) return false;
  if (cutEnd && isAfter(startOfDay(parcelaDate), cutEnd)) return false;
  return true;
}

type LancPlain = {
  date: Date;
  debContaStr: string;
  credContaStr: string;
  value: number;
  historico: string;
};

/**
 * Igual a `coletarLancamentosDominio` no que tange juros; transferência LP→CP:
 * **31/12** de cada ano civil em que exista parcela no cronograma, valor **12 × parcela**
 * (provisionamento para o exercício seguinte; sem linha no 1º dia do mês seguinte ao vencimento).
 */
export function coletarLancamentosJurosParcelamento(
  inp: ParcelamentoExportInput,
  parseCurrency: (s: string) => number,
  cronograma?: ParcelaLinha[]
): LancPlain[] {
  const cron = cronograma ?? cronogramaParcelamento(inp, parseCurrency);
  const lista: LancPlain[] = [];
  const cut = parseDataGerarLancamentosApartir(inp);
  const cutEnd = parseDataGerarLancamentosAte(inp);

  if (cron.length > 0) {
    // Usar valor total informado pelo usuario se disponivel, senao usar soma do cronograma
    let totalPlano: number | null = null;
    if (inp.valorTotalParcelamentoStr?.trim()) {
      // Se usuario preencheu valor total, converter e usar
      const rawTotal = String(inp.valorTotalParcelamentoStr)
        .replace(/[^\d.,-]/g, '')
        .trim()
        .replace(/\./g, '')
        .replace(',', '.');
      const parsed = parseFloat(rawTotal);
      totalPlano = valorMinUmCentavo(parsed);
    } else {
      // Senao, usar soma do cronograma
      totalPlano = valorMinUmCentavo(cron.reduce((s, r) => s + r.valor, 0));
    }
    const debE = contaSomenteDigitos(inp.accEmprestimoDebit);
    const credE = contaSomenteDigitos(inp.accEmprestimoCredit);
    const d0raw = cron[0]?.date;
    let d0 = d0raw;
    if (d0 && cut && isBefore(startOfDay(d0), cut)) {
      d0 = cut;
    }
    if (totalPlano !== null && debE && credE && d0 && incluirLancParcelaNaDataCorte(d0, cut, cutEnd)) {
      lista.push({
        date: d0,
        debContaStr: debE,
        credContaStr: credE,
        value: totalPlano,
        historico: 'CONTA PARCELAMENTOS',
      });
    }
  }

  const debJ = contaSomenteDigitos(inp.accJurosAproDebit);
  const credJ = contaSomenteDigitos(inp.accJurosAproCredit);
  const debApr = contaSomenteDigitos(inp.accApropriacaoDebit);
  const credApr = contaSomenteDigitos(inp.accApropriacaoCredit);
  const jurosPorLinha = jurosPorCompetenciaParcelamento(inp, cron, parseCurrency);

  const debT = contaSomenteDigitos(inp.accTransferenciaDebit);
  const credT = contaSomenteDigitos(inp.accTransferenciaCredit);

  const debParc = contaSomenteDigitos(inp.accParcelaDebit);
  const credParc = contaSomenteDigitos(inp.accParcelaCredit);

  const debPag = contaSomenteDigitos(inp.accPagamentoDebit);
  const credPag = contaSomenteDigitos(inp.accPagamentoCredit);

  cron.forEach((row, idx) => {
    if (!incluirLancParcelaNaDataCorte(row.date, cut, cutEnd)) return;
    const valorJuros = valorMinUmCentavo(jurosPorLinha[idx] ?? 0);
    if (valorJuros === null) return;
    const parDate = row.date;
    const firstDay = setDate(parDate, 1);
    const lastDay = lastDayOfMonth(parDate);

    if (debJ && credJ) {
      lista.push({
        date: firstDay,
        debContaStr: debJ,
        credContaStr: credJ,
        value: valorJuros,
        historico: 'PROVISAO DE JUROS A APROPRIAR',
      });
    }

    if (debApr && credApr) {
      lista.push({
        date: lastDay,
        debContaStr: debApr,
        credContaStr: credApr,
        value: valorJuros,
        historico: 'APROPRIACAO DE JUROS',
      });
    }
  });

  cron.forEach((row) => {
    if (!incluirLancParcelaNaDataCorte(row.date, cut, cutEnd)) return;
    
    const valorParcela = valorMinUmCentavo(row.valor);
    if (valorParcela !== null) {
      // Lançamento da Conta de Parcela (Provisão/Mensal)
      if (debParc && credParc) {
        lista.push({
          date: row.date,
          debContaStr: debParc,
          credContaStr: credParc,
          value: valorParcela,
          historico: 'PROVISAO PARCELA MENSAL',
        });
      }
      
      // Lançamento da Conta de Pagamento (Baixa/Mensal)
      const valorPagamento = row.pagamento !== undefined ? valorMinUmCentavo(row.pagamento) : valorParcela;
      if (debPag && credPag && valorPagamento !== null && valorPagamento > 0) {
        lista.push({
          date: row.date,
          debContaStr: debPag,
          credContaStr: credPag,
          value: valorPagamento,
          historico: 'PAGAMENTO PARCELA MENSAL',
        });
      }
    }

    const multa = valorMinUmCentavo(row.multa ?? 0);
    if (multa === null) return;
    const debM = contaSomenteDigitos(row.contaDebito) || debApr;
    const credM = contaSomenteDigitos(row.contaCredito) || credApr;
    if (!debM || !credM) return;
    lista.push({
      date: lastDayOfMonth(row.date),
      debContaStr: debM,
      credContaStr: credM,
      value: multa,
      historico: 'MULTA PARCELAMENTO',
    });
  });

  if (debT && credT && cron.length > 0) {
    const years = [...new Set(cron.map((r) => r.date.getFullYear()))].sort((a, b) => a - b);
    for (const y of years) {
      const dec31 = lastDayOfMonth(new Date(y, 11, 1));
      if (!incluirLancParcelaNaDataCorte(dec31, cut, cutEnd)) continue;

      // Valor dinâmico da transferência: soma das parcelas que vencem no ano seguinte (y + 1)
      const nextYearInstallments = cron.filter((r) => r.date.getFullYear() === y + 1);
      const nextYearSum = nextYearInstallments.reduce((s, r) => s + r.valor, 0);
      const dynamicTransfer = Math.round(nextYearSum * 100) / 100;

      if (dynamicTransfer > 0) {
        lista.push({
          date: dec31,
          debContaStr: debT,
          credContaStr: credT,
          value: dynamicTransfer,
          historico: 'TRANSFERENCIA DO LONGO PARA O CURTO PRAZO',
        });
      }
    }
  }

  return lista.sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function generateParcelamentoTxtPlus(
  inp: ParcelamentoExportInput,
  parseCurrency: (s: string) => number,
  cronograma?: ParcelaLinha[]
): string {
  const lista = coletarLancamentosJurosParcelamento(inp, parseCurrency, cronograma);
  const compl = inp.dominioComplementoStr ?? '';
  const codigo = inp.dominioCodigoHistoricoStr ?? '';
  const lines = lista.map((l) =>
    montarLinhaTxtDominio({
      date: l.date,
      debContaStr: l.debContaStr,
      credContaStr: l.credContaStr,
      value: l.value,
      historico: l.historico,
      codigoHistoricoStr: codigo,
      complementoHistoricoStr: compl,
    })
  );
  return lines.join('\r\n');
}

/** Itens em falta antes de exportar TXT+ / PDF. */
export function diagnosticarExportParcelamento(
  inp: ParcelamentoExportInput,
  parseCurrency: (s: string) => number,
  cronograma?: ParcelaLinha[]
): DiagnosticoExportItem[] {
  const cron = cronograma ?? cronogramaParcelamento(inp, parseCurrency);
  const lanc = coletarLancamentosJurosParcelamento(inp, parseCurrency, cron);
  const temJuros = parcelamentoTemJurosConfigurados(inp, parseCurrency, cron);
  const modoFaixa = inp.variacaoValorParcelas === 'por_faixa';
  const modoJurosPct = inp.modoCalculoJuros === 'percentual_faixa';
  return [
    {
      ok: !modoFaixa || temFaixasValorParcelaPopuladas(inp.faixasValorParcelaJson, parseCurrency),
      label: 'Ao menos uma faixa de parcelas com valor (modo por faixa)',
    },
    {
      ok:
        !modoJurosPct ||
        temFaixasJurosPercentualPopuladas(inp.faixasJurosPercentualJson) ||
        parsePercentualStr(inp.valorJurosMensalStr) > 0,
      label: 'Juros %: faixa ou % padrão informado',
    },
    { ok: cron.length > 0, label: 'Cronograma com ao menos uma parcela' },
    { ok: lanc.length > 0, label: 'Ao menos um lançamento Domínio gerável' },
    {
      ok: !temJuros || (!!contaSomenteDigitos(inp.accJurosAproDebit) && !!contaSomenteDigitos(inp.accJurosAproCredit)),
      label: 'Contas de provisão de juros (débito e crédito)',
    },
    {
      ok:
        !temJuros ||
        (!!contaSomenteDigitos(inp.accApropriacaoDebit) && !!contaSomenteDigitos(inp.accApropriacaoCredit)),
      label: 'Contas de apropriação de juros (débito e crédito)',
    },
    {
      ok:
        !(parseCurrency(inp.valorParcelaStr) > 0 && cron.length > 0) ||
        (!!contaSomenteDigitos(inp.accEmprestimoDebit) && !!contaSomenteDigitos(inp.accEmprestimoCredit)),
      label: 'Contas da abertura CONTA PARCELAMENTOS',
    },
  ];
}

export function downloadParcelamentoTxtPlus(filename: string, content: string) {
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

function pdfDrawWrappedLines(
  doc: jsPDF,
  lines: string[],
  x: number,
  startY: number,
  maxWidth: number,
  lineHeight = 4.2
): number {
  let y = startY;
  for (const item of lines) {
    const wrapped = doc.splitTextToSize(pdfSafe(item), maxWidth) as string[];
    doc.text(wrapped, x, y);
    y += wrapped.length * lineHeight + 1.5;
  }
  return y;
}

export function downloadParcelamentoRelatorioPdf(
  inp: ParcelamentoExportInput,
  parseCurrency: (s: string) => number,
  formatCurrencyFn: (n: number) => string,
  arquivoBaseNome: string
) {
  const cron = cronogramaParcelamento(inp, parseCurrency);
  const lanc = coletarLancamentosJurosParcelamento(inp, parseCurrency, cron);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let y = 16;
  doc.setFontSize(16);
  doc.setTextColor(16, 100, 80);
  doc.text(pdfSafe('Relatorio Parcelamento Manual'), 14, y);
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
  const numParc = (inp.numeroParcelamento ?? '').trim();
  if (numParc) {
    doc.text(pdfSafe(`Nº do parcelamento: ${numParc}`), 14, y);
    y += 5;
  }
  doc.text(pdfSafe(`Plano: ${inp.nomeParcelamento || '-'}`), 14, y);
  y += 5;
  doc.text(pdfSafe(`Cliente: ${inp.clienteNome.trim() || '-'}`), 14, y);
  y += 5;
  if (inp.dataGerarLancamentosAPartirStr?.trim()) {
    const dc = parseISO(inp.dataGerarLancamentosAPartirStr.slice(0, 10));
    if (isValid(dc)) {
      doc.text(
        pdfSafe(`Lancamentos Domínio a partir de: ${format(dc, 'dd/MM/yyyy', { locale: ptBR })}`),
        14,
        y
      );
      y += 5;
    }
  }
  const tot = cron.reduce((a, x) => a + x.valor, 0);
  doc.text(
    pdfSafe(
      `${cron.length} parcelas · Valor cada ${formatCurrencyFn(parseCurrency(inp.valorParcelaStr))} · Total ${formatCurrencyFn(tot)}`
    ),
    14,
    y
  );
  y += 5;
  if (inp.primeiraParcelaSemJuros) {
    doc.text(
      pdfSafe('1a parcela sem juros: provisao e apropriacao de juros nao geradas para a 1a parcela.'),
      14,
      y
    );
    y += 5;
  }
  const pageW = doc.internal.pageSize.getWidth();
  y = pdfDrawWrappedLines(
    doc,
    [
      `Linha inicial TXT (CONTA PARCELAMENTOS): total cronograma ${formatCurrencyFn(tot)}.`,
      'Coluna texto = historicos dos lancamentos (CONTA PARCELAMENTOS, juros etc.); codigo 0.',
      'Complemento em todas as linhas quando preenchido no cadastro.',
    ],
    14,
    y,
    pageW - 28
  );
  y += 6;

  const jd = contaSomenteDigitos(inp.accJurosAproDebit);
  const jc = contaSomenteDigitos(inp.accJurosAproCredit);
  const ad = contaSomenteDigitos(inp.accApropriacaoDebit);
  const ac = contaSomenteDigitos(inp.accApropriacaoCredit);
  const td = contaSomenteDigitos(inp.accTransferenciaDebit);
  const tc = contaSomenteDigitos(inp.accTransferenciaCredit);
  const ed = contaSomenteDigitos(inp.accEmprestimoDebit);
  const ec = contaSomenteDigitos(inp.accEmprestimoCredit);

  const paramRows: string[][] = [
    [
      'Provisao juros a apropriar (1o dia)',
      jd || '-',
      jc || '-',
      inp.valorJurosMensalStr || '0',
    ],
    [
      'Apropriacao de juros (ultimo dia)',
      ad || '-',
      ac || '-',
      '(mesmo valor acima)',
    ],
    [
      'Transferencia LP / CP (31/12 cada ano civil)',
      td || '-',
      tc || '-',
      'Dinamico (proximo ano civil)',
    ],
    ['Valor plano (1a data · total cronograma)', ed || '-', ec || '-', formatCurrencyFn(tot)],
  ];

  doc.setFontSize(11);
  doc.text(pdfSafe('Contas Dominio (mesmo layout da simulacao de emprestimo)'), 14, y);
  y += 3;
  autoTable(doc, {
    startY: y,
    head: [['Trecho', 'Debito', 'Credito', 'Valor / nota']],
    body: paramRows.map((row) => row.map((c) => pdfSafe(String(c)))),
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: [30, 100, 80] },
    margin: { left: 14, right: 14 },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

  if (cron.length > 0) {
    const pageWidth = doc.internal.pageSize.getWidth();
    const marginX = 14;
    const textWidth = pageWidth - marginX * 2;
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    y = pdfDrawWrappedLines(
      doc,
      [
        'Curto / longo prazo (colunas do cronograma):',
        'Curto = soma das proximas parcelas na janela rolling (padrao 12 meses, alinhada ao CPC 03).',
        'Longo = soma de todas as parcelas futuras apos a linha, menos o curto (saldo devedor da linha = curto + longo).',
        'Transferencia LP para CP (31/12): use as contas de transferencia quando o TXT incluir esse lancamento.',
      ],
      marginX,
      y,
      textWidth
    );
    y += 4;
    doc.setFontSize(11);
    doc.setTextColor(20, 20, 20);
    doc.text(pdfSafe('Cronograma de parcelas'), 14, y);
    y += 3;
    const slice = cron.slice(0, Math.min(cron.length, 48));
    const jurosPorLinha = jurosPorCompetenciaParcelamento(inp, cron, parseCurrency);
    const jurosBase = parseCurrency(inp.valorJurosMensalStr);
    const pularJurosPrim = !!inp.primeiraParcelaSemJuros;
    const head = [['N', 'Venc.', 'Valor', 'Saldo Dev.', 'Juros', 'Bruta', 'Curto', 'Longo']];
    const body = slice.map((r, idx) => {
      const jurosLinha = jurosPorLinha[idx] ?? 0;
      const bruta = r.valor + jurosLinha;
      const cpc = parcelamentoCpcCurtoLongo(cron, idx, 2);
      const saldoDev = cpc.curto + cpc.longo;
      const curto = cpc.longo === 0 ? saldoDev : cpc.curto;
      const longo = cpc.longo === 0 ? 0 : cpc.longo;
      const labelJuros =
        jurosLinha > 0
          ? formatCurrencyFn(jurosLinha).replace(/\u00a0/g, ' ')
          : pularJurosPrim && idx === 0 && jurosBase > 0
            ? 'sem juros'
            : '-';
      return [
        String(r.n),
        format(r.date, 'dd/MM/yyyy'),
        formatCurrencyFn(r.valor).replace(/\u00a0/g, ' '),
        formatCurrencyFn(saldoDev).replace(/\u00a0/g, ' '),
        labelJuros,
        formatCurrencyFn(bruta).replace(/\u00a0/g, ' '),
        formatCurrencyFn(curto).replace(/\u00a0/g, ' '),
        formatCurrencyFn(longo).replace(/\u00a0/g, ' '),
      ].map((c) => pdfSafe(String(c)));
    });
    autoTable(doc, {
      startY: y,
      head: head,
      body,
      styles: { fontSize: 6, cellPadding: 1 },
      headStyles: { fillColor: [40, 40, 60] },
      margin: { left: 14, right: 14 },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    if (cron.length > slice.length) {
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text(pdfSafe(`... e mais ${cron.length - slice.length} parcelas`), 14, y);
      y += 8;
    }
  }

  if (lanc.length > 0) {
    doc.setFontSize(11);
    doc.setTextColor(20, 20, 20);
    doc.text(pdfSafe('Previa linhas TXT+ (ordenadas por data)'), 14, y);
    y += 4;
    const cap = Math.min(lanc.length, 40);
    autoTable(doc, {
      startY: y,
      head: [['Data', 'Deb', 'Cred', 'Valor', 'Historico']],
      body: lanc.slice(0, cap).map((l) => [
        format(l.date, 'dd/MM/yyyy'),
        l.debContaStr,
        l.credContaStr,
        formatDominioNumber(l.value),
        pdfSafe(l.historico),
      ]),
      styles: { fontSize: 7 },
      headStyles: { fillColor: [60, 50, 30] },
      margin: { left: 14, right: 14 },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
    if (lanc.length > cap) {
      doc.setFontSize(8);
      doc.text(pdfSafe(`... total ${lanc.length} linhas - export TXT+ completo na lista.`), 14, y);
    }
  } else {
    doc.setFontSize(9);
    doc.setTextColor(120, 80, 30);
    doc.text(
      pdfSafe('Nenhuma linha TXT+ - preencha contas (juros, transferencia LP/CP 31/12 ou conta parcelamentos).'),
      14,
      y
    );
  }

  const safe =
    arquivoBaseNome.replace(/[^\w\-./\s]/gi, '').replace(/\s+/g, '_').slice(0, 120) ||
    `parcelamento_${Date.now()}`;
  doc.save(`${safe}_relatorio.pdf`);
}
