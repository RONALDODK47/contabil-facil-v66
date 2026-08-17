/**
 * Prepara ambiente de produção (Postgres + Storage S3).
 * Rode na pasta SOFTWARE-NOVO-PRO com .env ou variáveis exportadas.
 *
 * Uso: npm run production:setup
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './load-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(label, scriptRel, extraEnv = {}) {
  console.info(`\n[production:setup] ${label}…`);
  const script = path.join(root, scriptRel);
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
    windowsHide: false,
  });
  if ((result.status ?? 1) !== 0) {
    console.error(`[production:setup] Falhou em: ${label}`);
    process.exit(result.status ?? 1);
  }
}

console.info('[production:setup] Eye Vision — preparação para produção\n');
console.info('  Postgres: validação do schema e storage de blobs');
console.info('  PDFs: object storage via MINIO_S3_ENDPOINT\n');

if (!String(process.env.DATABASE_URL || '').trim()) {
  console.error('[production:setup] Defina DATABASE_URL no .env');
  process.exit(1);
}

run('Schema Postgres', 'scripts/storage/migrate.mjs');
run('Validação final', 'scripts/production-check.mjs');

console.info('\n[production:setup] Concluído — pode fazer deploy no Render + Vercel.');
