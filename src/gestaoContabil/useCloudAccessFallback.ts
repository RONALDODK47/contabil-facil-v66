import { useEffect, useMemo, useState } from 'react';
import { COMPANY_ACCESS_TOKEN_KEY } from './authContextFallback';
import { useAuth } from './gestaoAuth';
type GenericRecord = Record<string, unknown>;

const ADMIN_EMAILS = new Set([
  'ronaldojunior.gyn@gmail.com',
  'ronaldo.silva@inovssc.com.br',
  'ronaldojunior.gyn@usuario.local',
  'ronaldojunior.gyn.emergencia@usuario.local',
]);

function readJsonStorage(key: string): GenericRecord {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as GenericRecord) : {};
  } catch {
    return {};
  }
}

function normalizeTokenList(config: GenericRecord): string[] {
  const fromList = Array.isArray(config.company_access_tokens)
    ? config.company_access_tokens
    : [];
  const fromSingle = String(config.company_access_token || '').trim();
  const set = new Set(
    fromList.map((value) => String(value || '').trim()).filter(Boolean),
  );
  if (fromSingle) set.add(fromSingle);
  return Array.from(set);
}

export function useCloudAccess() {
  const { user, isLoadingAuth } = useAuth();
  const [companyToken, setCompanyToken] = useState(() => {
    try {
      return String(localStorage.getItem(COMPANY_ACCESS_TOKEN_KEY) || '').trim();
    } catch {
      return '';
    }
  });
  const [config, setConfig] = useState<GenericRecord>(() =>
    readJsonStorage('gc_cloud_access_config'),
  );

  useEffect(() => {
    const syncFromStorage = () => {
      try {
        setCompanyToken(String(localStorage.getItem(COMPANY_ACCESS_TOKEN_KEY) || '').trim());
      } catch {
        setCompanyToken('');
      }
      setConfig(readJsonStorage('gc_cloud_access_config'));
    };

    window.addEventListener('storage', syncFromStorage);
    window.addEventListener('gc-company-token-changed', syncFromStorage);
    return () => {
      window.removeEventListener('storage', syncFromStorage);
      window.removeEventListener('gc-company-token-changed', syncFromStorage);
    };
  }, []);

  const email = String(user?.email || '').trim().toLowerCase();
  const isAdminEmail = ADMIN_EMAILS.has(email);
  const requiredCompanyTokens = useMemo(() => normalizeTokenList(config), [config]);

  // Dados são puxados independente do token — acesso sempre liberado
  const companyTokenOk = true;

  const tabAccess = useMemo(() => {
    if (isAdminEmail) return {};

    const offices =
      config?.eye_vision_offices && typeof config.eye_vision_offices === 'object'
        ? (config.eye_vision_offices as GenericRecord)
        : {};
    const officeRow =
      companyToken && typeof offices[companyToken] === 'object'
        ? (offices[companyToken] as GenericRecord)
        : null;

    const officeTabsRaw = officeRow?.gestao_tab_access;
    const officeTabs: Record<string, boolean> = {};
    if (officeTabsRaw && typeof officeTabsRaw === 'object') {
      for (const [key, value] of Object.entries(officeTabsRaw as GenericRecord)) {
        officeTabs[key] = Boolean(value);
      }
    }

    const clients =
      config?.clients && typeof config.clients === 'object'
        ? (config.clients as GenericRecord)
        : {};
    const userRow = email && typeof clients[email] === 'object' ? (clients[email] as GenericRecord) : null;
    const userTabsRaw = userRow?.tab_access;
    const userTabs: Record<string, boolean> | null =
      userTabsRaw && typeof userTabsRaw === 'object'
        ? Object.fromEntries(
            Object.entries(userTabsRaw as GenericRecord).map(([k, v]) => [k, Boolean(v)]),
          )
        : null;

    const merged: Record<string, boolean> = {};
    const keys = new Set([
      ...Object.keys(officeTabs),
      ...(userTabs ? Object.keys(userTabs) : []),
    ]);

    for (const key of keys) {
      const officeOk = key in officeTabs ? officeTabs[key] : true;
      const userOk = userTabs && key in userTabs ? userTabs[key] : true;
      if (!officeOk || !userOk) merged[key] = false;
    }

    if (Object.keys(merged).length === 0) {
      const legacy = readJsonStorage('gc_tab_access');
      for (const [key, value] of Object.entries(legacy)) {
        if (!value) merged[key] = false;
      }
    }

    return merged;
  }, [companyToken, config?.clients, config?.eye_vision_offices, email, isAdminEmail]);

  const clientEntry = useMemo(() => {
    if (!email) return null;
    const clients =
      config?.clients && typeof config.clients === 'object'
        ? (config.clients as GenericRecord)
        : {};
    const row = clients[email];
    if (row && typeof row === 'object') {
      return {
        ...(row as GenericRecord),
        email,
        assigned_company_token:
          String((row as GenericRecord).assigned_company_token || companyToken || '').trim() ||
          companyToken,
      };
    }
    if (!companyToken) return null;
    return {
      assigned_company_token: companyToken,
      email,
    } as GenericRecord;
  }, [companyToken, config?.clients, email]);

  return {
    isLoading: isLoadingAuth,
    isAdminEmail,
    companyToken,
    companyTokenOk,
    requiredCompanyTokens,
    tabAccess,
    clientEntry,
    config,
  };
}
