import { ExtratoLine, BankStatementMetadata } from './types';
import type { PdfWord } from './pdfExtractor';

// ─── Posicionamento tolerante (comum a todos os parsers por coordenada) ────
// Regra geral destes parsers: variação pequena dentro do mesmo layout (linha
// mais alta porque o histórico quebrou, coluna deslocada alguns pontos,
// baseline com jitter de frações de ponto, data com ou sem hora) NUNCA pode
// fazer um lançamento ser descartado. As funções abaixo concentram essa
// tolerância, para que nenhum parser precise de constantes de altura de linha
// calibradas PDF a PDF.

/** Data DD/MM/AAAA, opcionalmente seguida da hora (colada ou com traço). */
const DATA_COM_HORA_OPCIONAL_RE =
  /^(\d{2}\/\d{2}\/\d{4})(?:\s*-?\s*\d{2}:\d{2}(?::\d{2})?)?$/;

/** Hora isolada em item próprio, com ou sem os segundos. */
const HORA_ISOLADA_RE = /^-?\s*\d{2}:\d{2}(?::\d{2})?$/;

/**
 * Extrai só a data (DD/MM/AAAA) de um item que pode trazer a hora junto.
 * Devolve null se o item não começar por uma data.
 */
function soData(raw: string): string | null {
  const m = DATA_COM_HORA_OPCIONAL_RE.exec(raw.trim());
  return m ? m[1] : null;
}

/**
 * Agrupa as palavras da página em FAIXAS verticais, uma por âncora (em geral
 * a data do lançamento). Cada faixa vai do meio do caminho até a âncora de
 * cima ao meio do caminho até a de baixo, de modo que acompanha a altura real
 * da linha: um lançamento de uma linha e outro de quatro linhas são lidos do
 * mesmo jeito, sem tolerância fixa para calibrar.
 *
 * `maxY` corta tudo acima do cabeçalho da tabela (quando a página tem um).
 */
function bandWordsByAnchors<A extends { y0: number }>(
  words: PdfWord[],
  anchors: A[],
  opts: { defaultPitch?: number; maxY?: number } = {}
): Array<{ anchor: A; words: PdfWord[] }> {
  if (anchors.length === 0) return [];

  const ordered = [...anchors].sort((a, b) => b.y0 - a.y0); // topo → rodapé
  const maxY = opts.maxY ?? Infinity;

  // Espaçamento típico entre lançamentos na página (mediana), usado só para
  // dar meia-linha de folga acima do primeiro e abaixo do último.
  const gaps: number[] = [];
  for (let i = 1; i < ordered.length; i++) gaps.push(ordered[i - 1].y0 - ordered[i].y0);
  gaps.sort((a, b) => a - b);
  const pitch = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : (opts.defaultPitch ?? 20);

  const top: number[] = [];
  const bottom: number[] = [];
  for (let i = 0; i < ordered.length; i++) {
    top[i] = i === 0 ? ordered[0].y0 + pitch / 2 : (ordered[i - 1].y0 + ordered[i].y0) / 2;
    bottom[i] =
      i === ordered.length - 1
        ? ordered[i].y0 - pitch / 2
        : (ordered[i].y0 + ordered[i + 1].y0) / 2;
  }

  const result = ordered.map((anchor) => ({ anchor, words: [] as PdfWord[] }));
  for (const w of words) {
    if (w.y0 > maxY) continue;
    for (let i = 0; i < ordered.length; i++) {
      if (w.y0 <= top[i] && w.y0 > bottom[i]) {
        result[i].words.push(w);
        break;
      }
    }
  }
  return result;
}

/**
 * Ordena as palavras de um lançamento em ordem de leitura: linha de cima
 * primeiro, e dentro da mesma linha visual da esquerda para a direita. O
 * agrupamento por proximidade (e não por Y exato) evita inverter palavras da
 * mesma linha quando o baseline varia por frações de ponto.
 */
function sortWordsReadingOrder(words: PdfWord[], sameLineGap = 3): PdfWord[] {
  return [...words].sort((a, b) =>
    Math.abs(a.y0 - b.y0) > sameLineGap ? b.y0 - a.y0 : a.x0 - b.x0
  );
}

/**
 * Agrupa as palavras em linhas visuais por proximidade em Y, em vez de
 * arredondar o Y para uma grade fixa. Arredondar quebra a linha em duas
 * quando duas palavras caem em lados opostos da fronteira do "balde"
 * (ex.: y=100,9 e y=101,1); agrupar por distância não tem essa fronteira.
 */
function clusterWordsIntoRows(words: PdfWord[], maxGap = 3): PdfWord[][] {
  const sorted = [...words].sort((a, b) => b.y0 - a.y0);
  const rows: PdfWord[][] = [];
  let current: PdfWord[] = [];
  let refY = Infinity;

  for (const w of sorted) {
    if (current.length === 0) {
      current.push(w);
      refY = w.y0;
    } else if (Math.abs(refY - w.y0) <= maxGap) {
      current.push(w);
    } else {
      rows.push(current);
      current = [w];
      refY = w.y0;
    }
  }
  if (current.length > 0) rows.push(current);

  return rows.map((row) => [...row].sort((a, b) => a.x0 - b.x0));
}

const DATE_TOKEN_RE = /\b(\d{2})\/(\d{2})\/(\d{4})\b/g;
const MONEY_RE = /-?\d{1,3}(?:\.\d{3})*,\d{2}/;
const CNPJ_RE = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g;
const CPF_RE = /\d{3}\.\d{3}\.\d{3}-\d{2}/g;

// Trechos de rodapé/disclaimer que às vezes ficam próximos de uma data e viram
// "transações fantasmas" no agrupamento por data — descartar o trecho inteiro.
const NOISE_CHUNK_PATTERNS = [
  /transa[cç][ãa]o\s+efetivada/i,
  /emitido\s+em/i,
  /p[áa]gina\s+\d+\s*(de|\/ )\s*\d+/i,
  /extrato\s+emitido/i,
  /sac\s+0800/i,
  /ouvidoria/i,
  /saldo\s+final/i,
  /saldo\s+total\s+dispon[íi]vel/i,
  /saldo\b/i,
  /valor\s*\$/i,
  /cliente/i,
  /conta\s+atual/i,
  /ag[eê]ncia/i,
  /conta\s+corrente/i,
  /per[ií]odo\s+do\s+extrato/i,
  /lan[cç]amentos/i,
  /dt\.\s*balancete/i,
  /dt\.\s*movimento/i,
  /ag\.?\s*origem/i,
  /lote/i,
  /hist[ôó]rico/i,
  /documento/i,
];

function isNoiseChunk(raw: string): boolean {
  return NOISE_CHUNK_PATTERNS.some((re) => re.test(raw));
}

function removeConsecutiveDuplicateWords(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    if (out.length && out[out.length - 1].toLowerCase() === w.toLowerCase()) continue;
    out.push(w);
  }
  return out.join(' ');
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

// Remove uma frase final que já apareceu antes na mesma descrição — comum quando
// a quebra de linha do PDF repete uma versão abreviada do texto (ex.: "BB Rende
// Fácil 9.903 Rende Facil" → "BB Rende Fácil 9.903").
function removeTrailingDuplicatePhrase(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  const maxPhrase = Math.min(4, Math.floor(words.length / 2));
  for (let phraseLen = maxPhrase; phraseLen >= 1; phraseLen--) {
    const tail = stripAccents(words.slice(-phraseLen).join(' ')).toLowerCase();
    const head = stripAccents(words.slice(0, -phraseLen).join(' ')).toLowerCase();
    if (tail && head.includes(tail)) {
      return words.slice(0, -phraseLen).join(' ');
    }
  }
  return text;
}

function parseAmountBr(raw: string): number {
  const negative = raw.trim().startsWith('-');
  const cleaned = raw.replace(/[^\d,]/g, '').replace(',', '.');
  const val = parseFloat(cleaned) || 0;
  return negative ? -Math.abs(val) : val;
}

// Valor R$ tolerante à extração perder a pontuação decimal — alguns PDFs
// (confirmado no Santander, mas o mesmo gerador/quirk pode aparecer em
// qualquer banco) entregam um valor sem vírgula/ponto nenhum, ex.: "726662"
// em vez de "7.266,62". Usado só como ÚLTIMO RECURSO quando a busca padrão
// (que exige vírgula decimal) não encontra nada no trecho — nunca substitui
// um valor já encontrado corretamente, então não pode piorar um caso que já
// funcionava, só recuperar um que antes era descartado em silêncio.
function parseMoneyBrLoose(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const neg = s.startsWith('-');

  if (s.includes(',')) {
    const v = parseFloat(s.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(v) ? v : null;
  }

  const digits = s.replace(/[^0-9]/g, '');
  if (digits.length < 3 || digits.length > 9) return null; // fora da faixa plausível de um valor monetário
  const cents = digits.slice(-2);
  const intPart = digits.slice(0, -2) || '0';
  const v = parseFloat(`${intPart}.${cents}`);
  if (!Number.isFinite(v)) return null;
  return neg ? -Math.abs(v) : v;
}

// Último token de dígitos "soltos" (sem vírgula) perto do fim do trecho —
// candidato a valor monetário que perdeu a pontuação na extração. Ignora
// tokens colados a barra/traço de data (ex.: "2026") e datas completas.
function findTrailingLooseMoneyToken(chunk: string): string | null {
  const tokens = chunk.match(/-?\d{3,9}(?!\d)/g);
  if (!tokens) return null;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (/^\d{4}$/.test(t.replace('-', '')) && chunk.includes(`/${t}`)) continue; // ano de data
    return t;
  }
  return null;
}

function cleanDescription(raw: string): string {
  let d = raw;
  d = d.replace(CNPJ_RE, ' ');
  d = d.replace(CPF_RE, ' ');
  d = d.replace(/-?\d{1,3}(?:\.\d{3})*,\d{2}/g, ' ');
  d = d.replace(/\b\d[\d.]{5,}\b/g, ' '); // documento/numero longo (ex.: 613.659.000.068.496)
  d = d.replace(/\bR\$\b/gi, ' ');
  d = d.replace(/-{2,}/g, ' '); // separadores "----"
  d = d.replace(/\.{2,}/g, ' '); // separadores "...."
  d = d.replace(/^(?:\d+\s+)+/, ''); // códigos numéricos no início (agência/lote)
  d = d.replace(/\b(C|D)\b/g, ' '); // remover apenas letras isoladas C ou D (crédito/débito)
  d = removeConsecutiveDuplicateWords(d);
  d = d.replace(/\s+/g, ' ').trim();
  d = removeTrailingDuplicatePhrase(d);
  return d;
}

/**
 * Extrai lançamentos agrupando o texto por trechos entre uma data e a próxima.
 * Funciona bem para extratos onde cada linha começa com "DD/MM/AAAA" seguido
 * da descrição e do valor (formato comum a BB e Itaú).
 */
function extractByDateChunks(
  text: string,
  opts: { signFromSuffix?: boolean } = {}
): ExtratoLine[] {
  const matches: { index: number; date: string }[] = [];
  const re = new RegExp(DATE_TOKEN_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    matches.push({ index: m.index, date: `${m[3]}-${m[2]}-${m[1]}` });
  }

  const lines: ExtratoLine[] = [];

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const chunk = text.slice(start, end);
    if (isNoiseChunk(chunk)) continue;
    const afterDate = chunk.replace(/^\s*\d{2}\/\d{2}\/\d{4}\s*/, '');

    const moneyMatch = afterDate.match(MONEY_RE);

    // Sem vírgula decimal encontrada — antes de descartar o lançamento
    // inteiro, tenta recuperar um valor que perdeu a pontuação na extração
    // (ver parseMoneyBrLoose). Só entra em ação quando o formato padrão
    // falhou, então nunca substitui um valor já corretamente identificado.
    if (!moneyMatch) {
      const looseToken = findTrailingLooseMoneyToken(afterDate);
      const looseAmount = looseToken ? parseMoneyBrLoose(looseToken) : null;
      if (looseToken == null || looseAmount === null) continue;

      const description = cleanDescription(afterDate.replace(looseToken, ' '));
      if (!description || description.length < 2) continue;

      lines.push({
        date: matches[i].date,
        description,
        amount: looseAmount,
        raw: chunk.trim(),
      });
      continue;
    }

    let amount = parseAmountBr(moneyMatch[0]);
    let rest = afterDate;

    if (opts.signFromSuffix) {
      const idx = afterDate.indexOf(moneyMatch[0]);
      const tailStart = idx + moneyMatch[0].length;
      const tail = afterDate.slice(tailStart, tailStart + 4);
      const signMatch = tail.match(/^\s*([CD])\b/);
      if (signMatch) {
        amount = signMatch[1] === 'D' ? -Math.abs(amount) : Math.abs(amount);
        rest = rest.slice(0, tailStart) + tail.replace(signMatch[0], ' ') + rest.slice(tailStart + tail.length);
      }
    }

    const description = cleanDescription(rest.replace(moneyMatch[0], ' '));
    if (!description || description.length < 2) continue;

    lines.push({
      date: matches[i].date,
      description,
      amount,
      raw: chunk.trim(),
    });
  }

  return lines;
}

// ─── Banco do Brasil ────────────────────────────────────────────────────────

function extractBBMetadata(text: string): BankStatementMetadata | null {
  const agMatch = text.match(/Ag[êe]ncia\s+([\d\-]+)/i);
  const contaMatch = text.match(/Conta\s+corrente\s+([\d\-]+)/i);
  const periodoMatch = text.match(/Per[íi]odo do extrato\s+(\d{2})\s*\/\s*(\d{4})/i);

  return {
    bank_name: 'Banco do Brasil',
    account_number: contaMatch
      ? `${agMatch ? agMatch[1] + ' / ' : ''}${contaMatch[1]}`
      : '000000-0',
    period: periodoMatch ? `${periodoMatch[1]}/${periodoMatch[2]}` : '01/2026',
  };
}

export function parseBancoDoBrasilText(text: string): {
  transactions: ExtratoLine[];
  metadata: BankStatementMetadata | null;
} {
  // "Saldo Anterior" não é uma movimentação — já existe um campo dedicado
  // na interface para o usuário informar o saldo anterior.
  const transactions = extractByDateChunks(text, { signFromSuffix: true }).filter(
    (t) => !/^saldo\s+anterior$/i.test((t.description ?? '').trim())
  );
  const metadata = extractBBMetadata(text);
  return { transactions, metadata };
}

