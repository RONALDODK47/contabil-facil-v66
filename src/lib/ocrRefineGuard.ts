/** Protege refino OCR: não aceita linha que perdeu data, valor ou dígitos. */
const DATE_RE = /\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/g;
const MONEY_RE = /\d{1,3}(?:\.\d{3})*,\d{2}|\d+[,.]\d{2}/g;
const DIGIT_SEQ = /\d+/g;

function countMatches(line: string, re: RegExp): number {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  return [...String(line).matchAll(new RegExp(re.source, flags))].length;
}

function guardSingleLine(orig: string, ref: string): string {
  const o = String(orig ?? '').trim();
  const r = String(ref ?? '').trim();
  if (!o) return r;
  if (!r) return o;

  if (countMatches(o, DATE_RE) > countMatches(r, DATE_RE)) return o;
  if (countMatches(o, MONEY_RE) > countMatches(r, MONEY_RE)) return o;

  const od = o.match(DIGIT_SEQ) ?? [];
  const rd = r.match(DIGIT_SEQ) ?? [];
  if (od.length > rd.length) return o;

  return r;
}

export function guardOcrRefinedLines(originalLines: string[], refinedLines: string[]): string[] {
  const orig = originalLines.map((l) => String(l ?? ''));
  if (!Array.isArray(refinedLines) || refinedLines.length !== orig.length) {
    return orig;
  }
  return orig.map((line, i) => guardSingleLine(line, refinedLines[i]));
}
