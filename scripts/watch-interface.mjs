/**
 * Mantém a pasta dist sempre alinhada com o código-fonte (Interface, sem Admin).
 * Rode: npm run watch:interface
 * (também é iniciado automaticamente pelo Setup Controle, se o projeto estiver no Desktop)
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { writeInterfaceBuildInfo } from './write-interface-build-info.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

process.env.VITE_ENABLE_ADMIN = 'false';

console.log('=======================================================');
console.log(' WATCH INTERFACE — dist atualiza sozinha a cada alteração');
console.log(' Projeto:', ROOT);
console.log(' Pare com Ctrl+C');
console.log('=======================================================');

// Prebuild uma vez (BCB / contratos / backend agent & fiscal) — não a cada rebuild.
for (const args of [
  ['scripts/start-dev-backend.mjs'],
  ['scripts/download-bcb-series.mjs'],
  ['scripts/bundle-saved-contracts.mjs'],
]) {
  const step = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    cwd: ROOT,
    env: process.env,
  });
  if (step.status !== 0) {
    console.warn('[watch:interface] aviso no prebuild', args[0], '— continuo na mesma');
  }
}

let rebuilds = 0;

await build({
  configFile: path.join(ROOT, 'vite.config.ts'),
  root: ROOT,
  mode: 'production',
  build: {
    // Watch removido a pedido do usuário (para não atualizar 4173 em tempo real)
  },
  plugins: [
    {
      name: 'contabil-watch-interface-info',
      closeBundle() {
        rebuilds += 1;
        const info = writeInterfaceBuildInfo({ watch: false, rebuild: rebuilds });
        console.log(
          `[watch:interface] dist atualizado (BUILD ÚNICO) ${info?.gerado_em || ''}`,
        );
      },
    },
  ],
});

// Como tiramos o watch, o build() vai resolver. 
// Para o Setup Controle não achar que o processo crashou e tentar reiniciar num loop,
// mantemos o processo vivo artificialmente:
console.log('[watch:interface] Modo watch desativado. Processo mantido vivo para o Setup Controle.');
setInterval(() => {}, 1000 * 60 * 60);