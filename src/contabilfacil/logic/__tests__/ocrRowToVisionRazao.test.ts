import { describe, expect, it } from 'vitest';
import { ocrRowToVisionRazao } from '../contabilPipeline';

describe('ocrRowToVisionRazao — importação de saldo por conta (PDF Balancete)', () => {
  it('mantém uma conta cujo saldo anterior é exatamente zero (0,00 sem D/C)', () => {
    const row = ocrRowToVisionRazao(
      {
        codigo: '70',
        classificacao: '1.2.1.01',
        descricao: 'CRÉDITOS COM PARTES RELACIONADAS - PESSOA FÍSICA',
        valorDc: '0,00',
      },
      0,
    );
    expect(row).not.toBeNull();
    expect(row?.nome).toBe('CRÉDITOS COM PARTES RELACIONADAS - PESSOA FÍSICA');
  });

  it('mantém uma conta com saldo final não-zero via valorDc', () => {
    const row = ocrRowToVisionRazao(
      {
        codigo: '4',
        classificacao: '1.1.1.01',
        descricao: 'CAIXA',
        valorDc: '3.998,10D',
      },
      0,
    );
    expect(row).not.toBeNull();
    // valorDc → saldoFinal
    expect(row?.saldoFinal).toBeCloseTo(3998.1, 2);
    expect(row?.naturezaSaldoFinal).toBe('D');
  });

  it('importa as 4 colunas do balancete: saldoAnterior + debito + credito + valorDc (saldoFinal)', () => {
    const row = ocrRowToVisionRazao(
      {
        codigo: '5',
        classificacao: '1.1.1.02',
        descricao: 'BANCO DO BRASIL',
        saldoAnterior: '92.430,36D',
        debito: '2.128,03',
        credito: '36.685,77',
        valorDc: '57.872,62D',
      },
      0,
    );
    expect(row).not.toBeNull();
    expect(row?.saldoInicial).toBeCloseTo(92430.36, 2);
    expect(row?.naturezaSaldoInicial).toBe('D');
    expect(row?.debito).toBeCloseTo(2128.03, 2);
    expect(row?.credito).toBeCloseTo(36685.77, 2);
    expect(row?.saldoFinal).toBeCloseTo(57872.62, 2);
    expect(row?.naturezaSaldoFinal).toBe('D');
  });

  it('importa saldo anterior credor (C) corretamente', () => {
    const row = ocrRowToVisionRazao(
      {
        codigo: '266',
        classificacao: '2.3.3.01.00001',
        descricao: 'LUCROS ACUMULADOS',
        saldoAnterior: '922.715,71C',
        debito: '0,00',
        credito: '506.401,70',
        valorDc: '1.429.117,41C',
      },
      0,
    );
    expect(row).not.toBeNull();
    expect(row?.saldoInicial).toBeCloseTo(922715.71, 2);
    expect(row?.naturezaSaldoInicial).toBe('C');
    expect(row?.saldoFinal).toBeCloseTo(1429117.41, 2);
    expect(row?.naturezaSaldoFinal).toBe('C');
  });

  it('descarta uma linha de ruído do OCR sem código nem valor de saldo', () => {
    const row = ocrRowToVisionRazao(
      {
        codigo: '',
        classificacao: '',
        descricao: 'Sistema licenciado para INOV CONSULTORIA',
        valorDc: '',
      },
      0,
    );
    expect(row).toBeNull();
  });

  it('descarta uma linha com código válido mas sem coluna de saldo preenchida', () => {
    const row = ocrRowToVisionRazao(
      {
        codigo: '111',
        classificacao: '1.2.4',
        descricao: '',
        valorDc: '',
      },
      0,
    );
    expect(row).toBeNull();
  });
});
