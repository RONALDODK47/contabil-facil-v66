import { describe, it, expect } from 'vitest';
import { filtrarLancamentosRazaoDaConta } from '../RazaoContaLancamentosModal';
import type { VisionBalanceteRow } from '../../types/accounting';

function razaoRow(over: Partial<VisionBalanceteRow>): VisionBalanceteRow {
  return {
    codigo: '187',
    classificacao: 'FOLHA-AUTO · SALARIO · tag-1',
    nome: 'SALARIOS E ORDENADOS A PAGAR',
    data: '31/01/2026',
    debito: 0,
    credito: 143,
    saldoInicial: 0,
    saldoFinal: 0,
    ordem: 1,
    tipo: 'A',
    ...over,
  } as VisionBalanceteRow;
}

describe('filtrarLancamentosRazaoDaConta', () => {
  it('acha os lançamentos quando a conta é aberta só com código (sem classificação hierárquica)', () => {
    // Regressão: a tela "Totais por Conta" da Folha abre o Razão da Conta passando o mesmo
    // valor em `codigo` e `classificacao` (Folha não tem classificação hierárquica de verdade,
    // só o código). Isso fazia o filtro por "codigo" achar que não tinha um código reduzido de
    // verdade (proteção pensada para outro caso) e sempre voltar 0 lançamentos, mesmo com a
    // conta tendo movimento real.
    const rows = [razaoRow({})];
    const resultado = filtrarLancamentosRazaoDaConta(
      rows,
      { chave: '187', codigo: '187', classificacao: '', nome: 'SALARIOS E ORDENADOS A PAGAR', tipo: 'A' },
      '01/01/2026',
      '31/12/2026',
      'codigo',
    );
    expect(resultado.length).toBe(1);
  });

  it('não confunde contas diferentes que só coincidem no código', () => {
    const rows = [razaoRow({ codigo: '999', nome: 'OUTRA CONTA' })];
    const resultado = filtrarLancamentosRazaoDaConta(
      rows,
      { chave: '187', codigo: '187', classificacao: '', nome: 'SALARIOS E ORDENADOS A PAGAR', tipo: 'A' },
      '01/01/2026',
      '31/12/2026',
      'codigo',
    );
    expect(resultado.length).toBe(0);
  });
});
