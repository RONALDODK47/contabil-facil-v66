import type { VisionBalanceteRow } from '../types/accounting';
import { isCnpjLike } from '../../lib/cnpjGuard';

/**
 * Registro "01" (abertura) do TXT Domínio: sequência + CNPJ (14 dígitos, sem separadores)
 * + período de/até + indicador — nunca é um lançamento, sempre cabeçalho do arquivo.
 * Ex.: "0100001134485455100019801/01/202630/06/2026N05000000181".
 */
export function isDominioLancamentosHeaderLine(line: string): boolean {
  return /^01\d{7}\d{14}\d{2}\/\d{2}\/\d{4}\d{2}\/\d{2}\/\d{4}[A-Z]\d+$/.test(line.trim());
}

/** Detecta exportação Domínio: Utilitários > Exportação > Lançamentos (registros 01/02/03). */
export function isDominioLancamentosTxt(text: string): boolean {
  const sample = text.slice(0, 8000);
  if (!/^01\d/m.test(sample.trimStart())) return false;
  // Indicador de lote pode ser V/X (normal) ou C/D (lote de crédito/débito puro,
  // ex.: recebimento com rateio em várias contas) — qualquer letra é válida aqui,
  // o que importa é a data que vem logo em seguida.
  return /^02\d{7}[A-Z]/m.test(sample) && /^03\d{7}/m.test(sample);
}

/** Detecta formato TXT+ simplificado (semicolumns): DD/MM/YYYY;contaDeb;contaCred;valor;... */
export function isTxtPlusFormat(text: string): boolean {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 1) return false;
  const sample = lines[0];
  // Procura por padrão: data;numero;numero;numero (com data em DD/M/YYYY ou D/MM/YYYY)
  return /^\d{1,2}\/\d{1,2}\/\d{4};[\d.]+;[\d.]+;[\d.,]+/i.test(sample);
}

function parseCentavosField(field: string): number {
  let n = parseInt(field, 10) || 0;
  while (n > 999_999) n = Math.floor(n / 10);
  return n / 100;
}

function parseAmountBlock(line: string): number {
  const intPartRaw = line.substring(23, 34).replace(/\D/g, '');
  const fracPartRaw = line.substring(34, 45).replace(/\D/g, '');

  // Formato TXT Domínio (03): valor quebrado em 2 blocos de 11 dígitos.
  // Ex.: int=00000000018 frac=99830000000 => 1.899,83
  if (intPartRaw || fracPartRaw) {
    const intPart = parseInt(intPartRaw || '0', 10);
    const fracPart = parseInt(fracPartRaw || '0', 10);
    const value = intPart * 100 + fracPart / 1_000_000_000;
    if (Number.isFinite(value) && value > 0) return value;
  }

  // Fallback para variações legadas de layout.
  const vD = parseCentavosField(line.substring(23, 34));
  const vC = parseCentavosField(line.substring(34, 45));
  const fieldVal = Math.max(vD, vC);
  if (fieldVal >= 1) return fieldVal;
  const combined = parseCentavosField(line.substring(23, 45));
  return fieldVal || combined;
}

function parseHistorico(line: string): string {
  return line
    .substring(45, 345)
    .replace(/\s+\d{7}\s*$/, '')
    .trim();
}

function parseDataLote02(line: string): string | undefined {
  // O indicador de lote (letra após os 7 dígitos) varia — V/X são os mais comuns,
  // mas o Domínio também exporta lotes com C/D (ex.: recebimento rateado em várias
  // contas). Aceitar qualquer letra aqui evita perder a data (e, com ela, todos os
  // lançamentos "03" seguintes) sempre que aparecer um indicador fora de V/X.
  const m = line.match(/^02\d{7}[A-Z](\d{2}\/\d{2}\/\d{4})/);
  return m?.[1];
}

function padCodigoReduzido(cod: string): string {
  const digits = cod.replace(/\D/g, '');
  if (!digits) return '';
  return digits.padStart(7, '0').slice(-7);
}

function isSaldoInicial(hist: string): boolean {
  // Domínio e variações: "REFERENTE SALDO INICIAL", "SALDO INICIAL", "S.I."
  return /saldo\s*inicial|referente\s+saldo|^\s*s\.?\s*i\.?\s*$/i.test(hist.trim());
}

function brDateToIso(data: string | undefined): string {
  const t = String(data ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!m) return new Date().toISOString().split('T')[0];
  const yearPart = m[3] ?? String(new Date().getFullYear());
  const year = yearPart.length === 2 ? `20${yearPart}` : yearPart;
  return `${year}-${m[2]}-${m[1]}`;
}

