import type { VisionBalanceteRow, VisionPlanoRow } from '../types/accounting';
import { filtrarRazaoPorPeriodo, montarBalanceteComPeriodo } from './razaoContabil';

export type IndicesFinanceiros = {
  dataReferencia: string;
  ativoCirculante: number;
  ativoNaoCirculante: number;
  ativoTotal: number;
  passivoCirculante: number;
  passivoNaoCirculante: number;
  patrimonioLiquido: number;
  estoques: number;
  liquidezCorrente: number | null;
  liquidezSeca: number | null;
  liquidezGeral: number | null;
  endividamentoGeral: number | null;
  composicaoEndividamento: number | null;
};

function clsNorm(s: string): string {
  return (s || '').replace(/\./g, '').trim();
}

/** Saldo assinado no lado natural do grupo — positivo quando a conta está no lado esperado (D p/ ativo, C p/ passivo/PL). */
function valorNoLadoNatural(row: VisionBalanceteRow, ladoNatural: 'D' | 'C'): number {
  const mag = row.saldoFinal ?? 0;
  const nat = row.naturezaSaldoFinal ?? ladoNatural;
  return nat === ladoNatural ? mag : -mag;
}

/**
 * Índices financeiros clássicos (liquidez e endividamento), calculados a
 * partir do balancete acumulado até `dataReferencia`. Agrupa por prefixo de
 * classificação (1.1 = ativo circulante, 1.2 = ativo não circulante,
 * 2.1 = passivo circulante, 2.2 = passivo não circulante, restante do grupo
 * 2 = patrimônio líquido) — convenção usada no plano de contas do sistema.
 *
 * Liquidez geral usa todo o ativo não circulante como aproximação do
 * realizável a longo prazo (o plano não separa RLP de imobilizado/intangível).
 */
export function calcularIndicesFinanceiros(
  razaoRows: VisionBalanceteRow[],
  planoRows: VisionPlanoRow[],
  dataReferencia: string,
): IndicesFinanceiros {
  const linhasAteData = filtrarRazaoPorPeriodo(razaoRows, undefined, dataReferencia);
  const balancete = montarBalanceteComPeriodo(razaoRows, linhasAteData, planoRows, undefined, dataReferencia);

  let ativoCirculante = 0;
  let ativoNaoCirculante = 0;
  let passivoCirculante = 0;
  let passivoNaoCirculante = 0;
  let patrimonioLiquido = 0;
  let estoques = 0;

  for (const r of balancete) {
    if (r.tipo === 'S') continue; // só contas analíticas — sintéticas duplicariam a soma
    const cls = clsNorm(r.classificacao || r.codigo || '');
    if (!cls) continue;

    if (cls.startsWith('11')) {
      const v = valorNoLadoNatural(r, 'D');
      ativoCirculante += v;
      if (/estoque/i.test(r.nome || '')) estoques += v;
    } else if (cls.startsWith('12')) {
      ativoNaoCirculante += valorNoLadoNatural(r, 'D');
    } else if (cls.startsWith('21')) {
      passivoCirculante += valorNoLadoNatural(r, 'C');
    } else if (cls.startsWith('22')) {
      passivoNaoCirculante += valorNoLadoNatural(r, 'C');
    } else if (cls.startsWith('2')) {
      patrimonioLiquido += valorNoLadoNatural(r, 'C');
    }
  }

  const ativoTotal = ativoCirculante + ativoNaoCirculante;
  const passivoExigivel = passivoCirculante + passivoNaoCirculante;

  return {
    dataReferencia,
    ativoCirculante,
    ativoNaoCirculante,
    ativoTotal,
    passivoCirculante,
    passivoNaoCirculante,
    patrimonioLiquido,
    estoques,
    liquidezCorrente: passivoCirculante !== 0 ? ativoCirculante / passivoCirculante : null,
    liquidezSeca: passivoCirculante !== 0 ? (ativoCirculante - estoques) / passivoCirculante : null,
    liquidezGeral: passivoExigivel !== 0 ? (ativoCirculante + ativoNaoCirculante) / passivoExigivel : null,
    endividamentoGeral: ativoTotal !== 0 ? passivoExigivel / ativoTotal : null,
    composicaoEndividamento: passivoExigivel !== 0 ? passivoCirculante / passivoExigivel : null,
  };
}
