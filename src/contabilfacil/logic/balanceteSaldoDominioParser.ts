/**
 * Parser de PDF Balancete do Sistema Domínio.
 *
 * Layout visual do PDF (colunas da esquerda para direita):
 *   Código | Classificação | Descrição | Saldo Anterior | Débito | Crédito | Saldo Atual
 */
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import type { VisionPlanoRow, VisionBalanceteRow } from '../../extratoVision/types/accounting';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/* ────────────────────────── Types ────────────────────────── */

export interface BalanceteSaldoDominioResult {
  planoRows: VisionPlanoRow[];
  balanceteRows: VisionBalanceteRow[];
  periodoDetectado?: string;
  empresaDetectada?: string;
  logs: string[];
}

/* ────────────────────────── Helpers ────────────────────────── */

type RawItem = { str: string; x: number; y: number; w: number; h: number };

function parseBrCurrency(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/\s/g, '').replace(/[DC]/gi, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function clusterLines(items: RawItem[], yTol = 4): RawItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: RawItem[][] = [];
  for (const it of sorted) {
    let placed = false;
    for (const line of lines) {
      if (Math.abs(line[0].y - it.y) <= yTol) {
        line.push(it);
        placed = true;
        break;
      }
    }
    if (!placed) lines.push([it]);
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x);
  lines.sort((a, b) => b[0].y - a[0].y);
  return lines;
}

function isMetadataLine(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^C[oó]digo/i.test(t) && /Descri[çc][aã]o|Classifica[çc][aã]o/i.test(t)) return true;
  if (/^BALANCETE/i.test(t)) return true;
  if (/^CONSOLIDADO/i.test(t)) return true;
  if (/^Per[ií]odo:/i.test(t)) return true;
  if (/^Empresa:/i.test(t)) return true;
  if (/^C\.?N\.?P\.?J/i.test(t)) return true;
  if (/^Folha:/i.test(t)) return true;
  if (/^N[uú]mero livro/i.test(t)) return true;
  if (/^Sistema licenciado/i.test(t)) return true;
  if (/^_{3,}/.test(t)) return true;
  if (/CRC|Reg\.\s*no/i.test(t)) return true;
  if (/^CPF:/i.test(t)) return true;
  if (/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(t)) return true;
  if (/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(t)) return true;
  if (/^[A-Z].*LTDA$/i.test(t) && !/^\d+\s/.test(t)) return true;
  if (/^ADMINISTRADOR$/i.test(t)) return true;
  if (/^Saldo\s/i.test(t) && /Anterior|Atual/i.test(t)) return true;
  if (/^D[eé]bito$/i.test(t)) return true;
  if (/^Cr[eé]dito$/i.test(t)) return true;
  return false;
}

function inferTipo(classificacao: string): 'S' | 'A' {
  const parts = classificacao.split('.').filter(Boolean);
  if (parts.length <= 4) return 'S';
  return 'A';
}

function classToNivel(classificacao: string): number {
  return classificacao.split('.').filter(Boolean).length;
}

/* ────────────────────────── Token-based parsing ────────────────────────── */

interface ParsedConta {
  codigo: string;
  classificacao: string;
  descricao: string;
  saldoAtual: number;
  saldoAnterior: number;
  debito: number;
  credito: number;
  naturezaSaldoAtual: 'D' | 'C';
  naturezaSaldoAnterior: 'D' | 'C';
}

const RE_CURRENCY = /^\d{1,3}(?:\.\d{3})*,\d{2}$/;
const RE_DC = /^[DC]$/i;
const RE_CLASSIFICACAO = /^\d+(\.\d+)*$/;
const RE_CODIGO = /^\d{1,5}$/;

/**
 * Abordagem robusta: tokeniza a linha e identifica os 4 valores monetários
 * da DIREITA para a ESQUERDA. Isso evita problemas com o pdfjs separando
 * o D/C do número ou ghost labels grudados na descrição.
 *
 * Tokens esperados (da esquerda p/ direita):
 *   [ghost...] CODIGO CLASSIFICACAO DESCRICAO... SA [D/C] DEB CRED SF [D/C]
 */
