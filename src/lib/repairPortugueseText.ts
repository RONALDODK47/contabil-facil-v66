/**
 * Repara textos com U+FFFD (bytes UTF-8 perdidos no backup) e mojibake comum.
 * Usado em plano de contas, razão, extrato, etc.
 */

const REPLACEMENT = '\uFFFD';

const PT_ACCENT_CANDIDATES = [
  'A',
  'Á',
  'À',
  'Â',
  'Ã',
  'E',
  'É',
  'Ê',
  'I',
  'Í',
  'O',
  'Ó',
  'Ô',
  'Õ',
  'U',
  'Ú',
  'C',
  'Ç',
  'a',
  'á',
  'à',
  'â',
  'ã',
  'e',
  'é',
  'ê',
  'i',
  'í',
  'o',
  'ó',
  'ô',
  'õ',
  'u',
  'ú',
  'c',
  'ç',
];

const PT_WORD_BONUS =
  /(?:ÇÕES|ÇÃO|ÇÕES|ÁRI[OA]|ÉDIT|ÍVEL|ÓRI[OA]|ÊNC|ÚBL|ÔNIO|ÕES|ÃOS|ÚBLICO|IMÓVE|MÁQU|UTENS|SERVIÇ|APLICAÇ|DEPRECIA|PARTICIPA|CONTRIBUI|DEVOLU|PROVIS|EXERCÍ|PERÍOD|CRÉDIT|DÉBIT|SALÁRI|FÉRIAS|PRÓ-L|EMPRÉST|FINANC|BANCÁR|TRIBUT|RECEIT|DESPES|AMORTIZ|ALUGU|COMBUST|ENERG|ELÉTR|ECONÔ|CARTÃO|DISPONÍ|CAPITALIZ|ORGANIZ|MANUTEN|REFRIGER|CLIMATIZ)/i;

function fixUtf8Mojibake(input: string): string {
  if (!input || !/[ÃÂ][\u0080-\u00BF]|[Ã][§£©ª]/.test(input)) return input;
  try {
    const bytes = Uint8Array.from(input, (c) => c.charCodeAt(0) & 0xff);
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (decoded && !decoded.includes(REPLACEMENT) && decoded !== input) return decoded;
  } catch {
    /* ignore */
  }
  return input;
}

function scorePortugueseToken(token: string): number {
  if (!token || token.includes(REPLACEMENT)) return -10_000;
  if (!/^[\wÀ-ÿ.,/()+ %º°&@#*-]+$/.test(token)) return -500;
  let score = token.length;
  if (PT_WORD_BONUS.test(token)) score += 40;
  if (/ÇÕES|ÇÃO|ÇÕ/i.test(token)) score += 25;
  if (/(.)\1/.test(token) && !/LL|SS|CC|RR|OO|EE/.test(token.toUpperCase())) score -= 20;
  if (/[0-9]/.test(token)) score += 5;
  return score;
}

function applyKnownReplacementPatterns(text: string): string {
  return text
    .replace(/APLICA\uFFFD\uFFFDES/gi, 'APLICAÇÕES')
    .replace(/AMORTIZA\uFFFD\uFFFDES/gi, 'AMORTIZAÇÕES')
    .replace(/DEPRECIA\uFFFD\uFFFDES/gi, 'DEPRECIAÇÕES')
    .replace(/PARTICIPA\uFFFD\uFFFDES/gi, 'PARTICIPAÇÕES')
    .replace(/CONTRIBUI\uFFFD\uFFFDES/gi, 'CONTRIBUIÇÕES')
    .replace(/DEVOLU\uFFFD\uFFFDES/gi, 'DEVOLUÇÕES')
    .replace(/COMPENSA\uFFFD\uFFFDES/gi, 'COMPENSAÇÕES')
    .replace(/ORGANIZA\uFFFD\uFFFDES/gi, 'ORGANIZAÇÕES')
    .replace(/REPRODU\uFFFD\uFFFDES/gi, 'REPRODUÇÕES')
    .replace(/DISTRIBUI\uFFFD\uFFFDES/gi, 'DISTRIBUIÇÕES')
    .replace(/CLIMATIZA\uFFFD\uFFFDO/gi, 'CLIMATIZAÇÃO')
    .replace(/REFRIGERA\uFFFD\uFFFDO/gi, 'REFRIGERAÇÃO')
    .replace(/CAPITALIZA\uFFFD\uFFFDO/gi, 'CAPITALIZAÇÃO')
    .replace(/MANUTEN\uFFFD\uFFFDO/gi, 'MANUTENÇÃO')
    .replace(/IMPORTA\uFFFD\uFFFDO/gi, 'IMPORTAÇÃO')
    .replace(/EXPORTA\uFFFD\uFFFDO/gi, 'EXPORTAÇÃO');
}

function repairToken(token: string): string {
  if (!token.includes(REPLACEMENT)) return token;
  const slots = (token.match(/\uFFFD/g) || []).length;
  if (slots === 0) return token;
  if (slots > 4) return token;

  let best = token;
  let bestScore = scorePortugueseToken(token);

  const build = (idx: number, current: string): void => {
    const pos = current.indexOf(REPLACEMENT);
    if (pos < 0) {
      const s = scorePortugueseToken(current);
      if (s > bestScore) {
        bestScore = s;
        best = current;
      }
      return;
    }
    if (idx >= slots) return;
    for (const ch of PT_ACCENT_CANDIDATES) {
      build(idx + 1, current.slice(0, pos) + ch + current.slice(pos + 1));
    }
  };

  build(0, token);
  return best;
}

/** Repara uma string exibida ao usuário (plano, histórico, nomes). */
export function repairPortugueseText(input: string): string {
  if (!input) return input;
  let text = fixUtf8Mojibake(input);
  text = applyKnownReplacementPatterns(text);
  if (!text.includes(REPLACEMENT)) return text;

  return text
    .split(/(\s+)/)
    .map((part) => (/^\s+$/.test(part) ? part : repairToken(part)))
    .join('');
}

export function repairPortugueseDeep<T>(value: T): T {
  if (typeof value === 'string') return repairPortugueseText(value) as T;
  if (Array.isArray(value)) return value.map((v) => repairPortugueseDeep(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = repairPortugueseDeep(v);
    }
    return out as T;
  }
  return value;
}

export function needsPortugueseTextRepair(input: string): boolean {
  return Boolean(input?.includes(REPLACEMENT) || /[ÃÂ][\u0080-\u00BF]/.test(input || ''));
}
