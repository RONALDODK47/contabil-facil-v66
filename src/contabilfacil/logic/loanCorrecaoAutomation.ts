import type { VisionBalanceteRow, VisionPlanoRow } from '../../extratoVision/types/accounting';
import type { SavedContract } from '../../lib/savedContractStorage';
import { pickSimTabForEditor, parseCurrency, parseGenericNumber } from '../../lib/simTabFields';
import {
  assertSomenteCodigoReduzido,
  derivePlanoGroupFromCode,
  derivePlanoNatureFromGroup,
  resolveClassificacaoDoPlano,
  sameCodigoReduzido,
  type PlanoGroup,
} from './planoContasMapper';
import { EMPRESTIMO_RAZAO_MARCA } from './loanBalanceteAutomation';
import {
  buildRazaoFromDominioPlain,
  isDominioPlainRazaoRowOfEntity,
  mergeDominioPlainRazaoComExistente,
  type DominioPlainLancamento,
} from './dominioPlainToRazao';
import { calculateLoan } from '../../lib/loanCalculator';
import { resolveGraceMonths, computeFirstInstallmentDate } from './loanScheduleDates';
import { loadSerie11FromStorageForRange, loadMonthlySerieFromStorageForRange } from '../../services/bcbSeriesStorage';
import { parseISO, addMonths, format } from 'date-fns';
import { buildLoanParams } from './useLoanModuleState';
import { extrairPeriodoRazao } from '../../extratoVision/utils/razaoContabil';
import { readAutomatizacaoContaConfig } from '../../extratoVision/utils/automatizacaoContaConfig';

/** Correção monetária de curto/longo prazo — ajusta o passivo para bater com a tabela. */
export const EMPRESTIMO_CORRECAO_MARCA = 'EMPRESTIMO-CORRECAO';
/** Estorno de parte do juros já apropriado — usado quando a parcela do banco > tabela. */
export const EMPRESTIMO_ESTORNO_JUROS_MARCA = 'EMPRESTIMO-ESTORNO-JUROS';
/** Ajuste de Exercício inicial para bater saldo inicial com a tabela de empréstimo. */
export const EMPRESTIMO_AJUSTE_EXERCICIO_MARCA = 'EMPRESTIMO-AJUSTE-EXERCICIO';

export interface LoanCorrecaoConfig {
  contaContrato?: string;
  contaCurto?: string;
  contaLongo?: string;
  contaCorrecaoMonetaria?: string;
  contaEstornoJurosAproDebit?: string;
  contaEstornoJurosAproCredit?: string;
  contaEstornoJurosDebito?: string;
  contaEstornoJurosCredito?: string;
  contaAjusteCredor?: string;
  contaAjusteDevedor?: string;
  /** Quando true, estorna juros apropriados automaticamente antes de gerar variação monetária. */
  aplicarReducaoJuros?: boolean;
}

/** Uma das contas configuradas na aba Empréstimos > Contas para este contrato. */
export interface LoanContaAnalisada {
  campo: 'accEmprestimoDebit' | 'accEmprestimoCredit' | 'accTransferenciaDebit' | 'accTransferenciaCredit';
  label: string;
  codigo: string;
  nome: string;
  grupo: PlanoGroup;
  /** Só as contas de PASSIVO entram na apuração do saldo devedor (ex.: Bancos/Caixa é ATIVO e fica de fora). */
  incluidoNoSaldoDevedor: boolean;
  /** Saldo final no razão (sinal já ajustado pela natureza da conta), sem as correções já aplicadas antes. */
  saldoFinal: number;
}

export interface LoanCorrecaoMesInfo {
  data: string; // "DD/MM/AAAA"
  saldoTabelaCurto: number;
  saldoTabelaLongo: number;
  saldoTabelaTotal: number;
  saldoRealCurto: number;
  saldoRealLongo: number;
  saldoRealTotal: number;
  diferencaCurto: number;
  diferencaLongo: number;
  diferencaTotal: number;
}

export interface LoanCorrecaoResumo {
  /** Data de referência da comparação formatada (DD/MM/AAAA) */
  dataReferencia?: string;
  /** Saldo total (curto + longo prazo) que a tabela do empréstimo espera na data de referência. */
  saldoTabela: number;
  /** Saldo curto prazo esperado pela tabela. */
  saldoTabelaCurto: number;
  /** Saldo longo prazo esperado pela tabela. */
  saldoTabelaLongo: number;
  /** Soma do saldo final das contas de passivo do empréstimo (automação + o que veio do banco). */
  saldoAtual: number;
  /** Saldo curto prazo no razão. */
  saldoAtualCurto: number;
  /** Saldo longo prazo no razão. */
  saldoAtualLongo: number;
  /** saldoAtual - saldoTabela. Positivo: passivo maior que a tabela. Negativo: passivo menor (parcela do banco pagou mais). */
  diferenca: number;
  /** Diferença no curto prazo. */
  diferencaCurto: number;
  /** Diferença no longo prazo. */
  diferencaLongo: number;
  /** Contas analisadas (aba Empréstimos > Contas), para exibir na tela o que está sendo comparado. */
  contas: LoanContaAnalisada[];
  /** Detalhamento mensal comparativo */
  meses?: LoanCorrecaoMesInfo[];
}

/** Lançamento gerado pela correção — usado no modal de confirmação após "Aplicar lançamento". */
export interface LoanLancamentoDetalhe {
  data: string; // DD/MM/AAAA
  contaDebito: string;
  contaCredito: string;
  valor: number;
  historico: string;
}

