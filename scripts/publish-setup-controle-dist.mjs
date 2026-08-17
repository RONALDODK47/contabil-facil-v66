/**
 * Copia a build (dist) atualizada para o SETUP CONTROLE:
 * 1. c:\Users\ronaldo.silva\Desktop\SOFTWARE-NOVO-PRO\dist → SETUP SOFTWARE\SETUP INTERFACE (PODE COMPARTILHAR)\src\app
 * 2. Atualiza a agent-api no SETUP CONTROLE e na instalação local do app.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const INTERFACE_BASE = path.join(
  process.env.USERPROFILE || '',
  'Desktop',
  'SETUP SOFTWARE',
  'SETUP INTERFACE (PODE COMPARTILHAR)',
);
const TARGET_DESTINATIONS = [
  path.join(INTERFACE_BASE, 'src', 'app'),
  path.join(INTERFACE_BASE, 'src', 'dist'),
  path.join(INTERFACE_BASE, 'dist'),
];

function copyDir(src, dest) {
  if (path.resolve(src).toLowerCase() === path.resolve(dest).toLowerCase()) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function main() {
  if (!fs.existsSync(DIST_DIR)) {
    console.error('Erro: A pasta dist não existe. Rode npx vite build primeiro.');
    process.exit(1);
  }

  for (const destDir of TARGET_DESTINATIONS) {
    console.log(`[publish-dist] Copiando arquivos de ${DIST_DIR} para ${destDir}...`);
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true, force: true });
    }
    copyDir(DIST_DIR, destDir);
    console.log(`✓ Arquivos dist salvos em ${destDir}`);
  }

  console.log('[publish-dist] Empacotando agent-runtime...');
  const pkgRes = spawnSync('node', ['scripts/package-interface-agent-runtime.mjs'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (pkgRes.status === 0) {
    console.log('✓ Runtime do Agente (agent-runtime) empacotado e atualizado com sucesso.');
  } else {
    console.warn('⚠️ Alerta ao empacotar agent-runtime:', pkgRes.status);
  }

  console.log('\n=== TUDO PRONTO ===');
  console.log('1. A pasta dist (SOFTWARE-NOVO-PRO/dist) foi gerada.');
  console.log('2. Os arquivos foram atualizados no Setup Controle (src/app).');
}

main().catch((err) => {
  console.error('Falha ao publicar dist:', err);
  process.exit(1);
});
