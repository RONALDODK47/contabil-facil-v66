import { createContext, useContext } from 'react';
import type { BotTab, TabBotLogEntry } from './tabBotTypes';

export interface TabBotContextValue {
  active: boolean;
  runningTab: BotTab | null;
  logs: TabBotLogEntry[];
  unreadCount: number;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  activateBot: (tab: BotTab) => Promise<void>;
  deactivateBot: () => void;
  appendLog: (entry: Omit<TabBotLogEntry, 'id' | 'at'>) => void;
  clearUnread: () => void;
}

export const TabBotContext = createContext<TabBotContextValue | null>(null);

export function useTabBot(): TabBotContextValue {
  const ctx = useContext(TabBotContext);
  if (!ctx) throw new Error('useTabBot deve estar dentro de TabBotProvider');
  return ctx;
}
