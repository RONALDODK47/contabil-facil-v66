import { useEffect, useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '../gestaoContabil/gestaoAuth';
import { queryClientInstance } from '../gestaoContabil/gestaoQueryClient';
import ThemeProvider from '../gestaoContabil/GestaoThemeProviderFallback';
import TabLoadingFallback from '../contabilfacil/components/TabLoadingFallback';
import AdminEmpresasPanel from '../contabilfacil/components/admin/AdminEmpresasPanel';

/** Sessão local silenciosa — sem tela de login. Só no Setup Controle. */
const SETUP_ADMIN_EMAIL = 'ronaldojunior.gyn@gmail.com';
const SETUP_ADMIN_PASS = 'setup-controle-local';

function SetupAdminSession({ children }: { children: ReactNode }) {
  const { user, isLoadingAuth, loginWithEmailPassword } = useAuth();
  const [ready, setReady] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (isLoadingAuth) return;
    if (user?.email?.toLowerCase() === SETUP_ADMIN_EMAIL && user?.uid) {
      setReady(true);
      return;
    }
    let cancelled = false;
    void loginWithEmailPassword(SETUP_ADMIN_EMAIL, SETUP_ADMIN_PASS, '')
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setErro(e instanceof Error ? e.message : 'Falha ao iniciar sessão de administrador.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, user, loginWithEmailPassword]);

  if (erro) {
    return (
      <div className="min-h-screen bg-brand-bg text-brand-text p-8">
        <div className="technical-panel p-6 max-w-lg">
          <h2 className="text-lg font-black uppercase">Administrador</h2>
          <p className="mt-2 text-xs opacity-70">{erro}</p>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-brand-bg">
        <TabLoadingFallback />
      </div>
    );
  }

  return <>{children}</>;
}

export default function SetupAdminApp() {
  return (
    <QueryClientProvider client={queryClientInstance}>
      <AuthProvider>
        <SetupAdminSession>
          <ThemeProvider>
            <div className="min-h-screen bg-brand-bg text-brand-text p-4 md:p-6">
              <div className="max-w-5xl mx-auto space-y-4">
                <AdminEmpresasPanel />
              </div>
            </div>
          </ThemeProvider>
        </SetupAdminSession>
      </AuthProvider>
    </QueryClientProvider>
  );
}
