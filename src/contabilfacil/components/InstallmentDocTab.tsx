import { useMemo, useState } from 'react';
import { format, isValid, parseISO } from 'date-fns';
import {
  ChevronDown,
  ChevronRight,
  FileDown,
  FileText,
  Folder,
  FolderOpen,
  Search,
  Trash2,
} from 'lucide-react';
import { formatCurrency, formatDate } from '../lib/utils';
import type { SavedParcelamento } from '../logic/parcelamentoStorage';
import { parseCurrency } from '../../lib/simTabFields';
import {
  coletarLancamentosJurosParcelamento,
  cronogramaParcelamento,
  downloadParcelamentoRelatorioPdf,
  downloadParcelamentoTxtPlus,
  fromSavedParcelamentoLike,
  generateParcelamentoTxtPlus,
  jurosPorCompetenciaParcelamento,
  mergeSelicAoVivoParaExport,
  parcelamentoCpcCurtoLongo,
} from '../../lib/parcelamentoDominioExport';

export interface InstallmentDocTabProps {
  items: SavedParcelamento[];
  onDelete: (id: string) => void;
}

function folderName(p: SavedParcelamento): string {
  return p.clienteNome.trim().toUpperCase() || 'SEM CLIENTE';
}

function baseNomeArquivoExport(p: SavedParcelamento): string {
  const partes: string[] = [];
  const nome = p.nomeParcelamento.trim();
  const num = (p.numeroParcelamento ?? '').trim();
  if (nome) partes.push(nome);
  if (num) partes.push(num);
  if (partes.length === 0) partes.push(p.id);
  return (
    partes
      .join('_')
      .replace(/\s+/g, '_')
      .replace(/[^\w-]/g, '')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '') || 'parcelamento'
  );
}

