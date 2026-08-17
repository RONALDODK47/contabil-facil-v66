import type { VisionBalanceteRow, VisionPlanoRow } from '../types/accounting';
import { getClassificacao } from './demonstracoesContabeis';
import {
  type LinhaComparativoMensal,
  type PeriodoMensal,
  type SaldoMensalCelula,
  celulaSaldoContaNoMes,
} from './balanceteComparativoMensal';
import { aplicarLancamentosNoRazao, corrigirSaldoEsperadoAutomatico } from './balanceteAutoCorrecao';
import { executarAutomatizacaoCaixaMutuo } from './balanceteAutomatizacaoCaixaMutuo';
import {
  deduplicarLinhasBanco,
  executarCicloGarantidaBanco,
  isContaBancoLinha,
  type ResultadoCicloGarantidaBanco,
} from './balanceteGarantidaBanco';
import {
  type AutomacaoContaConfig,
  type AutomacaoContaPapel,
  resolverContaAutomacao,
  resolverDataAutomacao,
  parseBrDateToIso,
} from './automatizacaoContaConfig';
import { executarEmprestimoEntreColigadas } from './balanceteAutomatizacaoColigadas';
import { executarLancamentoCustoPorFaturamento } from './balanceteCustoFaturamento';
import { detectFiscalImpostoKey, readFiscalContaMap, type FiscalContaMap } from './fiscalContaMapping';
import {
  gerarLancamentosComRegraReceitaFederal,
  impostoKeyComRegrasRf,
  readReceitaFederalRegras,
  sugerirClassificacaoPorRegraRf,
  type ReceitaFederalRegrasStore,
} from './receitaFederalRegras';
import { parseBrDateToTime } from './dateBounds';
import { enrichNaturezaSaldoImportado, isContaPassivoPorNome } from './naturezaContabil';
import { filtrarRazaoPorPeriodo, montarBalanceteComPeriodo } from './razaoContabil';
import { criarParLancamento, normalizarClassificacao, planoRowToBalanceteRow } from './balanceteLancamentos';

export type ContaCorrigidaResumo = {
  classificacao: string;
  codigo: string;
  /** Nome curto / legado. */
  nome: string;
  /** Descrição da conta no plano ou comparativo. */
  descricaoConta: string;
  tipoAcao: string;
  /** Meses (MM/AAAA) em que houve lançamento nesta conta. */
  mesesComLancamento: string[];
  qtdLancamentos: number;
  totalDebito: number;
  totalCredito: number;
};

/** Mês em que a automatização não gerou lançamento (com motivo). */
export type AdvertenciaMesSemLancamento = {
  mes: string;
  conta: string;
  classificacao: string;
  motivo: string;
  textoCompleto: string;
};

export type ProgressoAutomatizacao = {
  fase: 'folha_fiscal' | 'banco' | 'final';
  atual: number;
  total: number;
  mensagem: string;
};

export type OnProgressoAutomatizacao = (p: ProgressoAutomatizacao) => void;

export type ResultadoAutomatizacaoCompleta = {
  ok: boolean;
  mensagem: string;
  lancamentosGerados: VisionBalanceteRow[];
  cicloBanco: ResultadoCicloGarantidaBanco;
  /** Linhas de sucesso / andamento (não são erros). */
  detalhes: string[];
  /** Erros e avisos — exibidos no painel abaixo do Automatizar. */
  erros: string[];
  contasCorrigidas: ContaCorrigidaResumo[];
  /** Meses/contas em que não houve lançamento (erros e avisos operacionais). */
  advertencias: AdvertenciaMesSemLancamento[];
  relatorioFolhaUsado: boolean;
  relatorioFiscalUsado: boolean;
};

export function isDetalheErroAutomatizacao(texto: string): boolean {
  return /n[aã]o localizada|n[aã]o encontrada|ignorada|insuficiente|diverg[eê]ncia|sem conta cont[aá]bil|informe conta|falha|n[aã]o foi poss[ií]vel|nenhum ajuste/i.test(
    texto,
  );
}

