/** Códigos IBGE das UFs — campo cUFAutor do distDFeInt (não usar 91 aqui). */
export const UF_SIGLA_TO_IBGE = {
  AC: '12',
  AL: '27',
  AM: '13',
  AP: '16',
  BA: '29',
  CE: '23',
  DF: '53',
  ES: '32',
  GO: '52',
  MA: '21',
  MG: '31',
  MS: '50',
  MT: '51',
  PA: '15',
  PB: '25',
  PE: '26',
  PI: '22',
  PR: '41',
  RJ: '33',
  RN: '24',
  RO: '11',
  RR: '14',
  RS: '43',
  SC: '42',
  SE: '28',
  SP: '35',
  TO: '17',
};

const DIST_DFE_VERSAO = '1.01';
const WSDL_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe';
const NFE_NS = 'http://www.portalfiscal.inf.br/nfe';
const SOAP_ACTION = `${WSDL_NS}/nfeDistDFeInteresse`;

export function resolveCUfAutor(ufSigla) {
  const uf = String(ufSigla ?? 'SP')
    .trim()
    .toUpperCase();
  return UF_SIGLA_TO_IBGE[uf] ?? UF_SIGLA_TO_IBGE.SP;
}

/** Escapa distDFeInt para nfeDadosMsg (tipo xs:string no WSDL). */
export function escapeXmlForSoapDataMsg(xml) {
  return String(xml ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Remove declaração XML antes de embutir em nfeDadosMsg (evita cStat 243). */
export function stripXmlDeclaration(xml) {
  return String(xml ?? '').replace(/^\s*<\?xml[^?]*\?>\s*/i, '').trim();
}

/** XML distDFeInt (corpo da consulta) — layout MOC v1.01. */
export function buildDistDfeInner(params) {
  const { cnpj, tpAmb, ultNSU, cUFAutor, omitCufAutor = false } = params;
  const nsu = String(ultNSU ?? '0').replace(/\D/g, '').padStart(15, '0');
  const cnpjLimpo = String(cnpj ?? '').replace(/\D/g, '').slice(0, 14);
  const cufBlock = omitCufAutor ? '' : `\n  <cUFAutor>${cUFAutor}</cUFAutor>`;
  return `<distDFeInt xmlns="${NFE_NS}" versao="${DIST_DFE_VERSAO}">
  <tpAmb>${tpAmb}</tpAmb>${cufBlock}
  <CNPJ>${cnpjLimpo}</CNPJ>
  <distNSU>
    <ultNSU>${nsu}</ultNSU>
  </distNSU>
</distDFeInt>`;
}

function wrapNfeDadosMsg(inner, encoding) {
  // Garantir que a declaração XML seja removida antes de embutir
  const payload = stripXmlDeclaration(inner);
  if (encoding === 'escaped') {
    return `<nfeDadosMsg>${escapeXmlForSoapDataMsg(payload)}</nfeDadosMsg>`;
  }
  if (encoding === 'cdata') {
    return `<nfeDadosMsg><![CDATA[${payload}]]></nfeDadosMsg>`;
  }
  return `<nfeDadosMsg>${payload}</nfeDadosMsg>`;
}

/**
 * Envelope SOAP — nfeDadosMsg como string XSD (escaped), padrão NFePHP/SEFAZ.
 * @param {'1.1' | '1.2'} soapVersion
 * @param {'escaped' | 'nested' | 'cdata'} encoding
 */
export function buildDistDfeEnvelope(params, soapVersion = '1.2', encoding = 'escaped') {
  const inner = buildDistDfeInner(params);
  const dadosMsg = wrapNfeDadosMsg(inner, encoding);
  const body = `<nfeDistDFeInteresse xmlns="${WSDL_NS}">${dadosMsg}</nfeDistDFeInteresse>`;

  if (soapVersion === '1.1') {
    return `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body>${body}</soap:Body></soap:Envelope>`;
  }
  return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>${body}</soap12:Body></soap12:Envelope>`;
}

export function distDfeEnvelopeVariants(params) {
  /** NFePHP / MOC: nfeDadosMsg com distDFeInt aninhado (não escapado). */
  const combos = [
    { soapVersion: '1.2', omitCufAutor: false, encoding: 'nested', label: 'SOAP 1.2 + cUFAutor + nested' },
    { soapVersion: '1.2', omitCufAutor: false, encoding: 'cdata', label: 'SOAP 1.2 + cUFAutor + CDATA' },
    { soapVersion: '1.2', omitCufAutor: true, encoding: 'nested', label: 'SOAP 1.2 sem cUFAutor + nested' },
    { soapVersion: '1.1', omitCufAutor: false, encoding: 'nested', label: 'SOAP 1.1 + cUFAutor + nested' },
    { soapVersion: '1.2', omitCufAutor: false, encoding: 'escaped', label: 'SOAP 1.2 + cUFAutor + escaped' },
  ];
  return combos.map((v) => ({
    ...v,
    xml: buildDistDfeEnvelope({ ...params, omitCufAutor: v.omitCufAutor }, v.soapVersion, v.encoding),
    soapAction: SOAP_ACTION,
  }));
}

export { SOAP_ACTION };
