/**
 * Garante token INOV no config cloud e migra token legado → INOV (admin, uma vez).
 */
import { dbClient } from '../../gestaoContabil/dbClientFallback';
import {
  apiCloneOfficeWorkspace,
  apiMergeOfficeManagerSuffixes,
  postgresEyeVisionWorkspace,
} from '../../gestaoContabil/dbClientPostgres';
import { COMPANY_ACCESS_TOKEN_KEY, INOV_OFFICE_TOKEN, LEGACY_DEV_OFFICE_TOKEN } from '../../gestaoContabil/authContextFallback';
import {
  parseEyeVisionOffices,
  readStoredCompanyAccessToken,
} from './eyeVisionAdmin';

const INOV_BOOTSTRAP_KEY = 'eye_vision_inov_bootstrap_v1';

function wasInovBootstrapped(): boolean {
  try {
    return localStorage.getItem(INOV_BOOTSTRAP_KEY) === '1';
  } catch {
    return false;
  }
}

function markInovBootstrapped(): void {
  try {
    // ⚠️ DISABLED: localStorage ZERO writes (QuotaExceededError)
  } catch {
    /* ignore */
  }
}

export async function ensureInovOfficeForAdmin(adminUid: string): Promise<void> {
  const uid = String(adminUid || '').trim();
  if (!uid) return;

  const cfg = await dbClient.entities.CloudAccessControl.getConfig();
  const prevTokens = Array.isArray(cfg?.company_access_tokens)
    ? cfg.company_access_tokens.map((x: string) => String(x || '').trim()).filter(Boolean)
    : [];
  const legacy = String(cfg?.company_access_token || '').trim();
  const tokenSet = new Set([...prevTokens, ...(legacy ? [legacy] : [])]);
  const offices = parseEyeVisionOffices(cfg?.eye_vision_offices);

  let configChanged = false;
  if (!tokenSet.has(INOV_OFFICE_TOKEN)) {
    tokenSet.add(INOV_OFFICE_TOKEN);
    configChanged = true;
  }
  if (!offices[INOV_OFFICE_TOKEN]) {
    offices[INOV_OFFICE_TOKEN] = {
      name: 'INOV',
      created_at: new Date().toISOString(),
      module_access: { manager: true, pricing: true, gestao: true },
    };
    configChanged = true;
  }

  if (configChanged) {
    await dbClient.entities.CloudAccessControl.updateConfig({
      adminUid: uid,
      patch: {
        company_access_tokens: Array.from(tokenSet),
        eye_vision_offices: offices,
      },
    });
  }

  const stored = readStoredCompanyAccessToken();
  if (!stored) {
    try {
      // ⚠️ DISABLED: localStorage ZERO writes (QuotaExceededError)
      window.dispatchEvent(new CustomEvent('gc-company-token-changed'));
    } catch {
      /* ignore */
    }
  }

  try {
    await postgresEyeVisionWorkspace.getOffice(INOV_OFFICE_TOKEN);
  } catch {
    /* backend offline — provision ocorre na primeira requisição válida */
  }

  if (!wasInovBootstrapped() && LEGACY_DEV_OFFICE_TOKEN !== INOV_OFFICE_TOKEN) {
    try {
      await apiCloneOfficeWorkspace(LEGACY_DEV_OFFICE_TOKEN, INOV_OFFICE_TOKEN, uid);
    } catch {
      /* sem dados legados, rota indisponível ou backend offline */
    }
    markInovBootstrapped();
  }

  if (LEGACY_DEV_OFFICE_TOKEN !== INOV_OFFICE_TOKEN) {
    try {
      await apiMergeOfficeManagerSuffixes(INOV_OFFICE_TOKEN, LEGACY_DEV_OFFICE_TOKEN, uid);
      await apiMergeOfficeManagerSuffixes(LEGACY_DEV_OFFICE_TOKEN, INOV_OFFICE_TOKEN, uid);
    } catch {
      /* backend offline — hydrate tenta preencher sufixos ausentes */
    }
  }
}
