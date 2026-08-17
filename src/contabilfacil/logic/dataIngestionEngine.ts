import type { Transaction } from '../../extratoVision/types';
import {
  extractStatementYear,
  extratoDateToIso,
} from '../../extratoVision/utils/parser';
import { ocrPdfFileToExtratoRows } from '../../lib/parcelamentoColunasExtract';
import { resolveExtratoMapImportOptions } from '../../lib/itauExtratoProfile';
import { parseOcrIgnoreLineWords } from '../../lib/ocrExtratoPositional';
import { getOcrUserSettings } from '../../lib/ocrUserSettings';
import { mapOcrRowsToImportItems } from './ocrImportMapper';
import { warmupSharedOcrWorker } from '../../lib/imageOcrExtract';
import * as XLSX from 'xlsx';
import {
  isBalanceteModelo,
  isRazaoModelo,
  parseBalanceteSheet,
  parseExtratoSheet,
  parsePlanoContasSheet,
  parseRazaoSheet,
} from '../../extratoVision/utils/planilhaModelo';
import { readSpreadsheetGrid } from './dominioPlanoExcel';
import { normalizeRazaoImport, visionPlanoRowsToAccountPlans } from './contabilPipeline';

export type NativeIngestDataType = 'loans' | 'installments' | 'apps' | 'extrato' | 'plano' | 'balancete' | 'folha';

export type IngestProgress = (message: string) => void;

function isExtratoImageFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return (
    ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'].includes(ext) || file.type.startsWith('image/')
  );
}

function natureFromTransaction(t: Transaction): 'D' | 'C' {
  if (t.cd === 'C' || t.cd === 'D') return t.cd;
  return t.valor < 0 ? 'D' : 'C';
}

export function extratoRowFromTransaction(
  t: Transaction,
  defaultAccount = '1.01.02.0002',
  statementYear?: string,
) {
  const iso =
    extratoDateToIso(t.data, statementYear) ||
    extratoDateToIso(t.data, String(new Date().getFullYear()));
  return {
    id: t.id || crypto.randomUUID(),
    date: iso || new Date().toISOString().split('T')[0],
    description: (t.historico || 'LANCAMENTO').toUpperCase(),
    value: Math.abs(Number(t.valor) || 0),
    nature: natureFromTransaction(t),
    accountCode: defaultAccount,
    status: 'PENDENTE' as const,
  };
}

async function ingestExtratoFile(file: File, onProgress?: IngestProgress, accountCode?: string) {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

  if (ext === 'pdf') {
    warmupSharedOcrWorker();
    onProgress?.('Limpando dados do PDF (modo scanner)…');
    const ocrRows = await ocrPdfFileToExtratoRows(file, onProgress);
    if (ocrRows.length === 0) {
      throw new Error(
        'Nenhum lançamento reconhecido no PDF via OCR. Marque colunas no painel de importação ou use imagem mais nítida.',
      );
    }
    const { items, logs } = mapOcrRowsToImportItems(
      'extrato',
      ocrRows,
      resolveExtratoMapImportOptions(
        ocrRows,
        parseOcrIgnoreLineWords(getOcrUserSettings().ignoreLineWords),
        { fileName: file.name, logToConsole: true },
      ),
    );
    if (items.length === 0) {
      throw new Error('OCR leu linhas, mas nenhuma virou lançamento válido. Revise data, histórico e valor.');
    }
    const statementYear =
      extractStatementYear(ocrRows.map((r) => [r.data, r.descricao].join(' ')).join(' ')) ||
      String(new Date().getFullYear());
    const transactions: Transaction[] = items.map((it, i) => ({
      id: it.id || `ocr-pdf-${Date.now()}-${i}`,
      data: it.date || '',
      historico: it.description || '',
      valor: it.nature === 'D' ? -Math.abs(it.value) : Math.abs(it.value),
      cd: it.nature as 'D' | 'C',
    }));
    return {
      items,
      logs: [`PDF (OCR): ${items.length} lançamento(s) (ano ref. ${statementYear}).`, ...logs.slice(0, 5)],
    };
  }

  if (['xlsx', 'xls', 'csv'].includes(ext)) {
    onProgress?.('Lendo planilha do extrato...');
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
    const rows = parseExtratoSheet(rawRows);
    if (rows.length === 0) {
      throw new Error(
        'Nenhum lançamento encontrado na planilha. Use o modelo Excel (colunas Data; Histórico; Valor; D/C).',
      );
    }
    const items = rows.map((r, i) => ({
      id: `xlsx-extrato-${Date.now()}-${i}`,
      date: r.date,
      description: r.description.toUpperCase(),
      value: r.value,
      nature: r.nature,
      accountCode: accountCode || '1.01.02.0002',
      status: 'PENDENTE' as const,
    }));
    return {
      items,
      logs: [`Planilha: ${items.length} lançamento(s) importado(s).`],
    };
  }

  if (ext === 'txt') {
    throw new Error(
      'TXT não é suportado neste botão. Use o botão TXT do painel de importação (Domínio ou TXT+).',
    );
  }

  if (isExtratoImageFile(file)) {
    throw new Error(
      'Para imagem de extrato, use o painel de importação com colunas (OCR scanner). A ingestão rápida aceita apenas PDF.',
    );
  }

  throw new Error('Formato não suportado para extrato. Use PDF escaneado via painel de colunas OCR.');
}

