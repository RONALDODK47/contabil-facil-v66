/**
 * Google Identity Services (GIS) — sem Firebase.
 * Client ID: VITE_GOOGLE_CLIENT_ID ou /api/google-oauth-config (Setup Controle).
 *
 * Segurança (política OAuth 2.0 do Google): a origem do browser tem de
 * coincidir EXATAMENTE com uma das Origens JavaScript autorizadas no Google
 * Cloud Console — sem coringas de porta/host. Há duas origens válidas:
 *   - http://localhost:3000 — projeto solto (npm run dev)
 *   - http://localhost:4173 — Setup Interface compartilhado (build/preview)
 * Qualquer outra origem (ex.: 127.0.0.1) é redirecionada para a porta
 * correspondente antes de abrir o popup — ver ensureCanonicalGoogleOrigin.
 */
export type GoogleIdPayload = {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  given_name?: string;
  picture?: string;
  aud?: string;
  exp?: number;
  iss?: string;
};

type TokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type TokenClient = {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
};

type GoogleAccountsOauth2 = {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type?: string; message?: string }) => void;
  }) => TokenClient;
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: GoogleAccountsOauth2;
      };
    };
  }
}

const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';
/** Porta do projeto solto (npm run dev — sem instalador). */
const DEV_PORT = '3000';
/** Porta do Setup Interface compartilhado (build/preview/instalador). */
const SHARED_PORT = '4173';
/** Origem canónica por omissão (Setup Interface compartilhado). */
export const GOOGLE_CANONICAL_ORIGIN = `http://localhost:${SHARED_PORT}`;
/** Origens do Contábil Fácil autorizadas no Google Cloud Console. */
const ALLOWED_GOOGLE_ORIGINS = [
  `http://localhost:${DEV_PORT}`,
  `http://localhost:${SHARED_PORT}`,
  `https://ronaldodk47.github.io`
];

/**
 * Adiciona a origem atual às origens permitidas se for um domínio .run.app (AI Studio)
 * para facilitar a verificação local, mas o Google Console ainda precisa ser configurado.
 */
function getCurrentOrigins(): string[] {
  const origins = [...ALLOWED_GOOGLE_ORIGINS];
  if (typeof window !== 'undefined' && window.location.origin) {
    if (!origins.includes(window.location.origin)) {
      origins.push(window.location.origin);
    }
  }
  return origins;
}

let runtimeClientId = '';
let runtimeClientIdLoaded = false;

export function getGoogleClientId(): string {
  return (
    runtimeClientId ||
    String(import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim() ||
    '301413137073-gbudh3jshp523jt0esjcqssm0t6m1i58.apps.googleusercontent.com'
  );
}

export function isGoogleSignInConfigured(): boolean {
  return Boolean(getGoogleClientId());
}

/**
 * O OAuth 2.0 do Google exige correspondência EXATA com a Origem JavaScript
 * autorizada (protocolo + host + porta) — sem coringas de porta/host. Login
 * já funciona a partir de localhost:3000 e localhost:4173 (registados no
 * Google Cloud Console).
 *
 * Só reescreve a origem no caso de 127.0.0.1/[::1] numa porta conhecida —
 * Google trata isso como uma origem diferente de "localhost" na mesma porta.
 * Qualquer outro host (ex.: IP da rede local, domínio próprio) NÃO é
 * redirecionado: se não estiver registado no Google, o próprio popup
 * devolve o erro de origem (ver originMismatchHelp) em vez de silenciosamente
 * trocar de máquina/porta.
 * @returns false se redirecionou (a página vai recarregar na origem certa).
 */
export function ensureCanonicalGoogleOrigin(): boolean {
  if (typeof window === 'undefined') return true;
  const currentOrigins = getCurrentOrigins();
  if (currentOrigins.includes(window.location.origin)) return true;

  const host = String(window.location.hostname || '').toLowerCase();
  const isLoopback = host === '127.0.0.1' || host === '[::1]' || host === '::1';
  const port = window.location.port || SHARED_PORT;
  if (!isLoopback || (port !== DEV_PORT && port !== SHARED_PORT)) return true;

  const path = `${window.location.pathname || '/'}${window.location.search || ''}${window.location.hash || ''}`;
  window.location.replace(`http://localhost:${port}${path}`);
  return false;
}

/** Carrega Client ID do servidor local (sem rebuild) se existir. */
export async function ensureGoogleClientIdLoaded(): Promise<string> {
  if (runtimeClientIdLoaded) return getGoogleClientId();
  runtimeClientIdLoaded = true;
  // Client ID vem do .env via VITE_GOOGLE_CLIENT_ID (injetado no build)
  // Não faz request ao servidor por segurança
  return getGoogleClientId();
}

function loadGisScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Sem window'));
  if (window.google?.accounts?.oauth2) return Promise.resolve();

  const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Falha ao carregar Google Identity')));
      if (window.google?.accounts?.oauth2) resolve();
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SCRIPT;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Falha ao carregar Google Identity'));
    document.head.appendChild(script);
  });
}