function parseTxtPlusValor(valor: string): number {
  const cleaned = String(valor || '').replace(/\s/g, '');
  if (!cleaned) return 0;
  // Handles: 4,65 → 4.65 OR 4.65 → 4.65
  const normalized = cleaned.replace(',', '.');
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Parseia formato TXT+ (semicolons) em VisionBalanceteRow.
 * CADA lançamento gera 2 linhas (débito + crédito), ambas com
 * contaDeb e contaCred preenchidas — assim a re-exportação para TXT
 * é uma leitura direta, sem precisar de nenhum pareamento.
 */
export function parseTxtPlusToVisionRows(text: string): VisionBalanceteRow[] {
  const rows: VisionBalanceteRow[] = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let ordemBase = 0;

  for (const line of lines) {
    if (isDominioLancamentosHeaderLine(line)) continue;
    if (/^0[123](?!\d*\/)/.test(line)) continue;

    const parts = line.split(';');
    if (parts.length < 4) continue;

    const dateStr = parts[0]?.trim() ?? '';
    if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) continue;

    const contaDeb = parts[1]?.trim() ?? '';
    const contaCred = parts[2]?.trim() ?? '';
    const valor = parseTxtPlusValor(parts[3] ?? '');
    const historico = (parts[5]?.trim() || parts[4]?.trim() || 'LANCAMENTO').toUpperCase();

    if (isCnpjLike(contaDeb) || isCnpjLike(contaCred)) continue;
    if (valor <= 0 || (!contaDeb && !contaCred)) continue;

    const data = brDateToIso(dateStr);
    ordemBase++;
    // Ambas as linhas compartilham a mesma ordem E carregam
    // as duas contas — re-exportação não precisa adivinhar nada.
    const base = {
      data,
      ordem: ordemBase,
      nome: historico,
      saldoInicial: 0,
      saldoFinal: 0,
      contaDeb: contaDeb && contaDeb !== '0' ? contaDeb : undefined,
      contaCred: contaCred && contaCred !== '0' ? contaCred : undefined,
    };

    if (contaDeb && contaDeb !== '0') {
      rows.push({ ...base, codigo: contaDeb, debito: valor, credito: 0 });
    }
    if (contaCred && contaCred !== '0') {
      rows.push({ ...base, codigo: contaCred, debito: 0, credito: valor });
    }
  }

  return rows;
}

/** Converte TXT Domínio (registros 02/03) ou TXT+ (semicolons) em linhas de razão. */
export function parseDominioLancamentosTxt(text: string): VisionBalanceteRow[] {
  // Tenta formato TXT+ (simplificado) primeiro
  if (isTxtPlusFormat(text)) {
    return parseTxtPlusToVisionRows(text);
  }

  // Fallback: formato Domínio (01/02/03)
  let rows: VisionBalanceteRow[] = [];
  let dataAtual: string | undefined;
  let ordemFallback = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) continue;

    if (line.startsWith('02')) {
      dataAtual = parseDataLote02(line);
      continue;
    }

    if (!line.startsWith('03') || line.length < 45) continue;

    const hist = parseHistorico(line);
    const saldoInicialLine = isSaldoInicial(hist);

    const contaDeb = padCodigoReduzido(line.substring(9, 16));
    const contaCred = padCodigoReduzido(line.substring(16, 23));
    const valor = parseAmountBlock(line);
    if (!valor || (!contaDeb && !contaCred)) continue;

    const seqArquivo = parseInt(line.substring(2, 9), 10) || 0;
    const ordem = seqArquivo > 0 ? seqArquivo : ++ordemFallback;

    const base = {
      data: dataAtual,
      ordem,
      nome: hist || '—',
      saldoInicial: 0,
      saldoFinal: 0,
    };

    if (saldoInicialLine) {
      // Saldo inicial exportado pelo Domínio: preserva conta e valor para não "sumir"
      // no balancete consolidado quando a conta não tem movimento no período.
      if (contaDeb && contaDeb !== '0000000') {
        rows.push({
          ...base,
          codigo: contaDeb,
          saldoInicial: valor,
          naturezaSaldoInicial: 'D',
          debito: 0,
          credito: 0,
        });
      }
      if (contaCred && contaCred !== '0000000') {
        rows.push({
          ...base,
          codigo: contaCred,
          saldoInicial: valor,
          naturezaSaldoInicial: 'C',
          debito: 0,
          credito: 0,
        });
      }
      continue;
    }

    // Ambas as linhas recebem contaDeb + contaCred para que a re-exportação
    // para TXT Domínio seja uma leitura direta, sem precisar de pareamento.
    const debs = contaDeb && contaDeb !== '0000000' ? contaDeb : undefined;
    const creds = contaCred && contaCred !== '0000000' ? contaCred : undefined;
    // Débito e crédito nunca podem ser a mesma conta — se o layout do TXT trouxer
    // as duas colunas com o mesmo código (dado de origem incompleto/corrompido),
    // é melhor tratar a contrapartida como DESCONHECIDA (fica "sem contrapartida"
    // para revisão manual) do que fingir uma partida fechada contra si mesma.
    // O código/valor da própria perna é mantido — só a referência cruzada some.
    const contraValida = Boolean(debs && creds && debs !== creds);
    const contraDebParaCred = contraValida ? debs : undefined;
    const contraCredParaDeb = contraValida ? creds : undefined;

    if (debs) {
      rows.push({
        ...base,
        codigo: debs,
        contaDeb: debs,
        contaCred: contraCredParaDeb,
        debito: valor,
        credito: 0,
      });
    }

    if (creds) {
      rows.push({
        ...base,
        codigo: creds,
        contaDeb: contraDebParaCred,
        contaCred: creds,
        debito: 0,
        credito: valor,
      });
    }
  }

  // Enriquecimento de contrapartidas para lançamentos múltiplos/rateios no Domínio,
  // onde cada perna vem em uma linha '03' separada sem a contrapartida (contaDeb/contaCred undefined).
  // Agrupamos por data para enriquecer contrapartidas compostas de forma avançada e robusta
  rows = enriquecerContrapartidasCompostas(rows);

  return rows;
}

