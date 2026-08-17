import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const target = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'vendor/gestao-contabil/src/pages/Notices.jsx',
);

let code = fs.readFileSync(target, 'utf8');

const hasImport = /import[\s\S]*?gestaoNativeCard[\s\S]*?GestaoEyeVisionChrome/.test(code);

if (hasImport) {
  console.info('[fix-notices-import] Import já presente.');
  process.exit(0);
}

if (!code.includes('gestaoNativeCard')) {
  console.error('[fix-notices-import] gestaoNativeCard não usado no arquivo.');
  process.exit(1);
}

code = code.replace(
  /gestaoNativeMuted,\s*\n\} from "@\/components\/GestaoEyeVisionChrome";/,
  'gestaoNativeMuted,\n  gestaoNativeCard,\n} from "@/components/GestaoEyeVisionChrome";',
);

fs.writeFileSync(target, code);
console.info('[fix-notices-import] Import gestaoNativeCard adicionado.');
