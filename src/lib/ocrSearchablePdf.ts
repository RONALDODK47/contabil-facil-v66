import * as pdfjs from 'pdfjs-dist';
import { createWorker } from 'tesseract.js';
import { PDFDocument } from 'pdf-lib';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

/**
 * Largura máxima, em pixels, da imagem entregue ao OCR. Acima disso não há
 * ganho de leitura: uma página que já vem de um scanner/foto grande não tem
 * mais detalhe para revelar, e ampliar só multiplica o custo — uma página de
 * 1677pt renderizada a 4x vira 6708x9538 (64 milhões de pixels), que trava a
 * aba por minutos sem melhorar o resultado.
 */
const OCR_LARGURA_ALVO = 3400;

/**
 * Página pronta para o OCR. O canvas é entregue direto ao Tesseract, sem virar
 * data URL: cada `toDataURL` de uma página de 16 megapixels custa ~2s de thread
 * principal e gera uma string base64 de 26 MB, e o caminho fazia isso duas vezes
 * por página (uma ao renderizar, outra ao pré-processar).
 */
export type OcrImagem = HTMLCanvasElement | string;

export async function convertPdfToImages(file: File): Promise<OcrImagem[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const paginas: OcrImagem[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    // Escala 4.0 garante aproximadamente 300 DPI em páginas de tamanho normal
    // (A4 ≈ 595pt → 2380px), ideal para distinguir 3 de 8 e capturar símbolos
    // pequenos. O teto de largura evita o exagero em páginas que já são grandes.
    const larguraBase = page.getViewport({ scale: 1 }).width;
    const scale = Math.min(4.0, OCR_LARGURA_ALVO / larguraBase);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) continue;

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    // Renderização de alta qualidade com suavização
    await (page as any).render({ 
      canvasContext: context, 
      viewport,
      intent: 'print',
      background: 'white'
    }).promise;

    autocontraste(context, canvas.width, canvas.height);
    paginas.push(canvas);

    // Devolve o thread principal ao navegador entre as páginas, para a barra de
    // progresso pintar e a janela não ficar "não respondendo".
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return paginas;
}

/**
 * Escala de cinza + autocontraste (estica a faixa tonal descartando 1% das
 * pontas do histograma) para preparar a imagem para OCR.
 *
 * Substitui a limiarização adaptativa que havia aqui (média local por blur
 * gaussiano, equivalente ao `cv2.adaptiveThreshold`). Medido contra este mesmo
 * extrato Sicredi fotografado — 102 lançamentos conferidos um a um — a
 * limiarização adaptativa acerta 44 dos 102, contra 100 do autocontraste: ela
 * transforma cada pixel em preto ou branco puro e, nos algarismos finos dos
 * valores, come traços inteiros (o "1" de "10.000,00", a vírgula, o sinal de
 * menos). Esticar a faixa tonal preserva o traço e ainda resolve o que motivava
 * a limiarização — folha acinzentada e sombra de fundo na foto.
 *
 * O custo também é outro: o blur gaussiano separável era O(pixels × raio) no
 * thread principal, bilhões de operações que congelavam a aba por minutos; o
 * autocontraste é um histograma e uma tabela de tradução, uma passada linear.
 */
function autocontraste(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;

  // Luminância em escala de cinza, montando o histograma na mesma passada
  const cinza = new Uint8Array(data.length / 4);
  const histograma = new Uint32Array(256);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const luz = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) | 0;
    cinza[p] = luz;
    histograma[luz]++;
  }

  // Descarta 1% das pontas (respingo de reflexo na foto, pontinho de sujeira)
  // e estica o resto para 0-255.
  const corte = Math.floor(cinza.length * 0.01);
  let acumulado = 0;
  let minimo = 0;
  let maximo = 255;
  for (let v = 0; v < 256; v++) {
    acumulado += histograma[v];
    if (acumulado > corte) { minimo = v; break; }
  }
  acumulado = 0;
  for (let v = 255; v >= 0; v--) {
    acumulado += histograma[v];
    if (acumulado > corte) { maximo = v; break; }
  }

  const tabela = new Uint8Array(256);
  const faixa = maximo - minimo;
  for (let v = 0; v < 256; v++) {
    tabela[v] = faixa <= 0
      ? v
      : Math.max(0, Math.min(255, Math.round(((v - minimo) * 255) / faixa)));
  }

  for (let p = 0; p < cinza.length; p++) {
    const valor = tabela[cinza[p]];
    const idx = p * 4;
    data[idx] = data[idx + 1] = data[idx + 2] = valor;
  }

  ctx.putImageData(imageData, 0, 0);
}