function classificarAcaoHistorico(historico: string): string {
  const h = historico.toLowerCase();
  if (h.includes('utilizacao garantia') || h.includes('utilização garantia')) return 'Banco / Garantida — Utilização';
  if (h.includes('devolucao garantia') || h.includes('devolução garantia')) return 'Banco / Garantida — Devolução';
  if (h.includes('[auto folha]')) return 'Folha — Ajuste';
  if (h.includes('[auto fiscal]')) return 'Fiscal — Ajuste';
  if (h.includes('coligada') || h.includes('empréstimo coligada') || h.includes('emprestimo coligada'))
    return 'Empréstimo entre coligadas';
  if (h.includes('mútuo') || h.includes('mutuo') || h.includes('empréstimo') || h.includes('emprestimo'))
    return 'Mútuo / Empréstimo → Caixa';
  if (h.includes('custo') || h.includes('cmv') || h.includes('cpv')) return 'Custos';
  if (h.includes('recebimento cliente')) return 'Cliente → Caixa';
  if (h.includes('provisao') || h.includes('provisão')) return 'Provisão / Passivo';
  if (h.includes('pagamento') || h.includes('recebimento')) return 'Caixa / Pagamento';
  if (h.includes('ajuste saldo')) return 'Ajuste de saldo';
  return 'Correção automática';
}

function mesRefDeLancamento(l: VisionBalanceteRow): string | null {
  const hist = l.nome ?? '';
  const mHist = hist.match(/(\d{2}\/\d{4})/);
  if (mHist) return mHist[1];
  const data = (l.data ?? '').trim();
  const mData = data.match(/\d{2}\/(\d{2}\/\d{4})/);
  if (mData) return mData[1];
  const mDataIso = data.match(/^(\d{4})-(\d{2})/);
  if (mDataIso) return `${mDataIso[2]}/${mDataIso[1]}`;
  return null;
}

function buildMapDescricaoContas(
  linhasComparativo?: LinhaComparativoMensal[],
  planoRows?: VisionPlanoRow[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const linha of linhasComparativo ?? []) {
    const c = normCls(linha.classificacao ?? '');
    if (c) map.set(`cls:${c}`, linha.nome);
    const cod = (linha.codigo ?? '').replace(/\D/g, '');
    if (cod) map.set(`cod:${cod}`, linha.nome);
  }
  for (const p of planoRows ?? []) {
    const c = normCls(p.codigo ?? '');
    if (c && !map.has(`cls:${c}`)) map.set(`cls:${c}`, p.nome);
    const cod = (p.codigoReduzido ?? p.codigo ?? '').replace(/\D/g, '');
    if (cod && !map.has(`cod:${cod}`)) map.set(`cod:${cod}`, p.nome);
  }
  return map;
}

function resolverDescricaoConta(
  l: VisionBalanceteRow,
  mapNomes: Map<string, string>,
): string {
  const cls = getClassificacao(l);
  const c = normCls(cls);
  if (c && mapNomes.has(`cls:${c}`)) return mapNomes.get(`cls:${c}`)!;
  const cod = (l.codigo ?? '').replace(/\D/g, '');
  if (cod && mapNomes.has(`cod:${cod}`)) return mapNomes.get(`cod:${cod}`)!;
  const hist = l.nome ?? '';
  const mBanco = hist.match(/—\s*(.+)$/);
  if (mBanco) return mBanco[1].trim();
  const limpo = hist.replace(/\[Auto[^\]]*\]\s*/gi, '').trim();
  if (limpo && !/^utiliza|devolu|ajuste/i.test(limpo)) return limpo;
  return l.nome?.replace(/\[Auto[^\]]*\]\s*/gi, '').trim() || '—';
}

export function extrairContasCorrigidas(
  lancamentos: VisionBalanceteRow[],
  ctx?: { linhasComparativo?: LinhaComparativoMensal[]; planoRows?: VisionPlanoRow[] },
): ContaCorrigidaResumo[] {
  const mapNomes = buildMapDescricaoContas(ctx?.linhasComparativo, ctx?.planoRows);
  const map = new Map<string, ContaCorrigidaResumo>();

  for (const l of lancamentos) {
    const cls = getClassificacao(l);
    const key = cls || l.codigo || (l.nome ?? '').toLowerCase();
    const descricaoConta = resolverDescricaoConta(l, mapNomes);
    const mesRef = mesRefDeLancamento(l);
    const prev = map.get(key) ?? {
      classificacao: cls,
      codigo: l.codigo ?? '',
      nome: descricaoConta,
      descricaoConta,
      tipoAcao: classificarAcaoHistorico(l.nome ?? ''),
      mesesComLancamento: [],
      qtdLancamentos: 0,
      totalDebito: 0,
      totalCredito: 0,
    };
    if (mesRef && !prev.mesesComLancamento.includes(mesRef)) {
      prev.mesesComLancamento.push(mesRef);
    }
    prev.qtdLancamentos += 1;
    prev.totalDebito += l.debito ?? 0;
    prev.totalCredito += l.credito ?? 0;
    if (descricaoConta !== '—' && prev.descricaoConta === '—') {
      prev.descricaoConta = descricaoConta;
      prev.nome = descricaoConta;
    }
    map.set(key, prev);
  }

  return [...map.values()]
    .map((c) => ({
      ...c,
      mesesComLancamento: [...c.mesesComLancamento].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    }))
    .sort((a, b) => (a.classificacao || a.codigo).localeCompare(b.classificacao || b.codigo, 'pt-BR'));
}

