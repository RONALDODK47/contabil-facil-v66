import React from 'react';
import { CF_FIELD_COL, CF_FIELD_ROW, CF_INPUT_ACCOUNT, CF_ACCOUNT_REDUCED_PLACEHOLDER, CF_LABEL } from '../lib/formFieldClasses';

export interface DominioDebitoCreditoBlockProps {
  titulo: string;
  historico?: string;
  debito: string;
  credito: string;
  onDebitoChange: (value: string) => void;
  onCreditoChange: (value: string) => void;
  disabled?: boolean;
}

export default function DominioDebitoCreditoBlock({
  titulo,
  historico,
  debito,
  credito,
  onDebitoChange,
  onCreditoChange,
  disabled = false,
}: DominioDebitoCreditoBlockProps) {
  return (
    <div className="border border-brand-border bg-brand-sidebar/10 p-4 space-y-3">
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest">{titulo}</p>
        {historico ? (
          <p className="text-[9px] font-mono opacity-50 mt-1">{historico}</p>
        ) : null}
      </div>
      <div className={CF_FIELD_ROW}>
        <div className={CF_FIELD_COL}>
          <label className={CF_LABEL}>Débito</label>
          <input aria-label="Débito"
            type="text"
            disabled={disabled}
            placeholder={CF_ACCOUNT_REDUCED_PLACEHOLDER}
            value={debito}
            onChange={(e) => onDebitoChange(e.target.value)}
            className={CF_INPUT_ACCOUNT}
          />
        </div>
        <div className={CF_FIELD_COL}>
          <label className={CF_LABEL}>Crédito</label>
          <input aria-label="Crédito"
            type="text"
            disabled={disabled}
            placeholder={CF_ACCOUNT_REDUCED_PLACEHOLDER}
            value={credito}
            onChange={(e) => onCreditoChange(e.target.value)}
            className={CF_INPUT_ACCOUNT}
          />
        </div>
      </div>
    </div>
  );
}
