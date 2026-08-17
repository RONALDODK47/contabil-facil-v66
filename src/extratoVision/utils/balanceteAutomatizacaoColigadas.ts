/**
 * Empréstimo / transferência entre a empresa atual e uma coligada já cadastrada.
 *
 * A data NÃO usa a opção global da automação (último dia / hoje / fixa):
 * vem do próprio lançamento bancário (razão/extrato) desta empresa ou da coligada.
 * O sistema confere se os valores batem entre as duas; se não bater, busca o
 * lançamento correspondente na outra empresa.
 */

import type { VisionBalanceteRow, VisionPlanoRow } from '../types/accounting';
import {
  type AutomacaoContaConfig,
  type AutomacaoEmprestimoColigada,
  rowFromVinculo,
} from './automatizacaoContaConfig';
import type { PeriodoMensal } from './balanceteComparativoMensal';
import { aplicarLancamentosNoRazao } from './balanceteAutoCorrecao';
import { getClassificacao } from './demonstracoesContabeis';
import { enrichNaturezaSaldoImportado } from './naturezaContabil';
import { filtrarRazaoPorPeriodo, montarBalanceteComPeriodo } from './razaoContabil';
import { parseBrDateToTime } from './dateBounds';
import {
  loadCompaniesRegistryLite,
  normalizeCompanyName,
  readManagerDataLite,
} from './coligadaWorkspaceLite';
import {
  isContaColigadaNome,
  listAiColigadasParaIa,
} from '../../contabilfacil/logic/aiInteligenciaStorage';
import { criarParLancamento, normalizarClassificacao } from './balanceteLancamentos';

const normCls = normalizarClassificacao;

/**
 * Palavras genéricas de razão social — sozinhas não identificam uma empresa
 * específica (ex.: "COMERCIO" aparece tanto em "IMPERIO COMERCIO LTDA" quanto
 * em "A ECONOMICA COMERCIO"). Excluídas dos fragmentos usados para casar o
 * nome da coligada com o histórico do banco, senão uma coligada "rouba"
 * lançamentos de outra que só compartilha o termo genérico.
 */
const GENERIC_COLIGADA_WORDS = new Set([
  'COMERCIO',
  'COMERCIAL',
  'SERVICOS',
  'SERVICO',
  'INDUSTRIA',
  'INDUSTRIAL',
  'GRUPO',
  'HOLDING',
  'EMPREENDIMENTOS',
  'PARTICIPACOES',
  'TRANSPORTES',
  'LOGISTICA',
  'DISTRIBUIDORA',
  'ATACADO',
  'VAREJO',
  'ALIMENTOS',
  'LTDA',
  'EIRELI',
]);

function fragmentosDistintivos(nomeEmpresa: string): string[] {
  return nomeEmpresa
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !GENERIC_COLIGADA_WORDS.has(w.toUpperCase()))
    .slice(0, 3);
}

function parTransferencia(
  debito: VisionBalanceteRow,
  credito: VisionBalanceteRow,
  valor: number,
  data: string,
  historico: string,
  ordem: number,
): VisionBalanceteRow[] {
  const importId = `coligada:${(debito.codigo ?? '').trim()}|${(credito.codigo ?? '').trim()}|${historico}|${data}`;
  return criarParLancamento({ contaDeb: debito, contaCred: credito, valor, data, historico, ordem, importId });
}

function empresaExisteNoSistema(nome: string): boolean {
  const alvo = normalizeCompanyName(nome);
  return loadCompaniesRegistryLite().some((c) => c.name === alvo);
}

function coligadaConhecidaNaIa(empresaAtual: string, nomeColigada: string): boolean {
  const alvo = normalizeCompanyName(nomeColigada);
  return listAiColigadasParaIa(empresaAtual).some((c) => {
    if (normalizeCompanyName(c.nome) === alvo) return true;
    return (c.aliases ?? []).some((a) => normalizeCompanyName(a) === alvo);
  });
}

function contaBateComColigada(row: VisionBalanceteRow, empresaColigada: string): boolean {
  const n = (row.nome ?? '').toLowerCase();
  const frag = fragmentosDistintivos(empresaColigada);
  if (isContaColigadaNome(row.nome ?? '')) return true;
  if (/m[uú]tuo|emprestimo|empr[eé]stimo|coligad|partes?\s+relacionad/i.test(n)) return true;
  return frag.some((w) => n.includes(w));
}

function findNoBalancete(
  balancete: VisionBalanceteRow[],
  vinculoCls: string,
): VisionBalanceteRow | null {
  const c = normCls(vinculoCls);
  return (
    balancete.find((r) => r.tipo !== 'S' && normCls(getClassificacao(r)) === c) ?? null
  );
}

