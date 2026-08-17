/**
 * Placar da etapa de revisão do BankPdfExtractModal.
 *
 * Regressão coberta: um extrato da CAIXA fechava com diferença de R$ 8,00 porque
 * tarifas de valor pequeno ("TAR PIX" de R$ 0,17 / 0,71 / 7,12) não chegavam à tela.
 * Estes testes garantem que valores pequenos sobrevivem à conversão e que os totais
 * batem (créditos - débitos = 0 num extrato equilibrado).
 */
import { describe, it, expect } from 'vitest';
import {
  recordToGenericOcrRow,
  computeReviewTotals,
  type ExtractRecord,
} from '../BankPdfExtractModal';

function rec(
  data: string,
  historico: string,
  debito: number | null,
  credito: number | null,
): ExtractRecord {
  return {
    data,
    historico,
    valor_debito: debito,
    valor_credito: credito,
    codigo_historico: null,
    complemento: null,
  };
}

function toRows(records: ExtractRecord[]) {
  return records
    .map((r, i) => recordToGenericOcrRow(r, i))
    .filter((r): r is NonNullable<ReturnType<typeof recordToGenericOcrRow>> => r !== null);
}

describe('BankPdfExtractModal — revisão', () => {
  it('mantém tarifas de centavos e fecha o saldo em zero', () => {
    const records = [
      rec('03/07/2026', 'CRED PIX CHAVE', null, 12.0),
      rec('03/07/2026', 'TAR PIX', 7.12, null),
      rec('06/07/2026', 'TAR PIX', 0.17, null),
      rec('08/07/2026', 'TAR PIX', 0.71, null),
      rec('08/07/2026', 'TAR PIX', 4.0, null),
    ];

    const rows = toRows(records);
    expect(rows).toHaveLength(5);

    // Nenhuma tarifa pequena pode ser descartada nem virar crédito.
    const tarifas = rows.filter((r) => r.descricao.includes('TAR PIX'));
    expect(tarifas.map((r) => r.valorDebito)).toEqual(['7,12', '0,17', '0,71', '4,00']);
    expect(tarifas.every((r) => r.natureza === 'D')).toBe(true);

    const totals = computeReviewTotals(rows, 0);
    expect(totals.creditos).toBeCloseTo(12.0, 2);
    expect(totals.debitos).toBeCloseTo(12.0, 2);
    expect(totals.saldoFinal).toBeCloseTo(0, 2);
  });

  it('soma o saldo anterior ao saldo final', () => {
    const rows = toRows([rec('01/07/2026', 'CRED PIX CHAVE', null, 100.0)]);
    expect(computeReviewTotals(rows, 50).saldoFinal).toBeCloseTo(150, 2);
  });

  it('descarta apenas registros sem nenhum valor', () => {
    expect(recordToGenericOcrRow(rec('01/07/2026', 'SALDO DIA', null, null), 0)).toBeNull();
    expect(recordToGenericOcrRow(rec('01/07/2026', 'TAR PIX', 0.01, null), 0)).not.toBeNull();
  });
});
