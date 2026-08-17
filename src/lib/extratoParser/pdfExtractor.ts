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
export async function extractWordsFromPDF(pdfData: ArrayBuffer): Promise<PdfWord[][]> {
  const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
  const pages: PdfWord[][] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const words: PdfWord[] = textContent.items.map((item: any) => ({
      str: String(item.str || ''),
      x0: item.transform?.[4] ?? 0,
      y0: item.transform?.[5] ?? 0,
    })).filter((w) => w.str.trim().length > 0);
    pages.push(words);
  }

  return pages;
}

export async function extractWordsFromPDFFile(file: File): Promise<PdfWord[][]> {
  const arrayBuffer = await file.arrayBuffer();
  return extractWordsFromPDF(arrayBuffer);
}
