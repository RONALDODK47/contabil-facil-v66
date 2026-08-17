/**
 * API local fiscal/contábil
 * - GET /health, GET /sped/health
 * - POST /sped/download (EFD Contribuições + ICMS via certificado / Integra Contador / gateway)
 * - GET/POST /receita-federal/*, GET/POST /sefaz/icms/*
 *
 * SPED / Receita (variáveis de ambiente):
 * - INTEGRA_CONTADOR_CLIENT_ID, INTEGRA_CONTADOR_CLIENT_SECRET
 * - INTEGRA_CONTADOR_CONTRATANTE_CNPJ (CNPJ do software house)
 * - SPED_CONTRIB_ENDPOINT, SPED_ICMS_ENDPOINT (URL HTTPS com mTLS do certificado A1)
 * - SPED_CONTRIB_ID_SISTEMA, SPED_CONTRIB_ID_SERVICO (Integra Contador, se contratado)
 * - SPED_ICMS_ID_SISTEMA, SPED_ICMS_ID_SERVICO
 */
import express from 'express';
import https from 'node:https';
import path from 'node:path';
import tls from 'node:tls';
import { pathToFileURL } from 'node:url';
import multer from 'multer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, inflateRawSync, inflateSync } from 'node:zlib';
import {
  buildStoreFromSync,
  consultarCnpjBrasilApi,
  detectImpostoKey,
  encontrarRegra,
  loadCatalogoReceitaFederal,
} from './receita-federal-regras.mjs';
import { registerIcmsSefazRoutes } from './icms-sefaz-routes.mjs';
import { baixarSpedViaPython, pingDocDownloader } from './doc-downloader-bridge.mjs';
import { consultarNfeDistDfeSefaz, resolveCnpjForDistDfe } from './nfe-dist-dfe-sefaz.mjs';
import { aggregateNfeParseResults, parseNfeXmlString } from './nfe-xml-parse.mjs';

const app = express();
const PORT = Number(process.env.FISCAL_NFE_PORT || 8780);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const uploadMany = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 80 } });
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

app.use(express.json({ limit: '2mb' }));

/** Evita crash do servidor quando POST chega sem multipart (ex.: teste manual, proxy). */
function multipartUpload(uploadMiddleware) {
  return (req, res, next) => {
    const ct = String(req.headers['content-type'] ?? '').toLowerCase();
    if (!ct.includes('multipart/form-data')) {
      return res.status(400).json({
        mensagem:
          'Esta rota exige multipart/form-data (certificado .pfx e campos). Use o botão da aplicação, não JSON puro.',
      });
    }
    uploadMiddleware(req, res, (err) => {
      if (err) {
        const msg = err.message?.includes('Boundary')
          ? 'Formulário inválido: selecione o certificado e envie novamente.'
          : err.message || 'Falha ao processar upload.';
        return res.status(400).json({ mensagem: msg });
      }
      next();
    });
  };
}

app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'fiscal-api',
    spedMode: resolveSpedModeLabel(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/sped/health', async (_req, res) => {
  const python = await pingDocDownloader();
  res.status(200).json({
    ok: true,
    service: 'sped-receita-api',
    mode: resolveSpedModeLabel(),
    docDownloaderPython: python,
    timestamp: new Date().toISOString(),
  });
});

app.get('/doc-downloader/health', async (_req, res) => {
  const online = await pingDocDownloader();
  res.status(200).json({
    ok: online,
    service: 'doc-downloader',
    engine: 'python',
    url: process.env.DOC_DOWNLOADER_URL || 'http://127.0.0.1:8766',
    timestamp: new Date().toISOString(),
  });
});

registerIcmsSefazRoutes(app);

