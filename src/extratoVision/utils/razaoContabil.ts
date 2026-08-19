import type { VisionBalanceteRow, VisionPlanoRow } from '../types/accounting';
import { isCnpjLike } from '../../lib/cnpjGuard';
import {
  compareClassificacaoContabil,
  getClassificacao,
  resolveTipoConta,
  sortRowsByClassificacao,
} from './demonstracoesContabeis';
import { parseBrDateToTime } from './dateBounds';
import { buildRowKey, recalcularSaldoFinalRow } from './mergeRazaoSaldoInicial';
import {
  sliceRazaoIndexBefore,
  sliceRazaoIndexByPeriod,
  type RazaoTimeIndex,
} from './razaoTimeIndex';

export { buildRazaoTimeIndex, shouldIndexRazao } from './razaoTimeIndex';

/**
 * Chave de classificação estável entre importações: remove pontos/espaços e
 * zeros à esquerda de cada segmento (ex.: "1.1.2.04.0006" e "1.1.2.4.6" devem
 * casar na mesma conta). Sem isso, uma conta cujo código veio grafado de
 * formas diferentes em importações distintas tinha seu histórico dividido em
 * duas chaves, deixando um resíduo de saldo inicial que não deveria existir
 * (ver bug do saldo "INVERTIDA" em contas com saldo final zerado).
 */
export function normCls(cls: string): string {
  return cls
    .replace(/\s/g, '')
    .split('.')
    .map((seg) => seg.replace(/^0+(?=\d)/, ''))
    .join('');
}

function normReducedCode(code: string): string {
  const digits = code.replace(/\D/g, '');
  if (!digits) return '';
  const normalized = digits.replace(/^0+/, '');
  return normalized || '0';
}

/** Mapas O(1) para lookup do plano (evita .find em cada lançamento). */
export type PlanoLookup = {
  byCls: Map<string, VisionPlanoRow>;
  byReduced: Map<string, VisionPlanoRow>;
};

export function buildPlanoLookup(planoRows: VisionPlanoRow[]): PlanoLookup {
  const byCls = new Map<string, VisionPlanoRow>();
  const byReduced = new Map<string, VisionPlanoRow>();
  for (const p of planoRows) {
    // Use classificação original (com pontos) para evitar colisões de normalização
    const cls = (p.codigo || '').trim();
    if (cls && !byCls.has(cls)) byCls.set(cls, p);
    if (p.codigoReduzido) {
      const red = normReducedCode(p.codigoReduzido);
      if (red && !byReduced.has(red)) byReduced.set(red, p);
    }
  }
  return { byCls, byReduced };
}

export function findPlanoRow(
  row: VisionBalanceteRow,
  planoRows: VisionPlanoRow[],
  lookup?: PlanoLookup,
): VisionPlanoRow | undefined {
  const rawCls = getClassificacao(row);
  const cls = (rawCls || '').trim();

  // PRIORIDADE 1: Classificação estruturada (com pontos) é busca exata no plano
  if (cls.includes('.')) {
    if (lookup) {
      const hit = lookup.byCls.get(cls);
      if (hit) return hit;
    }
    // Sem lookup, busca linear exata
    return planoRows.find((p) => (p.codigo || '').trim() === cls);
  }

  // PRIORIDADE 2: Se o lançamento tem código reduzido, busca EXATO no plano (sem normalização)
  const rawCode = (row.codigo || '').trim();
  if (rawCode && !rawCode.includes('.')) {
    // Busca exata por código reduzido
    if (lookup) {
      // Normaliza para lookup (já construído com normReducedCode)
      const normalized = normReducedCode(rawCode.replace(/\D/g, ''));
      if (normalized) {
        const hit = lookup.byReduced.get(normalized);
        if (hit) return hit;
      }
    } else {
      // Busca linear exata
      return planoRows.find((p) =>
        p.codigoReduzido && normReducedCode(p.codigoReduzido) === normReducedCode(rawCode)
      );
    }
  }

  // PRIORIDADE 3: Grupos de topo curtos (1-2 dígitos)
  if (cls.length > 0 && cls.length <= 2) {
    if (lookup) {
      const hit = lookup.byCls.get(cls);
      if (hit) return hit;
    }
    return planoRows.find((p) => (p.codigo || '').trim() === cls);
  }

  return undefined;
}

/** Chaves de conta pré-computadas para checar pertencimento em O(1) via `contaMatchesKeys`. */
export type ContaMatchKeys = { byCls: Set<string>; byReduced: Set<string> };

/**
 * Monta as chaves de um conjunto de contas (plano, ou contas "pendentes de
 * renomear") respeitando a mesma disciplina de `findPlanoRow`: um código com
 * pontos (ou grupo de topo de 1-2 dígitos) só entra na chave de classificação;
 * um código solto (sem pontos, 3+ dígitos) é tratado como reduzido. Nunca deixa
 * um código solto entrar na chave de classificação — é isso que causava a
 * colisão reduzido×classificação (ver comentário em `findPlanoRow`).
 */
