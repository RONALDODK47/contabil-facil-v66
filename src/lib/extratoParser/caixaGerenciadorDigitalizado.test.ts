import { describe, expect, it } from 'vitest';
import { parseCaixaGerenciadorWords } from './bankParsers';
import type { PdfWord } from './pdfExtractor';

/**
 * Gerenciador CAIXA impresso e digitalizado depois (extrato 04/2026 da Obras Sociais).
 *
 * O texto sai corrompido do OCR — "Mis :" no lugar de "Mês:", a URL com o período ilegível —
 * e, o que quebrava o parser, o indicador de natureza vem num token separado do valor:
 *
 *     [41]29/04/2026 [102]oouvss [169]CRED [192]TED [390]17,63 [414]c [518]58,13 [542]C
 *
 * O parser só aceitava o sinal colado ("17,63 D" num token só), e o extrato inteiro voltava
 * com zero transações.
 */
const palavra = (str: string, x0: number, y0: number): PdfWord => ({ str, x0, y0 });

const PAGINA_DIGITALIZADA: PdfWord[] = [
  palavra('Extrato', 41, 758),
  palavra('por', 82, 758),
  palavra('periodo', 105, 758),
  palavra('Conta:', 41, 720),
  palavra('1827', 78, 720),
  palavra('000577545651-0', 134, 720),
  // "Mês :" saiu com a vogal trocada e espaço antes dos dois-pontos
  palavra('Mis', 41, 679),
  palavra(':', 56, 679),
  palavra('Abril/2026', 78, 679),
  // Cabeçalho da tabela
  palavra('Data', 41, 611),
  palavra('Mov.', 62, 611),
  palavra('Histvérico', 169, 611),
  palavra('Valor', 400, 611),
  palavra('Saldo', 526, 611),
  // Saldo anterior — não é lançamento
  palavra('000000', 102, 591),
  palavra('SALDO', 169, 591),
  palavra('ANTERIOR', 197, 591),
  palavra('o,oo', 402, 591),
  palavra('40,50', 517, 591),
  palavra('c', 542, 591),
  // O lançamento: valor e sinal em tokens separados
  palavra('29/04/2026', 41, 571),
  palavra('oouvss', 102, 571),
  palavra('CRED', 169, 571),
  palavra('TED', 192, 571),
  palavra('17,63', 390, 571),
  palavra('c', 414, 571),
  palavra('58,13', 518, 571),
  palavra('C', 542, 571),
  // Saldo do dia — não é lançamento
  palavra('29/04/2026', 41, 551),
  palavra('oooooo', 102, 551),
  palavra('SALDO', 169, 551),
  palavra('DIA', 198, 551),
  palavra('0,00', 394, 551),
  palavra('c', 414, 551),
  palavra('58,13', 518, 551),
  palavra('C', 542, 551),
];

describe('Gerenciador CAIXA — impressão digitalizada', () => {
  const { transactions, metadata } = parseCaixaGerenciadorWords([PAGINA_DIGITALIZADA]);

  it('lê o lançamento com o indicador C/D em token separado do valor', () => {
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      date: '2026-04-29',
      description: 'CRED TED',
      amount: 17.63,
      balance: 58.13,
    });
  });

  it('o indicador solto não vira parte do histórico', () => {
    expect(transactions[0]?.description).toBe('CRED TED');
    expect(transactions[0]?.description).not.toMatch(/\bc\b/i);
  });

  it('continua ignorando SALDO ANTERIOR e SALDO DIA', () => {
    expect(transactions.map((t) => t.description)).toEqual(['CRED TED']);
  });

  it('lê o período mesmo com o cabeçalho corrompido', () => {
    // "Mis : Abril/2026" — antes caía no padrão 01/2026
    expect(metadata?.period).toBe('04/2026');
    expect(metadata?.account_number).toBe('000577545651-0');
  });

  it('sem cabeçalho legível, o período vem da data dos lançamentos', () => {
    const semCabecalho = PAGINA_DIGITALIZADA.filter(
      (w) => !['Mis', ':', 'Abril/2026'].includes(w.str),
    );
    const { metadata: meta } = parseCaixaGerenciadorWords([semCabecalho]);

    expect(meta?.period).toBe('04/2026');
  });

  it('valor sem indicador nenhum é ignorado, para não inverter o lançamento', () => {
    const semSinal = PAGINA_DIGITALIZADA.filter(
      (w) => !(w.y0 === 571 && w.str === 'c' && w.x0 === 414),
    );
    const { transactions: sem } = parseCaixaGerenciadorWords([semSinal]);

    expect(sem).toHaveLength(0);
  });

  it('o formato normal, com o sinal colado no valor, continua funcionando', () => {
    const colado: PdfWord[] = [
      palavra('05/05/2026', 41, 571),
      palavra('011205', 102, 571),
      palavra('DEB', 169, 571),
      palavra('PIX', 192, 571),
      palavra('CH', 214, 571),
      palavra('1.520,00 D', 375, 571),
      palavra('21.325,53 C', 499, 571),
    ];
    const { transactions: normais } = parseCaixaGerenciadorWords([colado]);

    expect(normais).toHaveLength(1);
    expect(normais[0]).toMatchObject({
      date: '2026-05-05',
      description: 'DEB PIX CH',
      amount: -1520,
      balance: 21325.53,
    });
  });
});
