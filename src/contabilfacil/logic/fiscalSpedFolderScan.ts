import {
  sniffSpedFiscalFile,
  type SpedFiscalTipo,
} from '../../extratoVision/utils/spedFiscalParser';

export type FiscalSpedTxtCandidate = {
  file: File;
  relativePath: string;
  /** Pasta imediata onde o TXT está (subpasta de mês ou «.» na raiz). */
  folderKey: string;
};

export type FiscalSpedFolderScanResult = {
  files: File[];
  messages: string[];
  totalEncontrados: number;
  foldersVisited?: number;
};

function folderLabel(folderKey: string): string {
  return folderKey === '.' ? 'raiz' : folderKey;
}

function spedSlotKey(tipo: SpedFiscalTipo, dtFin: string, fileName: string): string {
  if (dtFin.length >= 8) {
    const mm = dtFin.slice(2, 4);
    const yyyy = dtFin.slice(4, 8);
    return `${tipo}|${yyyy}-${mm}`;
  }
  return `${tipo}|${fileName}`;
}

/** Varre candidatos de qualquer subpasta e escolhe o SPED mais recente de cada tipo + período. */
export async function selectLatestSpedFilesPerFolder(
  candidates: FiscalSpedTxtCandidate[],
): Promise<FiscalSpedFolderScanResult> {
  const messages: string[] = [];
  if (!candidates.length) {
    return {
      files: [],
      messages: ['Nenhum arquivo .txt encontrado na pasta (incluindo subpastas).'],
      totalEncontrados: 0,
    };
  }

  const meta = await Promise.all(
    candidates.map(async (c) => {
      try {
        const sniff = await sniffSpedFiscalFile(c.file);
        return { ...c, ...sniff, mtime: c.file.lastModified };
      } catch {
        return {
          ...c,
          tipo: 'DESCONHECIDO' as SpedFiscalTipo,
          dtFin: '',
          fileName: c.file.name,
          mtime: c.file.lastModified,
        };
      }
    }),
  );

  const ignorados = meta.filter((m) => m.tipo === 'DESCONHECIDO');
  if (ignorados.length) {
    messages.push(`${ignorados.length} .txt ignorado(s) (não é SPED Fiscal).`);
  }

  const bySlot = new Map<string, (typeof meta)[number][]>();
  for (const m of meta) {
    if (m.tipo !== 'CONTRIBUICOES' && m.tipo !== 'ICMS_IPI') continue;
    const slot = spedSlotKey(m.tipo, m.dtFin, m.file.name);
    const list = bySlot.get(slot) ?? [];
    list.push(m);
    bySlot.set(slot, list);
  }

  const selected: File[] = [];
  const slots = [...bySlot.keys()].sort((a, b) => a.localeCompare(b));

  for (const slot of slots) {
    const pool = (bySlot.get(slot) ?? []).sort((a, b) => {
      const byPeriodo = (b.dtFin || '').localeCompare(a.dtFin || '');
      if (byPeriodo !== 0) return byPeriodo;
      return b.mtime - a.mtime;
    });
    const pick = pool[0]!;
    selected.push(pick.file);

    if (pool.length > 1) {
      const rotulo = pick.tipo === 'CONTRIBUICOES' ? 'Contribuições' : 'ICMS/IPI';
      messages.push(
        `${rotulo} · ${slot.split('|')[1] ?? 'período'}: ${pool.length} arquivo(s) em subpastas, usado «${pick.relativePath}».`,
      );
    } else {
      messages.push(`Encontrado «${pick.relativePath}» (${folderLabel(pick.folderKey)}).`);
    }
  }

  if (!selected.length) {
    messages.push(
      'Nenhum EFD-Contribuições ou EFD ICMS/IPI válido. Verifique se os .txt estão em subpastas da pasta escolhida.',
    );
  }

  return {
    files: selected,
    messages,
    totalEncontrados: candidates.length,
  };
}
