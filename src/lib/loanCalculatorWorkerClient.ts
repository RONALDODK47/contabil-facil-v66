import { calculateLoan, type LoanParams, type LoanRow } from './loanCalculator';
import {
  hashLoanParams,
  hydrateLoanRows,
  serializeLoanParams,
  type SerializedLoanRow,
} from './loanParamsCodec';
import type { LoanWorkerMessage, LoanWorkerRequest } from './loanCalculator.worker';

const CACHE_MAX = 16;

let worker: Worker | null = null;
let seq = 0;
const scheduleCache = new Map<string, LoanRow[]>();

function touchCache(key: string, rows: LoanRow[]): LoanRow[] {
  if (scheduleCache.has(key)) scheduleCache.delete(key);
  scheduleCache.set(key, rows);
  while (scheduleCache.size > CACHE_MAX) {
    const oldest = scheduleCache.keys().next().value;
    if (oldest) scheduleCache.delete(oldest);
  }
  return rows;
}

export function getCachedSchedule(cacheKey: string): LoanRow[] | undefined {
  const hit = scheduleCache.get(cacheKey);
  if (!hit) return undefined;
  scheduleCache.delete(cacheKey);
  scheduleCache.set(cacheKey, hit);
  return hit;
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./loanCalculator.worker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

/** Contratos médios/grandes e indexadores: worker dedicado (main thread livre para UI). */
export function shouldUseLoanWorker(params: LoanParams): boolean {
  const totalPeriods = params.months + params.gracePeriod;
  if (totalPeriods > 12) return true;
  if (params.varIndexMode === 'selic_over_diaria') return true;
  if (params.varIndexMode === 'cdi_mensal' && params.monthlyRateMap) return true;
  if ((params.selicDailySeries?.length ?? 0) > 60) return true;
  return false;
}

function calculateLoanSync(params: LoanParams, cacheKey: string): LoanRow[] {
  const cached = getCachedSchedule(cacheKey);
  if (cached) return cached;
  const rows = calculateLoan(params);
  return touchCache(cacheKey, rows);
}

function calculateLoanInWorkerInternal(
  params: LoanParams,
  cacheKey: string,
  signal?: AbortSignal,
): Promise<LoanRow[]> {
  const cached = getCachedSchedule(cacheKey);
  if (cached) return Promise.resolve(cached);

  const id = ++seq;
  const w = getWorker();

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    const handler = (ev: MessageEvent<LoanWorkerMessage>) => {
      if (ev.data.id !== id) return;
      cleanup();
      if (ev.data.type === 'done') {
        resolve(touchCache(cacheKey, hydrateLoanRows(ev.data.schedule as SerializedLoanRow[])));
      } else {
        reject(new Error(ev.data.message));
      }
    };

    const cleanup = () => {
      w.removeEventListener('message', handler);
      signal?.removeEventListener('abort', onAbort);
    };

    w.addEventListener('message', handler);
    signal?.addEventListener('abort', onAbort, { once: true });

    const req: LoanWorkerRequest = {
      id,
      params: serializeLoanParams(params),
    };
    w.postMessage(req);
  });
}

export function calculateLoanAsync(
  params: LoanParams,
  signal?: AbortSignal,
): Promise<LoanRow[]> {
  const cacheKey = hashLoanParams(params);
  if (shouldUseLoanWorker(params)) {
    return calculateLoanInWorkerInternal(params, cacheKey, signal);
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const run = () => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      try {
        resolve(calculateLoanSync(params, cacheKey));
      } catch (e) {
        reject(e);
      }
    };
    if (typeof requestIdleCallback === 'function') {
      const idleId = requestIdleCallback(run, { timeout: 120 });
      signal?.addEventListener(
        'abort',
        () => cancelIdleCallback(idleId),
        { once: true },
      );
    } else {
      setTimeout(run, 0);
    }
  });
}
