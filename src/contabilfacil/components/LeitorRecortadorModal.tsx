import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Columns, FolderOpen, Save, Sliders, Trash2 } from 'lucide-react';
import type { OcrConfirmMeta } from '../../lib/leitorRecortador/types';
import type { AIVisionSettings } from '../../lib/leitorRecortador/aiVision/types';
import { loadAIVisionSettings } from '../../lib/leitorRecortador/aiVision/aiVisionModels';
import { extractRowsFromPageImage } from '../../lib/leitorRecortador/aiVision/aiVisionExtract';
import { aiRowsToGenericExtractedRows } from '../../lib/leitorRecortador/aiVision/aiVisionAdapter';
import { ocrCanvasToTextItems } from '../../lib/leitorRecortador/localOcrEngine';
import { AIExtractLoadingView } from './leitorRecortador/AIExtractLoadingView';
import { AIKeyRequiredView } from './leitorRecortador/AIKeyRequiredView';
import type { GenericOcrRow } from '../../lib/parcelamentoColunasExtract';
import type { ParcelamentoPlanilhaImport } from '../../lib/parcelamentoPlanilha';
import { readPersistedLocalStorageJson, writePersistedLocalStorageJson } from '../../lib/persistentLocalStorage';
import {
  buildDefaultColumnMapping,
  extratoLegacyColumnMapping,
  getMappableCampoDefs,
  toLeitorColumnDefs,
} from '../../lib/leitorRecortador/columnDefaults';
import { detectRowsFromPixels, detectRowsFromText, extractGenericDataFromCanvas, filterRowsInCropBand } from '../../lib/leitorRecortador/cropper';
import {
  detectPlanoRowsFromText,
  extractPlanoDataFromCanvas,
} from '../../lib/leitorRecortador/planoRowDetection';
import { resolvePlanoColumnsForPage } from '../../lib/leitorRecortador/planoColumnPrecision';
import {
  detectRazaoRowsFromText,
  extractRazaoDataFromCanvas,
} from '../../lib/leitorRecortador/razaoRowDetection';
import { resolveRazaoColumnsForPage } from '../../lib/leitorRecortador/razaoColumnPrecision';
import {
  buildFaixaPorPagina,
  genericColumnsToPercentMapping,
  mappingToGenericColumns,
  mappingToNorm,
  normToMapping,
} from '../../lib/leitorRecortador/layoutBridge';
import { suggestPlanoContasColumns, suggestRazaoDominioColumns } from '../../lib/pdfNativeTextItems';
import {
  applyPlanoTipoInferenceToRows,
  genericToExtratoRow,
  mapGenericRowsToOcrRows,
  mapGenericRowsToParcelamento,
} from '../../lib/leitorRecortador/rowMappers';
import { parseAndRenderAllPDFPages, parseAndRenderImage } from '../../lib/leitorRecortador/pdfParser';
import type { ColumnMapping, GenericExtractedRow, LeitorColumnDef, RenderedPDFPage } from '../../lib/leitorRecortador/types';
import { companyStorageSlug } from '../logic/companyWorkspace';
import type { DataIngestionType, OcrColunaCampoDef } from '../logic/ocrColunasConfig';
import {
  deleteExtratoOcrLayout,
  getActiveExtratoOcrLayout,
  listExtratoOcrLayouts,
  saveExtratoOcrLayout,
  setActiveExtratoOcrLayout,
  saveExtratoBancoParaImportacao,
  type ExtratoOcrLayoutSaved,
} from '../logic/extratoOcrLayoutStorage';
import ExtratoContaPicker, { type ExtratoPlanoContaOption } from './ExtratoContaPicker';
import { GenericLeitorTable } from './leitorRecortador/GenericLeitorTable';
import { GenericLeitorWorkspace } from './leitorRecortador/GenericLeitorWorkspace';
import { GridManualControl } from './leitorRecortador/GridManualControl';

type Props = {
  file: File;
  dataType: DataIngestionType;
  title: string;
  confirmLabel: string;
  campoDefs: OcrColunaCampoDef[];
  dataColIds: string[];
  companyName?: string;
  planoContaOptions?: ExtratoPlanoContaOption[];
  /** PDF exportado pelo Sistema Domínio — colunas e linhas já otimizadas para o layout Domínio. */
  dominioPdfMode?: 'plano' | 'balancete';
  /** 'local' (padrão): alinhamento/recorte manual, com OCR local como apoio em páginas sem texto
   * nativo. 'ia': sem alinhamento — extrai direto via IA (Gemini) e cai na mesma tela de resultados. */
  engine?: 'local' | 'ia';
  onCancel: () => void;
  onConfirm: (rows: GenericOcrRow[], meta?: OcrConfirmMeta) => void;
  onConfirmParcelamento?: (data: ParcelamentoPlanilhaImport) => void;
};

/**
 * Normaliza texto para comparação: remove acentos, maiúsculas, espaços extras, sinais.
 * Preserva o original, usado APENAS para matching em filtros/exclusões.
 * 
 * Exemplos:
 * - "SALDO: ANTERIOR" → "SALDO ANTERIOR"
 * - "sáldo-antérior" → "SALDO ANTERIOR"
 * - "SALDO  .  ANTERIOR" → "SALDO ANTERIOR"
 */
function normalizeTextForMatching(text: string): string {
  return String(text ?? '')
    .normalize('NFD')                   // Decompõe acentos
    .replace(/[\u0300-\u036f]/g, '')   // Remove diacríticos
    .replace(/[^\w\s]/g, ' ')          // Remove sinais, mantém apenas letras/números/espaço
    .replace(/\s+/g, ' ')              // Normaliza espaços múltiplos
    .toUpperCase()                      // Converte para maiúsculas
    .trim();
}

function filterRowsByExclusion(
  rows: GenericExtractedRow[],
  columnDefs: LeitorColumnDef[],
  exclusionRules: string[],
): GenericExtractedRow[] {
  return rows.filter((row) => {
    const text = columnDefs.map((c) => row.fields[c.id] || '').join(' ');
    const normalizedText = normalizeTextForMatching(text);
    const normalizedRules = exclusionRules.map((rule) => normalizeTextForMatching(rule));
    return !normalizedRules.some((rule) => rule && normalizedText.includes(rule));
  });
}

