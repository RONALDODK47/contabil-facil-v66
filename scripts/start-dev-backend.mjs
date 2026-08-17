/**
 * Sobe Docker + agent-api + API fiscal quando o Vite roda sozinho (ex.: Cursor / npm run dev:vite).
 * Ignorado quando EYE_VISION_DEV_ALL=1 (npm run dev já subiu tudo).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { ensureStorageUp } from './storage/ensure-up.mjs';
import './load-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENT_API_PORT = Number(process.env.AGENT_API_PORT || 8790);
const FISCAL_API_PORT = Number(process.env.FISCAL_NFE_PORT || 8780);
const agentScript = path.join(root, 'scripts', 'agent-api-server.mjs');
const fiscalScript = path.join(root, 'scripts', 'fiscal-nfe-api.mjs');

async function isAgentHealthy() {
  try {
    const res = await fetch(`http://127.0.0.1:${AGENT_API_PORT}/health`);
    const json = await res.json().catch(() => ({}));
    return res.ok && json.ok === true;
  } catch {
    return false;
  }
}

async function isFiscalHealthy() {
  try {
    const res = await fetch(`http://127.0.0.1:${FISCAL_API_PORT}/health`);
    if (!res.ok) return false;
    const json = await res.json().catch(() => ({}));
    return json.ok !== false;
  } catch {
    return false;
  }
}

function spawnDetached(script, label) {
  if (!existsSync(script)) return null;
  const child = spawn(process.execPath, [script], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, STORAGE_BACKEND: process.env.STORAGE_BACKEND || 'docker' },
  });
  child.unref();
  console.info(`[dev-backend] ${label} iniciado`);
  return child;
}

if (process.env.EYE_VISION_DEV_ALL === '1') {
  process.exit(0);
}

if ((await isAgentHealthy()) && (await isFiscalHealthy())) {
  process.exit(0);
}

console.info('[dev-backend] Subindo Docker + agent-api + API fiscal para o Eye Vision…');
await ensureStorageUp({ log: (m) => console.info(m) });

if (!(await isFiscalHealthy())) {
  spawnDetached(fiscalScript, `API fiscal :${FISCAL_API_PORT}`);
}

if (!(await isAgentHealthy())) {
  spawnDetached(agentScript, `agent-api :${AGENT_API_PORT}`);
}

const start = Date.now();
while (Date.now() - start < 60_000) {
  const agentOk = await isAgentHealthy();
  const fiscalOk = await isFiscalHealthy();
  if (agentOk && fiscalOk) {
    console.info(`[dev-backend] agent-api :${AGENT_API_PORT} + fiscal :${FISCAL_API_PORT} prontos`);
    process.exit(0);
  }
  await delay(500);
}

console.warn('[dev-backend] Serviços não responderam — use npm run dev (dev-all)');
process.exit(1);
