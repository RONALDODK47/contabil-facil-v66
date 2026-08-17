import { describe, expect, it } from 'vitest';
import { detectarContasNovas } from '../planoContasAutoCriar';
import type { VisionBalanceteRow } from '../../../extratoVision/types/accounting';

function row(partial: Partial<VisionBalanceteRow>): VisionBalanceteRow {
  return {
    codigo: '',
    nome: 'LANCAMENTO',
    saldoInicial: 0,
    debito: 0,
    credito: 0,
    saldoFinal: 0,
    ...partial,
  };
}

describe('detectarContasNovas', () => {
  it('detecta uma conta do razão ausente do plano e infere grupo/natureza pela classificação', () => {
    const razao = [row({ codigo: '0001109', classificacao: '2.1.1.02.01109', debito: 0, credito: 500 })];
    const novas = detectarContasNovas(razao, []);
    expect(novas).toHaveLength(1);
    expect(novas[0].code).toBe('2.1.1.02.01109');
    expect(novas[0].codigoReduzido).toBe('0001109');
    expect(novas[0].group).toBe('PASSIVO');
    expect(novas[0].nature).toBe('CREDORA');
    expect(novas[0].precisaRenomear).toBe(true);
  });

  it('não recria conta que já existe no plano (por classificação ou código reduzido)', () => {
    const razao = [row({ codigo: '0001109', classificacao: '2.1.1.02.01109' })];
    const plano = [{ code: '2.1.1.02.01109', codigoReduzido: '0001109' }];
    expect(detectarContasNovas(razao, plano)).toHaveLength(0);
  });

  it('ignora linhas sem classificação numérica válida (ex.: lixo de cabeçalho)', () => {
    const razao = [row({ codigo: 'Empresa:', classificacao: 'Empresa:', nome: 'Empresa:' })];
    expect(detectarContasNovas(razao, [])).toHaveLength(0);
  });

  it('dedup: duas linhas do razão com a mesma classificação geram só uma conta nova', () => {
    const razao = [
      row({ codigo: '0001109', classificacao: '1.1.1.02.01109', debito: 100 }),
      row({ codigo: '0001109', classificacao: '1.1.1.02.01109', credito: 50 }),
    ];
    expect(detectarContasNovas(razao, [])).toHaveLength(1);
  });

  it('rejeita um CNPJ vazado do arquivo (começa com dígito mas tem barra/hífen — não é código de conta)', () => {
    const razao = [
      row({ codigo: '44.854.551/0001-98', classificacao: '44.854.551/0001-98', nome: 'C.N.P.J.' }),
    ];
    expect(detectarContasNovas(razao, [])).toHaveLength(0);
  });

  it('não confunde código reduzido novo com classificação de conta já existente (bug da colisão reduzido×classificação)', () => {
    // Conta já confirmada no plano com classificação "3.2.2".
    const plano = [{ code: '3.2.2', codigoReduzido: '0000900' }];
    // Lançamento de uma conta DIFERENTE, cujo reduzido "0000322" normaliza pro
    // mesmo "322" que "3.2.2" numa comparação ingênua de string única.
    const razao = [row({ codigo: '0000322', classificacao: '', debito: 100 })];
    const novas = detectarContasNovas(razao, plano);
    expect(novas).toHaveLength(1);
    expect(novas[0].codigoReduzido).toBe('0000322');
  });

  it('reconhece conta já existente mesmo com padding de zero diferente por segmento entre plano e razão', () => {
    const plano = [{ code: '1.1.1.02.01109', codigoReduzido: '0001109' }];
    const razao = [row({ codigo: '0001109', classificacao: '1.1.1.2.1109' })];
    expect(detectarContasNovas(razao, plano)).toHaveLength(0);
  });
});
