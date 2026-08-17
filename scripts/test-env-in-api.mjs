/**
 * Test — Verificar variáveis de ambiente dentro do agent-api-server
 */
import './production-start-guard.mjs';
import './load-env.mjs';

console.log('\n🔍 VARIÁVEIS DE AMBIENTE APÓS LOAD-ENV:');
console.log('STORAGE_BACKEND:', process.env.STORAGE_BACKEND);
console.log('POSTGRES_HOST:', process.env.POSTGRES_HOST);
console.log('POSTGRES_USER:', process.env.POSTGRES_USER);
console.log('POSTGRES_DB:', process.env.POSTGRES_DB);
console.log('NODE_ENV:', process.env.NODE_ENV);

// Agora testar listAllOffices
import * as workspaceRepo from './storage/workspace-repo.mjs';

(async () => {
  try {
    console.log('\n📋 Testando listAllOffices():');
    const offices = await workspaceRepo.listAllOffices();
    console.log(`✓ Total: ${offices.length}`);
    console.log('Offices:', offices.map(o => o.officeToken).join(', '));
  } catch (err) {
    console.error('❌ ERRO:', err instanceof Error ? err.message : err);
  }
  process.exit(0);
})();