app.post('/sped/download', multipartUpload(upload.single('certificadoA1')), async (req, res) => {
  try {
    const body = req.body ?? {};
    const cnpj = String(body.cnpj ?? '').replace(/\D/g, '');
    const autorCnpj = String(body.autorCnpj ?? cnpj).replace(/\D/g, '');
    const uf = String(body.uf ?? 'SP').trim().toUpperCase();
    const ambiente = String(body.ambiente ?? 'producao') === 'homologacao' ? 'homologacao' : 'producao';
    const senhaCertificado = String(body.senhaCertificado ?? '');
    const dataInicio = String(body.dataInicio ?? '').trim();
    const dataFim = String(body.dataFim ?? '').trim();
    const legacyCompetencia = String(body.competencia ?? '').trim();
    const cert = req.file;

    if (cnpj.length !== 14) {
      return res.status(400).json({ mensagem: 'CNPJ da empresa inválido (14 dígitos).' });
    }
    if (!cert?.buffer?.length) {
      return res.status(400).json({ mensagem: 'Certificado A1 (.pfx/.p12) não informado.' });
    }
    if (!senhaCertificado.trim()) {
      return res.status(400).json({ mensagem: 'Senha do certificado não informada.' });
    }

    let competencias = listarCompetenciasPeriodo(dataInicio, dataFim);
    if (!competencias.length && /^\d{4}-\d{2}$/.test(legacyCompetencia)) {
      const [yyyy, mm] = legacyCompetencia.split('-');
      const lastDay = new Date(Number(yyyy), Number(mm), 0).getDate();
      competencias = [
        {
          perApur: legacyCompetencia,
          referencia: `01/${mm}/${yyyy}`,
          isoInicio: `${legacyCompetencia}-01`,
          isoFim: `${legacyCompetencia}-${String(lastDay).padStart(2, '0')}`,
        },
      ];
    }
    if (!competencias.length) {
      return res.status(400).json({
        mensagem: 'Informe data início e data fim do período (mesmo modelo da aba Folha: campos de data).',
      });
    }

    const senha = senhaCertificado.trim();
    validarCertificadoA1({ pfx: cert.buffer, passphrase: senha });

    const arquivos = [];
    const logs = [];
    const seen = new Set();
    const perApurLista = competencias.map((c) => c.perApur);

    const registrarArquivo = (arq, origem) => {
      if (!arq?.content) return;
      const key = `${arq.tipo}:${arq.competencia || ''}:${arq.content.length}:${arq.content.slice(0, 80)}`;
      if (seen.has(key)) return;
      seen.add(key);
      arquivos.push(arq);
      logs.push(`${arq.tipo === 'ICMS_IPI' ? 'ICMS/IPI' : 'Contribuições'} ${arq.competencia || ''}: ${arq.fileName} (${origem}).`.trim());
    };

    const ctxSped = { cnpj, uf, ambiente, dataInicio, dataFim, competencias: perApurLista, pfx: cert.buffer, passphrase: senha };

    for (const comp of competencias) {
      const contribCustom = await baixarSpedEndpointCustom({
        ...ctxSped,
        tipo: 'CONTRIBUICOES',
        url: process.env.SPED_CONTRIB_ENDPOINT,
        competencia: comp.perApur,
      });
      registrarArquivo(contribCustom, 'gateway');

      const icmsCustom = await baixarSpedEndpointCustom({
        ...ctxSped,
        tipo: 'ICMS_IPI',
        url: process.env.SPED_ICMS_ENDPOINT,
        competencia: comp.perApur,
      });
      registrarArquivo(icmsCustom, 'gateway');
    }

    const temContrib = () => arquivos.some((a) => a.tipo === 'CONTRIBUICOES');
    const temIcms = () => arquivos.some((a) => a.tipo === 'ICMS_IPI');

    if (process.env.INTEGRA_CONTADOR_CLIENT_ID && process.env.INTEGRA_CONTADOR_CLIENT_SECRET) {
      for (const comp of competencias) {
        if (!temContrib()) {
          const contribIntegra = await baixarSpedIntegraContador({
            tipo: 'CONTRIBUICOES',
            cnpj,
            autorCnpj,
            competencia: comp.perApur,
            idSistema: process.env.SPED_CONTRIB_ID_SISTEMA || process.env.INTEGRA_SPED_CONTRIB_ID_SISTEMA || '',
            idServico: process.env.SPED_CONTRIB_ID_SERVICO || process.env.INTEGRA_SPED_CONTRIB_ID_SERVICO || '',
            dadosJson: { cnpj, competencia: comp.perApur, uf, dataInicio, dataFim },
          });
          if (contribIntegra) {
            contribIntegra.competencia = comp.perApur;
            registrarArquivo(contribIntegra, 'Integra Contador');
          }
        }
        if (!temIcms()) {
          const icmsIntegra = await baixarSpedIntegraContador({
            tipo: 'ICMS_IPI',
            cnpj,
            autorCnpj,
            competencia: comp.perApur,
            idSistema: process.env.SPED_ICMS_ID_SISTEMA || process.env.INTEGRA_SPED_ICMS_ID_SISTEMA || '',
            idServico: process.env.SPED_ICMS_ID_SERVICO || process.env.INTEGRA_SPED_ICMS_ID_SERVICO || '',
            dadosJson: { cnpj, competencia: comp.perApur, uf, dataInicio, dataFim },
          });
          if (icmsIntegra) {
            icmsIntegra.competencia = comp.perApur;
            registrarArquivo(icmsIntegra, 'Integra Contador');
          }
        }
      }
    }

    const mode = resolveSpedModeLabel();
    if (arquivos.length === 0) {
      const periodoBr = `${toBrDate(dataInicio) || dataInicio} a ${toBrDate(dataFim) || dataFim}`;
      const msgNaoConfig =
        `Certificado A1 validado. A API local não tem conexão automática com a Receita para SPED (modo: não configurado). ` +
        `Use o botão "Carregar TXT da pasta" com os arquivos .txt da EFD-Contribuições e da EFD ICMS/IPI (exportados do PGD, domínio ou e-CAC). ` +
        `Para baixar pelo certificado aqui, configure Integra Contador (Serpro) ou as variáveis SPED_CONTRIB_ENDPOINT e SPED_ICMS_ENDPOINT antes de iniciar a API. Período: ${periodoBr} (${competencias.length} competência(s)).`;
      const msgGateway =
        `Certificado A1 validado. Nenhum TXT de SPED retornado no período ${periodoBr} (${competencias.length} competência(s)). Verifique transmissão no PGD/e-CAC ou importe os .txt manualmente.`;
      return res.status(200).json({
        mensagem: mode === 'nao_configurado' ? msgNaoConfig : msgGateway,
        mode: mode === 'nao_configurado' ? 'certificado_ok_sem_gateway' : mode,
        arquivos: [],
        certificadoOk: true,
        meta: { competencias: competencias.length },
      });
    }

    return res.status(200).json({
      mensagem:
        (logs.join(' ') || 'SPED obtido com sucesso.') +
        ` Período: ${competencias.length} competência(s) (${perApurLista[0]} a ${perApurLista[perApurLista.length - 1]}).`,
      mode,
      arquivos,
      certificadoOk: true,
      meta: { competencias: competencias.length },
    });
  } catch (error) {
    return res.status(500).json({ mensagem: mapErroCertificadoOuSefaz(error) });
  }
});

/** Regras contábeis/fiscais alinhadas à Receita Federal (catálogo + consulta CNPJ). */
app.get('/receita-federal/health', (_req, res) => {
  const catalogo = loadCatalogoReceitaFederal();
  res.status(200).json({
    ok: true,
    service: 'receita-federal-regras',
    versao: catalogo.versao,
    totalRegras: catalogo.regras?.length ?? 0,
    calculadoraRfUrl: process.env.RECEITA_CALCULADORA_URL || null,
    timestamp: new Date().toISOString(),
  });
});

app.get('/receita-federal/catalogo', (_req, res) => {
  res.status(200).json(loadCatalogoReceitaFederal());
});

app.post('/receita-federal/sync', async (req, res) => {
  try {
    const body = req.body ?? {};
    const cnpj = String(body.cnpj ?? '').replace(/\D/g, '');
    const uf = String(body.uf ?? '').toUpperCase();
    const municipio = String(body.municipio ?? '').trim();

    if (cnpj.length !== 14) {
      return res.status(400).json({ mensagem: 'CNPJ inválido (14 dígitos) para sincronizar regras RF.' });
    }

    const catalogo = loadCatalogoReceitaFederal();
    let cnpjData = null;
    try {
      cnpjData = await consultarCnpjBrasilApi(cnpj);
    } catch {
      // segue com catálogo base
    }

    const store = buildStoreFromSync({ catalogo, cnpjData, uf, municipio });
    const regime = store.empresaMeta?.regimeTributario ?? 'não identificado';

    return res.status(200).json({
      mensagem: cnpjData
        ? `Regras RF sincronizadas para ${store.empresaMeta?.razaoSocial ?? cnpj}. Regime: ${regime}. ${store.regras.length} regra(s) ativas.`
        : `Catálogo RF carregado (${store.regras.length} regras). Consulta CNPJ indisponível — usando apenas regras base.`,
      store,
      empresaMeta: store.empresaMeta,
    });
  } catch (error) {
    return res.status(500).json({
      mensagem: error instanceof Error ? error.message : 'Falha na sincronização RF.',
    });
  }
});

