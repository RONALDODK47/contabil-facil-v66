import { fiscalApiCandidateBases, fiscalNfeCandidateBases, probeFiscalNfeApi } from './fiscalApiBase';
import type {
  NfeCreditoSugerido,
  NfeItemEstoque,
  NfeNotaResumo,
} from '../contabilfacil/logic/pricingTypes';

export type NfeDistribuicaoParams = {
  cnpj: string;
  uf?: string;
  ambiente?: 'homologacao' | 'producao';
  certificadoA1: File;
  senhaCertificado: string;
  dataInicio?: string;
  dataFim?: string;
  /** Último NSU já consultado — continua de onde parou. */
  ultNSU?: string;
  /** Manifestar ciência da operação (210210) para liberar XML completo. */
  manifestarCiencia?: boolean;
};

export type NfeDistribuicaoResult = {
  ok: boolean;
  mensagem: string;
  notas: NfeNotaResumo[];
  itensEstoque: NfeItemEstoque[];
  creditosSugeridos: NfeCreditoSugerido[];
  fonte?: string;
  ultNSU?: string;
  maxNSU?: string;
  manifestados?: number;
  /** true: parou por limite de páginas por consulta, ainda há NF-e a buscar — não é erro. */
  incompleto?: boolean;
};

/** Intervalo mínimo entre sincronizações SEFAZ (evita cStat 656). */
export const NFE_SEFAZ_MIN_INTERVAL_MS = 60 * 60 * 1000;

async function readFiscalJson<T extends Record<string, unknown>>(
  res: Response,
): Promise<T & { mensagem?: string }> {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(`API fiscal retornou resposta vazia (HTTP ${res.status}).`);
  }
  if (trimmed.startsWith('<') || trimmed.toLowerCase().startsWith('<!doctype')) {
    if (res.status === 404) {
      throw new Error(
        'Rota NF-e ausente no servidor. Atualize o backend Render ou rode localmente: npm run fiscal-api (:8780).',
      );
    }
    throw new Error(
      `API fiscal devolveu HTML em vez de JSON (HTTP ${res.status}). Verifique se o backend fiscal está atualizado.`,
    );
  }
  try {
    return JSON.parse(trimmed) as T & { mensagem?: string };
  } catch {
    throw new Error(`Resposta inválida da API fiscal (HTTP ${res.status}).`);
  }
}

export type NfeFiscalApiStatus = {
  online: boolean;
  nfeReady: boolean;
  mode?: 'local' | 'proxy' | 'remote';
  service?: string;
  hint?: string;
};

export async function pingNfePrecificacaoApi(): Promise<boolean> {
  const status = await probeNfeFiscalApiStatus();
  return status.nfeReady;
}

export async function probeNfeFiscalApiStatus(): Promise<NfeFiscalApiStatus> {
  const probe = await probeFiscalNfeApi();
  if (probe.online && probe.nfeBase) {
    return {
      online: true,
      nfeReady: true,
      mode: probe.mode,
      service: probe.service,
    };
  }

  const anyHealth = await (async () => {
    for (const base of fiscalApiCandidateBases()) {
      try {
        const res = await fetch(`${base}/health`, { cache: 'no-store' });
        if (res.ok) return true;
      } catch {
        /* ignore */
      }
    }
    return false;
  })();

  const onHttpsRemote =
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    !['localhost', '127.0.0.1'].includes(window.location.hostname);

  let hint = 'Rode npm run fiscal-api (:8780) e abra o app em http://localhost:3000 (npm run dev).';
  if (onHttpsRemote && anyHealth) {
    hint =
      'A nuvem responde health mas ainda não tem a rota NF-e. Atualize o backend Render ou use localhost:3000 com fiscal-api local.';
  } else if (onHttpsRemote) {
    hint =
      'No GitHub Pages (HTTPS) é necessário backend Render com rota NF-e ou app local em http://localhost:3000 + npm run fiscal-api.';
  }

  return {
    online: anyHealth,
    nfeReady: false,
    hint,
  };
}