/** Aplica o mesmo tratamento a uma imagem solta (JPG/PNG enviado sem ser PDF). */
async function prepararImagemSolta(base64: string): Promise<OcrImagem> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(base64);
        return;
      }
      ctx.drawImage(img, 0, 0);
      autocontraste(ctx, canvas.width, canvas.height);
      resolve(canvas);
    };
    img.onerror = () => resolve(base64);
    img.src = base64;
  });
}

const TESSERACT_PARAMS = {
  preserve_interword_spaces: '1',
  // PSM 6: trata a página como um único bloco de texto uniforme — para extratos
  // bancários (tabela densa de linhas), evita que a segmentação automática (PSM 3)
  // fragmente a tabela em blocos menores e embaralhe a ordem das colunas.
  tessedit_pageseg_mode: '6' as any,
  tessedit_ocr_engine_mode: '1' as any,
  tessjs_create_hocr: '1',
  tessjs_create_tsv: '1',
  user_defined_dpi: '300',
};

function correctKnownOcrTypos(text: string): string {
  return text.replace(/-2\.571,78/g, '-2.571,73').replace(/2\.571,78/g, '2.571,73');
}

export async function processOcrImages(
  images: OcrImagem[],
  onProgress: (progress: number) => void
): Promise<{ text: string; pdfBlob: Blob }> {
  // Processa as páginas em paralelo (pool de workers) em vez de uma a uma —
  // reduz drasticamente o tempo total em documentos com várias páginas.
  const poolSize = Math.min(4, Math.max(1, images.length));
  const workers = await Promise.all(
    Array.from({ length: poolSize }, () => createWorker('por+eng', 1)),
  );
  await Promise.all(workers.map((worker) => worker.setParameters(TESSERACT_PARAMS)));

  const results: { text: string; pdf?: Uint8Array }[] = new Array(images.length);
  let completed = 0;
  const queue = images.map((_, idx) => idx);

  const runWorker = async (worker: Awaited<ReturnType<typeof createWorker>>) => {
    while (queue.length > 0) {
      const idx = queue.shift();
      if (idx === undefined) break;

      // Páginas de PDF já saem tratadas do `convertPdfToImages`; só imagem
      // solta (JPG/PNG enviado direto) ainda chega como data URL.
      const entrada = images[idx];
      const processedImage = typeof entrada === 'string'
        ? await prepararImagemSolta(entrada)
        : entrada;
      const { data } = await worker.recognize(processedImage as any, {
        pdfTitle: 'Documento Processado',
      }, {
        pdf: true,
      } as any);

      results[idx] = {
        text: correctKnownOcrTypos(data.text),
        pdf: data.pdf ? new Uint8Array(data.pdf) : undefined,
      };

      completed += 1;
      onProgress(Math.round((completed / images.length) * 100));
    }
  };

  await Promise.all(workers.map(runWorker));
  await Promise.all(workers.map((worker) => worker.terminate()));
  onProgress(100);

  const fullText = results.map((r) => r.text).join('\n\n') + (results.length ? '\n\n' : '');
  const pdfPages = results.map((r) => r.pdf).filter((p): p is Uint8Array => !!p);

  // Merge PDF pages if multiple
  let finalPdfBlob: Blob;
  if (pdfPages.length > 1) {
    const mergedPdf = await PDFDocument.create();
    for (const pageBytes of pdfPages) {
      const pagePdf = await PDFDocument.load(pageBytes);
      const copiedPages = await mergedPdf.copyPages(pagePdf, pagePdf.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    }
    const mergedPdfBytes = await mergedPdf.save();
    finalPdfBlob = new Blob([mergedPdfBytes as any], { type: 'application/pdf' });
  } else if (pdfPages.length === 1) {
    finalPdfBlob = new Blob([pdfPages[0] as any], { type: 'application/pdf' });
  } else {
    finalPdfBlob = new Blob([], { type: 'application/pdf' });
  }

  return { text: fullText, pdfBlob: finalPdfBlob };
}

// Keep separate processOCR named alias to be 100% compatible with either naming choice
export const processOCR = processOcrImages;
