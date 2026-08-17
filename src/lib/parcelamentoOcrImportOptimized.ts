/**
 * Otimizações para importação OCR de parcelamentos com suporte a tabelas.
 * Usa detecção automática de estrutura para melhor OCR de tabelas.
 */

import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { runOcrPortugueseOptimized } from './imageOcrExtractOptimized';
import { pdfFileToRows } from './pdfClientExtract';
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

/**
 * Converte texto OCR em array de linhas/células com agrupamento inteligente.
 * Utiliza PSM 4 (tabelas) produz melhor separação de colun as.
 */
function ocrTextToRowsOptimized(text: string): string[][] {
  const rows: string[][] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    
    // Separa por múltiplos espaços, tabs ou múltiplos espaços consecutivos
    const cells = line
      .split(/\t+|\s{2,}/)
      .map((c) => c.trim())
      .filter(Boolean);
    
    // Se tem múltiplas células, mantém como linha; senão, coloca como célula única
    rows.push(cells.length > 1 ? cells : [line]);
  }
  return rows;
}

async function pdfPageToPngFileHighQuality(page: pdfjsLib.PDFPageProxy, pageNum: number): Promise<File> {
  // Escala aumentada para melhor qualidade em tabelas
  const viewport = page.getViewport({ scale: 3.0 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas não disponível para OCR.');
  
  await page.render({ 
    canvasContext: ctx, 
    viewport, 
    canvas,
    intent: 'print' // Renderiza com intenção de impressão para melhor qualidade
  }).promise;

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Falha ao renderizar página PDF.'))), 
      'image/png',
      0.95 // Qualidade PNG
    );
  });
  return new File([blob], `parcelamento-p${pageNum}.png`, { type: 'image/png' });
}

async function pdfFileToRowsViaOcrOptimized(
  file: File,
  onProgress?: (p: ParcelamentoOcrProgress) => void
): Promise<string[][]> {
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ 
    data: new Uint8Array(buf), 
    useSystemFonts: true,
    pdfBug: false 
  }).promise;
  
  const maxPages = Math.min(doc.numPages, 8);
  const allRows: string[][] = [];

  for (let pn = 1; pn <= maxPages; pn++) {
    onProgress?.({
      message: `OCR otimizado na página ${pn} de ${maxPages}…`,
      fraction: 0.15 + (pn / maxPages) * 0.75,
    });
    
    const page = await doc.getPage(pn);
    const png = await pdfPageToPngFileHighQuality(page, pn);
    
    // Usa OCR otimizado com detecção de tabelas
    const text = await runOcrPortugueseOptimized(png, (frac, msg) => {
      onProgress?.({
        message: `Página ${pn}: ${msg}`,
        fraction: 0.15 + ((pn - 1 + frac) / maxPages) * 0.75,
      });
    });
    
    const pageRows = ocrTextToRowsOptimized(text);
    allRows.push(...pageRows);
  }

  doc.destroy();
  return allRows;
}

function isImageFile(file: File): boolean {
  return /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name) || /^image\//i.test(file.type);
}

/**
 * Extrai tabela de cronograma com OCR otimizado para tabelas.
 * - PDF com texto: extrai normalmente
 * - PDF scaneado: usa OCR com PSM 4 (múltiplas colunas)
 * - Imagem: detecta se é tabela e aplica PSM apropriado
 */
export async function importParcelamentoFromOcrFileOptimized(
  file: File,
  onProgress?: (p: ParcelamentoOcrProgress) => void
): Promise<ParcelamentoPlanilhaImport> {
  onProgress?.({ message: 'Lendo arquivo…', fraction: 0.05 });

  let rows: string[][] = [];
  let ocrText = '';

  if (fileIsLikelyPdf(file)) {
    try {
      onProgress?.({ message: 'Extraindo texto do PDF…', fraction: 0.1 });
      const { rows: pdfRows, meta } = await pdfFileToRows(file, 800);
      if (pdfRows.length >= 2 && meta.charsApprox >= 50) {
        rows = pdfRows;
        onProgress?.({ message: 'PDF com texto extraído com sucesso.', fraction: 0.2 });
      }
    } catch (e) {
      console.warn('[OCR] Extração de texto PDF falhou, usando OCR:', e);
      /* OCR abaixo */
    }
    
    // Se não conseguiu texto, usa OCR otimizado
    if (rows.length < 2) {
      rows = await pdfFileToRowsViaOcrOptimized(file, onProgress);
    }
  } else if (isImageFile(file)) {
    onProgress?.({ message: 'Reconhecendo texto na imagem com OCR otimizado…', fraction: 0.15 });
    ocrText = await runOcrPortugueseOptimized(file, (frac, msg) => {
      onProgress?.({ message: msg, fraction: 0.15 + frac * 0.75 });
    });
    rows = ocrTextToRowsOptimized(ocrText);
  } else {
    throw new Error('Use um arquivo PDF ou imagem (PNG, JPG, WEBP).');
  }

  onProgress?.({ message: 'Interpretando parcelas, juros, multas e contas…', fraction: 0.92 });

  const parsed = parseParcelamentoTableRows(rows);
  const fromText = ocrText 
    ? readCadastroFromText(ocrText) 
    : readCadastroFromText(rows.map((r) => r.join(' ')).join('\\n'));

  return {
    nomeParcelamento: parsed.nomeParcelamento || fromText.nomeParcelamento,
    clienteNome: parsed.clienteNome || fromText.clienteNome,
    numeroParcelamento: parsed.numeroParcelamento || fromText.numeroParcelamento,
    linhas: parsed.linhas,
  };
}
