/**
 * Rotas Gemini — relatório OCR / debug (somente free tier, sem Ollama).
 */
import './load-env.mjs';
import {
  callGemini,
  isGeminiConfigured,
  geminiModelId,
  parseGeminiJson,
  pingGeminiApi,
  listFreeTierGeminiModels,
} from './gemini-client.mjs';
import {
  DEBUG_GEMINI_SYSTEM,
  EXTRATO_GEMINI_SYSTEM,
  OCR_PIPELINE_MAP,
  normalizeGeminiAuditResponse,
} from './gemini-audit-prompts.mjs';
import { handleAiExtractExtrato, handleAiExtractPlano, handleAiExtractColigadas, handleAiExtractSocios, handleAiRefineOcrRows } from './ai-extract-handler.mjs';
import { handleAiSuggestRegrasContas } from './ai-regras-contas-handler.mjs';
import { handleAiSuggestModuloContas } from './ai-modulo-contas-handler.mjs';
import { catalogForApi } from './ai-model-catalog.mjs';

/** @param {{ deep?: boolean }} [opts] — deep=true faz ping real na API Google (lento). */
export async function handleGeminiHealth(opts = {}) {
  const configured = isGeminiConfigured();
  if (!configured) {
    return {
      status: 200,
      body: {
        ok: false,
        configured: false,
        provider: 'gemini',
        model: geminiModelId(),
        freeTierModels: listFreeTierGeminiModels(),
        detail: 'Configure a chave em Contábil → IA ou defina GEMINI_API_KEY no .env',
      },
    };
  }

  if (!opts.deep) {
    const model = geminiModelId();
    return {
      status: 200,
      body: {
        ok: true,
        configured: true,
        provider: 'gemini',
        freeTier: true,
        model,
        freeTierModels: listFreeTierGeminiModels(),
        detail: `Gemini configurado (${model}) — via Vite /api/agent`,
        quick: true,
      },
    };
  }

  const ping = await pingGeminiApi();
  return {
    status: 200,
    body: {
      ok: ping.ok,
      configured: true,
      provider: 'gemini',
      freeTier: ping.freeTier ?? false,
      model: ping.model ?? geminiModelId(),
      freeTierModels: listFreeTierGeminiModels(),
      detail: ping.detail,
    },
  };
}

export async function handleGeminiAnalyzeExtratoImport(body) {
  if (!isGeminiConfigured()) {
    return {
      status: 503,
      body: {
        ok: false,
        skipped: true,
        reason: 'gemini_not_configured',
        detail: 'Configure a chave em Contábil → IA ou defina GEMINI_API_KEY no .env',
      },
    };
  }

  const importSummary = body?.importSummary ?? {};
  const skippedLog = Array.isArray(body?.skippedLog) ? body.skippedLog : [];
  const sampleLancamentos = Array.isArray(body?.sampleLancamentos) ? body.sampleLancamentos : [];

  const auditPayload = JSON.stringify({
    empresa: body?.company ?? '',
    arquivo: body?.fileName ?? '',
    resumo: importSummary,
    logDescartados: skippedLog.slice(0, 40),
    amostraLancamentos: sampleLancamentos.slice(0, 15),
    mapaPipeline: OCR_PIPELINE_MAP,
    instrucao:
      'Para cada problema, informe claramente ONDE (linha OCR, PDF, UI ou arquivo src/) e COMO CORRIGIR (passos práticos).',
  }).slice(0, 14000);

  try {
    const out = await callGemini({
      systemInstruction: EXTRATO_GEMINI_SYSTEM,
      userContent: auditPayload,
      jsonMode: true,
      temperature: 0.1,
    });
    const parsed = parseGeminiJson(out.text);
    const normalized = normalizeGeminiAuditResponse(parsed, out.text);
    return {
      status: 200,
      body: { ok: true, provider: 'gemini', model: out.model, ...normalized },
    };
  } catch (err) {
    console.warn('[gemini extrato]', err instanceof Error ? err.message : err);
    return {
      status: 200,
      body: {
        ok: false,
        detail: err?.userHint ?? 'Gemini indisponível — reinicie npm run dev',
        reason: err?.status === 429 ? 'gemini_quota' : 'gemini_error',
        freeTierModels: listFreeTierGeminiModels(),
      },
    };
  }
}