/** Adiciona as chaves de uma conta a um `ContaMatchKeys` já existente (mesma disciplina de `buildContaMatchKeys`). */
export function addContaToMatchKeys(
  keys: ContaMatchKeys,
  conta: { code?: string; codigoReduzido?: string },
): void {
  const codeRaw = (conta.code ?? '').trim();
  if (codeRaw) {
    const estruturada = codeRaw.includes('.');
    const grupoCurto = !estruturada && codeRaw.length > 0 && codeRaw.length <= 2;
    if (estruturada || grupoCurto) {
      keys.byCls.add(codeRaw);
      // Também armazena a versão normalizada (sem zeros de padding por segmento) para
      // que "1.1.1.02.01109" e "1.1.1.2.1109" se reconheçam como a mesma conta.
      keys.byCls.add(normCls(codeRaw));
    } else {
      const redDigits = normReducedCode(codeRaw);
      if (redDigits) keys.byReduced.add(redDigits);
    }
  }
  const redField = normReducedCode(conta.codigoReduzido ?? '');
  if (redField) keys.byReduced.add(redField);
}

export function buildContaMatchKeys(
  contas: Array<{ code?: string; codigoReduzido?: string }>,
): ContaMatchKeys {
  const keys: ContaMatchKeys = { byCls: new Set(), byReduced: new Set() };
  for (const c of contas) addContaToMatchKeys(keys, c);
  return keys;
}

/** Verifica se uma linha (classificacao/codigo) casa com alguma das chaves montadas por `buildContaMatchKeys`. */
export function contaMatchesKeys(
  row: { classificacao?: string; codigo?: string },
  keys: ContaMatchKeys,
): boolean {
  const rawCls = (row.classificacao ?? '').trim();
  if (rawCls) {
    const estruturada = rawCls.includes('.');
    const grupoCurto = !estruturada && rawCls.length > 0 && rawCls.length <= 2;
    if (estruturada || grupoCurto) {
      // Verifica tanto a chave exata quanto a chave normalizada (sem zeros de padding
      // por segmento) — ex.: "1.1.1.02.01109" e "1.1.1.2.1109" representam a mesma conta.
      if (keys.byCls.has(rawCls) || keys.byCls.has(normCls(rawCls))) return true;
    }
  }
  const reduced = normReducedCode(row.codigo ?? '');
  if (reduced && keys.byReduced.has(reduced)) return true;
  return false;
}

function enrichNomeDoPlano(
  row: VisionBalanceteRow,
  planoRows: VisionPlanoRow[],
  lookup?: PlanoLookup,
): VisionBalanceteRow {
  const plano = findPlanoRow(row, planoRows, lookup);

  // Se encontrou no plano, usa a classificação do plano
  if (plano) {
    return {
      ...row,
      nome: row.nome?.trim() ? row.nome : plano.nome,
      classificacao: plano.codigo,
      codigo: row.codigo?.trim() ? row.codigo : (plano.codigoReduzido ?? plano.codigo),
    };
  }

  // Se NÃO encontrou no plano mas tem código, tenta buscar diretamente por código/reduzido
  const codigo = (row.codigo || '').trim();
  if (codigo) {
    // Busca direto no plano por código exato
    const encontrado = planoRows.find(
      (p) => (p.codigo || '').trim() === codigo ||
             (p.codigoReduzido || '').trim() === codigo
    );
    if (encontrado) {
      return {
        ...row,
        nome: row.nome?.trim() ? row.nome : encontrado.nome,
        classificacao: encontrado.codigo,
        codigo: row.codigo?.trim() ? row.codigo : (encontrado.codigoReduzido ?? encontrado.codigo),
      };
    }
  }

  // Se ainda não encontrou e classificação tem descrição misturada, limpa
  const cls = (row.classificacao || '').trim();
  if (cls && !cls.includes('.')) {
    // Classificação sem pontos é suspeita (pode ser descrição)
    return { ...row, classificacao: undefined };
  }

  return row;
}

function isNomeGrupoSintetico(nome: string): boolean {
  const n = nome.trim();
  if (n.length < 3) return false;
  return n === n.toUpperCase() && /[A-ZÁÉÍÓÚÃÕÇ]/.test(n) && !/[a-záéíóúãõç]/.test(n);
}

