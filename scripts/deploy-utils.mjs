/**
 * Utilitários compartilhados pelos scripts de deploy.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PLACEHOLDER_PATTERNS = [
  /sua_/i,
  /seu[-_]/i,
  /alter/i,
  /example/i,
  /\[ref\]/i,
  /\[senha\]/i,
  /\[regiao\]/i,
  /^<.*>$/,
];

export function looksLikePlaceholder(value) {
  const text = String(value ?? '').trim();
  if (!text) return true;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text));
}

export function isLocalDatabaseUrl(value) {
  const text = String(value ?? '').trim();
  return /localhost|127\.0\.0\.1|:5432\/|@postgres[:/]/i.test(text);
}

export function isTruthyEnv(name) {
  const value = String(process.env[name] ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

export function npmCmd() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

export function npxCmd() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

export function useShellFor(cmd) {
  return process.platform === 'win32' && typeof cmd === 'string' && (cmd.endsWith('.cmd') || cmd.endsWith('.bat'));
}

export function run(label, cmd, args, extraEnv = {}, { stdio = 'inherit' } = {}) {
  if (label) console.info(`\n[deploy] ${label}…`);
  const result = spawnSync(cmd, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv, NODE_ENV: 'production', PRODUCTION_CHECK: '1' },
    stdio,
    shell: useShellFor(cmd),
    windowsHide: false,
  });
  return result.status ?? 1;
}

export function runOrExit(label, cmd, args, extraEnv = {}) {
  const code = run(label, cmd, args, extraEnv);
  if (code !== 0) {
    console.error(`\n[deploy] Falhou: ${label}`);
    process.exit(code);
  }
}

export function runSilent(cmd, args, extraEnv = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv, NODE_ENV: 'production' },
    stdio: 'ignore',
    shell: useShellFor(cmd),
    windowsHide: false,
  });
  return (result.status ?? 1) === 0;
}

export function runOutput(cmd, args, extraEnv = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: useShellFor(cmd),
    windowsHide: false,
  });
  const stdout = result.stdout ? result.stdout.toString().trim() : '';
  const stderr = result.stderr ? result.stderr.toString().trim() : '';
  return { ok: (result.status ?? 1) === 0, stdout, stderr, code: result.status ?? 1 };
}

export function readJsonKey(filePath, ...fields) {
  if (!fs.existsSync(filePath)) return '';
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    for (const field of fields) {
      const value = String(parsed?.[field] ?? '').trim();
      if (value) return value;
    }
  } catch {
    /* ignore */
  }
  return '';
}

export function readGeminiKeyFromStore() {
  return readJsonKey(path.join(root, '.data', 'api-keys', 'gemini', 'api-key.json'), 'apiKey', 'key');
}

export function readPackageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return String(pkg.version ?? '').trim();
  } catch {
    return '';
  }
}

/** Nome do repositório para URL do GitHub Pages (owner/repo → repo). */
export function githubPagesRepoSlug(repoRef = process.env.DEPLOY_GITHUB_REPO || 'eye-vision-v1.0.7') {
  const raw = String(repoRef ?? '').trim().replace(/\.git$/i, '');
  if (!raw) return 'eye-vision-v1.0.7';
  if (raw.includes('/')) {
    const parts = raw.split('/').filter(Boolean);
    return parts[parts.length - 1] || 'eye-vision-v1.0.7';
  }
  return raw;
}

export function defaultFrontendUrl() {
  const version = readPackageVersion();
  const slug = githubPagesRepoSlug();
  if (version) return `https://ronaldodk47.github.io/${slug}/v${version}/`;
  return `https://ronaldodk47.github.io/${slug}/`;
}

export function defaultApiUrl() {
  return String(process.env.VITE_AGENT_API_URL || 'https://contabil-erp-nova-versao-v1-0-8.onrender.com/api/agent').trim();
}

export function hasProductionConfig(env = process.env) {
  const databaseUrl = String(env.DATABASE_URL || '').trim();
  const minioEndpoint = String(env.MINIO_S3_ENDPOINT || '').trim();
  const hasGemini =
    (String(env.GEMINI_API_KEY || '').trim().length > 10 && !looksLikePlaceholder(env.GEMINI_API_KEY)) ||
    readGeminiKeyFromStore().length > 10;

  return (
    databaseUrl &&
    !looksLikePlaceholder(databaseUrl) &&
    !isLocalDatabaseUrl(databaseUrl) &&
    minioEndpoint &&
    !looksLikePlaceholder(minioEndpoint) &&
    hasGemini
  );
}
