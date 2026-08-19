/**
 * Parser do relatório "RELAÇÃO GERAL DOS LÍQUIDOS" (folha de pagamento, Domínio).
 *
 * O relatório traz UMA COMPETÊNCIA POR PÁGINA (o mesmo PDF costuma ter várias:
 * 01/2026, 02/2026, …). Cada página tem o cabeçalho `Competência: MM/AAAA` e a
 * tabela `Código | Nome do empregado | Identidade | Valor`.
 *
 * O parsing aqui é PURO (recebe as linhas já extraídas do PDF) para poder ser
 * testado sem pdf.js/navegador. A extração do PDF fica em
 * `extractFolhaLiquidosDoPdf`, que carrega o pdf.js por import dinâmico.
 */

export type FolhaLiquidoItem = {
  /** Código do empregado no sistema de folha (coluna "Código"). */
  codigo: string;
  /** Nome como impresso no relatório. */
  nome: string;
  /** Coluna "Identidade" — RG, CPF/PIS ou outro documento (só o texto impresso). */
  identidade: string;
  /** Só os dígitos da identidade (para casar documento no histórico do extrato). */
  identidadeDigitos: string;
  /** Líquido a pagar da competência. */
  valor: number;
  /** Seção do relatório: Empregados, Estagiários, Contribuintes… */
  categoria: string;
};

export type FolhaLiquidoCompetencia = {
  /** MM/AAAA */
  competencia: string;
  itens: FolhaLiquidoItem[];
  /** "Total da Empresa" impresso na página, quando presente. */
  total: number | null;
};

export type ParsedFolhaLiquidos = {
  fileName: string;
  empresa: string;
  cnpj: string;
  competencias: FolhaLiquidoCompetencia[];
  issues: string[];
};

const RE_COMPETENCIA = /(\d{2})\/(\d{4})/;
const RE_VALOR_BR = /^-?\d{1,3}(?:\.\d{3})*,\d{2}$|^-?\d+,\d{2}$/;
/** "17 CAROLLINE TAVEIRA DOS SANTOS" → código + nome (o pdf.js junta as duas colunas). */
const RE_CODIGO_NOME = /^(\d{1,5})\s+(\S.*)$/;

const CATEGORIAS = [
  'EMPREGADOS',
  'ESTAGIARIOS',
  'CONTRIBUINTES',
  'AUTONOMOS',
  'DIRETORES',
  'PRO LABORE',
  'PROLABORE',
];

