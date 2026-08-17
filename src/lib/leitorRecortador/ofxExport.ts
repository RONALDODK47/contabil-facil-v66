import type { ExtractedRow } from './types';
import { buildOFXFitId, formatOFXAmount, sanitizeOFXMemo } from '../../extratoVision/utils/ofxExport';

function parseDateBrToOfx(dateText: string): string {
  const trimmed = dateText.trim();
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(trimmed);
  if (!m) {
    const now = new Date();
    const y = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}${mo}${d}000000`;
  }
  let year = m[3]!;
  if (year.length === 2) year = `20${year}`;
  return `${year}${m[2]!.padStart(2, '0')}${m[1]!.padStart(2, '0')}000000`;
}

function downloadTextFile(content: string, fileName: string, mime = 'application/x-ofx'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportExtractedRowsToOfx(params: {
  rows: ExtractedRow[];
  fileName?: string;
  bancoNome?: string;
  contaBanco?: string;
  saldoAnterior?: number;
}): void {
  const { rows, fileName = 'extrato_recortado.ofx', bancoNome = 'BANCO', contaBanco = '0000001' } = params;
  if (rows.length === 0) return;

  const exportEpochMs = Date.now();
  const dtNow = new Date();
  const dtAsOf = `${dtNow.getFullYear()}${String(dtNow.getMonth() + 1).padStart(2, '0')}${String(dtNow.getDate()).padStart(2, '0')}000000`;

  const saldoAnterior = params.saldoAnterior ?? 0;
  let running = saldoAnterior;

  const transactions = rows
    .map((row, index) => {
      const amt = row.parsedValue ?? 0;
      if (Math.abs(amt) < 0.0001) return '';
      running += amt;
      const trnType = row.isNegative ? 'DEBIT' : 'CREDIT';
      const memo = sanitizeOFXMemo(row.historyText || row.valueText || 'Movimento');
      const dtPosted = parseDateBrToOfx(row.dateText);
      const fitId = buildOFXFitId(dtPosted, formatOFXAmount(amt), memo, index, exportEpochMs);
      return `<STMTTRN>
<TRNTYPE>${trnType}
<DTPOSTED>${dtPosted}
<TRNAMT>${formatOFXAmount(amt)}
<FITID>${fitId}
<MEMO>${memo}
</STMTTRN>`;
    })
    .filter(Boolean)
    .join('\n');

  const ofx = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>${dtAsOf}
<LANGUAGE>POR
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>${exportEpochMs}
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<STMTRS>
<CURDEF>BRL
<BANKACCTFROM>
<BANKID>000
<ACCTID>${sanitizeOFXMemo(contaBanco).replace(/\s/g, '').slice(0, 22)}
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>${dtAsOf}
<DTEND>${dtAsOf}
${transactions}
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>${formatOFXAmount(running)}
<DTASOF>${dtAsOf}
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

  const safeName = fileName.replace(/\.(pdf|png|jpe?g|webp)$/i, '').trim() || 'extrato_recortado';
  downloadTextFile(ofx, `${safeName}.ofx`);
}
