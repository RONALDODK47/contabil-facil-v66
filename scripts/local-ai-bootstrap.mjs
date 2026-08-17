/**
 * Bootstrap IA — verifica Gemini free tier no startup.
 */
import { loadAiConfig, saveAiConfig, resolveLocalModelId } from './ai-config-store.mjs';
import { localAiDisplayLabel } from './local-ai-labels.mjs';
import { DEFAULT_EMBEDDED_MODEL_ID } from './embedded-ai.mjs';
import { analyzeSystemProfile } from './ai-system-profile.mjs';
import { resolveHardwareLimits } from './ai-hardware-limits.mjs';
import { ensureLocalAiEngine, isLocalModelReady } from './local-ai-chat.mjs';
import { warmupCerebro } from './cerebro-agente.mjs';
import { isGeminiConfigured, pingGeminiApi } from './gemini-client.mjs';

export async function bootstrapLocalAiOnStartup() {
  const profile = analyzeSystemProfile();
  const limits = resolveHardwareLimits(profile);
  const catalogId = resolveLocalModelId(loadAiConfig()) || DEFAULT_EMBEDDED_MODEL_ID;

  if (!isGeminiConfigured()) {
    return { ok: false, model: catalogId, reason: 'gemini_not_configured' };
  }

  const ping = await pingGeminiApi();
  const engine = await ensureLocalAiEngine();
  const ready = engine.online && (await isLocalModelReady(catalogId));

  if (ready) {
    void warmupCerebro(null, catalogId);
  }

  const saved = saveAiConfig({
    tier: 'gemini',
    providerId: 'gemini',
    localModel: catalogId,
    model: catalogId,
  });

  const label = localAiDisplayLabel(catalogId);

  if (ping.ok) {
    console.info(`[agent-api] Gemini online (${ping.model}) · ${limits.tierLabel}`);
    return {
      ok: true,
      model: catalogId,
      label,
      engine: 'gemini',
      config: saved,
      limits,
      modelReady: ready,
    };
  }

  return { ok: false, model: catalogId, label, reason: 'gemini_offline', detail: ping.detail };
}

export async function resolveActiveEmbeddedModel(config = loadAiConfig()) {
  return resolveLocalModelId(config) || DEFAULT_EMBEDDED_MODEL_ID;
}
