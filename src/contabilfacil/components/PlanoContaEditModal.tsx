import { useState } from 'react';
import type { PlanoContaRow } from './PlanoContasVirtualTable';

interface PlanoContaEditModalProps {
  acc: PlanoContaRow;
  onSave: (oldCode: string, updates: Partial<PlanoContaRow>) => void;
  onClose: () => void;
}

export function PlanoContaEditModal({ acc, onSave, onClose }: PlanoContaEditModalProps) {
  const [editReduzido, setEditReduzido] = useState(acc.codigoReduzido ?? '');
  const [editCode, setEditCode] = useState(acc.code);
  const [editName, setEditName] = useState(acc.name);
  const [editTipo, setEditTipo] = useState<'S' | 'A' | ''>(acc.tipo ?? '');

  const handleSave = () => {
    onSave(acc.code, {
      code: editCode,
      name: editName,
      codigoReduzido: editReduzido,
      tipo: editTipo === '' ? undefined : editTipo,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-brand-bg border border-brand-border shadow-xl rounded w-full max-w-lg p-6">
        <h2 className="text-sm font-bold uppercase tracking-widest text-brand-text mb-6">
          Editar Conta
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold uppercase text-brand-text/70 mb-1">
              Código Reduzido
            </label>
            <input
              type="text"
              value={editReduzido}
              onChange={(e) => setEditReduzido(e.target.value)}
              className="w-full bg-white border border-brand-border/50 text-black p-2 text-sm font-mono focus:border-brand-primary outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase text-brand-text/70 mb-1">
              Código de Classificação
            </label>
            <input
              type="text"
              value={editCode}
              onChange={(e) => setEditCode(e.target.value)}
              className="w-full bg-white border border-brand-border/50 text-black p-2 text-sm font-mono focus:border-brand-primary outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase text-brand-text/70 mb-1">
              Descrição
            </label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full bg-white border border-brand-border/50 text-black p-2 text-sm uppercase focus:border-brand-primary outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase text-brand-text/70 mb-1">
              Tipo
            </label>
            <select
              value={editTipo}
              onChange={(e) => setEditTipo(e.target.value as 'S' | 'A' | '')}
              className="w-full bg-white border border-brand-border/50 text-black p-2 text-sm focus:border-brand-primary outline-none"
            >
              <option value="">— Selecione —</option>
              <option value="S">Sintética (S)</option>
              <option value="A">Analítica (A)</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-8">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-black hover:text-slate-600 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-black hover:text-slate-600 transition-colors"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