/** Remove contas sintéticas — totais vêm do plano de contas (CPC). */
export function filtrarContasAnaliticas(
  linhas: VisionBalanceteRow[],
  planoRows: VisionPlanoRow[] = [],
  lookup?: PlanoLookup,
): VisionBalanceteRow[] {
  const planoLookup = lookup ?? (planoRows.length > 0 ? buildPlanoLookup(planoRows) : undefined);
  const enriched = linhas.map((r) => enrichNomeDoPlano(r, planoRows, planoLookup));

  return enriched.filter((r) => {
    // Linhas de saldo de abertura ("SALDO ANTERIOR" / "SALDO INICIAL") nunca são
    // sintéticas — elas marcam o saldo anterior de uma conta analítica e devem
    // sempre passar pelo filtro para que montarBalanceteComPeriodo as leia.
    if (isHistoricoSaldoInicialRazao(r.nome)) return true;

    // Linha com movimento real (débito/crédito) é sempre um lançamento, nunca uma
    // conta sintética — mesmo que o histórico esteja em CAIXA ALTA (ex.: "ENCERRAMENTO
    // DO EXERCÍCIO", "APURAÇÃO DE COMP 12/2023"). O heurístico de nome abaixo foi feito
    // para nome de CONTA (plano de contas), não para histórico de lançamento do razão —
    // aplicá-lo a histórico descartava lançamentos de zeramento reais do balancete.
    const temMovimento = (r.debito ?? 0) > 0 || (r.credito ?? 0) > 0;
    if (planoRows.length > 0) {
      const plano = findPlanoRow(r, planoRows, planoLookup);
      if (plano?.tipo === 'S') return false;
      if (plano?.tipo === 'A') return true;
      if (temMovimento) return true;
      return resolveTipoConta(r, enriched, planoRows) === 'A';
    }
    if (temMovimento) return true;
    if (isNomeGrupoSintetico(r.nome ?? '')) return false;
    if (r.tipo === 'S') return false;
    return true;
  });
}

/** @deprecated use filtrarContasAnaliticas */
export const filtrarLinhasAnaliticasRazao = filtrarContasAnaliticas;

/** Compara datas DD/MM/AAAA ou ISO YYYY-MM-DD (cronológica). */
export function compareDataRazao(a?: string, b?: string): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const na = parseDataRazao(a) || a;
  const nb = parseDataRazao(b) || b;
  const ta = parseBrDateToTime(na);
  const tb = parseBrDateToTime(nb);
  if (ta !== null && tb !== null) return ta - tb;
  return na.localeCompare(nb);
}

function valorMovimentoRazao(n: unknown): number {
  if (typeof n === 'number') return Number.isFinite(n) ? Math.abs(n) : 0;
  if (typeof n === 'string') {
    const t = n.trim().replace(/\s/g, '');
    if (!t) return 0;
    const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
    const v = Math.abs(parseFloat(normalized));
    return Number.isFinite(v) ? v : 0;
  }
  return 0;
}

export function isHistoricoSaldoInicialRazao(nome?: string): boolean {
  const n = (nome ?? '').trim();
  if (!n) return false;
  return /saldo\s*(?:inicial|anterior)|referente\s+saldo|^\s*s\.?\s*i\.?\s*$/i.test(n);
}

function anoDaDataRazao(data: string): number | null {
  const br = parseDataRazao(data) || data;
  const t = parseBrDateToTime(br);
  if (t === null) return null;
  return new Date(t).getFullYear();
}

/**
 * Menor e maior data com lançamento real (D ou C > 0) no razão (DD/MM/AAAA).
 * Ignora saldo inicial e anos-fantasma (ex.: 2001 com quase nada quando o movimento é 2026).
 * De/Até amplo no filtro continua válido — as colunas usam só meses com lançamento.
 */
export function extrairPeriodoRazao(linhas: VisionBalanceteRow[]): { min?: string; max?: string } {
  const candidatos: { data: string; ano: number; mov: number }[] = [];
  for (const r of linhas) {
    if (isHistoricoSaldoInicialRazao(r.nome)) continue;
    const raw = r.data?.trim();
    if (!raw) continue;
    const deb = valorMovimentoRazao(r.debito);
    const cred = valorMovimentoRazao(r.credito);
    if (deb < 0.01 && cred < 0.01) continue;
    const data = parseDataRazao(raw) || raw;
    const ano = anoDaDataRazao(data);
    if (ano === null) continue;
    candidatos.push({ data, ano, mov: deb + cred });
  }
  if (!candidatos.length) return {};

  const porAno = new Map<number, number>();
  for (const c of candidatos) {
    porAno.set(c.ano, (porAno.get(c.ano) ?? 0) + c.mov);
  }
  let anoPrincipal = 0;
  let maxMov = 0;
  for (const [ano, mov] of porAno) {
    if (mov > maxMov) {
      maxMov = mov;
      anoPrincipal = ano;
    }
  }
  const limiar = maxMov * 0.01;
  const anosOk = new Set<number>();
  for (const [ano, mov] of porAno) {
    const dist = Math.abs(ano - anoPrincipal);
    if (porAno.size === 1 || dist <= 1 || mov >= limiar) anosOk.add(ano);
  }

  const datas = candidatos.filter((c) => anosOk.has(c.ano)).map((c) => c.data);
  if (!datas.length) return {};
  const sorted = [...datas].sort(compareDataRazao);
  return { min: sorted[0], max: sorted[sorted.length - 1] };
}

export type MontarBalanceteCtx = {
  razaoIndex?: RazaoTimeIndex;
  planoLookup?: PlanoLookup;
};

