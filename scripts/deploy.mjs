/**
 * Deploy completo — um comando sobe tudo:
 * 1. Valida/mescla .env.production
 * 2. Schema + validação do banco (se configurado)
 * 3. Build local (sanidade antes do push)
 * 4. Git commit + push → GitHub Pages + Render (CI)
 * 5. Render deploy hook (opcional)
 * 6. Vercel CLI (opcional)
 * 7. Aguarda GitHub Actions (se gh estiver instalado)
 *
 * Uso: npm run deploy
 */
import { spawnSync } from 'node:child_process';
import { config } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishToGit } from './deploy-publish.mjs';
import {
  defaultApiUrl,
  defaultFrontendUrl,
  isTruthyEnv,
  looksLikePlaceholder,
  npmCmd,
  npxCmd,
  readPackageVersion,
  root,
  runOrExit,
  runSilent,
} from './deploy-utils.mjs';

process.env.NODE_ENV = 'production';

const envProduction = path.join(root, '.env.production');
if (!fs.existsSync(envProduction)) {
  console.error('\n[deploy] Falta .env.production');
  console.error('  Rode npm run deploy — o arquivo será criado a partir de .env.production.example');
  console.error('  Guia: docs/PRODUCAO.md\n');
  process.exit(1);
}

config({ path: envProduction, override: true });
await import('./load-env.mjs');

function hasVercelLogin() {
  return runSilent(npxCmd(), ['vercel', 'whoami']);
}

function deployWithVercel(token) {
  const args = ['vercel', 'deploy', '--prebuilt', '--prod', '--yes'];
  if (token) args.push('--token', token);
  runOrExit('Vercel (produção)', npxCmd(), args);
}

function runRenderHook(renderHookUrl) {
  const payload = JSON.stringify({});
  const script = `
    import { request } from 'node:http';
    import { request as requestHttps } from 'node:https';
    const url = new URL(${JSON.stringify(renderHookUrl)});
    const client = url.protocol === 'https:' ? requestHttps : request;
    const req = client(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(${JSON.stringify(payload)}) } }, (res) => {
      if (res.statusCode >= 200 && res.statusCode < 300) process.exit(0);
      console.error('Render hook falhou:', res.statusCode);
      process.exit(1);
    });
    req.on('error', (err) => { console.error('Render hook erro:', err.message); process.exit(1); });
    req.write(${JSON.stringify(payload)});
    req.end();
  `;
  runOrExit('Render deploy hook', process.execPath, ['-e', script]);
}

function listPendingGithubRuns(repo, branch) {
  const result = spawnSync(
    'gh',
    ['run', 'list', '--repo', repo, '--branch', branch, '--limit', '4', '--json', 'databaseId,name,status,conclusion'],
    { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], shell: false, windowsHide: false },
  );
  if ((result.status ?? 1) !== 0 || !result.stdout) return [];
  try {
    return JSON.parse(result.stdout.toString()).filter((run) => run.status !== 'completed');
  } catch {
    return [];
  }
}

async function watchGithubActions(repo, branch) {
  if (isTruthyEnv('DEPLOY_SKIP_CI_WATCH')) return;
  if (!runSilent('gh', ['--version'])) {
    console.info('[deploy] gh CLI não encontrado — pulando monitoramento do CI.');
    return;
  }

  console.info('\n[deploy] Aguardando GitHub Actions…');
  let pending = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    pending = listPendingGithubRuns(repo, branch);
    if (pending.length) break;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  if (!pending.length) {
    console.info('[deploy] Workflows já concluídos ou ainda não iniciados.');
    return;
  }

  for (const run of pending.slice(0, 2)) {
    runOrExit(`CI ${run.name}`, 'gh', ['run', 'watch', String(run.databaseId), '--repo', repo, '--exit-status']);
  }
}

console.info('[deploy] Eye Vision — deploy completo\n');
console.info('  Frontend: GitHub Pages (push main)');
console.info('  Backend: Render (CI ou deploy hook)');
console.info('  Banco/PDFs: Postgres + MinIO\n');

runOrExit('Schema + validação', process.execPath, ['scripts/production-setup.mjs']);

if (!isTruthyEnv('DEPLOY_SKIP_BUILD')) {
  runOrExit('Build frontend', npmCmd(), ['run', 'build']);
} else {
  console.info('\n[deploy] DEPLOY_SKIP_BUILD=1 — build local ignorado (CI fará no GitHub).\n');
}

const gitRepo = String(process.env.DEPLOY_GITHUB_REPO || 'RONALDODK47/eye-vision-v1.0.7').trim();
const gitInfo = publishToGit({
  message: process.env.DEPLOY_GIT_MESSAGE,
  remote: process.env.DEPLOY_GIT_REMOTE,
});

const renderHook = String(process.env.RENDER_DEPLOY_HOOK_URL || process.env.RENDER_DEPLOY_HOOK || '').trim();
if (renderHook && !looksLikePlaceholder(renderHook)) {
  runRenderHook(renderHook);
} else {
  console.info('[deploy] RENDER_DEPLOY_HOOK_URL não definido — Render será acionado pelo push (workflow GitHub).');
}

const vercelToken = String(process.env.VERCEL_TOKEN || '').trim();
if (vercelToken && !looksLikePlaceholder(vercelToken)) {
  deployWithVercel(vercelToken);
} else if (hasVercelLogin()) {
  deployWithVercel();
} else if (isTruthyEnv('DEPLOY_USE_VERCEL')) {
  console.error('[deploy] DEPLOY_USE_VERCEL=1 mas VERCEL_TOKEN/login não encontrado.');
  process.exit(1);
}

await watchGithubActions(gitRepo, gitInfo.branch || 'main');

const version = readPackageVersion();
console.info('\n[deploy] Concluído.\n');
console.info(`  Frontend: ${defaultFrontendUrl()}`);
console.info(`  API:      ${defaultApiUrl()}`);
if (version) console.info(`  Versão:   v${version}`);
console.info('');
