import { describe, expect, it } from 'vitest';
import { competenciaToYearMonth, parseDominioResumoImpostosRows } from '../dominioResumoImpostosParser';

/** Linhas simuladas como o pdfFileToRows extrairia do relatório real do Domínio (uma célula por coluna). */
const ROWS: string[][] = [
  ['RESUMO DOS IMPOSTOS LANÇADOS'],
  ['Competência:', '01/2026'],
  ['ISS', '0,00', '0,00', '373,50', '0,00', '0,00', '0,00', '373,50', '0,00', '0,00'],
  ['Total competência:', '373,50', '0,00', '0,00'],
  ['Competência:', '02/2026'],
  ['ISS', '0,00', '0,00', '446,93', '0,00', '0,00', '0,00', '446,93', '0,00', '0,00'],
  ['RESUMO DOS IMPOSTOS CALCULADOS'],
  ['Competência:', '01/2026'],
  ['PIS', '120,34', '0,00', '0,00'],
  ['COFINS', '555,42', '0,00', '0,00'],
  ['Competência:', '03/2026'],
  ['PIS', '240,03', '0,00', '0,00'],
  ['COFINS', '1.107,83', '0,00', '0,00'],
  ['CSLL', '9.321,10', '9,00', '838,90', '0,00', '0,00', '0,00', '0,00', '838,90', '0,00', '0,00'],
  ['IRPJ', '6.214,07', '15,00', '932,11', '0,00', '0,00', '0,00', '0,00', '932,11', '0,00', '0,00'],
];

describe('parseDominioResumoImpostosRows', () => {
  it('extrai o valor de "imposto a recolher" de cada tributo, independente da largura da linha', () => {
    const parsed = parseDominioResumoImpostosRows(ROWS, 'resumo.pdf');
    expect(parsed.issues).toEqual([]);
    expect(parsed.itens).toEqual([
      { competencia: '01/2026', imposto: 'ISS', valor: 373.5 },
      { competencia: '02/2026', imposto: 'ISS', valor: 446.93 },
      { competencia: '01/2026', imposto: 'PIS', valor: 120.34 },
      { competencia: '01/2026', imposto: 'COFINS', valor: 555.42 },
      { competencia: '03/2026', imposto: 'PIS', valor: 240.03 },
      { competencia: '03/2026', imposto: 'COFINS', valor: 1107.83 },
      { competencia: '03/2026', imposto: 'CSLL', valor: 838.9 },
      { competencia: '03/2026', imposto: 'IRPJ', valor: 932.11 },
    ]);
  });

  it('não reconhece arquivo sem o cabeçalho esperado', () => {
    const parsed = parseDominioResumoImpostosRows([['qualquer coisa']], 'x.pdf');
    expect(parsed.itens).toEqual([]);
    expect(parsed.issues.length).toBeGreaterThan(0);
  });
});

describe('competenciaToYearMonth', () => {
  it('converte MM/AAAA em AAAA-MM', () => {
    expect(competenciaToYearMonth('03/2026')).toBe('2026-03');
  });

  it('retorna vazio para texto inválido', () => {
    expect(competenciaToYearMonth('lixo')).toBe('');
  });
});