function extrairClassificacaoDoTexto(texto: string): string {
  const m = texto.match(/\(([0-9][\d.]+)\)/);
  return m ? m[1] : '';
}

/** Linhas de log que indicam mês sem lançamento ou não processado. */
export function isAdvertenciaMesSemLancamento(texto: string): boolean {
  return (
    isDetalheErroAutomatizacao(texto) ||
    /sem saldo credor|sem movimento|n[aã]o gerou lan[cç]amento|pr[oó]ximo m[eê]s\/conta|sem lan[cç]amento|nada lan[cç]ado|abaixo do m[ií]nimo/i.test(
      texto,
    )
  );
}

export function extrairAdvertenciasMes(linhas: string[]): AdvertenciaMesSemLancamento[] {
  const out: AdvertenciaMesSemLancamento[] = [];

  for (const textoCompleto of linhas) {
    if (!isAdvertenciaMesSemLancamento(textoCompleto)) continue;

    let mes = '';
    let conta = '';
    let motivo = textoCompleto;

    const mContaMes = textoCompleto.match(/^(.+?)\s*·\s*(\d{2}\/\d{4})\s*:\s*(.+)$/);
    if (mContaMes) {
      conta = mContaMes[1].trim();
      mes = mContaMes[2];
      motivo = mContaMes[3].trim();
    } else {
      const mMesOrigem = textoCompleto.match(/^(\d{2}\/\d{4})\s*·\s*(.+?)\s*:\s*(.+)$/);
      if (mMesOrigem) {
        mes = mMesOrigem[1];
        conta = mMesOrigem[2].trim();
        motivo = mMesOrigem[3].trim();
      } else {
        const mMes = textoCompleto.match(/(\d{2}\/\d{4})/);
        if (mMes) mes = mMes[1];
      }
    }

    const classificacao = extrairClassificacaoDoTexto(textoCompleto);

    out.push({
      mes: mes || '—',
      conta: conta || '—',
      classificacao,
      motivo,
      textoCompleto,
    });
  }

  const seen = new Set<string>();
  return out.filter((a) => {
    const k = `${a.mes}|${a.conta}|${a.motivo}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function separarErrosEDetalhes(linhas: string[]): { erros: string[]; detalhes: string[] } {
  const erros: string[] = [];
  const detalhes: string[] = [];
  for (const linha of linhas) {
    if (isDetalheErroAutomatizacao(linha)) erros.push(linha);
    else detalhes.push(linha);
  }
  return { erros, detalhes };
}

const normCls = normalizarClassificacao;

function chaveConta(r: Pick<VisionBalanceteRow, 'codigo' | 'classificacao' | 'nome'>): string {
  const cls = normCls(getClassificacao(r as VisionBalanceteRow));
  if (cls) return `cls:${cls}`;
  const cod = (r.codigo ?? '').replace(/\D/g, '');
  return cod ? `cod:${cod}` : `nome:${(r.nome ?? '').toLowerCase()}`;
}

function normDesc(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function dataNoPeriodo(data: string | undefined, periodo: PeriodoMensal): boolean {
  if (!data?.trim()) return true;
  const t = parseBrDateToTime(data);
  const deT = parseBrDateToTime(periodo.de);
  const ateT = parseBrDateToTime(periodo.ate);
  if (t === null || deT === null || ateT === null) return true;
  return t >= deT && t <= ateT;
}

const planoParaRow = planoRowToBalanceteRow;

function mapearLinhaRelatorioParaConta(
  linha: VisionBalanceteRow,
  balanceteMes: VisionBalanceteRow[],
  planoRows: VisionPlanoRow[],
  fiscalMap: FiscalContaMap,
  origem: 'folha' | 'fiscal',
  receitaFederalStore?: ReceitaFederalRegrasStore,
): VisionBalanceteRow | null {
  const clsLinha = normCls(getClassificacao(linha));
  if (clsLinha) {
    const noBal = balanceteMes.find((r) => r.tipo !== 'S' && normCls(getClassificacao(r)) === clsLinha);
    if (noBal) return noBal;
    const noPlano = planoRows.find((p) => p.tipo === 'A' && normCls(p.codigo) === clsLinha);
    if (noPlano) return planoParaRow(noPlano);
  }

  if (origem === 'fiscal') {
    const impKey = receitaFederalStore
      ? impostoKeyComRegrasRf(linha.nome ?? '', receitaFederalStore)
      : detectFiscalImpostoKey(linha.nome ?? '');
    const clsSugerida =
      receitaFederalStore &&
      sugerirClassificacaoPorRegraRf(linha, balanceteMes, planoRows, fiscalMap, receitaFederalStore);
    if (clsSugerida) {
      const c = normCls(clsSugerida);
      const noBal = balanceteMes.find((r) => r.tipo !== 'S' && normCls(getClassificacao(r)) === c);
      if (noBal) return noBal;
      const noPlano = planoRows.find((p) => p.tipo === 'A' && normCls(p.codigo) === c);
      if (noPlano) return planoParaRow(noPlano);
    }
    const clsMap = fiscalMap[impKey];
    if (clsMap) {
      const c = normCls(clsMap);
      const noBal = balanceteMes.find((r) => r.tipo !== 'S' && normCls(getClassificacao(r)) === c);
      if (noBal) return noBal;
      const noPlano = planoRows.find((p) => p.tipo === 'A' && normCls(p.codigo) === c);
      if (noPlano) return planoParaRow(noPlano);
    }
  }

  const nome = normDesc(linha.nome ?? '');
  const tokens = nome.split(/\s+/).filter((t) => t.length > 3);
  if (!tokens.length) return null;

  let melhor: VisionBalanceteRow | null = null;
  let melhorScore = 0;

  const candidatos = [
    ...balanceteMes.filter((r) => r.tipo !== 'S'),
    ...planoRows.filter((p) => p.tipo === 'A').map(planoParaRow),
  ];

  for (const c of candidatos) {
    const cn = normDesc(c.nome ?? '');
    const score = tokens.reduce((s, t) => (cn.includes(t) ? s + 1 : s), 0);
    if (score > melhorScore && score >= 2) {
      melhorScore = score;
      melhor = c;
    }
  }

  return melhor;
}

function parLancamento(
  conta: VisionBalanceteRow,
  contrapartida: VisionBalanceteRow,
  debito: number,
  credito: number,
  data: string,
  historico: string,
  ordem: number,
): VisionBalanceteRow[] {
  const importId = `folha-fiscal-auto:${chaveConta(conta)}|${chaveConta(contrapartida)}|${historico}|${data}`;
  return criarParLancamento({
    contaDeb: conta,
    contaCred: contrapartida,
    valor: debito || credito,
    data,
    historico,
    ordem,
    importId,
  });
}

const CUSTO_PAPEIS_FALLBACK: AutomacaoContaPapel[] = ['custo_cmv', 'custo_cpv', 'custo_servicos', 'custos'];

function escolherDespesaFolhaFiscal(
  balanceteMes: VisionBalanceteRow[],
  planoRows: VisionPlanoRow[],
  origem: 'folha' | 'fiscal',
  contaConfig?: AutomacaoContaConfig,
): VisionBalanceteRow | null {
  for (const papel of CUSTO_PAPEIS_FALLBACK) {
    const cfgCusto = resolverContaAutomacao(papel, contaConfig ?? {}, planoRows, balanceteMes, 'debito');
    if (cfgCusto) return cfgCusto;
  }
  const cfg = resolverContaAutomacao('despesa_ajuste', contaConfig ?? {}, planoRows, balanceteMes);
  if (cfg) return cfg;

  const predFolha = (r: VisionBalanceteRow) => {
    const cls = normCls(getClassificacao(r));
    const n = (r.nome ?? '').toLowerCase();
    return /^4/.test(cls) || /sal[aá]rio|folha|encargo|prov/i.test(n);
  };
  const predFiscal = (r: VisionBalanceteRow) => {
    const cls = normCls(getClassificacao(r));
    const n = (r.nome ?? '').toLowerCase();
    return /^4/.test(cls) || /imposto|tribut|despesa/i.test(n);
  };
  const pred = origem === 'folha' ? predFolha : predFiscal;

  const analiticas = balanceteMes.filter((r) => r.tipo !== 'S' && pred(r));
  if (analiticas.length) return analiticas[0];

  const p = planoRows.find((x) => x.tipo === 'A' && pred(planoParaRow(x)));
  return p ? planoParaRow(p) : null;
}

function lancamentoJaNoRazao(linha: VisionBalanceteRow, razaoPeriodo: VisionBalanceteRow[]): boolean {
  const valor = Math.max(linha.debito ?? 0, linha.credito ?? 0);
  if (valor < 0.05) return true;
  const frag = normDesc(linha.nome ?? '').slice(0, 14);
  return razaoPeriodo.some((r) => {
    const v2 = Math.max(r.debito ?? 0, r.credito ?? 0);
    if (Math.abs(v2 - valor) > 0.05) return false;
    const n2 = normDesc(r.nome ?? '');
    return frag.length >= 6 && n2.includes(frag);
  });
}

function gerarLancamentosDaLinhaRelatorio(
  linha: VisionBalanceteRow,
  contaAlvo: VisionBalanceteRow,
  balanceteMes: VisionBalanceteRow[],
  planoRows: VisionPlanoRow[],
  periodo: PeriodoMensal,
  origem: 'folha' | 'fiscal',
  ordem: number,
  contaConfig?: AutomacaoContaConfig,
  receitaFederalStore?: ReceitaFederalRegrasStore,
  fiscalMap?: FiscalContaMap,
): VisionBalanceteRow[] {
  if (receitaFederalStore) {
    const { lancamentos } = gerarLancamentosComRegraReceitaFederal({
      linha,
      contaAlvo,
      balanceteMes,
      planoRows,
      periodo,
      origem,
      ordem,
      store: receitaFederalStore,
      fiscalContaMap: fiscalMap,
      contaConfig,
    });
    if (lancamentos.length) return lancamentos;
  }

  const data = linha.data?.trim() || resolverDataAutomacao(periodo, contaConfig);
  const hist = `[Auto ${origem}] ${linha.nome}`;
  const deb = linha.debito ?? 0;
  const cred = linha.credito ?? 0;

  if (cred >= 0.05 && deb < 0.05) {
    const despesa = escolherDespesaFolhaFiscal(balanceteMes, planoRows, origem, contaConfig);
    if (!despesa) return [];
    return parLancamento(despesa, contaAlvo, cred, cred, data, hist, ordem);
  }
  if (deb >= 0.05 && cred < 0.05) {
    const despesa = escolherDespesaFolhaFiscal(balanceteMes, planoRows, origem, contaConfig);
    if (!despesa) return [];
    return parLancamento(contaAlvo, despesa, deb, deb, data, hist, ordem);
  }
  return [];
}

type AggRelatorio = {
  credito: number;
  debito: number;
  origens: string[];
};

function agregarRelatoriosNoMes(
  folhaRows: VisionBalanceteRow[],
  fiscalRows: VisionBalanceteRow[],
  periodo: PeriodoMensal,
  balanceteMes: VisionBalanceteRow[],
  planoRows: VisionPlanoRow[],
  fiscalMap: FiscalContaMap,
): Map<string, AggRelatorio> {
  const map = new Map<string, AggRelatorio>();

  const processar = (rows: VisionBalanceteRow[], origem: 'folha' | 'fiscal') => {
    for (const linha of rows) {
      if (!dataNoPeriodo(linha.data, periodo)) continue;
      const conta = mapearLinhaRelatorioParaConta(linha, balanceteMes, planoRows, fiscalMap, origem);
      if (!conta) continue;
      const chave = chaveConta(conta);
      const prev = map.get(chave) ?? { credito: 0, debito: 0, origens: [] };
      prev.credito += linha.credito ?? 0;
      prev.debito += linha.debito ?? 0;
      prev.origens.push(`${origem}: ${linha.nome}`);
      map.set(chave, prev);
    }
  };

  processar(folhaRows, 'folha');
  processar(fiscalRows, 'fiscal');
  return map;
}

function formatEsperadoRaw(valor: number, natureza: 'D' | 'C'): string {
  return `${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${natureza}`;
}

function linhaComparativoMinima(
  row: VisionBalanceteRow,
  saldosPorMes: Record<string, SaldoMensalCelula | null>,
): LinhaComparativoMensal {
  return {
    chave: chaveConta(row),
    codigo: row.codigo ?? '',
    classificacao: getClassificacao(row),
    nome: row.nome ?? '',
    tipo: row.tipo ?? 'A',
    saldosPorMes,
    detalhePorMes: {},
  };
}

function sincronizarRelatoriosNoRazao(params: {
  razaoRows: VisionBalanceteRow[];
  planoRows: VisionPlanoRow[];
  periodos: PeriodoMensal[];
  folhaRows: VisionBalanceteRow[];
  fiscalRows: VisionBalanceteRow[];
  fiscalContaMap: FiscalContaMap;
  linhasComparativo: LinhaComparativoMensal[];
  ordemInicial: number;
  contaConfig?: AutomacaoContaConfig;
  receitaFederalStore?: ReceitaFederalRegrasStore;
  onProgress?: OnProgressoAutomatizacao;
}): { razao: VisionBalanceteRow[]; lancamentos: VisionBalanceteRow[]; detalhes: string[] } {
  const {
    planoRows,
    periodos,
    folhaRows,
    fiscalRows,
    fiscalContaMap,
    linhasComparativo,
    contaConfig,
    receitaFederalStore,
    onProgress,
  } = params;
  let razaoVirtual = params.razaoRows;
  const lancamentos: VisionBalanceteRow[] = [];
  const detalhes: string[] = [];
  let ordem = params.ordemInicial;
  const fiscalMap = fiscalContaMap;
  const temRelatorio = folhaRows.length > 0 || fiscalRows.length > 0;
  const totalPeriodos = periodos.length;

  if (!temRelatorio) {
    return { razao: razaoVirtual, lancamentos, detalhes };
  }

  detalhes.push(
    `Relatórios: ${folhaRows.length} linha(s) folha · ${fiscalRows.length} linha(s) fiscal — conferindo com o balancete.` +
    (receitaFederalStore
      ? ` Regras RF: ${receitaFederalStore.regras.filter((r) => r.ativa !== false).length} ativa(s).`
      : ''),
  );

  for (let pi = 0; pi < periodos.length; pi++) {
    const periodo = periodos[pi];
    const mesLabel = periodo.label;

    onProgress?.({
      fase: 'folha_fiscal',
      atual: pi + 1,
      total: totalPeriodos,
      mensagem: `Folha/Fiscal · ${mesLabel}`,
    });

    const razaoPeriodo = filtrarRazaoPorPeriodo(razaoVirtual, periodo.de, periodo.ate);
    const balanceteMesRaw = montarBalanceteComPeriodo(
      razaoVirtual,
      razaoPeriodo,
      planoRows,
      periodo.de,
      periodo.ate,
    );
    const balanceteMes = balanceteMesRaw.map((r) => enrichNaturezaSaldoImportado(r, balanceteMesRaw));
    const lancamentosPeriodo: VisionBalanceteRow[] = [];

    for (const origem of ['folha', 'fiscal'] as const) {
      const rows = origem === 'folha' ? folhaRows : fiscalRows;
      for (const linha of rows) {
        if (!dataNoPeriodo(linha.data, periodo)) continue;
        if (lancamentoJaNoRazao(linha, razaoPeriodo)) continue;

        const conta = mapearLinhaRelatorioParaConta(
          linha,
          balanceteMes,
          planoRows,
          fiscalMap,
          origem,
          receitaFederalStore,
        );
        if (!conta) {
          detalhes.push(`${mesLabel} · ${origem}: sem conta contábil para "${linha.nome}" — linha ignorada.`);
          continue;
        }

        const novos = gerarLancamentosDaLinhaRelatorio(
          linha,
          conta,
          balanceteMes,
          planoRows,
          periodo,
          origem,
          ordem,
          contaConfig,
          receitaFederalStore,
          fiscalMap,
        );
        if (!novos.length) continue;
        ordem += 10;
        lancamentosPeriodo.push(...novos);
        const rfTag = novos[0]?.nome?.includes('[RF ') ? ' (regra RF)' : '';
        detalhes.push(
          `${mesLabel} · ${origem}: lançamento de ${(linha.credito || linha.debito || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} em ${conta.nome}${rfTag}.`,
        );
      }
    }

    if (lancamentosPeriodo.length) {
      lancamentos.push(...lancamentosPeriodo);
      razaoVirtual = aplicarLancamentosNoRazao(razaoVirtual, lancamentosPeriodo);
    }
  }

  return { razao: razaoVirtual, lancamentos, detalhes };
}

function filtrarPorDatasAutomacao(
  lancamentos: VisionBalanceteRow[],
  contaConfig?: AutomacaoContaConfig
): VisionBalanceteRow[] {
  if (!contaConfig) return lancamentos;
  const dataInicioIso = contaConfig.dataInicio ? parseBrDateToIso(contaConfig.dataInicio) : null;
  const dataFimIso = contaConfig.dataFim ? parseBrDateToIso(contaConfig.dataFim) : null;
  if (!dataInicioIso && !dataFimIso) return lancamentos;

  return lancamentos.filter((lan) => {
    const dateBr = lan.data?.trim();
    if (!dateBr) return true;
    const dateIso = parseBrDateToIso(dateBr);
    if (dataInicioIso && dateIso < dataInicioIso) return false;
    if (dataFimIso && dateIso > dataFimIso) return false;
    return true;
  });
}

/**
 * Automatização completa: relatórios folha/fiscal + ciclo banco/garantida + ajustes de saldo.
 */
export function executarAutomatizacaoCompleta(params: {
  linhasComparativo: LinhaComparativoMensal[];
  periodos: PeriodoMensal[];
  razaoRows: VisionBalanceteRow[];
  planoRows: VisionPlanoRow[];
  folhaRows: VisionBalanceteRow[];
  fiscalRows: VisionBalanceteRow[];
  empresaNome?: string;
  /** Mapa fiscal (localStorage só na thread principal — passe ao worker). */
  fiscalContaMap?: FiscalContaMap;
  /** Contas fixas (garantida, caixa, cliente, mútuo, despesa) — passe ao worker. */
  contaConfig?: AutomacaoContaConfig;
  /** Regras RF salvas/sincronizadas — passe ao worker. */
  receitaFederalStore?: ReceitaFederalRegrasStore;
  onProgress?: OnProgressoAutomatizacao;
}): ResultadoAutomatizacaoCompleta {
  const {
    linhasComparativo,
    periodos,
    razaoRows,
    planoRows,
    folhaRows,
    fiscalRows,
    empresaNome = '',
    contaConfig = {},
    onProgress,
  } = params;

  const fiscalContaMap = params.fiscalContaMap ?? readFiscalContaMap(empresaNome);
  const receitaFederalStore =
    params.receitaFederalStore ?? readReceitaFederalRegras(empresaNome);

  const linhasBanco = deduplicarLinhasBanco(linhasComparativo);
  const detalhes: string[] = [];
  const todosLancamentos: VisionBalanceteRow[] = [];
  let razaoAtual = razaoRows;

  const relatorioFolhaUsado = folhaRows.length > 0;
  const relatorioFiscalUsado = fiscalRows.length > 0;

  if (relatorioFolhaUsado || relatorioFiscalUsado) {
    const sync = sincronizarRelatoriosNoRazao({
      razaoRows: razaoAtual,
      planoRows,
      periodos,
      folhaRows,
      fiscalRows,
      fiscalContaMap,
      linhasComparativo,
      ordemInicial: 900_000,
      contaConfig,
      receitaFederalStore,
      onProgress,
    });
    const syncFiltrados = filtrarPorDatasAutomacao(sync.lancamentos, contaConfig);
    razaoAtual = aplicarLancamentosNoRazao(razaoAtual, syncFiltrados);
    todosLancamentos.push(...syncFiltrados);
    detalhes.push(...sync.detalhes);
  }

  const cicloBanco: ResultadoCicloGarantidaBanco = linhasBanco.length
    ? executarCicloGarantidaBanco({
      linhasBanco,
      periodos,
      razaoRows: razaoAtual,
      planoRows,
      contaConfig,
      onProgress: (p) => {
        const total = Math.max(1, p.bancosTotal * p.mesesTotal);
        const atual = (p.bancoAtual - 1) * p.mesesTotal + p.mesAtual;
        onProgress?.({
          fase: 'banco',
          atual,
          total,
          mensagem: `Banco/garantida · ${p.mensagem}`,
        });
      },
    })
    : {
      ok: true,
      mensagem: 'Ciclo banco/garantida não aplicado (nenhuma conta bancária no comparativo).',
      lancamentosGerados: [],
      contasProcessadas: [],
      detalhes: [],
    };

  if (cicloBanco.lancamentosGerados.length) {
    const filtradosBanco = filtrarPorDatasAutomacao(cicloBanco.lancamentosGerados, contaConfig);
    todosLancamentos.push(...filtradosBanco);
    detalhes.push(...cicloBanco.detalhes);
    razaoAtual = aplicarLancamentosNoRazao(razaoAtual, filtradosBanco);
  }

  onProgress?.({ fase: 'final', atual: 0, total: 1, mensagem: 'Empréstimo/caixa…' });

  const caixaMutuo = executarAutomatizacaoCaixaMutuo({
    linhasComparativo,
    periodos,
    razaoRows: razaoAtual,
    planoRows,
    contaConfig,
    onProgress: (msg) => onProgress?.({ fase: 'final', atual: 1, total: 1, mensagem: msg }),
  });
  if (caixaMutuo.lancamentos.length) {
    const filtradosCaixa = filtrarPorDatasAutomacao(caixaMutuo.lancamentos, contaConfig);
    razaoAtual = aplicarLancamentosNoRazao(razaoAtual, filtradosCaixa);
    todosLancamentos.push(...filtradosCaixa);
    detalhes.push(...caixaMutuo.detalhes);
  }

  onProgress?.({ fase: 'final', atual: 1, total: 1, mensagem: 'Empréstimo entre coligadas…' });
  const coligadas = executarEmprestimoEntreColigadas({
    periodos,
    razaoRows: razaoAtual,
    planoRows,
    contaConfig,
    empresaNome,
    onProgress: (msg) => onProgress?.({ fase: 'final', atual: 1, total: 1, mensagem: msg }),
  });
  if (coligadas.lancamentos.length || coligadas.detalhes.length) {
    const filtradosColigadas = filtrarPorDatasAutomacao(coligadas.lancamentos, contaConfig);
    razaoAtual = aplicarLancamentosNoRazao(razaoAtual, filtradosColigadas);
    todosLancamentos.push(...filtradosColigadas);
    detalhes.push(...coligadas.detalhes);
  }

  onProgress?.({ fase: 'final', atual: 1, total: 1, mensagem: 'Custo × faturamento…' });
  const custoFat = executarLancamentoCustoPorFaturamento({
    periodos,
    razaoRows: razaoAtual,
    planoRows,
    contaConfig,
    onProgress: (msg) => onProgress?.({ fase: 'final', atual: 1, total: 1, mensagem: msg }),
  });
  if (custoFat.lancamentos.length || custoFat.detalhes.length) {
    const filtradosCusto = filtrarPorDatasAutomacao(custoFat.lancamentos, contaConfig);
    razaoAtual = aplicarLancamentosNoRazao(razaoAtual, filtradosCusto);
    todosLancamentos.push(...filtradosCusto);
    detalhes.push(...custoFat.detalhes);
  }

  const ok = todosLancamentos.length > 0 || cicloBanco.ok;
  const partes: string[] = [];
  if (relatorioFolhaUsado || relatorioFiscalUsado) {
    partes.push('relatórios folha/fiscal conferidos');
  }
  if (cicloBanco.lancamentosGerados.length) {
    partes.push('ciclo banco/garantida');
  }

  const mensagemBase = ok
    ? `Automatização concluída${cicloBanco.mesParada ? ` em ${cicloBanco.mesParada}` : ''}. ${todosLancamentos.length} lançamento(s) gravado(s) no razão.`
    : cicloBanco.mensagem ||
    'Nenhum ajuste gerado. Importe folha/fiscal ou verifique banco credor e conta garantida.';

  onProgress?.({ fase: 'final', atual: 1, total: 1, mensagem: 'Concluindo…' });

  const todasLinhasLog = [...detalhes];
  const advertencias = extrairAdvertenciasMes(todasLinhasLog);
  const { erros, detalhes: detalhesOk } = separarErrosEDetalhes(todasLinhasLog);
  const contasCorrigidas = extrairContasCorrigidas(todosLancamentos, {
    linhasComparativo,
    planoRows,
  });

  return {
    ok,
    mensagem: mensagemBase,
    lancamentosGerados: todosLancamentos,
    cicloBanco,
    detalhes: detalhesOk,
    erros,
    contasCorrigidas,
    advertencias,
    relatorioFolhaUsado,
    relatorioFiscalUsado,
  };
}
