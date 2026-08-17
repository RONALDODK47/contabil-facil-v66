import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useAuth } from '../../gestaoContabil/gestaoAuth';
import { dbClient } from '../../gestaoContabil/dbClientFallback';
import { useCloudAccess } from '../../gestaoContabil/useCloudAccessFallback';
import {
  buildOfficeViews,
  defaultGestaoTabAccess,
  getOfficeModuleAccess,
  getOfficeGestaoTabAccess,
  isInternalStaffClient,
  normalizeEyeVisionModuleAccess,
  normalizeGestaoTabAccess,
  parseEyeVisionOffices,
  resolveEffectiveGestaoTabAccess,
  resolveEffectiveModuleAccess,
  staffDisplayName,
  type EyeVisionModuleAccess,
  type GestaoTabAccess,
  type EyeVisionStaffUser,
} from './eyeVisionAdmin';

const CONFIG_QUERY_KEY = ['cloudAccessControlConfig'];

export function useEyeVisionAdmin() {
  const { user } = useAuth();
  const { isAdminEmail, config, isLoading } = useCloudAccess();
  const queryClient = useQueryClient();
  const adminUid = String(user?.uid || '').trim();

  const enabled = Boolean(isAdminEmail && adminUid);

  const { data: profiles = [] } = useQuery({
    queryKey: ['eyeVisionAdminProfiles'],
    queryFn: () => dbClient.entities.UserProfile.listAll(),
    enabled,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
    void queryClient.refetchQueries({ queryKey: CONFIG_QUERY_KEY });
  };

  const tokenNameFallback = useMemo(() => {
    const map = new Map<string, string>();
    const clients =
      config?.clients && typeof config.clients === 'object' ? config.clients : {};
    for (const row of Object.values(clients) as Record<string, unknown>[]) {
      if (!row || typeof row !== 'object') continue;
      const tok = String(row.assigned_company_token || '').trim();
      if (!tok || map.has(tok)) continue;
      const name = staffDisplayName(row);
      if (name && name !== tok) map.set(tok, name);
    }
    return map;
  }, [config?.clients]);

  const offices = useMemo(
    () => buildOfficeViews(config ?? {}, tokenNameFallback),
    [config, tokenNameFallback],
  );

  const officesMap = useMemo(
    () => parseEyeVisionOffices(config?.eye_vision_offices),
    [config?.eye_vision_offices],
  );

  const usersByToken = useMemo(() => {
    const clients =
      config?.clients && typeof config.clients === 'object' ? config.clients : {};
    const grouped = new Map<string, EyeVisionStaffUser[]>();

    for (const row of Object.values(clients) as Record<string, unknown>[]) {
      if (!isInternalStaffClient(row)) continue;
      const email = String(row.email || '').trim().toLowerCase();
      if (!email) continue;
      const assignedToken = String(row.assigned_company_token || '').trim();
      if (!assignedToken) continue;

      const officeAccess = getOfficeModuleAccess(officesMap, assignedToken);
      const officeGestaoTabs = getOfficeGestaoTabAccess(officesMap, assignedToken);
      const userAccess = normalizeEyeVisionModuleAccess(row.eye_vision_module_access);
      const userGestaoTabs = normalizeGestaoTabAccess(row.tab_access);
      const hasUserModuleOverride = 'eye_vision_module_access' in row;
      const hasUserTabOverride = 'tab_access' in row;

      const profile = (profiles as Record<string, unknown>[]).find(
        (p) => String(p.email || '').trim().toLowerCase() === email,
      );

      const userEntry: EyeVisionStaffUser = {
        email,
        displayName:
          staffDisplayName(row) ||
          String(profile?.display_name || profile?.gc_login_username || email),
        assignedToken,
        isActive: row.is_active !== false,
        moduleAccess: hasUserModuleOverride ? userAccess : officeAccess,
        effectiveModuleAccess: resolveEffectiveModuleAccess(
          officeAccess,
          hasUserModuleOverride ? userAccess : null,
        ),
        gestaoTabAccess: hasUserTabOverride ? userGestaoTabs : officeGestaoTabs,
        effectiveGestaoTabAccess: resolveEffectiveGestaoTabAccess(
          officeGestaoTabs,
          hasUserTabOverride ? userGestaoTabs : null,
        ),
        canEditModuleAccess: row.can_edit_office_module_access === true,
      };

      const list = grouped.get(assignedToken) ?? [];
      list.push(userEntry);
      grouped.set(assignedToken, list);
    }

    for (const [tok, list] of grouped) {
      list.sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'));
      grouped.set(tok, list);
    }
    return grouped;
  }, [config?.clients, profiles, officesMap]);

  const createOfficeMut = useMutation({
    mutationFn: async (name: string) => {
      const officeName = String(name || '').trim();
      if (!officeName) throw new Error('Informe o nome da empresa.');
      if (!adminUid) throw new Error('Sessão em falta.');

      const cfg = await dbClient.entities.CloudAccessControl.getConfig();
      const prevTokens = Array.isArray(cfg?.company_access_tokens)
        ? cfg.company_access_tokens.map((x: string) => String(x || '').trim()).filter(Boolean)
        : [];
      const legacy = String(cfg?.company_access_token || '').trim();
      const tokenSet = new Set([...prevTokens, ...(legacy ? [legacy] : [])]);
      const newToken = dbClient.entities.CloudAccessControl.generateToken('ADM');
      tokenSet.add(newToken);

      const offices = parseEyeVisionOffices(cfg?.eye_vision_offices);
      offices[newToken] = {
        name: officeName,
        created_at: new Date().toISOString(),
        module_access: { manager: true, pricing: true, gestao: true },
        gestao_tab_access: defaultGestaoTabAccess(),
      };

      await dbClient.entities.CloudAccessControl.updateConfig({
        adminUid,
        patch: {
          company_access_tokens: Array.from(tokenSet),
          eye_vision_offices: offices,
        },
      });
      return { token: newToken, name: officeName };
    },
    onSuccess: refresh,
  });

  const regenerateTokenMut = useMutation({
    mutationFn: async ({ token, name }: { token: string; name: string }) => {
      const oldToken = String(token || '').trim();
      if (!oldToken) throw new Error('Token inválido.');
      if (!adminUid) throw new Error('Sessão em falta.');

      const cfg = await dbClient.entities.CloudAccessControl.getConfig();
      const prevTokens = Array.isArray(cfg?.company_access_tokens)
        ? cfg.company_access_tokens.map((x: string) => String(x || '').trim()).filter(Boolean)
        : [];
      const legacy = String(cfg?.company_access_token || '').trim();
      const tokenSet = new Set([...prevTokens, ...(legacy ? [legacy] : [])]);
      tokenSet.delete(oldToken);

      const newToken = dbClient.entities.CloudAccessControl.generateToken('ADM');
      tokenSet.add(newToken);

      const offices = parseEyeVisionOffices(cfg?.eye_vision_offices);
      const meta = offices[oldToken] ?? {
        name,
        created_at: new Date().toISOString(),
        module_access: { manager: true, pricing: true, gestao: true },
        gestao_tab_access: defaultGestaoTabAccess(),
      };
      delete offices[oldToken];
      offices[newToken] = { ...meta, name: meta.name || name };

      const clients =
        cfg?.clients && typeof cfg.clients === 'object' ? { ...cfg.clients } : {};
      for (const [key, row] of Object.entries(clients)) {
        if (!row || typeof row !== 'object') continue;
        if (String((row as Record<string, unknown>).assigned_company_token || '').trim() !== oldToken) {
          continue;
        }
        const email = String((row as Record<string, unknown>).email || key || '').trim();
        if (!email) continue;
        await dbClient.entities.CloudAccessControl.upsertClient({
          adminUid,
          email,
          patch: { assigned_company_token: newToken },
        });
      }

      await dbClient.entities.CloudAccessControl.updateConfig({
        adminUid,
        patch: {
          company_access_tokens: Array.from(tokenSet),
          eye_vision_offices: offices,
          ...(legacy === oldToken ? { company_access_token: newToken } : {}),
        },
      });
      return newToken;
    },
    onSuccess: refresh,
  });

  const patchOfficeModulesMut = useMutation({
    mutationFn: async ({
      token,
      moduleAccess,
      gestaoTabAccess,
    }: {
      token: string;
      moduleAccess: EyeVisionModuleAccess;
      gestaoTabAccess?: GestaoTabAccess;
    }) => {
      const tok = String(token || '').trim();
      if (!tok) throw new Error('Token inválido.');
      if (!adminUid) throw new Error('Sessão em falta.');

      const cfg = await dbClient.entities.CloudAccessControl.getConfig();
      const offices = parseEyeVisionOffices(cfg?.eye_vision_offices);
      const current = offices[tok] ?? {
        name: tok,
        created_at: new Date().toISOString(),
        module_access: { manager: true, pricing: true, gestao: true },
        gestao_tab_access: defaultGestaoTabAccess(),
      };
      offices[tok] = {
        ...current,
        module_access: moduleAccess,
        ...(gestaoTabAccess ? { gestao_tab_access: gestaoTabAccess } : {}),
      };

      await dbClient.entities.CloudAccessControl.updateConfig({
        adminUid,
        patch: { eye_vision_offices: offices },
      });
    },
    onSuccess: refresh,
  });

  const patchUserModulesMut = useMutation({
    mutationFn: async ({
      email,
      moduleAccess,
      gestaoTabAccess,
      canEditModuleAccess,
    }: {
      email: string;
      moduleAccess: EyeVisionModuleAccess;
      gestaoTabAccess?: GestaoTabAccess;
      canEditModuleAccess?: boolean;
    }) => {
      if (!adminUid) throw new Error('Sessão em falta.');
      const patch: Record<string, unknown> = {
        eye_vision_module_access: moduleAccess,
      };
      if (gestaoTabAccess) patch.tab_access = gestaoTabAccess;
      if (typeof canEditModuleAccess === 'boolean') {
        patch.can_edit_office_module_access = canEditModuleAccess;
      }
      await dbClient.entities.CloudAccessControl.upsertClient({
        adminUid,
        email,
        patch,
      });
    },
    onSuccess: refresh,
  });

  const deleteOfficeMut = useMutation({
    mutationFn: async ({ token }: { token: string }) => {
      const targetToken = String(token || '').trim();
      if (!targetToken) throw new Error('Token inválido.');
      if (!adminUid) throw new Error('Sessão em falta.');

      const cfg = await dbClient.entities.CloudAccessControl.getConfig();
      const prevTokens = Array.isArray(cfg?.company_access_tokens)
        ? cfg.company_access_tokens.map((x: string) => String(x || '').trim()).filter(Boolean)
        : [];
      const legacy = String(cfg?.company_access_token || '').trim();
      const tokenSet = new Set([...prevTokens, ...(legacy ? [legacy] : [])]);
      tokenSet.delete(targetToken);

      const offices = parseEyeVisionOffices(cfg?.eye_vision_offices);
      delete offices[targetToken];

      const clients =
        cfg?.clients && typeof cfg.clients === 'object' ? { ...cfg.clients } : {};
      for (const [key, row] of Object.entries(clients)) {
        if (!row || typeof row !== 'object') continue;
        if (String((row as Record<string, unknown>).assigned_company_token || '').trim() !== targetToken) {
          continue;
        }
        const email = String((row as Record<string, unknown>).email || key || '').trim();
        if (!email) continue;
        await dbClient.entities.CloudAccessControl.upsertClient({
          adminUid,
          email,
          patch: { assigned_company_token: '' },
        });
      }

      await dbClient.entities.CloudAccessControl.updateConfig({
        adminUid,
        patch: {
          company_access_tokens: Array.from(tokenSet),
          eye_vision_offices: offices,
          ...(legacy === targetToken ? { company_access_token: '' } : {}),
        },
      });
    },
    onSuccess: refresh,
  });

  return {
    enabled,
    isLoading,
    offices,
    usersByToken,
    createOffice: createOfficeMut.mutateAsync,
    isCreatingOffice: createOfficeMut.isPending,
    regenerateToken: regenerateTokenMut.mutateAsync,
    isRegeneratingToken: regenerateTokenMut.isPending,
    patchOfficeModules: patchOfficeModulesMut.mutateAsync,
    isPatchingOffice: patchOfficeModulesMut.isPending,
    patchUserModules: patchUserModulesMut.mutateAsync,
    isPatchingUser: patchUserModulesMut.isPending,
    deleteOffice: deleteOfficeMut.mutateAsync,
    isDeletingOffice: deleteOfficeMut.isPending,
  };
}
