/**
 * Pipeline de escalação quando o quality gate detecta extração incompleta.
 */
import type { GenericOcrRow, ExtractGenericOptions } from '../../lib/parcelamentoColunasExtract';
import type { OcrConfirmMeta } from '../../lib/leitorRecortador/types';
import { extractExtratoWithAi, marcarRowsExtracaoAi, fileToBase64Payload, type AiExtractImage } from '../../lib/aiExtratoExtractClient';
import {
  extratoLinhasSaldoInformativoDoTextoOcr,
  prepararExtratoOcrRowsParaRevisao,
  resolverSaldoAnteriorParaMetaExtrato,
} from '../../lib/ocrExtratoPositional';
import { extrairSaldoFinalDisponivelDasRows } from '../../lib/itauExtratoProfile';
import {
  evaluateExtratoExtractQuality,
  enrichExtratoConfirmMeta,
  logExtratoQualityGateToConsole,
  type ExtratoEscalationKind,
} from './extratoQualityGate';

export type ExtratoReviewMeta = OcrConfirmMeta;

export type ExtratoEngineMode = 'ai' | 'hybrid';

export type ExtratoEscalationContext = {
  file: File;
  fileIsPdf: boolean;
  pdfDoc?: import('pdfjs-dist').PDFDocumentProxy | null;
  pdfRenderScale: number;
  totalPages: number;
  ocrText?: string;
  engine: ExtratoEngineMode;
  scale?: number;
  statementYear: string;
  ignoreLineWords: string[];
  buildExtratoGenericOptions: (ocrFullText?: string) => ExtractGenericOptions;
  report?: (msg: string) => void;
  getPageImage?: (page: number) => Promise<AiExtractImage | null>;
  aiProviderId?: string;
  aiModel?: string;
  /** false = só enriquece meta e loga quality (modo OCR local). */
  autoEscalate?: boolean;
  /** Indica se há pelo menos uma coluna mapeada manualmente. */
  columnMapped?: boolean;
};

function allowedEscalationsForEngine(engine: ExtratoEngineMode): Set<ExtratoEscalationKind> {
  switch (engine) {
    case 'ai':
      return new Set(['ai_per_page']);
    case 'hybrid':
    default:
      return new Set(['ai_per_page', 'hybrid_refine', 'resolution']);
  }
}

function buildBaseMeta(
  rows: GenericOcrRow[],
  ocrText: string | undefined,
): OcrConfirmMeta {
  const conciliacaoRawRows = extratoLinhasSaldoInformativoDoTextoOcr(ocrText ?? '');
  const saldoAnterior = resolverSaldoAnteriorParaMetaExtrato({
    rows,
    conciliacaoRawRows,
    ocrText: ocrText ?? '',
  });
  const saldoFinalEsperado =
    extrairSaldoFinalDisponivelDasRows(rows) ??
    extrairSaldoFinalDisponivelDasRows(conciliacaoRawRows);
  return {
    conciliacaoRawRows,
    saldoAnterior,
    saldoFinalEsperado,
  };
}

export async function buildExtratoReviewPackage(
  initialRows: GenericOcrRow[],
  initialMeta: OcrConfirmMeta | undefined,
  ctx: ExtratoEscalationContext,
): Promise<{ rows: GenericOcrRow[]; meta: ExtratoReviewMeta }> {
  const escalations: ExtratoEscalationKind[] = [];
  let rows = initialRows;
  let meta = enrichExtratoConfirmMeta({
    rows,
    meta: { ...buildBaseMeta(rows, ctx.ocrText), ...initialMeta },
    ocrText: ctx.ocrText,
  });

  const prepOpts = {
    statementYear: ctx.statementYear,
    ignoreLineWords: ctx.ignoreLineWords,
    preserveSegmentRows: true as const,
  };

  const reevaluate = () =>
    evaluateExtratoExtractQuality({
      rows,
      meta,
      ocrText: ctx.ocrText,
      totalPages: ctx.totalPages,
      escalationsApplied: escalations,
    });

  let quality = reevaluate();

  const autoEscalate = ctx.autoEscalate !== false;
  const allowed = allowedEscalationsForEngine(ctx.engine);

  const tryEscalation = async (kind: ExtratoEscalationKind): Promise<boolean> => {
    if (!allowed.has(kind)) return false;
    if (escalations.includes(kind)) return false;
    escalations.push(kind);
    ctx.report?.(`Quality gate: escalando (${kind})…`);

    if (kind === 'ai_per_page' && ctx.getPageImage) {
      try {
        const images: AiExtractImage[] = [];
        const maxPages = Math.min(ctx.totalPages, 12);
        for (let p = 1; p <= maxPages; p++) {
          const img = await ctx.getPageImage(p);
          if (img) images.push(img);
        }
        if (images.length === 0) return false;
        const filePayload = await fileToBase64Payload(ctx.file);
        const ai = await extractExtratoWithAi({
          ocrText: ctx.ocrText,
          images: filePayload?.mimeType.includes('pdf') ? undefined : images,
          statementYear: ctx.statementYear,
          fileName: ctx.file.name,
          providerId: ctx.aiProviderId,
          model: ctx.aiModel,
          perPage: true,
          fileBase64: filePayload?.fileBase64,
          mimeType: filePayload?.mimeType,
        });
        if (ai.ok && ai.rows?.length && ai.rows.length >= rows.length) {
          rows = prepararExtratoOcrRowsParaRevisao(marcarRowsExtracaoAi(ai.rows), prepOpts);
          meta = enrichExtratoConfirmMeta({
            rows,
            meta: {
              ...buildBaseMeta(rows, ctx.ocrText),
              ...initialMeta,
              saldoFinalEsperado: ai.saldoFinal ?? meta.saldoFinalEsperado,
            },
            ocrText: ctx.ocrText,
          });
          return true;
        }
      } catch {
        /* próximo */
      }
      return false;
    }

    return false;
  };

  let guard = 0;
  while (autoEscalate && !quality.ok && guard < 3) {
    guard++;
    const next = quality.recommendedEscalation;
    if (next === 'none' || next === 'resolution' || next === 'hybrid_refine') break;
    if (!allowed.has(next)) break;
    const improved = await tryEscalation(next);
    quality = reevaluate();
    if (!improved) break;
  }

  logExtratoQualityGateToConsole(quality, ctx.file.name);

  return {
    rows,
    meta: {
      ...meta,
      extractDiagnostic: {
        engine: ctx.engine,
        scale: ctx.scale,
        escalations,
        quality,
      },
    },
  };
}
