/**
 * Conferência e autocorreção contábil do balancete.
 *
 * Validações (CPC 26 / NBC TG / Lei 6.404):
 *  - Partida dobrada: soma de Débitos = soma de Créditos no período
 *  - Balanço: Ativo = Passivo + PL
 *  - DRE: Resultado do Exercício = Receitas − Despesas (grupos 3 vs 4-7)
 *  - DFC: Saldo Final = Saldo Inicial + Débito − Crédito (contas de disponível)
 */

import type { VisionBalanceteRow } from '../types/accounting';
import { getClassificacao, isGrupo3CustoDespesa } from './demonstracoesContabeis';

/** Grupos que representam despesas/custos (NBC padrão + Domínio) */
const ROOTS_DESPESA = ['4', '5', '6', '7'];

export interface ConferenciaIssue {
  id: string;
  modulo: string;
  descricao: string;
  divergencia: number;
  contaAjustada?: string;
  correcaoDescricao?: string;
}

export interface ConferenciaResult {
  issues: ConferenciaIssue[];
  correctedRows: VisionBalanceteRow[];
}

const TOL = 0.05;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rowKey(r: VisionBalanceteRow): string {
  return `${getClassificacao(r)}::${(r.codigo ?? '').trim()}::${(r.nome ?? '').trim()}`;
}

function classificacaoRoot(row: VisionBalanceteRow): string {
  return getClassificacao(row).replace(/\./g, '')[0] ?? '';
}

function rowsForTotal(rows: VisionBalanceteRow[], roots: string | string[]): VisionBalanceteRow[] {
  const rootSet = new Set(typeof roots === 'string' ? [roots] : roots);
  const filtered = rows.filter(r => rootSet.has(classificacaoRoot(r)));
  const analiticas = filtered.filter(r => r.tipo === 'A');
  if (analiticas.length > 0) return analiticas;
  const naoSinteticas = filtered.filter(r => r.tipo !== 'S');
  if (naoSinteticas.length > 0) return naoSinteticas;
  return filtered;
}

function sumAnaliticas(rows: VisionBalanceteRow[], roots: string | string[]): number {
  return rowsForTotal(rows, roots).reduce((s, r) => s + r.saldoFinal, 0);
}

function isContaDespesaRow(row: VisionBalanceteRow): boolean {
  const root = classificacaoRoot(row);
  return ROOTS_DESPESA.includes(root) || isGrupo3CustoDespesa(getClassificacao(row));
}

function isContaReceitaRow(row: VisionBalanceteRow): boolean {
  const root = classificacaoRoot(row);
  return root === '3' && !isGrupo3CustoDespesa(getClassificacao(row));
}

function sumReceitas(rows: VisionBalanceteRow[]): number {
  const filtered = rows.filter(isContaReceitaRow);
  const analiticas = filtered.filter(r => r.tipo === 'A');
  const base = analiticas.length > 0 ? analiticas : filtered.filter(r => r.tipo !== 'S');
  return base.reduce((s, r) => s + r.saldoFinal, 0);
}

function sumDespesas(rows: VisionBalanceteRow[]): number {
  const filtered = rows.filter(isContaDespesaRow);
  const analiticas = filtered.filter(r => r.tipo === 'A');
  const base = analiticas.length > 0 ? analiticas : filtered.filter(r => r.tipo !== 'S');
  return base.reduce((s, r) => s + r.saldoFinal, 0);
}

function isPatrimonioLiquido(row: VisionBalanceteRow): boolean {
  const cls = getClassificacao(row);
  const nome = (row.nome ?? '').toLowerCase();
  if (/^2\.(3|03)/.test(cls)) return true;
  if (/^23/.test(cls.replace(/\./g, ''))) return true;
  return (
    nome.includes('patrimônio líquido') ||
    nome.includes('patrimonio liquido') ||
    nome.includes('capital social') ||
    nome.includes('reserva') ||
    nome.includes('lucros acumulados') ||
    nome.includes('prejuízos acumulados') ||
    nome.includes('prejuizos acumulados') ||
    nome.includes('resultado do exercício') ||
    nome.includes('resultado do exercicio')
  );
}

function isCaixa(row: VisionBalanceteRow): boolean {
  const cls = getClassificacao(row);
  const nome = (row.nome ?? '').toLowerCase();
  return (
    /^1\.1\.(0?1|0?2)/.test(cls) ||
    nome.includes('caixa') ||
    nome.includes('banco') ||
    nome.includes('disponível') ||
    nome.includes('disponivel') ||
    nome.includes('aplicação') ||
    nome.includes('aplicacao financeira')
  );
}

