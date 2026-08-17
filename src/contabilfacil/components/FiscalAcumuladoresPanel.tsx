import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ListOrdered, Layers } from 'lucide-react';
import { formatCurrency } from '../lib/utils';
import { readManagerData } from '../logic/companyWorkspace';
import type { FiscalSpedArquivoSalvo } from '../logic/fiscalSpedAutomation';
import {
  buildFiscalAcumuladorGroups,
  notaFiscalRotulo,
  type FiscalAcumuladorGroup,
} from '../logic/fiscalAcumuladorModel';
import { buildFiscalNotaAcumuladorArvore } from '../logic/fiscalNotaAcumuladorTree';
import { spedFiscalItemLabel, sanitizeParsedSpedFiscal } from '../../extratoVision/utils/spedFiscalParser';
import {
  contasParaImpostoLancamento,
  type FiscalContasImpostoConfig,
} from '../logic/fiscalContasImposto';
import {
  loadFiscalAcumuladorContas,
  patchFiscalAcumuladorConta,
  type FiscalAcumuladorContasMap,
} from '../logic/fiscalAcumuladorContasStorage';
import {
  loadFiscalAcumuladorRegras,
  type FiscalAcumuladorRegra,
} from '../logic/fiscalAcumuladorRegrasStorage';
import { loadFiscalNotaBloqueio } from '../logic/fiscalNotaBloqueioStorage';
import { separarNotasFiscais } from '../logic/fiscalNotaBloqueio';
import ExtratoContaPicker, { type ExtratoPlanoContaOption } from './ExtratoContaPicker';
import FiscalAcumuladorRegrasModal from './FiscalAcumuladorRegrasModal';
import FiscalDataFiltroBar from './FiscalDataFiltroBar';
import FiscalNotaAcumuladoresTree from './FiscalNotaAcumuladoresTree';
import { fiscalDataNoIntervalo } from '../logic/fiscalDateFilter';
import { CF_INPUT_ACCOUNT } from '../lib/formFieldClasses';

type PlanoRow = { code: string; name: string; codigoReduzido?: string };

type Props = {
  selectedCompany: string;
  contasImposto: FiscalContasImpostoConfig;
};

function carregarArquivos(empresa: string): FiscalSpedArquivoSalvo[] {
  return readManagerData<FiscalSpedArquivoSalvo>(empresa, 'fiscalSped').map((arq) => ({
    ...arq,
    parsed: sanitizeParsedSpedFiscal(arq.parsed),
  }));
}

function contarBucketsComNotasNoPeriodo(
  arvore: ReturnType<typeof buildFiscalNotaAcumuladorArvore>,
  dataInicio: string,
  dataFim: string,
): number {
  if (!dataInicio && !dataFim) {
    return arvore.reduce((s, sec) => s + sec.buckets.length, 0);
  }
  return arvore.reduce((s, sec) => {
    return (
      s +
      sec.buckets.filter((b) =>
        b.notasFiscais.some((nf) =>
          fiscalDataNoIntervalo(nf.data || '', dataInicio || undefined, dataFim || undefined),
        ),
      ).length
    );
  }, 0);
}

