import type { ExtratoRegraConta } from './extratoRegrasContasStorage';
import {
  competenciaAceitaData,
  isRegraPorDocumento,
  isRegraPorValor,
  normalizeExtratoMatchText,
  normalizeRegraValor,
  regraValorCombina,
  somenteDigitos,
} from './extratoRegrasContasStorage';

/**
 * Regra por VALOR vence qualquer regra por histórico: o usuário apontou o
 * lançamento exato (valor + natureza), não há match mais específico que isso.
 */
const SCORE_REGRA_POR_VALOR = 10000;

/** Documento completo no histórico — evidência tão forte quanto o valor exato. */
const SCORE_DOCUMENTO_COMPLETO = 9000;
/** Fragmento (CPF mascarado: só o começo ou só o fim aparece no histórico). */
const SCORE_DOCUMENTO_FRAGMENTO = 7000;

/**
 * Menor pedaço de documento aceito no histórico. Abaixo de 5 dígitos o risco de
 * casar com NSU/agência/valor é grande demais.
 */
const DOC_MIN_FRAGMENTO = 5;

/** Sequências de dígitos do histórico (o banco imprime CPF de várias formas). */
function digitRunsDoHistorico(historico: string): string[] {
  return (historico.match(/\d+/g) ?? []).filter((r) => r.length >= DOC_MIN_FRAGMENTO);
}

/**
 * Casa o documento da regra (CPF/RG) com o histórico, tolerando MASCARAMENTO.
 *
 * O banco quase sempre imprime o CPF parcialmente ("***.456.789-**",
 * "CPF 123.456.***-**"): sobra um pedaço contíguo do começo OU do fim do
 * número. Por isso a busca vai ENCURTANDO o documento — primeiro o número
 * inteiro, depois prefixos e sufixos cada vez menores — e para no primeiro
 * pedaço que aparece no histórico.
 *
 * Devolve 0 quando não casa; quanto maior o pedaço reconhecido, maior o score.
 */
export function scoreDocumentoNoHistorico(historico: string, documentoRegra: string): number {
  const doc = somenteDigitos(documentoRegra);
  if (doc.length < DOC_MIN_FRAGMENTO) return 0;

  const runs = digitRunsDoHistorico(historico);
  if (runs.length === 0) return 0;

  // 1) Documento inteiro — solto no texto ou colado com pontuação
  //    ("123.456.789-00" vira um run só depois de juntar os dígitos da linha).
  const todosDigitos = historico.replace(/\D/g, '');
  if (runs.includes(doc) || todosDigitos.includes(doc)) {
    return SCORE_DOCUMENTO_COMPLETO + doc.length;
  }

  // 2) Encurtando: prefixos e sufixos do documento, do maior para o menor.
  for (let len = doc.length - 1; len >= DOC_MIN_FRAGMENTO; len--) {
    const prefixo = doc.slice(0, len);
    const sufixo = doc.slice(doc.length - len);
    for (const run of runs) {
      // O pedaço precisa ser o run inteiro (o resto do número está mascarado)
      // ou aparecer dentro de um run maior do próprio documento.
      if (run === prefixo || run === sufixo) return SCORE_DOCUMENTO_FRAGMENTO + len;
    }
    if (todosDigitos.includes(prefixo) || todosDigitos.includes(sufixo)) {
      return SCORE_DOCUMENTO_FRAGMENTO + len - 1;
    }
  }

  // 3) Pedaço do MEIO do documento (máscara que tapa as pontas) — exige mais
  //    dígitos para não casar por acaso.
  for (const run of runs) {
    if (run.length >= 8 && doc.includes(run)) return SCORE_DOCUMENTO_FRAGMENTO - 500 + run.length;
  }
  return 0;
}

export type ExtratoRegraContaMatch = ExtratoRegraConta & { score: number };

const STOP_TOKENS = new Set([
  'DE',
  'DA',
  'DO',
  'DOS',
  'DAS',
  'E',
  'OUTRA',
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
]);

