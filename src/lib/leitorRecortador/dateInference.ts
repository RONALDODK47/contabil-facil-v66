/**
 * Inferência de datas robusta a OCR — portado do motor de referência
 * (extratoVision/utils/parser.ts). Cobre datas compactas (YYYYMMDD), por extenso
 * ("15 de julho de 2026"), padrão DD/MM/AAAA (com correção de caracteres trocados
 * pelo OCR) e datas com ponto (DD.MM.AAAA), além de utilitários de propagação de
 * ano ("carry-forward") entre lançamentos do mesmo dia.
 *
 * Independente do motor de recorte por coluna já existente em cropper.ts — pode ser usado
 * tanto pelo caminho de texto vetorial quanto pelo fallback de OCR (Tesseract).
 */

const MONTHS_PT: Record<string, string> = {
  jan: '01', fev: '02', mar: '03', abr: '04', mai: '05', jun: '06',
  jul: '07', ago: '08', set: '09', out: '10', nov: '11', dez: '12',
  janeiro: '01', fevereiro: '02', março: '03', abril: '04', maio: '05', junho: '06',
  julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12',
};

/** Corrige trocas de caractere comuns em OCR de números (aplicado só em trechos numéricos). */
function fixOcrDate(s: string): string {
  return s.replace(/[OQoIlLi|SBZzGT]/g, (match) => {
    switch (match) {
      case 'O':
      case 'Q':
      case 'o':
        return '0';
      case 'I':
      case 'l':
      case 'L':
      case 'i':
      case '|':
        return '1';
      case 'S':
        return '5';
      case 'B':
        return '8';
      case 'Z':
      case 'z':
        return '2';
      case 'G':
        return '6';
      case 'T':
        return '7';
      default:
        return match;
    }
  });
}

export type DateExtraction = { normalized: string; original: string };

/** Extrai a primeira data reconhecível do texto, em vários formatos. */
export function extractDateFromText(text: string, statementYear: string): DateExtraction | null {
  const compactMatch = text.match(/\b(20[1-2][0-9])(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/);
  if (compactMatch) {
    return { normalized: `${compactMatch[3]}/${compactMatch[2]}/${compactMatch[1]}`, original: compactMatch[0] };
  }

  const extMatch = text.match(
    /(?:([0-3OQoIlLi|SBZzGT]?[0-9OQoIlLi|SBZzGT])\s*(?:de|\/|\-|\.|\,)?\s+)?([a-zA-ZçÇ]{3,})\s*(?:de|\/|\-|\.|\,)?\s*([0-9OQoIlLi|SBZzGT]{2,4})?/i,
  );
  if (extMatch && extMatch[2]) {
    const monthRaw = extMatch[2].toLowerCase();
    let month = '';
    for (const key in MONTHS_PT) {
      if (monthRaw.startsWith(key)) {
        month = MONTHS_PT[key]!;
        break;
      }
    }

    if (month) {
      let day = '01';
      if (extMatch[1]) {
        day = fixOcrDate(extMatch[1]).padStart(2, '0');
      }
      let year = extMatch[3] ? fixOcrDate(extMatch[3]) : statementYear;
      if (year && year.length === 2) year = '20' + year;

      const d = parseInt(day, 10);
      if (d >= 1 && d <= 31) {
        const normalized = year ? `${day}/${month}/${year}` : `${day}/${month}`;
        return { normalized, original: extMatch[0] };
      }
    }
  }

  const stdMatch = text.match(
    /\b([0-3OQoIl|SBZzGT]?[0-9OQoIl|SBZzGT])[\/\-\|]([0-1OQoIl|SBZzGT]?[0-9OQoIl|SBZzGT])(?:[\/\-\|]([0-9OQoIl|SBZzGT]{2,4}))?\b/i,
  );
  if (stdMatch) {
    const day = fixOcrDate(stdMatch[1]!).padStart(2, '0');
    const month = fixOcrDate(stdMatch[2]!).padStart(2, '0');
    let year = stdMatch[3] ? fixOcrDate(stdMatch[3]) : statementYear;

    const d = parseInt(day, 10);
    const m = parseInt(month, 10);

    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      if (year && year.length === 2) year = '20' + year;
      const normalized = year ? `${day}/${month}/${year}` : `${day}/${month}`;
      return { normalized, original: stdMatch[0] };
    }
  }

  const dotMatch = text.match(
    /\b([0-3OQoIl|SBZzGT]?[0-9OQoIl|SBZzGT])\.([0-1OQoIl|SBZzGT]?[0-9OQoIl|SBZzGT])\.([0-9OQoIl|SBZzGT]{2,4})\b/i,
  );
  if (dotMatch) {
    const day = fixOcrDate(dotMatch[1]!).padStart(2, '0');
    const month = fixOcrDate(dotMatch[2]!).padStart(2, '0');
    let year = fixOcrDate(dotMatch[3]!);

    const d = parseInt(day, 10);
    const m = parseInt(month, 10);

    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      if (year && year.length === 2) year = '20' + year;
      return { normalized: `${day}/${month}/${year}`, original: dotMatch[0] };
    }
  }

  return null;
}

/** Completa/normaliza uma data (com ou sem ano) usando o ano do extrato como fallback. */
export function resolveYear(dateStr: string, statementYear: string): string {
  if (!dateStr) return '';

  const normalized = dateStr.replace(/[.\-]/g, '/');

  const longMatch = normalized.match(/(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})/i);
  if (longMatch) {
    const day = longMatch[1]!.padStart(2, '0');
    const monthName = longMatch[2]!.toLowerCase();
    const month = (MONTHS_PT[monthName] || '01').toString().padStart(2, '0');
    const year = longMatch[3]!;
    return `${day}/${month}/${year}`;
  }

  const parts = normalized.split('/');
  if (parts.length >= 2) {
    const day = fixOcrDate(parts[0]!).padStart(2, '0');
    const month = fixOcrDate(parts[1]!).padStart(2, '0');
    let year = parts[2] ? fixOcrDate(parts[2]) : statementYear;

    if (year && year.length === 2) year = '20' + year;
    if (!year) return `${day}/${month}`;
    return `${day}/${month}/${year}`;
  }

  return dateStr;
}

/** Converte "DD/MM" ou "DD/MM/AAAA" num inteiro comparável (AAAA0MM0DD). */
export function dateToInt(d: string): number {
  if (!d) return 0;
  const m = d.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
  if (!m) return 0;
  const day = parseInt(m[1]!, 10);
  const month = parseInt(m[2]!, 10);
  const year = parseInt(m[3] || '0', 10);
  return year * 10000 + month * 100 + day;
}

/** Decide qual data usar ao avançar de um lançamento para o próximo (carry-forward de ano). */
export function advanceDate(current: string, candidate: string): string {
  if (!current) return candidate;
  if (!candidate) return current;

  const curHasYear = current.split('/').length === 3;
  const candHasYear = candidate.split('/').length === 3;

  if (candHasYear && !curHasYear) return candidate;
  if (!candHasYear && curHasYear) {
    const year = current.split('/')[2];
    return `${candidate}/${year}`;
  }

  return candidate;
}

/** Primeiro ano de 4 dígitos (20xx) encontrado no texto — usado como "ano do extrato". */
export function extractStatementYear(text: string): string {
  const m = text.match(/\b(20\d{2})\b/);
  return m ? m[1]! : '';
}
