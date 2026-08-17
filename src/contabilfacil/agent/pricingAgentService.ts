import {
  applyStockMaterialShortfallsToItems,
  applyStockReplenishOnlyThisItem,
  collectWorkspaceMaterialShortages,
  computePricingBreakdowns,
  dedupePricingWorkspaceStock,
} from '../logic/pricingCalculator';
import { applyNfeCreditsToWorkspace } from '../logic/pricingNfeCredits';
import { loadPricingWorkspace, savePricingWorkspace } from '../logic/pricingStorage';
import type { PricingWorkspace, StockCategory, StockItem } from '../logic/pricingTypes';
import {
  createEmptyStockItem,
  isStockProductScopedCategory,
  normalizeStockItem,
  stockItemMatchesProductScope,
  stockOnHandMeasure,
} from '../logic/pricingTypes';

function persistWorkspace(company: string, workspace: PricingWorkspace): PricingWorkspace {
  const next = { ...workspace, companyName: company };
  savePricingWorkspace(next);
  return next;
}

function loadDeduped(company: string): PricingWorkspace {
  const loaded = loadPricingWorkspace(company);
  return dedupePricingWorkspaceStock(loaded).workspace;
}

function findProductByName(items: StockItem[], name: string): StockItem | undefined {
  const n = name.trim().toLowerCase();
  if (!n) return undefined;
  return items.find(
    (s) => s.category === 'produto_acabado' && s.name.trim().toLowerCase().includes(n),
  );
}

function findStockItem(
  items: StockItem[],
  opts: { id?: string; nome?: string; categoria?: StockCategory },
): StockItem | undefined {
  if (opts.id) return items.find((s) => s.id === opts.id);
  const nome = opts.nome?.trim().toLowerCase();
  if (!nome) return undefined;
  return items.find(
    (s) =>
      (!opts.categoria || s.category === opts.categoria) &&
      s.name.trim().toLowerCase().includes(nome),
  );
}

export function agentListFinishedProducts(company: string) {
  const ws = loadDeduped(company);
  const produtos = ws.stockItems
    .filter((s) => s.category === 'produto_acabado')
    .map((s) => ({
      id: s.id,
      nome: s.name,
      sku: s.sku,
      useBom: s.useBom,
      monthlyQty: s.monthlyQty,
      materialCost: s.useBom ? undefined : s.directCost,
    }));
  return { total: produtos.length, produtos };
}

export function agentListStock(
  company: string,
  opts: {
    categoria?: StockCategory;
    produtoAcabadoNome?: string;
    produtoAcabadoId?: string;
  } = {},
) {
  const ws = loadDeduped(company);
  let scopeId = opts.produtoAcabadoId;
  if (!scopeId && opts.produtoAcabadoNome) {
    scopeId = findProductByName(ws.stockItems, opts.produtoAcabadoNome)?.id;
  }
  const scopeKey = scopeId ?? (opts.produtoAcabadoNome ? '__missing__' : '');

  const items = ws.stockItems.filter((s) => {
    if (opts.categoria && s.category !== opts.categoria) return false;
    if (scopeId && isStockProductScopedCategory(s.category)) {
      return stockItemMatchesProductScope({ ...s, stockScopeProductId: s.stockScopeProductId }, scopeId);
    }
    return true;
  });

  return {
    total: items.length,
    escopoProduto: scopeId ?? null,
    itens: items.map((s) => ({
      id: s.id,
      nome: s.name,
      categoria: s.category,
      sku: s.sku,
      estoqueFisico: stockOnHandMeasure(s),
      unitPrice: s.unitPrice,
      produtoAcabadoId: s.stockScopeProductId,
    })),
    aviso:
      scopeKey === '__missing__' && opts.produtoAcabadoNome
        ? `Produto acabado não encontrado: ${opts.produtoAcabadoNome}`
        : undefined,
  };
}

export function agentPricingSummary(company: string) {
  const ws = loadDeduped(company);
  const breakdowns = computePricingBreakdowns(ws);
  const top = breakdowns
    .filter((b) => b.totalUnitCost > 0)
    .slice(0, 12)
    .map((b) => ({
      nome: b.name,
      segmento: b.category,
      custoUnit: b.totalUnitCost,
      precoVenda: b.pricedUnitPrice,
      margemPct: b.marginPercent,
      markupPct: b.markupPercent,
    }));
  const shortages = collectWorkspaceMaterialShortages(ws.stockItems);
  return {
    sindicato: company,
    itensPrecificados: breakdowns.length,
    faltantesEstoque: shortages.length,
    ranking: top,
    settings: {
      markup: ws.settings.markupPercent,
      margin: ws.settings.marginPercent,
      mode: ws.settings.mode,
    },
  };
}