app.post('/receita-federal/sugerir-lancamento', (req, res) => {
  const body = req.body ?? {};
  const linhaNome = String(body.linhaNome ?? '');
  const origem = body.origem === 'folha' ? 'folha' : 'fiscal';
  const debito = Number(body.debito) || 0;
  const credito = Number(body.credito) || 0;
  const catalogo = loadCatalogoReceitaFederal();
  const regra = encontrarRegra(linhaNome, catalogo, origem);
  const impostoKey = detectImpostoKey(linhaNome);

  if (!regra) {
    return res.status(200).json({
      regra: null,
      impostoKey,
      mensagem: 'Nenhuma regra RF específica — use heurística do plano de contas.',
    });
  }

  const mapLado = (papel) => {
    if (papel === 'despesa_tributaria' || papel === 'despesa_encargo' || papel === 'despesa_folha') {
      return 'D — despesa / encargo (grupo 4)';
    }
    if (papel === 'conta_imposto' || papel === 'conta_folha' || papel === 'conta_alvo') {
      return 'C — passivo / conta alvo (grupo 2)';
    }
    return 'contrapartida';
  };

  const tpl = credito >= 0.05 && debito < 0.05 ? regra.lancamentoCreditoLinha : regra.lancamentoDebitoLinha;
  const historicoSugerido = `[RF ${regra.id}] ${linhaNome}`.slice(0, 120);

  return res.status(200).json({
    regra,
    impostoKey: regra.impostoKey ?? impostoKey,
    fundamentoLegal: regra.fundamentoLegal,
    historicoSugerido,
    ladoDebito: tpl ? mapLado(tpl.debito) : undefined,
    ladoCredito: tpl ? mapLado(tpl.credito) : undefined,
  });
});

function resolveSpedModeLabel() {
  if (process.env.SPED_CONTRIB_ENDPOINT || process.env.SPED_ICMS_ENDPOINT) {
    return 'gateway_corporativo';
  }
  if (process.env.INTEGRA_CONTADOR_CLIENT_ID && process.env.INTEGRA_CONTADOR_CLIENT_SECRET) {
    return 'integra_contador';
  }
  return 'nao_configurado';
}

async function baixarSpedEndpointCustom({
  tipo,
  url,
  cnpj,
  uf,
  ambiente,
  competencia,
  dataInicio,
  dataFim,
  competencias,
  pfx,
  passphrase,
}) {
  if (!url?.trim()) return null;

  const viaPython = await baixarSpedViaPython({
    tipo,
    url,
    cnpj,
    uf,
    ambiente,
    competencia,
    dataInicio,
    dataFim,
    competencias,
    pfx,
    passphrase,
  });
  if (viaPython) return viaPython;

  const payload = JSON.stringify({
    tipo,
    cnpj,
    uf,
    ambiente,
    competencia,
    dataInicio,
    dataFim,
    competencias,
    pedido: competencias?.length ? 'sped_periodo' : competencia ? 'sped_competencia' : 'ultimo_transmitido',
  });
  const text = await postHttpsWithCertificate({
    url: url.trim(),
    pfx,
    passphrase,
    contentType: 'application/json; charset=utf-8',
    body: payload,
  });
  const arq = extrairArquivoSpedResposta(text, tipo);
  if (arq && competencia) {
    arq.competencia = competencia;
    const stem = (arq.fileName || `${tipo}.txt`).replace(/\.txt$/i, '');
    if (!stem.includes(competencia)) {
      arq.fileName = `${stem}-${competencia}.txt`;
    }
  }
  return arq;
}

async function baixarSpedIntegraContador({ tipo, cnpj, autorCnpj, competencia, idSistema, idServico, dadosJson }) {
  if (!idSistema?.trim() || !idServico?.trim()) return null;
  const contratante = String(process.env.INTEGRA_CONTADOR_CONTRATANTE_CNPJ ?? autorCnpj).replace(/\D/g, '');
  if (contratante.length !== 14) return null;

  const token = await obterTokenIntegraContador();
  const base =
    process.env.INTEGRA_CONTADOR_BASE_URL?.replace(/\/$/, '') ||
    'https://gateway.apiserpro.serpro.gov.br/integra-contador/v1';
  const pathConsultar = process.env.INTEGRA_CONTADOR_PATH_CONSULTAR || '/Consultar';

  const pedido = {
    contratante: { numero: contratante, tipo: 2 },
    autorPedidoDados: { numero: autorCnpj, tipo: 2 },
    contribuinte: { numero: cnpj, tipo: 2 },
    pedidoDados: {
      idSistema: idSistema.trim(),
      idServico: idServico.trim(),
      versaoSistema: '1.0',
      dados: JSON.stringify({ ...dadosJson, competencia, tipo }),
    },
  };

  const responseText = await postJsonBearer({
    url: `${base}${pathConsultar}`,
    token,
    json: pedido,
  });
  return extrairArquivoSpedResposta(responseText, tipo);
}

function obterTokenIntegraContador() {
  const clientId = process.env.INTEGRA_CONTADOR_CLIENT_ID;
  const clientSecret = process.env.INTEGRA_CONTADOR_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return Promise.reject(new Error('Credenciais Integra Contador não configuradas.'));
  }
  const tokenUrl =
    process.env.INTEGRA_CONTADOR_TOKEN_URL || 'https://gateway.apiserpro.serpro.gov.br/token';
  const body = 'grant_type=client_credentials';
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  return new Promise((resolve, reject) => {
    const target = new URL(tokenUrl);
    const req = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Integra Contador token HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
            return;
          }
          try {
            const parsed = JSON.parse(text);
            if (!parsed.access_token) {
              reject(new Error('Token Integra Contador sem access_token.'));
              return;
            }
            resolve(parsed.access_token);
          } catch {
            reject(new Error('Resposta inválida ao obter token Integra Contador.'));
          }
        });
      },
    );
    req.on('error', (err) => reject(new Error(`Erro ao obter token Integra: ${err.message}`)));
    req.write(body);
    req.end();
  });
}

function postJsonBearer({ url, token, json }) {
  const body = JSON.stringify(json);
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Integra Contador HTTP ${res.statusCode}: ${text.slice(0, 300)}`));
            return;
          }
          resolve(text);
        });
      },
    );
    req.on('error', (err) => reject(new Error(`Erro Integra Contador: ${err.message}`)));
    req.write(body);
    req.end();
  });
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

function postHttpsWithCertificate({ url, pfx, passphrase, contentType, body }) {
  const timeoutMs = Number(process.env.FOLHA_GATEWAY_TIMEOUT_MS || 60_000);
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method: 'POST',
        pfx,
        passphrase,
        rejectUnauthorized: true,
        headers: {
          'Content-Type': contentType,
          Accept: 'application/json, text/plain, */*',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Gateway SPED HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
            return;
          }
          resolve(text);
        });
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Gateway folha não respondeu em ${Math.round(timeoutMs / 1000)}s.`));
    });
    req.on('error', (err) => reject(new Error(`Erro TLS gateway SPED: ${err.message}`)));
    req.write(body);
    req.end();
  });
}

