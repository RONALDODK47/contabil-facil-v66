/**
 * Parser do novo layout de extrato Banco do Brasil (2026+).
 * Formato de tabela estruturada com colunas: Dia | Lote | Documento | Histórico | Valor
 * 
 * Características:
 * - Tabela com cabeçalhos bem definidos
 * - Histórico detalhado com data/hora e CPF/CNPJ
 * - Valores em coluna específica com (+) ou (-)
 * - Data separada em coluna específica
 */

export interface BbExtratoV2026Row {
  data: string;           // DD/MM/YYYY
  lote?: string;          // Número do lote
  documento?: string;     // Documento/ID
  historico: string;      // Descrição completa
  valor: number;          // Valor em centavos
  tipo: 'credito' | 'debito'; // C ou D
  _linhaOcr?: string;     // Linha original para debug
}

const RE_DATA_BR = /^(\d{2}\/\d{2}\/\d{4})$/;
const RE_VALOR_CD = /(\d{1,3}(?:\.\d{3})*,\d{2})\s*\(([+-])\)/;
const RE_LINHA_DATA_LOTE = /^(\d{2}\/\d{2}\/\d{4})\s+(\d{4,5})?/;

/** Converte valor brasileiro para número */
function parseValorBr(valor: string): number {
  if (!valor) return 0;
  const clean = valor
    .replace(/\./g, '')
    .replace(',', '.')
    .trim();
  return Math.round(parseFloat(clean) * 100);
}

/** Verifica se é linha de cabeçalho da tabela */
function isTableHeader(line: string): boolean {
  const t = line.toLowerCase();
  return /dia|lote|documento|histórico|valor/i.test(t) && line.length < 100;
}

/** Verifica se é linha de saldo/totalizador */
function isSaldoOrTotalLine(line: string): boolean {
  const t = line.toLowerCase();
  return /saldo\s+(?:anterior|do\s+dia|total|final)|total\s+(?:de\s+)?(?:lançamentos|créditos|débitos)|saldo\s+dispon/i.test(t);
}

/** Verifica se é informação de header/footer do extrato */
function isExtratoHeaderFooter(line: string): boolean {
  const t = line.toLowerCase();
  return /extrato\s+de\s+conta\s+corrente|cliente\s+comercial|agência|conta\s+\d+|período|base\s+sujeitos/i.test(t);
}

/**
 * Parse uma linha de lançamento da tabela v2026
 * Formato esperado: [Data] [Lote] [Documento] [Histórico com data/hora e CPF] [Valor (+/-)]
 */
export function parseBbExtratoV2026Line(line: string): BbExtratoV2026Row | null {
  if (!line?.trim()) return null;
  
  const raw = line.trim();
  
  if (isTableHeader(raw) || isSaldoOrTotalLine(raw) || isExtratoHeaderFooter(raw)) {
    return null;
  }

  // Match valor com (+) ou (-)
  const valorMatch = raw.match(RE_VALOR_CD);
  if (!valorMatch) return null;

  const valorStr = valorMatch[1];
  const sinal = valorMatch[2];
  const tipo = sinal === '+' ? 'credito' : 'debito';
  const valor = parseValorBr(valorStr);

  if (valor <= 0) return null;

  // Extrai data da coluna Dia
  const dataMatch = raw.match(RE_LINHA_DATA_LOTE);
  if (!dataMatch) return null;

  const data = dataMatch[1];
  const lote = dataMatch[2];

  // Remove data+lote do início e valor+sinal do final para extrair os dados do meio
  const beforeData = 0;
  const afterData = (dataMatch[0]?.length || 0);
  
  const beforeValor = raw.indexOf(valorMatch[0]);
  const afterValor = beforeValor + valorMatch[0].length;

  if (beforeValor <= afterData) return null;

  // Middle section contém: Lote | Documento | Histórico
  const middleSection = raw.substring(afterData, beforeValor).trim();
  
  // Tenta extrair documento (sequência de números com pontos)
  const docMatch = middleSection.match(/(\d{2,3}\.\d{3}\.\d{3}|\d{10,14})/);
  let documento = docMatch?.[1] || '';
  
  // Histórico é o resto
  // Remove o documento dele se encontrado
  let historico = middleSection;
  if (documento) {
    historico = historico.replace(documento, '').trim();
  }
  
  // Limpa lote duplicado se aparecer no histórico
  if (lote) {
    historico = historico.replace(new RegExp(`^${lote}\\s*`), '').trim();
  }

  if (!historico) return null;

  return {
    data,
    lote,
    documento: documento || undefined,
    historico,
    valor,
    tipo,
    _linhaOcr: raw,
  };
}

/**
 * Parse múltiplas linhas de extrato v2026
 */
export function parseBbExtratoV2026Text(text: string): BbExtratoV2026Row[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rows: BbExtratoV2026Row[] = [];

  for (const line of lines) {
    const parsed = parseBbExtratoV2026Line(line);
    if (parsed) {
      rows.push(parsed);
    }
  }

  return rows;
}

/**
 * Converte v2026 para formato compatível com BbExtratoOcrRow (para manter compatibilidade)
 */
export function convertV2026ToBbOcrRow(row: BbExtratoV2026Row): Record<string, string> {
  return {
    data: row.data,
    descricao: row.historico,
    _linhaOcr: row._linhaOcr || '',
    valorCredito: row.tipo === 'credito' ? (row.valor / 100).toFixed(2).replace('.', ',') : '',
    valorDebito: row.tipo === 'debito' ? (row.valor / 100).toFixed(2).replace('.', ',') : '',
  };
}