function saldoAbs(row: VisionBalanceteRow): number {
  return Math.abs(Number(row.saldoFinal ?? 0));
}

function rowMatchesConta(r: VisionBalanceteRow, cls: string): boolean {
  const c = normCls(cls);
  if (!c) return false;
  return normCls(getClassificacao(r)) === c || normCls(r.codigo ?? '') === c;
}

function valorLancamento(r: VisionBalanceteRow): number {
  return Math.max(Math.abs(Number(r.debito ?? 0)), Math.abs(Number(r.credito ?? 0)));
}

type EspelhoColigada = {
  data: string;
  valor: number;
  origem: 'razao_atual' | 'extrato_atual' | 'razao_coligada' | 'extrato_coligada';
  bate: boolean;
  detalhe: string;
};

/** Data/valor a partir do razão (lançamentos bancários / mútuo no período). */
function buscarNoRazao(
  razaoPeriodo: VisionBalanceteRow[],
  clsDeb: string,
  clsCred: string,
  origem: EspelhoColigada['origem'],
): EspelhoColigada | null {
  const candidatos = razaoPeriodo.filter(
    (r) =>
      r.data?.trim() &&
      valorLancamento(r) >= 0.05 &&
      (rowMatchesConta(r, clsDeb) ||
        rowMatchesConta(r, clsCred) ||
        /banco|caixa|m[uú]tuo|emprestimo|coligad|transfer/i.test(r.nome ?? '')),
  );
  if (!candidatos.length) return null;

  // Prefere lançamento nas contas D/C configuradas
  const nasContas = candidatos.filter(
    (r) => rowMatchesConta(r, clsDeb) || rowMatchesConta(r, clsCred),
  );
  const pool = nasContas.length ? nasContas : candidatos;
  pool.sort((a, b) => {
    const ta = parseBrDateToTime(a.data ?? '') ?? 0;
    const tb = parseBrDateToTime(b.data ?? '') ?? 0;
    return tb - ta;
  });
  const best = pool[0];
  return {
    data: best.data!.trim(),
    valor: valorLancamento(best),
    origem,
    bate: true,
    detalhe: `lançamento ${best.data} · R$ ${valorLancamento(best).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
  };
}

type ExtratoRowLite = {
  date?: string;
  description?: string;
  value?: number;
  nature?: string;
};

function buscarNoExtrato(
  empresa: string,
  periodo: PeriodoMensal,
  nomeColigada: string,
  origem: EspelhoColigada['origem'],
): EspelhoColigada | null {
  let rows: ExtratoRowLite[] = [];
  try {
    rows = readManagerDataLite<ExtratoRowLite>(empresa, 'extrato');
  } catch {
    return null;
  }
  const deT = parseBrDateToTime(periodo.de);
  const ateT = parseBrDateToTime(periodo.ate);
  const frag = fragmentosDistintivos(nomeColigada);

  const candidatos: EspelhoColigada[] = [];
  for (const r of rows) {
    const dataRaw = String(r.date ?? '').trim();
    // Extrato pode estar em YYYY-MM-DD
    let dataBr = dataRaw;
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(dataRaw);
    if (iso) dataBr = `${iso[3]}/${iso[2]}/${iso[1]}`;
    const t = parseBrDateToTime(dataBr);
    if (t == null) continue;
    if (deT != null && t < deT) continue;
    if (ateT != null && t > ateT) continue;
    const valor = Math.abs(Number(r.value ?? 0));
    if (valor < 0.05) continue;
    const desc = String(r.description ?? '').toLowerCase();
    const menciona =
      frag.some((w) => desc.includes(w)) ||
      /m[uú]tuo|emprestimo|coligad|transfer/i.test(desc);
    if (!menciona) continue;
    candidatos.push({
      data: dataBr,
      valor,
      origem,
      bate: true,
      detalhe: `extrato ${dataBr} · R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
    });
  }
  if (!candidatos.length) return null;
  candidatos.sort((a, b) => (parseBrDateToTime(b.data) ?? 0) - (parseBrDateToTime(a.data) ?? 0));
  return candidatos[0];
}

/**
 * Resolve data/valor pelo banco (extrato/razão), conferindo com a coligada.
 * Não usa dataModo da automação.
 */
