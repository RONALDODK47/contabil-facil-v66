import React, { useState, useRef, useMemo, Suspense, lazy } from 'react';
import { Download, Calendar, FileText, Upload, RefreshCw, CheckCircle, AlertCircle, HelpCircle, Loader2, Landmark, FileSpreadsheet, File, ScanSearch } from 'lucide-react';
import { cn } from '../lib/utils';
import { canUseNativeConverter, ingestNativeFile } from '../logic/dataIngestionEngine';
import { getOcrColunasConfig, type PdfIngestVariant } from '../logic/ocrColunasConfig';
import {
  mapOcrRowsToImportItems,
  mapOcrRowsToImportItemsWithPlanoInfer,
  mapOcrRowsToRazaoVision,
  resolveExtratoValorNatureza,
  type ImportSkippedEntry,
  type ExtratoConciliacaoResumo,
} from '../logic/ocrImportMapper';
import { parseNotaExplicativaBalanceteFile } from '../logic/notaExplicativaBalanceteImport';
import { parseBalanceteSaldoDominioPdf } from '../logic/balanceteSaldoDominioParser';
import {
  mapRecorteFielRowsToImportItems,
  rowsSaoRecorteFiel,
} from '../logic/extratoRecorteFielImport';
import {
  extratoRowContemPalavraIgnorada,
  extratoHistoricoPreferidoDaLinhaOcr,
  inferDescricaoFromLinhaOcr,
  extratoHistoricoEhPlausivel,
  resolveExtratoDescricaoText,
  parseExtratoDataOcrText,
  parseOcrIgnoreLineWords,
  propagateExtratoDatesOcrRows,
} from '../../lib/ocrExtratoPositional';
import { getOcrUserSettings } from '../../lib/ocrUserSettings';
import { resolveExtratoMapImportOptions } from '../../lib/itauExtratoProfile';
import {
  finalizePlanoImport,
  migrateLegacyBalanceteToRazao,
  normalizeRazaoImport,
  parseTxtPlusToRazaoVision,
  visionPlanoRowsToAccountPlans,
} from '../logic/contabilPipeline';
import {
  dominioVisionToExtratoRows,
  isTxtPlusDominio,
  parseDominioTxtFile,
  parseTxtPlusToExtratoRows,
  parseTxtPlusToExtratoRowsExpanded,
  parseTxtPlusToFolhaRelatorio,
  readTextFileSmart,
} from '../logic/dominioTxtIO';
import { importParcelamentoPlanilhaFile } from '../../lib/parcelamentoPlanilha';
import { extractExtratoWithAi } from '../../lib/aiExtratoExtractClient';
import { parseAndRenderAllPDFPages } from '../../lib/leitorRecortador/pdfParser';
import { buildDefaultColumnMapping } from '../../lib/leitorRecortador/columnDefaults';
import { suggestPlanoContasColumns, suggestRazaoDominioColumns } from '../../lib/pdfNativeTextItems';
import { genericColumnsToPercentMapping } from '../../lib/leitorRecortador/layoutBridge';
import { resolvePlanoColumnsForPage } from '../../lib/leitorRecortador/planoColumnPrecision';
import {
  detectPlanoRowsFromText,
  extractPlanoDataFromCanvas,
} from '../../lib/leitorRecortador/planoRowDetection';
import { resolveRazaoColumnsForPage } from '../../lib/leitorRecortador/razaoColumnPrecision';
import {
  detectRazaoRowsFromText,
  extractRazaoDataFromCanvas,
} from '../../lib/leitorRecortador/razaoRowDetection';
import {
  applyPlanoTipoInferenceToRows,
  mapGenericRowsToOcrRows,
} from '../../lib/leitorRecortador/rowMappers';
import {
  dataTypeSupportsExcelImport,
  downloadExcelModeloForDataType,
  excelModeloFilenameForDataType,
} from '../logic/ingestExcelModelo';
import {
  parseAplicacoesExcelFile,
  parseEmprestimosExcelFile,
} from '../../extratoVision/utils/planilhaModelo';
import type { GenericOcrRow } from '../../lib/parcelamentoColunasExtract';
import type { ParcelamentoPlanilhaImport } from '../../lib/parcelamentoPlanilha';
import ExtratoContaPicker, { type ExtratoPlanoContaOption } from './ExtratoContaPicker';
import {
  derivePlanoGroupFromCode,
  derivePlanoNatureFromGroup,
  parsePlanoTxtParts,
} from '../logic/planoContasMapper';
import { parsePlanoContasText } from '../../extratoVision/utils/planoContasTxtParser';
import { isDominioLancamentosHeaderLine, parseDominioLancamentosTxt } from '../../extratoVision/utils/dominioLancamentosTxt';
import { detectContabilTxtFormat, resolveImportFormat } from '../logic/txtFormatDetect';
import { extratoDateToIso } from '../../extratoVision/utils/parser';
import { importOfxFileToExtratoItems, type OfxExtratoImportContext } from '../logic/ofxExtratoImport';
import {
  getExtratoBancoConta,
  getExtratoBancoNome,
  setActiveExtratoOcrLayout,
  saveExtratoBancoParaImportacao,
} from '../logic/extratoOcrLayoutStorage';
import type { ExtratoOcrLayoutSaved } from '../logic/extratoOcrLayoutStorage';

const BankPdfExtractModal = lazy(() =>
  import('./BankPdfExtractModal').then((m) => ({ default: m.BankPdfExtractModal })),
);
import { ExtratoConversorModal } from './ExtratoConversorModal';
import { OcrSearchablePdfModal } from './OcrSearchablePdfModal';
import { flushPersistenceAfterCriticalWrite } from '../logic/eyeVisionPersistenceFlush';
import type { ExtratoDocumentKind } from '../../lib/extratoPdfClassifier';


type ExtratoImportItemLike = {
  id: string;
  date: string;
  description: string;
  value: number;
  nature: 'D' | 'C';
  [k: string]: unknown;
};

const OCR_REMOVIDO_MSG =
  'OCR foi removido do sistema. Use PDF com texto nativo, leitor-recortador sem OCR, OFX, Excel ou TXT.';

function motorDataExtrato(row: GenericOcrRow, stmtYear: string, lastIso: string): string {
  const dataToken = parseExtratoDataOcrText(String(row.data ?? ''), stmtYear);
  const dataLinha = parseExtratoDataOcrText(String(row._linhaOcr ?? ''), stmtYear);
  return (
    extratoDateToIso(dataToken || dataLinha, stmtYear) ||
    extratoDateToIso(String(row.data ?? '').trim(), stmtYear) ||
    lastIso
  );
}

function motorHistoricoExtrato(row: GenericOcrRow, fallback: string): string {
  const historicoPreferido = extratoHistoricoPreferidoDaLinhaOcr(row);
  const historicoInferido = inferDescricaoFromLinhaOcr(String(row._linhaOcr ?? ''), row);
  const historicoBase = resolveExtratoDescricaoText(row);
  const chosen = String(
    historicoPreferido ||
    historicoInferido ||
    historicoBase ||
    row.descricao ||
    row.historicoOperacao ||
    row._linhaOcr ||
    fallback,
  )
    .replace(/\s+/g, ' ')
    .trim();
  return chosen || fallback;
}

function motorSinalExtrato(row: GenericOcrRow, resolvedNature: 'D' | 'C'): 'D' | 'C' {
  const deb = String(row.valorDebito ?? '').trim();
  const cred = String(row.valorCredito ?? '').trim();
  const misto = String(row.valorMisto ?? row.valor ?? '').trim();
  const naturezaColuna = String(row.natureza ?? '').trim().toUpperCase();
  if (deb) return 'D';
  if (cred) return 'C';
  if (naturezaColuna === 'D') return 'D';
  if (naturezaColuna === 'C') return 'C';
  if (/^[-−]/.test(misto)) return 'D';
  if (/\bD\b$/.test(misto.toUpperCase())) return 'D';
  if (/\bC\b$/.test(misto.toUpperCase())) return 'C';
  return resolvedNature;
}

function motorValorExtrato(row: GenericOcrRow): { value: number; nature: 'D' | 'C' } {
  const resolved = resolveExtratoValorNatureza(row);
  const nature = motorSinalExtrato(row, resolved.nature === 'D' ? 'D' : 'C');
  const value = Number.isFinite(resolved.value) ? Math.max(0, resolved.value) : 0;
  return { value, nature };
}

