/**
 * Importação 1:1 do leitor/recortador → conciliação.
 * Usa exatamente isNegative/parsedValue do placar (Entradas/Saídas), sem reinterpretação OCR.
 */

import type { OcrConfirmMeta } from '../../lib/leitorRecortador/types';
import type { GenericOcrRow } from '../../lib/parcelamentoColunasExtract';
import type { ExtractedRow } from '../../lib/leitorRecortador/types';
import { analyzeValueString, propagateExtractedRowDates } from '../../lib/leitorRecortador/cropper';
import { parseExtratoDataOcrText } from '../../lib/ocrExtratoPositional';
import { avaliarExtratoConciliacaoItau, type ExtratoConciliacaoResumo } from '../../lib/itauExtratoProfile';

export const EXTRATO_RECORTE_FIEL_FLAG = '_recorteFiel';

export type ExtratoRecorteImportItem = {
  id: string;
  date: string;
  description: string;
  value: number;
  nature: 'D' | 'C';
  accountCode: string;
  accountDebit: string;
  accountCredit: string;
  operationName: string;
  status: 'CONCILIADO';
};

function formatValorBr(abs: number): string {
  return abs.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function resolveParsed(
  row: Pick<ExtractedRow, 'valueText' | 'isNegative' | 'parsedValue'>,
): { abs: number; nature: 'D' | 'C' } | null {
  let abs =
    row.parsedValue != null && Number.isFinite(row.parsedValue)
      ? Math.abs(row.parsedValue)
      : 0;
  let nature: 'D' | 'C' = row.isNegative ? 'D' : 'C';

  if (abs <= 0.0001 && row.valueText?.trim()) {
    const analyzed = analyzeValueString(row.valueText);
    if (analyzed.parsedValue != null && Number.isFinite(analyzed.parsedValue)) {
      abs = Math.abs(analyzed.parsedValue);
      nature = analyzed.isNegative ? 'D' : 'C';
    }
  }

  if (abs <= 0.0001) return null;
  return { abs: Math.round(abs * 100) / 100, nature };
}

/** Linhas visíveis do placar → GenericOcrRow com D/C fiéis ao recorte. */
export function mapExtractedRowsToRecorteFielOcr(
  rows: ExtractedRow[],
  statementYear?: string,
): GenericOcrRow[] {
  const withDates = propagateExtractedRowDates(rows, statementYear);
  const out: GenericOcrRow[] = [];
  for (let idx = 0; idx < withDates.length; idx++) {
    const r = withDates[idx]!;
    const original = rows[idx]!;
    const inherited =
      !!r.dateText && !parseExtratoDataOcrText(original.dateText, statementYear);
    const resolved = resolveParsed(r);
    if (!resolved) continue;
    const valorBr = formatValorBr(resolved.abs);
    const row: GenericOcrRow = {
      data: r.dateText || '',
      descricao: r.historyText || '',
      valorMisto: r.valueText || valorBr,
      natureza: resolved.nature,
      _linhaOcr: [r.dateText, r.historyText, r.valueText].filter(Boolean).join(' | '),
      _extratoOrdem: String(idx + 1),
      [EXTRATO_RECORTE_FIEL_FLAG]: '1',
      ...(inherited ? { _dataHerdada: '1' } : {}),
    };
    if (resolved.nature === 'D') {
      row.valorDebito = valorBr;
      row.valorCredito = '';
    } else {
      row.valorCredito = valorBr;
      row.valorDebito = '';
    }
    out.push(row);
  }
  return out;
}

function isRecorteFielRow(row: GenericOcrRow): boolean {
  return String(row[EXTRATO_RECORTE_FIEL_FLAG] ?? '') === '1';
}

export function rowsSaoRecorteFiel(rows: GenericOcrRow[]): boolean {
  return rows.length > 0 && rows.every(isRecorteFielRow);
}

function resolveRecorteFielDateIso(raw: unknown, lastDate: string): string {
  const text = String(raw ?? '').trim();
  if (!text) return lastDate;
  const parsed = parseExtratoDataOcrText(text);
  if (parsed) return parsed;

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const br = text.match(/^(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2,4})$/);
  if (br) {
    const dd = br[1].padStart(2, '0');
    const mm = br[2].padStart(2, '0');
    const yyyy = br[3].length === 2 ? `20${br[3]}` : br[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  return lastDate;
}

/**
 * Converte linhas do recorte em itens de importação 1:1 (mesma natureza/valor do placar).
 * Não aplica filtros OCR, dedupe, Itaú, etc.
 */
export function mapRecorteFielRowsToImportItems(
  rows: GenericOcrRow[],
  meta?: OcrConfirmMeta,
): {
  items: ExtratoRecorteImportItem[];
  logs: string[];
  skipped: [];
  saldoAnteriorDetectado?: number;
  conciliacao: ExtratoConciliacaoResumo;
} {
  const items: ExtratoRecorteImportItem[] = [];
  const logs: string[] = [];
  let lastDate = '';

  for (const row of rows) {
    const natureRaw = String(row.natureza ?? '').trim().toUpperCase();
    const nature: 'D' | 'C' = natureRaw === 'D' ? 'D' : 'C';
    const rawValor =
      nature === 'D'
        ? String(row.valorDebito ?? row.valorMisto ?? '').trim()
        : String(row.valorCredito ?? row.valorMisto ?? '').trim();
    const analyzed = analyzeValueString(rawValor);
    const value =
      analyzed.parsedValue != null && Number.isFinite(analyzed.parsedValue)
        ? Math.round(Math.abs(analyzed.parsedValue) * 100) / 100
        : 0;
    if (value <= 0.0001) continue;

    const dateIso = resolveRecorteFielDateIso(row.data, lastDate);
    if (dateIso) lastDate = dateIso;

    const description = String(row.descricao ?? '').trim() || 'LANÇAMENTO';
    items.push({
      id: crypto.randomUUID(),
      date: dateIso || '',
      description,
      value,
      nature,
      accountCode: '',
      accountDebit: '',
      accountCredit: '',
      operationName: description,
      status: 'CONCILIADO',
    });
  }

  const saldoAnterior =
    meta?.saldoAnterior != null && Number.isFinite(meta.saldoAnterior)
      ? Number(meta.saldoAnterior)
      : 0;

  const conciliacao = avaliarExtratoConciliacaoItau({
    items,
    saldoAnterior,
    skipped: [],
    perfilItau: false,
  });

  logs.push(
    `Recorte fiel: ${items.length} lançamento(s) importados 1:1 (Entradas/Saídas iguais ao placar).`,
  );

  return {
    items,
    logs,
    skipped: [],
    ...(saldoAnterior > 0.0001 ? { saldoAnteriorDetectado: saldoAnterior } : {}),
    conciliacao,
  };
}
