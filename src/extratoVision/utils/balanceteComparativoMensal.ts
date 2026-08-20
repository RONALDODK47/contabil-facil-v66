import type { VisionBalanceteRow, VisionPlanoRow } from '../types/accounting';
import { compareClassificacaoContabil, getClassificacao } from './demonstracoesContabeis';
import {
  analisarSaldoContabil,
  enrichNaturezaSaldoImportado,
  formatNaturezaConta,
  isContaNaturezaAmbigua,
  isContaPassivoPorNome,
} from './naturezaContabil';
import {
  resolveNaturezaManual,
  setActiveNaturezaManualEntries,
  type NaturezaManualEntry,
} from './naturezaManualConfig';
import { parseBrDateToTime } from './dateBounds';
import {
  buildPlanoLookup,
  buildRazaoTimeIndex,
  compareDataRazao,
  filtrarRazaoPorPeriodo,
  montarBalanceteComPeriodo,
  normCls as normClsRazao,
  shouldIndexRazao,
  type MontarBalanceteCtx,
} from './razaoContabil';

export type PeriodoMensal = { label: string; de: string; ate: string };

export type SaldoMensalCelula = {
  valor: number;
  natureza: 'D' | 'C';
  texto: string;
  /** Natureza exibida diverge da esperada (CPC 26 / regra RF). */
  invertido?: boolean;
};

export type DetalheMesComparativo = {
  data: string;
  si: string;
  deb: string;
  cred: string;
};

export type LinhaComparativoMensal = {
  chave: string;
  codigo: string;
  classificacao: string;
  nome: string;
  tipo?: 'S' | 'A';
  saldosPorMes: Record<string, SaldoMensalCelula | null>;
  /** SI / D / C do mês (pré-formatado para exibição rápida). */
  detalhePorMes: Record<string, DetalheMesComparativo>;
  naturezaCodigo?: 'D' | 'C';
  naturezaLabel?: string;
};

/**
 * Uma célula mensal deve aparecer VERMELHA (natureza invertida) no Balancete?
 *
 * A decisão canônica é `cel.invertido`, produzida por `analisarSaldoContabil` —
 * que de propósito NÃO acusa inversão em contas de resultado (grupos 3-7), de
 * natureza ambígua (Lucros/Prejuízos Acumulados, Resultado do Exercício) e
 * redutoras do PL, onde saldo do lado oposto é legítimo.
 *
 * A tela comparava também `cel.natureza !== naturezaEsperada`, o que atropelava
 * todas essas exceções: uma receita com mês devedor (devolução/estorno) e uma
 * conta ambígua com saldo devedor saíam vermelhas e com o selo "Invertida",
 * embora o motor tivesse decidido que não há inversão — e, incoerentemente, não
 * apareciam ao ligar o filtro "Contas saldo mês invertido", que sempre usou só
 * `cel.invertido`.
 *
 * O `!==` só continua valendo onde o motor se abstém por construção: contas
 * SINTÉTICAS (`detectarInversao` devolve false para tipo 'S'), e ainda assim
 * apenas nos grupos patrimoniais (1 Ativo / 2 Passivo+PL) e fora das ambíguas —
 * senão o grupo "3 RECEITAS" reintroduziria o mesmo falso positivo.
 */
export function celulaMensalInvertida(
  cel: SaldoMensalCelula | null | undefined,
  linha: Pick<LinhaComparativoMensal, 'codigo' | 'classificacao' | 'nome' | 'tipo' | 'naturezaCodigo'>,
): boolean {
  if (!cel || cel.valor < 0.01) return false;
  if (cel.invertido === true) return true;
  if (linha.tipo !== 'S') return false;

  const raiz = (linha.classificacao || linha.codigo || '').trim().charAt(0);
  if (raiz !== '1' && raiz !== '2') return false;
  if (isContaNaturezaAmbigua({ nome: linha.nome, classificacao: linha.classificacao })) return false;

  const natEsp = linha.naturezaCodigo;
  return !!natEsp && cel.natureza !== natEsp;
}

/**
 * Conta presente em algum balancete mensal do período. Presença basta — uma conta
 * importada com saldo ZERADO (D=C=0 no balancete de saldo anterior) veio do razão
 * e precisa aparecer; esconder por "tudo zero" apagava contas legítimas do arquivo
 * importado. Quem NUNCA entrou em balancete algum do período (semeada só do plano
 * via incluirPlanoCompleto, sem lançamento e sem saldo anterior) continua de fora.
 */
export function linhaTemMovimentoNoPeriodo(l: LinhaComparativoMensal): boolean {
  if (Object.keys(l.detalhePorMes).length > 0) return true;
  for (const c of Object.values(l.saldosPorMes)) {
    if (c && c.valor >= 0.01) return true;
  }
  return false;
}

