import React from 'react';
import { CF_FIELD_COL, CF_FIELD_ROW, CF_FORM_INPUT_MED } from '../lib/formFieldClasses';

type Props = {
  dataInicio: string;
  dataFim: string;
  onDataInicioChange: (v: string) => void;
  onDataFimChange: (v: string) => void;
  totalFiltrado: number;
  totalGeral: number;
  label?: string;
};

export default function FiscalDataFiltroBar({
  dataInicio,
  dataFim,
  onDataInicioChange,
  onDataFimChange,
  totalFiltrado,
  totalGeral,
  label = 'Filtrar por data',
}: Props) {
  const temFiltroData = Boolean(dataInicio || dataFim);

  return (
    <div className="px-4 py-3 border-b border-brand-border/30 bg-brand-sidebar/15 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[9px] font-black uppercase tracking-widest opacity-60">{label}</p>
        <p className="text-[9px] font-mono uppercase opacity-60">
          {totalFiltrado} de {totalGeral} acumulador{totalGeral !== 1 ? 'es' : ''}
          {temFiltroData ? ' no período' : ''}
        </p>
      </div>
      <div className={CF_FIELD_ROW}>
        <div className={CF_FIELD_COL}>
          <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">Data início</label>
          <input
            type="date"
            aria-label="Filtrar data início"
            value={dataInicio}
            onChange={(e) => onDataInicioChange(e.target.value)}
            className={CF_FORM_INPUT_MED}
          />
        </div>
        <div className={CF_FIELD_COL}>
          <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">Data fim</label>
          <input
            type="date"
            aria-label="Filtrar data fim"
            value={dataFim}
            onChange={(e) => onDataFimChange(e.target.value)}
            className={CF_FORM_INPUT_MED}
          />
        </div>
        {temFiltroData && (
          <div className={CF_FIELD_COL}>
            <label className="block text-[9px] font-bold uppercase opacity-50 mb-1 invisible select-none">
              Limpar
            </label>
            <button
              type="button"
              onClick={() => {
                onDataInicioChange('');
                onDataFimChange('');
              }}
              className="technical-button text-[9px] px-3 py-1.5 font-bold h-[26px]"
            >
              Limpar datas
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
