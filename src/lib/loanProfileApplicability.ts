import type { SimVarMode } from './simTabFields';
import { usesSelicOverDailyVarMode } from './simTabFields';

/** Juros vêm da série 11 (DU) + spread composto — perfis de pró-rata/die não entram na taxa. */
export function usesSelicOverDailyMotor(
  varMode: SimVarMode,
  selicSeriesReady: boolean,
): boolean {
  return usesSelicOverDailyVarMode(varMode) && selicSeriesReady;
}

/** Perfis SAC que ainda alteram algo com PRONAMPE / Selic Over (só arredondamento monetário). */
export const SAC_PROFILES_ALLOWED_WITH_SELIC_OVER = new Set(['mensalTruncate']);

export function isSacProfileEnabledForVarMode(
  profileId: string,
  varMode: SimVarMode,
  selicSeriesReady: boolean,
): boolean {
  if (!usesSelicOverDailyMotor(varMode, selicSeriesReady)) return true;
  return SAC_PROFILES_ALLOWED_WITH_SELIC_OVER.has(profileId);
}

/** Com Selic Over diária, estes campos do perfil não mudam a coluna Juros. */
export function sacProfileChangesInterest(
  varMode: SimVarMode,
  selicSeriesReady: boolean,
): boolean {
  return !usesSelicOverDailyMotor(varMode, selicSeriesReady);
}
