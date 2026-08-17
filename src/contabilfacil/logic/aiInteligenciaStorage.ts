/**
 * Documentos de inteligência da IA + empresas coligadas (aliases) por empresa.
 * Meta leve no localStorage; textos longos no IndexedDB (evita QuotaExceeded).
 */
import { writePersistedLocalStorageJson } from '../../lib/persistentLocalStorage';
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from '../../lib/safeLocalStorage';
import { generateUUID } from '../../lib/uuid';
import {
  idbDeleteDocText,
  idbGetAllDocTexts,
  idbGetInteligenciaStore,
  idbPutDocText,
  idbPutInteligenciaStore,
} from '../../lib/aiInteligenciaIdb';
import { companyStorageSlug } from './companyWorkspace';
import { sanitizeCodigoReduzido, resolveCodigoReduzidoDoPlano } from './planoContasMapper';

export type AiInteligenciaPasta =
  | 'coligadas'
  | 'contratos'
  | 'honorarios'
  | 'funcionarios'
  | 'despesas'
  | 'receitas';

/** Grupos sintéticos por pasta — orientam a IA sem precisar de documento. */
export type AiInteligenciaPastaConfig = {
  /** Classificação ou reduzido da conta sintética para saídas (D no banco). */
  contaGrupoSaida?: string;
  /** Classificação ou reduzido da conta sintética para entradas (C no banco). */
  contaGrupoEntrada?: string;
};

export const ALL_INTELIGENCIA_PASTAS: AiInteligenciaPasta[] = [
  'coligadas',
  'contratos',
  'honorarios',
  'funcionarios',
  'despesas',
  'receitas',
];

export type AiInteligenciaDoc = {
  id: string;
  nome: string;
  pasta: AiInteligenciaPasta;
  mimeType: string;
  size: number;
  /** Texto extraído — em memória/IDB; no LS só preview curto. */
  textoExtraido: string;
  uploadedAt: string;
};

export type AiColigada = {
  id: string;
  nome: string;
  aliases: string[];
  contaReduzida?: string;
  notas?: string;
};

export type AiSocio = {
  id: string;
  nome: string;
  aliases: string[];
  notas?: string;
};

export type AiInteligenciaStore = {
  docs: AiInteligenciaDoc[];
  coligadas: AiColigada[];
  socios?: AiSocio[];
  pastaConfigs?: Partial<Record<AiInteligenciaPasta, AiInteligenciaPastaConfig>>;
  updatedAt: string;
};

const SUFFIX = 'ai_inteligencia_v1';
const MAX_DOCS = 40;
/** Preview no localStorage — texto completo vai para IndexedDB. */
const MAX_TEXTO_LS_PREVIEW = 400;
const MAX_TEXTO_POR_DOC = 12_000;

/** Cache em memória: companySlug → docId → texto completo */
const textCache = new Map<string, Map<string, string>>();
/** Store completo em memória — fonte da verdade na sessão */
const storeCache = new Map<string, AiInteligenciaStore>();

function storageKey(company: string): string {
  return `contabilfacil_${companyStorageSlug(company)}_${SUFFIX}`;
}

function emptyPastaConfigs(): Record<AiInteligenciaPasta, AiInteligenciaPastaConfig> {
  return {
    coligadas: {},
    contratos: {},
    honorarios: {},
    funcionarios: {},
    despesas: {},
    receitas: {},
  };
}

function sanitizePastaConfig(raw: Partial<AiInteligenciaPastaConfig> | null | undefined): AiInteligenciaPastaConfig {
  return {
    contaGrupoSaida: String(raw?.contaGrupoSaida ?? '').trim() || undefined,
    contaGrupoEntrada: String(raw?.contaGrupoEntrada ?? '').trim() || undefined,
  };
}

function mergePastaConfigs(
  raw: Partial<Record<string, Partial<AiInteligenciaPastaConfig>>> | null | undefined,
): Record<AiInteligenciaPasta, AiInteligenciaPastaConfig> {
  const base = emptyPastaConfigs();
  if (!raw || typeof raw !== 'object') return base;
  for (const pasta of ALL_INTELIGENCIA_PASTAS) {
    const legadoFinanceiro =
      pasta === 'despesas' || pasta === 'receitas' ? raw.financeiras : undefined;
    base[pasta] = sanitizePastaConfig(raw[pasta] ?? legadoFinanceiro);
  }
  return base;
}

/** Migra pastas legadas sem perder documentos já salvos. */
export function normalizeLegacyInteligenciaPasta(pasta: string): AiInteligenciaPasta {
  if (pasta === 'balancetes' || pasta === 'financeiras') return 'despesas';
  if (pasta === 'outros') return 'honorarios';
  if (
    pasta === 'coligadas' ||
    pasta === 'contratos' ||
    pasta === 'honorarios' ||
    pasta === 'funcionarios' ||
    pasta === 'despesas' ||
    pasta === 'receitas'
  ) {
    return pasta;
  }
  return 'honorarios';
}

function emptyStore(): AiInteligenciaStore {
  return {
    docs: [],
    coligadas: [],
    socios: [],
    pastaConfigs: emptyPastaConfigs(),
    updatedAt: new Date().toISOString(),
  };
}

/** Mantém a versão mais recente (ex.: exclusão local não pode ser sobrescrita pelo IDB). */
export function mergeInteligenciaStorePreferNewer(
  local: AiInteligenciaStore,
  remote: AiInteligenciaStore,
): AiInteligenciaStore {
  const localTs = Date.parse(local.updatedAt || '');
  const remoteTs = Date.parse(remote.updatedAt || '');
  const winner = localTs >= remoteTs ? local : remote;
  return {
    docs: winner.docs.map((d) => ({ ...d })),
    coligadas: winner.coligadas.map((c) => ({ ...c, aliases: [...c.aliases] })),
    socios: (winner.socios ?? []).map((s) => ({ ...s, aliases: [...s.aliases] })),
    pastaConfigs: mergePastaConfigs(winner.pastaConfigs),
    updatedAt: winner.updatedAt,
  };
}

function getTextMap(slug: string): Map<string, string> {
  let m = textCache.get(slug);
  if (!m) {
    m = new Map();
    textCache.set(slug, m);
  }
  return m;
}

