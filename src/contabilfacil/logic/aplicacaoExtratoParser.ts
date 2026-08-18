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
  /**
   * Provisão: rendimento ainda não pago e imposto ainda não retido. Fica de
   * fora da conciliação, dos totais e do TXT enquanto não for desbloqueado —
   * lançar provisão é decisão de quem fecha o mês, não do extrato.
   */
  provisionado?: boolean;
  /** Provisão que o usuário liberou para lançar. */
  desbloqueado?: boolean;
};

/** Uma provisão só conta quando foi liberada na tela. */
export function aplicacaoRowEntraNaContabilidade(row: AplicacaoExtratoRow): boolean {
  return !row.provisionado || row.desbloqueado === true;
}

/**
 * Bloco "Posição para Saque" do Depósito a Prazo Detalhado (Sicredi).
 * Só os valores de movimento: rendimentos provisionados e provisões de IRRF/IOF.
 * Saldos (atual, bruto, líquido, anterior e final) NÃO são extraídos deste
 * layout — são sempre digitados à mão nos cards do extrato.
 */
export type AplicacaoPosicaoSaque = {
  /** Data de "Posição em dd/MM/yyyy". */
  data: string;
  rendimentosProvisionados: number | null;
  provisaoIRRF: number | null;
  provisaoIOF: number | null;
};

export type AplicacaoExtratoParseResult = {
  layout: 'movimento' | 'deposito_prazo' | 'desconhecido';
  rows: AplicacaoExtratoRow[];
  saldoAnterior: number | null;
  totalEntradas: number;
  totalSaidas: number;
  saldoFinal: number | null;
  produto?: string;
  posicaoSaque?: AplicacaoPosicaoSaque;
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

/**
 * Um lançamento do Movimento Poupança: data, histórico, valor e saldo.
 *
 * Casa sobre o texto corrido, não linha a linha, porque o PDF chega aqui de
 * duas formas diferentes e as duas precisam funcionar: o `extractPdfText` junta
 * a página inteira numa linha só (`items.join(' ')`), enquanto o OCR e a
 * extração nativa devolvem uma célula por linha. Como `\s` cobre o espaço e a
 * quebra de linha, o mesmo padrão atende os dois. O histórico é barrado de
 * engolir a próxima data, o que colaria dois lançamentos num só.
 */
const MOVIMENTO_LANCAMENTO =
  /(\d{2}\/\d{2}\/\d{4})\s+((?:(?!\d{2}\/\d{2}\/\d{4})[^\d])+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})/g;

/** Layout 1: Movimento Poupança (Data · Histórico · Valor · Saldo). */
function parseMovimento(text: string): AplicacaoExtratoParseResult {
  const rows: AplicacaoExtratoRow[] = [];
  let saldoAnterior: number | null = null;
  let saldoAtual: number | null = null;
  let prevSaldo: number | null = null;

  MOVIMENTO_LANCAMENTO.lastIndex = 0;
  for (let m = MOVIMENTO_LANCAMENTO.exec(text); m; m = MOVIMENTO_LANCAMENTO.exec(text)) {
    const data = m[1];
    const historico = m[2].replace(/\s+/g, ' ').trim();
    const valor = toNumber(m[3]);
    const saldo = toNumber(m[4]);
    if (!historico) continue;

    if (/SALDO\s+ANTERIOR/i.test(historico)) {
      saldoAnterior = saldo;
      prevSaldo = saldo;
      continue;
    }
    if (/SALDO\s+(ATUAL|FINAL)/i.test(historico)) {
      saldoAtual = saldo;
      prevSaldo = saldo;
      continue;
    }

    let entrada = 0;
    let saida = 0;
    if (prevSaldo != null) {
      // O extrato não marca o sinal: quem diz se entrou ou saiu é o saldo, que
      // sobe no rendimento e desce no encargo.
      const delta = saldo - prevSaldo;
      if (delta >= 0) entrada = Math.abs(valor) || delta;
      else saida = Math.abs(valor) || Math.abs(delta);
    } else {
      // Sem referência de saldo anterior: usa palavras-chave do histórico.
      if (/RESGATE|SAIDA|IRRF|IOF|TARIFA|DEBITO|ENCARGO/i.test(historico)) saida = Math.abs(valor);
      else entrada = Math.abs(valor);
    }

    rows.push({ data, historico, entrada, saida, saldo });
    prevSaldo = saldo;
  }

  const totalEntradas = rows.reduce((s, r) => s + r.entrada, 0);
  const totalSaidas = rows.reduce((s, r) => s + r.saida, 0);
  // "SALDO ATUAL" é o fechamento impresso pelo banco — vale mais que o saldo da
  // última linha, que pode não ser a última do mês.
  const saldoFinal = saldoAtual ?? (rows.length > 0 ? rows[rows.length - 1].saldo : saldoAnterior);

  return {
    layout: 'movimento',
    rows,
    saldoAnterior,
    totalEntradas,
    totalSaidas,
    saldoFinal,
  };
}

