import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';
import { readManagerData, writeManagerData, flushManagerDataWrites } from './companyWorkspace';
import { normalizeRazaoImport } from './contabilPipeline';
import type { HonorariosContasAutomacaoConfig } from './honorariosContasAutomacao';
import { loadHonorariosContasAutomacao } from './honorariosContasAutomacaoStorage';
import {
  loadHonorariosAutomacaoSettings,
  loadHonorariosValoresMes,
  saveHonorariosAutomacaoSettings,
  saveHonorariosValoresMes,
  type HonorariosAutomacaoSettings,
  type HonorariosValorMes,
} from './honorariosAutomacaoStorage';
import {
  gerarLancamentosHonorariosAutomacao,
  isHonorariosLancamentoAuto,
  mesclarLancamentosHonorarios,
} from './honorariosScheduler';
import {
  buildRazaoFromHonorarios,
  mergeHonorariosRazaoComExistente,
  type HonorariosLancamento,
} from './honorariosToRazao';

export function loadHonorariosLancamentos(companyName: string): HonorariosLancamento[] {
  return readManagerData<HonorariosLancamento>(companyName, 'honorariosLancamentos');
}

export function saveHonorariosLancamentos(
  companyName: string,
  lancamentos: HonorariosLancamento[],
): void {
  writeManagerData(companyName, 'honorariosLancamentos', lancamentos);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('contabilfacil-honorarios-updated', { detail: { company: companyName } }),
    );
  }
}

export function postHonorariosNoRazao(
  companyName: string,
  contas?: HonorariosContasAutomacaoConfig,
): { gerados: number; pendencias: string[] } {
  const cfg = contas ?? loadHonorariosContasAutomacao(companyName);
  const lancamentos = loadHonorariosLancamentos(companyName);
  const { rows, gerados, pendencias } = buildRazaoFromHonorarios(lancamentos, cfg);
  if (gerados <= 0) return { gerados: 0, pendencias };

  const existente = readManagerData<VisionBalanceteRow>(companyName, 'razao');
  const merged = normalizeRazaoImport(mergeHonorariosRazaoComExistente(existente, rows));
  writeManagerData(companyName, 'razao', merged);
  flushManagerDataWrites();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('contabilfacil-razao-updated', { detail: { company: companyName } }),
    );
  }
  return { gerados, pendencias };
}

export function sincronizarHonorariosAutomacao(
  companyName: string,
  contas?: HonorariosContasAutomacaoConfig,
): { ok: boolean; pendencias: string[]; gerados: number } {
  const settings = loadHonorariosAutomacaoSettings(companyName);
  if (!settings.automationEnabled) {
    return { ok: true, pendencias: [], gerados: 0 };
  }

  const valoresMes = loadHonorariosValoresMes(companyName);
  const anoAtual = new Date().getFullYear();
  const automaticos = gerarLancamentosHonorariosAutomacao(settings, valoresMes, anoAtual);
  const manuais = loadHonorariosLancamentos(companyName);
  const merged = mesclarLancamentosHonorarios(manuais, automaticos);
  saveHonorariosLancamentos(companyName, merged);

  // Só gera lançamentos locais — postagem ao balancete é explícita pelo botão.
  void contas;
  return { ok: true, pendencias: [], gerados: automaticos.length };
}

export function atualizarValoresHonorariosMeses(
  companyName: string,
  params: { ano: number; meses: number[]; valor: number; historico?: string },
  contas?: HonorariosContasAutomacaoConfig,
): { ok: boolean; pendencias: string[] } {
  const valor = Math.abs(params.valor);
  if (valor < 0.0001) {
    return { ok: false, pendencias: ['Informe um valor maior que zero.'] };
  }
  if (!params.meses.length) {
    return { ok: false, pendencias: ['Selecione ao menos um mês.'] };
  }

  const atuais = loadHonorariosValoresMes(companyName);
  const map = new Map(atuais.map((v) => [`${v.ano}-${v.mes}`, v] as const));
  const hist = params.historico?.trim().toUpperCase();

  for (const mes of params.meses) {
    if (mes < 1 || mes > 12) continue;
    map.set(`${params.ano}-${mes}`, {
      ano: params.ano,
      mes,
      valor,
      historico: hist,
    });
  }

  saveHonorariosValoresMes(companyName, [...map.values()]);

  const settings = loadHonorariosAutomacaoSettings(companyName);
  if (settings.automationEnabled) {
    const sync = sincronizarHonorariosAutomacao(companyName, contas);
    return { ok: sync.ok, pendencias: sync.pendencias };
  }

  return { ok: true, pendencias: [] };
}

export function salvarConfigHonorariosAutomacao(
  companyName: string,
  patch: Partial<HonorariosAutomacaoSettings>,
  contas?: HonorariosContasAutomacaoConfig,
): { ok: boolean; pendencias: string[] } {
  const prev = loadHonorariosAutomacaoSettings(companyName);
  const next = saveHonorariosAutomacaoSettings(companyName, {
    ...patch,
    anoInicio: patch.anoInicio ?? (patch.automationEnabled && !prev.automationEnabled ? new Date().getFullYear() : prev.anoInicio),
  });

  if (!next.automationEnabled) {
    const semAuto = loadHonorariosLancamentos(companyName).filter((l) => !isHonorariosLancamentoAuto(l.id));
    saveHonorariosLancamentos(companyName, semAuto);
    return { ok: true, pendencias: [] };
  }

  const sync = sincronizarHonorariosAutomacao(companyName, contas);
  return { ok: sync.ok, pendencias: sync.pendencias };
}

function parseDataBrParts(s: string): { ano: number; mes: number; dia: number } | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const ano = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return { ano, mes, dia };
}

