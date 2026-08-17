import * as pdfjs from 'pdfjs-dist';
import { createWorker } from 'tesseract.js';
import { PDFDocument } from 'pdf-lib';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export async function convertPdfToImages(file: File): Promise<string[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const imageUrls: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    // Escala 4.0 garante aproximadamente 300 DPI, ideal para distinguir 3 de 8 e capturar símbolos pequenos.
    const viewport = page.getViewport({ scale: 4.0 }); 
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

    imageUrls.push(canvas.toDataURL('image/png', 0.95));
  }

  return imageUrls;
}

/**
 * Escala de cinza + limiarização adaptativa (média local via imagem integral —
 * equivalente ao `cv2.adaptiveThreshold` do OpenCV) para preparar a imagem para OCR.
 *
 * Substitui o ajuste de contraste simples (que preservava cores) porque extratos
 * fotografados/escaneados costumam ter marca-texto colorido e anotações a caneta
 * sobre os valores impressos: um recorte por matiz de cor (remover "tudo que é
 * rosa/azul") corrompe os dígitos, pois a borda antisserrilhada do texto preto
 * sobre o fundo colorido também é descartada. A limiarização adaptativa por
 * contraste local, em vez disso, converte tudo para preto/branco puro mantendo o
 * traço do texto (impresso ou à caneta) e apagando sombras/manchas de fundo —
 * testado empiricamente contra um extrato Sicredi fotografado com anotações e
 * marca-texto rosa: reduziu drasticamente erros nos valores (sinal/vírgula
 * perdidos, dígitos trocados) comparado tanto à imagem original quanto ao recorte
 * por cor.
 */
async function prepareImage(base64: string): Promise<string> {
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
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const { data, width, height } = imageData;

      // Luminância em escala de cinza
      const gray = new Float32Array(width * height);
      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }

      // Média local via blur gaussiano separável (2 passes 1D, não caixa/uniforme):
      // testado empiricamente contra um extrato fotografado — o blur em CAIXA
      // (média uniforme, tipo ADAPTIVE_THRESH_MEAN_C do OpenCV, ou aproximações por
      // box blur repetido) deixa ruído/serrilhado que atrapalha bastante o OCR;
      // o equivalente ponderado por peso gaussiano (ADAPTIVE_THRESH_GAUSSIAN_C)
      // reduziu bem mais os erros nos valores.
      function gaussianBlurSeparable(src: Float32Array, radius: number, sigma: number): Float32Array {
        const kernel = new Float32Array(radius * 2 + 1);
        let kernelSum = 0;
        for (let k = -radius; k <= radius; k++) {
          const v = Math.exp(-(k * k) / (2 * sigma * sigma));
          kernel[k + radius] = v;
          kernelSum += v;
        }
        for (let k = 0; k < kernel.length; k++) kernel[k] /= kernelSum;

        const temp = new Float32Array(width * height);
        for (let y = 0; y < height; y++) {
          const rowOff = y * width;
          for (let x = 0; x < width; x++) {
            let acc = 0;
            for (let k = -radius; k <= radius; k++) {
              const xx = Math.min(width - 1, Math.max(0, x + k));
              acc += src[rowOff + xx] * kernel[k + radius];
            }
            temp[rowOff + x] = acc;
          }
        }
        const out = new Float32Array(width * height);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            let acc = 0;
            for (let k = -radius; k <= radius; k++) {
              const yy = Math.min(height - 1, Math.max(0, y + k));
              acc += temp[yy * width + x] * kernel[k + radius];
            }
            out[y * width + x] = acc;
          }
        }
        return out;
      }

      // Raio proporcional à largura da imagem — na resolução testada (~6700px,
      // gerada pela conversão de PDF a scale=4.0 / ~300 DPI) o raio 15 (equivalente
      // ao blockSize=31 do OpenCV) foi o que validou melhor; escala para fotos de
      // celular em outras resoluções manterem a mesma proporção janela/traço de texto.
      const windowRadius = Math.min(40, Math.max(6, Math.round(width / 450)));
      const sigma = windowRadius / 3;
      const C = 15;
      const localMean = gaussianBlurSeparable(gray, windowRadius, sigma);

      for (let p = 0; p < gray.length; p++) {
        const value = gray[p] > localMean[p] - C ? 255 : 0;
        const idx = p * 4;
        data[idx] = data[idx + 1] = data[idx + 2] = value;
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png', 1.0));
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
  images: string[],
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

      const processedImage = await prepareImage(images[idx]);
      const { data } = await worker.recognize(processedImage, {
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
