import type { GenericColunaDef } from '../parcelamentoColunasExtract';
import type { ColumnMapping, DocumentColumns } from './types';
import type { ExtratoFaixaPaginaSaved, ExtratoOcrLayoutColumnNorm } from '../../contabilfacil/logic/extratoOcrLayoutStorage';
import { columnBandColor } from './columnDefaults';

const EXTRATO_ID_MAP: Record<string, keyof DocumentColumns> = {
  data: 'date',
  date: 'date',
  descricao: 'history',
  historico: 'history',
  history: 'history',
  valor: 'value',
  value: 'value',
};

export function leitorColumnsToGenericColumns(columns: DocumentColumns, imgWidth: number): GenericColunaDef[] {
  const toPx = (startPct: number, widthPct: number) => ({
    start: (startPct / 100) * imgWidth,
    end: ((startPct + widthPct) / 100) * imgWidth,
  });
  const date = toPx(columns.date.startX, columns.date.width);
  const hist = toPx(columns.history.startX, columns.history.width);
  const val = toPx(columns.value.startX, columns.value.width);
  return [
    { id: 'data', start: date.start, end: date.end, color: '#2563eb' },
    { id: 'descricao', start: hist.start, end: hist.end, color: '#9333ea' },
    { id: 'valor', start: val.start, end: val.end, color: '#059669' },
  ];
}

export function leitorColumnsToNorm(columns: DocumentColumns): ExtratoOcrLayoutColumnNorm[] {
  const toNorm = (startPct: number, widthPct: number) => ({
    startNorm: startPct / 100,
    endNorm: (startPct + widthPct) / 100,
  });
  const date = toNorm(columns.date.startX, columns.date.width);
  const hist = toNorm(columns.history.startX, columns.history.width);
  const val = toNorm(columns.value.startX, columns.value.width);
  return [
    { id: 'data', ...date },
    { id: 'descricao', ...hist },
    { id: 'valor', ...val },
  ];
}

export function normColumnsToLeitorColumns(norm: ExtratoOcrLayoutColumnNorm[]): DocumentColumns | null {
  const find = (id: string) => norm.find((c) => c.id === id);
  const data = find('data');
  const hist = find('descricao') ?? find('historico');
  const val = find('valor');
  if (!data || !hist || !val) return null;
  const fromNorm = (c: ExtratoOcrLayoutColumnNorm) => ({
    startX: c.startNorm * 100,
    width: (c.endNorm - c.startNorm) * 100,
  });
  return {
    date: fromNorm(data),
    history: fromNorm(hist),
    value: fromNorm(val),
  };
}

/** Converte ColumnMapping genérico (ids arbitrários) em GenericColunaDef[] em pixels. */
export function mappingToGenericColumns(
  columns: ColumnMapping,
  columnIds: string[],
  imgWidth: number,
  colors?: Record<string, string>,
): GenericColunaDef[] {
  return columnIds
    .filter((id) => columns[id])
    .map((id, i) => {
      const col = columns[id]!;
      return {
        id,
        start: (col.startX / 100) * imgWidth,
        end: ((col.startX + col.width) / 100) * imgWidth,
        color: colors?.[id] ?? columnBandColor(i),
      };
    });
}

/** Normaliza ColumnMapping (0–100%) para columnsNorm (0–1). */
export function mappingToNorm(columns: ColumnMapping, columnIds: string[]): ExtratoOcrLayoutColumnNorm[] {
  return columnIds
    .filter((id) => columns[id])
    .map((id) => {
      const col = columns[id]!;
      return {
        id,
        startNorm: col.startX / 100,
        endNorm: (col.startX + col.width) / 100,
      };
    });
}

/** Restaura ColumnMapping a partir de columnsNorm (ids arbitrários). */
export function normToMapping(norm: ExtratoOcrLayoutColumnNorm[]): ColumnMapping | null {
  if (!norm?.length) return null;
  const mapping: ColumnMapping = {};
  for (const c of norm) {
    if (!c?.id || !Number.isFinite(c.startNorm) || !Number.isFinite(c.endNorm)) continue;
    const width = (c.endNorm - c.startNorm) * 100;
    if (width <= 0) continue;
    mapping[c.id] = {
      startX: c.startNorm * 100,
      width,
    };
  }
  return Object.keys(mapping).length > 0 ? mapping : null;
}

/** Tenta mapear norm de extrato (data/descricao/valor) para DocumentColumns. */
export function normToDocumentColumns(norm: ExtratoOcrLayoutColumnNorm[]): DocumentColumns | null {
  const mapped = normToMapping(norm);
  if (!mapped) return null;
  const out: Partial<DocumentColumns> = {};
  for (const [id, range] of Object.entries(mapped)) {
    const key = EXTRATO_ID_MAP[id];
    if (key) out[key] = range;
  }
  if (!out.date || !out.history || !out.value) return null;
  return out as DocumentColumns;
}

export function buildFaixaPorPagina(
  cropStartPct: number,
  cropEndPct: number,
  cropStartPage: number,
  cropEndPage: number,
  totalPages: number,
): Record<string, ExtratoFaixaPaginaSaved> {
  const out: Record<string, ExtratoFaixaPaginaSaved> = {};
  for (let p = 1; p <= totalPages; p += 1) {
    out[String(p)] = {
      faixaStartNorm: p === cropStartPage ? cropStartPct / 100 : 0,
      faixaEndNorm: p === cropEndPage ? cropEndPct / 100 : 1,
      faixaInicioMarcado: p === cropStartPage,
      faixaFimMarcado: p === cropEndPage,
    };
  }
  return out;
}

/** Converte colunas sugeridas (pixels) para ColumnMapping em percentual. */
export function genericColumnsToPercentMapping(
  columns: GenericColunaDef[],
  imgWidth: number,
): ColumnMapping {
  const mapping: ColumnMapping = {};
  if (imgWidth <= 0) return mapping;
  for (const col of columns) {
    if (col.id.startsWith('ignorar') || col.start === col.end) continue;
    mapping[col.id] = {
      startX: (col.start / imgWidth) * 100,
      width: ((col.end - col.start) / imgWidth) * 100,
    };
  }
  return mapping;
}
