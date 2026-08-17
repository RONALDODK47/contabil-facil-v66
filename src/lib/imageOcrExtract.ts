import type { AiOcrDocumentType } from './aiOcrAssist';

export const OCR_LOCAL_REMOVED_MESSAGE =
  'OCR foi removido do sistema. Use texto nativo do PDF, leitor-recortador sem OCR, planilha, TXT ou OFX.';

export type OcrPositionedWord = {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Confiança OCR 0–100 (quando disponível). */
  confidence?: number;
};

/** Preset de carregamento OCR para extratos bancários (Full HD + qualidade alta). */
export const OCR_EXTRATO_RESOLUTION_PRESET: OcrResolutionPreset = 'fhd';

/** Confiança mínima para manter token OCR em extrato (tokens abaixo são descartados). */
export const OCR_EXTRATO_CONFIDENCE_MIN = 28;
export const PDF_RENDER_SCALE_MIN = 3;
/** Limite superior da escala de rasterização do PDF (4K em páginas pequenas pode exigir mais de 8). */
export const PDF_RENDER_SCALE_MAX = 16;
/** Alvo ~HD no maior lado. */
export const PDF_RASTER_LONG_EDGE_HD = 1280;
/** Alvo de pixels no maior lado da página (~Full HD) para botão de escala rápida no OCR parcelamento. */
export const PDF_RASTER_LONG_EDGE_FHD = 1920;
/** Alvo ~4K UHD no maior lado. */
export const PDF_RASTER_LONG_EDGE_4K = 3840;

export type OcrResolutionPreset = 'hd' | 'fhd' | '4k';

export const OCR_RESOLUTION_PRESETS: readonly OcrResolutionPreset[] = ['hd', 'fhd', '4k'];

export const OCR_RESOLUTION_LABELS: Record<OcrResolutionPreset, string> = {
  hd: 'HD',
  fhd: 'Full HD',
  '4k': '4K',
};

/** Escala automática padrão — OCR local lê o texto; usuário não escolhe resolução. */
export const OCR_AUTO_RESOLUTION_PRESET: OcrResolutionPreset = 'fhd';

export const OCR_AUTO_LOAD_OPTIONS = {
  resolutionPreset: OCR_AUTO_RESOLUTION_PRESET,
} as const;

/** Pixels no maior lado para cada preset de resolução (PDF e imagem). */
export function longEdgeForOcrPreset(preset: OcrResolutionPreset): number {
  switch (preset) {
    case 'hd':
      return PDF_RASTER_LONG_EDGE_HD;
    case 'fhd':
      return PDF_RASTER_LONG_EDGE_FHD;
    case '4k':
      return PDF_RASTER_LONG_EDGE_4K;
  }
}

/**
 * Escala de rasterização adaptativa para extratos bancários:
 * páginas compactas (A4 digital) → ~2,5K; páginas já grandes → FHD; muito pequenas → até 4K.
 */
export function computeAdaptiveExtratoPdfRenderScale(
  page: { getViewport: (p: { scale: number }) => { width: number; height: number } },
): number {
  const v1 = page.getViewport({ scale: 1 });
  const longPt = Math.max(v1.width, v1.height);
  let targetPx = IMAGE_OCR_LONG_EDGE_2K5;
  if (longPt > 0 && longPt < 720) {
    targetPx = PDF_RASTER_LONG_EDGE_4K;
  } else if (longPt > 0 && longPt <= 980) {
    targetPx = IMAGE_OCR_LONG_EDGE_2K5;
  }
  return clampPdfRenderScale(targetPx / longPt);
}

/** OCR em imagem (parcelamento): sem ampliação — usa os pixels do arquivo. */
export const IMAGE_OCR_LONG_EDGE_NATIVE = 0;
/** Ampliar até ~este tamanho no maior lado (só se o original for menor). */
export const IMAGE_OCR_LONG_EDGE_FHD = 1920;
export const IMAGE_OCR_LONG_EDGE_2K5 = 2560;
export const IMAGE_OCR_LONG_EDGE_4K = 3840;
/** Teto de pixels no maior lado após ampliação (memória / desempenho). */
export const IMAGE_OCR_LONG_EDGE_HARD_CAP = 8192;
/** Limite de fator de ampliação em relação ao arquivo original. */
export const IMAGE_OCR_UPSCALE_MAX_FACTOR = 8;

/** Valores válidos para o seletor «melhorar leitura» da imagem no modal de parcelamento. */
export const IMAGE_OCR_LONG_EDGE_CHOICES: readonly number[] = [
  IMAGE_OCR_LONG_EDGE_NATIVE,
  IMAGE_OCR_LONG_EDGE_FHD,
  IMAGE_OCR_LONG_EDGE_2K5,
  IMAGE_OCR_LONG_EDGE_4K,
];

