import * as pdfjsLib from 'pdfjs-dist';
import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';
import {
  getClassificacao,
  isGrupo3CustoDespesa,
  resolveTipoConta,
} from '../../extratoVision/utils/demonstracoesContabeis';
import {
  isDominioLancamentosTxt,
  parseDominioLancamentosTxt,
  readTextFileSmart,
} from '../../extratoVision/utils/dominioLancamentosTxt';
import { recalcularSaldoFinalRow } from '../../extratoVision/utils/mergeRazaoSaldoInicial';
import {
  isBalanceteModelo,
  isRazaoModelo,
  parseBalanceteSheet,
  parseRazaoSheet,
  parseValorDc,
} from '../../extratoVision/utils/planilhaModelo';
import {
  agregarRazaoPorConta,
  extrairPeriodoRazao,
  filtrarContasAnaliticas,
  isValidRazaoLinha,
  processarRazaoImportado,
} from '../../extratoVision/utils/razaoContabil';
import { readSpreadsheetGrid } from './dominioPlanoExcel';
import type { NotaEndividamentoTipo, NotaExplicativaEmpresaDados } from './notaExplicativaTypes';

export type BalanceteNotaCampo = {
  campo: string;
  valor: string;
  contas: string[];
};

export type BalanceteNotaImportResult = {
  patch: Partial<NotaExplicativaEmpresaDados>;
  logs: string[];
  campos: BalanceteNotaCampo[];
  exercicioDetectado?: string;
  dataEncerramentoDetectada?: string;
  contasImportadas: number;
};

function classRoot(classificacao: string): string {
  return classificacao.replace(/\./g, '')[0] ?? '';
}

function isRaizReceita(classificacao: string): boolean {
  if (classRoot(classificacao) !== '3') return false;
  return !isGrupo3CustoDespesa(classificacao);
}

function isPatrimonioLiquido(cls: string, nome: string): boolean {
  const c = cls.toLowerCase();
  const n = nome.toLowerCase();
  if (/^2\.(3|03)/.test(c)) return true;
  if (/^23/.test(c.replace(/\./g, ''))) return true;
  return (
    n.includes('patrimônio líquido') ||
    n.includes('patrimonio liquido') ||
    n.includes('capital social') ||
    /reservas? de (capital|lucros|reavaliação|avaliação)/i.test(n) ||
    /lucros? acumulado/i.test(n) ||
    /prejuízo[s]? acumulado|prejuizo[s]? acumulado/i.test(n) ||
    /resultado[s]? do exercício|resultado[s]? do exercicio/i.test(n)
  );
}

function isPassivoCirculante(cls: string): boolean {
  return /^2\.1/.test(cls) || /^21/.test(cls.replace(/\./g, ''));
}

function isPassivoNaoCirculante(cls: string): boolean {
  return /^2\.2/.test(cls) || /^22/.test(cls.replace(/\./g, ''));
}

function saldoPassivoPositivo(row: VisionBalanceteRow): number {
  const sf = row.saldoFinal ?? 0;
  if (sf > 0) {
    if (row.naturezaSaldoFinal === 'C') return sf;
    if (row.naturezaSaldoFinal === 'D') return 0;
    return sf;
  }
  const liq = row.credito - row.debito + (row.saldoInicial ?? 0);
  return liq > 0 ? liq : 0;
}

function saldoPlPositivo(row: VisionBalanceteRow): number {
  const sf = row.saldoFinal ?? 0;
  if (sf > 0) {
    if (row.naturezaSaldoFinal === 'C') return sf;
    if (row.naturezaSaldoFinal === 'D') return 0;
    return sf;
  }
  const liq = row.credito - row.debito;
  return liq > 0 ? liq : Math.abs(row.debito - row.credito);
}

function receitaContaValor(row: VisionBalanceteRow): number {
  const mov = row.credito - row.debito;
  if (Math.abs(mov) > 0.001) return mov;
  const sf = row.saldoFinal ?? 0;
  if (sf > 0 && row.naturezaSaldoFinal === 'C') return sf;
  if (sf > 0 && !row.naturezaSaldoFinal) return sf;
  return mov > 0 ? mov : 0;
}

