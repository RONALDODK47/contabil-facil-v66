/**
 * Cérebro do agente — Gemini free tier (chat + bot contábil).
 */
import { localAiDisplayLabel } from './local-ai-labels.mjs';
import { callGemini, isGeminiConfigured } from './gemini-client.mjs';
import { buildConversationContext } from './conversation-history.mjs';
import { flowmindFallbackOffline, flowmindInstantReply } from './flowmind-instant-reply.mjs';
import { tentarRespostaRapida } from './motor-conhecimento.mjs';
import { ehContinuacaoConversa } from './conversa-contexto.mjs';

const FERRAMENTA_NOME = 'Eye Vision / ContabilFacil';

export function nomeCerebro(modelId) {
  return localAiDisplayLabel(modelId);
}

export function systemChat(modelId) {
  const nome = nomeCerebro(modelId);
  return `Você é **${nome}**, IA do ${FERRAMENTA_NOME} (Google Gemini free tier).
Tom calmo, natural, português do Brasil. Pode conversar por horas sobre qualquer assunto.

REGRAS:
- Use o histórico da conversa — o usuário pode falar por muito tempo.
- Responda de forma clara e direta; cumprimentos podem ser curtos, temas profundos podem ser mais longos.
- «pq?» / «por quê?»: explique pelo que foi dito antes.
- Não invente dados do sistema contábil — se não souber, diga honestamente.
- Você é ${nome}, a IA conversacional — não o software em si.`;
}

export function systemAgente(modelId) {
  return `${systemChat(modelId)}

Modo agente: use ferramentas só quando o usuário pedir ação real no software (exportar, validar, listar contratos).`;
}

function prepareMessages(model, messages, agent) {
  const system = agent ? systemAgente(model) : systemChat(model);
  const hasSystem = messages.some((m) => m.role === 'system');
  const base = hasSystem ? messages : [{ role: 'system', content: system }, ...messages];
  return buildConversationContext(
    base.map((m) => ({
      role: m.role === 'model' ? 'assistant' : m.role,
      content: String(m.content ?? m.text ?? ''),
    })),
    { maxTurns: 16, maxChars: 700 },
  );
}

function extrairHistorico(messages) {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'model')
    .map((m) => ({
      role: m.role === 'model' || m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content ?? m.text ?? ''),
    }))
    .filter((m) => m.content.trim());
}

function messagesToPrompt(messages) {
  return messages
    .map((m) => {
      const role =
        m.role === 'assistant' || m.role === 'model'
          ? 'Assistente'
          : m.role === 'system'
            ? 'Sistema'
            : 'Usuário';
      return `${role}: ${m.content}`;
    })
    .join('\n\n');
}

async function emitirResposta(texto, onToken) {
  if (onToken && texto) {
    for (const chunk of texto.match(/.{1,12}/gs) ?? [texto]) {
      onToken(chunk);
    }
  }
  return { text: texto, functionCalls: [] };
}

export async function cerebroChat(params) {
  const { model, messages, fast, agent, signal, onToken } = params;
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const userText = String(lastUser?.content ?? lastUser?.text ?? '').trim();
  const historico = extrairHistorico(messages.slice(0, -1));
  const nome = nomeCerebro(model);

  const instant = flowmindInstantReply(userText);
  if (instant && fast && !ehContinuacaoConversa(userText, historico)) {
    return emitirResposta(instant, onToken);
  }

  const rapida = await tentarRespostaRapida(userText, historico, nome);
  if (rapida) {
    return emitirResposta(rapida, onToken);
  }

  if (!isGeminiConfigured()) {
    return emitirResposta(flowmindFallbackOffline(nome, userText), onToken);
  }

  const fullMessages = prepareMessages(model, messages, agent);
  const systemMsg = fullMessages.find((m) => m.role === 'system');
  const chatMessages = fullMessages.filter((m) => m.role !== 'system');

  try {
    const out = await callGemini({
      model,
      systemInstruction: systemMsg?.content ?? systemChat(model),
      userContent: messagesToPrompt(chatMessages),
      temperature: fast ? 0.65 : 0.75,
      signal,
    });
    return emitirResposta(out.text, onToken);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return emitirResposta(flowmindFallbackOffline(nome, userText), onToken);
  }
}

export async function warmupCerebro(_baseUrl, _model) {
  if (!isGeminiConfigured()) return false;
  try {
    await callGemini({ userContent: 'Responda: OK', temperature: 0 });
    return true;
  } catch {
    return false;
  }
}
