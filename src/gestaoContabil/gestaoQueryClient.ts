/** Singleton compartilhado — Eye Vision + Gestão Contábil (evita "No QueryClient set" no build). */
import { QueryClient } from '@tanstack/react-query';

export const queryClientInstance = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