function fmtMoeda(v: number): string {
  if (Math.abs(v) < 0.01) return '';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function contaLabel(row: VisionBalanceteRow): string {
  const cls = getClassificacao(row);
  const nome = row.nome?.trim() || '—';
  return cls ? `${cls} — ${nome}` : nome;
}

function isEmprestimoNome(nome: string): boolean {
  return /emprest|emprést|mutuo|m[uú]tuo|adiantamento.*soci|conta\s+movimento.*emp/i.test(nome);
}

function isFinanciamentoNome(nome: string): boolean {
  return /financ|leasing|arrendamento|debenture|credito\s+(rural|banc)|crdito\s+(rural|banc)|acc|ace/i.test(
    nome,
  );
}

function inferTiposEndividamento(
  emprestCp: number,
  emprestLp: number,
  finCp: number,
  finLp: number,
): NotaEndividamentoTipo[] {
  const tipos: NotaEndividamentoTipo[] = [];
  if (emprestCp + emprestLp > 0.01) tipos.push('emprestimo_bancario');
  if (finCp + finLp > 0.01) tipos.push('financiamento_bens');
  return tipos;
}

/** Consolida razão (lançamentos) ou balancete (saldos por conta) em snapshot analítico. */
export function consolidarBalanceteParaNota(rows: VisionBalanceteRow[]): VisionBalanceteRow[] {
  if (!rows.length) return [];

  const temSaldoPorConta = rows.some(
    (r) => (r.saldoFinal ?? 0) > 0 || (r.saldoInicial ?? 0) > 0 || r.naturezaSaldoFinal,
  );
  const temLancamentos = rows.filter((r) => r.data && (r.debito > 0 || r.credito > 0)).length > rows.length * 0.3;

  if (temSaldoPorConta && !temLancamentos) {
    return rows
      .filter((r) => isValidRazaoLinha(r) || Boolean(getClassificacao(r)))
      .map((r) => (r.saldoFinal ? r : recalcularSaldoFinalRow(r)));
  }

  const { analiticas } = processarRazaoImportado(rows);
  const agregadas = agregarRazaoPorConta(filtrarContasAnaliticas(analiticas));
  return agregadas.map((r) => recalcularSaldoFinalRow(r));
}

/** Extrai campos da nota explicativa a partir do balancete consolidado. */
export function extractNotaDadosFromBalancete(rows: VisionBalanceteRow[]): BalanceteNotaImportResult {
  const balancete = consolidarBalanceteParaNota(rows);
  const logs: string[] = [`${balancete.length} conta(s) analisada(s) no balancete.`];
  const campos: BalanceteNotaCampo[] = [];

  const analiticas = balancete.filter((r) => resolveTipoConta(r, balancete) === 'A');
  const base = analiticas.length > 0 ? analiticas : balancete;

  let receitaBruta = 0;
  const contasReceita: string[] = [];
  for (const r of base) {
    const cls = getClassificacao(r);
    if (!isRaizReceita(cls)) continue;
    const v = receitaContaValor(r);
    if (v <= 0) continue;
    receitaBruta += v;
    contasReceita.push(contaLabel(r));
  }
  if (receitaBruta <= 0) {
    const sintReceita = balancete.find((r) => {
      const n = (r.nome ?? '').toLowerCase();
      return /receita\s+(bruta|operacional|l[ií]quida)/i.test(n) && classRoot(getClassificacao(r)) === '3';
    });
    if (sintReceita) {
      receitaBruta = receitaContaValor(sintReceita);
      contasReceita.push(contaLabel(sintReceita));
    }
  }

  let patrimonioLiquido = 0;
  const contasPl: string[] = [];
  const linhaPlTotal = balancete.find((r) =>
    /patrim[oô]nio\s+l[ií]quido/i.test(r.nome ?? ''),
  );
  if (linhaPlTotal) {
    patrimonioLiquido = saldoPlPositivo(linhaPlTotal);
    contasPl.push(contaLabel(linhaPlTotal));
  } else {
    for (const r of base) {
      const cls = getClassificacao(r);
      if (!isPatrimonioLiquido(cls, r.nome ?? '')) continue;
      const v = saldoPlPositivo(r);
      if (v <= 0) continue;
      patrimonioLiquido += v;
      contasPl.push(contaLabel(r));
    }
  }

  let capitalSocial = 0;
  const contasCap: string[] = [];
  for (const r of base) {
    const n = (r.nome ?? '').toLowerCase();
    if (!/capital\s+social/i.test(n)) continue;
    const v = saldoPlPositivo(r);
    if (v <= 0) continue;
    capitalSocial = Math.max(capitalSocial, v);
    contasCap.push(contaLabel(r));
  }

  let emprestCp = 0;
  let emprestLp = 0;
  let finCp = 0;
  let finLp = 0;
  const contasEmpCp: string[] = [];
  const contasEmpLp: string[] = [];
  const contasFinCp: string[] = [];
  const contasFinLp: string[] = [];

  for (const r of base) {
    const cls = getClassificacao(r);
    if (classRoot(cls) !== '2' || isPatrimonioLiquido(cls, r.nome ?? '')) continue;
    const nome = r.nome ?? '';
    const v = saldoPassivoPositivo(r);
    if (v <= 0) continue;

    const emprest = isEmprestimoNome(nome);
    const fin = isFinanciamentoNome(nome);
    if (!emprest && !fin) continue;

    if (isPassivoCirculante(cls)) {
      if (emprest) {
        emprestCp += v;
        contasEmpCp.push(contaLabel(r));
      } else {
        finCp += v;
        contasFinCp.push(contaLabel(r));
      }
    } else if (isPassivoNaoCirculante(cls)) {
      if (emprest) {
        emprestLp += v;
        contasEmpLp.push(contaLabel(r));
      } else {
        finLp += v;
        contasFinLp.push(contaLabel(r));
      }
    }
  }

  const periodo = extrairPeriodoRazao(rows);
  let exercicioDetectado: string | undefined;
  let dataEncerramentoDetectada: string | undefined;
  if (periodo.max) {
    const m = periodo.max.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) {
      exercicioDetectado = m[3];
      dataEncerramentoDetectada = periodo.max;
    }
  }

  const patch: Partial<NotaExplicativaEmpresaDados> = {};

  if (receitaBruta > 0) {
    patch.receitaBrutaExercicio = fmtMoeda(receitaBruta);
    campos.push({ campo: 'Receita bruta do exercício', valor: patch.receitaBrutaExercicio, contas: contasReceita });
    logs.push(`Receita bruta: R$ ${patch.receitaBrutaExercicio} (${contasReceita.length} conta(s)).`);
  }

  if (patrimonioLiquido > 0) {
    patch.patrimonioLiquido = fmtMoeda(patrimonioLiquido);
    campos.push({ campo: 'Patrimônio líquido', valor: patch.patrimonioLiquido, contas: contasPl });
    logs.push(`Patrimônio líquido: R$ ${patch.patrimonioLiquido}.`);
  }

  if (capitalSocial > 0) {
    patch.capitalSocial = fmtMoeda(capitalSocial);
    campos.push({ campo: 'Capital social', valor: patch.capitalSocial, contas: contasCap });
    logs.push(`Capital social: R$ ${patch.capitalSocial}.`);
  }

  if (emprestCp + emprestLp > 0.01) {
    patch.possuiEmprestimos = true;
    if (emprestCp > 0) patch.saldoEmprestimosCP = fmtMoeda(emprestCp);
    if (emprestLp > 0) patch.saldoEmprestimosLP = fmtMoeda(emprestLp);
    campos.push({
      campo: 'Empréstimos (CP / LP)',
      valor: [patch.saldoEmprestimosCP, patch.saldoEmprestimosLP].filter(Boolean).join(' / '),
      contas: [...contasEmpCp, ...contasEmpLp],
    });
    logs.push(`Empréstimos detectados: CP R$ ${patch.saldoEmprestimosCP || '0,00'} · LP R$ ${patch.saldoEmprestimosLP || '0,00'}.`);
  }

  if (finCp + finLp > 0.01) {
    patch.possuiFinanciamentos = true;
    if (finCp > 0) patch.saldoFinanciamentosCP = fmtMoeda(finCp);
    if (finLp > 0) patch.saldoFinanciamentosLP = fmtMoeda(finLp);
    campos.push({
      campo: 'Financiamentos (CP / LP)',
      valor: [patch.saldoFinanciamentosCP, patch.saldoFinanciamentosLP].filter(Boolean).join(' / '),
      contas: [...contasFinCp, ...contasFinLp],
    });
    logs.push(`Financiamentos detectados: CP R$ ${patch.saldoFinanciamentosCP || '0,00'} · LP R$ ${patch.saldoFinanciamentosLP || '0,00'}.`);
  }

  const tipos = inferTiposEndividamento(emprestCp, emprestLp, finCp, finLp);
  if (tipos.length) patch.tiposEndividamento = tipos;

  if (exercicioDetectado) {
    patch.exercicio = exercicioDetectado;
    logs.push(`Exercício detectado: ${exercicioDetectado}.`);
  }
  if (dataEncerramentoDetectada) {
    patch.dataEncerramento = dataEncerramentoDetectada;
  }

  if (campos.length === 0) {
    logs.push('Nenhum campo financeiro identificado automaticamente — confira classificações e saldos.');
  }

  return {
    patch,
    logs,
    campos,
    exercicioDetectado,
    dataEncerramentoDetectada,
    contasImportadas: balancete.length,
  };
}

