/**
 * Parser de extratos de aplicação financeira (Sicredi e assemelhados).
 *
 * Empiricamente, extratos de "Aplicação" do Sicredi aparecem em dois layouts
 * (validado contra 3 PDFs reais de um cliente em 07/2026):
 *
 * 1) "Movimento Poupança" — layout linha a linha, com Data / Histórico / Valor / Saldo,
 *    ex.: "10/07/2026 CAPITALIZ. REND. JR 10,04 10.816,12". O sinal (entrada/saída)
 *    não vem explícito — é derivado comparando o saldo da linha com o saldo da linha
 *    anterior (saldo sobe = entrada, desce = saída).
 *
 * 2) "Depósito a Prazo - Detalhado" (Sicredinvest Exclusivo/Automático) — não é um
 *    extrato linha a linha, é um resumo mensal com colunas fixas: Aplicações, Resgates,
 *    Rendimentos Pagos, IRRF, IOF, No Mês (rendimento do mês), Acumulado, Saldo Atual.
 *    Aqui não há "histórico" por lançamento; extrai-se direto o resumo do período.
 */

export type AplicacaoExtratoRow = {
  data: string; // dd/MM/yyyy
  historico: string;
  entrada: number;
  saida: number;
  saldo: number | null;
};

export type AplicacaoExtratoParseResult = {
  layout: 'movimento' | 'deposito_prazo' | 'desconhecido';
  rows: AplicacaoExtratoRow[];
  saldoAnterior: number | null;
  totalEntradas: number;
  totalSaidas: number;
  saldoFinal: number | null;
  produto?: string;
};

function toNumber(raw: string): number {
  const clean = raw
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '')
    .trim();
  const n = parseFloat(clean);
  return Number.isFinite(n) ? n : 0;
}

const MONEY = /-?\d{1,3}(?:\.\d{3})*,\d{2}/g;

function findFirst(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m ? m[1] ?? m[0] : null;
}

/** Detecta o layout a partir do texto extraído (pdfjs / OCR) da 1ª página. */
export function detectAplicacaoExtratoLayout(text: string): 'movimento' | 'deposito_prazo' | 'desconhecido' {
  const norm = text.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  if (/Movimento\s+Poupan/i.test(norm) || /Movimenta[cç][aã]o[\s\S]{0,20}Data\s+Hist/i.test(norm)) {
    return 'movimento';
  }
  if (/Dep[oó]sito\s+a\s+Prazo/i.test(norm) || /Aplica[cç][oõ]es\s+Resgates\s+Rendimentos/i.test(norm)) {
    return 'deposito_prazo';
  }
  return 'desconhecido';
}

/** Layout 1: linha a linha (Movimento Poupança). */
function parseMovimento(text: string): AplicacaoExtratoParseResult {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const rows: AplicacaoExtratoRow[] = [];
  const dateRe = /^(\d{2}\/\d{2}\/\d{4})\s+(.+)$/;
  let saldoAnterior: number | null = null;
  let prevSaldo: number | null = null;

  for (const line of lines) {
    const m = line.match(dateRe);
    if (!m) continue;
    const data = m[1];
    const rest = m[2];
    const valores = rest.match(MONEY);
    if (!valores || valores.length < 1) continue;
    // Última ocorrência é o saldo; penúltima (se houver) é o valor do movimento.
    const saldo = toNumber(valores[valores.length - 1]);
    const valor = valores.length >= 2 ? toNumber(valores[valores.length - 2]) : Math.abs(saldo - (prevSaldo ?? saldo));
    const histFimIdx = rest.search(MONEY);
    const historico = (histFimIdx > 0 ? rest.slice(0, histFimIdx) : rest).trim();

    if (/SALDO\s+ANTERIOR/i.test(historico)) {
      saldoAnterior = saldo;
      prevSaldo = saldo;
      continue;
    }
    if (/SALDO\s+ATUAL/i.test(historico)) {
      prevSaldo = saldo;
      continue;
    }

    let entrada = 0;
    let saida = 0;
    if (prevSaldo != null) {
      const delta = saldo - prevSaldo;
      if (delta >= 0) entrada = Math.abs(valor) || delta;
      else saida = Math.abs(valor) || Math.abs(delta);
    } else {
      // Sem referência de saldo anterior: usa palavras-chave do histórico.
      if (/RESGATE|SAIDA|IRRF|IOF|TARIFA|DEBITO/i.test(historico)) saida = Math.abs(valor);
      else entrada = Math.abs(valor);
    }

    rows.push({ data, historico, entrada, saida, saldo });
    prevSaldo = saldo;
  }

  const totalEntradas = rows.reduce((s, r) => s + r.entrada, 0);
  const totalSaidas = rows.reduce((s, r) => s + r.saida, 0);
  const saldoFinal = rows.length > 0 ? rows[rows.length - 1].saldo : saldoAnterior;

  return {
    layout: 'movimento',
    rows,
    saldoAnterior,
    totalEntradas,
    totalSaidas,
    saldoFinal,
  };
}