export async function handleGeminiAnalyzeDebug(body) {
  if (!isGeminiConfigured()) {
    return {
      status: 503,
      body: {
        ok: false,
        skipped: true,
        reason: 'gemini_not_configured',
        detail: 'Defina GEMINI_API_KEY no arquivo .env',
      },
    };
  }

  const entries = Array.isArray(body?.entries) ? body.entries : [];
  if (entries.length === 0) {
    return { status: 400, body: { error: 'entries vazio' } };
  }

  try {
    const out = await callGemini({
      systemInstruction: DEBUG_GEMINI_SYSTEM,
      userContent: JSON.stringify({
        contexto: body?.context ?? 'debug',
        entradas: entries.slice(0, 30),
      }).slice(0, 10000),
      jsonMode: true,
      temperature: 0.1,
    });
    const parsed = parseGeminiJson(out.text);
    const normalized = normalizeGeminiAuditResponse(parsed, out.text);
    return { status: 200, body: { ok: true, provider: 'gemini', model: out.model, ...normalized } };
  } catch (err) {
    return {
      status: 200,
      body: {
        ok: false,
        detail: err?.userHint ?? 'Gemini indisponível',
        reason: 'gemini_error',
      },
    };
  }
}

export async function handleGeminiProactiveHint(payload) {
  const source = String(payload?.source ?? 'sistema');
  const context = String(payload?.context ?? '').trim();
  const data = payload?.data ?? {};
  if (!context) {
    return { status: 400, body: { error: 'payload.context obrigatório' } };
  }
  if (!isGeminiConfigured()) {
    return { status: 503, body: { ok: false, skipped: true, reason: 'gemini_not_configured' } };
  }

  const hintPrompt = [
    'Se detectar problema, risco ou inconsistência nos fatos, responda UMA frase curta e clara em português BR (máx. 200 caracteres), começando com ⚠️ ou 💡.',
    'Se estiver tudo normal, responda exatamente: OK',
  ].join(' ');

  try {
    const out = await callGemini({
      systemInstruction: `Você monitora o software contábil Eye Vision / ContabilFacil. ${hintPrompt}`,
      userContent: `Origem: ${source}\nContexto: ${context}\nDados: ${JSON.stringify(data).slice(0, 2000)}`,
      temperature: 0.2,
    });
    const hint = (out.text ?? '').trim();
    if (!hint || hint.toUpperCase() === 'OK') {
      return { status: 200, body: { ok: true, text: '', provider: 'gemini' } };
    }
    return { status: 200, body: { ok: true, text: hint, provider: 'gemini', model: out.model } };
  } catch (err) {
    return {
      status: 200,
      body: {
        ok: false,
        skipped: true,
        detail: err?.userHint ?? 'Gemini indisponível',
        reason: 'gemini_error',
      },
    };
  }
}

/** @param {string} pathname @param {string} method @param {unknown} body @param {URLSearchParams} [search] */
export async function dispatchGeminiApiRoute(pathname, method, body, search) {
  if (pathname === '/gemini/health' && method === 'GET') {
    return handleGeminiHealth({ deep: search?.get('deep') === '1' });
  }
  if (pathname === '/gemini/analyze-extrato-import' && method === 'POST') {
    return handleGeminiAnalyzeExtratoImport(body);
  }
  if (pathname === '/gemini/analyze-debug' && method === 'POST') {
    return handleGeminiAnalyzeDebug(body);
  }
  if (pathname === '/ai/extract-extrato' && method === 'POST') {
    return handleAiExtractExtrato(body);
  }
  if (pathname === '/ai/extract-plano' && method === 'POST') {
    return handleAiExtractPlano(body);
  }
  if (pathname === '/ai/extract-coligadas' && method === 'POST') {
    return handleAiExtractColigadas(body);
  }
  if (pathname === '/ai/extract-socios' && method === 'POST') {
    return handleAiExtractSocios(body);
  }
  if (pathname === '/ai/suggest-regras-contas' && method === 'POST') {
    return handleAiSuggestRegrasContas(body);
  }
  if (pathname === '/ai/suggest-modulo-contas' && method === 'POST') {
    return handleAiSuggestModuloContas(body);
  }
  if (pathname === '/ai/models' && method === 'GET') {
    return { status: 200, body: catalogForApi() };
  }
  if (pathname === '/assist' && method === 'POST') {
    const task = body?.task;
    if (task === 'proactive_hint') {
      return handleGeminiProactiveHint(body?.payload);
    }
    if (task === 'ocr_refine') {
      return handleAiRefineOcrRows(body?.payload ?? body);
    }
  }
  return null;
}
