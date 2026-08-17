/**
 * Test — Simular chamada da API como o frontend faria
 */
import './production-start-guard.mjs';
import './load-env.mjs';
import fetch from 'node-fetch';
import http from 'node:http';
import express from 'express';
import { registerAgentRoutes } from './agent-api-routes.mjs';

(async () => {
  const app = express();
  const PORT = 8790;

  // Registrar as rotas
  await registerAgentRoutes(app);

  // Iniciar servidor
  const server = http.createServer(app);
  
  server.listen(PORT, async () => {
    console.log(`✓ Servidor rodando em http://localhost:${PORT}`);
    
    // Aguardar um pouco para garantir que está pronto
    await new Promise(r => setTimeout(r, 500));

    try {
      console.log('\n📡 Fazendo chamada para /agent/sync/docker/restore-all\n');
      const res = await fetch(`http://localhost:${PORT}/agent/sync/docker/restore-all`);
      const data = await res.json();

      console.log('✓ Resposta recebida:');
      console.log(`  ok: ${data.ok}`);
      console.log(`  restoreCount: ${data.restoreCount}`);
      console.log(`  offices.length: ${data.offices?.length || 0}`);
      
      if (data.offices && data.offices.length > 0) {
        console.log(`\n📊 Total de offices: ${data.offices.length}`);
        data.offices.forEach((o, idx) => {
          console.log(`   [${idx + 1}] ${o.officeToken}`);
        });
      }
      
      // Salvar resposta em arquivo para análise
      await import('node:fs').then(fs => {
        fs.promises.writeFile(
          'debug-api-response.json',
          JSON.stringify(data, null, 2)
        );
      });
      console.log('\n✓ Resposta salva em debug-api-response.json');
    } catch (err) {
      console.error('❌ ERRO:', err instanceof Error ? err.message : err);
    } finally {
      server.close();
      process.exit(0);
    }
  });
})();