function lastDayOfMonth(ano: number, mes: number): number {
  return new Date(ano, mes, 0).getDate();
}

const MAX_MESES_PERIODO_HONORARIOS = 600;

/**
 * Registra honorários para um período (Data De → Data Até): um lançamento por mês
 * no intervalo, no mesmo dia da data inicial (ajustado ao último dia do mês quando
 * o mês não tiver esse dia). Se De === Até, gera um único lançamento (mesmo
 * comportamento de registrarHonorario).
 */
export function registrarHonorarioPeriodo(
  companyName: string,
  params: { dataInicio: string; dataFim: string; valor: number; historico?: string },
  contas?: HonorariosContasAutomacaoConfig,
): { ok: boolean; pendencias: string[]; lancamentos: HonorariosLancamento[] } {
  const valor = Math.abs(params.valor);
  if (valor < 0.0001) {
    return { ok: false, pendencias: ['Informe um valor maior que zero.'], lancamentos: [] };
  }

  const ini = parseDataBrParts(params.dataInicio);
  const fim = parseDataBrParts(params.dataFim);
  if (!ini || !fim) {
    return { ok: false, pendencias: ['Datas inválidas. Use o formato dd/mm/aaaa.'], lancamentos: [] };
  }

  const dia = ini.dia;
  let anoIni = ini.ano;
  let mesIni = ini.mes;
  let anoFim = fim.ano;
  let mesFim = fim.mes;
  if (anoFim < anoIni || (anoFim === anoIni && mesFim < mesIni)) {
    // Ordem invertida (Até antes de De) — troca em vez de gerar período vazio.
    [anoIni, mesIni, anoFim, mesFim] = [anoFim, mesFim, anoIni, mesIni];
  }

  const totalMeses = (anoFim - anoIni) * 12 + (mesFim - mesIni) + 1;
  if (totalMeses > MAX_MESES_PERIODO_HONORARIOS) {
    return { ok: false, pendencias: ['Período muito longo. Reduza o intervalo de datas.'], lancamentos: [] };
  }

  const historico = (params.historico || 'HONORÁRIOS CONTÁBEIS').trim().toUpperCase();
  const cfg = contas ?? loadHonorariosContasAutomacao(companyName);

  const novos: HonorariosLancamento[] = [];
  let ano = anoIni;
  let mes = mesIni;
  while (ano < anoFim || (ano === anoFim && mes <= mesFim)) {
    const diaMes = Math.min(dia, lastDayOfMonth(ano, mes));
    novos.push({
      id: crypto.randomUUID(),
      date: `${String(diaMes).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`,
      valor,
      historico,
      automatico: false,
    });
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }

  const existentes = loadHonorariosLancamentos(companyName);
  saveHonorariosLancamentos(companyName, [...existentes, ...novos]);

  if (!cfg.debito.trim() || !cfg.credito.trim()) {
    return {
      ok: true,
      pendencias: ['Lançamento(s) salvo(s). Configure as contas e use «Mandar para o balancete».'],
      lancamentos: novos,
    };
  }
  return { ok: true, pendencias: [], lancamentos: novos };
}

export function registrarHonorario(
  companyName: string,
  params: { date: string; valor: number; historico?: string },
  contas?: HonorariosContasAutomacaoConfig,
): { ok: boolean; pendencias: string[]; lancamento?: HonorariosLancamento } {
  const valor = Math.abs(params.valor);
  if (valor < 0.0001) {
    return { ok: false, pendencias: ['Informe um valor maior que zero.'] };
  }

  const cfg = contas ?? loadHonorariosContasAutomacao(companyName);
  const lancamento: HonorariosLancamento = {
    id: crypto.randomUUID(),
    date: params.date,
    valor,
    historico: (params.historico || 'HONORÁRIOS CONTÁBEIS').trim().toUpperCase(),
    automatico: false,
  };

  const existentes = loadHonorariosLancamentos(companyName);
  saveHonorariosLancamentos(companyName, [...existentes, lancamento]);

  // Só grava o lançamento — postagem ao balancete é explícita pelo botão.
  if (!cfg.debito.trim() || !cfg.credito.trim()) {
    return {
      ok: true,
      pendencias: ['Lançamento salvo. Configure as contas e use «Mandar para o balancete».'],
      lancamento,
    };
  }
  return { ok: true, pendencias: [], lancamento };
}

export function removerHonorario(companyName: string, id: string): void {
  if (isHonorariosLancamentoAuto(id)) {
    const m = id.match(/honor-auto-(\d{4})-(\d{2})/);
    if (m) {
      const ano = Number(m[1]);
      const mes = Number(m[2]);
      const valores = loadHonorariosValoresMes(companyName).filter(
        (v) => !(v.ano === ano && v.mes === mes),
      );
      saveHonorariosValoresMes(companyName, valores);
      const settings = loadHonorariosAutomacaoSettings(companyName);
      if (settings.valorPadrao < 0.0001) {
        const next = loadHonorariosLancamentos(companyName).filter((l) => l.id !== id);
        saveHonorariosLancamentos(companyName, next);
        return;
      }
    }
  }

  const next = loadHonorariosLancamentos(companyName).filter((l) => l.id !== id);
  saveHonorariosLancamentos(companyName, next);

  const settings = loadHonorariosAutomacaoSettings(companyName);
  if (settings.automationEnabled) {
    sincronizarHonorariosAutomacao(companyName);
  }
}

export function tryAutoSyncHonorariosOnOpen(companyName: string): void {
  const settings = loadHonorariosAutomacaoSettings(companyName);
  if (!settings.automationEnabled) return;
  sincronizarHonorariosAutomacao(companyName);
}
