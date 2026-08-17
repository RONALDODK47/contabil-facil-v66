/**
 * loanBalancetePreview.ts
 *
 * Gera um preview dos lançamentos contábeis que SERIAM enviados ao balancete
 * para um conjunto de contratos, sem gravar nada.
 *
 * Usado pelo modal de confirmação BalanceteEnvioModal para exibir ao usuário
 * o que será lançado antes de confirmar o envio.
 */
import { format } from 'date-fns';
import { calculateLoan } from '../../lib/loanCalculator';
import { loanParamsDatesValid } from '../../lib/loanParamsCodec';
import { coletarLancamentosDominio } from '../../lib/dominioExporter';
import { parseCurrency, pickSimTabForEditor } from '../../lib/simTabFields';
import type { SavedContract } from '../../lib/savedContractStorage';
import type { SelicDailyPoint } from '../../lib/selicOverIndex';
import type { EconomicIndicators } from '../../services/bcbService';
import type { BalanceteEnvioLancamento } from '../components/BalanceteEnvioModal';
import { resolveLoanContasSomenteReduzido } from './loanBalanceteAutomation';
import { normalizeCompanyName, readManagerData } from './companyWorkspace';

interface PreviewInput {
  companySavedContracts: SavedContract[];
  companyName: string;
  selicDailySeries: SelicDailyPoint[];
  monthlyIndexMap: Map<string, number> | null;
  indicators: EconomicIndicators | null;
  /** Função buildLoanParams extraída do useLoanModuleState para reutilizar */
  buildLoanParamsFn: (
    saved: SavedContract,
    tab: ReturnType<typeof pickSimTabForEditor>,
    selicDailySeries: SelicDailyPoint[],
    monthlyIndexMap: Map<string, number> | null,
    monthlyIndexFallbackPct: number | undefined,
  ) => any;
}

export interface BalancetePreviewResult {
  lancamentos: BalanceteEnvioLancamento[];
  totalContratos: number;
  erros: string[];
}

export function generateBalancetePreview(input: PreviewInput): BalancetePreviewResult {
  const { companySavedContracts, companyName, selicDailySeries, monthlyIndexMap, indicators, buildLoanParamsFn } = input;

  const company = normalizeCompanyName(companyName);
  const plano = readManagerData<{ code: string; codigoReduzido?: string }>(company, 'plano');

  const lancamentos: BalanceteEnvioLancamento[] = [];
  const erros: string[] = [];
  let totalContratos = 0;

  for (const saved of companySavedContracts) {
    const tab = pickSimTabForEditor(saved.formState);
    const principal = parseCurrency(tab.principalStr);
    if (principal <= 0) {
      erros.push(`${saved.contractNumber || saved.id}: principal inválido.`);
      continue;
    }

    const params = buildLoanParamsFn(
      saved,
      tab,
      selicDailySeries,
      monthlyIndexMap,
      tab.varMode === 'cdi' ? indicators?.cdiMensal : indicators?.selicMensal,
    );

    if (!loanParamsDatesValid(params)) {
      erros.push(`${saved.contractNumber || saved.id}: datas inválidas.`);
      continue;
    }

    const schedule = calculateLoan(params);
    if (!schedule.length) {
      erros.push(`${saved.contractNumber || saved.id}: cronograma vazio.`);
      continue;
    }

    // Contas SEMPRE em código reduzido — classificação bloqueia o contrato (igual ao envio).
    const contas = resolveLoanContasSomenteReduzido(
      {
        accJurosAproDebit:     tab.accJurosAproDebit,
        accJurosAproCredit:    tab.accJurosAproCredit,
        accApropriacaoDebit:   tab.accApropriacaoDebit,
        accApropriacaoCredit:  tab.accApropriacaoCredit,
        accTransferenciaDebit: tab.accTransferenciaDebit,
        accTransferenciaCredit:tab.accTransferenciaCredit,
        accEmprestimoDebit:    tab.accEmprestimoDebit,
        accEmprestimoCredit:   tab.accEmprestimoCredit,
        valorIof:              parseCurrency(tab.valorIofStr),
        codigoHistoricoDominio:       tab.dominioCodigoHistoricoStr,
        complementoHistoricoDominio:  tab.dominioComplementoHistoricoStr,
        dataGerarLancamentosAPartirStr: tab.dataGerarLancamentosAPartirStr?.trim() || undefined,
        omitTransferenciaLongoParaCurto: false,
      },
      plano,
    );
    if (contas.pendencias.length) {
      erros.push(`${saved.contractNumber || saved.id}: ${contas.pendencias.join(' | ')}`);
      continue;
    }

    const plain = coletarLancamentosDominio(schedule, contas.config);
    if (!plain.length) {
      erros.push(`${saved.contractNumber || saved.id}: nenhum lançamento gerado (configure as contas).`);
      continue;
    }

    totalContratos++;
    for (const lan of plain) {
      const valor = Math.abs(lan.value ?? 0);
      if (valor < 0.0001) continue;
      lancamentos.push({
        data: lan.date instanceof Date && !Number.isNaN(lan.date.getTime())
          ? format(lan.date, 'dd/MM/yyyy')
          : '—',
        contrato: saved.contractNumber || saved.id,
        historico: (lan.historico || 'LANCAMENTO').trim().toUpperCase(),
        debito: String(lan.debContaStr || '—').trim(),
        credito: String(lan.credContaStr || '—').trim(),
        valor,
      });
    }
  }

  return { lancamentos, totalContratos, erros };
}
