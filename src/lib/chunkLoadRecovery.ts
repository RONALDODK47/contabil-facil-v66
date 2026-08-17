const CHUNK_RELOAD_KEY = 'contabilfacil:chunk-reload';

const CHUNK_LOAD_ERROR =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const parts: string[] = [];
  if (typeof error === 'string') {
    parts.push(error);
  } else if (error instanceof Error) {
    parts.push(error.message, error.stack ?? '');
  } else {
    try {
      parts.push(JSON.stringify(error));
    } catch {
      parts.push(String(error));
    }
  }
  return CHUNK_LOAD_ERROR.test(parts.join(' '));
}

/** Recarrega uma vez quando um chunk lazy ficou desatualizado após deploy (hash 404). */
export function installChunkLoadRecovery(): void {
  if (typeof window === 'undefined') return;

  const reloadOnce = (reason: string): void => {
    try {
      if (sessionStorage.getItem(CHUNK_RELOAD_KEY) === '1') return;
      sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
      console.warn(`[chunk-recovery] Recarregando após falha de import (${reason})…`);
      window.location.reload();
    } catch {
      window.location.reload();
    }
  };

  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    reloadOnce('vite:preloadError');
  });

  window.addEventListener('unhandledrejection', (event) => {
    if (!isChunkLoadError(event.reason)) return;
    event.preventDefault();
    reloadOnce('unhandledrejection');
  });
}