export interface LoanCorrecaoResult {
  ok: boolean;
  pendencias: string[];
  /**
   * Explicações de POR QUE um mês não bate com a tabela (sem bloquear a aplicação):
   * falta de amortização (nenhum lançamento do banco/manual no mês) ou amortização
   * insuficiente (banco amortizou menos que a tabela previa).
   */
  avisos?: string[];
  resumo?: LoanCorrecaoResumo;
  /** Razão já com os lançamentos de correção mesclados — undefined quando nada foi gerado. */
  novaRazao?: VisionBalanceteRow[];
  lancamentosGerados: number;
  /** Detalhe de cada lançamento gerado (ajustes, estornos e correções), na ordem em que foram criados. */
  lancamentosDetalhe?: LoanLancamentoDetalhe[];
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** `planoContasMapper.ts` usa `code`; `VisionPlanoRow` (extratoVision) usa `codigo` — mapeia para o formato esperado. */
function paraPlanoMapper(
  planoRows: VisionPlanoRow[],
): Array<{ code: string; name?: string; codigoReduzido?: string }> {
  return planoRows.map((p) => ({ code: p.codigo, name: p.nome, codigoReduzido: p.codigoReduzido }));
}

function encontrarContaPlano(
  reduzido: string,
  planoRows: VisionPlanoRow[],
): VisionPlanoRow | undefined {
  return planoRows.find((p) => sameCodigoReduzido(p.codigoReduzido, reduzido));
}

/** Saldo final de uma conta no razão, com sinal correto conforme sua natureza (Devedora/Credora). */
function saldoFinalPorNatureza(rows: VisionBalanceteRow[], codigo: string, grupo: PlanoGroup): number {
  let debito = 0;
  let credito = 0;
  for (const r of rows) {
    if ((r.codigo ?? '').trim() !== codigo) continue;
    debito += r.debito ?? 0;
    credito += r.credito ?? 0;
  }
  const nature = derivePlanoNatureFromGroup(grupo);
  return round2(nature === 'CREDORA' ? credito - debito : debito - credito);
}

const CONTAS_EMPRESTIMO_CAMPOS: Array<{
  campo: LoanContaAnalisada['campo'];
  label: string;
}> = [
  { campo: 'accEmprestimoDebit', label: 'Valor do Empréstimo — Débito' },
  { campo: 'accEmprestimoCredit', label: 'Valor do Empréstimo — Crédito' },
  { campo: 'accTransferenciaDebit', label: 'Transferência LP→CP — Débito' },
  { campo: 'accTransferenciaCredit', label: 'Transferência LP→CP — Crédito' },
];

/**
 * Lê as contas do empréstimo configuradas na aba Empréstimos > Contas para este
 * contrato, resolve a natureza de cada uma no plano (Devedora/Credora, via grupo
 * 1–8) e apura o saldo final de cada uma no razão. Só as contas classificadas como
 * PASSIVO entram no total do "saldo devedor" — uma conta de Ativo (ex.: Bancos)
 * configurada por engano no campo débito fica de fora automaticamente.
 */
export function analisarContasEmprestimo(
  razaoRows: VisionBalanceteRow[],
  contrato: SavedContract,
  planoRows: VisionPlanoRow[],
): LoanContaAnalisada[] {
  const tab = pickSimTabForEditor(contrato.formState);
  const planoMapper = paraPlanoMapper(planoRows);
  const out: LoanContaAnalisada[] = [];

  for (const { campo, label } of CONTAS_EMPRESTIMO_CAMPOS) {
    const raw = String(tab[campo] ?? '').trim();
    if (!raw) continue;
    const reduzido = assertSomenteCodigoReduzido(raw, planoMapper);
    if (!reduzido) continue;
    const contaPlano = encontrarContaPlano(reduzido, planoRows);
    const classificacao = contaPlano?.codigo ?? resolveClassificacaoDoPlano(reduzido, planoMapper);
    const grupo = derivePlanoGroupFromCode(classificacao);
    const incluidoNoSaldoDevedor = grupo === 'PASSIVO';
    out.push({
      campo,
      label,
      codigo: reduzido,
      nome: contaPlano?.nome ?? '',
      grupo,
      incluidoNoSaldoDevedor,
      saldoFinal: saldoFinalPorNatureza(razaoRows, reduzido, grupo),
    });
  }

  return out;
}

/** Última "APROPRIACAO DE JUROS" que a automação postou para o contrato (débito/crédito originais + valor). */
function localizarUltimoJurosApropriado(
  razaoRows: VisionBalanceteRow[],
  contratoId: string,
): { contaDebito: string; contaCredito: string; valor: number } | null {
  const doContrato = razaoRows.filter((r) => isDominioPlainRazaoRowOfEntity(r, EMPRESTIMO_RAZAO_MARCA, contratoId));
  const porNome = new Map<string, VisionBalanceteRow[]>();
  for (const r of doContrato) {
    const nome = r.nome ?? '';
    if (!nome.includes('|APROPRIACAO DE JUROS')) continue;
    if (!porNome.has(nome)) porNome.set(nome, []);
    porNome.get(nome)!.push(r);
  }
  if (!porNome.size) return null;

  let melhorNome = '';
  let melhorOrdem = -1;
  for (const [nome, par] of porNome) {
    const ordem = Math.max(...par.map((p) => p.ordem ?? 0));
    if (ordem > melhorOrdem) {
      melhorOrdem = ordem;
      melhorNome = nome;
    }
  }
  const par = porNome.get(melhorNome);
  if (!par) return null;

  const deb = par.find((p) => (p.debito ?? 0) > 0);
  const cred = par.find((p) => (p.credito ?? 0) > 0);
  if (!deb || !cred) return null;

  return {
    contaDebito: (deb.codigo ?? '').trim(),
    contaCredito: (cred.codigo ?? '').trim(),
    valor: deb.debito ?? 0,
  };
}

function parseBrDateToIso(brDate: string): string {
  const parts = brDate.trim().split('/');
  if (parts.length === 3) {
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
  }
  return brDate;
}

function saldoRealNaData(
  rows: VisionBalanceteRow[],
  reduzido: string,
  grupo: PlanoGroup,
  limitDateIso: string,
): number {
  let debito = 0;
  let credito = 0;
  for (const r of rows) {
    const raw = r.data?.trim();
    if (!raw) continue;
    const rDateIso = parseBrDateToIso(raw);
    if (rDateIso > limitDateIso) continue;
    if ((r.codigo ?? '').trim() !== reduzido) continue;
    debito += r.debito ?? 0;
    credito += r.credito ?? 0;
  }
  const nature = derivePlanoNatureFromGroup(grupo);
  return round2(nature === 'CREDORA' ? credito - debito : debito - credito);
}

/**
 * Compara o saldo de curto e longo prazo que a TABELA do empréstimo espera na
 * data de referência — vindo do cache gravado no último "mandar para o balancete"
 * (`loanScheduleBalanceCache`), já com os indicadores do BCB resolvidos — contra a
 * soma dos saldos finais das contas de PASSIVO do empréstimo no razão (automação + o
 * que veio do banco) e gera SÓ a diferença. Nunca mexe no lançamento de origem do
 * banco.
 *
 * Compara separadamente:
 * - Curto prazo do razão vs. Curto prazo da tabela
 * - Longo prazo do razão vs. Longo prazo da tabela
 *
 * Reaplica de forma idempotente: cada chamada substitui a correção anterior deste
 * contrato (nunca acumula), recalculando a diferença bruta a partir do que veio do banco.
 */
export function aplicarCorrecaoEmprestimo(
  razaoRows: VisionBalanceteRow[],
  contrato: SavedContract,
  planoRows: VisionPlanoRow[],
  config: LoanCorrecaoConfig,
  saldoTabelaEsperado: number | null,
  saldoTabelaCurto: number | null = null,
  saldoTabelaLongo: number | null = null,
): LoanCorrecaoResult {
  const pendencias: string[] = [];
  const contratoId = contrato.id;
  const planoMapper = paraPlanoMapper(planoRows);
  const periodo = extrairPeriodoRazao(razaoRows);
  const refDate = periodo.max ? parseISO(parseBrDateToIso(periodo.max)) : new Date();

  let schedule: any[] = [];
  try {
    const tab = pickSimTabForEditor(contrato.formState);
    const principal = parseCurrency(tab.principalStr);
    if (principal > 0) {
      const gracePeriod = resolveGraceMonths(tab.gracePeriodStr, tab.graceDaysStr);
      const months = Math.max(1, parseGenericNumber(contrato.formState.monthsStr));
      const contractDateStr = String(contrato.formState.contractDateStr ?? '').trim().slice(0, 10);
      const contractDate = parseISO(contractDateStr);
      const firstInstallmentDate = parseISO(computeFirstInstallmentDate(contractDateStr, gracePeriod));
      const end = addMonths(firstInstallmentDate, months);

      let selicDailySeries: any[] = [];
      if (tab.varMode === 'pronampe') {
        selicDailySeries = loadSerie11FromStorageForRange(contractDate, end) || [];
      }

      let monthlyIndexMap: Map<string, number> | null = null;
      let monthlyIndexFallbackPct: number | undefined = undefined;

      if (tab.varMode === 'cdi' || tab.varMode === 'selic') {
        const serieCode = tab.varMode === 'cdi' ? 4391 : 4390;
        const cachedMonthly = loadMonthlySerieFromStorageForRange(serieCode, contractDate, end);
        if (cachedMonthly?.length) {
          monthlyIndexMap = new Map<string, number>();
          for (const row of cachedMonthly) {
            monthlyIndexMap.set(row.month, row.ratePct);
          }
          monthlyIndexFallbackPct = cachedMonthly[cachedMonthly.length - 1].ratePct;
        }
      }

      const params = buildLoanParams(
        contrato,
        tab,
        selicDailySeries,
        monthlyIndexMap,
        monthlyIndexFallbackPct
      );

      schedule = calculateLoan(params);
    }
  } catch (e) {
    console.warn('Erro ao calcular cronograma:', e);
  }

  let finalSaldoTabela = saldoTabelaEsperado;
  let finalSaldoCurto = saldoTabelaCurto;
  let finalSaldoLongo = saldoTabelaLongo;

  if (finalSaldoTabela == null && schedule.length) {
    const refTime = refDate.getTime();
    let melhor: any = null;
    for (const r of schedule) {
      const t = r.date.getTime();
      if (t <= refTime && (!melhor || t > melhor.date.getTime())) {
        melhor = r;
      }
    }
    const ponto = melhor || schedule[0];
    finalSaldoTabela = ponto.finalBalance ?? 0;
    finalSaldoCurto = ponto.shortTermBalance ?? 0;
    finalSaldoLongo = ponto.longTermBalance ?? 0;
  }

  if (finalSaldoTabela == null) {
    return {
      ok: false,
      pendencias: [
        'Nenhuma tabela em cache para este contrato — mande o empréstimo para o balancete (aba Empréstimos) antes de aplicar a correção.',
      ],
      lancamentosGerados: 0,
    };
  }

  saldoTabelaEsperado = finalSaldoTabela;
  saldoTabelaCurto = finalSaldoCurto;
  saldoTabelaLongo = finalSaldoLongo;

  // Exclui correções/estornos de rodadas anteriores para recalcular a diferença BRUTA
  // (automação + o que veio do banco), garantindo que reaplicar não acumule ajuste.
  const rowsSemCorrecaoAnterior = razaoRows.filter(
    (r) =>
      !isDominioPlainRazaoRowOfEntity(r, EMPRESTIMO_CORRECAO_MARCA, contratoId) &&
      !isDominioPlainRazaoRowOfEntity(r, EMPRESTIMO_ESTORNO_JUROS_MARCA, contratoId) &&
      !isDominioPlainRazaoRowOfEntity(r, EMPRESTIMO_AJUSTE_EXERCICIO_MARCA, contratoId),
  );

  const reduzidoCurto = config.contaCurto ? assertSomenteCodigoReduzido(config.contaCurto, planoMapper) : null;
  const reduzidoLongo = config.contaLongo ? assertSomenteCodigoReduzido(config.contaLongo, planoMapper) : null;

  // 1) Ajuste de Exercício (se o saldo anterior no fechamento não bater com a tabela)
  const configAuto = readAutomatizacaoContaConfig(contrato.companyName);
  const corteBr = configAuto.periodoFechadoAte?.trim();
  const ajustePlain: DominioPlainLancamento[] = [];

  const parseCorteDateStr = (corteStr: string): Date | null => {
    const s = corteStr.trim();
    const ddmm = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (ddmm) {
      return new Date(Number(ddmm[3]), Number(ddmm[2]) - 1, Number(ddmm[1]));
    }
    const mmaaaa = /^(\d{1,2})\/(\d{4})$/.exec(s);
    if (mmaaaa) {
      return new Date(Number(mmaaaa[2]), Number(mmaaaa[1]), 0);
    }
    return null;
  };

  const corteDate = corteBr ? parseCorteDateStr(corteBr) : null;
  
  if (corteDate) {
    const corteDateIso = format(corteDate, 'yyyy-MM-dd');
    const diaSeguinte = new Date(corteDate.getTime());
    diaSeguinte.setDate(diaSeguinte.getDate() + 1);

    const cpRealAntes = reduzidoCurto ? saldoRealNaData(rowsSemCorrecaoAnterior, reduzidoCurto, 'PASSIVO', corteDateIso) : 0;
    const lpRealAntes = reduzidoLongo ? saldoRealNaData(rowsSemCorrecaoAnterior, reduzidoLongo, 'PASSIVO', corteDateIso) : 0;

    let tabelaCPNaData = 0;
    let tabelaLPNaData = 0;
    if (schedule && schedule.length) {
      const corteTime = corteDate.getTime();
      let melhor: any = null;
      for (const r of schedule) {
        const t = r.date.getTime();
        if (t <= corteTime && (!melhor || t > melhor.date.getTime())) {
          melhor = r;
        }
      }
      const ponto = melhor || schedule[0];
      if (ponto.date.getTime() <= corteTime) {
        tabelaCPNaData = ponto.shortTermBalance ?? 0;
        tabelaLPNaData = ponto.longTermBalance ?? 0;
      }
    }

    const diffCP = round2(cpRealAntes - tabelaCPNaData);
    const diffLP = round2(lpRealAntes - tabelaLPNaData);

    const reduzidoAjusteCredor = config.contaAjusteCredor ? assertSomenteCodigoReduzido(config.contaAjusteCredor, planoMapper) : null;
    const reduzidoAjusteDevedor = config.contaAjusteDevedor ? assertSomenteCodigoReduzido(config.contaAjusteDevedor, planoMapper) : null;

    if (Math.abs(diffCP) >= 0.005) {
      if (diffCP > 0) {
        if (reduzidoAjusteCredor) {
          ajustePlain.push({
            date: diaSeguinte,
            debContaStr: reduzidoCurto!,
            credContaStr: reduzidoAjusteCredor,
            value: Math.abs(diffCP),
            historico: 'AJUSTE EXERCICIO CREDOR CURTO PRAZO — SALDO INICIAL EMPRESTIMO',
          });
        } else {
          pendencias.push('Diferença credora no curto prazo detectada. Configure a conta de Ajuste Exercício Credor.');
        }
      } else {
        if (reduzidoAjusteDevedor) {
          ajustePlain.push({
            date: diaSeguinte,
            debContaStr: reduzidoAjusteDevedor,
            credContaStr: reduzidoCurto!,
            value: Math.abs(diffCP),
            historico: 'AJUSTE EXERCICIO DEVEDOR CURTO PRAZO — SALDO INICIAL EMPRESTIMO',
          });
        } else {
          pendencias.push('Diferença devedora no curto prazo detectada. Configure a conta de Ajuste Exercício Devedor.');
        }
      }
    }

    if (Math.abs(diffLP) >= 0.005) {
      if (diffLP > 0) {
        if (reduzidoAjusteCredor) {
          ajustePlain.push({
            date: diaSeguinte,
            debContaStr: reduzidoLongo!,
            credContaStr: reduzidoAjusteCredor,
            value: Math.abs(diffLP),
            historico: 'AJUSTE EXERCICIO CREDOR LONGO PRAZO — SALDO INICIAL EMPRESTIMO',
          });
        } else {
          pendencias.push('Diferença credora no longo prazo detectada. Configure a conta de Ajuste Exercício Credor.');
        }
      } else {
        if (reduzidoAjusteDevedor) {
          ajustePlain.push({
            date: diaSeguinte,
            debContaStr: reduzidoAjusteDevedor,
            credContaStr: reduzidoLongo!,
            value: Math.abs(diffLP),
            historico: 'AJUSTE EXERCICIO DEVEDOR LONGO PRAZO — SALDO INICIAL EMPRESTIMO',
          });
        } else {
          pendencias.push('Diferença devedora no longo prazo detectada. Configure a conta de Ajuste Exercício Devedor.');
        }
      }
    }
  }

  const ajustesRows = buildRazaoFromDominioPlain(ajustePlain, EMPRESTIMO_AJUSTE_EXERCICIO_MARCA, contratoId).rows;
  const rowsComAjustes = [...rowsSemCorrecaoAnterior, ...ajustesRows];

  const contas = analisarContasEmprestimo(rowsComAjustes, contrato, planoRows);
  const contasPassivo = contas.filter((c) => c.incluidoNoSaldoDevedor);
  if (!contasPassivo.length) {
    return {
      ok: false,
      pendencias: [
        'Nenhuma conta de PASSIVO encontrada entre as contas do empréstimo (aba Contas) — configure/confira as contas antes de aplicar a correção.',
      ],
      lancamentosGerados: 0,
    };
  }

  const saldoAtualCurto = reduzidoCurto ? saldoFinalPorNatureza(rowsComAjustes, reduzidoCurto, 'PASSIVO') : 0;
  const saldoAtualLongo = reduzidoLongo ? saldoFinalPorNatureza(rowsComAjustes, reduzidoLongo, 'PASSIVO') : 0;

  const saldoTabela = round2(saldoTabelaEsperado ?? 0);
  const saldoTabelaCurtoCalc = round2(saldoTabelaCurto ?? 0);
  const saldoTabelaLongoCalc = round2(saldoTabelaLongo ?? 0);
  const saldoAtual = round2(contasPassivo.reduce((sum, c) => sum + c.saldoFinal, 0));
  const diferenca = round2(saldoAtual - saldoTabela);
  const diferencaCurto = round2(saldoAtualCurto - saldoTabelaCurtoCalc);
  const diferencaLongo = round2(saldoAtualLongo - saldoTabelaLongoCalc);

  const dataReferencia = periodo.max ? periodo.max.split('-').reverse().join('/') : new Date().toLocaleDateString('pt-BR');
  const maxDateIso = periodo.max ? parseBrDateToIso(periodo.max) : new Date().toISOString().slice(0, 10);

  const meses: LoanCorrecaoMesInfo[] = [];
  if (schedule && schedule.length) {
    for (const r of schedule) {
      const rDateIso = format(r.date, 'yyyy-MM-dd');
      if (rDateIso > maxDateIso) continue;
      const dateBr = format(r.date, 'dd/MM/yyyy');
      const stExpected = r.shortTermBalance ?? 0;
      const ltExpected = r.longTermBalance ?? 0;
      const totExpected = r.finalBalance ?? 0;

      const stReal = reduzidoCurto ? saldoRealNaData(rowsComAjustes, reduzidoCurto, 'PASSIVO', rDateIso) : 0;
      const ltReal = reduzidoLongo ? saldoRealNaData(rowsComAjustes, reduzidoLongo, 'PASSIVO', rDateIso) : 0;
      const totReal = round2(stReal + ltReal);

      meses.push({
        data: dateBr,
        saldoTabelaCurto: stExpected,
        saldoTabelaLongo: ltExpected,
        saldoTabelaTotal: totExpected,
        saldoRealCurto: stReal,
        saldoRealLongo: ltReal,
        saldoRealTotal: totReal,
        diferencaCurto: round2(stReal - stExpected),
        diferencaLongo: round2(ltReal - ltExpected),
        diferencaTotal: round2(totReal - totExpected),
      });
    }
  }

  const resumo: LoanCorrecaoResumo = {
    dataReferencia,
    saldoTabela,
    saldoTabelaCurto: saldoTabelaCurtoCalc,
    saldoTabelaLongo: saldoTabelaLongoCalc,
    saldoAtual,
    saldoAtualCurto,
    saldoAtualLongo,
    diferenca,
    diferencaCurto,
    diferencaLongo,
    contas,
    meses,
  };

  const novasCorrecoesRows: VisionBalanceteRow[] = [];
  const acumuladoRows = [...rowsComAjustes];

  const dataInicioStr = configAuto.dataInicio ?? '01/01/2020';
  const dataFimStr = configAuto.dataFim ?? '31/12/2030';
  
  const startParts = dataInicioStr.split('/');
  const endParts = dataFimStr.split('/');
  
  let currentYear = Number(startParts[2]) || 2026;
  let currentMonth = Number(startParts[1]) || 1;
  const targetYear = Number(endParts[2]) || 2026;
  const targetMonth = Number(endParts[1]) || 12;

  const temEstornoAproConfigurado =
    (config.contaEstornoJurosAproDebit?.trim() ?? '') !== '' &&
    (config.contaEstornoJurosAproCredit?.trim() ?? '') !== '';
  const temReducaoJurosConfigurada =
    (config.contaEstornoJurosDebito?.trim() ?? '') !== '' &&
    (config.contaEstornoJurosCredito?.trim() ?? '') !== '';

  // Conta de passivo usada como contrapartida dos ajustes — prioriza accEmprestimoCredit
  const contaPassivoPrincipal =
    contasPassivo.find((c) => c.campo === 'accEmprestimoCredit')?.codigo ?? contasPassivo[0].codigo;

  const getTabelaSaldosNoFimDoMes = (sch: any[], y: number, m: number) => {
    let st = 0;
    let lt = 0;
    let tot = 0;
    const limitTime = new Date(y, m, 0).getTime();
    let melhor: any = null;
    for (const r of sch) {
      const t = r.date.getTime();
      if (t <= limitTime && (!melhor || t > melhor.date.getTime())) {
        melhor = r;
      }
    }
    if (melhor) {
      st = melhor.shortTermBalance ?? 0;
      lt = melhor.longTermBalance ?? 0;
      tot = melhor.finalBalance ?? 0;
    }
    return { st, lt, tot };
  };

  const localizarJurosApropriadoNoMes = (
    rows: VisionBalanceteRow[],
    cId: string,
    y: number,
    m: number
  ) => {
    const targetPrefix = `${m.toString().padStart(2, '0')}/${y}`;
    const doContrato = rows.filter((r) => {
      if (!isDominioPlainRazaoRowOfEntity(r, EMPRESTIMO_RAZAO_MARCA, cId)) return false;
      return r.data && r.data.includes(targetPrefix);
    });
    const porNome = new Map<string, VisionBalanceteRow[]>();
    for (const r of doContrato) {
      const nome = r.nome ?? '';
      if (!nome.includes('|APROPRIACAO DE JUROS')) continue;
      if (!porNome.has(nome)) porNome.set(nome, []);
      porNome.get(nome)!.push(r);
    }
    if (!porNome.size) return null;
    const firstKey = Array.from(porNome.keys())[0];
    const par = porNome.get(firstKey);
    if (!par) return null;
    const deb = par.find((p) => (p.debito ?? 0) > 0);
    const cred = par.find((p) => (p.credito ?? 0) > 0);
    if (!deb || !cred) return null;
    return {
      contaDebito: deb.codigo,
      contaCredito: cred.codigo,
      valor: deb.debito ?? 0,
    };
  };

  let gerados = ajustePlain.length;

  /**
   * Mês tem amortização real (lançamento do banco ou amortização manual) nas contas
   * de curto/longo prazo? Só considera o razão SEM as correções de rodadas anteriores
   * — lançamento gerado pelo próprio sistema nunca conta como amortização.
   */
  const mesTemAmortizacao = (year: number, month: number): boolean =>
    rowsSemCorrecaoAnterior.some((r) => {
      if (!r.data) return false;
      const parts = r.data.split('/');
      if (parts.length === 3) {
        const rMonth = Number(parts[1]);
        const rYear = Number(parts[2]);
        if (rYear === year && rMonth === month) {
          return (r.codigo === reduzidoCurto || r.codigo === reduzidoLongo) && (r.debito ?? 0) > 0;
        }
      }
      return false;
    });

  // Todos os lançamentos plain gerados nesta rodada — vira lancamentosDetalhe no retorno.
  const todosPlain: DominioPlainLancamento[] = [...ajustePlain];
  // Meses (MM/AAAA) com amortização cuja diferença foi totalmente corrigida — a tabela
  // de visualização zera a diferença desses meses (ela "some" da lista de divergências).
  const mesesCorrigidos = new Set<string>();

  while (
    currentYear < targetYear ||
    (currentYear === targetYear && currentMonth <= targetMonth)
  ) {
    const year = currentYear;
    const month = currentMonth;
    
    currentMonth++;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear++;
    }

    if (corteDate && new Date(year, month - 1, 1).getTime() <= corteDate.getTime()) {
      continue;
    }

    // REGRA REFORÇADA: estorno de juros e variação/correção monetária SÓ podem ser
    // lançados em mês que já tem amortização vinda do banco (ou lançada manualmente)
    // nas contas de curto/longo prazo. O sistema NUNCA faz a amortização
    // automaticamente — sem esse movimento, o mês é pulado por inteiro.
    if (!mesTemAmortizacao(year, month)) {
      continue;
    }

    const target = getTabelaSaldosNoFimDoMes(schedule, year, month);
    const dateBrFim = new Date(year, month, 0).toLocaleDateString('pt-BR');
    const dateIsoFim = format(new Date(year, month, 0), 'yyyy-MM-dd');
    
    const cpReal = reduzidoCurto ? saldoRealNaData(acumuladoRows, reduzidoCurto, 'PASSIVO', dateIsoFim) : 0;
    const lpReal = reduzidoLongo ? saldoRealNaData(acumuladoRows, reduzidoLongo, 'PASSIVO', dateIsoFim) : 0;
    const realTotal = round2(cpReal + lpReal);
    let restanteM = round2(realTotal - target.tot);

    // 1) Estorno de juros apropriados
    if ((temEstornoAproConfigurado || temReducaoJurosConfigurada) && restanteM < 0) {
      const juros = localizarJurosApropriadoNoMes(acumuladoRows, contratoId, year, month);
      if (juros && juros.valor > 0) {
        const valorEstorno = Math.min(Math.abs(restanteM), juros.valor);
        
        if (temEstornoAproConfigurado) {
          const contaDebito = assertSomenteCodigoReduzido(config.contaEstornoJurosAproDebit!, planoMapper) || contaPassivoPrincipal;
          const contaCredito = assertSomenteCodigoReduzido(config.contaEstornoJurosAproCredit!, planoMapper) || juros.contaDebito;
          const estPlain = {
            date: new Date(year, month, 0),
            debContaStr: contaDebito,
            credContaStr: contaCredito,
            value: valorEstorno,
            historico: `ESTORNO JUROS APROPRIADO — PARCELA BANCO MAIOR QUE TABELA — ${month.toString().padStart(2, '0')}/${year}`,
          };
          const estRows = buildRazaoFromDominioPlain([estPlain], EMPRESTIMO_ESTORNO_JUROS_MARCA, contratoId).rows;
          acumuladoRows.push(...estRows);
          novasCorrecoesRows.push(...estRows);
          todosPlain.push(estPlain);
          gerados++;
        }

        if (temReducaoJurosConfigurada) {
          const contaDebito = assertSomenteCodigoReduzido(config.contaEstornoJurosDebito!, planoMapper) || juros.contaDebito;
          const contaCredito = assertSomenteCodigoReduzido(config.contaEstornoJurosCredito!, planoMapper) || juros.contaDebito;
          const redPlain = {
            date: new Date(year, month, 0),
            debContaStr: contaDebito,
            credContaStr: contaCredito,
            value: valorEstorno,
            historico: `REDUZIR JUROS APROPRIADO — DESPESA COM JUROS — ${month.toString().padStart(2, '0')}/${year}`,
          };
          const redRows = buildRazaoFromDominioPlain([redPlain], EMPRESTIMO_ESTORNO_JUROS_MARCA, contratoId).rows;
          acumuladoRows.push(...redRows);
          novasCorrecoesRows.push(...redRows);
          todosPlain.push(redPlain);
          gerados++;
        }

        restanteM = round2(restanteM + valorEstorno);
      }
    }

    const mesLabel = `${month.toString().padStart(2, '0')}/${year}`;

    // 2) Rebalanceamento curto × longo prazo — a PRIMEIRA regra é olhar o SALDO
    // ANTERIOR real de cada conta antes de lançar. Um débito automático maior que o
    // saldo credor disponível (ex.: transferência LP→CP do cronograma numa conta de
    // longo prazo já zerada) inverte o passivo; o total curto+longo continua batendo,
    // então a correção por total nunca enxergava o problema. Aqui, se uma das contas
    // está acima da tabela e a outra abaixo (inclusive invertida), transfere entre
    // elas até cada uma bater com a tabela. O valor é limitado ao excedente da conta
    // de origem — como a tabela nunca é negativa, o débito jamais ultrapassa o saldo
    // credor disponível, e a transferência não cria nova inversão.
    if (reduzidoCurto && reduzidoLongo && reduzidoCurto !== reduzidoLongo) {
      const cpAtual = saldoRealNaData(acumuladoRows, reduzidoCurto, 'PASSIVO', dateIsoFim);
      const lpAtual = saldoRealNaData(acumuladoRows, reduzidoLongo, 'PASSIVO', dateIsoFim);
      const difCp = round2(cpAtual - target.st);
      const difLp = round2(lpAtual - target.lt);

      let rebalancePlain: DominioPlainLancamento | null = null;
      if (difCp >= 0.005 && difLp <= -0.005) {
        // Curto acima da tabela, longo abaixo/invertido → transfere do curto para o longo
        rebalancePlain = {
          date: new Date(year, month, 0),
          debContaStr: reduzidoCurto,
          credContaStr: reduzidoLongo,
          value: round2(Math.min(difCp, -difLp)),
          historico: `REBALANCEAMENTO CURTO/LONGO PRAZO — AJUSTE PELA TABELA — ${mesLabel}`,
        };
      } else if (difLp >= 0.005 && difCp <= -0.005) {
        // Longo acima da tabela, curto abaixo/invertido → transfere do longo para o curto
        rebalancePlain = {
          date: new Date(year, month, 0),
          debContaStr: reduzidoLongo,
          credContaStr: reduzidoCurto,
          value: round2(Math.min(difLp, -difCp)),
          historico: `REBALANCEAMENTO CURTO/LONGO PRAZO — AJUSTE PELA TABELA — ${mesLabel}`,
        };
      }

      if (rebalancePlain && rebalancePlain.value >= 0.01) {
        const rebRows = buildRazaoFromDominioPlain([rebalancePlain], EMPRESTIMO_CORRECAO_MARCA, contratoId).rows;
        acumuladoRows.push(...rebRows);
        novasCorrecoesRows.push(...rebRows);
        todosPlain.push(rebalancePlain);
        gerados++;
      }
    }

    // 3) Correção monetária POR CONTA — depois do rebalanceamento, CADA conta
    // (curto e longo) é ajustada individualmente contra a conta de variação
    // monetária até bater com a SUA coluna na tabela do contrato. Antes o ajuste
    // era só pelo total e sempre na "conta principal" do contrato — a conta de
    // curto prazo podia ficar acima da tabela (ex.: 152 com transferência LP→CP
    // creditada a mais) sem nunca ser corrigida.
    const contaCorrecao = config.contaCorrecaoMonetaria ? assertSomenteCodigoReduzido(config.contaCorrecaoMonetaria, planoMapper) : '';
    if (reduzidoCurto && reduzidoLongo) {
      const alvos =
        reduzidoCurto === reduzidoLongo
          ? [{ conta: reduzidoCurto, alvo: target.tot, label: 'SALDO' }]
          : [
              { conta: reduzidoCurto, alvo: target.st, label: 'CURTO PRAZO' },
              { conta: reduzidoLongo, alvo: target.lt, label: 'LONGO PRAZO' },
            ];
      for (const { conta, alvo, label } of alvos) {
        const real = saldoRealNaData(acumuladoRows, conta, 'PASSIVO', dateIsoFim);
        const dif = round2(real - alvo);
        if (Math.abs(dif) < 0.005) continue;
        if (!contaCorrecao) {
          if (!pendencias.includes('Informe a conta de correção monetária para ajustar o saldo do empréstimo.')) {
            pendencias.push('Informe a conta de correção monetária para ajustar o saldo do empréstimo.');
          }
          continue;
        }
        const debitaPassivo = dif > 0;
        const corrPlain = {
          date: new Date(year, month, 0),
          debContaStr: debitaPassivo ? conta : contaCorrecao,
          credContaStr: debitaPassivo ? contaCorrecao : conta,
          value: Math.abs(dif),
          historico: `CORRECAO MONETARIA EMPRESTIMO — ${label} — AJUSTE DO MES ${mesLabel}`,
        };
        const corrRows = buildRazaoFromDominioPlain([corrPlain], EMPRESTIMO_CORRECAO_MARCA, contratoId).rows;
        acumuladoRows.push(...corrRows);
        novasCorrecoesRows.push(...corrRows);
        todosPlain.push(corrPlain);
        gerados++;
      }
      // Recalcula o resíduo total do mês após os ajustes por conta.
      const cpFim = saldoRealNaData(acumuladoRows, reduzidoCurto, 'PASSIVO', dateIsoFim);
      const lpFim = reduzidoCurto === reduzidoLongo ? 0 : saldoRealNaData(acumuladoRows, reduzidoLongo, 'PASSIVO', dateIsoFim);
      restanteM = round2(cpFim + lpFim - target.tot);
    } else if (Math.abs(restanteM) >= 0.005) {
      // Fallback (sem par curto/longo configurado): ajuste pelo total na conta principal.
      if (contaCorrecao) {
        const debitaPassivo = restanteM > 0;
        const corrPlain = {
          date: new Date(year, month, 0),
          debContaStr: debitaPassivo ? contaPassivoPrincipal : contaCorrecao,
          credContaStr: debitaPassivo ? contaCorrecao : contaPassivoPrincipal,
          value: Math.abs(restanteM),
          historico: `CORRECAO MONETARIA EMPRESTIMO — AJUSTE DO MES ${mesLabel}`,
        };
        const corrRows = buildRazaoFromDominioPlain([corrPlain], EMPRESTIMO_CORRECAO_MARCA, contratoId).rows;
        acumuladoRows.push(...corrRows);
        novasCorrecoesRows.push(...corrRows);
        todosPlain.push(corrPlain);
        gerados++;
        restanteM = 0;
      } else {
        pendencias.push('Informe a conta de correção monetária para ajustar o saldo do empréstimo.');
      }
    }

    // Mês com amortização totalmente ajustado (estorno/correção zerou a diferença):
    // a visualização de diferença não deve mais acusar divergência nele.
    if (Math.abs(restanteM) < 0.005) {
      mesesCorrigidos.add(`${month.toString().padStart(2, '0')}/${year}`);
    }
  }