export type ResultadoAnaliseSaldoEsperado = {
  ok: boolean;
  mensagem: string;
  diferenca?: number;
  diferencaFmt?: string;
  etapa: 'conferido' | 'provisao' | 'razao' | 'nao_encontrado';
  detalhes?: string[];
  lancamentosSugeridos?: Array<{
    data: string;
    codigo: string;
    classificacao: string;
    nome: string;
    debito: number;
    credito: number;
  }>;
};

function parseDataBrToKey(data: string): { year: number; month: number } | null {
  const t = data.trim();
  // DD/MM/AAAA, D/M/AAAA, DD/MM/AA
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const month = parseInt(m[2], 10);
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || year < 1900) return null;
    return { year, month };
  }
  // YYYY-MM-DD (ISO)
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const year = parseInt(iso[1], 10);
    const month = parseInt(iso[2], 10);
    if (month < 1 || month > 12 || year < 1900) return null;
    return { year, month };
  }
  return null;
}

function valorMovimento(n: unknown): number {
  if (typeof n === 'number') return Number.isFinite(n) ? Math.abs(n) : 0;
  if (typeof n === 'string') {
    const t = n.trim().replace(/\s/g, '');
    if (!t) return 0;
    const normalized = t.includes(',')
      ? t.replace(/\./g, '').replace(',', '.')
      : t;
    const v = Math.abs(parseFloat(normalized));
    return Number.isFinite(v) ? v : 0;
  }
  return 0;
}

/** Histórico típico de saldo inicial/anterior (Domínio / legado) — não gera coluna de mês. */
function isHistoricoSaldoInicial(nome?: string): boolean {
  const n = (nome ?? '').trim();
  if (!n) return false;
  return /saldo\s*(?:inicial|anterior)|referente\s+saldo|^\s*s\.?\s*i\.?\s*$/i.test(n);
}

/**
 * Só conta como lançamento de movimento se houver D ou C real — OU se a linha vier
 * de um balancete importado (Saldo Anterior/Saldo Atual), caso em que ela representa
 * o saldo da conta no período mesmo sem movimento (ex.: empréstimo cujo saldo não
 * mudou no mês). Sem o saldoFinal aqui, contas "Importar Saldo" com D/C zerados
 * (linha só carregando o saldo anterior) desapareciam do comparativo mensal.
 * Ignora: linha só com data/SI sem saldo final; histórico de saldo inicial (mesmo se
 * veio como D/C no import).
 */
function rowTemLancamento(r: VisionBalanceteRow): boolean {
  if (isHistoricoSaldoInicial(r.nome)) return false;
  // SI puro (sem D/C e sem saldo final) nunca gera coluna — é só um marcador de razão.
  if (
    valorMovimento(r.saldoInicial) >= 0.01 &&
    valorMovimento(r.debito) < 0.01 &&
    valorMovimento(r.credito) < 0.01 &&
    valorMovimento(r.saldoFinal) < 0.01
  ) {
    return false;
  }
  return (
    valorMovimento(r.debito) >= 0.01 ||
    valorMovimento(r.credito) >= 0.01 ||
    valorMovimento(r.saldoFinal) >= 0.01
  );
}

function dataLancamentoToTime(data: string): number | null {
  const t = data.trim();
  const br = parseBrDateToTime(t);
  if (br !== null) return br;
  // YYYY-MM-DD
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (!iso) return null;
  const year = parseInt(iso[1], 10);
  const month = parseInt(iso[2], 10);
  const day = parseInt(iso[3], 10);
  if (Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year)) return null;
  const ms = new Date(year, month - 1, day).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Soma D+C por ano-calendário (só linhas com movimento real).
 * Usado para descartar anos-fantasma de abertura (ex.: 2001) quando o movimento
 * relevante está em outro ano (ex.: 2026).
 */
function movimentoPorAno(razaoRows: VisionBalanceteRow[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const r of razaoRows) {
    if (!rowTemLancamento(r)) continue;
    const key = parseDataBrToKey(r.data?.trim() ?? '');
    if (!key) continue;
    const v = valorMovimento(r.debito) + valorMovimento(r.credito);
    map.set(key.year, (map.get(key.year) ?? 0) + v);
  }
  return map;
}

/**
 * Anos que realmente importam para o comparativo.
 * Se um ano tem menos de 1% do movimento do ano principal e fica a 2+ anos de distância,
 * trata como legado/abertura e não gera coluna.
 */
function anosRelevantesParaComparativo(razaoRows: VisionBalanceteRow[]): Set<number> | null {
  const porAno = movimentoPorAno(razaoRows);
  if (porAno.size <= 1) return null;
  let anoPrincipal = 0;
  let maxMov = 0;
  for (const [ano, mov] of porAno) {
    if (mov > maxMov) {
      maxMov = mov;
      anoPrincipal = ano;
    }
  }
  if (maxMov < 0.01) return null;
  const limiar = maxMov * 0.01;
  const ok = new Set<number>();
  for (const [ano, mov] of porAno) {
    const dist = Math.abs(ano - anoPrincipal);
    if (dist <= 1 || mov >= limiar) ok.add(ano);
  }
  return ok;
}

