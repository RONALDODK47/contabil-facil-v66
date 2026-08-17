import type { VisionBalanceteRow, VisionPlanoRow } from '../types/accounting';
import { getClassificacao } from './demonstracoesContabeis';
import {
  analisarSaldoContabil,
  enrichNaturezaSaldoImportado,
  getNaturezaEsperada,
  isContaCustoDespesa,
  isContaPassivoPorNome,
} from './naturezaContabil';
import {
  type LinhaComparativoMensal,
  type PeriodoMensal,
  type ResultadoAnaliseSaldoEsperado,
  analisarSaldoEsperadoConta,
  parseSaldoEsperadoInput,
} from './balanceteComparativoMensal';
import {
  type AutomacaoContaConfig,
  type AutomacaoContaPapel,
  resolverContaAutomacao,
  resolverDataAutomacao,
} from './automatizacaoContaConfig';
import {
  compareDataRazao,
  filtrarRazaoPorPeriodo,
  montarBalanceteComPeriodo,
  sortRowsByDataRazao,
} from './razaoContabil';
import { criarParAjusteNatureza, normalizarClassificacao } from './balanceteLancamentos';

export type ResultadoAutoCorrecao = ResultadoAnaliseSaldoEsperado & {
  acao?:
    | 'nenhuma'
    | 'provisao_dupla'
    | 'pagamento_caixa'
    | 'recebimento_e_pagamento'
    | 'ajuste_conta';
  lancamentosGerados?: VisionBalanceteRow[];
  aplicado?: boolean;
};

const normCls = normalizarClassificacao;

function chaveConta(r: Pick<VisionBalanceteRow, 'codigo' | 'classificacao' | 'nome'>): string {
  const cls = getClassificacao(r as VisionBalanceteRow).replace(/\./g, '').trim();
  if (cls) return `cls:${cls}`;
  const cod = (r.codigo ?? '').replace(/\D/g, '');
  return cod ? `cod:${cod}` : `nome:${(r.nome ?? '').toLowerCase()}`;
}

function saldoAssinado(row: VisionBalanceteRow, allRows: VisionBalanceteRow[]): number {
  const s = analisarSaldoContabil(row, allRows);
  return s.natureza === 'D' ? s.valor : -s.valor;
}

function isContaProvisao(row: Pick<VisionBalanceteRow, 'nome'>): boolean {
  return /provis(?:ã|a)o|prov\./i.test(row.nome ?? '');
}

function isContaCaixa(row: VisionBalanceteRow): boolean {
  const cls = normCls(getClassificacao(row));
  const n = (row.nome ?? '').toLowerCase();
  if (/banco|sicredi|cresol|sicoob|itau|bradesco|santander/i.test(n) && !/caixa geral|fundo fixo/i.test(n)) {
    return false;
  }
  return /^11101/.test(cls) || /caixa geral|fundo fixo de caixa|fundo fixo/i.test(n);
}

function isContaClienteReceber(row: VisionBalanceteRow): boolean {
  const n = (row.nome ?? '').toLowerCase();
  const cls = getClassificacao(row);
  return (
    /^1\.1\.3/.test(cls) ||
    /cliente.*receber|contas?\s+a\s+receber|duplicatas?\s+a\s+receber|cr[eé]ditos?\s+a\s+receber/i.test(n)
  );
}

function isContaMutuoEmprestimo(row: VisionBalanceteRow): boolean {
  const n = (row.nome ?? '').toLowerCase();
  const cls = normCls(getClassificacao(row));
  if (/cliente|a\s+receber|duplicata/i.test(n)) return false;
  return (
    /^2/.test(cls) ||
    /m[uú]tuo|mutuo|emprestimo|empr[eé]stimo|financiamento|capta[cç][aã]o/i.test(n)
  );
}

