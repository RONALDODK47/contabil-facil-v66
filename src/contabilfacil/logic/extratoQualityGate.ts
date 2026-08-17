/**
 * Quality Gate — avalia se a extração de extrato está completa e conciliada.
 */
import type { GenericOcrRow } from '../../lib/parcelamentoColunasExtract';
import {
  extrairSaldoAnteriorDeTextoOcr,
  saldoAnteriorDocumentadoNoExtrato,
  type OcrExtratoRow,
} from '../../lib/ocrExtratoPositional';
import { resolveExtratoValorNatureza } from './ocrImportMapper';
import type { OcrConfirmMeta } from '../../lib/leitorRecortador/types';

export const EXTRATO_CONCILIACAO_TOLERANCIA = 0.1;

export type ExtratoEscalationKind =
  | 'none'
  | 'resolution'
  | 'ai_per_page'
  | 'hybrid_refine';

export type ExtratoExtractQuality = {
  ok: boolean;
  saldoAnteriorDocumentado: boolean;
  saldoFinalInformado: boolean;
  conciliacaoOk: boolean;
  delta: number | null;
  saldoConciliado: number;
  creditos: number;
  debitos: number;
  saldoAnterior: number;
  saldoFinal: number | null;
  rowCount: number;
  minRowsExpected: number;
  rowCountOk: boolean;
  issues: string[];
  recommendedEscalation: ExtratoEscalationKind;
  escalationsApplied: ExtratoEscalationKind[];
};

export function sumExtratoRowsCreditsDebits(rows: GenericOcrRow[]): {
  creditos: number;
  debitos: number;
} {
  let creditos = 0;
  let debitos = 0;
  for (const row of rows) {
    const { value, nature } = resolveExtratoValorNatureza(row);
    if (value <= 0.0001) continue;
    if (nature === 'D') debitos += value;
    else creditos += value;
  }
  return {
    creditos: Math.round(creditos * 100) / 100,
    debitos: Math.round(debitos * 100) / 100,
  };
}

export function estimateMinExtratoRows(totalPages: number): number {
  return Math.max(5, Math.floor(totalPages * 8));
}

export function evaluateExtratoExtractQuality(params: {
  rows: GenericOcrRow[];
  meta?: (OcrConfirmMeta & { conciliacaoRawRows?: unknown[] });
  ocrText?: string;
  totalPages?: number;
  escalationsApplied?: ExtratoEscalationKind[];
}): ExtratoExtractQuality {
  const rows = params.rows ?? [];
  const pool = [
    ...((params.meta?.conciliacaoRawRows ?? []) as OcrExtratoRow[]),
    ...(rows as OcrExtratoRow[]),
  ];
  const ocrBlob = String(params.ocrText ?? '').trim();
  const saDoc =
    saldoAnteriorDocumentadoNoExtrato(pool, ocrBlob) ||
    (params.meta?.saldoAnterior != null && params.meta.saldoAnterior >= 1000
      ? params.meta.saldoAnterior
      : 0);
  const saldoAnterior = saDoc >= 1000 ? saDoc : 0;
  const saldoFinal =
    params.meta?.saldoFinalEsperado != null && params.meta.saldoFinalEsperado > 0.0001
      ? params.meta.saldoFinalEsperado
      : null;

  const { creditos, debitos } = sumExtratoRowsCreditsDebits(rows);
  const saldoConciliado = Math.round((saldoAnterior + creditos - debitos) * 100) / 100;
  const delta =
    saldoFinal != null ? Math.round(Math.abs(saldoConciliado - saldoFinal) * 100) / 100 : null;
  const conciliacaoOk = delta != null && delta <= EXTRATO_CONCILIACAO_TOLERANCIA;

  const totalPages = Math.max(1, params.totalPages ?? 1);
  const minRowsExpected = estimateMinExtratoRows(totalPages);
  const rowCountOk = rows.length >= minRowsExpected;

  const issues: string[] = [];
  if (saldoAnterior < 1000) {
    issues.push('Saldo anterior não lido no documento (aumente resolução ou use colunas).');
  }
  if (saldoFinal == null) {
    issues.push('Saldo final do período não identificado.');
  } else if (!conciliacaoOk) {
    issues.push(`Conciliação diverge R$ ${(delta ?? 0).toFixed(2)} do saldo final.`);
  }
  if (!rowCountOk) {
    issues.push(
      `Poucos lançamentos (${rows.length} < ~${minRowsExpected} esperados para ${totalPages} pág.).`,
    );
  }

  const applied = params.escalationsApplied ?? [];
  let recommendedEscalation: ExtratoEscalationKind = 'none';
  if (issues.length > 0) {
    if (!applied.includes('resolution') && (saldoAnterior < 1000 || !rowCountOk)) {
      recommendedEscalation = 'resolution';
    } else if (!applied.includes('ai_per_page') && !conciliacaoOk) {
      recommendedEscalation = 'ai_per_page';
    } else if (!applied.includes('hybrid_refine')) {
      recommendedEscalation = 'hybrid_refine';
    }
  }

  const ok =
    saldoAnterior >= 1000 &&
    saldoFinal != null &&
    conciliacaoOk &&
    rowCountOk &&
    rows.length > 0;

  return {
    ok,
    saldoAnteriorDocumentado: saldoAnterior >= 1000,
    saldoFinalInformado: saldoFinal != null,
    conciliacaoOk,
    delta,
    saldoConciliado,
    creditos,
    debitos,
    saldoAnterior,
    saldoFinal,
    rowCount: rows.length,
    minRowsExpected,
    rowCountOk,
    issues,
    recommendedEscalation,
    escalationsApplied: applied,
  };
}

