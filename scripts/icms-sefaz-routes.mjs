/**
 * Rotas SEFAZ/CONFAZ — ICMS interestadual e DIFAL (Portal Nacional SVRS).
 * Base legal: Resolução Senado 13/2012 + Convênio ICMS 235/2021.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOGO_PATH = join(__dirname, '../src/contabilfacil/data/icms-uf-aliquotas-v2026.json');

let catalogo = null;

function loadCatalogo() {
  if (!catalogo) {
    catalogo = JSON.parse(readFileSync(CATALOGO_PATH, 'utf8'));
  }
  return catalogo;
}

function normalizarUf(uf) {
  return String(uf ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
}

function getUf(uf) {
  const cat = loadCatalogo();
  return cat.ufs.find((u) => u.uf === normalizarUf(uf)) ?? null;
}

function calcularAliquotaInterestadual(ufOrigem, ufDestino, produtoImportado) {
  const origem = getUf(ufOrigem);
  const destino = getUf(ufDestino);
  if (!origem || !destino) return { aliquota: 0, fundamento: 'UF inválida.' };
  if (origem.uf === destino.uf) {
    return {
      aliquota: origem.aliquotaInterna,
      fundamento: 'Operação interna — aplica alíquota interna do estado.',
    };
  }
  if (produtoImportado) {
    return {
      aliquota: 4,
      fundamento:
        'Resolução do Senado Federal nº 13/2012 — 4% (importado ou conteúdo de importação > 40%).',
    };
  }
  const origemSulSudesteSemEs =
    origem.regiao === 'SUL' || (origem.regiao === 'SUDESTE' && origem.uf !== 'ES');
  const destinoNorteNordesteCoOuEs =
    destino.regiao === 'NORTE' ||
    destino.regiao === 'NORDESTE' ||
    destino.regiao === 'CENTRO-OESTE' ||
    destino.uf === 'ES';
  if (origemSulSudesteSemEs && destinoNorteNordesteCoOuEs) {
    return {
      aliquota: 7,
      fundamento:
        'Resolução do Senado Federal nº 13/2012 — 7% (origem Sul/Sudeste exc. ES → Norte, Nordeste, CO ou ES).',
    };
  }
  return {
    aliquota: 12,
    fundamento:
      'Resolução do Senado Federal nº 13/2012 — 12% (demais operações interestaduais entre contribuintes).',
  };
}

function compararIcms(params) {
  const ufOrigem = normalizarUf(params.ufOrigem);
  const ufDestino = normalizarUf(params.ufDestino);
  const valorBase = Math.max(0, Number(params.valorBase) || 0);
  const produtoImportado = params.produtoImportado === true || params.produtoImportado === '1';
  const consumidorFinal =
    params.consumidorFinalNaoContribuinte !== false &&
    params.consumidorFinal !== '0';

  const origem = getUf(ufOrigem);
  const destino = getUf(ufDestino);
  if (!origem || !destino) {
    throw new Error('Informe UFs válidas (sigla de 2 letras).');
  }

  const { aliquota: aliquotaInterestadual, fundamento: fundamentoInterestadual } =
    calcularAliquotaInterestadual(ufOrigem, ufDestino, produtoImportado);

  const operacaoInterestadual = origem.uf !== destino.uf;
  const diferencaPercentualPontos = operacaoInterestadual
    ? Math.max(0, destino.aliquotaInterna - aliquotaInterestadual)
    : 0;
  const difalAplicavel = operacaoInterestadual && consumidorFinal;
  const difalPercentual = difalAplicavel ? diferencaPercentualPontos : 0;

  const avisos = [];
  if (operacaoInterestadual && !consumidorFinal) {
    avisos.push(
      'Sem DIFAL na simulação: marque consumidor final não contribuinte se aplicável.',
    );
  }

  return {
    ufOrigem: origem.uf,
    ufDestino: destino.uf,
    nomeOrigem: origem.nome,
    nomeDestino: destino.nome,
    operacaoInterestadual,
    aliquotaInternaOrigem: origem.aliquotaInterna,
    aliquotaInternaDestino: destino.aliquotaInterna,
    aliquotaInterestadual,
    diferencaAliquotas: diferencaPercentualPontos,
    diferencaPercentualPontos,
    difalAplicavel,
    difalPercentual,
    valorBase,
    valorIcmsInterestadual: (valorBase * aliquotaInterestadual) / 100,
    valorDifalEstimado: difalAplicavel ? (valorBase * difalPercentual) / 100 : 0,
    custoIcmsExtraEstimado: operacaoInterestadual
      ? (valorBase * diferencaPercentualPontos) / 100
      : 0,
    fundamentoInterestadual,
    fundamentoDifal:
      'Convênio ICMS nº 235/2021 — Portal Nacional da DIFAL (SEFAZ Virtual RS / SVRS).',
    avisos,
    fonteApi: 'sefaz-icms-local',
    catalogoVersao: loadCatalogo().versao,
  };
}

function headUrl(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    try {
      const req = https.request(url, { method: 'HEAD', timeout: timeoutMs }, (res) => {
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    } catch {
      resolve(false);
    }
  });
}

export function registerIcmsSefazRoutes(app) {
  app.get('/sefaz/icms/health', (_req, res) => {
    const cat = loadCatalogo();
    res.json({
      ok: true,
      service: 'sefaz-icms-difal',
      catalogoVersao: cat.versao,
      atualizadoEm: cat.atualizadoEm,
      portalDifalUrl: cat.portalDifalUrl,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/sefaz/icms/catalogo', (_req, res) => {
    res.json(loadCatalogo());
  });

  app.get('/sefaz/icms/comparar', (req, res) => {
    try {
      const result = compararIcms({
        ufOrigem: req.query.ufOrigem,
        ufDestino: req.query.ufDestino,
        valorBase: req.query.valorBase,
        produtoImportado: req.query.produtoImportado,
        consumidorFinal: req.query.consumidorFinal,
        consumidorFinalNaoContribuinte: req.query.consumidorFinal !== '0',
      });
      res.json(result);
    } catch (e) {
      res.status(400).json({ mensagem: e.message || 'Parâmetros inválidos.' });
    }
  });

  app.get('/sefaz/icms/matriz', (req, res) => {
    try {
      const ufOrigem = normalizarUf(req.query.ufOrigem);
      const cat = loadCatalogo();
      const linhas = cat.ufs
        .filter((d) => d.uf !== ufOrigem)
        .map((d) =>
          compararIcms({
            ufOrigem,
            ufDestino: d.uf,
            valorBase: req.query.valorBase ?? 1000,
            produtoImportado: req.query.produtoImportado,
            consumidorFinal: req.query.consumidorFinal ?? '1',
          }),
        );
      res.json({ ufOrigem, linhas });
    } catch (e) {
      res.status(400).json({ mensagem: e.message || 'UF origem inválida.' });
    }
  });

  app.post('/sefaz/icms/sync', async (_req, res) => {
    const cat = loadCatalogo();
    const [svrsPortalAcessivel, confazAcessivel] = await Promise.all([
      headUrl(cat.portalDifalUrl),
      headUrl(cat.confazUrl),
    ]);
    res.json({
      ok: true,
      svrsPortalAcessivel,
      confazAcessivel,
      catalogoVersao: cat.versao,
      atualizadoEm: cat.atualizadoEm,
      mensagem: svrsPortalAcessivel
        ? 'Portais SEFAZ (SVRS/CONFAZ) acessíveis. Alíquotas calculadas conforme Resolução Senado e tabela CONFAZ embutida.'
        : 'Portais externos indisponíveis no momento; cálculo local (CONFAZ + Resolução Senado) permanece ativo.',
      portalDifalUrl: cat.portalDifalUrl,
      confazUrl: cat.confazUrl,
      fonteDados: cat.fontes.join(' · '),
    });
  });
}
