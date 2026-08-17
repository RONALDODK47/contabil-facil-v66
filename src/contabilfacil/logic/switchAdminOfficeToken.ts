/**
 * Troca o token de escritório (somente admin) e recarrega os dados isolados por token.
 */
import { COMPANY_ACCESS_TOKEN_KEY } from '../../gestaoContabil/authContextFallback';
import { flushAllEyeVisionPersistence } from './eyeVisionPersistenceFlush';
import { clearEyeVisionOperationalLocalStorage } from '../../lib/simuladorFullBackup';
import { invalidateManagerDataCache } from './companyWorkspace';

export async function switchAdminOfficeToken(nextToken: string): Promise<void> {
  const tok = String(nextToken || '').trim();
  if (!tok) throw new Error('Informe o token da empresa.');

  await flushAllEyeVisionPersistence();
  clearEyeVisionOperationalLocalStorage();
  invalidateManagerDataCache();

  try {
    // ⚠️ DISABLED: localStorage ZERO writes (QuotaExceededError)
    void tok;
    window.dispatchEvent(new CustomEvent('gc-company-token-changed'));
  } catch {
    throw new Error('Não foi possível gravar o token da empresa.');
  }

  window.location.reload();
}