function extrairArquivoSpedResposta(raw, tipoFallback) {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();

  if (trimmed.startsWith('|') && trimmed.includes('|0000|')) {
    return {
      tipo: tipoFallback,
      fileName: tipoFallback === 'CONTRIBUICOES' ? 'efd-contribuicoes.txt' : 'efd-icms.txt',
      content: trimmed,
    };
  }

  try {
    const json = JSON.parse(trimmed);
    const content =
      json.content ??
      json.conteudo ??
      json.txt ??
      json.arquivo ??
      (json.data?.content ?? json.dados?.conteudo);
    if (typeof content === 'string' && content.includes('|0000|')) {
      return {
        tipo: json.tipo ?? tipoFallback,
        fileName: json.fileName ?? json.nome ?? `${tipoFallback}.txt`,
        content: content.startsWith('data:') ? Buffer.from(content.split(',')[1] || '', 'base64').toString('utf8') : content,
      };
    }
    if (typeof json.conteudoBase64 === 'string') {
      const decoded = Buffer.from(json.conteudoBase64, 'base64').toString('utf8');
      if (decoded.includes('|0000|')) {
        return {
          tipo: json.tipo ?? tipoFallback,
          fileName: json.fileName ?? `${tipoFallback}.txt`,
          content: decoded,
        };
      }
    }
  } catch {
    // não é JSON
  }

  return null;
}

app.post('/sefaz/nfe/distribuicao', multipartUpload(upload.single('certificadoA1')), async (req, res) => {
  try {
    const body = req.body ?? {};
    const cnpj = String(body.cnpj ?? '').replace(/\D/g, '');
    const uf = String(body.uf ?? 'SP').trim().toUpperCase();
    const ambiente = String(body.ambiente ?? 'producao') === 'homologacao' ? 'homologacao' : 'producao';
    const tpAmb = ambiente === 'homologacao' ? '2' : '1';
    const senhaCertificado = String(body.senhaCertificado ?? '');
    const dataInicio = String(body.dataInicio ?? '').trim();
    const dataFim = String(body.dataFim ?? '').trim();
    const ultNSUInicial = String(body.ultNSU ?? body.ultNSUInicial ?? '0').replace(/\D/g, '') || '0';
    const manifestarCiencia = String(body.manifestarCiencia ?? 'true').toLowerCase() !== 'false';
    const cert = req.file;

    if (!cert?.buffer?.length) {
      return res.status(400).json({ ok: false, mensagem: 'Certificado A1 (.pfx) obrigatório.' });
    }
    if (!senhaCertificado.trim()) {
      return res.status(400).json({ ok: false, mensagem: 'Senha do certificado obrigatória.' });
    }

    const senha = senhaCertificado.trim();
    validarCertificadoA1({ pfx: cert.buffer, passphrase: senha });

    const { cnpj: cnpjConsulta, aviso: avisoCnpj } = resolveCnpjForDistDfe({
      pfx: cert.buffer,
      passphrase: senha,
      cnpjInformado: cnpj,
    });

    if (cnpjConsulta.length !== 14) {
      return res.status(400).json({
        ok: false,
        mensagem: 'Informe o CNPJ (14 dígitos) ou use um certificado A1 de pessoa jurídica válido.',
      });
    }

    const resultado = await consultarNfeDistDfeSefaz({
      pfx: cert.buffer,
      passphrase: senha,
      cnpj: cnpjConsulta,
      uf,
      tpAmb,
      dataInicio,
      dataFim,
      ultNSUInicial,
      manifestarCiencia,
    });

    if (!resultado.ok) {
      return res.status(200).json({
        ok: false,
        mensagem: mapErroCertificadoOuSefaz(new Error(resultado.mensagem)),
        notas: [],
        itensEstoque: [],
        creditosSugeridos: [],
      });
    }

    const { notas, itensEstoque, creditosSugeridos, ultNSU, maxNSU, manifestados, incompleto } = resultado;
    const avisos = [...(resultado.avisos ?? [])];
    if (avisoCnpj) avisos.push(avisoCnpj);
    // Distribuição DF-e pagina por NSU, não por data — um período longo (>1 mês) pode ter mais
    // notas do que cabe no limite de páginas por consulta. Isso não é um erro; avisa o usuário
    // para clicar em Buscar de novo (após o intervalo) em vez de deixá-lo achar que travou.
    const sufixoIncompleto = incompleto
      ? ' Ainda há mais NF-e disponíveis na SEFAZ para este período — aguarde o intervalo e clique em Buscar novamente para continuar de onde parou.'
      : '';

    if (!notas.length && !creditosSugeridos.length) {
      const prefixo = avisos.length ? `${avisos.join(' ')} ` : '';
      return res.status(200).json({
        ok: true,
        mensagem: `${prefixo}SEFAZ consultada — nenhuma NFe nova no período.${sufixoIncompleto}`,
        notas: [],
        itensEstoque: [],
        creditosSugeridos: [],
        ultNSU,
        maxNSU,
        manifestados: manifestados ?? 0,
        incompleto: !!incompleto,
        fonte: 'sefaz_distdfe',
      });
    }

    const prefixo = avisos.length ? `${avisos.join(' ')} ` : '';
    const manifestoTxt =
      manifestados > 0 ? ` · ${manifestados} manifesto(s) ciência` : '';
    return res.status(200).json({
      ok: true,
      mensagem: `${prefixo}${notas.length} nota(s) · ${creditosSugeridos.length} crédito(s) sugerido(s)${manifestoTxt}.${sufixoIncompleto}`,
      notas,
      itensEstoque,
      creditosSugeridos,
      ultNSU,
      maxNSU,
      manifestados: manifestados ?? 0,
      incompleto: !!incompleto,
      fonte: 'sefaz_distdfe',
    });
  } catch (err) {
    return res.status(200).json({
      ok: false,
      mensagem: mapErroCertificadoOuSefaz(err),
      notas: [],
      itensEstoque: [],
      creditosSugeridos: [],
    });
  }
});

