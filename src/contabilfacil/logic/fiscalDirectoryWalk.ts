/** Varredura recursiva de pastas (File System Access API) para importação fiscal. */

export type FiscalWalkedFile = {
  file: File;
  /** Caminho relativo à pasta escolhida (ex.: 2026/janeiro/sped.txt). */
  relativePath: string;
  /** Pasta imediata do arquivo (ex.: 2026/janeiro ou «.» na raiz). */
  folderKey: string;
};

export type FiscalDirectoryWalkResult = {
  files: FiscalWalkedFile[];
  foldersVisited: number;
  errors: string[];
};

const MAX_DEPTH = 32;

function parentFolderKey(relativePath: string): string {
  const norm = relativePath.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  if (idx <= 0) return '.';
  return norm.slice(0, idx);
}

export async function walkFiscalDirectoryFiles(
  dir: FileSystemDirectoryHandle,
  acceptFileName: (name: string) => boolean,
  prefix = '',
  depth = 0,
): Promise<FiscalDirectoryWalkResult> {
  const files: FiscalWalkedFile[] = [];
  const errors: string[] = [];
  let foldersVisited = 1;

  if (depth > MAX_DEPTH) {
    return {
      files,
      foldersVisited: 0,
      errors: [`Profundidade máxima de pastas atingida em «${prefix || dir.name}».`],
    };
  }

  try {
    for await (const [name, handle] of (dir as any).entries()) {
      if (handle.kind === 'file') {
        if (!acceptFileName(name)) continue;
        try {
          const file = await handle.getFile();
          const relativePath = prefix ? `${prefix}/${name}` : name;
          files.push({
            file,
            relativePath,
            folderKey: parentFolderKey(relativePath),
          });
        } catch (e) {
          errors.push(
            `Não foi possível ler «${prefix ? `${prefix}/` : ''}${name}»: ${
              e instanceof Error ? e.message : 'erro'
            }`,
          );
        }
        continue;
      }

      if (handle.kind === 'directory') {
        const subPrefix = prefix ? `${prefix}/${name}` : name;
        const nested = await walkFiscalDirectoryFiles(
          handle,
          acceptFileName,
          subPrefix,
          depth + 1,
        );
        files.push(...nested.files);
        errors.push(...nested.errors);
        foldersVisited += nested.foldersVisited;
      }
    }
  } catch (e) {
    errors.push(
      `Falha ao listar «${prefix || dir.name}»: ${e instanceof Error ? e.message : 'erro'}`,
    );
  }

  return { files, foldersVisited, errors };
}