function isContaDespesaProvisao(row: VisionBalanceteRow): boolean {
  const cls = getClassificacao(row);
  if (!/^4/.test(cls.replace(/\./g, ''))) return false;
  const n = (row.nome ?? '').toLowerCase();
  return /provis|f[eé]rias|13|d[eé]cimo|sal[aá]rio|folha/i.test(n);
}

const CUSTO_PAPEIS_FALLBACK: AutomacaoContaPapel[] = ['custo_cmv', 'custo_cpv', 'custo_servicos', 'custos'];

/** Primeiro papel de custo (CMV/CPV/Serviços — ou o legado `custos`) configurado com conta D. */
function escolherContaCustoConfigurada(
  contaConfig: AutomacaoContaConfig | undefined,
  planoRows: VisionPlanoRow[],
  balancete: VisionBalanceteRow[],
): VisionBalanceteRow | null {
  if (!contaConfig) return null;
  for (const papel of CUSTO_PAPEIS_FALLBACK) {
    const conta = resolverContaAutomacao(papel, contaConfig, planoRows, balancete, 'debito');
    if (conta) return conta;
  }
  return null;
}

function escolherCustoOuDespesa(
  balanceteMes: VisionBalanceteRow[],
  planoRows: VisionPlanoRow[],
  contaConfig?: AutomacaoContaConfig,
): VisionBalanceteRow | null {
  return (
    escolherContaCustoConfigurada(contaConfig, planoRows, balanceteMes) ??
    escolherConta(balanceteMes, planoRows, isContaCustoDespesa, /\bcusto\b|\bcmv\b|\bcpv\b/i) ??
    escolherConta(balanceteMes, planoRows, isContaDespesaProvisao, undefined, contaConfig, 'despesa_ajuste', 'debito') ??
    escolherConta(balanceteMes, planoRows, (r) => /^4/.test(normCls(getClassificacao(r))))
  );
}

/**
 * Gera par de lançamentos (conta alvo + contrapartida) para mover saldo
 * assinado em `diferencaAssinada`. `importId` determinístico: reaplicar a
 * MESMA correção (mesma conta, histórico e data) substitui o par anterior em
 * vez de empilhar duplicado no razão — o empilhamento inflava saldo
 * (inclusive o saldo anterior de períodos seguintes).
 */
function parAjuste(
  conta: VisionBalanceteRow,
  contrapartida: VisionBalanceteRow,
  diferencaAssinada: number,
  data: string,
  historico: string,
  ordemBase: number,
): VisionBalanceteRow[] {
  const importId = `auto-ajuste|${historico}|${chaveConta(conta)}|${chaveConta(contrapartida)}|${data}`;
  return criarParAjusteNatureza({
    conta,
    contrapartida,
    diferencaAssinada,
    naturezaEsperadaConta: getNaturezaEsperada(conta, []),
    data,
    historico,
    ordem: ordemBase,
    importId,
  });
}

function escolherConta(
  balancete: VisionBalanceteRow[],
  plano: VisionPlanoRow[],
  pred: (r: VisionBalanceteRow) => boolean,
  preferNome?: RegExp,
  contaConfig?: AutomacaoContaConfig,
  papelConfig?: AutomacaoContaPapel,
  ladoConfig?: 'debito' | 'credito',
): VisionBalanceteRow | null {
  if (papelConfig && contaConfig) {
    const cfg = resolverContaAutomacao(papelConfig, contaConfig, plano, balancete, ladoConfig);
    if (cfg) return cfg;
  }
  const analiticas = balancete.filter((r) => r.tipo !== 'S' && pred(r));
  if (preferNome) {
    const pref = analiticas.find((r) => preferNome.test(r.nome ?? ''));
    if (pref) return pref;
  }
  if (analiticas.length) return analiticas[0];

  const doPlano = plano.filter((p) => p.tipo === 'A' && pred({
    codigo: p.codigoReduzido ?? p.codigo,
    classificacao: p.codigo,
    nome: p.nome,
    saldoInicial: 0,
    debito: 0,
    credito: 0,
    saldoFinal: 0,
    tipo: 'A',
  }));
  if (!doPlano.length) return null;
  const p = preferNome ? doPlano.find((x) => preferNome.test(x.nome)) ?? doPlano[0] : doPlano[0];
  return {
    codigo: p.codigoReduzido ?? p.codigo,
    classificacao: p.codigo,
    nome: p.nome,
    saldoInicial: 0,
    debito: 0,
    credito: 0,
    saldoFinal: 0,
    tipo: 'A',
  };
}

