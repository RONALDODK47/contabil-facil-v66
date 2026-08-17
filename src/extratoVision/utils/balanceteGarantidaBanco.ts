import type { VisionBalanceteRow, VisionPlanoRow } from '../types/accounting';
import { getClassificacao } from './demonstracoesContabeis';
import {
  type LinhaComparativoMensal,
  type PeriodoMensal,
  type SaldoMensalCelula,
  celulaSaldoContaNoMes,
  chaveContaComparativo,
} from './balanceteComparativoMensal';
import { isNomeInstituicaoBancaria } from './naturezaContabil';
import {
  type AutomacaoContaConfig,
  resolverContaAutomacao,
  resolverDataAutomacao,
} from './automatizacaoContaConfig';
import { montarBalanceteComPeriodo, filtrarRazaoPorPeriodo, isHistoricoSaldoInicialRazao } from './razaoContabil';
import { criarParLancamento, normalizarClassificacao, planoRowToBalanceteRow } from './balanceteLancamentos';

export type ProgressoCicloGarantida = {
  bancoAtual: number;
  bancosTotal: number;
  mesAtual: number;
  mesesTotal: number;
  mensagem: string;
};

export type OnProgressoCicloGarantida = (p: ProgressoCicloGarantida) => void;

export type ResultadoCicloGarantidaBanco = {
  ok: boolean;
  mensagem: string;
  lancamentosGerados: VisionBalanceteRow[];
  mesParada?: string;
  contasProcessadas: string[];
  detalhes: string[];
};

const normCls = normalizarClassificacao;

/** Caixa / fundo fixo — não entram no ciclo banco ↔ garantida. */
export function isContaCaixaOuFundoLinha(
  linha: Pick<LinhaComparativoMensal, 'classificacao' | 'nome' | 'tipo'>,
): boolean {
  if (linha.tipo === 'S') return false;
  const cls = normCls(linha.classificacao ?? '');
  const n = (linha.nome ?? '').toLowerCase();
  return (
    /^11101/.test(cls) ||
    /caixa geral|fundo fixo de caixa|fundo fixo/i.test(n) ||
    (/^caixa\b/i.test(n) && !/banco/i.test(n))
  );
}

/** Contas bancárias (11102…), excluindo caixa e garantida. */
export function isContaBancoLinha(linha: Pick<LinhaComparativoMensal, 'classificacao' | 'nome' | 'tipo'>): boolean {
  if (linha.tipo === 'S') return false;
  if (isContaCaixaOuFundoLinha(linha)) return false;
  const cls = normCls(linha.classificacao ?? '');
  const n = (linha.nome ?? '').toLowerCase();
  if (/garantia|garantida|cau[cç][aã]o/i.test(n)) return false;
  if (/^11102/.test(cls) || /^1102/.test(cls)) return true;
  return isNomeInstituicaoBancaria(linha.nome ?? '');
}

function isContaGarantidaRow(r: Pick<VisionBalanceteRow, 'nome' | 'classificacao'>): boolean {
  const n = (r.nome ?? '').toLowerCase();
  const cls = normCls(getClassificacao(r as VisionBalanceteRow));
  return /garantia|garantida|cau[cç][aã]o/i.test(n) || /garantia/i.test(cls);
}

function isContaBancoRow(r: Pick<VisionBalanceteRow, 'nome' | 'classificacao' | 'tipo'>): boolean {
  if (r.tipo === 'S') return false;
  const fake: LinhaComparativoMensal = {
    chave: chaveContaComparativo(r as VisionBalanceteRow),
    codigo: (r as VisionBalanceteRow).codigo ?? '',
    classificacao: getClassificacao(r as VisionBalanceteRow),
    nome: (r as VisionBalanceteRow).nome ?? '',
    tipo: r.tipo,
    saldosPorMes: {},
    detalhePorMes: {},
  };
  return isContaBancoLinha(fake);
}

/** Uma linha por conta (evita duplicar o mesmo banco). */
export function deduplicarLinhasBanco(linhas: LinhaComparativoMensal[]): LinhaComparativoMensal[] {
  const visto = new Set<string>();
  const out: LinhaComparativoMensal[] = [];
  for (const linha of linhas) {
    if (!isContaBancoLinha(linha)) continue;
    if (visto.has(linha.chave)) continue;
    visto.add(linha.chave);
    out.push(linha);
  }
  return out;
}