// ─── Itaú ───────────────────────────────────────────────────────────────────

function extractItauMetadata(text: string): BankStatementMetadata | null {
  const agMatch = text.match(/Ag[êe]ncia\s+(\d+)/i);
  const contaMatch = text.match(/Conta\s+([\d\-]+)/i);
  const periodoMatch = text.match(/(\d{2}\/\d{2}\/\d{4})\s+at[ée]\s+(\d{2})\/(\d{2})\/(\d{4})/i);

  return {
    bank_name: 'Itaú',
    account_number: contaMatch
      ? `${agMatch ? agMatch[1] + ' / ' : ''}${contaMatch[1]}`
      : '000000-0',
    period: periodoMatch ? `${periodoMatch[3]}/${periodoMatch[4]}` : '01/2026',
  };
}

export function parseItauText(text: string): {
  transactions: ExtratoLine[];
  metadata: BankStatementMetadata | null;
} {
  const transactions = extractByDateChunks(text, { signFromSuffix: false }).filter((t) => {
    const d = (t.description ?? '').trim();
    return !/^SALDO TOTAL DISPON/i.test(d) && !/^saldo\s+anterior$/i.test(d);
  });
  const metadata = extractItauMetadata(text);
  return { transactions, metadata };
}

// ─── Sicredi ────────────────────────────────────────────────────────────────
// Layout de largura fixa: DATA | DOCUMENTO | HISTORICO | DEBITO | CREDITO | SALDO.
// Débito/crédito não têm sinal no texto — a natureza do lançamento só dá pra
// saber pela posição X da coluna, por isso usamos as palavras com coordenadas
// (extractWordsFromPDFFile) em vez do texto puro.

const SICREDI_DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;
const SICREDI_MONEY_RE = /^\d{1,3}(?:\.\d{3})*,\d{2}$/;
const SICREDI_COL_DEBITO = 390;
const SICREDI_COL_CREDITO = 470;
const SICREDI_COL_SALDO = 556;

function sicrediParseAmount(raw: string): number {
  return parseFloat(raw.replace(/\./g, '').replace(',', '.')) || 0;
}

function sicrediNearestColumn(x0: number): 'debito' | 'credito' | 'saldo' {
  const dDebito = Math.abs(x0 - SICREDI_COL_DEBITO);
  const dCredito = Math.abs(x0 - SICREDI_COL_CREDITO);
  const dSaldo = Math.abs(x0 - SICREDI_COL_SALDO);
  if (dDebito <= dCredito && dDebito <= dSaldo) return 'debito';
  if (dCredito <= dSaldo) return 'credito';
  return 'saldo';
}

function extractSicrediMetadata(pages: PdfWord[][]): BankStatementMetadata | null {
  const allWords = pages.flat();
  const joined = allWords.map((w) => w.str).join(' ');

  const contaMatch = joined.match(/\b(\d{6,9}-\d)\b/);
  const periodoMatch = joined.match(/PERIODO:\s*DE\s*(\d{2})\/(\d{4})/i);

  return {
    bank_name: 'Sicredi',
    account_number: contaMatch ? contaMatch[1] : '000000-0',
    period: periodoMatch ? `${periodoMatch[1]}/${periodoMatch[2]}` : '01/2026',
  };
}

export function parseSicrediWords(pages: PdfWord[][]): {
  transactions: ExtratoLine[];
  metadata: BankStatementMetadata | null;
} {
  const transactions: ExtratoLine[] = [];

  for (const words of pages) {
    // Agrupa por linha: mesmo y0 (com pequena tolerância de arredondamento).
    const rows = new Map<string, PdfWord[]>();
    for (const w of words) {
      const key = (Math.round(w.y0 * 4) / 4).toFixed(2);
      const arr = rows.get(key) ?? [];
      arr.push(w);
      rows.set(key, arr);
    }

    for (const rowWords of rows.values()) {
      const sorted = [...rowWords].sort((a, b) => a.x0 - b.x0);
      const first = sorted[0]?.str ?? '';

      if (/^=+$/.test(first)) continue; // linha separadora
      const joined = sorted.map((w) => w.str).join(' ');
      if (joined.includes('DATA') && joined.includes('HISTORICO')) continue; // cabeçalho

      const isPlaceholderDate = first === '**/**/****';
      if (!SICREDI_DATE_RE.test(first) && !isPlaceholderDate) continue;

      const documento = sorted[1]?.str ?? '';
      if (documento === '*********') continue; // Saldo Anterior / Saldo Transportado

      if (isPlaceholderDate) continue;

      const [dd, mm, yyyy] = first.split('/');
      const isoDate = `${yyyy}-${mm}-${dd}`;

      const descWords: string[] = [];
      let debito: number | null = null;
      let credito: number | null = null;

      // Zona das colunas de valor (Débito/Crédito/Saldo) — usada só para o
      // fallback abaixo, quando a extração perde a pontuação decimal e o
      // texto vira dígitos soltos (ex.: "12345" em vez de "123,45"). Fora
      // dessa faixa, um número solto é Documento/Histórico, não valor.
      const SICREDI_VALOR_COL_MIN = Math.min(SICREDI_COL_DEBITO, SICREDI_COL_CREDITO) - 60;

      for (const w of sorted.slice(2)) {
        const isStrictMoney = SICREDI_MONEY_RE.test(w.str);
        const isLooseMoney =
          !isStrictMoney && w.x0 >= SICREDI_VALOR_COL_MIN && /^\d{3,9}$/.test(w.str.trim());

        if (isStrictMoney || isLooseMoney) {
          const col = sicrediNearestColumn(w.x0);
          const amount = isStrictMoney ? sicrediParseAmount(w.str) : parseMoneyBrLoose(w.str);
          if (amount === null) {
            descWords.push(w.str);
            continue;
          }
          if (col === 'debito') debito = amount;
          else if (col === 'credito') credito = amount;
          // saldo: informativo, não usado no valor do lançamento
        } else {
          descWords.push(w.str);
        }
      }

      const description = descWords.join(' ').trim();
      if (!description) continue;

      const amount = credito !== null ? credito : debito !== null ? -debito : null;
      if (amount === null) continue;

      transactions.push({ date: isoDate, description, amount, raw: joined });
    }
  }

  const metadata = extractSicrediMetadata(pages);
  return { transactions, metadata };
}

// ─── Caixa Econômica Federal ───────────────────────────────────────────────
// "Extrato por período" (internet banking pessoa jurídica). O pdf.js entrega
// as palavras da tabela em ORDEM DE COLUNA (todo o bloco Data/Doc/Histórico
// de todos os lançamentos, depois todo o bloco Favorecido/CPF/Valor/Saldo),
// não em ordem de leitura por linha — por isso um parser de texto puro
// embaralharia os lançamentos. Cada lançamento tem sua própria palavra de
// data (mesmo quando duas linhas — ex.: "TAR PIX" e "DEB PIX CHAVE" —
// compartilham o mesmo horário), então usamos essa palavra como âncora.
//
// O mesmo layout aparece com variações pequenas de PDF para PDF (data com ou
// sem hora, hora colada ou em item separado, histórico em uma ou várias
// linhas, colunas deslocadas alguns pontos). Nenhuma dessas variações pode
// impedir a extração, então em vez de exigir posições exatas o parser
// trabalha por FAIXA: cada âncora fica com toda a faixa vertical que vai até
// a metade do caminho para a âncora vizinha — assim um lançamento com 1 ou
// com 4 linhas de histórico é lido do mesmo jeito — e as colunas são
// contíguas (sem vãos onde uma palavra deslocada se perderia).

// Aceita a data isolada ("31/07/2026"), com o traço separador ("31/07/2026-")
// e também data+hora coladas num único item de texto ("31/07/2026-19:54:54"),
// formato entregue pelo pdf.js em parte dos extratos da Caixa — sem isso a
// âncora do lançamento não era reconhecida e a linha inteira era descartada.
const CAIXA_DATE_RE = /^(\d{2}\/\d{2}\/\d{4})(?:\s*-\s*(?:\d{2}:\d{2}(?::\d{2})?)?)?$/;
// Hora isolada em item próprio — com ou sem os segundos.
const CAIXA_TIME_RE = /^-?\s*\d{2}:\d{2}(?::\d{2})?$/;
// Nr. Doc: só precisa ser numérico dentro da coluna de documento; o
// tamanho varia entre versões do extrato (6 dígitos, com zeros à
// esquerda, às vezes mais).
const CAIXA_DOC_RE = /^\d{3,12}$/;
const CAIXA_MONEY_RE = /^(?:R?\$)?(\d{1,3}(?:\.\d{3})*,\d{2})([CD])?$/i;
// Fallback para linhas raras onde o próprio PDF da Caixa erra o separador
// decimal (ex.: "30.512.46" ou "783.81" em vez de "30.512,46"/"783,81") —
// só usado quando o formato estrito acima não casa, então nunca piora um
// valor já lido corretamente.
const CAIXA_MONEY_LOOSE_RE = /^(?:R?\$)?(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})([CD])?$/i;
const CAIXA_CPF_CNPJ_RE = /^\*{2,3}[\d.,/]+\*{2,3}$/;

const CAIXA_COL_DATE = [30, 50] as const;
const CAIXA_COL_DOC = [115, 140] as const;
const CAIXA_COL_FAVORECIDO = [305, 400] as const;
const CAIXA_VALOR_SALDO_SPLIT_X = 465; // < isso = coluna Valor, >= isso = coluna Saldo
// Altura de linha assumida quando a página tem uma única âncora e não dá para
// medir o espaçamento real entre lançamentos.
const CAIXA_DEFAULT_ROW_PITCH = 22;
const CAIXA_HEADER_WORDS = new Set([
  'lançamentos', 'nr.', 'doc', 'histórico/complemento', 'favorecido', 'cpf/cnpj', 'valor',
]);
// Palavras que identificam a linha de cabeçalho da tabela; tudo acima dela
// (título, dados do cliente, "SALDO ANTERIOR") nunca pertence a lançamento.
const CAIXA_HEADER_MARKERS = ['histórico/complemento', 'lançamentos', 'cpf/cnpj'];

function caixaInRange(x: number, [min, max]: readonly [number, number]): boolean {
  return x >= min && x < max;
}

function caixaMoneyToNumber(raw: string): number {
  return parseFloat(raw.replace(/\./g, '').replace(',', '.')) || 0;
}

// Trata "." e "," indistintamente como separador de milhar, exceto o ÚLTIMO
// separador do trecho, tratado como decimal — cobre os casos em que o PDF
// usa "." por engano no lugar da vírgula decimal.
function caixaMoneyToNumberLoose(raw: string): number {
  const lastSep = Math.max(raw.lastIndexOf('.'), raw.lastIndexOf(','));
  if (lastSep === -1) return parseFloat(raw) || 0;
  const intPart = raw.slice(0, lastSep).replace(/[.,]/g, '');
  const decPart = raw.slice(lastSep + 1);
  return parseFloat(`${intPart}.${decPart}`) || 0;
}

// Alguns PDFs da Caixa trocam a fonte do "C" de crédito por um caractere
// cirílico visualmente idêntico (U+0441 "с") — normaliza antes de comparar.
function caixaNormalizeSign(raw: string): 'C' | 'D' | null {
  const s = raw.trim().toUpperCase().replace('С', 'C').replace('с'.toUpperCase(), 'C');
  if (s === 'C') return 'C';
  if (s === 'D') return 'D';
  return null;
}

function extractCaixaMetadata(pages: PdfWord[][]): BankStatementMetadata | null {
  const joined = pages.flat().map((w) => w.str).join(' ');

  const contaMatch = joined.match(/\b(\d{3,5}\/[\d.]+-\d)\b/);
  const periodoMatch = joined.match(
    /(\d{2})\/(\d{2})\/(\d{4})\s+at[ée]\s+(\d{2})\/(\d{2})\/(\d{4})/i
  );

  return {
    bank_name: 'Caixa Econômica Federal',
    account_number: contaMatch ? contaMatch[1] : '000000-0',
    period: periodoMatch ? `${periodoMatch[2]}/${periodoMatch[3]}` : '01/2026',
  };
}

