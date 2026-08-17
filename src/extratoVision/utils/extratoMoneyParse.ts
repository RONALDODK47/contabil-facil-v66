/**
 * Valores monetários em extrato bancário — rejeita nº documento colado ao valor (ex.: 9002939423,37).
 */
import {
  prepararTextoOcrParaMoeda,
  parseMoedaPt,
} from '../../lib/parcelamentoPlanilha';
import { normalizeBbExtratoValorGlued } from './bbExtratoOcrNormalize';

/** Teto por lançamento em extrato (R$). */
export const EXTRATO_MOEDA_PLAUSIVEL_MAX = 99_999_999;

/** Parte inteira: no máx. 999.999,99 (6 dígitos) — evita saldo e nº documento colado. */
export const EXTRATO_MOEDA_DIGITOS_INTEIROS_MAX = 6;

const RE_MOEDA_BR_NO_TEXTO =
  /\d{1,3}(?:\.\d{3})*(?:,\s*\d{2}|\s*,\s*\d{2})|\d{1,11}\s*,\s*\d{2}|\d{4,}(?:,\s*\d{2}|\s*,\s*\d{2})/g;

function digitosInteirosAntesDaVirgula(hit: string): number {
  const i = hit.lastIndexOf(',');
  if (i < 0) return 999;
  return hit.slice(0, i).replace(/\D/g, '').length;
}

export function moedaExtratoPlausivel(hit: string): number {
  const v = parseMoedaPt(hit);
  const digs = digitosInteirosAntesDaVirgula(hit);
  if (v > 0.0001 && v <= EXTRATO_MOEDA_PLAUSIVEL_MAX && digs <= EXTRATO_MOEDA_DIGITOS_INTEIROS_MAX) {
    return v;
  }
  return 0;
}

/** Rejeita CNPJ, conta corrente, telefone e fragmentos Pix colados como valor monetário. */
export function extratoOcrTokenEhFalsoValorMonetario(text: string, contextBefore = ''): boolean {
  const frag = String(text ?? '').trim();
  const before = String(contextBefore ?? '').slice(-40);
  if (/[DCdc]\s*$/.test(frag)) return false;
  if (/\d{2}\.?\d{3}\.?\d{3}\s*[\/\-]\s*\d{4}\s*[-\s]?\d{2}/.test(frag)) return true;
  if (/\d{1,3}[.,]\d{3}[.,]\d{3}(?:[\/\s-]|$)/.test(frag) && !/[DCdc]\s*$/.test(frag)) return true;
  if (/\d{2}\.\d{3}\.\d{3}/.test(frag) && !/[DCdc]\s*$/.test(frag)) return true;
  if (/Pagamento\s+Pix\s+[\d.,]/i.test(before + frag)) return true;
  if (/Recebimento\s+Pix\s+[\d.,]/i.test(before + frag)) return true;
  if (/FAV\.?:\s+[\d.,]/i.test(before.slice(-20) + frag)) return true;
  if (/\b0?800[\s.-]?\d/i.test(frag.replace(/\s/g, ''))) return true;
  if (/^\d{10,}$/.test(frag.replace(/\D/g, '')) && !/[DCdc]\s*$/.test(frag)) return true;
  return false;
}

function hitsMoedaBr(text: string): string[] {
  const base = prepararTextoOcrParaMoeda(text);
  return base.match(RE_MOEDA_BR_NO_TEXTO) ?? [];
}

