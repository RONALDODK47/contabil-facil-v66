import type { SpedInvoice } from '../components/fiscal/types';
import { sanitizeCfop } from '../components/fiscal/spedParser';
import { normalizeExtratoMatchText } from './extratoRegrasContasStorage';
import { filterRegrasPorAcumulador, type FiscalAcumuladorRegra } from './fiscalAcumuladorRegrasStorage';

const CFOP_REGRA_PATTERN = /^CFOP\s+/;

/**
 * Resolve qual regra do Fiscal vale para uma nota/apuração. Uma regra específica (fornecedor,
 * histórico, tipo de imposto) sempre vence uma regra "puxar por CFOP" — mesmo que o texto do
 * CFOP seja mais longo — porque uma reconciliação separada de uma NF não pode ser puxada para
 * o grupo genérico do CFOP.
 */
export function resolverRegraFiscalParaInvoice(
  inv: SpedInvoice,
  regras: FiscalAcumuladorRegra[],
): FiscalAcumuladorRegra | null {
  const pool = filterRegrasPorAcumulador(regras, inv.accountCode);
  const norm = normalizeExtratoMatchText(`${inv.participantName || ''} ${inv.description || ''}`);

  let best: FiscalAcumuladorRegra | null = null;
  let bestLen = 0;
  for (const r of pool) {
    if (!r.descricao || CFOP_REGRA_PATTERN.test(r.descricao)) continue;
    if (!norm.includes(r.descricao)) continue;
    if (r.descricao.length > bestLen) {
      bestLen = r.descricao.length;
      best = r;
    }
  }
  if (best) return best;

  const cfop = sanitizeCfop(inv.cfop);
  if (!cfop) return null;
  const cfopTexto = normalizeExtratoMatchText(`CFOP ${cfop}`);
  return pool.find((r) => CFOP_REGRA_PATTERN.test(r.descricao) && r.descricao === cfopTexto) ?? null;
}
