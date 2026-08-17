import { normalizeCompanyName, companyStorageSlug } from './companyWorkspace';
import { scheduleEyeVisionCloudPush } from './eyeVisionCloudPush';
import { defaultNotaExplicativaDados, type NotaExplicativaEmpresaDados, type NotaExplicativaProfile } from './notaExplicativaTypes';

const SUFFIX = 'nota_explicativa_v1';

function normalizeDados(
  raw: Partial<NotaExplicativaEmpresaDados> | undefined,
  companyName: string,
): NotaExplicativaEmpresaDados {
  const base = defaultNotaExplicativaDados(companyName);
  if (!raw) return base;
  return {
    ...base,
    ...raw,
    razaoSocial: raw.razaoSocial?.trim() ? raw.razaoSocial : base.razaoSocial,
    atividades: raw.atividades?.length ? raw.atividades : base.atividades,
    tiposEndividamento: Array.isArray(raw.tiposEndividamento) ? raw.tiposEndividamento : [],
    possuiEmprestimos: Boolean(raw.possuiEmprestimos),
    possuiFinanciamentos: Boolean(raw.possuiFinanciamentos),
    saldoEmprestimosCP: raw.saldoEmprestimosCP ?? '',
    saldoEmprestimosLP: raw.saldoEmprestimosLP ?? '',
    saldoFinanciamentosCP: raw.saldoFinanciamentosCP ?? '',
    saldoFinanciamentosLP: raw.saldoFinanciamentosLP ?? '',
    endividamentoObservacoes: raw.endividamentoObservacoes ?? '',
    fundamentoImunidadeIsencao: raw.fundamentoImunidadeIsencao ?? '',
  };
}

function storageKey(companyName: string): string {
  return `contabilfacil_${companyStorageSlug(companyName)}_${SUFFIX}`;
}

export function loadNotaExplicativaProfile(companyName: string): NotaExplicativaProfile {
  const key = storageKey(companyName);
  try {
    const raw = localStorage.getItem(key);
    if (raw?.trim()) {
      const parsed = JSON.parse(raw) as NotaExplicativaProfile;
      if (parsed?.dados) {
        return {
          ...parsed,
          dados: normalizeDados(parsed.dados, companyName),
        };
      }
    }
  } catch {
    // ignore
  }
  return {
    dados: defaultNotaExplicativaDados(companyName),
    overrides: {},
    updatedAt: new Date().toISOString(),
  };
}

export function saveNotaExplicativaProfile(companyName: string, profile: NotaExplicativaProfile): void {
  const next: NotaExplicativaProfile = { ...profile, updatedAt: new Date().toISOString() };
  // ⚠️ DISABLED: localStorage ZERO writes (QuotaExceededError)
  scheduleEyeVisionCloudPush();
}
