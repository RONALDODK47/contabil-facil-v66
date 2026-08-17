import type { IcmsCatalogo, IcmsComparacaoResult } from '../contabilfacil/logic/icmsInterestadual';
import {
  compararIcmsInterestadual,
  getIcmsCatalogo,
  listarUfsIcms,
} from '../contabilfacil/logic/icmsInterestadual';
import { fiscalApiCandidateBases } from './fiscalApiBase';

export type SefazIcmsSyncStatus = {
  ok: boolean;
  svrsPortalAcessivel: boolean;
  confazAcessivel: boolean;
  catalogoVersao: string;
  atualizadoEm: string;
  mensagem: string;
  portalDifalUrl: string;
  confazUrl: string;
  fonteDados: string;
};

function basesSefazIcms(): string[] {
  return fiscalApiCandidateBases().map((b) => b.replace(/\/$/, ''));
}

/** Verifica API fiscal local e conectividade com portais SEFAZ (SVRS/CONFAZ). */
export async function pingSefazIcmsApi(): Promise<boolean> {
  for (const base of basesSefazIcms()) {
    try {
      const res = await fetch(`${base}/sefaz/icms/health`, { method: 'GET', cache: 'no-store' });
      if (res.ok) return true;
    } catch {
      // próximo
    }
  }
  return false;
}

export async function fetchIcmsCatalogoApi(): Promise<IcmsCatalogo | null> {
  for (const base of basesSefazIcms()) {
    try {
      const res = await fetch(`${base}/sefaz/icms/catalogo`, { cache: 'no-store' });
      if (!res.ok) continue;
      return (await res.json()) as IcmsCatalogo;
    } catch {
      // próximo
    }
  }
  return null;
}

export async function compararIcmsViaApi(params: {
  ufOrigem: string;
  ufDestino: string;
  valorBase?: number;
  produtoImportado?: boolean;
  consumidorFinalNaoContribuinte?: boolean;
}): Promise<IcmsComparacaoResult> {
  const qs = new URLSearchParams({
    ufOrigem: params.ufOrigem,
    ufDestino: params.ufDestino,
    valorBase: String(params.valorBase ?? 0),
    produtoImportado: params.produtoImportado ? '1' : '0',
    consumidorFinal: params.consumidorFinalNaoContribuinte !== false ? '1' : '0',
  });

  for (const base of basesSefazIcms()) {
    try {
      const res = await fetch(`${base}/sefaz/icms/comparar?${qs}`, { cache: 'no-store' });
      if (!res.ok) continue;
      return (await res.json()) as IcmsComparacaoResult;
    } catch {
      // próximo
    }
  }

  return compararIcmsInterestadual({
    ufOrigem: params.ufOrigem,
    ufDestino: params.ufDestino,
    valorBase: params.valorBase,
    produtoImportado: params.produtoImportado,
    consumidorFinalNaoContribuinte: params.consumidorFinalNaoContribuinte,
  });
}

export async function sincronizarReferenciasSefazIcms(): Promise<SefazIcmsSyncStatus> {
  for (const base of basesSefazIcms()) {
    try {
      const res = await fetch(`${base}/sefaz/icms/sync`, { method: 'POST', cache: 'no-store' });
      if (!res.ok) continue;
      return (await res.json()) as SefazIcmsSyncStatus;
    } catch {
      // próximo
    }
  }

  const cat = getIcmsCatalogo();
  return {
    ok: true,
    svrsPortalAcessivel: false,
    confazAcessivel: false,
    catalogoVersao: cat.versao,
    atualizadoEm: cat.atualizadoEm,
    mensagem:
      'API fiscal local indisponível. Usando tabela embutida (CONFAZ + Resolução Senado). Inicie: npm run fiscal-api',
    portalDifalUrl: cat.portalDifalUrl,
    confazUrl: cat.confazUrl,
    fonteDados: cat.fontes.join(' · '),
  };
}

export function getIcmsCatalogoLocal(): IcmsCatalogo {
  return getIcmsCatalogo();
}

export function listarUfsIcmsLocal() {
  return listarUfsIcms();
}
