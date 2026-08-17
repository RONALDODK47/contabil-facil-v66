/**
 * Manifesto do destinatário — Ciência da Operação (tpEvento 210210).
 * Web Service NFeRecepcaoEvento4 (Ambiente Nacional).
 */
import { SignedXml } from 'xml-crypto';
import { loadPfxCredentials, postSoapMtls } from './nfe-cert-a1.mjs';

const NFE_NS = 'http://www.portalfiscal.inf.br/nfe';
const WSDL_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4';
const SOAP_ACTION = `${WSDL_NS}/nfeRecepcaoEvento`;
const TPEVENTO_CIENCIA = '210210';

const EVENTO_URL = {
  1: 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
  2: 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
};

function padNsu(n) {
  return String(n ?? '0').padStart(15, '0');
}

function dhEventoBr() {
  const now = new Date();
  const off = -3 * 60;
  const local = new Date(now.getTime() + off * 60 * 1000 - now.getTimezoneOffset() * 60 * 1000);
  const iso = local.toISOString().slice(0, 19);
  return `${iso}-03:00`;
}

export function buildInfEventoId(tpEvento, chNFe, nSeqEvento = 1) {
  const chave = String(chNFe).replace(/\D/g, '').slice(0, 44);
  const seq = String(nSeqEvento).padStart(2, '0');
  return `ID${tpEvento}${chave}${seq}`;
}

export function buildCienciaEventoXml({ cnpj, chNFe, tpAmb, nSeqEvento = 1, idLote = 1 }) {
  const cnpjLimpo = String(cnpj).replace(/\D/g, '').slice(0, 14);
  const chave = String(chNFe).replace(/\D/g, '').slice(0, 44);
  const id = buildInfEventoId(TPEVENTO_CIENCIA, chave, nSeqEvento);
  const dh = dhEventoBr();

  return `<?xml version="1.0" encoding="UTF-8"?><envEvento versao="1.00" xmlns="${NFE_NS}"><idLote>${idLote}</idLote><evento versao="1.00"><infEvento Id="${id}"><cOrgao>91</cOrgao><tpAmb>${tpAmb}</tpAmb><CNPJ>${cnpjLimpo}</CNPJ><chNFe>${chave}</chNFe><dhEvento>${dh}</dhEvento><tpEvento>${TPEVENTO_CIENCIA}</tpEvento><nSeqEvento>${nSeqEvento}</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento></infEvento></evento></envEvento>`;
}

function stripXmlDeclaration(xml) {
  return String(xml ?? '').replace(/^\s*<\?xml[^?]*\?>\s*/i, '').trim();
}

function signNfeEvento(unsignedXml, cred) {
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
    xpath: "//*[local-name()='infEvento']",
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  });
  sig.computeSignature(unsignedXml, {
    location: { reference: "//*[local-name()='evento']", action: 'append' },
  });
  return sig.getSignedXml();
}

function buildRecepcaoEventoEnvelope(signedEnvEvento) {
  const payload = stripXmlDeclaration(signedEnvEvento);
  const body = `<nfeRecepcaoEvento xmlns="${WSDL_NS}"><nfeDadosMsg>${payload}</nfeDadosMsg></nfeRecepcaoEvento>`;
  return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>${body}</soap12:Body></soap12:Envelope>`;
}

function readSoapTag(xml, localName) {
  const re = new RegExp(`<(?:[\\w]+:)?${localName}>([\\s\\S]*?)</(?:[\\w]+:)?${localName}>`, 'i');
  const m = String(xml ?? '').match(re);
  return m?.[1]?.trim() ?? '';
}

export function parseManifestoSoapResponse(xmlText) {
  return {
    cStat: readSoapTag(xmlText, 'cStat'),
    xMotivo: readSoapTag(xmlText, 'xMotivo'),
  };
}

/**
 * Envia evento 210210 (Ciência da Operação) para liberar XML completo na Distribuição DF-e.
 */
export async function enviarManifestoCiencia({ pfx, passphrase, cnpj, chNFe, tpAmb = '1' }) {
  const chave = String(chNFe).replace(/\D/g, '').slice(0, 44);
  if (chave.length !== 44) {
    return { ok: false, chave, mensagem: 'Chave NF-e inválida para manifesto.' };
  }

  const cred = loadPfxCredentials(pfx, passphrase);
  const unsigned = buildCienciaEventoXml({ cnpj, chNFe: chave, tpAmb });
  const signed = stripXmlDeclaration(signNfeEvento(unsigned, cred));
  const envelope = buildRecepcaoEventoEnvelope(signed);
  const url = EVENTO_URL[String(tpAmb)] ?? EVENTO_URL['1'];

  const { status, body } = await postSoapMtls({
    url,
    pfx,
    passphrase,
    body: envelope,
    soapVersion: '1.2',
    soapAction: SOAP_ACTION,
  });

  if (status >= 400) {
    return { ok: false, chave, mensagem: `SEFAZ HTTP ${status} no manifesto.` };
  }

  const parsed = parseManifestoSoapResponse(body);
  const cStat = String(parsed.cStat ?? '');
  const ok = cStat === '128' || cStat === '135' || cStat === '136' || cStat === '573';
  return {
    ok,
    chave,
    cStat,
    mensagem: ok ? 'Ciência registrada.' : `Manifesto cStat ${cStat}: ${parsed.xMotivo}`.trim(),
  };
}

export async function manifestarCienciaEmLote({
  pfx,
  passphrase,
  cnpj,
  chaves,
  tpAmb = '1',
  delayMs = 400,
}) {
  const resultados = [];
  const unicas = [...new Set(chaves.map((c) => String(c).replace(/\D/g, '').slice(0, 44)).filter((c) => c.length === 44))];

  for (const chave of unicas) {
    try {
      const r = await enviarManifestoCiencia({ pfx, passphrase, cnpj, chNFe: chave, tpAmb });
      resultados.push(r);
    } catch (err) {
      resultados.push({
        ok: false,
        chave,
        mensagem: err instanceof Error ? err.message : 'Falha no manifesto.',
      });
    }
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  const ok = resultados.filter((r) => r.ok).length;
  return { ok, total: unicas.length, manifestados: ok, resultados };
}

export { padNsu };