function parseStoreRaw(raw: string | null | undefined): AiInteligenciaStore | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AiInteligenciaStore>;
    const coligadas = Array.isArray(parsed.coligadas)
      ? parsed.coligadas.map(sanitizeColigada).filter((c): c is AiColigada => Boolean(c))
      : [];
    const socios = Array.isArray(parsed.socios)
      ? parsed.socios.map(sanitizeSocio).filter((s): s is AiSocio => Boolean(s))
      : [];
    const pastaConfigs = mergePastaConfigs(parsed.pastaConfigs as Partial<Record<string, Partial<AiInteligenciaPastaConfig>>>);
    const docs = Array.isArray(parsed.docs)
      ? parsed.docs
          .map((d) => {
            const sanitized = sanitizeDoc(d as Partial<AiInteligenciaDoc>);
            if (!sanitized) return null;
            return { ...sanitized, pasta: normalizeLegacyInteligenciaPasta(String((d as Partial<AiInteligenciaDoc>).pasta ?? sanitized.pasta)) };
          })
          .filter((d): d is AiInteligenciaDoc => Boolean(d))
      : [];
    return {
      docs,
      coligadas,
      socios,
      pastaConfigs,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function sanitizeAliases(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of raw) {
    const s = String(a ?? '')
      .trim()
      .toUpperCase();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= 24) break;
  }
  return out;
}

function sanitizeColigada(raw: Partial<AiColigada>): AiColigada | null {
  const nome = String(raw.nome ?? '').trim();
  if (!nome || isNomeColigadaInvalido(nome)) return null;
  const aliases = sanitizeAliases(raw.aliases);
  if (aliases.length === 0) {
    aliases.push(nome.toUpperCase());
  }
  return {
    id: raw.id?.trim() || crypto.randomUUID(),
    nome,
    aliases,
    contaReduzida: String(raw.contaReduzida ?? '').trim() || undefined,
    notas: String(raw.notas ?? '').trim() || undefined,
  };
}

export function isNomeSocioInvalido(nome: string): boolean {
  const n = String(nome ?? '').trim().toUpperCase();
  if (!n || n.length < 3) return true;
  if (/^(SOCIO|SÓCIO|NOME|CPF|CNPJ|PARTICIPACAO|PARTICIPAÇÃO|QUADRO)\b/.test(n)) return true;
  if (/^(IMAGEM|ARQUIVO)\s+ANEXAD|PDFPAG\d+|^PAG(INA)?\s*\d+$/i.test(n)) return true;
  if (/\.(PNG|JPE?G|PDF|WEBP|GIF|BMP)$/i.test(n)) return true;
  return false;
}

function sanitizeSocio(raw: Partial<AiSocio>): AiSocio | null {
  const nome = String(raw.nome ?? '').trim();
  if (!nome || isNomeSocioInvalido(nome)) return null;
  const aliases = sanitizeAliases(raw.aliases);
  if (aliases.length === 0) {
    aliases.push(nome.toUpperCase());
  }
  return {
    id: raw.id?.trim() || crypto.randomUUID(),
    nome,
    aliases,
    notas: String(raw.notas ?? '').trim() || undefined,
  };
}

function sanitizeDoc(raw: Partial<AiInteligenciaDoc>): AiInteligenciaDoc | null {
  const nome = String(raw.nome ?? '').trim();
  if (!nome) return null;
  const pasta: AiInteligenciaPasta = normalizeLegacyInteligenciaPasta(String(raw.pasta ?? 'honorarios'));
  return {
    id: raw.id?.trim() || crypto.randomUUID(),
    nome,
    pasta,
    mimeType: String(raw.mimeType ?? '').trim() || 'application/octet-stream',
    size: Number(raw.size) || 0,
    textoExtraido: String(raw.textoExtraido ?? '').slice(0, MAX_TEXTO_POR_DOC),
    uploadedAt: raw.uploadedAt || new Date().toISOString(),
  };
}

/** Payload leve para localStorage (sem textos longos). */
function toLightStore(store: AiInteligenciaStore): AiInteligenciaStore {
  return {
    ...store,
    docs: store.docs.map((d) => ({
      ...d,
      textoExtraido: d.textoExtraido.slice(0, MAX_TEXTO_LS_PREVIEW),
    })),
  };
}

function applyTextCache(slug: string, store: AiInteligenciaStore): AiInteligenciaStore {
  const cache = getTextMap(slug);
  for (const d of store.docs) {
    if (d.textoExtraido.length > MAX_TEXTO_LS_PREVIEW) {
      cache.set(d.id, d.textoExtraido);
    } else if (cache.has(d.id)) {
      d.textoExtraido = cache.get(d.id)!;
    }
  }
  return store;
}

export function loadAiInteligencia(company: string): AiInteligenciaStore {
  const slug = companyStorageSlug(company);
  const cached = storeCache.get(slug);
  if (cached) {
    return applyTextCache(slug, {
      docs: cached.docs.map((d) => ({ ...d })),
      coligadas: cached.coligadas.map((c) => ({ ...c, aliases: [...c.aliases] })),
      socios: (cached.socios ?? []).map((s) => ({ ...s, aliases: [...s.aliases] })),
      pastaConfigs: mergePastaConfigs(cached.pastaConfigs),
      updatedAt: cached.updatedAt,
    });
  }

  try {
    const fromLs = parseStoreRaw(safeLocalStorageGetItem(storageKey(company)));
    if (fromLs) {
      const store = applyTextCache(slug, fromLs);
      storeCache.set(slug, store);
      void hydrateFromIdb(company);
      return store;
    }
  } catch {
    /* segue para IDB */
  }

  // Sem LS — tenta IDB em background; não sobrescreve cache se já houver dados
  void hydrateFromIdb(company);
  const existing = storeCache.get(slug);
  if (existing) {
    return applyTextCache(slug, {
      docs: existing.docs.map((d) => ({ ...d })),
      coligadas: existing.coligadas.map((c) => ({ ...c, aliases: [...c.aliases] })),
      socios: (existing.socios ?? []).map((s) => ({ ...s, aliases: [...s.aliases] })),
      pastaConfigs: mergePastaConfigs(existing.pastaConfigs),
      updatedAt: existing.updatedAt,
    });
  }
  const empty = emptyStore();
  storeCache.set(slug, empty);
  return empty;
}

/** Carrega store + textos do IndexedDB (fonte confiável após reload). */
async function hydrateFromIdb(company: string): Promise<void> {
  const slug = companyStorageSlug(company);
  try {
    const idbRaw = await idbGetInteligenciaStore(slug);
    const fromIdb = parseStoreRaw(idbRaw);
    const mem = storeCache.get(slug);

    if (fromIdb) {
      if (!mem) {
        storeCache.set(slug, fromIdb);
        // ⚠️ DISABLED: Salva SOMENTE no Docker
        // safeLocalStorageSetItem(storageKey(company), JSON.stringify(toLightStore(fromIdb)));
      } else {
        const merged = mergeInteligenciaStorePreferNewer(mem, fromIdb);
        storeCache.set(slug, merged);
        // ⚠️ DISABLED: Salva SOMENTE no Docker
        // safeLocalStorageSetItem(storageKey(company), JSON.stringify(toLightStore(merged)));
        if (Date.parse(mem.updatedAt || '') > Date.parse(fromIdb.updatedAt || '')) {
          try {
            await idbPutInteligenciaStore(slug, JSON.stringify(toLightStore(merged)));
          } catch {
            /* ignore */
          }
        }
      }
    }

    const fromTexts = await idbGetAllDocTexts(slug);
    const cache = getTextMap(slug);
    for (const [id, texto] of fromTexts) {
      cache.set(id, texto);
    }
    const store = storeCache.get(slug);
    if (store) {
      for (const d of store.docs) {
        const full = cache.get(d.id);
        if (full) d.textoExtraido = full;
      }
    }
  } catch {
    /* IDB opcional */
  }
}

