import { describe, it, expect } from 'vitest';
import { contaTemRazaoInvertido } from '../RazaoContaLancamentosModal';
import type { VisionBalanceteRow, VisionPlanoRow } from '../../types/accounting';

/**
 * Falso positivo de "razão invertido" no Balancete.
 *
 * O saldo anterior do razão vem numa linha marcadora ("SALDO ANTERIOR"), que
 * guarda o valor em `saldoInicial`/`naturezaSaldoInicial` — débito e crédito
 * ficam zerados. O filtro acumulava só `debito - credito`, então a abertura
 * sumia e qualquer crédito normal numa conta devedora derrubava o acumulado
 * para negativo, acusando inversão numa conta que nunca inverteu.
 */

const DE = '01/04/2026';
const ATE = '30/04/2026';

function saldoAnterior(
  codigo: string,
  classificacao: string,
  nome: string,
  valor: number,
  natureza: 'D' | 'C',
): VisionBalanceteRow {
  return {
    codigo,
    classificacao,
    nome: 'SALDO INICIAL',
    data: '31/03/2026',
    saldoInicial: valor,
    naturezaSaldoInicial: natureza,
    debito: 0,
    credito: 0,
    saldoFinal: 0,
  } as VisionBalanceteRow;
}

function lancamento(
  codigo: string,
  classificacao: string,
  nome: string,
  data: string,
  debito: number,
  credito: number,
): VisionBalanceteRow {
  return {
    codigo,
    classificacao,
    nome,
    data,
    saldoInicial: 0,
    debito,
    credito,
    saldoFinal: 0,
  } as VisionBalanceteRow;
}

// No plano, `codigo` é a classificação estruturada; o reduzido vai em `codigoReduzido`.
const plano: VisionPlanoRow[] = [
  { codigo: '1.1.1.01.00001', codigoReduzido: '5', nome: 'CAIXA GERAL', tipo: 'A' },
  { codigo: '1.1.2.01.00001', codigoReduzido: '1000', nome: 'CLIENTES DIVERSOS', tipo: 'A' },
  { codigo: '2.1.2.01.00015', codigoReduzido: '479', nome: 'SIMPLES NACIONAL A RECOLHER', tipo: 'A' },
];

describe('contaTemRazaoInvertido — não pode dar falso positivo', () => {
  it('conta devedora que só tem saldo anterior + movimento normal não é invertida', () => {
    // CAIXA GERAL: SI 24.540,30 D · D 1.000,00 · C 4.000,00 · SF 21.540,30 D
    // Nunca fica credora. O crédito de 4.000 só derrubava o saldo pra negativo
    // porque a abertura de 24.540,30 estava sendo ignorada.
    const cls = '1.1.1.01.00001';
    const razao: VisionBalanceteRow[] = [
      saldoAnterior('5', cls, 'CAIXA GERAL', 24540.3, 'D'),
      lancamento('5', cls, 'PAGAMENTO FORNECEDOR', '10/04/2026', 0, 4000),
      lancamento('5', cls, 'RECEBIMENTO', '20/04/2026', 1000, 0),
    ];

    const conta = { codigo: '5', classificacao: cls, nome: 'CAIXA GERAL', tipo: 'A' as const };

    expect(contaTemRazaoInvertido(conta, razao, DE, ATE, plano)).toBe(false);
  });

  it('conta devedora cujo crédito do mês é maior que o débito, mas coberto pela abertura', () => {
    // CLIENTES DIVERSOS: SI 27.828,36 D · D 18.820,00 · C 38.380,80 · SF 8.267,56 D
    // O crédito (38.380,80) é maior que o débito do mês (18.820,00), mas a
    // abertura de 27.828,36 D segura o saldo no lado devedor o tempo todo.
    const cls = '1.1.2.01.00001';
    const razao: VisionBalanceteRow[] = [
      saldoAnterior('1000', cls, 'CLIENTES DIVERSOS', 27828.36, 'D'),
      lancamento('1000', cls, 'FATURAMENTO', '05/04/2026', 18820, 0),
      lancamento('1000', cls, 'BAIXA TITULOS', '25/04/2026', 0, 38380.8),
    ];

    const conta = { codigo: '1000', classificacao: cls, nome: 'CLIENTES DIVERSOS', tipo: 'A' as const };

    expect(contaTemRazaoInvertido(conta, razao, DE, ATE, plano)).toBe(false);
  });

  it('conta credora que só tem saldo anterior + movimento normal não é invertida', () => {
    // SIMPLES NACIONAL A RECOLHER: SI 2.543,82 C · D 2.543,82 · C 1.371,69 · SF 1.371,69 C
    const cls = '2.1.2.01.00015';
    const razao: VisionBalanceteRow[] = [
      saldoAnterior('479', cls, 'SIMPLES NACIONAL A RECOLHER', 2543.82, 'C'),
      lancamento('479', cls, 'PAGAMENTO DAS', '15/04/2026', 2543.82, 0),
      lancamento('479', cls, 'PROVISAO DAS', '30/04/2026', 0, 1371.69),
    ];

    const conta = {
      codigo: '479',
      classificacao: cls,
      nome: 'SIMPLES NACIONAL A RECOLHER',
      tipo: 'A' as const,
    };

    expect(contaTemRazaoInvertido(conta, razao, DE, ATE, plano)).toBe(false);
  });

  it('acusa inversão real transitória — crédito que passa da abertura antes do débito entrar', () => {
    // Mesmos totais do mês do caso CLIENTES, mas com a baixa ANTES do
    // faturamento: aí a conta fica mesmo credora entre 05/04 e 25/04.
    const cls = '1.1.2.01.00001';
    const razao: VisionBalanceteRow[] = [
      saldoAnterior('1000', cls, 'CLIENTES DIVERSOS', 27828.36, 'D'),
      lancamento('1000', cls, 'BAIXA TITULOS', '05/04/2026', 0, 38380.8),
      lancamento('1000', cls, 'FATURAMENTO', '25/04/2026', 18820, 0),
    ];

    const conta = { codigo: '1000', classificacao: cls, nome: 'CLIENTES DIVERSOS', tipo: 'A' as const };

    expect(contaTemRazaoInvertido(conta, razao, DE, ATE, plano)).toBe(true);
  });

  it('ainda acusa inversão de verdade — crédito que estoura a abertura de conta devedora', () => {
    const cls = '1.1.1.01.00001';
    const razao: VisionBalanceteRow[] = [
      saldoAnterior('5', cls, 'CAIXA GERAL', 1000, 'D'),
      lancamento('5', cls, 'PAGAMENTO ALEM DO SALDO', '10/04/2026', 0, 9000),
    ];

    const conta = { codigo: '5', classificacao: cls, nome: 'CAIXA GERAL', tipo: 'A' as const };

    expect(contaTemRazaoInvertido(conta, razao, DE, ATE, plano)).toBe(true);
  });

  it('sem linha de saldo anterior, conta devedora que fica credora continua sendo acusada', () => {
    const cls = '1.1.1.01.00001';
    const razao: VisionBalanceteRow[] = [
      lancamento('5', cls, 'PAGAMENTO SEM SALDO', '10/04/2026', 0, 500),
    ];

    const conta = { codigo: '5', classificacao: cls, nome: 'CAIXA GERAL', tipo: 'A' as const };

    expect(contaTemRazaoInvertido(conta, razao, DE, ATE, plano)).toBe(true);
  });
});
