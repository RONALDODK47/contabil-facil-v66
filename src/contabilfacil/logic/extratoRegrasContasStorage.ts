import { writePersistedLocalStorageJson } from '../../lib/persistentLocalStorage';
import { generateUUID } from '../../lib/uuid';
import { companyStorageSlug } from './companyWorkspace';
import {
  isClassificacaoHierarquica,
  resolveCodigoReduzidoDoPlano,
  sanitizeCodigoReduzido,
} from './planoContasMapper';
import type { AiColigada } from './aiInteligenciaStorage';
import { listAiColigadasParaIa } from './aiInteligenciaStorage';
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from '../../lib/safeLocalStorage';
import { deferIdle } from '../lib/deferIdle';
import { getExtratoBancoConta } from './extratoOcrLayoutStorage';
import {
  consolidateExtratoRegras,
} from './extratoRegrasEntity';

export type ExtratoRegraContaNature = 'D' | 'C';

/** Como a regra identifica o lançamento: pelo texto, pelo valor exato ou por documento (CPF/RG). */
export type ExtratoRegraContaMatchTipo = 'historico' | 'valor' | 'documento';

/**
 * Janela de datas de uma regra amarrada a uma competência de folha.
 *
 * O padrão é 'competencia_em_diante': a folha de 01/2026 é procurada no próprio
 * mês e em 02, 03, 04… — pagamento atrasado, férias e rescisão continuam sendo
 * capturados. O que a competência impede é só olhar para TRÁS (não confundir com
 * o pagamento de uma competência anterior).
 *
 * Os demais modos existem para regras antigas já gravadas.
 */
export type ExtratoRegraCompetenciaJanela =
  | 'competencia_em_diante'
  | 'competencia_e_seguinte'
  | 'seguinte'
  | 'competencia'
  | 'qualquer';

export const REGRA_COMPETENCIA_JANELA_PADRAO: ExtratoRegraCompetenciaJanela =
  'competencia_em_diante';

const RE_COMPETENCIA_MM_AAAA = /^(\d{2})\/(\d{4})$/;

/** MM/AAAA válido (ou '' quando não for). */
export function normalizeCompetencia(competencia: unknown): string {
  const raw = String(competencia ?? '').trim();
  const m = RE_COMPETENCIA_MM_AAAA.exec(raw);
  if (!m) return '';
  const mes = Number(m[1]);
  if (mes < 1 || mes > 12) return '';
  return `${m[1]}/${m[2]}`;
}

/** Data do extrato (ISO ou BR) → AAAAMM, ou null quando ilegível. */
export function dataParaAnoMes(data: unknown): number | null {
  const raw = String(data ?? '').trim();
  if (!raw) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return Number(iso[1]) * 100 + Number(iso[2]);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(raw);
  if (br) return Number(br[3]) * 100 + Number(br[2]);
  return null;
}

function competenciaParaAnoMes(competencia: string): number | null {
  const norm = normalizeCompetencia(competencia);
  if (!norm) return null;
  const [mes, ano] = norm.split('/');
  return Number(ano) * 100 + Number(mes);
}

/** AAAAMM + n meses. */
function anoMesSomaMes(anoMes: number, meses: number): number {
  const ano = Math.floor(anoMes / 100);
  const mes = anoMes % 100;
  const total = ano * 12 + (mes - 1) + meses;
  return Math.floor(total / 12) * 100 + (total % 12) + 1;
}

/**
 * A data do lançamento cabe na janela da competência da regra?
 * Sem competência na regra (ou sem data na linha) a regra não é restringida —
 * melhor casar do que perder o lançamento por falta de data.
 */
export function competenciaAceitaData(
  competencia: string | undefined,
  janela: ExtratoRegraCompetenciaJanela | undefined,
  dataLinha: unknown,
): boolean {
  const compAnoMes = competenciaParaAnoMes(competencia ?? '');
  if (compAnoMes === null) return true;
  const modo = janela ?? REGRA_COMPETENCIA_JANELA_PADRAO;
  if (modo === 'qualquer') return true;
  const linhaAnoMes = dataParaAnoMes(dataLinha);
  if (linhaAnoMes === null) return true;
  if (modo === 'competencia_em_diante') return linhaAnoMes >= compAnoMes;
  const seguinte = anoMesSomaMes(compAnoMes, 1);
  if (modo === 'competencia') return linhaAnoMes === compAnoMes;
  if (modo === 'seguinte') return linhaAnoMes === seguinte;
  return linhaAnoMes === compAnoMes || linhaAnoMes === seguinte;
}

