import { GoogleGenAI } from '@google/genai';
import { AIVisionModelOption, AIVisionSettings } from '../types';

/**
 * Catálogo de modelos de IA com suporte a visão, usado como FALLBACK enquanto nenhuma chave de
 * API foi digitada ainda (para a tela não ficar vazia) ou se a sincronização com o Google
 * falhar. Assim que uma chave válida é informada, a lista real vem de
 * `fetchAvailableVisionModels()`, direto da API do Google — então modelos novos aparecem
 * sozinhos e modelos que o Google aposentou somem sozinhos, sem precisar mexer no código.
 */
export const AI_VISION_MODELS: AIVisionModelOption[] = [
  {
    id: 'gemini-3.6-flash',
    provider: 'gemini',
    label: 'Gemini 3.6 Flash',
    tier: 'free',
    description: 'Modelo atual mais rápido com cota gratuita generosa. Boa opção padrão para ler extratos escaneados e anotações à caneta.',
  },
  {
    id: 'gemini-3.5-flash-lite',
    provider: 'gemini',
    label: 'Gemini 3.5 Flash-Lite',
    tier: 'free',
    description: 'Mais barato/rápido que o 3.6 Flash, também com cota gratuita — bom para extratos grandes com muitas páginas.',
  },
  {
    id: 'gemini-3.1-pro-preview',
    provider: 'gemini',
    label: 'Gemini 3.1 Pro',
    tier: 'paid',
    description: 'Modelo pago, mais preciso para extratos longos ou com letra muito difícil de ler.',
  },
];

export const AI_VISION_MODELS_BY_TIER = {
  free: AI_VISION_MODELS.filter(m => m.tier === 'free'),
  paid: AI_VISION_MODELS.filter(m => m.tier === 'paid'),
};

/**
 * Nomes de modelo que NÃO servem para LER uma página escaneada como esta ferramenta precisa:
 * modelos de geração de imagem/vídeo/áudio (Nano Banana, TTS, Lyria, Veo), computer-use,
 * embeddings etc. entendem/produzem mídia mas não são o que queremos aqui (entender uma tabela
 * escaneada e devolver texto/JSON).
 */
const isNotVisionCapable = (name: string): boolean =>
  /embedding|aqa|imagen|veo\b|[-_]tts|text-bison|chat-bison|gecko|learnlm|computer-use|[-_]image\b|lyria|omni-flash|native-audio/i.test(name);

/**
 * Busca, DIRETO na API do Google, a lista atual de modelos Gemini que aceitam imagem como
 * entrada. Isso é o que garante a sincronização pedida: se o Google lançar um modelo novo, ele
 * aparece aqui na próxima vez que a lista for atualizada; se o Google aposentar um modelo (ele
 * some do `models.list()` da conta), ele deixa de aparecer automaticamente — nunca fica um
 * modelo "morto" nas opções.
 *
 * Nota: NÃO filtramos por `supportedActions` aqui de propósito — esse campo já mudou de
 * significado entre gerações da API (generateContent → Interactions), e um filtro rígido nele
 * corre o risco de zerar a lista inteira só porque o Google renomeou o rótulo interno da ação,
 * mesmo com todos os modelos funcionando normalmente. A filtragem é feita só pelo NOME do
 * modelo (prefixo "gemini-" + exclusão de modelos de geração de imagem/áudio/vídeo).
 */
