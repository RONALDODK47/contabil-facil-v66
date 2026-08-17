const page1 = `Extrato de Conta Corrente
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

const page2 = `Extrato de Conta Corrente
Cliente COMERCIAL FERNANDES LTDA
Agência: 43-4 Conta: 20027-1
Lançamentos
Dia Lote Documento Histórico Valor
0
70,00 (+) 09/04/2026 14397 91817125979381
Pix - Recebido
09/04 18:17 02038152110 Lorena Nascent
860,00 (+) 09/04/2026 14397 91853106995882
Pix - Recebido
09/04 18:53 00086983520149 ALEXANDRE D
930,00 (-) 09/04/2026 9903 BB Rende Fácil
Rende Facil
0,00 (+) 00/00/0000 14397 Saldo do dia
25,00 (+) 10/04/2026 14397 101200446718222
Pix - Recebido
10/04 12:00 00085266639172 WANDERLEIA
5.674,56 (-) 10/04/2026 13128 4309649000550 BB GIRO FGO PRONAMPE
106,33 (-) 10/04/2026 13013 46301 Ourocap PM
OUROCAP PM
5.755,89 (+) 10/04/2026 9903 BB Rende Fácil
Rende Facil
0,00 (+) 00/00/0000 14397 Saldo do dia
135,00 (+) 13/04/2026 14397 111234041802362
Pix - Recebido
11/04 12:34 00002287073159 DARTANHAN S
135,00 (-) 13/04/2026 9903 BB Rende Fácil
Rende Facil
0,00 (+) 00/00/0000 14397 Saldo do dia
850,00 (+) 14/04/2026 14397 140738483453872
Pix - Recebido
14/04 07:38 00048693480634 EDEVALDO VA
14,00 (+) 14/04/2026 14397 141334535793661
Pix - Recebido
14/04 13:34 82326720130 ROSANGELA JOSE
864,00 (-) 14/04/2026 9903 BB Rende Fácil
Rende Facil
0,00 (+) 00/00/0000 13105 Saldo do dia
661,21 (-) 15/04/2026 13105 41501 Pagamento de Boleto
TAMBASA ATACADISTA
356,18 (-) 15/04/2026 13105 41502 Pagamento de Boleto
MANFRIM INDL E COML LTDA
1.017,39 (+) 15/04/2026 9903 BB Rende Fácil
Rende Facil
0,00 (+) 00/00/0000 13105 Saldo do dia
77,53 (-) 17/04/2026 13105 41701 Pagamento de Boleto
GO GOV GABINETE DO PRESIDENTE
77,53 (+) 17/04/2026 9903 BB Rende Fácil
Rende Facil
0,00 (+) 00/00/0000 14397 Saldo do dia
2.620,00 (+) 20/04/2026 14397 201258433547021
Pix - Recebido
20/04 12:58 00368598187 NEWTON
ROBERTO
141,00 (-) 20/04/2026 13105 42001 Pagamento de Impostos
DARE - DEMAIS ORGAOS GO
2.479,00 (-) 20/04/2026 9903 BB Rende Fácil
Rende Facil
0,00 (+) 00/00/0000 14397 Saldo do dia
28,50 (+) 22/04/2026 14397 211043024377701
Pix - Recebido
21/04 10:43 00561687803 ANTONIO F NETO
992,34 (-) 22/04/2026 13105 42201 Pagamento de Boleto
CENTRAL VETERINARIA
270,00 (-) 22/04/2026 13105 42202
Pix - Enviado
22/04 13:17 ORLANDO MARTINS`;

const page3 = `Extrato de Conta Corrente
Cliente COMERCIAL FERNANDES LTDA
Agência: 43-4 Conta: 20027-1
Lançamentos
Dia Lote Documento Histórico Valor
MONTEIRO
1.233,84 (+) 22/04/2026 9903 BB Rende Fácil
Rende Facil
0,00 (+) 00/00/0000 13105 Saldo do dia
477,44 (-) 23/04/2026 13105 42301 Pix - Enviado
23/04 16:41 CEF MATRIZ
177,96 (-) 23/04/2026 13105 42302 Pagamento de Impostos
DAS - SIMPLES NACIONAL
655,40 (+) 23/04/2026 9903 BB Rende Fácil
Rende Facil
0,00 (+) 00/00/0000 14397 Saldo do dia
50,00 (+) 27/04/2026 14397 250842076846401
Pix - Recebido
25/04 08:42 00308890140 JOZIANY CARNEI
516,00 (+) 27/04/2026 14397 250917368687012
Pix - Recebido
25/04 09:17 00002761976150 HEITOR VAZ
2.000,00 (+) 27/04/2026 14397 251212330802401
Pix - Recebido
25/04 12:12 02404578111 NATALIA APAREC
11.386,00 (+) 27/04/2026 14397 271428463220481
Pix - Recebido
27/04 14:28 70358042186 VALDIVINO CORD
1.000,00 (+) 27/04/2026 14397 271530309089781
Pix - Recebido
27/04 15:30 35451882134 Jair Martins D
14.952,00 (-) 27/04/2026 9903 BB Rende Fácil
Rende Facil
0,00 (+) 00/00/0000 14397 Saldo do dia
200,00 (+) 28/04/2026 14397 281327250634031
Pix - Recebido
28/04 13:27 46749101000160 CENTRO DE T
200,00 (-) 28/04/2026 9903 BB Rende Fácil
Rende Facil
0,00 (+) 00/00/0000 14397 Saldo do dia
5,00 (+) 29/04/2026 14397 291608136501691
Pix - Recebido
29/04 16:08 61528526333 Lissandra Sant
541,38 (-) 29/04/2026 13105 42901 Pagamento de Boleto
MANFRIM INDUSTRIAL E COMERCIAL
536,38 (+) 29/04/2026 9903 BB Rende Fácil
Rende Facil
0,00 (+) 00/00/0000 14397 Saldo do dia
130,00 (+) 30/04/2026 14397 301021069818241
Pix - Recebido
30/04 10:21 02379548188 AMANDA STTEFAN
168,00 (+) 30/04/2026 14397 301732254785052
Pix - Recebido
30/04 17:32 00038283182153 DIVANIA DA
298,00 (-) 30/04/2026 9903 BB Rende Fácil
0,00 (+) 00/00/0000 Saldo do dia
0,00 (+) 30/04/2026 S A L D O
Total Aplicações Financeiras
* Saldos por dia Base
Sujeitos a confirmação no momento da contratação
0,00`;

const fullText = page1 + '\n' + page2 + '\n' + page3;

// Clean normalized spaces
let normalized = fullText.replace(/\s+/g, ' ').trim();

// Pre-process Saldo lines
const SALDO_LINE_RE = /(?:-?\d{1,3}(?:\.\d{3})*,\d{2}\s*\([+-]\)\s*\d{2}\/\d{2}\/\d{3,4}\s*(?:\d+)?\s*Saldo\s+(?:Anterior|do\s+dia|Final|Atual|Dispon[ií]vel)|\d{2}\/\d{2}\/\d{3,4}\s*(?:\d+)?\s*Saldo\s+(?:Anterior|do\s+dia|Final|Atual|Dispon[ií]vel)\s*-?\d{1,3}(?:\.\d{3})*,\d{2}\s*\([+-]\))/gi;
normalized = normalized.replace(SALDO_LINE_RE, '');

// Clean page numbers and headers
normalized = normalized.replace(/Extrato de Conta Corrente/gi, '');
normalized = normalized.replace(/Cliente\s+[A-Z0-9\s]+LTDA/gi, '');
normalized = normalized.replace(/Agência:\s*[\d-]+\s*Conta:\s*[\d-]+/gi, '');
normalized = normalized.replace(/Lançamentos/gi, '');
normalized = normalized.replace(/Dia\s+Lote\s+Documento\s+Histórico\s+Valor/gi, '');
normalized = normalized.replace(/\s+\b\d\b\s+/g, ' ');
normalized = normalized.replace(/\s+/g, ' ').trim();

// Try to parse using regex
const BB_COMPROVANTE_ENTRY_RE = /(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*\(([+-])\)\s*(\d{2}\/\d{2}\/\d{4})\s+([\s\S]+?)(?=(?:-?\d{1,3}(?:\.\d{3})*,\d{2}\s*\([+-]\)\s*\d{2}\/\d{2}\/\d{4})|$)/g;

let m;
const re = new RegExp(BB_COMPROVANTE_ENTRY_RE.source, 'g');
const transactions = [];
while ((m = re.exec(normalized))) {
  const rawAmount = m[1];
  const sign = m[2];
  const rawDate = m[3];
  const rest = m[4];
  if (rawDate === '00/00/0000') continue;
  
  transactions.push({
    date: rawDate,
    amount: rawAmount + ' (' + sign + ')',
    description: rest.trim()
  });
}

console.log('Total extracted:', transactions.length);
console.log('08/04/2026 Transactions:', JSON.stringify(transactions.filter(t => t.date === '08/04/2026'), null, 2));
