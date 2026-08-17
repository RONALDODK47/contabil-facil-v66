import type { EconomicIndicators } from './bcbService';
import { isOfficialBcbIndicators, type BcbFetchMeta } from './bcbService';
import { getEmbeddedSerie11Count } from './bcbSeriesStorage';
import type { SimTabFields } from '../lib/simTabFields';
import { usesSpreadPlusIndexador } from '../lib/simTabFields';

function formatCacheHint(meta: BcbFetchMeta | undefined): string {
  if (!meta || meta.source !== 'cache' || !meta.updatedAt) return '';
  const d = new Date(meta.updatedAt);
  if (Number.isNaN(d.getTime())) return ' (cache local)';
  return ` (cache local — ${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})`;
}

export type BcbLoadState = 'idle' | 'loading' | 'ok' | 'error';

export interface BcbReadiness {
  ready: boolean;
  message: string;
  loading: boolean;
  selicDailyPoints: number;
  monthlyIndexMonths: number;
  indicatorsFromBcb: boolean;
}

export function evaluateBcbReadiness(input: {
  tab: SimTabFields | null;
  selicLoadState: BcbLoadState;
  selicDailyCount: number;
  monthlyLoadState: BcbLoadState;
  monthlyIndexCount: number;
  indicators: EconomicIndicators | null;
  indicatorsLoadState: BcbLoadState;
  selicFetchMeta?: BcbFetchMeta;
  monthlyFetchMeta?: BcbFetchMeta;
}): BcbReadiness {
  const {
    tab,
    selicLoadState,
    selicDailyCount,
    monthlyLoadState,
    monthlyIndexCount,
    indicators,
    indicatorsLoadState,
    selicFetchMeta,
    monthlyFetchMeta,
  } = input;

  if (!tab || !usesSpreadPlusIndexador(tab.varMode)) {
    return {
      ready: true,
      message: '',
      loading: false,
      selicDailyPoints: selicDailyCount,
      monthlyIndexMonths: monthlyIndexCount,
      indicatorsFromBcb: isOfficialBcbIndicators(indicators),
    };
  }

  const needsDaily = tab.varMode === 'pronampe';
  const needsMonthly = tab.varMode === 'cdi' || tab.varMode === 'selic';

  /** PRONAMPE usa só série 11 embutida/cache — não bloqueia por indicadores “último valor”. */
  const loading =
    (needsDaily && selicLoadState === 'loading') ||
    (needsMonthly && monthlyLoadState === 'loading');

  if (loading) {
    return {
      ready: false,
      message: 'Carregando séries oficiais do Banco Central (BCB)…',
      loading: true,
      selicDailyPoints: selicDailyCount,
      monthlyIndexMonths: monthlyIndexCount,
      indicatorsFromBcb: false,
    };
  }

  if (needsDaily) {
    if (selicLoadState === 'error' || selicDailyCount === 0) {
      const embedded = getEmbeddedSerie11Count();
      return {
        ready: false,
        message:
          embedded > 0
            ? `Série 11 indisponível para as datas deste contrato (pacote offline: ${embedded} cotações). Ajuste datas ou atualize o build (npm run bcb:download).`
            : 'Série 11 (Selic Over) indisponível. Rode npm run bcb:download e faça deploy de novo para embutir o histórico no site.',
        loading: false,
        selicDailyPoints: 0,
        monthlyIndexMonths: monthlyIndexCount,
        indicatorsFromBcb: isOfficialBcbIndicators(indicators),
      };
    }
    return {
      ready: true,
      message: `Selic Over: ${selicDailyCount} cotações diárias (BCB série 11)${formatCacheHint(selicFetchMeta)}.`,
      loading: false,
      selicDailyPoints: selicDailyCount,
      monthlyIndexMonths: monthlyIndexCount,
      indicatorsFromBcb: isOfficialBcbIndicators(indicators),
    };
  }

  if (needsMonthly) {
    if (monthlyLoadState === 'error' || monthlyIndexCount === 0) {
      const serie = tab.varMode === 'cdi' ? '4391 (CDI)' : '4390 (Selic mensal)';
      return {
        ready: false,
        message: `Série ${serie} indisponível no BCB. Cronograma bloqueado — sem estimativa.`,
        loading: false,
        selicDailyPoints: selicDailyCount,
        monthlyIndexMonths: 0,
        indicatorsFromBcb: isOfficialBcbIndicators(indicators),
      };
    }
    return {
      ready: true,
      message: `Indexador mensal: ${monthlyIndexCount} competências (BCB)${formatCacheHint(monthlyFetchMeta)}.`,
      loading: false,
      selicDailyPoints: selicDailyCount,
      monthlyIndexMonths: monthlyIndexCount,
      indicatorsFromBcb: isOfficialBcbIndicators(indicators),
    };
  }

  return {
    ready: true,
    message: '',
    loading: false,
    selicDailyPoints: selicDailyCount,
    monthlyIndexMonths: monthlyIndexCount,
    indicatorsFromBcb: isOfficialBcbIndicators(indicators),
  };
}
