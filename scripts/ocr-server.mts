import { spawn, ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import net from 'net';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OCR_PORT = 3001;
const OCR_SERVER_DIR = path.join(__dirname, '../conversor/bank_pdf_extract');
const MAX_RETRIES = 60;
const RETRY_DELAY = 1000;

let ocrProcess: ChildProcess | null = null;

export async function startOcrServer(): Promise<void> {
  if (!fs.existsSync(OCR_SERVER_DIR)) {
    process.stderr.write(
      `[OCR] Diretório do servidor não encontrado: ${OCR_SERVER_DIR}\n` +
      `[OCR] OCR desabilitado - use PDF com texto nativo ou instale o conversor\n`
    );
    return;
  }

  try {
    // Mata processo antigo na porta se existir
    await killProcessOnPort(OCR_PORT);

    process.stdout.write('[OCR] Iniciando servidor OCR...\n');

    // Primeiro, cria venv se não existir
    const venvPath = path.join(OCR_SERVER_DIR, '.venv');
    if (!fs.existsSync(venvPath)) {
      process.stdout.write('[OCR] Criando environment Python...\n');
      try {
        await execAsync(`python -m venv "${venvPath}"`, { cwd: OCR_SERVER_DIR });
      } catch (err) {
        process.stderr.write(`[OCR] Erro ao criar venv: ${err instanceof Error ? err.message : err}\n`);
        throw err;
      }
    }

    // Depois, instala dependências
    process.stdout.write('[OCR] Instalando dependências...\n');
    const pipPath = process.platform === 'win32'
      ? path.join(venvPath, 'Scripts', 'pip.exe')
      : path.join(venvPath, 'bin', 'pip');

    try {
      await execAsync(`"${pipPath}" install -q -r requirements.txt`, { cwd: OCR_SERVER_DIR, timeout: 120000 });
    } catch (err) {
      process.stderr.write(`[OCR] Erro ao instalar dependências: ${err instanceof Error ? err.message : err}\n`);
      throw err;
    }

    // Finalmente, inicia o servidor
    const pythonPath = process.platform === 'win32'
      ? path.join(venvPath, 'Scripts', 'python.exe')
      : path.join(venvPath, 'bin', 'python');

    const args = ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(OCR_PORT)];

    ocrProcess = spawn(pythonPath, args, {
      cwd: OCR_SERVER_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });

    ocrProcess.stdout?.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('Uvicorn running') || msg.includes('Application startup complete')) {
        process.stdout.write(`[OCR] ✅ Servidor OCR rodando em http://127.0.0.1:${OCR_PORT}\n`);
      }
    });

    ocrProcess.stderr?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes('INFO:')) {
        process.stderr.write(`[OCR] ${msg}\n`);
      }
    });

    ocrProcess.on('error', (err) => {
      process.stderr.write(`[OCR] Erro ao iniciar processo: ${err.message}\n`);
    });

    // Se o uvicorn morrer durante o boot, `waitForServer` precisa desistir na
    // hora. Antes ele continuava batendo em /health e, quando havia um servidor
    // velho na porta, respondia OK e imprimia "pronto para usar" logo antes do
    // "processo saiu com código 1" — mascarando a falha real.
    let exitInfo: string | null = null;
    ocrProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        exitInfo = `processo encerrou com código ${code}`;
        process.stderr.write(`[OCR] Processo saiu com código ${code}\n`);
      }
      ocrProcess = null;
    });

    // Aguarda servidor ficar pronto
    await waitForServer(MAX_RETRIES, () => exitInfo);
    process.stdout.write('[OCR] Servidor OCR pronto para usar\n');

  } catch (err) {
    process.stderr.write(
      `[OCR] Falha ao iniciar servidor: ${err instanceof Error ? err.message : err}\n` +
      `[OCR] Continuando sem OCR - use PDF com texto nativo ou instale Python 3.8+\n`
    );
    ocrProcess = null;
  }
}

/**
 * Todo PID que segura a porta no Windows — em QUALQUER estado, não só LISTENING.
 *
 * Um socket ESTABLISHED, CLOSE_WAIT ou FIN_WAIT com o endereço LOCAL na nossa
 * porta também impede o bind do uvicorn. Filtrar só por LISTENING deixava passar
 * o caso mais chato: servidor velho que já parou de aceitar conexões mas ainda
 * tem sockets pendurados.
 *
 * O `netstat -ano` é parseado aqui no Node de propósito: a versão original
 * montava um one-liner com sintaxe de cmd (`2>nul`, `&&`, `||`) e utilitário
 * Unix (`awk`) e mandava executar no powershell.exe. O PowerShell 5.1 não tem
 * `&&`/`||` nem `awk`, então o comando SEMPRE falhava, o catch engolia o erro e
 * o processo antigo continuava vivo — o uvicorn novo subia e morria com
 * WinError 10048 (porta já em uso).
 */
