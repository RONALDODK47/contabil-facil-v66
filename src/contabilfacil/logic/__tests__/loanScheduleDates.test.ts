import { describe, expect, it } from 'vitest';
import { resolveGraceMonths } from '../loanScheduleDates';

describe('resolveGraceMonths', () => {
  it('usa os meses informados no campo "Carência (Meses)"', () => {
    expect(resolveGraceMonths('11')).toBe(11);
    expect(resolveGraceMonths('1')).toBe(1);
  });

  it('sem carência quando o campo de meses está zerado ou vazio', () => {
    expect(resolveGraceMonths('0')).toBe(0);
    expect(resolveGraceMonths('')).toBe(0);
    expect(resolveGraceMonths(undefined as unknown as string)).toBe(0);
  });

  it('NÃO cria carência a partir do campo legado de dias', () => {
    // Contrato legado/importado: meses zerado mas com dias preenchidos. Antes isso virava
    // carência (dias/30), a amortização não começava e o 1º ano ficava sem provisão de curto.
    expect(resolveGraceMonths('0', '330')).toBe(0);
    expect(resolveGraceMonths('', '330')).toBe(0);
    // Qualquer valor legado gerava no mínimo 1 mês de carência pelo Math.max(1, ...).
    expect(resolveGraceMonths('0', '11')).toBe(0);
    expect(resolveGraceMonths('0', '1')).toBe(0);
  });

  it('o campo de meses continua prevalecendo sobre o legado', () => {
    expect(resolveGraceMonths('3', '330')).toBe(3);
  });
});
