/**
 * Catálogo IA — Gemini free tier (sem Ollama / Llama local).
 */

export const MAX_EMBEDDED_RAM_GB = 4;

export const EMBEDDED_AI_OPTIONS = {
  temperature: 0.75,
  top_p: 0.9,
  top_k: 40,
  repeat_penalty: 1.05,
  num_ctx: 768,
  num_predict: 128,
  num_thread: 1,
};

export const EMBEDDED_CHAT_FAST_OPTIONS = {
  temperature: 0.65,
  top_p: 0.85,
  top_k: 30,
  repeat_penalty: 1.05,
  num_ctx: 512,
  num_predict: 28,
  num_thread: 1,
};

export const EMBEDDED_AI_CATALOG = [
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    minRamGb: 0,
    maxRamGb: MAX_EMBEDDED_RAM_GB,
    description: 'Google Gemini free tier — auditoria OCR, debug e chat contábil.',
  },
];

export const DEFAULT_EMBEDDED_MODEL_ID = 'gemini-2.5-flash';

export function catalogEntry(modelId) {
  return EMBEDDED_AI_CATALOG.find((m) => m.id === modelId);
}

export function normalizeCatalogModelId(modelId) {
  const id = String(modelId || '').trim().split(':')[0];
  if (EMBEDDED_AI_CATALOG.some((m) => m.id === id)) return id;
  return DEFAULT_EMBEDDED_MODEL_ID;
}
