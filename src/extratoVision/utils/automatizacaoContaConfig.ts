import type { VisionBalanceteRow, VisionPlanoRow } from '../types/accounting';
import { getClassificacao } from './demonstracoesContabeis';
import {
  readPersistedLocalStorageJson,
  writePersistedLocalStorageJson,
} from '../../lib/persistentLocalStorage';
import type { PeriodoMensal } from './balanceteComparativoMensal';

export type AutomacaoContaPapel =
  | 'garantida'
  | 'caixa'
  | 'cliente'
  | 'mutuo'
  | 'despesa_ajuste'
  /** @deprecated substituído por custo_cmv / custo_cpv / custo_servicos — mantido para configs antigas. */
  | 'custos'
  | 'custo_cmv'
  | 'custo_cpv'
  | 'custo_servicos'
  | 'custo_outros';

export type AutomacaoContaVinculo = {
  classificacao: string;
  codigo?: string;
  nome?: string;
};

/** Par débito/crédito por papel (partidas dobradas na automatização). */
export type AutomacaoContaPapelConfig = {
  debito?: AutomacaoContaVinculo;
  credito?: AutomacaoContaVinculo;
  /** Formato legado (conta única) — migrado ao ler. */
  classificacao?: string;
  codigo?: string;
  nome?: string;
  /** % sobre faturamento para lançamento automático de custo (papel custos). */
  porcentagemCusto?: number;
  /** Conta de faturamento/receita usada como base do cálculo (papel custos). */
  contaFaturamento?: AutomacaoContaVinculo;
};

/** Data usada nos lançamentos gerados pela automação. */
export type AutomacaoDataModo = 'ultimo_dia_mes' | 'data_do_dia' | 'data_fixixa';

/** Empréstimo / transferência com empresa coligada já cadastrada no sistema. */
export type AutomacaoEmprestimoColigada = {
  id: string;
  /** Nome da empresa no registry ContábilFácil. */
  empresaColigada: string;
  debito?: AutomacaoContaVinculo;
  credito?: AutomacaoContaVinculo;
};

/**
 * Correção monetária / estorno de juros de um empréstimo bancário já lançado
 * (aba Empréstimos). O sistema compara o saldo que a própria automação
 * (EMPRESTIMO-AUTO) postou no razão contra o saldo total real da mesma conta
 * (que inclui o que veio do banco) e lança só a diferença — nunca altera o
 * lançamento de origem do banco.
 */
export type AutomacaoLancamentoEmprestimo = {
  id: string;
  /** Id do SavedContract (aba Empréstimos). */
  contratoId: string;
  /** Conta do contrato do empréstimo (código reduzido do plano). */
  contaContrato?: string;
  /** Conta de curto prazo do empréstimo (código reduzido do plano). */
  contaCurto?: string;
  /** Conta de longo prazo do empréstimo (código reduzido do plano). */
  contaLongo?: string;
  /** Contrapartida (código reduzido do plano) usada para ajustar curto/longo prazo até bater com a tabela do empréstimo. */
  contaCorrecaoMonetaria?: string;
  /** Estorno de juros apropriados — débito (código reduzido) — débita empréstimo. */
  contaEstornoJurosAproDebit?: string;
  /** Estorno de juros apropriados — crédito (código reduzido) — credita juros apropriado. */
  contaEstornoJurosAproCredit?: string;
  /** Reduzir juros — débito (código reduzido) — débita juros apropriados. */
  contaEstornoJurosDebito?: string;
  /** Reduzir juros — crédito (código reduzido) — credita despesa com juros. */
  contaEstornoJurosCredito?: string;
  /** Se deve aplicar redução/estorno de juros apropriados */
  aplicarReducaoJuros?: boolean;
  /** Ajuste de Exercício Credor (código reduzido). */
  contaAjusteCredor?: string;
  /** Ajuste de Exercício Devedor (código reduzido). */
  contaAjusteDevedor?: string;
};

