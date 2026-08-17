/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { TaxSummary } from './types';
import { ArrowUpCircle, ArrowDownCircle, Info } from 'lucide-react';

interface TaxDetailTableProps {
  summary: TaxSummary;
}

export function TaxDetailTable({ summary }: TaxDetailTableProps) {
  const toPay = [
    { name: 'PIS a Recolher', value: summary.pisRecolher, color: 'text-emerald-700' },
    { name: 'COFINS a Recolher', value: summary.cofinsRecolher, color: 'text-emerald-700' },
    { name: 'ICMS a Recolher', value: summary.icmsRecolher, color: 'text-emerald-700' },
    { name: 'ISS a Recolher', value: summary.issRecolher, color: 'text-emerald-700' },
    { name: 'CSLL a Recolher', value: summary.csllRecolher, color: 'text-emerald-700' },
    { name: 'IRPJ a Recolher', value: summary.irpjRecolher, color: 'text-emerald-700' },
    { name: 'Simples Nacional a Recolher', value: summary.simplesRecolher, color: 'text-emerald-700' },
  ];

  const toRecover = [
    { name: 'PIS a Recuperar', value: summary.pisRecuperar, color: 'text-rose-700' },
    { name: 'COFINS a Recuperar', value: summary.cofinsRecuperar, color: 'text-rose-700' },
    { name: 'ICMS a Recuperar', value: summary.icmsRecuperar, color: 'text-rose-700' },
    { name: 'ISS a Recuperar', value: summary.issRecuperar, color: 'text-rose-700' },
    { name: 'CSLL a Recuperar', value: summary.csllRecuperar, color: 'text-rose-700' },
    { name: 'IRPJ a Recuperar', value: summary.irpjRecuperar, color: 'text-rose-700' },
    { name: 'Simples Nacional a Recuperar', value: summary.simplesRecuperar, color: 'text-rose-700' },
  ];

  return (
    <div className="space-y-6 mt-6">
      {/* Impostos a Recolher & Recuperar Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Impostos a Recolher */}
        <div className="technical-panel bg-white border border-brand-border shadow-[2px_2px_0_0_#141414] rounded-none overflow-hidden">
          <div className="p-3 border-b border-brand-border flex items-center space-x-2 bg-emerald-50/40">
            <ArrowUpCircle size={18} className="text-emerald-700" />
            <h3 className="text-xs font-black uppercase tracking-widest text-brand-text">Impostos a Recolher (Saídas)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-brand-sidebar/40 border-b border-brand-border text-[9px] font-black text-brand-text uppercase tracking-widest">
                  <th className="px-4 py-2.5">Descrição do Imposto</th>
                  <th className="px-4 py-2.5 text-right">Valor Total (R$)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border/30 text-xs font-mono">
                {toPay.map((item) => (
                  <tr key={item.name} className="hover:bg-brand-sidebar/20 transition-colors">
                    <td className="px-4 py-2.5 font-sans font-medium text-brand-text">{item.name}</td>
                    <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${item.color}`}>
                      R$ {item.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-brand-text text-white font-bold text-xs font-mono border-t border-brand-border">
                <tr>
                  <td className="px-4 py-2.5 uppercase font-sans tracking-wider">Total a Recolher</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    R$ {(summary.pisRecolher + summary.cofinsRecolher + summary.icmsRecolher + summary.issRecolher + summary.csllRecolher + summary.irpjRecolher + summary.simplesRecolher).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Impostos a Recuperar */}
        <div className="technical-panel bg-white border border-brand-border shadow-[2px_2px_0_0_#141414] rounded-none overflow-hidden">
          <div className="p-3 border-b border-brand-border flex items-center space-x-2 bg-rose-50/40">
            <ArrowDownCircle size={18} className="text-rose-700" />
            <h3 className="text-xs font-black uppercase tracking-widest text-brand-text">Impostos a Recuperar (Entradas)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-brand-sidebar/40 border-b border-brand-border text-[9px] font-black text-brand-text uppercase tracking-widest">
                  <th className="px-4 py-2.5">Descrição do Imposto</th>
                  <th className="px-4 py-2.5 text-right">Valor Total (R$)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border/30 text-xs font-mono">
                {toRecover.map((item) => (
                  <tr key={item.name} className="hover:bg-brand-sidebar/20 transition-colors">
                    <td className="px-4 py-2.5 font-sans font-medium text-brand-text">{item.name}</td>
                    <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${item.color}`}>
                      R$ {item.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-brand-text text-white font-bold text-xs font-mono border-t border-brand-border">
                <tr>
                  <td className="px-4 py-2.5 uppercase font-sans tracking-wider">Total a Recuperar</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    R$ {(summary.pisRecuperar + summary.cofinsRecuperar + summary.icmsRecuperar + summary.issRecuperar + summary.csllRecuperar + summary.irpjRecuperar + summary.simplesRecuperar).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      {/* Net Balance Info */}
      <div className="p-3 bg-brand-sidebar/30 border border-brand-border rounded-none flex items-start space-x-3 text-brand-text text-xs shadow-[2px_2px_0_0_#141414]">
        <Info size={18} className="mt-0.5 flex-shrink-0 text-brand-text/70" />
        <div className="leading-relaxed">
          <p className="font-bold uppercase tracking-wider text-[10px]">Apuração Fiscal Automática</p>
          <p className="text-[11px] opacity-80 mt-0.5">Subtração dos impostos a recuperar dos impostos a recolher. Saldo positivo indica imposto devido no período, e saldo negativo indica crédito acumulado.</p>
        </div>
      </div>
    </div>
  );
}
