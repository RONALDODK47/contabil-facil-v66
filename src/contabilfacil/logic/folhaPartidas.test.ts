import { describe, expect, it } from 'vitest';
import { buildFolhaPartidas, buildFolhaTotaisPorConta } from './folhaToRazao';
import type { FolhaRegra } from './folhaContasAutomacaoStorage';

/** Regra que o usuário cadastra na aba Folha: salários e remuneração → D 298 / C 187. */
const REGRA_SALARIOS: FolhaRegra = {
  id: 'r1',
  descricao: 'Salários e remuneração',
  contaDebito: '298',
  contaCredito: '187',
  destino: 'REMUNERACAO',
};

const REGRA_FGTS: FolhaRegra = {
  id: 'r2',
  descricao: 'FGTS',
  contaDebito: '304',
  contaCredito: '192',
  destino: 'FGTS',
};

const LINHAS = [
  { id: 'a', date: '31/01/2026', description: '8781 - SALARIO EMPREGADO 2', debito: 0, credito: 6484, tipo: 'PROVENTOS' as const },
  { id: 'b', date: '31/01/2026', description: '9179 - SALDO DE SALARIO HORAS2', debito: 0, credito: 13156.7, tipo: 'PROVENTOS' as const },
  { id: 'c', date: '28/02/2026', description: '243 - DESCANSO SEMANAL REMUNERADO2', debito: 0, credito: 2085.03, tipo: 'PROVENTOS' as const },
  { id: 'd', date: '31/01/2026', description: '996 - F.G.T.S DO MES', debito: 0, credito: 2088.92, tipo: 'INFORMATIVA' as const },
  // Sem regra cadastrada — não pode virar partida
  { id: 'e', date: '31/01/2026', description: '998 - I.N.S.S.', debito: 1985.19, credito: 0, tipo: 'DESCONTOS' as const },
];

describe('buildFolhaPartidas — o razão por conta da aba Folha', () => {
  it('gera as duas pernas de cada lançamento que tem regra', () => {
    const partidas = buildFolhaPartidas(LINHAS, [REGRA_SALARIOS]);

    // 3 lançamentos de remuneração × débito + crédito
    expect(partidas).toHaveLength(6);
    expect(partidas.filter((p) => p.codigo === '298').every((p) => p.debito > 0)).toBe(true);
    expect(partidas.filter((p) => p.codigo === '187').every((p) => p.credito > 0)).toBe(true);
  });

  it('ignora lançamento sem regra — não inventa conta', () => {
    const partidas = buildFolhaPartidas(LINHAS, [REGRA_SALARIOS]);
    expect(partidas.some((p) => p.nome.includes('I.N.S.S'))).toBe(false);
  });

  it('mantém o histórico da rubrica em cada perna, para aparecer no razão', () => {
    const partidas = buildFolhaPartidas(LINHAS, [REGRA_SALARIOS]);
    const nomes = partidas.map((p) => p.nome);
    expect(nomes).toContain('8781 - SALARIO EMPREGADO 2');
    expect(nomes).toContain('9179 - SALDO DE SALARIO HORAS2');
  });

  it('respeita o filtro de período da aba', () => {
    const so01 = buildFolhaPartidas(LINHAS, [REGRA_SALARIOS], { de: '01/01/2026', ate: '31/01/2026' });
    expect(so01).toHaveLength(4); // 2 lançamentos × 2 pernas
    expect(so01.every((p) => p.data === '31/01/2026')).toBe(true);
  });

  it('o detalhe da conta fecha exatamente com o total exibido', () => {
    const partidas = buildFolhaPartidas(LINHAS, [REGRA_SALARIOS, REGRA_FGTS]);
    const totais = buildFolhaTotaisPorConta(partidas, (c) => `Conta ${c}`);

    const total187 = totais.find((t) => t.conta === '187');
    const detalhe187 = partidas.filter((p) => p.codigo === '187');
    const somaDetalhe = detalhe187.reduce((s, p) => s + p.credito, 0);

    expect(total187?.credito).toBeCloseTo(somaDetalhe, 2);
    expect(total187?.credito).toBeCloseTo(6484 + 13156.7 + 2085.03, 2);

    // FGTS entrou na própria conta, sem se misturar com salários
    expect(totais.find((t) => t.conta === '192')?.credito).toBeCloseTo(2088.92, 2);
    expect(totais.find((t) => t.conta === '304')?.debito).toBeCloseTo(2088.92, 2);
  });

  it('cada conta fecha em partida dobrada — total de débitos = total de créditos', () => {
    const partidas = buildFolhaPartidas(LINHAS, [REGRA_SALARIOS, REGRA_FGTS]);
    const totais = buildFolhaTotaisPorConta(partidas, (c) => c);

    const somaD = totais.reduce((s, t) => s + t.debito, 0);
    const somaC = totais.reduce((s, t) => s + t.credito, 0);
    expect(somaD).toBeCloseTo(somaC, 2);
  });

  it('carrega a classificação contábil real — é dela que o razão deriva a natureza', () => {
    const cls = (c: string) => (c === '187' ? '2.1.3.01.00001' : '3.2.1.01.00001');
    const partidas = buildFolhaPartidas(LINHAS, [REGRA_SALARIOS], undefined, cls);

    // Passivo continua sendo passivo: sem isso "Salários a pagar" aparecia como DEVEDORA
    expect(partidas.filter((p) => p.codigo === '187').every((p) => p.classificacao === '2.1.3.01.00001')).toBe(true);
    expect(partidas.filter((p) => p.codigo === '298').every((p) => p.classificacao === '3.2.1.01.00001')).toBe(true);
    // O marcador da folha fica fora da classificação
    expect(partidas.every((p) => !String(p.classificacao).includes('FOLHA-REGRA'))).toBe(true);
    expect(partidas.every((p) => String(p.importId).startsWith('FOLHA-REGRA'))).toBe(true);
  });

  it('sem regra nenhuma, não há total nem detalhe', () => {
    expect(buildFolhaPartidas(LINHAS, [])).toHaveLength(0);
    expect(buildFolhaTotaisPorConta([], (c) => c)).toHaveLength(0);
  });
});
