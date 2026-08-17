/**
 * Testes para o parser do novo layout BB v2026
 */
import { describe, it, expect } from 'vitest';
import { parseBbExtratoV2026Line, parseBbExtratoV2026Text, BbExtratoV2026Row } from '../bbExtratoV2026Parser';

describe('bbExtratoV2026Parser', () => {
  describe('parseBbExtratoV2026Line', () => {
    it('deve fazer parse de linha Pix recebida simples', () => {
      const line = '04/05/2026  14397  10903125172831  Pix - Recebido 01/05 09:03 55802389168 JOSE ANTONIO D  500,00 (+)';
      const result = parseBbExtratoV2026Line(line);
      
      expect(result).not.toBeNull();
      if (result) {
        expect(result.data).toBe('04/05/2026');
        expect(result.lote).toBe('14397');
        expect(result.tipo).toBe('credito');
        expect(result.valor).toBe(50000); // 500.00 em centavos
        expect(result.historico).toContain('Pix');
      }
    });

    it('deve fazer parse de linha Pagamento de Boleto', () => {
      const line = '04/05/2026  13105  50401  Pagamento de Boleto GUABI NUTRICAO S ANIMAL LTDA  2.458,92 (-)';
      const result = parseBbExtratoV2026Line(line);
      
      expect(result).not.toBeNull();
      if (result) {
        expect(result.data).toBe('04/05/2026');
        expect(result.tipo).toBe('debito');
        expect(result.valor).toBe(245892); // 2458.92 em centavos
        expect(result.historico).toContain('Pagamento');
      }
    });

    it('deve fazer parse de linha com FCO Liberação', () => {
      const line = '04/05/2026  13128  4311471000121  FCO Liberação  12.251,95 (-)';
      const result = parseBbExtratoV2026Line(line);
      
      expect(result).not.toBeNull();
      if (result) {
        expect(result.tipo).toBe('debito');
        expect(result.valor).toBe(1225195);
      }
    });

    it('deve fazer parse de linha BB Rende Fácil', () => {
      const line = '04/05/2026  9903  -  BB Rende Fácil Rende Facil  11.986,29 (+)';
      const result = parseBbExtratoV2026Line(line);
      
      expect(result).not.toBeNull();
      if (result) {
        expect(result.tipo).toBe('credito');
        expect(result.valor).toBe(1198629);
      }
    });

    it('deve rejeitar linhas de cabeçalho', () => {
      const line = 'Dia  Lote  Documento  Histórico  Valor';
      const result = parseBbExtratoV2026Line(line);
      expect(result).toBeNull();
    });

    it('deve rejeitar linhas de saldo', () => {
      const line = '00/00/0000  14397  -  Saldo do dia  0,00 (+)';
      const result = parseBbExtratoV2026Line(line);
      expect(result).toBeNull();
    });

    it('deve fazer parse de Pix enviado', () => {
      const line = '27/05/2026  13105  52701  Pix - Enviado 27/05 08:01 GABRIEL NOVAIS MENDES  50,00 (-)';
      const result = parseBbExtratoV2026Line(line);
      
      expect(result).not.toBeNull();
      if (result) {
        expect(result.tipo).toBe('debito');
        expect(result.valor).toBe(5000);
      }
    });

    it('deve fazer parse de linhas com DARE - COD BARRAS', () => {
      const line = '11/05/2026  13105  51101  Pagamento de Impostos DARE - COD BARRAS  855,98 (-)';
      const result = parseBbExtratoV2026Line(line);
      
      expect(result).not.toBeNull();
      if (result) {
        expect(result.tipo).toBe('debito');
        expect(result.valor).toBe(85598);
        expect(result.historico).toContain('DARE');
      }
    });
  });

  describe('parseBbExtratoV2026Text', () => {
    it('deve fazer parse de múltiplas linhas', () => {
      const text = `
04/05/2026  14397  10903125172831  Pix - Recebido 01/05 09:03 55802389168 JOSE ANTONIO D  500,00 (+)
04/05/2026  14397  11106073834502  Pix - Recebido 01/05 11:06 00000076832198 MARIA JOSE  183,00 (+)
04/05/2026  13105  50401  Pagamento de Boleto GUABI NUTRICAO S ANIMAL LTDA  2.458,92 (-)
      `;

      const results = parseBbExtratoV2026Text(text);
      
      expect(results).toHaveLength(3);
      expect(results[0]?.tipo).toBe('credito');
      expect(results[1]?.tipo).toBe('credito');
      expect(results[2]?.tipo).toBe('debito');
    });

    it('deve ignorar linhas vazias e de cabeçalho', () => {
      const text = `
Dia  Lote  Documento  Histórico  Valor

04/05/2026  14397  10903125172831  Pix - Recebido 01/05 09:03 55802389168 JOSE ANTONIO D  500,00 (+)

Saldo do dia  0,00 (+)
      `;

      const results = parseBbExtratoV2026Text(text);
      expect(results).toHaveLength(1);
      expect(results[0]?.valor).toBe(50000);
    });
  });
});