/**
 * Subset-sum por programação dinâmica (não recursão exponencial): antes disso
 * cada combinação débito/crédito era testada por backtracking include/exclude
 * (2^N), o que travava a aba do navegador quando um dia tinha dezenas de
 * lançamentos sem par (ex.: clicar em "Sem Contrapartida" no Balancete).
 * DP mapeia somas alcançáveis (em centavos, limitadas ao alvo) para o
 * subconjunto de índices que a produz — trabalho polinomial em vez de
 * exponencial. `MAX_DP_SIZE` é um teto de segurança: se o número de somas
 * alcançáveis explodir mesmo assim (alvo muito grande + muitos itens), aborta
 * e devolve "sem par" em vez de travar.
 */
export function findSubsetSum(
  arr: VisionBalanceteRow[],
  target: number,
  key: 'debito' | 'credito' = 'debito'
): VisionBalanceteRow[] | null {
  const TOLERANCE_CENTS = 5;
  const MAX_DP_SIZE = 200_000;
  const targetCents = Math.round(target * 100);
  if (targetCents <= 0) return null;

  // sumCents -> índices de arr que somam esse valor
  const dp = new Map<number, number[]>();
  dp.set(0, []);

  for (let i = 0; i < arr.length; i++) {
    const val = key === 'debito' ? (arr[i].debito ?? 0) : (arr[i].credito ?? 0);
    const valCents = Math.round(val * 100);
    if (valCents <= 0) continue;

    const additions: Array<[number, number[]]> = [];
    for (const [sum, path] of dp) {
      const newSum = sum + valCents;
      if (newSum > targetCents + TOLERANCE_CENTS) continue;
      if (dp.has(newSum)) continue;
      const newPath = [...path, i];
      if (Math.abs(newSum - targetCents) <= TOLERANCE_CENTS) {
        return newPath.map((idx) => arr[idx]);
      }
      additions.push([newSum, newPath]);
    }
    for (const [s, p] of additions) dp.set(s, p);
    if (dp.size > MAX_DP_SIZE) return null;
  }

  return null;
}

/**
 * Grava a conta da contrapartida num campo (`contaDeb`/`contaCred`) — mas
 * nunca se ela coincidir com o código da própria linha (ou com o que já
 * estiver no campo oposto). Sem essa guarda, duas pernas do mesmo dia que
 * coincidem na conta (ex.: um código genérico usado por várias automações)
 * produziam `contaDeb === contaCred`, e o modal "Editar Lançamento" acabava
 * mostrando a mesma conta nos dois seletores para um lançamento de perna única.
 */
function atribuirContrapartida(
  row: VisionBalanceteRow,
  campo: 'contaDeb' | 'contaCred',
  codigo: string | undefined,
): void {
  if (!codigo) return;
  const campoOposto = campo === 'contaDeb' ? 'contaCred' : 'contaDeb';
  const valorOposto = row[campoOposto] || row.codigo;
  if (valorOposto && valorOposto === codigo) return;
  row[campo] = codigo;
}

