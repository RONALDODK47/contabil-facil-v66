import React, { useMemo, useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp, Download, Save, X } from 'lucide-react';
import type { VisionBalanceteRow, VisionPlanoRow } from '../types/accounting';
import type { SavedContract } from '../../lib/savedContractStorage';
import ExtratoContaPicker, { type ExtratoPlanoContaOption } from '../../contabilfacil/components/ExtratoContaPicker';
import { extrairPeriodoRazao } from '../utils/razaoContabil';
import { parseISO } from 'date-fns';
import {
  readAutomatizacaoContaConfig,
  saveAutomatizacaoContaConfig,
  newLancamentoEmprestimoId,
  type AutomacaoLancamentoEmprestimo,
} from '../utils/automatizacaoContaConfig';
import {
  aplicarCorrecaoEmprestimo,
  analisarContasEmprestimo,
  type LoanCorrecaoResumo,
  type LoanLancamentoDetalhe,
} from '../../contabilfacil/logic/loanCorrecaoAutomation';
import {
  lerLoanScheduleBalanceCache,
  saldoTabelaNaData,
  saldoCurtoTabelaNaData,
  saldoLongoTabelaNaData,
} from '../../contabilfacil/logic/loanScheduleBalanceCache';
import { pickSimTabForEditor } from '../../lib/simTabFields';

interface LancamentoEmprestimoEditorProps {
  empresaNome: string;
  planoRows: VisionPlanoRow[];
  contratos?: SavedContract[];
  razaoRows: VisionBalanceteRow[];
  contabil: boolean;
  onRazaoRowsChange?: (rows: VisionBalanceteRow[]) => void;
}

function buildPlanoOptions(planoRows: VisionPlanoRow[]): ExtratoPlanoContaOption[] {
  return planoRows.map((row) => ({
    code: row.codigo,
    name: row.nome || 'CONTA',
    codigoReduzido: row.codigoReduzido,
    tipo: row.tipo,
    nivel: row.nivel,
  }));
}

