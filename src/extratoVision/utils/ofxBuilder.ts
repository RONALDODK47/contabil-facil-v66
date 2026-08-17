import { Transaction } from '../types';

const formatOFXDate = (dateStr: string, fallback: string): string => {
  const parts = (dateStr || '').split('/');
  if (parts.length < 3) return fallback;
  const day = parts[0].trim().padStart(2, '0');
  const month = parts[1].trim().padStart(2, '0');
  let year = parts[2].trim();
  if (year.length === 2) year = '20' + year;
  return `${year}${month}${day}`;
};

const formatOFXAmount = (value: number): string => value.toFixed(2).replace('.', ',');

const sanitizeMemo = (memo: string): string => (memo || '')
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
  .replace(/[^a-zA-Z0-9., \-;&_ ]/g, '');

/** Gera o conteúdo de um arquivo OFX 1.02 (SGML) a partir de uma lista de lançamentos. */
export const buildOFXString = (transactions: Transaction[]): string => {
  const now = new Date();
  const dServer = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

  let dtStart = dServer;
  let dtEnd = dServer;
  if (transactions.length > 0) {
    const dates = transactions.map(t => formatOFXDate(t.data, dServer));
    dates.sort();
    dtStart = dates[0];
    dtEnd = dates[dates.length - 1];
  }

  let ofxStr = `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:UTF-8\nCHARSET:1252\nCOMPRESSION:NONE\nOLDFILEUID:NONE\nNEWFILEUID:NONE\n\n<OFX>\n  <SIGNONMSGSRSV1>\n    <SONRS>\n      <STATUS>\n        <CODE>0</CODE>\n        <SEVERITY>INFO</SEVERITY>\n      </STATUS>\n      <DTSERVER>${dServer}</DTSERVER>\n      <LANGUAGE>POR</LANGUAGE>\n    </SONRS>\n  </SIGNONMSGSRSV1>\n  <BANKMSGSRSV1>\n    <STMTTRNRS>\n      <TRNUID>0</TRNUID>\n      <STATUS>\n        <CODE>0</CODE>\n        <SEVERITY>INFO</SEVERITY>\n      </STATUS>\n      <STMTRS>\n        <CURDEF>BRL</CURDEF>\n        <BANKACCTFROM>\n          <BANKID>001</BANKID>\n          <ACCTID>99999999</ACCTID>\n          <ACCTTYPE>CHECKING</ACCTTYPE>\n        </BANKACCTFROM>\n        <BANKTRANLIST>\n          <DTSTART>${dtStart}</DTSTART>\n          <DTEND>${dtEnd}</DTEND>\n`;

  transactions.forEach((t, i) => {
    const postedDate = formatOFXDate(t.data, dServer);
    const trnType = t.cd === 'C' ? 'CREDIT' : 'DEBIT';
    const trnAmt = formatOFXAmount(t.cd === 'D' ? -Math.abs(t.valor) : Math.abs(t.valor));
    const fitId = `${postedDate.substring(2)}${String(i + 1).padStart(3, '0')}`;
    const memo = sanitizeMemo(t.historico);

    ofxStr += `          <STMTTRN>\n            <TRNTYPE>${trnType}</TRNTYPE>\n            <DTPOSTED>${postedDate}</DTPOSTED>\n            <TRNAMT>${trnAmt}</TRNAMT>\n            <FITID>${fitId}</FITID>\n            <CHECKNUM></CHECKNUM>\n            <MEMO>${memo}</MEMO>\n          </STMTTRN>\n`;
  });

  ofxStr += `        </BANKTRANLIST>\n      </STMTRS>\n    </STMTTRNRS>\n  </BANKMSGSRSV1>\n</OFX>`;
  return ofxStr;
};
