/**
 * Normalização de linhas/valores OCR do extrato Banco do Brasil (Tesseract).
 * Corrige em dash colado, G→6, barras no lugar de dígitos e duplicação de tokens.
 */

/** Linha OCR típica do BB Internet Banking. */
export function linhaPareceExtratoBbOcr(line: string): boolean {
  const t = String(line ?? '').toUpperCase();
  const raw = String(line ?? '');
  if (!t.trim()) return false;
  if (/\b(SISPAG|TED\s*RECEB|TEDRECEBIDA|SALDO\s+TOTAL\s+DISPON)/i.test(raw)) {
    return false;
  }
  if (/\bCODE\b/.test(t) && /\b(SISPAG|FORNECEDOR)/i.test(t)) return false;
  return (
    /\b0000\b/.test(t) ||
    /\bPIX\b/.test(t) ||
    /BB\s+RENDE|RENDE\s+F[AÁ]CIL|OUROCAP/i.test(t) ||
    /\b(13105|14397|14020|13113|14056|14175)\b/.test(t) ||
    /PAGAMENTO\s+DE\s+BOLETO/i.test(t) ||
    /ORDEM\s+BANC|SEC\s+TES|TED[-\s]*CR[EÉ]DITO/i.test(t)
  );
}

/** Documento/código BB imediatamente antes do valor C/D (ex.: 100.336.373, 2.490.265.000.000). */
export function extratoDocumentoBbDaLinha(linha: string): string {
  const t = String(linha ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const pairs = [...t.matchAll(/(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s*([DC])\b/gi)];
  if (pairs.length === 0) return '';
  const last = pairs[pairs.length - 1]!;
  const before = t.slice(0, last.index ?? 0).trim();
  if (!before) return '';
  const tokens = before.split(/\s+/);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const tok = tokens[i]!;
    if (/^\d{1,3}(?:\.\d{3}){2,}$/.test(tok)) return tok;
    if (/^\d{2,3}\.\d{3}\.\d{3}$/.test(tok)) return tok;
  }
  return '';
}

/** Remove data e tokens duplicados consecutivos (OCR mescla a linha duas vezes). */
export function collapseBbExtratoOcrLineDuplication(line: string): string {
  let t = String(line ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return t;
  t = t.replace(/^(\d{2}\/\d{2}\/\d{4})(?:\s+\1)+/g, '$1');
  const parts = t.split(' ');
  const out: string[] = [];
  for (const p of parts) {
    if (out.length > 0 && out[out.length - 1] === p) continue;
    out.push(p);
  }
  return out.join(' ');
}

/** Corrige valor OCR colado/ilegível típico do BB antes do parse monetário. */
export function normalizeBbExtratoValorGlued(raw: string): string {
  let t = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return t;

  t = t.replace(/^[—–−]+(?=\d)/, '');
  t = t.replace(/([—–−])(?=\d)/g, ' ');
  t = t.replace(/(\d{1,3}(?:\.\d{3})*,\d{2})([DCdc])\s*$/i, '$1 $2');
  t = t.replace(/(\d+,\d{2})([DCdc])\s*$/i, '$1 $2');

  t = t.replace(/([—–\s-]|^)G(\d)(\d{3}),(\d{2})/gi, '$16.$3,$4');
  t = t.replace(/([—–\s-]|^)G(\d)/gi, '$16$2');
  t = t.replace(/(\d)\.\/(\d)(\d{2}),(\d{2})/g, '$1.$2$3,$4');
  t = t.replace(/(\d)\.\/(\d{2}),(\d{2})/g, '$17$2,$3');
  t = t.replace(/(\d)\.(\d)\/0,(\d{2})/g, '$1.$200,$3');
  t = t.replace(/(\d\.\d{2})\/,(\d{2})/g, '$10,$2');
  t = t.replace(/(\d+),(\d{3})([DCdc])\s*$/i, (_, intPart, dec, dc) => {
    return `${intPart},${dec.slice(0, 2)} ${dc.toUpperCase()}`;
  });
  t = t.replace(/(\d{2})\/(\d{3})(?=\s*[DCdc]|\s*$)/gi, '$1.$2,00');

  t = t.replace(/\b(\d{4}),(\d{2})\s*([DCdc])\b/gi, (_, a, b, c) => {
    return `${a[0]}.${a.slice(1)},${b} ${c.toUpperCase()}`;
  });
  t = t.replace(/\b(\d{4}),(\d{2})\b/g, (_, a, b) => `${a[0]}.${a.slice(1)},${b}`);

  t = t.replace(/\b(\d{5,8})([DCdc])\s*$/i, (_, digits, dc) => {
    const d = digits.padStart(3, '0');
    const cents = d.slice(-2);
    const intPart = d.slice(0, -2).replace(/^0+/, '') || '0';
    const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${withThousands},${cents} ${dc.toUpperCase()}`;
  });

  return t.replace(/\s+/g, ' ').trim();
}

/** Inferência D/C pelo histórico BB quando o OCR perde o sufixo na linha. */
export function extratoBbNaturezaPorHistorico(linha: string): 'D' | 'C' | null {
  const t = String(linha ?? '').toUpperCase();
  if (/\bSISPAG\b/.test(t) && /FORNECEDORES|TRIB|CODE|PIX\s*OR/i.test(t)) return 'D';
  if (/\bCODE\b/.test(t) && !/\bTED\s*RECEB/i.test(t)) return 'D';
  if (/PAGAMENTOS?\s*TRIB|TRIBCOD/i.test(t)) return 'D';
  const raw = String(linha ?? '');
  const bradescoTravessao =
    /^\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}\/\d{1,2}\/\d{4}\s+[—–−-]/.test(raw) &&
    /SALDO\s+(?:TOTAL\s+)?DISPON[IÍ]VEL/i.test(raw);
  if (!linhaPareceExtratoBbOcr(linha) && !bradescoTravessao) return null;
  if (/\bPIX\s*(?:ENVIADO|-\s*ENVIADO)|PIX\s*-\s*ENVIADO\b/.test(t)) return 'D';
  if (/PAGAMENTO\s+DE\s+BOLETO/.test(t)) return 'D';
  if (/PAGTO\s+CART/.test(t) && /CR[EÉ]DITO/.test(t)) return 'D';
  if (/\bTARIFA\b/.test(t)) return 'D';
  if (/\bCOBRAN[CÇ]A\b/.test(t)) return 'D';
  if (/\bSAQUE\b/.test(t)) return 'D';
  if (/\bPIX\s*RECEB|\bTRANSFER[EÊ]NCIA\s+RECEB|\bTED\s*RECEB|\bRENDE\s+F/.test(t)) return 'C';
  if (/TED[-\s]*CR[EÉ]DITO|ORDEM\s+BANC|SEC\s+TES/.test(t)) return 'C';
  if (/\bDEP[OÓ]SITO\b/.test(t)) return 'C';
  return null;
}

/** Normaliza linha OCR BB para varredura de valores e parse linha-a-linha. */
export function normalizeBbExtratoLineOcrForValorScan(line: string): string {
  let t = String(line ?? '').replace(/\s+/g, ' ').trim();
  if (!t || !linhaPareceExtratoBbOcr(t)) return t;
  t = collapseBbExtratoOcrLineDuplication(t);

  t = t.replace(
    /([—–−])(\d{1,3}(?:\.\d{3})*,\d{2}\s*[DCdc])/gi,
    ' $2',
  );
  t = t.replace(/([—–−])(\d{4,},\d{2}\s*[DCdc])/gi, ' $2');
  t = t.replace(/([—–−])(G?\d{4,}[.,/]\d*[DCdc])/gi, (_, _dash, val) => {
    return ` ${normalizeBbExtratoValorGlued(val)}`;
  });
  t = t.replace(/—(G?\d{1,3}(?:\.\d{3})*,\d{2}\s*[DCdc])/gi, ' $1');

  const trailingVal = t.match(/[—–−]\s*([^—–−]+)$/);
  if (trailingVal) {
    const fixed = normalizeBbExtratoValorGlued(trailingVal[1]!);
    if (fixed && /\d,\d{2}/.test(fixed)) {
      t = t.slice(0, trailingVal.index).trim() + ` ${fixed}`;
    }
  }

  return t.replace(/\s+/g, ' ').trim();
}

/** Documento BB curto (ex.: 40.706) — não é valor monetário. */
export function tokenEhDocumentoBbCurto(text: string): boolean {
  return /^\d{2}\.\d{3}$/.test(String(text ?? '').trim());
}

/** Código/lote BB no histórico (ex.: 9.903 — Rende Fácil) — não é data nem valor. */
export function tokenEhCodigoBbHistorico(text: string): boolean {
  const t = String(text ?? '').trim();
  return /^\d\.\d{3}$/.test(t) || tokenEhDocumentoBbCurto(t);
}

/** ID Pix e2e com pontos (ex.: 11.019.564.166.431). */
export function tokenEhPixE2eBb(text: string): boolean {
  return /^\d{2,3}(?:\.\d{3}){2,}(?:\.\d{3})?$/.test(String(text ?? '').trim());
}
