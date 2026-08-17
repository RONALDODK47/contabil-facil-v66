import type { VisionBalanceteRow, VisionPlanoRow } from '../types/accounting';

export type DemonstracaoTipo = 'balanco' | 'dre' | 'dmpl' | 'dlpa' | 'nota_explicativa' | 'dfc';

export type DemonstracaoLinha = {
  codigoReduzido: string;
  classificacao: string;
  nome: string;
  tipo?: 'S' | 'A';
  nivel: number;
  saldoInicial: number;
  debito: number;
  credito: number;
  saldoFinal: number;
};

function codeLengthToLevel(len: number): number {
  if (len <= 1) return 1;
  if (len <= 2) return 2;
  if (len <= 3) return 3;
  if (len <= 5) return 4;
  if (len <= 10) return 5;
  return 6;
}

function isCodigoReduzido(s: string): boolean {
  return /^\d{1,7}$/.test(s.replace(/\./g, '')) && !s.includes('.');
}

function isClassificacaoEstruturada(s: string): boolean {
  return s.includes('.') && s.split('.').filter(Boolean).length >= 3;
}

/** Classificação estruturada (ex.: 1.1.1.01) — usada para filtrar e hierarquizar. */
export function getClassificacao(row: VisionBalanceteRow): string {
  const cls = row.classificacao?.trim() ?? '';
  const cod = row.codigo?.trim() ?? '';

  // Preferir código estruturado (2.3.2.04.00001) sobre reduzido (1106) quando ambos existem
  if (cls && cod) {
    if (isClassificacaoEstruturada(cls) && isCodigoReduzido(cod)) return cls;
    if (isClassificacaoEstruturada(cod) && isCodigoReduzido(cls)) return cod;
  }

  if (cls && /^\d/.test(cls) && !isCodigoReduzido(cls)) return cls;
  if (cod && /^\d/.test(cod) && isClassificacaoEstruturada(cod)) return cod;
  if (cls && /^\d/.test(cls)) return cls;
  if (cod && /^\d[\d.]*$/.test(cod)) return cod;
  return cls || cod || '';
}

function normClassificacao(cls: string): string {
  return cls.replace(/\./g, '').replace(/\s/g, '');
}

function normReducedCode(code: string): string {
  const digits = code.replace(/\D/g, '');
  if (!digits) return '';
  const normalized = digits.replace(/^0+/, '');
  return normalized || '0';
}

/** Converte classificação Domínio/CPC em segmentos hierárquicos para ordenação. */
export function classificacaoToSegments(codigo: string): number[] {
  const raw = codigo.trim();
  if (!raw) return [];

  if (raw.includes('.')) {
    return raw.split('.').filter(Boolean).map((x) => parseInt(x, 10) || 0);
  }

  const c = normClassificacao(raw);
  if (c.length <= 1) return [parseInt(c, 10) || 0];

  // Domínio sem ponto: 11 → [1,1], 21 → [2,1], 111 → [1,1,1]
  const segments = [parseInt(c[0], 10) || 0];
  for (let i = 1; i < c.length; i++) {
    segments.push(parseInt(c[i], 10) || 0);
  }
  return segments;
}

