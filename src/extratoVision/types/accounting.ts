/** Uma linha do plano de contas importado. */
export type VisionPlanoRow = {
  /** Código estruturado da conta (ex: 1, 11, 111, 11101, 1110100001) */
  codigo: string;
  /** Descrição/nome da conta */
  nome: string;
  /** Código reduzido: número sequencial do plano (ex: 0000001) */
  codigoReduzido?: string;
  /** S = Sintética (agrupadora), A = Analítica (lançamentos) */
  tipo?: 'S' | 'A';
  /** Nível hierárquico (1 = raiz, 2, 3, 4, 5 = detalhe) */
  nivel?: number;
};

/** Uma linha do balancete / razão importado. */
export type VisionBalanceteRow = {
  codigo: string;
  classificacao?: string;
  nome: string;
  /** Data do lançamento no razão (DD/MM/AAAA) */
  data?: string;
  /** Sequência do lançamento no arquivo (ordem Domínio: data → sequencial). */
  ordem?: number;
  saldoInicial: number;
  debito: number;
  credito: number;
  saldoFinal: number;
  /** Indicador D/C do saldo final (Domínio/OCR) */
  naturezaSaldoFinal?: 'D' | 'C';
  /** Indicador D/C do saldo inicial */
  naturezaSaldoInicial?: 'D' | 'C';
  tipo?: 'S' | 'A';
  nivel?: number;
  isReconciliation?: boolean;
  importId?: string;
  id?: string;
  historico?: string;
  /** Conta de débito (para partida dobrada com débito e crédito no mesmo lançamento) */
  contaDeb?: string;
  /** Conta de crédito (para partida dobrada com débito e crédito no mesmo lançamento) */
  contaCred?: string;
  /** Marca se a conta está fora do plano de contas (órfã) — pede sincronização */
  isOrfa?: boolean;
};

/**
 * Representa uma transação de partida dobrada UNIFICADA — agrupa as duas pernas
 * (débito e crédito) de um mesmo lançamento contábil em um único objeto.
 * Usado como estrutura intermediária entre importação e validação/exportação
 * para garantir que nenhuma perna seja tratada como lançamento isolado.
 */
export type PartidaUnificada = {
  id: string;
  data: string;
  ordem?: number;
  historico: string;
  contaDebito: string;
  contaCredito: string;
  valor: number;
  importId?: string;
  /** Linhas originais que formam esta partida (1 ou 2 pernas) */
  pernas: VisionBalanceteRow[];
};
