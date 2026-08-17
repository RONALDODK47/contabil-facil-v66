/**
 * Baixa séries BCB para o bundle offline (Firebase / deploy sem proxy).
 * Rode antes do build: npm run bcb:download
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIRS = [
  path.join(__dirname, '..', 'public', 'data'),
  path.join(__dirname, '..', 'src', 'data'),
];
const BCB = 'https://api.bcb.gov.br';

function formatBcbDate(d) {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${d.getFullYear()}`;
}

function bcbRowToIso(dataStr) {
  const parts = String(dataStr).trim().split('/');
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts;
  const y = yyyy.length === 2 ? `20${yyyy}` : yyyy;
  return `${y}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchSerieOnce(serieCode, dataInicial, dataFinal, attempt = 0) {
  const di = formatBcbDate(dataInicial);
  const df = formatBcbDate(dataFinal);
  const url = `${BCB}/dados/serie/bcdata.sgs.${serieCode}/dados?formato=json&dataInicial=${encodeURIComponent(di)}&dataFinal=${encodeURIComponent(df)}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) return [];
    if (attempt < 3 && [502, 503, 429, 408].includes(res.status)) {
      await sleep(800 * (attempt + 1));
      return fetchSerieOnce(serieCode, dataInicial, dataFinal, attempt + 1);
    }
    throw new Error(`BCB série ${serieCode} HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`BCB série ${serieCode} JSON inválido`);
  return data;
}

/** BCB costuma falhar em intervalos muito longos — baixa ano a ano. */
async function fetchSerie(serieCode, dataInicial, dataFinal) {
  const all = [];
  let year = dataInicial.getFullYear();
  const endYear = dataFinal.getFullYear();
  while (year <= endYear) {
    const chunkStart = new Date(Math.max(dataInicial.getTime(), new Date(year, 0, 1).getTime()));
    const chunkEnd = new Date(Math.min(dataFinal.getTime(), new Date(year, 11, 31).getTime()));
    console.log(`  … ${serieCode} ${formatBcbDate(chunkStart)} → ${formatBcbDate(chunkEnd)}`);
    const chunk = await fetchSerieOnce(serieCode, chunkStart, chunkEnd);
    all.push(...chunk);
    year += 1;
    await sleep(350);
  }
  return all;
}

function parseSerie11Rows(rows) {
  const points = [];
  for (const row of rows) {
    const iso = bcbRowToIso(row.data);
    const n =
      typeof row.valor === 'number'
        ? row.valor
        : parseFloat(String(row.valor ?? '').replace(/\s/g, '').replace(',', '.'));
    if (!iso || !Number.isFinite(n)) continue;
    points.push({ date: iso, annualRatePct: n });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  return points;
}

function parseMonthlyRows(rows) {
  const points = [];
  for (const row of rows) {
    const iso = bcbRowToIso(row.data);
    const n =
      typeof row.valor === 'number'
        ? row.valor
        : parseFloat(String(row.valor ?? '').replace(/\s/g, '').replace(',', '.'));
    if (!iso || !Number.isFinite(n)) continue;
    points.push({ month: iso.slice(0, 7), ratePct: n, date: iso });
  }
  points.sort((a, b) => a.month.localeCompare(b.month));
  return points;
}

async function main() {
  const allExist = OUT_DIRS.every((dir) => {
    return fs.existsSync(path.join(dir, 'bcb-serie11-bundle.json')) &&
           fs.existsSync(path.join(dir, 'bcb-monthly-bundle.json'));
  });

  if (allExist) {
    console.log('[bcb:download] Arquivos do BCB já existem localmente. Pulando download para acelerar o build.');
    return;
  }

  const start = new Date(2020, 0, 1);
  const end = new Date();

  console.log('[bcb:download] Série 11 (Selic Over)…', formatBcbDate(start), '→', formatBcbDate(end));
  const raw11 = await fetchSerie(11, start, end);
  const serie11 = {
    updatedAt: new Date().toISOString(),
    serie: 11,
    points: parseSerie11Rows(raw11),
  };
  console.log('[bcb:download] Série 11:', serie11.points.length, 'cotações');

  console.log('[bcb:download] Séries mensais 4390 / 4391…');
  const [raw4390, raw4391] = await Promise.all([
    fetchSerie(4390, start, end),
    fetchSerie(4391, start, end),
  ]);
  const monthly = {
    updatedAt: new Date().toISOString(),
    bySerie: {
      '4390': parseMonthlyRows(raw4390),
      '4391': parseMonthlyRows(raw4391),
    },
  };

  for (const OUT_DIR of OUT_DIRS) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUT_DIR, 'bcb-serie11-bundle.json'),
      JSON.stringify(serie11),
      'utf8',
    );
    fs.writeFileSync(
      path.join(OUT_DIR, 'bcb-monthly-bundle.json'),
      JSON.stringify(monthly),
      'utf8',
    );
  }
  console.log('[bcb:download] Gravado em public/data/ e src/data/');
}

main().catch((e) => {
  const has11 = OUT_DIRS.some((dir) => fs.existsSync(path.join(dir, 'bcb-serie11-bundle.json')));
  const hasMo = OUT_DIRS.some((dir) => fs.existsSync(path.join(dir, 'bcb-monthly-bundle.json')));
  if (has11 && hasMo) {
    console.warn('[bcb:download] API indisponível; mantendo pacote já existente em public/data/.');
    process.exit(0);
  }
  console.error('[bcb:download] Falhou:', e);
  process.exit(1);
});
