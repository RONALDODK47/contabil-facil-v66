/** Captura erros visíveis e ocultos do navegador — aba Debug (persistido, por módulo). */

import { registerNativeFetch } from '../../lib/nativeFetch';
import { generateUUID } from '../../lib/uuid';
import {
  formatDebugContextLabel,
  getDebugContext,
  type DebugContext,
  type DebugModuleId,
} from './debugContext';

export type ConsoleEntryKind =
  | 'error'
  | 'warn'
  | 'unhandled'
  | 'react'
  | 'network'
  | 'resource'
  | 'api'
  | 'silent';

export type ConsoleEntryVisibility = 'visible' | 'hidden';

export type BrowserConsoleEntry = {
  id: string;
  kind: ConsoleEntryKind;
  visibility: ConsoleEntryVisibility;
  message: string;
  at: string;
  signature: string;
  source?: string;
  stack?: string;
  url?: string;
  status?: number;
  module: DebugModuleId;
  moduleLabel: string;
  subTab?: string;
  subTabLabel?: string;
  company?: string;
  contextLabel: string;
  details?: string;
};

const IGNORE_PATTERNS = [
  /download the react devtools/i,
  /^\[vite\]\s/i,
  /react\.dev\/link\/react-devtools/i,
  /\[cursor-console\]/i,
  /\[contabilfacil-console\]/i,
  /flowmind-handoff/i,
  /IAs com problema \(verificação automática\)/i,
  /\bhmr\b/i,
  /AbortError/i,
  /signal is aborted/i,
  /@firebase\/firestore.*WebChannelConnection/i,
  /transport errored/i,
  /firestore\.googleapis\.com.*Firestore\/(Listen|Write)\/channel/i,
  /@firebase\/firestore.*resource-exhausted/i,
  /@firebase\/firestore.*Quota limit exceeded/i,
  /Quota exceeded for quota metric/i,
  /Free daily write units per project/i,
  /Free daily read units per project/i,
  /Could not ensure profile.*Quota limit exceeded/i,
  /Using maximum backoff delay to prevent overloading/i,
  /Play is not defined/i,
  /showMappingGuides is not defined/i,
  /valorModo is not defined/i,
  /WebSocket closed without opened/i,
  /vite.*websocket/i,
  /@vite\/client/i,
  /failed to connect to websocket/i,
  /WebSocket connection to/i,
  /websocket handshake/i,
  /\[vite\] failed to connect/i,
  /@firebase\/firestore/i,
  /FirebaseError.*firestore/i,
];

/** Falhas esperadas em sync em background — não poluem a aba Debug. */
const IGNORE_NETWORK_URL_PATTERNS = [
  /brasilapi\.com\.br\/api\/feriados/i,
  /\/api\/brasilapi\/api\/feriados/i,
  /firestore\.googleapis\.com/i,
  /127\.0\.0\.1:8780/i,
  /localhost:8780/i,
  /** Ping BCB: proxy ou API direta podem falhar offline — fallback embutido cobre PRONAMPE. */
  /\/api\/bcb\//i,
  /api\.bcb\.gov\.br/i,
  /** Lazy load Gestão — falha transitória de HMR; recarregar a página resolve. */
  /vendor\/gestao-contabil\/.*\/src\/pages\/.+\.jsx/i,
  /** Backend Render / health-checks — cold-start ou offline não poluem Debug. */
  /eye-vision-agent-api\.onrender\.com/i,
  /\/api\/agent\//i,
  /\/api\/fiscal-nfe\//i,
];

/** Respostas HTTP não-OK em health-checks opcionais (não poluem Debug). */
const IGNORE_API_URL_PATTERNS = [
  /\/api\/bcb\//i,
  /api\.bcb\.gov\.br/i,
  /\/workspace\/merge-office-suffixes/i,
  /\/workspace\/clone-office/i,
  /\/workspace\/office/i,
  /\/workspace\/health/i,
  /\/workspace\/firebase-cloud-access/i,
  /\/gemini\/health/i,
  /\/api\/fiscal-nfe\//i,
  /\/receita-federal\/health/i,
  /\/sefaz\/icms\/health/i,
  /\/sped\/health/i,
  /eye-vision-agent-api\.onrender\.com/i,
];