function resolverEspelhoColigada(params: {
  periodo: PeriodoMensal;
  razaoAtualPeriodo: VisionBalanceteRow[];
  empresaAtual: string;
  empresaColigada: string;
  clsDeb: string;
  clsCred: string;
  valorSaldoContas: number;
}): EspelhoColigada {
  const { periodo, razaoAtualPeriodo, empresaAtual, empresaColigada, clsDeb, clsCred, valorSaldoContas } =
    params;

  const localRazao = buscarNoRazao(razaoAtualPeriodo, clsDeb, clsCred, 'razao_atual');
  const localExtrato = empresaAtual
    ? buscarNoExtrato(empresaAtual, periodo, empresaColigada, 'extrato_atual')
    : null;

  let coligRazao: EspelhoColigada | null = null;
  let coligExtrato: EspelhoColigada | null = null;
  if (empresaExisteNoSistema(empresaColigada)) {
    try {
      const razaoColig = readManagerDataLite<VisionBalanceteRow>(empresaColigada, 'razao');
      const razaoColigPeriodo = filtrarRazaoPorPeriodo(razaoColig, periodo.de, periodo.ate);
      coligRazao = buscarNoRazao(razaoColigPeriodo, clsDeb, clsCred, 'razao_coligada');
    } catch {
      coligRazao = null;
    }
    coligExtrato = buscarNoExtrato(empresaColigada, periodo, empresaAtual || empresaColigada, 'extrato_coligada');
  }

  const candidatos = [localExtrato, localRazao, coligExtrato, coligRazao].filter(
    (c): c is EspelhoColigada => Boolean(c),
  );

  if (!candidatos.length) {
    // Sem lançamento bancário encontrado — não inventa data da opção global
    return {
      data: '',
      valor: valorSaldoContas,
      origem: 'razao_atual',
      bate: false,
      detalhe: 'sem lançamento bancário com data nesta empresa nem na coligada',
    };
  }

  // Preferência: extrato atual → razão atual → extrato/razão da coligada
  const preferido = candidatos[0];
  const outro = candidatos.find((c) => c.origem !== preferido.origem);
  let bate = true;
  let detalhe = preferido.detalhe;
  if (outro) {
    const delta = Math.abs(preferido.valor - outro.valor);
    bate = delta < 0.05;
    detalhe = bate
      ? `bate com ${outro.origem.replace(/_/g, ' ')} (${outro.detalhe})`
      : `divergência vs ${outro.origem.replace(/_/g, ' ')}: ${preferido.detalhe} × ${outro.detalhe}`;
    // Se não bate, usa o da coligada quando o local não tem espelho claro
    if (!bate && (outro.origem === 'razao_coligada' || outro.origem === 'extrato_coligada')) {
      return { ...outro, bate: false, detalhe };
    }
  }

  return { ...preferido, bate, detalhe };
}

export type ResultadoEmprestimoColigadas = {
  razao: VisionBalanceteRow[];
  lancamentos: VisionBalanceteRow[];
  detalhes: string[];
};

/**
 * Valida empresa coligada + contas; data vem do banco (não da opção de data da automação).
 */
export function executarEmprestimoEntreColigadas(params: {
  periodos: PeriodoMensal[];
  razaoRows: VisionBalanceteRow[];
  planoRows: VisionPlanoRow[];
  contaConfig?: AutomacaoContaConfig;
  empresaNome?: string;
  onProgress?: (msg: string) => void;
}): ResultadoEmprestimoColigadas {
  const vinculos = params.contaConfig?.emprestimoColigadas ?? [];
  if (!vinculos.length) {
    return { razao: params.razaoRows, lancamentos: [], detalhes: [] };
  }

  let razaoAtual = params.razaoRows;
  const lancamentos: VisionBalanceteRow[] = [];
  const detalhes: string[] = [];
  let ordem = 940_000;
  const empresaAtual = params.empresaNome ?? '';

  for (const periodo of params.periodos) {
    const mesLabel = periodo.label;
    params.onProgress?.(`Coligadas · ${mesLabel}`);

    const razaoPeriodo = filtrarRazaoPorPeriodo(razaoAtual, periodo.de, periodo.ate);
    const balanceteMesRaw = montarBalanceteComPeriodo(
      razaoAtual,
      razaoPeriodo,
      params.planoRows,
      periodo.de,
      periodo.ate,
    );
    const balanceteMes = balanceteMesRaw.map((r) => enrichNaturezaSaldoImportado(r, balanceteMesRaw));

    for (const v of vinculos) {
      const r = processarVinculoColigada({
        vinculo: v,
        mesLabel,
        periodo,
        razaoPeriodo,
        planoRows: params.planoRows,
        balanceteMes,
        empresaAtual,
        ordem,
      });
      ordem = r.ordem;
      if (r.detalhe) detalhes.push(r.detalhe);
      if (r.lancamentos.length) {
        lancamentos.push(...r.lancamentos);
        razaoAtual = aplicarLancamentosNoRazao(razaoAtual, r.lancamentos);
      }
    }
  }

  return { razao: razaoAtual, lancamentos, detalhes };
}