export async function fetchNfeDistribuicaoSefaz(
  params: NfeDistribuicaoParams,
): Promise<NfeDistribuicaoResult> {
  const fd = new FormData();
  fd.append('cnpj', params.cnpj.replace(/\D/g, ''));
  fd.append('uf', (params.uf ?? 'SP').trim().toUpperCase());
  fd.append('ambiente', params.ambiente ?? 'producao');
  fd.append('senhaCertificado', params.senhaCertificado);
  fd.append('certificadoA1', params.certificadoA1);
  if (params.dataInicio) fd.append('dataInicio', params.dataInicio);
  if (params.dataFim) fd.append('dataFim', params.dataFim);
  if (params.ultNSU) fd.append('ultNSU', params.ultNSU.replace(/\D/g, '') || '0');
  fd.append('manifestarCiencia', params.manifestarCiencia === false ? 'false' : 'true');

  let lastErr = 'API fiscal NF-e indisponível.';
  const bases = await fiscalNfeCandidateBases();
  for (const base of bases) {
    try {
      const res = await fetch(`${base}/sefaz/nfe/distribuicao`, {
        method: 'POST',
        body: fd,
      });
      const data = await readFiscalJson<NfeDistribuicaoResult>(res);
      if (!res.ok) {
        lastErr = data.mensagem ?? `HTTP ${res.status}`;
        continue;
      }
      return {
        ok: data.ok !== false,
        mensagem: data.mensagem ?? 'NFe sincronizadas.',
        notas: data.notas ?? [],
        itensEstoque: data.itensEstoque ?? [],
        creditosSugeridos: data.creditosSugeridos ?? [],
        fonte: data.fonte ?? 'sefaz_distdfe',
        ultNSU: data.ultNSU,
        maxNSU: data.maxNSU,
        manifestados: data.manifestados,
      };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : lastErr;
    }
  }
  return {
    ok: false,
    mensagem: lastErr,
    notas: [],
    itensEstoque: [],
    creditosSugeridos: [],
  };
}

export async function importNfeXmlFiles(
  files: File[],
  opts: { dataInicio?: string; dataFim?: string } = {},
): Promise<NfeDistribuicaoResult> {
  const fd = new FormData();
  for (const file of files) fd.append('arquivos', file);
  if (opts.dataInicio) fd.append('dataInicio', opts.dataInicio);
  if (opts.dataFim) fd.append('dataFim', opts.dataFim);

  let lastErr = 'API fiscal NF-e indisponível.';
  const bases = await fiscalNfeCandidateBases();
  for (const base of bases) {
    try {
      const res = await fetch(`${base}/sefaz/nfe/importar-xml`, { method: 'POST', body: fd });
      const data = await readFiscalJson<NfeDistribuicaoResult & { ignorados?: string[] }>(res);
      if (!res.ok) {
        lastErr = data.mensagem ?? `HTTP ${res.status}`;
        continue;
      }
      let msg = data.mensagem ?? 'XMLs importados.';
      if (data.ignorados?.length) {
        msg += ` (${data.ignorados.length} arquivo(s) ignorado(s))`;
      }
      return {
        ok: data.ok !== false,
        mensagem: msg,
        notas: data.notas ?? [],
        itensEstoque: data.itensEstoque ?? [],
        creditosSugeridos: data.creditosSugeridos ?? [],
        fonte: data.fonte ?? 'xml_upload',
      };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : lastErr;
    }
  }
  return {
    ok: false,
    mensagem: lastErr,
    notas: [],
    itensEstoque: [],
    creditosSugeridos: [],
  };
}

export async function sugerirLancamentoReceitaFederal(linhaNome: string): Promise<{
  fundamentoLegal?: string;
  impostoKey?: string;
  historicoSugerido?: string;
}> {
  for (const base of fiscalApiCandidateBases()) {
    try {
      const res = await fetch(`${base}/receita-federal/sugerir-lancamento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linhaNome, origem: 'fiscal' }),
      });
      if (!res.ok) continue;
      return (await res.json()) as {
        fundamentoLegal?: string;
        impostoKey?: string;
        historicoSugerido?: string;
      };
    } catch {
      // próximo
    }
  }
  return {};
}
