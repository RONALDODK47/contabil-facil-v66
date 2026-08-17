import { getAgentHandlers } from '../agent/agentBridge';
import { agentApplyNfeCredits } from '../agent/pricingAgentService';
import {
  loadParcelamentosFromBrowserStorage,
  type SavedParcelamento,
} from '../logic/parcelamentoStorage';
import {
  loadAplicacoesFromBrowserStorage,
  type SavedAplicacao,
} from '../logic/aplicacaoStorage';
import { belongsToCompany, belongsToSindicato, normalizeCompanyName } from '../logic/companyWorkspace';
import {
  buildAplicacaoLancamentosDisplay,
  summarizeAplicacaoLancamentos,
} from '../logic/aplicacaoLancamentosDisplay';
import { registerTabBotHandler } from './tabBotBridge';
import type { TabBotAutomationResult } from './tabBotTypes';

function loanBotRun(): TabBotAutomationResult | Promise<TabBotAutomationResult> {
  const h = getAgentHandlers().loan;
  const details: string[] = [];
  const contracts = h?.listContracts?.() ?? [];

  if (!contracts.length) {
    return { ok: false, summary: 'Nenhum contrato de empréstimo cadastrado.', details };
  }

  const selected = h?.getScheduleSummary?.();
  if (!selected) {
    const first = contracts[0];
    h?.selectContract?.({ id: first.id });
    details.push(`Contrato ${first.contractNumber} selecionado para análise.`);
  }

  const diag = h?.runDominioDiagnostic?.() ?? '';
  if (diag) {
    details.push(diag.length > 1800 ? `${diag.slice(0, 1800)}…` : diag);
  }

  const bloqueios =
    /bloqueio|erro|faltam|inválid/i.test(diag) && !/sem bloqueio|ok\b/i.test(diag);

  if (!bloqueios && h?.exportDominio) {
    const exp = h.exportDominio();
    details.push(exp.message);
    if (!exp.ok) {
      return {
        ok: false,
        summary: 'CPC ok, mas export Domínio falhou — confira cronograma e contas.',
        details,
        data: { contratos: contracts.length },
      };
    }
  }

  const summary = bloqueios
    ? 'Diagnóstico Domínio/CPC com pendências — revise contas e cronograma.'
    : 'Empréstimo automatizado — CPC validado e TXT Domínio gerado.';

  return { ok: !bloqueios, summary, details, data: { contratos: contracts.length } };
}

function installmentsBotRun(company: string): TabBotAutomationResult {
  const norm = normalizeCompanyName(company);
  const items = loadParcelamentosFromBrowserStorage().filter((p: SavedParcelamento) =>
    belongsToCompany(p.companyName, norm),
  );
  if (!items.length) {
    return {
      ok: false,
      summary: 'Nenhum parcelamento cadastrado para este sindicato.',
      details: ['Importe cronograma via OCR ou cadastre manualmente.'],
    };
  }

  const details = items.slice(0, 8).map(
    (p) =>
      `${p.nomeParcelamento || p.numeroParcelamento || p.id}: ${p.quantidadeParcelasStr || '?'} parcela(s)`,
  );
  const prontos = items.filter(
    (p) => Number.parseInt(String(p.quantidadeParcelasStr ?? '0'), 10) > 0,
  ).length;
  const semConta = items.filter(
    (p) => !p.accParcelaDebit?.trim() || !p.accParcelaCredit?.trim(),
  ).length;
  if (semConta > 0) {
    details.push(`${semConta} parcelamento(s) sem conta débito/crédito — complete antes do TXT.`);
  }

  return {
    ok: prontos > 0 && semConta === 0,
    summary:
      semConta > 0
        ? `${prontos} cronograma(s) com contas incompletas.`
        : `${prontos} cronograma(s) prontos para TXT Domínio / lançamentos.`,
    details,
    data: { total: items.length, prontos, semConta },
  };
}

function appsBotRun(company: string): TabBotAutomationResult {
  const norm = normalizeCompanyName(company);
  const items = loadAplicacoesFromBrowserStorage().filter((p: SavedAplicacao) =>
    belongsToSindicato(p.sindicatoName, norm),
  );
  if (!items.length) {
    return {
      ok: false,
      summary: 'Nenhuma aplicação financeira cadastrada.',
      details: ['Cadastre aplicações ou importe via OCR.'],
    };
  }

  const details: string[] = [];
  let lancTotal = 0;
  for (const app of items.slice(0, 6)) {
    const rows = buildAplicacaoLancamentosDisplay(app);
    const sum = summarizeAplicacaoLancamentos(rows);
    lancTotal += rows.length;
    details.push(`${app.nomeAplicacao ?? app.id}: ${rows.length} lançamento(s) previsto(s)`);
  }

  return {
    ok: true,
    summary: `${items.length} aplicação(ões) — ${lancTotal} lançamento(s) próprios mapeados.`,
    details,
    data: { aplicacoes: items.length, lancamentos: lancTotal },
  };
}

function pricingBotRun(company: string): TabBotAutomationResult {
  const details: string[] = [];
  const nfe = agentApplyNfeCredits(company);
  details.push(nfe.message);

  if (nfe.needsSync) {
    details.push('Sincronize NF-e com certificado A1 (integração SEFAZ) antes de aplicar créditos.');
    return {
      ok: false,
      summary: 'NF-e ainda não sincronizada — configure certificado A1 e sincronize.',
      details,
      data: { needsSync: true },
    };
  }

  return {
    ok: nfe.ok,
    summary: nfe.ok
      ? `Créditos a recuperar lançados (${nfe.creditsAdded} crédito(s), ${nfe.stockAdded} item(ns) estoque).`
      : 'NF-e sem créditos novos — sincronize com certificado A1.',
    details,
    data: {
      creditsAdded: nfe.creditsAdded,
      stockAdded: nfe.stockAdded,
      notas: nfe.notasCount,
    },
  };
}

export function registerManagerTabBot(company: string): () => void {
  return registerTabBotHandler('manager', async () => {
    const loan = await Promise.resolve(loanBotRun());
    const inst = installmentsBotRun(company);
    const apps = appsBotRun(company);
    const ok = loan.ok && inst.ok && apps.ok;
    return {
      ok,
      summary: [loan.summary, inst.summary, apps.summary].filter(Boolean).join(' · '),
      details: [...(loan.details ?? []), ...(inst.details ?? []), ...(apps.details ?? [])],
    };
  });
}

export function registerPricingTabBot(company: string): () => void {
  return registerTabBotHandler('pricing' as any, async () => pricingBotRun(company));
}
