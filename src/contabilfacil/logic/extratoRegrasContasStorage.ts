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

export type ExtratoRegraConta = {
  id: string;
  nome: string;
  descricao: string;
  nature: ExtratoRegraContaNature;
  /** Conta banco do extrato (layout OCR) a que a regra pertence — preferir CÓDIGO REDUZIDO. */
  contaBanco: string;
  /** Contrapartida — OBRIGATÓRIO código reduzido (nunca classificação 2.1.10…). */
  contaContrapartida: string;
};

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
  if (!descricaoNorm || !contaContrapartida || !contaBanco) return null;

  // Preferir reduzido; se ainda for classificação, mantém só se não houver como converter aqui.
  const redContra = sanitizeCodigoReduzido(contaContrapartida);
  if (redContra) contaContrapartida = redContra;
  const redBanco = sanitizeCodigoReduzido(contaBanco);
  if (redBanco) contaBanco = redBanco;

  const nome = String(raw.nome ?? '').trim() || descricao.slice(0, 40);
  const nature: ExtratoRegraContaNature = raw.nature === 'C' ? 'C' : 'D';
  return {
    id: raw.id?.trim() || generateUUID(),
    nome,
    descricao,
    nature,
    contaBanco,
    contaContrapartida,
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
      normalizeExtratoMatchText(item.descricao) === normalizeExtratoMatchText(regra.descricao) &&
      normContaBancoCode(item.contaBanco) === normContaBancoCode(regra.contaBanco) &&
      normContaBancoCode(item.contaContrapartida) === normContaBancoCode(regra.contaContrapartida),
  );
  if (duplicate) return current;
  return saveExtratoRegrasContas(company, [...current, regra], undefined, { consolidate: false });
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
  return `${nature}|${desc}|${contra}`;
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
