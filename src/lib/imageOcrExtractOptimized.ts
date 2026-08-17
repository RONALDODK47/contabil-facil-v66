/**
 * Versão otimizada de imageOcrExtract com suporte a tabelas.
 * Re-exporta todas as funções originais + novas otimizações.
 */

export * from './imageOcrExtract';

import type { AiOcrDocumentType } from './aiOcrAssist';
import { OCR_LOCAL_REMOVED_MESSAGE } from './imageOcrExtract';

/**
 * OCR otimizado para tabelas — refinamento via IA após leitura local (removida).
 */
export async function runOcrPortugueseOptimized(
  _imageFile: File,
  onProgress?: (fraction: number, message: string) => void,
  _options?: { documentType?: AiOcrDocumentType },
): Promise<string> {
  onProgress?.(0, OCR_LOCAL_REMOVED_MESSAGE);
  throw new Error(OCR_LOCAL_REMOVED_MESSAGE);
}
