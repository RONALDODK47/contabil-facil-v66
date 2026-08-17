import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import {
  runOcrPortugueseWords,
  runOcrPortugueseWordsResult,
  PDF_RENDER_SCALE_DEFAULT,
  clampPdfRenderScale,
  computeAdaptiveExtratoPdfRenderScale,
  PDF_RASTER_LONG_EDGE_FHD,
  PDF_RASTER_LONG_EDGE_4K,
  preprocessForOcr,
  type OcrPreprocessMode,
  OCR_SKIP_AUTO_UPSCALE_LONG_EDGE,
  OCR_SMALL_IMAGE_UPSCALE_TARGET,
  imageFileToParcelamentoOcrPreview,
  longEdgeForOcrPreset,
  IMAGE_OCR_LONG_EDGE_NATIVE,
  IMAGE_OCR_LONG_EDGE_FHD,
  IMAGE_OCR_LONG_EDGE_2K5,
  type OcrPositionedWord,
  type OcrResolutionPreset,
} from './imageOcrExtract';
import {
  detectItauExtratoFromOcrText,
  getItauExtratoExtractGenericOptions,
  mergeItauIgnoreLineWords,
} from './itauExtratoProfile';
import {
  parseMoedaPt,
  parseDataFlexivel,
  normalizeOcrTexto,
  readCadastroFromText,
  parseMoedaPtFromOcrBlob,
  parseMoedaPtFromOcrColuna,
  prepararTextoOcrParaMoeda,
  PARCELAMENTO_MOEDA_PLAUSIVEL_MAX,
  PARCELAMENTO_MOEDA_DIGITOS_INTEIROS_MAX,
  type ParcelaPlanilhaRow,
  type ParcelamentoPlanilhaImport,
  type ParcelamentoColunaImportId,
} from './parcelamentoPlanilha';
import {
  endGroupParcelamentoOcr,
  groupParcelamentoOcr,
  isParcelamentoOcrDebug,
  logParcelamentoOcr,
} from './parcelamentoOcrDebug';
import {
  clusterLinhasExtratoPosicional,
  clusterExtratoUmaLinhaPorValor,
  segmentarExtratoEmLancamentos,
  segmentarExtratoEmClusters,
  buildHistoricoFromSegmento,
  buildLinhaOcrFromSegmento,
  extratoLinhaBbIniciaNovoLancamento,
  resolveExtratoValorColBoundsFromColumns,
  type ExtratoLancamentoSegmento,
  postProcessExtratoOcrRows,
  inferExtratoDescricaoFromCluster,
  resolveExtratoDescricaoText,
  extratoDescricaoIgnorarIndicadorDc,
  sanitizeExtratoDataOcrToken,
  sanitizeExtratoValorOcrToken,
  parseExtratoDataOcrText,
  filtrarTokensDescricaoMesmaLinhaValor,
  filtrarRowClusterNaLinhaDoValor,
  limparHistoricoExtratoMisturado,
  extratoHistoricoEhPlausivel,
  extratoHistoricoEhSomenteSaldoInformativo,
  extratoRowEhSaldoInformativo,
  extratoRowHistoricoColunaSaldoDesalinhado,
  extratoLimparRowHistoricoSaldoDesalinhado,
  extratoLinhaSaldoTemValorLancamentoColado,
  extratoCorrigirRowNaturezaValorDesalinhado,
  normalizeLinhaOcrParaSplit,
  inferDescricaoFromLinhaOcr,
  splitClusterPorLinhasY,
  extratoTextoEhRodape,
  extratoRowContemPalavraIgnorada,
  extratoTextoContemPalavraIgnorada,
  extratoLinhaTemLancamentoOperacionalRecuperavel,
  consolidarColunasValorExtratoRow,
  sanitizeExtratoOcrRowColumns,
  stripDateTokensFromExtratoText,
  tokenEhValorExtrato,
  type OcrExtratoRow,
  auditarCoberturaValoresExtrato,
} from './ocrExtratoPositional';
import {
  colapsarRepeticaoAdjacenteOcr,
  fixOcrHistoricoLine,
  fixOcrItemsForExtrato,
  fixOcrTokenForExtrato,
  prepararItensOcrParaExtrato,
} from './ocrExtratoTokenFix';
import { getOcrDatePropagationMode } from './ocrCloudRulesStorage';
import { refineOcrPosicionadoItems } from './aiOcrAssist';
import { notifyOcrIssue } from './aiProactiveNotify';
import { prepareOcrUploadFile } from './ocrUpload';
import {
  parseMoedaPtFromExtratoColuna,
  pickExtratoValorFromRowItems,
  pickExtratoValorFromColItems,
  parseExtratoNaturezaIndicador,
  parseExtratoNaturezaNoValor,
  parseExtratoNaturezaFromRowItems,
  resolveExtratoDebCredNature,
  extratoValorIsNegative,
  moedaExtratoPlausivel,
  normalizeExtratoValorColunaOcr,
  formatExtratoValorAssinadoPt,
  normalizeExtratoValorAssinadoToken,
  extratoNaturezaPorValorAssinadoNoToken,
} from '../extratoVision/utils/extratoMoneyParse';
import { expandExtratoFaixaPorValoresCorpo } from './pdfNativeTextItems';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/** Abaixo disso a imagem é ampliada antes do OCR (evita 125×86 px e poucos trechos). */
export const PARCELAMENTO_OCR_MIN_LONG_EDGE = 320;

export type PosicionadoItem = {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ParcelamentoColunaCampo =
  | 'numero'
  | 'vencimento'
  | 'valor'
  | 'pagamento'
  | 'juros'
  | 'encargosHonorarios'
  | 'encargos'
  | 'honorarios'
  | 'multa'
  | 'ignorar1'
  | 'ignorar2'
  | 'ignorar3';

export const PARCELAMENTO_CAMPOS: Array<{
  id: ParcelamentoColunaCampo;
  name: string;
  required: boolean;
  color: string;
  borderColor: string;
}> = [
    { id: 'numero', name: 'Nº parcela (opc.)', required: false, color: 'bg-blue-500', borderColor: 'border-blue-500' },
    { id: 'vencimento', name: 'Data', required: false, color: 'bg-cyan-500', borderColor: 'border-cyan-500' },
    {
      id: 'valor',
      name: 'Valor do parcelamento (R$)',
      required: false,
      color: 'bg-emerald-500',
      borderColor: 'border-emerald-500',
    },
    {
      id: 'pagamento',
      name: 'Pagamento / Valor pago (R$)',
      required: false,
      color: 'bg-teal-500',
      borderColor: 'border-teal-500',
    },
    { id: 'juros', name: 'Juros (R$)', required: false, color: 'bg-amber-500', borderColor: 'border-amber-500' },
    { id: 'encargos', name: 'Encargos (R$)', required: false, color: 'bg-orange-500', borderColor: 'border-orange-500' },
    { id: 'honorarios', name: 'Honorários (R$)', required: false, color: 'bg-yellow-500', borderColor: 'border-yellow-500' },
    { id: 'multa', name: 'Multa (R$)', required: false, color: 'bg-rose-500', borderColor: 'border-rose-500' },
    {
      id: 'ignorar1',
      name: 'Ignorar coluna 1',
      required: false,
      color: 'bg-slate-600',
      borderColor: 'border-slate-400 border-dashed',
    },
    {
      id: 'ignorar2',
      name: 'Ignorar coluna 2',
      required: false,
      color: 'bg-slate-600',
      borderColor: 'border-slate-400 border-dashed',
    },
    {
      id: 'ignorar3',
      name: 'Ignorar coluna 3',
      required: false,
      color: 'bg-slate-600',
      borderColor: 'border-slate-400 border-dashed',
    },
  ];

export type ParcelamentoColunaDef = {
  id: ParcelamentoColunaCampo;
  start: number;
  end: number;
  color: string;
};

export type ParcelamentoFaixaDados = {
  startY: number;
  endY: number;
};

export type ParcelamentoColunasMapping = {
  columns: ParcelamentoColunaDef[];
  faixa?: ParcelamentoFaixaDados;
};

export type DocumentoParcelamentoPreview = {
  previewUrl: string;
  imgWidth: number;
  imgHeight: number;
  items: PosicionadoItem[];
  isPdf: boolean;
  pdfDoc?: pdfjsLib.PDFDocumentProxy;
  totalPages: number;
  ocrSource: 'ocr' | 'pdf-text';
  itemCount: number;
  /** Texto integral OCR (extrato BB escaneado). */
  ocrFullText?: string;
  /** Escala sugerida para ~1920 px no maior lado (Full HD). Só PDF. */
  pdfSuggestedScaleFhd?: number;
  /** Escala sugerida para ~3840 px no maior lado (4K UHD). Só PDF. */
  pdfSuggestedScale4k?: number;
  /** Escala usada na rasterização (adaptativa para extrato). Só PDF. */
  pdfRenderScale?: number;
};

export type LoadParcelamentoPreviewOptions = {
  /** Preset unificado HD / Full HD / 4K (PDF e imagem). */
  resolutionPreset?: OcrResolutionPreset;
  /** Escala ao desenhar o PDF no canvas antes do OCR (só PDF). */
  pdfRenderScale?: number;
  /**
   * Só imagem: amplia até ~este tamanho no maior lado antes do OCR (0 = pixels originais).
   * Não reduz arquivos já maiores que o alvo.
   */
  imageOcrLongEdgePx?: number;
  /** Só gera a imagem de preview; OCR fica a cargo do chamador (carregamento mais rápido). */
  deferOcr?: boolean;
  /** Usa cache em memória por página/escala (evita re-OCR ao voltar na mesma página). */
  useCache?: boolean;
  /** balanced = padrão; high = tenta PSM alternativo se pouco texto (recomendado para extrato). */
  ocrQuality?: OcrPreviewQuality;
  /** Extrato bancário: escala adaptativa conforme tamanho da página (A4 → 2,5K, etc.). */
  adaptiveExtratoScale?: boolean;
};

/** Carregamento OCR otimizado para extratos bancários. */
export const OCR_EXTRATO_LOAD_OPTIONS: LoadParcelamentoPreviewOptions = {
  adaptiveExtratoScale: true,
  deferOcr: true,
  useCache: true,
  ocrQuality: 'high',
};

/** OCR extrato direto na imagem rasterizada (sempre raster/scanner). */
export const OCR_EXTRATO_OCR_OPTIONS: OcrPreviewOptions = {
  quality: 'high',
  useExactPreviewImage: true,
  skipClientPreprocess: true,
  preprocessMode: 'scan',
  forceExtratoRasterOcr: true,
};

/** Na extração (botão Processar): OCR direto na imagem rasterizada da página. */
export const OCR_EXTRATO_EXTRACT_OCR_OPTIONS: OcrPreviewOptions = {
  ...OCR_EXTRATO_OCR_OPTIONS,
  forceExtratoRasterOcr: true,
};

export type PdfPagePreviewResult = {
  previewUrl: string;
  imgWidth: number;
  imgHeight: number;
  items: PosicionadoItem[];
  ocrSource: 'ocr' | 'pdf-text';
  itemCount: number;
  pdfSuggestedScaleFhd: number;
  pdfSuggestedScale4k: number;
  /** Texto integral OCR (extrato BB escaneado). */
  ocrFullText?: string;
};

const pdfPageResultCache = new WeakMap<pdfjsLib.PDFDocumentProxy, Map<string, PdfPagePreviewResult>>();

/** Evita rasterizar/OCR a mesma página em paralelo (prefetch + import). */
const pendingPdfRaster = new WeakMap<
  pdfjsLib.PDFDocumentProxy,
  Map<string, Promise<{ previewUrl: string; imgWidth: number; imgHeight: number; scaleFhd: number; scale4k: number }>>
>();
const pendingPdfPageOcr = new WeakMap<
  pdfjsLib.PDFDocumentProxy,
  Map<string, Promise<PdfPagePreviewResult>>
>();

function pdfPageCacheKey(pageNum: number, scale: number): string {
  return `${pageNum}@${scale.toFixed(3)}`;
}

export function getCachedPdfPagePreview(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNum: number,
  scale: number,
): PdfPagePreviewResult | undefined {
  return pdfPageResultCache.get(pdfDoc)?.get(pdfPageCacheKey(pageNum, scale));
}

export function setCachedPdfPagePreview(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNum: number,
  scale: number,
  data: PdfPagePreviewResult,
): void {
  let map = pdfPageResultCache.get(pdfDoc);
  if (!map) {
    map = new Map();
    pdfPageResultCache.set(pdfDoc, map);
  }
  const key = pdfPageCacheKey(pageNum, scale);
  const prev = map.get(key);
  if (prev && prev.previewUrl !== data.previewUrl && prev.previewUrl.startsWith('blob:')) {
    URL.revokeObjectURL(prev.previewUrl);
  }
  map.set(key, data);
}

export function invalidatePdfPageCacheEntry(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNum: number,
  scale: number,
): void {
  const map = pdfPageResultCache.get(pdfDoc);
  const key = pdfPageCacheKey(pageNum, scale);
  const prev = map?.get(key);
  if (prev?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(prev.previewUrl);
  map?.delete(key);
}

export function clearPdfPagePreviewCache(pdfDoc: pdfjsLib.PDFDocumentProxy): void {
  const map = pdfPageResultCache.get(pdfDoc);
  if (map) {
    for (const entry of map.values()) {
      if (entry.previewUrl.startsWith('blob:')) URL.revokeObjectURL(entry.previewUrl);
    }
    map.clear();
  }
  pdfPageResultCache.delete(pdfDoc);
}

function isPreviewUrlInPdfCache(pdfDoc: pdfjsLib.PDFDocumentProxy, url: string): boolean {
  const map = pdfPageResultCache.get(pdfDoc);
  if (!map) return false;
  for (const entry of map.values()) {
    if (entry.previewUrl === url) return true;
  }
  return false;
}

/** Revoga blob só se não estiver no cache de páginas do PDF. */
export function safeRevokePdfPreviewUrl(
  pdfDoc: pdfjsLib.PDFDocumentProxy | undefined,
  url: string | null | undefined,
): void {
  if (!url?.startsWith('blob:')) return;
  if (pdfDoc && isPreviewUrlInPdfCache(pdfDoc, url)) return;
  URL.revokeObjectURL(url);
}

/** Rasteriza a página, executa OCR se necessário e reutiliza cache ao voltar na mesma página. */
export async function loadPdfPageForMapping(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNum: number,
  pdfRenderScale: number,
  onProgress?: (msg: string) => void,
): Promise<PdfPagePreviewResult> {
  const scale = clampPdfRenderScale(pdfRenderScale);
  const cached = getCachedPdfPagePreview(pdfDoc, pageNum, scale);
  if (cached && cached.itemCount > 0) {
    onProgress?.(`Página ${pageNum} (em cache)…`);
    return cached;
  }

  const preview = await renderPdfPagePreview(pdfDoc, pageNum, onProgress, {
    pdfRenderScale: scale,
    deferOcr: true,
    useCache: true,
  });
  if (preview.itemCount > 0) return preview;
  return completePdfPageOcr(pdfDoc, pageNum, preview.previewUrl, scale, onProgress);
}

/** Todo PDF é tratado como documento escaneado — sem texto embutido, só OCR na imagem. */
export const PDF_SCANNER_OCR_MSG = {
  limpando: 'Preparando página para OCR…',
  limpandoPagina: (page: number) => `Preparando página ${page} para OCR…`,
  abrindo: 'Abrindo PDF (modo scanner)…',
  rasterizando: 'Convertendo página em imagem…',
  ocr: 'OCR na página…',
  ocrPagina: (page: number, total?: number) =>
    total != null && total > 1
      ? `OCR página ${page} de ${total} (DocTR)…`
      : `OCR página ${page} (DocTR)…`,
} as const;

/** Detecta PDF pelo nome e pelo MIME (inclui tipos genéricos comuns no Windows). */
export function fileIsLikelyPdf(file: File): boolean {
  const n = String(file.name ?? '').toLowerCase();
  if (n.endsWith('.pdf')) return true;
  const t = String(file.type ?? '').toLowerCase();
  if (t.includes('pdf')) return true;
  if (t === 'application/octet-stream' && n.endsWith('.pdf')) return true;
  if (t === 'application/x-pdf' || t === 'application/acrobat') return true;
  return false;
}

function computePdfRenderScaleForLongEdge(
  page: pdfjsLib.PDFPageProxy,
  targetLongEdgePx: number
): number {
  const v1 = page.getViewport({ scale: 1 });
  const longEdge = Math.max(v1.width, v1.height);
  if (!(longEdge > 0)) return PDF_RENDER_SCALE_DEFAULT;
  return clampPdfRenderScale(targetLongEdgePx / longEdge);
}

export function resolvePdfRenderScale(
  page: pdfjsLib.PDFPageProxy,
  options?: LoadParcelamentoPreviewOptions
): number {
  if (options?.pdfRenderScale != null) {
    return clampPdfRenderScale(options.pdfRenderScale);
  }
  if (options?.adaptiveExtratoScale !== false) {
    return computeAdaptiveExtratoPdfRenderScale(page);
  }
  if (options?.resolutionPreset) {
    return computePdfRenderScaleForLongEdge(page, longEdgeForOcrPreset(options.resolutionPreset));
  }
  return PDF_RENDER_SCALE_DEFAULT;
}

function resolveImageOcrLongEdge(options?: LoadParcelamentoPreviewOptions): number {
  if (options?.resolutionPreset) {
    return longEdgeForOcrPreset(options.resolutionPreset);
  }
  if (options?.imageOcrLongEdgePx != null) {
    return options.imageOcrLongEdgePx;
  }
  return longEdgeForOcrPreset('fhd');
}

async function bitmapDimensionsFromBlobUrl(
  previewUrl: string
): Promise<{ imgWidth: number; imgHeight: number }> {
  const bmp = await createImageBitmap(await fetch(previewUrl).then((r) => r.blob()));
  const imgWidth = bmp.width;
  const imgHeight = bmp.height;
  bmp.close();
  return { imgWidth, imgHeight };
}

function pdfPageToDataUrl(page: pdfjsLib.PDFPageProxy, scale = PDF_RENDER_SCALE_DEFAULT): Promise<string> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return page.render({ canvasContext: ctx, viewport, canvas }).promise.then(
    () =>
      new Promise((resolve, reject) => {
        canvas.toBlob(
          (b) => {
            if (!b) {
              reject(new Error('Falha ao gerar imagem da página.'));
              return;
            }
            resolve(URL.createObjectURL(b));
          },
          'image/jpeg',
          0.92,
        );
      }),
  );
}

/** Rasteriza página PDF uma vez; reutiliza cache e deduplica chamadas simultâneas. */
async function ensurePdfPageRasterized(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNum: number,
  scale: number,
  onProgress?: (msg: string) => void,
): Promise<{ previewUrl: string; imgWidth: number; imgHeight: number; scaleFhd: number; scale4k: number }> {
  const scaleClamped = clampPdfRenderScale(scale);
  const key = pdfPageCacheKey(pageNum, scaleClamped);
  const cached = getCachedPdfPagePreview(pdfDoc, pageNum, scaleClamped);
  if (cached?.previewUrl) {
    return {
      previewUrl: cached.previewUrl,
      imgWidth: cached.imgWidth,
      imgHeight: cached.imgHeight,
      scaleFhd: cached.pdfSuggestedScaleFhd,
      scale4k: cached.pdfSuggestedScale4k,
    };
  }

  let docMap = pendingPdfRaster.get(pdfDoc);
  if (!docMap) {
    docMap = new Map();
    pendingPdfRaster.set(pdfDoc, docMap);
  }
  const existing = docMap.get(key);
  if (existing) return existing;

  const work = (async () => {
    try {
      onProgress?.(PDF_SCANNER_OCR_MSG.limpandoPagina(pageNum));
      onProgress?.(PDF_SCANNER_OCR_MSG.rasterizando);
      const page = await pdfDoc.getPage(pageNum);
      const scaleFhd = computePdfRenderScaleForLongEdge(page, PDF_RASTER_LONG_EDGE_FHD);
      const scale4k = computePdfRenderScaleForLongEdge(page, PDF_RASTER_LONG_EDGE_4K);
      const previewUrl = await pdfPageToDataUrl(page, scaleClamped);
      const dims = await bitmapDimensionsFromBlobUrl(previewUrl);
      const partial: PdfPagePreviewResult = {
        previewUrl,
        imgWidth: dims.imgWidth,
        imgHeight: dims.imgHeight,
        items: [],
        ocrSource: 'ocr',
        itemCount: 0,
        pdfSuggestedScaleFhd: scaleFhd,
        pdfSuggestedScale4k: scale4k,
      };
      setCachedPdfPagePreview(pdfDoc, pageNum, scaleClamped, partial);
      return {
        previewUrl,
        imgWidth: dims.imgWidth,
        imgHeight: dims.imgHeight,
        scaleFhd,
        scale4k,
      };
    } finally {
      docMap!.delete(key);
    }
  })();
  docMap.set(key, work);
  return work;
}

function ocrWordsToItems(words: OcrPositionedWord[]): PosicionadoItem[] {
  return words.map((w) => ({
    str: w.str,
    x: w.x,
    y: w.y,
    w: w.w,
    h: w.h,
    ...(typeof w.confidence === 'number' ? { confidence: w.confidence } : {}),
  }));
}

async function runAdaptiveOcrWords(
  ocrFile: File,
  onProgress?: (msg: string) => void,
  options?: { prepMode?: OcrPreprocessMode; quality?: OcrPreviewQuality },
): Promise<{ words: OcrPositionedWord[]; fullText: string }> {
  const prepMode = options?.prepMode ?? 'scan';
  onProgress?.('OCR na imagem (DocTR)…');
  // DocTR: uma passagem basta.
  return runOcrPortugueseWordsResult(ocrFile, (_f, m) => onProgress?.(m), {
    preprocess: false,
    preprocessMode: prepMode,
  });
}

export type OcrPreviewQuality = 'fast' | 'balanced' | 'high';

export type OcrPreviewOptions = {
  /** Limita pixels da imagem enviada ao DocTR (quality=fast). */
  ocrMaxLongEdge?: number;
  /** fast = downscale leve; balanced = resolução completa. */
  quality?: OcrPreviewQuality;
  /** Usa exatamente a foto/preview, sem redimensionar no cliente. */
  useExactPreviewImage?: boolean;
  /** Pula preprocessForOcr no browser — DocTR já trata a imagem (mais rápido). */
  skipClientPreprocess?: boolean;
  preprocessMode?: OcrPreprocessMode;
  /** Extrato: na extração, ignora texto nativo e usa OCR direto na imagem rasterizada. */
  forceExtratoRasterOcr?: boolean;
};

/** Reexecuta OCR na imagem exibida (botão “Ler OCR novamente”). */
export async function refreshOcrItemsFromPreviewUrl(
  previewUrl: string,
  onProgress?: (msg: string) => void,
  options?: OcrPreviewOptions,
): Promise<{
  items: PosicionadoItem[];
  imgWidth: number;
  imgHeight: number;
  itemCount: number;
  previewUrl?: string;
  ocrFullText?: string;
}> {
  const r = await itemsFromPreviewUrl(previewUrl, onProgress, options);
  return { ...r, itemCount: r.items.length };
}

/** OCR na imagem exibida. Se a imagem for minúscula, amplia e devolve novo previewUrl. */
async function itemsFromPreviewUrl(
  previewUrl: string,
  onProgress?: (msg: string) => void,
  options?: OcrPreviewOptions,
): Promise<{
  items: PosicionadoItem[];
  imgWidth: number;
  imgHeight: number;
  ocrSource: 'ocr' | 'pdf-text';
  previewUrl?: string;
  ocrFullText?: string;
}> {
  let blob = await fetch(previewUrl).then((r) => r.blob());
  let bmp = await createImageBitmap(blob);
  const displayWidth = bmp.width;
  const displayHeight = bmp.height;
  let imgWidth = displayWidth;
  let imgHeight = displayHeight;
  let previewUrlOut: string | undefined;
  const long0 = Math.max(imgWidth, imgHeight);
  const quality = options?.quality ?? 'balanced';
  const useExactPreviewImage = options?.useExactPreviewImage === true;
  const maxOcrEdge =
    quality === 'fast' ? (options?.ocrMaxLongEdge ?? IMAGE_OCR_LONG_EDGE_FHD) : undefined;
  if (!useExactPreviewImage && maxOcrEdge != null && long0 > maxOcrEdge) {
    const scale = maxOcrEdge / long0;
    const nw = Math.max(1, Math.round(imgWidth * scale));
    const nh = Math.max(1, Math.round(imgHeight * scale));
    onProgress?.('Reduzindo imagem para OCR rápido…');
    const canvas = document.createElement('canvas');
    canvas.width = nw;
    canvas.height = nh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, 0, nw, nh);
      bmp.close();
      blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Falha ao redimensionar imagem para OCR.'))),
          'image/png',
        );
      });
      bmp = await createImageBitmap(blob);
      imgWidth = bmp.width;
      imgHeight = bmp.height;
    }
  }
  const longAfterCap = Math.max(imgWidth, imgHeight);
  if (!useExactPreviewImage && longAfterCap > 0 && longAfterCap < OCR_SKIP_AUTO_UPSCALE_LONG_EDGE) {
    const scale = OCR_SMALL_IMAGE_UPSCALE_TARGET / longAfterCap;
    const nw = Math.max(1, Math.round(imgWidth * scale));
    const nh = Math.max(1, Math.round(imgHeight * scale));
    onProgress?.('Ampliando imagem pequena para OCR…');
    const canvas = document.createElement('canvas');
    canvas.width = nw;
    canvas.height = nh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, 0, nw, nh);
      bmp.close();
      blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Falha ao ampliar imagem.'))),
          'image/png'
        );
      });
      previewUrlOut = URL.createObjectURL(blob);
      bmp = await createImageBitmap(blob);
      imgWidth = bmp.width;
      imgHeight = bmp.height;
    } else {
      bmp.close();
    }
  } else {
    bmp.close();
  }
  const skipPre = options?.skipClientPreprocess === true;
  let ocrFile: File;
  if (skipPre) {
    ocrFile = await prepareOcrUploadFile(blob);
  } else {
    onProgress?.('Preparando imagem…');
    const prep = await preprocessForOcr(blob, options?.preprocessMode ?? 'scan');
    ocrFile = new File([prep], 'preview.png', { type: 'image/png' });
  }
  const ocrResult = await runAdaptiveOcrWords(ocrFile, onProgress, {
    prepMode: options?.preprocessMode ?? 'scan',
    quality,
  });
  let rawItems = ocrWordsToItems(ocrResult.words);
  if (options?.forceExtratoRasterOcr) {
    rawItems = prepararItensOcrParaExtrato(rawItems);
  }
  let items = refinarItensOcr(rawItems);
  items = await refineOcrPosicionadoItems(
    items,
    options?.forceExtratoRasterOcr ? 'extrato' : 'parcelamento',
    onProgress,
  );
  if (items.length < 6) {
    notifyOcrIssue('few_items', `${items.length} trechos na página`);
  }
  /** Preview ampliado: coordenadas ficam no bitmap exibido (não no displayWidth original). */
  const previewIsUpscaled = previewUrlOut != null;
  const outW = previewIsUpscaled ? imgWidth : displayWidth;
  const outH = previewIsUpscaled ? imgHeight : displayHeight;
  if (!previewIsUpscaled && (displayWidth !== imgWidth || displayHeight !== imgHeight)) {
    const sx = displayWidth / imgWidth;
    const sy = displayHeight / imgHeight;
    items = items.map((it) => ({
      ...it,
      x: it.x * sx,
      y: it.y * sy,
      w: Math.max(1, it.w * sx),
      h: Math.max(1, it.h * sy),
    }));
  }
  return {
    items,
    imgWidth: outW,
    imgHeight: outH,
    ocrSource: 'ocr',
    previewUrl: previewUrlOut,
    ocrFullText: ocrResult.fullText,
  };
}

