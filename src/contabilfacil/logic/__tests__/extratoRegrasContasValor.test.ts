import { describe, it, expect } from 'vitest';
import { matchExtratoRegraConta } from '../extratoRegrasContasMatcher';
import type { ExtratoRegraConta } from '../extratoRegrasContasStorage';
import { isRegraPorValor, normalizeRegraValor } from '../extratoRegrasContasStorage';

/** Regras de conciliação cadastradas POR VALOR (e não pelo texto do histórico). */
function regraValor(valor: number, contra = '1112'): ExtratoRegraConta {
  return {
    id: `valor-${valor}`,
    nome: `VALOR ${valor}`,
    descricao: 'PIX ENVIADO FORNECEDOR X',
    nature: 'D',
    contaBanco: '1076',
    contaContrapartida: contra,
    matchTipo: 'valor',
    valor,
  };
}

function regraHistorico(descricao: string, contra = '2223'): ExtratoRegraConta {
  return {
    id: descricao,
    nome: descricao,
    descricao,
    nature: 'D',
    contaBanco: '1076',
    contaContrapartida: contra,
    matchTipo: 'historico',
  };
}

describe('Regra por valor', () => {
  it('casa pelo valor exato do lançamento, com qualquer histórico', () => {
    const hit = matchExtratoRegraConta('COMPRA QUALQUER COISA', 'D', [regraValor(1250)], 1250);
    expect(hit?.contaContrapartida).toBe('1112');
  });

  it('não casa quando o valor é diferente', () => {
    expect(matchExtratoRegraConta('PIX ENVIADO', 'D', [regraValor(1250)], 1249.99)).toBeNull();
  });

  it('respeita a natureza D/C', () => {
    expect(matchExtratoRegraConta('PIX', 'C', [regraValor(1250)], 1250)).toBeNull();
  });

  it('ignora o sinal do valor da linha', () => {
    expect(matchExtratoRegraConta('PIX', 'D', [regraValor(1250)], -1250)?.valor).toBe(1250);
  });

  it('vence a regra por histórico que casaria o mesmo lançamento', () => {
    const regras = [regraHistorico('PIX ENVIADO FORNECEDOR X'), regraValor(500)];
    const hit = matchExtratoRegraConta('PIX ENVIADO FORNECEDOR X', 'D', regras, 500);
    expect(hit?.contaContrapartida).toBe('1112');
  });

  it('regra por valor não captura lançamentos pelo texto do histórico', () => {
    const regras = [regraValor(500), regraHistorico('PIX ENVIADO FORNECEDOR X')];
    const hit = matchExtratoRegraConta('PIX ENVIADO FORNECEDOR X', 'D', regras, 999);
    expect(hit?.contaContrapartida).toBe('2223');
  });

  it('sem valor na linha, só as regras por histórico valem', () => {
    expect(matchExtratoRegraConta('PIX ENVIADO FORNECEDOR X', 'D', [regraValor(500)])).toBeNull();
  });

  it('normalizeRegraValor aceita formato BR e rejeita lixo (sanidade)', () => {
    expect(normalizeRegraValor('1.250,00')).toBe(1250);
    expect(normalizeRegraValor('0')).toBeUndefined();
    expect(normalizeRegraValor('abc')).toBeUndefined();
    expect(isRegraPorValor(regraValor(10))).toBe(true);
    expect(isRegraPorValor(regraHistorico('PIX'))).toBe(false);
  });
});

/**
 * Conflito entre as duas pastas de regra: uma regra POR VALOR de 200 (histórico
 * "DX" só como referência) e uma regra POR HISTÓRICO "DX".
 *
 * A regra de valor manda no lançamento DX de 200 — SEMPRE, independente de qual
 * das duas foi cadastrada primeiro. A regra de histórico continua pegando todos
 * os outros DX (150, 300…), só não encosta no de 200.
 */
describe('Valor manda sobre histórico no mesmo lançamento', () => {
  const porValor: ExtratoRegraConta = {
    id: 'valor-200',
    nome: 'VALOR 200',
    descricao: 'DX',
    nature: 'D',
    contaBanco: '1076',
    contaContrapartida: '5555',
    matchTipo: 'valor',
    valor: 200,
  };
  const porHistorico: ExtratoRegraConta = {
    id: 'hist-dx',
    nome: 'DX',
    descricao: 'DX',
    nature: 'D',
    contaBanco: '1076',
    contaContrapartida: '7777',
    matchTipo: 'historico',
  };

  // A ordem na lista reproduz a ordem de cadastro do usuário.
  const historicoPrimeiro = [porHistorico, porValor];
  const valorPrimeiro = [porValor, porHistorico];

  it('DX de 200 vai para a regra de valor mesmo com o histórico cadastrado antes', () => {
    expect(matchExtratoRegraConta('DX', 'D', historicoPrimeiro, 200)?.contaContrapartida).toBe('5555');
    expect(matchExtratoRegraConta('DX', 'D', valorPrimeiro, 200)?.contaContrapartida).toBe('5555');
  });

  it('os demais DX continuam com a regra de histórico', () => {
    expect(matchExtratoRegraConta('DX', 'D', historicoPrimeiro, 150)?.contaContrapartida).toBe('7777');
    expect(matchExtratoRegraConta('DX', 'D', historicoPrimeiro, 300)?.contaContrapartida).toBe('7777');
    expect(matchExtratoRegraConta('PIX DX FORNECEDOR', 'D', historicoPrimeiro, 999)?.contaContrapartida).toBe(
      '7777',
    );
  });

  it('vale também quando o histórico do lançamento é mais longo que a regra', () => {
    expect(
      matchExtratoRegraConta('PIX DX FORNECEDOR', 'D', historicoPrimeiro, 200)?.contaContrapartida,
    ).toBe('5555');
  });

  it('documento também vence o histórico, e valor vence o documento', () => {
    const porDocumento: ExtratoRegraConta = {
      id: 'doc',
      nome: 'DOC',
      descricao: 'DX',
      nature: 'D',
      contaBanco: '1076',
      contaContrapartida: '8888',
      matchTipo: 'documento',
      documento: '12345678900',
    };
    const todas = [porHistorico, porDocumento, porValor];
    expect(matchExtratoRegraConta('DX CPF 12345678900', 'D', todas, 150)?.contaContrapartida).toBe(
      '8888',
    );
    expect(matchExtratoRegraConta('DX CPF 12345678900', 'D', todas, 200)?.contaContrapartida).toBe(
      '5555',
    );
  });
});
