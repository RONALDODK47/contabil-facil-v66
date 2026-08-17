import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';
import { readManagerData, writeManagerData } from './companyWorkspace';
import { isFiscalRazaoRow } from './fiscalSpedToRazao';
import {
  FISCAL_IMPOSTOS,
  type FiscalContasImpostoConfig,
} from './fiscalContasImposto';
import { loadFiscalContasImposto } from './fiscalContasImpostoStorage';
import {
  fiscalContasProntasParaAutomacao,
  postFiscalSpedNoRazao,
  type FiscalSpedArquivoSalvo,
} from './fiscalSpedAutomation';
import {
  loadFiscalPgdasFolderSettings,
  scanFiscalPgdasFolder,
  saveFiscalPgdasFolderSettings,
} from './fiscalPgdasFolderStore';
import { parsePgdasFile, pgdasImportSlotKey, type ParsedPgdas, type FiscalPgdasArquivoSalvo } from './pgdasParser';

export type { FiscalPgdasArquivoSalvo };
export { linhasRazaoFromArquivosPgdas } from './pgdasParser';

export type FiscalPgdasSyncResult = {
  imported: number;
  skipped: number;
  replaced: number;
  messages: string[];
  razaoGerados: number;
  razaoPendencias: string[];
};

function fileFingerprint(file: File, parsed: ParsedPgdas): string {
  return `${file.name}|${parsed.periodo}|${parsed.dtFin}|${parsed.valorDas}|${parsed.itens.length}`;
}

export function pgdasArquivoPresenteNoRazao(
  companyName: string,
  arquivo: FiscalPgdasArquivoSalvo,
): boolean {
  const rows = readManagerData<VisionBalanceteRow>(companyName, 'razao');
  const needle = arquivo.parsed.fileName.toUpperCase();
  return rows.some(
    (r) => isFiscalRazaoRow(r) && String(r.nome ?? '').toUpperCase().includes(needle),
  );
}

export function mergeArquivosPgdas(
  existentes: FiscalPgdasArquivoSalvo[],
  novos: FiscalPgdasArquivoSalvo[],
  companyName?: string,
): { merged: FiscalPgdasArquivoSalvo[]; imported: number; skipped: number; replaced: number } {
  const out = [...existentes];
  let imported = 0;
  let skipped = 0;
  let replaced = 0;

  for (const arq of novos) {
    const fp = fileFingerprint({ name: arq.parsed.fileName } as File, arq.parsed);
    const slot = pgdasImportSlotKey(arq.parsed);
    const idxSlot = out.findIndex((a) => pgdasImportSlotKey(a.parsed) === slot);
    const idxFp = out.findIndex(
      (a) => fileFingerprint({ name: a.parsed.fileName } as File, a.parsed) === fp,
    );

    if (idxFp >= 0) {
      const anterior = out[idxFp]!;
      if (!companyName || pgdasArquivoPresenteNoRazao(companyName, anterior)) {
        skipped++;
        continue;
      }
      out[idxFp] = arq;
      replaced++;
      imported++;
      continue;
    }

    if (idxSlot >= 0) {
      const anterior = out[idxSlot]!;
      if (!companyName || pgdasArquivoPresenteNoRazao(companyName, anterior)) {
        skipped++;
        continue;
      }
      out[idxSlot] = arq;
      replaced++;
      imported++;
      continue;
    }

    out.push(arq);
    imported++;
  }

  return { merged: out, imported, skipped, replaced };
}

export function postFiscalPgdasNoRazao(
  companyName: string,
  _arquivos: FiscalPgdasArquivoSalvo[],
  contas?: FiscalContasImpostoConfig,
): { gerados: number; pendencias: string[] } {
  const sped = readManagerData<FiscalSpedArquivoSalvo>(companyName, 'fiscalSped');
  return postFiscalSpedNoRazao(companyName, sped, contas);
}

/** Lança SPED + PGDAS-D no balancete (razão). */
export function postFiscalImportsNoRazao(
  companyName: string,
  sped: FiscalSpedArquivoSalvo[],
  _pgdas: FiscalPgdasArquivoSalvo[],
  contas?: FiscalContasImpostoConfig,
): { gerados: number; pendencias: string[] } {
  return postFiscalSpedNoRazao(companyName, sped, contas);
}

