/** Modal OCR por colunas — extrato / parcelamento (sem dependência de ícones extras). */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useDeferredValue, Fragment, type ReactNode, type SyntheticEvent, type MouseEvent } from 'react';
import {
  X,
  Settings2,
  MousePointer2,
  ZoomIn,
  ZoomOut,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ListFilter,
  Building2,
  Save,
  FolderOpen,
  Trash2,
} from 'lucide-react';
import {
  loadDocumentoParcelamentoPreview,
  renderPdfPagePreview,
  getCachedPdfPagePreview,
  completePdfPageOcr,
  PDF_PAGE_OCR_TIMEOUT_MS,
  invalidatePdfPageCacheEntry,
  setCachedPdfPagePreview,
  clearPdfPagePreviewCache,
  safeRevokePdfPreviewUrl,
  extractGenericRowsFromMapping,
  extractParcelamentoFromMapping,
  extractExtratoFromPosicionadoPages,
  mappingGenericoEmCoordsOcr,
  mappingParcelamentoEmCoordsOcr,
  refreshOcrItemsFromPreviewUrl,
  filtrarItemsPorFaixa,
  scopeExtratoOcrItemsPreExtract,
  fileIsLikelyPdf,
  PDF_SCANNER_OCR_MSG,
  type GenericColunaDef,
  type GenericColunasMapping,
  type GenericOcrRow,
  type DocumentoParcelamentoPreview,
  type PdfPagePreviewResult,
  type ParcelamentoColunaDef,
  type ExtratoPosicionadoPage,
  OCR_EXTRATO_LOAD_OPTIONS,
  OCR_EXTRATO_OCR_OPTIONS,
  OCR_EXTRATO_EXTRACT_OCR_OPTIONS,
  recoverExtratoPageRowsComAuditoria,
  resolvePdfRenderScale,
  completePdfPageOcrWithExtratoScaleFallback,
  type LoadParcelamentoPreviewOptions,
} from '../../lib/parcelamentoColunasExtract';
import type { ParcelamentoPlanilhaImport } from '../../lib/parcelamentoPlanilha';
import type { OcrColunaCampoDef } from '../logic/ocrColunasConfig';
import { cn } from '../lib/utils';
import './DocumentColunasModal.css';
import { useElementLayoutStyle } from '../lib/useElementLayoutStyle';
import {
  PDF_RENDER_SCALE_DEFAULT,
  PDF_RENDER_SCALE_CHOICES,
  clampPdfRenderScale,
  OCR_AUTO_LOAD_OPTIONS,
  warmupSharedOcrWorker,
  type OcrPositionedWord,
  runOcrPortugueseWordsResult,
} from '../../lib/imageOcrExtract';
import {
  getOcrUserSettings,
  setOcrUserSettings,
  ocrSettingsToLoadOptions,
  OCR_RESOLUTION_MODE_LABELS,
  type OcrResolutionMode,
  type OcrUserSettings,
} from '../../lib/ocrUserSettings';
import { extractStatementYear } from '../../extratoVision/utils/parser';
import { enrichItauExtratoRowsFromPageItems, injectDataColumnIfMissing, isBancoBrasilExtratoNome, mergeExtratoValorColumnsParaMisto, suggestExtratoBancarioColumns, suggestPlanoContasColumns, realignPlanoColumnsToPageOcr, expandExtratoFaixaPorValoresCorpo } from '../../lib/pdfNativeTextItems';
import { promiseWithTimeout } from '../../lib/promiseTimeout';
import {
  detectItauExtratoFromPageItems,
  detectItauExtratoFromOcrText,
  mergeItauIgnoreLineWords,
  getItauExtratoExtractGenericOptions,
} from '../../lib/itauExtratoProfile';
// Local definitions and mocks after removing AI features folder
export type AiExtractEngine = 'ai' | 'hybrid';
export const EXTRACT_ENGINE_BANNER_LABELS: Record<AiExtractEngine, string> = {
  ai: 'IA',
  hybrid: 'Híbrido',
};
export function normalizeExtractEngine(_eng?: string | null): AiExtractEngine {
  return 'ai';
}
export async function fetchAiConfig(): Promise<{
  config: {
    tier: string;
    providerId: string;
    model: string;
    localModel: string;
    pricingTier: string;
    extractEngine: AiExtractEngine;
  };
  label: string;
}> {
  return {
    config: {
      tier: 'gemini',
      providerId: 'gemini',
      model: 'gemini-2.5-flash',
      localModel: 'gemini-2.5-flash',
      pricingTier: 'free',
      extractEngine: 'ai' as AiExtractEngine,
    },
    label: 'Google Gemini (Mock)',
  };
}
import {
  extractExtratoWithAi,
  extractPlanoWithAi,
  marcarRowsExtracaoAi,
  previewUrlToBase64,
  refineOcrRowsWithAi,
  fileToBase64Payload,
  type AiExtractExtratoResult,
  type AiExtractPlanoResult,
  type OcrConfirmMeta,
} from '../../lib/aiExtratoExtractClient';
import { notifyDebugModuleLoaded } from '../agent/browserConsoleBridge';
import {
  segmentarExtratoEmLancamentos,
  auditarCoberturaValoresExtrato,
  formatExtratoAuditMensagem,
  validarMapeamentoExtratoOcr,
  resolveExtratoValorColBoundsFromColumns,
  parseOcrIgnoreLineWords,
  extratoLinhasSaldoInformativoDoTextoOcr,
  resolverSaldoAnteriorParaMetaExtrato,
  enrichExtratoHistoricoLinhaOcrFromPageItems,
  prepararExtratoOcrRowsParaRevisao,
  sanitizeExtratoOcrRowColumns,
  mesclarHistoricoContinuacaoExtratoAoVivo,
  propagateExtratoDatesOcrRows,
  repararExtratoRowsSemHistoricoDeTextoOcr,
  type OcrExtratoRow,
} from '../../lib/ocrExtratoPositional';
import type { ExtratoPlanoContaOption } from './ExtratoContaPicker';
import { tagOcrRowsPagina } from '../logic/tagOcrRowsPagina';
import {
  deleteExtratoOcrLayout,
  getActiveExtratoOcrLayout,
  listExtratoOcrLayouts,
  saveExtratoOcrLayout,
  setActiveExtratoOcrLayout,
  type ExtratoOcrLayoutSaved,
} from '../logic/extratoOcrLayoutStorage';
import {
  applyFaixaPorPaginaToStates,
  buildPageMappingSnapshotForExtract,
  buildPageMappingSnapshotForUi,
  collectFaixaMarcadoresGlobais,
  collectFaixaPorPaginaFromStates,
  findFaixaFimPagina,
  findFaixaInicioPagina,
  isStrictFaixaSnapshot,
  resolveExtractPageRange,
  resolveFaixaPorPaginaFromLayout,
  resolveFaixaVerticalFromSnapshot,
  pageSnapshotHasMappedColumns,
} from '../logic/extratoOcrLayoutFaixa';
import { buildExtratoReviewPackage } from '../logic/extratoEscalationPipeline';
import { filterSkippedPagesForExtratoReview } from '../logic/extratoReviewIssues';
import { EXTRATO_EXTRACT_BUILD_ID, EXTRATO_SCANNER_PURE_AI_BUILD_ID, logExtratoExtractBuild } from '../logic/extratoExtractBuild';

/** OCR em segundo plano com resolução automática (Full HD). */

function buildOcrPdfLoadOptions(
  settings: OcrUserSettings,
  base: LoadParcelamentoPreviewOptions,
): LoadParcelamentoPreviewOptions {
  if (settings.resolutionMode === 'auto') {
    return { ...base, deferOcr: true, useCache: true };
  }
  return {
    ...base,
    ...ocrSettingsToLoadOptions(settings),
    adaptiveExtratoScale: false,
    deferOcr: true,
    useCache: true,
  };
}

type Props = {
  file: File;
  title: string;
  confirmLabel: string;
  campoDefs: OcrColunaCampoDef[];
  dataColIds: string[];
  headerKeywords: string[];
  supportsValorModo?: boolean;
  /** Plano de contas: seletor DocTR / IA / Híbrido (sem lógica de valor D/C do extrato). */
  supportsExtractEngine?: boolean;
  /** Cronograma de parcelamento: mesma extração do app antigo (PARCELAMENTO_CAMPOS). */
  extractMode?: 'generic' | 'parcelamento';
  onConfirm?: (rows: GenericOcrRow[], meta?: OcrConfirmMeta) => void;
  onConfirmParcelamento?: (data: ParcelamentoPlanilhaImport) => void;
  onCancel: () => void;
  /** Empresa ativa — layouts OCR extrato ficam por empresa. */
  companyName?: string;
  /** Contas analíticas do plano (para escolher conta banco). */
  planoContaOptions?: ExtratoPlanoContaOption[];
  /**
   * Força o motor inicial (ex.: 'ai' para PDF scanner/imagem).
   * Sobrescreve a preferência salva na aba IA.
   */
  initialExtractEngine?: AiExtractEngine;
  /** Extrato scanner/imagem: somente IA visão — sem OCR posicional, escala fallback nem linhas literais. */
  extratoScannerPureAi?: boolean;
};

const FAIXA_INICIO_ID = '__delimitacao_inicio__';
const FAIXA_FIM_ID = '__delimitacao_fim__';

function formatExtractCatchError(e: unknown): string {
  if (e instanceof DOMException && e.name === 'TimeoutError') {
    return 'Tempo esgotado. Use modo IA com chave API ou reduza o número de páginas.';
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/signal timed out|aborted|timeout/i.test(msg)) {
    return 'Tempo esgotado. Use modo IA com chave API ou reduza o número de páginas.';
  }
  return msg || 'Falha ao encaixar dados na tabela.';
}

/** Pad OCR para recorte de colunas Itaú (valor vs saldo). */
function extratoColumnPad(items: { h: number }[]): number {
  const heights = items.map((i) => i.h).filter((h) => h > 0).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 12;
  return Math.max(10, medianH * 0.9);
}

/** Itaú: exclui coluna Saldo do valor antes de extrair (evita importar saldo como lançamento). */
function columnsParaExtratoItau(
  cols: GenericColunaDef[],
  items: import('../../lib/parcelamentoColunasExtract').PosicionadoItem[],
  imgWidth: number,
  enabled: boolean,
): GenericColunaDef[] {
  if (!enabled || items.length === 0 || imgWidth <= 0) return cols;
  const pad = extratoColumnPad(items);
  const withData = injectDataColumnIfMissing(cols, items, imgWidth, pad);
  return mergeExtratoValorColumnsParaMisto(withData, items, imgWidth, pad);
}

/** Faixa vertical rígida: não extrair acima da verde nem abaixo da vermelha. */
function resolveExtratoStrictFaixaVertical(
  snapStrict: boolean,
  _itauProfileActive: boolean,
): boolean {
  return snapStrict;
}

type ActiveMappingId = string;

/** Área da imagem enquanto carrega (mesmo tamanho mínimo da prévia antes do OCR terminar). */
const PREVIEW_AREA_PADRAO_W = 960;
const PREVIEW_AREA_PADRAO_H = 640;
const ZOOM_LEVEL_CHOICES = [0.75, 1, 1.25, 1.5, 2] as const;
const EXTRATO_INSTANT_CAPTURE_MODE = false;
const EXTRATO_SAFE_RESOLUTION_CHOICES: ReadonlyArray<{
  value: 'auto' | 'fhd' | 'custom';
  label: string;
  hint: string;
}> = [
    {
      value: 'auto',
      label: 'Automático seguro',
      hint: 'Escala adaptativa por página com fallback; melhor padrão para extrato.',
    },
    {
      value: 'fhd',
      label: 'Full HD fixo',
      hint: 'Mantém Full HD para PDFs que ficam mais estáveis sem ajuste adaptativo.',
    },
    {
      value: 'custom',
      label: 'Personalizado (manual)',
      hint: 'Você controla manualmente o zoom do OCR (escala PDF).',
    },
  ];

type PageMappingSnapshot = {
  columns: GenericColunaDef[];
  faixaStart: number;
  faixaEnd: number;
  faixaInicioMarcado: boolean;
  faixaFimMarcado: boolean;
  semDelimitacaoVertical: boolean;
  imgWidth: number;
  imgHeight: number;
};

function scalePageMappingSnapshot(
  saved: PageMappingSnapshot,
  newW: number,
  newH: number
): PageMappingSnapshot {
  if (saved.imgWidth <= 0 || saved.imgHeight <= 0 || (saved.imgWidth === newW && saved.imgHeight === newH)) {
    return saved;
  }
  const sx = newW / saved.imgWidth;
  const sy = newH / saved.imgHeight;
  return {
    ...saved,
    imgWidth: newW,
    imgHeight: newH,
    faixaStart: saved.faixaStart * sy,
    faixaEnd: saved.faixaEnd * sy,
    columns: saved.columns.map((col) => ({
      ...col,
      start: col.start * sx,
      end: col.end * sx,
    })),
  };
}

function snapshotHasMappedColumns(snap: PageMappingSnapshot): boolean {
  return snap.columns.some((c) => !c.id.startsWith('ignorar') && c.start !== c.end);
}

function scaleAllPageMappingStates(
  states: Map<number, PageMappingSnapshot>,
  ratioW: number,
  ratioH: number,
) {
  if (ratioW <= 0 || ratioH <= 0) return;
  if (Math.abs(ratioW - 1) < 0.001 && Math.abs(ratioH - 1) < 0.001) return;
  for (const [page, snap] of states) {
    states.set(
      page,
      scalePageMappingSnapshot(snap, snap.imgWidth * ratioW, snap.imgHeight * ratioH),
    );
  }
}

function ocrResolutionIsExplicit(settings: OcrUserSettings): boolean {
  return settings.resolutionMode !== 'auto';
}

function normalizeExtratoResolutionMode(mode: OcrResolutionMode): 'auto' | 'fhd' | 'custom' {
  return mode === 'fhd' || mode === 'custom' ? mode : 'auto';
}

async function resolvePagePdfRenderScale(
  pdfDoc: NonNullable<DocumentoParcelamentoPreview['pdfDoc']>,
  pageNum: number,
  loadOpts: LoadParcelamentoPreviewOptions,
): Promise<number> {
  const pageProxy = await pdfDoc.getPage(pageNum);
  return resolvePdfRenderScale(pageProxy, loadOpts);
}

type OcrOverlayLayout = Partial<Record<'top' | 'left' | 'width' | 'height' | 'transform', string>>;

function OcrPositionedOverlay({
  className,
  layout,
  title,
  children,
}: {
  className: string;
  layout: OcrOverlayLayout;
  title?: string;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    for (const key of ['top', 'left', 'width', 'height', 'transform'] as const) {
      const value = layout[key];
      if (value != null) el.style[key] = value;
    }
  }, [layout.top, layout.left, layout.width, layout.height, layout.transform]);
  return (
    <div ref={ref} className={className} title={title}>
      {children}
    </div>
  );
}

function resolveLayoutFaixaY(
  layout: Pick<ExtratoOcrLayoutSaved, 'faixaStart' | 'faixaEnd' | 'faixaStartNorm' | 'faixaEndNorm' | 'imgHeight'>,
  imgHeight: number,
  scaledStart: number,
  scaledEnd: number,
): { faixaStart: number; faixaEnd: number } {
  if (layout.faixaStartNorm != null && layout.faixaEndNorm != null && imgHeight > 0) {
    return {
      faixaStart: layout.faixaStartNorm * imgHeight,
      faixaEnd: layout.faixaEndNorm * imgHeight,
    };
  }
  if (layout.imgHeight > 0 && imgHeight > 0 && layout.imgHeight !== imgHeight) {
    const sy = imgHeight / layout.imgHeight;
    return {
      faixaStart: layout.faixaStart * sy,
      faixaEnd: layout.faixaEnd * sy,
    };
  }
  return { faixaStart: scaledStart, faixaEnd: scaledEnd };
}

function scaleLayoutColumns(
  layout: ExtratoOcrLayoutSaved,
  w: number,
  h: number,
): GenericColunaDef[] {
  if (w <= 0 || h <= 0) return layout.columns;
  if (layout.columnsNorm?.length && layout.columnsNorm.length === layout.columns.length) {
    return layout.columns.map((col, idx) => {
      const norm = layout.columnsNorm![idx];
      if (!norm || norm.id !== col.id) return col;
      return {
        ...col,
        start: norm.startNorm * w,
        end: norm.endNorm * w,
      };
    });
  }
  if (layout.imgWidth <= 0 || layout.imgHeight <= 0) {
    return layout.columns;
  }
  if (layout.imgWidth === w && layout.imgHeight === h) return layout.columns;
  const sx = w / layout.imgWidth;
  return layout.columns.map((col) => ({
    ...col,
    start: col.start * sx,
    end: col.end * sx,
  }));
}

