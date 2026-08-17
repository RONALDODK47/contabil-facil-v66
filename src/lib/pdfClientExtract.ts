/**
 * Extrai linhas/colunas de PDF com texto (camada de texto) no navegador — sem servidor.
 * PDFs somente imagem não têm texto; nesse caso o usuário deve usar Excel ou OCR externo.
 */
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

type RawItem = { str: string; x: number; y: number; w: number };

/** pdfjs-dist 5 typings não exportam TextContent estável aqui — tipagem mínima para getTextContent(). */
function pageToItems(textContent: { items: readonly unknown[] }): RawItem[] {
  const out: RawItem[] = [];
  for (const raw of textContent.items) {
    if (typeof raw !== 'object' || raw === null) continue;
    const it = raw as Record<string, unknown>;
    const str = typeof it.str === 'string' ? it.str : '';
    if (!str.trim()) continue;
    const tr = it.transform;
    if (!Array.isArray(tr) || tr.length < 6) continue;
    const x = typeof tr[4] === 'number' ? tr[4] : Number(tr[4]);
    const y = typeof tr[5] === 'number' ? tr[5] : Number(tr[5]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const w = typeof it.width === 'number' ? it.width : 0;
    out.push({ str, x, y, w });
  }
  return out;
}

/** Agrupa itens na mesma linha visual (tolerância em unidades PDF). */
function clusterLines(items: RawItem[], yTol: number): RawItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: RawItem[][] = [];
  for (const it of sorted) {
    let placed = false;
    for (const line of lines) {
      if (Math.abs(line[0].y - it.y) <= yTol) {
        line.push(it);
        placed = true;
        break;
      }
    }
    if (!placed) lines.push([it]);
  }
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x);
  }
  lines.sort((a, b) => b[0].y - a[0].y);
  return lines;
}

function lineToCells(line: RawItem[], gapTol: number): string[] {
  if (line.length === 0) return [];
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
  return cells.filter((c) => c.length > 0);
}

export type PdfExtractMeta = {
  pages: number;
  linhasTot: number;
  charsApprox: number;
};

export async function pdfFileToRows(file: File, maxRows: number): Promise<{ rows: string[][]; meta: PdfExtractMeta }> {
  const cap = Math.min(Math.max(maxRows || 52000, 500), 52000);
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;

  let charsApprox = 0;
  const rows: string[][] = [];

  for (let pn = 1; pn <= doc.numPages && rows.length < cap; pn++) {
    const page = await doc.getPage(pn);
    const tc = await page.getTextContent();
    const items = pageToItems(tc);
    charsApprox += items.reduce((s, i) => s + i.str.length, 0);
    const lineClusters = clusterLines(items, 4);
    for (const line of lineClusters) {
      let cells = lineToCells(line, 14);
      if (cells.length === 1 && /\s{2,}/.test(cells[0])) {
        cells = cells[0]
          .split(/\s{2,}|\t+/)
          .map((x) => x.trim())
          .filter(Boolean);
      }
      if (cells.length > 0) rows.push(cells);
      if (rows.length >= cap) break;
    }
  }

  if (rows.length === 0 && charsApprox < 50) {
    throw new Error(
      'Não foi possível ler linhas deste PDF (pouco ou nenhum texto). Pode ser PDF só de imagem — exporte o extrato em Excel no internet banking ou use um arquivo .xlsx aqui.'
    );
  }

  const ncol = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const padded = rows.map((r) => {
    const c = [...r];
    while (c.length < ncol) c.push('');
    return c;
  });

  return {
    rows: padded,
    meta: {
      pages: doc.numPages,
      linhasTot: padded.length,
      charsApprox,
    },
  };
}
