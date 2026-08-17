import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';
import {
  loadSpedFiscalFromFiles,
  parseSpedFiscalText,
  sanitizeParsedSpedFiscal,
  type ParsedSpedFiscal,
} from '../../extratoVision/utils/spedFiscalParser';
import { readManagerData, writeManagerData, flushManagerDataWrites } from './companyWorkspace';
import { normalizeRazaoImport } from './contabilPipeline';
import {
  buildRazaoFromFiscalSped,
  mergeFiscalRazaoComExistente,
  isFiscalRazaoRow,
  type FiscalSpedLinhaRazao,
} from './fiscalSpedToRazao';
import {
  FISCAL_IMPOSTOS,
  type FiscalContasImpostoConfig,
  type FiscalImpostoId,
} from './fiscalContasImposto';
import { loadFiscalContasImposto } from './fiscalContasImpostoStorage';
import { loadFiscalAcumuladorContas } from './fiscalAcumuladorContasStorage';
import {
  loadFiscalSpedFolderSettings,
  scanFiscalSpedFolder,
  saveFiscalSpedFolderSettings,
} from './fiscalSpedFolderStore';
import {
  linhasRazaoFromArquivosPgdas,
  type FiscalPgdasArquivoSalvo,
} from './pgdasParser';

export type FiscalSpedArquivoSalvo = {
  id: string;
  parsed: ParsedSpedFiscal;
};

export type FiscalSpedSyncResult = {
  imported: number;
  skipped: number;
  replaced: number;
  messages: string[];
  razaoGerados: number;
  razaoPendencias: string[];
};

function fileFingerprint(file: File, parsed: ParsedSpedFiscal): string {
  return `${file.name}|${parsed.tipo}|${parsed.dtIni}|${parsed.dtFin}|${parsed.itens.length}`;
}

/** Chave mês + tipo (ex.: CONTRIBUICOES|2026-03). */
export function spedImportSlotKey(parsed: ParsedSpedFiscal): string {
  const raw = parsed.dtFin?.length >= 8 ? parsed.dtFin : parsed.dtIni;
  if (raw && raw.length >= 8) {
    const mm = raw.slice(2, 4);
    const yyyy = raw.slice(4, 8);
    return `${parsed.tipo}|${yyyy}-${mm}`;
  }
  return `${parsed.tipo}|${parsed.fileName}`;
}

export function spedArquivoPresenteNoRazao(
  companyName: string,
  arquivo: FiscalSpedArquivoSalvo,
): boolean {
  const rows = readManagerData<VisionBalanceteRow>(companyName, 'razao');
  const needle = arquivo.parsed.fileName.toUpperCase();
  return rows.some(
    (r) => isFiscalRazaoRow(r) && String(r.nome ?? '').toUpperCase().includes(needle),
  );
}

