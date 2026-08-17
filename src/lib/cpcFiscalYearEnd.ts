import type { LoanRow } from './loanCalculator';

/**
 * Valor líquido de uma linha para fins de provisão CPC (curto/longo prazo).
 * Usa a Parcela Líquida fixa do contrato (valor financiado ÷ nº de parcelas,
 * ex.: 839,33), igual em todos os meses — não a amortização real (que varia
 * mês a mês no SAC). Linhas não pagas usam o mesmo valor de referência, para
 * evitar que a inadimplência retroativamente altere os saldos de curto/longo
 * de todos os meses anteriores via recálculo do provisão de dezembro.
 *
 * NÃO trocar pela amortização real: a base da provisão de curto/longo prazo é
 * deliberadamente esta referência fixa. A coluna "Parcela Líq." exibida no
 * cronograma/PDF é outra coisa — lá vale a amortização real (Parcela − Juros).
 */
function netForRow(row: LoanRow): number {
  if (row.fixedInstallmentReference && row.fixedInstallmentReference > 0) {
    return row.fixedInstallmentReference;
  }
  if (row.isUnpaid) {
    return row.expectedAmortization ?? 0;
  }
  return row.amortization > 0 ? row.amortization : Math.max(0, row.installment - row.interest - row.monthlyCost);
}

/**
 * Parcela bruta de uma linha não paga: amortização + juros + custo + variação monetária.
 * Usada exclusivamente para adicionar ao curto prazo da própria linha inadimplente.
 */
export function parcelaBrutaLinhaNaoPaga(row: LoanRow): number {
  const base = (row.unpaidAmount ?? 0) > 0
    ? row.unpaidAmount!
    : (row.expectedAmortization ?? 0) + (row.interest ?? 0) + (row.monthlyCost ?? 0);
  // Inclui variação monetária (interestAdjustment) na parcela bruta
  return base + (row.interestAdjustment ?? 0);
}

/**
 * Soma das parcelas brutas (não pagas) ou amortizações líquidas (pagas) que vencem no ano civil (até 12).
 * Quando a parcela não foi paga, o valor inteiro (amortização + juros + custo) compõe o curto prazo,
 * pois a dívida permanece em aberto.
 */
export function somaParcelasLiquidasNoAnoCivil(
  schedule: LoanRow[],
  year: number,
  maxCount = 12,
): number {
  let sum = 0;
  let n = 0;
  for (const row of schedule) {
    if (row.month === 0 || !row.date) continue;
    if (row.date.getUTCFullYear() !== year) continue;
    sum += Math.max(0, netForRow(row));
    n++;
    if (n >= maxCount) break;
  }
  return sum;
}

export function temParcelasNoAnoCivil(schedule: LoanRow[], year: number): boolean {
  return schedule.some((r) => r.month > 0 && r.date && r.date.getUTCFullYear() === year);
}

export function somaParcelasRestantesNoAnoCivilApos(
  schedule: LoanRow[],
  afterIndex: number,
  year: number,
): number {
  let sum = 0;
  for (let k = afterIndex + 1; k < schedule.length; k++) {
    const row = schedule[k];
    if (row.month === 0 || !row.date) continue;
    if (row.date.getUTCFullYear() !== year) break;
    sum += Math.max(0, netForRow(row));
  }

  return Math.max(0, sum);
}

/** Soma das parcelas brutas (não pagas) ou amortizações (pagas) das próximas parcelas (até 12). */
export function somaProximasParcelasLiquidas(
  schedule: LoanRow[],
  afterIndex: number,
  maxCount = 12,
): number {
  let sum = 0;
  let n = 0;
  for (let k = afterIndex + 1; k < schedule.length && n < maxCount; k++) {
    const row = schedule[k];
    if (row.month === 0 || !row.date) continue;
    sum += Math.max(0, netForRow(row));
    n++;
  }
  return sum;
}

/**
 * Retorna o maior número de mês de carência encontrado no cronograma.
 */
export function obterMaxMesCarencia(schedule: LoanRow[]): number {
  let maxGrace = 0;
  for (const r of schedule) {
    if (r.isGrace && r.month > maxGrace) {
      maxGrace = r.month;
    }
  }
  return maxGrace;
}

/**
 * Último mês da carência: curto = parcelas líquidas (até 12) do mesmo ano civil.
 * Longo congelado na amortização até o próximo 31/12.
 */
export function calcCurtoProvisionadoUltimaCarencia(
  schedule: LoanRow[],
  graceRowIndex: number,
  finalBalanceAtProvision: number,
): { curto: number; longo: number } {
  const graceRow = schedule[graceRowIndex];
  if (!graceRow || !graceRow.date) {
    return { curto: 0, longo: finalBalanceAtProvision };
  }

  const graceYear = graceRow.date.getUTCFullYear();
  const targetYear = graceRow.date.getUTCMonth() === 11 ? graceYear + 1 : graceYear;

  let curto = somaParcelasRestantesNoAnoCivilApos(schedule, graceRowIndex, targetYear);
  curto = Math.max(0, curto);
  const longo = Math.max(0, finalBalanceAtProvision - curto);
  return { curto, longo };
}

