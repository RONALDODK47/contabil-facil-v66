import { flushManagerDataWrites } from './companyWorkspace';
import {
  flushEyeVisionOperationalSave,
  scheduleEyeVisionOperationalSave,
} from './eyeVisionOperationalSave';
import { flushPendingIndexedDbWrites } from '../../lib/safeLocalStorage';

/** Força gravação de todas as pendências em memória → localStorage. */
export async function flushAllEyeVisionPersistence(): Promise<void> {
  await flushEyeVisionOperationalSave({ force: true, light: true });
}

/**
 * Após salvar/importar — grava memória imediatamente sem esperar o debounce.
 */
export async function flushPersistenceAfterCriticalWrite(): Promise<void> {
  flushManagerDataWrites();
  try {
    await flushEyeVisionOperationalSave({ force: true, light: true });
  } catch {
    scheduleEyeVisionOperationalSave();
  }
}

const PERIODIC_FLUSH_MS = 180_000;

/**
 * Garante que digitações/exclusões não se perdem ao trocar aba, dar F5 ou
 * fechar o browser. Dados operacionais vivem só em memória (ver
 * safeLocalStorage.ts) — se o fetch de sync não sair ANTES da página
 * descarregar, a edição é perdida para sempre. requestIdleCallback não serve
 * aqui: pode nunca disparar a tempo de um F5. Por isso o flush de rede
 * (que usa fetch keepalive) é chamado de forma síncrona e imediata.
 */
export function registerEyeVisionAutoSaveLifecycle(): () => void {
  const onBeforeUnload = () => {
    flushManagerDataWrites();
    flushPendingIndexedDbWrites();
    void flushEyeVisionOperationalSave({ force: true, light: true });
  };

  const onPageHide = () => {
    flushManagerDataWrites();
    flushPendingIndexedDbWrites();
    void flushEyeVisionOperationalSave({ force: true, light: true });
  };

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      flushManagerDataWrites();
      flushPendingIndexedDbWrites();
      void flushEyeVisionOperationalSave({ force: true, light: true });
    }
  };

  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('visibilitychange', onVisibility);

  const interval = window.setInterval(() => {
    if (document.visibilityState === 'visible') scheduleEyeVisionOperationalSave();
  }, PERIODIC_FLUSH_MS);

  return () => {
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('pagehide', onPageHide);
    document.removeEventListener('visibilitychange', onVisibility);
    window.clearInterval(interval);
  };
}
