/**
 * Dev: /api/agent/* servido direto no Vite — somente Gemini (sem proxy :8790 / Ollama).
 */
import { analyzeSystemProfile } from './ai-system-profile.mjs';
import { EMBEDDED_AI_CATALOG, DEFAULT_EMBEDDED_MODEL_ID } from './embedded-ai.mjs';
import { dispatchGeminiApiRoute } from './gemini-api-handlers.mjs';
import { handleAgentChatRequest } from './agent-chat-handler.mjs';
import { handleGeminiHealth } from './gemini-api-handlers.mjs';
import { resolveHardwareLimits } from './ai-hardware-limits.mjs';
import { loadAiConfig, saveAiConfig, publicAiConfig, providerDisplayLabel } from './ai-config-store.mjs';
import { catalogForApi, normalizeSelectedModel, findModelInCatalog } from './ai-model-catalog.mjs';
import {
  publicProviderKeyStatus,
  saveApiKeyForProvider,
  isProviderConfigured,
} from './ai-secrets-store.mjs';
import { handleAiExtractExtrato, handleAiExtractPlano, handleAiExtractColigadas, handleAiExtractSocios } from './ai-extract-handler.mjs';
import { pingGeminiApi } from './gemini-client.mjs';
import {
  handleGetEmpresasCatalogo,
  handlePublishEmpresasCatalogo,
  handleStaffLogin,
} from './empresas-catalogo-store.mjs';

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseJsonBody(buf) {
  if (!buf || buf.length === 0) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

const AGENT_API_ORIGIN = `http://127.0.0.1:${process.env.AGENT_API_PORT || 8790}`;

/** Rotas workspace servidas no Vite quando o agent-api (:8790) está desatualizado ou offline. */
async function dispatchWorkspaceRouteLocally(pathname, method, jsonBody, req) {
  if (method !== 'POST') return null;

  if (pathname === '/workspace/merge-office-suffixes') {
    try {
      const { isPostgresStorageEnabled } = await import('./storage/pg-client.mjs');
      if (!isPostgresStorageEnabled()) {
        return { status: 503, body: { ok: false, skipped: true, error: 'postgres_disabled' } };
      }
      const { mergeMissingManagerSuffixes } = await import('./storage/workspace-repo.mjs');
      const fromToken = String(jsonBody?.fromToken || '').trim();
      const toToken = String(jsonBody?.toToken || '').trim();
      const uid = String(jsonBody?.uid || req.headers['x-user-id'] || '').trim();
      if (!fromToken || !toToken) {
        return { status: 400, body: { ok: false, error: 'fromToken e toToken obrigatórios' } };
      }
      const result = await mergeMissingManagerSuffixes(fromToken, toToken, uid);
      return { status: 200, body: result };
    } catch (err) {
      return {
        status: 500,
        body: { ok: false, error: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  return null;
}

/** Encaminha /api/agent/workspace/* e /api/agent/storage/* para o agent-api (:8790) —
 * Postgres/MinIO e provisionamento de armazenamento (RPA puro, sem IA). */
async function proxyWorkspaceToAgentApi(req, res, subPath, rawBody) {
  const pathname = subPath.split('?')[0];
  const method = req.method || 'GET';
  const jsonBody = parseJsonBody(rawBody) ?? {};

  const localFirst = pathname.startsWith('/workspace')
    ? await dispatchWorkspaceRouteLocally(pathname, method, jsonBody, req)
    : null;
  if (localFirst) {
    sendJson(res, localFirst.status, localFirst.body);
    return;
  }

  const targetUrl = `${AGENT_API_ORIGIN}/agent${subPath}`;
  try {
    const headers = {
      Accept: 'application/json',
      'Content-Type': req.headers['content-type'] || 'application/json',
    };
    if (req.headers['x-office-token']) headers['X-Office-Token'] = req.headers['x-office-token'];
    if (req.headers['x-user-id']) headers['X-User-Id'] = req.headers['x-user-id'];
    if (req.headers.authorization) headers.Authorization = req.headers.authorization;

    const init = {
      method: req.method || 'GET',
      headers,
    };
    if (rawBody && rawBody.length > 0 && req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = rawBody;
    }
    const upstream = await fetch(targetUrl, init);
    if (upstream.status === 404) {
      const local = await dispatchWorkspaceRouteLocally(pathname, method, jsonBody, req);
      if (local) {
        sendJson(res, local.status, local.body);
        return;
      }
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.statusCode = upstream.status;
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    const cd = upstream.headers.get('content-disposition');
    if (cd) res.setHeader('Content-Disposition', cd);
    res.end(buf);
  } catch (err) {
    sendJson(res, 503, {
      ok: false,
      error:
        'Agent-api offline (:8790). Rode npm run agent-api e npm run storage:setup (Postgres/MinIO).',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

async function agentStub(pathname, method, jsonBody) {
  if (pathname === '/health') {
    const gemini = await handleGeminiHealth();
    const inferenceLimits = resolveHardwareLimits();
    return {
      status: 200,
      body: {
        service: 'vite-gemini',
        timestamp: new Date().toISOString(),
        ...gemini.body,
        providerId: 'gemini',
        tier: 'gemini',
        label: 'Gemini AI',
        engine: gemini.body.ok ? 'gemini' : 'offline',
        engineLabel: gemini.body.detail ?? 'Gemini',
        inferenceLimits,
      },
    };
  }
  if (pathname === '/config' && method === 'GET') {
    const config = loadAiConfig();
    return {
      status: 200,
      body: {
        config: publicAiConfig(config),
        label: providerDisplayLabel(config),
        providerKeys: publicProviderKeyStatus(),
        catalog: catalogForApi(),
      },
    };
  }
  if (pathname === '/config' && method === 'PUT') {
    const body = jsonBody ?? {};
    const prev = loadAiConfig();
    const providerId = String(body.providerId ?? prev.providerId ?? 'gemini').trim();
    const model = normalizeSelectedModel(providerId, body.localModel || body.model || prev.model);
    const patch = { providerId, tier: providerId, localModel: model, model };
    if (body.extractEngine) {
      patch.extractEngine = 'ai';
    }
    const entry = findModelInCatalog(model);
    if (entry) patch.pricingTier = entry.tier;
    if (body.apiKey && body.apiKeyProvider) {
      saveApiKeyForProvider(body.apiKeyProvider, body.apiKey);
    } else if (body.removeApiKey && body.apiKeyProvider) {
      saveApiKeyForProvider(body.apiKeyProvider, '');
    }
    if (body.apiKeys && typeof body.apiKeys === 'object') {
      for (const [pid, key] of Object.entries(body.apiKeys)) {
        if (typeof key === 'string' && key.trim()) saveApiKeyForProvider(pid, key);
      }
    }
    const saved = saveAiConfig(patch);
    return {
      status: 200,
      body: {
        config: publicAiConfig(saved),
        label: providerDisplayLabel(saved),
        providerKeys: publicProviderKeyStatus(),
      },
    };
  }
  if (pathname === '/models' && method === 'GET') {
    return { status: 200, body: { ...catalogForApi(), providerKeys: publicProviderKeyStatus() } };
  }
  if (pathname === '/ai/extract-extrato' && method === 'POST') {
    const out = await handleAiExtractExtrato(jsonBody ?? {});
    return { status: out.status, body: out.body };
  }
  if (pathname === '/ai/extract-plano' && method === 'POST') {
    const out = await handleAiExtractPlano(jsonBody ?? {});
    return { status: out.status, body: out.body };
  }
  if (pathname === '/ai/extract-coligadas' && method === 'POST') {
    const out = await handleAiExtractColigadas(jsonBody ?? {});
    return { status: out.status, body: out.body };
  }
  if (pathname === '/ai/extract-socios' && method === 'POST') {
    const out = await handleAiExtractSocios(jsonBody ?? {});
    return { status: out.status, body: out.body };
  }
  if (pathname === '/ai/save-api-key' && method === 'POST') {
    const providerId = String(jsonBody?.providerId ?? '').trim();
    const apiKey = String(jsonBody?.apiKey ?? '').trim();
    if (!providerId) {
      return { status: 400, body: { ok: false, error: 'providerId obrigatório' } };
    }
    if (!apiKey) {
      return { status: 400, body: { ok: false, error: 'apiKey obrigatória' } };
    }
    try {
      saveApiKeyForProvider(providerId, apiKey);
      return { status: 200, body: { ok: true, providerKeys: publicProviderKeyStatus() } };
    } catch (err) {
      return {
        status: 400,
        body: { ok: false, error: err instanceof Error ? err.message : 'Falha ao salvar chave' },
      };
    }
  }
  if (pathname === '/ai/test-connection' && method === 'POST') {
    const providerId = String(jsonBody?.providerId ?? loadAiConfig().providerId ?? 'gemini');
    if (!isProviderConfigured(providerId)) {
      return { status: 503, body: { ok: false, detail: 'Chave API não configurada' } };
    }
    if (providerId === 'gemini') {
      const ping = await pingGeminiApi();
      return { status: 200, body: ping };
    }
    return { status: 200, body: { ok: true, detail: `Chave ${providerId} salva` } };
  }
  if (pathname === '/system-profile') {
    const profile = analyzeSystemProfile();
    const inferenceLimits = resolveHardwareLimits(profile);
    const catalog = EMBEDDED_AI_CATALOG.map(({ id, label, minRamGb, description }) => ({
      id,
      label,
      minRamGb,
      description,
    }));
    return { status: 200, body: { profile, catalog, inferenceLimits } };
  }
  if (pathname === '/console-autofix' && method === 'POST') {
    return { status: 200, body: { ok: true, skipped: true, reason: 'use_gemini_debug' } };
  }
  if (pathname === '/local-ai/pull-status' || pathname === '/local-ai/status' || pathname === '/local-ai/setup') {
    const gemini = await handleGeminiHealth();
    return {
      status: 200,
      body: {
        active: false,
        online: gemini.body.ok,
        model: gemini.body.model ?? DEFAULT_EMBEDDED_MODEL_ID,
        detail: gemini.body.detail,
        engine: gemini.body.ok ? 'gemini' : 'offline',
      },
    };
  }
  if (pathname === '/chat' && method === 'POST') {
    const result = await handleAgentChatRequest({
      contents: jsonBody?.contents,
      systemInstruction: jsonBody?.systemInstruction,
      fast: jsonBody?.fast,
    });
    return { status: result.status, body: result.body };
  }
  if (pathname === '/bot/run' && method === 'POST') {
    return {
      status: 200,
      body: { ok: true, skipped: true, reason: 'gemini_bot_via_agent_api', summary: 'Automação registrada' },
    };
  }
  return { status: 503, body: { error: 'Rota indisponível — use /api/agent/gemini/*' } };
}

export function agentApiDevFallback() {
  return {
    name: 'agent-api-dev-fallback',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/api/agent')) return next();

        const subPath = url.replace(/^\/api\/agent/, '') || '/health';
        const pathname = subPath.split('?')[0];
        const search = new URL(url, 'http://127.0.0.1').searchParams;
        const method = req.method ?? 'GET';

        let rawBody;
        if (method !== 'GET' && method !== 'HEAD') {
          try {
            rawBody = await readRequestBody(req);
          } catch {
            sendJson(res, 400, { error: 'Corpo da requisição inválido' });
            return;
          }
        }

        if (pathname.startsWith('/workspace') || pathname.startsWith('/storage')) {
          await proxyWorkspaceToAgentApi(req, res, subPath, rawBody);
          return;
        }

        const jsonBody = parseJsonBody(rawBody);
        if (rawBody && rawBody.length > 0 && jsonBody === null) {
          sendJson(res, 400, { error: 'JSON inválido' });
          return;
        }

        if (pathname === '/empresas-catalogo' || pathname === '/staff-login') {
          req.body = jsonBody ?? {};
          if (pathname === '/empresas-catalogo' && method === 'GET') {
            await handleGetEmpresasCatalogo(req, res);
            return;
          }
          if (pathname === '/empresas-catalogo' && method === 'POST') {
            await handlePublishEmpresasCatalogo(req, res);
            return;
          }
          if (pathname === '/staff-login' && method === 'POST') {
            await handleStaffLogin(req, res);
            return;
          }
        }

        const geminiRoute =
          pathname.startsWith('/gemini/') ||
          pathname.startsWith('/ai/') ||
          (pathname === '/assist' && method === 'POST');

        if (geminiRoute) {
          try {
            const result = await dispatchGeminiApiRoute(pathname, method, jsonBody ?? {}, search);
            if (result) {
              sendJson(res, result.status, result.body);
              return;
            }
          } catch (err) {
            sendJson(res, 500, {
              ok: false,
              detail: err instanceof Error ? err.message : 'Falha Gemini',
            });
            return;
          }
        }

        if (pathname === '/chat/stream' && method === 'POST') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          res.setHeader('Connection', 'keep-alive');
          const sendSse = (obj) => {
            if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
          };
          try {
            const result = await handleAgentChatRequest({
              contents: jsonBody?.contents,
              systemInstruction: jsonBody?.systemInstruction,
              fast: jsonBody?.fast,
              stream: true,
              onToken: (token) => sendSse({ token }),
            });
            if (result.status !== 200) {
              sendSse({ token: result.body?.error ?? 'Erro' });
            }
            sendSse({ done: true, functionCalls: result.body?.functionCalls ?? [] });
            res.end();
          } catch (err) {
            sendSse({ token: err instanceof Error ? err.message : 'Falha no chat' });
            sendSse({ done: true, functionCalls: [] });
            res.end();
          }
          return;
        }

        try {
          const stub = await agentStub(pathname, method, jsonBody ?? {});
          sendJson(res, stub.status, stub.body);
        } catch (err) {
          sendJson(res, 500, {
            ok: false,
            detail: err instanceof Error ? err.message : 'Falha no agente',
          });
        }
      });
    },
  };
}
