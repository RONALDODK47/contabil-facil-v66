import type { ActiveTab } from '../types';
import { INOV_OFFICE_TOKEN, LEGACY_DEV_OFFICE_TOKEN } from '../../gestaoContabil/authContextFallback';

export type EyeVisionModuleKey = 'manager' | 'pricing' | 'gestao';

export interface EyeVisionModuleAccess {
  manager: boolean;
  pricing: boolean;
  gestao: boolean;
}

/** Abas internas do módulo Gestão Empresarial (sem importar gestaoPages — evita bundle pesado no worker). */
export type GestaoPageId =
  | 'Dashboard'
  | 'Companies'
  | 'CalendarManagement'
  | 'Exits'
  | 'Chat'
  | 'Notices'
  | 'UsefulSites'
  | 'Trash'
  | 'AppSettings'
  | 'Profile'
  | 'Novidades';

/** Abas internas do módulo Gestão Empresarial. */
export type GestaoTabAccess = Partial<Record<GestaoPageId, boolean>>;

export const GESTAO_PAGE_IDS: GestaoPageId[] = [
  'Dashboard',
  'Companies',
  'CalendarManagement',
  'Exits',
  'Chat',
  'Notices',
  'UsefulSites',
  'Trash',
  'AppSettings',
  'Profile',
  'Novidades',
];

export interface EyeVisionOfficeRecord {
  name: string;
  created_at: string;
  module_access?: EyeVisionModuleAccess;
  gestao_tab_access?: GestaoTabAccess;
}

export type EyeVisionOfficesMap = Record<string, EyeVisionOfficeRecord>;

export const EYE_VISION_MODULE_LABELS: Record<EyeVisionModuleKey, string> = {
  manager: 'Gerencial',
  pricing: 'Precificação',
  gestao: 'Gestão Empresarial',
};

export const DEFAULT_EYE_VISION_MODULE_ACCESS: EyeVisionModuleAccess = {
  manager: true,
  pricing: true,
  gestao: true,
};

export function defaultGestaoTabAccess(): GestaoTabAccess {
  const out: GestaoTabAccess = {};
  for (const id of GESTAO_PAGE_IDS) out[id] = true;
  return out;
}

export function normalizeGestaoTabAccess(raw: unknown): GestaoTabAccess {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: GestaoTabAccess = {};
  for (const id of GESTAO_PAGE_IDS) {
    out[id] = id in src ? Boolean(src[id]) : true;
  }
  return out;
}

export function getOfficeGestaoTabAccess(
  offices: EyeVisionOfficesMap,
  token: string,
): GestaoTabAccess {
  const tok = String(token || '').trim();
  if (!tok) return defaultGestaoTabAccess();
  return normalizeGestaoTabAccess(offices[tok]?.gestao_tab_access);
}

/** Permissão efetiva das abas Gestão: empresa ∩ utilizador (utilizador só restringe). */
export function resolveEffectiveGestaoTabAccess(
  officeAccess: GestaoTabAccess,
  userAccess?: GestaoTabAccess | null,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const id of GESTAO_PAGE_IDS) {
    const officeOk = officeAccess[id] !== false;
    const userOk = userAccess ? userAccess[id] !== false : true;
    if (!officeOk || !userOk) out[id] = false;
  }
  return out;
}

export function normalizeEyeVisionModuleAccess(raw: unknown): EyeVisionModuleAccess {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    manager:
      'manager' in src ? Boolean(src.manager) : DEFAULT_EYE_VISION_MODULE_ACCESS.manager,
    pricing:
      'pricing' in src ? Boolean(src.pricing) : DEFAULT_EYE_VISION_MODULE_ACCESS.pricing,
    gestao:
      'gestao' in src ? Boolean(src.gestao) : DEFAULT_EYE_VISION_MODULE_ACCESS.gestao,
  };
}

/** Permissão efetiva: empresa (obrigatório) ∩ utilizador (opcional, só restringe). */
export function resolveEffectiveModuleAccess(
  officeAccess: EyeVisionModuleAccess,
  userAccess?: EyeVisionModuleAccess | null,
): EyeVisionModuleAccess {
  if (!userAccess) return officeAccess;
  return {
    manager: officeAccess.manager && userAccess.manager,
    pricing: officeAccess.pricing && userAccess.pricing,
    gestao: officeAccess.gestao && userAccess.gestao,
  };
}

export function getOfficeModuleAccess(
  offices: EyeVisionOfficesMap,
  token: string,
): EyeVisionModuleAccess {
  const tok = String(token || '').trim();
  if (!tok) return DEFAULT_EYE_VISION_MODULE_ACCESS;
  return normalizeEyeVisionModuleAccess(offices[tok]?.module_access);
}

export function canAccessEyeVisionModule(
  access: EyeVisionModuleAccess,
  tab: ActiveTab,
  isAdmin: boolean,
): boolean {
  if (isAdmin) return true;
  if (tab === 'manager') {
    return access.manager;
  }
  if (tab === 'admin') return isAdmin;
  return true;
}

