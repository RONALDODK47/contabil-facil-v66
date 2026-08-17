/**
 * Servidor dedicado do agente IA — padrão FlowMind (processo separado do Vite).
 * Porta padrão: 8790 · rotas em /agent/*
 */
import './production-start-guard.mjs';
import './load-env.mjs';
import express from 'express';
import { registerAgentRoutes } from './agent-api-routes.mjs';
import { fiscalNfeApp } from './fiscal-nfe-api.mjs';

(async () => {
  const app = express();
  /** Render/Railway injetam PORT; local usa AGENT_API_PORT ou 8790. */
  const PORT = Number(process.env.PORT || process.env.AGENT_API_PORT || 8790);
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const HOST =
    process.env.AGENT_API_HOST || (isProd ? '0.0.0.0' : '127.0.0.1');

  function sanitizeCorsOrigin(raw) {
    return String(raw || '')
      .replace(/^["']|["']$/g, '')
      .replace(/[\r\n\u0000-\u001F\u007F]/g, '')
      .trim();
  }

  const corsOrigins = String(process.env.CORS_ALLOWED_ORIGIN || '')
    .split(',')
    .map((o) => sanitizeCorsOrigin(o))
    .filter(Boolean);

  function isValidCorsOrigin(origin) {
    if (!origin || /[\r\n]/.test(origin)) return false;
    try {
      const u = new URL(origin);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function resolveCorsOrigin(requestOrigin) {
    const reqOrigin = sanitizeCorsOrigin(requestOrigin);
    if (!isProd) {
      const dev = corsOrigins.find(isValidCorsOrigin);
      return dev || reqOrigin || '*';
    }
    /** Health-check do Render não envia Origin — não setar header CORS. */
    if (!reqOrigin) return '';
    if (corsOrigins.includes(reqOrigin) && isValidCorsOrigin(reqOrigin)) return reqOrigin;
    /** GitHub Pages (qualquer *.github.io) — frontend estático na nuvem. */
    if (reqOrigin.endsWith('.github.io') && isValidCorsOrigin(reqOrigin)) return reqOrigin;
    const fallback = corsOrigins.find(isValidCorsOrigin);
    return fallback || '';
  }

  function safeSetCorsHeader(res, origin) {
    if (!origin || origin === '*') {
      if (origin === '*') res.setHeader('Access-Control-Allow-Origin', '*');
      return;
    }
    if (!isValidCorsOrigin(origin)) {
      console.warn('[agent-api] CORS_ALLOWED_ORIGIN inválido — corrija no Render:', origin.slice(0, 80));
      return;
    }
    try {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    } catch (err) {
      console.warn('[agent-api] Falha ao setar CORS:', err instanceof Error ? err.message : err);
    }
  }

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (isProd) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  /** Health antes do CORS — Render pinga /health sem header Origin. */
  app.get('/health', (_req, res) => {
    res.status(200).json({
      ok: true,
      service: 'agent-api-server',
      port: PORT,
      timestamp: new Date().toISOString(),
    });
  });

  app.use((req, res, next) => {
    const requestOrigin = String(req.headers.origin || '').trim();
    const allowed = resolveCorsOrigin(requestOrigin);
    safeSetCorsHeader(res, allowed);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Office-Token, X-User-Id',
    );
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  /** Workspace/pastas podem trazer PDF base64 — limite maior. */
  app.use(express.json({ limit: '200mb' }));
  app.use(express.urlencoded({ limit: '200mb', extended: false }));

  const agentRouter = express();
  await registerAgentRoutes(agentRouter);
  app.use(agentRouter);

  /** Alias /api/agent/* → mesmas rotas (VITE_AGENT_API_URL em produção). */
  app.use('/api/agent', (req, res, next) => {
    const suffix = req.url.startsWith('/') ? req.url : `/${req.url}`;
    req.url = `/agent${suffix}`;
    agentRouter(req, res, next);
  });

  /**
   * API fiscal completa (NF-e Distribuição DF-e, XML, SPED, RF, ICMS)
   * montada sob /api/fiscal-nfe — usada pelo frontend em GitHub Pages via Render.
   */
  app.use('/api/fiscal-nfe', fiscalNfeApp);

  const server = app.listen(PORT, HOST, () => {
    console.info(
      `[agent-api] Servidor online — http://${HOST}:${PORT}/agent/health · /api/agent/health`,
    );
  });

  /** Aumenta timeout para suportar grandes volumes de importação (importar razão, extrato, plano, etc.).
   *  O padrão do Node (0 = infinito) pode travar conexões zumbis; 5 min é suficiente para qualquer payload. */
  server.setTimeout(5 * 60 * 1000); // 5 min
  server.headersTimeout = 5 * 60 * 1000 + 5000;
  server.requestTimeout = 5 * 60 * 1000;

  server.on('error', (err) => {
    if (err?.code === 'EADDRINUSE') {
      console.error(`[agent-api] Porta ${PORT} em uso — rode npm run dev:free-ports`);
    } else {
      console.error('[agent-api] Falha ao subir:', err?.message || err);
    }
    process.exit(1);
  });

  function shutdown() {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})().catch((err) => {
  console.error('[agent-api] Falha ao iniciar:', err instanceof Error ? err.message : err);
  process.exit(1);
});
