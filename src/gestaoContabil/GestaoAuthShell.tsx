import { type ReactNode, useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './gestaoAuth';
import { useCloudAccess } from './useCloudAccessBridge';
import { queryClientInstance } from './gestaoQueryClient';
import EyeVisionStaffLogin from './EyeVisionStaffLogin';
import EyeVisionCloudBootstrap from '../contabilfacil/components/EyeVisionCloudBootstrap';
import TabLoadingFallback from '../contabilfacil/components/TabLoadingFallback';
import { notifyDebugAppHealthy } from '../contabilfacil/agent/browserConsoleBridge';

// Firebase desativado - usando apenas autenticação local com localStorage

function GestaoAuthGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoadingAuth } = useAuth();

  if (isLoadingAuth) {
    return (
      <div className="h-screen bg-brand-bg">
        <TabLoadingFallback />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <EyeVisionStaffLogin />;
  }

  return <GestaoAuthenticatedShell>{children}</GestaoAuthenticatedShell>;
}

function GestaoAuthenticatedShell({ children }: { children: ReactNode }) {
  return (
    <GestaoCloudAccessGate>{children}</GestaoCloudAccessGate>
  );
}

/** Só monta após login — `useCloudAccess` exige QueryClient + token valido. */
function GestaoCloudAccessGate({ children }: { children: ReactNode }) {
  const { isLoading: isLoadingCloudAccess, companyTokenOk } = useCloudAccess();

  const appHealthy = !isLoadingCloudAccess && companyTokenOk;

  useEffect(() => {
    if (!appHealthy) return;
    notifyDebugAppHealthy();
  }, [appHealthy]);

  if (isLoadingCloudAccess) {
    return (
      <div className="h-screen bg-brand-bg">
        <TabLoadingFallback />
      </div>
    );
  }

  // Token gate removido — acesso sempre liberado independente do token

  return (
    <>
      <EyeVisionCloudBootstrap />
      {children}
    </>
  );
}

export default function GestaoAuthShell({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClientInstance}>
      <AuthProvider>
        <GestaoAuthGate>{children}</GestaoAuthGate>
      </AuthProvider>
    </QueryClientProvider>
  );
}
