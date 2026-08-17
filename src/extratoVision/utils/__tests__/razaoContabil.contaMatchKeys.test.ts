import { describe, expect, it } from 'vitest';
import { addContaToMatchKeys, buildContaMatchKeys, contaMatchesKeys } from '../razaoContabil';

describe('buildContaMatchKeys / contaMatchesKeys', () => {
  it('não cruza código reduzido de uma conta com a classificação de outra (bug da colisão)', () => {
    // "0000322" (reduzido) e "3.2.2" (classificação) normalizam pro mesmo dígito
    // "322" se jogados no mesmo Set sem distinguir o tipo — essa é a colisão que
    // fazia contas inteiras sumirem do balancete/export (ver memória reduzido_cls_collision).
    const pendente = buildContaMatchKeys([{ code: '0000322', codigoReduzido: '0000322' }]);

    // Conta TOTALMENTE diferente, já confirmada, cuja classificação é "3.2.2".
    const rowDeOutraConta = { classificacao: '3.2.2', codigo: '0000900' };
    expect(contaMatchesKeys(rowDeOutraConta, pendente)).toBe(false);

    // A própria conta pendente (mesmo reduzido) continua batendo normalmente.
    const rowDaContaPendente = { classificacao: '', codigo: '0000322' };
    expect(contaMatchesKeys(rowDaContaPendente, pendente)).toBe(true);
  });

  it('casa classificação estruturada com pontos independente de padding de zero por segmento', () => {
    const keys = buildContaMatchKeys([{ code: '1.1.1.02.01109' }]);
    expect(contaMatchesKeys({ classificacao: '1.1.1.2.1109' }, keys)).toBe(true);
  });

  it('casa grupo de topo curto (1-2 dígitos) por classificação', () => {
    const keys = buildContaMatchKeys([{ code: '3' }]);
    expect(contaMatchesKeys({ classificacao: '3' }, keys)).toBe(true);
  });

  it('casa código reduzido pelo campo codigoReduzido mesmo quando code é uma classificação com pontos', () => {
    const keys = buildContaMatchKeys([{ code: '2.1.1.02.01109', codigoReduzido: '0001109' }]);
    expect(contaMatchesKeys({ codigo: '0001109' }, keys)).toBe(true);
    expect(contaMatchesKeys({ codigo: '1109' }, keys)).toBe(true);
  });

  it('addContaToMatchKeys acumula em um ContaMatchKeys existente', () => {
    const keys = buildContaMatchKeys([{ code: '1.1' }]);
    addContaToMatchKeys(keys, { code: '0000500' });
    expect(contaMatchesKeys({ classificacao: '1.1' }, keys)).toBe(true);
    expect(contaMatchesKeys({ codigo: '500' }, keys)).toBe(true);
  });
});