function planoParaRowAnalitica(p: VisionPlanoRow): VisionBalanceteRow {
  return { ...planoRowToBalanceteRow(p), tipo: 'A' };
}

function resolverContasGarantidaConfig(
  planoRows: VisionPlanoRow[],
  balancete: VisionBalanceteRow[],
  contaConfig?: AutomacaoContaConfig,
): { utilizacao: VisionBalanceteRow | null; devolucao: VisionBalanceteRow | null } {
  const cfg = contaConfig ?? {};
  const cred = resolverContaAutomacao('garantida', cfg, planoRows, balancete, 'credito');
  const deb = resolverContaAutomacao('garantida', cfg, planoRows, balancete, 'debito');
  return {
    utilizacao: cred ?? deb,
    devolucao: deb ?? cred,
  };
}

function escolherContaGarantida(
  balancete: VisionBalanceteRow[],
  planoRows: VisionPlanoRow[],
  contaConfig?: AutomacaoContaConfig,
): { utilizacao: VisionBalanceteRow | null; devolucao: VisionBalanceteRow | null } {
  const cfgPar = resolverContasGarantidaConfig(planoRows, balancete, contaConfig);
  if (cfgPar.utilizacao || cfgPar.devolucao) return cfgPar;

  const doBal = balancete.find((r) => r.tipo !== 'S' && isContaGarantidaRow(r));
  if (doBal) return { utilizacao: doBal, devolucao: doBal };

  const analiticasPlano = planoRows.filter((x) => x.tipo === 'A');
  const porNome = analiticasPlano.find((x) => /garantia|garantida|cau[cç][aã]o|aval|warrant/i.test(x.nome));
  if (porNome) {
    const row = planoParaRowAnalitica(porNome);
    return { utilizacao: row, devolucao: row };
  }

  const passivo2 = analiticasPlano.find((x) => {
    const c = normCls(x.codigo);
    return /^2/.test(c) && /garant|obrig|passiv/i.test(x.nome);
  });
  if (passivo2) {
    const row = planoParaRowAnalitica(passivo2);
    return { utilizacao: row, devolucao: row };
  }

  const sintGarantia = planoRows.find((x) => /garantia|garantida|cau[cç][aã]o/i.test(x.nome));
  if (sintGarantia) {
    const filha = analiticasPlano.find((x) => normCls(x.codigo).startsWith(normCls(sintGarantia.codigo)));
    if (filha) {
      const row = planoParaRowAnalitica(filha);
      return { utilizacao: row, devolucao: row };
    }
  }

  return { utilizacao: null, devolucao: null };
}

function linhaParaRowConta(linha: LinhaComparativoMensal, planoRows: VisionPlanoRow[]): VisionBalanceteRow {
  const cls = normCls(linha.classificacao || '');
  const p = planoRows.find((x) => x.tipo === 'A' && normCls(x.codigo) === cls);
  if (p) {
    return {
      codigo: p.codigoReduzido ?? p.codigo,
      classificacao: p.codigo,
      nome: p.nome,
      tipo: 'A',
      saldoInicial: 0,
      debito: 0,
      credito: 0,
      saldoFinal: 0,
    };
  }
  return {
    codigo: linha.codigo,
    classificacao: linha.classificacao,
    nome: linha.nome,
    tipo: linha.tipo ?? 'A',
    saldoInicial: 0,
    debito: 0,
    credito: 0,
    saldoFinal: 0,
  };
}

function encontrarBancoNoBalancete(
  linha: LinhaComparativoMensal,
  balanceteMes: VisionBalanceteRow[],
  planoRows: VisionPlanoRow[],
): VisionBalanceteRow | null {
  const porChave = balanceteMes.find(
    (r) => r.tipo !== 'S' && chaveContaComparativo(r) === linha.chave,
  );
  if (porChave) return porChave;

  const cls = normCls(linha.classificacao || '');
  if (cls) {
    const porCls = balanceteMes.find(
      (r) => r.tipo !== 'S' && normCls(getClassificacao(r)) === cls,
    );
    if (porCls) return porCls;
  }

  const nome = (linha.nome ?? '').trim().toLowerCase();
  if (nome) {
    const porNome = balanceteMes.find(
      (r) => r.tipo !== 'S' && (r.nome ?? '').trim().toLowerCase() === nome,
    );
    if (porNome) return porNome;
  }

  return linhaParaRowConta(linha, planoRows);
}