export function DocumentColunasModal({
  file,
  title,
  confirmLabel,
  campoDefs,
  dataColIds,
  headerKeywords,
  supportsValorModo = false,
  supportsExtractEngine = false,
  extractMode = 'generic',
  onConfirm,
  onConfirmParcelamento,
  onCancel,
  companyName = '',
  planoContaOptions = [],
  initialExtractEngine,
  extratoScannerPureAi = false,
}: Props) {
  useEffect(() => {
    notifyDebugModuleLoaded();
  }, []);

  const isParcelamentoExtract = extractMode === 'parcelamento';
  const CAMPOS_DADOS = useMemo(() => campoDefs.filter((f) => !f.isIgnore), [campoDefs]);
  const CAMPOS_IGNORAR = useMemo(() => campoDefs.filter((f) => f.isIgnore), [campoDefs]);
  const firstCampoId = CAMPOS_DADOS[0]?.id ?? 'col1';
  const containerRef = useRef<HTMLDivElement>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const imageScrollRef = useRef<HTMLDivElement>(null);
  /** Coordenadas de cliques usam o retângulo do elemento img (não o div com borda/zoom), para coincidir com o OCR. */
  const imageRef = useRef<HTMLImageElement>(null);
  const pageStatesRef = useRef<Map<number, PageMappingSnapshot>>(new Map());
  const pdfDocRef = useRef<import('pdfjs-dist').PDFDocumentProxy | null>(null);
  const pendingAutoFitRef = useRef(true);
  const mappingUiSnapshotRef = useRef<{ zoomLevel: number; currentPage: number } | null>(null);
  const userMappedColumnsRef = useRef(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  /** Só troca o placeholder pela prévia quando o <img> terminou de pintar no browser. */
  const [previewImageReady, setPreviewImageReady] = useState(false);
  const [imgSize, setImgSize] = useState({ width: 0, height: 0 });
  const [doc, setDoc] = useState<DocumentoParcelamentoPreview | null>(null);
  const docLiveRef = useRef<DocumentoParcelamentoPreview | null>(null);
  useEffect(() => {
    docLiveRef.current = doc;
  }, [doc]);
  const [loading, setLoading] = useState(true);
  const [loadMsg, setLoadMsg] = useState(() =>
    fileIsLikelyPdf(file) ? 'Carregando prévia do PDF…' : 'Carregando…',
  );
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState<{
    message: string;
    page: number;
    total: number;
    rows: number;
    log: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const extractReporterRef = useRef<
    ((msg: string, patch?: { page?: number; total?: number; rows?: number }) => void) | null
  >(null);
  const extractTotalPagesRef = useRef(1);
  const prefetchAbortRef = useRef(false);
  const literalCropRowsRef = useRef<GenericOcrRow[]>([]);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageInputDraft, setPageInputDraft] = useState('1');
  const [columns, setColumns] = useState<GenericColunaDef[]>([]);
  const [faixaStart, setFaixaStart] = useState(0);
  const [faixaEnd, setFaixaEnd] = useState(0);
  /** Linha superior da tabela (um clique na imagem após escolher “Marcar início…”). */
  const [faixaInicioMarcado, setFaixaInicioMarcado] = useState(false);
  /** Linha inferior onde a extração para (um clique após “Marcar fim…”). */
  const [faixaFimMarcado, setFaixaFimMarcado] = useState(false);
  const [activeId, setActiveId] = useState<ActiveMappingId>(firstCampoId);
  const [clickStep, setClickStep] = useState<'start' | 'end'>('start');
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const mouseRafRef = useRef(0);
  const [zoomLevel, setZoomLevel] = useState(1);
  const fileIsPdf = useMemo(() => fileIsLikelyPdf(file), [file]);
  const [ocrResolutionSettings, setOcrResolutionSettings] = useState<OcrUserSettings>(() =>
    getOcrUserSettings(),
  );
  const effectiveOcrResolutionSettings = useMemo<OcrUserSettings>(
    () =>
      supportsValorModo
        ? {
          ...ocrResolutionSettings,
          resolutionMode: normalizeExtratoResolutionMode(ocrResolutionSettings.resolutionMode),
        }
        : ocrResolutionSettings,
    [ocrResolutionSettings, supportsValorModo],
  );
  /** Escala da rasterização PDF (OCR + colunas). */
  const pdfRenderScale =
    doc?.pdfRenderScale ?? doc?.pdfSuggestedScaleFhd ?? PDF_RENDER_SCALE_DEFAULT;
  const semDelimitacaoVertical = false;
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ignoreLineWordsText, setIgnoreLineWordsText] = useState(
    () => getOcrUserSettings().ignoreLineWords,
  );
  const [itauProfileActive, setItauProfileActive] = useState(false);
  const [aiExtractEngine, setAiExtractEngine] = useState<AiExtractEngine>(
    () => initialExtractEngine ?? 'ai',
  );
  const ignoreLineWordsList = useMemo(
    () => parseOcrIgnoreLineWords(ignoreLineWordsText),
    [ignoreLineWordsText],
  );
  const effectiveIgnoreLineWordsList = useMemo(
    () =>
      itauProfileActive
        ? mergeItauIgnoreLineWords(ignoreLineWordsList)
        : ignoreLineWordsList,
    [itauProfileActive, ignoreLineWordsList],
  );
  /** Evita re-segmentar a cada tecla em «palavras ignoradas». */
  const deferredIgnoreLineWordsList = useDeferredValue(effectiveIgnoreLineWordsList);

  const coordW = imgSize.width || doc?.imgWidth || 0;
  const coordH = imgSize.height || doc?.imgHeight || 0;
  const overlayW = doc?.imgWidth || coordW;
  const overlayH = doc?.imgHeight || coordH;
  const ocrRefW = doc?.imgWidth || coordW;
  const ocrRefH = doc?.imgHeight || coordH;

  const persistIgnoreLineWords = useCallback((text: string) => {
    setOcrUserSettings({ ignoreLineWords: text });
  }, []);

  const isExtratoOcr = supportsValorModo && extractMode === 'generic';
  /** Extrato: recorte fiel do PDF em colunas (sem inferência/reconstrução automática). */
  const extratoRecorteLiteral = isExtratoOcr;
  const showExtractEngine = supportsValorModo || supportsExtractEngine;
  const scannerPureAi = Boolean(extratoScannerPureAi && supportsValorModo);
  const isPlanoOcr =
    supportsExtractEngine && !isParcelamentoExtract && dataColIds.includes('codigoClassificacao');
  const ocrPreviewOptions = supportsValorModo ? OCR_EXTRATO_OCR_OPTIONS : undefined;
  const ocrBulkPreviewOptions = ocrPreviewOptions;
  /** Na extração: OCR direto no clique do botão Processar/Extrair. */
  const ocrExtractOptions = supportsValorModo ? OCR_EXTRATO_EXTRACT_OCR_OPTIONS : ocrBulkPreviewOptions;
  /** Extrato: só rasteriza na abertura; OCR apenas no botão «Processar e extrair lançamentos». */
  const ocrDeferredUntilExtract = true;
  const ocrLoadBase = supportsValorModo
    ? OCR_EXTRATO_LOAD_OPTIONS
    : { ...OCR_AUTO_LOAD_OPTIONS, deferOcr: true as const };
  const ocrPdfLoadOptions = useMemo(() => {
    const settings = effectiveOcrResolutionSettings;
    return fileIsPdf ? buildOcrPdfLoadOptions(settings, ocrLoadBase) : ocrLoadBase;
  }, [effectiveOcrResolutionSettings, fileIsPdf, ocrLoadBase]);
  const [sideTab, setSideTab] = useState<'config' | 'layouts'>('config');
  const [bancoNome, setBancoNome] = useState('');
  const [contaBanco, setContaBanco] = useState('');
  const [layoutEditId, setLayoutEditId] = useState<string | null>(null);
  const [savedLayouts, setSavedLayouts] = useState<ExtratoOcrLayoutSaved[]>([]);
  /** Força recomputar prévia/validação quando pageStatesRef muda (outras páginas). */
  const [mappingRevision, setMappingRevision] = useState(0);
  const bumpMappingRevision = useCallback(() => {
    setMappingRevision((v) => v + 1);
  }, []);

  /** Sugestão só quando o usuário pedir — nunca preenche colunas ao abrir o OCR. */
  const suggestPlanoColumnsFromOcr = useCallback(() => {
    const items = doc?.items ?? [];
    const refW = ocrRefW || doc?.imgWidth || imgSize.width || 0;
    const refH = ocrRefH || doc?.imgHeight || imgSize.height || 0;
    if (!isPlanoOcr || items.length < 15 || refW <= 0) {
      setError('Aguarde o OCR terminar ou use um documento com mais linhas de dados.');
      return;
    }
    const suggested = suggestPlanoContasColumns(items, refW);
    if (!suggested?.columns.some((c) => c.start !== c.end)) {
      setError('Não foi possível sugerir colunas. Marque manualmente na imagem.');
      return;
    }
    userMappedColumnsRef.current = true;
    setColumns(suggested.columns);
    setFaixaStart(suggested.faixaStart);
    setFaixaEnd(Math.min(refH, Math.max(suggested.faixaEnd, suggested.faixaStart + 24)));
    setFaixaInicioMarcado(true);
    setFaixaFimMarcado(true);
    setClickStep('start');
    setActiveId(firstCampoId);
    setError(null);
    bumpMappingRevision();
  }, [
    doc?.items,
    doc?.imgWidth,
    doc?.imgHeight,
    firstCampoId,
    imgSize.height,
    imgSize.width,
    isPlanoOcr,
    ocrRefH,
    ocrRefW,
    bumpMappingRevision,
  ]);

  /** Auto-detecta Itaú pelo nome do arquivo (antes do OCR). */
  useEffect(() => {
    if (!isExtratoOcr) return;
    if (!/itau|itaú/i.test(file.name)) return;
    setItauProfileActive(true);
    setBancoNome('Itaú');
    setOcrUserSettings({ columnReadMode: 'unified', preprocessMode: 'scan' });
    setIgnoreLineWordsText((prev) => {
      const merged = mergeItauIgnoreLineWords(parseOcrIgnoreLineWords(prev)).join(', ');
      if (merged !== prev) {
        persistIgnoreLineWords(merged);
        return merged;
      }
      return prev;
    });
  }, [file.name, isExtratoOcr, persistIgnoreLineWords]);

  /** Carrega motor de extração IA (aba Contábil → IA). Scanner/imagem força 'ai'. */
  useEffect(() => {
    if (!isExtratoOcr) return;
    if (scannerPureAi || initialExtractEngine) {
      setAiExtractEngine('ai');
      return;
    }
    void fetchAiConfig()
      .then((cfg) => {
        if (cfg?.config?.extractEngine) {
          setAiExtractEngine(normalizeExtractEngine(cfg.config.extractEngine));
        }
      })
      .catch((err) => {
        console.warn('Erro ao buscar configuração de IA:', err instanceof Error ? err.message : err);
      });
  }, [isExtratoOcr, initialExtractEngine, scannerPureAi]);

  /** Auto-detecta Itaú na página 1 e aplica perfil (ignore words + OCR extrato). */
  useEffect(() => {
    if (!isExtratoOcr || !doc?.items?.length) return;
    const detected =
      detectItauExtratoFromPageItems(doc.items) ||
      detectItauExtratoFromOcrText(doc.ocrFullText ?? '');
    if (!detected) return;
    setItauProfileActive(true);
    setOcrUserSettings({ columnReadMode: 'unified', preprocessMode: 'scan' });
    setIgnoreLineWordsText((prev) => {
      const merged = mergeItauIgnoreLineWords(parseOcrIgnoreLineWords(prev)).join(', ');
      if (merged !== prev) {
        persistIgnoreLineWords(merged);
        return merged;
      }
      return prev;
    });
    if (!bancoNome.trim()) setBancoNome('Itaú');
  }, [isExtratoOcr, doc?.items, doc?.ocrFullText, bancoNome, persistIgnoreLineWords]);

  /** Auto-detecta Banco do Brasil no OCR quando o layout não preencheu o banco. */
  useEffect(() => {
    if (!isExtratoOcr || !doc?.items?.length || bancoNome.trim()) return;
    const blob = `${doc.ocrFullText ?? ''} ${doc.items.map((i) => i.str).join(' ')}`;
    if (/banco\s+do\s+brasil|\binternet\s+banking\b.*\bbb\b|cliente\s*[-–]?\s*conta\s+atual|bb\s+rende\s+f[aá]cil/i.test(blob)) {
      setBancoNome('Banco do Brasil');
    }
    if (/santander|aplicativo\s+santander\s+empresas/i.test(blob)) {
      setBancoNome('Santander');
    }
  }, [isExtratoOcr, doc?.items, doc?.ocrFullText, bancoNome]);

  const refreshSavedLayouts = useCallback(() => {
    if (!companyName?.trim()) {
      setSavedLayouts([]);
      return;
    }
    setSavedLayouts(listExtratoOcrLayouts(companyName, 'extrato'));
  }, [companyName]);

  useEffect(() => {
    refreshSavedLayouts();
  }, [companyName, isExtratoOcr, refreshSavedLayouts]);

  const applyLayoutToState = useCallback(
    (layout: ExtratoOcrLayoutSaved) => {
      const w =
        imageRef.current?.naturalWidth ||
        imgSize.width ||
        doc?.imgWidth ||
        layout.imgWidth ||
        0;
      const h =
        imageRef.current?.naturalHeight ||
        imgSize.height ||
        doc?.imgHeight ||
        layout.imgHeight ||
        0;
      const totalPages = doc?.totalPages ?? 1;
      const scaledColumns = scaleLayoutColumns(layout, w, h);
      const faixaPorPagina = resolveFaixaPorPaginaFromLayout(layout, totalPages);

      pageStatesRef.current.clear();
      pageStatesRef.current.set(1, {
        columns: scaledColumns,
        faixaStart: 0,
        faixaEnd: h,
        faixaInicioMarcado: false,
        faixaFimMarcado: false,
        semDelimitacaoVertical: layout.semDelimitacaoVertical,
        imgWidth: w,
        imgHeight: h,
      });
      applyFaixaPorPaginaToStates(faixaPorPagina, pageStatesRef.current, scaledColumns, w, h);

      const built = buildPageMappingSnapshotForUi(
        pageStatesRef.current,
        currentPage,
        w,
        h,
        currentPage > 1,
      );
      if (built) {
        setColumns(built.columns);
        setFaixaStart(built.faixaStart);
        setFaixaEnd(built.faixaEnd);
        setFaixaInicioMarcado(built.faixaInicioMarcado);
        setFaixaFimMarcado(built.faixaFimMarcado);
      } else {
        setColumns(scaledColumns);
        const legacy = resolveLayoutFaixaY(layout, h, layout.faixaStart, layout.faixaEnd);
        setFaixaStart(legacy.faixaStart);
        setFaixaEnd(legacy.faixaEnd);
        setFaixaInicioMarcado(layout.faixaInicioMarcado);
        setFaixaFimMarcado(layout.faixaFimMarcado);
      }

      setIgnoreLineWordsText(layout.ignoreLineWords);
      persistIgnoreLineWords(layout.ignoreLineWords);
      setBancoNome(layout.bancoNome);
      setContaBanco(layout.contaBanco);
      setLayoutEditId(layout.id);
      userMappedColumnsRef.current = true;
      if (w > 0 && h > 0) {
        setImgSize({ width: w, height: h });
      }
      if (
        layout.imgWidth > 0 &&
        layout.imgHeight > 0 &&
        w > 0 &&
        h > 0 &&
        (Math.abs(w - layout.imgWidth) / layout.imgWidth > 0.12 ||
          Math.abs(h - layout.imgHeight) / layout.imgHeight > 0.12)
      ) {
        setError(
          'Layout salvo em outra resolução — confira colunas e linhas verde/vermelha em cada página.',
        );
      } else {
        setError(null);
      }
      setSideTab('config');
      bumpMappingRevision();
    },
    [currentPage, doc?.imgHeight, doc?.imgWidth, doc?.totalPages, imgSize.height, imgSize.width, persistIgnoreLineWords, bumpMappingRevision],
  );

  useEffect(() => {
    warmupSharedOcrWorker();
  }, []);

  useEffect(() => {
    userMappedColumnsRef.current = false;
    setLayoutEditId(null);
  }, [file]);

  const previewDisplayW = coordW > 0 ? Math.round(coordW * zoomLevel) : 0;
  const previewDisplayH = coordH > 0 ? Math.round(coordH * zoomLevel) : 0;

  const showPreviewImage = !!previewUrl && !loading && previewImageReady;

  useEffect(() => {
    setPreviewImageReady(false);
  }, [previewUrl]);

  useElementLayoutStyle(
    containerRef,
    showPreviewImage && previewDisplayW > 0
      ? { width: previewDisplayW, height: previewDisplayH }
      : {
        width: PREVIEW_AREA_PADRAO_W,
        height: PREVIEW_AREA_PADRAO_H,
      },
    [showPreviewImage, previewDisplayW, previewDisplayH],
  );

  useElementLayoutStyle(
    previewWrapRef,
    showPreviewImage && previewDisplayW > 0 ? { width: previewDisplayW, height: previewDisplayH } : {},
    [showPreviewImage, previewDisplayW, previewDisplayH],
  );

  useElementLayoutStyle(
    imageRef,
    showPreviewImage && previewDisplayW > 0 ? { width: previewDisplayW, height: previewDisplayH } : {},
    [showPreviewImage, previewDisplayW, previewDisplayH],
  );

  const fitImageToView = useCallback(() => {
    const el = imageScrollRef.current;
    if (!el || imgSize.width <= 0) return;
    const pad = 24;
    const z = Math.min(1, Math.max(0.08, (el.clientWidth - pad) / imgSize.width));
    setZoomLevel(Math.round(z * 100) / 100);
  }, [imgSize.width]);
  const selectedZoomPreset = useMemo(
    () => ZOOM_LEVEL_CHOICES.find((value) => Math.abs(value - zoomLevel) < 0.001) ?? null,
    [zoomLevel],
  );
  const stepZoomPreset = useCallback((direction: 'down' | 'up') => {
    setZoomLevel((current) => {
      if (direction === 'up') {
        return (
          ZOOM_LEVEL_CHOICES.find((value) => value > current + 0.001) ??
          ZOOM_LEVEL_CHOICES[ZOOM_LEVEL_CHOICES.length - 1]
        );
      }
      const lowerChoices = [...ZOOM_LEVEL_CHOICES].reverse();
      return lowerChoices.find((value) => value < current - 0.001) ?? ZOOM_LEVEL_CHOICES[0];
    });
  }, []);

  const saveCurrentPageMapping = useCallback(() => {
    const w = doc?.imgWidth || imageRef.current?.naturalWidth || imgSize.width || 0;
    const h = doc?.imgHeight || imageRef.current?.naturalHeight || imgSize.height || 0;
    if (w <= 0 || h <= 0) return;
    const p1 = pageStatesRef.current.get(1);
    const herdaColunasP1 =
      currentPage > 1 && p1?.columns?.some((c) => !c.id.startsWith('ignorar') && c.start !== c.end);
    pageStatesRef.current.set(currentPage, {
      columns: herdaColunasP1 ? [] : columns,
      faixaStart,
      faixaEnd,
      faixaInicioMarcado,
      faixaFimMarcado,
      semDelimitacaoVertical,
      imgWidth: w,
      imgHeight: h,
    });
    bumpMappingRevision();
  }, [
    columns,
    currentPage,
    doc?.imgHeight,
    doc?.imgWidth,
    faixaEnd,
    faixaFimMarcado,
    faixaInicioMarcado,
    faixaStart,
    imgSize.height,
    imgSize.width,
    semDelimitacaoVertical,
    bumpMappingRevision,
  ]);

  const persistCurrentExtratoLayout = useCallback(() => {
    if (!isExtratoOcr || !companyName?.trim()) return;
    if (!bancoNome.trim() || !contaBanco.trim()) return;
    saveCurrentPageMapping();
    const saveW = imageRef.current?.naturalWidth || coordW;
    const saveH = imageRef.current?.naturalHeight || coordH;
    if (saveW <= 0 || saveH <= 0) return;

    const faixaPorPagina = collectFaixaPorPaginaFromStates(pageStatesRef.current);
    const totalPages = doc?.totalPages ?? 1;
    const inicioPage = findFaixaInicioPagina(faixaPorPagina);
    const fimPage = findFaixaFimPagina(faixaPorPagina, totalPages);
    const inicioSnap = pageStatesRef.current.get(inicioPage);
    const fimSnap = pageStatesRef.current.get(fimPage);
    const pInicio = faixaPorPagina[String(inicioPage)];
    const pFim = faixaPorPagina[String(fimPage)];

    const saved = saveExtratoOcrLayout(companyName, {
      id: layoutEditId ?? undefined,
      kind: 'extrato',
      bancoNome: bancoNome.trim(),
      contaBanco: contaBanco.trim(),
      ignoreLineWords: ignoreLineWordsText,
      semDelimitacaoVertical,
      columns,
      columnsNorm:
        saveW > 0
          ? columns.map((col) => ({
            id: col.id,
            startNorm: col.start / saveW,
            endNorm: col.end / saveW,
          }))
          : undefined,
      faixaStart: inicioSnap?.faixaInicioMarcado ? inicioSnap.faixaStart : faixaStart,
      faixaEnd: fimSnap?.faixaFimMarcado ? fimSnap.faixaEnd : faixaEnd,
      faixaStartNorm:
        pInicio?.faixaInicioMarcado && inicioSnap && inicioSnap.imgHeight > 0
          ? inicioSnap.faixaStart / inicioSnap.imgHeight
          : saveH > 0
            ? faixaStart / saveH
            : 0,
      faixaEndNorm:
        pFim?.faixaFimMarcado && fimSnap && fimSnap.imgHeight > 0
          ? fimSnap.faixaEnd / fimSnap.imgHeight
          : saveH > 0
            ? faixaEnd / saveH
            : 1,
      faixaInicioMarcado: Object.values(faixaPorPagina).some((f) => f.faixaInicioMarcado),
      faixaFimMarcado: Object.values(faixaPorPagina).some((f) => f.faixaFimMarcado),
      faixaPorPagina,
      faixaInicioPagina: inicioPage,
      faixaFimPagina: fimPage,
      imgWidth: saveW,
      imgHeight: saveH,
    });
    setLayoutEditId(saved.id);
    refreshSavedLayouts();
  }, [
    bancoNome,
    columns,
    companyName,
    contaBanco,
    coordH,
    coordW,
    faixaEnd,
    faixaFimMarcado,
    faixaInicioMarcado,
    faixaStart,
    ignoreLineWordsText,
    isExtratoOcr,
    layoutEditId,
    refreshSavedLayouts,
    doc?.totalPages,
    saveCurrentPageMapping,
    semDelimitacaoVertical,
  ]);

  /** Persiste mapeamento ao marcar colunas/faixa — necessário para herdar nas outras páginas. */
  useEffect(() => {
    const temColuna = columns.some((c) => !c.id.startsWith('ignorar') && c.start !== c.end);
    const temFaixa = faixaInicioMarcado || faixaFimMarcado;
    if (!temColuna && !temFaixa) return;
    saveCurrentPageMapping();
  }, [
    columns,
    faixaEnd,
    faixaFimMarcado,
    faixaInicioMarcado,
    faixaStart,
    semDelimitacaoVertical,
    saveCurrentPageMapping,
  ]);

  /** Plano de contas: realinha colunas da pág. 1 ao layout OCR da folha atual. */
  useEffect(() => {
    if (!isPlanoOcr || currentPage <= 1 || !doc?.items?.length || !doc.imgWidth) return;
    const p1 = pageStatesRef.current.get(1);
    if (!pageSnapshotHasMappedColumns(p1)) return;
    const aligned = realignPlanoColumnsToPageOcr(
      p1!.columns,
      p1!.imgWidth,
      doc.items,
      doc.imgWidth,
    );
    if (!aligned) return;
    setColumns((prev) => {
      const same =
        prev.length === aligned.length &&
        prev.every(
          (c, i) =>
            c.id === aligned[i]!.id &&
            Math.abs(c.start - aligned[i]!.start) < 1 &&
            Math.abs(c.end - aligned[i]!.end) < 1,
        );
      return same ? prev : aligned;
    });
  }, [currentPage, doc?.items, doc?.imgWidth, isPlanoOcr]);

  const restorePageMapping = useCallback(
    (page: number, newW: number, newH: number) => {
      const built = buildPageMappingSnapshotForUi(
        pageStatesRef.current,
        page,
        newW,
        newH,
        page > 1,
      );
      if (!built) {
        setColumns([]);
        setFaixaStart(0);
        setFaixaEnd(newH);
        setFaixaInicioMarcado(false);
        setFaixaFimMarcado(false);
        setClickStep('start');
        setActiveId(firstCampoId);
        return;
      }
      setColumns(built.columns);
      setFaixaStart(built.faixaStart);
      setFaixaEnd(built.faixaEnd);
      setFaixaInicioMarcado(built.faixaInicioMarcado);
      setFaixaFimMarcado(built.faixaFimMarcado);
      setClickStep('start');
      setActiveId(firstCampoId);
    },
    [firstCampoId]
  );

  useEffect(() => {
    if (loading || !previewUrl || imgSize.width <= 0) return;
    if (!pendingAutoFitRef.current) return;
    pendingAutoFitRef.current = false;
    const frame = requestAnimationFrame(() => fitImageToView());
    return () => cancelAnimationFrame(frame);
  }, [loading, previewUrl, imgSize.width, imgSize.height, fitImageToView]);

  useEffect(() => {
    let cancelled = false;
    let urlRevoke: string | null = null;

    (async () => {
      setLoading(true);
      setOcrLoading(false);
      setLoadMsg(fileIsPdf ? 'Convertendo PDF em imagem...' : 'Carregando imagem...');
      setError(null);
      setPreviewUrl(null);
      setPreviewImageReady(false);
      setDoc(null);
      pageStatesRef.current.clear();
      pendingAutoFitRef.current = true;
      if (pdfDocRef.current) {
        clearPdfPagePreviewCache(pdfDocRef.current);
        pdfDocRef.current = null;
      }
      try {
        const d = await loadDocumentoParcelamentoPreview(
          file,
          (m) => {
            if (cancelled) return;
            if (ocrDeferredUntilExtract && fileIsPdf) {
              setLoadMsg('Convertendo PDF em imagem...');
              return;
            }
            setLoadMsg(m);
          },
          fileIsPdf ? ocrPdfLoadOptions : { ...ocrLoadBase, deferOcr: true },
        );
        if (cancelled) return;
        urlRevoke = d.previewUrl;
        pdfDocRef.current = d.pdfDoc ?? null;
        setDoc(d);
        setPreviewUrl(d.previewUrl);
        setImgSize({ width: d.imgWidth, height: d.imgHeight });
        setFaixaEnd(d.imgHeight);
        setCurrentPage(1);
        setColumns([]);
        setFaixaStart(0);
        setFaixaInicioMarcado(false);
        setFaixaFimMarcado(false);
        setClickStep('start');
        setActiveId(firstCampoId);

        let loadEngine: AiExtractEngine = initialExtractEngine ?? 'ai';
        if (isExtratoOcr) {
          if (initialExtractEngine) {
            loadEngine = normalizeExtractEngine(initialExtractEngine);
            setAiExtractEngine(loadEngine);
          } else {
            const aiCfg = await fetchAiConfig();
            if (cancelled) return;
            if (aiCfg?.config?.extractEngine) {
              loadEngine = normalizeExtractEngine(aiCfg.config.extractEngine);
              setAiExtractEngine(loadEngine);
            }
          }
        }

        if (d.previewUrl && isExtratoOcr && !ocrDeferredUntilExtract) {
            setLoadMsg(
              fileIsPdf
                ? 'Pré-processamento do extrato: PDF → imagem + limpeza OCR…'
                : 'Pré-processamento do extrato: limpando imagem + OCR…',
            );
            setOcrLoading(true);
            try {
              if (fileIsPdf && d.pdfDoc) {
                const pageProxy = await d.pdfDoc.getPage(1);
                const primaryScale = resolvePdfRenderScale(pageProxy, ocrPdfLoadOptions);
                const full = await completePdfPageOcrWithExtratoScaleFallback(
                  d.pdfDoc,
                  1,
                  primaryScale,
                  (m) => {
                    if (!cancelled) setLoadMsg(m);
                  },
                  ocrExtractOptions,
                  ocrPdfLoadOptions,
                );
                if (cancelled) return;
                if (full.previewUrl && full.previewUrl !== d.previewUrl) {
                  if (urlRevoke?.startsWith('blob:')) URL.revokeObjectURL(urlRevoke);
                  urlRevoke = full.previewUrl;
                  setPreviewUrl(full.previewUrl);
                }
                setDoc((prev) =>
                  prev
                    ? {
                      ...prev,
                      previewUrl: full.previewUrl ?? prev.previewUrl,
                      items: full.items,
                      itemCount: full.itemCount,
                      imgWidth: full.imgWidth,
                      imgHeight: full.imgHeight,
                      ocrFullText: full.ocrFullText,
                    }
                    : prev,
                );
                setImgSize({ width: full.imgWidth, height: full.imgHeight });
                setFaixaEnd(full.imgHeight);
                if (full.itemCount === 0) {
                  setError(
                    'Pré-processamento concluído, mas o OCR não detectou texto. Aumente a escala e tente novamente.',
                  );
                } else {
                  setError(null);
                  setLoadMsg('Pré-processamento concluído — extrato pronto para mapeamento.');
                }
              } else {
                const full = await refreshOcrItemsFromPreviewUrl(
                  d.previewUrl,
                  (m) => {
                    if (!cancelled) setLoadMsg(m);
                  },
                  { quality: 'balanced' },
                );
                if (cancelled) return;
                let nextUrl = d.previewUrl;
                if (full.previewUrl && full.previewUrl !== d.previewUrl) {
                  if (urlRevoke?.startsWith('blob:')) URL.revokeObjectURL(urlRevoke);
                  urlRevoke = full.previewUrl;
                  nextUrl = full.previewUrl;
                  setPreviewUrl(full.previewUrl);
                }
                setDoc((prev) =>
                  prev
                    ? {
                      ...prev,
                      previewUrl: nextUrl,
                      items: full.items,
                      itemCount: full.itemCount,
                      imgWidth: full.imgWidth,
                      imgHeight: full.imgHeight,
                      ocrFullText: full.ocrFullText,
                    }
                    : prev,
                );
                setImgSize({ width: full.imgWidth, height: full.imgHeight });
                setFaixaEnd(full.imgHeight);
                if (full.itemCount === 0) {
                  setError(
                    'Pré-processamento concluído, mas o OCR não detectou texto. Use imagem/PDF mais nítido.',
                  );
                } else {
                  setError(null);
                  setLoadMsg('Pré-processamento concluído — extrato pronto para mapeamento.');
                }
              }
            } catch (e) {
              if (!cancelled) setError(formatExtractCatchError(e));
            } finally {
              if (!cancelled) {
                setOcrLoading(false);
                setLoading(false);
              }
            }
            return;
        }
        if (d.itemCount === 0 && d.previewUrl) {
          if (ocrDeferredUntilExtract) {
            setLoadMsg(`Prévia pronta — marque colunas/delimitação e clique em «${confirmLabel}».`);
            setError(null);
            setLoading(false);
          } else if (loadEngine === 'ai' && fileIsPdf && d.pdfDoc) {
            setLoadMsg('Prévia pronta — modo IA usa visão (sem OCR local).');
            setError(null);
            setLoading(false);
          } else {
            // Mostra a prévia imediatamente e faz OCR em segundo plano para evitar travamento visual.
            setLoading(false);
            if (fileIsPdf) setLoadMsg(PDF_SCANNER_OCR_MSG.limpando);
            setOcrLoading(true);
            void (async () => {
              try {
                if (fileIsPdf && d.pdfDoc) {
                  const full = await completePdfPageOcr(
                    d.pdfDoc,
                    1,
                    d.previewUrl,
                    pdfRenderScale,
                    (m) => {
                      if (!cancelled) setLoadMsg(m);
                    },
                    ocrPreviewOptions,
                  );
                  if (cancelled) return;
                  setDoc((prev) =>
                    prev
                      ? {
                        ...prev,
                        items: full.items,
                        itemCount: full.itemCount,
                        imgWidth: full.imgWidth,
                        imgHeight: full.imgHeight,
                        ocrFullText: full.ocrFullText,
                      }
                      : prev,
                  );
                  setImgSize({ width: full.imgWidth, height: full.imgHeight });
                  setFaixaEnd(full.imgHeight);
                  if (full.itemCount === 0) {
                    setError(
                      'OCR não detectou texto. Aumente a escala do PDF ou clique em “Ler OCR novamente”.',
                    );
                  } else {
                    setError(null);
                  }
                } else {
                  const full = await refreshOcrItemsFromPreviewUrl(
                    d.previewUrl,
                    (m) => {
                      if (!cancelled) setLoadMsg(m);
                    },
                    { quality: 'balanced' },
                  );
                  if (cancelled) return;
                  let nextUrl = d.previewUrl;
                  if (full.previewUrl && full.previewUrl !== d.previewUrl) {
                    if (urlRevoke?.startsWith('blob:')) URL.revokeObjectURL(urlRevoke);
                    urlRevoke = full.previewUrl;
                    nextUrl = full.previewUrl;
                    setPreviewUrl(full.previewUrl);
                  }
                  setDoc((prev) =>
                    prev
                      ? {
                        ...prev,
                        previewUrl: nextUrl,
                        items: full.items,
                        itemCount: full.itemCount,
                        imgWidth: full.imgWidth,
                        imgHeight: full.imgHeight,
                        ocrFullText: full.ocrFullText,
                      }
                      : prev,
                  );
                  setImgSize({ width: full.imgWidth, height: full.imgHeight });
                  setFaixaEnd(full.imgHeight);
                  if (full.itemCount === 0) {
                    setError(
                      'OCR não detectou texto. Em “Ampliação da imagem”, use Full HD se precisar de mais nitidez.',
                    );
                  } else {
                    setError(null);
                  }
                }
              } catch (e) {
                if (!cancelled) {
                  setError(formatExtractCatchError(e));
                }
              } finally {
                if (!cancelled) setOcrLoading(false);
              }
            })();
          }
        } else {
          setLoading(false);
          if (d.itemCount === 0 && !ocrDeferredUntilExtract) {
            setError(
              'OCR não detectou texto. Em “Ampliação da imagem”, escolha Full HD ou 4K, ou use arquivo mais nítido.',
            );
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(formatExtractCatchError(e));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (pdfDocRef.current) {
        clearPdfPagePreviewCache(pdfDocRef.current);
        pdfDocRef.current = null;
      } else if (urlRevoke) {
        URL.revokeObjectURL(urlRevoke);
      }
    };
  }, [file, fileIsPdf, firstCampoId]);

  const applyPdfPageResult = useCallback((next: PdfPagePreviewResult) => {
    setPreviewUrl(next.previewUrl);
    setDoc((d) =>
      d
        ? {
          ...d,
          previewUrl: next.previewUrl,
          imgWidth: next.imgWidth,
          imgHeight: next.imgHeight,
          items: next.items,
          ocrSource: next.ocrSource,
          itemCount: next.itemCount,
          pdfSuggestedScaleFhd: next.pdfSuggestedScaleFhd,
          pdfSuggestedScale4k: next.pdfSuggestedScale4k,
        }
        : d,
    );
    setImgSize({ width: next.imgWidth, height: next.imgHeight });
  }, []);

  const changePage = useCallback(
    async (page: number) => {
      if (!doc?.pdfDoc || page < 1 || page > doc.totalPages || page === currentPage) return;
      saveCurrentPageMapping();
      setError(null);
      const prev = previewUrl;
      try {
        const pageProxy = await doc.pdfDoc.getPage(page);
        const pageScale = resolvePdfRenderScale(pageProxy, ocrPdfLoadOptions);
        const cached = getCachedPdfPagePreview(doc.pdfDoc, page, pageScale);
        if (cached && (cached.itemCount > 0 || aiExtractEngine === 'ai' || ocrDeferredUntilExtract)) {
          setLoadMsg(
            ocrDeferredUntilExtract && cached.itemCount === 0
              ? `Página ${page} — pronta para colar na tabela`
              : `Página ${page}${cached.itemCount > 0 ? ' (em cache)' : ''}…`,
          );
          safeRevokePdfPreviewUrl(doc.pdfDoc, prev);
          applyPdfPageResult(cached);
          setCurrentPage(page);
          restorePageMapping(page, cached.imgWidth, cached.imgHeight);
          pendingAutoFitRef.current = true;
          return;
        }

        setLoading(true);
        setLoadMsg(
          ocrDeferredUntilExtract
            ? `Carregando página ${page}…`
            : aiExtractEngine === 'ai'
              ? `Carregando página ${page}…`
              : PDF_SCANNER_OCR_MSG.limpandoPagina(page),
        );
        const preview = await renderPdfPagePreview(doc.pdfDoc, page, setLoadMsg, ocrPdfLoadOptions);
        safeRevokePdfPreviewUrl(doc.pdfDoc, prev);
        applyPdfPageResult(preview);
        setCurrentPage(page);
        restorePageMapping(page, preview.imgWidth, preview.imgHeight);
        pendingAutoFitRef.current = true;
        setLoading(false);

        if (aiExtractEngine === 'ai' || ocrDeferredUntilExtract) {
          setLoadMsg(
            ocrDeferredUntilExtract
              ? `Página ${page} — marque colunas e clique em «${confirmLabel}»`
              : `Página ${page} pronta para IA (visão).`,
          );
          return;
        }

        setOcrLoading(true);
        try {
          const full = await completePdfPageOcr(
            doc.pdfDoc,
            page,
            preview.previewUrl,
            pdfRenderScale,
            setLoadMsg,
            ocrPreviewOptions,
          );
          applyPdfPageResult(full);
          if (full.itemCount === 0) {
            setError('OCR não detectou texto nesta página. Aumente a escala ou use “Ler OCR novamente”.');
          }
        } finally {
          setOcrLoading(false);
        }
      } catch (e) {
        setError(formatExtractCatchError(e));
      } finally {
        setLoading(false);
      }
    },
    [
      aiExtractEngine,
      doc,
      previewUrl,
      pdfRenderScale,
      ocrPdfLoadOptions,
      ocrPreviewOptions,
      ocrDeferredUntilExtract,
      currentPage,
      saveCurrentPageMapping,
      restorePageMapping,
      applyPdfPageResult,
    ],
  );

  useEffect(() => {
    setPageInputDraft(String(currentPage));
  }, [currentPage]);

  const commitPageInput = useCallback(() => {
    if (!doc?.totalPages) return;
    const trimmed = pageInputDraft.trim();
    if (!trimmed) {
      setPageInputDraft(String(currentPage));
      return;
    }
    const val = parseInt(trimmed, 10);
    if (Number.isNaN(val)) {
      setPageInputDraft(String(currentPage));
      return;
    }
    const newPage = Math.max(1, Math.min(doc.totalPages, val));
    setPageInputDraft(String(newPage));
    if (newPage !== currentPage) void changePage(newPage);
  }, [pageInputDraft, currentPage, doc?.totalPages, changePage]);

  const applyOcrResolution = useCallback(async () => {
    if (!doc?.pdfDoc || loading || extracting) return;
    const settings = effectiveOcrResolutionSettings;
    setOcrUserSettings(settings);
    const loadOpts = buildOcrPdfLoadOptions(settings, ocrLoadBase);
    saveCurrentPageMapping();
    clearPdfPagePreviewCache(doc.pdfDoc);
    setError(null);
    setLoading(true);
    const prev = previewUrl;
    const oldW = doc.imgWidth || imgSize.width || imageRef.current?.naturalWidth || 0;
    const oldH = doc.imgHeight || imgSize.height || imageRef.current?.naturalHeight || 0;
    try {
      const page = currentPage;
      const preview = await renderPdfPagePreview(doc.pdfDoc, page, setLoadMsg, loadOpts);
      const scale = await resolvePagePdfRenderScale(doc.pdfDoc, page, loadOpts);
      if (oldW > 0 && oldH > 0) {
        scaleAllPageMappingStates(
          pageStatesRef.current,
          preview.imgWidth / oldW,
          preview.imgHeight / oldH,
        );
      }
      safeRevokePdfPreviewUrl(doc.pdfDoc, prev);
      setPreviewUrl(preview.previewUrl);
      setImgSize({ width: preview.imgWidth, height: preview.imgHeight });
      setDoc((d) => {
        const next = d
          ? {
            ...d,
            previewUrl: preview.previewUrl,
            imgWidth: preview.imgWidth,
            imgHeight: preview.imgHeight,
            pdfSuggestedScaleFhd: preview.pdfSuggestedScaleFhd,
            pdfSuggestedScale4k: preview.pdfSuggestedScale4k,
            pdfRenderScale: scale,
            items: [],
            itemCount: 0,
            ocrFullText: undefined,
            ocrSource: preview.ocrSource,
          }
          : d;
        docLiveRef.current = next;
        return next;
      });
      setCurrentPage(page);
      restorePageMapping(page, preview.imgWidth, preview.imgHeight);
      pendingAutoFitRef.current = true;
      bumpMappingRevision();
      setLoadMsg(
        `Resolução ${preview.imgWidth}×${preview.imgHeight} px (escala ${scale.toFixed(2)}) — reprocesse o OCR.`,
      );
    } catch (e) {
      setError(formatExtractCatchError(e));
    } finally {
      setLoading(false);
    }
  }, [
    currentPage,
    doc,
    extracting,
    imgSize.height,
    imgSize.width,
    loading,
    ocrLoadBase,
    effectiveOcrResolutionSettings,
    previewUrl,
    restorePageMapping,
    saveCurrentPageMapping,
    bumpMappingRevision,
  ]);

  /** Garante que OCR/extração usem a resolução escolhida agora (mesmo com layout salvo em outra escala). */
  const syncPdfResolutionForExtract = useCallback(
    async (report?: (msg: string) => void, forceForExtrato = false): Promise<boolean> => {
      if (!doc?.pdfDoc || !fileIsPdf) {
        return false;
      }
      if (!forceForExtrato && !ocrResolutionIsExplicit(effectiveOcrResolutionSettings)) {
        return false;
      }
      const loadOpts = ocrPdfLoadOptions;
      const targetScale = await resolvePagePdfRenderScale(doc.pdfDoc, currentPage, loadOpts);
      const currentScale = doc.pdfRenderScale ?? PDF_RENDER_SCALE_DEFAULT;
      if (Math.abs(targetScale - currentScale) <= 0.02) {
        return false;
      }
      report?.(`Aplicando resolução ${targetScale.toFixed(2)} antes de colar na tabela…`);
      setOcrUserSettings(effectiveOcrResolutionSettings);
      saveCurrentPageMapping();
      clearPdfPagePreviewCache(doc.pdfDoc);
      const prev = previewUrl;
      const oldW = doc.imgWidth || imgSize.width || 0;
      const oldH = doc.imgHeight || imgSize.height || 0;
      const preview = await renderPdfPagePreview(
        doc.pdfDoc,
        currentPage,
        report ?? setLoadMsg,
        loadOpts,
      );
      if (oldW > 0 && oldH > 0) {
        scaleAllPageMappingStates(
          pageStatesRef.current,
          preview.imgWidth / oldW,
          preview.imgHeight / oldH,
        );
      }
      safeRevokePdfPreviewUrl(doc.pdfDoc, prev);
      setPreviewUrl(preview.previewUrl);
      setImgSize({ width: preview.imgWidth, height: preview.imgHeight });
      setDoc((d) => {
        const next = d
          ? {
            ...d,
            previewUrl: preview.previewUrl,
            imgWidth: preview.imgWidth,
            imgHeight: preview.imgHeight,
            pdfSuggestedScaleFhd: preview.pdfSuggestedScaleFhd,
            pdfSuggestedScale4k: preview.pdfSuggestedScale4k,
            pdfRenderScale: targetScale,
            items: [],
            itemCount: 0,
            ocrFullText: undefined,
            ocrSource: preview.ocrSource,
          }
          : d;
        docLiveRef.current = next;
        return next;
      });
      restorePageMapping(currentPage, preview.imgWidth, preview.imgHeight);
      bumpMappingRevision();
      setError(null);
      return true;
    },
    [
      bumpMappingRevision,
      currentPage,
      doc,
      fileIsPdf,
      imgSize.height,
      imgSize.width,
      ocrPdfLoadOptions,
      effectiveOcrResolutionSettings,
      previewUrl,
      restorePageMapping,
      saveCurrentPageMapping,
    ],
  );

  const handleImageLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    const naturalWidth = e.currentTarget.naturalWidth;
    const naturalHeight = e.currentTarget.naturalHeight;
    const stateW = imgSize.width > 0 ? imgSize.width : (doc?.imgWidth ?? naturalWidth);
    const stateH = imgSize.height > 0 ? imgSize.height : (doc?.imgHeight ?? naturalHeight);

    if (
      naturalWidth > 0 &&
      naturalHeight > 0 &&
      stateW > 0 &&
      stateH > 0 &&
      (Math.abs(stateW - naturalWidth) / naturalWidth > 0.001 ||
        Math.abs(stateH - naturalHeight) / naturalHeight > 0.001)
    ) {
      const sx = naturalWidth / stateW;
      const sy = naturalHeight / stateH;
      const scaleCol = (c: GenericColunaDef) =>
        c.start === c.end && c.start === 0
          ? c
          : { ...c, start: c.start * sx, end: c.end * sx };
      const scaleItem = (it: { x: number; y: number; w: number; h: number; str: string }) => ({
        ...it,
        x: it.x * sx,
        y: it.y * sy,
        w: Math.max(1, it.w * sx),
        h: Math.max(1, it.h * sy),
      });

      const snap = pageStatesRef.current.get(currentPage);
      if (snap) {
        pageStatesRef.current.set(currentPage, {
          ...snap,
          columns: snap.columns.map(scaleCol),
          faixaStart: snap.faixaStart * sy,
          faixaEnd: snap.faixaEnd * sy,
          imgWidth: naturalWidth,
          imgHeight: naturalHeight,
        });
      }

      if (currentPage > 1 && pageStatesRef.current.get(1)?.columns?.some((c) => c.start !== c.end)) {
        restorePageMapping(currentPage, naturalWidth, naturalHeight);
      } else {
        setColumns((cols) => cols.map(scaleCol));
        setFaixaStart((y) => y * sy);
        setFaixaEnd((y) => y * sy);
      }

      setDoc((d) =>
        d
          ? {
            ...d,
            imgWidth: naturalWidth,
            imgHeight: naturalHeight,
            items: d.items.map(scaleItem),
          }
          : d,
      );
    }

    setImgSize({ width: naturalWidth, height: naturalHeight });
    if (!faixaFimMarcado && naturalHeight > 0) {
      setFaixaEnd((prev) => (prev === naturalHeight ? prev : naturalHeight));
    }
    setPreviewImageReady(true);
  };

  useLayoutEffect(() => {
    const img = imageRef.current;
    if (!previewUrl || previewImageReady || !img?.complete || img.naturalWidth <= 0) return;
    handleImageLoad({ currentTarget: img } as SyntheticEvent<HTMLImageElement>);
  }, [previewUrl, previewImageReady, loading]);

  const toImageCoords = useCallback(
    (e: MouseEvent) => {
      const img = imageRef.current;
      if (!img) return null;
      const rect = img.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const w = imgSize.width || doc?.imgWidth || img.naturalWidth;
      const h = imgSize.height || doc?.imgHeight || img.naturalHeight;
      if (w <= 0 || h <= 0) return null;
      const x = ((e.clientX - rect.left) / rect.width) * w;
      const y = ((e.clientY - rect.top) / rect.height) * h;
      return { x, y };
    },
    [doc?.imgHeight, doc?.imgWidth, imgSize.height, imgSize.width],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      const p = toImageCoords(e);
      if (!p) return;
      if (mouseRafRef.current) return;
      mouseRafRef.current = requestAnimationFrame(() => {
        mouseRafRef.current = 0;
        setMousePos(p);
      });
    },
    [toImageCoords],
  );

  const isMappingColumnField = useCallback(
    (fieldId: string) =>
      fieldId !== FAIXA_INICIO_ID &&
      fieldId !== FAIXA_FIM_ID &&
      campoDefs.some((f) => f.id === fieldId),
    [campoDefs],
  );

  const trackMouseOnPreview =
    showPreviewImage &&
    (activeId === FAIXA_INICIO_ID ||
      activeId === FAIXA_FIM_ID ||
      isMappingColumnField(activeId));

  useEffect(() => {
    if (!trackMouseOnPreview && mousePos) setMousePos(null);
  }, [trackMouseOnPreview, mousePos]);

  const clearColunaMapeada = useCallback((fieldId: string) => {
    userMappedColumnsRef.current = true;
    setColumns((prev) => prev.filter((c) => c.id !== fieldId));
    if (activeId === fieldId) setClickStep('start');
  }, [activeId]);

  const clearTodasColunasMapeadas = useCallback(() => {
    userMappedColumnsRef.current = true;
    setColumns([]);
    setClickStep('start');
    setActiveId(firstCampoId);
  }, [firstCampoId]);

  const handleImageClick = (e: MouseEvent) => {
    const p = toImageCoords(e);
    if (!p) return;

    if (activeId === FAIXA_INICIO_ID) {
      userMappedColumnsRef.current = true;
      setFaixaStart(p.y);
      setFaixaInicioMarcado(true);
      setActiveId(firstCampoId);
      return;
    }
    if (activeId === FAIXA_FIM_ID) {
      userMappedColumnsRef.current = true;
      setFaixaEnd(p.y);
      setFaixaFimMarcado(true);
      setActiveId(firstCampoId);
      return;
    }

    const field = campoDefs.find((f) => f.id === activeId);
    if (!field) return;

    userMappedColumnsRef.current = true;

    setColumns((prev) => {
      const existing = prev.find((c) => c.id === activeId);
      if (!existing) {
        setClickStep('end');
        return [
          ...prev.filter((c) => c.id !== activeId),
          { id: activeId, start: p.x, end: p.x, color: field.color },
        ];
      }
      if (clickStep === 'start') {
        if (existing.start !== existing.end) {
          setClickStep('end');
          return prev;
        }
        setClickStep('end');
        return [
          ...prev.filter((c) => c.id !== activeId),
          { id: activeId, start: p.x, end: p.x, color: field.color },
        ];
      }
      setClickStep('start');
      const newStart = Math.min(existing.start, p.x);
      const newEnd = Math.max(existing.start, p.x);
      const idx = CAMPOS_DADOS.findIndex((f) => f.id === activeId);
      if (idx >= 0 && idx < CAMPOS_DADOS.length - 1) {
        setActiveId(CAMPOS_DADOS[idx + 1].id);
      }
      return prev.map((c) =>
        c.id === activeId ? { ...c, start: newStart, end: newEnd } : c
      );
    });
  };

  const rerunOcr = useCallback(async () => {
    if (!previewUrl) return;
    if (doc?.pdfDoc) {
      invalidatePdfPageCacheEntry(doc.pdfDoc, currentPage, pdfRenderScale);
    }
    setOcrLoading(true);
    setError(null);
    setLoadMsg(doc?.pdfDoc ? PDF_SCANNER_OCR_MSG.limpando : 'OCR na imagem…');
    try {
      const next = await refreshOcrItemsFromPreviewUrl(previewUrl, setLoadMsg, ocrPreviewOptions);
      if (next.previewUrl && next.previewUrl !== previewUrl) {
        if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(next.previewUrl);
      }
      setDoc((d) =>
        d
          ? {
            ...d,
            previewUrl: next.previewUrl ?? d.previewUrl,
            items: next.items,
            imgWidth: next.imgWidth,
            imgHeight: next.imgHeight,
            itemCount: next.itemCount,
            ocrFullText: next.ocrFullText,
          }
          : d
      );
      setImgSize({ width: next.imgWidth, height: next.imgHeight });
      if (doc?.pdfDoc) {
        setCachedPdfPagePreview(doc.pdfDoc, currentPage, pdfRenderScale, {
          previewUrl: next.previewUrl ?? previewUrl,
          imgWidth: next.imgWidth,
          imgHeight: next.imgHeight,
          items: next.items,
          ocrSource: 'ocr',
          itemCount: next.itemCount,
          pdfSuggestedScaleFhd: doc.pdfSuggestedScaleFhd ?? 0,
          pdfSuggestedScale4k: doc.pdfSuggestedScale4k ?? 0,
          ocrFullText: next.ocrFullText,
        });
      }
      if (next.itemCount === 0) {
        setError('Nenhum texto detectado. Tente zoom na imagem original ou outro arquivo.');
      }
    } catch (e) {
      setError(formatExtractCatchError(e));
    } finally {
      setOcrLoading(false);
    }
  }, [previewUrl, doc?.pdfDoc, currentPage, pdfRenderScale, ocrPreviewOptions]);

  const resolveSnapshotForPage = useCallback(
    (page: number, refW: number, refH: number): PageMappingSnapshot => {
      const totalPages = doc?.totalPages ?? 1;
      const built = buildPageMappingSnapshotForExtract(
        pageStatesRef.current,
        page,
        totalPages,
        refW,
        refH,
        true,
      );
      if (built) return built;
      return {
        columns,
        faixaStart,
        faixaEnd,
        faixaInicioMarcado,
        faixaFimMarcado,
        semDelimitacaoVertical,
        imgWidth: imgSize.width || refW,
        imgHeight: imgSize.height || refH,
      };
    },
    [
      columns,
      doc?.totalPages,
      faixaEnd,
      faixaFimMarcado,
      faixaInicioMarcado,
      faixaStart,
      imgSize.height,
      imgSize.width,
      semDelimitacaoVertical,
    ],
  );

  const snapshotHasColunas = (snap: PageMappingSnapshot) => snapshotHasMappedColumns(snap);

  const loadPdfPageOcrForExtract = useCallback(
    async (
      pageNum: number,
      opts?: {
        onProgress?: (msg: string) => void;
        ocrOptions?: typeof ocrBulkPreviewOptions;
        forExtract?: boolean;
      },
    ) => {
      const pdfDoc = doc?.pdfDoc;
      if (!pdfDoc) throw new Error('PDF não disponível.');
      const onProgress = opts?.onProgress ?? setLoadMsg;
      const ocrOpts = opts?.forExtract ? ocrExtractOptions : (opts?.ocrOptions ?? ocrBulkPreviewOptions);
      if (opts?.forExtract) {
        const pageProxy = await pdfDoc.getPage(pageNum);
        const primaryScale = resolvePdfRenderScale(pageProxy, ocrPdfLoadOptions);
        if (scannerPureAi) {
          const preview = await renderPdfPagePreview(pdfDoc, pageNum, onProgress, {
            ...ocrPdfLoadOptions,
            pdfRenderScale: primaryScale,
            deferOcr: true,
            useCache: false,
          });
          return {
            ...preview,
            items: [],
            itemCount: 0,
            ocrFullText: '',
            ocrSource: 'ocr' as const,
          };
        }
        return completePdfPageOcrWithExtratoScaleFallback(
          pdfDoc,
          pageNum,
          primaryScale,
          onProgress,
          ocrOpts,
          ocrPdfLoadOptions,
        );
      }
      if (!opts?.forExtract) {
        const pageProxy = await pdfDoc.getPage(pageNum);
        const pageScale = resolvePdfRenderScale(pageProxy, ocrPdfLoadOptions);
        const cached = getCachedPdfPagePreview(pdfDoc, pageNum, pageScale);
        if (cached && cached.itemCount > 0) return cached;
      }
      const preview = await renderPdfPagePreview(pdfDoc, pageNum, onProgress, ocrPdfLoadOptions);
      const pageProxy = await pdfDoc.getPage(pageNum);
      const pageScale = resolvePdfRenderScale(pageProxy, ocrPdfLoadOptions);
      return completePdfPageOcr(
        pdfDoc,
        pageNum,
        preview.previewUrl,
        pageScale,
        onProgress,
        opts?.forExtract ? ocrExtractOptions : ocrOpts,
      );
    },
    [doc?.pdfDoc, ocrBulkPreviewOptions, ocrExtractOptions, ocrPdfLoadOptions, scannerPureAi],
  );

  const forwardPageOcrProgress = useCallback((pageNum: number, msg: string) => {
    const report = extractReporterRef.current;
    if (report) {
      report(msg, { page: pageNum, total: extractTotalPagesRef.current });
    } else {
      setLoadMsg(msg);
    }
  }, []);

  const getPageOcrDataForExtract = useCallback(
    async (pageNum: number): Promise<PdfPagePreviewResult> => {
      const activeDoc = docLiveRef.current ?? doc;
      const pdfDoc = activeDoc?.pdfDoc;
      if (!pdfDoc) throw new Error('PDF não disponível.');

      if (EXTRATO_INSTANT_CAPTURE_MODE && supportsValorModo) {
        const total = extractTotalPagesRef.current;
        const report = extractReporterRef.current;
        if (pageNum === currentPage && activeDoc?.items?.length) {
          report?.(`Captura instantânea da página ${pageNum}/${total}…`, { page: pageNum, total });
          return {
            previewUrl: previewUrl ?? activeDoc.previewUrl,
            imgWidth: activeDoc.imgWidth,
            imgHeight: activeDoc.imgHeight,
            items: activeDoc.items,
            ocrSource: 'ocr',
            itemCount: activeDoc.items.length,
            pdfSuggestedScaleFhd: activeDoc.pdfSuggestedScaleFhd ?? PDF_RENDER_SCALE_DEFAULT,
            pdfSuggestedScale4k: activeDoc.pdfSuggestedScale4k ?? (PDF_RENDER_SCALE_DEFAULT * 2),
            ocrFullText: activeDoc.ocrFullText,
          };
        }
        try {
          const pageProxy = await pdfDoc.getPage(pageNum);
          const pageScale = resolvePdfRenderScale(pageProxy, ocrPdfLoadOptions);
          const cached = getCachedPdfPagePreview(pdfDoc, pageNum, pageScale);
          if (cached && cached.itemCount > 0) {
            report?.(`Captura instantânea (cache) página ${pageNum}/${total}…`, {
              page: pageNum,
              total,
              rows: cached.itemCount,
            });
            return cached;
          }
        } catch {
          /* fallback vazio abaixo */
        }
        report?.(`Página ${pageNum}: sem captura prévia em cache`, { page: pageNum, total });
        return {
          previewUrl: '',
          imgWidth: 0,
          imgHeight: 0,
          items: [],
          ocrSource: 'ocr',
          itemCount: 0,
          pdfSuggestedScaleFhd: 0,
          pdfSuggestedScale4k: 0,
          ocrFullText: '',
        };
      }

      const total = extractTotalPagesRef.current;
      const report = extractReporterRef.current;
      if (report) {
        report(`OCR para colar na tabela — página ${pageNum} de ${total}…`, { page: pageNum, total });
      } else {
        setLoadMsg(PDF_SCANNER_OCR_MSG.limpandoPagina(pageNum));
      }
      return promiseWithTimeout(
        loadPdfPageOcrForExtract(pageNum, {
          onProgress: (m) => forwardPageOcrProgress(pageNum, m),
          forExtract: true,
        }),
        PDF_PAGE_OCR_TIMEOUT_MS,
        `Tempo esgotado na página ${pageNum}. Abra essa página no visualizador, aguarde o OCR e tente importar de novo.`,
      );
    },
    [currentPage, doc, forwardPageOcrProgress, loadPdfPageOcrForExtract, ocrPdfLoadOptions, previewUrl, supportsValorModo],
  );

  const importaExtratoPdfAutomatico = false;

  const strictFaixaVertical = faixaInicioMarcado || faixaFimMarcado;

  function formatAiExtractError(
    result: AiExtractExtratoResult | AiExtractPlanoResult,
    entityLabel = 'lançamentos',
  ): string {
    if (result.detail?.trim()) return result.detail;
    if (result.reason === 'parse_error') {
      return `A IA extraiu dados mas o JSON veio incompleto — tente de novo ou use modo Híbrido.`;
    }
    if (result.reason?.includes('not_configured')) {
      return 'Configure provedor e chave API em Contábil → IA.';
    }
    if (result.reason === 'empty_extraction') {
      return `A IA não encontrou ${entityLabel} neste documento. Tente modo Híbrido ou marque as colunas manualmente.`;
    }
    if (result.reason === 'network_error') {
      return result.detail ?? 'Falha de rede ao chamar a IA — reinicie npm run dev e tente de novo.';
    }
    return `A IA não extraiu ${entityLabel}. Tente modo Híbrido ou aguarde o OCR da página terminar.`;
  }

  const extractProgressPct = useMemo(() => {
    if (!extractProgress || extractProgress.total <= 0) return 0;
    if (extractProgress.page > 0) {
      const safePage = Math.min(extractProgress.page, extractProgress.total);
      return Math.min(100, Math.round((safePage / extractProgress.total) * 100));
    }
    if (extractProgress.rows > 0) {
      return Math.min(92, 12 + extractProgress.rows * 3);
    }
    return Math.min(100, extractProgress.log.length * 8);
  }, [extractProgress]);

  const extractProgressBarCss = useMemo(() => {
    if (!extracting || !extractProgress) return '';
    return `.doc-colunas-extract-progress-fill { width: ${extractProgressPct}%; }`;
  }, [extracting, extractProgress, extractProgressPct]);

  const extractProgressSummary = useMemo(() => {
    if (!extractProgress) return '';
    const parts: string[] = [];
    if (extractProgress.page > 0 && extractProgress.total > 0) {
      parts.push(`Página ${extractProgress.page}/${extractProgress.total}`);
    }
    if (extractProgress.rows > 0) {
      parts.push(`${extractProgress.rows} lançamento(s)`);
    }
    return parts.join(' · ');
  }, [extractProgress]);

  useEffect(() => {
    // Cache de OCR é limpo automaticamente nos fluxos de troca de arquivo e extração.
    prefetchAbortRef.current = false;
    return () => {
      prefetchAbortRef.current = true;
    };
  }, []);

  const ensureAutoCropMappingForLiteralExtract = useCallback((): {
    ok: boolean;
    mapped: boolean;
  } => {
    const hasMappedNow = columns.some((c) => !c.id.startsWith('ignorar') && c.start !== c.end);
    if (!extratoRecorteLiteral || !supportsValorModo) {
      return { ok: true, mapped: hasMappedNow };
    }
    const refW = doc?.imgWidth || imageRef.current?.naturalWidth || imgSize.width || 0;
    const refH = doc?.imgHeight || imageRef.current?.naturalHeight || imgSize.height || 0;
    if (refW <= 0 || refH <= 0) {
      setError('Não foi possível preparar o auto-recorte: largura/altura da página inválida.');
      return { ok: false, mapped: false };
    }

    const hasMapped = hasMappedNow;
    const hasFaixa = faixaInicioMarcado || faixaFimMarcado;
    let nextColumns = columns;
    let nextFaixaStart = faixaStart;
    let nextFaixaEnd = faixaEnd;
    let nextFaixaInicioMarcado = faixaInicioMarcado;
    let nextFaixaFimMarcado = faixaFimMarcado;

    if (!hasMapped) {
      const suggested =
        doc?.items?.length && doc.items.length > 20
          ? suggestExtratoBancarioColumns(doc.items, refW)
          : null;
      if (suggested?.columns?.some((c) => !c.id.startsWith('ignorar') && c.start !== c.end)) {
        nextColumns = suggested.columns;
        nextFaixaStart = Math.max(0, suggested.faixaStart);
        nextFaixaEnd = Math.min(refH, Math.max(suggested.faixaEnd, suggested.faixaStart + 24));
        nextFaixaInicioMarcado = true;
        nextFaixaFimMarcado = true;
      } else {
        const defs = campoDefs.filter((f) => !String(f.id).startsWith('ignorar'));
        if (defs.length === 0) {
          setError('Não há colunas configuradas para auto-recorte.');
          return { ok: false, mapped: false };
        }
        const cols: GenericColunaDef[] = defs.map((f, idx) => {
          const x0 = Math.round((idx / defs.length) * refW);
          const x1 = Math.round(((idx + 1) / defs.length) * refW);
          const start = Math.max(0, Math.min(refW - 2, x0));
          const end = Math.max(start + 2, Math.min(refW, x1));
          return {
            id: f.id,
            start,
            end,
            color: f.color || 'bg-zinc-400',
          };
        });
        nextColumns = cols;
      }
    }

    if (!hasFaixa) {
      nextFaixaStart = 0;
      nextFaixaEnd = refH;
      nextFaixaInicioMarcado = true;
      nextFaixaFimMarcado = true;
    }

    const mappedNow = nextColumns.some((c) => !c.id.startsWith('ignorar') && c.start !== c.end);
    if (!mappedNow) {
      setError('Auto-recorte não encontrou colunas válidas.');
      return { ok: false, mapped: false };
    }

    userMappedColumnsRef.current = true;
    setColumns(nextColumns);
    setFaixaStart(nextFaixaStart);
    setFaixaEnd(nextFaixaEnd);
    setFaixaInicioMarcado(nextFaixaInicioMarcado);
    setFaixaFimMarcado(nextFaixaFimMarcado);
    setClickStep('start');
    setActiveId(firstCampoId);
    setError(null);

    const nextSnap = {
      columns: nextColumns,
      faixaStart: nextFaixaStart,
      faixaEnd: nextFaixaEnd,
      faixaInicioMarcado: nextFaixaInicioMarcado,
      faixaFimMarcado: nextFaixaFimMarcado,
      semDelimitacaoVertical,
      imgWidth: refW,
      imgHeight: refH,
    };
    pageStatesRef.current.set(currentPage, nextSnap);
    pageStatesRef.current.set(1, nextSnap);
    bumpMappingRevision();
    return { ok: true, mapped: true };
  }, [
    bumpMappingRevision,
    campoDefs,
    columns,
    currentPage,
    doc?.imgHeight,
    doc?.imgWidth,
    doc?.items,
    extratoRecorteLiteral,
    faixaEnd,
    faixaFimMarcado,
    faixaInicioMarcado,
    faixaStart,
    firstCampoId,
    imgSize.height,
    imgSize.width,
    semDelimitacaoVertical,
    supportsValorModo,
  ]);

  const handleConfirm = async () => {
    if (!doc) return;
    let hasMappedColumnsForExtract = columns.some(
      (c) => !c.id.startsWith('ignorar') && c.start !== c.end,
    );
    if (extratoRecorteLiteral && supportsValorModo) {
      const auto = ensureAutoCropMappingForLiteralExtract();
      if (!auto.ok) return;
      hasMappedColumnsForExtract = auto.mapped;
    }
    if (
      supportsValorModo &&
      hasMappedColumnsForExtract &&
      aiExtractEngine !== 'ai' &&
      !extratoRecorteLiteral
    ) {
      if (!faixaInicioMarcado) {
        setError('Marque a linha verde (início da delimitação). Nada acima dela será colado na tabela.');
        return;
      }
      if (!temColunaValorMapeada) {
        setError('Marque a coluna de valor (débito, crédito ou misto) na imagem.');
        return;
      }
      if (!extratoMapeamentoValidacao.ok) {
        const primeiroErro = extratoMapeamentoValidacao.checks.find((c) => !c.ok && c.nivel === 'error');
        setError(
          primeiroErro?.mensagem ||
          extratoSegmentacaoPreview.auditMensagem ||
          'Validação do mapeamento falhou — ajuste colunas ou faixa vertical.',
        );
        return;
      }
    }
    if (loading || (!ocrDeferredUntilExtract && ocrLoading)) {
      setError('Aguarde a prévia carregar antes de processar.');
      return;
    }
    setExtracting(true);
    setError(null);
    const extractTotalPages = doc.totalPages ?? 1;

    if (supportsValorModo && onConfirm) {
      mappingUiSnapshotRef.current = { zoomLevel, currentPage };
      literalCropRowsRef.current = [];
    }

    const initExtractMessage = extratoRecorteLiteral
      ? 'Recorte das colunas iniciado — preparando tabela antes da leitura OCR…'
      : 'Motor 1/5 · Coluna Data — iniciando leitura OCR…';
    setExtractProgress({
      message: initExtractMessage,
      page: 0,
      total: extractTotalPages,
      rows: 0,
      log: [initExtractMessage],
    });
    const reportExtract = (
      msg: string,
      patch?: { page?: number; total?: number; rows?: number },
    ) => {
      setLoadMsg(msg);
      setExtractProgress((prev) => {
        const log = prev?.log ?? [];
        const nextLog = log.length > 0 && log[log.length - 1] === msg ? log : [...log.slice(-14), msg];
        return {
          message: msg,
          page: patch?.page ?? prev?.page ?? 0,
          total: patch?.total ?? prev?.total ?? extractTotalPages,
          rows: patch?.rows ?? prev?.rows ?? 0,
          log: nextLog,
        };
      });
    };
    extractReporterRef.current = reportExtract;
    extractTotalPagesRef.current = extractTotalPages;
    prefetchAbortRef.current = true;
    try {
      saveCurrentPageMapping();
      const docTotalPages = doc.totalPages ?? 1;
      const { startPage: extractStartPage, endPage: extractEndPage } = resolveExtractPageRange(
        pageStatesRef.current,
        docTotalPages,
      );
      extractTotalPagesRef.current = docTotalPages;

      if (supportsValorModo && fileIsPdf && doc.pdfDoc) {
        clearPdfPagePreviewCache(doc.pdfDoc);
      }

      if (fileIsPdf && doc.pdfDoc) {
        await syncPdfResolutionForExtract(reportExtract, supportsValorModo);
      }

      const activeEngine: AiExtractEngine = aiExtractEngine;
      logExtratoExtractBuild(activeEngine);
      reportExtract(
        extratoRecorteLiteral
          ? `Recorte literal por colunas · build ${EXTRATO_EXTRACT_BUILD_ID}`
          : `Motor: ${EXTRACT_ENGINE_BANNER_LABELS[activeEngine]} · build ${EXTRATO_EXTRACT_BUILD_ID}`,
      );

      let extratoOrdemSeq = 0;

      const pushExtracaoLiveRows = (
        partialRows: GenericOcrRow[],
        patch?: { skippedPages?: number[]; statementYear?: string },
      ) => {
        if (!supportsValorModo || !onConfirm) return;
        const sorted = [...partialRows].sort((a, b) => {
          const pa = Number(a._extratoPagina ?? 0) - Number(b._extratoPagina ?? 0);
          if (pa !== 0) return pa;
          return Number(a._extratoOrdem ?? 0) - Number(b._extratoOrdem ?? 0);
        });
        // Modo ao vivo: leve e rápido, sem pós-processamentos custosos.
        const prepared = sorted.map((r) => ({
          ...r,
          _pagina: r._pagina ?? r._extratoPagina,
        }));
        if (extratoRecorteLiteral) literalCropRowsRef.current = prepared;
        // Sem tela de revisão — só acumula linhas para o confirm final.
      };

      /** Acumula lançamentos página a página (sem abrir revisão). */
      const appendExtratoRowsLive = (
        target: GenericOcrRow[],
        pageRows: GenericOcrRow[],
        pageNum: number,
        _skippedPages: number[],
      ) => {
        for (const row of pageRows) {
          extratoOrdemSeq += 1;
          target.push({
            ...row,
            _extratoOrdem: String(extratoOrdemSeq),
            _extratoPagina: String(pageNum),
          });
        }
        if (extratoRecorteLiteral) literalCropRowsRef.current = [...target];
        reportExtract(`Lançamentos ${target.length} (pág. ${pageNum})…`, {
          page: pageNum,
          total: docTotalPages,
          rows: target.length,
        });
      };

      const publishCropPreviewRows = (pageNum: number, pageRows: GenericOcrRow[]) => {
        if (!supportsValorModo || !onConfirm || pageRows.length === 0) return;
        const kept = literalCropRowsRef.current.filter(
          (r) => Number(r._extratoPagina ?? r._pagina ?? 0) !== pageNum,
        );
        const tagged = pageRows.map((r, idx) => ({
          ...r,
          _extratoPagina: String(pageNum),
          _pagina: String(pageNum),
          _extratoOrdem: String(idx + 1),
        }));
        const merged = [...kept, ...tagged].sort((a, b) => {
          const pa = Number(a._extratoPagina ?? a._pagina ?? 0) - Number(b._extratoPagina ?? b._pagina ?? 0);
          if (pa !== 0) return pa;
          return Number(a._extratoOrdem ?? 0) - Number(b._extratoOrdem ?? 0);
        });
        if (extratoRecorteLiteral) literalCropRowsRef.current = merged;
      };

      const buildLiteralFallbackRowsFromOcr = (ocrBlob?: string): GenericOcrRow[] => {
        const rawText = String(ocrBlob || doc.ocrFullText || '').trim();
        const pageTag = String(Math.max(1, currentPage || 1));
        if (rawText) {
          return rawText
            .split(/\r?\n/)
            .map((line) => String(line || '').replace(/\s+/g, ' ').trim())
            .filter((line) => line.length >= 6)
            .slice(0, 240)
            .map((line, idx) => ({
              descricao: line,
              _linhaOcr: line,
              _pagina: pageTag,
              _extratoOrdem: String(idx + 1),
            }));
        }

        const items = [...(doc.items ?? [])]
          .filter((it) => String(it.str || '').trim().length > 0)
          .sort((a, b) => a.y - b.y || a.x - b.x);
        if (items.length === 0) return [];

        const lines: string[] = [];
        let bucket: typeof items = [];
        let lastY = Number(items[0]?.y ?? 0);
        for (const it of items) {
          if (bucket.length === 0) {
            bucket.push(it);
            lastY = it.y;
            continue;
          }
          const yGap = Math.abs(it.y - lastY);
          if (yGap <= Math.max(8, it.h * 0.8)) {
            bucket.push(it);
            lastY = it.y;
            continue;
          }
          const line = bucket
            .slice()
            .sort((a, b) => a.x - b.x)
            .map((x) => String(x.str || '').trim())
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (line.length >= 6) lines.push(line);
          bucket = [it];
          lastY = it.y;
        }
        if (bucket.length > 0) {
          const line = bucket
            .slice()
            .sort((a, b) => a.x - b.x)
            .map((x) => String(x.str || '').trim())
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (line.length >= 6) lines.push(line);
        }
        return lines.slice(0, 240).map((line, idx) => ({
          descricao: line,
          _linhaOcr: line,
          _pagina: pageTag,
          _extratoOrdem: String(idx + 1),
        }));
      };

      const finishExtratoRows = async (
        rows: GenericOcrRow[],
        meta?: OcrConfirmMeta,
        skippedPages?: number[],
        ocrText?: string,
      ) => {
        const baseRows =
          extratoRecorteLiteral && rows.length === 0 && literalCropRowsRef.current.length > 0
            ? literalCropRowsRef.current
            : rows;
        if (EXTRATO_INSTANT_CAPTURE_MODE && supportsValorModo && onConfirm) {
          persistIgnoreLineWords(ignoreLineWordsText);
          const reviewRows = baseRows.length > 0 ? baseRows : buildLiteralFallbackRowsFromOcr(ocrText);
          const tagged = reviewRows.map((r) => ({
            ...r,
            _pagina: r._pagina ?? r._extratoPagina,
          }));
          onConfirm(tagged, meta);
          return;
        }
        if (supportsValorModo && onConfirm) {
          let finalRows = baseRows;
          let finalMeta = meta;
          if (isExtratoOcr && !extratoRecorteLiteral && !scannerPureAi) {
            const aiCfg = await fetchAiConfig();
            const stmtYear =
              extractStatementYear(ocrText || doc.ocrFullText || '') ||
              String(new Date().getFullYear());
            try {
              const pkg = await buildExtratoReviewPackage(rows, meta, {
                file,
                fileIsPdf,
                pdfDoc: doc.pdfDoc,
                pdfRenderScale,
                totalPages: doc.totalPages ?? 1,
                ocrText: ocrText || doc.ocrFullText,
                engine: activeEngine,
                scale: doc.pdfRenderScale ?? pdfRenderScale,
                statementYear: stmtYear,
                ignoreLineWords: effectiveIgnoreLineWordsList,
                buildExtratoGenericOptions,
                report: reportExtract,
                autoEscalate: activeEngine === 'hybrid',
                columnMapped: hasMappedColumnsForExtract,
                aiProviderId: aiCfg?.config?.providerId,
                aiModel: aiCfg?.config?.model,
                getPageImage:
                  activeEngine === 'ai'
                    ? async (pageNum) => {
                      let pageUrl = pageNum === currentPage ? (previewUrl ?? doc.previewUrl) : null;
                      if (doc.pdfDoc && pageNum !== currentPage) {
                        const preview = await renderPdfPagePreview(
                          doc.pdfDoc,
                          pageNum,
                          reportExtract,
                          { pdfRenderScale, deferOcr: true, useCache: true },
                        );
                        pageUrl = preview.previewUrl ?? pageUrl;
                      }
                      if (!pageUrl) return null;
                      return previewUrlToBase64(pageUrl, 2400);
                    }
                    : undefined,
              });
              if (pkg.rows.length > 0) {
                finalRows = pkg.rows;
                finalMeta = {
                  ...pkg.meta,
                  conciliacaoRawRows: pkg.meta.conciliacaoRawRows as GenericOcrRow[] | undefined,
                  extractDiagnostic: pkg.meta.extractDiagnostic as any,
                  ocrTextBlob: ocrText || doc.ocrFullText || undefined,
                };
              }
            } catch {
              finalRows = rows;
            }
          }
          // Evita regressão de contagem no fim da extração (modo com OCR posicional).
          if (!scannerPureAi && finalRows.length < baseRows.length) {
            reportExtract(
              `Ajuste anti-perda: mantendo ${baseRows.length} lançamento(s) detectado(s) (pós-processamento gerou ${finalRows.length}).`,
            );
            finalRows = baseRows;
          }
          if (!scannerPureAi && finalRows.length === 0 && baseRows.length > 0) {
            finalRows = baseRows;
          }
          if (extratoRecorteLiteral) {
            reportExtract('Recortes colados na tabela — OCR leu cada coluna sobre o recorte.', {
              rows: finalRows.length,
            });
          }
          const withDates = extratoRecorteLiteral
            ? finalRows
            : propagateExtratoDatesOcrRows(
                finalRows.map((r) => ({ ...r } as OcrExtratoRow)),
                extractStatementYear(ocrText || doc.ocrFullText || '') ||
                  String(new Date().getFullYear()),
              );
          if (scannerPureAi && withDates.length === 0) {
            throw new Error(
              'A IA não retornou lançamentos. Verifique a chave API em Contábil → IA ou use imagem/PDF mais nítido.',
            );
          }
          const fallbackRowsFromOcr =
            !scannerPureAi && withDates.length === 0 ? buildLiteralFallbackRowsFromOcr(ocrText) : [];
          const reviewRows = withDates.length > 0 ? withDates : fallbackRowsFromOcr;
          onConfirm(
            reviewRows.map((r) => ({
              ...r,
              _pagina: r._pagina ?? r._extratoPagina,
            })),
            finalMeta,
          );
          return;
        }
        onConfirm?.(rows, meta);
      };

      /** Refino IA após extração posicional pelas colunas (somente modo híbrido). */
      const applyEngineRefine = async (
        rows: GenericOcrRow[],
        ocrText?: string,
      ): Promise<{ rows: GenericOcrRow[]; skipped?: boolean }> => {
        if (extratoRecorteLiteral) return { rows, skipped: true };
        if (rows.length === 0 || activeEngine !== 'hybrid') return { rows, skipped: true };
        reportExtract('Refinando linhas extraídas pelas colunas com IA…');
        const aiCfg = await fetchAiConfig();
        const refined = await refineOcrRowsWithAi({
          lines: rows,
          ocrText,
          providerId: aiCfg?.config?.providerId,
          model: aiCfg?.config?.model,
          documentType: isPlanoOcr ? 'plano' : 'extrato',
        });
        return {
          rows: refined.rows.length > 0 ? marcarRowsExtracaoAi(refined.rows) : rows,
          skipped: refined.skipped,
        };
      };

      /** Finaliza extração por colunas; no híbrido tenta visão se o refino falhar. */
      const finalizeColumnExtractRows = async (
        rows: GenericOcrRow[],
        ocrText: string | undefined,
        tagPage: number | null,
        skippedPages?: number[],
      ) => {
        const refined = await applyEngineRefine(rows, ocrText);
        if (!extratoRecorteLiteral && activeEngine === 'hybrid' && rows.length === 0) {
          try {
            reportExtract('Nenhuma linha pelo OCR — tentando IA (visão)…');
            if (isPlanoOcr) {
              const vision = await runFullAiPlanoVisionExtract();
              if (vision.rows.length > 0) {
                await finishExtratoRows(tagOcrRowsPagina(vision.rows, 1), undefined, undefined, ocrText);
                return;
              }
            } else {
              const vision = await runFullAiVisionExtract();
              if (vision.rows.length > 0) {
                persistIgnoreLineWords(ignoreLineWordsText);
                await finishExtratoRows(tagOcrRowsPagina(vision.rows, 1), vision.meta, undefined, ocrText);
                return;
              }
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (/demorou demais|timeout|aborted/i.test(msg)) {
              setError(
                'IA demorou demais. Marque as colunas manualmente ou reduza o número de páginas.',
              );
            }
          }
        }
        persistIgnoreLineWords(ignoreLineWordsText);
        let prepared = refined.rows;
        if (supportsValorModo && prepared.length > 0) {
          const preparedRaw = [...prepared];
          const stmtYear =
            extractStatementYear(
              ocrText ||
              prepared.map((r) => String(r._linhaOcr ?? r.descricao ?? '')).join(' '),
            ) || String(new Date().getFullYear());
          const posProcessados = prepararExtratoOcrRowsParaRevisao(prepared, {
            statementYear: stmtYear,
            ignoreLineWords: effectiveIgnoreLineWordsList,
            preserveSegmentRows: true,
            ocrFullText: ocrText || undefined,
          });
          const preparedSanitized = propagateExtratoDatesOcrRows(
            mesclarHistoricoContinuacaoExtratoAoVivo(
              prepared.map((r) => sanitizeExtratoOcrRowColumns({ ...r } as OcrExtratoRow)),
            ),
            stmtYear,
          );
          if (posProcessados.length > 0) {
            prepared = posProcessados;
          } else {
            prepared = preparedSanitized;
          }
          // Evita perder lançamentos já detectados por coluna/OCR.
          if (prepared.length < preparedRaw.length) {
            prepared = propagateExtratoDatesOcrRows(
              preparedRaw.map((r) => sanitizeExtratoOcrRowColumns({ ...r } as OcrExtratoRow)),
              stmtYear,
            );
          }
          if (ocrText?.trim()) {
            // Não força histórico por inferência global do OCR: preserva o texto fiel da linha.
            prepared = propagateExtratoDatesOcrRows(prepared, stmtYear);
          }
        }
        const tagged =
          tagPage != null ? tagOcrRowsPagina(prepared, tagPage) : prepared;
        const stmtYearFinalize =
          extractStatementYear(
            ocrText || prepared.map((r) => String(r._linhaOcr ?? r.descricao ?? '')).join(' '),
          ) || String(new Date().getFullYear());
        pushExtracaoLiveRows(tagged, { skippedPages, statementYear: stmtYearFinalize });
        await finishExtratoRows(tagged, undefined, skippedPages, ocrText);
      };

      const runFullAiPlanoVisionExtract = async (): Promise<{ rows: GenericOcrRow[] }> => {
        reportExtract('Preparando plano de contas para IA (visão)…');
        const images: Awaited<ReturnType<typeof previewUrlToBase64>>[] = [];
        const ocrTextParts: string[] = [];
        const totalPages = doc.totalPages ?? 1;
        const maxPages = Math.min(totalPages, 8);

        for (let p = 1; p <= maxPages; p++) {
          reportExtract(`Preparando página ${p} de ${maxPages} para IA…`, { page: p, total: maxPages });
          let pageUrl = p === currentPage ? (previewUrl ?? doc.previewUrl) : null;
          let pageOcrText = '';

          if (doc.pdfDoc) {
            if (p === currentPage) {
              pageUrl = previewUrl ?? doc.previewUrl;
              pageOcrText = doc.ocrFullText ?? doc.items.map((i) => i.str).join('\n');
            } else {
              const preview = await renderPdfPagePreview(
                doc.pdfDoc,
                p,
                (m) => reportExtract(m, { page: p, total: maxPages }),
                { pdfRenderScale, deferOcr: true, useCache: true },
              );
              pageUrl = preview.previewUrl ?? pageUrl;
              pageOcrText = preview.ocrFullText ?? preview.items.map((i) => i.str).join('\n');
            }
          } else if (p === currentPage) {
            pageOcrText = doc.ocrFullText ?? doc.items.map((i) => i.str).join('\n');
          }

          if (pageOcrText.trim()) ocrTextParts.push(pageOcrText.trim());

          if (pageUrl) {
            const img = await previewUrlToBase64(pageUrl, 2400);
            if (img) images.push(img);
          }
        }

        const ocrTextAgg = ocrTextParts.join('\n\n');
        if (images.length === 0 && !ocrTextAgg.trim()) {
          throw new Error(
            'Não foi possível enviar imagem nem texto à IA. Aguarde a prévia carregar e tente de novo.',
          );
        }

        reportExtract(
          images.length > 1
            ? `Extraindo plano com IA (${images.length} páginas)…`
            : 'Extraindo contas com IA (visão)…',
        );
        const aiCfg = await fetchAiConfig();
        const aiResult = await extractPlanoWithAi({
          ocrText: ocrTextAgg || doc.ocrFullText || undefined,
          images: images.filter(Boolean) as NonNullable<(typeof images)[number]>[],
          fileName: file.name,
          providerId: aiCfg?.config?.providerId,
          model: aiCfg?.config?.model,
          perPage: images.length > 4,
        });
        if (!aiResult.ok || !aiResult.rows?.length) {
          throw new Error(formatAiExtractError(aiResult, 'contas'));
        }
        return { rows: marcarRowsExtracaoAi(aiResult.rows) };
      };

      const finishAiPlanoVisionExtract = async () => {
        const vision = await runFullAiPlanoVisionExtract();
        await finishExtratoRows(tagOcrRowsPagina(vision.rows, 1), undefined, undefined, doc.ocrFullText);
      };

      const runFullAiVisionExtract = async (): Promise<{
        rows: GenericOcrRow[];
        meta: OcrConfirmMeta;
      }> => {
        reportExtract('Preparando documento para IA (visão)…');
        const images: Awaited<ReturnType<typeof previewUrlToBase64>>[] = [];
        const ocrTextParts: string[] = [];
        const totalPages = doc.totalPages ?? 1;
        const maxPages = Math.min(totalPages, 6);

        for (let p = 1; p <= maxPages; p++) {
          reportExtract(`Preparando página ${p} de ${maxPages} para IA…`, { page: p, total: maxPages });
          let pageUrl = p === currentPage ? (previewUrl ?? doc.previewUrl) : null;

          if (doc.pdfDoc) {
            const preview = await renderPdfPagePreview(
              doc.pdfDoc,
              p,
              (m) => reportExtract(m, { page: p, total: maxPages }),
              { pdfRenderScale, deferOcr: true, useCache: true },
            );
            pageUrl = preview.previewUrl ?? pageUrl;
            if (!scannerPureAi) {
              const pageOcrText = preview.ocrFullText ?? preview.items.map((i) => i.str).join('\n');
              if (pageOcrText.trim()) ocrTextParts.push(pageOcrText.trim());
            }
          }

          if (pageUrl) {
            const img = await previewUrlToBase64(pageUrl, 2400);
            if (img) images.push(img);
          }
        }

        const ocrTextAgg = scannerPureAi ? '' : ocrTextParts.join('\n\n');
        if (images.length === 0) {
          throw new Error(
            'Não foi possível enviar a imagem à IA. Aguarde a prévia carregar e tente de novo.',
          );
        }

        reportExtract(
          images.length > 1
            ? `Extraindo com IA pura (${images.length} páginas, uma por vez)…`
            : 'Extraindo lançamentos com IA pura (visão)…',
        );
        const stmtYearAi =
          extractStatementYear(
            ocrTextAgg || doc.ocrFullText || doc.items.map((i) => i.str).join(' '),
          ) || String(new Date().getFullYear());
        const aiCfg = await fetchAiConfig();
        const filePayload = await fileToBase64Payload(file);
        const aiResult = await extractExtratoWithAi({
          ocrText: scannerPureAi ? undefined : ocrTextAgg || doc.ocrFullText || undefined,
          images:
            filePayload?.mimeType.includes('pdf')
              ? undefined
              : (images.filter(Boolean) as NonNullable<(typeof images)[number]>[]),
          statementYear: stmtYearAi,
          fileName: file.name,
          providerId: aiCfg?.config?.providerId,
          model: aiCfg?.config?.model,
          perPage: images.length > 4,
          fileBase64: filePayload?.fileBase64,
          mimeType: filePayload?.mimeType,
        });
        if (!aiResult.ok || !aiResult.rows?.length) {
          throw new Error(formatAiExtractError(aiResult));
        }
        if (aiResult.detail?.includes('conciliado')) {
          setError(null);
        }
        const rowsPosProcessados = prepararExtratoOcrRowsParaRevisao(marcarRowsExtracaoAi(aiResult.rows), {
          statementYear: stmtYearAi,
          ignoreLineWords: effectiveIgnoreLineWordsList,
          preserveSegmentRows: true,
        });
        const saldoAnteriorAi = resolverSaldoAnteriorParaMetaExtrato({
          rows: rowsPosProcessados,
          ocrText: ocrTextAgg || doc.ocrFullText || '',
        });
        return {
          rows: rowsPosProcessados,
          meta: {
            // Sem saldo de PDF/OCR — OK/placar usa só Anterior + C − D dos lançamentos.
            saldoAnterior: saldoAnteriorAi,
          },
        };
      };

      const finishAiVisionExtract = async () => {
        const vision = await runFullAiVisionExtract();
        persistIgnoreLineWords(ignoreLineWordsText);
        await finishExtratoRows(tagOcrRowsPagina(vision.rows, 1), vision.meta, undefined, doc.ocrFullText);
      };

      /** Fallback: colunas sem linhas → IA visão (modos IA ou Híbrido). */
      const tryAiVisionIfNoColumnRows = async (columnRowCount: number): Promise<boolean> => {
        if (columnRowCount > 0) return false;
        if (activeEngine !== 'ai' && activeEngine !== 'hybrid') return false;
        reportExtract('Nenhuma linha pelas colunas — tentando IA (visão)…');
        if (isPlanoOcr) {
          await finishAiPlanoVisionExtract();
        } else {
          await finishAiVisionExtract();
        }
        return true;
      };

      const buildExtratoGenericOptions = (ocrFullText?: string) => {
        const stmtYear =
          extractStatementYear(ocrFullText || doc.ocrFullText || '') ||
          String(new Date().getFullYear());
        if (itauProfileActive) {
          return getItauExtratoExtractGenericOptions(
            stmtYear,
            effectiveIgnoreLineWordsList,
            ocrFullText,
          );
        }
        return {
          dataColIds,
          headerKeywords,
          allowFaixaFallback: !scannerPureAi,
          extratoPositional: true,
          extratoPreserveSegmentRows: true,
          statementYear: stmtYear,
          ocrFullText,
          ignoreLineWords: effectiveIgnoreLineWordsList,
        };
      };

      /** PDF sem colunas manuais: OCR scanner + colunas sugeridas. */
      const tryAutoExtratoPdf = async (): Promise<GenericOcrRow[] | null> => {
        if (!supportsValorModo || !fileIsPdf || !doc.pdfDoc) return null;

        reportExtract('Extração automática: OCR scanner + colunas sugeridas…');
        const pages: ExtratoPosicionadoPage[] = [];
        for (let p = extractStartPage; p <= extractEndPage; p++) {
          try {
            const pageData = await getPageOcrDataForExtract(p);
            if (pageData.itemCount === 0) continue;
            if (pageData.ocrSource === 'pdf-text') {
              throw new Error('Extrato exige OCR na imagem — texto nativo do PDF não é usado.');
            }
            pages.push({
              items: pageData.items,
              imgWidth: pageData.imgWidth,
              imgHeight: pageData.imgHeight,
              ocrFullText: pageData.ocrFullText,
            });
          } catch {
            /* ignora página */
          }
        }
        if (pages.length === 0) return null;
        const fullText = pages.map((pg) => pg.ocrFullText ?? '').join('\n');
        const autoRows = await extractExtratoFromPosicionadoPages(
          pages,
          buildExtratoGenericOptions(fullText),
        );
        return autoRows.length > 0 ? autoRows : null;
      };

      /** Modo IA: sempre extração por visão (colunas servem só de referência visual). */
      if (scannerPureAi || (showExtractEngine && activeEngine === 'ai')) {
        try {
          reportExtract(
            scannerPureAi
              ? `IA pura (visão) · build ${EXTRATO_SCANNER_PURE_AI_BUILD_ID}`
              : `Motor: ${EXTRACT_ENGINE_BANNER_LABELS[activeEngine]} · build ${EXTRATO_EXTRACT_BUILD_ID}`,
          );
          if (isPlanoOcr) {
            await finishAiPlanoVisionExtract();
          } else if (supportsValorModo) {
            await finishAiVisionExtract();
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/demorou demais|timeout|aborted/i.test(msg)) {
            setError(
              'IA demorou demais. Marque as colunas manualmente ou reduza páginas.',
            );
          } else {
            throw e;
          }
        }
        return;
      }

      if (supportsValorModo && fileIsPdf && !hasMappedColumnsForExtract && !scannerPureAi) {
        const autoRows = await tryAutoExtratoPdf();
        if (autoRows?.length) {
          const ocrText = autoRows.map((r) => String(r._linhaOcr ?? r.descricao ?? '')).join('\n');
          await finalizeColumnExtractRows(autoRows, ocrText, null);
          return;
        }
      }

      const enrichExtratoPageRows = (
        pageItems: PdfPagePreviewResult['items'],
        pageRows: GenericOcrRow[],
        pageMapping: { columns: Array<{ id: string; start: number; end: number }> },
        imgWidth: number,
      ): GenericOcrRow[] => {
        let out = enrichItauExtratoRowsFromPageItems(pageItems, pageRows, imgWidth);
        const valorBounds = resolveExtratoValorColBoundsFromColumns(pageMapping.columns, imgWidth);
        return enrichExtratoHistoricoLinhaOcrFromPageItems(
          pageItems,
          out,
          imgWidth,
          valorBounds,
        );
      };

      const extractRowsFromColumnCropOcr = async (
        pageData: PdfPagePreviewResult,
        mapping: GenericColunasMapping,
        pageNum: number,
      ): Promise<GenericOcrRow[]> => {
        const preview = String(pageData.previewUrl || '').trim();
        if (!preview) return [];

        const y0 = Math.max(0, Math.min(mapping.faixa?.startY ?? 0, mapping.faixa?.endY ?? pageData.imgHeight));
        const y1 = Math.min(
          pageData.imgHeight,
          Math.max(mapping.faixa?.startY ?? 0, mapping.faixa?.endY ?? pageData.imgHeight),
        );
        const cropHeight = Math.max(1, Math.round(y1 - y0));
        if (cropHeight < 2) return [];

        const columnsMapped = mapping.columns.filter(
          (c) => !c.id.startsWith('ignorar') && Number.isFinite(c.start) && Number.isFinite(c.end),
        );
        if (columnsMapped.length === 0) return [];

        const buildGeometricCropRows = (
          expectedRows?: number,
          marker = 'RECORTE PDF',
        ): GenericOcrRow[] => {
          const faixaHeight = Math.max(1, y1 - y0);
          const approxRowH = Math.max(22, Math.min(40, Math.round(faixaHeight / 24)));
          const maxByFaixa = Math.max(1, Math.floor(faixaHeight / Math.max(16, approxRowH * 0.7)));
          const rowCount = Math.max(
            1,
            Math.min(
              180,
              Number.isFinite(expectedRows ?? NaN) ? Number(expectedRows) : maxByFaixa,
            ),
          );
          return Array.from({ length: rowCount }, (_, idx) => {
            const y = y0 + Math.round((idx + 0.5) * (faixaHeight / rowCount));
            const row: GenericOcrRow = {
              descricao: marker,
              _linhaOcr: marker,
              _extratoSegY: String(Math.round(y)),
              _extratoOrdem: String(idx + 1),
            };
            for (const col of columnsMapped) {
              row[col.id] = marker;
            }
            return row;
          });
        };

        let previewRowsBase = (() => {
          if (!pageData.items?.length) return [] as GenericOcrRow[];
          const itemsInFaixa = pageData.items.filter((it) => it.y >= y0 && it.y <= y1);
          if (itemsInFaixa.length === 0) return [] as GenericOcrRow[];
          const sorted = [...itemsInFaixa].sort((a, b) => a.y - b.y || a.x - b.x);
          const medianH =
            sorted
              .map((it) => Math.max(1, it.h))
              .sort((a, b) => a - b)[Math.floor(sorted.length / 2)] || 10;
          const yTol = Math.max(7, medianH * 0.7);
          const rows: Array<{ y: number; cols: Record<string, string> }> = [];
          for (const it of sorted) {
            const text = String(it.str || '').trim();
            if (!text) continue;
            const xCenter = it.x + it.w / 2;
            const col = columnsMapped.find((c) => xCenter >= Math.min(c.start, c.end) && xCenter <= Math.max(c.start, c.end));
            if (!col) continue;
            let row = rows.find((r) => Math.abs(r.y - it.y) <= yTol);
            if (!row) {
              row = { y: it.y, cols: {} };
              rows.push(row);
            }
            row.cols[col.id] = row.cols[col.id]
              ? `${row.cols[col.id]} ${text}`.replace(/\s+/g, ' ').trim()
              : text;
          }
          return rows
            .sort((a, b) => a.y - b.y)
            .map((row, idx) => {
              const vals = Object.values(row.cols).filter(Boolean);
              const out = {
                ...row.cols,
                descricao: vals.join(' | ') || 'RECORTE PDF',
                _linhaOcr: vals.join(' | ') || 'RECORTE PDF',
                _extratoSegY: String(Math.round(row.y)),
                _extratoOrdem: String(idx + 1),
              } as GenericOcrRow;
              for (const col of columnsMapped) {
                if (!String(out[col.id] || '').trim()) out[col.id] = 'RECORTE PDF';
              }
              return out;
            });
        })();
        if (previewRowsBase.length > 0) {
          reportExtract('Recortes das colunas aplicados na tabela. OCR vai ler por cima agora…', {
            page: pageNum,
            total: docTotalPages,
            rows: previewRowsBase.length,
          });
          publishCropPreviewRows(pageNum, previewRowsBase);
        }

        if (extratoRecorteLiteral) {
          reportExtract('Etapa 1: leitor-e-recortador — detectando linhas por coluna no PDF…', {
            page: pageNum,
            total: docTotalPages,
          });

          type LRTextItem = { text: string; x: number; y: number; width: number; height: number };
          type LRRow = { y: number; height: number; items: LRTextItem[] };

          const detectRowsFromText = (textItems: LRTextItem[], toleranceY = 12): LRRow[] => {
            if (textItems.length === 0) return [];
            const sortedItems = [...textItems].sort((a, b) => {
              const ay = a.y + a.height / 2;
              const by = b.y + b.height / 2;
              return ay - by;
            });
            const rows: LRRow[] = [];
            for (const item of sortedItems) {
              const itemCenterY = item.y + item.height / 2;
              const found = rows.find((r) => {
                const rowCenterY = r.y + r.height / 2;
                return Math.abs(rowCenterY - itemCenterY) <= toleranceY;
              });
              if (found) {
                found.items.push(item);
                const minY = Math.min(...found.items.map((i) => i.y));
                const maxY = Math.max(...found.items.map((i) => i.y + i.height));
                found.y = minY;
                found.height = Math.max(maxY - minY, found.height);
              } else {
                rows.push({ y: item.y, height: item.height, items: [item] });
              }
            }
            const merged: LRRow[] = [];
            for (const row of rows.sort((a, b) => a.y - b.y)) {
              if (merged.length === 0) {
                merged.push(row);
                continue;
              }
              const last = merged[merged.length - 1]!;
              const lastCenter = last.y + last.height / 2;
              const curCenter = row.y + row.height / 2;
              if (Math.abs(lastCenter - curCenter) < 14) {
                last.items = [...last.items, ...row.items];
                const minY = Math.min(last.y, row.y);
                const maxY = Math.max(last.y + last.height, row.y + row.height);
                last.y = minY;
                last.height = maxY - minY;
              } else {
                merged.push(row);
              }
            }
            return merged.filter((r) => r.items.length > 0).sort((a, b) => a.y - b.y);
          };

          const analyzeValueString = (valStr: string): { isNegative: boolean; parsedValue: number | null } => {
            if (!valStr || valStr.trim() === '') return { isNegative: false, parsedValue: null };
            const clean = valStr.toUpperCase().trim();
            const isNegative =
              clean.includes('-') ||
              clean.includes(' D') ||
              clean.startsWith('D ') ||
              (clean.startsWith('(') && clean.endsWith(')'));
            try {
              let numericPart = clean
                .replace('R$', '')
                .replace('$', '')
                .replace('C', '')
                .replace('D', '')
                .replace('-', '')
                .replace('(', '')
                .replace(')', '')
                .trim();
              numericPart = numericPart.replace(/\./g, '').replace(',', '.');
              const parsed = parseFloat(numericPart);
              if (Number.isNaN(parsed)) return { isNegative, parsedValue: null };
              return { isNegative, parsedValue: isNegative ? -parsed : parsed };
            } catch {
              return { isNegative, parsedValue: null };
            }
          };

          const toRange = (col: GenericColunaDef) => {
            const x0 = Math.max(0, Math.min(col.start, col.end));
            const x1 = Math.min(pageData.imgWidth, Math.max(col.start, col.end));
            return { startX: x0, width: Math.max(1, x1 - x0) };
          };

          const pickColumn = (ids: string[]): GenericColunaDef | null =>
            columnsMapped.find((c) => ids.includes(c.id)) ?? null;

          const dateCol =
            pickColumn(['data', 'date']) ??
            columnsMapped[0] ??
            null;
          const histCol =
            pickColumn(['descricao', 'historico', 'history']) ??
            columnsMapped[Math.min(1, Math.max(0, columnsMapped.length - 1))] ??
            null;
          const valueCol =
            pickColumn(['valorMisto', 'valor', 'valorDebito', 'valorCredito', 'value']) ??
            columnsMapped[Math.min(2, Math.max(0, columnsMapped.length - 1))] ??
            null;

          if (dateCol && histCol && valueCol) {
            const textItems: LRTextItem[] = (pageData.items || [])
              .filter((it) => String(it.str || '').trim().length > 0)
              .map((it) => ({
                text: String(it.str || ''),
                x: it.x,
                y: it.y,
                width: it.w,
                height: it.h,
              }))
              .filter((it) => it.y >= y0 && it.y <= y1);

            const rowsDetected = detectRowsFromText(textItems, 12)
              .filter((r) => r.y + r.height / 2 >= y0 && r.y + r.height / 2 <= y1);

            const datePx = toRange(dateCol);
            const histPx = toRange(histCol);
            const valPx = toRange(valueCol);

            const rowItemsMap = new Map<number, LRTextItem[]>();
            rowsDetected.forEach((_, idx) => rowItemsMap.set(idx, []));
            for (const item of textItems) {
              const itemCenterY = item.y + item.height / 2;
              let closestIndex = -1;
              let minDistance = Number.POSITIVE_INFINITY;
              rowsDetected.forEach((row, idx) => {
                const rowCenterY = row.y + row.height / 2;
                const distance = Math.abs(itemCenterY - rowCenterY);
                if (distance < minDistance && distance <= 18) {
                  minDistance = distance;
                  closestIndex = idx;
                }
              });
              if (closestIndex !== -1) {
                rowItemsMap.get(closestIndex)!.push(item);
              }
            }

            const rawRows = rowsDetected.map((row, idx) => {
              const rowItems = (rowItemsMap.get(idx) || []).sort((a, b) => a.x - b.x);
              const dateTextParts: string[] = [];
              const histTextParts: string[] = [];
              const valueTextPartsRaw: string[] = [];
              for (const item of rowItems) {
                const cx = item.x + item.width / 2;
                const dateEnd = datePx.startX + datePx.width;
                const histEnd = histPx.startX + histPx.width;
                const valEnd = valPx.startX + valPx.width;
                if (cx >= datePx.startX - 5 && cx <= dateEnd + 5) dateTextParts.push(item.text);
                else if (cx >= histPx.startX - 10 && cx <= histEnd + 10) histTextParts.push(item.text);
                else if (cx >= valPx.startX - 5 && cx <= valEnd + 5) valueTextPartsRaw.push(item.text);
              }
              // Descarta código/documento/lote (nº inteiro com separador de milhar, sem centavos —
              // ex.: "9.903") que vaza para a faixa do valor: nunca é o valor do lançamento, e se
              // entrar aqui acaba colado ao valor real na hora de montar o texto da coluna.
              const looksLikeNonMonetaryCode = (text: string) => /^\d{1,3}(?:\.\d{3})+$/.test(text.trim());
              const valueTextPartsFiltered = valueTextPartsRaw.filter((t) => !looksLikeNonMonetaryCode(t));
              const valueTextParts = valueTextPartsFiltered.length > 0 ? valueTextPartsFiltered : valueTextPartsRaw;
              const dateText = dateTextParts.join(' ').trim();
              const historyText = histTextParts.join(' ').trim();
              const valueText = valueTextParts.join(' ').trim();
              return {
                y: row.y,
                dateText,
                historyText,
                valueText,
              };
            });

            const mergedRows: typeof rawRows = [];
            rawRows.forEach((row, idx) => {
              if (idx === 0) {
                mergedRows.push(row);
                return;
              }
              const prev = mergedRows[mergedRows.length - 1]!;
              const hasValue = row.valueText.trim().length > 0;
              const hasDate = row.dateText.trim().length > 0;
              if (!hasValue && !hasDate && row.historyText.trim().length > 0) {
                prev.historyText = `${prev.historyText} ${row.historyText}`.trim();
              } else {
                mergedRows.push(row);
              }
            });

            const leitorRows = mergedRows.map((row, idx) => {
              const { isNegative } = analyzeValueString(row.valueText);
              const out: GenericOcrRow = {
                data: row.dateText || '',
                descricao: row.historyText || '',
                valorMisto: row.valueText || '',
                _linhaOcr: [row.dateText, row.historyText, row.valueText].filter(Boolean).join(' | ') || 'RECORTE PDF',
                _extratoSegY: String(Math.round(row.y)),
                _extratoOrdem: String(idx + 1),
              };
              if (row.valueText) {
                if (isNegative) {
                  out.valorDebito = row.valueText;
                  out.valorCredito = '';
                } else {
                  out.valorCredito = row.valueText;
                  out.valorDebito = '';
                }
              }
              for (const col of columnsMapped) {
                if (!String(out[col.id] || '').trim()) out[col.id] = 'RECORTE PDF';
              }
              return out;
            });

            if (leitorRows.length > 0) {
              reportExtract(
                'Etapa 2: leitor-e-recortador — colunas extraídas e conferidas pelo processo novo.',
                { page: pageNum, total: docTotalPages, rows: leitorRows.length },
              );
              publishCropPreviewRows(pageNum, leitorRows);
              return leitorRows;
            }
          }
          if (previewRowsBase.length === 0) {
            previewRowsBase = buildGeometricCropRows(undefined, 'RECORTE DA COLUNA');
            reportExtract(
              'Etapa 2: leitor-e-recortador — fallback geométrico da tabela (sem OCR).',
              { page: pageNum, total: docTotalPages, rows: previewRowsBase.length },
            );
            publishCropPreviewRows(pageNum, previewRowsBase);
          }
          return previewRowsBase;
        }

        const ignoreWordsNorm = extratoRecorteLiteral
          ? []
          : (effectiveIgnoreLineWordsList || [])
              .map((w) => String(w || '').trim().toUpperCase())
              .filter(Boolean);

        let bmp: ImageBitmap | undefined;
        try {
          let blob: Blob;
          try {
            const res = await fetch(preview);
            if (!res.ok) {
              throw new Error(`Falha ao carregar preview (HTTP ${res.status}). Verifique se o backend CORS está configurado.`);
            }
            blob = await res.blob();
          } catch (err) {
            if (err instanceof TypeError && err.message.includes('fetch failed')) {
              throw new Error('Erro de CORS ou conexão ao carregar preview. Verifique se o servidor está acessível.');
            }
            throw err;
          }

          bmp = await createImageBitmap(blob);
          const resolvedBmp = bmp; // referência local não-nula para uso nas closures
          const rowsByColumn = new Map<string, Array<{ y: number; text: string }>>();
          if (previewRowsBase.length === 0) {
            const detectRowsFromBitmapBands = (bitmap: ImageBitmap) => {
              const targetW = Math.max(64, Math.min(280, bitmap.width));
              const scale = targetW / Math.max(1, bitmap.width);
              const targetH = Math.max(1, Math.round(bitmap.height * scale));
              const canvas = document.createElement('canvas');
              canvas.width = targetW;
              canvas.height = targetH;
              const ctx = canvas.getContext('2d', { willReadFrequently: true });
              if (!ctx) return [] as GenericOcrRow[];
              ctx.drawImage(bitmap, 0, 0, targetW, targetH);
              const img = ctx.getImageData(0, 0, targetW, targetH).data;
              const fy0 = Math.max(0, Math.min(targetH - 1, Math.round(y0 * scale)));
              const fy1 = Math.max(fy0 + 1, Math.min(targetH, Math.round(y1 * scale)));
              const inkByY: number[] = [];
              for (let y = fy0; y < fy1; y += 1) {
                let dark = 0;
                for (let x = 0; x < targetW; x += 1) {
                  const i = (y * targetW + x) * 4;
                  const luma = img[i]! * 0.299 + img[i + 1]! * 0.587 + img[i + 2]! * 0.114;
                  if (luma < 215) dark += 1;
                }
                inkByY.push(dark / targetW);
              }
              const rowsY: number[] = [];
              const minInk = 0.012;
              let bandStart = -1;
              for (let i = 0; i < inkByY.length; i += 1) {
                const hasInk = inkByY[i]! >= minInk;
                if (hasInk && bandStart < 0) {
                  bandStart = i;
                  continue;
                }
                if (!hasInk && bandStart >= 0) {
                  const bandEnd = i - 1;
                  if (bandEnd - bandStart >= 1) {
                    rowsY.push(fy0 + Math.round((bandStart + bandEnd) / 2));
                  }
                  bandStart = -1;
                }
              }
              if (bandStart >= 0) {
                rowsY.push(fy0 + Math.round((bandStart + (inkByY.length - 1)) / 2));
              }
              if (rowsY.length === 0) return [] as GenericOcrRow[];
              return rowsY.slice(0, 180).map((sy, idx) => {
                const out: GenericOcrRow = {
                  descricao: 'RECORTE PDF',
                  _linhaOcr: 'RECORTE PDF',
                  _extratoSegY: String(Math.round(sy / scale)),
                  _extratoOrdem: String(idx + 1),
                };
                for (const col of columnsMapped) out[col.id] = 'RECORTE PDF';
                return out;
              });
            };
            previewRowsBase = detectRowsFromBitmapBands(resolvedBmp);
            if (previewRowsBase.length > 0) {
              reportExtract('Tabela de recortes pronta — OCR vai preencher cada coluna agora…', {
                page: pageNum,
                total: docTotalPages,
                rows: previewRowsBase.length,
              });
              publishCropPreviewRows(pageNum, previewRowsBase);
            }
          }
          if (previewRowsBase.length === 0) {
            previewRowsBase = buildGeometricCropRows(undefined, 'RECORTE DA COLUNA');
            reportExtract('Tabela de recortes criada por geometria da faixa. OCR vai preencher agora…', {
              page: pageNum,
              total: docTotalPages,
              rows: previewRowsBase.length,
            });
            publishCropPreviewRows(pageNum, previewRowsBase);
          }
          const liveRows = previewRowsBase.map((r) => ({ ...r }));

          const clusterWordsToLines = (words: OcrPositionedWord[]) => {
            if (words.length === 0) return [] as Array<{ y: number; text: string }>;
            const sorted = [...words].sort((a, b) => a.y - b.y || a.x - b.x);
            const heights = sorted.map((w) => Math.max(1, w.h)).sort((a, b) => a - b);
            const medianH = heights[Math.floor(heights.length / 2)] || 10;
            const yTol = Math.max(7, medianH * 0.7);
            const out: Array<{ y: number; text: string }> = [];
            let bucket: OcrPositionedWord[] = [];
            let bucketY = sorted[0]!.y;
            for (const word of sorted) {
              if (bucket.length === 0) {
                bucket = [word];
                bucketY = word.y;
                continue;
              }
              if (Math.abs(word.y - bucketY) <= yTol) {
                bucket.push(word);
                bucketY = (bucketY * (bucket.length - 1) + word.y) / bucket.length;
                continue;
              }
              const text = bucket
                .slice()
                .sort((a, b) => a.x - b.x)
                .map((w) => String(w.str || '').trim())
                .filter(Boolean)
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();
              if (text.length >= 2) out.push({ y: bucketY, text });
              bucket = [word];
              bucketY = word.y;
            }
            if (bucket.length > 0) {
              const text = bucket
                .slice()
                .sort((a, b) => a.x - b.x)
                .map((w) => String(w.str || '').trim())
                .filter(Boolean)
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();
              if (text.length >= 2) out.push({ y: bucketY, text });
            }
            return out;
          };

          for (const col of columnsMapped) {
            const x0 = Math.max(0, Math.min(col.start, col.end));
            const x1 = Math.min(pageData.imgWidth, Math.max(col.start, col.end));
            const cropWidth = Math.max(1, Math.round(x1 - x0));
            if (cropWidth < 2) continue;

            reportExtract(`Recortando coluna ${col.id} no PDF…`);
            const canvas = document.createElement('canvas');
            canvas.width = cropWidth;
            canvas.height = cropHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) continue;
            ctx.drawImage(
              bmp,
              Math.round(x0),
              Math.round(y0),
              cropWidth,
              cropHeight,
              0,
              0,
              cropWidth,
              cropHeight,
            );
            const cropBlob = await new Promise<Blob>((resolve, reject) => {
              canvas.toBlob(
                (b) => (b ? resolve(b) : reject(new Error('Falha ao gerar recorte da coluna.'))),
                'image/png',
              );
            });
            const cropFile = new File([cropBlob], `crop-${col.id}.png`, { type: 'image/png' });
            const ocrResult = await runOcrPortugueseWordsResult(
              cropFile,
              (fraction, message) => {
                const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
                reportExtract(`OCR coluna ${col.id} (${pct}%) — ${message}`);
              },
              { preprocess: false, preprocessMode: 'scan' },
            );
            const lines = clusterWordsToLines(ocrResult.words)
              .map((line) => ({
                y: y0 + line.y,
                text: line.text,
              }))
              .filter((line) => {
                const norm = line.text.toUpperCase();
                return !ignoreWordsNorm.some((w) => norm.includes(w));
              });
            rowsByColumn.set(col.id, lines);
            if (liveRows.length > 0 && lines.length > 0) {
              const rowTol = 11;
              for (const line of lines) {
                const hit = liveRows.find(
                  (r) => Math.abs(Number(r._extratoSegY ?? r._extratoY ?? 0) - line.y) <= rowTol,
                );
                if (hit) {
                  hit[col.id] = line.text;
                  if (String(hit.descricao || '').startsWith('RECORTE')) {
                    hit.descricao = line.text;
                  }
                  const vals = columnsMapped
                    .map((c) => String(hit[c.id] || '').trim())
                    .filter(Boolean);
                  if (vals.length > 0) hit._linhaOcr = vals.join(' | ');
                }
              }
              publishCropPreviewRows(pageNum, liveRows);
            }
          }

          const merged: Array<{ y: number; cols: Record<string, string> }> = [];
          const rowTol = 11;
          for (const col of columnsMapped) {
            const lines = rowsByColumn.get(col.id) ?? [];
            for (const line of lines) {
              const hit = merged.find((r) => Math.abs(r.y - line.y) <= rowTol);
              if (hit) {
                hit.cols[col.id] = hit.cols[col.id]
                  ? `${hit.cols[col.id]} ${line.text}`.replace(/\s+/g, ' ').trim()
                  : line.text;
              } else {
                merged.push({ y: line.y, cols: { [col.id]: line.text } });
              }
            }
          }
          const normText = (value: string) =>
            String(value || '')
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/[^\w\s./,:+-]/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .toUpperCase();
          const similarity = (a: string, b: string) => {
            const aa = normText(a);
            const bb = normText(b);
            if (!aa && !bb) return 1;
            if (!aa || !bb) return 0;
            if (aa === bb) return 1;
            if (aa.includes(bb) || bb.includes(aa)) return 0.85;
            const ta = new Set(aa.split(' ').filter(Boolean));
            const tb = new Set(bb.split(' ').filter(Boolean));
            if (ta.size === 0 || tb.size === 0) return 0;
            let inter = 0;
            for (const t of ta) {
              if (tb.has(t)) inter += 1;
            }
            const union = new Set([...ta, ...tb]).size || 1;
            return inter / union;
          };
          merged.sort((a, b) => a.y - b.y);
          const rowBands = merged.map((row, idx) => {
            const prevY = idx > 0 ? merged[idx - 1]!.y : y0;
            const nextY = idx < merged.length - 1 ? merged[idx + 1]!.y : y1;
            const bandStart = Math.max(y0, Math.round((prevY + row.y) / 2));
            const bandEnd = Math.min(y1, Math.round((row.y + nextY) / 2));
            return { row, idx, bandStart, bandEnd: Math.max(bandStart + 1, bandEnd) };
          });
          for (const col of columnsMapped) {
            reportExtract(`Motor conferência coluna ${col.id} — validando com PDF…`);
            const x0 = Math.max(0, Math.min(col.start, col.end));
            const x1 = Math.min(pageData.imgWidth, Math.max(col.start, col.end));
            for (const band of rowBands) {
              const pdfWords = pageData.items
                .filter((it) => {
                  const cx = it.x + it.w / 2;
                  const cy = it.y + it.h / 2;
                  return (
                    cx >= x0 &&
                    cx <= x1 &&
                    cy >= band.bandStart &&
                    cy <= band.bandEnd &&
                    cy >= y0 &&
                    cy <= y1
                  );
                })
                .sort((a, b) => a.y - b.y || a.x - b.x)
                .map((it) => String(it.str || '').trim())
                .filter(Boolean);
              const pdfText = pdfWords.join(' ').replace(/\s+/g, ' ').trim();
              if (!pdfText) continue;
              const ocrText = String(band.row.cols[col.id] || '').trim();
              const conf = similarity(ocrText, pdfText);
              if (!ocrText || conf < 0.42) {
                band.row.cols[col.id] = pdfText;
              }
            }
          }
          return merged.map((row, idx) => {
            const vals = Object.values(row.cols).filter(Boolean);
            return {
              ...row.cols,
              _linhaOcr: vals.join(' | '),
              _extratoSegY: String(Math.round(row.y)),
              _extratoOrdem: String(idx + 1),
            } as GenericOcrRow;
          });
        } finally {
          bmp?.close();
        }
      };

      const extractRowsFromPageData = async (
        pageData: PdfPagePreviewResult,
        snap: PageMappingSnapshot,
        allowFaixaFallback: boolean,
        pageNum: number,
      ) => {
        if (pageData.itemCount === 0 && !extratoRecorteLiteral) return [] as GenericOcrRow[];
        const vertical = resolveFaixaVerticalFromSnapshot(snap, pageData.imgHeight);
        if (!vertical) return [] as GenericOcrRow[];
        const snapStrict = isStrictFaixaSnapshot(snap);
        let faixaSnap = { startY: vertical.startY, endY: vertical.endY };
        if (!snapStrict && !extratoRecorteLiteral) {
          const faixaY0 = Math.min(faixaSnap.startY, faixaSnap.endY);
          const faixaY1 = Math.max(faixaSnap.startY, faixaSnap.endY);
          const faixaExpanded = expandExtratoFaixaPorValoresCorpo(
            pageData.items,
            faixaY0,
            faixaY1,
            pageData.imgWidth,
          );
          faixaSnap = {
            startY: faixaExpanded.faixaStart,
            endY: faixaExpanded.faixaEnd,
          };
        }
        const colsExtrato = extratoRecorteLiteral
          ? snap.columns
          : columnsParaExtratoItau(
              snap.columns,
              pageData.items,
              pageData.imgWidth,
              supportsValorModo,
            );
        const mapping = mappingGenericoEmCoordsOcr(
          colsExtrato,
          faixaSnap,
          snap.imgWidth,
          snap.imgHeight,
          pageData.imgWidth,
          pageData.imgHeight,
        );
        if (extratoRecorteLiteral) {
          const recorteRows = await extractRowsFromColumnCropOcr(pageData, mapping, pageNum);
          if (recorteRows.length > 0) return recorteRows;
        }
        const stmtYear =
          extractStatementYear(pageData.items.map((it) => it.str).join(' ')) ||
          String(new Date().getFullYear());
        const itauExtractOpts = itauProfileActive
          ? getItauExtratoExtractGenericOptions(
            stmtYear,
            ignoreLineWordsList,
            pageData.ocrFullText,
          )
          : null;
        let rows = extractGenericRowsFromMapping(
          pageData.items,
          mapping,
          pageData.imgHeight,
          pageData.imgWidth,
          {
            dataColIds: itauExtractOpts?.dataColIds ?? dataColIds,
            headerKeywords: itauExtractOpts?.headerKeywords ?? headerKeywords,
            allowFaixaFallback:
              itauExtractOpts?.allowFaixaFallback ?? (allowFaixaFallback && !snapStrict),
            strictFaixaVertical: resolveExtratoStrictFaixaVertical(snapStrict, itauProfileActive),
            extratoPositional: supportsValorModo,
            extratoPreserveSegmentRows: supportsValorModo,
            planoPositional: isPlanoOcr,
            statementYear: stmtYear,
            ocrFullText:
              pageData.ocrFullText ||
              pageData.items.map((it) => it.str).join('\n'),
            ignoreLineWords: isPlanoOcr ? [] : effectiveIgnoreLineWordsList,
          },
        );
        if (supportsValorModo && rows.length > 0 && !extratoRecorteLiteral) {
          rows = enrichExtratoPageRows(pageData.items, rows, mapping, pageData.imgWidth);
          rows = recoverExtratoPageRowsComAuditoria(
            pageData.items,
            rows,
            mapping,
            pageData.imgHeight,
            pageData.imgWidth,
            effectiveIgnoreLineWordsList,
          );
        }
        return rows;
      };

      /** PDF extrato: colunas marcadas → páginas entre início (verde) e fim (vermelho). */
      if (supportsValorModo && fileIsPdf) {
        if (hasMappedColumnsForExtract && doc.pdfDoc && doc.totalPages > 1) {
          const allRows: GenericOcrRow[] = [];
          const skippedPages: number[] = [];
          const ocrTextParts: string[] = [];

          for (let p = extractStartPage; p <= extractEndPage; p++) {
            reportExtract(`OCR página ${p} de ${docTotalPages}…`, {
              page: p,
              total: docTotalPages,
              rows: allRows.length,
            });
            try {
              const pageData = extratoRecorteLiteral
                ? ((await renderPdfPagePreview(doc.pdfDoc, p, reportExtract, {
                    ...ocrPdfLoadOptions,
                    deferOcr: true,
                    useCache: true,
                  })) as PdfPagePreviewResult)
                : await getPageOcrDataForExtract(p);
              const pageOcrText =
                pageData.ocrFullText?.trim() ||
                pageData.items.map((it) => it.str).join('\n').trim();
              if (pageData.itemCount === 0 && !extratoRecorteLiteral) {
                skippedPages.push(p);
                reportExtract(`Página ${p}: sem texto OCR — ignorada`, {
                  page: p,
                  total: docTotalPages,
                  rows: allRows.length,
                });
                continue;
              }
              const snap = resolveSnapshotForPage(p, pageData.imgWidth, pageData.imgHeight);
              if (!snapshotHasColunas(snap)) {
                throw new Error(
                  'Marque as colunas na página 1 antes de confirmar — elas serão usadas em todas as páginas.',
                );
              }
              const pageRows = tagOcrRowsPagina(
                await extractRowsFromPageData(pageData, snap, p === extractStartPage, p),
                p,
              );
              if (pageOcrText) ocrTextParts.push(pageOcrText);
              appendExtratoRowsLive(allRows, pageRows, p, skippedPages);
            } catch (e) {
              if (p === currentPage) throw e;
              skippedPages.push(p);
            }
          }
          if (allRows.length === 0) {
            const effectiveSkipped = filterSkippedPagesForExtratoReview(skippedPages, allRows);
            if (extratoRecorteLiteral) {
              const ocrAgg = ocrTextParts.join('\n\n') || doc.ocrFullText || '';
              const rowsFromCrop = literalCropRowsRef.current;
              await finishExtratoRows(
                rowsFromCrop.length > 0 ? rowsFromCrop : [],
                undefined,
                effectiveSkipped.length > 0 ? effectiveSkipped : undefined,
                ocrAgg,
              );
              return;
            }
            throw new Error(
              effectiveSkipped.length > 0
                ? `Nenhuma linha instantânea extraída. Abra cada página para capturar e tente de novo. Páginas sem captura: ${effectiveSkipped.join(', ')}.`
                : 'Nenhuma linha instantânea extraída. Revise colunas/faixa delimitadora.',
            );
          }
          reportExtract(`Finalizando ${allRows.length} lançamento(s)…`, {
            page: doc.totalPages,
            total: doc.totalPages,
            rows: allRows.length,
          });
          const ocrAgg = ocrTextParts.join('\n\n') || doc.ocrFullText || '';
          const effectiveSkipped = filterSkippedPagesForExtratoReview(skippedPages, allRows);
          await finishExtratoRows(
            allRows,
            undefined,
            effectiveSkipped.length > 0 ? effectiveSkipped : undefined,
            ocrAgg,
          );
          return;
        }

        if (extratoRecorteLiteral && hasMappedColumnsForExtract && doc.pdfDoc) {
          const pageData = (await renderPdfPagePreview(doc.pdfDoc, currentPage, reportExtract, {
            ...ocrPdfLoadOptions,
            deferOcr: true,
            useCache: true,
          })) as PdfPagePreviewResult;
          const snap = resolveSnapshotForPage(currentPage, pageData.imgWidth, pageData.imgHeight);
          const pageRows = tagOcrRowsPagina(
            await extractRowsFromPageData(pageData, snap, true, currentPage),
            currentPage,
          );
          const rowsFinal = pageRows.length > 0 ? pageRows : literalCropRowsRef.current;
          await finishExtratoRows(
            rowsFinal,
            undefined,
            undefined,
            pageData.ocrFullText || doc.ocrFullText || '',
          );
          return;
        }

        const pageSnap = resolveSnapshotForPage(currentPage, doc.imgWidth, doc.imgHeight);
        const faixaPdf = resolveFaixaVerticalFromSnapshot(pageSnap, doc.imgHeight);
        const snapStrict = isStrictFaixaSnapshot(pageSnap);
        const clickW = coordW || doc.imgWidth;
        const clickH = coordH || doc.imgHeight;

        let extractItems = doc.items;
        let extractOcrFullText = doc.ocrFullText;
        if (
          !extratoRecorteLiteral &&
          !EXTRATO_INSTANT_CAPTURE_MODE &&
          doc.pdfDoc &&
          (previewUrl ?? doc.previewUrl)
        ) {
          reportExtract('OCR da página para encaixar na tabela…', {
            page: currentPage,
            total: extractTotalPages,
          });
          const full = await completePdfPageOcr(
            doc.pdfDoc,
            currentPage,
            previewUrl ?? doc.previewUrl!,
            pdfRenderScale,
            reportExtract,
            ocrExtractOptions,
          );
          extractItems = full.items;
          extractOcrFullText = full.ocrFullText;
          if (extractItems.length === 0) {
            throw new Error(
              'OCR não retornou texto nesta página. Aumente a escala do PDF e tente processar de novo.',
            );
          }
        }

        const mappingPdf = mappingGenericoEmCoordsOcr(
          extratoRecorteLiteral
            ? pageSnap.columns
            : columnsParaExtratoItau(pageSnap.columns, extractItems, doc.imgWidth, supportsValorModo),
          faixaPdf,
          clickW,
          clickH,
          doc.imgWidth,
          doc.imgHeight,
        );
        const stmtYearPdf =
          extractStatementYear(extractItems.map((it) => it.str).join(' ')) ||
          String(new Date().getFullYear());

        let rows: GenericOcrRow[] = [];
        if (hasMappedColumnsForExtract && extractItems.length > 0) {
          reportExtract('Extraindo pelas colunas marcadas (histórico, valores…)…', { page: currentPage, total: extractTotalPages });
          rows = extractGenericRowsFromMapping(
            extractItems,
            mappingPdf,
            doc.imgHeight,
            doc.imgWidth,
            {
              dataColIds,
              headerKeywords,
              allowFaixaFallback: !snapStrict,
              strictFaixaVertical: resolveExtratoStrictFaixaVertical(snapStrict, itauProfileActive),
              extratoPositional: true,
              extratoPreserveSegmentRows: true,
              statementYear: stmtYearPdf,
              ocrFullText:
                extractOcrFullText ||
                extractItems.map((it) => it.str).join('\n'),
              ignoreLineWords: effectiveIgnoreLineWordsList,
            },
          );
          if (rows.length > 0 && !extratoRecorteLiteral) {
            rows = enrichExtratoPageRows(extractItems, rows, mappingPdf, doc.imgWidth);
            rows = recoverExtratoPageRowsComAuditoria(
              extractItems,
              rows,
              mappingPdf,
              doc.imgHeight,
              doc.imgWidth,
              effectiveIgnoreLineWordsList,
            );
            const tagged = tagOcrRowsPagina(rows, currentPage);
            const liveRows: GenericOcrRow[] = [];
            appendExtratoRowsLive(liveRows, tagged, currentPage, []);
            rows = liveRows;
          }
        }
        if (rows.length === 0) {
          throw new Error(
            'Nenhum lançamento instantâneo encontrado. Ajuste colunas/faixa e linhas para ignorar.',
          );
        }
        await finishExtratoRows(
          rows,
          undefined,
          undefined,
          extractOcrFullText ?? doc.ocrFullText,
        );
        return;
      }

      if (isParcelamentoExtract) {
        if (ocrLoading || doc.items.length === 0) {
          setError('Aguarde o OCR terminar ou clique em “Ler OCR novamente”.');
          return;
        }
        const refW = doc.imgWidth;
        const refH = doc.imgHeight;
        const imgEl = imageRef.current;
        const fromW =
          imgEl && imgEl.naturalWidth > 0 ? imgEl.naturalWidth : imgSize.width || refW;
        const fromH =
          imgEl && imgEl.naturalHeight > 0 ? imgEl.naturalHeight : imgSize.height || refH;
        const faixa =
          !faixaInicioMarcado || !faixaFimMarcado
            ? undefined
            : { startY: Math.min(faixaStart, faixaEnd), endY: Math.max(faixaStart, faixaEnd) };
        const mapping = mappingParcelamentoEmCoordsOcr(
          columns as ParcelamentoColunaDef[],
          faixa,
          fromW,
          fromH,
          refW,
          refH,
        );
        const data = extractParcelamentoFromMapping(doc.items, mapping, refH, refW, {
          allowFaixaFallback: !strictFaixaVertical,
          strictFaixaVertical,
        });
        onConfirmParcelamento?.(data);
        return;
      }

      if (doc.pdfDoc && doc.totalPages > 1) {
        const allRows: GenericOcrRow[] = [];
        const skippedPages: number[] = [];
        const ocrTextParts: string[] = [];

        for (let p = extractStartPage; p <= extractEndPage; p++) {
          reportExtract(`OCR página ${p} de ${docTotalPages}…`, {
            page: p,
            total: docTotalPages,
            rows: allRows.length,
          });
          try {
            const pageData = await getPageOcrDataForExtract(p);
            const pageOcrText =
              pageData.ocrFullText?.trim() ||
              pageData.items.map((it) => it.str).join('\n').trim();
            if (pageData.itemCount === 0) {
              skippedPages.push(p);
              reportExtract(`Página ${p}: sem texto OCR — ignorada`, {
                page: p,
                total: docTotalPages,
                rows: allRows.length,
              });
              continue;
            }
            const snap = resolveSnapshotForPage(p, pageData.imgWidth, pageData.imgHeight);
            if (!snapshotHasColunas(snap)) {
              throw new Error(
                `Marque as colunas na página 1 (ou na página ${p}) antes de confirmar o encaixe na tabela.`,
              );
            }
            const pageRows = tagOcrRowsPagina(
              await extractRowsFromPageData(pageData, snap, p === extractStartPage, p),
              p,
            );
            if (pageOcrText) ocrTextParts.push(pageOcrText);
            if (supportsValorModo && onConfirm) {
              appendExtratoRowsLive(allRows, pageRows, p, skippedPages);
            } else {
              allRows.push(...pageRows);
              reportExtract(
                `Página ${p}/${docTotalPages}: ${allRows.length} linha(s) extraída(s)`,
                { page: p, total: docTotalPages, rows: allRows.length },
              );
            }
          } catch (e) {
            if (p === currentPage) throw e;
            skippedPages.push(p);
          }
        }
        if (allRows.length === 0) {
          if (!extratoRecorteLiteral && (await tryAiVisionIfNoColumnRows(0))) return;
          const effectiveSkipped = filterSkippedPagesForExtratoReview(skippedPages, allRows);
          if (extratoRecorteLiteral) {
            const ocrAgg = ocrTextParts.join('\n\n') || doc.ocrFullText || '';
            await finalizeColumnExtractRows(
              [],
              ocrAgg,
              null,
              effectiveSkipped.length > 0 ? effectiveSkipped : undefined,
            );
            return;
          }
          throw new Error(
            effectiveSkipped.length > 0
              ? `Nenhuma linha extraída. Páginas sem OCR: ${effectiveSkipped.join(', ')}. Use modo Automático (não 4K).`
              : 'Nenhuma linha extraída em nenhuma página. Revise o mapeamento das colunas e a delimitação início/fim.',
          );
        }
        reportExtract(`Finalizando ${allRows.length} lançamento(s)…`, {
          page: doc.totalPages,
          total: doc.totalPages,
          rows: allRows.length,
        });
        const ocrAgg = ocrTextParts.join('\n\n') || doc.ocrFullText || '';
        const effectiveSkipped = filterSkippedPagesForExtratoReview(skippedPages, allRows);
        await finalizeColumnExtractRows(
          allRows,
          ocrAgg,
          null,
          effectiveSkipped.length > 0 ? effectiveSkipped : undefined,
        );
        return;
      }

      let extractItems = doc.items;
      let extractOcrFullText = doc.ocrFullText;
      const forcePhotoOcr = isExtratoOcr;
      if ((forcePhotoOcr || extractItems.length === 0) && (previewUrl ?? doc.previewUrl)) {
        reportExtract('Lendo PDF e colando informações na tabela…', {
          page: currentPage,
          total: extractTotalPages,
        });
        if (doc.pdfDoc) {
          const full = await completePdfPageOcr(
            doc.pdfDoc,
            currentPage,
            previewUrl ?? doc.previewUrl!,
            pdfRenderScale,
            reportExtract,
            ocrBulkPreviewOptions,
          );
          extractItems = full.items;
          extractOcrFullText = full.ocrFullText;
        } else {
          const full = await refreshOcrItemsFromPreviewUrl(
            previewUrl ?? doc.previewUrl!,
            reportExtract,
            ocrBulkPreviewOptions,
          );
          extractItems = full.items;
          extractOcrFullText = full.ocrFullText;
        }
        setDoc((prev) =>
          prev
            ? {
              ...prev,
              items: extractItems,
              itemCount: extractItems.length,
              ocrFullText: extractOcrFullText,
            }
            : prev,
        );
      }
      if (extractItems.length === 0) {
        setError('OCR não detectou texto. Aumente a escala e tente processar de novo.');
        return;
      }
      const refW = doc.imgWidth;
      const refH = doc.imgHeight;
      const imgEl = imageRef.current;
      const fromW =
        imgEl && imgEl.naturalWidth > 0 ? imgEl.naturalWidth : imgSize.width || refW;
      const fromH =
        imgEl && imgEl.naturalHeight > 0 ? imgEl.naturalHeight : imgSize.height || refH;
      const faixa =
        !faixaInicioMarcado || !faixaFimMarcado
          ? undefined
          : { startY: Math.min(faixaStart, faixaEnd), endY: Math.max(faixaStart, faixaEnd) };
      const snapForGeneric = resolveSnapshotForPage(currentPage, refW, refH);
      const mapping = mappingGenericoEmCoordsOcr(
        extratoRecorteLiteral
          ? snapForGeneric.columns
          : columnsParaExtratoItau(snapForGeneric.columns, extractItems, doc.imgWidth, supportsValorModo),
        faixa,
        fromW,
        fromH,
        refW,
        refH,
      );
      const stmtYear =
        extractStatementYear(extractItems.map((it) => it.str).join(' ')) ||
        String(new Date().getFullYear());
      let rows = extractGenericRowsFromMapping(extractItems, mapping, refH, refW, {
        dataColIds,
        headerKeywords,
        allowFaixaFallback: !strictFaixaVertical,
        strictFaixaVertical,
        extratoPositional: supportsValorModo,
        extratoPreserveSegmentRows: supportsValorModo,
        planoPositional: isPlanoOcr,
        statementYear: stmtYear,
        ocrFullText: extractOcrFullText || extractItems.map((it) => it.str).join('\n'),
        ignoreLineWords: isPlanoOcr ? [] : effectiveIgnoreLineWordsList,
      });
      if (supportsValorModo && rows.length > 0 && !extratoRecorteLiteral) {
        rows = enrichExtratoPageRows(extractItems, rows, mapping, doc.imgWidth);
      }
      if (rows.length === 0 && !extratoRecorteLiteral && (await tryAiVisionIfNoColumnRows(0))) return;
      reportExtract(`${rows.length} linha(s) encaixada(s) na tabela`, {
        page: fileIsPdf ? currentPage : 1,
        total: extractTotalPages,
        rows: rows.length,
      });
      await finalizeColumnExtractRows(rows, extractOcrFullText ?? doc.ocrFullText, fileIsPdf ? currentPage : 1);
    } catch (e) {
      setError(formatExtractCatchError(e));
    } finally {
      extractReporterRef.current = null;
      prefetchAbortRef.current = false;
      setExtracting(false);
      setExtractProgress(null);
    }
  };

  /** Faixa vertical: só depois que o usuário marcar início/fim na imagem. */
  const showFaixaOverlayOnPreview =
    faixaInicioMarcado ||
    faixaFimMarcado ||
    activeId === FAIXA_INICIO_ID ||
    activeId === FAIXA_FIM_ID;

  const temAlgumaColunaMapeada = columns.some(
    (c) => !c.id.startsWith('ignorar') && c.start !== c.end,
  );

  const temColunaValorMapeada = columns.some(
    (c) => ['valorDebito', 'valorCredito', 'valorMisto'].includes(c.id) && c.start !== c.end,
  );

  const faixaMarcadoresGlobal = useMemo(() => {
    void mappingRevision;
    return collectFaixaMarcadoresGlobais(pageStatesRef.current, {
      faixaInicioMarcado,
      faixaFimMarcado,
      semDelimitacaoVertical,
    });
  }, [mappingRevision, faixaInicioMarcado, faixaFimMarcado, semDelimitacaoVertical]);

  const faixaDelimitacaoOk =
    faixaMarcadoresGlobal.inicioMarcado && faixaMarcadoresGlobal.fimMarcado;

  const extratoExtractSnap = useMemo(() => {
    void mappingRevision;
    if (!supportsValorModo || ocrRefW <= 0 || ocrRefH <= 0) return null;
    const totalPages = doc?.totalPages ?? 1;
    return buildPageMappingSnapshotForExtract(
      pageStatesRef.current,
      currentPage,
      totalPages,
      ocrRefW,
      ocrRefH,
      true,
    );
  }, [
    supportsValorModo,
    currentPage,
    doc?.totalPages,
    ocrRefW,
    ocrRefH,
    mappingRevision,
    columns,
    faixaStart,
    faixaEnd,
    faixaInicioMarcado,
    faixaFimMarcado,
    semDelimitacaoVertical,
  ]);

  const extratoStrictFaixa =
    extratoExtractSnap != null &&
    resolveExtratoStrictFaixaVertical(
      isStrictFaixaSnapshot(extratoExtractSnap),
      itauProfileActive,
    );

  /** Colunas/faixa na mesma grade dos tokens OCR (cliques podem divergir de doc.imgWidth). */
  const extratoMappingOcr = useMemo(() => {
    if (!supportsValorModo || coordW <= 0 || coordH <= 0 || ocrRefW <= 0 || ocrRefH <= 0) {
      return null;
    }
    const snap = extratoExtractSnap;
    const baseColumns = snap?.columns ?? columns;
    const colsExtrato =
      doc?.items?.length && ocrRefW > 0
        ? columnsParaExtratoItau(baseColumns, doc.items, ocrRefW, supportsValorModo)
        : baseColumns;
    const faixaClick =
      snap != null ? resolveFaixaVerticalFromSnapshot(snap, ocrRefH) : undefined;
    return mappingGenericoEmCoordsOcr(colsExtrato, faixaClick, coordW, coordH, ocrRefW, ocrRefH);
  }, [
    supportsValorModo,
    columns,
    doc?.items,
    extratoExtractSnap,
    coordW,
    coordH,
    ocrRefW,
    ocrRefH,
  ]);

  const extratoFaixaVertical = extratoMappingOcr?.faixa;

  const extratoValorColBounds = useMemo(
    () =>
      resolveExtratoValorColBoundsFromColumns(
        extratoMappingOcr?.columns ?? columns,
        ocrRefW,
      ),
    [extratoMappingOcr?.columns, columns, ocrRefW],
  );

  const extratoItemsScoped = useMemo(() => {
    if (!supportsValorModo || !doc?.items?.length || ocrRefH <= 0) return [];
    return scopeExtratoOcrItemsPreExtract(
      doc.items,
      extratoFaixaVertical,
      ocrRefH,
      extratoStrictFaixa,
    );
  }, [
    supportsValorModo,
    doc?.items,
    ocrRefH,
    extratoFaixaVertical,
    extratoStrictFaixa,
  ]);

  const extratoYTolFactor = extratoStrictFaixa ? 0.36 : 0.4;

  /** Segmentos na faixa — mesma lógica da importação (fonte única para contagem). */
  const extratoSegmentosNaFaixa = useMemo(() => {
    if (!supportsValorModo || extratoItemsScoped.length === 0 || ocrRefW <= 0) {
      return [] as import('../../lib/ocrExtratoPositional').ExtratoLancamentoSegmento[];
    }
    return segmentarExtratoEmLancamentos(extratoItemsScoped, ocrRefW, {
      yTolFactor: extratoYTolFactor,
      ignoreWords: deferredIgnoreLineWordsList,
      valorColX: extratoValorColBounds,
      modoAncladoValores: true,
    });
  }, [
    supportsValorModo,
    extratoItemsScoped,
    ocrRefW,
    extratoYTolFactor,
    extratoValorColBounds,
    deferredIgnoreLineWordsList,
  ]);

  /** Contagem e auditoria de lançamentos (segmentador único — mesma lógica da extração). */
  const extratoSegmentacaoPreview = useMemo(() => {
    if (!supportsValorModo || !doc?.items?.length || coordW <= 0 || coordH <= 0) {
      return {
        count: 0,
        auditOk: true,
        valoresDetectados: 0,
        auditMensagem: '',
        colunaValorMapeada: false,
      };
    }
    const segmentos = extratoSegmentosNaFaixa;
    const segmentosImportaveis = segmentos.filter((s) => s.valorToken != null);
    const audit = auditarCoberturaValoresExtrato(
      extratoItemsScoped,
      segmentos,
      ocrRefW,
      extratoValorColBounds,
      effectiveIgnoreLineWordsList,
    );
    return {
      count: segmentosImportaveis.length,
      auditOk: audit.ok,
      valoresDetectados: audit.valoresDetectados,
      auditMensagem: formatExtratoAuditMensagem(audit),
      colunaValorMapeada: audit.colunaValorMapeada,
      segmentosSemValor: audit.segmentosSemValor,
      valoresOrfaos: audit.valoresOrfaos.length,
    };
  }, [
    supportsValorModo,
    coordW,
    coordH,
    extratoItemsScoped,
    extratoValorColBounds,
    effectiveIgnoreLineWordsList,
    extratoSegmentosNaFaixa,
    ocrRefW,
  ]);

  const extratoMapeamentoValidacao = useMemo(() => {
    if (!supportsValorModo || !doc?.items?.length || coordW <= 0 || coordH <= 0) {
      return { ok: true, checks: [] as import('../../lib/ocrExtratoPositional').ExtratoMapeamentoCheck[] };
    }
    return validarMapeamentoExtratoOcr({
      columns: extratoMappingOcr?.columns ?? columns,
      imgWidth: ocrRefW,
      imgHeight: ocrRefH,
      items: doc.items,
      faixa: extratoFaixaVertical,
      semDelimitacaoVertical: faixaMarcadoresGlobal.semDelimitacaoVertical,
      faixaInicioMarcado: faixaMarcadoresGlobal.inicioMarcado,
      faixaFimMarcado: faixaMarcadoresGlobal.fimMarcado,
      ignoreWords: effectiveIgnoreLineWordsList,
      segmentosPrecalculados: extratoSegmentosNaFaixa,
      scopedItemsPrecalculados: extratoItemsScoped,
    });
  }, [
    supportsValorModo,
    doc?.items,
    ocrRefW,
    ocrRefH,
    columns,
    extratoMappingOcr?.columns,
    extratoFaixaVertical,
    faixaDelimitacaoOk,
    faixaMarcadoresGlobal,
    ignoreLineWordsList,
    extratoSegmentosNaFaixa,
    extratoItemsScoped,
  ]);

  const mapFieldBtn = (active: boolean, dashed = false) =>
    cn(
      'w-full flex items-center justify-between gap-2 p-2.5 border text-left transition-colors text-[10px] font-bold uppercase tracking-wide outline-none',
      dashed ? 'border-dashed' : 'border-solid',
      active
        ? 'border-brand-border bg-brand-border text-brand-bg shadow-[2px_2px_0_0_rgba(0,0,0,0.12)]'
        : 'border-brand-border/25 bg-brand-sidebar/20 hover:bg-brand-sidebar/60 hover:border-brand-border/50',
    );

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-brand-bg text-brand-text">
      <header className="flex items-center justify-between px-6 py-4 border-b border-brand-border bg-white shrink-0 shadow-[0_2px_0_0_#141414]">
        <div className="min-w-0">
          <p className="text-[9px] font-black uppercase tracking-[0.25em] opacity-50 italic">OCR · Mapeamento</p>
          <h2 className="text-base font-black uppercase tracking-tight truncate">{title}</h2>
          <p className="text-[10px] font-mono opacity-60 mt-0.5 truncate max-w-xl" title={file.name}>
            {file.name}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {doc && doc.isPdf && doc.totalPages > 1 && (
            <div className="flex items-center gap-1 border border-brand-border px-2 py-1 bg-brand-sidebar/40">
              <button
                type="button"
                title="Primeira página"
                disabled={currentPage <= 1 || loading}
                onClick={() => void changePage(1)}
                className="p-1 hover:bg-brand-sidebar transition-colors outline-none focus-visible:ring-1 focus-visible:ring-brand-border disabled:opacity-30"
              >
                <ChevronsLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                title="Página anterior"
                disabled={currentPage <= 1 || loading}
                onClick={() => void changePage(currentPage - 1)}
                className="p-1 hover:bg-brand-sidebar transition-colors outline-none focus-visible:ring-1 focus-visible:ring-brand-border disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-1.5">
                <label htmlFor="ocr-pagina-atual" className="text-[9px] font-bold uppercase tracking-wide opacity-60 shrink-0">
                  Pág.
                </label>
                <input
                  id="ocr-pagina-atual"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={pageInputDraft}
                  aria-label="Ir para página"
                  title="Digite o número da página e pressione Enter"
                  placeholder="Ir"
                  disabled={loading}
                  onChange={(e) => setPageInputDraft(e.target.value.replace(/\D/g, ''))}
                  onBlur={commitPageInput}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitPageInput();
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  className="w-12 px-1 py-0.5 bg-white text-center text-[11px] font-bold font-mono border border-brand-border/60 rounded-sm focus:outline-none focus:ring-1 focus:ring-brand-border disabled:opacity-40"
                />
                <span className="font-mono text-[10px] font-bold">/ {doc.totalPages}</span>
              </div>
              <button
                type="button"
                title="Próxima página"
                disabled={currentPage >= doc.totalPages || loading}
                onClick={() => void changePage(currentPage + 1)}
                className="p-1 hover:bg-brand-sidebar transition-colors outline-none focus-visible:ring-1 focus-visible:ring-brand-border disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                title="Última página"
                disabled={currentPage >= doc.totalPages || loading}
                onClick={() => void changePage(doc.totalPages)}
                className="p-1 hover:bg-brand-sidebar transition-colors outline-none focus-visible:ring-1 focus-visible:ring-brand-border disabled:opacity-30"
              >
                <ChevronsRight className="w-4 h-4" />
              </button>
            </div>
          )}
          <button type="button" title="Fechar" onClick={onCancel} className="technical-button px-3 py-2">
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {showExtractEngine && (
        <div className="px-6 py-2 border-b border-brand-border bg-emerald-50/80 shrink-0 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-900">
            Encaixe na tabela: {scannerPureAi ? 'IA pura (sem fallback)' : EXTRACT_ENGINE_BANNER_LABELS.ai}
            <span className="ml-2 font-mono text-[9px] opacity-60 normal-case">
              build {scannerPureAi ? EXTRATO_SCANNER_PURE_AI_BUILD_ID : EXTRATO_EXTRACT_BUILD_ID}
            </span>
            {ocrDeferredUntilExtract && !extracting && !ocrLoading
              ? ` — aguardando «${confirmLabel}»`
              : ''}
          </p>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-w-0 bg-brand-sidebar/20">
          <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-brand-border bg-brand-sidebar/50 flex-wrap">
            <span className="text-[9px] font-bold uppercase tracking-widest flex items-center gap-2 opacity-70">
              <MousePointer2 className="w-3 h-3 shrink-0" />
              Colunas: 2 cliques · Início/fim: 1 clique
              {doc && (
                <span className="normal-case tracking-normal font-mono opacity-100">
                  ·{' '}
                  {ocrDeferredUntilExtract && doc.itemCount === 0
                    ? scannerPureAi
                      ? 'IA pura ao colar na tabela'
                      : 'OCR ao colar na tabela'
                    : `${doc.itemCount} trechos OCR`}
                </span>
              )}
              {imgSize.width > 0 && (
                <span className="normal-case tracking-normal font-mono opacity-100">
                  · {imgSize.width}×{imgSize.height}px
                  {previewDisplayW > 0 ? ` (tela ${previewDisplayW}×${previewDisplayH})` : ''}
                </span>
              )}
            </span>
            <div className="flex items-center gap-1.5 flex-wrap justify-end">
              {!ocrDeferredUntilExtract ? (
                <button
                  type="button"
                  disabled={loading || !previewUrl}
                  onClick={() => void rerunOcr()}
                  className="technical-button text-[9px] py-1 px-2 disabled:opacity-40"
                >
                  Ler OCR novamente
                </button>
              ) : null}
              <button
                type="button"
                disabled={loading || !previewUrl || imgSize.width <= 0}
                onClick={fitImageToView}
                className="technical-button text-[9px] py-1 px-2 disabled:opacity-40"
              >
                Caber na tela
              </button>
              <button
                type="button"
                onClick={() => stepZoomPreset('down')}
                className="technical-button p-1.5"
                title="Diminuir zoom"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <select
                value={selectedZoomPreset != null ? String(selectedZoomPreset) : 'custom'}
                onChange={(e) => {
                  const next = e.target.value;
                  if (next === 'custom') return;
                  setZoomLevel(Number(next));
                }}
                className="border border-brand-border bg-white text-[10px] py-1 px-2 font-mono min-w-[5.5rem]"
                title="Zoom da visualização"
              >
                {selectedZoomPreset == null ? (
                  <option value="custom">Atual ({Math.round(zoomLevel * 100)}%)</option>
                ) : null}
                {ZOOM_LEVEL_CHOICES.map((value) => (
                  <option key={value} value={value}>
                    {Math.round(value * 100)}%
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => stepZoomPreset('up')}
                className="technical-button p-1.5"
                title="Aumentar zoom"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={!previewUrl}
                onClick={() => setZoomLevel(1)}
                className="technical-button-primary text-[9px] py-1 px-2 disabled:opacity-40"
              >
                100%
              </button>
            </div>
          </div>

          <div ref={imageScrollRef} className="flex-1 overflow-auto p-4 min-h-0">
            <div
              ref={containerRef}
              className={cn(
                'border border-brand-border bg-white shadow-[4px_4px_0_0_#141414] shrink-0',
                showPreviewImage ? 'cursor-crosshair inline-block' : 'cursor-wait',
              )}
            >
              {previewUrl ? (
                <div
                  ref={previewWrapRef}
                  className={cn(
                    'relative',
                    !showPreviewImage &&
                    'absolute w-px h-px overflow-hidden opacity-0 pointer-events-none -z-10',
                  )}
                  onClick={showPreviewImage ? handleImageClick : undefined}
                  onMouseMove={trackMouseOnPreview ? handleMouseMove : undefined}
                  onMouseLeave={trackMouseOnPreview ? () => setMousePos(null) : undefined}
                >
                  <img
                    ref={imageRef}
                    src={previewUrl}
                    alt="Cronograma"
                    onLoad={handleImageLoad}
                    draggable={false}
                    className="block select-none max-w-none pointer-events-none"
                  />
                  {showPreviewImage &&
                    temAlgumaColunaMapeada &&
                    columns.map((col) => {
                      if (col.start === col.end) return null;
                      const def = campoDefs.find((f) => f.id === col.id);
                      return (
                        <OcrPositionedOverlay
                          key={col.id}
                          className={`absolute top-0 bottom-0 z-10 ${col.color} opacity-30 border-l-2 border-r-2 ${def?.borderColor ?? ''}`}
                          layout={{
                            left: `${(Math.min(col.start, col.end) / overlayW) * 100}%`,
                            width: `${(Math.abs(col.end - col.start) / overlayW) * 100}%`,
                          }}
                        />
                      );
                    })}
                  {showPreviewImage &&
                    activeId !== FAIXA_INICIO_ID &&
                    activeId !== FAIXA_FIM_ID &&
                    clickStep === 'end' &&
                    (() => {
                      const col = columns.find((c) => c.id === activeId && c.start === c.end);
                      if (!col || !mousePos) return null;
                      const def = campoDefs.find((f) => f.id === col.id);
                      const actualStart = Math.min(col.start, mousePos.x);
                      const actualEnd = Math.max(col.start, mousePos.x);
                      return (
                        <OcrPositionedOverlay
                          key={`drawing-${col.id}`}
                          className={`absolute top-0 bottom-0 z-10 ${col.color} opacity-30 border-l-2 border-r-2 ${def?.borderColor ?? ''}`}
                          layout={{
                            left: `${(actualStart / overlayW) * 100}%`,
                            width: `${((actualEnd - actualStart) / overlayW) * 100}%`,
                          }}
                        />
                      );
                    })()}
                  {showPreviewImage &&
                    showFaixaOverlayOnPreview &&
                    faixaInicioMarcado &&
                    faixaFimMarcado &&
                    coordH > 0 && (
                      <OcrPositionedOverlay
                        className="absolute left-0 right-0 bg-orange-500/15 border-t-2 border-b-2 border-orange-500 pointer-events-none z-20"
                        layout={{
                          top: `${(Math.min(faixaStart, faixaEnd) / overlayH) * 100}%`,
                          height: `${(Math.abs(faixaEnd - faixaStart) / overlayH) * 100}%`,
                        }}
                      />
                    )}
                  {showPreviewImage &&
                    showFaixaOverlayOnPreview &&
                    faixaInicioMarcado &&
                    !faixaFimMarcado &&
                    coordH > 0 && (
                      <OcrPositionedOverlay
                        className="absolute left-0 right-0 h-1 bg-emerald-500 pointer-events-none shadow-[0_0_8px_rgba(16,185,129,0.9)] z-20"
                        layout={{ top: `${(faixaStart / overlayH) * 100}%` }}
                        title="Início marcado — marque também o fim"
                      />
                    )}
                  {showPreviewImage &&
                    showFaixaOverlayOnPreview &&
                    !faixaInicioMarcado &&
                    faixaFimMarcado &&
                    coordH > 0 && (
                      <OcrPositionedOverlay
                        className="absolute left-0 right-0 h-1 bg-rose-500 pointer-events-none shadow-[0_0_8px_rgba(244,63,94,0.9)] z-20"
                        layout={{ top: `${(faixaEnd / overlayH) * 100}%` }}
                        title="Fim marcado — marque também o início"
                      />
                    )}
                  {showPreviewImage &&
                    activeId !== FAIXA_INICIO_ID &&
                    activeId !== FAIXA_FIM_ID &&
                    isMappingColumnField(activeId) &&
                    mousePos &&
                    coordW > 0 && (
                      <OcrPositionedOverlay
                        className="absolute top-0 bottom-0 w-[2px] bg-black pointer-events-none z-30 shadow-[0_0_0_1px_rgba(255,255,255,0.85)]"
                        layout={{
                          left: `${(mousePos.x / overlayW) * 100}%`,
                          transform: 'translateX(-50%)',
                        }}
                      />
                    )}
                  {showPreviewImage &&
                    (activeId === FAIXA_INICIO_ID || activeId === FAIXA_FIM_ID) &&
                    mousePos &&
                    coordH > 0 && (
                      <OcrPositionedOverlay
                        className="absolute left-0 right-0 h-px bg-brand-border border-t border-dashed border-brand-border pointer-events-none"
                        layout={{ top: `${(mousePos.y / coordH) * 100}%` }}
                      />
                    )}
                </div>
              ) : null}
              {!showPreviewImage && (
                <div className="w-full h-full min-w-full min-h-full bg-brand-sidebar flex flex-col items-center justify-center gap-4 px-6 border border-brand-border/20">
                  <Loader2 className="w-12 h-12 text-brand-border animate-spin" aria-hidden />
                  <p className="text-[11px] font-bold uppercase tracking-widest text-center max-w-md leading-snug">
                    {loadMsg}
                  </p>
                  {fileIsPdf && (
                    <p className="text-[9px] text-center max-w-sm leading-relaxed opacity-65">
                      OCR direto do PDF para encaixar as informações na tabela no momento de confirmar.
                    </p>
                  )}
                  <p className="text-[9px] font-mono opacity-50">
                    Área da imagem: {PREVIEW_AREA_PADRAO_W}×{PREVIEW_AREA_PADRAO_H} px
                  </p>
                  {coordW > 0 && coordH > 0 ? (
                    <p className="text-[9px] font-mono opacity-35">
                      Documento: {coordW}×{coordH} px
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="w-80 sm:w-[22rem] border-l border-brand-border flex flex-col bg-white shrink-0 min-h-0 min-w-0 shadow-[-4px_0_0_0_rgba(20,20,20,0.06)]">
          {isExtratoOcr && (
            <div className="shrink-0 flex border-b border-brand-border bg-brand-sidebar/20">
              <button
                type="button"
                onClick={() => setSideTab('config')}
                className={cn(
                  'flex-1 py-2 text-[9px] font-black uppercase tracking-widest',
                  sideTab === 'config' ? 'bg-brand-border text-brand-bg' : 'opacity-60',
                )}
              >
                Parametrizar
              </button>
              <button
                type="button"
                onClick={() => {
                  refreshSavedLayouts();
                  setSideTab('layouts');
                }}
                className={cn(
                  'flex-1 py-2 text-[9px] font-black uppercase tracking-widest',
                  sideTab === 'layouts' ? 'bg-brand-border text-brand-bg' : 'opacity-60',
                )}
              >
                Layouts salvos
              </button>
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-4 py-4 space-y-4">
            {isExtratoOcr && sideTab === 'layouts' ? (
              <section className="technical-panel p-4 space-y-3 shadow-[2px_2px_0_0_#141414]">
                <h3 className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                  <FolderOpen className="w-3 h-3 shrink-0" /> Layouts salvos
                </h3>
                <p className="text-[9px] opacity-60 leading-snug">
                  Salve quantos layouts quiser (banco, colunas, delimitação). Nada é aplicado ao abrir o
                  extrato — clique em «Usar este layout» no layout que deseja carregar.
                </p>
                {savedLayouts.length === 0 ? (
                  <p className="text-[9px] text-slate-500 uppercase py-4 text-center">
                    Nenhum layout salvo ainda.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[420px] overflow-y-auto">
                    {savedLayouts.map((layout) => {
                      const isActiveLayout =
                        getActiveExtratoOcrLayout(companyName)?.id === layout.id;
                      return (
                        <div
                          key={layout.id}
                          className={cn(
                            'border border-brand-border/30 p-2 space-y-1',
                            (layoutEditId === layout.id || isActiveLayout) && 'bg-brand-sidebar/40',
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-[10px] font-black uppercase truncate">{layout.bancoNome}</p>
                            {isActiveLayout ? (
                              <span className="text-[7px] font-black uppercase tracking-wider opacity-60 shrink-0">
                                Ativo
                              </span>
                            ) : null}
                          </div>
                          <p className="text-[9px] font-mono opacity-70">{layout.contaBanco}</p>
                          <p className="text-[8px] opacity-50">
                            {new Date(layout.updatedAt).toLocaleString('pt-BR')}
                          </p>
                          <div className="flex gap-1 pt-1">
                            <button
                              type="button"
                              className="technical-button text-[8px] py-0.5 px-2 flex-1"
                              onClick={() => {
                                setActiveExtratoOcrLayout(companyName, layout.id);
                                setLayoutEditId(layout.id);
                                setBancoNome(layout.bancoNome);
                                setContaBanco(layout.contaBanco);
                                applyLayoutToState(layout);
                                window.dispatchEvent(
                                  new CustomEvent('contabilfacil-extrato-banco-updated', {
                                    detail: {
                                      company: companyName,
                                      contaBanco: layout.contaBanco,
                                      bancoNome: layout.bancoNome,
                                    },
                                  }),
                                );
                                refreshSavedLayouts();
                              }}
                            >
                              {isActiveLayout ? 'Reaplicar' : 'Usar este layout'}
                            </button>
                            <button
                              type="button"
                              className="technical-button text-[8px] py-0.5 px-1 text-red-700"
                              aria-label={`Excluir layout ${layout.bancoNome}`}
                              onClick={() => {
                                deleteExtratoOcrLayout(companyName, layout.id);
                                if (layoutEditId === layout.id) setLayoutEditId(null);
                                refreshSavedLayouts();
                              }}
                            >
                              <Trash2 size={10} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            ) : (
              <>
                {isExtratoOcr && (
                  <section className="technical-panel p-4 space-y-3 shadow-[2px_2px_0_0_#141414]">
                    <h3 className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                      <Building2 className="w-3 h-3 shrink-0" /> Banco do extrato
                    </h3>
                    <p className="text-[9px] opacity-60 leading-snug">
                      Saída (D) credita o banco; entrada (C) debita o banco. O sistema só define a contrapartida.
                    </p>
                    <div className="space-y-2">
                      <label className="block text-[9px] font-bold uppercase opacity-50">Nome do banco</label>
                      <input
                        type="text"
                        value={bancoNome}
                        onChange={(e) => setBancoNome(e.target.value)}
                        placeholder="Ex.: CRESOL, SICOOB"
                        className="w-full border border-brand-border bg-brand-sidebar/30 text-[10px] py-1.5 px-2 font-mono"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="block text-[9px] font-bold uppercase opacity-50">Conta contábil do banco</label>
                      {planoContaOptions.length > 0 ? (
                        <select
                          aria-label="Conta contábil do banco"
                          value={contaBanco}
                          onChange={(e) => {
                            const code = e.target.value;
                            setContaBanco(code);
                            const pick = planoContaOptions.find((p) => p.code === code);
                            if (pick && !bancoNome.trim()) {
                              setBancoNome(pick.name);
                            }
                          }}
                          className="w-full border border-brand-border bg-brand-sidebar/30 text-[10px] py-1.5 px-2 font-mono"
                        >
                          <option value="">Selecione a conta banco…</option>
                          {planoContaOptions.map((p) => (
                            <option key={p.code} value={p.code}>
                              {p.code} — {p.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={contaBanco}
                          onChange={(e) => setContaBanco(e.target.value)}
                          placeholder="Código da conta banco"
                          className="w-full border border-brand-border bg-brand-sidebar/30 text-[10px] py-1.5 px-2 font-mono"
                        />
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        persistCurrentExtratoLayout();
                        if (companyName?.trim() && bancoNome.trim() && contaBanco.trim()) {
                          window.dispatchEvent(
                            new CustomEvent('contabilfacil-extrato-banco-updated', {
                              detail: {
                                company: companyName,
                                contaBanco: contaBanco.trim(),
                                bancoNome: bancoNome.trim(),
                              },
                            }),
                          );
                        }
                      }}
                      disabled={!bancoNome.trim() || !contaBanco.trim() || !companyName?.trim()}
                      className="technical-button w-full text-[9px] py-1.5 flex items-center justify-center gap-1 disabled:opacity-40"
                    >
                      <Save size={11} /> {layoutEditId ? 'Atualizar layout selecionado' : 'Salvar novo layout'}
                    </button>
                    {layoutEditId ? (
                      <button
                        type="button"
                        onClick={() => setLayoutEditId(null)}
                        className="technical-button-secondary w-full text-[9px] py-1.5"
                      >
                        Salvar como novo (desvincular edição)
                      </button>
                    ) : null}
                  </section>
                )}
                {fileIsPdf && sideTab === 'config' && supportsValorModo ? (
                  <section className="technical-panel p-4 space-y-2 shadow-[2px_2px_0_0_#141414]">
                    <h3 className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                      <ZoomIn className="w-3 h-3 shrink-0" /> Resolução OCR validada
                    </h3>
                    <p className="text-[9px] leading-snug opacity-70">
                      Aqui ficam só as opções que já se mostraram estáveis para extrato.
                    </p>
                    {coordW > 0 && coordH > 0 ? (
                      <p className="text-[9px] font-mono opacity-80">
                        Prévia atual: {coordW}×{coordH} px · escala {pdfRenderScale.toFixed(2)}
                      </p>
                    ) : null}
                    <label className="block space-y-1">
                      <span className="text-[9px] font-bold uppercase tracking-wide opacity-70">
                        Preset
                      </span>
                      <select
                        value={normalizeExtratoResolutionMode(effectiveOcrResolutionSettings.resolutionMode)}
                        onChange={(e) =>
                          setOcrResolutionSettings((s) => ({
                            ...s,
                            resolutionMode: e.target.value as OcrResolutionMode,
                          }))
                        }
                        className="w-full border border-brand-border bg-brand-sidebar/30 text-[10px] py-1.5 px-2 font-mono"
                      >
                        {EXTRATO_SAFE_RESOLUTION_CHOICES.map((choice) => (
                          <option key={choice.value} value={choice.value}>
                            {choice.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {normalizeExtratoResolutionMode(ocrResolutionSettings.resolutionMode) === 'custom' ? (
                      <label className="block space-y-1">
                        <span className="text-[9px] font-bold uppercase tracking-wide opacity-70">
                          Zoom OCR (escala PDF 3–16)
                        </span>
                        <select
                          value={ocrResolutionSettings.pdfRenderScale}
                          onChange={(e) =>
                            setOcrResolutionSettings((s) => ({
                              ...s,
                              resolutionMode: 'custom',
                              pdfRenderScale: clampPdfRenderScale(Number(e.target.value)),
                            }))
                          }
                          className="w-full border border-brand-border bg-brand-sidebar/30 text-[10px] py-1.5 px-2 font-mono"
                        >
                          {PDF_RENDER_SCALE_CHOICES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <p className="text-[9px] leading-snug opacity-65">
                      {
                        EXTRATO_SAFE_RESOLUTION_CHOICES.find(
                          (choice) =>
                            choice.value ===
                            normalizeExtratoResolutionMode(effectiveOcrResolutionSettings.resolutionMode),
                        )?.hint
                      }
                    </p>
                    <button
                      type="button"
                      onClick={() => void applyOcrResolution()}
                      disabled={loading || extracting || !doc?.pdfDoc}
                      className="technical-button-primary w-full text-[9px] py-1.5 font-bold disabled:opacity-40"
                    >
                      Aplicar preset e recarregar página
                    </button>
                  </section>
                ) : null}
                {fileIsPdf && sideTab === 'config' && !supportsValorModo ? (
                  <section className="technical-panel p-4 space-y-3 shadow-[2px_2px_0_0_#141414]">
                    <h3 className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                      <ZoomIn className="w-3 h-3 shrink-0" /> Resolução do PDF (OCR)
                    </h3>
                    <p className="text-[9px] leading-snug opacity-60">
                      Para extratos Itaú, use <strong>Automático</strong> ou Full HD. Escala 4K ou manual
                      alta costuma <em>piorar</em> o DocTR (menos linhas e histórico vazio).
                    </p>
                    {coordW > 0 && coordH > 0 ? (
                      <p className="text-[9px] font-mono opacity-80">
                        Atual: {coordW}×{coordH} px · escala {pdfRenderScale.toFixed(2)}
                        {doc?.pdfSuggestedScale4k
                          ? ` · sugestão 4K: ${doc.pdfSuggestedScale4k.toFixed(2)}`
                          : ''}
                      </p>
                    ) : null}
                    <label className="block space-y-1">
                      <span className="text-[9px] font-bold uppercase tracking-wide opacity-70">
                        Modo
                      </span>
                      <select
                        value={ocrResolutionSettings.resolutionMode}
                        onChange={(e) =>
                          setOcrResolutionSettings((s) => ({
                            ...s,
                            resolutionMode: e.target.value as OcrResolutionMode,
                          }))
                        }
                        className="w-full border border-brand-border bg-brand-sidebar/30 text-[10px] py-1.5 px-2 font-mono"
                      >
                        {(Object.keys(OCR_RESOLUTION_MODE_LABELS) as OcrResolutionMode[]).map((mode) => (
                          <option key={mode} value={mode}>
                            {OCR_RESOLUTION_MODE_LABELS[mode]}
                          </option>
                        ))}
                      </select>
                    </label>
                    {ocrResolutionSettings.resolutionMode === 'custom' ? (
                      <label className="block space-y-1">
                        <span className="text-[9px] font-bold uppercase tracking-wide opacity-70">
                          Escala manual (3–16)
                        </span>
                        <select
                          value={ocrResolutionSettings.pdfRenderScale}
                          onChange={(e) =>
                            setOcrResolutionSettings((s) => ({
                              ...s,
                              pdfRenderScale: clampPdfRenderScale(Number(e.target.value)),
                            }))
                          }
                          className="w-full border border-brand-border bg-brand-sidebar/30 text-[10px] py-1.5 px-2 font-mono"
                        >
                          {PDF_RENDER_SCALE_CHOICES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {doc?.pdfSuggestedScaleFhd ? (
                        <button
                          type="button"
                          className="technical-button text-[9px] py-1 px-2"
                          onClick={() =>
                            setOcrResolutionSettings((s) => ({
                              ...s,
                              resolutionMode: 'fhd',
                            }))
                          }
                        >
                          Full HD (~{doc.pdfSuggestedScaleFhd.toFixed(1)})
                        </button>
                      ) : null}
                      {doc?.pdfSuggestedScale4k ? (
                        <button
                          type="button"
                          className="technical-button-secondary text-[9px] py-1 px-2 opacity-70"
                          title="4K costuma piorar OCR de extrato Itaú no DocTR"
                          onClick={() =>
                            setOcrResolutionSettings((s) => ({
                              ...s,
                              resolutionMode: 'custom',
                              pdfRenderScale: clampPdfRenderScale(doc.pdfSuggestedScale4k!),
                            }))
                          }
                        >
                          4K (~{doc.pdfSuggestedScale4k.toFixed(1)}) — pode piorar
                        </button>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => void applyOcrResolution()}
                      disabled={loading || extracting || !doc?.pdfDoc}
                      className="technical-button-primary w-full text-[9px] py-1.5 font-bold disabled:opacity-40"
                    >
                      Aplicar resolução e recarregar página
                    </button>
                  </section>
                ) : null}
                {!isPlanoOcr ? (
                  <section className="technical-panel p-4 space-y-3 shadow-[2px_2px_0_0_#141414]">
                    <h3 className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                      <ListFilter className="w-3 h-3 shrink-0" /> Linhas para ignorar
                      {itauProfileActive && (
                        <span className="ml-auto text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 bg-orange-600 text-white border border-brand-border">
                          Perfil Itaú
                        </span>
                      )}
                    </h3>
                    {itauProfileActive && (
                      <p className="text-[9px] leading-snug text-orange-700 font-bold">
                        Layout Itaú detectado — ignore words e pipeline de pareamento aplicados automaticamente
                        (mesma configuração dos testes).
                      </p>
                    )}
                    <p className="text-[9px] leading-snug opacity-60">
                      Linha inteira não entra na importação se contiver qualquer palavra abaixo (sem distinção de
                      maiúsculas).
                    </p>
                    <textarea
                      value={ignoreLineWordsText}
                      onChange={(e) => setIgnoreLineWordsText(e.target.value)}
                      onBlur={() => persistIgnoreLineWords(ignoreLineWordsText)}
                      rows={4}
                      placeholder="saldo anterior, saldo bloq, ouvidoria, 0800"
                      className="w-full border border-brand-border bg-brand-sidebar/30 text-[10px] py-2 px-2 font-mono normal-case shadow-[2px_2px_0_0_#141414] resize-y min-h-[5rem]"
                    />
                    {(itauProfileActive ? effectiveIgnoreLineWordsList : ignoreLineWordsList).length > 0 && (
                      <p className="text-[9px] opacity-70">
                        Ativas:{' '}
                        <span className="font-mono">
                          {(itauProfileActive ? effectiveIgnoreLineWordsList : ignoreLineWordsList).join(' · ')}
                        </span>
                      </p>
                    )}
                  </section>
                ) : null}

                <section className="technical-panel p-4 space-y-3 shadow-[2px_2px_0_0_#141414]">
                  <h3 className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                    <Settings2 className="w-3 h-3 shrink-0" /> Delimitação vertical
                  </h3>
                  <p className="text-[9px] leading-snug opacity-60">
                    Marque a linha do primeiro e do último lançamento na prévia (obrigatório).
                  </p>
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveId(FAIXA_INICIO_ID);
                        setClickStep('start');
                      }}
                      className={cn(
                        mapFieldBtn(activeId === FAIXA_INICIO_ID),
                        activeId === FAIXA_INICIO_ID && 'border-green-800',
                      )}
                    >
                      <span>Marcar início</span>
                      {faixaMarcadoresGlobal.inicioMarcado && (
                        <span className="text-[9px] opacity-80">OK</span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveId(FAIXA_FIM_ID);
                        setClickStep('start');
                      }}
                      className={cn(
                        mapFieldBtn(activeId === FAIXA_FIM_ID),
                        activeId === FAIXA_FIM_ID && 'border-red-800',
                      )}
                    >
                      <span>Marcar fim</span>
                      {faixaMarcadoresGlobal.fimMarcado && (
                        <span className="text-[9px] opacity-80">OK</span>
                      )}
                    </button>
                  </div>
                </section>

                <section className="technical-panel p-4 space-y-3 shadow-[2px_2px_0_0_#141414]">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-[10px] font-black uppercase tracking-widest">Colunas do documento</h3>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {isPlanoOcr && doc && doc.itemCount > 0 && (
                        <button
                          type="button"
                          onClick={suggestPlanoColumnsFromOcr}
                          className="text-[8px] font-bold uppercase text-brand-border hover:underline"
                          title="Detecta colunas pelo OCR (opcional — revise na imagem)"
                        >
                          Sugerir colunas
                        </button>
                      )}
                      {columns.some((c) => c.start !== c.end) && (
                        <button
                          type="button"
                          onClick={clearTodasColunasMapeadas}
                          className="text-[8px] font-bold uppercase text-red-800 hover:underline"
                          title="Remove o mapeamento de todas as colunas"
                        >
                          Limpar todas
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-[9px] font-mono opacity-55 leading-snug pb-2 border-b border-brand-border/20">
                    OCR: {title}
                  </p>
                  <div className="space-y-1.5">
                    {CAMPOS_DADOS.map((field) => {
                      const col = columns.find((c) => c.id === field.id);
                      const ok = col && col.start !== col.end;
                      return (
                        <div key={field.id} className="flex items-stretch gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              const col = columns.find((c) => c.id === field.id);
                              setActiveId(field.id);
                              setClickStep(col && col.start !== col.end ? 'end' : 'start');
                            }}
                            onDoubleClick={(ev) => ev.preventDefault()}
                            className={cn(mapFieldBtn(activeId === field.id), 'flex-1 min-w-0')}
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <span className={`w-2 h-2 shrink-0 ${field.color}`} />
                              <span className="truncate normal-case">{field.name}</span>
                            </span>
                            {ok ? <span className="text-[9px]">OK</span> : <span className="opacity-30">—</span>}
                          </button>
                          {ok && (
                            <button
                              type="button"
                              aria-label={`Remover mapeamento da coluna ${field.name}`}
                              title={`Remover coluna ${field.name}`}
                              onClick={() => clearColunaMapeada(field.id)}
                              className="shrink-0 px-2 border border-brand-border/40 bg-brand-sidebar/30 hover:bg-red-50 hover:border-red-800/40 text-red-800 transition-colors"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="technical-panel p-4 space-y-2 shadow-[2px_2px_0_0_#141414]">
                  <h3 className="text-[10px] font-black uppercase tracking-widest opacity-70">Colunas a ignorar</h3>
                  <div className="space-y-1.5">
                    {CAMPOS_IGNORAR.map((field) => {
                      const col = columns.find((c) => c.id === field.id);
                      const ok = col && col.start !== col.end;
                      return (
                        <div key={field.id} className="flex items-stretch gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              const col = columns.find((c) => c.id === field.id);
                              setActiveId(field.id);
                              setClickStep(col && col.start !== col.end ? 'end' : 'start');
                            }}
                            onDoubleClick={(ev) => ev.preventDefault()}
                            className={cn(mapFieldBtn(activeId === field.id, true), 'flex-1 min-w-0')}
                          >
                            <span className="truncate normal-case">{field.name}</span>
                            {ok ? <span className="text-[9px]">OK</span> : <span className="opacity-30">—</span>}
                          </button>
                          {ok && (
                            <button
                              type="button"
                              aria-label={`Remover mapeamento da coluna ${field.name}`}
                              title={`Remover coluna ${field.name}`}
                              onClick={() => clearColunaMapeada(field.id)}
                              className="shrink-0 px-2 border border-brand-border/40 bg-brand-sidebar/30 hover:bg-red-50 hover:border-red-800/40 text-red-800 transition-colors"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              </>
            )}
          </div>

          <div className="shrink-0 border-t border-brand-border bg-brand-sidebar/40 px-4 py-4 space-y-2">
            {extracting && extractProgress && (
              <div
                className="technical-panel p-3 space-y-2 shadow-[2px_2px_0_0_#141414]"
                role="status"
                aria-live="polite"
              >
                {extractProgressBarCss ? <style>{extractProgressBarCss}</style> : null}
                <div className="flex items-start gap-2">
                  <Loader2 className="w-4 h-4 animate-spin shrink-0 mt-0.5" aria-hidden />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-[9px] font-black uppercase tracking-widest leading-snug">
                      {extractProgress.message}
                    </p>
                    {extractProgressSummary ? (
                      <p className="text-[8px] font-bold uppercase tracking-wide opacity-70">
                        {extractProgressSummary}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="w-full h-2 bg-white border border-brand-border overflow-hidden">
                  <div className="doc-colunas-extract-progress-fill" />
                </div>
                {extractProgress.log.length > 1 && (
                  <div className="max-h-24 overflow-y-auto border border-brand-border/30 bg-white/60 p-2 space-y-0.5">
                    {extractProgress.log.map((entry, i) => (
                      <p
                        key={`${i}-${entry}`}
                        className={cn(
                          'text-[8px] font-mono leading-snug',
                          i === extractProgress.log.length - 1
                            ? 'font-bold text-brand-border'
                            : 'opacity-55',
                        )}
                      >
                        {entry}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
            {error && (
              <p className="text-[9px] font-bold uppercase text-red-800 border border-red-800/30 bg-red-50 p-2">
                {error}
              </p>
            )}
            <button
              type="button"
              disabled={
                (supportsValorModo &&
                  temAlgumaColunaMapeada &&
                  aiExtractEngine !== 'ai' &&
                  !extratoMapeamentoValidacao.ok) ||
                extracting ||
                loading ||
                (!ocrDeferredUntilExtract && ocrLoading) ||
                !doc
              }
              onClick={() => void handleConfirm()}
              className="technical-button-primary w-full flex items-center justify-center gap-2 py-3 text-[11px] disabled:opacity-40 shadow-[3px_3px_0_0_#141414]"
            >
              {extracting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : null}
              <span>
                {extracting
                  ? 'Processando e extraindo…'
                  : confirmLabel}
              </span>
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
