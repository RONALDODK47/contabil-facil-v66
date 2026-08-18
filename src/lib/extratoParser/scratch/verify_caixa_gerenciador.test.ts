import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseCaixaGerenciadorWords } from '../bankParsers';
import type { PdfWord } from '../pdfExtractor';

const PDF =
  'P:/EMPRESAS/ATIVAS/IMUNE ISENTAS/CENTRO ESPÍRITA LUZ DA VERDADE/RECORRENTE/2026/CONTABIL/05-2026/2026 - 05 - CAIXA - DISPESÁRIO.pdf';

async function wordsFromPdf(path: string): Promise<PdfWord[][]> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(readFileSync(path));
  const pdf = await pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableWorker: true,
    worker: new pdfjs.PDFWorker({ name: 'caixa-ger-test', port: null, verbosity: 0 }),
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

describe.skipIf(!existsSync(PDF))('Caixa — Gerenciador, extrato por período (PDF real)', () => {
  it('extrai os lançamentos, ignora SALDO DIA e fecha com o saldo final', async () => {
    const pages = await wordsFromPdf(PDF);
    const { transactions, metadata } = parseCaixaGerenciadorWords(pages);

    expect(metadata?.bank_name).toBe('Caixa Econômica Federal');
    expect(metadata?.period).toBe('05/2026');
    expect(metadata?.account_number).toBe('000579015952-0');

    expect(transactions[0]).toMatchObject({
      date: '2026-05-04',
      description: 'DEB PIX CH',
      amount: -1520,
      balance: 21325.53,
    });

    // Nenhuma linha de saldo vira lançamento
    expect(transactions.some((t) => /saldo/i.test(t.description!))).toBe(false);
    // Nr. Doc. nunca entra na descrição
    expect(transactions.some((t) => /\d{6}/.test(t.description!))).toBe(false);

    // Coerência: saldo anterior + soma dos lançamentos = último saldo impresso
    const soma = Math.round(transactions.reduce((a, t) => a + t.amount!, 0) * 100) / 100;
    const saldoInicial = 21325.53 + 1520; // saldo após o 1º lançamento + o débito
    expect(Math.round((saldoInicial + soma) * 100) / 100).toBe(
      transactions[transactions.length - 1].balance
    );

    console.log('total lançamentos:', transactions.length);
  });
});