export function parseCaixaWords(pages: PdfWord[][]): {
  transactions: ExtratoLine[];
  metadata: BankStatementMetadata | null;
} {
  const transactions: ExtratoLine[] = [];

  for (const words of pages) {
    // Linha de cabeçalho da tabela: nada acima dela entra em lançamento.
    // Páginas de continuação não repetem o cabeçalho — nesse caso não há
    // corte algum (Infinity), a página inteira continua valendo.
    const headerYs = words
      .filter((w) => CAIXA_HEADER_MARKERS.includes(w.str.trim().toLowerCase()))
      .map((w) => w.y0);
    const headerY = headerYs.length > 0 ? Math.max(...headerYs) : Infinity;

    type Anchor = { y0: number; date: string };
    const anchors: Anchor[] = [];
    for (const w of words) {
      if (!caixaInRange(w.x0, CAIXA_COL_DATE)) continue;
      if (w.y0 > headerY - 2) continue;
      const m = CAIXA_DATE_RE.exec(w.str.trim());
      if (m) anchors.push({ y0: w.y0, date: m[1] });
    }
    if (anchors.length === 0) continue;

    anchors.sort((a, b) => b.y0 - a.y0);

    // Espaçamento típico entre lançamentos nesta página (mediana das
    // distâncias entre âncoras consecutivas). Serve só para dar meia-linha de
    // folga acima do primeiro e abaixo do último lançamento.
    const gaps: number[] = [];
    for (let i = 1; i < anchors.length; i++) gaps.push(anchors[i - 1].y0 - anchors[i].y0);
    gaps.sort((a, b) => a - b);
    const pitch = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : CAIXA_DEFAULT_ROW_PITCH;

    // Faixa vertical de cada lançamento: do meio do caminho até a âncora de
    // cima ao meio do caminho até a de baixo. É isso que faz histórico de
    // uma linha e de várias linhas serem lidos da mesma forma — a faixa
    // acompanha a altura real da linha, seja ela qual for.
    const bandTop: number[] = [];
    const bandBottom: number[] = [];
    for (let i = 0; i < anchors.length; i++) {
      bandTop[i] =
        i === 0 ? anchors[0].y0 + pitch / 2 : (anchors[i - 1].y0 + anchors[i].y0) / 2;
      bandBottom[i] =
        i === anchors.length - 1
          ? anchors[i].y0 - pitch / 2
          : (anchors[i].y0 + anchors[i + 1].y0) / 2;
    }

    const blocks = new Map<number, PdfWord[]>();
    for (const w of words) {
      if (w.y0 > headerY - 2) continue;
      let idx = -1;
      for (let i = 0; i < anchors.length; i++) {
        if (w.y0 <= bandTop[i] && w.y0 > bandBottom[i]) {
          idx = i;
          break;
        }
      }
      if (idx === -1) continue;
      const arr = blocks.get(idx) ?? [];
      arr.push(w);
      blocks.set(idx, arr);
    }

    for (const [idx, blockWords] of blocks) {
      const anchor = anchors[idx];
      // Arredonda Y para agrupar sub-linhas do mesmo lançamento antes de
      // desempatar por X — evita inverter palavras da mesma linha visual
      // quando o baseline de cada glifo varia por frações de ponto.
      const sorted = [...blockWords].sort(
        (a, b) => Math.round(b.y0) - Math.round(a.y0) || a.x0 - b.x0
      );

      let valorAmount: number | null = null;
      let saldoAmount: number | null = null;
      const historicoWords: string[] = [];
      const favorecidoWords: string[] = [];
      const consumedSignIdx = new Set<number>();

      for (let i = 0; i < sorted.length; i++) {
        const w = sorted[i];
        const str = w.str.trim();
        if (!str) continue;

        if (CAIXA_DATE_RE.test(str) || CAIXA_TIME_RE.test(str)) continue;
        if (str === '-' && w.x0 < 100) continue; // separador data/hora, não o traço do histórico
        if (caixaInRange(w.x0, CAIXA_COL_DOC) && CAIXA_DOC_RE.test(str)) continue;
        if (CAIXA_CPF_CNPJ_RE.test(str)) continue;

        const moneyMatch = CAIXA_MONEY_RE.exec(str) ?? CAIXA_MONEY_LOOSE_RE.exec(str);
        if (moneyMatch) {
          const isSaldoCol = w.x0 >= CAIXA_VALOR_SALDO_SPLIT_X;
          let sign = moneyMatch[2] ? caixaNormalizeSign(moneyMatch[2]) : null;

          if (!sign) {
            // Sinal veio como palavra separada — procura o "C"/"D" mais
            // próximo à direita, na mesma linha, ainda não usado.
            let bestJ = -1;
            let bestDx = Infinity;
            for (let j = 0; j < sorted.length; j++) {
              if (j === i || consumedSignIdx.has(j)) continue;
              const cand = sorted[j];
              const normalized = caixaNormalizeSign(cand.str);
              if (!normalized) continue;
              const dx = cand.x0 - w.x0;
              if (dx >= 0 && dx < 40 && Math.abs(cand.y0 - w.y0) <= 3 && dx < bestDx) {
                bestDx = dx;
                bestJ = j;
                sign = normalized;
              }
            }
            if (bestJ !== -1) consumedSignIdx.add(bestJ);
          }

          const isStrict = CAIXA_MONEY_RE.test(str);
          const magnitude = isStrict
            ? caixaMoneyToNumber(moneyMatch[1])
            : caixaMoneyToNumberLoose(moneyMatch[1]);
          const value = sign === 'D' ? -magnitude : magnitude;
          if (isSaldoCol) saldoAmount = value;
          else valorAmount = value;
          continue;
        }

        if (consumedSignIdx.has(i)) continue;
        if (caixaNormalizeSign(str)) continue; // sinal solto já tratado (ou órfão)

        if (CAIXA_HEADER_WORDS.has(str.toLowerCase())) continue;

        // Colunas contíguas: qualquer palavra à esquerda da coluna de valor
        // cai em histórico ou favorecido, nunca é descartada por estar alguns
        // pontos fora da faixa nominal da coluna.
        if (w.x0 < CAIXA_COL_DOC[0]) continue; // sobra da coluna de data/hora
        else if (w.x0 < CAIXA_COL_FAVORECIDO[0]) historicoWords.push(str);
        else if (w.x0 < CAIXA_VALOR_SALDO_SPLIT_X) favorecidoWords.push(str);
      }

      const historico = historicoWords.join(' ').replace(/\s+/g, ' ').trim();
      const favorecido = favorecidoWords.join(' ').replace(/\s+/g, ' ').trim();

      if (!historico) continue;
      if (/^SALDO\s+DIA$/i.test(historico) || /^SALDO\s+ANTERIOR$/i.test(historico)) continue;
      if (valorAmount === null) continue;

      const [dd, mm, yyyy] = anchor.date.split('/');
      const description = favorecido ? `${historico} - ${favorecido}` : historico;

      transactions.push({
        date: `${yyyy}-${mm}-${dd}`,
        description,
        amount: valorAmount,
        balance: saldoAmount ?? undefined,
        raw: sorted.map((w) => w.str).join(' '),
      });
    }
  }

  const metadata = extractCaixaMetadata(pages);
  return { transactions, metadata };
}

// ─── Caixa (app "Extrato por Período") ─────────────────────────────────────
// Layout de exportação do aplicativo Caixa: página única e muito alta (uma
// captura contínua de rolagem), agrupada por dia ("02 de Março de 2026,
// Segunda-feira"), sem saldo por lançamento (só "Saldo do dia" ao final de
// cada grupo) e sem Nr.Doc/CPF-CNPJ. Cada lançamento tem: histórico (coluna
// esquerda, ex. "Deb Pix Chave"), opcionalmente o nome do favorecido logo
// abaixo (mesma coluna, 1-3 linhas) e o valor com sinal (coluna direita,
// "-" em token separado). O histórico e o valor ficam na mesma linha visual
// (Y muito próximo); o favorecido e a "tag" de data curta (ex. "02MAR")
// ficam nas linhas seguintes, antes do próximo lançamento.

const CAIXA_APP_MONEY_RE = /^R\$\s?\d{1,3}(?:\.\d{3})*,\d{2}$/;
const CAIXA_APP_DAY_HEADER_RE = /^(\d{1,2})\s+de\s+([A-Za-zçÇ]+)\s+de\s+(\d{4}),/;
const CAIXA_APP_LABEL_COL = [70, 100] as const;
const CAIXA_APP_VALUE_COL = [190, 320] as const;
const CAIXA_APP_ROW_TOLERANCE = 8;

const CAIXA_APP_MONTHS: Record<string, string> = {
  janeiro: '01', fevereiro: '02', março: '03', marco: '03', abril: '04', maio: '05', junho: '06',
  julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12',
};

function caixaAppMoneyToNumber(raw: string): number {
  const digits = raw.replace(/^R\$\s?/, '');
  return parseFloat(digits.replace(/\./g, '').replace(',', '.')) || 0;
}

// Encontra, para uma palavra em y0=targetY, a âncora (label de lançamento ou
// cabeçalho de dia) mais próxima em ou acima dela — mesma lógica de "floor"
// usada no parser de tabela da Caixa, aqui reaproveitada para dois papéis
// distintos (blocos de lançamento e data do dia corrente).
function caixaAppNearestAbove<T extends { y0: number }>(
  targetY: number,
  anchors: T[],
  slack = 3
): number {
  let bestIdx = -1;
  let bestGap = Infinity;
  for (let i = 0; i < anchors.length; i++) {
    const gap = anchors[i].y0 - targetY;
    if (gap >= -slack && gap < bestGap) {
      bestGap = gap;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function parseCaixaAppWords(pages: PdfWord[][]): {
  transactions: ExtratoLine[];
  metadata: BankStatementMetadata | null;
} {
  const transactions: ExtratoLine[] = [];
  const allDates: string[] = [];

  for (const words of pages) {
    const dayHeaders: { y0: number; date: string }[] = [];
    for (const w of words) {
      if (w.x0 > 30) continue;
      const m = CAIXA_APP_DAY_HEADER_RE.exec(w.str.trim());
      if (!m) continue;
      const dd = m[1].padStart(2, '0');
      const mm = CAIXA_APP_MONTHS[m[2].toLowerCase()];
      if (!mm) continue;
      dayHeaders.push({ y0: w.y0, date: `${m[3]}-${mm}-${dd}` });
    }
    if (dayHeaders.length === 0) continue;

    type Anchor = { y0: number; valueX0: number; valueY0: number };
    const anchors: Anchor[] = [];
    for (const w of words) {
      if (!caixaInRange(w.x0, CAIXA_APP_VALUE_COL)) continue;
      if (!CAIXA_APP_MONEY_RE.test(w.str.trim())) continue;
      // Só vira âncora de lançamento se houver um label na coluna esquerda
      // na mesma linha — sem isso é "Saldo do dia"/"Saldo Anterior" (label
      // fica numa coluna mais à esquerda, fora de CAIXA_APP_LABEL_COL).
      const label = words.find(
        (o) =>
          caixaInRange(o.x0, CAIXA_APP_LABEL_COL) &&
          Math.abs(o.y0 - w.y0) <= CAIXA_APP_ROW_TOLERANCE &&
          !CAIXA_APP_MONEY_RE.test(o.str.trim())
      );
      if (!label) continue;
      anchors.push({ y0: Math.max(w.y0, label.y0), valueX0: w.x0, valueY0: w.y0 });
    }
    if (anchors.length === 0) continue;

    const signByAnchor = new Map<number, boolean>(); // true = negativo
    const amountByAnchor = new Map<number, number>();

    for (const w of words) {
      const str = w.str.trim();
      if (!str) continue;

      if (caixaInRange(w.x0, CAIXA_APP_VALUE_COL) && CAIXA_APP_MONEY_RE.test(str)) {
        const idx = caixaAppNearestAbove(w.y0, anchors);
        if (idx === -1) continue;
        // só a âncora dona deste valor específico grava o montante
        if (Math.abs(anchors[idx].valueY0 - w.y0) < 0.5 && anchors[idx].valueX0 === w.x0) {
          amountByAnchor.set(idx, caixaAppMoneyToNumber(str));
        }
        continue;
      }

      if (str === '-') {
        const idx = caixaAppNearestAbove(w.y0, anchors);
        if (idx === -1) continue;
        if (Math.abs(anchors[idx].valueY0 - w.y0) <= 3) signByAnchor.set(idx, true);
      }
    }

    // Ordena âncoras por Y decrescente (topo → rodapé) para reconstruir a
    // ordem de leitura das palavras de descrição dentro de cada bloco.
    const order = anchors.map((_, i) => i).sort((a, b) => anchors[b].y0 - anchors[a].y0);
    const wordsSortedDesc = [...words].sort((a, b) => b.y0 - a.y0);

    for (const idx of order) {
      const anchor = anchors[idx];
      const amount = amountByAnchor.get(idx);
      if (amount === undefined) continue;

      const descWords = wordsSortedDesc.filter((w) => {
        if (!caixaInRange(w.x0, CAIXA_APP_LABEL_COL)) return false;
        const wi = caixaAppNearestAbove(w.y0, anchors);
        return wi === idx;
      });
      const description = descWords
        .map((w) => w.str.trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!description) continue;

      const dayIdx = caixaAppNearestAbove(anchor.y0, dayHeaders);
      const dateIso = dayIdx === -1 ? null : dayHeaders[dayIdx].date;
      if (!dateIso) continue;
      allDates.push(dateIso);

      const signed = signByAnchor.get(idx) ? -Math.abs(amount) : amount;

      transactions.push({
        date: dateIso,
        description,
        amount: signed,
        raw: description,
      });
    }
  }

  allDates.sort();
  const period = allDates.length > 0 ? `${allDates[0].slice(5, 7)}/${allDates[0].slice(0, 4)}` : '01/2026';

  const metadata: BankStatementMetadata = {
    bank_name: 'Caixa Econômica Federal',
    account_number: '000000-0',
    period,
  };

  return { transactions, metadata };
}

// ─── Nubank ─────────────────────────────────────────────────────────────────
// Formato "Movimentações" agrupado por dia ("05 MAI 2026"), com seções
// "Total de entradas + X" / "Total de saídas - X" indicando o sinal de todas
// as transações que vêm a seguir (o valor de cada lançamento não tem sinal).
// Cada bloco "página nova" repete cabeçalho/rodapé — removido antes de parsear.

const NUBANK_MONTHS: Record<string, string> = {
  JAN: '01', FEV: '02', MAR: '03', ABR: '04', MAI: '05', JUN: '06',
  JUL: '07', AGO: '08', SET: '09', OUT: '10', NOV: '11', DEZ: '12',
};
const NUBANK_DAY_HEADER_RE = /\b(\d{2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+(\d{4})\b/g;
const NUBANK_MONEY_RE = /\d{1,3}(?:\.\d{3})*,\d{2}/g;
const NUBANK_BOILERPLATE_RE = /Tem alguma d[úu]vida[\s\S]*?VALORES EM R\$/gi;
const NUBANK_SALDO_DIA_RE = /saldo\s+do\s+dia/i;
const NUBANK_AG_CONTA_RE = /Ag[êe]ncia:\s*\d+\s*Conta:\s*[\d.-]+/gi;
const NUBANK_LONG_NUM_RE = /\b\d[\d.]{5,}-?\d?\b/g;
const NUBANK_BANK_CODE_RE = /\(\d{4}\)/g;

function nubankCleanDescription(raw: string): string {
  let d = raw;
  d = d.replace(CNPJ_RE, ' ');
  d = d.replace(NUBANK_AG_CONTA_RE, ' ');
  d = d.replace(NUBANK_LONG_NUM_RE, ' ');
  d = d.replace(NUBANK_MONEY_RE, ' ');
  d = d.replace(NUBANK_BANK_CODE_RE, ' ');
  d = d.replace(/\s+/g, ' ').trim();
  d = d.replace(/\s*-\s*$/, '').trim();
  return d;
}

function nubankExtractZoneTransactions(
  zoneText: string,
  dateIso: string,
  sign: 1 | -1
): ExtratoLine[] {
  const out: ExtratoLine[] = [];
  const re = new RegExp(NUBANK_MONEY_RE.source, 'g');
  let prevEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(zoneText))) {
    const chunk = zoneText.slice(prevEnd, m.index + m[0].length);
    prevEnd = m.index + m[0].length;
    const rawDesc = chunk.slice(0, chunk.length - m[0].length);
    if (NUBANK_SALDO_DIA_RE.test(rawDesc)) continue; // marcador de saldo, não é transação

    const description = nubankCleanDescription(rawDesc);
    if (!description || description.length < 3) continue;

    const amount = parseFloat(m[0].replace(/\./g, '').replace(',', '.')) * sign;
    out.push({ date: dateIso, description, amount, raw: chunk });
  }
  return out;
}

function extractNubankMetadata(text: string): BankStatementMetadata | null {
  const contaMatch = text.match(/Conta\s+(\d{6,10}-\d)/i);
  const agenciaMatch = text.match(/Ag[êe]ncia\s+(\d+)/i);
  const periodoMatch = text.match(
    /(\d{2})\s+DE\s+([A-ZÇ]+)\s+DE\s+(\d{4})\s+a\s+\d{2}\s+DE\s+[A-ZÇ]+\s+DE\s+(\d{4})/i
  );

  let period = '01/2026';
  if (periodoMatch) {
    const monthName = periodoMatch[2].toUpperCase().slice(0, 3);
    const monthNum = NUBANK_MONTHS[monthName];
    if (monthNum) period = `${monthNum}/${periodoMatch[3]}`;
  }

  return {
    bank_name: 'Nubank',
    account_number: contaMatch
      ? `${agenciaMatch ? agenciaMatch[1] + ' / ' : ''}${contaMatch[1]}`
      : '000000-0',
    period,
  };
}

export function parseNubankText(text: string): {
  transactions: ExtratoLine[];
  metadata: BankStatementMetadata | null;
} {
  const cleanText = text.replace(NUBANK_BOILERPLATE_RE, ' ');
  const metadata = extractNubankMetadata(cleanText);

  const dayMatches: { index: number; end: number; dateIso: string }[] = [];
  const re = new RegExp(NUBANK_DAY_HEADER_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleanText))) {
    const dd = m[1];
    const monthNum = NUBANK_MONTHS[m[2]];
    const yyyy = m[3];
    if (!monthNum) continue;
    dayMatches.push({ index: m.index, end: m.index + m[0].length, dateIso: `${yyyy}-${monthNum}-${dd}` });
  }

  const transactions: ExtratoLine[] = [];

  for (let i = 0; i < dayMatches.length; i++) {
    const dayStart = dayMatches[i].end;
    const dayEnd = i + 1 < dayMatches.length ? dayMatches[i + 1].index : cleanText.length;
    const dayChunk = cleanText.slice(dayStart, dayEnd);

    const entradasMatch = dayChunk.match(/Total de entradas\s*\+\s*\d{1,3}(?:\.\d{3})*,\d{2}/i);
    const saidasMatch = dayChunk.match(/Total de sa[íi]das\s*-\s*\d{1,3}(?:\.\d{3})*,\d{2}/i);

    let creditZone = '';
    let debitZone = '';
    if (entradasMatch && saidasMatch) {
      const entradasEnd = (entradasMatch.index ?? 0) + entradasMatch[0].length;
      const saidasStart = saidasMatch.index ?? 0;
      creditZone = dayChunk.slice(entradasEnd, saidasStart);
      debitZone = dayChunk.slice(saidasStart + saidasMatch[0].length);
    } else if (entradasMatch) {
      creditZone = dayChunk.slice((entradasMatch.index ?? 0) + entradasMatch[0].length);
    } else if (saidasMatch) {
      debitZone = dayChunk.slice((saidasMatch.index ?? 0) + saidasMatch[0].length);
    }

    transactions.push(...nubankExtractZoneTransactions(creditZone, dayMatches[i].dateIso, 1));
    transactions.push(...nubankExtractZoneTransactions(debitZone, dayMatches[i].dateIso, -1));
  }

  return { transactions, metadata };
}

// ─── Wise ───────────────────────────────────────────────────────────────────
// Cada lançamento aparece nesta ordem no texto extraído do PDF (confirmado
// via extração real): primeiro a DESCRIÇÃO, depois o marcador de detalhe
// "DD de mês de AAAA Transação: CÓDIGO [Referência: ...]" com a data real,
// e só DEPOIS os valores monetários — dois números seguidos, dos quais
// apenas o PRIMEIRO é o valor do lançamento (o segundo é um número de
// layout/coluna auxiliar que não representa outro lançamento).
// Ex.: "Enviou dinheiro para X 24 de junho de 2026 Transação: TRANSFER-123
//       Referência: ... -7.750,00 0,00 Enviou dinheiro para Y 24 de junho..."

const WISE_MONTHS: Record<string, string> = {
  janeiro: '01', fevereiro: '02', março: '03', abril: '04', maio: '05', junho: '06',
  julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12',
};
const WISE_MARKER_RE =
  /(\d{1,2})\s+de\s+(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})\s+Transa[cç][ãa]o:\s*(\S+)/gi;
