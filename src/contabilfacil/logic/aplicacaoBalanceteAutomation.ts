import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';
import { parseCurrency } from '../../lib/simTabFields';
import {
  coletarLancamentosAplicacao,
  cronogramaAplicacao,
} from '../../lib/aplicacoesDominioExport';
import { enrichAplicacaoExportInput } from './aplicacaoLancamentosDisplay';
import {
  loadAplicacoesFromBrowserStorage,
  type SavedAplicacao,
} from './aplicacaoStorage';
import { belongsToSindicato, normalizeCompanyName, readManagerData, writeManagerData, flushManagerDataWrites } from './companyWorkspace';
import { normalizeRazaoImport } from './contabilPipeline';
import {
  buildRazaoFromDominioPlain,
  mergeDominioPlainRazaoComExistente,
} from './dominioPlainToRazao';

export const APLICACAO_RAZAO_MARCA = 'APLICACAO-AUTO';

function dispatchRazaoUpdated(companyName: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('contabilfacil-razao-updated', { detail: { company: companyName } }),
  );
}

function appsDaEmpresa(companyName: string): SavedAplicacao[] {
  return loadAplicacoesFromBrowserStorage().filter((a) =>
    belongsToSindicato(a.sindicatoName, companyName),
  );
}

/**
 * Publica lançamentos de aplicações no balancete/razão (só sob ação explícita do usuário).
 */
export function postAplicacaoNoRazao(
  companyName: string,
  aplicacaoId?: string,
): { gerados: number; pendencias: string[] } {
  const company = normalizeCompanyName(companyName);
  const apps = appsDaEmpresa(company);
  const alvos = aplicacaoId ? apps.filter((a) => a.id === aplicacaoId) : apps;
  const pendencias: string[] = [];

  if (alvos.length === 0) {
    return { gerados: 0, pendencias: ['Nenhuma aplicação encontrada para enviar.'] };
  }

  let existente = readManagerData<VisionBalanceteRow>(company, 'razao');
  let totalGerados = 0;

  for (const app of alvos) {
    const inp = enrichAplicacaoExportInput(app);
    const cron = cronogramaAplicacao(inp, parseCurrency);
    const plain = coletarLancamentosAplicacao(inp, parseCurrency, cron);
    if (plain.length === 0) {
      pendencias.push(
        `${app.nomeAplicacao || app.id}: nenhum lançamento (configure contas/valores).`,
      );
      // Remove lançamentos antigos desta app mesmo se agora zerou
      existente = mergeDominioPlainRazaoComExistente(existente, [], APLICACAO_RAZAO_MARCA, app.id);
      continue;
    }
    const { rows, gerados } = buildRazaoFromDominioPlain(plain, APLICACAO_RAZAO_MARCA, app.id);
    existente = mergeDominioPlainRazaoComExistente(existente, rows, APLICACAO_RAZAO_MARCA, app.id);
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
