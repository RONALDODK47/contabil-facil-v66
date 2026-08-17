export interface DeployDataBundle {
  updatedAt: string;
  contracts: unknown[];
  companies: Array<{ id?: string; name?: string; createdAt?: string }>;
}

const EMPTY_BUNDLE: DeployDataBundle = { updatedAt: '', contracts: [], companies: [] };

let runtimeBundle: DeployDataBundle | null = null;

function normalizeBundle(raw: unknown): DeployDataBundle {
  if (!raw || typeof raw !== 'object') {
    return EMPTY_BUNDLE;
  }
  const o = raw as Record<string, unknown>;
  return {
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '',
    contracts: Array.isArray(o.contracts) ? o.contracts : [],
    companies: Array.isArray(o.companies) ? (o.companies as DeployDataBundle['companies']) : [],
  };
}

/** Pacote carregado via fetch de public/data (fora do bundle JS). */
export function getDeployDataBundle(): DeployDataBundle {
  return runtimeBundle ?? EMPTY_BUNDLE;
}

export async function hydrateDeployDataFromBundledAssets(): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    const root = import.meta.env.BASE_URL ?? '/';
    const res = await fetch(`${root}data/saved-contracts-bundle.json`, { cache: 'default' });
    if (res.ok) {
      runtimeBundle = normalizeBundle(await res.json());
    }
  } catch {
    /* dados do localStorage do usuário basta */
  }
}
