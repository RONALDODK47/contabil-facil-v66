/**
 * Fontes públicas — Wikipedia, BrasilAPI, Open-Meteo, AwesomeAPI (FlowMind).
 */

const UA = 'ContabilFacil/1.0 (conhecimento educacional)';

function resultado(ok, resposta, fonte, url = '', confianca = 0.8) {
  return { ok, resposta: String(resposta ?? '').trim(), fonte, url, confianca: ok ? confianca : 0 };
}

export async function consultarWikipedia(termo, lang = 'pt') {
  const t = String(termo ?? '').trim();
  if (!t || t.length <= 3) return resultado(false, '', 'wikipedia');
  const low = t.toLowerCase().replace(/[?.!]/g, '');
  if (['pq', 'por que', 'porque', 'como assim', 'hm', 'hmm'].includes(low)) {
    return resultado(false, '', 'wikipedia');
  }

  const base = `https://${lang}.wikipedia.org`;
  try {
    const search = await fetch(
      `${base}/w/api.php?action=opensearch&search=${encodeURIComponent(t)}&limit=1&format=json`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12_000) },
    );
    if (!search.ok) return resultado(false, '', 'wikipedia');
    const data = await search.json();
    if (!Array.isArray(data) || data.length < 4 || !data[1]?.[0]) {
      return resultado(false, '', 'wikipedia');
    }
    const titulo = data[1][0];
    const summary = await fetch(`${base}/api/rest_v1/page/summary/${encodeURIComponent(titulo)}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(12_000),
    });
    if (!summary.ok) return resultado(false, '', 'wikipedia');
    const s = await summary.json();
    const extract = String(s.extract ?? '').trim();
    const url = s.content_urls?.desktop?.page ?? `${base}/wiki/${titulo}`;
    if (!extract) return resultado(false, '', 'wikipedia');
    return resultado(true, extract.slice(0, 1200), 'wikipedia', url, 0.85);
  } catch {
    return resultado(false, '', 'wikipedia');
  }
}

export async function consultarDuckDuckGo(termo) {
  const t = String(termo ?? '').trim();
  if (!t) return resultado(false, '', 'duckduckgo');
  try {
    const r = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(t)}&format=json&no_html=1&skip_disambig=1`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) },
    );
    if (!r.ok) return resultado(false, '', 'duckduckgo');
    const data = await r.json();
    const abstract = String(data.AbstractText ?? '').trim();
    const url = data.AbstractURL ?? '';
    if (abstract) return resultado(true, abstract.slice(0, 1200), 'duckduckgo', url, 0.75);
    for (const item of (data.RelatedTopics ?? []).slice(0, 3)) {
      if (item?.Text) return resultado(true, String(item.Text).slice(0, 800), 'duckduckgo', url, 0.6);
    }
  } catch {
    /* ok */
  }
  return resultado(false, '', 'duckduckgo');
}

export async function consultarCep(cep) {
  const digits = String(cep ?? '').replace(/\D/g, '');
  if (digits.length !== 8) return resultado(false, '', 'brasilapi');
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cep/v1/${digits}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return resultado(false, '', 'brasilapi');
    const d = await r.json();
    const endereco = `CEP ${d.cep}: ${d.street ?? ''}, ${d.neighborhood ?? ''}, ${d.city ?? ''} — ${d.state ?? ''}`;
    return resultado(true, endereco.replace(/,\s*,/g, ',').trim(), 'brasilapi', 'https://brasilapi.com.br', 0.95);
  } catch {
    return resultado(false, '', 'brasilapi');
  }
}

export async function consultarCnpj(cnpj) {
  const digits = String(cnpj ?? '').replace(/\D/g, '');
  if (digits.length !== 14) return resultado(false, '', 'brasilapi');
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) return resultado(false, '', 'brasilapi');
    const d = await r.json();
    const nome = d.razao_social || d.nome_fantasia || 'Empresa';
    const situacao = d.descricao_situacao_cadastral ?? '?';
    const municipio = `${d.municipio ?? ''} — ${d.uf ?? ''}`.trim();
    return resultado(
      true,
      `**${nome}**\nSituação: ${situacao}\nLocal: ${municipio}`,
      'brasilapi',
      'https://brasilapi.com.br',
      0.95,
    );
  } catch {
    return resultado(false, '', 'brasilapi');
  }
}

