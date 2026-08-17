function extratoTextoCompactoUpper(text: string): string {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleUpperCase('pt-BR')
    .replace(/[^A-Z0-9]/g, '');
}

function extratoCompactoEhSaldoInformativoItau(compact: string): boolean {
  if (!compact) return false;
  if (/^SALDOANTERIOR/.test(compact)) return true;
  if (/^SALDOBLOQ/.test(compact)) return true;
  if (compact === 'SALDODODIA') return true;
  if (/^SALDOTOTALI?DISPONIVEL(?:DIA)?$/i.test(compact)) return true;
  if (/SALDOTOTALI?/.test(compact) && /DISPONIVEL/.test(compact) && /DIA/.test(compact)) return true;
  return false;
}

function extratoLinhaMencionaSaldoDisponivelDia(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim().toUpperCase();
  return /SALDO\s+(?:TOTAL\s+)?DISPON[IÍ]VEL(?:\s+DIA)?|SALDO\s+DO\s+DIA/i.test(t);
}

/** Normaliza travessões OCR (en/em dash) para split de lançamentos colados em saldo. */
export function normalizeLinhaOcrParaSplit(text: string): string {
  return String(text ?? '').replace(/[\u2013\u2014\u2212]/g, ' — ').replace(/\s+/g, ' ').trim();
}

export function extratoDescricaoIgnorarIndicadorDc(text: string): string {
  const t = String(text ?? '').trim();
  if (/^[DCdc]$/.test(t)) return '';
  return t;
}

export function consolidarColunasValorExtratoRow(row: OcrExtratoRow): OcrExtratoRow {
  const out = { ...row };
  const deb = parseExtratoMoneyValue(out.valorDebito ?? '');
  const cred = parseExtratoMoneyValue(out.valorCredito ?? '');
  const misto = parseExtratoMoneyValue(out.valorMisto ?? '');
  if (
    misto > 0.0001 &&
    ((deb > 0.0001 && Math.abs(misto - deb) < 0.011) ||
      (cred > 0.0001 && Math.abs(misto - cred) < 0.011))
  ) {
    out.valorMisto = '';
  }
  if (deb > 0.0001 && cred > 0.0001 && Math.abs(deb - cred) < 0.011) {
    out.valorCredito = '';
  }
  return out;
}

function extratoTextoEhMarcadorSaldoInformativoOcr(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t || extratoTrechoTemHistoricoOperacional(t)) return false;
  const compact = extratoTextoCompactoUpper(t);
  if (/^SALDO\s*$/i.test(t.replace(/\s+/g, ' ')) || /SALDO\s+ANTERIOR/i.test(t)) return true;
  if (/SALDO\s+BLOQ/i.test(t)) return true;
  if (/SALDO\s+DO\s+DIA/i.test(t)) return true;
  if (/SALDO\s+(?:TOTAL\s+)?DISPON[IÍ]VEL(?:\s+DIA)?/i.test(t)) return true;
  return extratoCompactoEhSaldoInformativoItau(compact);
}

export function extratoHistoricoEhSomenteSaldoInformativo(text: string | undefined): boolean {
  const t = stripValorTokensFromExtratoText(stripDateTokensFromExtratoText(String(text ?? '')))
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return false;
  if (extratoTextoEhMarcadorSaldoInformativoOcr(t)) return true;
  const upper = t.toUpperCase();
  const compact = extratoTextoCompactoUpper(t);
  if (/SALDO\s+(?:TOTAL\s+)?DISPON[IÍ]VEL(?:\s+DIA)?/i.test(upper) || extratoLinhaMencionaSaldoDisponivelDia(t)) {
    return !extratoTrechoTemHistoricoOperacional(t);
  }
  if (/^SALDO\s+(?:ANTERIOR|BLOQ)/i.test(upper) || /^SALDO\s+DO\s+DIA$/i.test(upper) || compact === 'SALDODODIA') {
    return true;
  }
  if (extratoTrechoTemHistoricoOperacional(t)) return false;
  if (extratoLinhaMencionaSaldoDisponivelDia(t)) {
    return (
      upper
        .replace(/SALDO\s+(?:TOTAL\s+)?DISPON[IÍ]VEL(?:\s+DIA)?/gi, '')
        .replace(/SALDO\s+DO\s+DIA/gi, '')
        .replace(/[-–—\s]+/g, '')
        .trim().length < 3
    );
  }
  return false;
}