/** Layout 2: resumo mensal (Depósito a Prazo - Detalhado). */
function parseDepositoPrazo(text: string): AplicacaoExtratoParseResult {
  const norm = text.replace(/\r/g, '');
  const saldoAnteriorRaw = findFirst(norm, /(\d{1,3}(?:\.\d{3})*,\d{2})\s*[\s ]*30?\/?\d*\/?\d*Saldo\s+Anterior/i)
    ?? findFirst(norm, /Saldo\s+Anterior:?[\s ]*(\d{1,3}(?:\.\d{3})*,\d{2})/i);
  const saldoAnterior = saldoAnteriorRaw ? toNumber(saldoAnteriorRaw) : null;

  // Linha de totais mensais: "07/2026 <Aplicações> <Resgates> <RendPagos> <IRRF> <IOF> <NoMes> <Acumulado> <SaldoAtual>"
  const totaisLine = norm.match(/\d{2}\/\d{4}\s+((?:\d[\d.,]*\s+){6,7}\d[\d.,]*)/);
  let totalEntradas = 0;
  let totalSaidas = 0;
  let saldoFinal: number | null = null;
  if (totaisLine) {
    const nums = totaisLine[1].match(MONEY.source ? new RegExp(MONEY.source, 'g') : MONEY) ?? totaisLine[1].split(/\s+/);
    const values = (totaisLine[1].match(/\d{1,3}(?:\.\d{3})*,\d{2}/g) ?? []).map(toNumber);
    if (values.length >= 8) {
      totalEntradas = values[0];
      totalSaidas = values[1];
      saldoFinal = values[values.length - 1];
    } else if (values.length >= 2) {
      totalEntradas = values[0];
      totalSaidas = values[1];
    }
    void nums;
  }
  if (saldoFinal == null) {
    const saldoAtualRaw = findFirst(norm, /Saldo\s+Atual\s+(\d{1,3}(?:\.\d{3})*,\d{2})/i);
    if (saldoAtualRaw) saldoFinal = toNumber(saldoAtualRaw);
  }

  const produto = findFirst(norm, /Produto:\s*\n?\s*\n?([A-Z0-9 ]+)/) ?? undefined;

  const rows: AplicacaoExtratoRow[] = [];
  if (totalEntradas > 0) {
    rows.push({ data: '', historico: 'APLICAÇÕES NO PERÍODO', entrada: totalEntradas, saida: 0, saldo: null });
  }
  if (totalSaidas > 0) {
    rows.push({ data: '', historico: 'RESGATES NO PERÍODO', entrada: 0, saida: totalSaidas, saldo: null });
  }

  return {
    layout: 'deposito_prazo',
    rows,
    saldoAnterior,
    totalEntradas,
    totalSaidas,
    saldoFinal,
    produto: produto?.trim(),
  };
}

/** Entry point: recebe o texto extraído do PDF (via pdfjs, com texto selecionável, ou via OCR) e devolve o resultado normalizado. */
export function parseAplicacaoExtratoText(text: string): AplicacaoExtratoParseResult {
  const layout = detectAplicacaoExtratoLayout(text);
  if (layout === 'movimento') return parseMovimento(text);
  if (layout === 'deposito_prazo') return parseDepositoPrazo(text);
  // Tenta o parser linha-a-linha como fallback (mais genérico).
  const fallback = parseMovimento(text);
  if (fallback.rows.length > 0) return { ...fallback, layout: 'desconhecido' };
  return {
    layout: 'desconhecido',
    rows: [],
    saldoAnterior: null,
    totalEntradas: 0,
    totalSaidas: 0,
    saldoFinal: null,
  };
}

/** Extrai o texto da 1ª(s) página(s) de um PDF usando pdfjs (mesma lib já usada no projeto). */
export async function extractPdfText(file: File, maxPages = 5): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const pages = Math.min(pdf.numPages, maxPages);
  let out = '';
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = (content.items as Array<{ str?: string }>).map((it) => it.str ?? '');
    out += strings.join(' ') + '\n';
  }
  return out;
}
