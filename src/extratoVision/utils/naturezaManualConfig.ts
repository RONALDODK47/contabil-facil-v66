import type { VisionBalanceteRow } from '../types/accounting';
import {
  readPersistedLocalStorageJson,
  writePersistedLocalStorageJson,
} from '../../lib/persistentLocalStorage';
import { generateUUID } from '../../lib/uuid';
import { getClassificacao } from './demonstracoesContabeis';

/**
 * Override manual de natureza (D/C) para uma ou mais contas sintéticas (e sua
 * descendência). Quando `classificacoes` tem mais de um item, é um "grupo"
 * nomeado manualmente pelo usuário (não há uma única classificação para
 * representar o conjunto); com um único item, `nome` é opcional (cai no nome
 * da própria conta no plano).
 */
export type NaturezaManualEntry = {
  /** Estável — necessário pois a chave não é mais só "classificacao" (pode haver várias). */
  id: string;
  classificacoes: string[];
  nome?: string;
  natureza: 'D' | 'C';
  /** Descrições ou códigos de contas dentro deste grupo que possuem natureza INVERTIDA em relação ao grupo */
  descricoesInvertidas?: string[];
};

/**
 * Pasta de regras de natureza — compartilhada entre empresas que usam o mesmo
 * "tipo" de plano de contas (mesmos grupos/classificação). Cada empresa pertence
 * a no máximo uma pasta por vez; uma pasta pode se aplicar a todas as empresas
 * ou só às selecionadas.
 */
export type NaturezaRegraFolder = {
  id: string;
  nome: string;
  aplicarATodas: boolean;
  /** Ignorado quando aplicarATodas === true. */
  empresas: string[];
  entries: NaturezaManualEntry[];
};

const STORAGE_KEY = 'extratoVision_natureza_regras_pastas_v1';

type PersistPayload = { folders: NaturezaRegraFolder[] };

function normEmpresa(empresa: string): string {
  return empresa.trim().toLowerCase();
}

function normCls(cls: string): string {
  return cls.replace(/\./g, '').replace(/\s/g, '').trim();
}

/** Classificação estruturada (com hierarquia por ponto) — descarta código reduzido puro. */
function isClassificacaoEstruturada(cls: string): boolean {
  return cls.includes('.') && cls.split('.').filter(Boolean).length >= 2;
}

function readRawPayload(): PersistPayload {
  // Usa a mesma camada segura da gravação (writePersistedLocalStorageJson → safeLocalStorageSetItem):
  // chaves "operacionais" (fora dos prefixos gc_auth_/cf-autobot_/contabilfacil_) ficam só no
  // fallback em memória do safeLocalStorage, nunca no localStorage real — ler direto daria vazio.
  const parsed = readPersistedLocalStorageJson<unknown>(STORAGE_KEY, { folders: [] });
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as PersistPayload).folders)) {
    return { folders: [] };
  }
  return parsed as PersistPayload;
}

/** Formato legado (anterior ao suporte a grupos com várias contas) — uma entrada por classificação. */
type NaturezaManualEntryLegado = { classificacao?: string };

function sanitizeEntry(
  raw: Partial<NaturezaManualEntry> & NaturezaManualEntryLegado,
): NaturezaManualEntry | null {
  const classificacoesBrutas = Array.isArray(raw.classificacoes)
    ? raw.classificacoes
    : raw.classificacao
      ? [raw.classificacao]
      : [];
  const classificacoes = [
    ...new Set(classificacoesBrutas.map((c) => String(c ?? '').trim()).filter(Boolean)),
  ];
  const natureza = raw.natureza === 'C' ? 'C' : raw.natureza === 'D' ? 'D' : null;
  if (classificacoes.length === 0 || !natureza) return null;

  const descricoesInvertidas = Array.isArray(raw.descricoesInvertidas)
    ? [...new Set(raw.descricoesInvertidas.map((d) => String(d ?? '').trim()).filter(Boolean))]
    : undefined;

  return {
    id: raw.id?.trim() || generateUUID(),
    classificacoes,
    nome: raw.nome?.trim() || undefined,
    natureza,
    ...(descricoesInvertidas && descricoesInvertidas.length > 0 ? { descricoesInvertidas } : {}),
  };
}

