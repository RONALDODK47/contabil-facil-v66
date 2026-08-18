import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Trash2,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  ListOrdered,
  Search,
} from 'lucide-react';
import { cn, formatCurrency, formatDate } from '../lib/utils';
import { CompanyApp } from '../types';
import DataIngestionBox from './DataIngestionBox';
import AplicacaoExtracaoDadosModal from './AplicacaoExtracaoDadosModal';
import AplicacaoRegrasContasModal from './AplicacaoRegrasContasModal';
import {
  computeResumoConta,
  loadAplicacaoContasExtrato,
  removeAplicacaoContaExtrato,
  upsertAplicacaoContaExtrato,
  type AplicacaoContaExtrato,
} from '../logic/aplicacaoExtratoStorage';
import {
  filterAplicacaoRegrasPorConta,
  loadAplicacaoRegrasContas,
  type AplicacaoRegraConta,
} from '../logic/aplicacaoRegrasContasStorage';

import BalancetePeriodoModal, { type BalancetePeriodo } from './BalancetePeriodoModal';
import { postAplicacaoNoRazao } from '../logic/aplicacaoBalanceteAutomation';
import { flushPersistenceAfterCriticalWrite } from '../logic/eyeVisionPersistenceFlush';
import {
  loadAplicacoesFromBrowserStorage,
  normalizeSavedAplicacao,
  type SavedAplicacao,
} from '../logic/aplicacaoStorage';
import { persistCanonicalList } from '../../lib/simuladorBrowserStorage';
import {
  belongsToSindicato,
  getAplicacaoFolderName,
  normalizeCompanyName,
} from '../logic/companyWorkspace';
import {
  buildAplicacaoLancamentosDisplay,
  enrichAplicacaoExportInput,
  summarizeAplicacaoLancamentos,
  type AplicacaoLancamentoTipo,
} from '../logic/aplicacaoLancamentosDisplay';
import {
  cronogramaAplicacao,
  downloadAplicacaoTxtPlus,
  generateAplicacaoTxtPlus,
} from '../../lib/aplicacoesDominioExport';
import { formatCurrencyInput, parseCurrency } from '../../lib/simTabFields';
import { buildTxtPlusFromExtratoRows, type ExtratoExportRow } from '../logic/dominioTxtIO';
import {
  buildAplicacaoLancamentoContabil,
  comCompensacoesDeProvisao,
} from '../logic/aplicacaoExtratoLancamentos';

function lancamentoTipoLabel(tipo: AplicacaoLancamentoTipo) {
  if (tipo === 'JUROS') return 'Juros';
  if (tipo === 'IRRF') return 'IRRF';
  if (tipo === 'IOF') return 'IOF';
  if (tipo === 'APLICACAO') return 'Aplicação';
  return 'Outro';
}

function lancamentoTipoClass(tipo: AplicacaoLancamentoTipo) {
  if (tipo === 'JUROS') return 'text-blue-700 bg-blue-50 border-blue-200';
  if (tipo === 'IRRF') return 'text-amber-700 bg-amber-50 border-amber-200';
  if (tipo === 'IOF') return 'text-orange-700 bg-orange-50 border-orange-200';
  if (tipo === 'APLICACAO') return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  return 'text-slate-600 bg-brand-sidebar/30 border-brand-border/30';
}

export interface AppsModuleProps {
  selectedCompany: string;
  storageVersion?: number;
  /** Dentro da aba Gerencial — oculta cabeçalho duplicado. */
  embedded?: boolean;
}

/**
 * A aba Aplicações tem exatamente duas telas: o extrato das aplicações e a
 * conciliação delas. Carteira, Contas e a duplicata "Aplicações" foram
 * removidas por pedido do usuário — as ações de modelo/importação/extração
 * ficam na coluna lateral, só em "Extrato de Aplicações".
 */
type AppsMainTab = 'extrato' | 'pastas';

function resolveIndex(a: SavedAplicacao): string {
  const indexRaw = (a.variacaoValorParcelas ?? 'fixo').toString().toUpperCase();
  if (indexRaw.includes('SELIC')) return 'SELIC';
  if (indexRaw.includes('IPCA') || indexRaw.includes('FIXED')) return 'IPCA';
  if (indexRaw.includes('PRE')) return 'PRE';
  return 'CDI';
}

function resolveRate(a: SavedAplicacao): number {
  const fromReceita = parseCurrency(a.valorReceitaJurosMensalStr ?? '0');
  if (fromReceita > 0) return fromReceita;
  return 100;
}

function aplicacaoToCompanyApp(a: SavedAplicacao): CompanyApp {
  return {
    id: a.id,
    name: a.nomeAplicacao || a.nomeEmpresa || 'SEM NOME',
    folder: getAplicacaoFolderName(a),
    amount: parseCurrency(a.valorParcelaStr),
    rate: resolveRate(a),
    index: resolveIndex(a),
    startDate: a.dataInicioPrimeiraParcelaStr,
    numeroAplicacao: a.numeroAplicacao,
  };
}

