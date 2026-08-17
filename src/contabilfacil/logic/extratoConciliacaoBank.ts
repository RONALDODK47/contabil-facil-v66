/** Status de conciliação linha a linha no módulo Gerencial (extrato bancário). */

export type ExtratoConciliacaoFiltro = 'todas' | 'conciliadas' | 'pendentes';

export type ExtratoBankRow = {
  id: string;
  date?: string;
  description?: string;
  value?: number;
  nature?: 'D' | 'C' | string;
  accountCode?: string;
  accountDebit?: string;
  accountCredit?: string;
  operationName?: string;
  status?: 'CONCILIADO' | 'PENDENTE';
};

export type ExtratoRowContas = {
  accountDebit: string;
  accountCredit: string;
};

/** Mesma regra da tabela virtual e do PDF de conciliação.
 * Entrada (C): banco no débito · Saída (D): banco no crédito.
 */
export function resolveExtratoRowContas(row: ExtratoBankRow): ExtratoRowContas {
  let deb = row.accountDebit?.trim() || '';
  let cred = row.accountCredit?.trim() || '';

  // Se um lado está vazio, tenta usar accountCode conforme a natureza
  if (!deb && !cred && row.accountCode?.trim()) {
    if (row.nature === 'C') {
      deb = row.accountCode.trim();
    } else if (row.nature === 'D') {
      cred = row.accountCode.trim();
    }
  }

  return { accountDebit: deb, accountCredit: cred };
}

/** Conciliado = débito e crédito preenchidos e diferentes (partida dobrada completa).
 * 
 * IMPORTANTE: Valida que ambos os lados estão preenchidos com valores numéricos válidos.
 */
export function isExtratoLancamentoConciliado(row: ExtratoBankRow): boolean {
  const { accountDebit, accountCredit } = resolveExtratoRowContas(row);
  
  // Ambos devem estar preenchidos
  if (!accountDebit || !accountCredit) return false;
  
  // Ambos devem ter pelo menos um dígito numérico (conta válida)
  const debNumeros = accountDebit.replace(/\D/g, '');
  const credNumeros = accountCredit.replace(/\D/g, '');
  
  if (!debNumeros || !credNumeros) return false;
  
  // Não deve ser a mesma conta nos dois lados (evita domínio)
  if (debNumeros === credNumeros) return false;
  
  return true;
}

export function syncExtratoConciliacaoStatus<T extends ExtratoBankRow>(rows: T[]): T[] {
  return rows.map((row) => ({
    ...row,
    status: isExtratoLancamentoConciliado(row) ? ('CONCILIADO' as const) : ('PENDENTE' as const),
  }));
}

export function filterExtratoByConciliacaoFiltro<T extends ExtratoBankRow>(
  rows: T[],
  filtro: ExtratoConciliacaoFiltro,
): T[] {
  if (filtro === 'todas') return rows;
  if (filtro === 'conciliadas') return rows.filter(isExtratoLancamentoConciliado);
  return rows.filter((row) => !isExtratoLancamentoConciliado(row));
}

export function countExtratoConciliados(rows: ExtratoBankRow[]): number {
  return rows.filter(isExtratoLancamentoConciliado).length;
}

export function countExtratoPendentes(rows: ExtratoBankRow[]): number {
  return rows.length - countExtratoConciliados(rows);
}

/** Uma passagem: total / conciliadas / pendentes (evita 2–3 filters no placar). */
export function summarizeExtratoConciliacao(rows: ExtratoBankRow[]): {
  total: number;
  conciliadas: number;
  pendentes: number;
} {
  let conciliadas = 0;
  for (const row of rows) {
    if (isExtratoLancamentoConciliado(row)) conciliadas += 1;
  }
  const total = rows.length;
  return { total, conciliadas, pendentes: total - conciliadas };
}
