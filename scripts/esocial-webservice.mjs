/**
 * Webservices oficiais eSocial (download cirúrgico) com certificado A1 + XML assinado.
 * Manual: ConsultarIdentificadoresEventos + SolicitarDownloadEventosPorId
 */
import https from 'node:https';
import { gunzipSync, inflateRawSync, inflateSync } from 'node:zlib';
import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';
import { DOMParser } from '@xmldom/xmldom';

const VERSAO_WS = 'v1_0_0';
const SCHEMA_ID = 'v1_0_0';
const NS_SERVICOS = 'http://www.esocial.gov.br/servicos';

const URLS = {
  producao: {
    identificadores:
      'https://webservices.download.esocial.gov.br/servicos/empregador/dwlcirurgico/WsConsultarIdentificadoresEventos.svc',
    download:
      'https://webservices.download.esocial.gov.br/servicos/empregador/dwlcirurgico/WsSolicitarDownloadEventos.svc',
  },
  homologacao: {
    identificadores:
      'https://webservices.producaorestrita.esocial.gov.br/servicos/empregador/dwlcirurgico/WsConsultarIdentificadoresEventos.svc',
    download:
      'https://webservices.producaorestrita.esocial.gov.br/servicos/empregador/dwlcirurgico/WsSolicitarDownloadEventos.svc',
  },
};

/** Totais/fechamento — 2 consultas/mês (cabe no limite diário de 10 do eSocial). */
const TIPOS_EVT_FOLHA_EMPREGADOR = ['S-5011', 'S-1299'];

export function listarCompetenciasEsocial(dataInicio, dataFim) {
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
      isoInicio: `${y}-${m}-01`,
      isoFim: `${y}-${m}-${String(lastDay).padStart(2, '0')}`,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

function parseIsoDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function cnpjBase(cnpj) {
  return String(cnpj).replace(/\D/g, '').slice(0, 8);
}

function loadPfxCredentials(pfx, passphrase) {
  const der = forge.util.createBuffer(Buffer.from(pfx).toString('binary'));
  const asn1 = forge.asn1.fromDer(der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, passphrase);
  const certBag = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]?.[0];
  const keyBag =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0] ??
    p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0];
  if (!certBag?.cert || !keyBag?.key) {
    throw new Error('Não foi possível extrair chave/certificado do A1 para assinar XML eSocial.');
  }
  const certPem = forge.pki.certificateToPem(certBag.cert);
  const privateKeyPem = forge.pki.privateKeyToPem(keyBag.key);
  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(certBag.cert)).getBytes();
  const certB64 = forge.util.encode64(certDer);
  return { privateKeyPem, certPem, certB64 };
}

function assinarXmlEsocial(unsignedXml, cred) {
  const sig = new SignedXml({
    privateKey: cred.privateKeyPem,
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  });
  sig.keyInfoProvider = {
    getKeyInfo() {
      return `<X509Data><X509Certificate>${cred.certB64}</X509Certificate></X509Data>`;
    },
    getKey() {
      return cred.privateKeyPem;
    },
  };
  sig.addReference({
    xpath: "//*[local-name()='eSocial']",
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  });
  sig.computeSignature(unsignedXml, {
    location: { reference: "//*[local-name()='eSocial']", action: 'append' },
  });
  return sig.getSignedXml();
}

