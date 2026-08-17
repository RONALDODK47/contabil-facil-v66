import type { ActiveTab } from '../types';
import type { SimTabFields } from '../../lib/simTabFields';

export interface AgentAppContext {
  selectedCompany: string;
  activeTab: ActiveTab;
}

export interface AgentLoanContractSummary {
  id: string;
  contractNumber: string;
  bankName: string;
  type: string;
  principal: number;
  installments: number;
  gracePeriod: number;
}

export interface AgentLoanHandlers {
  listContracts?: () => AgentLoanContractSummary[];
  selectContract?: (opts: { id?: string; contractNumber?: string }) => boolean;
  getScheduleSummary?: () => Record<string, unknown> | null;
  runDominioDiagnostic?: () => string;
  exportDominio?: () => { ok: boolean; message: string };
  exportPdf?: () => { ok: boolean; message: string };
  patchSimTab?: (patch: Partial<SimTabFields>) => { ok: boolean; message: string };
}

export type PricingSubTab =
  | 'dashboard'
  | 'estoque'
  | 'custos'
  | 'creditos'
  | 'dre'
  | 'precificacao'
  | 'comparacao-aliquotas'
  | 'calculos'
  | 'roa';

export interface AgentPricingHandlers {
  navigateSubTab?: (tab: PricingSubTab) => boolean;
  focusStockItem?: (stockItemId: string) => boolean;
}

export interface AgentBridgeHandlers {
  getAppContext?: () => AgentAppContext;
  navigateTab?: (tab: ActiveTab) => void;
  /** Recarrega módulos que leem localStorage (precificação, etc.). */
  refreshWorkspace?: () => void;
  loan?: AgentLoanHandlers;
  pricing?: AgentPricingHandlers;
}

let handlers: AgentBridgeHandlers = {};

export function registerAgentHandlers(partial: AgentBridgeHandlers): void {
  handlers = {
    ...handlers,
    ...partial,
    loan: { ...handlers.loan, ...partial.loan },
    pricing: { ...handlers.pricing, ...partial.pricing },
  };
}

export function unregisterAgentHandlers(scope: 'loan' | 'pricing' | 'app'): void {
  if (scope === 'loan') {
    handlers = { ...handlers, loan: undefined };
  } else if (scope === 'pricing') {
    handlers = { ...handlers, pricing: undefined };
  } else {
    handlers = {};
  }
}

export function getAgentHandlers(): AgentBridgeHandlers {
  return handlers;
}