/** Login Firebase com credencial inválida — AuthContext já exibe mensagem na UI. */
const FIREBASE_SIGN_IN_PASSWORD_URL =
  /identitytoolkit\.googleapis\.com\/v1\/accounts:signInWithPassword/i;

function shouldIgnoreFailedFetch(url: string, status: number): boolean {
  if (IGNORE_API_URL_PATTERNS.some((p) => p.test(url))) return true;
  if (status === 400 && FIREBASE_SIGN_IN_PASSWORD_URL.test(url)) return true;
  return false;
}

const STORAGE_AUTOFIX = 'cursor_console_autofix_v1';
const STORAGE_LOG = 'eye_vision_debug_log_v1';
const MAX_ENTRIES = 300;
const PERSIST_DEBOUNCE_MS = 2000;
const DEDUPE_WINDOW_MS = 45_000;
const NETWORK_RATE_LIMIT_MS = 30_000;
const DEBUG_UI_RENDER_CAP = 120;
/** Sem nova ocorrência do mesmo erro neste intervalo → considerado resolvido e removido. */
const RESOLVE_QUIET_MS = 90_000;
const PRUNE_INTERVAL_MS = 45_000;
const NEW_ENTRY_GRACE_MS = 25_000;

/** Removidos assim que a app confirma estado saudável (auth ok, etc.). */
const HEALTH_CLEAR_PATTERNS = [
  /useAuth must be used within an AuthProvider/i,
  /Erro não tratado na árvore React.*useAuth/i,
  /The above error occurred in the <GestaoAuthGate>/i,
  /@firebase\/firestore.*WebChannelConnection/i,
  /transport errored/i,
  /Firestore\/(Listen|Write)\/channel/i,
  /HTTP 400 .*firestore\.googleapis\.com/i,
  /HTTP 404 .*firestore\.googleapis\.com/i,
  /resource-exhausted/i,
  /Quota limit exceeded/i,
  /Quota exceeded for quota metric/i,
  /Using maximum backoff delay/i,
  /Play is not defined.*DocumentColunasModal/i,
  /showMappingGuides is not defined.*DocumentColunasModal/i,
  /valorModo is not defined.*DocumentColunasModal/i,
  /contaModo is not defined.*DocumentColunasModal/i,
  /api\.bcb\.gov\.br/i,
  /\/api\/bcb\//i,
  /bcdata\.sgs/i,
  /identitytoolkit\.googleapis\.com\/v1\/accounts:signInWithPassword/i,
  /WebSocket closed without opened/i,
  /@vite\/client/i,
];

const HIDDEN_KINDS = new Set<ConsoleEntryKind>(['network', 'resource', 'api', 'silent']);

let entries: BrowserConsoleEntry[] = [];
const listeners = new Set<() => void>();
const newEntryListeners = new Set<(entry: BrowserConsoleEntry) => void>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let notifyRaf: number | null = null;
const recentBySignature = new Map<string, number>();
const networkRateLimit = new Map<string, number>();
const signatureLastSeen = new Map<string, number>();
let pruneTimer: number | ReturnType<typeof setInterval> | null = null;

export const DEBUG_TABLE_RENDER_CAP = DEBUG_UI_RENDER_CAP;

export function errorSignature(message: string): string {
  return message.replace(/\d+/g, '#').slice(0, 240);
}

function shouldIgnore(text: string, stack?: string): boolean {
  if (IGNORE_PATTERNS.some((p) => p.test(text))) return true;
  const haystack = `${text}\n${stack ?? ''}`;
  if (/@vite\/client/i.test(haystack) && /websocket/i.test(haystack)) return true;
  return false;
}

function defaultVisibility(kind: ConsoleEntryKind): ConsoleEntryVisibility {
  return HIDDEN_KINDS.has(kind) ? 'hidden' : 'visible';
}

function isBrowserConsoleEntry(value: unknown): value is BrowserConsoleEntry {
  if (!value || typeof value !== 'object') return false;
  const row = value as BrowserConsoleEntry;
  return typeof row.id === 'string' && typeof row.message === 'string' && typeof row.at === 'string';
}

