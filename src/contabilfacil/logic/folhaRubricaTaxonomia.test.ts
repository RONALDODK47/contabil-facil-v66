import { describe, expect, it } from 'vitest';
import {
  agruparRubricasFolha,
  agruparRubricasPorDestino,
  classificarRubricaDestino,
  FOLHA_DESTINOS,
  destinoDoGrupo,
  classificarRubricaFolhaId,
  FOLHA_GRUPOS,
  normalizeRubricaNome,
  rubricaContabiliza,
} from './folhaRubricaTaxonomia';

/**
 * Rubricas reais do "Resumo Mensal" (Domínio, competências 01–07/2026), já no formato em que
 * chegam da importação: "<código> - <nome>", com os dígitos de coluna colados pelo extrator.
 */
const RUBRICAS_RELATORIO: Array<[descricao: string, tipo: 'PROVENTOS' | 'DESCONTOS' | 'INFORMATIVA', esperado: string]> = [
  // PROVENTOS
  ['20 - GRATIFICACOES1', 'PROVENTOS', 'GRATIFICACAO'],
  ['249 - GRATIFICACAO', 'PROVENTOS', 'GRATIFICACAO'],
  ['274 - GRATIFICAÇÃO DE FUNÇÃO', 'PROVENTOS', 'GRATIFICACAO'],
  ['243 - DESCANSO SEMANAL REMUNERADO2', 'PROVENTOS', 'DSR'],
  ['229 - FERIAS PROPORCIONAIS', 'PROVENTOS', 'FERIAS'],
  ['3 - HORAS FERIAS', 'PROVENTOS', 'FERIAS'],
  ['1805 - MEDIA VALOR FERIAS', 'PROVENTOS', 'FERIAS'],
  ['1806 - MEDIA HORAS FERIAS', 'PROVENTOS', 'FERIAS'],
  ['931 - 1/3 DAS FERIAS', 'PROVENTOS', 'TERCO_FERIAS'],
  ['28169 - 1/3 FERIAS PROPORCIONAIS RESCISAO', 'PROVENTOS', 'RESCISAO_VERBAS'],
  ['58550 - 13 SALARIO INTEGRAL RESCISAO', 'PROVENTOS', 'RESCISAO_VERBAS'],
  ['8781 - SALARIO EMPREGADO 2', 'PROVENTOS', 'SALARIO'],
  ['9179 - SALDO DE SALARIO HORAS2', 'PROVENTOS', 'SALARIO'],
  ['9180 - SALDO DE SALARIO DIAS.2', 'PROVENTOS', 'SALARIO'],

  // DESCONTOS
  ['998 - I.N.S.S.', 'DESCONTOS', 'INSS_SEGURADO'],
  ['2826 - INSS SOBRE RESCISAO', 'DESCONTOS', 'INSS_RESCISAO'],
  ['2989 - INSS 13 SAL.RESCISAO', 'DESCONTOS', 'INSS_RESCISAO'],
  ['1812 - INSS FERIAS', 'DESCONTOS', 'INSS_FERIAS'],
  ['821 - INSS DIFERENCA FERIAS .', 'DESCONTOS', 'INSS_FERIAS'],
  ['360 - DESC. EMP. CRED. TRAB Nº 0000001054844453', 'DESCONTOS', 'CONSIGNADO'],
  ['369 - DESC. EMP. CRED. TRAB Nº 3804807', 'DESCONTOS', 'CONSIGNADO'],
  ['937 - ADIANTAMENTO DE FERIAS', 'DESCONTOS', 'ADIANTAMENTO_FERIAS'],

  // INFORMATIVA
  ['996 - F.G.T.S DO MES', 'INFORMATIVA', 'FGTS'],
  ['123 - F.G.T.S DE RESCISAO', 'INFORMATIVA', 'FGTS'],
  ['135 - FGTS 13o SALARIO RESCISAO', 'INFORMATIVA', 'FGTS'],
  ['1813 - FGTS FERIAS', 'INFORMATIVA', 'FGTS'],
];

