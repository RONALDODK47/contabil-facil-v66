import * as XLSX from 'xlsx';
import type { VisionBalanceteRow, VisionPlanoRow } from '../types/accounting';
import { acceptCodigoReduzidoFromFile, inferPlanoTipoSa } from '../../contabilfacil/logic/planoContasMapper';
import {
  isPlanoDominioExcelGrid,
  parsePlanoDominioExcelGrid,
} from '../../contabilfacil/logic/dominioPlanoExcel';
import { parseDataRazao } from './razaoContabil';
import { extratoDateToIso } from './parser';

function normHeader(val: unknown): string {
  return String(val ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function parseMoedaBr(val: unknown): number {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const s = String(val).trim();
  const clean = s.replace(/\./g, '').replace(',', '.').replace(/[^-0-9.]/g, '');
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : Math.abs(n);
}

function codeLengthToLevel(len: number): number {
  if (len <= 1) return 1;
  if (len <= 2) return 2;
  if (len <= 3) return 3;
  if (len <= 5) return 4;
  if (len <= 10) return 5;
  return 6;
}

export function inferAccountTypes(rows: VisionPlanoRow[]): VisionPlanoRow[] {
  const sorted = [...rows].sort((a, b) => a.codigo.localeCompare(b.codigo));
  return rows.map((row) => {
    if (row.tipo === 'S' || row.tipo === 'A') return row;
    const fromFields = inferPlanoTipoSa({
      code: row.codigo,
      codigoReduzido: row.codigoReduzido,
      nivel: row.nivel,
    });
    const cleanCode = row.codigo.replace(/\./g, '');
    const isSintetica = sorted.some((other) => {
      if (other.codigo === row.codigo) return false;
      return other.codigo.replace(/\./g, '').startsWith(cleanCode);
    });
    const tipo = isSintetica ? 'S' : fromFields;
    return { ...row, tipo };
  });
}

function downloadSheet(filename: string, sheetName: string, rows: unknown[][]) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = rows[0]?.map((_, i) => {
    const maxLen = Math.max(...rows.map((r) => String(r[i] ?? '').length), 10);
    return { wch: Math.min(maxLen + 2, 40) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

export const PLANO_CONTAS_MODELO_HEADERS = [
  'Código Reduzido',
  'Código',
  'Descrição',
  'Tipo',
] as const;

export const RAZAO_MODELO_HEADERS = [
  'Data',
  'Código',
  'Classificação',
  'Descrição',
  'Débito',
  'Crédito',
] as const;

const PLANO_CONTAS_MODELO_EXEMPLO: string[][] = [
  ['', '1', 'ATIVO', 'S'],
  ['', '11', 'ATIVO CIRCULANTE', 'S'],
  ['', '111', 'DISPONÍVEL', 'S'],
  ['', '11101', 'CAIXA', 'S'],
  ['', '111010001', 'CAIXA GERAL', 'A'],
  ['', '2', 'PASSIVO', 'S'],
  ['', '21', 'PASSIVO CIRCULANTE', 'S'],
  ['', '211', 'FORNECEDORES', 'S'],
  ['', '211010001', 'FORNECEDORES NACIONAIS', 'A'],
];

const RAZAO_MODELO_EXEMPLO: (string | number)[][] = [
  ['01/01/2025', '0000005', '111010001', 'CAIXA GERAL', '1.000,00', ''],
  ['15/01/2025', '0000005', '111010001', 'CAIXA GERAL', '', '500,00'],
  ['20/01/2025', '0000009', '211010001', 'FORNECEDORES NACIONAIS', '', '300,00'],
];

export function downloadPlanoContasModelo() {
  downloadSheet('modelo_plano_contas.xlsx', 'Plano de Contas', [
    [...PLANO_CONTAS_MODELO_HEADERS],
    ...PLANO_CONTAS_MODELO_EXEMPLO,
  ]);
}

export function downloadRazaoModelo() {
  downloadSheet('modelo_razao.xlsx', 'Razão', [
    [...RAZAO_MODELO_HEADERS],
    ...RAZAO_MODELO_EXEMPLO,
  ]);
}

export const EXTRATO_MODELO_HEADERS = ['Data', 'Histórico', 'Valor', 'D/C'] as const;

const EXTRATO_MODELO_EXEMPLO: (string | number)[][] = [
  ['01/02/2026', 'PIX RECEBIDO CLIENTE', '1.500,00', 'C'],
  ['05/02/2026', 'TARIFA BANCARIA', '29,90', 'D'],
  ['10/02/2026', 'TED FORNECEDOR', '3.200,00', 'D'],
];

export function downloadExtratoModelo() {
  downloadSheet('modelo_extrato.xlsx', 'Extrato', [
    [...EXTRATO_MODELO_HEADERS],
    ...EXTRATO_MODELO_EXEMPLO,
  ]);
}

export type ExtratoModeloRow = {
  date: string;
  description: string;
  value: number;
  nature: 'D' | 'C';
};

// Datas de célula Excel chegam como número de série (dias desde 1899-12-30) quando a
// coluna está formatada como Data — sem essa conversão a linha era descartada.
function excelSerialToIso(serial: number): string {
  const utcDays = Math.floor(serial - 25569);
  const utcMs = utcDays * 86400 * 1000;
  const d = new Date(utcMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

function parseExtratoModeloData(val: unknown): string {
  if (typeof val === 'number' && val > 0) return excelSerialToIso(val);
  return extratoDateToIso(String(val ?? '').trim());
}

export function isExtratoModelo(rawRows: unknown[][]): boolean {
  const header = (rawRows[0] ?? []).map(normHeader);
  return header.includes('data') && header.includes('valor');
}

/** Lê a planilha modelo de extrato (Data; Histórico; Valor; D/C). */
export function parseExtratoSheet(rawRows: unknown[][]): ExtratoModeloRow[] {
  if (rawRows.length === 0) return [];
  const header = rawRows[0].map(normHeader);
  const idxData = header.findIndex((h) => h === 'data');
  const idxHistorico = header.findIndex((h) => h === 'historico');
  const idxValor = header.findIndex((h) => h === 'valor');
  const idxDc = header.findIndex((h) => h === 'd/c' || h === 'dc' || h === 'd / c');
  if (idxData === -1 || idxValor === -1) return [];

  const rows: ExtratoModeloRow[] = [];
  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.every((c) => c === '' || c == null)) continue;

    const dateIso = parseExtratoModeloData(row[idxData]);
    if (!dateIso) continue;

    const value = parseMoedaBr(row[idxValor]);
    if (!value) continue;

    const dcRaw = idxDc !== -1 ? String(row[idxDc] ?? '').trim().toUpperCase() : '';
    const nature: 'D' | 'C' = dcRaw.startsWith('D') ? 'D' : 'C';
    const description = idxHistorico !== -1 ? String(row[idxHistorico] ?? '').trim() : '';

    rows.push({ date: dateIso, description: description || 'LANÇAMENTO', value, nature });
  }
  return rows;
}

export const EMPRESTIMOS_MODELO_HEADERS = [
  'Empresa',
  'Contrato',
  'Tipo',
  'Principal',
  'Taxa (%)',
  'Parcelas',
  'Data Início',
  'Carência (meses)',
  'Tipo Carência',
  'Indexador',
  'IOF',
  'Custos',
] as const;

const EMPRESTIMOS_MODELO_EXEMPLO: (string | number)[][] = [
  [
    'TECHNOVA INDUSTRIAL LTDA',
    '2026-CCB-402',
    'SAC',
    '150000',
    '11.5',
    '24',
    '2026-05-15',
    '3',
    'capitalized',
    'CDI',
    '2840',
    '120',
  ],
];

export function downloadEmprestimosModelo() {
  downloadSheet('modelo_emprestimos.xlsx', 'Contratos', [
    [...EMPRESTIMOS_MODELO_HEADERS],
    ...EMPRESTIMOS_MODELO_EXEMPLO,
  ]);
}

export const APLICACOES_MODELO_HEADERS = [
  'Nome Ativo',
  'Valor Aplicado',
  'Taxa (%)',
  'Indexador',
  'Data Aplicação',
] as const;

const APLICACOES_MODELO_EXEMPLO: (string | number)[][] = [
  ['CDB DI LIQUIDEZ DIÁRIA ITAÚ', '95000', '100', 'CDI', '2026-01-10'],
];

export function downloadAplicacoesModelo() {
  downloadSheet('modelo_aplicacoes.xlsx', 'Aplicações', [
    [...APLICACOES_MODELO_HEADERS],
    ...APLICACOES_MODELO_EXEMPLO,
  ]);
}

function sheetRowsFromFile(file: File): Promise<unknown[][]> {
  return file.arrayBuffer().then((buffer) => {
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return [];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
  });
}

function colIndexByHeader(head: string[], patterns: RegExp[]): number {
  return head.findIndex((h) => patterns.some((re) => re.test(h)));
}

/** Importa planilha Excel do módulo Empréstimos (modelo ou colunas equivalentes). */
export async function parseEmprestimosExcelFile(file: File) {
  const rawRows = await sheetRowsFromFile(file);
  return parseEmprestimosSheet(rawRows);
}

export function parseEmprestimosSheet(rawRows: unknown[][]): Record<string, unknown>[] {
  if (!rawRows?.length) return [];
  const head = (rawRows[0] as unknown[])?.map(normHeader) ?? [];
  const hasHeader = head.some((h) => /empresa|contrato|principal/.test(h));
  const slice = hasHeader ? (rawRows.slice(1) as unknown[][]) : (rawRows as unknown[][]);

  const ci = (patterns: RegExp[]) => {
    const idx = colIndexByHeader(head, patterns);
    return hasHeader && idx >= 0 ? idx : -1;
  };

  const colEmpresa = ci([/empresa/]) >= 0 ? ci([/empresa/]) : 0;
  const colContrato = ci([/contrato/]) >= 0 ? ci([/contrato/]) : 1;
  const colTipo = ci([/^tipo$/]) >= 0 ? ci([/^tipo$/]) : 2;
  const colPrincipal = ci([/principal/]) >= 0 ? ci([/principal/]) : 3;
  const colTaxa = ci([/taxa/]) >= 0 ? ci([/taxa/]) : 4;
  const colParcelas = ci([/parcela/]) >= 0 ? ci([/parcela/]) : 5;
  const colData = ci([/data/]) >= 0 ? ci([/data/]) : 6;
  const colCarencia = ci([/carenc/]) >= 0 ? ci([/carenc/]) : 7;
  const colTipoCarencia = ci([/tipo.*carenc|carenc.*tipo/]) >= 0 ? ci([/tipo.*carenc|carenc.*tipo/]) : 8;
  const colIndexador = ci([/index/]) >= 0 ? ci([/index/]) : 9;
  const colIof = ci([/^iof$/]) >= 0 ? ci([/^iof$/]) : 10;
  const colCustos = ci([/custo/]) >= 0 ? ci([/custo/]) : 11;

  const out: Record<string, unknown>[] = [];
  for (const row of slice) {
    if (!Array.isArray(row)) continue;
    const companyName = String(row[colEmpresa] ?? '').trim();
    const contractNumber = String(row[colContrato] ?? '').trim();
    if (!companyName && !contractNumber) continue;
    if (/^empresa$|^contrato$/i.test(companyName)) continue;

    const typeRaw = String(row[colTipo] ?? 'SAC').trim().toUpperCase();
    const type = typeRaw === 'PRICE' ? 'PRICE' : 'SAC';
    const principal = parseMoedaBr(row[colPrincipal]) || parseFloat(String(row[colPrincipal] ?? '0')) || 10000;
    const interestRate = parseFloat(String(row[colTaxa] ?? '0').replace(',', '.')) || 10;
    const installments = parseInt(String(row[colParcelas] ?? '12').replace(/\D/g, ''), 10) || 12;
    const startDate = String(row[colData] ?? new Date().toISOString().split('T')[0]).trim();
    const gracePeriod = parseInt(String(row[colCarencia] ?? '0').replace(/\D/g, ''), 10) || 0;
    const graceTypeRaw = String(row[colTipoCarencia] ?? 'capitalized').trim().toLowerCase();
    const graceType = graceTypeRaw === 'paid' ? 'paid' : 'capitalized';
    const indexRaw = String(row[colIndexador] ?? 'NONE').trim().toUpperCase();
    const indexType = ['CDI', 'IPCA', 'PRE', 'NONE'].includes(indexRaw) ? indexRaw : 'NONE';
    const iof = parseMoedaBr(row[colIof]) || parseFloat(String(row[colIof] ?? '0')) || 0;
    const costs = parseMoedaBr(row[colCustos]) || parseFloat(String(row[colCustos] ?? '0')) || 0;

    out.push({
      id: crypto.randomUUID(),
      companyName: companyName.toUpperCase() || 'EMPRESA PADRAO LTDA',
      contractNumber: contractNumber.toUpperCase() || `CTR-${Math.floor(1000 + Math.random() * 9000)}`,
      type,
      principal,
      interestRate,
      installments,
      startDate,
      gracePeriod,
      graceType,
      indexType,
      iof,
      costs,
    });
  }
  return out;
}

/** Importa planilha Excel do módulo Aplicações (modelo ou colunas equivalentes). */
export async function parseAplicacoesExcelFile(file: File) {
  const rawRows = await sheetRowsFromFile(file);
  return parseAplicacoesSheet(rawRows);
}

export function parseAplicacoesSheet(rawRows: unknown[][]): Record<string, unknown>[] {
  if (!rawRows?.length) return [];
  const head = (rawRows[0] as unknown[])?.map(normHeader) ?? [];
  const hasHeader = head.some((h) => /nome|ativo|valor|index/.test(h));
  const slice = hasHeader ? (rawRows.slice(1) as unknown[][]) : (rawRows as unknown[][]);

  const ci = (patterns: RegExp[]) => colIndexByHeader(head, patterns);
  const colNome = hasHeader && ci([/nome|ativo/]) >= 0 ? ci([/nome|ativo/]) : 0;
  const colValor = hasHeader && ci([/valor|aplicad/]) >= 0 ? ci([/valor|aplicad/]) : 1;
  const colTaxa = hasHeader && ci([/taxa/]) >= 0 ? ci([/taxa/]) : 2;
  const colIndex = hasHeader && ci([/index/]) >= 0 ? ci([/index/]) : 3;
  const colData = hasHeader && ci([/data/]) >= 0 ? ci([/data/]) : 4;

  const out: Record<string, unknown>[] = [];
  for (const row of slice) {
    if (!Array.isArray(row)) continue;
    const name = String(row[colNome] ?? '').trim();
    if (!name || /^nome|ativo$/i.test(name)) continue;
    const amount = parseMoedaBr(row[colValor]) || parseFloat(String(row[colValor] ?? '0')) || 5000;
    const rate = parseFloat(String(row[colTaxa] ?? '0').replace(',', '.')) || 100;
    const index = String(row[colIndex] ?? 'CDI').trim().toUpperCase() || 'CDI';
    const startDate = String(row[colData] ?? new Date().toISOString().split('T')[0]).trim();

    out.push({
      id: crypto.randomUUID(),
      name: name.toUpperCase(),
      folder: 'IMPORTADO',
      amount,
      rate,
      index,
      startDate,
    });
  }
  return out;
}

export function isPlanoContasModelo(rawRows: unknown[][]): boolean {
  if (!rawRows?.length) return false;
  const head = (rawRows[0] as unknown[])?.map(normHeader) ?? [];
  const hasCodigo = head.some((h) => /^codigo$/.test(h) || h === 'cod');
  const hasDesc = head.some((h) => /descri|nome/.test(h));
  const hasTipo = head.some((h) => /^tipo$/.test(h));
  return hasCodigo && hasDesc;
}

export function isRazaoModelo(rawRows: unknown[][]): boolean {
  if (!rawRows?.length) return false;
  const head = (rawRows[0] as unknown[])?.map(normHeader) ?? [];
  const hasData = head.some((h) => /^data$/.test(h));
  const hasDeb = head.some((h) => /debito/.test(h));
  const hasCred = head.some((h) => /credito/.test(h));
  return hasData && hasDeb && hasCred;
}

/** Valor monetário com indicador D/C opcional (ex.: 1.234,56 D). */
export function parseValorDc(val: unknown): { valor: number; natureza?: 'D' | 'C' } {
  if (typeof val === 'number') {
    if (Math.abs(val) < 1e-9) return { valor: 0 };
    return { valor: Math.abs(val), natureza: val < 0 ? 'C' : 'D' };
  }
  const s = String(val ?? '').trim();
  if (!s) return { valor: 0 };
  const natMatch = s.match(/\s*([DC])\s*$/i);
  const natureza = natMatch ? (natMatch[1].toUpperCase() as 'D' | 'C') : undefined;
  const num = parseMoedaBr(s.replace(/\s*[DC]\s*$/i, ''));
  return { valor: num, natureza };
}

export function isBalanceteModelo(rawRows: unknown[][]): boolean {
  if (!rawRows?.length) return false;
  const head = (rawRows[0] as unknown[])?.map(normHeader) ?? [];
  const hasDeb = head.some((h) => /debito/.test(h));
  const hasCred = head.some((h) => /credito/.test(h));
  const hasSaldo =
    head.some((h) => /saldo\s*(anterior|inicial|atual|final)/.test(h)) ||
    head.some((h) => /^saldo$/.test(h));
  const hasData = head.some((h) => /^data$/.test(h));
  return hasDeb && hasCred && hasSaldo && !hasData;
}

/** Importa planilha de balancete (Domínio / relatório com saldos). */
export function parseBalanceteSheet(rawRows: unknown[][]): VisionBalanceteRow[] {
  const out: VisionBalanceteRow[] = [];
  if (!rawRows?.length) return out;

  const head = (rawRows[0] as unknown[])?.map(normHeader) ?? [];
  const coi = head.findIndex((h) => /reduzido|^codigo$|^cod$/.test(h));
  const cli = head.findIndex((h) => /classifica/.test(h));
  const ni = head.findIndex((h) => /descri|nome|conta|histor/.test(h));
  const sii = head.findIndex((h) => /saldo\s*(anterior|inicial)/.test(h) || h === 'saldo anterior');
  const debi = head.findIndex((h) => /debito/.test(h));
  const cri = head.findIndex((h) => /credito/.test(h));
  const sfi = head.findIndex((h) => /saldo\s*(atual|final)/.test(h) || (h === 'saldo' && sii < 0));

  const hasHeader = debi >= 0 || cli >= 0 || coi >= 0;
  const slice = hasHeader ? (rawRows.slice(1) as unknown[][]) : (rawRows as unknown[][]);

  for (let i = 0; i < slice.length; i++) {
    const row = slice[i];
    if (!Array.isArray(row)) continue;

    const codigo = coi >= 0 ? String(row[coi] ?? '').trim() : '';
    let classificacao = cli >= 0 ? String(row[cli] ?? '').trim() : '';
    let nome = ni >= 0 ? String(row[ni] ?? '').trim() : '';

    if (!classificacao && codigo && codigo.includes('.')) {
      classificacao = codigo;
    }
    if (!codigo && classificacao && !classificacao.includes('.')) {
      // código reduzido na coluna classificação
    }

    const si = sii >= 0 ? parseValorDc(row[sii]) : { valor: 0 as number };
    const debito = debi >= 0 ? parseMoedaBr(row[debi]) : 0;
    const credito = cri >= 0 ? parseMoedaBr(row[cri]) : 0;
    const sf = sfi >= 0 ? parseValorDc(row[sfi]) : { valor: 0 as number };

    if (!codigo && !classificacao && !nome) continue;
    if (/^codigo|^classifica|^debito|^credito|^saldo/i.test(codigo)) continue;

    out.push({
      codigo,
      classificacao: classificacao || undefined,
      nome,
      ordem: i + 1,
      saldoInicial: si.valor,
      naturezaSaldoInicial: si.natureza,
      debito,
      credito,
      saldoFinal: sf.valor,
      naturezaSaldoFinal: sf.natureza,
    });
  }

  return out;
}

/** Importa planilha Excel/CSV do plano de contas (modelo, Domínio ou colunas equivalentes). */
export function parsePlanoContasSheet(rawRows: unknown[][]): VisionPlanoRow[] {
  if (isPlanoDominioExcelGrid(rawRows)) {
    const dominio = parsePlanoDominioExcelGrid(rawRows);
    if (dominio.length > 0) return dominio;
  }

  const out: VisionPlanoRow[] = [];
  if (!rawRows?.length) return out;

  const head = (rawRows[0] as unknown[])?.map(normHeader) ?? [];
  const ri = head.findIndex((h) => /reduzido|seq|numero/.test(h));
  const ci = head.findIndex(
    (h, idx) =>
      idx !== ri &&
      (/classifica/.test(h) || /^codigo$/.test(h) || /^conta$/.test(h) || (/\bcod\b/.test(h) && !/reduzido/.test(h))),
  );
  const ni = head.findIndex((h) => /descri|nome|denom/.test(h));
  const ti = head.findIndex((h) => /^tipo$/.test(h) || /^sa$/.test(h) || /sintet|analit/.test(h));

  const hasHeader = ci >= 0 && ni >= 0;
  const slice = hasHeader ? (rawRows.slice(1) as unknown[][]) : (rawRows as unknown[][]);
  const colCodigo = ci >= 0 ? ci : 1;
  const colNome = ni >= 0 ? ni : 2;
  const colTipo = ti;
  const colReduzido = ri;

  for (const row of slice) {
    if (!Array.isArray(row)) continue;
    const codigo = String(row[colCodigo] ?? '').trim();
    const nome = String(row[colNome] ?? '').trim();
    if (!codigo && !nome) continue;
    if (/^codigo|^descri|^tipo|^classifica/i.test(codigo)) continue;

    let tipoRaw = colTipo >= 0 ? String(row[colTipo] ?? '').trim().toUpperCase() : '';
    if (tipoRaw.startsWith('SINT')) tipoRaw = 'S';
    if (tipoRaw.startsWith('ANAL')) tipoRaw = 'A';
    const tipo: 'S' | 'A' | undefined =
      tipoRaw === 'S' || tipoRaw === 'A' ? tipoRaw : undefined;

    const codigoReduzido =
      colReduzido >= 0
        ? acceptCodigoReduzidoFromFile(String(row[colReduzido] ?? ''), codigo, 'excel_column')
        : undefined;
    const nivel = codeLengthToLevel(codigo.replace(/\./g, '').length);

    out.push({
      codigo: codigo || '—',
      nome: nome || '—',
      tipo,
      codigoReduzido,
      nivel,
    });
  }

  return inferAccountTypes(out);
}

/** Importa planilha Excel/CSV do razão (modelo ou colunas equivalentes). */
export function parseRazaoSheet(rawRows: unknown[][]): VisionBalanceteRow[] {
  const out: VisionBalanceteRow[] = [];
  if (!rawRows?.length) return out;

  const head = (rawRows[0] as unknown[])?.map(normHeader) ?? [];
  const di = head.findIndex((h) => /^data$/.test(h));
  const coi = head.findIndex((h) => /^codigo$/.test(h) || h === 'cod');
  const cli = head.findIndex((h) => /classifica/.test(h));
  const ni = head.findIndex((h) => /descri|nome|histor/.test(h));
  const debi = head.findIndex((h) => /debito/.test(h));
  const cri = head.findIndex((h) => /credito/.test(h));

  const hasHeader = di >= 0 || debi >= 0;
  const slice = hasHeader ? (rawRows.slice(1) as unknown[][]) : (rawRows as unknown[][]);

  for (let i = 0; i < slice.length; i++) {
    const row = slice[i];
    if (!Array.isArray(row)) continue;

    const data = di >= 0 ? parseDataRazao(row[di]) : '';
    const codigo = coi >= 0 ? String(row[coi] ?? '').trim() : '';
    const classificacao = cli >= 0 ? String(row[cli] ?? '').trim() : '';
    const nome = ni >= 0 ? String(row[ni] ?? '').trim() : '';
    const debito = debi >= 0 ? parseMoedaBr(row[debi]) : 0;
    const credito = cri >= 0 ? parseMoedaBr(row[cri]) : 0;

    if (!codigo && !classificacao && !nome) continue;
    if (/^data$|^codigo$|^debito$|^credito$/i.test(codigo)) continue;

    out.push({
      codigo,
      classificacao: classificacao || undefined,
      nome,
      data: data || undefined,
      ordem: i + 1,
      saldoInicial: 0,
      debito,
      credito,
      saldoFinal: 0,
    });
  }

  return out;
}
