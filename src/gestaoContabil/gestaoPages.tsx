import { type ComponentType, type LazyExoticComponent, lazy } from 'react';
import type { LucideIcon } from 'lucide-react';
import GestaoPagePlaceholder from './GestaoPagePlaceholder';
import {
  Bell,
  Building2,
  Calendar,
  Globe,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  MessagesSquare,
  Settings2,
  Trash2,
  UserRound,
} from 'lucide-react';

export type GestaoPageId =
  | 'Dashboard'
  | 'Companies'
  | 'CalendarManagement'
  | 'Exits'
  | 'Chat'
  | 'Notices'
  | 'UsefulSites'
  | 'Trash'
  | 'AppSettings'
  | 'Profile'
  | 'Novidades';

export interface GestaoPageDef {
  id: GestaoPageId;
  route: GestaoPageId;
  label: string;
  icon: LucideIcon;
  shared?: boolean;
  adminOnly?: boolean;
  Component: ComponentType<any>;
}

function createPlaceholder(title: string) {
  return () => <GestaoPagePlaceholder title={title} />;
}

/** Páginas do módulo Gestão Empresarial no Eye Vision (mesmo conjunto do Layout.jsx da Gestão). */
export const GESTAO_PAGES: GestaoPageDef[] = [
  {
    id: 'Dashboard',
    route: 'Dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    Component: createPlaceholder('Dashboard'),
  },
  {
    id: 'Companies',
    route: 'Companies',
    label: 'Empresas',
    icon: Building2,
    shared: true,
    Component: createPlaceholder('Empresas'),
  },
  {
    id: 'CalendarManagement',
    route: 'CalendarManagement',
    label: 'Calendário',
    icon: Calendar,
    shared: true,
    Component: createPlaceholder('Calendário'),
  },
  {
    id: 'Exits',
    route: 'Exits',
    label: 'Baixa e Saída',
    icon: LogOut,
    Component: createPlaceholder('Baixa e Saída'),
  },
  {
    id: 'Chat',
    route: 'Chat',
    label: 'Chat',
    icon: MessagesSquare,
    shared: true,
    Component: createPlaceholder('Chat'),
  },
  {
    id: 'Notices',
    route: 'Notices',
    label: 'Recados',
    icon: MessageSquare,
    Component: createPlaceholder('Recados'),
  },
  {
    id: 'UsefulSites',
    route: 'UsefulSites',
    label: 'Links Úteis',
    icon: Globe,
    Component: createPlaceholder('Links Úteis'),
  },
  {
    id: 'Trash',
    route: 'Trash',
    label: 'Lixeira',
    icon: Trash2,
    Component: createPlaceholder('Lixeira'),
  },
  {
    id: 'AppSettings',
    route: 'AppSettings',
    label: 'Configurações',
    icon: Settings2,
    shared: true,
    Component: createPlaceholder('Configurações'),
  },
  {
    id: 'Profile',
    route: 'Profile',
    label: 'Perfil',
    icon: UserRound,
    Component: createPlaceholder('Perfil'),
  },
  {
    id: 'Novidades',
    route: 'Novidades',
    label: 'Novidades',
    icon: Bell,
    Component: createPlaceholder('Novidades'),
  },
];