/**
 * Classificação pontuada (ex.: "1.1.1.01.00001"). O lookahead exclui valores
 * monetários com separador de milhar (ex.: "12.661.144,14"), que têm a MESMA
 * forma "dígito.dígito.dígito" — sem essa exclusão o parser confundia o Saldo
 * Anterior/Débito/Crédito com a classificação da conta: "1 1 ATIVO
 * 1.768.235,90D 12.661.144,14 ..." virava classificação "1.768.235" (ou até
 * "1.768.23", pois o regex encolhe o último grupo pra escapar de um `(?!,)`
 * simples) e o código/nome reais eram perdidos. `(?!\d*,\d{2})` rejeita
 * QUALQUER prefixo do valor monetário, não só o match completo — cobre
 * também os grupos encolhidos pelo backtracking.
 */
const RE_CLASS = /\d(?:\.\d+){2,}(?!\d*,\d{2})/;
const RE_MOEDA = /[+-]?\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/g;
/** Valor monetário com sufixo D/C opcional (ex.: "230.199,52D", "0,00"). */
const RE_MOEDA_DC = /([+-]?\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s*([DC])?/gi;
/**
 * Valor monetário + sufixo D/C colado (sem espaço), só quando o D/C está
 * isolado (lookahead de espaço/fim de linha) — evita capturar a 1ª letra de
 * uma descrição que comece com "D"/"C" logo após um valor sem sufixo (ex.:
 * "0,00 DUPLICATAS..."). Usado no Formato 1 (classificação pontuada), onde
 * `RE_MOEDA` sozinho descartava o D/C e fazia o Saldo Anterior perder o sinal.
 */
const RE_MOEDA_DC_ADJACENTE = /([+-]?\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})([DC])?(?=\s|$)/gi;