function normalizePersistedEntry(row: BrowserConsoleEntry): BrowserConsoleEntry {
  const module = row.module ?? 'system';
  const moduleLabel = row.moduleLabel ?? 'Sistema';
  const subTabLabel = row.subTabLabel;
  return {
    ...row,
    module,
    moduleLabel,
    contextLabel:
      row.contextLabel ??
      (subTabLabel ? `${moduleLabel} · ${subTabLabel}` : moduleLabel),
  };
}

function loadPersistedEntries(): BrowserConsoleEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_LOG);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isBrowserConsoleEntry)
      .map(normalizePersistedEntry)
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

function schedulePersist(): void {
  try {
    if (typeof localStorage === 'undefined') return;
  } catch {
    return;
  }
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const run = () => {
      try {
        // ⚠️ DISABLED: Salva SOMENTE no Docker (console logging non-critical)
        // localStorage.setItem(STORAGE_LOG, JSON.stringify(entries));
      } catch {
        entries = entries.slice(0, Math.floor(MAX_ENTRIES / 2));
        try {
          // ⚠️ DISABLED: Salva SOMENTE no Docker (console logging non-critical)
          // localStorage.setItem(STORAGE_LOG, JSON.stringify(entries));
        } catch {
          /* quota cheia */
        }
      }
    };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 4000 });
    } else {
      run();
    }
  }, PERSIST_DEBOUNCE_MS);
}

function touchSignature(signature: string, atMs = Date.now()): void {
  signatureLastSeen.set(signature, atMs);
}

function entryMatchesHealthClear(entry: BrowserConsoleEntry): boolean {
  const haystack = `${entry.message} ${entry.stack ?? ''} ${entry.url ?? ''}`;
  return HEALTH_CLEAR_PATTERNS.some((p) => p.test(haystack));
}

/** Remove erros que pararam de ocorrer ou foram sanados (auth, firestore transitório). */
export function pruneResolvedDebugEntries(): number {
  const now = Date.now();
  const before = entries.length;

  entries = entries.filter((entry) => {
    if (entryMatchesHealthClear(entry)) return false;

    const lastSeen = signatureLastSeen.get(entry.signature) ?? new Date(entry.at).getTime();
    const entryAge = now - new Date(entry.at).getTime();
    if (entryAge < NEW_ENTRY_GRACE_MS) return true;

    return now - lastSeen < RESOLVE_QUIET_MS;
  });

  if (entries.length !== before) {
    schedulePersist();
    notifyListeners();
  }
  return before - entries.length;
}

/** App operacional — limpa erros já corrigidos (ex.: auth após login, firestore após reconexão). */
export function notifyDebugAppHealthy(): void {
  const before = entries.length;
  entries = entries.filter((entry) => !entryMatchesHealthClear(entry));
  pruneResolvedDebugEntries();
  if (entries.length !== before) {
    schedulePersist();
    notifyListeners();
  }
}

const IMPORT_LOAD_ERROR = /Failed to fetch dynamically imported module/i;
/** HMR deixou referência a ícone removido — limpar ao recarregar módulo. */
const STALE_HMR_REFERENCE_ERROR =
  /(?:Play|showMappingGuides|valorModo|contaModo) is not defined/i;

/** Módulo lazy carregou — remove falhas transitórias de import (HMR / reload). */
export function notifyDebugModuleLoaded(): void {
  const before = entries.length;
  entries = entries.filter((entry) => {
    const haystack = `${entry.message} ${entry.stack ?? ''} ${entry.details ?? ''}`;
    return (
      !IMPORT_LOAD_ERROR.test(haystack) && !STALE_HMR_REFERENCE_ERROR.test(haystack)
    );
  });
  if (entries.length !== before) {
    schedulePersist();
    notifyListeners();
  }
}

function startResolvedPruneLoop(): void {
  if (pruneTimer || typeof window === 'undefined') return;
  pruneTimer = window.setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    pruneResolvedDebugEntries();
  }, PRUNE_INTERVAL_MS);
}

function stopResolvedPruneLoop(): void {
  if (pruneTimer) {
    clearInterval(pruneTimer);
    pruneTimer = null;
  }
}

