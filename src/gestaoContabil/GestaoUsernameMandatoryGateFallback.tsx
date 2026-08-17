import type { ReactNode } from 'react';

export default function GestaoUsernameMandatoryGateFallback({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}