/** Compara valores em centavos — evita erro de ponto flutuante (0.1+0.2). */
export function normalizeRegraValor(valor: unknown): number | undefined {
  const n =
    typeof valor === 'number'
      ? valor
      : Number(String(valor ?? '').replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return undefined;
  const abs = Math.abs(Math.round(n * 100) / 100);
  return abs > 0 ? abs : undefined;
}

/** Mesmo valor (tolerância de 1 centavo/2 casas), ignorando o sinal. */
export function regraValorCombina(valorRegra: number | undefined, valorLinha: unknown): boolean {
  const alvo = normalizeRegraValor(valorRegra);
  const linha = normalizeRegraValor(valorLinha);
  if (alvo === undefined || linha === undefined) return false;
  return Math.round(alvo * 100) === Math.round(linha * 100);
}

export type ExtratoRegraConta = {
  id: string;
  nome: string;
  descricao: string;
  nature: ExtratoRegraContaNature;
  /** Conta banco do extrato (layout OCR) a que a regra pertence — preferir CÓDIGO REDUZIDO. */
  contaBanco: string;
  /** Contrapartida — OBRIGATÓRIO código reduzido (nunca classificação 2.1.10…). */
  contaContrapartida: string;
  /** Critério de casamento. Ausente = 'historico' (regras legadas). */
  matchTipo?: ExtratoRegraContaMatchTipo;
  /** Valor exato do lançamento (positivo) — só usado quando matchTipo === 'valor'. */
  valor?: number;
  /** Só os dígitos do CPF/RG procurados no histórico — matchTipo === 'documento'. */
  documento?: string;
  /** MM/AAAA da folha que originou a regra — restringe as datas aceitas. */
  competencia?: string;
  /** Janela de datas aceita para a competência (padrão: competência + mês seguinte). */
  competenciaJanela?: ExtratoRegraCompetenciaJanela;
  /** De onde a regra veio (ex.: importação do Relatório de Líquidos). */
  origem?: 'folha_liquidos';
  /** Nome do funcionário (só exibição — a busca usa descrição/documento/valor). */
  funcionario?: string;
};

/** Só os dígitos de um documento (CPF, RG, PIS). */
export function somenteDigitos(texto: unknown): string {
  return String(texto ?? '').replace(/\D/g, '');
}

/** Regra que casa por documento (CPF/RG) encontrado no histórico. */
export function isRegraPorDocumento(regra: {
  matchTipo?: ExtratoRegraContaMatchTipo;
  documento?: string;
}): boolean {
  return regra.matchTipo === 'documento' && somenteDigitos(regra.documento).length >= 5;
}

/** Regra que casa pelo valor exato do lançamento (e não pelo texto). */
export function isRegraPorValor(regra: {
  matchTipo?: ExtratoRegraContaMatchTipo;
  valor?: number;
}): boolean {
  return regra.matchTipo === 'valor' && normalizeRegraValor(regra.valor) !== undefined;
}

const RE_RUIDO_SIGNIFICADO =
  /\b(saldo\s+do\s+dia|saldo\s+anterior|doc\.?|nr\.?\s*doc)\b|\b\d{1,2}\s*[/.-]\s*\d{1,2}\b/gi;

function storageKey(company: string): string {
  return `contabilfacil_${companyStorageSlug(company)}_extrato_regras_contas_v2`;
}

function legacyStorageKey(company: string): string {
  return `contabilfacil_${companyStorageSlug(company)}_extrato_regras_contas_v1`;
}

function selectedBancoKey(company: string): string {
  return `contabilfacil_${companyStorageSlug(company)}_extrato_regras_banco_v1`;
}

export function normContaBancoCode(code: string): string {
  return code.replace(/[^\d]/g, '').replace(/^0+/, '').trim();
}

/** Mesma normalização do histórico na conciliação (significado do extrato). */
export function normalizeExtratoMatchText(text: string): string {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(RE_RUIDO_SIGNIFICADO, ' ')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeExtratoRegraTexto(texto: string): string {
  return normalizeExtratoMatchText(texto);
}

function sanitizeRegra(
  raw: Partial<ExtratoRegraConta>,
  defaultBanco = '',
): ExtratoRegraConta | null {
  const descricao = String(raw.descricao ?? '').trim();
  const descricaoNorm = normalizeExtratoMatchText(descricao);
  let contaContrapartida = (raw.contaContrapartida ?? '').trim();
  let contaBanco = (raw.contaBanco ?? defaultBanco).trim();
  const valor = normalizeRegraValor(raw.valor);
  const porValor = raw.matchTipo === 'valor' && valor !== undefined;
  const documento = somenteDigitos(raw.documento);
  const porDocumento = raw.matchTipo === 'documento' && documento.length >= 5;
  // Regra por valor/documento não exige histórico — o texto ali é só referência do lançamento.
  if ((!descricaoNorm && !porValor && !porDocumento) || !contaContrapartida || !contaBanco) {
    return null;
  }

  // Preferir reduzido; se ainda for classificação, mantém só se não houver como converter aqui.
  const redContra = sanitizeCodigoReduzido(contaContrapartida);
  if (redContra) contaContrapartida = redContra;
  const redBanco = sanitizeCodigoReduzido(contaBanco);
  if (redBanco) contaBanco = redBanco;

  const nature: ExtratoRegraContaNature = raw.nature === 'C' ? 'C' : 'D';
  const nome =
    String(raw.nome ?? '').trim() ||
    (descricao
      ? descricao.slice(0, 40)
      : porValor
        ? `VALOR ${valor?.toFixed(2)}`
        : porDocumento
          ? `DOC ${documento}`
          : '');
  const competencia = normalizeCompetencia(raw.competencia);
  const funcionario = String(raw.funcionario ?? '').trim();
  return {
    id: raw.id?.trim() || generateUUID(),
    nome,
    descricao,
    nature,
    contaBanco,
    contaContrapartida,
    ...(porValor
      ? { matchTipo: 'valor' as const, valor }
      : porDocumento
        ? { matchTipo: 'documento' as const, documento }
        : { matchTipo: 'historico' as const }),
    ...(competencia
      ? {
          competencia,
          competenciaJanela: (raw.competenciaJanela ??
            REGRA_COMPETENCIA_JANELA_PADRAO) as ExtratoRegraCompetenciaJanela,
        }
      : {}),
    ...(raw.origem === 'folha_liquidos' ? { origem: 'folha_liquidos' as const } : {}),
    ...(funcionario ? { funcionario } : {}),
  };
}

export type PlanoReduzidoLike = { code: string; name?: string; codigoReduzido?: string };

/**
 * Converte regras que usam classificação (2.1.10…) para CÓDIGO REDUZIDO do plano.
 * Classificação sem reduzido correspondente é removida (proibida na conciliação).
 */
export function migrateExtratoRegrasParaCodigoReduzido(
  company: string,
  plano: PlanoReduzidoLike[],
): ExtratoRegraConta[] {
  const current = loadExtratoRegrasContas(company);
  if (current.length === 0 || plano.length === 0) return current;

  let changed = false;
  const next: ExtratoRegraConta[] = [];
  for (const r of current) {
    const contra = resolveCodigoReduzidoDoPlano(r.contaContrapartida, plano);
    const banco = resolveCodigoReduzidoDoPlano(r.contaBanco, plano) || r.contaBanco;
    if (!contra) {
      // Contrapartida era classificação sem reduzido — descarta.
      if (isClassificacaoHierarquica(r.contaContrapartida)) {
        changed = true;
        continue;
      }
      next.push(r);
      continue;
    }
    if (contra !== r.contaContrapartida || banco !== r.contaBanco) {
      changed = true;
      next.push({ ...r, contaContrapartida: contra, contaBanco: banco });
    } else {
      next.push(r);
    }
  }
  if (!changed) return current;
  return saveExtratoRegrasContas(company, next);
}

function readLegacyV1(company: string, defaultBanco: string): ExtratoRegraConta[] {
  try {
    const raw = safeLocalStorageGetItem(legacyStorageKey(company));
    if (!raw?.trim()) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: ExtratoRegraConta[] = [];
    for (const item of parsed) {
      const r = sanitizeRegra(item as Partial<ExtratoRegraConta>, defaultBanco);
      if (r) out.push(r);
    }
    return out;
  } catch {
    return [];
  }
}

export function loadExtratoRegrasContas(
  company: string,
  defaultContaBanco = '',
): ExtratoRegraConta[] {
  try {
    const raw = safeLocalStorageGetItem(storageKey(company));
    if (raw?.trim()) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const regras: ExtratoRegraConta[] = [];
        for (const item of parsed) {
          const r = sanitizeRegra(item as Partial<ExtratoRegraConta>, defaultContaBanco);
          if (r) regras.push(r);
        }
        return regras;
      }
    }
    const migrated = readLegacyV1(company, defaultContaBanco);
    if (migrated.length > 0) {
      saveExtratoRegrasContas(company, migrated);
    }
    return migrated;
  } catch {
    return [];
  }
}

