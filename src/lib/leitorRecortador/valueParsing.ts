/**
 * Parsing de valores monetários robusto a erros de OCR — portado do motor de referência
 * (extratoVision/utils/parser.ts). Corrige trocas de caractere comuns em OCR de documentos
 * financeiros (O/Q -> 0, l/I -> 1, S -> 5, B -> 8, Z -> 2, G -> 6, T -> 7, g/q -> 9) e trata
 * o ESPAÇO como separador decimal quando o OCR "engole" a vírgula (ex.: "1.234 56" -> 1234,56).
 *
 * Usado como camada extra de robustez em cima do parsing "estrito" já existente
 * (`analyzeValueString` em cropper.ts), que continua sendo a primeira tentativa para texto
 * vetorial limpo do PDF (sem OCR). Este módulo entra quando o texto vem de OCR (Tesseract) ou
 * quando o parsing estrito falha em achar um valor BR válido.
 */

/** Remove identificadores não-monetários (CNPJ/CPF/conta) que podem se parecer com um valor
 *  em reais (grupos de dígitos separados por ponto), ANTES de procurar valores no texto. */
export function stripNonMonetaryIdentifiers(text: string): string {
  if (!text) return text;
  return text
    // CNPJ: 00.000.000/0000-00
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/\d{4}-\d{2}\b/g, ' ')
    // CPF: 000.000.000-00 (inclui variantes mascaradas com *)
    .replace(/\b[\d*]{3}\.[\d*]{3}\.[\d*]{3}-[\d*]{2}\b/g, ' ')
    // Conta/agência isolada terminando em dígito verificador
    .replace(/\b\d[\d.]{4,}-\d{1,2}\b/g, ' ');
}

/** true se o trecho, depois de corrigido de ruído de OCR, termina com exatamente 2 casas decimais. */
export function hasTwoDecimals(valStr: string): boolean {
  if (!valStr) return false;

  const cleaned = valStr
    .trim()
    .replace(/^[^0-9\-+()−]+/, '')
    .replace(/^[|I1]\s*([-−+()])/g, '$1')
    .replace(/([-+()−])\s*[|I1]\s+(?=[0-9])/g, '$1')
    .replace(/\|+\s*$/, '');

  const sanitized = cleaned
    .replace(/[OQo]/g, '0')
    .replace(/[lLi]/g, '1')
    .replace(/[Ss]/g, '5')
    .replace(/[B]/g, '8')
    .replace(/[Zz]/g, '2')
    .replace(/[G]/g, '6')
    .replace(/[T]/g, '7')
    .replace(/[gq]/g, '9');

  let s = sanitized.replace(/[^\d.,\s]/gi, '').trim();

  let lastComma = s.lastIndexOf(',');
  let lastDot = s.lastIndexOf('.');
  let lastSep = lastComma > lastDot ? lastComma : lastDot;
  const lastSpace = s.lastIndexOf(' ');

  if (lastSpace !== -1 && lastSpace > lastSep) {
    const afterSpace = s.substring(lastSpace + 1).replace(/[^\d]/g, '');
    if (afterSpace.length === 2) return true;
  }

  s = s.replace(/\s/g, '');
  lastSep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));

  if (lastSep !== -1) {
    const decimalPart = s.substring(lastSep + 1).replace(/[^\d]/g, '');
    return decimalPart.length === 2;
  }

  return false;
}

/**
 * Parser tolerante a OCR de um valor monetário BR isolado. Retorna sempre um número (0 se não
 * conseguir extrair nada). Complementa (não substitui) `analyzeValueString` de cropper.ts:
 * aquele é preciso para texto vetorial de PDF; este aguenta ruído de OCR.
 */
export function parseMoneyValueOcrTolerant(valStr: string): number {
  if (!valStr) return 0;

  const cleaned = valStr
    .trim()
    .replace(/^[^0-9\-+()−]+/, '')
    .replace(/^[|I1]\s*([-−+()])/g, '$1')
    .replace(/([-+()−])\s*[|I1]\s+(?=[0-9])/g, '$1')
    .replace(/[|]$/, '');

  const isNegative = /[-−(]/.test(cleaned.substring(0, 5)) || /\s[D]$/i.test(cleaned) || /[D]$/i.test(cleaned);

  const sanitized = cleaned
    .replace(/[OQo]/g, '0')
    .replace(/[lLi]/g, '1')
    .replace(/[Ss]/g, '5')
    .replace(/[B]/g, '8')
    .replace(/[Zz]/g, '2')
    .replace(/[G]/g, '6')
    .replace(/[T]/g, '7')
    .replace(/[gq]/g, '9');

  let s = sanitized.replace(/R\$\s?|[()\-−+DC]/gi, '').trim();

  // Se possui espaço, e depois do espaço tem exatamente 2 dígitos e não tem vírgula, tratar espaço como separador de decimal
  if (s.includes(' ') && s.split(' ').pop()!.length === 2 && !s.includes(',')) {
    s = s.replace(/ (?!.* )/, ',');
  }
  
  // Remove all spaces remaining 
  s = s.replace(/\s+/g, '');

  // The logic to handle multiple separators:
  // If the string contains both dot and comma
  if (s.includes('.') && s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  // Se possui apenas ponto, vamos verificar se é separador de milhar ou decimal
  else if (s.includes('.') && !s.includes(',')) {
    const parts = s.split('.');
    const lastPart = parts[parts.length - 1]!;
    if (lastPart.length === 2) {
      // Provavelmente um decimal "1.23"
      s = parts.slice(0, -1).join('') + '.' + lastPart;
    } else {
      // Provavelmente um separador de milhar "1.234"
      s = s.replace(/\./g, '');
    }
  } 
  // Se possui apenas vírgula
  else if (s.includes(',') && !s.includes('.')) {
    const parts = s.split(',');
    const lastPart = parts[parts.length - 1]!;
    // Only treat as decimal if last part is EXACTLY 2 digits, otherwise just strip it (e.g., 4,559)
    if (lastPart.length === 2) {
      s = parts.slice(0, -1).join('') + '.' + lastPart;
    } else {
      s = s.replace(/,/g, '');
    }
  }

  const finalValue = parseFloat(s) || 0;
  return isNegative ? -Math.abs(finalValue) : Math.abs(finalValue);
}