/** Utilização: D Banco / C Conta garantida. */
export function lancamentosUtilizacaoGarantida(
  banco: VisionBalanceteRow,
  garantida: VisionBalanceteRow,
  valor: number,
  data: string,
  mesRef: string,
  ordemBase: number,
): VisionBalanceteRow[] {
  const hist = `[Auto] Utilização garantia ${mesRef} — ${banco.nome}`;
  const importId = `garantida-banco:utilizacao|${(banco.codigo ?? '').trim()}|${(garantida.codigo ?? '').trim()}|${mesRef}`;
  return criarParLancamento({ contaDeb: banco, contaCred: garantida, valor, data, historico: hist, ordem: ordemBase, importId });
}

/** Devolução: D Conta garantida / C Banco. */
export function lancamentosDevolucaoGarantida(
  banco: VisionBalanceteRow,
  garantida: VisionBalanceteRow,
  valor: number,
  data: string,
  mesRef: string,
  ordemBase: number,
): VisionBalanceteRow[] {
  const hist = `[Auto] Devolução garantia ${mesRef} — ${banco.nome}`;
  const importId = `garantida-banco:devolucao|${(banco.codigo ?? '').trim()}|${(garantida.codigo ?? '').trim()}|${mesRef}`;
  return criarParLancamento({ contaDeb: garantida, contaCred: banco, valor, data, historico: hist, ordem: ordemBase, importId });
}

/**
 * A linha é um lançamento GERADO por esta automação (utilização/devolução)?
 *
 * Reconhece pelo `importId` e também pelo histórico, porque o importId não
 * sobrevive a um ciclo de exportação/reimportação do razão (TXT Domínio, OCR).
 * Sem o reconhecimento pelo histórico, as correções da rodada anterior voltavam
 * a ser lidas como movimento real do banco: o saldo do dia passava a incluir a
 * devolução do dia anterior e a automação reclassificava esse valor inflado
 * (ex.: 997,19 quando o banco só estava credor em 1,00), empilhando saldo a cada
 * rodada em vez de reclassificar o saldo real que ficou no dia.
 */
export function isLancamentoCompensacaoGarantida(
  row: Pick<VisionBalanceteRow, 'importId' | 'nome'>,
): boolean {
  if ((row.importId ?? '').startsWith('garantida-banco:')) return true;
  return /^\s*\[auto\]\s*(utiliza|devolu)[çc][ãa]o\s+garantia\b/i.test(row.nome ?? '');
}

export function bancoSaldoCredor(cel: SaldoMensalCelula | null | undefined): boolean {
  return !!(cel && cel.valor >= 0.01 && cel.natureza === 'C');
}

/**
 * Mesmo ciclo banco ↔ garantida de `executarCicloGarantidaBanco`, mas para UMA conta
 * já escolhida manualmente pelo usuário (banco e garantida), sem passar pelo filtro
 * automático `isContaBancoLinha`/`escolherContaGarantida` — usado pelo card manual
 * "Compensação Banco Credor" (Automações), onde o próprio usuário seleciona as duas
 * contas em vez de depender da detecção automática.
 */
