import type { PDFTextItem } from './types';

/**
 * Reconstrói as linhas de uma página a partir dos textItems do pdf.js. Cada textItem é um
 * fragmento posicionado por X/Y, sem quebra de linha própria — juntar tudo com `.join(' ')`
 * sem agrupar por linha transforma a página inteira numa única string gigante, o que quebra
 * qualquer parser que dependa de "uma linha por lançamento" (ex.: relatórios do Domínio).
 * Agrupa por Y (mesma linha visual, dentro de uma tolerância) e ordena por X dentro da linha.
 *
 * Função pura, sem dependência de pdfjs-dist — fica em módulo separado de pdfParser.ts para
 * poder ser testada em Node sem precisar de DOMMatrix/canvas (que só existem no navegador).
 */
export function pdfTextItemsToLines(items: PDFTextItem[], yTolerance = 4): string[] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: PDFTextItem[][] = [[sorted[0]!]];
  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i]!;
    const currentLine = lines[lines.length - 1]!;
    const refY = currentLine[0]!.y;
    if (Math.abs(item.y - refY) <= yTolerance) {
      currentLine.push(item);
    } else {
      lines.push([item]);
    }
  }
  return lines.map((line) =>
    [...line]
      .sort((a, b) => a.x - b.x)
      .map((i) => i.text)
      .join(' '),
  );
}
