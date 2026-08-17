/**
 * Build "Setup Interface" — mesma build de produção, mas com VITE_ENABLE_ADMIN=false.
 * A aba Admin (e o código dela) fica de fora do bundle nesta build — ver
 * src/contabilfacil/ContabilFacilApp.tsx e tabLauncherCatalog.ts.
 * Use esta build (não "npm run build") para gerar a pasta que alimenta o
 * "SETUP CONTROLE" na hora de publicar o instalador compartilhável.
 */
import { spawnSync } from 'node:child_process';

const env = { ...process.env, VITE_ENABLE_ADMIN: 'false' };

// Mesmos passos que "prebuild" roda antes de "npm run build" (npm só dispara
// esse hook automaticamente para o script chamado "build").
for (const args of [['scripts/download-bcb-series.mjs'], ['scripts/bundle-saved-contracts.mjs']]) {
  const step = spawnSync('node', args, { stdio: 'inherit', env });
  if (step.status !== 0) process.exit(step.status ?? 1);
}

const result = spawnSync('npx', ['vite', 'build'], { stdio: 'inherit', env, shell: true });
process.exit(result.status ?? 1);