/** Texto sem acentos e com espaços colapsados — tolera OCR e a ordem do pdfjs. */
function deaccent(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

const NUM_SRC = '-?\\d{1,3}(?:\\.\\d{3})*,\\d{2}';

/**
 * Valor de um rótulo do bloco "Posição para Saque". No PDF do Sicredi o número
 * aparece depois do rótulo ("Saldo Bruto 407.903,49") ou antes dele
 * ("407.903,49Saldo Bruto - Base Taxa Máxima:") — as duas ordens são aceitas.
 */
function valorDoRotulo(flat: string, rotulo: string): number | null {
  const depois = flat.match(new RegExp(`${rotulo}\\s*:?\\s*(${NUM_SRC})`, 'i'));
  if (depois?.[1]) return toNumber(depois[1]);
  const antes = flat.match(new RegExp(`(${NUM_SRC})\\s*${rotulo}`, 'i'));
  if (antes?.[1]) return toNumber(antes[1]);
  return null;
}

/**
 * Bloco "Posição para Saque" (a parte que interessa para contabilizar):
 * data da posição + Saldo Atual, Rendimentos Provisionados, Saldo Bruto,
 * Provisão IRRF, Provisão IOF e Líquido para Saque.
 */
export function parsePosicaoSaque(text: string): AplicacaoPosicaoSaque | null {
  const flat = deaccent(text);
  const dataMatch = flat.match(/Posicao\s+em\s+(\d{2}\/\d{2}\/\d{4})/i);
  if (!dataMatch) return null;

  // "Rendimentos Provisionados" também aparece antes, na tabela mensal — por
  // isso a busca desse valor começa no bloco da posição.
  const bloco = flat.slice(dataMatch.index ?? 0);

  const posicao: AplicacaoPosicaoSaque = {
    data: dataMatch[1],
    rendimentosProvisionados: valorDoRotulo(bloco, 'Rendimentos\\s+Provisionados'),
    provisaoIRRF: valorDoRotulo(flat, 'Provisao\\s+IRRF'),
    provisaoIOF: valorDoRotulo(flat, 'Provisao\\s+IOF'),
  };

  return posicao;
}

/** Layout 2: resumo mensal (Depósito a Prazo - Detalhado). */
function parseDepositoPrazo(text: string): AplicacaoExtratoParseResult {
  const norm = text.replace(/\r/g, '');
  const saldoAnteriorRaw = findFirst(norm, /(\d{1,3}(?:\.\d{3})*,\d{2})\s*[\s ]*30?\/?\d*\/?\d*Saldo\s+Anterior/i)
    ?? findFirst(norm, /Saldo\s+Anterior:?[\s ]*(\d{1,3}(?:\.\d{3})*,\d{2})/i);
  const saldoAnterior = saldoAnteriorRaw ? toNumber(saldoAnteriorRaw) : null;

  // Linha mensal do quadro consolidado, na ordem impressa:
  //   Mês/Ano · Aplicações · Resgates · Rendimentos Pagos · IRRF · IOF ·
  //   No Mês · Acumulado · Saldo Atual
  const linhaMensal = norm.match(
    /(\d{2})\/(\d{4})\s+((?:\d[\d.,]*\s+){7}\d[\d.,]*)/,
  );

  let totalEntradas = 0;
  let totalSaidas = 0;
  let saldoFinal: number | null = null;
  let dataLancamento = '';
  const rows: AplicacaoExtratoRow[] = [];

  if (linhaMensal) {
    const mes = Number(linhaMensal[1]);
    const ano = Number(linhaMensal[2]);
    // O quadro é mensal e só traz "07/2026": o lançamento é do fechamento do
    // mês, então cai no último dia dele.
    if (mes >= 1 && mes <= 12 && ano > 1900) {
      const ultimoDia = new Date(ano, mes, 0).getDate();
      dataLancamento = `${String(ultimoDia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`;
    }

    const values = (linhaMensal[3].match(/\d{1,3}(?:\.\d{3})*,\d{2}/g) ?? []).map(toNumber);
    if (values.length >= 8) {
      const [aplicacoes, resgates, rendimentosPagos, irrf, iof] = values;
      saldoFinal = values[values.length - 1];

      // Aplicações e resgates ficam de fora: são os totalizadores do mês, e cada
      // um deles já entra pelo extrato da conta corrente (APLICACAO FINANCEIRA /
      // RESG.APLIC FIN AVISO PREV). Lançá-los aqui contabilizaria a mesma
      // movimentação duas vezes. Seguem no resultado só como conferência.
      totalEntradas = aplicacoes;
      totalSaidas = resgates;

      // Do quadro, viram lançamento apenas o que foi REALIZADO no mês:
      // rendimento pago e os impostos retidos sobre ele.
      if (rendimentosPagos > 0) {
        rows.push({ data: dataLancamento, historico: 'RENDIMENTOS PAGOS', entrada: rendimentosPagos, saida: 0, saldo: null });
      }
      if (irrf > 0) {
        rows.push({ data: dataLancamento, historico: 'IRRF', entrada: 0, saida: irrf, saldo: null });
      }
      if (iof > 0) {
        rows.push({ data: dataLancamento, historico: 'IOF', entrada: 0, saida: iof, saldo: null });
      }
    } else if (values.length >= 2) {
      totalEntradas = values[0];
      totalSaidas = values[1];
    }
  }

  if (saldoFinal == null) {
    const saldoAtualRaw = findFirst(norm, /Saldo\s+Atual\s+(\d{1,3}(?:\.\d{3})*,\d{2})/i);
    if (saldoAtualRaw) saldoFinal = toNumber(saldoAtualRaw);
  }

  const produto = findFirst(norm, /Produto:\s*\n?\s*\n?([A-Z0-9 ]+)/) ?? undefined;

  // "Posição para Saque": rendimento provisionado e provisões de IRRF/IOF são
  // projeção do que ainda não foi pago nem retido. Viram lançamento MARCADO
  // como provisão — aparecem na tabela, na parte de provisionamentos, e só
  // entram na conciliação se forem desbloqueados. O realizado do mês (acima)
  // entra direto.
  const posicaoSaque = parsePosicaoSaque(norm) ?? undefined;
  if (posicaoSaque) {
    const dataProvisao = dataLancamento || posicaoSaque.data;
    const provisao = (historico: string, entrada: number, saida: number) => {
      if (entrada <= 0 && saida <= 0) return;
      rows.push({ data: dataProvisao, historico, entrada, saida, saldo: null, provisionado: true });
    };
    provisao('RENDIMENTOS PROVISIONADOS', posicaoSaque.rendimentosProvisionados ?? 0, 0);
    provisao('PROVISÃO IRRF', 0, posicaoSaque.provisaoIRRF ?? 0);
    provisao('PROVISÃO IOF', 0, posicaoSaque.provisaoIOF ?? 0);
  }

  return {
    layout: 'deposito_prazo',
    rows,
    // Saldos deste layout não são extraídos: ficam sempre manuais.
    saldoAnterior: null,
    totalEntradas,
    totalSaidas,
    saldoFinal: null,
    produto: produto?.trim(),
    posicaoSaque,
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
