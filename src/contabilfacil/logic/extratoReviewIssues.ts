import type { GenericOcrRow } from '../../lib/parcelamentoColunasExtract';
import {
  extratoCorrigirRowNaturezaValorDesalinhado,
  extratoHistoricoEhPlausivel,
  extratoRecuperarLancamentosFaltantesDoRaw,
  extratoRepararRowsHistoricoSomenteDocumentoItau,
  repararHistoricoItauExtratoRow,
  resolveExtratoDescricaoText,
  type OcrExtratoRow,
} from '../../lib/ocrExtratoPositional';
import type { ExtratoExtractQuality } from './extratoQualityGate';
import {
  extratoNaturezaExplicitaNoRow,
  resolveExtratoValorNatureza,
} from './ocrImportMapper';
import {
  extratoNaturezaPorOrigemAi,
  parseMoedaPtFromExtratoColuna,
  extratoNaturezaPorValorAssinadoNoToken,
  extratoRowVeioDaExtracaoAi,
} from '../../extratoVision/utils/extratoMoneyParse';

export type ExtratoReviewIssueKind =
  | 'invertido'
  | 'sem_historico'
  | 'sem_valor'
  | 'pagina_sem_ocr'
  | 'conciliacao'
  | 'faltante';

export type ExtratoReviewIssueRow = {
  key: string;
  index: number;
  pagina: number;
  row?: GenericOcrRow;
  data: string;
  descricao: string;
  valorLabel: string;
  nature: 'D' | 'C' | '—';
  kinds: ExtratoReviewIssueKind[];
  detalhe: string;
  linhaOcr?: string;
};

