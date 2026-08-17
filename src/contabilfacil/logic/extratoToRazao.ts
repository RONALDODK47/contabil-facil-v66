import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';
import { parseDataRazao } from '../../extratoVision/utils/razaoContabil';
import {
  isExtratoLancamentoConciliado,
  resolveExtratoRowContas,
  type ExtratoBankRow,
} from './extratoConciliacaoBank';

export const EXTRATO_RAZAO_MARCA = 'extrato-conc';

export type BuildExtratoRazaoResult = {
  rows: VisionBalanceteRow[];
  gerados: number;
};

export type ConflitoDadoBalancete = {
  id: string;
  historico: string;
  conflito: 'valores-diferentes' | 'contas-diferentes' | 'impostacao-existente';
  detalhes: {
    contaAntiga?: string;
    contaNova?: string;
    debitoAntigo?: number;
    debitoNovo?: number;
    creditoAntigo?: number;
    creditoNovo?: number;
  };
};

function normalizeConta(conta: string): { codigo: string; classificacao: string } {
  const classificacao = conta.trim();
  const codigo = classificacao.replace(/\./g, '') || classificacao;
  return { codigo, classificacao };
}

/** Id de rastreio do lançamento de conciliação — NUNCA gravado no histórico visível (`nome`). */
export function extratoRazaoImportId(id: string): string {
  return `${EXTRATO_RAZAO_MARCA}:${id}`;
}

export function isExtratoRazaoRow(row: VisionBalanceteRow): boolean {
  return (row.importId ?? '').startsWith(`${EXTRATO_RAZAO_MARCA}:`);
}

function extractExtratoRazaoId(row: VisionBalanceteRow): string | null {
  const importId = row.importId ?? '';
  return importId.startsWith(`${EXTRATO_RAZAO_MARCA}:`)
    ? importId.slice(EXTRATO_RAZAO_MARCA.length + 1)
    : null;
}

/**
 * Gera partidas dobradas no razão a partir de linhas do extrato já conciliadas.
 * Rastreia cada par via `importId` (nunca no histórico `nome`) para permitir substituição segura.
 */
export function buildRazaoFromExtratoLancamentos(
  lancamentos: ExtratoBankRow[],
  ordemInicial = 1,
): BuildExtratoRazaoResult {
  const rows: VisionBalanceteRow[] = [];
  let ordem = ordemInicial;
  let gerados = 0;

  for (const lan of lancamentos) {
    if (!isExtratoLancamentoConciliado(lan)) continue;

    const { accountDebit, accountCredit } = resolveExtratoRowContas(lan);
    const valor = Math.abs(lan.value ?? 0);
    if (valor <= 0) continue;

    // Usa o texto original do extrato (description) como histórico — nunca o operationName
    // que pode ser um complemento gerado pelo sistema. O histórico que vai para o balancete/razão
    // deve ser idêntico ao do extrato, sem nenhum marcador interno anexado.
    const nome = (lan.description || lan.operationName || 'LANCAMENTO').trim().toUpperCase();
    const importId = extratoRazaoImportId(lan.id);
    const deb = normalizeConta(accountDebit);
    const cred = normalizeConta(accountCredit);
    // Extrato costuma vir em ISO (2026-06-01); razão usa DD/MM/AAAA.
    const rawDate = (lan.date ?? '').trim();
    const data = rawDate ? parseDataRazao(rawDate) || rawDate : '—';
    // Mesma ordem nos dois lados da partida — o export TXT+ agrupa por data+ordem.
    const ordemPartida = ordem++;

    rows.push({
      codigo: deb.codigo,
      classificacao: deb.classificacao,
      nome,
      data,
      debito: valor,
      credito: 0,
      saldoInicial: 0,
      saldoFinal: 0,
      ordem: ordemPartida,
      tipo: 'A',
      contaDeb: deb.codigo,
      contaCred: cred.codigo,
      isReconciliation: true,
      importId,
    });
    rows.push({
      codigo: cred.codigo,
      classificacao: cred.classificacao,
      nome,
      data,
      debito: 0,
      credito: valor,
      saldoInicial: 0,
      saldoFinal: 0,
      ordem: ordemPartida,
      tipo: 'A',
      contaDeb: deb.codigo,
      contaCred: cred.codigo,
      isReconciliation: true,
      importId,
    });
    gerados += 1;
  }

  return { rows, gerados };
}

/**
 * Detecta conflitos entre lançamentos antigos e novos do extrato.
 * Retorna lista de conflitos se houver dados diferentes ou impostações prévias.
 */
