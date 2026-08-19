import React, { lazy, Suspense, useState, useEffect, useMemo, useCallback, useRef, startTransition } from 'react';
import {
  Plus,
  FileSpreadsheet,
  Download,
  Upload,
  Search,
  Filter,
  BarChart,
  BookOpen,
  ClipboardList,
  Building,
  ArrowRightLeft,
  Trash2,
  Database,
  Lock,
  Building2,
  FileText,
  Layers,
  Percent,
  DollarSign,
  BookMarked,
  Scale,
  X,
  FileImage,
  RefreshCw,
  ListOrdered,
  FolderOpen,
  Save,
  AlertTriangle,
  Settings,
  Sparkles,
  Activity,
  Landmark,
} from 'lucide-react';
import type { ExtratoConciliacaoResumo } from '../logic/ocrImportMapper';
import { cn, formatCurrency, formatDate } from '../lib/utils';
import { isCnpjLike } from '../../lib/cnpjGuard';
import { deferIdle } from '../lib/deferIdle';
import { beginHeavyUiWork, endHeavyUiWork } from '../lib/uiFluidity';
import { patchDebugContext } from '../agent/debugContext';
import { registerManagerTabBot } from '../tabBot/registerModuleBots';
import { FreeNumericInput } from './FreeNumericInput';
import {
  CF_FIELD_COL,
  CF_FIELD_COL_GROW,
  CF_FIELD_ROW,
  CF_FORM_FIELDS,
  CF_FORM_INPUT_DATE,
  CF_FORM_INPUT_LONG,
  CF_FORM_INPUT_MED,
  CF_FORM_INPUT_MONEY,
  CF_FORM_INPUT_NUM,
  CF_FORM_INPUT_SHORT,
  CF_FORM_SELECT,
  CF_INPUT_ACCOUNT,
  CF_SELECT_WIDE,
} from '../lib/formFieldClasses';
import DataIngestionBox from './DataIngestionBox';
import BalanceteTabPanel from './BalanceteTabPanel';
import {
  readManagerData,
  writeManagerData,
  writeManagerDataNow,
  flushManagerDataWrites,
  normalizeCompanyName,
  companyStorageSlug,
  isSameCompanyScope,
  requireCompanyScope,
  validarElimparPlanoContas,
} from '../logic/companyWorkspace';
import {
  flushAllEyeVisionPersistence,
  flushPersistenceAfterCriticalWrite,
} from '../logic/eyeVisionPersistenceFlush';
import { readAutomatizacaoContaConfig } from '../../extratoVision/utils/automatizacaoContaConfig';
import { buildContaMatchKeys, contaMatchesKeys, parseDataRazao } from '../../extratoVision/utils/razaoContabil';
import PlanoContasVirtualTable, { type PlanoContaRow } from './PlanoContasVirtualTable';
import ExtratoLancamentosVirtualTable from './ExtratoLancamentosVirtualTable';
import ExtratoSemNotaModal from './ExtratoSemNotaModal';
import ExtratoRegrasContasModal from './ExtratoRegrasContasModal';
import AcoesCommandMenu, { type AcaoMenuItem } from './AcoesCommandMenu';
import ExtratoPastasModal from './ExtratoPastasModal';
import {
  countExtratoPastas,
  listExtratoPastas,
  listExtratoPastasPorBanco,
  groupExtratoPastasPorBanco,
  saveExtratoNaPasta,
  getExtratoPastaById,
  getExtratoPastaAtivaId,
  setExtratoPastaAtivaId,
  clearExtratoPastaAtivaId,
  updateExtratoPastaSaldoAnterior,
  updateExtratoPastaConciliacaoCounts,
  type ExtratoPastaItem,
} from '../logic/extratoPastasStorage';
import { reclaimLocalStorageSpace } from '../../lib/safeLocalStorage';
import {
  buildPlanoNomeLookup,
  resolveContaNome,
} from './ExtratoContaPicker';
import { FolhaRelatorioVirtualTable } from './FolhaVirtualTables';
import FiscalModule from './FiscalModule';
import NotaExplicativaTab from './NotaExplicativaTab';
import {
  brDateToIso,
  buildTxtPlusFromExtratoRows,
  buildTxtPlusFromFolhaRelatorio,
  downloadTxtPlusDominio,
  type ExtratoExportRow,
} from '../logic/dominioTxtIO';
import { loadAplicacaoContasExtrato } from '../logic/aplicacaoExtratoStorage';
import {
  filterAplicacaoRegrasPorConta,
  loadAplicacaoRegrasContas,
} from '../logic/aplicacaoRegrasContasStorage';
import { buildAplicacaoLancamentoContabil } from '../logic/aplicacaoExtratoLancamentos';
import { buildTxtPlusFromCustos, loadCustos } from '../logic/custosStorage';
import { prepareBalanceteTxtExport } from '../logic/balanceteTxtExport';
import {
  cleanStoredCodigoReduzido,
  codeLengthToPlanoLevel,
  buildDominioPlanoTxtFromAccounts,
  derivePlanoGroupFromCode,
  derivePlanoNatureFromGroup,
  migrateExtratoContasParaCodigoReduzido,
  normalizeExtratoContaParaGravacao,
  sanitizeCodigoReduzido,
  type PlanoGroup,
} from '../logic/planoContasMapper';
import { migrateLegacyBalanceteToRazao, normalizeRazaoImport, accountPlansToVisionPlano } from '../logic/contabilPipeline';
import { detectarContasNovas } from '../logic/planoContasAutoCriar';
import ContaPendenteRenomearRow from './ContaPendenteRenomearRow';
import {
  applyExtratoContaResolver,
  applyExtratoContaResolverAsync,
  findContaBancoNoPlano,
  type ExtratoSemNotaPendingRow,
} from '../logic/extratoContaResolver';
import { buildExtratoFiscalContext } from '../logic/extratoFiscalContext';
import { compareClassificacaoContabil } from '../../extratoVision/utils/demonstracoesContabeis';
import { tryAutoSyncFiscalSpedOnOpen } from '../logic/fiscalSpedAutomation';
import { tryAutoSyncFiscalPgdasOnOpen } from '../logic/fiscalPgdasAutomation';
import { postFolhaNoRazao } from '../logic/folhaAutomation';
import { loadFolhaRegras, type FolhaRegra } from '../logic/folhaContasAutomacaoStorage';
import { parseAndRenderPDFPage, openPdfDocument, pdfTextItemsToLines } from '../../lib/leitorRecortador/pdfParser';
import { parseFolhaTextMultiCompetencia } from '../../lib/folhaParser/folhaPDFParser';
import FolhaModule from './FolhaModule';

import {
  FOLHA_PDF_VARIANTS,
  folhaVariantDescriptionPrefix,
} from '../logic/ocrColunasConfig';
import HonorariosModule from './HonorariosModule';
import {
  loadExtratoSemNotaDecisions,
  saveExtratoSemNotaDecisions,
  type ExtratoSemNotaDecisions,
  type ExtratoSemNotaPolicy,
} from '../logic/extratoSemNotaStorage';
import {
  loadExtratoRegrasContas,
  filterExtratoRegrasPorBanco,
  normalizeExtratoMatchText,
  saveExtratoRegrasBancoSelecionado,
  saveExtratoRegrasContas,
  type ExtratoRegraConta,
} from '../logic/extratoRegrasContasStorage';
import {
  loadExtratoContaMappingCache,
  saveExtratoContaMappingCache,
} from '../logic/extratoContaMappingStorage';
import { getExtratoBancoConta, getExtratoBancoNome, setExtratoContaBancoAtiva } from '../logic/extratoOcrLayoutStorage';
import {
  readPersistedLocalStorageJson,
  writePersistedLocalStorageJson,
} from '../../lib/persistentLocalStorage';
import {
  exportExtratoConciliacaoPdf,
  exportExtratoConciliacaoPng,
} from '../logic/extratoConciliacaoExport';
import {
  filterExtratoByConciliacaoFiltro,
  isExtratoLancamentoConciliado,
  summarizeExtratoConciliacao,
  syncExtratoConciliacaoStatus,
  type ExtratoConciliacaoFiltro,
} from '../logic/extratoConciliacaoBank';
import {
  calcSaldoConciliadoAteMomento,
  resolveSaldoFinalExtrato,
  sumExtratoPlacarTotais,
  sumExtratoPlacarTotaisConciliados,
} from '../logic/extratoPlacarTotals';
import { postExtratoConciliadosNoRazao } from '../logic/extratoBalanceteAutomation';
import type { ConflitoDadoBalancete } from '../logic/extratoToRazao';
import { readReceitaFederalRegras } from '../../extratoVision/utils/receitaFederalRegras';
import { readFiscalContaMap } from '../../extratoVision/utils/fiscalContaMapping';
import { loadFiscalContasImposto } from '../logic/fiscalContasImpostoStorage';
import { warmupSharedOcrWorker } from '../../lib/imageOcrExtract';
import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';
import { RazaoContaLancamentosModal } from '../../extratoVision/components/RazaoContaLancamentosModal';
import TabLoadingFallback from './TabLoadingFallback';
import { ActiveCompanySelector } from './ActiveCompanySelector';
import type { CompanyWorkspaceControls } from '../types/companyWorkspaceControls';
import BalancetePeriodoModal, { type BalancetePeriodo } from './BalancetePeriodoModal';
import ExtratoPeriodoExportModal from './ExtratoPeriodoExportModal';

const LoanModule = lazy(() => import('./LoanModule'));
const InstallmentModule = lazy(() => import('./InstallmentModule'));
const AppsModule = lazy(() => import('./AppsModule'));
const FolhaContasAutomacaoPanel = lazy(() => import('./FolhaContasAutomacaoConfig'));
const CustosModule = lazy(() => import('./CustosModule'));
const IndiceLiquidezModule = lazy(() => import('./IndiceLiquidezModule'));
const ExtratoVisionWrapper = lazy(() =>
  import('../../extratoVision/ExtratoVisionWrapper').then((m) => ({
    default: m.ExtratoVisionWrapper,
  })),
);

export type ManagerSubTab =
  | 'extrato'
  | 'plano'
  | 'razao'
  | 'folha'
  | 'honorarios'
  | 'fiscal'
  | 'demonstracoes'
  | 'nota_explicativa'
  | 'emprestimos'
  | 'parcelamento'
  | 'aplicacoes'
  | 'custos'
  | 'indiceLiquidez';

const STANDALONE_MANAGER_TABS = new Set<ManagerSubTab>([
  'extrato',
  'plano',
  'nota_explicativa',
  'emprestimos',
  'parcelamento',
  'aplicacoes',
  'custos',
  'indiceLiquidez',
]);

function managerSubTabLabel(tab: ManagerSubTab): string {
  switch (tab) {
    case 'extrato':
      return 'Conciliador de Extratos';
    case 'plano':
      return 'Mapa de Plano de Contas';
    case 'razao':
      return 'Balancete';
    case 'fiscal':
      return 'Fiscal / Impostos';
    case 'folha':
      return 'Folha de Pagamento';
    case 'honorarios':
      return 'Honorários';
    case 'demonstracoes':
      return 'Demonstrações';
    case 'nota_explicativa':
      return 'Nota Explicativa';
    case 'emprestimos':
      return 'Empréstimos';
    case 'parcelamento':
      return 'Parcelamento';
    case 'aplicacoes':
      return 'Aplicações de empréstimo';
    case 'custos':
      return 'Custos & Faturamento';
    case 'indiceLiquidez':
      return 'Índice de Liquidez';
    default:
      return tab;
  }
}

interface AccountPlan {
  code: string;
  name: string;
  codigoReduzido?: string;
  tipo?: 'S' | 'A';
  nivel?: number;
  group?: 'ATIVO' | 'PASSIVO' | 'PATRIMONIO_LIQUIDO' | 'RECEITA' | 'DESPESA';
  nature?: 'DEVEDORA' | 'CREDORA';
  /** Criada automaticamente a partir de um lançamento do razão sem conta no plano — precisa de nome de verdade. */
  precisaRenomear?: boolean;
}

interface BalanceteRow {
  id: string;
  dataInicio: string;
  codigo: string;
  classificacao: string;
  descricao: string;
  tipo?: 'S' | 'A';
  saldoInicial: number;
  debito: number;
  credito: number;
  saldoFinal: number;
  natureza: 'D' | 'C';
}

interface BankStatement {
  id: string;
  date: string;
  description: string;
  value: number;
  nature: 'D' | 'C';
  accountCode: string;
  accountDebit?: string;
  accountCredit?: string;
  operationName?: string;
  /** Marca de origem: regra cadastrada que preencheu as contas (ver resolver). */
  regraContaId?: string;
  status: 'CONCILIADO' | 'PENDENTE';
}

interface FolhaRelatorioRow {
  id: string;
  date: string;
  description: string;
  debito: number;
  credito: number;
  tipo?: 'PROVENTOS' | 'DESCONTOS' | 'INFORMATIVA';
}

interface PayrollRecord {
  id: string;
  name: string;
  baseSalary: number;
  inss: number;
  fgts: number;
  irrf: number;
  net: number;
}

/** Normaliza texto de busca do extrato: minúsculas, sem acento, espaços colapsados. */
function normalizeExtratoBuscaTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Remove linhas de "saldo anterior/saldo do dia/etc." vindas de qualquer caminho de
 * importação (recortador, OFX, CSV, manual) — esses valores são só referência de
 * conferência e nunca podem virar lançamento na conciliação. Se algum desses
 * padrões trouxer valor, ele é aproveitado como sugestão de saldo anterior.
 */
function extrairESepararSaldoAnterior<T extends { description?: string; value?: number }>(
  items: T[],
): { rows: T[]; saldoAnteriorSugerido: number | null } {
  const SALDO_PATTERNS = [
    'SALDO ANTERIOR',
    'SALDO DO DIA',
    'SALDO ATUAL',
    'SALDO FINAL',
    'SALDO DISPONIVEL',
    'SALDO EM CONTA',
  ];
  let saldoAnteriorSugerido: number | null = null;
  const rows = items.filter((item) => {
    const desc = normalizeExtratoBuscaTexto(item.description || '').toUpperCase();
    const isSaldoRow = SALDO_PATTERNS.some((p) => desc.includes(p));
    if (!isSaldoRow) return true;
    if (saldoAnteriorSugerido == null && desc.includes('SALDO ANTERIOR') && Number.isFinite(item.value)) {
      saldoAnteriorSugerido = Math.abs(item.value as number);
    }
    return false;
  });
  return { rows, saldoAnteriorSugerido };
}

/** Busca por histórico (descrição/operação), código de contas ou valor — aceita "105,13", "105.13" ou "105". */
function extratoRowMatchesBusca(row: BankStatement, buscaNorm: string): boolean {
  if (!buscaNorm) return true;

  // Histórico / descrição
  const desc = normalizeExtratoBuscaTexto(row.description || '');
  const op = normalizeExtratoBuscaTexto(row.operationName || '');
  if (desc.includes(buscaNorm) || op.includes(buscaNorm)) return true;

  // Códigos de conta (accountCode, conta débito, conta crédito)
  const accCode = normalizeExtratoBuscaTexto(row.accountCode || '');
  const accDeb = normalizeExtratoBuscaTexto(row.accountDebit || '');
  const accCred = normalizeExtratoBuscaTexto(row.accountCredit || '');
  if (
    (accCode && accCode.includes(buscaNorm)) ||
    (accDeb && accDeb.includes(buscaNorm)) ||
    (accCred && accCred.includes(buscaNorm))
  )
    return true;

  // Valor numérico — aceita "105,13", "105.13" ou "105"
  const buscaComoValor = buscaNorm.replace(',', '.').replace(/[^0-9.]/g, '');
  if (!buscaComoValor) return false;
  const valorAbs = Math.abs(row.value ?? 0);
  const valorBr = valorAbs.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  const valorPlano = valorAbs.toFixed(2);
  return valorBr.includes(buscaNorm) || valorPlano.includes(buscaComoValor);
}

export interface ManagerModuleProps extends CompanyWorkspaceControls {
  storageVersion?: number;
  initialSubTab?: ManagerSubTab;
}

