/**
 * Ponte Eye Vision → Gestão Contábil: admin vê o escritório inteiro (não só bootstrap).
 * Versão simplificada para autenticação local (sem vendor Firebase).
 */
import { useAuth } from './gestaoAuth';

export const CLOUD_ADMIN_EMAIL = 'ronaldojunior.gyn@gmail.com';

/**
 * Objeto que responde `true` para qualquer chave/`in` — usado como tabAccess/
 * tabEditAccess. As páginas (Notices.jsx, CalendarManagement.jsx, UsefulSites.jsx)
 * checam `tabAccess.NomePagina` diretamente; um `{}` fixo nunca tem essas chaves e
 * bloqueava a tela ("Acesso restrito") mesmo para o admin local único desta app.
 */
const ALL_TAB_ACCESS: Record<string, boolean> = new Proxy(
  {},
  { get: () => true, has: () => true },
);

/**
 * Hook simplificado para acesso em nuvem (local auth)
 * Retorna permissões básicas sem depender do Firestore/Firebase do vendor
 */
export function useCloudAccess() {
  const { user } = useAuth();

  const isAdminEmail = user?.email === CLOUD_ADMIN_EMAIL;
  const hasToken = Boolean(typeof localStorage !== 'undefined' && localStorage.getItem('gc_company_access_token'));
  const officeToken = String(
    (typeof localStorage !== 'undefined' && localStorage.getItem('gc_company_access_token')) || '',
  ).trim();

  return {
    isLoading: false,
    isAdminEmail,
    companyTokenOk: hasToken || isAdminEmail, // Admin não precisa de token
    internalStaffFullAccess: isAdminEmail,
    isMasterUser: isAdminEmail,
    canUseSystem: true,
    canEditCompanyTasks: isAdminEmail,
    canCreateCompanies: isAdminEmail,
    canCreateCompanyTasks: isAdminEmail,
    canEditCalendar: isAdminEmail,
    canSeeAppSettings: isAdminEmail,
    canEditOfficeBranding: isAdminEmail,
    hasOfficeCalendarAccess: isAdminEmail,
    /** Simplificado: admin edita tudo, demais usuários locais são só-leitura. */
    canEditTab: (_pageKey?: string) => isAdminEmail,
    canAccessPage: (_pageKey?: string) => true,
    tabAccess: ALL_TAB_ACCESS,
    tabEditAccess: ALL_TAB_ACCESS,
    currentCompanyId: officeToken,
    officeToken,
    activeOfficeToken: officeToken,
    officeDisplayName: '',
    config: {},
    clientEntry: null,
    isPortalClient: false,
    empresaPortalSession: null,
    requiredCompanyTokens: [] as string[],
  };
}
