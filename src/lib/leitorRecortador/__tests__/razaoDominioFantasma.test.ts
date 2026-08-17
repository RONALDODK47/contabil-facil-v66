import { describe, it, expect } from 'vitest';
import fixture from './fixtures/razaoDominioFantasma.json';
import { detectRazaoRowsFromText } from '../razaoRowDetection';
import { resolveRazaoColumnsForPage, assignRazaoRowTokens, mappingToRazaoColPixels } from '../razaoColumnPrecision';
import { mergeRazaoFieldsFromLine } from '../razaoLineParser';
import { buildDefaultColumnMapping } from '../columnDefaults';
import { mapGenericRowsToOcrRows } from '../rowMappers';
import { mapOcrRowsToRazaoVision } from '../../../contabilfacil/logic/ocrImportMapper';
import { normalizeRazaoImport } from '../../../contabilfacil/logic/contabilPipeline';
import type { PDFTextItem } from '../types';

/**
 * Razão do Sistema Domínio (Viver Sports, período 01/05/2026 - 30/06/2026).
 *
 * Esse PDF desenha o histórico VÁRIAS vezes na mesma linha, em x diferentes
 * (x≈1, 81, 146, 288, 416 em pontos; o dobro disso no canvas em escala 2).
 * Só a cópia de x≈81 está na coluna Histórico — as outras caem em cima de
 * Data (x≈1), Cta.C.Part. (x≈288) e Crédito/Saldo (x≈416).
 *
 * Resultado: a coluna Data recebia "PAGAMENTO PIX ..." em vez da data e as
 * colunas de valor recebiam texto. O import dizia "826 lançamentos" mas o
 * balancete ficava vazio, porque nenhum lançamento tinha data nem valor.
 */

const COLUMN_IDS = [
  'data',
  'descricao',
  'contaPartida',
  'contaContrapartida',
  'debito',
  'credito',
  'valorDc',
  'saldoPeriodo',
  'saldoExercicio',
];

type Pagina = { width: number; height: number; textItems: PDFTextItem[] };

function extrairCampos(pagina: Pagina) {
  const templateColumns = buildDefaultColumnMapping(COLUMN_IDS);
  const columns = resolveRazaoColumnsForPage(
    pagina.textItems,
    pagina.width,
    COLUMN_IDS,
    templateColumns,
  );
  const colPixels = mappingToRazaoColPixels(columns, COLUMN_IDS, pagina.width);
  const rows = detectRazaoRowsFromText(pagina.textItems);

  return rows.map((row) => {
    const rowItems = [...row.items].sort((a, b) => a.x - b.x);
    const linhaCompleta = rowItems.map((i) => i.text).join(' ').replace(/\s+/g, ' ').trim();
    const partsByCol = assignRazaoRowTokens(rowItems, colPixels, pagina.width, COLUMN_IDS);
    const fields: Record<string, string> = {};
    COLUMN_IDS.forEach((id) => {
      fields[id] = (partsByCol[id] || []).join(' ').trim();
    });
    Object.assign(fields, mergeRazaoFieldsFromLine(fields, linhaCompleta, row.classificacaoConta));
    return fields;
  });
}

/** Mesma conversão que o import faz depois de extrair os campos. */
function paraVision(campos: Record<string, string>[]) {
  const genericos = campos.map((fields, i) => ({
    id: `r${i + 1}`,
    fields,
    cropUrls: {},
    cropBounds: {},
    y: i * 10,
    height: 10,
    pageNumber: 1,
  }));
  const rows = mapGenericRowsToOcrRows(genericos, COLUMN_IDS);
  return normalizeRazaoImport(mapOcrRowsToRazaoVision(rows).items);
}

const RE_DATA = /^\d{2}\/\d{2}\/\d{4}$/;