  // Correção direta (sem mês específico): quando curto/longo não estão configurados o
  // loop acima não consegue detectar amortizações por conta. Calcula a diferença global
  // e gera os ajustes necessários uma vez, na data de referência do período.
  if (!reduzidoCurto && !reduzidoLongo) {
    const contaCorrecaoDir = config.contaCorrecaoMonetaria
      ? assertSomenteCodigoReduzido(config.contaCorrecaoMonetaria, planoMapper)
      : '';
    const totalReal = round2(contasPassivo.reduce((sum, c) => sum + saldoFinalPorNatureza(acumuladoRows, c.codigo, 'PASSIVO'), 0));
    let diffDir = round2(totalReal - saldoTabela);

    if (Math.abs(diffDir) >= 0.005) {
      const dataDir = refDate;

      // Diferença negativa: passivo real < tabela (banco pagou mais que o esperado).
      // Tenta estornar juros apropriados primeiro (quando aplicarReducaoJuros = true).
      if (diffDir < 0 && config.aplicarReducaoJuros) {
        const jurosDir = localizarUltimoJurosApropriado(acumuladoRows, contratoId);
        if (jurosDir && jurosDir.valor > 0) {
          const valorEstornoDir = Math.min(Math.abs(diffDir), jurosDir.valor);
          // Estorno reverso: débita a conta que foi creditada no lançamento original, credita a que foi debitada.
          const estPlain: DominioPlainLancamento = {
            date: dataDir,
            debContaStr: jurosDir.contaCredito,
            credContaStr: jurosDir.contaDebito,
            value: valorEstornoDir,
            historico: 'ESTORNO JUROS APROPRIADO — PARCELA BANCO MAIOR QUE TABELA',
          };
          const estRows = buildRazaoFromDominioPlain([estPlain], EMPRESTIMO_ESTORNO_JUROS_MARCA, contratoId).rows;
          acumuladoRows.push(...estRows);
          novasCorrecoesRows.push(...estRows);
          todosPlain.push(estPlain);
          gerados++;
          diffDir = round2(diffDir + valorEstornoDir);
        }
      }

      // Diferença ainda relevante: gera variação monetária.
      if (Math.abs(diffDir) >= 0.005 && contaCorrecaoDir) {
        const debitaPassivo = diffDir > 0;
        const corrPlain: DominioPlainLancamento = {
          date: dataDir,
          debContaStr: debitaPassivo ? contaPassivoPrincipal : contaCorrecaoDir,
          credContaStr: debitaPassivo ? contaCorrecaoDir : contaPassivoPrincipal,
          value: Math.abs(diffDir),
          historico: 'CORRECAO MONETARIA EMPRESTIMO — AJUSTE GLOBAL',
        };
        const corrRows = buildRazaoFromDominioPlain([corrPlain], EMPRESTIMO_CORRECAO_MARCA, contratoId).rows;
        acumuladoRows.push(...corrRows);
        novasCorrecoesRows.push(...corrRows);
        todosPlain.push(corrPlain);
        gerados++;
      } else if (Math.abs(diffDir) >= 0.005) {
        pendencias.push('Informe a conta de correção monetária para ajustar o saldo do empréstimo.');
      }
    }
  }

