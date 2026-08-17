/**
 * Corrige erros típicos do OCR em extratos bancários (datas, valores, histórico).
 */
import { moedaExtratoPlausivel } from '../extratoVision/utils/extratoMoneyParse';
import { normalizeOcrTexto } from './parcelamentoPlanilha';

/** Confiança mínima OCR para descartar ruído (valores/datas sempre mantidos). */
export const OCR_EXTRATO_CONFIDENCE_MIN = 28;

const RE_DATA_TOKEN = /^(\d{1,2})\s*[/.-]\s*(\d{1,2})\.?(?:\s*[/.-]\s*(\d{2,4}))?$/;

/** OCR mescla o mesmo token duas vezes na linha («06/02 06/02», «1.560,00D 1.560,00D»). */
export function colapsarRepeticaoAdjacenteOcr(str: string): string {
  const s = String(str ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return s;
  const parts = s.split(' ');
  if (parts.length >= 2 && parts.length % 2 === 0) {
    const half = parts.length / 2;
    const a = parts.slice(0, half).join(' ');
    const b = parts.slice(half).join(' ');
    if (a === b) return a;
  }
  return s;
}

function fixDigitConfusions(s: string): string {
  return s
    .replace(/O/g, '0')
    .replace(/o/g, '0')
    .replace(/l/g, '1')
    .replace(/I/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8');
}

export function fixOcrTokenForExtrato(str: string): string {
  let t = colapsarRepeticaoAdjacenteOcr(String(str ?? '').trim());
  if (!t) return t;

  let norm = normalizeOcrTexto(t.replace(/\s+/g, ' '));

  if (/\d{1,2}\s*[/.-]\s*[\dOolI]/.test(norm)) {
    norm = fixDigitConfusions(norm);
  }

  const dm = norm.match(RE_DATA_TOKEN);
  if (dm) {
    const dd = fixDigitConfusions(dm[1]).padStart(2, '0');
    const mm = fixDigitConfusions(dm[2]).padStart(2, '0');
    const yy = dm[3] ? fixDigitConfusions(dm[3]) : '';
    const dVal = parseInt(dd, 10);
    const mVal = parseInt(mm, 10);
    if (dVal >= 1 && dVal <= 31 && mVal >= 1 && mVal <= 12) {
      return yy
        ? `${dd}/${mm}/${yy.length === 2 ? `20${yy}` : yy}`
        : `${dd}/${mm}`;
    }
  }

  if (/^[-−(]?\s*[\d.,]+$/.test(norm) || /,\d{2}$/.test(norm) || /\.\d{2}\s*[DCdc]?$/i.test(norm)) {
    const neg = /^[-−(]/.test(norm);
    let core = norm.replace(/^[(\s]*[-−]?/, '').replace(/[)\s]+$/, '');
    if (/^\d+\.\d{2}\s*[DCdc]?$/i.test(core.replace(/\s+/g, ''))) {
      core = core.replace(/(\d+)\.(\d{2})/, '$1,$2');
    }
    if (moedaExtratoPlausivel(core) <= 0) {
      core = fixDigitConfusions(core);
    }
    core = core.replace(/(\d),(\d{2})$/, '$1,$2');
    return neg && !core.startsWith('-') ? `-${core}` : core;
  }

  if (/^\d{5,}$/.test(norm.replace(/\D/g, '')) && /,\d{2}$/.test(norm)) {
    return fixDigitConfusions(norm);
  }

  if (/[A-Za-zÀ-ú]{2,}/.test(t)) {
    return fixOcrHistoricoLine(t);
  }

  return t;
}

/** Corrige erros frequentes do OCR em históricos de extrato (sem alterar letras válidas). */
export function fixOcrHistoricoLine(text: string): string {
  let t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return t;
  // BB: prefixo Ag./Lote (0000 13128 500 …) antes do histórico
  t = t.replace(/^(\d{3,5}\s+){1,10}(?=[A-Za-zÀ-ú])/g, '');
  // OCR duplicado: "FCO FCO" → "FCO"
  t = t.replace(/\b(\S{2,})\s+\1\b/gi, '$1');
  return t
    .replace(/\bSISPAGI\b/gi, 'SISPAG')
    .replace(/\bSISPAGF\b/gi, 'SISPAG')
    .replace(/\bTEDI\s+RECEB/i, 'TED RECEB')
    .replace(/\bTEDRECEBIDA\b/gi, 'TED RECEBIDA')
    .replace(/\bRENDIMENTOSI\b/gi, 'RENDIMENTOS')
    .replace(/\bPAGAMENTOSTRIB\b/gi, 'PAGAMENTOS TRIB')
    .replace(/\bTRIBCODBARRAS\b/gi, 'TRIB COD BARRAS')
    .replace(/\bRENDI\s+PAGOAPLIC\b/gi, 'REND PAGO APLIC')
    .replace(/\bADAPT1\b/gi, 'ADAPT')
    .replace(/\bPOLOSCLIMATIZACAOLTDA\b/gi, 'POLO SUL CLIMATIZACAO LTDA')
    .replace(/\bDEI\s+MINACU\b/gi, 'DE MINACU')
    .replace(/\bUT\s+MAIS\b/gi, 'AUT MAIS')
    .replace(/\bAUTI\s+MAIS\b/gi, 'AUT MAIS')
    .replace(/\bTED\s+RECEBIDAI\b/gi, 'TED RECEBIDA')
    .replace(/\bFORNECEDORESI\s+EGOIAS\b/gi, 'FORNECEDORES E GOIAS')
    .replace(/\bSISPAGFORNECEDORES\b/gi, 'SISPAG FORNECEDORES')
    .replace(/\bA\s+UTMAIS\b/gi, 'AUT MAIS')
    .replace(/\bUTMAIS\b/gi, 'AUT MAIS')
    .replace(/\bT[IÍ1|][T7]?[O0Q]{1,3}C[NnM]+[O0S5]{1,3}\b/gi, 'TITULOS')
    .replace(/\bT[IÍ1|][T7]?[UÚV][L1I|]?[O0Q]+S\b/gi, 'TITULOS')
    .replace(/\bLIQU[I1|!][D][AÁ4@][CÇ][AÁ4@][O0Q]?\b/gi, 'LIQUIDACAO')
    .replace(/\bTRANSF[E3][R][E3]NC[I1L|][AÁ4@]?\b/gi, 'TRANSFERENCIA')
    .replace(/\bALT[E3][R][AÁ4@][CÇ][AÁ4@][O0Q]?\b/gi, 'ALTERACAO')
    .replace(/\bVENC[I1|]MENT[O0Q]\b/gi, 'VENCIMENTO')
    .replace(/\bREG[I1|]STR[O0Q]\b/gi, 'REGISTRO')
    .replace(/\bCOBRAN[CÇ][AÁ4@]\b/gi, 'COBRANCA')
    .replace(/\s+/g, ' ')
    .trim();
}

type OcrItemPos = { str: string; x: number; y: number; w: number; h: number };

function itemsEhOcrPosicional(items: { str: string }[]): items is OcrItemPos[] {
  return items.every(
    (it) =>
      typeof (it as OcrItemPos).x === 'number' &&
      typeof (it as OcrItemPos).y === 'number' &&
      typeof (it as OcrItemPos).w === 'number' &&
      typeof (it as OcrItemPos).h === 'number',
  );
}

export function fixOcrItemsForExtrato<T extends { str: string }>(items: T[]): T[] {
  const fixed = items.map((it) => ({ ...it, str: fixOcrTokenForExtrato(it.str) })) as T[];
  if (!itemsEhOcrPosicional(fixed)) return fixed;
  let pos = unirSinalNegativoComValorOcr(fixed) as unknown as T[];
  pos = unirDigitosFragmentadosComValorOcr(pos as unknown as OcrItemPos[]) as unknown as T[];
  return pos;
}

/** Une «45» + «1,21» → «451,21» quando OCR perde dígito na coluna valor. */
function unirDigitosFragmentadosComValorOcr<T extends OcrItemPos>(items: T[]): T[] {
  if (items.length < 2) return items;
  const heights = items.map((i) => i.h).filter((h) => h > 0).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 12;
  const yTol = Math.max(6, medianH * 0.65);
  const maxGapX = medianH * 4;
  const used = new Set<T>();
  const out: T[] = [];

  const combinar = (prefix: string, suffix: string): string | null => {
    const neg = /^[-−]/.test(prefix);
    const p = prefix.replace(/^[-−]/, '').trim();
    const suf = suffix.replace(/\s/g, '');
    let merged: string;
    if (/^,\d{2}$/.test(suf)) merged = `${p}${suf}`;
    else if (/^[1-9]?\d,\d{2}$/.test(suf)) merged = `${p}${suf}`;
    else return null;
    const test = neg ? `-${merged}` : merged;
    if (moedaExtratoPlausivel(test.replace(/^-/, '')) <= 0) return null;
    return neg ? `-${merged}` : merged;
  };

  for (const it of items) {
    if (used.has(it)) continue;
    const s = it.str.trim().replace(/\s/g, '');
    if (/^[-−]?\d{1,4}$/.test(s)) {
      const cy = it.y + it.h / 2;
      const neighbor = items
        .filter(
          (o) =>
            !used.has(o) &&
            o !== it &&
            Math.abs(o.y + o.h / 2 - cy) <= yTol &&
            o.x > it.x - 4 &&
            o.x - (it.x + it.w) <= maxGapX,
        )
        .sort((a, b) => a.x - b.x)
        .find((o) => {
          const t = o.str.trim().replace(/\s/g, '');
          return /^[1-9]?\d,\d{2}$/.test(t) || /^,\d{2}$/.test(t);
        });
      if (neighbor) {
        const merged = combinar(s, neighbor.str.trim());
        if (merged) {
          out.push({
            ...neighbor,
            str: merged,
            x: it.x,
            w: Math.max(neighbor.x + neighbor.w - it.x, neighbor.w),
          });
          used.add(it);
          used.add(neighbor);
          continue;
        }
      }
    }
    out.push(it);
  }

  return out.length > 0 ? out : items;
}

/** Une token «-» isolado ao valor monetário na mesma linha (OCR escaneado). */
function unirSinalNegativoComValorOcr<T extends OcrItemPos>(items: T[]): T[] {
  if (items.length < 2) return items;
  const heights = items.map((i) => i.h).filter((h) => h > 0).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 12;
  const yTol = Math.max(6, medianH * 0.65);
  const used = new Set<T>();
  const out: T[] = [];

  for (const it of items) {
    if (used.has(it)) continue;
    const s = it.str.trim();
    if (/^[-−—]$/.test(s)) {
      const cy = it.y + it.h / 2;
      const neighbor = items
        .filter((o) => !used.has(o) && Math.abs(o.y + o.h / 2 - cy) <= yTol && o.x >= it.x - 4)
        .sort((a, b) => a.x - b.x)
        .find((o) => {
          const t = o.str.trim();
          return /^\d{1,3}(?:\.\d{3})*,\d{2}$/.test(t) || /^\d+,\d{2}$/.test(t);
        });
      if (neighbor) {
        out.push({
          ...neighbor,
          str: `-${neighbor.str.trim()}`,
          x: it.x,
          w: Math.max(neighbor.x + neighbor.w - it.x, neighbor.w),
        });
        used.add(it);
        used.add(neighbor);
        continue;
      }
    }
    out.push(it);
  }

  return out.length > 0 ? out : items;
}

export type OcrItemComConfianca = { str: string; confidence?: number };

/** Remove tokens OCR de baixa confiança e aplica correções típicas de extrato. */
export function prepararItensOcrParaExtrato<T extends OcrItemComConfianca>(
  items: T[],
  minConfidence = OCR_EXTRATO_CONFIDENCE_MIN,
): T[] {
  const comConf = items.some((it) => typeof it.confidence === 'number');
  const filtrados = comConf
    ? items.filter((it) => {
        if (typeof it.confidence !== 'number') return true;
        if (it.confidence >= minConfidence) return true;
        const s = normalizeOcrTexto(it.str);
        if (/\d{1,3}(?:\.\d{3})*,\d{2}(?:\s*[DCdc*])?|\d+,\d{2}(?:\s*[DCdc*])?|^[-−]?\s*\d{1,3}(?:\.\d{3})*,\d{2}/i.test(s)) {
          return true;
        }
        if (RE_DATA_TOKEN.test(s)) return true;
        return false;
      })
    : items;
  return fixOcrItemsForExtrato(filtrados);
}