/** Ordem hierárquica CPC/NBC TG (raiz → filhos → irmãos). */
export function compareClassificacaoContabil(a: string, b: string): number {
  const sa = classificacaoToSegments(a);
  const sb = classificacaoToSegments(b);
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    const diff = (sa[i] ?? 0) - (sb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

type ClassificacaoSortable = { classificacao?: string; codigo?: string; nome?: string };

function getClassificacaoSortable(row: ClassificacaoSortable): string {
  const cls = row.classificacao?.trim() ?? '';
  const cod = row.codigo?.trim() ?? '';

  if (cls && cod) {
    if (isClassificacaoEstruturada(cls) && isCodigoReduzido(cod)) return cls;
    if (isClassificacaoEstruturada(cod) && isCodigoReduzido(cls)) return cod;
  }

  if (cls && /^\d/.test(cls) && !isCodigoReduzido(cls)) return cls;
  if (cod && /^\d/.test(cod) && isClassificacaoEstruturada(cod)) return cod;
  if (cls && /^\d/.test(cls)) return cls;
  if (cod && /^\d[\d.]*$/.test(cod)) return cod;
  return cls || cod || '';
}

export function sortRowsByClassificacao<T extends ClassificacaoSortable>(
  rows: T[],
  getCls: (r: T) => string = (r) => getClassificacaoSortable(r),
): T[] {
  return [...rows].sort((a, b) => {
    const diff = compareClassificacaoContabil(getCls(a), getCls(b));
    if (diff !== 0) return diff;
    return (a.nome ?? '').localeCompare((b.nome ?? ''), 'pt-BR');
  });
}

/** Código reduzido Domínio — nunca inventado; vem do balancete ou plano. */
export function getCodigoReduzido(row: VisionBalanceteRow, plano?: VisionPlanoRow): string {
  const fromBalancete = row.codigo?.trim();
  const cls = getClassificacao(row);

  // Se codigo do balancete é numérico curto e classificacao é estruturada, codigo = reduzido
  if (fromBalancete && cls && cls !== fromBalancete && /^\d{1,7}$/.test(fromBalancete)) {
    return fromBalancete;
  }

  if (plano?.codigoReduzido) return plano.codigoReduzido;

  // Se codigo parece reduzido (sem pontos, curto)
  if (fromBalancete && !fromBalancete.includes('.') && /^\d{1,7}$/.test(fromBalancete)) {
    return fromBalancete;
  }

  return '—';
}

function inferNivel(classificacao: string, plano?: VisionPlanoRow): number {
  if (plano?.nivel) return plano.nivel;
  const parts = classificacao.split('.').filter(Boolean);
  if (parts.length > 1) return Math.min(parts.length, 6);
  return codeLengthToLevel(classificacao.replace(/\./g, '').length);
}

function findPlanoRow(classificacao: string, planoRows: VisionPlanoRow[]): VisionPlanoRow | undefined {
  const norm = classificacao.replace(/\s/g, '');
  return planoRows.find((p) => {
    const pc = p.codigo.replace(/\s/g, '');
    return pc === norm || pc.replace(/\./g, '') === norm.replace(/\./g, '');
  });
}

function getCodigosComparaveis(row: VisionBalanceteRow): string[] {
  const out: string[] = [];
  const cls = getClassificacao(row);
  const cod = row.codigo?.trim() ?? '';
  if (cls) {
    const nc = normClassificacao(cls);
    if (nc) out.push(nc);
  }
  if (cod && /^\d/.test(cod)) {
    const nc = normClassificacao(cod);
    if (nc && !out.includes(nc)) out.push(nc);
  }
  return out;
}

function findPlanoRowForBalancete(row: VisionBalanceteRow, planoRows: VisionPlanoRow[]): VisionPlanoRow | undefined {
  const classificacao = getClassificacao(row);
  const byCls = findPlanoRow(classificacao, planoRows);
  if (byCls) return byCls;
  const cod = row.codigo?.trim();
  if (!cod) return undefined;
  const nc = normClassificacao(cod);
  const reducedNc = normReducedCode(nc);
  return planoRows.find((p) => {
    if (p.codigoReduzido && normReducedCode(p.codigoReduzido) === reducedNc) return true;
    const pc = normClassificacao(p.codigo);
    return pc === nc;
  });
}

function isNomeGrupoSintetico(nome: string): boolean {
  const n = nome.trim();
  if (n.length < 3) return false;
  return n === n.toUpperCase() && /[A-ZÁÉÍÓÚÃÕÇ]/.test(n) && !/[a-záéíóúãõç]/.test(n);
}

function isFormatoAnaliticoDominio(classificacao: string): boolean {
  const parts = classificacao.split('.').filter(Boolean);
  if (parts.length >= 5) return true;
  const lastPart = parts[parts.length - 1] ?? '';
  return lastPart.length >= 5 && /^\d+$/.test(lastPart);
}

/**
 * Resolve Sintética (S) ou Analítica (A): plano de contas → hierarquia do balancete → heurística Domínio.
 */
export function resolveTipoConta(
  row: VisionBalanceteRow,
  allRows: VisionBalanceteRow[],
  planoRows: VisionPlanoRow[] = [],
): 'S' | 'A' {
  if (row.tipo === 'S' || row.tipo === 'A') return row.tipo;

  const classificacao = getClassificacao(row);
  const plano = findPlanoRowForBalancete(row, planoRows);
  if (plano?.tipo === 'S' || plano?.tipo === 'A') return plano.tipo;

  const keys = getCodigosComparaveis(row);
  if (keys.length === 0) return 'A';

  const isPrefixOfOther = allRows.some((other) => {
    if (other === row) return false;
    const otherKeys = getCodigosComparaveis(other);
    return keys.some((k) => otherKeys.some((ok) => ok.length > k.length && ok.startsWith(k)));
  });
  if (isPrefixOfOther) return 'S';

  if (isFormatoAnaliticoDominio(classificacao)) return 'A';

  // Linha com movimento real (débito/crédito) é um lançamento, nunca conta sintética —
  // o histórico do razão pode estar em CAIXA ALTA (ex.: "ENCERRAMENTO DO EXERCÍCIO")
  // sem ser nome de conta; o heurístico abaixo é só para nome de CONTA (plano/balancete).
  const temMovimento = (row.debito ?? 0) > 0 || (row.credito ?? 0) > 0;
  const temContasEstruturadas = allRows.some((r) => getClassificacao(r).includes('.'));
  if (
    !temMovimento &&
    temContasEstruturadas &&
    !classificacao.includes('.') &&
    keys.some((k) => k.length <= 5) &&
    isNomeGrupoSintetico(row.nome ?? '')
  ) {
    return 'S';
  }

  if (classificacao.includes('.')) {
    const parts = classificacao.split('.').filter(Boolean);
    const prefix = normClassificacao(classificacao);
    const hasChildPath = allRows.some((other) => {
      if (other === row) return false;
      const oc = getClassificacao(other);
      if (!oc.includes('.')) return false;
      const op = normClassificacao(oc);
      return op.length > prefix.length && op.startsWith(prefix);
    });
    if (hasChildPath && parts.length <= 4) return 'S';
  }

  return 'A';
}

/** Enriquece linhas do balancete com tipo S/A inferido */
export function enrichBalanceteComTipo(
  rows: VisionBalanceteRow[],
  planoRows: VisionPlanoRow[] = [],
): VisionBalanceteRow[] {
  return rows.map((r) => ({
    ...r,
    tipo: resolveTipoConta(r, rows, planoRows),
  }));
}

function enrichRow(row: VisionBalanceteRow, planoRows: VisionPlanoRow[], allRows: VisionBalanceteRow[]): DemonstracaoLinha {
  const classificacao = getClassificacao(row);
  const plano = findPlanoRowForBalancete(row, planoRows);
  return {
    codigoReduzido: getCodigoReduzido(row, plano),
    classificacao,
    nome: row.nome?.trim() || plano?.nome || '—',
    tipo: resolveTipoConta(row, allRows, planoRows),
    nivel: inferNivel(classificacao, plano),
    saldoInicial: row.saldoInicial,
    debito: row.debito,
    credito: row.credito,
    saldoFinal: row.saldoFinal,
  };
}

function classRoot(classificacao: string): string {
  const first = classificacao.replace(/\./g, '')[0];
  return first ?? '';
}

/** Grupos de resultado de natureza devedora (despesas/custos) */
const ROOTS_DESPESA = new Set(['4', '5', '6', '7']);

/**
 * Custos/despesas dentro do grupo 3 (estrutura Domínio: 3.1.2 custos, 3.1.3 despesas, 3.2+ etc.)
 * ex. 3.1.3.03.00002 COMBUSTÍVEL
 */
export function isGrupo3CustoDespesa(classificacao: string): boolean {
  if (classRoot(classificacao) !== '3') return false;
  const parts = classificacao.split('.').filter(Boolean);

  if (parts.length >= 2) {
    const sub = parseInt(parts[1], 10);
    if (!Number.isNaN(sub) && sub >= 2) return true;
  }
  if (parts.length >= 3 && parts[1] === '1') {
    const third = parseInt(parts[2], 10);
    if (!Number.isNaN(third) && third >= 2) return true;
  }
  const stripped = classificacao.replace(/\./g, '');
  if (stripped.length >= 2) {
    const secondDigit = parseInt(stripped[1], 10);
    if (!Number.isNaN(secondDigit) && secondDigit >= 2) return true;
  }

  // Sem ponto: 31xxx com 3º dígito >= 2 (ex.: 312.., 313.., 314..).
  if (stripped.length >= 3 && stripped[0] === '3' && stripped[1] === '1') {
    const thirdDigit = parseInt(stripped[2], 10);
    if (!Number.isNaN(thirdDigit) && thirdDigit >= 2) return true;
  }
  return false;
}

/** Retorna true se a conta pertence ao grupo de receitas (3, excluindo custos/despesas em 3.1.3 etc.) */
function isRaizReceita(classificacao: string): boolean {
  if (classRoot(classificacao) !== '3') return false;
  return !isGrupo3CustoDespesa(classificacao);
}

/** Retorna true se a conta pertence a um grupo de despesas/custos */
function isRaizDespesa(classificacao: string): boolean {
  return ROOTS_DESPESA.has(classRoot(classificacao)) || isGrupo3CustoDespesa(classificacao);
}

/** Retorna true se a conta é de DRE (resultado = receitas + despesas) */
export function isContaDre(classificacao: string): boolean {
  return isRaizReceita(classificacao) || isRaizDespesa(classificacao);
}

function isPatrimonioLiquido(classificacao: string, nome: string): boolean {
  const c = classificacao.toLowerCase();
  const n = nome.toLowerCase();
  // Subgrupo 2.3 ou 2.03 = PL pela estrutura numérica
  if (/^2\.(3|03)/.test(c)) return true;
  if (/^23/.test(c.replace(/\./g, ''))) return true;
  // Nomes específicos de PL — mais restritivos para evitar captura de "lucros do período" ou "reserva técnica"
  return (
    n.includes('patrimônio líquido') ||
    n.includes('patrimonio liquido') ||
    n.includes('capital social') ||
    /reservas? de (capital|lucros|reavaliação|avaliação)/i.test(n) ||
    /lucros? acumulado/i.test(n) ||
    /prejuízo[s]? acumulado|prejuizo[s]? acumulado/i.test(n) ||
    /resultado[s]? do exercício|resultado[s]? do exercicio/i.test(n) ||
    /ajuste[s]? de avaliação patrimonial/i.test(n)
  );
}

function isPassivo(classificacao: string, nome: string): boolean {
  if (classRoot(classificacao) !== '2') return false;
  return !isPatrimonioLiquido(classificacao, nome);
}

function isCaixaEquivalente(classificacao: string, nome: string): boolean {
  const c = classificacao.toLowerCase();
  const n = nome.toLowerCase();
  if (/^1\.1\.(0?1|0?2)/.test(c)) return true;
  return (
    n.includes('caixa') ||
    n.includes('banco') ||
    n.includes('disponível') ||
    n.includes('disponivel') ||
    n.includes('aplicação') ||
    n.includes('aplicacao')
  );
}

function isDlpaAccount(classificacao: string, nome: string): boolean {
  const n = nome.toLowerCase();
  return (
    isPatrimonioLiquido(classificacao, nome) ||
    n.includes('dividendo') ||
    n.includes('juros sobre capital') ||
    n.includes('destina') ||
    n.includes('lucro líquido') ||
    n.includes('lucro liquido')
  );
}

function sortByClassificacao(a: DemonstracaoLinha, b: DemonstracaoLinha): number {
  const diff = compareClassificacaoContabil(a.classificacao, b.classificacao);
  if (diff !== 0) return diff;
  return a.nome.localeCompare(b.nome, 'pt-BR');
}

export function buildDemonstracaoLinhas(
  tipo: DemonstracaoTipo,
  balanceteRows: VisionBalanceteRow[],
  planoRows: VisionPlanoRow[] = []
): DemonstracaoLinha[] {
  const enriched = balanceteRows
    .map((r) => enrichRow(r, planoRows, balanceteRows))
    .filter((r) => r.classificacao.length > 0);

  let filtered: DemonstracaoLinha[];

  switch (tipo) {
    case 'balanco':
      filtered = enriched.filter((r) => {
        const root = classRoot(r.classificacao);
        return root === '1' || root === '2';
      });
      break;
    case 'dre':
      // Inclui grupos 3 (receitas) e 4–7 (custos/despesas — padrão NBC/Domínio)
      filtered = enriched.filter((r) => isContaDre(r.classificacao));
      break;
    case 'dmpl':
      filtered = enriched.filter((r) => isPatrimonioLiquido(r.classificacao, r.nome));
      break;
    case 'dlpa':
      filtered = enriched.filter((r) => isDlpaAccount(r.classificacao, r.nome));
      break;
    case 'dfc':
      filtered = enriched.filter((r) => isCaixaEquivalente(r.classificacao, r.nome));
      break;
    case 'nota_explicativa':
      filtered = enriched.filter(
        (r) => Math.abs(r.saldoFinal) > 0.001 || r.debito > 0 || r.credito > 0
      );
      break;
    default:
      filtered = enriched;
  }

  return filtered.sort(sortByClassificacao);
}

export function splitBalanco(linhas: DemonstracaoLinha[]) {
  const ativo = linhas.filter((r) => classRoot(r.classificacao) === '1');
  const passivo = linhas.filter((r) => isPassivo(r.classificacao, r.nome));
  const pl = linhas.filter((r) => isPatrimonioLiquido(r.classificacao, r.nome));
  return { ativo, passivo, pl };
}

export function splitDre(linhas: DemonstracaoLinha[]) {
  const receitas = linhas.filter((r) => isRaizReceita(r.classificacao));
  const despesas = linhas.filter((r) => isRaizDespesa(r.classificacao));
  return { receitas, despesas };
}

export function sumSaldoFinal(linhas: DemonstracaoLinha[]): number {
  // Usa só contas analíticas quando houver tipo; senão, folhas (sem filhos)
  const analiticas = linhas.filter((r) => r.tipo === 'A');
  if (analiticas.length > 0) {
    return analiticas.reduce((s, r) => s + r.saldoFinal, 0);
  }
  return linhas.reduce((s, r) => s + r.saldoFinal, 0);
}

export function formatMoeda(v: number): string {
  if (Math.abs(v) < 0.001) return '—';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatMoedaDc(v: number): string {
  if (Math.abs(v) < 0.001) return '—';
  const abs = Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v >= 0 ? `${abs} D` : `${abs} C`;
}

export function nivelIndent(nivel: number): string {
  switch (nivel) {
    case 1: return 'pl-0';
    case 2: return 'pl-3';
    case 3: return 'pl-6';
    case 4: return 'pl-9';
    case 5: return 'pl-12';
    default: return 'pl-14';
  }
}

export function nivelTextStyle(nivel: number, tipo?: 'S' | 'A'): string {
  if (tipo === 'S') {
    if (nivel <= 2) return 'text-white font-black';
    return 'text-slate-200 font-bold';
  }
  if (nivel <= 2) return 'text-slate-200 font-bold';
  if (nivel <= 4) return 'text-slate-300 font-semibold';
  return 'text-slate-400 text-[11px]';
}
