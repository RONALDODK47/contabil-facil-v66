/**
 * Provisão: liberar em lote, compensar no mês seguinte e criar aplicação nova
 * sem herdar lançamento de outra.
 */
import { describe, it, expect } from 'vitest';
import {
  buildAplicacaoLancamentoContabil,
  buildCompensacaoProvisao,
  comCompensacoesDeProvisao,
  primeiroDiaDoMesSeguinte,
} from '../aplicacaoExtratoLancamentos';
import {
  loadAplicacaoContasExtrato,
  upsertAplicacaoContaExtrato,
} from '../aplicacaoExtratoStorage';
import type { AplicacaoContaExtrato } from '../aplicacaoExtratoStorage';
import type { AplicacaoExtratoRow } from '../aplicacaoExtratoParser';

const provisoes: AplicacaoExtratoRow[] = [
  { data: '31/07/2026', historico: 'RENDIMENTOS PROVISIONADOS', entrada: 379.09, saida: 0, saldo: null, provisionado: true },
  { data: '31/07/2026', historico: 'PROVISÃO IRRF', entrada: 0, saida: 67.25, saldo: null, provisionado: true },
  { data: '31/07/2026', historico: 'PROVISÃO IOF', entrada: 0, saida: 79.88, saldo: null, provisionado: true },
];
const conta = (over: Partial<AplicacaoContaExtrato> = {}) =>
  ({ id: 'c', nome: 'SICREDINVEST', contaContabil: '1051', rows: provisoes, ...over }) as AplicacaoContaExtrato;

describe('primeiro dia do mês seguinte', () => {
  it('vira o mês e o ano', () => {
    expect(primeiroDiaDoMesSeguinte('31/07/2026')).toBe('01/08/2026');
    expect(primeiroDiaDoMesSeguinte('30/06/2026')).toBe('01/07/2026');
    expect(primeiroDiaDoMesSeguinte('31/12/2026')).toBe('01/01/2027');
  });
  it('recusa data inválida em vez de inventar', () => {
    expect(primeiroDiaDoMesSeguinte('')).toBe('');
    expect(primeiroDiaDoMesSeguinte('07/2026')).toBe('');
  });
});

describe('compensação zera a provisão no mês seguinte', () => {
  it('inverte o lado, mantendo o valor', () => {
    const estorno = buildCompensacaoProvisao({ ...provisoes[0], desbloqueado: true })!;
    expect(estorno.data).toBe('01/08/2026');
    expect(estorno.historico).toBe('COMPENSACAO RENDIMENTOS PROVISIONADOS');
    expect(estorno.entrada).toBe(0);
    expect(estorno.saida).toBeCloseTo(379.09, 2);
  });

  it('provisão bloqueada não gera estorno — nunca foi lançada', () => {
    expect(buildCompensacaoProvisao(provisoes[0])).toBeNull();
  });

  it('somando provisão + estorno, o efeito no período é zero', () => {
    const liberadas = provisoes.map((r) => ({ ...r, desbloqueado: true }));
    const c = conta({ rows: liberadas, compensarProvisao: true });
    const todas = comCompensacoesDeProvisao(c);
    expect(todas).toHaveLength(6);
    const saldo = todas
      .map((r) => buildAplicacaoLancamentoContabil(r, c, []))
      .filter((l) => l.contabiliza)
      .reduce((s, l) => s + (l.nature === 'D' ? l.valor : -l.valor), 0);
    expect(saldo).toBeCloseTo(0, 2);
  });

  it('sem a opção ligada, nenhum estorno é criado', () => {
    const liberadas = provisoes.map((r) => ({ ...r, desbloqueado: true }));
    expect(comCompensacoesDeProvisao(conta({ rows: liberadas }))).toHaveLength(3);
  });
});

describe('desbloqueio em lote', () => {
  const alternar = (rows: AplicacaoExtratoRow[]) => {
    const bloqueadas = rows.some((r) => r.provisionado && !r.desbloqueado);
    return rows.map((r) => (r.provisionado ? { ...r, desbloqueado: bloqueadas } : r));
  };
  it('libera todas de uma vez e depois bloqueia todas', () => {
    const liberadas = alternar(provisoes);
    expect(liberadas.every((r) => r.desbloqueado)).toBe(true);
    expect(alternar(liberadas).every((r) => !r.desbloqueado)).toBe(true);
  });
});

describe('criar aplicação nova não herda lançamentos', () => {
  it('mesmo nome gera pasta separada e vazia', () => {
    const CIA = '__teste_nova_aplicacao__';
    upsertAplicacaoContaExtrato(CIA, { id: 'antiga', nome: 'SICREDINVEST', contaContabil: '1051', rows: provisoes });
    // o que o botão CRIAR faz agora: id próprio e rows vazio
    upsertAplicacaoContaExtrato(CIA, { id: 'nova', nome: 'SICREDINVEST', contaContabil: '1051', rows: [] });

    const todas = loadAplicacaoContasExtrato(CIA);
    expect(todas).toHaveLength(2);
    expect(todas.find((c) => c.id === 'antiga')!.rows).toHaveLength(3);
    expect(todas.find((c) => c.id === 'nova')!.rows).toHaveLength(0);
  });
});
