import { describe, it, expect } from 'vitest';
import { contaTemRazaoInvertido } from '../RazaoContaLancamentosModal';
import type { VisionBalanceteRow, VisionPlanoRow } from '../../types/accounting';

/**
 * Falso positivo de "Contas com razão invertido": o filtro do Balancete usava
 * entradas próprias (razão desde o início dos tempos, abertura recalculada,
 * lançamento sem data caindo dentro do período) e acusava conta cujo Razão
 * fecha e caminha sempre do lado certo. Agora o filtro e o modal partem
 * exatamente dos mesmos lançamentos, natureza e saldo anterior.
 */

const CLS = '2.1.1.01.00002';
const DE = '01/07/2026';
const ATE = '31/07/2026';

function lanc(
  nome: string,
  data: string,
  debito: number,
  credito: number,
): VisionBalanceteRow {
  return {
    codigo: '1101',
    classificacao: CLS,
    nome,
    data,
    saldoInicial: 0,
    debito,
    credito,
    saldoFinal: 0,
  } as VisionBalanceteRow;
}

const plano: VisionPlanoRow[] = [
  { codigo: CLS, codigoReduzido: '1101', nome: 'REPASSES - PLANO DE SAUDE', tipo: 'A' },
];

const conta = {
  codigo: '1101',
  classificacao: CLS,
  nome: 'REPASSES - PLANO DE SAÚDE',
  tipo: 'A' as const,
};

const PIX = [350, 750, 500, 500, 900, 2588, 500, 190, 4088, 102];
const REPASSE = 467881.04;

/** Repasse creditado no dia 1 e pagamentos debitados até fechar em zero. */
function razaoRepasses(dataPagamentos: string): VisionBalanceteRow[] {
  const resto = REPASSE - PIX.reduce((a, b) => a + b, 0);
  return [
    lanc('VALOR REF REPASSE', '01/07/2026', 0, REPASSE),
    ...PIX.map((d, i) => lanc(`PAGAMENTO PIX ${i}`, dataPagamentos, d, 0)),
    lanc('PAGAMENTO PIX FINAL', dataPagamentos, resto, 0),
  ];
}

describe('REPASSES - PLANO DE SAÚDE não pode aparecer como razão invertido', () => {
  it('crédito e pagamentos no mesmo dia, fechando em zero', () => {
    expect(contaTemRazaoInvertido(conta, razaoRepasses('01/07/2026'), DE, ATE, plano)).toBe(false);
  });

  it('pagamentos em dia posterior ao crédito', () => {
    expect(contaTemRazaoInvertido(conta, razaoRepasses('15/07/2026'), DE, ATE, plano)).toBe(false);
  });

  it('lançamento sem data não pode ser contado como movimento do período', () => {
    // O Razão do período nunca exibe uma linha sem data — o filtro do Balancete
    // a somava e o débito órfão derrubava a conta credora para o lado devedor.
    const razao = [...razaoRepasses('01/07/2026'), lanc('LINHA SEM DATA', '', 90000, 0)];
    expect(contaTemRazaoInvertido(conta, razao, DE, ATE, plano)).toBe(false);
  });

  it('ainda acusa inversão real — pagamento antes do repasse entrar', () => {
    const razao: VisionBalanceteRow[] = [
      lanc('PAGAMENTO PIX ADIANTADO', '01/07/2026', REPASSE, 0),
      lanc('VALOR REF REPASSE', '20/07/2026', 0, REPASSE),
    ];
    expect(contaTemRazaoInvertido(conta, razao, DE, ATE, plano)).toBe(true);
  });
});
