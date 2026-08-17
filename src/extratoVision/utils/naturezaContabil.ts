/**
 * Natureza de saldo conforme CPC/NBC TG (grupos 1–4+).
 * 1 Ativo → devedora | 2 Passivo/PL → credora | 3 Receitas → credora
 * 4+ Custos/Despesas → devedora (inclui grupos 5–7 do Domínio)
 */

import type { VisionBalanceteRow } from '../types/accounting';
import { getClassificacao } from './demonstracoesContabeis';
import { resolveNaturezaManual } from './naturezaManualConfig';

export type NaturezaSaldo = 'D' | 'C';

export type SaldoContabil = {
  valor: number;
  natureza: NaturezaSaldo;
  naturezaEsperada: NaturezaSaldo;
  invertido: boolean;
};

function classRoot(classificacao: string): string {
  return classificacao.replace(/\./g, '')[0] ?? '';
}

/** Natureza padrão do grupo raiz: 1 Ativo D | 2 Passivo/PL C | 3 Receitas C | 4+ Custos/Despesas D. */
function naturezaPadraoGrupo(root: string): NaturezaSaldo {
  return root === '2' || root === '3' ? 'C' : 'D';
}

function tolerancia(valor: number): number {
  return Math.max(0.05, Math.abs(valor) * 1e-6);
}

/** Garante array — evita crash quando allRows vem null/undefined ou tipo errado. */
function ensureRows(allRows?: VisionBalanceteRow[] | null): VisionBalanceteRow[] {
  return Array.isArray(allRows) ? allRows : [];
}

function nomeNorm(row: Pick<VisionBalanceteRow, 'nome'>): string {
  return (row.nome ?? '').toLowerCase();
}

/**
 * Detecta o sinal "(-)" na descrição da conta (dedutora/retificadora — natureza
 * invertida em relação à conta pai). Reforçada para não depender de:
 * - posição exata no início do nome (algumas contas trazem o sinal no meio/fim,
 *   ex.: "REDUÇÃO AO VALOR RECUPERÁVEL (-)");
 * - o caractere de traço ser exatamente hífen ASCII — aceita também en dash,
 *   em dash e sinal de menos unicode, que aparecem em textos copiados de PDF/Excel.
 * Sem isso, contas com essas variações ficavam com a MESMA natureza da conta pai
 * em vez de invertida, apesar de terem o sinal "(-)" na descrição.
 */
function isContaDedutoraPorPrefixo(row: Pick<VisionBalanceteRow, 'nome'>): boolean {
  const nome = (row.nome ?? '').normalize('NFKC');
  return /\(\s*[-‐‑‒–—−]\s*\)/.test(nome);
}

/** Export público — reutilizado por outras telas que precisam da mesma detecção (evita duplicar a regex). */
export function isContaComSinalNaturezaInvertida(row: Pick<VisionBalanceteRow, 'nome'>): boolean {
  return isContaDedutoraPorPrefixo(row);
}

/** Passivo operacional por nome — natureza credora (CPC 26) */
export function isContaPassivoPorNome(row: Pick<VisionBalanceteRow, 'nome'>): boolean {
  const n = nomeNorm(row);
  return (
    /contas?\s+a\s+pagar/i.test(n) ||
    /\bfornecedores?\b/i.test(n) ||
    /outras?\s+obriga(?:ç|c)(?:õ|o)es?/i.test(n) ||
    /obriga(?:ç|c)(?:õ|o)es?\s+(?:trabalhist|fisc|soc|financeir|circulante|n[ãa]o)/i.test(n) ||
    /(?:impostos?|tributos?|contribui(?:ç|c)(?:õ|o)es?).*(?:a\s+recolher|recolher|a\s+pagar)/i.test(n) ||
    /sal[áa]rios?\s+a\s+pagar/i.test(n) ||
    /pr[óo][ -]?labore\s+a\s+pagar/i.test(n) ||
    /f[ée]rias?\s+a\s+pagar/i.test(n) ||
    /13[ºo]?\s+sal[áa]rio\s+a\s+pagar/i.test(n) ||
    /consignad[oa]s?\s+a\s+pagar/i.test(n) ||
    /provis(?:ã|a)o\s+(?:de\s+)?(?:f[ée]rias|13|d[ée]cimo|sal[áa]rio|folha).*(a\s+pagar)?/i.test(n) ||
    /(?:provis(?:õ|o)es?|prov\.)\s+(?:trabalhist|fisc)/i.test(n) ||
    /(?:empr[ée]stimos?|financiamentos?)\s+a\s+pagar/i.test(n) ||
    /duplicatas?\s+a\s+pagar/i.test(n)
  );
}

const PASSIVO_PAI_PATTERNS: RegExp[] = [
  /contas?\s+a\s+pagar/i,
  /outras?\s+obriga/i,
  /\bfornecedores?\b/i,
  /obriga(?:ç|c)(?:õ|o)es?\s+(?:circulante|n[ãa]o\s+circulante|fisc|trabalhist|sociais?|financeir)/i,
  /passivo\s+circulante/i,
  /passivo\s+n[ãa]o\s+circulante/i,
];

