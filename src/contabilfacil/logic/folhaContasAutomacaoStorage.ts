import { assertSomenteCodigoReduzido, sanitizeCodigoReduzido } from './planoContasMapper';
import { readManagerData, writeManagerData } from './companyWorkspace';
import { generateUUID } from '../../lib/uuid';
import { normalizeExtratoMatchText } from './extratoRegrasContasStorage';
import {
  classificarRubricaDestino,
  folhaDestinoLabel,
  getFolhaDestino,
  type FolhaDestinoId,
  type FolhaGrupoTipo,
} from './folhaRubricaTaxonomia';
import {
  emptyFolhaContasAutomacao,
  FOLHA_RUBRICAS,
  type FolhaContasAutomacaoConfig,
} from './folhaContasAutomacao';

// ---------------------------------------------------------------------------
// FolhaRegra — regras dinâmicas por histórico com débito + crédito
// (similar às regras de extrato bancário, mas com as duas pernas contábeis)
// ---------------------------------------------------------------------------

export type FolhaRegra = {
  id: string;
  /** Trecho do histórico/descrição do lançamento da folha (match por substring, uppercase). */
  descricao: string;
  contaDebito: string;
  contaCredito: string;
  /**
   * Quando preenchido, a regra vale para um DESTINO CONTÁBIL inteiro (ver
   * `folhaRubricaTaxonomia`) em vez de um histórico específico — ou seja, para todas as
   * rubricas cujos lançamentos vão para o mesmo par débito/crédito. Salário base, saldo de
   * salário, DSR, hora extra e gratificação viram UM histórico só; rubricas novas que ainda
   * não apareceram no relatório já entram cobertas.
   */
  destino?: FolhaDestinoId;
};

function sanitizeFolhaRegra(raw: Partial<FolhaRegra>): FolhaRegra | null {
  const destinoRaw = String(raw.destino ?? '').trim() as FolhaDestinoId;
  const destino = destinoRaw && getFolhaDestino(destinoRaw) ? destinoRaw : undefined;
  // Regra de destino dispensa histórico digitado: o rótulo do destino serve de descrição.
  const descricao = String(raw.descricao ?? '').trim() || (destino ? folhaDestinoLabel(destino) : '');
  const contaDebito = sanitizeCodigoReduzido(String(raw.contaDebito ?? '').trim()) ?? String(raw.contaDebito ?? '').trim();
  const contaCredito = sanitizeCodigoReduzido(String(raw.contaCredito ?? '').trim()) ?? String(raw.contaCredito ?? '').trim();
  if (!descricao || !contaDebito || !contaCredito) return null;
  return {
    id: String(raw.id ?? '').trim() || generateUUID(),
    descricao,
    contaDebito,
    contaCredito,
    ...(destino ? { destino } : {}),
  };
}

export function loadFolhaRegras(companyName: string): FolhaRegra[] {
  const rows = readManagerData<Partial<FolhaRegra>>(companyName, 'folhaRegras');
  return rows.map(sanitizeFolhaRegra).filter((r): r is FolhaRegra => Boolean(r));
}

export function saveFolhaRegras(companyName: string, regras: FolhaRegra[]): FolhaRegra[] {
  const sanitized = regras.map(sanitizeFolhaRegra).filter((r): r is FolhaRegra => Boolean(r));
  writeManagerData(companyName, 'folhaRegras', sanitized);
  return sanitized;
}

export function addFolhaRegra(
  companyName: string,
  draft: Omit<FolhaRegra, 'id'>,
): FolhaRegra[] {
  const regra = sanitizeFolhaRegra({ ...draft, id: generateUUID() });
  if (!regra) return loadFolhaRegras(companyName);
  const current = loadFolhaRegras(companyName);
  // Evita duplicatas exatas (mesma descrição + débito + crédito)
  const dup = current.some(
    (r) =>
      // Um histórico por destino é suficiente — não faz sentido cadastrar o mesmo duas vezes.
      (regra.destino ? r.destino === regra.destino : r.descricao.toUpperCase() === regra.descricao.toUpperCase() &&
        r.contaDebito === regra.contaDebito &&
        r.contaCredito === regra.contaCredito),
  );
  if (dup) return current;
  return saveFolhaRegras(companyName, [...current, regra]);
}