/** Um registro de fechamento de período (histórico — mais recente primeiro). */
export type PeriodoFechadoHistoricoItem = {
  id: string;
  /** DD/MM/AAAA — data até a qual o período foi fechado. */
  ate: string;
  /** ISO — quando este fechamento foi feito. */
  fechadoEmIso: string;
  /** ISO — quando este fechamento foi reaberto (ausente enquanto estiver ativo). */
  reabertoEmIso?: string;
};

/** Configuração persistida da Compensação Banco Credor (contas banco + garantida). */
export type CompensacaoBancoConfig = {
  /** Código reduzido da conta banco. */
  contaBanco: string;
  /** Código reduzido da conta garantida (contrapartida). */
  contaGarantida: string;
};

export type AutomacaoContaConfig = Partial<Record<AutomacaoContaPapel, AutomacaoContaPapelConfig>> & {
  dataModo?: AutomacaoDataModo;
  /** DD/MM/AAAA quando dataModo === 'data_fixixa'. */
  dataFixa?: string;
  /** DD/MM/AAAA — datas anteriores a esta estão com o período fechado (balancete travado). */
  periodoFechadoAte?: string;
  /** Histórico de fechamentos/reaberturas de período (mais recente primeiro). */
  historicoPeriodoFechado?: PeriodoFechadoHistoricoItem[];
  /** AAAA — ano em que a automação lança (deve estar fora do período fechado). */
  anoLancamento?: string;
  /** DD/MM/AAAA — Data de início do período válido para a automação lançar */
  dataInicio?: string;
  /** DD/MM/AAAA — Data final do período válido para a automação lançar */
  dataFim?: string;
  emprestimoColigadas?: AutomacaoEmprestimoColigada[];
  lancamentosEmprestimo?: AutomacaoLancamentoEmprestimo[];
  /** Contas salvas para Compensação Banco Credor (banco ↔ garantida). */
  compensacaoBancoConfig?: CompensacaoBancoConfig;
};

const STORAGE_KEY = 'extratoVision_automacao_conta_config_v1';

type PersistPayload = Record<string, AutomacaoContaConfig>;

/** Lado padrão quando só existe vínculo legado (conta única). */
const LEGACY_LADO: Record<AutomacaoContaPapel, 'debito' | 'credito'> = {
  garantida: 'credito',
  caixa: 'debito',
  cliente: 'credito',
  mutuo: 'credito',
  despesa_ajuste: 'debito',
  custos: 'debito',
  custo_cmv: 'debito',
  custo_cpv: 'debito',
  custo_servicos: 'debito',
  custo_outros: 'debito',
};

function normEmpresa(empresa: string): string {
  const v = empresa.trim().toLowerCase();
  return v || '__default__';
}

export function normClsAutomacao(cls: string): string {
  return cls.replace(/\./g, '').replace(/\s/g, '').trim();
}

function isVinculo(v: AutomacaoContaVinculo | undefined): v is AutomacaoContaVinculo {
  return !!v?.classificacao?.trim();
}

function legacyVinculo(p: AutomacaoContaPapelConfig | undefined): AutomacaoContaVinculo | undefined {
  if (!p?.classificacao?.trim()) return undefined;
  return {
    classificacao: p.classificacao.trim(),
    codigo: p.codigo,
    nome: p.nome,
  };
}

function normalizePapelConfig(raw: AutomacaoContaPapelConfig | undefined): AutomacaoContaPapelConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: AutomacaoContaPapelConfig = {};
  if (raw.debito && isVinculo(raw.debito)) out.debito = raw.debito;
  if (raw.credito && isVinculo(raw.credito)) out.credito = raw.credito;
  const leg = legacyVinculo(raw);
  if (leg && !out.debito && !out.credito) {
    out.classificacao = leg.classificacao;
    out.codigo = leg.codigo;
    out.nome = leg.nome;
  }
  if (typeof raw.porcentagemCusto === 'number' && Number.isFinite(raw.porcentagemCusto)) {
    const pct = Math.max(0, Math.min(100, raw.porcentagemCusto));
    if (pct > 0) out.porcentagemCusto = pct;
  }
  if (raw.contaFaturamento && isVinculo(raw.contaFaturamento)) {
    out.contaFaturamento = raw.contaFaturamento;
  }
  if (!out.debito && !out.credito && !out.classificacao && !out.porcentagemCusto && !out.contaFaturamento) {
    return undefined;
  }
  return out;
}

