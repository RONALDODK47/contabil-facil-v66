import { isDominioLancamentosTxt } from '../../extratoVision/utils/dominioLancamentosTxt';
import { isPlanoFixedWidthFormat, isPlanoSemicolonFormat } from '../../extratoVision/utils/planoContasTxtParser';
import { isTxtPlusDominio } from './dominioTxtIO';

export type ContabilTxtFormat =
  | 'plano_dominio'
  | 'plano_semicolon'
  | 'plano_sped'
  | 'dominio_lanc'
  | 'txtplus'
  | 'separated'
  | 'unknown';

/** Detecta o formato real do TXT contábil (independente da aba aberta). */
export function detectContabilTxtFormat(text: string): ContabilTxtFormat {
  const sample = text.replace(/^\uFEFF/, '').trimStart();
  if (!sample) return 'unknown';

  // Test TXT+ FIRST (more specific pattern) to avoid false positives with dominio_lanc
  if (isTxtPlusDominio(sample)) return 'txtplus';
  
  // Eval Lançamentos to avoid regex collision in fixed-width plano format
  if (isDominioLancamentosTxt(sample)) return 'dominio_lanc';
  if (isPlanoSemicolonFormat(sample)) return 'plano_semicolon';
  if (isPlanoFixedWidthFormat(sample)) return 'plano_dominio';
  if (/\|I010\|/i.test(sample)) return 'plano_sped';

  const lines = sample.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const semicolonLines = lines.filter((l) => l.includes(';') || l.includes('|'));
  if (semicolonLines.length >= Math.min(3, lines.length)) return 'separated';

  return 'unknown';
}

/** Ajusta o botão clicado (XLSX/TXT) conforme a extensão real do arquivo. */
export function resolveImportFormat(
  file: File,
  requested: 'xlsx' | 'txt' | 'pdf',
): 'xlsx' | 'txt' | 'pdf' {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (requested === 'pdf') return 'pdf';
  if (['txt', 'sped'].includes(ext)) return 'txt';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return 'xlsx';
  return requested;
}
