/**
 * backupDataMigration.ts
 *
 * Pipeline de migração de dados para garantir que backups de versões antigas
 * do sistema sejam sempre restaurados corretamente, sem perda de informação.
 *
 * Nunca rejeita dados antigos — aplica defaults e normaliza campos renomeados.
 */

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

type Nature = 'D' | 'C';
type ExtratoStatus = 'CONCILIADO' | 'PENDENTE';

interface RawExtratoRow {
  id?: unknown;
  date?: unknown;
  description?: unknown;
  value?: unknown;
  nature?: unknown;
  /** Campo legado — substitui accountDebit+accountCredit quando ambos ausentes. */
  accountCode?: unknown;
  accountDebit?: unknown;
  accountCredit?: unknown;
  operationName?: unknown;
  status?: unknown;
  [key: string]: unknown;
}

interface RawPlanoRow {
  code?: unknown;
  name?: unknown;
  codigoReduzido?: unknown;
  /** Campo legado de algumas versões. */
  reducedCode?: unknown;
  [key: string]: unknown;
}

interface RawExtratoRegraConta {
  id?: unknown;
  nome?: unknown;
  descricao?: unknown;
  nature?: unknown;
  contaBanco?: unknown;
  contaContrapartida?: unknown;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeStr(v: unknown, fallback = ''): string {
  if (v == null) return fallback;
  return String(v).trim();
}

function safeNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function legacyUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ---------------------------------------------------------------------------
// Migração de linhas do Extrato
// ---------------------------------------------------------------------------

/**
 * Normaliza uma linha do extrato vinda de um backup antigo.
 *
 * Mudanças tratadas:
 * - `accountCode` (campo único, legado) → inferidos `accountDebit`/`accountCredit`
 *   com base em `nature`: D → accountDebit, C → accountCredit
 * - Campos obrigatórios ausentes recebem defaults seguros
 * - `status` inválido → 'PENDENTE'
 */
function migrateExtratoRow(raw: RawExtratoRow): RawExtratoRow {
  const nature: Nature = raw.nature === 'C' ? 'C' : 'D';
  const legacyCode = safeStr(raw.accountCode);
  let accountDebit = safeStr(raw.accountDebit);
  let accountCredit = safeStr(raw.accountCredit);

  // Se os campos modernos estiverem ausentes, inferir a partir de accountCode legado
  if (legacyCode && !accountDebit && !accountCredit) {
    if (nature === 'D') {
      accountDebit = legacyCode;
    } else {
      accountCredit = legacyCode;
    }
  }

  const status: ExtratoStatus =
    raw.status === 'CONCILIADO' ? 'CONCILIADO' : 'PENDENTE';

  return {
    ...raw,
    id: safeStr(raw.id) || legacyUUID(),
    date: safeStr(raw.date) || '1900-01-01',
    description: safeStr(raw.description),
    value: safeNum(raw.value),
    nature,
    accountCode: legacyCode,
    accountDebit: accountDebit || undefined,
    accountCredit: accountCredit || undefined,
    operationName: raw.operationName != null ? safeStr(raw.operationName) : undefined,
    status,
  };
}

/** Normaliza um array de linhas do extrato (suporta formato antigo e atual). */
export function migrateExtratoRows(rows: unknown[]): unknown[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    if (!r || typeof r !== 'object') return r;
    return migrateExtratoRow(r as RawExtratoRow);
  });
}

// ---------------------------------------------------------------------------
// Migração de linhas do Plano de Contas
// ---------------------------------------------------------------------------

/**
 * Normaliza uma linha do plano de contas.
 * - `reducedCode` (legado) → `codigoReduzido`
 * - Linhas sem `code` são descartadas
 */
function migratePlanoRow(raw: RawPlanoRow): RawPlanoRow | null {
  const code = safeStr(raw.code);
  if (!code) return null;
  const name = safeStr(raw.name);
  const codigoReduzido =
    safeStr(raw.codigoReduzido) || safeStr(raw.reducedCode) || '';

  const result: RawPlanoRow = {
    ...raw,
    code,
    name,
    codigoReduzido: codigoReduzido || undefined,
  };
  // Remove campo legado para não poluir o storage
  delete result['reducedCode'];
  return result;
}