const PAPEIS_AUTOMACAO_IDS: AutomacaoContaPapel[] = [
  'garantida',
  'caixa',
  'cliente',
  'mutuo',
  'despesa_ajuste',
  'custos',
  'custo_cmv',
  'custo_cpv',
  'custo_servicos',
  'custo_outros',
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatBrDate(d: Date): string {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function isValidBrDate(s: string): boolean {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (!m) return false;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(year, month - 1, day);
  return dt.getFullYear() === year && dt.getMonth() === month - 1 && dt.getDate() === day;
}

/** Converte DD/MM/AAAA em Date (meia-noite local). Retorna null se inválida. */
export function parseBrDate(s: string): Date | null {
  if (!isValidBrDate(s)) return null;
  const [day, month, year] = s.trim().split('/').map(Number);
  return new Date(year, month - 1, day);
}

export function parseBrDateToIso(brDate: string): string {
  const parts = brDate.trim().split('/');
  if (parts.length === 3) {
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
  }
  return brDate;
}

/**
 * Uma data está no período fechado quando é anterior à data de corte
 * (`periodoFechadoAte`). Ex.: fechar em 01/01/2026 trava tudo até 31/12/2025.
 */
export function isDataNoPeriodoFechado(dataBr: string, config?: AutomacaoContaConfig | null): boolean {
  const corte = config?.periodoFechadoAte ? parseBrDate(config.periodoFechadoAte) : null;
  if (!corte) return false;
  const data = parseBrDate(dataBr);
  if (!data) return false;
  return data.getTime() < corte.getTime();
}

/** Um ano está fechado quando o dia 31/12 dele já cai antes da data de corte. */
export function isAnoNoPeriodoFechado(ano: string | number, config?: AutomacaoContaConfig | null): boolean {
  const corte = config?.periodoFechadoAte ? parseBrDate(config.periodoFechadoAte) : null;
  if (!corte) return false;
  const anoNum = typeof ano === 'number' ? ano : Number(ano);
  if (!Number.isFinite(anoNum)) return false;
  const fimAno = new Date(anoNum, 11, 31);
  return fimAno.getTime() < corte.getTime();
}

function normalizeEmprestimoColigada(raw: unknown): AutomacaoEmprestimoColigada | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<AutomacaoEmprestimoColigada>;
  const empresa = String(r.empresaColigada ?? '').trim();
  if (!empresa) return null;
  const out: AutomacaoEmprestimoColigada = {
    id: String(r.id ?? newEmprestimoColigadaId()),
    empresaColigada: empresa,
  };
  if (r.debito && isVinculo(r.debito)) out.debito = r.debito;
  if (r.credito && isVinculo(r.credito)) out.credito = r.credito;
  return out;
}

/** Campos de conta (código reduzido) do lançamento de empréstimo — TODOS precisam sobreviver ao normalize. */
const LANCAMENTO_EMPRESTIMO_CONTA_FIELDS = [
  'contaContrato',
  'contaCurto',
  'contaLongo',
  'contaCorrecaoMonetaria',
  'contaEstornoJurosAproDebit',
  'contaEstornoJurosAproCredit',
  'contaEstornoJurosDebito',
  'contaEstornoJurosCredito',
  'contaAjusteCredor',
  'contaAjusteDevedor',
] as const;

function normalizeLancamentoEmprestimo(raw: unknown): AutomacaoLancamentoEmprestimo | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<AutomacaoLancamentoEmprestimo>;
  const contratoId = String(r.contratoId ?? '').trim();
  if (!contratoId) return null;
  const out: AutomacaoLancamentoEmprestimo = {
    id: String(r.id ?? newLancamentoEmprestimoId()),
    contratoId,
  };
  // Preserva todas as contas configuradas/puxadas — antes só contaCorrecaoMonetaria
  // sobrevivia e as demais (curto/longo, estornos, ajustes) eram descartadas no save.
  for (const campo of LANCAMENTO_EMPRESTIMO_CONTA_FIELDS) {
    const v = r[campo];
    if (typeof v === 'string' && v.trim()) out[campo] = v.trim();
  }
  if (r.aplicarReducaoJuros) out.aplicarReducaoJuros = true;
  return out;
}

