import { describe, expect, it } from 'vitest';
import {
  agruparFolhaTotaisPorNatureza,
  naturezaDaConta,
  type FolhaTotalConta,
} from './folhaToRazao';

/**
 * Grupos do plano da Obras Sociais. Repare no 3: neste plano ele é o RESULTADO do exercício,
 * não o patrimônio líquido — a convenção genérica de "3 = PL" classificaria toda a despesa com
 * pessoal como patrimônio.
 */
const GRUPOS: Record<string, string> = {
  '1': 'ATIVO',
  '1.1': 'ATIVO CIRCULANTE',
  '2': 'PASSIVO',
  '2.1': 'PASSIVO CIRCULANTE',
  '2.3': 'PATRIMÔNIO LÍQUIDO',
  '3': 'RESULTADO LÍQUIDO DO PERÍODO ANTES DO IRPJ, CSLL E PARTICIP.',
  '3.1': 'RESULTADO BRUTO DO PERÍODO',
  '3.2': 'DESPESAS OPERACIONAIS',
  '3.3': 'RECEITAS NÃO OPERACIONAIS',
  '5': 'CONTAS DE APURAÇÃO',
  '5.1': 'CUSTOS DOS PRODUTOS E SERVIÇOS VENDIDOS',
  '6': 'CONTAS DE COMPENSAÇÃO',
};

const nomeDoGrupo = (cls: string) => GRUPOS[cls] ?? '';

function total(conta: string, classificacao: string, debito = 0, credito = 0): FolhaTotalConta {
  return { conta, nomeConta: conta, classificacao, debito, credito, saldo: debito - credito };
}

describe('naturezaDaConta', () => {
  it('classifica pelas contas reais da folha da Obras Sociais', () => {
    expect(naturezaDaConta('1.1.3.08.00010', nomeDoGrupo)).toBe('ATIVO'); // INSS a compensar
    expect(naturezaDaConta('2.1.3.01.00001', nomeDoGrupo)).toBe('PASSIVO'); // Salários a pagar
    expect(naturezaDaConta('2.1.3.02.00002', nomeDoGrupo)).toBe('PASSIVO'); // FGTS a recolher
    expect(naturezaDaConta('3.2.1.01.00001', nomeDoGrupo)).toBe('DESPESAS'); // Salários (despesa)
  });

  it('não confunde o resultado do exercício com patrimônio líquido', () => {
    // O grupo 3 é resultado neste plano; o PL está em 2.3
    expect(naturezaDaConta('3.2.1.01.00003', nomeDoGrupo)).toBe('DESPESAS');
    expect(naturezaDaConta('2.3.1.01.00001', nomeDoGrupo)).toBe('PATRIMONIO');
  });

  it('separa custos, receitas e contas de compensação', () => {
    expect(naturezaDaConta('5.1.1.01.00001', nomeDoGrupo)).toBe('CUSTOS');
    expect(naturezaDaConta('3.3.1.01.00001', nomeDoGrupo)).toBe('RECEITAS');
    expect(naturezaDaConta('6.1.1.01.00001', nomeDoGrupo)).toBe('COMPENSACAO');
  });

  it('sem classificação ou grupo desconhecido, cai em outras contas', () => {
    expect(naturezaDaConta(undefined, nomeDoGrupo)).toBe('OUTRAS');
    expect(naturezaDaConta('', nomeDoGrupo)).toBe('OUTRAS');
  });

  it('funciona por convenção quando o plano não nomeia os grupos', () => {
    const semNomes = () => '';
    expect(naturezaDaConta('1.1.1', semNomes)).toBe('ATIVO');
    expect(naturezaDaConta('2.1.1', semNomes)).toBe('PASSIVO');
    expect(naturezaDaConta('4.1.1', semNomes)).toBe('DESPESAS');
  });
});

describe('agruparFolhaTotaisPorNatureza', () => {
  const TOTAIS = [
    total('298', '3.2.1.01.00001', 170136.19),
    total('187', '2.1.3.01.00001', 19684.1, 190107.33),
    total('38', '1.1.3.08.00010', 3782.24),
    total('300', '3.2.1.01.00003', 13287.14),
    total('191', '2.1.3.02.00001', 0, 14124.59),
    total('167', '2.1.3.01.00005', 0, 2154.75),
  ];

  const secoes = agruparFolhaTotaisPorNatureza(TOTAIS, nomeDoGrupo);

  it('ordena as seções de cima para baixo: ativo, passivo, despesas', () => {
    expect(secoes.map((s) => s.titulo)).toEqual(['Ativo', 'Passivo', 'Despesas']);
  });

  it('coloca cada conta na sua seção', () => {
    expect(secoes[0]?.contas.map((c) => c.conta)).toEqual(['38']);
    expect(secoes[1]?.contas.map((c) => c.conta)).toEqual(['187', '191', '167']);
    expect(secoes[2]?.contas.map((c) => c.conta)).toEqual(['298', '300']);
  });

  it('soma o subtotal de cada seção', () => {
    expect(secoes[1]?.credito).toBeCloseTo(190107.33 + 14124.59 + 2154.75, 2);
    expect(secoes[2]?.debito).toBeCloseTo(170136.19 + 13287.14, 2);
  });

  it('não perde nenhuma conta no agrupamento', () => {
    const agrupadas = secoes.flatMap((s) => s.contas);
    expect(agrupadas).toHaveLength(TOTAIS.length);
    expect(new Set(agrupadas.map((c) => c.conta))).toEqual(new Set(TOTAIS.map((c) => c.conta)));
  });

  it('conta sem classificação não some — vai para "Outras contas"', () => {
    const comOrfa = [...TOTAIS, total('999', '', 10)];
    const comSecaoOrfa = agruparFolhaTotaisPorNatureza(comOrfa, nomeDoGrupo);

    expect(comSecaoOrfa.map((s) => s.titulo)).toContain('Outras contas');
    expect(comSecaoOrfa.flatMap((s) => s.contas)).toHaveLength(comOrfa.length);
  });
});
