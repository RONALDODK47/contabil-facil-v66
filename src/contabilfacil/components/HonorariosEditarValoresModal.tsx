import { memo, useCallback, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';
import { CF_FIELD_COL, CF_FIELD_ROW, CF_FORM_INPUT_MED } from '../lib/formFieldClasses';
import { FreeNumericInput } from './FreeNumericInput';

const MESES = [
  { n: 1, label: 'Jan' },
  { n: 2, label: 'Fev' },
  { n: 3, label: 'Mar' },
  { n: 4, label: 'Abr' },
  { n: 5, label: 'Mai' },
  { n: 6, label: 'Jun' },
  { n: 7, label: 'Jul' },
  { n: 8, label: 'Ago' },
  { n: 9, label: 'Set' },
  { n: 10, label: 'Out' },
  { n: 11, label: 'Nov' },
  { n: 12, label: 'Dez' },
];

export type HonorariosEditarValoresModalProps = {
  open: boolean;
  onClose: () => void;
  onSave: (params: { ano: number; meses: number[]; valor: number; historico: string }) => void;
  historicoPadrao: string;
};

export default memo(function HonorariosEditarValoresModal({
  open,
  onClose,
  onSave,
  historicoPadrao,
}: HonorariosEditarValoresModalProps) {
  const anoAtual = new Date().getFullYear();
  const [ano, setAno] = useState(anoAtual);
  const [meses, setMeses] = useState<number[]>([]);
  const [valor, setValor] = useState(0);
  const [historico, setHistorico] = useState(historicoPadrao);

  const toggleMes = useCallback((mes: number) => {
    setMeses((prev) =>
      prev.includes(mes) ? prev.filter((m) => m !== mes) : [...prev, mes].sort((a, b) => a - b),
    );
  }, []);

  const selectAll = useCallback(() => {
    setMeses(MESES.map((m) => m.n));
  }, []);

  const handleSave = useCallback(() => {
    onSave({ ano, meses, valor, historico });
  }, [ano, historico, meses, onSave, valor]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[81] flex items-center justify-center p-4 bg-black/50">
      <div
        className="technical-panel shadow-[6px_6px_0_0_#141414] w-full max-w-lg max-h-[90vh] flex flex-col"
        role="dialog"
        aria-labelledby="honorarios-editar-valores-title"
      >
        <div className="flex items-start justify-between gap-3 p-4 border-b border-brand-border bg-brand-sidebar/40">
          <div>
            <h2 id="honorarios-editar-valores-title" className="text-sm font-black uppercase tracking-widest">
              Editar valores
            </h2>
            <p className="text-[10px] text-slate-600 mt-1 leading-snug">
              Escolha o ano e os meses, informe o novo valor — o balancete é atualizado automaticamente.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-slate-500 hover:text-red-600" aria-label="Fechar">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          <div className={CF_FIELD_ROW}>
            <div className={CF_FIELD_COL}>
              <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">Ano</label>
              <select
                aria-label="Ano"
                value={ano}
                onChange={(e) => setAno(Number(e.target.value))}
                className={CF_FORM_INPUT_MED}
              >
                {[anoAtual - 1, anoAtual, anoAtual + 1].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
            <div className={CF_FIELD_COL}>
              <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">Valor (R$)</label>
              <FreeNumericInput
                aria-label="Valor"
                required
                placeholder="0,00"
                value={valor}
                onChange={setValor}
                className={CF_FORM_INPUT_MED}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[9px] font-bold uppercase opacity-50">Meses</label>
              <button type="button" onClick={selectAll} className="text-[8px] font-bold uppercase underline opacity-60">
                Todos
              </button>
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
              {MESES.map((m) => (
                <button
                  key={m.n}
                  type="button"
                  onClick={() => toggleMes(m.n)}
                  className={cn(
                    'text-[9px] font-black uppercase py-1.5 border border-brand-border transition-colors',
                    meses.includes(m.n)
                      ? 'bg-emerald-700 text-white border-emerald-900'
                      : 'bg-brand-sidebar/20 hover:bg-brand-sidebar/40',
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[9px] font-bold uppercase opacity-50 mb-1">Histórico</label>
            <input
              type="text"
              aria-label="Histórico"
              value={historico}
              onChange={(e) => setHistorico(e.target.value.toUpperCase())}
              className={CF_FORM_INPUT_MED}
            />
          </div>
        </div>

        <div className="p-3 border-t border-brand-border flex justify-end gap-2">
          <button type="button" onClick={onClose} className="technical-button text-[10px] px-4 py-2 font-bold">
            Cancelar
          </button>
          <button
            type="button"
            disabled={valor <= 0 || meses.length === 0}
            onClick={handleSave}
            className="technical-button-primary text-[10px] px-4 py-2 font-bold disabled:opacity-40"
          >
            Atualizar balancete
          </button>
        </div>
      </div>
    </div>
  );
});
