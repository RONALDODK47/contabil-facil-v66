/**
 * Plugin Vite — garante Docker + agent-api mesmo ao rodar só `vite`.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let started = false;

export function viteDevBackendPlugin() {
  return {
    name: 'eye-vision-dev-backend',
    apply: 'serve',
    configureServer() {
      if (started || process.env.EYE_VISION_DEV_ALL === '1') return;
      started = true;
      const script = path.join(root, 'scripts', 'start-dev-backend.mjs');
      if (!existsSync(script)) return;
      spawn(process.execPath, [script], {
        cwd: root,
        detached: true,
        stdio: 'inherit',
        windowsHide: false,
        env: process.env,
      }).unref();
    },
  };
}
