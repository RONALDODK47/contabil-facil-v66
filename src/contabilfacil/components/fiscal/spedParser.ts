/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Parser Profissional de Arquivos SPED (Redirecionamento integral dos códigos para a coluna CFOP)
 */

import { SpedInvoice } from './types';

export function sanitizeCfop(code: string | undefined | null): string {
  if (!code) return '';
  const parts = code.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  const validParts: string[] = [];

  for (const part of parts) {
    // Rejeita valores com vírgula ou decimais (ex: 1350,00 ou 615,00)
    if (part.includes(',') || (part.includes('.') && part.split('.')[1]?.length === 2)) continue;
    // Aceita códigos de 3 a 5 dígitos (ex: 411, 1102, 5102, 6102)
    if (/^\d{3,5}$/.test(part)) {
      if (!validParts.includes(part)) validParts.push(part);
    }
  }

  return validParts.join(', ');
}

function parseSpedDate(dateStr: string): string {
  if (!dateStr || dateStr.length !== 8) return dateStr;
  return `${dateStr.substring(4, 8)}-${dateStr.substring(2, 4)}-${dateStr.substring(0, 2)}`;
}

function parseBrazilianNumber(val: string): number {
  if (!val) return 0;
  const clean = val.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
}

function addCfopToInvoice(invoice: SpedInvoice, code: string) {
  const cleanCode = sanitizeCfop(code);
  if (!cleanCode) return;
  const current = invoice.cfop || '';
  const parts = current ? current.split(', ') : [];
  const newParts = cleanCode.split(', ');
  newParts.forEach((p) => {
    if (!parts.includes(p)) parts.push(p);
  });
  invoice.cfop = parts.join(', ');
}