export function LeitorRecortadorModal({
  file,
  dataType,
  title,
  confirmLabel,
  campoDefs,
  dataColIds,
  companyName = '',
  planoContaOptions = [],
  dominioPdfMode,
  engine = 'local',
  onCancel,
  onConfirm,
  onConfirmParcelamento,
}: Props) {
  const isExtrato = dataType === 'extrato';
  const isInstallments = dataType === 'installments';
  const isPlano = dataType === 'plano';
  const isBalancete = dataType === 'balancete';
  const isDominioPlano = dominioPdfMode === 'plano' && isPlano;
  const isDominioBalancete = dominioPdfMode === 'balancete' && isBalancete;
  const isDominioNativePdf = isDominioPlano || isDominioBalancete;

  const allMappableCampoDefs = useMemo(() => getMappableCampoDefs(campoDefs, dataColIds), [campoDefs, dataColIds]);
  /** Colunas que o usuário desativou nesta sessão (não aparecem no recorte nem no resultado). */
  const [disabledCampoIds, setDisabledCampoIds] = useState<Set<string>>(() => new Set());
  const toggleCampoAtivo = (id: string) => {
    setDisabledCampoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const mappableCampoDefs = useMemo(
    () => allMappableCampoDefs.filter((c) => !disabledCampoIds.has(c.id)),
    [allMappableCampoDefs, disabledCampoIds],
  );
  const columnIds = useMemo(() => mappableCampoDefs.map((c) => c.id), [mappableCampoDefs]);
  const allColumnDefs = useMemo<LeitorColumnDef[]>(
    () => toLeitorColumnDefs(campoDefs, dataColIds),
    [campoDefs, dataColIds],
  );
  const columnDefs = useMemo<LeitorColumnDef[]>(
    () => allColumnDefs.filter((d) => !disabledCampoIds.has(d.id)),
    [allColumnDefs, disabledCampoIds],
  );

  const [pdfPages, setPdfPages] = useState<RenderedPDFPage[]>([]);
  const [activeCanvas, setActiveCanvas] = useState<HTMLCanvasElement | null>(null);
  const [textItems, setTextItems] = useState<RenderedPDFPage['textItems']>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [docType, setDocType] = useState<'pdf' | 'image'>('pdf');
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [rows, setRows] = useState<GenericExtractedRow[]>([]);
  // Tanto o engine 'ia' quanto o 'local' agora extraem automaticamente ao carregar o arquivo —
  // a tela de alinhamento/grade manual (align) deixou de ser o passo obrigatório inicial e virou
  // uma correção/fallback (botão "1. Alinhamento & colunas", ou automaticamente quando a
  // extração automática falha/acha poucas linhas).
  const [activeTab, setActiveTab] = useState<'align' | 'results'>('results');
  const [aiSettings] = useState<AIVisionSettings>(() => loadAIVisionSettings());
  const aiKeyReady = !!aiSettings.apiKey.trim() && !!aiSettings.validated;
  const [isAiExtracting, setIsAiExtracting] = useState(false);
  const [aiProgressMsg, setAiProgressMsg] = useState('');
  const [aiExtractStarted, setAiExtractStarted] = useState(false);
  // Estado equivalente ao do engine 'ia' acima, para o pipeline automático do engine 'local'
  // (leitura nativa do PDF.js + bucketing de coluna + fallback de OCR Tesseract por página).
  const [isLocalExtracting, setIsLocalExtracting] = useState(false);
  const [localProgressMsg, setLocalProgressMsg] = useState('');
  const [localExtractStarted, setLocalExtractStarted] = useState(false);
  const [ocrLoadingDetail, setOcrLoadingDetail] = useState('');
  const [cropStartPct, setCropStartPct] = useState(10);
  const [cropEndPct, setCropEndPct] = useState(90);
  const [cropStartPage, setCropStartPage] = useState(1);
  const [cropEndPage, setCropEndPage] = useState(1);
  const [columns, setColumns] = useState<ColumnMapping>(() =>
    isExtrato ? extratoLegacyColumnMapping() : buildDefaultColumnMapping(columnIds),
  );
  const planoTemplateColsRef = useRef<ColumnMapping | null>(null);
  const razaoTemplateColsRef = useRef<ColumnMapping | null>(null);
  const [rowMode, setRowMode] = useState<'auto' | 'manual'>('auto');
  const [gridStartY, setGridStartY] = useState(240);
  const [gridRowHeight, setGridRowHeight] = useState(35);
  const [gridRowCount, setGridRowCount] = useState(12);
  const [detectedRows, setDetectedRows] = useState<
    Array<{ y: number; height: number; items?: RenderedPDFPage['textItems'] }>
  >([]);
  // Nunca preenchido automaticamente — o usuário cadastra e, se quiser, salva para reutilizar.
  const [exclusionRules, setExclusionRules] = useState<string[]>([]);
  const [sideTab, setSideTab] = useState<'config' | 'layouts'>('config');
  const [bancoNome, setBancoNome] = useState('');
  const [contaBanco, setContaBanco] = useState(isExtrato ? '' : dataType);
  const [layoutEditId, setLayoutEditId] = useState<string | null>(null);
  const [savedLayouts, setSavedLayouts] = useState<ExtratoOcrLayoutSaved[]>([]);
  const [saldoAnterior, setSaldoAnterior] = useState(0);
  const [cropExplicitlyApplied, setCropExplicitlyApplied] = useState(false);
  const [cropPreviewApplied, setCropPreviewApplied] = useState(false);
  const [valorSignHeuristic, setValorSignHeuristic] = useState<'automatic' | 'color_blue_c_red_d' | 'color_blue_d_red_c'>('automatic');

  const layoutContaKey = isExtrato ? contaBanco : dataType;

  const saldoStorageKey = useMemo(
    () => (companyName.trim() ? `contabilfacil_${companyStorageSlug(companyName)}_extrato_saldo_anterior` : ''),
    [companyName],
  );

  const refreshSavedLayouts = useCallback(() => {
    if (!companyName.trim()) {
      setSavedLayouts([]);
      return;
    }
    setSavedLayouts(listExtratoOcrLayouts(companyName, dataType));
  }, [companyName, dataType]);

  useEffect(() => {
    refreshSavedLayouts();
    const active = companyName.trim() ? getActiveExtratoOcrLayout(companyName, dataType) : null;
    if (active) {
      setBancoNome(active.bancoNome);
      if (isExtrato) setContaBanco(active.contaBanco || '');
      setLayoutEditId(active.id);
      if (active.columnsNorm?.length) {
        const restored = normToMapping(active.columnsNorm);
        if (restored) setColumns(restored);
      }
      if (isExtrato && active.ignoreLineWords?.trim()) {
        setExclusionRules(
          active.ignoreLineWords
            .split(/[,;\n]+/)
            .map((s) => s.trim())
            .filter(Boolean),
        );
      }
    }
    if (isExtrato && saldoStorageKey) {
      const raw = readPersistedLocalStorageJson<string | number | null>(saldoStorageKey, null);
      if (raw != null) {
        const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
        if (Number.isFinite(n)) setSaldoAnterior(n);
      }
    }
  }, [companyName, dataType, isExtrato, refreshSavedLayouts, saldoStorageKey]);

  const detectPageRows = useCallback(
    (
      textItems: RenderedPDFPage['textItems'],
      mode: 'auto' | 'manual',
      canvas?: HTMLCanvasElement | null,
    ) => {
      const textRows = detectRowsFromText(textItems, 10).map((r) => ({ y: r.y, height: r.height }));
      if (textRows.length > 0) return textRows;
      // Sem texto nativo (página escaneada/foto): detecta pela imagem.
      return canvas ? detectRowsFromPixels(canvas) : textRows;
    },
    [],
  );

  const extractPageRows = useCallback(
    (
      page: RenderedPDFPage,
      cols: ColumnMapping,
      rowConfigs: Array<{ y: number; height: number; items?: RenderedPDFPage['textItems'] }>,
      bandStartY?: number,
      bandEndY?: number,
    ) => {
      const pageCols = isDominioPlano
        ? resolvePlanoColumnsForPage(page.textItems, page.width, columnIds, cols)
        : isDominioBalancete
          ? resolveRazaoColumnsForPage(page.textItems, page.width, columnIds, cols)
          : cols;
      return extractGenericDataFromCanvas(
        page.canvas,
        page.textItems,
        columnIds,
        pageCols,
        rowConfigs,
        page.pageNumber,
        true,
        { valorSignHeuristic, bandStartY, bandEndY },
      );
    },
    [columnIds, isDominioPlano, isDominioBalancete, valorSignHeuristic],
  );

  const runCropAll = useCallback(
    (
      pages: RenderedPDFPage[],
      cols: ColumnMapping,
      mode: 'auto' | 'manual',
      pageRange?: { start: number; end: number },
    ) => {
      const startPage = pageRange?.start ?? cropStartPage;
      const endPage = pageRange?.end ?? cropEndPage;
      let allRows: GenericExtractedRow[] = [];
      pages.forEach((page) => {
        if (page.pageNumber < startPage || page.pageNumber > endPage) return;
        const pageRows = detectPageRows(page.textItems, mode, page.canvas);
        const startY = page.pageNumber === startPage ? (cropStartPct / 100) * page.height : 0;
        const endY = page.pageNumber === endPage ? (cropEndPct / 100) * page.height : page.height;
        const filtered = filterRowsInCropBand(pageRows, startY, endY);
        if (filtered.length === 0) return;
        const extracted = extractPageRows(page, cols, filtered, startY, endY);
        allRows = [...allRows, ...extracted];
      });
      return allRows;
    },
    [
      cropStartPage,
      cropEndPage,
      cropStartPct,
      cropEndPct,
      detectPageRows,
      extractPageRows,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      setRows([]);
      setCropExplicitlyApplied(false);
      setCropPreviewApplied(false);
      // Engine 'local': cai direto na tela de resultados (mesma forma da 'ia'); a extração
      // automática dispara sozinha assim que as páginas terminarem de carregar (efeito mais
      // abaixo). A aba 'align' só é usada se essa extração automática falhar ou achar poucas
      // linhas — nesse caso o próprio runLocalAutoExtraction chama setActiveTab('align').
      setActiveTab('results');
      setLocalExtractStarted(false);
      setIsLocalExtracting(false);
      setLocalProgressMsg('');
      try {
        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        if (isPdf) {
          const pages = await parseAndRenderAllPDFPages(file);
          if (cancelled) return;
          if (pages.length === 0) throw new Error('Nenhuma página encontrada no PDF.');
          setPdfPages(pages);
          setDocType('pdf');
          setCurrentPage(1);
          setCropStartPage(1);
          setCropEndPage(pages.length);
          setActiveCanvas(pages[0]!.canvas);
          setTextItems(pages[0]!.textItems);
          setRowMode('auto');
          if (isDominioPlano) {
            const posItems = pages[0]!.textItems.map((t) => ({
              str: t.text,
              x: t.x,
              y: t.y,
              w: t.width,
              h: t.height,
            }));
            const suggested = suggestPlanoContasColumns(posItems, pages[0]!.width);
            let templateCols = columns;
            if (suggested?.columns.some((c) => c.start !== c.end)) {
              const mapped = genericColumnsToPercentMapping(suggested.columns, pages[0]!.width);
              if (Object.keys(mapped).length >= 2) templateCols = mapped;
              if (pages[0]!.height > 0) {
                setCropStartPct(Math.max(0, (suggested.faixaStart / pages[0]!.height) * 100));
                setCropEndPct(Math.min(100, (suggested.faixaEnd / pages[0]!.height) * 100));
              }
            }
            planoTemplateColsRef.current = templateCols;
            const refined = resolvePlanoColumnsForPage(
              pages[0]!.textItems,
              pages[0]!.width,
              columnIds,
              templateCols,
            );
            setColumns(refined);
          } else if (isDominioBalancete) {
            const posItems = pages[0]!.textItems.map((t) => ({
              str: t.text,
              x: t.x,
              y: t.y,
              w: t.width,
              h: t.height,
            }));
            const suggested = suggestRazaoDominioColumns(posItems, pages[0]!.width);
            let templateCols = columns;
            if (suggested?.columns.some((c) => c.start !== c.end)) {
              const mapped = genericColumnsToPercentMapping(suggested.columns, pages[0]!.width);
              if (Object.keys(mapped).length >= 2) templateCols = mapped;
              if (pages[0]!.height > 0) {
                setCropStartPct(Math.max(0, (suggested.faixaStart / pages[0]!.height) * 100));
                setCropEndPct(Math.min(100, (suggested.faixaEnd / pages[0]!.height) * 100));
              }
            }
            razaoTemplateColsRef.current = templateCols;
            const refined = resolveRazaoColumnsForPage(
              pages[0]!.textItems,
              pages[0]!.width,
              columnIds,
              templateCols,
            );
            setColumns(refined);
          }
          const autoRows = isDominioPlano
            ? detectPlanoRowsFromText(pages[0]!.textItems)
            : isDominioBalancete
              ? detectRazaoRowsFromText(pages[0]!.textItems)
              : detectRowsFromText(pages[0]!.textItems, 10).map((r) => ({ y: r.y, height: r.height }));
          setDetectedRows(autoRows);
        } else {
          const page = await parseAndRenderImage(file);
          if (cancelled) return;
          setPdfPages([page]);
          setDocType('image');
          setCurrentPage(1);
          setCropStartPage(1);
          setCropEndPage(1);
          setActiveCanvas(page.canvas);
          setTextItems([]);
          // Motor local (Tesseract) lê o texto da imagem escaneada — se achar palavras
          // suficientes, o resto do pipeline funciona igual a um PDF com texto nativo.
          let ocrTextItems: RenderedPDFPage['textItems'] = [];
          if (engine === 'local') {
            try {
              setOcrLoadingDetail('Lendo imagem com OCR local...');
              ocrTextItems = await ocrCanvasToTextItems(page.canvas, (frac, msg) => {
                if (!cancelled) setOcrLoadingDetail(msg || `OCR ${Math.round(frac * 100)}%`);
              });
            } catch (ocrErr) {
              console.warn('[LeitorRecortadorModal] OCR local falhou, usando detecção por pixels:', ocrErr);
            } finally {
              setOcrLoadingDetail('');
            }
          }
          if (cancelled) return;
          if (ocrTextItems.length >= 3) {
            // Atualiza também o objeto já guardado em `pdfPages` (mesma referência) — sem isso
            // `extractPageRows`/`handleApplyCrop` leriam o `textItems` vazio original.
            page.textItems = ocrTextItems;
            setTextItems(ocrTextItems);
            setRowMode('auto');
            setDetectedRows(detectRowsFromText(ocrTextItems, 10).map((r) => ({ y: r.y, height: r.height, items: r.items })));
          } else {
            // Detecção automática pela imagem (projeção de pixels) antes de cair no manual.
            const pixelRows = detectRowsFromPixels(page.canvas);
            if (pixelRows.length >= 3) {
              setRowMode('auto');
              setDetectedRows(pixelRows);
            } else {
              setRowMode('manual');
              setGridStartY(Math.round(page.height * 0.25));
              setGridRowHeight(Math.round(page.height * 0.04) || 35);
              setGridRowCount(12);
              const manualRows = Array.from({ length: 12 }).map((_, i) => ({
                y: Math.round(page.height * 0.25) + i * (Math.round(page.height * 0.04) || 35),
                height: Math.round(page.height * 0.04) || 35,
              }));
              setDetectedRows(manualRows);
            }
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- carrega uma vez por arquivo
  }, [file]);

  useEffect(() => {
    if (!activeCanvas) return;
    if (rowMode === 'manual') return;
    setDetectedRows(detectPageRows(textItems, rowMode, activeCanvas));
  }, [activeCanvas, rowMode, textItems, detectPageRows]);

  // Grade manual: recalcula as linhas sempre que Início Y, Altura ou Qtd mudarem —
  // sem isso os controles só atualizavam o número exibido, sem mover a grade real.
  useEffect(() => {
    if (!activeCanvas || rowMode !== 'manual') return;
    setDetectedRows(
      Array.from({ length: gridRowCount }, (_, i) => ({
        y: gridStartY + i * gridRowHeight,
        height: gridRowHeight,
      })),
    );
  }, [activeCanvas, rowMode, gridStartY, gridRowHeight, gridRowCount]);

  const handlePageChange = (pageNumber: number) => {
    const page = pdfPages.find((p) => p.pageNumber === pageNumber);
    if (!page) return;
    setCurrentPage(pageNumber);
    setActiveCanvas(page.canvas);
    setTextItems(page.textItems);
    if (rowMode === 'auto') {
      setDetectedRows(detectPageRows(page.textItems, 'auto', page.canvas));
    }
    if (isDominioPlano && planoTemplateColsRef.current) {
      const refined = resolvePlanoColumnsForPage(
        page.textItems,
        page.width,
        columnIds,
        planoTemplateColsRef.current,
      );
      setColumns(refined);
    }
    if (isDominioBalancete && razaoTemplateColsRef.current) {
      const refined = resolveRazaoColumnsForPage(
        page.textItems,
        page.width,
        columnIds,
        razaoTemplateColsRef.current,
      );
      setColumns(refined);
    }
  };

  const handleApplyCrop = () => {
    if (!activeCanvas || detectedRows.length === 0) {
      setError('Nenhuma linha detectada para recortar.');
      return;
    }
    setIsProcessing(true);
    setError(null);
    try {
      if (currentPage < cropStartPage || currentPage > cropEndPage) {
        setError(`Página ${currentPage} fora do intervalo ${cropStartPage}–${cropEndPage}.`);
        return;
      }
      const startY = currentPage === cropStartPage ? (cropStartPct / 100) * activeCanvas.height : 0;
      const endY = currentPage === cropEndPage ? (cropEndPct / 100) * activeCanvas.height : activeCanvas.height;
      const filtered = filterRowsInCropBand(detectedRows, startY, endY);
      if (filtered.length === 0) {
        setError('Nenhuma linha dentro dos delimitadores desta página.');
        return;
      }
      const page = pdfPages.find((p) => p.pageNumber === currentPage);
      if (!page) {
        setError('Página ativa não encontrada.');
        return;
      }
      const extracted = extractPageRows(page, columns, filtered, startY, endY);
      setRows(isPlano ? applyPlanoTipoInferenceToRows(extracted) : extracted);
      setCropExplicitlyApplied(true);
      setActiveTab('results');
      setSuccess(`${extracted.length} linha(s) recortada(s) da página ${currentPage}.`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApplyCropAll = () => {
    setIsProcessing(true);
    setError(null);
    try {
      const allRows = runCropAll(pdfPages, columns, rowMode);
      if (allRows.length === 0) {
        setError('Nenhum dado extraído com as configurações atuais.');
        return;
      }
      setRows(isPlano ? applyPlanoTipoInferenceToRows(allRows) : allRows);
      setCropExplicitlyApplied(true);
      setActiveTab('results');
      setSuccess(`${allRows.length} linha(s) recortada(s) das páginas ${cropStartPage} a ${cropEndPage}.`);
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * Garante que a página tenha itens de texto utilizáveis antes do bucketing de coluna. Páginas
   * de PDF nativo já vêm com texto (pdfjs); páginas ESCANEADAS (foto/scan dentro de um PDF com
   * várias páginas) não têm — sem isso, a página caía direto na detecção de linhas por pixel
   * (sem nenhum texto real, então a extração de cada coluna saía vazia). Agora, quando a página
   * não tem texto nativo suficiente, roda o motor de OCR local (Tesseract, `ocrCanvasToTextItems`)
   * no canvas já renderizado da própria página e devolve os itens no mesmo formato `PDFTextItem[]`
   * usado pelo resto do pipeline (`detectRowsFromText`/`extractGenericDataFromCanvas`) — a página
   * escaneada passa a se comportar como se tivesse texto nativo. O resultado é gravado de volta em
   * `pdfPages` para não repetir o OCR se a página for revisitada.
   */
  const ensureTextItemsForPage = useCallback(
    async (
      page: RenderedPDFPage,
      onProgress?: (msg: string) => void,
    ): Promise<RenderedPDFPage['textItems']> => {
      if (page.textItems.length >= 5) return page.textItems;
      try {
        const ocrItems = await ocrCanvasToTextItems(page.canvas, (frac, msg) => {
          onProgress?.(msg || `OCR local página ${page.pageNumber}: ${Math.round(frac * 100)}%`);
        });
        if (ocrItems.length > page.textItems.length) {
          setPdfPages((prev) =>
            prev.map((p) => (p.pageNumber === page.pageNumber ? { ...p, textItems: ocrItems } : p)),
          );
          return ocrItems;
        }
      } catch (ocrErr) {
        console.warn(`[LeitorRecortadorModal] OCR local falhou na página ${page.pageNumber}:`, ocrErr);
      }
      return page.textItems;
    },
    [],
  );

  /**
   * Pipeline automático do "OCR Local": roda a extração completa (leitura nativa do PDF.js →
   * detecção de linhas → OCR Tesseract por página quando não há texto nativo → bucketing de
   * coluna) assim que o arquivo é carregado, sem exigir que o usuário alinhe colunas manualmente
   * primeiro — mesma forma de uso do engine 'ia'. A grade manual (aba "Alinhamento & colunas")
   * continua disponível como correção, e é para onde caímos automaticamente se esta extração
   * falhar ou não achar nenhuma linha aproveitável.
   */
  const runLocalAutoExtraction = useCallback(async () => {
    setIsLocalExtracting(true);
    setError(null);
    try {
      let allRows: GenericExtractedRow[] = [];
      for (const originalPage of pdfPages) {
        const p = originalPage.pageNumber;
        if (p < cropStartPage || p > cropEndPage) continue;
        setLocalProgressMsg(`Processando página ${p}/${pdfPages.length}...`);

        let page = originalPage;
        let pageRows = detectPageRows(page.textItems, 'auto', page.canvas);
        if (pageRows.length === 0) {
          // Página sem texto nativo suficiente (provável scan/foto dentro do PDF): tenta OCR
          // local antes de desistir para uma detecção puramente visual (pixels, sem conteúdo).
          const ocrItems = await ensureTextItemsForPage(page, setLocalProgressMsg);
          if (ocrItems !== page.textItems) {
            page = { ...page, textItems: ocrItems };
            pageRows = detectPageRows(ocrItems, 'auto', page.canvas);
          }
          if (pageRows.length === 0) {
            // Último recurso: detecção de linhas por projeção de pixels (rede de segurança já
            // existente, preservada mesmo quando o OCR falha ou não encontra nada).
            pageRows = detectRowsFromPixels(page.canvas);
          }
        }

        const startY = p === cropStartPage ? (cropStartPct / 100) * page.height : 0;
        const endY = p === cropEndPage ? (cropEndPct / 100) * page.height : page.height;
        const filtered = filterRowsInCropBand(pageRows, startY, endY);
        if (filtered.length === 0) continue;
        const extracted = extractPageRows(page, columns, filtered, startY, endY);
        allRows = [...allRows, ...extracted];
      }

      if (allRows.length === 0) {
        setError(
          'A extração automática (OCR local) não encontrou nenhuma linha aproveitável neste documento. Ajuste o alinhamento/colunas manualmente abaixo.',
        );
        setActiveTab('align');
        return;
      }
      setRows(isPlano ? applyPlanoTipoInferenceToRows(allRows) : allRows);
      setCropExplicitlyApplied(true);
      setActiveTab('results');
      setSuccess(
        `Extração automática concluída! ${allRows.length} linha(s) extraída(s) (leitura nativa + OCR local quando necessário).`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setActiveTab('align');
    } finally {
      setIsLocalExtracting(false);
    }
  }, [
    pdfPages,
    cropStartPage,
    cropEndPage,
    cropStartPct,
    cropEndPct,
    columns,
    detectPageRows,
    extractPageRows,
    isPlano,
    ensureTextItemsForPage,
  ]);

  useEffect(() => {
    if (engine !== 'local') return;
    if (isLoading || pdfPages.length === 0) return;
    if (localExtractStarted) return;
    setLocalExtractStarted(true);
    void runLocalAutoExtraction();
  }, [engine, isLoading, pdfPages, localExtractStarted, runLocalAutoExtraction]);

  const runAiExtraction = useCallback(async () => {
    setIsAiExtracting(true);
    setError(null);
    try {
      let allRows: GenericExtractedRow[] = [];
      let previousContext: string | undefined;
      let pagesFailed = 0;
      for (const page of pdfPages) {
        setAiProgressMsg(`Lendo página ${page.pageNumber}/${pdfPages.length} com IA...`);
        // Página com falha não pode derrubar as páginas seguintes que ainda
        // podem funcionar — "qualquer tipo de PDF" inclui páginas mistas
        // dentro do mesmo arquivo.
        let raw: Awaited<ReturnType<typeof extractRowsFromPageImage>>;
        try {
          const dataUrl = page.canvas.toDataURL('image/png');
          raw = await extractRowsFromPageImage(dataUrl, aiSettings, columnDefs, page.pageNumber, {
            isExtrato,
            previousContext,
          });
        } catch (pageErr) {
          pagesFailed += 1;
          console.warn(`[ai-extract] falha na página ${page.pageNumber}:`, pageErr);
          continue;
        }
        const mapped = aiRowsToGenericExtractedRows(raw, columnIds, page.pageNumber);
        if (mapped.length > 0) {
          const lastRow = mapped[mapped.length - 1]!;
          previousContext = columnIds.map((id) => lastRow.fields[id]).filter(Boolean).join(' ') || previousContext;
        }
        allRows = [...allRows, ...mapped];
      }
      if (allRows.length === 0) {
        const detalhe = pagesFailed > 0 ? ` (${pagesFailed} de ${pdfPages.length} página(s) falharam)` : '';
        setError(
          `A IA não encontrou nenhuma linha aproveitável neste PDF${detalhe}. Tente novamente ou use o recorte manual abaixo.`,
        );
        // Sem isso o usuário fica preso numa tela de "carregando" eterna: a IA
        // não achou nada, mas cropExplicitlyApplied continua false e
        // activeTab continua 'results' — a condição de loading nunca deixa de
        // ser verdadeira.
        setActiveTab('align');
        return;
      }
      setRows(isPlano ? applyPlanoTipoInferenceToRows(allRows) : allRows);
      setCropExplicitlyApplied(true);
      setActiveTab('results');
      setSuccess(
        pagesFailed > 0
          ? `${allRows.length} linha(s) extraída(s) pela IA (${pagesFailed} de ${pdfPages.length} página(s) falharam e foram ignoradas).`
          : `${allRows.length} linha(s) extraída(s) pela IA.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setActiveTab('align');
    } finally {
      setIsAiExtracting(false);
    }
  }, [pdfPages, aiSettings, columnDefs, columnIds, isExtrato, isPlano]);

  useEffect(() => {
    if (engine !== 'ia') return;
    if (isLoading || pdfPages.length === 0) return;
    if (aiExtractStarted) return;
    if (!aiKeyReady) return;
    setAiExtractStarted(true);
    void runAiExtraction();
  }, [engine, isLoading, pdfPages, aiExtractStarted, aiKeyReady, runAiExtraction]);

  const getFilteredRows = useCallback(
    () => filterRowsByExclusion(rows, columnDefs, exclusionRules),
    [rows, columnDefs, exclusionRules],
  );

  const buildReviewMeta = useCallback((): OcrConfirmMeta => {
    return {
      saldoAnterior: saldoAnterior > 0.0001 ? saldoAnterior : null,
      // Não envia saldo final “esperado” do PDF — OK usa só Anterior + C − D dos lançamentos.
    };
  }, [saldoAnterior]);

  const persistCurrentLayout = useCallback(() => {
    if (!bancoNome.trim()) {
      setError(
        isExtrato
          ? 'Informe o nome do banco antes de salvar o layout.'
          : 'Informe o nome do modelo antes de salvar o layout.',
      );
      return;
    }
    if (!companyName.trim()) {
      setError('Selecione uma empresa no módulo antes de salvar o layout.');
      return;
    }
    if (isExtrato && !contaBanco.trim()) {
      setError('Informe a conta contábil do banco antes de salvar o layout.');
      return;
    }
    const refPage = pdfPages[0];
    const contaSalva = layoutContaKey.trim() || dataType;
    if (!refPage) {
      if (isExtrato) {
        const saved = saveExtratoBancoParaImportacao(
          companyName,
          bancoNome.trim(),
          contaSalva,
        );
        setLayoutEditId(saved.id);
        setActiveExtratoOcrLayout(companyName, saved.id, 'extrato');
        refreshSavedLayouts();
        window.dispatchEvent(
          new CustomEvent('contabilfacil-extrato-banco-updated', {
            detail: {
              company: companyName,
              contaBanco: saved.contaBanco,
              bancoNome: saved.bancoNome,
            },
          }),
        );
        setSuccess(`Banco "${saved.bancoNome}" · conta ${saved.contaBanco} salvos.`);
        return;
      }
      const saved = saveExtratoOcrLayout(companyName, {
        id: layoutEditId ?? undefined,
        kind: dataType,
        bancoNome: bancoNome.trim(),
        contaBanco: dataType,
        ignoreLineWords: '',
        semDelimitacaoVertical: false,
        columns: [],
        columnsNorm: mappingToNorm(columns, columnIds),
        faixaStart: 0,
        faixaEnd: 1,
        faixaStartNorm: cropStartPct / 100,
        faixaEndNorm: cropEndPct / 100,
        faixaInicioMarcado: false,
        faixaFimMarcado: false,
        imgWidth: 1,
        imgHeight: 1,
      });
      setLayoutEditId(saved.id);
      setActiveExtratoOcrLayout(companyName, saved.id, dataType);
      refreshSavedLayouts();
      setSuccess(`Modelo "${saved.bancoNome}" salvo.`);
      return;
    }
    const imgW = refPage.width;
    const imgH = refPage.height;
    const faixaPorPagina = buildFaixaPorPagina(cropStartPct, cropEndPct, cropStartPage, cropEndPage, pdfPages.length);
    const saved = saveExtratoOcrLayout(companyName, {
      id: layoutEditId ?? undefined,
      kind: dataType,
      bancoNome: bancoNome.trim(),
      contaBanco: contaSalva,
      ignoreLineWords: isExtrato ? exclusionRules.join(', ') : '',
      semDelimitacaoVertical: false,
      columns: mappingToGenericColumns(columns, columnIds, imgW),
      columnsNorm: mappingToNorm(columns, columnIds),
      faixaStart: (cropStartPct / 100) * imgH,
      faixaEnd: (cropEndPct / 100) * imgH,
      faixaStartNorm: cropStartPct / 100,
      faixaEndNorm: cropEndPct / 100,
      faixaInicioMarcado: true,
      faixaFimMarcado: true,
      faixaPorPagina,
      faixaInicioPagina: cropStartPage,
      faixaFimPagina: cropEndPage,
      imgWidth: imgW,
      imgHeight: imgH,
    });
    setLayoutEditId(saved.id);
    setActiveExtratoOcrLayout(companyName, saved.id, dataType);
    refreshSavedLayouts();
    if (isExtrato) {
      window.dispatchEvent(
        new CustomEvent('contabilfacil-extrato-banco-updated', {
          detail: { company: companyName, contaBanco: saved.contaBanco, bancoNome: saved.bancoNome },
        }),
      );
      setSuccess(`Layout "${saved.bancoNome}" · conta ${saved.contaBanco} salvo.`);
    } else {
      setSuccess(`Modelo "${saved.bancoNome}" salvo.`);
    }
  }, [
    bancoNome,
    columnIds,
    columns,
    companyName,
    contaBanco,
    cropEndPage,
    cropEndPct,
    cropStartPage,
    cropStartPct,
    dataType,
    exclusionRules,
    isExtrato,
    layoutContaKey,
    layoutEditId,
    pdfPages,
    refreshSavedLayouts,
  ]);

  const applyLayout = useCallback(
    (layout: ExtratoOcrLayoutSaved) => {
      setBancoNome(layout.bancoNome);
      if (isExtrato) setContaBanco(layout.contaBanco || '');
      setLayoutEditId(layout.id);
      if (layout.columnsNorm?.length) {
        const restored = normToMapping(layout.columnsNorm);
        if (restored) setColumns(restored);
      }
      if (layout.faixaStartNorm != null) setCropStartPct(layout.faixaStartNorm * 100);
      if (layout.faixaEndNorm != null) setCropEndPct(layout.faixaEndNorm * 100);
      if (layout.faixaInicioPagina) setCropStartPage(layout.faixaInicioPagina);
      if (layout.faixaFimPagina) setCropEndPage(layout.faixaFimPagina);
      if (isExtrato && layout.ignoreLineWords?.trim()) {
        setExclusionRules(
          layout.ignoreLineWords
            .split(/[,;\n]+/)
            .map((s) => s.trim())
            .filter(Boolean),
        );
      }
      if (companyName.trim()) {
        setActiveExtratoOcrLayout(companyName, layout.id, dataType);
        if (isExtrato) {
          saveExtratoBancoParaImportacao(companyName, layout.bancoNome, layout.contaBanco);
        }
        window.dispatchEvent(
          new CustomEvent('contabilfacil-extrato-banco-updated', {
            detail: {
              company: companyName,
              contaBanco: layout.contaBanco,
              bancoNome: layout.bancoNome,
            },
          }),
        );
      }
      refreshSavedLayouts();
      setSuccess(
        isExtrato
          ? `Layout "${layout.bancoNome}" · conta ${layout.contaBanco} aplicado.`
          : `Modelo "${layout.bancoNome}" aplicado.`,
      );
    },
    [companyName, dataType, isExtrato, refreshSavedLayouts],
  );

  const handleSaldoAnteriorChange = useCallback(
    (value: number) => {
      setSaldoAnterior(value);
      if (saldoStorageKey) writePersistedLocalStorageJson(saldoStorageKey, String(value));
    },
    [saldoStorageKey],
  );

  const handleOk = () => {
    if (!cropExplicitlyApplied) {
      setError('Recorte as linhas antes de importar (use «Recortar página» ou «Recortar todas»).');
      return;
    }
    const filtered = getFilteredRows();
    if (filtered.length === 0) {
      setError(
        isExtrato
          ? 'Nenhuma linha válida para conciliação. Ajuste os recortes ou filtros.'
          : 'Nenhuma linha válida. Ajuste os recortes ou filtros.',
      );
      return;
    }
    if (isInstallments) {
      onConfirmParcelamento?.(mapGenericRowsToParcelamento(filtered));
      return;
    }
    if (isExtrato && companyName.trim() && bancoNome.trim() && contaBanco.trim()) {
      saveExtratoBancoParaImportacao(companyName, bancoNome, contaBanco);
    }
    onConfirm(
      mapGenericRowsToOcrRows(filtered, columnIds),
      isExtrato ? buildReviewMeta() : undefined,
    );
  };

  useEffect(() => {
    if (!success && !error) return;
    const t = setTimeout(() => {
      setSuccess(null);
      setError(null);
    }, 5000);
    return () => clearTimeout(t);
  }, [success, error]);

  const configSidebar = (
    <aside className="w-[280px] border-l border-brand-border bg-white flex flex-col shrink-0 h-full min-h-0 overflow-hidden">
      <div className="flex border-b border-brand-border shrink-0">
        <button
          type="button"
          onClick={() => setSideTab('config')}
          className={`flex-1 py-2 text-[9px] font-black uppercase ${sideTab === 'config' ? 'bg-brand-border text-white' : 'opacity-60'}`}
        >
          Parametrizar
        </button>
        <button
          type="button"
          onClick={() => {
            refreshSavedLayouts();
            setSideTab('layouts');
          }}
          className={`flex-1 py-2 text-[9px] font-black uppercase ${sideTab === 'layouts' ? 'bg-brand-border text-white' : 'opacity-60'}`}
        >
          Layouts salvos
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 overscroll-contain">
        {sideTab === 'config' ? (
          <>
            <section className="technical-panel p-3 space-y-2">
              <h3 className="text-[9px] font-black uppercase">
                {isExtrato ? 'Banco do extrato' : 'Modelo de importação'}
              </h3>
              <label className="block text-[9px] font-bold uppercase opacity-60">
                {isExtrato ? 'Nome do banco' : 'Nome do modelo'}
              </label>
              <input
                type="text"
                value={bancoNome}
                onChange={(e) => setBancoNome(e.target.value)}
                placeholder={isExtrato ? 'Ex: Itaú' : 'Ex: Plano de contas Polo Sul'}
                className="w-full border border-brand-border px-2 py-1.5 text-[10px]"
              />
              {isExtrato ? (
                <>
                  <label className="block text-[9px] font-bold uppercase opacity-60">
                    Conta contábil do banco
                  </label>
                  {planoContaOptions.length > 0 ? (
                    <ExtratoContaPicker
                      value={contaBanco}
                      onChange={setContaBanco}
                      options={planoContaOptions}
                      placeholder="Selecione a conta banco…"
                    />
                  ) : (
                    <input
                      type="text"
                      value={contaBanco}
                      onChange={(e) => setContaBanco(e.target.value)}
                      placeholder="Código da conta banco"
                      className="w-full border border-brand-border px-2 py-1.5 text-[10px] font-mono"
                    />
                  )}
                </>
              ) : (
                <p className="text-[8px] text-brand-text/55 leading-snug">
                  O modelo é identificado só pelo nome. As colunas e faixas de recorte são salvas junto.
                </p>
              )}
              <div className="pt-1">
                <label className="block text-[9px] font-bold uppercase opacity-60 mb-1">
                  Heurística de Sinais (D/C)
                </label>
                <select
                  value={valorSignHeuristic}
                  onChange={(e) => setValorSignHeuristic(e.target.value as any)}
                  className="w-full border border-brand-border bg-white px-2 py-1.5 text-[10px] outline-none"
                >
                  <option value="automatic">Automático (Texto: D/C, -/+)</option>
                  <option value="color_blue_c_red_d">Texto Azul é Crédito, Vermelho é Débito</option>
                  <option value="color_blue_d_red_c">Texto Azul é Débito, Vermelho é Crédito</option>
                </select>
              </div>
              <div className="pt-1">
                <label className="block text-[9px] font-bold uppercase opacity-60 mb-1">
                  Colunas ativas
                </label>
                <div className="space-y-1">
                  {allMappableCampoDefs.map((campo) => {
                    const ativo = !disabledCampoIds.has(campo.id);
                    return (
                      <label
                        key={campo.id}
                        className="flex items-center gap-2 text-[9px] font-bold uppercase cursor-pointer px-1.5 py-1 border border-brand-border/40 rounded"
                      >
                        <input
                          type="checkbox"
                          checked={ativo}
                          onChange={() => toggleCampoAtivo(campo.id)}
                        />
                        <span className={`inline-block w-2.5 h-2.5 rounded-sm shrink-0 ${campo.color}`} />
                        <span className={ativo ? '' : 'opacity-40 line-through'}>{campo.name}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-[8px] text-brand-text/50 leading-snug mt-1">
                  Desmarque as colunas que não usa neste documento — elas somem do recorte e do resultado.
                </p>
              </div>
              <button
                type="button"
                onClick={persistCurrentLayout}
                disabled={
                  !bancoNome.trim() ||
                  (isExtrato && (!companyName.trim() || !contaBanco.trim()))
                }
                className="technical-button w-full text-[9px] py-1.5 flex items-center justify-center gap-1 disabled:opacity-40"
              >
                <Save size={11} />
                {layoutEditId ? 'Atualizar layout' : 'Salvar novo layout'}
              </button>
            </section>
            <section className="technical-panel p-3 space-y-2">
              <h3 className="text-[9px] font-black uppercase">Modo de linhas</h3>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setRowMode('auto')}
                  className={`technical-button flex-1 py-1 text-[9px] ${rowMode === 'auto' ? 'bg-brand-border text-white' : ''}`}
                >
                  Automático
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      activeCanvas &&
                      rowMode !== 'manual' &&
                      gridStartY === 240 &&
                      gridRowHeight === 35 &&
                      gridRowCount === 12
                    ) {
                      // Primeira vez entrando em manual nesta página: parte de uma posição
                      // relativa à altura real da página, não do default fixo (240px).
                      setGridStartY(Math.round(activeCanvas.height * 0.25));
                      setGridRowHeight(Math.round(activeCanvas.height * 0.04) || 35);
                    }
                    setRowMode('manual');
                  }}
                  className={`technical-button flex-1 py-1 text-[9px] ${rowMode === 'manual' ? 'bg-brand-border text-white' : ''}`}
                >
                  Manual
                </button>
              </div>
              {rowMode === 'manual' && activeCanvas ? (
                <div className="space-y-3">
                  <GridManualControl
                    label="Início Y"
                    value={gridStartY}
                    min={0}
                    max={activeCanvas.height}
                    step={1}
                    onChange={setGridStartY}
                    ariaLabel="Início Y da grade manual"
                  />
                  <GridManualControl
                    label="Altura da linha"
                    value={gridRowHeight}
                    min={4}
                    max={120}
                    step={1}
                    onChange={setGridRowHeight}
                    ariaLabel="Altura da linha da grade manual"
                  />
                  <GridManualControl
                    label="Qtd. de linhas"
                    value={gridRowCount}
                    min={1}
                    max={80}
                    step={1}
                    onChange={setGridRowCount}
                    ariaLabel="Quantidade de linhas da grade manual"
                  />
                  {(() => {
                    const fimY = gridStartY + gridRowCount * gridRowHeight;
                    const excede = fimY > activeCanvas.height;
                    return (
                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-brand-border/30">
                        <p className={`text-[9px] font-bold font-mono ${excede ? 'text-rose-600' : 'opacity-60'}`}>
                          Fim Y: {fimY}px {excede ? `(excede a página em ${fimY - activeCanvas.height}px)` : `/ ${activeCanvas.height}px`}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            const disponivel = activeCanvas.height - gridStartY;
                            if (disponivel <= 0 || gridRowCount <= 0) return;
                            const novaAltura = Math.max(4, Math.round(disponivel / gridRowCount));
                            setGridRowHeight(novaAltura);
                          }}
                          className="technical-button text-[8px] py-1 px-2 shrink-0"
                          title="Recalcula a altura da linha para que a grade termine exatamente no fim da página"
                        >
                          Ajustar até o fim
                        </button>
                      </div>
                    );
                  })()}
                </div>
              ) : null}
            </section>
            {isExtrato ? (
              <p className="text-[9px] opacity-70 leading-relaxed">
                As regras de exclusão (SALDO ANTERIOR, etc.) ficam na aba Tabela. Após OK, os lançamentos vão
                direto para a conciliação.
              </p>
            ) : (
              <p className="text-[9px] opacity-70 leading-relaxed">
                Alinhe as colunas sobre o documento e recorte as linhas. Após OK, os dados serão importados diretamente.
              </p>
            )}
          </>
        ) : (
          <section className="technical-panel p-3 space-y-2">
            <h3 className="text-[9px] font-black uppercase flex items-center gap-1">
              <FolderOpen size={12} />
              Layouts salvos
            </h3>
            {!companyName.trim() ? (
              <p className="text-[9px] opacity-60">Selecione uma empresa para salvar layouts.</p>
            ) : savedLayouts.length === 0 ? (
              <p className="text-[9px] opacity-60 text-center py-4">Nenhum layout salvo.</p>
            ) : (
              <div className="space-y-2 max-h-[420px] overflow-y-auto">
                {savedLayouts.map((layout) => {
                  const isActive = getActiveExtratoOcrLayout(companyName, dataType)?.id === layout.id;
                  return (
                    <div
                      key={layout.id}
                      className={`border border-brand-border p-2 space-y-1 ${layoutEditId === layout.id || isActive ? 'bg-brand-sidebar/30' : ''}`}
                    >
                      <p className="text-[10px] font-black uppercase truncate">{layout.bancoNome}</p>
                      {isExtrato ? (
                        <p className="text-[9px] font-mono opacity-70">{layout.contaBanco}</p>
                      ) : null}
                      <div className="flex gap-1 pt-1">
                        <button
                          type="button"
                          className="technical-button text-[8px] py-0.5 px-2 flex-1"
                          onClick={() => {
                            applyLayout(layout);
                          }}
                        >
                          {isActive ? 'Reaplicar' : 'Usar'}
                        </button>
                        <button
                          type="button"
                          className="technical-button text-[8px] py-0.5 px-2"
                          aria-label={`Excluir layout ${layout.bancoNome}`}
                          onClick={() => {
                            deleteExtratoOcrLayout(companyName, layout.id);
                            refreshSavedLayouts();
                            if (layoutEditId === layout.id) setLayoutEditId(null);
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
        )}
      </div>
    </aside>
  );

  return (
    <div className="fixed inset-0 z-[120] bg-brand-bg text-brand-text flex flex-col">
      <header className="border-b border-brand-border bg-white px-4 py-3 flex items-center justify-between shrink-0">
        <div>
          <p className="text-[9px] uppercase font-black tracking-wider opacity-60">Leitor e recortador de documentos</p>
          <h2 className="text-sm font-black uppercase">{title}</h2>
          <p className="text-[9px] opacity-60 mt-0.5">{file.name}</p>
          {isDominioPlano && (
            <p className="text-[9px] font-bold uppercase text-amber-800 mt-1">
              Layout Domínio — classificação, reduzido, descrição e tipo detectados por linha
            </p>
          )}
          {isDominioBalancete && (
            <p className="text-[9px] font-bold uppercase text-amber-800 mt-1">
              Layout Domínio — data, histórico, conta, débito e crédito por lançamento
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] border border-green-600 bg-green-50 text-green-800 px-2 py-1 font-bold uppercase">
            {isDominioNativePdf || (isPlano && docType === 'pdf') || (isBalancete && docType === 'pdf')
              ? 'Texto nativo do PDF — sem OCR'
              : 'Recorte manual — sem OCR'}
          </span>
          <button type="button" onClick={onCancel} className="technical-button px-3 py-1 text-[10px]">
            Fechar
          </button>
        </div>
      </header>

      {(error || success) && (
        <div
          className={`mx-4 mt-2 border px-3 py-2 text-[10px] font-bold uppercase ${error ? 'border-red-400 bg-red-50 text-red-900' : 'border-green-500 bg-green-50 text-green-900'
            }`}
        >
          {error || success}
        </div>
      )}

      {isLoading ? (
        <div className="m-4 technical-panel px-4 py-3 text-xs font-bold uppercase">
          {ocrLoadingDetail || 'Carregando documento...'}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="px-4 pt-2 border-b border-brand-border bg-white flex gap-0 shrink-0">
            {engine === 'local' && (
              <button
                type="button"
                onClick={() => setActiveTab('align')}
                className={`px-4 py-2 text-[10px] font-black uppercase border border-brand-border flex items-center gap-1.5 ${activeTab === 'align' ? 'bg-brand-border text-white' : 'bg-white'
                  }`}
              >
                <Sliders size={12} />
                1. Alinhamento & colunas
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveTab('results')}
              className={`px-4 py-2 text-[10px] font-black uppercase border border-brand-border ${engine === 'local' ? 'border-l-0' : ''} flex items-center gap-1.5 ${activeTab === 'results' ? 'bg-brand-border text-white' : 'bg-white'
                }`}
            >
              <Columns size={12} />
              {engine === 'local' ? '2. ' : ''}Tabela de recortes ({rows.length})
            </button>
          </div>

          <main className="flex-1 min-h-0 flex overflow-hidden bg-brand-bg">
            {engine === 'ia' && !aiKeyReady ? (
              <AIKeyRequiredView />
            ) : engine === 'ia' && (isAiExtracting || (!cropExplicitlyApplied && activeTab === 'results')) ? (
              <AIExtractLoadingView progressMsg={aiProgressMsg} />
            ) : engine === 'local' && (isLocalExtracting || (!cropExplicitlyApplied && activeTab === 'results')) ? (
              <AIExtractLoadingView
                progressMsg={localProgressMsg}
                title="Extraindo automaticamente (OCR Local)..."
                fallbackMessage="Lendo o texto nativo do PDF e, quando necessário, rodando OCR local (Tesseract) nas páginas escaneadas."
              />
            ) : activeTab === 'align' ? (
              <div className="flex-1 min-h-0 flex overflow-hidden h-full">
                <div className="flex-1 min-h-0 h-full p-2 overflow-hidden flex flex-col">
                  <GenericLeitorWorkspace
                    canvasElement={activeCanvas}
                    columnDefs={columnDefs}
                    allColumnDefs={allColumnDefs}
                    columns={columns}
                    setColumns={setColumns}
                    detectedRowYs={detectedRows}
                    isProcessing={isProcessing}
                    onApplyCrop={handleApplyCrop}
                    onApplyCropAll={pdfPages.length > 1 ? handleApplyCropAll : undefined}
                    docType={docType}
                    cropStartPct={cropStartPct}
                    setCropStartPct={setCropStartPct}
                    cropEndPct={cropEndPct}
                    setCropEndPct={setCropEndPct}
                    pdfPages={pdfPages}
                    currentPage={currentPage}
                    onSelectPage={handlePageChange}
                    cropStartPage={cropStartPage}
                    setCropStartPage={setCropStartPage}
                    cropEndPage={cropEndPage}
                    setCropEndPage={setCropEndPage}
                    cropPreviewApplied={cropPreviewApplied}
                    onCropPreviewToggle={setCropPreviewApplied}
                  />
                </div>
                {configSidebar}
              </div>
            ) : (
              <div className="flex-1 min-h-0 flex overflow-hidden h-full">
                <div className="flex-1 min-h-0 h-full p-2 overflow-hidden flex flex-col">
                  <GenericLeitorTable
                    rows={rows}
                    setRows={setRows}
                    columnDefs={columnDefs}
                    exclusionRules={exclusionRules}
                    setExclusionRules={setExclusionRules}
                    fileName={file.name}
                    pdfPages={pdfPages}
                    filterStorageScope={`${companyName.trim()}_${dataType}`}
                  />
                </div>
                {configSidebar}
              </div>
            )}
          </main>
        </div>
      )}

      <footer className="border-t border-brand-border bg-white px-4 py-2.5 flex items-center justify-between shrink-0">
        <span className="text-[10px] font-bold uppercase opacity-70">
          {cropExplicitlyApplied
            ? `${rows.length} recorte(s) — motor: ${engine === 'ia' ? 'IA (Gemini)' : 'texto nativo + OCR local'}`
            : engine === 'ia'
              ? 'Aguardando extração pela IA...'
              : 'Extraindo automaticamente (OCR local)...'}
        </span>
        <div className="flex gap-2">
          <button type="button" className="technical-button px-4 py-2 text-[10px]" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className="technical-button-primary px-4 py-2 text-[10px] disabled:opacity-40"
            onClick={handleOk}
            disabled={rows.length === 0 || isLoading || !cropExplicitlyApplied}
            title={
              !cropExplicitlyApplied
                ? 'Recorte as linhas do documento antes de importar'
                : undefined
            }
          >
            {isExtrato ? 'OK — Ir para conciliação' : confirmLabel}
          </button>
        </div>
      </footer>
    </div>
  );
}
