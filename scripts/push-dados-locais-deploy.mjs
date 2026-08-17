/**
 * Envia as REGRAS DE CONCILIAÇÃO e PASTAS DE EXTRATO do backup local
 * para o servidor de deploy (Render/Railway), sobrescrevendo dados antigos.
 *
 * USO:
 *   node scripts/push-dados-locais-deploy.mjs <caminho-backup.json> <url-deploy>
 *
 * EXEMPLO:
 *   node scripts/push-dados-locais-deploy.mjs "C:\Users\ronaldo.silva\Desktop\backup.json" https://meu-deploy.onrender.com
 *
 * O que faz:
 *   1. Lê o arquivo de backup exportado pelo app (Exportar > Backup JSON)
 *   2. Extrai as chaves de regras (extrato_regras_contas_v2) e pastas (extrato_pastas_v1)
 *   3. Envia via POST /api/agent/sync/save para o servidor de deploy
 *
 * Por que é necessário:
 *   O servidor de deploy (Postgres) pode ter regras antigas corrompidas
 *   (ex.: conta 12 em vez de 444/1112). Este script sobrescreve com os
 *   dados corretos do backup local.
 */

import fs from 'fs';

const backupFile = process.argv[2];
const deployUrl  = (process.argv[3] || 'http://localhost:3000').replace(/\/$/, '');

if (!backupFile) {
  console.error('USO: node scripts/push-dados-locais-deploy.mjs <backup.json> [url-deploy]');
  console.error('EXEMPLO: node scripts/push-dados-locais-deploy.mjs backup.json https://meu-app.onrender.com');
  process.exit(1);
}

if (!fs.existsSync(backupFile)) {
  console.error('❌ Arquivo não encontrado:', backupFile);
  process.exit(1);
}

const backup  = JSON.parse(fs.readFileSync(backupFile, 'utf-8'));
const storage = backup.storage ?? backup; // suporta os dois formatos

const token = storage['gc_company_access_token'] || '';
if (!token) {
  console.error('❌ gc_company_access_token não encontrado no backup. Exporte o backup dentro do app logado.');
  process.exit(1);
}

console.log(`🔑 Token do escritório: ${token}`);
console.log(`🌐 Deploy: ${deployUrl}`);
console.log(`📅 Backup exportado em: ${backup.exportedAt ?? '(desconhecido)'}\n`);

// Coleta todas as chaves de regras e pastas do backup
const extraStorage = {};
let regrasCount = 0;
let pastasCount  = 0;

for (const [key, value] of Object.entries(storage)) {
  if (key.includes('extrato_regras_contas')) {
    extraStorage[key] = value;
    const n = Array.isArray(value) ? value.length : '?';
    console.log(`  📋 Regras: ${key} (${n} regras)`);
    regrasCount++;
  }
  if (key.includes('extrato_pastas_v1')) {
    extraStorage[key] = value;
    const n = Array.isArray(value) ? value.length : '?';
    console.log(`  📁 Pastas: ${key} (${n} pastas)`);
    pastasCount++;
  }
  if (key.includes('extrato_regras_banco')) {
    extraStorage[key] = value;
  }
}

if (regrasCount === 0 && pastasCount === 0) {
  console.error('❌ Nenhuma regra ou pasta encontrada no backup.');
  console.error('   Certifique-se de exportar o backup dentro do app com os dados da empresa correta.');
  process.exit(1);
}

console.log(`\n✅ ${regrasCount} chave(s) de regras + ${pastasCount} chave(s) de pastas encontradas`);

// Monta o payload mínimo — só extra_storage com regras e pastas
const payload = {
  officeToken: token,
  office: {
    extra_storage: extraStorage,
  },
  managers: [],
};

console.log(`\n🚀 Enviando para ${deployUrl}/api/agent/sync/save/${encodeURIComponent(token)} ...`);

const resp = await fetch(`${deployUrl}/api/agent/sync/save/${encodeURIComponent(token)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

let result;
try {
  result = await resp.json();
} catch {
  console.error('❌ Resposta inválida do servidor (status:', resp.status, ')');
  const text = await resp.text().catch(() => '');
  console.error(text.slice(0, 300));
  process.exit(1);
}

if (result.ok || result.message) {
  console.log('\n✅ DADOS ENVIADOS COM SUCESSO!');
  console.log('   Reinicie o deploy para aplicar as novas regras.');
  if (result.message) console.log('  ', result.message);
} else {
  console.error('\n❌ Falha ao enviar:', result);
  process.exit(1);
}
