/**
 * Descobre lançamentos do extrato sem regra e gera fallbacks de cobertura.
 */
import type { ExtratoRegraConta } from './extratoRegrasContasStorage';
import { normalizeExtratoMatchText, normalizeExtratoRegraTexto } from './extratoRegrasContasStorage';
import { matchExtratoRegraConta } from './extratoRegrasContasMatcher';
import {
  resolveCodigoReduzidoDoPlano,
  sanitizeCodigoReduzido,
} from './planoContasMapper';
import {
  extratoHistoricoEhPlausivel,
  limparHistoricoExtratoMisturado,
} from '../../lib/ocrExtratoPositional';
import type { AiColigada, AiSocio } from './aiInteligenciaStorage';
import {
  compactAliasKey,
  contaAceitavelParaColigada,
  isContaFornecedorNome,
  isNomeColigadaInvalido,
  matchColigadaNoHistorico,
  matchColigadaParaRegra,
  matchSocioNoHistorico,
  resolveContaColigadaParaNatureza,
  contaCombinaComColigada,
} from './aiInteligenciaStorage';

export type ExtratoLinhaParaRegra = {
  description: string;
  nature: string;
  value: number;
};

export type PlanoOptionLike = {
  code: string;
  name: string;
  codigoReduzido?: string;
};

const STOP = new Set([
  'DE',
  'DA',
  'DO',
  'DOS',
  'DAS',
  'E',
  'PIX',
  'TED',
  'DOC',
  'TEF',
  'LTD',
  'LTDA',
  'ME',
  'EPP',
  'SA',
  'S',
  'RECEBIDO',
  'RECEBIMENTO',
  'PAGAMENTO',
  'TRANSFER',
  'TRANSFERENCIA',
  'FORNECEDORES',
  'FORNECEDOR',
  'CLIENTE',
  'CLIENTES',
  'SISPAG',
  'OUTRA',
]);

export function findUncoveredExtratoRows(
  extrato: ExtratoLinhaParaRegra[],
  regrasDoBanco: ExtratoRegraConta[],
): ExtratoLinhaParaRegra[] {
  if (!extrato.length) return [];
  const uncovered: ExtratoLinhaParaRegra[] = [];

  for (const row of extrato) {
    const nature = row.nature === 'C' ? 'C' : 'D';
    const hist = normalizeExtratoMatchText(row.description);
    if (!hist) continue;

    const hit = matchExtratoRegraConta(hist, nature, regrasDoBanco);
    if (!hit) {
      const originalDescription = String(row.description ?? '').replace(/\s+/g, ' ').trim();
      uncovered.push({
        description: originalDescription || String(row.description ?? '').trim(),
        nature,
        value: row.value,
      });
    }
  }
  return uncovered;
}

/** Agrupa padrões únicos para a IA (até N). */
export function summarizeUncoveredForAi(
  uncovered: ExtratoLinhaParaRegra[],
  limit = 200,
): ExtratoLinhaParaRegra[] {
  return uncovered.slice(0, limit);
}

export type PadraoExtratoParaIa = ExtratoLinhaParaRegra & {
  ocorrencias: number;
  entidade: string;
};

/**
 * Agrupa lançamentos por entidade canônica (PIX EMIT, AJTF, TARIFA…) — uma entrada por padrão.
 * Envio ÚNICO à IA (sem lotes): cobertura 100% com precisão por tipo de operação.
 */