async function persistTextsAndSlim(company: string, store: AiInteligenciaStore): Promise<void> {
  const slug = companyStorageSlug(company);
  const cache = getTextMap(slug);
  for (const d of store.docs) {
    const full = (cache.get(d.id) || d.textoExtraido).slice(0, MAX_TEXTO_POR_DOC);
    if (full) {
      cache.set(d.id, full);
      try {
        await idbPutDocText(slug, d.id, full);
      } catch {
        /* continua com cache */
      }
    }
  }
  try {
    await idbPutInteligenciaStore(slug, JSON.stringify(toLightStore(store)));
  } catch {
    /* ignore */
  }
  // ⚠️ DISABLED: Salva SOMENTE no Docker
  // safeLocalStorageSetItem(storageKey(company), JSON.stringify(toLightStore(store)));
  void import('../logic/eyeVisionOperationalSave').then(({ scheduleEyeVisionOperationalSave }) => {
    scheduleEyeVisionOperationalSave();
  });
}

export function saveAiInteligencia(
  company: string,
  store: AiInteligenciaStore,
): AiInteligenciaStore {
  const slug = companyStorageSlug(company);
  const next: AiInteligenciaStore = {
    docs: store.docs
      .map(sanitizeDoc)
      .filter((d): d is AiInteligenciaDoc => Boolean(d))
      .slice(0, MAX_DOCS),
    coligadas: store.coligadas
      .map(sanitizeColigada)
      .filter((c): c is AiColigada => Boolean(c))
      .slice(0, 80),
    socios: (store.socios ?? [])
      .map(sanitizeSocio)
      .filter((s): s is AiSocio => Boolean(s))
      .slice(0, 40),
    pastaConfigs: mergePastaConfigs(store.pastaConfigs),
    updatedAt: new Date().toISOString(),
  };

  const cache = getTextMap(slug);
  for (const d of next.docs) {
    if (d.textoExtraido) cache.set(d.id, d.textoExtraido);
  }

  // Memória = fonte da verdade na sessão (UI atualiza na hora)
  storeCache.set(slug, next);

  const light = toLightStore(next);
  const lightJson = JSON.stringify(light);
  // ⚠️ DISABLED: Salva SOMENTE no Docker
  // safeLocalStorageSetItem(storageKey(company), lightJson);
  writePersistedLocalStorageJson(storageKey(company), light);

  // Persistência completa em background (IDB + Docker)
  void persistAiInteligenciaToBackend(company, next);

  return next;
}

/**
 * Grava Inteligência IA no IndexedDB e sincroniza com Docker.
 */
export async function persistAiInteligenciaToBackend(
  company: string,
  store?: AiInteligenciaStore,
): Promise<{ ok: boolean; error?: string }> {
  const slug = companyStorageSlug(company);
  const next = store || storeCache.get(slug) || loadAiInteligencia(company);
  const light = toLightStore(next);
  const lightJson = JSON.stringify(light);
  const cache = getTextMap(slug);

  try {
    await idbPutInteligenciaStore(slug, lightJson);
  } catch {
    /* continua — LS já tem a meta */
  }

  const activeDocIds = new Set(next.docs.map((d) => d.id));
  try {
    const orphanTexts = await idbGetAllDocTexts(slug);
    for (const docId of orphanTexts.keys()) {
      if (!activeDocIds.has(docId)) {
        await idbDeleteDocText(slug, docId);
        cache.delete(docId);
      }
    }
  } catch {
    /* ignore */
  }

  for (const docId of [...cache.keys()]) {
    if (!activeDocIds.has(docId)) cache.delete(docId);
  }

  for (const d of next.docs) {
    const full = cache.get(d.id) || d.textoExtraido;
    if (full) {
      try {
        await idbPutDocText(slug, d.id, full.slice(0, MAX_TEXTO_POR_DOC));
      } catch {
        /* ignore */
      }
    }
  }

  try {
    const { markOperationalStorageDirty, scheduleEyeVisionOperationalSave } = await import(
      './eyeVisionOperationalSave'
    );
    markOperationalStorageDirty();
    scheduleEyeVisionOperationalSave();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Falha ao sincronizar com o backend',
    };
  }
}

/** @deprecated use persistAiInteligenciaToBackend */
export const persistAiInteligenciaToFolder = persistAiInteligenciaToBackend;

/** Recarrega do IDB e atualiza cache (usar ao abrir o modal). */
export async function loadAiInteligenciaAsync(company: string): Promise<AiInteligenciaStore> {
  const slug = companyStorageSlug(company);
  await hydrateFromIdb(company);
  const store = storeCache.get(slug) || loadAiInteligencia(company);
  return applyTextCache(slug, {
    docs: store.docs.map((d) => ({ ...d })),
    coligadas: store.coligadas.map((c) => ({ ...c, aliases: [...c.aliases] })),
    socios: (store.socios ?? []).map((s) => ({ ...s, aliases: [...s.aliases] })),
    pastaConfigs: mergePastaConfigs(store.pastaConfigs),
    updatedAt: store.updatedAt,
  });
}

export function countAiInteligenciaDocs(company: string): number {
  return loadAiInteligencia(company).docs.length;
}

/** Textos para a IA (sync — usa cache/IDB já hidratado + preview). Balancetes primeiro. */
export function listAiInteligenciaTextoParaIa(company: string): string[] {
  const store = loadAiInteligencia(company);
  const slug = companyStorageSlug(company);
  const cache = getTextMap(slug);
  const pastaOrdem: Record<AiInteligenciaPasta, number> = {
    coligadas: 0,
    contratos: 1,
    honorarios: 2,
    funcionarios: 3,
    despesas: 4,
    receitas: 5,
  };
  return [...store.docs]
    .sort((a, b) => (pastaOrdem[a.pasta] ?? 9) - (pastaOrdem[b.pasta] ?? 9))
    .map((d) => {
      const texto = (cache.get(d.id) || d.textoExtraido || '').trim();
      if (!texto) return '';
      return `[${d.pasta.toUpperCase()} · ${d.nome}]\n${texto}`;
    })
    .filter(Boolean);
}