export function executarCicloGarantidaContaUnica(params: {
  bancoRow: VisionBalanceteRow;
  garantidaRow: VisionBalanceteRow;
  periodos: PeriodoMensal[];
  razaoRows: VisionBalanceteRow[];
  planoRows: VisionPlanoRow[];
}): ResultadoCicloGarantidaBanco {
  const { bancoRow, garantidaRow, periodos, razaoRows, planoRows } = params;

  if (!periodos.length) {
    return {
      ok: false,
      mensagem: 'Nenhum mês encontrado no razão para esta conta.',
      lancamentosGerados: [],
      contasProcessadas: [],
      detalhes: [],
    };
  }

  const linhaBanco: LinhaComparativoMensal = {
    chave: chaveContaComparativo(bancoRow),
    codigo: bancoRow.codigo ?? '',
    classificacao: getClassificacao(bancoRow),
    nome: bancoRow.nome ?? '',
    tipo: bancoRow.tipo,
    saldosPorMes: {},
    detalhePorMes: {},
  };

  const detalhes: string[] = [];
  const todosLancamentos: VisionBalanceteRow[] = [];
  let pendenteDevolucao = 0;
  let ordem = 940_000;

  for (const periodo of periodos) {
    const cel = celulaSaldoContaNoMes(linhaBanco, periodo, razaoRows, planoRows);
    const precisaTrabalho = pendenteDevolucao >= 0.05 || bancoSaldoCredor(cel);
    if (!precisaTrabalho) continue;

    const data = resolverDataAutomacao(periodo, undefined);

    if (pendenteDevolucao >= 0.05) {
      const dev = lancamentosDevolucaoGarantida(bancoRow, garantidaRow, pendenteDevolucao, data, periodo.label, ordem);
      ordem += 10;
      todosLancamentos.push(...dev);
      detalhes.push(
        `${periodo.label}: devolução D garantida / C banco — ${pendenteDevolucao.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`,
      );
      pendenteDevolucao = 0;
    }

    if (!bancoSaldoCredor(cel)) continue;

    const valor = cel!.valor;
    const util = lancamentosUtilizacaoGarantida(bancoRow, garantidaRow, valor, data, periodo.label, ordem);
    ordem += 10;
    todosLancamentos.push(...util);
    pendenteDevolucao = valor;
    detalhes.push(
      `${periodo.label}: utilização D banco / C garantida — ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`,
    );
  }

  if (!todosLancamentos.length) {
    return {
      ok: false,
      mensagem: 'Nenhum lançamento gerado — a conta não fechou credora (C) em nenhum mês do período.',
      lancamentosGerados: [],
      contasProcessadas: [bancoRow.nome ?? ''],
      detalhes,
    };
  }

  return {
    ok: true,
    mensagem: `${todosLancamentos.length} lançamento(s) gerados para ${bancoRow.nome ?? 'a conta'}.`,
    lancamentosGerados: todosLancamentos,
    contasProcessadas: [bancoRow.nome ?? ''],
    detalhes,
  };
}

/** DD/MM/AAAA → timestamp local (null se inválida). */
function diaToTime(data?: string): number | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(data ?? '').trim());
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
}

