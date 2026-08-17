import { readPersistedLocalStorageJson, writePersistedLocalStorageJson } from '../../persistentLocalStorage';
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from '../../safeLocalStorage';
import type { AIVisionModelOption, AIVisionSettings } from './types';

/**
 * Catálogo de modelos com suporte a visão, usado como fallback antes de sincronizar com a chave
 * de API informada. Assim que uma chave válida é informada, a lista real vem de
 * `fetchAvailableVisionModels()`, direto da API do Google.
 */
export const AI_VISION_MODELS: AIVisionModelOption[] = [
  {
    id: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    tier: 'free',
    description: 'Modelo atual mais rápido com cota gratuita generosa. Boa opção padrão para ler documentos escaneados e anotações à caneta.',
  },
  {
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite',
    tier: 'free',
    description: 'Mais barato/rápido que o 3.6 Flash, também com cota gratuita — bom para documentos grandes com muitas páginas.',
  },
  {
    id: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro',
    tier: 'paid',
    description: 'Modelo pago, mais preciso para documentos longos ou com letra muito difícil de ler.',
  },
];

const isNotVisionCapable = (name: string): boolean =>
  /embedding|aqa|imagen|veo\b|[-_]tts|text-bison|chat-bison|gecko|learnlm|computer-use|[-_]image\b|lyria|omni-flash|native-audio/i.test(name);

export const fetchAvailableVisionModels = async (apiKeyRaw: string): Promise<AIVisionModelOption[]> => {
  const apiKey = (apiKeyRaw || '').trim();
  if (!apiKey) throw new Error('Chave de API vazia.');

  // Import dinâmico: @google/genai é uma lib pesada — só deve entrar no bundle quando o
  // usuário realmente for sincronizar modelos (motor OCR IA), nunca no carregamento do OCR Local.
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });
  const pager = await ai.models.list({ config: { pageSize: 100 } });

  const options: AIVisionModelOption[] = [];
  for await (const m of pager) {
    const rawName = m.name || '';
    const shortId = rawName.replace(/^models\//, '');
    if (!shortId || isNotVisionCapable(shortId)) continue;
    if (!/^gemini-/i.test(shortId)) continue;

    const tier: 'free' | 'paid' = /flash/i.test(shortId) ? 'free' : 'paid';

    options.push({
      id: shortId,
      label: m.displayName || shortId,
      tier,
      description: m.description || `Modelo ${shortId} (sincronizado da API do Google).`,
    });
  }

  options.sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
  return options;
};

const MODELS_CACHE_KEY = 'contabilfacil_ai_vision_models_cache_v1';
const MODELS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface ModelsCache {
  apiKeyFingerprint: string;
  fetchedAt: number;
  models: AIVisionModelOption[];
}

const fingerprint = (s: string): string => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
};

const readModelsCache = (apiKey: string): AIVisionModelOption[] | null => {
  try {
    const raw = safeLocalStorageGetItem(MODELS_CACHE_KEY);
    if (!raw) return null;
    const cache: ModelsCache = JSON.parse(raw);
    if (cache.apiKeyFingerprint !== fingerprint(apiKey)) return null;
    if (Date.now() - cache.fetchedAt > MODELS_CACHE_TTL_MS) return null;
    return cache.models;
  } catch {
    return null;
  }
};

const writeModelsCache = (apiKey: string, models: AIVisionModelOption[]): void => {
  const cache: ModelsCache = { apiKeyFingerprint: fingerprint(apiKey), fetchedAt: Date.now(), models };
  safeLocalStorageSetItem(MODELS_CACHE_KEY, JSON.stringify(cache));
};

/** Ponto único usado pela UI para obter a lista de modelos (cache de 6h, ou sincroniza de novo). */
export const getSyncedVisionModels = async (apiKeyRaw: string, forceRefresh = false): Promise<AIVisionModelOption[]> => {
  const apiKey = (apiKeyRaw || '').trim();
  if (!forceRefresh) {
    const cached = readModelsCache(apiKey);
    if (cached && cached.length > 0) return cached;
  }
  const fresh = await fetchAvailableVisionModels(apiKey);
  if (fresh.length > 0) writeModelsCache(apiKey, fresh);
  return fresh;
};

export const maskApiKey = (apiKeyRaw: string): string => {
  const k = (apiKeyRaw || '').trim();
  if (k.length <= 8) return k ? `${k[0]}***` : '(vazia)';
  return `${k.slice(0, 6)}...${k.slice(-4)} (${k.length} caracteres)`;
};

const STORAGE_KEY = 'contabilfacil_ai_vision_settings';

export const DEFAULT_AI_VISION_SETTINGS: AIVisionSettings = {
  apiKey: '',
  modelId: AI_VISION_MODELS[0].id,
};

const isKnownDeprecatedModelId = (modelId: string): boolean => /^gemini-(1\.5|2\.0|2\.5)-/i.test(modelId || '');

export const loadAIVisionSettings = (): AIVisionSettings => {
  const merged = readPersistedLocalStorageJson<AIVisionSettings>(STORAGE_KEY, DEFAULT_AI_VISION_SETTINGS);
  if (isKnownDeprecatedModelId(merged.modelId)) {
    return { ...merged, modelId: DEFAULT_AI_VISION_SETTINGS.modelId };
  }
  return merged;
};

export const saveAIVisionSettings = (settings: AIVisionSettings): void => {
  writePersistedLocalStorageJson(STORAGE_KEY, settings);
};

export const getModelOption = (modelId: string): AIVisionModelOption | undefined =>
  AI_VISION_MODELS.find((m) => m.id === modelId);