/** Garante textos do IDB antes de chamar a IA (preferir este). */
export async function listAiInteligenciaTextoParaIaAsync(company: string): Promise<string[]> {
  await hydrateFromIdb(company);
  return listAiInteligenciaTextoParaIa(company);
}

export function listAiColigadasParaIa(company: string): AiColigada[] {
  return loadAiInteligencia(company).coligadas;
}

export function inferPastaFromFileName(name: string): AiInteligenciaPasta {
  const n = name.toLowerCase();
  if (/coligad|grupo|participad|controlad|ajtf|relacionad/.test(n)) return 'coligadas';
  if (/contrato|social|socios|sócios|estatuto/.test(n)) return 'contratos';
  if (/honor[aá]rio|contador|escritorio|escritório/.test(n)) return 'honorarios';
  if (/funcion[aá]ri|empregado|colaborador|folha|sal[aá]rio|f[eé]rias|rescis/.test(n)) {
    return 'funcionarios';
  }
  if (/receita|rendimento|recebimento|juros\s+ativo|ganho/.test(n)) return 'receitas';
  if (/despesa|tarifa|juros\s+passivo|encargo|pagamento|financeir/.test(n)) return 'despesas';
  if (/balanc|razao|razão|dre|plano/.test(n)) return 'despesas';
  return 'honorarios';
}

export function compactAliasKey(text: string): string {
  const upper = String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!upper) return '';
  const collapsed = upper.replace(/\b([A-Z])(?:\s+([A-Z]))+\b/g, (m) => m.replace(/\s+/g, ''));
  return collapsed.replace(/\s+/g, '');
}

/**
 * Palavras gen\u00e9ricas de raz\u00e3o social \u2014 sozinhas n\u00e3o identificam uma empresa
 * espec\u00edfica (ex.: "COMERCIO" aparece em "IMPERIO COMERCIO LTDA" e em
 * "A ECONOMICA COMERCIO"). Um alias composto s\u00f3 por essas palavras n\u00e3o pode
 * "casar" com o hist\u00f3rico de outra empresa que s\u00f3 compartilha o termo gen\u00e9rico.
 */
const GENERIC_ALIAS_WORDS = new Set([
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
  'LTDA',
  'LTDA.',
  'ME',
  'EPP',
  'SA',
  'EIRELI',
]);

function isGenericOnlyAlias(aliasNorm: string): boolean {
  const tokens = aliasNorm.split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  return tokens.every((t) => GENERIC_ALIAS_WORDS.has(t));
}