function normalizeHistoricoPeriodoFechado(raw: unknown): PeriodoFechadoHistoricoItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<PeriodoFechadoHistoricoItem>;
  const ate = String(r.ate ?? '').trim();
  if (!ate || !isValidBrDate(ate)) return null;
  const fechadoEmIso = String(r.fechadoEmIso ?? '').trim();
  if (!fechadoEmIso) return null;
  const out: PeriodoFechadoHistoricoItem = {
    id: String(r.id ?? newPeriodoFechadoId()),
    ate,
    fechadoEmIso,
  };
  if (typeof r.reabertoEmIso === 'string' && r.reabertoEmIso.trim()) {
    out.reabertoEmIso = r.reabertoEmIso.trim();
  }
  return out;
}

function normalizeConfig(cfg: AutomacaoContaConfig): AutomacaoContaConfig {
  const out: AutomacaoContaConfig = {};
  for (const id of PAPEIS_AUTOMACAO_IDS) {
    const n = normalizePapelConfig(cfg[id]);
    if (n) out[id] = n;
  }
  const modo = cfg.dataModo;
  if (modo === 'ultimo_dia_mes' || modo === 'data_do_dia' || modo === 'data_fixixa') {
    out.dataModo = modo;
  }
  if (cfg.dataFixa && isValidBrDate(cfg.dataFixa)) {
    out.dataFixa = cfg.dataFixa.trim();
  }
  if (cfg.periodoFechadoAte && isValidBrDate(cfg.periodoFechadoAte)) {
    out.periodoFechadoAte = cfg.periodoFechadoAte.trim();
  }
  if (Array.isArray(cfg.historicoPeriodoFechado)) {
    const list = cfg.historicoPeriodoFechado
      .map(normalizeHistoricoPeriodoFechado)
      .filter((x): x is PeriodoFechadoHistoricoItem => Boolean(x));
    if (list.length) out.historicoPeriodoFechado = list;
  }
  if (cfg.anoLancamento && /^\d{4}$/.test(cfg.anoLancamento.trim())) {
    out.anoLancamento = cfg.anoLancamento.trim();
  }
  if (cfg.dataInicio && isValidBrDate(cfg.dataInicio)) {
    out.dataInicio = cfg.dataInicio.trim();
  }
  if (cfg.dataFim && isValidBrDate(cfg.dataFim)) {
    out.dataFim = cfg.dataFim.trim();
  }
  if (Array.isArray(cfg.emprestimoColigadas)) {
    const list = cfg.emprestimoColigadas
      .map(normalizeEmprestimoColigada)
      .filter((x): x is AutomacaoEmprestimoColigada => Boolean(x));
    if (list.length) out.emprestimoColigadas = list;
  }
  if (Array.isArray(cfg.lancamentosEmprestimo)) {
    const list = cfg.lancamentosEmprestimo
      .map(normalizeLancamentoEmprestimo)
      .filter((x): x is AutomacaoLancamentoEmprestimo => Boolean(x));
    if (list.length) out.lancamentosEmprestimo = list;
  }
  const cbc = cfg.compensacaoBancoConfig;
  if (cbc && typeof cbc.contaBanco === 'string' && cbc.contaBanco.trim() &&
      typeof cbc.contaGarantida === 'string' && cbc.contaGarantida.trim()) {
    out.compensacaoBancoConfig = {
      contaBanco: cbc.contaBanco.trim(),
      contaGarantida: cbc.contaGarantida.trim(),
    };
  }
  return out;
}

