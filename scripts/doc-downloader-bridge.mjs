/**
 * Ponte Node → worker Python (:8766) para download SPED com certificado A1.
 */

const DOC_DOWNLOADER_BASE = (process.env.DOC_DOWNLOADER_URL || 'http://127.0.0.1:8766').replace(/\/$/, '');

let pythonOnlineCache = { at: 0, ok: false };

export async function pingDocDownloader() {
  const now = Date.now();
  if (now - pythonOnlineCache.at < 8000) return pythonOnlineCache.ok;
  try {
    const res = await fetch(`${DOC_DOWNLOADER_BASE}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(2500),
    });
    pythonOnlineCache = { at: now, ok: res.ok };
    return res.ok;
  } catch {
    pythonOnlineCache = { at: now, ok: false };
    return false;
  }
}

/**
 * Tenta baixar SPED via Python (mTLS nativo). Retorna null se worker offline ou falha.
 */
export async function baixarSpedViaPython({
  tipo,
  url,
  cnpj,
  uf,
  ambiente,
  competencia,
  dataInicio,
  dataFim,
  competencias,
  pfx,
  passphrase,
}) {
  if (!url?.trim() || !pfx?.length) return null;
  if (!(await pingDocDownloader())) return null;

  const form = new FormData();
  form.append('url', url.trim());
  form.append('tipo', tipo);
  form.append('cnpj', String(cnpj ?? ''));
  form.append('uf', String(uf ?? 'SP'));
  form.append('ambiente', String(ambiente ?? 'producao'));
  form.append('competencia', String(competencia ?? ''));
  form.append('dataInicio', String(dataInicio ?? ''));
  form.append('dataFim', String(dataFim ?? ''));
  form.append('competencias', JSON.stringify(competencias ?? []));
  form.append('senhaCertificado', String(passphrase ?? ''));
  form.append('certificadoA1', new Blob([pfx]), 'certificado.pfx');

  try {
    const res = await fetch(`${DOC_DOWNLOADER_BASE}/sped/gateway`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    const data = await res.json();
    if (!res.ok || !data?.arquivo?.content) return null;
    return {
      tipo,
      fileName: data.arquivo.fileName || `${tipo}.txt`,
      content: data.arquivo.content,
      competencia: data.arquivo.competencia || competencia || undefined,
    };
  } catch {
    return null;
  }
}