export default function ManagerModule({
  selectedCompany,
  companyOptions,
  onCompanyChange,
  onCreateCompany,
  onRenameCompany,
  onDeleteCompany,
  storageVersion = 0,
  initialSubTab,
}: ManagerModuleProps) {
  const [activeSubTab, setActiveSubTab] = useState<ManagerSubTab>(initialSubTab ?? 'extrato');

  useEffect(() => {
    if (initialSubTab) setActiveSubTab(initialSubTab);
  }, [initialSubTab]);

  // Limpeza única do antigo "Histórico de Importações" (removido — duplicava os
  // arquivos que já ficam salvos em TXTs Importados, na aba Balancete).
  useEffect(() => {
    try {
      const toRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key && key.startsWith('gc_import_history_v1')) toRemove.push(key);
      }
      toRemove.forEach((key) => window.localStorage.removeItem(key));
    } catch {
      // localStorage indisponível — nada a limpar.
    }
  }, []);

  useEffect(() => {
    patchDebugContext({
      module: 'manager',
      moduleLabel: 'Gerencial',
      subTab: activeSubTab,
      subTabLabel: managerSubTabLabel(activeSubTab),
      company: selectedCompany || undefined,
    });
  }, [activeSubTab, selectedCompany]);

  // Local states
  const [planoContas, setPlanoContas] = useState<AccountPlan[]>([]);
  const [extratoLancamentos, setExtratoLancamentos] = useState<BankStatement[]>([]);
  const [folhaPayroll, setFolhaPayroll] = useState<PayrollRecord[]>([]);
  const [folhaRelatorio, setFolhaRelatorio] = useState<FolhaRelatorioRow[]>([]);
  const [folhaRegras, setFolhaRegras] = useState<FolhaRegra[]>(() => []);
  const [razaoRows, setRazaoRows] = useState<VisionBalanceteRow[]>([]);
  const [importedTxts, setImportedTxts] = useState<Array<{ id: string; filename: string; months: string[]; importedAt: string }>>([]);

  // Interactive inputs for entries
  const [showAddPlano, setShowAddPlano] = useState(false);
  const [buscaPlano, setBuscaPlano] = useState('');
  const [showRenomearPlano, setShowRenomearPlano] = useState(false);
  const [showAddExtrato, setShowAddExtrato] = useState(false);
  const [folhaPdfVariant, setFolhaPdfVariant] = useState(FOLHA_PDF_VARIANTS[0]!.id);
  const [extratoContaCache, setExtratoContaCache] = useState<
    ReturnType<typeof loadExtratoContaMappingCache>
  >({});
  const [extratoConciliacao, setExtratoConciliacao] = useState<ExtratoConciliacaoResumo | null>(null);
  const [semNotaDecisions, setSemNotaDecisions] = useState<ExtratoSemNotaDecisions>({});
  const [semNotaModalOpen, setSemNotaModalOpen] = useState(false);
  const [fiscalSpedVersion, setFiscalSpedVersion] = useState(0);
  const [pendingSemNotaRows, setPendingSemNotaRows] = useState<ExtratoSemNotaPendingRow[]>([]);
  const [extratoRegrasContas, setExtratoRegrasContas] = useState<ExtratoRegraConta[]>([]);
  const [regrasContasModalOpen, setRegrasContasModalOpen] = useState(false);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [debugLogs, setDebugLogs] = useState<{ cat: string; msg: string }[]>([]);
  const [debugLogFilter, setDebugLogFilter] = useState<string>('todos');
  const [extratoPastasModalOpen, setExtratoPastasModalOpen] = useState(false);
  const [extratoPastasTick, setExtratoPastasTick] = useState(0);
  const [contaBancoTick, setContaBancoTick] = useState(0);
  const [balanceteConflitosDetectados, setBalanceteConflitosDetectados] = useState<ConflitoDadoBalancete[]>([]);
  const [showBalanceteConflictModal, setShowBalanceteConflictModal] = useState(false);
  const [forceOverwriteBalancete, setForceOverwriteBalancete] = useState(false);
  const [periodoModalConciliacaoOpen, setPeriodoModalConciliacaoOpen] = useState(false);
  const [periodoModalFolhaOpen, setPeriodoModalFolhaOpen] = useState(false);
  const [periodoModalExportExtratoOpen, setPeriodoModalExportExtratoOpen] = useState(false);
  const [periodoModalImportBalanceteOpen, setPeriodoModalImportBalanceteOpen] = useState(false);
  const lastPeriodoConciliacaoRef = React.useRef<BalancetePeriodo | null>(null);
  /** Marca que o envio ao balancete em curso e "importar tudo" (sem filtro de periodo). */
  const lastConciliacaoTodosRef = React.useRef(false);
  /** Período De/Até confirmado na aba Balancete — filtra a exportação TXT. */
  const [balancetePeriodoConfirmado, setBalancetePeriodoConfirmado] = useState<{
    de: string;
    ate: string;
  } | null>(null);
  const [balanceteImportLogs, setBalanceteImportLogs] = useState<string[]>([]);
  const [showImportLancamentosModal, setShowImportLancamentosModal] = useState(false);
  const [showFolhaRegrasModal, setShowFolhaRegrasModal] = useState(false);
  const [folhaPdfProcessando, setFolhaPdfProcessando] = useState(false);
  const [folhaPdfMsg, setFolhaPdfMsg] = useState('');
  const [folhaDeleteDate, setFolhaDeleteDate] = useState('');
  const [folhaSubTab, setFolhaSubTab] = useState<'lancamentos' | 'totais'>('lancamentos');
  const [folhaTotaisDe, setFolhaTotaisDe] = useState('');
  const [folhaTotaisAte, setFolhaTotaisAte] = useState('');
  const [folhaTotaisRazaoOpen, setFolhaTotaisRazaoOpen] = useState(false);
  const [folhaTotaisRazaoConta, setFolhaTotaisRazaoConta] = useState<{ conta: string; nomeConta: string } | null>(null);
  // New Account state
  const [accCode, setAccCode] = useState('');
  const [accReduzido, setAccReduzido] = useState('');
  const [accName, setAccName] = useState('');
  const [accTipo, setAccTipo] = useState<'S' | 'A' | ''>('');
  const [accNivel, setAccNivel] = useState('');

  // New Extrato state
  const [extDate, setExtDate] = useState(new Date().toISOString().split('T')[0]);
  const [extDesc, setExtDesc] = useState('');
  const [extVal, setExtVal] = useState(0);
  const [extNat, setExtNat] = useState<'D' | 'C'>('D');

  const [saldoAnteriorExtrato, setSaldoAnteriorExtrato] = useState(0);
  const [extratoConciliacaoFiltro, setExtratoConciliacaoFiltro] =
    useState<ExtratoConciliacaoFiltro>('todas');
  const [extratoBusca, setExtratoBusca] = useState('');

  const extratoLancamentosRef = useRef(extratoLancamentos);
  extratoLancamentosRef.current = extratoLancamentos;
  const planoContasRef = useRef(planoContas);
  planoContasRef.current = planoContas;
  const folhaPayrollRef = useRef(folhaPayroll);
  folhaPayrollRef.current = folhaPayroll;
  const folhaRelatorioRef = useRef(folhaRelatorio);
  folhaRelatorioRef.current = folhaRelatorio;
  const razaoRowsRef = useRef(razaoRows);
  razaoRowsRef.current = razaoRows;
  const saldoAnteriorExtratoRef = useRef(saldoAnteriorExtrato);
  saldoAnteriorExtratoRef.current = saldoAnteriorExtrato;
  // Só persiste o saldo anterior depois que ele foi realmente carregado desta
  // empresa: o carregamento é adiado (deferIdle 400ms) e, em StrictMode/troca
  // rápida de empresa, o cleanup rodava antes com o estado ainda em 0 e
  // gravava esse 0 por cima do valor digitado — some ao atualizar a página.
  const saldoAnteriorCarregadoRef = useRef(false);
  const extratoContaCacheRef = useRef(extratoContaCache);
  extratoContaCacheRef.current = extratoContaCache;
  const extratoAsyncVersionRef = useRef(0);
  const folhaDominioInputRef = useRef<HTMLInputElement>(null);

  const isExtratoAsyncResultStale = useCallback(
    (companyScope: string, version: number) =>
      version !== extratoAsyncVersionRef.current || !isSameCompanyScope(companyScope, selectedCompany),
    [selectedCompany],
  );

  useEffect(() => {
    const companyScope = selectedCompany;
    return () => {
      if (!companyScope) return;
      const extrato = syncExtratoConciliacaoStatus(extratoLancamentosRef.current);
      if (extrato.length > 0) writeManagerDataNow(companyScope, 'extrato', extrato);
      if (planoContasRef.current.length > 0) {
        writeManagerDataNow(companyScope, 'plano', planoContasRef.current);
      }
      if (folhaPayrollRef.current.length > 0) {
        writeManagerDataNow(companyScope, 'folha', folhaPayrollRef.current);
      }
      if (folhaRelatorioRef.current.length > 0) {
        writeManagerDataNow(companyScope, 'folhaRelatorio', folhaRelatorioRef.current);
      }
      if (razaoRowsRef.current.length > 0) {
        writeManagerDataNow(companyScope, 'razao', razaoRowsRef.current);
      }
      if (saldoAnteriorCarregadoRef.current) {
        writeSaldoAnteriorExtrato(companyScope, saldoAnteriorExtratoRef.current);
      }
      saveExtratoContaMappingCache(companyScope, extratoContaCacheRef.current);
      flushManagerDataWrites();
    };
  }, [selectedCompany]);

  // Mantém o card "X não conciliados" da pasta ativa em sincronia em tempo
  // real: sem isso, o contador ficava congelado no snapshot do último
  // "Salvar extrato na pasta", mesmo depois do usuário já ter conciliado
  // tudo na tela.
  useEffect(() => {
    if (!selectedCompany || extratoLancamentos.length === 0) return;
    const pastaAtivaId = getExtratoPastaAtivaId(selectedCompany);
    if (!pastaAtivaId) return;
    const conciliadas = extratoLancamentos.filter(
      (r) => Boolean(r.accountDebit?.trim()) && Boolean(r.accountCredit?.trim()),
    ).length;
    updateExtratoPastaConciliacaoCounts(selectedCompany, pastaAtivaId, {
      total: extratoLancamentos.length,
      conciliadas,
      pendentes: extratoLancamentos.length - conciliadas,
    });
    setExtratoPastasTick((n) => n + 1);
  }, [extratoLancamentos, selectedCompany]);

  const extratoFiscalContext = useMemo(
    () => buildExtratoFiscalContext(selectedCompany),
    [selectedCompany, storageVersion, fiscalSpedVersion],
  );

  useEffect(() => {
    void tryAutoSyncFiscalSpedOnOpen(selectedCompany);
    void tryAutoSyncFiscalPgdasOnOpen(selectedCompany);
  }, [selectedCompany]);

  useEffect(() => {
    const onFiscalSped = () => setFiscalSpedVersion((v) => v + 1);
    const onFiscalPgdas = () => setFiscalSpedVersion((v) => v + 1);
    window.addEventListener('contabilfacil-fiscal-sped-updated', onFiscalSped);
    window.addEventListener('contabilfacil-fiscal-pgdas-updated', onFiscalPgdas);
    return () => {
      window.removeEventListener('contabilfacil-fiscal-sped-updated', onFiscalSped);
      window.removeEventListener('contabilfacil-fiscal-pgdas-updated', onFiscalPgdas);
    };
  }, []);

  useEffect(() => {
    const onBanco = (ev: Event) => {
      const detail = (ev as CustomEvent<{ company?: string; contaBanco?: string }>).detail;
      if (detail?.company && detail.company !== selectedCompany) return;
      if (detail?.contaBanco?.trim()) {
        saveExtratoRegrasBancoSelecionado(selectedCompany, detail.contaBanco.trim());
      }
      setContaBancoTick((n) => n + 1);
    };
    window.addEventListener('contabilfacil-extrato-banco-updated', onBanco);
    return () => window.removeEventListener('contabilfacil-extrato-banco-updated', onBanco);
  }, [selectedCompany]);

  useEffect(() => {
    registerManagerTabBot(selectedCompany);
  }, [selectedCompany, storageVersion]);

  const reloadFolhaFromStorage = useCallback(() => {
    setFolhaPayroll(readManagerData<PayrollRecord>(selectedCompany, 'folha'));
    setFolhaRelatorio(readManagerData<FolhaRelatorioRow>(selectedCompany, 'folhaRelatorio'));
    setFolhaRegras(loadFolhaRegras(selectedCompany));
    setRazaoRows(readManagerData<VisionBalanceteRow>(selectedCompany, 'razao'));
  }, [selectedCompany]);

  const handleFolhaDominioFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file || !selectedCompany) return;

      setFolhaPdfProcessando(true);
      setFolhaPdfMsg('');
      try {
        const pdfDoc = await openPdfDocument(file);
        let extractedText = '';
        for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
          const page = await parseAndRenderPDFPage(file, pageNum, pdfDoc);
          extractedText += `\n--- Página ${pageNum} ---\n${pdfTextItemsToLines(page.textItems).join('\n')}`;
        }

        const results = parseFolhaTextMultiCompetencia(extractedText);
        const totalLancamentos = results.reduce((n, r) => n + r.lancements.length, 0);
        if (totalLancamentos === 0) {
          setFolhaPdfMsg('❌ Nenhum lançamento encontrado no PDF.');
          return;
        }

        // Converter cada FolhaLancamento → FolhaRelatorioRow (formato da tabela)
        let totalProventos = 0;
        let totalDescontos = 0;
        let totalInformativa = 0;
        const novasLinhas: FolhaRelatorioRow[] = [];
        for (const result of results) {
          for (const lance of result.lancements) {
            const debito = lance.natureza === 'D' ? lance.valor : 0;
            const credito = lance.natureza === 'C' ? lance.valor : 0;
            if (lance.tipo === 'PROVENTOS') totalProventos += lance.valor;
            if (lance.tipo === 'DESCONTOS') totalDescontos += lance.valor;
            if (lance.tipo === 'INFORMATIVA') totalInformativa += lance.valor;
            novasLinhas.push({
              id: `folha-pdf-${result.competencia.replace(/\D/g, '')}-${lance.rubrica}-${Math.random().toString(36).slice(2, 7)}`,
              date: result.data,
              description: `${lance.rubrica} - ${lance.nomeRubrica}`,
              debito,
              credito,
              tipo: lance.tipo,
            });
          }
        }

        // Mescla com o que já existe (sem duplicar por id)
        const existingIds = new Set(folhaRelatorio.map((r) => r.id));
        const merged = [...folhaRelatorio, ...novasLinhas.filter((r) => !existingIds.has(r.id))];
        setFolhaRelatorio(merged);
        writeManagerDataNow(selectedCompany, 'folhaRelatorio', merged);
        void flushPersistenceAfterCriticalWrite();

        const msgParts = [
          `✅ ${novasLinhas.length} lançamento(s) importados`,
          `Proventos ${totalProventos.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
          `Descontos ${totalDescontos.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        ];
        if (totalInformativa > 0) {
          msgParts.push(`Informativa ${totalInformativa.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
        }
        setFolhaPdfMsg(msgParts.join(' · '));
      } catch (err) {
        setFolhaPdfMsg(`❌ Erro ao ler o PDF: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setFolhaPdfProcessando(false);
      }
    },
    [selectedCompany, folhaRelatorio],
  );

  const handleMandarFolhaParaBalancete = useCallback(() => {
    const hasData = folhaRelatorio.length > 0 || folhaPayroll.length > 0;
    if (!hasData) {
      alert('Nenhum dado de folha importado para enviar ao balancete.');
      return;
    }
    setPeriodoModalFolhaOpen(true);
  }, [folhaPayroll.length, folhaRelatorio.length]);

  const handlePeriodoFolhaConfirmado = useCallback((periodo: BalancetePeriodo) => {
    setPeriodoModalFolhaOpen(false);
    try {
      const { gerados, pendencias } = postFolhaNoRazao(selectedCompany);
      setRazaoRows(readManagerData<VisionBalanceteRow>(selectedCompany, 'razao'));
      void flushPersistenceAfterCriticalWrite();
      if (pendencias.length && gerados <= 0) {
        alert(pendencias.slice(0, 5).join('\n'));
        return;
      }
      const periodoStr = `${periodo.dataInicio.split('-').reverse().join('/')} até ${periodo.dataFim.split('-').reverse().join('/')}`;
      alert(
        gerados > 0
          ? `${gerados} lançamento(s) da folha enviados ao balancete.\nPeríodo: ${periodoStr}\n\nAbra a aba Balancete para conferir.`
          : 'Nada novo para enviar — já estavam no balancete (ou configure as contas).',
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao enviar para o balancete.');
    }
  }, [selectedCompany]);

  useEffect(() => {
    const onFolha = (ev: Event) => {
      const detail = (ev as CustomEvent<{ company?: string }>).detail;
      if (
        detail?.company &&
        normalizeCompanyName(detail.company) !== normalizeCompanyName(selectedCompany)
      ) {
        return;
      }
      reloadFolhaFromStorage();
    };
    window.addEventListener('contabilfacil-folha-updated', onFolha);
    return () => window.removeEventListener('contabilfacil-folha-updated', onFolha);
  }, [selectedCompany, reloadFolhaFromStorage]);

  // IMPORTANTE: só CARREGA as regras salvas — nunca migra, "corrige" ou
  // consolida automaticamente. Regra de conciliação é dado digitado pelo
  // usuário; qualquer heurística automática rodando em background (mesmo
  // bem-intencionada) arrisca trocar a conta ou apagar uma regra sem o
  // usuário pedir, o que já causou perda de dados real. Se um dia for
  // necessário migrar formato antigo, isso deve ser uma ação explícita
  // (botão), nunca um efeito automático no carregamento.
  useEffect(() => {
    if (!selectedCompany) return;
    setSemNotaDecisions(loadExtratoSemNotaDecisions(selectedCompany));
    const loaded = loadExtratoRegrasContas(selectedCompany, getExtratoBancoConta(selectedCompany));
    setExtratoRegrasContas(loaded);
  }, [selectedCompany, storageVersion]);

  const contaBancoExtratoAtivo = useMemo(
    () => getExtratoBancoConta(selectedCompany),
    [selectedCompany, storageVersion, contaBancoTick],
  );

  const regrasContasDoBancoAtivo = useMemo(
    () => filterExtratoRegrasPorBanco(extratoRegrasContas, contaBancoExtratoAtivo),
    [extratoRegrasContas, contaBancoExtratoAtivo],
  );

  const extratoPastasCount = useMemo(
    () => countExtratoPastas(selectedCompany),
    [selectedCompany, extratoPastasTick, storageVersion],
  );

  const extratoResolverOptions = useMemo(
    () => ({
      contaBancoPreferida: getExtratoBancoConta(selectedCompany),
      rfStore: readReceitaFederalRegras(selectedCompany),
      fiscalMap: readFiscalContaMap(selectedCompany),
      fiscalContas: loadFiscalContasImposto(selectedCompany),
      fiscalContext: extratoFiscalContext,
      semNotaDecisions,
      regrasContas: extratoRegrasContas,
      coligadas: [],
    }),
    [
      selectedCompany,
      storageVersion,
      contaBancoTick,
      activeSubTab,
      extratoFiscalContext,
      semNotaDecisions,
      extratoRegrasContas,
    ],
  );

  useEffect(() => {
    if (!selectedCompany) return;
    try {
      reclaimLocalStorageSpace();
    } catch {
      /* ignore */
    }
  }, [selectedCompany]);

  const addDebugLog = useCallback((msg: string, cat = 'conciliação') => {
    const ts = new Date().toLocaleTimeString('pt-BR', { hour12: false });
    setDebugLogs((prev) => [{ cat, msg: `[${ts}] ${msg}` }, ...prev].slice(0, 200));
  }, []);

  /**
   * Persiste extrato localmente. NÃO manda ao balancete — só o botão explícito.
   * `immediate=false` (padrão em edição de linha): debounce no LS para não travar o browser.
   */
  const saveExtratoLocal = useCallback(
    (list: BankStatement[], immediate = false, companyScope = selectedCompany) => {
      const withStatus = syncExtratoConciliacaoStatus(list);
      if (!isSameCompanyScope(companyScope, selectedCompany)) {
        writeManagerDataNow(companyScope, 'extrato', withStatus);
        return;
      }
      if (immediate) {
        startTransition(() => setExtratoLancamentos(withStatus));
        // Persiste JÁ, de forma síncrona — nunca adia via requestIdleCallback.
        // Um adiamento de até 900ms aqui deixava uma janela em que qualquer
        // leitor do storage (ex.: evento de hidratação da nuvem) podia ler o
        // valor ANTIGO ainda persistido e sobrescrever o extrato recém-
        // selecionado de volta para o banco errado — só corrigindo "sozinho"
        // depois de um segundo clique/segunda espera.
        writeManagerDataNow(companyScope, 'extrato', withStatus);
        void flushPersistenceAfterCriticalWrite();
      } else {
        startTransition(() => setExtratoLancamentos(withStatus));
        writeManagerData(companyScope, 'extrato', withStatus);
      }
    },
    [selectedCompany],
  );

  const notifyPendingSemNota = useCallback((pendingSemNota: ExtratoSemNotaPendingRow[]) => {
    if (pendingSemNota.length > 0) {
      setPendingSemNotaRows(pendingSemNota);
      setSemNotaModalOpen(true);
    }
  }, []);

  const commitExtratoResolverResult = useCallback(
    (
      companyScope: string,
      rows: BankStatement[],
      cache: typeof extratoContaCache,
      pendingSemNota: ExtratoSemNotaPendingRow[],
      options?: { immediate?: boolean },
    ) => {
      writeManagerData(
        companyScope,
        'extrato',
        syncExtratoConciliacaoStatus(rows),
      );
      if (!isSameCompanyScope(companyScope, selectedCompany)) return;
      setExtratoContaCache(cache);
      saveExtratoContaMappingCache(companyScope, cache);
      saveExtratoLocal(rows, options?.immediate ?? false, companyScope);
      notifyPendingSemNota(pendingSemNota);
    },
    [notifyPendingSemNota, saveExtratoLocal, selectedCompany],
  );

  const handleSemNotaModalConfirm = async (decisions: Record<string, ExtratoSemNotaPolicy>) => {
    const companyScope = selectedCompany;
    extratoAsyncVersionRef.current += 1;
    const asyncVersion = extratoAsyncVersionRef.current;
    const merged = { ...semNotaDecisions, ...decisions };
    saveExtratoSemNotaDecisions(companyScope, merged);
    setSemNotaDecisions(merged);
    setSemNotaModalOpen(false);
    setPendingSemNotaRows([]);
    const { rows, cache, pendingSemNota } = await applyExtratoContaResolverAsync(
      extratoLancamentos,
      planoParaResolver,
      extratoContaCache,
      // A decisão "sem nota" completa as linhas pendentes — não é motivo para
      // reconciliar tudo por cima do que já estava gravado.
      { ...extratoResolverOptions, semNotaDecisions: merged, preservarContasExistentes: true },
    );
    if (isExtratoAsyncResultStale(companyScope, asyncVersion)) return;
    commitExtratoResolverResult(companyScope, rows, cache, pendingSemNota);
  };

  function extratoSaldoAnteriorStorageKey(company: string): string {
    return `contabilfacil_${companyStorageSlug(company)}_extrato_saldo_anterior`;
  }

  function readSaldoAnteriorExtrato(company: string): number {
    try {
      const raw = readPersistedLocalStorageJson<string | number | null>(
        extratoSaldoAnteriorStorageKey(company),
        null,
      );
      if (raw == null) return 0;
      if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
      if (!String(raw).trim()) return 0;
      const n = parseFloat(String(raw));
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }

  function writeSaldoAnteriorExtrato(company: string, value: number): void {
    const n = Number.isFinite(value) ? value : 0;
    writePersistedLocalStorageJson(
      extratoSaldoAnteriorStorageKey(company),
      n === 0 ? null : n,
    );
  }

  const handleExtratoConciliacao = useCallback(
    (conc: ExtratoConciliacaoResumo) => {
      setExtratoConciliacao(conc);
      if (Number.isFinite(conc.saldoAnterior)) {
        setSaldoAnteriorExtrato(conc.saldoAnterior);
        writeSaldoAnteriorExtrato(selectedCompany, conc.saldoAnterior);
      }
    },
    [selectedCompany],
  );

  useEffect(() => {
    const onBeforeUnload = () => flushManagerDataWrites();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      flushManagerDataWrites();
    };
  }, []);

  // Plano primeiro (UI responsiva); extrato/razão/folha após pintura.
  useEffect(() => {
    const companyScope = selectedCompany;
    if (!companyScope) {
      setPlanoContas([]);
      return;
    }

    setPlanoContas([]);
    setExtratoLancamentos([]);
    setRazaoRows([]);

    let cancelled = false;
    const canApply = () => !cancelled && isSameCompanyScope(companyScope, selectedCompany);

    const loadPlano = () => {
      if (!canApply()) return;
      const rawPlano = readManagerData<AccountPlan>(companyScope, 'plano');
      const storedPlano = rawPlano.map((acc) => ({
        ...acc,
        codigoReduzido: cleanStoredCodigoReduzido(acc.codigoReduzido, acc.code),
      }));
      if (!canApply()) return;
      setPlanoContas(storedPlano);
      if (
        rawPlano.some(
          (acc, i) => (acc.codigoReduzido ?? '') !== (storedPlano[i]?.codigoReduzido ?? ''),
        )
      ) {
        writeManagerData(companyScope, 'plano', storedPlano);
      }
    };

    const loadOperationalData = () => {
      if (!canApply()) return;
      try {
        let rawPlano = readManagerData<AccountPlan>(companyScope, 'plano');
        // Limpa contas órfâs inválidas (com classificação sem pontos)
        rawPlano = validarElimparPlanoContas(rawPlano);
        const storedPlano = rawPlano.map((acc) => ({
          ...acc,
          codigoReduzido: cleanStoredCodigoReduzido(acc.codigoReduzido, acc.code),
        }));
        const storedExtrato = readManagerData<BankStatement>(companyScope, 'extrato');
        const loadedCache = loadExtratoContaMappingCache(companyScope);
        const extratoMigrado = migrateExtratoContasParaCodigoReduzido(storedExtrato, storedPlano);
        if (extratoMigrado !== storedExtrato) {
          writeManagerDataNow(companyScope, 'extrato', extratoMigrado);
        }
        if (!canApply()) return;
        // Auto-correção: remove lançamentos de "saldo anterior/do dia/etc." que
        // ficaram salvos de importações antigas (antes desta correção) — esses
        // valores são só referência, nunca lançamento de conciliação.
        const { rows: extratoSemSaldo, saldoAnteriorSugerido } = extrairESepararSaldoAnterior(extratoMigrado);
        if (extratoSemSaldo.length !== extratoMigrado.length) {
          writeManagerDataNow(companyScope, 'extrato', extratoSemSaldo);
        }
        let extratoComStatus = syncExtratoConciliacaoStatus(extratoSemSaldo);

        // Restaura EXATAMENTE a última pasta (extrato salvo) que o usuário abriu/salvou —
        // sem isso, um reload podia mostrar o conteúdo bruto da chave 'extrato', que pode
        // ter ficado obsoleto/acumulado de edições ou sessões anteriores e não corresponder
        // a nenhum extrato salvo de verdade (saldo "do nada" que sempre incomodou).
        const pastaAtivaId = getExtratoPastaAtivaId(companyScope);
        const pastaAtiva = pastaAtivaId ? getExtratoPastaById(companyScope, pastaAtivaId) : null;
        if (pastaAtiva) {
          setExtratoContaBancoAtiva(companyScope, pastaAtiva.contaBanco, pastaAtiva.bancoNome);
          extratoComStatus = syncExtratoConciliacaoStatus(
            pastaAtiva.rows.map((r) => ({
              id: r.id || crypto.randomUUID(),
              date: r.date,
              description: r.description,
              value: r.value,
              nature: r.nature === 'C' ? 'C' : 'D',
              accountCode: r.accountCode || '',
              accountDebit: r.accountDebit,
              accountCredit: r.accountCredit,
              operationName: r.operationName,
              status: r.status === 'CONCILIADO' ? 'CONCILIADO' : 'PENDENTE',
            })),
          );

          // DEBUG: loga snapshot das linhas restauradas da pasta
          setDebugLogs((prev) => {
            const ts = new Date().toLocaleTimeString('pt-BR', { hour12: false });
            const linhas = extratoComStatus.slice(0, 10).map((r) =>
              `  • ${r.date} | ${r.description.slice(0, 30)} | D:${r.accountDebit || '—'} C:${r.accountCredit || '—'} [${r.status}]`
            );
            const extra = extratoComStatus.length > 10 ? [`  … +${extratoComStatus.length - 10} linhas`] : [];
            return [
              { cat: 'conciliação', msg: `[${ts}] ── RELOAD pasta "${pastaAtiva.label}" (${pastaAtiva.contaBanco}) ──` },
              { cat: 'conciliação', msg: `[${ts}]   ${extratoComStatus.length} linhas restauradas do snapshot` },
              ...linhas.map(l => ({ cat: 'conciliação', msg: `[${ts}]${l}` })),
              ...extra.map(l => ({ cat: 'conciliação', msg: `[${ts}]${l}` })),
              ...prev,
            ].slice(0, 200);
          });

          // Aplica as regras mais recentes sobre o snapshot da pasta usando
          // soAplicarRegras=true: atualiza APENAS as linhas que batem com uma
          // regra cadastrada, sem tocar em digitação manual ou linhas que nenhuma
          // regra cobre. Isso garante que uma regra editada depois do último
          // "Salvar extrato" seja refletida automaticamente no reload.
          const regrasFrescas = loadExtratoRegrasContas(companyScope, pastaAtiva.contaBanco);

          // DEBUG: loga regras carregadas
          setDebugLogs((prev) => {
            const ts = new Date().toLocaleTimeString('pt-BR', { hour12: false });
            const resumoRegras = regrasFrescas.slice(0, 10).map(r =>
              `  • [${r.nature}] "${r.descricao.slice(0, 30)}" → contra:${r.contaContrapartida} banco:${r.contaBanco}`
            );
            return [
              { cat: 'regras', msg: `[${ts}]   Regras carregadas do storage: ${regrasFrescas.length}` },
              ...resumoRegras.map(l => ({ cat: 'regras', msg: `[${ts}]${l}` })),
              { cat: 'regras', msg: `[${ts}]   plano=${storedPlano.length} contas — aplicando soAplicarRegras` },
              ...prev,
            ].slice(0, 200);
          });

          if (regrasFrescas.length > 0 && storedPlano.length > 0) {
            const { rows: resolvidas } = applyExtratoContaResolver(
              extratoComStatus,
              storedPlano,
              loadedCache,
              {
                contaBancoPreferida: pastaAtiva.contaBanco,
                regrasContas: regrasFrescas,
                soAplicarRegras: true,
              },
            );
            // DEBUG: loga o que mudou
            const mudancas = resolvidas.filter((r, i) => {
              const orig = extratoComStatus[i];
              return orig && (r.accountDebit !== orig.accountDebit || r.accountCredit !== orig.accountCredit);
            });
            setDebugLogs((prev) => {
              const ts = new Date().toLocaleTimeString('pt-BR', { hour12: false });
              const detalhe = mudancas.slice(0, 8).map(r =>
                `    • "${r.description.slice(0, 28)}" D:${r.accountDebit || '—'} C:${r.accountCredit || '—'}`
              );
              return [
                { cat: 'regras', msg: `[${ts}]   soAplicarRegras: ${mudancas.length} linha(s) atualizadas` },
                ...detalhe.map(l => ({ cat: 'regras', msg: `[${ts}]${l}` })),
                ...prev,
              ].slice(0, 200);
            });
            extratoComStatus = resolvidas;
          }

          writeManagerDataNow(companyScope, 'extrato', extratoComStatus);
        }

        setExtratoLancamentos(extratoComStatus);
        setExtratoContaCache(loadedCache);
        // Pasta salva antes deste campo existir (ou salva com 0) não pode
        // apagar o saldo que o usuário digitou: quando a pasta não tem valor,
        // vale o último saldo gravado para a empresa.
        const saldoAnteriorGravado = readSaldoAnteriorExtrato(companyScope);
        const saldoAnteriorSalvo = pastaAtiva
          ? pastaAtiva.saldoAnterior || saldoAnteriorGravado
          : saldoAnteriorGravado;
        if (pastaAtiva) {
          setSaldoAnteriorExtrato(saldoAnteriorSalvo);
          writeSaldoAnteriorExtrato(companyScope, saldoAnteriorSalvo);
          if (pastaAtivaId && !pastaAtiva.saldoAnterior && saldoAnteriorSalvo) {
            updateExtratoPastaSaldoAnterior(companyScope, pastaAtivaId, saldoAnteriorSalvo);
          }
        } else if (saldoAnteriorSalvo === 0 && saldoAnteriorSugerido != null) {
          setSaldoAnteriorExtrato(saldoAnteriorSugerido);
          writeSaldoAnteriorExtrato(companyScope, saldoAnteriorSugerido);
        } else {
          setSaldoAnteriorExtrato(saldoAnteriorSalvo);
        }
        saldoAnteriorCarregadoRef.current = true;
        setFolhaPayroll(readManagerData<PayrollRecord>(companyScope, 'folha'));
        setFolhaRelatorio(readManagerData<FolhaRelatorioRow>(companyScope, 'folhaRelatorio'));
        setFolhaRegras(loadFolhaRegras(companyScope));
        const keyTxts = `contabilfacil_${companyStorageSlug(companyScope)}_imported_txts`;
        setImportedTxts(readPersistedLocalStorageJson<any[]>(keyTxts, []));
        const storedRazao = normalizeRazaoImport(readManagerData<VisionBalanceteRow>(companyScope, 'razao'));
        if (storedRazao.length > 0) {
          setRazaoRows(storedRazao);
          writeManagerData(companyScope, 'razao', storedRazao);
        } else {
          const legacyBalancete = readManagerData<BalanceteRow>(companyScope, 'balancete');
          if (legacyBalancete.length > 0) {
            const migrated = migrateLegacyBalanceteToRazao(legacyBalancete);
            setRazaoRows(migrated);
            writeManagerData(companyScope, 'razao', migrated);
          } else {
            setRazaoRows([]);
          }
        }
      } catch (e) {
        console.error('Erro ao carregar dados gerenciais:', e);
      }
    };

    try {
      saldoAnteriorCarregadoRef.current = false;
      loadPlano();
      deferIdle(loadOperationalData, 400);
    } catch (e) {
      console.error('Erro ao carregar plano de contas:', e);
    }

    return () => {
      cancelled = true;
    };
  }, [selectedCompany]);

  useEffect(() => {
    const onRazaoAtualizado = (ev: Event) => {
      const detail = (ev as CustomEvent<{ company?: string }>).detail;
      if (detail?.company && normalizeCompanyName(detail.company) !== normalizeCompanyName(selectedCompany)) {
        return;
      }
      setRazaoRows(readManagerData<VisionBalanceteRow>(selectedCompany, 'razao'));
    };
    window.addEventListener('contabilfacil-razao-updated', onRazaoAtualizado);
    return () => window.removeEventListener('contabilfacil-razao-updated', onRazaoAtualizado);
  }, [selectedCompany]);

  // Recarrega dados quando o Docker termina de hidratar (dados chegam após montagem).
  // O efeito principal de carga depende de [selectedCompany] e não re-dispara ao mudar
  // storageVersion, então usamos o evento de hidratação para preencher states vazios.
  useEffect(() => {
    if (!selectedCompany) return;
    const onHydrated = () => {
      const companyScope = selectedCompany;
      const planoAtual = readManagerData<AccountPlan>(companyScope, 'plano');
      if (planoAtual.length > 0) {
        const storedPlano = planoAtual.map((acc) => ({
          ...acc,
          codigoReduzido: cleanStoredCodigoReduzido(acc.codigoReduzido, acc.code),
        }));
        setPlanoContas(storedPlano);
      }
      // Mesma regra de "pasta ativa" do carregamento inicial (loadOperationalData):
      // sem isso, quando os dados do Docker/pasta chegam DEPOIS da montagem (evento
      // 'contabilfacil:data-hydrated'), este handler sobrescrevia a tabela com o
      // conteúdo bruto da chave 'extrato' — que pode ter ficado obsoleto/acumulado
      // de sessões anteriores e não corresponder a nenhum extrato realmente salvo
      // na pasta (tabela "fantasma", que não bate com o que está salvo).
      const pastaAtivaId = getExtratoPastaAtivaId(companyScope);
      const pastaAtiva = pastaAtivaId ? getExtratoPastaById(companyScope, pastaAtivaId) : null;
      if (pastaAtiva) {
        setExtratoContaBancoAtiva(companyScope, pastaAtiva.contaBanco, pastaAtiva.bancoNome);
        const extratoDaPasta = syncExtratoConciliacaoStatus(
          pastaAtiva.rows.map((r): BankStatement => ({
            id: r.id || crypto.randomUUID(),
            date: r.date,
            description: r.description,
            value: r.value,
            nature: r.nature === 'C' ? 'C' : 'D',
            accountCode: r.accountCode || '',
            accountDebit: r.accountDebit,
            accountCredit: r.accountCredit,
            operationName: r.operationName,
            status: r.status === 'CONCILIADO' ? 'CONCILIADO' : 'PENDENTE',
          })),
        );
        addDebugLog(`── HYDRATED (nuvem) pasta="${pastaAtiva.label}" banco=${pastaAtiva.contaBanco} ${extratoDaPasta.length} linhas`, 'conciliação');
        extratoDaPasta.slice(0, 5).forEach(r => addDebugLog(`  • "${r.description.slice(0,28)}" D:${r.accountDebit || '—'} C:${r.accountCredit || '—'}`, 'conciliação'));

        // Aplica regras mais recentes (mesmo tratamento do loadOperationalData)
        const planoAtualHydrated = readManagerData<AccountPlan>(companyScope, 'plano').map(a => ({
          code: a.code, name: a.name, codigoReduzido: a.codigoReduzido, tipo: a.tipo, group: a.group,
        }));
        const regrasHydrated = loadExtratoRegrasContas(companyScope, pastaAtiva.contaBanco);
        let extratoFinal = extratoDaPasta;
        if (regrasHydrated.length > 0 && planoAtualHydrated.length > 0) {
          const { rows: comRegras } = applyExtratoContaResolver(extratoDaPasta, planoAtualHydrated, {}, {
            contaBancoPreferida: pastaAtiva.contaBanco,
            regrasContas: regrasHydrated,
            soAplicarRegras: true,
          });
          const mudancasH = comRegras.filter((r, i) => {
            const orig = extratoDaPasta[i];
            return orig && (r.accountDebit !== orig.accountDebit || r.accountCredit !== orig.accountCredit);
          });
          addDebugLog(`   HYDRATED soAplicarRegras: ${mudancasH.length} linha(s) atualizadas`, 'regras');
          extratoFinal = comRegras;
        }

        writeManagerDataNow(companyScope, 'extrato', extratoFinal);
        setExtratoLancamentos(extratoFinal);
        // Idem loadOperationalData: pasta sem saldo mantém o valor digitado.
        const saldoAnteriorHydrated =
          pastaAtiva.saldoAnterior || readSaldoAnteriorExtrato(companyScope);
        setSaldoAnteriorExtrato(saldoAnteriorHydrated);
        writeSaldoAnteriorExtrato(companyScope, saldoAnteriorHydrated);
        if (!pastaAtiva.saldoAnterior && saldoAnteriorHydrated) {
          updateExtratoPastaSaldoAnterior(companyScope, pastaAtiva.id, saldoAnteriorHydrated);
        }
        saldoAnteriorCarregadoRef.current = true;
      } else {
        const storedExtrato = readManagerData<BankStatement>(companyScope, 'extrato');
        addDebugLog(`── HYDRATED (nuvem) sem pasta ativa — extrato bruto ${storedExtrato.length} linhas`, 'conciliação');
        if (storedExtrato.length > 0) {
          setExtratoLancamentos(syncExtratoConciliacaoStatus(storedExtrato));
        }
        setSaldoAnteriorExtrato(readSaldoAnteriorExtrato(companyScope));
        saldoAnteriorCarregadoRef.current = true;
      }
      const storedRazao = normalizeRazaoImport(readManagerData<VisionBalanceteRow>(companyScope, 'razao'));
      if (storedRazao.length > 0) {
        setRazaoRows(storedRazao);
      }
    };
    window.addEventListener('contabilfacil:data-hydrated', onHydrated);
    return () => window.removeEventListener('contabilfacil:data-hydrated', onHydrated);
  }, [selectedCompany, addDebugLog]);

  useEffect(() => {
    if (activeSubTab === 'extrato') warmupSharedOcrWorker();
  }, [activeSubTab]);

  const savePlano = (list: AccountPlan[]) => {
    const company = requireCompanyScope(selectedCompany);
    setPlanoContas(list);
    writeManagerDataNow(company, 'plano', list);
    void flushPersistenceAfterCriticalWrite();
  };

  /**
   * Conta usada no razão mas ausente do plano de contas não pode ficar solta fora do grupo
   * certo no balancete — cria automaticamente a entrada no plano (grupo/natureza inferidos
   * pela classificação) com um nome provisório, marcada para renomear.
   */
  useEffect(() => {
    // Autocura: remove entradas de plano com código/nome de CNPJ vazado do arquivo
    // (bug de versões anteriores dos parsers) — vale para QUALQUER conta salva, não só
    // as marcadas "precisaRenomear", pois o vazamento também ocorre via import direto
    // do plano de contas (PDF/OCR), que já grava o código malformado como definitivo.
    const codigoValido = /^\d+(\.\d+)*$/;
    const limpo = planoContas.filter((a) => {
      if (isCnpjLike(a.code) || isCnpjLike(a.codigoReduzido)) return false;
      if (/c\.?\s*n\.?\s*p\.?\s*j/i.test(a.name || '')) return false;
      if (a.precisaRenomear && !codigoValido.test(a.code)) return false;
      return true;
    });
    if (limpo.length !== planoContas.length) {
      savePlano(limpo);
      return;
    }
    // Plano vazio = limpeza explícita ou ainda sem importação. Não recriar o plano
    // inteiro a partir do razão — senão "Limpar plano" vira no-op (e volta no reload).
    if (planoContas.length === 0) return;
    if (razaoRows.length === 0) return;
    const novas = detectarContasNovas(razaoRows, planoContas);
    if (novas.length === 0) return;
    savePlano([...planoContas, ...novas]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [razaoRows, planoContas]);

  const contasParaRenomear = useMemo(
    () => planoContas.filter((a) => a.precisaRenomear),
    [planoContas],
  );

  /**
   * Lançamentos de contas ainda não renomeadas ficam fora do balancete até serem
   * confirmadas. As chaves de classificação e de código reduzido são montadas
   * separadamente (via `buildContaMatchKeys`/`contaMatchesKeys`, mesma disciplina
   * de `findPlanoRow`) — antes elas eram jogadas num Set só, e um código reduzido
   * pendente (ex.: "0000322") colidia com a classificação de uma conta confirmada
   * e totalmente alheia (ex.: "3.2.2"), fazendo os lançamentos DELA sumirem do
   * Razão e do TXT exportado (só não aparecia em janeiro porque, sem nenhuma
   * conta pendente ainda, este filtro nem chegava a rodar).
   */
  const razaoRowsSemContasPendentes = useMemo(() => {
    if (contasParaRenomear.length === 0) return razaoRows;
    const pendentes = buildContaMatchKeys(contasParaRenomear);
    return razaoRows.filter((r) => !contaMatchesKeys(r, pendentes));
  }, [razaoRows, contasParaRenomear]);

  const handleConfirmarContaPendente = (payload: {
    contaKey: string;
    nome: string;
    classificacao: string;
    group: PlanoGroup;
  }) => {
    const nome = payload.nome.trim();
    const classificacao = payload.classificacao.trim();
    if (!nome) {
      window.alert('Informe o nome correto da conta.');
      return;
    }
    if (!/^\d+(\.\d+)+$/.test(classificacao)) {
      window.alert('Informe uma classificação válida (ex.: 5.1.1.01.00001) ou escolha o grupo de contas.');
      return;
    }
    const dup = planoContas.some(
      (a) => a.code !== payload.contaKey && a.code.trim() === classificacao,
    );
    if (dup) {
      window.alert(`Já existe uma conta com a classificação ${classificacao}.`);
      return;
    }
    const group = payload.group || derivePlanoGroupFromCode(classificacao);
    savePlano(
      planoContas.map((a) => {
        if (a.code !== payload.contaKey) return a;
        const reduzido =
          sanitizeCodigoReduzido(a.codigoReduzido) ||
          (a.code.includes('.') ? undefined : sanitizeCodigoReduzido(a.code));
        return {
          ...a,
          code: classificacao,
          name: nome.toUpperCase(),
          codigoReduzido: reduzido,
          group,
          nature: derivePlanoNatureFromGroup(group),
          tipo: a.tipo || 'A',
          nivel: codeLengthToPlanoLevel(classificacao),
          precisaRenomear: false,
        };
      }),
    );
  };

  // Conta nova aguardando renomeação/vínculo de grupo não aparece no plano nem no balancete
  // até o usuário confirmar em "Contas a Serem Renomeadas".
  const planoContasConfirmadas = useMemo(
    () =>
      [...planoContas.filter((a) => !a.precisaRenomear)].sort((a, b) =>
        compareClassificacaoContabil(a.code, b.code),
      ),
    [planoContas],
  );

  const planoContasFiltrado = useMemo(() => {
    const q = buscaPlano.trim().toLowerCase();
    if (!q) return planoContasConfirmadas;
    return planoContasConfirmadas.filter(
      (a) =>
        a.code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        (a.codigoReduzido ?? '').toLowerCase().includes(q),
    );
  }, [planoContasConfirmadas, buscaPlano]);

  const handleLimparExtratos = async () => {
    const company = requireCompanyScope(selectedCompany);
    extratoAsyncVersionRef.current += 1;

    // Atualiza estado e ref juntos para impedir que um cleanup grave novamente a lista antiga.
    extratoLancamentosRef.current = [];
    setExtratoLancamentos([]);
    setSaldoAnteriorExtrato(0);
    saldoAnteriorExtratoRef.current = 0;
    setExtratoConciliacao(null);
    setPendingSemNotaRows([]);
    setSemNotaModalOpen(false);
    setShowAddExtrato(false);

    writeManagerDataNow(company, 'extrato', []);
    writeSaldoAnteriorExtrato(company, 0);
    clearExtratoPastaAtivaId(company);

    try {
      await flushAllEyeVisionPersistence();
    } catch (error) {
      console.error('Falha ao salvar a limpeza dos extratos:', error);
      window.alert(
        'Os extratos foram limpos neste dispositivo, mas não foi possível confirmar o salvamento na nuvem. Verifique a conexão.',
      );
    }
  };

  const handleLimparPlano = async () => {
    const company = requireCompanyScope(selectedCompany);
    planoContasRef.current = [];
    setPlanoContas([]);
    setShowAddPlano(false);
    setShowRenomearPlano(false);
    writeManagerDataNow(company, 'plano', []);

    try {
      await flushAllEyeVisionPersistence();
    } catch (error) {
      console.error('Falha ao salvar a limpeza do plano de contas:', error);
      window.alert(
        'O plano de contas foi limpo neste dispositivo, mas não foi possível confirmar o salvamento na nuvem. Verifique a conexão.',
      );
    }
  };

  const saveFolha = (list: PayrollRecord[]) => {
    setFolhaPayroll(list);
    writeManagerDataNow(selectedCompany, 'folha', list);
    void flushPersistenceAfterCriticalWrite();
  };

  const saveFolhaRelatorio = (list: FolhaRelatorioRow[]) => {
    setFolhaRelatorio(list);
    writeManagerDataNow(selectedCompany, 'folhaRelatorio', list);
    void flushPersistenceAfterCriticalWrite();
  };

  const saveRazao = (list: VisionBalanceteRow[], filename?: string) => {
    const config = readAutomatizacaoContaConfig(selectedCompany);
    const corteBr = config.periodoFechadoAte?.trim();

    const parseCorteDate = (corteStr: string): Date | null => {
      const s = corteStr.trim();
      const ddmm = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
      if (ddmm) {
        return new Date(Number(ddmm[3]), Number(ddmm[2]) - 1, Number(ddmm[1]));
      }
      const mmaaaa = /^(\d{1,2})\/(\d{4})$/.exec(s);
      if (mmaaaa) {
        return new Date(Number(mmaaaa[2]), Number(mmaaaa[1]), 0);
      }
      return null;
    };

    const isRowInClosedPeriod = (rowDateBr: string, corteDate: Date): boolean => {
      const parts = rowDateBr.trim().split('/');
      if (parts.length === 3) {
        const rowDate = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
        return rowDate.getTime() <= corteDate.getTime();
      }
      return false;
    };

    const corteDate = corteBr ? parseCorteDate(corteBr) : null;

    let importId: string | undefined = undefined;
    // Reimportar o MESMO arquivo (mesmo nome) tem que atualizar a entrada existente em
    // "Docs. Importados", não criar uma nova — senão a lista acumula várias entradas do
    // mesmo TXT a cada reimportação.
    // Lê a lista PERSISTIDA, não o state de React: `importedTxts` fica velho entre
    // duas importações seguidas (setState é assíncrono) e, sem achar a entrada que
    // acabou de ser criada, o mesmo arquivo ganhava um importId novo e uma segunda
    // linha em "Docs. Importados". Excluir uma delas depois deixava os lançamentos
    // da outra no balancete — o arquivo saía da lista e o balancete não mudava.
    const keyTxtsAtual = `contabilfacil_${companyStorageSlug(selectedCompany)}_imported_txts`;
    const txtsPersistidos = readPersistedLocalStorageJson<typeof importedTxts>(keyTxtsAtual, importedTxts);
    const importAntigo = filename ? txtsPersistidos.find((t) => t.filename === filename) : undefined;
    if (filename) {
      importId = importAntigo?.id ?? 'import-' + Date.now();
      const monthsSet = new Set<string>();
      list.forEach((row) => {
        if (row.data) {
          const parts = row.data.split('/');
          if (parts.length === 3) {
            monthsSet.add(`${parts[1]}/${parts[2]}`);
          }
        }
      });
      const months = Array.from(monthsSet);
      const newMeta = {
        id: importId,
        filename,
        months,
        importedAt: new Date().toLocaleString('pt-BR'),
      };
      const key = keyTxtsAtual;
      const updatedMetaList = importAntigo
        ? txtsPersistidos.map((t) => (t.id === importId ? newMeta : t))
        : [...txtsPersistidos, newMeta];
      setImportedTxts(updatedMetaList);
      writePersistedLocalStorageJson(key, updatedMetaList);
    }

    // Importar um TXT com filename: substitui TODOS os lançamentos anteriores vindos
    // de importação (razaoBase já filtra por !importId acima). Mantém apenas lançamentos
    // manuais (conciliação, transferência, edição direta).
    // Chamadas sem filename (edição/reconciliação/exclusão/transferência) vêm da tela
    // de razão, que exibe `razaoRowsSemContasPendentes` — uma VIEW que já exclui
    // lançamentos de contas ainda pendentes de renomear. `list` reflete só essa view
    // editada; os lançamentos das contas pendentes (fora da tela) precisam ser
    // devolvidos aqui, senão cada save sem filename os apaga silenciosamente.
    let imported = list.map((r) => ({
      ...r,
      isReconciliation: filename ? false : r.isReconciliation,
      importId: r.importId ?? importId,
    }));

    if (corteDate) {
      if (filename) {
        const totalAntes = imported.length;
        imported = imported.filter(r => {
          if (!r.data) return true;
          return !isRowInClosedPeriod(r.data, corteDate);
        });
        const ignorados = totalAntes - imported.length;
        if (ignorados > 0) {
          window.alert(
            `Atenção: ${ignorados} lançamento(s) do arquivo foram ignorados pois pertencem ao período fechado (até ${corteBr}).`
          );
        }
      } else {
        const originalClosed = razaoRows.filter(r => r.data && isRowInClosedPeriod(r.data, corteDate));
        const newClosed = list.filter(r => r.data && isRowInClosedPeriod(r.data, corteDate));

        let violado = false;
        if (originalClosed.length !== newClosed.length) {
          violado = true;
        } else {
          const mapOrig = new Map(originalClosed.map(r => [r.id || `${r.data}_${r.codigo}_${r.debito}_${r.credito}`, r]));
          for (const nr of newClosed) {
            const key = nr.id || `${nr.data}_${nr.codigo}_${nr.debito}_${nr.credito}`;
            const orig = mapOrig.get(key);
            if (!orig) {
              violado = true;
              break;
            }
            if (
              orig.data !== nr.data ||
              orig.codigo !== nr.codigo ||
              orig.debito !== nr.debito ||
              orig.credito !== nr.credito ||
              orig.historico !== nr.historico
            ) {
              violado = true;
              break;
            }
          }
        }

        if (violado) {
          window.alert(
            `Erro: O período está fechado até ${corteBr}. Não é permitido criar, editar ou excluir lançamentos neste intervalo.`
          );
          return;
        }
      }
    }

    // Importar um arquivo substitui APENAS os lançamentos daquele mesmo arquivo
    // (identificados pelo mesmo importId). Lançamentos de outros arquivos importados
    // anteriormente são preservados, permitindo importar períodos diferentes sem perder
    // dados. Mantém também lançamentos manuais (conciliação, transferência, edição direta)
    // que não possuem importId.
    const razaoBase = filename && importId
      ? razaoRows.filter((r) => r.importId !== importId)
      : razaoRows;

    // Lançamentos de contas pendentes de renomear ficam de fora da tela de razão
    // (razaoRowsSemContasPendentes) — precisam ser devolvidos ao salvar sem filename,
    // senão somem do razão completo (bug: transferência/edição "não salvava").
    const pendentesForaDaView = filename
      ? []
      : razaoRows.filter((r) => !razaoRowsSemContasPendentes.includes(r));

    const merged = filename ? [...razaoBase, ...imported] : [...pendentesForaDaView, ...imported];
    const normalized = normalizeRazaoImport(merged);
    setRazaoRows(normalized);
    writeManagerDataNow(selectedCompany, 'razao', normalized);
    void flushPersistenceAfterCriticalWrite();

  };

  const deleteImportedTxt = async (id: string) => {
    const filename = importedTxts.find((t) => t.id === id)?.filename ?? id;
    /**
     * Excluir em "Docs. Importados" TEM que tirar os lançamentos do balancete.
     * Só o `id` do card não bastava: reimportações antigas do MESMO arquivo criavam
     * entradas com ids diferentes, e sobrava lançamento no balancete depois de
     * apagar o card. Junta todos os ids registrados com o mesmo nome de arquivo.
     */
    const idsDoArquivo = new Set<string>([
      id,
      ...importedTxts.filter((t) => t.filename === filename).map((t) => t.id),
    ]);
    const pertenceAoArquivo = (r: VisionBalanceteRow) =>
      Boolean(r.importId && idsDoArquivo.has(r.importId));

    const removidos = razaoRows.filter(pertenceAoArquivo).length;
    const semImportId = razaoRows.filter((r) => !pertenceAoArquivo(r));
    const remainingTxts = importedTxts.filter((t) => !idsDoArquivo.has(t.id));

    // Reimportações do MESMO arquivo feitas antes desta correção geravam um importId
    // novo a cada vez, então o razão pode ter lançamentos "órfãos" de imports antigas
    // do mesmo arquivo (já sem entrada correspondente em Docs Importados) que a exclusão
    // por importId sozinha não pega. Complementa removendo, do restante, qualquer linha
    // com a mesma combinação data+conta+valor+histórico de uma linha que acabou de ser
    // excluída — mesma chave já usada para detectar duplicidade ao importar.
    const chaveLancamento = (r: VisionBalanceteRow) =>
      `${r.data || ''}|${r.codigo || ''}|${r.classificacao || ''}|${r.debito || 0}|${r.credito || 0}|${(r.nome || '').trim().toUpperCase()}`;
    const chavesExcluidas = new Set(razaoRows.filter(pertenceAoArquivo).map(chaveLancamento));
    const remainingRows = chavesExcluidas.size
      ? semImportId.filter((r) => !chavesExcluidas.has(chaveLancamento(r)))
      : semImportId;
    const orfaosRemovidos = semImportId.length - remainingRows.length;

    setRazaoRows(remainingRows);
    writeManagerDataNow(selectedCompany, 'razao', remainingRows);
    const key = `contabilfacil_${companyStorageSlug(selectedCompany)}_imported_txts`;
    setImportedTxts(remainingTxts);
    writePersistedLocalStorageJson(key, remainingTxts);
    // Espera a confirmação do envio para o backend (Docker) antes de considerar a
    // exclusão concluída — sem isso, uma falha de rede silenciosa deixava os
    // lançamentos do arquivo "excluído" ainda salvos no servidor: ao reimportar o
    // mesmo arquivo depois, a deduplicação os encontrava de novo e os ignorava,
    // parecendo que a exclusão nunca tinha acontecido.
    try {
      await flushPersistenceAfterCriticalWrite();
      // Antes, quando nada casava, o card sumia da lista e o balancete ficava
      // exatamente igual — sem uma palavra. Avisa em vez de fingir que excluiu.
      if (removidos === 0 && orfaosRemovidos === 0) {
        window.alert(
          `"${filename}" foi removido da lista, mas NENHUM lançamento do balancete estava marcado como vindo desse arquivo — ` +
            `nada foi excluído do razão.\n\nUse Configuração › Excluir período / contas para tirar esses lançamentos do balancete.`,
        );
      } else if (orfaosRemovidos > 0) {
        window.alert(
          `"${filename}" excluído: ${removidos} lançamento(s) removidos, + ${orfaosRemovidos} lançamento(s) órfão(s) de reimportações antigas do mesmo arquivo (mesma data/conta/valor/histórico) também removidos.`,
        );
      }
    } catch {
      window.alert(
        `Não foi possível confirmar a exclusão de "${filename}" no servidor (falha de rede). Os ${removidos + orfaosRemovidos} lançamento(s) foram removidos localmente, mas tente excluir de novo assim que a conexão voltar para garantir que fiquem removidos também no servidor.`,
      );
    }
  };

  const codeLengthToLevel = (code: string): number => {
    const len = code.replace(/\D/g, '').length;
    if (len <= 1) return 1;
    if (len <= 2) return 2;
    if (len <= 3) return 3;
    if (len <= 5) return 4;
    if (len <= 10) return 5;
    return 6;
  };

  const handleAddPlanoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!accCode || !accName) return;
    const group = derivePlanoGroupFromCode(accCode);
    const item: AccountPlan = {
      code: accCode,
      name: accName.toUpperCase(),
      codigoReduzido: sanitizeCodigoReduzido(accReduzido.trim()) || undefined,
      tipo: accTipo || undefined,
      nivel: accNivel ? parseInt(accNivel, 10) : codeLengthToPlanoLevel(accCode),
      group,
      nature: derivePlanoNatureFromGroup(group),
    };
    savePlano([...planoContas, item]);
    setAccCode('');
    setAccReduzido('');
    setAccName('');
    setAccTipo('');
    setAccNivel('');
    setShowAddPlano(false);
  };

  const extratoPlanoOptions = useMemo(
    () =>
      planoContas
        .filter((a) => a.tipo !== 'S')
        .map((a) => ({
          code: a.code,
          name: a.name,
          codigoReduzido: a.codigoReduzido,
          tipo: a.tipo,
          nivel: a.nivel,
          group: a.group,
        })),
    [planoContas],
  );

  /** Plano completo (inclui sintéticas) — nomes, grupos e hierarquia para regras/IA. */
  const extratoPlanoNomeOptions = useMemo(
    () =>
      planoContas.map((a) => ({
        code: a.code,
        name: a.name,
        codigoReduzido: a.codigoReduzido,
        tipo: a.tipo,
        nivel: a.nivel,
        group: a.group,
      })),
    [planoContas],
  );

  const extratoBancoPlanoOptions = useMemo(
    () =>
      extratoPlanoOptions.filter((a) =>
        /BANCO|CRESOL|SICOOB|BRADESCO|ITAU|CAIXA ECON|BB\b|CONTA\s+MOV/i.test(a.name),
      ),
    [extratoPlanoOptions],
  );

  const extratoContrapartidaPlanoOptions = useMemo(
    () => extratoPlanoOptions.filter((a) => !/^\s*BANCO\b|\bCAIXA\b/i.test(a.name)),
    [extratoPlanoOptions],
  );

  const planoParaResolver = useMemo(
    () =>
      planoContas.map((a) => ({
        code: a.code,
        name: a.name,
        codigoReduzido: a.codigoReduzido,
        tipo: a.tipo,
        group: a.group,
      })),
    [planoContas],
  );

  const deleteExtrato = useCallback(
    (id: string) => {
      setExtratoLancamentos((prev) => {
        const next = syncExtratoConciliacaoStatus(prev.filter((b) => b.id !== id));
        writeManagerDataNow(selectedCompany, 'extrato', next);
        return next;
      });
    },
    [selectedCompany],
  );

  const handleAddExtratoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!extDesc || extVal <= 0) return;
    const draft: BankStatement = {
      id: crypto.randomUUID(),
      date: extDate,
      description: extDesc.toUpperCase(),
      value: extVal,
      nature: extNat,
      accountCode: '',
      accountDebit: '',
      accountCredit: '',
      operationName: extDesc.toUpperCase(),
      status: 'PENDENTE',
    };
    const { rows, cache: nextCache, pendingSemNota } = applyExtratoContaResolver(
      [draft],
      planoParaResolver,
      extratoContaCache,
      extratoResolverOptions,
    );
    const item = rows[0] ?? draft;
    if (nextCache !== extratoContaCache) {
      setExtratoContaCache(nextCache);
      saveExtratoContaMappingCache(selectedCompany, nextCache);
    }
    saveExtratoLocal([...extratoLancamentos, item]);
    notifyPendingSemNota(pendingSemNota);
    setExtDesc('');
    setExtVal(0);
    setShowAddExtrato(false);
  };

  // Delete handlers
  const deleteAccount = (code: string) => {
    savePlano(planoContas.filter(a => a.code !== code));
  };

  const editAccount = (code: string, updates: Partial<PlanoContaRow>) => {
    savePlano(planoContas.map((a) => (a.code === code ? { ...a, ...updates } : a)));
  };

  const deleteFolhaRelatorio = (id: string) => {
    saveFolhaRelatorio(folhaRelatorio.filter((row) => row.id !== id));
  };

  const deleteFolhaRelatorioByDate = (date: string) => {
    if (!date) return;
    const count = folhaRelatorio.filter((r) => r.date === date).length;
    if (count === 0) { window.alert(`Nenhum lançamento encontrado para a data ${date}.`); return; }
    if (!window.confirm(`Excluir ${count} lançamento(s) da data ${date}?`)) return;
    saveFolhaRelatorio(folhaRelatorio.filter((r) => r.date !== date));
    setFolhaDeleteDate('');
  };

  const deleteFolhaRelatorioAll = () => {
    if (folhaRelatorio.length === 0) return;
    if (!window.confirm(`Excluir todos os ${folhaRelatorio.length} lançamento(s) da folha? Essa ação não pode ser desfeita.`)) return;
    saveFolhaRelatorio([]);
  };

  const extratoConciliacaoStats = useMemo(
    () => summarizeExtratoConciliacao(extratoLancamentos),
    [extratoLancamentos],
  );

  const extratoBuscaNorm = useMemo(() => normalizeExtratoBuscaTexto(extratoBusca), [extratoBusca]);

  const extratoLancamentosFiltrados = useMemo(() => {
    const porStatus = filterExtratoByConciliacaoFiltro(extratoLancamentos, extratoConciliacaoFiltro);
    if (!extratoBuscaNorm) return porStatus;
    return porStatus.filter((row) => extratoRowMatchesBusca(row, extratoBuscaNorm));
  }, [extratoLancamentos, extratoConciliacaoFiltro, extratoBuscaNorm]);

  const extratoSampleForRegras = useMemo(
    () =>
      extratoLancamentos.map((e) => ({
        description: e.description,
        nature: e.nature,
        value: e.value,
        date: e.date,
      })),
    [extratoLancamentos],
  );

  const placarTotais = useMemo(
    () => sumExtratoPlacarTotais(extratoLancamentos),
    [extratoLancamentos],
  );
  const currentTotalInflows = placarTotais.creditos;
  const currentTotalOutflows = placarTotais.debitos;

  const placarConciliados = useMemo(
    () => sumExtratoPlacarTotaisConciliados(extratoLancamentos),
    [extratoLancamentos],
  );

  const saldoFinalExtratoInfo = useMemo(
    () =>
      resolveSaldoFinalExtrato({
        saldoAnterior: saldoAnteriorExtrato,
        creditos: currentTotalInflows,
        debitos: currentTotalOutflows,
      }),
    [saldoAnteriorExtrato, currentTotalInflows, currentTotalOutflows],
  );

  /** Saldo do que já foi conciliado até o momento (só linhas com D+C). */
  const saldoConciliadoAteMomento = useMemo(
    () => calcSaldoConciliadoAteMomento(saldoAnteriorExtrato, extratoLancamentos),
    [saldoAnteriorExtrato, extratoLancamentos],
  );

  /** Mantido para DRE / outros placares que usam o saldo do extrato completo. */
  const currentTotalBalance = saldoFinalExtratoInfo.valor;

  const folhaPayrollTotals = useMemo(
    () =>
      folhaPayroll.reduce(
        (acc, r) => ({
          base: acc.base + r.baseSalary,
          inss: acc.inss + r.inss,
          irrf: acc.irrf + r.irrf,
          fgts: acc.fgts + r.fgts,
          net: acc.net + r.net,
        }),
        { base: 0, inss: 0, irrf: 0, fgts: 0, net: 0 },
      ),
    [folhaPayroll],
  );

  /**
   * Totais líquidos por conta contábil da folha (débito − crédito).
   * Para cada lançamento do relatório, encontra a regra que match pelo histórico,
   * e soma o valor como DÉBITO na contaDebito e como CRÉDITO (subtrai) na contaCredito.
   */
  /** Converte dd/mm/yyyy → Date (00:00:00) ou null. */
  const parseBrDate = (s: string): Date | null => {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
    if (!m) return null;
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return isNaN(d.getTime()) ? null : d;
  };

  const folhaTotaisPorConta = useMemo(() => {
    const dateFrom = parseBrDate(folhaTotaisDe);
    const dateTo = parseBrDate(folhaTotaisAte);

    const totais = new Map<string, { conta: string; nomeConta: string; debito: number; credito: number }>();

    const planoNomeLookup = new Map<string, string>();
    for (const a of planoContas) {
      if (a.codigoReduzido) planoNomeLookup.set(a.codigoReduzido, a.name);
      if (a.code) planoNomeLookup.set(a.code, a.name);
    }

    const getNome = (codigo: string) => planoNomeLookup.get(codigo) ?? codigo;

    const ensureConta = (codigo: string) => {
      if (!totais.has(codigo)) {
        totais.set(codigo, { conta: codigo, nomeConta: getNome(codigo), debito: 0, credito: 0 });
      }
      return totais.get(codigo)!;
    };

    for (const row of folhaRelatorio) {
      // Filtro de período — row.date está em dd/mm/yyyy
      if (dateFrom || dateTo) {
        const rowDate = parseBrDate(row.date);
        if (!rowDate) continue;
        if (dateFrom && rowDate < dateFrom) continue;
        if (dateTo && rowDate > dateTo) continue;
      }

      const descNorm = normalizeExtratoMatchText(row.description);
      const regra = folhaRegras.find((r) => {
        const rNorm = normalizeExtratoMatchText(r.descricao);
        return rNorm && descNorm.includes(rNorm);
      });
      if (!regra) continue;
      const valor = row.debito > 0 ? row.debito : row.credito;
      if (valor <= 0) continue;
      ensureConta(regra.contaDebito).debito += valor;
      ensureConta(regra.contaCredito).credito += valor;
    }

    return Array.from(totais.values())
      .map((t) => ({ ...t, saldo: t.debito - t.credito }))
      .sort((a, b) => a.conta.localeCompare(b.conta));
  }, [folhaRelatorio, folhaRegras, planoContas, folhaTotaisDe, folhaTotaisAte]);

  // Render subtabs
  const tabs: { id: ManagerSubTab; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
    { id: 'extrato', label: 'Conciliação', icon: ArrowRightLeft },
    { id: 'razao', label: 'Balancete', icon: BookOpen },
    { id: 'plano', label: 'Plano de Contas', icon: ClipboardList },
    { id: 'emprestimos', label: 'Empréstimos', icon: DollarSign },
    { id: 'custos', label: 'Custos & Faturamento', icon: BarChart },
    { id: 'indiceLiquidez', label: 'Índice de Liquidez', icon: Activity },
    { id: 'aplicacoes', label: 'Aplicações', icon: Landmark },
  ];

  const hasPlano = planoContas.length > 0;
  const isEmbeddedSimulator = activeSubTab === 'emprestimos';
  const tabRequiresPlano = !STANDALONE_MANAGER_TABS.has(activeSubTab);

  const planoTotalSinteticas = useMemo(
    () => planoContas.filter((r) => r.tipo === 'S').length,
    [planoContas],
  );
  const planoTotalAnaliticas = useMemo(
    () => planoContas.filter((r) => r.tipo === 'A').length,
    [planoContas],
  );

  /**
   * Chamado assim que as regras mudam no modal (nova regra, edição, exclusão).
   *
   * Espelho fiel das regras: qualquer linha que bata com uma regra recebe
   * imediatamente as contas dessa regra — inclusive se já tinha contas de uma
   * versão anterior da regra. Linhas sem regra correspondente mantêm a
   * digitação manual (se ambos os lados estiverem preenchidos e forem contas
   * diferentes). Isso garante que a tabela e o TXT exportado sempre refletem
   * exatamente o que foi configurado nas regras.
   */
  const handleExtratoRegrasContasChange = useCallback(
    (novasRegras: typeof extratoRegrasContas) => {
      setExtratoRegrasContas(novasRegras);
      if (extratoLancamentos.length === 0 || planoParaResolver.length === 0) return;
      const banco = getExtratoBancoConta(selectedCompany) || contaBancoExtratoAtivo;
      addDebugLog(`── onChange REGRAS (${novasRegras.length} regras) banco=${banco} linhas=${extratoLancamentos.length}`, 'regras');
      novasRegras.slice(0, 5).forEach(r => addDebugLog(`  regra [${r.nature}] "${r.descricao.slice(0,30)}" → ${r.contaContrapartida}`, 'regras'));
      const { rows: resolvidas } = applyExtratoContaResolver(
        extratoLancamentos,
        planoParaResolver,
        extratoContaCache,
        {
          ...extratoResolverOptions,
          contaBancoPreferida: banco,
          regrasContas: novasRegras,
          soAplicarRegras: true,
        },
      );
      const mudancas = resolvidas.filter((r, i) => {
        const orig = extratoLancamentos[i];
        return orig && (r.accountDebit !== orig.accountDebit || r.accountCredit !== orig.accountCredit);
      });
      addDebugLog(`  → ${mudancas.length} linha(s) alterada(s) pelo soAplicarRegras`, 'regras');
      mudancas.slice(0, 5).forEach(r => addDebugLog(`    • "${r.description.slice(0,28)}" D:${r.accountDebit || '—'} C:${r.accountCredit || '—'}`, 'regras'));
      saveExtratoLocal(resolvidas, true);
    },
    [
      extratoLancamentos,
      planoParaResolver,
      extratoContaCache,
      extratoResolverOptions,
      contaBancoExtratoAtivo,
      selectedCompany,
      saveExtratoLocal,
      addDebugLog,
    ],
  );

  const handleReaplicarExtratoContas = useCallback(async (options?: { immediate?: boolean }) => {
    if (extratoLancamentos.length === 0) {
      alert('Nenhum lancamento para reaplicar contas.');
      return;
    }
    if (planoParaResolver.length === 0) {
      alert('Importe o plano de contas antes de reaplicar a conciliacao.');
      return;
    }
    beginHeavyUiWork();
    try {
      const companyScope = selectedCompany;
      extratoAsyncVersionRef.current += 1;
      const asyncVersion = extratoAsyncVersionRef.current;
      const banco = getExtratoBancoConta(companyScope) || contaBancoExtratoAtivo;
      const regrasFresh = loadExtratoRegrasContas(companyScope, banco);
      addDebugLog(`── REAPLICAR CONTAS banco=${banco} regras=${regrasFresh.length} linhas=${extratoLancamentos.length}`, 'conciliação');
      const { rows, cache: nextCache, pendingSemNota } = await applyExtratoContaResolverAsync(
        extratoLancamentos,
        planoParaResolver,
        extratoContaCache,
        {
          ...extratoResolverOptions,
          contaBancoPreferida: banco,
          regrasContas: regrasFresh.length > 0 ? regrasFresh : extratoRegrasContas,
        },
      );
      if (isExtratoAsyncResultStale(companyScope, asyncVersion)) return;
      const mudancas2 = rows.filter((r, i) => {
        const orig = extratoLancamentos[i];
        return orig && (r.accountDebit !== orig.accountDebit || r.accountCredit !== orig.accountCredit);
      });
      addDebugLog(`  → ${mudancas2.length} linha(s) alterada(s) pelo REAPLICAR`, 'conciliação');
      mudancas2.slice(0, 5).forEach(r => addDebugLog(`    • "${r.description.slice(0,28)}" D:${r.accountDebit || '—'} C:${r.accountCredit || '—'}`, 'conciliação'));
      startTransition(() => {
        commitExtratoResolverResult(companyScope, rows, nextCache, pendingSemNota, {
          immediate: options?.immediate ?? false,
        });
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : 'Falha ao reaplicar contas.';
      alert(msg);
    } finally {
      endHeavyUiWork();
    }
  }, [
    contaBancoExtratoAtivo,
    commitExtratoResolverResult,
    extratoContaCache,
    extratoLancamentos,
    extratoRegrasContas,
    isExtratoAsyncResultStale,
    extratoResolverOptions,
    planoParaResolver,
    selectedCompany,
  ]);

  const handleMandarConciliacaoParaBalancete = useCallback(async (
    periodo?: BalancetePeriodo,
    opts?: { todos?: boolean },
  ) => {
    const bancoAtivoImport = getExtratoBancoConta(selectedCompany) || contaBancoExtratoAtivo;
    const conciliadasAberto = extratoConciliacaoStats.conciliadas;
    if (conciliadasAberto === 0 && countExtratoPastas(selectedCompany) === 0) {
      alert(
        'Nenhum lançamento conciliado para enviar.\n\nPreencha débito e crédito, use Reaplicar contas ou gere regras em Regras de Contas.',
      );
      return;
    }
    // Se ainda não temos o período (e não estamos no reenvio forçado), abre o modal para capturá-lo
    // "Importar tudo" (mesma opcao do EXPORTAR TXT+): manda todos os conciliados,
    // de qualquer data, sem pedir periodo. O ref mantem a escolha viva para o
    // reenvio forcado (SOBRESCREVER), que rechama este handler sem argumentos.
    const todos = opts?.todos ?? lastConciliacaoTodosRef.current;
    if (todos) lastConciliacaoTodosRef.current = true;

    /**
     * Universo a importar. Antes daqui saia `extratoLancamentos` -- so o extrato
     * ABERTO na tela -- entao "IMPORTAR TUDO" deixava de fora todos os meses ja
     * conciliados e guardados em pastas, e todos os outros bancos da empresa.
     * Agora usa o mesmo coletor da exportacao TXT+: extrato aberto + pastas
     * salvas; e em "TUDO", de todos os bancos.
     */
    const universoImport = todos
      ? coletarGruposTodosOsBancos(bancoAtivoImport).flatMap((g) => g.rows)
      : coletarLancamentosExtratoParaExport(bancoAtivoImport);
    if (universoImport.filter(isExtratoLancamentoConciliado).length === 0) {
      alert('Nenhum lancamento conciliado para enviar ao balancete.');
      lastConciliacaoTodosRef.current = false;
      return;
    }

    const periodoEfetivo = todos ? null : (periodo ?? lastPeriodoConciliacaoRef.current);
    if (!todos && !periodoEfetivo) {
      setPeriodoModalConciliacaoOpen(true);
      return;
    }
    // Salva o período para o caso de reenvio forçado (SOBRESCREVER)
    lastPeriodoConciliacaoRef.current = periodoEfetivo;

    // O modal pede "período a lançar" mas antes disso a data nunca era usada pra
    // filtrar — TODOS os conciliados (de qualquer data) eram enviados de uma vez,
    // e a data só entrava na mensagem final. Filtra aqui pelo intervalo (inclusive
    // dos dois lados) para que "mandar para o balancete" realmente escope pelas
    // datas informadas — e nada fora do período seja arrastado junto.
    // Datas que o parser nao reconhece ("2026/06/15", "JUN/26", vazia) nao caem em
    // periodo NENHUM: quem importava mes a mes nunca via essas linhas chegarem ao
    // balancete e nao recebia aviso. Separa e informa no fim.
    const semDataReconhecida: typeof universoImport = [];
    const lancamentosNoPeriodo = !periodoEfetivo
      ? universoImport
      : universoImport.filter((lan) => {
          const br = parseDataRazao(lan.date); // "DD/MM/AAAA" (ou "" se não reconhecer)
          const m = br.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
          if (!m) {
            if (isExtratoLancamentoConciliado(lan)) semDataReconhecida.push(lan);
            return false;
          }
          const iso = `${m[3]}-${m[2]}-${m[1]}`;
          return iso >= periodoEfetivo.dataInicio && iso <= periodoEfetivo.dataFim;
        });
    if (lancamentosNoPeriodo.length === 0) {
      if (!periodoEfetivo) {
        alert('Nenhum lancamento do extrato para importar.');
        lastConciliacaoTodosRef.current = false;
        return;
      }
      const periodoStr = `${periodoEfetivo.dataInicio.split('-').reverse().join('/')} até ${periodoEfetivo.dataFim.split('-').reverse().join('/')}`;
      alert(`Nenhum lançamento do extrato cai no período ${periodoStr}.`);
      lastPeriodoConciliacaoRef.current = null;
      return;
    }

    try {
      /**
       * Antes de gravar, mede quantas linhas JÁ existentes no razão têm exatamente o
       * mesmo conteúdo contábil dos que estão entrando, mas vieram de outra origem —
       * caso clássico: exportou o TXT+ da conciliação e importou esse mesmo TXT no
       * balancete. Sem isso o mês somava o mesmo lançamento duas vezes (D e C do mês
       * inflados, saldo anterior correto). Pergunta em vez de decidir sozinho: apagar
       * lançamento de outra origem não é reversível.
       */
      const previa = postExtratoConciliadosNoRazao(
        selectedCompany,
        lancamentosNoPeriodo,
        forceOverwriteBalancete,
      );
      let resultado = previa;
      if (previa.equivalentesDeOutrasOrigens > 0) {
        const substituir = window.confirm(
          `${previa.equivalentesDeOutrasOrigens} lançamento(s) já estavam no balancete com a MESMA data, conta, valor e histórico, ` +
            `mas vindos de outra origem (ex.: o TXT+ exportado da conciliação e importado aqui).\n\n` +
            `Se ficarem os dois, o mês soma o mesmo lançamento duas vezes.\n\n` +
            `OK = manter só os da conciliação (remove as cópias da outra origem)\n` +
            `Cancelar = deixar como está`,
        );
        if (substituir) {
          resultado = postExtratoConciliadosNoRazao(
            selectedCompany,
            lancamentosNoPeriodo,
            forceOverwriteBalancete,
            true,
          );
        }
      }
      const { gerados, conflitos, conciliadosRecebidos, ignorados } = resultado;

      // Se há conflitos detectados, mostra modal
      if (conflitos && conflitos.length > 0 && !forceOverwriteBalancete) {
        setBalanceteConflitosDetectados(conflitos);
        setShowBalanceteConflictModal(true);
        return;
      }

      setRazaoRows(readManagerData<VisionBalanceteRow>(selectedCompany, 'razao'));
      await flushPersistenceAfterCriticalWrite();
      
      // Reseta flags de sobrescrita
      setForceOverwriteBalancete(false);
      setShowBalanceteConflictModal(false);
      lastPeriodoConciliacaoRef.current = null;
      lastConciliacaoTodosRef.current = false;

      // Monta mensagem simplificada
      const periodoStr = !periodoEfetivo
        ? 'todos os lancamentos (sem filtro de data)'
        : `${periodoEfetivo.dataInicio.split('-').reverse().join('/')} até ${periodoEfetivo.dataFim.split('-').reverse().join('/')}`;
      // Conferencia explicita: o que a aba de conciliacao mostra x o que entrou.
      const linhasConferencia: string[] = [];
      if (ignorados.length > 0) {
        linhasConferencia.push(
          `${ignorados.length} lançamento(s) ignorado(s) por valor inválido: ` +
            ignorados.slice(0, 5).map((i) => i.descricao || i.id).join(', ') +
            (ignorados.length > 5 ? '…' : ''),
        );
      }
      if (semDataReconhecida.length > 0) {
        linhasConferencia.push(
          `${semDataReconhecida.length} lançamento(s) conciliado(s) ficaram de fora porque a data não é reconhecida ` +
            `(ex.: "${semDataReconhecida[0]?.date ?? ''}"). Corrija a data ou use IMPORTAR TUDO.`,
        );
      }
      if (gerados !== conciliadosRecebidos) {
        linhasConferencia.push(`Conciliados no filtro: ${conciliadosRecebidos} · importados: ${gerados}.`);
      }
      const NL = String.fromCharCode(10);
      const rodape =
        linhasConferencia.length > 0
          ? `${NL}${NL}ATENÇÃO:${NL}- ${linhasConferencia.join(`${NL}- `)}`
          : '';

      let mensagem = '';
      if (gerados > 0) {
        mensagem = `${gerados} lançamento(s) conciliado(s) enviados ao balancete.\nPeríodo: ${periodoStr}\n\nAbra a aba Balancete para conferir.`;
      } else {
        mensagem = 'Nada novo para enviar — os conciliados já estavam no balancete (ou não geraram partidas).';
      }

      alert(mensagem + rodape);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao enviar para o balancete.';
      alert(msg);
    }
  }, [
    contaBancoExtratoAtivo,
    extratoConciliacaoStats.conciliadas,
    extratoLancamentos,
    planoParaResolver,
    selectedCompany,
    forceOverwriteBalancete,
  ]);

  /**
   * PROIBIDO: reaplicação automática de contas no extrato.
   *
   * Aqui existia um efeito que, a cada mudança de empresa/banco/plano/regras,
   * rodava o resolver sobre TODAS as linhas do extrato em background e gravava o
   * resultado por cima. Isso desfazia conciliação já feita à mão — horas de
   * trabalho substituídas por palpite, sem o usuário pedir e sem aviso.
   *
   * NÃO REINTRODUZA. A conciliação só pode mudar por ação explícita do usuário:
   * - editar a conta direto na tabela;
   * - clicar em "Reaplicar contas";
   * - importar um arquivo novo (linhas novas, ainda em branco);
   * - responder o modal "sem nota" (e ainda assim sem tocar em linha fechada).
   *
   * Ver docs/CONCILIACAO-EXTRATO-REGRAS.md.
   */

  const buildExtratoConciliacaoExportPayload = () => {
    const lookup = buildPlanoNomeLookup(extratoPlanoNomeOptions);
    const bancoConta = getExtratoBancoConta(selectedCompany);
    const bancoNome = resolveContaNome(lookup, bancoConta, extratoPlanoNomeOptions);
    const rows = extratoLancamentos.map((e) => {
      const deb =
        e.accountDebit?.trim() ||
        (!e.accountCredit?.trim() && e.accountCode?.trim() && e.nature === 'C' ? e.accountCode : '');
      const cred =
        e.accountCredit?.trim() ||
        (!e.accountDebit?.trim() && e.accountCode?.trim() && e.nature === 'D' ? e.accountCode : '');
      return {
        date: e.date,
        description: e.description,
        value: e.value,
        nature: e.nature,
        accountDebit: deb,
        accountCredit: cred,
        accountDebitName: resolveContaNome(lookup, deb, extratoPlanoNomeOptions),
        accountCreditName: resolveContaNome(lookup, cred, extratoPlanoNomeOptions),
        operationName: e.operationName || e.description,
      };
    });
    return {
      rows,
      empresa: selectedCompany,
      bancoConta,
      bancoNome,
      saldoAnterior: saldoAnteriorExtrato,
    };
  };

  const handleExportExtratoConciliacaoPdf = () => {
    try {
      exportExtratoConciliacaoPdf(buildExtratoConciliacaoExportPayload());
      addDebugLog('── EXPORTAR PDF conciliação extrato', 'exportação');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao gerar PDF.';
      alert(msg);
    }
  };

  const handleSalvarExtratoNaPasta = () => {
    try {
      const banco =
        getExtratoBancoConta(selectedCompany) || contaBancoExtratoAtivo;
      if (!banco.trim()) {
        alert('Defina a conta banco (em Regras de Contas) antes de salvar o extrato na pasta.');
        return;
      }
      if (extratoLancamentos.length === 0) {
        alert('Nenhum lançamento para salvar.');
        return;
      }
      const bancoNome =
        getExtratoBancoNome(selectedCompany) ||
        resolveContaNome(
          buildPlanoNomeLookup(extratoPlanoNomeOptions),
          banco,
          extratoPlanoNomeOptions,
        ) ||
        `Banco ${banco}`;

      const dates = extratoLancamentos.map(r => r.date).filter(Boolean).sort();
      const first = dates[0] || '';
      const last = dates[dates.length - 1] || '';
      const fmt = (iso: string) => {
        const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
      };
      const defaultRange = (first && last && first !== last)
        ? `${fmt(first)} a ${fmt(last)}`
        : (first ? `${fmt(first)} a ${fmt(first)}` : '');

      // AUTOSAVE: não pergunta mais — salva com label automático
      const finalRange = defaultRange;
      const label = `EXTRATO ${finalRange.toUpperCase()}`;

      const saved = saveExtratoNaPasta(selectedCompany, {
        contaBanco: banco,
        bancoNome,
        label,
        saldoAnterior: saldoAnteriorExtrato,
        rows: syncExtratoConciliacaoStatus(extratoLancamentos).map((r) => ({
          id: r.id,
          date: r.date,
          description: r.description,
          value: r.value,
          nature: r.nature,
          accountCode: r.accountCode,
          accountDebit: r.accountDebit,
          accountCredit: r.accountCredit,
          operationName: r.operationName,
          status: r.status,
        })),
      });
      // Este extrato salvo passa a ser a "pasta ativa" — garante que um
      // reload restaure exatamente este checkpoint, não dados soltos antigos.
      setExtratoPastaAtivaId(selectedCompany, saved.id);
      setExtratoPastasTick((n) => n + 1);
      alert(
        `Extrato salvo na pasta.\n${saved.label}\nBanco ${saved.contaBanco} · ${saved.total} lançamento(s)`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao salvar extrato na pasta.';
      alert(msg);
    }
  };

  const handleSelectExtratoPasta = (item: ExtratoPastaItem) => {
    try {
      const companyScope = selectedCompany;
      setExtratoContaBancoAtiva(companyScope, item.contaBanco, item.bancoNome);
      saveExtratoRegrasBancoSelecionado(companyScope, item.contaBanco);
      // Marca esta pasta como "ativa" — ao recarregar a página, restauramos
      // exatamente este extrato em vez de confiar na chave bruta 'extrato'
      // (que pode acumular dados obsoletos de sessões/edições anteriores).
      setExtratoPastaAtivaId(companyScope, item.id);
      // IMPORTANTE: contaBancoTick precisa mudar na MESMA transição (mesma
      // prioridade) que extratoLancamentos (setado logo abaixo via
      // saveExtratoLocal, que já usa startTransition). Se ficassem em
      // prioridades diferentes, o React podia renderizar um quadro
      // intermediário com o banco ativo JÁ trocado mas os lançamentos AINDA
      // antigos — e o efeito de reaplicação automática de regras (que
      // depende de ambos) disparava nesse instante, resolvendo os
      // lançamentos do banco ANTERIOR com as regras do banco NOVO.
      startTransition(() => {
        setContaBancoTick((n) => n + 1);
        setSaldoAnteriorExtrato(item.saldoAnterior || 0);
      });
      writeSaldoAnteriorExtrato(companyScope, item.saldoAnterior || 0);
      const rows: BankStatement[] = item.rows.map((r) => ({
        id: r.id || crypto.randomUUID(),
        date: r.date,
        description: r.description,
        value: r.value,
        nature: r.nature === 'C' ? 'C' : 'D',
        accountCode: r.accountCode || '',
        accountDebit: r.accountDebit,
        accountCredit: r.accountCredit,
        operationName: r.operationName,
        status: r.status === 'CONCILIADO' ? 'CONCILIADO' : 'PENDENTE',
      }));

      // Aplica regras cadastradas sobre o snapshot restaurado com soAplicarRegras=true:
      // apenas linhas que batem com uma regra têm D/C atualizados; linhas sem regra
      // (conciliação manual) ficam intactas. Isso garante que ao trocar de mês as
      // regras já editadas sejam refletidas sem precisar de "Reaplicar contas".
      //
      // O resolver completo (sem soAplicarRegras) permanece PROIBIDO aqui — ele
      // re-adivinha contas em linhas sem regra e desfaz conciliação manual.
      extratoAsyncVersionRef.current += 1;
      const regrasSelecionada = loadExtratoRegrasContas(companyScope, item.contaBanco);
      let rowsParaSalvar = rows;
      if (regrasSelecionada.length > 0 && planoParaResolver.length > 0) {
        const { rows: comRegras } = applyExtratoContaResolver(rows, planoParaResolver, {}, {
          contaBancoPreferida: item.contaBanco,
          regrasContas: regrasSelecionada,
          soAplicarRegras: true,
        });
        const mudancasSel = comRegras.filter((r, i) => {
          const orig = rows[i];
          return orig && (r.accountDebit !== orig.accountDebit || r.accountCredit !== orig.accountCredit);
        });
        addDebugLog(
          `── ABRIR pasta "${item.label}" banco=${item.contaBanco} — soAplicarRegras: ${mudancasSel.length}/${rows.length} linha(s) atualizadas`,
          'regras',
        );
        mudancasSel.slice(0, 5).forEach((r) =>
          addDebugLog(
            `    • "${r.description.slice(0, 28)}" D:${r.accountDebit || '—'} C:${r.accountCredit || '—'}`,
            'regras',
          ),
        );
        rowsParaSalvar = comRegras;
      } else {
        addDebugLog(
          `── ABRIR pasta "${item.label}" banco=${item.contaBanco} — sem regras para aplicar`,
          'regras',
        );
      }
      saveExtratoLocal(rowsParaSalvar, true, companyScope);
      setExtratoPastasTick((n) => n + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao abrir extrato da pasta.';
      alert(msg);
    }
  };

  const handleExportExtratoConciliacaoPng = () => {
    try {
      exportExtratoConciliacaoPng(buildExtratoConciliacaoExportPayload());
      addDebugLog('── EXPORTAR PNG conciliação extrato', 'exportação');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao gerar imagem.';
      alert(msg);
    }
  };

  /**
   * Todas as ações da conciliação num menu único com busca.
   *
   * As que dependem de um extrato carregado continuam aparecendo na lista
   * (desabilitadas, com o motivo) — assim o usuário acha a opção pela busca e
   * entende por que ela não está disponível, em vez de o botão simplesmente
   * sumir da tela.
   */
  const temExtrato = extratoLancamentos.length > 0;
  const semExtratoMotivo = 'Importe ou abra um extrato primeiro';

  const acoesConciliacao = useMemo<AcaoMenuItem[]>(
    () => [
      {
        id: 'aplicar-regras',
        label: 'Aplicar regras na conciliação',
        descricao: 'Aplica as contas das regras cadastradas na tabela de conciliação',
        icone: <RefreshCw size={12} aria-hidden="true" />,
        palavras: ['reaplicar', 'recalcular', 'contas', 'debito', 'credito', 'automatico'],
        destaque: true,
        disabled: !temExtrato,
        motivoDisabled: semExtratoMotivo,
        onSelect: () => void handleReaplicarExtratoContas({ immediate: true }),
      },
      {
        id: 'salvar-extrato',
        label: 'Salvar extrato (autosave)',
        descricao: 'Salva o extrato conciliado + PDF na pasta da conta banco',
        icone: <Save size={12} aria-hidden="true" />,
        palavras: ['gravar', 'guardar', 'pasta', 'backup'],
        destaque: true,
        disabled: !temExtrato,
        motivoDisabled: semExtratoMotivo,
        onSelect: handleSalvarExtratoNaPasta,
      },
      {
        id: 'pdf-conciliado',
        label: 'PDF conciliado',
        descricao: 'Exporta a conciliação em PDF',
        icone: <FileText size={12} aria-hidden="true" />,
        palavras: ['exportar', 'imprimir', 'relatorio', 'arquivo'],
        disabled: !temExtrato,
        motivoDisabled: semExtratoMotivo,
        onSelect: handleExportExtratoConciliacaoPdf,
      },
      {
        id: 'imagem',
        label: 'Imagem (PNG)',
        descricao: 'Exporta a conciliação como imagem',
        icone: <FileImage size={12} aria-hidden="true" />,
        palavras: ['png', 'print', 'foto', 'captura', 'exportar'],
        disabled: !temExtrato,
        motivoDisabled: semExtratoMotivo,
        onSelect: handleExportExtratoConciliacaoPng,
      },
      {
        id: 'importar-balancete',
        label: 'Importar para o balancete',
        descricao: 'Leva os lançamentos conciliados para o balancete — por período ou tudo',
        icone: <Upload size={12} aria-hidden="true" />,
        palavras: ['balancete', 'lancar', 'contabilizar', 'periodo', 'enviar'],
        disabled: !temExtrato,
        motivoDisabled: semExtratoMotivo,
        onSelect: () => setPeriodoModalImportBalanceteOpen(true),
      },
      {
        id: 'pastas-extratos',
        label: 'Pastas de extratos',
        descricao: 'Extratos salvos por conta banco — selecionar puxa as regras',
        icone: <FolderOpen size={12} aria-hidden="true" />,
        badge: extratoPastasCount > 0 ? extratoPastasCount : undefined,
        palavras: ['abrir', 'salvos', 'historico', 'arquivos', 'banco'],
        onSelect: () => setExtratoPastasModalOpen(true),
      },
      {
        id: 'regras-contas',
        label: 'Regras de contas',
        descricao: 'Regras por histórico, valor, documento e importação da folha',
        icone: <ListOrdered size={12} aria-hidden="true" />,
        badge: regrasContasDoBancoAtivo.length > 0 ? regrasContasDoBancoAtivo.length : undefined,
        palavras: ['conciliacao', 'cadastro', 'contrapartida', 'folha', 'liquidos', 'cpf', 'valor'],
        onSelect: () => setRegrasContasModalOpen(true),
      },
      {
        id: 'debug-logs',
        label: 'Debug logs',
        descricao: 'Painel de diagnóstico — mostra o que o sistema fez com as contas',
        icone: <span aria-hidden="true">🛠</span>,
        badge: debugLogs.length > 0 ? debugLogs.length : undefined,
        palavras: ['diagnostico', 'log', 'erro', 'suporte', 'tecnico'],
        onSelect: () => setDebugPanelOpen((v) => !v),
      },
    ],
    [
      debugLogs.length,
      extratoPastasCount,
      handleExportExtratoConciliacaoPdf,
      handleExportExtratoConciliacaoPng,
      handleReaplicarExtratoContas,
      handleSalvarExtratoNaPasta,
      regrasContasDoBancoAtivo.length,
      temExtrato,
    ],
  );

  // Converte data BR (DD/MM/YYYY, DD-MM-YYYY, DD/MM/YY) ou ISO (YYYY-MM-DD)
  // para ISO comparável. Retorna '' quando não reconhece o formato — assim o
  // filtro de período sabe distinguir "fora do período" de "data ilegível".
  // Mesma função usada pelo gerador do TXT+ (`dominioTxtIO`), para que o filtro
  // de período e o arquivo nunca discordem sobre a data de um lançamento.
  const toIsoDate = (data: string): string => brDateToIso(data);

  /**
   * Universo de lançamentos considerado na exportação TXT+ do extrato.
   *
   * O estado `extratoLancamentos` só contém o extrato ABERTO no momento (uma
   * pasta / um arquivo importado). Exportar a partir dele fazia "EXPORTAR TUDO"
   * e o filtro de período trazerem apenas o extrato selecionado na tela — os
   * demais meses já conciliados e salvos em pastas ficavam de fora.
   *
   * Aqui juntamos o extrato aberto com todas as pastas salvas da MESMA conta
   * banco (outra conta banco não pode entrar: a partida dobrada do TXT usa a
   * conta banco ativa e os lançamentos cairiam no banco errado), removendo
   * duplicatas — a pasta salva e o extrato aberto normalmente são o mesmo
   * conjunto de linhas.
   */
  const coletarLancamentosExtratoParaExport = (
    banco: string,
    opts?: { incluirExtratoAberto?: boolean },
  ): BankStatement[] => {
    // O extrato aberto na tela pertence à conta banco ATIVA. Ao varrer outros
    // bancos (EXPORTAR/IMPORTAR TUDO) ele não pode entrar, senão as linhas do
    // banco ativo seriam contabilizadas de novo com a conta banco errada.
    const incluirAberto = opts?.incluirExtratoAberto !== false;
    const lancamentosAbertos = incluirAberto ? extratoLancamentos : [];
    // IDs do extrato aberto — essas linhas JÁ tiveram regras aplicadas no
    // reload/onChange e chegam aqui com D/C corretos. Não devem ser re-processadas.
    const idsExtratoAberto = new Set<string>(
      lancamentosAbertos.map((r) => r.id).filter(Boolean) as string[],
    );

    const out: BankStatement[] = [];
    const idsVistos = new Set<string>();

    const adicionar = (row: BankStatement) => {
      if (row.id && idsVistos.has(row.id)) return;
      if (row.id) idsVistos.add(row.id);
      out.push(row);
    };

    // O extrato aberto entra primeiro: já passou pelo soAplicarRegras no reload.
    for (const row of lancamentosAbertos) adicionar(row);

    // Linhas de pastas de meses anteriores (não duplicadas no extrato aberto).
    // Mantém separado por pasta para logar cada mês individualmente.
    const linhasDePastasPorPasta: Array<{ label: string; rows: BankStatement[] }> = [];
    const linhasDePastas: BankStatement[] = [];

    let pastas: ExtratoPastaItem[] = [];
    try {
      pastas = banco.trim() ? listExtratoPastasPorBanco(selectedCompany, banco) : [];
    } catch {
      pastas = [];
    }

    addDebugLog(
      `── COLETAR EXPORT banco=${banco} extrato_aberto=${lancamentosAbertos.length} pastas=${pastas.length}`,
      'exportação',
    );

    for (const pasta of pastas) {
      const rowsDessaPasta: BankStatement[] = [];
      for (const r of pasta.rows) {
        const row: BankStatement = {
          id: r.id || crypto.randomUUID(),
          date: r.date,
          description: r.description,
          value: r.value,
          nature: r.nature === 'C' ? 'C' : 'D',
          accountCode: r.accountCode || '',
          accountDebit: r.accountDebit,
          accountCredit: r.accountCredit,
          operationName: r.operationName,
          status: r.status === 'CONCILIADO' ? 'CONCILIADO' : 'PENDENTE',
        };
        // Só acumula para re-processar se NÃO está já no extrato aberto.
        if (!idsExtratoAberto.has(row.id)) {
          linhasDePastas.push(row);
          rowsDessaPasta.push(row);
        }
        adicionar(row);
      }
      linhasDePastasPorPasta.push({ label: pasta.label, rows: rowsDessaPasta });
      const novas = rowsDessaPasta.length;
      const total = pasta.rows.length;
      addDebugLog(
        `  pasta "${pasta.label}" — ${total} linha(s) total, ${novas} nova(s) (fora do extrato aberto)`,
        'exportação',
      );
    }

    // Regras e plano atuais — aplica somente sobre os snapshots das pastas
    // antigas (meses anteriores). As linhas do extrato aberto ficam intactas.
    const regrasFrescas = loadExtratoRegrasContas(selectedCompany, banco);
    const planoAtual = planoParaResolver;

    if (linhasDePastas.length > 0 && regrasFrescas.length > 0 && planoAtual.length > 0) {
      addDebugLog(
        `  aplicando soAplicarRegras em ${linhasDePastas.length} linhas de pastas (${regrasFrescas.length} regras)`,
        'exportação',
      );
      const { rows: comRegras } = applyExtratoContaResolver(linhasDePastas, planoAtual, {}, {
        contaBancoPreferida: banco,
        regrasContas: regrasFrescas,
        soAplicarRegras: true,
      });

      // Loga mudanças por pasta
      const regrasById = new Map(comRegras.map((r) => [r.id, r]));
      for (const { label, rows: rowsOrig } of linhasDePastasPorPasta) {
        const mudancas = rowsOrig.filter((r) => {
          const novo = r.id ? regrasById.get(r.id) : undefined;
          return novo && (novo.accountDebit !== r.accountDebit || novo.accountCredit !== r.accountCredit);
        });
        addDebugLog(
          `  "${label}" — ${mudancas.length}/${rowsOrig.length} linha(s) atualizadas pelas regras`,
          'exportação',
        );
        mudancas.slice(0, 5).forEach((r) => {
          const novo = regrasById.get(r.id!)!;
          addDebugLog(
            `    • "${r.description.slice(0, 28)}" D:${novo.accountDebit || '—'} C:${novo.accountCredit || '—'}`,
            'exportação',
          );
        });
      }

      // Substitui as linhas de pastas em `out` pelas versões com regras aplicadas.
      const outAtualizado = out.map((r) => (r.id && regrasById.has(r.id) ? regrasById.get(r.id)! : r));
      addDebugLog(`  total export: ${outAtualizado.length} lançamentos`, 'exportação');
      return outAtualizado.sort((a, b) => (toIsoDate(a.date) || a.date).localeCompare(toIsoDate(b.date) || b.date));
    }

    addDebugLog(`  total export: ${out.length} lançamentos (sem pastas adicionais)`, 'exportação');
    return out.sort((a, b) => (toIsoDate(a.date) || a.date).localeCompare(toIsoDate(b.date) || b.date));
  };

  /**
   * "TUDO" = todos os bancos, não só a conta banco aberta na tela.
   *
   * Retorna um grupo por conta banco: o banco ativo (extrato aberto + pastas
   * salvas dele) e cada outro banco que tenha pastas salvas na empresa. Os
   * grupos ficam separados de propósito — a partida dobrada do TXT+ e o
   * lançamento no razão usam a conta banco do grupo, então misturar bancos num
   * único universo jogaria lançamento no banco errado.
   */
  const coletarGruposTodosOsBancos = (
    bancoAtivo: string,
  ): Array<{ banco: string; rows: BankStatement[] }> => {
    const grupos: Array<{ banco: string; rows: BankStatement[] }> = [];
    const vistos = new Set<string>();
    const chave = (b: string) => b.replace(/\D/g, '') || b.trim();

    const ativo = bancoAtivo.trim();
    grupos.push({ banco: ativo, rows: coletarLancamentosExtratoParaExport(ativo) });
    if (ativo) vistos.add(chave(ativo));

    let outros: string[] = [];
    try {
      outros = groupExtratoPastasPorBanco(listExtratoPastas(selectedCompany))
        .map((g) => g.contaBanco)
        .filter((b) => b && b.trim());
    } catch {
      outros = [];
    }
    for (const banco of outros) {
      if (vistos.has(chave(banco))) continue;
      vistos.add(chave(banco));
      const rows = coletarLancamentosExtratoParaExport(banco, { incluirExtratoAberto: false });
      if (rows.length > 0) grupos.push({ banco, rows });
    }
    addDebugLog(
      `── TUDO: ${grupos.length} banco(s) — ${grupos
        .map((g) => `${g.banco || '(sem conta)'}:${g.rows.length}`)
        .join(', ')}`,
      'exportação',
    );
    return grupos;
  };

  // Exportação TXT+ partida dobrada Domínio (mesmo formato da interface antiga)
  const handleExportTxt = (periodoExtrato?: BalancetePeriodo) => {
    try {
      let content = '';
      let filename = 'dominio_txtplus.txt';

      if (activeSubTab === 'extrato') {
        const banco = getExtratoBancoConta(selectedCompany) || contaBancoExtratoAtivo;
        // Sem período = "EXPORTAR TUDO": tudo mesmo, de TODOS os bancos da
        // empresa. Com período, só o banco aberto na tela.
        const grupos = periodoExtrato
          ? [{ banco, rows: coletarLancamentosExtratoParaExport(banco) }]
          : coletarGruposTodosOsBancos(banco);
        const universo = grupos.flatMap((g) => g.rows);
        if (universo.length === 0) {
          alert('Nenhum lançamento de extrato para exportar.');
          return;
        }
        const semDataLegivel = universo.filter((e) => !toIsoDate(e.date)).length;
        const lancamentosFiltrados = periodoExtrato
          ? universo.filter((e) => {
              const iso = toIsoDate(e.date);
              if (!iso) return false;
              return iso >= periodoExtrato.dataInicio && iso <= periodoExtrato.dataFim;
            })
          : universo;
        if (periodoExtrato && lancamentosFiltrados.length === 0) {
          alert(
            `Nenhum lançamento do extrato no período selecionado.\n` +
              `Foram considerados ${universo.length} lançamento(s) do banco ${banco || '(sem conta)'} ` +
              `(extrato aberto + pastas salvas).` +
              (semDataLegivel > 0
                ? `\n${semDataLegivel} lançamento(s) estão com data em formato não reconhecido e ficaram de fora do filtro.`
                : ''),
          );
          return;
        }
        // Sem período informado, as linhas com data ilegível/implausível não
        // entram no TXT (antes iam com data fabricada e o Domínio recusava a
        // importação). Avisa quais são, para o usuário corrigir a data.
        const semDataNoArquivo = lancamentosFiltrados.filter((e) => !toIsoDate(e.date));
        if (semDataNoArquivo.length > 0) {
          const amostra = semDataNoArquivo
            .slice(0, 10)
            .map((e) => `• "${e.date}" · ${e.description.slice(0, 40)}`)
            .join('\n');
          alert(
            `ATENÇÃO: ${semDataNoArquivo.length} lançamento(s) ficaram FORA do TXT porque a data ` +
              `não é reconhecida ou está fora de uma faixa plausível de anos. Corrija a data na ` +
              `conciliação e exporte de novo:\n\n${amostra}` +
              (semDataNoArquivo.length > 10 ? `\n… e mais ${semDataNoArquivo.length - 10}.` : ''),
          );
        }
        // Um bloco por banco: a partida dobrada precisa da conta banco do
        // próprio grupo, senão o lançamento de um banco sai no outro.
        const dentroDoPeriodo = new Set(lancamentosFiltrados);
        content = grupos
          .map((g) =>
            buildTxtPlusFromExtratoRows(
              g.rows
                .filter((e) => dentroDoPeriodo.has(e))
                .map((e) => ({
                  date: e.date,
                  description: e.description,
                  value: e.value,
                  nature: e.nature,
                  accountDebit: e.accountDebit,
                  accountCredit: e.accountCredit,
                  accountCode: e.accountCode,
                  operationName: e.operationName || e.description,
                })),
              g.banco,
            ),
          )
          .filter((bloco) => bloco.trim())
          .join(String.fromCharCode(13, 10));
        const bancoNomeExport = (
          grupos.length > 1
            ? 'TODOS_OS_BANCOS'
            : getExtratoBancoNome(selectedCompany) || banco || 'banco'
        )
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '');
        // Faixa REAL coberta pelo arquivo: mês/ano do primeiro lançamento até o
        // do último. A versão anterior pegava a data do meio e mostrava um mês
        // só — num "exportar tudo" com o ano inteiro o nome mentia o conteúdo.
        const datasLancamentos = lancamentosFiltrados
          .map((e) => toIsoDate(e.date))
          .filter(Boolean)
          .sort();
        let mesAnoSuffix = '';
        if (datasLancamentos.length > 0) {
          const mesAno = (iso: string) => `${iso.slice(5, 7)}_${iso.slice(0, 4)}`;
          const inicio = mesAno(datasLancamentos[0]);
          const fim = mesAno(datasLancamentos[datasLancamentos.length - 1]);
          mesAnoSuffix = inicio === fim ? `_${inicio}` : `_${inicio}_a_${fim}`;
        }
        filename = `conciliacao_extrato_${bancoNomeExport}${mesAnoSuffix}_dominio_txtplus.txt`;
        if (!content.trim()) {
          alert(
            'Nenhuma linha válida para o TXT Domínio. Conciliie débito e crédito (contas diferentes) e tente de novo.',
          );
          return;
        }
      } else if (activeSubTab === 'razao') {
        const exported = prepareBalanceteTxtExport(
          razaoRowsSemContasPendentes,
          balancetePeriodoConfirmado,
          selectedCompany,
        );
        content = exported.content;
        filename = exported.filename;
        if (exported.naoExportados.length > 0) {
          const linhas = exported.naoExportados
            .slice(0, 15)
            .map(
              (n) =>
                `• ${n.data} · conta ${n.conta} · R$ ${n.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} · ${n.historico}`,
            )
            .join('\n');
          const resto =
            exported.naoExportados.length > 15
              ? `\n… e mais ${exported.naoExportados.length - 15} lançamento(s).`
              : '';
          alert(
            `ATENÇÃO: ${exported.naoExportados.length} lançamento(s) do razão NÃO entraram no TXT ` +
              `porque não foi possível achar a contraparte (débito/crédito) deles no período — ` +
              `provavelmente a outra ponta caiu fora do período De/Até ou o lançamento está com uma ` +
              `conta zerada/inválida. Confira no razão:\n\n${linhas}${resto}\n\n` +
              `O arquivo será baixado mesmo assim, só sem essas linhas.`,
          );
        }
      } else if (activeSubTab === 'folha') {
        content = buildTxtPlusFromFolhaRelatorio(folhaRelatorio);
        filename = 'folha_dominio_txtplus.txt';
      } else if (activeSubTab === 'plano') {
        if (planoContas.length === 0) {
          alert('Nenhuma conta no plano para exportar. Importe ou cadastre contas primeiro.');
          return;
        }
        content = buildDominioPlanoTxtFromAccounts(planoContas);
        filename = 'PLANO DE CONTAS.txt';
      } else if (activeSubTab === 'custos') {
        const custos = loadCustos(selectedCompany);
        if (custos.length === 0) {
          alert('Nenhum custo registrado para exportar.');
          return;
        }
        const exportedCustos = buildTxtPlusFromCustos(custos, extratoPlanoOptions);
        content = exportedCustos.content;
        filename = 'custos_dominio_txtplus.txt';
        if (!content.trim()) {
          alert(
            'Nenhuma linha válida para o TXT Domínio. Verifique se todos os lançamentos têm contas de Débito e Crédito preenchidas e cadastradas no plano de contas.',
          );
          return;
        }
        if (exportedCustos.naoExportados.length > 0) {
          const linhas = exportedCustos.naoExportados
            .slice(0, 15)
            .map((n) => `• ${n.mes} · ${n.descricao} · ${n.motivo}`)
            .join('\n');
          const resto =
            exportedCustos.naoExportados.length > 15
              ? `\n… e mais ${exportedCustos.naoExportados.length - 15} lançamento(s).`
              : '';
          alert(
            `ATENÇÃO: ${exportedCustos.naoExportados.length} lançamento(s) de custo NÃO entraram no TXT:\n\n${linhas}${resto}\n\n` +
              `Edite esses lançamentos na aba Custos e selecione novamente a conta Débito/Crédito.\n\n` +
              `O arquivo será baixado mesmo assim, só sem essas linhas.`,
          );
        }
      } else if (activeSubTab === 'aplicacoes') {
        const contasAplic = loadAplicacaoContasExtrato(selectedCompany);
        const regrasAplic = loadAplicacaoRegrasContas(selectedCompany);
        const exportRows: ExtratoExportRow[] = [];
        const semContrapartida: { conta: string; data: string; historico: string; valor: number; motivo: string }[] = [];
        // O TXT do Domínio só aceita código reduzido numérico. Uma aplicação sem
        // conta contábil cai no próprio nome, que o exportador descartaria em
        // silêncio — aqui a linha é barrada antes, com o motivo à vista.
        const codigoValido = (c: string) => /\d/.test(c) && !/[^\d\s.-]/.test(c);

        for (const conta of contasAplic) {
          const regrasDaConta = filterAplicacaoRegrasPorConta(regrasAplic, conta.nome);
          for (const row of conta.rows) {
            const lanc = buildAplicacaoLancamentoContabil(row, conta, regrasDaConta);
            // Provisão bloqueada não é movimento do mês: fica fora do arquivo e
            // nem é listada como pendência — a decisão de não lançar já foi
            // tomada na tela.
            if (!lanc.contabiliza) continue;
            // O TXT do Domínio exige as duas pontas. Sem regra de conciliação só
            // existe o lado da aplicação, então a linha não tem como ser gerada.
            const motivo = !lanc.debito || !lanc.credito
              ? 'sem contrapartida (falta regra de conciliação)'
              : !codigoValido(lanc.debito) || !codigoValido(lanc.credito)
                ? 'conta sem código reduzido — informe a conta contábil da aplicação'
                : '';
            if (motivo) {
              semContrapartida.push({
                conta: conta.nome,
                data: lanc.data,
                historico: lanc.historico,
                valor: lanc.valor,
                motivo,
              });
              continue;
            }
            exportRows.push({
              date: lanc.data,
              description: lanc.historico,
              value: lanc.valor,
              nature: lanc.nature,
              accountDebit: lanc.debito,
              accountCredit: lanc.credito,
              operationName: lanc.historico,
            });
          }
        }

        if (exportRows.length === 0) {
          const motivos = [...new Set(semContrapartida.map((n) => n.motivo))].join(' · ');
          alert(
            contasAplic.length === 0
              ? 'Nenhuma aplicação com lançamentos para exportar. Extraia um extrato em "Extração de Dados".'
              : `Nenhum lançamento de aplicação pôde ser exportado (${semContrapartida.length}). ` +
                `Motivo: ${motivos || 'lançamentos sem valor'}.`,
          );
          return;
        }

        content = buildTxtPlusFromExtratoRows(exportRows);
        filename = 'aplicacoes_dominio_txtplus.txt';

        if (semContrapartida.length > 0) {
          const linhas = semContrapartida
            .slice(0, 15)
            .map(
              (n) =>
                `• ${n.conta} · ${n.data} · R$ ${n.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} · ${n.historico} — ${n.motivo}`,
            )
            .join('\n');
          const resto =
            semContrapartida.length > 15 ? `\n… e mais ${semContrapartida.length - 15} lançamento(s).` : '';
          alert(
            `ATENÇÃO: ${semContrapartida.length} lançamento(s) de aplicação NÃO entraram no TXT:\n\n${linhas}${resto}\n\n` +
              `O arquivo será baixado mesmo assim, só sem essas linhas.`,
          );
        }
      } else {
        alert('Exportação disponível nas abas Extrato, Aplicações, Plano de Contas, Razão/Balancete, Folha e Custos.');
        return;
      }

      downloadTxtPlusDominio(content, filename);
      // Log detalhado: mostra as primeiras linhas do universo de export com D/C
      if (activeSubTab === 'extrato') {
        const banco = getExtratoBancoConta(selectedCompany) || contaBancoExtratoAtivo;
        const universoLog = coletarLancamentosExtratoParaExport(banco);
        const linhasLog = universoLog.slice(0, 15);
        addDebugLog(`── EXPORTAR TXT+ arquivo="${filename}" (${universoLog.length} lanç.)`, 'exportação');
        linhasLog.forEach(r => addDebugLog(
          `  ${r.date} | ${r.description.slice(0, 28)} | D:${r.accountDebit || '—'} C:${r.accountCredit || '—'} [${r.nature}]`,
          'exportação',
        ));
        if (universoLog.length > 15) addDebugLog(`  … +${universoLog.length - 15} linhas`, 'exportação');
      } else {
        addDebugLog(`── EXPORTAR TXT+ aba=${activeSubTab} arquivo="${filename}"`, 'exportação');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao gerar TXT+ Domínio.';
      alert(msg);
    }
  };

  return (
    <div className="h-full flex min-h-0">
      <aside className="w-[220px] shrink-0 border-r border-brand-border bg-brand-sidebar flex flex-col overflow-y-auto">
        <div className="px-4 py-3 border-b border-brand-border space-y-3">
          <p className="text-[9px] font-black uppercase tracking-widest opacity-50">Gerencial</p>
          <ActiveCompanySelector
            compact
            selectedCompany={selectedCompany}
            companyOptions={companyOptions}
            onCompanyChange={onCompanyChange}
            onCreateCompany={onCreateCompany}
            onRenameCompany={onRenameCompany}
            onDeleteCompany={onDeleteCompany}
            deleteConfirmMessage={(company) =>
              `Excluir «${company}»?\n\nRemove plano, razão, extrato, folha, empréstimos, parcelamentos e aplicações desta empresa. Não afeta sindicatos da Precificação.`
            }
          />
        </div>
        <nav className="flex-1 py-2" aria-label="Módulos gerenciais">
          {tabs.map((tab) => {
            const locked = !STANDALONE_MANAGER_TABS.has(tab.id) && !hasPlano;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                disabled={locked}
                onClick={() => {
                  if (locked) return;
                  setActiveSubTab(tab.id);
                }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest transition-all border-l-2',
                  activeSubTab === tab.id
                    ? 'bg-brand-bg border-l-brand-border text-brand-text'
                    : 'border-l-transparent opacity-45 hover:opacity-100 hover:bg-brand-border/5',
                  locked && 'opacity-30 cursor-not-allowed hover:opacity-30',
                )}
              >
                {locked ? (
                  <Lock size={12} className="shrink-0 opacity-60 text-red-600" />
                ) : (
                  <Icon size={12} className="shrink-0" />
                )}
                <span className="leading-tight">{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="flex-1 min-h-0 overflow-y-auto relative">
        <div className={cn('mx-auto space-y-6 min-w-0', isEmbeddedSimulator ? 'p-4 md:p-6 max-w-[96rem]' : 'p-8 max-w-7xl')}>
          {!isEmbeddedSimulator ? (
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-xl font-black text-brand-text uppercase italic tracking-tighter">
                  {managerSubTabLabel(activeSubTab)}
                </h2>
                <p className="text-[9px] font-mono font-bold opacity-50 uppercase tracking-[0.2em] mt-1">
                  Status: Processamento Integrado
                </p>
              </div>

              <div className="flex gap-2">
                {activeSubTab === 'razao' && (
                  <button
                    type="button"
                    onClick={() => setShowImportLancamentosModal(true)}
                    className="technical-button flex items-center gap-2 text-xs font-bold"
                  >
                    <Upload size={14} />
                    IMPORTAR LANÇAMENTOS
                  </button>
                )}
                {activeSubTab !== 'indiceLiquidez' && (
                  <button
                    type="button"
                    onClick={() => {
                      if (activeSubTab === 'extrato') {
                        setPeriodoModalExportExtratoOpen(true);
                        return;
                      }
                      handleExportTxt();
                    }}
                    className="technical-button-primary flex items-center gap-2 text-xs font-bold shadow-[2px_2px_0_0_rgba(0,0,0,0.1)]"
                  >
                    <Download size={14} />
                    {activeSubTab === 'plano' ? 'EXPORTAR PLANO DOMÍNIO' : 'EXPORTAR TXT+ DOMÍNIO'}
                  </button>
                )}
              </div>
            </div>
          ) : null}

          {isEmbeddedSimulator ? (
            <Suspense fallback={<TabLoadingFallback />}>
              <LoanModule
                selectedCompany={selectedCompany}
                storageVersion={storageVersion}
                embedded
                planoContaOptions={extratoPlanoOptions}
              />
            </Suspense>
          ) : tabRequiresPlano && !hasPlano ? (
            <div className="technical-panel p-20 shadow-[8px_8px_0_0_#141414] text-center flex flex-col items-center justify-center space-y-8 bg-brand-sidebar/10">
              <div className="w-20 h-20 border-2 border-brand-border flex items-center justify-center font-black text-3xl italic text-red-600 animate-pulse">
                <Lock size={32} />
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-red-700">Módulo Bloqueado</h3>
                <p className="text-[10px] font-bold text-slate-500 uppercase max-w-sm tracking-widest leading-relaxed">
                  O Plano de Contas central não foi detectado no sistema. Importe os registros de contas para habilitar o motor gerencial, conciliações e visualização.
                </p>
              </div>
              <div className="flex gap-4">
                <button
                  onClick={() => setActiveSubTab('plano')}
                  className="technical-button-primary"
                >
                  Ir para Plano de Contas
                </button>

              </div>
            </div>
          ) : (
            <>
              {/* ======================= EXTRATO SUBTAB ======================= */}
              {activeSubTab === 'extrato' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  <div className="lg:col-span-8 space-y-6">
                    {/* Stats - Only show if there are transactions */}
                    {extratoLancamentos.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                      <div className="technical-panel p-6 shadow-[4px_4px_0_0_#141414]">
                        <p className="text-[9px] font-black text-brand-text/40 uppercase tracking-widest mb-2 italic">
                          Total Débitos
                        </p>
                        <p className="text-2xl font-mono font-black tracking-tighter text-red-500">
                          {formatCurrency(currentTotalOutflows)}
                        </p>
                      </div>
                      <div className="technical-panel p-6 shadow-[4px_4px_0_0_#141414]">
                        <p className="text-[9px] font-black text-brand-text/40 uppercase tracking-widest mb-2 italic">
                          Total Créditos
                        </p>
                        <p className="text-2xl font-mono font-black tracking-tighter text-blue-600">
                          {formatCurrency(currentTotalInflows)}
                        </p>
                      </div>
                      <div className="technical-panel p-6 shadow-[4px_4px_0_0_#141414]">
                        <p className="text-[9px] font-black text-brand-text/40 uppercase tracking-widest mb-2 italic">
                          Saldo Anterior
                        </p>
                        <FreeNumericInput
                          aria-label="Saldo anterior do extrato"
                          value={saldoAnteriorExtrato}
                          onChange={(v) => {
                            saldoAnteriorCarregadoRef.current = true;
                            setSaldoAnteriorExtrato(v);
                            writeSaldoAnteriorExtrato(selectedCompany, v);
                            // Grava também na pasta (extrato salvo) ativa — sem isso o
                            // valor digitado se perdia ao trocar de extrato e voltar.
                            const pastaAtivaId = getExtratoPastaAtivaId(selectedCompany);
                            if (pastaAtivaId) {
                              updateExtratoPastaSaldoAnterior(selectedCompany, pastaAtivaId, v);
                            }
                          }}
                          displayDecimals={2}
                          hideZeroWhenBlurred
                          placeholder="0,00"
                          className={cn(CF_FORM_INPUT_MONEY, 'text-xl font-mono font-black w-full')}
                        />
                      </div>
                      <div className="technical-panel p-6 shadow-[4px_4px_0_0_#141414]">
                        <p className="text-[9px] font-black text-brand-text/40 uppercase tracking-widest mb-2 italic">
                          Saldo Final do Extrato
                        </p>
                        <p
                          className={cn(
                            'text-2xl font-mono font-black tracking-tighter',
                            saldoFinalExtratoInfo.valor >= 0 ? 'text-brand-text' : 'text-red-600',
                          )}
                        >
                          {formatCurrency(saldoFinalExtratoInfo.valor)}
                        </p>
                        <p className="text-[8px] font-mono text-brand-text/45 mt-2 uppercase tracking-wide">
                          Anterior + Créditos − Débitos
                        </p>
                        <p className="text-[8px] font-mono text-brand-text/40 mt-1 normal-case">
                          C {formatCurrency(currentTotalInflows)} · D{' '}
                          {formatCurrency(currentTotalOutflows)}
                          {placarTotais.lancamentosConsiderados > 0
                            ? ` · ${placarTotais.lancamentosConsiderados} lanç.`
                            : ''}
                        </p>
                      </div>
                      {extratoLancamentos.length > 0 && (
                        <div className="technical-panel p-6 shadow-[4px_4px_0_0_#141414] sm:col-span-2 xl:col-span-2">
                          <p className="text-[9px] font-black text-brand-text/40 uppercase tracking-widest mb-2 italic">
                            Saldo Conciliado
                          </p>
                          <p
                            className={cn(
                              'text-2xl font-mono font-black tracking-tighter',
                              saldoConciliadoAteMomento >= 0 ? 'text-brand-text' : 'text-red-600',
                            )}
                          >
                            {formatCurrency(saldoConciliadoAteMomento)}
                          </p>
                          <p className="text-[8px] font-mono text-brand-text/45 mt-2 uppercase tracking-wide">
                            {placarConciliados.lancamentosConsiderados === 0
                              ? 'Sem lançamentos com débito e crédito'
                              : 'Anterior + créditos conciliados − débitos conciliados'}
                          </p>
                        <p className="text-[9px] mt-2 text-brand-text/60 normal-case">
                          {extratoConciliacaoStats.conciliadas} de {extratoConciliacaoStats.total} lançamento(s)
                          conciliado(s)
                          {placarConciliados.lancamentosConsiderados > 0 ? (
                            <span className="block mt-0.5 font-mono text-[8px] uppercase opacity-70">
                              C {formatCurrency(placarConciliados.creditos)} · D{' '}
                              {formatCurrency(placarConciliados.debitos)}
                            </span>
                          ) : (
                            <span className="block mt-0.5 text-amber-800/90">
                              Preencha débito e crédito nas linhas para este saldo avançar.
                            </span>
                          )}
                        </p>
                        <p className="text-[8px] mt-2 leading-snug text-amber-800/80 normal-case border-t border-brand-border/40 pt-2">
                          Use <strong>Mandar para o balancete</strong> para publicar os conciliados no
                          balancete/razão. Este card só soma o que já tem as duas contas — não copia o
                          saldo final.
                        </p>
                        </div>
                      )}
                    </div>
                    )}

                    {/* Ribbon controller */}
                    <div className="flex gap-2 justify-between">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setShowAddExtrato(!showAddExtrato)}
                          className="technical-button-primary text-xs font-bold"
                        >
                          + INSERIR REGISTRO EXTRATO
                        </button>
                      </div>
                      {extratoLancamentos.length > 0 && (
                        <button
                          type="button"
                          onClick={() => void handleLimparExtratos()}
                          className="technical-button border-red-800 text-red-800 hover:bg-red-800 hover:text-white text-xs"
                        >
                          LIMPAR EXTRATOS
                        </button>
                      )}
                    </div>

                    {/* Add register form */}
                    {showAddExtrato && (
                      <form onSubmit={handleAddExtratoSubmit} className="technical-panel p-6 bg-brand-sidebar/10 max-w-2xl">
                        <h4 className="text-[10px] font-black uppercase tracking-widest border-b border-brand-border pb-1 mb-3 w-full">Inserir Lançamento de Extrato</h4>
                        <div className={CF_FORM_FIELDS}>
                          <div className={CF_FIELD_COL}>
                            <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">Data</label>
                            <input aria-label="Data"
                              type="date"
                              required
                              value={extDate}
                              onChange={e => setExtDate(e.target.value)}
                              className={CF_FORM_INPUT_DATE}
                            />
                          </div>
                          <div className={CF_FIELD_COL_GROW}>
                            <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">Descrição</label>
                            <input aria-label="Descrição"
                              type="text"
                              required
                              placeholder="LIQ FATURA..."
                              value={extDesc}
                              onChange={e => setExtDesc(e.target.value)}
                              className={CF_FORM_INPUT_LONG}
                            />
                          </div>
                          <div className={CF_FIELD_COL}>
                            <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">Valor (R$)</label>
                            <FreeNumericInput aria-label="Valor (R$)"
                              required
                              value={extVal}
                              onChange={setExtVal}
                              className={CF_FORM_INPUT_MONEY}
                            />
                          </div>
                          <div className={CF_FIELD_COL}>
                            <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">Natureza</label>
                            <div className="flex border border-brand-border h-[26px]">
                              <button
                                type="button"
                                onClick={() => setExtNat('D')}
                                className={cn("flex-1 text-[9px] font-bold", extNat === 'D' ? "bg-red-600 text-white" : "bg-transparent")}
                              >
                                DEBITO (D)
                              </button>
                              <button
                                type="button"
                                onClick={() => setExtNat('C')}
                                className={cn("flex-1 text-[9px] font-bold", extNat === 'C' ? "bg-blue-600 text-white" : "bg-transparent")}
                              >
                                CREDITO (C)
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="flex gap-2 justify-end pt-2 w-full basis-full">
                          <button type="button" onClick={() => setShowAddExtrato(false)} className="technical-button text-[10px] py-1 px-3">CANCELAR</button>
                          <button type="submit" className="technical-button-primary text-[10px] py-1 px-4">ADICIONAR</button>
                        </div>
                      </form>
                    )}

                    {/* Table */}
                    <div className="technical-panel shadow-[4px_4px_0_0_#141414] overflow-hidden">
                      <div className="p-3 border-b border-brand-border flex flex-wrap items-center justify-between gap-2 bg-brand-sidebar/30">
                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className="text-[10px] font-black uppercase tracking-widest">Registros de Conciliação Bancária</h3>
                          {extratoLancamentos.length > 0 && (
                            <div className="px-2 py-0.5 bg-brand-border text-brand-bg text-[8px] font-black uppercase tracking-tighter">
                              Sincronizado ({extratoConciliacaoStats.total} itens · {extratoConciliacaoStats.conciliadas} conciliadas)
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <AcoesCommandMenu itens={acoesConciliacao} label="Ações da conciliação" />
                        </div>
                      </div>
                      {extratoLancamentos.length > 0 && (
                        <div className="px-3 py-2 border-b border-brand-border/60 bg-brand-sidebar/10 flex flex-wrap items-center gap-2">
                          <span className="text-[8px] font-black uppercase tracking-widest text-brand-text/45 inline-flex items-center gap-1">
                            <Filter size={10} aria-hidden="true" />
                            Filtrar
                          </span>
                          {(
                            [
                              ['todas', `Todas (${extratoConciliacaoStats.total})`],
                              ['conciliadas', `Conciliadas (${extratoConciliacaoStats.conciliadas})`],
                              ['pendentes', `Não conciliadas (${extratoConciliacaoStats.pendentes})`],
                            ] as const
                          ).map(([id, label]) => (
                            <button
                              key={id}
                              type="button"
                              onClick={() => setExtratoConciliacaoFiltro(id)}
                              className={cn(
                                'technical-button text-[8px] py-0.5 px-2 font-bold uppercase tracking-wide',
                                extratoConciliacaoFiltro === id && 'bg-brand-border text-brand-bg',
                              )}
                            >
                              {label}
                            </button>
                          ))}
                          <div className="relative ml-auto w-full sm:w-64">
                            <Search
                              size={11}
                              aria-hidden="true"
                              className="absolute left-2 top-1/2 -translate-y-1/2 opacity-40"
                            />
                            <input
                              type="text"
                              value={extratoBusca}
                              onChange={(e) => setExtratoBusca(e.target.value)}
                              placeholder="Buscar por histórico, valor ou código conta…"
                              aria-label="Buscar lançamentos por histórico, valor ou código conta"
                              className="w-full pl-6 pr-6 py-1 bg-brand-bg border border-brand-border/60 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-brand-border"
                            />
                            {extratoBusca && (
                              <button
                                type="button"
                                onClick={() => setExtratoBusca('')}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100"
                                aria-label="Limpar busca"
                                title="Limpar busca"
                              >
                                <X size={11} aria-hidden="true" />
                              </button>
                            )}
                          </div>
                          {extratoBuscaNorm && (
                            <span className="text-[8px] font-bold uppercase tracking-wide opacity-50 w-full sm:w-auto">
                              {extratoLancamentosFiltrados.length} resultado(s)
                            </span>
                          )}
                        </div>
                      )}
                      <ExtratoLancamentosVirtualTable
                        rows={extratoLancamentosFiltrados}
                        onDelete={deleteExtrato}
                        planoNomeOptions={extratoPlanoNomeOptions}
                      />
                    </div>

                  </div>
                  <div className="lg:col-span-4 space-y-6">
                    <DataIngestionBox
                      dataType="extrato"
                      title="Processar Extrato Externo"
                      selectedCompany={selectedCompany}
                      extratoPlanoOptions={extratoBancoPlanoOptions.length > 0 ? extratoBancoPlanoOptions : extratoPlanoOptions}
                      onLog={addDebugLog}
                      onExtratoConciliacao={handleExtratoConciliacao}
                      onImport={(newItems, saldoAnterior) => {
                        const companyScope = selectedCompany;
                        setContaBancoTick((n) => n + 1);
                        // Invalida qualquer resolução assíncrona pendente de uma
                        // importação/seleção anterior antes de iniciar esta.
                        extratoAsyncVersionRef.current += 1;
                        const asyncVersion = extratoAsyncVersionRef.current;
                        const resolverOpts = {
                          ...extratoResolverOptions,
                          contaBancoPreferida: getExtratoBancoConta(companyScope),
                          regrasContas: loadExtratoRegrasContas(
                            companyScope,
                            getExtratoBancoConta(companyScope),
                          ),
                          // Arquivos que já trazem as contas (TXT+ Domínio, OFX
                          // conciliado) entram como estão; o resolver só palpita
                          // no que veio em branco.
                          preservarContasExistentes: true,
                        };
                        // Nunca deixa linhas de "saldo anterior/do dia/etc." virarem lançamento —
                        // são só referência de conferência, jamais conciliação.
                        const { rows: itemsSemSaldo, saldoAnteriorSugerido } = extrairESepararSaldoAnterior(
                          newItems as BankStatement[],
                        );
                        // Mostra o extrato imediatamente; resolve contas em lotes sem travar.
                        const raw = syncExtratoConciliacaoStatus(itemsSemSaldo);
                        addDebugLog(`── IMPORTAR extrato ${raw.length} linha(s) banco=${getExtratoBancoConta(companyScope) || '(sem conta)'}`, 'importação');
                        startTransition(() => setExtratoLancamentos(raw));
                        writeManagerData(companyScope, 'extrato', raw);
                        // O extrato importado ainda não é uma pasta salva: desfaz o
                        // vínculo com a pasta anterior para o saldo digitado agora não
                        // sobrescrever o saldo do extrato que estava selecionado.
                        clearExtratoPastaAtivaId(companyScope);
                        // Saldo anterior é sempre do extrato atual: usa o informado
                        // (conversor/OFX) ou o detectado no arquivo e, na falta dos dois,
                        // zera — nunca herda o valor do extrato importado antes.
                        const saldoAnteriorFinal = saldoAnterior ?? saldoAnteriorSugerido;
                        const saldoAnteriorAplicado =
                          saldoAnteriorFinal != null && Number.isFinite(saldoAnteriorFinal)
                            ? saldoAnteriorFinal
                            : 0;
                        saldoAnteriorCarregadoRef.current = true;
                        setSaldoAnteriorExtrato(saldoAnteriorAplicado);
                        saldoAnteriorExtratoRef.current = saldoAnteriorAplicado;
                        writeSaldoAnteriorExtrato(companyScope, saldoAnteriorAplicado);
                        void applyExtratoContaResolverAsync(
                          raw,
                          planoParaResolver,
                          extratoContaCache,
                          resolverOpts,
                        ).then(({ rows: resolved, cache: nextCache, pendingSemNota }) => {
                          if (isExtratoAsyncResultStale(companyScope, asyncVersion)) {
                            return;
                          }
                          if (!isSameCompanyScope(companyScope, selectedCompany)) {
                            writeManagerData(
                              companyScope,
                              'extrato',
                              syncExtratoConciliacaoStatus(resolved),
                            );
                            saveExtratoContaMappingCache(companyScope, nextCache);
                            return;
                          }
                          startTransition(() => {
                            setExtratoContaCache(nextCache);
                            saveExtratoContaMappingCache(companyScope, nextCache);
                            const next = syncExtratoConciliacaoStatus(resolved);
                            setExtratoLancamentos(next);
                            writeManagerData(companyScope, 'extrato', next);
                            notifyPendingSemNota(pendingSemNota);
                          });
                          void flushPersistenceAfterCriticalWrite();
                        });
                      }}
                    />
                  </div>
                </div>
              )}



              {/* ======================= PLANO DE CONTAS SUBTAB ======================= */}
              {activeSubTab === 'plano' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  <div className="lg:col-span-8 space-y-6">
                    <div className="flex gap-2 justify-between flex-wrap">
                      <div className="flex gap-2">
                        <button
                          onClick={() => setShowAddPlano(!showAddPlano)}
                          className="technical-button-primary text-xs"
                        >
                          + CRIAR CONTA CONTÁBIL
                        </button>
                        {contasParaRenomear.length > 0 && (
                          <button
                            onClick={() => setShowRenomearPlano(true)}
                            className="technical-button border-amber-700 text-amber-800 hover:bg-amber-700 hover:text-white text-xs"
                          >
                            CONTAS A SEREM RENOMEADAS ({contasParaRenomear.length})
                          </button>
                        )}
                      </div>
                      {planoContas.length > 0 && (
                        <button
                          type="button"
                          onClick={() => void handleLimparPlano()}
                          className="technical-button border-red-800 text-red-800 hover:bg-red-800 hover:text-white text-xs"
                        >
                          LIMPAR PLANO
                        </button>
                      )}
                    </div>

                    {showRenomearPlano && (
                      <div className="technical-panel p-4 bg-amber-50/30 border-amber-600/50 space-y-3 max-w-4xl">
                        <div className="flex items-center justify-between">
                          <h4 className="text-[10px] font-black uppercase tracking-widest">
                            Contas a serem renomeadas ({contasParaRenomear.length})
                          </h4>
                          <button
                            type="button"
                            onClick={() => setShowRenomearPlano(false)}
                            className="text-[9px] font-bold uppercase opacity-60 hover:opacity-100"
                          >
                            Fechar
                          </button>
                        </div>
                        <p className="text-[9px] opacity-60">
                          Essas contas foram criadas automaticamente a partir de lançamentos do razão sem conta
                          correspondente no plano. Informe o nome e a classificação (ou escolha o grupo para o
                          sistema gerar a próxima classificação da sequência).
                        </p>
                        <div className="divide-y divide-brand-border/30 border border-brand-border">
                          {contasParaRenomear.map((a) => (
                            <ContaPendenteRenomearRow
                              key={a.code}
                              conta={a}
                              planoContas={planoContas}
                              onConfirm={handleConfirmarContaPendente}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {showAddPlano && (
                      <form onSubmit={handleAddPlanoSubmit} className="technical-panel p-6 bg-brand-sidebar/10 space-y-4 max-w-3xl">
                        <h4 className="text-[10px] font-black uppercase tracking-widest border-b border-brand-border pb-1">Configurar Conta</h4>
                        <div className={CF_FIELD_ROW}>
                          <div className={CF_FIELD_COL}>
                            <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">Código Reduzido</label>
                            <input aria-label="Código Reduzido"
                              type="text"
                              placeholder="0000001"
                              value={accReduzido}
                              onChange={(e) => setAccReduzido(e.target.value)}
                              className={CF_FORM_INPUT_SHORT}
                            />
                          </div>
                          <div className={CF_FIELD_COL}>
                            <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">Classificação</label>
                            <input aria-label="Classificação"
                              type="text"
                              required
                              placeholder="1.1.1.01.00001"
                              value={accCode}
                              onChange={(e) => setAccCode(e.target.value)}
                              className={CF_INPUT_ACCOUNT}
                            />
                          </div>
                          <div className={CF_FIELD_COL}>
                            <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">Descrição</label>
                            <input aria-label="Descrição"
                              type="text"
                              required
                              placeholder="CAIXA GERAL"
                              value={accName}
                              onChange={(e) => setAccName(e.target.value)}
                              className={CF_FORM_INPUT_MED}
                            />
                          </div>
                          <div className={CF_FIELD_COL}>
                            <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">Tipo</label>
                            <select aria-label="Tipo"
                              value={accTipo}
                              onChange={(e) => setAccTipo(e.target.value as 'S' | 'A' | '')}
                              className={CF_FORM_SELECT}
                            >
                              <option value="">AUTO</option>
                              <option value="S">S — Sintética</option>
                              <option value="A">A — Analítica</option>
                            </select>
                          </div>
                          <div className={CF_FIELD_COL}>
                            <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">Nível</label>
                            <input aria-label="Nível"
                              type="text"
                              inputMode="numeric"
                              placeholder="Auto"
                              value={accNivel}
                              onChange={(e) => setAccNivel(e.target.value)}
                              className={CF_FORM_INPUT_NUM}
                            />
                          </div>
                        </div>

                        <div className="flex gap-2 justify-end pt-2">
                          <button type="button" onClick={() => setShowAddPlano(false)} className="technical-button text-[10px] py-1 px-3">CANCELAR</button>
                          <button type="submit" className="technical-button-primary text-[10px] py-1 px-4">SALVAR CONTA</button>
                        </div>
                      </form>
                    )}

                    {planoContas.length > 0 && (
                      <div className="flex flex-wrap gap-3">
                        <div className="flex items-center gap-2 px-3 py-1.5 border border-brand-border bg-brand-sidebar/30">
                          <span className="text-sm font-black">{planoContas.length.toLocaleString('pt-BR')}</span>
                          <span className="text-[9px] font-bold uppercase opacity-50">contas totais</span>
                        </div>
                        {planoTotalSinteticas > 0 && (
                          <div className="flex items-center gap-2 px-3 py-1.5 border border-amber-700/40 bg-amber-50">
                            <span className="text-[9px] font-black text-amber-800 bg-amber-200 px-1.5 py-0.5">S</span>
                            <span className="text-[10px] font-bold text-amber-900">{planoTotalSinteticas} Sintéticas</span>
                          </div>
                        )}
                        {planoTotalAnaliticas > 0 && (
                          <div className="flex items-center gap-2 px-3 py-1.5 border border-emerald-700/40 bg-emerald-50">
                            <span className="text-[9px] font-black text-emerald-800 bg-emerald-200 px-1.5 py-0.5">A</span>
                            <span className="text-[10px] font-bold text-emerald-900">{planoTotalAnaliticas} Analíticas</span>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="technical-panel shadow-[4px_4px_0_0_#141414] overflow-hidden">
                      <div className="p-3 border-b border-brand-border flex items-center justify-between bg-brand-sidebar/30 gap-4">
                        <div className="flex items-center gap-4 min-w-0">
                          <h3 className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap">
                            Plano de Contas
                          </h3>
                          {planoContas.length > 0 && (
                            <div className="px-2 py-0.5 bg-brand-border text-brand-bg text-[8px] font-black uppercase tracking-tighter whitespace-nowrap">
                              {planoContas.length.toLocaleString('pt-BR')} conta(s)
                            </div>
                          )}
                        </div>
                        <p className="text-[8px] font-bold uppercase tracking-wide text-slate-500 hidden sm:block truncate">
                          Reduzido · Classificação · Descrição · Tipo · Nível
                        </p>
                      </div>
                      {planoContas.length > 0 && (
                        <div className="px-3 py-2 border-b border-brand-border/30 bg-brand-sidebar/10">
                          <input
                            type="text"
                            value={buscaPlano}
                            onChange={(e) => setBuscaPlano(e.target.value)}
                            placeholder="Buscar por código, classificação ou nome..."
                            className="w-full h-8 px-3 border border-brand-border bg-brand-bg text-[10px] font-mono"
                          />
                        </div>
                      )}
                      <PlanoContasVirtualTable
                        rows={planoContasFiltrado}
                        codeLengthToLevel={codeLengthToLevel}
                        onDelete={deleteAccount}
                        onEdit={editAccount}
                      />
                    </div>
                  </div>
                  <div className="lg:col-span-4 space-y-6">
                    <DataIngestionBox
                      dataType="plano"
                      title="Processar Plano de Contas"
                      selectedCompany={selectedCompany}
                      onImport={(newItems) => savePlano(newItems as AccountPlan[])}
                      onRazaoImport={(rows, fname) => saveRazao(rows, fname)}
                    />
                  </div>
                </div>
              )}

              {/* ======================= CUSTOS & FATURAMENTO SUBTAB ======================= */}
              {activeSubTab === 'custos' && (
                <Suspense fallback={<TabLoadingFallback />}>
                  <CustosModule selectedCompany={selectedCompany} planoOptions={extratoPlanoOptions} />
                </Suspense>
              )}

              {/* ======================= ÍNDICE DE LIQUIDEZ SUBTAB ======================= */}
              {activeSubTab === 'indiceLiquidez' && (
                <Suspense fallback={<TabLoadingFallback />}>
                  <IndiceLiquidezModule selectedCompany={selectedCompany} />
                </Suspense>
              )}

              {/* ======================= APLICAÇÕES SUBTAB ======================= */}
              {activeSubTab === 'aplicacoes' && (
                <Suspense fallback={<TabLoadingFallback />}>
                  <AppsModule selectedCompany={selectedCompany} />
                </Suspense>
              )}

              {/* ======================= RAZÃO / BALANCETE SUBTAB ======================= */}
              {activeSubTab === 'razao' && (
                <div className="min-w-0">
                  <BalanceteTabPanel
                    selectedCompany={selectedCompany}
                    planoContas={planoContasConfirmadas}
                    razaoRows={razaoRowsSemContasPendentes}
                    onRazaoRowsChange={saveRazao}
                    folhaRelatorio={folhaRelatorio}
                    importedTxts={importedTxts}
                    onDeleteImportedTxt={deleteImportedTxt}
                    onPeriodoConfirmadoChange={setBalancetePeriodoConfirmado}
                    importedLogs={balanceteImportLogs}
                  />
                </div>
              )}
              {showImportLancamentosModal && (
                <div
                  className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-brand-text/40"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Importar lançamentos"
                  onClick={(e) => {
                    if (e.target === e.currentTarget) setShowImportLancamentosModal(false);
                  }}
                >
                  <div
                    className="technical-panel w-full max-w-md max-h-[90vh] overflow-y-auto shadow-[6px_6px_0_0_#141414] bg-brand-bg relative"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => setShowImportLancamentosModal(false)}
                      className="absolute top-3 right-3 p-1 border border-brand-border hover:bg-brand-border hover:text-brand-bg transition-colors z-10"
                      aria-label="Fechar"
                    >
                      <X size={16} aria-hidden />
                    </button>
                    <DataIngestionBox
                      dataType="balancete"
                      title="Importar Lançamentos (TXT Domínio)"
                      selectedCompany={selectedCompany}
                      onImport={(newItems) => {
                        const first = newItems[0] as Record<string, unknown> | undefined;
                        if (first && ('code' in first || 'name' in first)) {
                          window.alert(
                            'Arquivo de plano de contas detectado. Importe na sub-aba Plano de Contas.',
                          );
                          return;
                        }
                        if (first && ('dataInicio' in first || 'descricao' in first)) {
                          saveRazao(
                            migrateLegacyBalanceteToRazao(newItems as BalanceteRow[]),
                            `Balancete legado ${new Date().toLocaleDateString('pt-BR')}`,
                          );
                        }
                      }}
                      onRazaoImport={(rows, fname) => saveRazao(rows, fname)}
                      onLogsChange={setBalanceteImportLogs}
                    />
                  </div>
                </div>
              )}

              {/* ======================= FOLHA DE PAGAMENTO SUBTAB ======================= */}
              {activeSubTab === 'folha' && (
                <div className="space-y-6">
                  {/* Sub-abas da Folha */}
                  <div className="flex gap-0 border-b border-brand-border">
                    {(['lancamentos', 'totais'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setFolhaSubTab(st)}
                        className={cn(
                          'px-4 py-2 text-[10px] font-black uppercase tracking-widest border-b-2 -mb-px transition-colors',
                          folhaSubTab === st
                            ? 'border-brand-bg bg-brand-bg text-brand-text'
                            : 'border-transparent text-brand-text/50 hover:text-brand-text',
                        )}
                      >
                        {st === 'lancamentos' ? 'Lançamentos' : 'Totais por Conta'}
                        {st === 'totais' && folhaTotaisPorConta.length > 0 && (
                          <span className="ml-1.5 text-[8px] bg-brand-border/40 px-1 py-0.5 font-mono">
                            {folhaTotaisPorConta.length}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Sub-aba: Lançamentos */}
                  {folhaSubTab === 'lancamentos' && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    <div className="lg:col-span-8 space-y-6">
                      <div className="technical-panel shadow-[4px_4px_0_0_#141414] overflow-hidden">
                        <div className="p-3 border-b border-brand-border bg-brand-sidebar/30 flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-[10px] font-black uppercase tracking-widest">Relatório folha importado (OCR)</h3>
                          <div className="flex flex-wrap items-center gap-2">
                            {/* Excluir por data */}
                            {folhaRelatorio.length > 0 && (
                              <div className="flex items-center gap-1">
                                <select
                                  value={folhaDeleteDate}
                                  onChange={(e) => setFolhaDeleteDate(e.target.value)}
                                  className="h-[26px] text-[9px] font-bold uppercase border border-brand-border bg-white px-1 font-mono"
                                  aria-label="Selecionar data para excluir"
                                >
                                  <option value="">Por data…</option>
                                  {Array.from(new Set(folhaRelatorio.map((r) => r.date)))
                                    .sort()
                                    .map((d) => (
                                      <option key={d} value={d}>{d}</option>
                                    ))}
                                </select>
                                <button
                                  type="button"
                                  disabled={!folhaDeleteDate}
                                  onClick={() => deleteFolhaRelatorioByDate(folhaDeleteDate)}
                                  className="technical-button text-[9px] px-2 py-1 flex items-center gap-1 font-bold text-red-700 disabled:opacity-40"
                                  title="Excluir lançamentos da data selecionada"
                                >
                                  <Trash2 size={11} />
                                  Excluir data
                                </button>
                                <button
                                  type="button"
                                  onClick={deleteFolhaRelatorioAll}
                                  className="technical-button text-[9px] px-2 py-1 flex items-center gap-1 font-bold text-red-700"
                                  title="Excluir todos os lançamentos da folha"
                                >
                                  <Trash2 size={11} />
                                  Excluir tudo
                                </button>
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => setShowFolhaRegrasModal(true)}
                              className="technical-button text-[10px] px-2 py-1.5 flex items-center gap-1.5 font-bold"
                              title="Configurar contas Débito/Crédito por rubrica da folha"
                            >
                              <Settings size={13} className="text-amber-600" />
                              Regras
                            </button>

                          </div>
                        </div>
                        <FolhaRelatorioVirtualTable rows={folhaRelatorio} regras={folhaRegras} onDelete={deleteFolhaRelatorio} />
                      </div>
                    </div>
                    <div className="lg:col-span-4 space-y-6">
                      {/* Importar PDF Sistema Domínio (Resumo da Folha) — direto para a tabela */}
                      <input
                        ref={folhaDominioInputRef}
                        type="file"
                        accept=".pdf"
                        className="hidden"
                        onChange={handleFolhaDominioFileChange}
                        aria-label="Upload PDF Domínio — Folha de Pagamento"
                        data-testid="ingest-folha-dominio-pdf-btn"
                      />
                      {folhaPdfMsg && (
                        <p className="text-[10px] font-bold font-mono px-1 py-1 border border-brand-border bg-brand-sidebar/20">
                          {folhaPdfMsg}
                        </p>
                      )}

                      {/* Recortar PDF da Folha — junto com "Importar PDF Domínio" */}
                      <DataIngestionBox
                        dataType="folha"
                        title="Recortar PDF da Folha"
                        selectedCompany={selectedCompany}
                        ingestionMode="pdfOnly"
                        extraTopAction={{
                          label: folhaPdfProcessando ? 'Lendo PDF…' : 'Importar PDF Domínio',
                          onClick: () => folhaDominioInputRef.current?.click(),
                          disabled: folhaPdfProcessando,
                          title: 'PDF exportado pelo Sistema Domínio (Resumo da Folha) — importa direto para a tabela',
                        }}
                        onImport={(newItems) => {
                          const prefix = folhaVariantDescriptionPrefix(folhaPdfVariant);
                          const relatorio = (newItems as FolhaRelatorioRow[])
                            .filter(
                              (i) => 'debito' in i && 'credito' in i && !('baseSalary' in i),
                            )
                            .map((row) => ({
                              ...row,
                              description: row.description?.startsWith('[')
                                ? row.description
                                : `${prefix} ${row.description || ''}`.trim(),
                            }));
                          if (relatorio.length > 0) {
                            saveFolhaRelatorio([...folhaRelatorio, ...relatorio]);
                          }
                        }}
                      />
                    </div>
                  </div>
                  )}

                {/* Sub-aba: Totais por Conta */}
                {folhaSubTab === 'totais' && (
                  <div className="technical-panel shadow-[4px_4px_0_0_#141414] overflow-hidden">
                    <div className="p-3 border-b border-brand-border bg-brand-sidebar/30 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-[10px] font-black uppercase tracking-widest">Totais por Conta — Folha</h3>
                        <p className="text-[9px] font-bold uppercase opacity-50 mt-0.5">
                          Saldo líquido por conta contábil (débito − crédito) considerando as regras configuradas
                        </p>
                      </div>
                      {/* Filtro de período */}
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <span className="text-[9px] font-black uppercase text-brand-text/50 tracking-widest">Período</span>
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={folhaTotaisDe}
                            onChange={(e) => setFolhaTotaisDe(e.target.value)}
                            placeholder="dd/mm/aaaa"
                            maxLength={10}
                            className="h-[26px] w-[96px] text-[9px] font-mono font-bold uppercase border border-brand-border bg-white px-2 tracking-wider placeholder:opacity-30"
                            aria-label="Data inicial do filtro de totais"
                          />
                          <span className="text-[9px] font-black text-brand-text/40">até</span>
                          <input
                            type="text"
                            value={folhaTotaisAte}
                            onChange={(e) => setFolhaTotaisAte(e.target.value)}
                            placeholder="dd/mm/aaaa"
                            maxLength={10}
                            className="h-[26px] w-[96px] text-[9px] font-mono font-bold uppercase border border-brand-border bg-white px-2 tracking-wider placeholder:opacity-30"
                            aria-label="Data final do filtro de totais"
                          />
                          {(folhaTotaisDe || folhaTotaisAte) && (
                            <button
                              type="button"
                              onClick={() => { setFolhaTotaisDe(''); setFolhaTotaisAte(''); }}
                              className="h-[26px] px-2 text-[9px] font-bold border border-brand-border text-brand-text/50 hover:text-red-700 hover:border-red-300"
                              title="Limpar filtro de período"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    {folhaTotaisPorConta.length === 0 ? (
                      <div className="py-12 text-center text-[10px] font-bold text-brand-text/40 uppercase tracking-widest">
                        {folhaRelatorio.length === 0
                          ? 'Nenhum lançamento importado na folha.'
                          : folhaRegras.length === 0
                          ? 'Configure as regras de contas para ver os totais.'
                          : (folhaTotaisDe || folhaTotaisAte)
                          ? 'Nenhum lançamento no período informado com regra correspondente.'
                          : 'Nenhum lançamento com regra de conta correspondente.'}
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[620px] text-left text-sm border-collapse">
                          <thead className="technical-grid-header sticky top-0 z-10">
                            <tr>
                              <th className="px-4 py-3 border-r border-brand-border bg-brand-sidebar text-[10px] font-black uppercase">Conta</th>
                              <th className="px-4 py-3 border-r border-brand-border bg-brand-sidebar text-[10px] font-black uppercase">Nome</th>
                              <th className="px-4 py-3 border-r border-brand-border bg-brand-sidebar text-right text-[10px] font-black uppercase text-rose-700">Débito</th>
                              <th className="px-4 py-3 border-r border-brand-border bg-brand-sidebar text-right text-[10px] font-black uppercase text-emerald-700">Crédito</th>
                              <th className="px-4 py-3 bg-brand-sidebar text-right text-[10px] font-black uppercase">Saldo (D−C)</th>
                            </tr>
                          </thead>
                          <tbody className="font-mono text-[11px] divide-y divide-brand-border/10">
                            {folhaTotaisPorConta.map((t) => (
                              <tr key={t.conta} className="technical-grid-row">
                                <td className="px-4 py-3 border-r border-brand-border/10 font-bold text-brand-text">
                                  <button
                                    type="button"
                                    className="font-mono font-bold cursor-pointer underline decoration-dotted underline-offset-2 hover:opacity-70 text-left"
                                    title="Abrir razão desta conta"
                                    onClick={() => { setFolhaTotaisRazaoConta(t); setFolhaTotaisRazaoOpen(true); }}
                                  >
                                    {t.conta}
                                  </button>
                                </td>
                                <td className="px-4 py-3 border-r border-brand-border/10 uppercase italic truncate max-w-[260px]" title={t.nomeConta}>{t.nomeConta}</td>
                                <td className="px-4 py-3 border-r border-brand-border/10 text-right text-rose-700">{t.debito > 0 ? formatCurrency(t.debito) : '—'}</td>
                                <td className="px-4 py-3 border-r border-brand-border/10 text-right text-emerald-700">{t.credito > 0 ? formatCurrency(t.credito) : '—'}</td>
                                <td className={cn(
                                  'px-4 py-3 text-right font-bold',
                                  t.saldo > 0 ? 'text-rose-700' : t.saldo < 0 ? 'text-emerald-700' : 'text-brand-text/50',
                                )}>
                                  {t.saldo !== 0 ? formatCurrency(Math.abs(t.saldo)) + (t.saldo > 0 ? ' D' : ' C') : '—'}
                                </td>
                              </tr>
                            ))}
                            {/* Linha de totais */}
                            <tr className="bg-brand-sidebar/20 font-bold border-t border-brand-border/30">
                              <td className="px-4 py-3 border-r border-brand-border/10 text-[10px] font-black uppercase" colSpan={2}>Total geral</td>
                              <td className="px-4 py-3 border-r border-brand-border/10 text-right text-rose-700">
                                {formatCurrency(folhaTotaisPorConta.reduce((s, t) => s + t.debito, 0))}
                              </td>
                              <td className="px-4 py-3 border-r border-brand-border/10 text-right text-emerald-700">
                                {formatCurrency(folhaTotaisPorConta.reduce((s, t) => s + t.credito, 0))}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {(() => {
                                  const net = folhaTotaisPorConta.reduce((s, t) => s + t.saldo, 0);
                                  return net !== 0
                                    ? <span className={net > 0 ? 'text-rose-700' : 'text-emerald-700'}>{formatCurrency(Math.abs(net))} {net > 0 ? 'D' : 'C'}</span>
                                    : <span className="text-brand-text/50">—</span>;
                                })()}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
                </div>
              )}

              {/* ======================= FISCAL / IMPOSTOS SUBTAB ======================= */}
              {activeSubTab === 'fiscal' && <FiscalModule selectedCompany={selectedCompany} />}

              {activeSubTab === 'honorarios' && (
                <HonorariosModule
                  selectedCompany={selectedCompany}
                  onRazaoUpdated={() =>
                    setRazaoRows(readManagerData<VisionBalanceteRow>(selectedCompany, 'razao'))
                  }
                />
              )}

              {/* ======================= NOTA EXPLICATIVA SUBTAB ======================= */}
              {activeSubTab === 'nota_explicativa' && (
                <NotaExplicativaTab selectedCompany={selectedCompany} />
              )}

              {/* ======================= DEMONSTRAÇÕES FINANCEIRAS SUBTAB ======================= */}
              {activeSubTab === 'demonstracoes' && (
                <div className="space-y-6">
                  <div className="p-4 bg-brand-sidebar/20 border border-brand-border text-xs">
                    <span className="font-bold uppercase tracking-widest">DRE & Demonstrações Financeiras Automatizadas</span>
                    <p className="opacity-50 text-[9px] mt-1">Abaixo está o balancete analítico estruturado a nível gerencial.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Dynamic DRE */}
                    <div className="technical-panel p-6 shadow-[6px_6px_0_0_#141414] bg-white space-y-4">
                      <h4 className="text-xs font-black uppercase tracking-widest border-b pb-2 flex justify-between">
                        <span>Demonstração do Resultado (DRE)</span>
                        <span className="text-[9px] font-mono opacity-50 underline">Período Fiscal</span>
                      </h4>

                      <div className="space-y-2 text-[10px] font-mono uppercase">
                        <div className="flex justify-between border-b py-1">
                          <span>(+) Receita Operacional Bruta</span>
                          <span className="font-bold text-blue-600">{formatCurrency(currentTotalInflows)}</span>
                        </div>
                        <div className="flex justify-between border-b py-1">
                          <span>(-) Deduções e Impostos DAS (6.5%)</span>
                          <span className="text-red-500">-{formatCurrency(currentTotalInflows * 0.065)}</span>
                        </div>
                        <div className="flex justify-between border-b py-1 font-bold">
                          <span>(=) Receita Líquida</span>
                          <span>{formatCurrency(currentTotalInflows * 0.935)}</span>
                        </div>
                        <div className="flex justify-between border-b py-1">
                          <span>(-) Despesas Operacionais (Folha e Outros)</span>
                          <span className="text-red-500">
                            -{formatCurrency(folhaPayrollTotals.base + currentTotalOutflows)}
                          </span>
                        </div>
                        <div className="flex justify-between border-b-2 py-1 font-black text-xs text-green-700 bg-green-50 px-2 mt-4">
                          <span>(=) Resultado Líquido do Exercício</span>
                          <span>
                            {formatCurrency(
                              (currentTotalInflows * 0.935) -
                              (folhaPayrollTotals.base + currentTotalOutflows)
                            )}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Dynamic Balanço Patrimonial */}
                    <div className="technical-panel p-6 shadow-[6px_6px_0_0_#141414] bg-white space-y-4">
                      <h4 className="text-xs font-black uppercase tracking-widest border-b pb-2 flex justify-between">
                        <span>Balanço Patrimonial Simplificado</span>
                        <span className="text-[9px] font-mono opacity-50">Equação Ativo x Passivo</span>
                      </h4>

                      <div className="space-y-4 text-[10px] font-mono uppercase">
                        <div className="border border-brand-border/20 p-3">
                          <div className="font-bold border-b pb-1 text-blue-600 flex justify-between">
                            <span>Ativo Total</span>
                            <span>{formatCurrency(currentTotalBalance > 0 ? currentTotalBalance : 0)}</span>
                          </div>
                          <p className="text-[8px] opacity-50 mt-1 italic leading-normal">Caixa, Bancos e Aplicações Líquidas.</p>
                        </div>

                        <div className="border border-brand-border/20 p-3">
                          <div className="font-bold border-b pb-1 text-red-600 flex justify-between">
                            <span>Passivo + PL</span>
                            <span>{formatCurrency(folhaPayrollTotals.base)}</span>
                          </div>
                          <p className="text-[8px] opacity-50 mt-1 italic leading-normal">Salários a pagar e deduções estimadas.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

        </div>
      </div>

      {regrasContasModalOpen ? (
        <ExtratoRegrasContasModal
          open={regrasContasModalOpen}
          company={selectedCompany}
          regras={extratoRegrasContas}
          planoOptions={extratoContrapartidaPlanoOptions}
          planoLookupOptions={extratoPlanoNomeOptions}
          bancoOptions={
            extratoBancoPlanoOptions.length > 0 ? extratoBancoPlanoOptions : extratoPlanoOptions
          }
          defaultContaBanco={contaBancoExtratoAtivo}
          extratoSample={extratoSampleForRegras}
          onClose={() => setRegrasContasModalOpen(false)}
          onChange={handleExtratoRegrasContasChange}
          onContaBancoChange={() => setContaBancoTick((n) => n + 1)}
          onReaplicar={
            extratoLancamentos.length > 0 ? handleReaplicarExtratoContas : undefined
          }
        />
      ) : null}

      {/* Debug Logs — overlay modal */}
      {debugPanelOpen && (() => {
        const DEBUG_CATS = ['todos', 'conciliação', 'regras', 'conversor', 'importação', 'exportação'] as const;
        const logsVisiveis = debugLogFilter === 'todos'
          ? debugLogs
          : debugLogs.filter(l => l.cat === debugLogFilter);
        const totalFiltro = logsVisiveis.length;
        return (
          <div
            className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/50"
            onClick={(e) => { if (e.target === e.currentTarget) setDebugPanelOpen(false); }}
          >
            <div className="technical-panel w-full max-w-3xl max-h-[80vh] flex flex-col shadow-[6px_6px_0_0_#141414]">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-brand-border bg-brand-sidebar/40 shrink-0">
                <span className="text-[10px] font-black uppercase tracking-widest">
                  🛠 Debug Logs ({totalFiltro}/{debugLogs.length})
                </span>
                <div className="flex items-center gap-2">
                  <select
                    value={debugLogFilter}
                    onChange={(e) => setDebugLogFilter(e.target.value)}
                    className="technical-button text-[8px] py-0.5 px-1.5 bg-brand-bg border border-brand-border rounded-none"
                    title="Filtrar logs por categoria"
                  >
                    {DEBUG_CATS.map(cat => (
                      <option key={cat} value={cat}>
                        {cat.charAt(0).toUpperCase() + cat.slice(1)}
                        {cat !== 'todos' ? ` (${debugLogs.filter(l => l.cat === cat).length})` : ` (${debugLogs.length})`}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      const texto = logsVisiveis.map(l => l.msg).join('\n');
                      void navigator.clipboard.writeText(texto).then(() => alert('Logs copiados!'));
                    }}
                    className="technical-button text-[8px] py-0.5 px-2"
                  >
                    Copiar tudo
                  </button>
                  <button
                    type="button"
                    onClick={() => setDebugLogs([])}
                    className="technical-button text-[8px] py-0.5 px-2 border-red-800 text-red-800 hover:bg-red-800 hover:text-white"
                  >
                    Limpar
                  </button>
                  <button
                    type="button"
                    onClick={() => setDebugPanelOpen(false)}
                    className="technical-button text-[8px] py-0.5 px-2"
                  >
                    Fechar ✕
                  </button>
                </div>
              </div>
              <pre className="flex-1 min-h-0 overflow-y-auto p-4 text-[10px] font-mono leading-relaxed text-brand-text bg-brand-bg whitespace-pre-wrap break-all">
                {logsVisiveis.length === 0
                  ? 'Nenhum log ainda.\nFaça uma ação (recarregar página, editar regra, clicar em Reaplicar) para ver os logs aqui.'
                  : logsVisiveis.map(l => l.msg).join('\n')}
              </pre>
            </div>
          </div>
        );
      })()}

      <ExtratoPastasModal
        open={extratoPastasModalOpen}
        company={selectedCompany}
        contaBancoAtiva={contaBancoExtratoAtivo}
        tick={extratoPastasTick}
        onClose={() => setExtratoPastasModalOpen(false)}
        onSelect={handleSelectExtratoPasta}
        onRemove={(id) => {
          const item = getExtratoPastaById(selectedCompany, id);
          if (item) {
            const activeBanco = (getExtratoBancoConta(selectedCompany) || contaBancoExtratoAtivo || '').trim().replace(/\D/g, '');
            const itemBanco = (item.contaBanco || '').trim().replace(/\D/g, '');
            if (itemBanco && itemBanco === activeBanco) {
              void handleLimparExtratos();
            }
          }
        }}
      />

      <ExtratoSemNotaModal
        open={semNotaModalOpen}
        rows={pendingSemNotaRows}
        onClose={() => setSemNotaModalOpen(false)}
        onConfirm={handleSemNotaModalConfirm}
      />

      {/* Modal de Regras de Contas — Folha de Pagamento */}
      {showFolhaRegrasModal && (
        <div className="fixed inset-0 z-[9000] flex items-start justify-center bg-black/50 p-4 pt-12 overflow-y-auto">
          <div className="w-full max-w-3xl bg-brand-bg border border-brand-border shadow-[4px_4px_0_0_#141414]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-brand-border bg-brand-sidebar/30">
              <h2 className="text-[10px] font-black uppercase tracking-widest">Regras de contas — Folha</h2>
              <button
                type="button"
                onClick={() => { setShowFolhaRegrasModal(false); setFolhaRegras(loadFolhaRegras(selectedCompany)); }}
                className="technical-button p-1"
                aria-label="Fechar"
              >
                <X size={14} />
              </button>
            </div>
            <Suspense fallback={null}>
              <FolhaContasAutomacaoPanel
                selectedCompany={selectedCompany}
                folhaRelatorio={folhaRelatorio}
                planoOptions={extratoPlanoOptions}
                planoLookupOptions={extratoPlanoNomeOptions}
                onChange={(regras) => setFolhaRegras(regras)}
              />
            </Suspense>
          </div>
        </div>
      )}

      {/* Modal de Conflito de Balancete */}
      {showBalanceteConflictModal && balanceteConflitosDetectados.length > 0 && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="technical-panel w-full max-w-2xl bg-amber-950/20 border-2 border-amber-600 shadow-2xl flex flex-col max-h-[80vh]">
            {/* Header */}
            <div className="p-4 border-b border-amber-600/50 bg-amber-950/30 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <AlertTriangle size={20} className="text-amber-600" />
                <h2 className="text-sm font-black uppercase tracking-widest text-amber-600">
                  ⚠️ CONFLITO DETECTADO NO BALANCETE
                </h2>
              </div>
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              <p className="text-sm leading-relaxed text-amber-100">
                Foram detectados <strong>{balanceteConflitosDetectados.length}</strong> lançamento(s) com dados diferentes dos que estão atualmente no sistema.
                Os dados já estavam impostados/classificados previamente.
              </p>

              <div className="space-y-3 max-h-[40vh] overflow-y-auto">
                {balanceteConflitosDetectados.map((conflito, idx) => (
                  <div
                    key={idx}
                    className="border border-amber-600/30 bg-amber-950/20 p-3 space-y-2 rounded"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="font-bold text-amber-400 text-sm">{conflito.historico}</div>
                        <div className="text-xs text-amber-200 opacity-75">ID: {conflito.id}</div>
                      </div>
                      <span className="text-xs font-bold px-2 py-1 bg-amber-600 text-white rounded">
                        {conflito.conflito === 'valores-diferentes'
                          ? 'Valores'
                          : conflito.conflito === 'contas-diferentes'
                            ? 'Contas'
                            : 'Impostação'}
                      </span>
                    </div>

                    {conflito.conflito === 'valores-diferentes' && (
                      <div className="text-xs space-y-1 bg-black/20 p-2 rounded font-mono">
                        <div>
                          <span className="text-red-400">Antigo:</span> D{' '}
                          {(conflito.detalhes.debitoAntigo ?? 0).toLocaleString('pt-BR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{' '}
                          | C{' '}
                          {(conflito.detalhes.creditoAntigo ?? 0).toLocaleString('pt-BR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </div>
                        <div>
                          <span className="text-green-400">Novo:</span> D{' '}
                          {(conflito.detalhes.debitoNovo ?? 0).toLocaleString('pt-BR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{' '}
                          | C{' '}
                          {(conflito.detalhes.creditoNovo ?? 0).toLocaleString('pt-BR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </div>
                      </div>
                    )}

                    {conflito.conflito === 'contas-diferentes' && (
                      <div className="text-xs space-y-1 bg-black/20 p-2 rounded font-mono">
                        <div>
                          <span className="text-red-400">Antigo:</span> {conflito.detalhes.contaAntiga}
                        </div>
                        <div>
                          <span className="text-green-400">Novo:</span> {conflito.detalhes.contaNova}
                        </div>
                      </div>
                    )}

                    {conflito.conflito === 'impostacao-existente' && (
                      <div className="text-xs bg-black/20 p-2 rounded text-amber-300">
                        Este lançamento já havia sido impostado/classificado manualmente.
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="bg-amber-950/40 border border-amber-600/30 p-3 rounded text-xs text-amber-100">
                <strong>O que deseja fazer?</strong>
                <ul className="mt-2 space-y-1 ml-4 list-disc text-amber-200">
                  <li>
                    <strong>Manter dados atuais:</strong> Cancela a importação, mantém dados já impostados
                  </li>
                  <li>
                    <strong>Sobrescrever:</strong> Remove dados antigos e importa novamente (perderá impostações)
                  </li>
                </ul>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-amber-600/50 bg-amber-950/20 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowBalanceteConflictModal(false);
                  setBalanceteConflitosDetectados([]);
                  setForceOverwriteBalancete(false);
                }}
                className="technical-button border-amber-600 text-amber-600 hover:bg-amber-600 hover:text-white text-xs font-bold"
              >
                CANCELAR IMPORT
              </button>
              <button
                type="button"
                onClick={() => {
                  setForceOverwriteBalancete(true);
                  handleMandarConciliacaoParaBalancete();
                }}
                className="technical-button-primary bg-red-700 hover:bg-red-600 text-xs font-bold"
              >
                SOBRESCREVER (CUIDADO!)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Razão — aberto ao clicar em uma conta da aba Totais por Conta (Folha) */}
      {folhaTotaisRazaoOpen && folhaTotaisRazaoConta && (
        <RazaoContaLancamentosModal
          open={folhaTotaisRazaoOpen}
          onClose={() => setFolhaTotaisRazaoOpen(false)}
          razaoRows={razaoRows}
          planoRows={accountPlansToVisionPlano(planoContas)}
          conta={{
            chave: folhaTotaisRazaoConta.conta,
            codigo: folhaTotaisRazaoConta.conta,
            // Folha só tem código de conta "chapado" (sem classificação hierárquica) — deixar
            // vazio aqui. Repetir o código também em `classificacao` fazia o modo "codigo" do
            // modal (RazaoContaLancamentosModal) achar que não tinha um código reduzido de
            // verdade e sempre voltar 0 lançamentos, mesmo com a conta tendo movimento.
            classificacao: '',
            nome: folhaTotaisRazaoConta.nomeConta,
            tipo: 'A',
          }}
          modo="codigo"
          periodoDe={balancetePeriodoConfirmado?.de ?? ''}
          periodoAte={balancetePeriodoConfirmado?.ate ?? ''}
          surface="contabilfacil"
          onRazaoRowsChange={setRazaoRows}
        />
      )}

      {/* Modais de período obrigatório para lançamento ao balancete */}
      <BalancetePeriodoModal
        isOpen={periodoModalConciliacaoOpen}
        onConfirm={(periodo) => {
          setPeriodoModalConciliacaoOpen(false);
          void handleMandarConciliacaoParaBalancete(periodo);
        }}
        onCancel={() => setPeriodoModalConciliacaoOpen(false)}
      />
      <BalancetePeriodoModal
        isOpen={periodoModalFolhaOpen}
        onConfirm={handlePeriodoFolhaConfirmado}
        onCancel={() => setPeriodoModalFolhaOpen(false)}
      />
      <ExtratoPeriodoExportModal
        isOpen={periodoModalImportBalanceteOpen}
        title="Importar Conciliacao para o Balancete"
        subtitle="Escolha o periodo (ex.: um mes) ou importe tudo de uma vez"
        confirmAllLabel="IMPORTAR TUDO"
        onConfirm={(periodo) => {
          setPeriodoModalImportBalanceteOpen(false);
          void handleMandarConciliacaoParaBalancete(periodo);
        }}
        onConfirmAll={() => {
          setPeriodoModalImportBalanceteOpen(false);
          void handleMandarConciliacaoParaBalancete(undefined, { todos: true });
        }}
        onCancel={() => setPeriodoModalImportBalanceteOpen(false)}
      />
      <ExtratoPeriodoExportModal
        isOpen={periodoModalExportExtratoOpen}
        title="Exportar TXT+ Domínio do Extrato"
        subtitle="Escolha o período (ex.: um mês) ou exporte tudo de uma vez"
        onConfirm={(periodo) => {
          setPeriodoModalExportExtratoOpen(false);
          handleExportTxt(periodo);
        }}
        onConfirmAll={() => {
          setPeriodoModalExportExtratoOpen(false);
          handleExportTxt();
        }}
        onCancel={() => setPeriodoModalExportExtratoOpen(false)}
      />
    </div>
  );
}

