/**
 * Sobe o worker Python de download de documentos (:8766).
 */
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const docDir = path.join(root, 'doc_downloader');
const venvPython =
  process.platform === 'win32'
    ? path.join(docDir, '.venv', 'Scripts', 'python.exe')
    : path.join(docDir, '.venv', 'bin', 'python');

if (!existsSync(venvPython)) {
  console.warn('[doc-downloader] Ambiente Python não encontrado.');
  console.warn('[doc-downloader] Rode: npm run doc-downloader:install');
  process.exit(process.argv.includes('--required') ? 1 : 0);
}

console.info('[doc-downloader] online em http://127.0.0.1:8766 (Python nativo)');

const proc = spawn(venvPython, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8766'], {
  cwd: docDir,
  stdio: 'inherit',
  env: { ...process.env, PYTHONUNBUFFERED: '1' },
});

proc.on('exit', (code) => process.exit(code ?? 0));

process.on('SIGINT', () => proc.kill('SIGTERM'));
process.on('SIGTERM', () => proc.kill('SIGTERM'));
