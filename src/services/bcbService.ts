import type { SelicDailyPoint } from '../lib/selicOverIndex';
import { getNativeFetch } from '../lib/nativeFetch';
import {
  getSerie11BundleMeta,
  getSerie11CacheMeta,
  getMonthlyCacheMeta,
  loadMonthlySerieFromStorageForRange,
  loadSerie11FromStorageForRange,
  saveMonthlySerieToStorage,
  saveSerie11ToStorage,
  type BcbDataSource,
  type BcbFetchMeta,
} from './bcbSeriesStorage';

export type { BcbDataSource, BcbFetchMeta };

export interface EconomicIndicators {
  selicMensal: number;
  cdiMensal: number;
  selicAnual: number;
  /** Algum índice veio de fallback (fonte alternativa ou valor padrão). */
  error?: boolean;
  /** Origem dos dados (informativo): bcb, brasilapi, fallback ou misto. */
  source?: 'bcb' | 'brasilapi' | 'fallback' | 'mixed';
}

const FALLBACK_INDICATORS: EconomicIndicators = {
  selicAnual: 10.5,
  selicMensal: 0.83,
  cdiMensal: 0.82,
  error: true,
  source: 'fallback',
};

const CACHE_TTL_OK_MS = 5 * 60 * 1000;
const CACHE_TTL_PARTIAL_MS = 90 * 1000;
const CACHE_TTL_FALLBACK_MS = 45 * 1000;
let cachedIndicators: EconomicIndicators | null = null;
let cacheUntilMs = 0;
let inflightIndicatorsPromise: Promise<EconomicIndicators> | null = null;
let warnedBcbOnce = false;

/** URLs para séries históricas: proxy Vite/deploy primeiro no browser; API direta como reserva. */
export function getBcbBaseUrls(): string[] {
  if (typeof window === 'undefined') return ['https://api.bcb.gov.br'];
  return ['/api/bcb', 'https://api.bcb.gov.br'];
}

/** Ping no browser: só proxy local (evita bloqueio de rede e ruído no Debug). */
export function getBcbPingBaseUrls(): string[] {
  if (typeof window === 'undefined') return ['https://api.bcb.gov.br'];
  return ['/api/bcb'];
}

const BCB_PING_PATH = '/dados/serie/bcdata.sgs.11/dados/ultimos/1?formato=json';

function isBcbPingPayloadOk(body: unknown): boolean {
  if (!Array.isArray(body) || body.length === 0) return false;
  const row = body[0] as { data?: unknown; valor?: unknown };
  return row?.data != null && row?.valor != null && !Number.isNaN(Number(row.valor));
}

/** Verifica API SGS do BCB (proxy Vite em dev; embutido offline cobre PRONAMPE). */
export async function pingBcbApi(): Promise<boolean> {
  const fetchFn = getNativeFetch();
  const bases =
    typeof window === 'undefined'
      ? getBcbPingBaseUrls()
      : [...getBcbPingBaseUrls(), 'https://api.bcb.gov.br'];
  for (const base of bases) {
    try {
      const res = await fetchFn(`${base}${BCB_PING_PATH}`, { method: 'GET', cache: 'no-store' });
      if (!res.ok) continue;
      const body: unknown = await res.json().catch(() => null);
      if (isBcbPingPayloadOk(body)) return true;
    } catch {
      /* offline ou proxy indisponível */
    }
  }
  return false;
}

let lastSelicOverFetchMeta: BcbFetchMeta = { source: 'bcb', updatedAt: null };
let lastMonthlyFetchMeta: BcbFetchMeta = { source: 'bcb', updatedAt: null };

export function getLastSelicOverFetchMeta(): BcbFetchMeta {
  return lastSelicOverFetchMeta;
}

export function getLastMonthlyFetchMeta(): BcbFetchMeta {
  return lastMonthlyFetchMeta;
}

