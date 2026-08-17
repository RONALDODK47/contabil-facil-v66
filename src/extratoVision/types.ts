export interface Transaction {
  id: string;
  data: string;
  historico: string;
  valor: number;
  cd: string;
  isInheritedDate?: boolean;
  documento?: string;
}

export interface ExtractedMetadata {
  initialBalance?: number;
  finalBalance?: number;
}

export interface ParseResult {
  transactions: Transaction[];
  metadata: ExtractedMetadata;
}

export interface PDFScanResult {
  lines: ScannedLine[];
  metadata: ExtractedMetadata;
}

export interface ScannedLine {
  id: string;
  page: number;
  originalY: number; 
  x: number;
  width: number;
  height: number;
  rawText: string;
  type: 'TRANSACTION' | 'TEXT';
  transactionData?: Transaction;
  failureReason?: string;
  solution?: string; 
}

export interface ColumnDef {
  id: string;
  start: number;
  end: number;
  color: string;
}

export interface HorizontalRegionDef {
  id: string;
  name: string;
  start: number;
  end: number;
  color: string;
}

export interface ExtractionConfig {
  columns: ColumnDef[];
  horizontalRegions?: HorizontalRegionDef[];
  columnMapping: {
    date: string; // id of the column
    description: string;
    value?: string;
    indicator?: string;
    credit?: string;
    debit?: string;
  };
  historyLines: number;
  historyMode?: 'fixed' | 'smart';
  dateMode: 'one-per-tx' | 'one-for-many';
  startLine: number; // y-coordinate or row index
  endLine: number; // y-coordinate or row index
  startPage?: number; // Added
  endPage?: number; // Added
  ignoreWords?: string[];
  ignoredColumns?: string[];
}

export interface SavedLayout {
  id: string;
  name: string;
  config: ExtractionConfig;
  createdAt: number;
}

export interface AIVisionSettings {
  provider: 'gemini' | 'openai' | string;
  apiKeys: Record<string, string>;
  modelId: string;
  validated?: boolean;
}

export interface AIVisionModelOption {
  id: string;
  provider: string;
  label: string;
  tier: 'free' | 'paid';
  description: string;
}