/** Filtra lançamentos por intervalo (DD/MM/AAAA). De/até opcionais — aberto se omitido. */
export function filtrarRazaoPorPeriodo(
  linhas: VisionBalanceteRow[],
  de?: string,
  ate?: string,
  razaoIndex?: RazaoTimeIndex,
): VisionBalanceteRow[] {
  const fromStr = de?.trim() ?? '';
  const toStr = ate?.trim() ?? '';
  if (razaoIndex && (fromStr || toStr)) {
    return sliceRazaoIndexByPeriod(razaoIndex, de, ate);
  }
  if (!fromStr && !toStr) return linhas;

  let fTime = 0;
  let tTime = Number.MAX_SAFE_INTEGER;

  if (fromStr) {
    const t = parseBrDateToTime(fromStr);
    if (t !== null) fTime = t;
  }
  if (toStr) {
    const t = parseBrDateToTime(toStr);
    if (t !== null) tTime = t;
  }
  if (fTime > tTime) [fTime, tTime] = [tTime, fTime];

  return linhas.filter((r) => {
    if (!r.data?.trim()) return false;
    const dTime = parseBrDateToTime(r.data);
    if (dTime === null) return false;
    return dTime >= fTime && dTime <= tTime;
  });
}

/** Lançamentos estritamente anteriores à data (para saldo inicial do período). */
export function filtrarRazaoAntesDe(
  linhas: VisionBalanceteRow[],
  dataInicio?: string,
  razaoIndex?: RazaoTimeIndex,
): VisionBalanceteRow[] {
  const de = dataInicio?.trim() ?? '';
  if (!de) return [];
  if (razaoIndex) return sliceRazaoIndexBefore(razaoIndex, dataInicio);
  const deTime = parseBrDateToTime(de);
  if (deTime === null) return [];
  return linhas.filter((r) => {
    if (!r.data?.trim()) return false;
    const t = parseBrDateToTime(r.data);
    return t !== null && t < deTime;
  });
}

function liquidoMovimentoParaSaldo(
  debito: number,
  credito: number,
): Pick<VisionBalanceteRow, 'saldoInicial' | 'naturezaSaldoInicial'> {
  const liq = debito - credito;
  if (Math.abs(liq) < 0.001) return { saldoInicial: 0, naturezaSaldoInicial: undefined };
  return {
    saldoInicial: Math.abs(liq),
    naturezaSaldoInicial: liq > 0 ? 'D' : 'C',
  };
}

/** Saldo inicial com sinal (+ devedor, − credor) — para somar corretamente entre contas. */
function siAssinado(r: Pick<VisionBalanceteRow, 'saldoInicial' | 'naturezaSaldoInicial'>): number {
  const si = r.saldoInicial ?? 0;
  if (Math.abs(si) < 1e-9) return 0;
  return r.naturezaSaldoInicial === 'C' ? -Math.abs(si) : Math.abs(si);
}

export function chaveContaRazao(r: VisionBalanceteRow): string {
  const cls = (getClassificacao(r) || '').trim();
  // Normaliza (remove zeros de padding por segmento) para que a mesma conta grafada de
  // formas diferentes entre a importação do razão e a do Balancete/Saldo Anterior
  // Domínio (ex.: "1.1.2.04.0006" vs "1.1.2.4.6") caia na mesma chave — senão o saldo
  // inicial importado nunca casa com a conta do período e simplesmente não aparece.
  return cls ? `cls:${normCls(cls)}` : buildRowKey(r);
}

/** Balancete do período: SI = movimentos anteriores; D/C = no intervalo; SF recalculado. */
function ehLinhasCNPJ(row: VisionBalanceteRow): boolean {
  // Só código/classificação definem se isto é uma "conta" — nunca o nome/histórico,
  // que é texto livre e pode legitimamente citar um CNPJ (ex.: "Pix Recebido ...
  // 58952046000190 POLO S CLIM" é um lançamento real, não um cabeçalho vazado).
  return isCnpjLike(row.codigo) || isCnpjLike(row.classificacao);
}