export function saveExtratoRegrasContas(
  company: string,
  regras: ExtratoRegraConta[],
  coligadas?: AiColigada[],
  options?: { consolidate?: boolean },
): ExtratoRegraConta[] {
  const coligs = coligadas ?? listAiColigadasParaIa(company);
  const defaultBanco =
    sanitizeCodigoReduzido(getExtratoBancoConta(company)) ||
    sanitizeCodigoReduzido(loadExtratoRegrasBancoSelecionado(company)) ||
    '';
  const sanitized = regras
    .map((r) => sanitizeRegra(r, defaultBanco))
    .filter((r): r is ExtratoRegraConta => Boolean(r));
  const next = options?.consolidate === false ? sanitized : consolidateExtratoRegras(sanitized, coligs);
  writePersistedLocalStorageJson(storageKey(company), next);
  deferIdle(() => {
    void import('./eyeVisionPersistenceFlush').then(({ flushPersistenceAfterCriticalWrite }) => {
      void flushPersistenceAfterCriticalWrite();
    });
  }, 1800);
  return next;
}

export function loadExtratoRegrasBancoSelecionado(company: string, fallback = ''): string {
  try {
    const raw = safeLocalStorageGetItem(selectedBancoKey(company));
    if (!raw?.trim()) return fallback;
    // Aceita string pura ou JSON stringificado (legado gravava com JSON.stringify).
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === 'string' && parsed.trim()) return parsed.trim();
    } catch {
      /* valor legado sem JSON */
    }
    return raw.replace(/^"|"$/g, '').trim() || fallback;
  } catch {
    return fallback;
  }
}

