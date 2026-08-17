import type { SpedNotaFiscal } from '../../extratoVision/utils/spedNotasFiscaisParser';
import { filtrarNotasFiscais, deveAplicarFiltroBloqueioNotas, type FiscalNotaBloqueioConfig } from './fiscalNotaBloqueio';
import type { FiscalSpedArquivoLike } from './fiscalAcumuladorModel';
import {
  classificarNotaFiscal,
  FAMILIA_ORDEM,
  subtituloSecaoNotas,
  tituloSecaoNotas,
  type FiscalNotaAcumuladorFamilia,
  type FiscalNotaAcumuladorSentido,
} from './fiscalNotaAcumuladorClass';

export type FiscalNotaAcumuladorTotais = {
  valor: number;
  pis: number;
  cofins: number;
  icms: number;
  ipi: number;
};

export type FiscalNotaAcumuladorBucket = {
  id: string;
  bucketKey: string;
  sentido: FiscalNotaAcumuladorSentido;
  familia: FiscalNotaAcumuladorFamilia;
  titulo: string;
  subtitulo: string;
  notasFiscais: SpedNotaFiscal[];
  totais: FiscalNotaAcumuladorTotais;
};

export type FiscalNotaAcumuladorSecao = {
  id: string;
  sentido: FiscalNotaAcumuladorSentido;
  titulo: string;
  subtitulo: string;
  buckets: FiscalNotaAcumuladorBucket[];
  totais: FiscalNotaAcumuladorTotais;
  totalNotas: number;
};

function somarTotais(notas: SpedNotaFiscal[]): FiscalNotaAcumuladorTotais {
  return notas.reduce(
    (acc, n) => ({
      valor: acc.valor + Math.abs(n.valorTotal ?? 0),
      pis: acc.pis + Math.abs(n.valorPis ?? 0),
      cofins: acc.cofins + Math.abs(n.valorCofins ?? 0),
      icms: acc.icms + Math.abs(n.valorIcms ?? 0),
      ipi: acc.ipi + Math.abs(n.valorIpi ?? 0),
    }),
    { valor: 0, pis: 0, cofins: 0, icms: 0, ipi: 0 },
  );
}

function notaDedupeKey(n: SpedNotaFiscal): string {
  return [n.chave, n.numero, n.serie, n.codParticipante, n.linha, n.data].join('|');
}

function coletarNotasUnicas(
  arquivos: FiscalSpedArquivoLike[],
  bloqueio?: FiscalNotaBloqueioConfig,
): SpedNotaFiscal[] {
  const vistos = new Set<string>();
  const out: SpedNotaFiscal[] = [];

  for (const arq of arquivos) {
    const brutas = arq.parsed.notasFiscais ?? [];
    const notas = deveAplicarFiltroBloqueioNotas(bloqueio)
        ? filtrarNotasFiscais(brutas, bloqueio!)
        : brutas;
    for (const n of notas) {
      const k = notaDedupeKey(n);
      if (vistos.has(k)) continue;
      vistos.add(k);
      out.push(n);
    }
  }

  return out;
}

export function buildFiscalNotaAcumuladorArvore(
  arquivos: FiscalSpedArquivoLike[],
  bloqueio?: FiscalNotaBloqueioConfig,
): FiscalNotaAcumuladorSecao[] {
  const notas = coletarNotasUnicas(arquivos, bloqueio);
  const mapa = new Map<string, SpedNotaFiscal[]>();

  for (const nota of notas) {
    const { bucketKey } = classificarNotaFiscal(nota);
    const list = mapa.get(bucketKey) ?? [];
    list.push(nota);
    mapa.set(bucketKey, list);
  }

  const secoes: FiscalNotaAcumuladorSentido[] = ['entrada', 'saida'];
  return secoes.map((sentido) => {
    const buckets: FiscalNotaAcumuladorBucket[] = [];

    for (const familia of FAMILIA_ORDEM) {
      const bucketKey = `NF|${sentido.toUpperCase()}|${familia.toUpperCase()}`;
      const list = mapa.get(bucketKey) ?? [];
      if (list.length === 0) continue;
      const classif = classificarNotaFiscal(list[0]!);
      buckets.push({
        id: bucketKey,
        bucketKey,
        sentido,
        familia,
        titulo: classif.titulo,
        subtitulo: classif.subtitulo,
        notasFiscais: list.sort(
          (a, b) =>
            (a.data || '').localeCompare(b.data || '') ||
            (a.nomeParticipante || '').localeCompare(b.nomeParticipante || ''),
        ),
        totais: somarTotais(list),
      });
    }

    const todasNotas = buckets.flatMap((b) => b.notasFiscais);
    return {
      id: `secao-${sentido}`,
      sentido,
      titulo: tituloSecaoNotas(sentido),
      subtitulo: subtituloSecaoNotas(sentido),
      buckets,
      totais: somarTotais(todasNotas),
      totalNotas: todasNotas.length,
    };
  });
}
