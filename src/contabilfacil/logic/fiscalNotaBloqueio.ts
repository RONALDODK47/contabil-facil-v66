import type { SpedNotaFiscal } from '../../extratoVision/utils/spedNotasFiscaisParser';
import { cfopEhRemessa, cfopEhRemessaEntrada, cfopEhRemessaSaida, normalizarCfop } from './fiscalCfopCatalog';
import { notaFiscalTextoBusca } from '../../extratoVision/utils/spedNotasFiscaisParser';
import { normalizeExtratoMatchText } from './extratoRegrasContasStorage';

export type FiscalNotaBloqueioRegraTipo = 'texto' | 'cfop';

export type FiscalNotaBloqueioRegra = {
  id: string;
  tipo: FiscalNotaBloqueioRegraTipo;
  /** Texto de busca ou código CFOP (4 dígitos). */
  valor: string;
  /** Rótulo exibido no histórico (ex.: "Notas de remessa"). */
  rotulo: string;
  criadoEm: string;
};

export type FiscalNotaBloqueioConfig = {
  bloquearValorZero: boolean;
  /** Bloqueia automaticamente NFs com CFOP de remessa/consignação/transferência. */
  bloquearRemessa: boolean;
  regras: FiscalNotaBloqueioRegra[];
};

export type FiscalNotaBloqueioResultado = {
  bloqueada: boolean;
  motivo?: string;
  regraId?: string;
};

/** CFOPs típicos de remessa — entrada (1/2/3) e saída (5/6/7). */
export const CFOP_REMESSA_PRESET = [
  // Entrada de remessa / retorno
  '1901', '1902', '1903', '1904', '1905', '1906', '1907', '1908', '1909',
  '1912', '1913', '1914', '1915', '1916', '1917', '1918', '1919',
  '1920', '1921', '1922', '1923', '1924', '1925', '1926', '1927', '1928', '1929',
  '1949',
  '2901', '2902', '2903', '2904', '2905', '2906', '2907', '2908', '2909',
  '2912', '2913', '2914', '2915', '2916', '2917', '2918', '2919',
  '2920', '2921', '2922', '2923', '2924', '2925', '2926', '2927', '2928', '2929',
  '2949',
  '3901', '3902', '3903', '3904', '3905', '3906', '3907', '3908', '3909',
  '3949',
  // Saída de remessa
  '5901',
  '5902',
  '5903',
  '5904',
  '5905',
  '5906',
  '5907',
  '5908',
  '5909',
  '5910',
  '5911',
  '5912',
  '5913',
  '5914',
  '5915',
  '5916',
  '5917',
  '5918',
  '5919',
  '5920',
  '5921',
  '5922',
  '5923',
  '5924',
  '5925',
  '5949',
  '6901',
  '6902',
  '6903',
  '6904',
  '6905',
  '6906',
  '6907',
  '6908',
  '6909',
  '6910',
  '6911',
  '6912',
  '6913',
  '6914',
  '6915',
  '6916',
  '6917',
  '6918',
  '6919',
  '6920',
  '6921',
  '6922',
  '6923',
  '6924',
  '6925',
  '6949',
  '7901', '7902', '7903', '7904', '7905', '7906', '7907', '7908', '7909',
  '7949',
  // Transferência entre filiais
  '1151', '1152', '1153', '1154',
  '2151', '2152', '2153', '2154',
  '5151', '5152', '5153', '5154',
  '6151', '6152', '6153', '6154',
] as const;

export function deveAplicarFiltroBloqueioNotas(config?: FiscalNotaBloqueioConfig): boolean {
  if (!config) return false;
  return (
    config.bloquearValorZero !== false ||
    config.bloquearRemessa !== false ||
    config.regras.length > 0
  );
}

function motivoBloqueioRemessa(cfop: string): string {
  if (cfopEhRemessaEntrada(cfop)) return `Entrada de remessa (CFOP ${cfop}) — não importada`;
  if (cfopEhRemessaSaida(cfop)) return `Saída de remessa (CFOP ${cfop}) — não importada`;
  return `NF de remessa (CFOP ${cfop}) — não importada`;
}

export const DEFAULT_FISCAL_NOTA_BLOQUEIO: FiscalNotaBloqueioConfig = {
  bloquearValorZero: true,
  bloquearRemessa: true,
  regras: [],
};