/**
 * Meses com lançamento real no razão.
 * Se De/Até forem informados, só entra mês que tenha pelo menos um lançamento
 * cuja data (dia/mês/ano) caia dentro do intervalo — não basta o mês “tocar” o filtro.
 * Anos-fantasma de abertura (ex.: 2001 com SI/legado) são descartados quando o
 * movimento relevante está em outro ano.
 */
export function buildPeriodosMensaisFromRazao(
  razaoRows: VisionBalanceteRow[],
  dataDe?: string,
  dataAte?: string,
): PeriodoMensal[] {
  const deT = dataDe?.trim() ? dataLancamentoToTime(dataDe.trim()) : null;
  const ateT = dataAte?.trim() ? dataLancamentoToTime(dataAte.trim()) : null;
  const anosOk = anosRelevantesParaComparativo(razaoRows);

  const set = new Set<string>();
  for (const r of razaoRows) {
    if (!rowTemLancamento(r)) continue;
    const d = r.data?.trim();
    if (!d) continue;
    const t = dataLancamentoToTime(d);
    if (t === null) continue;
    // Filtro por dia/mês/ano do lançamento (não por sobreposição do mês civil)
    if (deT !== null && t < deT) continue;
    if (ateT !== null && t > ateT) continue;
    const key = parseDataBrToKey(d);
    if (!key) continue;
    if (anosOk && !anosOk.has(key.year)) continue;
    set.add(`${String(key.month).padStart(2, '0')}/${key.year}`);
  }

  const ordered = [...set].sort((a, b) => {
    const [ma, ya] = a.split('/').map((v) => parseInt(v, 10));
    const [mb, yb] = b.split('/').map((v) => parseInt(v, 10));
    if (ya !== yb) return ya - yb;
    return ma - mb;
  });

  return ordered.map((mmYyyy) => periodoFromLabel(mmYyyy));
}

function periodoFromLabel(mmYyyy: string): PeriodoMensal {
  const [mm, yyyy] = mmYyyy.split('/');
  const start = `01/${mm}/${yyyy}`;
  const endDate = new Date(parseInt(yyyy, 10), parseInt(mm, 10), 0).getDate();
  const end = `${String(endDate).padStart(2, '0')}/${mm}/${yyyy}`;
  return { label: mmYyyy, de: start, ate: end };
}

/** True se o razão tem pelo menos 1 lançamento (D ou C) com data naquele mês/ano. */
export function periodoTemLancamentoNoRazao(
  periodo: PeriodoMensal,
  razaoRows: VisionBalanceteRow[],
  dataDe?: string,
  dataAte?: string,
): boolean {
  const deT = dataDe?.trim() ? dataLancamentoToTime(dataDe.trim()) : null;
  const ateT = dataAte?.trim() ? dataLancamentoToTime(dataAte.trim()) : null;
  const anosOk = anosRelevantesParaComparativo(razaoRows);
  const [mm, yyyy] = periodo.label.split('/');
  const mes = parseInt(mm, 10);
  const ano = parseInt(yyyy, 10);
  if (anosOk && !anosOk.has(ano)) return false;

  for (const r of razaoRows) {
    if (!rowTemLancamento(r)) continue;
    const d = r.data?.trim();
    if (!d) continue;
    const key = parseDataBrToKey(d);
    if (!key || key.month !== mes || key.year !== ano) continue;
    const t = dataLancamentoToTime(d);
    if (t === null) continue;
    if (deT !== null && t < deT) continue;
    if (ateT !== null && t > ateT) continue;
    return true;
  }
  return false;
}

/**
 * Remove qualquer coluna cujo mês/ano não tenha lançamento real no razão
 * (data da respectiva coluna). Fonte da verdade do comparativo de movimento.
 */
export function filtrarPeriodosComLancamentoNoRazao(
  periodos: PeriodoMensal[],
  razaoRows: VisionBalanceteRow[],
  dataDe?: string,
  dataAte?: string,
): PeriodoMensal[] {
  if (!periodos.length) return [];
  return periodos.filter((p) => periodoTemLancamentoNoRazao(p, razaoRows, dataDe, dataAte));
}

/**
 * Meses do comparativo: só meses com lançamento cuja data (dia/mês/ano)
 * está dentro do De/Até e tem D ou C > 0.
 *
 * Ex.: De=15/06/2026 e Até=20/06/2026 — só mostra 06/2026 se existir lançamento
 * entre esses dias; lançamento em 01/06/2026 não gera a coluna.
 * Ex.: De=2001 e Até=2029, movimento só em 2026 → só colunas de 2026.
 */
export function buildPeriodosMensaisEntreDatas(
  dataDe: string | undefined,
  dataAte: string | undefined,
  razaoRows: VisionBalanceteRow[],
): PeriodoMensal[] {
  return buildPeriodosMensaisFromRazao(razaoRows, dataDe, dataAte);
}

