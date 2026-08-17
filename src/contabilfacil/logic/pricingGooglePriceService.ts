import type { MeasureUnit, PricingWorkspace, StockItem } from './pricingTypes';
import {
  createEmptyStockItem,
  isStockProductScopedCategory,
  normalizeStockItem,
} from './pricingTypes';

export interface GooglePriceHit {
  id?: string;
  nome: string;
  precoUnitario: number;
  fonte?: string;
  consulta?: string;
  amostras?: number;
}

export interface GooglePriceSearchResult {
  ok: boolean;
  offline?: boolean;
  produtoAcabado?: string;
  precos: GooglePriceHit[];
  insumosDescobertos: Array<{
    nome: string;
    unidade?: string;
    precoUnitario: number;
    fonte?: string;
  }>;
  avisos: string[];
  motor?: string;
}

function mapUnidade(raw?: string): MeasureUnit {
  const u = String(raw ?? 'un').trim().toLowerCase();
  if (u === 'kg') return 'kg';
  if (u === 'g' || u === 'gr') return 'g';
  if (u === 'l' || u === 'lt') return 'l';
  if (u === 'ml') return 'ml';
  if (u === 'm') return 'm';
  if (u === 'cm') return 'cm';
  return 'un';
}

function resolveProductName(
  workspace: PricingWorkspace,
  scopeProductId?: string,
  baseProductName?: string,
): string {
  if (scopeProductId && scopeProductId !== '__shared__' && scopeProductId !== '__all__') {
    const pa = workspace.stockItems.find(
      (s) => s.id === scopeProductId && s.category === 'produto_acabado',
    );
    if (pa?.name?.trim()) {
      return pa.name.trim();
    }
  }
  return (baseProductName ?? 'Produto').trim() || 'Produto';
}

function itemsToSearch(materials: StockItem[]): Array<{ id: string; nome: string; unidade: string }> {
  return materials.map((m) => ({
    id: m.id,
    nome: m.name.trim(),
    unidade: m.packageUnit || 'un',
  }));
}

async function callPricingSearchApi(payload: {
  produtoAcabado: string;
  itens: Array<{ id?: string; nome: string; unidade?: string }>;
  descobrirInsumos: boolean;
}): Promise<GooglePriceSearchResult> {
  const res = await fetch('/api/agent/pricing/search-prices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as GooglePriceSearchResult;
  if (!res.ok && !data.avisos?.length) {
    return {
      ok: false,
      offline: res.status === 503,
      precos: [],
      insumosDescobertos: [],
      avisos: [`Consulta de preços falhou (HTTP ${res.status}).`],
    };
  }
  return {
    ok: Boolean(data.ok),
    offline: data.offline,
    produtoAcabado: data.produtoAcabado,
    precos: data.precos ?? [],
    insumosDescobertos: data.insumosDescobertos ?? [],
    avisos: data.avisos ?? [],
    motor: data.motor,
  };
}

/** Consulta Google (Python) e atualiza preços no estoque; descobre insumos se lista vazia. */
export async function enrichMaterialsWithGooglePrices(
  workspace: PricingWorkspace,
  params: {
    companyName: string;
    scopeProductId?: string;
    baseProductName?: string;
    materials: StockItem[];
    onProgress?: (label: string) => void;
  },
): Promise<{
  workspace: PricingWorkspace;
  materials: StockItem[];
  summaryLines: string[];
  avisos: string[];
}> {
  const { companyName, scopeProductId, baseProductName, onProgress } = params;
  let materials = [...params.materials];
  const produto = resolveProductName(workspace, scopeProductId, baseProductName);
  const summaryLines: string[] = [];
  const avisos: string[] = [];

  onProgress?.(`Pesquisando preços — ${produto}…`);

  const semPreco = materials.filter(
    (m) => (m.unitPrice <= 0 && (m.catalogUnitPrice ?? 0) <= 0) || !m.name.trim(),
  );
  const alvoBusca = semPreco.length > 0 ? semPreco : materials;

  const search = await callPricingSearchApi({
    produtoAcabado: produto,
    itens: itemsToSearch(alvoBusca),
    descobrirInsumos: materials.length === 0,
  });

  if (search.offline) {
    avisos.push('Motor Python offline — suba npm run dev para pesquisar preços.');
    return { workspace, materials, summaryLines, avisos };
  }

  avisos.push(...search.avisos);

  let stockItems = [...workspace.stockItems];
  let priced = 0;

  for (const hit of search.precos) {
    if (!hit.precoUnitario || hit.precoUnitario <= 0) continue;
    const idx = stockItems.findIndex((s) => s.id === hit.id);
    if (idx < 0) continue;
    stockItems[idx] = normalizeStockItem({
      ...stockItems[idx],
      unitPrice: hit.precoUnitario,
      catalogUnitPrice: hit.precoUnitario,
      priceInputMode: 'unit',
      catalogPriceInputMode: 'unit',
    });
    priced++;
    summaryLines.push(`${hit.nome}: R$ ${hit.precoUnitario.toFixed(2)} (${hit.fonte ?? 'web'})`);
  }

  if (materials.length === 0 && search.insumosDescobertos.length > 0) {
    onProgress?.(`Cadastrando ${search.insumosDescobertos.length} insumo(s)…`);
    const scopeId =
      scopeProductId && scopeProductId !== '__shared__' && scopeProductId !== '__all__'
        ? scopeProductId
        : undefined;
    for (const row of search.insumosDescobertos) {
      if (!row.nome?.trim()) continue;
      const item = createEmptyStockItem(companyName, 'insumo', scopeId);
      item.name = row.nome.trim();
      item.packageUnit = mapUnidade(row.unidade);
      item.unitsPurchased = 1;
      item.measureQuantity = 1;
      if (row.precoUnitario > 0) {
        item.unitPrice = row.precoUnitario;
        item.catalogUnitPrice = row.precoUnitario;
        priced++;
        summaryLines.push(`${row.nome}: R$ ${row.precoUnitario.toFixed(2)} (${row.fonte ?? 'web'})`);
      }
      stockItems.push(normalizeStockItem(item));
    }
    materials = stockItems.filter(
      (s) =>
        isStockProductScopedCategory(s.category) &&
        (!scopeId || !s.stockScopeProductId || s.stockScopeProductId === scopeId),
    );
  } else {
    materials = stockItems.filter((s) => materials.some((m) => m.id === s.id));
  }

  if (priced > 0) {
    summaryLines.unshift(
      `${priced} preço(s) via ${search.motor === 'google' ? 'Google' : 'web'} · ${produto}`,
    );
  } else if (!search.ok) {
    avisos.push(`Nenhum preço encontrado para «${produto}». Configure GOOGLE_API_KEY + GOOGLE_CSE_ID no .env.`);
  }

  return {
    workspace: { ...workspace, stockItems },
    materials,
    summaryLines,
    avisos,
  };
}
