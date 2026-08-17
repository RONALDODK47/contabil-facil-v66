import type { BotTab, TabBotAutomationResult } from './tabBotTypes';

const AGENT_BASE =
  typeof import.meta.env.VITE_AGENT_API_URL === 'string' && import.meta.env.VITE_AGENT_API_URL
    ? import.meta.env.VITE_AGENT_API_URL.replace(/\/$/, '')
    : '/api/agent';

export interface TabBotIaReview {
  ok: boolean;
  summary: string;
  warnings: string[];
  suggestions: string[];
  skipped?: boolean;
  reason?: string;
}

export async function requestTabBotIaReview(params: {
  tab: BotTab;
  company: string;
  automation: TabBotAutomationResult;
  snapshot?: Record<string, unknown>;
}): Promise<TabBotIaReview> {
  try {
    const res = await fetch(`${AGENT_BASE}/bot/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      return {
        ok: false,
        summary: err.error ?? `API bot retornou ${res.status}`,
        warnings: [],
        suggestions: [],
      };
    }
    return (await res.json()) as TabBotIaReview;
  } catch (e) {
    return {
      ok: false,
      summary: e instanceof Error ? e.message : 'Falha ao contactar API do bot',
      warnings: [],
      suggestions: [],
      skipped: true,
      reason: 'api_offline',
    };
  }
}
