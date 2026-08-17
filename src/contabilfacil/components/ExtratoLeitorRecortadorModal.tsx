/**
 * Leitor e recortador de extratos — port fiel do software em leitor-e-recortador-de-extratos.
 * Visual: cores e bordas quadradas do ContábilFácil (sem alterar layout/dimensões).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Sliders,
  Columns,
  FileSpreadsheet,
  ShieldAlert,
  CheckCircle2,
  Save,
  FolderOpen,
  Trash2,
  RefreshCw,
  Download,
  FileText,
} from 'lucide-react';
import type { GenericOcrRow } from '../../lib/parcelamentoColunasExtract';
import {
  analyzeValueString,
  consolidateTransactionRows,
  detectRowsFromPixels,
  detectRowsFromText,
  clearExtractedRowPrunePrefs,
  extractDataFromCanvas,
  filterRowsInCropBand,
  loadExtractedRowPrunePrefs,
  pruneExtractedRows,
  propagateExtractedRowDates,
} from '../../lib/leitorRecortador/cropper';
import type { AIVisionSettings } from '../../lib/leitorRecortador/aiVision/types';
import { loadAIVisionSettings } from '../../lib/leitorRecortador/aiVision/aiVisionModels';
import { extractRowsFromPageImage } from '../../lib/leitorRecortador/aiVision/aiVisionExtract';
import { AIExtractLoadingView } from './leitorRecortador/AIExtractLoadingView';
import { AIKeyRequiredView } from './leitorRecortador/AIKeyRequiredView';
import { exportToCSV } from '../../lib/leitorRecortador/exporter';
import {
  buildFaixaPorPagina,
  leitorColumnsToGenericColumns,
  leitorColumnsToNorm,
  normColumnsToLeitorColumns,
} from '../../lib/leitorRecortador/layoutBridge';
import { exportExtractedRowsToOfx } from '../../lib/leitorRecortador/ofxExport';
import { loadPdfPagesProgressive, parseAndRenderImage } from '../../lib/leitorRecortador/pdfParser';
import { ocrCanvasToTextItems } from '../../lib/leitorRecortador/localOcrEngine';
import {
  detectNubankTransactionRows,
  extractNubankDataFromCanvas,
  getNubankLastDayDate,
  getNubankLastDateAnchor,
  getNubankLastFlowSign,
  isNubankExtratoLayout,
  pdfTextItemsToPosicionado,
  suggestNubankExtratoPageLayout,
} from '../../lib/leitorRecortador/nubankExtratoLayout';
import type { DocMetadata, DocumentColumns, ExtractedRow, OcrConfirmMeta } from '../../lib/leitorRecortador/types';
import { mapExtractedRowsToRecorteFielOcr } from '../logic/extratoRecorteFielImport';
import { flushPersistenceAfterCriticalWrite } from '../logic/eyeVisionPersistenceFlush';
import { extractStatementYear } from '../../extratoVision/utils/parser';
import {
  clearActiveExtratoOcrLayout,
  deleteExtratoOcrLayout,
  getActiveExtratoOcrLayout,
  listExtratoOcrLayouts,
  saveExtratoBancoParaImportacao,
  saveExtratoOcrLayout,
  type ExtratoOcrLayoutSaved,
} from '../logic/extratoOcrLayoutStorage';
import ExtratoContaPicker, { type ExtratoPlanoContaOption } from './ExtratoContaPicker';
import { GridManualControl } from './leitorRecortador/GridManualControl';

function resolveExtratoYearFromContext(
  textItems: { text: string }[],
  fileName: string,
  extraTextItems: { text: string }[] = [],
): string {
  const blob = [fileName, ...textItems.map((t) => t.text), ...extraTextItems.map((t) => t.text)].join(' ');
  return extractStatementYear(blob) || String(new Date().getFullYear());
}

function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

import { LeitorRecortadorTable } from './leitorRecortador/LeitorRecortadorTable';
import { LeitorRecortadorUploader } from './leitorRecortador/LeitorRecortadorUploader';
import { LeitorRecortadorWorkspace } from './leitorRecortador/LeitorRecortadorWorkspace';

type Props = {
  file: File;
  title: string;
  companyName?: string;
  planoContaOptions?: ExtratoPlanoContaOption[];
  /** 'local' (padrão): alinhamento/recorte manual. 'ia': sem alinhamento — extrai direto via IA
   * (Gemini) e cai na mesma tela de resultados. */
  engine?: 'local' | 'ia';
  onCancel: () => void;
  onConfirm: (rows: GenericOcrRow[], meta?: any) => void;
};


