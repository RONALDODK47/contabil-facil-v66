import { Users2 } from 'lucide-react';
import { cn } from '../lib/utils';
import type { GestaoPageDef, GestaoPageId } from './gestaoPages';

export interface GestaoSidebarHeaderProps {
  pages: GestaoPageDef[];
  activeId: GestaoPageId;
  onSelect: (pageId: GestaoPageId) => void;
}

export default function GestaoSidebarHeader({ pages, activeId, onSelect }: GestaoSidebarHeaderProps) {
  return (
    <aside className="relative z-10 w-[220px] shrink-0 border-r border-brand-border bg-brand-sidebar flex flex-col overflow-y-auto">
      <div className="px-4 py-3 border-b border-brand-border">
        <p className="text-[9px] font-black uppercase tracking-widest opacity-50">Gestão Empresarial</p>
        <p className="text-[10px] font-mono opacity-40 mt-1 uppercase">Escritório cloud</p>
      </div>

      <nav className="flex-1 py-2" aria-label="Módulos da gestão empresarial">
        {pages.map((page) => {
          const Icon = page.icon;
          const isActive = activeId === page.id;
          return (
            <button
              key={page.id}
              type="button"
              onClick={() => onSelect(page.id)}
              className={cn(
                'w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest transition-all border-l-2',
                isActive
                  ? 'bg-brand-bg border-l-brand-border text-brand-text'
                  : 'border-l-transparent opacity-45 hover:opacity-100 hover:bg-brand-border/5',
              )}
            >
              <Icon size={12} className="shrink-0" />
              <span className="leading-tight flex-1">{page.label}</span>
              {page.shared ? (
                <span
                  title="Área partilhada — visível para todos os utilizadores com acesso"
                  className="shrink-0 opacity-50"
                >
                  <Users2 size={10} />
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
