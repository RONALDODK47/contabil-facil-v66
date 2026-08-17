/**
 * Ponte legada — extrato usa somente OCR scanner (DocumentColunasModal / ocrPdfFileToExtratoRows).
 */
import type { GenericColunaDef, GenericOcrRow } from '../../lib/parcelamentoColunasExtract';
import { extractStatementYear } from '../../extratoVision/utils/parser';
import type { ExtractionConfig, Transaction, ColumnDef } from '../../extratoVision/types';
import { bloquearExtratoParser } from '../../lib/extratoScannerOnlyPolicy';

/** Escala da prévia OCR (referência de layout). */
const VISION_PREVIEW_SCALE_REF = 4;

function formatBrMoney(n: number): string {
  return Math.abs(n).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function isoToBr(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function transactionsToGenericOcrRows(transactions: Transaction[]): GenericOcrRow[] {
  return transactions.map((t) => {
    const brDate = t.data?.includes('-') ? isoToBr(t.data) : t.data;
    const row: GenericOcrRow = {
      data: brDate || t.data,
      descricao: (t.historico || '').trim(),
    };
    const v = Math.abs(Number(t.valor) || 0);
    if (v > 0.0001) {
      if (t.cd === 'C') row.valorCredito = formatBrMoney(v);
      else row.valorDebito = formatBrMoney(v);
    }
    if (t.documento) row.historicoOperacao = t.documento;
    return row;
  });
}

function mapGenericColumnIdToVision(id: string): string {
  if (id === 'data') return 'date';
  if (id === 'descricao' || id === 'historicoOperacao') return 'description';
  if (id === 'valorCredito') return 'credit';
  if (id === 'valorDebito') return 'debit';
  if (id === 'valorMisto' || id === 'natureza') return 'indicator';
  if (id.startsWith('ignorar')) {
    const n = id.replace(/\D/g, '') || '1';
    return `ignore${n}`;
  }
  return id;
}

/** Converte mapeamento do modal de colunas para o formato legado Extrato Vision. */
export function visionConfigFromColunasModal(params: {
  columns: GenericColunaDef[];
  faixaStart: number;
  faixaEnd: number;
  faixaInicioMarcado: boolean;
  faixaFimMarcado: boolean;
  semDelimitacaoVertical: boolean;
  imgHeight: number;
  pdfRenderScale: number;
  headerKeywords?: string[];
  startPage?: number;
  endPage?: number;
}): ExtractionConfig | undefined {
  const hasDate = params.columns.some((c) => c.id === 'data' && c.start !== c.end);
  const hasDesc = params.columns.some(
    (c) => (c.id === 'descricao' || c.id === 'historicoOperacao') && c.start !== c.end,
  );
  const hasCred = params.columns.some((c) => c.id === 'valorCredito' && c.start !== c.end);
  const hasDeb = params.columns.some((c) => c.id === 'valorDebito' && c.start !== c.end);
  const hasMisto = params.columns.some(
    (c) => (c.id === 'valorMisto' || c.id === 'natureza') && c.start !== c.end,
  );
  if (!hasDate || (!hasDesc && !hasCred && !hasDeb && !hasMisto)) return undefined;

  const scaleRef = params.pdfRenderScale > 0 ? params.pdfRenderScale : VISION_PREVIEW_SCALE_REF;
  const factor = scaleRef / VISION_PREVIEW_SCALE_REF;

  const columns: ColumnDef[] = params.columns
    .filter((c) => c.start !== c.end)
    .map((c) => ({
      id: mapGenericColumnIdToVision(c.id),
      start: c.start / factor,
      end: c.end / factor,
      color: '#3b82f6',
    }));

  return {
    columns,
    faixaStart: params.faixaStart / factor,
    faixaEnd: params.faixaEnd / factor,
    faixaInicioMarcado: params.faixaInicioMarcado,
    faixaFimMarcado: params.faixaFimMarcado,
    semDelimitacaoVertical: params.semDelimitacaoVertical,
    imgHeight: params.imgHeight / factor,
    headerKeywords: params.headerKeywords,
    startPage: params.startPage,
    endPage: params.endPage,
  } as unknown as ExtractionConfig;
}

async function inferStatementYearFromFileName(file: File): Promise<string> {
  return extractStatementYear(file.name) || String(new Date().getFullYear());
}

/** @deprecated Removido — use OCR scanner (DocumentColunasModal / ocrPdfFileToExtratoRows). */
export async function extractExtratoPdfComMotorVision(
  _file: File,
  _onProgress?: (msg: string) => void,
  _config?: ExtractionConfig,
): Promise<GenericOcrRow[]> {
  bloquearExtratoParser('extractExtratoPdfComMotorVision');
}

export function genericRowsFromVisionFile(
  file: File,
  onProgress?: (msg: string) => void,
): Promise<GenericOcrRow[]> {
  return extractExtratoPdfComMotorVision(file, onProgress);
}

export { inferStatementYearFromFileName as inferStatementYearFromPdf };
