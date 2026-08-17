/**
 * Libera as portas do desenvolvimento (Vite 3000, API fiscal 8780)
 * quando ficaram presas por uma sessão anterior (Ctrl+C incompleto, crash, etc.).
 */
import { execSync } from 'node:child_process';

const DEV_PORTS = [3000, 3001, 8780, 8766, 8790, 11434, 11435];

function pidsListeningOnPortWin(port) {
  try {
    const out = execSync(`netstat -ano`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const pids = new Set();
    const portRegex = new RegExp(`[:.]${port}\\s+.*LISTENING`, 'i');
    for (const line of out.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || !portRegex.test(trimmed)) continue;
      const pid = trimmed.split(/\s+/).pop();
      if (pid && /^\d+$/.test(pid) && pid !== '0' && pid !== String(process.pid)) {
        pids.add(pid);
      }
    }
    return [...pids];
  } catch {
    return [];
  }
}

function pidsListeningOnPortUnix(port) {
  try {
    const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN 2>/dev/null || true`, {
      encoding: 'utf8',
      shell: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out
      .split(/\s+/)
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s));
  } catch {
    return [];
  }
}

function killPid(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
    } else {
      execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}

export function freeDevPorts(ports = DEV_PORTS) {
  const listPorts = process.platform === 'win32' ? pidsListeningOnPortWin : pidsListeningOnPortUnix;

  for (const port of ports) {
    const pids = listPorts(port);
    for (const pid of pids) {
      if (killPid(pid)) {
        console.info(`[dev] Porta ${port} liberada (PID ${pid})`);
      }
    }
  }
}

if (process.argv[1]?.includes('free-dev-ports')) {
  freeDevPorts();
}
