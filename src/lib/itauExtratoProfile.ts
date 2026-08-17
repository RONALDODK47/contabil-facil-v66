/**
 * Perfil de importação OCR — extrato Itaú empresarial (coluna Valor + Saldo).
 * Fonte única de configuração para pipeline, modal OCR, ingestão e UI.
 */
import type { GenericOcrRow } from './parcelamentoColunasExtract';

type ExtratoImportSkippedEntry = {
  severity?: 'error' | 'warning' | 'info';
};
import {
  extratoConsolidarExtratoRowsParaImportacao,
  extratoExtrairSaldoDisponivelDiaDeLinha,
  extratoLinhaEhSomenteDataEValor,
  extratoLinhaSaldoTemValorLancamentoColado,
  extratoRowEhSaldoInformativo,
  extratoTrechoTemHistoricoOperacional,
  extrairSaldoAnteriorDasRows,
  type OcrExtratoRow,
} from './ocrExtratoPositional';

/** Palavras ignoradas recomendadas para Itaú (linhas de saldo informativo). */
export const ITAU_EXTRATO_IGNORE_LINE_WORDS = [
  'saldo anterior',
  'saldo bloq',
  'saldo do dia',
  'saldo total disponivel',
  'saldo total disponivel dia',
] as const;

/** Texto padrão para textarea / localStorage (mesmo do bench). */
export const ITAU_EXTRATO_IGNORE_LINE_WORDS_TEXT = ITAU_EXTRATO_IGNORE_LINE_WORDS.join(', ');

export const ITAU_EXTRATO_DATA_COL_IDS = [
  'data',
  'descricao',
  'valorCredito',
  'valorDebito',
  'valorMisto',
] as const;

export const ITAU_EXTRATO_HEADER_KEYWORDS = [
  'saldo anterior',
  'data',
  'lancamento',
  'credito',
  'debito',
  'historico',
  'valor',
] as const;

/** Tolerância padrão saldo final vs conciliado (OCR real pode divergir ~2,7k). */
export const ITAU_EXTRATO_SALDO_FINAL_TOLERANCE = 2_700;

/** Indicadores de layout Itaú empresarial no texto OCR. */
const RE_ITAU_LAYOUT =
  /\b(?:ITAU|ITAÚ|AUT\s+MAIS|SISPAG|TED\s*RECEB|TEDRECEBIDA|SALDO\s+TOTAL\s+DISPON[IÍ]VEL)\b/i;

export type ExtratoConciliacaoResumo = {
  ok: boolean;
  perfilItau: boolean;
  saldoAnterior: number;
  creditos: number;
  debitos: number;
  saldoConciliado: number;
  saldoFinalOcr?: number;
  deltaSaldoFinal?: number;
  alertasCriticos: number;
  mensagem: string;
};

export type ItauExtratoMapImportOptions = {
  ignoreLineWords?: string[];
  extratoPreserveSegmentRows: true;
  extratoImportLogContext?: ExtratoImportLogContext;
};

export type ItauExtratoExtractGenericOptions = {
  dataColIds: string[];
  headerKeywords: string[];
  allowFaixaFallback: boolean;
  extratoPositional: true;
  extratoPreserveSegmentRows: true;
  strictFaixaVertical: false;
  statementYear: string;
  ocrFullText?: string;
  ignoreLineWords: string[];
};

/** Detecta extrato Itaú a partir do texto OCR bruto. */
export function detectItauExtratoFromOcrText(text: string): boolean {
  const blob = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!blob) return false;
  let score = 0;
  if (RE_ITAU_LAYOUT.test(blob)) score += 2;
  if (/SALDO\s+TOTAL\s+DISPON[IÍ]VEL\s+DIA/i.test(blob)) score += 2;
  if (/104\.0327\.OURINHOS|OURINHOS\s+CAMARA|RIBEIRAO\s+PINHAL/i.test(blob)) score += 1;
  if (/\bIOF\b/.test(blob) && /REND\s+PAGO\s+APLIC|AUT\s+MAIS/i.test(blob)) score += 1;
  return score >= 2;
}

/** Detecta layout Itaú a partir das linhas OCR brutas. */
export function detectItauExtratoFromRows(rows: GenericOcrRow[]): boolean {
  const blob = rows
    .slice(0, 40)
    .map((r) => String(r._linhaOcr ?? r.descricao ?? '').trim())
    .join(' ');
  return detectItauExtratoFromOcrText(blob);
}

