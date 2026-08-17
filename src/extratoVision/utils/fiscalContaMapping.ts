export type FiscalImpostoChave =
  | 'icms'
  | 'ipi'
  | 'iss'
  | 'pis'
  | 'cofins'
  | 'inss'
  | 'irrf'
  | 'irpj'
  | 'csll'
  | 'outros';

export type FiscalContaMap = Partial<Record<FiscalImpostoChave, string>>;

const STORAGE_KEY = 'extratoVision_fiscal_conta_map_v1';

type PersistPayload = Record<string, FiscalContaMap>;

function normEmpresa(empresa: string): string {
  const v = empresa.trim().toLowerCase();
  return v || '__default__';
}

function readRaw(): PersistPayload {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as PersistPayload;
  } catch {
    return {};
  }
}

export function readFiscalContaMap(empresa: string): FiscalContaMap {
  const all = readRaw();
  return all[normEmpresa(empresa)] ?? {};
}

export function saveFiscalContaMap(empresa: string, map: FiscalContaMap): void {
  const all = readRaw();
  all[normEmpresa(empresa)] = map;
  // ⚠️ DISABLED: Salva SOMENTE no Docker, não em localStorage
  // localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function detectFiscalImpostoKey(text: string): FiscalImpostoChave {
  const t = text.toLowerCase();
  if (/\bicms\b/.test(t)) return 'icms';
  if (/\bipi\b/.test(t)) return 'ipi';
  if (/\biss\b/.test(t)) return 'iss';
  if (/\bpis\b/.test(t)) return 'pis';
  if (/\bcofins\b/.test(t)) return 'cofins';
  if (/\binss\b/.test(t)) return 'inss';
  if (/\birrf\b|\bimposto de renda retido\b/.test(t)) return 'irrf';
  if (/\birpj\b/.test(t)) return 'irpj';
  if (/\bcsll\b/.test(t)) return 'csll';
  return 'outros';
}

export function fiscalImpostoLabel(key: FiscalImpostoChave): string {
  const labels: Record<FiscalImpostoChave, string> = {
    icms: 'ICMS',
    ipi: 'IPI',
    iss: 'ISS',
    pis: 'PIS',
    cofins: 'COFINS',
    inss: 'INSS',
    irrf: 'IRRF',
    irpj: 'IRPJ',
    csll: 'CSLL',
    outros: 'Outros',
  };
  return labels[key];
}
