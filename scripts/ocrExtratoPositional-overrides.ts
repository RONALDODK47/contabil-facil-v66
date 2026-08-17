/** Histórico de lançamento plausível (rejeita fragmentos como «1», «D», só números). */
export function extratoHistoricoEhPlausivel(text: string | undefined): boolean {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return false;
  if (extratoHistoricoEhSomenteDocumentoFiscal(s)) return false;
  if (extratoHistoricoEhSomenteSaldoInformativo(s)) return false;
  if (/^[\d\s.,]+$/.test(s) && s.replace(/\D/g, '').length <= 3) return false;
  if (/^[A-Za-zÀ-ú]$/.test(s)) return false;
  if (/^[DCdc]$/.test(s)) return false;
  if (s.length < 3 && !RE_HIST_OPERACAO.test(s)) return false;
  if (RE_RUIDO_EXTRATO.test(s)) return false;
  if (
    RE_HIST_OPERACIONAL_BRADESCO.test(s) &&
    /[A-Za-zÀ-ú]{3,}/.test(s) &&
    !/(?:\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/.test(s)
  ) {
    return true;
  }
  if (tokenEhValorExtrato(s)) return false;
  return /[A-Za-zÀ-ú]{2,}/.test(s) || RE_HIST_OPERACAO.test(s);
}

/** Extrai trecho operacional típico Itaú/Bradesco da linha OCR. */
export function extratoExtrairHistoricoItauOperacionalDaLinha(text: string): string {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (/\bSISPAG\b/i.test(t) && /\bTED\s*RECEB|TEDRECEB/i.test(t)) {
    const m = t.match(/\bSISPAG[\w\s./-]{0,48}/i);
    if (m?.[0]?.trim()) {
      let s = m[0].trim();
      if (/\bSANEAGO\b/i.test(t) && !/\bSANEAGO\b/i.test(s)) {
        s = `${s} SANEAGO`.replace(/\s+/g, ' ').trim();
      }
      if (extratoHistoricoEhPlausivel(s)) return s.replace(/\s+/g, ' ').trim();
    }
  }
  const patterns = [
    /TED\s*RECEB(?:IDA)?\d{3}\.\d{4}\.[\wÀ-ú0-9.-]*(?:\s+[\wÀ-ú][\wÀ-ú0-9./-]*){0,14}/i,
    /TEDRECEBIDA?\d{3}\.\d{4}\.[\wÀ-ú0-9.-]*(?:\s+[\wÀ-ú][\wÀ-ú0-9./-]*){0,12}/i,
    /TED\s*RECEB(?:IDA)?\s+\d{3}\.\d{4}\.[\wÀ-ú0-9.-]*(?:\s+[\wÀ-ú][\wÀ-ú0-9./-]*){0,14}/i,
    /\bTED\s+\d{3}\.\d{4}\.[\wÀ-ú0-9.-]*(?:\s+[\wÀ-ú][\wÀ-ú0-9./-]*){0,12}/i,
    /TAR\s*PLANO\s*ADAPT\s*\d{2,3}\/\d{2}/i,
    /TARPLANOADAPT\d{2,3}\/\d{2}/i,
    /RECEBIMENTOS\s+[\wÀ-ú]+(?:\s+[\wÀ-ú]+){0,8}/i,
    /AUT\s+MAIS\s+RENDIMENTOS[\w\s./-]{0,32}/i,
    /RENDIMENTOS(?:\s+[\wÀ-ú]+){0,6}/i,
    /SISPAG[\w\s./-]{0,40}/i,
    /PAGAMENTOS?\s*TRIB[\w\s./-]{0,40}/i,
    /PIX\s*RECEB[\w\s./-]{0,40}/i,
    /\bIOF\b/i,
    /\bCODE\b[\w\s./-]{0,12}/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (!m?.[0]?.trim()) continue;
    let hit = m[0].trim();
    hit = hit.replace(/TARPLANOADAPT(\d{2,3}\/\d{2})/gi, 'TAR PLANO ADAPT $1');
    hit = hit.replace(/TEDRECEBIDA?(\d{3}\.)/gi, 'TED RECEBIDA $1');
    hit = hit.replace(/TED\s*RECEBIDA?(\d{3}\.)/gi, 'TED RECEBIDA $1');
    if (extratoHistoricoEhPlausivel(hit)) return hit.replace(/\s+/g, ' ').trim();
  }
  return '';
}

/** Histórico a partir da linha OCR completa (sem data, valor ou indicador D/C). */
export function inferDescricaoFromLinhaOcr(linha: string | undefined, row: OcrExtratoRow): string {
  if (!linha?.trim()) return '';
  const itau = extratoExtrairHistoricoItauOperacionalDaLinha(linha);
  if (itau && extratoHistoricoEhPlausivel(itau)) {
    return stripValorTokensFromExtratoText(itau).replace(/\s+/g, ' ').trim();
  }
  let t = stripDateTokensFromExtratoText(linha, row.data);
  t = stripValorTokensFromExtratoText(t);
  t = t.replace(/\s+/g, ' ').trim();
  const antesComplemento = t.split(/\b(?:Pagamento\s+Pix|Transfer[eê]ncia\s+Pix|FAV\.:|DOC\.:)/i)[0]?.trim();
  if (antesComplemento && antesComplemento.length >= 5 && extratoHistoricoEhPlausivel(antesComplemento)) {
    return antesComplemento;
  }
  let s = (extratoExtrairCabecalhoHistoricoOperacional(t) || t).replace(/^[\s—–-]+/, '').trim();
  s = stripValorTokensFromExtratoText(s).replace(/\s+/g, ' ').trim();
  const op = s.match(
    /\b(?:TEDRECEBIDA?\d{3}\.\d{4}|TED\s*RECEB(?:IDA)?\d{3}\.\d{4}|TEDRECEBIDA?|TED\s*RECEB[\w\s./-]*|(?:E|PP|O)\s+RECEB[\w\s./-]*|SISPAG[\w\s./-]+|TAR(?:PLANOADAPT)?[\w\s./-]+|PAGAMENTOS?\s*TRIB[\w\s./-]*|PIXRECEB[\w\s./-]*|RECEBIMENTOS[\w\s./-]+|Pagamento\s+Pix[\w\s./-]*)(?:\s+[\wÀ-ú0-9./-]+){0,16}/i,
  );
  if (op?.[0]?.trim()) {
    const hit = stripValorTokensFromExtratoText(op[0]).replace(/\s+/g, ' ').trim();
    if (hit && extratoHistoricoEhPlausivel(hit)) return hit;
  }
  return s && extratoHistoricoEhPlausivel(s) ? s : '';
}

function normalizeTextoIgnorarMatch(text: string): string {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleUpperCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTextoIgnorarCompact(text: string): string {
  return normalizeTextoIgnorarMatch(text).replace(/[^A-Z0-9]/g, '');
}

export function extratoTextoContemPalavraIgnorada(text: string, ignoreWords: string[]): boolean {
  if (ignoreWords.length === 0) return false;
  const hay = normalizeTextoIgnorarMatch(text);
  const compact = normalizeTextoIgnorarCompact(text);
  if (!hay && !compact) return false;
  if (ignoreWords.some((w) => /saldo/i.test(w)) && extratoTextoEhMarcadorSaldoInformativoOcr(text) && !extratoTrechoTemHistoricoOperacional(text)) {
    return true;
  }
  for (const word of ignoreWords) {
    const norm = normalizeTextoIgnorarMatch(word);
    if (!norm) continue;
    if (hay.includes(norm)) return true;
    const key = norm.replace(/[^A-Z0-9]/g, '');
    if (key.length >= 4 && compact.includes(key)) return true;
  }
  return false;
}

function extratoTextoIgnoradoSemOperacao(text: string, ignoreWords: string[]): boolean {
  if (!extratoTextoContemPalavraIgnorada(text, ignoreWords)) return false;
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (/SALDO\s+ANTERIOR/i.test(t) || (/\bSALDO\b/i.test(t) && !extratoTrechoTemHistoricoOperacional(t))) return true;
  if (extratoLinhaSaldoTemValorLancamentoColado(t)) return false;
  return false;
}

export function extratoRowContemPalavraIgnorada(row: OcrExtratoRow, ignoreWords: string[]): boolean {
  if (ignoreWords.length === 0 || extratoRowHistoricoColunaSaldoDesalinhado(row)) return false;
  const linha = normalizeLinhaOcrParaSplit(String(row._linhaOcr ?? ''));
  if (linha && (/SALDO\s+ANTERIOR/i.test(linha) || (row._informativoSaldo === '1' && /SALDO/i.test(linha)))) {
    return extratoTextoIgnoradoSemOperacao(linha, ignoreWords);
  }
  if (linha && extratoLinhaSaldoTemValorLancamentoColado(linha)) return false;
  const recuperavel = !!linha && extratoLinhaTemLancamentoOperacionalRecuperavel(linha);
  const campos = [linha && extratoTextoIgnoradoSemOperacao(linha, ignoreWords) ? linha : '', row.data];
  if (recuperavel) {
    for (const c of [row.descricao, row.historicoOperacao, row.historico]) {
      if (c && !extratoTextoIgnoradoSemOperacao(c, ignoreWords)) campos.push(c);
    }
  } else {
    campos.push(row.descricao, row.historicoOperacao, row.historico);
  }
  campos.push(row.valorDebito, row.valorCredito, row.valorMisto);
  for (const campo of campos) {
    const s = String(campo ?? '').trim();
    if (s && extratoTextoContemPalavraIgnorada(s, ignoreWords)) return true;
  }
  return false;
}

export function removerLinhasComPalavrasIgnoradas(
  rows: OcrExtratoRow[],
  ignoreWords: string[],
  options?: { preservarLinhasComValor?: boolean },
): OcrExtratoRow[] {
  if (ignoreWords.length === 0) return rows;
  return rows.filter((r) => {
    // NÃO filtra linhas com "Saldo" se elas tiverem valor real (são lançamentos operacionais)
    const temValor = parseExtratoMoneyValue(r.valorDebito ?? '') || parseExtratoMoneyValue(r.valorCredito ?? '') || parseExtratoMoneyValue(r.valorMisto ?? '');
    const desc = resolveExtratoDescricaoText(r);
    const ehSaldo = extratoHistoricoEhSomenteSaldoInformativo(desc);
    
    if (extratoRowEhSaldoInformativo(r) && !(ehSaldo && temValor)) {
      return false;
    }
    if (!extratoRowContemPalavraIgnorada(r, ignoreWords)) return true;
    if (options?.preservarLinhasComValor) {
      const linha = normalizeLinhaOcrParaSplit(String(r._linhaOcr ?? ''));
      if ((linha && extratoLinhaTemLancamentoOperacionalRecuperavel(linha)) || (linha && extratoLinhaSaldoTemValorLancamentoColado(linha))) {
        return true;
      }
    }
    return false;
  });
}

/** Linha de saldo anterior/bloqueado — informativa, não é lançamento operacional. */
export function extratoRowEhSaldoInformativo(row: OcrExtratoRow): boolean {
  if (row._informativoSaldo === '1') return true;
  const desc = resolveExtratoDescricaoText(row).trim();
  const descUpper = desc.toUpperCase();
  const linhaUpper = String(row._linhaOcr ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
  const linhaNorm = normalizeLinhaOcrParaSplit(String(row._linhaOcr ?? ''));
  if (extratoHistoricoEhSomenteSaldoInformativo(desc)) {
    if (extratoRowHistoricoColunaSaldoDesalinhado(row) || extratoLinhaTemLancamentoOperacionalRecuperavel(linhaNorm || linhaUpper)) {
      return false;
    }
    if (extratoLinhaSaldoTemValorLancamentoColado(linhaNorm || linhaUpper)) return false;
    return true;
  }
  if (RE_RODAPE_EXTRATO.test(linhaUpper) || RE_RODAPE_EXTRATO.test(descUpper)) {
    const trecho = (linhaUpper || descUpper).split(/0800|WWW\.|HTTPS?:\/\/|FALE CONOSCO|24 HORAS/i)[0] ?? (linhaUpper || descUpper);
    if (extratoLinhaIndicaDebitoOperacionalItau(trecho)) return false;
    const hist = resolveExtratoDescricaoText(row).replace(/\s+/g, ' ').trim();
    const valor =
      parseExtratoMoneyValue(row.valorDebito ?? '') ||
      parseExtratoMoneyValue(row.valorCredito ?? '') ||
      parseExtratoMoneyValue(row.valorMisto ?? '') ||
      0;
    if (hist && extratoHistoricoEhPlausivel(hist) && !extratoHistoricoEhSomenteSaldoInformativo(hist) && (extratoLinhaIndicaDebitoOperacionalItau(hist) || extratoTrechoTemHistoricoOperacional(hist)) && valor > 0.0001) {
      return false;
    }
    return true;
  }
  if (extratoLinhaMencionaSaldoDisponivelDia(linhaNorm || descUpper) && !extratoLinhaSaldoTemValorLancamentoColado(linhaNorm) && !extratoLinhaTemLancamentoOperacionalRecuperavel(linhaNorm)) {
    return true;
  }
  if (/\bSISPAG\b/i.test(`${descUpper} ${linhaUpper}`) && /SALDO\s+(?:TOTAL\s+)?DISPON[IÍ]VEL(?:\s+DIA)?/i.test(`${descUpper} ${linhaUpper}`)) {
    const misto = sanitizeExtratoValorOcrToken(String(row.valorMisto ?? '').trim());
    if (!/^[-−]/.test(misto)) {
      const v =
        parseExtratoMoneyValue(row.valorDebito ?? '') ||
        parseExtratoMoneyValue(row.valorCredito ?? '') ||
        parseExtratoMoneyValue(misto) ||
        0;
      if (v > 0 && v < 2500) return true;
    }
  }
  if (RE_RUIDO_EXTRATO.test(desc) || RE_RUIDO_EXTRATO.test(linhaUpper)) return true;
  if (/SALDO\s+DISPON[IÍ]VEL|CHEQUE\s+ESPECIAL|CUSTO\s+EFETIVO|TARIFAS\s+VENCIDAS|\(\+\)\s*CHEQUE|\(-\)\s*TARIFAS/i.test(linhaUpper || descUpper)) {
    const ctx = linhaNorm || linhaUpper || descUpper;
    if (ctx && (extratoLinhaSaldoTemValorLancamentoColado(ctx) || extratoLinhaTemLancamentoOperacionalRecuperavel(ctx))) return false;
  }
  const valor =
    parseExtratoMoneyValue(row.valorDebito ?? '') ||
    parseExtratoMoneyValue(row.valorCredito ?? '') ||
    parseExtratoMoneyValue(row.valorMisto ?? '') ||
    0;
  if (valor > 0.0001) {
    if (/SALDO\s+DO\s+DIA/i.test(linhaUpper || descUpper) && extratoLinhaEhSomenteDataEValor(linhaNorm || linhaUpper)) {
      const hits = scanValoresLancamentoLinhaExtrato(linhaNorm || linhaUpper);
      if (hits.length === 1 && extratoValorTextoEhSaldoDoDia(linhaNorm || linhaUpper, hits[0]!)) return true;
    }
    if (valor >= 10_000 && /^[\d\s]{1,4}$/.test(desc.trim())) return true;
  }
  if (!extratoHistoricoEhPlausivel(desc)) {
    if (/SALDO\s+DO\s+DIA/i.test(linhaUpper || descUpper)) return true;
    if (!sanitizeExtratoDataOcrToken(row.data) && !desc.trim() && !RE_HIST_OPERACAO.test(linhaUpper || descUpper)) return true;
  }
  return false;
}

export function mergeExtratoValorOrfao(rows: OcrExtratoRow[]): OcrExtratoRow[] {
  const out: OcrExtratoRow[] = [];
  for (const row of rows) {
    let valor =
      parseExtratoMoneyValue(row.valorDebito ?? '') ||
      parseExtratoMoneyValue(row.valorCredito ?? '') ||
      parseExtratoMoneyValue(row.valorMisto ?? '') ||
      0;
    const desc = resolveExtratoDescricaoText(row).trim();
    const data = extratoRowDataNormalizada(row);
    const linha = String(row._linhaOcr ?? '').replace(/\s+/g, ' ').trim();
    const soSaldo = extratoHistoricoEhSomenteSaldoInformativo(desc);
    const saldoColado = !!linha && extratoLinhaSaldoTemValorLancamentoColado(linha);
    if (valor <= 0.0001 && saldoColado && linha) {
      const hits = scanValoresTextoLinhaExtrato(linha);
      const saldoHit = hits.find((h) => extratoValorTextoEhSaldoDoDia(linha, h));
      if (saldoHit) valor = saldoHit.value;
    }
    const semHistorico =
      valor > 0.0001 &&
      (!desc || soSaldo || saldoColado || !data || isExtratoDatePlaceholder(data) || extratoLinhaEhSomenteDataEValor(linha) || row._valorRecuperadoSaldo === '1');
    if (semHistorico && valor < 500_000) {
      const prev = out[out.length - 1];
      if (prev) {
        const prevVal =
          parseExtratoMoneyValue(prev.valorDebito ?? '') ||
          parseExtratoMoneyValue(prev.valorCredito ?? '') ||
          parseExtratoMoneyValue(prev.valorMisto ?? '') ||
          0;
        if (prevVal <= 0.0001) {
          if (parseExtratoMoneyValue(row.valorDebito ?? '') > 0) prev.valorDebito = row.valorDebito ?? '';
          else if (parseExtratoMoneyValue(row.valorCredito ?? '') > 0) prev.valorCredito = row.valorCredito ?? '';
          else if (parseExtratoMoneyValue(row.valorMisto ?? '') > 0) prev.valorMisto = row.valorMisto ?? '';
          continue;
        }
      }
      if (soSaldo || saldoColado) {
        out.push({
          ...row,
          descricao: '',
          historicoOperacao: '',
          _valorRecuperadoSaldo: '1',
          _linhaOcrSaldoOrigem: saldoColado ? linha : row._linhaOcrSaldoOrigem ?? linha,
        });
        continue;
      }
    }
    out.push({ ...row });
  }
  return out;
}

export function mergeExtratoDescricaoContinuacao(
  rows: OcrExtratoRow[],
  ignoreWords: string[] = [],
): OcrExtratoRow[] {
  const out: OcrExtratoRow[] = [];
  for (const row of rows) {
    const valor =
      parseExtratoMoneyValue(row.valorDebito ?? '') ||
      parseExtratoMoneyValue(row.valorCredito ?? '') ||
      parseExtratoMoneyValue(row.valorMisto ?? '') ||
      0;
    if (ignoreWords.length > 0 && valor <= 0.0001 && extratoRowContemPalavraIgnorada(row, ignoreWords)) continue;
    const descRaw = (row.descricao ?? '').trim();
    const histOpRaw = (row.historicoOperacao ?? '').trim();
    if (valor <= 0.0001 && (extratoTextoEhRodape(descRaw) || extratoTextoEhRodape(histOpRaw))) continue;
    const bb = linhaPareceExtratoBbOcr(String(row._linhaOcr ?? ''));
    const desc = bb && descRaw && extratoHistoricoEhPlausivel(descRaw) ? descRaw.trim() : limparHistoricoExtratoMisturado(descRaw);
    const histOp = bb && histOpRaw && extratoHistoricoEhPlausivel(histOpRaw) ? histOpRaw.trim() : limparHistoricoExtratoMisturado(histOpRaw);
    let textoLivre = desc || histOp;
    if (textoLivre && !extratoHistoricoEhPlausivel(textoLivre) && row._linhaOcr?.trim()) {
      const reinfer = inferDescricaoFromLinhaOcr(row._linhaOcr, row);
      if (extratoHistoricoEhPlausivel(reinfer)) textoLivre = reinfer;
    }
    if (row._splitLanc === '1') {
      out.push({ ...row, descricao: desc || row.descricao, historicoOperacao: histOp || row.historicoOperacao });
      continue;
    }
    const linhaOcr = String(row._linhaOcr ?? '').trim();
    if (linhaOcr && scanValoresParaSplitExtrato(linhaOcr).length > 0 && valor <= 0.0001) {
      out.push({ ...row, descricao: desc, historicoOperacao: histOp });
      continue;
    }
    if (valor <= 0.0001 && textoLivre && out.length > 0) {
      if (extratoTextoEhRodape(textoLivre)) continue;
      if (extratoTextoEhNovoLancamento(textoLivre)) {
        out.push({ ...row, descricao: desc, historicoOperacao: histOp });
        continue;
      }
      if (!extratoTextoEhContinuacaoHistorico(textoLivre)) continue;
      const prev = out[out.length - 1]!;
      const prevTemValor =
        parseExtratoMoneyValue(prev.valorDebito ?? '') ||
        parseExtratoMoneyValue(prev.valorCredito ?? '') ||
        parseExtratoMoneyValue(prev.valorMisto ?? '') ||
        0;
      if (prevTemValor <= 0.0001) continue;
      if (desc) {
        const base = (prev.descricao ?? '').trim();
        prev.descricao = base ? `${base} ${desc}` : desc;
      }
      if (histOp) {
        const baseH = (prev.historicoOperacao ?? '').trim();
        prev.historicoOperacao = baseH ? `${baseH} ${histOp}` : histOp;
      }
      continue;
    }
    if (valor <= 0.0001 && !textoLivre) {
      if (linhaOcr && extratoTrechoTemHistoricoOperacional(linhaOcr)) {
        out.push({ ...row, descricao: desc, historicoOperacao: histOp });
      }
      continue;
    }
    const cleaned = { ...row };
    if (desc) cleaned.descricao = desc;
    if (histOp) cleaned.historicoOperacao = histOp;
    if (cleaned.descricao) cleaned.descricao = limparHistoricoExtratoMisturado(cleaned.descricao);
    out.push(cleaned);
  }
  return out;
}

export function cleanExtratoOcrRowForImport(row: OcrExtratoRow): OcrExtratoRow {
  const out = consolidarColunasValorExtratoRow({ ...row });
  const dataLimpa = sanitizeExtratoDataOcrToken(out.data);
  if (dataLimpa) out.data = dataLimpa;
  for (const id of ['valorDebito', 'valorCredito', 'valorMisto', 'valor'] as const) {
    const raw = out[id];
    if (!raw?.trim()) continue;
    const limpo = sanitizeExtratoValorOcrToken(raw);
    if (limpo) out[id] = limpo;
  }
  const nature = out.natureza?.trim();
  if (nature && /^[DCdc]$/.test(nature)) out.natureza = nature.toUpperCase();
  return out;
}

function extratoRowDataNormalizada(row: OcrExtratoRow): string {
  const data = String(row.data ?? '').trim();
  if (data && !tokenEhCodigoTedItauOcr(data)) {
    const limpa = sanitizeExtratoDataOcrToken(row.data);
    if (limpa && !isExtratoDatePlaceholder(data)) return limpa;
  }
  const m = String(row._linhaOcr ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .match(/^(\d{1,2}\s*[\/\-.]\s*\d{1,2}(?:\s*[\/\-.]\s*\d{2,4})?)/);
  if (m) {
    const limpa = sanitizeExtratoDataOcrToken(m[1]);
    if (limpa) return limpa;
  }
  return String(row.data ?? '').trim();
}

function tokenEhCodigoTedItauOcr(text: string): boolean {
  return /^\d{3}\.\d{4}\./.test(String(text ?? '').trim());
}

export function extratoLancamentoTemHistoricoNaPropriaLinhaOcr(row: OcrExtratoRow): boolean {
  const linha = String(row._linhaOcr ?? '').replace(/\s+/g, ' ').trim();
  if (!linha || extratoLinhaEhSomenteDataEValor(linha)) return false;
  if (extratoHistoricoPreferidoDaLinhaOcr(row)) return true;
  const inferred = inferDescricaoFromLinhaOcr(linha, row).trim();
  return !!(inferred && extratoHistoricoEhPlausivel(inferred) && extratoTrechoTemHistoricoOperacional(inferred));
}

function extratoHistoricoPreferidoDaLinhaOcr(row: OcrExtratoRow): string {
  const desc = resolveExtratoDescricaoText(row).trim();
  if (/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.test(desc) && extratoHistoricoEhPlausivel(desc)) {
    return limparHistoricoExtratoMisturado(desc);
  }
  const linha = String(row._linhaOcr ?? '').replace(/\s+/g, ' ').trim();
  if (!linha || extratoLinhaEhSomenteDataEValor(linha) || !(extratoTrechoTemHistoricoOperacional(linha) || RE_HIST_OPERACAO.test(linha))) {
    return '';
  }
  const inferred = limparHistoricoExtratoMisturado(inferDescricaoFromLinhaOcr(linha, row)).trim();
  if (inferred && extratoHistoricoEhPlausivel(inferred) && !extratoHistoricoEhSomenteSaldoInformativo(inferred)) {
    return inferred;
  }
  const m = linha.match(
    /\b(SISPAG[\w\s./-]+|TAR(?:\.|\s+[\w./-]+)|PAGAMENTOS?\s*TRIB[\w\s./-]*|TED\s*RECEB[\w\s./-]*|TEDRECEBIDA[\w\s./-]*|(?:E|PP|O)\s+RECEB[\w\s./-]*|TED[\w\s./-]*|PIX\s*RECEB[\w\s./-]*|RECEBIMENTOS[\w\s./-]+|\bCODE\b|\bIOF\b)/i,
  );
  if (m?.[0]?.trim()) {
    const hit = limparHistoricoExtratoMisturado(m[0].trim());
    if (extratoHistoricoEhPlausivel(hit) && !extratoHistoricoEhSomenteSaldoInformativo(hit)) return hit;
  }
  return '';
}

export type PostProcessExtratoOcrOptions = {
  ignoreLineWords?: string[];
  preserveSegmentRows?: boolean;
};

export function postProcessExtratoOcrRows(
  rows: OcrExtratoRow[],
  statementYear?: string,
  options?: PostProcessExtratoOcrOptions,
): OcrExtratoRow[] {
  if (options?.preserveSegmentRows) {
    let cur = propagateExtratoDatesOcrRows(rows, statementYear);
    const ignoreWords = options.ignoreLineWords ?? [];
    cur = removerLinhasComPalavrasIgnoradas(cur, ignoreWords, { preservarLinhasComValor: true });
    cur = mergeExtratoDescricaoContinuacao(cur, ignoreWords);
    cur = splitExtratoOcrRowsPorLancamentosFundidos(cur);
    cur = propagateExtratoDatesOcrRows(cur, statementYear);
    cur = cur
      .map((r) => {
        const sanitized = sanitizeExtratoOcrRowColumns(r);
        if (!resolveExtratoDescricaoText(sanitized) && sanitized._linhaOcr?.trim()) {
          const inferred = inferDescricaoFromLinhaOcr(sanitized._linhaOcr, sanitized);
          if (inferred && !tokenEhValorExtrato(inferred)) sanitized.descricao = inferred;
        }
        return cleanExtratoOcrRowForImport(sanitized);
      })
      .filter((r) => {
        if (r._valorRecuperadoSaldo === '1' || parseExtratoMoneyValue(r.valorMisto ?? r.valorDebito ?? r.valorCredito ?? '') <= 0.0001) {
          return true;
        }
        const desc = resolveExtratoDescricaoText(r).trim();
        if (desc && extratoHistoricoEhPlausivel(desc)) return true;
        const linha = String(r._linhaOcr ?? '').replace(/\s+/g, ' ').trim();
        if (linha && extratoTrechoTemHistoricoOperacional(linha)) return true;
        const origem = String(r._linhaOcrSaldoOrigem ?? '').replace(/\s+/g, ' ').trim();
        if (origem && extratoTrechoTemHistoricoOperacional(origem)) return true;
        const ctx = origem || linha;
        return !(
          /SALDO\s+(?:TOTAL\s+)?DISPON[IÍ]VEL(?:\s+DIA)?|SALDO\s+DO\s+DIA/i.test(ctx) &&
          extratoLinhaEhSomenteDataEValor(linha) &&
          !extratoLinhaSaldoTemValorLancamentoColado(ctx)
        );
      });
    return removerLinhasComPalavrasIgnoradas(cur, ignoreWords).filter((r) => !extratoRowEhSaldoInformativo(r));
  }

  const trimmed = trimExtratoOcrRowsToLancamentos(rows);
  const withDates = propagateExtratoDatesOcrRows(trimmed, statementYear);
  const withValores = mergeExtratoValorOrfao(withDates);
  const ignoreWords = options?.ignoreLineWords ?? [];
  const beforeMerge = removerLinhasComPalavrasIgnoradas(withValores, ignoreWords);
  const merged = mergeExtratoDescricaoContinuacao(beforeMerge, ignoreWords);
  const afterIgnore = removerLinhasComPalavrasIgnoradas(merged, ignoreWords);
  const split = splitExtratoOcrRowsPorLancamentosFundidos(afterIgnore);
  const withDatesSplit = propagateExtratoDatesOcrRows(split, statementYear);
  return withDatesSplit.map((r) => {
      const sanitized = sanitizeExtratoOcrRowColumns(r);
      if (!resolveExtratoDescricaoText(sanitized) && sanitized._linhaOcr?.trim()) {
        const inferred = inferDescricaoFromLinhaOcr(sanitized._linhaOcr, sanitized);
        if (inferred && !tokenEhValorExtrato(inferred)) sanitized.descricao = inferred;
      }
      return cleanExtratoOcrRowForImport(sanitized);
    })
    .filter((r) => {
      if (r._valorRecuperadoSaldo === '1') return true;
      const desc = resolveExtratoDescricaoText(r).trim();
      if (desc && extratoHistoricoEhPlausivel(desc)) return true;
      const linha = String(r._linhaOcr ?? '').replace(/\s+/g, ' ').trim();
      if (linha && extratoTrechoTemHistoricoOperacional(linha)) return true;
      const origem = String(r._linhaOcrSaldoOrigem ?? '').replace(/\s+/g, ' ').trim();
      if (origem && extratoTrechoTemHistoricoOperacional(origem)) return true;
      const ctx = origem || linha;
      return !(
        /SALDO\s+(?:TOTAL\s+)?DISPON[IÍ]VEL(?:\s+DIA)?|SALDO\s+DO\s+DIA/i.test(ctx) &&
        extratoLinhaEhSomenteDataEValor(linha) &&
        !extratoLinhaSaldoTemValorLancamentoColado(ctx)
      );
    });
}

export function prepararExtratoOcrRowsParaRevisao(
  rows: OcrExtratoRow[],
  options?: {
    statementYear?: string;
    ignoreLineWords?: string[];
    preserveSegmentRows?: boolean;
  },
): OcrExtratoRow[] {
  return postProcessExtratoOcrRows(rows, options?.statementYear, {
    ignoreLineWords: options?.ignoreLineWords,
    preserveSegmentRows: options?.preserveSegmentRows ?? true,
  }).map((r) => ({ ...r, _extratoPosProcessado: '1' as const }));
}

type PosItem = { str: string; x: number; y: number; w: number; h: number };

function clusterItemsByY(items: PosItem[], tolFactor = 0.45): PosItem[][] {
  if (!items.length) return [];
  const heights = items.map((i) => i.h).filter((h) => h > 0).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 12;
  const tol = Math.max(8, Math.round(medianH * tolFactor));
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: PosItem[][] = [];
  let cur = [sorted[0]!];
  let cy = sorted[0]!.y + (sorted[0]!.h > 0 ? sorted[0]!.h : medianH) / 2;
  for (let i = 1; i < sorted.length; i++) {
    const it = sorted[i]!;
    const iy = it.y + (it.h > 0 ? it.h : medianH) / 2;
    const mean = cy / cur.length;
    if (Math.abs(iy - mean) <= tol) {
      cur.push(it);
      cy += iy;
    } else {
      cur.sort((a, b) => a.x - b.x);
      rows.push(cur);
      cur = [it];
      cy = iy;
    }
  }
  cur.sort((a, b) => a.x - b.x);
  rows.push(cur);
  return rows;
}

function linhaContemData(text: string, dataRef: string): boolean {
  const compact = dataRef.replace(/\s+/g, '').trim();
  if (!compact) return true;
  if (text.includes(compact)) return true;
  const prefix = compact.slice(0, 5);
  return prefix.length >= 5 && text.includes(prefix);
}

function inferirHistoricoDeTextoPagina(textoPagina: string, data: string, valor: number): string {
  const blob = String(textoPagina ?? '').replace(/\s+/g, ' ').trim();
  if (!blob || valor <= 0.0001) return '';
  const dataKey = (data ?? '').replace(/\s+/g, '').slice(0, 5);
  if (valor < 1) {
    const re = new RegExp(
      `${dataKey}[\\s\\S]{0,160}?(?:AUT\\s+MAIS\\s+)?RENDIMENTOS[\\s\\S]{0,100}?${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\./g, '\\.')}`,
      'i',
    );
    const m = blob.match(re);
    if (m?.[0]) {
      const hist = inferDescricaoFromLinhaOcr(m[0], { data, _linhaOcr: m[0] });
      return hist && extratoHistoricoEhPlausivel(hist) ? hist : 'RENDIMENTOS';
    }
    const iof = new RegExp(
      `${dataKey}[\\s\\S]{0,80}?\\bIOF\\b[\\s\\S]{0,40}?${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\./g, '\\.')}`,
      'i',
    );
    const mi = blob.match(iof);
    if (mi?.[0]) return 'IOF';
  }
  const sispag = new RegExp(
    `${dataKey}[\\s\\S]{0,200}?SISPAG[\\s\\S]{0,120}?${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\./g, '\\.')}`,
    'i',
  );
  const ms = blob.match(sispag);
  if (ms?.[0]) {
    const hist = inferDescricaoFromLinhaOcr(ms[0], { data, _linhaOcr: ms[0] });
    if (hist && extratoHistoricoEhPlausivel(hist)) return hist;
    return /\bCODE\b/i.test(ms[0]) ? 'SISPAG FORNECEDORES CODE' : 'SISPAG FORNECEDORES';
  }
  return '';
}

function aplicarHistoricoEnriquecido(row: OcrExtratoRow, linha: string, descricao: string): OcrExtratoRow {
  if (!descricao) return row;
  return {
    ...row,
    _linhaOcr: linha,
    descricao,
  };
}

/** Preenche histórico vazio a partir dos tokens OCR posicionados da página. */
export function enrichExtratoHistoricoLinhaOcrFromPageItems(
  items: PosItem[],
  rows: OcrExtratoRow[],
  imgWidth: number,
  valorBounds?: { min: number; max: number },
): OcrExtratoRow[] {
  if (!items.length || !rows.length) return rows;
  const bounds = valorBounds ?? resolveExtratoValorColBoundsFromColumns(
    [{ id: 'valorMisto', start: imgWidth * 0.8, end: imgWidth }],
    imgWidth,
  ) ?? { min: imgWidth * 0.48, max: imgWidth };
  const clusters = clusterItemsByY(items);
  const blob = items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
  return rows.map((row) => {
    const descAtual = resolveExtratoDescricaoText(row).trim();
    if (descAtual && extratoHistoricoEhPlausivel(descAtual)) return row;
    const linha = String(row._linhaOcr ?? '').replace(/\s+/g, ' ').trim();
    if (linha) {
      const reinfer = inferDescricaoFromLinhaOcr(linha, row);
      if (reinfer && extratoHistoricoEhPlausivel(reinfer) && (extratoTrechoTemHistoricoOperacional(reinfer) || reinfer.length >= 4)) {
        return aplicarHistoricoEnriquecido(row, linha, reinfer);
      }
    }
    let valor =
      parseExtratoMoneyValue(row.valorMisto ?? '') ||
      parseExtratoMoneyValue(row.valorDebito ?? '') ||
      parseExtratoMoneyValue(row.valorCredito ?? '') ||
      0;
    if (valor <= 0.0001 && linha) {
      const hits = scanValoresParaSplitExtrato(linha);
      if (hits.length === 1) valor = hits[0]!.value;
    }
    if (valor <= 0.0001) return row;
    const data = String(row.data ?? '').trim();
    for (let ci = 0; ci < clusters.length; ci++) {
      const cluster = clusters[ci]!;
      const anchor = cluster.find((it) => {
        const cx = it.x + it.w / 2;
        if (cx < bounds.min - imgWidth * 0.04 || cx > bounds.max + imgWidth * 0.08) return false;
        return Math.abs(parseExtratoMoneyValue(it.str) - valor) < 0.06;
      });
      if (!anchor) continue;
      let texto = cluster.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();
      const vizinhos = [clusters[ci - 1], cluster, clusters[ci + 1]]
        .filter(Boolean)
        .map((c) => c!.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim())
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!texto) texto = vizinhos;
      if (data && !linhaContemData(texto, data)) continue;
      if (extratoLinhaEhSomenteDataEValor(texto)) {
        const fromBlob = inferirHistoricoDeTextoPagina(blob, data, valor);
        if (fromBlob && /\bSISPAG\b/i.test(fromBlob)) texto = `${fromBlob} ${texto}`.replace(/\s+/g, ' ').trim();
      }
      if (texto.length <= linha.length + 4 && extratoLinhaEhSomenteDataEValor(texto)) continue;
      const hist = inferDescricaoFromLinhaOcr(texto, { ...row });
      if (hist && extratoHistoricoEhPlausivel(hist)) {
        if (/\bTED\s*RECEB/i.test(hist)) {
          const alt = inferirHistoricoDeTextoPagina(blob, data, valor);
          if (alt && /\bSISPAG\b/i.test(alt)) return aplicarHistoricoEnriquecido(row, texto, alt);
        }
        return aplicarHistoricoEnriquecido(row, texto, hist);
      }
      if (!extratoLinhaEhSomenteDataEValor(texto)) return { ...row, _linhaOcr: texto };
    }
    const fromBlob = inferirHistoricoDeTextoPagina(blob, data, valor);
    if (fromBlob && extratoHistoricoEhPlausivel(fromBlob)) {
      const linhaOut = linha || `${data} ${fromBlob}`.trim();
      return aplicarHistoricoEnriquecido(row, linhaOut, fromBlob);
    }
    return row;
  });
}
