/**
 * Catálogo unificado de modelos IA — free, limitado e pago.
 * Espelhado no frontend (aiModelCatalog.ts).
 */

/** @typedef {'free' | 'limited' | 'paid'} AiPricingTier */
/** @typedef {'gemini' | 'openai' | 'anthropic' | 'groq' | 'mistral'} AiProviderId */

/** @type {Array<{ id: string; providerId: AiProviderId; label: string; tier: AiPricingTier; tierLabel: string; hint?: string; supportsVision?: boolean; supportsExtract?: boolean }>} */
export const AI_MODEL_CATALOG = [
  // —— Gemini ——
  { id: 'gemini-2.5-flash', providerId: 'gemini', label: 'Gemini 2.5 Flash', tier: 'free', tierLabel: 'Grátis', hint: 'Recomendado · cota free tier', supportsVision: true, supportsExtract: true },
  { id: 'gemini-2.5-flash-lite', providerId: 'gemini', label: 'Gemini 2.5 Flash Lite', tier: 'free', tierLabel: 'Grátis', hint: 'Mais rápido, menor custo', supportsVision: true, supportsExtract: true },
  { id: 'gemini-flash-lite-latest', providerId: 'gemini', label: 'Gemini Flash Lite (latest)', tier: 'free', tierLabel: 'Grátis', supportsVision: true, supportsExtract: true },
  { id: 'gemini-3-flash-preview', providerId: 'gemini', label: 'Gemini 3 Flash Preview', tier: 'limited', tierLabel: 'Grátis limitado', hint: 'Preview · quota reduzida', supportsVision: true, supportsExtract: true },
  { id: 'gemini-3.1-flash-lite-preview', providerId: 'gemini', label: 'Gemini 3.1 Flash Lite Preview', tier: 'limited', tierLabel: 'Grátis limitado', supportsVision: true, supportsExtract: true },
  { id: 'gemini-2.5-pro', providerId: 'gemini', label: 'Gemini 2.5 Pro', tier: 'paid', tierLabel: 'Pago', hint: 'Requer billing Google AI', supportsVision: true, supportsExtract: true },
  { id: 'gemini-2.0-flash', providerId: 'gemini', label: 'Gemini 2.0 Flash', tier: 'paid', tierLabel: 'Pago', hint: 'Sem cota free em chaves novas', supportsVision: true, supportsExtract: true },

  // —— OpenAI ——
  { id: 'gpt-4o-mini', providerId: 'openai', label: 'GPT-4o Mini', tier: 'limited', tierLabel: 'Grátis limitado', hint: 'Créditos iniciais / pay-as-you-go', supportsVision: true, supportsExtract: true },
  { id: 'gpt-4o', providerId: 'openai', label: 'GPT-4o', tier: 'paid', tierLabel: 'Pago', supportsVision: true, supportsExtract: true },
  { id: 'gpt-4.1-mini', providerId: 'openai', label: 'GPT-4.1 Mini', tier: 'paid', tierLabel: 'Pago', supportsVision: true, supportsExtract: true },
  { id: 'gpt-4.1', providerId: 'openai', label: 'GPT-4.1', tier: 'paid', tierLabel: 'Pago', supportsVision: true, supportsExtract: true },

  // —— Anthropic ——
  { id: 'claude-3-5-haiku-latest', providerId: 'anthropic', label: 'Claude 3.5 Haiku', tier: 'limited', tierLabel: 'Grátis limitado', hint: 'Créditos trial Anthropic', supportsVision: true, supportsExtract: true },
  { id: 'claude-sonnet-4-20250514', providerId: 'anthropic', label: 'Claude Sonnet 4', tier: 'paid', tierLabel: 'Pago', supportsVision: true, supportsExtract: true },
  { id: 'claude-opus-4-20250514', providerId: 'anthropic', label: 'Claude Opus 4', tier: 'paid', tierLabel: 'Pago', supportsVision: true, supportsExtract: true },

  // —— Groq (free tier generoso) ——
  { id: 'llama-3.3-70b-versatile', providerId: 'groq', label: 'Llama 3.3 70B (Groq)', tier: 'free', tierLabel: 'Grátis', hint: 'Groq free tier · só texto', supportsVision: false, supportsExtract: false },
  { id: 'llama-3.1-8b-instant', providerId: 'groq', label: 'Llama 3.1 8B Instant', tier: 'free', tierLabel: 'Grátis', supportsVision: false, supportsExtract: false },

  // —— Mistral ——
  { id: 'mistral-small-latest', providerId: 'mistral', label: 'Mistral Small', tier: 'limited', tierLabel: 'Grátis limitado', supportsVision: false, supportsExtract: true },
  { id: 'mistral-large-latest', providerId: 'mistral', label: 'Mistral Large', tier: 'paid', tierLabel: 'Pago', supportsVision: false, supportsExtract: true },
];

