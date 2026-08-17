/**
 * Ponte Node → Python (:8766) — preços de insumos via Google Custom Search.
 */

import { pingDocDownloader } from './doc-downloader-bridge.mjs';

const DOC_DOWNLOADER_BASE = (process.env.DOC_DOWNLOADER_URL || 'http://127.0.0.1:8766').replace(/\/$/, '');

/**
 * @param {{ produtoAcabado: string, itens: Array<{ id?: string, nome: string, unidade?: string }>, descobrirInsumos?: boolean }} params
 */
export async function buscarPrecosInsumosGoogle(params) {
  const online = await pingDocDownloader();
  if (!online) {
    return {
      ok: false,
      offline: true,
      precos: [],
      insumosDescobertos: [],
      avisos: ['Servidor Python offline — rode npm run dev (doc_downloader :8766).'],
    };
  }

  try {
    const res = await fetch(`${DOC_DOWNLOADER_BASE}/pricing/search-prices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        produtoAcabado: params.produtoAcabado ?? '',
        itens: params.itens ?? [],
        descobrirInsumos: Boolean(params.descobrirInsumos),
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const data = await res.json();
    if (!res.ok) {
      return {
        ok: false,
        precos: [],
        insumosDescobertos: [],
        avisos: [String(data?.error || `HTTP ${res.status}`)],
      };
    }
    return data;
  } catch (e) {
    return {
      ok: false,
      precos: [],
      insumosDescobertos: [],
      avisos: [e instanceof Error ? e.message : 'Falha na consulta de preços'],
    };
  }
}