function extratoHistoricoEhSomenteDocumentoFiscal(text: string): boolean {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const compact = t.replace(/\s/g, '');
  const m = compact.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
  if (!m) return false;
  return compact.replace(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g, '').replace(/[^\w]/g, '').length === 0;
}

export function extratoTrechoTemHistoricoOperacional(text: string): boolean {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (linhaPareceExtratoBbOcr(t) && /RENDE|OUROCAP|PAGAMENTO\s+DE\s+BOLETO|COBRANCA/i.test(t)) return true;
  return RE_HIST_OPERACAO.test(t) || RE_HIST_OPERACIONAL_BRADESCO.test(t);
}

const RE_SPLIT_MARCADOR_SALDO =
  /[\s\-–—]+(?:SALDO\s+(?:TOTAL\s+)?DISPON[IÍ]VEL(?:\s+DIA)?|SALDO\s+DO\s+DIA)(?=[\s\-–—]|$)/i;

export function splitLinhaOcrPorMarcadorSaldoInformativo(text: string): string[] {
  const t = normalizeLinhaOcrParaSplit(text);
  if (!t) return [];
  const parts = t.split(RE_SPLIT_MARCADOR_SALDO).map((p) => p.trim()).filter(Boolean);
  return parts.length <= 1 ? [t] : parts;
}

export function reconciliarPartesLinhaOcrAposSplitSaldo(parts: string[]): string[] {
  return parts.map((p) => p.trim()).filter(Boolean);
}

export function scanValoresParaSplitExtrato(text: string): ExtratoValorTextoHit[] {
  return scanValoresTextoLinhaExtrato(text).filter((h) => h.value > 0.0001);
}

function extratoTrechoLinhaEhSaldoInformativo(text: string): boolean {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return true;
  const rest = stripValorTokensFromExtratoText(stripDateTokensFromExtratoText(t)).trim();
  const valores = scanValoresParaSplitExtrato(t);
  if (valores.length > 0 && extratoLinhaEhSomenteDataEValor(t) && (!rest || /^[-–—\s]+$/.test(rest))) {
    return false;
  }
  if (extratoLinhaMencionaSaldoDisponivelDia(t) && !extratoTrechoTemHistoricoOperacional(t)) return true;
  if (/^SALDO\s+(?:ANTERIOR|BLOQ)/i.test(t)) return true;
  return false;
}

function extratoLinhaEhSomenteDataEValor(text: string): boolean {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const valores = scanValoresParaSplitExtrato(t);
  if (valores.length !== 1) return false;
  const rest = stripValorTokensFromExtratoText(stripDateTokensFromExtratoText(t)).trim();
  if (rest.length >= 5 && RE_HIST_OPERACAO.test(rest)) return false;
  return !RE_HIST_OPERACAO.test(t);
}

export function extratoLinhaSaldoTemValorLancamentoColado(text: string): boolean {
  const t = normalizeLinhaOcrParaSplit(text);
  if (!extratoLinhaMencionaSaldoDisponivelDia(t)) return false;
  const afterSaldo = t.split(RE_SPLIT_MARCADOR_SALDO).pop()?.trim();
  if (afterSaldo) {
    const lanc = scanValoresTextoLinhaExtrato(afterSaldo).filter((h) => h.value > 0.0001);
    const splitVals = scanValoresParaSplitExtrato(afterSaldo);
    if (splitVals.length >= 1 && lanc.length >= 2) return true;
    if (splitVals.length >= 1 && lanc.length >= 1 && extratoTrechoTemHistoricoOperacional(afterSaldo)) return true;
    if (splitVals.length === 1 && lanc.length === 1 && lanc[0]!.hasNature) return false;
  }
  return reconciliarPartesLinhaOcrAposSplitSaldo(splitLinhaOcrPorMarcadorSaldoInformativo(t)).some(
    (part) => {
      if (/SALDO\s+(?:TOTAL\s+)?DISPON[IÍ]VEL(?:\s+DIA)?|SALDO\s+DO\s+DIA/i.test(part)) return false;
      if (!extratoTrechoTemHistoricoOperacional(part)) return false;
      return scanValoresParaSplitExtrato(part).length > 0 && !!extratoHistoricoEhPlausivel(part);
    },
  );
}

