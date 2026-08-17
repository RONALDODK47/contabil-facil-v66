import type { ActiveTab } from '../types';

/** Abas operacionais com bot de automação contábil. */
export const BOT_TABS = ['manager'] as const;

export type BotTab = (typeof BOT_TABS)[number];

export function isBotTab(tab: ActiveTab): tab is BotTab {
  return (BOT_TABS as readonly string[]).includes(tab);
}

export type TabBotLogLevel = 'info' | 'success' | 'warning' | 'error';

export interface TabBotLogEntry {
  id: string;
  at: number;
  tab: BotTab | 'ocr' | 'sistema';
  level: TabBotLogLevel;
  message: string;
}

export interface TabBotAutomationResult {
  ok: boolean;
  summary: string;
  details?: string[];
  data?: Record<string, unknown>;
}

export interface TabBotRunResult {
  ok: boolean;
  summary: string;
  details: string[];
  iaReview?: string;
  warnings?: string[];
}

export const TAB_BOT_LABELS: Record<BotTab, { title: string; mission: string }> = {
  manager: {
    title: 'IA Contábil',
    mission: 'Automatizar empréstimos, parcelamentos, aplicações e correções contábeis',
  },
};