const WISE_TABLE_HEADER_RE = /Descri[çc][ãa]o\s+Entrada\s+Sa[íi]da\s+Valor/i;
const WISE_MONEY_RE = /-?\d{1,3}(?:\.\d{3})*,\d{2}/g;

function extractWiseMetadata(text: string): BankStatementMetadata | null {
  const ibanMatch = text.match(/IBAN\s+([A-Z]{2}\d{2}(?:\s*\d{4})*)/i);
  const periodoMatch = text.match(
    /\d{1,2}\s+de\s+\w+\s+de\s+(\d{4}).*?-\s*\d{1,2}\s+de\s+(\w+)\s+de\s+(\d{4})/i
  );
  let period = '01/2026';
  if (periodoMatch) {
    const monthNum = WISE_MONTHS[periodoMatch[2].toLowerCase()];
    if (monthNum) period = `${monthNum}/${periodoMatch[3]}`;
  }
  return {
    bank_name: 'Wise',
    account_number: ibanMatch ? ibanMatch[1].replace(/\s+/g, '') : '000000-0',
    period,
  };
}

export function parseWiseText(text: string): {
  transactions: ExtratoLine[];
  metadata: BankStatementMetadata | null;
} {
  const metadata = extractWiseMetadata(text);

  const headerMatch = text.match(WISE_TABLE_HEADER_RE);
  const tableText = headerMatch ? text.slice((headerMatch.index ?? 0) + headerMatch[0].length) : text;

  const markerRe = new RegExp(WISE_MARKER_RE.source, 'gi');
  const markers: { start: number; end: number; dateIso: string }[] = [];
  let mm: RegExpExecArray | null;
  while ((mm = markerRe.exec(tableText))) {
    const monthNum = WISE_MONTHS[mm[2].toLowerCase()];
    if (!monthNum) continue;
    const dd = mm[1].padStart(2, '0');
    markers.push({ start: mm.index, end: mm.index + mm[0].length, dateIso: `${mm[3]}-${monthNum}-${dd}` });
  }

  const transactions: ExtratoLine[] = [];
  const moneyRe = new RegExp(WISE_MONEY_RE.source, 'g');
  let descStart = 0;

  for (const marker of markers) {
    const description = tableText.slice(descStart, marker.start).replace(/\s+/g, ' ').trim();

    moneyRe.lastIndex = marker.end;
    const amountMatch = moneyRe.exec(tableText);
    if (!amountMatch || !description) {
      descStart = marker.end;
      continue;
    }

    // O segundo valor logo em seguida (se houver) é só um número de coluna
    // auxiliar — descarta, e a próxima descrição começa depois dele.
    moneyRe.lastIndex = amountMatch.index + amountMatch[0].length;
    const secondMatch = moneyRe.exec(tableText);
    descStart = secondMatch ? secondMatch.index + secondMatch[0].length : amountMatch.index + amountMatch[0].length;

    const amount = parseFloat(amountMatch[0].replace(/\./g, '').replace(',', '.'));
    transactions.push({
      date: marker.dateIso,
      description,
      amount,
      raw: tableText.slice(marker.start, descStart),
    });
  }

  return { transactions, metadata };
}

// ─── Banco Inter ────────────────────────────────────────────────────────────
// Agrupado por dia ("9 de Junho de 2026 Saldo do dia: R$ 810,54"), cada
// lançamento tem duas colunas "Valor" e "Saldo por transação" com prefixo
// "R$"/"-R$" (já com sinal).

const INTER_MONTHS: Record<string, string> = {
  janeiro: '01', fevereiro: '02', março: '03', abril: '04', maio: '05', junho: '06',
  julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12',
};
const INTER_DAY_RE =
  /(\d{1,2})\s+de\s+(Janeiro|Fevereiro|Março|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro)\s+de\s+(\d{4})\s+Saldo do dia:\s*-?R\$\s*[\d.,]+/gi;
const INTER_MONEY_RE = /(-?)R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/g;

function extractInterMetadata(text: string): BankStatementMetadata | null {
  const contaMatch = text.match(/Conta:\s*([\d-]+)/i);
  const agenciaMatch = text.match(/Ag[êe]ncia:\s*([\d-]+)/i);
  const periodoMatch = text.match(/Per[íi]odo:\s*\d{2}\/(\d{2})\/(\d{4})\s+a\s+\d{2}\/\d{2}\/\d{4}/i);
  return {
    bank_name: 'Banco Inter',
    account_number: contaMatch
      ? `${agenciaMatch ? agenciaMatch[1] + ' / ' : ''}${contaMatch[1]}`
      : '000000-0',
    period: periodoMatch ? `${periodoMatch[1]}/${periodoMatch[2]}` : '01/2026',
  };
}

export function parseInterText(text: string): {
  transactions: ExtratoLine[];
  metadata: BankStatementMetadata | null;
} {
  const metadata = extractInterMetadata(text);
  const transactions: ExtratoLine[] = [];

  const dayRe = new RegExp(INTER_DAY_RE.source, 'gi');
  const dayMatches: { index: number; end: number; dateIso: string }[] = [];
  let dm: RegExpExecArray | null;
  while ((dm = dayRe.exec(text))) {
    const dd = dm[1].padStart(2, '0');
    const monthNum = INTER_MONTHS[dm[2].toLowerCase()];
    const yyyy = dm[3];
    if (!monthNum) continue;
    dayMatches.push({ index: dm.index, end: dm.index + dm[0].length, dateIso: `${yyyy}-${monthNum}-${dd}` });
  }

  for (let i = 0; i < dayMatches.length; i++) {
    const start = dayMatches[i].end;
    const end = i + 1 < dayMatches.length ? dayMatches[i + 1].index : text.length;
    const chunk = text.slice(start, end);

    const moneyRe = new RegExp(INTER_MONEY_RE.source, 'g');
    const moneyMatches: RegExpExecArray[] = [];
    let mm: RegExpExecArray | null;
    while ((mm = moneyRe.exec(chunk))) moneyMatches.push(mm);

    let prevEnd = 0;
    for (let j = 0; j + 1 < moneyMatches.length; j += 2) {
      const valorMatch = moneyMatches[j];
      const saldoMatch = moneyMatches[j + 1];

      const desc = chunk
        .slice(prevEnd, valorMatch.index)
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[:"]+|[:"]+$/g, '');
      prevEnd = saldoMatch.index + saldoMatch[0].length;
      if (!desc) continue;

      const sign = valorMatch[1] === '-' ? -1 : 1;
      const amount = sign * parseFloat(valorMatch[2].replace(/\./g, '').replace(',', '.'));
      transactions.push({ date: dayMatches[i].dateIso, description: desc, amount, raw: chunk });
    }
  }

  return { transactions, metadata };
}

// ─── Santander — Extrato Completo (extrato-pj) ─────────────────────────────
// Formato real (confirmado via extração do PDF nativo): cada linha é
//   DD/MM/AAAA Histórico [Documento] Valor(R$) Saldo(R$)
// Ex.: "02/02/2026 Iof Adicional - Automatico -0,25 -67,66"
//      "30/01/2026 Pagamento Darf Em Canais 173321 -20.706,65 -67,46"
//
// Peculiaridades:
// - A extração real de texto do PDF (pdfjs) junta os itens com espaço, sem
//   preservar quebras de linha — o parser não pode depender de '\n'.
// - O "Documento" é um código numérico opcional entre a descrição e o
//   valor (ex.: "173321", "0000000000") — é removido da descrição final.
// - O Saldo (R$) pode ser negativo (conta ficou no vermelho no período),
//   então não dá pra assumir sinal fixo nele.
// - A descrição pode conter um hífen próprio (ex.: "Iof Adicional -
//   Automatico"), então não dá pra usar "-" como delimitador de campos —
//   os dois ÚLTIMOS números em formato monetário de cada trecho são
//   sempre Valor e Saldo, nessa ordem.

const SANTANDER_DATE_RE = /\b(\d{2})\/(\d{2})\/(\d{4})\b/;
const SANTANDER_MONEY_RE = /-?\d{1,3}(?:\.\d{3})*,\d{2}/;
const SANTANDER_TABLE_HEADER_RE = /Data\s+Hist[óo]rico\s+Documento\s+Valor\s*\(R\$\)\s*Saldo\s*\(R\$\)/i;
// Fim da tabela de lançamentos — resumo de composição de saldo no rodapé.
const SANTANDER_NOISE_START_RE = /Saldo\s+de\s+ContaMax|Saldo\s+Dispon[íi]vel\s*[:\-]?\s*-?\d|Posi[çc][ãa]o\s+em:/i;

function extractSantanderMetadata(text: string): BankStatementMetadata | null {
  const contaMatch = text.match(/Ag[êe]ncia:\s*(\d+)\s*Conta:\s*(\d+)/i);
  const periodoMatch = text.match(
    /Per[íi]odos?:\s*\d{2}\/(\d{2})\/(\d{4})\s*a\s*\d{2}\/(\d{2})\/(\d{4})/i
  );

  return {
    bank_name: 'Santander',
    account_number: contaMatch ? `${contaMatch[1]} / ${contaMatch[2]}` : '000000-0',
    period: periodoMatch ? `${periodoMatch[3]}/${periodoMatch[4]}` : '01/2026',
  };
}

