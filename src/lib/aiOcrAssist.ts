/**
 * OCR — apenas Tesseract (sem refino Llama/Ollama/FlowMind).
 */
import { notifyOcrIssue } from './aiProactiveNotify';

export type AiOcrDocumentType =
  | 'extrato'
  | 'parcelamento'
  | 'plano_contas'
  | 'balancete'
  | 'folha'
  | 'generic';

export type OcrPosicionadoLike = {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

/** Texto OCR puro — retorna o Tesseract sem refino IA. */
export async function refineOcrPlainText(
  rawText: string,
  documentType: AiOcrDocumentType = 'generic',
  _onProgress?: (message: string) => void,
): Promise<string> {
  const trimmed = rawText.trim();
  if (!trimmed) {
    notifyOcrIssue('empty', documentType);
  }
  return rawText;
}

/** Itens posicionados — sem alteração. */
export async function refineOcrPosicionadoItems<T extends OcrPosicionadoLike>(
  items: T[],
  documentType: AiOcrDocumentType = 'generic',
  _onProgress?: (message: string) => void,
): Promise<T[]> {
  if (items.length === 0) return items;
  const rows = items.length;
  if (rows < 4) {
    notifyOcrIssue('few_items', `${rows} linhas · ${documentType}`);
  }
  return items;
}

/** Clusters de linha — sem alteração. */
export async function refineOcrRowClusters<T extends OcrPosicionadoLike>(
  rowClusters: T[][],
  _documentType: AiOcrDocumentType = 'extrato',
  _onProgress?: (message: string) => void,
): Promise<T[][]> {
  return rowClusters;
}
