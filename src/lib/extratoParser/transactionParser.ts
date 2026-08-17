import { ExtratoLine, BankStatementMetadata } from './types';
import { classifyTransaction } from './categoryClassifier';

export function parseTransactionsFromText(
  text: string
): {
  transactions: ExtratoLine[];
  metadata: BankStatementMetadata | null;
} {
  const lines = text.split('\n').map((line) => line.trim());

  let metadata: BankStatementMetadata | null = null;
  const transactions: ExtratoLine[] = [];

  // Extract metadata (bank name, account, period)
  metadata = extractMetadata(text);

  // Parse transactions
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!line) continue;

    const transaction = parseTransactionLine(line, lines, i);
    if (transaction) {
      transactions.push(transaction);
    }
  }

  return { transactions, metadata };
}

function extractMetadata(text: string): BankStatementMetadata | null {
  // Extract bank name
  const bankRegex =
    /([A-Z][A-Za-z\s]+(?:BANCO|BANK|CAIXA|BRADESCO|ITAÚ|SANTANDER|SICREDI|CREFISA)[A-Za-z\s]*)/i;
  const bankMatch = text.match(bankRegex);
  const bankName = bankMatch ? bankMatch[1].trim() : 'Banco';

  // Extract account number.
  // A forma com dígito verificador vem primeiro e aceita conta de tamanho
  // variável: com `\d{6}-\d` fixo, uma conta de 9 dígitos como 000099198-8
  // casava só o trecho sem o dígito, e a conta saía truncada.
  const accountRegex = /(\d{3}\.\d{3}\.\d{3}-\d|\d{4,12}-\d|(\d{3})(\d{4,6})(\d))/;
  const accountMatch = text.match(accountRegex);
  const accountNumber = accountMatch ? accountMatch[0] : '000000-0';

  // Extract period (MM/YYYY or YYYY-MM)
  const periodRegex = /(0[1-9]|1[0-2])\/\d{4}|(0[1-9]|1[0-2])[-\/]\d{4}/;
  const periodMatch = text.match(periodRegex);
  const period = periodMatch ? periodMatch[0] : '01/2026';

  return {
    bank_name: bankName,
    account_number: accountNumber,
    period: period,
  };
}

function parseTransactionLine(
  line: string,
  allLines: string[],
  currentIndex: number
): ExtratoLine | null {
  // Date pattern: DD/MM or YYYY-MM-DD
  const datePattern = /(\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2})/;

  // Check if line contains a date
  if (!datePattern.test(line)) {
    return null;
  }

  const parts = line.split(/\s+/);
  let date: string | undefined;
  let remainingParts: string[] = [];

  // Extract date
  let dateStr: string | undefined;
  for (let i = 0; i < parts.length; i++) {
    const dateMatch = parts[i].match(datePattern);
    if (dateMatch) {
      dateStr = parts[i];
      remainingParts = [...parts.slice(0, i), ...parts.slice(i + 1)];
      break;
    }
  }

  if (!dateStr) {
    return null;
  }

  // Convert DD/MM to YYYY-MM-DD (assuming current year)
  date = normalizeDateFormat(dateStr);

  // Extract amount and balance from the line
  const amountRegex = /-?[\d.,]+/g;
  const amounts = line.match(amountRegex) || [];

  // The first amount is usually the transaction amount
  const firstAmount = amounts[0];
  if (firstAmount === undefined) {
    return null;
  }
  const amount = parseAmount(firstAmount);

  // The last amount is usually the balance (if present)
  let balance: number | undefined;
  const lastAmount = amounts[amounts.length - 1];
  if (amounts.length > 1 && lastAmount !== undefined && lastAmount !== firstAmount) {
    balance = parseAmount(lastAmount);
  }

  // Description is everything except date and amounts
  let description = line;
  description = description.replace(dateStr, '');
  for (const amount of amounts) {
    description = description.replace(amount, '');
  }
  description = description
    .trim()
    .replace(/\s+/g, ' ')
    .substring(0, 100);

  if (!description) {
    return null;
  }

  return {
    date,
    description,
    amount,
    balance,
    raw: line,
  };
}

function normalizeDateFormat(dateStr: string): string {
  // If already in YYYY-MM-DD format, return as is
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  // Convert DD/MM or DD-MM to YYYY-MM-DD
  // Assuming current year
  if (/^\d{1,2}[/-]\d{1,2}$/.test(dateStr)) {
    const [day, month] = dateStr.split(/[/-]/);
    const year = new Date().getFullYear();
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // If MM/YYYY format, convert to last day of month
  const mmYyyyMatch = dateStr.match(/(\d{2})\/(\d{4})/);
  if (mmYyyyMatch) {
    const month = mmYyyyMatch[1];
    const year = mmYyyyMatch[2];
    return `${year}-${month}-01`;
  }

  return dateStr;
}

function parseAmount(amountStr: string): number {
  // Remove spaces
  let cleaned = amountStr.replace(/\s/g, '');

  // Handle both comma and dot as decimal separator
  // Assuming Brazilian format: 1.234,56 (dot for thousands, comma for decimal)
  if (cleaned.includes(',')) {
    // Remove dots used for thousands separator
    cleaned = cleaned.replace(/\./g, '');
    // Replace comma with dot for parseFloat
    cleaned = cleaned.replace(',', '.');
  } else if (cleaned.includes('.')) {
    // If only dots are present, check if it's a thousands separator
    const lastDotIndex = cleaned.lastIndexOf('.');
    const afterLastDot = cleaned.substring(lastDotIndex + 1);
    if (afterLastDot.length === 2) {
      // Likely decimal point (2 digits after dot)
      cleaned = cleaned.replace(/\./g, (match, offset) => {
        return offset === lastDotIndex ? '.' : '';
      });
    } else {
      // Thousands separator
      cleaned = cleaned.replace(/\./g, '');
    }
  }

  return parseFloat(cleaned) || 0;
}

export function mergeTransactionLines(
  lines: ExtratoLine[],
  _metadata: BankStatementMetadata | null
): ExtratoLine[] {
  // Desativado para evitar que transações legítimas distintas ocorridas na mesma data
  // sejam mescladas ou descartadas.
  return lines;
}