export function removeFolhaRegra(companyName: string, id: string): FolhaRegra[] {
  return saveFolhaRegras(companyName, loadFolhaRegras(companyName).filter((r) => r.id !== id));
}

export function updateFolhaRegra(
  companyName: string,
  id: string,
  patch: Partial<Omit<FolhaRegra, 'id'>>,
): FolhaRegra[] {
  const next = loadFolhaRegras(companyName).map((r) => {
    if (r.id !== id) return r;
    return sanitizeFolhaRegra({ ...r, ...patch, id }) ?? r;
  });
  return saveFolhaRegras(companyName, next);
}

/**
 * Resolve a regra (débito+crédito) de uma linha da folha pelo histórico — mesmo esquema de
 * casamento por substring usado nas regras de extrato/fiscal. Entre várias regras que batem,
 * prioriza a de descrição mais longa (mais específica).
 */
export function resolveFolhaRegraContas(
  historico: string,
  regras: FolhaRegra[],
  tipoRubrica?: FolhaGrupoTipo,
  /** Cabeçalho "Cálculo:" do relatório de origem — num de rescisão, tudo é verba rescisória. */
  tipoCalculo?: string,
): FolhaRegra | null {
  const norm = normalizeExtratoMatchText(historico);
  if (!norm) return null;

  // 1) Regras por histórico — sempre têm prioridade: são a exceção cadastrada à mão para
  //    uma rubrica específica dentro do destino (ex.: uma gratificação com conta própria).
  let best: FolhaRegra | null = null;
  for (const r of regras) {
    if (r.destino) continue;
    const descNorm = normalizeExtratoMatchText(r.descricao);
    if (!descNorm || !norm.includes(descNorm)) continue;
    if (!best || descNorm.length > normalizeExtratoMatchText(best.descricao).length) best = r;
  }
  if (best) return best;

  // 2) Regra de destino — um único histórico cobre todas as rubricas que vão para o mesmo
  //    par débito/crédito.
  const destino = classificarRubricaDestino(historico, tipoRubrica, {
    calculoRescisao: /RESCIS/i.test(String(tipoCalculo ?? '')),
  });
  if (!destino) return null;
  return regras.find((r) => r.destino === destino.id) ?? null;
}

function loadPlanoCompletoForContaResolve(companyName: string): Array<{
  code: string;
  name: string;
  codigoReduzido?: string;
  tipo?: string;
}> {
  return readManagerData<{
    code?: string;
    name?: string;
    codigoReduzido?: string;
    tipo?: string;
  }>(companyName, 'plano')
    .map((r) => ({
      code: String(r.code ?? '').trim(),
      name: String(r.name ?? '').trim(),
      codigoReduzido: sanitizeCodigoReduzido(r.codigoReduzido),
      tipo: r.tipo,
    }))
    .filter((r) => r.code || r.codigoReduzido);
}

function normalizeContaCampo(raw: string, plano: ReturnType<typeof loadPlanoCompletoForContaResolve>): string {
  const v = String(raw ?? '').trim();
  if (!v) return '';
  return assertSomenteCodigoReduzido(v, plano);
}

export function loadFolhaContasAutomacao(companyName: string): FolhaContasAutomacaoConfig {
  const base = emptyFolhaContasAutomacao();
  const plano = loadPlanoCompletoForContaResolve(companyName);
  const rows = readManagerData<Partial<FolhaContasAutomacaoConfig>>(companyName, 'folhaContasAutomacao');
  const stored = rows[0];
  if (!stored || typeof stored !== 'object') return base;
  for (const id of FOLHA_RUBRICAS) {
    const par = stored[id];
    if (par && typeof par === 'object') {
      base[id] = {
        debito: normalizeContaCampo(String(par.debito ?? ''), plano),
        credito: normalizeContaCampo(String(par.credito ?? ''), plano),
      };
    }
  }
  return base;
}

