/**
 * Valida variáveis mínimas para produção (Render) e regras de segurança.
 * Uso: npm run production:check
 */
import './load-env.mjs';
import { isMinioEnabled, minioHealth } from './storage/minio-client.mjs';
import { isPostgresStorageEnabled, pgHealth } from './storage/pg-client.mjs';
import { isGeminiConfigured } from './gemini-client.mjs';
import { isProductionRuntime } from './storage/runtime-env.mjs';

const errors = [];
const warnings = [];
const backend = String(process.env.STORAGE_BACKEND || '').toLowerCase();
const isProdCheck = isProductionRuntime() || process.env.PRODUCTION_CHECK === '1';

function req(name) {
  if (!String(process.env[name] || '').trim()) errors.push(`Falta ${name}`);
}

function forbidInProd(name) {
  if (isProdCheck && String(process.env[name] || '').trim()) {
    errors.push(`${name} não deve existir em produção`);
  }
}

console.info('[production-check] Eye Vision — validação de produção e segurança\n');

if (backend !== 'docker' && backend !== 'postgres' && backend !== 'postgresql') {
  errors.push('STORAGE_BACKEND deve ser docker, postgres ou postgresql em produção');
}

req('DATABASE_URL');
if (!isGeminiConfigured()) {
  errors.push('GEMINI_API_KEY inválida ou ausente');
}
req('CORS_ALLOWED_ORIGIN');

const cors = String(process.env.CORS_ALLOWED_ORIGIN || '').trim();
if (!cors) {
  errors.push('CORS_ALLOWED_ORIGIN obrigatório');
} else if (cors === '*') {
  errors.push('CORS_ALLOWED_ORIGIN não pode ser * em produção');
} else if (!/^https:\/\//i.test(cors)) {
  warnings.push('CORS_ALLOWED_ORIGIN deveria usar HTTPS');
}

for (const key of Object.keys(process.env)) {
  if (key.startsWith('VITE_') && /API_KEY|SECRET|PASSWORD|DATABASE_URL/i.test(key)) {
    errors.push(`${key} no frontend expõe segredo — remova do Vercel`);
  }
}

forbidInProd('FIREBASE_MIGRATE_ON_START');
forbidInProd('FIREBASE_MIGRATE_EMAIL');
forbidInProd('FIREBASE_MIGRATE_PASSWORD');
forbidInProd('LEGACY_EYE_VISION_ROOT');

if (String(process.env.ALLOW_DEV_MIGRATION_ROUTES || '').toLowerCase() === 'true') {
  errors.push('ALLOW_DEV_MIGRATION_ROUTES deve ser false em produção');
}

if (!isPostgresStorageEnabled()) {
  errors.push('Postgres desabilitado — verifique DATABASE_URL e STORAGE_BACKEND');
}

if (!isMinioEnabled()) {
  errors.push('MINIO_ACCESS_KEY ausente — PDFs de extrato não serão persistidos na nuvem');
} else if (!String(process.env.MINIO_S3_ENDPOINT || '').trim()) {
  errors.push('MINIO_S3_ENDPOINT obrigatório para armazenamento de PDFs em object storage');
}

const dbUrl = String(process.env.DATABASE_URL || '');
if (dbUrl && !/sslmode=require|sslmode=require/i.test(dbUrl)) {
  warnings.push('DATABASE_URL — confirme SSL se estiver usando banco remoto.');
}

const host = process.env.AGENT_API_HOST || '';
if (host && host !== '0.0.0.0') {
  warnings.push(`AGENT_API_HOST=${host} — em Render use 0.0.0.0`);
}

if (errors.length) {
  for (const e of errors) console.error('  ✗', e);
} else {
  console.info('  ✓ Variáveis e políticas de segurança OK');
}

for (const w of warnings) console.warn('  ⚠', w);

if (isPostgresStorageEnabled()) {
  try {
    const health = await pgHealth();
    if (health.ok) console.info('  ✓ Postgres conectado');
    else errors.push(`Postgres: ${health.detail || 'falha'}`);
  } catch (err) {
    errors.push(`Postgres: ${err instanceof Error ? err.message : String(err)}`);
  }
}

if (isMinioEnabled()) {
  try {
    const blob = await minioHealth();
    if (blob.ok) {
      console.info(`  ✓ Storage de PDFs OK (bucket: ${blob.bucket || 'eye-vision'})`);
    } else {
      errors.push(`Storage PDFs: ${blob.detail || 'falha'}`);
    }
  } catch (err) {
    errors.push(`Storage PDFs: ${err instanceof Error ? err.message : String(err)}`);
  }
}


if (errors.length) {
  console.error(`\n[production-check] ${errors.length} erro(s) — corrija antes do deploy.`);
  process.exit(1);
}

console.info('\n[production-check] Pronto para produção com dados seguros.');
process.exit(0);