/**
 * Palavras genéricas de razão social — sozinhas (ou combinadas só entre si) não
 * identificam uma empresa específica. Ex.: "COMERCIO" aparece tanto em
 * "IMPERIO COMERCIO LTDA" quanto em "A ECONOMICA COMERCIO"; uma regra cujo
 * texto seja só isso não pode "vencer" e capturar histórico de outra empresa.
 */
const GENERIC_ENTITY_WORDS = new Set([
  'COMERCIO',
  'COMERCIAL',
  'SERVICOS',
  'SERVICO',
  'INDUSTRIA',
  'INDUSTRIAL',
  'GRUPO',
  'HOLDING',
  'EMPREENDIMENTOS',
  'PARTICIPACOES',
  'TRANSPORTES',
  'LOGISTICA',
  'DISTRIBUIDORA',
  'ATACADO',
  'VAREJO',
  'ALIMENTOS',
  'REPRESENTACOES',
  'REPRESENTACAO',
]);

/**
 * Especificidade da regra — domina a escolha do melhor match.
 *
 * ESPECIFICA: o texto nomeia a contraparte ("PIX JOAO", "IMPERIO COMERCIO").
 * AMPLA: o texto só descreve o tipo da operação ("PIX", "PIX REC",
 *        "TRANSFERENCIA") ou é só palavra genérica de razão social.
 *
 * Uma regra AMPLA nunca vence uma ESPECIFICA, qualquer que seja o score: ela é
 * catch-all e só recolhe o que nenhuma regra detalhada capturou. É isso que
 * garante que a regra "PIX" não roube o histórico "PIX JOAO" da regra
 * "PIX JOAO" — mesmo quando o score bruto da ampla seria maior por casar o
 * texto inteiro como palavra e o da detalhada cair no score por token.
 */
const ESPECIFICIDADE_AMPLA = 0;
const ESPECIFICIDADE_ESPECIFICA = 1;

function especificidadeDaRegra(descNorm: string): number {
  const tokens = descNorm.split(/\s+/).filter(Boolean);
  if (!tokens.length) return ESPECIFICIDADE_AMPLA;
  return tokens.some(isDistinctiveToken) ? ESPECIFICIDADE_ESPECIFICA : ESPECIFICIDADE_AMPLA;
}

/**
 * Palavras de operação bancária — descrevem o TIPO do lançamento, não a
 * contraparte. Não podem contar como evidência de match: senão a regra
 * "PIX ENVIADO IMPERIO" casa com "PIX ENVIADO A ECONOMICA" só porque
 * "ENVIADO" aparece nos dois históricos.
 */
const OPERATION_TOKENS = new Set([
  'ENVIADO',
  'ENVIADA',
  'ENVIO',
  'ENV',
  'REC',
  'EMIT',
  'EMITIDO',
  'PGTO',
  'PAGTO',
  'PAGO',
  'SAIDA',
  'ENTRADA',
  'DEBITO',
  'CREDITO',
  'DEB',
  'CRED',
  'TRANSF',
  'LIQUIDACAO',
  'LIQ',
  'COMPENSACAO',
  'BOLETO',
  'BOLETOS',
  'TITULO',
  'TITULOS',
  'TARIFA',
  'COBRANCA',
]);

/** Valores, datas e códigos numéricos variam a cada lançamento — não identificam contraparte. */
function isNumericLikeToken(t: string): boolean {
  return /^\d+$/.test(t) || /^\d+[.,/-]\d+/.test(t);
}

/** Token que realmente identifica a contraparte (nome de empresa/pessoa). */
function isDistinctiveToken(t: string): boolean {
  return (
    !STOP_TOKENS.has(t) &&
    !GENERIC_ENTITY_WORDS.has(t) &&
    !OPERATION_TOKENS.has(t) &&
    !isNumericLikeToken(t)
  );
}

/** Tokens discriminadores — se o histórico tem um e a regra outro, não misturar. */
const DISCRIMINATOR_PAIRS: Array<[string, string]> = [
  ['CLIMATIZACAO', 'REFRIGERACAO'],
  ['CLIMATIZACAO', 'REFRIGER'],
  ['REFRIGERACAO', 'CLIMATIZ'],
];

