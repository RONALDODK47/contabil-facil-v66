const page1 = `Extrato (Últimos Lançamentos)
COMERCIAL FERNANDES EIRELI - ME | CNPJ: 014.310.204/0001-33
Nome do usuário: Murilo Beato Fernandes
Data da operação: 20/05/2026 - 09h14
Agência | Conta Total Disponível (R$) Total (R$)
01894 | 0020527-3 1.337,29 1.337,29
Extrato de: Ag: 01894 | CC: 0020527-3
Data Lançamento Dcto. Crédito (R$) Débito (R$) Saldo (R$)
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
Total 96.902,18 -97.794,87 84,08
Total 1.253,22 0,00 1.337,29`;

function parseBradescoText(text) {
  const lines = text.split('\n').map(l => l.trim());
  let currentDate = '';
  let accumulatedDesc = [];
  const transactions = [];

  const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})\b/;
  const VALUES_RE = /(-?\d{1,3}(?:\.\d{3})*,\d{2})\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;
  const DOC_RE = /\b(\d{3,8})\b\s*$/;

  for (let line of lines) {
    if (!line) continue;

    // Ignora cabeçalhos/rodapés e ruídos óbvios
    if (line.includes('|')) continue;
    if (line.includes('Total Disponível') || line.includes('Total (R$)')) continue;
    if (/^total\b/i.test(line)) continue; // Descarta linhas de Total
    if (/saldo\s+invest/i.test(line)) continue; // Descarta saldos de investimentos
    if (/extrato\s*\(últimos\s*lançamentos\)/i.test(line)) continue;
    if (/nome\s*do\s*usuário/i.test(line)) continue;
    if (/data\s*da\s*operação/i.test(line)) continue;
    if (/extrato\s*de:\s*ag:/i.test(line)) continue;
    if (/data\s+lançamento\s+dcto/i.test(line)) continue;
    if (/saldo\s+anterior/i.test(line)) continue;

    // 1) Verifica se a linha começa com data
    const dateMatch = line.match(DATE_RE);
    if (dateMatch) {
      const [dd, mm, yyyy] = dateMatch[0].split('/');
      currentDate = `${yyyy}-${mm}-${dd}`;
      line = line.replace(DATE_RE, '').trim();
    }

    // 2) Verifica se a linha tem os valores de transação (crédito/débito + saldo)
    const valuesMatch = line.match(VALUES_RE);
    if (valuesMatch) {
      const rawAmount = valuesMatch[1];
      const rawBalance = valuesMatch[2];

      // Remove os valores do final da linha
      let cleanLine = line.replace(VALUES_RE, '').trim();

      // Tenta extrair número de documento (dcto) se houver
      const docMatch = cleanLine.match(DOC_RE);
      let doc = '';
      if (docMatch) {
        doc = docMatch[1];
        cleanLine = cleanLine.replace(DOC_RE, '').trim();
      }

      // Adiciona o restante à descrição acumulada
      if (cleanLine) {
        accumulatedDesc.push(cleanLine);
      }

      const description = accumulatedDesc.join(' ').replace(/\s+/g, ' ').trim();
      accumulatedDesc = []; // reseta acumulador

      // Converte valores para número BRL
      const amount = parseFloat(rawAmount.replace(/\./g, '').replace(',', '.')) || 0;
      const balance = parseFloat(rawBalance.replace(/\./g, '').replace(',', '.')) || 0;

      // Só aceita transações se tiver data
      if (currentDate) {
        transactions.push({
          date: currentDate,
          description: doc ? `${description} Dcto: ${doc}` : description,
          amount,
          balance
        });
      }
    } else {
      // É uma linha de continuação da descrição
      accumulatedDesc.push(line);
    }
  }

  return transactions;
}

const txs = parseBradescoText(page1);
console.log('Total extracted:', txs.length);

let totalCreditos = 0;
let totalDebitos = 0;
txs.forEach(t => {
  if (t.amount >= 0) totalCreditos += t.amount;
  else totalDebitos += Math.abs(t.amount);
});
console.log('Total Créditos:', totalCreditos.toFixed(2));
console.log('Total Débitos:', totalDebitos.toFixed(2));
console.log('Saldo Final Calculado:', (976.77 + totalCreditos - totalDebitos).toFixed(2));