/** Nº documento colado ao valor no mesmo token PDF (ex.: 9002939423,37 → 423,37). */
function moedaFromTokenComDocumentoColado(raw: string): { value: number; token: string } | null {
  const s = prepararTextoOcrParaMoeda(String(raw ?? '').trim());
  if (!s) return null;

  let best: { value: number; token: string; docLen: number } | null = null;
  const re = /(\d{1,3}(?:\.\d{3})*,\d{2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const token = m[1];
    const v = moedaExtratoPlausivel(token);
    if (v <= 0) continue;
    const docLen = s.slice(0, m.index).replace(/\D/g, '').length;
    if (docLen < 5 || docLen > 12) continue;
    if (!best || docLen < best.docLen) {
      best = { value: v, token, docLen };
    }
  }
  return best ? { value: best.value, token: best.token } : null;
}

function moedaFromRowItem(it: RowItem): { value: number; token: string; negative: boolean } | null {
  const str = it.str;
  const natureSuffix = parseExtratoNaturezaNoValor(str);
  const negative = /[-−(]/.test(str) || natureSuffix === 'D';
  const core = str.replace(/^[(\s]*[-−+]?/, '').replace(/[)\s]+$/, '');
  let v = moedaExtratoPlausivel(core);
  let token = core;
  if (v <= 0.0001) {
    const split = moedaFromTokenComDocumentoColado(str);
    if (!split) return null;
    v = split.value;
    token = split.token;
  }
  return { value: v, token, negative };
}

function itemCenterX(it: RowItem): number {
  return it.x + (it.w ?? 0) / 2;
}

function itemInCol(it: RowItem, col: { start: number; end: number }, imgWidth: number): boolean {
  const pad = Math.max(4, imgWidth * 0.008);
  const cx = itemCenterX(it);
  return cx >= col.start - pad && cx <= col.end + pad;
}

/** D/C colado ao valor (ex.: «5.809,74D»). D/C separado por espaço no fim do OCR é ignorado. */
export function parseExtratoNaturezaNoValor(raw: string | undefined): 'D' | 'C' | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/,\d{2}\s+[DCdc]\s*$/i.test(s)) return null;
  const compact = s.replace(/\s+/g, '');
  const reSufixoBr = /(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})([DCdc])\s*$/;
  const mBr = compact.match(reSufixoBr);
  if (mBr) {
    const ch = mBr[2]!.toUpperCase();
    return ch === 'D' ? 'D' : ch === 'C' ? 'C' : null;
  }
  if (/(?:^|\s)[+](?:\s|$)/.test(s) || /\s[+]$/.test(s) || /^[+]/.test(s)) return 'C';
  return null;
}

/** Procura indicador D/C na linha posicionada (token "D" após valor monetário). */
export function parseExtratoNaturezaFromRowItems(row: RowItem[]): 'D' | 'C' | null {
  if (!row?.length) return null;
  const sorted = [...row].sort((a, b) => a.x - b.x);
  const line = sorted.map((i) => i.str).join(' ');
  const fromLine = parseExtratoNaturezaNoValor(line);
  if (fromLine) return fromLine;

  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i].str.trim();
    if (!/^[DC]$/i.test(t)) continue;
    const prev = sorted[i - 1];
    if (!prev) continue;
    const prevCompact = prev.str.replace(/\s+/g, '');
    const colado = prevCompact.match(/(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})([DC])$/i);
    if (colado) return colado[2]!.toUpperCase() as 'D' | 'C';
  }
  return null;
}