export default function FiscalAcumuladoresPanel({ selectedCompany, contasImposto }: Props) {
  const [arquivos, setArquivos] = useState<FiscalSpedArquivoSalvo[]>(() =>
    carregarArquivos(selectedCompany),
  );
  const [acumuladorContas, setAcumuladorContas] = useState<FiscalAcumuladorContasMap>(() =>
    loadFiscalAcumuladorContas(selectedCompany),
  );
  const [regras, setRegras] = useState<FiscalAcumuladorRegra[]>(() =>
    loadFiscalAcumuladorRegras(selectedCompany),
  );
  const [bloqueioConfig, setBloqueioConfig] = useState(() => loadFiscalNotaBloqueio(selectedCompany));
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [spedApuracaoOpen, setSpedApuracaoOpen] = useState(false);
  const [regrasOpen, setRegrasOpen] = useState(false);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');

  useEffect(() => {
    setArquivos(carregarArquivos(selectedCompany));
    setAcumuladorContas(loadFiscalAcumuladorContas(selectedCompany));
    setRegras(loadFiscalAcumuladorRegras(selectedCompany));
    setBloqueioConfig(loadFiscalNotaBloqueio(selectedCompany));
    setExpanded({});
  }, [selectedCompany]);

  useEffect(() => {
    const onUpdate = () => {
      setArquivos(carregarArquivos(selectedCompany));
      setBloqueioConfig(loadFiscalNotaBloqueio(selectedCompany));
    };
    window.addEventListener('contabilfacil-fiscal-sped-updated', onUpdate);
    return () => window.removeEventListener('contabilfacil-fiscal-sped-updated', onUpdate);
  }, [selectedCompany]);

  useEffect(() => {
    return () => {};
  }, []);

  const planoOptions = useMemo((): ExtratoPlanoContaOption[] => {
    const rows = readManagerData<PlanoRow>(selectedCompany, 'plano');
    return rows
      .filter((r) => r.code?.trim())
      .map((r) => ({
        code: r.code.trim(),
        name: (r.name ?? '').trim() || r.code,
        codigoReduzido: r.codigoReduzido,
      }));
  }, [selectedCompany, arquivos.length]);

  const groups = useMemo(
    () => buildFiscalAcumuladorGroups(arquivos, bloqueioConfig),
    [arquivos, bloqueioConfig],
  );

  const arvore = useMemo(
    () => buildFiscalNotaAcumuladorArvore(arquivos, bloqueioConfig),
    [arquivos, bloqueioConfig],
  );

  const nfAcumuladores = useMemo(
    () =>
      arvore.flatMap((sec) =>
        sec.buckets.map((b) => ({
          key: b.bucketKey,
          label: `${sec.titulo} · ${b.titulo}`,
        })),
      ),
    [arvore],
  );

  const totalBuckets = useMemo(
    () => arvore.reduce((s, sec) => s + sec.buckets.length, 0),
    [arvore],
  );

  const bucketsFiltrados = useMemo(
    () => contarBucketsComNotasNoPeriodo(arvore, dataInicio, dataFim),
    [arvore, dataFim, dataInicio],
  );

  const totalNotasBloqueadas = useMemo(() => {
    const notas = arquivos.flatMap((a) => a.parsed.notasFiscais ?? []);
    return separarNotasFiscais(notas, bloqueioConfig).bloqueadas.length;
  }, [arquivos, bloqueioConfig]);

  const groupsFiltrados = useMemo(() => {
    if (!dataInicio && !dataFim) return groups;
    return groups.filter((group) => {
      const ref = group.item.data || group.periodo;
      if (fiscalDataNoIntervalo(ref, dataInicio || undefined, dataFim || undefined)) return true;
      return group.notasFiscais.some((nf) =>
        fiscalDataNoIntervalo(nf.data || '', dataInicio || undefined, dataFim || undefined),
      );
    });
  }, [dataFim, dataInicio, groups]);

  const notasFiltradasPorGrupo = useCallback(
    (group: FiscalAcumuladorGroup) => {
      if (!dataInicio && !dataFim) return group.notasFiscais;
      return group.notasFiscais.filter((nf) =>
        fiscalDataNoIntervalo(nf.data || '', dataInicio || undefined, dataFim || undefined),
      );
    },
    [dataFim, dataInicio],
  );

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const handleAcumuladorContasChange = useCallback((next: FiscalAcumuladorContasMap) => {
    setAcumuladorContas(next);
    window.dispatchEvent(new CustomEvent('contabilfacil-fiscal-sped-updated'));
  }, []);

  const patchConta = useCallback(
    (key: string, field: 'debito' | 'credito', value: string) => {
      handleAcumuladorContasChange(patchFiscalAcumuladorConta(selectedCompany, key, { [field]: value }));
    },
    [handleAcumuladorContasChange, selectedCompany],
  );

  const resolveContas = useCallback(
    (group: FiscalAcumuladorGroup) => {
      const custom = acumuladorContas[group.key];
      if (custom?.debito || custom?.credito) {
        return { debito: custom.debito, credito: custom.credito };
      }
      const natureza = group.item.natureza ?? 'credora';
      return contasParaImpostoLancamento(contasImposto, group.item.imposto, natureza);
    },
    [acumuladorContas, contasImposto],
  );

  const temNotas = arvore.some((s) => s.totalNotas > 0);

  return (
    <div className="space-y-4">
      <div className="technical-panel shadow-[4px_4px_0_0_#141414] overflow-hidden">
        <div className="px-4 py-3 border-b border-brand-border bg-brand-sidebar/30 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Layers size={14} className="opacity-60" />
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-widest">Acumuladores</h3>
              <p className="text-[9px] font-bold uppercase opacity-50 mt-0.5 max-w-2xl">
                Entradas: compras para revenda, uso e consumo, serviços. Saídas: receita de vendas e
                demais grupos. Remessas não são importadas.
                {totalNotasBloqueadas > 0 ? (
                  <span className="block mt-1 text-amber-800 normal-case">
                    {totalNotasBloqueadas} NF(s) filtrada(s) — não entram nos acumuladores.
                  </span>
                ) : null}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setRegrasOpen(true)}
            className="technical-button text-[10px] px-3 py-2 flex items-center gap-2 font-bold"
          >
            <ListOrdered size={14} />
            Regras de contas
            {regras.length > 0 ? (
              <span className="text-[9px] opacity-70">({regras.length})</span>
            ) : null}
          </button>
        </div>

        {temNotas && (
          <FiscalDataFiltroBar
            dataInicio={dataInicio}
            dataFim={dataFim}
            onDataInicioChange={setDataInicio}
            onDataFimChange={setDataFim}
            totalFiltrado={bucketsFiltrados}
            totalGeral={totalBuckets}
            label="Filtrar notas por data"
          />
        )}

        <div className="module-table-viewport max-h-[min(70vh,780px)] overflow-y-auto">
          <FiscalNotaAcumuladoresTree
            arquivos={arquivos}
            bloqueio={bloqueioConfig}
            dataInicio={dataInicio}
            dataFim={dataFim}
            selectedCompany={selectedCompany}
            acumuladorContas={acumuladorContas}
            onAcumuladorContasChange={handleAcumuladorContasChange}
            planoOptions={planoOptions}
            expanded={expanded}
            onToggleExpand={toggleExpand}
          />
        </div>
      </div>

      {groups.length > 0 && (
        <div className="technical-panel shadow-[4px_4px_0_0_#141414] overflow-hidden">
          <button
            type="button"
            onClick={() => setSpedApuracaoOpen((v) => !v)}
            className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-brand-sidebar/10 transition-colors border-b border-brand-border/20"
          >
            {spedApuracaoOpen ? (
              <ChevronDown size={14} className="shrink-0 opacity-60" />
            ) : (
              <ChevronRight size={14} className="shrink-0 opacity-60" />
            )}
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-widest">Apuração SPED</h3>
              <p className="text-[9px] font-bold uppercase opacity-50 mt-0.5">
                Registros técnicos do arquivo (C190, M210, etc.) — {groups.length} linha(s)
              </p>
            </div>
          </button>

          {spedApuracaoOpen && (
            <div className="module-table-viewport max-h-[min(50vh,520px)] overflow-y-auto">
              {groupsFiltrados.length === 0 ? (
                <p className="py-12 text-center text-slate-400 uppercase text-[10px] px-4">
                  Nenhum registro SPED no período selecionado.
                </p>
              ) : (
                <ul className="divide-y divide-brand-border/15">
                  {groupsFiltrados.map((group) => {
                    const isOpen = Boolean(expanded[`sped-${group.id}`]);
                    const contas = resolveContas(group);
                    const notasVisiveis = notasFiltradasPorGrupo(group);
                    const nfCount = notasVisiveis.length;
                    return (
                      <li key={group.id} className="bg-brand-bg">
                        <button
                          type="button"
                          onClick={() => toggleExpand(`sped-${group.id}`)}
                          className="w-full text-left px-4 py-3 flex flex-wrap items-center gap-3 hover:bg-brand-sidebar/10 transition-colors"
                        >
                          {isOpen ? (
                            <ChevronDown size={14} className="shrink-0 opacity-60" />
                          ) : (
                            <ChevronRight size={14} className="shrink-0 opacity-60" />
                          )}
                          <div className="flex-1 min-w-[200px]">
                            <p className="text-[10px] font-black uppercase font-mono">
                              {group.item.registro} · {group.item.codigo}
                            </p>
                            <p className="text-[9px] font-bold mt-0.5 line-clamp-2">
                              {spedFiscalItemLabel(group.item)}
                            </p>
                            <p className="text-[8px] opacity-50 mt-1 uppercase">
                              {group.fileName} · {group.periodo} · {group.item.imposto}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[10px] font-bold tabular-nums">
                              {formatCurrency(group.item.valor)}
                            </p>
                            <p className="text-[8px] uppercase opacity-60 mt-0.5">
                              {nfCount} NF{nfCount !== 1 ? 's' : ''}
                            </p>
                          </div>
                        </button>

                        {isOpen && (
                          <div className="px-4 pb-4 pt-0 border-t border-brand-border/10 bg-brand-sidebar/5 space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
                              <div>
                                <label className="block text-[8px] font-bold uppercase opacity-50 mb-1">
                                  Conta débito
                                </label>
                                {planoOptions.length > 0 ? (
                                  <ExtratoContaPicker
                                    value={contas.debito}
                                    options={planoOptions}
                                    lookupOptions={planoOptions}
                                    showNomeInline
                                    onChange={(v) => patchConta(group.key, 'debito', v)}
                                    placeholder={contas.debito || 'Padrão imposto'}
                                  />
                                ) : (
                                  <input
                                    type="text"
                                    aria-label={`Conta débito ${spedFiscalItemLabel(group.item)}`}
                                    title={`Conta débito ${spedFiscalItemLabel(group.item)}`}
                                    placeholder="Código reduzido débito"
                                    className={CF_INPUT_ACCOUNT}
                                    value={contas.debito}
                                    onChange={(e) => patchConta(group.key, 'debito', e.target.value)}
                                  />
                                )}
                              </div>
                              <div>
                                <label className="block text-[8px] font-bold uppercase opacity-50 mb-1">
                                  Conta crédito
                                </label>
                                {planoOptions.length > 0 ? (
                                  <ExtratoContaPicker
                                    value={contas.credito}
                                    options={planoOptions}
                                    lookupOptions={planoOptions}
                                    showNomeInline
                                    onChange={(v) => patchConta(group.key, 'credito', v)}
                                    placeholder={contas.credito || 'Padrão imposto'}
                                  />
                                ) : (
                                  <input
                                    type="text"
                                    aria-label={`Conta crédito ${spedFiscalItemLabel(group.item)}`}
                                    title={`Conta crédito ${spedFiscalItemLabel(group.item)}`}
                                    placeholder="Código reduzido crédito"
                                    className={CF_INPUT_ACCOUNT}
                                    value={contas.credito}
                                    onChange={(e) => patchConta(group.key, 'credito', e.target.value)}
                                  />
                                )}
                              </div>
                            </div>

                            {nfCount > 0 && (
                              <table className="w-full text-left text-[10px] font-mono border border-brand-border/30">
                                <thead>
                                  <tr className="text-[8px] font-black uppercase opacity-60 bg-brand-sidebar/20">
                                    <th className="px-2 py-1.5 border-b border-brand-border/30">NF</th>
                                    <th className="px-2 py-1.5 border-b border-brand-border/30">Data</th>
                                    <th className="px-2 py-1.5 border-b border-brand-border/30 text-right">
                                      Valor
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-brand-border/10">
                                  {notasVisiveis.map((nf) => (
                                    <tr
                                      key={`${nf.linha}-${nf.chave || nf.numero}`}
                                      className="hover:bg-brand-sidebar/10"
                                    >
                                      <td className="px-2 py-1.5 truncate max-w-[220px]">
                                        {notaFiscalRotulo(nf)}
                                      </td>
                                      <td className="px-2 py-1.5 tabular-nums">{nf.data || '—'}</td>
                                      <td className="px-2 py-1.5 text-right tabular-nums font-bold">
                                        {formatCurrency(nf.valorTotal)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      <FiscalAcumuladorRegrasModal
        open={regrasOpen}
        company={selectedCompany}
        regras={regras}
        planoOptions={planoOptions}
        acumuladores={groupsFiltrados}
        nfAcumuladores={nfAcumuladores}
        onClose={() => setRegrasOpen(false)}
        onChange={(next) => {
          setRegras(next);
          window.dispatchEvent(new CustomEvent('contabilfacil-fiscal-sped-updated'));
        }}
      />
    </div>
  );
}
