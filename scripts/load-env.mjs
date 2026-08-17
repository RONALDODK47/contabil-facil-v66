/**
 * Carrega variáveis de ambiente no padrão do Vite para scripts Node.
 */
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.env.NODE_ENV || 'development';

for (const file of [
  '.env',
  '.env.local',
  `.env.${mode}`,
  `.env.${mode}.local`,
]) {
  const isProductionFile = file.includes('.production');
  config({
    path: path.join(root, file),
    quiet: true,
    override: mode === 'production' && isProductionFile,
  });
}

if (mode === 'production') {
}
