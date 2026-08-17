import { describe, expect, it } from 'vitest';
import { selecionarIndicesCausaRaizInvertidos } from '../naturezaContabil';

describe('selecionarIndicesCausaRaizInvertidos', () => {
  it('marca só o lançamento de natureza oposta que causa a inversão', () => {
    // Conta Devedora: D 100 ok; C 150 inverte (marca e “remove”); C 200 voltaria a inverter (marca).
    const lancamentos = [
      { debito: 100, credito: 0 },
      { debito: 0, credito: 150 },
      { debito: 0, credito: 200 },
      { debito: 20, credito: 0 },
    ];
    const indices = selecionarIndicesCausaRaizInvertidos(lancamentos, 'D', 0, false);
    expect([...indices]).toEqual([1, 2]);
  });

  it('não acusa conta de natureza ambígua', () => {
    const lancamentos = [{ debito: 0, credito: 100 }];
    expect(selecionarIndicesCausaRaizInvertidos(lancamentos, 'D', 0, true).size).toBe(0);
  });

  it('respeita saldo anterior já carregado', () => {
    // Saldo anterior +200 D; crédito 50 não inverte; crédito 200 inverte
    const lancamentos = [
      { debito: 0, credito: 50 },
      { debito: 0, credito: 200 },
    ];
    const indices = selecionarIndicesCausaRaizInvertidos(lancamentos, 'D', 200, false);
    expect([...indices]).toEqual([1]);
  });

  it('jamais seleciona lançamentos da mesma natureza da conta (ex: débitos em conta devedora)', () => {
    // Numa conta devedora (D), lançamentos a débito (debito > 0) JAMAIS podem ser marcados como invertidos
    const lancamentos = [
      { debito: 100, credito: 0 },
      { debito: 500, credito: 0 },
      { debito: 1200, credito: 0 },
    ];
    const indices = selecionarIndicesCausaRaizInvertidos(lancamentos, 'D', -500, false);
    expect(indices.size).toBe(0);
  });
});
