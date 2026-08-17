/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Accumulator } from './types';
import { motion } from 'motion/react';
import { Layers } from 'lucide-react';

interface AccumulatorTableProps {
  accumulators: Accumulator[];
}

export function AccumulatorTable({ accumulators }: AccumulatorTableProps) {
  return (
    <div className="technical-panel bg-white border border-brand-border shadow-[2px_2px_0_0_#141414] rounded-none overflow-hidden mt-6">
      <div className="p-3 border-b border-brand-border flex items-center justify-between bg-rose-50/40">
        <h3 className="text-xs font-black uppercase tracking-widest text-brand-text flex items-center space-x-2">
          <Layers size={16} className="text-rose-700" />
          <span>Impostos a recuperar por CFOP / Acumulador (Entradas)</span>
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse" id="accumulator-table">
          <thead>
            <tr className="bg-brand-sidebar/40 border-b border-brand-border text-[9px] font-black text-brand-text uppercase tracking-widest">
              <th className="px-4 py-2.5">Código / CFOP</th>
              <th className="px-4 py-2.5">Descrição / Conta</th>
              <th className="px-4 py-2.5 text-center">Notas</th>
              <th className="px-4 py-2.5 text-right">Valor Total (R$)</th>
              <th className="px-4 py-2.5 text-right">PIS (R$)</th>
              <th className="px-4 py-2.5 text-right">COFINS (R$)</th>
              <th className="px-4 py-2.5 text-right">ICMS (R$)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border/30 text-xs font-mono">
            {accumulators.map((acc, idx) => (
              <motion.tr
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: Math.min(idx * 0.02, 0.4) }}
                key={acc.code}
                className="hover:bg-brand-sidebar/20 transition-colors"
              >
                <td className="px-4 py-2.5 font-bold text-blue-700">{acc.code}</td>
                <td className="px-4 py-2.5 text-brand-text/80 font-sans italic">{acc.description || 'Sem descrição'}</td>
                <td className="px-4 py-2.5 text-center text-brand-text/70">{acc.count.toFixed(1)}</td>
                <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${acc.totalValue < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                  {acc.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-2.5 text-right text-brand-text/80 tabular-nums">
                  {acc.pis.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-2.5 text-right text-brand-text/80 tabular-nums">
                  {acc.cofins.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-2.5 text-right text-brand-text/80 tabular-nums">
                  {acc.icms.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
              </motion.tr>
            ))}
            {accumulators.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-brand-text/50 italic text-xs font-sans">
                  Nenhum acumulador de entrada identificado no período.
                </td>
              </tr>
            )}
          </tbody>
          {accumulators.length > 0 && (
            <tfoot className="bg-brand-text text-white font-bold border-t border-brand-border text-xs font-mono">
              <tr>
                <td className="px-4 py-2.5 font-sans uppercase">TOTAIS</td>
                <td className="px-4 py-2.5"></td>
                <td className="px-4 py-2.5 text-center">
                  {accumulators.reduce((sum, a) => sum + a.count, 0).toFixed(1)}
                </td>
                <td className={`px-4 py-2.5 text-right tabular-nums ${
                  accumulators.reduce((sum, a) => sum + a.totalValue, 0) < 0 ? 'text-rose-300' : 'text-emerald-300'
                }`}>
                  {accumulators.reduce((sum, a) => sum + a.totalValue, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {accumulators.reduce((sum, a) => sum + a.pis, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {accumulators.reduce((sum, a) => sum + a.cofins, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {accumulators.reduce((sum, a) => sum + a.icms, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