function tokenizeDescricao(descricao: string): string[] {
  return normalizeExtratoMatchText(descricao)
    .split(/\s+/)
    .filter(
      (t) =>
        (t.length >= 3 || (t.length >= 2 && /[A-Z]/.test(t) && /\d/.test(t))) &&
        !STOP_TOKENS.has(t),
    );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `needle` aparece em `haystack` como palavra/frase inteira, nunca colado dentro de outra palavra. */
function containsAsWholeToken(haystack: string, needle: string): boolean {
  if (!needle) return false;
  try {
    return new RegExp(`(?:^|[^A-Z0-9])${escapeRegExp(needle)}(?:[^A-Z0-9]|$)`).test(haystack);
  } catch {
    return haystack.includes(needle);
  }
}

/** Compacta "A J T F" / "A.J.T.F" → "AJTF" (local, sem import circular). */
function compactKey(text: string): string {
  const upper = normalizeExtratoMatchText(text);
  if (!upper) return '';
  const collapsed = upper.replace(/\b([A-Z])(?:\s+([A-Z]))+\b/g, (m) => m.replace(/\s+/g, ''));
  return collapsed.replace(/\s+/g, '');
}

/** Regra canônica curta (AJTF) — não nomes longos tipo POLO SUL CLIMATIZACAO. */
function isCompactEntityDescricao(descNorm: string): boolean {
  const key = compactKey(descNorm);
  return key.length >= 3 && key.length <= 12 && /^[A-Z0-9]+$/.test(key) && !/\s/.test(descNorm);
}

/**
 * AJTF casa com "A J T", "A J T F", "A.J.T.F" no histórico.
 * Só para regras compactas (evita falso positivo em nomes longos).
 */
function compactEntityMatchesHistorico(historico: string, entity: string): boolean {
  const entityKey = compactKey(entity);
  if (entityKey.length < 3 || entityKey.length > 12 || !/^[A-Z0-9]+$/.test(entityKey)) {
    return false;
  }
  const histNorm = normalizeExtratoMatchText(historico);
  const histKey = compactKey(histNorm);
  if (histKey === entityKey) return true;
  // Sigla >=4 pode estar colada sem espaço (ex.: OCR "AJTFCOM LTDA" → histKey "AJTFCOMLTDA");
  // abaixo disso o risco de casar dentro de outra palavra é alto demais.
  if (entityKey.length >= 4 && histKey.includes(entityKey)) return true;
  if (containsAsWholeToken(histNorm, entity)) return true;

  // Sequências de letras soltas: "A J T" / "A J T F"
  const singles = histNorm.match(/\b(?:[A-Z](?:\s+[A-Z]){1,11})\b/g);
  if (singles) {
    for (const s of singles) {
      const key = s.replace(/\s+/g, '');
      if (key.length < 3) continue;
      // Sigla espaçada precisa bater exatamente com a regra (evita "AJT" casar com "AJTF").
      if (key === entityKey) return true;
    }
  }

  // Letras espaçadas no meio do texto: A.J.T.F já vira AJTF via compactKey
  if (entityKey.length >= 3 && entityKey.length <= 8) {
    const spaced = entityKey.split('').join('\\s*');
    try {
      if (new RegExp(`(?:^|\\s)${spaced}(?:\\s|$)`).test(histNorm)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

/** Sinônimos bancários para casar regra operacional com histórico. */
const TOKEN_SYNONYMS: Record<string, string[]> = {
  EMIT: ['EMIT', 'ENVIADO', 'ENV', 'PAG', 'SAIDA'],
  ENVIADO: ['ENVIADO', 'EMIT', 'ENV', 'PAG'],
  ENV: ['ENV', 'ENVIADO', 'EMIT'],
  REC: ['REC', 'RECEBIDO', 'RECEBIMENTO'],
  RECEBIDO: ['RECEBIDO', 'REC', 'RECEBIMENTO'],
  RECEBIMENTO: ['RECEBIMENTO', 'RECEBIDO', 'REC'],
  BOLETO: ['BOLETO', 'BOLETOS'],
  BOLETOS: ['BOLETO', 'BOLETOS'],
  TITULO: ['TITULO', 'TITULOS'],
  TITULOS: ['TITULO', 'TITULOS'],
};

const RE_PAGAMENTO_TITULO =
  /BOLETO|TITULO|COMPE|SISPAG|DIFTIT|DEB\.?\s*PGTO|DEB\.?\s*TIT|PGTO\.?\s*BOLETO/;

function expandTokenVariants(token: string): string[] {
  const t = token.toUpperCase();
  return TOKEN_SYNONYMS[t] ?? [t];
}

function tokenMatchesHistorico(historico: string, token: string): boolean {
  if (token.length < 3) return false;
  for (const variant of expandTokenVariants(token)) {
    if (historico.includes(` ${variant} `)) return true;
    if (historico.startsWith(`${variant} `)) return true;
    if (historico.endsWith(` ${variant}`)) return true;
    if (historico === variant) return true;
  }
  return false;
}

function hasDiscriminatorConflict(historico: string, regraTokens: string[]): boolean {
  const histTokens = new Set(tokenizeDescricao(historico));
  for (const [a, b] of DISCRIMINATOR_PAIRS) {
    const histHasA = [...histTokens].some((t) => t.includes(a) || a.includes(t));
    const histHasB = [...histTokens].some((t) => t.includes(b) || b.includes(t));
    const regraHasA = regraTokens.some((t) => t.includes(a) || a.includes(t));
    const regraHasB = regraTokens.some((t) => t.includes(b) || b.includes(t));
    if (histHasA && regraHasB && !regraHasA) return true;
    if (histHasB && regraHasA && !regraHasB) return true;
  }
  return false;
}

const HIST_EXCLUSIVO_CATCHALL =
  /TARIFA|IOF|IMPOSTO|TRIBUTO|DARF|FOLHA|SALARIO|EMPREST|RENDIMENTO|REND\s+PAGO|BB\s+RENDE|RENDE\s+FACIL|APLIC|CDB|RESGATE|OUROCAP|AUT\s+MAIS|TRANSFERENCIA|TRANSF\b/;

function scorePadraoOperacionalAgrupado(historico: string, descNorm: string): number {
  if (
    descNorm === 'BOLETO' ||
    descNorm === 'BOLETOS' ||
    descNorm === 'TITULO' ||
    descNorm === 'TITULOS' ||
    descNorm === 'PAGAMENTO BOLETO' ||
    descNorm === 'PAGAMENTO BOLETOS' ||
    descNorm === 'PAGAMENTO TITULO' ||
    descNorm === 'PAGAMENTO TITULOS'
  ) {
    if (RE_PAGAMENTO_TITULO.test(historico)) return 360;
    return 0;
  }
  if (descNorm === 'RENDIMENTO APLICACAO') {
    if (
      /RENDIMENTO|REND\s+PAGO|BB\s+RENDE|RENDE\s+FACIL|AUT\s+MAIS|OUROCAP|REND\s+PAGO\s+APLIC/.test(
        historico,
      )
    ) {
      return 420;
    }
    return 0;
  }
  if (descNorm === 'APLICACAO FINANCEIRA') {
    if (/APLIC|CDB|RDB|RESGATE|BB\s+RENDE|RENDE\s+FACIL|OUROCAP|AUT\s+MAIS/.test(historico)) {
      return 410;
    }
    return 0;
  }
  if (descNorm === 'TARIFA BANCARIA') {
    if (/TARIFA|PACOTE\s+SERV|CESTA|ANUIDADE/.test(historico)) return 400;
    return 0;
  }
  if (descNorm === 'PIX REC' || descNorm === 'RECEBIMENTO CLIENTE') {
    if (HIST_EXCLUSIVO_CATCHALL.test(historico)) return 0;
    if (/PIX/.test(historico) && descNorm === 'PIX REC') return 200;
    return 130;
  }
  if (descNorm === 'PIX EMIT' || descNorm === 'PAGAMENTO FORNECEDOR') {
    if (HIST_EXCLUSIVO_CATCHALL.test(historico)) return 0;
    if (/PIX/.test(historico) && descNorm === 'PIX EMIT') return 200;
    return 130;
  }
  return 0;
}

function scoreRegraNoHistorico(historico: string, regra: ExtratoRegraConta): number {
  const descNorm = normalizeExtratoMatchText(regra.descricao);
  if (!descNorm || !historico) return 0;

  // Regra ampla ("PIX", "PIX REC", "TRANSFERENCIA") NÃO é bloqueada aqui: ela
  // deve capturar o histórico normalmente. O que impede que ela roube um
  // lançamento de uma regra detalhada é a especificidade aplicada em
  // matchExtratoRegraConta — ampla só vence quando nenhuma detalhada casou.
  const padraoScore = scorePadraoOperacionalAgrupado(historico, descNorm);
  if (padraoScore > 0) return padraoScore;

  const tokens = tokenizeDescricao(descNorm);
  if (hasDiscriminatorConflict(historico, tokens.length ? tokens : [descNorm])) {
    return 0;
  }

  // Só regras curtas (AJTF): 1 regra → N lançamentos via aliases / letras espaçadas
  if (isCompactEntityDescricao(descNorm) && compactEntityMatchesHistorico(historico, descNorm)) {
    return 450 + 80 + Math.min(descNorm.length, 40);
  }

  // Match exato / substring — favorece nome completo
  if (historico === descNorm) return 500 + descNorm.length;
  if (containsAsWholeToken(historico, descNorm)) return 400 + descNorm.length * 2;
  // Regra curta cabe no início do histórico (ex.: "TED RECEBIDA" em "TED RECEBIDA CLIENTE X")
  if (descNorm.length >= 4 && historico.startsWith(`${descNorm} `)) {
    return 380 + descNorm.length * 2;
  }
  // Regra digitada manualmente: o usuário escreveu esse texto de propósito para
  // capturar o lançamento — mesmo que ele fique colado dentro de outra palavra
  // no histórico (ex.: regra "POLO SUL CL" dentro de "POLO SUL CLIMATIZACAO"),
  // se o texto aparece literalmente já é sinal forte de que é a mesma conta.
  if (descNorm.length >= 4 && historico.includes(descNorm)) {
    return 340 + descNorm.length * 2;
  }

  // Só tokens de stop (PIX/TED/RECEBIDO): ainda casa se a frase da regra aparecer
  if (!tokens.length) {
    const rawTokens = normalizeExtratoMatchText(descNorm)
      .split(/\s+/)
      .filter((t) => t.length >= 2);
    if (rawTokens.length === 0) return 0;

    // Se o histórico possui tokens distintivos de empresa (ex: POLO, CLIMATIZACAO),
    // uma regra sem tokens distintivos NÃO pode casar a menos que a frase inteira da regra apareça contígua.
    const histDistinctive = tokenizeDescricao(historico).filter(isDistinctiveToken);
    if (histDistinctive.length > 0) {
      if (containsAsWholeToken(historico, descNorm) || historico.startsWith(`${descNorm} `)) {
        return 200 + descNorm.length;
      }
      return 0;
    }

    const allPresent = rawTokens.every(
      (t) =>
        historico === t ||
        historico.startsWith(`${t} `) ||
        historico.includes(` ${t} `) ||
        historico.includes(` ${t}`),
    );
    return allPresent ? 200 + descNorm.length : 0;
  }

  let matched = 0;
  for (const tok of tokens) {
    if (tokenMatchesHistorico(historico, tok)) matched++;
  }

  // Só o NOME da contraparte identifica a regra: palavras de operação
  // (ENVIADO/PGTO), termos genéricos (COMERCIO/LTDA) e números (valor/data)
  // não contam como evidência. TODOS os tokens distintivos precisam estar no
  // histórico — "PIX ENVIADO IMPERIO" nunca casa com "PIX ENVIADO A ECONOMICA".
  const distintivos = tokens.filter(isDistinctiveToken);
  if (!distintivos.length) return 0;
  for (const tok of distintivos) {
    if (!tokenMatchesHistorico(historico, tok)) return 0;
  }

  // Bonus por especificidade: mais tokens da regra + cobertura do histórico
  const histTokens = tokenizeDescricao(historico);
  const histCovered = histTokens.filter((ht) =>
    tokens.some((rt) => ht.includes(rt) || rt.includes(ht) || tokenMatchesHistorico(historico, rt)),
  ).length;

  return matched * 40 + descNorm.length + histCovered * 15 + tokens.length * 10;
}

/** Aplica regra personalizada quando a descrição do extrato contém o texto cadastrado. */
export function matchExtratoRegraConta(
  historicoNormalizado: string,
  nature: 'D' | 'C',
  regras: ExtratoRegraConta[] | null | undefined,
  /** Valor do lançamento — habilita as regras cadastradas por valor. */
  valorLinha?: number,
  /** Data do lançamento (ISO ou BR) — aplica a janela de competência das regras. */
  dataLinha?: string,
): ExtratoRegraContaMatch | null {
  if (!regras?.length) return null;

  /** Regra amarrada a uma competência só vale nas datas da janela dela. */
  const dentroDaCompetencia = (regra: ExtratoRegraConta) =>
    competenciaAceitaData(regra.competencia, regra.competenciaJanela, dataLinha);

  const elegivel = (regra: ExtratoRegraConta) =>
    Boolean(regra.contaContrapartida.trim()) && regra.nature === nature && dentroDaCompetencia(regra);

  // 1) Regras por VALOR — casamento exato (valor + natureza), tem prioridade.
  if (normalizeRegraValor(valorLinha) !== undefined) {
    for (const regra of regras) {
      if (!elegivel(regra) || !isRegraPorValor(regra)) continue;
      if (regraValorCombina(regra.valor, valorLinha)) {
        return { ...regra, score: SCORE_REGRA_POR_VALOR };
      }
    }
  }

  const hist = normalizeExtratoMatchText(historicoNormalizado);
  if (!hist) return null;

  // 2) Regras por DOCUMENTO (CPF/RG no histórico) — vence o casamento por texto.
  //    Entre várias, ganha a que reconheceu o maior pedaço do documento.
  let melhorDoc: ExtratoRegraContaMatch | null = null;
  for (const regra of regras) {
    if (!elegivel(regra) || !isRegraPorDocumento(regra)) continue;
    const score = scoreDocumentoNoHistorico(hist, regra.documento ?? '');
    if (score > 0 && (!melhorDoc || score > melhorDoc.score)) {
      melhorDoc = { ...regra, score };
    }
  }
  if (melhorDoc) return melhorDoc;

  type Candidata = {
    regra: ExtratoRegraConta;
    score: number;
    descNorm: string;
    especificidade: number;
  };

  const candidatas: Candidata[] = [];
  for (const regra of regras) {
    if (!elegivel(regra)) continue;
    // Regra por valor/documento nunca casa por texto — o histórico ali é só referência.
    if (isRegraPorValor(regra) || isRegraPorDocumento(regra)) continue;
    const score = scoreRegraNoHistorico(hist, regra);
    if (score <= 0) continue;
    const descNorm = normalizeExtratoMatchText(regra.descricao);
    candidatas.push({
      regra,
      score,
      descNorm,
      especificidade: especificidadeDaRegra(descNorm),
    });
  }
  if (!candidatas.length) return null;

  // Uma regra que ESTENDE outra é, por definição, a mais detalhada: "PIX JOAO"
  // estende "PIX", "JOAO SILVA" estende "JOAO". Nesse caso a mais curta é
  // descartada sem olhar score — é ela que estava roubando o lançamento.
  const finais = candidatas.filter(
    (c) =>
      !candidatas.some(
        (outra) =>
          outra.descNorm !== c.descNorm && containsAsWholeToken(outra.descNorm, c.descNorm),
      ),
  );
  const elegiveis = finais.length ? finais : candidatas;

  // Desempate restante: detalhada antes de ampla, depois maior score, depois
  // o texto mais longo.
  let best: Candidata | null = null;
  for (const c of elegiveis) {
    const vence =
      !best ||
      c.especificidade > best.especificidade ||
      (c.especificidade === best.especificidade &&
        (c.score > best.score ||
          (c.score === best.score && c.regra.descricao.length > best.regra.descricao.length)));
    if (vence) best = c;
  }

  return best ? { ...best.regra, score: best.score } : null;
}
