import type { ReactNode } from 'react';

export default function GestaoThemeProviderFallback({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