export function saveExtratoRegrasBancoSelecionado(company: string, contaBanco: string): void {
  try {
    safeLocalStorageSetItem(selectedBancoKey(company), contaBanco.trim());
  } catch (e) {
    console.warn('[regras] não foi possível gravar banco selecionado:', e);
  }
}

export function filterExtratoRegrasPorBanco(
  regras: ExtratoRegraConta[] | null | undefined,
  contaBanco: string,
): ExtratoRegraConta[] {
  if (!regras?.length) return [];
  const norm = normContaBancoCode(contaBanco);
  if (!norm) return regras;
  return regras.filter((r) => normContaBancoCode(r.contaBanco) === norm);
}

export function addExtratoRegraConta(
  company: string,
  draft: Omit<ExtratoRegraConta, 'id'> & { id?: string },
): ExtratoRegraConta[] {
  const regra = sanitizeRegra({ ...draft, id: draft.id ?? generateUUID() });
  if (!regra) return loadExtratoRegrasContas(company);
  const current = loadExtratoRegrasContas(company);
  const duplicate = current.some(
    (item) =>
      item.nature === regra.nature &&
      normalizeCompetencia(item.competencia) === normalizeCompetencia(regra.competencia) &&
      (isRegraPorValor(regra)
        ? isRegraPorValor(item) && regraValorCombina(item.valor, regra.valor)
        : isRegraPorDocumento(regra)
          ? isRegraPorDocumento(item) &&
            somenteDigitos(item.documento) === somenteDigitos(regra.documento)
          : !isRegraPorValor(item) &&
            !isRegraPorDocumento(item) &&
            normalizeExtratoMatchText(item.descricao) ===
              normalizeExtratoMatchText(regra.descricao)) &&
      normContaBancoCode(item.contaBanco) === normContaBancoCode(regra.contaBanco) &&
      normContaBancoCode(item.contaContrapartida) === normContaBancoCode(regra.contaContrapartida),
  );
  if (duplicate) return current;
  return saveExtratoRegrasContas(company, [...current, regra], undefined, { consolidate: false });
}

/**
 * Grava várias regras de uma vez (importação do relatório de líquidos).
 * Reaproveita a mesma chave de duplicidade da replicação entre bancos, então
 * reimportar o mesmo PDF não cria regra repetida.
 */
export function addExtratoRegrasContasEmLote(
  company: string,
  drafts: Array<Omit<ExtratoRegraConta, 'id'>>,
): { regras: ExtratoRegraConta[]; added: number; skipped: number } {
  const current = loadExtratoRegrasContas(company);
  const existentes = new Set(current.map((r) => `${normContaBancoCode(r.contaBanco)}|${regraDedupKey(r)}`));
  const novas: ExtratoRegraConta[] = [];
  let skipped = 0;

  for (const draft of drafts) {
    const regra = sanitizeRegra({ ...draft, id: generateUUID() });
    if (!regra) {
      skipped += 1;
      continue;
    }
    const key = `${normContaBancoCode(regra.contaBanco)}|${regraDedupKey(regra)}`;
    if (existentes.has(key)) {
      skipped += 1;
      continue;
    }
    existentes.add(key);
    novas.push(regra);
  }

  if (novas.length === 0) return { regras: current, added: 0, skipped };
  const regras = saveExtratoRegrasContas(company, [...current, ...novas], undefined, {
    consolidate: false,
  });
  return { regras, added: novas.length, skipped };
}