/**
 * OCR na mesma imagem do preview do PDF.
 * `imgWidth`/`imgHeight` vêm do bitmap do preview (como em `itemsFromPreviewUrl`), para coincidir com as
 * coordenadas dos itens — não usar o viewport do PDF em paralelo (arredondamentos podem dessincronizar faixa/cliques).
 */
async function itemsFromPdfPage(
  page: pdfjsLib.PDFPageProxy,
  previewUrl: string,
  onProgress?: (msg: string) => void,
  pdfRenderScale = PDF_RENDER_SCALE_DEFAULT,
  ocrOptions?: OcrPreviewOptions,
): Promise<{
  items: PosicionadoItem[];
  imgWidth: number;
  imgHeight: number;
  ocrSource: 'ocr' | 'pdf-text';
  previewUrl?: string;
  ocrFullText?: string;
}> {
  const scale = clampPdfRenderScale(pdfRenderScale);
  onProgress?.(PDF_SCANNER_OCR_MSG.ocr);
  const ocr = await itemsFromPreviewUrl(previewUrl, onProgress, {
    ...ocrOptions,
    forceExtratoRasterOcr: true,
  });
  return { ...ocr, ocrSource: 'ocr' as const };
}

/** Junta fragmentos na mesma linha e descarta ruído. */
export function refinarItensOcr(items: PosicionadoItem[]): PosicionadoItem[] {
  const filtrados = items.filter((it) => {
    const s = normalizeOcrTexto(it.str);
    return s.length > 0 && it.w >= 2 && it.h >= 4;
  });
  const linhas = clusterLinhas(filtrados);
  const merged: PosicionadoItem[] = [];
  for (const row of linhas) {
    merged.push(...mesclarItensNaLinha(row));
  }
  return merged;
}

function ocrTokensFormamValorQuebrado(a: string, b: string): boolean {
  const sa = normalizeOcrTexto(a).replace(/\s/g, '');
  const sb = normalizeOcrTexto(b).replace(/\s/g, '');
  if (/^\d{1,3}(?:\.\d{3})+$/.test(sa) && /^,\d{1,2}$/.test(sb)) return true;
  if (/^\d{2,11}$/.test(sa) && /^,\d{1,2}$/.test(sb)) return true;
  if (/^[-−]?\d{1,4}$/.test(sa) && /^[1-9]?\d,\d{2}$/.test(sb)) return true;
  if (/^[-−]?\d{2,5}$/.test(sa) && /^,\d{2}$/.test(sb)) return true;
  if (/^[-−(]?$/.test(sa) && /^\d/.test(sb)) return true;
  return false;
}

function mesclarItensNaLinha(row: PosicionadoItem[]): PosicionadoItem[] {
  if (row.length === 0) return [];
  const sorted = [...row].sort((a, b) => a.x - b.x);
  const out: PosicionadoItem[] = [];
  let cur = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const it = sorted[i];
    const gap = it.x - (cur.x + cur.w);
    const mergeGap = ocrTokensFormamValorQuebrado(cur.str, it.str)
      ? Math.max(48, cur.h * 2.5)
      : Math.max(6, cur.h * 0.45);
    if (gap <= mergeGap) {
      cur.str = colapsarRepeticaoAdjacenteOcr(`${cur.str} ${it.str}`.trim());
      const right = Math.max(cur.x + cur.w, it.x + it.w);
      cur.w = right - cur.x;
      cur.h = Math.max(cur.h, it.h);
    } else {
      out.push(cur);
      cur = { ...it };
    }
  }
  cur.str = colapsarRepeticaoAdjacenteOcr(cur.str);
  out.push(cur);
  return out;
}

export async function loadDocumentoParcelamentoPreview(
  file: File,
  onProgress?: (msg: string) => void,
  options?: LoadParcelamentoPreviewOptions
): Promise<DocumentoParcelamentoPreview> {
  const isPdf = fileIsLikelyPdf(file);

  if (isPdf) {
    onProgress?.(PDF_SCANNER_OCR_MSG.limpando);
    onProgress?.(PDF_SCANNER_OCR_MSG.abrindo);
    const buf = await file.arrayBuffer();
    const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
    const page = await pdfDoc.getPage(1);
    const pdfSuggestedScaleFhd = computePdfRenderScaleForLongEdge(page, PDF_RASTER_LONG_EDGE_FHD);
    const pdfSuggestedScale4k = computePdfRenderScaleForLongEdge(page, PDF_RASTER_LONG_EDGE_4K);
    const pdfScale = resolvePdfRenderScale(page, options);
    onProgress?.(PDF_SCANNER_OCR_MSG.rasterizando);
    let previewUrl = await pdfPageToDataUrl(page, pdfScale);
    if (options?.deferOcr) {
      const dims = await bitmapDimensionsFromBlobUrl(previewUrl);
      return {
        previewUrl,
        imgWidth: dims.imgWidth,
        imgHeight: dims.imgHeight,
        items: [],
        isPdf: true,
        pdfDoc,
        totalPages: pdfDoc.numPages,
        ocrSource: 'ocr',
        itemCount: 0,
        pdfSuggestedScaleFhd,
        pdfSuggestedScale4k,
        pdfRenderScale: pdfScale,
      };
    }
    const ocrPdf = await itemsFromPdfPage(page, previewUrl, onProgress, pdfScale, {
      quality: options?.ocrQuality ?? 'balanced',
    });
    if (ocrPdf.previewUrl) {
      if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
      previewUrl = ocrPdf.previewUrl;
    }
    return {
      previewUrl,
      imgWidth: ocrPdf.imgWidth,
      imgHeight: ocrPdf.imgHeight,
      items: ocrPdf.items,
      isPdf: true,
      pdfDoc,
      totalPages: pdfDoc.numPages,
      ocrSource: ocrPdf.ocrSource,
      itemCount: ocrPdf.items.length,
      pdfSuggestedScaleFhd,
      pdfSuggestedScale4k,
      pdfRenderScale: pdfScale,
      ocrFullText: ocrPdf.ocrFullText,
    };
  }

  onProgress?.('Carregando imagem…');
  const targetLong = resolveImageOcrLongEdge(options);
  let { previewUrl, imgWidth, imgHeight } = await imageFileToParcelamentoOcrPreview(
    file,
    targetLong,
    onProgress
  );
  if (options?.deferOcr) {
    return {
      previewUrl,
      imgWidth,
      imgHeight,
      items: [],
      isPdf: false,
      totalPages: 1,
      ocrSource: 'ocr',
      itemCount: 0,
    };
  }
  const ocr = await itemsFromPreviewUrl(previewUrl, onProgress);
  if (ocr.previewUrl) {
    if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    previewUrl = ocr.previewUrl;
    imgWidth = ocr.imgWidth;
    imgHeight = ocr.imgHeight;
  }

  return {
    previewUrl,
    imgWidth: ocr.imgWidth,
    imgHeight: ocr.imgHeight,
    items: ocr.items,
    isPdf: false,
    totalPages: 1,
    ocrSource: ocr.ocrSource,
    itemCount: ocr.items.length,
    ocrFullText: ocr.ocrFullText,
  };
}

/** Ajusta mapeamento se a imagem na tela tiver escala diferente da usada no OCR. */
export function scaleParcelamentoMapping(
  mapping: ParcelamentoColunasMapping,
  fromW: number,
  fromH: number,
  toW: number,
  toH: number
): ParcelamentoColunasMapping {
  if (fromW <= 0 || fromH <= 0 || (fromW === toW && fromH === toH)) return mapping;
  const sx = toW / fromW;
  const sy = toH / fromH;
  return {
    columns: mapping.columns.map((c) => ({
      ...c,
      start: c.start * sx,
      end: c.end * sx,
    })),
    faixa: mapping.faixa
      ? {
        startY: mapping.faixa.startY * sy,
        endY: mapping.faixa.endY * sy,
      }
      : undefined,
  };
}

export async function renderPdfPagePreview(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNum: number,
  onProgress?: (msg: string) => void,
  options?: LoadParcelamentoPreviewOptions
): Promise<PdfPagePreviewResult> {
  const page = await pdfDoc.getPage(pageNum);
  const scaleFhd = computePdfRenderScaleForLongEdge(page, PDF_RASTER_LONG_EDGE_FHD);
  const scale4k = computePdfRenderScaleForLongEdge(page, PDF_RASTER_LONG_EDGE_4K);
  const scale = resolvePdfRenderScale(page, options);
  const useCache = options?.useCache !== false;

  if (useCache) {
    const cached = getCachedPdfPagePreview(pdfDoc, pageNum, scale);
    if (cached) {
      if (!options?.deferOcr || cached.itemCount > 0) {
        onProgress?.(`Página ${pageNum} (em cache)…`);
        return cached;
      }
      if (cached.previewUrl) {
        onProgress?.(`Página ${pageNum} (imagem em cache)…`);
        return {
          ...cached,
          items: [],
          itemCount: 0,
          ocrFullText: undefined,
        };
      }
    }
  }

  const raster = await ensurePdfPageRasterized(pdfDoc, pageNum, scale, onProgress);
  if (options?.deferOcr) {
    return {
      previewUrl: raster.previewUrl,
      imgWidth: raster.imgWidth,
      imgHeight: raster.imgHeight,
      items: [],
      ocrSource: 'ocr',
      itemCount: 0,
      pdfSuggestedScaleFhd: raster.scaleFhd,
      pdfSuggestedScale4k: raster.scale4k,
    };
  }
  const pageData = await itemsFromPdfPage(page, raster.previewUrl, onProgress, scale);
  const result: PdfPagePreviewResult = {
    previewUrl: pageData.previewUrl ?? raster.previewUrl,
    imgWidth: pageData.imgWidth,
    imgHeight: pageData.imgHeight,
    items: pageData.items,
    ocrSource: pageData.ocrSource,
    itemCount: pageData.items.length,
    pdfSuggestedScaleFhd: raster.scaleFhd,
    pdfSuggestedScale4k: raster.scale4k,
    ocrFullText: pageData.ocrFullText,
  };
  if (useCache) setCachedPdfPagePreview(pdfDoc, pageNum, scale, result);
  return result;
}

export const PDF_PAGE_OCR_TIMEOUT_MS = 300_000;

/** Tokens mínimos por página para considerar OCR de extrato aceitável. */
export const EXTRATO_OCR_MIN_ITEMS_PER_PAGE = 6;

/** Pontua qualidade do OCR para extrato: prioriza valores monetários de lançamento. */
export function scoreExtratoOcrPageResult(result: PdfPagePreviewResult): number {
  const items = result.items ?? [];
  if (items.length === 0) return 0;
  const imgWidth = result.imgWidth || 1;
  const valorMinX = imgWidth * 0.42;
  let valoresLanc = 0;
  let datas = 0;
  for (const it of items) {
    const s = String(it.str ?? '').trim();
    if (!s) continue;
    const moedas = extrairMoedasDoTexto(s).filter((v) => v > 0.01 && v < 50_000_000);
    if (moedas.length > 0) {
      const cx = it.x + it.w / 2;
      if (cx >= valorMinX) valoresLanc += moedas.length;
      else valoresLanc += 0.25;
    }
    if (/\d{1,2}\s*[/.-]\s*\d{1,2}(?:\s*[/.-]\s*\d{2,4})?/.test(s)) datas += 1;
  }
  return valoresLanc * 12 + datas * 2 + items.length * 0.02;
}

/** Cadeia de escalas: primária → adaptativa → FHD (tenta a que ler mais tokens). */
export function buildExtratoOcrScaleFallbackChain(
  page: pdfjsLib.PDFPageProxy,
  primaryScale: number,
): number[] {
  const primary = clampPdfRenderScale(primaryScale);
  const adaptive = computeAdaptiveExtratoPdfRenderScale(page);
  const k25 = computePdfRenderScaleForLongEdge(page, IMAGE_OCR_LONG_EDGE_2K5);
  const k4 = computePdfRenderScaleForLongEdge(page, PDF_RASTER_LONG_EDGE_4K);
  const fhd = computePdfRenderScaleForLongEdge(page, PDF_RASTER_LONG_EDGE_FHD);
  const out: number[] = [];
  // Prioriza escalas rápidas e estáveis; 4K fica como último recurso.
  for (const s of [primary, adaptive, k25, fhd, k4]) {
    const clamped = clampPdfRenderScale(s);
    if (out.some((x) => Math.abs(x - clamped) <= 0.05)) continue;
    out.push(clamped);
  }
  return out;
}

/**
 * OCR de extrato com fallback para escala menor quando a escala alta retorna pouco texto.
 * Extratos Itaú costumam piorar acima de ~2,5K/FHD no DocTR.
 */
