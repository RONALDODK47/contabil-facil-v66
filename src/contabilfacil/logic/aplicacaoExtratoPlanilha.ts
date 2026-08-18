/**
 * Planilha modelo do extrato de aplicações (Data; Histórico; Entrada; Saída; Saldo).
 *
 * Fica aqui — e não dentro de um componente — porque duas telas usam o mesmo
 * modelo: a aba "Conciliação de Aplicações" e o modal "Extração de Dados" da
 * aba "Extrato de Aplicações". Duplicar o parser faria as duas divergirem no
 * dia em que uma coluna mudasse.
 */
import * as XLSX from 'xlsx';
import type { AplicacaoExtratoRow } from './aplicacaoExtratoParser';

const HEADER = ['Data', 'Histórico', 'Entrada', 'Saída', 'Saldo'];

/** Baixa o modelo .xlsx de importação de extrato de aplicação. */
export function downloadModeloAplicacoes(): void {
  const sample = [
    ['10/07/2026', 'CAPITALIZ. REND. JR', 10.04, '', 10816.12],
    ['10/07/2026', 'ENCARGOS DE IRRF', '', 3.04, 10816.54],
  ];
  const ws = XLSX.utils.aoa_to_sheet([HEADER, ...sample]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Extrato Aplicação');
  XLSX.writeFile(wb, 'modelo_extrato_aplicacoes.xlsx');
}

/** Lê o .xlsx preenchido no modelo acima e devolve as linhas do extrato. */
export async function parseXlsxAplicacoes(file: File): Promise<AplicacaoExtratoRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const first = wb.SheetNames[0];
  const ws = wb.Sheets[first];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  const rows: AplicacaoExtratoRow[] = [];
  for (const r of raw) {
    const data = String(r['Data'] ?? '').trim();
    const historico = String(r['Histórico'] ?? r['Historico'] ?? '').trim();
    if (!historico) continue;
    const entrada = Number(String(r['Entrada'] ?? '0').toString().replace(',', '.')) || 0;
    const saida = Number(String(r['Saída'] ?? r['Saida'] ?? '0').toString().replace(',', '.')) || 0;
    const saldoRaw = r['Saldo'];
    const saldo = saldoRaw !== '' && saldoRaw != null ? Number(String(saldoRaw).replace(',', '.')) || null : null;
    rows.push({ data, historico, entrada, saida, saldo });
  }
  return rows;
}
