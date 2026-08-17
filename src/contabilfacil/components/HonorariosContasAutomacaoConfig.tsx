import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { CF_FIELD_COL, CF_FIELD_ROW, CF_INPUT_ACCOUNT, CF_ACCOUNT_REDUCED_PLACEHOLDER } from '../lib/formFieldClasses';
import type { HonorariosContasAutomacaoConfig } from '../logic/honorariosContasAutomacao';
import {
  loadHonorariosContasAutomacao,
  saveHonorariosContasAutomacao,
} from '../logic/honorariosContasAutomacaoStorage';

type Props = {
  selectedCompany: string;
  onChange?: (config: HonorariosContasAutomacaoConfig) => void;
};

export default function HonorariosContasAutomacaoPanel({ selectedCompany, onChange }: Props) {
  const [contas, setContas] = useState<HonorariosContasAutomacaoConfig>(() =>
    loadHonorariosContasAutomacao(selectedCompany),
  );

  const persist = useCallback(
    (next: HonorariosContasAutomacaoConfig) => {
      setContas(next);
      saveHonorariosContasAutomacao(selectedCompany, next);
      onChange?.(next);
    },
    [selectedCompany, onChange],
  );

  useEffect(() => {
    const loaded = loadHonorariosContasAutomacao(selectedCompany);
    setContas(loaded);
    onChange?.(loaded);
  }, [selectedCompany, onChange]);

  return (
    <div className="technical-panel shadow-[4px_4px_0_0_#141414] overflow-hidden">
      <div className="px-4 py-3 border-b border-brand-border bg-brand-sidebar/30 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen size={14} className="opacity-60 shrink-0" />
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest">Contas — honorários</h3>
            <p className="text-[9px] font-bold uppercase opacity-50 mt-0.5">
              Débito (despesa) e crédito (a pagar).
            </p>
          </div>
        </div>
      </div>
      <div className="p-4">
        <table className="w-full min-w-[480px] text-left text-[10px] font-mono">
          <thead>
            <tr className="text-[9px] font-black uppercase opacity-60 border-b border-brand-border/40">
              <th className="pb-2 pr-4 w-[28%]">Rubrica</th>
              <th className="pb-2 pr-3">Conta débito</th>
              <th className="pb-2">Conta crédito</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="py-2 pr-4 font-bold uppercase align-middle">Honorários</td>
              <td className="py-2 pr-3 align-middle">
                <div className={CF_FIELD_ROW}>
                  <div className={CF_FIELD_COL}>
                    <input
                      type="text"
                      inputMode="numeric"
                      aria-label="Conta débito honorários"
                      placeholder={CF_ACCOUNT_REDUCED_PLACEHOLDER}
                      className={CF_INPUT_ACCOUNT}
                      value={contas.debito}
                      onChange={(e) => persist({ ...contas, debito: e.target.value })}
                    />
                  </div>
                </div>
              </td>
              <td className="py-2 align-middle">
                <div className={CF_FIELD_ROW}>
                  <div className={CF_FIELD_COL}>
                    <input
                      type="text"
                      inputMode="numeric"
                      aria-label="Conta crédito honorários"
                      placeholder={CF_ACCOUNT_REDUCED_PLACEHOLDER}
                      className={CF_INPUT_ACCOUNT}
                      value={contas.credito}
                      onChange={(e) => persist({ ...contas, credito: e.target.value })}
                    />
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