function contasProvisaoVinculadas(
  row: VisionBalanceteRow,
  balancete: VisionBalanceteRow[],
): VisionBalanceteRow[] {
  const cls = normCls(getClassificacao(row));
  const out: VisionBalanceteRow[] = [];
  for (const r of balancete) {
    if (r.tipo === 'S') continue;
    const c = normCls(getClassificacao(r));
    const mesmoGrupo = cls && c && (c.startsWith(cls.slice(0, 4)) || cls.startsWith(c.slice(0, 4)));
    const provOuPassivo =
      isContaProvisao(r) || (isContaPassivoPorNome(r) && !isContaProvisao(r));
    if ((mesmoGrupo || r.nome === row.nome) && provOuPassivo && chaveConta(r) !== chaveConta(row)) {
      out.push(r);
    }
  }
  return out;
}

function gerarCorrecaoProvisao(params: {
  row: VisionBalanceteRow;
  diferenca: number;
  balanceteMes: VisionBalanceteRow[];
  planoRows: VisionPlanoRow[];
  periodo: PeriodoMensal;
  mesRef: string;
  contaConfig?: AutomacaoContaConfig;
}): VisionBalanceteRow[] {
  const data = resolverDataAutomacao(params.periodo, params.contaConfig);
  const histBase = `[Auto] Ajuste provisão ${params.mesRef}`;
  const despesa = escolherCustoOuDespesa(params.balanceteMes, params.planoRows, params.contaConfig);

  if (!despesa) return [];

  const lancamentos: VisionBalanceteRow[] = [];
  let ordem = 900_000;

  const vinculadas = contasProvisaoVinculadas(params.row, params.balanceteMes);
  const alvos = [params.row, ...vinculadas.filter((v) => chaveConta(v) !== chaveConta(params.row))];

  const somaProv = alvos
    .filter((a) => isContaProvisao(a))
    .reduce((s, r) => s + saldoAssinado(r, params.balanceteMes), 0);
  const passivos = alvos.filter((a) => isContaPassivoPorNome(a) && !isContaProvisao(a));
  const somaPass = passivos.reduce((s, r) => s + saldoAssinado(r, params.balanceteMes), 0);
  const gapProvPassivo = somaProv + somaPass;

  lancamentos.push(
    ...parAjuste(params.row, despesa, params.diferenca, data, `${histBase} — conta alvo`, ordem),
  );
  ordem += 10;

  for (const v of vinculadas) {
    if (isContaProvisao(v) && chaveConta(v) !== chaveConta(params.row)) {
      const parte =
        Math.abs(gapProvPassivo) > 0.05
          ? params.diferenca * (saldoAssinado(v, params.balanceteMes) / (somaProv || 1))
          : params.diferenca;
      lancamentos.push(...parAjuste(v, despesa, parte, data, `${histBase} — provisão vinculada`, ordem));
      ordem += 10;
    }
  }

  for (const p of passivos) {
    if (Math.abs(gapProvPassivo) > 0.05) {
      const ajustePassivo = -gapProvPassivo / Math.max(passivos.length, 1);
      lancamentos.push(
        ...parAjuste(p, despesa, ajustePassivo, data, `${histBase} — obrigação vinculada`, ordem),
      );
      ordem += 10;
    }
  }

  return lancamentos;
}