/** Normaliza um array de linhas do plano de contas. */
export function migratePlanoRows(rows: unknown[]): unknown[] {
  if (!Array.isArray(rows)) return [];
  const out: unknown[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const migrated = migratePlanoRow(r as RawPlanoRow);
    if (migrated) out.push(migrated);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Migração de Regras de Contas
// ---------------------------------------------------------------------------

function migrateExtratoRegraConta(raw: RawExtratoRegraConta): RawExtratoRegraConta {
  return {
    ...raw,
    id: safeStr(raw.id) || legacyUUID(),
    nome: safeStr(raw.nome),
    descricao: safeStr(raw.descricao),
    nature: raw.nature === 'C' ? 'C' : 'D',
    contaBanco: safeStr(raw.contaBanco),
    contaContrapartida: safeStr(raw.contaContrapartida),
  };
}

export function migrateExtratoRegrasContas(rows: unknown[]): unknown[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && typeof r === 'object')
    .map((r) => migrateExtratoRegraConta(r as RawExtratoRegraConta))
    .filter((r) => (r as RawExtratoRegraConta).descricao && (r as RawExtratoRegraConta).contaContrapartida && (r as RawExtratoRegraConta).contaBanco);
}

// ---------------------------------------------------------------------------
// Mapa e função de migração de sufixos de chaves legadas
// ---------------------------------------------------------------------------

export const LEGACY_KEY_MAP: Record<string, string> = {
  '_extrato_regras_contas_v1': '_extrato_regras_contas_v2',
  '_extrato_regras_banco_v1': '_extrato_regras_banco_v2',
  '_extrato_pasta_ativa_v1': '_extrato_pasta_ativa_v2',
};

export function migrateKey(origKey: string): string {
  for (const [oldSuffix, newSuffix] of Object.entries(LEGACY_KEY_MAP)) {
    if (origKey.endsWith(oldSuffix)) {
      return origKey.replace(oldSuffix, newSuffix);
    }
  }
  return origKey;
}

// ---------------------------------------------------------------------------
// Dispatcher por sufixo de chave
// ---------------------------------------------------------------------------

const EXTRATO_SUFFIX_RE = /_extrato$/;
const PLANO_SUFFIX_RE = /_plano$/;
const EXTRATO_REGRAS_SUFFIX_RE = /_extrato_regras_contas_v[12]$/;

/**
 * Aplica a migração correta para um valor de storage com base no sufixo da chave.
 * Retorna o valor migrado (ou o original se nenhuma migração se aplicar).
 */
export function migrateStorageValue(key: string, value: unknown): unknown {
  if (!Array.isArray(value) || value.length === 0) return value;

  if (EXTRATO_SUFFIX_RE.test(key)) return migrateExtratoRows(value);
  if (PLANO_SUFFIX_RE.test(key)) return migratePlanoRows(value);
  if (EXTRATO_REGRAS_SUFFIX_RE.test(key)) return migrateExtratoRegrasContas(value);
  return value;
}

// ---------------------------------------------------------------------------
// Chaves globais legadas sem prefixo de empresa
// ---------------------------------------------------------------------------

/**
 * Mapa de chaves globais legadas (sem prefixo de empresa) para o sufixo
 * gerenciado moderno.
 */
export const GLOBAL_LEGACY_KEY_MAP: Record<string, string> = {
  plano_contas_central: 'plano',
  extrato_lancamentos: 'extrato',
  folha_payroll_central: 'folha',
  folha_relatorio_lancamentos: 'folhaRelatorio',
  razao_lancamentos: 'razao',
  balancete_rows: 'balancete',
  fiscal_sped_import: 'fiscalSped',
  fiscal_pgdas_import: 'fiscalPgdas',
  fiscal_ocr_relatorio: 'fiscalOcr',
  fiscal_nfe_cache: 'fiscalNfe',
  fiscal_contas_imposto: 'fiscalContasImposto',
  fiscal_cfop_descricoes: 'fiscalCfopDescricoes',
  folha_contas_automacao: 'folhaContasAutomacao',
  folha_regras: 'folhaRegras',
  honorarios_lancamentos: 'honorariosLancamentos',
  honorarios_contas_automacao: 'honorariosContasAutomacao',
  sped_parser_pro_data: 'spedParserProData',
  custos_faturamento: 'custos',
  loans_contracts: 'loans',
};

export function isGlobalLegacyKey(key: string): boolean {
  return key in GLOBAL_LEGACY_KEY_MAP;
}

export function globalLegacySuffix(key: string): string | null {
  return GLOBAL_LEGACY_KEY_MAP[key] ?? null;
}

// ---------------------------------------------------------------------------
// Heurística para detectar o slug da empresa principal no storage
// ---------------------------------------------------------------------------

/**
 * Detecta o slug da empresa principal analisando chaves `contabilfacil_*_plano`
 * ou `contabilfacil_*_extrato`. Retorna o slug com mais dados, ou null.
 */
export function detectMainCompanySlug(storage: Record<string, unknown>): string | null {
  const RE = /^contabilfacil_(.+)_(plano|extrato)$/;
  const scores = new Map<string, number>();

  for (const [key, value] of Object.entries(storage)) {
    const m = key.match(RE);
    if (!m) continue;
    const slug = m[1];
    const count = Array.isArray(value) ? value.length : 1;
    scores.set(slug, (scores.get(slug) ?? 0) + count);
  }

  if (scores.size === 0) return null;

  let best: string | null = null;
  let bestScore = 0;
  for (const [slug, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      best = slug;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Pipeline principal — Backup completo { storage: Record<string, unknown> }
// ---------------------------------------------------------------------------

/**
 * Percorre todo o objeto `storage` de um backup completo e aplica todas as
 * migrações de dados conhecidas. Retorna um novo objeto com os dados migrados.
 *
 * Também lida com chaves globais legadas (sem prefixo de empresa): se o backup
 * tiver `plano_contas_central`, remapeia para `contabilfacil_<slug>_plano`.
 */
export function migrateFullBackupStorage(
  storage: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const mainSlug = detectMainCompanySlug(storage);

  for (const [key, value] of Object.entries(storage)) {
    // Trata chaves globais legadas
    if (isGlobalLegacyKey(key)) {
      const suffix = globalLegacySuffix(key);
      if (suffix && mainSlug) {
        const newKey = `contabilfacil_${mainSlug}_${suffix}`;
        // Só remapeia se a chave moderna ainda não existir no backup
        if (!(newKey in storage) && !(newKey in result)) {
          result[newKey] = migrateStorageValue(newKey, value);
        }
        // Descarta a chave legada
        continue;
      }
      result[key] = value;
      continue;
    }

    result[key] = migrateStorageValue(key, value);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Pipeline principal — Backup legado [key, value][]
// ---------------------------------------------------------------------------

/**
 * Percorre as entradas de um backup legado (BackupService) e aplica todas as
 * migrações de chave e dados conhecidas. Retorna as entradas migradas.
 *
 * @param entries  Entradas brutas do backup
 * @param migrateKey  Função de migração de chave (ex.: backupKeyMigration.migrateKey)
 */
export function migrateBackupEntries(
  entries: Array<[string, string]>,
  migrateKey: (key: string) => string,
): Array<[string, string]> {
  // Monta mapa para detectar slug principal
  const storageLike: Record<string, unknown> = {};
  for (const [k, v] of entries) {
    try {
      storageLike[k] = JSON.parse(v);
    } catch {
      storageLike[k] = v;
    }
  }
  const mainSlug = detectMainCompanySlug(storageLike);

  const out: Array<[string, string]> = [];
  const seenKeys = new Set<string>();

  for (const [origKey, rawVal] of entries) {
    let migratedKey = migrateKey(origKey);

    // Remap de chaves globais legadas
    if (isGlobalLegacyKey(origKey)) {
      const suffix = globalLegacySuffix(origKey);
      if (suffix && mainSlug) {
        const newKey = `contabilfacil_${mainSlug}_${suffix}`;
        if (!seenKeys.has(newKey)) {
          migratedKey = newKey;
        } else {
          continue; // chave já existe — pula
        }
      }
    }

    if (seenKeys.has(migratedKey)) continue;
    seenKeys.add(migratedKey);

    let parsedVal: unknown;
    try {
      parsedVal = JSON.parse(rawVal);
    } catch {
      parsedVal = rawVal;
    }

    const migratedVal = migrateStorageValue(migratedKey, parsedVal);
    const serialized =
      typeof migratedVal === 'string' ? migratedVal : JSON.stringify(migratedVal);

    out.push([migratedKey, serialized]);
  }

  return out;
}
