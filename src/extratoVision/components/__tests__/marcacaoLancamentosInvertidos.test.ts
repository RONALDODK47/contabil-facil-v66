import { describe, it, expect } from 'vitest';
import {
  chaveLancamentoRazao,
  coletarLancamentosCausaRaizInvertidos,
} from '../RazaoContaLancamentosModal';
import type { VisionBalanceteRow, VisionPlanoRow } from '../../types/accounting';

/**
 * O modo "Razão" do Balancete pinta de vermelho os lançamentos causa-raiz
 * comparando `chaveLancamentoRazao(linhaCrua)` com o Set devolvido por
 * `coletarLancamentosCausaRaizInvertidos`. As chaves do Set precisam bater com
 * as linhas CRUAS do razão — o filtro interno passa por `enrichNomeDoPlano`,
 * que reescreve `classificacao`/`codigo`/`nome` a partir do plano.
 */

const DE = '01/04/2026';
const ATE = '30/04/2026';

// Conta devedora (Ativo). No razão o lançamento vem só com o código REDUZIDO,
// sem classificação — situação normal de TXT importado.
const plano: VisionPlanoRow[] = [
  { codigo: '1.1.1.01.00001', codigoReduzido: '5', nome: 'CAIXA GERAL', tipo: 'A' } as VisionPlanoRow,
];

const razaoRows: VisionBalanceteRow[] = [
  {
    codigo: '5',
    classificacao: '',
    nome: 'PAGAMENTO FORNECEDOR',
    data: '10/04/2026',
    saldoInicial: 0,
    debito: 0,
    credito: 1000,
    saldoFinal: 0,
  } as VisionBalanceteRow,
];

const conta = {
  codigo: '5',
  classificacao: '1.1.1.01.00001',
  nome: 'CAIXA GERAL',
  tipo: 'A' as const,
};

describe('marcação vermelha dos lançamentos invertidos (modo Razão do Balancete)', () => {
  it('a chave coletada bate com a linha CRUA exibida no Balancete', () => {
    const chaves = coletarLancamentosCausaRaizInvertidos([conta], razaoRows, DE, ATE, plano);
    expect(chaves.size).toBeGreaterThan(0);
    expect(chaves.has(chaveLancamentoRazao(razaoRows[0]!))).toBe(true);
  });
});
