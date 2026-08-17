/**
 * BalancetePeriodoModal
 *
 * Modal obrigatório de seleção de período antes de enviar lançamentos ao balancete.
 * O usuário deve informar a data de início e a data de fim do período a lançar.
 * Só libera o botão "CONFIRMAR" após ambas as datas estarem preenchidas.
 */
import React, { useState } from 'react';
import { X, Calendar, ArrowRight } from 'lucide-react';

export interface BalancetePeriodo {
  dataInicio: string; // ISO date string "YYYY-MM-DD"
  dataFim: string;    // ISO date string "YYYY-MM-DD"
}

interface Props {
  isOpen: boolean;
  onConfirm: (periodo: BalancetePeriodo) => void;
  onCancel: () => void;
}

export default function BalancetePeriodoModal({ isOpen, onConfirm, onCancel }: Props) {
  const today = new Date().toISOString().split('T')[0];
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleConfirmar = () => {
    if (!dataInicio || !dataFim) {
      setErro('Preencha as duas datas antes de continuar.');
      return;
    }
    if (dataFim < dataInicio) {
      setErro('A data "Até" não pode ser anterior à data "De".');
      return;
    }
    setErro(null);
    onConfirm({ dataInicio, dataFim });
    // reset para próxima abertura
    setDataInicio('');
    setDataFim('');
  };

  const handleCancel = () => {
    setErro(null);
    setDataInicio('');
    setDataFim('');
    onCancel();
  };

  const canConfirm = Boolean(dataInicio && dataFim && dataFim >= dataInicio);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="relative bg-[#0f0f0f] border border-amber-500/40 text-white shadow-2xl w-full max-w-md flex flex-col"
        style={{ animation: 'none' }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10 shrink-0">
          <Calendar className="text-amber-400 shrink-0" size={18} />
          <div className="flex-1 min-w-0">
            <h2 className="text-[12px] font-black uppercase tracking-widest">
              Período para Lançamento
            </h2>
            <p className="text-[10px] text-white/50 font-mono mt-0.5">
              Informe o intervalo de datas a lançar no balancete
            </p>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            aria-label="Fechar"
            className="text-white/40 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-6 space-y-4">
          <p className="text-[10px] text-white/60 font-mono">
            Exemplo: <span className="text-amber-300">01/01/2025</span> até{' '}
            <span className="text-amber-300">31/12/2025</span>
          </p>

          <div className="flex items-center gap-3">
            <div className="flex-1 space-y-1">
              <label className="block text-[9px] font-bold uppercase tracking-widest text-white/50">
                De
              </label>
              <input
                type="date"
                value={dataInicio}
                max={today}
                onChange={(e) => { setDataInicio(e.target.value); setErro(null); }}
                className="w-full bg-[#1a1a1a] border border-white/20 text-white text-[11px] px-3 py-2 outline-none focus:border-amber-400/70 transition-colors"
              />
            </div>
            <ArrowRight size={14} className="text-white/30 mt-5 shrink-0" />
            <div className="flex-1 space-y-1">
              <label className="block text-[9px] font-bold uppercase tracking-widest text-white/50">
                Até
              </label>
              <input
                type="date"
                value={dataFim}
                min={dataInicio || undefined}
                onChange={(e) => { setDataFim(e.target.value); setErro(null); }}
                className="w-full bg-[#1a1a1a] border border-white/20 text-white text-[11px] px-3 py-2 outline-none focus:border-amber-400/70 transition-colors"
              />
            </div>
          </div>

          {erro && (
            <p className="text-[10px] text-red-400 font-mono">{erro}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end items-center px-5 py-3 border-t border-white/10 bg-white/5 shrink-0 gap-3">
          <button
            type="button"
            onClick={handleCancel}
            className="px-5 py-2 text-[11px] font-black uppercase tracking-widest border border-white/20 text-white/60 hover:border-white/50 hover:text-white transition-all"
          >
            CANCELAR
          </button>
          <button
            type="button"
            onClick={handleConfirmar}
            disabled={!canConfirm}
            className="flex items-center gap-2 px-6 py-2 text-[11px] font-black uppercase tracking-widest bg-amber-600 hover:bg-amber-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Calendar size={13} />
            CONFIRMAR PERÍODO
          </button>
        </div>
      </div>
    </div>
  );
}
