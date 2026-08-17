import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { cn } from '../lib/utils';
import type { AplicacaoRegraConta } from '../logic/aplicacaoRegrasContasStorage';
import {
  addAplicacaoRegraConta,
  removeAplicacaoRegraConta,
  updateAplicacaoRegraConta,
} from '../logic/aplicacaoRegrasContasStorage';
import { CF_FORM_INPUT_LONG } from '../lib/formFieldClasses';

export type AplicacaoRegrasContasModalProps = {
  open: boolean;
  company: string;
  contaAplicacao: string;
  regras: AplicacaoRegraConta[];
  onClose: () => void;
  onChange: (next: AplicacaoRegraConta[]) => void;
};

const INPUT_CLS = cn(CF_FORM_INPUT_LONG, 'max-w-none w-full h-[26px] text-[10px] uppercase');

/**
 * Regras de conciliação para extratos de Aplicação Financeira — modelada como
 * ExtratoRegrasContasModal.tsx (bank extrato), mas com DOIS campos de conta
 * (débito e crédito) em vez de uma única contrapartida, já que todo lançamento
 * de aplicação (aplicação, resgate, IOF, IRRF, rendimento) precisa das duas
 * pontas classificadas.
 */
export default function AplicacaoRegrasContasModal({
  open,
  company,
  contaAplicacao,
  regras,
  onClose,
  onChange,
}: AplicacaoRegrasContasModalProps) {
  const [descricao, setDescricao] = useState('');
  const [contaDebito, setContaDebito] = useState('');
  const [contaCredito, setContaCredito] = useState('');

  if (!open) return null;

  const handleAdd = () => {
    if (!descricao.trim() || !contaDebito.trim() || !contaCredito.trim()) return;
    const next = addAplicacaoRegraConta(company, {
      nome: descricao.slice(0, 40),
      descricao,
      contaAplicacao,
      contaDebito,
      contaCredito,
    });
    onChange(next);
    setDescricao('');
    setContaDebito('');
    setContaCredito('');
  };

  const handleRemove = (id: string) => {
    onChange(removeAplicacaoRegraConta(company, id));
  };

  const handleUpdate = (id: string, patch: Partial<Omit<AplicacaoRegraConta, 'id'>>) => {
    onChange(updateAplicacaoRegraConta(company, id, patch));
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-4">
      <div className="technical-panel bg-brand-bg w-full max-w-3xl max-h-[85vh] overflow-y-auto p-6 space-y-5 shadow-[6px_6px_0_0_#141414]">
        <div className="flex items-center justify-between border-b border-brand-border pb-3">
          <h3 className="text-xs font-black uppercase tracking-widest">
            Regras de Conciliação — Aplicação: {contaAplicacao || '(sem conta selecionada)'}
          </h3>
          <button type="button" onClick={onClose} className="technical-button p-1.5">
            <X size={14} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end border border-brand-border/40 p-3 bg-white">
          <div>
            <label className="block text-[8px] font-bold uppercase text-brand-text/45 mb-0.5">
              Histórico no extrato de aplicação
            </label>
            <input
              type="text"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Ex.: CAPITALIZ. REND, RESGATE, APLICAÇÃO, ENCARGOS DE IRRF"
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className="block text-[8px] font-bold uppercase text-brand-text/45 mb-0.5">
              Conta a Debitar (código reduzido)
            </label>
            <input
              type="text"
              value={contaDebito}
              onChange={(e) => setContaDebito(e.target.value)}
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className="block text-[8px] font-bold uppercase text-brand-text/45 mb-0.5">
              Conta a Creditar (código reduzido)
            </label>
            <input
              type="text"
              value={contaCredito}
              onChange={(e) => setContaCredito(e.target.value)}
              className={INPUT_CLS}
            />
          </div>
          <button type="button" onClick={handleAdd} className="technical-button h-[26px] px-3 flex items-center gap-1">
            <Plus size={12} /> Adicionar
          </button>
        </div>

        <ul className="space-y-2">
          {regras.length === 0 && (
            <li className="text-[10px] font-mono opacity-50 text-center py-4">
              Nenhuma regra cadastrada para esta conta de aplicação.
            </li>
          )}
          {regras.map((r) => (
            <li key={r.id} className="border border-brand-border/40 p-2.5 bg-white space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2">
                <input
                  type="text"
                  defaultValue={r.descricao}
                  onBlur={(e) => handleUpdate(r.id, { descricao: e.target.value })}
                  className={INPUT_CLS}
                />
                <input
                  type="text"
                  defaultValue={r.contaDebito}
                  onBlur={(e) => handleUpdate(r.id, { contaDebito: e.target.value })}
                  className={INPUT_CLS}
                  placeholder="Débito"
                />
                <input
                  type="text"
                  defaultValue={r.contaCredito}
                  onBlur={(e) => handleUpdate(r.id, { contaCredito: e.target.value })}
                  className={INPUT_CLS}
                  placeholder="Crédito"
                />
                <button
                  type="button"
                  onClick={() => handleRemove(r.id)}
                  className="technical-button h-[26px] px-2 text-red-800 border-red-800 hover:bg-red-800 hover:text-white"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
