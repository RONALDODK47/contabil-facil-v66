/**
 * Ponto único de importação do auth da Gestão — evita duas instâncias do React Context.
 * Use isto em todo o Eye Vision (ContabilFacil); páginas @gestao usam @/lib/AuthContext.
 *
 * NOTA: Usando authContextFallback.tsx local (autenticação sem Firebase) ao invés do vendor @gestao/lib/AuthContext.
 * O vendor AuthContext usa Firebase que foi desativado para simplificar.
 */
export {
  AuthProvider,
  useAuth,
  COMPANY_ACCESS_TOKEN_KEY,
  INOV_OFFICE_TOKEN,
  LAST_GC_IDENTIFIER_KEY,
} from './authContextFallback';

// Re-exports para compatibilidade
export const SESSION_SECURITY_CACHE_KEY = 'gc_session_security_settings';
export const EMPRESA_PORTAL_GUEST_KEY = 'gc_empresa_portal_guest';
export const EMPRESA_PORTAL_COMPANY_ID_KEY = 'gc_empresa_portal_company_id';
export const EMPRESA_PORTAL_INVITE_TOKEN_KEY = 'gc_empresa_portal_invite_token';
export const EMPRESA_PORTAL_SLUG_KEY = 'gc_empresa_portal_public_slug';
