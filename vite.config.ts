import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import type { Plugin, PluginOption, ProxyOptions } from 'vite';
import { defineConfig } from 'vite';
import {agentApiDevFallback} from './scripts/vite-agent-api-fallback.mjs';
import {viteDevBackendPlugin} from './scripts/vite-dev-backend-plugin.mjs';

const GESTAO_ROOT = path.resolve(__dirname, 'vendor/gestao-contabil');
const GESTAO_SRC = path.resolve(GESTAO_ROOT, 'src');
const GESTAO_AUTH_CONTEXT = path.resolve(GESTAO_SRC, 'lib/AuthContext.jsx');
const GESTAO_AUTH_CORE = path.resolve(GESTAO_SRC, 'lib/authContextCore.js');
/**
 * Auth local sem Firebase (Firebase foi desativado no app). O AuthProvider real
 * do app (GestaoAuthShell â†’ ./gestaoAuth) usa este arquivo â€” as pÃ¡ginas @gestao
 * (Dashboard, Profile, etc.) precisam resolver "@/lib/AuthContext" para o MESMO
 * mÃ³dulo, senÃ£o useAuth() lÃª um React Context diferente do que foi provido e
 * lanÃ§a "useAuth must be used within an AuthProvider" mesmo com o Provider montado.
 */
const LOCAL_AUTH_CONTEXT_FALLBACK = path.resolve(__dirname, 'src/gestaoContabil/authContextFallback.tsx');
const GESTAO_QUERY_CLIENT = path.resolve(__dirname, 'src/gestaoContabil/gestaoQueryClient.ts');
const REACT_QUERY_PKG = path.resolve(__dirname, 'node_modules/@tanstack/react-query');

/** Resolve `@/` (padrÃ£o da GestÃ£o ContÃ¡bil) para `GESTAO-CONTABIL/src`. */
function gestaoAtAlias(): Plugin {
  return {
    name: 'gestao-at-alias',
    enforce: 'pre',
    resolveId(source) {
      if (!source.startsWith('@/')) return null;
      const rel = source.slice(2);
      if (rel === 'lib/useCloudAccess' || rel === 'lib/useCloudAccess.js') {
        return path.resolve(__dirname, 'src/gestaoContabil/useCloudAccessBridge.ts');
      }
      if (rel === 'lib/AuthContext' || rel === 'lib/AuthContext.jsx') {
        return LOCAL_AUTH_CONTEXT_FALLBACK;
      }
      const exts = ['', '.jsx', '.tsx', '.js', '.ts', '.json'];
      for (const ext of exts) {
        const full = path.resolve(GESTAO_SRC, `${rel}${ext}`);
        if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
      }
      for (const indexExt of ['index.ts', 'index.tsx', 'index.js', 'index.jsx']) {
        const indexFull = path.resolve(GESTAO_SRC, rel, indexExt);
        if (fs.existsSync(indexFull)) return indexFull;
      }
      return null;
    },
  };
}

/** Admin Eye Vision: escopo completo no Dashboard (sem aviso bootstrap). */
function gestaoAdminScopePatch(): Plugin {
  return {
    name: 'gestao-admin-scope-patch',
    transform(code, id) {
      if (!id.includes('gestao-contabil') || !id.replace(/\\/g, '/').endsWith('/pages/Dashboard.jsx')) {
        return null;
      }
      if (!code.includes('Conta administrador bootstrap')) return null;
      return code.replace(
        '{isAdminEmail && (',
        '{isAdminEmail && !internalStaffFullAccess && (',
      );
    },
  };
}

/// <reference types="vitest/config" />

import pkg from './package.json';

/** Base pÃºblica: GitHub Pages termina em /v1.0.7/; Vercel usa /v1.0.7/ */
function resolveAppBasePath(): string {
  const explicit = String(process.env.VITE_BASE_PATH || '').trim();
  if (explicit) return explicit.endsWith('/') ? explicit : `${explicit}/`;
  if (process.env.VERCEL === '1' || process.env.VERCEL === 'true') {
    return `/v${pkg.version}/`;
  }
  return '/';
}

/** Loga só uma linha curta em falha de proxy (evita stack trace gigante no terminal por instabilidade de rede transitória). */
function quietProxyErrors(label: string) {
  return (proxy: Parameters<NonNullable<ProxyOptions['configure']>>[0]) => {
    proxy.on('error', (err, _req, res) => {
      console.warn(`[vite-proxy] ${label} indisponível (${err.message}).`);
      if (res && 'writeHead' in res && !res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
      }
      res?.end?.(JSON.stringify({ error: `${label} indisponível` }));
    });
  };
}

