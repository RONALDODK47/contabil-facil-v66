import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export async function extractTextFromPDF(pdfData: ArrayBuffer): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str || '')
      .join(' ');
    fullText += pageText + '\n';
  }

  return fullText;
}

export async function extractTextFromPDFFile(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  return extractTextFromPDF(arrayBuffer);
}

export interface PdfWord {
  str: string;
  x0: number;
  y0: number;
}

/**
 * Extrai as palavras de cada página com a posição X/Y original do PDF.
 * Necessário para extratos em que débito/crédito não têm sinal no texto —
 * a única forma de saber a natureza do lançamento é pela coluna (posição X).
 */
export interface PdfWordsResult {
  pages: PdfWord[][];
  /** Páginas sem camada de texto (imagem escaneada) — 1-based. */
  scannedPages: number[];
  numPages: number;
}

export async function extractWordsFromPDF(pdfData: ArrayBuffer): Promise<PdfWord[][]> {
  return (await extractWordsFromPDFWithDiagnostics(pdfData)).pages;
}

/**
 * Igual a extractWordsFromPDF, mas também informa quais páginas não têm
 * camada de texto (imagem escaneada). NUNCA lança por causa disso: o
 * conversor sempre entrega os lançamentos das páginas legíveis e apenas
 * anexa um aviso — página ilegível não pode interromper a extração.
 */
export async function extractWordsFromPDFWithDiagnostics(
  pdfData: ArrayBuffer
): Promise<PdfWordsResult> {
  const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
  const pages: PdfWord[][] = [];
  const scannedPages: number[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const words: PdfWord[] = textContent.items.map((item: any) => ({
      str: String(item.str || ''),
      x0: item.transform?.[4] ?? 0,
      y0: item.transform?.[5] ?? 0,
    })).filter((w) => w.str.trim().length > 0);
    pages.push(words);

    // Página sem nenhuma palavra mas com imagem desenhada = página
    // escaneada. Vira aviso, não erro.
    if (words.length === 0 && (await pageHasImage(page))) scannedPages.push(i);
  }

  return { pages, scannedPages, numPages: pdf.numPages };
}

const PDF_IMAGE_OPS = new Set<number>(
  [
    pdfjsLib.OPS.paintImageXObject,
    pdfjsLib.OPS.paintInlineImageXObject,
    pdfjsLib.OPS.paintImageMaskXObject,
    (pdfjsLib.OPS as any).paintJpegXObject,
  ].filter((op) => typeof op === 'number')
);

async function pageHasImage(page: any): Promise<boolean> {
  try {
    const opList = await page.getOperatorList();
    return opList.fnArray.some((fn: number) => PDF_IMAGE_OPS.has(fn));
  } catch {
    return false;
  }
}

export async function extractWordsFromPDFFileWithDiagnostics(
  file: File
): Promise<PdfWordsResult> {
  return extractWordsFromPDFWithDiagnostics(await file.arrayBuffer());
}

export async function extractWordsFromPDFFile(file: File): Promise<PdfWord[][]> {
  const arrayBuffer = await file.arrayBuffer();
  return extractWordsFromPDF(arrayBuffer);
}