/** Converte valor + natureza contábil em número com sinal (D positivo, C negativo). */
function saldoAssinado(valor: number, natureza?: 'D' | 'C'): number {
  return natureza === 'C' ? -Math.abs(valor) : Math.abs(valor);
}

/**
 * Confere a partida do balancete: SaldoAnterior + Débito − Crédito = SaldoAtual
 * (com sinais D/C). É a prova real de que as 4 colunas foram recortadas na
 * ordem certa — se não fechar, a ordem atribuída está errada.
 */
function conferePartidaBalancete(
  si: { valor: number; natureza?: 'D' | 'C' },
  debito: number,
  credito: number,
  sf: { valor: number; natureza?: 'D' | 'C' },
): boolean {
  const esperado = saldoAssinado(si.valor, si.natureza) + debito - credito;
  return Math.abs(esperado - saldoAssinado(sf.valor, sf.natureza)) <= 0.02;
}

type ValoresBalancete = {
  saldoInicial: number;
  naturezaSaldoInicial?: 'D' | 'C';
  debito: number;
  credito: number;
  saldoFinal: number;
  naturezaSaldoFinal?: 'D' | 'C';
};

/**
 * Interpreta os 4 valores recortados de uma linha do balancete Domínio.
 * Ordens possíveis:
 *  - 'dominio': [SaldoAtual, Crédito, Débito, SaldoAnterior] (ordem do texto do PDF);
 *  - 'visual':  [SaldoAnterior, Débito, Crédito, SaldoAtual] (ordem das colunas impressas).
 * Tenta a ordem preferida; se a partida não fechar, tenta a outra — assim o
 * recorte sai exatamente como está no PDF, sem inverter colunas.
 */
function interpretaValoresBalancete(
  vals: string[],
  preferida: 'dominio' | 'visual',
): ValoresBalancete {
  const montar = (ordem: 'dominio' | 'visual'): ValoresBalancete => {
    const [a, b, c, d] = vals;
    if (ordem === 'dominio') {
      const sf = parseValorDc(a);
      const si = parseValorDc(d);
      return {
        saldoInicial: si.valor,
        naturezaSaldoInicial: si.natureza,
        debito: parseValorDc(c!).valor,
        credito: parseValorDc(b!).valor,
        saldoFinal: sf.valor,
        naturezaSaldoFinal: sf.natureza,
      };
    }
    const si = parseValorDc(a);
    const sf = parseValorDc(d);
    return {
      saldoInicial: si.valor,
      naturezaSaldoInicial: si.natureza,
      debito: parseValorDc(b!).valor,
      credito: parseValorDc(c!).valor,
      saldoFinal: sf.valor,
      naturezaSaldoFinal: sf.natureza,
    };
  };
  const confere = (v: ValoresBalancete) =>
    conferePartidaBalancete(
      { valor: v.saldoInicial, natureza: v.naturezaSaldoInicial },
      v.debito,
      v.credito,
      { valor: v.saldoFinal, natureza: v.naturezaSaldoFinal },
    );
  const primeira = montar(preferida);
  if (confere(primeira)) return primeira;
  const alternativa = montar(preferida === 'dominio' ? 'visual' : 'dominio');
  if (confere(alternativa)) return alternativa;
  return primeira;
}

/**
 * Separa código reduzido + descrição quando vêm colados no recorte do PDF.
 * Cobre: "1  ATIVO", "1007ADIANTAMENTOS", "125(-) DEPRECIAÇÕES" e descrição
 * iniciada por número ordinal ("19513º SALARIO A PAGAR" → 195 + "13º SALARIO...").
 */