/** Saldo devedor disponível em clientes a receber (quem nos deve). */
export function saldoClienteAReceberDisponivel(
  cliente: VisionBalanceteRow,
  balanceteMes: VisionBalanceteRow[],
): number {
  const s = saldoAssinado(cliente, balanceteMes);
  return s > 0.05 ? s : 0;
}

/** Saldo assinado após aplicar lançamentos extras na mesma conta. */
export function saldoAssinadoAposLancamentos(
  conta: VisionBalanceteRow,
  balanceteMes: VisionBalanceteRow[],
  lancamentosExtras: VisionBalanceteRow[],
): number {
  const base = saldoAssinado(conta, balanceteMes);
  const k = chaveConta(conta);
  let delta = 0;
  for (const l of lancamentosExtras) {
    if (chaveConta(l) !== k) continue;
    const natEsp = getNaturezaEsperada(conta, balanceteMes);
    if (natEsp === 'D') delta += l.debito - l.credito;
    else delta += l.credito - l.debito;
  }
  return base + delta;
}

/** Caixa com saldo credor (ativo negativo / “a crédito”). */
export function caixaComSaldoCredor(
  caixa: VisionBalanceteRow,
  balanceteMes: VisionBalanceteRow[],
  lancamentosExtras: VisionBalanceteRow[] = [],
): boolean {
  return saldoAssinadoAposLancamentos(caixa, balanceteMes, lancamentosExtras) < -0.05;
}

/**
 * Reforço de caixa em cascata:
 * 1) recebe de clientes a receber (se houver saldo);
 * 2) só se o caixa continuar credor (ou faltar valor), capta via mútuo/empréstimo.
 */
export function gerarReforcoCaixa(params: {
  caixa: VisionBalanceteRow;
  valor: number;
  balanceteMes: VisionBalanceteRow[];
  planoRows: VisionPlanoRow[];
  periodo: PeriodoMensal;
  mesRef: string;
  contaConfig?: AutomacaoContaConfig;
}): { lancamentos: VisionBalanceteRow[]; msg: string } {
  const data = resolverDataAutomacao(params.periodo, params.contaConfig);
  const valorNecessario = Math.abs(params.valor);
  if (valorNecessario < 0.05) return { lancamentos: [], msg: 'Valor de reforço inválido.' };

  const cfg = params.contaConfig;
  const cliente = escolherConta(
    params.balanceteMes,
    params.planoRows,
    isContaClienteReceber,
    undefined,
    cfg,
    'cliente',
    'credito',
  );
  const mutuo = escolherConta(
    params.balanceteMes,
    params.planoRows,
    isContaMutuoEmprestimo,
    undefined,
    cfg,
    'mutuo',
    'credito',
  );
  const histCli = `[Auto] Recebimento cliente → caixa ${params.mesRef}`;
  const histMut = `[Auto] Mútuo/Empréstimo → caixa ${params.mesRef}`;

  const lancamentos: VisionBalanceteRow[] = [];
  const msgs: string[] = [];
  let restante = valorNecessario;
  let ordem = 915_000;

  if (cliente) {
    const disponivelCliente = saldoClienteAReceberDisponivel(cliente, params.balanceteMes);
    if (disponivelCliente > 0.05) {
      const receber = Math.min(restante, disponivelCliente);
      const lancCli = parAjuste(params.caixa, cliente, receber, data, histCli, ordem);
      if (lancCli.length) {
        lancamentos.push(...lancCli);
        ordem += 10;
        restante -= receber;
        msgs.push(
          `Recebimento de ${cliente.nome} (R$ ${receber.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}).`,
        );
      }
    } else {
      msgs.push(`Sem saldo em ${cliente.nome} para receber neste período.`);
    }
  }

  const lancamentosCliente = [...lancamentos];
  const caixaAindaCredor = caixaComSaldoCredor(params.caixa, params.balanceteMes, lancamentosCliente);
  const deficitCaixa = caixaAindaCredor
    ? Math.abs(saldoAssinadoAposLancamentos(params.caixa, params.balanceteMes, lancamentosCliente))
    : 0;
  const valorMutuo = Math.max(restante, deficitCaixa);

  if (valorMutuo > 0.05) {
    if (!mutuo) {
      if (!lancamentos.length) {
        return {
          lancamentos: [],
          msg: cliente
            ? 'Clientes sem saldo a receber e sem conta de mútuo/empréstimo configurada.'
            : 'Sem conta de clientes a receber nem mútuo/empréstimo no plano para reforçar o caixa.',
        };
      }
      return {
        lancamentos,
        msg: `${msgs.join(' ')} Caixa ainda credor; configure mútuo/empréstimo na automação.`,
      };
    }
    const lancMut = parAjuste(params.caixa, mutuo, valorMutuo, data, histMut, ordem);
    if (lancMut.length) {
      lancamentos.push(...lancMut);
      msgs.push(
        caixaAindaCredor
          ? `Caixa ainda credor após cliente → captação via ${mutuo.nome} (R$ ${valorMutuo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}).`
          : `Reforço complementar via ${mutuo.nome} (mútuo/empréstimo).`,
      );
    }
  }

  if (!lancamentos.length) {
    return {
      lancamentos: [],
      msg: 'Nenhum reforço aplicado: sem saldo em clientes e sem mútuo disponível.',
    };
  }

  return {
    lancamentos,
    msg: `Reforço do caixa (${params.caixa.nome}): ${msgs.join(' ')}`,
  };
}