function notaTextoCompleto(nota: SpedNotaFiscal): string {
  return normalizeExtratoMatchText(
    [notaFiscalTextoBusca(nota), nota.cfop, nota.cstIcms, nota.codContribuicao].filter(Boolean).join(' '),
  );
}

function notaValorZero(nota: SpedNotaFiscal): boolean {
  return Math.abs(nota.valorTotal ?? 0) < 0.01;
}

export function avaliarBloqueioNotaFiscal(
  nota: SpedNotaFiscal,
  config: FiscalNotaBloqueioConfig,
): FiscalNotaBloqueioResultado {
  if (config.bloquearValorZero && notaValorZero(nota)) {
    return { bloqueada: true, motivo: 'Valor zero' };
  }

  const texto = notaTextoCompleto(nota);
  const cfop = normalizarCfop(nota.cfop);

  if (config.bloquearRemessa !== false && cfop && cfopEhRemessa(cfop)) {
    return { bloqueada: true, motivo: motivoBloqueioRemessa(cfop) };
  }

  for (const regra of config.regras) {
    if (regra.tipo === 'cfop') {
      const cod = regra.valor.trim();
      if (cod && cfop === cod) {
        return { bloqueada: true, motivo: regra.rotulo || `CFOP ${cod}`, regraId: regra.id };
      }
      continue;
    }

    const needle = normalizeExtratoMatchText(regra.valor);
    if (needle && texto.includes(needle)) {
      return { bloqueada: true, motivo: regra.rotulo || regra.valor, regraId: regra.id };
    }
  }

  return { bloqueada: false };
}

export function filtrarNotasFiscais(
  notas: SpedNotaFiscal[],
  config: FiscalNotaBloqueioConfig,
): SpedNotaFiscal[] {
  const semFiltro =
    config.bloquearValorZero === false &&
    config.bloquearRemessa === false &&
    config.regras.length === 0;
  if (semFiltro) return notas;
  return notas.filter((n) => !avaliarBloqueioNotaFiscal(n, config).bloqueada);
}

export type FiscalNotaBloqueada = {
  nota: SpedNotaFiscal;
  motivo: string;
  regraId?: string;
};

export function separarNotasFiscais(
  notas: SpedNotaFiscal[],
  config: FiscalNotaBloqueioConfig,
): { aceitas: SpedNotaFiscal[]; bloqueadas: FiscalNotaBloqueada[] } {
  const aceitas: SpedNotaFiscal[] = [];
  const bloqueadas: FiscalNotaBloqueada[] = [];

  for (const nota of notas) {
    const r = avaliarBloqueioNotaFiscal(nota, config);
    if (r.bloqueada) {
      bloqueadas.push({ nota, motivo: r.motivo ?? 'Bloqueada', regraId: r.regraId });
    } else {
      aceitas.push(nota);
    }
  }

  return { aceitas, bloqueadas };
}

export function criarRegraBloqueio(
  draft: Pick<FiscalNotaBloqueioRegra, 'tipo' | 'valor' | 'rotulo'> & { id?: string },
): FiscalNotaBloqueioRegra | null {
  const valor = draft.tipo === 'cfop' ? draft.valor.replace(/\D/g, '').slice(0, 4) : draft.valor.trim();
  if (!valor) return null;
  const rotulo =
    normalizeExtratoMatchText(draft.rotulo ?? '') ||
    (draft.tipo === 'cfop' ? `CFOP ${valor}` : valor.slice(0, 40));
  return {
    id: draft.id?.trim() || crypto.randomUUID(),
    tipo: draft.tipo,
    valor: draft.tipo === 'cfop' ? valor : normalizeExtratoMatchText(valor),
    rotulo,
    criadoEm: new Date().toISOString(),
  };
}

export function regrasPresetRemessa(): FiscalNotaBloqueioRegra[] {
  const agora = new Date().toISOString();
  const texto = criarRegraBloqueio({
    tipo: 'texto',
    valor: 'remessa',
    rotulo: 'Texto: remessa',
  });
  const cfops = CFOP_REMESSA_PRESET.map((cfop) =>
    criarRegraBloqueio({
      tipo: 'cfop',
      valor: cfop,
      rotulo: `CFOP remessa ${cfop}`,
    }),
  ).filter((r): r is FiscalNotaBloqueioRegra => Boolean(r));
  if (texto) texto.criadoEm = agora;
  for (const r of cfops) r.criadoEm = agora;
  return texto ? [texto, ...cfops] : cfops;
}
