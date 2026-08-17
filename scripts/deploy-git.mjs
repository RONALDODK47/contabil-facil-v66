/**
 * Publica código no GitHub (dispara deploy automático se Vercel/Render estiverem conectados).
 * Uso: npm run deploy:git
 *
 * Preferência: npm run deploy (faz tudo, incluindo build e validações).
 */
import { publishToGit } from './deploy-publish.mjs';

console.info('[deploy:git] Publicando no GitHub…\n');
publishToGit();
console.info('\n[deploy:git] Se Vercel/Render/GitHub Pages estiverem ligados ao repo, o deploy inicia automaticamente.\n');
