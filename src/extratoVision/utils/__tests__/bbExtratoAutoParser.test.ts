/**
 * Testes para o parser automático de extratos BB
 */
import { describe, it, expect } from 'vitest';
import { 
  detectBbLayoutVersion, 
  parseBbExtratoAuto, 
  calculateBbExtratoStats,
  formatBrCurrency,
  exportBbExtratoToCsv
} from '../bbExtratoAutoParser';

describe('bbExtratoAutoParser', () => {
  describe('detectBbLayoutVersion', () => {
    it('deve detectar layout v2026 com cabeçalho estruturado', () => {
      const text = `
Dia  Lote  Documento  Histórico  Valor
04/05/2026  14397  10903125172831  Pix - Recebido 01/05 09:03 55802389168 JOSE ANTONIO D  500,00 (+)
      `;
      expect(detectBbLayoutVersion(text)).toBe('v2026');
    });

    it('deve detectar layout v2026 por padrão de linha', () => {
      const text = '04/05/2026  14397  10903125172831  Pix - Recebido 01/05 09:03 55802389168 JOSE ANTONIO D  500,00 (+)';
      expect(detectBbLayoutVersion(text)).toBe('v2026');
    });

    it('deve detectar layout legacy', () => {
      const text = `
Extrato de Conta Corrente
Cliente COMERCIAL FERNANDES LTDA
04/05/2026 Pix Recebido JOSE ANTONIO  500,00 (+)
      `;
      expect(detectBbLayoutVersion(text)).toBe('legacy');
    });

    it('deve retornar unknown para texto inválido', () => {
      expect(detectBbLayoutVersion('')).toBe('unknown');
      expect(detectBbLayoutVersion('texto aleatório')).toBe('unknown');
    });
  });

  describe('parseBbExtratoAuto', () => {
    it('deve usar parser v2026 automaticamente', () => {
      const text = `
04/05/2026  14397  10903125172831  Pix - Recebido 01/05 09:03 55802389168 JOSE ANTONIO D  500,00 (+)
04/05/2026  13105  50401  Pagamento de Boleto GUABI NUTRICAO S ANIMAL LTDA  2.458,92 (-)
      `;
      
      const result = parseBbExtratoAuto(text);
      
      expect(result).toHaveLength(2);
      expect(result[0]?.layout).toBe('v2026');
      expect(result[0]?.tipo).toBe('credito');
      expect(result[1]?.tipo).toBe('debito');
    });

    it('deve usar parser legacy como fallback', () => {
      const text = `
04/05/2026 Pix Recebido JOSE ANTONIO 500,00 (+)
04/05/2026 Pagamento Boleto EMPRESA ABC 200,00 (-)
      `;
      
      const result = parseBbExtratoAuto(text);
      
      expect(result.length).toBeGreaterThan(0);
      result.forEach(row => {
        expect(['legacy', 'v2026']).toContain(row.layout);
      });
    });

    it('deve retornar array vazio para texto inválido', () => {
      const result = parseBbExtratoAuto('texto sem formato de extrato');
      expect(result).toEqual([]);
    });
  });

  describe('calculateBbExtratoStats', () => {
    it('deve calcular estatísticas corretamente', () => {
      const rows = [
        {
          data: '04/05/2026',
          historico: 'Pix - Recebido',
          valor: 50000, // R$ 500,00
          tipo: 'credito' as const,
          layout: 'v2026' as const
        },
        {
          data: '04/05/2026', 
          historico: 'Pagamento de Boleto',
          valor: 245892, // R$ 2.458,92
          tipo: 'debito' as const,
          layout: 'v2026' as const
        }
      ];

      const stats = calculateBbExtratoStats(rows);

      expect(stats.totalTransacoes).toBe(2);
      expect(stats.totalCreditos).toBe(50000);
      expect(stats.totalDebitos).toBe(245892);
      expect(stats.saldoLiquido).toBe(50000 - 245892); // Negativo
      expect(stats.layout).toBe('v2026');
      expect(stats.tiposTransacao).toContain('Pix');
      expect(stats.tiposTransacao).toContain('Pagamento');
      expect(stats.periodoInicio).toBe('04/05/2026');
      expect(stats.periodoFim).toBe('04/05/2026');
    });

    it('deve lidar com array vazio', () => {
      const stats = calculateBbExtratoStats([]);
      
      expect(stats.totalTransacoes).toBe(0);
      expect(stats.totalCreditos).toBe(0);
      expect(stats.totalDebitos).toBe(0);
      expect(stats.saldoLiquido).toBe(0);
      expect(stats.tiposTransacao).toEqual([]);
    });
  });

  describe('formatBrCurrency', () => {
    it('deve formatar valores corretamente', () => {
      // Usar match para lidar com diferenças de formatação entre sistemas
      expect(formatBrCurrency(50000)).toMatch(/R\$\s*500,00/);
      expect(formatBrCurrency(245892)).toMatch(/R\$\s*2\.458,92/);
      expect(formatBrCurrency(0)).toMatch(/R\$\s*0,00/);
      expect(formatBrCurrency(1)).toMatch(/R\$\s*0,01/);
    });
  });

  describe('exportBbExtratoToCsv', () => {
    it('deve gerar CSV corretamente', () => {
      const rows = [
        {
          data: '04/05/2026',
          historico: 'Pix - Recebido de João',
          valor: 50000,
          tipo: 'credito' as const,
          layout: 'v2026' as const
        },
        {
          data: '05/05/2026',
          historico: 'Pagamento de Boleto "Empresa ABC"',
          valor: 20000,
          tipo: 'debito' as const, 
          layout: 'v2026' as const
        }
      ];

      const csv = exportBbExtratoToCsv(rows);
      const lines = csv.split('\n');

      expect(lines[0]).toBe('Data;Histórico;Crédito;Débito;Layout');
      expect(lines[1]).toContain('04/05/2026');
      expect(lines[1]).toMatch(/R\$\s*500,00/);
      expect(lines[1]).not.toMatch(/R\$\s*200,00/); // Não deve ter débito na linha de crédito
      
      expect(lines[2]).toContain('05/05/2026');
      expect(lines[2]).toMatch(/R\$\s*200,00/);
      expect(lines[2]).toContain('""Empresa ABC""'); // Quotes escapadas
    });

    it('deve lidar com array vazio', () => {
      const csv = exportBbExtratoToCsv([]);
      expect(csv).toBe('Data;Histórico;Crédito;Débito;Layout');
    });
  });
});