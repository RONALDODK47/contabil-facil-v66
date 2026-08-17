/**
 * Grupos sintéticos (entrada/saída) por pasta da Inteligência IA → analíticas para a IA.
 */
import { readManagerData } from './companyWorkspace';
import {
  ALL_INTELIGENCIA_PASTAS,
  PASTA_LABELS,
  loadAiInteligencia,
  matchColigadaNoHistorico,
  matchColigadaParaRegra,
  matchSocioNoHistorico,
  resolveContaColigadaParaNatureza,
  type AiColigada,
  type AiInteligenciaPasta,
  type AiInteligenciaPastaConfig,
  type AiSocio,
} from './aiInteligenciaStorage';
import type { ExtratoLinhaParaRegra, PlanoOptionLike } from './extratoRegrasCobertura';
import {
  isLancamentoFornecedorOuClienteGenerico,
  isMovimentoAplicacaoFinanceira,
  pickContaRendimentoOuAplicacao,
  pickFallbackContaPorNatureza,
  pickFundoFixoCaixaConta,
  sanitizarHistoricoExtratoParaRegra,
  shouldUsarFundoFixoPendencia,
} from './extratoRegrasCobertura';
import type { ExtratoRegraConta } from './extratoRegrasContasStorage';
import { normalizeExtratoMatchText } from './extratoRegrasContasStorage';
import { extractRegraEntityDescricao } from './extratoRegrasEntity';
import { scorePlanoContaParaHistorico } from './planoContasMatch';
import { resolveCodigoReduzidoDoPlano, sanitizeCodigoReduzido } from './planoContasMapper';

type PlanoRowLike = {
  code: string;
  name?: string;
  codigoReduzido?: string;
  tipo?: string;
  group?: string;
  grupo?: string;
};

export function normalizeGrupoClassificacao(raw: string, plano: PlanoRowLike[]): string {
  const v = String(raw ?? '').trim();
  if (!v) return '';

  if (/^\d+(\.\d+)+$/.test(v)) return v;

  const red = sanitizeCodigoReduzido(v);
  if (red) {
    const hit = plano.find(
      (p) => sanitizeCodigoReduzido(p.codigoReduzido) === red || String(p.code ?? '').trim() === v,
    );
    if (hit?.code) {
      const code = String(hit.code).trim();
      if (hit.tipo === 'S') return code;
      const parts = code.split('.');
      for (let d = parts.length - 1; d >= 1; d--) {
        const prefix = parts.slice(0, d).join('.');
        const syn = plano.find((p) => String(p.code ?? '').trim() === prefix && p.tipo === 'S');
        if (syn?.code) return String(syn.code).trim();
      }
      return code;
    }
  }

  const digits = v.replace(/\D/g, '');
  if (digits.length >= 2) {
    const syn = plano.find(
      (p) =>
        p.tipo === 'S' &&
        String(p.code ?? '')
          .replace(/\D/g, '')
          .startsWith(digits),
    );
    if (syn?.code) return String(syn.code).trim();
  }

  return v;
}

function resolveGrupoNome(classificacao: string, plano: PlanoRowLike[]): string {
  const hit = plano.find((p) => String(p.code ?? '').trim() === classificacao);
  return hit?.name ? String(hit.name).trim() : '';
}

export function listAnaliticasDoGrupo(classificacao: string, plano: PlanoRowLike[]): PlanoRowLike[] {
  const prefix = classificacao.trim();
  if (!prefix) return [];
  return plano.filter((p) => {
    if (p.tipo === 'S') return false;
    const red = sanitizeCodigoReduzido(p.codigoReduzido);
    if (!red) return false;
    const code = String(p.code ?? '').trim();
    return code === prefix || code.startsWith(`${prefix}.`);
  });
}

