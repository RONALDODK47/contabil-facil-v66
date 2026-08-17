/**
 * Catálogo de empresas/tokens — espelho local no agent-api.
 *
 * Serve para sincronizar entre origens diferentes NA MESMA MÁQUINA (ex.:
 * `npm run dev` em :3000 e `npm run preview` em :4173 rodando ao mesmo
 * tempo) — cada uma tem seu próprio localStorage, mas o agent-api (:8790) é
 * o mesmo processo para as duas, então serve de ponte.
 *
 * Não substitui o Setup Controle (admin-server.js, portas 4900/4901) — é
 * só mais um canal em paralelo, útil quando esse app não está a correr.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = process.env.CONTABIL_DESKTOP_ROOT
  ? path.resolve(process.env.CONTABIL_DESKTOP_ROOT)
  : path.resolve(SCRIPT_DIR, '..');
const STORE_PATH = path.join(REPO_ROOT, '.data', 'empresas-catalogo.json');

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function tokenListFrom(value) {
  if (!Array.isArray(value)) return [];
  return value.map((x) => String(x || '').trim()).filter(Boolean);
}

async function readStore() {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeStore(store) {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

function mergeCatalogo(current, incoming) {
  const offices = { ...asRecord(current.eye_vision_offices), ...asRecord(incoming.eye_vision_offices) };

  const tokens = new Set([
    ...tokenListFrom(current.company_access_tokens),
    ...tokenListFrom(incoming.company_access_tokens),
  ]);
  for (const row of Object.values(offices)) {
    const rec = asRecord(row);
    const access = String(rec.access_token || '').trim();
    const sk = String(rec.storage_key || '').trim();
    if (access) tokens.add(access);
    if (sk) tokens.add(sk);
  }

  const clients = { ...asRecord(current.clients) };
  for (const [email, row] of Object.entries(asRecord(incoming.clients))) {
    const key = String(email || '').trim().toLowerCase();
    if (!key) continue;
    clients[key] = { ...asRecord(clients[key]), ...asRecord(row), email: key };
  }

  return {
    updated_at: new Date().toISOString(),
    company_access_tokens: Array.from(tokens),
    eye_vision_offices: offices,
    clients,
  };
}

async function enrichStoreWithPostgres(store) {
  const offices = { ...asRecord(store.eye_vision_offices) };
  const tokens = new Set(tokenListFrom(store.company_access_tokens));

  // Adiciona tokens padrão conhecidos
  for (const defaultToken of ['INOV', 'CL-FN14-AZ4ZV81Y', 'CL-FM16-A24ZV81V', 'CL-FN1A-AZ4ZV31Y', 'CL-FN16-A24ZV81V']) {
    tokens.add(defaultToken);
    if (!offices[defaultToken]) {
      offices[defaultToken] = {
        name: defaultToken === 'INOV' ? 'Escritório INOV' : defaultToken,
        storage_key: defaultToken,
        access_token: defaultToken,
      };
    }
  }

  try {
    const { isPostgresStorageEnabled, pgQuery } = await import('./storage/pg-client.mjs');
    if (isPostgresStorageEnabled()) {
      const res = await pgQuery('SELECT office_token, name FROM offices');
      for (const row of res.rows || []) {
        const tok = String(row.office_token || '').trim();
        if (!tok) continue;
        tokens.add(tok);
        if (!offices[tok]) {
          offices[tok] = {
            name: String(row.name || tok).trim(),
            storage_key: tok,
            access_token: tok,
          };
        }
      }
    }
  } catch {
    /* ignore PG errors */
  }

  return {
    ...store,
    company_access_tokens: Array.from(tokens),
    eye_vision_offices: offices,
  };
}

/** GET /agent/empresas-catalogo */
export async function handleGetEmpresasCatalogo(req, res) {
  try {
    let store = await readStore();
    store = await enrichStoreWithPostgres(store);
    res.json({ ok: true, ...store });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

/** POST /agent/empresas-catalogo — body = catálogo do admin → funde e persiste */
export async function handlePublishEmpresasCatalogo(req, res) {
  try {
    const current = await readStore();
    const next = mergeCatalogo(current, asRecord(req.body));
    await writeStore(next);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

/** POST /agent/staff-login — body { email, displayName, accessToken } */
export async function handleStaffLogin(req, res) {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const displayName = String(req.body?.displayName || '').trim();
    const accessToken = String(req.body?.accessToken || '').trim();
    if (!email) {
      res.status(400).json({ ok: false, error: 'E-mail obrigatório.' });
      return;
    }
    const current = await readStore();
    const clients = { ...asRecord(current.clients) };
    clients[email] = {
      ...asRecord(clients[email]),
      email,
      display_name: displayName || asRecord(clients[email]).display_name || email.split('@')[0],
      assigned_company_token: accessToken || asRecord(clients[email]).assigned_company_token || '',
      account_type: 'user',
      last_login_at: new Date().toISOString(),
    };
    await writeStore({ ...current, clients, updated_at: new Date().toISOString() });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
