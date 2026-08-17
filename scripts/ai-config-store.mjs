import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { isLocalAiTier, localAiDisplayLabel } from './local-ai-labels.mjs';
import { getProjectDataDir } from './project-data-dir.mjs';
import { DEFAULT_EMBEDDED_MODEL_ID, normalizeCatalogModelId } from './embedded-ai.mjs';
import { findModelInCatalog, normalizeSelectedModel } from './ai-model-catalog.mjs';

const DEFAULT_CONFIG = {
  tier: 'gemini',
  providerId: 'gemini',
  model: DEFAULT_EMBEDDED_MODEL_ID,
  localModel: DEFAULT_EMBEDDED_MODEL_ID,
  pricingTier: 'free',
  extractEngine: 'ai',
  updatedAt: new Date().toISOString(),
};

export function resolveLocalModelId(config) {
  return normalizeCatalogModelId(config?.localModel || config?.model || DEFAULT_EMBEDDED_MODEL_ID);
}

export function publicAiConfig(config = loadAiConfig()) {
  const { ...rest } = config;
  return { ...rest, embedded: false };
}

function configPath() {
  return join(getProjectDataDir(), 'ai-config.json');
}

function normalizeExtractEngine(_eng) {
  return 'ai';
}

export function loadAiConfig() {
  try {
    const raw = readFileSync(configPath(), 'utf8');
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULT_CONFIG, ...parsed };
    const providerId = String(merged.providerId || 'gemini');
    const model = normalizeSelectedModel(providerId, merged.localModel || merged.model);
    merged.providerId = providerId;
    merged.localModel = model;
    merged.model = model;
    merged.tier = providerId;
    const entry = findModelInCatalog(model);
    merged.pricingTier = entry?.tier ?? merged.pricingTier ?? 'free';
    merged.extractEngine = normalizeExtractEngine(merged.extractEngine);
    return merged;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveAiConfig(patch) {
  const prev = loadAiConfig();
  const providerId = String(patch.providerId ?? prev.providerId ?? 'gemini').trim();
  const next = {
    ...prev,
    ...patch,
    providerId,
    tier: providerId,
    updatedAt: new Date().toISOString(),
  };
  if ('localModel' in patch || 'model' in patch) {
    const lm = normalizeSelectedModel(providerId, patch.localModel || patch.model);
    next.localModel = lm;
    next.model = lm;
    const entry = findModelInCatalog(lm);
    if (entry) next.pricingTier = entry.tier;
  }
  if (patch.extractEngine) {
    next.extractEngine = normalizeExtractEngine(patch.extractEngine);
  }
  writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export function providerDisplayLabel(config) {
  if (isLocalAiTier(config)) {
    return localAiDisplayLabel(resolveLocalModelId(config));
  }
  return localAiDisplayLabel(resolveLocalModelId(config));
}