/**
 * Sentinel usado pelo modal (NaturezaContasManualModal) para representar "+ Nova pasta"
 * ainda não salva. Nunca pode ser persistido como id real — colidiria com essa opção do
 * <select> (mesmo value), fazendo a pasta salva "sumir" atrás da opção "+ Nova pasta" e
 * o clique nela cair no branch de "criar pasta vazia" em vez de selecioná-la.
 */
const ID_SENTINEL_INVALIDO = '__nova__';

function sanitizeFolder(raw: Partial<NaturezaRegraFolder>): NaturezaRegraFolder | null {
  const nome = String(raw.nome ?? '').trim();
  if (!nome) return null;
  const entries: NaturezaManualEntry[] = [];
  for (const e of Array.isArray(raw.entries) ? raw.entries : []) {
    const s = sanitizeEntry(e as Partial<NaturezaManualEntry> & NaturezaManualEntryLegado);
    if (s) entries.push(s);
  }
  const empresas = Array.isArray(raw.empresas)
    ? [...new Set(raw.empresas.map((e) => normEmpresa(String(e))).filter(Boolean))]
    : [];
  const idBruto = raw.id?.trim() ?? '';
  return {
    id: idBruto && idBruto !== ID_SENTINEL_INVALIDO ? idBruto : generateUUID(),
    nome,
    aplicarATodas: raw.aplicarATodas === true,
    empresas,
    entries,
  };
}

export function readNaturezaFolders(): NaturezaRegraFolder[] {
  const { folders } = readRawPayload();
  const out: NaturezaRegraFolder[] = [];
  let precisaCorrigir = false;
  for (const raw of folders) {
    const s = sanitizeFolder(raw);
    if (!s) continue;
    // Auto-cura: pasta persistida com o id sentinel inválido (bug antigo) ganha aqui um
    // UUID novo — grava de volta para o id ficar estável entre leituras (senão mudaria a
    // cada chamada, quebrando a seleção no <select> assim que o componente re-renderizasse).
    if ((raw as Partial<NaturezaRegraFolder>).id !== s.id) precisaCorrigir = true;
    out.push(s);
  }
  if (precisaCorrigir) {
    writePersistedLocalStorageJson(STORAGE_KEY, { folders: out } satisfies PersistPayload);
  }
  return out;
}

/**
 * Salva (cria ou atualiza) uma pasta de regras. Garante que cada empresa
 * pertença a no máximo uma pasta — remove a empresa das demais pastas
 * explícitas quando ela é atribuída a esta.
 */
export function upsertNaturezaFolder(folder: NaturezaRegraFolder): NaturezaRegraFolder {
  const sanitized = sanitizeFolder(folder);
  if (!sanitized) throw new Error('Pasta de regras inválida: informe um nome.');

  const folders = readNaturezaFolders();
  const idx = folders.findIndex((f) => f.id === sanitized.id);
  const next = idx >= 0 ? [...folders] : [...folders, sanitized];
  if (idx >= 0) next[idx] = sanitized;

  const withoutOverlap = next.map((f) => {
    if (f.id === sanitized.id || sanitized.aplicarATodas || sanitized.empresas.length === 0) return f;
    if (f.aplicarATodas) return f;
    const empresas = f.empresas.filter((e) => !sanitized.empresas.includes(e));
    return empresas.length === f.empresas.length ? f : { ...f, empresas };
  });

  writePersistedLocalStorageJson(STORAGE_KEY, { folders: withoutOverlap } satisfies PersistPayload);
  return sanitized;
}

export function deleteNaturezaFolder(id: string): void {
  const folders = readNaturezaFolders().filter((f) => f.id !== id);
  writePersistedLocalStorageJson(STORAGE_KEY, { folders } satisfies PersistPayload);
}

/** Pasta à qual a empresa pertence hoje — atribuição explícita vence sobre "todas". */
export function getFolderForEmpresa(
  empresa: string,
  folders: NaturezaRegraFolder[] = readNaturezaFolders(),
): NaturezaRegraFolder | undefined {
  const alvo = normEmpresa(empresa);
  if (!alvo) return undefined;
  const explicita = folders.find((f) => !f.aplicarATodas && f.empresas.includes(alvo));
  if (explicita) return explicita;
  return folders.find((f) => f.aplicarATodas);
}

