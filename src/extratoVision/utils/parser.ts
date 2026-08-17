import * as Tesseract from 'tesseract.js';
import { Transaction, ScannedLine, ExtractionConfig } from '../types';

// ---------------------------------------------------------------------------
// MONEY REGEX
// Matches amounts like 1.234,56 | 1234,56 | 1.234,56 D | (1.234,56) | R$ 1.234,56
// ---------------------------------------------------------------------------
const moneyRegex = /((?:[\(]?\s*[-+−]?\s*(?:R\$\s?)?[0-9OQoIl|SBZzGTgqs]+(?:[\.\s]*[0-9OQoIl|SBZzGTgqs]+)*[,.\s]\s*[0-9OQoIl|SBZzGTgqs]{1,3}\s*[-−]?\s*[\)]?)(?:\s*[DC])?)/i;

// ---------------------------------------------------------------------------
// hasTwoDecimals
// ---------------------------------------------------------------------------
export const hasTwoDecimals = (valStr: string): boolean => {
    if (!valStr) return false;
    const cleaned = valStr.trim()
        .replace(/^[^0-9\-+()−]+/, '')
        .replace(/^[|I1]\s*([-−+()])/g, '$1')
        .replace(/([-+()−])\s*[|I1]\s+(?=[0-9])/g, '$1')
        .replace(/\|+\s*$/, '');
    const sanitized = cleaned
        .replace(/[OQo]/g, '0').replace(/[lLi]/g, '1').replace(/[Ss]/g, '5')
        .replace(/[B]/g, '8').replace(/[Zz]/g, '2').replace(/[G]/g, '6')
        .replace(/[T]/g, '7').replace(/[gq]/g, '9');
    let s = sanitized.replace(/[^\d.,\s]/gi, '').trim();
    const lastSpace = s.lastIndexOf(' ');
    const lastSepBeforeSpace = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
    if (lastSpace !== -1 && lastSpace > lastSepBeforeSpace) {
        const afterSpace = s.substring(lastSpace + 1).replace(/[^\d]/g, '');
        if (afterSpace.length === 2) return true;
    }
    s = s.replace(/\s/g, '');
    const lastSep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
    if (lastSep !== -1) {
        const decimalPart = s.substring(lastSep + 1).replace(/[^\d]/g, '');
        return decimalPart.length === 2;
    }
    return false;
};