export function detectaConflitoDadosExtrato(
  existente: VisionBalanceteRow[],
  novos: VisionBalanceteRow[],
): ConflitoDadoBalancete[] {
  const conflitos: ConflitoDadoBalancete[] = [];
  
  // Extrai IDs dos novos lançamentos
  const novosPorId = new Map<string, VisionBalanceteRow[]>();
  for (const novo of novos) {
    const id = extractExtratoRazaoId(novo);
    if (!id) continue;
    if (!novosPorId.has(id)) {
      novosPorId.set(id, []);
    }
    novosPorId.get(id)!.push(novo);
  }

  // Compara com dados existentes
  for (const [id, novasLinhas] of novosPorId) {
    // Encontra as linhas antigas correspondentes
    const antinasLinhas = existente.filter((r) => extractExtratoRazaoId(r) === id);

    // Se não tinha nada antes, não há conflito
    if (antinasLinhas.length === 0) continue;

    // Extrai dados para comparação (débito e crédito)
    const novasTotal = novasLinhas.reduce(
      (sum, r) => ({
        debito: sum.debito + (r.debito ?? 0),
        credito: sum.credito + (r.credito ?? 0),
        contas: [...sum.contas, r.classificacao ?? r.codigo ?? ''],
      }),
      { debito: 0, credito: 0, contas: [] as string[] },
    );

    const antinasTotal = antinasLinhas.reduce(
      (sum, r) => ({
        debito: sum.debito + (r.debito ?? 0),
        credito: sum.credito + (r.credito ?? 0),
        contas: [...sum.contas, r.classificacao ?? r.codigo ?? ''],
      }),
      { debito: 0, credito: 0, contas: [] as string[] },
    );

    // Compara valores
    const valorDiferente =
      Math.abs((novasTotal.debito ?? 0) - (antinasTotal.debito ?? 0)) > 0.01 ||
      Math.abs((novasTotal.credito ?? 0) - (antinasTotal.credito ?? 0)) > 0.01;

    // Compara contas
    const contasDiferentes = !arraysIguais(
      novasTotal.contas.sort(),
      antinasTotal.contas.sort(),
    );

    // Detecta se houve impostação anterior (classificação manual)
    const temImpostacaoAntiga = antinasLinhas.some(
      (r) => r.classificacao && r.classificacao !== r.codigo,
    );

    const historico = novasLinhas[0]?.nome || 'LANÇAMENTO';

    if (valorDiferente) {
      conflitos.push({
        id,
        historico,
        conflito: 'valores-diferentes',
        detalhes: {
          debitoAntigo: antinasTotal.debito,
          debitoNovo: novasTotal.debito,
          creditoAntigo: antinasTotal.credito,
          creditoNovo: novasTotal.credito,
        },
      });
    } else if (contasDiferentes) {
      conflitos.push({
        id,
        historico,
        conflito: 'contas-diferentes',
        detalhes: {
          contaAntiga: antinasTotal.contas.join(', '),
          contaNova: novasTotal.contas.join(', '),
        },
      });
    } else if (temImpostacaoAntiga) {
      conflitos.push({
        id,
        historico,
        conflito: 'impostacao-existente',
        detalhes: {},
      });
    }
  }

  return conflitos;
}

function arraysIguais(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * Merge de lançamentos do extrato com os existentes no razão.
 * Remove os lançamentos antigos do mesmo extrato (pelo importId) e os lançamentos
 * manuais (sem importId) das mesmas contas afetadas, adicionando os novos no lugar.
 * Quando forceOverwrite=false (padrão), mantém lançamentos de OTHER fontes (importId
 * diferente) mesmo nas contas afetadas.
 */
export function mergeExtratoRazaoComExistente(
  existente: VisionBalanceteRow[],
  novos: VisionBalanceteRow[],
  _forceOverwrite = false,
): VisionBalanceteRow[] {
  // Extrai IDs dos novos lançamentos do extrato
  const novosIds = new Set<string>();
  for (const r of novos) {
    const id = extractExtratoRazaoId(r);
    if (id) novosIds.add(id);
  }

  // Contas afetadas pelos novos lançamentos — qualquer lançamento manual (sem importId)
  // dessas contas será substituído, pois os novos lançamentos representam o estado atual.
  const contasAfetadas = new Set<string>();
  for (const r of novos) {
    if (r.codigo) contasAfetadas.add(r.codigo);
  }

  // Remove:
  // 1. Lançamentos do extrato com mesmo ID (serão substituídos pelos novos)
  // 2. Lançamentos manuais (sem importId) das contas afetadas
  // Mantém: lançamentos de OUTRAS fontes (importId diferente), mesmo nas contas afetadas
  const base = existente.filter((r) => {
    const idAntigo = extractExtratoRazaoId(r);

    // Lançamento do extrato com mesmo ID → remove
    if (idAntigo && novosIds.has(idAntigo)) return false;

    // Lançamento manual (sem importId) de conta afetada → remove
    if (!idAntigo && r.codigo && contasAfetadas.has(r.codigo)) return false;

    return true;
  });

  // Adiciona os novos lançamentos com ordens sequenciais após os existentes mantidos.
  // IMPORTANTE: linhas do mesmo par (débito + crédito) compartilham o mesmo `ordem`
  // original — ao renumerar, preserva essa relação mapeando cada ordem antiga para
  // uma nova. Sem isso, debit e crédito recebem ordens diferentes (N e N+1) e o
  // algoritmo de exibição não consegue agrupá-los em uma linha só no balancete.
  const maxOrdem = base.reduce((m, r) => Math.max(m, r.ordem ?? 0), 0);
  const ordemMap = new Map<number, number>(); // ordemOriginal → novem
  let nextOrdem = maxOrdem + 1;
  const reordenados = novos.map((r) => {
    const orig = r.ordem;
    if (orig == null || !Number.isFinite(orig)) {
      return { ...r, ordem: nextOrdem++ };
    }
    if (!ordemMap.has(orig)) {
      ordemMap.set(orig, nextOrdem++);
    }
    return { ...r, ordem: ordemMap.get(orig)! };
  });

  return [...base, ...reordenados];
}