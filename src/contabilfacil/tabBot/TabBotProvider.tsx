import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ActiveTab } from '../types';
import { registerProactiveChatBridge } from '../agent/agentProactiveBridge';
import { TabBotContext, type TabBotContextValue } from './TabBotContext';
import TabBotLogPanel from './TabBotLogPanel';
import { runTabBot } from './runTabBot';
import type { BotTab, TabBotLogEntry, TabBotLogLevel } from './tabBotTypes';
import { isBotTab } from './tabBotTypes';

export interface TabBotProviderProps {
  children: ReactNode;
  selectedCompany: string;
  activeTab: ActiveTab;
}

function newLogId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function TabBotProvider({ children, selectedCompany, activeTab }: TabBotProviderProps) {
  const [active, setActive] = useState(false);
  const [runningTab, setRunningTab] = useState<BotTab | null>(null);
  const [logs, setLogs] = useState<TabBotLogEntry[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const panelOpenRef = useRef(panelOpen);
  panelOpenRef.current = panelOpen;

  const appendLog = useCallback(
    (entry: Omit<TabBotLogEntry, 'id' | 'at'>) => {
      const full: TabBotLogEntry = { ...entry, id: newLogId(), at: Date.now() };
      setLogs((prev) => [full, ...prev].slice(0, 120));
      if (!panelOpenRef.current) setUnreadCount((n) => n + 1);
    },
    [],
  );

  const clearUnread = useCallback(() => setUnreadCount(0), []);

  const activateBot = useCallback(
    async (tab: BotTab) => {
      if (runningTab) return;
      setActive(true);
      setRunningTab(tab);
      setPanelOpen(true);
      clearUnread();

      const push = (level: TabBotLogLevel, message: string) =>
        appendLog({ tab, level, message });

      push('info', `IA automatizando — ${selectedCompany}`);

      try {
        const result = await runTabBot({ tab, company: selectedCompany, withIaReview: true });
        push(result.ok ? 'success' : 'warning', result.summary);
        for (const line of result.details) {
          push(result.ok ? 'info' : 'warning', line);
        }
      } catch (e) {
        push('error', e instanceof Error ? e.message : 'Falha ao executar o bot');
      } finally {
        setRunningTab(null);
      }
    },
    [appendLog, clearUnread, runningTab, selectedCompany],
  );

  const deactivateBot = useCallback(() => {
    setActive(false);
    setRunningTab(null);
  }, []);

  useEffect(() => {
    registerProactiveChatBridge({
      pushInsight: (payload) => {
        const severity: TabBotLogLevel =
          payload.severity === 'alert'
            ? 'error'
            : payload.severity === 'warning'
              ? 'warning'
              : 'info';
        appendLog({
          tab: payload.source === 'ocr' ? 'ocr' : 'sistema',
          level: severity,
          message: payload.message,
        });
      },
      isChatOpen: () => panelOpenRef.current,
    });
    return () => registerProactiveChatBridge(null);
  }, [appendLog]);

  const value = useMemo<TabBotContextValue>(
    () => ({
      active,
      runningTab,
      logs,
      unreadCount,
      panelOpen,
      setPanelOpen,
      activateBot,
      deactivateBot,
      appendLog,
      clearUnread,
    }),
    [
      active,
      runningTab,
      logs,
      unreadCount,
      panelOpen,
      activateBot,
      deactivateBot,
      appendLog,
      clearUnread,
    ],
  );

  return (
    <TabBotContext.Provider value={value}>
      {children}
      {panelOpen && isBotTab(activeTab) ? (
        <TabBotLogPanel
          tab={activeTab}
          company={selectedCompany}
          onClose={() => {
            setPanelOpen(false);
            clearUnread();
          }}
        />
      ) : null}
    </TabBotContext.Provider>
  );
}
