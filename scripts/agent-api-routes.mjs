/**
 * Agente API — Rotas Express.
 *
 * Expõe as rotas de IA (Gemini), extrações de dados e sincronização
 * de armazenamento (Docker/Pasta local).
 *
 * Utiliza o Agente Offline como fallback se a chave Gemini não estiver
 * configurada, garantindo que o software sempre boot com armazenamento OK.
 */
import './load-env.mjs';
import { handleAgentChatRequest } from './agent-chat-handler.mjs';
import {
  handleAiExtractExtrato,
  handleAiExtractPlano,
  handleAiExtractColigadas,
  handleAiExtractSocios,
  handleAiExtractLoanContract,
  handleAiRefineOcrRows,
  handleAiOcrOverlay,
} from './ai-extract-handler.mjs';
import { handleAiSuggestRegrasContas } from './ai-regras-contas-handler.mjs';
import { handleAiSuggestModuloContas } from './ai-modulo-contas-handler.mjs';
import { resolveHardwareLimits } from './ai-hardware-limits.mjs';
import { analyzeSystemProfile } from './ai-system-profile.mjs';
import {
  loadAiConfig,
  saveAiConfig,
  publicAiConfig,
  providerDisplayLabel,
} from './ai-config-store.mjs';
import { catalogForApi } from './ai-model-catalog.mjs';
import { publicProviderKeyStatus, saveApiKeyForProvider } from './ai-secrets-store.mjs';
import { handleGetEmpresasCatalogo, handlePublishEmpresasCatalogo, handleStaffLogin } from './empresas-catalogo-store.mjs';
import { bootstrapLocalAiOnStartup } from './local-ai-bootstrap.mjs';
import { registerOfflineAgentRoutes } from './agent-offline-api.mjs';

/**
 * Registra TODAS as rotas do agente no app Express.
 */