/**
 * Conta analítica filha de grupo de passivo (ex.: fornecedor sob CONTAS A PAGAR).
 * Cobre filhas cujo código reduzido não traz classificação 2.x.
 */
function isFilhaPassivoOperacional(row: VisionBalanceteRow, allRows: VisionBalanceteRow[]): boolean {
  if (row.tipo === 'S') return false;
  const rows = ensureRows(allRows);
  if (rows.length === 0) return false;

  const idx = indexNoBalancete(row, rows);
  if (idx <= 0) return false;

  for (let i = idx - 1; i >= 0; i--) {
    const above = rows[i];
    const nomeAbove = (above.nome ?? '').toLowerCase();
    if (PASSIVO_PAI_PATTERNS.some((p) => p.test(nomeAbove))) return true;
    if (above.tipo === 'S') return false;
  }
  return false;
}

/** Passivo operacional (grupo 2, nome ou hierarquia) — natureza credora */
export function isContaPassivoOperacional(
  row: Pick<VisionBalanceteRow, 'nome' | 'classificacao' | 'codigo'>,
  allRows: VisionBalanceteRow[] = [],
): boolean {
  const rows = ensureRows(allRows);
  if (isContaRedutoraPL(row, rows)) return false;
  if (isContaNaturezaAmbigua(row)) return false;
  if (isContaPassivoPorNome(row)) return true;
  if (rows.length > 0 && isFilhaPassivoOperacional(row as VisionBalanceteRow, rows)) return true;
  return isContaPassivo(row, rows);
}

/** Custos, despesas, CMV/CPV e demais contas de resultado de natureza devedora */
export function isContaCustoDespesa(row: Pick<VisionBalanceteRow, 'nome' | 'classificacao'>): boolean {
  // Passivo operacional (contas a pagar, obrigações etc.) nunca é despesa
  if (isContaPassivoPorNome(row)) return false;

  const n = nomeNorm(row);
  const cls = getClassificacao(row as VisionBalanceteRow);
  const root = classRoot(cls);

  // Grupo 2 = passivo/PL — credora, não é despesa
  if (root === '2') return false;

  // ─── Grupo 3: a CLASSIFICAÇÃO prevalece sobre o nome ────────────────────────
  // Contas dentro do grupo 3 herdam natureza CREDORA do pai (receitas).
  // "MULTAS DE MORA", "JUROS DE APLICAÇÕES", "OUTRAS RECEITAS" etc. são
  // credoras se estiverem classificadas como 3.x — o nome não muda isso.
  // Exceção: estrutura Domínio onde 3.1.2/3.1.3 abriga custos/despesas.
  if (root === '3') {
    const parts = cls.split('.').filter(Boolean);
    // Domínio: 3.1.2 = custos, 3.1.3 = despesas (terceiro segmento >= 2)
    if (parts.length >= 3 && parts[0] === '3' && parts[1] === '1') {
      const third = parseInt(parts[2], 10);
      if (!Number.isNaN(third) && third >= 2) return true;
    }
    // Código sem ponto: 312xx / 313xx / 314xx (Domínio compacto)
    const stripped = cls.replace(/\./g, '');
    if (stripped.length >= 3 && stripped[0] === '3' && stripped[1] === '1') {
      const thirdDigit = parseInt(stripped[2], 10);
      if (!Number.isNaN(thirdDigit) && thirdDigit >= 2) return true;
    }
    // Qualquer outro 3.x = receita — encerra aqui sem checar nome
    return false;
  }
  // ─────────────────────────────────────────────────────────────────────────────

  // NBC/Domínio: grupos 4–7 = custos, despesas e outras contas devedoras
  if (/^[4567]/.test(root)) return true;

  if (/\breceita\b|\breceitas\b|\bvendas\b|\bfaturamento\b|\bganho\b/i.test(n)) return false;

  if (
    /\bcusto\b|\bcustos\b|\bdespesa\b|\bdespesas\b|\bdesp\b|\bcmv\b|\bcpv\b|\bcsp\b|\bcspv\b/i.test(n) ||
    /custo das mercadorias|custo dos produtos|custo dos serviços|custo dos servicos/i.test(n) ||
    /deprecia(?:ç(?:ão|ao|ões|oes)|cao|coes)(?!.*acumulad)/i.test(n) ||
    /amortiza(?:ç(?:ão|ao|ções|coes)|cao|coes)(?!.*acumulad)/i.test(n) ||
    /exaust(?:ão|ao|ões|oes)(?!.*acumulad)/i.test(n) ||
    /provis(ão|ao) para/i.test(n) ||
    /tributos sobre (vendas|receita|faturamento)/i.test(n) ||
    /encargos sociais|salários|salarios|pró[- ]?labore|pro[- ]?labore/i.test(n) ||
    /combustível|combustivel|gasolina|diesel|etanol|gnv/i.test(n) ||
    /aluguel|locação|locacao|condomínio|condominio/i.test(n) ||
    /energia elétrica|energia eletrica|água e esgoto|agua e esgoto/i.test(n) ||
    /telefone|telefonia|internet|correios|frete|transporte/i.test(n) ||
    /manutenção|manutencao|reparo|conserto/i.test(n) ||
    /material de (consumo|escritório|escritorio|expediente)/i.test(n) ||
    /honorários|honorarios|consultoria|contabilidade|assessoria/i.test(n) ||
    /publicidade|propaganda|marketing|propag e public/i.test(n) ||
    /seguro[s]?|multas?\s+e\s+juros|multas?\s+de\s+mora|juros\s+de\s+mora|multas?\s+contratuais|multas?\s+fiscais|multas?\s+a\s+pagar|juros passivos|tarifa[s]? banc/i.test(n) ||
    /imposto[s]? sobre|contribui(ção|cao) social|pis|cofins|csll|irpj/i.test(n)
  ) {
    return true;
  }

  return false;
}