export function parseSpedFile(content: string): { invoices: SpedInvoice[]; accounts: Record<string, string>; companyName: string; periodoInicio?: string; periodoFim?: string; totalPisMes?: number; totalCofinsMes?: number } {
  const lines = content.split('\n');
  const invoices: SpedInvoice[] = [];
  const accounts: Record<string, string> = {};
  const participants: Record<string, string> = {};
  let companyName = 'Empresa Desconhecida';
  let periodoInicio: string | undefined;
  let periodoFim: string | undefined;
  let totalPisMes: number | undefined;
  let totalCofinsMes: number | undefined;

  // Primeira Passagem: Informações globais (Empresa, Participantes, Plano de Contas)
  for (const line of lines) {
    const fields = line.split('|');
    const block = fields[1];
    if (!block) continue;

    if (block === '0000') {
      // |0000|006|0|||DT_INI|DT_FIN|NOME|CNPJ|UF|COD_MUN|...|
      //    1     2  3  4  5      6      7     8       9   10
      companyName = fields[8] || fields[10] || companyName;
      periodoInicio = fields[6] || undefined;
      periodoFim = fields[7] || undefined;
    }
    if (block === '0150') {
      const id = fields[2];
      const name = fields[3];
      if (id && name) participants[id] = name;
    }
    if (block === '0500') {
      const code = fields[6] || fields[2];
      const name = fields[7] || fields[3];
      if (code && name) accounts[code] = name;
    }
  }

  // Segunda Passagem: Extração de Notas Fiscais e Apurações
  let lastInvoice: SpedInvoice | null = null;

  for (const line of lines) {
    const fields = line.split('|');
    const block = fields[1];
    if (!block) continue;

    // 1. Mercadorias / NF-e (C100) — layout oficial do Guia Prático EFD (Bloco C):
    // |C100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|NUM_DOC|CHV_NFE|DT_DOC|DT_E_S|VL_DOC|...|VL_ICMS|...|VL_PIS|VL_COFINS|
    //    1       2         3        4       5       6    7       8       9     10     11     12   ...   22    ...   26     27
    // (o campo IND_EMIT, entre IND_OPER e COD_PART, faltava aqui — deslocava todos os
    // campos seguintes em 1 posição e corrompia data/valor/participante/impostos)
    if (block === 'C100') {
      const indOper = fields[2]; // 0 = Entrada, 1 = Saída
      const type = indOper === '0' ? 'entrada' : 'saida';
      const docNum = fields[8];
      const date = parseSpedDate(fields[10]);
      const value = parseBrazilianNumber(fields[12]);
      const participantId = fields[4];

      const invoice: SpedInvoice = {
        id: Math.random().toString(36).substring(2, 11),
        type,
        date,
        description: `NF-e ${docNum}`,
        value: type === 'entrada' ? -value : value,
        documentNumber: docNum,
        participantName: participants[participantId] || participantId || 'Consumidor/Outro',
        pis: parseBrazilianNumber(fields[26]),
        cofins: parseBrazilianNumber(fields[27]),
        icms: parseBrazilianNumber(fields[22]),
        source: 'ICMS',
      };
      invoices.push(invoice);
      lastInvoice = invoice;
    }

    // 2. Serviços / NFS-e (A100) - SPED Contribuições
    // Layout único (Guia Prático EFD-Contribuições) — posições fixas. CHV_NFSE
    // (posição 9) é só às vezes preenchida (nem todo prestador tem chave de
    // acesso de NFS-e), mas isso NÃO desloca nenhum campo seguinte — confirmado
    // em arquivos reais com e sem CHV_NFSE preenchida, ambos nas mesmas posições:
    // |A100|IND_OPER|IND_EMIT|COD_PART|COD_SIT|SER|SUB|NUM_DOC|CHV_NFSE|DT_DOC|DT_E_S|VL_DOC|IND_PGTO|VL_DESC|VL_BC_PIS|VL_PIS|VL_BC_COFINS|VL_COFINS|VL_PIS_RET|VL_COFINS_RET|VL_ISS|
    //    1       2         3        4        5     6   7     8       9        10     11     12      13       14      15         16     17           18        19         20            21
    else if (block === 'A100') {
      const indOper = fields[2];
      const sitDoc = fields[5];

      const rawVal = parseBrazilianNumber(fields[12]);
      if (sitDoc === '02' || rawVal === 0) continue;

      const type = indOper === '0' ? 'entrada' : 'saida';
      const docNum = fields[8] || 'NFS';
      const date = parseSpedDate(fields[10]);
      const participantId = fields[4];

      const invoice: SpedInvoice = {
        id: Math.random().toString(36).substring(2, 11),
        type,
        date,
        description: `NFS-e ${docNum}`,
        value: type === 'entrada' ? -rawVal : rawVal,
        documentNumber: docNum,
        participantName: participants[participantId] || participantId || 'Prestador/Tomador',
        pis: parseBrazilianNumber(fields[16]),
        cofins: parseBrazilianNumber(fields[18]),
        icms: 0,
        iss: parseBrazilianNumber(fields[21]),
        source: 'CONTRIBUICOES',
      };
      invoices.push(invoice);
      lastInvoice = invoice;
    }

    // 3. Concessionárias / Energia / Água / Gás (C500)
    // |C500|IND_OPER|COD_PART|COD_MOD|SER|SUB|NUM_DOC|DT_DOC|DT_E_S|VL_DOC|VL_DESC|...|VL_ICMS|...|VL_PIS|VL_COFINS|
    //    1       2        3       4     5   6     7       8      9     10      11   ...   16    ...   22     23
    else if (block === 'C500') {
      const indOper = fields[2];
      const type = indOper === '0' ? 'entrada' : 'saida';
      const docNum = fields[7];
      const date = parseSpedDate(fields[9]);
      const value = parseBrazilianNumber(fields[10]);
      const participantId = fields[3];

      const invoice: SpedInvoice = {
        id: Math.random().toString(36).substring(2, 11),
        type,
        date,
        description: `Consumo/Util ${docNum}`,
        value: type === 'entrada' ? -value : value,
        documentNumber: docNum,
        participantName: participants[participantId] || participantId || 'Concessionária',
        pis: parseBrazilianNumber(fields[22]),
        cofins: parseBrazilianNumber(fields[23]),
        icms: parseBrazilianNumber(fields[16]),
        source: 'ICMS',
      };
      invoices.push(invoice);
      lastInvoice = invoice;
    }

    // 4. Transporte (D100) / Comunicação (D500)
    // D100: |D100|IND_OPER|IND_SERV|COD_PART|COD_MOD|SER|SUB|NUM_DOC|CHV_CTE|DT_DOC|...|VL_DOC|...|VL_ICMS|...|VL_PIS|VL_COFINS|
    //         1       2        3         4       5   6    7       8       9    ...   10     ...   19    ...   21     22
    // D500: |D500|IND_OPER|IND_SERV|COD_PART|COD_MOD|SER|SUB|NUM_DOC|DT_DOC|VL_DOC|...|VL_PIS|VL_COFINS|...
    //         1       2        3       4       5   6    7       8      9     10   ...   15     16
    else if (block === 'D100') {
      const indOper = fields[2];
      const type = indOper === '0' ? 'entrada' : 'saida';
      const docNum = fields[7];
      const date = parseSpedDate(fields[9]);
      const value = parseBrazilianNumber(fields[10]);
      const participantId = fields[3];

      const invoice: SpedInvoice = {
        id: Math.random().toString(36).substring(2, 11),
        type,
        date,
        description: `CT-e ${docNum}`,
        value: type === 'entrada' ? -value : value,
        documentNumber: docNum,
        participantName: participants[participantId] || participantId || 'Transportadora',
        pis: parseBrazilianNumber(fields[21]),
        cofins: parseBrazilianNumber(fields[22]),
        icms: parseBrazilianNumber(fields[19]),
        source: 'ICMS',
      };
      invoices.push(invoice);
      lastInvoice = invoice;
    }
    else if (block === 'D500') {
      const indOper = fields[2];
      const type = indOper === '0' ? 'entrada' : 'saida';
      const docNum = fields[6];
      const date = parseSpedDate(fields[7]);
      const value = parseBrazilianNumber(fields[9]);
      const participantId = fields[3];

      const invoice: SpedInvoice = {
        id: Math.random().toString(36).substring(2, 11),
        type,
        date,
        description: `Comunicação ${docNum}`,
        value: type === 'entrada' ? -value : value,
        documentNumber: docNum,
        participantName: participants[participantId] || participantId || 'Operadora',
        pis: parseBrazilianNumber(fields[15]),
        cofins: parseBrazilianNumber(fields[16]),
        icms: 0,
        source: 'ICMS',
      };
      invoices.push(invoice);
      lastInvoice = invoice;
    }

    // 5. Cupom Fiscal ECF (C405)
    else if (block === 'C405') {
      const date = parseSpedDate(fields[2]);
      const docNum = fields[3];
      const value = parseBrazilianNumber(fields[5]);

      const invoice: SpedInvoice = {
        id: Math.random().toString(36).substring(2, 11),
        type: 'saida',
        date,
        description: `ECF Redução Z ${docNum}`,
        value: value,
        documentNumber: docNum,
        participantName: 'Consumidor Final',
        pis: 0,
        cofins: 0,
        icms: 0,
        source: 'ICMS',
      };
      invoices.push(invoice);
      lastInvoice = invoice;
    }

    // 6. SAT CF-e (C800)
    else if (block === 'C800') {
      const docNum = fields[4];
      const date = parseSpedDate(fields[5]);
      const value = parseBrazilianNumber(fields[7]);

      const invoice: SpedInvoice = {
        id: Math.random().toString(36).substring(2, 11),
        type: 'saida',
        date,
        description: `SAT CF-e ${docNum}`,
        value: value,
        documentNumber: docNum,
        participantName: 'Consumidor Final',
        pis: parseBrazilianNumber(fields[15]),
        cofins: parseBrazilianNumber(fields[16]),
        icms: parseBrazilianNumber(fields[9]),
        source: 'ICMS',
      };
      invoices.push(invoice);
      lastInvoice = invoice;
    }

    // 7. Demais Operações (F100) - Outras operações (aluguel, serviços avulsos, etc.)
    // |F100|IND_OPER|COD_PART|COD_MOD|DT_DOC|VL_DOC|CST_PIS|VL_BC_PIS|ALIQ_PIS|VL_PIS|CST_COF|VL_BC_COF|ALIQ_COF|VL_COF|...|COD_INF|...
    //    1       2        3       4      5      6      7       8         9      10     11      12        13      14  ...   20
    // COD_INF (field 20) = código do serviço LC 116 (equivalente CFOP para serviços)
    else if (block === 'F100') {
      const indOper = fields[2];
      const type = indOper === '0' ? 'entrada' : 'saida';
      const date = parseSpedDate(fields[5]);
      const value = parseBrazilianNumber(fields[6]);
      const participantId = fields[3];

      const invoice: SpedInvoice = {
        id: Math.random().toString(36).substring(2, 11),
        type,
        date,
        description: `Operação F100`,
        value: type === 'entrada' ? -value : value,
        documentNumber: '---',
        participantName: participants[participantId] || participantId || 'Outros',
        pis: parseBrazilianNumber(fields[10]),
        cofins: parseBrazilianNumber(fields[14]),
        icms: 0,
        source: 'CONTRIBUICOES',
      };
      invoices.push(invoice);
      lastInvoice = invoice;
    }

    // --- Extração de CFOP / Código de Serviço dos registros filho ---
    // C190: Consolidação por CST/CFOP — field[3] = CFOP
    if (block === 'C190' && lastInvoice) {
      const cfop = fields[3];
      if (cfop) addCfopToInvoice(lastInvoice, cfop);
    }
    // C170: Itens da NF-e — field[11] = CFOP (layout padrão Guia Prático)
    if (block === 'C170' && lastInvoice) {
      const cfop = fields[11] || fields[10] || fields[12];
      if (cfop) addCfopToInvoice(lastInvoice, cfop);
    }
    // A170: Itens da NFS-e — NÃO possui CFOP no layout EFD-Contribuições.
    // Os campos numéricos do A170 são CST/alíquotas de PIS/COFINS, não CFOP.
    // Não extrair CFOP do A170 para evitar códigos espúrios (ex: "01").
    // |A170|NUM_ITEM|CF|DET_EST|VL_ITEM|VL_DESC|NAT_BC_CRED|IND_ORIG_CRED|CST_PIS|VL_BC_PIS|ALIQ_PIS|VL_PIS|CST_COFINS|VL_BC_COFINS|ALIQ_COFINS|VL_COFINS|...|
    //    1       2     3    4       5        6         7            8          9       10        11       12       13          14           15         16
    if (block === 'A170' && lastInvoice) {
      lastInvoice.cstPis = fields[9] || undefined;
      lastInvoice.aliqPis = parseBrazilianNumber(fields[11]);
      lastInvoice.cstCofins = fields[13] || undefined;
      lastInvoice.aliqCofins = parseBrazilianNumber(fields[15]);
    }
    // F100: field[20] = COD_INF (código do serviço LC 116, equivalente a CFOP para serviços)
    if (block === 'F100' && lastInvoice) {
      const codServ = fields[20] || fields[17];
      if (codServ) addCfopToInvoice(lastInvoice, codServ);
    }
    // D190: Consolidação CT-e — field[3] = CFOP
    if (block === 'D190' && lastInvoice) {
      const cfop = fields[3];
      if (cfop) addCfopToInvoice(lastInvoice, cfop);
    }
    // C490: Consolidação ECF — field[2] = CFOP
    if (block === 'C490' && lastInvoice) {
      const cfop = fields[2];
      if (cfop) addCfopToInvoice(lastInvoice, cfop);
      lastInvoice.icms += parseBrazilianNumber(fields[7]);
    }
    // C850: Consolidação SAT — field[2] = CFOP
    if (block === 'C850' && lastInvoice) {
      const cfop = fields[2];
      if (cfop) addCfopToInvoice(lastInvoice, cfop);
    }

    // --- Bloco M: Apuração de PIS e COFINS do mês ---
    // M200 layout real (14 campos após o registro):
    // |M200|f2|f3|f4|f5|f6|f7|f8|f9(VL_TOT_09)|f10|f11|f12(VL_TOT_12)|f13|
    // fields[9] = VL_TOT_CONT_09 = Total PIS sobre operações tributáveis no mês
    // fields[12] = VL_TOT_CONT_12 = Total PIS a recolher
    if (block === 'M200') {
      totalPisMes = parseBrazilianNumber(fields[12]) || parseBrazilianNumber(fields[9]);
    }
    // M600 layout real:
    // fields[9] = VL_TOT_CONT_09 = Total COFINS sobre operações tributáveis no mês
    // fields[12] = VL_TOT_CONT_12 = Total COFINS a recolher
    if (block === 'M600') {
      totalCofinsMes = parseBrazilianNumber(fields[12]) || parseBrazilianNumber(fields[9]);
    }
  }

  return { invoices, accounts, companyName, periodoInicio, periodoFim, totalPisMes, totalCofinsMes };
}
