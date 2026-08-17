const text = `Extrato de Conta Corrente
Cliente COMERCIAL FERNANDES LTDA
Agência: 43-4 Conta: 20027-1
Lançamentos
Dia Lote Documento Histórico Valor
0,00 (+) 31/03/2026 Saldo Anterior
840,00 (+) 01/04/2026 14397 11417418275991
Pix - Recebido
01/04 14:17 35451882134 Jair Martins D
12.492,24 (-) 01/04/2026 13128 4311471000111 FCO Liberação
11.652,24 (+) 01/04/2026 9903 BB Rende Fácil
Rende Facil
0,00 (+) 00/00/0000 14397 Saldo do dia
140,00 (+) 02/04/2026 14397 21146182685191
Pix - Recebido
02/04 11:46 16690675000140 FARMACIA SA
1.185,00 (+) 02/04/2026 14397 21709489918662
Pix - Recebido
02/04 17:09 00003345293102 MANOEL DE D
1.325,00 (-) 02/04/2026 9903 BB Rende Fácil
Rende Facil
0,00 (+) 00/00/0000 14397 Saldo do dia
290,00 (+) 06/04/2026 14397 40909251941651
Pix - Recebido
04/04 09:09 86983520149 ALEXANDRE DE A
72,00 (+) 06/04/2026 14397 41432449576562
Pix - Recebido
04/04 14:32 00045072442187 LUZENIR A D
1.533,00 (+) 06/04/2026 14397 61650127053432
Pix - Recebido
06/04 16:50 00048693480634 EDEVALDO VA
448,00 (+) 06/04/2026 14397 61653496884961
Pix - Recebido
06/04 16:53 04803199108 MATHEUS RENAN
1.000,00 (+) 06/04/2026 14397 61954493245742
Pix - Recebido
06/04 19:54 00002800369140 MURILLO REZ
888,69 (-) 06/04/2026 13105 40601 Pagamento de Boleto
GUABI NUTRICAO S ANIMAL LTDA
688,26 (-) 06/04/2026 13105 40602 Pagamento de Boleto
GUABI NUTRICAO S ANIMAL LTDA
513,18 (-) 06/04/2026 13105 40603 Pagamento de Boleto
PX - IRMAOS PEIXOTO PRODUTOS V
706,29 (-) 06/04/2026 13105 40604 Pagamento de Boleto
AMEV IMPORTADORA E DISTRIBUIDO
81,40 (-) 06/04/2026 13113 890961201533307 Tarifa Pacote de Serviços
Cobrança referente 06/04/2026
465,18 (-) 06/04/2026 9903 BB Rende Fácil
Rende Facil
0,00 (+) 00/00/0000 14397 Saldo do dia
140,00 (+) 07/04/2026 14397 70819043965532
Pix - Recebido
07/04 08:19 00002379548188 AMANDA STTE
160,00 (+) 07/04/2026 14397 71259499496992
Pix - Recebido
07/04 12:59 00070383423120 ANA LUISA G
10,00 (+) 07/04/2026 14397 71559341366801
Pix - Recebido
07/04 15:59 57726760168 MARIA RODRIGUE
310,00 (-) 07/04/2026 9903 BB Rende Fácil
Rende Facil
0,00 (+) 00/00/0000 14397 Saldo do dia
2.080,00 (+) 08/04/2026 14397 81708302431292
Pix - Recebido
08/04 17:08 00086983520149 ALEXANDRE D
2.080,00 (-) 08/04/2026 9903 BB Rende Fácil
Rende Facil
00/00/000 14397 Saldo do dia 0,00 (+)`;

// 1. Normalize spaces
let normalized = text.replace(/\s+/g, ' ').trim();

// 2. Pre-process to clean up all page header/footer and noise
// Remove header components
normalized = normalized.replace(/Extrato de Conta Corrente/gi, '');
normalized = normalized.replace(/Cliente\s+[A-Z0-9\s]+LTDA/gi, '');
normalized = normalized.replace(/Agência:\s*[\d-]+\s*Conta:\s*[\d-]+/gi, '');
normalized = normalized.replace(/Lançamentos/gi, '');
normalized = normalized.replace(/Dia\s+Lote\s+Documento\s+Histórico\s+Valor/gi, '');

// Remove page numbers (like " 0 " at page breaks)
normalized = normalized.replace(/\s+\b\d\b\s+/g, ' ');

// Remove saldo do dia entries completely so lookahead doesn't skip them
// Format: 0,00 (+) 00/00/0000 or 0,00 (+) 00/00/000
normalized = normalized.replace(/-?\d{1,3}(?:\.\d{3})*,\d{2}\s*\([+-]\)\s*00\/00\/\d{3,4}\s*(?:14397|13105)?\s*Saldo do dia/gi, '');

// Let's do a double check space cleanup
normalized = normalized.replace(/\s+/g, ' ').trim();

console.log('Cleaned Normalized:', normalized.substring(normalized.length - 300));
console.log('---');

const BB_COMPROVANTE_ENTRY_RE =
  /(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*\(([+-])\)\s*(\d{2}\/\d{2}\/\d{4})\s+([\s\S]+?)(?=(?:-?\d{1,3}(?:\.\d{3})*,\d{2}\s*\([+-]\)\s*\d{2}\/\d{2}\/\d{4})|$)/g;

let m;
const re = new RegExp(BB_COMPROVANTE_ENTRY_RE.source, 'g');
const transactions = [];
while ((m = re.exec(normalized))) {
  const rawAmount = m[1];
  const sign = m[2];
  const rawDate = m[3];
  const rest = m[4];
  
  const descTest = rest.trim().toLowerCase();
  if (/^saldo\s+(anterior|do\s+dia)/i.test(rest.trim())) continue;
  if (/saldo\s+do\s+dia/i.test(descTest)) continue;
  
  transactions.push({
    date: rawDate,
    amount: rawAmount + ' (' + sign + ')',
    description: rest.trim()
  });
}

console.log(JSON.stringify(transactions.slice(-5), null, 2));
