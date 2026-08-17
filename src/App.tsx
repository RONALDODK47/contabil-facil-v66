import { lazy, Suspense } from 'react';
import GestaoAuthShell from './gestaoContabil/GestaoAuthShell';
import { AppErrorBoundary } from './components/AppErrorBoundary';

const ContabilFacilApp = lazy(() => import('./contabilfacil/ContabilFacilApp'));

export default function App() {
  try {
    return (
      <AppErrorBoundary>
        <GestaoAuthShell>
          <Suspense fallback={<div className="h-screen bg-brand-bg flex items-center justify-center text-brand-text">
            <div className="font-mono text-xs uppercase tracking-widest opacity-50">Carregando aplicação...</div>
          </div>}>
            <AppErrorBoundary>
              <ContabilFacilApp />
            </AppErrorBoundary>
          </Suspense>
        </GestaoAuthShell>
      </AppErrorBoundary>
    );
  } catch (error) {
    console.error('Erro crítico no App root:', error);
    return (
      <div className="h-screen bg-red-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-red-200 rounded-lg shadow-lg p-6 text-center">
          <div className="text-red-600 mb-4">
            <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Erro de Inicialização</h2>
          <p className="text-gray-600 mb-4">
            A aplicação não conseguiu inicializar corretamente. Tente recarregar a página.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="bg-red-600 text-white px-6 py-2 rounded-md hover:bg-red-700 transition-colors"
          >
            Recarregar Página
          </button>
          <details className="mt-4 text-left">
            <summary className="cursor-pointer text-sm text-gray-500">Ver detalhes técnicos</summary>
            <pre className="mt-2 p-3 bg-gray-100 rounded text-xs overflow-auto">
              {error instanceof Error ? error.stack : String(error)}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
