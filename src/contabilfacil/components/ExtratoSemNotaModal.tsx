import { memo, useCallback, useState } from 'react';
import { X } from 'lucide-react';
import { cn, formatCurrency, formatDate } from '../lib/utils';
import type { ExtratoSemNotaPendingRow } from '../logic/extratoContaResolver';
import type { ExtratoSemNotaPolicy } from '../logic/extratoSemNotaStorage';

export type ExtratoSemNotaModalProps = {
  open: boolean;
  rows: ExtratoSemNotaPendingRow[];
  onClose: () => void;
  onConfirm: (decisions: Record<string, ExtratoSemNotaPolicy>) => void;
};

export default memo(function ExtratoSemNotaModal({
  open,
  rows,
  onClose,
  onConfirm,
}: ExtratoSemNotaModalProps) {
  const [decisions, setDecisions] = useState<Record<string, ExtratoSemNotaPolicy>>({});

  const setRowPolicy = useCallback((rowKey: string, policy: ExtratoSemNotaPolicy) => {
    setDecisions((prev) => ({ ...prev, [rowKey]: policy }));
  }, []);

  const setAll = useCallback((policy: ExtratoSemNotaPolicy) => {
    const next: Record<string, ExtratoSemNotaPolicy> = {};
    for (const row of rows) next[row.rowKey] = policy;
    setDecisions(next);
  }, [rows]);

  const handleConfirm = useCallback(() => {
    const complete: Record<string, ExtratoSemNotaPolicy> = {};
    for (const row of rows) {
      complete[row.rowKey] = decisions[row.rowKey] ?? 'despesa_generica';
    }
    onConfirm(complete);
  }, [decisions, onConfirm, rows]);

  if (!open || rows.length === 0) return null;

  const allAnswered = rows.every((r) => decisions[r.rowKey]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50">
      <div
        className="technical-panel shadow-[6px_6px_0_0_#141414] w-full max-w-2xl max-h-[85vh] flex flex-col"
        role="dialog"
        aria-labelledby="extrato-sem-nota-title"
      >
        <div className="flex items-start justify-between gap-3 p-4 border-b border-brand-border bg-brand-sidebar/40">
          <div>
            <h2 id="extrato-sem-nota-title" className="text-sm font-black uppercase tracking-widest">
              Saídas sem NF no Fiscal
            </h2>
            <p className="text-[10px] text-slate-600 mt-1 leading-snug max-w-lg">
              {rows.length} lançamento(s) com histórico vago e sem acumulador correspondente na aba
              Fiscal. Informe se há nota fiscal para classificar em fornecedor; caso contrário usa
              despesa genérica (uso e consumo).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-500 hover:text-red-600"
            aria-label="Fechar"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-3 flex flex-wrap gap-2 border-b border-brand-border/40">
          <button
            type="button"
            onClick={() => setAll('fornecedor')}
            className="technical-button text-[9px] py-1 px-2"
          >
            Todos: tenho NF → Fornecedor
          </button>
          <button
            type="button"
            onClick={() => setAll('despesa_generica')}
            className="technical-button text-[9px] py-1 px-2"
          >
            Todos: sem NF → Uso e consumo
          </button>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 p-3 space-y-2">
          {rows.map((row) => {
            const policy = decisions[row.rowKey];
            return (
              <div
                key={row.rowKey}
                className="border border-brand-border/30 p-2 flex flex-col sm:flex-row sm:items-center gap-2"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold text-red-700">
                    {formatDate(row.date)} · {formatCurrency(row.value)}
                  </p>
                  <p className="text-[9px] uppercase truncate text-slate-600" title={row.description}>
                    {row.description || '(sem descrição)'}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setRowPolicy(row.rowKey, 'fornecedor')}
                    className={cn(
                      'text-[8px] font-black uppercase px-2 py-1 border',
                      policy === 'fornecedor'
                        ? 'bg-emerald-700 text-white border-emerald-900'
                        : 'border-brand-border hover:bg-brand-sidebar/50',
                    )}
                  >
                    Tenho NF
                  </button>
                  <button
                    type="button"
                    onClick={() => setRowPolicy(row.rowKey, 'despesa_generica')}
                    className={cn(
                      'text-[8px] font-black uppercase px-2 py-1 border',
                      policy === 'despesa_generica'
                        ? 'bg-amber-700 text-white border-amber-900'
                        : 'border-brand-border hover:bg-brand-sidebar/50',
                    )}
                  >
                    Sem NF
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="p-3 border-t border-brand-border flex justify-end gap-2">
          <button type="button" onClick={onClose} className="technical-button text-[10px] py-1 px-3">
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="technical-button-primary text-[10px] py-1 px-4"
          >
            {allAnswered ? 'Aplicar conciliação' : 'Aplicar (pendentes → uso e consumo)'}
          </button>
        </div>
      </div>
    </div>
  );
});