function normalizeLabel(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseValorBr(val: string): number | null {
  const s = String(val ?? '').trim();
  if (!RE_VALOR_BR.test(s)) return null;
  const n = Number.parseFloat(s.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Reconhece o relatório antes de tentar interpretar as linhas. */
export function isFolhaLiquidosText(fullText: string): boolean {
  const t = normalizeLabel(fullText);
  return t.includes('RELACAO GERAL DOS LIQUIDOS');
}

/** Só a categoria (linha isolada "Empregados"), sem confundir com o total "Empregados: 15". */
function matchCategoria(cell: string): string | null {
  const norm = normalizeLabel(cell);
  if (!norm || norm.includes(':')) return null;
  return CATEGORIAS.includes(norm) ? norm : null;
}

/**
 * Linha de dados da tabela. Precisa de: célula "código + nome", uma célula de
 * valor no fim e (opcionalmente) a identidade no meio.
 */
function parseLinhaItem(cells: string[], categoria: string): FolhaLiquidoItem | null {
  const uteis = cells.map((c) => String(c ?? '').trim()).filter(Boolean);
  if (uteis.length < 2) return null;

  const valor = parseValorBr(uteis[uteis.length - 1]);
  if (valor === null) return null;

  const head = uteis[0];
  // Totais/rodapé ("Empregados: 15", "Total da Empresa:") nunca são item.
  if (head.includes(':')) return null;

  const m = RE_CODIGO_NOME.exec(head);
  if (!m) return null;
  const codigo = m[1];
  const nome = m[2].replace(/\s+/g, ' ').trim();
  // Nome precisa ter letras — evita capturar linha só de números.
  if (!/[A-Za-zÀ-ÿ]{2}/.test(nome)) return null;

  const identidade = uteis.length >= 3 ? uteis.slice(1, -1).join(' ').trim() : '';
  return {
    codigo,
    nome,
    identidade,
    identidadeDigitos: identidade.replace(/\D/g, ''),
    valor,
    categoria: categoria || 'EMPREGADOS',
  };
}

export function parseFolhaLiquidosRows(rows: string[][], fileName: string): ParsedFolhaLiquidos {
  const issues: string[] = [];
  const fullText = rows.map((r) => r.join(' ')).join('\n');

  if (!isFolhaLiquidosText(fullText)) {
    return {
      fileName,
      empresa: '',
      cnpj: '',
      competencias: [],
      issues: ['Arquivo não reconhecido como "Relação Geral dos Líquidos" (relatório de folha).'],
    };
  }

  let empresa = '';
  let cnpj = '';
  let competenciaAtual = '';
  let categoriaAtual = '';
  // Uma competência pode se repetir em mais de uma página (tabela longa) — acumula.
  const porCompetencia = new Map<string, FolhaLiquidoCompetencia>();

  for (const row of rows) {
    const cells = row.map((c) => String(c ?? '').trim());
    const uteis = cells.filter(Boolean);
    if (uteis.length === 0) continue;
    const head = normalizeLabel(uteis[0]);

    if (head.startsWith('EMPRESA:') || head === 'EMPRESA:') {
      if (!empresa && uteis[1]) empresa = uteis[1];
      continue;
    }
    if (head === 'CNPJ:') {
      if (!cnpj && uteis[1]) cnpj = uteis[1].replace(/\s+/g, '');
      continue;
    }
    if (head === 'COMPETENCIA:' || head.startsWith('COMPETENCIA')) {
      const alvo = uteis.slice(1).join(' ') || uteis[0];
      const m = RE_COMPETENCIA.exec(alvo);
      if (m) {
        competenciaAtual = `${m[1]}/${m[2]}`;
        categoriaAtual = '';
        if (!porCompetencia.has(competenciaAtual)) {
          porCompetencia.set(competenciaAtual, {
            competencia: competenciaAtual,
            itens: [],
            total: null,
          });
        }
      }
      continue;
    }

    // "Total da Empresa: 24.209,40" — fecha a página.
    if (uteis.some((c) => normalizeLabel(c).startsWith('TOTAL DA EMPRESA'))) {
      const alvo = porCompetencia.get(competenciaAtual);
      const valor = parseValorBr(uteis[uteis.length - 1]);
      if (alvo && valor !== null) alvo.total = (alvo.total ?? 0) + valor;
      continue;
    }

    const cat = uteis.length === 1 ? matchCategoria(uteis[0]) : null;
    if (cat) {
      categoriaAtual = cat;
      continue;
    }

    if (!competenciaAtual) continue;
    const item = parseLinhaItem(cells, categoriaAtual);
    if (!item) continue;
    porCompetencia.get(competenciaAtual)?.itens.push(item);
  }

  const competencias = [...porCompetencia.values()]
    .filter((c) => c.itens.length > 0)
    .sort((a, b) => competenciaOrdem(a.competencia) - competenciaOrdem(b.competencia));

  if (competencias.length === 0) {
    issues.push('Nenhum lançamento de líquido foi encontrado no PDF.');
  }

  for (const comp of competencias) {
    if (comp.total === null) continue;
    const soma = comp.itens.reduce((s, i) => s + i.valor, 0);
    if (Math.abs(soma - comp.total) > 0.05) {
      issues.push(
        `Competência ${comp.competencia}: soma dos líquidos (${soma.toFixed(2)}) difere do total impresso (${comp.total.toFixed(2)}).`,
      );
    }
  }

  return { fileName, empresa, cnpj, competencias, issues };
}

/** MM/AAAA → número ordenável (AAAAMM). */
export function competenciaOrdem(competencia: string): number {
  const m = RE_COMPETENCIA.exec(String(competencia ?? ''));
  if (!m) return 0;
  return Number(m[2]) * 100 + Number(m[1]);
}

/** Lê o PDF no navegador e devolve o relatório interpretado. */
export async function extractFolhaLiquidosDoPdf(file: File): Promise<ParsedFolhaLiquidos> {
  const { pdfFileToRows } = await import('../../lib/pdfClientExtract');
  const { rows } = await pdfFileToRows(file, 52000);
  return parseFolhaLiquidosRows(rows, file.name);
}
