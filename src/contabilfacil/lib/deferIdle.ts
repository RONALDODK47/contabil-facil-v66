/** Executa tarefa não crítica após a primeira pintura da UI. */
export function deferIdle(task: () => void, fallbackMs = 800): void {
  if (typeof window === 'undefined') {
    task();
    return;
  }
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(() => task(), { timeout: fallbackMs });
    return;
  }
  setTimeout(task, Math.min(fallbackMs, 400));
}

/** Cede a main thread para o navegador pintar / processar input (evita freeze). */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve();
      return;
    }
    const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
    if (scheduler?.yield) {
      void scheduler.yield().then(resolve);
      return;
    }
    window.setTimeout(resolve, 0);
  });
}

/** Executa trabalho pesado em fatias, cedendo a thread entre lotes. */
export async function runInChunks<T>(
  items: T[],
  chunkSize: number,
  worker: (chunk: T[], offset: number) => void | Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += chunkSize) {
    await worker(items.slice(i, i + chunkSize), i);
    if (i + chunkSize < items.length) await yieldToMain();
  }
}