function soapEnvelope(bodyInner, xmlnsV1) {
  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v1="${xmlnsV1}">
  <soapenv:Header/>
  <soapenv:Body>
    ${bodyInner}
  </soapenv:Body>
</soapenv:Envelope>`;
}

const ESOCIAL_SOAP_TIMEOUT_MS = Number(process.env.ESOCIAL_SOAP_TIMEOUT_MS || 90_000);

/** ICP-Brasil: no Windows o Node costuma falhar com "unable to get local issuer certificate". */
function esocialTlsStrict() {
  return process.env.ESOCIAL_TLS_STRICT === '1' || process.env.ESOCIAL_TLS_STRICT === 'true';
}

function postSoapOnce({ url, action, envelope, pfx, passphrase, timeoutMs = ESOCIAL_SOAP_TIMEOUT_MS, rejectUnauthorized }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const req = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method: 'POST',
        pfx,
        passphrase,
        rejectUnauthorized,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: `"${action}"`,
          'Content-Length': Buffer.byteLength(envelope, 'utf8'),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          if (settled) return;
          settled = true;
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`eSocial HTTP ${res.statusCode}: ${extrairMotivoEsocial(text).slice(0, 300)}`));
            return;
          }
          resolve(text);
        });
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      fail(
        new Error(
          `eSocial não respondeu em ${Math.round(timeoutMs / 1000)}s. Verifique rede/firewall ou use Importar XML/ZIP do portal.`,
        ),
      );
    });
    req.on('error', (err) => fail(new Error(`Erro TLS eSocial: ${err.message}`)));
    req.write(envelope);
    req.end();
  });
}

async function postSoap(params) {
  const strict = esocialTlsStrict();
  try {
    return await postSoapOnce({ ...params, rejectUnauthorized: strict });
  } catch (err) {
    const msg = String(err?.message ?? '').toLowerCase();
    const certChain =
      msg.includes('unable to get local issuer') ||
      msg.includes('self signed certificate') ||
      msg.includes('unable to verify');
    if (strict && certChain) {
      return await postSoapOnce({ ...params, rejectUnauthorized: false });
    }
    if (certChain) {
      throw new Error(
        `Erro TLS eSocial (cadeia ICP-Brasil). Use "Importar XML/ZIP eSocial" com o ZIP do portal, ou reinicie a API sem ESOCIAL_TLS_STRICT.`,
      );
    }
    throw err;
  }
}

function extrairMotivoEsocial(xml) {
  const cd = xml.match(/<cdResposta>(\d+)<\/cdResposta>/i)?.[1];
  const desc = xml.match(/<descResposta>([^<]+)<\/descResposta>/i)?.[1];
  if (cd || desc) return `[${cd ?? '?'}] ${desc ?? ''}`.trim();
  return xml.replace(/\s+/g, ' ').slice(0, 400);
}

function extrairIdsConsulta(xml) {
  const ids = new Set();
  for (const m of xml.matchAll(/<id(?:\s[^>]*)?>([^<]+)<\/id>/gi)) {
    const id = m[1]?.trim();
    if (id && id.length > 10) ids.add(id);
  }
  for (const m of xml.matchAll(/\bId="(ID[^"]+)"/gi)) {
    ids.add(m[1]);
  }
  return [...ids];
}

/** Decodifica payload do eSocial (XML direto, base64, gzip ou deflate). */
export function decodificarPayloadEsocial(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('<')) return trimmed;
  const b64 = trimmed.replace(/\s/g, '');
  try {
    const buf = Buffer.from(b64, 'base64');
    if (!buf.length) return '';
    for (const fn of [gunzipSync, inflateRawSync, inflateSync]) {
      try {
        const out = fn(buf).toString('utf8');
        if (out.includes('<') && /evt|eSocial/i.test(out)) return out;
      } catch {
        // tenta próximo
      }
    }
    const asText = buf.toString('utf8');
    if (asText.includes('<')) return asText;
  } catch {
    // não é base64 válido
  }
  return trimmed;
}

function extrairEventosXml(text) {
  const found = [];
  for (const m of text.matchAll(/<evt\w*[^>]*>[\s\S]*?<\/evt\w*>/gi)) {
    if (m[0]?.trim()) found.push(m[0].trim());
  }
  if (found.length) return found;
  if (/<eSocial[\s>]/i.test(text) || /evtRemun|evtCS|evtBases|evtFecha/i.test(text)) {
    return [text];
  }
  return [];
}

export function extrairXmlsDownload(soapResponse) {
  const xmls = [];
  const seen = new Set();

  const pushDecoded = (chunk) => {
    const decoded = decodificarPayloadEsocial(chunk);
    if (!decoded) return;
    for (const evt of extrairEventosXml(decoded)) {
      const key = evt.slice(0, 120);
      if (seen.has(key)) continue;
      seen.add(key);
      xmls.push(evt);
    }
  };

  for (const m of soapResponse.matchAll(/<docZip[^>]*>([\s\S]*?)<\/docZip>/gi)) {
    pushDecoded(m[1]);
  }
  for (const m of soapResponse.matchAll(/<arquivo[^>]*>([\s\S]*?)<\/arquivo>/gi)) {
    pushDecoded(m[1]);
  }
  for (const m of soapResponse.matchAll(/<evt\w*[^>]*>[\s\S]*?<\/evt\w*>/gi)) {
    const evt = m[0]?.trim();
    if (evt) pushDecoded(evt);
  }
  if (!xmls.length) {
    pushDecoded(soapResponse);
  }
  return xmls;
}

function montarConsultaEmpregador({ cnpj, tpEvt, perApur }) {
  const nrInsc = cnpjBase(cnpj);
  return `<eSocial xmlns="http://www.esocial.gov.br/schema/consulta/identificadores-eventos/empregador/${SCHEMA_ID}">
  <consultaIdentificadoresEvts>
    <ideEmpregador>
      <tpInsc>1</tpInsc>
      <nrInsc>${nrInsc}</nrInsc>
    </ideEmpregador>
    <consultaEvtsEmpregador>
      <tpEvt>${tpEvt}</tpEvt>
      <perApur>${perApur}</perApur>
    </consultaEvtsEmpregador>
  </consultaIdentificadoresEvts>
</eSocial>`;
}

function montarDownloadPorId({ cnpj, ids }) {
  const nrInsc = cnpjBase(cnpj);
  const idsXml = ids.map((id) => `<id>${id}</id>`).join('');
  return `<eSocial xmlns="http://www.esocial.gov.br/schema/download/solicitacao/id/${SCHEMA_ID}">
  <download>
    <ideEmpregador>
      <tpInsc>1</tpInsc>
      <nrInsc>${nrInsc}</nrInsc>
    </ideEmpregador>
    <solicDownloadEvtsPorId>${idsXml}</solicDownloadEvtsPorId>
  </download>
</eSocial>`;
}

function montarConsultaTrabalhador({ cnpj, cpfTrab, dtIni, dtFim }) {
  const nrInsc = cnpjBase(cnpj);
  return `<eSocial xmlns="http://www.esocial.gov.br/schema/consulta/identificadores-eventos/trabalhador/${SCHEMA_ID}">
  <consultaIdentificadoresEvts>
    <ideEmpregador>
      <tpInsc>1</tpInsc>
      <nrInsc>${nrInsc}</nrInsc>
    </ideEmpregador>
    <consultaEvtsTrabalhador>
      <cpfTrab>${cpfTrab}</cpfTrab>
      <dtIni>${dtIni}</dtIni>
      <dtFim>${dtFim}</dtFim>
    </consultaEvtsTrabalhador>
  </consultaIdentificadoresEvts>
</eSocial>`;
}

function dtRecepcaoLimite() {
  const d = new Date(Date.now() - 65 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function consultarIdsEmpregador({ tpEvt, perApur, cnpj, pfx, passphrase, urls, cred }) {
  const unsigned = montarConsultaEmpregador({ cnpj, tpEvt, perApur });
  const signed = assinarXmlEsocial(unsigned, cred);
  const xmlnsV1 = `${NS_SERVICOS}/empregador/consulta/identificadores-eventos/${VERSAO_WS}`;
  const action = `${NS_SERVICOS}/empregador/consulta/identificadores-eventos/${VERSAO_WS}/ServicoConsultarIdentificadoresEventos/ConsultarIdentificadoresEventosEmpregador`;
  const body = `<v1:ConsultarIdentificadoresEventosEmpregador xmlns:v1="${xmlnsV1}"><v1:consultaEventosEmpregador>${signed}</v1:consultaEventosEmpregador></v1:ConsultarIdentificadoresEventosEmpregador>`;
  const envelope = soapEnvelope(body, xmlnsV1);
  const res = await postSoap({ url: urls.identificadores, action, envelope, pfx, passphrase });
  const cd = res.match(/<cdResposta>(\d+)<\/cdResposta>/i)?.[1];
  if (cd && cd !== '201') {
    throw new Error(extrairMotivoEsocial(res));
  }
  return extrairIdsConsulta(res);
}

async function consultarIdsTrabalhador({ cnpj, cpfTrab, dtIni, dtFim, pfx, passphrase, urls, cred }) {
  const unsigned = montarConsultaTrabalhador({ cnpj, cpfTrab, dtIni, dtFim });
  const signed = assinarXmlEsocial(unsigned, cred);
  const xmlnsV1 = `${NS_SERVICOS}/empregador/consulta/identificadores-eventos/${VERSAO_WS}`;
  const action = `${NS_SERVICOS}/empregador/consulta/identificadores-eventos/${VERSAO_WS}/ServicoConsultarIdentificadoresEventos/ConsultarIdentificadoresEventosTrabalhador`;
  const body = `<v1:ConsultarIdentificadoresEventosTrabalhador xmlns:v1="${xmlnsV1}"><v1:consultaEventosTrabalhador>${signed}</v1:consultaEventosTrabalhador></v1:ConsultarIdentificadoresEventosTrabalhador>`;
  const envelope = soapEnvelope(body, xmlnsV1);
  const res = await postSoap({ url: urls.identificadores, action, envelope, pfx, passphrase });
  const cd = res.match(/<cdResposta>(\d+)<\/cdResposta>/i)?.[1];
  if (cd && cd !== '201') {
    throw new Error(extrairMotivoEsocial(res));
  }
  return extrairIdsConsulta(res);
}

async function downloadPorIds({ ids, cnpj, pfx, passphrase, urls, cred }) {
  const unsigned = montarDownloadPorId({ cnpj, ids });
  const signed = assinarXmlEsocial(unsigned, cred);
  const xmlnsV1 = `${NS_SERVICOS}/empregador/download/solicitacao/${VERSAO_WS}`;
  const action = `${NS_SERVICOS}/empregador/download/solicitacao/${VERSAO_WS}/ServicoSolicitarDownloadEventos/SolicitarDownloadEventosPorId`;
  const body = `<v1:SolicitarDownloadEventosPorId xmlns:v1="${xmlnsV1}"><v1:solicitacao>${signed}</v1:solicitacao></v1:SolicitarDownloadEventosPorId>`;
  const envelope = soapEnvelope(body, xmlnsV1);
  const res = await postSoap({ url: urls.download, action, envelope, pfx, passphrase });
  const cd = res.match(/<cdResposta>(\d+)<\/cdResposta>/i)?.[1];
  if (cd && cd !== '201') {
    throw new Error(extrairMotivoEsocial(res));
  }
  return extrairXmlsDownload(res);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Baixa XML reais via webservice oficial (S-1299 + totalizadores; opcional S-1200 por CPF).
 */
export async function baixarFolhaViaEsocialWs({ cnpj, ambiente, dataInicio, dataFim, pfx, passphrase, cpfs }) {
  const dia = new Date().getDate();
  if (dia >= 1 && dia <= 7) {
    return {
      xmls: [],
      avisos: [
        'eSocial bloqueia webservice de download entre os dias 1 e 7 de cada mês. Use Importar XML/ZIP ou tente após o dia 7.',
      ],
    };
  }

  const urls = URLS[ambiente === 'homologacao' ? 'homologacao' : 'producao'];
  const cred = loadPfxCredentials(pfx, passphrase);
  const competencias = listarCompetenciasEsocial(dataInicio, dataFim).reverse();
  const xmls = [];
  const avisos = [];
  const dtFim = dtRecepcaoLimite();

  let consultas = 0;
  const maxConsultas = Number(process.env.FOLHA_ESOCIAL_MAX_CONSULTAS || 10);

  competenciaLoop: for (const comp of competencias) {
    for (const tpEvt of TIPOS_EVT_FOLHA_EMPREGADOR) {
      if (consultas >= maxConsultas - 1) {
        avisos.push(
          'Limite de consultas eSocial/dia (10). Use 1 mês por vez, ou Importar XML/ZIP do portal (recomendado).',
        );
        break competenciaLoop;
      }
      try {
        consultas += 1;
        const ids = await consultarIdsEmpregador({
          tpEvt,
          perApur: comp.perApur,
          cnpj,
          pfx,
          passphrase,
          urls,
          cred,
        });
        if (!ids.length) {
          avisos.push(`${comp.perApur} ${tpEvt}: nenhum evento encontrado.`);
          continue;
        }
        for (const lote of chunk(ids, 50)) {
          consultas += 1;
          const baixados = await downloadPorIds({ ids: lote, cnpj, pfx, passphrase, urls, cred });
          xmls.push(...baixados);
        }
      } catch (err) {
        avisos.push(`${comp.perApur} ${tpEvt}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const cpfsLista = String(cpfs ?? process.env.FOLHA_ESOCIAL_CPFS ?? '')
    .split(/[,;\s]+/)
    .map((s) => s.replace(/\D/g, ''))
    .filter((s) => s.length === 11);

  for (const comp of competencias) {
    const dtIni = `${comp.isoInicio}T00:00:00`;
    const dtF = dtFim;
    for (const cpfTrab of cpfsLista) {
      if (consultas >= maxConsultas) break;
      try {
        consultas += 1;
        const ids = await consultarIdsTrabalhador({
          cnpj,
          cpfTrab,
          dtIni,
          dtFim: dtF,
          pfx,
          passphrase,
          urls,
          cred,
        });
        if (!ids.length) continue;
        for (const lote of chunk(ids, 50)) {
          consultas += 1;
          const baixados = await downloadPorIds({ ids: lote, cnpj, pfx, passphrase, urls, cred });
          xmls.push(...baixados);
        }
      } catch (err) {
        avisos.push(`CPF ${cpfTrab} ${comp.perApur}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (xmls.length > 0) {
    avisos.push(`${xmls.length} XML(s) decodificado(s) do webservice.`);
  } else if (!cpfsLista.length) {
    avisos.push(
      'Nenhum XML com valores no webservice. Informe CPFs dos trabalhadores no campo da tela (S-1200) ou use Importar XML/ZIP do portal eSocial.',
    );
  } else {
    avisos.push('Nenhum XML retornado — confira certificado (empregador/procurador), S-1299/S-5011 transmitidos e limite de 10 consultas/dia.');
  }

  return { xmls, avisos };
}
