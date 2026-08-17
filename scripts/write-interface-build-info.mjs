/** Grava dist/build-info.json após cada build da Interface. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function writeInterfaceBuildInfo(extra = {}) {
  const distDir = path.join(ROOT, 'dist');
  if (!fs.existsSync(distDir)) return null;
  const info = {
    gerado_em: new Date().toISOString(),
    tipo: 'interface',
    enable_admin: false,
    aviso: 'Gerado por build:interface / watch:interface — use esta pasta no Setup Controle.',
    ...extra,
  };
  fs.writeFileSync(path.join(distDir, 'build-info.json'), JSON.stringify(info, null, 2), 'utf8');
  return info;
}