/**
 * Fator de escala ≥ 1 para atingir `targetLongEdgePx` no maior lado, sem reduzir imagens já grandes.
 */
export function computeImageOcrUpscaleFactor(
  width: number,
  height: number,
  targetLongEdgePx: number
): number {
  if (!(targetLongEdgePx > 0) || !(width > 0) || !(height > 0)) return 1;
  const longEdge = Math.max(width, height);
  const target = Math.min(targetLongEdgePx, IMAGE_OCR_LONG_EDGE_HARD_CAP);
  const raw = target / longEdge;
  if (raw <= 1) return 1;
  const capByHard = IMAGE_OCR_LONG_EDGE_HARD_CAP / longEdge;
  return Math.min(raw, capByHard, IMAGE_OCR_UPSCALE_MAX_FACTOR);
}

/**
 * Gera URL de pré-visualização (blob:) com possível ampliação para OCR mais nítido.
 * Coordenadas do OCR coincidem com `imgWidth` / `imgHeight` devolvidos.
 * O chamador deve revogar `previewUrl` com `URL.revokeObjectURL` quando deixar de usar.
 */
export async function imageFileToParcelamentoOcrPreview(
  file: File,
  targetLongEdgePx: number,
  onProgress?: (msg: string) => void
): Promise<{ previewUrl: string; imgWidth: number; imgHeight: number }> {
  if (!(targetLongEdgePx > 0)) {
    onProgress?.('Lendo dimensões…');
    const bmp = await createImageBitmap(file);
    const imgWidth = bmp.width;
    const imgHeight = bmp.height;
    bmp.close();
    return {
      previewUrl: URL.createObjectURL(file),
      imgWidth,
      imgHeight,
    };
  }

  onProgress?.('Lendo imagem…');
  const bmp = await createImageBitmap(file);
  const w0 = bmp.width;
  const h0 = bmp.height;
  const scale = computeImageOcrUpscaleFactor(w0, h0, targetLongEdgePx);

  if (scale <= 1) {
    bmp.close();
    return {
      previewUrl: URL.createObjectURL(file),
      imgWidth: w0,
      imgHeight: h0,
    };
  }

  onProgress?.('Ampliando imagem para melhor leitura (OCR)…');
  const nw = Math.max(1, Math.round(w0 * scale));
  const nh = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = nw;
  canvas.height = nh;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bmp.close();
    return {
      previewUrl: URL.createObjectURL(file),
      imgWidth: w0,
      imgHeight: h0,
    };
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, nw, nh);
  bmp.close();

  const outBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Falha ao gerar imagem ampliada para OCR.'))),
      'image/jpeg',
      0.92
    );
  });
  return {
    previewUrl: URL.createObjectURL(outBlob),
    imgWidth: nw,
    imgHeight: nh,
  };
}
/**
 * Escala padrão ao rasterizar PDF para OCR (`parcelamentoColunasExtract`).
 * Maior = mais nítido; custo: mais memória e OCR mais lento.
 */
export const PDF_RENDER_SCALE_DEFAULT = 6.75;
/** @deprecated prefira `PDF_RENDER_SCALE_DEFAULT` */
export const PDF_RENDER_SCALE = PDF_RENDER_SCALE_DEFAULT;

/** Opções exibidas no seletor de escala do modal de mapeamento. */
export const PDF_RENDER_SCALE_CHOICES: readonly number[] = [
  3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 6.75, 7, 7.5, 8, 9, 10, 12, 14, 16,
];

export function clampPdfRenderScale(n: number): number {
  if (!Number.isFinite(n)) return PDF_RENDER_SCALE_DEFAULT;
  const v = Math.round(n * 100) / 100;
  return Math.min(PDF_RENDER_SCALE_MAX, Math.max(PDF_RENDER_SCALE_MIN, v));
}

export type OcrPreprocessMode = 'auto' | 'scan' | 'light' | 'extrato';

/** Alvo de ampliação antes do OCR (scans e fotos pequenas). */
export const OCR_SCAN_TARGET_LONG_EDGE = 1920;
/** Prévia já com este maior lado (ou mais): não ampliar de novo no OCR. */
export const OCR_SKIP_AUTO_UPSCALE_LONG_EDGE = 960;
/** Ampliação automática só para imagens bem pequenas (evita 960→1920 lento). */
export const OCR_SMALL_IMAGE_UPSCALE_TARGET = 1280;
/** Teto de pixels no maior lado enviado ao OCR (qualidade vs desempenho). */
export const OCR_MAX_LONG_EDGE = 2048;
/** @deprecated use OCR_MAX_LONG_EDGE */
export const OCR_PADDLE_MAX_LONG_EDGE = OCR_MAX_LONG_EDGE;
/** @deprecated use OCR_MAX_LONG_EDGE */
export const OCR_TESSERACT_MAX_LONG_EDGE = OCR_MAX_LONG_EDGE;

