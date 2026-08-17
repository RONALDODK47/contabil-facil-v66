import { GoogleGenAI } from "@google/genai";
import {
  classifyGeminiError,
  extractGeminiErrorFields,
  formatGeminiErrorMessage,
  geminiModelsToTry,
  getGeminiApiKey,
  sanitizeGeminiModel,
} from "../gemini-client.mjs";

/** Modelo padrão alinhado ao free tier do projeto */
export const DEFAULT_GEMINI_MODEL = sanitizeGeminiModel("gemini-2.5-flash");

export { formatGeminiErrorMessage };

/** @type {Map<string, GoogleGenAI>} */
const clientCache = new Map();

/**
 * @param {string} [apiKey]
 * @returns {GoogleGenAI}
 */
export function getGeminiClient(apiKey) {
  const resolvedKey = apiKey?.trim() || getGeminiApiKey();
  if (!resolvedKey) {
    throw new Error(
      "A chave GEMINI_API_KEY não foi encontrada. Salve em Contábil → IA ou defina no .env.",
    );
  }

  if (!clientCache.has(resolvedKey)) {
    clientCache.set(
      resolvedKey,
      new GoogleGenAI({
        apiKey: resolvedKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      }),
    );
  }

  return clientCache.get(resolvedKey);
}

function retryWaitMs(error, attempt) {
  const { retryDelaySec } = extractGeminiErrorFields(error);
  if (retryDelaySec && retryDelaySec > 0) {
    return Math.ceil(retryDelaySec * 1000) + 500;
  }
  return 1500 * attempt;
}

/**
 * @param {GoogleGenAI} ai
 * @param {string} model
 * @param {unknown[]} contents
 * @param {Record<string, unknown>} config
 * @param {number} [perModelRetries=2]
 * @returns {Promise<{ text?: string, [key: string]: unknown }>}
 */
export async function generateContentWithRetry(ai, model, contents, config, perModelRetries = 2) {
  const candidates = geminiModelsToTry(model);
  let lastMessage = "Falha na chamada ao Gemini.";

  for (let modelIndex = 0; modelIndex < candidates.length; modelIndex++) {
    const currentModel = candidates[modelIndex];

    for (let attempt = 1; attempt <= perModelRetries; attempt++) {
      try {
        console.log(
          `[Gemini API] Modelo ${currentModel} (${modelIndex + 1}/${candidates.length}, tentativa ${attempt}/${perModelRetries})`,
        );
        const response = await ai.models.generateContent({
          model: currentModel,
          contents,
          config,
        });
        return response;
      } catch (error) {
        const info = classifyGeminiError(error);
        lastMessage = info.userMessage;
        console.warn(`[Gemini API] ${currentModel} falhou (${info.kind}): ${lastMessage.slice(0, 200)}`);

        if (info.switchModel && modelIndex < candidates.length - 1) {
          console.log(`[Gemini API] Trocando para ${candidates[modelIndex + 1]}…`);
          break;
        }

        if (info.retryable && attempt < perModelRetries) {
          const waitMs = retryWaitMs(error, attempt);
          console.log(`[Gemini API] Aguardando ${waitMs}ms antes de retry…`);
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }

        if (!info.retryable) {
          throw new Error(info.userMessage);
        }

        break;
      }
    }
  }

  throw new Error(lastMessage);
}
