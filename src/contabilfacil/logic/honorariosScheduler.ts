import type { HonorariosAutomacaoSettings, HonorariosValorMes } from './honorariosAutomacaoStorage';
import type { HonorariosLancamento } from './honorariosToRazao';

export const HONORARIOS_AUTO_ID_PREFIX = 'honor-auto-';

export function isHonorariosLancamentoAuto(id: string): boolean {
  return id.startsWith(HONORARIOS_AUTO_ID_PREFIX);
}

export function honorariosAutoId(ano: number, mes: number): string {
  return `${HONORARIOS_AUTO_ID_PREFIX}${ano}-${String(mes).padStart(2, '0')}`;
}

/** Meses consecutivos a partir de mesInicial (máx. repeticoesPorAno). */
export function mesesRepeticaoAno(settings: Pick<HonorariosAutomacaoSettings, 'repeticoesPorAno' | 'mesInicial'>): number[] {
  const n = Math.min(12, Math.max(1, settings.repeticoesPorAno));
  const start = Math.min(12, Math.max(1, settings.mesInicial));
  const meses: number[] = [];
  for (let i = 0; i < n; i++) {
    const m = start + i;
    if (m > 12) break;
    meses.push(m);
  }
  return meses;
}

function valorParaMes(
  ano: number,
  mes: number,
  settings: HonorariosAutomacaoSettings,
  valoresMes: HonorariosValorMes[],
): { valor: number; historico: string } {
  const hit = valoresMes.find((v) => v.ano === ano && v.mes === mes);
  return {
    valor: hit?.valor ?? settings.valorPadrao,
    historico: (hit?.historico ?? settings.historicoPadrao).trim().toUpperCase(),
  };
}

function isoDate(ano: number, mes: number, dia: number): string {
  const d = Math.min(28, Math.max(1, dia));
  return `${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function gerarLancamentosAnoHonorarios(
  ano: number,
  settings: HonorariosAutomacaoSettings,
  valoresMes: HonorariosValorMes[],
): HonorariosLancamento[] {
  const meses = mesesRepeticaoAno(settings);
  const out: HonorariosLancamento[] = [];

  for (const mes of meses) {
    const { valor, historico } = valorParaMes(ano, mes, settings, valoresMes);
    if (valor < 0.0001) continue;
    out.push({
      id: honorariosAutoId(ano, mes),
      date: isoDate(ano, mes, settings.diaLancamento),
      valor,
      historico,
      anoRef: ano,
      mesRef: mes,
      automatico: true,
    });
  }

  return out;
}

export function gerarLancamentosHonorariosAutomacao(
  settings: HonorariosAutomacaoSettings,
  valoresMes: HonorariosValorMes[],
  anoAte: number = new Date().getFullYear(),
): HonorariosLancamento[] {
  const inicio = Math.min(settings.anoInicio, anoAte);
  const out: HonorariosLancamento[] = [];
  for (let ano = inicio; ano <= anoAte; ano++) {
    out.push(...gerarLancamentosAnoHonorarios(ano, settings, valoresMes));
  }
  return out;
}

export function mesclarLancamentosHonorarios(
  manuais: HonorariosLancamento[],
  automaticos: HonorariosLancamento[],
): HonorariosLancamento[] {
  const semAuto = manuais.filter((l) => !isHonorariosLancamentoAuto(l.id));
  const merged = [...semAuto, ...automaticos];
  return merged.sort((a, b) => {
    const da = a.date.localeCompare(b.date);
    if (da !== 0) return da;
    return a.id.localeCompare(b.id);
  });
}
