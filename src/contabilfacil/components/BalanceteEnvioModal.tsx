/**
 * BalanceteEnvioModal
 *
 * Modal de confirmação antes de enviar lançamentos ao balancete.
 * Exibe um preview dos lançamentos que serão gerados e permite o usuário
 * conferir antes de confirmar com "CONFIRMAR E ENVIAR".
 */
import { useMemo } from 'react';
import { X, BookOpen, CheckCircle2, AlertTriangle } from 'lucide-react';
import { cn, formatCurrency } from '../lib/utils';
import type { DominioPlainLancamento } from '../logic/dominioPlainToRazao';
import { format } from 'date-fns';

export interface BalanceteEnvioLancamento {
  data: string;
  debito: string;
  credito: string;
  valor: number;
  historico: string;
  contrato: string;
}

interface Props {
  isOpen: boolean;
  lancamentos: BalanceteEnvioLancamento[];
  totalContratos: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function BalanceteEnvioModal({
  isOpen,
  lancamentos,
  totalContratos,
  onConfirm,
  onCancel,
}: Props) {
  if (!isOpen) return null;

  const totalValor = useMemo(
    () => lancamentos.reduce((acc, l) => acc + l.valor, 0),
    [lancamentos],
  );

  const hasData = lancamentos.length > 0;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.70)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="relative bg-[#0f0f0f] border border-emerald-500/30 text-white shadow-2xl w-full max-w-3xl flex flex-col animate-in fade-in zoom-in-95 duration-150"
        style={{ maxHeight: '85vh' }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10 shrink-0">
          <BookOpen className="text-emerald-400 shrink-0" size={18} />
          <div className="flex-1 min-w-0">
            <h2 className="text-[12px] font-black uppercase tracking-widest">
              Lançamentos para o Balancete
            </h2>
            <p className="text-[10px] text-white/50 font-mono mt-0.5">
              {totalContratos} contrato(s) · {lancamentos.length} lançamento(s) gerado(s)
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Fechar"
            className="text-white/40 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body — table */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {!hasData ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-white/40">
              <AlertTriangle size={32} />
              <p className="text-[11px] font-bold uppercase tracking-widest">
                Nenhum lançamento gerado.
              </p>
              <p className="text-[10px] opacity-60 text-center max-w-xs">
                Configure as contas contábeis na aba <strong>Contas</strong> de cada contrato antes
                de enviar.
              </p>
            </div>
          ) : (
            <table className="w-full text-[10px] font-mono border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-white/40 uppercase tracking-widest text-[9px]">
                  <th className="text-left pb-2 pr-3 font-bold">Data</th>
                  <th className="text-left pb-2 pr-3 font-bold">Contrato</th>
                  <th className="text-left pb-2 pr-3 font-bold">Histórico</th>
                  <th className="text-left pb-2 pr-3 font-bold">Débito</th>
                  <th className="text-left pb-2 pr-3 font-bold">Crédito</th>
                  <th className="text-right pb-2 font-bold">Valor</th>
                </tr>
              </thead>
              <tbody>
                {lancamentos.map((l, i) => (
                  <tr
                    key={i}
                    className={cn(
                      'border-b border-white/5 transition-colors',
                      i % 2 === 0 ? 'bg-white/[0.02]' : '',
                    )}
                  >
                    <td className="py-1.5 pr-3 text-white/60 whitespace-nowrap">{l.data}</td>
                    <td className="py-1.5 pr-3 text-white/70 truncate max-w-[100px]" title={l.contrato}>
                      {l.contrato}
                    </td>
                    <td className="py-1.5 pr-3 text-white/50 truncate max-w-[140px]" title={l.historico}>
                      {l.historico}
                    </td>
                    <td className="py-1.5 pr-3 text-sky-300/80 whitespace-nowrap">{l.debito}</td>
                    <td className="py-1.5 pr-3 text-emerald-300/80 whitespace-nowrap">{l.credito}</td>
                    <td className="py-1.5 text-right text-white font-bold whitespace-nowrap">
                      {formatCurrency(l.valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-white/20">
                  <td colSpan={5} className="pt-2 text-white/40 text-[9px] uppercase tracking-widest font-bold">
                    Total Geral
                  </td>
                  <td className="pt-2 text-right text-white font-black">
                    {formatCurrency(totalValor)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center px-5 py-3 border-t border-white/10 bg-white/5 shrink-0 gap-4">
          <p className="text-[10px] text-white/40 font-mono">
            Confira os lançamentos acima e clique em confirmar para registrar no razão.
          </p>
          <div className="flex gap-3 shrink-0">
            <button
              type="button"
              onClick={onCancel}
              className="px-5 py-2 text-[11px] font-black uppercase tracking-widest border border-white/20 text-white/60 hover:border-white/50 hover:text-white transition-all"
            >
              CANCELAR
            </button>
            {hasData && (
              <button
                type="button"
                onClick={onConfirm}
                className="flex items-center gap-2 px-6 py-2 text-[11px] font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-500 text-white transition-all"
              >
                <CheckCircle2 size={14} />
                CONFIRMAR E ENVIAR
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