/** @deprecated use calcCurtoProvisionadoUltimaCarencia */
export const calcCurtoProvisionadoPenultimaCarencia = calcCurtoProvisionadoUltimaCarencia;

/**
 * Provisão do fechamento 31/12/Y: curto = parcelas do ano Y+1 (até 12) ou restante se encerrar.
 * Longo = saldo devedor na data − curto (congelado durante todo o ano Y+1).
 */
export function calcCurtoProvisionadoDezembro(
  schedule: LoanRow[],
  year: number,
  finalBalanceAtClose: number,
): { curto: number; longo: number } {
  const decIdx = indiceLinhaDezembroNoAno(schedule, year);
  const refIdx = decIdx >= 0 ? decIdx : indiceUltimaLinhaOperacionalNoAno(schedule, year);

  if (refIdx >= 0) {
    const refRow = schedule[refIdx];
    const maxGrace = obterMaxMesCarencia(schedule);
    if (refRow.isGrace && refRow.month < maxGrace) {
      return { curto: 0, longo: finalBalanceAtClose };
    }
  }

  const nextYear = year + 1;
  let count = 0;
  let sumNextYear = 0;
  let firstInstallmentNextYear = 0;

  for (let k = refIdx >= 0 ? refIdx + 1 : 0; k < schedule.length; k++) {
    const row = schedule[k];
    if (row.month === 0 || !row.date) continue;
    if (row.date.getUTCFullYear() > nextYear) break;
    if (row.date.getUTCFullYear() === nextYear) {
      count++;
      const net = netForRow(row);
      sumNextYear += Math.max(0, net);
      if (firstInstallmentNextYear <= 0 && net > 0) {
        firstInstallmentNextYear = net;
      }
    }
  }

  if (firstInstallmentNextYear <= 0 && refIdx >= 0 && schedule[refIdx]) {
    firstInstallmentNextYear = netForRow(schedule[refIdx]);
    sumNextYear = Math.max(0, firstInstallmentNextYear);
  }

  const curto = count > 0 ? sumNextYear : Math.max(0, firstInstallmentNextYear);
  const longo = Math.max(0, finalBalanceAtClose - curto);
  return { curto, longo };
}

/** Longo prazo congelado no início de cada ano civil (definido no 31/12 do ano anterior). */
export function buildLongoInicioAnoCivil(schedule: LoanRow[]): Map<number, number> {
  const map = new Map<number, number>();
  const years = anosOperacionaisNoCronograma(schedule);

  for (const year of years) {
    const decIdx = indiceLinhaDezembroNoAno(schedule, year);
    const closeIdx = decIdx >= 0 ? decIdx : indiceUltimaLinhaOperacionalNoAno(schedule, year);
    if (closeIdx < 0) continue;

    const finalBal = Math.max(0, schedule[closeIdx]!.finalBalance);
    const { longo } = calcCurtoProvisionadoDezembro(schedule, year, finalBal);
    // Se o longo congelado é um resíduo ínfimo de arredondamento (< 1 centavo completo),
    // trata como zero para evitar que 0,02 apareça perpetuamente na coluna Longo.
    map.set(year + 1, longo < 0.05 ? 0 : longo);
  }

  return map;
}

export function indiceLinhaDezembroNoAno(schedule: LoanRow[], year: number): number {
  let bestIdx = -1;
  let bestDay = -1;
  schedule.forEach((row, idx) => {
    if (row.month <= 0 || !row.date) return;
    if (row.date.getUTCFullYear() !== year || row.date.getUTCMonth() !== 11) return;
    const day = row.date.getDate();
    if (day > bestDay) {
      bestDay = day;
      bestIdx = idx;
    }
  });
  return bestIdx;
}

export function indiceUltimaLinhaOperacionalNoAno(schedule: LoanRow[], year: number): number {
  let lastIdx = -1;
  schedule.forEach((row, idx) => {
    if (row.month > 0 && row.date && row.date.getUTCFullYear() === year) lastIdx = idx;
  });
  return lastIdx;
}

export function linhaOperacionalAnterior(schedule: LoanRow[], index: number): LoanRow | null {
  for (let j = index - 1; j >= 0; j--) {
    const r = schedule[j];
    if (r.month > 0 && r.date) return r;
  }
  return null;
}

export function indiceLinhaOperacionalAnterior(schedule: LoanRow[], index: number): number {
  for (let j = index - 1; j >= 0; j--) {
    const r = schedule[j];
    if (r.month > 0 && r.date) return j;
  }
  return -1;
}

/** Curto prazo na última linha operacional antes do fechamento 31/12/Y (longo congelado). */
export function calcCurtoOperacionalAntesFechamento31Dez(
  schedule: LoanRow[],
  year: number,
): number {
  const decIdx = indiceLinhaDezembroNoAno(schedule, year);
  let refIdx: number;

  if (decIdx >= 0) {
    refIdx = indiceLinhaOperacionalAnterior(schedule, decIdx);
  } else {
    refIdx = indiceUltimaLinhaOperacionalNoAno(schedule, year);
    if (refIdx >= 0 && schedule[refIdx]!.date!.getUTCMonth() === 11) {
      const prevIdx = indiceLinhaOperacionalAnterior(schedule, refIdx);
      if (prevIdx >= 0) refIdx = prevIdx;
    }
  }

  if (refIdx < 0) return 0;
  return schedule[refIdx]!.shortTermBalance;
}

