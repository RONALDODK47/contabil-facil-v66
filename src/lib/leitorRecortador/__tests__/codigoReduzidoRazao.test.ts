import { describe, it, expect } from 'vitest';
import fixture from './fixtures/razaoDominioFantasma.json';
import { detectRazaoRowsFromText, extractRazaoDataFromCanvas } from '../razaoRowDetection';
import { extractCodigoReduzidoContaFromCluster } from '../razaoLineParser';
import { resolveRazaoColumnsForPage, assignRazaoRowTokens, mappingToRazaoColPixels } from '../razaoColumnPrecision';
import { mergeRazaoFieldsFromLine } from '../razaoLineParser';
import { buildDefaultColumnMapping } from '../columnDefaults';
import { mapGenericRowsToOcrRows } from '../rowMappers';
import { mapOcrRowsToRazaoVision } from '../../../contabilfacil/logic/ocrImportMapper';
import { normalizeRazaoImport } from '../../../contabilfacil/logic/contabilPipeline';
import type { PDFTextItem } from '../types';

/**
 * Conta Débito / Conta Crédito só podem conter o código REDUZIDO.
 *
 * O razão do Domínio traz o reduzido no cabeçalho de cada conta
 * ("Conta: 5 - 1.1.1.01.00001 CAIXA GERAL"). O import ignorava esse "5" e
 * gravava a classificação sem os pontos ("1110100001") — um número que não
 * corresponde a conta nenhuma do plano.
 */

const COLUMN_IDS = [
  'data', 'descricao', 'contaPartida', 'contaContrapartida',
  'debito', 'credito', 'valorDc', 'saldoPeriodo', 'saldoExercicio',
];

type Pagina = { width: number; height: number; textItems: PDFTextItem[] };

function paraVision(pagina: Pagina) {
  const columns = resolveRazaoColumnsForPage(
    pagina.textItems, pagina.width, COLUMN_IDS, buildDefaultColumnMapping(COLUMN_IDS),
  );
  const colPixels = mappingToRazaoColPixels(columns, COLUMN_IDS, pagina.width);
  const rows = detectRazaoRowsFromText(pagina.textItems);

  const genericos = rows.map((row, i) => {
    const items = [...row.items].sort((a, b) => a.x - b.x);
    const vistos = new Set<string>();
    const toks: string[] = [];
    for (const it of items) {
      const t = it.text.trim();
      if (!t) continue;
      if (/[A-Za-zÀ-ÿ]{3}/.test(t)) { if (vistos.has(t)) continue; vistos.add(t); }
      toks.push(t);
    }
    const parts = assignRazaoRowTokens(items, colPixels, pagina.width, COLUMN_IDS);
    const fields: Record<string, string> = {};
    COLUMN_IDS.forEach((id) => { fields[id] = (parts[id] || []).join(' ').trim(); });
    Object.assign(
      fields,
      mergeRazaoFieldsFromLine(fields, toks.join(' '), row.classificacaoConta, row.codigoReduzidoConta),
    );
    return { id: `r${i}`, fields, cropUrls: {}, cropBounds: {}, y: row.y, height: row.height, pageNumber: 1 };
  });

  return normalizeRazaoImport(mapOcrRowsToRazaoVision(mapGenericRowsToOcrRows(genericos, COLUMN_IDS)).items);
}

/** Classificação achatada: 8+ dígitos, do jeito que "1.1.1.01.00001" vira. */
const pareceClassificacaoAchatada = (s: string) => /^\d{8,}$/.test(s.trim());

describe('código reduzido em Conta Débito / Conta Crédito', () => {
  it('lê o reduzido do cabeçalho "Conta: 5 - 1.1.1.01.00001 CAIXA GERAL"', () => {
    const cluster = [
      { str: 'Conta:', x: 0 },
      { str: '5', x: 60 },
      { str: '-', x: 69 },
      { str: '1.1.1.01.00001', x: 76 },
      { str: 'CAIXA GERAL', x: 210 },
    ];
    expect(extractCodigoReduzidoContaFromCluster(cluster)).toBe('5');
  });

  it('lê reduzido de mais de um dígito', () => {
    const cluster = [
      { str: 'Conta:', x: 0 },
      { str: '1000', x: 60 },
      { str: '-', x: 69 },
      { str: '1.1.2.01.00001', x: 76 },
      { str: 'CLIENTES DIVERSOS', x: 210 },
    ];
    expect(extractCodigoReduzidoContaFromCluster(cluster)).toBe('1000');
  });

  it('devolve null quando não há classificação no cabeçalho', () => {
    expect(extractCodigoReduzidoContaFromCluster([{ str: 'SALDO ANTERIOR', x: 81 }])).toBeNull();
  });

  it('detectRazaoRowsFromText propaga o reduzido da conta', () => {
    const rows = detectRazaoRowsFromText((fixture.pagina1 as Pagina).textItems);
    const comConta = rows.filter((r) => r.classificacaoConta);
    expect(comConta.length).toBeGreaterThan(0);
    expect(comConta.every((r) => !!r.codigoReduzidoConta)).toBe(true);
    // primeira conta da página 1 é a 5 - 1.1.1.01.00001 CAIXA GERAL
    expect(comConta[0]!.codigoReduzidoConta).toBe('5');
  });

  it('NENHUM lançamento sai com classificação achatada em contaDeb/contaCred', () => {
    const vision = [...paraVision(fixture.pagina1 as Pagina), ...paraVision(fixture.pagina6 as Pagina)];
    expect(vision.length).toBeGreaterThan(10);

    const ruins: string[] = [];
    for (const v of vision) {
      for (const campo of ['contaDeb', 'contaCred', 'codigo'] as const) {
        const val = String((v as Record<string, unknown>)[campo] ?? '');
        if (!val) continue;
        if (val.includes('.')) ruins.push(`${campo}="${val}" (classificação)`);
        else if (pareceClassificacaoAchatada(val)) ruins.push(`${campo}="${val}" (classificação achatada)`);
      }
    }
    expect(ruins).toEqual([]);
  });

  it('usa o reduzido de verdade — CAIXA GERAL é 5, contrapartida BANCO SICREDI é 8', () => {
    const vision = paraVision(fixture.pagina1 as Pagina);
    const l = vision.find((v) => v.data === '04/05/2026' && /SAQUE DINHEIRO ATM/.test(v.nome ?? ''));
    expect(l).toBeDefined();
    expect(l!.contaDeb).toBe('5');
    expect(l!.contaCred).toBe('8');
  });
});
