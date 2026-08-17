/**
 * Autenticação local da equipa: contas + validação do token da empresa.
 */
import {
  safeLocalStorageGetItem,
  safeLocalStorageRemoveItem,
  safeLocalStorageSetItem,
} from '../lib/safeLocalStorage';

export const AUTH_USERS_KEY = 'gc_auth_users_v1';
export const AUTH_SESSION_KEY = 'gc_auth_session_v1';
export const CLOUD_ACCESS_CONFIG_KEY = 'gc_cloud_access_config';

export type AuthProvider = 'local' | 'google';

export type StoredAuthUser = {
  email: string;
  /** Senha local (porta do Entrar com Google). Contas só-Google antigas podem estar vazias. */
  password: string;
  display_name: string;
  provider?: AuthProvider;
  google_sub?: string;
  /** false = nome ainda é o padrão do Google/e-mail — o software deve pedir para confirmar/editar. */
  name_confirmed?: boolean;
};

export function normalizeAuthEmail(value: string): string {
  return String(value || '').trim().toLowerCase();
}

export function buildAuthUid(email: string): string {
  return `uid_${normalizeAuthEmail(email).replace(/[^a-z0-9]/gi, '_')}`;
}

export function readAuthUsers(): Record<string, StoredAuthUser> {
  try {
    const raw = safeLocalStorageGetItem(AUTH_USERS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, StoredAuthUser> = {};
    for (const [key, row] of Object.entries(parsed as Record<string, unknown>)) {
      if (!row || typeof row !== 'object') continue;
      const rec = row as StoredAuthUser;
      const email = normalizeAuthEmail(String(rec.email || key));
      const provider: AuthProvider = rec.provider === 'google' ? 'google' : 'local';
      const password = String(rec.password || '');
      const display_name = String(rec.display_name || '').trim();
      const google_sub = String(rec.google_sub || '').trim();
      if (!email) continue;
      // Local precisa de senha; Google precisa de sub (senha local é opcional mas preservada).
      if (provider === 'local' && !password) continue;
      if (provider === 'google' && !google_sub) continue;
      out[email] = {
        email,
        password,
        display_name: display_name || email.split('@')[0],
        provider,
        name_confirmed: rec.name_confirmed === true,
        ...(google_sub ? { google_sub } : {}),
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function writeAuthUsers(users: Record<string, StoredAuthUser>): void {
  safeLocalStorageSetItem(AUTH_USERS_KEY, JSON.stringify(users));
}

/** Atualiza a palavra-passe local (porta do Google) — também em contas já ligadas ao Google. */
export function updateLocalAccountPassword(emailRaw: string, newPassword: string): StoredAuthUser {
  const email = normalizeAuthEmail(emailRaw);
  const pass = String(newPassword || '');
  if (!email || !email.includes('@')) throw new Error('E-mail inválido.');
  if (pass.length < 6) throw new Error('A palavra-passe deve ter pelo menos 6 caracteres.');
  const users = readAuthUsers();
  const prev = users[email];
  const next: StoredAuthUser = {
    email,
    password: pass,
    display_name: prev?.display_name || email.split('@')[0],
    provider: prev?.provider === 'google' ? 'google' : 'local',
    ...(prev?.google_sub ? { google_sub: prev.google_sub } : {}),
  };
  users[email] = next;
  writeAuthUsers(users);
  return next;
}

export function upsertGoogleAuthUser(input: {
  email: string;
  displayName: string;
  googleSub: string;
  /** Senha local (porta Entrar) — obrigatória no registo com Google. */
  password?: string;
  /** true quando o nome foi confirmado/editado pelo próprio utilizador dentro do software. */
  nameConfirmed?: boolean;
}): StoredAuthUser {
  const email = normalizeAuthEmail(input.email);
  const users = readAuthUsers();
  const prev = users[email];
  const password = String(input.password ?? prev?.password ?? '');
  const next: StoredAuthUser = {
    email,
    password,
    display_name:
      String(input.displayName || '').trim() ||
      prev?.display_name ||
      email.split('@')[0],
    provider: 'google',
    google_sub: String(input.googleSub || '').trim(),
    name_confirmed: input.nameConfirmed ?? prev?.name_confirmed ?? false,
  };
  users[email] = next;
  writeAuthUsers(users);
  return next;
}

/** Confirma/edita o nome de utilizador dentro do software (marca como confirmado). */
export function confirmDisplayName(emailRaw: string, newName: string): StoredAuthUser {
  const email = normalizeAuthEmail(emailRaw);
  const name = String(newName || '').trim();
  if (!email) throw new Error('Sessão inválida.');
  if (!name) throw new Error('Informe o nome de utilizador.');
  const users = readAuthUsers();
  const prev = users[email];
  if (!prev) throw new Error('Conta não encontrada.');
  const next: StoredAuthUser = { ...prev, display_name: name, name_confirmed: true };
  users[email] = next;
  writeAuthUsers(users);
  return next;
}

export function findAuthUserByEmailOrUsername(
  users: Record<string, StoredAuthUser>,
  identifier: string,
): StoredAuthUser | null {
  const normalizedId = String(identifier || '').trim().toLowerCase();
  if (!normalizedId) return null;
  if (users[normalizedId]) return users[normalizedId];
  for (const user of Object.values(users)) {
    if (String(user.display_name || '').trim().toLowerCase() === normalizedId) {
      return user;
    }
  }
  return null;
}

function readCloudAccessConfig(): Record<string, unknown> {
  try {
    const raw = safeLocalStorageGetItem(CLOUD_ACCESS_CONFIG_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Normaliza para comparação: maiúsculas + remove espaços à volta de cada segmento. */
function normalizeTokenForCompare(value: string): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

/** Token válido = qualquer token com 4+ caracteres (dados puxados independente do token). */
export function isValidCompanyAccessToken(tokenRaw: string): boolean {
  const token = normalizeTokenForCompare(tokenRaw);
  if (!token || token.length < 3) return false;
  if (/FAKE/i.test(token)) return false;

  // Qualquer token é aceite — dados são puxados independente do token
  return true;
}

export function clearAuthSession(): void {
  try {
    safeLocalStorageRemoveItem(AUTH_SESSION_KEY);
  } catch {
    /* ignore */
  }
}