function curtoProvisionadoAntesFechamentoAno(
  schedule: LoanRow[],
  year: number,
  curtoFromRow: (row: LoanRow) => number,
): number {
  const decIdx = indiceLinhaDezembroNoAno(schedule, year);
  if (decIdx >= 0) {
    const prev = linhaOperacionalAnterior(schedule, decIdx);
    if (prev) return curtoFromRow(prev);
  }

  const lastIdx = indiceUltimaLinhaOperacionalNoAno(schedule, year);
  if (lastIdx < 0) return 0;

  const lastRow = schedule[lastIdx]!;
  if (lastRow.date && lastRow.date.getUTCMonth() !== 11) {
    const prev = linhaOperacionalAnterior(schedule, lastIdx);
    if (prev) return curtoFromRow(prev);
    return curtoFromRow(lastRow);
  }

  const prev = linhaOperacionalAnterior(schedule, lastIdx);
  return prev ? curtoFromRow(prev) : 0;
}

/**
 * Curto provisionado em 31/12/Y (coluna Curto do PDF):
 * parcelas líquidas do **ano civil seguinte** (Y+1), até 12.
 * Exceção: se o empréstimo encerra em Y (sem parcelas em Y+1), provisiona só o que resta no ano.
 */
export function calcCurtoAlvo31DezAno(
  schedule: LoanRow[],
  year: number,
  curtoFromRow: (row: LoanRow) => number,
): number {
  const decIdx = indiceLinhaDezembroNoAno(schedule, year);
  if (decIdx >= 0) {
    const refRow = schedule[decIdx];
    const maxGrace = obterMaxMesCarencia(schedule);
    if (refRow.isGrace && refRow.month < maxGrace) {
      return 0;
    }
    const daLinha = curtoFromRow(schedule[decIdx]!);
    if (daLinha > 0) return daLinha;
    const finalBal = Math.max(0, schedule[decIdx]!.finalBalance);
    return calcCurtoProvisionadoDezembro(schedule, year, finalBal).curto;
  }

  const lastIdx = indiceUltimaLinhaOperacionalNoAno(schedule, year);
  if (lastIdx < 0) return 0;
  const refRow = schedule[lastIdx];
  const maxGrace = obterMaxMesCarencia(schedule);
  if (refRow.isGrace && refRow.month < maxGrace) {
    return 0;
  }
  const finalBal = Math.max(0, schedule[lastIdx]!.finalBalance);
  return calcCurtoProvisionadoDezembro(schedule, year, finalBal).curto;
}

/**
 * Transferência LP→CP — **uma vez por ano**, em 31/12/Y.
 * Valor = incremento do curto provisionado para o ano seguinte (cpNew − cpOld).
 */
export function calcTransferencia31DezAno(
  schedule: LoanRow[],
  year: number,
  curtoFromRow: (row: LoanRow) => number,
): number {
  const decIdx = indiceLinhaDezembroNoAno(schedule, year);
  const closeIdx = decIdx >= 0 ? decIdx : indiceUltimaLinhaOperacionalNoAno(schedule, year);
  if (closeIdx < 0) return 0;

  const refRow = schedule[closeIdx];
  const maxGrace = obterMaxMesCarencia(schedule);
  if (refRow.isGrace && refRow.month < maxGrace) {
    return 0;
  }

  const finalBal = Math.max(0, schedule[closeIdx]!.finalBalance);
  const cpNew = calcCurtoProvisionadoDezembro(schedule, year, finalBal).curto;
  const cpOld = calcCurtoOperacionalAntesFechamento31Dez(schedule, year);

  let valor = Math.max(0, cpNew - cpOld);

  if (valor <= 0 && !temParcelasNoAnoCivil(schedule, year + 1) && cpOld > 0) {
    valor = cpOld;
  }

  // Mantém compatibilidade quando o cronograma já traz curto preenchido (ex.: testes manuais).
  if (valor <= 0) {
    const legado = Math.max(0, calcCurtoAlvo31DezAno(schedule, year, curtoFromRow) -
      curtoProvisionadoAntesFechamentoAno(schedule, year, curtoFromRow));
    if (legado > 0) valor = legado;
    else if (
      !temParcelasNoAnoCivil(schedule, year + 1) &&
      curtoProvisionadoAntesFechamentoAno(schedule, year, curtoFromRow) > 0
    ) {
      valor = curtoProvisionadoAntesFechamentoAno(schedule, year, curtoFromRow);
    }
  }

  return valor;
}

/** Anos civis com linhas operacionais no cronograma. */
export function anosOperacionaisNoCronograma(schedule: LoanRow[]): number[] {
  const years = new Set<number>();
  schedule.forEach((r) => {
    if (r.month > 0 && r.date) years.add(r.date.getUTCFullYear());
  });
  return [...years].sort((a, b) => a - b);
}
