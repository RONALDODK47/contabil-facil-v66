#!/usr/bin/env node
/**
 * Testa o fluxo completo de restauração de offices
 */

import './load-env.mjs';
import * as dockerSync from './storage/docker-sync-manager.mjs';

async function test() {
  try {
    console.log('🔍 Testando fluxo de restauração completo...\n');

    console.log('📋 1. Lendo modo de sincronização:');
    const mode = await dockerSync.readSyncMode();
    console.log('   Modo:', mode.mode);
    console.log('   Pasta local:', mode.localFolderPath);
    console.log();

    console.log('⚙️  2. Ativando modo Docker:');
    const selectRes = await dockerSync.selectDockerMode();
    console.log('   ', selectRes.message);
    console.log();

    console.log('⏳ 3. Restaurando todos os offices do Docker:');
    const result = await dockerSync.restoreAllOfficesFromDocker();
    
    console.log('\n✅ Resultado da restauração:');
    console.log('   OK:', result.ok);
    console.log('   Restaurados:', result.restoreCount || 0);
    
    if (result.offices && result.offices.length > 0) {
      console.log(`\n🎉 ${result.offices.length} EMPRESA(S) RESTAURADA(S):`);
      for (const office of result.offices) {
        console.log(`   • ${office.officeToken}`);
        if (office.managers && office.managers.length > 0) {
          console.log(`     - ${office.managers.length} gerenciador(es)`);
        }
      }
    } else {
      console.log('\n❌ NENHUMA EMPRESA RESTAURADA!');
    }
    
  } catch (err) {
    console.error('\n❌ Erro durante teste:');
    console.error(err instanceof Error ? err.message : String(err));
    if (err instanceof Error) {
      console.error(err.stack);
    }
  }
  
  process.exit(0);
}

test();
