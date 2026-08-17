import { writePersistedLocalStorageJson } from '../../lib/persistentLocalStorage';
import { companyStorageSlug } from './companyWorkspace';

export type HonorariosAutomacaoSettings = {
  automationEnabled: boolean;
  /** Quantas vezes por ano repetir (1–12 meses). */
  repeticoesPorAno: number;
  /** Mês inicial da sequência (1 = janeiro). */
  mesInicial: number;
  /** Dia do mês de cada lançamento (1–28). */
  diaLancamento: number;
  valorPadrao: number;
  historicoPadrao: string;
  /** Primeiro ano com lançamentos automáticos. */
  anoInicio: number;
};

export type HonorariosValorMes = {
  ano: number;
  mes: number;
  valor: number;
  historico?: string;
};

const DEFAULT_SETTINGS = (ano = new Date().getFullYear()): HonorariosAutomacaoSettings => ({
  automationEnabled: false,
  repeticoesPorAno: 12,
  mesInicial: 1,
  diaLancamento: 10,
  valorPadrao: 0,
  historicoPadrao: 'HONORÁRIOS CONTÁBEIS',
  anoInicio: ano,
});

function settingsKey(company: string): string {
  return `contabilfacil_${companyStorageSlug(company)}_honorarios_automacao_v1`;
}

function valoresKey(company: string): string {
  return `contabilfacil_${companyStorageSlug(company)}_honorarios_valores_mes_v1`;
}

export function loadHonorariosAutomacaoSettings(company: string): HonorariosAutomacaoSettings {
  try {
    const raw = localStorage.getItem(settingsKey(company));
    if (!raw?.trim()) return DEFAULT_SETTINGS();
    const parsed = JSON.parse(raw) as Partial<HonorariosAutomacaoSettings>;
    const ano = new Date().getFullYear();
    return {
      automationEnabled: parsed.automationEnabled === true,
      repeticoesPorAno: clampInt(parsed.repeticoesPorAno, 1, 12, 12),
      mesInicial: clampInt(parsed.mesInicial, 1, 12, 1),
      diaLancamento: clampInt(parsed.diaLancamento, 1, 28, 10),
      valorPadrao: Math.max(0, Number(parsed.valorPadrao) || 0),
      historicoPadrao: String(parsed.historicoPadrao ?? 'HONORÁRIOS CONTÁBEIS').trim().toUpperCase(),
      anoInicio: clampInt(parsed.anoInicio, 2000, 2100, ano),
    };
  } catch {
    return DEFAULT_SETTINGS();
  }
}

export function saveHonorariosAutomacaoSettings(
  company: string,
  patch: Partial<HonorariosAutomacaoSettings>,
): HonorariosAutomacaoSettings {
  const prev = loadHonorariosAutomacaoSettings(company);
  const next: HonorariosAutomacaoSettings = {
    ...prev,
    ...patch,
    repeticoesPorAno: patch.repeticoesPorAno != null ? clampInt(patch.repeticoesPorAno, 1, 12, 12) : prev.repeticoesPorAno,
    mesInicial: patch.mesInicial != null ? clampInt(patch.mesInicial, 1, 12, 1) : prev.mesInicial,
    diaLancamento:
      patch.diaLancamento != null ? clampInt(patch.diaLancamento, 1, 28, 10) : prev.diaLancamento,
    valorPadrao: patch.valorPadrao != null ? Math.max(0, Number(patch.valorPadrao) || 0) : prev.valorPadrao,
    historicoPadrao:
      patch.historicoPadrao != null
        ? String(patch.historicoPadrao).trim().toUpperCase()
        : prev.historicoPadrao,
    anoInicio:
      patch.anoInicio != null ? clampInt(patch.anoInicio, 2000, 2100, prev.anoInicio) : prev.anoInicio,
  };
  writePersistedLocalStorageJson(settingsKey(company), next);
  return next;
}

export function loadHonorariosValoresMes(company: string): HonorariosValorMes[] {
  try {
    const raw = localStorage.getItem(valoresKey(company));
    if (!raw?.trim()) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: HonorariosValorMes[] = [];
    for (const item of parsed) {
      const row = item as Partial<HonorariosValorMes>;
      const ano = Number(row.ano);
      const mes = Number(row.mes);
      const valor = Number(row.valor);
      if (!Number.isFinite(ano) || !Number.isFinite(mes) || mes < 1 || mes > 12) continue;
      if (!Number.isFinite(valor) || valor < 0) continue;
      out.push({
        ano,
        mes,
        valor,
        historico: row.historico?.trim().toUpperCase(),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function saveHonorariosValoresMes(company: string, valores: HonorariosValorMes[]): HonorariosValorMes[] {
  const map = new Map<string, HonorariosValorMes>();
  for (const v of valores) {
    if (v.mes < 1 || v.mes > 12 || v.valor < 0) continue;
    map.set(`${v.ano}-${v.mes}`, {
      ano: v.ano,
      mes: v.mes,
      valor: v.valor,
      historico: v.historico?.trim().toUpperCase(),
    });
  }
  const next = [...map.values()].sort((a, b) => a.ano - b.ano || a.mes - b.mes);
  writePersistedLocalStorageJson(valoresKey(company), next);
  return next;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
