/**
 * Diretório .data ancorado na raiz do projeto (independente de process.cwd()).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function getProjectRoot() {
  return PROJECT_ROOT;
}

export function getProjectDataDir() {
  const dir = join(PROJECT_ROOT, '.data');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
