import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';
import {
  isDominioLancamentosTxt,
  parseDominioTxtFile,
  parseTxtPlusToFolhaRelatorio,
  isTxtPlusDominio,
  type FolhaRelatorioImportRow,
} from './dominioTxtIO';
import { readManagerData, writeManagerData, flushManagerDataWrites } from './companyWorkspace';
import { normalizeRazaoImport } from './contabilPipeline';
import {
  FOLHA_RUBRICAS,
  type FolhaContasAutomacaoConfig,
  type FolhaRubricaId,
} from './folhaContasAutomacao';
import { loadFolhaContasAutomacao, loadFolhaRegras } from './folhaContasAutomacaoStorage';
import {
  loadFolhaFolderSettings,
  readFolhaTxtFilesFromFolder,
  saveFolhaFolderSettings,
} from './folhaFolderStore';
import {
  buildRazaoFromFolhaPayroll,
  buildRazaoFromFolhaRelatorio,
  mergeFolhaRazaoComExistente,
  type FolhaPayrollLinha,
} from './folhaToRazao';

export type FolhaSyncResult = {
  relatorioNovos: number;
  payrollNovos: number;
  skipped: number;
  messages: string[];
  razaoGerados: number;
  razaoPendencias: string[];
};

function relatorioFingerprint(row: FolhaRelatorioImportRow): string {
  return `${row.date}|${row.description}|${row.debito}|${row.credito}`;
}

function payrollFingerprint(row: FolhaPayrollLinha): string {
  return `${row.name}|${row.baseSalary}|${row.net}|${row.inss}|${row.fgts}|${row.irrf}`;
}

function mergeRelatorio(
  existentes: FolhaRelatorioImportRow[],
  novos: FolhaRelatorioImportRow[],
): FolhaRelatorioImportRow[] {
  const fps = new Set(existentes.map(relatorioFingerprint));
  const out = [...existentes];
  for (const row of novos) {
    const fp = relatorioFingerprint(row);
    if (fps.has(fp)) continue;
    fps.add(fp);
    out.push(row);
  }
  return out;
}

function mergePayroll(existentes: FolhaPayrollLinha[], novos: FolhaPayrollLinha[]): FolhaPayrollLinha[] {
  const fps = new Set(existentes.map(payrollFingerprint));
  const out = [...existentes];
  for (const row of novos) {
    const fp = payrollFingerprint(row);
    if (fps.has(fp)) continue;
    fps.add(fp);
    out.push(row);
  }
  return out;
}

function parsePayrollTxtLine(line: string): FolhaPayrollLinha | null {
  const parts = line.split(/[;\t,]/).map((p) => p.trim());
  if (parts.length < 2) return null;
  const name = parts[0];
  const baseSalary = parseFloat(String(parts[1]).replace(/\./g, '').replace(',', '.'));
  if (!name || !Number.isFinite(baseSalary) || baseSalary <= 0) return null;
  const inss = baseSalary * 0.11;
  const fgts = baseSalary * 0.08;
  const irrf = baseSalary > 2500 ? (baseSalary - inss) * 0.15 : 0;
  const net = baseSalary - inss - irrf;
  return {
    id: crypto.randomUUID(),
    name: name.toUpperCase(),
    baseSalary,
    inss,
    fgts,
    irrf,
    net,
  };
}

async function parseFolhaFile(file: File): Promise<{
  relatorio: FolhaRelatorioImportRow[];
  payroll: FolhaPayrollLinha[];
  messages: string[];
}> {
  const text = await file.text();
  const messages: string[] = [];
  const relatorio: FolhaRelatorioImportRow[] = [];
  const payroll: FolhaPayrollLinha[] = [];

  if (isDominioLancamentosTxt(text)) {
    try {
      const parsed = await parseDominioTxtFile(text);
      relatorio.push(...parsed.folha);
      messages.push(`${file.name}: ${parsed.folha.length} lançamento(s) Domínio.`);
    } catch (e) {
      messages.push(`${file.name}: ${e instanceof Error ? e.message : 'erro Domínio'}`);
    }
    return { relatorio, payroll, messages };
  }

  if (isTxtPlusDominio(text)) {
    const rows = parseTxtPlusToFolhaRelatorio(text);
    relatorio.push(...rows);
    messages.push(`${file.name}: ${rows.length} lançamento(s) TXT+.`);
    return { relatorio, payroll, messages };
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let payrollCount = 0;
  for (const line of lines) {
    // Skip SPED format lines (01..., 02..., etc) but allow dates starting with 01/xx
    if (/^0[123](?!\d*\/)/.test(line)) continue;
    const row = parsePayrollTxtLine(line);
    if (row) {
      payroll.push(row);
      payrollCount += 1;
    }
  }
  if (payrollCount > 0) {
    messages.push(`${file.name}: ${payrollCount} colaborador(es) (Nome;Salário).`);
    return { relatorio, payroll, messages };
  }

  messages.push(`${file.name}: formato não reconhecido (use Domínio, TXT+ ou Nome;Salário).`);
  return { relatorio, payroll, messages };
}

export function folhaContasProntasParaAutomacao(
  config: FolhaContasAutomacaoConfig,
): FolhaRubricaId[] {
  const faltando: FolhaRubricaId[] = [];
  for (const id of FOLHA_RUBRICAS) {
    const par = config[id];
    if (!par.debito.trim() || !par.credito.trim()) faltando.push(id);
  }
  return faltando;
}

export function postFolhaNoRazao(
  companyName: string,
  contas?: FolhaContasAutomacaoConfig,
): { gerados: number; pendencias: string[] } {
  const cfg = contas ?? loadFolhaContasAutomacao(companyName);
  const regras = loadFolhaRegras(companyName);
  const relatorio = readManagerData<FolhaRelatorioImportRow>(companyName, 'folhaRelatorio');
  const payroll = readManagerData<FolhaPayrollLinha>(companyName, 'folha');

  const fromRelatorio = buildRazaoFromFolhaRelatorio(relatorio, cfg, regras);
  const fromPayroll = buildRazaoFromFolhaPayroll(payroll, cfg, regras, fromRelatorio.rows.length + 1);

  const rows = [...fromRelatorio.rows, ...fromPayroll.rows];
  const gerados = fromRelatorio.gerados + fromPayroll.gerados;
  const pendencias = [...fromRelatorio.pendencias, ...fromPayroll.pendencias];

  if (gerados <= 0) return { gerados: 0, pendencias };

  const existente = readManagerData<VisionBalanceteRow>(companyName, 'razao');
  const merged = normalizeRazaoImport(mergeFolhaRazaoComExistente(existente, rows));
  writeManagerData(companyName, 'razao', merged);
  flushManagerDataWrites();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('contabilfacil-razao-updated', { detail: { company: companyName } }),
    );
  }
  return { gerados, pendencias };
}