function buildSavedAplicacao(
  app: CompanyApp,
  sindicatoName: string,
  previous?: SavedAplicacao,
): SavedAplicacao {
  return normalizeSavedAplicacao({
    ...(previous ?? {}),
    id: app.id,
    sindicatoName: normalizeCompanyName(sindicatoName),
    nomeEmpresa: app.folder.trim().toUpperCase() || getAplicacaoFolderName({ nomeAplicacao: app.name }),
    nomeAplicacao: app.name,
    numeroAplicacao: app.numeroAplicacao,
    valorParcelaStr: formatCurrencyInput(app.amount),
    numeroPrimeiraParcelaStr: previous?.numeroPrimeiraParcelaStr ?? '1',
    dataInicioPrimeiraParcelaStr: app.startDate,
    quantidadeParcelasStr: previous?.quantidadeParcelasStr ?? '12',
    variacaoValorParcelas: app.index === 'SELIC' ? 'selic_dias' : 'fixo',
    temReceitaJuros: previous?.temReceitaJuros ?? app.rate > 0,
    valorReceitaJurosMensalStr:
      previous?.valorReceitaJurosMensalStr ??
      (app.rate > 0 ? formatCurrencyInput(app.rate) : undefined),
    createdAt: previous?.createdAt ?? new Date().toISOString(),
  });
}

