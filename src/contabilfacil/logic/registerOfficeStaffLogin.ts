/**
 * Ao fazer login com o token da empresa, vincula o utilizador a essa empresa
 * para aparecer em "Utilizador específico" / "Selecionar pessoas" no Setup Controle.
 */
import { dbClient } from '../../gestaoContabil/dbClientFallback';
import { reportStaffLoginToControle } from '../../gestaoContabil/empresasCatalogoSync';
import { safeLocalStorageSetItem } from '../../lib/safeLocalStorage';
import { COMPANY_ACCESS_TOKEN_KEY } from '../../gestaoContabil/authContextFallback';

export async function registerOfficeStaffLogin(params: {
  email: string;
  displayName?: string;
  accessToken: string;
  uid: string;
}): Promise<void> {
  const email = String(params.email || '').trim().toLowerCase();
  const accessToken = String(params.accessToken || '').trim();
  const uid = String(params.uid || '').trim();
  const displayName = String(params.displayName || '').trim() || email.split('@')[0];
  if (!email || !accessToken || !uid) return;

  try {
    safeLocalStorageSetItem(COMPANY_ACCESS_TOKEN_KEY, accessToken);
  } catch {
    /* ignore */
  }

  try {
    await dbClient.entities.CloudAccessControl.upsertClient({
      adminUid: uid,
      email,
      patch: {
        email,
        account_type: 'user',
        assigned_company_token: accessToken,
        display_name: displayName,
        is_active: true,
        last_login_at: new Date().toISOString(),
      },
    });
    window.dispatchEvent(new Event('gc-cloud-access-config-changed'));
    window.dispatchEvent(new Event('gc-company-token-changed'));
  } catch (err) {
    console.warn('[registerOfficeStaffLogin]', err);
  }

  // Setup Controle (outra origem/porta) precisa da mesma lista.
  reportStaffLoginToControle({ email, displayName, accessToken });
}