export function readNaturezaManualEntries(empresa: string): NaturezaManualEntry[] {
  return getFolderForEmpresa(empresa)?.entries ?? [];
}

/**
 * Overrides ativos na empresa atualmente aberta no Balancete. Usado pelos
 * consumidores de naturezaContabil.ts que não recebem parâmetro (thread
 * principal) e pelos cálculos do comparativo mensal, que são "primados"
 * explicitamente antes de rodar (inclusive dentro do Web Worker, via
 * MontarComparativoParams.naturezaManualEntries).
 */
let activeEntries: NaturezaManualEntry[] = [];

export function setActiveNaturezaManualEntries(entries: NaturezaManualEntry[] | undefined | null): void {
  activeEntries = Array.isArray(entries) ? entries : [];
}

export function getActiveNaturezaManualEntries(): NaturezaManualEntry[] {
  return activeEntries;
}

/**
 * Natureza manualmente atribuída pelo usuário para a conta (ou herdada da
 * sintética ancestral mais específica que tiver override). `undefined` quando
 * não há override aplicável — nesse caso o chamador deve cair na heurística
 * padrão de naturezaContabil.ts.
 */
export function resolveNaturezaManual(
  row: Partial<Pick<VisionBalanceteRow, 'classificacao' | 'codigo' | 'nome'>>,
  empresa?: string,
): 'D' | 'C' | undefined {
  // Se activeEntries em memória estiver vazio, carrega automaticamente das pastas salvas no localStorage
  let entriesToUse = activeEntries;
  if (entriesToUse.length === 0) {
    try {
      const folders = readNaturezaFolders();
      if (folders.length > 0) {
        if (empresa) {
          entriesToUse = readNaturezaManualEntries(empresa);
        }
        if (entriesToUse.length === 0) {
          const defaultFolder = folders.find((f) => f.aplicarATodas) ?? folders[0];
          entriesToUse = defaultFolder?.entries ?? [];
        }
      }
    } catch {
      entriesToUse = [];
    }
  }

  if (entriesToUse.length === 0) return undefined;

  const cls = getClassificacao(row as VisionBalanceteRow);
  if (!cls || !isClassificacaoEstruturada(cls)) return undefined;

  const rowNorm = normCls(cls);
  const nomeRaw = String(row.nome ?? '');
  const nomeRow = nomeRaw.toLowerCase();
  const temPrefixoDedutora = /\(\s*[-‐‑‒–—−]\s*\)/.test(nomeRaw.normalize('NFKC'));

  let best: NaturezaManualEntry | undefined;
  let bestLen = -1;
  for (const entry of entriesToUse) {
    for (const classificacao of entry.classificacoes) {
      const entryNorm = normCls(classificacao);
      if (!entryNorm) continue;
      if (rowNorm.startsWith(entryNorm) && entryNorm.length > bestLen) {
        best = entry;
        bestLen = entryNorm.length;
      }
    }
  }

  if (!best) return undefined;

  // Conta com o sinal (-) na descrição: natureza oposta à do grupo configurado.
  // EXCEÇÃO (dupla inversão): se a natureza configurada do grupo JÁ é invertida em
  // relação à natureza padrão do grupo raiz (1 Ativo=D, 2 Passivo/PL=C, 3 Receitas=C,
  // 4+ Custos/Despesas=D), o grupo em si é dedutor/retificador — ex.: "Deduções da
  // Receita" cadastrado como Devedora dentro do grupo 3. Nesse caso a conta filha
  // com (-) pertence ao mesmo conjunto dedutor e HERDA a natureza do grupo, sem
  // inverter de novo (senão "(-) SIMPLES NACIONAL" voltaria a ficar credora).
  if (temPrefixoDedutora) {
    const root = rowNorm[0] ?? '';
    const padraoGrupo: 'D' | 'C' = root === '2' || root === '3' ? 'C' : 'D';
    if (best.natureza !== padraoGrupo) return best.natureza;
    return best.natureza === 'D' ? 'C' : 'D';
  }

  return best.natureza;
}