/**
 * Resolve a data dos lançamentos automáticos conforme a configuração.
 * Padrão: último dia do mês do período (`periodo.ate`).
 */
export function resolverDataAutomacao(
  periodo: PeriodoMensal,
  config?: AutomacaoContaConfig | null,
  hoje: Date = new Date(),
): string {
  const modo = config?.dataModo ?? 'ultimo_dia_mes';
  if (modo === 'data_do_dia') return formatBrDate(hoje);
  if (modo === 'data_fixixa' && config?.dataFixa && isValidBrDate(config.dataFixa)) {
    return config.dataFixa.trim();
  }
  return periodo.ate;
}

/**
 * IMPORTANTE: precisa ler do MESMO backend em que saveAutomatizacaoContaConfig grava
 * (writePersistedLocalStorageJson → memória segura + Docker). Ler via `localStorage.getItem`
 * direto aqui é um bug: dados "operacionais" nunca chegam ao localStorage real do
 * navegador (só ficam no Map interno de safeLocalStorage.ts) — a leitura direta
 * sempre voltava vazia, fazendo o período de lançamento (Data Inicial/Final)
 * parecer "não salvo" mesmo logo após clicar em Aplicar período.
 */
function readRaw(): PersistPayload {
  return readPersistedLocalStorageJson<PersistPayload>(STORAGE_KEY, {});
}

export function readAutomatizacaoContaConfig(empresa: string): AutomacaoContaConfig {
  return normalizeConfig(readRaw()[normEmpresa(empresa)] ?? {});
}

export function saveAutomatizacaoContaConfig(empresa: string, config: AutomacaoContaConfig): void {
  const all = readRaw();
  all[normEmpresa(empresa)] = normalizeConfig(config);
  writePersistedLocalStorageJson(STORAGE_KEY, all);
}

/** Salva um único papel (bloco) da configuração sem alterar os demais. */
export function savePapelAutomatizacaoContaConfig(
  empresa: string,
  papel: AutomacaoContaPapel,
  cfg: AutomacaoContaPapelConfig | undefined,
): AutomacaoContaConfig {
  const current = readAutomatizacaoContaConfig(empresa);
  const next: AutomacaoContaConfig = { ...current };
  if (cfg) next[papel] = cfg;
  else delete next[papel];
  saveAutomatizacaoContaConfig(empresa, next);
  return next;
}

/**
 * Blocos exibidos na modal (caixa e despesa usam detecção automática no plano).
 * Garantida/cliente/mútuo saíram da UI — substituídos pelas Regras (contas
 * invertidas), que cobrem o mesmo caso (caixa credor) de forma genérica.
 * Os papéis continuam válidos no tipo/execução para configs antigas já salvas.
 */
