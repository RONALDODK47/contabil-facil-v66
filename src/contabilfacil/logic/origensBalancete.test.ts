import { describe, expect, it } from 'vitest';
import {
  origemDaLinhaBalancete,
  removerOrigemDoBalancete,
  resumirOrigensDoBalancete,
} from './origensBalancete';
import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';

function linha(patch: Partial<VisionBalanceteRow>): VisionBalanceteRow {
  return {
    codigo: '187',
    nome: 'LANCAMENTO',
    data: '31/01/2026',
    debito: 100,
    credito: 0,
    saldoInicial: 0,
    saldoFinal: 0,
    tipo: 'A',
    ...patch,
  };
}

/**
 * Cada aba grava a marca num campo diferente, porque foram escritas em épocas diferentes:
 * a Folha e a conciliação usam `importId`, as demais usam `classificacao`.
 */
const AMOSTRA: VisionBalanceteRow[] = [
  linha({ importId: 'FOLHA-REGRA', data: '31/01/2026' }),
  linha({ importId: 'FOLHA-REGRA', data: '28/02/2026', debito: 0, credito: 100 }),
  linha({ importId: 'extrato-conc:abc', data: '15/02/2026' }),
  linha({ isReconciliation: true, data: '20/02/2026' }),
  linha({ classificacao: 'FISCAL-AUTO · nota 1', data: '10/03/2026' }),
  linha({ classificacao: 'SPED-FISC · reg C100', data: '10/03/2026' }),
  linha({ classificacao: 'EMPRESTIMO-AUTO · contrato 7', data: '05/04/2026' }),
  linha({ classificacao: 'HONOR-AUTO · mensal', data: '05/04/2026' }),
  linha({ classificacao: 'APLICACAO-AUTO · cdb', data: '05/04/2026' }),
  linha({ classificacao: 'PARCELAMENTO-AUTO · pgfn', data: '05/04/2026' }),
  linha({ importId: 'zeramento-2026-12-31', data: '31/12/2026' }),
  linha({ importId: 'custo-auto-receita-2026-01_2026-01', data: '31/01/2026' }),
  // Sem marca: digitado à mão ou vindo de TXT/PDF, que já tem entrada própria na lista
  linha({ classificacao: '2.1.3.01.00001', importId: 'import-1755' }),
  linha({ classificacao: '2.1.3.01.00001' }),
];

describe('origemDaLinhaBalancete', () => {
  it('reconhece a marca no importId', () => {
    expect(origemDaLinhaBalancete(linha({ importId: 'FOLHA-REGRA' }))).toBe('FOLHA');
    expect(origemDaLinhaBalancete(linha({ importId: 'extrato-conc:x' }))).toBe('CONCILIACAO');
    expect(origemDaLinhaBalancete(linha({ importId: 'zeramento-2026-12-31' }))).toBe('ZERAMENTO');
    expect(origemDaLinhaBalancete(linha({ importId: 'custo-auto-receita-x' }))).toBe('CUSTO_FATURAMENTO');
  });

  it('reconhece a marca na classificação', () => {
    expect(origemDaLinhaBalancete(linha({ classificacao: 'FISCAL-AUTO · x' }))).toBe('FISCAL');
    expect(origemDaLinhaBalancete(linha({ classificacao: 'SPED-FISC · x' }))).toBe('FISCAL_SPED');
    expect(origemDaLinhaBalancete(linha({ classificacao: 'HONOR-AUTO · x' }))).toBe('HONORARIOS');
    expect(origemDaLinhaBalancete(linha({ classificacao: 'EMPRESTIMO-AUTO · x' }))).toBe('EMPRESTIMO');
    expect(origemDaLinhaBalancete(linha({ classificacao: 'PARCELAMENTO-AUTO · x' }))).toBe('PARCELAMENTO');
    expect(origemDaLinhaBalancete(linha({ classificacao: 'APLICACAO-AUTO · x' }))).toBe('APLICACAO');
  });

  it('reconhece a folha publicada pelo caminho legado', () => {
    expect(origemDaLinhaBalancete(linha({ classificacao: 'FOLHA-AUTO · SALARIO · 1' }))).toBe('FOLHA');
  });

  it('conciliação antiga, sem importId, é reconhecida pelo sinalizador da linha', () => {
    expect(origemDaLinhaBalancete(linha({ isReconciliation: true }))).toBe('CONCILIACAO');
  });

  it('não confunde a classificação contábil com marca de origem', () => {
    expect(origemDaLinhaBalancete(linha({ classificacao: '2.1.3.01.00001' }))).toBeNull();
    expect(origemDaLinhaBalancete(linha({ classificacao: '3.2.1.01.00003' }))).toBeNull();
  });

  it('linha de TXT/PDF importado não vira origem de aba — já tem entrada própria', () => {
    expect(origemDaLinhaBalancete(linha({ importId: 'import-1755624441' }))).toBeNull();
  });
});

describe('resumirOrigensDoBalancete', () => {
  const resumo = resumirOrigensDoBalancete(AMOSTRA);

  it('lista todas as abas que publicaram, e só elas', () => {
    expect(resumo.map((r) => r.origem.id)).toEqual([
      'FOLHA',
      'CONCILIACAO',
      'FISCAL',
      'FISCAL_SPED',
      'HONORARIOS',
      'EMPRESTIMO',
      'PARCELAMENTO',
      'APLICACAO',
      'CUSTO_FATURAMENTO',
      'ZERAMENTO',
    ]);
  });

  it('conta as linhas de cada origem', () => {
    expect(resumo.find((r) => r.origem.id === 'FOLHA')?.linhas).toBe(2);
    expect(resumo.find((r) => r.origem.id === 'CONCILIACAO')?.linhas).toBe(2);
  });

  it('lista as competências em ordem cronológica', () => {
    expect(resumo.find((r) => r.origem.id === 'FOLHA')?.meses).toEqual(['01/2026', '02/2026']);
  });

  it('não inventa origem para razão sem automação', () => {
    const semMarca = [linha({ classificacao: '1.1.1.01.00001' })];
    expect(resumirOrigensDoBalancete(semMarca)).toEqual([]);
  });
});

describe('removerOrigemDoBalancete', () => {
  it('tira só a origem escolhida', () => {
    const semFolha = removerOrigemDoBalancete(AMOSTRA, 'FOLHA');

    expect(semFolha).toHaveLength(AMOSTRA.length - 2);
    expect(semFolha.some((r) => origemDaLinhaBalancete(r) === 'FOLHA')).toBe(false);
    // As demais continuam
    expect(semFolha.some((r) => origemDaLinhaBalancete(r) === 'CONCILIACAO')).toBe(true);
    expect(semFolha.some((r) => origemDaLinhaBalancete(r) === 'FISCAL')).toBe(true);
  });

  it('preserva o que não veio de automação', () => {
    const semConciliacao = removerOrigemDoBalancete(AMOSTRA, 'CONCILIACAO');
    const semMarca = semConciliacao.filter((r) => origemDaLinhaBalancete(r) === null);

    expect(semMarca).toHaveLength(2);
  });

  it('remover fiscal não leva junto o SPED, que é outra origem', () => {
    const semFiscal = removerOrigemDoBalancete(AMOSTRA, 'FISCAL');

    expect(semFiscal.some((r) => origemDaLinhaBalancete(r) === 'FISCAL')).toBe(false);
    expect(semFiscal.some((r) => origemDaLinhaBalancete(r) === 'FISCAL_SPED')).toBe(true);
  });
});