export function gerarPagamentoCaixa(params: {
  row: VisionBalanceteRow;
  diferenca: number;
  balanceteMes: VisionBalanceteRow[];
  planoRows: VisionPlanoRow[];
  periodo: PeriodoMensal;
  mesRef: string;
  contaConfig?: AutomacaoContaConfig;
}): { lancamentos: VisionBalanceteRow[]; acao: ResultadoAutoCorrecao['acao']; msg: string } {
  const data = resolverDataAutomacao(params.periodo, params.contaConfig);
  const valor = Math.abs(params.diferenca);
  const cfg = params.contaConfig;
  const caixa = escolherConta(
    params.balanceteMes,
    params.planoRows,
    isContaCaixa,
    /caixa geral|caixa/i,
    cfg,
    'caixa',
    'debito',
  );
  const cliente = escolherConta(
    params.balanceteMes,
    params.planoRows,
    isContaClienteReceber,
    undefined,
    cfg,
    'cliente',
    'credito',
  );

  if (!caixa) {
    return {
      lancamentos: [],
      acao: 'nenhuma',
      msg: 'Não há conta de caixa/banco identificada no plano ou balancete.',
    };
  }

  const saldoCaixa = saldoAssinado(caixa, params.balanceteMes);
  const caixaDisponivel = saldoCaixa > 0 ? saldoCaixa : 0;

  const histPag = `[Auto] Pagamento ${params.mesRef} — ${params.row.nome}`;
  const histRec = `[Auto] Recebimento cliente → caixa ${params.mesRef}`;

  const precisaDebitoPassivo = params.diferenca > 0;
  const movimentoPagamento = precisaDebitoPassivo ? params.diferenca : params.diferenca;

  if (caixaDisponivel >= valor - 0.05) {
    const lanc = parAjuste(params.row, caixa, movimentoPagamento, data, histPag, 910_000);
    return {
      lancamentos: lanc,
      acao: 'pagamento_caixa',
      msg: `Pagamento registrado do caixa (${caixa.nome}) para ajustar saldo.`,
    };
  }

  const mutuo = escolherConta(
    params.balanceteMes,
    params.planoRows,
    isContaMutuoEmprestimo,
    undefined,
    cfg,
    'mutuo',
  );
  const falta = valor - caixaDisponivel;
  const lancamentos: VisionBalanceteRow[] = [];

  if (cliente) {
    const saldoCliente = saldoAssinado(cliente, params.balanceteMes);
    const clienteDisponivel = saldoCliente > 0 ? saldoCliente : 0;
    if (clienteDisponivel + caixaDisponivel >= valor - 0.05) {
      if (falta > 0.05) {
        lancamentos.push(...parAjuste(caixa, cliente, falta, data, histRec, 920_000));
      }
      lancamentos.push(...parAjuste(params.row, caixa, movimentoPagamento, data, histPag, 930_000));
      return {
        lancamentos,
        acao: 'recebimento_e_pagamento',
        msg: `Recebimento em ${cliente.nome} e pagamento via ${caixa.nome} registrados automaticamente.`,
      };
    }
  }

  if (mutuo && falta > 0.05) {
    const histMutuo = `[Auto] Mútuo/Empréstimo → caixa ${params.mesRef}`;
    lancamentos.push(...parAjuste(caixa, mutuo, falta, data, histMutuo, 925_000));
    lancamentos.push(...parAjuste(params.row, caixa, movimentoPagamento, data, histPag, 930_000));
    return {
      lancamentos,
      acao: 'recebimento_e_pagamento',
      msg: `Entrada via ${mutuo.nome} (mútuo/empréstimo) e pagamento pelo ${caixa.nome}.`,
    };
  }

  if (!cliente && !mutuo) {
    return {
      lancamentos: [],
      acao: 'nenhuma',
      msg: `Caixa insuficiente e sem conta de clientes a receber nem mútuo/empréstimo no plano.`,
    };
  }

  return {
    lancamentos: [],
    acao: 'nenhuma',
    msg: `Caixa insuficiente para R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (disp. ${caixaDisponivel.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}).`,
  };
}