export function aliasMatchesHistorico(historico: string, alias: string): boolean {
  const histNorm = String(historico ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!histNorm || !alias.trim()) return false;

  const aliasNorm = alias
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (isGenericOnlyAlias(aliasNorm)) return false;

  if (aliasNorm.length >= 3 && histNorm.includes(aliasNorm)) return true;

  const histKey = compactAliasKey(histNorm);
  const aliasKey = compactAliasKey(alias);
  if (aliasKey.length >= 3 && histKey.includes(aliasKey)) return true;

  if (aliasKey.length >= 3 && aliasKey.length <= 8) {
    const spaced = aliasKey.split('').join('\\s*');
    try {
      if (new RegExp(`(?:^|\\s)${spaced}(?:\\s|$)`).test(histNorm)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

export function matchColigadaNoHistorico(
  historico: string,
  coligadas: AiColigada[] | null | undefined,
): AiColigada | null {
  if (!coligadas?.length || !historico.trim()) return null;
  for (const c of coligadas) {
    const candidates = [c.nome, ...c.aliases];
    for (const alias of candidates) {
      if (aliasMatchesHistorico(historico, alias)) return c;
    }
  }
  return null;
}

/** Normalização simples para validar nomes (sem depender de extratoRegras). */
function normalizeNomeColigadaCheck(raw: string): string {
  return String(raw ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Rejeita placeholders de arquivo, marcadores de página OCR e rótulos genéricos.
 * Evita regras com "IMAGEM ANEXADA…", "PDFPAG2", etc.
 */
export function isNomeColigadaInvalido(nome: string): boolean {
  const raw = String(nome ?? '').trim();
  if (!raw) return true;
  const n = normalizeNomeColigadaCheck(raw);
  if (n.length < 3) return true;

  if (/^\[ARQUIVO\]/i.test(raw)) return true;
  if (/^(IMAGEM|ARQUIVO)\s+ANEXAD/i.test(n)) return true;
  if (/^ARQUIVO\s+(PDF|EXCEL|ANEXADO)/i.test(n)) return true;
  if (/^(ARQUIVO\s+)?PDF\s*:/i.test(n)) return true;
  if (/^PLANILHA:/i.test(n)) return true;
  if (/^---\s*PDF/i.test(raw)) return true;

  if (/^PDF\s*PAG(INA)?\.?\s*\d*$/i.test(n)) return true;
  if (/^PDFPAG\d+$/i.test(n)) return true;
  if (/^PAG(INA)?\s*\d+$/i.test(n)) return true;

  if (/^(EMPRESAS?\s+)?COLIGADAS?(\s+(ANEXAD|PNG|PDF|JPG|JPEG))?$/i.test(n)) return true;
  if (/^IMAGEM\s+ANEXADA\b/i.test(n)) return true;

  const semExt = n.replace(/\.(PNG|JPE?G|PDF|WEBP|GIF|BMP|XLSX?|CSV)$/i, '').trim();
  if (semExt !== n && semExt.length < 8 && !/\b(LTDA|EIRELI|COMERCIO|SERVICOS|REFRIGERACAO)\b/i.test(semExt)) {
    return true;
  }
  if (/\b(PNG|JPE?G|WEBP|GIF|BMP)\b$/i.test(n) && !/\b(LTDA|EIRELI|COMERCIO|SERVICOS|REFRIGERACAO)\b/i.test(n)) {
    return true;
  }

  return false;
}

/** Lê blocos «[IA coligadas] nome1; nome2» gravados após extração automática. */
export function formatIaExtractBlock(
  marker: string,
  items: Array<{ nome: string; aliases: string[] }>,
): string {
  if (!items.length) return '';
  const body = items
    .map((c) => {
      const nome = String(c.nome ?? '').trim();
      if (!nome) return '';
      const extra = (c.aliases ?? [])
        .map((a) => String(a ?? '').trim())
        .filter((a) => a && a.toUpperCase() !== nome.toUpperCase());
      return extra.length ? `${nome}|${extra.join(',')}` : nome;
    })
    .filter(Boolean)
    .join('; ');
  return `[IA ${marker}] ${body}`.slice(0, 12_000);
}

export function iaMarkersForPasta(pasta: AiInteligenciaPasta): string[] {
  switch (pasta) {
    case 'coligadas':
      return ['coligadas'];
    case 'contratos':
      return ['socios'];
    case 'honorarios':
      return ['honorarios', 'socios'];
    case 'funcionarios':
      return ['funcionarios'];
    case 'despesas':
      return ['despesas', 'financeiras'];
    case 'receitas':
      return ['receitas'];
    default:
      return [];
  }
}

export function parseIaMarkerNomes(
  texto: string,
  markers: string[],
): Array<{ nome: string; aliases: string[] }> {
  const raw = String(texto ?? '');
  const out: Array<{ nome: string; aliases: string[] }> = [];
  const seen = new Set<string>();
  for (const marker of markers) {
    const re = new RegExp(`\\[IA\\s+${marker}\\]\\s*([^\\n\\[]+)`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = re.exec(raw)) !== null) {
      const chunk = String(match[1] ?? '').trim();
      for (const part of chunk.split(';')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const pipeIdx = trimmed.indexOf('|');
        const nome = (pipeIdx >= 0 ? trimmed.slice(0, pipeIdx) : trimmed)
          .trim()
          .replace(/[;,:]+$/g, '');
        if (nome.length < 2) continue;
        const aliasRaw = pipeIdx >= 0 ? trimmed.slice(pipeIdx + 1).trim() : '';
        const aliases = aliasRaw
          ? aliasRaw
              .split(',')
              .map((a) => a.trim())
              .filter(Boolean)
          : [nome.toUpperCase()];
        const key = compactAliasKey(nome) || nome.toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ nome, aliases });
      }
    }
  }
  return out;
}

export function extractColigadasFromTexto(texto: string): Array<{ nome: string; aliases: string[] }> {
  const raw = String(texto ?? '');
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 400);
  const found: Array<{ nome: string; aliases: string[] }> = [];
  const seen = new Set<string>();

  const push = (nomeRaw: string, aliases: string[] = []) => {
    let nome = nomeRaw
      .replace(/^[\d.\-)\]\s]+/, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/[;,:]+$/g, '')
      .trim();
    // Remove rótulos comuns
    nome = nome
      .replace(/^(coligad[ao]s?|participad[ao]s?|controlad[ao]s?|grupo|empresa)\s*[:\-–]?\s*/i, '')
      .trim();
    if (nome.length < 2 || nome.length > 90) return;
    if (isNomeColigadaInvalido(nome)) return;
    if (/^\[IA\s+COLIGADAS\]/i.test(nome)) return;
    // Ignora linhas que são só números / cabeçalhos genéricos
    if (/^(saldo|total|conta|codigo|código|página|pagina)\b/i.test(nome)) return;
    if (/^\d+([.,]\d+)?%?$/.test(nome)) return;

    const key = compactAliasKey(nome) || nome.toUpperCase();
    if (!key || key.length < 3 || seen.has(key)) return;
    seen.add(key);

    const aliasSet = new Set<string>();
    for (const a of [nome, ...aliases]) {
      const t = a.trim().toUpperCase();
      if (t) aliasSet.add(t);
      const compact = compactAliasKey(a);
      if (compact.length >= 3) aliasSet.add(compact);
      if (/^[A-Z]{3,8}$/.test(compact)) {
        aliasSet.add(compact.split('').join(' '));
        aliasSet.add(compact.split('').join('.'));
        aliasSet.add(compact.split('').join('. ') + '.');
      }
      // Sem LTDA / ME / EPP para casar no extrato
      const semTipo = t
        .replace(/\b(LTDA|LTD|ME|EPP|S\/?A|SA|EIRELI)\b\.?/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (semTipo.length >= 3) aliasSet.add(semTipo);
    }
    found.push({ nome: nome.trim(), aliases: Array.from(aliasSet).slice(0, 24) });
  };

  // Seção explícita de coligadas / partes relacionadas
  let inColigadasSection = false;
  for (const line of lines) {
    if (
      /coligad|participad|controlad|partes?\s+relacionad|empresas?\s+do\s+grupo|grupo\s+empresarial/i.test(
        line,
      )
    ) {
      inColigadasSection = true;
      const after = line.match(
        /(?:coligad[ao]s?|participad[ao]s?|controlad[ao]s?|relacionad[ao]s?)\s*[:\-–]\s*(.+)$/i,
      );
      if (after?.[1]) {
        for (const part of after[1].split(/[;|/•·]|(?:\s+e\s+)/i)) {
          const n = part.trim();
          if (n.length >= 2) push(n, [n]);
        }
      }
      continue;
    }
    // Sai da seção em cabeçalhos claramente outros
    if (
      inColigadasSection &&
      /^(balanc|dre|ativo|passivo|patrimonio|sócios|socios|contrato|anexo)\b/i.test(line)
    ) {
      inColigadasSection = false;
    }

    const coligadaHit = line.match(/coligad[ao]s?\s*[:\-–]?\s*(.+)$/i);
    if (coligadaHit?.[1]) {
      push(coligadaHit[1], [coligadaHit[1]]);
      continue;
    }

    // Siglas tipo A.J.T.F / A J T F
    if (/^[A-Z](?:[.\s]*[A-Z]){2,7}\.?$/i.test(line) && line.replace(/[^A-Za-z]/g, '').length <= 8) {
      push(line, [line]);
      continue;
    }

    // Razão social típica (COMERCIO, LTDA, REFRIGERAÇÃO…)
    const looksLikeCompany =
      /\b(LTDA|LTD|EIRELI|S\/?A|ME|EPP|COM[EÉ]RCIO|COMERCIO|REFRIGERA[CÇ][AÃ]O|CLIMATIZA[CÇ][AÃ]O|INDUSTRIA|IND[UÚ]STRIA|SERVICOS|SERVI[CÇ]OS|HOLDING|PARTICIPA[CÇ][OÕ]ES)\b/i.test(
        line,
      ) &&
      line.length >= 5 &&
      line.length <= 90 &&
      !/^\d/.test(line);

    if (inColigadasSection || looksLikeCompany) {
      // Lista numerada / com bullet
      const cleaned = line.replace(/^[-*•·\d.)\]]+\s*/, '').trim();
      if (cleaned.length >= 3 && (inColigadasSection || looksLikeCompany)) {
        push(cleaned, [cleaned]);
      }
    }
  }

  if (/\bA[\s.]*J[\s.]*T[\s.]*F\b/i.test(raw) || /\bAJTF\b/i.test(raw)) {
    push('A.J.T.F. LTDA', [
      'AJTF',
      'A.J.T.F',
      'A.J.T.F.',
      'A J T F',
      'A. J. T. F',
      'A. J. T. F.',
      'A.J.T.F. LTDA',
      'AJTF LTDA',
    ]);
  }

  for (const item of parseIaMarkerNomes(raw, ['coligadas'])) {
    push(item.nome, item.aliases);
  }

  return found.slice(0, 40);
}

