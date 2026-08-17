import { describe, it, expect } from 'vitest';
import { parseSpedFile } from './spedParser';

/**
 * Linha C100 no layout oficial do Guia Prático EFD (Bloco C):
 * REG|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|NUM_DOC|CHV_NFE|DT_DOC|DT_E_S|VL_DOC|IND_PGTO|VL_DESC|VL_ABAT_NT|VL_MERC|IND_FRT|VL_FRT|VL_SEG|VL_OUT_DA|VL_BC_ICMS|VL_ICMS|VL_BC_ICMS_ST|VL_ICMS_ST|VL_IPI|VL_PIS|VL_COFINS|VL_PIS_ST|VL_COFINS_ST
 */
function buildC100Line(opts: {
  indOper: '0' | '1';
  codPart: string;
  numDoc: string;
  dtDoc: string; // ddMMyyyy
  vlDoc: string;
  vlIcms: string;
  vlPis: string;
  vlCofins: string;
}): string {
  const chave = '3'.repeat(44);
  return [
    '',
    'C100',
    opts.indOper,
    '0', // IND_EMIT
    opts.codPart,
    '55',
    '00',
    '1',
    opts.numDoc,
    chave,
    opts.dtDoc,
    opts.dtDoc,
    opts.vlDoc,
    '0',
    '0,00',
    '0,00',
    opts.vlDoc,
    '0',
    '0,00',
    '0,00',
    '0,00',
    '0,00',
    opts.vlIcms,
    '0,00',
    '0,00',
    '0,00',
    opts.vlPis,
    opts.vlCofins,
    '0,00',
    '0,00',
    '',
  ].join('|');
}

describe('parseSpedFile — C100 (mercadorias / NF-e)', () => {
  it('lê corretamente uma nota de ENTRADA (IND_OPER=0): número, data, valor, participante e impostos', () => {
    const linha0150 = '|0150|001|FORNECEDOR TESTE LTDA|...|';
    const linhaC100 = buildC100Line({
      indOper: '0',
      codPart: '001',
      numDoc: '123456',
      dtDoc: '15012026',
      vlDoc: '1.000,00',
      vlIcms: '90,00',
      vlPis: '10,00',
      vlCofins: '5,00',
    });
    const content = [linha0150, linhaC100].join('\n');

    const { invoices } = parseSpedFile(content);

    expect(invoices.length).toBe(1);
    const nota = invoices[0]!;
    expect(nota.type).toBe('entrada');
    expect(nota.documentNumber).toBe('123456');
    expect(nota.date).toBe('2026-01-15');
    expect(nota.value).toBe(-1000); // entrada = valor negativo
    expect(nota.participantName).toBe('FORNECEDOR TESTE LTDA');
    expect(nota.icms).toBe(90);
    expect(nota.pis).toBe(10);
    expect(nota.cofins).toBe(5);
  });

  it('lê corretamente uma nota de SAÍDA (IND_OPER=1)', () => {
    const linha0150 = '|0150|002|CLIENTE TESTE LTDA|...|';
    const linhaC100 = buildC100Line({
      indOper: '1',
      codPart: '002',
      numDoc: '654321',
      dtDoc: '20012026',
      vlDoc: '2.500,50',
      vlIcms: '200,00',
      vlPis: '25,00',
      vlCofins: '15,00',
    });
    const content = [linha0150, linhaC100].join('\n');

    const { invoices } = parseSpedFile(content);

    expect(invoices.length).toBe(1);
    const nota = invoices[0]!;
    expect(nota.type).toBe('saida');
    expect(nota.documentNumber).toBe('654321');
    expect(nota.date).toBe('2026-01-20');
    expect(nota.value).toBe(2500.5);
    expect(nota.participantName).toBe('CLIENTE TESTE LTDA');
    expect(nota.icms).toBe(200);
    expect(nota.pis).toBe(25);
    expect(nota.cofins).toBe(15);
  });

  it('reconhece entradas e saídas juntas no mesmo arquivo', () => {
    const content = [
      '|0150|001|FORNECEDOR TESTE LTDA|...|',
      '|0150|002|CLIENTE TESTE LTDA|...|',
      buildC100Line({
        indOper: '0',
        codPart: '001',
        numDoc: '1',
        dtDoc: '01012026',
        vlDoc: '100,00',
        vlIcms: '0,00',
        vlPis: '0,00',
        vlCofins: '0,00',
      }),
      buildC100Line({
        indOper: '1',
        codPart: '002',
        numDoc: '2',
        dtDoc: '02012026',
        vlDoc: '200,00',
        vlIcms: '0,00',
        vlPis: '0,00',
        vlCofins: '0,00',
      }),
      buildC100Line({
        indOper: '0',
        codPart: '001',
        numDoc: '3',
        dtDoc: '03012026',
        vlDoc: '300,00',
        vlIcms: '0,00',
        vlPis: '0,00',
        vlCofins: '0,00',
      }),
    ].join('\n');

    const { invoices } = parseSpedFile(content);

    expect(invoices.length).toBe(3);
    expect(invoices.filter((i) => i.type === 'entrada').length).toBe(2);
    expect(invoices.filter((i) => i.type === 'saida').length).toBe(1);
  });
});