export async function completePdfPageOcrWithExtratoScaleFallback(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNum: number,
  primaryScale: number,
  onProgress?: (msg: string) => void,
  ocrOptions?: OcrPreviewOptions,
  loadOptions?: LoadParcelamentoPreviewOptions,
): Promise<PdfPagePreviewResult> {
  const page = await pdfDoc.getPage(pageNum);
  const scales = buildExtratoOcrScaleFallbackChain(page, primaryScale);
  let best: PdfPagePreviewResult | null = null;

  for (let i = 0; i < scales.length; i++) {
    const scale = scales[i];
    if (i > 0) {
      onProgress?.(
        `Pouco texto na escala ${scales[0]!.toFixed(1)} — página ${pageNum} em escala ${scale.toFixed(1)}…`,
      );
      invalidatePdfPageCacheEntry(pdfDoc, pageNum, scale);
    } else {
      invalidatePdfPageCacheEntry(pdfDoc, pageNum, scale);
    }
    const preview = await renderPdfPagePreview(pdfDoc, pageNum, onProgress, {
      ...loadOptions,
      pdfRenderScale: scale,
      adaptiveExtratoScale: false,
      deferOcr: false,
      useCache: false,
    });
    const result = await completePdfPageOcr(
      pdfDoc,
      pageNum,
      preview.previewUrl,
      scale,
      onProgress,
      ocrOptions,
    );
    const score = scoreExtratoOcrPageResult(result);
    const bestScore = best ? scoreExtratoOcrPageResult(best) : -1;
    if (!best || score > bestScore) best = result;

    const goodEnough =
      result.itemCount >= EXTRATO_OCR_MIN_ITEMS_PER_PAGE &&
      (score >= 120 || result.itemCount >= 28);
    if (goodEnough) break;
  }

  return best!;
}

/** Executa OCR na página já rasterizada e grava no cache (reutilizado ao trocar de página). */
export async function completePdfPageOcr(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNum: number,
  previewUrl: string,
  pdfRenderScale: number,
  onProgress?: (msg: string) => void,
  ocrOptions?: OcrPreviewOptions,
): Promise<PdfPagePreviewResult> {
  const scale = clampPdfRenderScale(pdfRenderScale);
  const key = pdfPageCacheKey(pageNum, scale);
  const cached = getCachedPdfPagePreview(pdfDoc, pageNum, scale);
  if (cached && cached.itemCount > 0) return cached;

  let docMap = pendingPdfPageOcr.get(pdfDoc);
  if (!docMap) {
    docMap = new Map();
    pendingPdfPageOcr.set(pdfDoc, docMap);
  }
  const existing = docMap.get(key);
  if (existing) return existing;

  const work = (async () => {
    try {
      onProgress?.(PDF_SCANNER_OCR_MSG.limpando);
      const page = await pdfDoc.getPage(pageNum);
      const scaleFhd = computePdfRenderScaleForLongEdge(page, PDF_RASTER_LONG_EDGE_FHD);
      const scale4k = computePdfRenderScaleForLongEdge(page, PDF_RASTER_LONG_EDGE_4K);
      let rasterUrl = previewUrl;
      if (!rasterUrl) {
        const raster = await ensurePdfPageRasterized(pdfDoc, pageNum, scale, onProgress);
        rasterUrl = raster.previewUrl;
      }
      const { promiseWithTimeout } = await import('./promiseTimeout');
      const pageData = await promiseWithTimeout(
        itemsFromPdfPage(page, rasterUrl, onProgress, scale, ocrOptions),
        PDF_PAGE_OCR_TIMEOUT_MS,
        `OCR da página ${pageNum} excedeu o tempo limite (${Math.round(PDF_PAGE_OCR_TIMEOUT_MS / 1000)}s). Reduza a escala do PDF ou abra a página no visualizador antes de importar.`,
      );
      const result: PdfPagePreviewResult = {
        previewUrl: pageData.previewUrl ?? rasterUrl,
        imgWidth: pageData.imgWidth,
        imgHeight: pageData.imgHeight,
        items: pageData.items,
        ocrSource: pageData.ocrSource,
        itemCount: pageData.items.length,
        pdfSuggestedScaleFhd: scaleFhd,
        pdfSuggestedScale4k: scale4k,
        ocrFullText: pageData.ocrFullText,
      };
      setCachedPdfPagePreview(pdfDoc, pageNum, scale, result);
      return result;
    } finally {
      docMap!.delete(key);
    }
  })();
  docMap.set(key, work);
  return work;
}

function clusterLinhas(items: PosicionadoItem[], yTol?: number): PosicionadoItem[][] {
  if (items.length === 0) return [];
  const heights = items.map((i) => i.h).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 12;
  const tol = yTol ?? Math.max(8, medianH * 0.55);

  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: PosicionadoItem[][] = [];
  for (const it of sorted) {
    const cy = it.y + it.h / 2;
    let row = rows.find((r) => Math.abs(r[0].y + r[0].h / 2 - cy) <= tol);
    if (!row) {
      rows.push([it]);
    } else {
      row.push(it);
    }
  }
  for (const r of rows) r.sort((a, b) => a.x - b.x);
  return rows;
}

const RE_MOEDA =
  /(?:[Rr]\$?\s*)?-?\d{1,3}(?:\.\d{3})*(?:,\s*\d{2}|\s*,\s*\d{2})|-?\d{1,11}\s*,\s*\d{2}|-?\d+(?:,\s*|\s*,\s*)\d{2}|-?\d+\.\d{2}/g;
const RE_DATA_COMPLETA = /^\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}$/;
const RE_DATA = /\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}/;

/** Se o OCR fundiu duas linhas da tabela, divide onde há mais de uma data completa na mesma faixa Y. */
function splitLinhaSeVariasDatas(row: PosicionadoItem[]): PosicionadoItem[][] {
  if (row.length < 4) return [row];
  const sorted = [...row].sort((a, b) => a.x - b.x);
  const dataCenters = sorted.filter((it) =>
    RE_DATA_COMPLETA.test(normalizeOcrTexto(it.str.replace(/\s+/g, ' ').trim()))
  );
  if (dataCenters.length < 2) return [row];
  const boundaries: number[] = [];
  for (let i = 0; i < dataCenters.length - 1; i++) {
    const a = dataCenters[i];
    const b = dataCenters[i + 1];
    boundaries.push((a.x + a.w + b.x) / 2);
  }
  const parts: PosicionadoItem[][] = Array.from({ length: dataCenters.length }, () => []);
  for (const it of sorted) {
    const cx = it.x + it.w / 2;
    let slot = 0;
    for (let bi = 0; bi < boundaries.length; bi++) {
      if (cx >= boundaries[bi]) slot = bi + 1;
    }
    parts[slot].push(it);
  }
  return parts.filter((p) => p.length > 0);
}

function expandClustersComMultiplasDatas(clusters: PosicionadoItem[][]): PosicionadoItem[][] {
  const out: PosicionadoItem[][] = [];
  for (const row of clusters) {
    out.push(...splitLinhaSeVariasDatas(row));
  }
  return out;
}

// Exige ao menos um ponto: reduzido (1889) e nível (5) não podem disparar divisão de linha.
const RE_PLANO_CLASSIFICACAO_TOKEN = /^\d+(?:\.\d+){1,6}(?:\.\d{2,5})?$/;

/** Remove coluna marcador «1» à esquerda (relatório Domínio / A Econômica). */
function filtrarMarcadorMargemPlanoDominio(row: PosicionadoItem[]): PosicionadoItem[] {
  if (row.length < 2) return row;
  const sorted = [...row].sort((a, b) => a.x - b.x);
  const first = sorted[0]!;
  if (first.str.trim() === '1' && first.x < 16) {
    const hasData = sorted.some((it) => it !== first && it.x > 18);
    if (hasData) return sorted.slice(1);
  }
  return row;
}

/** Divide faixa Y quando o OCR fundiu duas contas na mesma linha física. */
function splitPlanoLinhaSeVariasContas(row: PosicionadoItem[]): PosicionadoItem[][] {
  if (row.length < 5) return [row];
  const sorted = [...row].sort((a, b) => a.x - b.x);
  const classItems = sorted.filter((it) => {
    const t = it.str.trim().replace(/\s/g, '');
    return RE_PLANO_CLASSIFICACAO_TOKEN.test(t);
  });
  if (classItems.length < 2) return [row];

  const boundaries: number[] = [];
  for (let i = 0; i < classItems.length - 1; i++) {
    const a = classItems[i]!;
    const b = classItems[i + 1]!;
    if (b.x - (a.x + a.w) > 16) {
      boundaries.push((a.x + a.w + b.x) / 2);
    }
  }
  if (boundaries.length === 0) return [row];

  const parts: PosicionadoItem[][] = Array.from({ length: boundaries.length + 1 }, () => []);
  for (const it of sorted) {
    const cx = it.x + it.w / 2;
    let slot = 0;
    for (let bi = 0; bi < boundaries.length; bi++) {
      if (cx >= boundaries[bi]!) slot = bi + 1;
    }
    parts[slot]!.push(it);
  }
  return parts.filter((p) => p.length > 0);
}

function linhaOcrTextoFromCluster(row: PosicionadoItem[]): string {
  return row
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((i) => i.str)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function linhaEhMetadadoPlano(rowIn: PosicionadoItem[]): boolean {
  const texto = linhaOcrTextoFromCluster(rowIn).toLowerCase();
  if (!texto) return true;
  if (/sistema\s+licenciado|inov\s+consultoria/i.test(texto)) return true;
  if (/^c[oó]digo\s+t\s+classifica|^nome\s+grau$/i.test(texto.replace(/\s+/g, ' '))) return true;
  if (/c\.?\s*n\.?\s*p\.?\s*j|empresa\s*:|folha\s*:|plano\s+de\s+contas/.test(texto)) {
    if (!/\d+\.\d+/.test(texto)) return true;
  }
  return false;
}

/** Plano de contas: uma linha física do PDF = uma conta (tolerância Y mais apertada). */
function clusterPlanoLinhasFisicas(items: PosicionadoItem[]): PosicionadoItem[][] {
  if (items.length === 0) return [];
  const heights = items.map((i) => i.h).filter((h) => h > 0).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 12;
  const yTol = Math.max(3, medianH * 0.32);
  const physicalLines = splitClusterPorLinhasY(items, yTol);
  const out: PosicionadoItem[][] = [];
  for (const line of physicalLines) {
    for (const part of splitPlanoLinhaSeVariasContas(line)) {
      if (part.length > 0) out.push(part);
    }
  }
  return out;
}

function dedupeLinhasParcelas(linhas: ParcelaPlanilhaRow[]): ParcelaPlanilhaRow[] {
  const best = new Map<string, ParcelaPlanilhaRow>();
  const score = (x: ParcelaPlanilhaRow) =>
    (x.juros ?? 0) + (x.multa ?? 0) + (x.encargos ?? 0) + (x.honorarios ?? 0);
  for (const r of linhas) {
    const k = `${r.date.getTime()}_${Math.round(r.valor * 100)}`;
    const prev = best.get(k);
    if (!prev || score(r) >= score(prev)) best.set(k, { ...r });
  }
  return [...best.values()].sort((a, b) => a.date.getTime() - b.date.getTime() || a.n - b.n);
}

function renumerarParcelas1aN(linhas: ParcelaPlanilhaRow[]): ParcelaPlanilhaRow[] {
  return linhas.map((r, i) => ({ ...r, n: i + 1 }));
}

/** Tolerância horizontal mínima (OCR desloca poucos px). */
function padColunaOcr(imgWidth: number): number {
  return Math.min(14, Math.max(4, imgWidth * 0.008));
}

/** Fração da largura do trecho OCR que cai dentro da faixa da coluna (0–1). */
function fracSobreposicaoColuna(
  it: PosicionadoItem,
  col: ParcelamentoColunaDef,
  pad: number
): number {
  const colLeft = col.start - pad;
  const colRight = col.end + pad;
  const overlap = Math.min(it.x + it.w, colRight) - Math.max(it.x, colLeft);
  if (overlap <= 0) return 0;
  return overlap / Math.max(it.w, 1);
}

/**
 * Trecho na coluna: boa sobreposição OU centro dentro.
 * Números alinhados à direita (305,43) têm centro à esquerda do «5,00» da coluna vizinha —
 * escolher “mais à direita” pegava o valor errado.
 */
function itemNaColuna(it: PosicionadoItem, col: ParcelamentoColunaDef, pad: number): boolean {
  if (fracSobreposicaoColuna(it, col, pad) >= 0.38) return true;
  const cx = it.x + it.w / 2;
  return cx >= col.start - pad && cx <= col.end + pad;
}

const IDS_IGNORAR: ParcelamentoColunaCampo[] = ['ignorar1', 'ignorar2', 'ignorar3'];

function defsColunasIgnorar(
  colMap: Partial<Record<ParcelamentoColunaCampo, ParcelamentoColunaDef>>
): ParcelamentoColunaDef[] {
  return IDS_IGNORAR.map((id) => colMap[id]).filter(
    (c): c is ParcelamentoColunaDef => !!c && c.start !== c.end
  );
}

/** Remove da linha fragmentos que caem em colunas “Ignorar” (ex.: Saldo, observações). */
function aplicarIgnorarColunas(
  row: PosicionadoItem[],
  colMap: Partial<Record<ParcelamentoColunaCampo, ParcelamentoColunaDef>>,
  imgWidth: number
): PosicionadoItem[] {
  const ign = defsColunasIgnorar(colMap);
  if (ign.length === 0) return row;
  const pad = padColunaOcr(imgWidth);
  return row.filter((it) => !ign.some((ig) => itemNaColuna(it, ig, pad)));
}

function itensNaColuna(
  row: PosicionadoItem[],
  col: ParcelamentoColunaDef,
  imgWidth: number
): PosicionadoItem[] {
  const pad = padColunaOcr(imgWidth);
  // Filtrar items que estão claramente na coluna
  const inCol = row.filter((it) => {
    const fracOverlap = fracSobreposicaoColuna(it, col, pad);
    if (fracOverlap >= 0.45) return true; // Boa sobreposição

    const cx = it.x + it.w / 2;
    // Centro deve estar dentro da coluna (não na margem)
    if (cx >= col.start + pad && cx <= col.end - pad) return true;

    return false;
  }).sort((a, b) => a.x - b.x);

  return inCol;
}

function textoNaColuna(row: PosicionadoItem[], col: ParcelamentoColunaDef, imgWidth: number): string {
  const items = itensNaColuna(row, col, imgWidth);
  if (items.length === 0) {
    // Fallback: usar filtro mais permissivo apenas se não encontrou nada
    const pad = padColunaOcr(imgWidth);
    const fallback = row.filter((it) => itemNaColuna(it, col, pad)).sort((a, b) => a.x - b.x);
    return prepararTextoOcrParaMoeda(fallback.map((it) => it.str).join(' '));
  }
  return prepararTextoOcrParaMoeda(items.map((it) => it.str).join(' '));
}

/**
 * Valor na coluna: trecho com maior sobreposição na faixa (não o mais à direita na linha).
 * Desempate: valor monetário maior (Principal costuma ser o maior da linha).
 * Agora evita valores que já foram usados em outras colunas.
 */
function moedaNaColuna(
  row: PosicionadoItem[],
  col: ParcelamentoColunaDef,
  imgWidth: number,
  excludeValues: Set<number> = new Set()
): number {
  const pad = padColunaOcr(imgWidth);
  const scored = row
    .map((it) => ({
      it,
      frac: fracSobreposicaoColuna(it, col, pad),
      v: parseMoedaPtFromOcrColuna(it.str),
    }))
    .filter(({ v, frac, it }) => {
      if (!(v > 0)) return false;
      const rounded = Math.round(v * 100) / 100;
      if (excludeValues.has(rounded)) return false;
      return frac >= 0.38 || itemNaColuna(it, col, pad);
    });

  let melhorV = 0;
  let melhorFrac = 0;
  for (const { frac, v } of scored) {
    if (frac > melhorFrac + 0.05 || (Math.abs(frac - melhorFrac) <= 0.05 && v > melhorV)) {
      melhorV = v;
      melhorFrac = frac;
    }
  }

  if (melhorV > 0) return melhorV;

  const inCol = itensNaColuna(row, col, imgWidth);
  const joined = parseMoedaPtFromOcrColuna(inCol.map((it) => it.str).join(' '));
  if (joined > 0) {
    const rounded = Math.round(joined * 100) / 100;
    if (!excludeValues.has(rounded)) return joined;
  }

  return 0;
}

function textoNasColunasMapeadas(
  row: PosicionadoItem[],
  colMap: Partial<Record<ParcelamentoColunaCampo, ParcelamentoColunaDef>>,
  imgWidth: number
): string {
  const partes: string[] = [];
  for (const id of IDS_COLUNAS_DADOS) {
    if (!colunaEstaMapeada(colMap, id)) continue;
    const t = textoColuna(row, colMap, id, imgWidth);
    if (t.trim()) partes.push(t);
  }
  return partes.join(' ');
}

function digitosAntesDaVirgulaDecimal(s: string): number {
  const i = s.lastIndexOf(',');
  if (i < 0) return 999;
  return s.slice(0, i).replace(/\D/g, '').length;
}

function extrairMoedasDoTexto(texto: string): number[] {
  const norm = prepararTextoOcrParaMoeda(texto);
  const matches = norm.match(RE_MOEDA) ?? [];
  const merged: number[] = [];
  for (const m of matches) {
    const v = parseMoedaPt(m);
    if (!(v > 0) || v > PARCELAMENTO_MOEDA_PLAUSIVEL_MAX) continue;
    if (digitosAntesDaVirgulaDecimal(m) > PARCELAMENTO_MOEDA_DIGITOS_INTEIROS_MAX) continue;
    merged.push(v);
  }
  const fromBlob = parseMoedaPtFromOcrBlob(norm);
  if (fromBlob > 0 && !merged.some((v) => Math.abs(v - fromBlob) < 0.005)) merged.push(fromBlob);
  return merged;
}

function parseDataNaLinha(
  rowIn: PosicionadoItem[],
  colMap: Partial<Record<ParcelamentoColunaCampo, ParcelamentoColunaDef>>,
  imgWidth: number
): Date | null {
  const row = aplicarIgnorarColunas(rowIn, colMap, imgWidth);
  const venc = colMap.vencimento;
  if (!venc || venc.start === venc.end) return null;
  const t = textoNaColuna(row, venc, imgWidth);
  const m = t.match(RE_DATA);
  if (!m) return null;
  return parseDataFlexivel(m[0]);
}

function parseNumeroNaLinha(
  rowIn: PosicionadoItem[],
  colMap: Partial<Record<ParcelamentoColunaCampo, ParcelamentoColunaDef>>,
  imgWidth: number
): number | null {
  const row = aplicarIgnorarColunas(rowIn, colMap, imgWidth);
  const numCol = colMap.numero;
  if (!numCol || numCol.start === numCol.end) return null;
  const t = textoNaColuna(row, numCol, imgWidth);
  if (parseMoedaPtFromOcrColuna(t) > 0 && /,\s*\d{2}/.test(prepararTextoOcrParaMoeda(t))) {
    return null;
  }
  const raw = t.replace(/\D/g, '');
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 1 && n <= 999) return n;
  return null;
}

/** Valor (R$) nas colunas mapeadas; se só «Nº parcela» cobre moeda, usa como valor do parcelamento. */
function valorParcelaNaLinha(
  row: PosicionadoItem[],
  colMap: Partial<Record<ParcelamentoColunaCampo, ParcelamentoColunaDef>>,
  imgWidth: number,
  excludeValues: Set<number> = new Set()
): { valor: number; inferidoDeNumero: boolean } {
  let valor = 0;

  const valorCol = colMap.valor;
  if (valorCol && valorCol.start !== valorCol.end) {
    valor = moedaNaColuna(row, valorCol, imgWidth, excludeValues);
    if (valor > 0) {
      if (!isValueAlreadyUsed(valor, excludeValues)) {
        addUsedValue(valor, excludeValues);
        return { valor, inferidoDeNumero: false };
      }
    }

    // Fallback: OCR pode deslocar o número para fora da coluna mapeada na primeira linha.
    // Tenta o maior valor plausível em toda a linha, se a coluna Valor estiver mapeada.
    const rowTexto = row.map((it) => it.str).join(' ');
    const rowValores = extrairMoedasDoTexto(rowTexto)
      .filter((v) => v > 0)
      .sort((a, b) => b - a);
    for (const v of rowValores) {
      if (!isValueAlreadyUsed(v, excludeValues)) {
        addUsedValue(v, excludeValues);
        return { valor: v, inferidoDeNumero: false };
      }
    }
  }

  const numCol = colMap.numero;
  if (numCol && numCol.start !== numCol.end && !colunaEstaMapeada(colMap, 'valor')) {
    const vNum = moedaNaColuna(row, numCol, imgWidth, excludeValues);
    if (vNum > 0 && !isValueAlreadyUsed(vNum, excludeValues)) {
      addUsedValue(vNum, excludeValues);
      return { valor: vNum, inferidoDeNumero: true };
    }
  }
  return { valor: 0, inferidoDeNumero: false };
}

