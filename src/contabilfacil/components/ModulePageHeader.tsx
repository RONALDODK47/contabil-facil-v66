import type { ReactNode } from 'react';

export interface ModulePageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function ModulePageHeader({ title, subtitle, actions }: ModulePageHeaderProps) {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-brand-border pb-4 gap-4">
      <div>
        <h1 className="text-2xl font-black tracking-tighter uppercase italic">{title}</h1>
        {subtitle ? (
          <p className="text-[10px] font-bold uppercase opacity-50 tracking-widest">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
