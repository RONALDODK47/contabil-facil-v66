/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { SpedInvoice } from './types';
import { sanitizeCfop } from './spedParser';
import { motion } from 'motion/react';
import { TrendingDown, TrendingUp, ReceiptText, Search, Calendar } from 'lucide-react';

interface InvoiceTableProps {
  invoices: SpedInvoice[];
}

export function InvoiceTable({ invoices }: InvoiceTableProps) {
  const [filterType, setFilterType] = useState<'todos' | 'entrada' | 'saida'>('todos');
  const [search, setSearch] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');

  // Recorte por data — base para contadores, totais e a lista filtrada abaixo.
  const dateFilteredInvoices = useMemo(() => {
    if (!dataInicio && !dataFim) return invoices;
    return invoices.filter((inv) => {
      if (dataInicio && (inv.date || '') < dataInicio) return false;
      if (dataFim && (inv.date || '') > dataFim) return false;
      return true;
    });
  }, [invoices, dataInicio, dataFim]);

  const filteredInvoices = useMemo(() => {
    return dateFilteredInvoices.filter((inv) => {
      if (filterType !== 'todos' && inv.type !== filterType) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const cleanCfop = sanitizeCfop(inv.cfop);
        const matchDesc = inv.description.toLowerCase().includes(q);
        const matchPart = inv.participantName.toLowerCase().includes(q);
        const matchDoc = inv.documentNumber.toLowerCase().includes(q);
        const matchCfop = cleanCfop.toLowerCase().includes(q);
        const matchAcc = inv.accountCode?.toLowerCase().includes(q);
        return matchDesc || matchPart || matchDoc || matchCfop || matchAcc;
      }
      return true;
    });
  }, [dateFilteredInvoices, filterType, search]);

  const totais = useMemo(() => {
    let entradas = 0;
    let saidas = 0;
    for (const inv of dateFilteredInvoices) {
      if (inv.type === 'entrada') entradas += Math.abs(inv.value);
      else if (inv.type === 'saida') saidas += Math.abs(inv.value);
    }
    return { entradas, saidas };
  }, [dateFilteredInvoices]);

  const fmt = (n: number) =>
    n.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

  return (
    <div className="technical-panel bg-white border border-brand-border shadow-[2px_2px_0_0_#141414] rounded-none overflow-hidden">
      {/* Total Entradas / Saídas */}
      <div className="p-3 border-b border-brand-border grid grid-cols-1 sm:grid-cols-3 gap-3 bg-brand-sidebar/10">
        <div className="border border-brand-border bg-white px-3 py-2 flex items-center justify-between">
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-brand-text/60">
            Total Entradas
          </span>
          <span className="flex items-center gap-1 text-sm font-bold text-rose-700 tabular-nums">
            <TrendingDown size={14} />
            R$ {fmt(totais.entradas)}
          </span>
        </div>
        <div className="border border-brand-border bg-white px-3 py-2 flex items-center justify-between">
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-brand-text/60">
            Total Saídas
          </span>
          <span className="flex items-center gap-1 text-sm font-bold text-emerald-700 tabular-nums">
            <TrendingUp size={14} />
            R$ {fmt(totais.saidas)}
          </span>
        </div>
        <div className="border border-brand-border bg-white px-3 py-2 flex items-center justify-between">
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-brand-text/60">
            Saldo (Saídas − Entradas)
          </span>
          <span
            className={`text-sm font-bold tabular-nums ${
              totais.saidas - totais.entradas < 0 ? 'text-rose-700' : 'text-emerald-700'
            }`}
          >
            R$ {fmt(totais.saidas - totais.entradas)}
          </span>
        </div>
      </div>

      {/* Table Header Controls */}
      <div className="p-3 border-b border-brand-border flex flex-col md:flex-row items-center justify-between gap-3 bg-brand-sidebar/30">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFilterType('todos')}
            className={`px-3 py-1 text-xs font-bold font-mono uppercase tracking-wider border border-brand-border transition-all ${
              filterType === 'todos'
                ? 'bg-brand-text text-white shadow-[2px_2px_0_0_#141414]'
                : 'bg-white text-brand-text hover:bg-brand-sidebar/40'
            }`}
          >
            Todos ({dateFilteredInvoices.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('entrada')}
            className={`px-3 py-1 text-xs font-bold font-mono uppercase tracking-wider border border-brand-border transition-all ${
              filterType === 'entrada'
                ? 'bg-rose-700 text-white shadow-[2px_2px_0_0_#141414]'
                : 'bg-white text-brand-text hover:bg-brand-sidebar/40'
            }`}
          >
            Entradas ({dateFilteredInvoices.filter((i) => i.type === 'entrada').length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('saida')}
            className={`px-3 py-1 text-xs font-bold font-mono uppercase tracking-wider border border-brand-border transition-all ${
              filterType === 'saida'
                ? 'bg-emerald-700 text-white shadow-[2px_2px_0_0_#141414]'
                : 'bg-white text-brand-text hover:bg-brand-sidebar/40'
            }`}
          >
            Saídas ({dateFilteredInvoices.filter((i) => i.type === 'saida').length})
          </button>
        </div>

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

        <div className="relative w-full md:w-80">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-text/50" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por doc, participante, cfop ou acumulador..."
            className="w-full pl-8 pr-3 py-1 text-xs bg-white border border-brand-border text-brand-text font-mono focus:outline-none focus:ring-1 focus:ring-brand-text rounded-none"
          />
        </div>
      </div>

      <div className="max-h-[640px] overflow-y-auto overflow-x-auto">
        <table className="w-full text-left border-collapse" id="invoice-table">
          <thead className="sticky top-0 z-10">
            <tr className="bg-brand-sidebar/95 border-b border-brand-border text-[10px] font-black text-brand-text uppercase tracking-widest backdrop-blur-sm">
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Documento / Descrição</th>
              <th className="px-4 py-3">Participante</th>
              <th className="px-4 py-3 text-center">Acumulador</th>
              <th className="px-4 py-3 text-center">CFOP</th>
              <th className="px-4 py-3 text-right">Valor (R$)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border/30 text-xs font-mono">
            {filteredInvoices.map((invoice, idx) => {
              const cleanCfop = sanitizeCfop(invoice.cfop);
              return (
                <motion.tr
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: Math.min(idx * 0.015, 0.4) }}
                  key={invoice.id}
                  className="hover:bg-brand-sidebar/20 transition-colors"
                  id={`row-${invoice.id}`}
                >
                  <td className="px-4 py-2.5 text-brand-text/80 tabular-nums">
                    {invoice.date ? (invoice.date.includes('-') ? new Date(invoice.date + 'T00:00:00').toLocaleDateString('pt-BR') : invoice.date) : '---'}
                  </td>
                  <td className="px-4 py-2.5 font-sans">
                    <div className="flex items-center space-x-2">
                      <ReceiptText size={14} className="text-brand-text/50 shrink-0" />
                      <span className="font-semibold text-brand-text">{invoice.description}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-sans text-brand-text/70 max-w-[220px] truncate">
                    {invoice.participantName}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-mono font-bold bg-blue-50 text-blue-800 border border-blue-200 rounded-none">
                      {invoice.accountCode || '---'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-mono font-bold bg-brand-sidebar/60 text-brand-text border border-brand-border rounded-none">
                      {cleanCfop || '---'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold">
                    <div className={`flex items-center justify-end space-x-1 ${
                      invoice.type === 'entrada' ? 'text-rose-700' : 'text-emerald-700'
                    }`}>
                      {invoice.type === 'entrada' ? <TrendingDown size={13} /> : <TrendingUp size={13} />}
                      <span className="tabular-nums">
                        {Math.abs(invoice.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </td>
                </motion.tr>
              );
            })}
            {filteredInvoices.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-brand-text/50 italic text-xs font-sans">
                  Nenhum lançamento fiscal cadastrado. Clique em <strong>"Importar TXT SPED"</strong> ou <strong>"Recortar PDF Lançamentos"</strong> para adicionar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