/** Detecta Itaú a partir dos itens posicionados da página 1 (modal OCR). */
export function detectItauExtratoFromPageItems(
  items: Array<{ str?: string }>,
): boolean {
  const blob = items
    .slice(0, 120)
    .map((i) => String(i.str ?? '').trim())
    .join(' ');
  return detectItauExtratoFromOcrText(blob);
}

/** Mescla ignore words do perfil Itaú com as do usuário (sem duplicar). */
export function mergeItauIgnoreLineWords(userWords: string[]): string[] {
  const out = new Set<string>(ITAU_EXTRATO_IGNORE_LINE_WORDS);
  for (const w of userWords) {
    const t = w.trim().toLowerCase();
    if (t) out.add(t);
  }
  return [...out];
}

/** Opções de extração colunar idênticas ao bench / scanner. */
export function getItauExtratoExtractGenericOptions(
  statementYear: string,
  userIgnoreWords: string[] = [],
  ocrFullText?: string,
): ItauExtratoExtractGenericOptions {
  return {
    dataColIds: [...ITAU_EXTRATO_DATA_COL_IDS],
    headerKeywords: [...ITAU_EXTRATO_HEADER_KEYWORDS],
    allowFaixaFallback: true,
    extratoPositional: true,
    extratoPreserveSegmentRows: true,
    strictFaixaVertical: false,
    statementYear,
    ocrFullText,
    ignoreLineWords: mergeItauIgnoreLineWords(userIgnoreWords),
  };
}

export type ExtratoImportLogContext = {
  fileName?: string;
  logToConsole?: boolean;
  engine?: string;
  scale?: number;
  escalations?: string[];
  qualityOk?: boolean;
};

/** Opções de import mapOcrRowsToImportItems — mesmo fluxo dos testes. */
export function getItauExtratoMapImportOptions(
  userIgnoreWords?: string[],
  logContext?: ExtratoImportLogContext,
): ItauExtratoMapImportOptions {
  return {
    ignoreLineWords: mergeItauIgnoreLineWords(userIgnoreWords ?? []),
    extratoPreserveSegmentRows: true,
    ...(logContext ? { extratoImportLogContext: logContext } : {}),
  };
}

/** Resolve opções de import: aplica perfil Itaú quando detectado nas rows. */
export function resolveExtratoMapImportOptions(
  rows: GenericOcrRow[],
  userIgnoreWords?: string[],
  logContext?: ExtratoImportLogContext,
): ItauExtratoMapImportOptions & { perfilItau: boolean } {
  const perfilItau = detectItauExtratoFromRows(rows);
  if (perfilItau) {
    return { ...getItauExtratoMapImportOptions(userIgnoreWords, logContext), perfilItau: true };
  }
  return {
    ignoreLineWords: userIgnoreWords,
    extratoPreserveSegmentRows: true,
    ...(logContext ? { extratoImportLogContext: logContext } : {}),
    perfilItau: false,
  };
}

/** Saldo final disponível na última linha "SALDO TOTAL DISPONÍVEL" do OCR. */
export function extrairSaldoFinalDisponivelDasRows(rows: OcrExtratoRow[]): number | undefined {
  const reSaldoFinal = /SALDO\s+TOTAL\s+DISPON[IÍ]VEL/i;
  for (let i = rows.length - 1; i >= 0; i--) {
    const linha = String(rows[i]._linhaOcr ?? rows[i].descricao ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!reSaldoFinal.test(linha)) continue;
    const saldo = extratoExtrairSaldoDisponivelDiaDeLinha(linha);
    if (saldo != null && saldo > 0.0001) return saldo;
  }
  return undefined;
}

/**
 * Avalia conciliação pós-import só com lançamentos:
 * Anterior + créditos − débitos. Nunca compara com saldo do PDF/OCR.
 */
