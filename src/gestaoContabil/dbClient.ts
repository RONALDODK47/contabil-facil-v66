/**
 * dbClient — Postgres/MinIO (Docker via agent-api) é a fonte de verdade do workspace.
 * Fallback localStorage só para metadados leves (perfil/acesso) quando o backend não está forçado.
 */
import { dbClient as localDbClient } from './dbClientFallback';
import {
  isPostgresStorageClientEnabled,
  postgresEyeVisionWorkspace,
  probeWorkspaceStorageHealth,
  resetWorkspaceHealthCache,
} from './dbClientPostgres';

type GenericRecord = Record<string, unknown>;

let preferPostgres: boolean | null = null;
let probeInFlight: Promise<boolean> | null = null;

/** Backend remoto obrigatório (não grava workspace no localStorage). */
export function isRemoteWorkspaceRequired(): boolean {
  return isPostgresStorageClientEnabled();
}

async function resolvePreferPostgres(): Promise<boolean> {
  if (!isPostgresStorageClientEnabled()) {
    preferPostgres = false;
    return false;
  }
  if (preferPostgres === true) return true;
  if (!probeInFlight) {
    probeInFlight = probeWorkspaceStorageHealth().then((ok) => {
      preferPostgres = ok;
      probeInFlight = null;
      return ok;
    });
  }
  return probeInFlight;
}

/** Força re-probe (ex.: após subir Docker / agent-api). */
export function resetStorageBackendProbe(): void {
  preferPostgres = null;
  probeInFlight = null;
  resetWorkspaceHealthCache();
}

function remoteRequiredError(op: string): Error {
  return new Error(
    `[dbClient] ${op}: Postgres/MinIO indisponível. Suba Docker (npm run storage:up) e o agent-api (npm run agent-api).`,
  );
}

async function setOffice(officeToken: string, payload: GenericRecord, uid: string) {
  if (await resolvePreferPostgres()) {
    return postgresEyeVisionWorkspace.setOffice(officeToken, payload, uid);
  }
  if (isRemoteWorkspaceRequired()) {
    // Re-probe uma vez (agent-api pode ter subido depois do cache negativo).
    resetStorageBackendProbe();
    if (await resolvePreferPostgres()) {
      return postgresEyeVisionWorkspace.setOffice(officeToken, payload, uid);
    }
    throw remoteRequiredError('setOffice');
  }
  return localDbClient.entities.EyeVisionWorkspace.setOffice(officeToken, payload, uid);
}

async function getOffice(officeToken: string) {
  if (await resolvePreferPostgres()) {
    return postgresEyeVisionWorkspace.getOffice(officeToken);
  }
  if (isRemoteWorkspaceRequired()) {
    resetStorageBackendProbe();
    if (await resolvePreferPostgres()) {
      return postgresEyeVisionWorkspace.getOffice(officeToken);
    }
    throw remoteRequiredError('getOffice');
  }
  return localDbClient.entities.EyeVisionWorkspace.getOffice(officeToken);
}

async function setManager(
  officeToken: string,
  companySlug: string,
  payload: GenericRecord,
  uid: string,
) {
  if (await resolvePreferPostgres()) {
    return postgresEyeVisionWorkspace.setManager(officeToken, companySlug, payload, uid);
  }
  if (isRemoteWorkspaceRequired()) {
    resetStorageBackendProbe();
    if (await resolvePreferPostgres()) {
      return postgresEyeVisionWorkspace.setManager(officeToken, companySlug, payload, uid);
    }
    throw remoteRequiredError('setManager');
  }
  return localDbClient.entities.EyeVisionWorkspace.setManager(
    officeToken,
    companySlug,
    payload,
    uid,
  );
}

async function listManagerByOffice(officeToken: string) {
  if (await resolvePreferPostgres()) {
    return postgresEyeVisionWorkspace.listManagerByOffice(officeToken);
  }
  if (isRemoteWorkspaceRequired()) {
    resetStorageBackendProbe();
    if (await resolvePreferPostgres()) {
      return postgresEyeVisionWorkspace.listManagerByOffice(officeToken);
    }
    throw remoteRequiredError('listManagerByOffice');
  }
  return localDbClient.entities.EyeVisionWorkspace.listManagerByOffice(officeToken);
}

async function deleteManager(officeToken: string, companySlug: string, uid: string) {
  if (await resolvePreferPostgres()) {
    return postgresEyeVisionWorkspace.deleteManager(officeToken, companySlug, uid);
  }
  if (isRemoteWorkspaceRequired()) {
    resetStorageBackendProbe();
    if (await resolvePreferPostgres()) {
      return postgresEyeVisionWorkspace.deleteManager(officeToken, companySlug, uid);
    }
    throw remoteRequiredError('deleteManager');
  }
  return localDbClient.entities.EyeVisionWorkspace.deleteManager(officeToken, companySlug, uid);
}

export const dbClient = {
  entities: {
    EyeVisionWorkspace: {
      setOffice,
      getOffice,
      setManager,
      listManagerByOffice,
      deleteManager,
    },
    UserProfile: localDbClient.entities.UserProfile,
    CloudAccessControl: localDbClient.entities.CloudAccessControl,
  },
};

export async function isRemoteWorkspaceActive(): Promise<boolean> {
  return resolvePreferPostgres();
}
