/**
 * Luz verde + SALVANDO / SINCRONIZADO ao lado do título do módulo.
 * Sincroniza com armazenamento interno automaticamente.
 */
import { useEffect, useState } from 'react';
import {
  getOperationalSaveError,
  getOperationalSavePhase,
  subscribeOperationalSave,
  type OperationalSavePhase,
} from '../../lib/operationalSaveStatus';

const SAVED_VISIBLE_MS = 2500;

function resolveStatusLabels(
  phase: OperationalSavePhase,
): { primary: string; secondary: string | null } {
  switch (phase) {
    case 'syncing':
      return { primary: 'Carregando', secondary: 'Sincronizando dados' };
    case 'scheduled':
    case 'saving':
      return { primary: 'Salvando', secondary: 'Sincronizando dados' };
    case 'saved':
      return { primary: 'Salvo', secondary: 'Sincronizado' };
    case 'offline':
      return { primary: 'Aguardando', secondary: 'Sistema offline' };
    case 'error':
      return { primary: 'Erro ao salvar', secondary: null };
    default:
      return { primary: '', secondary: null };
  }
}

export default function PersistenceStatusBar() {
  const [phase, setPhase] = useState<OperationalSavePhase>(() => getOperationalSavePhase());
  const [error, setError] = useState<string | null>(() => getOperationalSaveError());
  const [hideSaved, setHideSaved] = useState(true);
  const { primary, secondary } = resolveStatusLabels(phase);

  useEffect(() => {
    let isMounted = true;
    const unsubscribe = subscribeOperationalSave(() => {
      const next = getOperationalSavePhase();
      const nextError = getOperationalSaveError();
      Promise.resolve().then(() => {
        if (!isMounted) return;
        setPhase(next);
        setError(nextError);
        if (next === 'scheduled' || next === 'saving' || next === 'syncing' || next === 'error') {
          setHideSaved(false);
        }
      });
    });
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (phase !== 'saved') return;
    setHideSaved(false);
    const t = window.setTimeout(() => setHideSaved(true), SAVED_VISIBLE_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  const active = phase === 'scheduled' || phase === 'saving' || phase === 'syncing';
  const isOffline = phase === 'offline';

  if (phase === 'idle') return null;
  if (phase === 'saved' && hideSaved) return null;

  const ariaLabel = secondary ? `${primary}. ${secondary}` : primary;

  return (
    <div
      className="flex items-center gap-2 w-full max-w-full"
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
      title={phase === 'error' ? error || 'Erro ao gravar' : ariaLabel}
    >
      <span
        className={`w-2.5 h-2.5 rounded-full shrink-0 ${
          phase === 'error'
            ? 'bg-red-600'
            : isOffline
              ? 'bg-amber-500 animate-pulse'
              : active
                ? 'bg-green-500 animate-pulse'
                : 'bg-green-600'
        }`}
      />
      <div className="flex flex-col sm:flex-row sm:items-center gap-0 sm:gap-1.5 min-w-0 text-[10px] font-black uppercase tracking-widest leading-tight">
        <span
          className={
            phase === 'error'
              ? 'text-red-700'
              : isOffline
                ? 'text-amber-700'
                : 'text-green-700'
          }
        >
          {primary}
        </span>
        {secondary ? (
          <span
            className={`truncate text-[9px] sm:text-[10px] ${
              phase === 'error'
                ? 'text-red-700'
                : isOffline
                  ? 'text-amber-600'
                  : active
                    ? 'text-green-600'
                    : 'text-green-700/80'
            }`}
          >
            {secondary}
          </span>
        ) : null}
      </div>
    </div>
  );
}
