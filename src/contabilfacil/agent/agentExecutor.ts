import type { ActiveTab } from '../types';
import { getAgentHandlers } from './agentBridge';
import type { AgentToolName } from './agentTools';
import { AGENT_SYSTEM_CAPABILITIES } from './agentSystemKnowledge';
import { executeCursorHandoff } from './cursorHandoff';
import type { PricingSubTab } from './agentBridge';
import {
  agentListFinishedProducts,
  agentListStock,
  agentPricingSummary,
  agentReplenishStock,
  agentUpsertStock,
} from './pricingAgentService';
import type { StockCategory } from '../logic/pricingTypes';

function companyFromHandlers(h: ReturnType<typeof getAgentHandlers>): string {
  return h.getAppContext?.()?.selectedCompany?.trim() || '';
}

function afterPricingMutation(h: ReturnType<typeof getAgentHandlers>): void {
  h.refreshWorkspace?.();
}

const VALID_TABS: ActiveTab[] = ['manager', 'admin'];

export async function executeAgentTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; result: unknown }> {
  const h = getAgentHandlers();

  try {
    switch (name as AgentToolName) {
      case 'navegar_aba': {
        const aba = String(args.aba ?? '') as ActiveTab;
        if (!VALID_TABS.includes(aba)) {
          return { ok: false, result: { error: `Aba inválida: ${aba}` } };
        }
        h.navigateTab?.(aba);
        return { ok: true, result: { navegou: aba } };
      }

      case 'obter_contexto_sistema': {
        const ctx = h.getAppContext?.() ?? { selectedCompany: '', activeTab: 'manager' as ActiveTab };
        const contracts = h.loan?.listContracts?.() ?? [];
        const loanReady = Boolean(h.loan?.listContracts);
        return {
          ok: true,
          result: {
            ...ctx,
            decisao: {
              emprestimoRpaDisponivel: loanReady,
              abaRecomendadaParaEmprestimo: 'manager',
            },
            mapa: AGENT_SYSTEM_CAPABILITIES,
            modulos: {
              emprestimo: {
                contratos: contracts.length,
                contratosResumo: contracts.slice(0, 8),
              },
              precificacao: {
                rpaDisponivel: true,
                produtosAcabados: agentListFinishedProducts(
                  companyFromHandlers(h) || ctx.selectedCompany,
                ).total,
              },
            },
          },
        };
      }

      case 'listar_capacidades_sistema': {
        const ctx = h.getAppContext?.() ?? {};
        return {
          ok: true,
          result: {
            contexto: ctx,
            ...AGENT_SYSTEM_CAPABILITIES,
          },
        };
      }

      case 'solicitar_ajuda_cursor': {
        const resumo = String(args.resumo ?? '').trim();
        const limitacao = String(args.limitacao ?? '').trim();
        if (!resumo || !limitacao) {
          return { ok: false, result: { error: 'resumo e limitacao são obrigatórios' } };
        }
        const r = await executeCursorHandoff({
          resumo,
          limitacao,
          tentativas: args.tentativas ? String(args.tentativas) : undefined,
          sugestaoTecnica: args.sugestaoTecnica ? String(args.sugestaoTecnica) : undefined,
          prioridade: (args.prioridade as 'alta' | 'media' | 'baixa') || 'media',
        });
        return { ok: r.ok, result: r };
      }

      case 'listar_contratos_emprestimo': {
        const list = h.loan?.listContracts?.() ?? [];
        return { ok: true, result: { contratos: list, total: list.length } };
      }

      case 'selecionar_contrato_emprestimo': {
        const ok = h.loan?.selectContract?.({
          id: args.id ? String(args.id) : undefined,
          contractNumber: args.numeroContrato ? String(args.numeroContrato) : undefined,
        });
        return ok
          ? { ok: true, result: { selecionado: true } }
          : { ok: false, result: { error: 'Contrato não encontrado ou empréstimo indisponível' } };
      }

      case 'resumo_cronograma_emprestimo': {
        const summary = h.loan?.getScheduleSummary?.();
        if (!summary) {
          return {
            ok: false,
            result: { error: 'Abra a aba Empréstimo e selecione um contrato com cronograma calculado' },
          };
        }
        return { ok: true, result: summary };
      }

      case 'diagnostico_export_dominio': {
        const diag = h.loan?.runDominioDiagnostic?.();
        if (diag === undefined) {
          return { ok: false, result: { error: 'Diagnóstico indisponível — selecione um contrato' } };
        }
        return { ok: true, result: { diagnostico: diag || 'Sem alertas.' } };
      }

      case 'exportar_dominio_txt': {
        const r = h.loan?.exportDominio?.() ?? { ok: false, message: 'Exportação indisponível' };
        return { ok: r.ok, result: r };
      }

      case 'exportar_pdf_cronograma': {
        const r = h.loan?.exportPdf?.() ?? { ok: false, message: 'Exportação indisponível' };
        return { ok: r.ok, result: r };
      }

      case 'listar_produtos_acabados': {
        const company = companyFromHandlers(h);
        if (!company) return { ok: false, result: { error: 'Sindicato não selecionado' } };
        return { ok: true, result: agentListFinishedProducts(company) };
      }

      case 'listar_estoque_precificacao': {
        const company = companyFromHandlers(h);
        if (!company) return { ok: false, result: { error: 'Sindicato não selecionado' } };
        return {
          ok: true,
          result: agentListStock(company, {
            categoria: args.categoria ? (String(args.categoria) as StockCategory) : undefined,
            produtoAcabadoNome: args.produtoAcabadoNome
              ? String(args.produtoAcabadoNome)
              : undefined,
          }),
        };
      }

      case 'resumo_precificacao': {
        const company = companyFromHandlers(h);
        if (!company) return { ok: false, result: { error: 'Sindicato não selecionado' } };
        return { ok: true, result: agentPricingSummary(company) };
      }

      case 'cadastrar_ou_atualizar_estoque': {
        const company = companyFromHandlers(h);
        if (!company) return { ok: false, result: { error: 'Sindicato não selecionado' } };
        const nome = String(args.nome ?? '').trim();
        const categoria = String(args.categoria ?? '') as StockCategory;
        if (!nome || !categoria) {
          return { ok: false, result: { error: 'nome e categoria obrigatórios' } };
        }
        const r = agentUpsertStock(company, {
          id: args.id ? String(args.id) : undefined,
          nome,
          categoria,
          produtoAcabadoNome: args.produtoAcabadoNome
            ? String(args.produtoAcabadoNome)
            : undefined,
          sku: args.sku ? String(args.sku) : undefined,
          unitPrice: typeof args.unitPrice === 'number' ? args.unitPrice : undefined,
          unitsPurchased:
            typeof args.unitsPurchased === 'number' ? args.unitsPurchased : undefined,
          measureQuantity:
            typeof args.measureQuantity === 'number' ? args.measureQuantity : undefined,
          directCost: typeof args.directCost === 'number' ? args.directCost : undefined,
          monthlyQty: typeof args.monthlyQty === 'number' ? args.monthlyQty : undefined,
        });
        if (r.ok) afterPricingMutation(h);
        return { ok: r.ok, result: r };
      }

      case 'repor_estoque_precificacao': {
        const company = companyFromHandlers(h);
        if (!company) return { ok: false, result: { error: 'Sindicato não selecionado' } };
        const r = agentReplenishStock(company, {
          id: args.id ? String(args.id) : undefined,
          nome: args.nome ? String(args.nome) : undefined,
          reporTodos: Boolean(args.reporTodos),
        });
        if (r.ok) afterPricingMutation(h);
        return { ok: r.ok, result: r };
      }

      case 'navegar_subaba_precificacao': {
        const subaba = String(args.subaba ?? '') as PricingSubTab;
        h.navigateTab?.('manager');
        const ui = h.pricing?.navigateSubTab?.(subaba);
        const itemId = args.itemEstoqueId ? String(args.itemEstoqueId) : undefined;
        if (itemId) h.pricing?.focusStockItem?.(itemId);
        return {
          ok: true,
          result: {
            subaba,
            uiSincronizada: Boolean(ui),
            dica: ui
              ? 'Tela de precificação atualizada.'
              : 'Dados salvos; abra Precificação para ver na UI.',
          },
        };
      }

      case 'alterar_parametro_simulacao': {
        const patch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(args)) {
          if (v !== undefined && v !== null && v !== '') patch[k] = v;
        }
        const r = h.loan?.patchSimTab?.(patch as never) ?? {
          ok: false,
          message: 'Simulação indisponível',
        };
        return { ok: r.ok, result: r };
      }

      default:
        return { ok: false, result: { error: `Ferramenta desconhecida: ${name}` } };
    }
  } catch (err) {
    return {
      ok: false,
      result: { error: err instanceof Error ? err.message : 'Erro ao executar ferramenta' },
    };
  }
}
