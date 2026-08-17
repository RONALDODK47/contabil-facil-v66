import { dedupePricingWorkspaceStock } from './pricingCalculator';
import type {
  NfeCreditoSugerido,
  NfeItemEstoque,
  NfeNotaResumo,
  MeasureUnit,
  PricingNfeCache,
  PricingWorkspace,
  RecoverableCredit,
  StockItem,
} from './pricingTypes';
import { createEmptyStockItem, normalizeStockItem } from './pricingTypes';

function mapNfeUnitToMeasure(u: string): MeasureUnit {
  const t = u.trim().toLowerCase();
  if (t === 'kg') return 'kg';
  if (t === 'g' || t === 'gr') return 'g';
  if (t === 'l' || t === 'lt') return 'l';
  if (t === 'ml') return 'ml';
  if (t === 'm') return 'm';
  if (t === 'cm') return 'cm';
  return 'un';
}

function stockItemFromNfeItem(
  companyName: string,
  item: {
    descricao: string;
    codigo: string;
    quantidade: number;
    valorUnitario: number;
    unidade: string;
    categoria: 'insumo' | 'materia_prima';
  },
  scopeProductId?: string,
): StockItem {
  const stock = createEmptyStockItem(companyName, item.categoria, scopeProductId);
  stock.name = item.descricao.trim();
  stock.sku = item.codigo.trim();
  stock.unitsPurchased = item.quantidade > 0 ? item.quantidade : 1;
  stock.measureQuantity = 1;
  stock.packageUnit = mapNfeUnitToMeasure(item.unidade);
  stock.unitPrice = item.valorUnitario > 0 ? item.valorUnitario : 0;
  stock.catalogUnitPrice = stock.unitPrice;
  stock.catalogPriceInputMode = 'unit';
  stock.priceInputMode = 'unit';
  return normalizeStockItem(stock);
}

export function buildNfeCacheFromApi(payload: {
  notas?: NfeNotaResumo[];
  itensEstoque?: NfeItemEstoque[];
  creditosSugeridos?: NfeCreditoSugerido[];
  ultNSU?: string;
  maxNSU?: string;
  manifestados?: number;
  cnpjSync?: string;
  ufSync?: string;
  ambienteSync?: 'producao' | 'homologacao';
  dataInicioSync?: string;
  dataFimSync?: string;
  manifestarCienciaSync?: boolean;
}): PricingNfeCache {
  return {
    notas: payload.notas ?? [],
    itensEstoque: payload.itensEstoque ?? [],
    creditosSugeridos: payload.creditosSugeridos ?? [],
    lastSyncAt: new Date().toISOString(),
    creditosAplicados: false,
    ultNSU: payload.ultNSU,
    maxNSU: payload.maxNSU,
    manifestados: payload.manifestados,
    cnpjSync: payload.cnpjSync,
    ufSync: payload.ufSync,
    ambienteSync: payload.ambienteSync,
    dataInicioSync: payload.dataInicioSync,
    dataFimSync: payload.dataFimSync,
    manifestarCienciaSync: payload.manifestarCienciaSync,
  };
}

