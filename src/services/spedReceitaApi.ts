import { FISCAL_API_BASE, fiscalApiCandidateBases, pingFiscalHealth } from './fiscalApiBase';

export type SpedReceitaDownloadParams = {
  cnpj: string;
  uf: string;
  ambiente: 'homologacao' | 'producao';
  certificadoA1: File;
  senhaCertificado: string;
  /** CNPJ do escritório/contador (autor do pedido). Se vazio, usa o mesmo CNPJ da empresa. */
  autorCnpj?: string;
  /** Período no mesmo formato da aba Folha (AAAA-MM-DD do input type="date"). */
  dataInicio: string;
  dataFim: string;
};

export type SpedReceitaArquivo = {
  tipo: 'CONTRIBUICOES' | 'ICMS_IPI';
  fileName: string;
  content: string;
};

export type SpedReceitaDownloadResult = {
  mensagem: string;
  mode: string;
  arquivos: SpedReceitaArquivo[];
  certificadoOk?: boolean;
};

export type SpedReceitaHealth = {
  online: boolean;
  mode: string;
};

export async function pingSpedReceitaApi(): Promise<boolean> {
  return pingFiscalHealth('/sped/health');
}

export async function fetchSpedReceitaHealth(): Promise<SpedReceitaHealth> {
  for (const base of fiscalApiCandidateBases()) {
    try {
      const res = await fetch(`${base}/sped/health`, { method: 'GET', cache: 'no-store' });
      if (!res.ok) continue;
      const data = (await res.json()) as { mode?: string; ok?: boolean; online?: boolean };
      const online = data.online !== false && data.ok !== false;
      return { online, mode: String(data.mode ?? 'unknown') };
    } catch {
      // próximo
    }
  }
  return { online: false, mode: 'offline' };
}

export function labelModoSped(mode: string): string {
  switch (mode) {
    case 'integra_contador':
      return 'Integra Contador (Serpro)';
    case 'gateway_corporativo':
      return 'Gateway corporativo';
    case 'nao_configurado':
      return 'Sem download automático — importe TXT';
    case 'certificado_ok_sem_gateway':
      return 'Certificado OK — importe TXT';
    case 'offline':
      return 'API offline';
    default:
      return mode;
  }
}

export async function baixarSpedReceitaCertificado(
  params: SpedReceitaDownloadParams,
): Promise<SpedReceitaDownloadResult> {
  const fd = new FormData();
  fd.append('cnpj', params.cnpj.replace(/\D/g, ''));
  fd.append('uf', params.uf.trim().toUpperCase());
  fd.append('ambiente', params.ambiente);
  fd.append('senhaCertificado', params.senhaCertificado);
  fd.append('certificadoA1', params.certificadoA1);
  if (params.autorCnpj?.trim()) {
    fd.append('autorCnpj', params.autorCnpj.replace(/\D/g, ''));
  }
  fd.append('dataInicio', params.dataInicio);
  fd.append('dataFim', params.dataFim);

  let lastError = 'API fiscal local indisponível.';
  for (const base of fiscalApiCandidateBases()) {
    try {
      const res = await fetch(`${base}/sped/download`, { method: 'POST', body: fd });
      const data = (await res.json()) as SpedReceitaDownloadResult & { mensagem?: string };
      if (!res.ok) {
        throw new Error(data.mensagem ?? `HTTP ${res.status}`);
      }
      return {
        mensagem: data.mensagem ?? 'Consulta concluída.',
        mode: data.mode ?? 'unknown',
        arquivos: Array.isArray(data.arquivos) ? data.arquivos : [],
        certificadoOk: data.certificadoOk,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(lastError);
}

export { FISCAL_API_BASE };
