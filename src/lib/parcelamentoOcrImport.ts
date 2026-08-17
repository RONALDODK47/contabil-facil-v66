import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { PDF_RENDER_SCALE_DEFAULT, runOcrPortuguese } from './imageOcrExtract';
import {
  parseParcelamentoTableRows,
  readCadastroFromText,
  type ParcelamentoPlanilhaImport,
} from './parcelamentoPlanilha';
import { fileIsLikelyPdf } from './parcelamentoColunasExtract';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export type ParcelamentoOcrProgress = {
  message: string;
  fraction?: number;
};

function ocrTextToRows(text: string): string[][] {
  const rows: string[][] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const cells = line
      .split(/\t+|\s{2,}/)
      .map((c) => c.trim())
      .filter(Boolean);
    rows.push(cells.length > 1 ? cells : [line]);
  }
  return rows;
}

async function pdfPageToPngFile(page: pdfjsLib.PDFPageProxy, pageNum: number): Promise<File> {
  const viewport = page.getViewport({ scale: PDF_RENDER_SCALE_DEFAULT });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas não disponível para OCR.');
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao renderizar página PDF.'))), 'image/png');
  });
  return new File([blob], `parcelamento-p${pageNum}.png`, { type: 'image/png' });
}

async function pdfFileToRowsViaOcr(
  file: File,
  onProgress?: (p: ParcelamentoOcrProgress) => void
): Promise<string[][]> {
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  const maxPages = Math.min(doc.numPages, 8);
  const allRows: string[][] = [];

  for (let pn = 1; pn <= maxPages; pn++) {
    onProgress?.({
      message: `OCR na página ${pn} de ${maxPages}…`,
      fraction: 0.15 + (pn / maxPages) * 0.75,
    });
    const page = await doc.getPage(pn);
    const png = await pdfPageToPngFile(page, pn);
    const text = await runOcrPortuguese(png, (frac, msg) => {
      onProgress?.({
        message: `Página ${pn}: ${msg}`,
        fraction: 0.15 + ((pn - 1 + frac) / maxPages) * 0.75,
      });
    });
    allRows.push(...ocrTextToRows(text));
  }

  return allRows;
}

function isImageFile(file: File): boolean {
  return /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name) || /^image\//i.test(file.type);
}

/**
 * Extrai tabela de cronograma de PDF (texto ou OCR) ou imagem (OCR).
 */
export async function importParcelamentoFromOcrFile(
  file: File,
  onProgress?: (p: ParcelamentoOcrProgress) => void
): Promise<ParcelamentoPlanilhaImport> {
  onProgress?.({ message: 'Lendo arquivo…', fraction: 0.05 });

  let rows: string[][] = [];
  let ocrText = '';

  if (fileIsLikelyPdf(file)) {
    rows = await pdfFileToRowsViaOcr(file, onProgress);
  } else if (isImageFile(file)) {
    onProgress?.({ message: 'Reconhecendo texto na imagem (OCR)…', fraction: 0.15 });
    ocrText = await runOcrPortuguese(file, (frac, msg) => {
      onProgress?.({ message: msg, fraction: 0.15 + frac * 0.75 });
    });
    rows = ocrTextToRows(ocrText);
  } else {
    throw new Error('Use um arquivo PDF ou imagem (PNG, JPG, WEBP).');
  }

  onProgress?.({ message: 'Interpretando parcelas, juros, multas e contas…', fraction: 0.92 });

  const parsed = parseParcelamentoTableRows(rows);
  const fromText = ocrText ? readCadastroFromText(ocrText) : readCadastroFromText(rows.map((r) => r.join(' ')).join('\n'));

  return {
    nomeParcelamento: parsed.nomeParcelamento || fromText.nomeParcelamento,
    clienteNome: parsed.clienteNome || fromText.clienteNome,
    numeroParcelamento: parsed.numeroParcelamento || fromText.numeroParcelamento,
    linhas: parsed.linhas,
  };
}