function formatGrupoBlock(
  pasta: AiInteligenciaPasta,
  sentido: 'entrada' | 'saida',
  classificacao: string,
  plano: PlanoRowLike[],
): string[] {
  const cls = normalizeGrupoClassificacao(classificacao, plano);
  if (!cls) return [];
  const nomeGrupo = resolveGrupoNome(cls, plano);
  const analiticas = listAnaliticasDoGrupo(cls, plano);
  const lines: string[] = [
    `· ${PASTA_LABELS[pasta]} · ${sentido.toUpperCase()} → sintética ${cls}${nomeGrupo ? ` (${nomeGrupo})` : ''}`,
  ];
  if (!analiticas.length) {
    lines.push('  (nenhuma analítica encontrada neste grupo — confira a classificação no plano)');
    return lines;
  }
  for (const a of analiticas.slice(0, 24)) {
    const red = sanitizeCodigoReduzido(a.codigoReduzido) || resolveCodigoReduzidoDoPlano(String(a.code ?? ''), plano) || '?';
    lines.push(`  · reduzido ${red} — ${String(a.name ?? '').trim()}`);
  }
  if (analiticas.length > 24) {
    lines.push(`  … +${analiticas.length - 24} analítica(s) neste grupo`);
  }
  return lines;
}

/** Mapa de grupos sintéticos por pasta — a IA escolhe analíticas por descrição dentro do grupo. */
export function buildPastasGruposContasParaIa(
  company: string,
  pastaConfigs: Partial<Record<AiInteligenciaPasta, AiInteligenciaPastaConfig>>,
): string {
  const plano = readManagerData<PlanoRowLike>(company, 'plano');
  if (!plano.length) return '';

  const lines: string[] = [
    `=== GRUPOS DE CONTAS POR PASTA — INTELIGÊNCIA IA — ${company} ===`,
    'Configure por pasta a conta SINTÉTICA de saída (D no banco) e entrada (C no banco).',
    'A IA deve escolher a ANALÍTICA (código reduzido) dentro do grupo conforme a descrição do extrato.',
    'É PROIBIDO usar contaContrapartida fora dos reduzidos listados abaixo quando a pasta/grupo se aplicar.',
    'Documentos são opcionais — os grupos já orientam a classificação.',
    '',
  ];

  let hasAny = false;
  for (const pasta of ALL_INTELIGENCIA_PASTAS) {
    const cfg = pastaConfigs[pasta];
    if (!cfg?.contaGrupoEntrada?.trim() && !cfg?.contaGrupoSaida?.trim()) continue;
    hasAny = true;
    lines.push(`--- ${PASTA_LABELS[pasta].toUpperCase()} ---`);
    if (cfg.contaGrupoSaida?.trim()) {
      lines.push(...formatGrupoBlock(pasta, 'saida', cfg.contaGrupoSaida, plano));
    }
    if (cfg.contaGrupoEntrada?.trim()) {
      lines.push(...formatGrupoBlock(pasta, 'entrada', cfg.contaGrupoEntrada, plano));
    }
    lines.push('');
  }

  if (!hasAny) return '';
  return lines.join('\n').slice(0, 14_000);
}

export function pastaConfigTemGrupos(cfg?: AiInteligenciaPastaConfig | null): boolean {
  return Boolean(cfg?.contaGrupoEntrada?.trim() || cfg?.contaGrupoSaida?.trim());
}

function grupoClassificacaoPastaNatureza(
  cfg: AiInteligenciaPastaConfig | undefined,
  nature: 'D' | 'C',
): string {
  return String(nature === 'D' ? cfg?.contaGrupoSaida : cfg?.contaGrupoEntrada ?? '').trim();
}

/** Códigos reduzidos analíticos permitidos no grupo sintético da pasta (saída=D, entrada=C). */
export function listReduzidosAnaliticosGrupoPasta(
  company: string,
  pasta: AiInteligenciaPasta,
  nature: 'D' | 'C',
  pastaConfigs?: Partial<Record<AiInteligenciaPasta, AiInteligenciaPastaConfig>>,
): Set<string> {
  const configs = pastaConfigs ?? loadAiInteligencia(company).pastaConfigs ?? {};
  const cfg = configs[pasta];
  const classificacao = grupoClassificacaoPastaNatureza(cfg, nature);
  if (!classificacao) return new Set();

  const plano = readManagerData<PlanoRowLike>(company, 'plano');
  const cls = normalizeGrupoClassificacao(classificacao, plano);
  if (!cls) return new Set();

  const out = new Set<string>();
  for (const a of listAnaliticasDoGrupo(cls, plano)) {
    const red =
      sanitizeCodigoReduzido(a.codigoReduzido) ||
      resolveCodigoReduzidoDoPlano(String(a.code ?? ''), plano) ||
      '';
    if (red) out.add(red);
  }
  return out;
}