function parseDetalheValor(raw: string | undefined): number {
  if (!raw) return 0;
  const t = raw.trim();
  if (!t || t === '—' || t === '-') return 0;
  return valorMovimento(t);
}

function detalheTemDebitoOuCredito(det: DetalheMesComparativo | undefined): boolean {
  if (!det) return false;
  return parseDetalheValor(det.deb) >= 0.01 || parseDetalheValor(det.cred) >= 0.01;
}

/**
 * Remove meses sem D/C real nas linhas montadas.
 * SI sozinho (ou traço) NÃO mantém a coluna.
 */
export function filtrarPeriodosComMovimentoNasLinhas(
  periodos: PeriodoMensal[],
  linhas: LinhaComparativoMensal[],
): PeriodoMensal[] {
  if (!periodos.length) return [];
  if (!linhas.length) return [];
  return periodos.filter((p) => {
    let totalDc = 0;
    for (const l of linhas) {
      const det = l.detalhePorMes[p.label];
      if (!detalheTemDebitoOuCredito(det)) continue;
      totalDc += parseDetalheValor(det?.deb) + parseDetalheValor(det?.cred);
      if (totalDc >= 0.01) return true;
    }
    return false;
  });
}

/** Mesma chave usada em montarBalanceteComPeriodo (razaoContabil) — via `normCls`,
 * para que uma conta grafada de formas diferentes entre importações (ex.:
 * "1.1.2.04.0006" vs "1.1.2.4.6") não fique com o saldo inicial "perdido" aqui
 * mesmo já casando na visão de período único. */
export function chaveContaComparativo(r: Pick<VisionBalanceteRow, 'codigo' | 'classificacao' | 'nome'>): string {
  const cls = normClsRazao(getClassificacao(r as VisionBalanceteRow).trim());
  if (cls) return `cls:${cls}`;
  const cod = (r.codigo ?? '').replace(/\D/g, '');
  return cod ? `cod:${cod}` : `nome:${(r.nome ?? '').toLowerCase()}`;
}

function saldoAssinado(row: VisionBalanceteRow, allRows: VisionBalanceteRow[]): number {
  const s = analisarSaldoContabil(row, allRows);
  return s.natureza === 'D' ? s.valor : -s.valor;
}