export function montarBalanceteComPeriodo(
  todasLinhas: VisionBalanceteRow[],
  linhasNoPeriodo: VisionBalanceteRow[],
  planoRows: VisionPlanoRow[],
  dataInicio?: string,
  dataFim?: string,
  ctx?: MontarBalanceteCtx,
): VisionBalanceteRow[] {
  const planoLookup = ctx?.planoLookup ?? (planoRows.length > 0 ? buildPlanoLookup(planoRows) : undefined);
  const razaoIndex = ctx?.razaoIndex;

  // Filtra linhas que são CNPJ (não são contas)
  const linhasNoPeriodoFiltrado = linhasNoPeriodo.filter((r) => !ehLinhasCNPJ(r));
  const todasLinhasFiltrado = todasLinhas.filter((r) => !ehLinhasCNPJ(r));

  const analiticasPeriodo = filtrarContasAnaliticas(linhasNoPeriodoFiltrado, planoRows, planoLookup);
  const aggPeriodo = agregarRazaoPorConta(analiticasPeriodo, planoRows, planoLookup);

  // Com razaoIndex, filtrarRazaoAntesDe fatia o ÍNDICE (construído sobre o razão
  // cru) e ignora o array filtrado — refiltra o resultado, senão a linha de CNPJ
  // volta como "saldo anterior" e ressuscita o grupo pai (ex.: sintética "4").
  // filtrarContasAnaliticas já devolve as linhas ENRIQUECIDAS pelo plano — as
  // chaves batem com as de agregarRazaoPorConta.
  const linhasAntes = filtrarContasAnaliticas(
    filtrarRazaoAntesDe(todasLinhasFiltrado, dataInicio, razaoIndex).filter(
      (r) => !ehLinhasCNPJ(r),
    ),
    planoRows,
    planoLookup,
  );

  const deTime = dataInicio ? parseBrDateToTime(dataInicio) : null;

  // Saldo de abertura: linhas "SALDO ANTERIOR" / "SALDO INICIAL" guardam o saldo em `saldoInicial`
  // (deb/cred = 0). Usamos o SI MAIS RECENTE de cada conta — ele representa o
  // saldo de abertura correto para o período atual. O SI antigo (ex.: 2024)
  // já foi "absorvido" pelos movimentos daquele ano; usá-lo como base em vez
  // do SI recente (ex.: 2025) fazia o saldo anterior de 2026 mostrar o valor
  // de 2024 em vez do saldo final of 2025.
  const siAberturaMap = new Map<string, { t: number; v: number }>();
  for (const bruta of todasLinhasFiltrado) {
    if (!isHistoricoSaldoInicialRazao(bruta.nome)) continue;
    const si = bruta.saldoInicial ?? 0;
    if (si <= 0) continue;
    const t = parseBrDateToTime(bruta.data ?? '');
    if (t === null) continue;
    if (deTime !== null && t > deTime) continue; // must be <= dataInicio
    // Enriquece pelo plano ANTES de gerar a chave: o relatório "Balancete" do
    // Domínio não tem coluna de classificação, então a linha "SALDO ANTERIOR"
    // importada chega com `classificacao` = código reduzido ("1065"), enquanto
    // as linhas do razão (que passam por filtrarContasAnaliticas, o qual
    // enriquece) usam a classificação real ("1.1.1.02.00003"). Sem enriquecer
    // aqui, as duas grafias viravam chaves diferentes: o SI ficava órfão neste
    // mapa e, pior, `linhasAntesSiLimpo` zerava o saldoInicial da linha real
    // por não achá-la no mapa — o saldo anterior sumia da tela inteira.
    const r = enrichNomeDoPlano(bruta, planoRows, planoLookup);
    const key = chaveContaRazao(r);
    if (!key) continue;
    const v = r.naturezaSaldoInicial === 'C' ? -si : si;
    const cur = siAberturaMap.get(key);
    if (!cur || t > cur.t) siAberturaMap.set(key, { t, v });
  }

  // Zera o saldoInicial das linhas de SI que NÃO são a mais recente — caso
  // contrário agregarRazaoPorConta acumula todos os SI (um por importação) e
  // o saldo anterior do razão fica inflado/duplicado.
  const linhasAntesSiLimpo = linhasAntes.map((r) => {
    if (!isHistoricoSaldoInicialRazao(r.nome)) return r;
    const key = chaveContaRazao(r);
    const t = parseBrDateToTime(r.data ?? '');
    const latest = key ? siAberturaMap.get(key) : undefined;
    if (latest && t !== null && t === latest.t) return r;
    return { ...r, saldoInicial: 0, naturezaSaldoInicial: undefined } as VisionBalanceteRow;
  });
  const aggAntes = agregarRazaoPorConta(linhasAntesSiLimpo, planoRows, planoLookup);

  // Saldo anterior = SI mais recente + movimentos entre o SI e o início do período.
  // Fórmula: total = SI_registrado + (D - C dos movimentos após a data do SI até dataInicio).
  // Se não há SI registrado: total = SI_agragado + (D - C agregados antes do período).
  const siMap = new Map<string, Pick<VisionBalanceteRow, 'saldoInicial' | 'naturezaSaldoInicial'>>();

  // Coletamos todas as chaves de contas de aggAntes e siAberturaMap
  const todasChavesAntes = new Set<string>();
  for (const r of aggAntes) {
    const key = chaveContaRazao(r);
    if (key) todasChavesAntes.add(key);
  }
  for (const key of siAberturaMap.keys()) {
    todasChavesAntes.add(key);
  }

  // Pré-agrupa movimentos reais (não SI) de linhasAntesSiLimpo por chave para
  // calcular rapidamente os movimentos ocorridos APÓS o SI mais recente.
  const movAntesMap = new Map<string, { debito: number; credito: number; siAssin: number }>();
  for (const r of linhasAntesSiLimpo) {
    const key = chaveContaRazao(r);
    if (!key) continue;
    const cur = movAntesMap.get(key) ?? { debito: 0, credito: 0, siAssin: 0 };
    if (isHistoricoSaldoInicialRazao(r.nome)) {
      // Linha de SI limpa: acumula o SI assinado (só o mais recente passou pelo limpo)
      cur.siAssin += siAssinado(r);
    } else {
      cur.debito += r.debito ?? 0;
      cur.credito += r.credito ?? 0;
    }
    movAntesMap.set(key, cur);
  }

  for (const key of todasChavesAntes) {
    const latest = siAberturaMap.get(key);
    let total = 0;

    if (latest) {
      // SI registrado: base é o valor do SI mais recente.
      // Acrescenta movimentos que aconteceram APÓS a data do SI e ANTES do período.
      // Esses movimentos ficaram em linhasAntesSiLimpo (as linhas de SI duplicadas
      // foram zeradas, portanto só movimentos reais sobram na acumulação de debito/credito).
      const mov = movAntesMap.get(key);
      const movLiquido = mov ? mov.debito - mov.credito : 0;
      total = latest.v + movLiquido;
    } else {
      // Sem SI registrado: usa SI agregado + movimentos (tudo de aggAntes).
      const r = aggAntes.find((x) => chaveContaRazao(x) === key);
      if (r) {
        total = siAssinado(r) + (r.debito - r.credito);
      }
    }
    siMap.set(key, {
      saldoInicial: Math.abs(total),
      naturezaSaldoInicial: Math.abs(total) < 0.001 ? undefined : total > 0 ? 'D' : 'C',
    });
  }

  const keysPeriodo = new Set(aggPeriodo.map((r) => chaveContaRazao(r)).filter(Boolean));
  const dataRef = dataFim?.trim() || dataInicio?.trim();

  const merged: VisionBalanceteRow[] = aggPeriodo.map((r) => {
    const key = chaveContaRazao(r);
    const si = key ? siMap.get(key) : undefined;
    return {
      ...r,
      saldoInicial: si?.saldoInicial ?? 0,
      naturezaSaldoInicial: si?.naturezaSaldoInicial,
      data: dataRef || r.data,
    };
  });

  for (const r of aggAntes) {
    const key = chaveContaRazao(r);
    if (!key || keysPeriodo.has(key)) continue;
    const si = siMap.get(key);
    // Inclui a conta mesmo quando saldoInicial=0: uma conta que movimentou em período
    // anterior e resultou em saldo zero deve aparecer no período atual com SI=0 para
    // que o saldo seja corretamente propagado como saldo anterior.
    merged.push({
      ...r,
      saldoInicial: si?.saldoInicial ?? 0,
      naturezaSaldoInicial: si?.naturezaSaldoInicial,
      debito: 0,
      credito: 0,
      saldoFinal: 0,
      data: dataRef || r.data,
    });
  }

  return montarBalanceteComPlano(merged, planoRows, [], planoLookup);
}

