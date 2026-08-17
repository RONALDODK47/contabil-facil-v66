import { getDeployDataBundle } from './deployDataBundle';
import { mergeSavedById, persistCanonicalList } from './simuladorBrowserStorage';
import {
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
} from './safeLocalStorage';
import {
  createDefaultSimTabFields,
  legacyFormStateToParcelTab,
  mergeStoredSimTab,
  type SavedContractFormState,
  type SimTabFields,
} from './simTabFields';

export const CONTRACTS_STORAGE_KEYS = [
  'simulador_contracts',
  'contracts',
  'emprestimos_contracts',
  'simulador_contratos',
] as const;

export const CONTRACTS_CANONICAL_KEY = 'simulador_contracts' as const;

export interface SavedContract {
  id: string;
  companyName: string;
  contractNumber: string;
  bankName?: string;
  formState: SavedContractFormState;
  createdAt: string;
}

function contractsArrayFromParsed(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>;
    if (Array.isArray(o.items)) return o.items;
    if (Array.isArray(o.contracts)) return o.contracts;
    if (o.id != null || o.companyName != null || o.contractNumber != null) return [parsed];
  }
  return [];
}

function unwrapFormState(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  if (r.formState && typeof r.formState === 'object') {
    return r.formState as Record<string, unknown>;
  }
  if (r.dados && typeof r.dados === 'object') {
    return r.dados as Record<string, unknown>;
  }
  return r;
}

function normalizeFormState(raw: unknown): SavedContractFormState {
  const fs = unwrapFormState(raw);
  const baseTab = createDefaultSimTabFields();
  const hasParcelTab = fs.parcelTab && typeof fs.parcelTab === 'object';
  const hasValueTab = fs.valueTab && typeof fs.valueTab === 'object';

  let parcelTab: SimTabFields;
  let valueTab: SimTabFields;

  if (hasParcelTab) {
    parcelTab = mergeStoredSimTab(fs.parcelTab as Partial<SimTabFields>);
  } else {
    parcelTab = legacyFormStateToParcelTab(fs);
  }

  if (hasValueTab) {
    valueTab = mergeStoredSimTab(fs.valueTab as Partial<SimTabFields>);
  } else {
    valueTab = mergeStoredSimTab(parcelTab);
  }

  const calculationMode =
    fs.calculationMode === 'value' || fs.calculationMode === 'parcel'
      ? fs.calculationMode
      : 'parcel';

  return {
    monthsStr: String(fs.monthsStr ?? fs.months ?? '120'),
    contractDateStr: String(
      fs.contractDateStr ?? fs.contractDate ?? new Date().toISOString().split('T')[0]
    ),
    firstInstallmentDateStr: String(
      fs.firstInstallmentDateStr ??
        fs.firstInstallmentDate ??
        fs.dataPrimeiraParcelaStr ??
        new Date().toISOString().split('T')[0]
    ),
    calculationMode,
    parcelTab,
    valueTab,
    savedDisplayPrincipalStr:
      fs.savedDisplayPrincipalStr != null ? String(fs.savedDisplayPrincipalStr) : undefined,
  };
}

export function normalizeSavedContract(raw: unknown): SavedContract {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Contrato inválido');
  }
  const r = raw as Record<string, unknown>;
  const formState = normalizeFormState(r.formState ?? r);

  return {
    id: String(r.id ?? crypto.randomUUID()),
    companyName: String(r.companyName ?? r.empresa ?? 'EMPRESA').toUpperCase(),
    contractNumber: String(r.contractNumber ?? r.numeroContrato ?? r.contrato ?? ''),
    bankName: String(r.bankName ?? r.nomeBanco ?? r.banco ?? '').trim(),
    formState,
    createdAt: String(r.createdAt ?? new Date().toISOString()),
  };
}

export function loadContractsFromStorage(rawJson: string | null): SavedContract[] {
  if (!rawJson?.trim()) return [];
  try {
    const parsed = JSON.parse(rawJson);
    const rows = contractsArrayFromParsed(parsed);
    const out: SavedContract[] = [];
    for (const row of rows) {
      try {
        out.push(normalizeSavedContract(row));
      } catch (e) {
        console.warn('[contratos] registro ignorado na carga:', e, row);
      }
    }
    return out;
  } catch (e) {
    console.error('[contratos] JSON inválido no armazenamento:', e);
    return [];
  }
}

function loadBundledDeployContracts(): SavedContract[] {
  const out: SavedContract[] = [];
  for (const row of getDeployDataBundle().contracts) {
    try {
      out.push(normalizeSavedContract(row));
    } catch (e) {
      console.warn('[contratos] registro do pacote deploy ignorado:', e, row);
    }
  }
  return out;
}

/** Contratos só do localStorage (sem pacote do deploy). */
export function loadLocalContractsFromBrowserStorage(): SavedContract[] {
  const collected: SavedContract[][] = [];
  for (const key of CONTRACTS_STORAGE_KEYS) {
    const raw = safeLocalStorageGetItem(key);
    if (!raw?.trim()) continue;
    const list = loadContractsFromStorage(raw);
    if (list.length > 0) {
      collected.push(list);
      if (key !== CONTRACTS_CANONICAL_KEY) {
        console.info(`[contratos] ${list.length} registro(s) recuperado(s) da chave legada "${key}".`);
      }
    }
  }
  return mergeSavedById(collected);
}

/** Local + pacote embutido no deploy (local vence no mesmo id). */
export function loadContractsFromBrowserStorage(): SavedContract[] {
  const bundled = loadBundledDeployContracts();
  const local = loadLocalContractsFromBrowserStorage();
  const merged = mergeSavedById([bundled, local]);
  persistCanonicalList(CONTRACTS_CANONICAL_KEY, merged);
  if (bundled.length > 0 && local.length === 0) {
    console.info(`[contratos] ${bundled.length} contrato(s) do pacote deploy (Firebase).`);
  }
  return merged;
}

/** JSON para colar em data/deploy-saved-contracts.json antes do build. */
export function buildDeployContractsExportPayload(
  contracts: SavedContract[],
  companies: Array<{ id: string; name: string; createdAt: string }> = [],
): string {
  return JSON.stringify(
    {
      updatedAt: new Date().toISOString(),
      contracts,
      companies,
    },
    null,
    2,
  );
}

/** Baixa o arquivo para colocar em data/ e rodar npm run deploy. */
export function downloadDeployContractsBundle(
  contracts: SavedContract[],
  companies: Array<{ id: string; name: string; createdAt: string }> = [],
): void {
  const json = buildDeployContractsExportPayload(contracts, companies);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'deploy-saved-contracts.json';
  anchor.click();
  URL.revokeObjectURL(url);
}

export function saveContractsToBrowserStorage(list: SavedContract[]): void {
  try {
    // safeLocalStorageSetItem não grava no disco do navegador (bloqueado em safeLocalStorage.ts) —
    // só atualiza o cache em memória que o eyeVisionCloudPush lê antes de enviar ao Postgres.
    // Sem essa chamada, o push manda o valor antigo (ou nada) e o contrato nunca sai da aba.
    safeLocalStorageSetItem(CONTRACTS_CANONICAL_KEY, JSON.stringify(list));
    void import('../contabilfacil/logic/eyeVisionCloudPush').then(({ scheduleEyeVisionCloudPush }) => {
      scheduleEyeVisionCloudPush();
    });
  } catch (e) {
    console.warn('[contratos] não foi possível gravar contratos:', e);
  }
}