/**
 * Contas que legitimamente têm natureza ambígua (D ou C dependendo do resultado):
 * - Resultado do Exercício / Período (lucro = C, prejuízo = D)
 * - Ajuste de Exercícios Anteriores / AEA (pode ser positivo ou negativo)
 * - Lucros/Prejuízos Acumulados (quando a empresa acumula perdas o saldo pode ser D)
 * Não devem ser acusadas de "invertidas".
 */
export function isContaNaturezaAmbigua(row: Pick<VisionBalanceteRow, 'nome' | 'classificacao'>): boolean {
  const n = nomeNorm(row);
  return (
    /resultado.*(exercício|exercicio|período|periodo)/i.test(n) ||
    /resultado\s+líquido|resultado\s+liquido/i.test(n) ||
    /resultado\s+antes/i.test(n) ||
    /resultado\s+do\s+período|resultado\s+do\s+periodo/i.test(n) ||
    /\bajuste[s]?.*(exercício|exercicio|anterior|aea)\b/i.test(n) ||
    /\baea\b/i.test(n) ||
    /lucros?\s+acumulados?/i.test(n) ||
    /prejuízo[s]?\s+acumulados?|prejuizo[s]?\s+acumulados?/i.test(n) ||
    /\bsuperávit|\bsuperavit|\bdeficit|\bdéficit/i.test(n)
  );
}

/** Receitas e ganhos — natureza credora */
export function isContaReceita(row: Pick<VisionBalanceteRow, 'nome' | 'classificacao'>): boolean {
  if (isContaCustoDespesa(row)) return false;

  const n = nomeNorm(row);
  const cls = getClassificacao(row as VisionBalanceteRow);
  const root = classRoot(cls);

  if (
    /\breceita\b|\breceitas\b|\bvendas\b|\bfaturamento\b|\bganho\b|\brendimento\b/i.test(n) ||
    /reversão de provis|reversao de provis/i.test(n)
  ) {
    return true;
  }

  // NBC padrão: grupo 3 = receitas
  if (root === '3') return true;

  // Planos legados: receitas no grupo 4
  if (root === '4' && /\breceita\b|\breceitas\b|\bvendas\b/i.test(n)) return true;

  return false;
}

/** Contas retificadoras do ativo (natureza credora no grupo 1) */
export function isContaRetificadora(row: Pick<VisionBalanceteRow, 'nome' | 'classificacao'>): boolean {
  const n = nomeNorm(row);
  const cls = getClassificacao(row as VisionBalanceteRow);
  if (!/^1\./.test(cls) && classRoot(cls) !== '1') return false;
  // Qualquer conta do Ativo com prefixo "(-)" é retificadora: natureza oposta (credora),
  // não só depreciação/amortização/exaustão (ex.: "(-) Baixa custo mercadoria vendida",
  // "(-) Devoluções de mercadorias").
  if (isContaDedutoraPorPrefixo(row)) return true;
  return (
    /depreciação acumulada|depreciacao acumulada/i.test(n) ||
    /amortização acumulada|amortizacao acumulada/i.test(n) ||
    /exaustão acumulada|exaustao acumulada/i.test(n) ||
    // Cobre abreviações usuais no plano (ex.: "DEPREC.", "AMORT.", "EXAUS.", "ACUMU")
    ((/deprecia|deprec|amortiz|amort|exaust|exaus/i.test(n) && /acumulad|acumu/i.test(n)))
  );
}

function normCls(cls: string): string {
  return cls.replace(/\./g, '').replace(/\s/g, '');
}

/** Índice da linha no balancete (por conteúdo, não referência de objeto). */
function indexNoBalancete(row: VisionBalanceteRow, allRows: VisionBalanceteRow[]): number {
  const rows = ensureRows(allRows);
  const cls = getClassificacao(row);
  const nome = (row.nome ?? '').trim();
  const cod = (row.codigo ?? '').trim();
  return rows.findIndex(
    (r) =>
      getClassificacao(r) === cls &&
      (r.nome ?? '').trim() === nome &&
      (r.codigo ?? '').trim() === cod,
  );
}

/**
 * Conta analítica filha direta de ADIANTAMENTO DE LUCROS no balancete.
 * Cobre sócios (ex. CLAITON) cujo código reduzido (1106) não traz a classificação 2.3.2.04.
 */
