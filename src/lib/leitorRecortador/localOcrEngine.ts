import type { PDFTextItem } from './types';

export type OcrPositionedWord = {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

const OCR_SERVER_URL = import.meta.env.VITE_OCR_SERVER_URL || 'http://127.0.0.1:3001';

/** OCR usando servidor conversor (FastAPI) com caixas por palavra — coordenadas = pixels da imagem. */
export async function runOcrPortugueseWords(
  imageFile: File,
  onProgress?: (fraction: number, message: string) => void,
  _options?: { preprocess?: boolean; psm?: string },
): Promise<OcrPositionedWord[]> {
  try {
    onProgress?.(0.1, 'Preparando imagem para OCR…');

    const formData = new FormData();
    formData.append('file', imageFile);
    formData.append('use_ocr', 'yes');
    formData.append('max_rows', '400');

    onProgress?.(0.3, 'Enviando para OCR…');

    const response = await fetch(`${OCR_SERVER_URL}/preview`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Erro OCR servidor: ${response.status}`);
    }

    onProgress?.(0.7, 'Processando resultado…');

    const data = await response.json() as {
      rows?: Array<string[]>;
      error?: string;
    };

    if (data.error) {
      throw new Error(data.error);
    }

    const words: OcrPositionedWord[] = [];
    const rows = data.rows || [];

    let y = 0;
    for (const row of rows) {
      let x = 0;
      for (const cell of row) {
        if (cell && cell.trim()) {
          words.push({
            str: cell.trim(),
            x,
            y,
            w: Math.max(1, cell.length * 8),
            h: 16,
          });
          x += Math.max(100, cell.length * 10);
        }
      }
      y += 20;
    }

    onProgress?.(1.0, 'OCR concluído');
    return words;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onProgress?.(0, `Erro OCR: ${msg}`);
    throw error;
  }
}

/**
 * Roda OCR no canvas de uma página escaneada (sem texto nativo) e devolve os resultados já
 * no formato `PDFTextItem[]` usado pelo resto do motor de recorte.
 */
export async function ocrCanvasToTextItems(
  canvas: HTMLCanvasElement,
  onProgress?: (fraction: number, message: string) => void,
): Promise<PDFTextItem[]> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return [];
  const file = new File([blob], 'pagina.png', { type: 'image/png' });
  const words = await runOcrPortugueseWords(file, onProgress);
  return words.map((w) => ({ text: w.str, x: w.x, y: w.y, width: w.w, height: w.h }));
}
