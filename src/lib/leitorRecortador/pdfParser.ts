import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import type { PDFTextItem, RenderedPDFPage } from './types';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFTextItem };

export interface RenderedPDFPageWithNum extends RenderedPDFPage {
  pageNumber: number;
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve(), { timeout: 32 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

async function renderPdfPage(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  scale = 2.0,
): Promise<RenderedPDFPageWithNum> {
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  await page.render({ canvasContext: ctx, viewport, canvas }).promise;

  const textContent = await page.getTextContent();
  const textItems: PDFTextItem[] = [];

  textContent.items.forEach((item) => {
    if (!('str' in item) || !item.str || !String(item.str).trim()) return;
    const pdfX = item.transform[4]!;
    const pdfY = item.transform[5]!;
    const [canvasX, canvasY] = viewport.convertToViewportPoint(pdfX, pdfY);

    // Calcula a largura real no canvas convertendo o ponto final pelo viewport,
    // NUNCA usando item.width * scale diretamente (ignora rotação/shear da matriz).
    const pdfXEnd = pdfX + item.width;
    const [canvasXEnd] = viewport.convertToViewportPoint(pdfXEnd, pdfY);
    const canvasWidth = Math.abs(canvasXEnd - canvasX);

    const scaledHeight = (item.height || 12) * scale;
    textItems.push({
      text: String(item.str),
      x: Math.min(canvasX, canvasXEnd),
      y: canvasY - scaledHeight,
      width: canvasWidth,
      height: scaledHeight,
    });
  });

  return {
    canvas,
    textItems,
    width: viewport.width,
    height: viewport.height,
    pageNumber,
  };
}

export { pdfTextItemsToLines } from './pdfLines';

export async function openPdfDocument(file: File): Promise<pdfjsLib.PDFDocumentProxy> {
  const arrayBuffer = await file.arrayBuffer();
  return pdfjsLib.getDocument({ data: arrayBuffer }).promise;
}

export async function parseAndRenderPDFPage(
  file: File,
  pageNumber: number,
  pdfDoc?: pdfjsLib.PDFDocumentProxy,
): Promise<RenderedPDFPageWithNum> {
  const doc = pdfDoc ?? (await openPdfDocument(file));
  if (pageNumber < 1 || pageNumber > doc.numPages) {
    throw new Error(`Página ${pageNumber} inválida. O documento tem ${doc.numPages} páginas.`);
  }
  return renderPdfPage(doc, pageNumber);
}

/** Primeira página imediata; demais em segundo plano com pausas para não travar a UI. */
export async function loadPdfPagesProgressive(
  file: File,
  handlers: {
    onReady: (firstPage: RenderedPDFPageWithNum, totalPages: number) => void;
    onProgress?: (pages: RenderedPDFPageWithNum[], loaded: number, totalPages: number) => void;
  },
): Promise<RenderedPDFPageWithNum[]> {
  const pdfDoc = await openPdfDocument(file);
  const totalPages = pdfDoc.numPages;
  const pages: RenderedPDFPageWithNum[] = [];
  const first = await renderPdfPage(pdfDoc, 1);
  pages.push(first);
  handlers.onReady(first, totalPages);
  for (let p = 2; p <= totalPages; p += 1) {
    await yieldToMain();
    const rendered = await renderPdfPage(pdfDoc, p);
    pages.push(rendered);
    if (p % 2 === 0 || p === totalPages) {
      handlers.onProgress?.([...pages], p, totalPages);
    }
  }
  return pages;
}

export async function parseAndRenderAllPDFPages(
  file: File,
  options?: {
    onFirstPage?: (page: RenderedPDFPageWithNum, totalPages: number) => void;
    onPage?: (page: RenderedPDFPageWithNum, index: number, totalPages: number) => void;
    yieldEvery?: number;
  },
): Promise<RenderedPDFPageWithNum[]> {
  const pdfDoc = await openPdfDocument(file);
  const totalPages = pdfDoc.numPages;
  const pages: RenderedPDFPageWithNum[] = [];
  const yieldEvery = options?.yieldEvery ?? 1;

  for (let p = 1; p <= totalPages; p += 1) {
    if (p > 1 && (p - 1) % yieldEvery === 0) {
      await yieldToMain();
    }
    const rendered = await renderPdfPage(pdfDoc, p);
    pages.push(rendered);
    if (p === 1) {
      options?.onFirstPage?.(rendered, totalPages);
    }
    options?.onPage?.(rendered, p - 1, totalPages);
  }
  return pages;
}

export async function parseAndRenderImage(file: File): Promise<RenderedPDFPageWithNum> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not render image.');
    ctx.drawImage(img, 0, 0);
    return {
      canvas,
      textItems: [],
      width: img.width,
      height: img.height,
      pageNumber: 1,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
