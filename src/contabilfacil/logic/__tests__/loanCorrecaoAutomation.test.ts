import { describe, it, expect } from 'vitest';
import type { VisionBalanceteRow, VisionPlanoRow } from '../../../extratoVision/types/accounting';
import type { SavedContract } from '../../../lib/savedContractStorage';
import { aplicarCorrecaoEmprestimo, analisarContasEmprestimo } from '../loanCorrecaoAutomation';

function makeContrato(): SavedContract {
  return {
    id: 'c1',
    companyName: 'EMPRESA TESTE',
    contractNumber: 'CT-1',
    createdAt: new Date().toISOString(),
    formState: {
      calculationMode: 'parcel',
      parcelTab: {
        accEmprestimoDebit: '100', // ATIVO (Bancos) — fica FORA do saldo devedor
        accEmprestimoCredit: '200', // PASSIVO — entra no saldo devedor
        accTransferenciaDebit: '',
        accTransferenciaCredit: '',
        accJurosAproDebit: '300',
        accJurosAproCredit: '400',
        accApropriacaoDebit: '300',
        accApropriacaoCredit: '400',
      } as any,
    } as any,
  };
}

// Grupo 1 = ATIVO, Grupo 2 = PASSIVO (primeiro dígito da classificação)
const plano: VisionPlanoRow[] = [
  { codigo: '1.01.01', nome: 'BANCOS CONTA MOVIMENTO', codigoReduzido: '100' },
  { codigo: '2.01.01', nome: 'EMPRESTIMOS A PAGAR LP', codigoReduzido: '200' },
  { codigo: '2.01.02', nome: 'JUROS A PAGAR', codigoReduzido: '400' },
  { codigo: '9.01.01', nome: 'CORRECAO MONETARIA', codigoReduzido: '900' },
  { codigo: '9.01.02', nome: 'ESTORNO CREDITO', codigoReduzido: '910' },
];

function row(partial: Partial<VisionBalanceteRow>): VisionBalanceteRow {
  return {
    codigo: '',
    nome: '',
    saldoInicial: 0,
    debito: 0,
    credito: 0,
    saldoFinal: 0,
    ...partial,
  };
}

describe('analisarContasEmprestimo', () => {
  it('classifica accEmprestimoDebit (ATIVO) fora do saldo devedor e accEmprestimoCredit (PASSIVO) dentro', () => {
    const razaoBase: VisionBalanceteRow[] = [
      row({ codigo: '100', nome: 'EMPRESTIMO-AUTO|c1|1|VALOR DO EMPRESTIMO', debito: 1000, ordem: 1 }),
      row({ codigo: '200', nome: 'EMPRESTIMO-AUTO|c1|1|VALOR DO EMPRESTIMO', credito: 1000, ordem: 2 }),
    ];
    const contas = analisarContasEmprestimo(razaoBase, makeContrato(), plano);
    const debit = contas.find((c) => c.campo === 'accEmprestimoDebit')!;
    const credit = contas.find((c) => c.campo === 'accEmprestimoCredit')!;

    expect(debit.grupo).toBe('ATIVO');
    expect(debit.incluidoNoSaldoDevedor).toBe(false);
    expect(credit.grupo).toBe('PASSIVO');
    expect(credit.incluidoNoSaldoDevedor).toBe(true);
    expect(credit.saldoFinal).toBe(1000);
  });
});

