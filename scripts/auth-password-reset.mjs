/**
 * Recuperação de palavra-passe — token + e-mail (SMTP) para contas locais.
 * Contas Google: o frontend abre a recuperação oficial da Google (e-mail real da Google).
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
const STORE_PATH = path.join(REPO_ROOT, '.data', 'password-resets.json');
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

function buildEmailBodies(resetUrl) {
  const text =
    `Contábil Fácil — redefinição de palavra-passe\n\n` +
    `Abra este link no mesmo computador (válido por 1 hora):\n${resetUrl}\n\n` +
    `Se não pediu esta recuperação, ignore este e-mail.`;
  const html =
    `<p><strong>Contábil Fácil</strong> — redefinição de palavra-passe</p>` +
    `<p><a href="${resetUrl}">Clique aqui para definir uma nova palavra-passe</a></p>` +
    `<p style="font-size:12px;color:#666">Link válido por 1 hora. Se não pediu, ignore.</p>`;
  return { text, html };
}

/** POST { email, origin } → { ok, emailed, googleRecoveryUrl } */
export async function handlePasswordResetRequest(req, res) {
  try {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const origin = String(req.body?.origin || 'http://localhost:4173').replace(/\/$/, '');
    if (!email || !email.includes('@')) {
      res.status(400).json({ ok: false, error: 'Informe um e-mail válido.' });
      return;
    }

    const token = crypto.randomBytes(32).toString('hex');
    const store = await pruneExpired(await readStore());
    store[email] = {
      tokenHash: hashToken(token),
      exp: Date.now() + TTL_MS,
      createdAt: new Date().toISOString(),
    };
    await writeStore(store);

    const resetUrl = `${origin}/?pwd_reset=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
    const googleRecoveryUrl =
      'https://accounts.google.com/signin/recovery?Email=' + encodeURIComponent(email);

    let emailed = false;
    let sendError = '';
    try {
      const { text, html } = buildEmailBodies(resetUrl);
      await sendSmtpEmail({
        to: email,
        subject: 'Contábil Fácil — redefinir palavra-passe',
        text,
        html,
      });
      emailed = true;
    } catch (err) {
      sendError = err instanceof Error ? err.message : String(err);
    }

    // Sempre 200 — não revelar se a conta existe.
    res.json({
      ok: true,
      emailed,
      sendError: emailed ? '' : sendError,
      googleRecoveryUrl,
      resetUrl: emailed ? undefined : resetUrl,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** POST { email, token, newPassword } → { ok } */
export async function handlePasswordResetConfirm(req, res) {
  try {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const token = String(req.body?.token || '').trim();
    const newPassword = String(req.body?.newPassword || '');
    if (!email || !token || newPassword.length < 6) {
      res.status(400).json({
        ok: false,
        error: 'E-mail, token e nova palavra-passe (mín. 6) são obrigatórios.',
      });
      return;
    }

    const store = await pruneExpired(await readStore());
    const row = store[email];
    if (!row || row.tokenHash !== hashToken(token)) {
      res.status(400).json({ ok: false, error: 'Link inválido ou expirado. Peça nova recuperação.' });
      return;
    }

    delete store[email];
    await writeStore(store);

    // A palavra-passe local vive no browser; devolvemos ok para o frontend aplicar.
    res.json({ ok: true, email });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