// ---------------------------------------------------------------------------
// parseValue
// ---------------------------------------------------------------------------
const parseValue = (valStr: string): number => {
    if (!valStr) return 0;
    const cleaned = valStr.trim()
        .replace(/^[^0-9\-+()−]+/, '')
        .replace(/^[|I1]\s*([-−+()])/g, '$1')
        .replace(/([-+()−])\s*[|I1]\s+(?=[0-9])/g, '$1')
        .replace(/[|]$/, '');
    const isNegative = /[-−(]/.test(cleaned.substring(0, 5)) || /\s[D]$/i.test(cleaned) || /[D]$/i.test(cleaned);
    const sanitized = cleaned
        .replace(/[OQo]/g, '0').replace(/[lLi]/g, '1').replace(/[Ss]/g, '5')
        .replace(/[B]/g, '8').replace(/[Zz]/g, '2').replace(/[G]/g, '6')
        .replace(/[T]/g, '7').replace(/[gq]/g, '9');
    let s = sanitized.replace(/R\$\s?|[()\-−+DC]/gi, '').trim();
    const lastSpace = s.lastIndexOf(' ');
    const lastSepBeforeSpace = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
    if (lastSpace !== -1 && lastSpace > lastSepBeforeSpace) {
        const afterSpaceMatch = s.substring(lastSpace + 1).replace(/[^\d]/g, '');
        if (afterSpaceMatch.length === 2) {
            s = s.substring(0, lastSpace) + '.' + s.substring(lastSpace + 1);
        }
    }
    s = s.replace(/\s/g, '');
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    const lastSep = Math.max(lastComma, lastDot);
    let finalValue = 0;
    if (lastSep === -1) {
        finalValue = parseFloat(s) || 0;
    } else {
        const integerPart = s.substring(0, lastSep).replace(/[.,]/g, '');
        const decimalPart = s.substring(lastSep + 1).replace(/[^\d]/g, '');
        finalValue = parseFloat(integerPart + '.' + decimalPart.substring(0, 2)) || 0;
    }
    return isNegative ? -Math.abs(finalValue) : Math.abs(finalValue);
};

declare global {
    interface Window { pdfjsLib: any; }
}

// ---------------------------------------------------------------------------
// BANK HEADER PATTERNS
// Lines matching these should NEVER be part of a transaction's historico.
// Covers: Santander, Banco do Brasil, Nubank, Sicredi + generic Brazilian bank
// patterns.
// ---------------------------------------------------------------------------
export const BANK_HEADER_PATTERNS: RegExp[] = [
    // Generic structural headers
    /^Extrato\s+(de\s+)?Conta/i,
    /^Extrato$/i,
    /^Per[íi]odo\s+(de\s+)?[A-Za-z0-9]/i,
    /^Ag[êe]ncia\s*[:/]/i,
    /^Conta\s*[:/]/i,
    /^Nome\s*[:/]/i,
    /^Titular\s*[:/]/i,
    /^CPF\s*\/\s*CNPJ/i,
    /^(CPF|CNPJ)\s*[:\d]/i,
    /^P[áa]gina\s+\d+/i,
    /^\d+\s*\/\s*\d+$/,        // Page like "1/6"
    /^Folha\s+\d+/i,
    /^Demonstrativo/i,
    /^SAC\s*[:/]/i,
    /^Ouvidoria\s*[:/]/i,
    /^Central\s+de\s+Atendimento/i,
    /^Para\s+uso\s+do\s+banco/i,
    /^Rendimento\s+l[íi]quido/i,
    /^Movimenta[çc][õo]es/i,
    /^Aviso\s+de\s+Privacidade/i,
    /^Termos\s+de\s+Uso/i,
    /^Internet\s+Banking/i,
    /^Banco\s+[A-Z\s]+S\.A\./i,
    /^Data\s+d[eo]\s+Extrato/i,
    /^Data\s+de\s+Emiss[ãa]o/i,
    /^Data\s+de\s+Impress[ãa]o/i,
    /^Data\s+de\s+Gera[çc][ãa]o/i,
    /^Cheque\s+Especial/i,
    /^Resumo$/i,
    /^Data\s+Hist[óo]rico\s+Valor/i,
    /^Descri[çc][ãa]o\s+Valor/i,
    /^Data\s+Movimenta[çc][ãa]o\s+Tipo/i,
    /^Tribanco\s+Online/i,
    /^Usu[áa]rio\s*[:/]/i,
    /^Lan[çc]amentos\s+da\s+CONTA\s+DIGITAL/i,
    /^https?:\/\//i,
    /^\d{2}\/\d{2}\/\d{4},?\s+\d{2}:\d{2}/,   // Timestamps
    /^Lan[çc]amentos\s+Futuros/i,
    /^N[ãa]o\s+h[áa]\s+lan[çc]amentos/i,
    /^Posi[çc][ãa]o\s+da\s+CONTA/i,
    /^Sujeito\s+a\s+altera[çc][õo]es/i,
    /^Informa[çc][õo]es\s+do\s+dia/i,
    /^Saldo\s+(Anterior|Atual|Final|Inicial|em\s)/i,
    /^Saldo$/i,
    /^Balance/i,
    /^Saldo\s+do\s+Dia/i,
    /^SUBTOTAL/i,
    /^TOTAL\s+(DÉBITOS|CRÉDITOS|GERAL)/i,
    /^(Créd|Déb)[^a-z]/i,
    /^Data\s+Lan[çc]amento/i,
    /^Hist[óo]rico$/i,
    /^Hist[óo]rico\s+Valor/i,
    /^D[ée]bitos\s+\(/i,
    /^Cr[ée]ditos\s+\(/i,
    // Santander specific
    /^Santander/i,
    /^S\.A\.\s*\d/i,
    /^Extrato\s+Online/i,
    /^Extrato\s+Conta\s+Corrente/i,
    /^SANTANDER\s+(S\.A\.|BRASIL)/i,
    /^Conta\s+Corrente\s+Empresas/i,
    /^Conta\s+Corrente$/i,
    /^Conta\s+Corrente\s+\d/i,
    // Banco do Brasil specific
    /^Banco\s+do\s+Brasil/i,
    /^BB\s+Extrato/i,
    /^BB\s+Rende\s+F[áa]cil\s*$/i,
    /^Rende\s+F[áa]cil/i,
    /^Data\s+Ocorr[êe]ncia/i,
    /^Saldo\s+Contábil/i,
    /^Planilha\s+de\s+Extrato/i,
    /^Lan[çc]amento\s+Futuro/i,
    /^Movimentação\s+da\s+conta/i,
    /^Extrato\s+de\s+Movimentação/i,
    // Nubank specific
    /^Nubank/i,
    /^Nu\s+Pagamentos/i,
    /^Conta\s+NuBank/i,
    /^NuConta/i,
    /^NU PAGAMENTOS/i,
    /^Nu\s+Conta/i,
    /^Agência\s+0001/i,
    /^Extrato\s+de\s+Transações/i,
    // Sicredi specific
    /^Sicredi/i,
    /^SICREDI/i,
    /^Cooperativa\s+de\s+Crédito/i,
    /^COOP\s+SICREDI/i,
    /^Coop\.?\s+Sicredi/i,
    /^Extrato\s+de\s+Conta\s+Corrente/i,
    /^Extrato\s+Conta\s+Poupança/i,
    // Column headers (table headers that appear on every page)
    /^Data\s+Histórico\s+Docto\s+Valor/i,
    /^Data\s+Descrição\s+Valor/i,
    /^Data\s+Lançamento\s+Tipo\s+Valor/i,
    /^Data\s+Descrição\s+Débito\s+Crédito/i,
    /^Lançamentos\s+Realizados/i,
    /^Número\s+do\s+Documento/i,
    /^\d{2}\/\d{2}\/\d{4}$/, // Bare date-only lines (header dates, not transaction dates)
];

// ---------------------------------------------------------------------------
// isBankHeaderLine — hard check (never add these to historico)
// ---------------------------------------------------------------------------
const isBankHeaderLine = (text: string): boolean => {
    const t = text.trim();
    if (!t || t.length < 2) return true;
    // Short all-caps abbreviations that are noise
    if (/^[A-Z]{1,3}$/.test(t)) return true;
    // Pure numeric or CPF/CNPJ alone
    if (/^\d{2}\.\d{3}\.\d{3}[\s\/]\d{4}-\d{2}$/.test(t)) return true;
    if (/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(t)) return true;
    // Bare account or agency number
    if (/^Ag[êe]ncia:?\s*\d/i.test(t)) return true;
    if (/^Conta:?\s*\d/i.test(t)) return true;
    return BANK_HEADER_PATTERNS.some(p => p.test(t));
};

// ---------------------------------------------------------------------------
// sanitizeHistory — clean a raw historico string
// ---------------------------------------------------------------------------
export const sanitizeHistory = (text: string): string => {
    if (!text) return "";
    let cleaned = text.toUpperCase();

    // Remove zero-width and invisible chars
    cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF]/g, '');
    // Remove multi-char layout noise
    cleaned = cleaned.replace(/[|_>]{2,}/g, ' ').replace(/\.{3,}/g, ' ');
    // Remove masked card numbers
    cleaned = cleaned.replace(/\*{2,}[\d.*\-—=]+\*{2,}/g, ' ');
    // Remove timestamps (HH:MM or HH:MM:SS)
    cleaned = cleaned.replace(/\b\d{2}:\d{2}(:\d{2})?\b/g, ' ');
    // Remove CPF: 000.000.000-00
    cleaned = cleaned.replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, ' ');
    // Remove CNPJ: 00.000.000/0000-00
    cleaned = cleaned.replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, ' ');
    // Remove long alphanumeric IDs (Nubank/Pix transaction IDs)
    cleaned = cleaned.replace(/\b[A-Z0-9]{15,}\b/g, ' ');
    // Remove isolated long numbers (> 6 digits) — agency, account, doc numbers
    cleaned = cleaned.replace(/\b\d{7,}\b/g, ' ');
    // Remove "Agência NNNN" or "Conta NNNNN-N" fragments
    cleaned = cleaned.replace(/\bAG[ÊE]NCIA\s+\d+/ig, ' ');
    cleaned = cleaned.replace(/\bAGENCIA\s+\d+/ig, ' ');
    cleaned = cleaned.replace(/\bCONTA\s+[\d\.\-]+/ig, ' ');
    // Remove bare page markers
    cleaned = cleaned.replace(/\bP[ÁA]GINA\s+\d+/ig, ' ');
    // Remove "Saldo" fragments that slipped through
    cleaned = cleaned.replace(/\bSALDO\b/ig, ' ');

    // De-duplicate consecutive identical words (e.g. "PIX PIX")
    const words = cleaned.split(/\s+/).filter(Boolean);
    const uniqueWords: string[] = [];
    words.forEach((word, i) => {
        if (word !== words[i - 1]) uniqueWords.push(word);
    });
    cleaned = uniqueWords.join(' ');

    // Final cleanup
    cleaned = cleaned
        .replace(/[^\w\sÀ-ÿ\-\/\*]/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

    return cleaned;
};

// ---------------------------------------------------------------------------
// Month lookup
// ---------------------------------------------------------------------------
const MONTHS_PT: Record<string, string> = {
    'jan': '01', 'fev': '02', 'mar': '03', 'abr': '04', 'mai': '05', 'jun': '06',
    'jul': '07', 'ago': '08', 'set': '09', 'out': '10', 'nov': '11', 'dez': '12',
    'janeiro': '01', 'fevereiro': '02', 'março': '01', 'marco': '03', 'abril': '04',
    'maio': '05', 'junho': '06', 'julho': '07', 'agosto': '08', 'setembro': '09',
    'outubro': '10', 'novembro': '11', 'dezembro': '12'
};

// ---------------------------------------------------------------------------
// fixOcrDate
// ---------------------------------------------------------------------------
const fixOcrDate = (s: string): string =>
    s.replace(/[OQoIlLi|SBZzGT]/g, (match) => {
        switch (match) {
            case 'O': case 'Q': case 'o': return '0';
            case 'I': case 'l': case 'L': case 'i': case '|': return '1';
            case 'S': return '5';
            case 'B': return '8';
            case 'Z': case 'z': return '2';
            case 'G': return '6';
            case 'T': return '7';
            default: return match;
        }
    });

