/**
 * Parser de PDF de Folha de Pagamento
 * 
 * Extrai:
 * - COMPETÊNCIA (MM/YYYY) → Converte para data = último dia do mês
 * - PROVENTOS → Crédito (C)
 * - DESCONTOS → Débito (D)
 * - INFORMATIVA → Crédito (C)
 * 
 * Estrutura do Resultado:
 * - Data: último dia da competência (ex: 31/01/2026)
 * - Descrição: rubrica + nome da rubrica
 * - Valor: valor calculado
 * - Natureza: D ou C
 */

export interface FolhaParserResult {
  competencia: string; // MM/YYYY
  data: string; // DD/MM/YYYY (último dia do mês)
  empresa?: string;
  cnpj?: string;
  lancements: FolhaLancamento[];
  errors: string[];
}

export interface FolhaLancamento {
  rubrica: string; // Código da rubrica (ex: "1", "812", "996")
  nomeRubrica: string; // Nome da rubrica (ex: "SALARIO EMPREGADO")
  valor: number; // Valor calculado
  natureza: 'D' | 'C'; // D = Débito (DESCONTOS), C = Crédito (PROVENTOS, INFORMATIVA)
  tipo: 'PROVENTOS' | 'DESCONTOS' | 'INFORMATIVA'; // Tipo original
  nEmpregados?: number; // Número de empregados/contribuintes
}

/**
 * Calcula o último dia do mês baseado em MM/YYYY
 * Exemplo: 01/2026 → 31/01/2026
 *          02/2026 → 28/02/2026 (ou 29 em bissextos)
 *          12/2025 → 31/12/2025
 */
export function getLastDayOfMonth(competencia: string): string {
  const match = competencia.match(/^(\d{1,2})\/(\d{4})$/);
  if (!match) return '';

  const month = parseInt(match[1], 10);
  const year = parseInt(match[2], 10);

  if (month < 1 || month > 12) return '';

  // Dia 01 do próximo mês, menos 1 dia = último dia do mês
  const nextMonth = new Date(year, month, 1);
  const lastDay = new Date(nextMonth.getTime() - 1);

  const dd = String(lastDay.getDate()).padStart(2, '0');
  const mm = String(month).padStart(2, '0');

  return `${dd}/${mm}/${year}`;
}

/**
 * Regex para extrair dados de texto plano do PDF de Folha
 */
const COMPETENCIA_PATTERN = /Compet[êe]ncia:\s*(\d{1,2}\/\d{4})/i;
const EMPRESA_PATTERN = /Empresa:\s*(.+?)(?:\n|$)/i;
const CNPJ_PATTERN = /CNPJ:\s*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i;

// Padrão para detectar seção de tipo
const TIPO_PATTERN = /^(PROVENTOS|DESCONTOS|INFORMATIVA)\s*$/i;

// Padrão para linha de rubrica
// Exemplo: "1 SALARIO EMPREGADO 1 28:00 206,08"
// Ou:      "242 GRATIFICAÇÃO DE CAIXA 1 26,32 26,32"
// Ou:      "813 FGTS FERIAS1 1 0,00 76,88 *"  (asterisco Domínio = rubrica informativa)
// Ou:      "1 SALARIO EMPREGADO 1 206,08 28:00" (Valor Calculado antes do Valor Informado)
//
// NÃO usar um único regex "guloso" aqui: nomes de rubrica que terminam com um dígito solto
// (ex.: "PRO-LABORE DIAS 1", "VANTAGENS FERIAS 1") confundem esse dígito com a coluna
// "Nº Empregados", empurrando o token real de empregados para dentro do valor e colando as
// duas colunas de valor numa única string (ex.: "30,00 1.621,00") — o parseBrValue então só
// lê o primeiro número e o sistema acaba pegando o Valor Informado em vez do Valor Calculado.
// Por isso a linha é tokenizada e as colunas são lidas a partir do FIM (as duas últimas são
// sempre os valores; a terceira a partir do fim é sempre o Nº Empregados), o que resolve a
// ambiguidade independente de quantos dígitos existam dentro do nome da rubrica.
const RUBRICA_LINE_MIN_TOKENS = 4;

/**
 * Normaliza string de valor brasileiro para número
 * Exemplo: "1.621,00" → 1621.00
 *          "206,08" → 206.08
 */
export function parseBrValue(valueStr: string): number {
  if (!valueStr) return 0;
  
  const cleaned = valueStr
    .trim()
    .replace(/\./g, '') // Remove separador de milhares
    .replace(',', '.'); // Converte vírgula em ponto

  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Parser principal para PDF de Folha de Pagamento (texto extraído)
 */
export function parseFolhaText(text: string): FolhaParserResult {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  
  const result: FolhaParserResult = {
    competencia: '',
    data: '',
    lancements: [],
    errors: [],
  };

  // 1. Extrair metadados
  const competenciaMatch = COMPETENCIA_PATTERN.exec(text);
  if (competenciaMatch) {
    result.competencia = competenciaMatch[1];
    result.data = getLastDayOfMonth(result.competencia);
  }

  const empresaMatch = EMPRESA_PATTERN.exec(text);
  if (empresaMatch) {
    result.empresa = empresaMatch[1].trim();
  }

  const cnpjMatch = CNPJ_PATTERN.exec(text);
  if (cnpjMatch) {
    result.cnpj = cnpjMatch[1];
  }

  if (!result.competencia) {
    result.errors.push('COMPETÊNCIA não encontrada no PDF');
    return result;
  }

  if (!result.data) {
    result.errors.push('Não foi possível calcular a data da competência');
    return result;
  }

  // 2. Encontrar seções de tipo
  let currentTipo: 'PROVENTOS' | 'DESCONTOS' | 'INFORMATIVA' | null = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Detectar mudança de tipo
    if (TIPO_PATTERN.test(line)) {
      const match = line.match(TIPO_PATTERN);
      if (match) {
        currentTipo = match[1].toUpperCase() as any;
        i++;
        continue;
      }
    }

    // Pular linhas de "Total:", "Líquido Geral:", etc
    if (/^Total:|^L[íi]quido\s+(Geral)?:|^\*|^Sistema\s+licenciado/i.test(line)) {
      i++;
      continue;
    }

    // Se estamos em uma seção e a linha parece uma rubrica
    if (currentTipo) {
      const lancamento = parseRubricaLine(line, currentTipo);
      if (lancamento) {
        result.lancements.push(lancamento);
      }
    }

    i++;
  }

  return result;
}

