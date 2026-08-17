import { lazy, Suspense, useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { format, isValid } from 'date-fns';
import {
  Plus,
  Trash2,
  Copy,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Search,
  FileText,
  Download,
} from 'lucide-react';
import { cn, formatCurrency } from '../lib/utils';
import { FreeNumericInput } from './FreeNumericInput';
import {
  CF_FIELD_COL,
  CF_FIELD_COL_GROW,
  CF_FIELD_FULL,
  CF_FIELD_HINT,
  CF_FIELD_INLINE,
  CF_FORM_FIELDS,
  CF_LOAN_FIELD_FULL,
  CF_LABEL,
  CF_LOAN_INPUT_DATE,
  CF_LOAN_INPUT_MONEY,
  CF_LOAN_INPUT_NUM,
  CF_LOAN_INPUT_PCT,
  CF_LOAN_INPUT_MED,
  CF_LOAN_SELECT,
} from '../lib/formFieldClasses';
import { LoanContract } from '../types';
const DataIngestionBox = lazy(() => import('./DataIngestionBox'));
const LoanAmortizationChart = lazy(() => import('./LoanAmortizationChart'));
import { LoanAmortizationInfoHint } from './LoanAmortizationInfoHint';
import LoanContasTab from './LoanContasTab';
import type { ExtratoPlanoContaOption } from './ExtratoContaPicker';
import LoanScheduleVirtualTable from './LoanScheduleVirtualTable';

import { useLoanModuleState } from '../logic/useLoanModuleState';
import { postEmprestimoNoRazao } from '../logic/loanBalanceteAutomation';
import { flushPersistenceAfterCriticalWrite } from '../logic/eyeVisionPersistenceFlush';
import { parseCurrency } from '../../lib/simTabFields';
import {
  spreadIndexadorShortLabel,
  usesSpreadPlusIndexador,
  formatCurrencyInput,
  SIM_VAR_MODE_OPTIONS,
  type SimTabFields,
  type SimVarMode,
} from '../../lib/simTabFields';
import { useAppModal } from './AppModal';
import BalanceteEnvioModal, { type BalanceteEnvioLancamento } from './BalanceteEnvioModal';
import BalancetePeriodoModal, { type BalancetePeriodo } from './BalancetePeriodoModal';

export interface LoanModuleProps {
  selectedCompany: string;
  storageVersion?: number;
  /** Dentro da aba Gerencial — oculta cabeçalho duplicado do módulo. */
  embedded?: boolean;
  /** Plano de contas da empresa — habilita o select com busca nas Contas Contábeis (Domínio). */
  planoContaOptions?: ExtratoPlanoContaOption[];
}

type LoanMainTab = 'contratos' | 'simulacao' | 'contas';

export default function LoanModule({
  selectedCompany,
  storageVersion,
  embedded = false,
  planoContaOptions = [],
}: LoanModuleProps) {
  const [loanMainTab, setLoanMainTab] = useState<LoanMainTab>('contratos');
  const [activeView, setActiveView] = useState<'table' | 'chart' | 'form'>('table');
  const [contractSearch, setContractSearch] = useState('');
  const [folderOpen, setFolderOpen] = useState(true);
  const [showImportBox, setShowImportBox] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [adjustmentMonthYear, setAdjustmentMonthYear] = useState('');
  const [adjustmentAction, setAdjustmentAction] = useState<'' | 'nao_pago' | 'var_monetaria' | 'adiantado' | 'atrasado_pago'>('');
  const [adjustmentValue, setAdjustmentValue] = useState('');
  const [difJurosValorReal, setDifJurosValorReal] = useState('');
  const [adjustmentsSearch, setAdjustmentsSearch] = useState('');
  // Parcelas selecionadas para quitação múltipla (set de month numbers)
  const [selectedOverdueMonths, setSelectedOverdueMonths] = useState<Set<number>>(new Set());
  const [selectedContractIds, setSelectedContractIds] = useState<Set<string>>(new Set());
  const [balancetePreview, setBalancetePreview] = useState<{
    open: boolean;
    lancamentos: BalanceteEnvioLancamento[];
    totalContratos: number;
    onConfirm: () => void;
  }>({ open: false, lancamentos: [], totalContratos: 0, onConfirm: () => {} });
  const [periodoModalLoanOpen, setPeriodoModalLoanOpen] = useState(false);
  const { openModal } = useAppModal();

  const {
    contracts,
    selectedId,
    setSelectedId,
    activeContract,
    schedule,
    rawSchedule,
    isCalculating,
    loanParams,
    loanAccountFields,
    activeTab,
    handleCreate,
    handleDuplicate,
    handleDelete,
    handleUpdate,
    handleUpdateInterestRate,
    handleUpdateGraceInterestRate,
    interestRateStr,
    graceInterestRateStr,
    patchActiveSimTab,
    clearAll,
    importLoanContracts,
    handleExportDominio,
    handleExportPDF,
    handleExportForDeploy,
    bcbReadiness,
    handleMandarTodosEmprestimosBalancete,
    handleExportSelecionadosDominioTXT,
    handleGerarPreviewBalancete,
    handleTogglePaidMonth,
    handleToggleUnpaidMonth,
    handleSetPaymentAmountMonth,
    handleSetAtrasadoPagoMonth,
    handleSetPrepaymentAmountMonth,
    handleSetInterestAdjustmentMonth,
    handleClearMonthlyAdjustments,
    handleRemoveMonthAdjustment,
    sacUnderpaymentWarning,
  } = useLoanModuleState({ selectedCompany, storageVersion });

  const scheduleDateOptions = useMemo(() => {
    const seen = new Set<string>();
    return rawSchedule
      .filter((row) => row.month > 0 && (row.competenceDate || row.date))
      .map((row) => {
        const date = row.competenceDate instanceof Date
          ? row.competenceDate
          : row.accrualStartDate instanceof Date
            ? row.accrualStartDate
            : row.date instanceof Date
              ? row.date
              : new Date(row.date);
        const formatted = format(date, 'dd/MM/yyyy');
        if (seen.has(formatted)) return null;
        seen.add(formatted);
        return formatted;
      })
      .filter((value): value is string => Boolean(value));
  }, [rawSchedule]);

  const filteredScheduleDateOptions = useMemo(
    () => scheduleDateOptions,
    [scheduleDateOptions],
  );

  const findScheduleMonthByDateKey = useCallback(
    (value: string) => {
      const trimmed = String(value || '').trim();
      if (!trimmed) return undefined;

      const parsedDate = (() => {
        const parts = trimmed.split('/');
        if (parts.length === 3) {
          const day = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10);
          const year = parseInt(parts[2], 10);
          if (day && month && year) {
            return new Date(year, month - 1, day);
          }
        }
        return undefined;
      })();

      if (parsedDate && isValid(parsedDate)) {
        return rawSchedule.find((row) => {
          if (row.month <= 0) return false;
          const rowDate = row.competenceDate instanceof Date
            ? row.competenceDate
            : row.accrualStartDate instanceof Date
              ? row.accrualStartDate
              : row.date instanceof Date
                ? row.date
                : new Date(row.date);
          return (
            rowDate.getUTCFullYear() === parsedDate.getUTCFullYear() &&
            rowDate.getUTCMonth() === parsedDate.getUTCMonth() &&
            rowDate.getUTCDate() === parsedDate.getUTCDate()
          );
        })?.month;
      }

      const normalized = trimmed.replace(/[-\s]/g, '/');
      const monthYearMatch = /^([0-9]{1,2})\/(?:([0-9]{4})|([0-9]{2}))$/.exec(normalized);
      if (monthYearMatch) {
        const month = parseInt(monthYearMatch[1], 10);
        const year = parseInt(monthYearMatch[2] || monthYearMatch[3], 10);
        const fullYear = year < 100 ? 2000 + year : year;
        return rawSchedule.find((row) => {
          if (row.month <= 0) return false;
          const rowDate = row.competenceDate instanceof Date
            ? row.competenceDate
            : row.accrualStartDate instanceof Date
              ? row.accrualStartDate
              : row.date instanceof Date
                ? row.date
                : new Date(row.date);
          return rowDate.getUTCFullYear() === fullYear && rowDate.getUTCMonth() + 1 === month;
        })?.month;
      }

      return rawSchedule.find((row) => {
        if (row.month <= 0) return false;
        const rowDate = row.competenceDate instanceof Date
          ? row.competenceDate
          : row.accrualStartDate instanceof Date
            ? row.accrualStartDate
            : row.date instanceof Date
              ? row.date
              : new Date(row.date);
        return format(rowDate, 'dd/MM/yyyy') === trimmed;
      })?.month;
    },
    [rawSchedule],
  );


  const filteredContracts = useMemo(() => {
    const needle = contractSearch.trim().toLowerCase();
    if (!needle) return contracts;
    return contracts.filter((contract) =>
      `${contract.contractNumber} ${contract.bankName} ${contract.type}`.toLowerCase().includes(needle),
    );
  }, [contracts, contractSearch]);

  const openContract = (id: string) => {
    setSelectedId(id);
    setLoanMainTab('simulacao');
    setActiveView('form');
  };

  useEffect(() => {
    if (loanMainTab === 'contas' && !selectedId && contracts.length > 0) {
      setSelectedId(contracts[0].id);
    }
  }, [loanMainTab, selectedId, contracts, setSelectedId]);

  const onCreate = () => {
    handleCreate();
    setFolderOpen(true);
    setLoanMainTab('simulacao');
    setActiveView('form');
  };

  const curtoColumnLabel = 'Curto';

  const scheduleTableColumns = useMemo(
    () => [
      { key: 'month', label: 'Nº Parcela', align: 'center' as const },
      { key: 'date', label: 'Data', align: 'center' as const },
      {
        key: 'days',
        label: loanParams?.varIndexMode === 'selic_over_diaria' ? 'Dias (DU)' : 'Dias',
        align: 'right' as const,
      },
      { key: 'selic', label: 'Fator SELIC', align: 'right' as const },
      { key: 'rate', label: 'Taxa %', align: 'right' as const },
      { key: 'initial', label: 'SD Inicial', align: 'right' as const },
      { key: 'installment', label: 'Parcela Bruta', align: 'right' as const },
      { key: 'amortization', label: 'Parcela Líq.', align: 'right' as const },
      { key: 'prepayment', label: 'Adiantado', align: 'right' as const },
      { key: 'interest', label: 'Juros', align: 'right' as const },
      { key: 'ajusteJuros', label: 'AJUSTES DE JUROS NEGATIVO', align: 'right' as const },
      { key: 'ajustes', label: 'AJUSTES DE JUROS POSITIVOS', align: 'right' as const },
      { key: 'final', label: 'SD Final', align: 'right' as const },
      { key: 'short', label: curtoColumnLabel, align: 'right' as const },
      { key: 'long', label: 'Longo', align: 'right' as const },
      { key: 'ocorrencia', label: 'Parcela Atrasada', align: 'center' as const },
    ],
    [curtoColumnLabel, loanParams?.varIndexMode],
  );

  const canExport =
    !!activeContract &&
    activeContract.principal > 0 &&
    rawSchedule.length > 0 &&
    !isCalculating;

  const scheduleTotals = useMemo(() => {
    const graceType = activeContract?.graceType ?? 'capitalized';
    const paymentRows = rawSchedule.filter((r) => r.month > 0);
    const paymentAmount = (r: (typeof paymentRows)[0]) => {
      if (r.isGrace) {
        if (graceType === 'paid') {
          if (r.installment > 0) return r.installment;
          return r.interest + r.monthlyCost;
        }
        return 0;
      }
      if (r.installment > 0) return r.installment;
      return r.amortization + r.interest + r.monthlyCost;
    };
    const withPayment = paymentRows.filter((r) => paymentAmount(r) > 0);
    return {
      paymentSum: paymentRows.reduce((acc, r) => acc + paymentAmount(r), 0),
      firstPayment: withPayment[0] ? paymentAmount(withPayment[0]) : 0,
      lastPayment: withPayment.at(-1) ? paymentAmount(withPayment.at(-1)!) : 0,
    };
  }, [rawSchedule, activeContract?.graceType]);

  const chartData = useMemo(() => {
    if (schedule.length === 0) return [];
    const maxPoints = 120;
    const step = schedule.length > maxPoints ? Math.ceil(schedule.length / maxPoints) : 1;
    const sampled = step === 1 ? schedule : schedule.filter((_, i) => i % step === 0 || i === schedule.length - 1);
    return sampled.map((s) => ({
      name: `Mês ${s.month}`,
      saldo: s.balance,
      parcela: s.payment,
      juros: s.interest,
      amortiza: s.amortization,
    }));
  }, [schedule]);

  const handleExportDomínio = () => {
    handleExportDominio(openModal);
  };

  const handleMandarEmprestimoBalancete = () => {
    // Primeiro: exige seleção do período antes de gerar preview
    setPeriodoModalLoanOpen(true);
  };

  const handlePeriodoLoanConfirmado = (_periodo: BalancetePeriodo) => {
    setPeriodoModalLoanOpen(false);
    // Gera preview dos lançamentos e abre o modal de confirmação
    try {
      const preview = handleGerarPreviewBalancete();
      if (preview.lancamentos.length === 0 && preview.erros.length > 0) {
        openModal({
          title: 'Atenção — Sem Lançamentos',
          type: 'warning',
          body: (
            <div className="space-y-2">
              <p className="text-sm">Nenhum lançamento foi gerado. Verifique as configurações de contas:</p>
              <ul className="text-[11px] font-mono space-y-1 text-white/60">
                {preview.erros.map((e, i) => <li key={i}>• {e}</li>)}
              </ul>
            </div>
          ),
        });
        return;
      }
      setBalancetePreview({
        open: true,
        lancamentos: preview.lancamentos,
        totalContratos: preview.totalContratos,
        onConfirm: () => {
          setBalancetePreview((p) => ({ ...p, open: false }));
          try {
            const result = handleMandarTodosEmprestimosBalancete();
            if (result.gerados > 0) {
              void openModal({
                title: 'Lançamentos Enviados',
                type: 'success',
                body: (
                  <div className="space-y-2">
                    <p className="text-sm font-bold">
                      {result.gerados} lançamento(s) gravados no razão com sucesso.
                    </p>
                    <p className="text-[11px] text-white/60">
                      Abra a aba <strong>Balancete / Razão</strong> para conferir.
                    </p>
                    {result.erros.length > 0 && (
                      <div className="mt-3 border-t border-white/10 pt-2">
                        <p className="text-[10px] text-amber-400 font-bold mb-1">Atenção — alguns contratos com pendências:</p>
                        <ul className="text-[10px] text-white/50 space-y-0.5">
                          {result.erros.map((e, i) => <li key={i}>• {e}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                ),
              });
            } else {
              void openModal({
                title: result.erros.length > 0 ? 'Falha ao Enviar' : 'Sem Novidades',
                type: result.erros.length > 0 ? 'warning' : 'info',
                body: (
                  <div className="space-y-2">
                    {result.erros.length > 0 ? (
                      <ul className="text-[11px] font-mono space-y-1">
                        {result.erros.map((e, i) => <li key={i}>• {e}</li>)}
                      </ul>
                    ) : (
                      <p>Nenhum lançamento novo — todos os contratos já estão no balancete.</p>
                    )}
                  </div>
                ),
              });
            }
          } catch (err) {
            void openModal({
              title: 'Erro ao enviar',
              type: 'error',
              body: <p>{err instanceof Error ? err.message : 'Falha ao enviar para o balancete.'}</p>,
            });
          }
        },
      });
    } catch (err) {
      openModal({
        title: 'Erro',
        type: 'error',
        body: <p>{err instanceof Error ? err.message : 'Falha ao gerar preview dos lançamentos.'}</p>,
      });
    }
  };

  const toggleSelectContract = useCallback(
    (id: string) =>
      setSelectedContractIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );

  const toggleSelectAll = useCallback(
    () =>
      setSelectedContractIds((prev) => {
        const allIds = filteredContracts.map((c) => c.id);
        const allSelected = allIds.every((id) => prev.has(id));
        return allSelected ? new Set() : new Set(allIds);
      }),
    [filteredContracts],
  );

  const loanMainTabs: { id: LoanMainTab; label: string }[] = [
    { id: 'contratos', label: 'Contratos' },
    { id: 'simulacao', label: 'Simulação' },
    { id: 'contas', label: 'Contas' },
  ];

  const renderContratosTab = () => (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
      <div className="lg:col-span-8 space-y-4">
        <div className="technical-panel shadow-[4px_4px_0_0_#141414] overflow-hidden module-panel-scroll min-w-0">
          <div className="px-4 py-3 border-b border-brand-border bg-brand-sidebar/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em]">Contratos do Sindicato</h3>
              <p className="text-[9px] font-mono opacity-50 mt-0.5 truncate">{selectedCompany}</p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-border/50" size={14} />
              <input
                type="text"
                aria-label="Buscar número do contrato"
                value={contractSearch}
                onChange={(e) => setContractSearch(e.target.value)}
                placeholder="BUSCAR Nº DO CONTRATO..."
                className="w-full pl-9 pr-3 py-2 bg-white border border-brand-border text-[10px] font-mono font-bold uppercase tracking-wide outline-none focus:bg-brand-sidebar/10"
              />
            </div>
          </div>

          <div className="module-panel-scroll-body">
            <div className="border-b border-brand-border/20 min-w-[320px]">
              <button
                type="button"
                onClick={() => setFolderOpen((open) => !open)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-brand-sidebar/30 transition-colors"
              >
                <span className="text-brand-border/70">
                  {folderOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
                <span className="text-brand-border">
                  {folderOpen ? <FolderOpen size={16} /> : <Folder size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-black uppercase tracking-wide truncate">{selectedCompany}</p>
                  <p className="text-[9px] font-mono opacity-50">{contracts.length} contrato(s)</p>
                </div>
              </button>

              {folderOpen ? (
                <div className="pb-2 pl-4 pr-2 space-y-1">
                  {filteredContracts.length === 0 ? (
                    <p className="px-3 py-6 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-center">
                      {contracts.length === 0
                        ? 'Nenhum contrato neste sindicato.'
                        : 'Nenhum contrato corresponde à busca.'}
                    </p>
                  ) : (
                    <>
                      {/* Select-all row */}
                      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-brand-border/10 mb-1">
                        <input
                          id="loan-select-all"
                          type="checkbox"
                          aria-label="Selecionar todos os contratos"
                          checked={filteredContracts.length > 0 && filteredContracts.every((c) => selectedContractIds.has(c.id))}
                          onChange={toggleSelectAll}
                          className="accent-brand-border w-3.5 h-3.5 shrink-0 cursor-pointer"
                        />
                        <label htmlFor="loan-select-all" className="text-[9px] font-bold uppercase tracking-widest opacity-50 cursor-pointer select-none">
                          Selecionar tudo ({filteredContracts.length})
                        </label>
                      </div>

                      {filteredContracts.map((contract) => {
                        const isActive = contract.id === selectedId;
                        const isChecked = selectedContractIds.has(contract.id);
                        return (
                          <div
                            key={contract.id}
                            className={cn(
                              'flex items-center gap-2 border transition-all',
                              isActive
                                ? 'border-brand-border bg-brand-border text-brand-bg shadow-[2px_2px_0_0_rgba(0,0,0,0.15)]'
                                : 'border-brand-border/15 bg-white hover:border-brand-border/50 hover:bg-brand-sidebar/20',
                              isChecked && !isActive && 'border-brand-border/50 bg-brand-sidebar/10',
                            )}
                          >
                            {/* Checkbox — stops propagation so clicking it doesn't open the contract */}
                            <div
                              className="pl-3 py-2.5 flex items-center shrink-0"
                              onClick={(e) => { e.stopPropagation(); toggleSelectContract(contract.id); }}
                            >
                              <input
                                type="checkbox"
                                aria-label={`Selecionar contrato ${contract.contractNumber}`}
                                checked={isChecked}
                                onChange={() => toggleSelectContract(contract.id)}
                                className="accent-brand-border w-3.5 h-3.5 cursor-pointer"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>

                            {/* Row button to open */}
                            <button
                              type="button"
                              onClick={() => openContract(contract.id)}
                              className="flex items-center gap-3 pr-3 py-2.5 text-left flex-1 min-w-0"
                            >
                              <span
                                className={cn(
                                  'w-7 h-7 border flex items-center justify-center text-[10px] font-black shrink-0',
                                  isActive ? 'border-brand-bg/30 bg-brand-bg/10' : 'border-brand-border/40',
                                )}
                              >
                                $
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="text-[11px] font-mono font-bold truncate">{contract.contractNumber}</p>
                                <p
                                  className={cn(
                                    'text-[9px] uppercase tracking-wide truncate',
                                    isActive ? 'opacity-80' : 'opacity-50',
                                  )}
                                >
                                  {contract.type} · {formatCurrency(contract.principal)}
                                </p>
                              </div>
                              <span
                                className={cn(
                                  'text-[8px] font-black uppercase px-1.5 py-0.5 border shrink-0',
                                  isActive
                                    ? 'border-brand-bg/30 bg-brand-bg/10'
                                    : 'border-brand-border/30 opacity-60',
                                )}
                              >
                                Abrir
                              </span>
                            </button>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="lg:col-span-4 space-y-6">
        <div className="technical-panel p-5 shadow-[4px_4px_0_0_#141414] space-y-3">
          <h4 className="text-[10px] font-black uppercase tracking-widest">Ações rápidas</h4>
          <button type="button" onClick={onCreate} className="technical-button-primary w-full flex items-center justify-center gap-2">
            <Plus size={14} />
            NOVO CONTRATO
          </button>
          {contracts.length > 0 ? (
            <>
              <button
                type="button"
                onClick={() => handleExportSelecionadosDominioTXT(Array.from(selectedContractIds), openModal)}
                disabled={selectedContractIds.size === 0}
                className="technical-button-primary w-full flex items-center justify-center gap-2 disabled:opacity-40"
              >
                <Download size={14} />
                EXPORTAR DOMÍNIO (TXT)
                {selectedContractIds.size > 0 && (
                  <span className="ml-1 bg-white/20 text-[9px] font-black px-1.5 py-0.5">
                    {selectedContractIds.size}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={clearAll}
                className="technical-button w-full flex items-center justify-center gap-2 border-red-800 text-red-800 hover:bg-red-800 hover:text-white"
              >
                <Trash2 size={14} />
                LIMPAR SINDICATO
              </button>
            </>
          ) : null}
        </div>
        {showImportBox ? (
          <Suspense
            fallback={
              <div className="border border-brand-border p-3 text-[9px] font-mono opacity-50">
                Carregando importação…
              </div>
            }
          >
            <DataIngestionBox
              dataType="loans"
              title="Processar Contratos Externos"
              onImport={(newItems) => {
                importLoanContracts(newItems as LoanContract[]);
                if (newItems.length > 0) {
                  openContract((newItems[0] as LoanContract).id);
                }
              }}
            />
          </Suspense>
        ) : (
          <button
            type="button"
            className="technical-button w-full text-[10px] font-bold uppercase"
            onClick={() => setShowImportBox(true)}
          >
            Importar contratos externos
          </button>
        )}
      </div>
    </div>
  );

  const renderSimulacaoTab = () => {
    if (!activeContract) {
      return (
        <div className="technical-panel p-16 shadow-[4px_4px_0_0_#141414] text-center space-y-4 bg-brand-sidebar/5">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
            Selecione um contrato na aba Contratos
          </p>
          <button type="button" onClick={() => setLoanMainTab('contratos')} className="technical-button-primary">
            IR PARA CONTRATOS
          </button>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="technical-panel px-4 py-3 shadow-[2px_2px_0_0_#141414] flex flex-wrap items-center justify-between gap-3 bg-brand-sidebar/20">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[9px] font-black uppercase tracking-widest opacity-50">Contrato em edição</p>
              <LoanAmortizationInfoHint />
            </div>
            <p className="text-sm font-mono font-bold truncate">{activeContract.contractNumber}</p>
            <p className="text-[10px] uppercase opacity-60 truncate">{activeContract.companyName}</p>
          </div>
          <button type="button" onClick={() => setLoanMainTab('contratos')} className="technical-button text-[10px]">
            TROCAR CONTRATO
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left settings */}
          <div className="lg:col-span-4 space-y-6 min-w-0">
            {activeContract && (
              <div className="technical-panel p-6 shadow-[4px_4px_0_0_#141414] space-y-6 min-w-0 overflow-hidden">
                <div className="flex items-center justify-between border-b border-brand-border/20 pb-2">
                  <h3 className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                    <div className="w-2 h-2 bg-brand-border animate-pulse"></div>
                    CONTRATO ATIVO
                  </h3>
                  <div className="flex gap-1.5">
                    <button
                      onClick={handleDuplicate}
                      title="Duplicar"
                      className="p-1 hover:bg-brand-base border border-transparent hover:border-brand-border transition-all"
                    >
                      <Copy size={12} />
                    </button>
                    <button
                      onClick={handleDelete}
                      title="Excluir"
                      className="p-1 text-red-600 hover:bg-red-50 border border-transparent transition-all"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                <div className={CF_FORM_FIELDS}>
                  <div className={CF_FIELD_COL}>
                    <label className={CF_LABEL}>Empresa</label>
                    <div className="max-w-[14rem] px-2 py-1 bg-brand-sidebar/10 border border-brand-border/40 font-bold text-[11px] uppercase truncate">
                      {selectedCompany}
                    </div>
                  </div>

                  <div className={CF_FIELD_COL_GROW}>
                    <label className={CF_LABEL}>Número do Contrato</label>
                    <input
                      aria-label="Número do Contrato"
                      type="text"
                      value={activeContract.contractNumber}
                      onChange={(e) => handleUpdate({ contractNumber: e.target.value })}
                      className={CF_LOAN_INPUT_MED}
                      placeholder="Nº CONTRATO"
                    />
                    <label className={`${CF_LABEL} mt-2`}>Nome do Banco</label>
                    <input
                      aria-label="Nome do Banco"
                      type="text"
                      value={activeContract.bankName}
                      onChange={(e) => handleUpdate({ bankName: e.target.value })}
                      className={CF_LOAN_INPUT_MED}
                      placeholder="Ex.: Banco do Brasil"
                    />
                  </div>

                  <div className={CF_FIELD_COL}>
                    <label className={CF_LABEL}>Amortização</label>
                    <div className="inline-flex border border-brand-border overflow-hidden">
                      {['PRICE', 'SAC'].map(t => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => handleUpdate({ type: t as LoanContract['type'] })}
                          className={`px-4 py-1.5 text-[9px] font-bold transition-all ${activeContract.type === t ? 'bg-brand-border text-brand-bg' : 'bg-transparent text-brand-text/60 hover:bg-brand-border/5'
                            }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className={CF_FIELD_INLINE}>
                    <div className={CF_FIELD_COL}>
                      <label className={CF_LABEL}>Principal (R$)</label>
                      <FreeNumericInput
                        aria-label="Principal em reais"
                        value={activeContract.principal}
                        onChange={(principal) => handleUpdate({ principal })}
                        className={CF_LOAN_INPUT_MONEY}
                      />
                    </div>
                    <div className={CF_FIELD_COL}>
                      <label className={CF_LABEL}>Parcelas</label>
                      <FreeNumericInput
                        inputMode="numeric"
                        aria-label="Quantidade de parcelas"
                        value={activeContract.installments}
                        displayDecimals={0}
                        onChange={(installments) => handleUpdate({ installments })}
                        className={CF_LOAN_INPUT_NUM}
                      />
                    </div>
                  </div>

                  {/* Indexador variável: CDI, SELIC, PRONAMPE ou taxa fixa */}
                  {activeTab && (
                    <div className={CF_FIELD_COL}>
                      <label className={CF_LABEL}>Indexador</label>
                      <select
                        aria-label="Indexador do contrato"
                        value={activeTab.varMode}
                        onChange={(e) =>
                          patchActiveSimTab({ varMode: e.target.value as SimVarMode })
                        }
                        className={CF_LOAN_SELECT}
                      >
                        {SIM_VAR_MODE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* PRICE + indexador variável: escolher se recalcula PMT ou mantém PMT fixa */}
                  {activeTab &&
                    activeTab.system === 'PRICE' &&
                    usesSpreadPlusIndexador(activeTab.varMode) && (
                    <div className={CF_FIELD_COL}>
                      <label className={CF_LABEL}>Parcela PRICE com indexador variável</label>
                      <select
                        aria-label="Comportamento da parcela PRICE com taxa variável"
                        value={activeTab.priceSelicAdjustment}
                        onChange={(e) =>
                          patchActiveSimTab({
                            priceSelicAdjustment: e.target.value as SimTabFields['priceSelicAdjustment'],
                          })
                        }
                        className={CF_LOAN_SELECT}
                      >
                        <option value="recalculo_pmt">PARCELAS VARIÁVEIS (recalcula PMT a cada mês)</option>
                        <option value="pmt_fixo">PARCELAS FIXAS (PMT fixa, ignora variação do índice)</option>
                      </select>
                      <p className={CF_FIELD_HINT}>
                        {activeTab.priceSelicAdjustment === 'pmt_fixo'
                          ? 'PMT calculada uma única vez na contratação — parcelas iguais durante todo o contrato.'
                          : 'PMT recalculada a cada competência com o índice real do BCB — parcelas variam conforme o índice.'}
                      </p>
                    </div>
                  )}

                  {activeTab?.varMode === 'custom' && (
                    <div className={CF_FIELD_COL}>
                      <label className={CF_LABEL}>Taxa do indexador fixo % a.m.</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label="Taxa mensal do indexador fixo"
                        value={activeTab.customVarRateStr}
                        onChange={(e) =>
                          patchActiveSimTab({ customVarRateStr: e.target.value })
                        }
                        placeholder="0,50"
                        className={CF_LOAN_INPUT_PCT}
                      />
                    </div>
                  )}

                  <div className={CF_FIELD_COL}>
                    <label className={CF_LABEL}>
                      {activeTab && usesSpreadPlusIndexador(activeTab.varMode)
                        ? `Spread Mensal Carência % (+ ${spreadIndexadorShortLabel(activeTab.varMode)})`
                        : 'Taxa Mensal Carência %'}
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label="Spread ou taxa mensal na carência"
                      value={graceInterestRateStr}
                      onChange={(e) => handleUpdateGraceInterestRate(e.target.value)}
                      placeholder={
                        activeTab && usesSpreadPlusIndexador(activeTab.varMode) ? '0,30' : '1,02'
                      }
                      className={CF_LOAN_INPUT_PCT}
                    />
                  </div>
                  <div className={CF_FIELD_COL}>
                    <label className={CF_LABEL}>
                      {activeTab && usesSpreadPlusIndexador(activeTab.varMode)
                        ? `Spread Mensal s/ Carência % (+ ${spreadIndexadorShortLabel(activeTab.varMode)})`
                        : 'Taxa Mensal s/ Carência %'}
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label="Spread ou taxa mensal sem carência"
                      value={interestRateStr}
                      onChange={(e) => handleUpdateInterestRate(e.target.value)}
                      placeholder={
                        activeTab && usesSpreadPlusIndexador(activeTab.varMode) ? '0,30' : '1,02'
                      }
                      className={CF_LOAN_INPUT_PCT}
                    />
                  </div>

                  <div className={CF_FIELD_COL}>
                    <label className={CF_LABEL}>Data do contrato</label>
                    <input
                      type="date"
                      aria-label="Data do contrato"
                      value={activeContract.startDate?.slice(0, 10) ?? ''}
                      onChange={(e) => handleUpdate({ startDate: e.target.value })}
                      className={CF_LOAN_INPUT_DATE}
                    />
                  </div>
                  <div className={CF_FIELD_COL}>
                    <label className={CF_LABEL}>Carência (Meses)</label>
                    <FreeNumericInput
                      inputMode="numeric"
                      aria-label="Carência em meses"
                      value={activeContract.gracePeriod}
                      commitWhileFocused
                      displayDecimals={0}
                      onChange={(gracePeriod) =>
                        handleUpdate({ gracePeriod: Math.max(0, gracePeriod) })
                      }
                      className={CF_LOAN_INPUT_NUM}
                    />
                  </div>
                  {activeContract.gracePeriod > 0 && (
                    <div className={CF_FIELD_COL}>
                      <label className={CF_LABEL}>Juros na carência</label>
                      <select
                        aria-label="Juros na carência: pagar mensalmente ou capitalizar"
                        value={activeContract.graceType}
                        onChange={(e) =>
                          handleUpdate({ graceType: e.target.value as LoanContract['graceType'] })
                        }
                        className={CF_LOAN_SELECT}
                      >
                        <option value="paid">PAGAR JUROS MENSALMENTE</option>
                        <option value="capitalized">CAPITALIZAR NO PRINCIPAL</option>
                      </select>
                      <p className={CF_FIELD_HINT}>
                        Capitalizar: sem parcela na carência (juros entram no saldo). Pagar: parcela só com juros.
                      </p>
                    </div>
                  )}

                  {/* Ajustes por Mês (Inadimplência / Pagamento Extra) */}
                  <div className="pt-4 border-t border-brand-border/20 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 bg-amber-600 inline-block"></span>
                        Ajustes por Mês (Inadimplência / Extra)
                      </h4>
                      {activeContract.monthlyAdjustments && Object.keys(activeContract.monthlyAdjustments).length > 0 && (
                        <button
                          type="button"
                          onClick={handleClearMonthlyAdjustments}
                          className="text-[8px] font-bold uppercase text-red-600 hover:underline"
                        >
                          Limpar Ajustes
                        </button>
                      )}
                    </div>

                    <p className="text-[9px] text-slate-500 leading-relaxed">
                      Marque os meses que não foram pagos (recalcula o saldo acumulando juros), informe juros a mais ou juros a menos e faça adiantamento (reduz saldo de longo prazo primeiro). Para pagamento atrasado, informe o valor pago: o sistema reclassifica apenas o montante efetivamente quitado para o curto prazo e mantém o saldo restante em atraso.
                    </p>

                    {(() => {
                      const selectedRow = adjustmentMonthYear
                        ? rawSchedule.find((r) => {
                            if (r.month <= 0) return false;
                            const rd = r.competenceDate instanceof Date
                              ? r.competenceDate
                              : r.accrualStartDate instanceof Date
                                ? r.accrualStartDate
                                : r.date instanceof Date
                                  ? r.date
                                  : new Date(r.date);
                            return format(rd, 'dd/MM/yyyy') === adjustmentMonthYear;
                          })
                        : undefined;
                      const parcelaDoMes = (() => {
                        if (!selectedRow) return 0;
                        // Remove o ajuste de juros já aplicado para mostrar a parcela base (sem o ajuste existente),
                        // evitando que a diferença seja 0 após um ajuste já registrado.
                        const existingAdj = selectedRow.interestAdjustment ?? 0;
                        // Parcela pode ter sido zerada pelo calculador em meses não pagos —
                        // reconstrói do mesmo jeito que displayInstallment() na tabela.
                        if (selectedRow.isUnpaid && selectedRow.expectedAmortization != null) {
                          const expected = selectedRow.expectedAmortization + (selectedRow.interest ?? 0) - existingAdj + (selectedRow.monthlyCost ?? 0);
                          return expected >= 0.005 ? expected : 0;
                        }
                        if (selectedRow.installment && selectedRow.installment >= 0.005) return selectedRow.installment - existingAdj;
                        const graceType = activeContract?.graceType ?? 'capitalized';
                        if (selectedRow.isGrace) {
                          // Para carência paga OU capitalizada: usa os juros base (sem ajuste existente)
                          // como referência do "valor da parcela", para que o usuário possa comparar.
                          const composite = (selectedRow.interest ?? 0) - existingAdj + (selectedRow.monthlyCost ?? 0);
                          return composite >= 0.005 ? composite : 0;
                        }
                        const composite = (selectedRow.amortization ?? 0) + (selectedRow.interest ?? 0) - existingAdj + (selectedRow.monthlyCost ?? 0);
                        return composite >= 0.005 ? composite : 0;
                      })();
                      const valorRealNum = parseFloat(difJurosValorReal.replace(/\./g, '').replace(',', '.'));
                      const difJurosDiferenca = !isNaN(valorRealNum) ? valorRealNum - parcelaDoMes : null;

                      return (
                        <div className="space-y-2">
                          {/* Linha 1: Data + Ação + Botão Aplicar */}
                          <div className="grid grid-cols-12 gap-2 bg-brand-sidebar/10 p-2.5 border border-brand-border/30 rounded text-[10px]">
                            {/* Data do sistema */}
                            <div className="col-span-4">
                              <label className="text-[8px] font-bold uppercase block text-slate-500 mb-0.5">Data do sistema</label>
                              <select
                                value={adjustmentMonthYear}
                                onChange={(e) => {
                                  setAdjustmentMonthYear(e.target.value);
                                  setDifJurosValorReal('');
                                }}
                                className="w-full h-10 px-3 border border-slate-300 rounded bg-white text-left font-mono text-slate-900"
                              >
                                <option value="">Selecione</option>
                                {filteredScheduleDateOptions.map((value) => (
                                  <option key={value} value={value}>
                                    {value}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {/* Ação */}
                            <div className="col-span-4">
                              <label className="text-[8px] font-bold uppercase block text-slate-500 mb-0.5">Ação</label>
                              <select
                                value={adjustmentAction}
                                onChange={(e) => {
                                  setAdjustmentAction(e.target.value as typeof adjustmentAction);
                                  setAdjustmentValue('');
                                  setDifJurosValorReal('');
                                }}
                                className="w-full h-10 px-3 border border-slate-300 rounded bg-white text-slate-900"
                              >
                                <option value="">— Selecione —</option>
                                <option value="nao_pago">Não Pago</option>
                                <option value="atrasado_pago">Pagamento Atrasado (parcial / total)</option>
                                <option value="var_monetaria">Ajustes</option>
                                <option value="adiantado">Adiantado</option>
                              </select>
                            </div>
                            {/* Valor (apenas adiantado) */}
                            {adjustmentAction === 'adiantado' && (
                              <div className="col-span-2">
                                <label className="text-[8px] font-bold uppercase block text-slate-500 mb-0.5">Valor Pago (R$)</label>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  placeholder="0,00"
                                  value={adjustmentValue}
                                  onChange={(e) => setAdjustmentValue(e.target.value)}
                                  className="w-full h-10 px-3 border border-slate-300 rounded font-mono text-right"
                                />
                              </div>
                            )}
                          {/* Botão Aplicar (não aparece para atrasado_pago — tem seu próprio botão abaixo) */}
                          <div className={cn('flex items-end', adjustmentAction === 'adiantado' ? 'col-span-2' : 'col-span-4')}>
                            {adjustmentAction !== 'atrasado_pago' && (
                              <button
                                type="button"
                                onClick={() => {
                                  const month = findScheduleMonthByDateKey(adjustmentMonthYear);
                                  if (!month || !adjustmentAction) return;
                                  if (adjustmentAction === 'nao_pago') {
                                    handleToggleUnpaidMonth(month);
                                  } else if (adjustmentAction === 'var_monetaria') {
                                    if (difJurosDiferenca === null || difJurosDiferenca === 0) return;
                                    handleSetInterestAdjustmentMonth(month, difJurosDiferenca);
                                    setDifJurosValorReal('');
                                  } else if (adjustmentAction === 'adiantado') {
                                    const val = parseFloat(adjustmentValue.replace(/\./g, '').replace(',', '.'));
                                    if (isNaN(val) || val === 0) return;
                                    handleSetPrepaymentAmountMonth(month, val);
                                    setAdjustmentValue('');
                                  }
                                }}
                                className="w-full h-10 px-3 text-[9px] font-bold uppercase rounded border transition-all bg-slate-700 text-white border-slate-800 hover:bg-slate-900 disabled:opacity-40"
                                disabled={!adjustmentMonthYear || !adjustmentAction}
                              >
                                Aplicar
                              </button>
                            )}
                            </div>
                          </div>

                          {/* ── Painel de Quitação de Parcelas Atrasadas ── */}
                          {adjustmentAction === 'atrasado_pago' && (() => {
                            const unpaidRows = rawSchedule.filter(
                              (r) => r.month > 0 && r.isUnpaid && !(activeContract.monthlyAdjustments?.[r.month]?.paymentAmount! > 0)
                            );
                            if (unpaidRows.length === 0) {
                              return (
                                <div className="col-span-12 mt-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded text-[9px] text-slate-500 italic">
                                  Nenhuma parcela marcada como não paga.
                                </div>
                              );
                            }
                            const allSelected = unpaidRows.every((r) => selectedOverdueMonths.has(r.month));
                            const totalSelecionado = unpaidRows
                              .filter((r) => selectedOverdueMonths.has(r.month))
                              .reduce((acc, r) => acc + (r.unpaidAmount ?? 0), 0);
                            return (
                              <div className="col-span-12 mt-2 border border-orange-300 rounded bg-orange-50">
                                <div className="flex items-center justify-between px-3 py-2 border-b border-orange-200 bg-orange-100/60">
                                  <span className="text-[9px] font-bold uppercase text-orange-800 tracking-wide">
                                    Parcelas Não Pagas — Selecione para Quitar
                                  </span>
                                  <label className="flex items-center gap-1.5 text-[8px] font-bold uppercase text-orange-700 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={allSelected && unpaidRows.length > 0}
                                      onChange={() => {
                                        if (allSelected) {
                                          setSelectedOverdueMonths(new Set());
                                        } else {
                                          setSelectedOverdueMonths(new Set(unpaidRows.map((r) => r.month)));
                                        }
                                      }}
                                    />
                                    Selecionar todas
                                  </label>
                                </div>
                                <div className="divide-y divide-orange-200">
                                  {unpaidRows.map((r) => {
                                    const checked = selectedOverdueMonths.has(r.month);
                                    const dateObj = r.date instanceof Date ? r.date : new Date(r.date);
                                    const dateLabel = isValid(dateObj) ? format(dateObj, 'MM/yyyy') : `Mês ${r.month}`;
                                    const valor = r.unpaidAmount ?? 0;
                                    return (
                                      <label
                                        key={r.month}
                                        className={cn(
                                          'flex items-center gap-3 px-3 py-2 cursor-pointer text-[9px] font-mono transition-colors',
                                          checked ? 'bg-orange-100' : 'hover:bg-orange-50/60',
                                        )}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={() => {
                                            const next = new Set(selectedOverdueMonths);
                                            if (checked) next.delete(r.month); else next.add(r.month);
                                            setSelectedOverdueMonths(next);
                                          }}
                                        />
                                        <span className="flex-1 font-bold text-orange-900">
                                          Parcela {r.month} — {dateLabel}
                                        </span>
                                        <span className="text-orange-700 font-bold">
                                          {valor > 0 ? formatCurrency(valor) : '—'}
                                        </span>
                                      </label>
                                    );
                                  })}
                                </div>
                                {selectedOverdueMonths.size > 0 && (
                                  <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-orange-300 bg-orange-100/60">
                                    <span className="text-[9px] font-bold text-orange-900">
                                      Total a quitar: <span className="font-mono">{formatCurrency(totalSelecionado)}</span>
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        for (const month of selectedOverdueMonths) {
                                          const row = rawSchedule.find((r) => r.month === month);
                                          const val = row?.unpaidAmount ?? 0;
                                          if (val > 0) handleSetAtrasadoPagoMonth(month, val);
                                        }
                                        setSelectedOverdueMonths(new Set());
                                      }}
                                      className="px-4 py-1.5 text-[9px] font-bold uppercase rounded border bg-orange-600 text-white border-orange-700 hover:bg-orange-700 transition-all"
                                    >
                                      Quitar {selectedOverdueMonths.size} parcela(s)
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })()}

                          {/* Linha 2: Três containers de Ajustes */}
                          {adjustmentAction === 'var_monetaria' && (
                            <div className="grid grid-cols-3 gap-2">
                              {/* Container 1: Valor da parcela (readonly) */}
                              <div className="bg-slate-50 border border-slate-200 rounded p-2.5">
                                <label className="text-[8px] font-bold uppercase block text-slate-500 mb-1">Valor da parcela</label>
                                <div className="h-10 px-3 flex items-center border border-slate-200 rounded bg-white font-mono text-right text-slate-700 text-[11px]">
                                  {parcelaDoMes > 0 ? formatCurrency(parcelaDoMes) : '—'}
                                </div>
                              </div>
                              {/* Container 2: Valor real pago (editável) */}
                              <div className="bg-slate-50 border border-slate-200 rounded p-2.5">
                                <label className="text-[8px] font-bold uppercase block text-slate-500 mb-1">Valor real pago</label>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  placeholder="0,00"
                                  value={difJurosValorReal}
                                  onChange={(e) => setDifJurosValorReal(e.target.value)}
                                  className="w-full h-10 px-3 border border-slate-300 rounded font-mono text-right text-[11px]"
                                />
                              </div>
                              {/* Container 3: Diferença (readonly) */}
                              <div className="bg-slate-50 border border-slate-200 rounded p-2.5">
                                <label className="text-[8px] font-bold uppercase block text-slate-500 mb-1">
                                  {difJurosDiferenca == null
                                    ? 'Ajustes'
                                    : difJurosDiferenca > 0
                                      ? 'AJUSTES DE JUROS POSITIVOS'
                                      : 'AJUSTES DE JUROS NEGATIVO'}
                                </label>
                                <div className="h-10 px-3 flex items-center border border-slate-200 rounded bg-white font-mono text-right text-[11px] font-bold text-slate-700">
                                  {difJurosDiferenca === null
                                    ? '—'
                                    : difJurosDiferenca > 0
                                      ? `+ ${formatCurrency(difJurosDiferenca)}`
                                      : difJurosDiferenca < 0
                                        ? `- ${formatCurrency(Math.abs(difJurosDiferenca))}`
                                        : '0'}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Lista de Ajustes Registrados - Container Próprio */}
                    {(() => {
                      // Expande cada mês em linhas individuais por tipo de ajuste
                      type AdjRow =
                        | { kind: 'nao_pago'; m: number; dateStr: string; fullDateStr: string }
                        | { kind: 'var_monetaria'; m: number; dateStr: string; fullDateStr: string; value: number }
                        | { kind: 'adiantado'; m: number; dateStr: string; fullDateStr: string; value: number }
                        | { kind: 'atrasado_pago'; m: number; dateStr: string; fullDateStr: string; value: number };

                      const allRows: AdjRow[] = [];
                      for (const [mStr, adj] of Object.entries(activeContract.monthlyAdjustments ?? {})) {
                        const m = parseInt(mStr, 10);
                        const scheduleRow = rawSchedule.find((row) => row.month === m);
                        const dateObj = scheduleRow?.date ? (scheduleRow.date instanceof Date ? scheduleRow.date : new Date(scheduleRow.date)) : null;
                        const dateStr = dateObj ? format(dateObj, 'MM/yyyy') : `Mês ${m}`;
                        const fullDateStr = dateObj ? format(dateObj, 'dd/MM/yyyy') : '';
                        if (adj.unpaid && !adj.paymentAmount) allRows.push({ kind: 'nao_pago', m, dateStr, fullDateStr });
                        if (adj.unpaid && adj.paymentAmount != null && adj.paymentAmount > 0) allRows.push({ kind: 'atrasado_pago', m, dateStr, fullDateStr, value: adj.paymentAmount });
                        if (adj.interestAdjustment != null && adj.interestAdjustment !== 0) allRows.push({ kind: 'var_monetaria', m, dateStr, fullDateStr, value: adj.interestAdjustment });
                        if (adj.prepaymentAmount != null && adj.prepaymentAmount > 0) allRows.push({ kind: 'adiantado', m, dateStr, fullDateStr, value: adj.prepaymentAmount });
                      }

                      // Filtra pelo tipo selecionado no campo Ação (quando há um selecionado)
                      const filteredByAction = allRows.filter((row) => {
                        if (!adjustmentAction) return true;
                        if (adjustmentAction === 'nao_pago') return row.kind === 'nao_pago';
                        if (adjustmentAction === 'atrasado_pago') return row.kind === 'atrasado_pago';
                        if (adjustmentAction === 'var_monetaria') return row.kind === 'var_monetaria';
                        if (adjustmentAction === 'adiantado') return row.kind === 'adiantado';
                        return true;
                      });

                      // Filtra pela busca de texto
                      const searchTerm = adjustmentsSearch.trim();
                      const visibleRows = filteredByAction.filter((row) => {
                        if (!searchTerm) return true;
                        if (row.dateStr.includes(searchTerm) || row.fullDateStr.includes(searchTerm)) return true;
                        if (row.kind !== 'nao_pago' && formatCurrencyInput(Math.abs(row.value)).includes(searchTerm)) return true;
                        return false;
                      });

                      if (visibleRows.length === 0) {
                        return <p className="text-[8px] text-slate-400 italic mt-2">Nenhuma ocorrência registrada para este contrato.</p>;
                      }

                      return (
                        <div className="border border-slate-300 rounded-lg bg-white mt-4">
                          {/* Header com Título e Busca */}
                          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
                            <div className="flex items-center justify-between gap-3 mb-3">
                              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-700">
                                Ajustes Registrados ({visibleRows.length})
                              </span>
                            </div>
                            <input
                              type="text"
                              placeholder="Pesquisar por data (MM/YYYY) ou valor (R$)..."
                              value={adjustmentsSearch}
                              onChange={(e) => setAdjustmentsSearch(e.target.value.toLowerCase())}
                              className="w-full h-8 px-3 border border-slate-300 rounded text-[9px] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>

                          {/* Lista com Scroll */}
                          <div className="max-h-[280px] overflow-y-auto">
                            <div className="space-y-2 p-3">
                              {visibleRows.map((row, idx) => {
                                if (row.kind === 'nao_pago') {
                                  return (
                                    <div key={`${row.m}-nao_pago-${idx}`} className="flex items-center justify-between gap-2 px-3 py-2 rounded border text-[9px] font-mono bg-red-50 border-red-200 text-red-800">
                                      <div className="flex-1 min-w-0">
                                        <div className="font-bold mb-1">{row.dateStr}</div>
                                        <span className="inline-block bg-red-600 text-white px-1.5 py-0.5 rounded text-[7px] uppercase font-sans">Não Pago</span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => handleToggleUnpaidMonth(row.m)}
                                        className="shrink-0 w-6 h-6 flex items-center justify-center text-slate-400 hover:text-red-600 font-bold hover:bg-red-100 rounded"
                                        title="Remover Não Pago"
                                      >×</button>
                                    </div>
                                  );
                                }
                                if (row.kind === 'var_monetaria') {
                                  return (
                                    <div key={`${row.m}-var_monetaria-${idx}`} className={cn('flex items-center justify-between gap-2 px-3 py-2 rounded border text-[9px] font-mono', row.value > 0 ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-blue-50 border-blue-200 text-blue-800')}>
                                      <div className="flex-1 min-w-0">
                                        <div className="font-bold mb-1">{row.dateStr}</div>
                                        <span className={cn('inline-block px-1.5 py-0.5 rounded text-[7px] uppercase font-sans', row.value > 0 ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800')}>
                                          {row.value > 0 ? 'AJUSTES DE JUROS POSITIVOS' : 'AJUSTES DE JUROS NEGATIVO'} {row.value > 0 ? '+' : '-'} R$ {formatCurrencyInput(Math.abs(row.value))}
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => handleSetInterestAdjustmentMonth(row.m, 0)}
                                        className="shrink-0 w-6 h-6 flex items-center justify-center text-slate-400 hover:text-red-600 font-bold hover:bg-red-100 rounded"
                                        title="Remover Ajuste"
                                      >×</button>
                                    </div>
                                  );
                                }
                                if (row.kind === 'adiantado') {
                                  return (
                                    <div key={`${row.m}-adiantado-${idx}`} className="flex items-center justify-between gap-2 px-3 py-2 rounded border text-[9px] font-mono bg-sky-50 border-sky-200 text-sky-800">
                                      <div className="flex-1 min-w-0">
                                        <div className="font-bold mb-1">{row.dateStr}</div>
                                        <span className="inline-block bg-sky-100 text-sky-800 px-1.5 py-0.5 rounded text-[7px] uppercase font-sans">
                                          Adiantado R$ {formatCurrencyInput(row.value)}
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => handleSetPrepaymentAmountMonth(row.m, 0)}
                                        className="shrink-0 w-6 h-6 flex items-center justify-center text-slate-400 hover:text-red-600 font-bold hover:bg-red-100 rounded"
                                        title="Remover Adiantado"
                                      >×</button>
                                    </div>
                                  );
                                }
                                if (row.kind === 'atrasado_pago') {
                                  return (
                                    <div key={`${row.m}-atrasado_pago-${idx}`} className="flex items-center justify-between gap-2 px-3 py-2 rounded border text-[9px] font-mono bg-orange-50 border-orange-300 text-orange-900">
                                      <div className="flex-1 min-w-0">
                                        <div className="font-bold mb-1">{row.dateStr}</div>
                                        <span className="inline-block bg-orange-500 text-white px-1.5 py-0.5 rounded text-[7px] uppercase font-sans">
                                          Pgto Atrasado R$ {formatCurrencyInput(row.value)}
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => handleSetAtrasadoPagoMonth(row.m, 0)}
                                        className="shrink-0 w-6 h-6 flex items-center justify-center text-slate-400 hover:text-red-600 font-bold hover:bg-red-100 rounded"
                                        title="Remover Pagamento Atrasado"
                                      >×</button>
                                    </div>
                                  );
                                }
                                return null;
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                </div>
              </div>
            )}

          </div>

          {/* Right Display area (Charts / Data grid) */}
          <div className="lg:col-span-8 space-y-6">
            {/* Ribbon Navigation for Views */}
            <div className="flex border border-brand-border bg-brand-sidebar/30 p-1">
              {(['table', 'chart'] as const).map((view) => (
                <button
                  key={view}
                  onClick={() => setActiveView(view)}
                  className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-all ${activeView === view
                    ? 'bg-brand-border text-brand-bg shadow-[2px_2px_0_0_rgba(0,0,0,0.2)]'
                    : 'text-brand-text/50 hover:text-brand-text'
                    }`}
                >
                  {view === 'table' ? 'Tabela Amortização' : 'Gráfico Evolução'}
                </button>
              ))}
            </div>

            {activeView === 'chart' && (
              <div className="technical-panel p-6 shadow-[4px_4px_0_0_#141414] module-table-viewport min-w-0 flex flex-col">
                <h3 className="text-xs font-black uppercase tracking-widest mb-4 shrink-0">
                  Gráfico de Amortização Visual
                </h3>
                {schedule.length > 0 && !isCalculating ? (
                  <div className="flex-1 min-h-0 w-full min-w-0">
                    <div className="w-full h-full min-h-[320px] min-w-0">
                      <Suspense
                        fallback={
                          <div className="flex h-full min-h-[320px] items-center justify-center text-[10px] font-mono opacity-50">
                            Carregando gráfico…
                          </div>
                        }
                      >
                        <LoanAmortizationChart data={chartData} />
                      </Suspense>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 min-h-[320px] flex items-center justify-center text-[10px] font-bold uppercase text-slate-400">
                    {isCalculating ? 'Recalculando…' : 'Preencha o valor principal para plotar.'}
                  </div>
                )}
              </div>
            )}

            {activeView === 'table' && (
              <div className="space-y-4">
                <div className="technical-panel shadow-[4px_4px_0_0_#141414] overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-brand-border bg-brand-sidebar/30">
                    <div className="flex items-center gap-3">
                      <p className="text-[10px] font-black uppercase tracking-widest">
                        Cronograma completo ({rawSchedule.length} linha(s))
                      </p>
                      {isCalculating ? (
                        <span className="text-[8px] font-bold uppercase tracking-widest text-amber-700 animate-pulse">
                          Recalculando…
                        </span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={handleExportPDF}
                      disabled={!canExport || isCalculating}
                      className="technical-button-primary text-[10px] py-1.5 px-4 disabled:opacity-40"
                    >
                      EXPORTAR PDF
                    </button>
                  </div>
                  {!bcbReadiness.ready &&
                    activeTab &&
                    usesSpreadPlusIndexador(activeTab.varMode) ? (
                    <div className="px-4 py-8 text-center text-[10px] font-bold uppercase text-red-800 bg-red-500/10">
                      {bcbReadiness.message}
                    </div>
                  ) : (
                    <LoanScheduleVirtualTable
                      rows={rawSchedule}
                      columns={scheduleTableColumns}
                      graceType={activeContract.graceType}
                      onTogglePaid={handleTogglePaidMonth}
                      onToggleUnpaid={handleToggleUnpaidMonth}
                      onSetInterestAdjustment={handleSetInterestAdjustmentMonth}
                      onSetPrepayment={handleSetPrepaymentAmountMonth}
                      emptyMessage={
                        activeTab && usesSpreadPlusIndexador(activeTab.varMode) && bcbReadiness.loading
                          ? 'Aguardando séries do Banco Central…'
                          : undefined
                      }
                    />
                  )}
                </div>
                {activeContract && (
                  <div className="bg-brand-border p-6 text-brand-bg shadow-[4px_4px_0_0_#141414] space-y-4">
                    <div className="flex items-center justify-between border-b border-white/20 pb-2">
                      <span className="text-[10px] font-black uppercase tracking-widest text-brand-bg">
                        Resumo Financeiro
                      </span>
                      <span className="text-[9px] font-mono opacity-60 bg-white/10 px-1 py-0.5">
                        {activeContract.type}
                      </span>
                    </div>
                    <div>
                      <h4 className="text-2xl font-black italic tracking-tighter">
                        {isCalculating ? '…' : formatCurrency(scheduleTotals.paymentSum)}
                      </h4>
                      <p className="text-[8px] font-bold uppercase opacity-60 mt-1">
                        {isCalculating
                          ? 'Recalculando cronograma…'
                          : 'Montante Final Calculado (Principal + Custos)'}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-4 pt-2">
                      <div className="bg-white/10 p-2 border border-white/10">
                        <p className="text-[8px] font-bold opacity-60 mb-1 uppercase">Parcela Inicial</p>
                        <p className="text-xs font-mono font-bold tracking-tight">
                          {formatCurrency(scheduleTotals.firstPayment)}
                        </p>
                      </div>
                      <div className="bg-white/10 p-2 border border-white/10">
                        <p className="text-[8px] font-bold opacity-60 mb-1 uppercase">Parcela Final</p>
                        <p className="text-xs font-mono font-bold tracking-tight">
                          {formatCurrency(scheduleTotals.lastPayment)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={cn(embedded ? 'space-y-6 min-w-0' : 'p-8 max-w-7xl mx-auto space-y-8')}>
      {!embedded ? (
        <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-brand-border pb-4 gap-4">
          <div>
            <h1 className="text-2xl font-black tracking-tighter uppercase italic">Simulador de Empréstimos</h1>
            <p className="text-[10px] font-bold uppercase opacity-50 tracking-widest">Motor de Cálculo SAC/PRICE — v4.1</p>
          </div>
        </div>
      ) : null}

      <div className="flex border border-brand-border bg-brand-sidebar/30 p-1 w-fit">
        {loanMainTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setLoanMainTab(tab.id)}
            className={cn(
              'px-6 py-2 text-[10px] font-black uppercase tracking-widest transition-all',
              loanMainTab === tab.id
                ? 'bg-brand-border text-brand-bg shadow-[2px_2px_0_0_rgba(0,0,0,0.2)]'
                : 'text-brand-text/60 hover:bg-brand-border/10',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loanMainTab === 'contratos'
        ? renderContratosTab()
        : loanMainTab === 'simulacao'
          ? renderSimulacaoTab()
          : (
            <LoanContasTab
              selectedCompany={selectedCompany}
              contracts={contracts}
              selectedId={selectedId}
              onSelectContract={(id) => {
                setSelectedId(id);
              }}
              accountFields={loanAccountFields}
              dominioCodigoHistorico={activeTab?.dominioCodigoHistoricoStr ?? ''}
              dominioComplementoHistorico={activeTab?.dominioComplementoHistoricoStr ?? ''}
              dataGerarLancamentosAPartir={activeTab?.dataGerarLancamentosAPartirStr ?? ''}
              dataGerarLancamentosAte={activeTab?.dataGerarLancamentosAteStr ?? ''}
              planoContaOptions={planoContaOptions}
              onPatch={patchActiveSimTab}
            />
          )}

      {/* Modal de confirmação de envio ao balancete */}
      <BalancetePeriodoModal
        isOpen={periodoModalLoanOpen}
        onConfirm={handlePeriodoLoanConfirmado}
        onCancel={() => setPeriodoModalLoanOpen(false)}
      />
      <BalanceteEnvioModal
        isOpen={balancetePreview.open}
        lancamentos={balancetePreview.lancamentos}
        totalContratos={balancetePreview.totalContratos}
        onConfirm={balancetePreview.onConfirm}
        onCancel={() => setBalancetePreview((p) => ({ ...p, open: false }))}
      />
    </div>
  );
}
