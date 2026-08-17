import { Suspense } from 'react';
import TabLoadingFallback from './TabLoadingFallback';
import ThemeProvider from '../../gestaoContabil/GestaoThemeProviderFallback';
import { useCloudAccess } from '../../gestaoContabil/useCloudAccessFallback';
import AdminEmpresasPanel from './admin/AdminEmpresasPanel';

export default function AdminModule() {
  const { isAdminEmail, isLoading } = useCloudAccess();

  if (isLoading) return <TabLoadingFallback />;

  if (!isAdminEmail) {
    return (
      <div className="technical-panel p-6 max-w-lg">
        <h2 className="text-lg font-black uppercase">Acesso restrito</h2>
        <p className="mt-2 text-xs opacity-70 leading-relaxed">
          Apenas o administrador cloud pode aceder a este módulo. Utilize a conta de administrador
          configurada na Gestão Contábil.
        </p>
      </div>
    );
  }

  return (
    <ThemeProvider>
      <Suspense fallback={<TabLoadingFallback />}>
        <div className="max-w-5xl mx-auto space-y-4">
          <AdminEmpresasPanel />
        </div>
      </Suspense>
    </ThemeProvider>
  );
}
