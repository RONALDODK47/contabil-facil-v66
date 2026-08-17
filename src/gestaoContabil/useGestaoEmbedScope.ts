import { useEffect } from 'react';

const ROOT_CLASS = 'gestao-embed-active';

/** Marca o documento enquanto o módulo Gestão está montado (tema/escopo do embed). */
export function useGestaoEmbedScope(): void {
  useEffect(() => {
    document.documentElement.classList.add(ROOT_CLASS);
    return () => {
      document.documentElement.classList.remove(ROOT_CLASS);
    };
  }, []);
}
