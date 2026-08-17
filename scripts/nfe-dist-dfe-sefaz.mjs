import { unzip } from 'node:zlib';
import { promisify } from 'node:util';
import forge from 'node-forge';
import { parseNfeXmlString } from './nfe-xml-parse.mjs';
import {
  distDfeEnvelopeVariants,
  resolveCUfAutor,
  SOAP_ACTION,
} from './nfe-dist-dfe-xml.mjs';
import { manifestarCienciaEmLote, padNsu } from './nfe-manifesto-sefaz.mjs';
import { postSoapMtls } from './nfe-cert-a1.mjs';

const unzipAsync = promisify(unzip);
const MAX_PAGINAS = 12;
const MANIFESTO_RECONSULTA_PAGINAS = 4;
const SEFAZ_DIST_URL = {
  1: 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
  2: 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
};

/** Extrai CNPJ (14 dígitos) do certificado A1 ICP-Brasil. */
export function extractCnpjFromPfx(pfxBuffer, passphrase) {
  try {
    const b64 = Buffer.from(pfxBuffer).toString('base64');
    const asn1 = forge.asn1.fromDer(forge.util.decode64(b64));
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, passphrase);
    const bags =
      p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
    if (!bags.length) return null;
    const cert = bags.sort(
      (a, b) => new Date(b.cert.validity.notAfter) - new Date(a.cert.validity.notAfter),
    )[0].cert;

    for (const attr of cert.subject.attributes ?? []) {
      if (attr.type === '2.16.76.1.3.3' && attr.value) {
        const raw = forge.util.decodeUtf8(attr.value);
        const digits = raw.replace(/\D/g, '');
        if (digits.length >= 14) return digits.slice(0, 14);
      }
      const cn = String(attr.value ?? '');
      const m = cn.match(/\d{14}/);
      if (m) return m[0];
    }
    return null;
  } catch {
    return null;
  }
}

function sameCnpjBase(a, b) {
  const da = String(a ?? '').replace(/\D/g, '');
  const db = String(b ?? '').replace(/\D/g, '');
  if (da.length !== 14 || db.length !== 14) return da === db;
  return da.slice(0, 8) === db.slice(0, 8);
}

export function resolveCnpjForDistDfe({ pfx, passphrase, cnpjInformado }) {
  const informado = String(cnpjInformado ?? '').replace(/\D/g, '');
  const doCert = extractCnpjFromPfx(pfx, passphrase);

  if (doCert && informado.length === 14 && !sameCnpjBase(doCert, informado)) {
    return {
      cnpj: doCert,
      aviso: `CNPJ do formulário (${informado}) difere do certificado (${doCert}). Usando o CNPJ do certificado A1.`,
    };
  }
  if (doCert && informado.length !== 14) {
    return { cnpj: doCert, aviso: `CNPJ preenchido automaticamente a partir do certificado: ${doCert}.` };
  }
  return { cnpj: informado, aviso: null };
}

export function parseDistDfeSoapResponse(xmlText) {
  const cStat = readSoapTag(xmlText, 'cStat');
  const xMotivo = readSoapTag(xmlText, 'xMotivo');
  const ultNSU = readSoapTag(xmlText, 'ultNSU');
  const maxNSU = readSoapTag(xmlText, 'maxNSU');

  const docZip = [];
  for (const m of String(xmlText ?? '').matchAll(/<docZip\b([^>]*)>([\s\S]*?)<\/docZip>/gi)) {
    const attrs = m[1] ?? '';
    const nsu = attrs.match(/\bNSU="([^"]+)"/i)?.[1] ?? '';
    const schema = attrs.match(/\bschema="([^"]+)"/i)?.[1] ?? '';
    const base64 = String(m[2] ?? '').replace(/\s/g, '');
    if (base64) docZip.push({ nsu, schema, base64 });
  }

  return { cStat, xMotivo, ultNSU, maxNSU, docZip };
}

function readSoapTag(xml, localName) {
  const re = new RegExp(`<(?:[\\w]+:)?${localName}>([\\s\\S]*?)</(?:[\\w]+:)?${localName}>`, 'i');
  const m = String(xml ?? '').match(re);
  return m?.[1]?.trim() ?? '';
}

async function decodeDocZipBase64(base64) {
  const buf = Buffer.from(String(base64 ?? '').replace(/\s/g, ''), 'base64');
  const out = await unzipAsync(buf);
  return out.toString('utf8');
}