/** DD/MM/AAAA → dia seguinte, mesmo formato. */
function proximoDiaBr(data: string): string {
  const t = diaToTime(data);
  if (t === null) return data;
  const d = new Date(t);
  d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** O lançamento do razão pertence a esta conta? (classificação ou código reduzido) */
function linhaEhDaConta(row: VisionBalanceteRow, conta: VisionBalanceteRow): boolean {
  const clsConta = normCls(getClassificacao(conta));
  if (clsConta && normCls(getClassificacao(row)) === clsConta) return true;
  const codConta = (conta.codigo ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (!codConta) return false;
  return (row.codigo ?? '').replace(/\D/g, '').replace(/^0+/, '') === codConta;
}

/** Último dia do mês da data informada (DD/MM/AAAA). */
function fimDoMesBr(data: string): string {
  const t = diaToTime(data);
  if (t === null) return data;
  const d = new Date(t);
  const fim = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(fim.getDate())}/${pad(fim.getMonth() + 1)}/${fim.getFullYear()}`;
}

/**
 * Compensação banco credor DIA A DIA (a partir de `dataInicio`).
 *
 * O ciclo mensal (`executarCicloGarantidaContaUnica`) só enxerga o fechamento do
 * mês, então lançava tudo no último dia — o banco continuava credor nos dias do
 * meio do mês, que é justamente o que precisa ser coberto. Aqui o saldo é
 * acumulado lançamento a lançamento: todo dia que FECHA credor recebe, naquele
 * mesmo dia, a utilização (D banco / C garantida) no valor exato do saldo credor,
 * e a devolução (D garantida / C banco) no dia seguinte — sem alterar o movimento
 * real da conta, que segue acumulando intacto para o dia seguinte.
 *
 * A varredura percorre o CALENDÁRIO, não só os dias que têm lançamento: como a
 * devolução do dia seguinte desfaz a compensação, um dia sem movimento volta a
 * fechar credor e precisa ser compensado de novo. Percorrendo só os dias com
 * lançamento, a conta ficava credora em todo o intervalo entre um movimento e o
 * próximo (era o que acontecia depois da devolução de 13/06 quando o movimento
 * seguinte só vinha dias depois). Assim a compensação se repete dia após dia até
 * cair num dia que fecha devedor; se o mês inteiro fechar credor, o último dia é
 * compensado e a devolução cai naturalmente no primeiro dia do mês seguinte.
 */
export function executarCicloGarantidaDiario(params: {
  bancoRow: VisionBalanceteRow;
  garantidaRow: VisionBalanceteRow;
  razaoRows: VisionBalanceteRow[];
  /** DD/MM/AAAA — só dias a partir daqui são compensados. */
  dataInicio?: string;
}): ResultadoCicloGarantidaBanco {
  const { bancoRow, garantidaRow, razaoRows, dataInicio } = params;
  const inicioTs = dataInicio ? diaToTime(dataInicio) : null;

  // Lançamentos da conta banco em ordem cronológica, agrupados por dia.
  //
  // Correções de rodadas ANTERIORES ficam de fora (o chamador já as remove do razão;
  // aqui é só uma trava). Isso não é o mesmo que ignorar as compensações: as que ESTA
  // execução gera entram, sim, no saldo do dia — é justamente o que faz o dia deixar
  // de fechar invertido. O laço abaixo simula o razão como ele vai ficar gravado.
  const doBanco = razaoRows.filter(
    (r) =>
      linhaEhDaConta(r, bancoRow) &&
      diaToTime(r.data) !== null &&
      !isLancamentoCompensacaoGarantida(r),
  );
  const porDia = new Map<string, VisionBalanceteRow[]>();
  for (const r of doBanco) {
    const dia = String(r.data ?? '');
    if (!porDia.has(dia)) porDia.set(dia, []);
    porDia.get(dia)!.push(r);
  }
  const diasComMovimento = [...porDia.keys()].sort((a, b) => (diaToTime(a) ?? 0) - (diaToTime(b) ?? 0));
  if (!diasComMovimento.length) {
    return {
      ok: false,
      mensagem: `Nenhum lançamento encontrado para ${bancoRow.nome ?? 'a conta'} no razão.`,
      lancamentosGerados: [],
      contasProcessadas: [bancoRow.nome ?? ''],
      detalhes: [],
    };
  }

  // Calendário completo: do primeiro movimento até o fim do mês do último — assim
  // os dias sem lançamento (que voltam a fechar credor depois da devolução) também
  // entram, e o mês que fecha credor é compensado no seu último dia.
  const dias: string[] = [];
  {
    const primeiroTs = diaToTime(diasComMovimento[0])!;
    const ultimoTs = diaToTime(fimDoMesBr(diasComMovimento[diasComMovimento.length - 1]))!;
    const pad = (n: number) => String(n).padStart(2, '0');
    for (const cursor = new Date(primeiroTs); cursor.getTime() <= ultimoTs; cursor.setDate(cursor.getDate() + 1)) {
      dias.push(`${pad(cursor.getDate())}/${pad(cursor.getMonth() + 1)}/${cursor.getFullYear()}`);
    }
  }

  const lancamentos: VisionBalanceteRow[] = [];
  const detalhes: string[] = [];
  let ordem = 960_000;
  /**
   * Saldo do banco como ele FICA GRAVADO no razão (+ devedor, − credor): movimento
   * real MAIS as compensações que esta execução gera. As linhas [Auto] afetam o
   * saldo do dia de propósito — é o que impede o dia de fechar invertido. Parte da
   * ABERTURA: a linha "SALDO ANTERIOR" traz o valor em `saldoInicial`, com débito e
   * crédito zerados, então somar só débito − crédito começaria a conta do zero.
   */
  let saldo = 0;
  /** Devoluções agendadas (creditam o banco) por dia — DD/MM/AAAA → valor. */
  const devolucoesDoDia = new Map<string, number>();
  /**
   * Utilização ainda em aberto: já debitou o banco, mas a devolução só entra
   * amanhã. Precisa ser somada de volta quando o razão traz uma linha de SALDO
   * ANTERIOR, porque esse valor vem da fonte (banco/Domínio) e NÃO conhece a
   * compensação — reatribuir o saldo cru descartava a utilização em aberto e o
   * mês inteiro passava a correr com esse valor a menos, criando compensações
   * que não existiam e fechando o mês fora do saldo real do extrato.
   */
  let utilizacaoEmAberto = 0;

  for (const dia of dias) {
    // 1) Devolução da utilização do dia anterior: credita o banco HOJE.
    const devolucaoHoje = devolucoesDoDia.get(dia) ?? 0;
    if (devolucaoHoje > 0) {
      saldo -= devolucaoHoje;
      utilizacaoEmAberto = Math.max(0, utilizacaoEmAberto - devolucaoHoje);
    }

    // 2) Movimento real do dia.
    for (const r of porDia.get(dia) ?? []) {
      if (isHistoricoSaldoInicialRazao(r.nome)) {
        const si = r.saldoInicial ?? 0;
        if (Math.abs(si) >= 0.005) {
          const cru = r.naturezaSaldoInicial === 'C' ? -Math.abs(si) : Math.abs(si);
          saldo = cru + utilizacaoEmAberto;
        }
        continue;
      }
      saldo += (r.debito ?? 0) - (r.credito ?? 0);
    }

    const diaTs = diaToTime(dia);
    // Dias anteriores ao início só acumulam saldo — não geram compensação.
    if (inicioTs !== null && diaTs !== null && diaTs < inicioTs) continue;
    // 3) Fechou credor? Reclassifica o SALDO que sobrou no dia (não o lançamento).
    if (saldo >= -0.005) continue;

    const valor = Math.round(Math.abs(saldo) * 100) / 100;
    if (valor < 0.05) continue;
    const diaSeguinte = proximoDiaBr(dia);

    lancamentos.push(
      ...lancamentosUtilizacaoGarantida(bancoRow, garantidaRow, valor, dia, dia, ordem),
    );
    ordem += 10;
    lancamentos.push(
      ...lancamentosDevolucaoGarantida(bancoRow, garantidaRow, valor, diaSeguinte, dia, ordem),
    );
    ordem += 10;

    // A utilização debita o banco hoje (o dia passa a fechar zerado) e a devolução
    // credita amanhã — daí o dia seguinte volta a fechar credor e é compensado de novo.
    saldo += valor;
    utilizacaoEmAberto += valor;
    devolucoesDoDia.set(diaSeguinte, (devolucoesDoDia.get(diaSeguinte) ?? 0) + valor);

    detalhes.push(
      `${dia}: banco credor R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} — utilização no dia e devolução em ${diaSeguinte}.`,
    );
  }

  if (!lancamentos.length) {
    return {
      ok: false,
      mensagem: dataInicio
        ? `Nenhum dia fechou credor a partir de ${dataInicio} — nada a compensar.`
        : 'Nenhum dia fechou credor — nada a compensar.',
      lancamentosGerados: [],
      contasProcessadas: [bancoRow.nome ?? ''],
      detalhes,
    };
  }

  return {
    ok: true,
    mensagem: `${lancamentos.length} lançamento(s) gerados para ${bancoRow.nome ?? 'a conta'}.`,
    lancamentosGerados: lancamentos,
    contasProcessadas: [bancoRow.nome ?? ''],
    detalhes,
  };
}

/**
 * Automatiza banco credor ↔ garantida mês a mês para TODAS as contas bancárias do comparativo.
 * Cada banco tem ciclo independente; para quando deixa de ficar credor.
 */
export function executarCicloGarantidaBanco(params: {
  linhasBanco: LinhaComparativoMensal[];
  periodos: PeriodoMensal[];
  razaoRows: VisionBalanceteRow[];
  planoRows: VisionPlanoRow[];
  contaConfig?: AutomacaoContaConfig;
  onProgress?: OnProgressoCicloGarantida;
}): ResultadoCicloGarantidaBanco {
  const bancosUnicos = deduplicarLinhasBanco(params.linhasBanco);
  const { periodos, razaoRows, planoRows, contaConfig, onProgress } = params;

  if (!bancosUnicos.length) {
    return {
      ok: false,
      mensagem: 'Nenhuma conta bancária analítica encontrada no comparativo.',
      lancamentosGerados: [],
      contasProcessadas: [],
      detalhes: [],
    };
  }

  if (!periodos.length) {
    return {
      ok: false,
      mensagem: 'Nenhum mês no período do comparativo.',
      lancamentosGerados: [],
      contasProcessadas: [],
      detalhes: [],
    };
  }

  const todosLancamentos: VisionBalanceteRow[] = [];
  const detalhes: string[] = [];
  const contasProcessadas: string[] = [];
  const contasComLancamento = new Set<string>();
  let ordem = 940_000;
  const bancosTotal = bancosUnicos.length;
  const mesesTotal = periodos.length;

  detalhes.push(`${bancosUnicos.length} conta(s) bancária(s) no ciclo: ${bancosUnicos.map((b) => b.nome).join('; ')}.`);

  for (let bi = 0; bi < bancosUnicos.length; bi++) {
    const linha = bancosUnicos[bi];
    let pendenteDevolucao = 0;
    let lancouNestaConta = false;

    for (let mi = 0; mi < periodos.length; mi++) {
      const periodo = periodos[mi];
      const mesLabel = periodo.label;

      onProgress?.({
        bancoAtual: bi + 1,
        bancosTotal,
        mesAtual: mi + 1,
        mesesTotal,
        mensagem: `${linha.nome} · ${mesLabel}`,
      });

      const cel = linha.saldosPorMes[mesLabel];
      const precisaTrabalho = pendenteDevolucao >= 0.05 || bancoSaldoCredor(cel);
      if (!precisaTrabalho) continue;

      const banco = linhaParaRowConta(linha, planoRows);
      let gPar = escolherContaGarantida([], planoRows, contaConfig);

      if ((!gPar.utilizacao || !gPar.devolucao) && precisaTrabalho) {
        const razaoPeriodo = filtrarRazaoPorPeriodo(razaoRows, periodo.de, periodo.ate);
        const balanceteMes = montarBalanceteComPeriodo(
          razaoRows,
          razaoPeriodo,
          planoRows,
          periodo.de,
          periodo.ate,
        );
        gPar = escolherContaGarantida(balanceteMes, planoRows, contaConfig);
      }

      const gUtil = gPar.utilizacao;
      const gDev = gPar.devolucao;

      if (!gUtil || !gDev) {
        detalhes.push(
          `${linha.nome} · ${mesLabel}: conta garantida não encontrada — configure Débito e Crédito em Configurar.`,
        );
        continue;
      }

      const data = resolverDataAutomacao(periodo, contaConfig);

      if (pendenteDevolucao >= 0.05) {
        const dev = lancamentosDevolucaoGarantida(
          banco,
          gDev,
          pendenteDevolucao,
          data,
          mesLabel,
          ordem,
        );
        ordem += 10;
        todosLancamentos.push(...dev);
        lancouNestaConta = true;
        detalhes.push(
          `${linha.nome} · ${mesLabel}: devolução D garantida / C banco — ${pendenteDevolucao.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`,
        );
        pendenteDevolucao = 0;
      }

      if (!bancoSaldoCredor(cel)) continue;

      const valor = cel!.valor;
      const util = lancamentosUtilizacaoGarantida(banco, gUtil, valor, data, mesLabel, ordem);
      ordem += 10;
      todosLancamentos.push(...util);
      pendenteDevolucao = valor;
      lancouNestaConta = true;
      detalhes.push(
        `${linha.nome} · ${mesLabel}: utilização D banco / C garantida — ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`,
      );
    }

    if (lancouNestaConta) contasComLancamento.add(linha.nome);
    if (!contasProcessadas.includes(linha.nome)) contasProcessadas.push(linha.nome);
  }

  if (!todosLancamentos.length) {
    return {
      ok: false,
      mensagem:
        'Nenhum lançamento gerado. Verifique saldo credor (C) nos bancos e se há conta garantida no plano.',
      lancamentosGerados: [],
      contasProcessadas,
      detalhes,
    };
  }

  const qtdBancos = contasComLancamento.size;
  return {
    ok: true,
    mensagem: `Ciclo banco/garantida em ${qtdBancos} de ${bancosUnicos.length} conta(s) bancária(s). ${todosLancamentos.length} lançamento(s).`,
    lancamentosGerados: todosLancamentos,
    contasProcessadas,
    detalhes,
  };
}
