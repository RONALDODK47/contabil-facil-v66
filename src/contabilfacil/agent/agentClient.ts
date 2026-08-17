import { buildAgentSystemPrompt } from './agentSystemKnowledge';

let cachedSystemPrompt: string | null = null;

/** Prompt completo do agente — carregado só em pedidos complexos. */
export function getAgentSystemPrompt(): string {
  if (!cachedSystemPrompt) {
    cachedSystemPrompt = buildAgentSystemPrompt();
  }
  return cachedSystemPrompt;
}

export interface AgentChatTurn {
  role: 'user' | 'model';
  text?: string;
  functionCall?: { id?: string; name: string; args: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: unknown };
}

export interface AgentChatResponse {
  text: string;
  functionCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
}

const AGENT_BASE =
  typeof import.meta.env.VITE_AGENT_API_URL === 'string' && import.meta.env.VITE_AGENT_API_URL
    ? import.meta.env.VITE_AGENT_API_URL.replace(/\/$/, '')
    : '/api/agent';

export interface AgentHealthPayload {
  ok?: boolean;
  configured?: boolean;
  label?: string;
  tier?: string;
  model?: string;
  providerId?: string;
  detail?: string;
}

export async function fetchAgentHealth(): Promise<AgentHealthPayload> {
  try {
    const res = await fetch(`${AGENT_BASE}/health`, { method: 'GET' });
    if (!res.ok) {
      return { ok: false, label: 'IA offline', detail: `HTTP ${res.status}` };
    }
    return (await res.json()) as AgentHealthPayload;
  } catch {
    return { ok: false, label: 'IA offline' };
  }
}

export async function pingAgentApi(): Promise<boolean> {
  const data = await fetchAgentHealth();
  return Boolean(data.ok);
}

function friendlyAgentFetchError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === 'fetch failed' || msg.includes('Failed to fetch')) {
    return new Error('Conexão com a IA interrompida. Confirme que o software está aberto (npm run dev).');
  }
  return err instanceof Error ? err : new Error(msg);
}

export const AGENT_CHAT_FAST_PROMPT =
  'Você é a IA amigável do Eye Vision / ContabilFacil. Converse em português BR de forma natural — pode ser curto em cumprimentos ou mais longo em temas profundos. Use o histórico da conversa. Não invente dados do sistema — se precisar de ação real (exportar, validar, listar contratos), diga que pode executar quando o usuário pedir como comando.';

export async function callAgentChat(params: {
  contents: AgentChatTurn[];
  tools: unknown[];
  systemInstruction: string;
  fast?: boolean;
  signal?: AbortSignal;
}): Promise<AgentChatResponse> {
  let res: Response;
  const timeoutMs = 90_000;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal =
    params.signal && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([params.signal, timeoutSignal])
      : params.signal ?? timeoutSignal;
  try {
    res = await fetch(`${AGENT_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw friendlyAgentFetchError(err);
  }
  const data = (await res.json()) as AgentChatResponse & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Agent API HTTP ${res.status}`);
  }
  return {
    text: data.text ?? '',
    functionCalls: data.functionCalls ?? [],
  };
}

export async function callAgentChatStream(params: {
  contents: AgentChatTurn[];
  tools: unknown[];
  systemInstruction: string;
  fast?: boolean;
  signal?: AbortSignal;
  onToken: (token: string) => void;
}): Promise<AgentChatResponse> {
  const timeoutMs = 120_000;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal =
    params.signal && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([params.signal, timeoutSignal])
      : params.signal ?? timeoutSignal;

  let res: Response;
  try {
    res = await fetch(`${AGENT_BASE}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw friendlyAgentFetchError(err);
  }

  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Agent API HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  let functionCalls: AgentChatResponse['functionCalls'] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      try {
        const chunk = JSON.parse(raw) as {
          token?: string;
          done?: boolean;
          functionCalls?: AgentChatResponse['functionCalls'];
        };
        if (chunk.token) {
          text += chunk.token;
          params.onToken(chunk.token);
        }
        if (chunk.done) {
          functionCalls = chunk.functionCalls ?? [];
        }
      } catch {
        /* ok */
      }
    }
  }

  return { text, functionCalls };
}
