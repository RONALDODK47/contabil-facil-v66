// Append to ocrExtratoPositional.ts — funções recuperadas do bundle (import pipeline Itaú/BB)

export function extratoLinhaEhSomenteDataEValor(text: string): boolean {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const valores = scanValoresParaSplitExtrato(t);
  if (valores.length !== 1) return false;
  const rest = stripValorTokensFromExtratoText(stripDateTokensFromExtratoText(t)).trim();
  if (rest.length >= 5 && RE_HIST_OPERACAO.test(rest)) return false;
  return !RE_HIST_OPERACAO.test(t);
}

export function extratoTextoEhMarcadorSaldoInformativoOcr(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t || extratoTrechoTemHistoricoOperacional(t)) return false;
  const compact = extratoTextoCompactoUpper(t);
  if (/^SALDO\s*$/i.test(t.replace(/\s+/g, ' ')) || /SALDO\s+ANTERIOR/i.test(t)) return true;
  if (/SALDO\s+BLOQ/i.test(t)) return true;
  if (/SALDO\s+DO\s+DIA/i.test(t)) return true;
  if (/SALDO\s+(?:TOTAL\s+)?DISPON[IÍ]VEL(?:\s+DIA)?/i.test(t)) return true;
  return extratoCompactoEhSaldoInformativoItau(compact);
}