function tokensUpper(text: string): string[] {
  return String(text)
    .toUpperCase()
    .replace(/[^\p{L}\p{N}\s./-]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function overlapScore(a: string, b: string): number {
  const ta = tokensUpper(a);
  const tb = new Set(tokensUpper(b));
  if (ta.length === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / ta.length;
}

function motorComparacaoExtrato(
  items: ExtratoImportItemLike[],
  rows: GenericOcrRow[],
): { items: ExtratoImportItemLike[]; logs: string[] } {
  if (items.length === 0 || rows.length === 0) return { items, logs: [] };
  const used = new Set<number>();
  const logs: string[] = [];
  const stmtYear =
    rows
      .map((r) => [r.data, r._linhaOcr].filter(Boolean).join(' '))
      .join(' ')
      .match(/\b(20\d{2})\b/)?.[1] ?? String(new Date().getFullYear());

  const rowsPrepared = propagateExtratoDatesOcrRows(rows.map((r) => ({ ...r })), stmtYear);
  let lastIso = '';
  const rowsMotor = rowsPrepared.map((row, idx) => {
    const date = motorDataExtrato(row, stmtYear, lastIso);
    if (date) lastIso = date;
    const { value, nature } = motorValorExtrato(row);
    const description = motorHistoricoExtrato(row, `LANÇAMENTO OCR ${idx + 1}`);
    return { idx, date, value, nature, description, row };
  });

  const adjusted = items.map((item) => {
    let best: { score: number; c: (typeof rowsMotor)[number] } | null = null;
    for (const c of rowsMotor) {
      if (used.has(c.idx)) continue;
      let score = 0;
      if (Math.abs((item.value ?? 0) - c.value) < 0.011) score += 80;
      if ((item.date ?? '') === c.date) score += 30;
      if ((item.nature ?? '') === c.nature) score += 20;
      score += overlapScore(item.description ?? '', c.description) * 25;
      if (!best || score > best.score) best = { score, c };
    }
    if (!best || best.score < 65) return item;
    used.add(best.c.idx);
    const descMotor = String(best.c.description ?? '').trim();
    const shouldReplaceDescription =
      !!descMotor &&
      extratoHistoricoEhPlausivel(descMotor) &&
      (overlapScore(item.description ?? '', descMotor) < 0.45 ||
        /SISPAG\s+FORNECEDORES?\s*-\s*\d/i.test(item.description ?? '') ||
        (item.description ?? '').trim().length < 12);
    const next: ExtratoImportItemLike = { ...item };
    if (best.c.date) next.date = best.c.date;
    next.value = best.c.value;
    next.nature = best.c.nature;
    if (shouldReplaceDescription) {
      next.description = descMotor.toUpperCase();
      logs.push(
        `Motor comparação: histórico ajustado para linha fiel OCR -> ${next.description.slice(0, 90)}`,
      );
    }
    return next;
  });
  return { items: adjusted, logs };
}

function buildExtratoItemsNoLoss(
  rows: GenericOcrRow[],
  ignoreWords: string[],
): Array<{
  id: string;
  date: string;
  description: string;
  value: number;
  nature: 'D' | 'C';
}> {
  const usableRows = rows.filter(
    (row) => !extratoRowContemPalavraIgnorada(row, ignoreWords),
  );
  const stmtYear =
    usableRows
      .map((r) => [r.data, r.descricao, r.historicoOperacao].filter(Boolean).join(' '))
      .join(' ')
      .match(/\b(20\d{2})\b/)?.[1] ?? String(new Date().getFullYear());
  const rowsWithDates = propagateExtratoDatesOcrRows(
    usableRows.map((r) => ({ ...r })),
    stmtYear,
  );
  let lastIso = '';
  return rowsWithDates.map((row, index) => {
    const dateIso = motorDataExtrato(row, stmtYear, lastIso);
    if (dateIso) lastIso = dateIso;
    const description = motorHistoricoExtrato(row, `LANÇAMENTO OCR ${index + 1}`);
    const resolved = motorValorExtrato(row);
    return {
      id: crypto.randomUUID(),
      date: dateIso,
      description: description || `LANÇAMENTO OCR ${index + 1}`,
      value: Number.isFinite(resolved.value) ? Math.max(0, resolved.value) : 0,
      nature: resolved.nature === 'D' ? 'D' : 'C',
    };
  });
}

interface DataIngestionBoxProps {
  dataType: 'loans' | 'installments' | 'apps' | 'extrato' | 'plano' | 'balancete' | 'folha' | 'fiscal';
  title: string;
  onImport: (items: any[], saldoAnterior?: number) => void;
  /** Callback para emitir logs de diagnóstico (conversor, OCR, importação). */
  onLog?: (msg: string, cat?: string) => void;
  /** Razão contábil bruta (VisionBalanceteRow[]) — substitui import anterior. */
  onRazaoImport?: (
    rows: import('../../extratoVision/types/accounting').VisionBalanceteRow[],
    filename?: string,
  ) => void;
  /** OCR de cronograma (PDF/imagem) com colunas do parcelamento antigo. */
  onParcelamentoOcrImport?: (data: ParcelamentoPlanilhaImport) => void;
  /** Lançamentos OCR não importados (aba extrato — botão LOG no cabeçalho). */
  onExtratoSkippedLog?: (entries: ImportSkippedEntry[]) => void;
  /** Conciliação pós-import (Anterior + C − D vs saldo OCR). */
  onExtratoConciliacao?: (resumo: ExtratoConciliacaoResumo) => void;
  selectedCompany?: string;
  extratoPlanoOptions?: ExtratoPlanoContaOption[];
  /** Só PDF/imagem via recortador (Folha, Fiscal, Apps, Parcelamento). */
  ingestionMode?: 'all' | 'pdfOnly';
  /** Tipos de PDF na mesma aba (ex.: folha / impostos / pró-labore). */
  pdfVariants?: PdfIngestVariant[];
  /** Notifica a aba quando o variant ativo muda. */
  onPdfVariantChange?: (variantId: string) => void;
  /** Hide legacy "Importar TXT (Texto)" button, keep only "IMPORTAR TXT DO PRÓPRIO SISTEMA" */
  skipLegacyTxtButton?: boolean;
  /** Botão extra no topo da lista de ações (ex.: "Importar PDF Domínio" ao lado de "Importar PDF (Recorte)"). */
  extraTopAction?: {
    label: string;
    onClick: () => void;
    icon?: React.ReactNode;
    disabled?: boolean;
    title?: string;
  };
  /** Botão extra no fim da lista de ações, logo abaixo de "Importar TXT (Texto)". */
  extraBottomAction?: {
    label: string;
    onClick: () => void;
    icon?: React.ReactNode;
    disabled?: boolean;
    title?: string;
  };
  /** Callback chamado quando os logs de importação mudam. */
  onLogsChange?: (logs: string[]) => void;
}

export default function DataIngestionBox({
  dataType,
  title,
  onImport,
  onLog,
  onRazaoImport,
  onParcelamentoOcrImport,
  onExtratoSkippedLog,
  onExtratoConciliacao,
  selectedCompany,
  extratoPlanoOptions,
  ingestionMode = 'all',
  pdfVariants,
  onPdfVariantChange,
  skipLegacyTxtButton,
  extraTopAction,
  extraBottomAction,
  onLogsChange,
}: DataIngestionBoxProps) {
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [showDocModal, setShowDocModal] = useState(false);
  const [showExtratoParseadoModal, setShowExtratoParseadoModal] = useState(false);
  const [importedLogs, setImportedLogsState] = useState<string[]>([]);
  const setImportedLogs = (logs: string[]) => {
    setImportedLogsState(logs);
    onLogsChange?.(logs);
  };
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [pendingOcrFile, setPendingOcrFile] = useState<File | null>(null);
  const [ocrFiltroDataInicio, setOcrFiltroDataInicio] = useState('');
  const [ocrFiltroDataFim, setOcrFiltroDataFim] = useState('');
  const [ocrBancoNome, setOcrBancoNome] = useState('');
  const [ocrContaBanco, setOcrContaBanco] = useState('');
  /** PDF Sistema Domínio: plano de contas ou razão contábil (texto nativo). */
  const [dominioPdfKind, setDominioPdfKind] = useState<'plano' | 'balancete' | null>(null);
  const dominioPdfTargetRef = useRef<'plano' | 'balancete' | null>(null);
  /** Balancete: importação simplificada, só código reduzido + classificação + descrição + saldo final. */
  const [balanceteSaldoMode, setBalanceteSaldoMode] = useState(false);
  /** Balancete: data (competência) obrigatória para o saldo importado, senão ele não aparece em nenhum mês do comparativo. */
  const [balanceteSaldoData, setBalanceteSaldoData] = useState('');
  /** Extrato: escolha explícita do botão (somente texto nativo). */
  const extratoImportModeRef = useRef<ExtratoDocumentKind | null>(null);
  /** Extrato: somente PDF com texto nativo. */
  const [extratoDocumentKind, setExtratoDocumentKind] = useState<ExtratoDocumentKind | null>(null);
  const [showConversor, setShowConversor] = useState(false);
  const [showOcrScanner, setShowOcrScanner] = useState(false);

  const [pendingOfxFile, setPendingOfxFile] = useState<File | null>(null);
  const [pendingXlsxExtratoFile, setPendingXlsxExtratoFile] = useState<File | null>(null);
  const [ofxBancoNome, setOfxBancoNome] = useState('');
  const [ofxContaBanco, setOfxContaBanco] = useState('');
  // Para TXT+ da própria importação - pede conta de banco
  const [showTxtPlusBancoModal, setShowTxtPlusBancoModal] = useState(false);
  const [txtPlusPendingContent, setTxtPlusPendingContent] = useState('');
  const [txtPlusPendingFileName, setTxtPlusPendingFileName] = useState('');
  const [txtPlusBancoConta, setTxtPlusBancoConta] = useState('');
  const [selectedPdfVariant, setSelectedPdfVariant] = useState(
    () => pdfVariants?.[0]?.id ?? dataType,
  );

  const pdfOnly = ingestionMode === 'pdfOnly';
  const activePdfVariant = pdfVariants?.length
    ? selectedPdfVariant || pdfVariants[0]!.id
    : dataType;
  const ocrConfig = useMemo(
    () =>
      getOcrColunasConfig(
        dataType,
        dataType === 'balancete' && balanceteSaldoMode ? 'balancete_saldo' : activePdfVariant,
      ),
    [dataType, activePdfVariant, balanceteSaldoMode],
  );
  const supportsExcelImport = !pdfOnly && dataTypeSupportsExcelImport(dataType);

  const fileInputRefXlsx = useRef<HTMLInputElement>(null);
  const fileInputRefTxt = useRef<HTMLInputElement>(null);
  const fileInputRefOfx = useRef<HTMLInputElement>(null);
  const fileInputRefPdfDominio = useRef<HTMLInputElement>(null);
  const fileInputRefBalanceteDominio = useRef<HTMLInputElement>(null);

  // Helper template info based on module
  const getTemplateInfo = () => {
    switch (dataType) {
      case 'loans':
        return {
          cols: 'Excel (modelo): Empresa; Contrato; Tipo (SAC/PRICE); Principal; Taxa (%); Parcelas; Data Início; Carência; Tipo Carência; Indexador; IOF; Custos',
          example: 'TECHNOVA INDUSTRIAL LTDA; 2026-CCB-402; SAC; 150000; 11.5; 24; 2026-05-15; 3; capitalized; CDI; 2840; 120',
          filename: 'modelo_emprestimos.xlsx',
        };
      case 'installments':
        return {
          cols: 'Excel (modelo): cadastro no topo + colunas Nº parcela, Vencimento, Valor, Juros, Encargos, Honorários, Multa, Contas',
          example: 'ALPHA SERVICES LTDA; CTR-2401; 4500; 10; 2026-06-01',
          filename: 'parcelamento_modelo.xlsx',
        };
      case 'apps':
        return {
          cols: 'Excel (modelo): Nome Ativo; Valor Aplicado; Taxa (%); Indexador; Data Aplicação',
          example: 'CDB DI LIQUIDEZ DIÁRIA ITAÚ; 95000; 100; CDI; 2026-01-10',
          filename: 'modelo_aplicacoes.xlsx',
        };
      case 'extrato':
        return {
          cols: 'Excel (modelo): Data; Histórico; Valor; D/C — ou TXT+ Domínio',
          example: '20/05/2026;1110100001;2110100001;15100,50;0;TED RECEBIMENTO CLIENTE BETA;',
          filename: 'modelo_extrato.xlsx',
        };
      case 'plano':
        return {
          cols: 'Excel modelo ou exportação Domínio (Contas.xls/.xlsx/.csv) — Código · T · Classificação · Nome · Grau — ou TXT Domínio / SPED',
          example: '00000051110100001          CAIXA GERAL                             A',
          filename: 'modelo_plano_contas.xlsx',
        };
      case 'balancete':
        return {
          cols: 'Excel (modelo): Data; Código; Classificação; Descrição; Débito; Crédito — ou TXT Domínio lançamentos',
          example: '0100002531417062000018301/12/202431/12/2025N05000000181 (arquivo lancamentos.txt)',
          filename: 'modelo_razao.xlsx',
        };
      case 'folha':
        return {
          cols: pdfOnly
            ? 'PDF/imagem via recorte — Folha, Impostos da folha ou Pró-labore'
            : 'TXT nativo Domínio (01/02/03) ou TXT+ partida dobrada — também: Nome-Colaborador; Salario-Bruto-Nominal',
          example: '28/02/2026;6210100001;2110100001;3500,00;0;SALARIOS A PAGAR;',
          filename: 'folha_dominio.txt',
        };
      case 'fiscal':
        return {
          cols: 'PDF/imagem via recorte — Guias/impostos ou documento fiscal (data, histórico, débito, crédito)',
          example: '31/03/2026 · PIS A RECOLHER · Débito 1.200,00',
          filename: 'fiscal_recorte.pdf',
        };
    }
  };

  const temp = getTemplateInfo();
  const extratoOfxHint =
    dataType === 'extrato'
      ? 'Exporte do Internet Banking ou Microsoft Money (.ofx / .qfx). Na importação, informe obrigatoriamente o nome do banco e a conta contábil do banco no plano.'
      : undefined;

  // Smart Parser for line-by-line input
  const parseTxtContent = (text: string): any[] => {
    // Domínio (01/02/03): delega ao parser único e testado (dominioLancamentosTxt.ts) em vez de
    // repetir a leitura de posições fixas aqui — duas implementações divergentes desse layout
    // (offsets diferentes) causavam descrição/conta com lixo quando esta rota era usada.
    if (text.trim().startsWith('010000')) {
      const visionRows = parseDominioLancamentosTxt(text);
      return visionRows
        .filter((r) => /^\d/.test(String(r.codigo ?? '').trim()))
        .map((r) => ({
          id: crypto.randomUUID(),
          dataInicio: r.data,
          codigo: r.codigo,
          classificacao: r.codigo,
          descricao: r.nome,
          debito: r.debito ?? 0,
          credito: r.credito ?? 0,
          saldoFinal: (r.debito ?? 0) - (r.credito ?? 0),
          natureza: (r.debito ?? 0) > 0 ? 'D' : 'C',
        }));
    }

    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const parsedItems: any[] = [];
    const logs: string[] = [];

    lines.forEach((line, index) => {
      // Registro "01" do TXT Domínio (cabeçalho com CNPJ embutido, ex.:
      // "0100001134485455100019801/01/202630/06/2026N05000000181") — nunca é lançamento,
      // mesmo quando este trecho de arquivo é colado/importado fora da rota dedicada acima.
      if (isDominioLancamentosHeaderLine(line)) {
        logs.push(`Cabeçalho detectado e ignorado: "${line}"`);
        return;
      }

      // Ignore header/metadata rows (empresa, CNPJ, período etc.) — podem aparecer nas primeiras
      // linhas do arquivo, não só na linha 0, e nunca são um lançamento de verdade.
      if (
        index < 5 &&
        (line.toLowerCase().includes('empresa') ||
          line.toLowerCase().includes('cliente') ||
          line.toLowerCase().includes('cnpj') ||
          line.toLowerCase().includes('período') ||
          line.toLowerCase().includes('periodo') ||
          line.toLowerCase().includes('nome') ||
          line.toLowerCase().includes('codigo') ||
          line.toLowerCase().includes('código') ||
          line.toLowerCase().includes('data'))
      ) {
        logs.push(`Cabeçalho detectado e ignorado: "${line}"`);
        return;
      }

      // Split by semicolon, comma or pipe
      const parts = line.split(/[;,|]+/).map(p => p.trim());

      try {
        if (dataType === 'loans') {
          // Empresa; Contrato; Tipo; Principal; Taxa; Parcelas; Data; Carencia; TipoCarencia; Indexador; IOF; Custos
          const companyName = parts[0] || 'EMPRESA PADRAO LTDA';
          const contractNumber = parts[1] || `CTR-${Math.floor(1000 + Math.random() * 9000)}`;
          const type = (parts[2]?.toUpperCase() === 'PRICE' ? 'PRICE' : 'SAC') as 'SAC' | 'PRICE';
          const principal = parseFloat(parts[3] || '0') || 10000;
          const interestRate = parseFloat(parts[4] || '0') || 10;
          const installments = parseInt(parts[5] || '0') || 12;
          const startDate = parts[6] || new Date().toISOString().split('T')[0];
          const gracePeriod = parseInt(parts[7] || '0') || 0;
          const graceType = (parts[8]?.toLowerCase() === 'paid' ? 'paid' : 'capitalized') as 'capitalized' | 'paid';
          const indexType = (['CDI', 'IPCA', 'PRE', 'NONE'].includes(parts[9]?.toUpperCase() || '') ? parts[9]?.toUpperCase() : 'NONE') as any;
          const iof = parseFloat(parts[10] || '0') || 0;
          const costs = parseFloat(parts[11] || '0') || 0;

          parsedItems.push({
            id: crypto.randomUUID(),
            companyName: companyName.toUpperCase(),
            contractNumber: contractNumber.toUpperCase(),
            type,
            principal,
            interestRate,
            installments,
            startDate,
            gracePeriod,
            graceType,
            indexType,
            iof,
            costs
          });
          logs.push(`Contrato "${contractNumber}" importado com sucesso.`);
        }
        else if (dataType === 'installments') {
          // Cliente; Contrato; Valor-Parcela; Quantidade; Data-Inicio
          const client = parts[0] || 'CLIENTE IMPORTADO SA';
          const contract = parts[1] || `CTR-${Math.floor(1000 + Math.random() * 9000)}`;
          const amount = parseFloat(parts[2] || '0') || 1000;
          const qty = parseInt(parts[3] || '0') || 12;
          const start = parts[4] || new Date().toISOString().split('T')[0];

          parsedItems.push({
            id: crypto.randomUUID(),
            client: client.toUpperCase(),
            contract: contract.toUpperCase(),
            amount,
            qty,
            start
          });
          logs.push(`Cronograma "${contract}" de ${client} carregado.`);
        }
        else if (dataType === 'apps') {
          // Nome-Ativo; Valor-Aplicado; Taxa; Indexador; Data-Aplicacao
          const name = parts[0] || 'INVESTIMENTO IMPORTADO';
          const amount = parseFloat(parts[1] || '0') || 5000;
          const rate = parseFloat(parts[2] || '0') || 100;
          const index = parts[3]?.toUpperCase() || 'CDI';
          const startDate = parts[4] || new Date().toISOString().split('T')[0];

          parsedItems.push({
            id: crypto.randomUUID(),
            name: name.toUpperCase(),
            folder: (parts[5] || 'IMPORTADO').toUpperCase(),
            amount,
            rate,
            index,
            startDate
          });
          logs.push(`Ativo financeiro "${name}" registrado.`);
        }
        else if (dataType === 'extrato') {
          const date = parts[0] || new Date().toISOString().split('T')[0];
          const description = parts[1] || 'LANCAMENTO IMPORTADO TEXTO';
          const hasExtendedCols = parts.length >= 7;
          const { value, nature } = resolveExtratoValorNatureza({
            valorCredito: hasExtendedCols ? (parts[2] ?? '') : '',
            valorDebito: hasExtendedCols ? (parts[3] ?? '') : '',
            valorMisto: hasExtendedCols ? (parts[4] ?? '') : '',
            natureza: hasExtendedCols ? (parts[5] ?? '') : (parts[3] ?? ''),
            valor: hasExtendedCols ? '' : (parts[2] ?? ''),
          });
          const accountCode = (hasExtendedCols ? parts[6] : parts[4]) || '1.01.02.0002';

          parsedItems.push({
            id: crypto.randomUUID(),
            date,
            description: description.toUpperCase(),
            value,
            nature,
            accountCode,
            status: 'CONCILIADO' as const,
          });
          logs.push(`Lançamento "${description}" importado.`);
        }
        else if (dataType === 'plano') {
          const parsed = parsePlanoTxtParts(parts);
          const groupStr = derivePlanoGroupFromCode(parsed.code);
          parsedItems.push({
            code: parsed.code,
            name: parsed.name.toUpperCase(),
            codigoReduzido: parsed.codigoReduzido,
            tipo: parsed.tipo,
            nivel: parsed.nivel,
            group: groupStr,
            nature: derivePlanoNatureFromGroup(groupStr),
          });
          logs.push(`Conta "${parsed.code} - ${parsed.name}" mapeada.`);
        }
        else if (dataType === 'balancete') {
          const dataInicio = parts[0] || new Date().toISOString().split('T')[0];
          const codigo = parts[1] || '';
          const classificacao = parts[2] || codigo;
          const descricao = parts[3] || 'LANCAMENTO';
          const debito = parseFloat(parts[4] || '0') || 0;
          const credito = parseFloat(parts[5] || '0') || 0;
          parsedItems.push({
            id: crypto.randomUUID(),
            dataInicio,
            codigo,
            classificacao,
            descricao: descricao.toUpperCase(),
            saldoInicial: 0,
            debito,
            credito,
            saldoFinal: debito - credito,
            natureza: debito >= credito ? 'D' : 'C',
          });
          logs.push(`Lançamento "${descricao}" importado.`);
        }
        else if (dataType === 'folha') {
          // Nome; Salario
          const name = parts[0] || 'CLT IMPORTANTE';
          const baseSalary = parseFloat(parts[1] || '0') || 2500;

          // Automate calculations
          const inss = baseSalary * 0.11;
          const fgts = baseSalary * 0.08;
          const irrf = baseSalary > 3000 ? (baseSalary * 0.075) : 0;
          const net = baseSalary - inss - irrf;

          parsedItems.push({
            id: crypto.randomUUID(),
            name: name.toUpperCase(),
            baseSalary,
            inss,
            fgts,
            irrf,
            net
          });
          logs.push(`Colaborador "${name}" calculado e importado.`);
        }
      } catch (err) {
        logs.push(`[Linha ${index + 1}] Erro insignificante ao interpretar. Linha saltada.`);
      }
    });

    setImportedLogs(logs);
    return parsedItems;
  };

  const handleXlsxUpload = () => {
    fileInputRefXlsx.current?.click();
  };

  const handleTxtUpload = () => {
    fileInputRefTxt.current?.click();
  };



  const handleBalanceteDominioPdfUpload = () => {
    if (!balanceteSaldoData.trim()) {
      setErrorMsg('Informe a data do saldo antes de importar o PDF — sem data a conta não aparece em nenhum mês do comparativo.');
      return;
    }
    fileInputRefBalanceteDominio.current?.click();
  };

  const processBalanceteDominioPdf = async (file: File) => {
    setLoading(true);
    setLoadingStep('Lendo PDF Balancete Sistema Domínio...');
    setErrorMsg('');
    setSuccessMsg('');
    setImportedLogs([]);

    try {
      const result = await parseBalanceteSaldoDominioPdf(file);
      const { balanceteRows, planoRows, logs } = result;

      if (balanceteRows.length === 0) {
        setErrorMsg('Nenhuma conta encontrada no PDF. Verifique se é um relatório "Balancete" exportado pelo Sistema Domínio.');
        return;
      }

      const dataBr = balanceteSaldoData.trim()
        ? balanceteSaldoData.split('-').reverse().join('/')
        : undefined;

      // Linhas de "SALDO ANTERIOR" precisam de data <= início do período visualizado,
      // senão montarBalanceteComPeriodo as ignora (filtro t > deTime).
      // Usa a data de início do período detectado no PDF para SI, e a data do
      // usuário (fim do período) para movimentos.
      let dataSI = dataBr;
      if (result.periodoDetectado) {
        const m = result.periodoDetectado.match(/(\d{2}\/\d{2}\/\d{4})/);
        if (m) dataSI = m[1];
      }

      const finalRows = balanceteRows.map((r) => {
        const isSA = r.nome === 'SALDO ANTERIOR';
        const dataRow = isSA ? (dataSI || dataBr) : dataBr;
        return { ...r, data: r.data || dataRow };
      });

      // A troca de lançamentos na reimportação (ver `saveRazao` em ManagerModule)
      // usa o NOME DO ARQUIVO como chave para saber o que substituir — e o Sistema
      // Domínio sempre exporta esse relatório com o mesmo nome genérico
      // ("Balancete.pdf"), repetido em toda pasta de saldo anterior mês a mês.
      // Sem diferenciar, importar o saldo anterior de um mês novo apagava
      // silenciosamente o saldo inicial já importado de um mês anterior (mesmo
      // nome de arquivo = mesmo importId = "substituir"), fazendo o saldo
      // inicial "sumir" do balancete. Anexa o período detectado (ou a data
      // informada) ao nome para dar a cada mês sua própria chave — a mesma
      // reimportação do MESMO mês continua idempotente (mesmo período → mesma
      // chave → substitui a si mesma corretamente).
      const periodoParaChave = result.periodoDetectado || dataSI || dataBr || '';
      const nomeImportacao = periodoParaChave ? `${file.name} [${periodoParaChave}]` : file.name;
      onRazaoImport?.(finalRows, nomeImportacao);

      const contasComSI = finalRows.filter((r) => (r.saldoInicial ?? 0) > 0).length;
      const contasComSF = finalRows.filter((r) => (r.saldoFinal ?? 0) > 0).length;

      setImportedLogs([
        ...logs,
        `${contasComSI} conta(s) com saldo inicial (anterior).`,
        `${contasComSF} conta(s) com saldo final (atual).`,
        ...(result.periodoDetectado ? [`Período detectado: ${result.periodoDetectado}`] : []),
        ...(result.empresaDetectada ? [`Empresa: ${result.empresaDetectada}`] : []),
      ]);
      setSuccessMsg(`BALANCETE DOMÍNIO IMPORTADO! ${finalRows.length} conta(s) com saldos carregada(s).`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Falha ao processar o PDF do Balancete Domínio.');
    } finally {
      setLoading(false);
      setLoadingStep('');
    }
  };

  const handleFileChangeBalanceteDominio = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const input = e.target;
    if (file) {
      void processBalanceteDominioPdf(file).finally(() => { input.value = ''; });
    }
  };


  const handleDominioPdfUpload = (kind: 'plano' | 'balancete') => {
    dominioPdfTargetRef.current = kind;
    setDominioPdfKind(kind);
    fileInputRefPdfDominio.current?.click();
  };

  const isDominioPdfFile = (file: File) => {
    const n = file.name.toLowerCase();
    return file.type === 'application/pdf' || n.endsWith('.pdf');
  };

  const processDominioPdfFile = async (file: File, kind: 'plano' | 'balancete') => {
    setLoading(true);
    setLoadingStep(
      kind === 'plano'
        ? 'Lendo PDF Domínio do plano de contas...'
        : 'Lendo PDF Domínio do razão...',
    );
    setErrorMsg('');
    setSuccessMsg('');
    setImportedLogs([]);
    setDominioPdfKind(kind);

    try {
      const pages = await parseAndRenderAllPDFPages(file);
      if (pages.length === 0) {
        setErrorMsg('Nenhuma página encontrada no PDF do Sistema Domínio.');
        return;
      }

      const columnIds =
        kind === 'plano'
          ? ['codigoReduzido', 'codigoClassificacao', 'descricao', 'tipo', 'nivel']
          : [
            'data',
            'descricao',
            'contaPartida',
            'contaContrapartida',
            // Débito e Crédito são colunas separadas no razão do Domínio (o valor
            // não traz sufixo D/C). `valorDc` continua na lista para os layouts
            // de coluna única — o mapeamento só usa os ids que existirem.
            'debito',
            'credito',
            'valorDc',
            'saldoPeriodo',
            'saldoExercicio',
          ];
      let templateColumns = buildDefaultColumnMapping(columnIds);
      const extractedRows = [];

      for (const page of pages) {
        setLoadingStep(
          kind === 'plano'
            ? `Interpretando plano Domínio — página ${page.pageNumber}/${pages.length}...`
            : `Interpretando razão Domínio — página ${page.pageNumber}/${pages.length}...`,
        );

        if (page.pageNumber === 1) {
          const posItems = page.textItems.map((t) => ({
            str: t.text,
            x: t.x,
            y: t.y,
            w: t.width,
            h: t.height,
          }));
          const suggested =
            kind === 'plano'
              ? suggestPlanoContasColumns(posItems, page.width)
              : suggestRazaoDominioColumns(posItems, page.width);
          if (suggested?.columns.some((c) => c.start !== c.end)) {
            const mapped = genericColumnsToPercentMapping(suggested.columns, page.width);
            if (Object.keys(mapped).length >= 2) {
              templateColumns = { ...templateColumns, ...mapped };
            }
          }
        }

        if (kind === 'plano') {
          const pageColumns = resolvePlanoColumnsForPage(
            page.textItems,
            page.width,
            columnIds,
            templateColumns,
          );
          const rowClusters = detectPlanoRowsFromText(page.textItems);
          extractedRows.push(
            ...extractPlanoDataFromCanvas(
              page.canvas,
              columnIds,
              pageColumns,
              rowClusters,
              page.pageNumber,
            ),
          );
        } else {
          const pageColumns = resolveRazaoColumnsForPage(
            page.textItems,
            page.width,
            columnIds,
            templateColumns,
          );
          const rowClusters = detectRazaoRowsFromText(page.textItems);
          extractedRows.push(
            ...extractRazaoDataFromCanvas(
              page.canvas,
              columnIds,
              pageColumns,
              rowClusters,
              page.pageNumber,
            ),
          );
        }
      }

      if (extractedRows.length === 0) {
        setErrorMsg(
          kind === 'plano'
            ? 'O parser não encontrou contas no PDF Domínio. Verifique se o arquivo é o relatório Plano de Contas com texto selecionável.'
            : 'O parser não encontrou lançamentos no PDF Domínio. Verifique se o arquivo é o relatório Razão com texto selecionável.',
        );
        return;
      }

      if (kind === 'plano') {
        const rows = mapGenericRowsToOcrRows(
          applyPlanoTipoInferenceToRows(extractedRows),
          columnIds,
        );
        const mapped = mapOcrRowsToImportItemsWithPlanoInfer('plano', rows);
        if (mapped.items.length === 0) {
          setErrorMsg('O parser leu o PDF Domínio, mas nenhuma conta válida foi convertida.');
          return;
        }
        onImport(mapped.items);
        setImportedLogs([
          `${mapped.items.length} conta(s) importada(s) do PDF Domínio.`,
          ...mapped.logs,
        ]);
        setSuccessMsg(`PDF DOMÍNIO IMPORTADO! ${mapped.items.length} conta(s) no plano.`);
        return;
      }

      const rows = mapGenericRowsToOcrRows(extractedRows, columnIds);
      const { items, logs } = mapOcrRowsToRazaoVision(rows);
      if (items.length === 0) {
        setErrorMsg('O parser leu o PDF Domínio, mas nenhum lançamento válido foi convertido.');
        return;
      }
      onRazaoImport?.(normalizeRazaoImport(items), file.name);
      setImportedLogs([
        `${items.length} lançamento(s) importado(s) do PDF Razão Domínio.`,
        ...logs,
      ]);
      setSuccessMsg(`PDF RAZÃO DOMÍNIO IMPORTADO! ${items.length} lançamento(s) no razão.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao processar PDF Domínio.';
      setErrorMsg(msg);
    } finally {
      setDominioPdfKind(null);
      setLoading(false);
      setLoadingStep('');
    }
  };

  const handleOfxUpload = () => {
    fileInputRefOfx.current?.click();
  };

  const processOfxFile = async (file: File, ctx: OfxExtratoImportContext) => {
    if (dataType !== 'extrato') {
      setErrorMsg('Importação OFX está disponível apenas na aba Extrato Bancário.');
      return;
    }
    if (!ctx.contaBanco?.trim()) {
      setErrorMsg('Informe a conta contábil do banco.');
      return;
    }
    if (!ctx.bancoNome?.trim()) {
      setErrorMsg('Informe o nome do banco.');
      return;
    }
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    setImportedLogs([]);
    publishExtratoSkippedLog([]);
    setLoadingStep('Lendo arquivo OFX/QFX...');
    try {
      if (selectedCompany?.trim()) {
        saveExtratoBancoParaImportacao(selectedCompany, ctx.bancoNome.trim(), ctx.contaBanco.trim());
      }
      const { items, saldoAnterior, conciliacao, logs } = await importOfxFileToExtratoItems(file, ctx);
      if (items.length === 0) {
        setErrorMsg(logs[0] ?? 'Nenhum lançamento encontrado no arquivo OFX.');
        return;
      }
      onImport(items, conciliacao?.saldoAnterior ?? saldoAnterior);
      if (conciliacao) onExtratoConciliacao?.(conciliacao);
      setImportedLogs(logs);
      const saldoMsg =
        conciliacao != null
          ? ` Débitos R$ ${conciliacao.debitos.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} · Créditos R$ ${conciliacao.creditos.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`
          : saldoAnterior != null && saldoAnterior > 0
            ? ` Saldo anterior R$ ${saldoAnterior.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} aplicado.`
            : '';
      const concMsg = conciliacao
        ? conciliacao.ok
          ? ` ✓ ${conciliacao.mensagem}`
          : ` ⚠ ${conciliacao.mensagem}`
        : '';
      setSuccessMsg(`IMPORTAÇÃO OFX! ${items.length} lançamento(s) carregado(s).${saldoMsg}${concMsg}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao processar o arquivo OFX.';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
      setLoadingStep('');
    }
  };

  const isImageOrPdf = (file: File) => {
    const n = file.name.toLowerCase();
    const t = (file.type || '').toLowerCase();
    return (
      n.endsWith('.pdf') ||
      t.includes('pdf') ||
      n.endsWith('.png') ||
      n.endsWith('.jpg') ||
      n.endsWith('.jpeg') ||
      n.endsWith('.webp') ||
      t.startsWith('image/')
    );
  };

  const publishExtratoSkippedLog = (entries: ImportSkippedEntry[]) => {
    if (dataType !== 'extrato') return;
    onExtratoSkippedLog?.(entries);
  };

  const handleOcrConfirm = (
    rows: GenericOcrRow[],
    meta?: any,
  ) => {
    const ocrFileName = pendingOcrFile?.name;
    const wasSaldoMode = balanceteSaldoMode;
    setPendingOcrFile(null);
    setDominioPdfKind(null);
    setExtratoDocumentKind(null);
    setBalanceteSaldoMode(false);
    if (dataType === 'balancete') {
      const { items: rawItems, logs } = mapOcrRowsToRazaoVision(rows);
      const items =
        wasSaldoMode && balanceteSaldoData.trim()
          ? rawItems.map((item) => ({
              ...item,
              data: item.data || balanceteSaldoData.split('-').reverse().join('/'),
            }))
          : rawItems;
      if (items.length === 0) {
        setErrorMsg(
          wasSaldoMode
            ? 'Nenhuma conta convertida. Verifique se código reduzido/classificação, descrição e saldo final foram marcados.'
            : 'Nenhum lançamento convertido a partir do OCR.',
        );
        return;
      }
      onRazaoImport?.(items, ocrFileName);
      setImportedLogs(logs);
      setSuccessMsg(
        wasSaldoMode
          ? `SALDOS IMPORTADOS! ${items.length} conta(s) carregada(s).`
          : `OCR CONCLUÍDO! ${items.length} lançamento(s) no razão.`,
      );
      return;
    }

    const userIgnoreWords = parseOcrIgnoreLineWords(getOcrUserSettings().ignoreLineWords);
    // Recorte do leitor: mesmos lançamentos/Entradas/Saídas do placar → conciliação 1:1.
    if (dataType === 'extrato' && rowsSaoRecorteFiel(rows)) {
      const fiel = mapRecorteFielRowsToImportItems(rows, meta);
      if (fiel.items.length === 0) {
        const errText = 'Nenhum lançamento válido no recorte para conciliação.';
        setErrorMsg(errText);
        return;
      }
      onImport(fiel.items, fiel.saldoAnteriorDetectado);
      setImportedLogs(fiel.logs);
      setSuccessMsg(
        `OCR CONCLUÍDO! ${fiel.items.length} registro(s) importado(s) (recorte fiel). ✓ ${fiel.conciliacao.mensagem}`,
      );
      onExtratoConciliacao?.(fiel.conciliacao);
      void flushPersistenceAfterCriticalWrite();
      return;
    }
    const mappedRaw =
      dataType === 'plano'
        ? mapOcrRowsToImportItemsWithPlanoInfer(dataType, rows)
        : mapOcrRowsToImportItems(
          dataType,
          rows,
          dataType === 'extrato'
            ? {
              ...resolveExtratoMapImportOptions(
                rows,
                userIgnoreWords,
                {
                  fileName: ocrFileName,
                  logToConsole: true,
                },
              ),
              extratoPreserveSegmentRows: true,
              extratoLiteralMode: true,
              cleanupWords: userIgnoreWords?.join(' '), // Passa cleanup rules como string
              // Placar/OK: só lançamentos (Anterior + C − D). Não passa saldo de PDF/OCR.
              extratoConciliacaoRawRows: undefined,
              extratoSaldoFinalEsperado: undefined,
              extratoSaldoAnteriorEsperado: meta?.saldoAnterior ?? undefined,
            }
            : undefined,
        );
    let items = mappedRaw.items as any[];
    let logs = mappedRaw.logs;
    const saldoAnteriorDetectado =
      'saldoAnteriorDetectado' in mappedRaw ? mappedRaw.saldoAnteriorDetectado : undefined;
    let skipped =
      'skipped' in mappedRaw && Array.isArray(mappedRaw.skipped) ? mappedRaw.skipped : [];
    const conciliacao = 'conciliacao' in mappedRaw ? mappedRaw.conciliacao : undefined;
    if (dataType === 'extrato' && rows.length > 0 && items.length < rows.length) {
      const noLossItems = buildExtratoItemsNoLoss(rows, userIgnoreWords);
      if (noLossItems.length > 0 && noLossItems.length >= items.length) {
        logs = [
          ...logs,
          `Ajuste anti-perda: mantidos ${noLossItems.length} item(ns) sem violar faixa/palavras ignoradas.`,
        ];
        items = noLossItems;
      }
    }
    if (dataType === 'extrato' && rows.length > 0 && items.length > 0) {
      const compared = motorComparacaoExtrato(items as ExtratoImportItemLike[], rows);
      items = compared.items;
      if (compared.logs.length > 0) logs = [...logs, ...compared.logs];
    }
    publishExtratoSkippedLog(skipped);
    if (items.length === 0) {
      const errText =
        rows.length === 0
          ? 'Nenhuma linha foi colada na tabela pelo OCR. Marque as colunas (dois cliques por coluna), use «Usar página inteira» se necessário e confirme novamente.'
          : `OCR leu ${rows.length} linha(s), mas nenhuma encaixou na tabela como registro válido. Revise o mapeamento das colunas (classificação + descrição no plano; data + histórico + valor no extrato).`;
      setErrorMsg(errText);
      return;
    }
    onImport(items, saldoAnteriorDetectado);
    setImportedLogs(logs);
    const saldoMsg =
      saldoAnteriorDetectado != null && saldoAnteriorDetectado > 0
        ? ` Saldo anterior R$ ${saldoAnteriorDetectado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} aplicado.`
        : '';
    const concMsg =
      dataType === 'extrato' && conciliacao
        ? conciliacao.ok
          ? ` ✓ ${conciliacao.mensagem}`
          : ` ⚠ ${conciliacao.mensagem}`
        : '';
    setSuccessMsg(`OCR CONCLUÍDO! ${items.length} registro(s) importado(s).${saldoMsg}${concMsg}`);

    if (dataType === 'extrato') {
      if (conciliacao) onExtratoConciliacao?.(conciliacao);
    }
  };

  const handleParcelamentoOcrConfirm = (data: ParcelamentoPlanilhaImport) => {
    setPendingOcrFile(null);
    if (data.linhas.length === 0) {
      setErrorMsg('Nenhuma parcela extraída do documento.');
      return;
    }
    onParcelamentoOcrImport?.(data);
    setImportedLogs([
      `${data.linhas.length} parcela(s) importada(s) via OCR.`,
      ...(data.clienteNome.trim() ? [`Cliente: ${data.clienteNome.trim()}`] : []),
    ]);
    setSuccessMsg(`OCR CONCLUÍDO! ${data.linhas.length} parcela(s) no cronograma.`);
  };

  const processFile = async (file: File, format: 'xlsx' | 'txt' | 'pdf') => {
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    setImportedLogs([]);
    if (dataType === 'extrato') publishExtratoSkippedLog([]);

    const effectiveFormat = resolveImportFormat(file, format);
    const isPdfFile = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const isRasterImage = isImageOrPdf(file) && !isPdfFile;

    try {
      if (pdfOnly) {
        if (effectiveFormat === 'pdf' || isImageOrPdf(file)) {
          if (dataType === 'extrato') {
            setExtratoDocumentKind('native_text');
            setLoadingStep('Abrindo extrato com texto nativo…');
          } else {
            setLoadingStep('Abrindo documento para recorte...');
          }
          setLoading(false);
          setPendingOcrFile(file);
          return;
        }
        setErrorMsg('Nesta aba só é permitido PDF ou imagem via sistema de recorte.');
        setLoading(false);
        return;
      }

      // Extrato + Excel: precisa saber o banco antes de importar (mesma exigência do OFX) —
      // sem isso, os lançamentos caem sem conta contábil de contrapartida do banco.
      if (dataType === 'extrato' && effectiveFormat === 'xlsx') {
        setLoading(false);
        openXlsxExtratoImportDialog(file);
        return;
      }

      // Planilhas estruturadas: conversão direta. PDF abre o modal sem OCR.
      if (
        dataType !== 'fiscal' &&
        canUseNativeConverter(dataType, file) &&
        effectiveFormat === 'xlsx'
      ) {
        const { items, logs } = await ingestNativeFile(dataType, file, setLoadingStep);
        if (items.length === 0) {
          setErrorMsg('Nenhum registro convertido. Verifique o arquivo ou use o modelo TXT.');
        } else if (dataType === 'balancete') {
           onRazaoImport?.(
            items as import('../../extratoVision/types/accounting').VisionBalanceteRow[],
            file.name,
          );
          setImportedLogs(logs);
          setSuccessMsg(`CONVERSÃO CONCLUÍDA! ${items.length} lançamento(s) no razão.`);
        } else if (dataType === 'plano') {
          onImport(finalizePlanoImport(items as Parameters<typeof finalizePlanoImport>[0]));
          setImportedLogs(logs);
          setSuccessMsg(`CONVERSÃO CONCLUÍDA! ${items.length} conta(s) importada(s).`);
        } else {
          onImport(items);
          setImportedLogs(logs);
          setSuccessMsg(`CONVERSÃO CONCLUÍDA! ${items.length} registro(s) importado(s).`);
        }
        setLoading(false);
        return;
      }

      if (effectiveFormat === 'pdf' || isImageOrPdf(file)) {
        if (dataType === 'extrato') {
          setExtratoDocumentKind('native_text');
          setLoadingStep('Abrindo extrato com texto nativo…');
          setPendingOcrFile(file);
          setLoading(false);
          return;
        }
        // Balancete PDF: tenta parser direto (texto nativo) antes de abrir o
        // recortador — o Domínio exporta balancete com layout tabular que o
        // parser reconhece perfeitamente sem precisar de alinhamento manual.
        if (dataType === 'balancete' && isPdfFile) {
          try {
            setLoadingStep('Lendo PDF do balancete (texto nativo)...');
            const { rows, logs } = await parseNotaExplicativaBalanceteFile(file);
            if (rows.length > 0) {
              // Aplica a data do saldo informada pelo usuário (obrigatória no
              // modo "Importar Saldo") — sem ela a conta não aparece em nenhum
              // mês do comparativo.
              const dataBr = balanceteSaldoMode && balanceteSaldoData.trim()
                ? balanceteSaldoData.split('-').reverse().join('/')
                : undefined;
              const finalRows = dataBr
                ? rows.map((r: import('../../extratoVision/types/accounting').VisionBalanceteRow) => ({ ...r, data: r.data || dataBr }))
                : rows;
              // Mesmo problema do outro parser de balancete acima: nome de arquivo
              // genérico ("Balancete.pdf") repetido mês a mês faz a reimportação de
              // um mês novo apagar o saldo inicial de um mês já importado, pois a
              // troca em `saveRazao` casa por nome de arquivo. Diferencia pela data
              // do saldo informada pelo usuário (única info de período disponível
              // aqui, já que este parser não detecta o período do próprio PDF).
              const nomeImportacao = dataBr ? `${file.name} [${dataBr}]` : file.name;
              onRazaoImport?.(finalRows, nomeImportacao);
              const contasComSaldo = finalRows.filter((r) => (r.saldoInicial ?? 0) > 0 || r.naturezaSaldoInicial).length;
              const primeirasCom = finalRows.filter((r) => (r.saldoInicial ?? 0) > 0 || r.naturezaSaldoInicial).slice(0, 3);
              const primeirasDetalhes = primeirasCom.map((r) =>
                `${r.codigo} ${r.nome}: SI=${r.saldoInicial}${r.naturezaSaldoInicial || ''}`
              );
              setImportedLogs([
                ...logs,
                `Saldos iniciais importados: ${contasComSaldo} conta(s) com saldo anterior.`,
                ...(primeirasDetalhes.length > 0 ? [`Exemplos: ${primeirasDetalhes.join(' | ')}`] : []),
              ]);
              setSuccessMsg(`PDF BALANCETE IMPORTADO! ${finalRows.length} conta(s) carregada(s).`);
              setLoading(false);
              setBalanceteSaldoMode(false);
              return;
            }
          } catch (err) {
            // Modo "Importar Saldo" deve usar APENAS parser direto, não recortador
            if (balanceteSaldoMode) {
              const errMsg = err instanceof Error ? err.message : 'Erro desconhecido';
              setErrorMsg(`Falha ao ler o PDF do balancete. ${errMsg}. Verifique se o arquivo é um relatório Balancete do Sistema Domínio com texto selecionável.`);
              setLoading(false);
              setBalanceteSaldoMode(false);
              return;
            }
            // Para importação normal de lançamentos, abre recortador como fallback
            console.warn('Parser PDF direto falhou, abrindo recortador:', err instanceof Error ? err.message : 'Erro desconhecido');
          }
        }

        // Só abre recortador se NÃO está em modo "Importar Saldo"
        if (!balanceteSaldoMode) {
          setLoadingStep('Limpando e convertendo em imagem...');
          setLoading(false);
          setPendingOcrFile(file);
          return;
        }
        setErrorMsg('PDF não reconhecido. Verifique se é um balancete do Sistema Domínio.');
        setLoading(false);
        setBalanceteSaldoMode(false);
        return;
      }

      if (effectiveFormat === 'xlsx' && dataType === 'installments') {
        setLoadingStep('Lendo planilha de parcelamento...');
        const data = await importParcelamentoPlanilhaFile(file);
        if (data.linhas.length === 0) {
          setErrorMsg('Nenhuma parcela encontrada na planilha Excel.');
        } else {
          onParcelamentoOcrImport?.(data);
          setImportedLogs([
            `${data.linhas.length} parcela(s) importada(s) da planilha.`,
            ...(data.clienteNome.trim() ? [`Cliente: ${data.clienteNome.trim()}`] : []),
          ]);
          setSuccessMsg(`IMPORTAÇÃO CONCLUÍDA! ${data.linhas.length} parcela(s) no cronograma.`);
        }
        setLoading(false);
        return;
      }

      if (effectiveFormat === 'xlsx' && dataType === 'loans') {
        setLoadingStep('Lendo planilha de contratos...');
        const items = await parseEmprestimosExcelFile(file);
        if (items.length === 0) {
          setErrorMsg('Nenhum contrato encontrado. Baixe e preencha a planilha modelo Excel.');
        } else {
          onImport(items);
          setImportedLogs([`${items.length} contrato(s) importado(s) da planilha.`]);
          setSuccessMsg(`IMPORTAÇÃO CONCLUÍDA! ${items.length} contrato(s) carregado(s).`);
        }
        setLoading(false);
        return;
      }

      if (effectiveFormat === 'xlsx' && dataType === 'apps') {
        setLoadingStep('Lendo planilha de aplicações...');
        const items = await parseAplicacoesExcelFile(file);
        if (items.length === 0) {
          setErrorMsg('Nenhuma aplicação encontrada. Baixe e preencha a planilha modelo Excel.');
        } else {
          onImport(items);
          setImportedLogs([`${items.length} aplicação(ões) importada(s) da planilha.`]);
          setSuccessMsg(`IMPORTAÇÃO CONCLUÍDA! ${items.length} aplicação(ões) carregada(s).`);
        }
        setLoading(false);
        return;
      }

      if (effectiveFormat === 'xlsx') {
        setErrorMsg('Use a planilha modelo Excel deste módulo ou importe via TXT/PDF.');
        setLoading(false);
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha na conversão do arquivo.';
      setErrorMsg(msg);
      setLoading(false);
      return;
    }

    // TXT estruturado (modelo nativo ou Domínio)
    try {
      let content = await readTextFileSmart(file);
      content = content.replace(/^\uFEFF/, '');

      const txtFormat = detectContabilTxtFormat(content);

      if (txtFormat === 'plano_dominio' || txtFormat === 'plano_semicolon' || txtFormat === 'plano_sped') {
        if (dataType !== 'plano') {
          setErrorMsg(
            'Este arquivo é plano de contas. Importe na sub-aba Plano de Contas (botão Importar TXT).',
          );
          setLoading(false);
          return;
        }
        setLoadingStep('Interpretando TXT plano de contas (exportação Domínio)...');
        const visionRows = parsePlanoContasText(content);
        if (visionRows.length === 0) {
          setErrorMsg('Nenhuma conta reconhecida no arquivo de plano de contas.');
        } else {
          const accounts = visionPlanoRowsToAccountPlans(visionRows);
          onImport(accounts);
          setImportedLogs([`${accounts.length} conta(s) importada(s) do TXT plano de contas.`]);
          setSuccessMsg(`PLANO IMPORTADO! ${accounts.length} conta(s) carregada(s).`);
        }
        setLoading(false);
        return;
      }

      if (txtFormat === 'dominio_lanc') {
        setLoadingStep('Interpretando TXT lançamentos Domínio (01/02/03)...');
        const parsed = await parseDominioTxtFile(content);
        const visionRows = normalizeRazaoImport(parseDominioLancamentosTxt(content));

        if (dataType === 'folha') {
          if (parsed.folha.length === 0) {
            setErrorMsg('Nenhum lançamento válido no TXT Domínio.');
          } else {
            onImport(parsed.folha);
            setImportedLogs([`${parsed.folha.length} lançamento(s) Domínio importado(s).`]);
            setSuccessMsg(`IMPORTAÇÃO DOMÍNIO! ${parsed.folha.length} registro(s) na folha.`);
          }
          setLoading(false);
          return;
        }

        if (dataType === 'extrato') {
          const items = dominioVisionToExtratoRows(visionRows).map((row, index) => ({
            id: `dom-extrato-${Date.now()}-${index}`,
            date: row.date,
            description: row.description,
            value: row.value,
            nature: row.nature,
            accountCode: row.accountDebit || row.accountCredit || '1.01.02.0002',
            accountDebit: row.accountDebit,
            accountCredit: row.accountCredit,
            operationName: row.operationName,
            status: 'CONCILIADO' as const,
          }));
          if (items.length === 0) {
            setErrorMsg('Nenhum lançamento válido no TXT Domínio.');
          } else {
            onImport(items);
            setImportedLogs([`${items.length} lançamento(s) Domínio importado(s).`]);
            setSuccessMsg(`IMPORTAÇÃO DOMÍNIO! ${items.length} registro(s) no extrato.`);
          }
          setLoading(false);
          return;
        }

        if (visionRows.length === 0) {
          setErrorMsg('Nenhum lançamento válido no TXT Domínio.');
        } else if (!onRazaoImport) {
          setErrorMsg('Importação de razão indisponível nesta aba. Use Razão / Balancete.');
        } else {
          onRazaoImport(visionRows, file.name);
          setImportedLogs([`${visionRows.length} lançamento(s) Domínio importado(s) no razão.`]);
          setSuccessMsg(`RAZÃO IMPORTADO! ${visionRows.length} lançamento(s) carregado(s).`);
        }
        setLoading(false);
        return;
      }

      if (isTxtPlusDominio(content)) {
        setLoadingStep('Interpretando TXT+ partida dobrada Domínio...');
        
        // Para TXT+ com partida dobrada, pede a conta de banco APENAS em 5 abas:
        // BALANCETE, EXTRATO, LOANS (Empréstimos), APPS (Aplicações), INSTALLMENTS (Parcelamento)
        if (
          dataType === 'balancete' ||
          dataType === 'extrato' ||
          dataType === 'loans' ||
          dataType === 'apps' ||
          dataType === 'installments'
        ) {
          setTxtPlusPendingContent(content);
          setTxtPlusPendingFileName(file.name);
          setShowTxtPlusBancoModal(true);
          setLoading(false);
          return;
        }
        
        let items: unknown[] = [];
        const logs: string[] = [];
        if (dataType === 'folha') {
          items = parseTxtPlusToFolhaRelatorio(content);
          logs.push(`${items.length} linha(s) TXT+ importada(s) para folha.`);
          items = parseTxtPlusToFolhaRelatorio(content);
          logs.push(`${items.length} linha(s) TXT+ importada(s) para fiscal.`);
        } else {
          setErrorMsg('TXT+ Domínio é suportado em Extrato, Razão/Balancete, Folha, Aplicações, Empréstimos e Fiscal.');
          setLoading(false);
          return;
        }
        if (items.length === 0) {
          setErrorMsg('Nenhuma linha TXT+ válida encontrada.');
        } else {
          onImport(items);
          setImportedLogs(logs);
          setSuccessMsg(`IMPORTAÇÃO TXT+! ${items.length} registro(s) importado(s).`);
        }
        setLoading(false);
        return;
      }

      const parsed = parseTxtContent(content);
      if (parsed.length === 0) {
        const hint =
          txtFormat === 'unknown'
            ? ' Verifique se é PLANO DE CONTAS (Domínio largura fixa) ou LANÇAMENTOS (01/02/03). Use o botão Importar TXT.'
            : '';
        setErrorMsg(`Nenhuma linha do arquivo pôde ser convertida para o formato mapeado.${hint}`);
      } else if (dataType === 'balancete') {
        const razaoRows = migrateLegacyBalanceteToRazao(parsed);
        if (razaoRows.length === 0) {
          setErrorMsg('Nenhum lançamento válido no arquivo de razão.');
        } else {
          onRazaoImport?.(razaoRows, file.name);
          setSuccessMsg(`IMPORTAÇÃO CONCLUÍDA! ${razaoRows.length} lançamento(s) no razão.`);
        }
      } else if (dataType === 'plano') {
        onImport(finalizePlanoImport(parsed));
        setSuccessMsg(`IMPORTAÇÃO CONCLUÍDA! ${parsed.length} conta(s) importada(s).`);
      } else {
        onImport(parsed);
        setSuccessMsg(`IMPORTAÇÃO CONCLUÍDA! Adicionados ${parsed.length} registro(s) com sucesso.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao processar a conversão estrutural do arquivo.';
      setErrorMsg(msg);
    }
    setLoading(false);
  };

  const handleFileChangeXlsx = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const input = e.target;
    if (file) void processFile(file, 'xlsx').finally(() => { input.value = ''; });
  };

  const handleFileChangeTxt = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const input = e.target;
    if (file) void processFile(file, 'txt').finally(() => { input.value = ''; });
  };


  const handleFileChangePdfDominio = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const input = e.target;
    if (!file) return;
    if (!isDominioPdfFile(file)) {
      setErrorMsg('Use um arquivo PDF exportado pelo Sistema Domínio (.pdf).');
      input.value = '';
      return;
    }
    const kind = dominioPdfTargetRef.current ?? (dataType === 'balancete' ? 'balancete' : 'plano');
    setDominioPdfKind(kind);
    setErrorMsg('');
    setSuccessMsg('');
    void processDominioPdfFile(file, kind).finally(() => {
      input.value = '';
    });
  };

  const openOfxImportDialog = (file: File) => {
    const company = selectedCompany?.trim() ?? '';
    setOfxBancoNome(company ? getExtratoBancoNome(company) : '');
    setOfxContaBanco(company ? getExtratoBancoConta(company) : '');
    setPendingOfxFile(file);
    setErrorMsg('');
  };

  const cancelOfxImport = () => {
    setPendingOfxFile(null);
    setPendingXlsxExtratoFile(null);
    setOfxBancoNome('');
    setOfxContaBanco('');
  };

  const confirmOfxImport = () => {
    if (!pendingOfxFile) return;
    if (!ofxBancoNome.trim()) {
      setErrorMsg('Informe o nome do banco.');
      return;
    }
    if (!ofxContaBanco.trim()) {
      setErrorMsg('Informe a conta contábil do banco.');
      return;
    }
    const file = pendingOfxFile;
    const ctx: OfxExtratoImportContext = {
      bancoNome: ofxBancoNome.trim(),
      contaBanco: ofxContaBanco.trim(),
    };
    cancelOfxImport();
    void processOfxFile(file, ctx);
  };

  const openXlsxExtratoImportDialog = (file: File) => {
    const company = selectedCompany?.trim() ?? '';
    setOfxBancoNome(company ? getExtratoBancoNome(company) : '');
    setOfxContaBanco(company ? getExtratoBancoConta(company) : '');
    setPendingXlsxExtratoFile(file);
    setErrorMsg('');
  };

  const processXlsxExtratoFile = async (file: File, ctx: OfxExtratoImportContext) => {
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    setImportedLogs([]);
    publishExtratoSkippedLog([]);
    setLoadingStep('Lendo planilha do extrato...');
    try {
      const bancoNome = ctx.bancoNome?.trim() ?? '';
      if (selectedCompany?.trim()) {
        saveExtratoBancoParaImportacao(selectedCompany, bancoNome, ctx.contaBanco);
      }
      const { items, logs } = await ingestNativeFile('extrato', file, setLoadingStep, ctx.contaBanco);
      if (items.length === 0) {
        setErrorMsg('Nenhum registro convertido. Verifique o arquivo ou use o modelo Excel.');
      } else {
        onImport(items);
        setImportedLogs(logs);
        setSuccessMsg(`IMPORTAÇÃO CONCLUÍDA! ${items.length} lançamento(s) — banco ${bancoNome}.`);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Falha na conversão do arquivo.');
    } finally {
      setLoading(false);
      setLoadingStep('');
    }
  };

  const confirmXlsxExtratoImport = () => {
    if (!pendingXlsxExtratoFile) return;
    if (!ofxBancoNome.trim()) {
      setErrorMsg('Informe o nome do banco.');
      return;
    }
    if (!ofxContaBanco.trim()) {
      setErrorMsg('Informe a conta contábil do banco.');
      return;
    }
    const file = pendingXlsxExtratoFile;
    const ctx: OfxExtratoImportContext = {
      bancoNome: ofxBancoNome.trim(),
      contaBanco: ofxContaBanco.trim(),
    };
    cancelOfxImport();
    void processXlsxExtratoFile(file, ctx);
  };

  const handleFileChangeOfx = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const input = e.target;
    if (file) openOfxImportDialog(file);
    input.value = '';
  };

  return (
    <div className="bg-brand-sidebar border border-brand-border p-6 shadow-[4px_4px_0_0_#141414] space-y-6 overflow-hidden relative">
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest opacity-40 italic mb-1">Data Ingestion</p>
        <h4 className="text-sm font-black uppercase tracking-tight leading-tight">{title}</h4>
      </div>

      <div className="space-y-2 relative z-10">
        {/* Hidden inputs */}
        <input aria-label="Importar planilha Excel ou CSV"
          type="file"
          ref={fileInputRefXlsx}
          onChange={handleFileChangeXlsx}
          accept={dataType === 'plano' ? '.xlsx,.xls,.csv' : '.xlsx,.csv'}
          className="hidden"
        />
        <input aria-label="Importar arquivo texto ou CSV"
          type="file"
          ref={fileInputRefTxt}
          onChange={handleFileChangeTxt}
          accept=".txt,.csv"
          className="hidden"
          data-testid="ingest-txt-input"
        />
        {(dataType === 'plano' || dataType === 'balancete') && (
          <input
            aria-label={
              dataType === 'balancete'
                ? 'Importar PDF Razão Sistema Domínio'
                : 'Importar PDF Sistema Domínio'
            }
            type="file"
            ref={fileInputRefPdfDominio}
            onChange={handleFileChangePdfDominio}
            accept=".pdf,application/pdf"
            className="hidden"
            data-testid={
              dataType === 'balancete'
                ? 'ingest-balancete-dominio-pdf-input'
                : 'ingest-plano-dominio-pdf-input'
            }
          />
        )}
        {dataType === 'balancete' && (
          <input
            aria-label="Importar PDF Balancete Sistema Domínio"
            type="file"
            ref={fileInputRefBalanceteDominio}
            onChange={handleFileChangeBalanceteDominio}
            accept=".pdf,application/pdf"
            className="hidden"
            data-testid="ingest-balancete-saldo-dominio-input"
          />
        )}
        {dataType === 'extrato' && (
          <>
            <input
              aria-label="Importar OFX ou QFX"
              type="file"
              ref={fileInputRefOfx}
              onChange={handleFileChangeOfx}
              accept=".ofx,.qfx"
              className="hidden"
              data-testid="ingest-ofx-input"
            />
          </>
        )}

        {/* Action Buttons */}
        {extraTopAction && (
          <button
            type="button"
            onClick={extraTopAction.onClick}
            disabled={extraTopAction.disabled}
            title={extraTopAction.title}
            className="w-full flex items-center justify-between px-4 py-3 bg-brand-bg border border-brand-border hover:bg-brand-border hover:text-brand-bg transition-all text-[10px] font-bold uppercase tracking-widest disabled:opacity-50"
          >
            <span>{extraTopAction.label}</span>
            {extraTopAction.icon ?? <FileText size={14} />}
          </button>
        )}

        {pdfVariants && pdfVariants.length > 0 && (
          <div className="space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-brand-text/50">
              Tipo de PDF
            </p>
            <div className="flex flex-col gap-1.5">
              {pdfVariants.map((variant) => (
                <button
                  key={variant.id}
                  type="button"
                  onClick={() => {
                    setSelectedPdfVariant(variant.id);
                    onPdfVariantChange?.(variant.id);
                  }}
                  className={cn(
                    'w-full px-3 py-2 border text-left text-[10px] font-bold uppercase tracking-widest transition-all',
                    activePdfVariant === variant.id
                      ? 'bg-brand-border text-brand-bg border-brand-border'
                      : 'bg-brand-bg border-brand-border hover:bg-brand-sidebar/40',
                  )}
                >
                  {variant.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {supportsExcelImport && (
          <button
            type="button"
            onClick={() => downloadExcelModeloForDataType(dataType)}
            className="w-full flex items-center justify-between px-4 py-3 bg-brand-sidebar/40 border border-dashed border-brand-border hover:bg-brand-sidebar transition-all text-[10px] font-bold uppercase tracking-widest"
            title={`Baixar ${excelModeloFilenameForDataType(dataType)}`}
          >
            <span>Baixar planilha modelo (Excel)</span>
            <FileSpreadsheet size={14} />
          </button>
        )}

        {supportsExcelImport && (
          <button
            onClick={handleXlsxUpload}
            className="w-full flex items-center justify-between px-4 py-3 bg-brand-bg border border-brand-border hover:bg-brand-border hover:text-brand-bg transition-all text-[10px] font-bold uppercase tracking-widest"
          >
            <span>
              {dataType === 'plano'
                ? 'Importar Excel (modelo ou Domínio)'
                : 'Importar XLSX (Excel)'}
            </span>
            <Download size={14} />
          </button>
        )}

        {dataType === 'plano' && (
          <button
            type="button"
            onClick={() => handleDominioPdfUpload('plano')}
            className="w-full flex items-center justify-between px-4 py-3 bg-brand-bg border border-brand-border hover:bg-brand-border hover:text-brand-bg transition-all text-[10px] font-bold uppercase tracking-widest"
            title="PDF exportado pelo Sistema Domínio (relatório Plano de Contas)"
            data-testid="ingest-plano-dominio-pdf-btn"
          >
            <span>Importar PDF Sistema Domínio</span>
            <File size={14} />
          </button>
        )}

        {dataType === 'balancete' && (
          <button
            type="button"
            onClick={() => handleDominioPdfUpload('balancete')}
            className="w-full flex items-center justify-between px-4 py-3 bg-brand-bg border border-brand-border hover:bg-brand-border hover:text-brand-bg transition-all text-[10px] font-bold uppercase tracking-widest"
            title="PDF exportado pelo Sistema Domínio (relatório Razão contábil)"
            data-testid="ingest-balancete-dominio-pdf-btn"
          >
            <span>Importar PDF Razão Sistema Domínio</span>
            <File size={14} />
          </button>
        )}

        {!pdfOnly && !skipLegacyTxtButton && dataType !== 'extrato' && (
          <button
            onClick={handleTxtUpload}
            className="w-full flex items-center justify-between px-4 py-3 bg-brand-bg border border-brand-border hover:bg-brand-border hover:text-brand-bg transition-all text-[10px] font-bold uppercase tracking-widest"
          >
            <span>Importar TXT (Texto)</span>
            <FileText size={14} />
          </button>
        )}


        {!pdfOnly && dataType === 'extrato' && (
          <>
            <button
              onClick={handleOfxUpload}
              className="w-full flex items-center justify-between px-4 py-3 bg-brand-bg border border-brand-border hover:bg-brand-border hover:text-brand-bg transition-all text-[10px] font-bold uppercase tracking-widest"
            >
              <span>Importar OFX (Money)</span>
              <Landmark size={14} />
            </button>
            <button
              type="button"
              onClick={handleTxtUpload}
              className="w-full flex items-center justify-between px-4 py-3 bg-brand-bg border border-brand-border hover:bg-brand-border hover:text-brand-bg transition-all text-[10px] font-bold uppercase tracking-widest"
              title="Reimporta o mesmo TXT+ Domínio exportado pela conciliação (Exportar TXT+ Domínio), ou um TXT simples de lançamentos"
            >
              <span>Importar TXT (TXT+ Domínio)</span>
              <FileText size={14} />
            </button>
            <div className="space-y-1.5 pt-1.5 border-t border-brand-border/20">
              <button
                type="button"
                onClick={() => setShowConversor(true)}
                className="w-full flex items-center justify-between px-4 py-3 bg-brand-bg border border-brand-border hover:bg-brand-border hover:text-brand-bg transition-all text-[10px] font-bold uppercase tracking-widest"
                title="Conversor de Extratos com Texto (PDF com texto selecionável — extração inteligente de PDF para OFX). Para PDF/imagem sem texto, use o OCR."
              >
                <span>Conversor de Extratos com Texto</span>
                <FileText size={14} />
              </button>
              <button
                type="button"
                onClick={() => setShowOcrScanner(true)}
                className="w-full flex items-center justify-between px-4 py-3 bg-brand-bg border border-brand-border hover:bg-brand-border hover:text-brand-bg transition-all text-[10px] font-bold uppercase tracking-widest"
                title="Conversor de Extratos sem Texto (PDF escaneado/foto, via OCR Tesseract) — converte scanner/foto sem texto em PDF pesquisável"
              >
                <span>Conversor de Extratos sem Texto</span>
                <ScanSearch size={14} />
              </button>
            </div>
          </>
        )}


        {!pdfOnly && dataType === 'balancete' && (
          <div className="space-y-1.5">
            <label className="block text-[9px] font-bold uppercase tracking-widest text-brand-text/60">
              Data do saldo (obrigatório)
            </label>
            <input
              type="date"
              value={balanceteSaldoData}
              onChange={(e) => setBalanceteSaldoData(e.target.value)}
              className="w-full h-9 px-3 border border-brand-border rounded bg-brand-bg text-[11px] font-mono"
              data-testid="ingest-balancete-saldo-data-input"
            />
            <button
              type="button"
              onClick={handleBalanceteDominioPdfUpload}
              className="w-full flex items-center justify-between px-4 py-3 bg-brand-bg border-2 border-brand-border hover:bg-brand-border hover:text-brand-bg transition-all text-[10px] font-black uppercase tracking-widest"
              title="PDF Balancete exportado pelo Sistema Domínio — extrai saldo anterior, débito, crédito e saldo atual automaticamente"
              data-testid="ingest-balancete-dominio-saldo-btn"
            >
              <span>Importar Balancete Sistema Domínio</span>
              <FileText size={14} />
            </button>
          </div>
        )}

        {extraBottomAction && (
          <button
            type="button"
            onClick={extraBottomAction.onClick}
            disabled={extraBottomAction.disabled}
            title={extraBottomAction.title}
            className="w-full flex items-center justify-between px-4 py-3 bg-brand-bg border border-brand-border hover:bg-brand-border hover:text-brand-bg transition-all text-[10px] font-bold uppercase tracking-widest disabled:opacity-40"
          >
            <span>{extraBottomAction.label}</span>
            {extraBottomAction.icon ?? <ScanSearch size={14} />}
          </button>
        )}

        {!pdfOnly && (
          <button
            onClick={() => setShowDocModal(true)}
            className="w-full text-center text-[9px] font-bold uppercase tracking-widest text-brand-text/50 hover:text-brand-text flex items-center justify-center gap-1.5 pt-2"
          >
            <HelpCircle size={12} />
            Ver Instruções de Formato
          </button>
        )}
        {pdfOnly && (
          <p className="text-[9px] font-mono text-brand-text/45 leading-relaxed pt-1">
            Extração somente por recorte de PDF
            {pdfVariants?.length ? ` · modelo: ${activePdfVariant}` : ''}.
          </p>
        )}
      </div>

      {/* Loading Status Overlay */}
      {loading && (
        <div className="absolute inset-0 bg-brand-bg/95 z-20 flex flex-col items-center justify-center p-6 text-center space-y-4 border border-brand-border animate-fade-in">
          <RefreshCw className="animate-spin text-brand-text" size={32} />
          <div className="space-y-1">
            <h5 className="text-[10px] font-black uppercase tracking-widest">Processando Documento</h5>
            <p className="text-[9px] font-mono text-slate-500 uppercase">{loadingStep || 'Carregando arquivo...'}</p>
          </div>
        </div>
      )}

      {/* Success details overlay */}
      {successMsg && (
        <div className="p-4 border border-green-700 bg-green-500/10 text-green-854 space-y-2 relative animate-fade-in">
          <div className="flex items-start gap-2">
            <CheckCircle size={14} className="mt-0.5 shrink-0" />
            <div>
              <p className="text-[9px] font-black uppercase tracking-wider">Sucesso</p>
              <p className="text-[9px] font-bold leading-normal uppercase">{successMsg}</p>
            </div>
          </div>
          {importedLogs.length > 0 && (
            <div className="max-h-[100px] overflow-y-auto border-t border-green-700/20 pt-2 font-mono text-[8px] space-y-0.5 scrollbar-thin">
              {importedLogs.map((log, lIdx) => (
                <div key={lIdx} className="opacity-80">{log}</div>
              ))}
            </div>
          )}
          <button
            onClick={() => setSuccessMsg('')}
            className="absolute top-1 right-2 text-xs font-bold hover:opacity-100 opacity-60"
          >
            ×
          </button>
        </div>
      )}

      {/* Error layout */}
      {errorMsg && (
        <div className="p-4 border border-red-800 bg-red-655/10 text-red-751 space-y-1 relative animate-fade-in">
          <div className="flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <div>
              <p className="text-[9px] font-black uppercase tracking-wider">Erro de Importação</p>
              <p className="text-[9px] font-bold leading-normal uppercase">{errorMsg}</p>
            </div>
          </div>
          <button
            onClick={() => setErrorMsg('')}
            className="absolute top-1 right-2 text-xs font-bold hover:opacity-100 opacity-60"
          >
            ×
          </button>
        </div>
      )}

      {/* Format Helper Modal */}
      {showDocModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-brand-bg border border-brand-border w-full max-w-xl p-8 space-y-6 shadow-[8px_8px_0_0_#101010] relative">
            <button
              onClick={() => setShowDocModal(false)}
              className="absolute top-4 right-4 font-bold text-sm hover:opacity-100 opacity-50"
            >
              FECHAR [X]
            </button>

            <div className="space-y-1">
              <h3 className="text-sm font-black uppercase tracking-[0.2em] italic">Formatos de Arquivos Mapeados</h3>
              <p className="text-[10px] font-bold uppercase text-slate-500">Mapeamento para inserção direta no banco central local</p>
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <span className="text-[9px] font-black bg-brand-sidebar border border-brand-border px-1.5 py-0.5">TXT / CSV (Pipes, Vírgulas ou Ponto-e-vírgulas)</span>
                <p className="text-[9px] text-slate-400 font-bold uppercase pt-1">O arquivo TXT deve conter os valores separados por ponto-e-vírgula (;) ou barras verticais (|). Exemplo recomendado de linha:</p>
                <div className="p-3 bg-brand-sidebar text-[9px] font-mono border border-brand-border break-all leading-relaxed whitespace-pre-wrap">
                  {temp?.example}
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-[9px] font-black bg-brand-sidebar border border-brand-border px-1.5 py-0.5">XLSX (Tabela de Colunas)</span>
                <p className="text-[9px] text-slate-400 font-bold uppercase pt-1">
                  {supportsExcelImport
                    ? `Baixe a planilha modelo (${excelModeloFilenameForDataType(dataType)}) e preencha as colunas indicadas. Depois use «Importar XLSX».`
                    : 'Este módulo não usa Excel estruturado — prefira TXT ou OCR.'}
                </p>
                {supportsExcelImport && (
                  <div className="p-3 bg-brand-sidebar text-[9px] font-mono border border-brand-border leading-relaxed">
                    {temp?.cols}
                  </div>
                )}
              </div>

              {dataType === 'plano' ? (
                <div className="space-y-1">
                  <span className="text-[9px] font-black bg-brand-sidebar border border-brand-border px-1.5 py-0.5">PDF Sistema Domínio — Plano de Contas</span>
                  <p className="text-[9px] text-slate-400 font-bold uppercase pt-1">
                    Exporte o relatório Plano de Contas no Domínio em PDF e use «Importar PDF Sistema Domínio».
                    O sistema detecta colunas, classificação, reduzido e hierarquia automaticamente — sem OCR.
                  </p>
                </div>
              ) : null}

              {dataType === 'balancete' ? (
                <div className="space-y-1">
                  <span className="text-[9px] font-black bg-brand-sidebar border border-brand-border px-1.5 py-0.5">PDF Sistema Domínio — Razão</span>
                  <p className="text-[9px] text-slate-400 font-bold uppercase pt-1">
                    Exporte o relatório Razão no Domínio em PDF e use «Importar PDF Razão Sistema Domínio».
                    O sistema detecta data, histórico, conta, débito e crédito por lançamento — sem OCR.
                  </p>
                </div>
              ) : null}

              <div className="space-y-1">
                <span className="text-[9px] font-black bg-brand-sidebar border border-brand-border px-1.5 py-0.5">
                  PDF (Extração por Texto Nativo)
                </span>
                <p className="text-[9px] text-slate-400 font-bold uppercase pt-1">
                  Carregue PDF com texto nativo. O sistema abre o documento para você marcar colunas, delimitar início/fim e colar os dados do extrato na tabela.
                </p>
              </div>

              {extratoOfxHint && (
                <div className="space-y-1">
                  <span className="text-[9px] font-black bg-brand-sidebar border border-brand-border px-1.5 py-0.5">OFX / QFX (Money / Internet Banking)</span>
                  <p className="text-[9px] text-slate-400 font-bold uppercase pt-1">{extratoOfxHint}</p>
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-brand-border flex justify-end">
              <button
                onClick={() => setShowDocModal(false)}
                className="technical-button-primary text-[10px] py-1.5 px-6 font-bold"
              >
                ENTENDIDO
              </button>
            </div>
          </div>
        </div>
      )}

      {(pendingOfxFile || pendingXlsxExtratoFile) && (
        <div className="fixed inset-0 bg-black/60 z-[90] flex items-center justify-center p-4">
          <div
            className="bg-brand-bg border border-brand-border w-full max-w-md p-6 space-y-5 shadow-[8px_8px_0_0_#101010]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ofx-import-title"
          >
            <div className="space-y-1">
              <h3 id="ofx-import-title" className="text-sm font-black uppercase tracking-[0.15em]">
                {pendingOfxFile ? 'Importar OFX / QFX' : 'Importar Excel do Extrato'}
              </h3>
              <p className="text-[9px] font-bold uppercase text-slate-500 leading-relaxed">
                Informe o banco e a conta contábil antes de carregar os lançamentos.
              </p>
              <p
                className="text-[9px] font-mono opacity-60 truncate"
                title={(pendingOfxFile ?? pendingXlsxExtratoFile)!.name}
              >
                {(pendingOfxFile ?? pendingXlsxExtratoFile)!.name}
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="ofx-banco-nome" className="block text-[9px] font-bold uppercase opacity-55">
                Nome do banco *
              </label>
              <input
                id="ofx-banco-nome"
                type="text"
                value={ofxBancoNome}
                onChange={(e) => setOfxBancoNome(e.target.value)}
                placeholder="Ex.: Itaú, Bradesco, Sicoob"
                className="w-full border border-brand-border bg-brand-sidebar/30 text-[10px] py-2 px-2 font-mono"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="ofx-conta-banco" className="block text-[9px] font-bold uppercase opacity-55">
                Conta contábil do banco *
              </label>
              {(extratoPlanoOptions?.length ?? 0) > 0 ? (
                <ExtratoContaPicker
                  inputId="ofx-conta-banco"
                  value={ofxContaBanco}
                  options={extratoPlanoOptions!}
                  lookupOptions={extratoPlanoOptions!}
                  includeSinteticas
                  showNomeInline
                  placeholder="Selecione a conta banco…"
                  ariaLabel="Conta contábil do banco"
                  onChange={(code) => {
                    setOfxContaBanco(code);
                    const pick = extratoPlanoOptions?.find((p) => p.code === code || p.codigoReduzido === code);
                    if (pick && !ofxBancoNome.trim()) {
                      setOfxBancoNome(pick.name);
                    }
                  }}
                />
              ) : (
                <input
                  id="ofx-conta-banco"
                  type="text"
                  value={ofxContaBanco}
                  onChange={(e) => setOfxContaBanco(e.target.value)}
                  placeholder="Ex.: 1.01.02.0002"
                  className="w-full border border-brand-border bg-brand-sidebar/30 text-[10px] py-2 px-2 font-mono"
                />
              )}
            </div>

            <div className="flex gap-3 justify-end pt-2 border-t border-brand-border">
              <button type="button" onClick={cancelOfxImport} className="technical-button text-[10px] px-4 py-2">
                Cancelar
              </button>
              <button
                type="button"
                disabled={!ofxBancoNome.trim() || !ofxContaBanco.trim()}
                onClick={pendingOfxFile ? confirmOfxImport : confirmXlsxExtratoImport}
                className="technical-button-primary text-[10px] px-4 py-2 disabled:opacity-40"
              >
                Importar lançamentos
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TXT+ Balancete - Selecionar Conta de Banco */}
      {showTxtPlusBancoModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-brand-bg border border-brand-border w-full max-w-xl p-8 space-y-6 shadow-[8px_8px_0_0_#101010] relative">
            <button
              type="button"
              onClick={() => {
                setShowTxtPlusBancoModal(false);
                setTxtPlusPendingContent('');
                setTxtPlusPendingFileName('');
                setTxtPlusBancoConta('');
              }}
              className="absolute top-3 right-3 text-xl leading-none opacity-50 hover:opacity-100"
              aria-label="Fechar"
            >
              ×
            </button>

            <div className="space-y-2">
              <h3 className="text-sm font-black uppercase tracking-tight">
                Importar TXT+ — Qual é a conta de banco?
              </h3>
              <p className="text-[9px] opacity-60 leading-relaxed">
                Selecione a conta contábil do banco para o sistema identificar corretamente se cada valor é entrada (+) ou saída (-).
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="txtplus-banco-conta" className="block text-[9px] font-bold uppercase opacity-55">
                Conta contábil do banco *
              </label>
              {(extratoPlanoOptions?.length ?? 0) > 0 ? (
                <ExtratoContaPicker
                  inputId="txtplus-banco-conta"
                  value={txtPlusBancoConta}
                  options={extratoPlanoOptions!}
                  lookupOptions={extratoPlanoOptions!}
                  includeSinteticas
                  showNomeInline
                  placeholder="Selecione a conta banco…"
                  ariaLabel="Conta contábil do banco"
                  onChange={(code) => setTxtPlusBancoConta(code)}
                />
              ) : (
                <input
                  id="txtplus-banco-conta"
                  type="text"
                  value={txtPlusBancoConta}
                  onChange={(e) => setTxtPlusBancoConta(e.target.value)}
                  placeholder="Ex.: 1.01.02.0002"
                  className="w-full border border-brand-border bg-brand-sidebar/30 text-[10px] py-2 px-2 font-mono"
                />
              )}
            </div>

            <div className="flex gap-3 justify-end pt-2 border-t border-brand-border">
              <button
                type="button"
                onClick={() => {
                  setShowTxtPlusBancoModal(false);
                  setTxtPlusPendingContent('');
                  setTxtPlusPendingFileName('');
                  setTxtPlusBancoConta('');
                }}
                className="technical-button text-[10px] px-4 py-2"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!txtPlusBancoConta.trim()}
                onClick={() => {
                  if (!txtPlusBancoConta.trim()) return;
                  
                  if (dataType === 'balancete') {
                    // RAZÃO: usa parseTxtPlusToRazaoVision (partida dobrada)
                    const extratoRows = parseTxtPlusToExtratoRows(txtPlusPendingContent);
                    const razaoRows = parseTxtPlusToRazaoVision(
                      extratoRows,
                      txtPlusBancoConta
                    );
                    if (razaoRows.length === 0) {
                      setErrorMsg('Nenhuma linha TXT+ válida encontrada.');
                    } else {
                      onRazaoImport?.(razaoRows, txtPlusPendingFileName);
                      setImportedLogs([`${razaoRows.length} lançamento(s) TXT+ importado(s) no razão.`]);
                      setSuccessMsg(`IMPORTAÇÃO TXT+! ${razaoRows.length} lançamento(s) no razão.`);
                    }
                  } else if (dataType === 'extrato') {
                    // EXTRATO: usa parseTxtPlusToExtratoRowsExpanded (expande em 2 linhas por transação)
                    const expandedRows = parseTxtPlusToExtratoRowsExpanded(
                      txtPlusPendingContent,
                      txtPlusBancoConta
                    );
                    if (expandedRows.length === 0) {
                      setErrorMsg('Nenhuma linha TXT+ válida encontrada.');
                    } else {
                      const extratoItems = expandedRows.map((row, index) => ({
                        id: `txtplus-${Date.now()}-${index}`,
                        date: row.date,
                        description: row.description,
                        value: row.value,
                        nature: row.nature,
                        accountCode: row.accountDebit || row.accountCredit || '1.01.02.0002',
                        accountDebit: row.accountDebit,
                        accountCredit: row.accountCredit,
                        operationName: row.operationName,
                        status: 'CONCILIADO' as const,
                      }));
                      onImport(extratoItems);
                      setImportedLogs([`${extratoItems.length} lançamento(s) TXT+ importado(s) no extrato.`]);
                      setSuccessMsg(`IMPORTAÇÃO TXT+! ${extratoItems.length} lançamento(s) no extrato.`);
                    }
                  } else if (dataType === 'loans') {
                    // EMPRÉSTIMOS: expande em 2 linhas por transação
                    const expandedRows = parseTxtPlusToExtratoRowsExpanded(
                      txtPlusPendingContent,
                      txtPlusBancoConta
                    );
                    if (expandedRows.length === 0) {
                      setErrorMsg('Nenhuma linha TXT+ válida encontrada.');
                    } else {
                      const loanItems = expandedRows.map((row, index) => ({
                        id: `loan-txtplus-${Date.now()}-${index}`,
                        date: row.date,
                        description: row.description,
                        value: row.value,
                        nature: row.nature,
                        accountCode: row.accountDebit || row.accountCredit || '1.01.02.0002',
                        accountDebit: row.accountDebit,
                        accountCredit: row.accountCredit,
                        operationName: row.operationName,
                        status: 'CONCILIADO' as const,
                      }));
                      onImport(loanItems);
                      setImportedLogs([`${loanItems.length} lançamento(s) TXT+ importado(s) em empréstimos.`]);
                      setSuccessMsg(`IMPORTAÇÃO TXT+! ${loanItems.length} lançamento(s) em empréstimos.`);
                    }
                  } else if (dataType === 'apps') {
                    // APLICAÇÕES: expande em 2 linhas por transação
                    const expandedRows = parseTxtPlusToExtratoRowsExpanded(
                      txtPlusPendingContent,
                      txtPlusBancoConta
                    );
                    if (expandedRows.length === 0) {
                      setErrorMsg('Nenhuma linha TXT+ válida encontrada.');
                    } else {
                      const appItems = expandedRows.map((row, index) => ({
                        id: `app-txtplus-${Date.now()}-${index}`,
                        date: row.date,
                        description: row.description,
                        value: row.value,
                        nature: row.nature,
                        accountCode: row.accountDebit || row.accountCredit || '1.01.02.0002',
                        accountDebit: row.accountDebit,
                        accountCredit: row.accountCredit,
                        operationName: row.operationName,
                        status: 'CONCILIADO' as const,
                      }));
                      onImport(appItems);
                      setImportedLogs([`${appItems.length} lançamento(s) TXT+ importado(s) em aplicações.`]);
                      setSuccessMsg(`IMPORTAÇÃO TXT+! ${appItems.length} lançamento(s) em aplicações.`);
                    }
                  } else if (dataType === 'installments') {
                    // PARCELAMENTO: converte para formato de folha
                    const installmentItems = parseTxtPlusToFolhaRelatorio(txtPlusPendingContent);
                    if (installmentItems.length === 0) {
                      setErrorMsg('Nenhuma linha TXT+ válida encontrada.');
                    } else {
                      onImport(installmentItems);
                      setImportedLogs([`${installmentItems.length} linha(s) TXT+ importada(s) em parcelamento.`]);
                      setSuccessMsg(`IMPORTAÇÃO TXT+! ${installmentItems.length} linha(s) em parcelamento.`);
                    }
                  }
                  
                  setShowTxtPlusBancoModal(false);
                  setTxtPlusPendingContent('');
                  setTxtPlusPendingFileName('');
                  setTxtPlusBancoConta('');
                }}
                className="technical-button-primary text-[10px] px-4 py-2 disabled:opacity-40"
              >
                Importar lançamentos
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingOcrFile && dataType === 'extrato' ? (
        <Suspense fallback={null}>
          <BankPdfExtractModal
            file={pendingOcrFile}
            title={ocrConfig.title}
            companyName={selectedCompany}
            planoContaOptions={extratoPlanoOptions}
            initialDataInicio={ocrFiltroDataInicio}
            initialDataFim={ocrFiltroDataFim}
            initialBancoNome={ocrBancoNome}
            initialContaBanco={ocrContaBanco}
            onCancel={() => {
              setPendingOcrFile(null);
              setExtratoDocumentKind(null);
              setOcrFiltroDataInicio('');
              setOcrFiltroDataFim('');
              setOcrBancoNome('');
              setOcrContaBanco('');
            }}
            onConfirm={(rows, meta) => {
              setOcrFiltroDataInicio('');
              setOcrFiltroDataFim('');
              setOcrBancoNome('');
              setOcrContaBanco('');
              handleOcrConfirm(rows, meta);
            }}
          />
        </Suspense>
      ) : null}

      {showConversor && (
        <ExtratoConversorModal
          isOpen={showConversor}
          onClose={() => setShowConversor(false)}
          planoContaOptions={extratoPlanoOptions}
          onImport={(result, contaBanco, bancoNome, saldoAnteriorConversor) => {
            if (selectedCompany && contaBanco) {
              saveExtratoBancoParaImportacao(selectedCompany, bancoNome || 'Banco', contaBanco);
            }
            const items = result.transactions.map((tx, index) => ({
              id: `conversor-${Date.now()}-${index}`,
              date: tx.date,
              description: tx.description.toUpperCase(),
              value: Math.abs(tx.amount),
              nature: tx.amount >= 0 ? 'C' : 'D',
              accountCode: contaBanco || (selectedCompany ? getExtratoBancoConta(selectedCompany) : '1.01.02.0002'),
              status: 'PENDENTE' as const,
            }));
            onLog?.(`── CONVERSOR ${items.length} lançamento(s) banco=${contaBanco || '—'} (${bancoNome || '—'})`, 'conversor');
            // Saldo anterior digitado no conversor já vai preenchido para o card
            // do extrato — sem isso o usuário precisava digitar o mesmo valor duas vezes.
            onImport(
              items,
              Number.isFinite(saldoAnteriorConversor) && saldoAnteriorConversor !== 0
                ? saldoAnteriorConversor
                : undefined,
            );
            setShowConversor(false);
            setSuccessMsg(`CONVERSOR CONCLUÍDO! ${items.length} lançamento(s) importado(s).`);
          }}
        />
      )}

      {showOcrScanner && (
        <OcrSearchablePdfModal
          onClose={() => setShowOcrScanner(false)}
          planoContaOptions={extratoPlanoOptions}
          onComplete={(searchableFile, _text, _pdfUrl, dataInicio, dataFim, bancoNome, contaBanco, originalFile) => {
            setShowOcrScanner(false);
            onLog?.(`── OCR PDF pesquisável banco=${contaBanco || '—'} (${bancoNome || '—'}) de=${dataInicio || '—'} até=${dataFim || '—'}`, 'conversor');
            setOcrFiltroDataInicio(dataInicio ?? '');
            setOcrFiltroDataFim(dataFim ?? '');
            setOcrBancoNome(bancoNome ?? '');
            setOcrContaBanco(contaBanco ?? '');
            // Extrai a partir do PDF ORIGINAL: o servidor roda o próprio OCR e o
            // "searchable" (já re-renderizado pelo OCR do navegador) fazia sumir
            // lançamentos de valor pequeno, deixando o saldo final sem fechar.
            const paraExtrair = originalFile ?? searchableFile;
            if (paraExtrair) {
              void processFile(paraExtrair, 'pdf');
            }
          }}
        />
      )}

    </div>
  );
}