function motivoLinhaRejeitada(
  row: PosicionadoItem[],
  colMap: Partial<Record<ParcelamentoColunaCampo, ParcelamentoColunaDef>>,
  imgWidth: number
): string {
  if (linhaEhCabecalho(row, colMap, imgWidth)) return 'cabeçalho';
  if (colunaEstaMapeada(colMap, 'vencimento') && !parseDataNaLinha(row, colMap, imgWidth)) {
    return 'sem data na coluna Vencimento';
  }
  const { valor, inferidoDeNumero } = valorParcelaNaLinha(row, colMap, imgWidth);
  if (valor > 0) return inferidoDeNumero ? 'ok (valor na coluna Nº)' : 'ok';

  // Aceitar linhas que tenham apenas juros / multa / encargos mapeados (sem coluna valor)
  const usedTmp = new Set<number>();
  const jurosM = moedaColunaSeMapeadaComRastreamento(row, colMap, 'juros', imgWidth, usedTmp);
  const multaM = moedaColunaSeMapeadaComRastreamento(row, colMap, 'multa', imgWidth, usedTmp);
  const { encargos: encM, honorarios: honM } = parseEncargosHonorarios(row, colMap, imgWidth, usedTmp);
  if (jurosM > 0 || multaM > 0 || encM > 0 || honM > 0) return 'ok (juros/multa/encargos)';

  if (colunaEstaMapeada(colMap, 'numero')) {
    const t = textoNaColuna(row, colMap.numero!, imgWidth);
    if (parseMoedaPtFromOcrColuna(t) > 0) {
      return 'coluna Nº parcela tem valor em R$ — use «Valor do parcelamento»';
    }
  }
  if (!colunaEstaMapeada(colMap, 'valor')) {
    return 'marque a coluna «Valor do parcelamento» sobre os números (305,43…)';
  }
  return 'nenhum valor na faixa da coluna';
}

function parseEncargosHonorarios(
  rowIn: PosicionadoItem[],
  colMap: Partial<Record<ParcelamentoColunaCampo, ParcelamentoColunaDef>>,
  imgWidth: number,
  usedValues: Set<number> = new Set()
): { encargos: number; honorarios: number } {
  const row = aplicarIgnorarColunas(rowIn, colMap, imgWidth);

  // Extrair valores de cada coluna separadamente para evitar duplicação
  let encargos = 0;
  let honorarios = 0;

  const encCol = colMap.encargos;
  const honCol = colMap.honorarios;
  const combCol = colMap.encargosHonorarios;

  // Priorizar coluna combinada
  if (combCol && combCol.start !== combCol.end) {
    const texto = textoNaColuna(row, combCol, imgWidth);
    const valores = extrairMoedasDoTexto(texto);
    if (valores.length >= 2) {
      for (const v of valores) {
        if (v > 0 && !isValueAlreadyUsed(v, usedValues)) {
          if (encargos === 0) {
            encargos = v;
            addUsedValue(v, usedValues);
          } else {
            honorarios = v;
            addUsedValue(v, usedValues);
            break;
          }
        }
      }
      if (encargos > 0 || honorarios > 0) {
        return { encargos, honorarios };
      }
    }
    if (valores.length === 1) {
      const v = valores[0];
      if (v > 0 && !isValueAlreadyUsed(v, usedValues)) {
        encargos = v;
        addUsedValue(v, usedValues);
        return { encargos, honorarios: 0 };
      }
    }
  }

  // Se não há coluna combinada, extrair de colunas separadas
  if (encCol && encCol.start !== encCol.end) {
    const texto = textoNaColuna(row, encCol, imgWidth);
    const valores = extrairMoedasDoTexto(texto);
    for (const v of valores) {
      if (v > 0 && !isValueAlreadyUsed(v, usedValues)) {
        encargos = v;
        addUsedValue(v, usedValues);
        break;
      }
    }
  }

  if (honCol && honCol.start !== honCol.end) {
    const texto = textoNaColuna(row, honCol, imgWidth);
    const valores = extrairMoedasDoTexto(texto);
    for (const v of valores) {
      if (v > 0 && !isValueAlreadyUsed(v, usedValues)) {
        honorarios = v;
        addUsedValue(v, usedValues);
        break;
      }
    }
  }

  return { encargos, honorarios };
}

