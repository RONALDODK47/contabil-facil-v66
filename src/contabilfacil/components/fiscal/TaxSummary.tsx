/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { TaxSummary as TaxSummaryType } from './types';
import { motion } from 'motion/react';
import { PieChart, Landmark, Scale, Building2, Receipt, Percent, ChevronDown } from 'lucide-react';

interface TaxSummaryProps {
  summary: TaxSummaryType;
}

type TaxKey = 'ICMS' | 'PIS' | 'COFINS' | 'ISS' | 'CSLL' | 'IRPJ' | 'SIMPLES';

const TAX_OPTIONS: { key: TaxKey; label: string }[] = [
  { key: 'ICMS', label: 'SALDO ICMS' },
  { key: 'PIS', label: 'SALDO PIS' },
  { key: 'COFINS', label: 'SALDO COFINS' },
  { key: 'ISS', label: 'SALDO ISS' },
  { key: 'CSLL', label: 'SALDO CSLL' },
  { key: 'IRPJ', label: 'SALDO IRPJ' },
  { key: 'SIMPLES', label: 'SIMPLES NACIONAL' },
];

function getTaxData(key: TaxKey, summary: TaxSummaryType) {
  switch (key) {
    case 'PIS':
      return {
        shortLabel: 'PIS',
        rec: summary.pisRecuperar,
        pay: summary.pisRecolher,
        icon: Landmark,
        color: 'text-blue-700',
        bg: 'bg-blue-50/50 border-blue-300',
      };
    case 'COFINS':
      return {
        shortLabel: 'COFINS',
        rec: summary.cofinsRecuperar,
        pay: summary.cofinsRecolher,
        icon: Scale,
        color: 'text-purple-700',
        bg: 'bg-purple-50/50 border-purple-300',
      };
    case 'ISS':
      return {
        shortLabel: 'ISS',
        rec: summary.issRecuperar,
        pay: summary.issRecolher,
        icon: Building2,
        color: 'text-teal-700',
        bg: 'bg-teal-50/50 border-teal-300',
      };
    case 'CSLL':
      return {
        shortLabel: 'CSLL',
        rec: summary.csllRecuperar,
        pay: summary.csllRecolher,
        icon: Receipt,
        color: 'text-rose-700',
        bg: 'bg-rose-50/50 border-rose-300',
      };
    case 'IRPJ':
      return {
        shortLabel: 'IRPJ',
        rec: summary.irpjRecuperar,
        pay: summary.irpjRecolher,
        icon: Receipt,
        color: 'text-orange-700',
        bg: 'bg-orange-50/50 border-orange-300',
      };
    case 'SIMPLES':
      return {
        shortLabel: 'SIMPLES NACIONAL',
        rec: summary.simplesRecuperar,
        pay: summary.simplesRecolher,
        icon: Percent,
        color: 'text-green-700',
        bg: 'bg-green-50/50 border-green-300',
      };
    default:
      return {
        shortLabel: 'ICMS',
        rec: summary.icmsRecuperar,
        pay: summary.icmsRecolher,
        icon: PieChart,
        color: 'text-amber-700',
        bg: 'bg-amber-50/50 border-amber-300',
      };
  }
}

export function TaxSummary({ summary }: TaxSummaryProps) {
  const [taxKeyRecolher, setTaxKeyRecolher] = useState<TaxKey>('ICMS');
  const [taxKeyRecuperar, setTaxKeyRecuperar] = useState<TaxKey>('PIS');

  const recolherData = getTaxData(taxKeyRecolher, summary);
  const recuperarData = getTaxData(taxKeyRecuperar, summary);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      {/* CARD 1: A Recolher — escolha o imposto */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="technical-panel bg-white border border-brand-border shadow-[2px_2px_0_0_#141414] rounded-none p-4 flex flex-col justify-between"
      >
        <div>
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className={`p-2.5 border ${recolherData.bg} ${recolherData.color} rounded-none`}>
              <recolherData.icon size={20} />
            </div>
            <div className="flex flex-col items-end">
              <div className="relative">
                <select
                  value={taxKeyRecolher}
                  onChange={(e) => setTaxKeyRecolher(e.target.value as TaxKey)}
                  className="bg-white border border-brand-border text-[10px] font-black uppercase tracking-wider text-brand-text font-mono px-2 py-1 rounded-none shadow-[1px_1px_0_0_#141414] focus:outline-none focus:ring-1 focus:ring-brand-text cursor-pointer pr-6 appearance-none"
                  aria-label="Selecionar imposto a recolher"
                >
                  {TAX_OPTIONS.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-brand-text/70" />
              </div>
              <p className={`text-lg font-bold font-mono mt-1.5 tabular-nums ${recolherData.color}`}>
                R$ {recolherData.pay.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        </div>

        <div className="pt-3 border-t border-brand-border/30 flex items-center justify-between text-xs font-mono">
          <p className="text-[9px] font-bold text-brand-text/50 uppercase">A Recolher</p>
          <p className="text-sm font-bold text-emerald-700 tabular-nums">
            R$ {recolherData.pay.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
        </div>
      </motion.div>

      {/* CARD 2: A Recuperar — escolha o imposto */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.05 }}
        className="technical-panel bg-white border border-brand-border shadow-[2px_2px_0_0_#141414] rounded-none p-4 flex flex-col justify-between"
      >
        <div>
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className={`p-2.5 border ${recuperarData.bg} ${recuperarData.color} rounded-none`}>
              <recuperarData.icon size={20} />
            </div>
            <div className="flex flex-col items-end">
              <div className="relative">
                <select
                  value={taxKeyRecuperar}
                  onChange={(e) => setTaxKeyRecuperar(e.target.value as TaxKey)}
                  className="bg-white border border-brand-border text-[10px] font-black uppercase tracking-wider text-brand-text font-mono px-2 py-1 rounded-none shadow-[1px_1px_0_0_#141414] focus:outline-none focus:ring-1 focus:ring-brand-text cursor-pointer pr-6 appearance-none"
                  aria-label="Selecionar imposto a recuperar"
                >
                  {TAX_OPTIONS.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-brand-text/70" />
              </div>
              <p className={`text-lg font-bold font-mono mt-1.5 tabular-nums ${recuperarData.color}`}>
                R$ {recuperarData.rec.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        </div>

        <div className="pt-3 border-t border-brand-border/30 flex items-center justify-between text-xs font-mono">
          <p className="text-[9px] font-bold text-brand-text/50 uppercase">A Recuperar</p>
          <p className="text-sm font-bold text-rose-700 tabular-nums">
            R$ {recuperarData.rec.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
        </div>
      </motion.div>
    </div>
  );
}
