import type { VisionBalanceteRow } from '../types/accounting';

function normKeyPart(s: string): string {
  return s.replace(/\s/g, '').replace(/\./g, '').toLowerCase();
}

/** Chave de conciliação entre saldo inicial e razão (classificação > código > nome). */
export function buildRowKey(row: Pick<VisionBalanceteRow, 'codigo' | 'classificacao' | 'nome'>): string {
  const cls = normKeyPart(row.classificacao?.trim() ?? '');
  if (cls && /^\d/.test(cls)) return `cls:${cls}`;
  const cod = normKeyPart(row.codigo?.trim() ?? '');
  if (cod && /^\d/.test(cod)) return `cod:${cod}`;
  const nome = (row.nome ?? '').trim().toLowerCase();
  return nome ? `nome:${nome}` : '';
}

function emptyRow(r: VisionBalanceteRow): VisionBalanceteRow {
  return {
    codigo: r.codigo ?? '',
    classificacao: r.classificacao ?? '',
    nome: r.nome ?? '',
    saldoInicial: 0,
    debito: 0,
    credito: 0,
    saldoFinal: 0,
  };
}

function saldoInicialAssinado(row: VisionBalanceteRow): number {
  const si = row.saldoInicial;
  if (Math.abs(si) < 1e-9) return 0;
  const nat = row.naturezaSaldoInicial;
  if (nat === 'D') return Math.abs(si);
  if (nat === 'C') return -Math.abs(si);
  return si;
}

/** Recalcula saldo final a partir do SI + movimentação do razão. */
export function recalcularSaldoFinalRow(row: VisionBalanceteRow): VisionBalanceteRow {
  const liquido = saldoInicialAssinado(row) + row.debito - row.credito;
  const tol = 0.001;

  if (Math.abs(liquido) < tol) {
    return { ...row, saldoFinal: 0, naturezaSaldoFinal: undefined };
  }

  return {
    ...row,
    saldoFinal: Math.abs(liquido),
    naturezaSaldoFinal: liquido > 0 ? 'D' : 'C',
  };
}

/** Combina saldo inicial e razão importados separadamente em linhas de balancete. */
export function mergeSaldoInicialRazao(
  saldoInicialRows: VisionBalanceteRow[],
  razaoRows: VisionBalanceteRow[],
): VisionBalanceteRow[] {
  const map = new Map<string, VisionBalanceteRow>();
  const order: string[] = [];

  const touch = (r: VisionBalanceteRow): VisionBalanceteRow | null => {
    const key = buildRowKey(r);
    if (!key) return null;
    if (!map.has(key)) {
      order.push(key);
      map.set(key, emptyRow(r));
    }
    return map.get(key)!;
  };

  for (const r of saldoInicialRows) {
    const target = touch(r);
    if (!target) continue;
    target.saldoInicial = r.saldoInicial;
    target.naturezaSaldoInicial = r.naturezaSaldoInicial;
    if (r.nome) target.nome = r.nome;
    if (r.codigo) target.codigo = r.codigo;
    if (r.classificacao) target.classificacao = r.classificacao;
  }

  for (const r of razaoRows) {
    const target = touch(r);
    if (!target) continue;
    target.debito = r.debito;
    target.credito = r.credito;
    if (r.nome) target.nome = r.nome;
    if (r.codigo) target.codigo = r.codigo;
    if (r.classificacao) target.classificacao = r.classificacao;
    if (r.saldoFinal && !saldoInicialRows.length) {
      target.saldoFinal = r.saldoFinal;
      target.naturezaSaldoFinal = r.naturezaSaldoFinal;
    }
  }

  return order.map((key) => recalcularSaldoFinalRow(map.get(key)!));
}

/** Extrai partes de um arquivo completo (balancete) para os dois importadores. */
export function splitBalanceteCompleto(rows: VisionBalanceteRow[]): {
  saldoInicial: VisionBalanceteRow[];
  razao: VisionBalanceteRow[];
} {
  const saldoInicial = rows.map((r) => ({
    codigo: r.codigo,
    classificacao: r.classificacao,
    nome: r.nome,
    saldoInicial: r.saldoInicial,
    naturezaSaldoInicial: r.naturezaSaldoInicial,
    debito: 0,
    credito: 0,
    saldoFinal: 0,
  }));
  const razao = rows.map((r) => ({
    codigo: r.codigo,
    classificacao: r.classificacao,
    nome: r.nome,
    data: r.data,
    saldoInicial: 0,
    debito: r.debito,
    credito: r.credito,
    saldoFinal: r.saldoFinal,
    naturezaSaldoFinal: r.naturezaSaldoFinal,
  }));
  return { saldoInicial, razao };
}
