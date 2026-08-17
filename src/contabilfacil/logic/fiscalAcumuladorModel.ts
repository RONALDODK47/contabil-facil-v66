import type { ParsedSpedFiscal, SpedFiscalItem } from '../../extratoVision/utils/spedFiscalParser';
import {
  notaFiscalTextoBusca,
  type SpedNotaFiscal,
} from '../../extratoVision/utils/spedNotasFiscaisParser';
import { formatSpedPeriodoLabel } from '../../extratoVision/utils/spedFiscalParser';
import { filtrarNotasFiscais, deveAplicarFiltroBloqueioNotas, type FiscalNotaBloqueioConfig } from './fiscalNotaBloqueio';

export function fiscalAcumuladorKey(item: Pick<SpedFiscalItem, 'registro' | 'codigo' | 'imposto'>): string {
  return `${item.registro}|${item.codigo}|${item.imposto}`.toUpperCase();
}

export type FiscalAcumuladorGroup = {
  id: string;
  key: string;
  arquivoId: string;
  fileName: string;
  periodo: string;
  item: SpedFiscalItem;
  notasFiscais: SpedNotaFiscal[];
};

function notasParaAcumulador(acum: SpedFiscalItem, notas: SpedNotaFiscal[]): SpedNotaFiscal[] {
  if (!notas.length) return [];

  if (acum.registro === 'C190') {
    const [cst, cfop] = acum.codigo.split('-');
    if (cfop) {
      const porCfop = notas.filter((n) => n.cfop === cfop && (!cst || !n.cstIcms || n.cstIcms === cst));
      if (porCfop.length > 0) return porCfop;
      const soCfop = notas.filter((n) => n.cfop === cfop);
      if (soCfop.length > 0) return soCfop;
    }
  }

  const cod = acum.codigo.trim();
  if (cod) {
    const porCod = notas.filter((n) => n.codContribuicao === cod);
    if (porCod.length > 0) return porCod;
  }

  const imp = acum.imposto.toUpperCase();
  if (imp.includes('PIS')) return notas.filter((n) => n.valorPis >= 0.01);
  if (imp.includes('COFINS')) return notas.filter((n) => n.valorCofins >= 0.01);
  if (imp.includes('ICMS')) return notas.filter((n) => n.valorIcms >= 0.01);
  if (imp.includes('IPI')) return notas.filter((n) => n.valorIpi >= 0.01);
  return notas;
}

export type FiscalSpedArquivoLike = {
  id: string;
  parsed: ParsedSpedFiscal;
};

export function buildFiscalAcumuladorGroups(
  arquivos: FiscalSpedArquivoLike[],
  bloqueio?: FiscalNotaBloqueioConfig,
): FiscalAcumuladorGroup[] {
  const groups: FiscalAcumuladorGroup[] = [];

  for (const arq of arquivos) {
    const parsed = arq.parsed;
    const notasBrutas = parsed.notasFiscais ?? [];
    const notas = deveAplicarFiltroBloqueioNotas(bloqueio)
        ? filtrarNotasFiscais(notasBrutas, bloqueio!)
        : notasBrutas;
    const periodo = formatSpedPeriodoLabel(parsed.dtIni, parsed.dtFin, parsed.dtFinLabel);

    for (const item of parsed.itens) {
      if (item.kind !== 'acumulador') continue;
      const key = fiscalAcumuladorKey(item);
      groups.push({
        id: `${arq.id}|${key}|${item.linha}`,
        key,
        arquivoId: arq.id,
        fileName: parsed.fileName,
        periodo,
        item,
        notasFiscais: notasParaAcumulador(item, notas),
      });
    }
  }

  return groups.sort(
    (a, b) =>
      a.fileName.localeCompare(b.fileName) ||
      a.item.registro.localeCompare(b.item.registro) ||
      a.item.linha - b.item.linha,
  );
}

export function notaFiscalRotulo(nota: SpedNotaFiscal): string {
  const num = nota.numero ? `NF ${nota.numero}` : 'NF';
  const part = nota.nomeParticipante ? ` · ${nota.nomeParticipante}` : '';
  const dt = nota.data ? ` · ${nota.data}` : '';
  return `${num}${part}${dt}`;
}

export { notaFiscalTextoBusca };
