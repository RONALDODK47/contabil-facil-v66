/**
 * Parser automático para extratos BB - detecta layout e usa parser apropriado
 * Integração completa entre layout legado e novo v2026
 */

import { parseBbExtratoV2026Text, parseBbExtratoV2026Line, BbExtratoV2026Row } from './bbExtratoV2026Parser';

export interface BbExtratoUnifiedRow {
  data: string;
  historico: string;
  valor: number;
  tipo: 'credito' | 'debito';
  layout: 'legacy' | 'v2026';
  _raw?: any;
}

/**
 * Detecta qual layout de extrato BB está sendo usado
 */
export function detectBbLayoutVersion(text: string): 'v2026' | 'legacy' | 'unknown' {
  if (!text?.trim()) return 'unknown';
  
  const normalizedText = text.toLowerCase().replace(/\s+/g, ' ');
  
  // Detecta v2026: tem colunas estruturadas "Dia | Lote | Documento | Histórico | Valor"
  const hasV2026Structure = (
    /dia\s+lote\s+documento\s+histórico\s+valor/i.test(normalizedText) ||
    /dia\s+lote\s+documento\s+historico\s+valor/i.test(normalizedText) ||
    // Detecta padrão de linha v2026: DD/MM/YYYY seguido de números específicos
    /\d{2}\/\d{2}\/\d{4}\s+\d{4,5}\s+\d{10,15}/.test(text)
  );
  
  if (hasV2026Structure) {
    return 'v2026';
  }
  
  // Detecta layout legado: formato mais simples sem estrutura de colunas definidas
  const hasLegacyStructure = (
    /extrato.*conta.*corrente/i.test(normalizedText) &&
    !hasV2026Structure &&
    /\d{2}\/\d{2}\/\d{4}/.test(text) // Tem datas
  );
  
  if (hasLegacyStructure) {
    return 'legacy';
  }
  
  return 'unknown';
}

/**
 * Converte resultado v2026 para formato unificado
 */
function convertV2026ToUnified(rows: BbExtratoV2026Row[]): BbExtratoUnifiedRow[] {
  return rows.map(row => ({
    data: row.data,
    historico: row.historico,
    valor: row.valor,
    tipo: row.tipo,
    layout: 'v2026' as const,
    _raw: row
  }));
}

/**
 * Fallback para layout legado (implementação básica)
 * TODO: Integrar com parser legado existente se houver
 */
function parseLegacyBbExtrato(text: string): BbExtratoUnifiedRow[] {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  const results: BbExtratoUnifiedRow[] = [];
  
  // Implementação básica para compatibilidade
  // Na produção, isso deveria usar o parser legado existente
  for (const line of lines) {
    // Padrão básico: data + descrição + valor
    const match = line.match(/(\d{2}\/\d{2}\/\d{4}).*?(\d{1,3}(?:\.\d{3})*,\d{2})\s*\(([+-])\)/);
    
    if (match) {
      const [, data, valorStr, sinal] = match;
      const valor = Math.round(parseFloat(valorStr.replace(/\./g, '').replace(',', '.')) * 100);
      const tipo = sinal === '+' ? 'credito' : 'debito';
      
      // Extrair histórico (parte entre data e valor)
      const dataIndex = line.indexOf(data);
      const valorIndex = line.lastIndexOf(valorStr);
      let historico = line.substring(dataIndex + data.length, valorIndex).trim();
      
      if (historico && valor > 0) {
        results.push({
          data,
          historico,
          valor,
          tipo,
          layout: 'legacy',
          _raw: { line }
        });
      }
    }
  }
  
  return results;
}

/**
 * Parser automático principal - detecta layout e usa parser apropriado
 */