function parseDataLineTokens(line: string): ParsedConta | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < 6) return null;

  // Scan da direita para a esquerda, coletando valores monetários + D/C
  interface CurrVal { valor: number; natureza: 'D' | 'C'; endIdx: number; startIdx: number }
  const currencyValues: CurrVal[] = [];

  let i = tokens.length - 1;
  while (i >= 0 && currencyValues.length < 4) {
    const tok = tokens[i];

    // Caso 1: token é "D" ou "C" sozinho — o valor está no token anterior
    if (RE_DC.test(tok) && i > 0 && RE_CURRENCY.test(tokens[i - 1])) {
      currencyValues.unshift({
        valor: parseBrCurrency(tokens[i - 1]),
        natureza: tok.toUpperCase() as 'D' | 'C',
        endIdx: i,
        startIdx: i - 1,
      });
      i -= 2;
      continue;
    }

    // Caso 2: token é valor monetário com D/C colado (ex: "1.768.235,90D")
    if (/^\d{1,3}(?:\.\d{3})*,\d{2}[DC]$/i.test(tok)) {
      const nat = tok.slice(-1).toUpperCase() as 'D' | 'C';
      currencyValues.unshift({
        valor: parseBrCurrency(tok),
        natureza: nat,
        endIdx: i,
        startIdx: i,
      });
      i--;
      continue;
    }

    // Caso 3: token é valor monetário sem D/C (ex: "0,00", "12.661.144,14")
    if (RE_CURRENCY.test(tok)) {
      currencyValues.unshift({
        valor: parseBrCurrency(tok),
        natureza: 'D',
        endIdx: i,
        startIdx: i,
      });
      i--;
      continue;
    }

    // Se não é monetário, para — não há mais valores à esquerda
    break;
  }

  // Precisamos de exatamente 4 valores: SA, Deb, Cred, SF
  if (currencyValues.length !== 4) return null;

  const [sa, deb, cred, sf] = currencyValues;

  // Tudo antes do primeiro valor monetário é: [ghost...] CODIGO CLASSIFICACAO DESCRICAO
  // O pdfjs costuma duplicar o rótulo do grupo antes do código real, ex.:
  //   "ATIVO CIRCULANTE 2 1.1 ATIVO CIRCULANTE <valores>"
  // Precisamos achar o ÚLTIMO par válido (código + classificação) no prefixo, que é
  // onde o conteúdo real da linha começa — tudo antes é ghost text.
  const prefixEnd = sa.startIdx;
  const prefixTokens = tokens.slice(0, prefixEnd);

  if (prefixTokens.length < 2) return null;

  // Varre o prefixo da DIREITA para a ESQUERDA para encontrar o último par
  // CODIGO + CLASSIFICACAO — isso ignora o ghost text que fica antes deles.
  let codigo = '';
  let classificacao = '';
  let descStartIdx = 0;

  // Primeiro: acha o código/classificação mais à DIREITA no prefixo (última ocorrência)
  // para evitar que ghost labels como "ATIVO CIRCULANTE 2 1.1 ATIVO CIRCULANTE" usem
  // o "2" inicial do ghost em vez do "2" real do código.
  let codigoIdx = -1;
  let classificacaoIdx = -1;

  for (let p = prefixTokens.length - 1; p >= 0; p--) {
    const pt = prefixTokens[p];
    // Tenta achar classificação pontuada (ex: "1.1", "1.1.1.02") antes do código
    if (classificacaoIdx < 0 && RE_CLASSIFICACAO.test(pt) && pt.includes('.')) {
      classificacaoIdx = p;
      continue;
    }
    // Se já temos classificação, o código está imediatamente antes dela (ou é igual)
    if (classificacaoIdx >= 0 && RE_CODIGO.test(pt) && p === classificacaoIdx - 1) {
      codigoIdx = p;
      break;
    }
    // Classificação simples (só dígitos, ex: "1" para ATIVO): código e classificação
    // são o mesmo número — procura dois números consecutivos
    if (classificacaoIdx < 0 && codigoIdx < 0 && RE_CODIGO.test(pt)) {
      // Se o token anterior também é número simples, temos "CODIGO CLASSIFICACAO" colados
      if (p > 0 && RE_CODIGO.test(prefixTokens[p - 1]!)) {
        classificacaoIdx = p;
        codigoIdx = p - 1;
        break;
      }
    }
  }

  // Fallback: scan da esquerda (comportamento original) se não achou pela direita
  if (codigoIdx < 0 || classificacaoIdx < 0) {
    for (let p = 0; p < prefixTokens.length; p++) {
      const pt = prefixTokens[p];
      if (!codigo && RE_CODIGO.test(pt)) {
        codigo = pt;
        descStartIdx = p + 1;
        continue;
      }
      if (codigo && !classificacao && RE_CLASSIFICACAO.test(pt)) {
        classificacao = pt;
        descStartIdx = p + 1;
        break;
      }
      if (codigo && !classificacao && RE_CODIGO.test(pt)) {
        classificacao = pt;
        descStartIdx = p + 1;
        break;
      }
    }
    if (!classificacao && prefixTokens.length >= 2 && /^\d/.test(prefixTokens[1]!)) {
      classificacao = prefixTokens[1]!;
      descStartIdx = 2;
    } else if (!classificacao) {
      classificacao = codigo;
      descStartIdx = 1;
    }
  } else {
    codigo = prefixTokens[codigoIdx]!;
    classificacao = prefixTokens[classificacaoIdx]!;
    descStartIdx = classificacaoIdx + 1;
  }

  if (!codigo) return null;

  const descricao = prefixTokens.slice(descStartIdx).join(' ').trim().toUpperCase();
  if (!descricao) return null;

  return {
    codigo,
    classificacao,
    descricao,
    saldoAnterior: sa.valor,
    naturezaSaldoAnterior: sa.natureza,
    debito: deb.valor,
    credito: cred.valor,
    saldoAtual: sf.valor,
    naturezaSaldoAtual: sf.natureza,
  };
}

