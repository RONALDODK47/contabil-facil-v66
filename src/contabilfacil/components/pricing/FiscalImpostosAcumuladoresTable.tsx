import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { cn, formatCurrency } from '../../lib/utils';
import type { NfeCreditoSugerido, NfeNotaResumo, PricingNfeCache } from '../../logic/pricingTypes';

export interface FiscalImpostosAcumuladoresTableProps {
  cache: PricingNfeCache | null;
  selectedRegime?: string;
}

interface ImpostoMensal {
  mes: string; // "202407"
  mesLabel: string; // "Julho 2024"
  aRecuperar: number;
  aRecolher: number;
}

interface NotaMensal {
  mes: string;
  mesLabel: string;
  notas: NfeNotaResumo[];
}

export default function FiscalImpostosAcumuladoresTable({
  cache,
  selectedRegime = 'Lucro Real',
}: FiscalImpostosAcumuladoresTableProps) {
  const [aba, setAba] = useState<'impostos' | 'acumuladores'>('impostos');
  const [dataSelecionada, setDataSelecionada] = useState<string>('');
  const [notaExpandida, setNotaExpandida] = useState<string | null>(null);

  // Agrupar impostos por mês
  const impostosPorMes = useMemo(() => {
    if (!cache?.creditosSugeridos?.length) return [];

    const grupos = new Map<string, ImpostoMensal>();

    cache.creditosSugeridos.forEach((credito) => {
      // Extrair mês de data de emissão da NF (formato na cache pode variar)
      // Usar lastSyncAt como referência se não houver data na NF
      const dataRef = (credito as any).dataEmissao || cache.lastSyncAt || new Date().toISOString();
      const dt = new Date(dataRef);
      const mes = `${String(dt.getFullYear())}${String(dt.getMonth() + 1).padStart(2, '0')}`;
      const mesLabel = dt.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });

      if (!grupos.has(mes)) {
        grupos.set(mes, {
          mes,
          mesLabel: mesLabel.charAt(0).toUpperCase() + mesLabel.slice(1),
          aRecuperar: 0,
          aRecolher: 0,
        });
      }

      const grupo = grupos.get(mes)!;

      // Lógica: se for crédito a recuperar, soma em aRecuperar; caso contrário, aRecolher
      if (
        credito.tipo?.includes('recuperar') ||
        credito.tipo?.includes('Recuperar') ||
        credito.tipo?.includes('ICMS') ||
        credito.tipo?.includes('IPI') ||
        credito.tipo?.includes('PIS') ||
        credito.tipo?.includes('COFINS')
      ) {
        // Padrão: impostos são a recuperar
        grupo.aRecuperar += credito.valor || 0;
      } else {
        grupo.aRecolher += credito.valor || 0;
      }
    });

    return Array.from(grupos.values()).sort((a, b) => b.mes.localeCompare(a.mes));
  }, [cache?.creditosSugeridos, cache?.lastSyncAt]);

  // Agrupar notas por mês
  const notasPorMes = useMemo(() => {
    if (!cache?.notas?.length) return [];

    const grupos = new Map<string, NotaMensal>();

    cache.notas.forEach((nota) => {
      const dataStr = nota.emissao || new Date().toISOString().slice(0, 10);
      const dt = new Date(dataStr + 'T00:00:00');
      const mes = `${String(dt.getFullYear())}${String(dt.getMonth() + 1).padStart(2, '0')}`;
      const mesLabel = dt.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });

      if (!grupos.has(mes)) {
        grupos.set(mes, {
          mes,
          mesLabel: mesLabel.charAt(0).toUpperCase() + mesLabel.slice(1),
          notas: [],
        });
      }

      grupos.get(mes)!.notas.push(nota);
    });

    return Array.from(grupos.values())
      .sort((a, b) => b.mes.localeCompare(a.mes))
      .map((g) => ({
        ...g,
        notas: g.notas.sort((a, b) => (b.emissao || '').localeCompare(a.emissao || '')),
      }));
  }, [cache?.notas]);

  // Filtrar por data se selecionada
  const impostosFiltrados = dataSelecionada
    ? impostosPorMes.filter((imp) => imp.mes === dataSelecionada)
    : impostosPorMes;

  const notasFiltradas = dataSelecionada
    ? notasPorMes.filter((nm) => nm.mes === dataSelecionada)
    : notasPorMes;

  const totalARecuperar = impostosFiltrados.reduce((sum, imp) => sum + imp.aRecuperar, 0);
  const totalARecolher = impostosFiltrados.reduce((sum, imp) => sum + imp.aRecolher, 0);
  const totalNotas = notasFiltradas.reduce((sum, nm) => sum + nm.notas.length, 0);
  const totalValorNotas = notasFiltradas.reduce(
    (sum, nm) => sum + nm.notas.reduce((s, n) => s + (n.total ?? 0), 0),
    0
  );

  if (!cache) {
    return (
      <div className="text-center text-[9px] opacity-60 py-4">
        Nenhuma sincronização realizada
      </div>
    );
  }

  return (
    <div className="technical-panel shadow-[3px_3px_0_0_#141414] space-y-3">
      {/* Abas */}
      <div className="border-b border-brand-border/30 flex">
        <button
          onClick={() => setAba('impostos')}
          className={cn(
            'px-4 py-2 text-[10px] font-black uppercase border-b-2 transition-colors',
            aba === 'impostos'
              ? 'border-yellow-500 text-yellow-600'
              : 'border-transparent text-opacity-60 hover:text-opacity-80'
          )}
        >
          Impostos
        </button>
        <button
          onClick={() => setAba('acumuladores')}
          className={cn(
            'px-4 py-2 text-[10px] font-black uppercase border-b-2 transition-colors',
            aba === 'acumuladores'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-opacity-60 hover:text-opacity-80'
          )}
        >
          Acumuladores ({totalNotas})
        </button>
      </div>

      {/* Seletor de Data */}
      <div className="px-4 pt-3">
        <label className="text-[9px] font-bold uppercase opacity-70 block mb-2">Filtrar por mês</label>
        <select
          value={dataSelecionada}
          onChange={(e) => setDataSelecionada(e.target.value)}
          className="w-full max-w-xs px-2 py-1 text-[9px] border border-brand-border bg-black/20 text-white rounded"
        >
          <option value="">Todos os meses</option>
          {(aba === 'impostos' ? impostosPorMes : notasPorMes).map((item) => (
            <option key={item.mes} value={item.mes}>
              {item.mesLabel}
            </option>
          ))}
        </select>
      </div>

      {/* ABA: IMPOSTOS */}
      {aba === 'impostos' && (
        <div className="space-y-3 px-4 pb-4">
          {/* Resumo do Mês */}
          <div className="grid grid-cols-2 gap-3 text-[9px]">
            <div className="bg-green-950/20 border border-green-700/50 rounded p-3">
              <p className="font-bold uppercase opacity-70">A Recuperar</p>
              <p className="text-lg font-black text-green-300 mt-1">{formatCurrency(totalARecuperar)}</p>
              <p className="text-[8px] opacity-50 mt-1">Regime: {selectedRegime}</p>
            </div>
            <div className="bg-red-950/20 border border-red-700/50 rounded p-3">
              <p className="font-bold uppercase opacity-70">A Recolher</p>
              <p className="text-lg font-black text-red-300 mt-1">{formatCurrency(totalARecolher)}</p>
              <p className="text-[8px] opacity-50 mt-1">Período: {dataSelecionada || 'Todos'}</p>
            </div>
          </div>

          {/* Lista de Meses */}
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {impostosFiltrados.length > 0 ? (
              impostosFiltrados.map((impostos) => (
                <div
                  key={impostos.mes}
                  className="border border-brand-border/30 rounded p-3 bg-brand-sidebar/10 text-[9px]"
                >
                  <div className="flex justify-between items-center mb-2">
                    <p className="font-bold">{impostos.mesLabel}</p>
                    <div className="flex gap-3 font-mono font-bold">
                      <span className="text-green-400">↓ {formatCurrency(impostos.aRecuperar)}</span>
                      <span className="text-red-400">↑ {formatCurrency(impostos.aRecolher)}</span>
                    </div>
                  </div>
                  <div className="flex gap-4 text-[8px] opacity-60">
                    <span>Recuperação: {selectedRegime}</span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-[9px] opacity-60 text-center py-4">Nenhum imposto para este período</p>
            )}
          </div>
        </div>
      )}

      {/* ABA: ACUMULADORES */}
      {aba === 'acumuladores' && (
        <div className="space-y-3 px-4 pb-4">
          {/* Resumo */}
          <div className="bg-blue-950/20 border border-blue-700/50 rounded p-3 text-[9px]">
            <p className="font-bold uppercase opacity-70">Notas Fiscais Importadas</p>
            <div className="flex justify-between items-center mt-2">
              <span className="font-black text-lg text-blue-300">{totalNotas} notas</span>
              <span className="font-mono text-blue-300">Total: {formatCurrency(totalValorNotas)}</span>
            </div>
          </div>

          {/* Lista de Notas por Mês */}
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {notasFiltradas.length > 0 ? (
              notasFiltradas.map((notaMes) => (
                <div key={notaMes.mes} className="border border-brand-border/30 rounded bg-brand-sidebar/10">
                  {/* Header do Mês */}
                  <div className="px-3 py-2 bg-brand-sidebar/20 border-b border-brand-border/20 font-bold text-[9px] uppercase">
                    {notaMes.mesLabel} ({notaMes.notas.length} notas)
                  </div>

                  {/* Notas do Mês */}
                  <div className="divide-y divide-brand-border/10">
                    {notaMes.notas.map((nota) => (
                      <div key={nota.chave} className="px-3 py-2 text-[9px]">
                        <button
                          onClick={() =>
                            setNotaExpandida(notaExpandida === nota.chave ? null : nota.chave)
                          }
                          className="w-full text-left flex justify-between items-center gap-2 hover:opacity-80 transition-opacity"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-bold truncate">
                              NF {nota.numero}/{nota.serie}
                            </p>
                            <p className="opacity-70 truncate text-[8px]">{nota.emitente}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-mono font-bold text-emerald-400">
                              {formatCurrency(nota.total ?? 0)}
                            </span>
                            {notaExpandida === nota.chave ? (
                              <ChevronUp size={14} />
                            ) : (
                              <ChevronDown size={14} />
                            )}
                          </div>
                        </button>

                        {/* Detalhes Expandidos */}
                        {notaExpandida === nota.chave && (
                          <div className="mt-2 pt-2 border-t border-brand-border/20 bg-black/20 rounded p-2 text-[8px] space-y-1 font-mono">
                            <p>
                              <span className="opacity-70">Chave:</span> {nota.chave}
                            </p>
                            <p>
                              <span className="opacity-70">Emissão:</span> {nota.emissao}
                            </p>
                            <p>
                              <span className="opacity-70">Fornecedor:</span> {nota.emitente}
                            </p>
                            <p>
                              <span className="opacity-70">Valor:</span> {formatCurrency(nota.total ?? 0)}
                            </p>
                            {(nota as any).descricao && (
                              <p>
                                <span className="opacity-70">Descrição:</span> {(nota as any).descricao}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-[9px] opacity-60 text-center py-4">
                Nenhuma nota fiscal para este período
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