// Intervalo exato (datas ISO) declarado em "Períodos: DD/MM/AAAA a DD/MM/AAAA".
// O PDF às vezes lista, no topo, lançamentos de ajuste (ex.: IOF) postados
// já no mês seguinte — fora do período do extrato — que não devem entrar
// na conciliação deste período.
function extractSantanderPeriodRange(text: string): { start: string; end: string } | null {
  const m = text.match(
    /Per[íi]odos?:\s*(\d{2})\/(\d{2})\/(\d{4})\s*a\s*(\d{2})\/(\d{2})\/(\d{4})/i
  );
  if (!m) return null;
  return {
    start: `${m[3]}-${m[2]}-${m[1]}`,
    end: `${m[6]}-${m[5]}-${m[4]}`,
  };
}

export function parseSantanderCompletoText(text: string): {
  transactions: ExtratoLine[];
  metadata: BankStatementMetadata | null;
} {
  const metadata = extractSantanderMetadata(text);
  const periodRange = extractSantanderPeriodRange(text);

  // Normaliza espaços em branco: a extração real do PDF não preserva
  // quebras de linha entre os itens de texto (fica tudo numa "linha" só
  // por página) — normalizar deixa o parser robusto independente de como
  // o texto foi extraído.
  let normalized = text.replace(/\s+/g, ' ').trim();

  // Escopo: começa depois do cabeçalho da tabela (se encontrado, evita
  // pegar datas de metadata como "Períodos: 01/01/2026 a 31/01/2026") e
  // termina antes do resumo de saldo no rodapé.
  const headerMatch = normalized.match(SANTANDER_TABLE_HEADER_RE);
  const scopeStart = headerMatch ? (headerMatch.index ?? 0) + headerMatch[0].length : 0;

  const noiseMatch = normalized.slice(scopeStart).match(SANTANDER_NOISE_START_RE);
  const scopeEnd = noiseMatch
    ? scopeStart + (noiseMatch.index ?? normalized.length - scopeStart)
    : normalized.length;

  const scoped = normalized.slice(scopeStart, scopeEnd);

  // 1) Todas as posições de data (DD/MM/AAAA) dentro do escopo — cada uma
  // marca o início de um lançamento.
  const dateRe = new RegExp(SANTANDER_DATE_RE.source, 'g');
  const dateMatches: { dateIso: string; start: number; end: number }[] = [];
  let dm: RegExpExecArray | null;
  while ((dm = dateRe.exec(scoped))) {
    const dd = dm[1];
    const mm = dm[2];
    const yyyy = dm[3];
    dateMatches.push({ dateIso: `${yyyy}-${mm}-${dd}`, start: dm.index, end: dm.index + dm[0].length });
  }

  const transactions: ExtratoLine[] = [];

  // 2) Para cada lançamento, o "chunk" vai do fim da data até o início da
  // próxima data (ou fim do escopo, no último). Dentro do chunk, os dois
  // ÚLTIMOS valores monetários são Valor e Saldo, nessa ordem — o resto
  // (ignorando eventual lixo residual após o Saldo) é a descrição.
  for (let i = 0; i < dateMatches.length; i++) {
    // Ignora lançamentos com data fora do período declarado do extrato
    // (ex.: ajustes de IOF postados já no mês seguinte, mas listados no
    // topo do PDF) — não fazem parte da conciliação deste período.
    if (
      periodRange &&
      (dateMatches[i].dateIso < periodRange.start || dateMatches[i].dateIso > periodRange.end)
    ) {
      continue;
    }

    const chunkStart = dateMatches[i].end;
    const chunkEnd = i + 1 < dateMatches.length ? dateMatches[i + 1].start : scoped.length;
    const chunk = scoped.slice(chunkStart, chunkEnd);

    const moneyRe = new RegExp(SANTANDER_MONEY_RE.source, 'g');
    const moneyMatches: RegExpExecArray[] = [];
    let mm2: RegExpExecArray | null;
    while ((mm2 = moneyRe.exec(chunk))) moneyMatches.push(mm2);

    if (moneyMatches.length < 2) continue; // sem Valor+Saldo, não é um lançamento válido

    const valorMatch = moneyMatches[moneyMatches.length - 2];
    const saldoMatch = moneyMatches[moneyMatches.length - 1];

    let description = chunk.slice(0, valorMatch.index).trim();
    description = description.replace(/\b\d{5,}\b/g, ' '); // código de documento
    description = description.replace(/\s+/g, ' ').trim();

    if (!description || description.length < 2) continue;

    const amount = parseFloat(valorMatch[0].replace(/\./g, '').replace(',', '.'));
    const balance = parseFloat(saldoMatch[0].replace(/\./g, '').replace(',', '.'));

    transactions.push({
      date: dateMatches[i].dateIso,
      description,
      amount,
      balance,
      raw: chunk,
    });
  }

  return { transactions, metadata };
}

// ─── Santander — Extrato Completo (por posição/palavras) ───────────────────
// A variante acima (parseSantanderCompletoText) assume que o texto extraído
// do PDF preserva, mais ou menos, a ordem visual de cada linha. Em alguns
// PDFs do Santander (mesmo layout visual, pequena diferença de geração) isso
// NÃO é verdade: o pdf.js entrega os itens de texto na ordem do content
// stream, que pode ser:
//   - "intercalada por linha" (cada lançamento inteiro antes do próximo), ou
//   - "em blocos por coluna" (todas as Datas da página, depois todo o
//     Histórico, depois todo o Documento/Valor, depois todo o Saldo) — nesse
//     caso a data pode até cair NO MEIO da descrição de duas linhas.
// Isso quebra qualquer parser baseado em regex sobre o texto concatenado.
//
// A posição X/Y de cada item, porém, é sempre fiel ao PDF (não depende da
// ordem de desenho) — por isso este parser reconstrói cada linha usando
// coordenadas: agrupa os itens entre duas datas consecutivas (pela posição Y)
// como pertencentes ao mesmo lançamento, e classifica cada item em
// Data/Histórico/Documento/Valor/Saldo pela posição X (usando o cabeçalho da
// tabela — "Data Historico Documento Valor (R$) Saldo (R$)" — para calibrar
// os limites de cada coluna).
//
// Ocasionalmente um valor de Saldo perde a pontuação na extração (vira
// "726662" em vez de "7.266,62") — o parser tolera isso: quando o texto da
// coluna Valor/Saldo não tem vírgula, assume os 2 últimos dígitos como
// centavos.

interface SantanderColumnBounds {
  historicoStart: number;
  documentoStart: number;
  valorStart: number;
  saldoStart: number;
}

const SANTANDER_WORDS_DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;

// Limites-padrão (em pontos PDF, página A4 retrato ~595pt de largura) caso o
// cabeçalho da tabela não seja encontrado em nenhuma página — calibrados a
// partir do layout real do extrato Santander Empresas.
const SANTANDER_DEFAULT_BOUNDS: SantanderColumnBounds = {
  historicoStart: 71,
  documentoStart: 198,
  valorStart: 360,
  saldoStart: 465,
};

function findSantanderHeaderOnPage(
  words: PdfWord[]
): { bounds: SantanderColumnBounds; headerY: number } | null {
  let data: PdfWord | null = null;
  let historico: PdfWord | null = null;
  let documento: PdfWord | null = null;
  let valor: PdfWord | null = null;
  let saldo: PdfWord | null = null;

  for (const w of words) {
    const s = w.str.trim();
    if (!data && s === 'Data') data = w;
    else if (!historico && /^Hist[oó]rico$/i.test(s)) historico = w;
    else if (!documento && s === 'Documento') documento = w;
    else if (!valor && /^Valor\s*\(R\$\)$/i.test(s)) valor = w;
    else if (!saldo && /^Saldo\s*\(R\$\)$/i.test(s)) saldo = w;
  }

  if (!data || !historico || !documento || !valor || !saldo) return null;

  return {
    bounds: {
      historicoStart: (data.x0 + historico.x0) / 2,
      documentoStart: (historico.x0 + documento.x0) / 2,
      valorStart: (documento.x0 + valor.x0) / 2,
      saldoStart: (valor.x0 + saldo.x0) / 2,
    },
    headerY: data.y0,
  };
}

type SantanderColumn = 'data' | 'historico' | 'documento' | 'valor' | 'saldo';

function classifySantanderColumn(x0: number, bounds: SantanderColumnBounds): SantanderColumn {
  if (x0 < bounds.historicoStart) return 'data';
  if (x0 < bounds.documentoStart) return 'historico';
  if (x0 < bounds.valorStart) return 'documento';
  if (x0 < bounds.saldoStart) return 'valor';
  return 'saldo';
}

