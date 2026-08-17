import { format } from 'date-fns';

/** Campo único da UI: código só-dígitos → coluna 5; texto livre → coluna 5 = "0" e prefixo na coluna 6. */
export function parseHistoricoDominioField(raw: string | undefined): {
  codHist: string;
  prefixoHistorico: string;
} {
  const s = String(raw ?? '').trim();
  if (!s) return { codHist: '0', prefixoHistorico: '' };
  if (/^[\d\s]+$/.test(s)) {
    const d = s.replace(/\D/g, '');
    return { codHist: d.length ? d.slice(0, 15) : '0', prefixoHistorico: '' };
  }
  return { codHist: '0', prefixoHistorico: s };
}

export function toHistoricoAsciiDominio(s: string): string {
  let t = (s ?? '').normalize('NFD').replace(/\p{M}/gu, '');
  const map: Record<string, string> = {
    Ç: 'C',
    ç: 'C',
    ß: 'SS',
    '–': '-',
    '—': '-',
  };
  t = t.replace(/[Ççß–—]/g, (ch) => map[ch] ?? ch);
  t = t.replace(/[^\x20-\x7E]/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

export function formatDominioNumberLinha(value: number): string {
  return value.toFixed(2).replace('.', ',');
}

export function contaSomenteDigitosDominio(raw: string): string {
  return (raw ?? '').replace(/\D/g, '');
}

export type MontarLinhaTxtDominioParams = {
  date: Date;
  debContaStr: string;
  credContaStr: string;
  value: number;
  historico: string;
  codigoHistoricoStr?: string;
  complementoHistoricoStr?: string;
  sufixoExtra?: string;
};

/** Linha partida dobrada Domínio (;). */
export function montarLinhaTxtDominio(p: MontarLinhaTxtDominioParams): string {
  const { codHist, prefixoHistorico } = parseHistoricoDominioField(p.codigoHistoricoStr);
  const d = contaSomenteDigitosDominio(p.debContaStr);
  const c = contaSomenteDigitosDominio(p.credContaStr);
  const histBase = toHistoricoAsciiDominio(p.historico).replace(/;/g, ' ');
  const histTxt = prefixoHistorico
    ? `${toHistoricoAsciiDominio(prefixoHistorico).replace(/;/g, ' ')} — ${histBase}`
    : histBase;
  const compl = toHistoricoAsciiDominio(p.complementoHistoricoStr ?? '').replace(/;/g, ' ');
  const extra = p.sufixoExtra ?? '';
  return `${format(p.date, 'dd/MM/yyyy')};${d};${c};${formatDominioNumberLinha(p.value)};${codHist};${histTxt};${compl}${extra}`;
}
