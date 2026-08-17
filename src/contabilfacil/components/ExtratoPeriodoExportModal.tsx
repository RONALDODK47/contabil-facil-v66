/**
 * ExtratoPeriodoExportModal
 *
 * Modal de periodo da EXPORTACAO TXT+ do extrato. Vive separado do
 * BalancetePeriodoModal porque a exportacao do extrato tem o botao
 * "EXPORTAR TUDO" (sem filtro de periodo), que o modal do balancete nao tem.
 *
 * Modal obrigatório de seleção de período antes de enviar lançamentos ao balancete.
 * O usuário deve informar a data de início e a data de fim do período a lançar.
 * Só libera o botão "CONFIRMAR" após ambas as datas estarem preenchidas.
 */
import React, { useState } from 'react';
import { X, Calendar, ArrowRight } from 'lucide-react';
import { CF_LABEL, CF_INPUT_DATE } from '../lib/formFieldClasses';

import type { BalancetePeriodo } from './BalancetePeriodoModal';
export type { BalancetePeriodo };

interface Props {
  isOpen: boolean;
  onConfirm: (periodo: BalancetePeriodo) => void;
  onCancel: () => void;
  /** Quando definido, exibe um botão extra para exportar sem filtro de período. */
  onConfirmAll?: () => void;
  title?: string;
  subtitle?: string;
}

export default function ExtratoPeriodoExportModal({ isOpen, onConfirm, onCancel, onConfirmAll, title, subtitle }: Props) {
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
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50">
      <div
        className="technical-panel shadow-[6px_6px_0_0_#141414] w-full max-w-md flex flex-col"
        role="dialog"
        aria-labelledby="balancete-periodo-title"
      >
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-brand-border bg-brand-sidebar/40 shrink-0">
          <Calendar className="shrink-0 opacity-60" size={18} aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <h2
              id="balancete-periodo-title"
              className="text-sm font-black uppercase tracking-widest text-brand-text"
            >
              {title || 'Período para Lançamento'}
            </h2>
            <p className="text-[10px] text-slate-600 font-mono mt-1 leading-snug">
              {subtitle || 'Informe o intervalo de datas a lançar no balancete'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            aria-label="Fechar"
            className="p-1 text-slate-500 hover:text-red-600"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          <p className="text-[10px] text-slate-600 font-mono">
            Exemplo: <span className="font-bold text-brand-text">01/01/2025</span> até{' '}
            <span className="font-bold text-brand-text">31/12/2025</span>
          </p>

          <div className="flex items-end gap-3">
            <div className="flex-1 flex flex-col gap-0.5 min-w-0">
              <label htmlFor="balancete-periodo-de" className={CF_LABEL}>
                De
              </label>
              <input
                id="balancete-periodo-de"
                type="date"
                value={dataInicio}
                max={today}
                onChange={(e) => { setDataInicio(e.target.value); setErro(null); }}
                className={`${CF_INPUT_DATE} w-full`}
              />
            </div>
            <ArrowRight size={14} className="opacity-40 shrink-0 mb-2" aria-hidden="true" />
            <div className="flex-1 flex flex-col gap-0.5 min-w-0">
              <label htmlFor="balancete-periodo-ate" className={CF_LABEL}>
                Até
              </label>
              <input
                id="balancete-periodo-ate"
                type="date"
                value={dataFim}
                min={dataInicio || undefined}
                onChange={(e) => { setDataFim(e.target.value); setErro(null); }}
                className={`${CF_INPUT_DATE} w-full`}
              />
            </div>
          </div>

          {erro && (
            <p className="text-[10px] text-red-600 font-bold font-mono">{erro}</p>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-brand-border flex flex-wrap justify-end items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleCancel}
            className="technical-button text-[10px] py-1 px-3"
          >
            CANCELAR
          </button>
          {onConfirmAll && (
            <button
              type="button"
              onClick={() => {
                setErro(null);
                setDataInicio('');
                setDataFim('');
                onConfirmAll();
              }}
              className="technical-button-secondary text-[10px] py-1 px-3"
            >
              EXPORTAR TUDO
            </button>
          )}
          <button
            type="button"
            onClick={handleConfirmar}
            disabled={!canConfirm}
            className="technical-button-primary text-[10px] py-1 px-4 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Calendar size={13} aria-hidden="true" />
            CONFIRMAR PERÍODO
          </button>
        </div>
      </div>
    </div>
  );
}
