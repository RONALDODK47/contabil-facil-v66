import { BankStatementJSON, ExtratoLine, BankStatementMetadata } from './types';
import { classifyTransaction } from './categoryClassifier';
import { parseTransactionsFromText, mergeTransactionLines } from './transactionParser';
import {
  parseBancoDoBrasilText,
  parseBBComprovanteText,
  parseItauText,
  parseSicrediWords,
  parseSicrediText,
  parseNubankText,
  parseWiseText,
  parseInterText,
  parseSantanderCompletoText,
  parseSantanderWords,
  parseInfinitePayText,
  parseInfinitePayJSON,
  parseBradescoText,
  parseBradescoWords,
  parseCaixaWords,
  parseCaixaAppWords,
  parseCresolWords,
  type InfinitePayJSONInput,
} from './bankParsers';
import type { BankCode } from './bankFormats';

function parseByBank(
  pdfText: string,
  bankCode?: BankCode,
  layoutId?: string
): { transactions: ExtratoLine[]; metadata: BankStatementMetadata | null } {
  if (bankCode === 'BANCO_DO_BRASIL') {
    if (layoutId === 'bdb_comprovante') {
      return parseBBComprovanteText(pdfText);
    }
    return parseBancoDoBrasilText(pdfText);
  }
  if (bankCode === 'ITAU') {
    return parseItauText(pdfText);
  }
  if (bankCode === 'NUBANK') {
    return parseNubankText(pdfText);
  }
  if (bankCode === 'WISE') {
    return parseWiseText(pdfText);
  }
  if (bankCode === 'INTER') {
    return parseInterText(pdfText);
  }
  if (bankCode === 'SANTANDER') {
    return parseSantanderCompletoText(pdfText);
  }
  if (bankCode === 'INFINITE_PAY') {
    return parseInfinitePayText(pdfText);
  }
  if (bankCode === 'BRADESCO') {
    return parseBradescoText(pdfText);
  }

  const { transactions, metadata } = parseTransactionsFromText(pdfText);
  return { transactions: mergeTransactionLines(transactions, metadata), metadata };
}

function finalizeStatement(
  rawTransactions: ExtratoLine[],
  metadata: BankStatementMetadata | null,
  overrideMetadata?: Partial<BankStatementMetadata>
): BankStatementJSON {
  const transactions = rawTransactions
    .filter((line) => line.date && line.description && line.amount !== undefined)
    .map((line) => ({
      date: line.date!,
      description: line.description!,
      amount: line.amount!,
      balance: line.balance ?? null,
      category: classifyTransaction(line.description!, line.amount!),
    }));

  // Não reordena por data: cada parser já emite os lançamentos na mesma
  // sequência em que aparecem no PDF (de cima para baixo). Alguns extratos
  // (ex.: exportação do app Caixa) listam do mais recente para o mais
  // antigo — reordenar por data ascendente inverteria essa ordem e deixaria
  // de bater com o documento original.

  // Nota: não deduplicar por (data, descrição, valor) — é comum haver duas
  // transações reais e distintas com esses três campos idênticos (ex.: dois
  // PIX de mesmo valor para o mesmo favorecido no mesmo dia). Deduplicar
  // aqui descartaria silenciosamente um lançamento real.

  const finalMetadata = {
    bank_name: overrideMetadata?.bank_name || metadata?.bank_name || 'Banco',
    account_number:
      overrideMetadata?.account_number || metadata?.account_number || '000000-0',
    period: overrideMetadata?.period || metadata?.period || '01/2026',
  };

  return {
    transactions,
    metadata: finalMetadata,
  };
}

export async function convertPDFToJSON(
  pdfText: string,
  overrideMetadata?: Partial<BankStatementMetadata>,
  bankCode?: BankCode,
  layoutId?: string
): Promise<BankStatementJSON> {
  const { transactions: rawTransactions, metadata } = parseByBank(pdfText, bankCode, layoutId);
  return finalizeStatement(rawTransactions, metadata, overrideMetadata);
}

export async function convertJSONFileToStatement(
  file: File,
  overrideMetadata?: Partial<BankStatementMetadata>,
  bankCode?: BankCode
): Promise<BankStatementJSON> {
  const text = await file.text();
  const data: InfinitePayJSONInput = JSON.parse(text);

  if (bankCode === 'INFINITE_PAY') {
    const { transactions, metadata } = parseInfinitePayJSON(data);
    return finalizeStatement(transactions, metadata, overrideMetadata);
  }

  throw new Error('JSON parsing is only supported for InfinitePay format');
}