export async function consultarCotacao(moedas = ['USD']) {
  const pares = moedas.slice(0, 4).map((m) => `${m}-BRL`).join(',');
  try {
    const r = await fetch(`https://economia.awesomeapi.com.br/json/last/${pares}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return resultado(false, '', 'awesomeapi');
    const data = await r.json();
    const linhas = [];
    for (const [key, item] of Object.entries(data)) {
      if (!item || typeof item !== 'object') continue;
      const par = item.code ?? key;
      linhas.push(`**${par}/BRL:** R$ ${item.bid ?? '?'} (variação: ${item.pctChange ?? '?'}%)`);
    }
    if (linhas.length) {
      return resultado(true, `Cotações atuais:\n${linhas.join('\n')}`, 'awesomeapi', 'https://economia.awesomeapi.com.br', 0.9);
    }
  } catch {
    /* ok */
  }
  return resultado(false, '', 'awesomeapi');
}

export async function consultarClima(cidade, meta = {}) {
  if (!cidade) {
    const txt =
      meta.pedir_cidade || meta.contexto_tempo
        ? 'Claro! Me diz de qual **cidade** você quer saber — por exemplo, «São Paulo» ou «clima em Curitiba».'
        : 'Posso consultar o clima na hora! Qual **cidade** você quer saber?';
    return resultado(true, txt, 'contabilfacil', '', 0.95);
  }
  try {
    const geo = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cidade)}&count=1&language=pt&format=json`,
      { signal: AbortSignal.timeout(12_000) },
    );
    if (!geo.ok) return resultado(false, '', 'open_meteo');
    const geoData = await geo.json();
    const loc = geoData.results?.[0];
    if (!loc) return resultado(false, `Não encontrei a cidade «${cidade}».`, 'open_meteo');

    const wx = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m`,
      { signal: AbortSignal.timeout(12_000) },
    );
    if (!wx.ok) return resultado(false, '', 'open_meteo');
    const cur = (await wx.json()).current ?? {};
    const nome = loc.name ?? cidade;
    const pais = loc.country ?? '';
    const texto = `Clima em **${nome}** (${pais}): ${cur.temperature_2m ?? '?'}°C, umidade ${cur.relative_humidity_2m ?? '?'}%, vento ${cur.wind_speed_10m ?? '?'} km/h.`;
    return resultado(true, texto, 'open_meteo', 'https://open-meteo.com', 0.9);
  } catch {
    return resultado(false, '', 'open_meteo');
  }
}

function calcularSeguro(expr) {
  const clean = String(expr ?? '')
    .replace(/x/gi, '*')
    .replace(/[^\d+\-*/.\s]/g, '')
    .trim();
  if (!/^[\d\s+\-*/.]+$/.test(clean)) throw new Error('inválida');
  // eslint-disable-next-line no-new-func
  const val = Function(`"use strict"; return (${clean})`)();
  if (!Number.isFinite(val)) throw new Error('inválida');
  return val;
}

function saudacaoBuiltin(mensagem) {
  const t = mensagem.toLowerCase().trim().replace(/[!?.…]/g, '');
  if (t.includes('boa noite')) return 'Boa noite!';
  if (t.includes('bom dia')) return 'Bom dia!';
  if (t.includes('boa tarde')) return 'Boa tarde!';
  if (['oi', 'ola', 'hey', 'eai', 'e ai', 'salve'].includes(t)) return 'Oi!';
  return 'Olá!';
}

export function consultarBuiltin(sentidoId, meta, mensagem, nomeIa) {
  const t = mensagem.toLowerCase();
  const agora = new Date();
  const hora = agora.getHours();
  const cumprimento = hora >= 18 ? 'Boa noite' : hora >= 12 ? 'Boa tarde' : 'Bom dia';

  if (sentidoId === 'conversa_casual') {
    if (['frio', 'calor', 'chuva', 'chovendo'].some((x) => t.includes(x))) {
      const sensacao = t.includes('frio') ? 'frio' : t.includes('calor') ? 'calor' : 'instável';
      return resultado(
        true,
        `${cumprimento}! Pois é, parece **${sensacao}** por aí mesmo. Se quiser a temperatura certinha, me fala sua cidade.`,
        'contabilfacil',
        '',
        1,
      );
    }
    if (['como ta', 'como esta', 'como vai', 'tudo bem', 'td bem', 'blz', 'beleza'].some((x) => t.includes(x))) {
      return resultado(true, `${cumprimento}! Por aqui tudo certo — e com você, como vai?`, 'contabilfacil', '', 1);
    }
    return resultado(true, `${cumprimento}! Tudo bem por aqui — e com você?`, 'contabilfacil', '', 1);
  }

  if (sentidoId === 'capacidades') {
    return resultado(
      true,
      `Sou **${nomeIa}**, IA local do **Eye Vision / ContabilFacil**. Posso conversar sobre qualquer assunto, consultar clima, CEP, cotações, explicar conceitos e ajudar no software (empréstimos, precificação, exportação Domínio, validação CPC).`,
      'contabilfacil',
      '',
      1,
    );
  }

  if (sentidoId === 'saudacao') {
    return resultado(true, saudacaoBuiltin(mensagem), 'contabilfacil', '', 1);
  }

  if (sentidoId === 'conversa_meta') {
    return resultado(
      true,
      `Sou **${nomeIa}** — gosto de conversar sobre tecnologia, ciência, história, curiosidades… Pergunte o que vier na cabeça! Quando quiser que o **ContabilFacil** execute algo, use «exporta», «valida» ou «lista contratos».`,
      'contabilfacil',
      '',
      1,
    );
  }

  if (sentidoId === 'sobre_sistema') {
    return resultado(
      true,
      'O **Eye Vision / ContabilFacil** é um software contábil brasileiro com empréstimos, precificação, SPED, OCR de extratos e **Gemini AI** (free tier) para auditoria OCR e bot contábil por aba.',
      'contabilfacil',
      '',
      1,
    );
  }

  if (sentidoId === 'data_hora') {
    const fmt = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const parts = fmt.formatToParts(agora);
    const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
    return resultado(
      true,
      `Agora são **${get('hour')}:${get('minute')}** do dia **${get('day')}/${get('month')}/${get('year')}** (horário de Brasília).`,
      'contabilfacil',
      '',
      1,
    );
  }

  if (sentidoId === 'matematica') {
    try {
      const expr = String(meta.expressao ?? '').replace(/x/gi, '*').trim();
      const val = calcularSeguro(expr);
      const txt = Number.isInteger(val) ? String(val) : String(Number(val.toFixed(6))).replace(/\.?0+$/, '');
      return resultado(true, `O resultado de **${expr}** é **${txt}**.`, 'contabilfacil', '', 1);
    } catch {
      return resultado(false, '', 'contabilfacil');
    }
  }

  return resultado(false, '', 'contabilfacil');
}
