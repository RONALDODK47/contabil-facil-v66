import React from 'react';
import type { FiscalContaPar } from '../logic/fiscalContasImposto';
import { CF_FORM_INPUT_MED } from '../lib/formFieldClasses';

export type FiscalRegraItem = { key: string; label: string };

type Props = {
  titulo: string;
  itens: FiscalRegraItem[];
  regras: Record<string, Partial<FiscalContaPar>>;
  onPatch: (key: string, patch: Partial<FiscalContaPar>) => void;
  /** Impostos: também mostra par de contas «a recuperar» (natureza devedora). */
  mostrarRecuperar?: boolean;
  /** Acumuladores: mostra o checkbox «Somente valor fiscal». */
  mostrarValorFiscal?: boolean;
};

function regraDe(regras: Record<string, Partial<FiscalContaPar>>, key: string): Partial<FiscalContaPar> {
  return regras[key] ?? {};
}

export default function FiscalRegrasContasPanel({
  titulo,
  itens,
  regras,
  onPatch,
  mostrarRecuperar,
  mostrarValorFiscal,
}: Props) {
  if (itens.length === 0) {
    return (
      <div className="px-4 py-3 border-b border-brand-border/30 bg-brand-sidebar/10">
        <h4 className="text-[9px] font-black uppercase tracking-widest opacity-50">{titulo}</h4>
        <p className="text-[9px] font-mono opacity-40 mt-1">
          Nenhum lançamento importado ainda — a regra de conta aparece aqui assim que houver dados.
        </p>
      </div>
    );
  }

  return (
    <div className="border-b border-brand-border/30">
      <div className="px-4 py-2 bg-brand-sidebar/20">
        <h4 className="text-[9px] font-black uppercase tracking-widest">{titulo}</h4>
      </div>
      <div className="divide-y divide-brand-border/10">
        {itens.map((it) => {
          const regra = regraDe(regras, it.key);
          return (
            <div key={it.key} className="px-4 py-2.5 flex flex-wrap items-end gap-3">
              <div className="min-w-[10rem] max-w-[18rem]">
                <span className="text-[9px] font-bold uppercase">{it.label}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[8px] font-bold uppercase opacity-50">
                  {mostrarRecuperar ? 'Débito (a recolher)' : 'Conta débito'}
                </label>
                <input
                  type="text"
                  value={regra.debito ?? ''}
                  onChange={(e) => onPatch(it.key, { debito: e.target.value })}
                  className={CF_FORM_INPUT_MED}
                  placeholder="Código reduzido"
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[8px] font-bold uppercase opacity-50">
                  {mostrarRecuperar ? 'Crédito (a recolher)' : 'Conta crédito'}
                </label>
                <input
                  type="text"
                  value={regra.credito ?? ''}
                  onChange={(e) => onPatch(it.key, { credito: e.target.value })}
                  className={CF_FORM_INPUT_MED}
                  placeholder="Código reduzido"
                />
              </div>
              {mostrarRecuperar && (
                <>
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[8px] font-bold uppercase opacity-50">Débito (a recuperar)</label>
                    <input
                      type="text"
                      value={regra.debitoRecuperar ?? ''}
                      onChange={(e) => onPatch(it.key, { debitoRecuperar: e.target.value })}
                      className={CF_FORM_INPUT_MED}
                      placeholder="Código reduzido"
                    />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[8px] font-bold uppercase opacity-50">Crédito (a recuperar)</label>
                    <input
                      type="text"
                      value={regra.creditoRecuperar ?? ''}
                      onChange={(e) => onPatch(it.key, { creditoRecuperar: e.target.value })}
                      className={CF_FORM_INPUT_MED}
                      placeholder="Código reduzido"
                    />
                  </div>
                </>
              )}
              {mostrarValorFiscal && (
                <label className="flex items-center gap-1.5 text-[8px] font-bold uppercase pb-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={regra.valorFiscal === true}
                    onChange={(e) => onPatch(it.key, { valorFiscal: e.target.checked })}
                  />
                  Somente valor fiscal (não vai ao balancete)
                </label>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
