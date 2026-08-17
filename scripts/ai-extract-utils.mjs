/**
 * Utilitários de pós-processamento — extração IA de extrato.
 */
import { CONCILIACAO_TOLERANCIA_REAIS } from './ai-extract-prompts.mjs';

const RE_DATA_BR = /^(\d{2})\/(\d{2})\/(\d{2,4})$/;
const SALDO_NOISE =
  /saldo\s+(anterior|do\s+dia|total|dispon[ií]vel|em\s+\d{2}\/\d{2})|total\s+(de\s+)?(d[eé]bitos|cr[eé]ditos)|consultas\s*-\s*extrato/i;
const HEADER_NOISE =
  /^(data|lan[cç]amento|documento|valor\s*r?\$?|hist[oó]rico|ag[eê]ncia|conta|per[ií]odo)\b/i;
const RE_MONEY_CD = /(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s*([DC])\b/gi;
const RE_MONEY_CD_COLADO = /(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})([DC])(?!\w)/gi;
const RE_DEBIT_HIST =
  /\b(SISPAG|TAR\b|IOF\b|PAGAMENTO|SEFAZ|TRIB|DEB\s|ENVIAD|FORNECEDOR|DARF|GPS\b|FGTS)/i;
const RE_CREDIT_HIST =
  /\b(TED\s*REC|RECEBID|RENDIMENTOS|PIX\s*REC|CR[EÉ]DITO|RECEBIMENTO)/i;

function parseExtratoNaturezaColado(raw) {
  const s = String(raw ?? '').trim();
  if (!s || /,\d{2}\s+[DCdc]\s*$/i.test(s)) return null;
  const compact = s.replace(/\s+/g, '');
  const m = compact.match(/(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})([DCdc])$/);
  if (!m) return null;
  return m[2].toUpperCase() === 'D' ? 'D' : 'C';
}

