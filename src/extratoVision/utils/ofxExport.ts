/** OFX exige ponto como separador decimal (padrão internacional). */
export function formatOFXAmount(value: number): string {
  return value.toFixed(2);
}

export function sanitizeOFXMemo(memo: string): string {
  return memo
    .substring(0, 255)
    .replace(/[çÇ]/g, 'c')
    .replace(/[áàãâä]/gi, 'a')
    .replace(/[éèêë]/gi, 'e')
    .replace(/[íìîï]/gi, 'i')
    .replace(/[óòõôö]/gi, 'o')
    .replace(/[úùûü]/gi, 'u')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[^a-zA-Z0-9., \-_ ]/g, '');
}

/** FITID único entre importações (data + valor + histórico + índice + carimbo de exportação). */
export function buildOFXFitId(
  postedDate: string,
  trnAmt: string,
  memo: string,
  index: number,
  exportEpochMs: number
): string {
  const raw = `${postedDate}|${trnAmt}|${memo}|${index}|${exportEpochMs}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (Math.imul(31, hash) + raw.charCodeAt(i)) | 0;
  }
  const suffix = Math.abs(hash).toString(36).padStart(6, '0').slice(0, 8);
  return `${postedDate}${exportEpochMs}${suffix}${String(index + 1).padStart(4, '0')}`;
}

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

export interface Transaction {
  id: string;
  data: string;
  historico: string;
  valor: number;
  cd: string;
}

export function buildOFXString(transactions: Transaction[]): string {
  if (transactions.length === 0) return '';

  const exportEpochMs = Date.now();
  const dtNow = new Date();
  const dtAsOf = `${dtNow.getFullYear()}${String(dtNow.getMonth() + 1).padStart(2, '0')}${String(dtNow.getDate()).padStart(2, '0')}000000`;

  let running = 0;
  const transactionLines = transactions
    .map((tx, index) => {
      const amt = tx.valor ?? 0;
      if (Math.abs(amt) < 0.0001) return '';
      running += amt;
      const trnType = amt < 0 ? 'DEBIT' : 'CREDIT';
      const memo = sanitizeOFXMemo(tx.historico || 'Movimento');
      const dtPosted = parseDateBrToOfx(tx.data);
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
<ACCTID>0000001
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>${dtAsOf}
<DTEND>${dtAsOf}
${transactionLines}
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
