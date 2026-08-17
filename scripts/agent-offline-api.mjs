/**
 * Agente API Offline — sem Gemini, sem Ollama.
 *
 * Responde rotas de IA com mensagens offline amigáveis.
 */
import './load-env.mjs';
import express from 'express';
import {
  loadAiConfig,
  publicAiConfig,
  providerDisplayLabel,
} from './ai-config-store.mjs';
import { catalogForApi } from './ai-model-catalog.mjs';
import { publicProviderKeyStatus } from './ai-secrets-store.mjs';
import { handleGetEmpresasCatalogo, handlePublishEmpresasCatalogo, handleStaffLogin } from './empresas-catalogo-store.mjs';
import { handleGetTokens, handleGetOffice, handleGetCatalog } from './empresas-admin-bridge.mjs';

const OFFLINE_CHAT_REPLY =
  'A IA está offline (GEMINI_API_KEY não configurada). ' +
  'Configure a chave no menu de IA e reinicie o servidor.';

const OFFLINE_HEALTH = {
  ok: false,
  configured: false,
  providerId: 'offline',
  tier: 'offline',
  model: 'none',
  label: 'IA Offline',
  engine: 'offline',
  engineLabel: 'Sem chave API configurada',
  detail: 'Configure GEMINI_API_KEY no .env',
};

/** Registra TODAS as rotas no app Express recebido. */
export async function registerOfflineAgentRoutes(app) {
  // ── Health ──────────────────────────────────────────────────────────────
  app.get('/agent/health', (_req, res) => {
    res.json({
      service: 'agent-offline',
      timestamp: new Date().toISOString(),
      ...OFFLINE_HEALTH,
      inferenceLimits: { tier: 'offline', tierLabel: 'Modo offline' },
    });
  });

  // ── Config / modelos ─────────────────────────────────────────────────────
  app.get('/agent/config', (_req, res) => {
    const cfg = loadAiConfig();
    res.json({
      config: publicAiConfig(cfg),
      label: providerDisplayLabel(cfg),
      providerKeys: publicProviderKeyStatus(),
      catalog: catalogForApi(),
    });
  });

  app.put('/agent/config', (req, res) => {
    res.json({ ok: false, error: 'IA offline — configure GEMINI_API_KEY para alterar configurações.' });
  });

  app.get('/agent/models', (_req, res) => {
    res.json({ ...catalogForApi(), providerKeys: publicProviderKeyStatus() });
  });

  app.get('/agent/system-profile', (_req, res) => {
    res.json({ profile: {}, catalog: [], inferenceLimits: { tier: 'offline' } });
  });

  // ── Gemini health ────────────────────────────────────────────────────────
  app.get('/agent/gemini/health', (_req, res) => {
    res.json({ ok: false, configured: false, detail: 'GEMINI_API_KEY não configurada' });
  });

  // ── Chat (offline reply) ─────────────────────────────────────────────────
  app.post('/agent/chat', (_req, res) => {
    res.json({ text: OFFLINE_CHAT_REPLY, functionCalls: [] });
  });

  app.post('/agent/chat/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(`data: ${JSON.stringify({ token: OFFLINE_CHAT_REPLY })}\n\n`);
    res.write(`data: ${JSON.stringify({ done: true, functionCalls: [] })}\n\n`);
    res.end();
  });

  // ── AI extractions (offline stub) ────────────────────────────────────────
  const offlineAi = (_req, res) =>
    res.status(503).json({ ok: false, error: 'IA offline — configure GEMINI_API_KEY.' });

  app.post('/agent/ai/extract-extrato',       offlineAi);
  app.post('/agent/ai/extract-plano',         offlineAi);
  app.post('/agent/ai/extract-coligadas',     offlineAi);
  app.post('/agent/ai/extract-socios',        offlineAi);
  app.post('/agent/ai/extract-loan-contract', offlineAi);
  app.post('/agent/ai/ocr-overlay',           offlineAi);
  app.post('/agent/ai/suggest-regras-contas', offlineAi);
  app.post('/agent/ai/suggest-modulo-contas', offlineAi);
  app.post('/agent/ai/refine-ocr-rows',       offlineAi);
  app.post('/agent/ai/test-connection', (_req, res) =>
    res.json({ ok: false, detail: 'IA offline' }));

  app.post('/agent/assist',          (_req, res) => res.json({ ok: false, skipped: true, reason: 'offline' }));
  app.post('/agent/bot/run',         (_req, res) => res.json({ ok: true, skipped: true, reason: 'offline', summary: 'IA offline', warnings: [], suggestions: [] }));
  app.post('/agent/console-autofix', (_req, res) => res.json({ ok: true, skipped: true, reason: 'offline' }));
  app.post('/agent/cursor-handoff',  (_req, res) => res.status(400).json({ error: 'IA offline' }));
  app.get('/agent/local-ai/status',  (_req, res) => res.json({ online: false, engine: 'offline', model: 'none' }));

  app.post('/agent/gemini/analyze-extrato-import', offlineAi);
  app.post('/agent/gemini/analyze-debug',          offlineAi);

  // ── Storage Stubs ────────────────────────────────────────────────────────
  const storageOfflineMsg = (_req, res) => res.json({ ok: true, message: 'Armazenamento em nuvem desativado.' });

  app.get('/agent/storage/status',                  (_req, res) => res.json({ ok: true, mode: 'nenhum' }));
  app.get('/agent/storage/folder-config',           (_req, res) => res.json({ ok: true, mode: 'nenhum' }));
  app.post('/agent/sync/save',                      storageOfflineMsg);
  app.get('/agent/sync/mode',                       (_req, res) => res.json({ ok: true, mode: 'nenhum' }));

  // ── Empresas catálogo / admin ────────────────────────────────────────────
  app.get('/agent/empresas-catalogo',   handleGetEmpresasCatalogo);
  app.post('/agent/empresas-catalogo',  handlePublishEmpresasCatalogo);
  app.post('/agent/staff-login',        handleStaffLogin);
  app.get('/agent/admin-bridge/tokens',         handleGetTokens);
  app.get('/agent/admin-bridge/office/:token',  handleGetOffice);
  app.get('/agent/admin-bridge/catalog',        handleGetCatalog);
}