export function ExtratoLeitorRecortadorModal({
  file,
  title,
  companyName = '',
  planoContaOptions = [],
  engine = 'local',
  onCancel,
  onConfirm,
}: Props) {
  const [activeCanvas, setActiveCanvas] = useState<HTMLCanvasElement | null>(null);
  const [metadata, setMetadata] = useState<DocMetadata | null>(null);
  const [textItems, setTextItems] = useState<import('../../lib/leitorRecortador/types').PDFTextItem[]>([]);
  const [pdfPages, setPdfPages] = useState<
    { pageNumber: number; canvas: HTMLCanvasElement; textItems: typeof textItems; width: number; height: number }[]
  >([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [cropStartPct, setCropStartPct] = useState(10);
  const [cropEndPct, setCropEndPct] = useState(90);
  const [cropStartPage, setCropStartPage] = useState(1);
  const [cropEndPage, setCropEndPage] = useState(1);
  const [columns, setColumns] = useState<DocumentColumns>({
    date: { startX: 5, width: 15 },
    history: { startX: 22, width: 48 },
    value: { startX: 72, width: 23 },
  });
  const [detectedRows, setDetectedRows] = useState<{ y: number; height: number }[]>([]);
  const [rows, setRows] = useState<ExtractedRow[]>([]);
  const [valorSignHeuristic, setValorSignHeuristic] = useState<'automatic' | 'color_blue_c_red_d' | 'color_blue_d_red_c'>('automatic');
  // Nunca preenchido automaticamente — o usuário cadastra e, se quiser, salva para reutilizar.
  const [exclusionRules, setExclusionRules] = useState<string[]>([]);
  const [cleanupRules, setCleanupRules] = useState<string[]>([]);
  // Tanto o engine 'ia' quanto o 'local' agora extraem automaticamente ao carregar o arquivo —
  // a tela de alinhamento/grade manual (align) deixou de ser o passo obrigatório inicial e virou
  // uma correção/fallback (acessível pelo botão "Ajustar Alinhamento & Colunas" na aba de
  // resultados, ou automaticamente quando a extração automática falha/acha poucas linhas).
  const [activeTab, setActiveTab] = useState<'align' | 'results'>('results');
  const [aiSettings] = useState<AIVisionSettings>(() => loadAIVisionSettings());
  const aiKeyReady = !!aiSettings.apiKey.trim() && !!aiSettings.validated;
  const [isAiExtracting, setIsAiExtracting] = useState(false);
  const [aiProgressMsg, setAiProgressMsg] = useState('');
  const [aiExtractStarted, setAiExtractStarted] = useState(false);
  const [aiHasResults, setAiHasResults] = useState(false);
  // Estado equivalente ao do engine 'ia' acima, para o pipeline automático do engine 'local'
  // (leitura nativa do PDF.js + bucketing de coluna + fallback de OCR Tesseract por página).
  const [isLocalExtracting, setIsLocalExtracting] = useState(false);
  const [localProgressMsg, setLocalProgressMsg] = useState('');
  const [localExtractStarted, setLocalExtractStarted] = useState(false);
  const [localHasResults, setLocalHasResults] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [cropPreviewApplied, setCropPreviewApplied] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [bancoNome, setBancoNome] = useState('');
  const [contaBanco, setContaBanco] = useState('');
  const [layoutEditId, setLayoutEditId] = useState<string | null>(null);
  const [savedLayouts, setSavedLayouts] = useState<ExtratoOcrLayoutSaved[]>([]);
  const [sideTab, setSideTab] = useState<'config' | 'layouts'>('config');
  const isNubankLayoutRef = useRef(false);
  const documentIsNubankRef = useRef(false);
  const loadedFileKeyRef = useRef('');
  // Ref (não dep) para a consolidação de linhas 2-em-1 ler as colunas atuais
  // sem recriar o callback de auto-layout (evita loop com o caminho Nubank).
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const pruneStorageKey = `${companyName.trim()}::${file.name}`;

  const activeExtratoLayout = companyName.trim() ? getActiveExtratoOcrLayout(companyName) : null;

  const applyPersistedPrune = useCallback(
    (extracted: ExtractedRow[]) =>
      pruneExtractedRows(extracted, loadExtractedRowPrunePrefs(pruneStorageKey)),
    [pruneStorageKey],
  );

  const cleanHistoryText = useCallback((history: string, rules: string[]) => {
    let clean = history || '';
    rules.forEach((rule) => {
      const trimmed = rule.trim();
      if (!trimmed) return;
      
      // Cria um pattern que match INDEPENDENTE de maiúsculas/acentos
      // Normalizamos a regra e criamos regex que procura por ela no texto normalizado
      const normalized = normalizeTextForMatching(trimmed);
      
      // Dividir em palavras para identificar limites de palavra
      let regexStr = escapeRegExp(normalized);
      if (/^[a-zA-Z0-9]+$/.test(normalized)) {
        regexStr = '\\b' + regexStr + '\\b';
      }
      
      // Aplicar regex na versão normalizada para encontrar onde está
      const normalizedClean = normalizeTextForMatching(clean);
      const matchIdx = normalizedClean.search(new RegExp(regexStr, 'i'));
      
      if (matchIdx >= 0) {
        // Encontrou na versão normalizada, agora remover do original
        // Matching palavra por palavra
        const cleanWords = clean.split(/\s+/);
        const normalizedWords = normalizedClean.split(/\s+/);
        const ruleWords = normalized.split(/\s+/).filter(Boolean);
        
        if (ruleWords.length > 0) {
          // Procura pela sequência de palavras
          for (let i = 0; i <= normalizedWords.length - ruleWords.length; i++) {
            const segment = normalizedWords.slice(i, i + ruleWords.length).join(' ');
            if (segment === ruleWords.join(' ')) {
              cleanWords.splice(i, ruleWords.length);
              clean = cleanWords.join(' ');
              break;
            }
          }
        }
      }
    });
    return clean.replace(/\s+/g, ' ').trim();
  }, []);

  const getCleanedAndFilteredRows = useCallback(() => {
    const cleaned = rows.map((row) => ({
      ...row,
      historyText: cleanHistoryText(row.historyText, cleanupRules),
    }));

    if (exclusionRules.length === 0) return cleaned;

    return cleaned.filter((row) => {
      const historyNormalized = normalizeTextForMatching(row.historyText || '');
      return !exclusionRules.some((rule) => {
        const trimmed = rule.trim();
        if (!trimmed) return false;
        const ruleNormalized = normalizeTextForMatching(trimmed);
        if (!ruleNormalized) return false;

        // Regra com múltiplas palavras: basta o histórico CONTER a frase
        // (ex.: "SALDO ANTERIOR" também exclui "SALDO ANTERIOR RESUMO",
        // "SALDO ANTERIOR DIA 05", etc. — nunca só igualdade exata).
        if (ruleNormalized.includes(' ')) {
          return historyNormalized.includes(ruleNormalized);
        }

        // Regra de palavra única: busca parcial (substring já normalizada)
        return historyNormalized.includes(ruleNormalized);
      });
    });
  }, [rows, cleanupRules, exclusionRules, cleanHistoryText]);

  const refreshSavedLayouts = useCallback(() => {
    if (!companyName.trim()) {
      setSavedLayouts([]);
      return;
    }
    setSavedLayouts(listExtratoOcrLayouts(companyName, 'extrato'));
  }, [companyName]);

  const handleClearActiveLayout = useCallback(() => {
    if (!companyName.trim()) return;
    clearActiveExtratoOcrLayout(companyName);
    setLayoutEditId(null);
    setBancoNome('');
    setContaBanco('');
    refreshSavedLayouts();
    setSuccessMessage('Layout ativo de extrato limpo. Refaça a seleção de banco/conta.');
  }, [companyName, refreshSavedLayouts]);

  const applyAutoLayoutForPage = useCallback(
    (
      page: {
        pageNumber: number;
        textItems: import('../../lib/leitorRecortador/types').PDFTextItem[];
        width: number;
        height: number;
        canvas?: HTMLCanvasElement;
      },
      options?: { setBancoIfEmpty?: boolean },
    ) => {
      const pos = pdfTextItemsToPosicionado(page.textItems);
      const isNu =
        documentIsNubankRef.current ||
        isNubankExtratoLayout(pos, page.width, { documentIsNubank: documentIsNubankRef.current });
      if (isNu) documentIsNubankRef.current = true;
      isNubankLayoutRef.current = isNu;

      const isCaixa =
        page.textItems.some((item) => /saldo\s+pr[oó]prio/i.test(item.text)) &&
        page.textItems.some((item) => /limite\s+contratado/i.test(item.text));

      let activeCols = columnsRef.current;
      if (isCaixa) {
        const caixaCols = {
          date: { startX: 4, width: 11.5 },
          history: { startX: 16, width: 51.5 },
          value: { startX: 68.0, width: 19.0 },
        };
        setColumns(caixaCols);
        activeCols = caixaCols;
        if (options?.setBancoIfEmpty) {
          setBancoNome((prev) => prev.trim() || 'CAIXA');
        }
      }

      if (!isNu) {
        const parsedRows = detectRowsFromText(page.textItems, 10);
        if (parsedRows.length > 0) {
          // Extratos 2-linhas-por-lançamento (ex.: BB): a continuação (hora +
          // contraparte, sem data nem valor) é fundida na faixa do lançamento —
          // o recorte sai exatamente como o lançamento aparece no PDF.
          setDetectedRows(
            consolidateTransactionRows(parsedRows, page.width, activeCols),
          );
          return;
        }
        // Sem texto nativo (PDF escaneado/foto): detecta linhas pela IMAGEM —
        // projeção de pixels acha as faixas de texto exatamente onde estão.
        const pixelRows = page.canvas ? detectRowsFromPixels(page.canvas) : [];
        setDetectedRows(pixelRows);
        setSuccessMessage(
          `PDF escaneado/foto: ${pixelRows.length} linhas detectadas automaticamente pela imagem.`,
        );
        return;
      }

      const layout = suggestNubankExtratoPageLayout(pos, page.width, page.height, page.pageNumber);
      setColumns(layout.columns);
      setCropStartPct(layout.faixaStartPct);
      setCropEndPct(layout.faixaEndPct);
      // Filtros de exclusão nunca são preenchidos automaticamente — nem para layouts
      // reconhecidos (ex.: Nubank). O usuário cadastra manualmente o que precisar.
      if (options?.setBancoIfEmpty) {
        setBancoNome((prev) => prev.trim() || 'NUBANK');
      }
      setDetectedRows(
        detectNubankTransactionRows(page.textItems, page.width, page.height, page.pageNumber),
      );
    },
    [],
  );

  useEffect(() => {
    refreshSavedLayouts();
    // IMPORTANTE: nunca herda automaticamente o banco/conta "ativo" de uma
    // importação anterior. Herdar isso silenciosamente foi a causa raiz de
    // extratos de um banco (ex.: conta 9) serem salvos com o rótulo de outro
    // banco (ex.: conta 8), porque o campo ficava com o valor antigo sem o
    // usuário perceber. Cada novo arquivo começa em branco — o usuário
    // escolhe explicitamente o banco/conta (digitando ou usando "Layouts
    // salvos"), o que é a única fonte confiável de qual banco é este extrato.
    setBancoNome('');
    setContaBanco('');
    setLayoutEditId(null);
    setCleanupRules([]);
  }, [companyName, refreshSavedLayouts]);

  // Rede de segurança: sempre que o documento carregado muda, garante que
  // cropStartPage/cropEndPage nunca apontem para uma página que não existe
  // (ex.: resquício de um layout salvo de um extrato antigo com mais páginas).
  // Sem isso a linha delimitadora de fim nunca "bate" com currentPage e some.
  useEffect(() => {
    const totalPagesAtual = metadata?.totalPages || pdfPages.length;
    if (!totalPagesAtual) return;
    setCropStartPage((prev) => Math.min(Math.max(1, prev), totalPagesAtual));
    setCropEndPage((prev) => Math.min(Math.max(1, prev), totalPagesAtual));
  }, [metadata, pdfPages.length]);

  useEffect(() => {
    if (activeCanvas) {
      applyAutoLayoutForPage({
        pageNumber: currentPage,
        textItems,
        width: activeCanvas.width,
        height: activeCanvas.height,
        canvas: activeCanvas,
      });
    }
  }, [textItems, activeCanvas, currentPage, applyAutoLayoutForPage]);

  const handleFileLoaded = useCallback(async (loadedFile: File) => {
    setIsProcessing(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setRows([]);
    // Engine 'local': cai direto na tela de resultados (mesma forma da 'ia'), a extração
    // automática dispara sozinha assim que todas as páginas terminarem de carregar (efeito
    // abaixo). A aba 'align' só é usada se essa extração automática falhar ou achar poucas
    // linhas — nesse caso o próprio runLocalAutoExtraction chama setActiveTab('align').
    if (engine === 'ia') {
      setActiveTab('results');
    } else {
      setActiveTab('align');
    }
    setLocalExtractStarted(false);
    setLocalHasResults(false);
    setIsLocalExtracting(false);
    setLocalProgressMsg('');
    setCropPreviewApplied(false);
    setCropStartPct(10);
    setCropEndPct(90);
    documentIsNubankRef.current = false;
    isNubankLayoutRef.current = false;
    // IMPORTANTE: cada NOVO arquivo carregado (mesmo sem fechar o modal) exige
    // que o usuário confirme explicitamente o banco/conta deste extrato.
    // Sem isso, carregar um 2º arquivo de um banco diferente sem fechar o
    // modal herdava o "Nome do banco"/"Conta" do arquivo anterior, salvando o
    // conteúdo do banco novo com o rótulo do banco errado.
    setBancoNome('');
    setContaBanco('');
    setLayoutEditId(null);

    try {
      if (loadedFile.type === 'application/pdf' || loadedFile.name.toLowerCase().endsWith('.pdf')) {
        let totalPages = 1;
        await loadPdfPagesProgressive(loadedFile, {
          onReady: (firstPage, total) => {
            totalPages = total;
            setPdfPages([firstPage]);
            setCurrentPage(1);
            setCropStartPage(1);
            setCropEndPage(total);
            setActiveCanvas(firstPage.canvas);
            setTextItems(firstPage.textItems);
            setMetadata({
              name: loadedFile.name,
              type: 'pdf',
              pageNumber: 1,
              totalPages: total,
              width: firstPage.width,
              height: firstPage.height,
            });
            applyAutoLayoutForPage(firstPage, { setBancoIfEmpty: true });
            setSuccessMessage(`Página 1 de ${total} pronta. Carregando demais páginas em segundo plano…`);
            setIsProcessing(false);
          },
          onProgress: (pages, loaded, total) => {
            setPdfPages(pages);
            if (loaded === total) {
              setSuccessMessage(`PDF carregado com sucesso! ${total} páginas disponíveis.`);
            }
          },
        });
        if (totalPages === 0) throw new Error('Não foi possível carregar nenhuma página deste PDF.');
      } else {
        const page = await parseAndRenderImage(loadedFile);
        setActiveCanvas(page.canvas);
        setTextItems([]);
        setMetadata({
          name: loadedFile.name,
          type: 'image',
          pageNumber: 1,
          totalPages: 1,
          width: page.width,
          height: page.height,
        });
        setPdfPages([page]);
        setCurrentPage(1);
        setCropStartPage(1);
        setCropEndPage(1);
        setColumns({
          date: { startX: 5, width: 15 },
          history: { startX: 22, width: 48 },
          value: { startX: 72, width: 23 },
        });

        // Motor local (Tesseract) lê o texto da imagem — se achar palavras
        // suficientes, o resto do pipeline (colunas/linhas) funciona igual a
        // um PDF com texto nativo, em vez de só detecção por pixel (que não
        // lê o conteúdo, só acha onde tem linha).
        let ocrTextItems: typeof page.textItems = [];
        if (engine === 'local') {
          try {
            setSuccessMessage('Lendo imagem com OCR local…');
            ocrTextItems = await ocrCanvasToTextItems(page.canvas, (frac, msg) => {
              setSuccessMessage(msg || `OCR local ${Math.round(frac * 100)}%`);
            });
          } catch (ocrErr) {
            console.warn('[ExtratoLeitorRecortadorModal] OCR local falhou, usando detecção por pixels:', ocrErr);
          }
        }

        if (ocrTextItems.length >= 3) {
          page.textItems = ocrTextItems;
          setTextItems(ocrTextItems);
          setDetectedRows(
            detectRowsFromText(ocrTextItems, 10).map((r) => ({ y: r.y, height: r.height, items: r.items })),
          );
          setSuccessMessage(`Imagem lida por OCR local! ${ocrTextItems.length} palavra(s) reconhecida(s).`);
        } else {
          // Detecção automática pela imagem (projeção de pixels)
          const pixelRows = detectRowsFromPixels(page.canvas);
          setDetectedRows(pixelRows);
          setSuccessMessage(
            `Imagem carregada! ${pixelRows.length} linhas detectadas automaticamente pela imagem.`,
          );
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Erro ao carregar documento: ${msg}`);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  useEffect(() => {
    const key = `${file.name}|${file.size}|${file.lastModified}`;
    if (loadedFileKeyRef.current === key) return;
    loadedFileKeyRef.current = key;
    void handleFileLoaded(file);
  }, [file.name, file.size, file.lastModified, handleFileLoaded]);

  const handlePageChange = async (newPageNumber: number) => {
    const page = pdfPages.find((p) => p.pageNumber === newPageNumber);
    if (!page) return;
    setIsProcessing(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      setCurrentPage(newPageNumber);
      setActiveCanvas(page.canvas);
      setTextItems(page.textItems);
      setMetadata((prev) =>
        prev
          ? { ...prev, pageNumber: newPageNumber, width: page.width, height: page.height }
          : null,
      );
      applyAutoLayoutForPage(page);
      setSuccessMessage(`Visualizando página ${newPageNumber}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Erro ao carregar página do PDF: ${msg}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApplyCrop = () => {
    if (!activeCanvas || detectedRows.length === 0) {
      setErrorMessage('Nenhuma linha de transação detectada ou definida para recortar.');
      return;
    }
    setIsProcessing(true);
    setSuccessMessage(null);
    setErrorMessage(null);
    try {
      if (currentPage < cropStartPage || currentPage > cropEndPage) {
        setErrorMessage(
          `A página atual (${currentPage}) está fora do intervalo de recorte selecionado (Pág. ${cropStartPage} até Pág. ${cropEndPage}).`,
        );
        setIsProcessing(false);
        return;
      }
      const startY = currentPage === cropStartPage ? (cropStartPct / 100) * activeCanvas.height : 0;
      const endY = currentPage === cropEndPage ? (cropEndPct / 100) * activeCanvas.height : activeCanvas.height;
      const filteredRows = filterRowsInCropBand(detectedRows, startY, endY);
      if (filteredRows.length === 0) {
        setErrorMessage('Nenhuma linha de transação está localizada dentro dos limites de recorte da página atual.');
        setIsProcessing(false);
        return;
      }
      const stmtYear = resolveExtratoYearFromContext(textItems, file.name);
      let nubankCarryDate = '';
      let nubankCarryFlow: import('../../lib/leitorRecortador/nubankExtratoLayout').NubankFlowSign | null = null;
      let nubankCarryDateY = 0;
      let nubankCarryDateH = 0;
      if (isNubankLayoutRef.current && currentPage > 1) {
        for (let p = 1; p < currentPage; p++) {
          const prevPage = pdfPages.find((pp) => pp.pageNumber === p);
          if (!prevPage) continue;
          nubankCarryDate =
            getNubankLastDayDate(prevPage.textItems, prevPage.width, prevPage.height, p) ||
            nubankCarryDate;
          nubankCarryFlow =
            getNubankLastFlowSign(prevPage.textItems, prevPage.width, prevPage.height, p) ??
            nubankCarryFlow;
          const lastAnchor = getNubankLastDateAnchor(
            prevPage.textItems,
            prevPage.width,
            prevPage.height,
            p,
          );
          if (lastAnchor) {
            nubankCarryDate = lastAnchor.text;
            nubankCarryDateY = lastAnchor.y;
            nubankCarryDateH = lastAnchor.h;
          }
        }
      }
      const nubankRows = isNubankLayoutRef.current
        ? filterRowsInCropBand(
          detectNubankTransactionRows(
            textItems,
            activeCanvas.width,
            activeCanvas.height,
            currentPage,
            nubankCarryDate,
            nubankCarryFlow,
            nubankCarryDateY,
            nubankCarryDateH,
          ),
          startY,
          endY,
        )
        : null;
      const filteredForExtract = nubankRows ?? filteredRows;
      const extracted = applyPersistedPrune(
        propagateExtractedRowDates(
          isNubankLayoutRef.current && nubankRows
            ? extractNubankDataFromCanvas(
              activeCanvas,
              textItems,
              columns,
              nubankRows,
              stmtYear,
              currentPage,
            )
            : extractDataFromCanvas(activeCanvas, textItems, columns, filteredForExtract, true, startY, endY, { valorSignHeuristic }),
          stmtYear,
        ),
      );
      setRows(extracted);
      setActiveTab('results');
      setSuccessMessage(`Recorte concluído! ${extracted.length} transações extraídas com sucesso da página ${currentPage}.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Erro ao recortar colunas: ${msg}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApplyCropAll = () => {
    if (pdfPages.length === 0) return;
    setIsProcessing(true);
    setSuccessMessage(null);
    setErrorMessage(null);
    try {
      let allExtractedRows: ExtractedRow[] = [];
      let nubankCarryDate = '';
      let nubankCarryFlow: import('../../lib/leitorRecortador/nubankExtratoLayout').NubankFlowSign | null = null;
      let nubankCarryDateY = 0;
      let nubankCarryDateH = 0;
      pdfPages.forEach((page) => {
        const p = page.pageNumber;
        if (p < cropStartPage || p > cropEndPage) return;
        let pageRows: { y: number; height: number }[] = [];
        const pos = pdfTextItemsToPosicionado(page.textItems);
        const pageIsNu =
          documentIsNubankRef.current ||
          isNubankExtratoLayout(pos, page.width, { documentIsNubank: documentIsNubankRef.current });
        if (pageIsNu) documentIsNubankRef.current = true;
        pageRows = pageIsNu
          ? detectNubankTransactionRows(
            page.textItems,
            page.width,
            page.height,
            p,
            nubankCarryDate,
            nubankCarryFlow,
            nubankCarryDateY,
            nubankCarryDateH,
          )
          : consolidateTransactionRows(
              detectRowsFromText(page.textItems, 10),
              page.width,
              columns,
            );
        // Página sem texto nativo (escaneada): detecta linhas pela imagem.
        if (!pageIsNu && pageRows.length === 0) {
          pageRows = detectRowsFromPixels(page.canvas);
        }
        const startY = p === cropStartPage ? (cropStartPct / 100) * page.height : 0;
        const endY = p === cropEndPage ? (cropEndPct / 100) * page.height : page.height;
        const filteredRows = filterRowsInCropBand(pageRows, startY, endY);
        if (filteredRows.length > 0) {
          const stmtYearPage = resolveExtratoYearFromContext(page.textItems, file.name);
          const nubankPageRows = pageIsNu
            ? detectNubankTransactionRows(
              page.textItems,
              page.width,
              page.height,
              p,
              nubankCarryDate,
              nubankCarryFlow,
              nubankCarryDateY,
              nubankCarryDateH,
            ).filter((r) => filterRowsInCropBand([r], startY, endY).length > 0)
            : null;
          if (pageIsNu) {
            nubankCarryDate =
              getNubankLastDayDate(page.textItems, page.width, page.height, p) || nubankCarryDate;
            nubankCarryFlow =
              getNubankLastFlowSign(page.textItems, page.width, page.height, p) ?? nubankCarryFlow;
            const lastAnchor = getNubankLastDateAnchor(page.textItems, page.width, page.height, p);
            if (lastAnchor) {
              nubankCarryDate = lastAnchor.text;
              nubankCarryDateY = lastAnchor.y;
              nubankCarryDateH = lastAnchor.h;
            }
          }
          const extracted =
            pageIsNu && nubankPageRows
              ? extractNubankDataFromCanvas(
                page.canvas,
                page.textItems,
                columns,
                nubankPageRows,
                stmtYearPage,
                p,
              )
              : extractDataFromCanvas(page.canvas, page.textItems, columns, filteredRows, true, startY, endY, { valorSignHeuristic });
          allExtractedRows = [...allExtractedRows, ...extracted];
        }
      });
      if (allExtractedRows.length === 0) {
        setErrorMessage('Não foi possível extrair dados de nenhuma página utilizando as configurações atuais.');
        setIsProcessing(false);
        return;
      }
      const stmtYear = resolveExtratoYearFromContext(
        textItems,
        file.name,
        pdfPages.flatMap((p) => p.textItems),
      );
      setRows(applyPersistedPrune(propagateExtractedRowDates(allExtractedRows, stmtYear)));
      setActiveTab('results');
      setSuccessMessage(
        `Extração em lote concluída! ${allExtractedRows.length} transações extraídas com sucesso das páginas ${cropStartPage} a ${cropEndPage}.`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Erro ao recortar todas as páginas: ${msg}`);
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * Garante que a página tenha itens de texto utilizáveis antes do bucketing de coluna. Páginas
   * de PDF nativo já vêm com texto (pdfjs); páginas ESCANEADAS (foto/scan dentro de um PDF com
   * várias páginas) não têm — antes desta função, essas páginas caíam direto na detecção de
   * linhas por pixel (sem nenhum texto real, então a extração de data/histórico/valor saía
   * vazia). Agora, quando a página não tem texto nativo suficiente, rodamos o motor de OCR local
   * (Tesseract, `ocrCanvasToTextItems`) no canvas já renderizado da própria página e devolvemos
   * os itens reconhecidos no mesmo formato `PDFTextItem[]` usado pelo resto do pipeline — a
   * página escaneada passa a se comportar, para `detectRowsFromText`/`extractDataFromCanvas`,
   * como se tivesse texto nativo. O resultado é armazenado de volta no estado `pdfPages` para
   * não repetir o OCR se a mesma página for revisitada (ex.: reabrir a aba de alinhamento).
   */
  const ensureTextItemsForPage = useCallback(
    async (
      page: { pageNumber: number; canvas: HTMLCanvasElement; textItems: typeof textItems; width: number; height: number },
      onProgress?: (msg: string) => void,
    ): Promise<typeof textItems> => {
      if (page.textItems.length >= 5) return page.textItems;
      try {
        const ocrItems = await ocrCanvasToTextItems(page.canvas, (frac, msg) => {
          onProgress?.(
            msg || `OCR local página ${page.pageNumber}: ${Math.round(frac * 100)}%`,
          );
        });
        if (ocrItems.length > page.textItems.length) {
          setPdfPages((prev) =>
            prev.map((p) => (p.pageNumber === page.pageNumber ? { ...p, textItems: ocrItems } : p)),
          );
          return ocrItems;
        }
      } catch (ocrErr) {
        console.warn(
          `[ExtratoLeitorRecortadorModal] OCR local falhou na página ${page.pageNumber}, mantendo detecção por pixels:`,
          ocrErr,
        );
      }
      return page.textItems;
    },
    [],
  );

  /**
   * Pipeline automático do "OCR Local": roda a extração completa (leitura nativa do PDF.js →
   * detecção/consolidação de linhas → OCR Tesseract por página quando não há texto nativo →
   * bucketing de coluna → limpeza de valor/data/ruído) assim que o arquivo é carregado, sem
   * exigir que o usuário alinhe colunas manualmente primeiro — mesma forma de uso do engine
   * 'ia'. A grade manual (aba "Alinhamento & Colunas") continua disponível como correção: o
   * usuário pode abri-la a qualquer momento pelo botão "Ajustar Alinhamento & Colunas" na tela
   * de resultados, e ela também é para onde caímos automaticamente se esta extração falhar ou
   * achar poucas/nenhuma linha.
   */
  const runLocalAutoExtraction = useCallback(async () => {
    setIsLocalExtracting(true);
    setErrorMessage(null);
    try {
      let allExtractedRows: ExtractedRow[] = [];
      let nubankCarryDate = '';
      let nubankCarryFlow: import('../../lib/leitorRecortador/nubankExtratoLayout').NubankFlowSign | null = null;
      let nubankCarryDateY = 0;
      let nubankCarryDateH = 0;

      for (const originalPage of pdfPages) {
        const p = originalPage.pageNumber;
        if (p < cropStartPage || p > cropEndPage) continue;
        setLocalProgressMsg(`Processando página ${p}/${pdfPages.length}...`);

        let page = originalPage;
        const posNative = pdfTextItemsToPosicionado(page.textItems);
        let pageIsNu =
          documentIsNubankRef.current ||
          isNubankExtratoLayout(posNative, page.width, { documentIsNubank: documentIsNubankRef.current });

        let pageRows: { y: number; height: number }[] = pageIsNu
          ? detectNubankTransactionRows(
              page.textItems,
              page.width,
              page.height,
              p,
              nubankCarryDate,
              nubankCarryFlow,
              nubankCarryDateY,
              nubankCarryDateH,
            )
          : consolidateTransactionRows(detectRowsFromText(page.textItems, 10), page.width, columns);

        if (pageRows.length === 0) {
          // Página sem texto nativo suficiente (provável scan/foto dentro do PDF): tenta OCR
          // local antes de desistir para uma detecção puramente visual (pixels, sem conteúdo).
          const ocrItems = await ensureTextItemsForPage(page, setLocalProgressMsg);
          if (ocrItems !== page.textItems) {
            page = { ...page, textItems: ocrItems };
            const posOcr = pdfTextItemsToPosicionado(ocrItems);
            pageIsNu =
              documentIsNubankRef.current ||
              isNubankExtratoLayout(posOcr, page.width, { documentIsNubank: documentIsNubankRef.current });
            pageRows = pageIsNu
              ? detectNubankTransactionRows(
                  ocrItems,
                  page.width,
                  page.height,
                  p,
                  nubankCarryDate,
                  nubankCarryFlow,
                  nubankCarryDateY,
                  nubankCarryDateH,
                )
              : consolidateTransactionRows(detectRowsFromText(ocrItems, 10), page.width, columns);
          }
          if (pageRows.length === 0) {
            // Último recurso: detecção de linhas por projeção de pixels (rede de segurança
            // já existente no motor, preservada mesmo quando OCR falha ou não acha nada).
            pageRows = detectRowsFromPixels(page.canvas);
          }
        }
        if (pageIsNu) documentIsNubankRef.current = true;

        const startY = p === cropStartPage ? (cropStartPct / 100) * page.height : 0;
        const endY = p === cropEndPage ? (cropEndPct / 100) * page.height : page.height;
        const filteredRows = filterRowsInCropBand(pageRows, startY, endY);
        if (filteredRows.length > 0) {
          const stmtYearPage = resolveExtratoYearFromContext(page.textItems, file.name);
          const nubankPageRows = pageIsNu
            ? detectNubankTransactionRows(
                page.textItems,
                page.width,
                page.height,
                p,
                nubankCarryDate,
                nubankCarryFlow,
                nubankCarryDateY,
                nubankCarryDateH,
              ).filter((r) => filterRowsInCropBand([r], startY, endY).length > 0)
            : null;
          if (pageIsNu) {
            nubankCarryDate =
              getNubankLastDayDate(page.textItems, page.width, page.height, p) || nubankCarryDate;
            nubankCarryFlow =
              getNubankLastFlowSign(page.textItems, page.width, page.height, p) ?? nubankCarryFlow;
            const lastAnchor = getNubankLastDateAnchor(page.textItems, page.width, page.height, p);
            if (lastAnchor) {
              nubankCarryDate = lastAnchor.text;
              nubankCarryDateY = lastAnchor.y;
              nubankCarryDateH = lastAnchor.h;
            }
          }
          const extracted =
            pageIsNu && nubankPageRows
              ? extractNubankDataFromCanvas(
                  page.canvas,
                  page.textItems,
                  columns,
                  nubankPageRows,
                  stmtYearPage,
                  p,
                )
              : extractDataFromCanvas(page.canvas, page.textItems, columns, filteredRows, true, startY, endY, {
                  valorSignHeuristic,
                });
          allExtractedRows = [...allExtractedRows, ...extracted];
        }
      }

      if (allExtractedRows.length === 0) {
        setErrorMessage(
          'A extração automática (OCR local) não encontrou nenhuma transação neste documento. Ajuste o alinhamento/colunas manualmente abaixo.',
        );
        setActiveTab('align');
        return;
      }

      const stmtYear = resolveExtratoYearFromContext(
        textItems,
        file.name,
        pdfPages.flatMap((pg) => pg.textItems),
      );
      setRows(applyPersistedPrune(propagateExtractedRowDates(allExtractedRows, stmtYear)));
      setLocalHasResults(true);
      setActiveTab('results');
      setSuccessMessage(
        `Extração automática concluída! ${allExtractedRows.length} transação(ões) extraída(s) (leitura nativa + OCR local quando necessário).`,
      );
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
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
    valorSignHeuristic,
    applyPersistedPrune,
    textItems,
    file.name,
    ensureTextItemsForPage,
  ]);

  // Auto-extraction disabled on file load for local OCR engine.

  const runAiExtraction = useCallback(async () => {
    setIsAiExtracting(true);
    setErrorMessage(null);
    try {
      const columnDefs = [
        { id: 'data', name: 'Data (DD/MM/AAAA)' },
        { id: 'historico', name: 'Histórico / descrição do lançamento' },
        { id: 'valor', name: 'Valor — número no formato brasileiro, negativo se débito (ex: -123,45)' },
      ];
      let allRows: ExtractedRow[] = [];
      let previousContext: string | undefined;
      let pagesFailed = 0;
      for (const page of pdfPages) {
        setAiProgressMsg(`Lendo página ${page.pageNumber}/${pdfPages.length} com IA...`);
        // Página com falha (imagem ruim, timeout, resposta malformada) não pode
        // derrubar as páginas seguintes que ainda podem funcionar — "qualquer
        // tipo de PDF" inclui páginas mistas dentro do mesmo arquivo.
        let raw: Awaited<ReturnType<typeof extractRowsFromPageImage>>;
        try {
          const dataUrl = page.canvas.toDataURL('image/png');
          raw = await extractRowsFromPageImage(dataUrl, aiSettings, columnDefs, page.pageNumber, {
            isExtrato: true,
            previousContext,
          });
        } catch (pageErr) {
          pagesFailed += 1;
          console.warn(`[ai-extract] falha na página ${page.pageNumber}:`, pageErr);
          continue;
        }
        const mapped: ExtractedRow[] = raw
          .filter((r) => r && (r.data || r.historico))
          .map((r, idx) => {
            const valorText = String(r.valor ?? '').trim();
            const { isNegative, parsedValue } = analyzeValueString(valorText);
            return {
              id: `ai-p${page.pageNumber}-${idx}`,
              dateText: String(r.data ?? '').trim(),
              historyText: String(r.historico ?? '').trim(),
              valueText: valorText,
              dateCropUrl: '',
              historyCropUrl: '',
              valueCropUrl: '',
              isNegative,
              parsedValue,
              y: idx,
              height: 0,
              pageNumber: page.pageNumber,
            };
          });
        if (mapped.length > 0) previousContext = mapped[mapped.length - 1]!.dateText || previousContext;
        allRows = [...allRows, ...mapped];
      }
      if (allRows.length === 0) {
        const detalhe = pagesFailed > 0 ? ` (${pagesFailed} de ${pdfPages.length} página(s) falharam)` : '';
        setErrorMessage(
          `A IA não encontrou nenhuma linha aproveitável neste PDF${detalhe}. Tente novamente ou use o recorte manual abaixo.`,
        );
        // Sem isso o usuário fica preso numa tela de "carregando" eterna: a IA
        // não achou nada, mas activeTab continua 'results' e aiHasResults
        // continua false — a condição de loading nunca deixa de ser verdadeira.
        setActiveTab('align');
        return;
      }
      const stmtYear = resolveExtratoYearFromContext(textItems, file.name, pdfPages.flatMap((p) => p.textItems));
      setRows(applyPersistedPrune(propagateExtractedRowDates(allRows, stmtYear)));
      setAiHasResults(true);
      setActiveTab('results');
      setSuccessMessage(
        pagesFailed > 0
          ? `${allRows.length} linha(s) extraída(s) pela IA (${pagesFailed} de ${pdfPages.length} página(s) falharam e foram ignoradas).`
          : `${allRows.length} linha(s) extraída(s) pela IA.`,
      );
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setActiveTab('align');
    } finally {
      setIsAiExtracting(false);
    }
  }, [pdfPages, aiSettings, textItems, file.name, applyPersistedPrune]);

  useEffect(() => {
    if (engine !== 'ia') return;
    if (isProcessing || pdfPages.length === 0) return;
    if (aiExtractStarted) return;
    if (!aiKeyReady) return;
    setAiExtractStarted(true);
    void runAiExtraction();
  }, [engine, isProcessing, pdfPages, aiExtractStarted, aiKeyReady, runAiExtraction]);

  const handleExportCsv = () => {
    if (rows.length === 0) return;
    try {
      const filteredRows = getCleanedAndFilteredRows();
      exportToCSV(filteredRows, `recortes_${metadata?.name.split('.')[0] || 'extrato'}.csv`);
      setSuccessMessage('Arquivo CSV/Excel exportado com sucesso! Pronto para abrir no Excel.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Erro ao exportar dados: ${msg}`);
    }
  };

  const handleClearAll = () => {
    setRows([]);
    clearExtractedRowPrunePrefs(pruneStorageKey);
    setSuccessMessage('Tabela limpa com sucesso.');
  };

  const persistCurrentLayout = (asNew = false) => {
    if (!companyName.trim()) {
      setErrorMessage('Selecione uma empresa para salvar a configuração do extrato.');
      return;
    }
    if (!bancoNome.trim() || !contaBanco.trim()) {
      setErrorMessage('Informe o nome do banco e a conta contábil antes de salvar.');
      return;
    }
    const isUpdate = !asNew && !!layoutEditId;
    const targetLayoutId = asNew ? undefined : (layoutEditId ?? undefined);
    const existingLayout =
      layoutEditId && !asNew
        ? savedLayouts.find((layout) => layout.id === layoutEditId) ?? null
        : null;
    const refPage = pdfPages[0];
    // Sem documento: ainda salva banco + conta (necessário para a conciliação).
    if (!refPage) {
      const saved = saveExtratoOcrLayout(companyName, {
        id: targetLayoutId ?? existingLayout?.id,
        kind: 'extrato',
        bancoNome: bancoNome.trim(),
        contaBanco: contaBanco.trim(),
        ignoreLineWords: existingLayout?.ignoreLineWords ?? exclusionRules.join(', '),
        cleanupWords: existingLayout?.cleanupWords ?? cleanupRules.join(', '),
        semDelimitacaoVertical: existingLayout?.semDelimitacaoVertical ?? true,
        columns: existingLayout?.columns ?? [],
        columnsNorm: existingLayout?.columnsNorm,
        faixaStart: existingLayout?.faixaStart ?? 0,
        faixaEnd: existingLayout?.faixaEnd ?? 1,
        faixaStartNorm: existingLayout?.faixaStartNorm,
        faixaEndNorm: existingLayout?.faixaEndNorm,
        faixaInicioMarcado: existingLayout?.faixaInicioMarcado ?? false,
        faixaFimMarcado: existingLayout?.faixaFimMarcado ?? false,
        faixaPorPagina: existingLayout?.faixaPorPagina,
        faixaInicioPagina: existingLayout?.faixaInicioPagina,
        faixaFimPagina: existingLayout?.faixaFimPagina,
        imgWidth: existingLayout?.imgWidth ?? 1,
        imgHeight: existingLayout?.imgHeight ?? 1,
        valorSignHeuristic: valorSignHeuristic,
      });
      setLayoutEditId(saved.id);
      refreshSavedLayouts();
      window.dispatchEvent(
        new CustomEvent('contabilfacil-extrato-banco-updated', {
          detail: { company: companyName, contaBanco: saved.contaBanco, bancoNome: saved.bancoNome },
        }),
      );
      setSuccessMessage(
        isUpdate
          ? `Layout "${saved.bancoNome}" · conta ${saved.contaBanco} atualizado.`
          : `Novo layout "${saved.bancoNome}" · conta ${saved.contaBanco} salvo para a conciliação.`,
      );
      setSideTab('layouts');
      void flushPersistenceAfterCriticalWrite();
      return;
    }
    const imgW = refPage.width;
    const imgH = refPage.height;
    const faixaPorPagina = buildFaixaPorPagina(
      cropStartPct,
      cropEndPct,
      cropStartPage,
      cropEndPage,
      pdfPages.length,
    );
    const saved = saveExtratoOcrLayout(companyName, {
      id: targetLayoutId,
      kind: 'extrato',
      bancoNome: bancoNome.trim(),
      contaBanco: contaBanco.trim(),
      ignoreLineWords: exclusionRules.join(', '),
      cleanupWords: cleanupRules.join(', '),
      semDelimitacaoVertical: false,
      columns: leitorColumnsToGenericColumns(columns, imgW),
      columnsNorm: leitorColumnsToNorm(columns),
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
      valorSignHeuristic: valorSignHeuristic,
    });
    setLayoutEditId(saved.id);
    // Salvar/atualizar a configuração deste banco NÃO ativa ele na conciliação —
    // esse container serve só para guardar regras; o banco ativo só muda quando
    // o usuário confirma a importação (handleOkConciliacao).
    refreshSavedLayouts();
    window.dispatchEvent(
      new CustomEvent('contabilfacil-extrato-banco-updated', {
        detail: { company: companyName, contaBanco: saved.contaBanco, bancoNome: saved.bancoNome },
      }),
    );
    setSuccessMessage(
      isUpdate
        ? `Layout "${saved.bancoNome}" · conta ${saved.contaBanco} atualizado.`
        : `Novo layout "${saved.bancoNome}" · conta ${saved.contaBanco} salvo.`,
    );
    setSideTab('layouts');
    void flushPersistenceAfterCriticalWrite();
  };

  const applyLayout = (layout: ExtratoOcrLayoutSaved) => {
    setBancoNome(layout.bancoNome);
    setContaBanco(layout.contaBanco);
    setLayoutEditId(layout.id);
    if (layout.columnsNorm?.length) {
      const restored = normColumnsToLeitorColumns(layout.columnsNorm);
      if (restored) setColumns(restored);
    } else if (layout.columns?.length && layout.imgWidth > 0) {
      // Fallback: reconstrói % a partir das colunas em pixels salvas
      const restored = normColumnsToLeitorColumns(
        layout.columns.map((c) => ({
          id: c.id,
          startNorm: c.start / layout.imgWidth,
          endNorm: c.end / layout.imgWidth,
        })),
      );
      if (restored) setColumns(restored);
    }
    if (layout.faixaStartNorm != null) setCropStartPct(layout.faixaStartNorm * 100);
    if (layout.faixaEndNorm != null) setCropEndPct(layout.faixaEndNorm * 100);
    // Limita ao total real de páginas deste documento — um layout salvo de um
    // extrato antigo com mais páginas nunca pode apontar para uma página que
    // não existe aqui (senão o delimitador nunca "bate" com currentPage e some).
    const totalPagesAtual = metadata?.totalPages || pdfPages.length || 1;
    if (layout.faixaInicioPagina) setCropStartPage(Math.min(layout.faixaInicioPagina, totalPagesAtual));
    if (layout.faixaFimPagina) setCropEndPage(Math.min(layout.faixaFimPagina, totalPagesAtual));
    if (layout.ignoreLineWords?.trim()) {
      setExclusionRules(
        layout.ignoreLineWords
          .split(/[,;\n]+/)
          .map((s) => s.trim())
          .filter(Boolean),
      );
    }
    if (layout.cleanupWords?.trim()) {
      setCleanupRules(
        layout.cleanupWords
          .split(/[,;\n]+/)
          .map((s) => s.trim())
          .filter(Boolean),
      );
    } else {
      setCleanupRules([]);
    }
    if (layout.valorSignHeuristic) {
      setValorSignHeuristic(layout.valorSignHeuristic);
    }
    // Carregar este layout para EDITAR/USAR NA IMPORTAÇÃO ATUAL não muda o
    // banco ativo da conciliação — isso só acontece quando o usuário confirma
    // a importação (handleOkConciliacao → saveExtratoBancoParaImportacao).
    // Esta tela/layout serve apenas para configurar as regras deste banco.
    refreshSavedLayouts();
    setSideTab('config');
    setSuccessMessage(
      `Layout "${layout.bancoNome}" · conta ${layout.contaBanco} carregado nesta importação.`,
    );
  };

  const handleExportOfx = () => {
    const filteredRows = getCleanedAndFilteredRows();
    if (filteredRows.length === 0) {
      setErrorMessage('Nenhuma linha válida para exportar em OFX.');
      return;
    }
    const saldoRaw = localStorage.getItem('saldo_anterior');
    const saldoAnterior = saldoRaw ? parseFloat(saldoRaw) || 0 : 0;
    exportExtractedRowsToOfx({
      rows: filteredRows,
      fileName: metadata?.name || file.name,
      bancoNome: bancoNome || 'BANCO',
      contaBanco: contaBanco || '0000001',
      saldoAnterior,
    });
    setSuccessMessage('Arquivo OFX Money exportado com sucesso.');
  };

  const mapVisibleRowsToGeneric = (): GenericOcrRow[] => {
    const visibleRows = getCleanedAndFilteredRows();
    const stmtYear = resolveExtratoYearFromContext(
      textItems,
      file.name,
      pdfPages.flatMap((p) => p.textItems),
    );
    // Mesmos lançamentos/natureza do placar Entradas/Saídas → conciliação 1:1.
    return mapExtractedRowsToRecorteFielOcr(visibleRows, stmtYear);
  };

  const buildReviewMeta = (): OcrConfirmMeta => {
    const saldoRaw = localStorage.getItem('saldo_anterior');
    const saldoAnterior = saldoRaw ? parseFloat(saldoRaw) || 0 : 0;
    return {
      saldoAnterior: saldoAnterior > 0.0001 ? saldoAnterior : null,
      // Não envia saldo final “esperado” do PDF — OK usa só Anterior + C − D dos lançamentos.
    };
  };

  const handleOkConciliacao = () => {
    const mapped = mapVisibleRowsToGeneric();
    if (mapped.length === 0) {
      setErrorMessage('Nenhuma linha válida para conciliação. Ajuste os recortes ou filtros.');
      return;
    }
    // Nunca confirma sem o usuário ter escolhido explicitamente o banco/conta
    // deste extrato — evita que o conteúdo seja salvo sem identificação de
    // banco (ou, pior, com um banco errado herdado por engano).
    if (!bancoNome.trim() || !contaBanco.trim()) {
      setErrorMessage('Informe o Nome do banco e a Conta contábil do banco antes de confirmar.');
      setSideTab('config');
      return;
    }
    if (companyName.trim()) {
      saveExtratoBancoParaImportacao(companyName, bancoNome, contaBanco);
    }
    onConfirm(mapped, buildReviewMeta());
  };

  useEffect(() => {
    if (!successMessage && !errorMessage) return;
    const timer = setTimeout(() => setSuccessMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [successMessage, errorMessage]);

  return (
    <div className="fixed inset-0 z-[120] bg-brand-bg font-sans text-brand-text flex flex-col antialiased overflow-hidden">
      <div className="fixed top-5 right-5 z-[130] flex flex-col gap-2.5 max-w-md w-full pointer-events-none">
        {successMessage && (
          <div className="flex items-start gap-3 bg-white border border-emerald-900/40 shadow-[2px_2px_0_0_#141414] p-4 text-emerald-700 pointer-events-auto">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <div className="flex-1">
              <h5 className="font-bold text-xs text-brand-text">Sucesso</h5>
              <p className="text-[11px] text-brand-text/60 leading-normal mt-0.5">{successMessage}</p>
            </div>
          </div>
        )}
        {errorMessage && (
          <div className="flex items-start gap-3 bg-white border border-rose-900/40 shadow-[2px_2px_0_0_#141414] p-4 text-rose-700 pointer-events-auto">
            <ShieldAlert className="w-5 h-5 text-rose-600 flex-shrink-0" />
            <div className="flex-1">
              <h5 className="font-bold text-xs text-brand-text">Erro</h5>
              <p className="text-[11px] text-brand-text/60 leading-normal mt-0.5">{errorMessage}</p>
            </div>
          </div>
        )}
      </div>

      <header className="bg-white border-b border-brand-border sticky top-0 z-40 shrink-0">
        <div className="px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-brand-text text-white flex items-center justify-center font-bold text-lg tracking-tight">
              E
            </div>
            <div>
              <h1 className="font-semibold text-brand-text text-base tracking-tight">{title}</h1>
              <p className="text-[9px] text-brand-text/50 font-medium">Extração por recorte visual — texto nativo do PDF</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] bg-brand-sidebar text-brand-text/60 font-mono px-2.5 py-1 border border-brand-border">
              {file.name}
            </span>
            <button type="button" onClick={onCancel} className="technical-button px-3 py-1.5 text-xs font-bold">
              Fechar
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto px-6 py-6 flex flex-col gap-6">
        {activeCanvas && (
          <div className="flex border-b border-brand-border gap-1 select-none mb-2 shrink-0">
            {engine === 'local' && (
              <button
                type="button"
                onClick={() => setActiveTab('align')}
                className={`px-6 py-3.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 ${activeTab === 'align'
                  ? 'border-brand-text text-brand-text bg-brand-sidebar/40'
                  : 'border-transparent text-brand-text/50 hover:text-brand-text/80 hover:bg-brand-sidebar/10'
                  }`}
              >
                <Sliders className="w-4 h-4 text-brand-text" />
                1. Alinhamento & Colunas (Ver PDF)
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveTab('results')}
              className={`px-6 py-3.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 ${activeTab === 'results'
                ? 'border-brand-text text-brand-text bg-brand-sidebar/40'
                : 'border-transparent text-brand-text/50 hover:text-brand-text/80 hover:bg-brand-sidebar/10'
                }`}
            >
              <FileSpreadsheet className="w-4 h-4 text-brand-text" />
              {engine === 'local' ? '2. ' : ''}Tabela de Resultados
              {rows.length > 0 && (
                <span className="bg-brand-text text-white text-[10px] font-black px-1.5 py-0.5 ml-1">
                  {rows.length}
                </span>
              )}
            </button>
          </div>
        )}

        {engine === 'ia' && activeCanvas && !aiKeyReady ? (
          <AIKeyRequiredView />
        ) : engine === 'ia' && activeCanvas && (isAiExtracting || (!aiHasResults && activeTab === 'results')) ? (
          <AIExtractLoadingView progressMsg={aiProgressMsg} />
        ) : engine === 'local' && activeCanvas && (isLocalExtracting || (!localHasResults && activeTab === 'results')) ? (
          <AIExtractLoadingView
            progressMsg={localProgressMsg}
            title="Extraindo automaticamente (OCR Local)..."
            fallbackMessage="Lendo o texto nativo do PDF e, quando necessário, rodando OCR local (Tesseract) nas páginas escaneadas."
          />
        ) : !activeCanvas ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
            <div className="md:col-span-1 technical-panel p-6 shadow-[2px_2px_0_0_#141414]">
              <h3 className="text-xs font-bold text-brand-text/60 uppercase tracking-wider mb-4">Carregando…</h3>
              <p className="text-sm text-brand-text/60">Processando {file.name}</p>
            </div>
          </div>
        ) : activeTab === 'align' ? (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 items-start">
            <div className="lg:col-span-1 flex flex-col gap-6">
              <div className="technical-panel p-5 shadow-[2px_2px_0_0_#141414]">
                <h3 className="text-xs font-bold text-brand-text/60 uppercase tracking-wider mb-3">1. Importar Arquivo</h3>
                <LeitorRecortadorUploader
                  onFileLoaded={handleFileLoaded}
                  metadata={metadata}
                  isProcessing={isProcessing}
                  onPageChange={handlePageChange}
                />
              </div>

              <div className="technical-panel shadow-[2px_2px_0_0_#141414] overflow-y-auto flex flex-col">
                <div className="flex border-b border-brand-border">
                  <button
                    type="button"
                    onClick={() => setSideTab('config')}
                    className={`flex-1 py-2.5 text-[9px] font-black uppercase tracking-wider border-b-2 transition-all ${sideTab === 'config'
                      ? 'border-brand-text text-brand-text bg-brand-sidebar/40'
                      : 'border-transparent text-brand-text/50 hover:text-brand-text/80'
                      }`}
                  >
                    Configuração
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      refreshSavedLayouts();
                      setSideTab('layouts');
                    }}
                    className={`flex-1 py-2.5 text-[9px] font-black uppercase tracking-wider border-b-2 transition-all ${sideTab === 'layouts'
                      ? 'border-brand-text text-brand-text bg-brand-sidebar/40'
                      : 'border-transparent text-brand-text/50 hover:text-brand-text/80'
                      }`}
                  >
                    Layouts salvos
                  </button>
                </div>

                <div className="p-5 flex flex-col gap-5">
                  {sideTab === 'config' ? (
                    <>
                      <section className="flex flex-col gap-3">
                        <h3 className="text-xs font-bold text-brand-text/60 uppercase tracking-wider">Banco do extrato</h3>
                        <div>
                          <label
                            htmlFor="extrato-banco-nome"
                            className="block text-[10px] font-bold uppercase text-brand-text/60 mb-1"
                          >
                            Nome do banco
                          </label>
                          <input
                            id="extrato-banco-nome"
                            type="text"
                            value={bancoNome}
                            onChange={(e) => setBancoNome(e.target.value)}
                            placeholder="Ex: Itaú"
                            title="Nome do banco do extrato"
                            aria-label="Nome do banco do extrato"
                            className="w-full border border-brand-border bg-white px-2.5 py-1.5 text-xs text-brand-text outline-none focus:border-brand-text"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="extrato-conta-banco"
                            className="block text-[10px] font-bold uppercase text-brand-text/60 mb-1"
                          >
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
                              id="extrato-conta-banco"
                              type="text"
                              value={contaBanco}
                              onChange={(e) => setContaBanco(e.target.value)}
                              placeholder="Código da conta banco"
                              title="Código da conta contábil do banco"
                              aria-label="Código da conta contábil do banco"
                              className="w-full border border-brand-border bg-white px-2.5 py-1.5 text-xs font-mono text-brand-text outline-none focus:border-brand-text"
                            />
                          )}
                        </div>
                        <div>
                          <label
                            htmlFor="valor-sign-heuristic"
                            className="block text-[10px] font-bold uppercase text-brand-text/60 mb-1"
                          >
                            Heurística de Sinais (D/C)
                          </label>
                          <select
                            id="valor-sign-heuristic"
                            value={valorSignHeuristic}
                            onChange={(e) => setValorSignHeuristic(e.target.value as any)}
                            className="w-full border border-brand-border bg-white px-2.5 py-1.5 text-xs text-brand-text outline-none focus:border-brand-text"
                          >
                            <option value="automatic">Automático (Texto: D/C, -/+)</option>
                            <option value="color_blue_c_red_d">Texto Azul é Crédito, Vermelho é Débito</option>
                            <option value="color_blue_d_red_c">Texto Azul é Débito, Vermelho é Crédito</option>
                          </select>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <button
                            type="button"
                            onClick={() => persistCurrentLayout(false)}
                            disabled={!bancoNome.trim() || !contaBanco.trim() || !companyName.trim()}
                            className="technical-button w-full text-[10px] py-2 flex items-center justify-center gap-1.5 disabled:opacity-40"
                          >
                            <Save className="w-3.5 h-3.5" />
                            {layoutEditId ? 'Atualizar layout' : 'Salvar configuração'}
                          </button>
                          {layoutEditId ? (
                            <button
                              type="button"
                              onClick={() => persistCurrentLayout(true)}
                              disabled={!bancoNome.trim() || !contaBanco.trim() || !companyName.trim()}
                              className="technical-button-secondary w-full text-[10px] py-2 disabled:opacity-40"
                            >
                              Salvar como novo
                            </button>
                          ) : null}
                          {activeExtratoLayout ? (
                            <button
                              type="button"
                              onClick={handleClearActiveLayout}
                              className="technical-button-secondary w-full text-[10px] py-2"
                            >
                              Limpar layout ativo
                            </button>
                          ) : null}
                        </div>
                      </section>

                      <section className="flex flex-col gap-4 border-t border-brand-border pt-5">
                        <h3 className="text-xs font-bold text-brand-text/60 uppercase tracking-wider">2. Linhas Detectadas</h3>
                        <div className="bg-brand-sidebar/40 border border-brand-border p-3 text-brand-text/80 text-[11px]">
                          Detectadas <strong className="text-brand-text">{detectedRows.length} linhas</strong> de transações automaticamente.
                        </div>
                      </section>
                      {/* Seção de Limites de Recorte - sempre visível em arquivos multi-página ou de página única */}
                      <section className="flex flex-col gap-4 border-t border-brand-border pt-5">
                        <h3 className="text-xs font-bold text-brand-text/60 uppercase tracking-wider">3. Limites de Recorte (%)</h3>
                        <div>
                          <label htmlFor="extrato-crop-start-pct" className="text-xs font-semibold text-brand-text/80">
                            Início: {cropStartPct}%
                          </label>
                          <input
                            id="extrato-crop-start-pct"
                            type="range"
                            min={0}
                            max={cropStartPage === cropEndPage ? Math.max(0, cropEndPct - 2) : 100}
                            value={cropStartPct}
                            onChange={(e) => setCropStartPct(Number(e.target.value))}
                            className="w-full accent-orange-500"
                            aria-label={`Início do recorte: ${cropStartPct}%`}
                            title={`Início do recorte: ${cropStartPct}%`}
                          />
                        </div>
                        <div>
                          <label htmlFor="extrato-crop-end-pct" className="text-xs font-semibold text-brand-text/80">
                            Fim: {cropEndPct}%
                          </label>
                          <input
                            id="extrato-crop-end-pct"
                            type="range"
                            min={cropStartPage === cropEndPage ? Math.min(100, cropStartPct + 2) : 0}
                            max={100}
                            value={cropEndPct}
                            onChange={(e) => setCropEndPct(Number(e.target.value))}
                            className="w-full accent-rose-500"
                            aria-label={`Fim do recorte: ${cropEndPct}%`}
                            title={`Fim do recorte: ${cropEndPct}%`}
                          />
                        </div>
                      </section>

                      <section className="border-t border-brand-border pt-5 text-xs">
                        <h4 className="font-bold text-brand-text/60 uppercase tracking-wider mb-3 flex items-center gap-1">
                          <Columns className="w-3.5 h-3.5 text-brand-text/50" />
                          Mapeamento (%)
                        </h4>
                        <div className="flex flex-col gap-2 font-mono">
                          <div className="flex justify-between bg-blue-50 text-blue-700 px-2.5 py-1.5 border border-blue-200">
                            <span>Data:</span>
                            <span>{columns.date.startX}% – {(columns.date.startX + columns.date.width).toFixed(1)}%</span>
                          </div>
                          <div className="flex justify-between bg-purple-50 text-purple-700 px-2.5 py-1.5 border border-purple-200">
                            <span>Histórico:</span>
                            <span>{columns.history.startX}% – {(columns.history.startX + columns.history.width).toFixed(1)}%</span>
                          </div>
                          <div className="flex justify-between bg-emerald-50 text-emerald-700 px-2.5 py-1.5 border border-emerald-200">
                            <span>Valor:</span>
                            <span>{columns.value.startX}% – {(columns.value.startX + columns.value.width).toFixed(1)}%</span>
                          </div>
                        </div>
                      </section>
                    </>
                  ) : (
                    <section className="flex flex-col gap-3">
                      <h3 className="text-xs font-bold text-brand-text/60 uppercase tracking-wider flex items-center gap-1.5">
                        <FolderOpen className="w-3.5 h-3.5" />
                        Layouts salvos
                      </h3>
                      {!companyName.trim() ? (
                        <p className="text-[11px] text-brand-text/60">Selecione uma empresa para salvar layouts.</p>
                      ) : savedLayouts.length === 0 ? (
                        <p className="text-[11px] text-brand-text/60 text-center py-4">Nenhum layout salvo.</p>
                      ) : (
                        <div className="space-y-2 max-h-[520px] overflow-y-auto">
                          {savedLayouts.map((layout) => {
                            const isActive = getActiveExtratoOcrLayout(companyName)?.id === layout.id;
                            return (
                              <div
                                key={layout.id}
                                className={`border border-brand-border p-3 space-y-1.5 ${layoutEditId === layout.id || isActive ? 'bg-brand-sidebar/40' : 'bg-white'
                                  }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <p className="text-[11px] font-black uppercase truncate text-brand-text">
                                    {layout.bancoNome}
                                  </p>
                                  {isActive ? (
                                    <span className="text-[7px] font-black uppercase tracking-wider opacity-60 shrink-0">
                                      Ativo
                                    </span>
                                  ) : null}
                                </div>
                                <p className="text-[10px] font-mono text-brand-text/70">
                                  Conta banco: {layout.contaBanco}
                                </p>
                                <p className="text-[8px] text-brand-text/45">
                                  {new Date(layout.updatedAt).toLocaleString('pt-BR')}
                                </p>
                                <div className="flex gap-1.5 pt-1">
                                  <button
                                    type="button"
                                    className="technical-button text-[9px] py-1 px-2 flex-1"
                                    onClick={() => applyLayout(layout)}
                                  >
                                    {isActive ? 'Reaplicar' : 'Usar este layout'}
                                  </button>
                                  <button
                                    type="button"
                                    className="technical-button text-[9px] py-1 px-2"
                                    aria-label={`Excluir layout ${layout.bancoNome}`}
                                    onClick={() => {
                                      deleteExtratoOcrLayout(companyName, layout.id);
                                      refreshSavedLayouts();
                                      if (layoutEditId === layout.id) setLayoutEditId(null);
                                      void flushPersistenceAfterCriticalWrite();
                                    }}
                                  >
                                    <Trash2 className="w-3 h-3" />
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
              </div>
            </div>

            <div className="lg:col-span-3">
              <LeitorRecortadorWorkspace
                canvasElement={activeCanvas}
                columns={columns}
                setColumns={setColumns}
                detectedRowYs={detectedRows}
                isProcessing={isProcessing || isLocalExtracting}
                onApplyCrop={runLocalAutoExtraction}
                onApplyCropAll={pdfPages.length > 1 ? runLocalAutoExtraction : undefined}
                docType={metadata?.type || 'pdf'}
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
          </div>
        ) : (
          <div className="w-full flex flex-col gap-6">
            <div className="flex justify-between items-center bg-white p-4 border border-brand-border shadow-[2px_2px_0_0_#141414]">
              <p className="text-xs font-semibold text-brand-text">{metadata?.name}</p>
              {engine === 'local' && (
                <button
                  type="button"
                  onClick={() => setActiveTab('align')}
                  className="technical-button px-4 py-2 text-xs font-bold"
                >
                  Ajustar Alinhamento & Colunas
                </button>
              )}
            </div>
            <LeitorRecortadorTable
              rows={rows}
              setRows={setRows}
              onExportCsv={handleExportCsv}
              onExportOfx={handleExportOfx}
              onClearAll={handleClearAll}
              exclusionRules={exclusionRules}
              setExclusionRules={setExclusionRules}
              cleanupRules={cleanupRules}
              setCleanupRules={setCleanupRules}
              pruneStorageKey={pruneStorageKey}
              filterStorageScope={`${companyName.trim()}_extrato`}
            />
          </div>
        )}
      </main>

      <footer className="bg-white border-t border-brand-border py-4 px-6 shrink-0 flex items-center justify-between gap-4">
        <p className="text-xs text-brand-text/50">{rows.length} recorte(s) — verificação visual direta</p>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="technical-button px-4 py-2 text-xs font-bold">
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleExportOfx}
            disabled={rows.length === 0}
            className="technical-button px-4 py-2 text-xs font-bold disabled:opacity-40"
          >
            Exportar OFX Money
          </button>
          <button
            type="button"
            onClick={handleOkConciliacao}
            disabled={rows.length === 0}
            className="technical-button-primary px-4 py-2 text-xs font-bold disabled:opacity-40"
          >
            OK — Ir para conciliação
          </button>
        </div>
      </footer>
    </div>
  );
}
