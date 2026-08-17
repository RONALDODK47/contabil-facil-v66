/**
 * Classificador de intenção — espelho FlowMind motor_conhecimento/dicionario_sentidos.py
 */
import { ehContinuacaoConversa } from './conversa-contexto.mjs';

export const SENTIDOS = {
  saudacao: { id: 'saudacao', fontes: ['builtin'] },
  conversa_casual: { id: 'conversa_casual', fontes: ['builtin'] },
  sobre_sistema: { id: 'sobre_sistema', fontes: ['builtin'] },
  conversa_meta: { id: 'conversa_meta', fontes: ['builtin'] },
  clima: { id: 'clima', fontes: ['open_meteo'] },
  cotacao: { id: 'cotacao', fontes: ['awesomeapi'] },
  cep: { id: 'cep', fontes: ['brasilapi'] },
  cnpj: { id: 'cnpj', fontes: ['brasilapi'] },
  data_hora: { id: 'data_hora', fontes: ['builtin'] },
  matematica: { id: 'matematica', fontes: ['builtin'] },
  tecnologia: { id: 'tecnologia', fontes: ['wikipedia', 'duckduckgo'] },
  definicao: { id: 'definicao', fontes: ['wikipedia', 'duckduckgo'] },
  geografia: { id: 'geografia', fontes: ['wikipedia', 'duckduckgo'] },
  ciencia: { id: 'ciencia', fontes: ['wikipedia', 'duckduckgo'] },
  historia: { id: 'historia', fontes: ['wikipedia'] },
  geral: { id: 'geral', fontes: ['wikipedia', 'duckduckgo'] },
  capacidades: { id: 'capacidades', fontes: ['builtin'] },
};

