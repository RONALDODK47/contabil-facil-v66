#!/usr/bin/env node
/**
 * Cria/mescla .env.production antes do deploy.
 * Não bloqueia o deploy se o ambiente de produção não estiver totalmente preenchido —
 * nesse caso o npm run deploy publica frontend/backend via GitHub e pula validações locais.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isLocalDatabaseUrl,
  looksLikePlaceholder,
  readGeminiKeyFromStore,
  root,
} from './deploy-utils.mjs';

const example = path.join(root, '.env.production.example');
const target = path.join(root, '.env.production');
const localEnv = path.join(root, '.env');

function parseEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const obj = {};
  for (const line of String(fs.readFileSync(filePath, 'utf8')).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    obj[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return obj;
}

function serializeEnv(entries) {
  const lines = [
    '# Gerado/atualizado automaticamente por scripts/ensure-production-env.mjs',
    '# Valores sensíveis: edite manualmente se necessário.',
    '',
  ];
  for (const [key, value] of entries) {
    lines.push(`${key}=${value}`);
  }
  lines.push('');
  return lines.join('\n');
}

function pick(source, key) {
  const value = String(source?.[key] ?? '').trim();
  return value || '';
}

function mergeValue(current, ...candidates) {
  if (current && !looksLikePlaceholder(current)) return current;
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim();
    if (value && !looksLikePlaceholder(value)) return value;
  }
  return current || '';
}

if (!fs.existsSync(example)) {
  console.error('[ensure-prod-env] Falta .env.production.example');
  process.exit(1);
}

const exampleEnv = parseEnv(example);
const localEnvData = parseEnv(localEnv);
let targetEnv = fs.existsSync(target) ? parseEnv(target) : { ...exampleEnv };

if (!fs.existsSync(target)) {
  console.info('[ensure-prod-env] Criando .env.production a partir do example + .env local');
} else {
  console.info('[ensure-prod-env] Mesclando .env.production com valores locais');
}

const geminiFromStore = readGeminiKeyFromStore();
const localDb = pick(localEnvData, 'DATABASE_URL') || pick(targetEnv, 'DATABASE_URL');

const defaults = {
  NODE_ENV: 'production',
  STORAGE_BACKEND: 'docker',
  VITE_STORAGE_BACKEND: 'docker',
  AGENT_API_HOST: '0.0.0.0',
  GEMINI_MODEL: 'gemini-2.5-flash',
  MINIO_BUCKET: 'eye-vision',
  MINIO_REGION: 'us-east-1',
  ALLOW_DEV_MIGRATION_ROUTES: 'false',
  VITE_AGENT_API_URL: 'https://contabil-erp-nova-versao-v1-0-8.onrender.com/api/agent',
  CORS_ALLOWED_ORIGIN: 'https://ronaldodk47.github.io/eye-vision-v1.0.7/',
  DEPLOY_GITHUB_REPO: 'RONALDODK47/eye-vision-v1.0.7',
  DEPLOY_GIT_REMOTE: 'https://github.com/RONALDODK47/eye-vision-v1.0.7.git',
};

for (const [key, fallback] of Object.entries(defaults)) {
  targetEnv[key] = mergeValue(targetEnv[key], pick(localEnvData, key), pick(exampleEnv, key), fallback);
}

targetEnv.DATABASE_URL = mergeValue(
  targetEnv.DATABASE_URL,
  !isLocalDatabaseUrl(localDb) ? localDb : '',
  pick(exampleEnv, 'DATABASE_URL'),
);

targetEnv.GEMINI_API_KEY = mergeValue(
  targetEnv.GEMINI_API_KEY,
  pick(localEnvData, 'GEMINI_API_KEY'),
  geminiFromStore,
  pick(exampleEnv, 'GEMINI_API_KEY'),
);

targetEnv.MINIO_S3_ENDPOINT = mergeValue(
  targetEnv.MINIO_S3_ENDPOINT,
  pick(localEnvData, 'MINIO_S3_ENDPOINT'),
  pick(exampleEnv, 'MINIO_S3_ENDPOINT'),
);

targetEnv.MINIO_ACCESS_KEY = mergeValue(
  targetEnv.MINIO_ACCESS_KEY,
  pick(localEnvData, 'MINIO_ACCESS_KEY'),
  pick(localEnvData, 'MINIO_ROOT_USER'),
  pick(exampleEnv, 'MINIO_ACCESS_KEY'),
);

targetEnv.MINIO_SECRET_KEY = mergeValue(
  targetEnv.MINIO_SECRET_KEY,
  pick(localEnvData, 'MINIO_SECRET_KEY'),
  pick(localEnvData, 'MINIO_ROOT_PASSWORD'),
  pick(exampleEnv, 'MINIO_SECRET_KEY'),
);

targetEnv.RENDER_DEPLOY_HOOK_URL = mergeValue(
  targetEnv.RENDER_DEPLOY_HOOK_URL,
  pick(localEnvData, 'RENDER_DEPLOY_HOOK_URL'),
  pick(process.env, 'RENDER_DEPLOY_HOOK_URL'),
);

targetEnv.VERCEL_TOKEN = mergeValue(targetEnv.VERCEL_TOKEN, pick(localEnvData, 'VERCEL_TOKEN'));

const orderedKeys = [
  'NODE_ENV',
  'STORAGE_BACKEND',
  'VITE_STORAGE_BACKEND',
  'VITE_AGENT_API_URL',
  'AGENT_API_HOST',
  'DATABASE_URL',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'CORS_ALLOWED_ORIGIN',
  'ALLOW_DEV_MIGRATION_ROUTES',
  'MINIO_S3_ENDPOINT',
  'MINIO_ACCESS_KEY',
  'MINIO_SECRET_KEY',
  'MINIO_BUCKET',
  'MINIO_REGION',
  'RENDER_DEPLOY_HOOK_URL',
  'VERCEL_TOKEN',
  'DEPLOY_GITHUB_REPO',
  'DEPLOY_GIT_REMOTE',
  'DEPLOY_GIT_MESSAGE',
];

const serialized = [];
const seen = new Set();
for (const key of orderedKeys) {
  if (targetEnv[key] !== undefined && targetEnv[key] !== '') {
    serialized.push([key, targetEnv[key]]);
    seen.add(key);
  }
}
for (const [key, value] of Object.entries(targetEnv)) {
  if (!seen.has(key) && value !== undefined && value !== '') serialized.push([key, value]);
}

fs.writeFileSync(target, serializeEnv(serialized));

const warnings = [];
if (!targetEnv.DATABASE_URL || looksLikePlaceholder(targetEnv.DATABASE_URL) || isLocalDatabaseUrl(targetEnv.DATABASE_URL)) {
  warnings.push('DATABASE_URL ausente ou local — schema será pulado no deploy.');
}
if (!targetEnv.MINIO_S3_ENDPOINT || looksLikePlaceholder(targetEnv.MINIO_S3_ENDPOINT)) {
  warnings.push('MINIO_S3_ENDPOINT ausente — PDFs de extrato não serão persistidos no storage de blobs.');
}
if (!targetEnv.RENDER_DEPLOY_HOOK_URL) {
  warnings.push('RENDER_DEPLOY_HOOK_URL ausente — backend Render depende do workflow GitHub no push');
}

if (warnings.length) {
  console.warn('\n[ensure-prod-env] Avisos (deploy continua via GitHub):');
  for (const item of warnings) console.warn('  -', item);
} else {
  console.info('[ensure-prod-env] Credenciais OK para validação local');
}

console.info('[ensure-prod-env] .env.production pronto — iniciando deploy\n');
