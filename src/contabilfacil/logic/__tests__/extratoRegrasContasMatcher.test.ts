import { describe, it, expect } from 'vitest';
import { matchExtratoRegraConta } from '../extratoRegrasContasMatcher';
import type { ExtratoRegraConta } from '../extratoRegrasContasStorage';

/**
 * Conciliação: uma regra ampla ("PIX") precisa capturar o histórico, mas nunca
 * pode roubar um lançamento de uma regra detalhada ("PIX JOAO").
 */
function regra(descricao: string, contaContrapartida = '1.01.02.0001'): ExtratoRegraConta {
  return {
    id: descricao,
    nome: descricao,
    descricao,
    nature: 'C',
    contaBanco: '1.01.01.0001',
    contaContrapartida,
  };
}

const match = (historico: string, regras: ExtratoRegraConta[]) =>
  matchExtratoRegraConta(historico, 'C', regras);

describe('Regras de conciliação — detalhada sobressai à ampla', () => {
  it('a regra só com PIX captura o histórico', () => {
    expect(match('PIX RECEBIDO JOAO', [regra('PIX')])?.descricao).toBe('PIX');
    expect(match('PIX ENVIADO 12/03', [regra('PIX')])?.descricao).toBe('PIX');
    expect(match('PIX', [regra('PIX')])?.descricao).toBe('PIX');
  });

  it('PIX JOAO vence PIX no histórico do João', () => {
    const regras = [regra('PIX'), regra('PIX JOAO')];

    expect(match('PIX JOAO', regras)?.descricao).toBe('PIX JOAO');
    expect(match('PIX ENVIADO JOAO SILVA', regras)?.descricao).toBe('PIX JOAO');
    expect(match('PIX RECEBIDO DE JOAO', regras)?.descricao).toBe('PIX JOAO');
  });

  it('a ordem de cadastro das regras não altera o vencedor', () => {
    const ordemA = [regra('PIX'), regra('PIX JOAO')];
    const ordemB = [regra('PIX JOAO'), regra('PIX')];

    expect(match('PIX ENVIADO JOAO SILVA', ordemA)?.descricao).toBe('PIX JOAO');
    expect(match('PIX ENVIADO JOAO SILVA', ordemB)?.descricao).toBe('PIX JOAO');
  });

  it('a regra ampla ainda recolhe o que nenhuma detalhada capturou', () => {
    const regras = [regra('PIX'), regra('PIX JOAO')];

    // Maria não tem regra própria — cai na ampla
    expect(match('PIX RECEBIDO MARIA', regras)?.descricao).toBe('PIX');
  });

  it('entre duas detalhadas, vence a que casa mais texto', () => {
    const regras = [regra('JOAO'), regra('JOAO SILVA'), regra('PIX')];

    expect(match('PIX ENVIADO JOAO SILVA', regras)?.descricao).toBe('JOAO SILVA');
  });

  it('a regra ampla não casa histórico sem o termo', () => {
    expect(match('TARIFA BANCARIA MENSAL', [regra('PIX')])).toBeNull();
    expect(match('TED RECEBIDA CLIENTE', [regra('PIX')])).toBeNull();
  });

  it('regras operacionais amplas (PIX REC, TRANSFERENCIA) voltam a capturar', () => {
    expect(match('PIX REC JOAO', [regra('PIX REC')])?.descricao).toBe('PIX REC');
    expect(match('TRANSFERENCIA ENTRE CONTAS', [regra('TRANSFERENCIA')])?.descricao).toBe(
      'TRANSFERENCIA',
    );
  });

  it('a detalhada vence também sobre PIX REC', () => {
    const regras = [regra('PIX REC'), regra('PIX REC IMPERIO')];

    expect(match('PIX REC IMPERIO COMERCIO', regras)?.descricao).toBe('PIX REC IMPERIO');
  });

  it('não mistura contrapartes distintas entre duas regras detalhadas', () => {
    const regras = [regra('PIX ENVIADO IMPERIO'), regra('PIX ENVIADO A ECONOMICA')];

    expect(match('PIX ENVIADO IMPERIO COMERCIO', regras)?.descricao).toBe('PIX ENVIADO IMPERIO');
    expect(match('PIX ENVIADO A ECONOMICA LTDA', regras)?.descricao).toBe(
      'PIX ENVIADO A ECONOMICA',
    );
  });

  it('respeita a natureza D/C da regra', () => {
    const regras = [regra('PIX')];

    expect(matchExtratoRegraConta('PIX RECEBIDO', 'C', regras)?.descricao).toBe('PIX');
    expect(matchExtratoRegraConta('PIX RECEBIDO', 'D', regras)).toBeNull();
  });

  it('não casa regra com código/ruído (ex: T10/06) em históricos de outras empresas (ex: POLO CLIMATIZACAO)', () => {
    const regras = [regra('PIX RECEBIDO . T10/06 . LTDA')];

    expect(
      match('PIX RECEBIDO POLO 22/06 POLO CLIMATIZACAO LTDA', regras),
    ).toBeNull();
    expect(
      match('PIX RECEBIDO . T10/06 . LTDA', regras)?.descricao,
    ).toBe('PIX RECEBIDO . T10/06 . LTDA');
  });

  it('garante que a regra POLO CLIMATIZACAO ou POLO SUL CLIMATIZACAO casa com seus respectivos históricos', () => {
    const regraPoloClim = [regra('POLO CLIMATIZACAO')];
    const regraPoloSulClim = [regra('POLO SUL CLIMATIZACAO')];

    expect(
      match('PIX RECEBIDO POLO 22/06 POLO CLIMATIZACAO LTDA', regraPoloClim)?.descricao,
    ).toBe('POLO CLIMATIZACAO');
    expect(
      match('PIX RECEBIDO POLO SUL CLIMATIZACAO LTDA', regraPoloSulClim)?.descricao,
    ).toBe('POLO SUL CLIMATIZACAO');
  });
});
