/**
 * Aplica regras de limpeza (cleanup) ao histórico dos lançamentos.
 * Remove termos específicos do histórico, mantendo o resto.
 * 
 * Exemplo: "COMISSAO EXTRA 0 SALDO DIA" com regra "SALDO DIA"
 * Resultado: "COMISSAO EXTRA 0"
 */

import { normalizeExtratoMatchText } from './extratoRegrasContasStorage';

/**
 * Remove termos de cleanup do histórico, respeitando case/acentos/sinais.
 */
export function applyCleanupRulesToHistory(
  history: string,
  cleanupRules: string[],
): string {
  if (!history || cleanupRules.length === 0) return history;

  let result = history;

  for (const rule of cleanupRules) {
    const ruleNormalized = normalizeExtratoMatchText(rule);
    
    // Cria regex para encontrar e remover o termo (case-insensitive)
    // Usa word boundaries para evitar remover partes de palavras
    const regex = new RegExp(`\\b${escapeRegExp(ruleNormalized)}\\b`, 'gi');
    result = result.replace(regex, '').trim();
    
    // Remove espaços extras
    result = result.replace(/\s+/g, ' ').trim();
  }

  return result;
}

/**
 * Escapa caracteres especiais do regex.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Aplica cleanup rules a um array de BankStatement rows.
 */
export function applyCleanupRulesToExtratoRows<T extends { description?: string }>(
  rows: T[],
  cleanupRules: string[],
): T[] {
  if (cleanupRules.length === 0) return rows;

  return rows.map((row) => ({
    ...row,
    description: row.description
      ? applyCleanupRulesToHistory(row.description, cleanupRules)
      : row.description,
  }));
}
