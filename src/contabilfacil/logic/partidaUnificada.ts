/**
 * Módulo de agrupamento de partidas dobradas unificadas.
 *
 * Converte linhas individuais do razão (cada uma com apenas débito OU crédito)
 * em `PartidaUnificada` — um objeto único que contém contaDebito + contaCredito
 * juntos, representando fielmente a transação contábil de partida dobrada.
 *
 * O algoritmo de pareamento segue a mesma hierarquia de confiança do
 * `pairDominioMovementRowsCore` (contaDeb/contaCred → ordem → valor → data),
 * mas o resultado é uma estrutura unificada em vez de linhas separadas.
 */

import type { VisionBalanceteRow, PartidaUnificada } from '../../extratoVision/types/accounting';

let _idSeq = 0;
function nextPartidaId(): string {
  return `PU-${Date.now()}-${++_idSeq}`;
}

/**
 * Agrupa linhas soltas do razão em partidas unificadas (débito + crédito).
 *
 * Hierarquia de pareamento:
 *   1. Linhas que já têm `contaDeb` + `contaCred` preenchidos (auto-contidas)
 *   2. Mesma `data + ordem` (lançamentos do Domínio com ordem compartilhada)
 *   3. Mesma `data + valor` + conta diferente (fallback heurístico)
 *   4. Linhas que sobraram são retornadas como partidas incompletas (só 1 perna)
 */