function isFilhaAdiantamentoLucros(row: VisionBalanceteRow, allRows: VisionBalanceteRow[]): boolean {
  if (row.tipo === 'S') return false;
  const rows = ensureRows(allRows);
  if (rows.length === 0) return false;

  const idx = indexNoBalancete(row, rows);
  if (idx <= 0) return false;

  // Sobe até a primeira sintética acima — se for ADIANTAMENTO DE LUCROS, é filha
  for (let i = idx - 1; i >= 0; i--) {
    const above = rows[i];
    const nomeAbove = (above.nome ?? '').toLowerCase();
    if (/adiantamento.*(lucro|lucros|dividendo)/i.test(nomeAbove)) return true;
    if (above.tipo === 'S') return false;
  }
  return false;
}

function classificacaoIndicaRedutoraPL(cls: string): boolean {
  if (!cls) return false;
  const norm = normCls(cls);
  if (!/^2/.test(norm) && !/^23/.test(norm)) return false;

  if (/^2\.(3|03)\.\d+\.04(\.|$)/.test(cls)) return true;
  if (/^2\.(3|03)\.2\.04(\.|$)/.test(cls)) return true;
  // Domínio sem ponto: 23204, 2320400001, 23.204
  if (/^23204/.test(norm)) return true;

  return false;
}

/**
 * Contas redutoras do Patrimônio Líquido (natureza devedora no grupo 2 — CPC 26 / NBC TG).
 * Ex.: Adiantamento de Lucros, Ações em Tesouraria.
 * Saldo a débito é correto — reduz o PL.
 */
export function isContaRedutoraPL(
  row: Pick<VisionBalanceteRow, 'nome' | 'classificacao' | 'codigo'>,
  allRows: VisionBalanceteRow[] = [],
): boolean {
  const rows = ensureRows(allRows);
  const n = nomeNorm(row);
  const fullRow = row as VisionBalanceteRow;

  if (
    /adiantamento.*(lucro|lucros|dividendo)/i.test(n) ||
    /adiantamento a (sócios|socios|quotistas|administradores)/i.test(n) ||
    /adiantamento para futuro aumento de capital/i.test(n) ||
    /ações em tesouraria|acoes em tesouraria/i.test(n) ||
    /títulos em tesouraria|titulos em tesouraria/i.test(n)
  ) {
    return true;
  }

  const candidatos = [
    getClassificacao(fullRow),
    fullRow.classificacao?.trim() ?? '',
    fullRow.codigo?.trim() ?? '',
  ].filter(Boolean);

  for (const c of candidatos) {
    if (classificacaoIndicaRedutoraPL(c)) return true;
  }

  // Herda do grupo: conta analítica sob ADIANTAMENTO DE LUCROS (ex. sócio sem nome no padrão)
  const norm = normCls(getClassificacao(fullRow));
  if (norm.length >= 9 && /^23204/.test(norm)) return true;

  if (rows.length > 0 && /^23204/.test(norm)) {
    const temPaiAdiantamento = rows.some((other) => {
      if (other === fullRow) return false;
      return /adiantamento.*(lucro|lucros)/i.test(other.nome ?? '');
    });
    if (temPaiAdiantamento) return true;
  }

  if (isFilhaAdiantamentoLucros(fullRow, rows)) return true;

  return false;
}

/**
 * Passivo circulante/não circulante (grupo 2, exceto PL redutor e contas ambíguas).
 * Natureza credora — saldo a crédito é correto; saldo a débito é invertido.
 */
export function isContaPassivo(
  row: Pick<VisionBalanceteRow, 'nome' | 'classificacao' | 'codigo'>,
  allRows: VisionBalanceteRow[] = [],
): boolean {
  const cls = getClassificacao(row as VisionBalanceteRow);
  if (classRoot(cls) !== '2') return false;
  if (isContaRedutoraPL(row, allRows)) return false;
  if (isContaNaturezaAmbigua(row)) return false;
  // Subgrupo 2.3 = Patrimônio Líquido (capital, reservas etc.) — credora, mas não "passivo" operacional
  if (/^2\.(3|03)/.test(cls) || /^23/.test(cls.replace(/\./g, ''))) return false;
  return true;
}

/** Nomes de bancos/fintechs (C6 sem exigir espaço após o dígito). */
export function isNomeInstituicaoBancaria(nome: string): boolean {
  const n = (nome ?? '').toLowerCase();
  if (/caixa geral|fundo fixo/i.test(n)) return false;
  return (
    /\bbanco\b/i.test(n) ||
    /conta\s+movimento|conta\s+corrente/i.test(n) ||
    /\b(c6|c6bank|c6\s*bank|banco\s*c6)\b/i.test(n) ||
    /sicredi|itau|ita[uú]|bradesco|santander|caixa\s+econ/i.test(n) ||
    /nu\s*bank|nubank|\binter\b|btg|hsbc|safra|banrisul|sicoob|cresol/i.test(n) ||
    /\bbb\b|\bb\.?\s*b\.?\b/i.test(n)
  );
}

function getParentRow(
  row: Pick<VisionBalanceteRow, 'classificacao'>,
  allRows: VisionBalanceteRow[],
): VisionBalanceteRow | undefined {
  const cls = getClassificacao(row as VisionBalanceteRow);
  if (!cls) return undefined;

  let bestParent: VisionBalanceteRow | undefined;
  let bestLen = 0;

  for (const r of allRows) {
    const rCls = getClassificacao(r);
    if (!rCls) continue;
    if (cls !== rCls && cls.startsWith(rCls + '.') && rCls.length > bestLen) {
      bestParent = r;
      bestLen = rCls.length;
    }
  }
  return bestParent;
}