// ---------------------------------------------------------------------------
// extractDateFromText
// ---------------------------------------------------------------------------
export const extractDateFromText = (text: string, statementYear: string): { normalized: string; original: string } | null => {
    // 1. YYYYMMDD compact
    const compactMatch = text.match(/\b(20[1-2][0-9])(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/);
    if (compactMatch) {
        return { normalized: `${compactMatch[3]}/${compactMatch[2]}/${compactMatch[1]}`, original: compactMatch[0] };
    }

    // 2. Extensive "DD de Mês de YYYY"
    const extMatch = text.match(/(?:([0-3OQoIlLi|SBZzGT]?[0-9OQoIlLi|SBZzGT])\s*(?:de|\/|\-|\.|\,)?\s+)?([a-zA-ZçÇ]{3,})\s*(?:de|\/|\-|\.|\,)?\s*([0-9OQoIlLi|SBZzGT]{2,4})?/i);
    if (extMatch) {
        const monthRaw = extMatch[2].toLowerCase();
        let month = '';
        for (const key in MONTHS_PT) {
            if (monthRaw.startsWith(key)) { month = MONTHS_PT[key]; break; }
        }
        if (month) {
            let day = '01';
            if (extMatch[1]) day = fixOcrDate(extMatch[1]).padStart(2, '0');
            let year = extMatch[3] ? fixOcrDate(extMatch[3]) : statementYear;
            if (year && year.length === 2) year = '20' + year;
            const d = parseInt(day);
            if (d >= 1 && d <= 31) {
                const normalized = year ? `${day}/${month}/${year}` : `${day}/${month}`;
                return { normalized, original: extMatch[0] };
            }
        }
    }

    // 3. Standard DD/MM or DD/MM/YYYY (also handles DD-MM-YYYY and DD.MM.YYYY)
    const stdMatch = text.match(/\b([0-3OQoIl|SBZzGT]?[0-9OQoIl|SBZzGT])[\/\-\|]([0-1OQoIl|SBZzGT]?[0-9OQoIl|SBZzGT])(?:[\/\-\|]([0-9OQoIl|SBZzGT]{2,4}))?\b/i);
    if (stdMatch) {
        const day = fixOcrDate(stdMatch[1]).padStart(2, '0');
        const month = fixOcrDate(stdMatch[2]).padStart(2, '0');
        let year = stdMatch[3] ? fixOcrDate(stdMatch[3]) : statementYear;
        const d = parseInt(day); const m = parseInt(month);
        if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
            if (year && year.length === 2) year = '20' + year;
            const normalized = year ? `${day}/${month}/${year}` : `${day}/${month}`;
            return { normalized, original: stdMatch[0] };
        }
    }

    // 4. Dotted DD.MM.YYYY
    const dotMatch = text.match(/\b([0-3OQoIl|SBZzGT]?[0-9OQoIl|SBZzGT])\.([0-1OQoIl|SBZzGT]?[0-9OQoIl|SBZzGT])\.([0-9OQoIl|SBZzGT]{2,4})\b/i);
    if (dotMatch) {
        const day = fixOcrDate(dotMatch[1]).padStart(2, '0');
        const month = fixOcrDate(dotMatch[2]).padStart(2, '0');
        let year = fixOcrDate(dotMatch[3]);
        const d = parseInt(day); const m = parseInt(month);
        if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
            if (year && year.length === 2) year = '20' + year;
            return { normalized: `${day}/${month}/${year}`, original: dotMatch[0] };
        }
    }

    return null;
};

// ---------------------------------------------------------------------------
// resolveYear / dateToInt / advanceDate / extractStatementYear
// ---------------------------------------------------------------------------
export const resolveYear = (dateStr: string, statementYear: string): string => {
    if (!dateStr) return "";
    let normalized = dateStr.replace(/[\.\-]/g, '/');
    const longMatch = normalized.match(/(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})/i);
    if (longMatch) {
        const day = longMatch[1].padStart(2, '0');
        const monthName = longMatch[2].toLowerCase();
        const month = (MONTHS_PT[monthName] || '01').toString().padStart(2, '0');
        return `${day}/${month}/${longMatch[3]}`;
    }
    const parts = normalized.split('/');
    if (parts.length >= 2) {
        const day = fixOcrDate(parts[0]).padStart(2, '0');
        const month = fixOcrDate(parts[1]).padStart(2, '0');
        let year = parts[2] ? fixOcrDate(parts[2]) : statementYear;
        if (year && year.length === 2) year = '20' + year;
        if (!year) return `${day}/${month}`;
        return `${day}/${month}/${year}`;
    }
    return dateStr;
};

export const dateToInt = (d: string): number => {
    if (!d) return 0;
    const m = d.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
    if (!m) return 0;
    return parseInt(m[3] || '0', 10) * 10000 + parseInt(m[2], 10) * 100 + parseInt(m[1], 10);
};

export const advanceDate = (current: string, candidate: string): string => {
    if (!current) return candidate;
    if (!candidate) return current;
    const curHasYear = current.split('/').length === 3;
    const candHasYear = candidate.split('/').length === 3;
    if (candHasYear && !curHasYear) return candidate;
    if (!candHasYear && curHasYear) return `${candidate}/${current.split('/')[2]}`;
    return candidate;
};

