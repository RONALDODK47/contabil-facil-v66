import { describe, expect, it } from 'vitest';
import {
  gerarProximaClassificacaoDoGrupo,
  gerarProximaClassificacaoSobPai,
} from '../planoContasMapper';

describe('gerarProximaClassificacaoSobPai', () => {
  it('incrementa o último segmento sob o pai, preservando padding', () => {
    const plano = [
      { code: '5.1.1.01.00001' },
      { code: '5.1.1.01.00011' },
      { code: '5.1.1.02.00001' },
    ];
    expect(gerarProximaClassificacaoSobPai(plano, '5.1.1.01')).toBe('5.1.1.01.00012');
  });

  it('cria 1ª analítica no padrão Domínio quando o pai ainda não tem filhos', () => {
    expect(gerarProximaClassificacaoSobPai([], '5.1.1.01')).toBe('5.1.1.01.00001');
    expect(gerarProximaClassificacaoSobPai([], '5.1.1')).toBe('5.1.1.01.00001');
  });
});

describe('gerarProximaClassificacaoDoGrupo', () => {
  it('usa template Domínio quando o grupo está vazio', () => {
    expect(gerarProximaClassificacaoDoGrupo([], 'DESPESA')).toBe('5.1.1.01.00001');
    expect(gerarProximaClassificacaoDoGrupo([], 'ATIVO')).toBe('1.1.1.01.00001');
  });

  it('segue a sequência do pai sintético com mais analíticas no grupo', () => {
    const plano = [
      { code: '5.1.1.01.00001', group: 'DESPESA' },
      { code: '5.1.1.01.00002', group: 'DESPESA' },
      { code: '5.1.1.01.00003', group: 'DESPESA' },
      { code: '5.2.1.01.00001', group: 'DESPESA' },
      { code: '1.1.1.01.00099', group: 'ATIVO' },
    ];
    expect(gerarProximaClassificacaoDoGrupo(plano, 'DESPESA')).toBe('5.1.1.01.00004');
  });

  it('ignora códigos sem classificação estruturada (ex.: só reduzido)', () => {
    const plano = [
      { code: '0001189', group: 'DESPESA' },
      { code: '5.1.1.01.00007', group: 'DESPESA' },
    ];
    expect(gerarProximaClassificacaoDoGrupo(plano, 'DESPESA')).toBe('5.1.1.01.00008');
  });
});