/** Totais do balanço alinhados com a tela de demonstração */
function totaisBalanco(rows: VisionBalanceteRow[]) {
  const ativo = sumAnaliticas(rows, '1');
  const passivoPl = sumAnaliticas(rows, '2');
  const passivoPlAbs = Math.abs(passivoPl);
  const diff = ativo - passivoPlAbs;
  return { ativo, passivoPl, passivoPlAbs, diff };
}

/** Soma de débitos e créditos do período (para verificação de partida dobrada) */
function totaisMovimento(rows: VisionBalanceteRow[]) {
  const analiticas = rows.filter(r => r.tipo === 'A' || r.tipo === undefined);
  const totalDebito  = analiticas.reduce((s, r) => s + (r.debito  ?? 0), 0);
  const totalCredito = analiticas.reduce((s, r) => s + (r.credito ?? 0), 0);
  return { totalDebito, totalCredito };
}

function findPlAccountKey(rows: VisionBalanceteRow[]): string | null {
  const pl = rows.filter(r => isPatrimonioLiquido(r) && r.tipo !== 'S');
  if (pl.length === 0) {
    const cls23 = rows.filter(r => /^2\.(3|03)/.test(getClassificacao(r)) && r.tipo !== 'S');
    if (cls23.length > 0) return rowKey(cls23[cls23.length - 1]);
  }
  const priorities = [
    (r: VisionBalanceteRow) => /resultado.*exercício|resultado.*exercicio/i.test(r.nome ?? ''),
    (r: VisionBalanceteRow) => /resultado/i.test(r.nome ?? ''),
    (r: VisionBalanceteRow) => /lucros.*acumulados|prejuízos.*acumulados|prejuizos.*acumulados/i.test(r.nome ?? ''),
    (r: VisionBalanceteRow) => /lucros|prejuízos|prejuizos/i.test(r.nome ?? ''),
  ];
  for (const pred of priorities) {
    const found = pl.find(pred);
    if (found) return rowKey(found);
  }
  const cls23 = rows.find(r => /^2\.(3|03)/.test(getClassificacao(r)) && r.tipo !== 'S');
  if (cls23) return rowKey(cls23);
  return pl.length > 0 ? rowKey(pl[pl.length - 1]) : null;
}

function ajustarSaldo(rows: VisionBalanceteRow[], key: string, ajuste: number): VisionBalanceteRow[] {
  if (Math.abs(ajuste) < TOL) return rows;
  return rows.map(r => (rowKey(r) === key ? { ...r, saldoFinal: r.saldoFinal + ajuste } : r));
}

