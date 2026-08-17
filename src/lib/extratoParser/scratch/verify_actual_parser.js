import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const bankParsersContent = fs.readFileSync(path.join(__dirname, '../bankParsers.ts'), 'utf8');

// Let's extract the parseBradescoText function body
const startIdx = bankParsersContent.indexOf('export function parseBradescoText');
const endIdx = bankParsersContent.indexOf('export function parseBradescoWords');
const functionCode = bankParsersContent.substring(startIdx, endIdx);

// Let's create a JS function by stripping types using regex
const cleanJsCode = functionCode
  .replace(/export function/g, 'function')
  .replace(/parseBradescoText\([^)]*\)\s*:\s*\{[\s\S]*?\}\s*\{/, 'parseBradescoText(text) {')
  .replace(/:\s*string/g, '')
  .replace(/:\s*string\[\]/g, '')
  .replace(/:\s*ExtratoLine\[\]/g, '')
  .replace(/:\s*ExtratoLine/g, '')
  .replace(/:\s*any/g, '')
  .replace(/const seenKeys = new Set<string>\(\)/g, 'const seenKeys = new Set()')
  .replace(/const uniqueTransactions: ExtratoLine\[\] = \[\]/g, 'const uniqueTransactions = []')
  .replace(/const transactions: ExtratoLine\[\] = \[\]/g, 'const transactions = []')
  .replace(/const metadata: BankStatementMetadata = {/g, 'const metadata = {');

const mockText = `
18/02/2026 SALDO ANTERIOR 976,77
19/02/2026 CARTAO VISA ELECTRON
CIELO S.A - INSTITUICAO DE PAG 9625193 5,92 982,69
CIELO VDA DEBITO MASTER
CIELO S.A - INSTITUICAO DE PAG 9625193 206,63 1.189,32
CIELO VDA DEBITO ELO
CIELO S.A - INSTITUICAO DE PAG 9625193 100,07 1.289,39
RENTAB.INVEST FACILCRED* 1039060 0,01 1.289,40
RENTAB.INVEST FACILCRED* 9846408 0,03 1.289,43
PAGTO ELETRON COBRANCA
BOLETO 305 -1.191,61 97,82
20/02/2026 CARTAO VISA ELECTRON
CIELO S.A - INSTITUICAO DE PAG 9625193 193,80 291,62
ESTORNO TARIFAS
CESTA PJ FACIL 1 22026 168,50 460,12
CIELO VDA DEBITO MASTER
CIELO S.A - INSTITUICAO DE PAG 9625193 164,71 624,83
CIELO VDA DEBITO ELO
CIELO S.A - INSTITUICAO DE PAG 9625193 173,67 798,50
23/02/2026 CARTAO VISA ELECTRON
CIELO S.A - INSTITUICAO DE PAG 9625193 1.026,34 1.824,84
CIELO VDA DEBITO MASTER
CIELO S.A - INSTITUICAO DE PAG 9625193 294,82 2.119,66
CIELO VDA CREDITO ELO
CIELO S.A - INSTITUICAO DE PAG 9625193 14,58 2.134,24
CIELO VDA DEBITO ELO
CIELO S.A - INSTITUICAO DE PAG 9625193 494,60 2.628,84
RENTAB.INVEST FACILCRED* 1039060 0,01 2.628,85
RENTAB.INVEST FACILCRED* 7914898 0,01 2.628,86
PAGTO ELETRON COBRANCA
BOLETO 306 -601,98 2.026,88
PAGTO ELETRON COBRANCA
BOLETO 307 -1.779,79 247,09
PAGTO ELETRON COBRANCA
BOLETO 308 -242,77 4,32
24/02/2026 CARTAO VISA ELECTRON
CIELO S.A - INSTITUICAO DE PAG 9625193 209,47 213,79
CIELO VDA DEBITO MASTER
CIELO S.A - INSTITUICAO DE PAG 9625193 73,58 287,37
CIELO VDA CREDITO ELO
CIELO S.A - INSTITUICAO DE PAG 9625193 4,37 291,74
CIELO VDA DEBITO ELO
CIELO S.A - INSTITUICAO DE PAG 9625193 538,80 830,54
25/02/2026 CARTAO VISA ELECTRON
CIELO S.A - INSTITUICAO DE PAG 9625193 311,01 1.141,55
CIELO VDA DEBITO MASTER
CIELO S.A - INSTITUICAO DE PAG 9625193 9,81 1.151,36
CIELO VDA DEBITO ELO
CIELO S.A - INSTITUICAO DE PAG 9625193 14,64 1.166,00
26/02/2026 CARTAO VISA ELECTRON
CIELO S.A - INSTITUICAO DE PAG 9625193 112,83 1.278,83
CIELO VDA DEBITO MASTER
CIELO S.A - INSTITUICAO DE PAG 9625193 270,77 1.549,60
27/02/2026 CARTAO VISA ELECTRON
CIELO S.A - INSTITUICAO DE PAG 9625193 67,70 1.617,30
CIELO VDA DEBITO MASTER
CIELO S.A - INSTITUICAO DE PAG 9625193 132,45 1.749,75
CIELO VDA DEBITO ELO
CIELO S.A - INSTITUICAO DE PAG 9625193 126,89 1.876,64
02/03/2026 CARTAO VISA ELECTRON
CIELO S.A - INSTITUICAO DE PAG 9625193 672,05 2.548,69
CIELO VDA DEBITO MASTER
CIELO S.A - INSTITUICAO DE PAG 9625193 796,65 3.345,34
CIELO VDA DEBITO ELO
CIELO S.A - INSTITUICAO DE PAG 9625193 244,02 3.589,36
RENTAB.INVEST FACILCRED* 724121 0,02 3.589,38
RENTAB.INVEST FACILCRED* 1966457 0,01 3.589,39
RENTAB.INVEST FACILCRED* 3365167 0,01 3.589,40
PAGTO ELETRON COBRANCA
BOLETO 309 -1.103,67 2.485,73
PAGTO ELETRON COBRANCA
BOLETO 310 -323,49 2.162,24
PAGTO ELETRON COBRANCA
BOLETO 311 -1.237,80 924,44
PAGTO ELETRON COBRANCA
BOLETO 312 -1.148,59 -224,15

// Do arquivo original:
18/05/2026 RENTAB.INVEST FACILCRED* 8711655 0,01 2273,18

// E na seção Últimos Lançamentos:
18/05/2026 RENTAB.INVEST FACILCRED* 8711655 0,01 84,08
`;

// Run the extracted function
const runParser = new Function('text', cleanJsCode + '\nreturn parseBradescoText(text);');
const result = runParser(mockText);

console.log('Result length:', result.transactions.length);
let totalCreditos = 0;
let totalDebitos = 0;
result.transactions.forEach(t => {
  if (t.amount >= 0) totalCreditos += t.amount;
  else totalDebitos += Math.abs(t.amount);
});
console.log('Total Créditos:', totalCreditos.toFixed(2));
console.log('Total Débitos:', totalDebitos.toFixed(2));
console.log('Saldo Final Calculado:', (976.77 + totalCreditos - totalDebitos).toFixed(2));
