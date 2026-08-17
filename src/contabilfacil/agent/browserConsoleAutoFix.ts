import type { BrowserConsoleEntry } from './browserConsoleBridge';
import { errorSignature, isConsoleAutoFixEnabled } from './browserConsoleBridge';
import { notifyAiInsight } from '../../lib/aiProactiveNotify';

const AGENT_BASE =
  typeof import.meta.env.VITE_AGENT_API_URL === 'string' && import.meta.env.VITE_AGENT_API_URL
    ? import.meta.env.VITE_AGENT_API_URL.replace(/\/$/, '')
    : '/api/agent';

const COOLDOWN_MS = 30_000;
const DEBOUNCE_MS = 600;

const sentSignatures = new Map<string, number>();
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingEntry: BrowserConsoleEntry | null = null;
let sessionHandoffs = 0;
const MAX_SESSION = 25;

export type AutoFixStatus = {
  lastSentAt: string | null;
  lastMessage: string | null;
  lastFile: string | null;
  busy: boolean;
  enabled: boolean;
};

let status: AutoFixStatus = {
  lastSentAt: null,
  lastMessage: null,
  lastFile: null,
  busy: false,
  enabled: true,
};

const statusListeners = new Set<(s: AutoFixStatus) => void>();

function emitStatus(patch: Partial<AutoFixStatus>): void {
  status = { ...status, ...patch, enabled: isConsoleAutoFixEnabled() };
  statusListeners.forEach((fn) => fn(status));
}

export function getAutoFixStatus(): AutoFixStatus {
  return { ...status, enabled: isConsoleAutoFixEnabled() };
}

export function subscribeAutoFixStatus(listener: (s: AutoFixStatus) => void): () => void {
  statusListeners.add(listener);
  listener(getAutoFixStatus());
  return () => statusListeners.delete(listener);
}

function isCritical(entry: BrowserConsoleEntry): boolean {
  return entry.kind === 'error' || entry.kind === 'unhandled' || entry.kind === 'react';
}

async function sendToCursorRealtime(entry: BrowserConsoleEntry): Promise<void> {
  const sig = `${entry.kind}:${entry.signature}`;
  const last = sentSignatures.get(sig) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) return;
  if (sessionHandoffs >= MAX_SESSION) return;
  if (!isConsoleAutoFixEnabled()) return;

  emitStatus({ busy: true, lastMessage: entry.message.slice(0, 120) });

  try {
    const res = await fetch(`${AGENT_BASE}/console-autofix`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: entry.kind,
        message: entry.message,
        signature: entry.signature,
        at: entry.at,
        url: window.location.href,
      }),
    });
    if (!res.ok) {
      emitStatus({
        busy: false,
        lastMessage: res.status === 404 ? 'API /api/agent offline — rode npm run dev' : `HTTP ${res.status}`,
      });
      return;
    }
    const data = (await res.json()) as {
      ok?: boolean;
      relativePath?: string;
      clipboardPrompt?: string;
      skipped?: boolean;
      reason?: string;
      geminiAnalysis?: string;
    };

    if (data.skipped) {
      emitStatus({ busy: false, lastMessage: data.reason ?? 'Ignorado (cooldown)' });
      return;
    }

    if (data.geminiAnalysis?.trim()) {
      notifyAiInsight({
        source: 'gemini-debug',
        message: `💡 Gemini: ${data.geminiAnalysis.trim().slice(0, 280)}`,
        severity: 'info',
        dedupeKey: `gemini-debug-${entry.signature.slice(0, 40)}`,
      });
    }

    if (data.clipboardPrompt) {
      try {
        await navigator.clipboard.writeText(data.clipboardPrompt);
      } catch {
        /* ignore */
      }
    }

    sentSignatures.set(sig, Date.now());
    sessionHandoffs += 1;
    emitStatus({
      busy: false,
      lastSentAt: new Date().toISOString(),
      lastFile: data.relativePath ?? null,
      lastMessage: entry.message.slice(0, 100),
    });
  } catch (err) {
    emitStatus({
      busy: false,
      lastMessage: err instanceof Error ? err.message : 'API :8780 offline',
    });
  }
}

function scheduleSend(entry: BrowserConsoleEntry): void {
  pendingEntry = entry;
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    const e = pendingEntry;
    pendingEntry = null;
    if (e) void sendToCursorRealtime(e);
  }, DEBOUNCE_MS);
}

/** Escuta novos erros e envia ao Cursor automaticamente (dev). */
export function startBrowserConsoleAutoFix(
  onNewEntry: (cb: (entry: BrowserConsoleEntry) => void) => () => void,
): () => void {
  emitStatus({ enabled: isConsoleAutoFixEnabled() });
  return onNewEntry((entry) => {
    if (!isCritical(entry)) return;
    scheduleSend(entry);
  });
}