/** Indicadores vieram só da API SGS do BCB (sem BrasilAPI nem valores fixos). */
export function isOfficialBcbIndicators(indicators: EconomicIndicators | null | undefined): boolean {
  return indicators != null && indicators.source === 'bcb' && indicators.error !== true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function anualParaMensal(taxaAnualPct: number): number {
  if (!Number.isFinite(taxaAnualPct)) return Number.NaN;
  return (Math.pow(1 + taxaAnualPct / 100, 1 / 12) - 1) * 100;
}

function formatBcbDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function bcbRowDateToIso(dataStr: string): string | null {
  const parts = String(dataStr).trim().split('/');
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts;
  const y = yyyy.length === 2 ? `20${yyyy}` : yyyy;
  return `${y}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

/** 11 = Selic Over (% a.a., base 252) — taxa diária de mercado (não usar 432 Meta para contrato). */
async function fetchBcbJson(path: string, maxAttempts = 2): Promise<unknown> {
  const bases = getBcbBaseUrls();
  let lastErr: unknown;

  for (const base of bases) {
    const url = `${base}${path}`;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        const bodyText = await res.text();
        const retryable =
          !res.ok &&
          (res.status === 503 ||
            res.status === 502 ||
            res.status === 429 ||
            res.status === 408 ||
            res.status === 404);

        if (!res.ok && retryable && attempt + 1 < maxAttempts) {
          await sleep(400 * (attempt + 1));
          continue;
        }
        if (!res.ok) {
          lastErr = new Error(`BCB HTTP ${res.status} (${base})`);
          break;
        }

        return JSON.parse(bodyText) as unknown;
      } catch (e) {
        lastErr = e;
        if (attempt + 1 < maxAttempts) await sleep(300 * (attempt + 1));
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function fetchSerieHistorico(
  serieCode: number,
  dataInicial: Date,
  dataFinal: Date,
): Promise<Array<{ data: string; valor: number }>> {
  const di = formatBcbDate(dataInicial);
  const df = formatBcbDate(dataFinal);
  const path = `/dados/serie/bcdata.sgs.${serieCode}/dados?formato=json&dataInicial=${encodeURIComponent(di)}&dataFinal=${encodeURIComponent(df)}`;

  const data = await fetchBcbJson(path);
  if (!Array.isArray(data)) throw new Error('BCB histórico inválido');

  const rows: Array<{ data: string; valor: number }> = [];
  for (const row of data) {
    const r = row as Record<string, unknown>;
    const rawVal = r?.valor;
    const n =
      typeof rawVal === 'number'
        ? rawVal
        : parseFloat(String(rawVal ?? '').replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(n)) continue;
    rows.push({ data: String(r?.data ?? ''), valor: n });
  }
  return rows;
}

let selicOverCache: { key: string; points: SelicDailyPoint[]; until: number } | null = null;

/** Série 11 — Selic Over diária para acumulação entre vencimentos (auditoria / contratos pós-fixados). */
export async function fetchSelicOverDailySeries(
  dataInicial: Date,
  dataFinal: Date
): Promise<SelicDailyPoint[]> {
  const key = `${formatBcbDate(dataInicial)}|${formatBcbDate(dataFinal)}`;
  const now = Date.now();
  if (selicOverCache && selicOverCache.key === key && now < selicOverCache.until) {
    return selicOverCache.points;
  }

  const offlineFirst = loadSerie11FromStorageForRange(dataInicial, dataFinal);
  if (offlineFirst?.length) {
    lastSelicOverFetchMeta = getSerie11BundleMeta();
    selicOverCache = { key, points: offlineFirst, until: now + CACHE_TTL_OK_MS };
    void fetchSerieHistorico(11, dataInicial, dataFinal)
      .then((rows) => {
        const points: SelicDailyPoint[] = [];
        for (const row of rows) {
          const iso = bcbRowDateToIso(row.data);
          if (!iso) continue;
          points.push({ date: iso, annualRatePct: row.valor });
        }
        if (points.length > 0) {
          saveSerie11ToStorage(points);
          lastSelicOverFetchMeta = { source: 'bcb', updatedAt: new Date().toISOString() };
          selicOverCache = { key, points: offlineFirst, until: Date.now() + CACHE_TTL_OK_MS };
        }
      })
      .catch(() => {});
    return offlineFirst;
  }

  try {
    const rows = await fetchSerieHistorico(11, dataInicial, dataFinal);
    const points: SelicDailyPoint[] = [];
    for (const row of rows) {
      const iso = bcbRowDateToIso(row.data);
      if (!iso) continue;
      points.push({ date: iso, annualRatePct: row.valor });
    }
    points.sort((a, b) => a.date.localeCompare(b.date));
    saveSerie11ToStorage(points);
    lastSelicOverFetchMeta = { source: 'bcb', updatedAt: new Date().toISOString() };
    selicOverCache = { key, points, until: now + CACHE_TTL_OK_MS };
    return points;
  } catch (liveErr) {
    const cached = loadSerie11FromStorageForRange(dataInicial, dataFinal);
    if (cached && cached.length > 0) {
      lastSelicOverFetchMeta = getSerie11CacheMeta();
      selicOverCache = { key, points: cached, until: now + CACHE_TTL_OK_MS };
      console.warn('[BCB] Série 11 indisponível online; usando cache local.', liveErr);
      return cached;
    }
    throw liveErr;
  }
}

function monthKeyFromIso(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export async function fetchMonthlyIndexSeries(
  serieCode: number,
  dataInicial: Date,
  dataFinal: Date
): Promise<Array<{ month: string; ratePct: number; date: string }>> {
  try {
    const rows = await fetchSerieHistorico(serieCode, dataInicial, dataFinal);
    const points: Array<{ month: string; ratePct: number; date: string }> = [];
    for (const row of rows) {
      const iso = bcbRowDateToIso(row.data);
      if (!iso) continue;
      const month = monthKeyFromIso(iso);
      if (!month) continue;
      points.push({ month, ratePct: row.valor, date: iso });
    }
    points.sort((a, b) => a.month.localeCompare(b.month));
    saveMonthlySerieToStorage(serieCode, points);
    lastMonthlyFetchMeta = { source: 'bcb', updatedAt: new Date().toISOString() };
    return points;
  } catch (liveErr) {
    const cached = loadMonthlySerieFromStorageForRange(serieCode, dataInicial, dataFinal);
    if (cached && cached.length > 0) {
      lastMonthlyFetchMeta = getMonthlyCacheMeta();
      console.warn(`[BCB] Série ${serieCode} indisponível online; usando cache local.`, liveErr);
      return cached;
    }
    throw liveErr;
  }
}

export async function fetchSelicMonthlySeries(
  dataInicial: Date,
  dataFinal: Date
): Promise<Array<{ month: string; ratePct: number; date: string }>> {
  return fetchMonthlyIndexSeries(4390, dataInicial, dataFinal);
}

export async function fetchCdiMonthlySeries(
  dataInicial: Date,
  dataFinal: Date
): Promise<Array<{ month: string; ratePct: number; date: string }>> {
  return fetchMonthlyIndexSeries(4391, dataInicial, dataFinal);
}

/** 432 = Selic Meta (Anual), 4390 = Selic (% a.m.), 4391 = CDI (% a.m.) */
async function fetchSerieUltimoValor(serieCode: number): Promise<number> {
  const path = `/dados/serie/bcdata.sgs.${serieCode}/dados/ultimos/1?formato=json`;
  const data = await fetchBcbJson(path);
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('BCB lista vazia');
  }
  const row = data[0] as Record<string, unknown>;
  const rawVal = row?.valor;
  const n =
    typeof rawVal === 'number'
      ? rawVal
      : parseFloat(String(rawVal ?? '').replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) {
    throw new Error('valor BCB inválido');
  }
  return n;
}

/** Fonte alternativa pública com CORS aberto. Retorna taxas anuais; convertemos quando necessário. */
async function fetchBrasilApiIndicators(): Promise<{
  selicAnual?: number;
  selicMensal?: number;
  cdiAnual?: number;
  cdiMensal?: number;
}> {
  const brasilApiBase = typeof window !== 'undefined' ? '/api/brasilapi' : 'https://brasilapi.com.br';
  const res = await fetch(`${brasilApiBase}/api/taxas/v1`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`BrasilAPI HTTP ${res.status}`);
  const data = (await res.json()) as Array<{ nome?: string; valor?: number }>;
  if (!Array.isArray(data)) throw new Error('BrasilAPI payload inválido');

  const findVal = (nameLower: string): number | undefined => {
    const row = data.find((d) => (d?.nome ?? '').toString().toLowerCase() === nameLower);
    const v = row?.valor;
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };

  const selicAnual = findVal('selic');
  const cdiAnual = findVal('cdi');

  return {
    selicAnual,
    cdiAnual,
    selicMensal: selicAnual != null ? anualParaMensal(selicAnual) : undefined,
    cdiMensal: cdiAnual != null ? anualParaMensal(cdiAnual) : undefined,
  };
}

/**
 * Indicadores atuais — apenas BCB (séries 432, 4390, 4391).
 * Retorna `null` se qualquer série falhar (sem estimativa).
 */
export async function fetchEconomicIndicatorsFromBcb(): Promise<EconomicIndicators | null> {
  try {
    const [selicAnual, selicMensal, cdiMensal] = await Promise.all([
      fetchSerieUltimoValor(432),
      fetchSerieUltimoValor(4390),
      fetchSerieUltimoValor(4391),
    ]);
    return { selicAnual, selicMensal, cdiMensal, source: 'bcb' };
  } catch {
    return null;
  }
}

/** @deprecated Preferir `fetchEconomicIndicatorsFromBcb` no módulo de empréstimos. */
export async function fetchEconomicIndicators(): Promise<EconomicIndicators> {
  const now = Date.now();
  if (cachedIndicators && now < cacheUntilMs) {
    return cachedIndicators;
  }
  if (inflightIndicatorsPromise) {
    return inflightIndicatorsPromise;
  }

  inflightIndicatorsPromise = (async () => {
    const [selicAnualRes, selicMensalRes, cdiMensalRes] = await Promise.allSettled([
      fetchSerieUltimoValor(432),
      fetchSerieUltimoValor(4390),
      fetchSerieUltimoValor(4391),
    ]);

    const anyRejected =
      selicAnualRes.status === 'rejected' ||
      selicMensalRes.status === 'rejected' ||
      cdiMensalRes.status === 'rejected';

    if (!anyRejected) {
      const live: EconomicIndicators = {
        selicAnual: selicAnualRes.value,
        selicMensal: selicMensalRes.value,
        cdiMensal: cdiMensalRes.value,
        source: 'bcb',
      };
      cachedIndicators = live;
      cacheUntilMs = Date.now() + CACHE_TTL_OK_MS;
      warnedBcbOnce = false;
      return live;
    }

    let altSelicAnual: number | undefined;
    let altSelicMensal: number | undefined;
    let altCdiMensal: number | undefined;
    let altOk = false;
    try {
      const alt = await fetchBrasilApiIndicators();
      altSelicAnual = alt.selicAnual;
      altSelicMensal = alt.selicMensal;
      altCdiMensal = alt.cdiMensal;
      altOk = altSelicAnual != null || altSelicMensal != null || altCdiMensal != null;
    } catch {
      altOk = false;
    }

    const previous = cachedIndicators;
    const pickNumber = (...candidates: Array<number | undefined>): number | undefined =>
      candidates.find((v) => typeof v === 'number' && Number.isFinite(v));

    const selicAnualFinal = pickNumber(
      selicAnualRes.status === 'fulfilled' ? selicAnualRes.value : undefined,
      altSelicAnual,
      previous?.selicAnual,
      FALLBACK_INDICATORS.selicAnual
    )!;
    const selicMensalFinal = pickNumber(
      selicMensalRes.status === 'fulfilled' ? selicMensalRes.value : undefined,
      altSelicMensal,
      previous?.selicMensal,
      FALLBACK_INDICATORS.selicMensal
    )!;
    const cdiMensalFinal = pickNumber(
      cdiMensalRes.status === 'fulfilled' ? cdiMensalRes.value : undefined,
      altCdiMensal,
      previous?.cdiMensal,
      FALLBACK_INDICATORS.cdiMensal
    )!;

    const usedAltAtLeastOnce =
      altOk &&
      ((selicAnualRes.status === 'rejected' && altSelicAnual != null) ||
        (selicMensalRes.status === 'rejected' && altSelicMensal != null) ||
        (cdiMensalRes.status === 'rejected' && altCdiMensal != null));

    const usedFallbackHardcoded =
      (selicAnualRes.status === 'rejected' && altSelicAnual == null && previous?.selicAnual == null) ||
      (selicMensalRes.status === 'rejected' && altSelicMensal == null && previous?.selicMensal == null) ||
      (cdiMensalRes.status === 'rejected' && altCdiMensal == null && previous?.cdiMensal == null);

    const result: EconomicIndicators = {
      selicAnual: selicAnualFinal,
      selicMensal: selicMensalFinal,
      cdiMensal: cdiMensalFinal,
      error: usedFallbackHardcoded,
      source: !anyRejected
        ? 'bcb'
        : usedAltAtLeastOnce && !usedFallbackHardcoded
          ? 'brasilapi'
          : usedFallbackHardcoded
            ? 'fallback'
            : 'mixed',
    };

    if (usedFallbackHardcoded && !warnedBcbOnce) {
      console.warn('[indicadores] BCB e fonte alternativa indisponíveis; usando valores padrão.');
      warnedBcbOnce = true;
    }

    cachedIndicators = result;
    cacheUntilMs =
      Date.now() + (usedFallbackHardcoded ? CACHE_TTL_FALLBACK_MS : CACHE_TTL_PARTIAL_MS);
    return result;
  })()
    .catch(() => {
      const fallback: EconomicIndicators = { ...FALLBACK_INDICATORS };
      cachedIndicators = fallback;
      cacheUntilMs = Date.now() + CACHE_TTL_FALLBACK_MS;
      return fallback;
    })
    .finally(() => {
      inflightIndicatorsPromise = null;
    });

  return inflightIndicatorsPromise;
}
