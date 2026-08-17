import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Trash2,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Search,
} from 'lucide-react';
import { cn, formatCurrency, formatDate } from '../lib/utils';
import { CompanyApp } from '../types';
import DataIngestionBox from './DataIngestionBox';
import AplicacaoConciliacaoTab from './AplicacaoConciliacaoTab';

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
type AppsMainTab = 'extrato' | 'conciliacao';

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
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const [expandedAppIds, setExpandedAppIds] = useState<Set<string>>(() => new Set());


  useEffect(() => {
    const all = loadAplicacoesFromBrowserStorage();
    const scoped = all.filter((item) => belongsToSindicato(item.sindicatoName, selectedCompany));
    setSavedApps(scoped);
  }, [storageVersion, selectedCompany]);

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

  const groupedExtrato = useMemo(() => {
    const needle = extratoSearch.trim().toLowerCase();
    const groups: Record<string, SavedAplicacao[]> = {};

    for (const item of savedApps) {
      const folderName = getAplicacaoFolderName(item);
      const haystack = `${folderName} ${item.nomeAplicacao} ${item.numeroAplicacao ?? ''}`.toLowerCase();
      if (needle && !haystack.includes(needle)) continue;
      if (!groups[folderName]) groups[folderName] = [];
      groups[folderName].push(item);
    }

    return Object.entries(groups).sort(([a], [b]) =>
      a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }),
    );
  }, [savedApps, extratoSearch]);

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
    { id: 'conciliacao', label: 'Conciliação de Aplicações' },
  ];

  const renderExtratoTab = () => (
    <div className="technical-panel shadow-[4px_4px_0_0_#141414] overflow-hidden">
      <div className="px-4 py-3 border-b border-brand-border bg-brand-sidebar/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em]">Extrato de Aplicações</h3>
          <p className="text-[9px] font-mono opacity-50 mt-0.5">
            {savedApps.length} aplicação(ões) · {groupedExtrato.length} pasta(s)
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-border/50" size={14} />
          <input
            type="text"
            aria-label="Buscar pasta ou ativo no extrato"
            value={extratoSearch}
            onChange={(e) => setExtratoSearch(e.target.value)}
            placeholder="BUSCAR PASTA OU ATIVO..."
            className="w-full pl-9 pr-3 py-2 bg-white border border-brand-border text-[10px] font-mono font-bold uppercase tracking-wide outline-none focus:bg-brand-sidebar/10"
          />
        </div>
      </div>

      <div className="module-table-viewport">
        {groupedExtrato.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              {savedApps.length === 0
                ? 'Nenhuma aplicação neste sindicato.'
                : 'Nenhuma aplicação corresponde à busca.'}
            </p>
          </div>
        ) : (
          groupedExtrato.map(([folderName, items]) => {
            const isOpen = !collapsedFolders.has(folderName) || extratoSearch.length > 0;
            const folderTotal = items.reduce((acc, item) => acc + parseCurrency(item.valorParcelaStr), 0);

            return (
              <div key={folderName} className="border-b border-brand-border/20 last:border-b-0">
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
                      {items.length} ativo(s) · {formatCurrency(folderTotal)}
                    </p>
                  </div>
                </button>

                {isOpen ? (
                  <div className="pb-2 pl-4 pr-2 space-y-1">
                    {items.map((item) => {
                      const app = aplicacaoToCompanyApp(item);
                      const summary = summarizeAplicacaoLancamentos(lancamentosByAppId.get(item.id) ?? []);
                      const isItemOpen = expandedAppIds.has(item.id);

                      return (
                        <div key={item.id} className="space-y-1">
                          <div className="w-full flex flex-wrap items-center gap-3 px-3 py-2.5 border border-brand-border/15 bg-white hover:border-brand-border/50 hover:bg-brand-sidebar/20 transition-all">
                            <button
                              type="button"
                              onClick={() => toggleAppExpanded(item.id)}
                              className="p-1 hover:bg-brand-sidebar/40 shrink-0"
                              title="Ver lançamentos"
                            >
                              {isItemOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                            <span className="w-7 h-7 border border-brand-border/40 flex items-center justify-center text-[10px] font-black shrink-0">
                              %
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[11px] font-mono font-bold truncate">{app.name}</p>
                              <p className="text-[9px] uppercase tracking-wide opacity-50 truncate">
                                {app.index} · {app.rate}% · Juros {formatCurrency(summary.juros)} · IRRF{' '}
                                {formatCurrency(summary.irrf)} · IOF {formatCurrency(summary.iof)}
                              </p>
                            </div>
                            <p className="text-[11px] font-mono font-black shrink-0">{formatCurrency(app.amount)}</p>
                            <button
                              type="button"
                              onClick={() => handleDelete(item.id)}
                              className="p-1 text-red-600 hover:bg-red-50 transition-colors shrink-0"
                              title="Excluir"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                          {isItemOpen ? renderLancamentosPanel(item) : null}
                        </div>
                      );
                    })}
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
            renderExtratoTab()
          ) : (
            <AplicacaoConciliacaoTab selectedCompany={selectedCompany} />
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

            {/* Extração de dados — OCR/recorte dos PDFs de aplicações */}
            <DataIngestionBox
              dataType="apps"
              title="Extração de Dados (PDF)"
              selectedCompany={selectedCompany}
              ingestionMode="pdfOnly"
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
      <BalancetePeriodoModal
        isOpen={periodoModalOpen}
        onConfirm={handlePeriodoConfirmado}
        onCancel={() => setPeriodoModalOpen(false)}
      />
    </div>
  );
}