function grayFromImageData(d: Uint8ClampedArray, n: number): Uint8Array {
  const gray = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    gray[p] = Math.min(
      255,
      Math.max(0, Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])),
    );
  }
  return gray;
}

/** Fundo cinza + texto escuro = documento escaneado ou foto. */
export function looksLikeScannedDocument(gray: Uint8Array, pixelCount: number): boolean {
  if (pixelCount <= 0) return false;
  let paper = 0;
  let dark = 0;
  for (let i = 0; i < pixelCount; i++) {
    const g = gray[i];
    if (g >= 165 && g <= 248) paper++;
    if (g < 120) dark++;
  }
  const paperRatio = paper / pixelCount;
  const darkRatio = dark / pixelCount;
  return paperRatio > 0.1 && darkRatio > 0.008 && darkRatio < 0.35;
}

function otsuThreshold(hist: Uint32Array, total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) * (mB - mF);
    if (varBetween > maxVar) {
      maxVar = varBetween;
      threshold = t;
    }
  }
  return threshold;
}

function histogramStretchInPlace(gray: Uint8Array, n: number): void {
  const hist = new Uint32Array(256);
  for (let p = 0; p < n; p++) hist[gray[p]]++;
  const trim = Math.max(1, Math.floor(n * 0.005));
  let cum = 0;
  let lo = 0;
  for (let g = 0; g < 256; g++) {
    cum += hist[g];
    if (cum >= trim) {
      lo = g;
      break;
    }
  }
  cum = 0;
  let hi = 255;
  for (let g = 255; g >= 0; g--) {
    cum += hist[g];
    if (cum >= trim) {
      hi = g;
      break;
    }
  }
  const rng = Math.max(hi - lo, 24);
  for (let p = 0; p < n; p++) {
    let v = ((gray[p] - lo) / rng) * 255;
    v = Math.min(255, Math.max(0, v));
    const gn = v / 255;
    gray[p] = Math.min(255, Math.max(0, Math.round(Math.pow(gn, 0.85) * 255)));
  }
}

function sharpenGrayBuffer(gray: Uint8Array, w: number, h: number): Uint8Array {
  const n = w * h;
  const sharp = new Uint8Array(n);
  const k = 0.5;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        sharp[p] = gray[p];
        continue;
      }
      const c = gray[p];
      const lap =
        4 * c - gray[p - 1] - gray[p + 1] - gray[p - w] - gray[p + w];
      sharp[p] = Math.min(255, Math.max(0, Math.round(c + k * lap)));
    }
  }
  return sharp;
}

function binarizeOtsu(gray: Uint8Array, n: number): Uint8Array {
  const hist = new Uint32Array(256);
  for (let p = 0; p < n; p++) hist[gray[p]]++;
  const t = otsuThreshold(hist, n);
  const out = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    out[p] = gray[p] < t - 8 ? 0 : 255;
  }
  return out;
}

/** Contexto 2D para leitura frequente de pixels (getImageData / putImageData). */
function getCanvas2dReadback(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  return canvas.getContext('2d', { willReadFrequently: true });
}

function putGrayOnCanvas(ctx: CanvasRenderingContext2D, gray: Uint8Array, w: number, h: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
    const v = gray[p];
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

async function loadBitmapToCanvas(
  blob: Blob,
  maxLongEdge = 3200,
): Promise<{ canvas: HTMLCanvasElement; gray: Uint8Array; w: number; h: number } | null> {
  const bmp = await createImageBitmap(blob);
  let w = bmp.width;
  let h = bmp.height;
  const long0 = Math.max(w, h);
  if (long0 > maxLongEdge) {
    const s = maxLongEdge / long0;
    w = Math.max(1, Math.round(w * s));
    h = Math.max(1, Math.round(h * s));
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = getCanvas2dReadback(canvas);
  if (!ctx) {
    bmp.close();
    return null;
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const gray = grayFromImageData(ctx.getImageData(0, 0, w, h).data, w * h);
  return { canvas, gray, w, h };
}

/** Binarização Otsu para scans e fotos de extrato. */
export async function preprocessImageBlobForOcrScanned(blob: Blob): Promise<Blob> {
  const loaded = await loadBitmapToCanvas(blob);
  if (!loaded) return blob;
  const { canvas, w, h } = loaded;
  const n = w * h;
  const gray = loaded.gray;
  histogramStretchInPlace(gray, n);
  const sharp = sharpenGrayBuffer(gray, w, h);
  const binary = binarizeOtsu(sharp, n);
  const ctx = getCanvas2dReadback(canvas);
  if (!ctx) return blob;
  putGrayOnCanvas(ctx, binary, w, h);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Falha ao preparar scan para OCR.'))),
      'image/png',
    );
  });
}

