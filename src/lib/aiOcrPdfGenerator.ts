import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

export interface OcrBlock {
  text: string;
  ymin: number; // 0-1000
  xmin: number; // 0-1000
  ymax: number; // 0-1000
  xmax: number; // 0-1000
}

/** Gera um PDF a partir de um canvas (imagem) com uma camada de texto OCR selecionável. */
export async function generateSearchablePdfFromImage(
  imageCanvas: HTMLCanvasElement,
  ocrBlocks: OcrBlock[]
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([imageCanvas.width, imageCanvas.height]);
  
  // Converte canvas para JPEG para reduzir tamanho do PDF
  const imageBase64 = imageCanvas.toDataURL('image/jpeg', 0.85).split(',')[1]!;
  const image = await pdfDoc.embedJpg(imageBase64);
  
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: imageCanvas.width,
    height: imageCanvas.height,
  });

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Adiciona camada de texto transparente
  for (const block of ocrBlocks) {
    // pdf-lib usa coordenadas cartesianas (0,0 no canto inferior esquerdo)
    const x = (block.xmin / 1000) * imageCanvas.width;
    const y = imageCanvas.height - (block.ymax / 1000) * imageCanvas.height;
    const blockHeight = ((block.ymax - block.ymin) / 1000) * imageCanvas.height;
    
    // Tamanho da fonte proporcional à altura do bloco
    const fontSize = Math.max(blockHeight * 0.8, 2);

    page.drawText(block.text, {
      x,
      y,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
      opacity: 0, // Invisível mas selecionável
    });
  }

  return pdfDoc.save();
}

/** Adiciona camada de texto OCR a um PDF existente (página por página). */
export async function addOcrLayerToPdf(
  originalPdfBytes: Uint8Array,
  pageOcrBlocks: { pageIndex: number; blocks: OcrBlock[] }[]
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(originalPdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (const { pageIndex, blocks } of pageOcrBlocks) {
    if (pageIndex >= pdfDoc.getPageCount()) continue;
    
    const page = pdfDoc.getPage(pageIndex);
    const { width, height } = page.getSize();

    for (const block of blocks) {
      const x = (block.xmin / 1000) * width;
      const y = height - (block.ymax / 1000) * height;
      const blockHeight = ((block.ymax - block.ymin) / 1000) * height;
      const fontSize = Math.max(blockHeight * 0.8, 2);

      page.drawText(block.text, {
        x,
        y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
        opacity: 0,
      });
    }
  }

  return pdfDoc.save();
}