export function avaliarExtratoConciliacaoItau(params: {
  items: Array<{ nature?: string; value?: number }>;
  rawRows?: GenericOcrRow[];
  conciliacaoRawRows?: GenericOcrRow[];
  saldoAnterior?: number;
  /** @deprecated Ignorado — não usa saldo de arquivo/OCR. */
  saldoFinalEsperado?: number;
  skipped?: ExtratoImportSkippedEntry[];
  /** @deprecated Ignorado. */
  toleranciaSaldoFinal?: number;
  perfilItau?: boolean;
}): ExtratoConciliacaoResumo {
  const {
    items,
    rawRows = [],
    conciliacaoRawRows,
    saldoAnterior: saParam,
    skipped = [],
    perfilItau = detectItauExtratoFromRows(conciliacaoRawRows ?? rawRows),
  } = params;

  const rowsParaSaldo = (conciliacaoRawRows ?? rawRows) as OcrExtratoRow[];

  const saldoAnterior =
    saParam != null && Number.isFinite(saParam)
      ? saParam
      : rowsParaSaldo.length > 0
        ? extrairSaldoAnteriorDasRows(rowsParaSaldo)
        : 0;

  const creditos = items
    .filter((i) => i.nature === 'C')
    .reduce((s, i) => s + Math.abs(Number(i.value) || 0), 0);
  const debitos = items
    .filter((i) => i.nature === 'D')
    .reduce((s, i) => s + Math.abs(Number(i.value) || 0), 0);
  const saldoConciliadoRaw = saldoAnterior + creditos - debitos;
  const saldoConciliado =
    Math.abs(saldoConciliadoRaw) < 0.005
      ? 0
      : Math.round(saldoConciliadoRaw * 100) / 100;

  const alertasCriticos = skipped.filter(
    (e) => (e.severity ?? 'error') === 'error',
  ).length;

  // OK = há lançamentos. Alertas de linha vão no LOG, sem bloquear por saldo de PDF.
  const ok = items.length >= 1;

  let mensagem: string;
  if (items.length === 0) {
    mensagem = 'Nenhum lançamento importado';
  } else if (alertasCriticos > 0) {
    mensagem = `${items.length} lançamento(s) · saldo R$ ${saldoConciliado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} · ${alertasCriticos} alerta(s) no LOG (não bloqueia)`;
  } else {
    mensagem = `Conciliação OK — ${items.length} lançamento(s), saldo R$ ${saldoConciliado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (Anterior + C − D)`;
  }

  return {
    ok,
    perfilItau,
    saldoAnterior,
    creditos: Math.round(creditos * 100) / 100,
    debitos: Math.round(debitos * 100) / 100,
    saldoConciliado,
    alertasCriticos,
    mensagem,
  };
}

/** Há órfão ou saldo colado no raw no mesmo dia que precisa de TED/PIX. */
export function itauRawTemOrfaoSaldoColadoMesmoDia(
  rawRows: OcrExtratoRow[],
  dataNorm: string,
): boolean {
  if (!dataNorm) return false;
  return rawRows.some((r) => {
    const l = String(r._linhaOcr ?? '').replace(/\s+/g, ' ').trim();
    if (!l) return false;
    const datas = l.match(/\d{2}\/\d{2}/g) ?? [];
    if (datas.length > 0 && !datas.some((d) => dataNorm.startsWith(d))) {
      const col = String(r.data ?? '').trim();
      if (col && !col.includes(dataNorm.slice(0, 5))) return false;
    }
    if (
      !extratoLinhaEhSomenteDataEValor(l) &&
      r._valorRecuperadoSaldo !== '1' &&
      !extratoLinhaSaldoTemValorLancamentoColado(l)
    ) {
      return false;
    }
    return true;
  });
}

/** Consolidar com perfil Itaú (delega ao pipeline positional). */
export function consolidarExtratoItauParaImportacao(
  rowsToMap: OcrExtratoRow[],
  rawRows: OcrExtratoRow[],
  ignoreWords: string[] = [],
): OcrExtratoRow[] {
  return extratoConsolidarExtratoRowsParaImportacao(rowsToMap, rawRows, ignoreWords);
}

/** Linha raw tem histórico operacional Itaú (TED/PIX/SISPAG etc.). */
export function itauRawLinhaTemHistoricoOperacional(linha: string): boolean {
  const norm = linha.replace(/\s+/g, ' ').trim();
  if (!norm || extratoRowEhSaldoInformativo({ _linhaOcr: norm } as OcrExtratoRow)) return false;
  if (extratoLinhaSaldoTemValorLancamentoColado(norm)) return false;
  if (extratoLinhaEhSomenteDataEValor(norm)) return false;
  return extratoTrechoTemHistoricoOperacional(norm);
}