function shouldSkipDuplicate(signature: string, kind: ConsoleEntryKind): boolean {
  const key = `${kind}:${signature}`;
  const now = Date.now();
  const lastAt = recentBySignature.get(key);
  if (lastAt != null && now - lastAt < DEDUPE_WINDOW_MS) return true;
  if (HIDDEN_KINDS.has(kind)) {
    const found = entries.some((e) => e.kind === kind && e.signature === signature);
    if (found) return true;
  }
  recentBySignature.set(key, now);
  return false;
}

function shouldRateLimitNetwork(url: string | undefined, status: number | undefined): boolean {
  if (!url) return false;
  const key = `${status ?? 0}:${url}`;
  const now = Date.now();
  const lastAt = networkRateLimit.get(key);
  if (lastAt != null && now - lastAt < NETWORK_RATE_LIMIT_MS) return true;
  networkRateLimit.set(key, now);
  return false;
}

function notifyListeners(): void {
  if (notifyRaf != null) return;
  const run = () => {
    notifyRaf = null;
    listeners.forEach((fn) => fn());
  };
  if (typeof requestAnimationFrame === 'function') {
    notifyRaf = requestAnimationFrame(run);
  } else {
    setTimeout(run, 0);
  }
}

function serializeDetails(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (value instanceof Error) {
    return JSON.stringify(
      { name: value.name, message: value.message, stack: value.stack },
      null,
      0,
    ).slice(0, 6000);
  }
  try {
    return JSON.stringify(value, null, 0).slice(0, 6000);
  } catch {
    return String(value).slice(0, 6000);
  }
}

function formatParts(parts: unknown[]): { message: string; stack?: string; details?: string } {
  const chunks: string[] = [];
  let stack: string | undefined;
  let details: string | undefined;

  for (const p of parts) {
    if (p instanceof Error) {
      chunks.push(p.message);
      stack = p.stack ?? stack;
      details = serializeDetails(p);
    } else if (typeof p === 'string') {
      chunks.push(p);
    } else {
      try {
        chunks.push(JSON.stringify(p));
      } catch {
        chunks.push(String(p));
      }
      if (!details) details = serializeDetails(p);
    }
  }

  return { message: chunks.join(' ').slice(0, 4000), stack, details };
}

function contextFields(ctx: DebugContext): Pick<
  BrowserConsoleEntry,
  'module' | 'moduleLabel' | 'subTab' | 'subTabLabel' | 'company' | 'contextLabel'
> {
  return {
    module: ctx.module,
    moduleLabel: ctx.moduleLabel,
    subTab: ctx.subTab,
    subTabLabel: ctx.subTabLabel,
    company: ctx.company,
    contextLabel: formatDebugContextLabel(ctx),
  };
}

function push(
  kind: ConsoleEntryKind,
  parts: unknown[],
  opts?: {
    visibility?: ConsoleEntryVisibility;
    source?: string;
    stack?: string;
    url?: string;
    status?: number;
    details?: string;
    context?: Partial<DebugContext>;
  },
): BrowserConsoleEntry | null {
  const { message, stack: stackFromParts, details: detailsFromParts } = formatParts(parts);
  if (!message.trim() || shouldIgnore(message, opts?.stack ?? stackFromParts)) return null;

  const ctx = { ...getDebugContext(), ...opts?.context };
  const signature = errorSignature(`${kind}:${opts?.source ?? ''}:${ctx.module}:${message}`);

  touchSignature(signature);

  if (shouldSkipDuplicate(signature, kind)) return null;
  if (HIDDEN_KINDS.has(kind) && shouldRateLimitNetwork(opts?.url, opts?.status)) return null;

  const entry: BrowserConsoleEntry = {
    id: generateUUID(),
    kind,
    visibility: opts?.visibility ?? defaultVisibility(kind),
    message,
    signature,
    at: new Date().toISOString(),
    source: opts?.source,
    stack: opts?.stack ?? stackFromParts,
    url: opts?.url,
    status: opts?.status,
    details: opts?.details ?? detailsFromParts,
    ...contextFields(ctx),
  };

  entries = [entry, ...entries].slice(0, MAX_ENTRIES);
  schedulePersist();
  notifyListeners();
  newEntryListeners.forEach((fn) => fn(entry));
  return entry;
}