// Tolerante a valores sem separador decimal (ex.: "726662" em vez de
// "7.266,62") — trata os 2 últimos dígitos como centavos nesse caso.
function parseSantanderTolerantMoney(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const neg = s.startsWith('-');

  if (s.includes(',')) {
    const v = parseFloat(s.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(v) ? v : null;
  }

  const digits = s.replace(/[^0-9]/g, '');
  if (digits.length < 3) return null; // curto demais pra ser um valor monetário plausível
  const cents = digits.slice(-2);
  const intPart = digits.slice(0, -2) || '0';
  const v = parseFloat(`${intPart}.${cents}`);
  if (!Number.isFinite(v)) return null;
  return neg ? -Math.abs(v) : v;
}

// Em alguns PDFs o pdf.js entrega a data já colada com o texto seguinte num
// único item (ex.: "29/06/2026 RENDIMENTO LIQUIDO DE CONTAMAX"). Se tratado
// como texto único ele não bate no regex de data exata e a linha inteira
// (com sua data) some do resultado. Aqui separamos a data do restante,
// mantendo o X original da data mas realocando o resto para dentro da
// coluna Histórico (X calibrado pelos limites de coluna) para não perder
// nem a data nem o texto.
function splitLeadingDateWords(words: PdfWord[], bounds: SantanderColumnBounds): PdfWord[] {
  const out: PdfWord[] = [];
  const leadingDateRe = /^(\d{2}\/\d{2}\/\d{4})\s+(\S.*)$/;
  for (const w of words) {
    const s = w.str.trim();
    if (SANTANDER_WORDS_DATE_RE.test(s)) {
      out.push(w);
      continue;
    }
    const m = s.match(leadingDateRe);
    if (m) {
      out.push({ str: m[1], x0: w.x0, y0: w.y0 });
      out.push({ str: m[2], x0: bounds.historicoStart + 1, y0: w.y0 });
      continue;
    }
    out.push(w);
  }
  return out;
}

// Cada página termina com o número da página isolado (ex.: "15"), abaixo do
// último lançamento — sem essa remoção ele acaba absorvido pela última linha
// da página (o espaço de coordenadas contínuo entre páginas não tem mais um
// limite inferior apertado como o do fim de página) e sobrescreve o Saldo
// real, já que é o item mais abaixo dentro da coluna Saldo.
function stripSantanderPageNumberFooter(words: PdfWord[]): PdfWord[] {
  if (words.length === 0) return words;
  let minIdx = 0;
  for (let i = 1; i < words.length; i++) {
    if (words[i].y0 < words[minIdx].y0) minIdx = i;
  }
  const candidate = words[minIdx].str.trim();
  if (/^\d{1,3}$/.test(candidate)) {
    return words.filter((_, i) => i !== minIdx);
  }
  return words;
}

export function parseSantanderWords(pages: PdfWord[][]): {
  transactions: ExtratoLine[];
  metadata: BankStatementMetadata | null;
} {
  const allWordsOriginal = pages.flat();
  const fullText = allWordsOriginal.map((w) => w.str).join(' ');
  const metadata = extractSantanderMetadata(fullText);
  const periodRange = extractSantanderPeriodRange(fullText);

  let bounds = SANTANDER_DEFAULT_BOUNDS;
  for (const words of pages) {
    const header = findSantanderHeaderOnPage(words);
    if (header) {
      bounds = header.bounds;
      break;
    }
  }

  // Um lançamento de 2 linhas pode ficar dividido entre o fim de uma página e
  // o início da próxima (a data cai na página seguinte). Para reconstruir a
  // linha corretamente nesse caso, tratamos o documento inteiro como um único
  // espaço de coordenadas Y contínuo: cada página recebe um deslocamento
  // grande o bastante para nunca se sobrepor à anterior, preservando a ordem
  // de leitura entre páginas.
  const PAGE_Y_OFFSET = 100000;
  let headerY: number | null = null;
  const words: PdfWord[] = [];
  pages.forEach((rawWords, pageIndex) => {
    const offset = -pageIndex * PAGE_Y_OFFSET;
    const splitWords = splitLeadingDateWords(stripSantanderPageNumberFooter(rawWords), bounds).map((w) => ({
      str: w.str,
      x0: w.x0,
      y0: w.y0 + offset,
    }));
    if (headerY === null) {
      const header = findSantanderHeaderOnPage(splitWords);
      if (header) headerY = header.headerY;
    }
    words.push(...splitWords);
  });

  const transactions: ExtratoLine[] = [];

  const dateItems = words
    .filter((w) => SANTANDER_WORDS_DATE_RE.test(w.str.trim()))
    .sort((a, b) => b.y0 - a.y0); // início do documento primeiro (Y maior = mais acima/anterior)

  for (let i = 0; i < dateItems.length; i++) {
    const current = dateItems[i];
    const prev = i > 0 ? dateItems[i - 1] : null;
    const next = i + 1 < dateItems.length ? dateItems[i + 1] : null;

    const upperBound = prev ? (prev.y0 + current.y0) / 2 : (headerY ?? Infinity) - 0.01;
    const lowerBound = next ? (current.y0 + next.y0) / 2 : current.y0 - 4;

    const rowWords = words
      .filter((w) => w.y0 > lowerBound && w.y0 <= upperBound)
      .sort((a, b) => b.y0 - a.y0 || a.x0 - b.x0);

    const historicoParts: string[] = [];
    let valorWord: PdfWord | null = null;
    let saldoWord: PdfWord | null = null;

    for (const w of rowWords) {
      const col = classifySantanderColumn(w.x0, bounds);
      if (col === 'historico') historicoParts.push(w.str);
      else if (col === 'valor') valorWord = w;
      else if (col === 'saldo') saldoWord = w;
      // 'data' e 'documento' não entram na descrição final.
    }

    if (!valorWord || !saldoWord) continue;

    const amount = parseSantanderTolerantMoney(valorWord.str);
    const balance = parseSantanderTolerantMoney(saldoWord.str);
    if (amount === null) continue;

    const description = historicoParts.join(' ').replace(/\s+/g, ' ').trim();
    if (!description) continue;

    const [dd, mm, yyyy] = current.str.trim().split('/');
    const dateIso = `${yyyy}-${mm}-${dd}`;

    if (periodRange && (dateIso < periodRange.start || dateIso > periodRange.end)) continue;

    transactions.push({
      date: dateIso,
      description,
      amount,
      balance: balance ?? undefined,
      raw: rowWords.map((w) => w.str).join(' '),
    });
  }

  return { transactions, metadata };
}

// ─── InfinitePay ────────────────────────────────────────────────────────────
// Formato "Relatório de movimentações" da Cloudwalk / InfinitePay.
//
// Peculiaridade importante da extração de texto do PDF (os itens de texto
// do PDF são concatenados com espaço, sem preservar quebras de linha reais):
// os lançamentos de cada dia vêm primeiro, atrás de um cabeçalho repetido
// "Data Hora Tipo de transação Nome Detalhe Valor (R$)", e só DEPOIS de um
// ou mais desses blocos aparecem os rótulos de data ("DD Mon, YYYY")
// correspondentes — na MESMA ORDEM dos blocos. Ou seja, a data de um bloco
// de lançamentos não vem dentro dele; é preciso casar o N-ésimo bloco de
// cabeçalho encontrado com o N-ésimo rótulo de data encontrado no texto.
//
// Exemplo real (uma página, texto normalizado):
//   "...Data Hora Tipo de transação Nome Detalhe Valor (R$)
//    03:15 Depósito de vendas Vendas Depósito InfinitePay +54,63
//    10:02 Pix Pix ANA PAULA C L SANTOS Recebido +500,00
//    ...
//    Saldo do dia + 28.596,13
//    Data Hora Tipo de transação Nome Detalhe Valor (R$)
//    10:24 Pix Pix ANA PAULA DON DI DOMIZZIO Recebido +360,00
//    ...
//    01 Jun, 2026
//    02 Jun, 2026
//    A Central de Ajuda..."
// → bloco 1 (03:15...) pertence a "01 Jun, 2026"; bloco 2 (10:24...) a "02 Jun, 2026".

const INFINITE_PAY_MONTHS: Record<string, string> = {
  Jan: '01', jan: '01',
  Fev: '02', fev: '02',
  Mar: '03', mar: '03',
  Abr: '04', abr: '04',
  Mai: '05', mai: '05',
  Jun: '06', jun: '06',
  Jul: '07', jul: '07',
  Ago: '08', ago: '08',
  Set: '09', set: '09',
  Out: '10', out: '10',
  Nov: '11', nov: '11',
  Dez: '12', dez: '12',
};

const INFINITE_PAY_MONTH_NAMES = 'Jan|Fev|Mar|Abr|Mai|Jun|Jul|Ago|Set|Out|Nov|Dez';
// "01 Jun, 2026" / "1 Jun 2026" — restrito aos nomes de mês reais para não
// casar acidentalmente com outros números seguidos de palavra no rodapé/CNPJ.
const INFINITE_PAY_DATE_RE = new RegExp(
  `\\b(\\d{1,2})\\s+(${INFINITE_PAY_MONTH_NAMES})[.,]?\\s+(\\d{4})\\b`,
  'i'
);
const INFINITE_PAY_PERIOD_RE = new RegExp(
  `\\d{1,2}\\s+(?:${INFINITE_PAY_MONTH_NAMES})[.,]?\\s+\\d{4}\\s*-\\s*\\d{1,2}\\s+(?:${INFINITE_PAY_MONTH_NAMES})[.,]?\\s+\\d{4}`,
  'i'
);
const INFINITE_PAY_TABLE_HEADER_RE =
  /Data\s+Hora\s+Tipo\s+de\s+transa[cç][ãa]o\s+Nome\s+Detalhe\s+Valor\s*\(R\$\)/i;
// "HH:MM descrição +1.234,56" — descrição não-gulosa até o primeiro valor
// com sinal explícito (todo lançamento neste extrato tem sinal + ou -).
const INFINITE_PAY_TX_RE = /(\d{2}):(\d{2})\s+([\s\S]+?)\s*([+-]\d{1,3}(?:\.\d{3})*,\d{2})/;

function extractInfinitePayMetadata(text: string): BankStatementMetadata | null {
  const contaMatch = text.match(/CLOUDWALK\s*-\s*(\d+)\s*-\s*([\d.-]+)/i);
  const periodoMatch = text.match(INFINITE_PAY_PERIOD_RE);

  let period = '01/2026';
  if (periodoMatch) {
    const m = periodoMatch[0].match(INFINITE_PAY_DATE_RE);
    if (m) {
      const monthNum = INFINITE_PAY_MONTHS[m[2]] || INFINITE_PAY_MONTHS[m[2].toLowerCase()];
      if (monthNum) period = `${monthNum}/${m[3]}`;
    }
  }

  return {
    bank_name: 'InfinitePay (Cloudwalk)',
    account_number: contaMatch ? `${contaMatch[1]} - ${contaMatch[2]}` : '000000-0',
    period,
  };
}

function cleanInfinitePayDescription(raw: string): string {
  let d = raw.replace(/\s+/g, ' ').trim();
  d = d.replace(/^Pix\s+Pix\s+/i, 'Pix ');
  d = d.replace(/\s*\(?(Enviado|Recebido|Pagamento\s+efetuado)\)?\s*$/i, '').trim();
  return d;
}

export function parseInfinitePayText(text: string): {
  transactions: ExtratoLine[];
  metadata: BankStatementMetadata | null;
} {
  const metadata = extractInfinitePayMetadata(text);

  // Normaliza espaços em branco: a extração real do PDF não preserva
  // quebras de linha entre os itens de texto (fica tudo numa "linha" só
  // por página) — normalizar deixa o parser robusto independente de como
  // o texto foi extraído.
  let normalized = text.replace(/\s+/g, ' ').trim();

  // Remove a linha do período do relatório ("01 Jun, 2026 - 30 Jun, 2026")
  // para não ser confundida com um rótulo de data de bloco de lançamentos.
  const periodMatch = normalized.match(INFINITE_PAY_PERIOD_RE);
  if (periodMatch && periodMatch.index !== undefined) {
    normalized =
      normalized.slice(0, periodMatch.index) +
      normalized.slice(periodMatch.index + periodMatch[0].length);
  }

  // 1) Posições de cada cabeçalho de tabela = início de um bloco de lançamentos.
  const headerRe = new RegExp(INFINITE_PAY_TABLE_HEADER_RE.source, 'gi');
  const headerStarts: number[] = [];
  const headerEnds: number[] = [];
  let hm: RegExpExecArray | null;
  while ((hm = headerRe.exec(normalized))) {
    headerStarts.push(hm.index);
    headerEnds.push(hm.index + hm[0].length);
  }

  if (headerStarts.length === 0) {
    return { transactions: [], metadata };
  }

  // 2) Todos os rótulos de data, na ordem em que aparecem no texto.
  const dateRe = new RegExp(INFINITE_PAY_DATE_RE.source, 'gi');
  const dateLabels: string[] = [];
  let dm: RegExpExecArray | null;
  while ((dm = dateRe.exec(normalized))) {
    const dd = dm[1].padStart(2, '0');
    const monthNum = INFINITE_PAY_MONTHS[dm[2]] || INFINITE_PAY_MONTHS[dm[2].toLowerCase()];
    const yyyy = dm[3];
    if (monthNum) dateLabels.push(`${yyyy}-${monthNum}-${dd}`);
  }

  const transactions: ExtratoLine[] = [];

  // 3) O bloco N (conteúdo entre o cabeçalho N e o cabeçalho N+1) pertence
  // ao rótulo de data N, na mesma ordem de ocorrência no documento.
  for (let i = 0; i < headerStarts.length; i++) {
    const blockStart = headerEnds[i];
    const blockEnd = i + 1 < headerStarts.length ? headerStarts[i + 1] : normalized.length;
    const blockContent = normalized.slice(blockStart, blockEnd);

    const dateIso = dateLabels[i];
    if (!dateIso) continue;

    const txRe = new RegExp(INFINITE_PAY_TX_RE.source, 'g');
    let tm: RegExpExecArray | null;
    while ((tm = txRe.exec(blockContent))) {
      const description = cleanInfinitePayDescription(tm[3]);
      const amount = parseFloat(tm[4].replace(/\./g, '').replace(',', '.'));

      if (description && description.length >= 2 && !/saldo\s+do\s+dia/i.test(description)) {
        transactions.push({
          date: dateIso,
          description,
          amount,
          raw: tm[0],
        });
      }
    }
  }

  return { transactions, metadata };
}

// ─── Banco do Brasil — Comprovante/Extrato CC (valor antes da data) ─────────
// Formato real do PDF "ComprovanteBB": os itens de texto do PDF são entregues
// na ordem visual de COLUNAS, não de linhas, o que faz com que o valor e o
// sinal (+/-) apareçam ANTES da data no texto concatenado.
//
// Padrão observado (texto normalizado):
//   "VALOR (+/-)  DD/MM/AAAA  LOTE  DOCUMENTO  HISTÓRICO"
//   Ex.: "183,00 (+) 04/05/2026   14397   11106073834502 Pix - Recebido 01/05 ..."
//
// Cada lançamento é delimitado pela posição de cada valor monetário seguido de
// "(+)" ou "(-)" seguido de uma data. Itens de "Saldo do dia" e datas
// inválidas "00/00/0000" são descartados.

const BB_COMPROVANTE_ENTRY_RE =
  /(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*\(([+-])\)\s*(\d{2}\/\d{2}\/\d{3,4})\s+([\s\S]+?)(?=(?:-?\d{1,3}(?:\.\d{3})*,\d{2}\s*\([+-]\)\s*\d{2}\/\d{2}\/\d{3,4})|$)/g;

function bbComprovanteParseAmount(raw: string, sign: string): number {
  const val = parseFloat(raw.replace(/\./g, '').replace(',', '.')) || 0;
  return sign === '-' ? -Math.abs(val) : Math.abs(val);
}

function bbComprovanteCleanDescription(raw: string): string {
  let d = raw.replace(/\s+/g, ' ').trim();
  // Remove prefixo de lote/documento: números longos no início
  d = d.replace(/^\d{3,}\s+/, '').replace(/^\d{3,}\s+/, '');
  // Remove CPF/CNPJ soltos
  d = d.replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '');
  d = d.replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, '');
  // Remove sequências de dígitos sem pontuação que sobram (documentos, lotes)
  d = d.replace(/\b\d{8,}\b/g, '');
  d = d.replace(/\s+/g, ' ').trim();
  return d;
}

function extractBBComprovanteMetadata(text: string): BankStatementMetadata | null {
  const agMatch = text.match(/Ag[êe]ncia:\s*([\d\-]+)/i);
  const contaMatch = text.match(/Conta:\s*([\d\-]+)/i);
  // Extrai datas do extrato para determinar o período
  const dates: string[] = [];
  const dateRe = /\b(\d{2})\/(\d{2})\/(\d{3,4})\b/g;
  let dm: RegExpExecArray | null;
  while ((dm = dateRe.exec(text))) {
    if (dm[1] !== '00') dates.push(`${dm[2]}/${dm[3]}`);
  }
  const period = dates.length > 0 ? dates[0] : '01/2026';

  return {
    bank_name: 'Banco do Brasil',
    account_number: contaMatch
      ? `${agMatch ? agMatch[1] + ' / ' : ''}${contaMatch[1]}`
      : '000000-0',
    period,
  };
}

/**
 * Ano predominante do extrato — usado para reconstruir a data do ÚLTIMO
 * lançamento de cada página, onde o PDF quebra o ano no meio e o texto sai com
 * 3 dígitos ("31/07/202" em vez de "31/07/2026", com o "6" caindo depois do
 * cabeçalho da página seguinte). Antes esse caso virava "20" + "02" = 2002 e o
 * lançamento ia para o TXT com ano errado (Domínio recusava a importação).
 */
function bbComprovanteAnoPredominante(text: string): string | null {
  const contagem = new Map<string, number>();
  const re = /\b\d{2}\/\d{2}\/(\d{4})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const ano = m[1];
    if (ano === '0000') continue;
    contagem.set(ano, (contagem.get(ano) ?? 0) + 1);
  }
  let melhor: string | null = null;
  let melhorQtd = 0;
  for (const [ano, qtd] of contagem) {
    if (qtd > melhorQtd) {
      melhor = ano;
      melhorQtd = qtd;
    }
  }
  return melhor;
}

/** Completa um ano truncado de 3 dígitos usando o ano predominante do extrato. */
function bbComprovanteCompletarAno(yyyy: string, anoPredominante: string | null): string {
  if (yyyy.length === 4) return yyyy;
  if (yyyy.length !== 3) return yyyy;
  if (anoPredominante) {
    // Dígito perdido no FIM (quebra de página): "202" ↔ "2026".
    if (anoPredominante.startsWith(yyyy)) return anoPredominante;
    // Dígito perdido no INÍCIO: "026" ↔ "2026".
    if (anoPredominante.endsWith(yyyy)) return anoPredominante;
  }
  // Sem referência confiável: assume que o dígito perdido foi o do início.
  return `20${yyyy.slice(1)}`;
}

