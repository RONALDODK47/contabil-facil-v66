export interface BankTransaction {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number;
  balance: number | null;
  category: string;
}

export interface BankStatementMetadata {
  bank_name: string;
  account_number: string;
  period: string; // MM/YYYY
}

export interface BankStatementJSON {
  transactions: BankTransaction[];
  metadata: BankStatementMetadata;
}

export interface ExtratoLine {
  date?: string;
  description?: string;
  amount?: number;
  balance?: number;
  raw: string;
}
