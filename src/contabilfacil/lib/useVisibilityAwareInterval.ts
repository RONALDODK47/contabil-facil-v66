import { useEffect } from 'react';

/**
 * Executa callback em intervalo, pausando quando a aba do navegador está oculta.
 */
export function useVisibilityAwareInterval(
  callback: () => void,
  intervalMs: number,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;

    let id: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (id !== null) return;
      id = setInterval(callback, intervalMs);
    };

    const stop = () => {
      if (id === null) return;
      clearInterval(id);
      id = null;
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [callback, intervalMs, enabled]);
}