export default function InstallmentDocTab({ items, onDelete }: InstallmentDocTabProps) {
  const [search, setSearch] = useState('');
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const grouped = useMemo(() => {
    const groups: Record<string, SavedParcelamento[]> = {};
    for (const item of items) {
      const key = folderName(item);
      const haystack = `${key} ${item.nomeParcelamento} ${item.numeroParcelamento ?? ''}`.toLowerCase();
      if (search.trim() && !haystack.includes(search.trim().toLowerCase())) continue;
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b, 'pt-BR'));
  }, [items, search]);

  const toggleFolder = (name: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleItem = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exportTxt = (p: SavedParcelamento) => {
    const inp = mergeSelicAoVivoParaExport(fromSavedParcelamentoLike(p), null);
    const cron = cronogramaParcelamento(inp, parseCurrency);
    if (cron.length === 0) {
      alert('Parcelamento sem cronograma válido.');
      return;
    }
    const lanc = coletarLancamentosJurosParcelamento(inp, parseCurrency, cron);
    if (lanc.length === 0) {
      alert('Nenhum lançamento configurado. Revise contas e juros no cronograma.');
      return;
    }
    downloadParcelamentoTxtPlus(
      `${baseNomeArquivoExport(p)}_juros_txtplus.txt`,
      generateParcelamentoTxtPlus(inp, parseCurrency, cron),
    );
  };

  const exportPdf = (p: SavedParcelamento) => {
    const inp = mergeSelicAoVivoParaExport(fromSavedParcelamentoLike(p), null);
    const cron = cronogramaParcelamento(inp, parseCurrency);
    if (cron.length === 0) {
      alert('Parcelamento sem cronograma válido.');
      return;
    }
    downloadParcelamentoRelatorioPdf(inp, parseCurrency, formatCurrency, baseNomeArquivoExport(p));
  };

  return (
    <div className="technical-panel shadow-[4px_4px_0_0_#141414] overflow-hidden">
      <div className="px-4 py-3 border-b border-brand-border bg-brand-sidebar/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em]">Doc. Parcelamentos</h3>
          <p className="text-[9px] font-mono opacity-50 mt-0.5">
            {items.length} documento(s) · {grouped.length} pasta(s)
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-border/50" size={14} />
          <input
            type="text"
            aria-label="Buscar pasta, cliente ou referência"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="BUSCAR PASTA, CLIENTE OU REF..."
            className="w-full pl-9 pr-3 py-2 bg-white border border-brand-border text-[10px] font-mono font-bold uppercase tracking-wide outline-none focus:bg-brand-sidebar/10"
          />
        </div>
      </div>

      <div className="module-table-viewport">
        {items.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Nenhum parcelamento salvo. Registre um cronograma na aba Cronogramas.
            </p>
          </div>
        ) : grouped.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Nenhum documento corresponde à busca.
            </p>
          </div>
        ) : (
          grouped.map(([folder, folderItems]) => {
            const isOpen = !collapsedFolders.has(folder) || search.length > 0;
            const folderTotal = folderItems.reduce(
              (acc, item) =>
                acc + parseCurrency(item.valorParcelaStr) * Math.max(1, parseInt(item.quantidadeParcelasStr, 10) || 1),
              0,
            );

            return (
              <div key={folder} className="border-b border-brand-border/20 last:border-b-0">
                <button
                  type="button"
                  onClick={() => toggleFolder(folder)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-brand-sidebar/30 transition-colors"
                >
                  <span className="text-brand-border/70">
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                  <span className="text-brand-border">
                    {isOpen ? <FolderOpen size={16} /> : <Folder size={16} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-black uppercase tracking-wide truncate">{folder}</p>
                    <p className="text-[9px] font-mono opacity-50">
                      {folderItems.length} doc(s) · {formatCurrency(folderTotal)}
                    </p>
                  </div>
                </button>

                {isOpen ? (
                  <div className="pb-2 pl-4 pr-2 space-y-1">
                    {folderItems.map((p) => {
                      const isExpanded = expandedIds.has(p.id);
                      const qty = Math.max(1, parseInt(String(p.quantidadeParcelasStr).replace(/\D/g, ''), 10) || 1);
                      const parcelValue = parseCurrency(p.valorParcelaStr);
                      const savedAt = (() => {
                        const d = parseISO(p.createdAt);
                        return isValid(d) ? format(d, 'dd/MM/yyyy HH:mm') : '—';
                      })();

                      return (
                        <div key={p.id} className="space-y-1">
                          <div className="w-full flex flex-wrap items-center gap-3 px-3 py-2.5 border border-brand-border/15 bg-white hover:border-brand-border/50 hover:bg-brand-sidebar/20 transition-all">
                            <button
                              type="button"
                              onClick={() => toggleItem(p.id)}
                              className="p-1 hover:bg-brand-sidebar/40 shrink-0"
                              title="Ver detalhes"
                            >
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                            <div className="min-w-0 flex-1">
                              <p className="text-[11px] font-mono font-bold truncate">
                                {p.nomeParcelamento || p.numeroParcelamento || '(sem nome)'}
                              </p>
                              <p className="text-[9px] uppercase tracking-wide opacity-50 truncate">
                                Ref. {p.numeroParcelamento || '—'} · {qty}× {formatCurrency(parcelValue)} · 1ª{' '}
                                {formatDate(p.dataInicioPrimeiraParcelaStr)}
                              </p>
                            </div>
                            <p className="text-[11px] font-mono font-black shrink-0">{formatCurrency(parcelValue * qty)}</p>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => exportTxt(p)}
                                className="p-1.5 border border-brand-border/30 hover:bg-brand-sidebar/40"
                                title="Exportar TXT+"
                              >
                                <FileText size={12} />
                              </button>
                              <button
                                type="button"
                                onClick={() => exportPdf(p)}
                                className="p-1.5 border border-brand-border/30 hover:bg-brand-sidebar/40"
                                title="Exportar PDF"
                              >
                                <FileDown size={12} />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (confirm('Excluir este documento de parcelamento?')) onDelete(p.id);
                                }}
                                className="p-1.5 text-red-600 hover:bg-red-50 transition-colors"
                                title="Excluir"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>

                          {isExpanded ? (
                            <div className="px-3 py-3 bg-brand-sidebar/10 border border-brand-border/15 space-y-3">
                              <div className="text-[10px] font-mono space-y-1 px-3">
                                <p>
                                  <span className="font-black uppercase opacity-50">Salvo em:</span> {savedAt}
                                </p>
                                <p>
                                  <span className="font-black uppercase opacity-50">Variação:</span>{' '}
                                  {p.variacaoValorParcelas === 'por_faixa'
                                    ? 'Por faixa'
                                    : p.variacaoValorParcelas === 'selic_dias'
                                      ? 'SELIC (dias)'
                                      : 'Valor fixo'}
                                </p>
                              </div>
                              {(() => {
                                const inpSalvo = mergeSelicAoVivoParaExport(fromSavedParcelamentoLike(p), null);
                                const cronCompleto = cronogramaParcelamento(inpSalvo, parseCurrency);
                                const jurosPorLinha = jurosPorCompetenciaParcelamento(inpSalvo, cronCompleto, parseCurrency);
                                const mini = cronCompleto.slice(0, 24);
                                const cpcRollingMeses = 2;
                                if (mini.length === 0) return null;
                                let acum = 0;
                                return (
                                  <div className="overflow-x-auto border border-brand-border/20 bg-white">
                                    <table className="w-max min-w-full border-collapse text-[10px] leading-tight font-mono">
                                      <thead className="technical-grid-header">
                                        <tr>
                                          <th className="text-left px-2 py-1.5 whitespace-nowrap">Parc.</th>
                                          <th className="text-left px-2 py-1.5 whitespace-nowrap">Data</th>
                                          <th className="text-right px-2 py-1.5 whitespace-nowrap">Valor do parcelamento</th>
                                          <th className="text-right px-2 py-1.5 whitespace-nowrap">Valor total parcelamento</th>
                                          <th className="text-right px-2 py-1.5 whitespace-nowrap">Juros</th>
                                          <th className="text-right px-2 py-1.5 whitespace-nowrap">Parcela bruta</th>
                                          <th className="text-right px-2 py-1.5 whitespace-nowrap">Curto prazo</th>
                                          <th className="text-right px-2 py-1.5 whitespace-nowrap">Longo prazo</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-brand-border/10">
                                        {mini.map((r, idx) => {
                                          acum += r.valor;
                                          const cpc = parcelamentoCpcCurtoLongo(cronCompleto, idx, cpcRollingMeses);
                                          const saldoDevedor = cpc.curto + cpc.longo;
                                          const curto = cpc.longo === 0 ? saldoDevedor : cpc.curto;
                                          const longo = cpc.longo === 0 ? 0 : cpc.longo;
                                          const jurosLinha = jurosPorLinha[idx] ?? 0;
                                          const bruta = r.valor + jurosLinha;
                                          return (
                                            <tr key={`${p.id}-row-${idx}`}>
                                              <td className="px-2 py-1 whitespace-nowrap">{r.n}</td>
                                              <td className="px-2 py-1 whitespace-nowrap">{format(r.date, 'dd/MM/yyyy')}</td>
                                              <td className="px-2 py-1 text-right whitespace-nowrap">{formatCurrency(r.valor)}</td>
                                              <td className="px-2 py-1 text-right whitespace-nowrap">{formatCurrency(acum)}</td>
                                              <td className="px-2 py-1 text-right whitespace-nowrap">{formatCurrency(jurosLinha)}</td>
                                              <td className="px-2 py-1 text-right whitespace-nowrap">{formatCurrency(bruta)}</td>
                                              <td className="px-2 py-1 text-right whitespace-nowrap">{formatCurrency(curto)}</td>
                                              <td className="px-2 py-1 text-right whitespace-nowrap">{formatCurrency(longo)}</td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                );
                              })()}
                            </div>
                          ) : null}
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
}
