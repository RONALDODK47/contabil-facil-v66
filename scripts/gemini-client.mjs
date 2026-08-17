/**
 * Cliente Google Gemini — só modelos com cota gratuita (free tier).
 */
import { fetch as undiciFetch } from 'undici';
import { getApiKeyForProvider } from './ai-secrets-store.mjs';

/** Modelo padrão — cota free tier confirmada (evitar gemini-2.0-flash: limit 0). */
const DEFAULT_MODEL = 'gemini-2.5-flash';

/**
 * Modelos permitidos, em ordem de preferência.
 * Não incluir gemini-2.0-flash* — cota zero em chaves free tier novas.
 */
export const FREE_TIER_MODEL_CHAIN = [
  'gemini-1.5-flash',
  'gemini-2.5-flash',
  'gemini-3-flash-preview',
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite-preview',
  'gemini-flash-lite-latest',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
];

/** Só modelos fortes — regras de contas / conciliação precisa (sem lite). */
export const STRONG_GEMINI_MODEL_CHAIN = [
  'gemini-2.5-flash',
  'gemini-3-flash-preview',
  'gemini-2.5-pro',
];

const WEAK_GEMINI_PATTERNS = [/lite/i, /8b/i, /haiku/i, /instant/i];

/** Padrões bloqueados — sem cota free ou indisponíveis na API v1beta. */
const BLOCKED_MODEL_PATTERNS = [
  /^gemini-2\.0-flash/i,
  /-image/i,
  /-tts/i,
  /embedding/i,
];

const REQUEST_TIMEOUT_MS = 90_000;
/** Extração de extrato (visão + JSON grande) — mais tempo e mais tokens de saída. */
export const EXTRACT_REQUEST_TIMEOUT_MS = 180_000;
export const EXTRACT_MAX_OUTPUT_TOKENS = 65_536;

/** @type {{ model: string; at: number } | null} */
let lastWorkingModel = null;
const WORKING_MODEL_TTL_MS = 10 * 60_000;