export function mergeArquivosSped(
  existentes: FiscalSpedArquivoSalvo[],
  novos: FiscalSpedArquivoSalvo[],
  companyName?: string,
): { merged: FiscalSpedArquivoSalvo[]; imported: number; skipped: number; replaced: number } {
  const out = [...existentes];
  let imported = 0;
  let skipped = 0;
  let replaced = 0;

  for (const arq of novos) {
    const fp = fileFingerprint({ name: arq.parsed.fileName } as File, arq.parsed);
    const slot = spedImportSlotKey(arq.parsed);
    const idxSlot = out.findIndex((a) => spedImportSlotKey(a.parsed) === slot);
    const idxFp = out.findIndex(
      (a) => fileFingerprint({ name: a.parsed.fileName } as File, a.parsed) === fp,
    );

    if (idxFp >= 0) {
      const anterior = out[idxFp]!;
      if (!companyName || spedArquivoPresenteNoRazao(companyName, anterior)) {
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
      if (!companyName || spedArquivoPresenteNoRazao(companyName, anterior)) {
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

export function fiscalContasProntasParaAutomacao(config: FiscalContasImpostoConfig): FiscalImpostoId[] {
  const faltando: FiscalImpostoId[] = [];
  for (const id of FISCAL_IMPOSTOS) {
    const par = config[id];
    if (!par.debito.trim() || !par.credito.trim()) faltando.push(id);
  }
  return faltando;
}

export function linhasRazaoFromArquivosSped(arquivos: FiscalSpedArquivoSalvo[]): FiscalSpedLinhaRazao[] {
  return arquivos.flatMap((arq) =>
    arq.parsed.itens.map((item) => ({
      item,
      data:
        item.data ??
        (arq.parsed.dtFinLabel && arq.parsed.dtFinLabel !== '—'
          ? arq.parsed.dtFinLabel
          : arq.parsed.dtFin ?? arq.parsed.dtIni ?? ''),
      fileName: arq.parsed.fileName,
    })),
  );
}

export function postFiscalSpedNoRazao(
  companyName: string,
  arquivos: FiscalSpedArquivoSalvo[],
  contas?: FiscalContasImpostoConfig,
): { gerados: number; pendencias: string[] } {
  const cfg = contas ?? loadFiscalContasImposto(companyName);
  const acumuladorContas = loadFiscalAcumuladorContas(companyName);
  const pgdas = readManagerData<FiscalPgdasArquivoSalvo>(companyName, 'fiscalPgdas');
  const linhas = [...linhasRazaoFromArquivosSped(arquivos), ...linhasRazaoFromArquivosPgdas(pgdas)];
  const { rows, gerados, pendencias } = buildRazaoFromFiscalSped(linhas, cfg, 1, acumuladorContas);
  if (gerados <= 0) return { gerados: 0, pendencias };

  const existente = readManagerData<VisionBalanceteRow>(companyName, 'razao');
  const merged = normalizeRazaoImport(mergeFiscalRazaoComExistente(existente, rows));
  writeManagerData(companyName, 'razao', merged);
  flushManagerDataWrites();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('contabilfacil-razao-updated', { detail: { company: companyName } }),
    );
  }
  return { gerados, pendencias };
}

async function parseEachFileToArquivos(files: File[]): Promise<{
  arquivos: FiscalSpedArquivoSalvo[];
  messages: string[];
}> {
  const messages: string[] = [];
  const arquivos: FiscalSpedArquivoSalvo[] = [];

  for (const file of files) {
    try {
      const text = await file.text();
      const parsed = sanitizeParsedSpedFiscal(parseSpedFiscalText(text, file.name));
      if (parsed.issues.length) messages.push(...parsed.issues.slice(0, 2));
      if (parsed.itens.length > 0 || parsed.tipo !== 'DESCONHECIDO') {
        arquivos.push({ id: crypto.randomUUID(), parsed });
      }
    } catch (e) {
      messages.push(
        `Falha ao ler «${file.name}»: ${e instanceof Error ? e.message : 'erro desconhecido'}`,
      );
    }
  }

  return { arquivos, messages };
}

async function parseFilesToArquivos(files: File[]): Promise<{
  arquivos: FiscalSpedArquivoSalvo[];
  messages: string[];
}> {
  const messages: string[] = [];
  const arquivos: FiscalSpedArquivoSalvo[] = [];

  if (files.length === 0) {
    return { arquivos, messages };
  }

  if (files.length === 1) {
    const text = await files[0]!.text();
    const parsed = sanitizeParsedSpedFiscal(parseSpedFiscalText(text, files[0]!.name));
    if (parsed.issues.length) messages.push(...parsed.issues);
    if (parsed.itens.length > 0 || parsed.tipo !== 'DESCONHECIDO') {
      arquivos.push({ id: crypto.randomUUID(), parsed });
    }
    return { arquivos, messages };
  }

  const batch = await loadSpedFiscalFromFiles(files);
  messages.push(...batch.messages);
  if (batch.contrib) arquivos.push({ id: crypto.randomUUID(), parsed: batch.contrib });
  if (batch.icms) arquivos.push({ id: crypto.randomUUID(), parsed: batch.icms });
  return { arquivos, messages };
}

/** Importa TXT da pasta configurada (inclui subpastas), grava no fiscal SPED e opcionalmente lança no razão. */
export async function syncFiscalSpedFromConfiguredFolder(
  companyName: string,
  options?: { postRazao?: boolean },
): Promise<FiscalSpedSyncResult> {
  const settings = loadFiscalSpedFolderSettings(companyName);
  const messages: string[] = [];

  if (!settings.folderLabel) {
    return {
      imported: 0,
      skipped: 0,
      replaced: 0,
      messages: ['Pasta de importação SPED não configurada.'],
      razaoGerados: 0,
      razaoPendencias: [],
    };
  }

  const scan = await scanFiscalSpedFolder(companyName);
  messages.push(...scan.messages);

  if (!scan.files.length) {
    return {
      imported: 0,
      skipped: 0,
      replaced: 0,
      messages: messages.length
        ? messages
        : [`Nenhum SPED válido na pasta «${settings.folderLabel}» (verifique subpastas de meses).`],
      razaoGerados: 0,
      razaoPendencias: [],
    };
  }

  const { arquivos: novos, messages: parseMsgs } = await parseEachFileToArquivos(scan.files);
  messages.push(...parseMsgs);

  const existentes = readManagerData<FiscalSpedArquivoSalvo>(companyName, 'fiscalSped');
  const { merged, imported, skipped, replaced } = mergeArquivosSped(existentes, novos, companyName);
  writeManagerData(companyName, 'fiscalSped', merged);
  saveFiscalSpedFolderSettings(companyName, { lastSyncAt: new Date().toISOString() });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('contabilfacil-fiscal-sped-updated', { detail: { company: companyName } }),
    );
  }

  if (skipped > 0) {
    messages.push(
      `${skipped} arquivo(s) já importado(s) e ainda no balancete — ignorado(s).`,
    );
  }
  if (replaced > 0) {
    messages.push(`${replaced} período(s) atualizado(s) (SPED removido do balancete).`);
  }
  if (imported > 0) {
    messages.push(`${imported} arquivo(s) SPED novo(s) importado(s).`);
  }

  let razaoGerados = 0;
  let razaoPendencias: string[] = [];
  const shouldPost = options?.postRazao ?? settings.automationEnabled;
  if (shouldPost && merged.length > 0) {
    const faltando = fiscalContasProntasParaAutomacao(loadFiscalContasImposto(companyName));
    if (faltando.length === FISCAL_IMPOSTOS.length) {
      razaoPendencias = ['Configure ao menos um par débito/crédito na subaba Contas.'];
    } else {
      const posted = postFiscalSpedNoRazao(companyName, merged);
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

export async function tryAutoSyncFiscalSpedOnOpen(companyName: string): Promise<FiscalSpedSyncResult | null> {
  const settings = loadFiscalSpedFolderSettings(companyName);
  if (!settings.folderLabel || !settings.automationEnabled) return null;
  try {
    return await syncFiscalSpedFromConfiguredFolder(companyName, { postRazao: true });
  } catch {
    return null;
  }
}