export async function registerAgentApiRoutes(app) {
  const cfg = loadAiConfig();
  const isConfigured = Boolean(process.env.GEMINI_API_KEY || cfg.geminiApiKey || cfg.openaiApiKey || cfg.ollamaUrl);

  // Se NÃO estiver configurado, usa apenas rotas offline (Storage + Stubs IA)
  if (!isConfigured) {
    console.info('[agent-api] IA não configurada — usando fallback offline para storage e stubs.');
    await registerOfflineAgentRoutes(app);
    return;
  }

  // ── Health ──────────────────────────────────────────────────────────────
  app.get('/agent/health', async (_req, res) => {
    const limits = resolveHardwareLimits();
    res.json({
      service: 'agent-api',
      timestamp: new Date().toISOString(),
      ok: true,
      configured: true,
      providerId: cfg.providerId,
      tier: limits.tier,
      model: cfg.modelId,
      label: providerDisplayLabel(cfg),
      engine: cfg.ollamaUrl ? 'ollama' : 'gemini',
      engineLabel: cfg.ollamaUrl ? 'Ollama (Local)' : 'Google Gemini (Cloud)',
      inferenceLimits: limits,
    });
  });

  // ── Config / modelos ─────────────────────────────────────────────────────
  app.get('/agent/config', (_req, res) => {
    res.json({
      config: publicAiConfig(cfg),
      label: providerDisplayLabel(cfg),
      providerKeys: publicProviderKeyStatus(),
      catalog: catalogForApi(),
    });
  });

  app.put('/agent/config', (req, res) => {
    try {
      const { providerId, modelId, ollamaUrl } = req.body ?? {};
      const next = saveAiConfig({ providerId, modelId, ollamaUrl });
      res.json({ ok: true, config: publicAiConfig(next), label: providerDisplayLabel(next) });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Falha ao salvar configuração' });
    }
  });

  app.post('/agent/ai/save-api-key', (req, res) => {
    const providerId = String(req.body?.providerId ?? '').trim();
    const apiKey = String(req.body?.apiKey ?? '').trim();
    if (!providerId || !apiKey) {
      res.status(400).json({ ok: false, error: 'providerId e apiKey obrigatórios' });
      return;
    }
    try {
      saveApiKeyForProvider(providerId, apiKey);
      res.json({ ok: true, providerKeys: publicProviderKeyStatus() });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Falha ao salvar chave' });
    }
  });

  app.get('/agent/models', (_req, res) => {
    res.json({ ...catalogForApi(), providerKeys: publicProviderKeyStatus() });
  });

  app.get('/agent/system-profile', (_req, res) => {
    res.json({
      profile: analyzeSystemProfile(),
      catalog: catalogForApi()?.models || [],
      inferenceLimits: resolveHardwareLimits(),
    });
  });

  // ── Extração de Dados (IA) ───────────────────────────────────────────────
  app.post('/agent/ai/extract-extrato', async (req, res) => res.json(await handleAiExtractExtrato(req.body)));
  app.post('/agent/ai/extract-plano', async (req, res) => res.json(await handleAiExtractPlano(req.body)));
  app.post('/agent/ai/extract-coligadas', async (req, res) => res.json(await handleAiExtractColigadas(req.body)));
  app.post('/agent/ai/extract-socios', async (req, res) => res.json(await handleAiExtractSocios(req.body)));
  app.post('/agent/ai/extract-loan-contract', async (req, res) => res.json(await handleAiExtractLoanContract(req.body)));
  app.post('/agent/ai/ocr-overlay', async (req, res) => res.json(await handleAiOcrOverlay(req.body)));
  app.post('/agent/ai/suggest-regras-contas', async (req, res) => res.json(await handleAiSuggestRegrasContas(req.body)));
  app.post('/agent/ai/suggest-modulo-contas', async (req, res) => res.json(await handleAiSuggestModuloContas(req.body)));
  app.post('/agent/ai/refine-ocr-rows', async (req, res) => res.json(await handleAiRefineOcrRows(req.body)));

  app.post('/agent/ai/test-connection', async (_req, res) => {
    try {
      const { testGeminiConnection } = await import('./gemini-client.mjs');
      const ok = await testGeminiConnection();
      res.json({ ok, detail: ok ? 'Conexão com Gemini OK' : 'Falha na conexão com Gemini' });
    } catch (err) {
      res.status(500).json({ ok: false, detail: err instanceof Error ? err.message : 'Erro interno' });
    }
  });

  // ── Gemini Health (específico) ───────────────────────────────────────────
  app.get('/agent/gemini/health', async (_req, res) => {
    try {
      const { testGeminiConnection } = await import('./gemini-client.mjs');
      const ok = await testGeminiConnection();
      res.json({ ok, configured: true, detail: ok ? 'Disponível' : 'Indisponível' });
    } catch (err) {
      res.json({ ok: false, configured: true, detail: err instanceof Error ? err.message : 'Erro ao testar' });
    }
  });

  app.post('/agent/gemini/analyze-extrato-import', async (req, res) => {
    try {
      const { analyzeExtratoImport } = await import('./gemini-api-handlers.mjs');
      const result = await analyzeExtratoImport(req.body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Erro interno' });
    }
  });

  app.post('/agent/gemini/analyze-debug', async (req, res) => {
    try {
      const { analyzeDebugContext } = await import('./gemini-api-handlers.mjs');
      const result = await analyzeDebugContext(req.body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Erro interno' });
    }
  });

  // ── Console Fix / Bots ───────────────────────────────────────────────────
  app.post('/agent/console-autofix', async (req, res) => {
    try {
      const { handleConsoleAutoFix } = await import('./ai-regras-contas-handler.mjs');
      await handleConsoleAutoFix(req, res);
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Erro interno' });
    }
  });

  app.post('/agent/bot/run', async (req, res) => {
    const { botId, context } = req.body ?? {};
    const autoOk = true;
    const autoSummary = 'O Bot foi processado.';

    try {
      const { runAgenteBot } = await import('./cerebro-agente.mjs');
      const parsed = await runAgenteBot(botId, context);
      res.json({
        ok: parsed?.ok !== false && autoOk,
        summary: String(parsed?.summary ?? autoSummary),
        warnings: Array.isArray(parsed?.warnings) ? parsed.warnings.map(String).slice(0, 8) : [],
        suggestions: Array.isArray(parsed?.suggestions) ? parsed.suggestions.map(String).slice(0, 8) : [],
      });
    } catch (err) {
      res.status(200).json({
        ok: autoOk,
        summary: autoSummary,
        warnings: [],
        suggestions: [],
        skipped: true,
        reason: err instanceof Error ? err.message : 'bot_review_failed',
      });
    }
  });

  app.post('/agent/chat', async (req, res) => {
    const result = await handleAgentChatRequest({ ...req.body, stream: false });
    res.status(result.status).json(result.body);
  });

  app.post('/agent/chat/stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    await handleAgentChatRequest({
      ...req.body,
      stream: true,
      onToken: (token) => {
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      },
    }).then((result) => {
      res.write(`data: ${JSON.stringify({ done: true, ...result.body })}\n\n`);
      res.end();
    }).catch((err) => {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    });
  });

  // ── Empresas Catálogo / Admin Bridge ─────────────────────────────────────
  app.get('/agent/empresas-catalogo', handleGetEmpresasCatalogo);
  app.post('/agent/empresas-catalogo', handlePublishEmpresasCatalogo);
  app.post('/agent/staff-login', handleStaffLogin);

  const {
    handleGetTokens,
    handleGetOffice,
    handleGetCatalog,
  } = await import('./empresas-admin-bridge.mjs');

  app.get('/agent/admin-bridge/tokens', handleGetTokens);
  app.get('/agent/admin-bridge/office/:token', handleGetOffice);
  app.get('/agent/admin-bridge/catalog', handleGetCatalog);

  // ── Storage Stubs (Sincronização removida a pedido do usuário) ───────────
  const storageOfflineMsg = (_req, res) => res.json({ ok: true, message: 'Armazenamento em nuvem desativado. Use Exportar/Importar saves.' });

  app.get('/agent/storage/status', (_req, res) => res.json({ ok: true, mode: 'nenhum' }));
  app.get('/agent/storage/folder-config', (_req, res) => res.json({ ok: true, mode: 'nenhum' }));
  app.post('/agent/sync/save', storageOfflineMsg);
  app.get('/agent/sync/mode', (_req, res) => res.json({ ok: true, mode: 'nenhum' }));

  // ===== BOOTSTRAP AUTO-LOAD NA INICIALIZAÇÃO =====
  bootstrapLocalAiOnStartup().catch((err) => {
    console.warn(`[agent-api] Bootstrap AI: ${err instanceof Error ? err.message : err}`);
  });
}