function processarVinculoColigada(params: {
  vinculo: AutomacaoEmprestimoColigada;
  mesLabel: string;
  periodo: PeriodoMensal;
  razaoPeriodo: VisionBalanceteRow[];
  planoRows: VisionPlanoRow[];
  balanceteMes: VisionBalanceteRow[];
  empresaAtual: string;
  ordem: number;
}): { lancamentos: VisionBalanceteRow[]; detalhe?: string; ordem: number } {
  const { vinculo, mesLabel, periodo, razaoPeriodo, planoRows, balanceteMes, empresaAtual } = params;
  let ordem = params.ordem;
  const nomeEmp = vinculo.empresaColigada.trim();

  if (!nomeEmp) {
    return { lancamentos: [], detalhe: `${mesLabel}: vínculo coligada sem empresa.`, ordem };
  }

  const existeRegistry = empresaExisteNoSistema(nomeEmp);
  const existeIa = empresaAtual ? coligadaConhecidaNaIa(empresaAtual, nomeEmp) : false;
  if (!existeRegistry && !existeIa) {
    return {
      lancamentos: [],
      detalhe: `${mesLabel} · ${nomeEmp}: empresa não encontrada no sistema nem nas coligadas da Inteligência IA — confira o nome.`,
      ordem,
    };
  }

  if (!vinculo.debito?.classificacao || !vinculo.credito?.classificacao) {
    return {
      lancamentos: [],
      detalhe: `${mesLabel} · ${nomeEmp}: configure Débito e Crédito do empréstimo entre coligadas.`,
      ordem,
    };
  }

  const debPlano = rowFromVinculo(vinculo.debito, planoRows, balanceteMes);
  const credPlano = rowFromVinculo(vinculo.credito, planoRows, balanceteMes);
  if (!debPlano || !credPlano) {
    return {
      lancamentos: [],
      detalhe: `${mesLabel} · ${nomeEmp}: contas D/C não localizadas no plano.`,
      ordem,
    };
  }

  const debOk = contaBateComColigada(debPlano, nomeEmp);
  const credOk = contaBateComColigada(credPlano, nomeEmp);
  if (!debOk && !credOk) {
    return {
      lancamentos: [],
      detalhe: `${mesLabel} · ${nomeEmp}: contas não batem com a coligada (sem referência a coligada/mútuo no nome). Ajuste D/C.`,
      ordem,
    };
  }

  const debBal = findNoBalancete(balanceteMes, vinculo.debito.classificacao) ?? debPlano;
  const credBal = findNoBalancete(balanceteMes, vinculo.credito.classificacao) ?? credPlano;
  const valorSaldo = Math.max(saldoAbs(debBal), saldoAbs(credBal));

  const espelho = resolverEspelhoColigada({
    periodo,
    razaoAtualPeriodo: razaoPeriodo,
    empresaAtual,
    empresaColigada: nomeEmp,
    clsDeb: vinculo.debito.classificacao,
    clsCred: vinculo.credito.classificacao,
    valorSaldoContas: valorSaldo,
  });

  const origemOk = existeRegistry ? 'empresa no sistema' : 'coligada IA';

  if (!espelho.data) {
    return {
      lancamentos: [],
      detalhe: `${mesLabel} · ${nomeEmp}: conferido (${origemOk}) — ${espelho.detalhe}. Data vem do banco; opção de data da automação não se aplica.`,
      ordem,
    };
  }

  const valor = espelho.valor >= 0.05 ? espelho.valor : valorSaldo;
  if (valor < 0.05) {
    return {
      lancamentos: [],
      detalhe: `${mesLabel} · ${nomeEmp}: data bancária ${espelho.data} encontrada, mas sem valor para transferir.`,
      ordem,
    };
  }

  const hist = `[Auto] Empréstimo coligada ${nomeEmp} ${espelho.data}`;
  const lanc = parTransferencia(debBal, credBal, valor, espelho.data, hist, ordem);
  ordem += 10;
  const statusBate = espelho.bate ? 'batendo' : 'ajustado pela coligada';
  return {
    lancamentos: lanc,
    detalhe: `${mesLabel} · ${nomeEmp}: ${statusBate} · data do banco ${espelho.data} · R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${espelho.detalhe}).`,
    ordem,
  };
}
