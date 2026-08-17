/** Handoff para Cursor desativado — não grava arquivos nem abre o IDE. */

export function createCursorHandoff(payload) {
  const resumo = String(payload?.resumo ?? '').trim();
  const limitacao = String(payload?.limitacao ?? '').trim();
  const workspace = process.cwd();

  return {
    ok: true,
    disabled: true,
    projectId: 'contabilfacil-eyevision',
    filePath: null,
    fileName: null,
    relativePath: null,
    cursorOpened: false,
    openCommand: null,
    clipboardPrompt: `[ContabilFacil/Eye Vision] ${resumo}. Limitação: ${limitacao}. Workspace: ${workspace}.`,
    message: 'Handoff desativado — nenhum relatório foi criado.',
  };
}
