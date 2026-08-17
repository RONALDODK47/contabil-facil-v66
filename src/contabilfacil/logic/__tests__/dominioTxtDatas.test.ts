import { describe, expect, it } from 'vitest';
import { brDateToIso, buildTxtPlusFromExtratoRows, type ExtratoExportRow } from '../dominioTxtIO';

const anoAtual = new Date().getFullYear();

const row = (date: string): ExtratoExportRow => ({
  date,
  description: 'PIX RECEBIDO CLIENTE',
  value: 79.21,
  nature: 'C',
  accountDebit: '8',
  accountCredit: '1054',
});

describe('brDateToIso — datas do TXT+ Domínio', () => {
  it('aceita BR completa e ISO (com ou sem hora)', () => {
    expect(brDateToIso(`04/05/${anoAtual}`)).toBe(`${anoAtual}-05-04`);
    expect(brDateToIso(`4-5-${anoAtual}`)).toBe(`${anoAtual}-05-04`);
    expect(brDateToIso(`${anoAtual}-05-04`)).toBe(`${anoAtual}-05-04`);
    expect(brDateToIso(`${anoAtual}-05-04T10:30:00Z`)).toBe(`${anoAtual}-05-04`);
    expect(brDateToIso(`04/05/${String(anoAtual).slice(2)}`)).toBe(`${anoAtual}-05-04`);
  });

  it('rejeita ano implausível em vez de exportar 2002', () => {
    expect(brDateToIso('04/05/02')).toBe('');
    expect(brDateToIso('04/05/1899')).toBe('');
  });

  it('rejeita data sem ano, data inválida e texto solto', () => {
    expect(brDateToIso('04/05')).toBe('');
    expect(brDateToIso(`31/02/${anoAtual}`)).toBe('');
    expect(brDateToIso('PIX RECEBIDO 03/05 21:12')).toBe('');
    expect(brDateToIso('')).toBe('');
  });
});

describe('buildTxtPlusFromExtratoRows — data', () => {
  it('exporta a data exatamente como veio na linha', () => {
    const [linha] = buildTxtPlusFromExtratoRows([row(`04/05/${anoAtual}`)], '8').split('\r\n');
    expect(linha.split(';')[0]).toBe(`04/05/${anoAtual}`);
  });

  it('descarta a linha com data ilegível em vez de inventar uma data', () => {
    expect(buildTxtPlusFromExtratoRows([row('04/05/02'), row('04/05')], '8')).toBe('');
  });
});