/** Natureza contábil normal da conta (CPC 26) */
export function getNaturezaEsperada(
  row: Pick<VisionBalanceteRow, 'nome' | 'classificacao' | 'codigo'>,
  allRows: VisionBalanceteRow[] = [],
): NaturezaSaldo {
  // 1. PRIORIDADE ABSOLUTA E FONTE ÚNICA DA VERDADE:
  // Se houver configuração na modal "Configuração da Natureza das Contas" (resolveNaturezaManual),
  // o sistema respeita EXCLUSIVAMENTE a regra cadastrada (e suas descrições invertidas/redutoras).
  const manual = resolveNaturezaManual(row);
  if (manual) return manual;

  const rows = ensureRows(allRows);
  const temPrefixoDedutora = isContaDedutoraPorPrefixo(row);

  // REGRA REFORÇADA: conta com o sinal (-) na descrição tem natureza OPOSTA à da
  // CONTA PAI imediata na hierarquia do balancete (dedutora/retificadora).
  // EXCEÇÃO (dupla inversão): se o pai JÁ está invertido em relação à natureza
  // padrão do grupo raiz — ou seja, o próprio pai é um grupo dedutor/retificador,
  // ex.: "(-) DEDUÇÕES DA RECEITA BRUTA" (D dentro do grupo 3) — a filha com (-)
  // pertence ao mesmo conjunto dedutor e HERDA a natureza do pai, sem inverter de
  // novo. Sem isso, "(-) SIMPLES NACIONAL" (dedução da receita, 3.1.2.x) voltava
  // a ficar credora. Sem pai localizável, cai no fallback pelo grupo raiz
  // (Ativo D → C, Passivo/PL/Receita C → D, Custos/Despesas D → C).
  if (temPrefixoDedutora) {
    const parent = getParentRow(row as VisionBalanceteRow, rows);
    if (parent) {
      const naturezaPai = getNaturezaEsperada(parent, rows);
      const padraoPai = naturezaPadraoGrupo(classRoot(getClassificacao(parent)));
      if (naturezaPai !== padraoPai) return naturezaPai;
      return naturezaPai === 'D' ? 'C' : 'D';
    }
    const root = classRoot(getClassificacao(row as VisionBalanceteRow));
    return naturezaPadraoGrupo(root) === 'D' ? 'C' : 'D';
  }

  // Banco no ativo (ou nome de instituição) → sempre devedora, mesmo se classificação estiver errada no plano.
  if (isContaDisponibilidade(row)) {
    return temPrefixoDedutora ? 'C' : 'D';
  }

  // isContaRetificadora já detecta o prefixo "(-)" para grupo 1
  if (isContaRetificadora(row)) return 'C';
  if (isContaRedutoraPL(row, rows)) return 'D';

  // Da natureza "normal" do grupo/nome da conta (sem considerar ainda o prefixo "(-)").
  if (isContaCustoDespesa(row)) {
    return temPrefixoDedutora ? 'C' : 'D';
  }
  
  if (isContaPassivoOperacional(row, rows)) {
    return temPrefixoDedutora ? 'D' : 'C';
  }
  
  if (isContaReceita(row)) {
    return temPrefixoDedutora ? 'D' : 'C';
  }

  const root = classRoot(getClassificacao(row as VisionBalanceteRow));
  switch (root) {
    case '1':
      return temPrefixoDedutora ? 'C' : 'D';
    case '2':
      return temPrefixoDedutora ? 'D' : 'C';
    case '3':
      return temPrefixoDedutora ? 'D' : 'C';
    case '4':
    case '5':
    case '6':
    case '7':
      return temPrefixoDedutora ? 'C' : 'D';
    default:
      return temPrefixoDedutora ? 'C' : 'D';
  }
}

/** Rótulo da natureza normal da conta (Devedora / Credora — CPC 26). */
export function formatNaturezaConta(
  row: Pick<VisionBalanceteRow, 'nome' | 'classificacao' | 'codigo'>,
  allRows: VisionBalanceteRow[] = [],
): { codigo: NaturezaSaldo; label: string } {
  const codigo = getNaturezaEsperada(row, allRows);
  return { codigo, label: codigo === 'D' ? 'Devedora' : 'Credora' };
}

/** Saldo inicial com sinal contábil (+ = devedor, − = credor) */
function saldoInicialAssinado(
  row: VisionBalanceteRow,
  esperada: NaturezaSaldo,
): number {
  const si = row.saldoInicial;
  const tol = tolerancia(si);
  if (Math.abs(si) < tol) return 0;

  const nat = row.naturezaSaldoInicial;
  if (nat === 'D') return Math.abs(si);
  if (nat === 'C') return -Math.abs(si);

  return esperada === 'D' ? Math.abs(si) : -Math.abs(si);
}