function parsePagina(row: GenericOcrRow, fallback: number): number {
  const raw = String(row._pagina ?? '').trim();
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Remove páginas da lista «sem OCR» quando já há lançamentos extraídos delas. */
export function filterSkippedPagesForExtratoReview(
  skippedPages: number[] | undefined,
  rows: GenericOcrRow[],
): number[] {
  const skipped = skippedPages ?? [];
  if (skipped.length === 0) return [];
  const pagesWithRows = new Set<number>();
  for (const r of rows) {
    const p = parseInt(String(r._pagina ?? '').trim(), 10);
    if (Number.isFinite(p) && p > 0) pagesWithRows.add(p);
  }
  return skipped.filter((p) => !pagesWithRows.has(p));
}

function naturezaColunasRaw(row: GenericOcrRow): 'D' | 'C' | null {
  const aiNature = extratoNaturezaPorOrigemAi(row);
  if (aiNature) return aiNature.nature;

  const debRaw = String(row.valorDebito ?? '').trim();
  const credRaw = String(row.valorCredito ?? '').trim();
  const deb = parseMoedaPtFromExtratoColuna(debRaw);
  const cred = parseMoedaPtFromExtratoColuna(credRaw);

  if (extratoRowVeioDaExtracaoAi(row)) {
    if (deb > 0.0001 && cred <= 0) return 'D';
    if (cred > 0.0001 && deb <= 0) return 'C';
  } else {
    if (deb > 0.0001 && cred <= 0) {
      return extratoNaturezaPorValorAssinadoNoToken(debRaw, deb);
    }
    if (cred > 0.0001 && deb <= 0) {
      return extratoNaturezaPorValorAssinadoNoToken(credRaw, cred);
    }
  }

  const misto = String(row.valorMisto ?? '').trim();
  if (misto) {
    const v = parseMoedaPtFromExtratoColuna(misto.replace(/^[-−]/, ''));
    if (v > 0.0001) return extratoNaturezaPorValorAssinadoNoToken(misto, v);
  }
  return null;
}

function rowFingerprint(r: GenericOcrRow): string {
  const { value, nature } = resolveExtratoValorNatureza(r);
  const line = String(r._linhaOcr ?? '').trim();
  const data =
    String(r.data ?? '').trim().split(/\s/)[0] ||
    line.match(/(\d{2}\/\d{2}\/\d{2,4})/)?.[1] ||
    '';
  const desc = resolveExtratoDescricaoText(r).slice(0, 36).toUpperCase();
  return `${data}|${value.toFixed(2)}|${nature}|${desc}`;
}

function buildRawOcrRows(ocrText: string, conciliacaoRawRows?: GenericOcrRow[]): OcrExtratoRow[] {
  const seen = new Set<string>();
  const out: OcrExtratoRow[] = [];

  const push = (linha: string) => {
    const norm = linha.replace(/\s+/g, ' ').trim();
    if (norm.length < 6 || seen.has(norm)) return;
    seen.add(norm);
    out.push({
      _linhaOcr: norm,
      data: norm.match(/(\d{2}\/\d{2}\/\d{2,4})/)?.[1] ?? '',
    });
  };

  for (const r of conciliacaoRawRows ?? []) {
    const l = String(r._linhaOcr ?? '').trim();
    if (l) push(l);
  }

  for (const line of ocrText.split(/\n+/)) {
    push(line);
  }

  return out;
}

function detectFaltantesDoOcrBruto(
  rows: GenericOcrRow[],
  ocrText: string,
  conciliacaoRawRows?: GenericOcrRow[],
): ExtratoReviewIssueRow[] {
  const rawRows = buildRawOcrRows(ocrText, conciliacaoRawRows);
  if (rawRows.length === 0) return [];

  const extractedFps = new Set(rows.map(rowFingerprint));
  const recovered = extratoRecuperarLancamentosFaltantesDoRaw(
    rows as OcrExtratoRow[],
    rawRows,
  );

  const issues: ExtratoReviewIssueRow[] = [];
  let seq = 0;

  for (const r of recovered) {
    const fp = rowFingerprint(r);
    if (extractedFps.has(fp)) continue;
    extractedFps.add(fp);

    const { value, nature } = resolveExtratoValorNatureza(r);
    if (value <= 0.0001) continue;

    seq++;
    const descricao = resolveExtratoDescricaoText(r).trim() || '(sem histórico no OCR)';
    const signed = nature === 'D' ? -value : value;
    issues.push({
      key: `faltante-ocr-${seq}`,
      index: 0,
      pagina: parsePagina(r, 1),
      row: r,
      data: r.data?.trim() || '—',
      descricao,
      valorLabel: signed.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      nature,
      kinds: ['faltante'],
      detalhe: 'Lançamento no OCR bruto não entrou na extração por colunas',
      linhaOcr: String(r._linhaOcr ?? '').trim() || undefined,
    });
  }

  return issues;
}

function detectFaltantesPorConciliacao(quality: ExtratoExtractQuality): ExtratoReviewIssueRow[] {
  const issues: ExtratoReviewIssueRow[] = [];
  if (quality.conciliacaoOk) return issues;

  if (quality.saldoFinal == null || quality.delta == null) {
    issues.push({
      key: 'faltante-sem-saldo-final',
      index: 0,
      pagina: 0,
      data: '—',
      descricao: 'Lançamento(s) possivelmente faltante(s) — saldo final não identificado',
      valorLabel: '—',
      nature: '—',
      kinds: ['faltante', 'conciliacao'],
      detalhe:
        'Sem saldo final no OCR não dá para estimar o valor; confira linhas do OCR bruto abaixo ou reprocesse com mais resolução',
    });
    if (!quality.rowCountOk) {
      const faltam = Math.max(0, quality.minRowsExpected - quality.rowCount);
      issues.push({
        key: 'faltante-contagem',
        index: 0,
        pagina: 0,
        data: '—',
        descricao: `~${faltam} lançamento(s) a menos que o esperado`,
        valorLabel: '—',
        nature: '—',
        kinds: ['faltante'],
        detalhe: `Extraídos ${quality.rowCount}; esperado ~${quality.minRowsExpected} para o período`,
      });
    }
    return issues;
  }

  const gap = Math.round((quality.saldoConciliado - quality.saldoFinal) * 100) / 100;
  if (Math.abs(gap) <= 0.1) return issues;

  if (gap > 0.1) {
    issues.push({
      key: 'faltante-debito-estimado',
      index: 0,
      pagina: 0,
      data: '—',
      descricao: 'Débito(s) não extraído(s) — estimativa pela conciliação',
      valorLabel: gap.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      nature: 'D',
      kinds: ['faltante', 'conciliacao'],
      detalhe: `Saldo conciliado R$ ${quality.saldoConciliado.toFixed(2)} > saldo final R$ ${quality.saldoFinal.toFixed(2)} — falta ~R$ ${gap.toFixed(2)} em débitos (ou há crédito a mais)`,
    });
  } else {
    const cred = Math.abs(gap);
    issues.push({
      key: 'faltante-credito-estimado',
      index: 0,
      pagina: 0,
      data: '—',
      descricao: 'Crédito(s) não extraído(s) — estimativa pela conciliação',
      valorLabel: cred.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      nature: 'C',
      kinds: ['faltante', 'conciliacao'],
      detalhe: `Saldo conciliado R$ ${quality.saldoConciliado.toFixed(2)} < saldo final R$ ${quality.saldoFinal.toFixed(2)} — falta ~R$ ${cred.toFixed(2)} em créditos (ou há débito a mais)`,
    });
  }

  if (!quality.rowCountOk) {
    const faltam = Math.max(0, quality.minRowsExpected - quality.rowCount);
    issues.push({
      key: 'faltante-contagem',
      index: 0,
      pagina: 0,
      data: '—',
      descricao: `~${faltam} lançamento(s) a menos que o esperado`,
      valorLabel: '—',
      nature: '—',
      kinds: ['faltante'],
      detalhe: `Extraídos ${quality.rowCount}; esperado ~${quality.minRowsExpected} para o período`,
    });
  }

  return issues;
}

export function classifyExtratoReviewRow(
  row: GenericOcrRow,
  index: number,
): ExtratoReviewIssueRow | null {
  const kinds: ExtratoReviewIssueKind[] = [];
  const detalhes: string[] = [];

  const descricao = resolveExtratoDescricaoText(row).trim();
  const linhaOcr = String(row._linhaOcr ?? '').trim();
  const { value, nature } = resolveExtratoValorNatureza(row);
  const explicit = extratoNaturezaExplicitaNoRow(row);
  const colRaw = naturezaColunasRaw(row);

  if (value <= 0.0001) {
    kinds.push('sem_valor');
    detalhes.push('Valor zero ou não reconhecido');
  }

  if (
    !descricao ||
    descricao === '—' ||
    descricao === '---' ||
    !extratoHistoricoEhPlausivel(descricao)
  ) {
    kinds.push('sem_historico');
    detalhes.push('Histórico vazio ou inválido');
  }

  if (explicit && explicit.nature !== nature && value > 0.0001) {
    kinds.push('invertido');
    detalhes.push(`Coluna/sinal indica ${explicit.nature}, classificado como ${nature}`);
  } else if (colRaw && colRaw !== nature && value > 0.0001) {
    kinds.push('invertido');
    detalhes.push(`D/C na coluna (${colRaw}) ≠ classificação (${nature})`);
  }

  if (kinds.length === 0) return null;

  const signed = nature === 'D' ? -value : value;
  const valorLabel =
    value > 0.0001
      ? signed.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : String(row.valorMisto ?? row.valorDebito ?? row.valorCredito ?? '—').trim() || '—';

  return {
    key: `row-${index}`,
    index: index + 1,
    pagina: parsePagina(row, 1),
    row,
    data: row.data?.trim() || '—',
    descricao: descricao || '—',
    valorLabel,
    nature: value > 0.0001 ? nature : '—',
    kinds,
    detalhe: detalhes.join(' · '),
    linhaOcr: linhaOcr || undefined,
  };
}

function normalizarRowRevisaoExtrato(
  row: GenericOcrRow,
  rawRows: OcrExtratoRow[],
): GenericOcrRow {
  const reparados = extratoRepararRowsHistoricoSomenteDocumentoItau(
    [row as OcrExtratoRow],
    rawRows,
  );
  const base = reparados[0] ?? (row as OcrExtratoRow);
  return extratoCorrigirRowNaturezaValorDesalinhado(
    repararHistoricoItauExtratoRow(base),
  );
}

export function buildExtratoReviewIssueRows(params: {
  rows: GenericOcrRow[];
  skippedPages?: number[];
  quality?: ExtratoExtractQuality;
  ocrTextBlob?: string;
  conciliacaoRawRows?: GenericOcrRow[];
}): ExtratoReviewIssueRow[] {
  const out: ExtratoReviewIssueRow[] = [];

  for (const p of filterSkippedPagesForExtratoReview(params.skippedPages, params.rows)) {
    out.push({
      key: `skip-${p}`,
      index: 0,
      pagina: p,
      data: '—',
      descricao: `Página ${p} sem OCR`,
      valorLabel: '—',
      nature: '—',
      kinds: ['pagina_sem_ocr', 'faltante'],
      detalhe:
        'Texto não lido — use modo Automático (Full HD) ou reduza a escala; 4K costuma piorar o DocTR neste extrato',
    });
  }

  if (params.quality) {
    out.push(...detectFaltantesPorConciliacao(params.quality));
  }

  const ocrText = String(params.ocrTextBlob ?? '').trim();
  const rawContext = buildRawOcrRows(ocrText, params.conciliacaoRawRows);
  const rawForRepair =
    rawContext.length > 0 ? rawContext : (params.rows as OcrExtratoRow[]);

  if (ocrText) {
    out.push(
      ...detectFaltantesDoOcrBruto(params.rows, ocrText, params.conciliacaoRawRows),
    );
  }

  params.rows.forEach((row, index) => {
    const normalized = normalizarRowRevisaoExtrato(row, rawForRepair);
    const issue = classifyExtratoReviewRow(normalized, index);
    if (issue) out.push({ ...issue, row: normalized });
  });

  const temFaltante = out.some((r) => r.kinds.includes('faltante'));
  const conciliacaoPendente = params.quality?.conciliacaoOk === false;
  if (
    conciliacaoPendente &&
    !temFaltante &&
    !out.some((r) => r.kinds.includes('conciliacao'))
  ) {
    out.unshift({
      key: 'conciliacao',
      index: 0,
      pagina: 0,
      data: '—',
      descricao: 'Conciliação não fecha com saldo final',
      valorLabel: '—',
      nature: '—',
      kinds: ['conciliacao'],
      detalhe: 'Revise lançamentos invertidos ou faltantes antes de importar',
    });
  }

  return out.sort((a, b) => {
    const rank = (r: ExtratoReviewIssueRow) =>
      r.kinds.includes('faltante') ? 0 : r.kinds.includes('conciliacao') ? 1 : 2;
    const dr = rank(a) - rank(b);
    if (dr !== 0) return dr;
    return a.pagina - b.pagina || a.index - b.index;
  });
}

export function formatExtratoReviewIssueKind(kind: ExtratoReviewIssueKind): string {
  switch (kind) {
    case 'invertido':
      return 'Invertido';
    case 'sem_historico':
      return 'Sem histórico';
    case 'sem_valor':
      return 'Sem valor';
    case 'pagina_sem_ocr':
      return 'Sem OCR';
    case 'conciliacao':
      return 'Conciliação';
    case 'faltante':
      return 'Faltante';
    default:
      return kind;
  }
}