function splitCodigoNomeBalancete(resto: string): { codigo: string; nome: string } | null {
  let m = resto.match(/^(\d{1,7})\s+(\S.*)$/);
  if (m) return { codigo: m[1]!, nome: m[2]!.trim() };
  m = resto.match(/^(\d{1,7})([A-Za-zÀ-ÖØ-öø-ÿ(%].*)$/);
  if (m) return { codigo: m[1]!, nome: m[2]!.trim() };
  // Nome começando com ordinal (13º/13o) exige código lazy para não engolir o "13".
  m = resto.match(/^(\d{1,7}?)(\d{1,2}\s?[ºo°](?:\s.*)?)$/i);
  if (m) return { codigo: m[1]!, nome: m[2]!.trim() };
  return null;
}

/**
 * Interpreta linhas de relatório de balancete (PDF texto / exportação impressa).
 * Suporta os formatos:
 * 1. Classificação pontuada (1.1.1.01.00001) — formato analítico.
 * 2. Domínio balancete PDF — 4 valores + código reduzido + descrição, valores
 *    espaçados ("230.199,52D 9.536,34 19.779,94 219.955,92D 1 ATIVO").
 * 3. Ordem visual impressa — código + descrição + 4 valores no fim da linha.
 * 2b. Valores colados sem espaço ("230.199,52D9.536,3419.779,94219.955,92D1  ATIVO").
 * Cada linha passa pela prova real (SaldoAnterior + Débito − Crédito = SaldoAtual),
 * que corrige automaticamente a ordem das colunas quando necessário.
 */
export function parseBalanceteTextLines(lines: string[]): VisionBalanceteRow[] {
  const out: VisionBalanceteRow[] = [];
  let ordem = 0;

  const pushRow = (codigo: string, nome: string, v: ValoresBalancete, classificacao?: string) => {
    if (!codigo && !nome) return;
    const cls = classificacao || codigo;

    // Injeta linha "SALDO ANTERIOR" antes da linha da conta quando há saldo
    // anterior — sem isso montarBalanceteComPeriodo ignora o campo saldoInicial
    // das linhas normais (só processa linhas cujo nome bate com isHistoricoSaldoInicialRazao).
    if (v.saldoInicial > 0) {
      ordem += 1;
      out.push({
        codigo,
        classificacao: cls,
        nome: 'SALDO ANTERIOR',
        ordem,
        saldoInicial: v.saldoInicial,
        naturezaSaldoInicial: v.naturezaSaldoInicial,
        debito: 0,
        credito: 0,
        saldoFinal: 0,
      });
    }

    ordem += 1;
    out.push({
      codigo,
      classificacao: cls,
      nome: nome || '—',
      ordem,
      saldoInicial: v.saldoInicial,
      naturezaSaldoInicial: v.naturezaSaldoInicial,
      debito: v.debito,
      credito: v.credito,
      saldoFinal: v.saldoFinal,
      naturezaSaldoFinal: v.naturezaSaldoFinal,
    });
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.length < 12) continue;
    if (/^p[aá]gina|^total\s+geral|^empresa|^c\.?\s*n\.?\s*p\.?\s*j|^per[ií]odo|^folha|^n[uú]mero\s+livro|^balancete|^c[oó]digo|^descri/i.test(line)) continue;
    if (/Sistema licenciado/i.test(line)) continue;

    // ─── Formato 1: classificação pontuada (1.1.1.01.00001) ───────────────
    const clsMatch = line.match(RE_CLASS);
    if (clsMatch) {
      const classificacao = clsMatch[0];
      const valores = [...line.matchAll(RE_MOEDA_DC_ADJACENTE)].map((m) => m[1]! + (m[2] ?? ''));
      if (valores.length < 2) continue;

      const clsIdx = line.indexOf(classificacao);
      const antes = line.slice(0, clsIdx).trim();
      const depois = line.slice(clsIdx + classificacao.length).trim();

      const codigoMatch = antes.match(/\b(\d{4,7})\b\s*$/);
      const codigo = codigoMatch?.[1] ?? '';

      // Remove número + sufixo D/C JUNTOS (RE_MOEDA_DC) — `RE_MOEDA` sozinho
      // apagava só o número e deixava o "D"/"C" de valores do MEIO da lista
      // (ex.: Saldo Anterior "248.140,50D") solto colado na descrição, então
      // só o último resíduo (regex de trailing) era limpo e o nome saía como
      // "CONTAS A RECEBER D" em vez de "CONTAS A RECEBER".
      const nome = depois
        .replace(RE_MOEDA_DC, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      let saldoInicial = 0;
      let debito = 0;
      let credito = 0;
      let saldoFinal = 0;
      let naturezaSaldoInicial: 'D' | 'C' | undefined;
      let naturezaSaldoFinal: 'D' | 'C' | undefined;

      if (valores.length >= 4) {
        // Tenta duas ordens: visual (SI, Deb, Cred, SF) ou Domínio (SF, Cred, Deb, SI)
        const ordem1 = {
          si: parseValorDc(valores[0]),
          deb: parseValorDc(valores[1]),
          cred: parseValorDc(valores[2]),
          sf: parseValorDc(valores[3]),
        };
        const ordem2 = {
          sf: parseValorDc(valores[0]),
          cred: parseValorDc(valores[1]),
          deb: parseValorDc(valores[2]),
          si: parseValorDc(valores[3]),
        };
        // Usa a prova real: SI + Deb - Cred = SF (com sinais D/C)
        const proveiaOrdem1 =
          Math.abs(
            (ordem1.si.valor * (ordem1.si.natureza === 'C' ? -1 : 1)) +
              ordem1.deb.valor -
              ordem1.cred.valor -
              (ordem1.sf.valor * (ordem1.sf.natureza === 'C' ? -1 : 1)),
          ) < 0.01;
        const proveiaOrdem2 =
          Math.abs(
            (ordem2.si.valor * (ordem2.si.natureza === 'C' ? -1 : 1)) +
              ordem2.deb.valor -
              ordem2.cred.valor -
              (ordem2.sf.valor * (ordem2.sf.natureza === 'C' ? -1 : 1)),
          ) < 0.01;

        const melhorOrdem = proveiaOrdem1 || !proveiaOrdem2 ? ordem1 : ordem2;
        saldoInicial = melhorOrdem.si.valor;
        naturezaSaldoInicial = melhorOrdem.si.natureza;
        debito = melhorOrdem.deb.valor;
        credito = melhorOrdem.cred.valor;
        saldoFinal = melhorOrdem.sf.valor;
        naturezaSaldoFinal = melhorOrdem.sf.natureza;
      } else if (valores.length === 2) {
        debito = parseValorDc(valores[0]).valor;
        credito = parseValorDc(valores[1]).valor;
      } else {
        const sf = parseValorDc(valores[valores.length - 1]);
        saldoFinal = sf.valor;
        naturezaSaldoFinal = sf.natureza;
      }

      if (!nome && !codigo) continue;

      ordem += 1;
      out.push({
        codigo,
        classificacao,
        nome: nome || '—',
        ordem,
        saldoInicial,
        naturezaSaldoInicial,
        debito,
        credito,
        saldoFinal,
        naturezaSaldoFinal,
      });
      continue;
    }

    // ─── Formato 2: Domínio balancete PDF (valores espaçados) ──────────────
    // Linha típica (após extração por Y/X):
    //   "230.199,52D 9.536,34 19.779,94 219.955,92D 1 ATIVO"
    // Ordem dos valores: [SaldoAtual(D/C), Crédito, Débito, SaldoAnterior(D/C)]
    // Após os valores: código curto (1-7 dígitos) + descrição.
    const domMatch = line.match(
      /^(\d[\d.]*,\d{2}\s?[DC]?)\s+(\d[\d.]*,\d{2}\s?[DC]?)\s+(\d[\d.]*,\d{2}\s?[DC]?)\s+(\d[\d.]*,\d{2}\s?[DC]?)\s+(\d{1,7})\s+(.+)$/i,
    );
    if (domMatch) {
      const v = interpretaValoresBalancete(
        [domMatch[1]!, domMatch[2]!, domMatch[3]!, domMatch[4]!],
        'dominio',
      );
      pushRow(domMatch[5]!, domMatch[6]!.trim(), v);
      continue;
    }

    // ─── Formato 4: Código + Classificação + Descrição + 4 valores ─────────
    // Relatórios com as colunas "Código | Classificação | Descrição da conta |
    // Saldo Anterior | Débito | Crédito | Saldo Atual" separadas (Código é um
    // sequencial interno, Classificação é o código pontuado). Checado ANTES
    // do Formato 3 (mais genérico: só código + descrição) porque senão o
    // Formato 3 casa primeiro e engole o token de classificação dentro da
    // descrição (ex.: "1 1 ATIVO..." virava nome "1 ATIVO" em vez de
    // classificação "1" + nome "ATIVO"). Sem âncora `^` de propósito: o PDF
    // costuma repetir a descrição da conta (rótulo de grupo) COLADA antes do
    // código nessa linha — "ATIVO CIRCULANTE 2 1.1 ATIVO CIRCULANTE
    // 248.710,60D ..." — e exigir que a classificação seja só dígitos/pontos
    // filtra automaticamente esse lixo à esquerda (nenhum número solto
    // dentro do rótulo/descrição bate "dígitos + dígitos.pontos" seguido de
    // descrição terminando exatamente nos 4 valores do fim).
    // `(?<!\d)` antes do código: sem isso, quando o rótulo duplicado gruda um
    // número de referência (conta/agência) direto no código real sem espaço
    // (ex.: "...CC: 1920531839 1.1.1.02.00002 ...", onde "192053183" é a
    // conta e "9" é o código de verdade), o regex podia casar um SUFIXO de 7
    // dígitos desse número colado como se fosse o código da conta.
    const codClsMatch = line.match(
      /(?<!\d)(\d{1,7})\s+(\d[\d.]*)\s+(\S.*?)\s+(\d[\d.]*,\d{2}\s?[DC]?)\s+(\d[\d.]*,\d{2}\s?[DC]?)\s+(\d[\d.]*,\d{2}\s?[DC]?)\s+(\d[\d.]*,\d{2}\s?[DC]?)$/i,
    );
    if (codClsMatch) {
      const v = interpretaValoresBalancete(
        [codClsMatch[4]!, codClsMatch[5]!, codClsMatch[6]!, codClsMatch[7]!],
        'visual',
      );
      pushRow(codClsMatch[1]!, codClsMatch[3]!.trim(), v, codClsMatch[2]!);
      continue;
    }

    // ─── Formato 3: ordem visual — código + descrição + 4 valores no fim ───
    //   "1 ATIVO 219.955,92D 19.779,94 9.536,34 230.199,52D"
    // Ordem dos valores: [SaldoAnterior(D/C), Débito, Crédito, SaldoAtual(D/C)].
    const visMatch = line.match(
      /^(\d{1,7})\s+(.+?)\s+(\d[\d.]*,\d{2}\s?[DC]?)\s+(\d[\d.]*,\d{2}\s?[DC]?)\s+(\d[\d.]*,\d{2}\s?[DC]?)\s+(\d[\d.]*,\d{2}\s?[DC]?)$/i,
    );
    if (visMatch) {
      const v = interpretaValoresBalancete(
        [visMatch[3]!, visMatch[4]!, visMatch[5]!, visMatch[6]!],
        'visual',
      );
      pushRow(visMatch[1]!, visMatch[2]!.trim(), v);
      continue;
    }

    // ─── Formato 2b: mesma estrutura mas valores colados (sem espaço) ──────
    // Quando o PDF não separa os itens por espaço suficiente:
    //   "230.199,52D9.536,3419.779,94219.955,92D1  ATIVO"
    // As 4 PRIMEIRAS moedas são as colunas do balancete; o que vem depois é
    // código + descrição — números na descrição (ex.: "Nº 2104538") nunca
    // podem ser confundidos com coluna de valor.
    const allDc = [...line.matchAll(RE_MOEDA_DC)];
    if (allDc.length >= 4) {
      const quarto = allDc[3]!;
      const fimValores = (quarto.index ?? 0) + quarto[0].length;
      const resto = line.slice(fimValores).trim();
      const codNome = splitCodigoNomeBalancete(resto);
      if (codNome) {
        const v = interpretaValoresBalancete(
          allDc.slice(0, 4).map((m) => m[0]),
          'dominio',
        );
        pushRow(codNome.codigo, codNome.nome, v);
      }
    }
  }

  return out;
}

async function extractPdfPlainText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  const parts: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // Agrupa itens por Y (linha visual) e ordena por X dentro de cada linha —
    // sem isso tudo vira UMA linha por página e o parser de balancete não
    // consegue separar as contas.
    type Item = { str: string; x: number; y: number; w: number };
    const items: Item[] = [];
    for (const it of content.items) {
      if (!('str' in it)) continue;
      const s = String(it.str);
      if (!s.trim()) continue;
      const tr = it.transform as number[];
      items.push({
        str: s,
        x: tr[4] ?? 0,
        y: tr[5] ?? 0,
        w: typeof it.width === 'number' ? it.width : 0,
      });
    }
    if (!items.length) continue;
    // Clusteriza por Y com tolerância maior (5 unidades para PDFs com fontes variadas).
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: Item[][] = [];
    let cur: Item[] = [items[0]!];
    let curY = items[0]!.y;
    for (let i = 1; i < items.length; i++) {
      if (Math.abs(items[i]!.y - curY) <= 5) {
        cur.push(items[i]!);
      } else {
        lines.push(cur);
        cur = [items[i]!];
        curY = items[i]!.y;
      }
    }
    lines.push(cur);
    for (const ln of lines) {
      ln.sort((a, b) => a.x - b.x);
      // Recorte fiel ao print do PDF: item contíguo ao anterior (número que o
      // gerador quebrou em dois pedaços) fica colado; avanço real vira espaço.
      let text = '';
      let prev: Item | null = null;
      for (const it of ln) {
        if (!prev) {
          text = it.str;
        } else {
          const gap = it.x - (prev.x + prev.w);
          text += prev.w > 0 && gap <= 2 ? it.str : ` ${it.str}`;
        }
        prev = it;
      }
      text = text.replace(/\s+/g, ' ').trim();
      if (text) parts.push(text);
    }
  }
  return parts.join('\n');
}