export function extratoTrechoLinhaEhSaldoInformativo(text: string): boolean {
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

export function linhaPareceExtratoItauOcr(text: string): boolean {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  let score = 0;
  if (/\b(?:ITAU|ITAÚ|AUT\s+MAIS|SISPAG|TED\s*RECEB|TEDRECEBIDA|SALDO\s+TOTAL\s+DISPON[IÍ]VEL)\b/i.test(t)) score += 2;
  if (/SALDO\s+TOTAL\s+DISPON[IÍ]VEL\s+DIA/i.test(t)) score += 2;
  if (/104\.0327\.OURINHOS|OURINHOS\s+CAMARA|RIBEIRAO\s+PINHAL/i.test(t)) score += 1;
  if (/\bIOF\b/.test(t) && /REND\s+PAGO\s+APLIC|AUT\s+MAIS/i.test(t)) score += 1;
  return score >= 2;
}

export function linhaPareceExtratoItauOcrRows(rows: OcrExtratoRow[]): boolean {
  const sample = rows
    .slice(0, 40)
    .map((r) => String(r._linhaOcr ?? r.descricao ?? '').trim())
    .join(' ');
  return linhaPareceExtratoItauOcr(sample);
}

export function extratoRowDataNormalizada(row: OcrExtratoRow): string {
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

export function tokenEhCodigoTedItauOcr(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  if (/^\d{3}\.\d{4}(?:\.|$|\s)/.test(t)) return true;
  if (/(?<=[A-Za-zÀ-ú])\d{3}\.\d{4}/.test(t)) return true;
  return /\b\d{3}\.\d{4}\./.test(t);
}

export function tokenEhPlanoOuReferenciaItauSlash(text: string): boolean {
  const m = String(text ?? '').trim().match(/^(\d{2,3})\/(\d{2})$/);
  if (!m) return false;
  const d = parseInt(m[1]!, 10);
  const mo = parseInt(m[2]!, 10);
  return d >= 1 && d <= 31 && mo >= 1 && mo <= 12;
}

export function extratoHistoricoPreferidoDaLinhaOcr(row: OcrExtratoRow): string {
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

export function extratoRowEhFantasmaValorSemHistorico(row: OcrExtratoRow): boolean {
  const compact = String(row._linhaOcr ?? '').replace(/\s+/g, ' ').trim().replace(/\s/g, '');
  return /^[-−]?\d[\d.,]+$/.test(compact);
}

export function extratoRowEhValorColunaSemHistorico(row: OcrExtratoRow): boolean {
  const valor =
    parseExtratoMoneyValue(row.valorDebito ?? '') ||
    parseExtratoMoneyValue(row.valorCredito ?? '') ||
    parseExtratoMoneyValue(row.valorMisto ?? '') ||
    0;
  if (valor <= 0.0001) return false;
  const desc = (row.descricao ?? row.historicoOperacao ?? '').trim();
  if (desc && extratoHistoricoEhSomenteDocumentoFiscal(desc)) return true;
  if (desc && extratoHistoricoEhPlausivel(desc)) return false;
  const linha = String(row._linhaOcr ?? '').trim();
  if (linha && extratoTrechoTemHistoricoOperacional(linha)) return false;
  return (!linha && !desc) || (linha && extratoLinhaEhSomenteDataEValor(linha) && !desc && row._extratoPosProcessado !== '1');
}

export function extratoHistoricoEhSomenteDocumentoFiscal(text: string): boolean {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const compact = t.replace(/\s/g, '');
  const m = compact.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
  if (!m) return false;
  return compact.replace(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g, '').replace(/[^\w]/g, '').length === 0;
}

export function extratoExtrairDocumentoFiscalDaLinha(text: string): string {
  const m = String(text ?? '').match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
  return m?.[0] ?? '';
}

export function extratoRowEhResumoPeriodoItau(row: OcrExtratoRow): boolean {
  const linha = String(row._linhaOcr ?? '').replace(/\s+/g, ' ').trim();
  const desc = resolveExtratoDescricaoText(row).replace(/\s+/g, ' ').trim();
  const blob = `${linha} ${desc}`.trim();
  return !!(
    /lan[cç]amentos\s+do\s+per[ií]odo\b/i.test(blob) ||
    /lan[cç]amentos\s+do\s+per[ií]odo\s*:/i.test(blob) ||
    /saldo\s+total\s+\d{2}\/\d{2}\s+at[eé]\s+\d{2}\/\d{2}/i.test(blob) ||
    /raz[aã]o\s+social\s+cnpj\/cpf\s+valor\s*\(r\$\)/i.test(blob)
  );
}

export function extratoLinhasSaldoInformativoDoTextoOcr(ocrText: string): OcrExtratoRow[] {
  return String(ocrText ?? '')
    .split(/\r?\n/)
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .filter(
      (t) =>
        RE_RUIDO_EXTRATO.test(t) ||
        /SALDO\s+(?:TOTAL\s+)?DISPON[IÍ]VEL|BLOQ/i.test(t) ||
        (/lan[cç]amentos/i.test(t) && RE_RUIDO_EXTRATO.test(t)),
    )
    .map((t) => ({ _linhaOcr: t }));
}

export function extrairSaldoAnteriorDeTextoOcr(ocrText: string): number {
  for (const row of extratoLinhasSaldoInformativoDoTextoOcr(ocrText)) {
    const sa = extrairSaldoAnteriorDeRow(row);
    if (sa >= 1000) return sa;
  }
  return 0;
}

export function saldoAnteriorDocumentadoNoExtrato(rows: OcrExtratoRow[], ocrText?: string): number {
  const fromRows = extrairSaldoAnteriorDasRows(rows);
  if (fromRows >= 1000) return fromRows;
  if (ocrText?.trim()) {
    const fromText = extrairSaldoAnteriorDeTextoOcr(ocrText);
    if (fromText >= 1000) return fromText;
  }
  return 0;
}

export function resolverSaldoAnteriorParaMetaExtrato(params: {
  rows?: OcrExtratoRow[];
  conciliacaoRawRows?: OcrExtratoRow[];
  ocrText?: string;
}): number | undefined {
  const pool = [...(params.conciliacaoRawRows ?? []), ...(params.rows ?? [])];
  const sa = saldoAnteriorDocumentadoNoExtrato(pool, params.ocrText);
  return sa >= 1000 ? sa : undefined;
}

function saldoAnteriorInformadoPlausivel(params: {
  informado: number;
  saldoFinal?: number;
  credits: number;
  debits: number;
  documentado: number;
}): boolean {
  const { informado, saldoFinal, credits, debits, documentado } = params;
  if (informado < 100) return false;
  if (documentado >= 1000 && Math.abs(informado - documentado) < 0.02) return true;
  if (saldoFinal != null && saldoFinal > 0) {
    const conc = informado + credits - debits;
    return Math.abs(conc - saldoFinal) < 5000;
  }
  return false;
}

export function resolverExtratoSaldoAnteriorImportacao(params: {
  rows: OcrExtratoRow[];
  conciliacaoRawRows?: OcrExtratoRow[];
  ocrText?: string;
  saldoAnteriorInformado?: number | null;
  saldoFinalEsperado?: number | null;
  items: Array<{ nature: 'D' | 'C'; value: number }>;
}): number {
  const pool = [...(params.conciliacaoRawRows ?? []), ...params.rows];
  const documentado = saldoAnteriorDocumentadoNoExtrato(pool, params.ocrText);
  if (documentado >= 1000) return documentado;
  const informado = params.saldoAnteriorInformado;
  if (informado == null || informado < 100) return 0;
  const credits = params.items.filter((i) => i.nature === 'C').reduce((s, i) => s + Math.abs(i.value), 0);
  const debits = params.items.filter((i) => i.nature === 'D').reduce((s, i) => s + Math.abs(i.value), 0);
  return saldoAnteriorInformadoPlausivel({
    informado,
    saldoFinal: params.saldoFinalEsperado ?? undefined,
    credits,
    debits,
    documentado,
  })
    ? 0
    : informado;
}

export function extratoExtrairSaldoDisponivelDiaDeLinha(text: string): number | undefined {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!/SALDO\s+(?:TOTAL\s+)?DISPON[IÍ]VEL/i.test(t)) return undefined;
  const hits = scanValoresTextoLinhaExtrato(t).filter((h) => h.value > 0.0001);
  if (hits.length === 0) return undefined;
  if (hits.length === 1) return hits[0]!.value;
  const sorted = [...hits].sort((a, b) => a.start - b.start);
  const saldoHits = sorted.filter((h) => extratoValorTextoEhSaldoDoDia(t, h));
  if (saldoHits.length > 0 && sorted.length >= 2) {
    const last = [...sorted].reverse().find((h) => !extratoValorTextoEhSaldoDoDia(t, h));
    if (last) return last.value;
  }
  return sorted[sorted.length - 1]!.value;
}

function rowValorAbs(row: OcrExtratoRow): number {
  return (
    parseExtratoMoneyValue(row.valorDebito ?? '') ||
    parseExtratoMoneyValue(row.valorCredito ?? '') ||
    parseExtratoMoneyValue(row.valorMisto ?? '') ||
    0
  );
}

export function extratoValorOperacionalJaResolvidoNasRows(
  valor: number,
  dataRef: string,
  rows: OcrExtratoRow[],
  skipIndex = -1,
  histHint = '',
): boolean {
  if (valor <= 0.0001) return false;
  const data = sanitizeExtratoDataOcrToken(dataRef) || dataRef.trim();
  const hint = String(histHint ?? '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 28);
  return rows.some((row, idx) => {
    if (idx === skipIndex) return false;
    const rowData = extratoRowDataNormalizada(row);
    if (data && rowData && rowData !== data) return false;
    const v = rowValorAbs(row);
    if (Math.abs(v - valor) >= 0.06) return false;
    const hist = extratoHistoricoPreferidoDaLinhaOcr(row) || resolveExtratoDescricaoText(row);
    if (hint && hist) {
      const h = hist.replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 28);
      return h === hint || h.startsWith(hint.slice(0, 12)) || hint.startsWith(h.slice(0, 12));
    }
    return !!hist || rowValorAbs(row) > 0.0001;
  });
}

export function extratoValorLancamentoPreferidoDaLinha(text: string): ExtratoValorTextoHit | null {
  const t = String(text ?? '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;

  let hits = scanValoresParaSplitExtrato(t).filter((h) => h.value > 0.0001);
  if (hits.length === 0) {
    hits = scanValoresTextoLinhaExtrato(t).filter(
      (h) => h.value > 0.0001 && !extratoValorTextoEhSaldoDoDia(t, h),
    );
  }
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0]!;

  const sorted = [...hits].sort((a, b) => a.start - b.start);
  const indicaDeb = extratoLinhaIndicaDebitoOperacionalItau(t);
  const indicaCred = extratoLinhaIndicaCreditoOperacionalItau(t);

  const pickDebito = (): ExtratoValorTextoHit => {
    const comDeb = sorted.filter((h) => h.nature === 'D' || valorHitIndicaDebitoExtrato(t, h));
    if (comDeb.length) return comDeb.sort((a, b) => a.value - b.value)[0]!;
    return sorted.sort((a, b) => a.value - b.value)[0]!;
  };

  const pickCredito = (): ExtratoValorTextoHit => {
    const comCred = sorted.filter(
      (h) => h.nature === 'C' || (!valorHitIndicaDebitoExtrato(t, h) && h.nature !== 'D'),
    );
    if (comCred.length) {
      if (/\bRENDIMENTOS|\bREND\b/i.test(t) && comCred.every((h) => h.value < 5)) {
        return comCred.sort((a, b) => a.value - b.value)[0]!;
      }
      return comCred.sort((a, b) => b.value - a.value)[0]!;
    }
    return sorted[sorted.length - 1]!;
  };

  if (indicaDeb && !indicaCred) return pickDebito();
  if (indicaCred && !indicaDeb) return pickCredito();

  if (sorted.length >= 2) {
    const byVal = [...sorted].sort((a, b) => a.value - b.value);
    const menor = byVal[0]!;
    const maior = byVal[byVal.length - 1]!;
    if (maior.value > menor.value * 3) return menor;
  }
  return sorted.find((h) => h.hasNature) ?? sorted[0]!;
}

export function extratoCorrigirRowNaturezaValorDesalinhado(row: OcrExtratoRow): OcrExtratoRow {
  const out = { ...row };
  const desc = resolveExtratoDescricaoText(out).trim();
  if (/^[DCdc]$/.test(desc)) {
    out.descricao = '';
    out.historicoOperacao = '';
    if (/^[DCdc]$/.test(String(out.natureza ?? '').trim())) out.natureza = '';
  }
  if (!resolveExtratoDescricaoText(out).trim() && out._linhaOcr?.trim()) {
    const inferred = inferDescricaoFromLinhaOcr(out._linhaOcr, out).trim();
    if (inferred && extratoHistoricoEhPlausivel(inferred)) {
      out.descricao = inferred;
      out.historicoOperacao = '';
    }
  }
  const linha = String(out._linhaOcr ?? '').replace(/\s+/g, ' ').trim();
  if (linha) {
    const lancHit = extratoValorLancamentoPreferidoDaLinha(linha);
    const picked =
      parseExtratoMoneyValue(out.valorMisto ?? '') ||
      parseExtratoMoneyValue(out.valorDebito ?? '') ||
      parseExtratoMoneyValue(out.valorCredito ?? '');
    if (lancHit && lancHit.value > 0.0001 && picked > 0.0001) {
      const diverge =
        Math.abs(picked - lancHit.value) > 0.05 &&
        (picked > lancHit.value * 1.8 ||
          lancHit.value > picked * 1.8 ||
          extratoLinhaIndicaDebitoOperacionalItau(linha) ||
          extratoLinhaIndicaCreditoOperacionalItau(linha));
      if (diverge) {
        let nat: 'D' | 'C' = lancHit.nature ?? 'C';
        if (!lancHit.hasNature) {
          nat = inferirNaturezaValorExtratoHit(linha, lancHit);
        }
        out.valorMisto = formatExtratoValorAssinadoPt(lancHit.value, nat);
        out.valorDebito = '';
        out.valorCredito = '';
      }
    }
  }
  return out;
}

export function repararHistoricoBbExtratoRow(row: OcrExtratoRow): OcrExtratoRow {
  const linha = extratoRowTextoLinhaFiel(row);
  if (!linhaPareceExtratoBbOcr(linha)) return row;
  const inferred = inferDescricaoFromLinhaOcr(linha, row).trim();
  if (!inferred || !extratoHistoricoEhPlausivel(inferred)) return row;
  const atual = resolveExtratoDescricaoText(row).trim();
  if (inferred.length > atual.length + 8 || !extratoHistoricoEhPlausivel(atual)) {
    return { ...row, descricao: inferred, historicoOperacao: '' };
  }
  return row;
}

export function repararHistoricoBbExtratoRows(rows: OcrExtratoRow[]): OcrExtratoRow[] {
  return rows.map(repararHistoricoBbExtratoRow);
}

export function repararHistoricoItauExtratoRow(row: OcrExtratoRow): OcrExtratoRow {
  const linha = extratoRowTextoLinhaFiel(row);
  if (!linhaPareceExtratoItauOcr(linha)) return row;
  const inferred = inferDescricaoFromLinhaOcr(linha, row).trim();
  if (!inferred || !extratoHistoricoEhPlausivel(inferred)) return row;
  const atual = resolveExtratoDescricaoText(row).trim();
  if (/^[DCdc]$/.test(atual)) {
    return extratoCorrigirRowNaturezaValorDesalinhado({ ...row, descricao: inferred, historicoOperacao: '' });
  }
  if (inferred.length > atual.length + 8) {
    return extratoCorrigirRowNaturezaValorDesalinhado({ ...row, descricao: inferred, historicoOperacao: '' });
  }
  return row;
}

export function repararHistoricoItauExtratoRows(rows: OcrExtratoRow[]): OcrExtratoRow[] {
  return rows.map(repararHistoricoItauExtratoRow);
}

export function repararExtratoRowsPosProcessados(rows: OcrExtratoRow[]): OcrExtratoRow[] {
  return repararHistoricoItauExtratoRows(repararHistoricoBbExtratoRows(rows))
    .map((r) => cleanExtratoOcrRowForImport(sanitizeExtratoOcrRowColumns(r)))
    .filter((r) => !extratoRowEhFantasmaValorSemHistorico(r));
}

export function extratoFinalizarRowsParaImportacao(rows: OcrExtratoRow[], ignoreWords: string[] = []): OcrExtratoRow[] {
  const filtered = ignoreWords.length > 0 ? removerLinhasComPalavrasIgnoradas(rows, ignoreWords) : rows;
  return splitExtratoOcrRowsPorLancamentosFundidos(filtered);
}

export function extratoConsolidarExtratoRowsParaImportacao(
  rows: OcrExtratoRow[],
  rawRows: OcrExtratoRow[],
  ignoreWords: string[] = [],
): OcrExtratoRow[] {
  const operacionais = rows.filter((r) => !extratoRowEhSaldoInformativo(r));
  const total = operacionais.reduce((s, r) => s + rowValorAbs(r), 0);
  if (operacionais.length > 0 && total > 0.0001 && !rows.some((r) => extratoRowEhSaldoInformativo(r))) {
    return extratoFinalizarRowsParaImportacao(operacionais, ignoreWords);
  }
  const comValor = rows.filter((r) => !extratoRowEhSaldoInformativo(r) && rowValorAbs(r) > 0.0001);
  if (comValor.length > 0 && !rows.some((r) => extratoRowEhSaldoInformativo(r))) {
    return extratoFinalizarRowsParaImportacao(rows, ignoreWords);
  }
  const reparados = repararHistoricoItauExtratoRows(repararHistoricoBbExtratoRows(rows));
  return extratoFinalizarRowsParaImportacao(reparados, ignoreWords);
}

// Stubs mínimos — pipeline avançado Itaú (pareamento órfãos / raw recovery)
export function extratoDescricaoFallbackCreditoOrfao(
  _rows: OcrExtratoRow[],
  _dataRef: string,
  valor: number,
  opts?: { allowGeneric?: boolean },
): string {
  if (valor > 0 && valor < 1) return 'RENDIMENTOS';
  if (opts?.allowGeneric && valor >= 50) return 'TED RECEBIDA — LANCAMENTO OCR';
  return '';
}

export function extratoOrfaoVeioDeSaldoColadoNoRaw(
  _rawRows: OcrExtratoRow[],
  _data: string,
  _valor: number,
  linhaOrigem = '',
): boolean {
  return !!linhaOrigem && extratoLinhaSaldoTemValorLancamentoColado(linhaOrigem);
}

export function extratoMergedRowSalvouLancamentos(
  row: OcrExtratoRow,
  pool: OcrExtratoRow[],
  ignoreWords: string[] = [],
): boolean {
  const linha = normalizeLinhaOcrParaSplit(String(row._linhaOcr ?? ''));
  if (!linha || !extratoLinhaTemLancamentoOperacionalRecuperavel(linha)) return false;
  const out = removerLinhasComPalavrasIgnoradas(splitExtratoOcrRowsPorLancamentosFundidos([{ ...row, _linhaOcr: linha }]), ignoreWords).filter(
    (r) => !extratoRowEhSaldoInformativo(r),
  );
  return out.some((r) => rowValorAbs(r) > 0.0001 && resolveExtratoDescricaoText(r).trim().length > 2);
}

export function extratoMesclarHistoricoMultilinhaSemValorAnterior(rows: OcrExtratoRow[]): OcrExtratoRow[] {
  return mergeExtratoDescricaoContinuacao(rows);
}

export function parearValoresOrfaosComHistoricoSemValor(rows: OcrExtratoRow[]): OcrExtratoRow[] {
  return mergeExtratoValorOrfao(rows);
}

export function extratoAnexarOrfaosSaldoColadoComHistoricoRaw(
  rows: OcrExtratoRow[],
  _raw: OcrExtratoRow[],
): OcrExtratoRow[] {
  return rows;
}

export function extratoParearValoresDeSaldoColadoComHistoricoRaw(
  rows: OcrExtratoRow[],
  _raw: OcrExtratoRow[],
): OcrExtratoRow[] {
  return rows;
}

export function extratoInjetarHistoricoOperacionalFaltanteDoRaw(
  rows: OcrExtratoRow[],
  _raw: OcrExtratoRow[],
): OcrExtratoRow[] {
  return rows;
}

export function extratoRecuperarLancamentosFaltantesDoRaw(
  rows: OcrExtratoRow[],
  _raw: OcrExtratoRow[],
): OcrExtratoRow[] {
  return rows;
}

export function extratoRawBbLancamentoRecuperadoNoMap(
  _row: OcrExtratoRow,
  _map: Map<string, OcrExtratoRow>,
): boolean {
  return false;
}

export function extratoRawItauLancamentoRecuperadoNoMap(
  _row: OcrExtratoRow,
  _map: Map<string, OcrExtratoRow>,
): boolean {
  return false;
}

export function extratoRawLancamentoRecuperadoNoMap(
  row: OcrExtratoRow,
  map: Map<string, OcrExtratoRow>,
): boolean {
  return extratoRawBbLancamentoRecuperadoNoMap(row, map) || extratoRawItauLancamentoRecuperadoNoMap(row, map);
}

export function extratoRepararRowsHistoricoSomenteDocumentoItau(
  rows: OcrExtratoRow[],
  raw: OcrExtratoRow[] = rows,
): OcrExtratoRow[] {
  return rows.map((row, idx) => {
    const desc = resolveExtratoDescricaoText(row).trim();
    const linha = String(row._linhaOcr ?? '').replace(/\s+/g, ' ').trim();
    const doc = extratoExtrairDocumentoFiscalDaLinha(linha);
    if (!extratoHistoricoEhSomenteDocumentoFiscal(desc) && !doc) return row;
    const valor = rowValorAbs(row);
    if (valor <= 0.0001) return row;
    const inferred = inferDescricaoFromLinhaOcr(linha, row);
    if (inferred && extratoHistoricoEhPlausivel(inferred)) {
      return extratoCorrigirRowNaturezaValorDesalinhado({ ...row, descricao: inferred, historicoOperacao: '' });
    }
    const rawHist = raw[idx] ? inferDescricaoFromLinhaOcr(String(raw[idx]._linhaOcr ?? ''), raw[idx]!) : '';
    if (rawHist && extratoHistoricoEhPlausivel(rawHist)) {
      return extratoCorrigirRowNaturezaValorDesalinhado({ ...row, descricao: rawHist, historicoOperacao: '' });
    }
    return extratoHistoricoEhSomenteDocumentoFiscal(desc)
      ? extratoCorrigirRowNaturezaValorDesalinhado({ ...row, descricao: '', historicoOperacao: '' })
      : row;
  });
}

export function extratoInferirHistoricoDeLinhasAnteriores(
  rows: OcrExtratoRow[],
  idx: number,
  dataRef: string,
): string {
  for (let i = idx - 1; i >= 0 && idx - i <= 15; i--) {
    const row = rows[i]!;
    if (dataRef && extratoRowDataNormalizada(row) !== dataRef) continue;
    const hist = extratoHistoricoPreferidoDaLinhaOcr(row) || resolveExtratoDescricaoText(row);
    if (hist && extratoHistoricoEhPlausivel(hist) && !extratoHistoricoEhSomenteSaldoInformativo(hist)) return hist;
  }
  return '';
}

export function extratoInferirHistoricoDeLinhasPosteriores(
  rows: OcrExtratoRow[],
  idx: number,
  dataRef: string,
): string {
  for (let i = idx + 1; i < rows.length && i - idx <= 5; i++) {
    const row = rows[i]!;
    if (dataRef && extratoRowDataNormalizada(row) !== dataRef) continue;
    const hist = extratoHistoricoPreferidoDaLinhaOcr(row) || resolveExtratoDescricaoText(row);
    if (hist && extratoHistoricoEhPlausivel(hist) && !extratoHistoricoEhSomenteSaldoInformativo(hist)) return hist;
  }
  return '';
}

export function extratoInferirHistoricoMesmoDiaNosRows(
  rows: OcrExtratoRow[],
  idx: number,
  dataRef: string,
): string {
  const data = sanitizeExtratoDataOcrToken(dataRef) || dataRef.trim();
  let best: { hist: string; score: number } | null = null;
  for (let i = 0; i < rows.length; i++) {
    if (i === idx) continue;
    const row = rows[i]!;
    if (data && extratoRowDataNormalizada(row) !== data) continue;
    const hist = extratoHistoricoPreferidoDaLinhaOcr(row) || resolveExtratoDescricaoText(row);
    if (!hist || !extratoHistoricoEhPlausivel(hist)) continue;
    const score = hist.length;
    if (!best || score > best.score) best = { hist, score };
  }
  return best?.hist ?? '';
}

export function extratoInferirHistoricoParaValorOrfao(
  rows: OcrExtratoRow[],
  idx: number,
  dataRef: string,
): string {
  const valor = rowValorAbs(rows[idx] ?? {});
  if (valor > 0 && valor < 1) return 'RENDIMENTOS';
  return (
    extratoInferirHistoricoDeLinhasAnteriores(rows, idx, dataRef) ||
    extratoInferirHistoricoDeLinhasPosteriores(rows, idx, dataRef)
  );
}

export function extratoInferirHistoricoParaValorOrfaoComRaw(
  rows: OcrExtratoRow[],
  rawRows: OcrExtratoRow[],
  idx: number,
  dataRef: string,
): string {
  return extratoInferirHistoricoParaValorOrfao(rows, idx, dataRef) || extratoDescricaoFallbackCreditoOrfao(rawRows, dataRef, rowValorAbs(rows[idx] ?? {}));
}

export function extratoInferirHistoricoItauPorDocumentoValorNoRaw(
  _raw: OcrExtratoRow[],
  _data: string,
  _doc: string,
  _valor: number,
  _skip = -1,
): string {
  return '';
}

export function extratoLinhaDeveSerDescartadaNoSplit(_text: string): boolean {
  return false;
}

export function limparItauExtratoRowDuplaColunaMonetaria(row: OcrExtratoRow): OcrExtratoRow {
  return consolidarColunasValorExtratoRow(row);
}