describe('normalizeRubricaNome', () => {
  it('remove código, dígitos colados e pontuação solta', () => {
    expect(normalizeRubricaNome('995 - SALARIO FAMILIA .')).toBe('SALARIO FAMILIA');
    expect(normalizeRubricaNome('20 - GRATIFICACOES1')).toBe('GRATIFICACOES');
    expect(normalizeRubricaNome('9179 - SALDO DE SALARIO HORAS2')).toBe('SALDO DE SALARIO HORAS');
    expect(normalizeRubricaNome('274 - GRATIFICAÇÃO DE FUNÇÃO')).toBe('GRATIFICACAO DE FUNCAO');
  });
});

describe('classificarRubricaFolha — rubricas reais do Resumo Mensal', () => {
  it.each(RUBRICAS_RELATORIO)('%s → %s', (descricao, tipo, esperado) => {
    expect(classificarRubricaFolhaId(descricao, tipo)).toBe(esperado);
  });
});

describe('rubricas que não podem cair no grupo de salário', () => {
  it('salário-família tem grupo próprio (débito é INSS a recuperar, não despesa)', () => {
    expect(classificarRubricaFolhaId('995 - SALARIO FAMILIA .', 'PROVENTOS')).toBe('SALARIO_FAMILIA');
    expect(classificarRubricaFolhaId('SALARIO MATERNIDADE', 'PROVENTOS')).toBe('SALARIO_MATERNIDADE');
  });

  it('13º e 1/3 de férias não caem em SALARIO nem em FERIAS', () => {
    expect(classificarRubricaFolhaId('13 SALARIO PROPORCIONAL', 'PROVENTOS')).toBe('DECIMO_TERCEIRO');
    expect(classificarRubricaFolhaId('1/3 DAS FERIAS', 'PROVENTOS')).toBe('TERCO_FERIAS');
  });

  it('verba paga na rescisão sai de 13º/férias e vira verba rescisória', () => {
    expect(classificarRubricaFolhaId('13 SALARIO INTEGRAL RESCISAO', 'PROVENTOS')).toBe('RESCISAO_VERBAS');
    expect(classificarRubricaFolhaId('1/3 FERIAS PROPORCIONAIS RESCISAO', 'PROVENTOS')).toBe('RESCISAO_VERBAS');
  });

  it('pró-labore não é salário de empregado', () => {
    expect(classificarRubricaFolhaId('PRO-LABORE DIAS', 'PROVENTOS')).toBe('PRO_LABORE');
  });
});

describe('totalizadores não contabilizam', () => {
  it('o líquido da FOLHA é totalizador, não lançamento', () => {
    expect(classificarRubricaFolhaId('LIQUIDO DA FOLHA', 'DESCONTOS')).toBe('LIQUIDO');
    expect(rubricaContabiliza('LIQUIDO GERAL', 'DESCONTOS')).toBe(false);
  });

  it('o líquido da RESCISÃO contabiliza — é o que separa a folha mensal da rescisão', () => {
    // No Resumo do Domínio ele é rubrica da seção DESCONTOS, não um total: sem ele,
    // "Salários a pagar" fecha acima do líquido a pagar da folha mensal.
    expect(classificarRubricaFolhaId('51 - LIQUIDO RESCISAO', 'DESCONTOS')).toBe('LIQUIDO_RESCISAO');
    expect(rubricaContabiliza('51 - LIQUIDO RESCISAO', 'DESCONTOS')).toBe(true);

    const destino = classificarRubricaDestino('51 - LIQUIDO RESCISAO', 'DESCONTOS');
    expect(destino?.id).toBe('LIQUIDO_RESCISAO');
    expect(destino?.sugestaoDebito).toBe('Salários a pagar');
    expect(destino?.sugestaoCredito).toBe('Rescisões a pagar');
  });

  it('linhas de base são apenas conferência', () => {
    expect(rubricaContabiliza('BASE INSS', 'INFORMATIVA')).toBe(false);
  });

  it('rubricas normais contabilizam', () => {
    expect(rubricaContabiliza('8781 - SALARIO EMPREGADO 2', 'PROVENTOS')).toBe(true);
  });
});

