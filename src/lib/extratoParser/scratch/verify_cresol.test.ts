import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseCresolWords } from '../bankParsers';
import type { PdfWord } from '../pdfExtractor';

const PDF =
  'P:/EMPRESAS/ATIVAS/IMUNE ISENTAS/INSTITUTO DE RELIGIOSIDADE - TENDA MARTIM PESCADOR/RECORRENTE/2026/CONTABIL/DOCUMENTOS PARA CONTABILIZAÇÃO/06-2026/extrato_1805204129_20260501_20260601.pdf';

async function wordsFromPdf(path: string): Promise<PdfWord[][]> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(readFileSync(path));
  const pdf = await pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableWorker: true,
    worker: new pdfjs.PDFWorker({ name: 'cresol-test', port: null, verbosity: 0 }),
  }).promise;
  const pages: PdfWord[][] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((it: any) => ({
          str: String(it.str || ''),
          x0: it.transform?.[4] ?? 0,
          y0: it.transform?.[5] ?? 0,
        }))
        .filter((w: PdfWord) => w.str.trim().length > 0)
    );
  }
  return pages;
}

describe.skipIf(!existsSync(PDF))('Cresol — extrato por período (PDF real)', () => {
  it('extrai os 24 lançamentos e fecha com o saldo do extrato', async () => {
    const pages = await wordsFromPdf(PDF);
    const { transactions, metadata } = parseCresolWords(pages);

    expect(transactions).toHaveLength(24);
    expect(metadata?.bank_name).toBe('Cresol');
    expect(metadata?.period).toBe('05/2026');

    expect(transactions[0]).toMatchObject({
      date: '2026-06-01',
      description: 'PIX DEBITO PARA: LUZIETE MACHADO DA SILVA',
      amount: -150,
    });

    const creditos = transactions.filter((t) => t.amount! > 0);
    const debitos = transactions.filter((t) => t.amount! < 0);
    const soma = (arr: typeof transactions) =>
      Math.round(arr.reduce((acc, t) => acc + t.amount!, 0) * 100) / 100;

    expect(soma(creditos)).toBe(1162.4);
    expect(soma(debitos)).toBe(-2276.13);
    // saldo anterior 1.847,98 + movimento = saldo em conta 734,25 do extrato
    expect(Math.round((1847.98 + soma(transactions)) * 100) / 100).toBe(734.25);

    // "Saldo do Dia" e "Saldo Anterior" não podem virar lançamento
    expect(transactions.some((t) => /saldo/i.test(t.description!))).toBe(false);
  });
});
