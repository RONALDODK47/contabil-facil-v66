import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';
import type { SpedFiscalItem } from '../../extratoVision/utils/spedFiscalParser';
import { inferSpedFiscalNatureza } from '../../extratoVision/utils/spedFiscalParser';
import { contasParaImpostoLancamento, type FiscalContasImpostoConfig } from './fiscalContasImposto';
import {
  regraDoAcumulador,
  type FiscalAcumuladorContasMap,
} from './fiscalAcumuladorContasStorage';

export const FISCAL_RAZAO_MARCA = 'SPED-FISC';

export type FiscalSpedLinhaRazao = {
  item: SpedFiscalItem;
  data: string;
  fileName: string;
};

export type BuildFiscalRazaoResult = {
  rows: VisionBalanceteRow[];
  gerados: number;
  pendencias: string[];
};

function normalizeConta(conta: string): { codigo: string; classificacao: string } {
  const classificacao = conta.trim();
  const codigo = classificacao.replace(/\./g, '') || classificacao;
  return { codigo, classificacao };
}

/** Usa fim do período quando data vier como intervalo (01/12/2025 — 31/12/2025). */
export function parseDataLancamentoFiscal(data: string, fallback?: string): string {
  const t = (data ?? '').trim();
  if (t.includes('—') || t.includes('–')) {
    const parts = t.split(/[—–]/).map((s) => s.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(last)) return last;
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) return t;
  const fb = (fallback ?? '').trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(fb)) return fb;
  return fb || t || '—';
}

export function isFiscalRazaoRow(row: VisionBalanceteRow): boolean {
  return (row.classificacao ?? '').startsWith(FISCAL_RAZAO_MARCA);
}

/**
 * Gera partidas dobradas no razão: débito na conta configurada + crédito na contrapartida.
 * Considera apenas itens de imposto (valores a recolher / apuração).
 */
export function buildRazaoFromFiscalSped(
  linhas: FiscalSpedLinhaRazao[],
  contas: FiscalContasImpostoConfig,
  ordemInicial = 1,
  acumuladorContas: FiscalAcumuladorContasMap = {},
): BuildFiscalRazaoResult {
  const rows: VisionBalanceteRow[] = [];
  const pendencias: string[] = [];
  let ordem = ordemInicial;
  let gerados = 0;

  for (const linha of linhas) {
    const { item, data, fileName } = linha;
    if (item.kind !== 'imposto' && item.kind !== 'acumulador') continue;

    const valor = Math.abs(item.valor);
    if (valor < 0.0001) continue;

    const regraAcumulador = item.kind === 'acumulador' ? regraDoAcumulador(acumuladorContas, item) : null;
    // Valor só fiscal: não conta, não lança no balancete — fica de fora por completo.
    if (regraAcumulador?.valorFiscal) continue;

    const natureza = item.natureza ?? inferSpedFiscalNatureza(item);
    const par =
      regraAcumulador != null
        ? { debito: regraAcumulador.debito, credito: regraAcumulador.credito }
        : contasParaImpostoLancamento(contas, item.imposto, natureza);
    if (!par.debito.trim() || !par.credito.trim()) {
      const rotulo = item.kind === 'acumulador' ? 'acumulador' : 'imposto';
      const tipoConta =
        natureza === 'devedora' ? 'débito e crédito a recuperar' : 'débito e crédito a recolher';
      pendencias.push(
        `${item.imposto} (${item.registro}, ${rotulo}): configure ${tipoConta} na subaba Contas`,
      );
      continue;
    }

    const dataLanc = parseDataLancamentoFiscal(data);
    const rotuloNatureza =
      natureza === 'credora'
        ? item.kind === 'acumulador'
          ? 'Acumulador a recolher'
          : 'Imposto a recolher'
        : item.kind === 'acumulador'
          ? 'Acumulador a recuperar'
          : 'Imposto a recuperar';
    const historico = `${rotuloNatureza} ${item.imposto} · ${item.descricao} · ${fileName}`
      .trim()
      .toUpperCase();
    const deb = normalizeConta(par.debito);
    const cred = normalizeConta(par.credito);
    const classificacao = `${FISCAL_RAZAO_MARCA} · ${item.registro} · ${item.codigo}`;

    rows.push({
      codigo: deb.codigo,
      classificacao: deb.classificacao,
      nome: historico,
      data: dataLanc,
      debito: valor,
      credito: 0,
      saldoInicial: 0,
      saldoFinal: 0,
      ordem: ordem++,
      tipo: 'A',
    });
    rows.push({
      codigo: cred.codigo,
      classificacao: cred.classificacao,
      nome: historico,
      data: dataLanc,
      debito: 0,
      credito: valor,
      saldoInicial: 0,
      saldoFinal: 0,
      ordem: ordem++,
      tipo: 'A',
    });
    gerados += 1;
  }

  return { rows, gerados, pendencias };
}

export function mergeFiscalRazaoComExistente(
  existente: VisionBalanceteRow[],
  novos: VisionBalanceteRow[],
): VisionBalanceteRow[] {
  const base = existente.filter((r) => !isFiscalRazaoRow(r));
  const maxOrdem = base.reduce((m, r) => Math.max(m, r.ordem ?? 0), 0);
  const reordenados = novos.map((r, i) => ({ ...r, ordem: maxOrdem + i + 1 }));
  return [...base, ...reordenados];
}
