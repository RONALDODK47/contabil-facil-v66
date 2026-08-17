import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { signInWithGooglePopup } from './googleIdentity';

export const COMPANY_ACCESS_TOKEN_KEY = 'gc_company_access_token';

/** Token padrão do escritório INOV — dados operacionais ficam neste token. */
export const INOV_OFFICE_TOKEN = String(
  import.meta.env.VITE_DEFAULT_OFFICE_TOKEN || 'INOV',
).trim();

/** Token legado de desenvolvimento (migrar dados para INOV quando vazio). */
export const LEGACY_DEV_OFFICE_TOKEN = String(
  import.meta.env.VITE_DEV_OFFICE_TOKEN || 'CL-FN14-AZ4ZV81Y',
).trim();
export const SESSION_SECURITY_CACHE_KEY = 'gc_session_security_cache';
export const LAST_GC_IDENTIFIER_KEY = 'gc_last_identifier';
export const EMPRESA_PORTAL_GUEST_KEY = 'gc_empresa_portal_guest';
export const EMPRESA_PORTAL_COMPANY_ID_KEY = 'gc_empresa_portal_company_id';
export const EMPRESA_PORTAL_INVITE_TOKEN_KEY = 'gc_empresa_portal_invite_token';
export const EMPRESA_PORTAL_SLUG_KEY = 'gc_empresa_portal_slug';

const SESSION_KEY = 'gc_auth_session_v1';
const USERS_KEY = 'gc_auth_users_v1';

type AuthError = { message: string; code: string } | null;

type AuthUser = {
  uid: string;
  email: string;
  display_name?: string;
};

type StoredUser = {
  email: string;
  password: string;
  display_name: string; // Agora obrigatório
};

// AUTENTICAÇÃO LOCAL APENAS - SEM FIREBASE
// localStorage é a única fonte de verdade

type AuthContextValue = {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoadingAuth: boolean;
  isLoggingIn: boolean;
  authError: AuthError;
  setAuthError: (error: AuthError) => void;
  loginWithGoogle: (companyToken: string) => Promise<void>;
  loginWithEmailPassword: (identifier: string, password: string, companyToken: string) => Promise<void>;
  registerWithEmailPassword: (
    email: string,
    password: string,
    _companyToken: string,
    username?: string,
  ) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  logout: () => Promise<void>;
};

const ADMIN_EMAILS = new Set([
  'ronaldojunior.gyn@gmail.com',
  'ronaldo.silva@inovssc.com.br',
  'ronaldojunior.gyn@usuario.local',
  'ronaldojunior.gyn.emergencia@usuario.local',
]);

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * NOTA IMPORTANTE: Este sistema usa APENAS autenticação local com localStorage.
 * Nenhuma chamada ao Firebase é realizada.
 * Todos os dados de utilizador são armazenados no navegador do cliente.
 */

/** Restaura empresas do Docker ou pasta local após login */
async function restoreOfficesFromDockerOrLocal(officeToken: string): Promise<void> {
  try {
    // Tentar restaurar do Docker primeiro
    const dockerRes = await fetch(`/api/agent/sync/docker/load/${officeToken}`, {
      method: 'GET',
    });

    if (dockerRes.ok) {
      const data = await dockerRes.json();
      if (data.ok && data.office) {
        console.log(`[AUTH] Empresas restauradas do Docker para ${officeToken}`);
        // Dispatch evento para recarregar dados na aplicação
        window.dispatchEvent(
          new CustomEvent('offices-restored', {
            detail: { office: data.office, managers: data.managers },
          })
        );
        return;
      }
    }
  } catch (err) {
    console.warn('[AUTH] Docker indisponível, tentando pasta local:', err);
  }

  // Fallback: tentar restaurar de pasta local
  try {
    const localRes = await fetch(`/api/agent/sync/pasta-local/load/${officeToken}`);
    if (localRes.ok) {
      const data = await localRes.json();
      if (data.ok && data.office) {
        console.log(`[AUTH] Empresas restauradas da Pasta Local para ${officeToken}`);
        window.dispatchEvent(
          new CustomEvent('offices-restored', {
            detail: { office: data.office, managers: data.managers },
          })
        );
      }
    }
  } catch (err) {
    console.warn('[AUTH] Pasta local também indisponível:', err);
  }
}

