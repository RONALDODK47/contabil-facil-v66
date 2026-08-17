import { format, isValid, parseISO } from 'date-fns';
import * as XLSX from 'xlsx';
import { excelFileToRows } from './excelSpreadsheet';
import { getOcrCustomReplacements } from './ocrCloudRulesStorage';

export type ParcelaPlanilhaRow = {
  n: number;
  date: Date;
  valor: number;
  juros: number;
  multa: number;
  /** Valor pago (coluna «Pagamento» no mapeamento OCR). */
  pagamento?: number;
  /** Encargos legais / moratórios (coluna opcional no OCR). */
  encargos: number;
  /** Honorários advocatícios (coluna opcional no OCR). */
  honorarios: number;
  contaDebito: string;
  contaCredito: string;
};

/** Juros = pagamento − parcela base (formulário), quando ambos > 0. */
export function jurosPorPagamentoMenosParcelaBase(pagamento: number, parcelaBase: number): number {
  if (!(pagamento > 0) || !(parcelaBase > 0)) return 0;
  return Math.max(0, Math.round((pagamento - parcelaBase) * 100) / 100);
}

export type ParcelamentoColunaImportId =
  | 'numero'
  | 'vencimento'
  | 'valor'
  | 'pagamento'
  | 'juros'
  | 'encargosHonorarios'
  | 'encargos'
  | 'honorarios'
  | 'multa';

export type CronogramaPlanilhaPayload = {
  /** Colunas marcadas no mapa OCR (só estas aparecem na prévia). */
  colunasMapeadas?: ParcelamentoColunaImportId[];
  linhas: Array<{
    n: number;
    data: string;
    valor: number;
    juros: number;
    multa: number;
    pagamento?: number;
    encargos?: number;
    honorarios?: number;
    contaDebito: string;
    contaCredito: string;
  }>;
};

export type ParcelamentoPlanilhaImport = {
  nomeParcelamento: string;
  clienteNome: string;
  numeroParcelamento: string;
  linhas: ParcelaPlanilhaRow[];
  colunasMapeadas?: ParcelamentoColunaImportId[];
  /** Se true, juros de cada linha = pagamento − parcela base do formulário. */
  calcularJurosPorPagamento?: boolean;
};

export interface OcrRule {
  from: string;
  to: string;
}

export const DEFAULT_OCR_REPLACEMENTS: OcrRule[] = [
  { from: 'O', to: '0' },
  { from: 'o', to: '0' },
  { from: 'Q', to: '9' },
  { from: 'g', to: '9' },
  { from: 'q', to: '9' },
  { from: 'l', to: '1' },
  { from: 'L', to: '1' },
  { from: 'i', to: '1' },
  { from: 'I', to: '1' },
  { from: '|', to: '1' },
  { from: 'S', to: '5' },
  { from: 's', to: '5' },
  { from: 'B', to: '8' },
  { from: 'Z', to: '2' },
  { from: 'z', to: '2' },
  { from: 'G', to: '6' },
  { from: 'T', to: '7' }
];

export const getOcrReplacements = (): OcrRule[] => {
  const saved = getOcrCustomReplacements();
  if (saved?.length) return saved;
  return DEFAULT_OCR_REPLACEMENTS;
};

/** Corrige confusões comuns do OCR em números e datas (não altera “R$” para não corromper moeda). */
export function normalizeOcrTexto(raw: string): string {
  let t = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .replace(/R\$\s*/gi, '');

  const rules = getOcrReplacements();
  for (const rule of rules) {
    if (rule.from) {
      const escapedFrom = rule.from.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(escapedFrom, 'g');
      t = t.replace(regex, rule.to || '');
    }
  }

  return t.trim();
}

/**
 * O Tesseract costuma partir valores BR em vários tokens («305» + «,43» ou «305» + «43»).
 * Sem isso o regex de moeda não encontra 305,43 enquanto 500,00 (lido junto) passa.
 */