/** Saldo líquido recalculado (+ devedor, − credor) a partir da movimentação */
function recalcularSaldoLiquido(row: VisionBalanceteRow, allRows: VisionBalanceteRow[] = []): number {
  const rows = ensureRows(allRows);
  const esperada = getNaturezaEsperada(row, rows);
  const si = saldoInicialAssinado(row, esperada);
  return si + row.debito - row.credito;
}

/** Saldo devedor e credor (magnitudes) derivados do saldo líquido */
function saldosRecalculados(row: VisionBalanceteRow, allRows: VisionBalanceteRow[] = []) {
  const rows = ensureRows(allRows);
  const liquido = recalcularSaldoLiquido(row, rows);
  return {
    devedor: liquido > 0 ? liquido : 0,
    credor: liquido < 0 ? -liquido : 0,
  };
}

function temMovimentacao(row: VisionBalanceteRow, tol: number): boolean {
  return row.debito + row.credito > tol || Math.abs(row.saldoInicial) > tol;
}

/** Infere D/C a partir da movimentação quando a importação não preservou o indicador */
function inferNaturezaSaldoFromMovimento(row: VisionBalanceteRow, allRows: VisionBalanceteRow[] = []): 'D' | 'C' | undefined {
  const rows = ensureRows(allRows);
  const v = row.saldoFinal;
  const tol = tolerancia(v);
  if (Math.abs(v) < tol) return undefined;

  const liquido = recalcularSaldoLiquido(row, rows);
  const absV = Math.abs(v);

  if (Math.abs(liquido) >= tol) {
    if (Math.abs(Math.abs(liquido) - absV) < tol) {
      return liquido > 0 ? 'D' : 'C';
    }
  }

  const { devedor, credor } = saldosRecalculados(row, rows);
  if (devedor > credor + tol) return 'D';
  if (credor > devedor + tol) return 'C';

  return undefined;
}

/** Preenche naturezaSaldoFinal a partir do OCR ou da movimentação (balancetes já importados) */
export function enrichNaturezaSaldoImportado(
  row: VisionBalanceteRow,
  allRows: VisionBalanceteRow[] = [],
): VisionBalanceteRow {
  if (row.naturezaSaldoFinal) return row;
  const inferida = inferNaturezaSaldoFromMovimento(row, ensureRows(allRows));
  if (inferida) return { ...row, naturezaSaldoFinal: inferida };
  return row;
}

/**
 * Natureza do saldo para exibição (D/C) — convenção Domínio (magnitude positiva + indicador).
 */
function inferNaturezaExibicao(row: VisionBalanceteRow, allRows: VisionBalanceteRow[] = []): NaturezaSaldo {
  const esperada = getNaturezaEsperada(row, allRows);
  const v = row.saldoFinal;
  const tol = tolerancia(v);
  const semMovimentoPeriodo = row.debito + row.credito <= tol;

  if (Math.abs(v) < tol) return esperada;

  const absV = Math.abs(v);
  const temMov = temMovimentacao(row, tol);
  const priorizaMovimento = temMov || isContaDisponibilidade(row);

  if (priorizaMovimento) {
    const liquido = recalcularSaldoLiquido(row, allRows);
    const tolLiq = tolerancia(liquido);
    if (Math.abs(liquido) >= tolLiq) {
      if (isContaDisponibilidade(row) || Math.abs(Math.abs(liquido) - absV) < tol) {
        return liquido > 0 ? 'D' : 'C';
      }
    }
    const { devedor, credor } = saldosRecalculados(row, allRows);
    if (devedor > credor + tol) return 'D';
    if (credor > devedor + tol) return 'C';
  }

  // Em mês sem movimento, evita extrapolar natureza "herdada":
  if (semMovimentoPeriodo && Math.abs(row.saldoInicial) > tolerancia(row.saldoInicial)) {
    if (row.naturezaSaldoInicial === 'D' || row.naturezaSaldoInicial === 'C') {
      return row.naturezaSaldoInicial;
    }
    return esperada;
  }

  if (row.naturezaSaldoFinal === 'D' || row.naturezaSaldoFinal === 'C') {
    return row.naturezaSaldoFinal;
  }

  if (Math.abs(row.saldoInicial) > tolerancia(row.saldoInicial)) {
    if (row.naturezaSaldoInicial === 'D' || row.naturezaSaldoInicial === 'C') {
      return row.naturezaSaldoInicial;
    }
  }

  // 3. Sem movimentação: magnitude positiva → natureza esperada do grupo
  if (v > 0) return esperada;

  // 4. Valor negativo (convenção assinada) = credor
  if (v < 0) return 'C';

  return esperada;
}

/**
 * Inversão = natureza exibida difere da natureza esperada (CPC 26).
 * Passivo a crédito → correto | Passivo a débito → invertido.
 */
