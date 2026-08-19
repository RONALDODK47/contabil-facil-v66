import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseFolhaLiquidosRows } from '../folhaLiquidosParser';

/**
 * Verificação contra o PDF real do cliente (pulada quando o caminho não existe).
 * Reproduz a mesma extração de linhas do `pdfClientExtract` (que só roda no
 * navegador) para conferir que o parser lê as 7 competências do arquivo.
 */
const PDF =
  'P:/EMPRESAS/ATIVAS/IMUNE ISENTAS/OBRAS SOCIAIS DO CENTRO ESPIRITA LUZ DA VERDADE/RECORRENTE/2026/CONTABIL/relatorio folha liquido/Relatório de Líquidos.pdf';

type RawItem = { str: string; x: number; y: number; w: number };

function clusterLines(items: RawItem[], yTol: number): RawItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: RawItem[][] = [];
  for (const it of sorted) {
    const line = lines.find((l) => Math.abs(l[0].y - it.y) <= yTol);
    if (line) line.push(it);
    else lines.push([it]);
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => b[0].y - a[0].y);
}

function lineToCells(line: RawItem[], gapTol: number): string[] {
  const cells: string[] = [];
  let buf = line[0].str;
  let prevRight = line[0].x + (line[0].w || 0);
  for (let i = 1; i < line.length; i++) {
    const it = line[i];
    const gap = it.x - prevRight;
    if (gap > gapTol) {
      cells.push(buf.replace(/\s+/g, ' ').trim());
      buf = it.str;
    } else {
      buf += (gap > 0.5 ? ' ' : '') + it.str;
    }
    prevRight = Math.max(prevRight, it.x + (it.w || 0));
  }
  cells.push(buf.replace(/\s+/g, ' ').trim());
  return cells.filter(Boolean);
}

async function rowsFromPdf(path: string): Promise<string[][]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(readFileSync(path));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const rows: string[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items: RawItem[] = [];
    for (const raw of tc.items as Array<Record<string, unknown>>) {
      const str = typeof raw.str === 'string' ? raw.str : '';
      if (!str.trim()) continue;
      const tr = raw.transform as number[] | undefined;
      if (!tr) continue;
      items.push({ str, x: tr[4], y: tr[5], w: typeof raw.width === 'number' ? raw.width : 0 });
    }
    for (const line of clusterLines(items, 4)) rows.push(lineToCells(line, 14));
  }
  return rows;
}

describe.skipIf(!existsSync(PDF))('Relatório de Líquidos — PDF real do cliente', () => {
  it('lê as 7 competências, 15 empregados cada, e fecha com o total impresso', async () => {
    const parsed = parseFolhaLiquidosRows(await rowsFromPdf(PDF), 'Relatório de Líquidos.pdf');

    expect(parsed.competencias.map((c) => c.competencia)).toEqual([
      '01/2026',
      '02/2026',
      '03/2026',
      '04/2026',
      '05/2026',
      '06/2026',
      '07/2026',
    ]);
    for (const comp of parsed.competencias) {
      expect(comp.itens).toHaveLength(15);
    }
    // Nenhuma divergência entre a soma dos líquidos e o "Total da Empresa".
    expect(parsed.issues).toEqual([]);
    expect(parsed.cnpj).toBe('05.988.299/0001-58');

    const jan = parsed.competencias[0];
    expect(jan.total).toBeCloseTo(24209.4, 2);
    const carolline = jan.itens.find((i) => i.nome.startsWith('CAROLLINE'))!;
    expect(carolline.codigo).toBe('17');
    expect(carolline.identidade).toBe('4279500');
    expect(carolline.valor).toBeCloseTo(1671.01, 2);
    // Identidade com sujeira impressa ao lado ("5173938 2 VIA").
    const iolanda = jan.itens.find((i) => i.nome.startsWith('IOLANDA'))!;
    expect(iolanda.identidadeDigitos).toBe('51739382');
  }, 60000);
});