/** Enriquece meta com saldos do OCR antes da revisão. */
export function enrichExtratoConfirmMeta(params: {
  rows: GenericOcrRow[];
  meta?: OcrConfirmMeta;
  ocrText?: string;
}): OcrConfirmMeta {
  const pool = [
    ...((params.meta?.conciliacaoRawRows ?? []) as OcrExtratoRow[]),
    ...(params.rows as OcrExtratoRow[]),
  ];
  const ocrText = String(params.ocrText ?? '').trim();
  const saDoc = saldoAnteriorDocumentadoNoExtrato(pool, ocrText);
  const conciliacaoRawRows =
    params.meta?.conciliacaoRawRows?.length
      ? params.meta.conciliacaoRawRows
      : ocrText
        ? enrichConciliacaoRawRowsFromOcrText(ocrText)
        : undefined;

  return {
    ...params.meta,
    conciliacaoRawRows,
    saldoAnterior: saDoc >= 1000 ? saDoc : params.meta?.saldoAnterior,
  };
}

function enrichConciliacaoRawRowsFromOcrText(ocrText: string): GenericOcrRow[] {
  const sa = extrairSaldoAnteriorDeTextoOcr(ocrText);
  if (sa < 1000) return [];
  return [
    {
      descricao: 'SALDO ANTERIOR',
      valorCredito: sa.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
      _linhaOcr: `SALDOANTERIOR ${sa.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
    },
  ];
}

export function logExtratoQualityGateToConsole(
  quality: ExtratoExtractQuality,
  fileName?: string,
): void {
  if (typeof console === 'undefined') return;
  const label = fileName?.trim() ? `[extrato-quality] ${fileName.trim()}` : '[extrato-quality]';
  const fn = quality.ok ? console.info : console.warn;
  fn.call(console, label, {
    ok: quality.ok,
    linhas: quality.rowCount,
    saldoAnterior: quality.saldoAnterior,
    saldoFinal: quality.saldoFinal,
    saldoConciliado: quality.saldoConciliado,
    delta: quality.delta,
    escalacao: quality.recommendedEscalation,
    aplicadas: quality.escalationsApplied,
    issues: quality.issues,
  });
}
