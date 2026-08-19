import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';
import { parseDataRazao } from '../../extratoVision/utils/razaoContabil';
import {
  isExtratoLancamentoConciliado,
  resolveExtratoRowContas,
  type ExtratoBankRow,
} from './extratoConciliacaoBank';

export const EXTRATO_RAZAO_MARCA = 'extrato-conc';

/**
 * Quantas linhas de OUTRA origem (TXT importado, lançamento manual) o último merge
 * encontrou com o mesmo conteúdo contábil dos lançamentos que estavam entrando —
 * ou seja, quantas viraram lançamento em dobro no balancete. Lido logo após o merge.
 */
let ultimaContagemEquivalentesDeOutrasOrigens = 0;
export function contarEquivalentesDeOutrasOrigensDoUltimoMerge(): number {
  return ultimaContagemEquivalentesDeOutrasOrigens;
}

export type BuildExtratoRazaoResult = {
  rows: VisionBalanceteRow[];
  gerados: number;
  /** Linhas conciliadas que NAO viraram partida — antes sumiam sem aviso. */
  ignorados: { id: string; descricao: string; motivo: 'valor-invalido' }[];
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
  const ignorados: BuildExtratoRazaoResult['ignorados'] = [];
  let ordem = ordemInicial;
  let gerados = 0;
  /**
   * O `id` do extrato vira `importId` e e a chave de substituicao no razao.
   * Extratos reimportados (OFX/TXT) trazem ids repetidos: dois lancamentos
   * diferentes com o mesmo `importId` viravam UM so na proxima importacao —
   * lancamento sumindo do balancete sem aviso. Desambigua com sufixo.
   */
  const idsVistos = new Map<string, number>();

  for (const lan of lancamentos) {
    if (!isExtratoLancamentoConciliado(lan)) continue;

    const { accountDebit, accountCredit } = resolveExtratoRowContas(lan);
    const bruto = lan.value ?? 0;
    const valor = Number.isFinite(bruto) ? Math.abs(bruto) : NaN;
    // Antes, `valor <= 0` descartava tambem os lancamentos de R$ 0,00, que a aba
    // de conciliacao conta como conciliados — o balancete vinha com menos linhas
    // que a conciliacao e ninguem era avisado. So valor invalido fica de fora.
    if (!Number.isFinite(valor)) {
      ignorados.push({
        id: lan.id,
        descricao: (lan.description || lan.operationName || '').trim(),
        motivo: 'valor-invalido',
      });
      continue;
    }

    // Usa o texto original do extrato (description) como histórico — nunca o operationName
    // que pode ser um complemento gerado pelo sistema. O histórico que vai para o balancete/razão
    // deve ser idêntico ao do extrato, sem nenhum marcador interno anexado.
    const nome = (lan.description || lan.operationName || 'LANCAMENTO').trim().toUpperCase();
    const repeticao = idsVistos.get(lan.id) ?? 0;
    idsVistos.set(lan.id, repeticao + 1);
    const importId = extratoRazaoImportId(repeticao === 0 ? lan.id : `${lan.id}#${repeticao}`);
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

  return { rows, gerados, ignorados };
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
  opts?: {
    /**
     * Remove também linhas de OUTRA origem (TXT importado, lançamento manual) que
     * tenham exatamente o mesmo conteúdo contábil dos novos. É o caso de quem
     * exportou o TXT da conciliação e importou esse mesmo TXT no balancete: o
     * lançamento passa a existir duas vezes, com origens diferentes, e o mês fica
     * com o dobro (ou mais) de movimento. Fora do padrão porque apaga dado de
     * outra origem — só com confirmação explícita do usuário.
     */
    removerEquivalentesDeOutrasOrigens?: boolean;
  },
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

  /**
   * RAIZ DA DUPLICAÇÃO NO BALANCETE.
   *
   * A substituição acontecia SÓ pelo `id` da linha do extrato. Mas esse id é
   * gerado na leitura do arquivo: reimportar o mesmo extrato (XLSX/OFX/TXT), ou
   * trocar de pasta e voltar, produz ids NOVOS para os MESMOS lançamentos. Como
   * nenhum id antigo batia, nada era substituído e a importação virava soma:
   * o mês recebia o movimento de novo a cada importação (D e C inflados no
   * balancete, saldo anterior correto — porque o mês anterior já estava fechado).
   *
   * Identifica também pelo CONTEÚDO contábil (data + contas + valor + histórico).
   * Dois lançamentos idênticos de verdade no mesmo dia continuam valendo dois:
   * as duas linhas novas entram, e o que é apagado são as cópias antigas.
   */
  const chaveConteudo = (r: VisionBalanceteRow) =>
    [
      (r.data ?? '').trim(),
      (r.contaDeb ?? '').trim(),
      (r.contaCred ?? '').trim(),
      (r.debito ?? 0).toFixed(2),
      (r.credito ?? 0).toFixed(2),
      (r.nome ?? '').trim().toUpperCase(),
    ].join('|');
  const conteudosNovos = new Set(novos.map(chaveConteudo));
  ultimaContagemEquivalentesDeOutrasOrigens = existente.filter(
    (r) => !extractExtratoRazaoId(r) && conteudosNovos.has(chaveConteudo(r)),
  ).length;

  // Remove:
  // 1. Lançamentos do extrato com mesmo ID (serão substituídos pelos novos)
  // 2. Lançamentos manuais (sem importId) das contas afetadas
  // Mantém: lançamentos de OUTRAS fontes (importId diferente), mesmo nas contas afetadas
  const base = existente.filter((r) => {
    const idAntigo = extractExtratoRazaoId(r);

    // Lançamento do extrato com mesmo ID → remove
    if (idAntigo && novosIds.has(idAntigo)) return false;

    // Lançamento do extrato com o MESMO conteúdo contábil, ainda que o id do
    // extrato tenha mudado numa releitura do arquivo → remove (é a mesma linha).
    if (idAntigo && conteudosNovos.has(chaveConteudo(r))) return false;

    // Mesmo conteúdo, mas veio de outra origem (TXT importado no balancete etc.).
    // Só sai quando o usuário confirma — senão o mês soma o mesmo lançamento duas vezes.
    if (opts?.removerEquivalentesDeOutrasOrigens && conteudosNovos.has(chaveConteudo(r))) {
      return false;
    }

    // Lançamento manual (SEM importId nenhum) de conta afetada → remove.
    // `idAntigo` e null tanto para linha manual quanto para linha de OUTRA
    // origem (folha, importacao de lancamentos). Testar so `idAntigo` apagava
    // essas outras origens junto — o comentario acima ja dizia que elas deviam
    // ser mantidas. Checa o importId cru.
    const semOrigem = !(r.importId ?? '').trim();
    if (semOrigem && r.codigo && contasAfetadas.has(r.codigo)) return false;

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