function sefazErrorMessage({ cStat, xMotivo, httpStatus, body }) {
  // HTTP-level falha (bloqueio de WAF/proxy, não uma rejeição de negócio da SEFAZ)
  // — nunca deve ser confundido com um cStat real (ex.: 656, 215).
  if (httpStatus && httpStatus >= 400) {
    if (httpStatus === 403) {
      return 'SEFAZ bloqueou a conexão (HTTP 403) — provavelmente o firewall do órgão recusou a requisição (IP ou identificação do cliente). Tente novamente em alguns minutos; se persistir, pode ser bloqueio do IP do servidor.';
    }
    return `SEFAZ retornou HTTP ${httpStatus} (não é um erro de negócio da SEFAZ). ${String(body ?? '').slice(0, 180)}`.trim();
  }
  if (cStat === '656') {
    return 'SEFAZ cStat 656: consumo indevido — aguarde ~1 hora antes de nova consulta (limite de requisições).';
  }
  if (cStat) return `SEFAZ cStat ${cStat}: ${xMotivo}`.trim();
  return 'Falha na consulta Distribuição DF-e.';
}

async function callDistDfeWithVariants({ pfx, passphrase, cnpj, cUFAutor, tpAmb, ultNSU }) {
  const url = SEFAZ_DIST_URL[String(tpAmb)] ?? SEFAZ_DIST_URL['1'];
  const variants = distDfeEnvelopeVariants({
    cnpj: String(cnpj).replace(/\D/g, ''),
    tpAmb: String(tpAmb),
    ultNSU,
    cUFAutor,
  });

  let last = { cStat: '215', xMotivo: 'Falha no esquema xml', docZip: [], httpStatus: 0 };

  for (const variant of variants) {
    const { status, body } = await postSoapMtls({
      url,
      pfx,
      passphrase,
      body: variant.xml,
      soapVersion: variant.soapVersion,
      soapAction: SOAP_ACTION,
    });

    if (status >= 400) {
      // HTTP-level (ex.: 403 de WAF) — não é um cStat de negócio da SEFAZ,
      // mantém cStat vazio para não ser confundido com uma rejeição real.
      last = { cStat: '', xMotivo: body.slice(0, 200), docZip: [], httpStatus: status };
      continue;
    }

    const parsed = parseDistDfeSoapResponse(body);
    last = parsed;

    if (parsed.cStat === '137' || parsed.cStat === '138') {
      return { ...parsed, variant: variant.label };
    }

    // cStat 243 (mal formado) e 215 (schema) — tenta próximo formato de envelope
    if (parsed.cStat === '215' || parsed.cStat === '243' || !parsed.cStat) {
      continue;
    }

    return { ...parsed, variant: variant.label };
  }

  return last;
}

async function processDistPage({ data, pfx, passphrase, cnpj, tpAmb, dataInicio, dataFim, manifestarCiencia, notas, itensEstoque, creditosSugeridos, seenChaves, resumosParaManifestar, avisos }) {
  const cStat = String(data.cStat ?? '');

  if (!cStat || (cStat !== '137' && cStat !== '138')) {
    return {
      ok: false,
      mensagem: sefazErrorMessage({
        cStat: data.cStat,
        xMotivo: data.xMotivo,
        httpStatus: data.httpStatus,
        body: data.xMotivo,
      }),
      stop: true,
    };
  }

  if (cStat === '137') {
    return { ok: true, stop: true };
  }

  for (const doc of data.docZip ?? []) {
    let xml = '';
    try {
      xml = await decodeDocZipBase64(doc.base64);
    } catch {
      continue;
    }

    const isResumoSchema = /resNFe/i.test(doc.schema ?? '') || /<resNFe\b/i.test(xml);
    const parsed = parseNfeXmlString(xml, { dataInicio, dataFim });
    if (!parsed) continue;

    if (parsed.isResumo || isResumoSchema) {
      if (!seenChaves.has(parsed.nota.chave)) {
        seenChaves.add(parsed.nota.chave);
        notas.push(parsed.nota);
        if (manifestarCiencia) resumosParaManifestar.add(parsed.nota.chave);
      }
      continue;
    }

    if (!seenChaves.has(parsed.nota.chave)) {
      seenChaves.add(parsed.nota.chave);
      notas.push(parsed.nota);
    }
    itensEstoque.push(...parsed.itens);
    creditosSugeridos.push(...parsed.creditos);
  }

  return { ok: true, stop: false };
}

