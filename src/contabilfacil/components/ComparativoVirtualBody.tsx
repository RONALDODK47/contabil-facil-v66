import { Fragment, memo, type ReactNode } from 'react';
import type { LinhaComparativoMensal, PeriodoMensal } from '../../extratoVision/utils/balanceteComparativoMensal';
import type { VirtualWindow } from '../lib/useVirtualWindow';
import { VirtualSpacerRow } from '../lib/useVirtualWindow';

interface ComparativoVirtualBodyProps {
  linhas: LinhaComparativoMensal[];
  periodos: PeriodoMensal[];
  mesRef: string;
  contabil: boolean;
  virtual: VirtualWindow;
  colSpan: number;
  renderRow: (props: {
    linha: LinhaComparativoMensal;
    periodos: PeriodoMensal[];
    mesRef: string;
    contabil: boolean;
    fixedHeight?: boolean;
  }) => ReactNode;
}

export default memo(function ComparativoVirtualBody({
  linhas,
  periodos,
  mesRef,
  contabil,
  virtual,
  colSpan,
  renderRow,
}: ComparativoVirtualBodyProps) {
  if (linhas.length === 0) {
    return (
      <tbody>
        <tr>
          <td colSpan={colSpan} className="p-8 text-center text-[10px] opacity-50">
            Nenhuma conta no filtro atual.
          </td>
        </tr>
      </tbody>
    );
  }

  if (!virtual.useVirtual) {
    return (
      <tbody className={contabil ? '' : 'divide-y divide-slate-800/60'}>
        {linhas.map((linha) =>
          periodos.length ? (
            <Fragment key={linha.chave || linha.codigo || linha.classificacao}>
              {renderRow({ linha, periodos, mesRef, contabil })}
            </Fragment>
          ) : null,
        )}
      </tbody>
    );
  }

  const slice = linhas.slice(virtual.startIndex, virtual.endIndex);

  return (
    <tbody className={contabil ? '' : 'divide-y divide-slate-800/60'}>
      <VirtualSpacerRow colSpan={colSpan} height={virtual.paddingTop} />
      {slice.map((linha, i) => {
        const absolute = virtual.startIndex + i;
        return (
          <Fragment key={linha.chave || `row-${absolute}`}>
            {periodos.length
              ? renderRow({ linha, periodos, mesRef, contabil, fixedHeight: true })
              : null}
          </Fragment>
        );
      })}
      <VirtualSpacerRow colSpan={colSpan} height={virtual.paddingBottom} />
    </tbody>
  );
});