export function corrigirSaldoEsperadoAutomatico(params: {
  row: LinhaComparativoMensal;
  saldoEsperadoRaw: string;
  mesRef: string;
  periodo: PeriodoMensal;
  razaoRows: VisionBalanceteRow[];
  planoRows: VisionPlanoRow[];
}): ResultadoAutoCorrecao {
  const analise = analisarSaldoEsperadoConta(params);
  if (analise.ok) {
    return { ...analise, acao: 'nenhuma', lancamentosGerados: [], aplicado: false };
  }

  const esperado = parseSaldoEsperadoInput(params.saldoEsperadoRaw);
  const celula = params.row.saldosPorMes[params.mesRef];
  if (!esperado || !celula) return { ...analise, acao: 'nenhuma', aplicado: false };

  const esperadoAssinado = esperado.natureza === 'D' ? esperado.valor : -esperado.valor;
  const atualAssinado = celula.natureza === 'D' ? celula.valor : -celula.valor;
  const diferenca = esperadoAssinado - atualAssinado;

  const razaoPeriodo = filtrarRazaoPorPeriodo(params.razaoRows, params.periodo.de, params.periodo.ate);
  const balanceteMesRaw = montarBalanceteComPeriodo(
    params.razaoRows,
    razaoPeriodo,
    params.planoRows,
    params.periodo.de,
    params.periodo.ate,
  );
  const balanceteMes = balanceteMesRaw.map((r) => enrichNaturezaSaldoImportado(r, balanceteMesRaw));

  const rowBal =
    balanceteMes.find((r) => chaveConta(r) === params.row.chave) ??
    ({
      codigo: params.row.codigo,
      classificacao: params.row.classificacao,
      nome: params.row.nome,
      saldoInicial: 0,
      debito: 0,
      credito: 0,
      saldoFinal: 0,
      tipo: 'A' as const,
    } satisfies VisionBalanceteRow);

  const ehProvisao =
    isContaProvisao(rowBal) ||
    isContaPassivoPorNome(rowBal) ||
    contasProvisaoVinculadas(rowBal, balanceteMes).some(isContaProvisao);

  let lancamentos: VisionBalanceteRow[] = [];
  let acao: ResultadoAutoCorrecao['acao'] = 'nenhuma';
  let mensagem = analise.mensagem;
  const detalhes = [...(analise.detalhes ?? [])];

  if (analise.etapa === 'razao' && analise.lancamentosSugeridos?.length) {
    return {
      ...analise,
      acao: 'nenhuma',
      aplicado: false,
      mensagem:
        analise.mensagem +
        ' Revise os lançamentos sugeridos; correção automática não aplicada para evitar duplicidade.',
    };
  }

  if (ehProvisao && (analise.etapa === 'provisao' || isContaProvisao(rowBal))) {
    lancamentos = gerarCorrecaoProvisao({
      row: rowBal,
      diferenca,
      balanceteMes,
      planoRows: params.planoRows,
      periodo: params.periodo,
      mesRef: params.mesRef,
    });
    acao = 'provisao_dupla';
    mensagem = `Provisão ajustada automaticamente (conta alvo e vinculadas) em ${params.mesRef}.`;
    detalhes.push(`${lancamentos.length} lançamento(s) gerado(s) no razão.`);
  } else if (analise.etapa === 'nao_encontrado' || analise.etapa === 'provisao') {
    const pag = gerarPagamentoCaixa({
      row: rowBal,
      diferenca,
      balanceteMes,
      planoRows: params.planoRows,
      periodo: params.periodo,
      mesRef: params.mesRef,
    });
    lancamentos = pag.lancamentos;
    acao = pag.acao;
    mensagem = pag.msg;
    if (lancamentos.length) {
      detalhes.push(`${lancamentos.length} lançamento(s): ${pag.msg}`);
    } else {
      detalhes.push(pag.msg);
    }
  } else {
    const despesa = escolherCustoOuDespesa(balanceteMes, params.planoRows);
    if (despesa) {
      lancamentos = parAjuste(
        rowBal,
        despesa,
        diferenca,
        resolverDataAutomacao(params.periodo),
        `[Auto] Ajuste saldo ${params.mesRef}`,
        905_000,
      );
      acao = 'ajuste_conta';
      mensagem = `Ajuste contábil automático aplicado em ${params.mesRef}.`;
    }
  }

  if (!lancamentos.length) {
    return { ...analise, acao: 'nenhuma', aplicado: false, detalhes };
  }

  return {
    ok: true,
    mensagem,
    etapa: 'conferido',
    diferenca,
    diferencaFmt: Math.abs(diferenca).toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
    detalhes: [
      ...detalhes,
      ...lancamentos.map(
        (l) =>
          `${l.data} · ${l.classificacao || l.codigo} · D ${l.debito.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} · C ${l.credito.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} · ${l.nome}`,
      ),
    ],
    acao,
    lancamentosGerados: lancamentos,
    aplicado: false,
  };
}

export function aplicarLancamentosNoRazao(
  razaoRows: VisionBalanceteRow[],
  novos: VisionBalanceteRow[],
): VisionBalanceteRow[] {
  if (!novos.length) return razaoRows;
  const taggedNovos = novos.map((row) => ({ ...row, isReconciliation: true }));
  // Upsert por importId: se os novos lançamentos já têm um importId (ex.: custo
  // automático, zeramento), remove qualquer lançamento anterior com o MESMO importId
  // antes de acrescentar — senão rodar a automação de novo só empilha duplicado em
  // cima do que já foi gravado, em vez de substituir pelo valor recalculado.
  const importIdsNovos = new Set(
    taggedNovos.map((r) => r.importId).filter((id): id is string => Boolean(id)),
  );
  const base =
    importIdsNovos.size > 0
      ? razaoRows.filter((r) => !(r.importId && importIdsNovos.has(r.importId)))
      : razaoRows;
  return sortRowsByDataRazao([...base, ...taggedNovos]);
}