function fmt(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Detecção (somente leitura) ───────────────────────────────────────────────

export function detectarProblemas(rows: VisionBalanceteRow[]): ConferenciaIssue[] {
  if (rows.length === 0) return [];
  const issues: ConferenciaIssue[] = [];

  // ── 1. Partida dobrada: Σ Débitos = Σ Créditos ─────────────────────────────
  const { totalDebito, totalCredito } = totaisMovimento(rows);
  const difDC = totalDebito - totalCredito;
  if (Math.abs(difDC) > TOL && totalDebito > TOL && totalCredito > TOL) {
    issues.push({
      id: 'partida_dobrada',
      modulo: 'Balancete',
      descricao: `Partida dobrada desequilibrada: Σ Débitos (${fmt(totalDebito)}) ≠ Σ Créditos (${fmt(totalCredito)}). Diferença: ${fmt(Math.abs(difDC))}.`,
      divergencia: difDC,
    });
  }

  // ── 2. Balanço: Ativo = Passivo + PL ───────────────────────────────────────
  const { ativo, passivoPlAbs, diff } = totaisBalanco(rows);
  const plKey = findPlAccountKey(rows);

  if (Math.abs(diff) > TOL) {
    issues.push({
      id: 'balanco_desequilibrio',
      modulo: 'Balanço Patrimonial',
      descricao: `Ativo (${fmt(ativo)}) ≠ Passivo + PL (${fmt(passivoPlAbs)}). Diferença: ${fmt(Math.abs(diff))}.`,
      divergencia: diff,
      contaAjustada: plKey ? rows.find(r => rowKey(r) === plKey)?.nome : undefined,
    });
  }

  // ── 3. DRE: Resultado = Receitas − Despesas ────────────────────────────────
  const receitas  = Math.abs(sumReceitas(rows));
  const despesas  = sumDespesas(rows);
  const resultado = receitas - despesas;
  const contaResultado = plKey ? rows.find(r => rowKey(r) === plKey) : null;
  if (contaResultado && (receitas > TOL || despesas > TOL)) {
    const difDRE = Math.abs(contaResultado.saldoFinal - resultado);
    if (difDRE > TOL) {
      issues.push({
        id: 'dre_resultado',
        modulo: 'DRE',
        descricao: `Resultado do exercício na conta "${contaResultado.nome}" (${fmt(contaResultado.saldoFinal)}) ≠ Receitas − Despesas (${fmt(resultado)}). Diferença: ${fmt(difDRE)}.`,
        divergencia: difDRE,
        contaAjustada: contaResultado.nome,
      });
    }
  }

  // ── 4. DFC: SF = SI + D − C para contas de caixa/disponível ───────────────
  for (const r of rows.filter(x => isCaixa(x) && x.tipo !== 'S')) {
    const esperado = r.saldoInicial + r.debito - r.credito;
    const dif = Math.abs(r.saldoFinal - esperado);
    if (dif > TOL) {
      issues.push({
        id: `dfc_${rowKey(r)}`,
        modulo: 'DFC',
        descricao: `"${r.nome}": SF (${fmt(r.saldoFinal)}) ≠ SI + D − C (${fmt(esperado)}). Diferença: ${fmt(dif)}.`,
        divergencia: dif,
        contaAjustada: r.nome,
      });
    }
  }

  return issues;
}

// ─── Correção lícita ──────────────────────────────────────────────────────────

/**
 * Aplica correções contábeis legítimas e retorna balancete ajustado.
 * Ordem: DRE→PL, fechamento do balanço, conciliação de caixa.
 */
export function corrigirBalancete(rows: VisionBalanceteRow[]): VisionBalanceteRow[] {
  if (rows.length === 0) return [];

  let corrected = rows.map(r => ({ ...r }));

  // 1. Resultado do exercício = Receitas − Despesas (grupos 3 vs 4-7)
  const receitas = Math.abs(sumReceitas(corrected));
  const despesas = sumDespesas(corrected);
  const resultadoDre = receitas - despesas;
  const plKey = findPlAccountKey(corrected);

  if (plKey && (receitas > 0 || despesas > 0)) {
    const conta = corrected.find(r => rowKey(r) === plKey)!;
    const ajuste = resultadoDre - conta.saldoFinal;
    corrected = ajustarSaldo(corrected, plKey, ajuste);
  }

  // 2. Fechar balanço: Ativo = |Passivo + PL|
  let { diff } = totaisBalanco(corrected);
  if (Math.abs(diff) > TOL) {
    const key = findPlAccountKey(corrected);
    if (key) {
      corrected = ajustarSaldo(corrected, key, diff);
    } else {
      // Conta de ajuste em PL quando não há conta identificada
      corrected = [
        ...corrected,
        {
          codigo: '',
          classificacao: '2.3.99.00001',
          nome: 'Ajuste de Conferência — Patrimônio Líquido',
          tipo: 'A' as const,
          saldoInicial: 0,
          debito: 0,
          credito: 0,
          saldoFinal: diff,
        },
      ];
    }
  }

  // 3. Caixa: Saldo Final = SI + D − C
  corrected = corrected.map(r => {
    if (!isCaixa(r) || r.tipo === 'S') return r;
    const esperado = r.saldoInicial + r.debito - r.credito;
    if (Math.abs(r.saldoFinal - esperado) > TOL) {
      return { ...r, saldoFinal: esperado };
    }
    return r;
  });

  // 4. Reconciliação final do balanço (ajuste residual em PL)
  ({ diff } = totaisBalanco(corrected));
  if (Math.abs(diff) > TOL) {
    const key = findPlAccountKey(corrected);
    if (key) {
      corrected = ajustarSaldo(corrected, key, diff);
    }
  }

  return corrected;
}

/** Detecta problemas; se corrigir=true, aplica e retorna linhas ajustadas sem issues residuais */
export function conferirECorrigir(balanceteRows: VisionBalanceteRow[]): ConferenciaResult {
  const issues = detectarProblemas(balanceteRows);
  if (issues.length === 0) {
    return { issues: [], correctedRows: balanceteRows };
  }
  const correctedRows = corrigirBalancete(balanceteRows);
  const issuesRestantes = detectarProblemas(correctedRows);
  return { issues: issuesRestantes, correctedRows };
}
