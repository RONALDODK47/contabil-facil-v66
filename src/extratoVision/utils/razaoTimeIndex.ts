import type { VisionBalanceteRow } from '../types/accounting';
import { parseBrDateToTime } from './dateBounds';

/** Índice ordenado por data — evita varrer todo o razão a cada mês do comparativo. */
export type RazaoTimeIndex = {
  rows: VisionBalanceteRow[];
  times: number[];
};

const INDEX_MIN_ROWS = 600;

export function shouldIndexRazao(count: number): boolean {
  return count >= INDEX_MIN_ROWS;
}

export function buildRazaoTimeIndex(linhas: VisionBalanceteRow[]): RazaoTimeIndex {
  const entries: { t: number; row: VisionBalanceteRow }[] = [];
  for (const r of linhas) {
    if (!r.data?.trim()) continue;
    const t = parseBrDateToTime(r.data);
    if (t === null) continue;
    entries.push({ t, row: r });
  }
  entries.sort((a, b) => a.t - b.t);
  return {
    rows: entries.map((e) => e.row),
    times: entries.map((e) => e.t),
  };
}

function lowerBound(times: number[], target: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(times: number[], target: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function sliceRazaoIndexByPeriod(
  index: RazaoTimeIndex,
  de?: string,
  ate?: string,
): VisionBalanceteRow[] {
  const { rows, times } = index;
  if (!rows.length) return [];

  const fromStr = de?.trim() ?? '';
  const toStr = ate?.trim() ?? '';
  if (!fromStr && !toStr) return rows;

  let fTime = times[0];
  let tTime = times[times.length - 1];

  if (fromStr) {
    const t = parseBrDateToTime(fromStr);
    if (t !== null) fTime = t;
  }
  if (toStr) {
    const t = parseBrDateToTime(toStr);
    if (t !== null) tTime = t;
  }
  if (fTime > tTime) [fTime, tTime] = [tTime, fTime];

  const start = lowerBound(times, fTime);
  const end = upperBound(times, tTime);
  return rows.slice(start, end);
}

export function sliceRazaoIndexBefore(
  index: RazaoTimeIndex,
  dataInicio?: string,
): VisionBalanceteRow[] {
  const de = dataInicio?.trim() ?? '';
  if (!de || !index.rows.length) return [];
  const deTime = parseBrDateToTime(de);
  if (deTime === null) return [];
  return index.rows.slice(0, lowerBound(index.times, deTime));
}
