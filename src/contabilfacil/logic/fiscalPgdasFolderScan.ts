import { sniffPgdasFile } from './pgdasParser';

export type FiscalPgdasFileCandidate = {
  file: File;
  relativePath: string;
  folderKey: string;
};

export type FiscalPgdasFolderScanResult = {
  files: File[];
  messages: string[];
  totalEncontrados: number;
  foldersVisited?: number;
};

function folderLabel(folderKey: string): string {
  return folderKey === '.' ? 'raiz' : folderKey;
}

const PGDAS_EXT = /\.(txt|pdf|rec)$/i;

/** Em cada período, usa o PGDAS-D mais recente encontrado em qualquer subpasta. */
export async function selectLatestPgdasFilesPerFolder(
  candidates: FiscalPgdasFileCandidate[],
): Promise<FiscalPgdasFolderScanResult> {
  const messages: string[] = [];
  if (!candidates.length) {
    return {
      files: [],
      messages: ['Nenhum arquivo PGDAS (.txt, .pdf, .rec) encontrado na pasta (incluindo subpastas).'],
      totalEncontrados: 0,
    };
  }

  const meta = await Promise.all(
    candidates.map(async (c) => {
      try {
        const sniff = await sniffPgdasFile(c.file);
        return { ...c, ...sniff, mtime: c.file.lastModified };
      } catch {
        return {
          ...c,
          isPgdas: false,
          periodo: '',
          fileName: c.file.name,
          mtime: c.file.lastModified,
        };
      }
    }),
  );

  const ignorados = meta.filter((m) => !m.isPgdas);
  if (ignorados.length) {
    messages.push(`${ignorados.length} arquivo(s) ignorado(s) (não é PGDAS-D).`);
  }

  const byPeriodo = new Map<string, (typeof meta)[number][]>();
  for (const m of meta) {
    if (!m.isPgdas) continue;
    const key = m.periodo || m.relativePath;
    const list = byPeriodo.get(key) ?? [];
    list.push(m);
    byPeriodo.set(key, list);
  }

  const selected: File[] = [];
  const periodos = [...byPeriodo.keys()].sort((a, b) => a.localeCompare(b));

  for (const periodo of periodos) {
    const pool = (byPeriodo.get(periodo) ?? []).sort((a, b) => {
      const pa = a.periodo.split('/').reverse().join('-');
      const pb = b.periodo.split('/').reverse().join('-');
      const byP = pb.localeCompare(pa);
      if (byP !== 0) return byP;
      return b.mtime - a.mtime;
    });
    const pick = pool[0]!;
    selected.push(pick.file);

    if (pool.length > 1) {
      messages.push(
        `PGDAS ${periodo}: ${pool.length} arquivo(s) em subpastas, usado «${pick.relativePath}».`,
      );
    } else {
      messages.push(`Encontrado «${pick.relativePath}» (${folderLabel(pick.folderKey)}).`);
    }
  }

  if (!selected.length) {
    messages.push(
      'Nenhum PGDAS-D válido. Verifique se os arquivos estão em subpastas da pasta escolhida.',
    );
  }

  return { files: selected, messages, totalEncontrados: candidates.length };
}

export function isPgdasCandidateFileName(name: string): boolean {
  return PGDAS_EXT.test(name);
}
