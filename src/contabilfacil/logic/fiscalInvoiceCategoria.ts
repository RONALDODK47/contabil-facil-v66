import type { SpedInvoice } from '../components/fiscal/types';

export type FiscalInvoiceCategoria = 'entradas' | 'saidas' | 'servicos' | 'impostos';

/** Apurações sintéticas (Resumo de Impostos Domínio / PGDAS-D) — não são notas fiscais reais. */
export function isImpostoInvoice(inv: SpedInvoice): boolean {
  return (
    inv.isApuracaoResumo === true ||
    !!inv.documentNumber?.startsWith('RESUMO-') ||
    inv.documentNumber === 'IMPOSTO-PDF'
  );
}

/** Mesma categorização usada no select "Limpar" e na aba Acumuladores. */
export function categorizarInvoiceFiscal(inv: SpedInvoice): FiscalInvoiceCategoria {
  if (isImpostoInvoice(inv)) return 'impostos';
  if (inv.type === 'entrada') return 'entradas';
  if (inv.description?.startsWith('Serviço prestado')) return 'servicos';
  return 'saidas';
}