export function parseBbExtratoAuto(text: string): BbExtratoUnifiedRow[] {
  const layout = detectBbLayoutVersion(text);
  
  switch (layout) {
    case 'v2026':
      const v2026Rows = parseBbExtratoV2026Text(text);
      return convertV2026ToUnified(v2026Rows);
      
    case 'legacy':
      return parseLegacyBbExtrato(text);
      
    case 'unknown':
    default:
      // Tenta v2026 primeiro, depois legacy como fallback
      try {
        const v2026Rows = parseBbExtratoV2026Text(text);
        if (v2026Rows.length > 0) {
          return convertV2026ToUnified(v2026Rows);
        }
      } catch (error) {
        // Ignore errors, try legacy
      }
      
      return parseLegacyBbExtrato(text);
  }
}

/**
 * Estatísticas do extrato processado
 */
export interface BbExtratoStats {
  totalTransacoes: number;
  totalCreditos: number;
  totalDebitos: number;
  saldoLiquido: number;
  layout: string;
  tiposTransacao: string[];
  periodoInicio?: string;
  periodoFim?: string;
}

/**
 * Calcula estatísticas do extrato
 */
export function calculateBbExtratoStats(rows: BbExtratoUnifiedRow[]): BbExtratoStats {
  const creditos = rows.filter(r => r.tipo === 'credito');
  const debitos = rows.filter(r => r.tipo === 'debito');
  
  const totalCreditos = creditos.reduce((sum, r) => sum + r.valor, 0);
  const totalDebitos = debitos.reduce((sum, r) => sum + r.valor, 0);
  
  // Extrair tipos de transação únicos
  const tiposSet = new Set<string>();
  rows.forEach(row => {
    const tipo = row.historico.split(/\s+/)[0]; // Primeira palavra
    if (tipo) tiposSet.add(tipo);
  });
  
  // Encontrar período
  const datas = rows.map(r => r.data).filter(Boolean).sort();
  
  return {
    totalTransacoes: rows.length,
    totalCreditos,
    totalDebitos,
    saldoLiquido: totalCreditos - totalDebitos,
    layout: rows[0]?.layout || 'unknown',
    tiposTransacao: Array.from(tiposSet),
    periodoInicio: datas[0],
    periodoFim: datas[datas.length - 1]
  };
}

/**
 * Formata valor em centavos para string brasileira
 */
export function formatBrCurrency(centavos: number): string {
  const reais = centavos / 100;
  return reais.toLocaleString('pt-BR', { 
    style: 'currency', 
    currency: 'BRL' 
  });
}

/**
 * Exporta extrato para CSV
 */
export function exportBbExtratoToCsv(rows: BbExtratoUnifiedRow[]): string {
  const headers = ['Data', 'Histórico', 'Crédito', 'Débito', 'Layout'];
  const csvRows = [headers.join(';')];
  
  rows.forEach(row => {
    const credito = row.tipo === 'credito' ? formatBrCurrency(row.valor) : '';
    const debito = row.tipo === 'debito' ? formatBrCurrency(row.valor) : '';
    
    const csvRow = [
      row.data,
      `"${row.historico.replace(/"/g, '""')}"`, // Escape quotes
      credito,
      debito,
      row.layout
    ];
    
    csvRows.push(csvRow.join(';'));
  });
  
  return csvRows.join('\n');
}

/**
 * Exemplo de uso completo
 */
export function exampleUsage() {
  const extratoText = `
04/05/2026  14397  10903125172831  Pix - Recebido 01/05 09:03 55802389168 JOSE ANTONIO D  500,00 (+)
04/05/2026  13105  50401  Pagamento de Boleto GUABI NUTRICAO S ANIMAL LTDA  2.458,92 (-)
  `;
  
  // 1. Parse automático
  const rows = parseBbExtratoAuto(extratoText);
  console.log(`Detectado layout: ${rows[0]?.layout}`);
  console.log(`Transações encontradas: ${rows.length}`);
  
  // 2. Calcular estatísticas
  const stats = calculateBbExtratoStats(rows);
  console.log(`Saldo líquido: ${formatBrCurrency(stats.saldoLiquido)}`);
  
  // 3. Exportar CSV
  const csv = exportBbExtratoToCsv(rows);
  console.log('CSV gerado:', csv.substring(0, 100) + '...');
}