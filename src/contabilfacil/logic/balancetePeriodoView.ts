import type { VisionBalanceteRow, VisionPlanoRow } from '../../extratoVision/types/accounting';
import {
  compareClassificacaoContabil,
  enrichBalanceteComTipo,
} from '../../extratoVision/utils/demonstracoesContabeis';
import { parseBrDateToTime } from '../../extratoVision/utils/dateBounds';
import { enrichNaturezaSaldoImportado } from '../../extratoVision/utils/naturezaContabil';
import {
  extrairPeriodoRazao,
  filtrarRazaoPorPeriodo,
  montarBalanceteComPeriodo,
} from '../../extratoVision/utils/razaoContabil';

export { extrairPeriodoRazao };

function normReduced(v: string | undefined): string {
  const digits = String(v ?? '').replace(/\D/g, '');
  if (!digits) return '';
  const stripped = digits.replace(/^0+/, '');
  return stripped || '0';
}

/** Balancete de um único período (mesma lógica da interface Extrato Vision). */
export function buildBalanceteParaPeriodo(
  razaoRows: VisionBalanceteRow[],
  planoRows: VisionPlanoRow[],
  periodoDe: string,
  periodoAte: string,
): VisionBalanceteRow[] {
  const razaoFiltrado = filtrarRazaoPorPeriodo(razaoRows, periodoDe, periodoAte);
  let rows = montarBalanceteComPeriodo(razaoRows, razaoFiltrado, planoRows, periodoDe, periodoAte);
  const dataRef = periodoDe || periodoAte;
  if (dataRef) {
    rows = rows.map((r) => ({ ...r, data: r.data || dataRef }));
  }

  const enriquecido = rows.map((r) => enrichNaturezaSaldoImportado(r, rows));
  let typed = enrichBalanceteComTipo(enriquecido, planoRows);

  const parentBanco = planoRows.find((p) => /bancos?\s+conta\s+movimento/i.test(p.nome));
  if (!parentBanco) return typed;

  const parentNorm = parentBanco.codigo.replace(/\./g, '');
  const contasBancoPlano = planoRows.filter((p) => {
    const cod = p.codigo.replace(/\./g, '');
    return p.tipo === 'A' && cod.startsWith(parentNorm) && cod !== parentNorm;
  });
  if (contasBancoPlano.length === 0) return typed;

  const typedByClass = new Map(
    typed.map((r) => [String(r.classificacao ?? r.codigo ?? '').replace(/\./g, ''), r] as const),
  );
  const merged = [...typed];

  for (const p of contasBancoPlano) {
    const clsNorm = p.codigo.replace(/\./g, '');
    const redNorm = normReduced(p.codigoReduzido);
    const related = razaoFiltrado.filter((r) => {
      const rowCls = String(r.classificacao ?? '').replace(/\./g, '');
      const rowRed = normReduced(r.codigo);
      if (rowCls && rowCls === clsNorm) return true;
      if (redNorm && rowRed === redNorm) return true;
      return false;
    });

    const realDeb = related.reduce((s, r) => s + (r.debito ?? 0), 0);
    const realCred = related.reduce((s, r) => s + (r.credito ?? 0), 0);
    const realSi = related.reduce((s, r) => s + (r.saldoInicial ?? 0), 0);
    const hasReal =
      Math.abs(realDeb) > 0.0001 || Math.abs(realCred) > 0.0001 || Math.abs(realSi) > 0.0001;

    let firstDate: string | undefined;
    for (const r of related) {
      const d = r.data?.trim();
      if (!d) continue;
      if (!firstDate) {
        firstDate = d;
        continue;
      }
      const tNew = parseBrDateToTime(d);
      const tOld = parseBrDateToTime(firstDate);
      if (tNew !== null && tOld !== null && tNew < tOld) firstDate = d;
    }

    const existing = typedByClass.get(clsNorm);
    if (existing) {
      if (hasReal) {
        existing.saldoInicial = realSi;
        existing.debito = realDeb;
        existing.credito = realCred;
        existing.saldoFinal = realSi + realDeb - realCred;
        existing.data = firstDate ?? existing.data;
      }
      continue;
    }

    merged.push({
      codigo: p.codigoReduzido ?? p.codigo,
      classificacao: p.codigo,
      nome: p.nome,
      data: hasReal ? firstDate : undefined,
      saldoInicial: hasReal ? realSi : 0,
      debito: hasReal ? realDeb : 0,
      credito: hasReal ? realCred : 0,
      saldoFinal: hasReal ? realSi + realDeb - realCred : 0,
      tipo: 'A',
      nivel: p.nivel,
    });
  }

  return merged.sort((a, b) => {
    const byClass = compareClassificacaoContabil(a.classificacao ?? a.codigo, b.classificacao ?? b.codigo);
    if (byClass !== 0) return byClass;
    return (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR');
  });
}
