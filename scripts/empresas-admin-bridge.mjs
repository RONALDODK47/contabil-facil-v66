/**
 * Bridge para ler tokens/empresas do SETUP CONTROLE
 * 
 * O SETUP SOFTWARE em Desktop já tem o empresas-catalogo.json com todos os tokens
 * Este módulo lê esse arquivo e expõe via API
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';

const ADMIN_CATALOG_PATH = path.join(
  homedir(),
  'Desktop',
  'SETUP SOFTWARE',
  'SETUP CONTROLE (NAO COMPARTILHAR)',
  'empresas-catalogo.json'
);

/**
 * Lê catálogo de empresas do SETUP CONTROLE
 */
export async function readAdminCatalog() {
  try {
    const raw = await fs.readFile(ADMIN_CATALOG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[admin-bridge] Catálogo não encontrado:', ADMIN_CATALOG_PATH);
    return null;
  }
}

/**
 * Lista todos os tokens disponíveis
 */
export async function listAllTokens() {
  const catalog = await readAdminCatalog();
  if (!catalog) return [];
  
  return catalog.company_access_tokens || [];
}

/**
 * Busca escritório por token
 */
export async function getOfficeByToken(token) {
  const catalog = await readAdminCatalog();
  if (!catalog) return null;
  
  const offices = catalog.eye_vision_offices || {};
  return offices[token] || null;
}

/**
 * Lista clientes/usuários com acesso
 */
export async function listClients() {
  const catalog = await readAdminCatalog();
  if (!catalog) return {};
  
  return catalog.clients || {};
}

/**
 * Handler para GET /agent/admin-bridge/tokens
 */
export async function handleGetTokens(_req, res) {
  try {
    const tokens = await listAllTokens();
    res.json({ ok: true, tokens });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Erro ao carregar tokens',
    });
  }
}

/**
 * Handler para GET /agent/admin-bridge/office/:token
 */
export async function handleGetOffice(req, res) {
  try {
    const { token } = req.params;
    if (!token) {
      res.status(400).json({ ok: false, error: 'Token é obrigatório' });
      return;
    }

    const office = await getOfficeByToken(token);
    if (!office) {
      res.status(404).json({ ok: false, error: `Token não encontrado: ${token}` });
      return;
    }

    res.json({ ok: true, office });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Erro ao carregar office',
    });
  }
}

/**
 * Handler para GET /agent/admin-bridge/catalog
 * Retorna catálogo completo (admin only)
 */
export async function handleGetCatalog(_req, res) {
  try {
    const catalog = await readAdminCatalog();
    if (!catalog) {
      res.status(404).json({
        ok: false,
        error: 'Catálogo não encontrado no SETUP CONTROLE',
        path: ADMIN_CATALOG_PATH,
      });
      return;
    }

    res.json({ ok: true, catalog });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Erro ao carregar catálogo',
    });
  }
}