/** Valor monetário dentro de uma coluna mapeada (+ D/C colado à direita ou sinal −/+). */
export function pickExtratoValorFromColItems(
  row: RowItem[],
  col: { start: number; end: number },
  imgWidth: number,
): { token: string; value: number; nature: 'D' | 'C' | null; negative: boolean } | null {
  if (!row?.length) return null;
  const pad = Math.max(4, imgWidth * 0.008);
  const sorted = [...row].sort((a, b) => a.x - b.x);
  const inCol = sorted.filter((it) => itemInCol(it, col, imgWidth));
  if (!inCol.length) return null;

  const moneyTokens = inCol
    .filter((it) => {
      const raw = String(it.str ?? '').trim();
      if (/^[DCdc]$/.test(raw)) return false;
      const normalized = normalizeExtratoValorColunaOcr(raw);
      if (extratoOcrTokenEhFalsoValorMonetario(normalized, raw)) return false;
      const v = parseMoedaPtFromExtratoColuna(normalized.replace(/^[-−(]/, ''));
      return v > 0.0001 || /^0,\s*00/i.test(normalized.replace(/\s/g, ''));
    })
    .sort((a, b) => a.x - b.x);

  let text =
    moneyTokens.length > 0
      ? moneyTokens[0]!.str
      : inCol
          .map((i) => i.str)
          .filter((s) => !/^[DCdc]$/.test(String(s).trim()))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();

  if (extratoOcrTokenEhFalsoValorMonetario(text)) return null;

  const normalized = normalizeExtratoValorColunaOcr(text);
  if (extratoOcrTokenEhFalsoValorMonetario(normalized, text)) return null;
  const v = parseMoedaPtFromExtratoColuna(normalized);
  const ehZero = /^0,\s*00/i.test(normalized.replace(/\s/g, ''));
  if (v <= 0 && !ehZero) return null;
  const tokenMatch = normalized.match(/\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/);
  const token = tokenMatch?.[0] ?? normalized.trim();
  const nature = extratoNaturezaPorValorAssinadoNoToken(normalized, v);
  return { token, value: v, nature, negative: nature === 'D' };
}

/** Define D/C com base na coluna mapeada, indicador na linha ou sinal. */
export function resolveExtratoDebCredNature(opts: {
  row?: RowItem[];
  rowLine?: string;
  valorTexto?: string;
  negative?: boolean;
  naturezaCol?: string;
  valorDebitoCol?: { start: number; end: number } | null;
  valorCreditoCol?: { start: number; end: number } | null;
  pickCx?: number;
  imgWidth?: number;
}): 'D' | 'C' {
  if (opts.valorTexto?.trim()) {
    const v = parseMoedaPtFromExtratoColuna(opts.valorTexto.replace(/^[-−(]/, ''));
    if (v > 0.0001) {
      return extratoNaturezaPorValorAssinadoNoToken(opts.valorTexto, v);
    }
  }

  const fromText =
    parseExtratoNaturezaNoValor(opts.valorTexto) ??
    (opts.rowLine ? parseExtratoNaturezaNoValor(opts.rowLine) : null) ??
    (opts.row ? parseExtratoNaturezaFromRowItems(opts.row) : null);
  if (fromText) return fromText;

  if (opts.negative) return 'D';
  if (/[+](?:\s|$)/.test(opts.valorTexto ?? '')) return 'C';

  return 'C';
}

/** Normaliza valor OCR colado na coluna (4,440,53D → 4.440,53 D). */
export function normalizeExtratoValorColunaOcr(raw: string): string {
  let t = String(raw ?? '').trim();
  if (/[—–−]/.test(t) || /^G\d/i.test(t) || /\//.test(t)) {
    t = normalizeBbExtratoValorGlued(t);
  }
  const full = t.match(/^[-−(]?\s*(\d),(\d{3}),(\d{2})\s*([DCdc])\s*\*?\s*$/i);
  if (full) {
    return `${full[1]}.${full[2]},${full[3]} ${full[4]!.toUpperCase()}`;
  }
  const end = t.match(/(\d),(\d{3}),(\d{2})\s*([DCdc])\s*\*?\s*$/i);
  if (end) {
    return `${end[1]}.${end[2]},${end[3]} ${end[4]!.toUpperCase()}`;
  }
  return t;
}

/** Coluna crédito/débito: menor trecho plausível (evita saldo/nº documento colado à direita). */
export function parseMoedaPtFromExtratoColuna(raw: string): number {
  const norm = normalizeExtratoValorColunaOcr(raw);
  const hitsNorm = hitsMoedaBr(norm);
  for (const h of hitsNorm) {
    const v = moedaExtratoPlausivel(h);
    if (v > 0) return v;
  }
  const hits = hitsMoedaBr(String(raw ?? ''));
  let menor = 0;
  for (const h of hits) {
    const v = moedaExtratoPlausivel(h);
    if (v <= 0) continue;
    if (menor <= 0 || v < menor) menor = v;
  }
  return menor;
}

/** Linha inteira: primeiro trecho plausível (valor do lançamento, não saldo). */
export function parseMoedaPtFromExtratoLinha(raw: string): number {
  const hits = hitsMoedaBr(String(raw ?? ''));
  for (const h of hits) {
    const v = moedaExtratoPlausivel(h);
    if (v > 0) return v;
  }
  return 0;
}

type RowItem = { str: string; x: number; w?: number; h?: number };

/** PDF nativo: valor na coluna operacional (não saldo à direita). */
export function pickExtratoValorFromRowItems(
  row: RowItem[],
): { token: string; value: number; negative: boolean } | null {
  if (!row?.length) return null;

  const rowMaxX = Math.max(...row.map((i) => i.x + (i.w ?? 0)), 1);
  const saldoMinX = rowMaxX * 0.8;

  const candidates = row
    .map((it) => {
      const parsed = moedaFromRowItem(it);
      if (!parsed) return null;
      const cx = it.x + (it.w ?? 0) / 2;
      return { it, v: parsed.value, token: parsed.token, cx, negative: parsed.negative };
    })
    .filter((c): c is NonNullable<typeof c> => c != null && c.v > 0.0001);

  if (candidates.length === 0) return null;

  let operacionais = candidates.filter((c) => c.cx < saldoMinX);
  if (
    operacionais.length === 0 &&
    candidates.length === 1 &&
    moedaFromTokenComDocumentoColado(candidates[0].it.str)
  ) {
    operacionais = candidates;
  }
  if (operacionais.length === 0) return null;
  operacionais.sort((a, b) => a.v - b.v);
  const pick = operacionais[0];
  const natureToken = parseExtratoNaturezaNoValor(pick.it.str);
  const negative = pick.negative || natureToken === 'D';
  return { token: pick.token, value: pick.v, negative };
}

/** Indicador D/C na coluna natureza do extrato (OCR). */
export function parseExtratoNaturezaIndicador(raw: string | undefined): 'D' | 'C' | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const u = s.toUpperCase();
  if (u === 'D' || u === 'DÉBITO' || u === 'DEBITO' || u.startsWith('DEB')) return 'D';
  if (u === 'C' || u === 'CRÉDITO' || u === 'CREDITO' || u.startsWith('CRE') || u.startsWith('CR')) {
    return 'C';
  }
  if (/^D$/i.test(s)) return 'D';
  if (/^C$/i.test(s)) return 'C';
  return null;
}

/**
 * Regras de sinal do extrato:
 * - coluna débito, sinal "-"/"(" ou indicador D → negativo
 * - coluna crédito, sem sinal de menos ou indicador C → positivo
 */
export function extratoValorIsNegative(opts: {
  texto?: string;
  coluna?: 'debito' | 'credito' | 'misto';
  natureza?: string;
}): boolean {
  const texto = opts.texto ?? '';
  const natureInVal = parseExtratoNaturezaNoValor(texto);
  if (natureInVal === 'D') return true;
  if (natureInVal === 'C') return false;

  const v = parseMoedaPtFromExtratoColuna(texto.replace(/^[-−(]/, ''));
  if (v > 0.0001) {
    return extratoNaturezaPorValorAssinadoNoToken(texto, v) === 'D';
  }

  if (/[+]/.test(texto)) return false;
  if (/[-−(]/.test(texto)) return true;
  return false;
}

export type ExtratoNaturezaTokenOpts = {
  /** Valor veio da coluna débito ou crédito do layout colunar. */
  coluna?: 'debito' | 'credito' | 'misto';
  /** Mantido por compatibilidade; regras de sinal são uniformes para todos os bancos. */
  perfilItau?: boolean;
};

/** Natureza do valor: D/- = negativo; C/+ = positivo; coluna débito = D; crédito = C. */
export function extratoNaturezaPorValorAssinadoNoToken(
  raw: string | undefined | null,
  value = 0,
  opts?: ExtratoNaturezaTokenOpts,
): 'D' | 'C' {
  void value;
  const t = String(raw ?? '').trim();
  if (!t) return opts?.coluna === 'debito' ? 'D' : 'C';
  const compact = t.replace(/\s+/g, '');
  const mSepDc = t.match(/(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s+([DCdc])\s*$/i);
  if (mSepDc) return mSepDc[2]!.toUpperCase() === 'D' ? 'D' : 'C';
  const mColado = compact.match(/(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})([DCdc])$/);
  if (mColado) return mColado[2]!.toUpperCase() === 'D' ? 'D' : 'C';
  const semIndicadorSeparado = t.replace(/\s+[DCdc]\s*$/i, '').trim();
  if (/^[-−(]/.test(semIndicadorSeparado)) return 'D';
  if (/[+](?:\s|$)/.test(semIndicadorSeparado) || /^[+]/.test(semIndicadorSeparado)) return 'C';
  if (opts?.coluna === 'debito') return 'D';
  if (opts?.coluna === 'credito') return 'C';
  return 'C';
}

/** Linha veio da extração IA (visão) — colunas débito/crédito são intencionais. */
export function extratoRowVeioDaExtracaoAi(row: { _extratoAiExtract?: string } | null | undefined): boolean {
  return String(row?._extratoAiExtract ?? '').trim() === '1';
}

function extratoAiContextoHistorico(
  row: {
    descricao?: string;
    historicoOperacao?: string;
    _linhaOcr?: string;
    natureza?: string;
  } | null | undefined,
): string {
  return [row?.descricao, row?.historicoOperacao, row?._linhaOcr, row?.natureza]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extratoAiHistoricoIndicaCreditoRecebido(ctx: string): boolean {
  if (!ctx) return false;
  if (
    /\b(TED\s*RECEB|TEDRECEB|TEDRECEBIDA|PIX\s*RECEB(?:IDO)?|PIXRECEB|RENDIMENTOS|\bREND\b|RECEBIMENTOS)\b/i.test(
      ctx,
    )
  ) {
    return true;
  }
  if (/\b(?:E|PP|O)\s+RECEB(?:IDA)?\b/i.test(ctx)) return true;
  if (/RECEBIDA\d{3}\.\d{4}/i.test(ctx)) return true;
  if (/\bMUNICIPIO\b.*\bRECEB(?:IDA)?\b/i.test(ctx)) return true;
  if (/\bRECEBIDA\b.*\bMUNICIPIO\b/i.test(ctx)) return true;
  return false;
}

function extratoAiHistoricoIndicaDebitoOperacional(ctx: string): boolean {
  const t = ctx.toUpperCase();
  if (/\b(SISPAG|TAR(?:\.|\s)|PAGAMENTOS?\s*TRIB|TRIBCOD|IOF\b)\b/.test(t)) return true;
  if (/\bCODE\b/.test(t)) return true;
  if (/\bTED\b/.test(t)) {
    if (
      /\b(TED\s*RECEB|TEDRECEB|TEDRECEBIDA|\bRECEBIDA\b|\bRECEBIMENTOS\b|CAMARA|MUNICIPIO|OURINHOS|RIBEIRAO|PINHAL|VEREADORES|DEVEREADORES)\b/i.test(
        t,
      )
    ) {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * Natureza para linhas da IA: valor só na coluna débito → D; só crédito → C;
 * coluna mista → regra de sinal do token.
 * Corrige TED/PIX recebido com «D» espúrio no histórico e valor na coluna débito.
 */
export function extratoNaturezaPorOrigemAi(
  row: {
    _extratoAiExtract?: string;
    valorDebito?: string;
    valorCredito?: string;
    valorMisto?: string;
    valor?: string;
    descricao?: string;
    historicoOperacao?: string;
    _linhaOcr?: string;
    natureza?: string;
  } | null | undefined,
): { value: number; nature: 'D' | 'C' } | null {
  if (!extratoRowVeioDaExtracaoAi(row)) return null;

  const debRaw = String(row?.valorDebito ?? '').trim();
  const credRaw = String(row?.valorCredito ?? '').trim();
  const deb = debRaw ? parseMoedaPtFromExtratoColuna(debRaw) : 0;
  const cred = credRaw ? parseMoedaPtFromExtratoColuna(credRaw) : 0;
  const ctx = extratoAiContextoHistorico(row);
  const creditoRecebido =
    extratoAiHistoricoIndicaCreditoRecebido(ctx) || /\s+[DC]\s*$/i.test(ctx);

  if (deb > 0.0001 && cred <= 0.0001) {
    const natureToken = extratoNaturezaPorValorAssinadoNoToken(debRaw, deb);
    if (
      natureToken === 'C' &&
      creditoRecebido &&
      !extratoAiHistoricoIndicaDebitoOperacional(ctx)
    ) {
      return { value: deb, nature: 'C' };
    }
    if (/^[-−(]/.test(debRaw) || parseExtratoNaturezaNoValor(debRaw) === 'D') {
      return { value: deb, nature: 'D' };
    }
    return { value: deb, nature: natureToken };
  }
  if (cred > 0.0001 && deb <= 0.0001) {
    return {
      value: cred,
      nature:
        /^[-−(]/.test(credRaw) || parseExtratoNaturezaNoValor(credRaw) === 'D' ? 'D' : 'C',
    };
  }

  const mistoRaw = String(row?.valorMisto ?? row?.valor ?? '').trim();
  if (mistoRaw) {
    const mistoVal = parseExtratoMoneyValue(mistoRaw);
    if (mistoVal > 0.0001) {
      return {
        value: mistoVal,
        nature: extratoNaturezaPorValorAssinadoNoToken(mistoRaw, mistoVal),
      };
    }
  }

  return null;
}

/** Fallback quando só há texto concatenado. */
export function resolveExtratoValorFromTexts(parts: {
  debito?: string;
  credito?: string;
  valor?: string;
  linha?: string;
  natureza?: string;
}): { value: number; negative: boolean } | null {
  const deb = parseMoedaPtFromExtratoColuna(parts.debito ?? '');
  if (deb > 0) {
    return {
      value: deb,
      negative: extratoNaturezaPorValorAssinadoNoToken(parts.debito, deb) === 'D',
    };
  }

  const cred = parseMoedaPtFromExtratoColuna(parts.credito ?? '');
  if (cred > 0) {
    return {
      value: cred,
      negative: extratoNaturezaPorValorAssinadoNoToken(parts.credito, cred) === 'D',
    };
  }

  const valRaw = parts.valor ?? '';
  const val = parseMoedaPtFromExtratoColuna(valRaw);
  if (val > 0) {
    return {
      value: val,
      negative: extratoNaturezaPorValorAssinadoNoToken(valRaw, val) === 'D',
    };
  }

  const linhaRaw = parts.linha ?? '';
  const linha = parseMoedaPtFromExtratoLinha(linhaRaw);
  if (linha > 0) {
    return {
      value: linha,
      negative: extratoNaturezaPorValorAssinadoNoToken(linhaRaw, linha) === 'D',
    };
  }
  return null;
}

/** Valor monetário finito e dentro do teto de extrato (evita R$ ∞ na UI). */
export function clampExtratoMoney(value: number): number {
  if (!Number.isFinite(value) || value <= 0.0001) return 0;
  return Math.min(value, EXTRATO_MOEDA_PLAUSIVEL_MAX);
}

/** Token com D/C colado é valor de lançamento na linha — usar primeiro trecho, não o menor (evita 17.010→7.010). */
function extratoValorComNaturezaColada(raw: string): boolean {
  const compact = String(raw ?? '')
    .trim()
    .replace(/\s+/g, '');
  return /(?:\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})[DCdc]$/.test(compact);
}

/**
 * Formato de coluna única (Bradesco e similares): `44.558,80` (crédito) ou `-1.534,00` (débito).
 * Sem prefixo R$, sem sufixo D/C.
 */
export function formatExtratoValorAssinadoPt(value: number, nature: 'D' | 'C'): string {
  const abs = Math.abs(value);
  const br = abs.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (abs <= 0.0001 && value <= 0.0001) return '0,00';
  return nature === 'D' ? `-${br}` : br;
}

/** Normaliza token OCR/coluna para o padrão assinado pt-BR. */
export function normalizeExtratoValorAssinadoToken(
  raw: string,
  opts?: { natureza?: string; coluna?: 'debito' | 'credito' | 'misto' },
): string {
  const t = String(raw ?? '').trim();
  if (!t) return '';
  const v = parseMoedaPtFromExtratoColuna(t.replace(/^[-−(]/, ''));
  if (v <= 0 && !/^0,\s*00/i.test(t.replace(/\s/g, ''))) return t;
  const nature = extratoNaturezaPorValorAssinadoNoToken(t, v);
  return formatExtratoValorAssinadoPt(v, nature);
}

/** Compatível com parseOcrMoneyValue mas com teto de extrato. */
export function parseExtratoMoneyValue(raw: string): number {
  if (extratoValorComNaturezaColada(raw)) {
    const linha = parseMoedaPtFromExtratoLinha(raw);
    if (linha > 0) return clampExtratoMoney(linha);
  }
  const v = parseMoedaPtFromExtratoColuna(raw);
  if (v > 0) return clampExtratoMoney(v);
  const linha = parseMoedaPtFromExtratoLinha(raw);
  if (linha > 0) return clampExtratoMoney(linha);
  const split = moedaFromTokenComDocumentoColado(String(raw ?? ''));
  if (split && split.value > 0) return clampExtratoMoney(split.value);
  return 0;
}
