import { describe, expect, it } from 'vitest';
import { buildRazaoFromExtratoLancamentos, mergeExtratoRazaoComExistente } from '../extratoToRazao';
import type { ExtratoBankRow } from '../extratoConciliacaoBank';
import type { VisionBalanceteRow } from '../../../extratoVision/types/accounting';

describe('extratoToRazao', () => {
  it('permite reenviar o mesmo lançamento conciliado sem duplicar linhas', () => {
    const extrato: ExtratoBankRow[] = [
      {
        id: 'lan-1',
        date: '2026-07-10',
        description: 'Pagamento teste',
        value: 150,
        accountDebit: '1.1.1.01',
        accountCredit: '2.1.1.01',
        status: 'CONCILIADO',
      },
    ];

    const { rows: novos } = buildRazaoFromExtratoLancamentos(extrato);
    const primeiraGravacao = mergeExtratoRazaoComExistente([], novos);
    const segundaGravacao = mergeExtratoRazaoComExistente(primeiraGravacao, novos);

    expect(primeiraGravacao).toHaveLength(2);
    expect(segundaGravacao).toHaveLength(2);
    expect(segundaGravacao.map((row) => row.importId)).toEqual(['extrato-conc:lan-1', 'extrato-conc:lan-1']);
  });

  it('remove TODOS os lançamentos antigos das contas afetadas', () => {
    const extrato: ExtratoBankRow[] = [
      {
        id: 'lan-1',
        date: '2026-07-10',
        description: 'Novo pagamento',
        value: 200,
        accountDebit: '1084', // Fornecedores
        accountCredit: '1000', // Caixa
        status: 'CONCILIADO',
      },
    ];

    // Simula lançamentos antigos que estão no balancete
    const antigos: VisionBalanceteRow[] = [
      {
        codigo: '1084',
        nome: 'COMISSAO EXTRA',
        data: '10/07/2026',
        debito: 150,
        credito: 0,
        saldoInicial: 0,
        saldoFinal: 0,
        ordem: 1,
      },
      {
        codigo: '1000',
        nome: 'COMISSAO EXTRA',
        data: '10/07/2026',
        debito: 0,
        credito: 150,
        saldoInicial: 0,
        saldoFinal: 0,
        ordem: 1,
      },
    ];

    const { rows: novos } = buildRazaoFromExtratoLancamentos(extrato);
    const resultado = mergeExtratoRazaoComExistente(antigos, novos);

    // Deve ter apenas os 2 novos lançamentos (os antigos foram removidos completamente)
    expect(resultado).toHaveLength(2);
    expect(resultado.every((r) => r.nome === 'NOVO PAGAMENTO')).toBe(true);
  });
});