/** Falha de app com detalhes — visível na aba Debug, persistido. */
export function reportAppFailure(
  message: string,
  opts?: {
    source?: string;
    cause?: unknown;
    stack?: string;
    kind?: ConsoleEntryKind;
    context?: Partial<DebugContext>;
  },
): BrowserConsoleEntry | null {
  const text = message.trim();
  if (!text) return null;
  const cause = opts?.cause;
  return push(opts?.kind ?? 'error', [text, cause].filter(Boolean), {
    visibility: 'visible',
    source: opts?.source ?? 'app',
    stack:
      opts?.stack ??
      (cause instanceof Error ? cause.stack : undefined),
    details: serializeDetails(cause),
    context: opts?.context,
  });
}

/** Avisos da IA (empréstimo, natureza, conciliação, OCR) → aba Debug. */
export function reportIaMonitor(
  message: string,
  source: 'ocr' | 'emprestimo' | 'natureza' | 'conciliacao',
  severity: 'warn' | 'error' = 'warn',
): BrowserConsoleEntry | null {
  const text = message.trim();
  if (!text) return null;
  return push(severity === 'error' ? 'error' : 'warn', [`[IA · ${source}] ${text}`], {
    visibility: 'visible',
    source: `ia-${source}`,
  });
}

/** Erros capturados em try/catch que não aparecem no console. */
export function reportSilentError(
  message: string,
  opts?: { source?: string; stack?: string; cause?: unknown; visible?: boolean },
): void {
  const parts = [message, opts?.cause].filter(Boolean);
  push('silent', parts, {
    visibility: opts?.visible ? 'visible' : 'hidden',
    source: opts?.source ?? 'silent',
    stack: opts?.stack ?? (opts?.cause instanceof Error ? opts.cause.stack : undefined),
    details: serializeDetails(opts?.cause),
  });
}

/** Registra erro React (Error Boundary) no mesmo pipeline. */
export function reportBrowserConsoleError(
  kind: BrowserConsoleEntry['kind'],
  error: unknown,
  extra?: string,
): void {
  const parts = [error, extra].filter(Boolean);
  push(kind, parts, {
    visibility: kind === 'react' ? 'visible' : undefined,
    stack: error instanceof Error ? error.stack : undefined,
    details: extra,
  });
}

export function getBrowserConsoleEntries(): BrowserConsoleEntry[] {
  return [...entries];
}

export function getBrowserConsoleIssueCount(): number {
  return entries.filter((e) => e.kind !== 'warn').length;
}

export function clearBrowserConsoleEntries(): void {
  entries = [];
  recentBySignature.clear();
  networkRateLimit.clear();
  signatureLastSeen.clear();
  try {
    localStorage.removeItem(STORAGE_LOG);
  } catch {
    /* ignore */
  }
  notifyListeners();
}

export function subscribeBrowserConsole(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function subscribeBrowserConsoleNewEntry(
  listener: (entry: BrowserConsoleEntry) => void,
): () => void {
  newEntryListeners.add(listener);
  return () => newEntryListeners.delete(listener);
}

export function isConsoleAutoFixEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_AUTOFIX) === '1';
  } catch {
    return false;
  }
}

export function setConsoleAutoFixEnabled(enabled: boolean): void {
  try {
    // ⚠️ DISABLED: Salva SOMENTE no Docker (console logging non-critical)
    // localStorage.setItem(STORAGE_AUTOFIX, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function formatEntriesAsTable(rows: BrowserConsoleEntry[]): string {
  const header = [
    '#',
    'Horário',
    'Aba',
    'Tipo',
    'Visibilidade',
    'Origem',
    'Mensagem',
    'URL',
    'Status',
  ].join('\t');
  const body = rows.map((e, i) =>
    [
      String(i + 1),
      e.at,
      e.contextLabel,
      e.kind,
      e.visibility,
      e.source ?? '',
      e.message.replace(/\s+/g, ' ').slice(0, 500),
      e.url ?? '',
      e.status != null ? String(e.status) : '',
    ].join('\t'),
  );
  return [header, ...body].join('\n');
}

export function formatEntriesAsMarkdown(rows: BrowserConsoleEntry[]): string {
  const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const lines = [
    '| # | Horário | Aba | Tipo | Vis. | Origem | Mensagem |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((e, i) =>
      `| ${i + 1} | ${esc(e.at)} | ${esc(e.contextLabel)} | ${e.kind} | ${e.visibility} | ${esc(e.source ?? '')} | ${esc(e.message.slice(0, 300))} |`,
    ),
  ];
  return lines.join('\n');
}

