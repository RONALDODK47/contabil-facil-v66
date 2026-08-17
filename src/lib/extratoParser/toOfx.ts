import { BankTransaction, BankStatementMetadata } from './types';
import { sanitizeOFXMemo, formatOFXAmount, buildOFXFitId } from '../../extratoVision/utils/ofxExport';

function isoToOfxDate(iso: string): string {
  return `${iso.replace(/-/g, '')}000000`;
}

export function bankStatementToOfx(
  transactions: BankTransaction[],
  metadata: BankStatementMetadata,
  saldoAnterior = 0
): string {
  const exportEpochMs = Date.now();
  const dtNow = new Date();
  const dtAsOf = `${dtNow.getFullYear()}${String(dtNow.getMonth() + 1).padStart(2, '0')}${String(dtNow.getDate()).padStart(2, '0')}000000`;

  let running = saldoAnterior;
  const lines = transactions
    .map((tx, index) => {
      const amt = tx.amount;
      if (Math.abs(amt) < 0.0001) return '';
      running += amt;
      const trnType = amt < 0 ? 'DEBIT' : 'CREDIT';
      const memo = sanitizeOFXMemo(tx.description || 'Movimento');
      const dtPosted = isoToOfxDate(tx.date);
      const fitId = buildOFXFitId(dtPosted, formatOFXAmount(Math.abs(amt)), memo, index, exportEpochMs);
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

  const dtStart = transactions.length ? isoToOfxDate(transactions[0].date) : dtAsOf;
  const dtEnd = transactions.length ? isoToOfxDate(transactions[transactions.length - 1].date) : dtAsOf;
  const acctId = sanitizeOFXMemo(metadata.account_number || '0000001').replace(/\s/g, '').slice(0, 22) || '0000001';

  return `OFXHEADER:100
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
<ACCTID>${acctId}
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>${dtStart}
<DTEND>${dtEnd}
${lines}
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>${formatOFXAmount(running)}
<DTASOF>${dtAsOf}
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;
}

export function downloadOfxFile(content: string, fileName: string): void {
  const blob = new Blob([content], { type: 'application/x-ofx;charset=utf-8' });
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
