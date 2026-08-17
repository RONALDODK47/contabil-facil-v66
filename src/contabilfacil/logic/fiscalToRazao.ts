import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';
import type { SpedInvoice } from '../components/fiscal/types';
import type { FiscalAcumuladorRegra } from './fiscalAcumuladorRegrasStorage';
import { resolverRegraFiscalParaInvoice } from './fiscalRegraResolver';

export const FISCAL_RAZAO_MARCA = 'FISCAL-AUTO';

export type BuildFiscalRazaoResult = {
  rows: VisionBalanceteRow[];
  gerados: number;
  /** Notas/apurações sem regra (débito+crédito) cadastrada — não geraram lançamento. */
  semRegra: SpedInvoice[];
};

function normalizeConta(conta: string): { codigo: string; classificacao: string } {
  const classificacao = conta.trim();
  const codigo = classificacao.replace(/\./g, '') || classificacao;
  return { codigo, classificacao };
}

function isoDateToDisplay(iso: string | undefined): string {
  const t = String(iso ?? '').trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) return t;
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const now = new Date();
  return `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

export function isFiscalRazaoRow(row: VisionBalanceteRow): boolean {
  return (row.classificacao ?? '').startsWith(FISCAL_RAZAO_MARCA);
}

/**
 * Converte as notas/apurações fiscais (SpedInvoice) em lançamentos de razão (débito+crédito),
 * usando a regra resolvida por nota (fornecedor/histórico/tipo de imposto vence CFOP — ver
 * resolverRegraFiscalParaInvoice). Notas sem regra com as duas contas preenchidas ficam de fora
 * e voltam em `semRegra` para o usuário saber o que falta cadastrar.
 */
export function buildRazaoFromFiscalInvoices(
  invoices: SpedInvoice[],
  regras: FiscalAcumuladorRegra[],
  ordemInicial = 1,
): BuildFiscalRazaoResult {
  const rows: VisionBalanceteRow[] = [];
  const semRegra: SpedInvoice[] = [];
  let ordem = ordemInicial;
  let gerados = 0;

  for (const inv of invoices) {
    const valor = Math.abs(inv.value);
    if (valor < 0.0001) continue;

    const regra = resolverRegraFiscalParaInvoice(inv, regras);
    if (!regra?.contaDebito || !regra?.contaCredito) {
      semRegra.push(inv);
      continue;
    }

    const deb = normalizeConta(regra.contaDebito);
    const cred = normalizeConta(regra.contaCredito);
    const data = isoDateToDisplay(inv.date);
    const historico = `${inv.description} · ${inv.participantName}`.trim().toUpperCase();
    const classificacao = `${FISCAL_RAZAO_MARCA} · ${inv.id}`;

    rows.push({
      codigo: deb.codigo,
      classificacao,
      nome: historico,
      data,
      debito: valor,
      credito: 0,
      saldoInicial: 0,
      saldoFinal: 0,
      ordem,
      tipo: 'A',
      contaDeb: deb.codigo,
      contaCred: cred.codigo,
    });
    rows.push({
      codigo: cred.codigo,
      classificacao,
      nome: historico,
      data,
      debito: 0,
      credito: valor,
      saldoInicial: 0,
      saldoFinal: 0,
      ordem,
      tipo: 'A',
      contaDeb: deb.codigo,
      contaCred: cred.codigo,
    });
    ordem += 1;
    gerados += 1;
  }

  return { rows, gerados, semRegra };
}

export function mergeFiscalRazaoComExistente(
  existente: VisionBalanceteRow[],
  novos: VisionBalanceteRow[],
): VisionBalanceteRow[] {
  const base = existente.filter((r) => !isFiscalRazaoRow(r));
  const maxOrdem = base.reduce((m, r) => Math.max(m, r.ordem ?? 0), 0);
  // As duas linhas (débito+crédito) de uma mesma nota/apuração compartilham a mesma `ordem`
  // de origem — remapear por índice de linha (i) em vez de por grupo de ordem quebrava esse
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
