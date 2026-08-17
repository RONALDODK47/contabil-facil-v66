/**
 * Limites de inferência pela RAM/VRAM reais — prioridade: não travar o PC.
 */
import { analyzeSystemProfile } from './ai-system-profile.mjs';
import { EMBEDDED_AI_OPTIONS, EMBEDDED_CHAT_FAST_OPTIONS } from './embedded-ai.mjs';

/** @typedef {'minima' | 'leve' | 'media' | 'confortavel'} HardwareTier */

let cachedLimits = null;
let cachedKey = '';

function profileKey(profile) {
  return `${profile.totalRamGb}|${profile.freeRamGb}|${profile.cpuCount}`;
}

/** @param {ReturnType<typeof analyzeSystemProfile>} profile */
function pickTier(profile) {
  const ram = profile.totalRamGb;
  if (ram <= 4) return 'minima';
  if (ram <= 6) return 'leve';
  if (ram <= 10) return 'media';
  return 'confortavel';
}

const TIER_DEFAULTS = {
  minima: {
    tierLabel: 'PC fraco — ultra leve (1 núcleo)',
    num_ctx: 512,
    num_predict: 64,
    num_predict_fast: 20,
    num_thread: 1,
    maxThreads: 1,
    useGpu: false,
    gpuLayers: 0,
    idleUnloadMs: 60_000,
  },
  leve: {
    tierLabel: 'PC 6 GB — modo leve (1 núcleo)',
    num_ctx: 640,
    num_predict: 96,
    num_predict_fast: 24,
    num_thread: 1,
    maxThreads: 1,
    useGpu: false,
    gpuLayers: 0,
    idleUnloadMs: 75_000,
  },
  media: {
    tierLabel: 'PC 8 GB — modo seguro (1 núcleo)',
    num_ctx: 768,
    num_predict: 128,
    num_predict_fast: 28,
    num_thread: 1,
    maxThreads: 1,
    useGpu: false,
    gpuLayers: 0,
    idleUnloadMs: 90_000,
  },
  confortavel: {
    tierLabel: 'PC 10 GB+ — modo equilibrado',
    num_ctx: 1536,
    num_predict: 256,
    num_predict_fast: 64,
    num_thread: 2,
    maxThreads: 2,
    useGpu: false,
    gpuLayers: 0,
    idleUnloadMs: 120_000,
  },
};

/** GPU só em máquina forte com placa dedicada — nunca em Intel UHD. */
function applyGpuPolicy(base, profile) {
  const out = { ...base };
  const canGpu =
    profile.discreteGpu &&
    profile.vramGb >= 6 &&
    profile.totalRamGb >= 12 &&
    profile.freeRamGb >= 3;

  if (!canGpu) {
    out.useGpu = false;
    out.gpuLayers = 0;
    return out;
  }

  out.useGpu = true;
  out.gpuLayers = profile.vramGb >= 10 ? 'auto' : 16;
  out.maxThreads = 2;
  out.num_thread = 2;
  return out;
}

function capByFreeRam(base, profile) {
  const out = { ...base };
  if (profile.freeRamGb < 0.8) {
    out.num_ctx = 384;
    out.num_predict = 48;
    out.num_predict_fast = 16;
    out.num_thread = 1;
    out.maxThreads = 1;
    out.useGpu = false;
    out.gpuLayers = 0;
    out.idleUnloadMs = 45_000;
    out.tierLabel = `${out.tierLabel} · RAM crítica`;
  } else if (profile.freeRamGb < 1.5) {
    out.num_ctx = Math.min(out.num_ctx, 512);
    out.num_predict = Math.min(out.num_predict, 64);
    out.num_predict_fast = Math.min(out.num_predict_fast, 20);
    out.num_thread = 1;
    out.maxThreads = 1;
    out.useGpu = false;
    out.gpuLayers = 0;
    out.idleUnloadMs = 60_000;
  } else if (profile.freeRamGb < 2.5) {
    out.num_ctx = Math.min(out.num_ctx, 640);
    out.num_predict_fast = Math.min(out.num_predict_fast, 24);
    out.num_thread = 1;
    out.maxThreads = 1;
  }
  return out;
}

/** @param {ReturnType<typeof analyzeSystemProfile>} [profile] */
export function resolveHardwareLimits(profile = analyzeSystemProfile()) {
  const key = profileKey(profile);
  if (cachedLimits && cachedKey === key) return cachedLimits;

  const tier = pickTier(profile);
  let limits = { tier, ...TIER_DEFAULTS[tier] };
  limits = applyGpuPolicy(limits, profile);
  limits = capByFreeRam(limits, profile);
  limits.num_thread = Math.max(1, Math.min(limits.num_thread, profile.cpuCount));
  limits.maxThreads = Math.max(1, Math.min(limits.maxThreads, profile.cpuCount));

  cachedKey = key;
  cachedLimits = {
    ...limits,
    totalRamGb: profile.totalRamGb,
    freeRamGb: profile.freeRamGb,
    vramGb: profile.vramGb,
    discreteGpu: profile.discreteGpu,
    gpuName: profile.gpuName,
  };
  return cachedLimits;
}

export function invalidateHardwareLimitsCache() {
  cachedLimits = null;
  cachedKey = '';
}

/** Inferência pesada (OCR, agente) — bloqueia se RAM apertada. */
export function canRunHeavyInference(profile = analyzeSystemProfile()) {
  const limits = resolveHardwareLimits(profile);
  return limits.freeRamGb >= 1.2 && limits.totalRamGb >= 3.5;
}

/** @param {{ fast?: boolean }} [opts] */
export function mergeInferenceOptions(opts = {}) {
  const limits = resolveHardwareLimits();
  const base = opts.fast ? EMBEDDED_CHAT_FAST_OPTIONS : EMBEDDED_AI_OPTIONS;
  return {
    ...base,
    num_ctx: limits.num_ctx,
    num_predict: opts.fast ? limits.num_predict_fast : limits.num_predict,
    num_thread: limits.num_thread,
  };
}

export { flowmindInstantReply as tryInstantCasualReply } from './flowmind-instant-reply.mjs';