export function pastaTemGrupoConfiguradoParaNatureza(
  company: string,
  pasta: AiInteligenciaPasta,
  nature: 'D' | 'C',
  pastaConfigs?: Partial<Record<AiInteligenciaPasta, AiInteligenciaPastaConfig>>,
): boolean {
  const configs = pastaConfigs ?? loadAiInteligencia(company).pastaConfigs ?? {};
  return Boolean(grupoClassificacaoPastaNatureza(configs[pasta], nature));
}

/** Identifica qual pasta da Inteligência IA governa o histórico da regra. */
export function inferPastaInteligenciaParaRegra(
  historico: string,
  nature: 'D' | 'C',
  coligadas: AiColigada[] = [],
  socios: AiSocio[] = [],
): AiInteligenciaPasta | null {
  const h = normalizeExtratoMatchText(historico);
  if (!h) return null;

  if (matchColigadaNoHistorico(h, coligadas)) return 'coligadas';

  if (
    matchSocioNoHistorico(h, socios) ||
    /PROLABORE|PRO\s*LABORE|RETIRADA\s+SOCIO|DIVIDENDO|DISTRIBUICAO\s+LUCRO/.test(h)
  ) {
    return 'contratos';
  }

  if (/FOLHA|SALARIO|FERIAS|RESCISAO|ORDENADO|13\s*SALARIO|VALE\s+TRANSPORTE/.test(h)) {
    return 'funcionarios';
  }

  if (/HONOR|CONTAD|ESCRITORIO|ASSESSORIA\s+CONT/.test(h)) return 'honorarios';

  if (
    nature === 'C' &&
    /RENDIMENTO|RECEITA\s+FIN|JUROS\s+CAP|BB\s+RENDE|REND\s+PAGO|LIQ\s+COBRAN/.test(h)
  ) {
    return 'receitas';
  }

  if (
    nature === 'D' &&
    /TARIFA|IOF|JUROS|ENCARGO|CESTA|DESPESA\s+FIN|APLIC\s+FIN|BB\s+RENDE/.test(h)
  ) {
    return 'despesas';
  }

  if (
    nature === 'D' &&
    /MATERIAL|HIGIENE|LIMPEZA|ESGOTO|SANEAGO|AGUA|ENERG|ELETRIC|ALUGUEL|COMPRA|SUPRIMENT|CONSERV|MANUTEN|TELEFON|INTERNET|PAPELARIA/.test(
      h,
    )
  ) {
    return 'despesas';
  }

  return null;
}

/** Pasta cujo grupo sintético deve limitar a conta (inclui fallback despesas/receitas). */
export function resolverPastaGrupoParaRegra(
  company: string,
  historico: string,
  nature: 'D' | 'C',
  coligadas: AiColigada[] = [],
  socios: AiSocio[] = [],
): AiInteligenciaPasta | null {
  const specific = inferPastaInteligenciaParaRegra(historico, nature, coligadas, socios);
  if (specific) return specific;

  const h = normalizeExtratoMatchText(historico);
  if (!h) return null;
  if (matchColigadaNoHistorico(h, coligadas)) return 'coligadas';
  if (matchSocioNoHistorico(h, socios)) return 'contratos';

  return null;
}

const MIN_SCORE_CONTA_NO_GRUPO = 30;

