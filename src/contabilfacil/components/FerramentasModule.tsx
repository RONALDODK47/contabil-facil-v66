import { useState } from 'react';
import { MessageSquare, Link2, LayoutGrid } from 'lucide-react';
import { cn } from '../lib/utils';
import RecadosPendenciasTab from './RecadosPendenciasTab';
import LinksUteisTab from './LinksUteisTab';
import GestaoTarefasTab from './GestaoTarefasTab';

type FerramentasSubTab = 'recados_pendencias' | 'links_uteis' | 'gestao_tarefas';

const TABS: { id: FerramentasSubTab; label: string; icon: typeof MessageSquare }[] = [
  { id: 'recados_pendencias', label: 'Recados & Pendências', icon: MessageSquare },
  { id: 'links_uteis', label: 'Links Úteis', icon: Link2 },
  { id: 'gestao_tarefas', label: 'Gestão de Tarefas', icon: LayoutGrid },
];

function ferramentasSubTabLabel(tab: FerramentasSubTab): string {
  return TABS.find((t) => t.id === tab)?.label ?? tab;
}

interface FerramentasModuleProps {
  storageVersion?: number;
}

export default function FerramentasModule(_props: FerramentasModuleProps) {
  const [activeSubTab, setActiveSubTab] = useState<FerramentasSubTab>('recados_pendencias');

  return (
    <div className="h-full flex min-h-0">
      <aside className="w-[220px] shrink-0 border-r border-brand-border bg-brand-sidebar flex flex-col overflow-y-auto">
        <div className="px-4 py-3 border-b border-brand-border">
          <p className="text-[9px] font-black uppercase tracking-widest opacity-50">Ferramentas</p>
        </div>
        <nav className="flex-1 py-2" aria-label="Ferramentas">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveSubTab(tab.id)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest transition-all border-l-2',
                  activeSubTab === tab.id
                    ? 'bg-brand-bg border-l-brand-border text-brand-text'
                    : 'border-l-transparent opacity-45 hover:opacity-100 hover:bg-brand-border/5',
                )}
              >
                <Icon size={12} className="shrink-0" />
                <span className="leading-tight">{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="flex-1 min-h-0 overflow-y-auto relative">
        <div className="mx-auto space-y-6 min-w-0 p-8 max-w-7xl">
          <div>
            <h2 className="text-xl font-black text-brand-text uppercase italic tracking-tighter">
              {ferramentasSubTabLabel(activeSubTab)}
            </h2>
            <p className="text-[9px] font-mono font-bold opacity-50 uppercase tracking-[0.2em] mt-1">
              Status: Processamento Integrado
            </p>
          </div>

          {activeSubTab === 'recados_pendencias' && <RecadosPendenciasTab />}
          {activeSubTab === 'links_uteis' && <LinksUteisTab />}
          {activeSubTab === 'gestao_tarefas' && <GestaoTarefasTab />}
        </div>
      </div>
    </div>
  );
}
