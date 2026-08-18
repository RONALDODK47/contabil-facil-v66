/** Setup mínimo do Vitest (localStorage / DOM stubs se necessário). */

/**
 * pdfjs-dist (build web) toca DOMMatrix/Path2D/ImageData no topo do módulo.
 * No ambiente `node` do Vitest essas classes não existem e QUALQUER teste que
 * importe `pdfNativeTextItems` morre no import — inclusive o de regressão do
 * razão Domínio. Stubs vazios bastam: nenhum teste renderiza canvas.
 */
const g = globalThis as Record<string, unknown>;
g.DOMMatrix ??= class {};
g.Path2D ??= class {};
g.ImageData ??= class {};
