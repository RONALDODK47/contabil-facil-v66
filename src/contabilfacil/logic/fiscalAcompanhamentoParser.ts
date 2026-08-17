/**
 * Parser dos relatórios "Acompanhamento de Entradas / Saídas / Serviços" do Sistema Domínio
 * (Contábil → Plano de Contas → Entradas.pdf / Saídas.pdf / Serviços.pdf).
 *
 * Layout (texto extraído do PDF, uma linha por lançamento):
 *   Entradas:  Código Data Nota Série Espécie CódigoFornecedor Fornecedor CFOP Acumulador UF ValorContábil [Tipo] BaseCálculo Aliq. Valor Isentas Outras
 *   Saídas:    Código Data Nota Série Espécie CódigoCliente    Cliente    CFOP Acumulador UF ValorContábil [Tipo] BaseCálculo Aliq. Valor Isentas Outras
 *   Serviços:  Código Data Nota Série Espécie CódigoCliente    Cliente         Acumulador UF ValorContábil [Tipo] BaseCálculo Aliq. Valor Isentas Outras
 * (Serviços não tem coluna CFOP.) Série/Espécie ficam em branco (sem token) em vários
 * lançamentos — por isso os campos entre Data e o nome do participante são consumidos como
 * um bloco de tokens numéricos, e não por posição fixa.
 */

import type { SpedInvoice } from '../components/fiscal/types';

export type AcompanhamentoKind = 'entrada' | 'saida' | 'servico';

export interface AcompanhamentoRow {
  data: string; // DD/MM/YYYY
  nota: string;
  codigoParticipante: string;
  participante: string;
  cfop?: string;
  acumulador: string;
  uf: string;
  valorContabil: number;
  tipo?: string; // ex.: "ISS"
  baseCalculo: number;
  aliquota: number;
  valor: number; // valor do imposto (ex.: ISS)
  isentas: number;
  outras: number;
}

export interface AcompanhamentoParseResult {
  kind: AcompanhamentoKind;
  empresa?: string;
  cnpj?: string;
  periodoInicio?: string;
  periodoFim?: string;
  rows: AcompanhamentoRow[];
  errors: string[];
}

const EMPRESA_PATTERN = /^([A-ZÀ-Ú][A-ZÀ-Ú0-9 .,&/-]{4,})$/;
const CNPJ_PATTERN = /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/;
const PERIODO_PATTERN = /(\d{2}\/\d{2}\/\d{4})\s*at[ée]\s*(\d{2}\/\d{2}\/\d{4})/i;
const MONEY = /-?\d{1,3}(?:\.\d{3})*,\d{2}/;
const DATE_TOKEN = /^\d{2}\/\d{2}\/\d{4}$/;
const UF_LIST = new Set([
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
  'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
]);

