import * as XLSX from 'xlsx';
import { readSpreadsheetGrid } from './dominioPlanoExcel';

export type FiscalCfopCatalogoEntry = { grupo: string; descricao: string };
export type FiscalCfopCatalogoImportado = Record<string, FiscalCfopCatalogoEntry>;

function normCell(val: unknown): string {
  return String(val ?? '')
    .trim()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

function cellStr(val: unknown): string {
  return String(val ?? '').trim();
}

function normalizarCfopCodigo(raw: string): string {
  const c = raw.replace(/\D/g, '');
  if (c.length < 4) return '';
  return c.padStart(4, '0').slice(-4);
}

type CfopExcelCols = { grupo: number; cfop: number; descricao: number };

function findCfopExcelColumns(rows: unknown[][]): { headerRow: number; cols: CfopExcelCols } | null {
  for (let ri = 0; ri < Math.min(rows.length, 20); ri++) {
    const row = rows[ri];
    if (!Array.isArray(row)) continue;
    const norms = row.map(normCell);
    const ciGrupo = norms.findIndex((h) => h.includes('grupo'));
    const ciCfop = norms.findIndex((h) => h === 'cfop' || h.includes('cfop'));
    const ciDescricao = norms.findIndex((h) => h.includes('descri'));
    if (ciCfop < 0 || ciDescricao < 0) continue;
    return {
      headerRow: ri,
      cols: { grupo: ciGrupo, cfop: ciCfop, descricao: ciDescricao },
    };
  }
  return null;
}

/** Converte a grade da planilha (Grupo · CFOP · Descrição) num catálogo por código CFOP. */
export function parseCfopExcelGrid(rows: unknown[][]): {
  catalogo: FiscalCfopCatalogoImportado;
  issues: string[];
} {
  const layout = findCfopExcelColumns(rows);
  if (!layout) {
    return { catalogo: {}, issues: ['Não encontrei as colunas CFOP e Descrição no arquivo. Verifique o cabeçalho.'] };
  }

  const { headerRow, cols } = layout;
  const catalogo: FiscalCfopCatalogoImportado = {};
  let linhasValidas = 0;

  for (let ri = headerRow + 1; ri < rows.length; ri++) {
    const row = rows[ri];
    if (!Array.isArray(row)) continue;
    const cfop = normalizarCfopCodigo(cellStr(row[cols.cfop]));
    const descricao = cellStr(row[cols.descricao]);
    if (!cfop || !descricao) continue;
    const grupo = cols.grupo >= 0 ? cellStr(row[cols.grupo]) : '';
    catalogo[cfop] = { grupo, descricao };
    linhasValidas += 1;
  }

  const issues = linhasValidas === 0 ? ['Nenhuma linha válida de CFOP encontrada no arquivo.'] : [];
  return { catalogo, issues };
}

export async function readCfopExcelFile(file: File): Promise<unknown[][]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return readSpreadsheetGrid(bytes);
}

export async function parseCfopExcelFile(file: File): Promise<{
  catalogo: FiscalCfopCatalogoImportado;
  issues: string[];
}> {
  const rows = await readCfopExcelFile(file);
  if (rows.length === 0) {
    return { catalogo: {}, issues: ['Não consegui ler o arquivo. Verifique se é um .xlsx/.xls/.csv válido.'] };
  }
  return parseCfopExcelGrid(rows);
}

/**
 * Modelo de exemplo — qualquer planilha com colunas "Grupo", "CFOP" e "Descrição" (em qualquer
 * ordem, com colunas extras à vontade) pode ser importada; este arquivo é só um ponto de partida.
 */
export function downloadCfopExcelModelo(): void {
  const headers = ['Grupo', 'CFOP', 'Descrição'];
  const exemplo: string[][] = [
    ['Compra para revenda', '1102', 'Compra para comercialização'],
    ['Compra para revenda', '2102', 'Compra para comercialização'],
    ['Venda de mercadoria', '5102', 'Venda de mercadoria adquirida de terceiros'],
    ['Venda de mercadoria', '6102', 'Venda de mercadoria adquirida de terceiros'],
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, ...exemplo]);
  ws['!cols'] = [{ wch: 26 }, { wch: 10 }, { wch: 60 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'CFOP');
  XLSX.writeFile(wb, 'modelo_cfop.xlsx');
}