describe('agruparRubricasFolha', () => {
  it('reduz as rubricas do relatório a poucos grupos', () => {
    const grupos = agruparRubricasFolha(
      RUBRICAS_RELATORIO.map(([descricao, tipo]) => ({ descricao, tipo })),
    );
    const ids = grupos.map((g) => g.grupo.id);

    expect(ids).toContain('SALARIO');
    expect(ids).toContain('FGTS');
    expect(ids).toContain('INSS_SEGURADO');
    // 26 rubricas viram um punhado de grupos — esse é o ganho da automação
    expect(grupos.length).toBeLessThan(RUBRICAS_RELATORIO.length / 2);

    const salario = grupos.find((g) => g.grupo.id === 'SALARIO');
    expect(salario?.rubricas).toHaveLength(3);
  });
});

describe('catálogo de grupos', () => {
  it('não tem ids duplicados', () => {
    const ids = FOLHA_GRUPOS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('todo exemplo declarado casa com o próprio grupo', () => {
    for (const grupo of FOLHA_GRUPOS) {
      for (const exemplo of grupo.exemplos) {
        expect(classificarRubricaFolhaId(exemplo, grupo.tipo)).toBe(grupo.id);
      }
    }
  });
});

describe('destino contábil — um histórico por par de contas', () => {
  it('salário, DSR e hora extra viram UM histórico só', () => {
    const destinos = [
      '8781 - SALARIO EMPREGADO 2',
      '9179 - SALDO DE SALARIO HORAS2',
      '9180 - SALDO DE SALARIO DIAS.2',
      '243 - DESCANSO SEMANAL REMUNERADO2',
      'HORAS EXTRAS 50%',
      'ADICIONAL NOTURNO',
    ].map((d) => classificarRubricaDestino(d, 'PROVENTOS')?.id);

    expect(new Set(destinos)).toEqual(new Set(['REMUNERACAO']));
  });

  it('prêmios e gratificações têm histórico próprio — o débito não é despesa com salários', () => {
    for (const rubrica of [
      '20 - GRATIFICACOES1',
      '249 - GRATIFICACAO',
      '274 - GRATIFICAÇÃO DE FUNÇÃO',
      'GRATIFICACAO DE CAIXA',
      'PREMIO PRODUCAO',
      'BONUS',
      'ABONO',
    ]) {
      const destino = classificarRubricaDestino(rubrica, 'PROVENTOS');
      expect(destino?.id, rubrica).toBe('GRATIFICACOES_PREMIOS');
      expect(destino?.sugestaoDebito).toBe('Despesa com prêmios e gratificações');
    }

    // e continuam fora da remuneração
    expect(classificarRubricaDestino('8781 - SALARIO EMPREGADO 2', 'PROVENTOS')?.id).toBe('REMUNERACAO');
  });

  it('salário-família fica FORA do histórico de salários (débito é INSS a recuperar)', () => {
    expect(classificarRubricaDestino('8781 - SALARIO EMPREGADO 2', 'PROVENTOS')?.id).toBe('REMUNERACAO');
    expect(classificarRubricaDestino('995 - SALARIO FAMILIA .', 'PROVENTOS')?.id).toBe('BENEFICIO_INSS');
  });

  it('INSS mensal, de férias e de rescisão são TRÊS históricos distintos', () => {
    // Cada um debita uma conta diferente: salários a pagar, férias a pagar, rescisões a pagar
    expect(classificarRubricaDestino('998 - I.N.S.S.', 'DESCONTOS')?.id).toBe('INSS_RETIDO');
    expect(classificarRubricaDestino('1812 - INSS FERIAS', 'DESCONTOS')?.id).toBe('INSS_FERIAS');
    expect(classificarRubricaDestino('821 - INSS DIFERENCA FERIAS .', 'DESCONTOS')?.id).toBe('INSS_FERIAS');
    expect(classificarRubricaDestino('2826 - INSS SOBRE RESCISAO', 'DESCONTOS')?.id).toBe('INSS_RESCISAO');
    expect(classificarRubricaDestino('2989 - INSS 13 SAL.RESCISAO', 'DESCONTOS')?.id).toBe('INSS_RESCISAO');
  });

  it('verbas de rescisão não creditam salários a pagar', () => {
    for (const rubrica of ['58550 - 13 SALARIO INTEGRAL RESCISAO', '28169 - 1/3 FERIAS PROPORCIONAIS RESCISAO']) {
      const destino = classificarRubricaDestino(rubrica, 'PROVENTOS');
      expect(destino?.id).toBe('RESCISAO');
      expect(destino?.sugestaoCredito).toBe('Rescisões a pagar');
    }
  });

  it('os três adiantamentos são históricos distintos', () => {
    expect(classificarRubricaDestino('ADIANTAMENTO DE SALARIO', 'DESCONTOS')?.id).toBe('ADIANTAMENTO_SALARIO');
    expect(classificarRubricaDestino('937 - ADIANTAMENTO DE FERIAS', 'DESCONTOS')?.id).toBe('ADIANTAMENTO_FERIAS');
    expect(classificarRubricaDestino('ADIANTAMENTO 13 SALARIO', 'DESCONTOS')?.id).toBe('ADIANTAMENTO_13');
  });

  it('FGTS de rescisão continua no histórico do FGTS (a obrigação é a mesma)', () => {
    expect(classificarRubricaDestino('123 - F.G.T.S DE RESCISAO', 'INFORMATIVA')?.id).toBe('FGTS');
    expect(classificarRubricaDestino('135 - FGTS 13o SALARIO RESCISAO', 'INFORMATIVA')?.id).toBe('FGTS');
  });

  it('cada contrato de consignado cai no mesmo histórico', () => {
    const contratos = [
      '360 - DESC. EMP. CRED. TRAB Nº 0000001054844453',
      '362 - DESC. EMP. CRED. TRAB Nº 0000001079740603',
      '369 - DESC. EMP. CRED. TRAB Nº 3804807',
      '371 - DESC. EMP. CRED. TRAB Nº 0000001216759393',
    ].map((d) => classificarRubricaDestino(d, 'DESCONTOS')?.id);

    expect(new Set(contratos)).toEqual(new Set(['CONSIGNADO']));
  });

  it('as 26 rubricas do Resumo Mensal viram um punhado de históricos', () => {
    const destinos = agruparRubricasPorDestino(
      RUBRICAS_RELATORIO.map(([descricao, tipo]) => ({ descricao, tipo })),
    );

    // O ganho concreto: 26 rubricas do relatório viram 9 históricos a cadastrar. Não é o
    // mínimo possível de propósito — INSS de férias, INSS de rescisão, verbas rescisórias e
    // os adiantamentos ficam separados porque debitam contas diferentes.
    expect(destinos.length).toBe(10);
    expect(destinos.length).toBeLessThan(RUBRICAS_RELATORIO.length / 2);

    const remuneracao = destinos.find((d) => d.destino.id === 'REMUNERACAO');
    expect(remuneracao?.rubricas).toHaveLength(4);
    expect(destinos.find((d) => d.destino.id === 'GRATIFICACOES_PREMIOS')?.rubricas).toHaveLength(3);

    const ids = destinos.map((d) => d.destino.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'REMUNERACAO',
        'GRATIFICACOES_PREMIOS',
        'FERIAS',
        'RESCISAO',
        'INSS_RETIDO',
        'INSS_FERIAS',
        'INSS_RESCISAO',
        'ADIANTAMENTO_FERIAS',
        'CONSIGNADO',
        'FGTS',
      ]),
    );
  });

  it('todo grupo pertence a exatamente um destino', () => {
    for (const grupo of FOLHA_GRUPOS) {
      expect(destinoDoGrupo(grupo.id), `grupo ${grupo.id} sem destino`).toBeDefined();
    }
    const todos = FOLHA_DESTINOS.flatMap((d) => d.grupos);
    expect(new Set(todos).size).toBe(todos.length);
  });
});