export const fetchAvailableVisionModels = async (apiKeyRaw: string): Promise<AIVisionModelOption[]> => {
  // Defensivo: espaço/quebra de linha invisível colado junto da chave (comum em copiar/colar)
  // faz o Google recusar a chave com "API key not valid" mesmo que ela esteja certa.
  const apiKey = (apiKeyRaw || '').trim();
  if (!apiKey) throw new Error('Chave de API vazia.');

  const ai = new GoogleGenAI({ apiKey });
  const pager = await ai.models.list({ config: { pageSize: 100 } });

  const options: AIVisionModelOption[] = [];
  for await (const m of pager) {
    const rawName = m.name || '';
    const shortId = rawName.replace(/^models\//, '');
    if (!shortId || isNotVisionCapable(shortId)) continue;

    // Todo modelo de chat "gemini-*" atual aceita imagem como entrada (multimodal nativo).
    if (!/^gemini-/i.test(shortId)) continue;

    // Heurística de custo: modelos "flash"/"flash-lite" têm a maior cota gratuita na Google AI
    // Studio; "pro" tem cota gratuita bem menor e é o mais indicado para uso pago. Isso é só
    // uma indicação visual — o que realmente decide grátis/pago é a conta/chave usada no Google.
    const tier: 'free' | 'paid' = /flash/i.test(shortId) ? 'free' : 'paid';

    options.push({
      id: shortId,
      provider: 'gemini',
      label: m.displayName || shortId,
      tier,
      description: m.description || `Modelo ${shortId} (sincronizado da API do Google).`,
    });
  }

  // Modelos mais novos primeiro (nomes do Gemini são cronologicamente ordenáveis: 2.5 > 2.0 > 1.5).
  options.sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
  return options;
};

// v2: mudou de nome de propósito para invalidar qualquer cache salvo antes da migração para a
// Interactions API + modelos gemini-3.x (o cache antigo podia ter ficado com modelos gemini-2.x
// já depreciados pelo Google).
const MODELS_CACHE_KEY = 'aiVisionModelsCache_v2';
const MODELS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — depois disso, sincroniza de novo com o Google

interface ModelsCache {
  apiKeyFingerprint: string; // não guardamos a chave aqui, só um hash simples pra saber se mudou
  fetchedAt: number;
  models: AIVisionModelOption[];
}

const fingerprint = (s: string): string => {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return String(h);
};

const readModelsCache = (apiKey: string): AIVisionModelOption[] | null => {
  try {
    const raw = localStorage.getItem(MODELS_CACHE_KEY);
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
  localStorage.setItem(MODELS_CACHE_KEY, JSON.stringify(cache));
};

/**
 * Ponto único usado pela UI para obter a lista de modelos: usa o cache (válido por 6h) se
 * existir e `forceRefresh` não tiver sido pedido; senão sincroniza de novo com o Google. Isso
 * garante que a lista mostrada ao usuário está sempre alinhada com o que o Google está rodando
 * agora, sem bater na API a cada abertura da tela.
 */
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

/** Versão mascarada da chave, só pra confirmar visualmente qual chave está sendo usada de fato
 * (ex: "AIzaSyAB...x9Z2", 24 caracteres) sem expor o valor completo em logs/alertas. */
export const maskApiKey = (apiKeyRaw: string): string => {
  const k = (apiKeyRaw || '').trim();
  if (k.length <= 8) return k ? `${k[0]}***` : '(vazia)';
  return `${k.slice(0, 6)}...${k.slice(-4)} (${k.length} caracteres)`;
};

const STORAGE_KEY = 'aiVisionSettings';

export const DEFAULT_AI_VISION_SETTINGS: AIVisionSettings = {
  provider: 'gemini',
  apiKeys: {},
  modelId: AI_VISION_MODELS[0].id,
};

/** gemini-2.x e gemini-1.5-x foram depreciados pelo Google em favor da linha gemini-3.x. */
const isKnownDeprecatedModelId = (modelId: string): boolean => /^gemini-(1\.5|2\.0|2\.5)-/i.test(modelId || '');

export const loadAIVisionSettings = (): AIVisionSettings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AI_VISION_SETTINGS;
    const parsed = JSON.parse(raw);
    const merged: AIVisionSettings = { ...DEFAULT_AI_VISION_SETTINGS, ...parsed };
    // Salvaguarda offline: mesmo sem conseguir sincronizar com o Google agora, nunca deixa a
    // config presa num modelo que a gente já sabe estar depreciado.
    if (isKnownDeprecatedModelId(merged.modelId)) {
      merged.modelId = DEFAULT_AI_VISION_SETTINGS.modelId;
    }
    return merged;
  } catch {
    return DEFAULT_AI_VISION_SETTINGS;
  }
};

export const saveAIVisionSettings = (settings: AIVisionSettings): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
};

export const getModelOption = (modelId: string): AIVisionModelOption | undefined =>
  AI_VISION_MODELS.find(m => m.id === modelId);
