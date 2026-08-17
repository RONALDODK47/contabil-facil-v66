#!/usr/bin/env node
/**
 * Test — Verifica o que folder-config retorna
 */

import './load-env.mjs';
import fetch from 'node-fetch';
import http from 'node:http';
import express from 'express';
import { registerAgentRoutes } from './agent-api-routes.mjs';

(async () => {
  const app = express();
  const PORT = 8790;

  await registerAgentRoutes(app);

  const server = http.createServer(app);
  
  server.listen(PORT, async () => {
    console.log(`✓ Servidor rodando em http://localhost:${PORT}`);
    
    await new Promise(r => setTimeout(r, 500));

    try {
      console.log('\n📡 Fazendo chamada para /agent/storage/folder-config\n');
      const res = await fetch(`http://localhost:${PORT}/agent/storage/folder-config`);
      const data = await res.json();

      console.log('✓ Resposta recebida:');
      console.log(JSON.stringify(data, null, 2));

    } catch (err) {
      console.error('❌ ERRO:', err instanceof Error ? err.message : err);
    } finally {
      server.close();
      process.exit(0);
    }
  });
})();
