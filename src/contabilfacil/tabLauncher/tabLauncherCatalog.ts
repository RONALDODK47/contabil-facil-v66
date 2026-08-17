import type { ActiveTab } from '../types';

export interface TabLauncherEntry {
  id: ActiveTab;
  name: string;
  symbol: string;
  /** Pasta lógica — cada aba como mini software */
  folder: string;
  description: string;
  /** Módulos operacionais aparecem primeiro */
  primary: boolean;
}

/** Catálogo de mini softwares — só o escolhido é montado na RAM. */
export const TAB_LAUNCHER_CATALOG: TabLauncherEntry[] = [
  {
    id: 'manager',
    name: 'Contábil',
    symbol: 'C',
    folder: 'modules/manager',
    description: 'Contábil, empréstimos, parcelamento e aplicações',
    primary: true,
  },
  {
    id: 'ferramentas',
    name: 'Gestao Contabil',
    symbol: 'G',
    folder: 'modules/ferramentas',
    description: 'Recados, pendências, links úteis e gestão de tarefas',
    primary: true,
  },
];

export function launcherEntry(tab: ActiveTab): TabLauncherEntry | undefined {
  return TAB_LAUNCHER_CATALOG.find((e) => e.id === tab);
}
