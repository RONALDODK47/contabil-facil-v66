/**
 * Roteador de IA — somente Gemini (free tier).
 */
import { cerebroChat } from './cerebro-agente.mjs';
import { DEFAULT_EMBEDDED_MODEL_ID } from './embedded-ai.mjs';
import { isGeminiConfigured } from './gemini-client.mjs';

let cachedEngine = null;
let cacheAt = 0;
const CACHE_MS = 8000;

async function detectEngine({ force = false } = {}) {
  if (!force && cachedEngine && Date.now() - cacheAt < CACHE_MS) return cachedEngine;

  const online = isGeminiConfigured();
  cachedEngine = {
    online,
    engine: online ? 'gemini' : 'none',
    baseUrl: null,
  };
  cacheAt = Date.now();
  return cachedEngine;
}

export function invalidateEngineCache() {
  cachedEngine = null;
  cacheAt = 0;
}

export async function resolveActiveEngine() {
  return detectEngine();
}

export async function ensureLocalAiEngine() {
  return detectEngine({ force: true });
}

export async function isLocalModelReady(_modelId) {
  const engine = await detectEngine();
  return engine.online;
}

export async function chatLocal({ model, messages, options = {} }) {
  const modelId = model || DEFAULT_EMBEDDED_MODEL_ID;
  const engine = await detectEngine();

  if (!engine.online) {
    throw new Error('Gemini indisponível — defina GEMINI_API_KEY no .env e reinicie npm run dev');
  }

  return cerebroChat({
    model: modelId,
    messages,
    fast: Boolean(options.fast),
    agent: Boolean(options.agent),
    signal: options.signal,
    onToken: options.onToken,
  });
}
