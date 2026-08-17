import { calculateLoan } from './loanCalculator';
import {
  deserializeLoanParams,
  dehydrateLoanRows,
  type SerializedLoanParams,
  type SerializedLoanRow,
} from './loanParamsCodec';

export type LoanWorkerRequest = {
  id: number;
  params: SerializedLoanParams;
};

export type LoanWorkerMessage =
  | { id: number; type: 'done'; schedule: SerializedLoanRow[] }
  | { id: number; type: 'error'; message: string };

self.onmessage = (ev: MessageEvent<LoanWorkerRequest>) => {
  const { id, params } = ev.data;
  try {
    const schedule = calculateLoan(deserializeLoanParams(params));
    const done: LoanWorkerMessage = {
      id,
      type: 'done',
      schedule: dehydrateLoanRows(schedule),
    };
    self.postMessage(done);
  } catch (e) {
    const err: LoanWorkerMessage = {
      id,
      type: 'error',
      message: e instanceof Error ? e.message : String(e),
    };
    self.postMessage(err);
  }
};
