import { useMemo } from 'react';
import { useCloudAccess } from '../../gestaoContabil/useCloudAccessFallback';
import {
  getOfficeModuleAccess,
  normalizeEyeVisionModuleAccess,
  parseEyeVisionOffices,
  resolveEffectiveModuleAccess,
  resolveUserOfficeToken,
  type EyeVisionModuleAccess,
} from './eyeVisionAdmin';

export function useEyeVisionModuleAccess(): {
  isAdminEmail: boolean;
  moduleAccess: EyeVisionModuleAccess;
} {
  const { isAdminEmail, clientEntry, config } = useCloudAccess();

  const moduleAccess = useMemo(() => {
    if (isAdminEmail) {
      return { manager: true, pricing: true, gestao: true };
    }

    const offices = parseEyeVisionOffices(config?.eye_vision_offices);
    const officeToken = resolveUserOfficeToken(clientEntry);
    const officeAccess = getOfficeModuleAccess(offices, officeToken);

    const userRaw = clientEntry?.eye_vision_module_access;
    const userAccess = userRaw ? normalizeEyeVisionModuleAccess(userRaw) : null;

    return resolveEffectiveModuleAccess(officeAccess, userAccess);
  }, [clientEntry, config?.eye_vision_offices, isAdminEmail]);

  return { isAdminEmail, moduleAccess };
}
