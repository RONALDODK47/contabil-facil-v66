/**
 * Handler compartilhado — chat do agente via Gemini (Vite + agent-api).
 */
import { loadAiConfig, resolveLocalModelId } from './ai-config-store.mjs';
import { localAiDisplayLabel } from './local-ai-labels.mjs';
import { resolveHardwareLimits, tryInstantCasualReply } from './ai-hardware-limits.mjs';
import { chatLocal, ensureLocalAiEngine, isLocalModelReady } from './local-ai-chat.mjs';
import { nomeCerebro } from './cerebro-agente.mjs';
import { tentarRespostaRapida } from './motor-conhecimento.mjs';

function normalizeContents(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((turn) => {
      const role = turn.role === 'model' || turn.role === 'assistant' ? 'model' : 'user';
      const parts = [];
      if (turn.text) parts.push({ text: String(turn.text) });
      if (turn.functionCall) {
        parts.push({
          functionCall: {
            name: turn.functionCall.name,
            args: turn.functionCall.args ?? {},
            id: turn.functionCall.id,
          },
        });
      }
      if (turn.functionResponse) {
        parts.push({
          functionResponse: {
            name: turn.functionResponse.name,
            id: turn.functionResponse.id,
            response: turn.functionResponse.response ?? {},
          },
        });
      }
      if (parts.length === 0 && Array.isArray(turn.parts)) return { role, parts: turn.parts };
      return parts.length ? { role, parts } : null;
    })
    .filter(Boolean);
}

function contentsToChatMessages(contents, systemInstruction) {
  const messages = [];
  if (systemInstruction) {
    messages.push({ role: 'system', content: systemInstruction });
  }
  for (const turn of contents) {
    const role = turn.role === 'model' ? 'assistant' : 'user';
    const textParts = (turn.parts ?? [])
      .map((p) => {
        if (p.text) return p.text;
        if (p.functionCall) return `[tool_call ${p.functionCall.name}]`;
        if (p.functionResponse) {
          return `[tool_result ${p.functionResponse.name}] ${JSON.stringify(p.functionResponse.response)}`;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
    if (textParts) messages.push({ role, content: textParts });
  }
  return messages;
}

/**
 * @param {{ contents: unknown; systemInstruction?: string; fast?: boolean; stream?: boolean; signal?: AbortSignal; onToken?: (token: string) => void }} params
 */
export async function handleAgentChatRequest(params) {
  const config = loadAiConfig();
  const { contents, systemInstruction, fast, stream, signal, onToken } = params;
  const normalized = normalizeContents(contents);
  if (normalized.length === 0) {
    return { status: 400, body: { error: 'contents vazio' } };
  }

  const localModel = resolveLocalModelId(config);
  const lastUserTurn = [...normalized].reverse().find((t) => t.role === 'user');
  const lastUserText =
    lastUserTurn?.parts?.map((p) => p.text).filter(Boolean).join(' ')?.trim() ?? '';

  if (fast) {
    const instant = tryInstantCasualReply(lastUserText);
    if (instant) {
      return { status: 200, body: { text: instant, functionCalls: [] }, streamTokens: stream ? [instant] : undefined };
    }

    const histTurns = normalized.slice(0, -1).map((t) => ({
      role: t.role === 'model' ? 'assistant' : 'user',
      content: (t.parts ?? []).map((p) => p.text).filter(Boolean).join(' '),
    }));
    const rapida = await tentarRespostaRapida(lastUserText, histTurns, nomeCerebro(localModel));
    if (rapida) {
      return { status: 200, body: { text: rapida, functionCalls: [] }, streamTokens: stream ? [rapida] : undefined };
    }
  }

  const limits = resolveHardwareLimits();
  const ramBaixa = limits.freeRamGb < 1.2;
  const modoFast = Boolean(fast) || ramBaixa;

  const running = await ensureLocalAiEngine();
  if (!running.online) {
    const offline =
      'Gemini indisponível — defina GEMINI_API_KEY no .env e reinicie npm run dev.';
    return {
      status: 200,
      body: { text: offline, functionCalls: [] },
      streamTokens: stream ? [offline] : undefined,
    };
  }

  if (!(await isLocalModelReady(localModel))) {
    const missing = `${localAiDisplayLabel(localModel)} offline — confira GEMINI_API_KEY no .env.`;
    return {
      status: 200,
      body: { text: missing, functionCalls: [] },
      streamTokens: stream ? [missing] : undefined,
    };
  }

  if (signal?.aborted) {
    return { status: 499, body: { error: 'aborted' } };
  }

  const messages = contentsToChatMessages(normalized, systemInstruction);
  const tokens = [];

  const out = await chatLocal({
    model: localModel,
    messages,
    options: {
      fast: modoFast,
      agent: !modoFast && !ramBaixa,
      signal,
      onToken: stream
        ? (token) => {
            tokens.push(token);
            onToken?.(token);
          }
        : undefined,
    },
  });

  return {
    status: 200,
    body: { text: out.text ?? '', functionCalls: out.functionCalls ?? [] },
    streamTokens: stream ? tokens : undefined,
  };
}