async function parseEachPgdasFile(files: File[]): Promise<{
  arquivos: FiscalPgdasArquivoSalvo[];
  messages: string[];
}> {
  const messages: string[] = [];
  const arquivos: FiscalPgdasArquivoSalvo[] = [];

  for (const file of files) {
    try {
      const parsed = await parsePgdasFile(file);
      if (parsed.issues.length) messages.push(...parsed.issues.slice(0, 2));
      if (parsed.itens.length > 0) {
        arquivos.push({ id: crypto.randomUUID(), parsed });
      } else if (parsed.issues[0]) {
        messages.push(`«${file.name}»: ${parsed.issues[0]}`);
      }
    } catch (e) {
      messages.push(
        `Falha ao ler «${file.name}»: ${e instanceof Error ? e.message : 'erro desconhecido'}`,
      );
    }
  }

  return { arquivos, messages };
}

export async function syncFiscalPgdasFromConfiguredFolder(
  companyName: string,
  options?: { postRazao?: boolean },
): Promise<FiscalPgdasSyncResult> {
  const settings = loadFiscalPgdasFolderSettings(companyName);
  const messages: string[] = [];

  if (!settings.folderLabel) {
    return {
      imported: 0,
      skipped: 0,
      replaced: 0,
      messages: ['Pasta de importação PGDAS-D não configurada.'],
      razaoGerados: 0,
      razaoPendencias: [],
    };
  }

  const scan = await scanFiscalPgdasFolder(companyName);
  messages.push(...scan.messages);

  if (!scan.files.length) {
    return {
      imported: 0,
      skipped: 0,
      replaced: 0,
      messages: messages.length
        ? messages
        : [`Nenhum PGDAS-D válido na pasta «${settings.folderLabel}».`],
      razaoGerados: 0,
      razaoPendencias: [],
    };
  }

  const { arquivos: novos, messages: parseMsgs } = await parseEachPgdasFile(scan.files);
  messages.push(...parseMsgs);

  const existentes = readManagerData<FiscalPgdasArquivoSalvo>(companyName, 'fiscalPgdas');
  const { merged, imported, skipped, replaced } = mergeArquivosPgdas(existentes, novos, companyName);
  writeManagerData(companyName, 'fiscalPgdas', merged);
  saveFiscalPgdasFolderSettings(companyName, { lastSyncAt: new Date().toISOString() });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('contabilfacil-fiscal-pgdas-updated', { detail: { company: companyName } }),
    );
  }

  if (skipped > 0) {
    messages.push(`${skipped} PGDAS já importado(s) e ainda no balancete — ignorado(s).`);
  }
  if (replaced > 0) {
    messages.push(`${replaced} período(s) PGDAS atualizado(s).`);
  }
  if (imported > 0) {
    messages.push(`${imported} arquivo(s) PGDAS-D novo(s) importado(s).`);
  }

  let razaoGerados = 0;
  let razaoPendencias: string[] = [];
  const shouldPost = options?.postRazao ?? settings.automationEnabled;
  if (shouldPost && merged.length > 0) {
    const faltando = fiscalContasProntasParaAutomacao(loadFiscalContasImposto(companyName));
    if (faltando.length === FISCAL_IMPOSTOS.length) {
      razaoPendencias = ['Configure ao menos um par débito/crédito na subaba Contas.'];
    } else {
      const sped = readManagerData<FiscalSpedArquivoSalvo>(companyName, 'fiscalSped');
      const posted = postFiscalImportsNoRazao(companyName, sped, merged);
      razaoGerados = posted.gerados;
      razaoPendencias = posted.pendencias;
    }
  }

  return {
    imported,
    skipped,
    replaced,
    messages,
    razaoGerados,
    razaoPendencias,
  };
}

export async function tryAutoSyncFiscalPgdasOnOpen(
  companyName: string,
): Promise<FiscalPgdasSyncResult | null> {
  const settings = loadFiscalPgdasFolderSettings(companyName);
  if (!settings.folderLabel || !settings.automationEnabled) return null;
  try {
    return await syncFiscalPgdasFromConfiguredFolder(companyName, { postRazao: true });
  } catch {
    return null;
  }
}

export async function importPgdasFilesManual(
  companyName: string,
  files: File[],
  options?: { postRazao?: boolean },
): Promise<{ merged: FiscalPgdasArquivoSalvo[]; messages: string[] }> {
  const { arquivos: novos, messages } = await parseEachPgdasFile(files);
  const existentes = readManagerData<FiscalPgdasArquivoSalvo>(companyName, 'fiscalPgdas');
  const { merged } = mergeArquivosPgdas(existentes, novos, companyName);
  writeManagerData(companyName, 'fiscalPgdas', merged);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('contabilfacil-fiscal-pgdas-updated', { detail: { company: companyName } }),
    );
  }
  if (options?.postRazao && merged.length > 0) {
    const sped = readManagerData<FiscalSpedArquivoSalvo>(companyName, 'fiscalSped');
    postFiscalImportsNoRazao(companyName, sped, merged);
  }
  return { merged, messages };
}
