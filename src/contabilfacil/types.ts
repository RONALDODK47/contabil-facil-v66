export type ActiveTab = 'manager' | 'admin' | 'ferramentas';

export interface MonthlyAdjustment {
  unpaid?: boolean;
  paid?: boolean;
  extraPayment?: number;
  paymentAmount?: number;
  prepaymentAmount?: number;
  interestAdjustment?: number;
}

export type MonthlyAdjustments = Record<number, MonthlyAdjustment>;

export interface LoanContract {
  id: string;
  companyName: string;
  contractNumber: string;
  /** Instituição financeira (ex.: Banco do Brasil). */
  bankName: string;
  type: 'SAC' | 'PRICE';
  principal: number;
  interestRate: number;
  installments: number;
  startDate: string;
  gracePeriod: number;
  graceType: 'capitalized' | 'paid';
  indexType: 'SELIC' | 'CDI' | 'FIXED' | 'NONE';
  iof: number;
  /** Financiado: soma ao saldo devedor (parcela maior). Pago: descontado do líquido, não entra no saldo. */
  iofMode: 'financed' | 'paid';
  costs: number;
  customVarRate?: number;
  monthlyAdjustments?: MonthlyAdjustments;
}

export interface CompanyApp {
  id: string;
  name: string;
  folder: string;
  startDate: string;
  amount: number;
  index: string;
  rate: number;
  numeroAplicacao?: string;
}

export interface LoanAccountFields {
  accJurosAproDebit: string;
  accJurosAproCredit: string;
  accApropriacaoDebit: string;
  accApropriacaoCredit: string;
  accTransferenciaDebit: string;
  accTransferenciaCredit: string;
  accEmprestimoDebit: string;
  accEmprestimoCredit: string;
  /** Parcela bruta não paga: reclassifica CP → LP (débito LP / crédito CP). */
  accNaoPagoDebit: string;
  accNaoPagoCredit: string;
  /** Pagamento atrasado quitado: reverte LP → CP e registra a quitação (débito CP / crédito LP). */
  accAtrasadoPagoDebit: string;
  accAtrasadoPagoCredit: string;
}
