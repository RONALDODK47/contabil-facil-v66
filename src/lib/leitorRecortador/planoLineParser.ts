/**
 * Parser de linha do plano de contas Domínio (relatório PDF).
 * Extrai código, descrição, tipo e nível a partir do texto completo da linha.
 */
import { looksLikePlanoClassificacao, stripTrailingPlanoTipoFromName } from './planoDominioRowParser';
import { isCnpjLike } from '../cnpjGuard';
export type PlanoParsedLine = {
  codigoReduzido?: string;
  code: string;
  name: string;
  tipo?: 'S' | 'A';
  nivel?: number;
};

const RE_CLASSIFICACAO = /\d+(?:\.\d+){1,}/;

function isPlanoCodeToken(code: string): boolean {
  const c = code.replace(/\s/g, '');
  return /^\d+(?:\.\d+)*$/.test(c) && c.length >= 1;
}

function normalizeLine(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Rótulos de coluna/cabeçalho do relatório Domínio — não são nomes de conta. */
export function isPlanoHeaderLabel(text: string): boolean {
  const t = stripAccents(text.trim().toLowerCase().replace(/[*_]/g, ''));
  if (!t) return true;
  if (
    /^(nome|classificacao|codigo|reduzido|tipo|grau|nivel|conta|t|s|a|plano de contas)$/.test(
      t,
    )
  ) {
    return true;
  }
  if (/^classifica/.test(t) && t.length <= 16) return true;
  return false;
}

/** Linha de metadado/cabeçalho/rodapé do PDF Domínio (não é conta). */
export function isPlanoMetadataLine(line: string): boolean {
  const t = line.toLowerCase().replace(/\s+/g, ' ');
  const tNorm = stripAccents(t);
  const hasClassificacaoConta = RE_CLASSIFICACAO.test(line.replace(/\s/g, ''));

  // CNPJ em qualquer formato é sempre metadata (cabeçalho/rodapé) — nunca uma conta
  if (/\d{2}\.?\d{3}\.?\d{3}[\/\-]?\d{4}[\-]?\d{2}/.test(line)) return true;

  if (/sistema\s+licenciado|inov\s+consultoria/i.test(t)) return true;
  if (/\bemiss[ãa]o\s*:/i.test(t)) return true;
  if (/\bp[áa]gina\s*:?\s*\d+|\bdata\s*:\s*\d{2}\/\d{2}\/\d{2,4}/i.test(t)) return true;
  if (/^c[oó]digo\s+t\s+classifica|^nome\s+grau$/i.test(tNorm.replace(/\s+/g, ' '))) return true;

  // Cabeçalho de página: razão social + FOLHA (com ou sem asteriscos).
  if (/\bfolha\b/i.test(t) && !hasClassificacaoConta) return true;
  if (/\b(?:ltda|ltd|s\.?a\.?|eireli)\b/i.test(t) && /\bfolha\b/i.test(t)) return true;

  // Só rótulos de coluna na linha (ex.: "Classificação" / "NOME").
  const tokens = tNorm
    .replace(/[*_:]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
  if (tokens.length > 0 && tokens.length <= 4 && tokens.every((w) => isPlanoHeaderLabel(w))) {
    return true;
  }
  if (isPlanoHeaderLabel(tNorm.replace(/[*_:]/g, ' '))) return true;

  if (/c\.?\s*n\.?\s*p\.?\s*j|empresa\s*:|plano\s+de\s+contas/i.test(t)) {
    if (!hasClassificacaoConta) return true;
  }
  return false;
}

/** Conta válida após extração por colunas + parse da linha. */
export function isValidPlanoDominioAccountRow(
  fields: Record<string, string>,
  lineText: string,
): boolean {
  const linha = normalizeLine(lineText);
  if (!linha || isPlanoMetadataLine(linha)) return false;

  const parsed = parsePlanoDominioLineText(linha);
  if (parsed) return !isPlanoHeaderLabel(parsed.name);

  const code = (fields.codigoClassificacao || fields.classificacao || '').trim();
  const reduzido = (fields.codigoReduzido || '').trim();
  const name = (fields.descricao || fields.nomeConta || '').trim();

  if (!code || !name) return false;
  // Uma conta VÁLIDA precisa TER AMBOS código reduzido E classificação
  if (!reduzido) return false;

  if (isPlanoHeaderLabel(code) || isPlanoHeaderLabel(name)) return false;
  if (!isPlanoCodeToken(code)) return false;
  if (!isPlanoCodeToken(reduzido)) return false;
  if (/\bfolha\b/i.test(name) && !isPlanoCodeToken(code)) return false;
  return name.length >= 2;
}

/**
 * CNPJ do rodapé, completo (58.952.046/0001-90) ou truncado no primeiro
 * separador (58.952.046) — regex de extração sem âncora pega só o pedaço
 * pré-barra, que tem poucos dígitos e escaparia de um guard só por tamanho.
 */
function codeLooksLikeCnpj(code: string): boolean {
  if (isCnpjLike(code)) return true;
  if (code.replace(/\D/g, '').length >= 13) return true;
  // Raiz do CNPJ truncada no separador (ex.: "44.854.551" de "44.854.551/0001-98") —
  // agrupamento 2.3.3 é exclusivo de CNPJ; nenhuma classificação de plano de contas usa esse formato.
  if (/^\d{2}\.\d{3}\.\d{3}$/.test(code.trim())) return true;
  return false;
}

function extractNameAfterCode(line: string, code: string): string {
  const codeEsc = code.replace(/\./g, '\\.');
  const withNivel = line.match(new RegExp(`${codeEsc}\\s+(.+?)\\s+([1-6])\\s*$`, 'i'));
  if (withNivel?.[1]) {
    return withNivel[1].replace(/\s+[SA]\s*$/i, '').trim();
  }
  const afterCode = line.match(new RegExp(`${codeEsc}\\s+(.+)$`, 'i'));
  if (afterCode?.[1]) {
    return afterCode[1]
      .replace(/\s+[SA]\s*$/i, '')
      .replace(/\s+[1-6]\s*$/i, '')
      .trim();
  }

  let rest = line
    .replace(/^\s*1\s+/, '')
    .replace(new RegExp(`\\b${codeEsc}\\b`), ' ')
    .replace(/\b\d{1,7}\b/g, ' ')
    .replace(/\b[SA]\b/gi, ' ')
    .replace(/\b[1-6]\b\s*$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (rest.length >= 2 && /[A-Za-zÀ-ÿ]{2,}/.test(rest)) return rest;
  return '';
}

/** Valida resultado do parse: rejeita CNPJ de rodapé e nomes que não são contas. */
function validateParsedLine(parsed: PlanoParsedLine): PlanoParsedLine | null {
  if (codeLooksLikeCnpj(parsed.code)) return null;
  if (/^emiss[ãa]o\b/i.test(parsed.name)) return null;
  if (/^\d{2}\/\d{2}\/\d{2,4}$/.test(parsed.name.trim())) return null;
  if (isPlanoHeaderLabel(parsed.name)) return null;
  if (/\bfolha\b/i.test(parsed.name) && !RE_CLASSIFICACAO.test(parsed.code)) return null;
  return parsed;
}

/** Infere campos do plano a partir do texto integral da linha (formato Domínio). */
export function parsePlanoDominioLineText(raw: string): PlanoParsedLine | null {
  const line = normalizeLine(raw);
  if (!line || isPlanoMetadataLine(line)) return null;

  const dominioTabular = line.match(/^(\d{1,7})\s+([SA])\s+(\d[\d.]{0,24})\s+(.+?)(?:\s+([1-6]))?\s*$/i);
  const dominioRelatorioSa = line.match(
    /^(?:1\s+)?(\d{1,7})\s+([SA])\s+(\d+(?:\.\d+)*)\s+(.+?)\s+([1-6])\s*$/i,
  );
  const dominioRelatorioAnalitica = line.match(
    /^(?:1\s+)?(\d{1,7})\s+(\d+(?:\.\d+){1,})\s+(.+?)\s+([1-6])\s*$/i,
  );
  const dominioSemReduzidoSa = line.match(/^(\d+(?:\.\d+){1,})\s+([SA])\s+(.+?)\s+([1-6])\s*$/i);
  const dominioSemReduzidoAnalitica = line.match(/^(\d+(?:\.\d+){1,})\s+(.+?)\s+([1-6])\s*$/i);
  const dominioSinteticaSoTipo = line.match(/^([SA])\s+(\d+(?:\.\d+)*)\s+(.+?)\s+([1-6])\s*$/i);
  const dominioComTipo = line.match(/^(\d{5,7})\s+(\d[\d.\s]{2,24})\s+(.+?)\s+([SA])\s*$/i);
  const dominioSemTipo = line.match(/^(\d{5,7})\s+(\d[\d.\s]{2,24})\s+(.+)$/i);

  if (dominioTabular) {
    return validateParsedLine({
      codigoReduzido: dominioTabular[1],
      code: dominioTabular[3]!.replace(/\s/g, ''),
      name: dominioTabular[4]!.trim(),
      tipo: dominioTabular[2]!.toUpperCase() as 'S' | 'A',
      nivel: dominioTabular[5] ? parseInt(dominioTabular[5], 10) : undefined,
    });
  }
  if (dominioRelatorioSa) {
    return validateParsedLine({
      codigoReduzido: dominioRelatorioSa[1],
      code: dominioRelatorioSa[3]!,
      name: dominioRelatorioSa[4]!.trim(),
      tipo: dominioRelatorioSa[2]!.toUpperCase() as 'S' | 'A',
      nivel: parseInt(dominioRelatorioSa[5]!, 10),
    });
  }
  if (dominioRelatorioAnalitica) {
    return validateParsedLine({
      codigoReduzido: dominioRelatorioAnalitica[1],
      code: dominioRelatorioAnalitica[2]!,
      name: dominioRelatorioAnalitica[3]!.trim(),
      nivel: parseInt(dominioRelatorioAnalitica[4]!, 10),
    });
  }
  if (dominioSemReduzidoSa) {
    return validateParsedLine({
      code: dominioSemReduzidoSa[1]!,
      name: dominioSemReduzidoSa[3]!.trim(),
      tipo: dominioSemReduzidoSa[2]!.toUpperCase() as 'S' | 'A',
      nivel: parseInt(dominioSemReduzidoSa[4]!, 10),
    });
  }
  if (dominioSemReduzidoAnalitica) {
    return validateParsedLine({
      code: dominioSemReduzidoAnalitica[1]!,
      name: dominioSemReduzidoAnalitica[2]!.trim(),
      nivel: parseInt(dominioSemReduzidoAnalitica[3]!, 10),
    });
  }
  if (dominioSinteticaSoTipo) {
    return validateParsedLine({
      code: dominioSinteticaSoTipo[2]!,
      name: dominioSinteticaSoTipo[3]!.trim(),
      tipo: dominioSinteticaSoTipo[1]!.toUpperCase() as 'S' | 'A',
      nivel: parseInt(dominioSinteticaSoTipo[4]!, 10),
    });
  }
  if (dominioComTipo) {
    return validateParsedLine({
      codigoReduzido: dominioComTipo[1],
      code: dominioComTipo[2]!.replace(/\s/g, ''),
      name: dominioComTipo[3]!.trim(),
      tipo: dominioComTipo[4]!.toUpperCase() as 'S' | 'A',
    });
  }
  if (dominioSemTipo) {
    return validateParsedLine({
      codigoReduzido: dominioSemTipo[1],
      code: dominioSemTipo[2]!.replace(/\s/g, ''),
      name: dominioSemTipo[3]!.trim(),
    });
  }

  const codeMatch = line.match(RE_CLASSIFICACAO);
  if (!codeMatch) return null;
  const code = codeMatch[0]!;
  const name = extractNameAfterCode(line, code);
  if (!name || name.length < 2) return null;

  const reduzidoMatch = line.match(/^(?:1\s+)?(\d{1,7})\s+/);
  const tipoMatch = line.match(/\b([SA])\b/i);
  const nivelMatch = line.match(/\s([1-6])\s*$/);

  return validateParsedLine({
    codigoReduzido: reduzidoMatch?.[1],
    code,
    name,
    tipo: tipoMatch?.[1]?.toUpperCase() as 'S' | 'A' | undefined,
    nivel: nivelMatch?.[1] ? parseInt(nivelMatch[1], 10) : undefined,
  });
}

export function mergePlanoFieldsFromLine(
  fields: Record<string, string>,
  lineText: string,
): Record<string, string> {
  const parsed = parsePlanoDominioLineText(lineText);
  if (!parsed) return fields;

  const out = { ...fields };
  if (!out.codigoReduzido?.trim() && parsed.codigoReduzido) {
    out.codigoReduzido = parsed.codigoReduzido;
  }
  const codeCol = out.codigoClassificacao?.trim() || out.classificacao?.trim();
  if (!looksLikePlanoClassificacao(codeCol) || !codeCol || parsed.code.length >= codeCol.length) {
    out.codigoClassificacao = parsed.code;
  }
  if (!out.descricao?.trim() || out.descricao.trim().length < parsed.name.length) {
    out.descricao = stripTrailingPlanoTipoFromName(parsed.name);
  }
  if (!out.tipo?.trim() && parsed.tipo) out.tipo = parsed.tipo;
  if (!out.nivel?.trim() && parsed.nivel != null) out.nivel = String(parsed.nivel);
  return out;
}
