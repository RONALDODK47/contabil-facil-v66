import { Layers } from 'lucide-react';
import { motion } from 'motion/react';

export interface AcumuladorLinhaComparada {
  codigo: string;
  descricao: string;
  qtdNfs: number;
  totalSistema: number;
  totalPdf?: number;
}

function fmt(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}

interface Props {
  titulo: string;
  rows: AcumuladorLinhaComparada[];
}

/** Tabela de um acumulador — soma o que já foi importado (invoices, agrupado por accountCode)
 * e, se o "Resumo por Acumulador" (PDF Domínio) foi importado, compara com o total oficial. */
export function AcumuladorSecaoTable({ titulo, rows }: Props) {
  const temReferenciaPdf = rows.some((r) => r.totalPdf != null);

  return (
    <div className="technical-panel bg-white border border-brand-border shadow-[2px_2px_0_0_#141414] rounded-none overflow-hidden">
      <div className="p-3 border-b border-brand-border flex items-center justify-between bg-rose-50/40">
        <h3 className="text-xs font-black uppercase tracking-widest text-brand-text flex items-center space-x-2">
          <Layers size={16} className="text-rose-700" />
          <span>{titulo}</span>
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-brand-sidebar/40 border-b border-brand-border text-[9px] font-black text-brand-text uppercase tracking-widest">
              <th className="px-4 py-2.5">Acumulador</th>
              <th className="px-4 py-2.5">Descrição</th>
              <th className="px-4 py-2.5 text-center">NFs</th>
              <th className="px-4 py-2.5 text-right">Total no sistema (R$)</th>
              {temReferenciaPdf && (
                <>
                  <th className="px-4 py-2.5 text-right">Total no PDF Domínio (R$)</th>
                  <th className="px-4 py-2.5 text-right">Diferença</th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border/30 text-xs font-mono">
            {rows.map((r, idx) => {
              const diferenca = r.totalPdf != null ? r.totalSistema - r.totalPdf : null;
              const bate = diferenca == null || Math.abs(diferenca) < 0.01;
              return (
                <motion.tr
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: Math.min(idx * 0.02, 0.4) }}
                  key={r.codigo}
                  className="hover:bg-brand-sidebar/20 transition-colors"
                >
                  <td className="px-4 py-2.5 font-bold text-blue-700">{r.codigo}</td>
                  <td className="px-4 py-2.5 text-brand-text/80 font-sans italic">{r.descricao || 'Sem descrição'}</td>
                  <td className="px-4 py-2.5 text-center text-brand-text/70">{r.qtdNfs}</td>
                  <td className="px-4 py-2.5 text-right font-bold tabular-nums text-brand-text">{fmt(r.totalSistema)}</td>
                  {temReferenciaPdf && (
                    <>
                      <td className="px-4 py-2.5 text-right tabular-nums text-brand-text/80">
                        {r.totalPdf != null ? fmt(r.totalPdf) : '—'}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-bold tabular-nums ${
                          diferenca == null ? 'text-brand-text/40' : bate ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                        title={bate ? 'Bate com o PDF Domínio' : 'Não bate com o PDF Domínio'}
                      >
                        {diferenca != null ? fmt(diferenca) : '—'}
                      </td>
                    </>
                  )}
                </motion.tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={temReferenciaPdf ? 6 : 4} className="px-6 py-8 text-center text-brand-text/50 italic text-xs font-sans">
                  Nenhum acumulador identificado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
