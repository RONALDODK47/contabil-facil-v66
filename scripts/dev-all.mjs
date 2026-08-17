/**
 * Desenvolvimento — API fiscal (:8780) + agent-api (:8790, Postgres/MinIO) + Vite (:3000) + doc-downloader (:8766).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { freeDevPorts } from './free-dev-ports.mjs';
import { ensureStorageUp } from './storage/ensure-up.mjs';
import { spawnSync } from 'node:child_process';
import './load-env.mjs';

const AGENT_API_PORT = Number(process.env.AGENT_API_PORT || 8790);

async function waitForAgentApi(maxMs = 45_000, intervalMs = 500) {
  const url = `http://127.0.0.1:${AGENT_API_PORT}/agent/workspace/health`;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(url);
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok === true) return true;
    } catch {
      /* agent-api ainda subindo */
    }
    await delay(intervalMs);
  }
  return false;
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fiscalScript = path.join(root, 'scripts', 'fiscal-nfe-api.mjs');
const agentApiScript = path.join(root, 'scripts', 'agent-api-server.mjs');
const docDownloaderScript = path.join(root, 'scripts', 'start-doc-downloader.mjs');
const docVenvPython =
  process.platform === 'win32'
    ? path.join(root, 'doc_downloader', '.venv', 'Scripts', 'python.exe')
    : path.join(root, 'doc_downloader', '.venv', 'bin', 'python');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

freeDevPorts();
await delay(400);

const log = (msg) => console.info(`\x1b[36m[dev]\x1b[0m ${msg}`);
const spawnOpts = { cwd: root, stdio: 'inherit', windowsHide: false };

log('Preparando Postgres/MinIO (Docker)…');
const storage = await ensureStorageUp({ log });
if (!storage.ok && !storage.skipped) {
  console.warn(
    '\x1b[33m[dev]\x1b[0m Storage Docker não ficou pronto — workspace na nuvem pode falhar até subir manualmente (npm run storage:setup).',
  );
}

const gestaoPatches = path.join(root, 'scripts', 'apply-gestao-patches.mjs');
if (existsSync(gestaoPatches)) {
  log('Aplicando patches Gestão Contábil…');
  spawnSync(process.execPath, [gestaoPatches], { cwd: root, stdio: 'inherit' });
}

log('Iniciando API fiscal :8780…');
const fiscal = spawn(process.execPath, [fiscalScript], spawnOpts);

log('Iniciando agent-api :8790 (Postgres/MinIO)…');
const agentApi = existsSync(agentApiScript)
  ? spawn(process.execPath, [agentApiScript], spawnOpts)
  : null;

const vite = existsSync(viteBin)
  ? spawn(process.execPath, [viteBin], {
      ...spawnOpts,
      env: { ...process.env, EYE_VISION_DEV_ALL: '1' },
    })
  : null;

if (!vite) {
  console.error('[dev] Vite não encontrado — rode npm install');
  process.exit(1);
}

log('Interface Vite — http://localhost:3000');

if (agentApi) {
  void waitForAgentApi().then((ready) => {
    if (ready) log('agent-api pronto — dados migrados disponíveis.');
  });
}

const docDownloader = existsSync(docVenvPython)
  ? spawn(process.execPath, [docDownloaderScript], { cwd: root, stdio: 'inherit' })
  : null;

let exiting = false;

function shutdown(code = 0) {
  if (exiting) return;
  exiting = true;
  for (const proc of [fiscal, agentApi, vite, docDownloader].filter(Boolean)) {
    try {
      if (process.platform === 'win32' && proc.pid) {
        spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      } else {
        proc.kill('SIGTERM');
      }
    } catch {
      /* ok */
    }
  }
  setTimeout(() => process.exit(code), 400).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function onChildExit(name, code) {
  if (!exiting) {
    console.error(`[dev] ${name} encerrou (código ${code ?? '?'}). Parando os demais…`);
    shutdown(code ?? 1);
  }
}

fiscal.on('exit', (code) => onChildExit('API fiscal', code));
if (agentApi) {
  // agent-api offline não derruba o Vite (Gemini/IA ainda pode falhar), mas avisa.
  agentApi.on('exit', (code) => {
    if (!exiting) {
      console.error(
        `[dev] agent-api encerrou (código ${code ?? '?'}). Workspace Postgres fica indisponível até reiniciar.`,
      );
    }
  });
}
vite.on('exit', (code) => {
  if (!exiting) shutdown(code ?? 0);
});
if (docDownloader) {
  docDownloader.on('exit', (code) => onChildExit('Doc Downloader', code));
}
