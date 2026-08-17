import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';
import { format } from 'date-fns';

/** Lançamento plain (mesmo formato dos coletores TXT+ Domínio). */
export type DominioPlainLancamento = {
  date: Date;
  debContaStr: string;
  credContaStr: string;
  value: number;
  historico: string;
};

export type BuildDominioPlainRazaoResult = {
  rows: VisionBalanceteRow[];
  gerados: number;
};

function normalizeConta(conta: string): { codigo: string; classificacao: string } {
  const classificacao = conta.trim();
  const codigo = classificacao.replace(/\./g, '') || classificacao;
  return { codigo, classificacao };
}

function dateToRazaoDisplay(d: Date): string {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '—';
  return format(d, 'dd/MM/yyyy');
}

export function dominioPlainRazaoNome(marca: string, entityId: string, historico: string, idx: number): string {
  return `${marca}|${entityId}|${idx}|${historico}`;
}

export function isDominioPlainRazaoRow(row: VisionBalanceteRow, marca: string): boolean {
  return (row.nome ?? '').startsWith(`${marca}|`);
}

export function isDominioPlainRazaoRowOfEntity(
  row: VisionBalanceteRow,
  marca: string,
  entityId: string,
): boolean {
  return (row.nome ?? '').startsWith(`${marca}|${entityId}|`);
}

/**
 * Converte lançamentos plain (débito/crédito) em partidas dobradas do razão.
 * `marca` + `entityId` no nome permitem merge/substituição segura.
 */
export function buildRazaoFromDominioPlain(
  lancamentos: DominioPlainLancamento[],
  marca: string,
  entityId: string,
  ordemInicial = 1,
): BuildDominioPlainRazaoResult {
  const rows: VisionBalanceteRow[] = [];
  let ordem = ordemInicial;
  let gerados = 0;

  lancamentos.forEach((lan, idx) => {
    const valor = Math.abs(lan.value ?? 0);
    if (valor < 0.0001) return;
    const debRaw = String(lan.debContaStr ?? '').trim();
    const credRaw = String(lan.credContaStr ?? '').trim();
    if (!debRaw || !credRaw) return;

    const historico = (lan.historico || 'LANCAMENTO').trim().toUpperCase();
    const nome = dominioPlainRazaoNome(marca, entityId, historico, idx);
    const deb = normalizeConta(debRaw);
    const cred = normalizeConta(credRaw);
    const data = dateToRazaoDisplay(lan.date);

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
    });
    gerados += 1;
  });

  return { rows, gerados };
}

/** Remove linhas da marca (opcionalmente só de uma entidade) e acrescenta as novas. */
export function mergeDominioPlainRazaoComExistente(
  existente: VisionBalanceteRow[],
  novos: VisionBalanceteRow[],
  marca: string,
  entityId?: string,
): VisionBalanceteRow[] {
  const base = existente.filter((r) =>
    entityId
      ? !isDominioPlainRazaoRowOfEntity(r, marca, entityId)
      : !isDominioPlainRazaoRow(r, marca),
  );
  const maxOrdem = base.reduce((m, r) => Math.max(m, r.ordem ?? 0), 0);
  // As duas linhas (débito+crédito) de uma mesma partida compartilham a mesma `ordem` de
  // origem — remapear por índice de linha (i) em vez de por grupo de ordem quebrava esse
  // par, fazendo a conta perder a contrapartida ao entrar no balancete.
  const ordemMap = new Map<number, number>();
  let nextOrdem = maxOrdem;
  const reordenados = novos.map((r) => {
    const origem = r.ordem ?? 0;
    if (!ordemMap.has(origem)) {
      nextOrdem += 1;
      ordemMap.set(origem, nextOrdem);
    }
    return { ...r, ordem: ordemMap.get(origem)! };
  });
  return [...base, ...reordenados];
}
