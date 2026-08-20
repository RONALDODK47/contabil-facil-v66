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
  /**
   * Problemas não-fatais encontrados na leitura (ex.: páginas escaneadas sem
   * camada de texto). A conversão sempre entrega o que conseguiu ler — estes
   * avisos existem para o usuário saber que o resultado pode estar incompleto.
   */
  warnings?: string[];
}

export interface ExtratoLine {
  date?: string;
  description?: string;
  amount?: number;
  balance?: number;
  raw: string;
}
