import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { reportBrowserConsoleError } from '../contabilfacil/agent/browserConsoleBridge';
import { isChunkLoadError } from '../lib/chunkLoadRecovery';

type AppErrorBoundaryProps = {
  children: React.ReactNode;
};

type AppErrorBoundaryState = {
  hasError: boolean;
  errorMessage: string;
  errorStack: string;
  componentStack: string;
};

export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false, errorMessage: '', errorStack: '', componentStack: '' };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? (error.stack ?? '') : '',
      componentStack: '',
    };
  }

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo): void {
    reportBrowserConsoleError('react', error, errorInfo.componentStack ?? '');
    console.error('Erro não tratado na árvore React:', error, errorInfo);
    console.error('Stack completo:', errorInfo.componentStack);
    console.error('Erro detalhado:', {
      message: error instanceof Error ? error.message : 'Erro desconhecido',
      stack: error instanceof Error ? error.stack : null,
      name: error instanceof Error ? error.name : typeof error,
    });
    this.setState({ componentStack: errorInfo.componentStack ?? '' });

    if (isChunkLoadError(error)) {
      console.log('Detectado erro de chunk load - recarregando em 2 segundos...');
      window.setTimeout(() => window.location.reload(), 2000);
    }
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-brand-bg text-brand-text flex flex-col items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-lg technical-panel shadow-[3px_3px_0_0_#141414] border-red-800/80 overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-brand-border bg-brand-sidebar/60">
              <div className="w-9 h-9 border border-red-800/60 bg-red-50 flex items-center justify-center shrink-0">
                <AlertTriangle size={18} className="text-red-800" aria-hidden />
              </div>
              <div className="min-w-0 text-left">
                <p className="text-[9px] font-black uppercase tracking-widest text-red-800">
                  Erro de renderização
                </p>
                <p className="text-[10px] font-bold uppercase opacity-50 tracking-widest">
                  ContabilFacil
                </p>
              </div>
            </div>

            <div className="px-5 py-6 space-y-4 text-left">
              <h1 className="text-xl font-black tracking-tighter uppercase italic leading-tight">
                Algo inesperado aconteceu na interface.
              </h1>

              {this.state.errorMessage && (
                <div className="bg-red-50 border border-red-300 p-3 space-y-1">
                  <p className="text-[10px] font-black uppercase text-red-800 tracking-widest">Mensagem do erro</p>
                  <p className="text-[11px] font-mono text-red-900 break-all">{this.state.errorMessage}</p>
                </div>
              )}

              {this.state.errorStack && (
                <details open>
                  <summary className="text-[10px] font-black uppercase tracking-widest cursor-pointer opacity-60 hover:opacity-100">
                    Stack trace
                  </summary>
                  <pre className="mt-2 text-[9px] font-mono leading-relaxed bg-brand-sidebar/40 border border-brand-border p-3 overflow-x-auto whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                    {this.state.errorStack}
                  </pre>
                </details>
              )}

              {this.state.componentStack && (
                <details>
                  <summary className="text-[10px] font-black uppercase tracking-widest cursor-pointer opacity-60 hover:opacity-100">
                    Componente React
                  </summary>
                  <pre className="mt-2 text-[9px] font-mono leading-relaxed bg-brand-sidebar/40 border border-brand-border p-3 overflow-x-auto whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                    {this.state.componentStack}
                  </pre>
                </details>
              )}

              <div className="pt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={this.handleReload}
                  className="technical-button-primary inline-flex items-center gap-2"
                >
                  <RefreshCw size={14} aria-hidden />
                  Recarregar
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