/**
 * Parser de linha individual de rubrica
 *
 * A linha é lida a partir do FIM: os dois últimos tokens são sempre as colunas de valor
 * (Valor Informado e Valor Calculado, em qualquer ordem) e o token imediatamente anterior
 * é sempre o Nº de Empregados/Contribuintes. Isso evita a ambiguidade de nomes de rubrica
 * que terminam com um dígito solto (ex.: "PRO-LABORE DIAS 1").
 */
function parseRubricaLine(line: string, tipo: 'PROVENTOS' | 'DESCONTOS' | 'INFORMATIVA'): FolhaLancamento | null {
  let tokens = line.trim().split(/\s+/).filter(Boolean);

  // Asterisco (rubrica informativa do Domínio) pode vir como token separado ou colado ao valor
  if (tokens.length > 0 && tokens[tokens.length - 1] === '*') {
    tokens = tokens.slice(0, -1);
  }

  if (tokens.length < RUBRICA_LINE_MIN_TOKENS) return null;
  if (!/^\d+$/.test(tokens[0])) return null; // primeiro token deve ser o código da rubrica

  const rubrica = tokens[0];
  const nEmpregadosStr = tokens[tokens.length - 3];
  if (!/^\d+$/.test(nEmpregadosStr)) return null; // não é uma linha de rubrica reconhecível

  const nomeRubrica = tokens.slice(1, tokens.length - 3).join(' ').trim();
  if (!nomeRubrica) return null;

  const valorColunaA = tokens[tokens.length - 2].replace(/\*$/, '');
  const valorColunaB = tokens[tokens.length - 1].replace(/\*$/, '');
  // A ordem das colunas Informado/Calculado no PDF pode variar; usa-se o maior valor
  // monetário entre as duas para sempre obter o Valor Calculado independentemente da ordem.
  const nEmpregados = parseInt(nEmpregadosStr, 10) || 0;
  const valor = Math.max(parseBrValue(valorColunaA), parseBrValue(valorColunaB));

  if (valor <= 0) return null; // Ignorar valores zerados ou inválidos

  // Determinar natureza baseado no tipo
  let natureza: 'D' | 'C' = 'C';
  if (tipo === 'DESCONTOS') {
    natureza = 'D';
  } else if (tipo === 'PROVENTOS') {
    natureza = 'C';
  } else if (tipo === 'INFORMATIVA') {
    natureza = 'C';
  }

  return {
    rubrica,
    nomeRubrica,
    valor,
    natureza,
    tipo,
    nEmpregados: nEmpregados > 0 ? nEmpregados : undefined,
  };
}

/**
 * Marcador de página inserido pelo extrator de texto (ver FolhaImportModal),
 * ex.: "--- Página 2 ---". Um PDF "Resumo Mensal" do Domínio traz uma
 * competência por página, então é preciso separar antes de rodar o parser
 * — senão só a primeira competência é lida e todos os lançamentos das
 * demais páginas ficam com a data errada.
 */
const PAGE_MARKER_PATTERN = /---\s*P[áa]gina\s*\d+\s*---/gi;

/**
 * Parser para PDFs "Resumo Mensal" com várias competências (uma por página).
 * Retorna um FolhaParserResult por página/competência encontrada.
 */
export function parseFolhaTextMultiCompetencia(text: string): FolhaParserResult[] {
  const pages = text
    .split(PAGE_MARKER_PATTERN)
    .map((page) => page.trim())
    .filter(Boolean);

  const source = pages.length > 0 ? pages : [text];

  return source
    .map((page) => parseFolhaText(page))
    .filter((result) => result.competencia && result.lancements.length > 0);
}

/**
 * Exporta resultado do parser para formato GenericOcrRow (compatível com sistema)
 */
export interface GenericOcrRow {
  data: string;
  descricao: string;
  valor?: number;
  valorMisto?: string;
  valorDebito?: string;
  valorCredito?: string;
  natureza: 'D' | 'C';
  rubrica?: string;
  nomeRubrica?: string;
  tipo?: string;
  _linhaOcr?: string;
  _folhaOrdem?: string;
  [key: string]: any;
}

export function folhaLancamentosToGenericOcrRows(result: FolhaParserResult): GenericOcrRow[] {
  return result.lancements.map((lance, idx) => {
    const valorBr = lance.valor.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    const row: GenericOcrRow = {
      data: result.data,
      descricao: `${lance.rubrica} - ${lance.nomeRubrica}`,
      valor: lance.valor,
      valorMisto: valorBr,
      natureza: lance.natureza,
      rubrica: lance.rubrica,
      nomeRubrica: lance.nomeRubrica,
      tipo: lance.tipo,
      _linhaOcr: `${lance.rubrica} | ${lance.nomeRubrica} | ${valorBr}`,
      _folhaOrdem: String(idx + 1),
    };

    if (lance.natureza === 'D') {
      row.valorDebito = valorBr;
      row.valorCredito = '';
    } else {
      row.valorCredito = valorBr;
      row.valorDebito = '';
    }

    return row;
  });
}