  // Agora recalcula o saldo atual e diferença para o resumo ao fim de refDate (incluindo todas as correções geradas).
  // Quando curto/longo prazo não estão configurados separadamente, usa o saldo de TODAS as contas de passivo.
  let cpRealFinal = 0;
  let lpRealFinal = 0;
  if (reduzidoCurto || reduzidoLongo) {
    // Recalcula com os rows pós-correção para mostrar o saldo após os ajustes do loop.
    cpRealFinal = reduzidoCurto ? saldoRealNaData(acumuladoRows, reduzidoCurto, 'PASSIVO', maxDateIso) : 0;
    lpRealFinal = reduzidoLongo ? saldoRealNaData(acumuladoRows, reduzidoLongo, 'PASSIVO', maxDateIso) : 0;
    const saldoAtualFinal = round2(cpRealFinal + lpRealFinal);
    resumo.saldoAtual = saldoAtualFinal;
    resumo.saldoAtualCurto = cpRealFinal;
    resumo.saldoAtualLongo = lpRealFinal;
    resumo.diferenca = round2(saldoAtualFinal - saldoTabela);
    resumo.diferencaCurto = round2(cpRealFinal - saldoTabelaCurtoCalc);
    resumo.diferencaLongo = round2(lpRealFinal - saldoTabelaLongoCalc);
  }
  // Quando não há contas de curto/longo configuradas, o resumo já tem os valores pré-correção
  // calculados em saldoAtual/diferenca (linhas 527-530) — mantém sem sobrescrever.