export function parseBBComprovanteText(text: string): {
  transactions: ExtratoLine[];
  metadata: BankStatementMetadata | null;
} {
  const metadata = extractBBComprovanteMetadata(text);
  const anoPredominante = bbComprovanteAnoPredominante(text);

  // Truncar antes do rodapé de saldo final
  const BB_FOOTER_RE = /\bS\s+A\s+L\s+D\s+O\b|Total\s+Aplica[cç][oõ]es\s+Financeiras|Saldos\s+por\s+dia\s+Base/i;
  let normalized = text.replace(/\s+/g, ' ').trim();
  const footerMatch = normalized.match(BB_FOOTER_RE);
  if (footerMatch && footerMatch.index !== undefined) {
    normalized = normalized.slice(0, footerMatch.index).trim();
  }

  // 1) Remove linhas de Saldo Anterior e Saldo do dia para que não poluam a descrição (rest)
  // do lançamento anterior nos limites de página.
  const SALDO_LINE_RE = /(?:-?\d{1,3}(?:\.\d{3})*,\d{2}\s*\([+-]\)\s*\d{2}\/\d{2}\/\d{3,4}\s*(?:\d+)?\s*Saldo\s+(?:Anterior|do\s+dia|Final|Atual|Dispon[ií]vel)|\d{2}\/\d{2}\/\d{3,4}\s*(?:\d+)?\s*Saldo\s+(?:Anterior|do\s+dia|Final|Atual|Dispon[ií]vel)\s*-?\d{1,3}(?:\.\d{3})*,\d{2}\s*\([+-]\))/gi;
  normalized = normalized.replace(SALDO_LINE_RE, '');

  // 2) Limpa cabeçalhos de página e ruído geral do BB
  normalized = normalized.replace(/Extrato de Conta Corrente/gi, '');
  normalized = normalized.replace(/Cliente\s+[A-Z0-9\s]+LTDA/gi, '');
  normalized = normalized.replace(/Agência:\s*[\d-]+\s*Conta:\s*[\d-]+/gi, '');
  normalized = normalized.replace(/Lançamentos/gi, '');
  normalized = normalized.replace(/Dia\s+Lote\s+Documento\s+Histórico\s+Valor/gi, '');
  
  // Remove números de página soltos (ex.: " 0 " no início de página)
  normalized = normalized.replace(/\s+\b\d\b\s+/g, ' ');
  normalized = normalized.replace(/\s+/g, ' ').trim();

  const transactions: ExtratoLine[] = [];

  const re = new RegExp(BB_COMPROVANTE_ENTRY_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized))) {
    const rawAmount = m[1];
    const sign = m[2];
    const rawDate = m[3];
    const rest = m[4];

    // Descarta datas inválidas (saldo do dia)
    if (rawDate.startsWith('00/00')) continue;

    // Descarta "Saldo Anterior", "Saldo do dia" e ruídos remanescentes
    const descTest = rest.trim().toLowerCase();
    if (/^saldo\s+(anterior|do\s+dia)/i.test(rest.trim())) continue;
    if (/saldo\s+do\s+dia/i.test(descTest)) continue;
    if (/s\s+a\s+l\s+d\s+o/i.test(descTest)) continue;
    if (/aplica[cç][oõ]es\s+financeiras/i.test(descTest)) continue;

    // Formata a data de DD/MM/YYYY ou DD/MM/YYY para ISO
    const dateParts = rawDate.split('/');
    const dd = dateParts[0];
    const mm2 = dateParts[1];
    const yyyy = bbComprovanteCompletarAno(dateParts[2], anoPredominante);
    const dateIso = `${yyyy}-${mm2}-${dd}`;

    const description = bbComprovanteCleanDescription(rest);
    if (!description || description.length < 2) continue;

    const amount = bbComprovanteParseAmount(rawAmount, sign);
    transactions.push({ date: dateIso, description, amount, raw: m[0] });
  }

  return { transactions, metadata };
}

// ─── Sicredi — Extrato Texto Puro ───────────────────────────────────────────
// Layout do extrato Sicredi quando o PDF entrega texto puro legível (sem
// precisar de coordenadas X/Y). Formato de cada linha (texto normalizado):
//   "DD/MM/AAAA   DESCRIÇÃO   DOCUMENTO   VALOR(R$)   SALDO(R$)"
//   Ex.: "04/05/2026   RECEBIMENTO PIX 93378300191 THIAGO   PIX_CRED   35,00   -12,34"
//
// Peculiaridades:
// - Datas do período no cabeçalho (ex.: "01/05/2026 a 31/05/2026") seriam
//   capturadas como transações se não delimitarmos o escopo pela posição do
//   cabeçalho da tabela "Data Descrição Documento Valor (R$) Saldo (R$)".
// - Códigos de documento (PIX_CRED, PIX_DEB, CXnnnnn, Cnnnnn, etc.) ficam
//   ANTES dos valores monetários e precisam ser removidos da descrição.
// - Rodapé de telefone "Sicredi Fone 0800..." no final deve ser descartado.

const SICREDI_TEXT_TABLE_HEADER_RE =
  /Data\s+Descri[cç][aã]o\s+Documento\s+Valor\s*\(R\$\)\s*Saldo\s*\(R\$\)/i;
const SICREDI_TEXT_FOOTER_RE = /Sicredi\s+Fone|SAC\s+0800|Ouvidoria\s+0800/i;
const SICREDI_TEXT_DATE_RE = /\b(\d{2})\/(\d{2})\/(\d{4})\b/g;
const SICREDI_TEXT_MONEY_RE = /-?\d{1,3}(?:\.\d{3})*,\d{2}/g;

function extractSicrediTextMetadata(text: string): BankStatementMetadata | null {
  const contaMatch = text.match(/Conta:\s*([\d\-]+)/i);
  const periodoMatch = text.match(/Per[íi]odo\s+de\s+(\d{2})\/(\d{2})\/(\d{4})\s+a\s+\d{2}\/\d{2}\/\d{4}/i);
  return {
    bank_name: 'Sicredi',
    account_number: contaMatch ? contaMatch[1] : '000000-0',
    period: periodoMatch ? `${periodoMatch[2]}/${periodoMatch[3]}` : '01/2026',
  };
}

// Remove código de documento Sicredi (token que aparece entre a descrição
// e os valores monetários). Ex.: PIX_CRED, PIX_DEB, CX517607, C41630102,
// 262189857, PIX_CRE — sempre imediatamente antes do primeiro valor.
function sicrediTextCleanDescription(raw: string): string {
  let d = raw.replace(/\s+/g, ' ').trim();
  // Remove código de documento no final:
  // - Tokens com underline: PIX_CRED, PIX_DEB, PIX_CRE, etc.
  // - Tokens alfanuméricos tipo C41630102, CX517607, CX39872
  // - Sequências numéricas longas (número de documento/boleto)
  d = d.replace(/\s+(?:PIX_\w+|[A-Z]{1,3}\d{4,}|\d{6,})$/i, '');
  d = d.replace(/\s+/g, ' ').trim();
  return d;
}

export function parseSicrediText(text: string): {
  transactions: ExtratoLine[];
  metadata: BankStatementMetadata | null;
} {
  const metadata = extractSicrediTextMetadata(text);
  let normalized = text.replace(/\s+/g, ' ').trim();

  // 1) Delimitar escopo: começa APÓS o cabeçalho da tabela de lançamentos,
  //    para ignorar datas do período no cabeçalho.
  const headerMatch = normalized.match(SICREDI_TEXT_TABLE_HEADER_RE);
  const scopeStart = headerMatch
    ? (headerMatch.index ?? 0) + headerMatch[0].length
    : 0;

  // 2) Termina antes do rodapé telefônico do Sicredi.
  const footerMatch = normalized.slice(scopeStart).match(SICREDI_TEXT_FOOTER_RE);
  const scopeEnd = footerMatch && footerMatch.index !== undefined
    ? scopeStart + footerMatch.index
    : normalized.length;

  const scoped = normalized.slice(scopeStart, scopeEnd).trim();
  const transactions: ExtratoLine[] = [];

  // 3) Coletar todas as posições de datas (DD/MM/AAAA) dentro do escopo
  const dateRe = new RegExp(SICREDI_TEXT_DATE_RE.source, 'g');
  const dateMatches: { index: number; end: number; dateIso: string }[] = [];
  let dm: RegExpExecArray | null;
  while ((dm = dateRe.exec(scoped))) {
    const dateIso = `${dm[3]}-${dm[2]}-${dm[1]}`;
    dateMatches.push({ index: dm.index, end: dm.index + dm[0].length, dateIso });
  }

  for (let i = 0; i < dateMatches.length; i++) {
    const start = dateMatches[i].end;
    const end = i + 1 < dateMatches.length ? dateMatches[i + 1].index : scoped.length;
    const chunk = scoped.slice(start, end).trim();

    // Descarta linhas de saldo inicial/final sem transação
    if (/^SALDO\s+ANTERIOR/i.test(chunk)) continue;
    if (/^SALDO\s+(TOTAL|FINAL|DO\s+DIA)/i.test(chunk)) continue;

    // Extrai todos os valores monetários do chunk
    const moneyRe = new RegExp(SICREDI_TEXT_MONEY_RE.source, 'g');
    const moneyMatches: RegExpExecArray[] = [];
    let mm: RegExpExecArray | null;
    while ((mm = moneyRe.exec(chunk))) moneyMatches.push(mm);

    if (moneyMatches.length < 1) continue;

    // Penúltimo = Valor do lançamento, último = Saldo (informativo)
    const valorMatch = moneyMatches.length >= 2
      ? moneyMatches[moneyMatches.length - 2]
      : moneyMatches[0];
    const saldoMatch = moneyMatches.length >= 2
      ? moneyMatches[moneyMatches.length - 1]
      : null;

    // Tudo antes do valor monetário é Descrição + Documento
    const rawDesc = chunk.slice(0, valorMatch.index);
    const description = sicrediTextCleanDescription(rawDesc);
    if (!description || description.length < 2) continue;

    const amount = parseFloat(valorMatch[0].replace(/\./g, '').replace(',', '.'));
    const balance = saldoMatch
      ? parseFloat(saldoMatch[0].replace(/\./g, '').replace(',', '.'))
      : undefined;

    transactions.push({
      date: dateMatches[i].dateIso,
      description,
      amount,
      balance,
      raw: chunk,
    });
  }

  return { transactions, metadata };
}

// ─── InfinitePay JSON Parser ────────────────────────────────────────────
// Parse JSON directly from InfinitePay API/export format

export interface InfinitePayJSONTransaction {
  date: string; // YYYY-MM-DD format
  description: string;
  amount: number;
  balance: number | null;
  category: string;
}

export interface InfinitePayJSONInput {
  transactions: InfinitePayJSONTransaction[];
  metadata: {
    bank_name: string;
    account_number: string;
    period: string;
  };
}

export function parseInfinitePayJSON(data: InfinitePayJSONInput): {
  transactions: ExtratoLine[];
  metadata: BankStatementMetadata | null;
} {
  const transactions: ExtratoLine[] = [];

  for (const tx of data.transactions) {
    transactions.push({
      date: tx.date,
      description: tx.description,
      amount: tx.amount,
      balance: tx.balance ?? undefined,
      raw: JSON.stringify(tx),
    });
  }

  const metadata: BankStatementMetadata = {
    bank_name: data.metadata.bank_name,
    account_number: data.metadata.account_number,
    period: data.metadata.period,
  };

  return { transactions, metadata };
}

// ─── Bradesco Net Empresa Parser ────────────────────────────────────────

function extractBradescoMetadata(text: string): BankStatementMetadata | null {
  const agMatch =
    text.match(/Ag:\s*([\d\-]+)\s*\|\s*CC:\s*([\d\-]+)/i) ||
    text.match(/Agência\s*\|\s*Conta\s+([\d\-]+)\s*\|\s*([\d\-]+)/i);

  const ag = agMatch ? agMatch[1] : '';
  const cc = agMatch ? agMatch[2] : '';

  // Extrai datas para determinar o período (MM/YYYY)
  const lines = text.split(/\r?\n/);
  let period = '';
  const dateRe = /^\s*(\d{2})\/(\d{2})\/(\d{4})\b/;
  for (const line of lines) {
    const m = line.match(dateRe);
    if (m && m[1] !== '00') {
      period = `${m[2]}/${m[3]}`;
      break;
    }
  }
  if (!period) {
    period = '02/2026';
  }

  return {
    bank_name: 'Bradesco',
    account_number: ag && cc ? `${ag} / ${cc}` : '00000-0 / 0000000-0',
    period,
  };
}

export function parseBradescoText(text: string): {
  transactions: ExtratoLine[];
  metadata: BankStatementMetadata | null;
} {
  const metadata = extractBradescoMetadata(text);
  const lines = text.split(/\r?\n/).map((l) => l.trim());

  let currentDate = '';
  let accumulatedDesc: string[] = [];
  const transactions: ExtratoLine[] = [];

  const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})\b/;
  const VALUES_RE = /(-?\d{1,3}(?:\.\d{3})*,\d{2})\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;
  const DOC_RE = /\b(\d{3,8})\b\s*$/;

  for (let line of lines) {
    if (!line) continue;

    // Ignora cabeçalhos, rodapés e ruídos óbvios do Bradesco
    if (line.includes('|')) continue;
    if (line.includes('Total Disponível') || line.includes('Total (R$)')) continue;
    if (/^total\b/i.test(line)) continue;
    if (/saldo\s+invest/i.test(line)) continue;
    if (/lançamentos\s+futuros/i.test(line)) continue;
    if (/os\s+dados\s+acima/i.test(line)) continue;
    if (/últimos\s+lançamentos/i.test(line)) continue;
    if (/comercial\s*fernandes/i.test(line)) continue;
    if (/nome\s*do\s*usuário/i.test(line)) continue;
    if (/data\s*da\s*operação/i.test(line)) continue;
    if (/extrato\s*de:\s*ag:/i.test(line)) continue;
    if (/data\s+lançamento\s+dcto/i.test(line)) continue;
    if (/saldo\s+anterior/i.test(line)) continue;
    if (/não\s+há\s+lançamentos\s+para\s+este\s+tipo/i.test(line)) continue;

    // 1) Tratamento de Data
    const dateMatch = line.match(DATE_RE);
    if (dateMatch) {
      const [dd, mm, yyyy] = dateMatch[0].split('/');
      currentDate = `${yyyy}-${mm}-${dd}`;
      line = line.replace(DATE_RE, '').trim();
    }

    // 2) Tratamento de Valores (Valor de transação + Saldo)
    const valuesMatch = line.match(VALUES_RE);
    if (valuesMatch) {
      const rawAmount = valuesMatch[1];
      const rawBalance = valuesMatch[2];

      let cleanLine = line.replace(VALUES_RE, '').trim();

      // Tratamento de Documento
      const docMatch = cleanLine.match(DOC_RE);
      let doc = '';
      if (docMatch) {
        doc = docMatch[1];
        cleanLine = cleanLine.replace(DOC_RE, '').trim();
      }

      if (cleanLine) {
        accumulatedDesc.push(cleanLine);
      }

      const description = accumulatedDesc.join(' ').replace(/\s+/g, ' ').trim();
      accumulatedDesc = [];

      const amount = parseFloat(rawAmount.replace(/\./g, '').replace(',', '.')) || 0;
      const balance = parseFloat(rawBalance.replace(/\./g, '').replace(',', '.')) || 0;

      const finalDescription = doc ? `${description} Dcto: ${doc}` : description;

      if (currentDate && finalDescription.length >= 2) {
        transactions.push({
          date: currentDate,
          description: finalDescription,
          amount,
          balance,
          raw: line,
        });
      }
    } else {
      // Apenas acumula descrição se a linha contiver pelo menos uma letra (evita ruídos puramente numéricos)
      if (/[a-zA-ZÀ-ÿ]/.test(line)) {
        accumulatedDesc.push(line);
      }
    }
  }

  // Deduplica transações idênticas (mesma data, documento e valor)
  const uniqueTransactions: ExtratoLine[] = [];
  const seenKeys = new Set<string>();
  const docRegex = /Dcto:\s*(\d+)/i;
  for (const tx of transactions) {
    const description = tx.description ?? '';
    const docMatch = description.match(docRegex);
    const docId = docMatch ? docMatch[1] : '';
    const key = docId ? `${tx.date}_${docId}_${tx.amount}` : `${tx.date}_${description}_${tx.amount}`;
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    uniqueTransactions.push(tx);
  }

  return { transactions: uniqueTransactions, metadata };
}

