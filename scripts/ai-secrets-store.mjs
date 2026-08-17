/**
 * Chaves API por provedor — uma pasta por provedor em .data/api-keys/{providerId}/.
 * Nunca expor a chave completa ao browser.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import './load-env.mjs';
import { AI_PROVIDERS } from './ai-model-catalog.mjs';
import { getProjectDataDir } from './project-data-dir.mjs';

const API_KEYS_DIR_NAME = 'api-keys';
const KEY_FILE_NAME = 'api-key.json';
const LEGACY_SECRETS_FILE = 'ai-secrets.json';

/** @type {boolean} */
let legacyMigrationDone = false;

export function getApiKeysRootDir() {
  const dir = join(getProjectDataDir(), API_KEYS_DIR_NAME);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function getProviderKeyDir(providerId) {
  const id = String(providerId ?? '').trim();
  const dir = join(getApiKeysRootDir(), id);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function providerKeyFilePath(providerId) {
  return join(getProviderKeyDir(providerId), KEY_FILE_NAME);
}

function legacySecretsPath() {
  return join(getProjectDataDir(), LEGACY_SECRETS_FILE);
}

function isKnownProvider(providerId) {
  return AI_PROVIDERS.some((p) => p.id === providerId);
}

function readProviderKeyFile(providerId) {
  try {
    const raw = readFileSync(providerKeyFilePath(providerId), 'utf8');
    const parsed = JSON.parse(raw);
    return String(parsed?.apiKey ?? parsed?.key ?? '').trim();
  } catch {
    return '';
  }
}

function writeProviderKeyFile(providerId, apiKey) {
  const payload = {
    providerId,
    apiKey,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(providerKeyFilePath(providerId), JSON.stringify(payload, null, 2), 'utf8');
}

function deleteProviderKeyFile(providerId) {
  const filePath = providerKeyFilePath(providerId);
  if (existsSync(filePath)) rmSync(filePath, { force: true });
  const dir = join(getApiKeysRootDir(), providerId);
  if (existsSync(dir)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ok */
    }
  }
}

function migrateLegacySecretsFile() {
  if (legacyMigrationDone) return;
  legacyMigrationDone = true;

  const legacyPath = legacySecretsPath();
  if (!existsSync(legacyPath)) return;

  let legacy = {};
  try {
    legacy = JSON.parse(readFileSync(legacyPath, 'utf8'));
  } catch {
    return;
  }

  for (const provider of AI_PROVIDERS) {
    const key = String(legacy[provider.id] ?? '').trim();
    if (key.length <= 8) continue;
    if (readProviderKeyFile(provider.id).length > 8) continue;
    writeProviderKeyFile(provider.id, key);
  }

  try {
    rmSync(legacyPath, { force: true });
  } catch {
    /* ok — legado permanece se não puder remover */
  }
}

function loadStoredKey(providerId) {
  migrateLegacySecretsFile();
  return readProviderKeyFile(providerId);
}

/** Chave do .env tem prioridade sobre UI. */
export function getApiKeyForProvider(providerId) {
  const envVar = AI_PROVIDERS.find((p) => p.id === providerId)?.keyEnvVar;
  if (envVar) {
    const fromEnv = String(process.env[envVar] ?? '').trim().replace(/^['"]|['"]$/g, '');
    if (fromEnv.length > 8 && !fromEnv.includes('MY_') && !fromEnv.includes('your_')) {
      return { key: fromEnv, source: 'env' };
    }
  }
  const stored = loadStoredKey(providerId);
  if (stored.length > 8) return { key: stored, source: 'ui' };
  return { key: '', source: 'none' };
}

export function maskApiKey(key) {
  const k = String(key ?? '').trim();
  if (k.length < 8) return '';
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}

/** Status público — quais provedores têm chave (sem revelar valor). */
export function publicProviderKeyStatus() {
  migrateLegacySecretsFile();
  const out = {};
  for (const p of AI_PROVIDERS) {
    const { key, source } = getApiKeyForProvider(p.id);
    out[p.id] = {
      configured: key.length > 8,
      source,
      masked: key.length > 8 ? maskApiKey(key) : null,
      envVar: p.keyEnvVar,
      storagePath: `.data/${API_KEYS_DIR_NAME}/${p.id}/${KEY_FILE_NAME}`,
    };
  }
  return out;
}

export function saveApiKeyForProvider(providerId, apiKey) {
  migrateLegacySecretsFile();
  const id = String(providerId ?? '').trim();
  const key = String(apiKey ?? '').trim();
  if (!isKnownProvider(id)) {
    throw new Error(`Provedor desconhecido: ${id}`);
  }
  if (!key) {
    deleteProviderKeyFile(id);
  } else {
    writeProviderKeyFile(id, key);
  }
  return publicProviderKeyStatus();
}

export function isProviderConfigured(providerId) {
  return getApiKeyForProvider(providerId).key.length > 8;
}
