import { getAgentHandlers } from '../agent/agentBridge';
import { runTabBotAutomation } from './tabBotBridge';
import { requestTabBotIaReview } from './tabBotClient';
import type { BotTab, TabBotRunResult } from './tabBotTypes';
import { TAB_BOT_LABELS } from './tabBotTypes';

export async function runTabBot(params: {
  tab: BotTab;
  company: string;
  withIaReview?: boolean;
}): Promise<TabBotRunResult> {
  const { tab, company, withIaReview = true } = params;
  const label = TAB_BOT_LABELS[tab].title;

  const automation = await runTabBotAutomation(tab);
  const details = [...(automation.details ?? [])];

  if (!withIaReview) {
    return {
      ok: automation.ok,
      summary: automation.summary,
      details,
    };
  }

  const ctx = getAgentHandlers().getAppContext?.();
  const ia = await requestTabBotIaReview({
    tab,
    company,
    automation,
    snapshot: {
      aba: tab,
      sindicato: company,
      abaAtual: ctx?.activeTab,
      missao: TAB_BOT_LABELS[tab].mission,
    },
  });

  if (ia.warnings.length) details.push(...ia.warnings.map((w) => `⚠️ ${w}`));
  if (ia.suggestions.length) details.push(...ia.suggestions.map((s) => `💡 ${s}`));

  const summary = ia.skipped
    ? `${automation.summary} (IA offline — só automação local)`
    : ia.summary || automation.summary;

  return {
    ok: automation.ok && (ia.ok || ia.skipped === true),
    summary: `[${label}] ${summary}`,
    details,
    iaReview: ia.skipped ? undefined : ia.summary,
    warnings: ia.warnings,
  };
}