export function extratoLinhaTemLancamentoOperacionalRecuperavel(text: string): boolean {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (
    extratoLinhaSaldoTemValorLancamentoColado(t) ||
    reconciliarPartesLinhaOcrAposSplitSaldo(splitLinhaOcrPorMarcadorSaldoInformativo(t)).some(
      (part) =>
        !extratoTrechoLinhaEhSaldoInformativo(part) &&
        extratoLinhaEhSomenteDataEValor(part) &&
        scanValoresParaSplitExtrato(part).length > 0,
    )
  ) {
    return true;
  }
  if (
    !/SALDO\s+(?:TOTAL\s+)?DISPON[IÍ]VEL(?:\s+DIA)?|SALDO\s+DO\s+DIA|SALDO\s+ANTERIOR|SALDO\s+BLOQ\.?(?:\s*ANTERIOR)?/i.test(
      t,
    )
  ) {
    return false;
  }
  const rest = t
    .replace(
      /SALDO\s+(?:TOTAL\s+)?DISPON[IÍ]VEL(?:\s+DIA)?|SALDO\s+DO\s+DIA|SALDO\s+ANTERIOR|SALDO\s+BLOQ\.?(?:\s*ANTERIOR)?/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
  return rest.length >= 8 && extratoLinhaEhSomenteDataEValor(rest) && scanValoresParaSplitExtrato(rest).length > 0;
}

export function extratoRowHistoricoColunaSaldoDesalinhado(row: OcrExtratoRow): boolean {
  const desc = resolveExtratoDescricaoText(row).trim();
  if (!extratoHistoricoEhSomenteSaldoInformativo(desc)) return false;
  const valor =
    parseExtratoMoneyValue(row.valorDebito ?? '') ||
    parseExtratoMoneyValue(row.valorCredito ?? '') ||
    parseExtratoMoneyValue(row.valorMisto ?? '') ||
    0;
  if (valor <= 0.0001) return false;
  const linha = normalizeLinhaOcrParaSplit(String(row._linhaOcr ?? ''));
  if (extratoLinhaSaldoTemValorLancamentoColado(linha)) return false;
  if (extratoLinhaTemLancamentoOperacionalRecuperavel(linha)) return true;
  const token = String(row.valorMisto ?? row.valorDebito ?? row.valorCredito ?? '').trim();
  if (/^[-−(]/.test(token)) return true;
  const hits = linha ? scanValoresParaSplitExtrato(linha).filter((h) => Math.abs(h.value - valor) < 0.06) : [];
  if (hits.length === 1 && extratoValorTextoEhSaldoDoDia(linha, hits[0]!)) return false;
  return hits.length === 1 && extratoTrechoTemHistoricoOperacional(linha);
}

export function extratoLimparRowHistoricoSaldoDesalinhado(row: OcrExtratoRow): OcrExtratoRow {
  if (!extratoRowHistoricoColunaSaldoDesalinhado(row)) return row;
  const linha = normalizeLinhaOcrParaSplit(String(row._linhaOcr ?? ''));
  const inferred = inferDescricaoFromLinhaOcr(linha, row).trim();
  if (inferred && extratoHistoricoEhPlausivel(inferred) && !extratoHistoricoEhSomenteSaldoInformativo(inferred)) {
    return { ...row, descricao: limparHistoricoExtratoMisturado(inferred), historicoOperacao: '' };
  }
  return { ...row, descricao: '', historicoOperacao: '', historico: '' };
}

export function extratoRecuperarValoresOrfaosAposMarcadorSaldo(linha: string, dataPrefix: string): string[] {
  const t = String(linha ?? '').replace(/\s+/g, ' ').trim();
  if (!t || !dataPrefix) return [];
  if (extratoLinhaEhSomenteDataEValor(t)) return [];
  if (scanValoresTextoLinhaExtrato(t).filter((h) => h.value > 0.0001).length <= 1) return [];
  const hits = scanValoresParaSplitExtrato(t);
  if (hits.length === 0) return [];
  return hits.map((h) => `${dataPrefix} ${t.slice(h.start, h.end).trim()}`.replace(/\s+/g, ' ').trim());
}