export const extractStatementYear = (text: string): string => {
    const m = text.match(/\b(20\d{2})\b/);
    return m ? m[1] : '';
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
const extractDocumento = (text: string): string | undefined => {
    const match = text.match(/\b\d{2}\.\d{3}\.\d{3}[\s/]\d{4}-\d{2}\b|\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{14}\b|\b\d{10,13}\b/);
    return match ? match[0] : undefined;
};

const cleanHistoricoString = (s: string) => sanitizeHistory(s);

const buildCleanHistorico = (rawText: string, valStr: string, date: string, allMoneyGlobal: RegExp): string => {
    const doc = extractDocumento(rawText);
    let cleaned = rawText.split(date).join('').replace(allMoneyGlobal, '');
    if (doc) cleaned = cleaned.replace(doc, '');
    return cleanHistoricoString(cleaned);
};

// Determines if a text line looks like the start of a new transaction row
// (has a leading date or a known bank transaction keyword + money on the same line).
const isNewTransactionLine = (text: string): boolean => {
    // Starts with a date
    if (/^\d{1,2}[\/\.\-]\d{1,2}/.test(text.trim())) return true;
    return false;
};

// Determines if a continuation line should be EXCLUDED from descLines
// Returns true → skip, false → include
const shouldSkipAsContinuation = (text: string, ignoreList?: string[], config?: ExtractionConfig): boolean => {
    const t = text.trim();
    if (!t || t.length < 2) return true;
    if (isBankHeaderLine(t)) return true;
    if (isNewTransactionLine(t)) return true;
    if (ignoreList && ignoreList.some(w => t.toLowerCase().includes(w.toLowerCase()))) return true;
    if (config?.ignoreWords && config.ignoreWords.some(w => t.toLowerCase().includes(w.toLowerCase()))) return true;
    return false;
};

// ---------------------------------------------------------------------------
// parsePlainText — legacy plain-text parser (used for .txt / pasted text)
// ---------------------------------------------------------------------------
export const parsePlainText = (text: string, inferredYear?: string, ignoreList?: string[], config?: ExtractionConfig): Transaction[] => {
    // Normalize unicode dashes and common OCR artifacts
    text = text.replace(/[−–]/g, '-')
        .replace(/(\d)\.,(\d)/g, '$1.$2')
        .replace(/(\d+),(\d{3}),(\d{2})\b/g, '$1.$2,$3')
        .replace(/(\d)\s*\.\s*(\d{3}),(\d{2})/g, '$1.$2,$3')
        .replace(/[Dd][Ee3][Bb][Ii1][Tt][Oo0]/g, 'DÉBITO')
        .replace(/[Cc][Rr][Ee3][Dd][Ii1][Tt][Oo0]/g, 'CRÉDITO')
        .replace(/\b[Ll][Oo0][Ff]\b/ig, 'IOF')
        .replace(/\b[Ll][Oo0][Ff]\s+ADICIONAL\b/ig, 'IOF ADICIONAL')
        .replace(/\b[Ll][Oo0][Ff]\s+DIARIO\b/ig, 'IOF DIARIO')
        .replace(/(\d)\s+([.,])\s+(\d)/g, '$1$2$3')
        .replace(/(\d)\s+([.,])(\d)/g, '$1$2$3')
        .replace(/(\d)([.,])\s+(\d)/g, '$1$2$3');

    console.log("Parsing text (length:", text.length, "):", text.substring(0, 500) + "...");

    const lines = text.split(/\r?\n/);
    let lastValidContextDate = "";
    let statementYear = inferredYear || extractStatementYear(text);

    const shouldIgnore = (t: string) => {
        const trimmed = t.trim();
        if (trimmed.length === 0) return true;
        if (isBankHeaderLine(trimmed)) return true;
        if (ignoreList && ignoreList.some(w => trimmed.toLowerCase().includes(w.toLowerCase()))) return true;
        if (config?.ignoreWords && config.ignoreWords.some(w => trimmed.toLowerCase().includes(w.toLowerCase()))) return true;
        return false;
    };

    interface PendingTxt {
        id: string;
        data: string;
        historico: string;
        valor: number;
        cd: 'C' | 'D';
        isInheritedDate: boolean;
        documento?: string;
        descLines: string[];
    }

    let pending: PendingTxt | null = null;
    let preBuffer: string[] = [];
    const results: Transaction[] = [];

    const flushPendingTxt = (p: PendingTxt | null) => {
        if (!p) return;
        const extraDesc = (p.descLines || [])
            .filter(l => l && l.trim().length > 2 && !isBankHeaderLine(l))
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        const currentHist = p.historico;
        const isJunk = !currentHist || /^(lançamento|lancamento)$/i.test(currentHist.trim());

        let fullHistorico = "";
        if (!isJunk && extraDesc) {
            fullHistorico = cleanHistoricoString(`${currentHist} ${extraDesc}`);
        } else {
            fullHistorico = cleanHistoricoString((isJunk ? "" : currentHist) || extraDesc);
        }

        const rawHistory = extraDesc ? `${p.historico} ${extraDesc}` : p.historico;
        const documento = p.documento || extractDocumento(rawHistory);

        if (ignoreList && ignoreList.length > 0) {
            const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
            const histNorm = normalize(fullHistorico);
            if (ignoreList.some(k => histNorm.includes(normalize(k).trim()))) return;
        }

        results.push({
            id: p.id,
            data: p.data,
            historico: fullHistorico,
            valor: p.valor,
            cd: p.cd,
            isInheritedDate: p.isInheritedDate,
            documento,
        });
    };

    lines.forEach((rawText, idx) => {
        rawText = rawText.trim();
        if (!rawText) return;

        // Flush pending and skip header lines immediately
        if (isBankHeaderLine(rawText)) {
            flushPendingTxt(pending);
            pending = null;
            preBuffer = [];
            return;
        }
        if (shouldIgnore(rawText)) { flushPendingTxt(pending); pending = null; return; }

        const allMoneyMatches = Array.from(rawText.matchAll(new RegExp(moneyRegex.source, 'g')));
        let moneyMatch = null;
        if (allMoneyMatches.length > 0) {
            const withIndicator = allMoneyMatches.find(m => /[DC]$/i.test(m[1].trim()));
            if (withIndicator) {
                moneyMatch = withIndicator;
            } else {
                const withTwoDecimals = allMoneyMatches.find(m => hasTwoDecimals(m[1]));
                moneyMatch = withTwoDecimals || allMoneyMatches[0];
            }
        }
        const dateExtraction = extractDateFromText(rawText, statementYear);

        // Update context date — only if at start of line (position ≤ 12) or line is almost entirely the date
        if (dateExtraction && !/^00\/00/.test(dateExtraction.normalized)) {
            const pos = rawText.indexOf(dateExtraction.original);
            const prefix = rawText.substring(0, Math.max(0, pos)).toLowerCase();
            const isNoisePrefix = /emitido|impresso|gerado|emiss[ãa]o|p[áa]gina|vencimento|venc\.|venc\b|agendado|previs[ãa]o|vence\s+em/i.test(prefix);
            const isHeader = rawText.length <= dateExtraction.original.length + 15;
            const isConfigMode = !!config;

            if (!isNoisePrefix && (isConfigMode || pos <= 15 || isHeader)) {
                let finalDate = dateExtraction.normalized;
                if (finalDate.split('/').length === 2 && statementYear) {
                    finalDate = `${finalDate}/${statementYear}`;
                }
                lastValidContextDate = finalDate;
                if (pending && config?.dateMode === 'one-per-tx') {
                    flushPendingTxt(pending);
                    pending = null;
                }
            }
        }

        if (moneyMatch) {
            const valStr = moneyMatch[1].trim();
            const isNegative = /^[-−]/.test(valStr) || /^\(.*\)$/.test(valStr);
            const isPositive = /^[+]/.test(valStr);

            let numeric = parseValue(valStr);
            if (isNaN(numeric) || numeric === 0) {
                if (pending && !shouldSkipAsContinuation(rawText, ignoreList, config)) {
                    const maxExtraLines = config ? (config.historyLines - 1) : 10;
                    if (pending.descLines.length < maxExtraLines) {
                        pending.descLines.push(rawText);
                    }
                }
                return;
            }
            numeric = Math.round(Math.abs(numeric) * 100) / 100;

            flushPendingTxt(pending);
            pending = null;

            // Determine credit/debit
            let indicator = '';
            if (/d[eé]b(ito)?/i.test(rawText)) indicator = 'D';
            else if (/cr[eé]d(ito)?/i.test(rawText)) indicator = 'C';

            if (!indicator) {
                const valEnd = rawText.indexOf(valStr) + valStr.length;
                const afterVal = rawText.slice(valEnd);
                const suffixMatch = afterVal.match(/^\s*([CD])(?:[\s|]|$)/i);
                if (suffixMatch) indicator = suffixMatch[1].toUpperCase();
            }

            if (!indicator) {
                const rowMatch = rawText.match(/\|\s*([CD])\s*(?:\||$)/i)
                    || rawText.match(/(?:^|[\s|])([CD])(?:[\s|]|$)/i);
                if (rowMatch) indicator = rowMatch[1].toUpperCase();
            }

            if (!indicator) {
                for (let j = 1; j <= 5; j++) {
                    if (!lines[idx + j]) break;
                    const next = lines[idx + j].trim();
                    if (next.match(moneyRegex) && /\d{1,2}[\/\.]/.test(next)) break;
                    if (/^D$/i.test(next)) { indicator = 'D'; lines[idx + j] = ''; break; }
                    if (/^C$/i.test(next)) { indicator = 'C'; lines[idx + j] = ''; break; }
                    const trailing = next.match(/\s([DC])$/i);
                    if (trailing) { indicator = trailing[1].toUpperCase(); lines[idx + j] = next.replace(/\s([DC])$/i, ''); break; }
                }
            }

            let cd: 'C' | 'D' = 'C';
            if (indicator === 'D') cd = 'D';
            else if (indicator === 'C') cd = 'C';
            else {
                const lower = rawText.toLowerCase();
                if (/pix\s*(enviad|emit|saiu|out)|ted\s*enviad|transf.*\boutro\b|d[eé]b|saída|pagament|d[ée]bito/i.test(lower)) cd = 'D';
                else if (/pix\s*(recebid|in|entrou)|ted\s*receb|cr[eé]d|entrada|recebiment/i.test(lower)) cd = 'C';
                else if (isNegative) cd = 'D';
                else if (isPositive) cd = 'C';
                else cd = 'C';
            }

            if (!lastValidContextDate && !config) {
                console.log(`[parsePlainText] Skipping transaction because no date context found yet: "${rawText}"`);
                return;
            }

            const allMoneyGlobal = new RegExp(moneyRegex.source, 'g');
            let historico = config
                ? rawText.trim()
                : buildCleanHistorico(rawText, valStr, dateExtraction?.original || lastValidContextDate, allMoneyGlobal);

            if (!historico && !config) return;

            if (preBuffer.length > 0) {
                const preText = preBuffer.join(' ');
                historico = historico ? cleanHistoricoString(`${preText} ${historico}`) : cleanHistoricoString(preText);
                preBuffer = [];
            }

            const documento = extractDocumento(rawText);

            pending = {
                id: `txt-${idx}`,
                data: lastValidContextDate,
                historico: historico || "",
                valor: numeric,
                cd,
                isInheritedDate: !dateExtraction,
                documento,
                descLines: [],
            };
        } else {
            // Non-money line
            if (pending && rawText.length > 0 && !shouldSkipAsContinuation(rawText, ignoreList, config)) {
                const maxExtraLines = (config?.historyMode === 'smart') ? 20 : (config ? (config.historyLines - 1) : 10);
                if (pending.descLines.length < maxExtraLines) {
                    if (config) {
                        pending.descLines.push(rawText);
                    } else if (rawText.length > 2) {
                        pending.descLines.push(rawText);
                    }
                }
            } else if (!pending && rawText.length > 2 && !shouldIgnore(rawText) && !isBankHeaderLine(rawText)) {
                preBuffer.push(rawText);
                if (preBuffer.length > 4) preBuffer.shift();
            }
        }
    });

    flushPendingTxt(pending);
    return results;
};

// ---------------------------------------------------------------------------
// extractLinesFromPDF
// ---------------------------------------------------------------------------
export const extractLinesFromPDF = async (
    file: File,
    inferredYear?: string,
    setProcessingMsg?: (msg: string) => void,
    ignoreList?: string[],
    config?: ExtractionConfig
): Promise<ScannedLine[]> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const allLines: ScannedLine[] = [];
    let lastValidContextDate = "";
    let statementYear = inferredYear || "";
    let currentSectionContext: 'C' | 'D' | null = null;

    const shouldIgnore = (t: string) => {
        const trimmed = t.trim();
        if (trimmed.length === 0) return true;
        if (isBankHeaderLine(trimmed)) return true;
        if (ignoreList && ignoreList.some(w => trimmed.toLowerCase().includes(w.toLowerCase()))) return true;
        if (config?.ignoreWords && config.ignoreWords.some(w => trimmed.toLowerCase().includes(w.toLowerCase()))) return true;
        return false;
    };

    const flushPending = (pending: { line: ScannedLine; descLines: string[]; documento?: string; lastY?: number } | null) => {
        if (!pending) return;
        const { line, descLines } = pending;
        if (line.transactionData) {
            const extra = (descLines || [])
                .filter(d => d && d.trim().length > 2 && !isBankHeaderLine(d))
                .map(d => config ? d.trim() : cleanHistoricoString(d))
                .filter(d => d && d.length > 2)
                .join(' ')
                .trim();

            const rawHistory = descLines.join(' ') + ' ' + (line.transactionData.historico || '');
            const documento = pending.documento || extractDocumento(rawHistory);
            if (documento) line.transactionData.documento = documento;

            const currentHist = line.transactionData.historico;
            const isJunk = !currentHist || /^(lançamento|lancamento)$/i.test(currentHist.trim());
            let finalHistorico = "";
            if (!isJunk && extra) {
                finalHistorico = cleanHistoricoString(`${currentHist} ${extra}`);
            } else {
                finalHistorico = cleanHistoricoString((isJunk ? "" : currentHist) || extra);
            }
            line.transactionData.historico = finalHistorico;

            if (ignoreList && ignoreList.length > 0) {
                const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
                const histNorm = normalize(line.transactionData.historico);
                if (ignoreList.some(k => histNorm.includes(normalize(k).trim()))) return;
            }
        }
        allLines.push(line);
    };

    let pendingGlobal: { line: ScannedLine; descLines: string[]; documento?: string; lastY?: number } | null = null;
    let preBuffer: string[] = [];
    let stopParsing = false;

    const extractRowText = (row: any[], cfg?: ExtractionConfig): string => {
        if (cfg && cfg.columns && cfg.columns.length > 0 && cfg.columnMapping.description) {
            const descCol = cfg.columns.find(c => c.id === cfg.columnMapping.description);
            if (descCol) {
                return row.filter(item => {
                    const itemLeft = item.x;
                    const itemRight = item.x + (item.w || 0);
                    const itemCenterX = item.x + (item.w || 0) / 2;
                    let maxOverlap = 0;
                    let bestCol: any = null;
                    cfg.columns.forEach(c => {
                        const cStart = c.start / 2;
                        const cEnd = c.end / 2;
                        const overlapStart = Math.max(itemLeft, cStart - 10);
                        const overlapEnd = Math.min(itemRight, cEnd + 10);
                        const overlap = overlapEnd - overlapStart;
                        if (overlap > maxOverlap) { maxOverlap = overlap; bestCol = c; }
                    });
                    if (!bestCol) {
                        bestCol = cfg.columns.find(c => itemCenterX >= (c.start / 2) - 15 && itemCenterX <= (c.end / 2) + 15) || null;
                    }
                    return bestCol && bestCol.id === descCol.id;
                }).map((it: any) => it.str).join(' ').trim();
            }
        }
        return cfg ? "" : row.map((it: any) => it.str).join(' ').trim();
    };

    const processRow = (row: any[], pageNum: number, rowY: number, pageHeight: number, stmtYear: string, cfg?: ExtractionConfig): Transaction | null => {
        let rawText = "";
        let dateStr = "";
        let historico = "";
        let valorStr = "";
        let indicatorStr = "";
        const fullRowText = row.map((it: any) => it.str).join(' ').trim();

        // If the full row is a header, skip immediately
        if (isBankHeaderLine(fullRowText)) {
            if (pendingGlobal) { flushPending(pendingGlobal); pendingGlobal = null; }
            return null;
        }
        if (shouldIgnore(fullRowText)) return null;

        if (cfg && cfg.columns && cfg.columns.length > 0) {
            const cols: Record<string, string> = {};
            cfg.columns.forEach(c => cols[c.id] = "");
            const textToKeep: string[] = [];

            row.forEach(item => {
                const itemLeft = item.x;
                const itemRight = item.x + (item.w || 0);
                const itemCenterX = item.x + (item.w || 0) / 2;
                let maxOverlap = 0;
                let bestCol: any = null;
                cfg.columns.forEach(c => {
                    const cStart = c.start / 2;
                    const cEnd = c.end / 2;
                    const overlapStart = Math.max(itemLeft, cStart - 10);
                    const overlapEnd = Math.min(itemRight, cEnd + 10);
                    const overlap = overlapEnd - overlapStart;
                    if (overlap > maxOverlap) { maxOverlap = overlap; bestCol = c; }
                });
                if (!bestCol) {
                    bestCol = cfg.columns.find(c => itemCenterX >= (c.start / 2) - 20 && itemCenterX <= (c.end / 2) + 20) || null;
                }
                if (bestCol) cols[bestCol.id] += (cols[bestCol.id] ? " " : "") + item.str;
                if (!bestCol || !bestCol.id.startsWith('ignore')) textToKeep.push(item.str);
            });

            if (cfg.columnMapping.date) dateStr = cols[cfg.columnMapping.date] || "";
            if (cfg.columnMapping.description) historico = cols[cfg.columnMapping.description] || "";
            if (cfg.columnMapping.value) valorStr = cols[cfg.columnMapping.value] || "";
            if (cfg.columnMapping.indicator) indicatorStr = cols[cfg.columnMapping.indicator] || "";
            let creditStr = cfg.columnMapping.credit ? (cols[cfg.columnMapping.credit] || "") : "";
            let debitStr = cfg.columnMapping.debit ? (cols[cfg.columnMapping.debit] || "") : "";

            if (!valorStr && cfg.columnMapping.credit && cfg.columnMapping.debit) {
                if (creditStr.trim()) { valorStr = creditStr; indicatorStr = "C"; }
                else if (debitStr.trim()) { valorStr = debitStr; indicatorStr = "D"; }
            }

            rawText = textToKeep.join(' ').trim();
        } else {
            rawText = fullRowText;
        }

        if (!rawText && !valorStr && !dateStr) return null;

        // Money detection
        let moneyMatch: RegExpMatchArray | null = null;
        if (cfg) {
            if (valorStr || indicatorStr) {
                const searchStr = valorStr || indicatorStr;
                const allMatches = Array.from(searchStr.matchAll(new RegExp(moneyRegex.source, 'g')));
                if (allMatches.length > 0) {
                    const withIndicator = allMatches.find(m => /[DC]$/i.test(m[1].trim()));
                    if (withIndicator) {
                        moneyMatch = withIndicator;
                    } else {
                        const withTwoDecimals = allMatches.find(m => hasTwoDecimals(m[1]));
                        moneyMatch = withTwoDecimals ?? allMatches[0];
                    }
                } else {
                    const fallbackRegex = /([-+−]?\s*[0-9OQoIl|SBZzGTgqs]+(?:[.,\s]*[0-9OQoIl|SBZzGTgqs]+)*)/;
                    const fallbackMatch = searchStr.match(fallbackRegex);
                    if (fallbackMatch && /[0-9]/.test(fallbackMatch[1])) {
                        const val = parseValue(fallbackMatch[1]);
                        if (!isNaN(val) && val !== 0) moneyMatch = [fallbackMatch[0], fallbackMatch[1]] as any;
                    }
                }
            }
        } else {
            const allMatches = Array.from(rawText.matchAll(new RegExp(moneyRegex.source, 'g')));
            if (allMatches.length > 0) {
                const withIndicator = allMatches.find(m => /[DC]$/i.test(m[1].trim()));
                if (withIndicator) {
                    moneyMatch = withIndicator;
                } else {
                    const withTwoDecimals = allMatches.find(m => hasTwoDecimals(m[1]));
                    moneyMatch = withTwoDecimals ?? allMatches[0];
                }
            }
        }

        // Date extraction
        let dateExtraction = null;
        if (cfg) {
            if (cfg.columnMapping.date && dateStr) {
                dateExtraction = extractDateFromText(dateStr, stmtYear);
            }
        } else {
            dateExtraction = extractDateFromText(rawText, stmtYear);
        }

        if (dateExtraction && !/^00\/00/.test(dateExtraction.normalized)) {
            const pos = rawText.indexOf(dateExtraction.original);
            const prefix = rawText.substring(0, Math.max(0, pos)).toLowerCase();
            const isNoisePrefix = /emitido|impresso|gerado|emiss[ãa]o|p[áa]gina|vencimento|venc\.|venc\b|agendado|previs[ãa]o|vence\s+em/i.test(prefix);
            const isHeader = rawText.length <= dateExtraction.original.length + 15;
            if (!isNoisePrefix && (!!cfg || pos <= 15 || isHeader)) {
                let finalDate = dateExtraction.normalized;
                if (finalDate.split('/').length === 2 && stmtYear) finalDate = `${finalDate}/${stmtYear}`;
                lastValidContextDate = finalDate;
                if (pendingGlobal && cfg?.dateMode === 'one-per-tx') {
                    flushPending(pendingGlobal);
                    pendingGlobal = null;
                }
            }
        }

        if (!moneyMatch) return null;

        const valStr = moneyMatch[1].trim();
        const valUpper = valStr.toUpperCase();
        const isNegative = valStr.includes('-') || valStr.includes('−') || (valStr.includes('(') && valStr.includes(')')) || valUpper.includes('D');
        const isPositive = valStr.includes('+') || valUpper.includes('C');

        let numeric = parseValue(valStr);
        if (isNaN(numeric) || numeric === 0) return null;
        numeric = Math.round(Math.abs(numeric) * 100) / 100;

        flushPending(pendingGlobal);
        pendingGlobal = null;

        // Text for history
        let textForHistory = rawText;
        if (cfg) {
            textForHistory = cfg.columnMapping.description ? historico : "";
        }
        textForHistory = textForHistory
            .replace(/\b[Ll][Oo0][Ff]\b/ig, 'IOF')
            .replace(/\b[Ll][Oo0][Ff]\s+ADICIONAL\b/ig, 'IOF ADICIONAL')
            .replace(/\b[Ll][Oo0][Ff]\s+DIARIO\b/ig, 'IOF DIARIO');

        // Indicator detection
        let indicator = '';
        if (cfg && cfg.columnMapping.indicator && indicatorStr) {
            const lowerInd = indicatorStr.toLowerCase();
            if (/\bcr[eé]d/i.test(lowerInd)) indicator = 'C';
            else if (/\bd[eé]b/i.test(lowerInd)) indicator = 'D';
            else if (lowerInd.includes('c') && !lowerInd.includes('d')) indicator = 'C';
            else if (lowerInd.includes('d') && !lowerInd.includes('c')) indicator = 'D';
            else if (lowerInd.includes('-') || lowerInd.includes('−')) indicator = 'D';
            else if (lowerInd.includes('+')) indicator = 'C';
        }

        if (!indicator && cfg && (cfg.columnMapping.value || cfg.columnMapping.indicator || (cfg.columnMapping.credit && cfg.columnMapping.debit))) {
            const lowerVal = (valorStr || indicatorStr || "").toLowerCase();
            if (/\b(d|deb|debito)\b/i.test(lowerVal) && !/\b(c|cre|credito)\b/i.test(lowerVal)) indicator = 'D';
            else if (/\b(c|cre|credito)\b/i.test(lowerVal) && !/\b(d|deb|debito)\b/i.test(lowerVal)) indicator = 'C';
            else if (lowerVal.endsWith(' d')) indicator = 'D';
            else if (lowerVal.endsWith(' c')) indicator = 'C';
        }

        if (!indicator) {
            const textToScan = cfg ? textForHistory : rawText;
            if (/d[eé]b(ito)?/i.test(textToScan)) indicator = 'D';
            else if (/cr[eé]d(ito)?/i.test(textToScan)) indicator = 'C';
        }

        if (!indicator) {
            const textToScan = cfg ? valorStr : rawText;
            const valStart = textToScan.indexOf(valStr);
            const valEnd = valStart + valStr.length;
            if (valStart > 0) {
                const beforeVal = textToScan.slice(0, valStart);
                const prefixMatch = beforeVal.match(/(?:^|[\s|])(D[EÉ]?B?(?:ITO)?|C[R]?[EÉ]?D?(?:ITO)?)\s*$/i);
                if (prefixMatch) indicator = prefixMatch[1].toUpperCase().startsWith('D') ? 'D' : 'C';
            }
            if (!indicator && valEnd >= valStr.length) {
                const afterVal = textToScan.slice(valEnd);
                const suffixMatch = afterVal.match(/^\s*(D[EÉ]?B?(?:ITO)?|C[R]?[EÉ]?D?(?:ITO)?)(?:[\s|]|$)/i);
                if (suffixMatch) indicator = suffixMatch[1].toUpperCase().startsWith('D') ? 'D' : 'C';
            }
        }

        let cd: 'C' | 'D' = 'C';
        if (indicator === 'D') cd = 'D';
        else if (indicator === 'C') cd = 'C';
        else {
            const textToScan = cfg ? textForHistory : rawText;
            const lower = textToScan.toLowerCase();
            if (/pix\s*(enviad|emit|saiu|out)|ted\s*enviad|transf.*\boutro\b|d[eé]b|saída|pagament|d[ée]bito/i.test(lower)) cd = 'D';
            else if (/pix\s*(recebid|in|entrou)|ted\s*receb|cr[eé]d|entrada|recebiment/i.test(lower)) cd = 'C';
            else if (isNegative) cd = 'D';
            else if (isPositive) cd = 'C';
            else cd = 'C';
        }

        if (!lastValidContextDate && !cfg) {
            console.log(`[processRow] Skipping: no date context for "${rawText}"`);
            return null;
        }

        const allMoneyGlobal = new RegExp(moneyRegex.source, 'g');
        let finalHistorico = cfg
            ? textForHistory.trim()
            : buildCleanHistorico(textForHistory, valStr, dateExtraction?.original || "", allMoneyGlobal);

        // Drop if history is just a day-of-week or month name (false positive)
        if (!cfg) {
            if (/^(segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)(?:-feira)?$/i.test(finalHistorico.trim())) return null;
            if (/^\d{1,2}\s+de\s+(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/i.test(finalHistorico.trim())) return null;
        }

        return {
            id: `t-${pageNum}-${rowY}`,
            data: lastValidContextDate,
            historico: finalHistorico || "",
            valor: cd === 'D' ? -Math.abs(numeric) : Math.abs(numeric),
            cd,
            isInheritedDate: !dateExtraction,
        };
    };

    let globalWorker: any = null;

    const runOCR = async (pageNum: number, page: any, hiViewport: any, hiCanvas: any, hiCtx: CanvasRenderingContext2D, dataUrl: string, ocrScale: number) => {
        try {
            if (!globalWorker) {
                globalWorker = await (Tesseract as any).createWorker('por', 1, {
                    workerPath: 'https://unpkg.com/tesseract.js@v5.1.1/dist/worker.min.js',
                    langPath: 'https://tessdata.projectnaptha.com/4.0.0',
                    corePath: 'https://unpkg.com/tesseract.js-core@v5.1.1',
                    logger: (m: any) => {
                        if (m.status === 'recognizing text' && setProcessingMsg) {
                            setProcessingMsg(`Extraindo texto: ${Math.round(m.progress * 100)}%`);
                        }
                    }
                });
                await globalWorker.setParameters({ tessedit_pageseg_mode: '11' });
            }
            const ocr = await globalWorker.recognize(dataUrl);
            return ocr.data as any;
        } catch (err) {
            console.error(`[OCR Error] Page ${pageNum}:`, err);
            return null;
        }
    };

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        if (stopParsing) break;
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 2 });

        const textContent = await page.getTextContent();
        let items: any[] = (textContent.items || []).map((item: any) => ({
            str: item.str,
            x: item.transform[4] * 2,
            y: item.transform[5] * 2,
            w: item.width * 2,
            h: (item.height || 10) * 2,
        })).filter((item: any) => item.str && item.str.trim().length > 0);

        const totalChars = (items || []).reduce((s: number, it: any) => s + (it.str || "").trim().length, 0);
        const hasNumbers = items.some(it => /[0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2}/.test(it.str) || /\d{2}\/\d{2}/.test(it.str));
        let isScanned = items.length < 5 || (items.length < 50 && !hasNumbers && totalChars < 150);

        const pageHeight = viewport.height;

        const startPageVal = config?.startPage ?? 1;
        const endPageVal = config?.endPage || pdf.numPages;

        if (pageNum < startPageVal || pageNum > endPageVal) {
            console.log(`Skipping page ${pageNum} (outside ${startPageVal}-${endPageVal})`);
            continue;
        }

        if (!statementYear) {
            const pageText = items.map((it: any) => it.str).join(' ');
            const yr = extractStatementYear(pageText);
            if (yr) statementYear = yr;
        }

        const startY = config ? (config.startLine / 100) * pageHeight : -1;
        const endY = (config && pageNum === endPageVal) ? (config.endLine / 100) * pageHeight : pageHeight + 1;

        const groupItemsIntoRows = (rawItems: any[]): any[][] => {
            rawItems.sort((a, b) => b.y - a.y);
            const result: any[][] = [];
            if (rawItems.length === 0) return result;
            let currentRow = [rawItems[0]];
            let rowSumY = rawItems[0].y;
            for (let i = 1; i < rawItems.length; i++) {
                const item = rawItems[i];
                const avgY = rowSumY / currentRow.length;
                if (Math.abs(item.y - avgY) < 8) {
                    currentRow.push(item);
                    rowSumY += item.y;
                } else {
                    currentRow.sort((a, b) => a.x - b.x);
                    result.push(currentRow);
                    currentRow = [item];
                    rowSumY = item.y;
                }
            }
            currentRow.sort((a, b) => a.x - b.x);
            result.push(currentRow);
            return result;
        };

        const processRows = (rows: any[][], fromOCR: boolean) => {
            let pCount = 0;
            for (const row of rows) {
                const avgY = row.reduce((sum: number, item: any) => sum + item.y, 0) / row.length;
                const avgH = row.reduce((sum: number, item: any) => sum + item.h, 0) / row.length;
                const rowYFromTop = pageHeight - (avgY + avgH / 2);

                if (pageNum === startPageVal && rowYFromTop < startY) continue;
                if (pageNum === endPageVal && rowYFromTop > endY) break;

                // Check horizontal ignore regions
                if (config?.horizontalRegions && config.horizontalRegions.length > 0) {
                    const isHIgnored = config.horizontalRegions.some(r => {
                        const hStart = Math.min(r.start, r.end) / 2;
                        const hEnd = Math.max(r.start, r.end) / 2;
                        return rowYFromTop >= hStart - 10 && rowYFromTop <= hEnd + 10;
                    });
                    if (isHIgnored) continue;
                }

                const fullRowText = row.map((it: any) => it.str).join(' ').trim();

                // Hard skip headers — also flush pending to avoid contamination
                if (isBankHeaderLine(fullRowText)) {
                    if (pendingGlobal) { flushPending(pendingGlobal); pendingGlobal = null; }
                    preBuffer = [];
                    continue;
                }
                if (shouldIgnore(fullRowText)) {
                    if (pendingGlobal) { flushPending(pendingGlobal); pendingGlobal = null; }
                    continue;
                }

                const tx = processRow(row, pageNum, avgY, pageHeight, statementYear, config);
                if (tx) {
                    if (pendingGlobal) flushPending(pendingGlobal);
                    const lineId = `p${pageNum}-${fromOCR ? 'ocr' : 'txt'}-${pCount++}`;
                    const line: ScannedLine = {
                        id: lineId,
                        page: pageNum,
                        originalY: avgY,
                        x: row[0].x,
                        width: 500,
                        height: 12,
                        rawText: tx.historico,
                        type: 'TRANSACTION' as const,
                        transactionData: tx,
                    };
                    pendingGlobal = { line, descLines: [...preBuffer], lastY: avgY };
                    preBuffer = [];
                } else {
                    const rawText = extractRowText(row, config);
                    if (!shouldIgnore(fullRowText) && !isBankHeaderLine(fullRowText)) {
                        if (pendingGlobal && rawText.length > 0) {
                            // Gap-based flush
                            if (pendingGlobal.lastY !== undefined) {
                                const gap = Math.abs(pendingGlobal.lastY - avgY);
                                if (gap > 35) {
                                    flushPending(pendingGlobal);
                                    pendingGlobal = null;
                                    if (rawText.length > 0 && !isBankHeaderLine(rawText)) {
                                        preBuffer.push(rawText);
                                        if (preBuffer.length > 4) preBuffer.shift();
                                    }
                                    continue;
                                }
                            }
                            if (pendingGlobal && !shouldSkipAsContinuation(rawText, ignoreList, config)) {
                                const maxExtraLines = (config?.historyMode === 'smart') ? 20 : (config ? (config.historyLines - 1) : 10);
                                if (pendingGlobal.descLines.length < maxExtraLines) {
                                    if (config) { pendingGlobal.descLines.push(rawText); }
                                    else if (rawText.length > 2) { pendingGlobal.descLines.push(rawText); }
                                    pendingGlobal.lastY = avgY;
                                }
                            }
                        } else if (rawText.length > 0 && !isBankHeaderLine(rawText)) {
                            preBuffer.push(rawText);
                            if (preBuffer.length > 4) preBuffer.shift();
                        }
                    }
                }
            }
        };

        const handleOCR = async () => {
            try {
                if (setProcessingMsg) setProcessingMsg(`Processando OCR página ${pageNum}/${pdf.numPages}...`);
                const ocrScale = 2.5;
                const hiViewport = page.getViewport({ scale: ocrScale });
                const hiCanvas = document.createElement('canvas');
                hiCanvas.width = hiViewport.width;
                hiCanvas.height = hiViewport.height;
                const hiCtx = hiCanvas.getContext('2d', { willReadFrequently: true });
                if (!hiCtx) { console.error('Could not get 2d context for OCR canvas'); return; }
                hiCtx.fillStyle = 'white';
                hiCtx.fillRect(0, 0, hiCanvas.width, hiCanvas.height);
                await page.render({ canvasContext: hiCtx, viewport: hiViewport, intent: 'print' }).promise;

                // Image pre-processing: grayscale + contrast + binarize
                const imageData = hiCtx.getImageData(0, 0, hiCanvas.width, hiCanvas.height);
                const d = imageData.data;
                for (let i = 0; i < d.length; i += 4) {
                    let gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                    gray = (gray - 128) * 1.8 + 128;
                    if (gray > 200) gray = 255;
                    else if (gray < 80) gray = 0;
                    else gray = Math.max(0, Math.min(255, gray));
                    d[i] = d[i + 1] = d[i + 2] = gray;
                }
                hiCtx.putImageData(imageData, 0, 0);

                const dataUrl = hiCanvas.toDataURL('image/png');
                if (dataUrl.length < 1000) return;

                const ocrData = await runOCR(pageNum, page, hiViewport, hiCanvas, hiCtx, dataUrl, ocrScale);
                if (!ocrData) return;

                const ocrItems = (ocrData.lines || []).flatMap((line: any) =>
                    line.words.map((word: any) => ({
                        str: word.text,
                        x: (word.bbox.x0 / ocrScale) * 2,
                        y: ((hiViewport.height - word.bbox.y1) / ocrScale) * 2,
                        w: (word.bbox.x1 - word.bbox.x0) / ocrScale * 2,
                        h: (word.bbox.y1 - word.bbox.y0) / ocrScale * 2,
                        page: pageNum
                    }))
                );
                processRows(groupItemsIntoRows(ocrItems), true);
            } catch (e) {
                console.error('OCR failed', e);
            }
        };

        if (!isScanned && items.length > 0) {
            processRows(groupItemsIntoRows(items), false);
            continue;
        }

        await handleOCR();
    }

    flushPending(pendingGlobal);
    if (globalWorker) await globalWorker.terminate();
    return allLines;
};