export function extractSociosFromTexto(texto: string): Array<{ nome: string; aliases: string[] }> {
  const raw = String(texto ?? '');
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 400);
  const found: Array<{ nome: string; aliases: string[] }> = [];
  const seen = new Set<string>();

  const push = (nomeRaw: string, aliases: string[] = []) => {
    let nome = nomeRaw
      .replace(/^[\d.\-)\]\s]+/, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/[;,:]+$/g, '')
      .trim();
    nome = nome
      .replace(/^(socio|sócio|socios|sócios|administrador|quotista|titular)\s*[:\-–]?\s*/i, '')
      .trim();
    if (nome.length < 3 || nome.length > 80) return;
    if (isNomeSocioInvalido(nome)) return;
    if (/^\[IA\s+SOCIOS\]/i.test(nome)) return;
    if (/^(saldo|total|conta|codigo|código|página|pagina|capital)\b/i.test(nome)) return;
    if (/^\d+([.,]\d+)?%?$/.test(nome)) return;

    const key = compactAliasKey(nome) || nome.toUpperCase();
    if (!key || key.length < 3 || seen.has(key)) return;
    seen.add(key);

    const aliasSet = new Set<string>();
    for (const a of [nome, ...aliases]) {
      const t = a.trim().toUpperCase();
      if (t) aliasSet.add(t);
    }
    found.push({ nome: nome.trim(), aliases: Array.from(aliasSet).slice(0, 16) });
  };

  let inSociosSection = false;
  for (const line of lines) {
    if (/sócios?|socios?|quadro\s+social|contrato\s+social|administrador(es)?|quotistas?/i.test(line)) {
      inSociosSection = true;
      const after = line.match(
        /(?:sócios?|socios?|administrador(?:es)?)\s*[:\-–]\s*(.+)$/i,
      );
      if (after?.[1]) {
        for (const part of after[1].split(/[;|/•·]|(?:\s+e\s+)/i)) {
          const n = part.trim();
          if (n.length >= 3) push(n, [n]);
        }
      }
      continue;
    }
    if (
      inSociosSection &&
      /^(balanc|dre|ativo|passivo|coligad|empresa|razao|razão)\b/i.test(line)
    ) {
      inSociosSection = false;
    }

    const socioHit = line.match(/(?:socio|sócio)\s*[:\-–]?\s*(.+)$/i);
    if (socioHit?.[1]) {
      push(socioHit[1], [socioHit[1]]);
      continue;
    }

    const looksLikePerson =
      /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇa-záéíóúâêôãõç]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇa-záéíóúâêôãõç]+){1,5}$/.test(
        line.replace(/^[-*•·\d.)\]]+\s*/, '').trim(),
      ) &&
      line.length >= 6 &&
      line.length <= 70 &&
      !/\b(LTDA|ME|EPP|SA|EIRELI|COMERCIO|COMÉRCIO)\b/i.test(line);

    if (inSociosSection && looksLikePerson) {
      const cleaned = line.replace(/^[-*•·\d.)\]]+\s*/, '').trim();
      if (cleaned.length >= 3) push(cleaned, [cleaned]);
    }
  }

  for (const item of parseIaMarkerNomes(raw, ['socios'])) {
    push(item.nome, item.aliases);
  }

  return found.slice(0, 30);
}

export function matchSocioNoHistorico(
  historico: string,
  socios: AiSocio[],
): AiSocio | null {
  if (!historico.trim() || socios.length === 0) return null;
  for (const s of socios) {
    const candidates = [s.nome, ...s.aliases];
    for (const alias of candidates) {
      if (aliasMatchesHistorico(historico, alias)) return s;
    }
  }
  return null;
}

export function listAiSociosParaIa(company: string): AiSocio[] {
  return loadAiInteligencia(company).socios ?? [];
}

export function upsertSociosFromExtract(
  company: string,
  extracted: Array<{ nome: string; aliases: string[] }>,
): AiInteligenciaStore {
  const store = loadAiInteligencia(company);
  if (extracted.length === 0) return store;
  const next = [...(store.socios ?? [])];
  for (const ex of extracted) {
    const key = compactAliasKey(ex.nome);
    const existing = next.find(
      (s) =>
        compactAliasKey(s.nome) === key ||
        s.aliases.some((a) => compactAliasKey(a) === key),
    );
    if (existing) {
      const merged = new Set([...existing.aliases, ...ex.aliases.map((a) => a.toUpperCase())]);
      existing.aliases = Array.from(merged).slice(0, 16);
    } else {
      const s = sanitizeSocio({ nome: ex.nome, aliases: ex.aliases });
      if (s) next.push(s);
    }
  }
  return saveAiInteligencia(company, { ...store, socios: next });
}

/**
 * Relê documentos da pasta contratos e sincroniza sócios.
 */
export function syncSociosFromInteligenciaDocs(company: string): AiSocio[] {
  const store = loadAiInteligencia(company);
  const extracted: Array<{ nome: string; aliases: string[] }> = [];
  for (const d of store.docs) {
    if (d.pasta !== 'contratos' && d.pasta !== 'honorarios') continue;
    const texto = d.textoExtraido || '';
    if (!texto.trim() || texto.startsWith('[arquivo]')) continue;
    if (/^imagem\s+anexada:/i.test(texto.trim()) && texto.trim().length < 120) continue;
    extracted.push(...extractSociosFromTexto(texto));
  }
  if (extracted.length > 0) {
    upsertSociosFromExtract(company, extracted);
  }
  return listAiSociosParaIa(company);
}

/**
 * Relê todos os documentos da Inteligência IA e sincroniza a lista de coligadas.
 * Chamar antes de "IA Corrigir regras" para a IA não tratar coligada como fornecedor.
 */
export function syncColigadasFromInteligenciaDocs(company: string): AiColigada[] {
  const store = loadAiInteligencia(company);
  const extracted: Array<{ nome: string; aliases: string[] }> = [];
  for (const d of store.docs) {
    const texto = d.textoExtraido || '';
    if (!texto.trim() || texto.startsWith('[arquivo]')) continue;
    if (/^imagem\s+anexada:/i.test(texto.trim()) && texto.trim().length < 120) continue;
    extracted.push(...extractColigadasFromTexto(texto));
  }
  if (extracted.length > 0) {
    upsertColigadasFromExtract(company, extracted);
  }
  return listAiColigadasParaIa(company);
}