/** Importa NF-e a partir de arquivos XML (pasta do emissor, e-mail, portal SEFAZ). */
app.post(
  '/sefaz/nfe/importar-xml',
  multipartUpload(uploadMany.array('arquivos', 80)),
  async (req, res) => {
    try {
      const body = req.body ?? {};
      const dataInicio = String(body.dataInicio ?? '').trim();
      const dataFim = String(body.dataFim ?? '').trim();
      const files = Array.isArray(req.files) ? req.files : req.file ? [req.file] : [];

      if (!files.length) {
        return res.status(400).json({ ok: false, mensagem: 'Selecione um ou mais arquivos .xml de NF-e.' });
      }

      const parsedList = [];
      const ignorados = [];

      for (const file of files) {
        const name = String(file.originalname ?? 'nota.xml');
        const lower = name.toLowerCase();
        if (!lower.endsWith('.xml')) {
          ignorados.push(name);
          continue;
        }
        const xml = file.buffer?.toString('utf8') ?? '';
        const parsed = parseNfeXmlString(xml, { dataInicio, dataFim });
        if (parsed) parsedList.push(parsed);
        else ignorados.push(name);
      }

      const { notas, itensEstoque, creditosSugeridos } = aggregateNfeParseResults(parsedList);

      if (!notas.length) {
        return res.status(200).json({
          ok: false,
          mensagem:
            ignorados.length === files.length
              ? 'Nenhum XML válido de NF-e encontrado. Use arquivos nfeProc (autorizados) exportados do portal ou do emissor.'
              : 'Nenhuma nota no período informado.',
          notas: [],
          itensEstoque: [],
          creditosSugeridos: [],
          ignorados,
        });
      }

      return res.status(200).json({
        ok: true,
        mensagem: `${notas.length} nota(s) importada(s) de ${files.length} arquivo(s).`,
        notas,
        itensEstoque,
        creditosSugeridos,
        fonte: 'xml_upload',
        ignorados: ignorados.length ? ignorados : undefined,
      });
    } catch (err) {
      return res.status(200).json({
        ok: false,
        mensagem: err instanceof Error ? err.message : 'Falha ao importar XMLs.',
        notas: [],
        itensEstoque: [],
        creditosSugeridos: [],
      });
    }
  },
);

app.use((err, _req, res, _next) => {
  console.error('[fiscal-nfe-api]', err);
  if (!res.headersSent) {
    res.status(500).json({
      mensagem: err instanceof Error ? err.message : 'Erro interno na API fiscal.',
    });
  }
});

/** Exportado para montar no agent-api (Render) sob `/api/fiscal-nfe`. */
export { app as fiscalNfeApp };

function isFiscalApiCliEntry() {
  try {
    const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
    if (!entry) return false;
    return pathToFileURL(entry).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isFiscalApiCliEntry() || process.env.FISCAL_NFE_STANDALONE === '1') {
  const HOST = process.env.FISCAL_NFE_HOST || '127.0.0.1';
  const server = app.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`[fiscal-nfe-api] online em http://${HOST}:${PORT} (SPED: ${resolveSpedModeLabel()})`);
  });
  server.on('error', (err) => {
    if (err?.code === 'EADDRINUSE') {
      console.warn(`[fiscal-nfe-api] Porta ${PORT} já estava em uso por outra instância ativa.`);
      process.exit(0);
    } else {
      console.error('[fiscal-nfe-api] Falha ao subir:', err?.message || err);
      process.exit(1);
    }
  });
}

function validarCertificadoA1({ pfx, passphrase }) {
  try {
    tls.createSecureContext({ pfx, passphrase });
  } catch (err) {
    const msg = String(err?.message ?? err ?? '').toLowerCase();
    if (msg.includes('mac verify failure') || msg.includes('mac') || msg.includes('pkcs12')) {
      throw new Error(
        'Falha na verificação do certificado A1 (MAC). Confira a senha do .pfx/.p12 e exporte novamente em formato compatível.',
      );
    }
    throw err;
  }
}

function findTagValue(xml, tag) {
  const re = new RegExp(`<${tag}>([^<]+)<\\/${tag}>`);
  const m = xml.match(re);
  return m?.[1]?.trim();
}

function toBrDate(v) {
  if (!v) return undefined;
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const br = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return v;
  return undefined;
}

function matchDateRange(dataBr, inicioIso, fimIso) {
  if (!dataBr) return true;
  const br = dataBr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!br) return true;
  const ts = new Date(`${br[3]}-${br[2]}-${br[1]}T00:00:00`).getTime();
  if (Number.isNaN(ts)) return true;
  if (inicioIso) {
    const t0 = new Date(`${inicioIso}T00:00:00`).getTime();
    if (!Number.isNaN(t0) && ts < t0) return false;
  }
  if (fimIso) {
    const t1 = new Date(`${fimIso}T23:59:59`).getTime();
    if (!Number.isNaN(t1) && ts > t1) return false;
  }
  return true;
}

function mapErroCertificadoOuSefaz(error) {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const msg = raw.toLowerCase();
  if (msg.includes('mac verify failure') || msg.includes('pkcs12') || msg.includes('falha na verificação do certificado')) {
    return 'Falha na verificação do certificado A1 (MAC). Revise a senha do .pfx/.p12 e, se necessário, reexporte o certificado.';
  }
  if (msg.includes('bad decrypt') || msg.includes('passphrase')) {
    return 'Senha do certificado inválida. Informe a senha correta do A1.';
  }
  if (msg.includes('unable to get local issuer certificate') || msg.includes('self signed certificate')) {
    return 'Falha de cadeia TLS do certificado. Verifique a cadeia ICP-Brasil instalada no servidor.';
  }
  if (msg.includes('http 500') || msg.includes('http 400') || msg.includes('sefaz retornou')) {
    return `SEFAZ retornou erro na consulta: ${raw}`;
  }
  if (msg.includes('cstat 489') || msg.includes('cnpj informado inválido')) {
    return 'CNPJ não confere com o certificado A1. O sistema usa o CNPJ do certificado — confira se é o .pfx da empresa correta.';
  }
  if (msg.includes('cstat 656') || msg.includes('consumo indevido')) {
    return 'SEFAZ bloqueou consultas repetidas (cStat 656). Aguarde cerca de 1 hora antes de sincronizar novamente.';
  }
  if (msg.includes('cstat 215')) {
    return 'SEFAZ rejeitou o layout da consulta (cStat 215). Reinicie a API fiscal (npm run fiscal-api) e tente novamente.';
  }
  return raw || 'Falha ao consultar SEFAZ com certificado.';
}

