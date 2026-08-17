import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';
import {
  coletarLancamentosDominio,
  type DominioExportConfig,
} from '../../lib/dominioExporter';
import type { LoanRow } from '../../lib/loanCalculator';
import {
  normalizeCompanyName,
  readManagerData,
  writeManagerData,
  flushManagerDataWrites,
} from './companyWorkspace';
import { normalizeRazaoImport } from './contabilPipeline';
import {
  buildRazaoFromDominioPlain,
  mergeDominioPlainRazaoComExistente,
} from './dominioPlainToRazao';
import { assertSomenteCodigoReduzido } from './planoContasMapper';
import { salvarLoanScheduleBalanceCache } from './loanScheduleBalanceCache';

export const EMPRESTIMO_RAZAO_MARCA = 'EMPRESTIMO-AUTO';

const LOAN_CONTA_FIELDS = [
  ['accJurosAproDebit', 'Provisão juros a apropriar — débito'],
  ['accJurosAproCredit', 'Provisão juros a apropriar — crédito'],
  ['accApropriacaoDebit', 'Apropriação de juros — débito'],
  ['accApropriacaoCredit', 'Apropriação de juros — crédito'],
  ['accTransferenciaDebit', 'Transferência LP→CP — débito'],
  ['accTransferenciaCredit', 'Transferência LP→CP — crédito'],
  ['accEmprestimoDebit', 'Valor do empréstimo — débito'],
  ['accEmprestimoCredit', 'Valor do empréstimo — crédito'],
  ['accNaoPagoDebit', 'Mês não pago CP→LP — débito'],
  ['accNaoPagoCredit', 'Mês não pago CP→LP — crédito'],
  ['accAtrasadoPagoDebit', 'Pagamento atrasado LP→CP — débito'],
  ['accAtrasadoPagoCredit', 'Pagamento atrasado LP→CP — crédito'],
] as const;

/**
 * Resolve TODAS as contas do empréstimo para o CÓDIGO REDUZIDO do plano.
 * Classificação hierárquica (ex.: 3.2.2.01.00001 ou 3220100001) é PROIBIDA em
 * qualquer contêiner de contas do empréstimo: se a conta não resolver para um
 * reduzido do plano, vira pendência e o envio é bloqueado.
 */
export function resolveLoanContasSomenteReduzido(
  config: DominioExportConfig,
  plano: Array<{ code: string; name?: string; codigoReduzido?: string }>,
): { config: DominioExportConfig; pendencias: string[] } {
  const pendencias: string[] = [];
  const out: DominioExportConfig = { ...config };

  for (const [key, label] of LOAN_CONTA_FIELDS) {
    const raw = String(config[key] ?? '').trim();
    if (!raw) continue;
    const reduzido = assertSomenteCodigoReduzido(raw, plano);
    if (!reduzido) {
      pendencias.push(
        `${label}: conta «${raw}» não é um código reduzido do plano — classificação é proibida; corrija na aba Contas.`,
      );
      out[key] = '';
      continue;
    }
    out[key] = reduzido;
  }

  return { config: out, pendencias };
}

function dispatchRazaoUpdated(companyName: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('contabilfacil-razao-updated', { detail: { company: companyName } }),
  );
}

/**
 * Publica lançamentos do empréstimo (cronograma + contas) no balancete/razão.
 * Só sob ação explícita — recebe o schedule já calculado da UI.
 */
export function postEmprestimoNoRazao(
  companyName: string,
  contractId: string,
  schedule: LoanRow[],
  config: DominioExportConfig,
): { gerados: number; pendencias: string[] } {
  const company = normalizeCompanyName(companyName);
  const id = contractId.trim() || 'contrato';
  const pendencias: string[] = [];

  if (!schedule.length) {
    return { gerados: 0, pendencias: ['Cronograma vazio — calcule o empréstimo antes de enviar.'] };
  }

  // Todas as contas vão para o razão com o CÓDIGO REDUZIDO — o mesmo padrão do
  // extrato/conciliação. Classificação hierárquica é proibida: se alguma conta
  // não resolver para reduzido, o envio inteiro é bloqueado com pendência.
  const plano = readManagerData<{ code: string; codigoReduzido?: string }>(company, 'plano');

  const contas = resolveLoanContasSomenteReduzido(config, plano);
  if (contas.pendencias.length) {
    return { gerados: 0, pendencias: contas.pendencias };
  }

  const plain = coletarLancamentosDominio(schedule, contas.config);
  if (plain.length === 0) {
    return {
      gerados: 0,
      pendencias: ['Nenhum lançamento gerado — configure as contas na aba Contas.'],
    };
  }

  const { rows, gerados } = buildRazaoFromDominioPlain(plain, EMPRESTIMO_RAZAO_MARCA, id);
  const existente = readManagerData<VisionBalanceteRow>(company, 'razao');
  const merged = normalizeRazaoImport(
    mergeDominioPlainRazaoComExistente(existente, rows, EMPRESTIMO_RAZAO_MARCA, id),
  );
  writeManagerData(company, 'razao', merged);
  flushManagerDataWrites();
  dispatchRazaoUpdated(company);

  // Guarda o saldo devedor mês a mês (indicadores já resolvidos aqui) para a
  // correção monetária do Empréstimo Bancário (Automação) comparar sem recalcular.
  salvarLoanScheduleBalanceCache(company, id, schedule);

  if (gerados <= 0) pendencias.push('Nada novo para enviar ao balancete.');
  return { gerados, pendencias };
}
