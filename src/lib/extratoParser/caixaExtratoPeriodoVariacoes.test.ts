import { describe, it, expect } from 'vitest';
import { parseCaixaWords } from './bankParsers';
import type { PdfWord } from './pdfExtractor';

const w = (str: string, x0: number, y0: number): PdfWord => ({ str, x0, y0 });

// Variações pequenas do MESMO layout "Extrato por período" da Caixa que
// apareceram em PDFs diferentes. Nenhuma delas pode impedir a extração.
describe('Caixa — extrato por período, variações do mesmo layout', () => {
  const header = [
    w('Lançamentos', 41, 560),
    w('Histórico/Complemento', 163, 560),
    w('Favorecido', 315, 560),
    w('CPF/CNPJ', 386, 560),
    w('Valor', 443, 560),
    w('Saldo', 489, 560),
  ];

  it('lê data com hora colada no mesmo item e histórico/favorecido em várias linhas', () => {
    const page: PdfWord[] = [
      ...header,
      // lançamento 1 — data+hora num item só, histórico em 2 linhas,
      // favorecido em 2 linhas
      w('31/07/2026-19:54:54', 40, 500),
      w('311954', 127, 500),
      w('DEB PIX', 163, 500),
      w('CHAVE COMPLEMENTO', 163, 490),
      w('Farmacia Santo', 315, 500),
      w('Antonio Ltda', 315, 490),
      w('**870.969/0***', 386, 500),
      w('2.500,00', 443, 500),
      w('D', 467, 500),
      w('17.718,61', 489, 500),
      w('D', 516, 500),
      // lançamento 2 — data e hora em itens separados, histórico numa linha só
      w('31/07/2026', 40, 470),
      w('19:07:50', 75, 470),
      w('311907', 127, 470),
      w('CRED PIX CHAVE', 163, 470),
      w('Maria Eduarda', 315, 470),
      w('50,00', 443, 470),
      w('C', 459, 470),
      w('17.668,61', 489, 470),
      w('D', 516, 470),
    ];

    const { transactions } = parseCaixaWords([page]);

    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({
      date: '2026-07-31',
      description: 'DEB PIX CHAVE COMPLEMENTO - Farmacia Santo Antonio Ltda',
      amount: -2500,
      balance: -17718.61,
    });
    expect(transactions[1]).toMatchObject({
      date: '2026-07-31',
      description: 'CRED PIX CHAVE - Maria Eduarda',
      amount: 50,
      balance: -17668.61,
    });
  });

  it('ignora cabeçalho e SALDO ANTERIOR, e não perde palavra deslocada de coluna', () => {
    const page: PdfWord[] = [
      w('SALDO', 315, 600),
      w('ANTERIOR', 335, 600),
      w('R$', 488, 600),
      w('17.627,51', 497, 600),
      w('D', 525, 600),
      ...header,
      w('31/07/2026-08:33:53', 40, 500),
      w('006704', 126, 500),
      // histórico começando alguns pontos à esquerda da faixa nominal
      w('AZCX', 145, 500),
      w('VS AC', 179, 500),
      w('4,82', 443, 500),
      w('C', 456, 500),
      w('17.795,99', 489, 500),
      w('D', 517, 500),
      // linha de SALDO DIA não vira lançamento
      w('30/07/2026-00:00:00', 40, 470),
      w('000000', 126, 470),
      w('SALDO DIA', 162, 470),
      w('0,00', 443, 470),
      w('C', 456, 470),
      w('18.235,79', 489, 470),
      w('D', 516, 470),
    ];

    const { transactions } = parseCaixaWords([page]);

    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      date: '2026-07-31',
      description: 'AZCX VS AC',
      amount: 4.82,
      balance: -17795.99,
    });
  });

  it('lê a página de continuação, que não repete o cabeçalho', () => {
    const page: PdfWord[] = [
      w('CAIXA', 41, 784),
      w('30/07/2026-14:28:14', 40, 760),
      w('301428', 126, 760),
      w('CRED PIX QR COD DIN', 163, 760),
      w('Divina Maria Bento', 315, 760),
      w('108,00', 444, 760),
      w('C', 463, 760),
      w('17.974,79', 489, 760),
      w('D', 516, 760),
    ];

    const { transactions } = parseCaixaWords([page]);

    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      date: '2026-07-30',
      description: 'CRED PIX QR COD DIN - Divina Maria Bento',
      amount: 108,
    });
  });
});