export function saveFolhaContasAutomacao(companyName: string, config: FolhaContasAutomacaoConfig): void {
  writeManagerData(companyName, 'folhaContasAutomacao', [config]);
}

// ---------------------------------------------------------------------------
// Opções do seletor "Puxar histórico da folha"
// ---------------------------------------------------------------------------

export type FolhaHistoricoOpcao = {
  /** Texto exibido no seletor. */
  descricao: string;
  /** Natureza predominante — só decora o item na lista. */
  nature: 'D' | 'C';
  /** Quantos lançamentos da folha este histórico cobre. */
  ocorrencias: number;
  /**
   * Preenchido quando a opção é um histórico CONSOLIDADO. Ao escolhê-la, a regra criada vale
   * para o destino inteiro. Vazio = rubrica que o classificador não reconheceu, que precisa
   * mesmo de uma regra por texto.
   */
  destino?: FolhaDestinoId;
};

type FolhaLinhaRelatorio = { description?: string; tipo?: FolhaGrupoTipo };

/**
 * Monta a lista do seletor de histórico da folha.
 *
 * O relatório traz dezenas de rubricas que terminam no MESMO débito e crédito — "SALARIO
 * EMPREGADO", "SALDO DE SALARIO HORAS", "SALDO DE SALARIO DIAS", "DESCANSO SEMANAL
 * REMUNERADO", as gratificações. Oferecer uma linha por rubrica polui a escolha e obriga a
 * cadastrar a mesma regra várias vezes, então aqui elas são substituídas por UM histórico
 * consolidado por destino contábil, com a soma dos lançamentos que ele cobre.
 *
 * Ficam de fora: rubricas já cobertas por alguma regra e os totalizadores (líquido, bases),
 * que não geram lançamento. Rubricas não classificadas continuam aparecendo uma a uma.
 */
export function construirHistoricosFolha(
  folhaRelatorio: FolhaLinhaRelatorio[],
  regras: FolhaRegra[],
): FolhaHistoricoOpcao[] {
  if (folhaRelatorio.length === 0) return [];

  const cobertosPorTexto = regras
    .filter((r) => !r.destino)
    .map((r) => normalizeExtratoMatchText(r.descricao))
    .filter(Boolean);

  const consolidados = new Map<FolhaDestinoId, FolhaHistoricoOpcao>();
  const avulsos = new Map<string, FolhaHistoricoOpcao>();

  for (const row of folhaRelatorio) {
    const texto = String(row.description ?? '').replace(/\s+/g, ' ').trim();
    if (!texto) continue;

    const norm = normalizeExtratoMatchText(texto);
    // Já existe regra por histórico cobrindo esta rubrica…
    if (cobertosPorTexto.some((c) => norm.includes(c))) continue;
    // …ou um histórico consolidado já a resolve.
    if (resolveFolhaRegraContas(texto, regras, row.tipo)) continue;

    const nature: 'D' | 'C' = row.tipo === 'DESCONTOS' ? 'D' : 'C';
    const destino = classificarRubricaDestino(texto, row.tipo);

    if (destino) {
      // Totalizadores não viram regra — não faz sentido oferecê-los.
      if (!destino.contabiliza) continue;
      const cur = consolidados.get(destino.id);
      if (cur) cur.ocorrencias += 1;
      else
        consolidados.set(destino.id, {
          descricao: destino.label,
          nature,
          ocorrencias: 1,
          destino: destino.id,
        });
    } else {
      const cur = avulsos.get(norm);
      if (cur) cur.ocorrencias += 1;
      else avulsos.set(norm, { descricao: texto, nature, ocorrencias: 1 });
    }
  }

  const porFrequencia = (a: FolhaHistoricoOpcao, b: FolhaHistoricoOpcao) =>
    b.ocorrencias - a.ocorrencias;

  // Consolidados primeiro: são o caminho normal. Avulsos são a exceção a tratar à mão.
  return [
    ...[...consolidados.values()].sort(porFrequencia),
    ...[...avulsos.values()].sort(porFrequencia),
  ];
}