export function prepararTextoOcrParaMoeda(raw: string): string {
  let t = normalizeOcrTexto(raw);
  // Milhar com espaço (OCR): «210 053 , 52» (antes da regra genérica de vírgula)
  t = t.replace(
    /\b((?:\d{3}[ \u00a0])+\d{3})\s*,\s*(\d{1,2})\b/g,
    (_, intPart, dec) => `${String(intPart).replace(/[ \u00a0]/g, '')},${dec}`,
  );
  // Cada dígito separado por espaço: «4 2 3 , 3 7»
  t = t.replace(
    /\b((?:\d[ \u00a0]){2,14}\d)\s*,\s*((?:\d[ \u00a0]){1,4}\d)\b/g,
    (match, intPart, decPart) => {
      const inteiro = String(intPart).replace(/[ \u00a0]/g, '');
      const dec = String(decPart).replace(/[ \u00a0]/g, '').slice(0, 2);
      if (!inteiro || inteiro.length > 12 || !dec) return match;
      const cents = dec.length === 1 ? `${dec}0` : dec;
      return `${inteiro},${cents}`;
    },
  );
  // Vírgula com espaços: «305 ,43» ou «305 , 43»
  t = t.replace(/(\d+)\s*,\s*(\d{1,2})\b/g, (_, inteiro, dec) => {
    const cents = dec.length === 1 ? `${dec}0` : dec.slice(0, 2);
    return `${inteiro},${cents}`;
  });
  // Centavos colados sem vírgula: «305 43» (só se parte inteira ≥ 3 dígitos — evita «12 03» de data)
  // Guardas: não pode ser o final de um número com milhar («9.903» → não vira «9.903,13» colando
  // com o token seguinte) nem o início de outro número maior («13.630,00» não pode virar «13» + resto).
  t = t.replace(/(?<!\.)\b(\d{3,})\s+(\d{2})(?!\.?\d)\b/g, '$1,$2');
  // Ponto no lugar da vírgula decimal (captura de tela): «305.43»
  t = t.replace(/\b(\d{1,11})\.(\d{2})\b/g, '$1,$2');
  return t;
}

/**
 * Teto (R$) para aceitar valor vindo do OCR numa linha de parcela — acima disso é quase sempre dígitos colados.
 * Parcelas corporativas muito altas: aumente se necessário.
 */
export const PARCELAMENTO_MOEDA_PLAUSIVEL_MAX = 500_000_000;

/**
 * Quantidade máxima de dígitos na parte inteira (antes da vírgula decimal) em formato BR.
 * Ex.: `5.202.231.052.022,00` tem 13 dígitos → rejeitado; `2.165,38` tem 4 → ok.
 */
export const PARCELAMENTO_MOEDA_DIGITOS_INTEIROS_MAX = 11;

/**
 * Formatos BR: 1.234,56 · 305,43 · 305 ,43 (vírgula separada pelo OCR).
 * Alternativa sem milhar: 1234,56 (4+ dígitos na parte inteira).
 */
const RE_MOEDA_BR_NO_TEXTO =
  /\d{1,3}(?:\.\d{3})*(?:,\s*\d{2}|\s*,\s*\d{2})|\d{1,11}\s*,\s*\d{2}|\d{4,}(?:,\s*\d{2}|\s*,\s*\d{2})/g;

function digitosInteirosAntesDaVirgulaMoedaBr(hit: string): number {
  const i = hit.lastIndexOf(',');
  if (i < 0) return 999;
  return hit.slice(0, i).replace(/\D/g, '').length;
}

/**
 * Extrai valor em R$ quando o OCR junta lixo ao número.
 * Usa o **primeiro** trecho em formato BR que seja plausível (não o maior — o maior era dígitos colados).
 */
function moedaHitPlausivel(h: string, maxVal: number, maxDig: number): number {
  const v = parseMoedaPt(h);
  const digs = digitosInteirosAntesDaVirgulaMoedaBr(h);
  if (v > 0 && v <= maxVal && digs <= maxDig) return v;
  return 0;
}

