#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, '.env.production');
const example = path.join(root, '.env.production.example');

function parseEnv(content) {
  const obj = {};
  for (const line of String(content || '').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) obj[m[1]] = m[2] || '';
  }
  return obj;
}

function serializeEnv(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n';
}

function ask(question, opts = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  if (opts.secret) {
    rl._writeToOutput = function _writeToOutput() {
      if (rl.stdoutMuted) rl.output.write('*');
      else rl.output.write(Array.from(arguments).join(''));
    };
  }
  return new Promise((resolve) => {
    if (opts.secret) rl.stdoutMuted = true;
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.info('Interactive production env helper — runs locally and does not transmit secrets anywhere.');
  let base = {};
  if (fs.existsSync(target)) base = parseEnv(fs.readFileSync(target, 'utf8'));
  else if (fs.existsSync(example)) base = parseEnv(fs.readFileSync(example, 'utf8'));

  const values = {};

  values.DATABASE_URL = await ask(`DATABASE_URL [${base.DATABASE_URL || ''}]: `) || base.DATABASE_URL || '';
  values.VITE_AGENT_API_URL = await ask(`VITE_AGENT_API_URL [${base.VITE_AGENT_API_URL || ''}]: `) || base.VITE_AGENT_API_URL || '';
  values.GEMINI_API_KEY = await ask('GEMINI_API_KEY (secret): ', { secret: true }) || base.GEMINI_API_KEY || '';
  values.MINIO_S3_ENDPOINT = await ask(`MINIO_S3_ENDPOINT [${base.MINIO_S3_ENDPOINT || ''}]: `) || base.MINIO_S3_ENDPOINT || '';
  values.MINIO_ACCESS_KEY = await ask('MINIO_ACCESS_KEY (secret): ', { secret: true }) || base.MINIO_ACCESS_KEY || '';
  values.MINIO_SECRET_KEY = await ask('MINIO_SECRET_KEY (secret): ', { secret: true }) || base.MINIO_SECRET_KEY || '';
  values.MINIO_BUCKET = await ask(`MINIO_BUCKET [${base.MINIO_BUCKET || 'eye-vision'}]: `) || base.MINIO_BUCKET || 'eye-vision';
  values.MINIO_REGION = await ask(`MINIO_REGION [${base.MINIO_REGION || 'us-east-1'}]: `) || base.MINIO_REGION || 'us-east-1';
  values.VERCEL_TOKEN = await ask('VERCEL_TOKEN (optional, secret): ', { secret: true }) || base.VERCEL_TOKEN || '';

  // merge with base
  const merged = { ...base, ...values };

  // write .env.production
  fs.writeFileSync(target, serializeEnv(merged), { encoding: 'utf8' });
  console.info('\n.env.production updated at', target);
  console.info('Now run `npm run deploy` to perform the deploy (this will validate values first).');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
