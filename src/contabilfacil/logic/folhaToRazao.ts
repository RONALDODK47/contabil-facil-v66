import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';
import type { FolhaRelatorioImportRow } from './dominioTxtIO';
import {
  contasParaFolhaRubrica,
  FOLHA_RUBRICA_LABELS,
  resolveFolhaRubrica,
  type FolhaContasAutomacaoConfig,
  type FolhaRubricaId,
} from './folhaContasAutomacao';
import { resolveFolhaRegraContas, type FolhaRegra } from './folhaContasAutomacaoStorage';
import { classificarRubricaFolha, getFolhaDestino } from './folhaRubricaTaxonomia';

export const FOLHA_RAZAO_MARCA = 'FOLHA-AUTO';

export type FolhaPayrollLinha = {
  id: string;
  name: string;
  baseSalary: number;
  inss: number;
  fgts: number;
  irrf: number;
  net: number;
  date?: string;
};

export type BuildFolhaRazaoResult = {
  rows: VisionBalanceteRow[];
  gerados: number;
  pendencias: string[];
};

function normalizeConta(conta: string): { codigo: string; classificacao: string } {
  const classificacao = conta.trim();
  const codigo = classificacao.replace(/\./g, '') || classificacao;
  return { codigo, classificacao };
}

function brDateToDisplay(iso: string | undefined): string {
  const t = String(iso ?? '').trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) return t;
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const now = new Date();
  return `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

function pushPartida(
  rows: VisionBalanceteRow[],
  ordem: number,
  params: {
    data: string;
    historico: string;
    rubrica: FolhaRubricaId;
    debitoConta: string;
    creditoConta: string;
    valor: number;
    tag: string;
  },
): number {
  const valor = Math.abs(params.valor);
  if (valor < 0.0001) return ordem;
  const deb = normalizeConta(params.debitoConta);
  const cred = normalizeConta(params.creditoConta);
  const historico = params.historico.trim().toUpperCase();
  // Marcador (não a classificação contábil da conta!) — usado por `isFolhaRazaoRow` para
  // filtrar as linhas geradas pela Folha antes de mesclar um novo envio ao razão. Usar
  // `deb.classificacao`/`cred.classificacao` (o código da própria conta) aqui fazia esse
  // filtro nunca bater, então cada "Mandar para o Balancete" duplicava as linhas da Folha em
  // vez de substituir as anteriores.
  const classificacao = `${FOLHA_RAZAO_MARCA} · ${params.rubrica} · ${params.tag}`;

  rows.push({
    codigo: deb.codigo,
    classificacao,
    nome: historico,
    data: params.data,
    debito: valor,
    credito: 0,
    saldoInicial: 0,
    saldoFinal: 0,
    ordem,
    tipo: 'A',
    contaDeb: deb.codigo,
    contaCred: cred.codigo,
  });
  rows.push({
    codigo: cred.codigo,
    classificacao,
    nome: historico,
    data: params.data,
    debito: 0,
    credito: valor,
    saldoInicial: 0,
    saldoFinal: 0,
    ordem,
    tipo: 'A',
    contaDeb: deb.codigo,
    contaCred: cred.codigo,
  });
  return ordem + 1;
}

function gerarPartidaRubrica(
  rows: VisionBalanceteRow[],
  ordem: number,
  contas: FolhaContasAutomacaoConfig,
  regras: FolhaRegra[],
  pendencias: string[],
  params: {
    data: string;
    historico: string;
    rubrica: FolhaRubricaId;
    valor: number;
    tag: string;
    tipo?: 'PROVENTOS' | 'DESCONTOS' | 'INFORMATIVA';
  },
): { ordem: number; gerados: number } {
  const valor = Math.abs(params.valor);
  if (valor < 0.0001) return { ordem, gerados: 0 };

  // A "subaba Contas" da Folha cadastra regras por histórico (débito+crédito), não mais um
  // par fixo por rubrica — tenta a regra primeiro; só cai no par fixo (legado) se não houver
  // regra cadastrada para este histórico.
  const regra = resolveFolhaRegraContas(params.historico, regras, params.tipo);
  const par = regra
    ? { debito: regra.contaDebito, credito: regra.contaCredito }
    : contasParaFolhaRubrica(contas, params.rubrica);
  if (!par.debito.trim() || !par.credito.trim()) {
    pendencias.push(
      `${FOLHA_RUBRICA_LABELS[params.rubrica]}: configure débito e crédito na subaba Contas`,
    );
    return { ordem, gerados: 0 };
  }

  const nextOrdem = pushPartida(rows, ordem, {
    data: params.data,
    historico: params.historico,
    rubrica: params.rubrica,
    debitoConta: par.debito,
    creditoConta: par.credito,
    valor,
    tag: params.tag,
  });
  return { ordem: nextOrdem, gerados: 1 };
}

export function isFolhaRazaoRow(row: VisionBalanceteRow): boolean {
  return (row.classificacao ?? '').startsWith(FOLHA_RAZAO_MARCA);
}

export function buildRazaoFromFolhaRelatorio(
  linhas: FolhaRelatorioImportRow[],
  contas: FolhaContasAutomacaoConfig,
  regras: FolhaRegra[] = [],
  ordemInicial = 1,
): BuildFolhaRazaoResult {
  const rows: VisionBalanceteRow[] = [];
  const pendencias: string[] = [];
  let ordem = ordemInicial;
  let gerados = 0;

  for (const linha of linhas) {
    const valor = Math.max(linha.debito ?? 0, linha.credito ?? 0);
    if (valor < 0.0001) continue;

    // Totalizadores do relatório (LIQUIDO DA FOLHA / LIQUIDO RESCISAO, linhas de BASE) já são
    // o resultado de proventos menos descontos — contabilizá-los duplicaria a folha inteira.
    const classificacao = classificarRubricaFolha(linha.description, linha.tipo);
    if (classificacao && !classificacao.grupo.contabiliza) continue;

    // Uma regra cadastrada (subaba Contas) pelo histórico sempre vale, mesmo quando o texto
    // não bate com nenhuma das palavras-chave fixas de rubrica abaixo — sem isso, um
    // histórico fora do vocabulário fixo (ex.: nome de uma rubrica customizada do Domínio)
    // nunca chegava a testar a regra do usuário.
    const rubrica =
      resolveFolhaRubrica(linha.description) ??
      (resolveFolhaRegraContas(linha.description, regras, linha.tipo) ? 'SALARIO' : null);
    if (!rubrica) {
      pendencias.push(`Sem rubrica: «${linha.description}» — ajuste o histórico ou configure manualmente`);
      continue;
    }

    const data = brDateToDisplay(linha.date);
    const result = gerarPartidaRubrica(rows, ordem, contas, regras, pendencias, {
      data,
      historico: linha.description,
      rubrica,
      valor,
      tag: linha.id,
      tipo: linha.tipo,
    });
    ordem = result.ordem;
    gerados += result.gerados;
  }

  return { rows, gerados, pendencias };
}

export function buildRazaoFromFolhaPayroll(
  registros: FolhaPayrollLinha[],
  contas: FolhaContasAutomacaoConfig,
  regras: FolhaRegra[] = [],
  ordemInicial = 1,
): BuildFolhaRazaoResult {
  const rows: VisionBalanceteRow[] = [];
  const pendencias: string[] = [];
  let ordem = ordemInicial;
  let gerados = 0;

  for (const reg of registros) {
    const data = brDateToDisplay(reg.date);
    const baseHist = reg.name.toUpperCase();

    const partidas: Array<{ rubrica: FolhaRubricaId; valor: number; hist: string }> = [
      { rubrica: 'SALARIO', valor: reg.net, hist: `SALARIO LIQUIDO · ${baseHist}` },
      { rubrica: 'INSS_RECOLHER', valor: reg.inss, hist: `INSS · ${baseHist}` },
      { rubrica: 'FGTS_RECOLHER', valor: reg.fgts, hist: `FGTS · ${baseHist}` },
      { rubrica: 'IRRF_RECOLHER', valor: reg.irrf, hist: `IRRF · ${baseHist}` },
    ];

    for (const p of partidas) {
      const result = gerarPartidaRubrica(rows, ordem, contas, regras, pendencias, {
        data,
        historico: p.hist,
        rubrica: p.rubrica,
        valor: p.valor,
        tag: reg.id,
      });
      ordem = result.ordem;
      gerados += result.gerados;
    }
  }

  return { rows, gerados, pendencias };
}

export function mergeFolhaRazaoComExistente(
  existente: VisionBalanceteRow[],
  novos: VisionBalanceteRow[],
): VisionBalanceteRow[] {
  const base = existente.filter((r) => !isFolhaRazaoRow(r));
  const maxOrdem = base.reduce((m, r) => Math.max(m, r.ordem ?? 0), 0);
  // As duas linhas (débito+crédito) de uma mesma partida compartilham a mesma `ordem` de
  // origem — remapear por índice de linha (i) em vez de por grupo de ordem quebrava esse
  // par, fazendo a conta perder a contrapartida ao entrar no balancete.
  const ordemMap = new Map<number, number>();
  let nextOrdem = maxOrdem;
  const reordenados = novos.map((r) => {
    const origem = r.ordem ?? 0;
    if (!ordemMap.has(origem)) {
      nextOrdem += 1;
      ordemMap.set(origem, nextOrdem);
    }
    return { ...r, ordem: ordemMap.get(origem)! };
  });
  return [...base, ...reordenados];
}

/**
 * Partidas da folha calculadas a partir do relatório importado + regras de conta.
 *
 * É a MESMA fonte que alimenta o "Totais por Conta" da aba Folha, e é o que o razão por conta
 * daquela aba precisa exibir. Usar o razão persistido ali não funciona por dois motivos:
 *
 * 1. Enquanto a folha não foi mandada para o balancete, o razão não tem nenhuma linha dela —
 *    o total aparecia preenchido e o detalhe vinha vazio.
 * 2. Contas como "Salários e ordenados a pagar" também recebem o pagamento vindo da
 *    conciliação bancária. Esses lançamentos são de outra aba e não podem aparecer no
 *    detalhamento de um total que foi calculado só com dados da folha.
 *
 * Derivando o detalhe do mesmo lugar que o total, os dois nunca divergem.
 */
export function buildFolhaPartidasDoRelatorio(
  linhas: FolhaRelatorioImportRow[],
  regras: FolhaRegra[],
): VisionBalanceteRow[] {
  const rows: VisionBalanceteRow[] = [];
  let ordem = 1;

  for (const linha of linhas) {
    // Totalizadores (líquido, bases) não geram partida — contabilizá-los duplicaria a folha.
    const classificacao = classificarRubricaFolha(linha.description, linha.tipo);
    if (classificacao && !classificacao.grupo.contabiliza) continue;

    const regra = resolveFolhaRegraContas(linha.description, regras, linha.tipo);
    if (!regra) continue;

    const valor = (linha.debito ?? 0) > 0 ? (linha.debito ?? 0) : (linha.credito ?? 0);
    if (valor <= 0) continue;

    const deb = normalizeConta(regra.contaDebito);
    const cred = normalizeConta(regra.contaCredito);
    if (!deb.codigo || !cred.codigo) continue;

    const data = brDateToDisplay(linha.date);
    const historico = String(linha.description ?? '').trim().toUpperCase();
    const marca = `${FOLHA_RAZAO_MARCA} · ${regra.destino ?? 'REGRA'} · ${linha.id ?? ordem}`;
    const base = {
      classificacao: marca,
      nome: historico,
      data,
      saldoInicial: 0,
      saldoFinal: 0,
      ordem,
      tipo: 'A' as const,
      contaDeb: deb.codigo,
      contaCred: cred.codigo,
    };

    rows.push({ ...base, codigo: deb.codigo, debito: valor, credito: 0 });
    rows.push({ ...base, codigo: cred.codigo, debito: 0, credito: valor });
    ordem += 1;
  }

  return rows;
}

/** Total por conta a partir das partidas — garante que detalhe e total batam sempre. */
export function totaisPorContaDeFolhaPartidas(
  partidas: VisionBalanceteRow[],
  nomeDaConta: (codigo: string) => string,
): Array<{ conta: string; nomeConta: string; debito: number; credito: number; saldo: number }> {
  const totais = new Map<string, { conta: string; nomeConta: string; debito: number; credito: number }>();

  for (const row of partidas) {
    const codigo = String(row.codigo ?? '').trim();
    if (!codigo) continue;
    let atual = totais.get(codigo);
    if (!atual) {
      atual = { conta: codigo, nomeConta: nomeDaConta(codigo), debito: 0, credito: 0 };
      totais.set(codigo, atual);
    }
    atual.debito += row.debito ?? 0;
    atual.credito += row.credito ?? 0;
  }

  return [...totais.values()]
    .map((t) => ({ ...t, saldo: t.debito - t.credito }))
    .sort((a, b) => a.conta.localeCompare(b.conta));
}

// ---------------------------------------------------------------------------
// Partidas da aba Folha (Totais por Conta e o razão por conta)
// ---------------------------------------------------------------------------

export type FolhaPartidaLinha = {
  id?: string;
  date?: string;
  description?: string;
  debito?: number;
  credito?: number;
  tipo?: 'PROVENTOS' | 'DESCONTOS' | 'INFORMATIVA';
  /** Cabeçalho "Cálculo:" do relatório de origem (Folha Mensal, Rescisão, …). */
  tipoCalculo?: string;
};

export type FolhaTotalConta = {
  conta: string;
  nomeConta: string;
  /** Classificação contábil do plano ("2.1.3.01.00001") — define a natureza da conta. */
  classificacao?: string;
  debito: number;
  credito: number;
  saldo: number;
};

function parseBrDateFolha(s: string | undefined): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Marca as partidas da aba Folha como ainda não publicadas no razão do balancete.
 *
 * Vai em `importId`, e NUNCA em `classificacao`: a classificação precisa ser a contábil de
 * verdade (ex.: "2.1.3.01.00001"), porque é dela que o razão deriva a natureza da conta —
 * um marcador ali fazia "Salários a pagar" aparecer como DEVEDORA e as linhas saírem
 * pintadas como saldo invertido.
 */
export const FOLHA_PARTIDA_MARCA = 'FOLHA-REGRA';

/**
 * Gera as partidas (débito + crédito) de cada lançamento da folha que tem regra cadastrada.
 *
 * Esta é a ÚNICA fonte da aba Folha: tanto o "Totais por Conta" quanto o razão que abre ao
 * clicar numa conta saem daqui. Ler o razão do balancete nesse ponto estaria errado por dois
 * motivos: as contas da folha também recebem movimento da conciliação bancária (o pagamento
 * por PIX de "Salários a pagar", por exemplo), que não pertence a esta aba; e enquanto a
 * folha não é publicada no balancete o razão não tem nenhuma linha dela, de modo que o
 * detalhe apareceria vazio embora o total mostrasse valor.
 */
export function buildFolhaPartidas(
  linhas: FolhaPartidaLinha[],
  regras: FolhaRegra[],
  periodo?: { de?: string; ate?: string },
  /** Código reduzido → classificação contábil do plano. Sem isso a natureza da conta sai errada. */
  classificacaoPorConta?: (codigo: string) => string,
): VisionBalanceteRow[] {
  const dateFrom = parseBrDateFolha(periodo?.de);
  const dateTo = parseBrDateFolha(periodo?.ate);
  const rows: VisionBalanceteRow[] = [];
  let ordem = 1;

  for (const linha of linhas) {
    if (dateFrom || dateTo) {
      const rowDate = parseBrDateFolha(linha.date);
      if (!rowDate) continue;
      if (dateFrom && rowDate < dateFrom) continue;
      if (dateTo && rowDate > dateTo) continue;
    }

    const descricao = String(linha.description ?? '');
    const regra = resolveFolhaRegraContas(descricao, regras, linha.tipo, linha.tipoCalculo);
    if (!regra) continue;

    const valor = (linha.debito ?? 0) > 0 ? (linha.debito ?? 0) : (linha.credito ?? 0);
    if (valor <= 0) continue;

    const historico = descricao.trim().toUpperCase();
    const cls = (codigo: string) => classificacaoPorConta?.(codigo) ?? '';
    const base = {
      nome: historico,
      historico,
      data: linha.date,
      saldoInicial: 0,
      saldoFinal: 0,
      ordem,
      tipo: 'A' as const,
      importId: `${FOLHA_PARTIDA_MARCA}·${regra.id}`,
      contaDeb: regra.contaDebito,
      contaCred: regra.contaCredito,
    };

    rows.push({
      ...base,
      id: `${linha.id ?? ordem}-d`,
      codigo: regra.contaDebito,
      classificacao: cls(regra.contaDebito),
      debito: valor,
      credito: 0,
    });
    rows.push({
      ...base,
      id: `${linha.id ?? ordem}-c`,
      codigo: regra.contaCredito,
      classificacao: cls(regra.contaCredito),
      debito: 0,
      credito: valor,
    });
    ordem += 1;

    // Compensação automática (hoje: salário-família e maternidade). A empresa adianta o
    // benefício ao empregado e abate o mesmo valor da guia do INSS — sem este segundo
    // lançamento a conta de INSS a recuperar acumularia saldo indefinidamente.
    const destino = regra.destino ? getFolhaDestino(regra.destino) : undefined;
    const destinoCompensacao = destino?.compensaAutomaticamenteCom;
    if (destinoCompensacao) {
      const regraCompensacao = regras.find((r) => r.destino === destinoCompensacao);
      // Sem a regra do destino de compensação não há como saber qual conta abater; a
      // pendência fica visível no saldo da conta a recuperar.
      if (regraCompensacao) {
        const historicoCompensacao = `${historico} · COMPENSACAO`;
        const baseCompensacao = {
          ...base,
          nome: historicoCompensacao,
          historico: historicoCompensacao,
          ordem,
          contaDeb: regraCompensacao.contaCredito,
          contaCred: regra.contaDebito,
        };

        rows.push({
          ...baseCompensacao,
          id: `${linha.id ?? ordem}-comp-d`,
          codigo: regraCompensacao.contaCredito,
          classificacao: cls(regraCompensacao.contaCredito),
          debito: valor,
          credito: 0,
        });
        rows.push({
          ...baseCompensacao,
          id: `${linha.id ?? ordem}-comp-c`,
          codigo: regra.contaDebito,
          classificacao: cls(regra.contaDebito),
          debito: 0,
          credito: valor,
        });
        ordem += 1;
      }
    }
  }

  return rows;
}

/**
 * Totais por conta da aba Folha, somados a partir das MESMAS partidas exibidas no razão por
 * conta — assim o detalhe sempre fecha com o total.
 */
export function buildFolhaTotaisPorConta(
  partidas: VisionBalanceteRow[],
  nomePorConta: (codigo: string) => string,
): FolhaTotalConta[] {
  const totais = new Map<string, FolhaTotalConta>();

  for (const row of partidas) {
    const codigo = row.codigo;
    let atual = totais.get(codigo);
    if (!atual) {
      atual = {
        conta: codigo,
        nomeConta: nomePorConta(codigo),
        // A classificação já vem na partida (ver `buildFolhaPartidas`)
        classificacao: row.classificacao || undefined,
        debito: 0,
        credito: 0,
        saldo: 0,
      };
      totais.set(codigo, atual);
    }
    atual.debito += row.debito ?? 0;
    atual.credito += row.credito ?? 0;
  }

  return [...totais.values()]
    .map((t) => ({ ...t, saldo: t.debito - t.credito }))
    .sort((a, b) => a.conta.localeCompare(b.conta));
}

// ---------------------------------------------------------------------------
// Agrupamento por natureza contábil
// ---------------------------------------------------------------------------

export type FolhaNaturezaId =
  | 'ATIVO'
  | 'PASSIVO'
  | 'PATRIMONIO'
  | 'RECEITAS'
  | 'CUSTOS'
  | 'DESPESAS'
  | 'COMPENSACAO'
  | 'OUTRAS';

export interface FolhaSecaoTotais {
  id: FolhaNaturezaId;
  titulo: string;
  contas: FolhaTotalConta[];
  debito: number;
  credito: number;
}

/** Ordem em que as seções aparecem — a mesma do balanço patrimonial e da DRE. */
const ORDEM_NATUREZA: Array<{ id: FolhaNaturezaId; titulo: string }> = [
  { id: 'ATIVO', titulo: 'Ativo' },
  { id: 'PASSIVO', titulo: 'Passivo' },
  { id: 'PATRIMONIO', titulo: 'Patrimônio líquido' },
  { id: 'RECEITAS', titulo: 'Receitas' },
  { id: 'CUSTOS', titulo: 'Custos' },
  { id: 'DESPESAS', titulo: 'Despesas' },
  { id: 'COMPENSACAO', titulo: 'Contas de compensação' },
  { id: 'OUTRAS', titulo: 'Outras contas' },
];

function normalizaTexto(v: string): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

/**
 * Natureza de uma conta, a partir da classificação e dos NOMES dos grupos do plano.
 *
 * O dígito raiz sozinho não basta: nos planos em que o grupo 3 é o resultado do exercício
 * (como o desta empresa, "3.2 DESPESAS OPERACIONAIS"), a convenção genérica de 3 = patrimônio
 * líquido classificaria toda a despesa com pessoal como PL. Por isso o nome do grupo do plano
 * tem prioridade sobre o dígito.
 */
export function naturezaDaConta(
  classificacao: string | undefined,
  nomeDoGrupo: (classificacao: string) => string,
): FolhaNaturezaId {
  const cls = String(classificacao ?? '').trim();
  if (!cls) return 'OUTRAS';

  const partes = cls.split('.');
  const nivel1 = partes[0] ?? '';
  const nivel2 = partes.slice(0, 2).join('.');

  const nome1 = normalizaTexto(nomeDoGrupo(nivel1));
  const nome2 = normalizaTexto(nomeDoGrupo(nivel2));
  const nomes = `${nome2} ${nome1}`;

  // Patrimônio líquido costuma ser um sub-grupo do passivo (2.3) — precisa vir antes
  if (/PATRIMONIO/.test(nomes)) return 'PATRIMONIO';
  if (/COMPENSAC/.test(nomes)) return 'COMPENSACAO';

  if (nivel1 === '1') return 'ATIVO';
  if (nivel1 === '2') return 'PASSIVO';

  if (/RECEITA/.test(nome2)) return 'RECEITAS';
  if (/CUSTO/.test(nomes)) return 'CUSTOS';
  if (/DESPESA/.test(nomes)) return 'DESPESAS';

  // Grupos de resultado sem nome reconhecível (3, 4, 5…) entram como despesa
  if (/^[3-8]$/.test(nivel1)) return 'DESPESAS';
  if (nivel1 === '9') return 'COMPENSACAO';
  return 'OUTRAS';
}

/**
 * Divide os totais em seções por natureza, preservando a ordem contábil e sem perder nenhuma
 * conta: o que não se encaixa cai em "Outras contas".
 */
export function agruparFolhaTotaisPorNatureza(
  totais: FolhaTotalConta[],
  nomeDoGrupo: (classificacao: string) => string,
): FolhaSecaoTotais[] {
  const porNatureza = new Map<FolhaNaturezaId, FolhaTotalConta[]>();

  for (const total of totais) {
    const id = naturezaDaConta(total.classificacao, nomeDoGrupo);
    const lista = porNatureza.get(id);
    if (lista) lista.push(total);
    else porNatureza.set(id, [total]);
  }

  return ORDEM_NATUREZA.filter((n) => porNatureza.has(n.id)).map((n) => {
    const contas = porNatureza.get(n.id)!;
    return {
      id: n.id,
      titulo: n.titulo,
      contas,
      debito: contas.reduce((s, c) => s + c.debito, 0),
      credito: contas.reduce((s, c) => s + c.credito, 0),
    };
  });
}

/** A linha do razão veio das regras da Folha (ver `buildFolhaPartidas`)? */
export function isFolhaPartidaRow(row: VisionBalanceteRow): boolean {
  return String(row.importId ?? '').startsWith(FOLHA_PARTIDA_MARCA);
}

/**
 * Substitui no razão as partidas publicadas pela Folha, preservando todo o resto.
 *
 * Reenviar a mesma competência troca os lançamentos anteriores em vez de duplicá-los, e as
 * linhas da conciliação bancária — que dividem as mesmas contas — ficam intactas.
 */
export function mergeFolhaPartidasComRazao(
  existente: VisionBalanceteRow[],
  novas: VisionBalanceteRow[],
): VisionBalanceteRow[] {
  return [...existente.filter((r) => !isFolhaPartidaRow(r)), ...novas];
}
