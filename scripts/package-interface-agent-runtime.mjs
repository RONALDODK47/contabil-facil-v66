/**
 * Empacota a agent-api para todo lugar que precisa dela instalada:
 *   - SETUP INTERFACE (PODE COMPARTILHAR)/src/agent-runtime/ (fonte do instalador)
 *   - Contábil Fácil já instalado nesta máquina (AppData\Local\Programs\Contabil Facil\agent-runtime)
 *     — assim quem já tem o app instalado recebe o agent-api atualizado sem reinstalar do zero.
 *
 * Uso: npm run package:agent-runtime
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const INTERFACE_SRC = path.join(
  process.env.USERPROFILE || '',
  'Desktop',
  'SETUP SOFTWARE',
  'SETUP INTERFACE (PODE COMPARTILHAR)',
  'src',
);

/** Todos os destinos onde a agent-api precisa existir. Só publica nos que já existem. */
const TARGETS = [
  { label: 'Setup Interface (fonte do instalador)', dir: path.join(INTERFACE_SRC, 'agent-runtime') },
  {
    label: 'Contábil Fácil instalado nesta máquina',
    dir: path.join(
      process.env.LOCALAPPDATA || '',
      'Programs',
      'Contabil Facil',
      'agent-runtime',
    ),
  },
];

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, e.name);
    const to = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(from, to);
    else copyFile(from, to);
  }
}

const PACKAGE_JSON = {
  name: 'contabil-facil-agent-runtime',
  private: true,
  type: 'module',
  version: '1.0.0',
  dependencies: {
    '@aws-sdk/client-s3': '^3.1083.0',
    '@aws-sdk/s3-request-presigner': '^3.1083.0',
    '@google/genai': '^2.11.0',
    '@xmldom/xmldom': '^0.8.11',
    dotenv: '^17.2.3',
    express: '^4.21.2',
    'fast-xml-parser': '^5.8.0',
    multer: '^2.1.1',
    'node-forge': '^1.3.1',
    'pdf-parse-new': '^2.1.0',
    'pdfjs-dist': '^5.6.205',
    pg: '^8.22.0',
    undici: '^7.10.0',
    xlsx: '^0.18.5',
    'xml-crypto': '^6.0.0',
  },
};

const START_JS = `/**
 * Sobe a agent-api no Contábil Fácil instalado (só 127.0.0.1).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runtimeRoot = path.dirname(fileURLToPath(import.meta.url));
process.env.CONTABIL_DESKTOP = '1';
process.env.CONTABIL_DESKTOP_ROOT = runtimeRoot;
process.env.AGENT_API_HOST = process.env.AGENT_API_HOST || '127.0.0.1';
process.env.AGENT_API_PORT = process.env.AGENT_API_PORT || '8790';
process.env.STORAGE_BACKEND = process.env.STORAGE_BACKEND || 'docker';
process.env.VITE_STORAGE_BACKEND = process.env.VITE_STORAGE_BACKEND || 'docker';
if (!process.env.CORS_ALLOWED_ORIGIN) {
  process.env.CORS_ALLOWED_ORIGIN =
    'http://localhost:4173,http://127.0.0.1:4173,http://localhost:4900,http://127.0.0.1:4900';
}
delete process.env.NODE_ENV;

process.chdir(runtimeRoot);
await import('./scripts/agent-api-server.mjs');
`;

/** Publica scripts + compose files sempre. Só reinstala node_modules se ainda não existir
 * (evita recriar tudo em quem já tem o runtime instalado — só atualiza o código). */
function publishTo(target) {
  const { label, dir: OUT } = target;
  console.log(`[package-agent] ${label} → ${OUT}`);

  const hadNodeModules = fs.existsSync(path.join(OUT, 'node_modules'));

  rmrf(path.join(OUT, 'scripts'));
  copyDir(path.join(ROOT, 'scripts'), path.join(OUT, 'scripts'));

  for (const f of [
    'docker-compose.yml',
    'docker-compose.dev.yml',
    'docker-compose.bind.yml',
    '.env.example',
  ]) {
    const src = path.join(ROOT, f);
    if (fs.existsSync(src)) copyFile(src, path.join(OUT, f));
  }

  fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify(PACKAGE_JSON, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT, 'start.mjs'), START_JS, 'utf8');

  if (hadNodeModules) {
    console.log(`[package-agent] ${label}: node_modules já existe — só código atualizado (sem reinstalar).`);
    return true;
  }

  console.log(`[package-agent] ${label}: npm install --omit=dev …`);
  const npm = spawnSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: OUT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, npm_config_production: 'true' },
  });
  if ((npm.status ?? 1) !== 0) {
    console.error(`[package-agent] ${label}: npm install falhou`);
    return false;
  }
  return true;
}

let published = 0;
let failed = false;
for (const target of TARGETS) {
  const exists = fs.existsSync(target.dir) || fs.existsSync(path.dirname(target.dir));
  if (!exists) {
    console.log(`[package-agent] ${target.label}: pasta não encontrada, a saltar (${target.dir}).`);
    continue;
  }
  fs.mkdirSync(target.dir, { recursive: true });
  if (publishTo(target)) published += 1;
  else failed = true;
}

if (published === 0) {
  console.error('[package-agent] Nenhum destino encontrado — nada foi publicado.');
  process.exit(1);
}

console.log(`[package-agent] OK — agent-runtime publicado em ${published} destino(s).`);
process.exit(failed ? 1 : 0);