/** Ordem Domínio: data crescente → sequência do lançamento → débito antes do crédito. */
export function sortRowsByDataRazao(rows: VisionBalanceteRow[]): VisionBalanceteRow[] {
  return [...rows].sort((a, b) => {
    const dateDiff = compareDataRazao(a.data, b.data);
    if (dateDiff !== 0) return dateDiff;

    const ordemA = a.ordem ?? Number.MAX_SAFE_INTEGER;
    const ordemB = b.ordem ?? Number.MAX_SAFE_INTEGER;
    if (ordemA !== ordemB) return ordemA - ordemB;

    const ladoA = a.debito > 0 ? 0 : 1;
    const ladoB = b.debito > 0 ? 0 : 1;
    if (ladoA !== ladoB) return ladoA - ladoB;

    return (a.codigo ?? '').localeCompare(b.codigo ?? '', 'pt-BR');
  });
}

/** Agrega lançamentos por conta analítica (chave = classificação canônica). */
export function agregarRazaoPorConta(
  linhas: VisionBalanceteRow[],
  planoRows: VisionPlanoRow[] = [],
  lookup?: PlanoLookup,
): VisionBalanceteRow[] {
  const planoLookup = lookup ?? (planoRows.length > 0 ? buildPlanoLookup(planoRows) : undefined);
  const map = new Map<string, VisionBalanceteRow>();

  for (const raw of linhas) {
    const r = enrichNomeDoPlano(raw, planoRows, planoLookup);
    const clsKey = (getClassificacao(r) || '').trim();
    const key = clsKey ? `cls:${clsKey}` : buildRowKey(r);
    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, {
        codigo: r.codigo,
        classificacao: r.classificacao,
        nome: r.nome,
        saldoInicial: 0,
        debito: 0,
        credito: 0,
        saldoFinal: 0,
        data: r.data,
        naturezaSaldoInicial: r.naturezaSaldoInicial,
        tipo: 'A',
      });
    }

    const target = map.get(key)!;
    target.saldoInicial += r.saldoInicial;
    target.debito += r.debito;
    target.credito += r.credito;
    if (r.nome) target.nome = r.nome;
    if (r.codigo) target.codigo = r.codigo;
    if (r.classificacao) target.classificacao = r.classificacao;
    if (r.naturezaSaldoInicial) target.naturezaSaldoInicial = r.naturezaSaldoInicial;
    if (r.data && (!target.data || compareDataRazao(r.data, target.data) < 0)) {
      target.data = r.data;
    }
  }

  return sortRowsByClassificacao([...map.values()]);
}

function isFilhaDe(paiCls: string, filhaCls: string): boolean {
  const p = (paiCls || '').trim();
  const f = (filhaCls || '').trim();
  if (!p || !f || f === p) return false;
  return f.startsWith(p + '.') && f.length > p.length;
}