export function parseBradescoWords(pages: PdfWord[][]): {
  transactions: ExtratoLine[];
  metadata: BankStatementMetadata | null;
} {
  const lines: string[] = [];

  for (const pageWords of pages) {
    // Agrupa por linha usando o y0 com tolerância de 2.0 pt para colunas desalinhadas
    const rows = new Map<string, PdfWord[]>();
    for (const w of pageWords) {
      const key = (Math.round(w.y0 / 2) * 2).toString();
      const arr = rows.get(key) ?? [];
      arr.push(w);
      rows.set(key, arr);
    }

    // Ordena as linhas do topo para o rodapé (Y decrescente)
    const sortedKeys = Array.from(rows.keys()).sort((a, b) => parseFloat(b) - parseFloat(a));

    for (const key of sortedKeys) {
      const rowWords = rows.get(key) ?? [];
      // Ordena as palavras da esquerda para a direita (X crescente)
      const sortedWords = [...rowWords].sort((a, b) => a.x0 - b.x0);
      lines.push(sortedWords.map((w) => w.str).join(' '));
    }
  }

  const fullText = lines.join('\n');
  return parseBradescoText(fullText);
}


// ─── Cresol ─────────────────────────────────────────────────────────────────
// Extrato do internet banking Cresol (PDF com texto nativo). Cada lançamento
// ocupa alturas diferentes na página: o histórico começa em x≈146 e pode
// quebrar numa segunda linha, a data do lançamento fica numa coluna estreita
// à esquerda (x≈84) e o valor com sinal fica à direita (x≥430). Além disso,
// cada dia tem um cabeçalho "DD/MM/AAAA ... Saldo do Dia: + R$ X" cuja data
// fica mais à esquerda ainda (x≈60) — por isso a âncora de cada transação é
// a data da coluna do meio, e a faixa vertical em volta dela reúne histórico
// e valor do mesmo lançamento.

const CRESOL_DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;
const CRESOL_ANCHOR_X = [78, 142] as const;   // data do lançamento
const CRESOL_HIST_X = [142, 430] as const;    // histórico (1 ou 2 linhas)
const CRESOL_VALOR_X = 430;                   // a partir daqui, valor com sinal
const CRESOL_ROW_TOLERANCE = 14;              // meia-altura da faixa do lançamento
const CRESOL_VALOR_RE = /([+-])\s*R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/;

function cresolInRange(x: number, [min, max]: readonly [number, number]): boolean {
  return x >= min && x < max;
}

function extractCresolMetadata(pages: PdfWord[][]): BankStatementMetadata {
  const joined = pages.flat().map((w) => w.str).join(' ').replace(/\s+/g, ' ');

  const contaMatch = joined.match(/Conta\s*(\d{5,9}-\d)/i);
  const agenciaMatch = joined.match(/Ag[êe]ncia\s*(\d{3,5})/i);
  const periodoMatch = joined.match(/Periodo de \d{2}\/(\d{2})\/(\d{4})/i);

  const conta = contaMatch ? contaMatch[1] : '000000-0';
  return {
    bank_name: 'Cresol',
    account_number: agenciaMatch ? `${agenciaMatch[1]}/${conta}` : conta,
    period: periodoMatch ? `${periodoMatch[1]}/${periodoMatch[2]}` : '01/2026',
  };
}

export function parseCresolWords(pages: PdfWord[][]): {
  transactions: ExtratoLine[];
  metadata: BankStatementMetadata | null;
} {
  const transactions: ExtratoLine[] = [];

  for (const words of pages) {
    const anchors = words
      .filter((w) => cresolInRange(w.x0, CRESOL_ANCHOR_X) && CRESOL_DATE_RE.test(w.str.trim()))
      // topo → rodapé (no pdf.js o eixo Y cresce para cima)
      .sort((a, b) => b.y0 - a.y0);

    for (const anchor of anchors) {
      const banda = words.filter((w) => Math.abs(w.y0 - anchor.y0) <= CRESOL_ROW_TOLERANCE);

      const valorRaw = banda
        .filter((w) => w.x0 >= CRESOL_VALOR_X)
        .sort((a, b) => a.x0 - b.x0)
        .map((w) => w.str.trim())
        .join(' ');
      const valorMatch = CRESOL_VALOR_RE.exec(valorRaw);
      if (!valorMatch) continue;
      const amountAbs = parseAmountBr(valorMatch[2]);
      if (!amountAbs) continue;

      const description = banda
        .filter((w) => cresolInRange(w.x0, CRESOL_HIST_X))
        // histórico quebrado em duas linhas: a de cima primeiro, depois da esquerda p/ direita
        .sort((a, b) => (Math.abs(a.y0 - b.y0) > 1 ? b.y0 - a.y0 : a.x0 - b.x0))
        .map((w) => w.str.trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!description) continue;

      const [dd, mm, yyyy] = anchor.str.trim().split('/');
      transactions.push({
        date: `${yyyy}-${mm}-${dd}`,
        description,
        amount: valorMatch[1] === '-' ? -amountAbs : amountAbs,
        raw: `${anchor.str} ${description} ${valorRaw}`.trim(),
      });
    }
  }

  return { transactions, metadata: extractCresolMetadata(pages) };
}

// ─── Caixa (Gerenciador CAIXA — "Extrato por período") ─────────────────────
// Impressão do Gerenciador Financeiro (gerenciador.caixa.gov.br), layout de
// tabela simples: Data Mov. | Nr. Doc. | Histórico | Valor | Saldo, uma linha
// por lançamento (sem quebra de histórico, sem favorecido e sem CPF/CNPJ).
// Valor e Saldo vêm alinhados à direita com o sinal C/D colado no fim do
// token ("1.520,00 D"), e cada dia termina com uma linha "SALDO DIA" de valor
// 0,00 que não é lançamento.

const CAIXA_GER_DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const CAIXA_GER_MONEY_RE = /^(\d{1,3}(?:\.\d{3})*,\d{2})\s*([CD])$/i;
/** Valor sem o indicador de natureza — em impressões digitalizadas ele vem em outro token. */
const CAIXA_GER_MONEY_ONLY_RE = /^(\d{1,3}(?:\.\d{3})*,\d{2})$/;
const CAIXA_GER_ROW_TOLERANCE = 3;

// Colunas do PDF (pontos, origem à esquerda): Data ~40, Nr.Doc ~102,
// Histórico ~168, Valor ~375-395 (alinhado à direita em ~400), Saldo ~499.
const CAIXA_GER_COL_DATE = [30, 90] as const;
const CAIXA_GER_COL_DOC = [92, 150] as const;
const CAIXA_GER_COL_HISTORICO = [150, 340] as const;
const CAIXA_GER_VALOR_SALDO_SPLIT_X = 460;

function caixaGerMoneyToNumber(raw: string): number {
  return parseFloat(raw.replace(/\./g, '').replace(',', '.')) || 0;
}

function extractCaixaGerenciadorMetadata(
  pages: PdfWord[][],
  transactions: ExtratoLine[] = [],
): BankStatementMetadata | null {
  const joined = pages.flat().map((w) => w.str).join(' ');

  // "Conta: 1827 | 1292 | 000579015952-0" → usa o número da conta (último campo).
  const contaMatch = joined.match(/\b(\d{6,}-\d)\b/);
  // Período real vem da URL de impressão (hdnDataInicio=01/05/2026) ou de
  // "Mês: Maio/2026"; o primeiro é mais confiável por já vir em números.
  const urlMatch = joined.match(/hdnDataInicio=(\d{2})\/(\d{2})\/(\d{4})/);

  let period: string | null = urlMatch ? `${urlMatch[2]}/${urlMatch[3]}` : null;
  if (!period) {
    // "Mês:" sai como "Mis :", "Més :" etc. em impressão digitalizada — aceita a variação da
    // vogal e o espaço antes dos dois-pontos.
    const mesMatch = joined.match(/\bM[êeéiè]s\s*:\s*([A-Za-zçÇ]+)\s*\/\s*(\d{4})/i);
    const mm = mesMatch ? CAIXA_APP_MONTHS[mesMatch[1].toLowerCase()] : undefined;
    if (mesMatch && mm) period = `${mm}/${mesMatch[2]}`;
  }
  if (!period) {
    // Último recurso: a competência dos próprios lançamentos. Bem mais confiável do que um
    // padrão fixo — o cabeçalho pode estar ilegível, mas as datas das linhas não estão.
    const contagem = new Map<string, number>();
    for (const t of transactions) {
      const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(t.date ?? ''));
      if (!m) continue;
      const chave = `${m[2]}/${m[1]}`;
      contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
    }
    const maisFrequente = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0];
    if (maisFrequente) period = maisFrequente[0];
  }

  return {
    bank_name: 'Caixa Econômica Federal',
    account_number: contaMatch ? contaMatch[1] : '000000-0',
    period: period ?? '01/2026',
  };
}

export function parseCaixaGerenciadorWords(pages: PdfWord[][]): {
  transactions: ExtratoLine[];
  metadata: BankStatementMetadata | null;
} {
  const transactions: ExtratoLine[] = [];

  for (const words of pages) {
    // Agrupa por linha visual (Y), já que cada lançamento ocupa uma única linha.
    const rows = new Map<number, PdfWord[]>();
    for (const w of words) {
      let key: number | null = null;
      for (const y of rows.keys()) {
        if (Math.abs(y - w.y0) <= CAIXA_GER_ROW_TOLERANCE) {
          key = y;
          break;
        }
      }
      if (key === null) {
        key = w.y0;
        rows.set(key, []);
      }
      rows.get(key)!.push(w);
    }

    const orderedRows = [...rows.entries()].sort((a, b) => b[0] - a[0]);

    for (const [, rowWords] of orderedRows) {
      const sorted = [...rowWords].sort((a, b) => a.x0 - b.x0);

      const dateWord = sorted.find(
        (w) => caixaInRange(w.x0, CAIXA_GER_COL_DATE) && CAIXA_GER_DATE_RE.test(w.str.trim())
      );
      if (!dateWord) continue;
      const [, dd, mm, yyyy] = CAIXA_GER_DATE_RE.exec(dateWord.str.trim())!;

      const historicoWords: string[] = [];
      let valorAmount: number | null = null;
      let saldoAmount: number | null = null;
      /** Índices já usados como indicador C/D de um valor anterior. */
      const consumidos = new Set<number>();

      const guardaValor = (x: number, signed: number) => {
        if (x >= CAIXA_GER_VALOR_SALDO_SPLIT_X) saldoAmount = signed;
        else valorAmount = signed;
      };

      for (let i = 0; i < sorted.length; i++) {
        const w = sorted[i]!;
        if (w === dateWord || consumidos.has(i)) continue;
        const str = w.str.trim();
        if (!str) continue;

        if (caixaInRange(w.x0, CAIXA_GER_COL_DOC)) continue; // Nr. Doc não entra na descrição

        const normalizado = str.replace('С', 'C').replace('с', 'c');

        const money = CAIXA_GER_MONEY_RE.exec(normalizado);
        if (money) {
          const value = caixaGerMoneyToNumber(money[1]);
          guardaValor(w.x0, caixaNormalizeSign(money[2]) === 'D' ? -value : value);
          continue;
        }

        // Valor e indicador em tokens separados ("17,63" seguido de "C"), como sai das
        // impressões digitalizadas do Gerenciador.
        const somenteValor = CAIXA_GER_MONEY_ONLY_RE.exec(normalizado);
        if (somenteValor) {
          const proximo = sorted[i + 1];
          const sinal = proximo ? caixaNormalizeSign(proximo.str) : null;
          // Sem indicador não dá para saber se é débito ou crédito: melhor ignorar o valor do
          // que arriscar inverter o lançamento.
          if (sinal) {
            const value = caixaGerMoneyToNumber(somenteValor[1]);
            guardaValor(w.x0, sinal === 'D' ? -value : value);
            consumidos.add(i + 1);
          }
          continue;
        }

        // Um "C"/"D" solto que não seguiu um valor não é histórico
        if (caixaNormalizeSign(str)) continue;

        if (caixaInRange(w.x0, CAIXA_GER_COL_HISTORICO)) historicoWords.push(str);
      }

      const historico = historicoWords.join(' ').replace(/\s+/g, ' ').trim();
      if (!historico) continue;
      if (/^SALDO\s+(DIA|ANTERIOR)$/i.test(historico)) continue;
      if (/^hist[óo]rico$/i.test(historico)) continue; // cabeçalho da tabela
      if (valorAmount === null || valorAmount === 0) continue;

      transactions.push({
        date: `${yyyy}-${mm}-${dd}`,
        description: historico,
        amount: valorAmount,
        balance: saldoAmount ?? undefined,
        raw: sorted.map((w) => w.str).join(' '),
      });
    }
  }

  return { transactions, metadata: extractCaixaGerenciadorMetadata(pages, transactions) };
}