export function getGeminiApiKey() {
  const fromStore = getApiKeyForProvider('gemini');
  if (fromStore.key) return fromStore.key;
  const raw = String(process.env.GEMINI_API_KEY || '').trim();
  return raw.replace(/^['"]|['"]$/g, '');
}

export function isGeminiConfigured() {
  const key = getGeminiApiKey();
  return key.length > 10 && !key.includes('MY_GEMINI');
}

export function isFreeTierGeminiModel(model) {
  const id = String(model ?? '').trim();
  if (!id) return false;
  return !BLOCKED_MODEL_PATTERNS.some((pattern) => pattern.test(id));
}

/** Garante que só modelos free tier sejam usados. */
export function sanitizeGeminiModel(model) {
  const id = String(model ?? '').trim();
  if (!id || !isFreeTierGeminiModel(id)) {
    return DEFAULT_MODEL;
  }
  return id;
}

/** Modelo forte para regras de contas — nunca lite/mini. */
export function sanitizeStrongGeminiModel(model) {
  const id = String(model ?? '').trim();
  if (id && isFreeTierGeminiModel(id) && !WEAK_GEMINI_PATTERNS.some((p) => p.test(id))) {
    return id;
  }
  return DEFAULT_MODEL;
}

export function geminiModelId() {
  return sanitizeGeminiModel(process.env.GEMINI_MODEL || DEFAULT_MODEL);
}

export function listFreeTierGeminiModels() {
  return [...FREE_TIER_MODEL_CHAIN];
}

function modelsToTry(preferred, chain = FREE_TIER_MODEL_CHAIN) {
  const safePreferred = sanitizeGeminiModel(preferred);
  const recent =
    lastWorkingModel && Date.now() - lastWorkingModel.at < WORKING_MODEL_TTL_MS
      ? lastWorkingModel.model
      : null;

  const chainFiltered = chain.filter((m) => isFreeTierGeminiModel(m));

  const merged = [
    recent,
    safePreferred,
    ...chainFiltered,
  ].filter(Boolean);

  return [...new Set(merged)].filter((m) => isFreeTierGeminiModel(m));
}

function parseGeminiError(status, errText) {
  try {
    const parsed = JSON.parse(errText);
    const msg = parsed?.error?.message ?? errText;
    if (status === 429 && /limit:\s*0/i.test(msg)) {
      return {
        retryable: true,
        switchModel: true,
        userHint: 'Modelo sem cota gratuita — trocando para outro modelo free tier…',
        raw: msg,
        noFreeQuota: true,
      };
    }
    if (status === 429) {
      return {
        retryable: true,
        switchModel: true,
        userHint: 'Limite temporário do Gemini — tentando modelo alternativo free tier…',
        raw: msg,
      };
    }
    if (status === 404) {
      return { retryable: true, switchModel: true, userHint: 'Modelo indisponível nesta chave.', raw: msg };
    }
    if (status === 400 && /API key/i.test(msg)) {
      return {
        retryable: false,
        switchModel: false,
        userHint: 'Chave GEMINI_API_KEY inválida — gere uma nova em aistudio.google.com/apikey',
        raw: msg,
      };
    }
    return { retryable: status >= 500, switchModel: status >= 500, userHint: msg, raw: msg };
  } catch {
    return { retryable: status >= 500, switchModel: false, userHint: errText.slice(0, 300), raw: errText };
  }
}

/**
 * Extrai status/mensagem de erros do SDK @google/genai ou JSON em string.
 * @param {unknown} error
 */
export function extractGeminiErrorFields(error) {
  const directStatus = Number(error?.status || error?.statusCode || 0) || 0;
  let raw =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : JSON.stringify(error);

  /** @type {{ message: string, status: number, retryDelaySec?: number }} */
  const fields = { message: raw, status: directStatus };

  if (error && typeof error === 'object' && error.error?.message) {
    fields.message = String(error.error.message);
    fields.status = Number(error.error.code || error.error.status || directStatus) || directStatus;
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed?.error?.message) {
      fields.message = String(parsed.error.message);
      fields.status = Number(parsed.error.code || parsed.error.status || fields.status) || fields.status;
    }
  } catch {
    const jsonStart = raw.indexOf('{"error"');
    if (jsonStart >= 0) {
      try {
        const parsed = JSON.parse(raw.slice(jsonStart));
        if (parsed?.error?.message) {
          fields.message = String(parsed.error.message);
          fields.status = Number(parsed.error.code || parsed.error.status || fields.status) || fields.status;
        }
      } catch {
        /* ignore */
      }
    }
  }

  const delayMatch = `${raw}\n${fields.message}`.match(
    /retry(?:Delay|In)?["']?\s*[:=]\s*"?(\d+(?:\.\d+)?)s"?/i,
  );
  if (delayMatch) fields.retryDelaySec = Number(delayMatch[1]);

  return fields;
}

/**
 * Classifica erro Gemini para mensagem correta (evita falso "cota esgotada").
 * @param {unknown} error
 */
export function classifyGeminiError(error) {
  const { message, status, retryDelaySec } = extractGeminiErrorFields(error);
  const msg = message;

  if (status === 400 && /API key/i.test(msg)) {
    return {
      kind: 'invalid_key',
      userMessage:
        'Chave GEMINI_API_KEY inválida — gere uma nova em aistudio.google.com/apikey e salve em Contábil → IA.',
      retryable: false,
      switchModel: false,
    };
  }
  if (status === 404 || /not found|is not supported/i.test(msg)) {
    return {
      kind: 'model_not_found',
      userMessage: 'Modelo de IA indisponível nesta chave. Troque para gemini-2.5-flash em Contábil → IA.',
      retryable: true,
      switchModel: true,
    };
  }
  if (status === 429 && /limit:\s*0/i.test(msg)) {
    return {
      kind: 'model_no_free_quota',
      userMessage:
        'O modelo selecionado não tem cota gratuita (limit: 0). Troque para gemini-2.5-flash em Contábil → IA.',
      retryable: true,
      switchModel: true,
    };
  }
  if (status === 429 || /RESOURCE_EXHAUSTED/i.test(msg)) {
    const waitHint = retryDelaySec
      ? ` Aguarde ~${Math.ceil(retryDelaySec)}s e tente novamente.`
      : ' Aguarde cerca de 1 minuto e tente novamente.';
    return {
      kind: 'rate_limit',
      userMessage: `Limite temporário de requisições do Gemini.${waitHint}`,
      retryable: true,
      switchModel: true,
    };
  }
  if (status === 503 || /UNAVAILABLE|high demand/i.test(msg)) {
    return {
      kind: 'unavailable',
      userMessage: 'Gemini temporariamente indisponível — tentando novamente…',
      retryable: true,
      switchModel: true,
    };
  }

  const trimmed = msg.length > 320 ? `${msg.slice(0, 320)}…` : msg;
  return {
    kind: 'other',
    userMessage: trimmed || 'Falha na chamada ao Gemini.',
    retryable: status >= 500,
    switchModel: false,
  };
}

/** Mensagem amigável — só fala em "cota" quando o erro é realmente 429/RESOURCE_EXHAUSTED. */
export function formatGeminiErrorMessage(error) {
  return classifyGeminiError(error).userMessage;
}

/** Modelos free tier a tentar, em ordem. */
export function geminiModelsToTry(preferred) {
  return modelsToTry(sanitizeGeminiModel(preferred), FREE_TIER_MODEL_CHAIN);
}

async function callGeminiOnce(model, key, params, signal) {
  const parts = [{ text: params.userContent }];
  if (params.images?.length) {
    for (const img of params.images) {
      if (img?.base64 && img?.mimeType) {
        parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } });
      }
    }
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  const body = {
    ...(params.systemInstruction
      ? { systemInstruction: { parts: [{ text: params.systemInstruction }] } }
      : {}),
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: params.temperature ?? 0,
      maxOutputTokens: params.maxOutputTokens ?? 8192,
      ...(params.jsonMode ? { responseMimeType: 'application/json' } : {}),
      ...(params.responseSchema ? { responseSchema: params.responseSchema } : {}),
    },
  };

  const res = await undiciFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text();
    const info = parseGeminiError(res.status, errText);
    const err = new Error(info.userHint || info.raw.slice(0, 200));
    err.status = res.status;
    err.retryable = info.retryable;
    err.userHint = info.userHint;
    err.model = model;
    err.noFreeQuota = info.noFreeQuota;
    throw err;
  }

  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((p) => p?.text)
      .filter(Boolean)
      .join('') ?? '';

  if (!text.trim()) {
    const block = data?.candidates?.[0]?.finishReason;
    throw new Error(`Gemini resposta vazia${block ? ` (${block})` : ''}`);
  }

  return { text: text.trim(), model, raw: data };
}