export function removeExtratoRegraConta(company: string, id: string): ExtratoRegraConta[] {
  return saveExtratoRegrasContas(
    company,
    loadExtratoRegrasContas(company).filter((r) => r.id !== id),
  );
}

export function removeExtratoRegrasPorBanco(
  company: string,
  contaBanco: string,
): ExtratoRegraConta[] {
  const norm = normContaBancoCode(contaBanco);
  if (!norm) return loadExtratoRegrasContas(company);
  return saveExtratoRegrasContas(
    company,
    loadExtratoRegrasContas(company).filter((r) => normContaBancoCode(r.contaBanco) !== norm),
  );
}

export function updateExtratoRegraConta(
  company: string,
  id: string,
  patch: Partial<Omit<ExtratoRegraConta, 'id'>>,
): ExtratoRegraConta[] {
  const next = loadExtratoRegrasContas(company).map((r) => {
    if (r.id !== id) return r;
    return sanitizeRegra({ ...r, ...patch, id }) ?? r;
  });
  return saveExtratoRegrasContas(company, next, undefined, { consolidate: false });
}

function regraDedupKey(r: ExtratoRegraConta): string {
  const desc = String(r.descricao ?? '').trim().toUpperCase();
  const nature = r.nature === 'C' ? 'C' : 'D';
  const contra = normContaBancoCode(r.contaContrapartida) || r.contaContrapartida.trim();
  const comp = normalizeCompetencia(r.competencia);
  if (isRegraPorValor(r)) {
    return `${nature}|VALOR:${Math.round((r.valor ?? 0) * 100)}|${comp}|${contra}`;
  }
  if (isRegraPorDocumento(r)) {
    return `${nature}|DOC:${somenteDigitos(r.documento)}|${comp}|${contra}`;
  }
  return `${nature}|${desc}|${comp}|${contra}`;
}

/**
 * Copia uma lista de regras (origem) para o banco destino (código reduzido).
 * Não duplica regras que já existem no destino (mesma descrição + natureza + contrapartida).
 */
export function replicateExtratoRegrasParaBanco(
  company: string,
  fromBanco: string,
  toBanco: string,
  /** Se informado, usa estas regras como fonte (estado da tela) em vez de reler o storage. */
  sourceOverride?: ExtratoRegraConta[],
): { regras: ExtratoRegraConta[]; added: number; skipped: number } {
  const fromRed = sanitizeCodigoReduzido(fromBanco) || fromBanco.trim();
  const toRed = sanitizeCodigoReduzido(toBanco) || toBanco.trim();
  if (!fromRed || !toRed || normContaBancoCode(fromRed) === normContaBancoCode(toRed)) {
    return { regras: loadExtratoRegrasContas(company), added: 0, skipped: 0 };
  }

  const all = loadExtratoRegrasContas(company);
  const source =
    sourceOverride && sourceOverride.length > 0
      ? sourceOverride
      : filterExtratoRegrasPorBanco(all, fromRed);
  if (source.length === 0) {
    return { regras: all, added: 0, skipped: 0 };
  }

  const existingKeys = new Set(filterExtratoRegrasPorBanco(all, toRed).map(regraDedupKey));
  const copies: ExtratoRegraConta[] = [];
  let skipped = 0;
  for (const r of source) {
    if (!r.descricao?.trim() || !r.contaContrapartida?.trim()) continue;
    const key = regraDedupKey(r);
    if (existingKeys.has(key)) {
      skipped += 1;
      continue;
    }
    existingKeys.add(key);
    const copy = sanitizeRegra(
      {
        ...r,
        id: crypto.randomUUID(),
        contaBanco: toRed,
      },
      toRed,
    );
    if (copy) copies.push(copy);
  }

  if (copies.length === 0) {
    return { regras: all, added: 0, skipped };
  }

  // Evita duplicar ids já presentes: mescla all + copies
  const merged = [...all, ...copies];
  // IMPORTANTE: Passar { consolidate: false } para NAO consolidar/apagar regras do usuario!
  return {
    regras: saveExtratoRegrasContas(company, merged, undefined, { consolidate: false }),
    added: copies.length,
    skipped,
  };
}