/** Conta do plano parece de fornecedor (terceiro) — proibida para coligada. */
export function isContaFornecedorNome(nomeConta: string): boolean {
  return /\bFORNECEDOR|\bFORN\b|DUPLICATA\s+A\s+PAGAR/i.test(String(nomeConta ?? ''));
}

/** Contas de patrimônio/ajuste — proibidas para coligada (ex.: reavaliação de ativos). */
export function isContaPatrimonioOuAjuste(nomeConta: string): boolean {
  return /REAVALIAC|DEPRECIAC|AMORTIZAC|PATRIMONIO\s+LIQUIDO|CAPITAL\s+SOCIAL|RESERVA|LUCROS?\s+A\s+DISTRIBUIR|PREJUIZO|AJUSTE\s+DE\s+EXERCIC/i.test(
    String(nomeConta ?? ''),
  );
}

/** Nome da conta no plano combina com coligada (razão social ou alias). */
export function contaCombinaComColigada(nomeConta: string, coligada: AiColigada): boolean {
  const candidates = [coligada.nome, ...coligada.aliases];
  for (const alias of candidates) {
    if (aliasMatchesHistorico(nomeConta, alias)) return true;
  }
  return false;
}

/** Conta adequada para lançamento de coligada (nome combina ou conta de mútuo/coligada). */
export function contaAceitavelParaColigada(nomeConta: string, coligada: AiColigada): boolean {
  if (isContaFornecedorNome(nomeConta) || /\bCLIENTE/i.test(nomeConta)) return false;
  if (isContaPatrimonioOuAjuste(nomeConta)) return false;
  if (contaCombinaComColigada(nomeConta, coligada)) return true;
  if (isContaColigadaNome(nomeConta)) return true;
  return false;
}

/** Conta do plano adequada para coligada / partes relacionadas. */
export function isContaColigadaNome(nomeConta: string): boolean {
  return /COLIGAD|PARTES?\s+RELACIONAD|EMPR[EÉ]STIMO\s+ENTRE|M[UÚ]TUO|CONTROLAD|PARTICIPAD|INTERCOMPANY|INTER\s*COMPAN/i.test(
    String(nomeConta ?? ''),
  );
}

/** Escolhe no plano a melhor conta de coligada (nunca fornecedor). */
export function pickContaColigadaNoPlano(
  plano: Array<{ code: string; name: string; codigoReduzido?: string }>,
  nomeColigada?: string,
): string {
  const prefer = plano.filter((p) => isContaColigadaNome(p.name));
  const pool = prefer.length > 0 ? prefer : [];
  if (pool.length === 0) return '';
  if (nomeColigada?.trim()) {
    const key = compactAliasKey(nomeColigada);
    const hit = pool.find((p) => compactAliasKey(p.name).includes(key) || key.includes(compactAliasKey(p.name)));
    if (hit) {
      return sanitizeCodigoReduzido(hit.codigoReduzido) || hit.code;
    }
  }
  const first = pool[0]!;
  return sanitizeCodigoReduzido(first.codigoReduzido) || first.code;
}

type PlanoColigadaRow = {
  code: string;
  name: string;
  codigoReduzido?: string;
  group?: string;
  grupo?: string;
};

function scoreContaPlanoParaColigada(
  p: PlanoColigadaRow,
  coligada: AiColigada,
  nature: 'D' | 'C',
): number {
  if (/^\s*BANCO\b/i.test(p.name)) return 0;
  if (isContaFornecedorNome(p.name) || /\bCLIENTE/i.test(p.name)) return 0;
  if (isContaPatrimonioOuAjuste(p.name)) return 0;

  let score = 0;
  if (contaCombinaComColigada(p.name, coligada)) score += 55;
  if (isContaColigadaNome(p.name)) score += 18;
  if (grupoContaPlano(p) === (nature === 'D' ? 'ATIVO' : 'PASSIVO')) score += 22;
  if (/\bLTDA\b|\bME\b|\bEIRELI\b/.test(p.name)) score += 8;
  return score;
}

/**
 * Busca no plano a conta cujo NOME combina com a coligada (razão social no plano).
 * Cruza aliases — ex.: AJTF → "A.J.T.F. LTDA" reduzido 1094.
 */
export function pickContaColigadaPorNomeNoPlano(
  plano: PlanoColigadaRow[],
  coligada: AiColigada,
  nature: 'D' | 'C',
): string {
  const ranked = plano
    .map((p) => ({ p, score: scoreContaPlanoParaColigada(p, coligada, nature) }))
    .filter((x) => x.score >= 40)
    .sort((a, b) => {
      const diff = b.score - a.score;
      if (diff !== 0) return diff;
      const aExplicit = Boolean(a.p.group || a.p.grupo);
      const bExplicit = Boolean(b.p.group || b.p.grupo);
      if (aExplicit !== bExplicit) return aExplicit ? -1 : 1;
      return compactAliasKey(b.p.name).length - compactAliasKey(a.p.name).length;
    });
  const best = ranked[0];
  if (!best) return '';
  return sanitizeCodigoReduzido(best.p.codigoReduzido) || best.p.code;
}

/** Preenche contaReduzida das coligadas a partir do plano (quando ainda não cadastrada). */
export function enrichColigadasComContasDoPlano(
  coligadas: AiColigada[],
  plano: PlanoColigadaRow[],
): AiColigada[] {
  if (!coligadas.length || !plano.length) return coligadas;
  return coligadas.map((c) => {
    if (c.contaReduzida?.trim()) return c;
    const red =
      pickContaColigadaPorNomeNoPlano(plano, c, 'D') ||
      pickContaColigadaPorNomeNoPlano(plano, c, 'C');
    return red ? { ...c, contaReduzida: red } : c;
  });
}

function grupoContaPlano(p: { code: string; group?: string; grupo?: string }): string {
  const g = String(p.group ?? p.grupo ?? '').trim().toUpperCase();
  if (g) return g;
  const digits = String(p.code ?? '').replace(/\D/g, '');
  if (digits.startsWith('1')) return 'ATIVO';
  if (digits.startsWith('2')) return 'PASSIVO';
  return '';
}

/**
 * Conta correta para coligada conforme natureza do lançamento.
 * Saída (D) → ATIVO (mútuo a receber); entrada (C) → PASSIVO (mútuo a pagar).
 */
