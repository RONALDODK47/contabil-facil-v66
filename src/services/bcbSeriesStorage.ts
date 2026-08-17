import type { SelicDailyPoint } from '../lib/selicOverIndex';

const STORAGE_SERIE11 = 'contabilfacil_bcb_serie11_v1';
const STORAGE_MONTHLY = 'contabilfacil_bcb_monthly_v1';

export type BcbDataSource = 'bcb' | 'cache';

export interface BcbFetchMeta {
  source: BcbDataSource;
  updatedAt: string | null;
}

interface Serie11Store {
  updatedAt: string;
  points: SelicDailyPoint[];
}

interface MonthlyPoint {
  month: string;
  ratePct: number;
  date: string;
}

interface MonthlyStore {
  updatedAt: string;
  bySerie: Record<string, MonthlyPoint[]>;
}

let embeddedSerie11UpdatedAt: string | null = null;
let embeddedMonthlyUpdatedAt: string | null = null;
/** Pontos do pacote em public/data — disponível antes do localStorage hidratar. */
let bundledSerie11PointCount = 0;

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function readJson<T>(key: string): T | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof localStorage === 'undefined') return;
  try {
    // ⚠️ DISABLED: Salva SOMENTE no Docker, não em localStorage
    // localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`[BCB cache] não foi possível gravar ${key}:`, e);
  }
}

