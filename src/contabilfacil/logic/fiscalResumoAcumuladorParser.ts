/**
 * Parser do relatório "Resumo por Acumulador" do Sistema Domínio (Contábil → Plano de
 * Contas → "Empresa NNN - Nome.pdf"). Traz, por acumulador, o total de Entradas, Saídas e
 * Serviços do período — usado como referência oficial para conferir com os totais que o
 * sistema já calculou a partir das notas importadas (aba Fiscal → Acumuladores).
 *
 * Layout (texto extraído do PDF, uma linha por acumulador):
 *   ENTRADAS/SAÍDAS: Código Descrição VlrContábil BaseICMS VlrICMS IsentasICMS OutrasICMS VlrIPI BCICMSST VlrICMSST
 *   SERVIÇOS:         Cód    Descrição VlrContábil BaseISS  VlrISS  IsentasISS  OutrasISS  BaseISSR VlrISSR IsentasISSR OutrasISSR
 * (8 colunas monetárias para Entradas/Saídas, 9 para Serviços.) Assim como nos relatórios de
 * Acompanhamento, um marcador de grupo do relatório aparece como um "1" solto colado no
 * início de algumas linhas.
 */

export type ResumoAcumuladorSecao = 'entradas' | 'saidas' | 'servicos';

export interface ResumoAcumuladorLinha {
  secao: ResumoAcumuladorSecao;
  codigo: string;
  descricao: string;
  valorContabil: number;
}

export interface ResumoAcumuladorParseResult {
  cnpj?: string;
  periodoInicio?: string;
  periodoFim?: string;
  linhas: ResumoAcumuladorLinha[];
  errors: string[];
}

const MONEY = /-?\d{1,3}(?:\.\d{3})*,\d{2}/;
const CNPJ_PATTERN = /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/;
const PERIODO_PATTERN = /(\d{2}\/\d{2}\/\d{4})\s*at[ée]\s*(\d{2}\/\d{2}\/\d{4})/i;
const SECAO_PATTERN = /^(ENTRADAS|SA[ÍI]DAS|SERVI[ÇC]OS)\s*$/i;

function parseBrValue(s: string): number {
  const cleaned = s.trim().replace(/\./g, '').replace(',', '.');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function normalizeSecao(token: string): ResumoAcumuladorSecao {
  const up = token.toUpperCase();
  if (up.startsWith('ENTRADA')) return 'entradas';
  if (up.startsWith('SA')) return 'saidas';
  return 'servicos';
}

function isSkippableLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^total:?/i.test(t)) return true;
  if (/Sistema licenciado/i.test(t)) return true;
  if (
    /^(P[áa]gina|CNPJ:|Insc\.?\s*Est|Per[íi]odo:|Emiss[ãa]o:|Hora:|RESUMO POR ACUMULADOR|C[óo]d(igo)?\s+Descri[çc][ãa]o)/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

function parseLinha(tokens: string[], secao: ResumoAcumuladorSecao): ResumoAcumuladorLinha | null {
  if (tokens.length < 3) return null;
  if (!/^\d+$/.test(tokens[0] ?? '')) return null;
  const codigo = tokens[0]!;

  const numColunas = secao === 'servicos' ? 9 : 8;
  const moneyIdx: number[] = [];
  for (let j = tokens.length - 1; j >= 1 && moneyIdx.length < numColunas; j--) {
    if (MONEY.test(tokens[j] ?? '')) moneyIdx.unshift(j);
  }
  if (moneyIdx.length < numColunas) return null;

  const descEnd = moneyIdx[0]!;
  let descricao = tokens.slice(1, descEnd).join(' ').trim();
  // O relatório às vezes lista os CFOPs vinculados ao acumulador colados no fim da descrição
  // (ex.: "AQUISIÇÃO DE SERVIÇO A VISTA 1933 2933") — remove esses códigos soltos.
  descricao = descricao.replace(/(\s+\d{3,6})+$/, '').trim();
  if (!descricao) return null;

  const valorContabil = parseBrValue(tokens[descEnd]!);

  return { secao, codigo, descricao, valorContabil };
}

/**
 * O marcador de grupo do relatório é um "1" solto que às vezes gruda no início da linha
 * seguinte. Um código de acumulador nunca é seguido por outro número puro (o próximo token
 * sempre é o começo da descrição, que é texto) — então, se o 2º token também for só dígitos,
 * o "1" é o marcador: tenta primeiro ignorando-o.
 */
function parseLinhaComRetry(line: string, secao: ResumoAcumuladorSecao): ResumoAcumuladorLinha | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] === '1' && tokens.length > 1 && /^\d+$/.test(tokens[1] ?? '')) {
    const semMarcador = parseLinha(tokens.slice(1), secao);
    if (semMarcador) return semMarcador;
  }
  return parseLinha(tokens, secao);
}

export function parseResumoAcumuladorPdfText(text: string): ResumoAcumuladorParseResult {
  const result: ResumoAcumuladorParseResult = { linhas: [], errors: [] };

  const cnpjMatch = CNPJ_PATTERN.exec(text);
  if (cnpjMatch) result.cnpj = cnpjMatch[1];

  const periodoMatch = PERIODO_PATTERN.exec(text);
  if (periodoMatch) {
    result.periodoInicio = periodoMatch[1];
    result.periodoFim = periodoMatch[2];
  }

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  let secaoAtual: ResumoAcumuladorSecao | null = null;

  for (const line of lines) {
    const secaoMatch = SECAO_PATTERN.exec(line);
    if (secaoMatch) {
      secaoAtual = normalizeSecao(secaoMatch[1]!);
      continue;
    }
    if (isSkippableLine(line) || !secaoAtual) continue;
    const linha = parseLinhaComRetry(line, secaoAtual);
    if (linha) result.linhas.push(linha);
  }

  if (result.linhas.length === 0) {
    result.errors.push('Nenhum acumulador reconhecido no PDF.');
  }

  return result;
}