function normalizar(texto) {
  return String(texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extrairCidade(mensagem) {
  const t = mensagem.trim();
  for (const prefix of ['clima em ', 'tempo em ', 'temperatura em ', 'previsao em ', 'previsão em ']) {
    if (t.toLowerCase().includes(prefix)) {
      return t.toLowerCase().split(prefix)[1]?.trim().replace(/[?.!]/g, '') ?? null;
    }
  }
  return null;
}

function extrairTermo(mensagem) {
  const padroes = [
    /o que (?:é|e)\s+(.+?)\??$/i,
    /quem (?:é|e)\s+(.+?)\??$/i,
    /explique\s+(.+?)\??$/i,
    /explica\s+(.+?)\??$/i,
    /defina\s+(.+?)\??$/i,
    /significa\s+(.+?)\??$/i,
    /capital de\s+(.+?)\??$/i,
    /sobre\s+(.+?)\??$/i,
  ];
  for (const p of padroes) {
    const m = mensagem.match(p);
    if (m) return m[1].trim().replace(/[?.!]/g, '');
  }
  return null;
}

function assistentePediuCidade(historico) {
  const last = [...historico].reverse().find((h) => h.role === 'assistant' || h.role === 'model');
  const txt = String(last?.content ?? last?.text ?? '').toLowerCase();
  return txt.includes('qual cidade') || txt.includes('qual **cidade**') || txt.includes('me diz de qual');
}

/**
 * @param {string} mensagem
 * @param {Array<{role?:string,content?:string,text?:string}>} [historico]
 */
export function classificarSentido(mensagem, historico) {
  const t = normalizar(mensagem);
  const meta = { termo_busca: mensagem.trim() };

  if (ehContinuacaoConversa(mensagem, historico)) {
    return { sentido: SENTIDOS.conversa_casual, meta };
  }

  if (historico?.length && mensagem.split(/\s+/).length <= 5 && assistentePediuCidade(historico)) {
    meta.cidade = mensagem.trim().replace(/[?.!]/g, '');
    return { sentido: SENTIDOS.clima, meta };
  }

  if (
    ['como ta', 'como esta', 'como vai', 'tudo bem', 'td bem', 'blz', 'beleza', 'e ai', 'eai'].some(
      (x) => t.includes(x),
    )
  ) {
    return { sentido: SENTIDOS.conversa_casual, meta };
  }

  if (
    !ehContinuacaoConversa(mensagem, historico) &&
    t.split(/\s+/).length <= 5 &&
    (/\b(oi|ola|hey|salve|eai)\b/.test(t) ||
      t.includes('bom dia') ||
      t.includes('boa tarde') ||
      t.includes('boa noite'))
  ) {
    return { sentido: SENTIDOS.saudacao, meta };
  }

  if (
    ['clima', 'tempo', 'temperatura', 'vai chover', 'previsao', 'frio', 'calor', 'chuva', 'chovendo', 'umidade'].some(
      (x) => t.includes(x),
    )
  ) {
    const cidade = extrairCidade(mensagem);
    if (cidade) meta.cidade = cidade;
    return { sentido: SENTIDOS.clima, meta };
  }

  if (
    [
      'o que voce pode',
      'o que você pode',
      'o que pode fazer',
      'o que faz',
      'o que sabe fazer',
      'suas funcoes',
      'suas funções',
      'suas capacidades',
      'para que serve',
    ].some((x) => t.includes(x))
  ) {
    return { sentido: SENTIDOS.capacidades, meta };
  }

  if (
    ['contabilfacil', 'eye vision', 'este sistema', 'este app', 'este programa', 'flowmind'].some((x) =>
      t.includes(x),
    )
  ) {
    return { sentido: SENTIDOS.sobre_sistema, meta };
  }

  if (['voce e', 'você é', 'quem e voce', 'quem é você', 'o que voce e', 'o que você é'].some((x) => t.includes(x))) {
    return { sentido: SENTIDOS.sobre_sistema, meta };
  }

  if (['sobre o que', 'do que gosta', 'quer conversar', 'falar sobre'].some((x) => t.includes(x))) {
    return { sentido: SENTIDOS.conversa_meta, meta };
  }

  const cepMatch = mensagem.match(/\b(\d{5})-?(\d{3})\b/);
  if (cepMatch) {
    meta.cep = `${cepMatch[1]}${cepMatch[2]}`;
    return { sentido: SENTIDOS.cep, meta };
  }

  const cnpjDigits = mensagem.replace(/\D/g, '');
  if (/\d{2}\.?\d{3}\.?\d{3}/.test(mensagem) && cnpjDigits.length >= 14) {
    meta.cnpj = cnpjDigits.slice(0, 14);
    return { sentido: SENTIDOS.cnpj, meta };
  }

  if (['dolar', 'dólar', 'euro', 'cotacao', 'cotação', 'usd', 'eur', 'bitcoin', 'btc'].some((x) => t.includes(x))) {
    meta.moedas = [];
    if (t.includes('dolar') || t.includes('dólar') || t.includes('usd')) meta.moedas.push('USD');
    if (t.includes('euro') || t.includes('eur')) meta.moedas.push('EUR');
    if (t.includes('bitcoin') || t.includes('btc')) meta.moedas.push('BTC');
    if (!meta.moedas.length) meta.moedas = ['USD'];
    return { sentido: SENTIDOS.cotacao, meta };
  }

  if (['que horas', 'que dia', 'data de hoje', 'hora agora'].some((x) => t.includes(x))) {
    return { sentido: SENTIDOS.data_hora, meta };
  }

  const mathMatch = t.replace(/x/g, '*').match(/(\d+(?:[.,]\d+)?\s*[\+\-\*\/]\s*\d+(?:[.,]\d+)?)/);
  if (mathMatch || /quanto e|quanto é|calcule|calcula|resultado de/.test(t)) {
    const expr = mathMatch?.[1] ?? mensagem.replace(/quanto e|quanto é|calcule|calcula|resultado de|\?/gi, '').trim();
    if (/\d/.test(expr)) {
      meta.expressao = expr;
      return { sentido: SENTIDOS.matematica, meta };
    }
  }

  if (
    ['python', 'javascript', 'java', 'react', 'fastapi', 'programacao', 'programação', 'codigo', 'código', 'api', 'docker'].some(
      (x) => t.includes(x),
    )
  ) {
    meta.termo_busca = extrairTermo(mensagem) || mensagem;
    return { sentido: SENTIDOS.tecnologia, meta };
  }

  if (['capital de', 'pais', 'país', 'cidade de', 'onde fica', 'localizado'].some((x) => t.includes(x))) {
    meta.termo_busca = extrairTermo(mensagem) || mensagem;
    return { sentido: SENTIDOS.geografia, meta };
  }

  if (['historia', 'história', 'guerra', 'revolucao', 'revolução', 'imperio', 'império'].some((x) => t.includes(x))) {
    meta.termo_busca = extrairTermo(mensagem) || mensagem;
    return { sentido: SENTIDOS.historia, meta };
  }

  if (['ciencia', 'ciência', 'fisica', 'física', 'quimica', 'química', 'biologia', 'astronomia'].some((x) => t.includes(x))) {
    meta.termo_busca = extrairTermo(mensagem) || mensagem;
    return { sentido: SENTIDOS.ciencia, meta };
  }

  if (['o que e', 'o que é', 'defina', 'definicao', 'definição', 'significa', 'explique', 'explica'].some((x) => t.includes(x))) {
    meta.termo_busca = extrairTermo(mensagem) || mensagem;
    return { sentido: SENTIDOS.definicao, meta };
  }

  if (mensagem.includes('?')) {
    if (['pq', 'por que', 'porque', 'como assim'].includes(t) || t.startsWith('pq ')) {
      return { sentido: SENTIDOS.conversa_casual, meta };
    }
    if (t.split(/\s+/).length <= 3 && historico?.length) {
      return { sentido: SENTIDOS.conversa_casual, meta };
    }
    meta.termo_busca = extrairTermo(mensagem) || mensagem;
    return { sentido: SENTIDOS.geral, meta };
  }

  return { sentido: SENTIDOS.conversa_meta, meta };
}
