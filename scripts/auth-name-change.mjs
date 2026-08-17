/**
 * Alteração de nome de utilizador — confirmada por e-mail (SMTP).
 * Evita que qualquer pessoa com acesso à sessão troque o nome sem confirmar
 * pelo e-mail real da conta Google.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendSmtpEmail } from './smtp-mailer.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = process.env.CONTABIL_DESKTOP_ROOT
  ? path.resolve(process.env.CONTABIL_DESKTOP_ROOT)
  : path.resolve(SCRIPT_DIR, '..');
const STORE_PATH = path.join(REPO_ROOT, '.data', 'name-change-requests.json');
const TTL_MS = 60 * 60 * 1000;

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
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

async function pruneExpired(store) {
  const now = Date.now();
  let changed = false;
  for (const [email, row] of Object.entries(store)) {
    if (!row || !row.exp || row.exp < now) {
      delete store[email];
      changed = true;
    }
  }
  if (changed) await writeStore(store);
  return store;
}

function buildEmailBodies(confirmUrl, newName) {
  const text =
    `Contábil Fácil — confirmação de novo nome\n\n` +
    `Pediram para alterar o nome de utilizador desta conta para: ${newName}\n\n` +
    `Se foi você, abra este link para confirmar (válido por 1 hora):\n${confirmUrl}\n\n` +
    `Se não pediu esta alteração, ignore este e-mail — o nome não será alterado.`;
  const html =
    `<p><strong>Contábil Fácil</strong> — confirmação de novo nome</p>` +
    `<p>Pediram para alterar o nome de utilizador desta conta para: <strong>${newName}</strong></p>` +
    `<p><a href="${confirmUrl}">Clique aqui para confirmar a alteração</a></p>` +
    `<p style="font-size:12px;color:#666">Link válido por 1 hora. Se não pediu, ignore.</p>`;
  return { text, html };
}

/** POST { email, newName, origin } → { ok, emailed, sendError } */
export async function handleNameChangeRequest(req, res) {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const newName = String(req.body?.newName || '').trim();
    const origin = String(req.body?.origin || 'http://localhost:4173').replace(/\/$/, '');
    if (!email || !email.includes('@')) {
      res.status(400).json({ ok: false, error: 'Informe um e-mail válido.' });
      return;
    }
    if (!newName) {
      res.status(400).json({ ok: false, error: 'Informe o novo nome.' });
      return;
    }

    const token = crypto.randomBytes(32).toString('hex');
    const store = await pruneExpired(await readStore());
    store[email] = {
      tokenHash: hashToken(token),
      newName,
      exp: Date.now() + TTL_MS,
      createdAt: new Date().toISOString(),
    };
    await writeStore(store);

    const confirmUrl = `${origin}/?name_change=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

    let emailed = false;
    let sendError = '';
    try {
      const { text, html } = buildEmailBodies(confirmUrl, newName);
      await sendSmtpEmail({
        to: email,
        subject: 'Contábil Fácil — confirmar novo nome de utilizador',
        text,
        html,
      });
      emailed = true;
    } catch (err) {
      sendError = err instanceof Error ? err.message : String(err);
    }

    res.json({
      ok: true,
      emailed,
      sendError: emailed ? '' : sendError,
      confirmUrl: emailed ? undefined : confirmUrl,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

/** POST { email, token } → { ok, newName } */
export async function handleNameChangeConfirm(req, res) {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const token = String(req.body?.token || '').trim();
    if (!email || !token) {
      res.status(400).json({ ok: false, error: 'E-mail e token são obrigatórios.' });
      return;
    }

    const store = await pruneExpired(await readStore());
    const row = store[email];
    if (!row || row.tokenHash !== hashToken(token)) {
      res.status(400).json({ ok: false, error: 'Link inválido ou expirado. Peça nova alteração.' });
      return;
    }

    const newName = String(row.newName || '').trim();
    delete store[email];
    await writeStore(store);

    res.json({ ok: true, email, newName });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
