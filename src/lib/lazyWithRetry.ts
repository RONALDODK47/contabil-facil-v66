import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { isChunkLoadError } from './chunkLoadRecovery';

type ModuleDefault<T> = { default: T };

/** Lazy import com reload automático quando o chunk hash mudou após deploy. */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<ModuleDefault<T>>,
): LazyExoticComponent<T> {
  return lazy(() =>
    factory().catch((error: unknown) => {
      if (typeof window !== 'undefined' && isChunkLoadError(error)) {
        window.location.reload();
        return new Promise<ModuleDefault<T>>(() => {});
      }
      throw error;
    }),
  );
}