function readUsers(): Record<string, StoredUser> {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, StoredUser>) : {};
  } catch {
    return {};
  }
}

function writeUsers(users: Record<string, StoredUser>): void {
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  } catch {
    /* ignore */
  }
}

function normalizeEmail(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function buildUid(email: string): string {
  return `uid_${email.replace(/[^a-z0-9]/gi, '_')}`;
}

/** Procura usuário por email OU nome de utilizador */
function findUserByEmailOrUsername(
  users: Record<string, StoredUser>,
  identifier: string,
): StoredUser | null {
  const normalizedId = String(identifier || '').trim().toLowerCase();

  // Tenta por email primeiro
  if (users[normalizedId]) {
    return users[normalizedId];
  }

  // Tenta por nome de utilizador
  for (const user of Object.values(users)) {
    if (user.display_name.toLowerCase() === normalizedId) {
      return user;
    }
  }

  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authError, setAuthError] = useState<AuthError>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.email) {
          setUser({
            uid: String(parsed.uid || buildUid(String(parsed.email))),
            email: normalizeEmail(String(parsed.email)),
            display_name: String(parsed.display_name || ''),
          });
          setIsLoadingAuth(false);
          return;
        }
      }
    } catch (error) {
      console.error('Erro ao restaurar sessão:', error);
    }

    // Sem sessão salva: exige login real (email/senha ou Google) — cada pessoa
    // tem seus próprios dados no Docker, isolados pelo token/email de login.
    setIsLoadingAuth(false);
  }, []);

  const loginWithEmailPassword = async (
    identifier: string,
    password: string,
    companyToken: string,
  ): Promise<void> => {
    const normalizedId = String(identifier || '').trim().toLowerCase();
    const pass = String(password || '');
    const token = String(companyToken || '').trim();

    setIsLoggingIn(true);
    setAuthError(null);
    try {
      if (!normalizedId || !pass) {
        setAuthError({ message: 'Informe nome/email e palavra-passe.', code: 'auth/invalid-credentials' });
        return;
      }

      const isAdmin = ADMIN_EMAILS.has(normalizedId);
      const users = readUsers();

      // Procura por email OU nome de utilizador
      const registeredUser = findUserByEmailOrUsername(users, normalizedId);

      if (!isAdmin) {
        // Para usuários normais: validar conta + senha + token
        if (!registeredUser) {
          setAuthError({ message: 'Utilizador não encontrado.', code: 'auth/user-not-found' });
          return;
        }
        if (registeredUser.password !== pass) {
          setAuthError({ message: 'Palavra-passe inválida.', code: 'auth/wrong-password' });
          return;
        }
      }

      // Detecta se é admin
      const adminEmail = isAdmin ? normalizedId : null;
      const userEmail = registeredUser?.email || adminEmail || normalizedId;
      // Sem token informado, usa o próprio e-mail como identificador — cada
      // pessoa fica com os dados isolados no Docker pelo seu login, sem
      // precisar digitar um token manualmente (mesmo comportamento do Google).
      const effectiveToken = token || userEmail;

      const nextUser: AuthUser = {
        uid: buildUid(userEmail),
        email: userEmail,
        display_name: registeredUser?.display_name || userEmail.split('@')[0] || 'utilizador',
      };

      setUser(nextUser);
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(nextUser));
        localStorage.setItem(COMPANY_ACCESS_TOKEN_KEY, effectiveToken);
      } catch {
        /* ignore */
      }

      // 🔄 Restaurar dados desta pessoa (Docker ou pasta local) após login
      try {
        await restoreOfficesFromDockerOrLocal(effectiveToken);
      } catch (err) {
        console.warn('[AUTH] Falha ao restaurar empresas:', err instanceof Error ? err.message : err);
      }

      window.dispatchEvent(new Event('gc-company-token-changed'));
    } catch (err) {
      console.error('[AUTH] loginWithEmailPassword error:', err);
      setAuthError({
        message: `Erro ao entrar: ${err instanceof Error ? err.message : 'Erro desconhecido'}`,
        code: 'auth/login-error',
      });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const loginWithGoogle = async (companyToken: string): Promise<void> => {
    setIsLoggingIn(true);
    setAuthError(null);
    try {
      const googlePayload = await signInWithGooglePopup();

      const userEmail = googlePayload.email;
      // Usar o email como token do office — dados vinculados diretamente ao email
      const emailAsToken = userEmail;
      const nextUser: AuthUser = {
        uid: googlePayload.sub || buildUid(userEmail),
        email: userEmail,
        display_name: googlePayload.name || userEmail.split('@')[0],
      };

      setUser(nextUser);
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(nextUser));
        localStorage.setItem(COMPANY_ACCESS_TOKEN_KEY, emailAsToken);
      } catch {
        /* ignore */
      }

      // 🔄 Restaurar empresas do email após login com sucesso
      try {
        await restoreOfficesFromDockerOrLocal(emailAsToken);
      } catch (err) {
        console.warn('[AUTH] Falha ao restaurar empresas:', err instanceof Error ? err.message : err);
        // Não falha o login, só avisa
      }

      window.dispatchEvent(new Event('gc-company-token-changed'));
    } catch (err) {
      console.error('[AUTH] loginWithGoogle error:', err);
      setAuthError({
        message: err instanceof Error ? err.message : 'Falha ao entrar com a conta Google.',
        code: 'auth/google-login-error',
      });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const registerWithEmailPassword = async (
    emailRaw: string,
    passwordRaw: string,
    _companyToken: string,
    username?: string,
  ): Promise<void> => {
    const email = normalizeEmail(emailRaw);
    const password = String(passwordRaw || '').trim();
    const displayName = String(username || '').trim();

    setIsLoggingIn(true);
    setAuthError(null);
    try {
      // Validar campos obrigatórios
      if (!email) {
        setAuthError({ message: 'Informe o e-mail.', code: 'auth/invalid-email' });
        return;
      }
      if (!password) {
        setAuthError({ message: 'Informe a palavra-passe.', code: 'auth/invalid-password' });
        return;
      }
      if (!displayName) {
        setAuthError({ message: 'Informe o nome de utilizador.', code: 'auth/invalid-username' });
        return;
      }

      const users = readUsers();

      // Verificar se email já existe
      if (users[email]) {
        setAuthError({ message: 'Este e-mail já está registado.', code: 'auth/email-already-in-use' });
        return;
      }

      // Verificar se nome de utilizador já existe
      for (const user of Object.values(users)) {
        if (user.display_name.toLowerCase() === displayName.toLowerCase()) {
          setAuthError({ message: 'Este nome de utilizador já existe.', code: 'auth/username-taken' });
          return;
        }
      }

      // Registrar novo utilizador
      users[email] = { email, password, display_name: displayName };
      writeUsers(users);
      setAuthError({
        message: 'Conta registada com sucesso. Entre com suas credenciais.',
        code: 'auth/registration-success',
      });
    } catch (err) {
      console.error('[AUTH] registerWithEmailPassword error:', err);
      setAuthError({
        message: `Erro ao registar: ${err instanceof Error ? err.message : 'Erro desconhecido'}`,
        code: 'auth/registration-error',
      });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const requestPasswordReset = async (emailRaw: string): Promise<void> => {
    const email = normalizeEmail(emailRaw);
    setIsLoggingIn(true);
    setAuthError(null);
    try {
      if (!email) {
        setAuthError({ message: 'Informe o e-mail da conta.', code: 'auth/invalid-email' });
        return;
      }
      setAuthError({
        message: 'Pedido registado. No fallback local, redefina a senha pelo registo da conta.',
        code: 'auth/reset-sent',
      });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const logout = async (): Promise<void> => {
    setUser(null);
    setAuthError(null);
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isLoadingAuth,
      isLoggingIn,
      authError,
      setAuthError,
      loginWithGoogle,
      loginWithEmailPassword,
      registerWithEmailPassword,
      requestPasswordReset,
      logout,
    }),
    [authError, isLoadingAuth, isLoggingIn, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
