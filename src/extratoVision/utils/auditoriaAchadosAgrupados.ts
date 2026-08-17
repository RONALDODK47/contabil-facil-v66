import type { AchadoAuditoriaBalancete } from './auditoriaBalanceteContinua';

export type AchadoAuditoriaAgrupado = {
  severidade: AchadoAuditoriaBalancete['severidade'];
  titulo: string;
  contas: string[];
  qtdContas: number;
  explicacao?: string;
  norma: string;
  normaParagrafo?: string;
  normaTrecho?: string;
};

const ORDEM_SEVERIDADE: Record<AchadoAuditoriaBalancete['severidade'], number> = {
  critico: 0,
  alerta: 1,
  info: 2,
};

function chaveAgrupamento(a: AchadoAuditoriaBalancete): string {
  return `${a.severidade}|${a.titulo.trim()}`;
}

/** Agrupa achados com o mesmo problema (uma explicação normativa, várias contas). */
export function agruparAchadosAuditoriaPorTipo(
  achados: AchadoAuditoriaBalancete[],
): AchadoAuditoriaAgrupado[] {
  const map = new Map<string, AchadoAuditoriaAgrupado>();

  for (const a of achados) {
    const k = chaveAgrupamento(a);
    let g = map.get(k);
    if (!g) {
      g = {
        severidade: a.severidade,
        titulo: a.titulo,
        contas: [],
        qtdContas: 0,
        explicacao: a.explicacao,
        norma: a.norma,
        normaParagrafo: a.normaParagrafo,
        normaTrecho: a.normaTrecho,
      };
      map.set(k, g);
    }
    const conta = a.conta?.trim() || '—';
    if (!g.contas.includes(conta)) g.contas.push(conta);
  }

  const grupos = [...map.values()].map((g) => ({
    ...g,
    qtdContas: g.contas.length,
    contas: [...g.contas].sort((a, b) => a.localeCompare(b, 'pt-BR')),
  }));

  grupos.sort((a, b) => {
    const sa = ORDEM_SEVERIDADE[a.severidade] - ORDEM_SEVERIDADE[b.severidade];
    if (sa !== 0) return sa;
    if (b.qtdContas !== a.qtdContas) return b.qtdContas - a.qtdContas;
    return a.titulo.localeCompare(b.titulo, 'pt-BR');
  });

  return grupos;
}

const MAX_CONTAS_LISTADAS_PDF = 30;

/** Lista numerada de contas para célula do PDF (com limite e reticências). */
export function formatContasAgrupadasPdf(contas: string[], max = MAX_CONTAS_LISTADAS_PDF): string {
  if (!contas.length) return '—';
  const linhas = [`${contas.length} conta(s):`];
  const shown = contas.slice(0, max);
  for (let i = 0; i < shown.length; i += 1) {
    linhas.push(`${i + 1}. ${shown[i]}`);
  }
  if (contas.length > max) {
    linhas.push(`... e mais ${contas.length - max} conta(s) com o mesmo problema.`);
  }
  return linhas.join('\n');
}

export function fundamentacaoNormativaAgrupadaPdf(g: AchadoAuditoriaAgrupado): string {
  const linhas = [
    'POR QUE ESTA ERRADO:',
    g.explicacao?.trim() || '—',
    '',
    `NORMA: ${g.norma?.trim() || '—'}`,
    `PARAGRAFO / ITEM: ${g.normaParagrafo?.trim() || '—'}`,
    `TRECHO: «${g.normaTrecho?.trim() || '—'}»`,
  ];
  return linhas.join('\n');
}