export default function AppsModule({
  selectedCompany,
  storageVersion = 0,
  embedded = false,
}: AppsModuleProps) {
  const [appsMainTab, setAppsMainTab] = useState<AppsMainTab>('extrato');
  const [savedApps, setSavedApps] = useState<SavedAplicacao[]>([]);
  const [periodoModalOpen, setPeriodoModalOpen] = useState(false);
  const [pendingAplicacao, setPendingAplicacao] = useState<{ item: SavedAplicacao; count: number } | null>(null);
  const [extratoSearch, setExtratoSearch] = useState('');
  /** Modal de extração de dados (OCR/recorte dos PDFs de aplicações). */
  const [extracaoOpen, setExtracaoOpen] = useState(false);
  /** Aplicações criadas na Extração de Dados — viram pastas na sub-aba "Pastas de Aplicações". */
  const [contasAplicacao, setContasAplicacao] = useState<AplicacaoContaExtrato[]>([]);
  /** Regras de conciliação das aplicações (mesmo modelo do extrato bancário). */
  const [regrasAplicacao, setRegrasAplicacao] = useState<AplicacaoRegraConta[]>([]);
  const [regrasModalOpen, setRegrasModalOpen] = useState(false);
  const [contaRegrasNome, setContaRegrasNome] = useState('');
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const [expandedAppIds, setExpandedAppIds] = useState<Set<string>>(() => new Set());
  /** Tabelas escondidas pelo botão "Limpar" — só visual, nada é apagado. */
  const [tabelasOcultas, setTabelasOcultas] = useState<Set<string>>(() => new Set());


  useEffect(() => {
    const all = loadAplicacoesFromBrowserStorage();
    const scoped = all.filter((item) => belongsToSindicato(item.sindicatoName, selectedCompany));
    setSavedApps(scoped);
  }, [storageVersion, selectedCompany]);

  // Recarrega as pastas de aplicação ao entrar na sub-aba e ao fechar a extração,
  // que é onde novas aplicações são criadas.
  useEffect(() => {
    const contas = loadAplicacaoContasExtrato(selectedCompany);
    setContasAplicacao(contas);
    setRegrasAplicacao(loadAplicacaoRegrasContas(selectedCompany));
    setContaRegrasNome((prev) =>
      prev && contas.some((c) => c.nome === prev) ? prev : contas[0]?.nome ?? '',
    );
  }, [selectedCompany, storageVersion, appsMainTab, extracaoOpen]);

  const lancamentosByAppId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildAplicacaoLancamentosDisplay>>();
    for (const item of savedApps) {
      map.set(item.id, buildAplicacaoLancamentosDisplay(item));
    }
    return map;
  }, [savedApps]);

  const toggleAppExpanded = (id: string) => {
    setExpandedAppIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleExportDominioTxt = (item: SavedAplicacao) => {
    const inp = enrichAplicacaoExportInput(item);
    const cron = cronogramaAplicacao(inp, parseCurrency);
    const content = generateAplicacaoTxtPlus(inp, parseCurrency, cron);
    if (!content.trim()) {
      alert('Nenhuma linha TXT+ Domínio gerada. Configure contas e valores da aplicação.');
      return;
    }
    const base = (item.nomeAplicacao || item.numeroAplicacao || 'aplicacao')
      .replace(/\s+/g, '_')
      .replace(/[^\w-]/g, '');
    downloadAplicacaoTxtPlus(`${base}_dominio_txtplus.txt`, content);
  };

  const handleMandarAplicacaoBalancete = (item: SavedAplicacao, count: number) => {
    if (count <= 0) {
      alert('Nenhum lançamento para enviar. Configure contas e valores na aba Contas.');
      return;
    }
    setPendingAplicacao({ item, count });
    setPeriodoModalOpen(true);
  };

  const handlePeriodoConfirmado = (periodo: BalancetePeriodo) => {
    setPeriodoModalOpen(false);
    if (!pendingAplicacao) return;
    try {
      const { gerados, pendencias } = postAplicacaoNoRazao(selectedCompany, pendingAplicacao.item.id);
      void flushPersistenceAfterCriticalWrite();
      if (pendencias.length && gerados <= 0) {
        alert(pendencias.join('\n'));
        return;
      }
      const periodoStr = `${periodo.dataInicio.split('-').reverse().join('/')} até ${periodo.dataFim.split('-').reverse().join('/')}`;
      alert(
        gerados > 0
          ? `${gerados} lançamento(s) da aplicação enviados ao balancete.\nPeríodo: ${periodoStr}\n\nAbra a aba Balancete para conferir.`
          : 'Nada novo para enviar — já estavam no balancete (ou não geraram partidas).',
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao enviar para o balancete.');
    }
  };

  const renderLancamentosPanel = (item: SavedAplicacao) => {
    const lancamentos = lancamentosByAppId.get(item.id) ?? [];
    const summary = summarizeAplicacaoLancamentos(lancamentos);

    return (
      <div className="px-6 py-4 bg-brand-sidebar/10 border-t border-brand-border/20">
        <div className="flex flex-wrap gap-4 mb-4 text-[9px] font-black uppercase tracking-widest items-center">
          <span>Juros: {formatCurrency(summary.juros)}</span>
          <span>IRRF: {formatCurrency(summary.irrf)}</span>
          <span>IOF: {formatCurrency(summary.iof)}</span>
          <span className="opacity-50">{lancamentos.length} lançamento(s)</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleExportDominioTxt(item)}
              className="technical-button-primary text-[9px] py-1 px-3"
            >
              EXPORTAR TXT+ DOMÍNIO
            </button>
          </div>
        </div>

        {lancamentos.length === 0 ? (
          <p className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">
            Nenhum lançamento configurado para esta aplicação.
          </p>
        ) : (
          <div className="module-table-viewport-nested border border-brand-border/30 bg-white">
            <table className="w-full min-w-[760px] text-left border-collapse">
              <thead className="bg-brand-sidebar/40 text-[9px] font-black uppercase tracking-widest">
                <tr>
                  <th className="px-3 py-2 border-b border-brand-border/30">Data</th>
                  <th className="px-3 py-2 border-b border-brand-border/30">Tipo</th>
                  <th className="px-3 py-2 border-b border-brand-border/30">Histórico</th>
                  <th className="px-3 py-2 border-b border-brand-border/30">Débito</th>
                  <th className="px-3 py-2 border-b border-brand-border/30">Crédito</th>
                  <th className="px-3 py-2 border-b border-brand-border/30 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="font-mono text-[10px]">
                {lancamentos.map((lanc) => (
                  <tr key={lanc.id} className="border-b border-brand-border/10 last:border-b-0">
                    <td className="px-3 py-2">{formatDate(lanc.date)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'inline-block px-1.5 py-0.5 border text-[8px] font-black uppercase',
                          lancamentoTipoClass(lanc.tipo),
                        )}
                      >
                        {lancamentoTipoLabel(lanc.tipo)}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-bold">{lanc.historico}</td>
                    <td className="px-3 py-2 opacity-70">{lanc.debito || '—'}</td>
                    <td className="px-3 py-2 opacity-70">{lanc.credito || '—'}</td>
                    <td className="px-3 py-2 text-right font-black">{formatCurrency(lanc.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  const persistForSindicato = (scopedList: SavedAplicacao[]) => {
    setSavedApps(scopedList);
    const all = loadAplicacoesFromBrowserStorage();
    const others = all.filter((item) => !belongsToSindicato(item.sindicatoName, selectedCompany));
    const normalized = scopedList.map((item) => ({
      ...item,
      sindicatoName: normalizeCompanyName(selectedCompany),
    }));
    persistCanonicalList('simulador_aplicacoes', [...others, ...normalized]);
  };

  const handleDelete = (id: string) => {
    persistForSindicato(savedApps.filter((item) => item.id !== id));
  };

  /**
   * O extrato mostra direto o que a Extração de Dados gravou: cada aplicação
   * (pasta) com seus lançamentos. Débito/Crédito só aparecem quando a regra de
   * conciliação casa — o outro lado é sempre a própria conta de aplicação.
   */
  const groupedExtrato = useMemo(() => {
    const needle = extratoSearch.trim().toLowerCase();

    return contasAplicacao
      .map((conta) => {
        const regrasDaConta = filterAplicacaoRegrasPorConta(regrasAplicacao, conta.nome);
        const rows = comCompensacoesDeProvisao(conta)
          .map((r, idx) => ({
            key: `${conta.id}-${idx}`,
            // Posição na lista salva — o desbloqueio de provisão grava por índice.
            indice: idx,
            // Compensação é derivada na hora, não está salva: não pode ganhar
            // botão de bloquear (o índice dela não existe em conta.rows).
            persistido: idx < conta.rows.length,
            ...buildAplicacaoLancamentoContabil(r, conta, regrasDaConta),
          }))
          // A busca cobre tudo que aparece na linha: nome da pasta, conta
          // contábil da aplicação, histórico do lançamento e as contas de
          // débito/crédito — procurar por "1051" ou "IRRF" tem que achar.
          .filter((row) => {
            if (!needle) return true;
            return [
              conta.nome,
              conta.contaContabil ?? '',
              row.historico,
              row.debito,
              row.credito,
              row.data,
            ]
              .join(' ')
              .toLowerCase()
              .includes(needle);
          });
        return { conta, rows };
      })
      .filter((g) => g.rows.length > 0 || (!needle && g.conta.rows.length === 0))
      .sort((a, b) => a.conta.nome.localeCompare(b.conta.nome, 'pt-BR', { sensitivity: 'base' }));
  }, [contasAplicacao, regrasAplicacao, extratoSearch]);

  const totalLancamentosExtrato = useMemo(
    () => contasAplicacao.reduce((acc, c) => acc + c.rows.length, 0),
    [contasAplicacao],
  );

  /** Id de âncora da pasta no extrato, para rolar até ela. */
  const slugFolderId = (nome: string) => nome.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();

  const toggleFolder = (folderName: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderName)) next.delete(folderName);
      else next.add(folderName);
      return next;
    });
  };

  const mainTabs: { id: AppsMainTab; label: string }[] = [
    { id: 'extrato', label: 'Extrato de Aplicações' },
    { id: 'pastas', label: 'Pastas de Aplicações' },
  ];

  const handleRemoverContaAplicacao = (id: string, nome: string) => {
    if (!window.confirm(`Remover a pasta da aplicação "${nome}" e seus lançamentos importados?`)) {
      return;
    }
    setContasAplicacao(removeAplicacaoContaExtrato(selectedCompany, id));
  };

  /**
   * Esvazia só os lançamentos mostrados na tabela. A aplicação continua salva —
   * excluir a aplicação em si é ação da aba "Pastas de Aplicações", para não se
   * perder uma pasta inteira ao querer apenas refazer uma importação.
   */
  /**
   * Esconde a tabela desta aplicação — só na tela, sem tocar no que está salvo.
   * Os lançamentos continuam gravados e voltam ao reabrir a aba ou ao clicar em
   * "Mostrar". Apagar lançamento de verdade não é ação de um botão de limpar:
   * quem remove a aplicação (e o que há nela) é a lixeira da aba "Pastas de
   * Aplicações".
   */
  const handleLimparLancamentos = (conta: AplicacaoContaExtrato) => {
    setTabelasOcultas((prev) => {
      const next = new Set(prev);
      if (next.has(conta.id)) next.delete(conta.id);
      else next.add(conta.id);
      return next;
    });
  };

  /**
   * Libera (ou volta a bloquear) uma provisão. Enquanto bloqueada ela aparece
   * só na parte de provisionamentos da tabela; liberada, passa a valer como
   * lançamento — entra nos totais, na conciliação e no TXT do Domínio.
   */
  /**
   * Libera (ou volta a bloquear) as provisões da aplicação de uma vez. É um
   * botão só, no cabeçalho do bloco: as provisões do mês vão juntas para a
   * contabilidade ou nenhuma vai — decidir uma a uma não corresponde a como o
   * fechamento é feito, e ainda deixava a tabela cheia de botões.
   */
  const handleAlternarProvisoes = (conta: AplicacaoContaExtrato) => {
    const bloqueadas = conta.rows.some((r) => r.provisionado && !r.desbloqueado);
    const rows = conta.rows.map((r) =>
      r.provisionado ? { ...r, desbloqueado: bloqueadas } : r,
    );
    setContasAplicacao(
      upsertAplicacaoContaExtrato(selectedCompany, {
        id: conta.id,
        nome: conta.nome,
        contaContabil: conta.contaContabil,
        rows,
      }),
    );
  };

  /**
   * TXT+ Domínio só das provisões — separado do export geral porque provisão
   * costuma ir para um lote/competência à parte no fechamento.
   *
   * Leva as provisões liberadas e, se a compensação estiver ligada, também os
   * estornos do mês seguinte. Provisão bloqueada não entra: ela não é lançamento.
   */
  const handleExportarProvisoes = (conta: AplicacaoContaExtrato) => {
    const regrasDaConta = filterAplicacaoRegrasPorConta(regrasAplicacao, conta.nome);
    const linhas: ExtratoExportRow[] = [];
    const pendentes: string[] = [];

    for (const row of comCompensacoesDeProvisao(conta)) {
      if (!row.provisionado) continue;
      const lanc = buildAplicacaoLancamentoContabil(row, conta, regrasDaConta);
      if (!lanc.contabiliza) continue;
      if (!lanc.debito || !lanc.credito) {
        pendentes.push(`• ${lanc.data} · ${lanc.historico} — sem contrapartida (falta regra de conciliação)`);
        continue;
      }
      linhas.push({
        date: lanc.data,
        description: lanc.historico,
        value: lanc.valor,
        nature: lanc.nature,
        accountDebit: lanc.debito,
        accountCredit: lanc.credito,
        operationName: lanc.historico,
      });
    }

    if (linhas.length === 0) {
      alert(
        pendentes.length > 0
          ? `Nenhuma provisão pôde ser exportada:\n\n${pendentes.join('\n')}`
          : 'Nenhuma provisão liberada para exportar. Use "Desbloquear" nas provisões que você vai lançar.',
      );
      return;
    }

    const base = conta.nome.replace(/\s+/g, '_').replace(/[^\w-]/g, '');
    downloadAplicacaoTxtPlus(`${base}_provisoes_dominio_txtplus.txt`, buildTxtPlusFromExtratoRows(linhas));
    if (pendentes.length > 0) {
      alert(
        `${pendentes.length} provisão(ões) ficaram de fora do arquivo:\n\n${pendentes.join('\n')}\n\n` +
          'O arquivo foi baixado mesmo assim, só sem essas linhas.',
      );
    }
  };

  /** Liga/desliga o estorno automático das provisões no mês seguinte. */
  const handleAlternarCompensacao = (conta: AplicacaoContaExtrato) => {
    setContasAplicacao(
      upsertAplicacaoContaExtrato(selectedCompany, {
        id: conta.id,
        nome: conta.nome,
        contaContabil: conta.contaContabil,
        compensarProvisao: !conta.compensarProvisao,
      }),
    );
  };

  /** Clicar numa pasta leva ao extrato dela, com as demais recolhidas. */
  const handleAbrirExtratoDaConta = (nome: string) => {
    setAppsMainTab('extrato');
    setExtratoSearch('');
    setCollapsedFolders(new Set(contasAplicacao.map((c) => c.nome).filter((n) => n !== nome)));
    requestAnimationFrame(() => {
      document.getElementById(`aplicacao-pasta-${slugFolderId(nome)}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  };

  /** Pastas das aplicações criadas na Extração de Dados (nome = pasta). */
  const renderPastasAplicacoesTab = () => (
    <div className="technical-panel shadow-[4px_4px_0_0_#141414] overflow-hidden">
      <div className="px-4 py-3 border-b border-brand-border bg-brand-sidebar/40">
        <h3 className="text-[10px] font-black uppercase tracking-[0.2em]">Pastas de Aplicações</h3>
        <p className="text-[9px] font-mono opacity-50 mt-0.5">
          {contasAplicacao.length} aplicação(ões) salva(s) · criadas em "Extração de Dados"
        </p>
      </div>

      {contasAplicacao.length === 0 ? (
        <div className="py-16 px-6 text-center">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Nenhuma aplicação salva. Crie o nome em "Extração de Dados".
          </p>
        </div>
      ) : (
        <div className="p-3 space-y-1">
          {contasAplicacao.map((conta) => {
            const resumo = computeResumoConta(conta);
            return (
              <div
                key={conta.id}
                className="flex flex-wrap items-center gap-3 px-3 py-2.5 border border-brand-border/15 bg-white hover:border-brand-border/50 hover:bg-brand-sidebar/20 transition-all"
              >
                {/* Clicar na pasta abre o extrato dela, já com a tabela de lançamentos. */}
                <button
                  type="button"
                  onClick={() => handleAbrirExtratoDaConta(conta.nome)}
                  className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
                  title={`Ver os lançamentos de "${conta.nome}"`}
                >
                  <span className="text-brand-border shrink-0">
                    <Folder size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-black uppercase tracking-wide truncate">{conta.nome}</p>
                    <p className="text-[9px] font-mono opacity-50">
                      {conta.rows.length} lançamento(s) · Entradas {formatCurrency(resumo.totalEntradas)} ·
                      Saídas {formatCurrency(resumo.totalSaidas)}
                    </p>
                  </div>
                </button>
                <p className="text-[11px] font-mono font-black shrink-0">
                  {formatCurrency(resumo.saldoFinal)}
                </p>
                <button
                  type="button"
                  onClick={() => handleRemoverContaAplicacao(conta.id, conta.nome)}
                  className="p-1 text-red-600 hover:bg-red-50 transition-colors shrink-0"
                  title="Remover pasta da aplicação"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  /**
   * Resumo da aplicação selecionada. Saldo final = saldo anterior + débitos -
   * créditos, e tanto o saldo anterior quanto o final podem ser digitados — os
   * dois são informação manual do extrato.
   *
   * Soma TODOS os lançamentos, conciliados ou não: o lado de cada um sai do
   * próprio extrato (entrada é débito, resgate é crédito) e não depende de
   * regra. Somar só os conciliados deixava os totais em R$ 0,00 até alguém
   * cadastrar as contrapartidas, escondendo o movimento que já estava lido.
   */
  const resumoAplicacoes = useMemo(() => {
    const grupo = groupedExtrato.find((g) => g.conta.nome === contaRegrasNome) ?? groupedExtrato[0];
    const conta = grupo?.conta ?? null;
    const saldoAnterior = conta?.saldoAnteriorManual ?? 0;
    let totalDebitos = 0;
    let totalCreditos = 0;
    for (const row of grupo?.rows ?? []) {
      // Provisão bloqueada não entra: ela ainda não é movimento do mês.
      if (!row.contabiliza) continue;
      if (row.nature === 'D') totalDebitos += row.valor;
      else if (row.nature === 'C') totalCreditos += row.valor;
    }
    const calculado = saldoAnterior + totalDebitos - totalCreditos;
    return {
      conta,
      saldoAnterior,
      totalDebitos,
      totalCreditos,
      saldoFinalCalculado: calculado,
      saldoFinal: conta?.saldoFinalManual ?? calculado,
    };
  }, [groupedExtrato, contaRegrasNome]);

  /** Grava saldo anterior / saldo final digitados na aplicação selecionada. */
  const salvarSaldoManual = (campo: 'saldoAnteriorManual' | 'saldoFinalManual', texto: string) => {
    const conta = resumoAplicacoes.conta;
    if (!conta) return;
    const limpo = texto.trim();
    const valor = limpo ? parseCurrency(limpo) : null;
    setContasAplicacao(
      upsertAplicacaoContaExtrato(selectedCompany, {
        id: conta.id,
        nome: conta.nome,
        [campo]: valor,
      } as Parameters<typeof upsertAplicacaoContaExtrato>[1]),
    );
    void flushPersistenceAfterCriticalWrite();
  };

  const renderResumoAplicacoes = () => (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div className="technical-panel p-3 shadow-[3px_3px_0_0_#141414] space-y-1">
        <p className="text-[8px] font-black uppercase tracking-widest opacity-60">Saldo Anterior</p>
        <input
          type="text"
          aria-label="Saldo anterior da aplicação"
          defaultValue={
            resumoAplicacoes.conta?.saldoAnteriorManual != null
              ? formatCurrencyInput(resumoAplicacoes.saldoAnterior)
              : ''
          }
          key={`sa-${resumoAplicacoes.conta?.id ?? 'none'}-${resumoAplicacoes.saldoAnterior}`}
          onBlur={(e) => salvarSaldoManual('saldoAnteriorManual', e.target.value)}
          disabled={!resumoAplicacoes.conta}
          placeholder="0,00"
          className="w-full text-sm font-mono font-black bg-transparent border-b border-brand-border/40 outline-none focus:border-brand-border disabled:opacity-40"
        />
      </div>
      <div className="technical-panel p-3 shadow-[3px_3px_0_0_#141414] space-y-1">
        <p className="text-[8px] font-black uppercase tracking-widest opacity-60">Total Débitos</p>
        <p className="text-sm font-mono font-black">{formatCurrency(resumoAplicacoes.totalDebitos)}</p>
      </div>
      <div className="technical-panel p-3 shadow-[3px_3px_0_0_#141414] space-y-1">
        <p className="text-[8px] font-black uppercase tracking-widest opacity-60">Total Créditos</p>
        <p className="text-sm font-mono font-black">{formatCurrency(resumoAplicacoes.totalCreditos)}</p>
      </div>
      <div className="technical-panel p-3 shadow-[3px_3px_0_0_#141414] space-y-1">
        <p className="text-[8px] font-black uppercase tracking-widest opacity-60">
          Saldo Final {resumoAplicacoes.conta?.saldoFinalManual != null ? '(digitado)' : '(calculado)'}
        </p>
        <input
          type="text"
          aria-label="Saldo final da aplicação"
          defaultValue={
            resumoAplicacoes.conta?.saldoFinalManual != null
              ? formatCurrencyInput(resumoAplicacoes.saldoFinal)
              : ''
          }
          key={`sf-${resumoAplicacoes.conta?.id ?? 'none'}-${resumoAplicacoes.saldoFinal}`}
          onBlur={(e) => salvarSaldoManual('saldoFinalManual', e.target.value)}
          disabled={!resumoAplicacoes.conta}
          placeholder={formatCurrencyInput(resumoAplicacoes.saldoFinalCalculado)}
          className="w-full text-sm font-mono font-black bg-transparent border-b border-brand-border/40 outline-none focus:border-brand-border disabled:opacity-40"
        />
      </div>
    </div>
  );

  const contaRegras = useMemo(
    () => contasAplicacao.find((c) => c.nome === contaRegrasNome) ?? null,
    [contasAplicacao, contaRegrasNome],
  );

  const regrasDaContaSelecionada = useMemo(
    () => filterAplicacaoRegrasPorConta(regrasAplicacao, contaRegrasNome),
    [regrasAplicacao, contaRegrasNome],
  );

  /** Lançamentos da aplicação escolhida, no formato usado pelas regras (histórico + natureza). */
  const extratoSampleRegras = useMemo(
    () =>
      (contaRegras?.rows ?? []).map((r) => ({
        description: r.historico,
        nature: (r.saida > 0 ? 'C' : 'D') as 'D' | 'C',
        value: r.saida > 0 ? r.saida : r.entrada,
      })),
    [contaRegras],
  );

  /** Barra de regras de conciliação — fica acima da tabela do extrato. */
  const renderRegrasBar = () => (
    <div className="technical-panel p-3 shadow-[3px_3px_0_0_#141414] flex flex-wrap items-center gap-2">
      <select
        value={contaRegrasNome}
        onChange={(e) => setContaRegrasNome(e.target.value)}
        aria-label="Aplicação das regras de conciliação"
        className="px-2 py-1.5 bg-white border border-brand-border text-[10px] font-mono font-bold uppercase outline-none"
      >
        {contasAplicacao.length === 0 ? (
          <option value="">Nenhuma aplicação</option>
        ) : (
          contasAplicacao.map((c) => (
            <option key={c.id} value={c.nome}>
              {c.nome}
            </option>
          ))
        )}
      </select>
      <button
        type="button"
        onClick={() => setRegrasModalOpen(true)}
        disabled={!contaRegrasNome}
        className="technical-button flex items-center gap-1.5 px-3 disabled:opacity-40"
      >
        <ListOrdered size={13} /> Regras de Conciliação ({regrasDaContaSelecionada.length})
      </button>
    </div>
  );

  const renderExtratoTab = () => (
    <div className="technical-panel shadow-[4px_4px_0_0_#141414] overflow-hidden">
      <div className="px-4 py-3 border-b border-brand-border bg-brand-sidebar/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em]">Extrato de Aplicações</h3>
          <p className="text-[9px] font-mono opacity-50 mt-0.5">
            {contasAplicacao.length} aplicação(ões) · {totalLancamentosExtrato} lançamento(s)
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-border/50" size={14} />
          <input
            type="text"
            aria-label="Buscar por pasta, histórico ou conta no extrato"
            value={extratoSearch}
            onChange={(e) => setExtratoSearch(e.target.value)}
            placeholder="BUSCAR PASTA, HISTÓRICO OU CONTA..."
            className="w-full pl-9 pr-3 py-2 bg-white border border-brand-border text-[10px] font-mono font-bold uppercase tracking-wide outline-none focus:bg-brand-sidebar/10"
          />
        </div>
      </div>

      <div className="module-table-viewport">
        {groupedExtrato.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              {contasAplicacao.length === 0
                ? 'Nenhuma aplicação neste sindicato.'
                : 'Nenhum lançamento corresponde à busca.'}
            </p>
          </div>
        ) : (
          groupedExtrato.map(({ conta, rows }) => {
            const folderName = conta.nome;
            const isOpen = !collapsedFolders.has(folderName) || extratoSearch.length > 0;
            // "Limpar" só esconde a tabela; nada some do que está salvo.
            const tabelaOculta = tabelasOcultas.has(conta.id);
            const linhasVisiveis = tabelaOculta ? [] : rows;
            const totalConta = rows.reduce((acc, r) => acc + r.valor, 0);
            const conciliados = rows.filter((r) => r.contabiliza && r.conciliado).length;
            // A tabela mostra os dois grupos, mas separados: o realizado do mês
            // e, embaixo, as provisões — que só contam se forem liberadas.
            const linhasReais = linhasVisiveis.filter((r) => !r.provisionado);
            const linhasProvisao = linhasVisiveis.filter((r) => r.provisionado);
            const provisoesLiberadas =
              linhasProvisao.length > 0 && linhasProvisao.every((r) => r.desbloqueado);

            return (
              <div
                key={conta.id}
                id={`aplicacao-pasta-${slugFolderId(folderName)}`}
                className="border-b border-brand-border/20 last:border-b-0 scroll-mt-4"
              >
                <div className="flex items-center">
                <button
                  type="button"
                  onClick={() => toggleFolder(folderName)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-brand-sidebar/30 transition-colors"
                >
                  <span className="text-brand-border/70">
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                  <span className="text-brand-border">
                    {isOpen ? <FolderOpen size={16} /> : <Folder size={16} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-black uppercase tracking-wide truncate">{folderName}</p>
                    <p className="text-[9px] font-mono opacity-50">
                      {conta.contaContabil ? `Conta ${conta.contaContabil} · ` : ''}
                      {rows.length} lançamento(s) · {conciliados} conciliado(s) · {formatCurrency(totalConta)}
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleLimparLancamentos(conta)}
                  disabled={conta.rows.length === 0}
                  className={cn(
                    'px-2.5 py-1.5 mr-2 text-[9px] font-black uppercase tracking-widest border border-brand-border/40 transition-colors shrink-0',
                    conta.rows.length === 0
                      ? 'opacity-30 cursor-not-allowed'
                      : 'hover:bg-brand-sidebar/60',
                  )}
                  title={
                    tabelaOculta
                      ? 'Mostrar de novo os lançamentos desta aplicação'
                      : 'Esconder a tabela — só na tela; os lançamentos continuam salvos'
                  }
                >
                  {tabelaOculta ? 'Mostrar' : 'Limpar'}
                </button>
                </div>

                {isOpen ? (
                  <div className="pb-3 px-4">
                    {linhasVisiveis.length === 0 ? (
                      <p className="text-[9px] font-mono opacity-50 py-3">
                        {tabelaOculta
                          ? `Tabela limpa da tela — ${conta.rows.length} lançamento(s) continuam salvos. Clique em "Mostrar".`
                          : 'Nenhum lançamento extraído nesta aplicação.'}
                      </p>
                    ) : (
                      <div className="border border-brand-border/30 bg-white overflow-x-auto">
                        <table className="w-full min-w-[720px] text-left border-collapse">
                          <thead className="bg-brand-sidebar/40 text-[9px] font-black uppercase tracking-widest">
                            <tr>
                              <th className="px-3 py-2 border-b border-brand-border/30">Data</th>
                              <th className="px-3 py-2 border-b border-brand-border/30">Histórico</th>
                              <th className="px-3 py-2 border-b border-brand-border/30">Débito</th>
                              <th className="px-3 py-2 border-b border-brand-border/30">Crédito</th>
                              <th className="px-3 py-2 border-b border-brand-border/30 text-right">Valor</th>
                            </tr>
                          </thead>
                          <tbody className="font-mono text-[10px]">
                            {linhasReais.map((row) => (
                              <tr key={row.key} className="border-b border-brand-border/10">
                                <td className="px-3 py-2">{row.data || '—'}</td>
                                <td className="px-3 py-2 font-bold">{row.historico}</td>
                                <td className="px-3 py-2">{row.debito || ''}</td>
                                <td className="px-3 py-2">{row.credito || ''}</td>
                                <td className="px-3 py-2 text-right font-black">{formatCurrency(row.valor)}</td>
                              </tr>
                            ))}

                            {/* Provisionamentos: rendimento a receber e imposto a
                                reter. Ficam à parte porque não são movimento do
                                mês — cada um só entra na conciliação e no TXT
                                depois de desbloqueado aqui. */}
                            {linhasProvisao.length > 0 && (
                              <tr className="bg-brand-sidebar/40">
                                <td colSpan={5} className="px-3 py-2 border-y border-brand-border/30">
                                  <div className="flex flex-wrap items-center gap-3">
                                    <span className="text-[9px] font-black uppercase tracking-widest">
                                      Provisionamentos
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleAlternarProvisoes(conta)}
                                      className="px-2 py-1 text-[8px] font-black uppercase tracking-widest border border-brand-border/50 hover:bg-brand-border hover:text-brand-bg transition-colors"
                                      title={
                                        provisoesLiberadas
                                          ? 'Bloquear de novo — as provisões saem da conciliação'
                                          : 'Desbloquear — as provisões passam a valer como lançamento e entram na conciliação'
                                      }
                                    >
                                      {provisoesLiberadas ? 'Bloquear' : 'Desbloquear'}
                                    </button>
                                    <span className="font-mono text-[9px] opacity-60">
                                      {provisoesLiberadas
                                        ? 'liberadas — entram na conciliação'
                                        : 'não entram na conciliação enquanto estiverem bloqueados'}
                                    </span>
                                    <label className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(conta.compensarProvisao)}
                                        onChange={() => handleAlternarCompensacao(conta)}
                                      />
                                      Compensar no próximo mês
                                    </label>
                                    <button
                                      type="button"
                                      onClick={() => handleExportarProvisoes(conta)}
                                      className="ml-auto px-2 py-1 text-[8px] font-black uppercase tracking-widest border border-brand-border/50 hover:bg-brand-border hover:text-brand-bg transition-colors"
                                      title="Baixar um TXT+ Domínio só com as provisões liberadas (e os estornos, se a compensação estiver ligada)"
                                    >
                                      Exportar provisões (TXT+)
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )}
                            {linhasProvisao.map((row) => (
                              <tr
                                key={row.key}
                                className={cn(
                                  'border-b border-brand-border/10',
                                  row.desbloqueado ? '' : 'opacity-55',
                                )}
                              >
                                <td className="px-3 py-2">{row.data || '—'}</td>
                                <td className="px-3 py-2 font-bold">
                                  {row.historico}
                                  {row.persistido ? null : (
                                    <span className="ml-2 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest border border-brand-border/30 opacity-60">
                                      estorno automático
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2">{row.desbloqueado ? row.debito : ''}</td>
                                <td className="px-3 py-2">{row.desbloqueado ? row.credito : ''}</td>
                                <td className="px-3 py-2 text-right font-black">{formatCurrency(row.valor)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  // Coluna lateral (modelo / importar / extração de dados) só em "Extrato de Aplicações".
  const showSidebar = appsMainTab === 'extrato';

  return (
    <div className={cn(embedded ? 'space-y-6 min-w-0' : 'p-8 max-w-7xl mx-auto space-y-8')}>
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-brand-border pb-4 gap-4">
        {!embedded ? (
          <div>
            <h1 className="text-2xl font-black italic tracking-tighter uppercase">Aplicações Financeiras</h1>
            <p className="text-[10px] font-bold uppercase opacity-50 tracking-widest">
              Controle de Ativos e Yield — {selectedCompany}
            </p>
          </div>
        ) : (
          <div className="min-w-0" />
        )}
      </div>

      <div className="flex border border-brand-border bg-brand-sidebar/30 p-1 w-fit">
        {mainTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setAppsMainTab(tab.id)}
            className={cn(
              'px-6 py-2 text-[10px] font-black uppercase tracking-widest transition-all',
              appsMainTab === tab.id
                ? 'bg-brand-border text-brand-bg shadow-[2px_2px_0_0_rgba(0,0,0,0.2)]'
                : 'text-brand-text/60 hover:bg-brand-border/10',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={cn('grid grid-cols-1 gap-8', showSidebar && 'lg:grid-cols-12')}>
        <div className={cn('space-y-6', showSidebar && 'lg:col-span-8')}>
          {appsMainTab === 'extrato' ? (
            <>
              {renderResumoAplicacoes()}
              {renderRegrasBar()}
              {renderExtratoTab()}
            </>
          ) : (
            renderPastasAplicacoesTab()
          )}
        </div>

        {showSidebar && (
          <div className="lg:col-span-4 space-y-6">
            {/* Planilha modelo + importação (Excel/TXT+) */}
            <DataIngestionBox
              dataType="apps"
              title="Planilha Modelo / Importar"
              selectedCompany={selectedCompany}
              ingestionMode="all"
              extraBottomAction={{
                label: 'Extração de Dados',
                onClick: () => setExtracaoOpen(true),
                title: 'Extrai os dados dos PDFs de aplicações por recorte/OCR',
              }}
              onImport={(newItems) => {
                const importedApps = (newItems as CompanyApp[]).map((item) =>
                  buildSavedAplicacao(
                    {
                      ...item,
                      id: item.id || crypto.randomUUID(),
                      folder: item.folder || 'GERAL',
                    },
                    selectedCompany,
                  ),
                );
                persistForSindicato([...savedApps, ...importedApps]);
              }}
            />

          </div>
        )}
      </div>

      <AplicacaoRegrasContasModal
        open={regrasModalOpen}
        company={selectedCompany}
        contaAplicacao={contaRegrasNome}
        regras={regrasAplicacao}
        extratoSample={extratoSampleRegras}
        onClose={() => setRegrasModalOpen(false)}
        onChange={(next) => setRegrasAplicacao(next)}
      />
      {extracaoOpen && (
        <AplicacaoExtracaoDadosModal
          selectedCompany={selectedCompany}
          onClose={() => setExtracaoOpen(false)}
        />
      )}
      <BalancetePeriodoModal
        isOpen={periodoModalOpen}
        onConfirm={handlePeriodoConfirmado}
        onCancel={() => setPeriodoModalOpen(false)}
      />
    </div>
  );
}