function isContaFolha(cls: string, todas: string[]): boolean {
  const n = (cls || '').trim();
  return !todas.some((k) => k !== n && k.startsWith(n + '.') && k.length > n.length);
}

/** Monta balancete único: analíticas importadas + sintéticas calculadas do plano (sem duplicar). */
export function montarBalanceteComPlano(
  mergedRows: VisionBalanceteRow[],
  planoRows: VisionPlanoRow[],
  saldoInicialRows: VisionBalanceteRow[] = [],
  lookup?: PlanoLookup,
): VisionBalanceteRow[] {
  const planoLookup = lookup ?? (planoRows.length > 0 ? buildPlanoLookup(planoRows) : undefined);
  const sinteticasSi = new Map<string, VisionBalanceteRow>();
  for (const raw of saldoInicialRows) {
    const r = enrichNomeDoPlano(raw, planoRows, planoLookup);
    const plano = findPlanoRow(r, planoRows, planoLookup);
    const isSintetica =
      plano?.tipo === 'S' || r.tipo === 'S' || isNomeGrupoSintetico(r.nome ?? '');
    if (!isSintetica) continue;
    const k = (getClassificacao(r) || '').trim();
    if (k) sinteticasSi.set(k, r);
  }

  const analiticas = filtrarContasAnaliticas(mergedRows, planoRows, planoLookup);
  const agregadas = agregarRazaoPorConta(analiticas, planoRows, planoLookup);

  if (planoRows.length === 0) {
    return agregadas.map((r) => recalcularSaldoFinalRow(r));
  }

  const byCls = new Map<string, VisionBalanceteRow>();
  for (const r of agregadas) {
    byCls.set((getClassificacao(r) || '').trim(), r);
  }

  const clsKeys = [...byCls.keys()];
  const folhas = clsKeys.filter((k) => isContaFolha(k, clsKeys));

  const planoUnico = new Map<string, VisionPlanoRow>();
  for (const p of planoRows) {
    const k = (p.codigo || '').trim();
    if (!k) continue;
    if (!planoUnico.has(k)) planoUnico.set(k, p);
  }

  const planoSorted = [...planoUnico.values()].sort((a, b) =>
    compareClassificacaoContabil(a.codigo, b.codigo),
  );

  const result: VisionBalanceteRow[] = [];
  const incluidas = new Set<string>();

  for (const p of planoSorted) {
    const pNorm = (p.codigo || '').trim();
    if (incluidas.has(pNorm)) continue;

    if (p.tipo === 'A') {
      const row = byCls.get(pNorm);
      if (!row) continue;
      result.push(
        recalcularSaldoFinalRow({
          ...row,
          nome: p.nome,
          classificacao: p.codigo,
          codigo: p.codigoReduzido ?? row.codigo,
          tipo: 'A',
          nivel: p.nivel,
        }),
      );
      incluidas.add(pNorm);
      continue;
    }

    if (p.tipo === 'S') {
      const descendentes = folhas
        .filter((k) => isFilhaDe(p.codigo, k))
        .map((k) => byCls.get(k)!)
        .filter(Boolean);

      if (descendentes.length > 0) {
        // Soma o SI com sinal (devedor/credor) de cada filho — somar só a magnitude
        // ignorava a natureza e fazia a sintética "esconder" um saldo já zerado na
        // analítica (ex.: filho credor 43.927,26 virava, por engano, +43.927,26
        // devedor na soma, gerando saldo final diferente de zero na sintética
        // mesmo com a analítica corretamente zerada).
        const siAssinadoTotal = descendentes.reduce((acc, r) => acc + siAssinado(r), 0);
        const totais = descendentes.reduce(
          (acc, r) => ({
            debito: acc.debito + r.debito,
            credito: acc.credito + r.credito,
          }),
          { debito: 0, credito: 0 },
        );

        const datas = descendentes.map((r) => r.data).filter(Boolean) as string[];
        const primeiraData = datas.sort(compareDataRazao)[0];

        result.push(
          recalcularSaldoFinalRow({
            codigo: p.codigoReduzido ?? p.codigo,
            classificacao: p.codigo,
            nome: p.nome,
            saldoInicial: Math.abs(siAssinadoTotal),
            naturezaSaldoInicial:
              Math.abs(siAssinadoTotal) < 1e-9 ? undefined : siAssinadoTotal > 0 ? 'D' : 'C',
            debito: totais.debito,
            credito: totais.credito,
            saldoFinal: 0,
            data: primeiraData,
            tipo: 'S',
            nivel: p.nivel,
          }),
        );
        incluidas.add(pNorm);
        continue;
      }

      const si = sinteticasSi.get(pNorm);
      if (!si) continue;

      result.push(
        recalcularSaldoFinalRow({
          codigo: p.codigoReduzido ?? si.codigo,
          classificacao: p.codigo,
          nome: p.nome,
          saldoInicial: si.saldoInicial,
          debito: si.debito,
          credito: si.credito,
          saldoFinal: si.saldoFinal,
          naturezaSaldoInicial: si.naturezaSaldoInicial,
          naturezaSaldoFinal: si.naturezaSaldoFinal,
          tipo: 'S',
          nivel: p.nivel,
        }),
      );
      incluidas.add(pNorm);
    }
  }

  // Contas órfãs (fora do plano) são EXCLUÍDAS do balancete normal
  // Aparecem apenas em filtro especial "Contas fora do plano" para sincronizar com o plano
  // Exceto CNPJ no código/classificação: aí não é uma "conta órfã" válida (não tem
  // código reduzido nem classificação hierárquica de verdade).
  for (const [k, row] of byCls) {
    if (incluidas.has(k)) continue;
    if (isCnpjLike(row.codigo) || isCnpjLike(row.classificacao)) continue;
    // NÃO adiciona ao balancete — marcar para filtro especial apenas
    // result.push(recalcularSaldoFinalRow({ ...row, tipo: 'A', isOrfa: true }));
  }

  return sortRowsByClassificacao(result);
}