export function enriquecerContrapartidasCompostas(rows: VisionBalanceteRow[]): VisionBalanceteRow[] {
  // 1. Agrupar por data as linhas que não são saldo inicial e que estão faltando contaDeb ou contaCred
  const porData = new Map<string, VisionBalanceteRow[]>();
  for (const r of rows) {
    if ((r.saldoInicial ?? 0) > 0) continue;
    if (r.contaDeb && r.contaCred) continue; // Já possui ambas
    if (!r.data) continue;
    const list = porData.get(r.data) ?? [];
    list.push(r);
    porData.set(r.data, list);
  }

  for (const [data, group] of porData.entries()) {
    const debs = group.filter((r) => (r.debito ?? 0) > 0 && !r.contaCred);
    const creds = group.filter((r) => (r.credito ?? 0) > 0 && !r.contaDeb);
    if (debs.length === 0 || creds.length === 0) continue;

    // Tenta encontrar correspondência exata de soma para consumir tudo de uma vez
    const totalDeb = debs.reduce((s, r) => s + (r.debito ?? 0), 0);
    const totalCred = creds.reduce((s, r) => s + (r.credito ?? 0), 0);
    if (Math.abs(totalDeb - totalCred) < 0.05) {
      // 1-para-N (um crédito para múltiplos débitos)
      if (creds.length === 1) {
        const c = creds[0];
        atribuirContrapartida(c, 'contaDeb', debs[0].codigo); // Pega o 1º pra não ficar vazio
        for (const d of debs) {
          atribuirContrapartida(d, 'contaCred', c.codigo);
        }
      }
      // N-para-1 (múltiplos débitos para um crédito)
      else if (debs.length === 1) {
        const d = debs[0];
        atribuirContrapartida(d, 'contaCred', creds[0].codigo);
        for (const c of creds) {
          atribuirContrapartida(c, 'contaDeb', d.codigo);
        }
      }
      // N-para-M (rateio complexo)
      else {
        // Distribui sequencialmente (waterfall) para preencher as contrapartidas de todos
        let di = 0;
        let ci = 0;
        let debRemain = debs[0].debito ?? 0;
        let credRemain = creds[0].credito ?? 0;
        while (di < debs.length && ci < creds.length) {
          const d = debs[di];
          const c = creds[ci];
          const amt = Math.min(debRemain, credRemain);

          if (!d.contaCred) atribuirContrapartida(d, 'contaCred', c.codigo);
          if (!c.contaDeb) atribuirContrapartida(c, 'contaDeb', d.codigo);

          debRemain = Math.round((debRemain - amt) * 100) / 100;
          credRemain = Math.round((credRemain - amt) * 100) / 100;

          if (debRemain <= 0.004) {
            di++;
            debRemain = debs[di]?.debito ?? 0;
          }
          if (credRemain <= 0.004) {
            ci++;
            credRemain = creds[ci]?.credito ?? 0;
          }
        }
      }
      continue;
    }

    // Se a data não bate no total, tenta subset matching para encontrar partes balanceadas
    const consumedDebs = new Set<VisionBalanceteRow>();
    const consumedCreds = new Set<VisionBalanceteRow>();

    // 1-para-N subset matching
    for (const c of creds) {
      const valC = c.credito ?? 0;
      const candidates = debs.filter(d => !consumedDebs.has(d));
      const matchedSubset = findSubsetSum(candidates, valC);
      if (matchedSubset) {
        consumedCreds.add(c);
        atribuirContrapartida(c, 'contaDeb', matchedSubset[0].codigo);
        for (const d of matchedSubset) {
          consumedDebs.add(d);
          atribuirContrapartida(d, 'contaCred', c.codigo);
        }
      }
    }

    // N-para-1 subset matching
    for (const d of debs) {
      if (consumedDebs.has(d)) continue;
      const valD = d.debito ?? 0;
      const candidates = creds.filter(c => !consumedCreds.has(c));
      const matchedSubset = findSubsetSum(candidates, valD, 'credito');
      if (matchedSubset) {
        consumedDebs.add(d);
        atribuirContrapartida(d, 'contaCred', matchedSubset[0].codigo);
        for (const c of matchedSubset) {
          consumedCreds.add(c);
          atribuirContrapartida(c, 'contaDeb', d.codigo);
        }
      }
    }
  }

  return rows;
}

export async function readTextFileSmart(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    const text1252 = new TextDecoder('windows-1252').decode(buf);
    if (!text1252.includes('\uFFFD')) return text1252;
  } catch {
    // ignore
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}