describe('Razão Domínio com histórico fantasma', () => {
  const p1 = extrairCampos(fixture.pagina1 as Pagina);
  const p6 = extrairCampos(fixture.pagina6 as Pagina);

  it('extrai lançamentos das duas páginas', () => {
    expect(p1.length).toBeGreaterThan(5);
    expect(p6.length).toBeGreaterThan(5);
  });

  it('TODO lançamento tem data válida no formato dd/mm/aaaa', () => {
    const semData = [...p1, ...p6].filter((f) => !RE_DATA.test((f.data ?? '').trim()));
    expect(semData.map((f) => f.data)).toEqual([]);
  });

  it('as datas caem no período do relatório (05/2026 e 06/2026)', () => {
    const meses = new Set([...p1, ...p6].map((f) => f.data.slice(3)));
    expect([...meses].sort()).toEqual(['05/2026', '06/2026']);
  });

  it('nenhuma coluna numérica recebe texto do histórico', () => {
    const numericas = ['contaContrapartida', 'debito', 'credito', 'valorDc', 'saldoPeriodo', 'saldoExercicio'];
    const sujas: string[] = [];
    for (const f of [...p1, ...p6]) {
      for (const col of numericas) {
        const v = (f[col] ?? '').trim();
        // aceita vazio, número (com . e ,) e o sufixo D/C do Domínio
        if (v && !/^[\d.,\s]*[DC]?$/.test(v)) sujas.push(`${col}="${v}"`);
      }
    }
    expect(sujas).toEqual([]);
  });

  it('o histórico não vem repetido', () => {
    const repetidos = [...p1, ...p6].filter((f) => {
      const d = (f.descricao ?? '').trim();
      if (d.length < 12) return false;
      const metade = d.slice(0, Math.floor(d.length / 2)).trim();
      return metade.length > 8 && d.slice(Math.floor(d.length / 2)).trim().startsWith(metade);
    });
    expect(repetidos.map((f) => f.descricao)).toEqual([]);
  });

  /** "1.000,00" / "1000,00" → 1000 (o merge normaliza o separador de milhar). */
  const valor = (s: string) => Number((s || '0').replace(/\./g, '').replace(',', '.'));

  it('lê o débito na coluna Débito (SAQUE DINHEIRO ATM 04/05/2026)', () => {
    const l = p1.find((f) => f.data === '04/05/2026' && /SAQUE DINHEIRO ATM/.test(f.descricao ?? ''));
    expect(l).toBeDefined();
    expect(valor(l!.debito)).toBeCloseTo(1000, 2);
    expect(l!.credito.trim()).toBe('');
  });

  it('lê o crédito na coluna Crédito (PAGAMENTO PIX 1.220,00 em 03/06/2026)', () => {
    const l = p6.find((f) => f.data === '03/06/2026' && /HUDSON/.test(f.descricao ?? ''));
    expect(l).toBeDefined();
    expect(valor(l!.credito)).toBeCloseTo(1220, 2);
    expect(l!.debito.trim()).toBe('');
  });

  /**
   * Ponta a ponta: é isso que chega no balancete. Antes, o import dizia
   * "826 lançamentos" mas o razão ficava sem data e sem valor, então o
   * balancete não tinha nenhum mês com débito/crédito para mostrar.
   */
  describe('conversão para o razão', () => {
    const vision = [...paraVision(p1), ...paraVision(p6)];

    it('gera lançamentos', () => {
      expect(vision.length).toBeGreaterThan(10);
    });

    it('todo lançamento tem data dentro do período do relatório', () => {
      const foraDoPeriodo = vision
        .map((v) => v.data ?? '')
        .filter((d) => !/^\d{2}\/(05|06)\/2026$/.test(d));
      expect(foraDoPeriodo).toEqual([]);
    });

    it('todo lançamento tem valor em débito OU crédito', () => {
      const semValor = vision.filter(
        (v) => Math.abs(v.debito ?? 0) < 0.005 && Math.abs(v.credito ?? 0) < 0.005,
      );
      expect(semValor.map((v) => `${v.data} ${v.nome}`)).toEqual([]);
    });

    it('nunca lança débito e crédito na mesma linha', () => {
      const ambos = vision.filter(
        (v) => Math.abs(v.debito ?? 0) >= 0.005 && Math.abs(v.credito ?? 0) >= 0.005,
      );
      expect(ambos.map((v) => `${v.data} ${v.nome}`)).toEqual([]);
    });

    it('separa débito de crédito pela coluna de origem', () => {
      // SAQUE DINHEIRO ATM 04/05/2026 está na coluna Débito (1.000,00)
      const deb = vision.find((v) => v.data === '04/05/2026' && /SAQUE DINHEIRO ATM/.test(v.nome ?? ''));
      expect(deb).toBeDefined();
      expect(deb!.debito).toBeCloseTo(1000, 2);
      expect(deb!.credito ?? 0).toBeCloseTo(0, 2);

      // PAGAMENTO PIX ... HUDSON 03/06/2026 está na coluna Crédito (1.220,00)
      const cred = vision.find((v) => v.data === '03/06/2026' && /HUDSON/.test(v.nome ?? ''));
      expect(cred).toBeDefined();
      expect(cred!.credito).toBeCloseTo(1220, 2);
      expect(cred!.debito ?? 0).toBeCloseTo(0, 2);
    });
  });
});
