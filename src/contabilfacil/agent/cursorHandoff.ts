import { getAgentHandlers } from './agentBridge';
import { AGENT_SYSTEM_CAPABILITIES } from './agentSystemKnowledge';

const AGENT_BASE =
  typeof import.meta.env.VITE_AGENT_API_URL === 'string' && import.meta.env.VITE_AGENT_API_URL
    ? import.meta.env.VITE_AGENT_API_URL.replace(/\/$/, '')
    : '/api/agent';

export interface CursorHandoffParams {
  resumo: string;
  limitacao: string;
  tentativas?: string;
  sugestaoTecnica?: string;
  prioridade?: 'alta' | 'media' | 'baixa';
}

export async function executeCursorHandoff(
  params: CursorHandoffParams,
): Promise<{ ok: boolean; message: string; details: Record<string, unknown> }> {
  const ctx = getAgentHandlers().getAppContext?.();
  const contexto = {
    ...ctx,
    capacidades: AGENT_SYSTEM_CAPABILITIES,
    timestamp: new Date().toISOString(),
  };

  let serverResult: Record<string, unknown> = {};
  try {
    const res = await fetch(`${AGENT_BASE}/cursor-handoff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, contexto }),
    });
    serverResult = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        message: String(serverResult.error || 'Falha ao registrar handoff'),
        details: serverResult,
      };
    }
  } catch (err) {
    serverResult = { error: err instanceof Error ? err.message : 'API offline' };
  }

  const clipboardPrompt =
    String(serverResult.clipboardPrompt) ||
    `Contábil Fácil — ${params.resumo}. Limitação: ${params.limitacao}. Implementar no código.`;

  try {
    await navigator.clipboard.writeText(clipboardPrompt);
  } catch {
    /* clipboard pode falhar sem gesto do usuário */
  }

  const disabled = Boolean(serverResult.disabled);

  return {
    ok: true,
    message: disabled
      ? 'Escalação registrada. Prompt copiado para a área de transferência — cole no Composer (Ctrl+I) se quiser pedir a correção manualmente.'
      : 'Prompt copiado para a área de transferência — cole no Composer (Ctrl+I).',
    details: { ...serverResult, clipboardPrompt },
  };
}
