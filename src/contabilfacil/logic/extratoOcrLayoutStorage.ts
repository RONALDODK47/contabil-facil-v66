import type { GenericColunaDef } from '../../lib/parcelamentoColunasExtract';
import { generateUUID } from '../../lib/uuid';
import { companyStorageSlug } from './companyWorkspace';
import { saveExtratoRegrasBancoSelecionado } from './extratoRegrasContasStorage';
import {
  readPersistedLocalStorageJson,
  writePersistedLocalStorageJson,
} from '../../lib/persistentLocalStorage';

export type ExtratoFaixaPaginaSaved = {
  faixaStartNorm: number;
  faixaEndNorm: number;
  faixaInicioMarcado: boolean;
  faixaFimMarcado: boolean;
  semDelimitacaoVertical?: boolean;
};

export type ExtratoOcrLayoutColumnNorm = {
  id: string;
  startNorm: number;
  endNorm: number;
};

export type ExtratoOcrLayoutSaved = {
  id: string;
  bancoNome: string;
  contaBanco: string;
  /** plano | balancete | extrato | folha | … — separa layouts salvos por módulo */
  kind?: string;
  ignoreLineWords: string;
  cleanupWords?: string;
  semDelimitacaoVertical: boolean;
  columns: GenericColunaDef[];
  /** Posição normalizada 0–1 na largura da imagem (independe de escala). */
  columnsNorm?: ExtratoOcrLayoutColumnNorm[];
  faixaStart: number;
  faixaEnd: number;
  /** Posição normalizada 0–1 na altura da imagem (legado — preferir faixaPorPagina). */
  faixaStartNorm?: number;
  faixaEndNorm?: number;
  faixaInicioMarcado: boolean;
  faixaFimMarcado: boolean;
  /** Delimitação por página: «1» = verde abaixo do saldo; última = vermelha no fim. */
  faixaPorPagina?: Record<string, ExtratoFaixaPaginaSaved>;
  /** Página onde a linha verde (início) foi marcada. */
  faixaInicioPagina?: number;
  /** Página onde a linha vermelha (fim) foi marcada. */
  faixaFimPagina?: number;
  imgWidth: number;
  imgHeight: number;
  createdAt: string;
  updatedAt: string;
  valorSignHeuristic?: 'automatic' | 'color_blue_c_red_d' | 'color_blue_d_red_c';
};

type ExtratoOcrLayoutStore = {
  layouts: ExtratoOcrLayoutSaved[];
  activeLayoutId: string | null;
  activeByKind?: Record<string, string>;
};

function layoutKindOf(layout: Pick<ExtratoOcrLayoutSaved, 'kind' | 'contaBanco'>): string {
  if (layout.kind?.trim()) return layout.kind.trim();
  const conta = layout.contaBanco.trim();
  if (conta === 'plano' || conta === 'balancete' || conta === 'folha' || conta === 'fiscal') {
    return conta;
  }
  return 'extrato';
}

function storageKey(companyName: string): string {
  return `contabilfacil_${companyStorageSlug(companyName)}_extrato_ocr_layouts_v1`;
}

function readStore(companyName: string): ExtratoOcrLayoutStore {
  const parsed = readPersistedLocalStorageJson<Partial<ExtratoOcrLayoutStore>>(
    storageKey(companyName),
    { layouts: [], activeLayoutId: null },
  );
  return {
    layouts: Array.isArray(parsed.layouts) ? parsed.layouts : [],
    activeLayoutId: parsed.activeLayoutId ?? null,
    activeByKind:
      parsed.activeByKind && typeof parsed.activeByKind === 'object'
        ? (parsed.activeByKind as Record<string, string>)
        : undefined,
  };
}

function writeStore(companyName: string, store: ExtratoOcrLayoutStore): void {
  writePersistedLocalStorageJson(storageKey(companyName), store);
}

export function listExtratoOcrLayouts(companyName: string, kind?: string): ExtratoOcrLayoutSaved[] {
  const sorted = readStore(companyName).layouts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!kind) return sorted;
  return sorted.filter((l) => layoutKindOf(l) === kind);
}

