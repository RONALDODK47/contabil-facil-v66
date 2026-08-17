/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { DailyTaxSummary } from './types';
import { motion } from 'motion/react';
import { Calendar } from 'lucide-react';

interface DailyTaxTableProps {
  dailySummaries: DailyTaxSummary[];
}

export function DailyTaxTable({ dailySummaries: allDailySummaries }: DailyTaxTableProps) {
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');

  const dailySummaries = useMemo(() => {
    if (!dataInicio && !dataFim) return allDailySummaries;
    return allDailySummaries.filter((d) => {
      if (dataInicio && (d.date || '') < dataInicio) return false;
      if (dataFim && (d.date || '') > dataFim) return false;
      return true;
    });
  }, [allDailySummaries, dataInicio, dataFim]);

  return (
    <div className="technical-panel bg-white border border-brand-border shadow-[2px_2px_0_0_#141414] rounded-none overflow-hidden mt-6">
      <div className="p-3 border-b border-brand-border flex flex-wrap items-center justify-between gap-3 bg-brand-sidebar/40">
        <h3 className="text-xs font-black uppercase tracking-widest text-brand-text">Detalhamento Diário de Impostos</h3>
        <div className="flex items-center gap-1.5 bg-white border border-brand-border px-2 py-1 shadow-[1px_1px_0_0_#141414]">
          <Calendar size={12} className="text-brand-text/60 shrink-0" />
          <span className="text-[9px] font-mono font-bold uppercase text-brand-text/60">De:</span>
          <input
            type="date"
            value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            aria-label="Data inicial do filtro"
            className="text-[10px] font-mono font-bold bg-transparent focus:outline-none text-brand-text"
          />
          <span className="text-[9px] font-mono font-bold uppercase text-brand-text/60">Até:</span>
          <input
            type="date"
            value={dataFim}
            onChange={(e) => setDataFim(e.target.value)}
            aria-label="Data final do filtro"
            className="text-[10px] font-mono font-bold bg-transparent focus:outline-none text-brand-text"
          />
          {(dataInicio || dataFim) && (
            <button
              type="button"
              onClick={() => {
                setDataInicio('');
                setDataFim('');
              }}
              className="text-[9px] font-bold uppercase text-rose-700 hover:underline ml-1"
              title="Limpar filtro de datas"
            >
              Limpar
            </button>
          )}
        </div>
        <span className="text-[10px] font-bold text-brand-text/60 uppercase tracking-widest font-mono">A Recuperar vs A Recolher</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse" id="daily-tax-table">
          <thead>
            <tr className="bg-brand-sidebar/50 border-b border-brand-border">
              <th className="px-4 py-2.5 text-[9px] font-black text-brand-text uppercase tracking-widest">Data</th>
              <th className="px-4 py-2.5 text-[9px] font-black text-brand-text uppercase tracking-widest text-center border-l border-brand-border/40" colSpan={2}>PIS</th>
              <th className="px-4 py-2.5 text-[9px] font-black text-brand-text uppercase tracking-widest text-center border-l border-brand-border/40" colSpan={2}>COFINS</th>
              <th className="px-4 py-2.5 text-[9px] font-black text-brand-text uppercase tracking-widest text-center border-l border-brand-border/40" colSpan={2}>ICMS</th>
              <th className="px-4 py-2.5 text-[9px] font-black text-brand-text uppercase tracking-widest text-center border-l border-brand-border/40" colSpan={2}>ISS</th>
              <th className="px-4 py-2.5 text-[9px] font-black text-brand-text uppercase tracking-widest text-center border-l border-brand-border/40" colSpan={2}>CSLL</th>
              <th className="px-4 py-2.5 text-[9px] font-black text-brand-text uppercase tracking-widest text-center border-l border-brand-border/40" colSpan={2}>IRPJ</th>
              <th className="px-4 py-2.5 text-[9px] font-black text-brand-text uppercase tracking-widest text-center border-l border-brand-border/40" colSpan={2}>SIMPLES</th>
            </tr>
            <tr className="bg-brand-sidebar/20 border-b border-brand-border text-[9px] font-black uppercase">
              <th className="px-4 py-1.5"></th>
              <th className="px-3 py-1.5 text-center border-l border-brand-border/40 text-rose-700">Recuperar</th>
              <th className="px-3 py-1.5 text-center text-emerald-700">Recolher</th>
              <th className="px-3 py-1.5 text-center border-l border-brand-border/40 text-rose-700">Recuperar</th>
              <th className="px-3 py-1.5 text-center text-emerald-700">Recolher</th>
              <th className="px-3 py-1.5 text-center border-l border-brand-border/40 text-rose-700">Recuperar</th>
              <th className="px-3 py-1.5 text-center text-emerald-700">Recolher</th>
              <th className="px-3 py-1.5 text-center border-l border-brand-border/40 text-rose-700">Recuperar</th>
              <th className="px-3 py-1.5 text-center text-emerald-700">Recolher</th>
              <th className="px-3 py-1.5 text-center border-l border-brand-border/40 text-rose-700">Recuperar</th>
              <th className="px-3 py-1.5 text-center text-emerald-700">Recolher</th>
              <th className="px-3 py-1.5 text-center border-l border-brand-border/40 text-rose-700">Recuperar</th>
              <th className="px-3 py-1.5 text-center text-emerald-700">Recolher</th>
              <th className="px-3 py-1.5 text-center border-l border-brand-border/40 text-rose-700">Recuperar</th>
              <th className="px-3 py-1.5 text-center text-emerald-700">Recolher</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border/30 font-mono text-xs">
            {dailySummaries.map((day, idx) => (
              <motion.tr
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: Math.min(idx * 0.015, 0.4) }}
                key={day.date}
                className="hover:bg-brand-sidebar/20 transition-colors"
              >
                <td className="px-4 py-2.5 text-brand-text tabular-nums font-sans">
                  <div className="flex items-center space-x-2">
                    <Calendar size={13} className="text-brand-text/50 shrink-0" />
                    <span className="font-mono">{day.date ? (day.date.includes('-') ? new Date(day.date + 'T00:00:00').toLocaleDateString('pt-BR') : day.date) : '---'}</span>
                  </div>
                </td>
                
                {/* PIS */}
                <td className="px-3 py-2.5 text-rose-700 text-right tabular-nums border-l border-brand-border/30 font-bold">
                  {day.pisRecuperar > 0 ? day.pisRecuperar.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '-'}
                </td>
                <td className="px-3 py-2.5 text-emerald-700 text-right tabular-nums font-bold">
                  {day.pisRecolher > 0 ? day.pisRecolher.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '-'}
                </td>

                {/* COFINS */}
                <td className="px-3 py-2.5 text-rose-700 text-right tabular-nums border-l border-brand-border/30 font-bold">
                  {day.cofinsRecuperar > 0 ? day.cofinsRecuperar.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '-'}
                </td>
                <td className="px-3 py-2.5 text-emerald-700 text-right tabular-nums font-bold">
                  {day.cofinsRecolher > 0 ? day.cofinsRecolher.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '-'}
                </td>

                {/* ICMS */}
                <td className="px-3 py-2.5 text-rose-700 text-right tabular-nums border-l border-brand-border/30 font-bold">
                  {day.icmsRecuperar > 0 ? day.icmsRecuperar.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '-'}
                </td>
                <td className="px-3 py-2.5 text-emerald-700 text-right tabular-nums font-bold">
                  {day.icmsRecolher > 0 ? day.icmsRecolher.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '-'}
                </td>

                {/* ISS */}
                <td className="px-3 py-2.5 text-rose-700 text-right tabular-nums border-l border-brand-border/30 font-bold">
                  {day.issRecuperar > 0 ? day.issRecuperar.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '-'}
                </td>
                <td className="px-3 py-2.5 text-emerald-700 text-right tabular-nums font-bold">
                  {day.issRecolher > 0 ? day.issRecolher.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '-'}
                </td>

                {/* CSLL */}
                <td className="px-3 py-2.5 text-rose-700 text-right tabular-nums border-l border-brand-border/30 font-bold">
                  {day.csllRecuperar > 0 ? day.csllRecuperar.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '-'}
                </td>
                <td className="px-3 py-2.5 text-emerald-700 text-right tabular-nums font-bold">
                  {day.csllRecolher > 0 ? day.csllRecolher.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '-'}
                </td>

                {/* IRPJ */}
                <td className="px-3 py-2.5 text-rose-700 text-right tabular-nums border-l border-brand-border/30 font-bold">
                  {day.irpjRecuperar > 0 ? day.irpjRecuperar.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '-'}
                </td>
                <td className="px-3 py-2.5 text-emerald-700 text-right tabular-nums font-bold">
                  {day.irpjRecolher > 0 ? day.irpjRecolher.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '-'}
                </td>

                {/* SIMPLES */}
                <td className="px-3 py-2.5 text-rose-700 text-right tabular-nums border-l border-brand-border/30 font-bold">
                  {day.simplesRecuperar > 0 ? day.simplesRecuperar.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '-'}
                </td>
                <td className="px-3 py-2.5 text-emerald-700 text-right tabular-nums font-bold">
                  {day.simplesRecolher > 0 ? day.simplesRecolher.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '-'}
                </td>
              </motion.tr>
            ))}
            {dailySummaries.length === 0 && (
              <tr>
                <td colSpan={15} className="px-6 py-8 text-center text-brand-text/50 italic text-xs font-sans">
                  Nenhum detalhamento diário no período.
                </td>
              </tr>
            )}
          </tbody>
          {dailySummaries.length > 0 && (
            <tfoot className="bg-brand-text text-white font-bold text-xs font-mono border-t border-brand-border">
              <tr>
                <td className="px-4 py-2.5 uppercase font-sans">Totais</td>
                <td className="px-3 py-2.5 text-right tabular-nums border-l border-brand-border/40 text-rose-300">
                  {dailySummaries.reduce((sum, d) => sum + d.pisRecuperar, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-emerald-300">
                  {dailySummaries.reduce((sum, d) => sum + d.pisRecolher, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums border-l border-brand-border/40 text-rose-300">
                  {dailySummaries.reduce((sum, d) => sum + d.cofinsRecuperar, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-emerald-300">
                  {dailySummaries.reduce((sum, d) => sum + d.cofinsRecolher, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums border-l border-brand-border/40 text-rose-300">
                  {dailySummaries.reduce((sum, d) => sum + d.icmsRecuperar, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-emerald-300">
                  {dailySummaries.reduce((sum, d) => sum + d.icmsRecolher, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums border-l border-brand-border/40 text-rose-300">
                  {dailySummaries.reduce((sum, d) => sum + d.issRecuperar, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-emerald-300">
                  {dailySummaries.reduce((sum, d) => sum + d.issRecolher, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums border-l border-brand-border/40 text-rose-300">
                  {dailySummaries.reduce((sum, d) => sum + d.csllRecuperar, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-emerald-300">
                  {dailySummaries.reduce((sum, d) => sum + d.csllRecolher, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums border-l border-brand-border/40 text-rose-300">
                  {dailySummaries.reduce((sum, d) => sum + d.irpjRecuperar, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-emerald-300">
                  {dailySummaries.reduce((sum, d) => sum + d.irpjRecolher, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums border-l border-brand-border/40 text-rose-300">
                  {dailySummaries.reduce((sum, d) => sum + d.simplesRecuperar, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-emerald-300">
                  {dailySummaries.reduce((sum, d) => sum + d.simplesRecolher, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
