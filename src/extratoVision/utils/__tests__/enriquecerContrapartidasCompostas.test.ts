import { describe, it, expect } from 'vitest';
import { enriquecerContrapartidasCompostas } from '../dominioLancamentosTxt';
import type { VisionBalanceteRow } from '../../types/accounting';

function row(over: Partial<VisionBalanceteRow>): VisionBalanceteRow {
  return {
    codigo: '8',
    nome: 'LANCAMENTO',
    data: '23/02/2026',
    debito: 0,
    credito: 0,
    saldoInicial: 0,
    saldoFinal: 0,
    ...over,
  } as VisionBalanceteRow;
}

describe('enriquecerContrapartidasCompostas', () => {
  it('nunca preenche contaDeb/contaCred com a mesma conta quando as duas pernas coincidem no código', () => {
    // Regressão do bug do modal "Editar Lançamento" mostrando Conta Débito e
    // Conta Crédito ambas como "8": duas pernas do mesmo dia usando o mesmo
    // código de conta placeholder (ex.: automações que caem numa conta genérica)
    // faziam essa função gravar contaDeb === contaCred === "8" num lançamento
    // que na verdade é de perna única.
    const debito = row({ codigo: '8', debito: 2159, credito: 0 });
    const credito = row({ codigo: '8', debito: 0, credito: 2159 });

    const [d, c] = enriquecerContrapartidasCompostas([debito, credito]);

    // Nunca as duas pernas com o MESMO código preenchido nos dois campos —
    // ficar sem contrapartida (undefined) é seguro, "fechar contra si mesma" não é.
    expect(!!d.contaDeb && !!d.contaCred && d.contaDeb === d.contaCred).toBe(false);
    expect(!!c.contaDeb && !!c.contaCred && c.contaDeb === c.contaCred).toBe(false);
  });

  it('preenche normalmente a contrapartida quando as contas são diferentes', () => {
    const debito = row({ codigo: '8', debito: 500, credito: 0 });
    const credito = row({ codigo: '12', debito: 0, credito: 500 });

    const [d, c] = enriquecerContrapartidasCompostas([debito, credito]);

    expect(d.contaCred).toBe('12');
    expect(c.contaDeb).toBe('8');
  });
});