function fmtNum(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function detalheFromRow(row: VisionBalanceteRow, dataPadrao: string): DetalheMesComparativo {
  const siN = Math.abs(row.saldoInicial ?? 0);
  const natSi = row.naturezaSaldoInicial === 'C' ? 'C' : 'D';

  const debN = row.debito ?? 0;
  const credN = row.credito ?? 0;
  return {
    data: row.data?.trim() || dataPadrao,
    si: siN >= 0.01 ? `${fmtNum(siN)}${natSi}` : '—',
    deb: debN > 0 ? fmtNum(debN) : '—',
    cred: credN > 0 ? fmtNum(credN) : '—',
  };
}

/** Célula mensal com natureza inferida por CPC (movimento + SI/SF), não só coluna Domínio. */
export function celulaFromRowFast(
  row: VisionBalanceteRow,
  allRows: VisionBalanceteRow[] = [],
): SaldoMensalCelula {
  const rows = allRows.length > 0 ? allRows : [row];
  const enriched = enrichNaturezaSaldoImportado(row, rows);
  const analise = analisarSaldoContabil(enriched, rows);
  const valor = analise.valor;
  if (valor < 0.001) {
    return { valor: 0, natureza: analise.naturezaEsperada, texto: '—', invertido: false };
  }
  const fmt = valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return {
    valor,
    natureza: analise.natureza,
    texto: `${fmt}${analise.natureza}`,
    invertido: analise.invertido,
  };
}

type MontarComparativoParams = {
  razaoRows: VisionBalanceteRow[];
  planoRows: VisionPlanoRow[];
  periodos?: PeriodoMensal[];
  dataDe?: string;
  dataAte?: string;
  incluirPlanoCompleto?: boolean;
  somenteComMovimento?: boolean;
  /** Entre cada mês processado, cede a UI (uso interno async). */
  yieldEntreMeses?: () => Promise<void>;
  onProgress?: (mesAtual: number, totalMeses: number) => void;
  /** Overrides manuais de natureza (Balancete) — repassados explicitamente porque
   *  este cálculo pode rodar dentro de um Web Worker, que não compartilha o estado
   *  de módulo com a thread principal. */
  naturezaManualEntries?: NaturezaManualEntry[];
};

function seedLinhaVazia(p: VisionPlanoRow): LinhaComparativoMensal {
  const key = `cls:${p.codigo.replace(/\./g, '')}`;
  const nat = naturezaHeuristica(p.codigo, p.nome);
  return {
    chave: key,
    codigo: p.codigoReduzido ?? p.codigo,
    classificacao: p.codigo,
    nome: p.nome,
    tipo: p.tipo,
    saldosPorMes: {},
    detalhePorMes: {},
    naturezaCodigo: nat.codigo,
    naturezaLabel: nat.label,
  };
}

export function naturezaHeuristica(classificacao: string, nome?: string): { codigo: 'D' | 'C'; label: string } {
  const manual = resolveNaturezaManual({ classificacao, nome });
  if (manual) return { codigo: manual, label: manual === 'D' ? 'Devedora' : 'Credora' };
  const root = classificacao.replace(/\./g, '').trim()[0];
  switch (root) {
    case '1':
      return { codigo: 'D', label: 'Ativo' };
    case '2':
      return { codigo: 'C', label: 'Passivo' };
    case '3':
      return { codigo: 'D', label: 'Despesa' };
    case '4':
      return { codigo: 'C', label: 'Receita / PL' };
    default:
      return { codigo: 'D', label: 'Conta' };
  }
}

/** Mesmo pipeline do balancete mensal: analíticas + sintéticas do plano. */
function registrarBalanceteMesNoMap(
  map: Map<string, LinhaComparativoMensal>,
  balancete: VisionBalanceteRow[],
  labelMes: string,
  dataPadrao: string,
) {
  for (const r of balancete) {
    const key = chaveContaComparativo(r);
    const cls = getClassificacao(r);
    const nat = formatNaturezaConta(r, balancete);

    if (!map.has(key)) {
      map.set(key, {
        chave: key,
        codigo: r.codigo ?? '',
        classificacao: cls,
        nome: r.nome ?? '',
        tipo: r.tipo,
        saldosPorMes: {},
        detalhePorMes: {},
        naturezaCodigo: nat.codigo,
        naturezaLabel: nat.label,
      });
    }

    const linha = map.get(key)!;
    if (r.codigo) linha.codigo = r.codigo;
    if (r.nome) linha.nome = r.nome;
    if (r.tipo) linha.tipo = r.tipo;
    if (cls) linha.classificacao = cls;
    linha.naturezaCodigo = nat.codigo;
    linha.naturezaLabel = nat.label;
    linha.saldosPorMes[labelMes] = celulaFromRowFast(r, balancete);
    /**
     * O SI vem do balancete DESTE mês — que já é o saldo acumulado até `p.de`,
     * ou seja, o saldo final do mês anterior. Antes um mapa global de "SI
     * original" (a linha SALDO ANTERIOR do razão inteiro) sobrescrevia o SI de
     * TODOS os meses, então 05/2026 repetia o SI de 04/2026 em vez de herdar o
     * SF. O saldo final da célula nunca passou por esse mapa — por isso só o SI
     * ficava errado, e o modal do Razão da conta mostrava o valor certo.
     */
    linha.detalhePorMes[labelMes] = detalheFromRow(r, dataPadrao);
  }
}

/** Ordem idêntica ao balancete (plano: sintéticas antes das analíticas filhas). */
function ordenarLinhasPeloBalancete(
  linhas: LinhaComparativoMensal[],
  balanceteReferencia: VisionBalanceteRow[],
): LinhaComparativoMensal[] {
  const posicao = new Map<string, number>();
  balanceteReferencia.forEach((r, idx) => {
    const k = chaveContaComparativo(r);
    if (!posicao.has(k)) posicao.set(k, idx);
  });

  return [...linhas].sort((a, b) => {
    const pa = posicao.get(a.chave);
    const pb = posicao.get(b.chave);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1;
    if (pb !== undefined) return 1;
    const diff = compareClassificacaoContabil(a.classificacao || a.codigo, b.classificacao || b.codigo);
    if (diff !== 0) return diff;
    return (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR');
  });
}

function buildMontarBalanceteCtx(
  razaoRows: VisionBalanceteRow[],
  planoRows: VisionPlanoRow[],
): MontarBalanceteCtx {
  const ctx: MontarBalanceteCtx = {};
  if (planoRows.length > 0) ctx.planoLookup = buildPlanoLookup(planoRows);
  if (shouldIndexRazao(razaoRows.length)) ctx.razaoIndex = buildRazaoTimeIndex(razaoRows);
  return ctx;
}

function montarBalanceteReferenciaOrdenacao(
  razaoRows: VisionBalanceteRow[],
  planoRows: VisionPlanoRow[],
  periodos: PeriodoMensal[],
  ctx: MontarBalanceteCtx,
): VisionBalanceteRow[] {
  if (!periodos.length) return [];
  const primeiro = periodos[0];
  const ultimo = periodos[periodos.length - 1];
  const razaoPeriodo = filtrarRazaoPorPeriodo(razaoRows, primeiro.de, ultimo.ate, ctx.razaoIndex);
  return montarBalanceteComPeriodo(razaoRows, razaoPeriodo, planoRows, primeiro.de, ultimo.ate, ctx);
}

function processarMesComparativo(
  map: Map<string, LinhaComparativoMensal>,
  razaoRows: VisionBalanceteRow[],
  planoRows: VisionPlanoRow[],
  p: PeriodoMensal,
  ctx: MontarBalanceteCtx,
) {
  const razaoPeriodo = filtrarRazaoPorPeriodo(razaoRows, p.de, p.ate, ctx.razaoIndex);
  const balancete = montarBalanceteComPeriodo(razaoRows, razaoPeriodo, planoRows, p.de, p.ate, ctx);
  registrarBalanceteMesNoMap(map, balancete, p.label, p.de);
}

function finalizarLinhasComparativo(
  map: Map<string, LinhaComparativoMensal>,
  somenteComMovimento: boolean | undefined,
  balanceteReferencia: VisionBalanceteRow[],
): LinhaComparativoMensal[] {
  let linhas = ordenarLinhasPeloBalancete([...map.values()], balanceteReferencia);
  if (somenteComMovimento !== false) {
    linhas = linhas.filter(linhaTemMovimentoNoPeriodo);
  }
  return linhas;
}

/**
 * Colunas do comparativo: SEMPRE só meses com D/C real no razão (data do lançamento).
 * `params.periodos` (se vier) é só um limite — nunca cria mês sem lançamento.
 */
function resolverPeriodosComparativo(params: MontarComparativoParams): PeriodoMensal[] {
  const doRazao = buildPeriodosMensaisEntreDatas(params.dataDe, params.dataAte, params.razaoRows);
  if (!params.periodos?.length) return doRazao;
  const permitidos = new Set(doRazao.map((p) => p.label));
  return params.periodos.filter((p) => permitidos.has(p.label));
}

/**
 * Um balancete por mês (igual à aba Balancete): contas analíticas e sintéticas.
 */
export function montarComparativoMensalOtimizado(
  params: MontarComparativoParams & {
    onProgress?: (mesAtual: number, totalMeses: number) => void;
  },
): { periodos: PeriodoMensal[]; linhas: LinhaComparativoMensal[] } {
  setActiveNaturezaManualEntries(params.naturezaManualEntries);
  const periodos = resolverPeriodosComparativo(params);

  const map = new Map<string, LinhaComparativoMensal>();
  const ctx = buildMontarBalanceteCtx(params.razaoRows, params.planoRows);

  if (params.incluirPlanoCompleto) {
    for (const p of params.planoRows) {
      const key = `cls:${p.codigo.replace(/\./g, '')}`;
      if (!map.has(key)) map.set(key, seedLinhaVazia(p));
    }
  }

  for (let mi = 0; mi < periodos.length; mi++) {
    const p = periodos[mi];
    params.onProgress?.(mi + 1, periodos.length);
    processarMesComparativo(map, params.razaoRows, params.planoRows, p, ctx);
  }

  const balanceteOrdem = montarBalanceteReferenciaOrdenacao(
    params.razaoRows,
    params.planoRows,
    periodos,
    ctx,
  );
  const linhas = finalizarLinhasComparativo(map, params.somenteComMovimento, balanceteOrdem);
  return {
    periodos: filtrarPeriodosComMovimentoNasLinhas(periodos, linhas),
    linhas,
  };
}

/** Cede à UI entre cada mês processado. */
export async function montarComparativoMensalOtimizadoAsync(
  params: MontarComparativoParams,
): Promise<{ periodos: PeriodoMensal[]; linhas: LinhaComparativoMensal[] }> {
  setActiveNaturezaManualEntries(params.naturezaManualEntries);
  const periodos = resolverPeriodosComparativo(params);

  const map = new Map<string, LinhaComparativoMensal>();
  const ctx = buildMontarBalanceteCtx(params.razaoRows, params.planoRows);

  if (params.incluirPlanoCompleto) {
    for (const p of params.planoRows) {
      const key = `cls:${p.codigo.replace(/\./g, '')}`;
      if (!map.has(key)) map.set(key, seedLinhaVazia(p));
    }
  }

  for (let mi = 0; mi < periodos.length; mi++) {
    const p = periodos[mi];
    processarMesComparativo(map, params.razaoRows, params.planoRows, p, ctx);

    params.onProgress?.(mi + 1, periodos.length);
    if (params.yieldEntreMeses) {
      await params.yieldEntreMeses();
    }
  }

  const balanceteOrdem = montarBalanceteReferenciaOrdenacao(
    params.razaoRows,
    params.planoRows,
    periodos,
    ctx,
  );
  const linhas = finalizarLinhasComparativo(map, params.somenteComMovimento, balanceteOrdem);
  return {
    periodos: filtrarPeriodosComMovimentoNasLinhas(periodos, linhas),
    linhas,
  };
}

export async function montarComparativoMensalAsync(
  params: MontarComparativoParams,
): Promise<{ periodos: PeriodoMensal[]; linhas: LinhaComparativoMensal[] }> {
  return montarComparativoMensalOtimizadoAsync(params);
}

/** Versão síncrona (evitar na UI — prefira montarComparativoMensalAsync). */
export function montarComparativoMensal(
  params: Omit<MontarComparativoParams, 'yieldEntreMeses'>,
): { periodos: PeriodoMensal[]; linhas: LinhaComparativoMensal[] } {
  return montarComparativoMensalOtimizado(params);
}

/** Interpreta "1.234,56D", "1234.56 C", etc. */
/** Saldo final da conta no mês (balancete do período), para conferência após lançamentos. */
export function celulaSaldoContaNoMes(
  linha: LinhaComparativoMensal,
  periodo: PeriodoMensal,
  razaoRows: VisionBalanceteRow[],
  planoRows: VisionPlanoRow[],
): SaldoMensalCelula | null {
  const razaoPeriodo = filtrarRazaoPorPeriodo(razaoRows, periodo.de, periodo.ate);
  const balancete = montarBalanceteComPeriodo(
    razaoRows,
    razaoPeriodo,
    planoRows,
    periodo.de,
    periodo.ate,
  );
  const row = balancete.find((r) => chaveContaComparativo(r) === linha.chave);
  if (!row) return null;
  const cel = celulaFromRowFast(row, balancete);
  return cel.valor < 0.001 ? null : cel;
}

export function parseSaldoEsperadoInput(raw: string): { valor: number; natureza: 'D' | 'C' } | null {
  const t = raw.trim().replace(/\s+/g, '');
  if (!t) return null;
  const natMatch = t.match(/([DC])$/i);
  const natureza: 'D' | 'C' = natMatch && natMatch[1].toUpperCase() === 'C' ? 'C' : 'D';
  const numPart = natMatch ? t.slice(0, -1) : t;
  const normalized = numPart.replace(/\./g, '').replace(',', '.');
  const valor = Math.abs(parseFloat(normalized));
  if (!Number.isFinite(valor)) return null;
  return { valor, natureza };
}

function isContaProvisao(row: Pick<VisionBalanceteRow, 'nome'>): boolean {
  return /provis(?:ã|a)o|prov\./i.test(row.nome ?? '');
}

function normCls(cls: string): string {
  return cls.replace(/\./g, '').replace(/\s/g, '');
}

function contasRelacionadas(
  row: VisionBalanceteRow,
  balancete: VisionBalanceteRow[],
): VisionBalanceteRow[] {
  const cls = normCls(getClassificacao(row));
  if (!cls) return [row];
  return balancete.filter((r) => {
    const c = normCls(getClassificacao(r));
    return c === cls || c.startsWith(cls) || cls.startsWith(c);
  });
}

function analisarProvisao(
  row: VisionBalanceteRow,
  balanceteMes: VisionBalanceteRow[],
  diferenca: number,
): { erroProvisao: boolean; mensagens: string[] } {
  const mensagens: string[] = [];
  const relacionadas = contasRelacionadas(row, balanceteMes);
  const provisoes = relacionadas.filter((r) => isContaProvisao(r));
  const passivos = relacionadas.filter((r) => isContaPassivoPorNome(r) && !isContaProvisao(r));

  if (provisoes.length === 0 && !isContaProvisao(row)) {
    return { erroProvisao: false, mensagens };
  }

  const alvo = isContaProvisao(row) ? [row, ...provisoes] : provisoes;
  const somaProv = alvo.reduce((s, r) => s + saldoAssinado(r, balanceteMes), 0);
  const somaPassivo = passivos.reduce((s, r) => s + saldoAssinado(r, balanceteMes), 0);

  for (const p of alvo) {
    const a = analisarSaldoContabil(p, balanceteMes);
    if (a.invertido) {
      mensagens.push(
        `Provisão "${p.nome}" com natureza invertida (saldo ${a.natureza}, esperado ${a.naturezaEsperada}).`,
      );
    }
  }

  if (passivos.length > 0 && Math.abs(somaProv + somaPassivo) > 0.05) {
    mensagens.push(
      `Provisões (${somaProv.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}) não fecham com obrigações relacionadas (${somaPassivo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}).`,
    );
  }

  const tol = Math.max(0.05, Math.abs(diferenca) * 0.01);
  const erroProvisao =
    mensagens.length > 0 ||
    (isContaProvisao(row) && Math.abs(somaProv - Math.abs(diferenca)) < tol && mensagens.length > 0);

  return { erroProvisao: mensagens.length > 0, mensagens };
}

function buscarLancamentosNoPeriodo(
  razaoRows: VisionBalanceteRow[],
  periodo: PeriodoMensal,
  row: VisionBalanceteRow,
  valorAlvo: number,
): Array<{
  data: string;
  codigo: string;
  classificacao: string;
  nome: string;
  debito: number;
  credito: number;
}> {
  const tol = Math.max(0.05, Math.abs(valorAlvo) * 0.001);
  const cls = normCls(getClassificacao(row));
  const noPeriodo = filtrarRazaoPorPeriodo(razaoRows, periodo.de, periodo.ate);

  const candidatos = noPeriodo.filter((r) => {
    const c = normCls(getClassificacao(r));
    const mesmoGrupo = cls && c && (c === cls || c.startsWith(cls) || cls.startsWith(c));
    if (!mesmoGrupo && r.nome !== row.nome) return false;
    const mov = Math.max(r.debito ?? 0, r.credito ?? 0);
    return Math.abs(mov - Math.abs(valorAlvo)) <= tol;
  });

  return candidatos
    .sort((a, b) => compareDataRazao(a.data, b.data))
    .slice(0, 8)
    .map((r) => ({
      data: r.data ?? '',
      codigo: r.codigo ?? '',
      classificacao: getClassificacao(r),
      nome: r.nome ?? '',
      debito: r.debito ?? 0,
      credito: r.credito ?? 0,
    }));
}

export function analisarSaldoEsperadoConta(params: {
  row: LinhaComparativoMensal;
  saldoEsperadoRaw: string;
  mesRef: string;
  periodo: PeriodoMensal;
  razaoRows: VisionBalanceteRow[];
  planoRows: VisionPlanoRow[];
}): ResultadoAnaliseSaldoEsperado {
  const esperado = parseSaldoEsperadoInput(params.saldoEsperadoRaw);
  if (!esperado) {
    return { ok: false, mensagem: 'Informe o saldo esperado (ex.: 1.234,56D ou 500,00 C).', etapa: 'conferido' };
  }

  const celula = params.row.saldosPorMes[params.mesRef];
  if (!celula) {
    return {
      ok: false,
      mensagem: `Sem saldo no mês ${params.mesRef} para esta conta.`,
      etapa: 'conferido',
    };
  }

  const esperadoAssinado = esperado.natureza === 'D' ? esperado.valor : -esperado.valor;
  const atualAssinado = celula.natureza === 'D' ? celula.valor : -celula.valor;
  const diferenca = esperadoAssinado - atualAssinado;
  const difFmt = Math.abs(diferenca).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

  if (Math.abs(diferenca) < 0.05) {
    return {
      ok: true,
      mensagem: `Saldo conferido em ${params.mesRef} (${celula.texto}).`,
      etapa: 'conferido',
    };
  }

  const razaoPeriodo = filtrarRazaoPorPeriodo(params.razaoRows, params.periodo.de, params.periodo.ate);
  const balanceteMesRaw = montarBalanceteComPeriodo(
    params.razaoRows,
    razaoPeriodo,
    params.planoRows,
    params.periodo.de,
    params.periodo.ate,
  );
  const balanceteMes = balanceteMesRaw.map((r) => enrichNaturezaSaldoImportado(r, balanceteMesRaw));

  const rowBal = balanceteMes.find((r) => chaveContaComparativo(r) === params.row.chave);
  const prov = analisarProvisao(
    rowBal ?? {
      codigo: params.row.codigo,
      classificacao: params.row.classificacao,
      nome: params.row.nome,
      saldoInicial: 0,
      debito: 0,
      credito: 0,
      saldoFinal: 0,
    },
    balanceteMes,
    diferenca,
  );

  if (prov.mensagens.length > 0) {
    return {
      ok: false,
      mensagem: `Diferença de R$ ${difFmt} em ${params.mesRef}. Revisar provisão antes de buscar lançamentos.`,
      diferenca,
      diferencaFmt: difFmt,
      etapa: 'provisao',
      detalhes: prov.mensagens,
    };
  }

  const lancamentos = buscarLancamentosNoPeriodo(
    params.razaoRows,
    params.periodo,
    rowBal ?? {
      codigo: params.row.codigo,
      classificacao: params.row.classificacao,
      nome: params.row.nome,
      saldoInicial: 0,
      debito: 0,
      credito: 0,
      saldoFinal: 0,
    },
    diferenca,
  );

  if (lancamentos.length > 0) {
    return {
      ok: false,
      mensagem: `Diferença de R$ ${difFmt}. Possível origem no razão (${params.periodo.de} a ${params.periodo.ate}):`,
      diferenca,
      diferencaFmt: difFmt,
      etapa: 'razao',
      lancamentosSugeridos: lancamentos,
      detalhes: lancamentos.map(
        (l) =>
          `${l.data} · ${l.classificacao || l.codigo} · ${l.nome} · D ${l.debito.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} · C ${l.credito.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      ),
    };
  }

  return {
    ok: false,
    mensagem: `Não foi encontrado lançamento que explique a diferença de R$ ${difFmt} em ${params.mesRef} (${params.periodo.de} a ${params.periodo.ate}). Provisão sem inconsistência aparente.`,
    diferenca,
    diferencaFmt: difFmt,
    etapa: 'nao_encontrado',
    detalhes: [
      `Saldo no balancete: ${celula.texto}`,
      `Saldo esperado: ${esperado.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}${esperado.natureza}`,
    ],
  };
}