export { parseValue as parseOcrMoneyValue };

export function isExtratoDatePlaceholder(s: string | undefined | null): boolean {
  const t = String(s ?? '').trim();
  if (!t) return true;
  const compact = t.replace(/\s+/g, '');
  if (/^[-–—_./\\|]+$/.test(compact)) return true;
  if (/^(n\/?a|null|vazio|s\/d|nd|n\.?d\.?)$/i.test(compact)) return true;
  if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(compact)) return true;
  return false;
}

export function extratoDateToIso(data: string, statementYear?: string): string {
  const trimmed = String(data ?? '')
    .trim()
    .replace(/\s*([\/\-\.])\s*/g, '$1');
  if (isExtratoDatePlaceholder(trimmed)) return '';
  if (!trimmed) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const year = statementYear?.trim() || String(new Date().getFullYear());
  const resolved = resolveYear(trimmed, year);
  const full = resolved.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (full) {
    return `${full[3]}-${full[2].padStart(2, '0')}-${full[1].padStart(2, '0')}`;
  }

  const ext = extractDateFromText(trimmed, year);
  if (ext) {
    let d = ext.normalized;
    if (d.split('/').length === 2) d = `${d}/${year}`;
    const resolvedExt = resolveYear(d, year);
    const fullExt = resolvedExt.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (fullExt) {
      return `${fullExt[3]}-${fullExt[2].padStart(2, '0')}-${fullExt[1].padStart(2, '0')}`;
    }
  }

  const loose = trimmed.match(/(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/);
  if (loose) {
    const idx = loose.index ?? 0;
    const before = trimmed.slice(Math.max(0, idx - 2), idx);
    const insideTedCode = /\d\.$/.test(before) && /^\d{3}\./.test(trimmed.slice(Math.max(0, idx - 3)));
    if (!insideTedCode) {
      const dd = loose[1]!.padStart(2, '0');
      const mm = loose[2]!.padStart(2, '0');
      const dVal = parseInt(dd, 10);
      const mVal = parseInt(mm, 10);
      if (dVal >= 1 && dVal <= 31 && mVal >= 1 && mVal <= 12) {
        const yp = loose[3]
          ? loose[3].length === 2
            ? `20${loose[3]}`
            : loose[3]
          : year;
        return `${yp}-${mm}-${dd}`;
      }
    }
  }
  return '';
}
