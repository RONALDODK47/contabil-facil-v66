import { useMemo } from 'react';
import type { AchadoAuditoriaBalancete } from '../utils/auditoriaBalanceteContinua';
import { agruparAchadosAuditoriaPorTipo } from '../utils/auditoriaAchadosAgrupados';

type Props = {
  achados: AchadoAuditoriaBalancete[];
  contabil?: boolean;
  maxContasVisiveis?: number;
};

export default function AchadosAuditoriaAgrupadosLista({
  achados,
  contabil = true,
  maxContasVisiveis = 12,
}: Props) {
  const grupos = useMemo(() => agruparAchadosAuditoriaPorTipo(achados), [achados]);

  if (!grupos.length) {
    return <p className="text-[10px] opacity-60">Nenhum achado.</p>;
  }

  return (
    <ul className="space-y-3 opacity-90 max-h-[min(70vh,520px)] overflow-y-auto pr-1">
      {grupos.map((g) => {
        const extra = g.qtdContas > maxContasVisiveis ? g.qtdContas - maxContasVisiveis : 0;
        return (
          <li
            key={`${g.severidade}-${g.titulo}`}
            className={
              contabil
                ? 'border border-brand-border/25 p-2.5 space-y-1.5 text-[10px]'
                : 'border border-red-800/40 p-2.5 space-y-1.5 text-[10px] text-red-100'
            }
          >
            <p>
              <span
                className={
                  g.severidade === 'critico'
                    ? 'text-red-800 font-black'
                    : g.severidade === 'alerta'
                      ? 'text-amber-900 font-black'
                      : 'font-bold'
                }
              >
                {g.severidade === 'critico' ? 'CRÍTICO' : g.severidade === 'alerta' ? 'ALERTA' : 'INFO'}
              </span>
              {' · '}
              <span className="font-bold">{g.titulo}</span>
              <span className="opacity-60"> ({g.qtdContas} conta{g.qtdContas !== 1 ? 's' : ''})</span>
            </p>
            <ul className="font-mono text-[9px] opacity-85 list-disc pl-4 space-y-0.5 max-h-28 overflow-y-auto">
              {g.contas.slice(0, maxContasVisiveis).map((c) => (
                <li key={c}>{c}</li>
              ))}
              {extra > 0 ? <li className="list-none -ml-4 opacity-60">… e mais {extra} conta(s)</li> : null}
            </ul>
            {g.explicacao ? (
              <p>
                <span className="font-black uppercase text-[9px] opacity-50">Por que está errado</span>
                <br />
                {g.explicacao}
              </p>
            ) : null}
            <p>
              <span className="font-black uppercase text-[9px] opacity-50">Norma</span>
              <br />
              {g.norma}
            </p>
            {g.normaParagrafo ? (
              <p>
                <span className="font-black uppercase text-[9px] opacity-50">Parágrafo / item</span>
                <br />
                {g.normaParagrafo}
              </p>
            ) : null}
            {g.normaTrecho ? (
              <p className="border-l-2 border-brand-border/40 pl-2 italic opacity-90">«{g.normaTrecho}»</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