export function agentUpsertStock(
  company: string,
  params: {
    id?: string;
    nome: string;
    categoria: StockCategory;
    produtoAcabadoNome?: string;
    sku?: string;
    unitPrice?: number;
    unitsPurchased?: number;
    measureQuantity?: number;
    directCost?: number;
    monthlyQty?: number;
  },
) {
  const ws = loadDeduped(company);
  let scopeId: string | undefined;
  if (params.produtoAcabadoNome) {
    scopeId = findProductByName(ws.stockItems, params.produtoAcabadoNome)?.id;
    if (!scopeId && isStockProductScopedCategory(params.categoria)) {
      return { ok: false, message: `PA não encontrado: ${params.produtoAcabadoNome}` };
    }
  }

  let item =
    findStockItem(ws.stockItems, {
      id: params.id,
      nome: params.nome,
      categoria: params.categoria,
    }) ?? null;

  if (!item) {
    item = createEmptyStockItem(company, params.categoria, scopeId);
    item.name = params.nome.trim();
  }

  if (params.sku !== undefined) item.sku = params.sku;
  if (params.unitPrice !== undefined) item.unitPrice = params.unitPrice;
  if (params.unitsPurchased !== undefined) item.unitsPurchased = params.unitsPurchased;
  if (params.measureQuantity !== undefined) item.measureQuantity = params.measureQuantity;
  if (params.directCost !== undefined) item.directCost = params.directCost;
  if (params.monthlyQty !== undefined) item.monthlyQty = params.monthlyQty;
  if (scopeId && isStockProductScopedCategory(item.category)) item.stockScopeProductId = scopeId;

  const normalized = normalizeStockItem(item);
  const merged = ws.stockItems.some((s) => s.id === normalized.id)
    ? ws.stockItems.map((s) => (s.id === normalized.id ? normalized : s))
    : [...ws.stockItems, normalized];

  const { workspace: deduped } = dedupePricingWorkspaceStock({ ...ws, stockItems: merged });
  persistWorkspace(company, deduped);

  return {
    ok: true,
    message: `Estoque salvo: ${normalized.name} (${normalized.category})`,
    id: normalized.id,
  };
}

export function agentApplyNfeCredits(company: string) {
  const ws = loadDeduped(company);
  const cache = ws.nfeCache;
  if (!cache?.lastSyncAt) {
    return {
      ok: false,
      needsSync: true,
      creditsAdded: 0,
      stockAdded: 0,
      notasCount: 0,
      message: 'Nenhuma NF-e sincronizada da SEFAZ.',
    };
  }
  if (cache.creditosAplicados) {
    return {
      ok: true,
      needsSync: false,
      creditsAdded: 0,
      stockAdded: 0,
      notasCount: cache.notas.length,
      message: `NF-e já aplicada — ${cache.notas.length} nota(s) em cache.`,
    };
  }
  const applied = applyNfeCreditsToWorkspace(ws, { importStockItems: true });
  persistWorkspace(company, applied.workspace);
  return {
    ok: applied.creditsAdded > 0 || applied.stockAdded > 0,
    needsSync: false,
    creditsAdded: applied.creditsAdded,
    stockAdded: applied.stockAdded,
    notasCount: cache.notas.length,
    message: applied.message,
  };
}

export function agentReplenishStock(
  company: string,
  opts: { id?: string; nome?: string; reporTodos?: boolean },
) {
  const ws = loadDeduped(company);
  if (opts.reporTodos) {
    const shortages = collectWorkspaceMaterialShortages(ws.stockItems);
    if (shortages.length === 0) {
      return { ok: true, message: 'Nenhum faltante de estoque pela composição.' };
    }
    const next = applyStockMaterialShortfallsToItems(
      ws.stockItems,
      shortages.map((s) => ({ stockItemId: s.stockItemId, shortfallQty: s.shortfallQty })),
    );
    persistWorkspace(company, { ...ws, stockItems: next });
    return { ok: true, message: `Repostos ${shortages.length} itens faltantes.` };
  }

  const item = findStockItem(ws.stockItems, { id: opts.id, nome: opts.nome });
  if (!item) return { ok: false, message: 'Item de estoque não encontrado.' };

  const next = applyStockReplenishOnlyThisItem(ws.stockItems, item.id);
  if (next === ws.stockItems) {
    return { ok: true, message: `${item.name}: sem faltante ou já reposto.` };
  }
  persistWorkspace(company, { ...ws, stockItems: next });
  return { ok: true, message: `Estoque reposto: ${item.name}` };
}