function parseBrValue(s: string): number {
  const cleaned = s.trim().replace(/\./g, '').replace(',', '.');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Ignora cabeçalhos, linhas de subtotal ("Total Fornecedor"/"Total Cliente"/"Total Geral") e rodapé. */
function isSkippableLine(line: string): boolean {
  if (!line.trim()) return true;
  if (/total\s*(fornecedor|cliente|geral)?/i.test(line) && !DATE_TOKEN.test(line.split(/\s+/)[0] ?? '')) return true;
  if (/^Total/i.test(line.trim())) return true;
  if (/Sistema licenciado/i.test(line)) return true;
  if (/^(P[áa]gina|C[oó]digo\s+Data|CNPJ:|Insc\s*Est|Per[íi]odo:|Emiss[ãa]o:|Hora:|ACOMPANHAMENTO)/i.test(line.trim())) return true;
  return false;
}

/**
 * Faz o parse de uma linha de lançamento. Retorna null se a linha não tiver o formato
 * esperado (ex.: linha de subtotal só com números, sem data) — o chamador ignora essas.
 *
 * O relatório tem um marcador de grupo (ícone de linha) que aparece como um "1" solto —
 * às vezes numa linha própria, às vezes colado no início da linha seguinte, dependendo de
 * quão perto ele cai verticalmente do próximo lançamento na extração por posição X/Y. Se a
 * linha não bater com "1" na frente, tenta de novo ignorando esse primeiro token.
 */
function parseRow(line: string, kind: AcompanhamentoKind): AcompanhamentoRow | null {
  const tokens = line.trim().split(/\s+/);
  const direct = parseRowTokens(tokens, kind);
  if (direct) return direct;
  if (tokens[0] === '1' && tokens.length > 1) {
    return parseRowTokens(tokens.slice(1), kind);
  }
  return null;
}

function parseRowTokens(tokens: string[], kind: AcompanhamentoKind): AcompanhamentoRow | null {
  if (tokens.length < 6) return null;

  // 1) Código (primeiro token numérico) + Data (token seguinte no formato DD/MM/AAAA).
  let i = 0;
  if (!/^\d+$/.test(tokens[0] ?? '')) return null;
  i = 1;
  if (!DATE_TOKEN.test(tokens[i] ?? '')) return null;
  const data = tokens[i]!;
  i++;

  // 2) Bloco de campos numéricos (Nota, [Série], [Espécie], CódigoParticipante) até o
  // primeiro token que não for puramente numérico — esse é o início do nome do participante.
  const numericBlock: string[] = [];
  while (i < tokens.length && /^\d+$/.test(tokens[i] ?? '')) {
    numericBlock.push(tokens[i]!);
    i++;
  }
  if (numericBlock.length < 2) return null; // precisa de ao menos Nota + CódigoParticipante
  const nota = numericBlock[0]!;
  const codigoParticipante = numericBlock[numericBlock.length - 1]!;

  const nameStart = i;

  // 3) Bloco final de valores monetários (ValorContábil [Tipo] BaseCálculo Aliq. Valor Isentas Outras).
  const tail = tokens.slice(nameStart);
  // Localiza, da direita para a esquerda, os últimos 6 números monetários (podendo ter "ISS" entre o 1º e o 2º).
  const moneyIdx: number[] = [];
  for (let j = tail.length - 1; j >= 0 && moneyIdx.length < 6; j--) {
    if (MONEY.test(tail[j] ?? '')) moneyIdx.unshift(j);
  }
  if (moneyIdx.length < 6) return null;
  const [vIdxContabil, vIdxBase, vIdxAliq, vIdxValor, vIdxIsentas, vIdxOutras] = moneyIdx as [
    number, number, number, number, number, number,
  ];
  const tipoToken = tail[vIdxContabil + 1];
  const tipo = tipoToken && vIdxBase === vIdxContabil + 2 ? tipoToken : undefined;

  const valorContabil = parseBrValue(tail[vIdxContabil]!);
  const baseCalculo = parseBrValue(tail[vIdxBase]!);
  const aliquota = parseBrValue(tail[vIdxAliq]!);
  const valor = parseBrValue(tail[vIdxValor]!);
  const isentas = parseBrValue(tail[vIdxIsentas]!);
  const outras = parseBrValue(tail[vIdxOutras]!);

  // 4) Entre o nome e o valor contábil: UF, Acumulador e (entrada/saída) CFOP.
  const beforeMoney = tail.slice(0, vIdxContabil);
  if (beforeMoney.length < 2) return null;
  const uf = beforeMoney[beforeMoney.length - 1]!;
  if (!UF_LIST.has(uf)) return null;
  const acumulador = beforeMoney[beforeMoney.length - 2]!;
  let cfop: string | undefined;
  let nameEnd = beforeMoney.length - 2;
  if (kind !== 'servico') {
    const cfopToken = beforeMoney[beforeMoney.length - 3];
    if (cfopToken && /^\d-\d{3}$/.test(cfopToken)) {
      cfop = cfopToken;
      nameEnd = beforeMoney.length - 3;
    }
  }

  let participante = beforeMoney.slice(0, nameEnd).join(' ').trim();

  // A extração de texto do PDF às vezes cola o CFOP direto no fim do nome, sem espaço
  // (ex.: "ADMINISTRATIVOS1-933"), quando a coluna do nome estoura a largura da célula.
  if (!cfop && kind !== 'servico') {
    const glued = /^(.*\S)(\d-\d{3})$/.exec(participante);
    if (glued) {
      participante = glued[1]!.trim();
      cfop = glued[2];
    }
  }

  if (!participante) return null;

  return {
    data,
    nota,
    codigoParticipante,
    participante,
    cfop,
    acumulador,
    uf,
    valorContabil,
    tipo,
    baseCalculo,
    aliquota,
    valor,
    isentas,
    outras,
  };
}

function toIsoDate(brDate: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(brDate);
  if (!m) return '';
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Converte as linhas parseadas em SpedInvoice — mesmo formato usado pelo import de TXT SPED. */
export function acompanhamentoRowsToInvoices(result: AcompanhamentoParseResult): SpedInvoice[] {
  const type: SpedInvoice['type'] = result.kind === 'entrada' ? 'entrada' : 'saida';
  return result.rows.map((row) => {
    const iss = row.tipo === 'ISS' ? row.valor : 0;
    return {
      id: Math.random().toString(36).substring(2, 11),
      type,
      date: toIsoDate(row.data),
      description:
        result.kind === 'servico'
          ? `Serviço prestado ${row.nota}`
          : result.kind === 'entrada'
            ? `NF Entrada ${row.nota}`
            : `NF Saída ${row.nota}`,
      value: type === 'entrada' ? -row.valorContabil : row.valorContabil,
      // O relatório mostra o CFOP como "2-933" (dígito-hífen-3dígitos); a tabela de Notas
      // Fiscais só aceita código puro (ex.: "2933"), senão sanitizeCfop() descarta e mostra "---".
      cfop: row.cfop?.replace('-', ''),
      documentNumber: row.nota,
      participantName: row.participante,
      pis: 0,
      cofins: 0,
      icms: 0,
      iss,
      accountCode: row.acumulador,
      source: 'CONTRIBUICOES',
    };
  });
}

export function parseAcompanhamentoPdfText(text: string, kind: AcompanhamentoKind): AcompanhamentoParseResult {
  const result: AcompanhamentoParseResult = { kind, rows: [], errors: [] };

  const cnpjMatch = CNPJ_PATTERN.exec(text);
  if (cnpjMatch) result.cnpj = cnpjMatch[1];

  const periodoMatch = PERIODO_PATTERN.exec(text);
  if (periodoMatch) {
    result.periodoInicio = periodoMatch[1];
    result.periodoFim = periodoMatch[2];
  }

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (!result.empresa && EMPRESA_PATTERN.test(line) && !/^\d/.test(line)) {
      // Primeira linha "tudo maiúsculo" do cabeçalho tende a ser a razão social.
      if (!/ACOMPANHAMENTO|C[OÓ]DIGO|SISTEMA LICENCIADO/i.test(line)) {
        result.empresa = line;
      }
    }
    if (isSkippableLine(line)) continue;
    const row = parseRow(line, kind);
    if (row) result.rows.push(row);
  }

  if (result.rows.length === 0) {
    result.errors.push(
      `Nenhum lançamento reconhecido no PDF de ${kind === 'entrada' ? 'Entradas' : kind === 'saida' ? 'Saídas' : 'Serviços'}.`,
    );
  }

  return result;
}
