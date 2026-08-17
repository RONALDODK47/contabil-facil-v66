import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// ==========================================
// 🛡️ GLOBAL STORAGE GUARD: ZERO HARD WRITE
// ==========================================
if (typeof window !== 'undefined') {
  // =========================================================================
  // Armazenamento: usa localStorage real do navegador para sobreviver ao
  // refresh, com sincronização automática para o Docker (PostgreSQL).
  //
  // IMPORTANTE: NÃO limpar o localStorage aqui. Os dados persistidos pelo
  // ciclo anterior (hydrate do Docker) precisam estar disponíveis até o
  // próximo restore completar.
  // =========================================================================

  // 1. Apaga apenas IndexedDB legado (sem dados operacionais relevantes)
  try {
    if (window.indexedDB) {
      window.indexedDB.deleteDatabase('eye-vision-ai-inteligencia');
      window.indexedDB.deleteDatabase('eye-vision-local-db');
    }
  } catch (e) {
    console.warn('[storage-guard] IndexedDB cleanup failed:', e);
  }
}

import App from './App.tsx';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import './index.css';
import { deferIdle } from './contabilfacil/lib/deferIdle';
import { installChunkLoadRecovery } from './lib/chunkLoadRecovery';
import { installBrowserConsoleBridge } from './contabilfacil/agent/browserConsoleBridge';
import { hydrateSafeStorageFromIndexedDb } from './lib/safeLocalStorage';

/** Instala recuperação de carregamento de chunks e bridge de console. */
installChunkLoadRecovery();

export const DATA_HYDRATED_EVENT = 'contabilfacil:data-hydrated';

/**
 * Dev only: silencia logs ruidosos do cliente HMR do Vite no console do navegador
 * (ex.: "[vite] hot updated:", "[vite] connecting...", "[vite] connected.").
 * Erros e warnings continuam visíveis.
 */
if (import.meta.env.DEV) {
  const originalLog = console.log.bind(console);
  console.log = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === 'string' && /^\[vite\]\s/.test(first)) return;
    originalLog(...args);
  };

  const originalInfo = console.info.bind(console);
  console.info = (...args: unknown[]) => {
    const text = args.map(String).join(' ');
    if (/react devtools/i.test(text)) return;
    originalInfo(...args);
  };

  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const text = args.map(String).join(' ');
    if (/react devtools/i.test(text)) return;
    originalError(...args);
  };
}

/** Legado (?mv_auth) — apenas limpa a barra se o Hub tiver passado o parâmetro. */
function stripMvAuthSearchParam(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('mv_auth')) return;
    params.delete('mv_auth');
    const qs = params.toString();
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`,
    );
  } catch {
    /* ignore */
  }
}

stripMvAuthSearchParam();

const rootEl = document.getElementById('root')!;

/**
 * O IndexedDB (backend real de armazenamento — ver safeLocalStorage.ts)
 * precisa terminar de carregar no Map em memória ANTES do app renderizar,
 * senão a primeira leitura síncrona de dados que só existem lá (porque não
 * couberam no localStorage antigo) voltaria vazia. A hidratação é local
 * (sem rede) e normalmente termina em poucos milissegundos.
 */
rootEl.innerHTML =
  '<div style="height:100vh;display:flex;align-items:center;justify-content:center;font:600 11px system-ui;letter-spacing:.08em;text-transform:uppercase;opacity:.5;">Carregando…</div>';

void hydrateSafeStorageFromIndexedDb()
  .catch((error) => {
    console.error('Erro na hidratação do armazenamento:', error);
    // Continua mesmo com erro de hidratação
  })
  .finally(() => {
    try {
      createRoot(rootEl).render(
        <StrictMode>
          <AppErrorBoundary>
            <App />
          </AppErrorBoundary>
        </StrictMode>,
      );
    } catch (error) {
      console.error('Erro crítico ao renderizar aplicação:', error);
      // Fallback extremo: mostra erro diretamente
      rootEl.innerHTML = `
        <div style="height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;font-family:system-ui;">
          <div style="max-width:500px;text-align:center;background:#f9f9f9;border:1px solid #ddd;padding:40px;border-radius:8px;">
            <h2 style="color:#d32f2f;margin-bottom:20px;">Erro de Inicialização</h2>
            <p style="margin-bottom:20px;color:#666;">
              A aplicação encontrou um erro durante o carregamento. Tente recarregar a página.
            </p>
            <button onclick="window.location.reload()" style="padding:12px 24px;background:#1976d2;color:white;border:none;border-radius:4px;cursor:pointer;">
              Recarregar Página
            </button>
            <details style="margin-top:20px;text-align:left;">
              <summary style="cursor:pointer;color:#666;">Detalhes técnicos</summary>
              <pre style="background:#f5f5f5;padding:10px;border-radius:4px;font-size:10px;overflow:auto;margin-top:10px;">${error instanceof Error ? error.stack : String(error)}</pre>
            </details>
          </div>
        </div>
      `;
    }
  });

/** Telemetria/bridge em idle para não atrasar login inicial. */
deferIdle(() => {
  installBrowserConsoleBridge();
}, 600);

/** Calendário bancário em background — não bloqueia primeira tela (login). */
deferIdle(() => {
  void import('./services/bankingCalendarService').then((mod) => {
    mod.hydrateBankingCalendarFromStorage();
    void mod.hydrateBankingCalendarFromRemote();
  });
}, 900);

/** Dados BCB e contratos em background — não bloqueia a UI. */
deferIdle(() => {
  void Promise.all([
    import('./services/bcbSeriesStorage'),
    import('./lib/deployDataBundle'),
  ]).then(([bcb, deploy]) =>
    Promise.all([
      bcb.hydrateBcbSeriesFromBundledAssets(),
      deploy.hydrateDeployDataFromBundledAssets(),
    ]),
  ).then(() => {
    window.dispatchEvent(new CustomEvent(DATA_HYDRATED_EVENT));
  }).catch((err) => {
    console.warn('Erro ao hidratar dados de bundle:', err instanceof Error ? err.message : err);
  });
}, 1200);