export function inferNatureFromRow(row) {
  const deb = parseMoneyBr(row?.valorDebito);
  if (deb > 0.0001) return 'D';
  const cred = parseMoneyBr(row?.valorCredito);
  if (cred > 0.0001) return 'C';

  const misto = String(row?.valorMisto ?? '').trim();
  if (/^[-−(]/.test(misto)) return 'D';
  const mistoVal = parseMoneyBr(misto);
  const colado = parseExtratoNaturezaColado(misto);
  if (colado) return colado;

  const desc = `${row?.descricao ?? ''} ${row?.historicoOperacao ?? ''}`;
  if (mistoVal > 0.0001) {
    if (RE_DEBIT_HIST.test(desc) && !RE_CREDIT_HIST.test(desc)) return 'D';
    if (RE_CREDIT_HIST.test(desc) && !RE_DEBIT_HIST.test(desc)) return 'C';
  }

  const line = String(row?._linhaOcr ?? '').trim();
  if (!/,\d{2}\s+[DCdc]\s*$/i.test(line)) {
    const pairs = [...line.matchAll(RE_MONEY_CD_COLADO)];
    if (pairs.length > 0) {
      const tx = pairs.length >= 2 ? pairs[pairs.length - 2] : pairs[pairs.length - 1];
      if (tx[2].toUpperCase() === 'D') return 'D';
      if (tx[2].toUpperCase() === 'C') return 'C';
    }
  }

  return 'C';
}

export function parseMoneyBr(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.abs(value);
  const t = String(value ?? '')
    .trim()
    .replace(/[Rr]\$\s*/g, '')
    .replace(/\s+/g, '');
  if (!t) return 0;
  const num = parseFloat(
    t
      .replace(/[^\d,.-−]/g, '')
      .replace(/\./g, '')
      .replace(',', '.')
      .replace(/[-−]/g, ''),
  );
  if (!Number.isFinite(num)) return 0;
  return Math.abs(num);
}

/** Saldo pode ser negativo — preserva sinal. */
export function parseSaldoBr(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value ?? '').trim();
  const neg = /^[-−(]/.test(raw) || /\bD\s*$/i.test(raw) || /,\d{2}\s*D\s*$/i.test(raw);
  const t = raw
    .replace(/[Rr]\$\s*/g, '')
    .replace(/\s+/g, '');
  if (!t) return null;
  const num = parseFloat(
    t
      .replace(/[^\d,.-−]/g, '')
      .replace(/\./g, '')
      .replace(',', '.')
      .replace(/[-−()]/g, ''),
  );
  if (!Number.isFinite(num)) return null;
  return neg ? -Math.abs(num) : num;
}

export function rowOperationalValue(row) {
  const deb = parseMoneyBr(row?.valorDebito);
  if (deb > 0.0001) return deb;
  const cred = parseMoneyBr(row?.valorCredito);
  if (cred > 0.0001) return cred;
  return parseMoneyBr(row?.valorMisto);
}

export function computeConciliacaoAi(rows, saldoAnterior, saldoFinal) {
  let creditos = 0;
  let debitos = 0;
  for (const r of rows) {
    const val = rowOperationalValue(r);
    if (val <= 0.0001) continue;
    if (inferNatureFromRow(r) === 'D') debitos += val;
    else creditos += val;
  }
  const sa = typeof saldoAnterior === 'number' && Number.isFinite(saldoAnterior) ? saldoAnterior : 0;
  const saldoConciliado = Math.round((sa + creditos - debitos) * 100) / 100;
  const delta =
    typeof saldoFinal === 'number' && Number.isFinite(saldoFinal)
      ? Math.round(Math.abs(saldoConciliado - saldoFinal) * 100) / 100
      : null;
  const ok = delta != null && delta <= CONCILIACAO_TOLERANCIA_REAIS;
  return { ok, creditos, debitos, saldoConciliado, delta, saldoAnterior: sa, saldoFinal };
}

export function mergeAiExtratoRows(base, extra) {
  const out = [...base];
  const fp = (r) =>
    `${String(r.data ?? '').slice(0, 10)}|${rowOperationalValue(r).toFixed(2)}|${inferNatureFromRow(r)}|${String(r.descricao ?? '').slice(0, 28)}`;
  const seen = new Set(out.map(fp));
  for (const r of extra) {
    const key = fp(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function normalizeDateBr(raw, statementYear) {
  const t = String(raw ?? '').trim().split(/\s/)[0] ?? '';
  
  const mYmd = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (mYmd) {
    return `${mYmd[3].padStart(2, '0')}/${mYmd[2].padStart(2, '0')}/${mYmd[1]}`;
  }

  const clean = t.replace(/[-.]/g, '/');
  
  const m3 = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m3) {
    let year = m3[3];
    if (year.length === 2) year = `20${year}`;
    if (year.length !== 4) year = String(statementYear ?? new Date().getFullYear());
    return `${m3[1].padStart(2, '0')}/${m3[2].padStart(2, '0')}/${year}`;
  }
  
  const m2 = clean.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m2) {
    const year = String(statementYear ?? new Date().getFullYear());
    return `${m2[1].padStart(2, '0')}/${m2[2].padStart(2, '0')}/${year}`;
  }
  
  return clean;
}

/** Valor com sinal negativo sem sufixo C/D (comum em extratos escaneados). */
export function normalizeSignedValorAiRow(row) {
  const misto = String(row?.valorMisto ?? '').trim();
  if (!misto || /[DC]\s*$/i.test(misto)) return row;
  if (/^[-−]/.test(misto)) {
    const abs = misto.replace(/^[-−]\s*/, '').trim();
    if (!abs) return row;
    return {
      ...row,
      valorDebito: abs,
      valorCredito: '',
      valorMisto: `${abs} D`,
    };
  }
  return row;
}

/** BB/Itaú: sufixo D/C colado na linha OCR (ignora D/C separado por espaço no Itaú). */
export function assignNatureFromLinhaOcr(row) {
  const line = String(row?._linhaOcr ?? '').trim();
  if (!line || /,\d{2}\s+[DCdc]\s*$/i.test(line)) return row;
  const pairs = [...line.matchAll(RE_MONEY_CD_COLADO)];
  if (pairs.length === 0) return row;

  const tx = pairs.length >= 2 ? pairs[pairs.length - 2] : pairs[pairs.length - 1];
  const token = tx[1];
  const cd = tx[2].toUpperCase();
  const out = { ...row };
  out.valorCredito = '';
  out.valorDebito = '';
  if (cd === 'D') {
    out.valorDebito = token;
    out.valorMisto = `${token}D`;
  } else {
    out.valorCredito = token;
    out.valorMisto = `${token}C`;
  }
  return out;
}

function isAiNoiseRow(row) {
  const desc = `${row?.descricao ?? ''} ${row?._linhaOcr ?? ''}`.replace(/\s+/g, ' ').trim();
  if (!desc && rowOperationalValue(row) < 0.01) return true;
  if (SALDO_NOISE.test(desc) && rowOperationalValue(row) < 0.01) return true;
  if (SALDO_NOISE.test(desc) && /saldo\s+anterior/i.test(desc)) return true;
  if (HEADER_NOISE.test(desc) && desc.length < 28 && rowOperationalValue(row) < 0.01) return true;
  if (/^https?:\/\//i.test(desc)) return true;
  return false;
}

function cleanHistoricoPix(desc) {
  return String(desc ?? '')
    .replace(/\bPix\s*-\s*(Recebido|Enviado)\s+[\d./-]{8,}/gi, 'Pix - $1')
    .replace(/\s+/g, ' ')
    .trim();
}

function isDatePlaceholder(s) {
  const t = String(s ?? '').trim();
  if (!t) return true;
  const compact = t.replace(/\s+/g, '');
  if (/^[-–—_./\\|]+$/.test(compact)) return true;
  if (/^(n\/?a|null|vazio|s\/d|nd|n\.?d\.?)$/i.test(compact)) return true;
  if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(compact)) return true;
  return false;
}

export function normalizeAiRows(raw, options = {}) {
  const statementYear = options.statementYear ?? new Date().getFullYear();
  const bankHint = options.bankHint ?? null;

  if (!Array.isArray(raw)) return [];

  let lastValidDate = '';

  const mapped = raw
    .map((r) => {
      const rawDate = String(r?.data ?? '').trim();
      let row = {
        data: '',
        descricao: cleanHistoricoPix(String(r?.descricao ?? r?.historico ?? '').trim()),
        valorCredito: String(r?.valorCredito ?? '').trim(),
        valorDebito: String(r?.valorDebito ?? '').trim(),
        valorMisto: String(r?.valorMisto ?? r?.valor ?? '').trim(),
        historicoOperacao: String(r?.historicoOperacao ?? r?.descricao ?? '').trim(),
        _linhaOcr: String(
          r?._linhaOcr ?? [r?.data, r?.descricao, r?.valorMisto, r?.valorCredito, r?.valorDebito].filter(Boolean).join(' '),
        ).trim(),
        _extratoAiExtract: '1',
      };

      let dataRaw = normalizeDateBr(rawDate, statementYear);
      let datePart = dataRaw.split(/\s/)[0] ?? '';
      const rowSeemsOperational =
        rowOperationalValue(row) >= 0.01 || String(row.descricao ?? '').trim().length > 4;

      if (RE_DATA_BR.test(datePart)) {
        lastValidDate = datePart;
      } else if (lastValidDate && (isDatePlaceholder(rawDate) || rowSeemsOperational)) {
        // Quando o banco repete a data só na primeira linha do dia, herdamos a última data válida.
        dataRaw = lastValidDate;
        datePart = lastValidDate;
      } else {
        dataRaw = '';
        datePart = '';
      }
      row.data = dataRaw;

      const deb = parseMoneyBr(row.valorDebito);
      const cred = parseMoneyBr(row.valorCredito);
      if (deb > 0.0001 && cred > 0.0001) {
        if (inferNatureFromRow(row) === 'D') row.valorCredito = '';
        else row.valorDebito = '';
      }

      row = normalizeSignedValorAiRow(row);

      if (RE_MONEY_CD_COLADO.test(row._linhaOcr) && !/,\d{2}\s+[DCdc]\s*$/i.test(row._linhaOcr)) {
        row = assignNatureFromLinhaOcr(row);
      } else if (bankHint === 'bb' || bankHint === 'sicredi') {
        row = assignNatureFromLinhaOcr(row);
      }

      if (!row.valorDebito && !row.valorCredito && row.valorMisto) {
        const nature = inferNatureFromRow(row);
        if (nature === 'D') {
          const token = String(row.valorMisto).replace(/^[-−]\s*/, '').replace(/\s+[DCdc]\s*$/i, '').trim();
          row.valorDebito = token;
          row.valorCredito = '';
        } else if (nature === 'C') {
          const token = String(row.valorMisto).replace(/^[-−]\s*/, '').replace(/\s+[DCdc]\s*$/i, '').trim();
          row.valorCredito = token;
          row.valorDebito = '';
        }
      }

      return row;
    })
    .filter((r) => r.descricao || r.valorMisto || r.valorCredito || r.valorDebito)
    .filter((r) => !isAiNoiseRow(r))
    .filter((r) => {
      // Mantém lançamentos com valor zero desde que tenham descrição clara (ex: tarifas, estornos zerados)
      const val = rowOperationalValue(r);
      const hasDesc = String(r.descricao ?? '').trim().length > 2;
      return val >= 0.01 || hasDesc;
    })
    .filter((r) => {
      const d = r.data?.split(/\s/)[0] ?? '';
      if (RE_DATA_BR.test(d)) return true;
      // Não descartamos linha operacional só porque a data veio borrada;
      // a revisão/importação posterior ainda pode herdá-la da linha anterior.
      const val = rowOperationalValue(r);
      const hasDesc = String(r.descricao ?? '').trim().length > 4;
      return val >= 0.01 && hasDesc;
    });

  return mapped;
}

/** Normaliza linhas de plano de contas extraídas/refinadas por IA. */
export function normalizeAiPlanoRows(raw) {
  if (!Array.isArray(raw)) return [];

  const normTipo = (v, code, nivel) => {
    const t = String(v ?? '')
      .trim()
      .toUpperCase()
      .replace(/SINT[EÉ]TIC[AO]/i, 'S')
      .replace(/ANAL[IÍ]TIC[AO]/i, 'A');
    if (t === 'S' || t.startsWith('S')) return 'S';
    if (t === 'A' || t.startsWith('A')) return 'A';
    const norm = String(code ?? '').replace(/\s/g, '');
    const n = parseInt(String(nivel ?? ''), 10);
    if (/\.\d{5}$/.test(norm)) return 'A';
    if (Number.isFinite(n) && n >= 5) return 'A';
    if (Number.isFinite(n) && n <= 4 && (norm.match(/\./g) || []).length <= 3) return 'S';
    if ((norm.match(/\./g) || []).length >= 4) return 'A';
    if ((norm.match(/\./g) || []).length <= 1) return 'S';
    return t.slice(0, 1);
  };

  return raw
    .map((r) => {
      const codigoClassificacao = String(
        r?.codigoClassificacao ?? r?.classificacao ?? r?.codigo ?? r?.conta ?? '',
      ).trim();
      const nivel = String(r?.nivel ?? r?.grau ?? r?.level ?? '').trim();
      return {
      codigoReduzido: String(r?.codigoReduzido ?? r?.reduzido ?? r?.codigoRed ?? '').trim(),
      codigoClassificacao,
      descricao: String(r?.descricao ?? r?.nomeConta ?? r?.nome ?? '').trim(),
      tipo: normTipo(r?.tipo, codigoClassificacao, nivel),
      nivel,
      _linhaOcr: String(
        r?._linhaOcr ??
          [r?.codigoReduzido, r?.codigoClassificacao, r?.descricao, r?.tipo, r?.nivel]
            .filter(Boolean)
            .join(' '),
      ).trim(),
      _extratoAiExtract: '1',
    };
    })
    .filter((r) => r.codigoClassificacao || r.descricao);
}

export function parseAiSaldoFields(parsed) {
  const saldoAnterior =
    parseSaldoBr(parsed?.saldoAnterior) ??
    parseSaldoBr(parsed?.saldo_anterior) ??
    null;
  const saldoFinal =
    parseSaldoBr(parsed?.saldoFinal) ??
    parseSaldoBr(parsed?.saldo_final) ??
    parseSaldoBr(parsed?.saldoTotal) ??
    null;
  return { saldoAnterior, saldoFinal };
}

export function needsConciliacaoRepair(conciliacao) {
  if (!conciliacao || conciliacao.ok) return false;
  if (conciliacao.delta == null) return false;
  return conciliacao.delta > CONCILIACAO_TOLERANCIA_REAIS;
}

/** Saldo anterior no texto OCR (SALDO ANTERIOR / SALDOANTERIOR colado). */
export function extrairSaldoAnteriorDeOcrTexto(ocrText) {
  const blob = String(ocrText ?? '').replace(/\s+/g, ' ').trim();
  if (!blob) return null;
  const padroes = [
    /SALDO\s*ANTERIOR[^\d]{0,48}(\d{1,3}(?:\.\d{3})*,\d{2})/i,
    /SALDOANTERIOR[^\d]{0,24}(\d{1,3}(?:\.\d{3})*,\d{2})/i,
  ];
  for (const re of padroes) {
    const m = blob.match(re);
    if (!m?.[1]) continue;
    const v = parseSaldoBr(m[1]);
    if (v != null && v >= 1000) return v;
  }
  return null;
}

export function escolherSaldoAnteriorAi(rows, saldoAnterior, saldoFinal, ocrText) {
  const saOcr = extrairSaldoAnteriorDeOcrTexto(ocrText);
  if (saOcr != null) return saOcr;

  for (const row of rows ?? []) {
    const blob = `${row._linhaOcr ?? ''} ${row.descricao ?? ''}`.replace(/\s+/g, ' ').trim();
    if (!/SALDO\s*ANTERIOR|SALDOANTERIOR/i.test(blob)) continue;
    const m = blob.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/);
    if (!m?.[1]) continue;
    const v = parseSaldoBr(m[1]);
    if (v != null && v >= 1000) return v;
  }

  // Nunca devolver saldoAnterior da IA só para fechar saldoFinal sem linha no documento.
  if (saldoAnterior != null && saldoFinal != null) {
    const conc = computeConciliacaoAi(rows, saldoAnterior, saldoFinal);
    if (conc.ok) return null;
  }

  return null;
}