export function resolveContaColigadaParaNatureza(
  coligada: AiColigada,
  nature: 'D' | 'C',
  plano: Array<{ code: string; name: string; codigoReduzido?: string; group?: string; grupo?: string }>,
): string {
  const preferGrupo = nature === 'D' ? 'ATIVO' : 'PASSIVO';

  if (coligada.contaReduzida?.trim()) {
    const red =
      sanitizeCodigoReduzido(coligada.contaReduzida) ||
      resolveCodigoReduzidoDoPlano(coligada.contaReduzida, plano) ||
      '';
    if (red) {
      const hit = plano.find(
        (p) =>
          sanitizeCodigoReduzido(p.codigoReduzido) === red ||
          sanitizeCodigoReduzido(p.code) === red,
      );
      if (hit && contaAceitavelParaColigada(hit.name, coligada)) {
        return red;
      }
    }
  }

  const porNome = pickContaColigadaPorNomeNoPlano(plano, coligada, nature);
  if (porNome) return porNome;

  const coligContas = plano.filter(
    (p) => isContaColigadaNome(p.name) && !isContaPatrimonioOuAjuste(p.name),
  );
  const key = compactAliasKey(coligada.nome);
  const byNome = coligContas.filter((p) => {
    const pk = compactAliasKey(p.name);
    return pk.includes(key) || key.includes(pk);
  });
  const pool = byNome.length > 0 ? byNome : coligContas;

  const byGrupo = pool.find((p) => grupoContaPlano(p) === preferGrupo);
  if (byGrupo) {
    return sanitizeCodigoReduzido(byGrupo.codigoReduzido) || byGrupo.code;
  }

  const byNomePlano = pickContaColigadaNoPlano(plano, coligada.nome);
  if (byNomePlano) return byNomePlano;

  const first = pool[0];
  return first ? sanitizeCodigoReduzido(first.codigoReduzido) || first.code : '';
}

/** Busca coligada na descrição da regra ou nos históricos do extrato do lote. */
export function matchColigadaParaRegra(
  descricao: string,
  coligadas: AiColigada[],
  extratoHistoricos: string[] = [],
): AiColigada | null {
  const hit = matchColigadaNoHistorico(descricao, coligadas);
  if (hit) return hit;
  for (const h of extratoHistoricos) {
    const hHit = matchColigadaNoHistorico(h, coligadas);
    if (hHit) return hHit;
  }
  return null;
}

export function upsertColigadasFromExtract(
  company: string,
  extracted: Array<{ nome: string; aliases: string[] }>,
): AiInteligenciaStore {
  const store = loadAiInteligencia(company);
  if (extracted.length === 0) return store;
  const next = [...store.coligadas];
  for (const ex of extracted) {
    const key = compactAliasKey(ex.nome);
    const existing = next.find(
      (c) =>
        compactAliasKey(c.nome) === key ||
        c.aliases.some((a) => compactAliasKey(a) === key),
    );
    if (existing) {
      const merged = new Set([...existing.aliases, ...ex.aliases.map((a) => a.toUpperCase())]);
      existing.aliases = Array.from(merged).slice(0, 24);
    } else {
      const c = sanitizeColigada({
        nome: ex.nome,
        aliases: ex.aliases,
      });
      if (c) next.push(c);
    }
  }
  return saveAiInteligencia(company, { ...store, coligadas: next });
}

export function addAiInteligenciaDocs(
  company: string,
  docs: Array<Omit<AiInteligenciaDoc, 'id' | 'uploadedAt'> & { id?: string }>,
): AiInteligenciaStore {
  const store = loadAiInteligencia(company);
  const added: AiInteligenciaDoc[] = [];
  for (const d of docs) {
    const doc = sanitizeDoc({
      ...d,
      id: d.id || generateUUID(),
      uploadedAt: new Date().toISOString(),
      textoExtraido: String(d.textoExtraido ?? '').slice(0, MAX_TEXTO_POR_DOC),
    });
    if (doc) added.push(doc);
  }
  // Dedup por pasta + nome + tamanho (mesmo arquivo em pastas diferentes é permitido)
  const existingKeys = new Set(store.docs.map((d) => `${d.pasta}::${d.nome}::${d.size}`));
  const fresh = added.filter((d) => !existingKeys.has(`${d.pasta}::${d.nome}::${d.size}`));
  if (fresh.length === 0 && added.length > 0) {
    // Já existia — devolve store atual (não é falha)
    return store;
  }
  return saveAiInteligencia(company, {
    ...store,
    docs: [...fresh, ...store.docs].slice(0, MAX_DOCS),
  });
}

export function removeAiInteligenciaDoc(company: string, id: string): AiInteligenciaStore {
  const store = loadAiInteligencia(company);
  const slug = companyStorageSlug(company);
  getTextMap(slug).delete(id);
  void idbDeleteDocText(slug, id);
  return saveAiInteligencia(company, {
    ...store,
    docs: store.docs.filter((d) => d.id !== id),
    updatedAt: new Date().toISOString(),
  });
}

export function upsertAiColigada(
  company: string,
  draft: Omit<AiColigada, 'id'> & { id?: string },
): AiInteligenciaStore {
  const store = loadAiInteligencia(company);
  const col = sanitizeColigada(draft);
  if (!col) return store;
  const idx = store.coligadas.findIndex((c) => c.id === col.id);
  const coligadas =
    idx >= 0
      ? store.coligadas.map((c, i) => (i === idx ? col : c))
      : [...store.coligadas, col];
  return saveAiInteligencia(company, { ...store, coligadas });
}

export function removeAiColigada(company: string, id: string): AiInteligenciaStore {
  const store = loadAiInteligencia(company);
  return saveAiInteligencia(company, {
    ...store,
    coligadas: store.coligadas.filter((c) => c.id !== id),
  });
}

export function purgeAiInteligenciaCachesForCompany(company: string): void {
  const slug = companyStorageSlug(company);
  storeCache.delete(slug);
  textCache.delete(slug);
}

export const PASTA_LABELS: Record<AiInteligenciaPasta, string> = {
  coligadas: 'Coligadas',
  contratos: 'Contratos / sócios',
  honorarios: 'Honorários',
  funcionarios: 'Funcionários',
  despesas: 'Despesas',
  receitas: 'Receitas',
};

export function updateAiInteligenciaPastaConfig(
  company: string,
  pasta: AiInteligenciaPasta,
  patch: Partial<AiInteligenciaPastaConfig>,
): AiInteligenciaStore {
  const store = loadAiInteligencia(company);
  const configs = mergePastaConfigs(store.pastaConfigs);
  configs[pasta] = sanitizePastaConfig({ ...configs[pasta], ...patch });
  return saveAiInteligencia(company, { ...store, pastaConfigs: configs });
}

/** Limpa só textos GIGANTES legados — preserva lista de documentos nas pastas. */
export function migrateAiInteligenciaOutOfLocalStorage(company: string): void {
  const key = storageKey(company);
  try {
    const raw = safeLocalStorageGetItem(key);
    if (!raw) return;
    // Só enxuga se o payload legado for enorme (textos embutidos)
    if (raw.length <= 80_000) return;
  } catch {
    return;
  }
  const store = loadAiInteligencia(company);
  void persistTextsAndSlim(company, store);
}
