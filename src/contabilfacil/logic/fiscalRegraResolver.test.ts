import { describe, it, expect } from 'vitest';
import { resolverRegraFiscalParaInvoice } from './fiscalRegraResolver';
import type { FiscalAcumuladorRegra } from './fiscalAcumuladorRegrasStorage';
import type { SpedInvoice } from '../components/fiscal/types';

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

function regraCfop(over: Partial<FiscalAcumuladorRegra> = {}): FiscalAcumuladorRegra {
  return {
    id: 'regra-cfop',
    nome: 'CFOP 2933',
    descricao: 'CFOP 2933',
    nature: 'D',
    contaContrapartida: '3.1.01',
    contaDebito: '3.1.01',
    contaCredito: '2.1.01',
    ...over,
  };
}

function regraFornecedor(over: Partial<FiscalAcumuladorRegra> = {}): FiscalAcumuladorRegra {
  return {
    id: 'regra-fornecedor',
    nome: 'ADOXY',
    descricao: 'ADOXY COMERCIO E SERVICOS LTDA',
    nature: 'D',
    contaContrapartida: '3.1.02',
    contaDebito: '3.1.02',
    contaCredito: '2.1.02',
    ...over,
  };
}

describe('resolverRegraFiscalParaInvoice', () => {
  it('usa a regra de CFOP quando não há regra específica para o fornecedor', () => {
    const regra = resolverRegraFiscalParaInvoice(invoice({}), [regraCfop()]);
    expect(regra?.id).toBe('regra-cfop');
  });

  it('uma regra específica (fornecedor) sempre vence a regra genérica de CFOP, mesmo com texto mais curto', () => {
    // Descrição da regra específica ("ADOXY...") é mais longa que "CFOP 2933" aqui, mas o
    // ponto do teste é que a prioridade NÃO depende do tamanho do texto — é estrutural.
    const inv = invoice({});
    const regra = resolverRegraFiscalParaInvoice(inv, [regraCfop(), regraFornecedor()]);
    expect(regra?.id).toBe('regra-fornecedor');
  });

  it('regra específica vence mesmo quando o texto dela é mais curto que o da regra de CFOP', () => {
    const inv = invoice({ participantName: 'ABC' }); // nome curtíssimo
    const regras: FiscalAcumuladorRegra[] = [
      regraCfop(), // "CFOP 2933" — 9 caracteres, mais longo que "ABC"
      regraFornecedor({ descricao: 'ABC', id: 'regra-abc' }),
    ];
    const regra = resolverRegraFiscalParaInvoice(inv, regras);
    expect(regra?.id).toBe('regra-abc');
  });

  it('uma NF com reconciliação separada não é puxada para a regra de CFOP de outra NF do mesmo CFOP', () => {
    const notaComRegraPropria = invoice({ id: 'inv-1', participantName: 'ADOXY COMERCIO E SERVICOS LTDA', cfop: '2933' });
    const notaSemRegraPropria = invoice({ id: 'inv-2', participantName: 'TOKARSKI COMERCIO INDUSTRIA LTDA', cfop: '2933' });
    const regras = [regraCfop(), regraFornecedor()];

    expect(resolverRegraFiscalParaInvoice(notaComRegraPropria, regras)?.id).toBe('regra-fornecedor');
    expect(resolverRegraFiscalParaInvoice(notaSemRegraPropria, regras)?.id).toBe('regra-cfop');
  });

  it('não resolve nenhuma regra quando nada bate', () => {
    const regra = resolverRegraFiscalParaInvoice(invoice({ participantName: 'OUTRA EMPRESA', cfop: '9999' }), [
      regraCfop(),
      regraFornecedor(),
    ]);
    expect(regra).toBeNull();
  });

  it('também casa por descrição (usado pelas regras de tipo de imposto, ex.: PIS/COFINS)', () => {
    const impostoInv = invoice({
      participantName: 'Resumo de Impostos — Domínio',
      description: 'PIS · Apuração 01/2026 (Domínio)',
      cfop: undefined,
    });
    const regraPis = regraFornecedor({ id: 'regra-pis', descricao: 'PIS' });
    const regra = resolverRegraFiscalParaInvoice(impostoInv, [regraCfop(), regraPis]);
    expect(regra?.id).toBe('regra-pis');
  });
});