export function getActiveExtratoOcrLayout(
  companyName: string,
  kind = 'extrato',
): ExtratoOcrLayoutSaved | null {
  const store = readStore(companyName);
  const id = store.activeByKind?.[kind] ?? (kind === 'extrato' ? store.activeLayoutId : null);
  if (!id) return null;
  const hit = store.layouts.find((l) => l.id === id) ?? null;
  if (!hit) return null;
  if (layoutKindOf(hit) !== kind) return null;
  return hit;
}

export function getExtratoBancoConta(companyName: string): string {
  return getActiveExtratoOcrLayout(companyName, 'extrato')?.contaBanco?.trim() ?? '';
}

export function getExtratoBancoNome(companyName: string): string {
  return getActiveExtratoOcrLayout(companyName, 'extrato')?.bancoNome?.trim() ?? '';
}

/**
 * Define a conta contábil do banco usada na conciliação (lado banco D/C).
 * Atualiza o layout ativo ou cria um layout mínimo se ainda não existir.
 */
export function setExtratoContaBancoAtiva(
  companyName: string,
  contaBanco: string,
  bancoNome?: string,
): ExtratoOcrLayoutSaved {
  const code = contaBanco.trim();
  const active = getActiveExtratoOcrLayout(companyName, 'extrato');
  const nome =
    (bancoNome ?? '').trim() ||
    active?.bancoNome?.trim() ||
    `Banco ${code}`;
  const saved = saveExtratoBancoParaImportacao(companyName, nome, code);
    // Keep the selected bank for rules in sync
    saveExtratoRegrasBancoSelecionado(companyName, code);
    return saved;
}

export function saveExtratoOcrLayout(
  companyName: string,
  layout: Omit<ExtratoOcrLayoutSaved, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
): ExtratoOcrLayoutSaved {
  const store = readStore(companyName);
  const now = new Date().toISOString();
  const existingIdx = layout.id ? store.layouts.findIndex((l) => l.id === layout.id) : -1;
  const saved: ExtratoOcrLayoutSaved = {
    id: layout.id ?? generateUUID(),
    bancoNome: layout.bancoNome.trim(),
    contaBanco: layout.contaBanco.trim(),
    kind: layout.kind?.trim() || layoutKindOf(layout),
    ignoreLineWords: layout.ignoreLineWords,
    cleanupWords: layout.cleanupWords,
    semDelimitacaoVertical: layout.semDelimitacaoVertical,
    columns: layout.columns,
    columnsNorm: layout.columnsNorm,
    faixaStart: layout.faixaStart,
    faixaEnd: layout.faixaEnd,
    faixaStartNorm: layout.faixaStartNorm,
    faixaEndNorm: layout.faixaEndNorm,
    faixaInicioMarcado: layout.faixaInicioMarcado,
    faixaFimMarcado: layout.faixaFimMarcado,
    faixaPorPagina: layout.faixaPorPagina,
    faixaInicioPagina: layout.faixaInicioPagina,
    faixaFimPagina: layout.faixaFimPagina,
    imgWidth: layout.imgWidth,
    imgHeight: layout.imgHeight,
    createdAt: existingIdx >= 0 ? store.layouts[existingIdx]!.createdAt : now,
    updatedAt: now,
    valorSignHeuristic: layout.valorSignHeuristic,
  };
  if (existingIdx >= 0) {
    store.layouts[existingIdx] = saved;
  } else {
    store.layouts.unshift(saved);
  }
  // IMPORTANTE: salvar/editar um layout NÃO marca ele como "ativo" automaticamente.
  // Este container (Nome do Banco/Conta Contábil) serve só para configurar e
  // guardar as regras daquele banco — quem decide qual banco fica ativo na
  // conciliação é exclusivamente a confirmação da importação (ver
  // saveExtratoBancoParaImportacao / setActiveExtratoOcrLayout), nunca o
  // simples ato de salvar/atualizar a configuração aqui.
  writeStore(companyName, store);
  return saved;
}

export function setActiveExtratoOcrLayout(
  companyName: string,
  layoutId: string,
  kind?: string,
): void {
  const store = readStore(companyName);
  const layout = store.layouts.find((l) => l.id === layoutId);
  if (!layout) return;
  const resolvedKind = kind?.trim() || layoutKindOf(layout);
  store.activeByKind = { ...(store.activeByKind ?? {}), [resolvedKind]: layoutId };
  if (resolvedKind === 'extrato') store.activeLayoutId = layoutId;
  writeStore(companyName, store);
}

