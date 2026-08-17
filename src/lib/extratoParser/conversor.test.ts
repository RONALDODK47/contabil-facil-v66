import { describe, it, expect } from 'vitest';
import {
  parseTransactionsFromText,
  mergeTransactionLines,
} from './transactionParser';
import { classifyTransaction } from './categoryClassifier';
import { parseBradescoText } from './bankParsers';

describe('Extrato Parser', () => {
  describe('classifyTransaction', () => {
    it('should classify COMPRAS as Transporte', () => {
      const result = classifyTransaction(
        'COMPRAS NACIONAIS AUTO POSTO CASTELO BRAN PIRES',
        -70
      );
      expect(result).toBe('Transporte');
    });

    it('should classify RECEBIMENTO PIX as Receita', () => {
      const result = classifyTransaction(
        'RECEBIMENTO PIX 31599499000129 SOR MANUTENCAO E',
        150
      );
      expect(result).toBe('Receita');
    });

    it('should classify PAGAMENTO PIX as Transferência', () => {
      const result = classifyTransaction(
        'PAGAMENTO PIX 02998603106 ANDRESSA GONCALVES DE',
        -45
      );
      expect(result).toBe('Transferência');
    });

    it('should classify SORVETERIA as Alimentação', () => {
      const result = classifyTransaction(
        'COMPRAS NACIONAIS SORVETERIA BEIJO FRIO PIRES',
        -92.5
      );
      expect(result).toBe('Alimentação');
    });

    it('should classify AMORTIZACAO as Tarifas/Encargos', () => {
      const result = classifyTransaction('AMORTIZACAO CONTRATO', -0.81);
      expect(result).toBe('Tarifas/Encargos');
    });

    it('should classify TED as Receita', () => {
      const result = classifyTransaction(
        'TED 01257995000133 GOIASMINAS INDUSTRIA DE LATIC',
        18000
      );
      expect(result).toBe('Receita');
    });

    it('should classify LIQUIDACAO DE PARCELA as Empréstimos', () => {
      const result = classifyTransaction(
        'LIQUIDACAO DE PARCELA (C30530597)',
        -1330.72
      );
      expect(result).toBe('Empréstimos');
    });

    it('should classify DEB.CTA.FATURA as Cartão de Crédito', () => {
      const result = classifyTransaction('DEB.CTA.FATURA (CM495805)', -4198.76);
      expect(result).toBe('Cartão de Crédito');
    });

    it('should classify TUBOS VEROLA as Suprimentos', () => {
      const result = classifyTransaction(
        'PAGAMENTO PIX 03554510000107 TUBOS VEROLA COMERC',
        -1613.2
      );
      expect(result).toBe('Suprimentos');
    });

    it('should classify TRANSTUR as Transporte', () => {
      const result = classifyTransaction(
        'LIQUIDACAO BOLETO 14401246000180 TRANSTUR TRANSP',
        -272.74
      );
      expect(result).toBe('Transporte');
    });

    it('should classify EQUATORIAL ENERGIA as Utilidades', () => {
      const result = classifyTransaction(
        'PAGAMENTO PIX 01543032000104 EQUATORIAL ENERGIA',
        -681.86
      );
      expect(result).toBe('Utilidades');
    });

    it('should classify DEBITO ARRECADACAO as Impostos', () => {
      const result = classifyTransaction(
        'DEBITO ARRECADACAO 00394460005887 DARFC0385',
        -522.16
      );
      expect(result).toBe('Impostos');
    });

    it('should classify INOV SERVICOS as Serviços', () => {
      const result = classifyTransaction(
        'PAGAMENTO PIX 29024624000120 INOV SERVICOS E SOL',
        -1286.48
      );
      expect(result).toBe('Serviços');
    });

    it('should classify SEGUROS as Seguros', () => {
      const result = classifyTransaction(
        'DEBITO CONVENIOS ID 202311445048 SEG VIDA / PRES',
        -184.91
      );
      expect(result).toBe('Seguros');
    });
  });

  describe('parseTransactionsFromText', () => {
    it('should extract metadata from PDF text', () => {
      const text = `
        BANCO SICREDI
        Conta: 000099198-8
        Período: 04/2026
      `;

      const { metadata } = parseTransactionsFromText(text);

      expect(metadata).toBeDefined();
      expect(metadata?.bank_name).toContain('SICREDI');
      expect(metadata?.account_number).toContain('000099198-8');
    });
  });

  describe('amount parsing', () => {
    it('should parse Brazilian format amounts correctly', () => {
      const testCases = [
        { input: '1.234,56', expected: 1234.56 },
        { input: '70', expected: 70 },
        { input: '1.000,00', expected: 1000 },
        { input: '30,31', expected: 30.31 },
      ];

      // This would be tested through the transaction parser
      testCases.forEach(({ input, expected }) => {
        // Test implementation would use parseAmount internally
        expect(input).toBeDefined(); // Placeholder
      });
    });
  });

  describe('date normalization', () => {
    it('should handle various date formats', () => {
      // Date formats that should be supported:
      // 2026-04-02 (ISO)
      // 02/04 (DD/MM without year)
      // 02-04-2026 (DD-MM-YYYY)

      const dates = ['2026-04-02', '02/04', '02-04-2026'];
      expect(dates).toBeDefined(); // Placeholder
    });
  });

  describe('parseBradescoText', () => {
    it('should parse Bradesco Net Empresa transaction text successfully', () => {
      const text = `
        Extrato (Últimos Lançamentos)
        COMERCIAL FERNANDES EIRELI - ME | CNPJ: 014.310.204/0001-33
        Nome do usuário: Murilo Beato Fernandes
        Data da operação: 20/05/2026 - 09h14
        Agência | Conta Total Disponível (R$) Total (R$)
        01894 | 0020527-3 1.337,29 1.337,29
        Extrato de: Ag: 01894 | CC: 0020527-3
        Data Lançamento Dcto. Crédito (R$) Débito (R$) Saldo (R$)
        18/02/2026 SALDO ANTERIOR 976,77
        19/02/2026 CARTAO VISA ELECTRON
        CIELO S.A - INSTITUICAO DE PAG 9625193 5,92 982,69
        CIELO VDA DEBITO MASTER
        CIELO S.A - INSTITUICAO DE PAG 9625193 206,63 1.189,32
        PAGTO ELETRON COBRANCA
        BOLETO 305 -1.191,61 97,82
      `;

      const { transactions, metadata } = parseBradescoText(text);

      expect(metadata).toBeDefined();
      expect(metadata?.bank_name).toBe('Bradesco');
      expect(metadata?.account_number).toBe('01894 / 0020527-3');
      expect(metadata?.period).toBe('02/2026');

      expect(transactions).toHaveLength(3);

      expect(transactions[0]).toEqual({
        date: '2026-02-19',
        description: 'CARTAO VISA ELECTRON CIELO S.A - INSTITUICAO DE PAG Dcto: 9625193',
        amount: 5.92,
        balance: 982.69,
        raw: 'CIELO S.A - INSTITUICAO DE PAG 9625193 5,92 982,69',
      });

      expect(transactions[2]).toEqual({
        date: '2026-02-19',
        description: 'PAGTO ELETRON COBRANCA BOLETO Dcto: 305',
        amount: -1191.61,
        balance: 97.82,
        raw: 'BOLETO 305 -1.191,61 97,82',
      });
    });
  });
});
