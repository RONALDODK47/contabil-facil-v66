import { useEffect, useRef } from 'react';
import { Bot, Loader2, Power, ScrollText, Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTabBot } from './TabBotContext';
import type { BotTab } from './tabBotTypes';
import { TAB_BOT_LABELS } from './tabBotTypes';

export interface TabBotToolbarProps {
  tab: BotTab;
  company: string;
}

function autoBotSessionKey(tab: BotTab, company: string): string {
  return `cf-autobot-${tab}-${company}`;
}

export default function TabBotToolbar({ tab, company }: TabBotToolbarProps) {
  const bot = useTabBot();
  const meta = TAB_BOT_LABELS[tab];
  const running = bot.runningTab === tab;
  const autoStartedRef = useRef(false);

  useEffect(() => {
    autoStartedRef.current = false;
  }, [tab, company]);

  useEffect(() => {
    if (autoStartedRef.current || bot.runningTab) return;
    const key = autoBotSessionKey(tab, company);
    if (sessionStorage.getItem(key) === '1') return;
    autoStartedRef.current = true;
    sessionStorage.setItem(key, '1');
    const timer = window.setTimeout(() => {
      void bot.activateBot(tab);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [tab, company, bot.runningTab, bot.activateBot]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4 p-3 border border-brand-border bg-brand-sidebar/40">
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-widest opacity-50 flex items-center gap-1">
          <Sparkles size={10} />
          IA automatiza tudo · Gemini
        </p>
        <p className="text-xs font-semibold truncate">{meta.mission}</p>
      </div>
      <div className="flex flex-wrap gap-2 shrink-0">
        <button
          type="button"
          disabled={Boolean(bot.runningTab)}
          onClick={() => void bot.activateBot(tab)}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider',
            'border border-brand-border bg-brand-accent text-brand-bg',
            'hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />}
          {running ? 'IA automatizando…' : 'Automatizar tudo'}
        </button>
        {bot.active ? (
          <button
            type="button"
            onClick={bot.deactivateBot}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase border border-brand-border hover:bg-brand-sidebar"
          >
            <Power size={14} />
            Desligar
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            bot.setPanelOpen(true);
            bot.clearUnread();
          }}
          className="relative inline-flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase border border-brand-border hover:bg-brand-sidebar"
        >
          <ScrollText size={14} />
          Log
          {bot.unreadCount > 0 ? (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-black flex items-center justify-center">
              {bot.unreadCount > 9 ? '9+' : bot.unreadCount}
            </span>
          ) : null}
        </button>
      </div>
    </div>
  );
}