  // Também atualiza a lista de meses para mostrar as diferenças corrigidas na tabela de visualização
  if (resumo.meses) {
    for (const m of resumo.meses) {
      const mParts = m.data.split('/');
      const mYear = Number(mParts[2]);
      const mMonth = Number(mParts[1]);
      const mDateIso = format(new Date(mYear, mMonth, 0), 'yyyy-MM-dd');
      
      const stReal = reduzidoCurto ? saldoRealNaData(acumuladoRows, reduzidoCurto, 'PASSIVO', mDateIso) : 0;
      const ltReal = reduzidoLongo ? saldoRealNaData(acumuladoRows, reduzidoLongo, 'PASSIVO', mDateIso) : 0;
      const totReal = round2(stReal + ltReal);
      
      m.saldoRealCurto = stReal;
      m.saldoRealLongo = ltReal;
      m.saldoRealTotal = totReal;
      m.diferencaCurto = round2(stReal - m.saldoTabelaCurto);
      m.diferencaLongo = round2(ltReal - m.saldoTabelaLongo);
      m.diferencaTotal = round2(totReal - m.saldoTabelaTotal);

      // A diferença "some" da tabela em dois casos:
      // 1. Mês com amortização já corrigido pela rodada (a correção é lançada no fim
      //    do mês; comparar na data da parcela ainda acusaria resíduo).
      // 2. Mês SEM amortização do banco/manual: o sistema é PROIBIDO de lançar
      //    estorno/variação monetária nele (nunca amortiza automaticamente), então
      //    comparar o saldo real parado com a parcela teórica do cronograma acusaria
      //    uma divergência que não é acionável — o curto/longo do balancete é
      //    considerado batendo até existir a amortização.
      const mesCorrigido = mesesCorrigidos.has(`${mMonth.toString().padStart(2, '0')}/${mYear}`);
      if (mesCorrigido || !mesTemAmortizacao(mYear, mMonth)) {
        m.diferencaCurto = 0;
        m.diferencaLongo = 0;
        m.diferencaTotal = 0;
      }
    }
  }

