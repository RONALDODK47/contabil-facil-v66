import type {
  ReceitaFederalCatalogo,
  ReceitaFederalEmpresaMeta,
  ReceitaFederalRegra,
  ReceitaFederalRegrasStore,
} from '../extratoVision/utils/receitaFederalRegras';
import { FISCAL_API_BASE, fiscalApiCandidateBases } from './fiscalApiBase';

export type ReceitaFederalSyncParams = {
  cnpj: string;
  uf?: string;
  municipio?: string;
  empresaNome?: string;
};

export type ReceitaFederalSyncResult = {
  store: ReceitaFederalRegrasStore;
  empresaMeta: ReceitaFederalEmpresaMeta;
  mensagem: string;
};

export type ReceitaFederalSugerirLancamentoParams = {
  linhaNome: string;
  debito?: number;
  credito?: number;
  origem: 'folha' | 'fiscal';
};

export type ReceitaFederalSugerirLancamentoResult = {
  regra: ReceitaFederalRegra | null;
  impostoKey?: string;
  fundamentoLegal?: string;
  historicoSugerido?: string;
  ladoDebito?: string;
  ladoCredito?: string;
};

function basesReceitaFederal(): string[] {
  return fiscalApiCandidateBases().map((b) => b.replace(/\/$/, ''));
}

export async function pingReceitaFederalApi(): Promise<boolean> {
  for (const base of basesReceitaFederal()) {
    try {
      const res = await fetch(`${base}/receita-federal/health`, { method: 'GET', cache: 'no-store' });
      if (res.ok) return true;
    } catch {
      // próximo
    }
  }
  return false;
}

export async function fetchCatalogoReceitaFederalApi(): Promise<ReceitaFederalCatalogo | null> {
  for (const base of basesReceitaFederal()) {
    try {
      const res = await fetch(`${base}/receita-federal/catalogo`, { cache: 'no-store' });
      if (!res.ok) continue;
      return (await res.json()) as ReceitaFederalCatalogo;
    } catch {
      // próximo
    }
  }
  return null;
}

export async function sincronizarRegrasReceitaFederal(
  params: ReceitaFederalSyncParams,
): Promise<ReceitaFederalSyncResult> {
  let lastMessage = 'Falha ao sincronizar regras com a API Receita Federal.';
  for (const base of basesReceitaFederal()) {
    try {
      const res = await fetch(`${base}/receita-federal/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cnpj: params.cnpj.replace(/\D/g, ''),
          uf: (params.uf ?? '').toUpperCase(),
          municipio: params.municipio ?? '',
          empresaNome: params.empresaNome ?? '',
        }),
      });
      if (!res.ok) {
        const err = await safeJson(res);
        lastMessage =
          typeof err?.mensagem === 'string' ? err.mensagem : `Sincronização RF falhou (${res.status}).`;
        continue;
      }
      const payload = (await res.json()) as ReceitaFederalSyncResult;
      return payload;
    } catch {
      lastMessage =
        'API fiscal local indisponível. Inicie com: npm run fiscal-api (porta 8780).';
    }
  }
  throw new Error(lastMessage);
}

export async function sugerirLancamentoReceitaFederalApi(
  params: ReceitaFederalSugerirLancamentoParams,
): Promise<ReceitaFederalSugerirLancamentoResult> {
  for (const base of basesReceitaFederal()) {
    try {
      const res = await fetch(`${base}/receita-federal/sugerir-lancamento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!res.ok) continue;
      return (await res.json()) as ReceitaFederalSugerirLancamentoResult;
    } catch {
      // próximo
    }
  }
  return { regra: null };
}

async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const RECEITA_FEDERAL_API_BASE = FISCAL_API_BASE;