/** Dev / preview: API fiscal local + sÃ©ries BCB (evita CORS no browser). */
const devPreviewProxy: Record<string, ProxyOptions> = {
  '/api/fiscal-nfe': {
    target: 'http://127.0.0.1:8780',
    changeOrigin: true,
    timeout: 8000,
    proxyTimeout: 8000,
    rewrite: (p) => p.replace(/^\/api\/fiscal-nfe/, ''),
    configure: quietProxyErrors('fiscal-nfe'),
  },
  '/api/brasilapi': {
    target: 'https://brasilapi.com.br',
    changeOrigin: true,
    secure: true,
    timeout: 8000,
    proxyTimeout: 8000,
    rewrite: (p) => p.replace(/^\/api\/brasilapi/, ''),
    configure: quietProxyErrors('brasilapi'),
  },
  '/api/bcb': {
    target: 'https://api.bcb.gov.br',
    changeOrigin: true,
    secure: true,
    timeout: 8000,
    proxyTimeout: 8000,
    rewrite: (p) => p.replace(/^\/api\/bcb/, ''),
    configure: (proxy) => {
      quietProxyErrors('bcb')(proxy);
      proxy.on('proxyReq', (proxyReq) => {
        proxyReq.setHeader('Accept', 'application/json, text/plain, */*');
        proxyReq.setHeader(
          'User-Agent',
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 EmprestimosSim/1.0'
        );
      });
    },
  },
};

export default defineConfig(() => ({
    base: resolveAppBasePath(),
    plugins: [
      react(),
      tailwindcss(),
      gestaoAtAlias(),
      gestaoAdminScopePatch(),
      // viteDevBackendPlugin() as unknown as PluginOption,
      // agentApiDevFallback() as unknown as PluginOption,
    ],
    test: {
      globals: false,
      environment: 'node',
      include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
      setupFiles: ['src/test/vitest.setup.ts'],
    },
    resolve: {
      dedupe: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react-router',
        'react-router-dom',
        '@tanstack/react-query',
        'firebase',
        'firebase/app',
        'firebase/auth',
        'firebase/firestore',
        '@firebase/app',
        '@firebase/auth',
        '@firebase/firestore',
        '@firebase/webchannel-wrapper',
      ],
      alias: {
        '@gestao': GESTAO_SRC,
        '@gestao/lib/AuthContext.jsx': GESTAO_AUTH_CONTEXT,
        '@gestao/lib/AuthContext': GESTAO_AUTH_CONTEXT,
        '@gestao/lib/query-client': GESTAO_QUERY_CLIENT,
        '@/lib/query-client': GESTAO_QUERY_CLIENT,
        '@/lib/AuthContext': LOCAL_AUTH_CONTEXT_FALLBACK,
        '@/lib/authContextCore': GESTAO_AUTH_CORE,
        '@/lib/useCloudAccess': path.resolve(__dirname, 'src/gestaoContabil/useCloudAccessBridge.ts'),
        '@/api/dbClient': path.resolve(GESTAO_SRC, 'api/dbClient.js'),
        '@tanstack/react-query': REACT_QUERY_PKG,
        firebase: path.resolve(__dirname, 'node_modules/firebase'),
      },
    },
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react-router-dom',
        '@tanstack/react-query',
        'firebase/app',
        'firebase/auth',
        'firebase/firestore',
        '@radix-ui/react-select',
        '@radix-ui/react-dialog',
        '@radix-ui/react-slot',
        '@radix-ui/react-tabs',
        '@radix-ui/react-tooltip',
        'class-variance-authority',
        'recharts',
        'date-fns',
        'clsx',
        'zod',
      ],
      esbuildOptions: {
        target: 'es2022',
      },
    },
    server: {
      watch: {
        ignored: [
          '**/src/data/**',
          '**/public/data/**',
          '**/*.log',
          '**/scripts/**',
          '**/__tests__/**',
          '**/dist/**',
          '**/.git/**',
          '**/doc_downloader/**',
          '**/agent-runtime/**',
          '**/*.tmp',
          '**/.storage-config.json',
          '**/docker-compose.bind.local.yml',
          '**/.env',
        ],
      },
      fs: {
        allow: [__dirname, GESTAO_ROOT, path.resolve(__dirname, 'conversor')],
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyÃ¢Â€Â”file watching is disabled to prevent flickering during agent edits.
      port: 3000,
      host: '0.0.0.0',
      strictPort: true,
      hmr: false,
      proxy: devPreviewProxy,
    },
    preview: {
      proxy: devPreviewProxy,
    },
    worker: {
      format: 'es',
      plugins: () => [gestaoAtAlias()],
    },
    build: {
      target: 'es2022',
      sourcemap: false,
      cssCodeSplit: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            if (id.includes('d3-')) return 'vendor-charts';
            if (id.includes('pdfjs-dist')) return 'vendor-pdf';
            if (id.includes('xlsx')) return 'vendor-xlsx';
            if (id.includes('jspdf')) return 'vendor-jspdf';
            if (id.includes('motion') || id.includes('framer-motion')) return 'vendor-motion';
            if (id.includes('firebase')) return 'vendor-firebase';
            if (id.includes('lucide-react')) return 'vendor-icons';
            if (id.includes('@tanstack/react-query')) return 'vendor-react-query';
            if (id.includes('react-dom') || id.includes('react/')) return 'vendor-react';
            if (id.includes('@radix-ui')) return 'vendor-radix';
            if (id.includes('recharts')) return 'vendor-recharts';
            if (id.includes('tesseract.js') || id.includes('three')) return 'vendor-heavy';
          },
        },
      },
    },
}));
