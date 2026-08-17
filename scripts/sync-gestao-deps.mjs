/**
 * Copia dependências de runtime da Gestão Contábil para o package.json raiz
 * (o módulo é importado via @gestao / import.meta.glob no Eye Vision).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const gestaoPkgPath = path.join(root, 'vendor/gestao-contabil/package.json');
const rootPkgPath = path.join(root, 'package.json');

const gestaoPkg = JSON.parse(readFileSync(gestaoPkgPath, 'utf8'));
const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'));

const SKIP = new Set(['react', 'react-dom', 'vite', '@vitejs/plugin-react', 'build']);

const merged = { ...rootPkg.dependencies };
let added = 0;

for (const [name, version] of Object.entries(gestaoPkg.dependencies ?? {})) {
  if (SKIP.has(name)) continue;
  if (!merged[name]) {
    merged[name] = version;
    added++;
  }
}

rootPkg.dependencies = Object.fromEntries(
  Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)),
);

if (!rootPkg.scripts['gestao:sync-deps']) {
  rootPkg.scripts['gestao:sync-deps'] = 'node scripts/sync-gestao-deps.mjs';
}

writeFileSync(rootPkgPath, `${JSON.stringify(rootPkg, null, 2)}\n`, 'utf8');
console.info(`[gestao:sync-deps] ${added} dependência(s) adicionada(s) ao package.json raiz.`);
