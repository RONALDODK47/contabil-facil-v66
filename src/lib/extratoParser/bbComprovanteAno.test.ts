import { describe, expect, it } from 'vitest';
import { parseBBComprovanteText } from './bankParsers';

/**
 * No PDF "Comprovante / Extrato CC" do BB, o ÚLTIMO lançamento de cada página
 * sai com o ano cortado ("31/07/202"), porque o dígito final cai depois do
 * cabeçalho da página seguinte. O parser precisa reconstruir o ano a partir do
 * ano predominante do extrato — antes virava 2002 e o TXT ia com ano errado.
 */
const TEXTO = `Extrato de Conta Corrente Cliente RICARDO CEZAR GOMES
Agência: 463-4 Conta: 42479-0
Lançamentos
Dia Lote Documento Histórico Valor
167,74 (+) 01/07/2026 14024 893722070 Cielo Vendas Crédito
374,78 (+) 01/07/2026 14024 893722070 Cielo Vendas Débito
79,21 (+)31/07/202 14397 312114359526441 Pix - Recebido
Extrato de Conta Corrente Cliente RICARDO CEZAR GOMES
6 31/07 21:14 00294504000161 RICARDO CEZ
`;

describe('parseBBComprovanteText — ano cortado na quebra de página', () => {
  it('reconstrói o ano de 4 dígitos em vez de gerar 2002', () => {
    const { transactions } = parseBBComprovanteText(TEXTO);
    expect(transactions.length).toBeGreaterThanOrEqual(3);
    expect(transactions.every((t) => t.date.startsWith('2026-'))).toBe(true);
    expect(transactions.some((t) => t.date === '2026-07-31')).toBe(true);
  });
});