export function deleteExtratoOcrLayout(companyName: string, layoutId: string): void {
  const store = readStore(companyName);
  store.layouts = store.layouts.filter((l) => l.id !== layoutId);
  if (store.activeLayoutId === layoutId) {
    store.activeLayoutId = store.layouts[0]?.id ?? null;
  }
  if (store.activeByKind?.['extrato'] === layoutId) {
    const nextActiveByKind = { ...store.activeByKind };
    delete nextActiveByKind['extrato'];
    store.activeByKind = Object.keys(nextActiveByKind).length > 0 ? nextActiveByKind : undefined;
  }
  writeStore(companyName, store);
}

export function clearActiveExtratoOcrLayout(companyName: string, kind = 'extrato'): void {
  const store = readStore(companyName);
  if (kind === 'extrato') {
    store.activeLayoutId = null;
  }
  if (store.activeByKind?.[kind]) {
    const nextActiveByKind = { ...store.activeByKind };
    delete nextActiveByKind[kind];
    store.activeByKind = Object.keys(nextActiveByKind).length > 0 ? nextActiveByKind : undefined;
  }
  writeStore(companyName, store);
}

/**
 * Grava/atualiza banco + conta contábil usada na conciliação.
 * Preferência: atualizar o layout ativo (preserva colunas/faixas),
 * em vez de criar um layout novo e “perder” a configuração.
 */
export function saveExtratoBancoParaImportacao(
  companyName: string,
  bancoNome: string,
  contaBanco: string,
): ExtratoOcrLayoutSaved {
  const normBanco = bancoNome.trim();
  const normConta = contaBanco.trim();
  const store = readStore(companyName);
  const byPair = store.layouts.find(
    (l) => l.bancoNome === normBanco && l.contaBanco === normConta,
  );
  const active = getActiveExtratoOcrLayout(companyName, 'extrato');
  // IMPORTANTE: só reaproveita o ID de um layout existente da MESMA conta banco.
  // Nunca reaproveita o ID do layout ativo de OUTRA conta — isso sobrescreveria
  // (corromperia) o registro de uma conta diferente, "confundindo" os bancos.
  const base = byPair ?? null;
  // Config (colunas/faixas) por padrão vem do layout desta conta; se for a
  // primeira vez importando esta conta, herda como PONTO DE PARTIDA as
  // configurações do layout ativo (sem tocar no registro dele).
  const configDefaults = base ?? active ?? null;
  const saved = saveExtratoOcrLayout(companyName, {
    id: base?.id,
    kind: 'extrato',
    bancoNome: normBanco,
    contaBanco: normConta,
    ignoreLineWords: configDefaults?.ignoreLineWords ?? '',
    cleanupWords: configDefaults?.cleanupWords ?? '',
    semDelimitacaoVertical: configDefaults?.semDelimitacaoVertical ?? true,
    columns: configDefaults?.columns ?? [],
    columnsNorm: configDefaults?.columnsNorm,
    faixaStart: configDefaults?.faixaStart ?? 0,
    faixaEnd: configDefaults?.faixaEnd ?? 1,
    faixaStartNorm: configDefaults?.faixaStartNorm,
    faixaEndNorm: configDefaults?.faixaEndNorm,
    faixaInicioMarcado: configDefaults?.faixaInicioMarcado ?? false,
    faixaFimMarcado: configDefaults?.faixaFimMarcado ?? false,
    faixaPorPagina: configDefaults?.faixaPorPagina,
    faixaInicioPagina: configDefaults?.faixaInicioPagina,
    faixaFimPagina: configDefaults?.faixaFimPagina,
    imgWidth: configDefaults?.imgWidth ?? 1,
    imgHeight: configDefaults?.imgHeight ?? 1,
    valorSignHeuristic: configDefaults?.valorSignHeuristic,
  });
  // Esta função só é chamada no momento em que o usuário CONFIRMA a
  // importação (handleOkConciliacao) — é o único ponto correto para trocar
  // o banco ativo da conciliação.
  setActiveExtratoOcrLayout(companyName, saved.id);
    // Persist the selected bank for rule storage as well
    saveExtratoRegrasBancoSelecionado(companyName, normConta);
  return saved;
}
