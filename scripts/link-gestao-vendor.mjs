/**
 * Liga vendor/gestao-contabil ao projeto legado EMPRESTIMOS-MASTER (junction no Windows).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'vendor', 'gestao-contabil');
const defaultSource =
  'C:\\Users\\ronaldo.silva\\Downloads\\eye-vision-v1.0.4-main\\eye-vision-v1.0.4-main\\EMPRESTIMOS-MASTER-master\\vendor\\gestao-contabil';
const source = String(process.env.LEGACY_EYE_VISION_ROOT || defaultSource)
  .trim()
  .replace(/[\\/]vendor[\\/]gestao-contabil$/i, '');
const sourceVendor = path.join(source, 'vendor', 'gestao-contabil');

if (!existsSync(sourceVendor)) {
  console.error(`[gestao:link] Origem não encontrada: ${sourceVendor}`);
  process.exit(1);
}

mkdirSync(path.join(root, 'vendor'), { recursive: true });

if (existsSync(target)) {
  console.info(`[gestao:link] Já existe: ${target}`);
  process.exit(0);
}

if (process.platform === 'win32') {
  execSync(`cmd /c mklink /J "${target}" "${sourceVendor}"`, { stdio: 'inherit' });
} else {
  execSync(`ln -s "${sourceVendor}" "${target}"`, { stdio: 'inherit' });
}

console.info(`[gestao:link] Ligado: ${target} → ${sourceVendor}`);
