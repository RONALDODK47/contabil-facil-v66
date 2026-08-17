export type DiagnosticoExportItem = { ok: boolean; label: string };

export function formatarDiagnosticoExport(itens: DiagnosticoExportItem[]): string {
  const faltas = itens.filter((i) => !i.ok);
  if (faltas.length === 0) return '';
  return faltas.map((i) => `• ${i.label}`).join('\n');
}
