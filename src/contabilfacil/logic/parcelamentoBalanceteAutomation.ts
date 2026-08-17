import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';
import { parseCurrency } from '../../lib/simTabFields';
import {
  coletarLancamentosJurosParcelamento,
  cronogramaParcelamento,
  fromSavedParcelamentoLike,
} from '../../lib/parcelamentoDominioExport';
import {
  loadParcelamentosFromBrowserStorage,
  type SavedParcelamento,
} from './parcelamentoStorage';
import {
  belongsToCompany,
  normalizeCompanyName,
  readManagerData,
  writeManagerData,
  flushManagerDataWrites,
} from './companyWorkspace';
import { normalizeRazaoImport } from './contabilPipeline';
import {
  buildRazaoFromDominioPlain,
  mergeDominioPlainRazaoComExistente,
} from './dominioPlainToRazao';

export const PARCELAMENTO_RAZAO_MARCA = 'PARCELAMENTO-AUTO';

function dispatchRazaoUpdated(companyName: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('contabilfacil-razao-updated', { detail: { company: companyName } }),
  );
}

function parcelamentosDaEmpresa(companyName: string): SavedParcelamento[] {
  return loadParcelamentosFromBrowserStorage().filter((p) =>
    belongsToCompany(p.companyName, companyName),
  );
}

/**
 * Publica lançamentos de parcelamento no balancete/razão (só sob ação explícita).
 */
export function postParcelamentoNoRazao(
  companyName: string,
  parcelamentoId?: string,
): { gerados: number; pendencias: string[] } {
  const company = normalizeCompanyName(companyName);
  const list = parcelamentosDaEmpresa(company);
  const alvos = parcelamentoId ? list.filter((p) => p.id === parcelamentoId) : list;
  const pendencias: string[] = [];

  if (alvos.length === 0) {
    return { gerados: 0, pendencias: ['Nenhum parcelamento encontrado para enviar.'] };
  }

  let existente = readManagerData<VisionBalanceteRow>(company, 'razao');
  let totalGerados = 0;

  for (const p of alvos) {
    const inp = fromSavedParcelamentoLike(p);
    const cron = cronogramaParcelamento(inp, parseCurrency);
    const plain = coletarLancamentosJurosParcelamento(inp, parseCurrency, cron);
    if (plain.length === 0) {
      pendencias.push(
        `${p.nomeParcelamento || p.numeroParcelamento || p.id}: nenhum lançamento (configure contas/valores).`,
      );
      existente = mergeDominioPlainRazaoComExistente(
        existente,
        [],
        PARCELAMENTO_RAZAO_MARCA,
        p.id,
      );
      continue;
    }
    const { rows, gerados } = buildRazaoFromDominioPlain(
      plain,
      PARCELAMENTO_RAZAO_MARCA,
      p.id,
    );
    existente = mergeDominioPlainRazaoComExistente(
      existente,
      rows,
      PARCELAMENTO_RAZAO_MARCA,
      p.id,
    );
    totalGerados += gerados;
  }

  if (totalGerados <= 0 && pendencias.length > 0) {
    return { gerados: 0, pendencias };
  }

  const merged = normalizeRazaoImport(existente);
  writeManagerData(company, 'razao', merged);
  flushManagerDataWrites();
  dispatchRazaoUpdated(company);
  return { gerados: totalGerados, pendencias };
}