/** @type {Array<{ id: AiProviderId; label: string; keyEnvVar: string; docsUrl: string }>} */
export const AI_PROVIDERS = [
  { id: 'gemini', label: 'Google Gemini', keyEnvVar: 'GEMINI_API_KEY', docsUrl: 'https://aistudio.google.com/apikey' },
  { id: 'openai', label: 'OpenAI', keyEnvVar: 'OPENAI_API_KEY', docsUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', label: 'Anthropic Claude', keyEnvVar: 'ANTHROPIC_API_KEY', docsUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'groq', label: 'Groq', keyEnvVar: 'GROQ_API_KEY', docsUrl: 'https://console.groq.com/keys' },
  { id: 'mistral', label: 'Mistral AI', keyEnvVar: 'MISTRAL_API_KEY', docsUrl: 'https://console.mistral.ai/api-keys' },
];

export function findModelInCatalog(modelId) {
  const id = String(modelId ?? '').trim();
  return AI_MODEL_CATALOG.find((m) => m.id === id) ?? null;
}

/** Modelos fracos — não servem para regras de contas / conciliação precisa. */
const WEAK_MODEL_PATTERNS = [/lite/i, /-mini/i, /8b/i, /haiku/i, /instant/i];

export function isWeakAiModel(m) {
  const id = String(m?.id ?? '').trim();
  return WEAK_MODEL_PATTERNS.some((p) => p.test(id));
}

export function modelDaContaDoRecado(m) {
  if (m.supportsExtract !== true || m.supportsVision === false) return false;
  if (isWeakAiModel(m)) return false;
  return true;
}

export function modelsForProvider(providerId) {
  return AI_MODEL_CATALOG.filter((m) => m.providerId === providerId);
}

/** Só modelos com visão + extração (extrato / conciliação). */
export function modelsCapableForProvider(providerId) {
  return modelsForProvider(providerId).filter(modelDaContaDoRecado);
}

export function modelsByTier(tier) {
  return AI_MODEL_CATALOG.filter((m) => m.tier === tier);
}

export function normalizeSelectedModel(providerId, modelId) {
  const hit = findModelInCatalog(modelId);
  if (hit && hit.providerId === providerId && modelDaContaDoRecado(hit)) return hit.id;
  const fallback =
    AI_MODEL_CATALOG.find((m) => m.providerId === providerId && modelDaContaDoRecado(m)) ??
    AI_MODEL_CATALOG.find((m) => m.providerId === providerId && m.supportsExtract);
  return fallback?.id ?? 'gemini-2.5-flash';
}

export function catalogForApi() {
  return {
    providers: AI_PROVIDERS,
    models: AI_MODEL_CATALOG,
    tiers: [
      { id: 'free', label: 'Totalmente grátis', description: 'Cota gratuita permanente ou generosa' },
      { id: 'limited', label: 'Grátis limitado', description: 'Trial, preview ou quota diária reduzida' },
      { id: 'paid', label: 'Somente pago', description: 'Requer billing ativo na plataforma' },
    ],
  };
}
