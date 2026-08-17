/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExtractedRow } from './types';

/**
 * Exports transaction rows to a clean, Portuguese-Excel-friendly CSV file.
 * Uses semicolons (;) as column delimiters and commas (,) as decimal delimiters.
 */
export function exportToCSV(rows: ExtractedRow[], fileName: string = 'extrato_recortado.csv') {
  if (rows.length === 0) return;

  // Header line
  // In Portuguese: Data, Histórico, Valor Original, Tipo, Valor Numérico
  const headers = ['DATA', 'HISTORICO', 'VALOR_TEXTO', 'TIPO', 'VALOR_NUMERICO'];
  
  const csvRows = [
    // Prepend UTF-8 BOM so Excel opens special characters (like Ó, Ç, Ã) perfectly
    '\uFEFF' + headers.join(';'),
  ];

  rows.forEach((row) => {
    const type = row.isNegative ? 'DESPESA' : 'RECEITA';
    
    // Format numeric value for Portuguese Excel (comma as decimal separator)
    let formattedNum = '';
    if (row.parsedValue !== null) {
      formattedNum = row.parsedValue.toFixed(2).replace('.', ',');
    }

    // Escape fields to handle commas, semicolons or double quotes
    const escapeField = (str: string) => {
      if (!str) return '';
      const escaped = str.replace(/"/g, '""');
      if (escaped.includes(';') || escaped.includes('\n') || escaped.includes('"')) {
        return `"${escaped}"`;
      }
      return escaped;
    };

    const line = [
      escapeField(row.dateText),
      escapeField(row.historyText),
      escapeField(row.valueText),
      escapeField(type),
      escapeField(formattedNum),
    ];

    csvRows.push(line.join(';'));
  });

  const csvContent = csvRows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
