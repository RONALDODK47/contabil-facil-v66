import type { PricingNfeCache } from './pricingTypes';
import { readManagerData, writeManagerData } from './companyWorkspace';

export type FiscalNfeCache = PricingNfeCache;

export function loadFiscalNfeCache(companyName: string): FiscalNfeCache | undefined {
  const rows = readManagerData<FiscalNfeCache>(companyName, 'fiscalNfe');
  const stored = rows[0];
  if (!stored || typeof stored !== 'object') return undefined;
  return stored;
}

export function saveFiscalNfeCache(companyName: string, cache: FiscalNfeCache): void {
  writeManagerData(companyName, 'fiscalNfe', [cache]);
}
