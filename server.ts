import http from 'http';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createServer as createViteServer } from 'vite';
import './scripts/load-env.mjs';
import { startOcrServer, stopOcrServer } from './scripts/ocr-server.mts';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Mata qualquer processo já escutando na porta antes de subir — evita o clássico
 * "porta já em uso" quando uma sessão anterior travou/crashou e deixou o processo
 * velho vivo. Desliga com KILL_PORT_ON_START=false se algum dia precisar preservar
 * o processo que já está na porta.
 */
async function killProcessOnPort(port: number): Promise<void> {
  if (process.env.KILL_PORT_ON_START === 'false') return;

  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(`netstat -ano | findstr LISTENING | findstr :${port}`);
      const localAddrPattern = new RegExp(`[:.]${port}$`);
      const pids = new Set<string>();
      for (const line of stdout.split('\n')) {
        const parts = line.trim().split(/\s+/);
        const localAddr = parts[1] ?? '';
        const pid = parts[parts.length - 1] ?? '';
        if (localAddrPattern.test(localAddr) && pid && pid !== '0') pids.add(pid);
      }
      for (const pid of pids) {
        try {
          await execAsync(`taskkill /F /PID ${pid}`);
          process.stdout.write(`  🔪  Processo antigo na porta ${port} (PID ${pid}) encerrado.\n`);
        } catch {
          // Já pode ter morrido sozinho entre o netstat e o taskkill — ok ignorar.
        }
      }
    } else {
      const { stdout } = await execAsync(`lsof -ti tcp:${port}`);
      for (const pid of stdout.split('\n').map((s) => s.trim()).filter(Boolean)) {
        try {
          process.kill(Number(pid), 'SIGKILL');
          process.stdout.write(`  🔪  Processo antigo na porta ${port} (PID ${pid}) encerrado.\n`);
        } catch {
          // Já morto ou sem permissão — ok ignorar.
        }
      }
    }
  } catch {
    // netstat/lsof sem saída (nenhum processo na porta) — nada a fazer.
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;
  const isProd = process.env.NODE_ENV === 'production';
  const CONVERSOR_DIR = path.join(__dirname, 'conversor');

  await killProcessOnPort(PORT);

  // ── Rotas de IA que recebem payload enorme (fileBase64 de PDF inteiro) ──────
  // Registradas ANTES do express.json() para evitar que o body-parser tente ler
  // 24 MB+ de base64 e lance "BadRequestError: request aborted" quando o cliente
  // cancela ou o arquivo é muito grande para o limite configurado.
  // Em modo offline (sem chave API configurada) responde 503 imediatamente,
  // sem jamais ler o corpo da requisição.
  const AI_HEAVY_ROUTES = [
    '/agent/ai/extract-extrato',
    '/agent/ai/extract-plano',
    '/agent/ai/extract-coligadas',
    '/agent/ai/extract-socios',
    '/agent/ai/extract-loan-contract',
    '/agent/ai/ocr-overlay',
    '/api/agent/ai/extract-extrato',
    '/api/agent/ai/extract-plano',
    '/api/agent/ai/extract-coligadas',
    '/api/agent/ai/extract-socios',
    '/api/agent/ai/extract-loan-contract',
    '/api/agent/ai/ocr-overlay',
  ];
  for (const route of AI_HEAVY_ROUTES) {
    app.post(route, (req, res) => {
      // Drena o corpo sem processá-lo para liberar a conexão TCP corretamente.
      req.resume();
      res.status(503).json({ ok: false, error: 'IA offline — configure GEMINI_API_KEY.' });
    });
  }

  // Workspace/pastas podem trazer PDF base64 — limite maior.
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: false }));

  // Health check
  app.get('/health', (_req, res) => {
    res.status(200).json({
      ok: true,
      service: 'eye-vision-server',
      timestamp: new Date().toISOString(),
    });
  });

  // Agent routes — sempre offline (sem IA remota, sem sync com Docker/Postgres/MinIO/Supabase).
  // O único jeito de mover dados agora é Exportar/Importar backup JSON, manual.
  let _agentRouterPromise: Promise<express.Express> | null = null;
  const getAgentRouter = (): Promise<express.Express> => {
    if (!_agentRouterPromise) {
      _agentRouterPromise = (async () => {
        const router = express();
        const { registerOfflineAgentRoutes } = await import('./scripts/agent-offline-api.mjs');
        await registerOfflineAgentRoutes(router);
        return router;
      })();
    }
    return _agentRouterPromise;
  };

  // /agent/* — rotas diretas
  app.use('/agent', async (req, res, next) => {
    try {
      const router = await getAgentRouter();
      router(req, res, next);
    } catch (err) {
      console.error('[server] Error in /agent route:', err instanceof Error ? err.message : err);
      if (err instanceof Error && err.stack) console.error(err.stack);
      if (!res.headersSent) res.status(503).json({ error: 'Agent routes not available.' });
    }
  });

  // /api/agent/* — alias: reescreve URL e despacha para o mesmo router
  app.use('/api/agent', async (req, res, next) => {
    try {
      const router = await getAgentRouter();
      // req.url dentro de app.use('/api/agent') já é o sufixo após /api/agent
      // Precisamos prefixar /agent para que o router encontre as rotas
      const suffix = req.url.startsWith('/') ? req.url : `/${req.url}`;
      req.url = `/agent${suffix}`;
      router(req, res, next);
    } catch (err) {
      console.error('[server] Error in /api/agent route:', err instanceof Error ? err.message : err);
      if (err instanceof Error && err.stack) console.error(err.stack);
      if (!res.headersSent) res.status(503).json({ error: 'Agent routes not available.' });
    }
  });

  // Lazy-load fiscal API
  let _fiscalApp: express.Express | null = null;
  const getFiscalApp = async () => {
    if (!_fiscalApp) {
      const { fiscalNfeApp } = await import('./scripts/fiscal-nfe-api.mjs');
      _fiscalApp = fiscalNfeApp;
    }
    return _fiscalApp;
  };
  app.use('/api/fiscal-nfe', async (req, res, next) => {
    try {
      const fiscalApp = await getFiscalApp();
      fiscalApp(req, res, next);
    } catch {
      if (!res.headersSent) res.status(503).json({ error: 'Fiscal API not available.' });
    }
  });

  // Cria o servidor HTTP nativo antes do Vite
  const httpServer = http.createServer(app);

  // Rota para o conversor (OCR local)
  if (!isProd) {
    let conversorVite: any = null;
    const getConversorVite = async () => {
      if (!conversorVite) {
        conversorVite = await createViteServer({
          configFile: path.join(CONVERSOR_DIR, 'vite.config.ts'),
          server: {
            middlewareMode: true,
            hmr: false,
          },
          appType: 'spa',
          root: CONVERSOR_DIR,
        });
      }
      return conversorVite;
    };

    app.use('/conversor', async (req, res, next) => {
      try {
        const vite = await getConversorVite();
        // Reescreve URL para remover /conversor
        const originalUrl = req.url;
        req.url = originalUrl === '/conversor' ? '/' : originalUrl.replace(/^\/conversor/, '');
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  } else {
    // Em produção, serve o dist compilado do conversor em /conversor
    const conversorDistPath = path.join(CONVERSOR_DIR, 'dist');
    app.use('/conversor', express.static(conversorDistPath));
    app.get('/conversor/*', (_req, res) => {
      res.sendFile(path.join(conversorDistPath, 'index.html'));
    });
  }

  if (!isProd) {
    // Vite em modo middleware — HMR via mesmo servidor HTTP
    // Interface principal: contabil-facil
    const vite = await createViteServer({
      configFile: path.join(__dirname, 'vite.config.ts'),
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });

    app.use(vite.middlewares);

    // ✅ HMR desabilitado - sem WebSocket upgrade necessário
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // ── Error handler global ─────────────────────────────────────────────────
  // Captura "BadRequestError: request aborted" emitido pelo raw-body (usado
  // pelo express.json/urlencoded) quando o browser fecha a conexão antes de
  // terminar de enviar o body — acontece ao navegar para outra aba, fechar o
  // modal ou quando o upload de PDF base64 para IA é cancelado.
  // Sem este handler o Express deixa o erro virar um log de stack-trace no
  // console, mesmo sendo completamente inofensivo.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: import('express').Request, res: import('express').Response, _next: import('express').NextFunction) => {
    const isClientAbort =
      err?.type === 'request.aborted' ||
      /request aborted/i.test(err?.message ?? '') ||
      err?.code === 'ECONNRESET';
    if (isClientAbort) {
      if (!res.headersSent) res.status(400).end();
      return;
    }
    // Erros reais: loga e responde 500
    process.stderr.write(`[server] Unhandled error: ${err?.message ?? err}\n`);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  });

  // Inicia servidor OCR antes do servidor principal
  if (!isProd) {
    await startOcrServer().catch(err => {
      process.stderr.write(`[OCR] Não foi possível iniciar: ${err instanceof Error ? err.message : err}\n`);
    });
  }

  // Sobe o servidor
  await new Promise<void>((resolve, reject) => {
    httpServer.listen(PORT, '0.0.0.0', () => resolve());
    httpServer.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        process.stderr.write(`\n  ❌  Porta ${PORT} já está em uso. Feche o outro processo e tente de novo.\n\n`);
      } else {
        process.stderr.write(`\n  ❌  Erro: ${err.message}\n\n`);
      }
      reject(err);
    });
  });

  process.stdout.write('\n');
  process.stdout.write('  ┌─────────────────────────────────────────┐\n');
  process.stdout.write('  │                                         │\n');
  process.stdout.write('  │   ✅  Servidor rodando!                 │\n');
  process.stdout.write('  │                                         │\n');
  process.stdout.write(`  │   🌐  http://localhost:${PORT}             │\n`);
  process.stdout.write('  │                                         │\n');
  process.stdout.write('  └─────────────────────────────────────────┘\n');
  process.stdout.write('\n');

  // Graceful shutdown
  const shutdown = async () => {
    process.stdout.write('\n[server] Encerrando...\n');
    await stopOcrServer();
    httpServer.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch(() => process.exit(1));