async function findPidsOnPortWin(port: number): Promise<number[]> {
  const pids = new Set<number>();
  try {
    const { stdout } = await execAsync('netstat -ano -p TCP', {
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    for (const rawLine of stdout.split(/\r?\n/)) {
      const parts = rawLine.trim().split(/\s+/);
      // Proto | Endereço local | Endereço externo | [Estado] | PID
      // LISTENING tem 5 colunas; algumas linhas sem estado têm 4.
      if (parts.length < 4) continue;
      if (!/^TCP$/i.test(parts[0])) continue;
      // Só o endereço LOCAL importa. Casar o remoto mataria um cliente qualquer
      // que estivesse apenas CONECTADO ao servidor OCR.
      // Aceita 127.0.0.1:8765, 0.0.0.0:8765 e [::1]:8765.
      const portMatch = parts[1].match(/:(\d+)$/);
      if (!portMatch || Number(portMatch[1]) !== port) continue;
      const pid = Number(parts[parts.length - 1]);
      // PID 0 = processo Idle (aparece em TIME_WAIT, que não bloqueia bind com
      // SO_REUSEADDR e não tem dono para matar).
      if (!Number.isInteger(pid) || pid <= 0) continue;
      // Nunca suicidar o próprio dev server.
      if (pid === process.pid) continue;
      pids.add(pid);
    }
  } catch {
    // sem netstat / falha ao listar — nada a matar por este caminho
  }
  return [...pids];
}

async function findPidsOnPortUnix(port: number): Promise<number[]> {
  const pids = new Set<number>();
  try {
    // -t só PIDs, sem -s: pega qualquer estado, não apenas LISTEN.
    const { stdout } = await execAsync(`lsof -ti tcp:${port} 2>/dev/null || true`);
    for (const raw of stdout.trim().split('\n')) {
      const pid = Number(raw.trim());
      if (!Number.isInteger(pid) || pid <= 0) continue;
      if (pid === process.pid) continue;
      pids.add(pid);
    }
  } catch {
    // ok
  }
  return [...pids];
}

async function findPidsOnPort(port: number): Promise<number[]> {
  return process.platform === 'win32'
    ? findPidsOnPortWin(port)
    : findPidsOnPortUnix(port);
}

async function killPid(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    // /T derruba também os workers filhos do uvicorn.
    await execAsync(`taskkill /F /T /PID ${pid}`, { windowsHide: true });
  } else {
    process.kill(pid, 'SIGKILL');
  }
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (free: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(free);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => done(false));
    socket.once('timeout', () => done(true));
    socket.once('error', () => done(true));
  });
}

/** Espera a porta ficar realmente livre depois do kill (o SO leva um tempo). */
async function waitForPortFree(port: number, tentativas = 10): Promise<boolean> {
  for (let i = 0; i < tentativas; i++) {
    if (await isPortFree(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

/**
 * Libera a porta do OCR matando QUALQUER processo que a esteja segurando.
 *
 * Não usa "conectou? então está ocupada" como gatilho: um processo pode ter a
 * porta reservada sem aceitar conexão (bind sem listen, socket meio-fechado,
 * servidor travado). Nesses casos o connect falha, mas o bind do uvicorn falha
 * também. Por isso a varredura por PID roda SEMPRE, e em mais de uma passada —
 * matar o pai pode fazer um filho reaparecer segurando o socket.
 */
async function killProcessOnPort(port: number): Promise<void> {
  const PASSADAS = 3;
  const naoMorreram = new Set<number>();

  for (let passada = 0; passada < PASSADAS; passada++) {
    const pids = await findPidsOnPort(port);
    if (pids.length === 0) break;

    for (const pid of pids) {
      try {
        await killPid(pid);
        process.stdout.write(`[OCR] Processo antigo na porta ${port} (PID ${pid}) encerrado.\n`);
        naoMorreram.delete(pid);
      } catch {
        // já morreu sozinho, ou não temos permissão — a checagem final decide
        naoMorreram.add(pid);
      }
    }

    // Dá tempo do SO liberar o socket antes de reavaliar.
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const restantes = await findPidsOnPort(port);
  if (restantes.length > 0 || !(await waitForPortFree(port))) {
    const detalhe = restantes.length > 0 ? ` (PID ${restantes.join(', ')})` : '';
    throw new Error(
      `A porta ${port} continua ocupada por processo que não consegui encerrar${detalhe}. ` +
        `Encerre-o manualmente (Gerenciador de Tarefas) e rode de novo.` +
        (naoMorreram.size > 0
          ? ` Se persistir, rode o terminal como administrador — o taskkill foi negado.`
          : ''),
    );
  }
}

async function waitForServer(
  retries: number,
  getExitInfo: () => string | null = () => null,
): Promise<void> {
  let lastError = '';
  for (let i = 0; i < retries; i++) {
    const exitInfo = getExitInfo();
    if (exitInfo) throw new Error(exitInfo);
    try {
      const response = await fetch(`http://127.0.0.1:${OCR_PORT}/health`, {
        signal: AbortSignal.timeout(2000)
      });
      if (response.ok) return;
      lastError = `Status ${response.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
  }
  throw new Error(`Servidor OCR não respondeu após ${retries * RETRY_DELAY}ms (${lastError})`);
}

export async function stopOcrServer(): Promise<void> {
  const proc = ocrProcess;
  ocrProcess = null;
  if (!proc) return;

  process.stdout.write('[OCR] Encerrando servidor...\n');

  // No Windows o SIGTERM do Node não derruba o uvicorn de forma confiável e
  // nunca alcança os workers filhos — sem /T o processo sobrevive e a porta
  // 8765 fica presa para a próxima execução (WinError 10048).
  if (process.platform === 'win32' && proc.pid) {
    try {
      await execAsync(`taskkill /F /T /PID ${proc.pid}`, { windowsHide: true });
    } catch {
      // já morreu ou não temos permissão
    }
  } else {
    proc.kill('SIGTERM');
  }

  // `proc.killed` só diz que o sinal foi enviado, não que o processo morreu —
  // esperar pelo evento 'exit' é o único jeito de saber de verdade.
  const morreu = await new Promise<boolean>((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) return resolve(true);
    const timer = setTimeout(() => resolve(false), 2000);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });

  if (!morreu) proc.kill('SIGKILL');

  // Garante que a porta ficou livre para o próximo `npm run dev`.
  await waitForPortFree(OCR_PORT, 6);
}