/** Mescla cache anterior com nova importação (SEFAZ ou XML), deduplicando por chave. */
export function mergeNfeCache(
  prev: PricingNfeCache | undefined,
  incoming: PricingNfeCache,
): PricingNfeCache {
  const notaMap = new Map<string, NfeNotaResumo>();
  for (const n of prev?.notas ?? []) notaMap.set(n.chave, n);
  for (const n of incoming.notas) notaMap.set(n.chave, n);

  const itemKeys = new Set(
    (prev?.itensEstoque ?? []).map((i) => `${i.chave}|${i.codigo}|${i.descricao}`),
  );
  const itensEstoque = [...(prev?.itensEstoque ?? [])];
  for (const i of incoming.itensEstoque) {
    const k = `${i.chave}|${i.codigo}|${i.descricao}`;
    if (itemKeys.has(k)) continue;
    itemKeys.add(k);
    itensEstoque.push(i);
  }

  const creditoKeys = new Set(
    (prev?.creditosSugeridos ?? []).map((c) => `${c.chave}|${c.tipo}|${c.valor}`),
  );
  const creditosSugeridos = [...(prev?.creditosSugeridos ?? [])];
  for (const c of incoming.creditosSugeridos) {
    const k = `${c.chave}|${c.tipo}|${c.valor}`;
    if (creditoKeys.has(k)) continue;
    creditoKeys.add(k);
    creditosSugeridos.push(c);
  }

  return {
    notas: [...notaMap.values()],
    itensEstoque,
    creditosSugeridos,
    lastSyncAt: incoming.lastSyncAt,
    creditosAplicados: prev?.creditosAplicados ?? false,
    ultNSU: incoming.ultNSU ?? prev?.ultNSU,
    maxNSU: incoming.maxNSU ?? prev?.maxNSU,
    cnpjSync: incoming.cnpjSync ?? prev?.cnpjSync,
    ufSync: incoming.ufSync ?? prev?.ufSync,
    manifestados: incoming.manifestados ?? prev?.manifestados,
    ambienteSync: incoming.ambienteSync ?? prev?.ambienteSync,
    dataInicioSync: incoming.dataInicioSync ?? prev?.dataInicioSync,
    dataFimSync: incoming.dataFimSync ?? prev?.dataFimSync,
    manifestarCienciaSync: incoming.manifestarCienciaSync ?? prev?.manifestarCienciaSync,
    certificadoA1Base64: incoming.certificadoA1Base64 ?? prev?.certificadoA1Base64,
    certificadoA1Nome: incoming.certificadoA1Nome ?? prev?.certificadoA1Nome,
    senhaCertificadoSalva: incoming.senhaCertificadoSalva ?? prev?.senhaCertificadoSalva,
    // Uma sincronização bem-sucedida (chegou até aqui) supera qualquer bloqueio anterior.
    sefazBloqueioAte: undefined,
  };
}

function creditKey(c: Pick<RecoverableCredit, 'name' | 'creditKind' | 'monthlyAmount'>): string {
  return `${c.creditKind}|${c.name}|${c.monthlyAmount.toFixed(2)}`;
}

export function applyNfeCreditsToWorkspace(
  workspace: PricingWorkspace,
  opts: { importStockItems?: boolean } = {},
): {
  workspace: PricingWorkspace;
  creditsAdded: number;
  stockAdded: number;
  message: string;
} {
  const cache = workspace.nfeCache;
  if (!cache?.creditosSugeridos?.length && !cache?.itensEstoque?.length) {
    return {
      workspace,
      creditsAdded: 0,
      stockAdded: 0,
      message: 'Nenhuma NFe sincronizada — configure certificado A1 e sincronize com a SEFAZ.',
    };
  }

  const existingKeys = new Set(workspace.credits.map(creditKey));
  const newCredits: RecoverableCredit[] = [];

  for (const sug of cache.creditosSugeridos ?? []) {
    if (sug.valor <= 0) continue;
    const item: RecoverableCredit = {
      id: crypto.randomUUID(),
      companyName: workspace.companyName,
      name: `NFe ${sug.chave.slice(-8)} · ${sug.tipo}`,
      creditKind: sug.tipo,
      monthlyAmount: sug.valor,
      applicableSegments: ['produto_acabado', 'mercadoria'],
      taxRegime: sug.regime || 'Lucro Real',
      notes: sug.fundamento,
      createdAt: new Date().toISOString(),
    };
    const key = creditKey(item);
    if (!existingKeys.has(key)) {
      existingKeys.add(key);
      newCredits.push(item);
    }
  }

  let stockItems = [...workspace.stockItems];
  let stockAdded = 0;

  if (opts.importStockItems && cache.itensEstoque?.length) {
    for (const nfeItem of cache.itensEstoque) {
      const dup = stockItems.find(
        (s) =>
          s.sku === nfeItem.codigo &&
          s.name.trim().toLowerCase() === nfeItem.descricao.trim().toLowerCase(),
      );
      if (dup) continue;
      const created = stockItemFromNfeItem(workspace.companyName, nfeItem);
      stockItems.push(normalizeStockItem(created));
      stockAdded += 1;
    }
    stockItems = dedupePricingWorkspaceStock({ ...workspace, stockItems }).workspace.stockItems;
  }

  const next: PricingWorkspace = {
    ...workspace,
    stockItems,
    credits: [...workspace.credits, ...newCredits],
    nfeCache: { ...cache, creditosAplicados: true },
  };

  return {
    workspace: next,
    creditsAdded: newCredits.length,
    stockAdded,
    message:
      newCredits.length || stockAdded
        ? `${newCredits.length} crédito(s) e ${stockAdded} item(ns) de estoque importados da SEFAZ.`
        : 'Créditos NFe já estavam lançados.',
  };
}
