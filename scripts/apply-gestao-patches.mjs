/**
 * Aplica patches visuais/comportamentais no vendor Gestão Contábil (junction).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(root, 'vendor', 'gestao-contabil');

if (!existsSync(vendor)) {
  console.warn('[gestao:patches] vendor/gestao-contabil ausente — rode npm run gestao:link');
  process.exit(0);
}

const scripts = [
  'patch-useful-sites-grid.mjs',
  'patch-notices-cards.mjs',
  'fix-notices-import.mjs',
];

for (const script of scripts) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', script)], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.info('[gestao:patches] Patches aplicados.');
