/** Rótulos Gemini. */
import { EMBEDDED_AI_CATALOG } from './embedded-ai.mjs';

export const LOCAL_AI_LABELS = Object.fromEntries(
  EMBEDDED_AI_CATALOG.map((m) => [m.id, m.label]),
);

export function localAiDisplayLabel(modelId) {
  const id = String(modelId || '').split(':')[0];
  const hit = EMBEDDED_AI_CATALOG.find(
    (m) => m.id === modelId || m.id === id || modelId.startsWith(m.id),
  );
  return hit?.label ?? LOCAL_AI_LABELS[modelId] ?? 'Gemini AI';
}

export function isLocalAiTier(config) {
  return (
    config.tier === 'gemini' ||
    config.tier === 'opensource' ||
    config.providerId === 'gemini' ||
    config.providerId === 'embedded'
  );
}
