import { writePersistedLocalStorageJson } from '../../lib/persistentLocalStorage';
import { companyStorageSlug } from './companyWorkspace';
import {
  criarRegraBloqueio,
  DEFAULT_FISCAL_NOTA_BLOQUEIO,
  type FiscalNotaBloqueioConfig,
  type FiscalNotaBloqueioRegra,
} from './fiscalNotaBloqueio';

function storageKey(company: string): string {
  return `contabilfacil_${companyStorageSlug(company)}_fiscal_nota_bloqueio_v1`;
}

function sanitizeRegra(raw: Partial<FiscalNotaBloqueioRegra>): FiscalNotaBloqueioRegra | null {
  const tipo = raw.tipo === 'cfop' ? 'cfop' : raw.tipo === 'texto' ? 'texto' : null;
  if (!tipo) return null;
  return criarRegraBloqueio({
    id: raw.id,
    tipo,
    valor: raw.valor ?? '',
    rotulo: raw.rotulo ?? '',
  });
}

function sanitizeConfig(raw: unknown): FiscalNotaBloqueioConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_FISCAL_NOTA_BLOQUEIO };
  const o = raw as Partial<FiscalNotaBloqueioConfig>;
  const regras: FiscalNotaBloqueioRegra[] = [];
  if (Array.isArray(o.regras)) {
    for (const item of o.regras) {
      const r = sanitizeRegra(item as Partial<FiscalNotaBloqueioRegra>);
      if (r) {
        regras.push({
          ...r,
          criadoEm:
            typeof (item as FiscalNotaBloqueioRegra).criadoEm === 'string'
              ? (item as FiscalNotaBloqueioRegra).criadoEm
              : r.criadoEm,
        });
      }
    }
  }
  return {
    bloquearValorZero: o.bloquearValorZero !== false,
    bloquearRemessa: o.bloquearRemessa !== false,
    regras,
  };
}

export function loadFiscalNotaBloqueio(company: string): FiscalNotaBloqueioConfig {
  try {
    const raw = localStorage.getItem(storageKey(company));
    if (!raw?.trim()) return { ...DEFAULT_FISCAL_NOTA_BLOQUEIO };
    return sanitizeConfig(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_FISCAL_NOTA_BLOQUEIO };
  }
}

export function saveFiscalNotaBloqueio(
  company: string,
  config: FiscalNotaBloqueioConfig,
): FiscalNotaBloqueioConfig {
  const next = sanitizeConfig(config);
  writePersistedLocalStorageJson(storageKey(company), next);
  return next;
}

export function addFiscalNotaBloqueioRegra(
  company: string,
  draft: Pick<FiscalNotaBloqueioRegra, 'tipo' | 'valor' | 'rotulo'>,
): FiscalNotaBloqueioConfig {
  const atual = loadFiscalNotaBloqueio(company);
  const regra = criarRegraBloqueio(draft);
  if (!regra) return atual;
  const duplicada = atual.regras.some(
    (r) => r.tipo === regra.tipo && r.valor.toUpperCase() === regra.valor.toUpperCase(),
  );
  if (duplicada) return atual;
  return saveFiscalNotaBloqueio(company, { ...atual, regras: [...atual.regras, regra] });
}

export function removeFiscalNotaBloqueioRegra(company: string, id: string): FiscalNotaBloqueioConfig {
  const atual = loadFiscalNotaBloqueio(company);
  return saveFiscalNotaBloqueio(company, {
    ...atual,
    regras: atual.regras.filter((r) => r.id !== id),
  });
}

export function patchFiscalNotaBloqueioValorZero(
  company: string,
  bloquearValorZero: boolean,
): FiscalNotaBloqueioConfig {
  const atual = loadFiscalNotaBloqueio(company);
  return saveFiscalNotaBloqueio(company, { ...atual, bloquearValorZero });
}

export function patchFiscalNotaBloqueioRemessa(
  company: string,
  bloquearRemessa: boolean,
): FiscalNotaBloqueioConfig {
  const atual = loadFiscalNotaBloqueio(company);
  return saveFiscalNotaBloqueio(company, { ...atual, bloquearRemessa });
}

export function mergeFiscalNotaBloqueioRegras(
  company: string,
  novas: FiscalNotaBloqueioRegra[],
): FiscalNotaBloqueioConfig {
  const atual = loadFiscalNotaBloqueio(company);
  const existentes = new Set(atual.regras.map((r) => `${r.tipo}|${r.valor}`));
  const merged = [...atual.regras];
  for (const r of novas) {
    const key = `${r.tipo}|${r.valor}`;
    if (existentes.has(key)) continue;
    existentes.add(key);
    merged.push(r);
  }
  return saveFiscalNotaBloqueio(company, { ...atual, regras: merged });
}