/* ────────────────────────── Text Extraction ────────────────────────── */

async function extractTextLinesFromPdf(file: File): Promise<string[]> {
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  const allLines: string[] = [];

  for (let pn = 1; pn <= doc.numPages; pn++) {
    const page = await doc.getPage(pn);
    const textContent = await page.getTextContent();

    const items: RawItem[] = [];
    for (const raw of textContent.items) {
      if (typeof raw !== 'object' || raw === null) continue;
      const it = raw as Record<string, unknown>;
      const str = typeof it.str === 'string' ? it.str : '';
      if (!str.trim()) continue;
      const tr = it.transform;
      if (!Array.isArray(tr) || tr.length < 6) continue;
      const x = typeof tr[4] === 'number' ? tr[4] : Number(tr[4]);
      const y = typeof tr[5] === 'number' ? tr[5] : Number(tr[5]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const w = typeof it.width === 'number' ? it.width : 0;
      const h = typeof it.height === 'number' ? it.height : 12;
      items.push({ str, x, y, w, h });
    }

    const lineClusters = clusterLines(items, 4);
    for (const cluster of lineClusters) {
      const lineText = cluster.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();
      if (lineText) allLines.push(lineText);
    }
  }

  return allLines;
}

/* ────────────────────────── Public API ────────────────────────── */

export async function parseBalanceteSaldoDominioPdf(file: File): Promise<BalanceteSaldoDominioResult> {
  const logs: string[] = [];
  const lines = await extractTextLinesFromPdf(file);
  logs.push(`PDF: ${lines.length} linha(s) extraída(s).`);

  let periodo: string | undefined;
  let empresa: string | undefined;
  const contas: ParsedConta[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/Per[ií]odo:\s*(\d{2}\/\d{2}\/\d{4})\s*[a-z\-]*\s*(\d{2}\/\d{2}\/\d{4})/i.test(line)) {
      const mp = line.match(/Per[ií]odo:\s*(\d{2}\/\d{2}\/\d{4})\s*[a-z\-]*\s*(\d{2}\/\d{2}\/\d{4})/i)!;
      periodo = `${mp[1]} - ${mp[2]}`;
    }
    if (/Empresa:\s*(.+)/i.test(line)) {
      const me = line.match(/Empresa:\s*(.+)/i);
      if (me) empresa = me[1].trim();
    }

    if (isMetadataLine(line)) continue;

    const conta = parseDataLineTokens(line);
    if (conta) {
      contas.push(conta);
    }
  }

  logs.push(`${contas.length} conta(s) detectada(s).`);

  // Log de amostra para debug
  if (contas.length > 0) {
    const amostra = contas.slice(0, 3);
    for (const c of amostra) {
      logs.push(`  → ${c.codigo} | ${c.classificacao} | ${c.descricao} | SA=${c.saldoAnterior}${c.naturezaSaldoAnterior} | D=${c.debito} | C=${c.credito} | SF=${c.saldoAtual}${c.naturezaSaldoAtual}`);
    }
  }

  if (contas.length === 0) {
    // Log das primeiras linhas não-metadata para debug
    const naoMeta = lines.filter((l) => l.trim() && !isMetadataLine(l.trim())).slice(0, 5);
    for (const l of naoMeta) {
      logs.push(`  [não casou] ${l.substring(0, 120)}`);
    }
    throw new Error(
      'Nenhuma conta encontrada no PDF. Verifique se o arquivo é o relatório "Balancete" exportado do Sistema Domínio com texto selecionável.',
    );
  }

  const planoRows: VisionPlanoRow[] = [];
  const seenPlano = new Set<string>();

  for (const conta of contas) {
    const key = `${conta.classificacao}::${conta.descricao}`;
    if (seenPlano.has(key)) continue;
    seenPlano.add(key);

    planoRows.push({
      codigo: conta.classificacao,
      nome: conta.descricao,
      codigoReduzido: conta.codigo,
      tipo: inferTipo(conta.classificacao),
      nivel: classToNivel(conta.classificacao),
    });
  }

  const balanceteRows: VisionBalanceteRow[] = [];
  let ordem = 0;

  for (const conta of contas) {
    // Para cada conta com saldo anterior, gerar uma linha especial
    // "SALDO ANTERIOR" que o sistema reconhece via isHistoricoSaldoInicialRazao.
    // Sem isso, montarBalanceteComPeriodo não enxerga o saldo anterior importado.
    if (conta.saldoAnterior > 0 || conta.naturezaSaldoAnterior) {
      ordem++;
      balanceteRows.push({
        id: `dom-sa-${conta.classificacao}-${ordem}`,
        codigo: conta.classificacao,
        classificacao: conta.classificacao,
        nome: 'SALDO ANTERIOR',
        ordem,
        saldoInicial: conta.saldoAnterior,
        naturezaSaldoInicial: conta.naturezaSaldoAnterior,
        debito: 0,
        credito: 0,
        saldoFinal: 0,
        tipo: inferTipo(conta.classificacao),
        nivel: classToNivel(conta.classificacao),
      });
    }

    ordem++;
    balanceteRows.push({
      id: `dom-saldo-${conta.classificacao}-${ordem}`,
      codigo: conta.classificacao,
      classificacao: conta.classificacao,
      nome: conta.descricao,
      ordem,
      saldoInicial: conta.saldoAnterior,
      debito: conta.debito,
      credito: conta.credito,
      saldoFinal: conta.saldoAtual,
      naturezaSaldoFinal: conta.naturezaSaldoAtual,
      naturezaSaldoInicial: conta.naturezaSaldoAnterior,
      tipo: inferTipo(conta.classificacao),
      nivel: classToNivel(conta.classificacao),
    });
  }

  const contasComSI = balanceteRows.filter((r) => r.saldoInicial > 0).length;
  const contasComSF = balanceteRows.filter((r) => r.saldoFinal > 0).length;
  logs.push(`Plano: ${planoRows.length} conta(s). Saldos: ${balanceteRows.length} (${contasComSI} com SI > 0, ${contasComSF} com SF > 0).`);

  return {
    planoRows,
    balanceteRows,
    periodoDetectado: periodo,
    empresaDetectada: empresa,
    logs,
  };
}
