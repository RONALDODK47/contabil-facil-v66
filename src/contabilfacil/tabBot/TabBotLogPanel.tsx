import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTabBot } from './TabBotContext';
import type { BotTab } from './tabBotTypes';
import { TAB_BOT_LABELS } from './tabBotTypes';

export interface TabBotLogPanelProps {
  tab: BotTab;
  company: string;
  onClose: () => void;
}

const levelClass: Record<string, string> = {
  info: 'opacity-80',
  success: 'text-emerald-400',
  warning: 'text-amber-400',
  error: 'text-red-400',
};

export default function TabBotLogPanel({ tab, company, onClose }: TabBotLogPanelProps) {
  const bot = useTabBot();
  if (!bot.panelOpen) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(420px,calc(100vw-2rem))] max-h-[min(420px,55vh)] flex flex-col border border-brand-border bg-brand-bg shadow-2xl">
      <div className="flex items-center justify-between px-3 py-2 border-b border-brand-border bg-brand-sidebar">
        <div>
          <p className="text-xs font-black uppercase tracking-tight">{TAB_BOT_LABELS[tab].title}</p>
          <p className="text-[10px] opacity-50 truncate">{company}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 hover:bg-brand-sidebar border border-transparent hover:border-brand-border"
          aria-label="Fechar log do bot"
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2 text-xs font-mono">
        {bot.logs.length === 0 ? (
          <p className="opacity-40">Nenhuma atividade ainda. Use &quot;Ativar bot&quot; na aba.</p>
        ) : (
          bot.logs.map((entry) => (
            <div key={entry.id} className={cn('leading-relaxed', levelClass[entry.level] ?? '')}>
              <span className="opacity-40 mr-2">
                {new Date(entry.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </span>
              {entry.message}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