export const PAPEIS_AUTOMACAO_UI: {
  id: AutomacaoContaPapel;
  titulo: string;
  hint: string;
  debHint: string;
  credHint: string;
  info: string;
}[] = [
  {
    id: 'custo_cmv',
    titulo: 'Custo CMV',
    hint: 'Custo da mercadoria vendida. Opcional: % sobre faturamento para lançar custo automaticamente.',
    debHint: 'D — conta de CMV',
    credHint: 'C — contrapartida (ex.: estoque, fornecedor)',
    info: [
      'Como a automação usa:',
      '• Prefere esta conta ao lançar ajustes de custo/despesa (folha, fiscal e provisões).',
      '• Com porcentagem e conta de faturamento: calcula custo = faturamento × % e lança D/C no mês.',
      '• Faturamento = créditos − débitos da conta de receita escolhida no período.',
      '',
      'Quando é usada:',
      '• Sempre que a automação precisar de uma conta de custo e esta configuração existir.',
      '• Lançamento por %: exige D, C, porcentagem > 0 e conta de faturamento.',
    ].join('\n'),
  },
  {
    id: 'custo_cpv',
    titulo: 'Custo CPV',
    hint: 'Custo do produto vendido. Opcional: % sobre faturamento para lançar custo automaticamente.',
    debHint: 'D — conta de CPV',
    credHint: 'C — contrapartida (ex.: estoque, fornecedor)',
    info: [
      'Como a automação usa:',
      '• Prefere esta conta ao lançar ajustes de custo/despesa (folha, fiscal e provisões).',
      '• Com porcentagem e conta de faturamento: calcula custo = faturamento × % e lança D/C no mês.',
      '• Faturamento = créditos − débitos da conta de receita escolhida no período.',
      '',
      'Quando é usada:',
      '• Sempre que a automação precisar de uma conta de custo e esta configuração existir.',
      '• Lançamento por %: exige D, C, porcentagem > 0 e conta de faturamento.',
    ].join('\n'),
  },
  {
    id: 'custo_servicos',
    titulo: 'Custo dos serviços prestados',
    hint: 'CSP — custo dos serviços prestados. Opcional: % sobre faturamento para lançar custo automaticamente.',
    debHint: 'D — conta de custo dos serviços',
    credHint: 'C — contrapartida (ex.: fornecedor, mão de obra)',
    info: [
      'Como a automação usa:',
      '• Prefere esta conta ao lançar ajustes de custo/despesa (folha, fiscal e provisões).',
      '• Com porcentagem e conta de faturamento: calcula custo = faturamento × % e lança D/C no mês.',
      '• Faturamento = créditos − débitos da conta de receita escolhida no período.',
      '',
      'Quando é usada:',
      '• Sempre que a automação precisar de uma conta de custo e esta configuração existir.',
      '• Lançamento por %: exige D, C, porcentagem > 0 e conta de faturamento.',
    ].join('\n'),
  },
  {
    id: 'custo_outros',
    titulo: 'Outros custos',
    hint: 'Demais custos não classificados em CMV/CPV/CSP. Opcional: % sobre faturamento do mês para lançar custo automaticamente.',
    debHint: 'D — conta de outros custos',
    credHint: 'C — contrapartida (ex.: fornecedor, mão de obra)',
    info: [
      'Como a automação usa:',
      '• Prefere esta conta ao lançar ajustes de custo/despesa (folha, fiscal e provisões).',
      '• Com porcentagem e conta de faturamento: calcula custo = faturamento do mês × % e lança D/C no mês.',
      '• Faturamento = créditos − débitos da conta de receita escolhida no mês (não é o saldo acumulado).',
      '',
      'Quando é usada:',
      '• Sempre que a automação precisar de uma conta de custo e esta configuração existir.',
      '• Lançamento por %: exige D, C, porcentagem > 0 e conta de faturamento.',
    ].join('\n'),
  },
];

const PAPEL_TITULO: Record<AutomacaoContaPapel, string> = {
  garantida: 'Conta garantida',
  caixa: 'Caixa / fundo fixo',
  cliente: 'Clientes a receber',
  mutuo: 'Mútuo / empréstimo',
  despesa_ajuste: 'Despesa (ajustes)',
  custos: 'Custos',
  custo_cmv: 'Custo CMV',
  custo_cpv: 'Custo CPV',
  custo_servicos: 'Custo dos serviços prestados',
  custo_outros: 'Outros custos',
};

export function papelAutomacaoLabel(id: AutomacaoContaPapel): string {
  return PAPEL_TITULO[id] ?? id;
}

