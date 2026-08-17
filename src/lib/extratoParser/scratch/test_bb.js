import { getDocument } from '../../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';

async function run() {
  const data = new Uint8Array(fs.readFileSync('parsers bancarios/ComprovanteBB---2026-08-06-153134.pdf'));
  const pdf = await getDocument({ data, useSystemFonts: true }).promise;
  let text = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    text += tc.items.map(i => i.str).join(' ') + '\n';
  }
  const normalized = text.replace(/\s+/g, ' ').trim();
  
  const BB_COMPROVANTE_ENTRY_RE = /(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*\(([+-])\)\s*(\d{2}\/\d{2}\/\d{4})\s+([\s\S]+?)(?=(?:-?\d{1,3}(?:\.\d{3})*,\d{2}\s*\([+-]\)\s*\d{2}\/\d{2}\/\d{4})|$)/g;
  
  const BB_FOOTER_RE = /\bS\s+A\s+L\s+D\s+O\b|Total\s+Aplica[cç][oõ]es\s+Financeiras|Saldos\s+por\s+dia\s+Base/i;
  let normalizedTruncated = normalized;
  const footerMatch = normalized.match(BB_FOOTER_RE);
  if (footerMatch && footerMatch.index !== undefined) {
    normalizedTruncated = normalized.slice(0, footerMatch.index).trim();
  }
  
  let m;
  const re = new RegExp(BB_COMPROVANTE_ENTRY_RE.source, 'g');
  const transactions = [];
  while ((m = re.exec(normalizedTruncated))) {
    const rawAmount = m[1];
    const sign = m[2];
    const rawDate = m[3];
    const rest = m[4];
    if (rawDate === '00/00/0000') continue;
    if (/^saldo\s+(anterior|do\s+dia)/i.test(rest.trim())) continue;
    transactions.push({ date: rawDate, description: rest.trim(), amount: rawAmount + ' (' + sign + ')' });
  }
  
  console.log('Total:', transactions.length);
  console.log('Transactions on 08/04/2026 or 08/05/2026:');
  const matching = transactions.filter(t => t.date.includes('08/'));
  console.log(JSON.stringify(matching, null, 2));
}
run().catch(console.error);