/** Primeiro trecho plausível (texto livre / linha inteira). */
export function parseMoedaPtFromOcrBlob(raw: string): number {
  const base = prepararTextoOcrParaMoeda(String(raw ?? ''));
  const hits = base.match(RE_MOEDA_BR_NO_TEXTO) ?? [];
  const maxVal = PARCELAMENTO_MOEDA_PLAUSIVEL_MAX;
  const maxDig = PARCELAMENTO_MOEDA_DIGITOS_INTEIROS_MAX;

  for (const h of hits) {
    const v = moedaHitPlausivel(h, maxVal, maxDig);
    if (v > 0) return v;
  }

  if (hits.length === 0) {
    const whole = parseMoedaPt(base);
    if (whole > 0 && whole <= maxVal) return whole;
  }
  return 0;
}

/**
 * Último trecho plausível — colunas numéricas costumam ser alinhadas à direita;
 * o primeiro match pegava valores de colunas vizinhas à esquerda (ex.: 5,00 em vez de 305,43).
 */
export function parseMoedaPtFromOcrColuna(raw: string): number {
  const base = prepararTextoOcrParaMoeda(String(raw ?? ''));
  const hits = base.match(RE_MOEDA_BR_NO_TEXTO) ?? [];
  const maxVal = PARCELAMENTO_MOEDA_PLAUSIVEL_MAX;
  const maxDig = PARCELAMENTO_MOEDA_DIGITOS_INTEIROS_MAX;

  let last = 0;
  for (const h of hits) {
    const v = moedaHitPlausivel(h, maxVal, maxDig);
    if (v > 0) last = v;
  }
  if (last > 0) return last;

  const whole = parseMoedaPt(base);
  if (whole > 0 && whole <= maxVal) return whole;
  return 0;
}

export function parseMoedaPt(raw: string): number {
  let t = normalizeOcrTexto(String(raw ?? '')).replace(/[^\d.,-]/g, '').trim();
  if (!t) return 0;
  const hasComma = t.includes(',');
  const hasDot = t.includes('.');
  if (hasComma && hasDot) {
    const lastComma = t.lastIndexOf(',');
    const lastDot = t.lastIndexOf('.');
    if (lastComma > lastDot) {
      t = t.replace(/\./g, '').replace(',', '.');
    } else {
      t = t.replace(/,/g, '');
    }
  } else if (hasComma) {
    const parts = t.split(',');
    if (parts.length === 2 && parts[1].length <= 2) {
      t = parts[0].replace(/\./g, '') + '.' + parts[1];
    } else {
      t = t.replace(/,/g, '');
    }
  } else if (hasDot) {
    const parts = t.split('.');
    if (parts.length === 2 && parts[1].length <= 2) {
      t = parts[0].replace(/,/g, '') + '.' + parts[1];
    } else {
      t = t.replace(/\./g, '');
    }
  }
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : 0;
}

export function parseDataFlexivel(raw: string, defaultYear?: number): Date | null {
  const t = normalizeOcrTexto(raw).replace(/\s/g, '').replace(/[^\d/.-]/g, (ch) => {
    if (ch === '/' || ch === '.' || ch === '-') return ch;
    return '';
  });
  if (!t) return null;
  const yearFallback = defaultYear ?? new Date().getFullYear();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const d = parseISO(t);
    return isValid(d) ? d : null;
  }
  const br4 = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (br4) {
    const d = new Date(Number(br4[3]), Number(br4[2]) - 1, Number(br4[1]));
    return isValid(d) ? d : null;
  }
  const br4dot = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (br4dot) {
    const d = new Date(Number(br4dot[3]), Number(br4dot[2]) - 1, Number(br4dot[1]));
    return isValid(d) ? d : null;
  }
  const br2 = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})$/);
  if (br2) {
    const yy = Number(br2[3]);
    const year = yy >= 70 ? 1900 + yy : 2000 + yy;
    const d = new Date(year, Number(br2[2]) - 1, Number(br2[1]));
    return isValid(d) ? d : null;
  }
  const brShort = t.match(/^(\d{1,2})[/.-](\d{1,2})$/);
  if (brShort) {
    const d = new Date(yearFallback, Number(brShort[2]) - 1, Number(brShort[1]));
    return isValid(d) ? d : null;
  }
  return null;
}