function salvarXmlsFolhaExportados({ cnpj, dataInicio, dataFim, xmls }) {
  if (!xmls?.length) return null;
  const base = process.env.FOLHA_ESOCIAL_EXPORT_DIR?.trim() || join(process.cwd(), 'data', 'folha-esocial-export');
  const pasta = join(base, `${cnpj}_${dataInicio}_${dataFim}_${Date.now()}`);
  mkdirSync(pasta, { recursive: true });
  let idx = 0;
  for (const xml of xmls) {
    const decoded = decodificarPayloadEsocial(xml) || xml;
    if (!decoded?.trim()) continue;
    idx += 1;
    writeFileSync(join(pasta, `evento-${String(idx).padStart(4, '0')}.xml`), decoded, 'utf8');
  }
  if (idx === 0) return null;
  return pasta;
}

async function consultarFolhaEsocial(params) {
  const { dataInicio, dataFim, cnpj, ambiente, pfx, passphrase, cpfs } = params;
  const competencias = listarCompetenciasPeriodo(dataInicio, dataFim);
  const avisos = [];
  let pastaExportacao = null;
  let arquivosXml = 0;

  try {
    const ws = await baixarFolhaViaEsocialWs({
      cnpj,
      ambiente,
      dataInicio,
      dataFim,
      pfx,
      passphrase,
      cpfs,
    });
    if (ws.xmls?.length) {
      pastaExportacao = salvarXmlsFolhaExportados({ cnpj, dataInicio, dataFim, xmls: ws.xmls });
      arquivosXml = ws.xmls.length;
      if (pastaExportacao) {
        avisos.push(`${arquivosXml} XML(s) gravado(s) em: ${pastaExportacao}`);
      }
    }
    const porArquivo = [];
    for (const xml of ws.xmls) {
      const decoded = decodificarPayloadEsocial(xml);
      porArquivo.push(...parseEsocialXmlDocument(decoded || xml));
    }
    const consolidado = consolidarEventosFolha(porArquivo).filter((ev) =>
      matchDateRange(ev.referencia, dataInicio, dataFim),
    );
    const comValor = consolidado.some((e) => Math.abs(Number(e.valor) || 0) > 0);
    if (comValor) {
      return {
        eventos: consolidado,
        modo: 'esocial_webservice',
        aviso: ws.avisos.filter(Boolean).join(' '),
        pastaExportacao,
        arquivosXml,
      };
    }
    if (consolidado.length) {
      return {
        eventos: consolidado,
        modo: 'esocial_webservice',
        aviso: `${ws.avisos.join(' ')} Valores não reconhecidos nos XML baixados.`,
        pastaExportacao,
        arquivosXml,
      };
    }
    avisos.push(...ws.avisos);
  } catch (err) {
    avisos.push(`Webservice eSocial: ${err instanceof Error ? err.message : String(err)}`);
  }

  const gatewayFull = await consultarFolhaGateway({
    url: process.env.FOLHA_GATEWAY_ENDPOINT,
    cnpj,
    ambiente,
    dataInicio,
    dataFim,
    competencias,
    pfx,
    passphrase,
  });
  if (gatewayFull?.eventos?.length) {
    const filtrados = gatewayFull.eventos.filter((ev) => matchDateRange(ev.referencia, dataInicio, dataFim));
    const comValor = filtrados.some((e) => Math.abs(Number(e.valor) || 0) > 0);
    if (comValor) {
      return {
        eventos: consolidarEventosFolha(filtrados),
        modo: 'gateway_folha',
        aviso: gatewayFull.aviso || '',
      };
    }
  }

  if (process.env.FOLHA_GATEWAY_ENDPOINT?.trim()) {
    const porMes = [];
    for (const comp of competencias) {
      const g = await consultarFolhaGateway({
        url: process.env.FOLHA_GATEWAY_ENDPOINT,
        cnpj,
        ambiente,
        dataInicio: comp.isoInicio,
        dataFim: comp.isoFim,
        competencia: comp.perApur,
        competencias: [comp.perApur],
        pfx,
        passphrase,
      });
      if (g?.eventos?.length) porMes.push(...g.eventos);
    }
    if (porMes.length) {
      const consolidado = consolidarEventosFolha(porMes);
      const comValor = consolidado.some((e) => Math.abs(Number(e.valor) || 0) > 0);
      if (comValor) {
        return { eventos: consolidado, modo: 'gateway_folha_mensal', aviso: '' };
      }
    }
    avisos.push('Gateway folha sem retorno no período.');
  }

  if (process.env.ESOCIAL_ENDPOINT) {
    const porMes = [];
    for (const comp of competencias) {
      try {
        const xml = await postEsocialEnvelope({
          url: process.env.ESOCIAL_ENDPOINT,
          pfx,
          passphrase,
          ambiente,
          cnpj,
          perApur: comp.perApur,
        });
        porMes.push(...parseEsocialXmlDocument(xml));
      } catch {
        // tenta próximo mês
      }
    }
    if (porMes.length) {
      const consolidado = consolidarEventosFolha(porMes).filter((ev) =>
        matchDateRange(ev.referencia, dataInicio, dataFim),
      );
      const comValor = consolidado.some((e) => Math.abs(Number(e.valor) || 0) > 0);
      if (consolidado.length) {
        return {
          eventos: consolidado,
          modo: 'esocial_xml',
          aviso: comValor ? '' : 'XML eSocial sem valores reconhecidos no período.',
        };
      }
    }
    avisos.push('ESOCIAL_ENDPOINT não retornou valores no período.');
  }

  const dirXml = process.env.FOLHA_ESOCIAL_XML_DIR?.trim();
  if (dirXml) {
    try {
      const { readdirSync, readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const names = readdirSync(dirXml).filter((n) => /\.xml$/i.test(n));
      const porArquivo = [];
      for (const name of names) {
        const xml = readFileSync(join(dirXml, name), 'utf8');
        if (cnpj && !xml.includes(cnpj.slice(0, 8))) continue;
        porArquivo.push(...parseEsocialXmlDocument(xml));
      }
      const consolidado = consolidarEventosFolha(porArquivo).filter((ev) =>
        matchDateRange(ev.referencia, dataInicio, dataFim),
      );
      if (consolidado.some((e) => Math.abs(Number(e.valor) || 0) > 0)) {
        return { eventos: consolidado, modo: 'xml_dir', aviso: '' };
      }
    } catch {
      avisos.push('FOLHA_ESOCIAL_XML_DIR configurado mas ilegível.');
    }
  }

  return {
    eventos: [],
    modo: 'sem_fonte',
    aviso:
      avisos.join(' ') ||
      'Não foi possível obter folha com valores. Confira: certificado do empregador/procurador, período com S-1299 transmitido, dias 1-7 (bloqueio eSocial), ou use Importar XML/ZIP do portal. Para salários (S-1200) configure FOLHA_ESOCIAL_CPFS na API.',
    pastaExportacao,
    arquivosXml,
  };
}

async function consultarFolhaGateway({ url, cnpj, ambiente, dataInicio, dataFim, competencia, competencias, pfx, passphrase }) {
  if (!url?.trim()) return null;
  try {
    const payload = JSON.stringify({
      cnpj,
      ambiente,
      dataInicio,
      dataFim,
      competencia: competencia || undefined,
      competencias: competencias?.map((c) => c.perApur ?? c) ?? undefined,
      pedido: competencia ? 'folha_competencia' : 'folha_periodo',
    });
    const text = await postHttpsWithCertificate({
      url: url.trim(),
      pfx,
      passphrase,
      contentType: 'application/json; charset=utf-8',
      body: payload,
    });
    const json = JSON.parse(text);
    const raw = json.eventos ?? json.itens ?? json.folha ?? json.rows;
    if (!Array.isArray(raw)) return { eventos: [], aviso: 'Gateway sem lista de eventos.' };
    const eventos = raw
      .map((item) => {
        const x = item ?? {};
        return {
          evento: String(x.evento ?? x.descricao ?? x.nome ?? ''),
          referencia: x.referencia != null ? String(x.referencia) : x.data != null ? String(x.data) : '',
          valor: parseBrNumber(x.valor ?? x.credito ?? x.valorCredito ?? x.total ?? 0),
          fundamento: x.fundamento != null ? String(x.fundamento) : 'Gateway folha',
          codigo: x.codigo != null ? String(x.codigo) : '',
          classificacao: x.classificacao != null ? String(x.classificacao) : '',
        };
      })
      .filter((e) => e.evento);
    return { eventos: consolidarEventosFolha(eventos), aviso: '' };
  } catch {
    return null;
  }
}

function parseBrNumber(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const s = String(value).trim().replace(/\s/g, '');
  if (!s) return 0;
  const br = s.match(/^-?\d{1,3}(\.\d{3})*,\d{2}$/);
  if (br) return Number.parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
  const us = s.match(/^-?\d+(\.\d+)?$/);
  if (us) return Number.parseFloat(s) || 0;
  const clean = s.replace(/\./g, '').replace(',', '.');
  const n = Number.parseFloat(clean);
  return Number.isFinite(n) ? n : 0;
}

function consolidarEventosFolha(lista) {
  const map = new Map();
  for (const ev of lista) {
    const evento = String(ev.evento ?? '').trim();
    if (!evento) continue;
    const ref = String(ev.referencia ?? '').trim();
    const key = `${evento}\0${ref}`;
    const prev = map.get(key);
    const valor = Math.abs(Number(ev.valor) || 0);
    if (!prev) {
      map.set(key, { ...ev, evento, referencia: ref || ev.referencia, valor });
      continue;
    }
    prev.valor = Math.abs(Number(prev.valor) || 0) + valor;
    map.set(key, prev);
  }
  return [...map.values()];
}

function listarCompetenciasPeriodo(dataInicio, dataFim) {
  const inicio = parseIsoDate(dataInicio) ?? new Date();
  const fim = parseIsoDate(dataFim) ?? inicio;
  const start = new Date(inicio.getFullYear(), inicio.getMonth(), 1);
  const end = new Date(fim.getFullYear(), fim.getMonth(), 1);
  const out = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const lastDay = new Date(y, cursor.getMonth() + 1, 0).getDate();
    out.push({
      perApur: `${y}-${m}`,
      referencia: `01/${m}/${y}`,
      isoInicio: `${y}-${m}-01`,
      isoFim: `${y}-${m}-${String(lastDay).padStart(2, '0')}`,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  if (!out.length && dataFim) {
    const br = toBrDate(dataFim);
    if (br) {
      const [dd, mm, yyyy] = br.split('/');
      out.push({
        perApur: `${yyyy}-${mm}`,
        referencia: br,
        isoInicio: dataInicio || `${yyyy}-${mm}-01`,
        isoFim: dataFim || `${yyyy}-${mm}-${dd}`,
      });
    }
  }
  return out;
}

function parseIsoDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function eventosParaFolhaRows(eventos) {
  return eventos
    .filter((ev) => Math.abs(Number(ev.valor) || 0) > 0)
    .map((ev) => {
      const valor = Math.abs(Number(ev.valor) || 0);
      const nomeBase = String(ev.evento ?? '').trim();
      const nome =
        /(a\s+pagar|a\s+recolher|provis)/i.test(nomeBase) ? nomeBase : `${nomeBase} a pagar`;
      return {
        codigo: ev.codigo ? String(ev.codigo) : '',
        classificacao: ev.classificacao ? String(ev.classificacao) : '',
        nome,
        data: ev.referencia || undefined,
        saldoInicial: 0,
        debito: 0,
        credito: valor,
        saldoFinal: valor,
        naturezaSaldoFinal: 'C',
        tipo: 'A',
      };
    });
}

function postEsocialEnvelope({ url, pfx, passphrase, ambiente, cnpj, perApur }) {
  const blocoApur = perApur ? `<perApur>${perApur}</perApur>` : '';
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<eSocialConsulta xmlns="http://www.esocial.gov.br/schema/lote/eventos/envio/v1_1_1">
  <ideEmpregador>
    <tpInsc>1</tpInsc>
    <nrInsc>${cnpj}</nrInsc>
  </ideEmpregador>
  <ideTransmissor>
    <tpInsc>1</tpInsc>
    <nrInsc>${cnpj}</nrInsc>
  </ideTransmissor>
  <ambiente>${ambiente}</ambiente>
  ${blocoApur}
</eSocialConsulta>`;

  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method: 'POST',
        pfx,
        passphrase,
        rejectUnauthorized: true,
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          Accept: 'application/xml, text/xml, */*',
          'Content-Length': Buffer.byteLength(xml),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`eSocial retornou HTTP ${res.statusCode}.`));
            return;
          }
          resolve(text);
        });
      },
    );
    req.on('error', (err) => reject(new Error(`Erro TLS/eSocial: ${err.message}`)));
    req.write(xml);
    req.end();
  });
}

function parseEsocialXmlDocument(xml) {
  const referencia = extrairReferenciaEsocial(xml);
  const items = [];

  const blocosRubrica = [...xml.matchAll(/<itensRemun>[\s\S]*?<\/itensRemun>/gi)];
  for (const bloco of blocosRubrica) {
    const fragmento = bloco[0];
    const vr = parseBrNumber(findTagInFragment(fragmento, 'vrRubr') ?? findTagInFragment(fragmento, 'vlrRubr'));
    if (vr <= 0) continue;
    const dsc = findTagInFragment(fragmento, 'dscRubr') ?? '';
    const cod = findTagInFragment(fragmento, 'codRubr') ?? '';
    items.push({
      evento: classificarRubricaFolha(dsc, cod),
      referencia,
      valor: vr,
      fundamento: cod ? `eSocial rubrica ${cod}` : 'eSocial S-1200',
    });
  }

  const gruposTotais = [
    { evento: 'Salários', tags: ['vRemun', 'remunPerApur', 'vrSalFam', 'vrTotRemun', 'vrRubr', 'vlrRubr'] },
    { evento: 'Pró-labore', tags: ['vrProLabore', 'vlrProLabore'] },
    { evento: 'Férias', tags: ['vrFerias', 'vlrFerias', 'vrFeriasProp', 'vrFeriasDb'] },
    { evento: '13º Salário', tags: ['vrDecimoTerceiro', 'vlr13', 'vr13', 'vrDecTer'] },
    {
      evento: 'INSS a recolher',
      tags: [
        'vrDescCP',
        'vrCpSeg',
        'vrInss',
        'vrCp',
        'vrTotCp',
        'vrCpSegTerc',
        'vrBcCp00',
        'vrBcCp15',
        'vrBcCp20',
        'vrBcCp25',
        'vrDescCPPat',
      ],
    },
    { evento: 'FGTS a recolher', tags: ['vrFGTS', 'vrFgts', 'valorFGTS', 'vrTotFGTS', 'vrRemFGTS', 'vrDpsFGTS'] },
    { evento: 'IRRF a recolher', tags: ['vrDescIRRF', 'vrIRRF', 'vrIrrf', 'vrTotIRRF', 'vrCRMen'] },
    { evento: 'Consignados a pagar', tags: ['vrConsignado', 'vrDescConsig', 'vrEconsignado', 'vrDedDep'] },
  ];

  for (const g of gruposTotais) {
    let soma = 0;
    for (const tag of g.tags) {
      const vals = [...xml.matchAll(new RegExp(`<${tag}[^>]*>([^<]+)<\\/${tag}>`, 'gi'))];
      for (const v of vals) soma += parseBrNumber(v[1]);
    }
    if (soma > 0) {
      items.push({
        evento: g.evento,
        referencia,
        valor: soma,
        fundamento: 'eSocial totalizador/encargos',
      });
    }
  }

  if (items.length === 0) {
    return extrairValoresFolhaEsocialLegado(xml);
  }
  return items;
}

function extrairValoresFolhaEsocialLegado(xml) {
  const items = [];
  const referencia = extrairReferenciaEsocial(xml);
  const grupos = [
    { evento: 'Salários', tags: ['vRemun', 'vrRubr', 'vlrRubr'] },
    { evento: 'Pró-labore', tags: ['vrProLabore', 'vlrProLabore'] },
    { evento: 'Férias', tags: ['vrFerias', 'vlrFerias'] },
    { evento: '13º Salário', tags: ['vrDecimoTerceiro', 'vlr13'] },
    { evento: 'INSS a recolher', tags: ['vrDescCP', 'vrCpSeg', 'vrCp'] },
    { evento: 'FGTS a recolher', tags: ['vrFGTS', 'vrFgts'] },
    { evento: 'IRRF a recolher', tags: ['vrDescIRRF', 'vrIRRF'] },
    { evento: 'Consignados a pagar', tags: ['vrConsignado', 'vrDescConsig'] },
  ];
  for (const g of grupos) {
    let soma = 0;
    for (const tag of g.tags) {
      const vals = [...xml.matchAll(new RegExp(`<${tag}[^>]*>([^<]+)<\\/${tag}>`, 'gi'))];
      for (const v of vals) soma += parseBrNumber(v[1]);
    }
    if (soma > 0) {
      items.push({ evento: g.evento, referencia, valor: soma, fundamento: 'eSocial (tags)' });
    }
  }
  if (items.length === 0) {
    const generic = [...xml.matchAll(/<(?:vr|vlr|valor)([A-Za-z0-9]+)>([^<]+)<\/(?:vr|vlr|valor)\1>/gi)];
    for (const m of generic) {
      const valor = parseBrNumber(m[2]);
      if (valor > 0) {
        items.push({
          evento: classificarRubricaFolha(m[1], ''),
          referencia,
          valor,
          fundamento: 'eSocial',
        });
      }
    }
  }
  return items;
}

function classificarRubricaFolha(dsc, cod) {
  const t = `${dsc} ${cod}`.toLowerCase();
  if (/pro[\s-]?labore|prolabore/.test(t)) return 'Pró-labore';
  if (/f[eé]rias|ferias/.test(t)) return 'Férias';
  if (/13|d[eé]cimo|decimo/.test(t)) return '13º Salário';
  if (/inss|previd|cp\s*seg|contribui/.test(t)) return 'INSS a recolher';
  if (/fgts/.test(t)) return 'FGTS a recolher';
  if (/irrf|ir\s*ret|imposto\s*renda/.test(t)) return 'IRRF a recolher';
  if (/consign|emprest|desconto\s*folha/.test(t)) return 'Consignados a pagar';
  if (/sal[aá]rio|ordenado|remun|provento|horas?\s*norm/.test(t)) return 'Salários';
  return 'Salários';
}

function findTagInFragment(fragment, tag) {
  const re = new RegExp(`<${tag}[^>]*>([^<]+)<\\/${tag}>`, 'i');
  const m = fragment.match(re);
  return m?.[1]?.trim();
}

function extrairXmlsDeZip(buffer) {
  const xmls = [];
  let offset = 0;
  while (offset < buffer.length - 30) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) {
      offset += 1;
      continue;
    }
    const compMethod = buffer.readUInt16LE(offset + 8);
    const compSize = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
    const dataStart = offset + 30 + nameLen + extraLen;
    const data = buffer.subarray(dataStart, dataStart + compSize);
    offset = dataStart + compSize;
    if (!/\.xml$/i.test(name)) continue;
    try {
      let raw = data;
      if (compMethod === 8) {
        try {
          raw = inflateSync(data);
        } catch {
          raw = inflateRawSync(data);
        }
      }
      const text = raw.toString('utf8');
      if (text.includes('<') && /evt|eSocial|perApur/i.test(text)) xmls.push(text);
    } catch {
      // ignora entrada corrompida
    }
  }
  return xmls;
}

function extrairReferenciaEsocial(xml) {
  const perApur = findTagValue(xml, 'perApur') ?? findTagValue(xml, 'perApuracao');
  if (perApur && /^\d{4}-\d{2}$/.test(perApur)) {
    const [y, m] = perApur.split('-');
    return `01/${m}/${y}`;
  }
  const dt = findTagValue(xml, 'dtApuracao') ?? findTagValue(xml, 'data');
  return toBrDate(dt) ?? '';
}