/** Carrega linhas de balancete/razão a partir de Excel, TXT Domínio ou PDF. */
export async function parseNotaExplicativaBalanceteFile(
  file: File,
): Promise<{ rows: VisionBalanceteRow[]; logs: string[] }> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const logs: string[] = [];

  if (['xlsx', 'xls', 'csv'].includes(ext)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const rawRows = readSpreadsheetGrid(bytes);
    if (isBalanceteModelo(rawRows)) {
      const rows = parseBalanceteSheet(rawRows).filter(isValidRazaoLinha);
      if (!rows.length) throw new Error('Nenhuma conta válida no balancete Excel.');
      logs.push(`Balancete Excel: ${rows.length} conta(s).`);
      return { rows, logs };
    }
    if (isRazaoModelo(rawRows)) {
      const rows = parseRazaoSheet(rawRows).filter(isValidRazaoLinha);
      if (!rows.length) throw new Error('Nenhum lançamento válido na planilha de razão.');
      logs.push(`Razão Excel: ${rows.length} lançamento(s) — será consolidado por conta.`);
      return { rows, logs };
    }
    const bal = parseBalanceteSheet(rawRows).filter(isValidRazaoLinha);
    if (bal.length > 0) {
      logs.push(`Planilha interpretada como balancete: ${bal.length} conta(s).`);
      return { rows: bal, logs };
    }
    const raz = parseRazaoSheet(rawRows).filter(isValidRazaoLinha);
    if (!raz.length) throw new Error('Formato não reconhecido. Use balancete ou razão Domínio em Excel.');
    logs.push(`Planilha interpretada como razão: ${raz.length} lançamento(s).`);
    return { rows: raz, logs };
  }

  if (ext === 'txt' || ext === 'sped') {
    const text = await readTextFileSmart(file);
    if (isDominioLancamentosTxt(text)) {
      const rows = parseDominioLancamentosTxt(text).filter(isValidRazaoLinha);
      if (!rows.length) throw new Error('TXT Domínio sem lançamentos válidos.');
      logs.push(`TXT Domínio (lançamentos): ${rows.length} linha(s) — consolidando por conta.`);
      return { rows, logs };
    }
    const rows = parseBalanceteTextLines(text.split(/\r?\n/)).filter(isValidRazaoLinha);
    if (!rows.length) {
      throw new Error(
        'TXT não reconhecido. Use exportação Domínio (Utilitários > Lançamentos) ou relatório de balancete.',
      );
    }
    logs.push(`Relatório TXT: ${rows.length} conta(s).`);
    return { rows, logs };
  }

  if (ext === 'pdf') {
    const text = await extractPdfPlainText(file);
    const linhas = text.split(/\r?\n/);
    logs.push(`PDF: ${linhas.length} linha(s) extraída(s) do arquivo.`);
    const rows = parseBalanceteTextLines(linhas);
    logs.push(`Parser: ${rows.length} linha(s) reconhecida(s) (antes do filtro).`);
    const rowsFiltradas = rows.filter(isValidRazaoLinha);
    logs.push(`Filtro: ${rowsFiltradas.length} linha(s) válida(s) (após validação).`);
    if (!rowsFiltradas.length) {
      if (rows.length > 0) {
        throw new Error(
          `PDF tem ${rows.length} linha(s) que foram reconhecidas mas rejeitadas pelo filtro de validação. Verifique se cada conta tem código/classificação, descrição e pelo menos um valor (saldo ou movimento).`,
        );
      }
      throw new Error(
        'PDF sem linhas de balancete reconhecível. Exporte o balancete em PDF (texto nativo) pelo Sistema Domínio Contabilidade.',
      );
    }
    logs.push(`PDF (texto nativo): ${rowsFiltradas.length} conta(s) importada(s).`);

    // Debug: mostrar primeiras 5 contas com seus saldoInicial
    const primeirasCinco = rowsFiltradas.slice(0, 5);
    for (const r of primeirasCinco) {
      logs.push(
        `DEBUG: ${r.codigo} "${r.nome.substring(0, 30)}" → SI=${r.saldoInicial} Nat=${r.naturezaSaldoInicial || 'N/A'} D=${r.debito} C=${r.credito}`
      );
    }

    return { rows: rowsFiltradas, logs };
  }

  throw new Error('Formato não suportado. Use Excel (.xlsx/.xls), TXT Domínio ou PDF com texto.');
}