/**
 * @param {{ systemInstruction?: string; userContent: string; temperature?: number; jsonMode?: boolean; signal?: AbortSignal; model?: string; strongOnly?: boolean }} params
 */
export async function callGemini(params) {
  const key = getGeminiApiKey();
  if (!key) {
    throw new Error('Chave Gemini não configurada — salve em Contábil → IA → Pastas de chaves');
  }

  const controller = new AbortController();
  const timeoutMs = params.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = params.signal ?? controller.signal;

  const preferred = params.strongOnly
    ? sanitizeStrongGeminiModel(params.model ?? geminiModelId())
    : sanitizeGeminiModel(params.model ?? geminiModelId());
  const chain = params.strongOnly ? STRONG_GEMINI_MODEL_CHAIN : FREE_TIER_MODEL_CHAIN;
  const candidates = modelsToTry(preferred, chain);
  /** @type {Error | null} */
  let lastErr = null;

  try {
    for (let i = 0; i < candidates.length; i++) {
      const model = candidates[i];
      try {
        const out = await callGeminiOnce(model, key, params, signal);
        lastWorkingModel = { model: out.model, at: Date.now() };
        if (model !== preferred) {
          console.info(`[gemini] Usando ${out.model} (free tier)`);
        }
        return out;
      } catch (err) {
        lastErr = err;
        const hasNext = i < candidates.length - 1;
        if (err?.retryable && hasNext) {
          console.warn(`[gemini] ${model} falhou — tentando ${candidates[i + 1]}…`);
          continue;
        }
        throw err;
      }
    }
    throw lastErr ?? new Error('Nenhum modelo Gemini free tier disponível');
  } finally {
    clearTimeout(timer);
  }
}

/** Chamada multimodal (imagem + texto). */
export async function callGeminiVision(params) {
  const images = Array.isArray(params.images) ? params.images : [];
  return callGemini({
    ...params,
    userContent: params.userText ?? params.userContent ?? '',
    images,
  });
}

/** Ping real — só conta online se algum modelo free tier responder. */
export async function pingGeminiApi() {
  if (!isGeminiConfigured()) {
    return { ok: false, configured: false, detail: 'GEMINI_API_KEY ausente no .env' };
  }
  try {
    const out = await callGemini({
      userContent: 'Responda exatamente: OK',
      temperature: 0,
    });
    return {
      ok: true,
      configured: true,
      model: out.model,
      freeTier: true,
      detail: `Gemini free tier online (${out.model})`,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      freeTier: false,
      detail:
        err?.userHint ??
        'Nenhum modelo free tier respondeu — confira a chave em aistudio.google.com/apikey',
    };
  }
}

function stripJsonCodeFences(raw) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : raw;
}

/** Recupera rows completas de JSON truncado (MAX_TOKENS). */
export function salvageExtratoAiJson(raw) {
  const text = String(raw ?? '');
  const rowsKey = text.search(/"rows"\s*:/i);
  if (rowsKey < 0) return null;
  const arrStart = text.indexOf('[', rowsKey);
  if (arrStart < 0) return null;

  const rows = [];
  let depth = 0;
  let objStart = -1;
  for (let i = arrStart + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart >= 0) {
        try {
          rows.push(JSON.parse(text.slice(objStart, i + 1)));
        } catch {
          /* objeto incompleto */
        }
        objStart = -1;
      }
    }
  }
  if (rows.length === 0) return null;

  const result = { rows };
  const saMatch = text.match(/"saldoAnterior"\s*:\s*(-?[\d.]+)/i);
  const sfMatch = text.match(/"saldoFinal"\s*:\s*(-?[\d.]+)/i);
  if (saMatch) result.saldoAnterior = Number(saMatch[1]);
  if (sfMatch) result.saldoFinal = Number(sfMatch[1]);
  return result;
}

export function parseGeminiJson(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;

  const candidates = [
    raw,
    stripJsonCodeFences(raw),
    raw.match(/\{[\s\S]*\}/)?.[0],
    raw.match(/\[[\s\S]*\]/)?.[0],
  ].filter(Boolean);

  for (const candidate of [...new Set(candidates)]) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      /* tenta próximo */
    }
  }

  return salvageExtratoAiJson(raw);
}