/**
 * Pré-processamento leve (captura de tela / PDF rasterizado nítido).
 * Expansão de histograma + nitidez — evita fundir dígitos em fontes pequenas.
 */
export async function preprocessImageBlobForOcrLight(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const w = bmp.width;
  const h = bmp.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = getCanvas2dReadback(canvas);
  if (!ctx) {
    bmp.close();
    return blob;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0);
  bmp.close();

  const gray = grayFromImageData(ctx.getImageData(0, 0, w, h).data, w * h);
  histogramStretchInPlace(gray, w * h);
  const sharp = sharpenGrayBuffer(gray, w, h);
  putGrayOnCanvas(ctx, sharp, w, h);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Falha ao preparar imagem para OCR.'))),
      'image/png',
    );
  });
}

/** @deprecated use preprocessImageBlobForOcrLight ou preprocessForOcr */
export const preprocessImageBlobForOcr = preprocessImageBlobForOcrLight;

/** Detecta scan/foto e aplica binarização ou realce leve. */
export async function preprocessForOcr(
  blob: Blob,
  mode: OcrPreprocessMode = 'auto',
): Promise<Blob> {
  if (mode === 'scan') return preprocessImageBlobForOcrScanned(blob);
  // Modo foto: extrato também usa pipeline de scanner (binarização/nitidez).
  if (mode === 'extrato') return preprocessImageBlobForOcrScanned(blob);
  if (mode === 'light') return preprocessImageBlobForOcrLight(blob);
  const loaded = await loadBitmapToCanvas(blob, 2400);
  if (!loaded) return blob;
  if (looksLikeScannedDocument(loaded.gray, loaded.w * loaded.h)) {
    return preprocessImageBlobForOcrScanned(blob);
  }
  return preprocessImageBlobForOcrLight(blob);
}

export function estimateOcrDpi(imgWidth: number, imgHeight: number): number {
  const longEdge = Math.max(imgWidth, imgHeight);
  const dpi = Math.round((longEdge / 11) * 2.54);
  return Math.min(400, Math.max(150, dpi));
}

let ocrQueue: Promise<unknown> = Promise.resolve();

function runSerializedOcr<T>(task: () => Promise<T>): Promise<T> {
  const next = ocrQueue.then(task, task);
  ocrQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** Pré-carrega assistente IA para OCR assistido. */
export function warmupSharedOcrWorker(): void {
  /* noop: OCR removido do sistema */
}

/** OCR local é stateless no servidor — noop mantido para compatibilidade de API. */
export async function terminateSharedOcrWorker(): Promise<void> {
  /* noop */
}

const OCR_SERVER_URL = import.meta.env.VITE_OCR_SERVER_URL || 'http://127.0.0.1:3001';

/**
 * OCR usando servidor conversor (FastAPI).
 */
export async function runOcrPortuguese(
  imageFile: File,
  onProgress?: (fraction: number, message: string) => void,
  _options?: { documentType?: AiOcrDocumentType },
): Promise<string> {
  const words = await runOcrPortugueseWords(imageFile, onProgress);
  return words.map((w) => w.str).join(' ');
}

/** OCR com caixas por palavra/linha (coordenadas = pixels da imagem enviada). */
export async function runOcrPortugueseWords(
  imageFile: File,
  onProgress?: (fraction: number, message: string) => void,
  options?: { preprocess?: boolean; psm?: string; preprocessMode?: OcrPreprocessMode },
): Promise<OcrPositionedWord[]> {
  const result = await runOcrPortugueseWordsResult(imageFile, onProgress, options);
  return result.words;
}

export async function runOcrPortugueseWordsResult(
  imageFile: File,
  onProgress?: (fraction: number, message: string) => void,
  options?: { preprocess?: boolean; psm?: string; preprocessMode?: OcrPreprocessMode },
): Promise<{ words: OcrPositionedWord[]; fullText: string }> {
  try {
    onProgress?.(0.1, 'Preparando imagem para OCR…');

    let processedFile = imageFile;
    if (options?.preprocess !== false) {
      const mode = options?.preprocessMode || 'auto';
      const preprocessed = await preprocessForOcr(imageFile, mode);
      processedFile = new File([preprocessed], imageFile.name || 'ocr.png', { type: 'image/png' });
    }

    onProgress?.(0.3, 'Enviando para OCR…');

    const formData = new FormData();
    formData.append('file', processedFile);
    formData.append('use_ocr', 'auto');

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
            w: 100,
            h: 20,
          });
          x += 120;
        }
      }
      y += 25;
    }

    onProgress?.(1.0, 'OCR concluído');

    const fullText = words.map((w) => w.str).join(' ');
    return { words, fullText };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onProgress?.(0, `Erro OCR: ${msg}`);
    throw error;
  }
}