function mergeDailyPoints(
  existing: SelicDailyPoint[],
  incoming: SelicDailyPoint[],
): SelicDailyPoint[] {
  const map = new Map<string, SelicDailyPoint>();
  for (const p of existing) {
    if (p.date) map.set(p.date, p);
  }
  for (const p of incoming) {
    if (p.date && Number.isFinite(p.annualRatePct)) map.set(p.date, p);
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/** Catálogo completo: cache do navegador (alimentado por fetch em public/data). */
export function getAllSerie11Catalog(): SelicDailyPoint[] {
  return loadAllSerie11FromStorage();
}

export function getEmbeddedSerie11Count(): number {
  const stored = loadAllSerie11FromStorage().length;
  if (stored > 0) return stored;
  return bundledSerie11PointCount;
}

export function loadAllSerie11FromStorage(): SelicDailyPoint[] {
  const store = readJson<Serie11Store>(STORAGE_SERIE11);
  return store?.points ?? [];
}

export function saveSerie11ToStorage(points: SelicDailyPoint[]): void {
  if (points.length === 0) return;
  const prev = loadAllSerie11FromStorage();
  writeJson(STORAGE_SERIE11, {
    updatedAt: new Date().toISOString(),
    points: mergeDailyPoints(prev, points),
  } satisfies Serie11Store);
}

export function filterSerie11ForRange(
  points: SelicDailyPoint[],
  dataInicial: Date,
  dataFinal: Date,
): SelicDailyPoint[] {
  const start = toIsoDate(dataInicial);
  const end = toIsoDate(dataFinal);
  return points.filter((p) => p.date >= start && p.date <= end);
}

/**
 * Há sobreposição com o período do contrato (carry-forward cobre dias sem cotação nova).
 */
export function serie11CoversRange(
  points: SelicDailyPoint[],
  dataInicial: Date,
  dataFinal: Date,
): boolean {
  if (points.length === 0) return false;
  const startIso = toIsoDate(dataInicial);
  const endIso = toIsoDate(dataFinal);
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0]!.date;
  const last = sorted[sorted.length - 1]!.date;
  return last >= startIso && first <= endIso;
}

export function getSerie11CacheMeta(): BcbFetchMeta {
  const store = readJson<Serie11Store>(STORAGE_SERIE11);
  return {
    source: 'cache',
    updatedAt: store?.updatedAt ?? embeddedSerie11UpdatedAt,
  };
}

export function getSerie11BundleMeta(): BcbFetchMeta {
  return { source: 'cache', updatedAt: embeddedSerie11UpdatedAt };
}

/**
 * Pontos para o motor: até a data final do contrato (carry-forward no início da carência).
 */
export function loadSerie11FromStorageForRange(
  dataInicial: Date,
  dataFinal: Date,
): SelicDailyPoint[] | null {
  const all = getAllSerie11Catalog();
  if (!serie11CoversRange(all, dataInicial, dataFinal)) return null;
  const endIso = toIsoDate(dataFinal);
  const pts = all.filter((p) => p.date <= endIso);
  return pts.length > 0 ? pts : null;
}

function mergeMonthly(
  existing: MonthlyPoint[],
  incoming: MonthlyPoint[],
): MonthlyPoint[] {
  const map = new Map<string, MonthlyPoint>();
  for (const p of existing) map.set(p.month, p);
  for (const p of incoming) map.set(p.month, p);
  return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
}

function getAllMonthlyForSerie(serieCode: number): MonthlyPoint[] {
  const key = String(serieCode);
  return readJson<MonthlyStore>(STORAGE_MONTHLY)?.bySerie[key] ?? [];
}

export function saveMonthlySerieToStorage(
  serieCode: number,
  rows: MonthlyPoint[],
): void {
  if (rows.length === 0) return;
  const prev = readJson<MonthlyStore>(STORAGE_MONTHLY);
  const key = String(serieCode);
  const bySerie = { ...(prev?.bySerie ?? {}) };
  bySerie[key] = mergeMonthly(bySerie[key] ?? [], rows);
  writeJson(STORAGE_MONTHLY, {
    updatedAt: new Date().toISOString(),
    bySerie,
  } satisfies MonthlyStore);
}

export function loadMonthlySerieFromStorageForRange(
  serieCode: number,
  dataInicial: Date,
  dataFinal: Date,
): MonthlyPoint[] | null {
  const rows = getAllMonthlyForSerie(serieCode);
  if (rows.length === 0) return null;
  const startMonth = toIsoDate(dataInicial).slice(0, 7);
  const endMonth = toIsoDate(dataFinal).slice(0, 7);
  const filtered = rows.filter((r) => r.month >= startMonth && r.month <= endMonth);
  if (filtered.length === 0) return null;
  const minMonth = rows[0]!.month;
  const maxMonth = rows[rows.length - 1]!.month;
  if (maxMonth < startMonth || minMonth > endMonth) return null;
  return filtered;
}

export function getMonthlyCacheMeta(): BcbFetchMeta {
  const store = readJson<MonthlyStore>(STORAGE_MONTHLY);
  return {
    source: 'cache',
    updatedAt: store?.updatedAt ?? embeddedMonthlyUpdatedAt ?? null,
  };
}

let bundleHydratePromise: Promise<void> | null = null;

/** Carrega séries BCB de public/data para localStorage (fora do bundle JS). */
export async function hydrateBcbSeriesFromBundledAssets(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (bundleHydratePromise) return bundleHydratePromise;

  bundleHydratePromise = (async () => {
    try {
      const base = import.meta.env.BASE_URL ?? '/';
      const [res11, resMo] = await Promise.all([
        fetch(`${base}data/bcb-serie11-bundle.json`, { cache: 'default' }),
        fetch(`${base}data/bcb-monthly-bundle.json`, { cache: 'default' }),
      ]);

      if (res11.ok) {
        const body = (await res11.json()) as Serie11Store;
        if (body.points?.length) {
          bundledSerie11PointCount = body.points.length;
          saveSerie11ToStorage(body.points);
          if (typeof body.updatedAt === 'string') embeddedSerie11UpdatedAt = body.updatedAt;
        }
      }

      if (resMo.ok) {
        const body = (await resMo.json()) as MonthlyStore;
        if (body.bySerie) {
          for (const [code, rows] of Object.entries(body.bySerie)) {
            if (rows?.length) saveMonthlySerieToStorage(Number(code), rows);
          }
          if (typeof body.updatedAt === 'string') embeddedMonthlyUpdatedAt = body.updatedAt;
        }
      }
    } catch {
      /* cache do localStorage de visitas anteriores basta */
    }
  })();

  return bundleHydratePromise;
}
