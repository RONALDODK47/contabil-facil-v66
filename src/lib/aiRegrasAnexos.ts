/**
 * Prepara anexos (imagem / PDF / Excel) para a IA de regras de contas.
 */
import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { previewUrlToBase64, type AiExtractImage } from './aiExtratoExtractClient';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export type PreparedAnexo = {
  name: string;
  images: AiExtractImage[];
  text: string;
};

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error(`Falha ao ler ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function excelToText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const chunks: string[] = [];
  for (const sheetName of wb.SheetNames.slice(0, 4)) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet);
    chunks.push(`### Planilha: ${sheetName}\n${csv.slice(0, 12_000)}`);
  }
  return chunks.join('\n\n').slice(0, 40_000);
}

async function pdfToImagesAndText(
  file: File,
  maxPages = 3,
): Promise<{ images: AiExtractImage[]; text: string }> {
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  const images: AiExtractImage[] = [];
  const textParts: string[] = [];
  const pages = Math.min(doc.numPages, maxPages);

  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((it) => ('str' in it ? String(it.str) : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (pageText) textParts.push(`--- PDF pág. ${i} ---\n${pageText}`);

    const viewport = page.getViewport({ scale: 1.25 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const img = await previewUrlToBase64(dataUrl, 1800);
    if (img) images.push(img);
  }

  return { images, text: textParts.join('\n').slice(0, 40_000) };
}

export async function prepareAnexoForRegrasAi(file: File, opts?: { maxPdfPages?: number }): Promise<PreparedAnexo> {
  const name = file.name;
  const lower = name.toLowerCase();
  const mime = file.type || '';
  const maxPdfPages = opts?.maxPdfPages ?? 3;

  if (
    mime.includes('sheet') ||
    mime.includes('excel') ||
    mime === 'text/csv' ||
    lower.endsWith('.xlsx') ||
    lower.endsWith('.xls') ||
    lower.endsWith('.csv')
  ) {
    const text = await excelToText(file);
    return { name, images: [], text: `Arquivo Excel: ${name}\n${text}` };
  }

  if (mime === 'application/pdf' || lower.endsWith('.pdf')) {
    const { images, text } = await pdfToImagesAndText(file, maxPdfPages);
    return { name, images, text: text ? `Arquivo PDF: ${name}\n${text}` : `Arquivo PDF: ${name}` };
  }

  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(lower)) {
    const dataUrl = await fileToDataUrl(file);
    const img = await previewUrlToBase64(dataUrl, 2200);
    return {
      name,
      images: img ? [img] : [],
      text: `Imagem anexada: ${name}`,
    };
  }

  try {
    const text = await file.text();
    return { name, images: [], text: `Arquivo: ${name}\n${text.slice(0, 20_000)}` };
  } catch {
    return { name, images: [], text: `Arquivo anexado (não lido): ${name}` };
  }
}