function normHeader(cell: string): string {
  return String(cell ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function findHeaderRowIndex(rows: string[][]): number {
  for (let i = 0; i < rows.length; i++) {
    const joined = rows[i].map(normHeader).join(' ');
    if (
      joined.includes('parcela') &&
      (joined.includes('vencimento') || joined.includes('valor'))
    ) {
      return i;
    }
  }
  return -1;
}

function colIndex(headers: string[], ...needles: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = normHeader(headers[i]);
    if (needles.every((n) => h.includes(n))) return i;
  }
  for (const needle of needles) {
    const idx = headers.findIndex((h) => normHeader(h).includes(needle));
    if (idx >= 0) return idx;
  }
  return -1;
}

function readCadastro(rows: string[][]): Pick<
  ParcelamentoPlanilhaImport,
  'nomeParcelamento' | 'clienteNome' | 'numeroParcelamento'
> {
  const out = { nomeParcelamento: '', clienteNome: '', numeroParcelamento: '' };
  for (const row of rows.slice(0, 12)) {
    if (row.length < 2) continue;
    const label = normHeader(row[0]);
    const val = String(row[1] ?? '').trim();
    if (!val || val.toLowerCase().startsWith('ex.:')) continue;
    if (label.includes('nome') && label.includes('parcelamento')) out.nomeParcelamento = val;
    else if (label === 'cliente' || label.startsWith('cliente ')) out.clienteNome = val;
    else if (label.includes('parcelamento') && label.includes('n')) out.numeroParcelamento = val;
  }
  return out;
}

export function serializeCronogramaPlanilha(
  linhas: ParcelaPlanilhaRow[],
  meta?: { colunasMapeadas?: ParcelamentoColunaImportId[] }
): string {
  const payload: CronogramaPlanilhaPayload = {
    colunasMapeadas: meta?.colunasMapeadas?.length ? meta.colunasMapeadas : undefined,
    linhas: linhas.map((r) => ({
      n: r.n,
      data: format(r.date, 'yyyy-MM-dd'),
      valor: Math.round(r.valor * 100) / 100,
      juros: Number.isFinite(r.juros) ? Math.round(r.juros * 100) / 100 : 0,
      multa: Math.round(r.multa * 100) / 100,
      pagamento:
        r.pagamento != null && Number.isFinite(r.pagamento) && r.pagamento > 0
          ? Math.round(r.pagamento * 100) / 100
          : undefined,
      encargos: Math.round((r.encargos ?? 0) * 100) / 100,
      honorarios: Math.round((r.honorarios ?? 0) * 100) / 100,
      contaDebito: r.contaDebito,
      contaCredito: r.contaCredito,
    })),
  };
  return JSON.stringify(payload);
}

export function parseCronogramaPlanilhaPayload(raw: string | undefined): {
  linhas: ParcelaPlanilhaRow[];
  colunasMapeadas: ParcelamentoColunaImportId[];
} {
  if (!raw?.trim()) return { linhas: [], colunasMapeadas: [] };
  try {
    const parsed = JSON.parse(raw) as CronogramaPlanilhaPayload;
    if (!parsed?.linhas || !Array.isArray(parsed.linhas)) {
      return { linhas: [], colunasMapeadas: parsed?.colunasMapeadas ?? [] };
    }
    const out: ParcelaPlanilhaRow[] = [];
    for (const row of parsed.linhas) {
      const d = parseDataFlexivel(row.data);
      const pag = Number(row.pagamento) || 0;
      const jurosN = Number(row.juros) || 0;
      const multaN = Number(row.multa) || 0;
      const encN = Number(row.encargos) || 0;
      const honN = Number(row.honorarios) || 0;
      const temValor =
        row.valor > 0 || pag > 0 || jurosN > 0 || multaN > 0 || encN > 0 || honN > 0;
      if (!d && !temValor) continue;
      if (!d) continue;
      if (!temValor) continue;
      out.push({
        n: Math.floor(Number(row.n)) || out.length + 1,
        date: d,
        valor: Number(row.valor) || 0,
        juros: Number.isFinite(Number(row.juros)) ? Number(row.juros) || 0 : 0,
        multa: Number(row.multa) || 0,
        pagamento: Number(row.pagamento) > 0 ? Number(row.pagamento) : undefined,
        encargos: Number(row.encargos) || 0,
        honorarios: Number(row.honorarios) || 0,
        contaDebito: String(row.contaDebito ?? '').trim(),
        contaCredito: String(row.contaCredito ?? '').trim(),
      });
    }
    return {
      linhas: out.sort((a, b) => a.n - b.n || a.date.getTime() - b.date.getTime()),
      colunasMapeadas: Array.isArray(parsed.colunasMapeadas) ? parsed.colunasMapeadas : [],
    };
  } catch {
    return { linhas: [], colunasMapeadas: [] };
  }
}

export function parseCronogramaPlanilhaJson(raw: string | undefined): ParcelaPlanilhaRow[] {
  return parseCronogramaPlanilhaPayload(raw).linhas;
}

/** Prévia/tabela: com mapeamento OCR explícito, só colunas marcadas; senão, inferência pelos dados (legado). */
export function colunaCronogramaImportVisivel(
  id: ParcelamentoColunaImportId,
  mapeadas: ParcelamentoColunaImportId[],
  linhas: ParcelaPlanilhaRow[]
): boolean {
  if (mapeadas.length > 0) return mapeadas.includes(id);
  switch (id) {
    case 'valor':
      return linhas.some((r) => r.valor > 0);
    case 'pagamento':
      return linhas.some((r) => (r.pagamento ?? 0) > 0);
    case 'juros':
      return linhas.some((r) => r.juros > 0);
    case 'multa':
      return linhas.some((r) => r.multa > 0);
    case 'encargos':
      return linhas.some((r) => (r.encargos ?? 0) > 0);
    case 'honorarios':
      return linhas.some((r) => (r.honorarios ?? 0) > 0);
    case 'encargosHonorarios':
      return linhas.some((r) => (r.encargos ?? 0) > 0 || (r.honorarios ?? 0) > 0);
    case 'vencimento':
      return linhas.length > 0;
    case 'numero':
      return linhas.some((r) => r.n > 0);
    default:
      return false;
  }
}

export function parcelaPlanilhaToLinhasCronograma(linhas: ParcelaPlanilhaRow[]) {
  return linhas.map((r) => {
    const jurosN = Number.isFinite(r.juros) ? r.juros : 0;
    const encN = Number.isFinite(r.encargos ?? NaN) ? (r.encargos ?? 0) : 0;
    const honN = Number.isFinite(r.honorarios ?? NaN) ? (r.honorarios ?? 0) : 0;
    return {
    n: r.n,
    date: r.date,
    valor: r.valor,
    pagamento: r.pagamento != null && r.pagamento > 0 ? Math.round(r.pagamento * 100) / 100 : undefined,
    jurosImportado: Math.round(jurosN * 100) / 100,
    jurosPlanilha: Math.round((jurosN + encN + honN) * 100) / 100,
    multa: r.multa,
    encargos: r.encargos ?? 0,
    honorarios: r.honorarios ?? 0,
    contaDebito: r.contaDebito,
    contaCredito: r.contaCredito,
  };
  });
}

export function downloadParcelamentoPlanilhaModelo(): void {
  const wsData: (string | number)[][] = [
    ['Cadastro do parcelamento — preencha a coluna B'],
    ['Nome parcelamento', 'Ex.: Refinanciamento equipamentos'],
    ['Cliente', 'Ex.: Empresa ABC Ltda'],
    ['Nº parcelamento', 'Ex.: PARC-2026-01'],
    [],
    [
      'Nº parcela',
      'Vencimento (DD/MM/AAAA)',
      'Valor parcela (R$)',
      'Juros (R$)',
      'Encargos (R$)',
      'Honorários (R$)',
      'Multa (R$)',
      'Conta débito',
      'Conta crédito',
    ],
    [1, '01/03/2026', '1500,00', '75,00', '10,00', '0,00', '0,00', '123456', '654321'],
    [2, '01/04/2026', '1500,00', '75,00', '10,00', '25,00', '0,00', '123456', '654321'],
    [3, '01/05/2026', '1500,00', '75,00', '10,00', '0,00', '0,00', '123456', '654321'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [
    { wch: 14 },
    { wch: 24 },
    { wch: 18 },
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Cronograma');
  XLSX.writeFile(wb, `parcelamento_modelo_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
}

/** Exporta a pré-visualização mensal (mesmas colunas visíveis na tela) para Excel. */
export function downloadParcelamentoPreviaTabelaXlsx(
  filenameBase: string,
  sheetRows: (string | number)[][]
): void {
  if (sheetRows.length < 2) {
    throw new Error('Não há linhas para exportar.');
  }
  const ws = XLSX.utils.aoa_to_sheet(sheetRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Prévia mensal');
  const base = filenameBase.trim() || 'parcelamento';
  XLSX.writeFile(wb, `${base}_previa_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
}

export function moedaBrCelula(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
}

/** Converte linhas tabulares (planilha, PDF ou OCR) em cronograma de parcelamento. */
export function parseParcelamentoTableRows(rows: string[][]): ParcelamentoPlanilhaImport {
  if (rows.length === 0) throw new Error('Nenhum dado tabular encontrado.');

  const cadastro = readCadastro(rows);
  const headerIdx = findHeaderRowIndex(rows);

  if (headerIdx >= 0) {
    const headers = rows[headerIdx];
    const iN = colIndex(headers, 'parcela');
    const iVenc = colIndex(headers, 'vencimento');
    const iValor = colIndex(headers, 'valor');
    const iJuros = colIndex(headers, 'juros');
    const iEncargos = colIndex(headers, 'encargo');
    const iHonorarios = colIndex(headers, 'honor');
    const iMulta = colIndex(headers, 'multa');
    const iDeb = colIndex(headers, 'debito');
    const iCred = colIndex(headers, 'credito');

    if (iN < 0 || iVenc < 0 || iValor < 0) {
      throw new Error('Colunas obrigatórias ausentes: Nº parcela, Vencimento e Valor parcela.');
    }

    const linhas: ParcelaPlanilhaRow[] = [];
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row?.length) continue;
      const parsed = parseParcelaFromCells(row, {
        iN,
        iVenc,
        iValor,
        iJuros,
        iEncargos,
        iHonorarios,
        iMulta,
        iDeb,
        iCred,
      });
      if (parsed) linhas.push(parsed);
    }

    if (linhas.length > 0) {
      linhas.sort((a, b) => a.n - b.n || a.date.getTime() - b.date.getTime());
      return { ...cadastro, linhas };
    }
  }

  const linhasLivres = parseParcelamentoRowsHeuristic(rows);
  if (linhasLivres.length === 0) {
    throw new Error(
      'Não foi possível identificar parcelas. Confira se o documento traz: nº da parcela, vencimento, valor, juros, multa e contas.'
    );
  }
  return { ...cadastro, linhas: linhasLivres };
}

function parseParcelaFromCells(
  row: string[],
  cols: {
    iN: number;
    iVenc: number;
    iValor: number;
    iJuros: number;
    iEncargos: number;
    iHonorarios: number;
    iMulta: number;
    iDeb: number;
    iCred: number;
  }
): ParcelaPlanilhaRow | null {
  const nRaw = String(row[cols.iN] ?? '').replace(/\D/g, '');
  if (!nRaw) return null;
  const n = parseInt(nRaw, 10);
  if (!Number.isFinite(n) || n < 1) return null;

  const date = parseDataFlexivel(String(row[cols.iVenc] ?? ''));
  if (!date) return null;

  const valor = parseMoedaPt(String(row[cols.iValor] ?? ''));
  if (!(valor > 0)) return null;

  return {
    n,
    date,
    valor,
    juros: cols.iJuros >= 0 ? parseMoedaPt(String(row[cols.iJuros] ?? '')) : 0,
    encargos: cols.iEncargos >= 0 ? parseMoedaPt(String(row[cols.iEncargos] ?? '')) : 0,
    honorarios: cols.iHonorarios >= 0 ? parseMoedaPt(String(row[cols.iHonorarios] ?? '')) : 0,
    multa: cols.iMulta >= 0 ? parseMoedaPt(String(row[cols.iMulta] ?? '')) : 0,
    contaDebito: cols.iDeb >= 0 ? String(row[cols.iDeb] ?? '').replace(/\D/g, '') : '',
    contaCredito: cols.iCred >= 0 ? String(row[cols.iCred] ?? '').replace(/\D/g, '') : '',
  };
}

function parseParcelamentoRowsHeuristic(rows: string[][]): ParcelaPlanilhaRow[] {
  const out: ParcelaPlanilhaRow[] = [];
  for (const row of rows) {
    const line = row.join(' ').trim();
    if (!line) continue;
    const parsed = parseParcelaFromOcrLine(line);
    if (parsed) out.push(parsed);
  }
  out.sort((a, b) => a.n - b.n || a.date.getTime() - b.date.getTime());
  return out;
}

/** Uma linha de texto OCR: nº + data + valores + contas opcionais. */
export function parseParcelaFromOcrLine(line: string): ParcelaPlanilhaRow | null {
  const t = line.replace(/\s+/g, ' ').trim();
  const dateMatch = t.match(/(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/);
  if (!dateMatch) return null;
  const date = parseDataFlexivel(dateMatch[1]);
  if (!date) return null;

  const before = t.slice(0, dateMatch.index ?? 0);
  const after = t.slice((dateMatch.index ?? 0) + dateMatch[1].length);
  const nMatch = before.match(/(\d{1,3})\s*$/);
  const n = nMatch ? parseInt(nMatch[1], 10) : 1;
  if (!Number.isFinite(n) || n < 1) return null;

  const moneyParts = after.match(/[\d]{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2}/g) ?? [];
  const accounts = after.match(/\b\d{4,12}\b/g) ?? [];

  const valor = moneyParts[0] ? parseMoedaPt(moneyParts[0]) : 0;
  if (!(valor > 0)) return null;

  const mp = moneyParts.map((m) => parseMoedaPt(m));
  let juros = 0;
  let encargos = 0;
  let honorarios = 0;
  let multa = 0;
  if (mp.length >= 2) juros = mp[1];
  if (mp.length === 3) multa = mp[2];
  else if (mp.length === 4) {
    encargos = mp[2];
    multa = mp[3];
  } else if (mp.length >= 5) {
    encargos = mp[2];
    honorarios = mp[3];
    multa = mp[4];
  }

  return {
    n,
    date,
    valor,
    juros,
    encargos,
    honorarios,
    multa,
    contaDebito: accounts[0] ?? '',
    contaCredito: accounts[1] ?? '',
  };
}

export function readCadastroFromText(text: string): Pick<
  ParcelamentoPlanilhaImport,
  'nomeParcelamento' | 'clienteNome' | 'numeroParcelamento'
> {
  const out = { nomeParcelamento: '', clienteNome: '', numeroParcelamento: '' };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const mNome = line.match(/nome\s*(?:do\s*)?parcelamento\s*[:=-]?\s*(.+)/i);
    const mCliente = line.match(/cliente\s*[:=-]?\s*(.+)/i);
    const mNum = line.match(/n[ºo°]?\s*(?:do\s*)?parcelamento\s*[:=-]?\s*(.+)/i);
    if (mNome) out.nomeParcelamento = mNome[1].trim();
    if (mCliente && !mCliente[1].toLowerCase().includes('nome')) out.clienteNome = mCliente[1].trim();
    if (mNum) out.numeroParcelamento = mNum[1].trim();
  }
  return out;
}

export async function importParcelamentoPlanilhaFile(file: File): Promise<ParcelamentoPlanilhaImport> {
  const rows = await excelFileToRows(file);
  if (rows.length === 0) throw new Error('Planilha vazia ou ilegível.');
  return parseParcelamentoTableRows(rows);
}