/** Vínculo do papel para o lado D ou C (com migração do formato antigo). */
export function getVinculoPapel(
  config: AutomacaoContaConfig,
  papel: AutomacaoContaPapel,
  lado: 'debito' | 'credito',
): AutomacaoContaVinculo | undefined {
  const p = config[papel];
  if (!p) return undefined;
  const direto = lado === 'debito' ? p.debito : p.credito;
  if (isVinculo(direto)) return direto;
  const leg = legacyVinculo(p);
  if (leg && LEGACY_LADO[papel] === lado) return leg;
  /** Garantida / custos: se só um lado preenchido, usa nos dois sentidos. */
  if (papel === 'garantida' || papel.startsWith('custo')) {
    const outro = lado === 'debito' ? p.credito : p.debito;
    if (isVinculo(outro)) return outro;
  }
  return undefined;
}

function planoParaRow(p: VisionPlanoRow): VisionBalanceteRow {
  return {
    codigo: p.codigoReduzido ?? p.codigo,
    classificacao: p.codigo,
    nome: p.nome,
    saldoInicial: 0,
    debito: 0,
    credito: 0,
    saldoFinal: 0,
    tipo: p.tipo ?? 'A',
  };
}

export function buscarContasNoPlano(
  planoRows: VisionPlanoRow[],
  query: string,
  limite = 25,
): VisionPlanoRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return planoRows.filter((p) => p.tipo === 'A').slice(0, limite);

  const out: VisionPlanoRow[] = [];
  for (const p of planoRows) {
    const cod = (p.codigo ?? '').toLowerCase();
    const codR = (p.codigoReduzido ?? '').toLowerCase();
    const nome = (p.nome ?? '').toLowerCase();
    const cls = normClsAutomacao(p.codigo);
    const qNorm = normClsAutomacao(q);
    if (
      nome.includes(q) ||
      cod.includes(q) ||
      codR.includes(q) ||
      (qNorm.length >= 3 && cls.includes(qNorm))
    ) {
      out.push(p);
      if (out.length >= limite) break;
    }
  }
  return out;
}

export function vinculoFromPlano(p: VisionPlanoRow): AutomacaoContaVinculo {
  return {
    classificacao: p.codigo,
    codigo: p.codigoReduzido ?? p.codigo,
    nome: p.nome,
  };
}

export type VinculoManualResultado = { vinculo: AutomacaoContaVinculo } | { erro: string };

/**
 * Resolve código digitado manualmente. Só aceita código reduzido — código de
 * classificação (ex.: 2.1.6.00.0001) é proibido nestes contêineres para evitar
 * vínculo com a conta errada quando o plano é renumerado.
 */
export function vinculoFromCodigoManual(
  codigo: string,
  planoRows: VisionPlanoRow[],
): VinculoManualResultado {
  const t = codigo.trim();
  const tDigits = t.replace(/\D/g, '');
  const porReduzido = tDigits
    ? planoRows.find((x) => (x.codigoReduzido ?? '').replace(/\D/g, '') === tDigits)
    : undefined;
  if (porReduzido) return { vinculo: vinculoFromPlano(porReduzido) };

  const c = normClsAutomacao(t);
  const porClassificacao = planoRows.find((x) => normClsAutomacao(x.codigo) === c);
  if (porClassificacao) {
    return {
      erro:
        'Código de classificação não pode ser usado aqui. Informe o código reduzido da conta (ou selecione na busca acima).',
    };
  }

  return { erro: 'Código reduzido não encontrado no plano de contas.' };
}

export function rowFromVinculo(
  v: AutomacaoContaVinculo,
  planoRows: VisionPlanoRow[],
  balancete?: VisionBalanceteRow[],
): VisionBalanceteRow | null {
  const c = normClsAutomacao(v.classificacao);
  if (balancete?.length) {
    const noBal = balancete.find(
      (r) => r.tipo !== 'S' && normClsAutomacao(getClassificacao(r)) === c,
    );
    if (noBal) return noBal;
  }
  const p = planoRows.find((x) => normClsAutomacao(x.codigo) === c);
  if (p) return planoParaRow(p);
  return {
    codigo: v.codigo ?? v.classificacao,
    classificacao: v.classificacao,
    nome: v.nome ?? v.classificacao,
    tipo: 'A',
    saldoInicial: 0,
    debito: 0,
    credito: 0,
    saldoFinal: 0,
  };
}