export function agrupaPadroesExtratoParaIa(
  rows: ExtratoLinhaParaRegra[],
  coligadas: AiColigada[] = [],
): PadraoExtratoParaIa[] {
  const map = new Map<string, PadraoExtratoParaIa>();
  for (const row of rows) {
    const nature = row.nature === 'C' ? 'C' : 'D';
    const entity = extractRegraEntityDescricao(row.description, nature, coligadas);
    if (!entity) continue;
    const key = `${nature}|${normalizeExtratoMatchText(entity)}`;
    const cur = map.get(key);
    if (cur) {
      cur.ocorrencias += 1;
      cur.description = escolherMelhorHistoricoExtratoExemplo(cur.description, row.description);
    } else {
      map.set(key, {
        description: sanitizarHistoricoExtratoParaRegra(row.description, nature, coligadas),
        nature,
        value: row.value,
        ocorrencias: 1,
        entidade: entity,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.ocorrencias - a.ocorrencias);
}

/** Converte padrões agrupados para o payload da API (com contagem e exemplo de histórico). */
export function padroesParaPayloadIa(padroes: PadraoExtratoParaIa[]): ExtratoLinhaParaRegra[] {
  return padroes.map((p) => {
    const exemplo = sanitizarHistoricoExtratoParaRegra(
      String(p.description ?? '').trim(),
      p.nature === 'C' ? 'C' : 'D',
    );
    const entidade = String(p.entidade ?? '').trim();
    const entNorm = entidade ? normalizeExtratoMatchText(entidade) : '';
    const exNorm = normalizeExtratoRegraTexto(exemplo);
    const ocorr = p.ocorrencias > 1 ? ` (${p.ocorrencias}x)` : '';
    const desc =
      entNorm && entNorm !== exNorm && exNorm.length > entNorm.length
        ? `HISTORICO_EXTRATO (copie LITERAL na descricao da regra): ${exemplo}${ocorr}`
        : p.ocorrencias > 1
          ? `${exemplo}${ocorr}`
          : exemplo;
    return {
      description: desc,
      nature: p.nature,
      value: p.ocorrencias > 1 ? p.ocorrencias : p.value,
    };
  });
}

/** Parte a lista em lotes (ex.: 40) para a IA responder mais rápido. */
export function chunkUncoveredForAiBatches<T>(items: T[], batchSize = 40): T[][] {
  const size = Math.max(1, Math.floor(batchSize));
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Filtra lançamentos sem regra cujo histórico casa com palavras do pedido do usuário
 * (ex.: "POLO SUL CLIMATIZAÇÃO"). Se não achar overlap, devolve a lista original.
 */
export function filterUncoveredByUserHint(
  uncovered: ExtratoLinhaParaRegra[],
  userMessage: string,
): ExtratoLinhaParaRegra[] {
  const tokens = tokensPedidoUsuario(userMessage);
  if (tokens.length === 0 || uncovered.length === 0) return uncovered;

  const scored = uncovered
    .map((row) => {
      const hist = normalizeExtratoMatchText(row.description);
      let hits = 0;
      for (const t of tokens) {
        if (hist.includes(t)) hits += 1;
      }
      return { row, hits };
    })
    .filter((x) => x.hits >= Math.min(2, tokens.length));

  if (scored.length === 0) return uncovered;
  scored.sort((a, b) => b.hits - a.hits);
  return scored.map((x) => x.row);
}

/**
 * Tenta achar no plano a conta citada no pedido do chat
 * (ex.: "fundo fixo de caixa", "conta 1234").
 */
export function resolveContaFromUserMessage(
  userMessage: string,
  plano: PlanoOptionLike[],
): string {
  const msg = normalizeExtratoMatchText(userMessage);
  if (!msg || plano.length === 0) return '';

  const codeHit = msg.match(/\b(\d{1,7})\b/);
  if (codeHit) {
    const red = sanitizeCodigoReduzido(codeHit[1]);
    if (red) {
      const exists = plano.some(
        (p) =>
          sanitizeCodigoReduzido(p.codigoReduzido) === red ||
          sanitizeCodigoReduzido(p.code) === red,
      );
      if (exists) return red;
    }
  }

  // Usa o trecho após a última preposição de destino (conta alvo).
  const { destino } = splitPedidoAssuntoDestino(userMessage);
  const afterPrep =
    destino ||
    msg.match(
      /(?:JOGAD[AO]|JOGAR|USAR|USANDO|PARA|NO|NA|EM|CONTA)\s+(?:O|A|OS|AS)?\s*(.+)$/,
    )?.[1] ||
    msg;

  let best = '';
  let bestScore = 0;
  const hintTokens = new Set(tokensUteis(afterPrep));
  if (hintTokens.size === 0) return '';

  for (const p of plano) {
    const red = sanitizeCodigoReduzido(p.codigoReduzido) || sanitizeCodigoReduzido(p.code);
    if (!red) continue;
    const nameTokens = tokensUteis(p.name);
    if (nameTokens.length === 0) continue;
    let matched = 0;
    for (const nt of nameTokens) {
      if (hintTokens.has(nt) || [...hintTokens].some((h) => h.includes(nt) || nt.includes(h))) {
        matched += 1;
      }
    }
    if (matched === 0) continue;
    const nameNorm = normalizeExtratoMatchText(p.name);
    const score =
      matched * 25 +
      (matched === nameTokens.length ? 40 : 0) +
      (/\bFUNDO\b/.test(nameNorm) && hintTokens.has('FUNDO') ? 30 : 0) +
      (/\bFIXO\b/.test(nameNorm) && hintTokens.has('FIXO') ? 20 : 0) +
      (/\bCAIXA\b/.test(nameNorm) && hintTokens.has('CAIXA') ? 20 : 0) +
      (destino && nameNorm.includes(destino.slice(0, Math.min(destino.length, 24))) ? 35 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = red;
    }
  }
  const minScore = destino && hintTokens.size >= 2 ? 25 : 40;
  return bestScore >= minScore ? best : '';
}

/**
 * Separa o pedido em assunto (regra/histórico) e destino (conta citada).
 * Ex.: "muda Polo Sul para fundo fixo" → assunto "muda Polo Sul", destino "fundo fixo".
 */
export function splitPedidoAssuntoDestino(userMessage: string): { assunto: string; destino: string } {
  const msg = normalizeExtratoMatchText(userMessage);
  if (!msg) return { assunto: '', destino: '' };

  const re = /\s+(?:PARA|NO|NA|EM)\s+(?:O|A|OS|AS)?\s*/gi;
  let splitAt = -1;
  let prefixLen = 0;
  for (const m of msg.matchAll(re)) {
    if (m.index != null) {
      splitAt = m.index;
      prefixLen = m[0].length;
    }
  }
  if (splitAt >= 0) {
    return {
      assunto: msg.slice(0, splitAt).trim(),
      destino: msg.slice(splitAt + prefixLen).trim(),
    };
  }
  return { assunto: msg, destino: '' };
}

/** Tokens do pedido do usuário que servem para achar regra/histórico (ignora verbos de ação). */
function tokensPedidoUsuario(userMessage: string): string[] {
  const { assunto } = splitPedidoAssuntoDestino(userMessage);
  const ACTION = new Set([
    'JOGAR',
    'JOGUE',
    'JOGAD',
    'MUDAR',
    'MUDE',
    'MUDA',
    'ALTERAR',
    'ALTERE',
    'TROCAR',
    'TROQUE',
    'COLOCAR',
    'COLOQUE',
    'USAR',
    'USE',
    'PARA',
    'NO',
    'NA',
    'EM',
    'CONTA',
    'REGRA',
    'REGRAS',
    'VAI',
    'VAO',
    'FICAR',
    'FICA',
    'PASSAR',
    'PASSE',
  ]);
  return tokensUteis(assunto || userMessage).filter((t) => t.length >= 3 && !ACTION.has(t));
}

/** Tokens do assunto do pedido (histórico/regra a alterar) — uso no chat e na conciliação. */
export function tokensAssuntoPedidoUsuario(userMessage: string): string[] {
  return tokensPedidoUsuario(userMessage);
}

function textoCasaComPedido(texto: string, tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const hist = normalizeExtratoMatchText(texto);
  const hits = tokens.filter((t) => hist.includes(t)).length;
  return (
    hits >= Math.min(2, tokens.length) ||
    (tokens.length === 1 && hits === 1) ||
    tokens.some((t) => t.length >= 6 && hist.includes(t))
  );
}

/**
 * Altera regras JÁ cadastradas que casam com o pedido do chat
 * (ex.: "muda Polo Sul Climatização para fundo fixo").
 */
export function updateExistingRegrasFromUserChatIntent(input: {
  userMessage: string;
  regrasDoBanco: ExtratoRegraConta[];
  plano: PlanoOptionLike[];
  contaContrapartida?: string;
}): ExtratoRegraConta[] {
  const contra =
    sanitizeCodigoReduzido(input.contaContrapartida || '') ||
    resolveContaFromUserMessage(input.userMessage, input.plano);
  if (!contra || input.regrasDoBanco.length === 0) return [];

  const tokens = tokensPedidoUsuario(input.userMessage);
  if (tokens.length === 0) return [];

  const out: ExtratoRegraConta[] = [];
  for (const r of input.regrasDoBanco) {
    if (!textoCasaComPedido(r.descricao, tokens) && !textoCasaComPedido(r.nome, tokens)) {
      continue;
    }
    if (sanitizeCodigoReduzido(r.contaContrapartida) === contra) continue;
    out.push({
      ...r,
      contaContrapartida: contra,
    });
  }
  return out;
}

/**
 * Aplica o pedido do chat localmente: cria regras para históricos que casam
 * com o texto do usuário, apontando para a conta resolvida no plano.
 */
export function buildRegrasFromUserChatIntent(input: {
  userMessage: string;
  uncovered: ExtratoLinhaParaRegra[];
  contaBanco: string;
  plano: PlanoOptionLike[];
  contaContrapartida?: string;
}): ExtratoRegraConta[] {
  const banco = input.contaBanco.trim();
  const contra =
    sanitizeCodigoReduzido(input.contaContrapartida || '') ||
    resolveContaFromUserMessage(input.userMessage, input.plano);
  if (!banco || !contra) return [];

  const filtered = filterUncoveredByUserHint(input.uncovered, input.userMessage);
  // Se o filtro devolveu tudo (sem hint forte), ainda assim exige overlap mínimo
  // com tokens do pedido — senão não inventa regra em massa.
  const tokens = tokensPedidoUsuario(input.userMessage);
  const rows =
    filtered.length < input.uncovered.length
      ? filtered
      : input.uncovered.filter((row) => {
          const hist = normalizeExtratoMatchText(row.description);
          return tokens.some((t) => hist.includes(t));
        });

  const out: ExtratoRegraConta[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const nature = row.nature === 'C' ? 'C' : 'D';
    const desc = extractRegraDescricaoFromHistorico(row.description);
    if (!desc) continue;
    const key = `${nature}|${normalizeExtratoMatchText(desc)}|${contra}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: crypto.randomUUID(),
      nome: desc.slice(0, 40),
      descricao: desc,
      nature,
      contaBanco: banco,
      contaContrapartida: contra,
    });
  }
  return out;
}

function tokensUteis(text: string): string[] {
  return normalizeExtratoMatchText(text)
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

function tokensHistoricoContaCombinam(ht: string, nt: string): boolean {
  if (ht === nt) return true;
  const shorter = ht.length <= nt.length ? ht : nt;
  const longer = ht.length <= nt.length ? nt : ht;
  if (shorter.length < 4) return false;
  return longer.includes(shorter);
}

/** Conta geral de fornecedor/cliente (não é razão social individual). */
export function isContaGeralFornecedorOuCliente(name: string): boolean {
  const n = normalizeExtratoMatchText(name);
  if (/COLIGAD|MUTUO|M[UÚ]TUO|EMPREST|PARTES?\s+RELACIONAD|INTERCOMPANY/.test(n)) {
    return false;
  }
  return (
    /\bFORNECEDOR|\bFORN\b|DUPLICATA\s+A\s+PAGAR/.test(n) ||
    /\bCLIENTES?\b|\bCLIENTES?\s+DIVERS|DUPLICATA\s+A\s+RECEBER|CONTAS\s+A\s+RECEBER/.test(n)
  );
}

/** Conta de pendência / classificação posterior — fundo fixo de caixa. */
export function pickFundoFixoCaixaConta(plano: PlanoOptionLike[]): string {
  const prefer = [
    /FUNDO\s+FIXO\s+DE\s+CAIXA/i,
    /FUNDO\s+FIXO/i,
    /CAIXA\s+GERAL/i,
    /PENDENC|PENDÊNC/i,
  ];
  for (const re of prefer) {
    for (const p of plano) {
      const red = sanitizeCodigoReduzido(p.codigoReduzido) || sanitizeCodigoReduzido(p.code);
      if (!red) continue;
      if (/^\s*BANCO\b/i.test(p.name)) continue;
      if (re.test(p.name)) return red;
    }
  }
  return '';
}

const TIPOS_IMPOSTO_IDENTIFICAVEL =
  /IRPJ|CSLL|PIS|COFINS|ISS|ICMS|IPI|INSS|FGTS|IRRF|IOF|DAS\b|SIMPLES|CSRF|CPRB|PASEP|SELIC|IPTU|IPVA|ITR|CIDE|CPMF/;

/** Histórico cita tipo de imposto/obrigação identificável (IRPJ, PIS, FGTS…). */
export function isTipoImpostoIdentificavelNoHistorico(description: string): boolean {
  return TIPOS_IMPOSTO_IDENTIFICAVEL.test(normalizeExtratoMatchText(description));
}

/** Histórico indica pagamento/recolhimento tributário (com ou sem tipo). */
export function isHistoricoImpostoOuTributo(description: string): boolean {
  const s = normalizeExtratoMatchText(description);
  return /DARF|RFB|RECEITA\s+FEDERAL|TRIBUTO|IMPOSTO|GPS|T\.?FESSORA|TFRF|SISCOMEX|PGTO\s+TRIB|CONV\.?\s*ORGAOS|ORGAOS\s+GOV|\bCODE\b|SISPAG\s+TRIB|GUIA\s+RECOLH|RECOLHIMENTO|DAS\b|SEFAZ|PREFEITURA|MUNICIPAL/.test(
    s,
  );
}

/** Imposto sem tipo identificável no histórico → fundo fixo de caixa (não chutar conta específica). */
export function isImpostoSemTipoIdentificavel(description: string): boolean {
  return isHistoricoImpostoOuTributo(description) && !isTipoImpostoIdentificavelNoHistorico(description);
}

/** Imposto RFB/DARF sem discriminar qual tributo (IRPJ, PIS, COFINS…). */
export function isImpostoGenericoAmbiguous(description: string): boolean {
  return isImpostoSemTipoIdentificavel(description);
}

/** Conta do plano nomeada para imposto/obrigação específica (ex.: IRPJ A RECOLHER). */
export function isContaImpostoEspecifica(name: string): boolean {
  const n = normalizeExtratoMatchText(name);
  if (!/IMPOSTO|TRIBUTO|DARF|GPS|RECOLHER|A\s+PAGAR|OBRIGAC/.test(n)) return false;
  return TIPOS_IMPOSTO_IDENTIFICAVEL.test(n);
}

export function isContaImpostoOuTributo(name: string): boolean {
  return /IMPOSTO|TRIBUTO|DARF|GPS|RECOLHER|OBRIGAC|T\.?FESSORA/.test(normalizeExtratoMatchText(name));
}

/** Conta de imposto específica só é válida se o histórico citar o mesmo tipo. */
export function impostoContaCompativelComHistorico(historico: string, contaNome: string): boolean {
  const hist = normalizeExtratoMatchText(historico);
  const nome = normalizeExtratoMatchText(contaNome);
  if (/FUNDO\s+FIXO/.test(nome)) return isImpostoSemTipoIdentificavel(hist);
  if (!isTipoImpostoIdentificavelNoHistorico(hist)) return false;
  const pares: Array<[RegExp, RegExp]> = [
    [/\bIRPJ\b/, /\bIRPJ\b/],
    [/\bCSLL\b/, /\bCSLL\b/],
    [/\bPIS\b/, /\bPIS\b/],
    [/\bCOFINS\b/, /\bCOFINS\b/],
    [/\bISS\b/, /\bISS\b/],
    [/\bICMS\b/, /\bICMS\b/],
    [/\bIPI\b/, /\bIPI\b/],
    [/\bINSS\b/, /\bINSS\b/],
    [/\bFGTS\b/, /\bFGTS\b/],
    [/\bIRRF\b/, /\bIRRF\b/],
    [/\bIOF\b/, /\bIOF\b/],
    [/\bDAS\b|SIMPLES/, /\bDAS\b|SIMPLES/],
    [/\bPASEP\b/, /\bPASEP\b/],
    [/\bIPTU\b/, /\bIPTU\b/],
    [/\bIPVA\b/, /\bIPVA\b/],
  ];
  return pares.some(([h, c]) => h.test(hist) && c.test(nome));
}

export function isEmprestimoHistorico(description: string): boolean {
  return /EMPREST|AMORT|MUTUO|M[UÚ]TUO|LIBERAC\s+CRED|FINANCIAMENTO/.test(
    normalizeExtratoMatchText(description),
  );
}

/** Número de contrato citado no histórico (empréstimo/financiamento). */
export function extractNumeroContratoHistorico(description: string): string {
  const s = normalizeExtratoMatchText(description);
  const m =
    s.match(/\b(?:CTR|CONTR(?:ATO)?|N[ºO°]?\.?)\s*[-#:]?\s*([A-Z0-9][\w/-]{2,20})\b/) ||
    s.match(/\bCONTRATO\s+(\d{4,})\b/) ||
    s.match(/\bEMPREST\w*\s+(\d{4,})\b/);
  return m ? String(m[1]).replace(/[^\dA-Z]/gi, '').toUpperCase() : '';
}

/** Conta de empréstimo no plano cujo nome contém o nº do contrato. */
export function pickContaEmprestimoPorContrato(
  numeroContrato: string,
  plano: PlanoOptionLike[],
): string {
  const compact = numeroContrato.replace(/\s/g, '').toUpperCase();
  const digits = compact.replace(/\D/g, '');
  if (!compact || plano.length === 0) return '';

  for (const p of plano) {
    const name = normalizeExtratoMatchText(p.name);
    if (!/EMPREST|MUTUO|M[UÚ]TUO|FINANCIAMENTO/.test(name)) continue;
    const red = sanitizeCodigoReduzido(p.codigoReduzido) || sanitizeCodigoReduzido(p.code);
    if (!red) continue;
    const nameDigits = name.replace(/\D/g, '');
    if (
      name.includes(compact) ||
      (digits.length >= 4 && nameDigits.includes(digits))
    ) {
      return red;
    }
  }
  return '';
}

/** Documentos de inteligência citam o contrato do empréstimo. */
export function temEvidenciaContratoEmprestimo(
  description: string,
  anexosTexto: string[] = [],
): boolean {
  const num = extractNumeroContratoHistorico(description);
  if (!num || anexosTexto.length === 0) return false;
  const corpus = normalizeExtratoMatchText(anexosTexto.join('\n'));
  const digits = num.replace(/\D/g, '');
  if (corpus.includes(num)) return true;
  return digits.length >= 4 && corpus.replace(/\D/g, '').includes(digits);
}

/**
 * Lançamento que não dá para classificar com segurança → fundo fixo de caixa (pendência).
 * Imposto genérico RFB/DARF; empréstimo sem contrato identificável no extrato/plano/docs.
 */
export function shouldUsarFundoFixoPendencia(input: {
  description: string;
  plano: PlanoOptionLike[];
  anexosTexto?: string[];
}): boolean {
  const { description, plano } = input;
  const anexos = input.anexosTexto ?? [];

  if (isImpostoGenericoAmbiguous(description)) return true;

  if (isEmprestimoHistorico(description)) {
    const num = extractNumeroContratoHistorico(description);
    if (num && pickContaEmprestimoPorContrato(num, plano)) return false;
    if (temEvidenciaContratoEmprestimo(description, anexos)) return false;
    return true;
  }

  return false;
}

/** Rendimentos de aplicação (BB Rende, Aut Mais, REND PAGO APLIC…) — não são fornecedor/cliente. */
export function isRendimentoOuAplicacaoHistorico(description: string): boolean {
  const s = normalizeExtratoMatchText(description);
  return /RENDIMENTO|REND\s+PAGO|BB\s+RENDE|RENDE\s+FACIL|AUT\s+MAIS|REND\s+PAGO\s+APLIC|REND\s+PAGO\s+AUT|OUROCAP|JUROS\s+SOBRE|RECEITA\s+.*\s+JUROS|REND\s+PAGO\s+AUT\s+MAIS/.test(
    s,
  );
}

/** Movimento de aplicação financeira (aporte/resgate) — inclui BB Rende débito. */
export function isMovimentoAplicacaoFinanceira(
  description: string,
  nature: 'D' | 'C',
): boolean {
  const s = normalizeExtratoMatchText(description);
  if (isRendimentoOuAplicacaoHistorico(s)) return true;
  if (/APLIC|CDB|RDB|RESGATE|INVEST|POUPANCA/.test(s)) return true;
  if (nature === 'D' && /BB\s+RENDE|RENDE\s+FACIL|OUROCAP/.test(s)) return true;
  return false;
}

/** Conta operacional (tarifa, imposto, folha…) — pode ser específica. */
export function isContaOperacionalEspecial(name: string): boolean {
  const n = normalizeExtratoMatchText(name);
  return /TARIFA|IOF|JUROS|IMPOSTO|TRIBUTO|DARF|GPS|FOLHA|SALARIO|FERIAS|FGTS|INSS|EMPREST|MUTUO|M[UÚ]TUO|COLIGAD|FUNDO\s+FIXO|APLICACAO|CDB|RENDIMENTO|REND|RECEITA\s+FINANCEIRA|ENERGIA|TELEFONE|ALUGUEL/.test(
    n,
  );
}

/**
 * Conta nominal de empresa no plano (ex.: "POLO SUL CLIMATIZACAO LTDA").
 * NÃO deve ser usada como contrapartida automática de fornecedor/cliente —
 * isso infla o balancete. Exceção: coligada / mútuo / empréstimo.
 */
export function isContaNominalEmpresa(name: string): boolean {
  if (isContaGeralFornecedorOuCliente(name)) return false;
  if (isContaOperacionalEspecial(name)) return false;
  const n = normalizeExtratoMatchText(name);
  if (/^\s*BANCO\b|\bCAIXA\b|\bRECEITA\b|\bDESPESA\b|\bATIVO\b|\bPASSIVO\b/.test(n)) {
    return false;
  }
  // Razão social típica ou nome próprio multi-palavra sem tipo contábil
  if (/\bLTDA\b|\bEIRELI\b|\bME\b|\bEPP\b|\bS\/A\b|\bSA\b/.test(n)) return true;
  const tokens = tokensUteis(n);
  return tokens.length >= 2;
}

/**
 * Verifica se a descrição do extrato é genuinamente genérica.
 * Retorna true se, após remover termos bancários comuns e números, a descrição fica vazia.
 * Se sobrar qualquer palavra (ex. nome de empresa como CONCEPT, ELGIN, etc.), considera específica.
 */
export function isDescricaoRealmenteGenerica(descricao: string): boolean {
  const norm = normalizeExtratoMatchText(descricao);
  const semGenericos = norm
    .replace(/\b(PIX|EMIT|ENV|PAG|SAIDA|PIXEMIT|TED|DOC|PAGAMENTO|PAGTO|BOLETO|TITULO|TEF|COMPE|FORNEC|DEB|PGTO|TIT|SISPAG|RECEBIDO|RECEB|REC|RECEBIMENTO|DEPOSITO|CREDITO|CRED|LIQ|COBRAN|COBRANCA|SALDO|ANTERIOR|DIA|EXTRATO|LAN[CÇ]AMENTO|MOVIMENTO|RENDE|F[AÁ]CIL|RENDAFACIL|BB|BANCO|DO|BRASIL|DE|A|O|DA|DO|PARA|EM|E|COB|JUROS|TARIFA|SERVI[CÇ]OS?|M[EÊ]S|ANO|LTD|LTDA|EIRELI|S\/A|SA|ME|EPP|COBRANÇAS?)\b/g, ' ')
    .replace(/[^A-Z]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return semGenericos.length === 0;
}

/**
 * Pagamento a fornecedor / recebimento de cliente (terceiros) —
 * deve ir para conta GERAL, nunca por razão social.
 */
export function isLancamentoFornecedorOuClienteGenerico(
  description: string,
  nature: 'D' | 'C',
  coligadas: AiColigada[] = [],
): boolean {
  const s = normalizeExtratoMatchText(description);
  if (matchColigadaNoHistorico(s, coligadas)) return false;
  if (/COLIGAD|MUTUO|M[UÚ]TUO|EMPREST|AMORT|LIBERAC\s+CRED/.test(s)) return false;
  if (isRendimentoOuAplicacaoHistorico(s) || isMovimentoAplicacaoFinanceira(s, nature)) {
    return false;
  }
  if (/TARIFA|IOF|JUROS|DARF|GPS|IMPOSTO|TRIBUTO|FOLHA|SALARIO|FGTS|INSS/.test(s)) {
    return false;
  }
  if (!isDescricaoRealmenteGenerica(description)) {
    return false;
  }
  if (nature === 'D') {
    return /PIX\s*(EMIT|ENV|PAG|SAIDA)|PIXEMIT|TED\s+ENV|DOC\s+ENV|PAGAMENTO|BOLETO|TITULO|TEF\b|COMPE|FORNEC|DEB\.?\s*PGTO|DEB\.?\s*TIT|SISPAG/.test(
      s,
    );
  }
  return /PIX\s*REC|PIXRECEB|TED\s+REC|DOC\s+REC|RECEBIMENTO|DEPOSITO|CREDITO\s+PIX|CRED\s+PIX|LIQ\.?\s*COBRAN/.test(
    s,
  );
}

/**
 * Padrão operacional agrupado (sem razão social) — evita N regras por empresa.
 * Ex.: "PIX EMIT OUTRA PAGAMENTO ACME LTDA" → "PIX EMIT"
 */
export function extractPadraoOperacionalAgrupado(
  description: string,
  nature: 'D' | 'C',
): string {
  const s = normalizeExtratoMatchText(description);
  if (/TARIFA|PACOTE\s+SERV|CESTA|ANUIDADE/.test(s)) return 'TARIFA BANCARIA';
  if (/IOF|JUROS\s+EMPREST|ENCARGO/.test(s)) return 'IOF JUROS';
  if (isImpostoGenericoAmbiguous(s)) return 'IMPOSTO PENDENTE RFB';
  if (/DARF|GPS|IMPOSTO|TRIBUTO|IRPJ|CSLL|PIS|COFINS|ISS|FGTS/.test(s)) return 'IMPOSTO TRIBUTO';
  if (/SALARIO|FOLHA|FERIAS|RESCISAO|ORDENADO/.test(s)) return 'FOLHA PAGAMENTO';
  if (/EMPREST|AMORT|MUTUO|M[UÚ]TUO|LIBERAC\s+CRED/.test(s)) {
    return nature === 'D' ? 'EMPRESTIMO SAIDA' : 'EMPRESTIMO ENTRADA';
  }
  if (/TRANSFERENCIA|TRANSF\b|ENTRE\s+CONTAS/.test(s)) return 'TRANSFERENCIA';
  if (
    isRendimentoOuAplicacaoHistorico(s) ||
    /BB\s+RENDE|RENDE\s+FACIL|OUROCAP|AUT\s+MAIS/.test(s)
  ) {
    return nature === 'C' ? 'RENDIMENTO APLICACAO' : 'APLICACAO FINANCEIRA';
  }
  if (/APLIC|CDB|RDB|RESGATE/.test(s)) {
    return nature === 'C' ? 'RENDIMENTO APLICACAO' : 'APLICACAO FINANCEIRA';
  }

  if (nature === 'D') {
    if (/PIX/.test(s)) return 'PIX EMIT';
    if (/TED/.test(s)) return 'TED ENV';
    if (/DOC\b/.test(s)) return 'DOC ENV';
    if (/BOLETO|TITULO|COMPE|TEF\b/.test(s)) return 'PAGAMENTO TITULO';
    if (/FORNEC/.test(s)) return 'PAGAMENTO FORNECEDOR';
    return 'PAGAMENTO FORNECEDOR';
  }
  if (/PIX/.test(s)) return 'PIX REC';
  if (/TED/.test(s)) return 'TED REC';
  if (/DOC\b/.test(s)) return 'DOC REC';
  if (/LIQ\.?\s*COBRAN|COBRANCA/.test(s)) return 'LIQUIDACAO COBRANCA';
  return 'RECEBIMENTO CLIENTE';
}

/** Trecho estável da descrição para virar regra. */
export function extractRegraDescricaoFromHistorico(description: string): string {
  const norm = normalizeExtratoMatchText(description);
  const tokens = tokensUteis(norm);
  if (tokens.length === 0) return norm.slice(0, 60);
  return tokens.slice(0, Math.min(5, Math.max(2, tokens.length))).join(' ');
}

/** Nome canônico da coligada (AJTF) — 1 regra cobre todos os lançamentos. */
export function canonicalColigadaDescricao(coligada: AiColigada): string {
  const nome = normalizeExtratoMatchText(coligada.nome);
  const aliases = (coligada.aliases || [])
    .map((a) => normalizeExtratoMatchText(a))
    .filter((a) => a && !isNomeColigadaInvalido(a));

  const pickFrom = (candidate: string): string => {
    const compact = compactAliasKey(candidate);
    if (compact.length >= 3 && compact.length <= 12 && /^[A-Z0-9]+$/.test(compact)) {
      return compact;
    }
    return candidate.slice(0, 48) || compact;
  };

  if (nome && !isNomeColigadaInvalido(nome)) {
    return pickFrom(nome);
  }
  for (const a of aliases) {
    if (!isNomeColigadaInvalido(a)) return pickFrom(a);
  }
  return nome.slice(0, 48) || compactAliasKey(nome);
}

/** Razão social / nome completo da coligada nos documentos (não sigla compacta). */
export function razaoSocialColigadaDescricao(coligada: AiColigada): string {
  const candidates = [coligada.nome, ...(coligada.aliases ?? [])]
    .map((c) => normalizeExtratoRegraTexto(c))
    .filter((c) => c && !isNomeColigadaInvalido(c));

  const fullName = candidates.find(
    (c) => c.length >= 8 || /\b(LTDA|LTD|ME|EPP|SA|EIRELI|COMERCIO|COMÉRCIO|REFRIGERA)\b/i.test(c),
  );
  if (fullName) return fullName;

  const longest = candidates.sort((a, b) => b.length - a.length)[0];
  if (longest) return longest;
  return canonicalColigadaDescricao(coligada);
}

/**
 * Busca no histórico de regras salvas (conciliações anteriores) descrição que casa com a coligada.
 */
export function findHistoricoRegrasConciliacaoParaColigada(
  coligada: AiColigada,
  regrasHistoricas: ExtratoRegraConta[],
  nature?: 'D' | 'C',
): string {
  let best = '';
  let bestScore = 0;
  for (const r of regrasHistoricas) {
    const n = r.nature === 'C' ? 'C' : 'D';
    if (nature && n !== nature) continue;
    if (!matchColigadaNoHistorico(r.descricao, [coligada])) continue;
    const desc = normalizeExtratoRegraTexto(r.descricao);
    if (!desc || isNomeColigadaInvalido(desc)) continue;
    const score = desc.length;
    if (score > bestScore) {
      bestScore = score;
      best = desc;
    }
  }
  return best;
}

/**
 * Busca no histórico de regras salvas descrição que casa com o sócio.
 */
export function findHistoricoRegrasConciliacaoParaSocio(
  socio: Pick<AiSocio, 'nome' | 'aliases'>,
  regrasHistoricas: ExtratoRegraConta[],
  nature?: 'D' | 'C',
): string {
  let best = '';
  let bestScore = 0;
  const socioLike: AiSocio = {
    id: 'tmp',
    nome: socio.nome,
    aliases: socio.aliases ?? [],
  };
  for (const r of regrasHistoricas) {
    const n = r.nature === 'C' ? 'C' : 'D';
    if (nature && n !== nature) continue;
    if (!matchSocioNoHistorico(r.descricao, [socioLike])) continue;
    const desc = normalizeExtratoRegraTexto(r.descricao);
    if (!desc) continue;
    const score = desc.length;
    if (score > bestScore) {
      bestScore = score;
      best = desc;
    }
  }
  return best;
}

/**
 * Histórico do extrato/conciliação que casa com a coligada (texto literal do lançamento).
 * Usado para preencher a descrição da regra — igual ao "Puxar histórico do extrato".
 */
export function findHistoricoExtratoParaColigada(
  coligada: AiColigada,
  extratoRows: ExtratoLinhaParaRegra[],
  nature?: 'D' | 'C',
): string {
  let best = '';
  let bestScore = 0;
  for (const row of extratoRows) {
    const n = row.nature === 'C' ? 'C' : 'D';
    if (nature && n !== nature) continue;
    if (!matchColigadaNoHistorico(row.description, [coligada])) continue;
    const desc = sanitizarHistoricoExtratoParaRegra(
      normalizeExtratoRegraTexto(row.description),
      nature ?? 'D',
      [coligada],
    );
    if (!desc) continue;
    const score = desc.length + (typeof row.value === 'number' ? row.value * 0.01 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = desc;
    }
  }
  return best;
}

/**
 * Descrição da regra para coligada (prioridade):
 * 1) histórico de regras salvas (conciliação anterior);
 * 2) histórico literal do extrato atual;
 * 3) razão social / nome da coligada nos documentos.
 */
export function resolveDescricaoRegraColigada(
  coligada: AiColigada,
  extratoRows: ExtratoLinhaParaRegra[],
  nature: 'D' | 'C',
  regrasHistoricas: ExtratoRegraConta[] = [],
): string {
  const fromRegras = findHistoricoRegrasConciliacaoParaColigada(coligada, regrasHistoricas, nature);
  if (fromRegras) return fromRegras;
  const fromExtrato = findHistoricoExtratoParaColigada(coligada, extratoRows, nature);
  if (fromExtrato) return fromExtrato;
  return razaoSocialColigadaDescricao(coligada);
}

/** Nome completo do sócio nos documentos. */
export function razaoSocialSocioDescricao(socio: Pick<AiSocio, 'nome' | 'aliases'>): string {
  const candidates = [socio.nome, ...(socio.aliases ?? [])]
    .map((c) => normalizeExtratoRegraTexto(c))
    .filter(Boolean);
  const longest = candidates.sort((a, b) => b.length - a.length)[0];
  return longest || normalizeExtratoRegraTexto(socio.nome);
}

export function findHistoricoExtratoParaSocio(
  socio: Pick<AiSocio, 'nome' | 'aliases'>,
  extratoRows: ExtratoLinhaParaRegra[],
  nature?: 'D' | 'C',
): string {
  const socioLike: AiSocio = {
    id: 'tmp',
    nome: socio.nome,
    aliases: socio.aliases ?? [],
  };
  let best = '';
  let bestScore = 0;
  for (const row of extratoRows) {
    const n = row.nature === 'C' ? 'C' : 'D';
    if (nature && n !== nature) continue;
    if (!matchSocioNoHistorico(row.description, [socioLike])) continue;
    const desc = normalizeExtratoRegraTexto(row.description);
    if (!desc) continue;
    const score = desc.length + (typeof row.value === 'number' ? row.value * 0.01 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = desc;
    }
  }
  return best;
}

/**
 * Descrição da regra para sócio (prioridade):
 * 1) histórico de regras salvas;
 * 2) histórico literal do extrato;
 * 3) nome do sócio nos documentos.
 */
export function resolveDescricaoRegraSocio(
  socio: Pick<AiSocio, 'nome' | 'aliases'>,
  extratoRows: ExtratoLinhaParaRegra[],
  nature: 'D' | 'C',
  regrasHistoricas: ExtratoRegraConta[] = [],
): string {
  const fromRegras = findHistoricoRegrasConciliacaoParaSocio(socio, regrasHistoricas, nature);
  if (fromRegras) return fromRegras;
  const fromExtrato = findHistoricoExtratoParaSocio(socio, extratoRows, nature);
  if (fromExtrato) return fromExtrato;
  return razaoSocialSocioDescricao(socio);
}

/** Converte históricos (strings) em linhas para busca de descrição de coligada. */
export function historicoStringsParaLinhasExtrato(
  historicos: string[],
  nature: 'D' | 'C',
): ExtratoLinhaParaRegra[] {
  return historicos.map((description) => ({ description, nature, value: 0 }));
}

/**
 * Descrição canônica: poucas regras agrupadas por padrão operacional.
 * Coligada → AJTF; demais → PIX REC, RENDIMENTO APLICACAO, TARIFA BANCARIA…
 */
export function extractRegraEntityDescricao(
  description: string,
  nature: 'D' | 'C',
  coligadas: AiColigada[] = [],
): string {
  const hist = normalizeExtratoMatchText(description);
  if (!hist) return '';

  const coligada = matchColigadaNoHistorico(hist, coligadas);
  if (coligada) return canonicalColigadaDescricao(coligada);

  // Terceiros / operacional → poucas regras agrupadas (PIX REC, RENDIMENTO APLICACAO…)
  return extractPadraoOperacionalAgrupado(hist, nature);
}

const RE_FRAGMENTO_VALOR_OCR =
  /\b\d{2,4}\s+(?:\d\s+){2,}\d+[DCdc]?\s+(?:\d\s+){1,}\d{2}\b/;

const RE_OPERACOES_DISTINTAS = [
  /\bIMPOSTOS?\b/i,
  /\bSERVICOS\b/i,
  /\bTARIFA\b/i,
  /\bPIX\b/i,
  /\bTED\b/i,
  /\bRENDIMENTOS?\b/i,
  /\bSALARIOS?\b/i,
  /\bFOLHA\b/i,
  /\bFORNECEDOR\b/i,
];

/** Histórico parece mistura de lançamentos / ruído OCR. */
export function extratoHistoricoPareceMisturadoOcr(text: string | undefined): boolean {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!s || s.length < 10) return false;
  if (RE_FRAGMENTO_VALOR_OCR.test(s)) return true;
  const tokens = s.split(/\s+/);
  const singles = tokens.filter((t) => t.length === 1 && !/^[DCdc]$/.test(t)).length;
  if (singles >= 4) return true;
  let opsHit = 0;
  for (const re of RE_OPERACOES_DISTINTAS) {
    if (re.test(s)) opsHit += 1;
  }
  if (opsHit >= 2 && tokens.length >= 8) return true;
  if (/\b[A-ZÀ-Ú]{2,}\s+\d{1,3}(?:\s+\d){3,}/i.test(s)) return true;
  const cleaned = limparHistoricoExtratoMisturado(s);
  if (
    cleaned &&
    cleaned.length >= 4 &&
    cleaned.length < s.length * 0.55 &&
    normalizeExtratoRegraTexto(cleaned) !== normalizeExtratoRegraTexto(s)
  ) {
    return true;
  }
  return false;
}

function extrairFraseOperacionalDominante(text: string): string {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const frases = [
    /\bMATERIAL\s+DE\s+HIGIENE\b/i,
    /\bMATERIAL\s+DE\s+LIMPEZA\b/i,
    /\bMATERIAL\s+DE\s+ESCRITORIO\b/i,
    /\bMATERIAL\s+DE\s+CONSUMO\b/i,
    /\bIMPOSTOS?\s+SOBRE\s+VENDAS\b/i,
    /\bIMPOSTOS?\s+SOBRE\s+SERVICOS\b/i,
    /\bPAGAMENTOS?\s+TRIB(?:UTO)?\b/i,
    /\bTAR(?:\.|\s)?PLANO\s+ADAPT\b/i,
    /\bPIX\s*(?:ENVIADO|RECEBIDO|REC\.?|EMIT\.?)\b[\w\s./-]{0,40}/i,
    /\bTED\s*(?:ENV|RECEB)[\w\s./-]{0,40}/i,
    /\bRENDIMENTOS?\b[\w\s./-]{0,24}/i,
    /\bIOF\b[\w\s./-]{0,20}/i,
    /\bSALARIOS?\b[\w\s./-]{0,24}/i,
    /\bFOLHA\b[\w\s./-]{0,24}/i,
  ];
  for (const re of frases) {
    const m = s.match(re);
    if (m?.[0]?.trim()) return m[0].replace(/\s+/g, ' ').trim().toUpperCase();
  }
  const frasesConhecidas = [
    'MATERIAL DE HIGIENE',
    'MATERIAL DE LIMPEZA',
    'MATERIAL DE ESCRITORIO',
    'MATERIAL DE CONSUMO',
  ];
  const upper = s.toUpperCase();
  for (const frase of frasesConhecidas) {
    if (upper.includes(frase)) return frase;
  }
  return '';
}

export function scoreHistoricoParaExemploRegra(text: string | undefined): number {
  const s = normalizeExtratoRegraTexto(String(text ?? ''));
  if (!s) return -999;
  if (extratoHistoricoPareceMisturadoOcr(s)) return -100 + Math.min(s.length, 120) * 0.01;
  if (!extratoHistoricoEhPlausivel(s)) return -50;
  let score = 120 - Math.min(s.length, 90);
  if (/\b(PIX|TED|IMPOSTO|TARIFA|RENDIMENTO|SALARIO|FOLHA|IOF)\b/i.test(s)) score += 15;
  if (s.length <= 48) score += 10;
  return score;
}

export function escolherMelhorHistoricoExtratoExemplo(a: string, b: string): string {
  const sa = scoreHistoricoParaExemploRegra(a);
  const sb = scoreHistoricoParaExemploRegra(b);
  if (sa !== sb) return sa > sb ? a : b;
  const na = normalizeExtratoRegraTexto(a);
  const nb = normalizeExtratoRegraTexto(b);
  return na.length <= nb.length ? a : b;
}

/** Limpa histórico misturado pelo OCR antes de gravar regra ou enviar à IA. */
export function sanitizarHistoricoExtratoParaRegra(
  raw: string,
  nature: 'D' | 'C' = 'D',
  coligadas: AiColigada[] = [],
): string {
  let s = normalizeExtratoRegraTexto(raw);
  if (!s) return '';
  if (!extratoHistoricoPareceMisturadoOcr(s) && extratoHistoricoEhPlausivel(s)) return s;
  const dominante = extrairFraseOperacionalDominante(s);
  if (dominante && extratoHistoricoEhPlausivel(dominante)) return dominante;
  const cleaned = limparHistoricoExtratoMisturado(s);
  if (
    cleaned &&
    extratoHistoricoEhPlausivel(cleaned) &&
    !extratoHistoricoPareceMisturadoOcr(cleaned)
  ) {
    return normalizeExtratoRegraTexto(cleaned);
  }
  const entity = extractRegraEntityDescricao(s, nature, coligadas);
  if (entity && !extratoHistoricoPareceMisturadoOcr(entity)) return entity;
  const padrao = extractPadraoOperacionalAgrupado(s, nature);
  if (padrao) return padrao;
  if (cleaned && extratoHistoricoEhPlausivel(cleaned)) {
    return normalizeExtratoRegraTexto(cleaned);
  }
  return s.slice(0, 60);
}

/**
 * Escolhe no plano conta OPERACIONAL especial (tarifa, imposto, coligada…).
 * NUNCA devolve conta nominal de empresa (fornecedor/cliente por razão social).
 */
export function bestPlanoContaForHistorico(
  description: string,
  plano: PlanoOptionLike[],
): string {
  const histTokens = new Set(tokensUteis(description));
  if (histTokens.size === 0 || plano.length === 0) return '';

  let bestCode = '';
  let bestScore = 0;

  for (const p of plano) {
    const red = sanitizeCodigoReduzido(p.codigoReduzido) || sanitizeCodigoReduzido(p.code);
    if (!red) continue;
    // Proibido: conta por nome de empresa (infla balancete)
    if (isContaNominalEmpresa(p.name) && !isContaOperacionalEspecial(p.name)) continue;

    const nameTokens = tokensUteis(p.name);
    if (nameTokens.length === 0) continue;

    let matched = 0;
    for (const nt of nameTokens) {
      for (const ht of histTokens) {
        if (tokensHistoricoContaCombinam(ht, nt)) {
          matched += 1;
          break;
        }
      }
    }
    if (matched === 0) continue;

    const score =
      matched * 20 +
      (matched === nameTokens.length ? 30 : 0) +
      nameTokens.length +
      (isContaOperacionalEspecial(p.name) ? 40 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestCode = red;
    }
  }

  return bestScore >= 25 ? bestCode : '';
}

/**
 * Conta GERAL: FORNECEDORES (saída) ou CLIENTES (entrada).
 * Preferência explícita por contas "DIVERSOS" / genéricas.
 */
export function pickFallbackContaPorNatureza(
  nature: 'D' | 'C',
  plano: PlanoOptionLike[],
): string {
  const prefer =
    nature === 'D'
      ? [
          /FORNECEDORES?\s+DIVERS/i,
          /FORNECEDORES?\s+NACION/i,
          /\bFORNECEDOR|\bFORN\b|DUPLICATA\s+A\s+PAGAR/i,
        ]
      : [
          /CLIENTES?\s+DIVERS/i,
          /CLIENTES?\s+NACION/i,
          /\bCLIENTES?\b|DUPLICATA\s+A\s+RECEBER|CONTAS\s+A\s+RECEBER/i,
        ];
  for (const re of prefer) {
    for (const p of plano) {
      const red = sanitizeCodigoReduzido(p.codigoReduzido) || sanitizeCodigoReduzido(p.code);
      if (!red) continue;
      if (isContaNominalEmpresa(p.name) && !isContaGeralFornecedorOuCliente(p.name)) continue;
      if (re.test(p.name)) return red;
    }
  }
  // Sem conta geral no plano → fundo fixo (nunca a primeira conta aleatória, ex. imposto).
  return pickFundoFixoCaixaConta(plano) || '';
}

/**
 * Conta de rendimento (crédito) ou aplicação financeira (débito/resgate).
 */
export function pickContaRendimentoOuAplicacao(
  nature: 'D' | 'C',
  plano: PlanoOptionLike[],
): string {
  const prefer =
    nature === 'C'
      ? [
          /RECEITA\s+FINANCEIRA|RENDIMENTO|JUROS.*APLIC|REND.*APLIC|RECEITA.*JUROS/i,
          /RECEITA\s+FINANCEIRA|RENDIMENTO|JUROS/i,
        ]
      : [
          /APLICACAO\s+FINANCEIRA|APLIC.*FINANCEIRA|CDB|RDB|INVESTIMENTO/i,
          /APLIC|CDB|RDB|RESGATE|INVEST/i,
        ];
  for (const re of prefer) {
    for (const p of plano) {
      const red = sanitizeCodigoReduzido(p.codigoReduzido) || sanitizeCodigoReduzido(p.code);
      if (!red) continue;
      if (isContaNominalEmpresa(p.name) && !isContaOperacionalEspecial(p.name)) continue;
      if (re.test(p.name)) return red;
    }
  }
  return '';
}

/**
 * Resolve contrapartida para cobertura automática:
 * fornecedor/cliente → SEMPRE conta geral; nunca por razão social.
 */
export function resolveContrapartidaAgrupada(input: {
  description: string;
  nature: 'D' | 'C';
  plano: PlanoOptionLike[];
  fallbackConta?: string;
  anexosTexto?: string[];
  coligadas?: AiColigada[];
}): string {
  const { description, nature, plano } = input;
  const coligadas = input.coligadas ?? [];
  const fallbackGlobal =
    resolveCodigoReduzidoDoPlano(input.fallbackConta || '', plano) ||
    sanitizeCodigoReduzido(input.fallbackConta || '') ||
    '';

  const coligadaHit = matchColigadaNoHistorico(description, coligadas);
  if (coligadaHit) {
    const coligConta = resolveContaColigadaParaNatureza(coligadaHit, nature, plano);
    if (coligConta) return coligConta;
    return pickFundoFixoCaixaConta(plano) || fallbackGlobal;
  }

  if (shouldUsarFundoFixoPendencia({ description, plano, anexosTexto: input.anexosTexto })) {
    return pickFundoFixoCaixaConta(plano) || fallbackGlobal;
  }

  if (isEmprestimoHistorico(description)) {
    const num = extractNumeroContratoHistorico(description);
    const porContrato = num ? pickContaEmprestimoPorContrato(num, plano) : '';
    if (porContrato) return porContrato;
  }

  if (isMovimentoAplicacaoFinanceira(description, nature)) {
    const aplic = pickContaRendimentoOuAplicacao(nature, plano);
    if (aplic) return aplic;
    const planoHit = bestPlanoContaForHistorico(description, plano);
    if (planoHit) return planoHit;
    return pickFundoFixoCaixaConta(plano) || fallbackGlobal;
  }

  // Pagamento/recebimento de terceiros → conta geral (não casa nome no plano)
  if (isLancamentoFornecedorOuClienteGenerico(description, nature, coligadas)) {
    return pickFallbackContaPorNatureza(nature, plano) || fallbackGlobal;
  }

  // Operacional (tarifa, imposto, empréstimo…): pode casar nome no plano
  return (
    bestPlanoContaForHistorico(description, plano) ||
    fallbackGlobal ||
    pickFallbackContaPorNatureza(nature, plano) ||
    ''
  );
}

/**
 * Gera regras locais agrupadas (cobertura 100%).
 * Fornecedor/cliente → padrões operacionais (PIX EMIT, PIX REC…) na conta GERAL.
 * Nunca cria uma regra por razão social nesses casos.
 */
export function buildFallbackRegrasParaCobertura(input: {
  uncovered: ExtratoLinhaParaRegra[];
  contaBanco: string;
  plano: PlanoOptionLike[];
  fallbackConta?: string;
  coligadas?: AiColigada[];
  anexosTexto?: string[];
}): ExtratoRegraConta[] {
  const out: ExtratoRegraConta[] = [];
  const seen = new Set<string>();
  const banco = input.contaBanco.trim();
  if (!banco) return out;
  const coligadas = input.coligadas ?? [];

  for (const row of input.uncovered) {
    const nature = row.nature === 'C' ? 'C' : 'D';
    // 1 regra por entidade (AJTF / PIX EMIT) — não por linha literal do extrato
    const desc = extractRegraEntityDescricao(row.description, nature, coligadas);
    if (!desc) continue;

    const contra = resolveContrapartidaAgrupada({
      description: row.description,
      nature,
      plano: input.plano,
      fallbackConta: input.fallbackConta,
      anexosTexto: input.anexosTexto,
      coligadas,
    });
    if (!contra) continue;

    const key = `${nature}|${normalizeExtratoMatchText(desc)}|${contra}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: crypto.randomUUID(),
      nome: desc.slice(0, 40),
      descricao: desc,
      nature,
      contaBanco: banco,
      contaContrapartida: contra,
    });
  }
  return out;
}

/**
 * Corrige regras salvas com conta inadequada (ex.: PIX REC → imposto de renda).
 */
export function corrigeRegrasContasOperacionaisInadequadas(input: {
  regras: ExtratoRegraConta[];
  plano: PlanoOptionLike[];
  coligadas?: AiColigada[];
}): ExtratoRegraConta[] {
  const { regras, plano } = input;
  const coligadas = input.coligadas ?? [];
  if (!regras.length || !plano.length) return regras;

  const planoByRed = new Map<string, PlanoOptionLike>();
  for (const p of plano) {
    const red = sanitizeCodigoReduzido(p.codigoReduzido) || sanitizeCodigoReduzido(p.code);
    if (red) planoByRed.set(red, p);
  }

  let changed = false;
  const next = regras.map((regra) => {
    const nature = regra.nature === 'C' ? ('C' as const) : ('D' as const);
    if (matchColigadaParaRegra(regra.descricao, coligadas)) return regra;

    const generico = isLancamentoFornecedorOuClienteGenerico(regra.descricao, nature, coligadas);
    if (!generico) return regra;

    const red =
      resolveCodigoReduzidoDoPlano(regra.contaContrapartida, plano) ||
      sanitizeCodigoReduzido(regra.contaContrapartida) ||
      '';
    const planoHit = red ? planoByRed.get(red) : undefined;
    if (!planoHit) return regra;

    const contaInadequada = !isContaGeralFornecedorOuCliente(planoHit.name);

    if (!contaInadequada) return regra;

    const melhor = pickFallbackContaPorNatureza(nature, plano);
    if (!melhor || melhor === red) return regra;

    changed = true;
    return { ...regra, contaContrapartida: melhor };
  });

  return changed ? next : regras;
}

/**
 * Corrige regras já salvas que apontam fornecedor/cliente para uma coligada.
 * Cruza descrição da regra e históricos do extrato que casam com ela.
 */
export function corrigeRegrasColigadasExistentes(input: {
  regras: ExtratoRegraConta[];
  plano: PlanoOptionLike[];
  coligadas: AiColigada[];
  extratoSample?: ExtratoLinhaParaRegra[];
}): ExtratoRegraConta[] {
  const { regras, plano, coligadas, extratoSample = [] } = input;
  if (!coligadas.length || !regras.length) return regras;

  const planoByRed = new Map<string, PlanoOptionLike>();
  for (const p of plano) {
    const red = sanitizeCodigoReduzido(p.codigoReduzido) || sanitizeCodigoReduzido(p.code);
    if (red) planoByRed.set(red, p);
  }

  let changed = false;
  const next = regras.map((regra) => {
    const nature = regra.nature === 'C' ? ('C' as const) : ('D' as const);
    let coligHit = matchColigadaParaRegra(regra.descricao, coligadas);

    const redEarly =
      resolveCodigoReduzidoDoPlano(regra.contaContrapartida, plano) ||
      sanitizeCodigoReduzido(regra.contaContrapartida) ||
      '';
    const planoHitEarly = redEarly ? planoByRed.get(redEarly) : undefined;

    if (!coligHit && isNomeColigadaInvalido(regra.descricao) && planoHitEarly) {
      coligHit = coligadas.find((c) => contaCombinaComColigada(planoHitEarly.name, c)) ?? null;
      if (!coligHit) {
        for (const c of coligadas) {
          if (findHistoricoExtratoParaColigada(c, extratoSample, nature)) {
            coligHit = c;
            break;
          }
        }
      }
    }

    if (!coligHit && extratoSample.length > 0) {
      const historicoMatches: string[] = [];
      for (const row of extratoSample) {
        if ((row.nature === 'C' ? 'C' : 'D') !== nature) continue;
        const hit = matchExtratoRegraConta(row.description, nature, [regra]);
        if (!hit) continue;
        historicoMatches.push(row.description);
      }
      if (historicoMatches.length > 0) {
        coligHit = matchColigadaParaRegra(regra.descricao, coligadas, historicoMatches);
      }
    }

    if (!coligHit) return regra;

    const red =
      resolveCodigoReduzidoDoPlano(regra.contaContrapartida, plano) ||
      sanitizeCodigoReduzido(regra.contaContrapartida) ||
      '';
    const planoHit = red ? planoByRed.get(red) : undefined;
    const nomeConta = planoHit?.name || '';
    const contaErrada = !nomeConta || !contaAceitavelParaColigada(nomeConta, coligHit);

    const descCanon = resolveDescricaoRegraColigada(coligHit, extratoSample, nature, regras);
    const descErrada =
      isNomeColigadaInvalido(regra.descricao) ||
      (normalizeExtratoRegraTexto(regra.descricao) !== descCanon &&
        !matchColigadaNoHistorico(regra.descricao, coligadas));
    const coligConta = resolveContaColigadaParaNatureza(coligHit, nature, plano);

    if (!contaErrada && !descErrada) return regra;
    if (!coligConta) return regra;

    changed = true;
    return {
      ...regra,
      nome: descCanon.slice(0, 40),
      descricao: descCanon,
      contaContrapartida: coligConta || regra.contaContrapartida,
    };
  });

  return changed ? next : regras;
}
