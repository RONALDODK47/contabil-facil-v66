/**
 * Parser do relatório "Resumo dos Impostos Lançados/Calculados" do Domínio (PDF com texto).
 * Extrai, por competência (MM/AAAA), o valor de "Imposto a Recolher" de cada tributo —
 * funciona tanto na seção "LANÇADOS" (ISS, IBS, CBS, Diferencial de Alíquota) quanto na
 * seção "CALCULADOS" (PIS, COFINS, CSLL, IRPJ), já que as duas têm a mesma característica:
 * a coluna "Imposto a Recolher" é sempre a 3ª de trás para frente na linha do tributo,
 * independente de quantas colunas a linha tiver (o relatório varia largura conforme o tributo).
 */
// Import dinâmico (não no topo): pdfClientExtract carrega pdfjs-dist, que exige um DOM de
// navegador real (Canvas/DOMMatrix) — carregar isso estaticamente quebraria qualquer teste
// ou uso deste módulo fora do browser, mesmo só chamando a função pura de parsing de linhas.

export type DominioResumoImpostoMes = {
  /** MM/AAAA */
  competencia: string;
  /** Nome do tributo tal como aparece no relatório (ISS, PIS, COFINS, CSLL, IRPJ, IBS, CBS, DIFAL). */
  imposto: string;
  /** Imposto a recolher da competência. */
  valor: number;
};

export type ParsedDominioResumoImpostos = {
  fileName: string;
  cnpj: string;
  empresa: string;
  itens: DominioResumoImpostoMes[];
  issues: string[];
};

const IMPOSTO_LABELS = ['ISS', 'PIS', 'COFINS', 'CSLL', 'IRPJ', 'IBS', 'CBS', 'DIFAL'] as const;

function normalizeLabel(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

/** "Diferencial de Alíquota" → DIFAL (só essa label tem nome diferente do próprio tributo). */
function matchImpostoLabel(cell: string): string | null {
  const norm = normalizeLabel(cell);
  if (!norm) return null;
  if (norm.includes('DIFERENCIALDEALIQUOTA') || norm === 'DIFAL') return 'DIFAL';
  for (const label of IMPOSTO_LABELS) {
    if (norm === label) return label;
  }
  return null;
}

function parseMoedaBr(val: string): number | null {
  const s = val.trim();
  if (!s) return null;
  const clean = s.replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
  if (!clean || clean === '-') return null;
  const n = Number.parseFloat(clean);
  return Number.isFinite(n) ? n : null;
}

export function isDominioResumoImpostosText(fullText: string): boolean {
  const sample = fullText.toUpperCase();
  return sample.includes('RESUMO DOS IMPOSTOS LAN') || sample.includes('RESUMO DOS IMPOSTOS CALCUL');
}

/** Parsing puro a partir das linhas já extraídas do PDF — testável sem pdf.js/navegador. */
export function parseDominioResumoImpostosRows(
  rows: string[][],
  fileName: string,
): ParsedDominioResumoImpostos {
  const issues: string[] = [];
  const fullText = rows.map((r) => r.join(' ')).join('\n');

  if (!isDominioResumoImpostosText(fullText)) {
    return {
      fileName,
      cnpj: '',
      empresa: '',
      itens: [],
      issues: ['Arquivo não reconhecido como "Resumo dos Impostos" do Domínio.'],
    };
  }

  let cnpj = '';
  let empresa = '';
  let competenciaAtual = '';
  const itens: DominioResumoImpostoMes[] = [];

  for (const row of rows) {
    const joined = row.join(' ');

    if (!cnpj) {
      const cnpjMatch = joined.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
      if (cnpjMatch) cnpj = cnpjMatch[1].replace(/\D/g, '');
    }
    if (!empresa && /LTDA|LTD|EIRELI|S\/A|SA\b|ME\b/.test(joined) && row.length <= 3) {
      empresa = row[0]?.trim() || '';
    }

    const compMatch = joined.match(/Compet[eê]ncia:?\s*(\d{2}\/\d{4})/i);
    if (compMatch) {
      competenciaAtual = compMatch[1];
      continue;
    }

    if (!competenciaAtual) continue;
    const label = matchImpostoLabel(row[0] ?? '');
    if (!label) continue;

    const numeros = row
      .slice(1)
      .map(parseMoedaBr)
      .filter((n): n is number => n !== null);
    if (numeros.length < 3) continue;

    // "Imposto a Recolher" é sempre a 3ª coluna de trás pra frente (...| Imposto a recolher | Imposto diferido | Saldo credor).
    const valor = numeros[numeros.length - 3];
    if (valor == null || Math.abs(valor) < 0.005) continue;

    itens.push({ competencia: competenciaAtual, imposto: label, valor });
  }

  if (itens.length === 0) {
    issues.push('Nenhum valor de imposto a recolher encontrado no relatório.');
  }

  return { fileName, cnpj, empresa, itens, issues };
}

export async function parseDominioResumoImpostosFile(file: File): Promise<ParsedDominioResumoImpostos> {
  const { pdfFileToRows } = await import('../../lib/pdfClientExtract');
  const { rows } = await pdfFileToRows(file, 20_000);
  return parseDominioResumoImpostosRows(rows, file.name);
}

/** Converte MM/AAAA em data ISO (yyyy-mm) para casar com o mês das notas fiscais já importadas. */
export function competenciaToYearMonth(competencia: string): string {
  const m = competencia.match(/(\d{2})\/(\d{4})/);
  if (!m) return '';
  return `${m[2]}-${m[1]}`;
}
