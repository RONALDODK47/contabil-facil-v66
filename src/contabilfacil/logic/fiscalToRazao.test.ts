import { describe, it, expect } from 'vitest';
import { buildRazaoFromFiscalInvoices, isFiscalRazaoRow, mergeFiscalRazaoComExistente } from './fiscalToRazao';
import type { FiscalAcumuladorRegra } from './fiscalAcumuladorRegrasStorage';
import type { SpedInvoice } from '../components/fiscal/types';
import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';

function invoice(over: Partial<SpedInvoice>): SpedInvoice {
  return {
    id: 'inv-1',
    type: 'entrada',
    date: '2026-04-24',
    description: 'NF Entrada 45',
    value: -17000,
    documentNumber: '45',
    participantName: 'ADOXY COMERCIO E SERVICOS LTDA',
    pis: 0,
    cofins: 0,
    icms: 0,
    source: 'CONTRIBUICOES',
    cfop: '2933',
    ...over,
  };
}

const regraFornecedor: FiscalAcumuladorRegra = {
  id: 'regra-fornecedor',
  nome: 'ADOXY',
  descricao: 'ADOXY COMERCIO E SERVICOS LTDA',
  nature: 'D',
  contaContrapartida: '3.1.02',
  contaDebito: '3.1.02',
  contaCredito: '2.1.02',
};

describe('buildRazaoFromFiscalInvoices', () => {
  it('gera um par débito/crédito para nota com regra completa', () => {
    const { rows, gerados, semRegra } = buildRazaoFromFiscalInvoices([invoice({})], [regraFornecedor]);
    expect(gerados).toBe(1);
    expect(semRegra).toEqual([]);
    expect(rows.length).toBe(2);
    const [debito, credito] = rows;
    expect(debito!.debito).toBe(17000);
    expect(debito!.credito).toBe(0);
    expect(debito!.codigo).toBe('3102');
    expect(credito!.credito).toBe(17000);
    expect(credito!.debito).toBe(0);
    expect(credito!.codigo).toBe('2102');
    expect(rows.every(isFiscalRazaoRow)).toBe(true);
  });

  it('deixa de fora (semRegra) a nota sem regra com débito+crédito completos', () => {
    const regraIncompleta: FiscalAcumuladorRegra = {
      ...regraFornecedor,
      contaCredito: undefined,
    };
    const { rows, gerados, semRegra } = buildRazaoFromFiscalInvoices([invoice({})], [regraIncompleta]);
    expect(gerados).toBe(0);
    expect(rows).toEqual([]);
    expect(semRegra.length).toBe(1);
  });

  it('ignora lançamentos de valor zero', () => {
    const { rows, gerados } = buildRazaoFromFiscalInvoices([invoice({ value: 0 })], [regraFornecedor]);
    expect(gerados).toBe(0);
    expect(rows).toEqual([]);
  });
});

describe('mergeFiscalRazaoComExistente', () => {
  it('substitui só as linhas marcadas FISCAL-AUTO, preservando o resto do razão', () => {
    const existente: VisionBalanceteRow[] = [
      { codigo: '1', nome: 'MANUAL', classificacao: 'OUTRO', ordem: 1, saldoInicial: 0, debito: 10, credito: 0, saldoFinal: 0 },
      { codigo: '2', nome: 'ANTIGO FISCAL', classificacao: 'FISCAL-AUTO · inv-old', ordem: 2, saldoInicial: 0, debito: 5, credito: 0, saldoFinal: 0 },
    ];
    const { rows: novos } = buildRazaoFromFiscalInvoices([invoice({})], [regraFornecedor]);
    const merged = mergeFiscalRazaoComExistente(existente, novos);

    expect(merged.some((r) => r.nome === 'MANUAL')).toBe(true);
    expect(merged.some((r) => r.nome === 'ANTIGO FISCAL')).toBe(false);
    expect(merged.filter((r) => isFiscalRazaoRow(r)).length).toBe(2);
  });

  it('mantém débito e crédito da mesma nota com a MESMA ordem após o merge (contrapartida não pode se perder)', () => {
    const existente: VisionBalanceteRow[] = [
      { codigo: '9', nome: 'MANUAL', classificacao: 'OUTRO', ordem: 5, saldoInicial: 0, debito: 1, credito: 0, saldoFinal: 0 },
    ];
    const { rows: novos } = buildRazaoFromFiscalInvoices(
      [invoice({ id: 'inv-1' }), invoice({ id: 'inv-2', documentNumber: '46' })],
      [regraFornecedor],
    );
    const merged = mergeFiscalRazaoComExistente(existente, novos);
    const fiscalRows = merged.filter(isFiscalRazaoRow);

    expect(fiscalRows.length).toBe(4);
    // Cada partida (débito+crédito) tem que preservar a MESMA ordem entre si —
    // é essa ordem compartilhada que o sistema usa para casar a contrapartida.
    const [d1, c1, d2, c2] = fiscalRows;
    expect(d1!.ordem).toBe(c1!.ordem);
    expect(d2!.ordem).toBe(c2!.ordem);
    // E as duas partidas não podem colidir na mesma ordem entre si.
    expect(d1!.ordem).not.toBe(d2!.ordem);
  });
});
