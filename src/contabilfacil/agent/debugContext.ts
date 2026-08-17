import type { ActiveTab } from '../types';
import { launcherEntry } from '../tabLauncher/tabLauncherCatalog';

export type DebugModuleId = ActiveTab | 'launcher' | 'system';

export interface DebugContext {
  module: DebugModuleId;
  moduleLabel: string;
  subTab?: string;
  subTabLabel?: string;
  company?: string;
}

export function resolveDebugContextFromActiveTab(tab: ActiveTab): DebugContext {
  const meta = launcherEntry(tab);
  return {
    module: tab,
    moduleLabel: meta?.name ?? tab,
  };
}

let currentContext: DebugContext = {
  module: 'system',
  moduleLabel: 'Sistema',
};

export function setDebugContext(ctx: DebugContext): void {
  currentContext = { ...ctx };
}

export function patchDebugContext(partial: Partial<DebugContext>): void {
  currentContext = { ...currentContext, ...partial };
}

export function getDebugContext(): DebugContext {
  return { ...currentContext };
}

export function formatDebugContextLabel(ctx: DebugContext): string {
  if (ctx.subTabLabel) return `${ctx.moduleLabel} · ${ctx.subTabLabel}`;
  return ctx.moduleLabel;
}