export default function LancamentoEmprestimoEditor({
  empresaNome,
  planoRows,
  contratos = [],
  razaoRows,
  contabil,
  onRazaoRowsChange,
}: LancamentoEmprestimoEditorProps) {
  const [configs, setConfigs] = useState<AutomacaoLancamentoEmprestimo[]>(
    () => readAutomatizacaoContaConfig(empresaNome).lancamentosEmprestimo ?? [],
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const planoOptions = useMemo(() => buildPlanoOptions(planoRows), [planoRows]);

  const labelTitle = contabil
    ? 'text-[10px] font-black uppercase tracking-widest text-brand-text'
    : 'text-[11px] font-bold text-violet-200';

  const labelHint = contabil
    ? 'text-[9px] font-bold uppercase opacity-50 leading-snug'
    : 'text-[10px] text-slate-500 leading-snug';

  const persist = (updated: AutomacaoLancamentoEmprestimo[]) => {
    setConfigs(updated);
    const current = readAutomatizacaoContaConfig(empresaNome);
    saveAutomatizacaoContaConfig(empresaNome, { ...current, lancamentosEmprestimo: updated });
  };

  const addConfig = () => {
    const novo: AutomacaoLancamentoEmprestimo = {
      id: newLancamentoEmprestimoId(),
      contratoId: contratos[0]?.id ?? '',
    };
    const updated = [...configs, novo];
    persist(updated);
    setExpandedId(novo.id);
  };

  const removeConfig = (id: string) => {
    persist(configs.filter((c) => c.id !== id));
  };

  const updateConfig = (id: string, patch: Partial<AutomacaoLancamentoEmprestimo>) => {
    persist(configs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  return (
    <div className="space-y-3">
      <div>
        <p className={labelTitle}>Correção monetária e redução de juros — empréstimo bancário</p>
        <p className={labelHint + ' mt-2'}>
          O sistema compara o saldo de curto/longo prazo que a automação do empréstimo já lançou (aba
          Empréstimos → Mandar para o balancete) contra o saldo real das mesmas contas no razão — sem
          alterar o lançamento vindo do banco — e lança só a diferença até bater com a tabela do
          empréstimo. Se a parcela do banco for maior que a da tabela e "Reduzir juros" estiver marcado,
          o sistema estorna parte do juros já apropriado revertendo o próprio lançamento original —
          não precisa configurar conta nenhuma para isso.
        </p>
        <p className="text-[9px] text-slate-400 italic mt-2">
          ⚠️ Para usar "Puxar", configure as contas na aba Empréstimos {'->'} Contas primeiro.
        </p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className={labelTitle}>Empréstimos configurados · {configs.length}</span>
        <button
          type="button"
          onClick={addConfig}
          disabled={contratos.length === 0}
          className={
            contabil
              ? 'technical-button text-[10px] inline-flex items-center gap-1 disabled:opacity-40'
              : 'px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 text-[10px] uppercase inline-flex items-center gap-1 disabled:opacity-40'
          }
        >
          <Plus size={14} />
          Adicionar
        </button>
      </div>

      {contratos.length === 0 && (
        <p className="text-[9px] italic opacity-50">
          Nenhum contrato cadastrado na aba de Empréstimos para esta empresa.
        </p>
      )}

      {configs.length === 0 ? (
        <p className="text-[10px] opacity-45 italic text-center py-6">
          Nenhuma configuração adicionada. Clique em "Adicionar" para começar.
        </p>
      ) : (
        <div className="space-y-2">
          {configs.map((config) => (
            <LancamentoEmprestimoRow
              key={config.id}
              config={config}
              planoOptions={planoOptions}
              planoRows={planoRows}
              contratos={contratos}
              razaoRows={razaoRows}
              expanded={expandedId === config.id}
              onToggleExpand={() => setExpandedId(expandedId === config.id ? null : config.id)}
              onUpdate={(patch) => updateConfig(config.id, patch)}
              onRemove={() => removeConfig(config.id)}
              onRazaoRowsChange={onRazaoRowsChange}
              contabil={contabil}
              labelHint={labelHint}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface LancamentoEmprestimoRowProps {
  config: AutomacaoLancamentoEmprestimo;
  planoOptions: ExtratoPlanoContaOption[];
  planoRows: VisionPlanoRow[];
  contratos: SavedContract[];
  razaoRows: VisionBalanceteRow[];
  expanded: boolean;
  onToggleExpand: () => void;
  onUpdate: (patch: Partial<AutomacaoLancamentoEmprestimo>) => void;
  onRemove: () => void;
  onRazaoRowsChange?: (rows: VisionBalanceteRow[]) => void;
  contabil: boolean;
  labelHint: string;
}

function formatMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function ContaReadOnly({ value, label, contabil }: { value: string; label: string; contabil: boolean }) {
  if (!value) {
    return (
      <div className="space-y-1">
        <label className="text-[9px] font-bold uppercase opacity-60 mb-1 block">{label}</label>
        <div className={contabil
          ? "h-[26px] min-h-[26px] flex items-center border border-brand-border bg-brand-sidebar/50 px-2.5 text-[10px] text-brand-text/50 font-mono italic cursor-not-allowed select-none"
          : "border border-slate-700 bg-slate-950 rounded px-3 py-2 text-[9px] text-slate-500 italic"
        }>
          —
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <label className="text-[9px] font-bold uppercase opacity-60 mb-1 block">{label}</label>
      <div className={contabil
        ? "h-[26px] min-h-[26px] flex items-center border border-brand-border bg-brand-sidebar/50 px-2.5 text-[10px] font-mono font-bold text-brand-text/70 cursor-not-allowed select-none"
        : "border border-slate-700 bg-slate-950 rounded px-3 py-2 text-[9px] font-mono font-bold text-white"
      }>
        {value}
      </div>
    </div>
  );
}

function LancamentoEmprestimoRow({
  config,
  planoOptions,
  planoRows,
  contratos,
  razaoRows,
  expanded,
  onToggleExpand,
  onUpdate,
  onRemove,
  onRazaoRowsChange,
  contabil,
  labelHint,
}: LancamentoEmprestimoRowProps) {
  const [resumo, setResumo] = useState<LoanCorrecaoResumo | null>(null);
  const [mensagens, setMensagens] = useState<string[]>([]);
  const [aplicado, setAplicado] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [modalLancamentos, setModalLancamentos] = useState<LoanLancamentoDetalhe[] | null>(null);

  const rowClass = contabil
    ? 'border border-brand-border bg-brand-sidebar/5 p-3 space-y-2'
    : 'border border-slate-700 bg-slate-950/40 rounded p-3 space-y-2';

  const selectClass = contabil
    ? 'w-full px-2 py-1.5 bg-white border border-brand-border text-xs font-mono font-bold focus:outline-none focus:ring-1 focus:ring-brand-border'
    : 'w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white text-xs';

  const btnDangerClass = contabil
    ? 'technical-button text-[9px] py-1 px-2 hover:bg-rose-700/20'
    : 'px-2 py-1 rounded border border-rose-600/50 text-rose-400 text-[9px] uppercase';

  const btnClass = contabil
    ? 'technical-button text-[9px] py-1 px-3'
    : 'px-3 py-1 rounded border border-slate-600 text-slate-300 text-[9px] uppercase';

  const btnPrimaryClass = contabil
    ? 'technical-button-primary text-[9px] py-1 px-3'
    : 'px-3 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-[9px] font-black uppercase';

  const contratoSelecionado = contratos.find((c) => c.id === config.contratoId);
  const displayContrato = contratoSelecionado?.contractNumber || config.contratoId || 'Selecione um contrato';

  const contasDoContrato = useMemo(
    () => (contratoSelecionado ? analisarContasEmprestimo(razaoRows, contratoSelecionado, planoRows) : []),
    [contratoSelecionado, razaoRows, planoRows],
  );

  const rodarCorrecao = () => {
    if (!contratoSelecionado) {
      setMensagens(['Selecione um contrato.']);
      setResumo(null);
      return;
    }
    const cache = lerLoanScheduleBalanceCache(contratoSelecionado.companyName, contratoSelecionado.id);
    const periodo = extrairPeriodoRazao(razaoRows);
    const refDate = periodo.max ? parseISO(periodo.max) : new Date();
    const saldoTabelaEsperado = saldoTabelaNaData(cache, refDate);
    const saldoCurtoEsperado = saldoCurtoTabelaNaData(cache, refDate);
    const saldoLongoEsperado = saldoLongoTabelaNaData(cache, refDate);
    const result = aplicarCorrecaoEmprestimo(
      razaoRows,
      contratoSelecionado,
      planoRows,
      {
        contaContrato: config.contaContrato,
        contaCurto: config.contaCurto,
        contaLongo: config.contaLongo,
        contaCorrecaoMonetaria: config.contaCorrecaoMonetaria,
        contaEstornoJurosAproDebit: config.contaEstornoJurosAproDebit,
        contaEstornoJurosAproCredit: config.contaEstornoJurosAproCredit,
        contaEstornoJurosDebito: config.contaEstornoJurosDebito,
        contaEstornoJurosCredito: config.contaEstornoJurosCredito,
        contaAjusteCredor: config.contaAjusteCredor,
        contaAjusteDevedor: config.contaAjusteDevedor,
      },
      saldoTabelaEsperado,
      saldoCurtoEsperado,
      saldoLongoEsperado,
    );
    setResumo(result.resumo ?? null);
    setMensagens(result.pendencias);
    return result;
  };

  const handleVisualizar = () => {
    setAplicado(false);
    rodarCorrecao();
  };

  const handleAplicar = () => {
    const result = rodarCorrecao();
    if (result?.novaRazao) {
      onRazaoRowsChange?.(result.novaRazao);
      setAplicado(true);
      // Permanece nesta seção e mostra o modal com os lançamentos feitos.
      setModalLancamentos(result.lancamentosDetalhe ?? []);
    }
  };

  const handleSalvar = () => {
    // A configuração já persiste a cada alteração; o botão força uma regravação
    // explícita e dá o feedback visual de salvo.
    onUpdate({});
    setSalvo(true);
    window.setTimeout(() => setSalvo(false), 2500);
  };

  return (
    <div className={rowClass}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase">{displayContrato}</p>
          {config.contaContrato || config.contaCurto || config.contaLongo || config.contaCorrecaoMonetaria || config.contaEstornoJurosAproDebit || config.contaAjusteCredor || config.contaAjusteDevedor ? (
            <p className="text-[9px] opacity-60 mt-1">
              {config.contaContrato && `Contrato: ${config.contaContrato}`}
              {config.contaCurto && ` · Curto: ${config.contaCurto}`}
              {config.contaLongo && ` · Longo: ${config.contaLongo}`}
              {config.contaCorrecaoMonetaria && ` · Correção: ${config.contaCorrecaoMonetaria}`}
              {config.contaAjusteCredor && ` · Aj. Credor: ${config.contaAjusteCredor}`}
              {config.contaAjusteDevedor && ` · Aj. Devedor: ${config.contaAjusteDevedor}`}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onToggleExpand}
          className="p-1 text-slate-400 hover:text-slate-200 transition-colors shrink-0"
          aria-label={expanded ? 'Recolher' : 'Expandir'}
        >
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-slate-700/30 pt-3 space-y-3">
          {/* Contrato Selector */}
          <div className="space-y-1">
            <label className={labelHint}>ID ou número do contrato</label>
            <select
              value={config.contratoId}
              onChange={(e) => onUpdate({ contratoId: e.target.value })}
              className={selectClass}
              aria-label="Selecionar contrato"
            >
              <option value="">— Selecione um contrato —</option>
              {contratos.map((contrato) => (
                <option key={contrato.id} value={contrato.id}>
                  {contrato.contractNumber || contrato.id}
                </option>
              ))}
            </select>
          </div>

          {/* Contas do empréstimo (aba Empréstimos > Contas) — transparência do que será analisado */}
          {contratoSelecionado && (
            <div className="border-t border-slate-700/20 pt-2 space-y-1">
              <p className={labelHint}>Contas do empréstimo (aba Contas do contrato)</p>
              {contasDoContrato.length === 0 ? (
                <p className="text-[9px] italic opacity-50">
                  Nenhuma conta configurada para este contrato — configure na aba Empréstimos &gt; Contas.
                </p>
              ) : (
                <div
                  className={
                    contabil
                      ? 'border border-brand-border bg-brand-bg p-2 text-[9px] font-mono space-y-0.5'
                      : 'border border-slate-700 bg-slate-950/50 rounded p-2 text-[9px] font-mono space-y-0.5'
                  }
                >
                  {contasDoContrato.map((c) => (
                    <p key={c.campo} className={c.incluidoNoSaldoDevedor ? '' : 'opacity-40 line-through'}>
                      {c.codigo} {c.nome && `— ${c.nome}`} ({c.grupo}) — {c.label}: {formatMoeda(c.saldoFinal)}
                      {!c.incluidoNoSaldoDevedor && ' — fora do saldo devedor'}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Puxar contas da aba Empréstimos */}
          <div className="border-t border-slate-700/20 pt-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className={labelHint}>Contas de curto e longo prazo</p>
              <button
                type="button"
                onClick={() => {
                  if (!contratoSelecionado) {
                    setMensagens(['Selecione um contrato primeiro.']);
                    return;
                  }
                  // Puxar contas da aba Contas (Empréstimos > Contas)
                  const updates: Partial<AutomacaoLancamentoEmprestimo> = {};

                  // Acessar as contas a partir da aba ativa do contrato
                  const activeTab = pickSimTabForEditor(contratoSelecionado.formState);

                  // Curto prazo (CREDITA): Transferência LP→CP (Crédito)
                  if (activeTab.accTransferenciaCredit) {
                    updates.contaCurto = activeTab.accTransferenciaCredit;
                  } else if (activeTab.accEmprestimoCredit) {
                    updates.contaCurto = activeTab.accEmprestimoCredit;
                  }

                  // Longo prazo (DÉBITA): Transferência LP→CP (Débito)
                  if (activeTab.accTransferenciaDebit) {
                    updates.contaLongo = activeTab.accTransferenciaDebit;
                  } else if (activeTab.accEmprestimoDebit) {
                    updates.contaLongo = activeTab.accEmprestimoDebit;
                  }

                  // Estorno de Juros Apropriados — usar Apropriação de Juros (débito/crédito)
                  if (activeTab.accApropriacaoDebit) {
                    updates.contaEstornoJurosAproDebit = activeTab.accApropriacaoDebit;
                  }
                  if (activeTab.accApropriacaoCredit) {
                    updates.contaEstornoJurosAproCredit = activeTab.accApropriacaoCredit;
                  }

                  // Reduzir juros — usar Provisão de Juros (débito/crédito)
                  if (activeTab.accJurosAproDebit) {
                    updates.contaEstornoJurosDebito = activeTab.accJurosAproDebit;
                  }
                  if (activeTab.accJurosAproCredit) {
                    updates.contaEstornoJurosCredito = activeTab.accJurosAproCredit;
                  }

                  if (Object.keys(updates).length === 0) {
                    setMensagens(['Nenhuma conta encontrada na aba Contas do contrato. Configure as contas primeiro.']);
                    return;
                  }

                  onUpdate(updates);
                  setMensagens(['✓ Contas carregadas da aba Contas do Empréstimo']);
                }}
                className={
                  contabil
                    ? 'technical-button text-[9px] py-1 px-2 inline-flex items-center gap-1 shrink-0'
                    : 'px-2 py-1 rounded border border-slate-600 text-slate-300 text-[9px] uppercase inline-flex items-center gap-1 shrink-0'
                }
                title="Carregar contas automaticamente da aba Empréstimos"
              >
                <Download size={12} />
                Puxar
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ContaReadOnly value={config.contaCurto || ''} label="Conta Curto Prazo (CREDITA)" contabil={contabil} />
              <ContaReadOnly value={config.contaLongo || ''} label="Conta Longo Prazo (DÉBITA)" contabil={contabil} />
            </div>
          </div>

          {/* Conta de correção monetária */}
          <div className="border-t border-slate-700/20 pt-2 space-y-2">
            <p className={labelHint}>Reduzir empréstimo — contrapartida do ajuste</p>
            <div className="space-y-1">
              <label className={labelHint}>Conta de Correção Monetária</label>
              <ExtratoContaPicker
                value={config.contaCorrecaoMonetaria || ''}
                options={planoOptions}
                includeSinteticas
                showNomeInline
                placeholder="Selecione a conta..."
                ariaLabel="Conta de correção monetária"
                onChange={(code) => onUpdate({ contaCorrecaoMonetaria: code })}
                bgWhite
              />
            </div>
          </div>

          {/* Ajuste de Exercício (Saldos Iniciais) */}
          <div className="border-t border-slate-700/20 pt-2 space-y-2">
            <p className={labelHint}>Ajuste de Exercício (Correção de Saldo Inicial)</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className={labelHint}>Ajuste do Exercício Credor (Conta)</label>
                <ExtratoContaPicker
                  value={config.contaAjusteCredor || ''}
                  options={planoOptions}
                  includeSinteticas
                  showNomeInline
                  placeholder="Selecione a conta..."
                  ariaLabel="Ajuste do Exercício Credor"
                  onChange={(code) => onUpdate({ contaAjusteCredor: code })}
                  bgWhite
                />
              </div>
              <div className="space-y-1">
                <label className={labelHint}>Ajuste do Exercício Devedor (Conta)</label>
                <ExtratoContaPicker
                  value={config.contaAjusteDevedor || ''}
                  options={planoOptions}
                  includeSinteticas
                  showNomeInline
                  placeholder="Selecione a conta..."
                  ariaLabel="Ajuste do Exercício Devedor"
                  onChange={(code) => onUpdate({ contaAjusteDevedor: code })}
                  bgWhite
                />
              </div>
            </div>
            <p className="text-[9px] text-slate-400 italic">
              Lança a diferença de saldo anterior contra estas contas no dia seguinte ao fechamento oficial.
            </p>
          </div>

          {/* Estorno de Juros Apropriados */}
          <div className="border-t border-slate-700/20 pt-2 space-y-2">
            <p className={labelHint}>Estorno de juros apropriados (carregadas via "Puxar")</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ContaReadOnly value={config.contaEstornoJurosAproDebit || ''} label="Débito — Empréstimo" contabil={contabil} />
              <ContaReadOnly value={config.contaEstornoJurosAproCredit || ''} label="Crédito — Juros Apropriados" contabil={contabil} />
            </div>
            <p className="text-[9px] text-slate-400 italic">
              Estorna o juros apropriado debitando a conta do empréstimo e creditando a conta de juros apropriado.
            </p>
          </div>

          {/* Reduzir Juros */}
          <div className="border-t border-slate-700/20 pt-2 space-y-2">
            <p className={labelHint}>Reduzir juros — apropriação como despesa (carregadas via "Puxar")</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ContaReadOnly value={config.contaEstornoJurosDebito || ''} label="Débito — Juros Apropriados" contabil={contabil} />
              <ContaReadOnly value={config.contaEstornoJurosCredito || ''} label="Crédito — Despesa com Juros" contabil={contabil} />
            </div>
            <p className="text-[9px] text-slate-400 italic">
              Reconhece o juros apropriado como despesa com juros quando a parcela do banco for maior que a tabela.
            </p>
          </div>

          {/* Preview / Aplicar */}
          <div className="border-t border-slate-700/20 pt-2 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={handleVisualizar} className={btnClass}>
                Visualizar diferença
              </button>
              {resumo && Math.abs(resumo.diferenca) >= 0.005 && !aplicado && (
                <button type="button" onClick={handleAplicar} className={btnPrimaryClass}>
                  Aplicar lançamento
                </button>
              )}
              {aplicado && (
                <span className="text-[9px] font-bold text-green-700">✓ Aplicado no razão</span>
              )}
            </div>

            {resumo && (
              <div
                className={
                  contabil
                    ? 'border border-brand-border bg-brand-bg p-2 text-[9px] font-mono space-y-2'
                    : 'border border-slate-700 bg-slate-950/50 rounded p-2 text-[9px] font-mono space-y-2'
                }
              >
                <div className="flex items-center justify-between border-b border-slate-700/20 pb-1 text-[9px] font-sans">
                  <span className={
                    contabil
                      ? 'font-bold uppercase tracking-wider text-slate-700 text-[10px]'
                      : 'font-bold uppercase tracking-wider text-slate-400 text-[10px]'
                  }>
                    Comparativo Mensal (Curto vs Longo Prazo)
                  </span>
                </div>

                <div className="overflow-x-auto max-h-[220px] overflow-y-auto border border-slate-700/20 rounded">
                  <table className="w-full text-left border-collapse text-[9px] font-mono">
                    <thead>
                      <tr className={contabil ? 'bg-slate-100 border-b border-slate-300 text-[9px] text-slate-800' : 'bg-slate-800 border-b border-slate-700 text-[9px] text-slate-200'}>
                        <th className="p-1.5 font-extrabold">Data</th>
                        <th className={`p-1.5 font-extrabold text-right border-l ${contabil ? 'border-slate-300' : 'border-slate-700'}`} colSpan={3}>Curto Prazo</th>
                        <th className={`p-1.5 font-extrabold text-right border-l ${contabil ? 'border-slate-300' : 'border-slate-700'}`} colSpan={3}>Longo Prazo</th>
                      </tr>
                      <tr className={contabil ? 'bg-slate-50 border-b border-slate-300 text-[8px] text-slate-600' : 'bg-slate-900/50 border-b border-slate-800 text-[8px] text-slate-400'}>
                        <th className="p-1"></th>
                        <th className={`p-1 text-right border-l ${contabil ? 'border-slate-300 border-l' : 'border-slate-700'}`}>Tab.</th>
                        <th className="p-1 text-right">Real</th>
                        <th className="p-1 text-right">Dif.</th>
                        <th className={`p-1 text-right border-l ${contabil ? 'border-slate-300 border-l' : 'border-slate-700'}`}>Tab.</th>
                        <th className="p-1 text-right">Real</th>
                        <th className="p-1 text-right">Dif.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resumo.meses
                        ?.filter((m) => Math.abs(m.diferencaCurto) >= 0.005 || Math.abs(m.diferencaLongo) >= 0.005)
                        .map((m, idx) => {
                          const hasDiffCurto = Math.abs(m.diferencaCurto) >= 0.005;
                          const hasDiffLongo = Math.abs(m.diferencaLongo) >= 0.005;
                          return (
                            <tr key={idx} className={contabil ? 'border-b border-slate-200 hover:bg-slate-50/50' : 'border-b border-slate-800/40 hover:bg-slate-800/10'}>
                              <td className={`p-1.5 font-bold whitespace-nowrap ${contabil ? 'text-slate-900' : 'text-slate-100'}`}>{m.data}</td>
                              <td className={`p-1.5 text-right border-l ${contabil ? 'border-slate-300 text-slate-800 font-medium' : 'border-slate-800 text-slate-300'}`}>{formatMoeda(m.saldoTabelaCurto)}</td>
                              <td className={`p-1.5 text-right ${contabil ? 'text-slate-800 font-medium' : 'text-slate-300'}`}>{formatMoeda(m.saldoRealCurto)}</td>
                              <td className={`p-1.5 text-right font-black ${
                                hasDiffCurto 
                                  ? (contabil ? 'text-red-700 bg-red-50/80 px-1 rounded' : 'text-amber-400 bg-amber-950/40 px-1 rounded border border-amber-900/30')
                                  : (contabil ? 'text-slate-400' : 'text-slate-600')
                              }`}>{formatMoeda(m.diferencaCurto)}</td>
                              <td className={`p-1.5 text-right border-l ${contabil ? 'border-slate-300 text-slate-800 font-medium' : 'border-slate-800 text-slate-300'}`}>{formatMoeda(m.saldoTabelaLongo)}</td>
                              <td className={`p-1.5 text-right ${contabil ? 'text-slate-800 font-medium' : 'text-slate-300'}`}>{formatMoeda(m.saldoRealLongo)}</td>
                              <td className={`p-1.5 text-right font-black ${
                                hasDiffLongo 
                                  ? (contabil ? 'text-red-700 bg-red-50/80 px-1 rounded' : 'text-amber-400 bg-amber-950/40 px-1 rounded border border-amber-900/30')
                                  : (contabil ? 'text-slate-400' : 'text-slate-600')
                              }`}>{formatMoeda(m.diferencaLongo)}</td>
                            </tr>
                          );
                        })}
                      {(!resumo.meses || resumo.meses.filter((m) => Math.abs(m.diferencaCurto) >= 0.005 || Math.abs(m.diferencaLongo) >= 0.005).length === 0) && (
                        <tr>
                          <td colSpan={7} className={`p-4 text-center italic text-[10px] ${contabil ? 'text-slate-500' : 'text-slate-400'}`}>
                            ✓ Nenhuma divergência encontrada entre os saldos do razão e a tabela.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="border-t border-slate-700/20 pt-1.5 text-[8px] space-y-0.5 opacity-90">
                  <p className="font-bold text-[9px]">Saldo Geral da Comparação (Data Base: {resumo.dataReferencia})</p>
                  <p>Tabela: {formatMoeda(resumo.saldoTabela)} | Real: {formatMoeda(resumo.saldoAtual)} | Diferença Bruta: <span className="font-black text-amber-600">{formatMoeda(resumo.diferenca)}</span></p>
                </div>
              </div>
            )}

            {mensagens.map((m, i) => (
              <p key={i} className="text-[9px] font-bold text-rose-700">
                {m}
              </p>
            ))}
          </div>

          {/* Salvar / Remover */}
          <div className="border-t border-slate-700/20 pt-2 flex items-center justify-end gap-2">
            {salvo && (
              <span className="text-[9px] font-bold text-green-700">✓ Configuração salva</span>
            )}
            <button type="button" onClick={handleSalvar} className={btnPrimaryClass}>
              <Save size={12} className="inline mr-1" />
              Salvar
            </button>
            <button type="button" onClick={onRemove} className={btnDangerClass}>
              <Trash2 size={12} className="inline mr-1" />
              Remover
            </button>
          </div>
        </div>
      )}

      {/* Modal — lançamentos feitos ao aplicar */}
      {modalLancamentos && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Lançamentos aplicados"
          onClick={() => setModalLancamentos(null)}
        >
          <div
            className={
              contabil
                ? 'bg-white border border-brand-border shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col'
                : 'bg-slate-900 border border-slate-700 rounded-lg shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col'
            }
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`flex items-center justify-between gap-2 p-3 border-b ${contabil ? 'border-brand-border' : 'border-slate-700'}`}>
              <div>
                <p className={contabil ? 'text-[11px] font-black uppercase tracking-widest text-brand-text' : 'text-[11px] font-black uppercase tracking-widest text-white'}>
                  ✓ Lançamentos aplicados no razão · {modalLancamentos.length}
                </p>
                <p className={contabil ? 'text-[9px] text-slate-500 mt-0.5' : 'text-[9px] text-slate-400 mt-0.5'}>
                  Correção monetária e redução de juros — {displayContrato}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalLancamentos(null)}
                className={contabil ? 'technical-button p-1' : 'p-1 rounded border border-slate-600 text-slate-300'}
                aria-label="Fechar"
              >
                <X size={14} />
              </button>
            </div>

            <div className="overflow-auto flex-1 p-3">
              {modalLancamentos.length === 0 ? (
                <p className={`text-[10px] italic text-center py-6 ${contabil ? 'text-slate-500' : 'text-slate-400'}`}>
                  Nenhum lançamento novo foi gerado nesta aplicação.
                </p>
              ) : (
                <table className="w-full text-left border-collapse text-[9px] font-mono">
                  <thead>
                    <tr className={contabil ? 'bg-slate-100 border-b border-slate-300 text-slate-800' : 'bg-slate-800 border-b border-slate-700 text-slate-200'}>
                      <th className="p-1.5 font-extrabold whitespace-nowrap">Data</th>
                      <th className="p-1.5 font-extrabold">Histórico</th>
                      <th className="p-1.5 font-extrabold text-right whitespace-nowrap">Débito</th>
                      <th className="p-1.5 font-extrabold text-right whitespace-nowrap">Crédito</th>
                      <th className="p-1.5 font-extrabold text-right whitespace-nowrap">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modalLancamentos.map((l, i) => (
                      <tr key={i} className={contabil ? 'border-b border-slate-200' : 'border-b border-slate-800/40'}>
                        <td className={`p-1.5 font-bold whitespace-nowrap ${contabil ? 'text-slate-900' : 'text-slate-100'}`}>{l.data}</td>
                        <td className={`p-1.5 ${contabil ? 'text-slate-700' : 'text-slate-300'}`}>{l.historico}</td>
                        <td className={`p-1.5 text-right whitespace-nowrap ${contabil ? 'text-slate-800' : 'text-slate-300'}`}>{l.contaDebito}</td>
                        <td className={`p-1.5 text-right whitespace-nowrap ${contabil ? 'text-slate-800' : 'text-slate-300'}`}>{l.contaCredito}</td>
                        <td className={`p-1.5 text-right font-black whitespace-nowrap ${contabil ? 'text-slate-900' : 'text-white'}`}>{formatMoeda(l.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className={contabil ? 'border-t border-slate-300' : 'border-t border-slate-700'}>
                      <td colSpan={4} className={`p-1.5 font-extrabold text-right uppercase ${contabil ? 'text-slate-700' : 'text-slate-300'}`}>Total</td>
                      <td className={`p-1.5 text-right font-black whitespace-nowrap ${contabil ? 'text-slate-900' : 'text-white'}`}>
                        {formatMoeda(modalLancamentos.reduce((s, l) => s + l.valor, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>

            <div className={`p-3 border-t flex justify-end ${contabil ? 'border-brand-border' : 'border-slate-700'}`}>
              <button
                type="button"
                onClick={() => setModalLancamentos(null)}
                className={contabil ? 'technical-button-primary text-[9px] py-1.5 px-4' : 'px-4 py-1.5 rounded bg-violet-600 hover:bg-violet-500 text-white text-[9px] font-black uppercase'}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