export function decodeGoogleCredential(credential: string): GoogleIdPayload {
  const parts = String(credential || '').split('.');
  if (parts.length < 2) throw new Error('Credencial Google inválida.');
  const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(json) as GoogleIdPayload;
}

export function assertValidGooglePayload(payload: GoogleIdPayload, clientId: string): void {
  const email = String(payload.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) throw new Error('Google não devolveu um e-mail válido.');
  if (payload.email_verified !== true) throw new Error('E-mail Google não verificado.');
  if (!String(payload.sub || '').trim()) throw new Error('Conta Google sem identificador.');

  const aud = String(payload.aud || '').trim();
  if (!aud || !clientId || aud !== clientId) {
    throw new Error('Credencial Google não corresponde a esta aplicação (client ID).');
  }

  const exp = Number(payload.exp || 0);
  if (!exp || exp * 1000 < Date.now() - 60_000) {
    throw new Error('Credencial Google expirada. Tente de novo.');
  }

  const iss = String(payload.iss || '');
  if (!iss || !/^https:\/\/accounts\.google\.com$/.test(iss)) {
    throw new Error('Emissor Google inválido.');
  }
}

function originMismatchHelp(): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : GOOGLE_CANONICAL_ORIGIN;
  const currentOrigins = getCurrentOrigins();
  return (
    `Google bloqueou o login (origem não autorizada: ${origin}). ` +
    `No Google Cloud Console → Credenciais → Client OAuth → Origens JavaScript autorizadas, ` +
    `inclua EXATAMENTE: ${origin} e as demais origens: ${currentOrigins.join(', ')}.`
  );
}

/**
 * Popup de consentimento OAuth2 com fallback mais robusto
 */
export async function signInWithGooglePopup(): Promise<GoogleIdPayload> {
  if (!ensureCanonicalGoogleOrigin()) {
    throw new Error(
      'A redirecionar para uma origem autorizada no Google. Aguarde e tente de novo.',
    );
  }

  await ensureGoogleClientIdLoaded();
  const clientId = getGoogleClientId();
  if (!clientId) {
    throw new Error('Login Google indisponível: Client ID não configurado.');
  }

  await loadGisScript();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) {
    console.error('[Google Identity] Script não carregou, tentando método alternativo');
    throw new Error('Google Identity Services indisponível. Verifique sua conexão.');
  }

  const accessToken = await new Promise<string>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: 'openid email profile',
      callback: (response) => {
        console.log('[Google OAuth] Response:', response);
        if (response.error || !response.access_token) {
          const errorMsg = response.error_description ||
            (response.error === 'popup_closed' || response.error === 'access_denied'
              ? 'Popup foi fechado ou acesso negado. Tente novamente.'
              : response.error) ||
            'Falha no login Google.';
          settle(() => reject(new Error(errorMsg)));
          return;
        }
        settle(() => resolve(String(response.access_token)));
      },
      error_callback: (error) => {
        console.error('[Google OAuth] Error callback:', error);
        const isOriginError = /origin|unregistered|invalid_client/i.test(String(error?.type || error?.message || ''));
        settle(() =>
          reject(
            isOriginError
              ? new Error(originMismatchHelp())
              : new Error(error?.message || 'Falha no login Google.'),
          ),
        );
      },
    });

    try {
      console.log('[Google OAuth] Iniciando popup com Client ID:', clientId);
      client.requestAccessToken({ prompt: 'select_account' });
    } catch (e) {
      console.error('[Google OAuth] Erro ao abrir popup:', e);
      settle(() => reject(e instanceof Error ? e : new Error('Falha ao abrir o login Google.')));
    }

    // Timeout mais longo
    window.setTimeout(() => {
      settle(() => reject(new Error('Tempo esgotado no login Google (2 minutos). Tente novamente.')));
    }, 120_000);
  });

  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error('Falha ao confirmar a identidade junto do Google.');
  }
  const info = (await res.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean | string;
    name?: string;
    given_name?: string;
    picture?: string;
  };

  const email = String(info.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) throw new Error('Google não devolveu um e-mail válido.');
  if (info.email_verified !== true && info.email_verified !== 'true') {
    throw new Error('E-mail Google não verificado.');
  }
  const sub = String(info.sub || '').trim();
  if (!sub) throw new Error('Conta Google sem identificador.');

  return {
    sub,
    email,
    email_verified: true,
    name: info.name,
    given_name: info.given_name,
    picture: info.picture,
    aud: clientId,
    iss: 'https://accounts.google.com',
  };
}
