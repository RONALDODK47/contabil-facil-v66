/**
 * Copia contratos/empresas de data/deploy-saved-contracts.json → public/data/saved-contracts-bundle.json
 * (incluído no Firebase Hosting no npm run build / deploy).
 *
 * Antes do deploy: exporte do app ou cole o JSON em data/deploy-saved-contracts.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'data', 'deploy-saved-contracts.json');
const OUT_DIRS = [
  path.join(ROOT, 'public', 'data'),
  path.join(ROOT, 'src', 'data'),
];

function normalizeBundle(raw) {
  const contracts = Array.isArray(raw?.contracts) ? raw.contracts : [];
  const companies = Array.isArray(raw?.companies) ? raw.companies : [];
  return {
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    contracts,
    companies,
  };
}

function main() {
  let body = { updatedAt: new Date().toISOString(), contracts: [], companies: [] };

  if (fs.existsSync(SOURCE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
      body = normalizeBundle(raw);
      console.log(
        `[contracts:bundle] Fonte: data/deploy-saved-contracts.json — ${body.contracts.length} contrato(s), ${body.companies.length} empresa(s).`,
      );
    } catch (e) {
      console.warn('[contracts:bundle] deploy-saved-contracts.json inválido; mantendo destino anterior.', e);
      if (OUT_DIRS.some((dir) => fs.existsSync(path.join(dir, 'saved-contracts-bundle.json')))) {
        process.exit(0);
      }
    }
  } else if (OUT_DIRS.some((dir) => fs.existsSync(path.join(dir, 'saved-contracts-bundle.json')))) {
    console.info('[contracts:bundle] Sem data/deploy-saved-contracts.json; mantendo pacote existente.');
    process.exit(0);
  } else {
    console.info('[contracts:bundle] Criando pacote vazio em public/data/ e src/data/.');
  }

  for (const OUT_DIR of OUT_DIRS) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'saved-contracts-bundle.json'), JSON.stringify(body, null, 2), 'utf8');
  }
  console.log('[contracts:bundle] Gravado: public/data/ e src/data/saved-contracts-bundle.json');
}

main();