/** Pipeline razão: filtra sintéticas, agrega por conta; lançamentos em ordem cronológica Domínio. */
export function processarRazaoImportado(
  linhas: VisionBalanceteRow[],
  planoRows: VisionPlanoRow[] = [],
): { linhas: VisionBalanceteRow[]; analiticas: VisionBalanceteRow[] } {
  const linhasOrdenadas = sortRowsByDataRazao(
    linhas.map((r, i) => ({
      ...r,
      ordem: r.ordem ?? i + 1,
    })),
  );

  const filtradas = filtrarContasAnaliticas(linhasOrdenadas, planoRows).map((r, i) => ({
    ...r,
    ordem: r.ordem ?? i + 1,
  }));
  const analiticas = agregarRazaoPorConta(filtradas, planoRows);
  // A aba "Lançamentos" deve refletir tudo que foi importado (inclusive contas sintéticas).
  // A filtragem para analíticas fica restrita ao cálculo do balancete/demonstrações.
  return { linhas: linhasOrdenadas, analiticas };
}

export function isValidRazaoLinha(r: VisionBalanceteRow): boolean {
  // Código/classificação de conta sempre começa com dígito (código reduzido ou "1.1.1.01").
  // Aceitar qualquer texto não-vazio como "código" deixava passar lixo de cabeçalho de
  // arquivo (ex.: "Empresa:") como se fosse uma conta solta no balancete.
  const hasCode =
    Boolean(r.codigo?.trim() && /^\d/.test(r.codigo.trim())) ||
    Boolean(r.classificacao?.trim() && /^\d/.test(r.classificacao.trim()));
  const hasMovement = r.debito > 0 || r.credito > 0;
  const hasSaldo = (r.saldoInicial ?? 0) > 0 || (r.saldoFinal ?? 0) > 0;
  const hasDate = Boolean(r.data?.trim());
  // Modo saldo (balancete): aceita contas com saldoInicial definido (natureza preenchida)
  // ou saldoFinal definido, mesmo que valor seja zero, pois foram explicitamente
  // marcadas no recortador/importação de saldo.
  const temSaldoExplicito = Boolean(r.naturezaSaldoInicial || r.naturezaSaldoFinal);
  if (!hasCode) return false;
  // CNPJ no lugar de código/classificação (ex.: "44.854.551/0001-98" vazado do rodapé
  // do PDF) nunca é lançamento — gate central: barra em TODA importação/normalização.
  if (isCnpjLike(r.codigo) || isCnpjLike(r.classificacao)) return false;
  if (r.nome?.toLowerCase().includes('página')) return false;
  return hasMovement || hasSaldo || hasDate || temSaldoExplicito;
}

/**
 * Normaliza data do razão para DD/MM/AAAA.
 * Extrato/OFX usam ISO (YYYY-MM-DD) — NÃO pode ser lido como DD/MM/AA
 * (bug clássico: 2026-06-01 virava 26/06/2001).
 */
export function parseDataRazao(val: unknown): string {
  if (!val) return '';
  const s = String(val).trim();
  if (!s || s === '—') return s;

  // ISO YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD (ou com hora depois).
  // Só o hífen era aceito; extratos que vinham com barra ("2026/06/15") saíam daqui
  // inalterados e, sem o formato DD/MM/AAAA, ficavam fora de QUALQUER filtro de
  // período — o lançamento simplesmente não chegava ao balancete, sem aviso.
  const iso = s.match(/^(\d{4})[-/.](\d{2})[-/.](\d{2})(?:[T\s].*)?$/);
  if (iso) {
    const yyyy = iso[1];
    const mm = iso[2];
    const dd = iso[3];
    return `${dd}/${mm}/${yyyy}`;
  }

  // DD/MM/AAAA, D/M/AA, DD-MM-YYYY, DD.MM.YYYY (âncoras evitam casar dentro de ISO)
  const br = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (br) {
    const dd = br[1].padStart(2, '0');
    const mm = br[2].padStart(2, '0');
    let yyyy = br[3];
    if (yyyy.length === 2) yyyy = `20${yyyy}`;
    return `${dd}/${mm}/${yyyy}`;
  }

  return s;
}
