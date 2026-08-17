#!/usr/bin/env node
/**
 * Script: dev-vpn-launcher.mjs
 * Lançador para rodar dev-vpn-simples.ps1
 * Usa: npm run dev:vpn
 */

import { spawn } from 'child_process';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(__dirname, 'dev-vpn-simples.ps1');

console.log('\n🚀 Iniciando VPN + Firewall + App...\n');

// Executa PowerShell com -File (mais seguro e melhor que -Command)
const powershell = spawn('powershell.exe', [
  '-NoExit',
  '-File',
  scriptPath
], {
  stdio: 'inherit'
});

powershell.on('error', (err) => {
  console.error('\n❌ Erro ao executar:', err.message);
  process.exit(1);
});

powershell.on('close', (code) => {
  process.exit(code || 0);
});