let installed = false;

function patchFetch(): void {
  if (typeof window.fetch !== 'function') return;
  const orig = window.fetch.bind(window);
  registerNativeFetch(orig);
  try {
    Object.defineProperty(window, 'fetch', {
      value: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : (input as Request).url;
        try {
          const res = await orig(input, init);
          if (!res.ok && !shouldIgnoreFailedFetch(url, res.status)) {
            push('api', [`HTTP ${res.status} ${res.statusText}`, url], {
              visibility: 'hidden',
              source: 'fetch',
              url,
              status: res.status,
            });
          }
          return res;
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            throw err;
          }
          const ignoreUrl = IGNORE_NETWORK_URL_PATTERNS.some((p) => p.test(url));
          if (!ignoreUrl) {
            push('network', [`Falha de rede`, url, err], {
              visibility: 'hidden',
              source: 'fetch',
              url,
            });
          }
          throw err;
        }
      },
      configurable: true,
      writable: true,
    });
  } catch (e) {
    console.warn('[browserConsoleBridge] Failed to patch window.fetch:', e);
  }
}

function onGlobalError(ev: ErrorEvent): void {
  const t = ev.target;
  if (t && t !== window && t !== document && t instanceof HTMLElement) {
    const tag = t.tagName?.toLowerCase() ?? 'resource';
    const src =
      (t as HTMLScriptElement).src ||
      (t as HTMLLinkElement).href ||
      (t as HTMLImageElement).src ||
      '';
    if (src && IGNORE_NETWORK_URL_PATTERNS.some((p) => p.test(src))) return;
    push('resource', [`Falha ao carregar ${tag}`, src || ev.message], {
      visibility: 'hidden',
      source: tag,
      url: src || ev.filename,
    });
    return;
  }

  push('unhandled', [ev.message, ev.filename, ev.lineno, ev.colno, ev.error], {
    stack: ev.error instanceof Error ? ev.error.stack : undefined,
    url: ev.filename,
  });
}

/** Instala interceptadores. Chamar o mais cedo possível (main.tsx). */
export function installBrowserConsoleBridge(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const hydrate = () => {
    entries = loadPersistedEntries();
    for (const entry of entries) {
      touchSignature(entry.signature, new Date(entry.at).getTime());
    }
    pruneResolvedDebugEntries();
    notifyListeners();
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(hydrate, { timeout: 3000 });
  } else {
    setTimeout(hydrate, 0);
  }

  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);

  console.error = (...args: unknown[]) => {
    const { message, stack } = formatParts(args);
    if (shouldIgnore(message, stack)) return;
    push('error', args);
    origError(...args);
  };

  console.warn = (...args: unknown[]) => {
    const { message, stack } = formatParts(args);
    if (shouldIgnore(message, stack)) return;
    push('warn', args);
    origWarn(...args);
  };

  window.addEventListener('error', onGlobalError, true);
  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason;
    const message =
      reason instanceof Error ? reason.message : String(reason ?? '');
    const stack = reason instanceof Error ? reason.stack : undefined;
    if (shouldIgnore(message, stack)) return;
    push('unhandled', [ev.reason], {
      stack,
      source: 'promise',
    });
  });

  window.addEventListener('securitypolicyviolation', (ev) => {
    push('silent', [`CSP: ${ev.violatedDirective}`, ev.blockedURI], {
      visibility: 'hidden',
      source: 'csp',
      url: ev.blockedURI,
    });
  });

  patchFetch();
  startResolvedPruneLoop();
  window.addEventListener('beforeunload', stopResolvedPruneLoop);
}
