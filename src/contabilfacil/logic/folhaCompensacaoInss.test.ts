import { describe, expect, it } from 'vitest';
import { buildFolhaPartidas, buildFolhaTotaisPorConta } from './folhaToRazao';
import type { FolhaRegra } from './folhaContasAutomacaoStorage';
import { getFolhaDestino } from './folhaRubricaTaxonomia';

/**
 * Competência 02/2026 da Obras Sociais. Na Apuração de Tributos Federais dessa competência:
 *
 *   INSS Segurados Folha ... valor 1.982,22 − salário-família 540,32 = 1.441,90 a recolher
 *
 * O salário-família é adiantado ao empregado e abatido da guia. Contabilmente são DOIS
 * lançamentos, e é o segundo que zera a conta de INSS a recuperar.
 */
const COMPETENCIA = '28/02/2026';

const INSS_A_COMPENSAR = '38';
const SALARIOS_A_PAGAR = '187';
const INSS_A_RECOLHER = '191';
const DESPESA_SALARIOS = '298';

const REGRA_SALARIO_FAMILIA: FolhaRegra = {
  id: 'r-benef',
  descricao: 'Salário-família e maternidade',
  contaDebito: INSS_A_COMPENSAR,
  contaCredito: SALARIOS_A_PAGAR,
  destino: 'BENEFICIO_INSS',
};

const REGRA_INSS_RETIDO: FolhaRegra = {
  id: 'r-inss',
  descricao: 'INSS retido',
  contaDebito: SALARIOS_A_PAGAR,
  contaCredito: INSS_A_RECOLHER,
  destino: 'INSS_RETIDO',
};

const REGRA_REMUNERACAO: FolhaRegra = {
  id: 'r-rem',
  descricao: 'Salários e remuneração',
  contaDebito: DESPESA_SALARIOS,
  contaCredito: SALARIOS_A_PAGAR,
  destino: 'REMUNERACAO',
};

const LINHAS = [
  { id: 'a', date: COMPETENCIA, description: '995 - SALARIO FAMILIA .', debito: 0, credito: 540.32, tipo: 'PROVENTOS' as const },
  { id: 'b', date: COMPETENCIA, description: '998 - I.N.S.S.', debito: 1982.22, credito: 0, tipo: 'DESCONTOS' as const },
  { id: 'c', date: COMPETENCIA, description: '8781 - SALARIO EMPREGADO 2', debito: 0, credito: 6484.0, tipo: 'PROVENTOS' as const },
];

const TODAS = [REGRA_SALARIO_FAMILIA, REGRA_INSS_RETIDO, REGRA_REMUNERACAO];
const totais = (regras: FolhaRegra[]) =>
  buildFolhaTotaisPorConta(buildFolhaPartidas(LINHAS, regras), (c) => c);

describe('salário-família — compensação automática contra o INSS a recolher', () => {
  it('o destino declara com quem se compensa', () => {
    expect(getFolhaDestino('BENEFICIO_INSS')?.compensaAutomaticamenteCom).toBe('INSS_RETIDO');
    // Os demais destinos não geram lançamento extra
    expect(getFolhaDestino('REMUNERACAO')?.compensaAutomaticamenteCom).toBeUndefined();
    expect(getFolhaDestino('INSS_RETIDO')?.compensaAutomaticamenteCom).toBeUndefined();
  });

  it('gera DOIS lançamentos para o salário-família: o pagamento e a compensação', () => {
    const partidas = buildFolhaPartidas(LINHAS, TODAS).filter((p) =>
      p.nome.includes('SALARIO FAMILIA'),
    );

    // 2 lançamentos × 2 pernas
    expect(partidas).toHaveLength(4);
    expect(partidas.filter((p) => p.nome.endsWith('· COMPENSACAO'))).toHaveLength(2);
  });

  it('a compensação zera a conta de INSS a compensar', () => {
    const conta = totais(TODAS).find((t) => t.conta === INSS_A_COMPENSAR);

    // Debitada no pagamento, creditada na compensação — pelo mesmo valor
    expect(conta?.debito).toBeCloseTo(540.32, 2);
    expect(conta?.credito).toBeCloseTo(540.32, 2);
    expect(conta?.saldo).toBeCloseTo(0, 2);
  });

  it('o INSS a recolher fica com o valor líquido da Apuração de Tributos', () => {
    const conta = totais(TODAS).find((t) => t.conta === INSS_A_RECOLHER);

    // 1.982,22 retido − 540,32 de salário-família = 1.441,90, o "Saldo a recolher" do relatório
    expect(conta?.credito).toBeCloseTo(1982.22, 2);
    expect(conta?.debito).toBeCloseTo(540.32, 2);
    expect(-(conta!.saldo)).toBeCloseTo(1441.9, 2);
  });

  it('o empregado continua recebendo o salário-família integral', () => {
    const conta = totais(TODAS).find((t) => t.conta === SALARIOS_A_PAGAR);
    // A compensação não passa por salários a pagar: 540,32 + 6.484,00 a crédito, INSS a débito
    expect(conta?.credito).toBeCloseTo(540.32 + 6484.0, 2);
    expect(conta?.debito).toBeCloseTo(1982.22, 2);
  });

  it('continua fechando em partida dobrada', () => {
    const lista = totais(TODAS);
    const d = lista.reduce((s, t) => s + t.debito, 0);
    const c = lista.reduce((s, t) => s + t.credito, 0);
    expect(d).toBeCloseTo(c, 2);
  });

  it('sem a regra de INSS retido, não inventa conta — a pendência fica visível no saldo', () => {
    const semInss = [REGRA_SALARIO_FAMILIA, REGRA_REMUNERACAO];
    const conta = totais(semInss).find((t) => t.conta === INSS_A_COMPENSAR);

    expect(conta?.debito).toBeCloseTo(540.32, 2);
    expect(conta?.credito).toBeCloseTo(0, 2);
    expect(conta?.saldo).toBeCloseTo(540.32, 2);
  });

  it('rubrica sem compensação declarada não ganha lançamento extra', () => {
    const partidas = buildFolhaPartidas(LINHAS, TODAS).filter((p) =>
      p.nome.includes('SALARIO EMPREGADO'),
    );
    expect(partidas).toHaveLength(2);
    expect(partidas.some((p) => p.nome.includes('COMPENSACAO'))).toBe(false);
  });
});