export async function convertPDFFileToJSON(
  file: File,
  overrideMetadata?: Partial<BankStatementMetadata>,
  bankCode?: BankCode,
  layoutId?: string
): Promise<BankStatementJSON> {
  // Sicredi: dois modos de parse — por coordenada X/Y (sicredi_completo)
  // ou por texto puro em ordem de leitura (sicredi_texto).
  if (bankCode === 'SICREDI') {
    if (layoutId === 'sicredi_texto') {
      const { extractTextFromPDFFile } = await import('./pdfExtractor');
      const pdfText = await extractTextFromPDFFile(file);
      const { transactions, metadata } = parseSicrediText(pdfText);
      return finalizeStatement(transactions, metadata, overrideMetadata);
    }
    // Default: extração por palavras com coordenadas X/Y
    const { extractWordsFromPDFFile } = await import('./pdfExtractor');
    const pages = await extractWordsFromPDFFile(file);
    const { transactions, metadata } = parseSicrediWords(pages);
    return finalizeStatement(transactions, metadata, overrideMetadata);
  }

  if (bankCode === 'BRADESCO') {
    const { extractWordsFromPDFFile } = await import('./pdfExtractor');
    const pages = await extractWordsFromPDFFile(file);
    const { transactions, metadata } = parseBradescoWords(pages);
    return finalizeStatement(transactions, metadata, overrideMetadata);
  }

  // Caixa: o pdf.js entrega as palavras da tabela em ordem de coluna (todo o
  // bloco Data/Doc/Histórico, depois todo o bloco Favorecido/Valor/Saldo),
  // não em ordem de leitura por linha — precisa da posição X/Y para remontar
  // cada lançamento corretamente.
  if (bankCode === 'CAIXA') {
    const { extractWordsFromPDFFile } = await import('./pdfExtractor');
    const pages = await extractWordsFromPDFFile(file);
    const { transactions, metadata } =
      layoutId === 'caixa_app_periodo' ? parseCaixaAppWords(pages) : parseCaixaWords(pages);
    return finalizeStatement(transactions, metadata, overrideMetadata);
  }

  // Cresol: o histórico quebra em duas linhas e a data de cada lançamento fica
  // numa coluna própria, separada do cabeçalho do dia — só a posição X/Y
  // permite juntar data + histórico + valor do mesmo lançamento.
  if (bankCode === 'CRESOL') {
    const { extractWordsFromPDFFile } = await import('./pdfExtractor');
    const pages = await extractWordsFromPDFFile(file);
    const { transactions, metadata } = parseCresolWords(pages);
    return finalizeStatement(transactions, metadata, overrideMetadata);
  }

  // Santander: alguns PDFs entregam o texto do pdf.js fora da ordem visual
  // (data no meio da descrição, colunas inteiras em bloco) — a extração por
  // posição X/Y reconstrói a linha corretamente independente da ordem em
  // que o PDF desenhou o texto.
  if (bankCode === 'SANTANDER') {
    const { extractWordsFromPDFFile } = await import('./pdfExtractor');
    const pages = await extractWordsFromPDFFile(file);
    const { transactions, metadata } = parseSantanderWords(pages);
    return finalizeStatement(transactions, metadata, overrideMetadata);
  }

  // Import dynamically to avoid issues in browser/server environments
  const { extractTextFromPDFFile } = await import('./pdfExtractor');

  const pdfText = await extractTextFromPDFFile(file);
  return convertPDFToJSON(pdfText, overrideMetadata, bankCode, layoutId);
}

// Validate and fix transaction data
export function validateBankStatement(statement: BankStatementJSON): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!statement.metadata) {
    errors.push('Metadata is missing');
  }

  if (!statement.transactions || statement.transactions.length === 0) {
    errors.push('No transactions found');
  }

  // Validate each transaction
  for (let i = 0; i < statement.transactions.length; i++) {
    const tx = statement.transactions[i];

    if (!tx.date) {
      errors.push(`Transaction ${i}: Date is missing`);
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(tx.date)) {
      errors.push(`Transaction ${i}: Invalid date format`);
    }

    if (!tx.description || tx.description.trim().length === 0) {
      errors.push(`Transaction ${i}: Description is missing`);
    }

    if (tx.amount === undefined || typeof tx.amount !== 'number') {
      errors.push(`Transaction ${i}: Amount is invalid`);
    }

    if (tx.category && typeof tx.category !== 'string') {
      warnings.push(`Transaction ${i}: Invalid category type`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
