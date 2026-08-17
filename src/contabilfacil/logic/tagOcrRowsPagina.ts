import type { GenericOcrRow } from '../../lib/parcelamentoColunasExtract';

/** Marca linhas OCR com número da página de origem. */
export function tagOcrRowsPagina(rows: GenericOcrRow[], pagina: number): GenericOcrRow[] {
  const p = String(Math.max(1, pagina));
  return rows.map((r) => ({ ...r, _pagina: r._pagina ?? p }));
}