export function resolverContaAutomacao(
  papel: AutomacaoContaPapel,
  config: AutomacaoContaConfig,
  planoRows: VisionPlanoRow[],
  balancete?: VisionBalanceteRow[],
  lado?: 'debito' | 'credito',
): VisionBalanceteRow | null {
  const ladoEff = lado ?? LEGACY_LADO[papel];
  const v = getVinculoPapel(config, papel, ladoEff);
  if (!v) return null;
  return rowFromVinculo(v, planoRows, balancete);
}

/** Resolve par D/C configurado para o papel (quando ambos existem). */
export function resolverParAutomacao(
  papel: AutomacaoContaPapel,
  config: AutomacaoContaConfig,
  planoRows: VisionPlanoRow[],
  balancete?: VisionBalanceteRow[],
): { debito: VisionBalanceteRow | null; credito: VisionBalanceteRow | null } {
  return {
    debito: resolverContaAutomacao(papel, config, planoRows, balancete, 'debito'),
    credito: resolverContaAutomacao(papel, config, planoRows, balancete, 'credito'),
  };
}

export function papeisConfiguradosCount(config: AutomacaoContaConfig): number {
  const papeis = PAPEIS_AUTOMACAO_UI.filter((p) => {
    const cfg = config[p.id];
    if (!cfg) return false;
    return (
      isVinculo(cfg.debito) ||
      isVinculo(cfg.credito) ||
      !!cfg.classificacao?.trim()
    );
  }).length;
  const colig = (config.emprestimoColigadas ?? []).filter(
    (c) => isVinculo(c.debito) || isVinculo(c.credito),
  ).length;
  return papeis + colig;
}

export function papelConfigurado(config: AutomacaoContaConfig, papel: AutomacaoContaPapel): boolean {
  const cfg = config[papel];
  if (!cfg) return false;
  return isVinculo(cfg.debito) || isVinculo(cfg.credito) || !!cfg.classificacao?.trim();
}

export function newEmprestimoColigadaId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `colig-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newLancamentoEmprestimoId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `lanc-emp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newPeriodoFechadoId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `periodo-fech-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Fecha o período até a data informada: trava tudo antes dela (balancete,
 * lançamentos, automação) e registra o fechamento no histórico da empresa.
 */
export function fecharPeriodoContabil(empresa: string, ate: string): AutomacaoContaConfig {
  const dataAte = ate.trim();
  const current = readAutomatizacaoContaConfig(empresa);
  const item: PeriodoFechadoHistoricoItem = {
    id: newPeriodoFechadoId(),
    ate: dataAte,
    fechadoEmIso: new Date().toISOString(),
  };
  const next: AutomacaoContaConfig = {
    ...current,
    periodoFechadoAte: dataAte,
    historicoPeriodoFechado: [item, ...(current.historicoPeriodoFechado ?? [])],
  };
  saveAutomatizacaoContaConfig(empresa, next);
  return next;
}

/**
 * Reabre o fechamento identificado por `id` — marca o registro como reaberto
 * e recalcula o corte ativo (o fechamento não reaberto mais recente, se houver).
 */
export function reabrirPeriodoContabil(empresa: string, id: string): AutomacaoContaConfig {
  const current = readAutomatizacaoContaConfig(empresa);
  const historico = (current.historicoPeriodoFechado ?? []).map((h) =>
    h.id === id ? { ...h, reabertoEmIso: new Date().toISOString() } : h,
  );
  const ativo = historico.find((h) => !h.reabertoEmIso);
  const next: AutomacaoContaConfig = { ...current, historicoPeriodoFechado: historico };
  if (ativo) next.periodoFechadoAte = ativo.ate;
  else delete next.periodoFechadoAte;
  saveAutomatizacaoContaConfig(empresa, next);
  return next;
}
