import type { LoanParams, LoanRow } from './loanCalculator';
import type { SelicDailyPoint } from './selicOverIndex';

function safeDateToIso(date: Date): string {
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

/** Evita crash ao serializar/hash quando a data do contrato está vazia ou inválida. */
export function loanParamsDatesValid(params: LoanParams): boolean {
  return (
    Number.isFinite(params.contractDate.getTime()) &&
    Number.isFinite(params.firstInstallmentDate.getTime())
  );
}

/** Formato seguro para postMessage (sem Date/Map). */
export type SerializedLoanParams = Omit<
  LoanParams,
  'contractDate' | 'firstInstallmentDate' | 'monthlyRateMap' | 'selicDailySeries'
> & {
  contractDate: string;
  firstInstallmentDate: string;
  monthlyRateMap: [string, number][] | null;
  selicDailySeries?: SelicDailyPoint[];
};

export type SerializedLoanRow = Omit<LoanRow, 'date'> & { date: string };

export function serializeLoanParams(params: LoanParams): SerializedLoanParams {
  const { contractDate, firstInstallmentDate, monthlyRateMap, selicDailySeries, ...rest } = params;
  return {
    ...rest,
    contractDate: safeDateToIso(contractDate),
    firstInstallmentDate: safeDateToIso(firstInstallmentDate),
    monthlyRateMap: monthlyRateMap ? [...monthlyRateMap.entries()] : null,
    selicDailySeries,
  };
}

export function deserializeLoanParams(serialized: SerializedLoanParams): LoanParams {
  const { contractDate, firstInstallmentDate, monthlyRateMap, ...rest } = serialized;
  return {
    ...rest,
    contractDate: new Date(contractDate),
    firstInstallmentDate: new Date(firstInstallmentDate),
    monthlyRateMap: monthlyRateMap ? new Map(monthlyRateMap) : null,
  };
}

export function dehydrateLoanRows(rows: LoanRow[]): SerializedLoanRow[] {
  return rows.map(({ date, ...rest }) => ({ ...rest, date: safeDateToIso(date) }));
}

export function hydrateLoanRows(rows: SerializedLoanRow[]): LoanRow[] {
  return rows.map(({ date, ...rest }) => ({ ...rest, date: new Date(date) }));
}

export function hashLoanParams(params: LoanParams): string {
  return JSON.stringify(serializeLoanParams(params));
}
