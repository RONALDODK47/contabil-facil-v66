/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface SpedInvoice {
  id: string;
  type: 'entrada' | 'saida';
  date: string;
  description: string;
  value: number;
  cfop?: string;
  documentNumber: string;
  participantName: string;
  pis: number;
  cofins: number;
  icms: number;
  iss?: number;
  /** CSLL/IRPJ/Simples Nacional apurados — só vêm do "Resumo dos Impostos" do Domínio ou do PGDAS-D (SPED não traz esses tributos). */
  csll?: number;
  irpj?: number;
  simplesNacional?: number;
  /** Alíquota PIS (%) do item (A170) */
  aliqPis?: number;
  /** Alíquota COFINS (%) do item (A170) */
  aliqCofins?: number;
  /** CST PIS do item (A170) */
  cstPis?: string;
  /** CST COFINS do item (A170) */
  cstCofins?: string;
  source: 'ICMS' | 'CONTRIBUICOES';
  accountCode?: string;
  /** Lançamento sintético de apuração (Resumo de Impostos Domínio / PDF Impostos) — entra
   * na apuração de tributos (TaxSummary/DailyTaxTable) mas não é uma nota fiscal real, então
   * não deve aparecer na tabela de Notas Fiscais (InvoiceTable). */
  isApuracaoResumo?: boolean;
}

export interface Accumulator {
  code: string;
  description: string;
  totalValue: number;
  pis: number;
  cofins: number;
  icms: number;
  count: number;
}

export interface TaxSummary {
  pisRecuperar: number;
  pisRecolher: number;
  cofinsRecuperar: number;
  cofinsRecolher: number;
  icmsRecuperar: number;
  icmsRecolher: number;
  issRecuperar: number;
  issRecolher: number;
  csllRecuperar: number;
  csllRecolher: number;
  irpjRecuperar: number;
  irpjRecolher: number;
  simplesRecuperar: number;
  simplesRecolher: number;
  totalValue: number;
  totalEntries: number;
  totalExits: number;
}

export interface DailyTaxSummary {
  date: string;
  pisRecuperar: number;
  pisRecolher: number;
  cofinsRecuperar: number;
  cofinsRecolher: number;
  icmsRecuperar: number;
  icmsRecolher: number;
  issRecuperar: number;
  issRecolher: number;
  csllRecuperar: number;
  csllRecolher: number;
  irpjRecuperar: number;
  irpjRecolher: number;
  simplesRecuperar: number;
  simplesRecolher: number;
  totalEntradas: number;
  totalSaidas: number;
}