/**
 * Robô SEFAZ — Distribuição DF-e (ConsNSU) + manifesto ciência + nova consulta para XML completo.
 */
export async function consultarNfeDistDfeSefaz(params) {
  const {
    pfx,
    passphrase,
    cnpj,
    uf,
    tpAmb,
    dataInicio = '',
    dataFim = '',
    ultNSUInicial = '0',
    manifestarCiencia = true,
  } = params;

  const cUFAutor = resolveCUfAutor(uf);
  const notas = [];
  const itensEstoque = [];
  const creditosSugeridos = [];
  const seenChaves = new Set();
  const resumosParaManifestar = new Set();
  const avisos = [];

  let ultNSU = padNsu(ultNSUInicial);
  let maxNSU = ultNSU;
  let manifestados = 0;
  // O protocolo Distribuição DF-e da SEFAZ pagina por NSU (cursor), não por data — não há
  // como "pedir um mês inteiro" numa chamada só. MAX_PAGINAS limita quantas páginas essa
  // sincronização busca de uma vez (evita sessões longas demais / risco de bloqueio cStat 656).
  // Quando o período pedido tem mais notas do que cabe nesse limite, a busca para no meio sem
  // erro — mas silenciosamente, o que parecia "travar"/"dar erro" ao tentar puxar >1 mês.
  // `incompleto` sinaliza esse caso para o chamador poder avisar o usuário a continuar depois.
  let incompleto = false;

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
    const data = await callDistDfeWithVariants({
      pfx,
      passphrase,
      cnpj,
      cUFAutor,
      tpAmb,
      ultNSU,
    });

    const pageResult = await processDistPage({
      data,
      pfx,
      passphrase,
      cnpj,
      tpAmb,
      dataInicio,
      dataFim,
      manifestarCiencia,
      notas,
      itensEstoque,
      creditosSugeridos,
      seenChaves,
      resumosParaManifestar,
      avisos,
    });

    if (!pageResult.ok) {
      return {
        ok: false,
        mensagem: pageResult.mensagem,
        notas: [],
        itensEstoque: [],
        creditosSugeridos: [],
        ultNSU,
        maxNSU,
      };
    }

    const nextUlt = padNsu(data.ultNSU ?? ultNSU);
    maxNSU = padNsu(data.maxNSU ?? maxNSU);
    ultNSU = nextUlt;
    if (pageResult.stop || ultNSU >= maxNSU) break;
    if (pagina === MAX_PAGINAS - 1) incompleto = true;
  }

  if (manifestarCiencia && resumosParaManifestar.size > 0) {
    const lote = await manifestarCienciaEmLote({
      pfx,
      passphrase,
      cnpj,
      chaves: [...resumosParaManifestar],
      tpAmb: String(tpAmb),
    });
    manifestados = lote.manifestados;
    if (lote.manifestados > 0) {
      avisos.push(`${lote.manifestados} nota(s) com ciência da operação registrada na SEFAZ.`);
    } else if (lote.total > 0) {
      avisos.push('Manifesto de ciência não confirmado — tente novamente em alguns minutos.');
    }

    for (let pagina = 0; pagina < MANIFESTO_RECONSULTA_PAGINAS; pagina += 1) {
      const data = await callDistDfeWithVariants({
        pfx,
        passphrase,
        cnpj,
        cUFAutor,
        tpAmb,
        ultNSU,
      });

      const pageResult = await processDistPage({
        data,
        pfx,
        passphrase,
        cnpj,
        tpAmb,
        dataInicio,
        dataFim,
        manifestarCiencia: false,
        notas,
        itensEstoque,
        creditosSugeridos,
        seenChaves,
        resumosParaManifestar: new Set(),
        avisos,
      });

      if (!pageResult.ok) break;

      ultNSU = padNsu(data.ultNSU ?? ultNSU);
      maxNSU = padNsu(data.maxNSU ?? maxNSU);
      if (pageResult.stop || ultNSU >= maxNSU) break;
    }
  }

  return {
    ok: true,
    notas,
    itensEstoque,
    creditosSugeridos,
    avisos,
    ultNSU,
    maxNSU,
    manifestados,
    incompleto,
    fonte: 'sefaz_distdfe',
  };
}