/** Caixa, bancos e aplicações financeiras (grupo 1 — CPC 26 / ITG 2000). */
export function isContaDisponibilidade(
  row: Pick<VisionBalanceteRow, 'nome' | 'classificacao' | 'codigo' | 'tipo'>,
): boolean {
  if (row.tipo === 'S') return false;
  const cls = getClassificacao(row as VisionBalanceteRow).replace(/\./g, '');
  const n = nomeNorm(row);
  if (/^11101/.test(cls) || /^1101/.test(cls)) return true;
  if (/^11102/.test(cls) || /^1102/.test(cls)) return true;
  if (/^11103/.test(cls) || /^1103/.test(cls)) return true;
  // Detecção pelo nome só vale para contas no grupo 1 (Ativo).
  // Contas em outros grupos (ex.: empréstimos no Passivo grupo 2) podem ter
  // "BB", "Banco" etc. no nome sem serem disponibilidades de caixa.
  if (!/^1/.test(cls)) return false;
  return isNomeInstituicaoBancaria(row.nome ?? '') ||
    /aplica[cç][aã]o\s+financeira|aplica[cç][oõ]es\s+financeiras/i.test(n);
}

function detectarInversao(row: VisionBalanceteRow, allRows: VisionBalanceteRow[] = []): boolean {
  // Conta sintética normalmente é agregadora, porém "Reservas" (PL) precisa
  // acusar inversão quando estiver com natureza oposta.
  const sinteticaReserva = row.tipo === 'S' && /\breservas?\b/i.test(nomeNorm(row));
  if (row.tipo === 'S' && !sinteticaReserva) return false;
  // Contas dedutoras (prefixo "(-)") têm natureza esperada já invertida em
  // relação ao grupo pai (calculada em getNaturezaEsperada) — a comparação
  // abaixo usa essa natureza correta, então NÃO são excluídas da detecção.
  if (isContaRedutoraPL(row, allRows)) return false;
  if (isContaNaturezaAmbigua(row)) return false;

  // Contas de resultado (receitas, custos, despesas — grupos 3-7) herdam a natureza
  // do grupo pai pelo plano de contas e podem ter saldo no lado oposto em meses
  // específicos (devoluções, correções, reversões). Sinalizar inversão nessas
  // contas gera falsos positivos; a detecção é reservada às contas patrimoniais
  // (Ativo grupo 1 e Passivo/PL grupo 2) onde saldo no lado errado é anômalo —
  // exceto quando o usuário já classificou manualmente a natureza dessa conta
  // (override do Balancete), caso em que a detecção passa a valer também aqui.
  const rootCls = classRoot(getClassificacao(row as VisionBalanceteRow));
  if (/^[3-7]/.test(rootCls) && !resolveNaturezaManual(row)) return false;

  const rows = ensureRows(allRows);
  const esperada = getNaturezaEsperada(row, rows);
  const tolSf = tolerancia(row.saldoFinal);
  const tolSi = tolerancia(row.saldoInicial);
  const semMovimentoPeriodo = row.debito + row.credito <= tolSf;

  // Movimentação no período: saldo líquido (SI+D-C) prevalece sobre magnitude positiva sem D/C (Domínio).
  if (!semMovimentoPeriodo) {
    const liquido = recalcularSaldoLiquido(row, rows);
    const tolLiq = tolerancia(liquido);
    if (Math.abs(liquido) >= tolLiq) {
      const natLiq: NaturezaSaldo = liquido > 0 ? 'D' : 'C';
      if (natLiq !== esperada) return true;
    }
  }

  // Em período sem movimento, valida pela natureza de SI (quando disponível),
  // evitando carregar "invertida" de um mês para o outro.
  if (semMovimentoPeriodo && Math.abs(row.saldoInicial) >= tolSi) {
    if (row.naturezaSaldoInicial === 'D' || row.naturezaSaldoInicial === 'C') {
      return row.naturezaSaldoInicial !== esperada;
    }
  }

  // Regra principal: se SI/SF informam natureza, usa essa evidência diretamente.
  if (Math.abs(row.saldoFinal) >= tolSf && (row.naturezaSaldoFinal === 'D' || row.naturezaSaldoFinal === 'C')) {
    return row.naturezaSaldoFinal !== esperada;
  }
  if (Math.abs(row.saldoInicial) >= tolSi && (row.naturezaSaldoInicial === 'D' || row.naturezaSaldoInicial === 'C')) {
    return row.naturezaSaldoInicial !== esperada;
  }

  if (Math.abs(row.saldoFinal) < tolSf && Math.abs(row.saldoInicial) < tolSi) return false;

  const exibida = inferNaturezaExibicao(row, allRows);

  return exibida !== esperada;
}

export function analisarSaldoContabil(
  row: VisionBalanceteRow,
  allRows: VisionBalanceteRow[] = [],
): SaldoContabil {
  const rows = ensureRows(allRows);
  const naturezaEsperada = getNaturezaEsperada(row, rows);
  const natureza = inferNaturezaExibicao(row, rows);
  const valor = Math.abs(row.saldoFinal);
  const invertido = detectarInversao(row, rows);
  return { valor, natureza, naturezaEsperada, invertido };
}