/** Escolhe conta analítica dentro do grupo sintético (sem buscar no plano inteiro). */
export function resolveContrapartidaNoGrupoPastaInteligencia(input: {
  company: string;
  description: string;
  nature: 'D' | 'C';
  plano: PlanoOptionLike[];
  coligadas?: AiColigada[];
  socios?: AiSocio[];
}): string {
  const { company, description, nature, plano, coligadas = [], socios = [] } = input;
  const desc = sanitizarHistoricoExtratoParaRegra(description, nature, coligadas);
  const pasta = inferPastaInteligenciaParaRegra(desc, nature, coligadas, socios);
  if (!pasta || !pastaTemGrupoConfiguradoParaNatureza(company, pasta, nature)) return '';

  const allowed = listReduzidosAnaliticosGrupoPasta(company, pasta, nature);
  if (allowed.size === 0) return '';

  return pickMelhorContaReduzidaNoGrupo(desc, nature, allowed, plano);
}

/**
 * Cobertura pós-IA: só casos especiais (coligada, PIX genérico, tarifa…) ou conta
 * escolhida por score DENTRO do grupo configurado — nunca busca no plano inteiro.
 */
export function buildFallbackRegrasDentroGrupoPasta(input: {
  company: string;
  uncovered: ExtratoLinhaParaRegra[];
  contaBanco: string;
  plano: PlanoOptionLike[];
  coligadas?: AiColigada[];
  socios?: AiSocio[];
  anexosTexto?: string[];
}): ExtratoRegraConta[] {
  const out: ExtratoRegraConta[] = [];
  const seen = new Set<string>();
  const banco = input.contaBanco.trim();
  if (!banco) return out;

  const coligadas = input.coligadas ?? [];
  const socios = input.socios ?? [];

  for (const row of input.uncovered) {
    const nature = row.nature === 'C' ? 'C' : 'D';
    const desc = extractRegraEntityDescricao(row.description, nature, coligadas);
    if (!desc) continue;

    let contra = '';

    const coligadaHit = matchColigadaParaRegra(row.description, coligadas);
    if (coligadaHit) {
      contra = resolveContaColigadaParaNatureza(coligadaHit, nature, input.plano) || '';
    } else if (
      shouldUsarFundoFixoPendencia({
        description: row.description,
        plano: input.plano,
        anexosTexto: input.anexosTexto,
      })
    ) {
      contra = pickFundoFixoCaixaConta(input.plano) || '';
    } else if (isMovimentoAplicacaoFinanceira(row.description, nature)) {
      contra = pickContaRendimentoOuAplicacao(nature, input.plano) || '';
    } else if (isLancamentoFornecedorOuClienteGenerico(row.description, nature, coligadas)) {
      contra = pickFallbackContaPorNatureza(nature, input.plano) || '';
    } else {
      contra = resolveContrapartidaNoGrupoPastaInteligencia({
        company: input.company,
        description: row.description,
        nature,
        plano: input.plano,
        coligadas,
        socios,
      });
    }

    if (!contra) continue;

    const key = `${nature}|${normalizeExtratoMatchText(desc)}|${contra}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: crypto.randomUUID(),
      nome: desc.slice(0, 40),
      descricao: desc,
      nature,
      contaBanco: banco,
      contaContrapartida: contra,
    });
  }
  return out;
}

function planoItemPorReduzido(
  reduzido: string,
  plano: PlanoOptionLike[],
): PlanoOptionLike | undefined {
  const red = sanitizeCodigoReduzido(reduzido);
  if (!red) return undefined;
  return plano.find(
    (p) =>
      sanitizeCodigoReduzido(p.codigoReduzido) === red ||
      sanitizeCodigoReduzido(p.code) === red,
  );
}

function pickMelhorContaReduzidaNoGrupo(
  historico: string,
  nature: 'D' | 'C',
  allowed: Set<string>,
  plano: PlanoOptionLike[],
): string {
  let best = '';
  let bestScore = -1;
  for (const p of plano) {
    const red = sanitizeCodigoReduzido(p.codigoReduzido) || sanitizeCodigoReduzido(p.code) || '';
    if (!red || !allowed.has(red)) continue;
    const score = scorePlanoContaParaHistorico(historico, nature, p);
    if (score > bestScore) {
      bestScore = score;
      best = red;
    }
  }
  if (best && bestScore >= MIN_SCORE_CONTA_NO_GRUPO) return best;
  return '';
}

export type AiRegraGrupoPastaLike = {
  descricao: string;
  nature: 'D' | 'C';
  contaContrapartida: string;
  motivo?: string;
};

/**
 * Garante que a conta da regra esteja dentro do grupo sintético configurado na pasta.
 * Rejeita (null) se a IA sugerir conta fora e não houver substituto plausível no grupo.
 */
export function aplicarRestricaoGrupoPastaInteligencia(input: {
  company: string;
  regra: AiRegraGrupoPastaLike;
  historico: string;
  plano: PlanoOptionLike[];
  coligadas?: AiColigada[];
  socios?: AiSocio[];
}): AiRegraGrupoPastaLike | null {
  const { company, regra, historico, plano, coligadas = [], socios = [] } = input;
  const historicoLimpo = sanitizarHistoricoExtratoParaRegra(historico, regra.nature, coligadas);
  const pasta = resolverPastaGrupoParaRegra(company, historicoLimpo, regra.nature, coligadas, socios);
  if (!pasta) return { ...regra, descricao: historicoLimpo || regra.descricao };
  if (!pastaTemGrupoConfiguradoParaNatureza(company, pasta, regra.nature)) {
    return { ...regra, descricao: historicoLimpo || regra.descricao };
  }

  const allowed = listReduzidosAnaliticosGrupoPasta(company, pasta, regra.nature);
  if (allowed.size === 0) return null;

  const contra =
    sanitizeCodigoReduzido(regra.contaContrapartida) ||
    resolveCodigoReduzidoDoPlano(regra.contaContrapartida, plano) ||
    '';

  const descricao = historicoLimpo || regra.descricao;

  if (contra && allowed.has(contra)) {
    const contaHit = planoItemPorReduzido(contra, plano);
    const scoreAtual = contaHit
      ? scorePlanoContaParaHistorico(descricao, regra.nature, contaHit)
      : 0;
    if (scoreAtual >= MIN_SCORE_CONTA_NO_GRUPO) {
      return { ...regra, descricao, contaContrapartida: contra };
    }
  }

  const melhor = pickMelhorContaReduzidaNoGrupo(descricao, regra.nature, allowed, plano);
  if (!melhor) return null;

  return {
    ...regra,
    descricao,
    contaContrapartida: melhor,
    motivo: `${regra.motivo || 'Regra'} — conta no grupo ${PASTA_LABELS[pasta]}`,
  };
}

/** Reaplica limites de grupo em regras já salvas (fallback/IA antiga). */
export function corrigeRegrasForaGrupoPastaInteligencia(input: {
  company: string;
  regras: Array<{
    id: string;
    nome: string;
    descricao: string;
    nature: 'D' | 'C';
    contaBanco: string;
    contaContrapartida: string;
  }>;
  plano: PlanoOptionLike[];
  coligadas?: AiColigada[];
  socios?: AiSocio[];
}): typeof input.regras {
  const { company, regras, plano, coligadas = [], socios = [] } = input;
  let changed = false;
  const next = regras.flatMap((r) => {
    const nature = r.nature === 'C' ? ('C' as const) : ('D' as const);
    const pasta = resolverPastaGrupoParaRegra(company, r.descricao, nature, coligadas, socios);
    const temGrupo =
      pasta != null && pastaTemGrupoConfiguradoParaNatureza(company, pasta, nature);
    const enforced = aplicarRestricaoGrupoPastaInteligencia({
      company,
      regra: { descricao: r.descricao, nature, contaContrapartida: r.contaContrapartida },
      historico: r.descricao,
      plano,
      coligadas,
      socios,
    });
    if (!enforced) return temGrupo ? [] : [r];
    if (
      enforced.contaContrapartida !== r.contaContrapartida ||
      enforced.descricao !== r.descricao
    ) {
      changed = true;
    }
    return [
      {
        ...r,
        descricao: enforced.descricao,
        nature: enforced.nature,
        contaContrapartida: enforced.contaContrapartida,
        nome: enforced.descricao.slice(0, 40),
      },
    ];
  });
  return changed ? next : regras;
}
