import type { OcrColunaCampoDef } from '../../contabilfacil/logic/ocrColunasConfig';
import type { ColumnMapping, DocumentColumns, LeitorColumnDef } from './types';

const BAND_COLORS = [
  '#2563eb',
  '#9333ea',
  '#059669',
  '#d97706',
  '#dc2626',
  '#0891b2',
  '#4f46e5',
  '#be185d',
];

export function getMappableCampoDefs(
  campoDefs: OcrColunaCampoDef[],
  dataColIds: string[],
): OcrColunaCampoDef[] {
  const idSet = new Set(dataColIds);
  return campoDefs.filter((c) => idSet.has(c.id) && !c.isIgnore);
}

/** Distribui colunas igualmente na largura (0–100%). */
export function buildDefaultColumnMapping(columnIds: string[]): ColumnMapping {
  const n = Math.max(1, columnIds.length);
  const width = Math.max(4, Math.floor((92 / n) * 10) / 10);
  const gap = Math.max(0.5, (100 - width * n) / (n + 1));
  const mapping: ColumnMapping = {};
  columnIds.forEach((id, i) => {
    mapping[id] = {
      startX: Number((gap + i * (width + gap)).toFixed(2)),
      width: Number(width.toFixed(2)),
    };
  });
  return mapping;
}

export function extratoLegacyColumnMapping(): ColumnMapping {
  return {
    date: { startX: 5, width: 15 },
    history: { startX: 22, width: 48 },
    value: { startX: 72, width: 23 },
  };
}

export function documentColumnsToMapping(cols: DocumentColumns): ColumnMapping {
  return {
    date: { ...cols.date },
    history: { ...cols.history },
    value: { ...cols.value },
  };
}

export function mappingToDocumentColumns(mapping: ColumnMapping): DocumentColumns | null {
  if (!mapping.date || !mapping.history || !mapping.value) return null;
  return {
    date: mapping.date,
    history: mapping.history,
    value: mapping.value,
  };
}

export function columnBandColor(index: number, override?: string): string {
  if (override) return override;
  return BAND_COLORS[index % BAND_COLORS.length]!;
}

export function toLeitorColumnDefs(
  campoDefs: OcrColunaCampoDef[],
  dataColIds: string[],
): LeitorColumnDef[] {
  return getMappableCampoDefs(campoDefs, dataColIds).map((c, i) => ({
    id: c.id,
    name: c.name,
    color: columnBandColor(i),
  }));
}