/** PDF/imagem com o mesmo motor da interface Extrato Vision (recomendado para extratos bancários). */
export async function ingestExtratoVisionFromDocument(
  file: File,
  onProgress?: IngestProgress,
): Promise<{ items: ReturnType<typeof extratoRowFromTransaction>[]; logs: string[] }> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf' || isExtratoImageFile(file)) {
    return ingestExtratoFile(file, onProgress) as Promise<{
      items: ReturnType<typeof extratoRowFromTransaction>[];
      logs: string[];
    }>;
  }
  throw new Error('Extração automática disponível apenas para PDF ou imagem de extrato.');
}

async function ingestPlanoFile(file: File, onProgress?: IngestProgress) {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

  if (['xlsx', 'xls', 'csv'].includes(ext)) {
    onProgress?.('Lendo planilha do plano de contas...');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const rawRows = readSpreadsheetGrid(bytes);
    const rows = parsePlanoContasSheet(rawRows);
    if (rows.length === 0) {
      throw new Error(
        'Nenhuma conta encontrada na planilha. Use o modelo Excel, exportação Domínio (Contas.xls) ou TXT plano.',
      );
    }
    return {
      items: visionPlanoRowsToAccountPlans(rows),
      logs: [`Planilha: ${rows.length} conta(s) importada(s).`],
    };
  }

  throw new Error('Para plano de contas, use Excel (.xlsx/.xls), CSV Domínio ou TXT com o modelo Domínio.');
}

async function ingestBalanceteFile(file: File, onProgress?: IngestProgress) {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

  if (['xlsx', 'xls', 'csv'].includes(ext)) {
    onProgress?.('Lendo planilha de razão/balancete...');
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];

    // Detecta o formato: balancete (Saldo Anterior + Débito + Crédito + Saldo Atual)
    // tem prioridade sobre razão (Data + Débito + Crédito), pois o balancete também
    // possui colunas de débito/crédito — sem essa checagem o parser de razão vencia
    // e descartava silenciosamente as colunas de saldo anterior e saldo atual.
    let rows;
    let formatLog: string;
    if (isBalanceteModelo(rawRows)) {
      rows = parseBalanceteSheet(rawRows);
      formatLog = `Balancete (Saldo Anterior / Débito / Crédito / Saldo Atual): ${rows.length} conta(s)`;
    } else if (isRazaoModelo(rawRows)) {
      rows = parseRazaoSheet(rawRows);
      formatLog = `Razão (lançamentos por data): ${rows.length} linha(s)`;
    } else {
      // Fallback: tenta balancete primeiro (cobre layouts sem cabeçalho canônico)
      rows = parseBalanceteSheet(rawRows);
      if (rows.length === 0) rows = parseRazaoSheet(rawRows);
      formatLog = `Planilha: ${rows.length} linha(s)`;
    }

    const normalized = normalizeRazaoImport(rows);
    if (normalized.length === 0) {
      throw new Error('Nenhum lançamento válido na planilha. Verifique se o arquivo tem colunas "Saldo Anterior", "Débito", "Crédito" e "Saldo Atual" (balancete) ou "Data", "Débito", "Crédito" (razão).');
    }
    return {
      items: normalized,
      logs: [formatLog, `${normalized.length} registro(s) importado(s).`],
    };
  }

  throw new Error('Para razão/balancete, use Excel (.xlsx) ou TXT Domínio / OCR.');
}

export async function ingestNativeFile(
  dataType: NativeIngestDataType,
  file: File,
  onProgress?: IngestProgress,
  accountCode?: string,
): Promise<{ items: unknown[]; logs: string[] }> {
  if (dataType === 'extrato') {
    return ingestExtratoFile(file, onProgress, accountCode);
  }

  if (dataType === 'plano') {
    return ingestPlanoFile(file, onProgress);
  }

  if (dataType === 'balancete') {
    return ingestBalanceteFile(file, onProgress);
  }

  throw new Error('Para este módulo, use o modelo TXT (botão TXT) ou PDF/Excel no painel de importação.');
}

export function canUseNativeConverter(dataType: NativeIngestDataType, file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (dataType === 'extrato') return ['xlsx', 'xls', 'csv', 'txt'].includes(ext);
  if (dataType === 'plano') return ['xlsx', 'xls', 'csv'].includes(ext);
  if (dataType === 'balancete') return ['xlsx', 'xls', 'csv'].includes(ext);
  return false;
}