export function formatSaldoContabil(
  row: VisionBalanceteRow,
  allRows: VisionBalanceteRow[] = [],
): string {
  const { valor, natureza } = analisarSaldoContabil(row, allRows);
  if (valor < 0.001) return '—';
  const fmt = valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${fmt} ${natureza}`;
}

/** Valor e indicador D/C do saldo final para exibição no balancete. */
export function formatSaldoFinalBalancete(
  row: VisionBalanceteRow,
  allRows: VisionBalanceteRow[] = [],
): { valorFmt: string; indicador: NaturezaSaldo | null; invertido: boolean; naturezaEsperada: NaturezaSaldo } {
  const s = analisarSaldoContabil(row, allRows);
  if (s.valor < 0.001) {
    return { valorFmt: '—', indicador: null, invertido: false, naturezaEsperada: s.naturezaEsperada };
  }
  return {
    valorFmt: s.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    indicador: s.natureza,
    invertido: s.invertido,
    naturezaEsperada: s.naturezaEsperada,
  };
}

/** Formata saldo inicial com indicador D/C (convenção Domínio). */
export function formatSaldoInicialContabil(
  row: VisionBalanceteRow,
  allRows: VisionBalanceteRow[] = [],
): string {
  const si = row.saldoInicial;
  if (Math.abs(si) < 0.001) return '—';
  const nat = row.naturezaSaldoInicial ?? getNaturezaEsperada(row, allRows);
  const fmt = Math.abs(si).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${fmt} ${nat}`;
}

export function formatValorComNatureza(valor: number): string {
  if (Math.abs(valor) < 0.001) return '—';
  const natureza: NaturezaSaldo = valor >= 0 ? 'D' : 'C';
  const fmt = Math.abs(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${fmt} ${natureza}`;
}

export function listarContasInvertidas(rows: VisionBalanceteRow[]): VisionBalanceteRow[] {
  const safe = ensureRows(rows);
  return safe.filter((r) => detectarInversao(r, safe));
}

/**
 * Inversão válida no mês do balancete (PDF comparativo mensal).
 * Exige saldo final no período — não marca por SI de meses anteriores sem SF no mês.
 */
export function contaInvertidaNoPeriodoMensal(
  row: VisionBalanceteRow,
  allRows: VisionBalanceteRow[] = [],
): boolean {
  const rows = ensureRows(allRows);
  const tol = tolerancia(row.saldoFinal);
  const temSaldoFinal = Math.abs(row.saldoFinal ?? 0) >= tol;
  const temMovimentoNoMes = (row.debito ?? 0) + (row.credito ?? 0) > tol;

  if (!temSaldoFinal && !temMovimentoNoMes) return false;

  const analise = analisarSaldoContabil(row, rows);
  if (!analise.invertido) return false;

  if (temSaldoFinal && analise.natureza === analise.naturezaEsperada) return false;

  return true;
}

export function formatSaldoDemonstracao(
  saldoFinal: number,
  classificacao: string,
  nome: string,
): string {
  const row = {
    saldoFinal,
    classificacao,
    nome,
    codigo: '',
    saldoInicial: 0,
    debito: 0,
    credito: 0,
  } as VisionBalanceteRow;
  return formatSaldoContabil(row);
}

export function isSaldoInvertidoDemonstracao(
  saldoFinal: number,
  classificacao: string,
  nome: string,
): boolean {
  const row = {
    saldoFinal,
    classificacao,
    nome,
    codigo: '',
    saldoInicial: 0,
    debito: 0,
    credito: 0,
  } as VisionBalanceteRow;
  return detectarInversao(row, [row]);
}

/**
 * Índices dos lançamentos (já em ordem cronológica) que são a causa-raiz da
 * inversão de natureza da conta — mesma regra do modal do Razão e do filtro
 * "Contas com razão invertido" do Balancete.
 *
 * Simula a conta já "corrigida": a cada lançamento de natureza oposta que
 * mantém/causa saldo invertido, marca-o e não o soma ao saldo corrigido.
 */
export function selecionarIndicesCausaRaizInvertidos(
  lancamentos: Array<{ debito?: number; credito?: number }>,
  naturezaEsperada: NaturezaSaldo | null,
  saldoAnteriorAssinado = 0,
  naturezaAmbigua = false,
): Set<number> {
  const indices = new Set<number>();
  if (!naturezaEsperada || naturezaAmbigua) return indices;

  let saldoCorrigido = saldoAnteriorAssinado;
  for (let idx = 0; idx < lancamentos.length; idx++) {
    const r = lancamentos[idx]!;
    const deb = r.debito ?? 0;
    const cred = r.credito ?? 0;
    const ownNat: NaturezaSaldo | null =
      deb > cred ? 'D' : cred > deb ? 'C' : null;
    const delta = deb - cred;
    const proximo = saldoCorrigido + delta;
    const naturezaAntes: NaturezaSaldo | null =
      Math.abs(saldoCorrigido) < 0.005 ? null : saldoCorrigido > 0 ? 'D' : 'C';
    const naturezaProximo: NaturezaSaldo | null =
      Math.abs(proximo) < 0.005 ? null : proximo > 0 ? 'D' : 'C';
    const antesInvertido = naturezaAntes !== null && naturezaAntes !== naturezaEsperada;
    const depoisInvertido = naturezaProximo !== null && naturezaProximo !== naturezaEsperada;

    // Lançamento da mesma natureza da conta JAMAIS é causa-raiz de inversão
    if (ownNat && ownNat !== naturezaEsperada && (antesInvertido || depoisInvertido)) {
      indices.add(idx);
    } else {
      saldoCorrigido = proximo;
    }
  }
  return indices;
}