export function parseEyeVisionOffices(raw: unknown): EyeVisionOfficesMap {
  if (!raw || typeof raw !== 'object') return {};
  const out: EyeVisionOfficesMap = {};
  for (const [token, row] of Object.entries(raw as Record<string, unknown>)) {
    const tok = String(token || '').trim();
    if (!tok) continue;
    const record = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
    const name = 'name' in record ? String(record.name || '').trim() : '';
    const created_at = 'created_at' in record ? String(record.created_at || '') : '';
    out[tok] = {
      name: name || tok,
      created_at: created_at || new Date(0).toISOString(),
      module_access: normalizeEyeVisionModuleAccess(record.module_access),
      gestao_tab_access: normalizeGestaoTabAccess(record.gestao_tab_access),
    };
  }
  return out;
}

export function collectOfficeTokens(config: {
  company_access_tokens?: unknown;
  company_access_token?: unknown;
}): string[] {
  const fromArr = Array.isArray(config.company_access_tokens)
    ? config.company_access_tokens.map((x) => String(x || '').trim()).filter(Boolean)
    : [];
  const legacy = String(config.company_access_token || '').trim();
  return Array.from(new Set(legacy ? [...fromArr, legacy] : fromArr));
}

export interface EyeVisionOfficeView {
  token: string;
  name: string;
  created_at: string;
  moduleAccess: EyeVisionModuleAccess;
  gestaoTabAccess: GestaoTabAccess;
}

export function buildOfficeViews(
  config: {
    company_access_tokens?: unknown;
    company_access_token?: unknown;
    eye_vision_offices?: unknown;
  },
  tokenNameFallback?: Map<string, string>,
): EyeVisionOfficeView[] {
  const offices = parseEyeVisionOffices(config.eye_vision_offices);
  const tokens = collectOfficeTokens(config);
  return tokens
    .map((token) => {
      const meta = offices[token];
      const fallback = tokenNameFallback?.get(token);
      return {
        token,
        name: meta?.name || fallback || token,
        created_at: meta?.created_at || '',
        moduleAccess: getOfficeModuleAccess(offices, token),
        gestaoTabAccess: getOfficeGestaoTabAccess(offices, token),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
}

export interface EyeVisionStaffUser {
  email: string;
  displayName: string;
  assignedToken: string;
  isActive: boolean;
  moduleAccess: EyeVisionModuleAccess;
  effectiveModuleAccess: EyeVisionModuleAccess;
  gestaoTabAccess: GestaoTabAccess;
  effectiveGestaoTabAccess: Record<string, boolean>;
  canEditModuleAccess: boolean;
}

export function isInternalStaffClient(entry: Record<string, unknown> | null | undefined): boolean {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.is_deleted) return false;
  return String(entry.account_type || 'user').toLowerCase() !== 'client';
}

export function staffDisplayName(entry: Record<string, unknown>): string {
  return (
    String(entry.client_display_name || '').trim() ||
    String(entry.display_name || '').trim() ||
    String(entry.gc_login_username || '').trim() ||
    String(entry.email || '').trim()
  );
}

export function readStoredCompanyAccessToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    return String(localStorage.getItem('gc_company_access_token') || '').trim();
  } catch {
    return '';
  }
}

/** Nome amigável do escritório — CL-FN14… é o token operacional da INOV. */
export function resolveOfficeTokenDisplayName(
  token: string,
  offices?: EyeVisionOfficesMap,
): string {
  const tok = String(token || '').trim();
  if (!tok) return '';
  if (tok === LEGACY_DEV_OFFICE_TOKEN || tok === INOV_OFFICE_TOKEN) return 'INOV';
  const fromOffice = String(offices?.[tok]?.name || '').trim();
  if (fromOffice && fromOffice !== tok) return fromOffice;
  return tok;
}

export function formatOfficeTokenOptionLabel(token: string, offices?: EyeVisionOfficesMap): string {
  const tok = String(token || '').trim();
  if (!tok) return '';
  const name = resolveOfficeTokenDisplayName(tok, offices);
  if (!name || name === tok) return tok;
  return `${name} · ${tok}`;
}

export function resolveUserOfficeToken(
  clientEntry: { assigned_company_token?: unknown } | null | undefined,
): string {
  const fromClient = String(clientEntry?.assigned_company_token || '').trim();
  if (fromClient) return fromClient;
  return readStoredCompanyAccessToken();
}

/** Dev local: token padrão INOV quando admin ainda não definiu gc_company_access_token. */
export function resolveOfficeTokenForSession(
  clientEntry: { assigned_company_token?: unknown } | null | undefined,
): string {
  const token = resolveUserOfficeToken(clientEntry);
  if (token) return token;
  if (import.meta.env.DEV) {
    return LEGACY_DEV_OFFICE_TOKEN;
  }
  return '';
}
