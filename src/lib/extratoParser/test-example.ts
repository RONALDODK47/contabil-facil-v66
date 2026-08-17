/**
 * Exemplo de teste com dados reais do extrato
 * Validar que o parser produz o mesmo formato que o JSON fornecido
 */

import { BankStatementJSON } from './types';

// Dados de exemplo do JSON fornecido
export const EXPECTED_OUTPUT: BankStatementJSON = {
  transactions: [
    {
      date: '2026-04-02',
      description: 'COMPRAS NACIONAIS AUTO POSTO CASTELO BRAN PIRES',
      amount: -70,
      balance: 30.31,
      category: 'Transporte',
    },
    {
      date: '2026-04-06',
      description: 'RECEBIMENTO PIX 31599499000129 SOR MANUTENCAO E',
      amount: 150,
      balance: 180.31,
      category: 'Receita',
    },
    {
      date: '2026-04-08',
      description: 'PAGAMENTO PIX 02998603106 ANDRESSA GONCALVES DE',
      amount: -45,
      balance: 135.31,
      category: 'Transferência',
    },
    {
      date: '2026-04-09',
      description: 'PAGAMENTO PIX 01149098147 Geovani Moreira Costa',
      amount: -12,
      balance: null,
      category: 'Transferência',
    },
    {
      date: '2026-04-09',
      description: 'COMPRAS NACIONAIS SORVETERIA BEIJO FRIO PIRES',
      amount: -92.5,
      balance: null,
      category: 'Alimentação',
    },
    {
      date: '2026-04-24',
      description: 'TED 01257995000133 GOIASMINAS INDUSTRIA DE LATIC',
      amount: 18000,
      balance: null,
      category: 'Receita',
    },
  ],
  metadata: {
    bank_name: 'CCPI DO PLANALTO CENTRAL (Sicredi)',
    account_number: '000099198-8',
    period: '04/2026',
  },
};

// Exemplo de texto extraído de um PDF que deveria ser parseado para esse resultado
export const EXAMPLE_PDF_TEXT = `
CCPI DO PLANALTO CENTRAL (Sicredi)
Conta: 000099198-8
Período: 04/2026

Data        Descrição                                    Valor      Saldo
02/04       COMPRAS NACIONAIS AUTO POSTO CASTELO       -70,00     30,31
06/04       RECEBIMENTO PIX 31599499000129            150,00     180,31
08/04       PAGAMENTO PIX 02998603106 ANDRESSA        -45,00     135,31
09/04       PAGAMENTO PIX 01149098147 Geovani         -12,00
09/04       COMPRAS NACIONAIS SORVETERIA BEIJO       -92,50
24/04       TED 01257995000133 GOIASMINAS            18000,00
`;

/**
 * Função auxiliar para testar a classificação
 */
export function testCategoryClassification() {
  const testCases = [
    // Transporte
    { desc: 'COMPRAS NACIONAIS AUTO POSTO CASTELO BRAN PIRES', expected: 'Transporte' },
    // Receita
    { desc: 'RECEBIMENTO PIX 31599499000129 SOR MANUTENCAO E', expected: 'Receita' },
    { desc: 'TED 01257995000133 GOIASMINAS INDUSTRIA DE LATIC', expected: 'Receita' },
    // Transferência
    { desc: 'PAGAMENTO PIX 02998603106 ANDRESSA GONCALVES DE', expected: 'Transferência' },
    { desc: 'PAGAMENTO PIX 01149098147 Geovani Moreira Costa', expected: 'Transferência' },
    // Alimentação
    { desc: 'COMPRAS NACIONAIS SORVETERIA BEIJO FRIO PIRES', expected: 'Alimentação' },
    // Empréstimos
    { desc: 'LIQUIDACAO DE PARCELA (C30530597)', expected: 'Empréstimos' },
    // Cartão de Crédito
    { desc: 'DEB.CTA.FATURA (CM495805)', expected: 'Cartão de Crédito' },
    // Suprimentos
    { desc: 'PAGAMENTO PIX 03554510000107 TUBOS VEROLA COMERC', expected: 'Suprimentos' },
    { desc: 'PAGAMENTO PIX 42638347000104 NEW SOLDAS', expected: 'Suprimentos' },
    { desc: 'PAGAMENTO PIX 01982960000167 ACO ITALIA INDUSTRI', expected: 'Suprimentos' },
    { desc: 'PAGAMENTO PIX 41298925000148 FERRAGISTA MARQUES', expected: 'Suprimentos' },
    // Transporte/Logística
    { desc: 'LIQUIDACAO BOLETO 14401246000180 TRANSTUR TRANSP', expected: 'Transporte' },
    // Serviços
    { desc: 'PAGAMENTO PIX 29024624000120 INOV SERVICOS E SOL', expected: 'Serviços' },
    // Impostos
    { desc: 'DEBITO ARRECADACAO 00394460005887 DARFC0385', expected: 'Impostos' },
    // Utilidades
    { desc: 'PAGAMENTO PIX 01543032000104 EQUATORIAL ENERGIA', expected: 'Utilidades' },
    // Seguros
    { desc: 'DEBITO CONVENIOS ID 202311445048 SEG VIDA / PRES', expected: 'Seguros' },
  ];

  console.log('Testando categorização de transações:');
  console.log('=====================================\n');

  for (const test of testCases) {
    console.log(`Descrição: ${test.desc}`);
    console.log(`Categoria esperada: ${test.expected}`);
    console.log('');
  }

  return testCases;
}

/**
 * Função para testar parsing de valores
 */
export function testAmountParsing() {
  const testCases = [
    { input: '70', expected: -70 },
    { input: '150', expected: 150 },
    { input: '45', expected: -45 },
    { input: '92,5', expected: -92.5 },
    { input: '30,31', expected: 30.31 },
    { input: '1.234,56', expected: 1234.56 },
    { input: '18000', expected: 18000 },
  ];

  console.log('\nTestando parsing de valores:');
  console.log('============================\n');

  for (const test of testCases) {
    console.log(`Input: ${test.input} => Esperado: ${test.expected}`);
  }

  return testCases;
}

/**
 * Função para testar parsing de datas
 */
export function testDateParsing() {
  const testCases = [
    { input: '02/04', year: 2026, expected: '2026-04-02' },
    { input: '06/04', year: 2026, expected: '2026-04-06' },
    { input: '08/04', year: 2026, expected: '2026-04-08' },
    { input: '09/04', year: 2026, expected: '2026-04-09' },
    { input: '24/04', year: 2026, expected: '2026-04-24' },
    { input: '2026-04-02', year: 2026, expected: '2026-04-02' },
  ];

  console.log('\nTestando parsing de datas:');
  console.log('==========================\n');

  for (const test of testCases) {
    console.log(`Input: ${test.input} => Esperado: ${test.expected}`);
  }

  return testCases;
}

// Run tests
if (import.meta.url === `file://${process.argv[1]}`) {
  testCategoryClassification();
  testAmountParsing();
  testDateParsing();
}