describe('aplicarCorrecaoEmprestimo', () => {
  it('gera correção monetária quando o banco pagou mais que a tabela (sem reduzir juros)', () => {
    const razaoBase: VisionBalanceteRow[] = [
      row({ codigo: '100', nome: 'EMPRESTIMO-AUTO|c1|1|VALOR DO EMPRESTIMO', debito: 1000, ordem: 1 }),
      row({ codigo: '200', nome: 'EMPRESTIMO-AUTO|c1|1|VALOR DO EMPRESTIMO', credito: 1000, ordem: 2 }),
      // Banco pagou uma amortização de 50 direto na conta 200 (fora da automação)
      row({ codigo: '200', nome: 'PAGAMENTO BANCO', debito: 50, ordem: 3 }),
    ];

    // Tabela (aba Empréstimos) diz que hoje o saldo devedor deveria ser 950.
    const result = aplicarCorrecaoEmprestimo(
      razaoBase,
      makeContrato(),
      plano,
      { contaCorrecaoMonetaria: '900', aplicarReducaoJuros: false } as any,
      950,
    );

    expect(result.resumo?.saldoTabela).toBe(950);
    expect(result.resumo?.saldoAtual).toBe(950); // 1000 credito - 50 debito = 950
    expect(result.resumo?.diferenca).toBe(0);
    expect(result.lancamentosGerados).toBe(0);
  });

  it('detecta drift real do banco (tabela diz 900, razão real ficou em 950) e corrige', () => {
    const razaoBase: VisionBalanceteRow[] = [
      row({ codigo: '100', nome: 'EMPRESTIMO-AUTO|c1|1|VALOR DO EMPRESTIMO', debito: 1000, ordem: 1 }),
      row({ codigo: '200', nome: 'EMPRESTIMO-AUTO|c1|1|VALOR DO EMPRESTIMO', credito: 1000, ordem: 2 }),
      // Banco só pagou 50 mas a tabela esperava que já tivesse pago 100 até hoje.
      row({ codigo: '200', nome: 'PAGAMENTO BANCO', debito: 50, ordem: 3 }),
    ];

    const result = aplicarCorrecaoEmprestimo(
      razaoBase,
      makeContrato(),
      plano,
      { contaCorrecaoMonetaria: '900' },
      900, // tabela espera saldo devedor de 900 hoje
    );

    expect(result.resumo?.saldoAtual).toBe(950);
    expect(result.resumo?.diferenca).toBe(50); // passivo real MAIOR que a tabela
    expect(result.lancamentosGerados).toBe(1);

    const novas = result.novaRazao!.filter((r) => r.nome.startsWith('EMPRESTIMO-CORRECAO|'));
    expect(novas).toHaveLength(2);
    const d = novas.find((r) => (r.debito ?? 0) > 0)!;
    const c = novas.find((r) => (r.credito ?? 0) > 0)!;
    // diferenca > 0 → debita o passivo (reduz), credita a contrapartida.
    expect(d.codigo).toBe('200');
    expect(d.debito).toBe(50);
    expect(c.codigo).toBe('900');
    expect(c.credito).toBe(50);
  });

  it('é idempotente — reaplicar não acumula ajuste', () => {
    const razaoBase: VisionBalanceteRow[] = [
      row({ codigo: '100', nome: 'EMPRESTIMO-AUTO|c1|1|VALOR DO EMPRESTIMO', debito: 1000, ordem: 1 }),
      row({ codigo: '200', nome: 'EMPRESTIMO-AUTO|c1|1|VALOR DO EMPRESTIMO', credito: 1000, ordem: 2 }),
      row({ codigo: '200', nome: 'PAGAMENTO BANCO', debito: 50, ordem: 3 }),
    ];

    const first = aplicarCorrecaoEmprestimo(razaoBase, makeContrato(), plano, { contaCorrecaoMonetaria: '900' }, 900);
    expect(first.novaRazao).toBeDefined();

    const second = aplicarCorrecaoEmprestimo(
      first.novaRazao!,
      makeContrato(),
      plano,
      { contaCorrecaoMonetaria: '900' },
      900,
    );

    expect(second.resumo?.diferenca).toBe(50);
    expect(second.lancamentosGerados).toBe(1);
    const novas = second.novaRazao!.filter((r) => r.nome.startsWith('EMPRESTIMO-CORRECAO|'));
    expect(novas).toHaveLength(2); // não duplicou
  });

  it('reduz juros quando parcela do banco > tabela e sobra vira correção monetária', () => {
    const razaoBase: VisionBalanceteRow[] = [
      row({ codigo: '100', nome: 'EMPRESTIMO-AUTO|c1|1|VALOR DO EMPRESTIMO', debito: 1000, ordem: 1 }),
      row({ codigo: '200', nome: 'EMPRESTIMO-AUTO|c1|1|VALOR DO EMPRESTIMO', credito: 1000, ordem: 2 }),
      row({ codigo: '300', nome: 'EMPRESTIMO-AUTO|c1|5|APROPRIACAO DE JUROS', debito: 20, ordem: 3 }),
      row({ codigo: '400', nome: 'EMPRESTIMO-AUTO|c1|5|APROPRIACAO DE JUROS', credito: 20, ordem: 4 }),
      // Banco pagou 30 a mais que a tabela esperava (tabela=1000, banco pagou levando a 970)
      row({ codigo: '200', nome: 'PAGAMENTO BANCO', debito: 30, ordem: 5 }),
    ];

    const result = aplicarCorrecaoEmprestimo(
      razaoBase,
      makeContrato(),
      plano,
      { contaCorrecaoMonetaria: '900', aplicarReducaoJuros: true } as any,
      1000,
    );

    expect(result.resumo?.diferenca).toBe(-30);
    expect(result.lancamentosGerados).toBe(2);

    const estorno = result.novaRazao!.filter((r) => r.nome.startsWith('EMPRESTIMO-ESTORNO-JUROS|'));
    expect(estorno).toHaveLength(2);
    const estD = estorno.find((r) => (r.debito ?? 0) > 0)!;
    const estC = estorno.find((r) => (r.credito ?? 0) > 0)!;
    // Reverte as duas pontas do lançamento original (D=300/C=400), sem conta extra.
    expect(estD.codigo).toBe('400');
    expect(estD.debito).toBe(20); // limitado ao juros disponível (20 < 30)
    expect(estC.codigo).toBe('300');

    const correcao = result.novaRazao!.filter((r) => r.nome.startsWith('EMPRESTIMO-CORRECAO|'));
    expect(correcao).toHaveLength(2);
    const corD = correcao.find((r) => (r.debito ?? 0) > 0)!;
    expect(corD.codigo).toBe('900');
    expect(corD.debito).toBe(10); // resto: 30 - 20 = 10
  });

  it('não gera nada quando já bate', () => {
    const razaoBase: VisionBalanceteRow[] = [
      row({ codigo: '100', nome: 'EMPRESTIMO-AUTO|c1|1|VALOR DO EMPRESTIMO', debito: 1000, ordem: 1 }),
      row({ codigo: '200', nome: 'EMPRESTIMO-AUTO|c1|1|VALOR DO EMPRESTIMO', credito: 1000, ordem: 2 }),
    ];

    const result = aplicarCorrecaoEmprestimo(razaoBase, makeContrato(), plano, { contaCorrecaoMonetaria: '900' }, 1000);

    expect(result.resumo?.diferenca).toBe(0);
    expect(result.lancamentosGerados).toBe(0);
  });

  it('bloqueia quando não há saldo em cache', () => {
    const result = aplicarCorrecaoEmprestimo(
      [],
      makeContrato(),
      plano,
      { contaCorrecaoMonetaria: '900' },
      null,
    );
    expect(result.ok).toBe(false);
    expect(result.lancamentosGerados).toBe(0);
  });
});