/** Importa TXT da pasta configurada, grava folha e opcionalmente lança no razão. */
export async function syncFolhaFromConfiguredFolder(
  companyName: string,
  options?: { postRazao?: boolean },
): Promise<FolhaSyncResult> {
  const settings = loadFolhaFolderSettings(companyName);
  const files = await readFolhaTxtFilesFromFolder(companyName);
  const messages: string[] = [];

  if (!settings.folderLabel) {
    return {
      relatorioNovos: 0,
      payrollNovos: 0,
      skipped: 0,
      messages: ['Pasta de importação da folha não configurada.'],
      razaoGerados: 0,
      razaoPendencias: [],
    };
  }
  if (!files.length) {
    return {
      relatorioNovos: 0,
      payrollNovos: 0,
      skipped: 0,
      messages: [`Nenhum .txt na pasta «${settings.folderLabel}».`],
      razaoGerados: 0,
      razaoPendencias: [],
    };
  }

  const novosRelatorio: FolhaRelatorioImportRow[] = [];
  const novosPayroll: FolhaPayrollLinha[] = [];

  for (const file of files) {
    const parsed = await parseFolhaFile(file);
    messages.push(...parsed.messages);
    novosRelatorio.push(...parsed.relatorio);
    novosPayroll.push(...parsed.payroll);
  }

  const relExistente = readManagerData<FolhaRelatorioImportRow>(companyName, 'folhaRelatorio');
  const payExistente = readManagerData<FolhaPayrollLinha>(companyName, 'folha');
  const relAntes = relExistente.length;
  const payAntes = payExistente.length;

  const relMerged = mergeRelatorio(relExistente, novosRelatorio);
  const payMerged = mergePayroll(payExistente, novosPayroll);

  writeManagerData(companyName, 'folhaRelatorio', relMerged);
  writeManagerData(companyName, 'folha', payMerged);
  saveFolhaFolderSettings(companyName, { lastSyncAt: new Date().toISOString() });
  flushManagerDataWrites();

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('contabilfacil-folha-updated', { detail: { company: companyName } }),
    );
  }

  let razaoGerados = 0;
  let razaoPendencias: string[] = [];
  // Postagem ao balancete só com postRazao: true explícito (botão na UI).
  const shouldPost = options?.postRazao === true;
  if (shouldPost && (relMerged.length > 0 || payMerged.length > 0)) {
    const faltando = folhaContasProntasParaAutomacao(loadFolhaContasAutomacao(companyName));
    const semRegras = loadFolhaRegras(companyName).length === 0;
    if (faltando.length === FOLHA_RUBRICAS.length && semRegras) {
      razaoPendencias = ['Configure ao menos um par débito/crédito na subaba Contas.'];
    } else {
      const posted = postFolhaNoRazao(companyName);
      razaoGerados = posted.gerados;
      razaoPendencias = posted.pendencias;
    }
  }

  return {
    relatorioNovos: Math.max(0, relMerged.length - relAntes),
    payrollNovos: Math.max(0, payMerged.length - payAntes),
    skipped: files.length - novosRelatorio.length - novosPayroll.length,
    messages,
    razaoGerados,
    razaoPendencias,
  };
}

export async function tryAutoSyncFolhaOnOpen(companyName: string): Promise<FolhaSyncResult | null> {
  const settings = loadFolhaFolderSettings(companyName);
  if (!settings.folderLabel || !settings.automationEnabled) return null;
  try {
    // Só importa arquivos — balancete via botão «MANDAR PARA O BALANCETE».
    return await syncFolhaFromConfiguredFolder(companyName, { postRazao: false });
  } catch {
    return null;
  }
}
