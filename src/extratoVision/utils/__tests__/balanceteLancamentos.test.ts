import { describe, it, expect } from 'vitest';
import {
  contasSaoIguaisEDevemSerLimpa,
  criarParLancamento,
  criarParAjusteNatureza,
} from '../balanceteLancamentos';
import type { VisionBalanceteRow } from '../../types/accounting';

function conta(codigo: string, nome = codigo): VisionBalanceteRow {
  return { codigo, nome, saldoInicial: 0, debito: 0, credito: 0, saldoFinal: 0, tipo: 'A' };
}

describe('contasSaoIguaisEDevemSerLimpa', () => {
  it('limpa o crédito quando débito e crédito são a mesma conta', () => {
    expect(contasSaoIguaisEDevemSerLimpa('8', '8')).toEqual({ contaDeb: '8', contaCred: '' });
  });

  it('mantém as duas quando são contas diferentes', () => {
    expect(contasSaoIguaisEDevemSerLimpa('8', '12')).toEqual({ contaDeb: '8', contaCred: '12' });
  });
});

describe('criarParLancamento', () => {
  it('nunca gera um par com contaDeb === contaCred, mesmo se as contas físicas coincidem', () => {
    const [d, c] = criarParLancamento({
      contaDeb: conta('8'),
      contaCred: conta('8'),
      valor: 100,
      data: '23/02/2026',
      historico: 'TESTE',
      ordem: 1,
      importId: 'teste:1',
    });
    // Mantém a conta de débito preenchida (é a mais confiável) e deixa a de
    // crédito vazia em vez de fechar a partida contra si mesma.
    expect(d.contaDeb).toBe('8');
    expect(d.contaCred).toBeUndefined();
    expect(c.contaDeb).toBe('8');
    expect(c.contaCred).toBeUndefined();
  });

  it('preenche contaDeb/contaCred nas duas pernas e propaga o importId (idempotência)', () => {
    const [d, c] = criarParLancamento({
      contaDeb: conta('8'),
      contaCred: conta('12'),
      valor: 100,
      data: '23/02/2026',
      historico: 'TESTE',
      ordem: 1,
      importId: 'teste:1',
    });
    expect(d.contaDeb).toBe('8');
    expect(d.contaCred).toBe('12');
    expect(c.contaDeb).toBe('8');
    expect(c.contaCred).toBe('12');
    expect(d.importId).toBe('teste:1');
    expect(c.importId).toBe('teste:1');
    expect(d.debito).toBe(100);
    expect(c.credito).toBe(100);
    expect(d.ordem).toBe(c.ordem);
  });

  it('não gera lançamento para valor abaixo do limiar de arredondamento', () => {
    const par = criarParLancamento({
      contaDeb: conta('8'),
      contaCred: conta('12'),
      valor: 0.01,
      data: '23/02/2026',
      historico: 'TESTE',
      ordem: 1,
      importId: 'teste:1',
    });
    expect(par).toEqual([]);
  });
});

describe('criarParAjusteNatureza', () => {
  it('conta de natureza D com diferença positiva fica do lado débito', () => {
    const [d, c] = criarParAjusteNatureza({
      conta: conta('8'),
      contrapartida: conta('12'),
      diferencaAssinada: 50,
      naturezaEsperadaConta: 'D',
      data: '23/02/2026',
      historico: 'AJUSTE',
      ordem: 1,
      importId: 'teste:2',
    });
    expect(d.codigo).toBe('8');
    expect(d.debito).toBe(50);
    expect(c.codigo).toBe('12');
    expect(c.credito).toBe(50);
  });

  it('conta de natureza D com diferença negativa fica do lado crédito', () => {
    const [primeira, segunda] = criarParAjusteNatureza({
      conta: conta('8'),
      contrapartida: conta('12'),
      diferencaAssinada: -50,
      naturezaEsperadaConta: 'D',
      data: '23/02/2026',
      historico: 'AJUSTE',
      ordem: 1,
      importId: 'teste:3',
    });
    const linhaConta8 = [primeira, segunda].find((r) => r.codigo === '8')!;
    expect(linhaConta8.credito).toBe(50);
  });
});
