/**
 * Motor de conhecimento — espelho FlowMind (APIs + builtin antes do LLM).
 */
import { classificarSentido } from './dicionario-sentidos.mjs';
import { ehContinuacaoConversa, ehFactualExplicito, normalizarCurto } from './conversa-contexto.mjs';
import {
  consultarBuiltin,
  consultarCep,
  consultarCnpj,
  consultarClima,
  consultarCotacao,
  consultarDuckDuckGo,
  consultarWikipedia,
} from './fontes-publicas.mjs';

const LLAMA_APENAS = new Set(['conversa_casual', 'conversa_meta', 'saudacao']);

/** Perguntas de conhecimento — tenta web antes do LLM (PC com pouca RAM). */
const CONHECIMENTO_WEB = new Set([
  'geral',
  'definicao',
  'geografia',
  'ciencia',
  'historia',
  'tecnologia',
]);

const SEM_CACHE = new Set(['saudacao', 'conversa_casual', 'conversa_meta']);

const cache = new Map();

function cacheKey(msg, sentidoId) {
  return `${sentidoId}::${normalizarCurto(msg)}`;
}

async function consultarFonte(fonte, sentidoId, meta, mensagem, nomeIa) {
  if (fonte === 'builtin') return consultarBuiltin(sentidoId, meta, mensagem, nomeIa);
  if (fonte === 'wikipedia') return consultarWikipedia(meta.termo_busca || mensagem);
  if (fonte === 'duckduckgo') return consultarDuckDuckGo(meta.termo_busca || mensagem);
  if (fonte === 'brasilapi') {
    if (sentidoId === 'cep' && meta.cep) return consultarCep(meta.cep);
    if (sentidoId === 'cnpj' && meta.cnpj) return consultarCnpj(meta.cnpj);
    return { ok: false, resposta: '', fonte: 'brasilapi' };
  }
  if (fonte === 'awesomeapi') return consultarCotacao(meta.moedas);
  if (fonte === 'open_meteo') return consultarClima(meta.cidade, meta);
  return { ok: false, resposta: '', fonte };
}

/**
 * @param {string} mensagem
 * @param {Array<{role?:string,content?:string,text?:string}>} [historico]
 * @param {{ forcar?: boolean, nomeIa?: string }} [opts]
 */
export async function responderInteligente(mensagem, historico, opts = {}) {
  const msg = String(mensagem ?? '').trim();
  if (!msg || msg.length < 2) return null;

  if (!opts.forcar && ehContinuacaoConversa(msg, historico)) return null;

  const { sentido, meta } = classificarSentido(msg, historico);
  const nomeIa = opts.nomeIa ?? 'IA';

  if (!opts.forcar) {
    if (LLAMA_APENAS.has(sentido.id)) return null;
    if (historico?.length && normalizarCurto(msg).split(/\s+/).length <= 4) return null;
  }

  if (!SEM_CACHE.has(sentido.id)) {
    const hit = cache.get(cacheKey(msg, sentido.id));
    if (hit) return hit;
  }

  for (const fonte of sentido.fontes) {
    const r = await consultarFonte(fonte, sentido.id, meta, msg, nomeIa);
    if (r.ok && r.resposta) {
      if (!SEM_CACHE.has(sentido.id)) cache.set(cacheKey(msg, sentido.id), r.resposta);
      return r.resposta;
    }
  }

  if (sentido.id === 'geral' || opts.forcar) {
    for (const fn of [consultarWikipedia, consultarDuckDuckGo]) {
      const r = await fn(meta.termo_busca || msg);
      if (r.ok && r.resposta) {
        cache.set(cacheKey(msg, sentido.id), r.resposta);
        return r.resposta;
      }
    }
  }

  return null;
}

/**
 * Resposta factual rápida — só APIs estruturadas (FlowMind eh_factual_explicito).
 */
export async function tentarRespostaFactual(mensagem, historico, nomeIa) {
  const { sentido } = classificarSentido(mensagem, historico);
  if (!ehFactualExplicito(mensagem, sentido.id, historico)) return null;
  return responderInteligente(mensagem, historico, { forcar: true, nomeIa });
}

/**
 * Conhecimento geral via Wikipedia/DDG — evita travar o LLM em PC fraco.
 */
export async function tentarRespostaConhecimento(mensagem, historico, nomeIa) {
  if (ehContinuacaoConversa(mensagem, historico)) return null;

  const { sentido, meta } = classificarSentido(mensagem, historico);
  if (!CONHECIMENTO_WEB.has(sentido.id)) return null;

  const termo = meta.termo_busca || mensagem;
  for (const fn of [consultarWikipedia, consultarDuckDuckGo]) {
    const r = await fn(termo);
    if (r.ok && r.resposta) {
      return r.resposta;
    }
  }
  return null;
}

/**
 * Pipeline rápido completo antes do LLM: factual → conhecimento web.
 */
export async function tentarRespostaRapida(mensagem, historico, nomeIa) {
  const factual = await tentarRespostaFactual(mensagem, historico, nomeIa);
  if (factual) return factual;
  return tentarRespostaConhecimento(mensagem, historico, nomeIa);
}