function linhaEhCabecalho(
  rowIn: PosicionadoItem[],
  colMap: Partial<Record<ParcelamentoColunaCampo, ParcelamentoColunaDef>>,
  imgWidth: number
): boolean {
  const row = aplicarIgnorarColunas(rowIn, colMap, imgWidth);
  if (row.length === 0) return false;

  // Se a coluna valor tem um valor monetário, é linha de dados — nunca cabeçalho
  const valorCol = colMap.valor;
  if (valorCol && valorCol.start !== valorCol.end) {
    const vMon = parseMoedaPt(textoNaColuna(row, valorCol, imgWidth));
    if (vMon > 0) return false;
  }

  // Se a coluna de valor (ou pagamento/juros/multa/encargos) contém moeda, é linha de dados — nunca cabeçalho.
  // Isso evita descartar a 1ª parcela quando o OCR mistura rótulos (ex.: "Principal", "Total") na mesma linha.
  const tmpUsed = new Set<number>();

  if (colunaEstaMapeada(colMap, 'pagamento')) {
    const vPag = moedaColunaSeMapeadaComRastreamento(row, colMap, 'pagamento', imgWidth, tmpUsed);
    if (vPag > 0) return false;
  }

  if (colunaEstaMapeada(colMap, 'juros')) {
    const vJuros = moedaColunaSeMapeadaComRastreamento(row, colMap, 'juros', imgWidth, tmpUsed);
    if (vJuros > 0) return false;
  }

  if (colunaEstaMapeada(colMap, 'multa')) {
    const vMulta = moedaColunaSeMapeadaComRastreamento(row, colMap, 'multa', imgWidth, tmpUsed);
    if (vMulta > 0) return false;
  }

  const { encargos: encTmp, honorarios: honTmp } =
    (colunaEstaMapeada(colMap, 'encargos') ||
      colunaEstaMapeada(colMap, 'encargosHonorarios') ||
      colunaEstaMapeada(colMap, 'honorarios'))
      ? parseEncargosHonorarios(row, colMap, imgWidth, tmpUsed)
      : { encargos: 0, honorarios: 0 };

  if (encTmp > 0 || honTmp > 0) return false;


  const vencCol = colMap.vencimento;
  if (vencCol && vencCol.start !== vencCol.end) {
    const tRaw = textoNaColuna(row, vencCol, imgWidth);
    if (tRaw.trim()) {
      if (parseDataFlexivel(tRaw)) return false;
      const norm = normalizeOcrTexto(tRaw);
      const t = tRaw.toLowerCase();
      if (t === 'vencimento' || t === 'venc.' || t === 'data') return true;
      if (!RE_DATA.test(norm) && /[a-záàâãéêíóôõúç]/i.test(tRaw)) return true;
    }
  }

  const linha = textoNasColunasMapeadas(row, colMap, imgWidth).toLowerCase();
  if (!linha.trim()) return false;
  const temData = RE_DATA.test(normalizeOcrTexto(linha));
  if (temData) return false;

  // Só aplica detecção por rótulos quando NÃO há colunas monetárias (juros/multa/encargos)
  // mapeadas — evita rejeitar primeira linha real que contenha essas palavras no texto OCR
  const temColunasMonetariasEspeciais =
    colunaEstaMapeada(colMap, 'juros') ||
    colunaEstaMapeada(colMap, 'multa') ||
    colunaEstaMapeada(colMap, 'encargos') ||
    colunaEstaMapeada(colMap, 'encargosHonorarios') ||
    colunaEstaMapeada(colMap, 'honorarios');

  const rotulosGerais = ['vencimento', 'principal', 'prestacao', 'prestação', 'saldo', 'total'];
  const rotulosMonetarios = ['multa', 'juros', 'encargo', 'honor'];
  const rotulos = temColunasMonetariasEspeciais
    ? rotulosGerais
    : [...rotulosGerais, ...rotulosMonetarios];

  if (rotulos.some((r) => linha.includes(r))) return true;

  const val = colMap.valor;
  if (val && val.start !== val.end) {
    const tRawVal = textoNaColuna(row, val, imgWidth);
    const t = tRawVal.toLowerCase();
    if (t === 'principal' || t === 'valor') return true;
    if (
      t.includes('valor') &&
      parseMoedaPt(tRawVal) <= 0 &&
      /[a-záàâãéêíóôõúç]/i.test(tRawVal)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Verifica se um valor já foi usado, com tolerância para arredondamentos.
 * Valores que diferem em menos de R$0.01 são considerados duplicados.
 */
function isValueAlreadyUsed(value: number, usedValues: Set<number>): boolean {
  if (value <= 0) return false;
  const rounded = Math.round(value * 100) / 100;
  for (const used of usedValues) {
    // Tolerância de 0.01 (1 centavo) para considerar duplicados
    if (Math.abs(rounded - used) < 0.011) return true;
  }
  return false;
}

/**
 * Adiciona um valor ao conjunto de valores usados com arredondamento.
 */
function addUsedValue(value: number, usedValues: Set<number>): void {
  if (value > 0) {
    usedValues.add(Math.round(value * 100) / 100);
  }
}

const IDS_MOEDA_OCR: ReadonlySet<ParcelamentoColunaCampo> = new Set([
  'valor',
  'pagamento',
  'juros',
  'multa',
  'encargosHonorarios',
]);

function valorColuna(
  row: PosicionadoItem[],
  colMap: Partial<Record<ParcelamentoColunaCampo, ParcelamentoColunaDef>>,
  id: ParcelamentoColunaCampo,
  imgWidth: number
): number {
  const c = colMap[id];
  if (!c || c.start === c.end) return 0;
  if (IDS_MOEDA_OCR.has(id)) return moedaNaColuna(row, c, imgWidth);
  return parseMoedaPt(textoNaColuna(row, c, imgWidth));
}

function textoColuna(
  row: PosicionadoItem[],
  colMap: Partial<Record<ParcelamentoColunaCampo, ParcelamentoColunaDef>>,
  id: ParcelamentoColunaCampo,
  imgWidth: number
): string {
  const c = colMap[id];
  if (!c || c.start === c.end) return '';
  return textoNaColuna(row, c, imgWidth);
}

function colunaPagamentoMapeada(
  colMap: Partial<Record<ParcelamentoColunaCampo, ParcelamentoColunaDef>>
): boolean {
  const c = colMap.pagamento;
  return !!c && c.start !== c.end;
}

const IDS_COLUNAS_DADOS: readonly ParcelamentoColunaCampo[] = [
  'numero',
  'vencimento',
  'valor',
  'pagamento',
  'juros',
  'encargosHonorarios',
  'encargos',
  'honorarios',
  'multa',
];

function colunaEstaMapeada(
  colMap: Partial<Record<ParcelamentoColunaCampo, ParcelamentoColunaDef>>,
  id: ParcelamentoColunaCampo
): boolean {
  const c = colMap[id];
  return !!c && c.start !== c.end;
}

/** Colunas de dados efetivamente marcadas na imagem (exceto «Ignorar»). */
export function idsColunasMapeadas(
  colMap: Partial<Record<ParcelamentoColunaCampo, ParcelamentoColunaDef>>
): ParcelamentoColunaImportId[] {
  return IDS_COLUNAS_DADOS.filter((id) => colunaEstaMapeada(colMap, id)) as ParcelamentoColunaImportId[];
}

function moedaColunaSeMapeadaComRastreamento(
  row: PosicionadoItem[],
  colMap: Partial<Record<ParcelamentoColunaCampo, ParcelamentoColunaDef>>,
  id: ParcelamentoColunaCampo,
  imgWidth: number,
  usedValues: Set<number> = new Set()
): number {
  if (!colunaEstaMapeada(colMap, id)) return 0;
  const c = colMap[id]!;
  let v = valorColuna(row, colMap, id, imgWidth);

  // Se o valor já foi usado, procura outro
  if (v > 0) {
    if (!isValueAlreadyUsed(v, usedValues)) {
      addUsedValue(v, usedValues);
      return v;
    }
    // Valor duplicado - tenta extrair alternativa
    if (IDS_MOEDA_OCR.has(id)) {
      const moedas = extrairMoedasDoTexto(textoNaColuna(row, c, imgWidth));
      for (const alt of moedas) {
        if (!isValueAlreadyUsed(alt, usedValues)) {
          addUsedValue(alt, usedValues);
          return alt;
        }
      }
    }
    return 0;
  }

  if (IDS_MOEDA_OCR.has(id)) {
    const moedas = extrairMoedasDoTexto(textoNaColuna(row, c, imgWidth));
    for (const alt of moedas) {
      if (alt > 0 && !isValueAlreadyUsed(alt, usedValues)) {
        addUsedValue(alt, usedValues);
        return alt;
      }
    }
  }
  return 0;
}

function debugLinhaOcr(
  rowIndex: number,
  row: PosicionadoItem[],
  colMap: Partial<Record<ParcelamentoColunaCampo, ParcelamentoColunaDef>>,
  imgWidth: number,
  resultado: ParcelaPlanilhaRow | null
): void {
  if (!isParcelamentoOcrDebug()) return;
  groupParcelamentoOcr(`Linha OCR #${rowIndex + 1}`);
  const campos: ParcelamentoColunaCampo[] = [
    'numero',
    'vencimento',
    'valor',
    'pagamento',
    'juros',
    'multa',
    'encargos',
    'honorarios',
    'encargosHonorarios',
  ];
  for (const id of campos) {
    const c = colMap[id];
    if (!c || c.start === c.end) continue;
    const pad = padColunaOcr(imgWidth);
    const parts = itensNaColuna(row, c, imgWidth);
    logParcelamentoOcr(id, {
      faixaPx: { start: Math.round(c.start), end: Math.round(c.end) },
      trechos: parts.map((it) => ({
        str: it.str,
        cx: Math.round(it.x + it.w / 2),
        x: Math.round(it.x),
        sobrep: Math.round(fracSobreposicaoColuna(it, c, pad) * 100) + '%',
      })),
      texto: textoNaColuna(row, c, imgWidth),
      moeda: IDS_MOEDA_OCR.has(id) ? moedaNaColuna(row, c, imgWidth) : undefined,
    });
  }
  logParcelamentoOcr('resultado', resultado ?? motivoLinhaRejeitada(row, colMap, imgWidth));
  endGroupParcelamentoOcr();
}

function parseParcelaFromRow(
  rowIn: PosicionadoItem[],
  colMap: Partial<Record<ParcelamentoColunaCampo, ParcelamentoColunaDef>>,
  imgWidth: number,
  lastDate: Date | null
): ParcelaPlanilhaRow | null {
  if (idsColunasMapeadas(colMap).length === 0) return null;

  const row = aplicarIgnorarColunas(rowIn, colMap, imgWidth);
  if (linhaEhCabecalho(row, colMap, imgWidth)) return null;

  // Rastrear valores já extraídos para evitar duplicação
  const usedValues = new Set<number>();

  let date: Date | null = null;
  if (colunaEstaMapeada(colMap, 'vencimento')) {
    date = parseDataNaLinha(row, colMap, imgWidth);
    if (!date) {
      const propagationMode = typeof window !== 'undefined' ? getOcrDatePropagationMode() : 'propagate';
      if (propagationMode !== 'one-per-tx' && lastDate) {
        date = lastDate;
      } else {
        return null;
      }
    }
  }

  const { valor, inferidoDeNumero } = valorParcelaNaLinha(row, colMap, imgWidth, usedValues);
  if (valor > 0) {
    addUsedValue(valor, usedValues);
  }

  const pagamento = moedaColunaSeMapeadaComRastreamento(row, colMap, 'pagamento', imgWidth, usedValues);
  const juros = moedaColunaSeMapeadaComRastreamento(row, colMap, 'juros', imgWidth, usedValues);
  const multa = moedaColunaSeMapeadaComRastreamento(row, colMap, 'multa', imgWidth, usedValues);
  const { encargos, honorarios } = parseEncargosHonorarios(row, colMap, imgWidth, usedValues);

  const nInferido =
    colunaEstaMapeada(colMap, 'numero') && !inferidoDeNumero
      ? parseNumeroNaLinha(row, colMap, imgWidth)
      : null;

  const temValorMapeado =
    valor > 0 ||
    pagamento > 0 ||
    juros > 0 ||
    multa > 0 ||
    encargos > 0 ||
    honorarios > 0 ||
    (nInferido != null && nInferido > 0);

  if (!temValorMapeado) return null;

  const dateLinha = date ?? new Date(0);

  return {
    n: nInferido ?? 0,
    date: dateLinha,
    valor,
    pagamento: pagamento > 0 ? pagamento : undefined,
    juros,
    encargos,
    honorarios,
    multa,
    contaDebito: '',
    contaCredito: '',
  };
}

/** Numera 1, 2, 3… quando a coluna de parcela não foi mapeada ou veio vazia. */
function inferirNumeroParcela(linhas: ParcelaPlanilhaRow[]): ParcelaPlanilhaRow[] {
  return linhas.map((p, i) => ({ ...p, n: p.n > 0 ? p.n : i + 1 }));
}

/** Monta o mapeamento em coordenadas do OCR (`refW` × `refH`). */
export function mappingParcelamentoEmCoordsOcr(
  columns: ParcelamentoColunaDef[],
  faixa: ParcelamentoFaixaDados | undefined,
  clickW: number,
  clickH: number,
  refW: number,
  refH: number
): ParcelamentoColunasMapping {
  const base = { columns, faixa };
  if (clickW <= 0 || clickH <= 0 || (clickW === refW && clickH === refH)) return base;
  return scaleParcelamentoMapping(base, clickW, clickH, refW, refH);
}

/** Prévia rápida no modal (mesma lógica do botão Importar). */
export function previewExtracaoParcelamento(
  items: PosicionadoItem[],
  columns: ParcelamentoColunaDef[],
  faixa: ParcelamentoFaixaDados | undefined,
  imgHeight: number,
  imgWidth: number,
  clickW = imgWidth,
  clickH = imgHeight
): ParcelamentoPlanilhaImport | null {
  if (items.length === 0 || columns.every((c) => c.start === c.end)) return null;
  try {
    const mapping = mappingParcelamentoEmCoordsOcr(columns, faixa, clickW, clickH, imgWidth, imgHeight);
    return extractParcelamentoFromMapping(items, mapping, imgHeight, imgWidth, { logResult: false });
  } catch {
    return null;
  }
}

export type ExtractParcelamentoOptions = {
  /** Se false, não grava no console (prévia ao vivo no modal). */
  logResult?: boolean;
  /** Se true, tenta de novo sem faixa vertical quando não extrai linhas. */
  allowFaixaFallback?: boolean;
  /** Início/fim marcados: não extrair acima da linha de início nem usar página inteira. */
  strictFaixaVertical?: boolean;
};

export function ocrImagemMuitoPequena(imgWidth: number, imgHeight: number): boolean {
  return Math.max(imgWidth, imgHeight) < PARCELAMENTO_OCR_MIN_LONG_EDGE;
}

export function extractParcelamentoFromMapping(
  items: PosicionadoItem[],
  mapping: ParcelamentoColunasMapping,
  imgHeight: number,
  imgWidth: number,
  options?: ExtractParcelamentoOptions
): ParcelamentoPlanilhaImport {
  const colMap = Object.fromEntries(
    mapping.columns.map((c) => [c.id, c])
  ) as Partial<Record<ParcelamentoColunaCampo, ParcelamentoColunaDef>>;

  const mapeadas = idsColunasMapeadas(colMap);

  if (isParcelamentoOcrDebug()) {
    logParcelamentoOcr('extração — início', {
      imgWidth,
      imgHeight,
      trechosOcrTotal: items.length,
      colunas: mapping.columns
        .filter((c) => c.start !== c.end)
        .map((c) => ({
          id: c.id,
          start: Math.round(c.start),
          end: Math.round(c.end),
          largura: Math.round(c.end - c.start),
        })),
      faixa: mapping.faixa,
    });
  }

  const temEncargosHon =
    colMap.encargosHonorarios ||
    colMap.encargos ||
    colMap.honorarios;
  if (temEncargosHon) {
    const hon = colMap.honorarios;
    const enc = colMap.encargos;
    const comb = colMap.encargosHonorarios;
    if (hon && enc && hon.start !== hon.end && enc.start !== enc.end) {
      const overlap = Math.min(hon.end, enc.end) - Math.max(hon.start, enc.start);
      const wHon = hon.end - hon.start;
      if (overlap > 0 && overlap / Math.max(wHon, 1) > 0.5) {
        delete colMap.honorarios;
      }
    }
    if (comb && comb.start !== comb.end) {
      delete colMap.encargos;
      delete colMap.honorarios;
    }
  }

  const filtrados = filtrarItemsPorFaixa(items, mapping.faixa, imgHeight, {
    strict: options?.strictFaixaVertical === true,
  });

  if (isParcelamentoOcrDebug()) {
    logParcelamentoOcr('trechos após faixa + colunas', {
      count: filtrados.length,
      amostra: filtrados.slice(0, 12).map((it) => ({
        str: it.str,
        cx: Math.round(it.x + it.w / 2),
        cy: Math.round(it.y + it.h / 2),
      })),
    });
  }

  const linhas: ParcelaPlanilhaRow[] = [];
  const rowClusters = expandClustersComMultiplasDatas(clusterLinhas(filtrados));
  let lastDate: Date | null = null;
  for (let ri = 0; ri < rowClusters.length; ri++) {
    const row = rowClusters[ri]!;
    const p = parseParcelaFromRow(row, colMap, imgWidth, lastDate);
    debugLinhaOcr(ri, row, colMap, imgWidth, p);
    if (p) {
      linhas.push(p);
      if (p.date && p.date.getTime() > 0) {
        lastDate = p.date;
      }
    }
  }

  let ordenadas = inferirNumeroParcela(linhas).sort(
    (a, b) => a.date.getTime() - b.date.getTime() || a.n - b.n
  );

  if (ordenadas.length === 0) {
    if (options?.allowFaixaFallback && mapping.faixa && items.length > 0) {
      try {
        const again = extractParcelamentoFromMapping(
          items,
          { columns: mapping.columns },
          imgHeight,
          imgWidth,
          { logResult: false, allowFaixaFallback: false }
        );
        if (again.linhas.length > 0) return again;
      } catch {
        /* ignora: mensagem unificada abaixo */
      }
    }
    const amostra = items
      .filter((it) => RE_DATA.test(normalizeOcrTexto(it.str)))
      .slice(0, 3)
      .map((it) => it.str)
      .join(', ');
    const nFrag = mapping.faixa ? filtrados.length : items.length;
    const onde = mapping.faixa ? 'nesta faixa vertical' : 'na página';
    const naPagina = items.length;
    const trechosMsg = mapping.faixa
      ? `${nFrag} trechos ${onde} (${naPagina} trechos na página inteira)`
      : `${naPagina} trechos na página`;
    const motivos = rowClusters
      .slice(0, 5)
      .map((row, i) => `L${i + 1}: ${motivoLinhaRejeitada(row, colMap, imgWidth)}`);
    const soNumeroComMoeda =
      colunaEstaMapeada(colMap, 'numero') &&
      !colunaEstaMapeada(colMap, 'valor') &&
      motivos.some((m) => m.includes('Nº parcela'));
    const imgPequena = ocrImagemMuitoPequena(imgWidth, imgHeight);
    throw new Error(
      items.length === 0
        ? 'OCR não leu texto na imagem. Aguarde o carregamento completo ou envie foto/PDF com melhor resolução.'
        : [
          `Nenhuma linha extraída (${trechosMsg}${amostra ? `; datas: ${amostra}` : ''}).`,
          soNumeroComMoeda
            ? 'Você marcou «Nº parcela» em cima de valores (305,43…). Selecione «Valor do parcelamento (R$)» na lista e desenhe a coluna de novo.'
            : 'Marque «Valor do parcelamento» sobre os números (dois cliques: esquerda e direita da coluna).',
          imgPequena
            ? `Imagem muito pequena para OCR (${imgWidth}×${imgHeight} px). Use PDF em escala maior, Full HD/4K, ou envie captura da tabela inteira.`
            : null,
          motivos.length ? `Motivos: ${motivos.join('; ')}.` : null,
        ]
          .filter(Boolean)
          .join(' ')
    );
  }

  ordenadas = renumerarParcelas1aN(dedupeLinhasParcelas(ordenadas));

  let colunasOut = mapeadas;
  if (
    !colunasOut.includes('valor') &&
    colunaEstaMapeada(colMap, 'numero') &&
    ordenadas.some((r) => r.valor > 0)
  ) {
    colunasOut = [...colunasOut, 'valor'];
  }

  if (isParcelamentoOcrDebug()) {
    logParcelamentoOcr('extração — fim', {
      linhas: ordenadas.map((r) => ({
        n: r.n,
        data: r.date.getTime() > 0 ? r.date.toISOString().slice(0, 10) : null,
        valor: r.valor,
        pagamento: r.pagamento,
        juros: r.juros,
      })),
    });
  }

  const textoCadastro = filtrados.map((i) => i.str).join('\n');
  const cadastro = readCadastroFromText(textoCadastro);

  const out: ParcelamentoPlanilhaImport = {
    ...cadastro,
    linhas: ordenadas,
    colunasMapeadas: colunasOut,
    calcularJurosPorPagamento: colunaPagamentoMapeada(colMap),
  };

  if (options?.logResult !== false) {
    console.warn(
      '[Parcelamento OCR] importacao concluida — valores coluna valor:',
      ordenadas.map((r, i) => ({ linha: i + 1, valor: r.valor, pagamento: r.pagamento }))
    );
  }

  return out;
}

/** Coluna genérica (qualquer módulo de importação OCR). */
export type GenericColunaDef = {
  id: string;
  start: number;
  end: number;
  color: string;
};

export type GenericColunasMapping = {
  columns: GenericColunaDef[];
  faixa?: ParcelamentoFaixaDados;
};

export type GenericOcrRow = Record<string, string>;

const GENERIC_IDS_IGNORAR = ['ignorar1', 'ignorar2', 'ignorar3'];

function genericColMap(columns: GenericColunaDef[]): Record<string, GenericColunaDef> {
  return Object.fromEntries(columns.map((c) => [c.id, c]));
}

function defsColunasIgnorarGenerico(
  colMap: Record<string, GenericColunaDef>
): GenericColunaDef[] {
  return GENERIC_IDS_IGNORAR.map((id) => colMap[id]).filter(
    (c): c is GenericColunaDef => !!c && c.start !== c.end
  );
}

function aplicarIgnorarColunasGenerico(
  row: PosicionadoItem[],
  colMap: Record<string, GenericColunaDef>,
  imgWidth: number
): PosicionadoItem[] {
  const ign = defsColunasIgnorarGenerico(colMap);
  if (ign.length === 0) return row;
  const pad = padColunaOcr(imgWidth);
  return row.filter(
    (it) => !ign.some((ig) => itemNaColuna(it, ig as ParcelamentoColunaDef, pad))
  );
}

function textoNaColunaGenerico(
  row: PosicionadoItem[],
  col: GenericColunaDef,
  imgWidth: number
): string {
  return textoNaColuna(row, col as ParcelamentoColunaDef, imgWidth).trim();
}

function linhaEhCabecalhoGenerico(
  rowIn: PosicionadoItem[],
  colMap: Record<string, GenericColunaDef>,
  dataColIds: string[],
  headerKeywords: string[],
  imgWidth: number
): boolean {
  const row = aplicarIgnorarColunasGenerico(rowIn, colMap, imgWidth);
  if (row.length === 0) return false;

  const linha = dataColIds
    .map((id) => {
      const col = colMap[id];
      if (!col || col.start === col.end) return '';
      return textoNaColunaGenerico(row, col, imgWidth);
    })
    .join(' ')
    .toLowerCase()
    .trim();

  if (!linha) return false;

  for (const id of dataColIds) {
    const col = colMap[id];
    if (!col || col.start === col.end) continue;
    const t = textoNaColunaGenerico(row, col, imgWidth);
    if (RE_DATA.test(normalizeOcrTexto(t))) return false;
    if (parseMoedaPtFromOcrColuna(t) > 0) return false;
    const digits = t.replace(/\s/g, '').replace(/\./g, '');
    if (/\d{5,}/.test(digits)) return false;
  }

  const matches = headerKeywords.filter((kw) => linha.includes(kw.toLowerCase()));
  if (matches.length >= 2) return true;
  if (matches.length === 1 && linha.length <= 28 && !/\d{3,}/.test(linha)) return true;
  return false;
}

function ocrItemCentroX(it: PosicionadoItem): number {
  return it.x + it.w / 2;
}

function itemEstaNaColunaGenerica(
  it: PosicionadoItem,
  col: GenericColunaDef,
  imgWidth: number,
): boolean {
  const pad = padColunaOcr(imgWidth);
  const cx = ocrItemCentroX(it);
  return cx >= col.start - pad && cx <= col.end + pad;
}

function filtrarItensColunaDescricao(
  items: PosicionadoItem[],
  descCol: GenericColunaDef,
  imgWidth: number,
): PosicionadoItem[] {
  return items.filter((it) => itemEstaNaColunaGenerica(it, descCol, imgWidth));
}

/** Histórico só com tokens dentro da coluna Descrição (multilinha com \\n entre linhas físicas). */
function linhaFisicaTemValorDeOutroLancamento(
  lineItems: PosicionadoItem[],
  valorCol: GenericColunaDef | null,
  imgWidth: number,
  valorTokenRef: PosicionadoItem | null | undefined,
  yTol: number,
): boolean {
  if (!valorCol || valorCol.start === valorCol.end) return false;
  const pad = padColunaOcr(imgWidth);
  for (const it of lineItems) {
    const v = parseMoedaPtFromExtratoColuna(it.str);
    if (v <= 0.0001 && !tokenEhValorExtrato(it.str)) continue;
    const cx = it.x + it.w / 2;
    if (cx < valorCol.start - pad || cx > valorCol.end + pad) continue;
    if (valorTokenRef) {
      const cy = it.y + it.h / 2;
      const refCy = valorTokenRef.y + valorTokenRef.h / 2;
      if (Math.abs(cy - refCy) <= yTol) continue;
    }
    return true;
  }
  return false;
}

function montarTextoHistoricoColunaDescricao(
  items: PosicionadoItem[],
  descCol: GenericColunaDef,
  imgWidth: number,
  opts?: {
    colMap?: Record<string, GenericColunaDef>;
    valorToken?: PosicionadoItem | null;
    clusterItems?: PosicionadoItem[];
  },
): string {
  const scoped = filtrarItensColunaDescricao(items, descCol, imgWidth).filter(
    (it) => !ocrItemTokenEhData(it) && !ocrItemTokenEhSomenteHora(it.str),
  );
  if (scoped.length === 0) return '';

  const colMap = opts?.colMap;
  const valorCol =
    (colMap?.valorMisto && colMap.valorMisto.start !== colMap.valorMisto.end
      ? colMap.valorMisto
      : null) ??
    (colMap?.valorDebito && colMap.valorDebito.start !== colMap.valorDebito.end
      ? colMap.valorDebito
      : null) ??
    (colMap?.valorCredito && colMap.valorCredito.start !== colMap.valorCredito.end
      ? colMap.valorCredito
      : null) ??
    (colMap?.valor && colMap.valor.start !== colMap.valor.end ? colMap.valor : null);

  const heights = scoped.map((i) => i.h).filter((h) => h > 0).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 12;
  const yTol = Math.max(8, Math.round(medianH * 0.55));
  const clusterAll = opts?.clusterItems ?? items;
  const physicalLines = splitClusterPorLinhasY(scoped, yTol);
  const partes: string[] = [];
  const anchorY = opts?.valorToken
    ? opts.valorToken.y + (opts.valorToken.h > 0 ? opts.valorToken.h : medianH) / 2
    : null;
  let lastParteY: number | null = null;
  const maxGapContinuacao = yTol * 3;

  for (const lineItems of physicalLines) {
    const refY = lineItems[0]!.y + (lineItems[0]!.h > 0 ? lineItems[0]!.h : medianH) / 2;
    const lineCluster = clusterAll.filter(
      (it) => Math.abs(it.y + (it.h > 0 ? it.h : medianH) / 2 - refY) <= yTol,
    );
    const isAnchorLine =
      anchorY != null && Math.abs(refY - anchorY) <= yTol;

    if (
      anchorY != null &&
      refY < anchorY - yTol &&
      !lineCluster.some((it) => ocrItemTokenEhData(it))
    ) {
      continue;
    }

    if (
      partes.length > 0 &&
      lastParteY != null &&
      refY - lastParteY > maxGapContinuacao
    ) {
      break;
    }

    if (
      linhaFisicaTemValorDeOutroLancamento(
        lineCluster,
        valorCol,
        imgWidth,
        opts?.valorToken,
        yTol,
      )
    ) {
      break;
    }

    const lineText = [...lineItems]
      .sort((a, b) => a.x - b.x)
      .map((it) => it.str.replace(/\s+/g, ' ').trim())
      .filter((s) => s.length > 0 && !tokenEhValorExtrato(s))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!lineText || extratoTextoEhRodape(lineText)) continue;

    const lineFull = lineCluster
      .slice()
      .sort((a, b) => a.x - b.x)
      .map((it) => it.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (
      partes.length > 0 &&
      !isAnchorLine &&
      extratoLinhaBbIniciaNovoLancamento(
        lineFull,
        linhaFisicaTemValorDeOutroLancamento(lineCluster, valorCol, imgWidth, null, yTol),
      )
    ) {
      break;
    }

    const cleaned = stripDateTokensFromExtratoText(
      limparHistoricoExtratoMisturado(fixOcrHistoricoLine(lineText)),
    );
    if (cleaned) {
      partes.push(cleaned);
      lastParteY = refY;
    }
  }

  return partes.join('\n');
}

function resolveHistoricoColDefExtrato(
  colMap: Record<string, GenericColunaDef>,
): GenericColunaDef | null {
  const desc = colMap['descricao'];
  if (desc && desc.start !== desc.end) return desc;
  const histOp = colMap['historicoOperacao'];
  if (histOp && histOp.start !== histOp.end) return histOp;
  const hist = colMap['historico'];
  if (hist && hist.start !== hist.end) return hist;
  return null;
}

function ocrItemTokenEhData(it: PosicionadoItem): boolean {
  const s = String(it.str ?? '').replace(/\s+/g, ' ').trim();
  if (!s || ocrItemTokenEhSomenteHora(s)) return false;
  if (parseDataTokenExtratoCluster(s)) return true;
  if (ocrItemTokenPareceDataComMes(s)) return true;
  return RE_DATA.test(normalizeOcrTexto(s)) && s.replace(/\D/g, '').length <= 8;
}

/** Cada palavra OCR vai para no máximo uma coluna (maior sobreposição / centro na faixa). */
function assignOcrItemsToColumnsExclusive(
  row: PosicionadoItem[],
  columns: GenericColunaDef[],
  imgWidth: number,
): Map<string, PosicionadoItem[]> {
  const mapped = columns.filter((c) => c.start !== c.end && !GENERIC_IDS_IGNORAR.includes(c.id));
  const buckets = new Map<string, PosicionadoItem[]>();
  for (const col of mapped) buckets.set(col.id, []);

  const pad = padColunaOcr(imgWidth);
  const dataColDef = mapped.find((c) => c.id === 'data');
  for (const it of row) {
    if (dataColDef && ocrItemTokenEhData(it)) {
      const cx = it.x + it.w / 2;
      if (cx >= dataColDef.start - pad && cx <= dataColDef.end + pad * 2) {
        buckets.get('data')!.push(it);
        continue;
      }
    }
    let bestCol: GenericColunaDef | null = null;
    let bestScore = 0;
    for (const col of mapped) {
      const frac = fracSobreposicaoColuna(it, col as ParcelamentoColunaDef, pad);
      const cx = it.x + it.w / 2;
      const centerInside = cx >= col.start + pad && cx <= col.end - pad;
      const score = frac + (centerInside ? 0.3 : 0);
      if (score > bestScore && (frac >= 0.32 || centerInside)) {
        bestScore = score;
        bestCol = col;
      }
    }
    if (bestCol) buckets.get(bestCol.id)!.push(it);
  }

  for (const items of buckets.values()) {
    items.sort((a, b) => a.x - b.x);
  }
  return buckets;
}

const EXTRATO_VALOR_FIELD_IDS = new Set([
  'valorDebito',
  'valorCredito',
  'valorMisto',
  'valor',
]);

function textoFromExclusiveBucket(
  items: PosicionadoItem[],
  fieldId: string,
  rowCluster?: PosicionadoItem[],
): string {
  if (items.length === 0) return '';
  if (EXTRATO_VALOR_FIELD_IDS.has(fieldId) || fieldId === 'natureza') {
    return prepararTextoOcrParaMoeda(items.map((it) => it.str).join(' '));
  }
  if (fieldId === 'contaDebito' || fieldId === 'contaCredito' || fieldId === 'contaContabil') {
    return items
      .map((it) => it.str.trim())
      .join('')
      .replace(/\s+/g, '')
      .trim();
  }
  const isDescricao =
    fieldId === 'descricao' ||
    fieldId === 'historicoOperacao' ||
    fieldId === 'historico';
  let scoped = items;
  if (isDescricao && rowCluster && rowCluster.length > 0) {
    scoped = filtrarTokensDescricaoMesmaLinhaValor(items, rowCluster);
  }
  const sorted = [...scoped].sort((a, b) => a.x - b.x || a.y - b.y);
  const parts = isDescricao
    ? sorted
      .filter((it) => !ocrItemTokenEhData(it))
      .map((it) => it.str)
      .filter((s) => !tokenEhValorExtrato(s) && s.trim().length > 0)
    : sorted.map((it) => it.str);
  const joined = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (isDescricao) {
    return stripDateTokensFromExtratoText(limparHistoricoExtratoMisturado(joined));
  }
  return joined;
}

/** Tokens não atribuídos a nenhuma coluna, mas na faixa da coluna Descrição. */
function anexarOrfaosColunaDescricao(
  row: PosicionadoItem[],
  buckets: Map<string, PosicionadoItem[]>,
  colMap: Record<string, GenericColunaDef>,
  imgWidth: number,
): void {
  const descCol = colMap['descricao'];
  if (!descCol || descCol.start === descCol.end) return;

  const assigned = new Set<PosicionadoItem>();
  for (const list of buckets.values()) {
    for (const it of list) assigned.add(it);
  }

  const pad = padColunaOcr(imgWidth);
  const descItems = [...(buckets.get('descricao') ?? [])];

  const valueColIds = ['valorDebito', 'valorCredito', 'valorMisto', 'valor'];
  let valueMinX = imgWidth * 0.52;
  for (const id of valueColIds) {
    const c = colMap[id];
    if (c && c.start !== c.end) valueMinX = Math.min(valueMinX, c.start - pad);
  }
  const dataCol = colMap['data'];
  let dataMaxX = imgWidth * 0.14;
  if (dataCol && dataCol.start !== dataCol.end) dataMaxX = dataCol.end + pad;

  for (const it of row) {
    if (assigned.has(it)) continue;
    const cx = it.x + it.w / 2;
    if (ocrItemTokenEhData(it) && cx <= dataMaxX + pad) continue;
    if (ocrItemTokenEhData(it) && cx < valueMinX) continue;
    const inDescCol = cx >= descCol.start - pad && cx <= descCol.end + pad;
    if (inDescCol) {
      descItems.push(it);
      assigned.add(it);
    }
  }

  if (descItems.length > 0) {
    descItems.sort((a, b) => a.y - b.y || a.x - b.x);
    buckets.set('descricao', descItems);
  }
}

function centerYPosicionadoItem(it: PosicionadoItem): number {
  return it.y + it.h / 2;
}

function referenciaYValorCluster(rowIn: PosicionadoItem[]): number | null {
  const vals = rowIn.filter((it) => {
    const s = String(it.str ?? '').replace(/\s+/g, ' ');
    return /\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/.test(s) && parseMoedaPtFromExtratoColuna(s) > 0.0001;
  });
  if (vals.length === 0) return null;
  vals.sort((a, b) => b.x - a.x);
  return centerYPosicionadoItem(vals[0]!);
}

function parseDataTokenExtratoCluster(token: string, statementYear?: string): string {
  return parseExtratoDataOcrText(fixOcrTokenForExtrato(token), statementYear);
}

function ocrItemTokenEhSomenteHora(s: string): boolean {
  return /^\d{1,2}:\d{2}(?::\d{2})?$/.test(String(s ?? '').trim());
}

function ocrItemTokenPareceDataComMes(s: string): boolean {
  return /\d{1,2}\s+[A-Za-zçÇÁáÀÂÃÉÊÍÓÔÕÚáàâãéêíóôõú]{3,}/i.test(String(s ?? '').trim());
}

function extractDateFromRowCluster(
  rowIn: PosicionadoItem[],
  colMap: Record<string, GenericColunaDef>,
  imgWidth: number,
  statementYear?: string,
): string {
  const dataCol = colMap['data'];
  const pad = padColunaOcr(imgWidth);
  let items =
    dataCol && dataCol.start !== dataCol.end
      ? rowIn.filter((it) => {
        const cx = it.x + it.w / 2;
        return cx >= dataCol.start - pad && cx <= dataCol.end + pad;
      })
      : rowIn.filter((it) => it.x < imgWidth * 0.28);

  const refY = referenciaYValorCluster(rowIn);
  if (refY != null && items.length > 1) {
    const heights = rowIn.map((i) => i.h).filter((h) => h > 0).sort((a, b) => a - b);
    const medianH = heights[Math.floor(heights.length / 2)] || 12;
    const yTol = Math.max(9, medianH * 1.45);
    const naLinha = items.filter((it) => Math.abs(centerYPosicionadoItem(it) - refY) <= yTol);
    if (naLinha.length > 0) items = naLinha;
    items = [...items].sort(
      (a, b) =>
        Math.abs(centerYPosicionadoItem(a) - refY) - Math.abs(centerYPosicionadoItem(b) - refY) ||
        a.x - b.x,
    );
  } else {
    items = [...items].sort((a, b) => a.x - b.x || a.y - b.y);
  }

  const joined = items
    .map((it) => it.str.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (joined) {
    const parsedJoined = parseExtratoDataOcrText(joined, statementYear);
    if (parsedJoined) return parsedJoined;
  }

  for (const it of items) {
    const parsed = parseDataTokenExtratoCluster(it.str, statementYear);
    if (parsed) return parsed;
  }
  return '';
}

function textoDescricaoFromLinhaMeio(
  lineItems: PosicionadoItem[],
  colMap: Record<string, GenericColunaDef>,
  imgWidth: number,
): string {
  const pad = padColunaOcr(imgWidth);
  const valueColIds = ['valorDebito', 'valorCredito', 'valorMisto', 'valor'];
  let valueMinX = imgWidth * 0.52;
  for (const id of valueColIds) {
    const c = colMap[id];
    if (c && c.start !== c.end) valueMinX = Math.min(valueMinX, c.start - pad);
  }
  const dataCol = colMap['data'];
  let dataMaxX = imgWidth * 0.14;
  if (dataCol && dataCol.start !== dataCol.end) dataMaxX = dataCol.end + pad;

  const parts: string[] = [];
  for (const it of [...lineItems].sort((a, b) => a.x - b.x)) {
    const cx = it.x + it.w / 2;
    if (cx >= valueMinX) continue;
    const s = it.str.replace(/\s+/g, ' ').trim();
    if (!s) continue;
    if (cx < dataMaxX && /\d{1,2}\s*[\/\-.]\s*\d{1,2}/.test(s)) continue;
    if (/\d{1,3}(?:\.\d{3})*,\d{2}/.test(s) && parseMoedaPtFromExtratoColuna(s) > 0.0001) continue;
    parts.push(s);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Histórico em todas as linhas físicas do bloco (até a próxima linha com valor). */
function buildDescricaoMultilinhaDoCluster(
  rowIn: PosicionadoItem[],
  colMap: Record<string, GenericColunaDef>,
  imgWidth: number,
): string {
  const physicalLines = splitClusterPorLinhasY(rowIn);
  if (physicalLines.length === 0) return '';

  const allCols = Object.values(colMap).filter((c): c is GenericColunaDef => !!c);
  const partes: string[] = [];

  for (let li = 0; li < physicalLines.length; li++) {
    const lineItems = physicalLines[li]!;
    const lineFull = [...lineItems]
      .sort((a, b) => a.x - b.x)
      .map((it) => it.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const lineHasValor = lineItems.some(
      (it) =>
        parseMoedaPtFromExtratoColuna(it.str) > 0.0001 &&
        it.x + it.w / 2 >= imgWidth * 0.38,
    );
    if (
      li > 0 &&
      partes.length > 0 &&
      extratoLinhaBbIniciaNovoLancamento(lineFull, lineHasValor)
    ) {
      break;
    }

    const row = aplicarIgnorarColunasGenerico(lineItems, colMap, imgWidth);
    const buckets = assignOcrItemsToColumnsExclusive(row, allCols, imgWidth);
    anexarOrfaosColunaDescricao(row, buckets, colMap, imgWidth);

    const histColDef = resolveHistoricoColDefExtrato(colMap);
    let lineDesc = '';
    if (histColDef) {
      lineDesc = montarTextoHistoricoColunaDescricao(lineItems, histColDef, imgWidth, {
        colMap,
        clusterItems: rowIn,
      });
    }
    if (!lineDesc) {
      for (const id of ['descricao', 'historicoOperacao', 'historico']) {
        const items = buckets.get(id) ?? [];
        if (items.length === 0) continue;
        const t = textoFromExclusiveBucket(items, id);
        if (t.trim()) {
          lineDesc = t.trim();
          break;
        }
      }
    }
    if (!lineDesc && !histColDef) {
      lineDesc = textoDescricaoFromLinhaMeio(lineItems, colMap, imgWidth);
    }

    const cleaned = lineDesc.replace(/\s+/g, ' ').trim();
    if (!cleaned || extratoTextoEhRodape(cleaned)) continue;
    partes.push(cleaned);
  }

  return partes.join('\n');
}

/** Texto fiel da linha OCR: tokens por linha física, separados por espaço (como no extrato impresso). */
function buildLinhaOcrMultilinha(rowIn: PosicionadoItem[]): string {
  return splitClusterPorLinhasY(rowIn)
    .map((line) =>
      [...line]
        .sort((a, b) => a.x - b.x)
        .map((it) => it.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseGenericRowFromClusterExtratoStrict(
  rowIn: PosicionadoItem[],
  colMap: Record<string, GenericColunaDef>,
  dataColIds: string[],
  headerKeywords: string[],
  imgWidth: number,
  ignoreLineWords: string[] = [],
  segmento?: ExtratoLancamentoSegmento,
  statementYear?: string,
): GenericOcrRow | null {
  const mappedIds = dataColIds.filter((id) => {
    const c = colMap[id];
    return !!c && c.start !== c.end;
  });
  if (mappedIds.length === 0) return null;
  if (
    !segmento?.valorToken &&
    linhaEhCabecalhoGenerico(rowIn, colMap, mappedIds, headerKeywords, imgWidth)
  ) {
    return null;
  }

  if (ignoreLineWords.length > 0) {
    const textoLinha =
      buildLinhaOcrMultilinha(rowIn) ||
      rowIn
        .slice()
        .sort((a, b) => a.x - b.x)
        .map((it) => it.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (
      textoLinha &&
      extratoTextoContemPalavraIgnorada(textoLinha, ignoreLineWords) &&
      !extratoLinhaTemLancamentoOperacionalRecuperavel(textoLinha) &&
      !extratoLinhaSaldoTemValorLancamentoColado(textoLinha)
    ) {
      return null;
    }
  }

  const row = aplicarIgnorarColunasGenerico(rowIn, colMap, imgWidth);
  const allCols = Object.values(colMap).filter((c): c is GenericColunaDef => !!c);
  const buckets = assignOcrItemsToColumnsExclusive(row, allCols, imgWidth);
  anexarOrfaosColunaDescricao(row, buckets, colMap, imgWidth);

  const out: GenericOcrRow = {};
  let hasContent = false;
  for (const id of mappedIds) {
    if (id === 'descricao' || id === 'historicoOperacao' || id === 'historico') continue;
    if (EXTRATO_VALOR_FIELD_IDS.has(id)) continue;
    const items = buckets.get(id) ?? [];
    const t = textoFromExclusiveBucket(items, id, row);
    out[id] = t;
    if (t) hasContent = true;
  }

  const rowValor = filtrarRowClusterNaLinhaDoValor(row);
  const rowDesc = rowValor.length > 0 ? rowValor : row;

  // Data: cluster completo (PDF nativo pode desalinhar Y da data vs valor na mesma linha)
  const dateFromCluster =
    extractDateFromRowCluster(rowIn, colMap, imgWidth, statementYear) ||
    extractDateFromRowCluster(row, colMap, imgWidth, statementYear) ||
    extractDateFromRowCluster(rowDesc, colMap, imgWidth, statementYear);
  if (dateFromCluster) {
    out.data = parseExtratoDataOcrText(dateFromCluster, statementYear) || dateFromCluster;
  } else if (!out.data?.trim()) {
    const leftText = rowIn
      .filter((it) => it.x < imgWidth * 0.28)
      .map((it) => it.str)
      .join(' ');
    const parsedLeft = parseExtratoDataOcrText(leftText, statementYear);
    if (parsedLeft) {
      out.data = parsedLeft;
      hasContent = true;
    } else {
      const match = leftText.match(/(\d{1,2})\s*[\/\-.]\s*(\d{1,2})(?:\s*[\/\-.]\s*(\d{2,4}))?/);
      if (match) {
        const dd = match[1].padStart(2, '0');
        const mm = match[2].padStart(2, '0');
        const dVal = parseInt(dd, 10);
        const mVal = parseInt(mm, 10);
        if (dVal >= 1 && dVal <= 31 && mVal >= 1 && mVal <= 12) {
          const yy = match[3] ? (match[3].length === 2 ? `20${match[3]}` : match[3]) : '';
          out.data = yy ? `${dd}/${mm}/${yy}` : `${dd}/${mm}`;
          hasContent = true;
        }
      }
    }
  }

  const debCol = colMap['valorDebito'];
  const credCol = colMap['valorCredito'];
  const mistoCol = colMap['valorMisto'];
  const debColMapped = debCol && debCol.start !== debCol.end;
  const credColMapped = credCol && credCol.start !== credCol.end;
  const mistoColMapped = mistoCol && mistoCol.start !== mistoCol.end;
  const valorMistoSomente = mistoColMapped && !debColMapped && !credColMapped;

  const pickValorCol = (col: GenericColunaDef) =>
    pickExtratoValorFromColItems(rowDesc, col, imgWidth) ??
    pickExtratoValorFromColItems(row, col, imgWidth);

  if (debColMapped) {
    const pickDeb = pickValorCol(debCol);
    if (pickDeb && pickDeb.value > 0) {
      out.valorDebito = pickDeb.token;
      hasContent = true;
    }
  }
  if (credColMapped) {
    const pickCred = pickValorCol(credCol);
    if (pickCred && pickCred.value > 0) {
      out.valorCredito = pickCred.token;
      hasContent = true;
    }
  }
  if (mistoColMapped) {
    const pickMisto = pickValorCol(mistoCol);
    if (pickMisto && (pickMisto.value > 0 || /^0,\s*00/i.test(pickMisto.token))) {
      const colText = rowDesc
        .filter((it) => {
          const cx = it.x + (it.w ?? 0) / 2;
          const pad = Math.max(4, imgWidth * 0.008);
          return cx >= mistoCol.start - pad && cx <= mistoCol.end + pad;
        })
        .map((it) => it.str)
        .join(' ')
        .trim();
      const valorTexto = colText || pickMisto.token;
      const nature: 'D' | 'C' =
        pickMisto.nature === 'D'
          ? 'D'
          : pickMisto.nature === 'C'
            ? 'C'
            : extratoNaturezaPorValorAssinadoNoToken(valorTexto, pickMisto.value);
      out.valorMisto = formatExtratoValorAssinadoPt(pickMisto.value, nature);
      hasContent = true;
    }
  }

  if (segmento?.valorToken) {
    const vt = fixOcrTokenForExtrato(segmento.valorToken.str.trim());
    const normalizedSeg = normalizeExtratoValorColunaOcr(vt);
    const segTokenMatch = normalizedSeg.match(/\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2}/);
    const segV = segTokenMatch
      ? parseMoedaPtFromExtratoColuna(segTokenMatch[0]!.replace(/^[-−(]/, ''))
      : 0;
    const pickedV = Math.max(
      parseMoedaPtFromExtratoColuna(out.valorMisto ?? ''),
      parseMoedaPtFromExtratoColuna(out.valorDebito ?? ''),
      parseMoedaPtFromExtratoColuna(out.valorCredito ?? ''),
    );
    const valorColDiverge =
      segV > 0.0001 &&
      pickedV > 0.0001 &&
      Math.abs(pickedV - segV) > 0.05 &&
      (pickedV > segV * 1.8 || segV > pickedV * 1.8);
    const hasValorCol =
      parseMoedaPtFromExtratoColuna(out.valorDebito ?? '') > 0 ||
      parseMoedaPtFromExtratoColuna(out.valorCredito ?? '') > 0 ||
      parseMoedaPtFromExtratoColuna(out.valorMisto ?? '') > 0;
    if (!hasValorCol || valorColDiverge) {
      const normalized = normalizedSeg;
      const tokenMatch = normalized.match(/\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2}/);
      if (tokenMatch) {
        const token = tokenMatch[0];
        const nature =
          parseExtratoNaturezaNoValor(vt) ??
          parseExtratoNaturezaFromRowItems(rowIn) ??
          (/^[-−]/.test(vt) ? 'D' : null) ??
          (mistoColMapped ? (extratoValorIsNegative({ texto: vt, coluna: 'misto' }) ? 'D' : 'C') : null);
        if (mistoColMapped || valorMistoSomente) {
          const nat: 'D' | 'C' = nature === 'C' ? 'C' : 'D';
          const v = parseMoedaPtFromExtratoColuna(token);
          out.valorMisto = formatExtratoValorAssinadoPt(v, nat);
        } else if (nature === 'C') {
          out.valorCredito = token;
        } else {
          out.valorDebito = /^[-−]/.test(vt) ? `-${token}` : token;
        }
        hasContent = true;
      } else {
        out.valorMisto = normalizeExtratoValorAssinadoToken(vt, { coluna: 'misto' });
        hasContent = true;
      }
    }
  }

  if (!hasContent) return null;

  const bucketsDesc = assignOcrItemsToColumnsExclusive(rowDesc, allCols, imgWidth);
  anexarOrfaosColunaDescricao(rowDesc, bucketsDesc, colMap, imgWidth);
  for (const id of mappedIds) {
    if (id !== 'descricao' && id !== 'historicoOperacao' && id !== 'historico') continue;
    const items = bucketsDesc.get(id) ?? [];
    const t = textoFromExclusiveBucket(items, id, rowDesc);
    if (t) {
      const cleaned =
        id === 'descricao' || id === 'historicoOperacao' || id === 'historico'
          ? extratoDescricaoIgnorarIndicadorDc(t) || (id !== 'descricao' ? t : '')
          : t;
      if (cleaned) {
        out[id] = cleaned;
        hasContent = true;
      }
    }
  }

  const historicoColDef = resolveHistoricoColDefExtrato(colMap);
  const descMapeada = !!colMap['descricao'] && colMap['descricao'].start !== colMap['descricao'].end;
  let historicoColunaStrict = false;
  if (historicoColDef) {
    const sourceItems = segmento?.cluster ?? rowIn;
    const strict = montarTextoHistoricoColunaDescricao(sourceItems, historicoColDef, imgWidth, {
      colMap,
      valorToken: segmento?.valorToken ?? null,
      clusterItems: sourceItems,
    });
    if (strict) {
      if (historicoColDef.id === 'descricao' || !out.descricao) out.descricao = strict;
      if (historicoColDef.id === 'historicoOperacao') out.historicoOperacao = strict;
      if (historicoColDef.id === 'historico') out.historico = strict;
      historicoColunaStrict = true;
      out._extratoHistoricoColuna = '1';
    }
  }

  const rowLine = rowDesc
    .slice()
    .sort((a, b) => a.x - b.x)
    .map((it) => it.str)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  let deb = parseMoedaPtFromExtratoColuna(out.valorDebito ?? '');
  let cred = parseMoedaPtFromExtratoColuna(out.valorCredito ?? '');
  const mistoRaw = out.valorMisto ?? '';
  const mistoMatch = mistoRaw.match(/(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/);
  let misto = mistoMatch ? moedaExtratoPlausivel(mistoMatch[1]) : parseMoedaPtFromExtratoColuna(mistoRaw);

  if (misto > 0 && deb <= 0 && cred <= 0 && !valorMistoSomente && !mistoColMapped) {
    const nature =
      parseExtratoNaturezaNoValor(mistoRaw) ??
      extratoNaturezaPorValorAssinadoNoToken(mistoRaw, misto);
    const tokenMatch = mistoRaw.match(/\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/);
    const token = tokenMatch ? tokenMatch[0] : mistoRaw.trim();
    if (nature === 'D') {
      out.valorDebito = token;
      out.valorCredito = '';
      deb = misto;
    } else {
      out.valorCredito = token;
      out.valorDebito = '';
      cred = misto;
    }
    out.valorMisto = '';
    misto = 0;
  } else if (valorMistoSomente && misto > 0) {
    const nature =
      parseExtratoNaturezaNoValor(mistoRaw) ??
      extratoNaturezaPorValorAssinadoNoToken(mistoRaw, misto);
    out.valorMisto = formatExtratoValorAssinadoPt(misto, nature);
    out.valorDebito = '';
    out.valorCredito = '';
  }

  if (deb <= 0 && cred <= 0 && misto <= 0) {
    const picked = pickExtratoValorFromRowItems(rowDesc) ?? pickExtratoValorFromRowItems(row);
    if (picked) {
      const pickCx = row.find((it) => it.str.includes(picked.token))?.x ?? undefined;
      const nature = resolveExtratoDebCredNature({
        row,
        rowLine,
        valorTexto: picked.token,
        negative: picked.negative,
        naturezaCol: out.natureza,
        valorDebitoCol: debColMapped ? debCol : null,
        valorCreditoCol: credColMapped ? credCol : null,
        pickCx,
        imgWidth,
      });
      if (nature === 'D') {
        out.valorDebito = picked.token;
        out.valorCredito = '';
      } else {
        out.valorCredito = picked.token;
        out.valorDebito = '';
      }
      deb = parseMoedaPtFromExtratoColuna(out.valorDebito ?? '');
      cred = parseMoedaPtFromExtratoColuna(out.valorCredito ?? '');
    }
  }

  const rowLineFull = rowIn
    .slice()
    .sort((a, b) => a.x - b.x)
    .map((it) => it.str)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const multilineOcr = buildLinhaOcrMultilinha(rowIn);
  out._linhaOcr = rowLineFull || multilineOcr || rowLine;

  if (segmento) {
    if (!historicoColunaStrict) {
      const histSegmento = buildHistoricoFromSegmento(segmento, colMap, imgWidth);
      if (histSegmento) {
        out.descricao = fixOcrHistoricoLine(histSegmento);
      }
    }
    const linhaSeg = buildLinhaOcrFromSegmento(segmento);
    if (linhaSeg) out._linhaOcr = linhaSeg;
  } else if (!historicoColunaStrict) {
    const multilineDesc = buildDescricaoMultilinhaDoCluster(rowIn, colMap, imgWidth);
    if (multilineDesc) {
      out.descricao = fixOcrHistoricoLine(multilineDesc);
    }

    const descMerged = resolveExtratoDescricaoText(out);
    if (descMerged && !multilineDesc) {
      out.descricao = descMerged;
    } else if (descMerged && multilineDesc) {
      out.descricao = fixOcrHistoricoLine(descMerged.length >= multilineDesc.length ? descMerged : multilineDesc);
    } else if (!multilineDesc) {
      const bucketsFull = assignOcrItemsToColumnsExclusive(rowIn, allCols, imgWidth);
      anexarOrfaosColunaDescricao(rowIn, bucketsFull, colMap, imgWidth);
      const inferred =
        inferExtratoDescricaoFromCluster(rowIn, colMap, bucketsFull, imgWidth) ||
        inferExtratoDescricaoFromCluster(rowDesc, colMap, bucketsDesc, imgWidth);
      if (inferred) out.descricao = inferred;
    }

    if (out.descricao && !multilineDesc) {
      out.descricao = limparHistoricoExtratoMisturado(fixOcrHistoricoLine(out.descricao));
    }
  }

  const descCol = colMap['descricao'];
  let descTexto = resolveExtratoDescricaoText(out).trim();
  const linhaOcrParaInferencia =
    String(out._linhaOcr ?? '').trim() || multilineOcr || rowLineFull || rowLine;
  if (!historicoColunaStrict && !extratoHistoricoEhPlausivel(descTexto) && linhaOcrParaInferencia) {
    const reinfer = inferDescricaoFromLinhaOcr(linhaOcrParaInferencia, out);
    if (extratoHistoricoEhPlausivel(reinfer)) {
      out.descricao = limparHistoricoExtratoMisturado(fixOcrHistoricoLine(reinfer));
      descTexto = out.descricao.trim();
    }
  }
  if (
    !historicoColunaStrict &&
    (!descTexto || extratoDescricaoIgnorarIndicadorDc(descTexto) === '') &&
    linhaOcrParaInferencia
  ) {
    const reinferHist = inferDescricaoFromLinhaOcr(linhaOcrParaInferencia, out);
    if (reinferHist && extratoHistoricoEhPlausivel(reinferHist)) {
      out.descricao = limparHistoricoExtratoMisturado(fixOcrHistoricoLine(reinferHist));
    }
  }
  const temValor =
    deb > 0 ||
    cred > 0 ||
    misto > 0 ||
    parseMoedaPtFromExtratoColuna(out.valorDebito ?? '') > 0 ||
    parseMoedaPtFromExtratoColuna(out.valorCredito ?? '') > 0 ||
    parseMoedaPtFromExtratoColuna(out.valorMisto ?? '') > 0 ||
    Boolean(segmento?.valorToken);
  if (!historicoColunaStrict && !descTexto && temValor) {
    const multilineDesc = buildDescricaoMultilinhaDoCluster(rowIn, colMap, imgWidth);
    if (multilineDesc && extratoHistoricoEhPlausivel(multilineDesc)) {
      out.descricao = limparHistoricoExtratoMisturado(fixOcrHistoricoLine(multilineDesc));
      descTexto = out.descricao.trim();
    }
    if (!descTexto && linhaOcrParaInferencia) {
      const inferredValor = inferDescricaoFromLinhaOcr(linhaOcrParaInferencia, out);
      if (extratoHistoricoEhPlausivel(inferredValor)) {
        out.descricao = limparHistoricoExtratoMisturado(fixOcrHistoricoLine(inferredValor));
        descTexto = out.descricao.trim();
      }
    }
    if (!descTexto) {
      const bucketsFull = assignOcrItemsToColumnsExclusive(rowIn, allCols, imgWidth);
      anexarOrfaosColunaDescricao(rowIn, bucketsFull, colMap, imgWidth);
      const inferredFull = inferExtratoDescricaoFromCluster(rowIn, colMap, bucketsFull, imgWidth);
      if (extratoHistoricoEhPlausivel(inferredFull)) {
        out.descricao = limparHistoricoExtratoMisturado(fixOcrHistoricoLine(inferredFull));
        descTexto = out.descricao.trim();
      }
    }
  }

  descTexto = resolveExtratoDescricaoText(out).trim();
  if (!temValor && !descTexto && !out.data?.trim()) return null;
  if (descMapeada && !descTexto && !temValor) return null;

  if (segmento) {
    out._extratoSegY = String(Math.round(segmento.yTop));
  } else if (rowIn.length > 0) {
    out._extratoSegY = String(Math.round(Math.min(...rowIn.map((i) => i.y))));
  }

  if (out.data) {
    const dataLimpa = parseExtratoDataOcrText(out.data, statementYear);
    if (dataLimpa) {
      out.data = dataLimpa;
    } else if (ocrItemTokenEhSomenteHora(out.data) || /^[-–—]$/.test(out.data.trim())) {
      out.data = '';
    }
  }
  for (const id of ['valorDebito', 'valorCredito', 'valorMisto'] as const) {
    if (out[id]) {
      const v = sanitizeExtratoValorOcrToken(out[id]);
      if (v) out[id] = v;
    }
  }

  const ocrRow = out as OcrExtratoRow;
  if (extratoHistoricoEhSomenteSaldoInformativo(resolveExtratoDescricaoText(ocrRow))) {
    if (extratoRowHistoricoColunaSaldoDesalinhado(ocrRow)) {
      const limpo = extratoLimparRowHistoricoSaldoDesalinhado(ocrRow);
      Object.assign(out, limpo);
    } else {
      return null;
    }
  } else if (extratoRowEhSaldoInformativo(ocrRow)) {
    return null;
  }
  if (ignoreLineWords.length > 0 && extratoRowContemPalavraIgnorada(out as OcrExtratoRow, ignoreLineWords)) {
    const linhaRec = normalizeLinhaOcrParaSplit(String(out._linhaOcr ?? ''));
    if (
      !extratoLinhaTemLancamentoOperacionalRecuperavel(linhaRec) &&
      !extratoLinhaSaldoTemValorLancamentoColado(linhaRec)
    ) {
      return null;
    }
  }

  return sanitizeExtratoOcrRowColumns(
    extratoCorrigirRowNaturezaValorDesalinhado(
      consolidarColunasValorExtratoRow(out) as OcrExtratoRow,
    ),
  ) as GenericOcrRow;
}

function parseGenericRowFromCluster(
  rowIn: PosicionadoItem[],
  colMap: Record<string, GenericColunaDef>,
  dataColIds: string[],
  headerKeywords: string[],
  imgWidth: number,
  extratoStrict = false,
  ignoreLineWords: string[] = [],
  segmento?: ExtratoLancamentoSegmento,
  statementYear?: string,
): GenericOcrRow | null {
  if (extratoStrict) {
    return parseGenericRowFromClusterExtratoStrict(
      rowIn,
      colMap,
      dataColIds,
      headerKeywords,
      imgWidth,
      ignoreLineWords,
      segmento,
      statementYear,
    );
  }
  const mappedIds = dataColIds.filter((id) => {
    const c = colMap[id];
    return !!c && c.start !== c.end;
  });
  if (mappedIds.length === 0) return null;
  if (linhaEhCabecalhoGenerico(rowIn, colMap, mappedIds, headerKeywords, imgWidth)) return null;

  const row = aplicarIgnorarColunasGenerico(rowIn, colMap, imgWidth);
  const allCols = Object.values(colMap).filter((c): c is GenericColunaDef => !!c);
  const buckets = assignOcrItemsToColumnsExclusive(row, allCols, imgWidth);
  if (mappedIds.includes('descricao')) {
    anexarOrfaosColunaDescricao(row, buckets, colMap, imgWidth);
  }

  const out: GenericOcrRow = {};
  let hasContent = false;
  for (const id of mappedIds) {
    const items = buckets.get(id) ?? [];
    const t = textoFromExclusiveBucket(items, id);
    out[id] = t;
    if (t) hasContent = true;
  }
  return hasContent ? out : null;
}

export type FiltrarFaixaOptions = {
  /** Usuário marcou início/fim: não expandir para cima nem usar página inteira como fallback. */
  strict?: boolean;
};

function extratoFaixaVerticalTolerancias(medianH: number) {
  return {
    tolInicio: Math.min(8, medianH * 0.35),
    /** Só exclui quando o topo do token/linha começa abaixo da linha vermelha. */
    tolFimExclusao: Math.min(4, medianH * 0.2),
    tolInicioExclusao: Math.min(4, medianH * 0.2),
  };
}

/**
 * Faixa vertical do extrato (linha verde → linha vermelha).
 * Fim: inclui tudo acima da linha vermelha; exclui só o que começa abaixo dela.
 */
export function itemDentroFaixaVerticalExtrato(
  it: PosicionadoItem,
  yMin: number,
  yMax: number,
  medianH: number,
  strict: boolean,
): boolean {
  const h = it.h > 0 ? it.h : medianH;
  const { tolInicio } = extratoFaixaVerticalTolerancias(medianH);

  if (!strict) {
    const cy = it.y + h / 2;
    return cy >= Math.max(0, yMin - tolInicio) && cy <= yMax + Math.max(12, medianH * 0.95);
  }

  // Estrito real: nada acima da verde e nada abaixo da vermelha.
  if (it.y < yMin) return false;
  if (it.y + h > yMax) return false;
  return true;
}

function clusterDentroFaixaVerticalExtrato(
  cluster: PosicionadoItem[],
  yMin: number,
  yMax: number,
  medianH: number,
): boolean {
  if (cluster.length === 0) return false;
  const { yTop, yBottom } = clusterBoundsY(cluster);
  void medianH;
  if (yTop < yMin) return false;
  if (yBottom > yMax) return false;
  return true;
}

function valorTokenDentroFaixaVerticalExtrato(
  valorToken: PosicionadoItem,
  yMin: number,
  yMax: number,
  medianH: number,
): boolean {
  return clusterDentroFaixaVerticalExtrato([valorToken], yMin, yMax, medianH);
}

function clusterCentroY(cluster: PosicionadoItem[]): number {
  return cluster.reduce((s, it) => s + it.y + it.h / 2, 0) / cluster.length;
}

function clusterBoundsY(cluster: PosicionadoItem[]): { yTop: number; yBottom: number } {
  return {
    yTop: Math.min(...cluster.map((it) => it.y)),
    yBottom: Math.max(...cluster.map((it) => it.y + it.h)),
  };
}

/**
 * Filtra linhas (clusters) pela faixa verde→vermelha.
 * Linha vermelha: último lançamento acima dela entra; só exclui o que começa abaixo.
 */
function filtrarClustersDentroDaFaixa(
  clusters: PosicionadoItem[][],
  faixa: ParcelamentoFaixaDados,
  medianH = 12,
): PosicionadoItem[][] {
  const yMin = Math.min(faixa.startY, faixa.endY);
  const yMax = Math.max(faixa.startY, faixa.endY);

  return clusters.filter((cluster) =>
    clusterDentroFaixaVerticalExtrato(cluster, yMin, yMax, medianH),
  );
}

/**
 * Escopo OCR do extrato — mesma regra na prévia e na importação:
 * prepara tokens, filtra corpo automático sem faixa manual, aplica faixa strict quando marcada.
 */
export function scopeExtratoOcrItemsPreExtract(
  items: PosicionadoItem[],
  faixa: ParcelamentoFaixaDados | undefined,
  imgHeight: number,
  strictFaixaVertical: boolean,
): PosicionadoItem[] {
  const itemsFixed = prepararItensOcrParaExtrato(items);
  const imgWidth = Math.max(...itemsFixed.map((i) => i.x + i.w), 1);

  let faixaUse = faixa;
  if (faixaUse && !strictFaixaVertical) {
    const y0 = Math.min(faixaUse.startY, faixaUse.endY);
    const y1 = Math.max(faixaUse.startY, faixaUse.endY);
    const expanded = expandExtratoFaixaPorValoresCorpo(itemsFixed, y0, y1, imgWidth);
    faixaUse = { startY: expanded.faixaStart, endY: expanded.faixaEnd };
  }

  if (!faixaUse) {
    return filterOcrItemsToExtratoBody(itemsFixed);
  }

  const strict = strictFaixaVertical && !!faixaUse;
  let scoped = filtrarItemsPorFaixa(itemsFixed, faixaUse, imgHeight, { strict });

  if (strict && scoped.length === 0 && itemsFixed.length > 0) {
    // Em modo estrito não faz fallback/relaxamento de faixa.
    scoped = [];
  }

  return scoped;
}

/** Mantém só trechos OCR dentro da faixa vertical (linha de início → linha de fim). */
export function filtrarItemsPorFaixa(
  items: PosicionadoItem[],
  faixa: ParcelamentoFaixaDados | undefined,
  imgHeight: number,
  options?: FiltrarFaixaOptions,
): PosicionadoItem[] {
  if (!faixa) return items;

  const strict = options?.strict === true;
  const yMin = Math.min(faixa.startY, faixa.endY);
  const yMax = Math.max(faixa.startY, faixa.endY);

  const heights = items.map((i) => i.h).filter((h) => h > 0).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 12;

  let filtrados = items.filter((it) =>
    itemDentroFaixaVerticalExtrato(it, yMin, yMax, medianH, strict),
  );

  if (strict) {
    return filtrados;
  }

  const bandaH = yMax - yMin;
  if (items.length > 0 && (filtrados.length === 0 || bandaH < 4)) {
    filtrados = items;
  }

  return filtrados;
}

/** Limita tokens OCR à faixa Y do corpo do extrato (cabeçalho/rodapé fora). */
export function filterOcrItemsToExtratoBody(items: PosicionadoItem[]): PosicionadoItem[] {
  if (items.length < 8) return items;
  const imgWidth = Math.max(...items.map((i) => i.x + i.w), 1);
  const rowClusters = clusterLinhasExtratoPosicional(items);
  let firstY = -1;
  let lastY = -1;
  const ruido =
    /saldo\s+anterior|total\s+(de\s+)?(d[eé]bitos|c[ré]ditos)|consultas\s*-\s*extrato|internet\s+banking|extrato\s+de\s+conta|ag[eê]ncia\s*:|per[ií]odo\s*:/i;

  const valorXs = items
    .filter((it) => extrairMoedasDoTexto(it.str).some((v) => v > 0.01 && v < 50_000_000))
    .map((it) => it.x)
    .sort((a, b) => a - b);
  const valorMinX =
    valorXs.length > 0
      ? Math.max(imgWidth * 0.38, valorXs[Math.floor(valorXs.length * 0.12)]! - 12)
      : imgWidth * 0.44;

  for (const row of rowClusters) {
    const line = row
      .map((it) => it.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!line || ruido.test(line)) continue;
    const cy = row.reduce((s, it) => s + it.y + it.h / 2, 0) / row.length;
    const temDataCol = row.some(
      (it) => it.x < imgWidth * 0.28 && RE_DATA.test(normalizeOcrTexto(it.str)),
    );
    const temValorCol = row.some((it) => {
      if (it.x + it.w / 2 < valorMinX) return false;
      return extrairMoedasDoTexto(it.str).some((v) => v > 0.01 && v < 50_000_000);
    });
    if (!temDataCol && !temValorCol) continue;
    if (firstY < 0) firstY = cy;
    lastY = Math.max(lastY, cy);
  }

  for (const it of items) {
    if (it.x + it.w / 2 < valorMinX) continue;
    if (!extrairMoedasDoTexto(it.str).some((v) => v > 0.01 && v < 50_000_000)) continue;
    const cy = it.y + it.h / 2;
    if (firstY < 0) firstY = cy;
    lastY = Math.max(lastY, cy);
  }

  if (firstY < 0 || lastY < firstY) return items;

  const heights = items.map((i) => i.h).filter((h) => h > 0).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 12;
  const pad = Math.max(6, medianH * 0.6);
  const yMin = Math.max(0, firstY - pad);
  let yMax = lastY + pad * 2;
  const footerY = items
    .filter((it) =>
      /cheque\s+especial\s+contratado|\(\+\)\s*saldo|\(-\)\s*tarifas|0800\s+\d|ouvidoria|extrato\s+para\s+simples/i.test(
        normalizeOcrTexto(it.str),
      ),
    )
    .map((it) => it.y);
  if (footerY.length > 0) {
    const fy = Math.min(...footerY);
    if (fy > lastY + medianH * 2) yMax = Math.min(yMax, fy - pad);
  }

  return items.filter((it) => {
    const cy = it.y + it.h / 2;
    return cy >= yMin && cy <= yMax;
  });
}

export function scaleGenericMapping(
  mapping: GenericColunasMapping,
  fromW: number,
  fromH: number,
  toW: number,
  toH: number
): GenericColunasMapping {
  if (fromW <= 0 || fromH <= 0 || (fromW === toW && fromH === toH)) return mapping;
  const sx = toW / fromW;
  const sy = toH / fromH;
  return {
    columns: mapping.columns.map((c) => ({
      ...c,
      start: c.start * sx,
      end: c.end * sx,
    })),
    faixa: mapping.faixa
      ? {
        startY: mapping.faixa.startY * sy,
        endY: mapping.faixa.endY * sy,
      }
      : undefined,
  };
}

export function mappingGenericoEmCoordsOcr(
  columns: GenericColunaDef[],
  faixa: ParcelamentoFaixaDados | undefined,
  clickW: number,
  clickH: number,
  refW: number,
  refH: number
): GenericColunasMapping {
  const base = { columns, faixa };
  if (clickW <= 0 || clickH <= 0 || (clickW === refW && clickH === refH)) return base;
  return scaleGenericMapping(base, clickW, clickH, refW, refH);
}

export type ExtractGenericOptions = {
  dataColIds: string[];
  headerKeywords?: string[];
  allowFaixaFallback?: boolean;
  /** Início/fim marcados: não extrair acima da linha verde nem ignorar a faixa. */
  strictFaixaVertical?: boolean;
  /** Extrato bancário: cluster fino, propagação de data e divisão de linhas fundidas. */
  extratoPositional?: boolean;
  statementYear?: string;
  /** Texto OCR completo — usado no layout BB escaneado. */
  ocrFullText?: string;
  /** Linhas que contiverem qualquer palavra são descartadas (case-insensitive). */
  ignoreLineWords?: string[];
  /** Não fundir linhas só-valor com anterior (modo segmentação 1:1 por valor). */
  extratoPreserveSegmentRows?: boolean;
  /** Plano de contas: cluster fino por linha física (não fundir linhas adjacentes). */
  planoPositional?: boolean;
  /** @deprecated Ignorado — extração usa OCR posicional puro (segmentador único). */
  sicoobValorUnicoLayout?: boolean;
};

function extratoRowFallbackFromSegmento(
  segmento: ExtratoLancamentoSegmento,
  colMap: Record<string, GenericColunaDef>,
  imgWidth: number,
): GenericOcrRow | null {
  if (!segmento.valorToken) return null;
  const vt = segmento.valorToken.str.trim();
  const normalized = normalizeExtratoValorColunaOcr(vt);
  const tokenMatch = normalized.match(/\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/);
  if (!tokenMatch) return null;
  const token = tokenMatch[0];
  const nature =
    parseExtratoNaturezaNoValor(vt) ??
    parseExtratoNaturezaFromRowItems(segmento.cluster) ??
    (/^[-−]/.test(vt) ? 'D' : 'C');
  const out: GenericOcrRow = {};
  if (segmento.dataToken) {
    const dataLimpa = sanitizeExtratoDataOcrToken(segmento.dataToken.str);
    if (dataLimpa) out.data = dataLimpa;
  }
  const histColDef = resolveHistoricoColDefExtrato(colMap);
  if (histColDef) {
    const strict = montarTextoHistoricoColunaDescricao(segmento.cluster, histColDef, imgWidth, {
      colMap,
      valorToken: segmento.valorToken,
      clusterItems: segmento.cluster,
    });
    if (strict) {
      if (histColDef.id === 'descricao' || !out.descricao) out.descricao = strict;
      if (histColDef.id === 'historicoOperacao') out.historicoOperacao = strict;
      if (histColDef.id === 'historico') out.historico = strict;
      out._extratoHistoricoColuna = '1';
    }
  } else {
    const hist = buildHistoricoFromSegmento(segmento, colMap, imgWidth);
    if (hist) out.descricao = fixOcrHistoricoLine(hist);
  }
  const mistoCol = colMap['valorMisto'];
  if (mistoCol && mistoCol.start !== mistoCol.end) {
    out.valorMisto =
      nature === 'D'
        ? /^[-−]/.test(vt)
          ? `-${token}`
          : `${token} D`
        : nature === 'C'
          ? `${token} C`
          : token;
  } else if (nature === 'D') {
    out.valorDebito = /^[-−]/.test(vt) ? `-${token}` : token;
  } else {
    out.valorCredito = token;
  }
  out._linhaOcr = buildLinhaOcrFromSegmento(segmento) ||
    segmento.cluster
      .slice()
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((i) => i.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  return out;
}

/** Recupera lançamentos faltantes após auditoria linha a linha (valores órfãos na coluna). */
export function recoverExtratoPageRowsComAuditoria(
  items: PosicionadoItem[],
  rows: GenericOcrRow[],
  mapping: GenericColunasMapping,
  imgHeight: number,
  imgWidth: number,
  ignoreWords: string[] = [],
): GenericOcrRow[] {
  const valorBounds = resolveExtratoValorColBoundsFromColumns(mapping.columns, imgWidth);
  const useStrictFaixa = !!mapping.faixa;
  const scoped = scopeExtratoOcrItemsPreExtract(
    items,
    mapping.faixa,
    imgHeight,
    useStrictFaixa,
  );
  const segmentos = segmentarExtratoEmLancamentos(scoped, imgWidth, {
    ignoreWords,
    valorColX: valorBounds ?? undefined,
    modoAncladoValores: true,
  });
  const audit = auditarCoberturaValoresExtrato(
    scoped,
    segmentos,
    imgWidth,
    valorBounds ?? undefined,
    ignoreWords,
  );
  if (audit.ok || audit.valoresOrfaos.length === 0) return rows;

  const colMap = Object.fromEntries(
    mapping.columns.filter((c) => c.start !== c.end).map((c) => [c.id, c]),
  );
  const out = [...rows];
  const rowKeys = new Set(out.map((r) => String(r._linhaOcr ?? r.descricao ?? '').trim()));

  const heights = scoped.map((i) => i.h).filter((h) => h > 0).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 12;
  const yTol = Math.max(8, Math.round(medianH * 0.55));

  const valorTokensMatch = (a: string, b: string) => {
    const na = sanitizeExtratoValorOcrToken(a).replace(/\s/g, '');
    const nb = sanitizeExtratoValorOcrToken(b).replace(/\s/g, '');
    return na.length > 0 && (na === nb || na.endsWith(nb) || nb.endsWith(na));
  };

  for (const orfao of audit.valoresOrfaos) {
    const cy = orfao.y + orfao.h / 2;
    let seg: ExtratoLancamentoSegmento | undefined = segmentos.find(
      (s) =>
        s.valorToken &&
        Math.abs(s.valorToken.y + s.valorToken.h / 2 - cy) <= yTol + 8 &&
        valorTokensMatch(s.valorToken.str, orfao.str),
    );
    if (!seg) {
      const lineCluster = scoped
        .filter((i) => Math.abs(i.y + i.h / 2 - cy) <= yTol)
        .sort((a, b) => a.x - b.x);
      if (lineCluster.length === 0) continue;
      const dataToken = lineCluster.find((i) => /\d{2}\/\d{2}\/\d{2,4}/.test(i.str)) ?? null;
      const yTop = Math.min(...lineCluster.map((i) => i.y));
      const yBottom = Math.max(...lineCluster.map((i) => i.y + (i.h > 0 ? i.h : medianH)));
      seg = {
        cluster: lineCluster,
        valorToken: orfao,
        linhas: [],
        dataToken,
        historicoTokens: lineCluster.filter((i) => i !== orfao && i !== dataToken),
        yTop,
        yBottom,
        motivoFechamento: 'proximo_valor',
      };
    }
    const row = extratoRowFallbackFromSegmento(seg, colMap, imgWidth);
    if (!row) continue;
    if (seg) row._extratoSegY = String(Math.round(seg.yTop));
    const key = String(row._linhaOcr ?? '').trim();
    if (key && !rowKeys.has(key)) {
      const yNew = Number(row._extratoSegY ?? 0);
      let insertAt = out.length;
      for (let i = 0; i < out.length; i++) {
        const yExist = Number(out[i]!._extratoSegY ?? Infinity);
        if (yNew < yExist) {
          insertAt = i;
          break;
        }
      }
      out.splice(insertAt, 0, row);
      rowKeys.add(key);
    }
  }
  return out;
}

export function extractGenericRowsFromMapping(
  items: PosicionadoItem[],
  mapping: GenericColunasMapping,
  imgHeight: number,
  imgWidth: number,
  options: ExtractGenericOptions
): GenericOcrRow[] {
  const colMap = genericColMap(mapping.columns);
  const headerKeywords = options.headerKeywords ?? [];
  const dataColIds = options.dataColIds;
  const statementYear = options.statementYear;

  const useStrictFaixa = options.strictFaixaVertical === true;

  const filtrados = options.extratoPositional
    ? scopeExtratoOcrItemsPreExtract(items, mapping.faixa, imgHeight, useStrictFaixa)
    : filtrarItemsPorFaixa(items, mapping.faixa, imgHeight, { strict: useStrictFaixa });

  let rowClusters: PosicionadoItem[][];
  let extratoSegmentos: ExtratoLancamentoSegmento[] = [];
  if (options.extratoPositional) {
    const heights = filtrados.map((i) => i.h).filter((h) => h > 0).sort((a, b) => a - b);
    const medianH = heights[Math.floor(heights.length / 2)] || 12;
    const yTolFactor = useStrictFaixa ? 0.36 : 0.4;
    const valorColX = resolveExtratoValorColBoundsFromColumns(mapping.columns, imgWidth);
    extratoSegmentos = segmentarExtratoEmLancamentos(filtrados, imgWidth, {
      yTolFactor,
      ignoreWords: options.ignoreLineWords ?? [],
      valorColX,
      modoAncladoValores: options.extratoPreserveSegmentRows === true,
    });
    rowClusters = extratoSegmentos.map((s) => s.cluster);
    if (rowClusters.length === 0) {
      rowClusters = clusterExtratoUmaLinhaPorValor(filtrados, { yTolFactor });
    }
    if (mapping.faixa && useStrictFaixa && !options.extratoPreserveSegmentRows) {
      if (extratoSegmentos.length > 0) {
        const yMinFaixa = Math.min(mapping.faixa.startY, mapping.faixa.endY);
        const yMaxFaixa = Math.max(mapping.faixa.startY, mapping.faixa.endY);
        extratoSegmentos = extratoSegmentos.filter((s) => {
          if (s.valorToken) {
            return valorTokenDentroFaixaVerticalExtrato(
              s.valorToken,
              yMinFaixa,
              yMaxFaixa,
              medianH,
            );
          }
          return filtrarClustersDentroDaFaixa([s.cluster], mapping.faixa!, medianH).length > 0;
        });
        rowClusters = extratoSegmentos.map((s) => s.cluster);
      } else {
        rowClusters = filtrarClustersDentroDaFaixa(rowClusters, mapping.faixa, medianH);
      }
    }
  } else if (options.planoPositional) {
    rowClusters = clusterPlanoLinhasFisicas(filtrados);
  } else {
    rowClusters = expandClustersComMultiplasDatas(clusterLinhas(filtrados));
  }
  const linhas: GenericOcrRow[] = [];

  if (options.extratoPositional && extratoSegmentos.length > 0) {
    for (const segmento of extratoSegmentos) {
      const parsed =
        parseGenericRowFromCluster(
          segmento.cluster,
          colMap,
          dataColIds,
          headerKeywords,
          imgWidth,
          true,
          options.ignoreLineWords ?? [],
          segmento,
          statementYear,
        ) ?? extratoRowFallbackFromSegmento(segmento, colMap, imgWidth);
      if (parsed) {
        if (!parsed._extratoSegY) {
          parsed._extratoSegY = String(Math.round(segmento.yTop));
        }
        linhas.push(parsed);
        continue;
      }
      if (!segmento.valorToken) continue;
      const vt = segmento.valorToken.str.trim();
      const tokenMatch = vt.match(/\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2}/);
      const linhaOcr = segmento.cluster
        .slice()
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map((i) => i.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      linhas.push({
        valorMisto: tokenMatch ? tokenMatch[0] : vt,
        _linhaOcr: linhaOcr || vt,
        _extratoSegY: String(Math.round(segmento.yTop)),
      });
    }
  } else if (options.planoPositional) {
    for (const row of rowClusters) {
      const rowFiltered = filtrarMarcadorMargemPlanoDominio(row);
      if (linhaEhMetadadoPlano(rowFiltered)) continue;
      const linhaOcr = linhaOcrTextoFromCluster(rowFiltered);
      let parsed = parseGenericRowFromCluster(
        rowFiltered,
        colMap,
        dataColIds,
        headerKeywords,
        imgWidth,
        false,
        [],
      );
      if (!parsed && linhaOcr) {
        parsed = { descricao: linhaOcr, _linhaOcr: linhaOcr };
      } else if (parsed) {
        parsed._linhaOcr = linhaOcr || parsed._linhaOcr;
      }
      if (parsed) linhas.push(parsed);
    }
  } else {
    for (const row of rowClusters) {
      const parsed = parseGenericRowFromCluster(
        row,
        colMap,
        dataColIds,
        headerKeywords,
        imgWidth,
        options.extratoPositional === true,
        options.ignoreLineWords ?? [],
      );
      if (parsed) linhas.push(parsed);
    }
  }

  // Pós-processamento Itaú (SISPAG, TED, IOF) roda após enrichItauExtratoRowsFromPageItems
  // em DocumentColunasModal / extractExtratoFromPosicionadoPages → mapOcrRowsToImportItems.
  if (linhas.length > 0 && (options.extratoPositional || colMap['data'])) {
    if (options.extratoPositional && options.strictFaixaVertical && mapping.faixa) {
      const yMinFaixa = Math.min(mapping.faixa.startY, mapping.faixa.endY);
      const yMaxFaixa = Math.max(mapping.faixa.startY, mapping.faixa.endY);
      const headerNoise = /saldo\s+anterior|saldo\s+total\s+dispon[íi]vel|saldo\s+do\s+dia|total\s+de\s+(?:d[eé]bitos|cr[eé]ditos)/i;
      return linhas.filter((r) => {
        const segY = Number(r._extratoSegY ?? NaN);
        if (Number.isFinite(segY) && (segY < yMinFaixa || segY > yMaxFaixa)) return false;
        const linha = String(r._linhaOcr ?? r.descricao ?? '').replace(/\s+/g, ' ').trim();
        const temValor =
          /\d{1,3}(?:\.\d{3})*,\d{2}/.test(String(r.valorMisto ?? '')) ||
          /\d{1,3}(?:\.\d{3})*,\d{2}/.test(String(r.valorDebito ?? '')) ||
          /\d{1,3}(?:\.\d{3})*,\d{2}/.test(String(r.valorCredito ?? ''));
        if (temValor && headerNoise.test(linha)) return false;
        return true;
      });
    }
    return linhas;
  }

  if (
    linhas.length === 0 &&
    options.extratoPositional &&
    extratoSegmentos.length > 0
  ) {
    for (const segmento of extratoSegmentos) {
      const parsed = parseGenericRowFromCluster(
        segmento.cluster,
        colMap,
        dataColIds,
        headerKeywords,
        imgWidth,
        false,
        options.ignoreLineWords ?? [],
        segmento,
        statementYear,
      );
      if (parsed) linhas.push(parsed);
    }
    if (linhas.length > 0) return linhas;
  }

  if (linhas.length === 0 && items.length > 0) {
    const noMoreFallback: ExtractGenericOptions = { ...options, allowFaixaFallback: false };

    if (!options.strictFaixaVertical && mapping.faixa) {
      const relaxed = extractGenericRowsFromMapping(
        items,
        mapping,
        imgHeight,
        imgWidth,
        { ...noMoreFallback, strictFaixaVertical: false },
      );
      if (relaxed.length > 0) return relaxed;
    }

    if (!options.strictFaixaVertical && mapping.faixa) {
      const semFaixa = extractGenericRowsFromMapping(
        items,
        { columns: mapping.columns },
        imgHeight,
        imgWidth,
        { ...noMoreFallback, strictFaixaVertical: false },
      );
      if (semFaixa.length > 0) return semFaixa;
    }

    throw new Error(
      'Nenhuma linha extraída. Marque as colunas na imagem (dois cliques: esquerda e direita) e as linhas verde/vermelha de início e fim dos lançamentos.'
    );
  }

  return linhas;
}

export type ExtratoPosicionadoPage = {
  items: PosicionadoItem[];
  imgWidth: number;
  imgHeight: number;
  ocrFullText?: string;
};

export function scaleExtratoColumnsToWidth(
  columns: GenericColunaDef[],
  fromW: number,
  toW: number,
): GenericColunaDef[] {
  if (fromW <= 0 || Math.abs(fromW - toW) < 2) return columns;
  const k = toW / fromW;
  return columns.map((c) => ({
    ...c,
    start: c.start * k,
    end: c.end * k,
  }));
}

/**
 * Extrato com colunas e faixa fixadas na pág. 1 (mapeamento manual na UI).
 * Faixa das demais páginas é recalculada automaticamente.
 */
export async function extractExtratoFromPosicionadoPagesWithManualColumns(
  pages: ExtratoPosicionadoPage[],
  page1Columns: GenericColunaDef[],
  page1Faixa: { faixaStart: number; faixaEnd: number },
  options: ExtractGenericOptions,
): Promise<GenericOcrRow[]> {
  const { suggestExtratoFaixaForPage, enrichItauExtratoRowsFromPageItems } = await import(
    './pdfNativeTextItems'
  );

  const allRows: GenericOcrRow[] = [];
  const savedColumnsWidth = pages[0]?.imgWidth ?? 0;
  if (savedColumnsWidth <= 0 || page1Columns.every((c) => c.start === c.end)) return [];

  for (let i = 0; i < pages.length; i++) {
    const { items, imgWidth, imgHeight, ocrFullText } = pages[i]!;
    const pageNum = i + 1;
    const columns = scaleExtratoColumnsToWidth(page1Columns, savedColumnsWidth, imgWidth);
    let faixaStart = page1Faixa.faixaStart;
    let faixaEnd = page1Faixa.faixaEnd;
    if (pageNum > 1) {
      const faixa = suggestExtratoFaixaForPage(items, imgHeight, imgWidth);
      faixaStart = faixa.faixaStart;
      faixaEnd = faixa.faixaEnd;
    } else if (pages[0]!.imgHeight > 0 && imgHeight !== pages[0]!.imgHeight) {
      const sy = imgHeight / pages[0]!.imgHeight;
      faixaStart *= sy;
      faixaEnd *= sy;
    }

    const mapping = mappingGenericoEmCoordsOcr(
      columns,
      { startY: faixaStart, endY: faixaEnd },
      imgWidth,
      imgHeight,
      imgWidth,
      imgHeight,
    );

    let rows: GenericOcrRow[] = [];
    const tryExtract = (strict: boolean) =>
      extractGenericRowsFromMapping(items, mapping, imgHeight, imgWidth, {
        ...options,
        allowFaixaFallback: pageNum === 1 && options.allowFaixaFallback !== false,
        strictFaixaVertical: strict,
        ocrFullText: ocrFullText ?? options.ocrFullText,
      });
    try {
      rows = tryExtract(false);
    } catch {
      try {
        rows = tryExtract(true);
      } catch {
        rows = [];
      }
    }
    if (rows.length > 0) {
      rows = enrichItauExtratoRowsFromPageItems(items, rows, imgWidth);
      allRows.push(...rows);
    }
  }

  return allRows;
}

/**
 * Extrato posicional página a página (OCR ou PDF nativo).
 * Colunas da pág. 1, faixa vertical recalculada em cada página.
 */
export async function extractExtratoFromPosicionadoPages(
  pages: ExtratoPosicionadoPage[],
  options: ExtractGenericOptions,
): Promise<GenericOcrRow[]> {
  const {
    suggestExtratoBancarioColumns,
    suggestExtratoFaixaForPage,
    mergeExtratoValorColumnsParaMisto,
  } = await import('./pdfNativeTextItems');

  const allRows: GenericOcrRow[] = [];
  let savedColumns: GenericColunaDef[] | null = null;
  let savedColumnsWidth = 0;

  for (let i = 0; i < pages.length; i++) {
    const { items, imgWidth, imgHeight, ocrFullText } = pages[i]!;
    const pageNum = i + 1;

    let columns = savedColumns;
    let faixaStart = 0;
    let faixaEnd = imgHeight;

    const suggested = suggestExtratoBancarioColumns(items, imgWidth);
    if (suggested && suggested.columns.some((c) => c.start !== c.end)) {
      if (!savedColumns) {
        savedColumns = mergeExtratoValorColumnsParaMisto(
          suggested.columns,
          items,
          imgWidth,
          12,
        );
        savedColumnsWidth = imgWidth;
        faixaStart = suggested.faixaStart;
        faixaEnd = suggested.faixaEnd;
      }
      columns = scaleExtratoColumnsToWidth(savedColumns, savedColumnsWidth, imgWidth);
      if (pageNum > 1) {
        const faixa = suggestExtratoFaixaForPage(items, imgHeight, imgWidth);
        faixaStart = faixa.faixaStart;
        faixaEnd = faixa.faixaEnd;
      }
    } else if (columns) {
      columns = scaleExtratoColumnsToWidth(columns, savedColumnsWidth, imgWidth);
      const faixa = suggestExtratoFaixaForPage(items, imgHeight, imgWidth);
      faixaStart = faixa.faixaStart;
      faixaEnd = faixa.faixaEnd;
    } else {
      continue;
    }

    const mapping = mappingGenericoEmCoordsOcr(
      columns,
      { startY: faixaStart, endY: faixaEnd },
      imgWidth,
      imgHeight,
      imgWidth,
      imgHeight,
    );

    let rows: GenericOcrRow[] = [];
    const tryExtract = (strict: boolean) =>
      extractGenericRowsFromMapping(items, mapping, imgHeight, imgWidth, {
        ...options,
        allowFaixaFallback: pageNum === 1 && options.allowFaixaFallback !== false,
        strictFaixaVertical: strict,
        ocrFullText: ocrFullText ?? options.ocrFullText,
      });
    try {
      rows = tryExtract(false);
    } catch {
      try {
        rows = tryExtract(true);
      } catch {
        rows = [];
      }
    }
    if (rows.length > 0) {
      rows = recoverExtratoPageRowsComAuditoria(
        items,
        rows,
        mapping,
        imgHeight,
        imgWidth,
        options.ignoreLineWords ?? [],
      );
      const { enrichItauExtratoRowsFromPageItems } = await import('./pdfNativeTextItems');
      rows = enrichItauExtratoRowsFromPageItems(items, rows, imgWidth);
      allRows.push(...rows);
    }
  }

  return allRows;
}

/**
 * Extrato PDF — somente OCR scanner (rasteriza + DocTR). Não usa getTextContent.
 */
export async function extractExtratoPdfScannerOcrAllPages(
  pdfDoc: import('pdfjs-dist').PDFDocumentProxy,
  scale: number,
  options: ExtractGenericOptions,
  onProgress?: (msg: string) => void,
): Promise<GenericOcrRow[]> {
  const pages: ExtratoPosicionadoPage[] = [];

  for (let p = 1; p <= pdfDoc.numPages; p++) {
    onProgress?.(PDF_SCANNER_OCR_MSG.ocrPagina(p, pdfDoc.numPages));
    const pageOcr = await completePdfPageOcrWithExtratoScaleFallback(
      pdfDoc,
      p,
      scale,
      onProgress,
      OCR_EXTRATO_EXTRACT_OCR_OPTIONS,
      { adaptiveExtratoScale: true, deferOcr: false, useCache: false },
    );
    if (pageOcr.ocrSource !== 'ocr') {
      throw new Error('Extrato exige OCR na imagem — texto nativo do PDF não é usado.');
    }
    pages.push({
      items: pageOcr.items,
      imgWidth: pageOcr.imgWidth,
      imgHeight: pageOcr.imgHeight,
      ocrFullText: pageOcr.ocrFullText,
    });
  }

  return extractExtratoFromPosicionadoPages(pages, options);
}

/**
 * @deprecated Proibido — use extractExtratoPdfScannerOcrAllPages (OCR scanner).
 */
export async function extractExtratoNativePdfAllPages(
  _pdfDoc: import('pdfjs-dist').PDFDocumentProxy,
  _scale: number,
  _options: ExtractGenericOptions,
  _onProgress?: (msg: string) => void,
): Promise<GenericOcrRow[]> {
  const { bloquearExtratoParser } = await import('./extratoScannerOnlyPolicy');
  bloquearExtratoParser('extractExtratoNativePdfAllPages');
  return [];
}

function buildExtratoPdfExtractOptions(
  statementYear: string,
  ignoreLineWords: string[],
  ocrFullText?: string,
  perfilItau = false,
): ExtractGenericOptions {
  if (perfilItau) {
    return getItauExtratoExtractGenericOptions(statementYear, ignoreLineWords, ocrFullText);
  }
  return {
    dataColIds: ['data', 'descricao', 'valorCredito', 'valorDebito', 'valorMisto'],
    headerKeywords: ['saldo anterior', 'data', 'historico', 'valor', 'lancamento'],
    allowFaixaFallback: true,
    extratoPositional: true,
    extratoPreserveSegmentRows: true,
    statementYear,
    ocrFullText,
    ignoreLineWords,
  };
}

/** PDF extrato: somente OCR scanner (rasteriza + DocTR). */
export async function ocrPdfFileToExtratoRows(
  file: File,
  onProgress?: (msg: string) => void,
): Promise<GenericOcrRow[]> {
  onProgress?.(PDF_SCANNER_OCR_MSG.limpando);
  onProgress?.(PDF_SCANNER_OCR_MSG.abrindo);
  const buf = await file.arrayBuffer();
  const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;

  const { parseOcrIgnoreLineWords } = await import('./ocrExtratoPositional');
  const { getOcrUserSettings } = await import('./ocrUserSettings');
  const ignoreLineWordsBase = parseOcrIgnoreLineWords(getOcrUserSettings().ignoreLineWords);
  const statementYearGuess = String(new Date().getFullYear());
  const baseOpts = buildExtratoPdfExtractOptions(statementYearGuess, ignoreLineWordsBase);

  const page1 = await pdfDoc.getPage(1);
  const scale = computeAdaptiveExtratoPdfRenderScale(page1);
  onProgress?.('Convertendo PDF para imagem scanner…');
  return extractExtratoPdfScannerOcrAllPages(pdfDoc, scale, baseOpts, onProgress);
}

export function previewExtracaoGenerica(
  items: PosicionadoItem[],
  columns: GenericColunaDef[],
  faixa: ParcelamentoFaixaDados | undefined,
  imgHeight: number,
  imgWidth: number,
  dataColIds: string[],
  headerKeywords: string[] = [],
  clickW = imgWidth,
  clickH = imgHeight,
  extratoPositional = false,
  statementYear?: string,
): GenericOcrRow[] | null {
  if (items.length === 0 || columns.every((c) => c.start === c.end)) return null;
  try {
    const mapping = mappingGenericoEmCoordsOcr(columns, faixa, clickW, clickH, imgWidth, imgHeight);
    return extractGenericRowsFromMapping(items, mapping, imgHeight, imgWidth, {
      dataColIds,
      headerKeywords,
      allowFaixaFallback: true,
      extratoPositional,
      statementYear,
    });
  } catch {
    return null;
  }
}