export function agruparEmPartidasUnificadas(rows: VisionBalanceteRow[]): PartidaUnificada[] {
  const result: PartidaUnificada[] = [];
  const consumed = new Set<VisionBalanceteRow>();

  const movimentos = rows.filter(
    (r) => (r.debito ?? 0) > 0 || (r.credito ?? 0) > 0,
  );

  // ─── Passo 1: Linhas auto-contidas (já têm contaDeb + contaCred) ─────────
  for (const r of movimentos) {
    if (consumed.has(r)) continue;
    const deb = (r.contaDeb || '').trim();
    const cred = (r.contaCred || '').trim();
    if (!deb || !cred) continue;
    // Débito e crédito nunca podem ser a mesma conta — dado de origem corrompido/
    // mal importado é melhor tratar como incompleto (passos seguintes ou "sem
    // contrapartida") do que fingir uma partida fechada contra si mesma.
    if (deb === cred) continue;
    const valor = Math.max(r.debito ?? 0, r.credito ?? 0);
    if (!(valor > 0)) continue;

    result.push({
      id: nextPartidaId(),
      data: r.data ?? '',
      ordem: r.ordem,
      historico: r.nome ?? r.historico ?? 'LANCAMENTO',
      contaDebito: deb,
      contaCredito: cred,
      valor,
      importId: r.importId,
      pernas: [r],
    });
    consumed.add(r);

    // Tenta consumir a contraparte (mesma ordem, conta inversa) para evitar duplicidade
    for (const r2 of movimentos) {
      if (consumed.has(r2)) continue;
      if (r2.ordem !== r.ordem || r2.data !== r.data) continue;
      const isDeb1 = (r.debito ?? 0) > 0;
      const isDeb2 = (r2.debito ?? 0) > 0;
      if (isDeb1 === isDeb2) continue;
      const val2 = Math.max(r2.debito ?? 0, r2.credito ?? 0);
      if (Math.abs(val2 - valor) > 0.009) continue;
      consumed.add(r2);
      result[result.length - 1].pernas.push(r2);
      break;
    }
  }

  // ─── Passo 2: Agrupar por data + ordem ──────────────────────────────────
  const porOrdem = new Map<string, VisionBalanceteRow[]>();
  for (const r of movimentos) {
    if (consumed.has(r)) continue;
    if (r.ordem != null && Number.isFinite(r.ordem)) {
      const key = `${r.data ?? ''}|ord:${r.ordem}`;
      const list = porOrdem.get(key) ?? [];
      list.push(r);
      porOrdem.set(key, list);
    }
  }

  for (const group of porOrdem.values()) {
    const debRows = group.filter((r) => (r.debito ?? 0) > 0 && !consumed.has(r));
    const credRows = group.filter((r) => (r.credito ?? 0) > 0 && !consumed.has(r));
    const usedCred = new Set<number>();

    for (const deb of debRows) {
      const contaDeb = (deb.contaDeb || deb.codigo || '').trim();
      if (!contaDeb) continue;
      const valorDeb = deb.debito;

      let matchIdx = -1;
      for (let i = 0; i < credRows.length; i++) {
        if (usedCred.has(i)) continue;
        const cred = credRows[i];
        if (Math.abs((cred.credito ?? 0) - valorDeb) > 0.009) continue;
        const contaCred = (cred.contaCred || cred.codigo || '').trim();
        if (!contaCred || contaCred === contaDeb) continue;
        matchIdx = i;
        break;
      }

      if (matchIdx < 0) continue;
      const cred = credRows[matchIdx];
      usedCred.add(matchIdx);
      const contaCred = (cred.contaCred || cred.codigo || '').trim();

      result.push({
        id: nextPartidaId(),
        data: deb.data ?? cred.data ?? '',
        ordem: deb.ordem ?? cred.ordem,
        historico: deb.nome ?? cred.nome ?? 'LANCAMENTO',
        contaDebito: contaDeb,
        contaCredito: contaCred,
        valor: valorDeb,
        importId: deb.importId ?? cred.importId,
        pernas: [deb, cred],
      });
      consumed.add(deb);
      consumed.add(cred);
    }
  }

  // ─── Passo 3: Fallback por data + valor ─────────────────────────────────
  const porValorData = new Map<string, VisionBalanceteRow[]>();
  for (const r of movimentos) {
    if (consumed.has(r)) continue;
    const valor = Math.max(r.debito ?? 0, r.credito ?? 0);
    if (!(valor > 0)) continue;
    const key = `${r.data ?? ''}|v:${valor.toFixed(2)}`;
    const list = porValorData.get(key) ?? [];
    list.push(r);
    porValorData.set(key, list);
  }

  for (const group of porValorData.values()) {
    const debRows = group.filter((r) => (r.debito ?? 0) > 0 && !consumed.has(r));
    const credRows = group.filter((r) => (r.credito ?? 0) > 0 && !consumed.has(r));
    const usedCred = new Set<number>();

    for (const deb of debRows) {
      const contaDeb = (deb.contaDeb || deb.codigo || '').trim();
      if (!contaDeb) continue;
      const valorDeb = deb.debito;

      let matchIdx = -1;
      for (let i = 0; i < credRows.length; i++) {
        if (usedCred.has(i)) continue;
        const cred = credRows[i];
        if (Math.abs((cred.credito ?? 0) - valorDeb) > 0.009) continue;
        const contaCred = (cred.contaCred || cred.codigo || '').trim();
        if (!contaCred || contaCred === contaDeb) continue;
        matchIdx = i;
        break;
      }

      if (matchIdx < 0) continue;
      const cred = credRows[matchIdx];
      usedCred.add(matchIdx);
      const contaCred = (cred.contaCred || cred.codigo || '').trim();

      result.push({
        id: nextPartidaId(),
        data: deb.data ?? cred.data ?? '',
        ordem: deb.ordem ?? cred.ordem,
        historico: deb.nome ?? cred.nome ?? 'LANCAMENTO',
        contaDebito: contaDeb,
        contaCredito: contaCred,
        valor: valorDeb,
        importId: deb.importId ?? cred.importId,
        pernas: [deb, cred],
      });
      consumed.add(deb);
      consumed.add(cred);
    }
  }

  // ─── Passo 4: Linhas restantes → partidas incompletas (sem contrapartida) ─
  for (const r of movimentos) {
    if (consumed.has(r)) continue;
    const isDeb = (r.debito ?? 0) > 0;
    const conta = (r.contaDeb || r.contaCred || r.codigo || '').trim();
    if (!conta) continue;

    result.push({
      id: nextPartidaId(),
      data: r.data ?? '',
      ordem: r.ordem,
      historico: r.nome ?? r.historico ?? 'LANCAMENTO',
      contaDebito: isDeb ? conta : '',
      contaCredito: isDeb ? '' : conta,
      valor: Math.max(r.debito ?? 0, r.credito ?? 0),
      importId: r.importId,
      pernas: [r],
    });
    consumed.add(r);
  }

  return result;
}

/**
 * Converte partidas unificadas de volta em linhas planas do razão,
 * garantindo que AMBAS as pernas tenham `contaDeb` e `contaCred` preenchidos.
 * Isso permite que o display, a validação e a exportação vejam a contrapartida
 * mesmo que os dados originais não a tivessem.
 */
export function partidasParaRazaoRows(partidas: PartidaUnificada[]): VisionBalanceteRow[] {
  const out: VisionBalanceteRow[] = [];

  for (const p of partidas) {
    for (const perna of p.pernas) {
      out.push({
        ...perna,
        contaDeb: p.contaDebito || perna.contaDeb,
        contaCred: p.contaCredito || perna.contaCred,
      });
    }
  }

  return out;
}

/**
 * Enriquece linhas do razão com contrapartida: faz o agrupamento e devolve
 * as linhas planas com `contaDeb`/`contaCred` preenchidos em AMBAS as pernas.
 *
 * Esta é a função principal que deve ser chamada no pipeline ANTES da validação,
 * display e exportação para garantir que nenhuma perna seja tratada como órfã.
 */
export function enriquecerComContrapartida(rows: VisionBalanceteRow[]): VisionBalanceteRow[] {
  const partidas = agruparEmPartidasUnificadas(rows);
  return partidasParaRazaoRows(partidas);
}