  let razaoAtual = mergeDominioPlainRazaoComExistente(razaoRows, ajustesRows, EMPRESTIMO_AJUSTE_EXERCICIO_MARCA, contratoId);
  
  // Mescla estornos gerados
  const estornosGerados = novasCorrecoesRows.filter(r => isDominioPlainRazaoRowOfEntity(r, EMPRESTIMO_ESTORNO_JUROS_MARCA, contratoId));
  razaoAtual = mergeDominioPlainRazaoComExistente(razaoAtual, estornosGerados, EMPRESTIMO_ESTORNO_JUROS_MARCA, contratoId);

  // Mescla correções geradas
  const correcoesGeradas = novasCorrecoesRows.filter(r => isDominioPlainRazaoRowOfEntity(r, EMPRESTIMO_CORRECAO_MARCA, contratoId));
  razaoAtual = mergeDominioPlainRazaoComExistente(razaoAtual, correcoesGeradas, EMPRESTIMO_CORRECAO_MARCA, contratoId);

  const lancamentosDetalhe: LoanLancamentoDetalhe[] = todosPlain.map((p) => ({
    data: format(p.date, 'dd/MM/yyyy'),
    contaDebito: p.debContaStr,
    contaCredito: p.credContaStr,
    valor: round2(p.value),
    historico: p.historico ?? '',
  }));

  if (gerados === 0) {
    return { ok: false, pendencias, resumo, lancamentosGerados: 0, lancamentosDetalhe: [] };
  }

  return {
    ok: pendencias.length === 0,
    pendencias,
    resumo,
    novaRazao: razaoAtual,
    lancamentosGerados: gerados,
    lancamentosDetalhe,
  };
}
