import type { GenericExtractedRow } from '../types';
import type { AIVisionRawRow } from './types';

/** Converte as linhas cruas devolvidas pela IA para o formato usado pelo resto do pipeline
 * (mapGenericRowsToOcrRows, mapGenericRowsToParcelamento, filtros de exclusão etc.) — o mesmo
 * formato que `extractGenericDataFromCanvas` produz no motor local. */
export function aiRowsToGenericExtractedRows(
  rawRows: AIVisionRawRow[],
  columnIds: string[],
  pageNumber: number,
): GenericExtractedRow[] {
  return rawRows.map((raw, idx) => {
    const fields: Record<string, string> = {};
    for (const id of columnIds) {
      const v = raw[id];
      fields[id] = v == null ? '' : String(v).trim();
    }
    return {
      id: `ai-p${pageNumber}-${idx}`,
      fields,
      cropUrls: {},
      y: idx,
      height: 0,
      pageNumber,
    };
  });
}
