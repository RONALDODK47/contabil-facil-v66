/**
 * Testes para o parser de Folha de Pagamento
 */

import { describe, it, expect } from 'vitest';
import {
  getLastDayOfMonth,
  parseBrValue,
  parseFolhaText,
  parseFolhaTextMultiCompetencia,
  folhaLancamentosToGenericOcrRows,
} from './folhaPDFParser';

describe('folhaPDFParser', () => {
  describe('getLastDayOfMonth', () => {
    it('calcula corretamente o último dia de janeiro', () => {
      expect(getLastDayOfMonth('01/2026')).toBe('31/01/2026');
    });

    it('calcula corretamente o último dia de fevereiro (não bissexto)', () => {
      expect(getLastDayOfMonth('02/2025')).toBe('28/02/2025');
    });

    it('calcula corretamente o último dia de fevereiro (bissexto)', () => {
      expect(getLastDayOfMonth('02/2024')).toBe('29/02/2024');
    });

    it('calcula corretamente o último dia de abril (30 dias)', () => {
      expect(getLastDayOfMonth('04/2026')).toBe('30/04/2026');
    });

    it('calcula corretamente o último dia de dezembro', () => {
      expect(getLastDayOfMonth('12/2025')).toBe('31/12/2025');
    });

    it('retorna string vazia para competência inválida', () => {
      expect(getLastDayOfMonth('13/2026')).toBe('');
      expect(getLastDayOfMonth('00/2026')).toBe('');
      expect(getLastDayOfMonth('invalido')).toBe('');
    });
  });

  describe('parseBrValue', () => {
    it('converte valor brasileiro simples', () => {
      expect(parseBrValue('206,08')).toBe(206.08);
    });

    it('converte valor com separador de milhares', () => {
      expect(parseBrValue('1.621,00')).toBe(1621);
    });

    it('converte valor grande com vários separadores', () => {
      expect(parseBrValue('10.000.000,50')).toBe(10000000.5);
    });

    it('retorna 0 para valor vazio', () => {
      expect(parseBrValue('')).toBe(0);
      expect(parseBrValue('   ')).toBe(0);
    });

    it('retorna 0 para valor inválido', () => {
      expect(parseBrValue('abc')).toBe(0);
    });
  });

  describe('parseFolhaText', () => {
    it('extrai competência corretamente', () => {
      const text = `Competência: 01/2026`;
      const result = parseFolhaText(text);
      expect(result.competencia).toBe('01/2026');
      expect(result.data).toBe('31/01/2026');
    });

    it('extrai metadados da folha', () => {
      const text = `
Empresa: 36 - BESSA & GOMIDE LTDA
CNPJ: 33.369.075/0001-01
Competência: 02/2026
      `;
      const result = parseFolhaText(text);
      expect(result.empresa).toContain('BESSA & GOMIDE');
      expect(result.cnpj).toBe('33.369.075/0001-01');
      expect(result.competencia).toBe('02/2026');
      // 2026 não é bissexto (não divisível por 4... espera, 2026/4=506.5, não é bissexto)
      expect(result.data).toBe('28/02/2026');
    });

    it('extrai lançamentos de PROVENTOS com natureza C', () => {
      const text = `
Competência: 01/2026

PROVENTOS
1 SALARIO EMPREGADO 1 28:00 206,08
3 HORAS FERIAS 1 87:12 641,79
      `;
      const result = parseFolhaText(text);
      expect(result.lancements.length).toBe(2);
      expect(result.lancements[0]).toMatchObject({
        rubrica: '1',
        nomeRubrica: 'SALARIO EMPREGADO',
        valor: 206.08,
        natureza: 'C',
        tipo: 'PROVENTOS',
      });
    });

    it('extrai lançamentos de DESCONTOS com natureza D', () => {
      const text = `
Competência: 03/2026

DESCONTOS
812 INSS FERIAS1 1 7,50 72,07
843 INSS EMPREGADOR 1 11,00 178,31
      `;
      const result = parseFolhaText(text);
      expect(result.lancements.length).toBe(2);
      expect(result.lancements[0]).toMatchObject({
        rubrica: '812',
        nomeRubrica: 'INSS FERIAS1',
        valor: 72.07,
        natureza: 'D',
        tipo: 'DESCONTOS',
      });
    });

    it('extrai lançamentos INFORMATIVOS com natureza C', () => {
      const text = `
Competência: 01/2026

INFORMATIVA
813 FGTS FERIAS1 1 0,00 76,88
996 F.G.T.S DO MES 1 0,00 18,59
      `;
      const result = parseFolhaText(text);
      expect(result.lancements.length).toBe(2);
      expect(result.lancements[0]).toMatchObject({
        rubrica: '813',
        nomeRubrica: 'FGTS FERIAS1',
        valor: 76.88,
        natureza: 'C',
        tipo: 'INFORMATIVA',
      });
    });

    it('extrai lançamentos INFORMATIVOS com asterisco no final (formato Domínio)', () => {
      const text = `
Competência: 01/2026

INFORMATIVA
813 FGTS FERIAS1 1 0,00 76,88 *
996 F.G.T.S DO MES 1 0,00 18,59 *
      `;
      const result = parseFolhaText(text);
      expect(result.lancements.length).toBe(2);
      expect(result.lancements[0]).toMatchObject({
        rubrica: '813',
        nomeRubrica: 'FGTS FERIAS1',
        valor: 76.88,
        natureza: 'C',
        tipo: 'INFORMATIVA',
      });
      expect(result.lancements[1]).toMatchObject({
        rubrica: '996',
        nomeRubrica: 'F.G.T.S DO MES',
        valor: 18.59,
        natureza: 'C',
        tipo: 'INFORMATIVA',
      });
    });

    it('usa Valor Calculado (maior valor) quando colunas aparecem na ordem invertida no PDF', () => {
      // PDFs Domínio podem extrair as colunas na ordem: Valor Calculado | Valor Informado
      // O parser deve sempre pegar o maior valor (Valor Calculado) independente da ordem.
      const text = `
Competência: 01/2026

PROVENTOS
1 SALARIO EMPREGADO 1 206,08 28:00
3 HORAS FERIAS 1 641,79 87:12

DESCONTOS
812 INSS FERIAS1 1 240,25 33,33
843 INSS EMPREGADOR 1 1.621,00 30,00
      `;
      const result = parseFolhaText(text);
      expect(result.lancements.length).toBe(4);
      expect(result.lancements[0]).toMatchObject({ rubrica: '1', valor: 206.08 });
      expect(result.lancements[1]).toMatchObject({ rubrica: '3', valor: 641.79 });
      expect(result.lancements[2]).toMatchObject({ rubrica: '812', valor: 240.25 });
      expect(result.lancements[3]).toMatchObject({ rubrica: '843', valor: 1621.00 });
    });

    it('extrai o Valor Calculado (não o Informado) quando o nome da rubrica termina com um dígito solto', () => {
      // Bug real: nomes como "PRO-LABORE DIAS 1" ou "VANTAGENS FERIAS 1" faziam o parser
      // confundir esse dígito final com a coluna Nº Empregados, embaralhando as duas colunas
      // de valor e fazendo o sistema importar o Valor Informado (30,00) em vez do Valor
      // Calculado (1.621,00).
      const text = `
Competência: 01/2026

PROVENTOS
807 VANTAGENS FERIAS 1 1 78,97 78,97
9380 PRO-LABORE DIAS 1 1 30,00 1.621,00
      `;
      const result = parseFolhaText(text);
      expect(result.lancements.length).toBe(2);
      expect(result.lancements[0]).toMatchObject({
        rubrica: '807',
        nomeRubrica: 'VANTAGENS FERIAS 1',
        valor: 78.97,
      });
      expect(result.lancements[1]).toMatchObject({
        rubrica: '9380',
        nomeRubrica: 'PRO-LABORE DIAS 1',
        valor: 1621.0,
      });
    });

    it('ignora linhas de total', () => {
      const text = `
Competência: 01/2026

PROVENTOS
1 SALARIO EMPREGADO 1 28:00 206,08
Total: 2.814,41

DESCONTOS
812 INSS FERIAS1 1 7,50 72,07
      `;
      const result = parseFolhaText(text);
      // Deve ter 2 lançamentos (1 de PROVENTOS + 1 de DESCONTOS), não a linha de Total
      expect(result.lancements.length).toBe(2);
    });

    it('retorna erro se competência não encontrada', () => {
      const text = 'Sem competência aqui';
      const result = parseFolhaText(text);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.competencia).toBe('');
    });
  });

  describe('parseFolhaTextMultiCompetencia', () => {
    it('separa um "Resumo Mensal" com várias competências (uma por página) em um resultado por mês', () => {
      const text = `
--- Página 1 ---
Empresa: 36 - BESSA & GOMIDE LTDA
CNPJ: 33.369.075/0001-01
Competência: 01/2026

PROVENTOS
1 SALARIO EMPREGADO 1 28:00 206,08
Total: 206,08

DESCONTOS
998 I.N.S.S. 1 7,50 17,43
Total: 17,43

--- Página 2 ---
Empresa: 36 - BESSA & GOMIDE LTDA
CNPJ: 33.369.075/0001-01
Competência: 02/2026

PROVENTOS
9380 PRO-LABORE DIAS 1 30,00 1.621,00
Total: 1.621,00

DESCONTOS
843 INSS EMPREGADOR 1 11,00 178,31
Total: 178,31
      `;

      const results = parseFolhaTextMultiCompetencia(text);

      expect(results.length).toBe(2);
      expect(results[0]).toMatchObject({ competencia: '01/2026', data: '31/01/2026' });
      expect(results[1]).toMatchObject({ competencia: '02/2026', data: '28/02/2026' });
      expect(results[0]!.lancements.length).toBe(2);
      expect(results[1]!.lancements.length).toBe(2);
      // Sem separação por página, tudo cairia sob a 1ª competência (01/2026) — a checagem abaixo
      // garante que os lançamentos da página 2 ficam na data correta, não na da página 1.
      expect(results[1]!.lancements[0]!.rubrica).toBe('9380');
    });

    it('funciona normalmente com um único mês (sem marcador de página)', () => {
      const text = `
Competência: 01/2026

PROVENTOS
1 SALARIO EMPREGADO 1 28:00 206,08
      `;
      const results = parseFolhaTextMultiCompetencia(text);
      expect(results.length).toBe(1);
      expect(results[0]!.competencia).toBe('01/2026');
    });
  });

  describe('folhaLancamentosToGenericOcrRows', () => {
    it('converte lançamentos para formato OcrRow', () => {
      const text = `
Empresa: 36 - BESSA & GOMIDE LTDA
Competência: 01/2026

PROVENTOS
1 SALARIO EMPREGADO 1 28:00 206,08

DESCONTOS
812 INSS FERIAS1 1 7,50 72,07
      `;
      const parseResult = parseFolhaText(text);
      const rows = folhaLancamentosToGenericOcrRows(parseResult);

      expect(rows.length).toBe(2);
      expect(rows[0]).toMatchObject({
        data: '31/01/2026',
        descricao: '1 - SALARIO EMPREGADO',
        valor: 206.08,
        natureza: 'C',
        valorCredito: '206,08',
        valorDebito: '',
      });

      expect(rows[1]).toMatchObject({
        data: '31/01/2026',
        descricao: '812 - INSS FERIAS1',
        valor: 72.07,
        natureza: 'D',
        valorDebito: '72,07',
        valorCredito: '',
      });
    });
  });
});
