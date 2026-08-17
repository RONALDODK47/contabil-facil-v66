/**
 * Hook para autosave com debounce.
 * Salva automaticamente qualquer mudança no servidor sem precisa de botão.
 */
import { useEffect, useRef, useCallback } from 'react';

export type AutoSaveOptions = {
  /** Delay em ms antes de salvar (debounce) */
  delayMs?: number;
  /** Callback para executar o save */
  onSave: () => void | Promise<void>;
  /** Dependências que disparam o autosave */
  dependencies: unknown[];
  /** Se true, desabilita o autosave */
  disabled?: boolean;
};

/**
 * Hook que salva automaticamente quando as dependências mudam.
 * Evita salvar múltiplas vezes com debounce.
 */
export function useAutoSave({
  delayMs = 1000,
  onSave,
  dependencies,
  disabled = false,
}: AutoSaveOptions) {
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const isSavingRef = useRef(false);

  const performSave = useCallback(async () => {
    if (disabled || isSavingRef.current) return;
    
    isSavingRef.current = true;
    try {
      await onSave();
    } catch (err) {
      console.error('[AutoSave] Erro ao salvar:', err instanceof Error ? err.message : err);
    } finally {
      isSavingRef.current = false;
    }
  }, [onSave, disabled]);

  useEffect(() => {
    // Limpa timeout anterior
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Se desabilitado ou sem dependências, não faz nada
    if (disabled) {
      return;
    }

    // Agenda novo save com debounce
    timeoutRef.current = setTimeout(() => {
      void performSave();
    }, delayMs);

    // Cleanup: cancela save pendente ao desmontar
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [performSave, disabled, delayMs, ...dependencies]);
}
