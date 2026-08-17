import { useEffect, useMemo, useState } from 'react';
import type { LoanParams, LoanRow } from '../../lib/loanCalculator';
import { calculateLoanAsync, getCachedSchedule } from '../../lib/loanCalculatorWorkerClient';
import { hashLoanParams, loanParamsDatesValid } from '../../lib/loanParamsCodec';
import { useDebouncedValue } from '../lib/useDebouncedValue';

const CALC_DEBOUNCE_MS = 180;

export interface UseAsyncLoanScheduleResult {
  rawSchedule: LoanRow[];
  isCalculating: boolean;
}

/**
 * Motor de cronograma assíncrono com debounce + cache.
 * Limpa dados obsoletos ao trocar contrato ou parâmetros (evita tabela com valores errados).
 */
export function useAsyncLoanSchedule(
  loanParams: LoanParams | null,
  scopeKey = '',
): UseAsyncLoanScheduleResult {
  const debouncedParams = useDebouncedValue(loanParams, CALC_DEBOUNCE_MS);

  const immediateKey = useMemo(() => {
    if (!loanParams || loanParams.principal <= 0 || !loanParamsDatesValid(loanParams)) return '';
    return hashLoanParams(loanParams);
  }, [loanParams]);

  const debouncedKey = useMemo(() => {
    if (!debouncedParams || debouncedParams.principal <= 0 || !loanParamsDatesValid(debouncedParams)) {
      return '';
    }
    return hashLoanParams(debouncedParams);
  }, [debouncedParams]);

  const [rawSchedule, setRawSchedule] = useState<LoanRow[]>([]);
  const [workerBusy, setWorkerBusy] = useState(false);

  useEffect(() => {
    setRawSchedule([]);
    setWorkerBusy(false);
  }, [scopeKey]);

  /** Cache imediato (sem debounce) — evita esperar 180 ms quando o valor já foi calculado antes. */
  useEffect(() => {
    if (!immediateKey) return;
    const cached = getCachedSchedule(immediateKey);
    if (cached) {
      setRawSchedule(cached);
      setWorkerBusy(false);
    }
  }, [immediateKey]);

  useEffect(() => {
    if (!debouncedKey || !debouncedParams) {
      setRawSchedule([]);
      setWorkerBusy(false);
      return;
    }

    const cached = getCachedSchedule(debouncedKey);
    if (cached) {
      setRawSchedule(cached);
      setWorkerBusy(false);
      return;
    }

    /** Mantém o cronograma anterior visível até o worker devolver (sem piscar / perder scroll). */
    const abort = new AbortController();
    setWorkerBusy(true);

    calculateLoanAsync(debouncedParams, abort.signal)
      .then((rows) => {
        if (abort.signal.aborted) return;
        setRawSchedule(rows);
      })
      .catch((e) => {
        if (abort.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
        console.error('[loan] erro ao calcular cronograma:', e);
        setRawSchedule([]);
      })
      .finally(() => {
        if (!abort.signal.aborted) setWorkerBusy(false);
      });

    return () => abort.abort();
  }, [debouncedKey, debouncedParams]);

  const isCalculating =
    workerBusy || (immediateKey !== debouncedKey && (loanParams?.principal ?? 0) > 0);

  return { rawSchedule, isCalculating };
}
