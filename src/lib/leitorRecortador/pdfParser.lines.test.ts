import { describe, it, expect } from 'vitest';
import { pdfTextItemsToLines } from './pdfLines';
import type { PDFTextItem } from './types';

function item(text: string, x: number, y: number): PDFTextItem {
  return { text, x, y, width: text.length * 6, height: 12 };
}

describe('pdfTextItemsToLines', () => {
  it('agrupa textItems na mesma linha (Y parecido) e ordena por X', () => {
    // Simula "18 24/04/2026 45 1 39 10 ADOXY" — pdf.js entrega cada palavra/número como um
    // item separado, fora de ordem de inserção, cada um com sua própria posição X/Y.
    const items: PDFTextItem[] = [
      item('45', 90, 100),
      item('18', 10, 100),
      item('ADOXY', 160, 101),
      item('24/04/2026', 30, 99),
      item('1', 110, 100),
      item('39', 125, 100),
      item('10', 140, 100),
    ];

    const lines = pdfTextItemsToLines(items);
    expect(lines.length).toBe(1);
    expect(lines[0]).toBe('18 24/04/2026 45 1 39 10 ADOXY');
  });

  it('separa em linhas diferentes quando o Y muda além da tolerância', () => {
    const items: PDFTextItem[] = [
      item('linha1-a', 10, 100),
      item('linha1-b', 50, 101),
      item('linha2-a', 10, 130),
      item('linha2-b', 50, 131),
    ];

    const lines = pdfTextItemsToLines(items);
    expect(lines).toEqual(['linha1-a linha1-b', 'linha2-a linha2-b']);
  });

  it('reconstrói várias linhas de uma tabela fora de ordem de leitura', () => {
    const items: PDFTextItem[] = [
      // linha 2 aparece primeiro no array (pdf.js não garante ordem de leitura)
      item('20.360,00', 200, 200),
      item('19', 10, 200),
      item('TOKARSKI', 160, 200),
      // linha 1
      item('17.000,00', 200, 100),
      item('18', 10, 100),
      item('ADOXY', 160, 100),
    ];

    const lines = pdfTextItemsToLines(items);
    expect(lines).toEqual(['18 ADOXY 17.000,00', '19 TOKARSKI 20.360,00']);
  });

  it('retorna array vazio para lista vazia', () => {
    expect(pdfTextItemsToLines([])).toEqual([]);
  });
});
