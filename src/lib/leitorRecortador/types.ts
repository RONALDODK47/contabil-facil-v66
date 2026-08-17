/**
 * Tipos genéricos do leitor-recortador (N colunas) — usado por plano, balancete, etc.
 * O extrato continua com DocumentColumns (date/history/value) no ExtratoLeitorRecortadorModal.
 */

export type ColumnRange = {
  startX: number;
  width: number;
};

export type DocumentColumns = {
  date: ColumnRange;
  history: ColumnRange;
  value: ColumnRange;
};

export type ColumnMapping = Record<string, ColumnRange>;

export type LeitorColumnDef = {
  id: string;
  name: string;
  color?: string;
};

export type ExtractedRow = {
  id: string;
  dateText: string;
  historyText: string;
  valueText: string;
  dateCropUrl: string;
  historyCropUrl: string;
  valueCropUrl: string;
  isNegative: boolean;
  parsedValue: number | null;
  y: number;
  height: number;
  pageNumber?: number;
};

export type GenericExtractedRow = {
  id: string;
  fields: Record<string, string>;
  cropUrls: Record<string, string>;
  y: number;
  height: number;
  pageNumber?: number;
  cropBounds?: Record<string, { x: number; y: number; w: number; h: number }>;
};

export type PDFTextItem = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DocMetadata = {
  name: string;
  type: 'pdf' | 'image' | 'sample';
  pageNumber: number;
  totalPages: number;
  width: number;
  height: number;
};

export type RenderedPDFPage = {
  canvas: HTMLCanvasElement;
  textItems: PDFTextItem[];
  width: number;
  height: number;
  pageNumber: number;
};

export type OcrConfirmMeta = {
  conciliacaoRawRows?: unknown[];
  saldoAnterior?: number | null;
  saldoFinalEsperado?: number | null;
  extractDiagnostic?: unknown;
  /** Texto OCR agregado — usado na revisão para achar lançamentos faltantes. */
  ocrTextBlob?: string;
};
