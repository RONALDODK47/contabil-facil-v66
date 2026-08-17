/** Itens de estoque (insumos, MP, PA, mercadoria). Serviços ficam em `serviceItems`. */
export type StockCategory =
  | 'insumo'
  | 'materia_prima'
  | 'produto_acabado'
  | 'mercadoria';

/** Segmentos precificados no dashboard e na aba de precificação. */
export type PricingSegment = 'produto_acabado' | 'mercadoria' | 'servico';

export type MeasureUnit = 'un' | 'kg' | 'g' | 'l' | 'ml' | 'm' | 'cm';

export type MeasureDimension = 'count' | 'mass' | 'volume' | 'length';

/** Unidades usadas na medida do estoque (insumo / matéria-prima) e na composição (BOM). */
export const STOCK_MEASURE_UNIT_OPTIONS: MeasureUnit[] = ['un', 'cm', 'm', 'l', 'ml', 'kg', 'g'];

export const BOM_LINE_UNIT_OPTIONS: MeasureUnit[] = ['un', 'cm', 'm', 'l', 'ml', 'kg', 'g'];

export const MEASURE_UNIT_LABELS: Record<MeasureUnit, string> = {
  un: 'un (unidade)',
  kg: 'kg',
  g: 'g',
  l: 'L (litros)',
  ml: 'ml',
  m: 'm (metros)',
  cm: 'cm (centímetros)',
};

export type PricingMode = 'markup_only' | 'margin_only' | 'both';

/** Qual regra definiu o preço final (útil no modo both). */
export type PriceDrivingFactor = 'markup' | 'margin' | 'markup_only' | 'margin_only' | 'both';

/** Critério para ratear custos/despesas fixos do segmento entre produtos. */
export type CostAllocationMode = 'por_volume' | 'por_custo_material' | 'por_unidades_mes';

/** Modos exibidos na aba Precificação (dois cenários principais). */
export const PRICING_ALLOCATION_MODE_OPTIONS: {
  value: CostAllocationMode;
  label: string;
  description: string;
}[] = [
  {
    value: 'por_unidades_mes',
    label: 'Por produtos acabados (PA)',
    description:
      'Rateia custos/despesas do segmento só entre os PA com qtd/mês informada (÷ soma das qtd do segmento). Ideal para precificar os produtos do cardápio (ex.: 7 itens).',
  },
  {
    value: 'por_volume',
    label: 'Normal (volume total)',
    description:
      'Rateio pelo volume (custo material × qtd/mês). Mostra a quantidade total esperada e o valor esperado do mês na tabela e no resumo abaixo.',
  },
];

export function isNormalPricingAllocationMode(
  mode: CostAllocationMode | undefined,
): boolean {
  return (mode ?? 'por_unidades_mes') !== 'por_unidades_mes';
}

export type CostExpenseType = 'custo' | 'despesa';

/** Classificação contábil do lançamento. */
export type CostExpenseKind = 'fixo' | 'variavel';

export const COST_EXPENSE_KIND_LABELS: Record<CostExpenseKind, string> = {
  fixo: 'Fixo',
  variavel: 'Variável',
};

export interface BomLine {
  stockItemId: string;
  quantity: number;
  unit: MeasureUnit;
}

export interface StockItem {
  id: string;
  companyName: string;
  category: StockCategory;
  name: string;
  sku: string;
  /** Preço por unidade/embalagem comprada (R$/un) — não usa medida L/ml/kg/g. */
  unitPrice: number;
  /** Valor total pago = unitPrice × unitsPurchased. */
  purchasePrice: number;
  /** Último modo usado no cadastro de valor (unitário ou total pago). */
  priceInputMode?: 'unit' | 'total';
  /** R$/un cadastrado pelo usuário — não alterar ao repor estoque. */
  catalogUnitPrice?: number;
  /** Total pago cadastrado (modo Total R$) — base para repor sem mudar a taxa. */
  catalogPurchasePrice?: number;
  catalogPriceInputMode?: 'unit' | 'total';
  /** Unidades compradas quando o preço foi cadastrado (referência antes de repor). */
  catalogUnitsAtPricing?: number;
  /** Medida por embalagem no cadastro de preço. */
  catalogMeasureAtPricing?: number;
  /** Medida total no cadastro de preço (antes de acrescentar). */
  catalogPackageSizeAtPricing?: number;
  /** Número de unidades/embalagens compradas. */
  unitsPurchased: number;
  /** Quantidade na medida por embalagem (ex.: 300 m de filme, 2 kg) — rateio na BOM; não altera preço pago. */
  measureQuantity: number;
  /** Medida total em estoque = unitsPurchased × measureQuantity (cache p/ rateio BOM). */
  packageSize: number;
  packageUnit: MeasureUnit;
  /** Custo direto quando não usa BOM (produto acabado manual, serviço, mercadoria). */
  directCost: number;
  useBom: boolean;
  bom: BomLine[];
  /** Qtd/mês na precificação (projeção de vendas; × vezes em dobro). */
  monthlyQty: number;
  /**
   * Rendimento: quantas unidades esta receita (composição) produz.
   * Ex.: insumos R$ 10,10 para 7 pudins → rendimento 7 → material/un. = 10,10 ÷ 7.
   */
  recipeYieldQty?: number;
  /** Receita ×1 (composição) — não é alterada por “vezes em dobro”. */
  recipeQuantityBaseBom?: BomLine[];
  /** Rendimento salvo com a receita ×1 (espelha recipeYieldQty). */
  recipeQuantityBaseProductionQty?: number;
  /** Vezes em dobro (0 = receita ×1; 1 = ×2) — usado na projeção da aba Precificação. */
  recipeQuantityDoubles?: number;
  notes: string;
  createdAt: string;
  /**
   * Insumo/MP vinculado a um produto acabado (PA): estoque físico separado por receita.
   * Ausente = legado/compartilhado entre PAs.
   */
  stockScopeProductId?: string;
  /** Percentual de frete sobre o valor de compra (ex.: 5 = +5%). */
  freightPercent?: number;
  /** Instituição licitante (produto acabado / mercadoria). */
  licitanteInstitution?: string;
  /** Créditos tributários a recuperar vinculados a este item. */
  recoverableCredits?: StockItemCredit[];
}

export interface StockItemCredit {
  id: string;
  name: string;
  creditKind: string;
  amount: number;
  taxRegime?: string;
  notes?: string;
}

export interface NfeNotaResumo {
  chave: string;
  numero: string;
  serie: string;
  emissao?: string;
  emitente: string;
  total: number;
  /** Classificação por CFOP dos itens — entrada/saída (compra/venda) ou serviço (CFOP x933). */
  tipo?: 'entrada' | 'saida' | 'servico';
  /** CFOP predominante da nota (primeiro item com CFOP). */
  cfop?: string;
}

export interface NfeItemEstoque {
  chave: string;
  codigo: string;
  descricao: string;
  quantidade: number;
  valorUnitario: number;
  unidade: string;
  categoria: 'insumo' | 'materia_prima';
  cfop?: string;
  ncm?: string;
}

export interface NfeCreditoSugerido {
  chave: string;
  tipo: string;
  valor: number;
  fundamento: string;
  regime: string;
  /** Detalhes do regime tributário — adicionado dinamicamente */
  regimeDetalhes?: TributaryRegimeDetails;
}

/**
 * Detalhes das regras tributárias por regime.
 * Define se o crédito é recuperável, alíquota zero, monofásico ou ICMS ST.
 */
export interface TributaryRegimeDetails {
  /** Regime: 'Simples Nacional', 'Lucro Presumido', 'Lucro Real' */
  regime: string;
  /** É recuperável o imposto neste regime? */
  isRecuperavel: boolean;
  /** Alíquota é zero? */
  isAliquotaZero: boolean;
  /** É operação monofásica? */
  isMonofasico: boolean;
  /** É ICMS ST (Substituição Tributária)? */
  isIcmsSt: boolean;
  /** Observações sobre as regras aplicadas */
  observacoes?: string;
}

export interface PricingNfeCache {
  notas: NfeNotaResumo[];
  itensEstoque: NfeItemEstoque[];
  creditosSugeridos: NfeCreditoSugerido[];
  lastSyncAt?: string;
  creditosAplicados?: boolean;
  /** Último NSU consultado na SEFAZ (Distribuição DF-e) — evita reprocessar notas. */
  ultNSU?: string;
  maxNSU?: string;
  cnpjSync?: string;
  ufSync?: string;
  manifestados?: number;
  /** Regime tributário selecionado na empresa */
  selectedRegime?: 'Simples Nacional' | 'Lucro Presumido' | 'Lucro Real';
  /** Ambiente usado na última sincronização SEFAZ (produção/homologação). */
  ambienteSync?: 'producao' | 'homologacao';
  /** Período consultado na última sincronização/importação (yyyy-mm-dd). */
  dataInicioSync?: string;
  dataFimSync?: string;
  /** Se "manifestar ciência automaticamente" estava marcado na última sincronização. */
  manifestarCienciaSync?: boolean;
  /** Certificado A1 (.pfx/.p12) salvo para não pedir de novo a cada sessão — conteúdo em base64. */
  certificadoA1Base64?: string;
  certificadoA1Nome?: string;
  /** Senha do certificado — salva junto por conveniência (mesmo storage por empresa). */
  senhaCertificadoSalva?: string;
  /** ISO — até quando a SEFAZ já sinalizou bloqueio (cStat 656) nesta consulta. */
  sefazBloqueioAte?: string;
}

/** Categorias de estoque que podem ser vinculadas a um PA. */
export function isStockProductScopedCategory(category: StockCategory): boolean {
  return category === 'insumo' || category === 'materia_prima';
}

/** Filtro «todos os insumos/MP» na aba Estoque. */
export const STOCK_PRODUCT_SCOPE_ALL = '__all__';
/** Itens insumo/MP sem vínculo a produto acabado. */
export const STOCK_PRODUCT_SCOPE_UNLINKED = '__shared__';

/** Filtra insumo/MP pelo PA selecionado na aba Estoque. */
export function stockItemMatchesProductScope(
  item: StockItem,
  productScopeId: string,
): boolean {
  if (!isStockProductScopedCategory(item.category)) return true;
  if (!productScopeId || productScopeId === STOCK_PRODUCT_SCOPE_ALL) return true;
  if (productScopeId === STOCK_PRODUCT_SCOPE_UNLINKED) return !item.stockScopeProductId;
  return item.stockScopeProductId === productScopeId;
}

export interface ServiceItem {
  id: string;
  companyName: string;
  name: string;
  sku: string;
  /** Custo direto de prestação do serviço. */
  directCost: number;
  monthlyQty: number;
  notes: string;
  createdAt: string;
}

export interface CostExpenseItem {
  id: string;
  companyName: string;
  type: CostExpenseType;
  /** Segmento ao qual o custo/despesa se aplica (rateio só dentro do segmento). */
  segment: PricingSegment;
  name: string;
  category: string;
  monthlyAmount: number;
  /** Fixo ou variável — padrão fixo para lançamentos legados. */
  kind?: CostExpenseKind;
  notes: string;
  createdAt: string;
}

export interface RecoverableCredit {
  id: string;
  companyName: string;
  name: string;
  creditKind: string;
  monthlyAmount: number;
  applicableSegments: PricingSegment[];
  taxRegime: string;
  notes: string;
  createdAt: string;
}

export interface GlobalPricingSettings {
  markupPercent: number;
  marginPercent: number;
  mode: PricingMode;
  /** Como dividir custos/despesas do segmento entre os produtos. */
  costAllocationMode: CostAllocationMode;
}

export function normalizePricingPercent(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export function normalizePricingMode(value: unknown): PricingMode {
  if (value === 'markup_only' || value === 'margin_only' || value === 'both') return value;
  return 'both';
}

export function normalizeGlobalPricingSettings(
  raw: Partial<GlobalPricingSettings> | undefined,
  fallback: GlobalPricingSettings,
): GlobalPricingSettings {
  return {
    ...fallback,
    ...raw,
    markupPercent: normalizePricingPercent(raw?.markupPercent ?? fallback.markupPercent),
    marginPercent: normalizePricingPercent(raw?.marginPercent ?? fallback.marginPercent),
    mode: normalizePricingMode(raw?.mode ?? fallback.mode),
    costAllocationMode: raw?.costAllocationMode ?? fallback.costAllocationMode,
  };
}

export interface ProductPricingOverride {
  markupPercent?: number;
  marginPercent?: number;
  mode?: PricingMode;
  monthlyQty?: number;
}

/** Estado salvo de insumo/MP antes de «Acrescentar ao estoque». */
export type StockItemPreReplenishSnapshot = {
  unitPrice: number;
  purchasePrice: number;
  priceInputMode?: 'unit' | 'total';
  unitsPurchased: number;
  measureQuantity: number;
  packageSize: number;
  savedAt: string;
};

export interface PricingWorkspace {
  companyName: string;
  stockItems: StockItem[];
  serviceItems: ServiceItem[];
  costExpenses: CostExpenseItem[];
  credits: RecoverableCredit[];
  settings: GlobalPricingSettings;
  productOverrides: Record<string, ProductPricingOverride>;
  /** Cópia de preço/qtd de insumo/MP antes do «acrescentar» (para restaurar). */
  stockBeforeReplenish?: Record<string, StockItemPreReplenishSnapshot>;
  /** Última sincronização NFe SEFAZ (créditos e itens pendentes). */
  nfeCache?: PricingNfeCache;
  /** Cadastro de empresas/instituições licitantes. */
  licitanteInstitutions?: string[];
  updatedAt: string;
}

export interface PricingBreakdown {
  productId: string;
  name: string;
  category: PricingSegment;
  materialCost: number;
  bomDetail: { name: string; qty: string; cost: number }[];
  allocatedCosts: number;
  allocatedExpenses: number;
  /** Fatia do pool do segmento (0–1), em decimal — não em %. */
  allocationShare: number;
  /** Valor mensal de custos do segmento efetivamente rateado a este produto. */
  monthlyCostsUsed: number;
  /** Valor mensal de despesas do segmento efetivamente rateado a este produto. */
  monthlyExpensesUsed: number;
  creditsRecovery: number;
  /** Material − crédito (referência; coluna Custo total usa totalUnitCost). */
  unitCostExclExpenses: number;
  /** Custos gerais/un.: custos fixos + despesas rateados − crédito (sem material). */
  displayUnitCosts: number;
  /** Despesa mensal total rateada ao produto (referência interna / relatório). */
  displayMonthlyExpensesTotal: number;
  /** Custo completo para precificação (inclui despesas rateadas). */
  totalUnitCost: number;
  markupPercent: number;
  marginPercent: number;
  mode: PricingMode;
  /** Regra que prevaleceu no preço (modo both: markup ou margem, a que gerou o maior valor). */
  priceDrivingFactor: PriceDrivingFactor;
  priceByMarkup: number;
  priceByMargin: number;
  /** Preço de venda por unidade (= valor total precificado ÷ qtd/mês). */
  finalPrice: number;
  /** Valor total precificado (markup/margem sobre custo unitário completo). */
  pricedMonthlyTotal: number;
  /** Valor total precificado ÷ qtd/mês. */
  pricedUnitPrice: number;
  profitPerUnit: number;
  /** Markup efetivo sobre o custo unitário: (valor total precificado − custo unit.) / custo unit. */
  achievedMarkupPct: number;
  /** Margem efetiva sobre o valor total precificado. */
  achievedMarginPct: number;
  monthlyQty: number;
  monthlyRevenue: number;
  monthlyProfit: number;
  roaPct: number;
  /** Meta total un./mês para suprir rateio + lucro. */
  monthlyTargetQty: number | null;
  /** Provisão: un./mês que ainda faltam (zera ao atingir a meta). */
  provisionQtyPerMonth: number | null;
  monthlyTargetRevenue: number | null;
  /** Provisão de receita mensal ainda necessária. */
  provisionRevenue: number | null;
}

export interface PricingDashboardSummary {
  totalMaterialCost: number;
  /** Soma dos valores cadastrados na aba Estoque (compras, custo BOM, etc.). */
  totalStockInventory: number;
  totalCosts: number;
  totalExpenses: number;
  totalCredits: number;
  /** Custos + despesas cadastrados (fixos) + material mensal total do escopo. */
  totalConsolidatedCosts: number;
  /** Valor de aquisição: compras cadastradas de produto acabado e mercadoria. */
  totalAcquisitionCost: number;
  /** R$/un. de aquisição quando um único PA/mercadoria está em foco. */
  acquisitionUnitCost?: number;
  totalMonthlyRevenue: number;
  totalMonthlyProfit: number;
  isProfit: boolean;
  /** Custos + despesas rateados − créditos (base mensal, sem estoque). */
  monthlyOperatingBurden: number;
  /** Meta de receita mensal (custos + despesas + margem global). */
  monthlyTargetRevenue: number;
  /** Provisão de receita: meta − receita já projetada (zera ao atingir). */
  provisionRevenueToCover: number;
  /** Custos rateados ao(s) item(ns) em foco (não o pool cadastrado do segmento). */
  productAllocatedCosts: number;
  /** Despesas rateadas ao(s) item(ns) em foco. */
  productAllocatedExpenses: number;
  /** R$/un. de material quando há um único item em foco. */
  materialUnitCost?: number;
  /** Nome do item quando um único produto/mercadoria/serviço está selecionado. */
  selectedProductName?: string;
}

export interface SegmentDashboardSummary extends PricingDashboardSummary {
  segment: PricingSegment;
  label: string;
  itemCount: number;
}

export const STOCK_CATEGORY_LABELS: Record<StockCategory, string> = {
  insumo: 'Insumo',
  materia_prima: 'Matéria-prima',
  produto_acabado: 'Produto acabado',
  mercadoria: 'Mercadoria',
};

export const PRICING_SEGMENT_LABELS: Record<PricingSegment, string> = {
  produto_acabado: 'Produto acabado',
  mercadoria: 'Mercadoria',
  servico: 'Serviço',
};

export const PRICING_SEGMENT_FILTERS: PricingSegment[] = [
  'produto_acabado',
  'mercadoria',
  'servico',
];

export interface CostExpenseKindTotals {
  fixedCosts: number;
  variableCosts: number;
  fixedExpenses: number;
  variableExpenses: number;
}

export function resolveCostExpenseKind(item: Pick<CostExpenseItem, 'kind'>): CostExpenseKind {
  return item.kind === 'variavel' ? 'variavel' : 'fixo';
}

export function computeCostExpenseKindTotals(
  items: CostExpenseItem[],
  segment?: PricingSegment,
): CostExpenseKindTotals {
  const totals: CostExpenseKindTotals = {
    fixedCosts: 0,
    variableCosts: 0,
    fixedExpenses: 0,
    variableExpenses: 0,
  };
  for (const item of items) {
    if (segment && item.segment !== segment) continue;
    const kind = resolveCostExpenseKind(item);
    if (item.type === 'custo') {
      if (kind === 'fixo') totals.fixedCosts += item.monthlyAmount;
      else totals.variableCosts += item.monthlyAmount;
    } else if (item.type === 'despesa') {
      if (kind === 'fixo') totals.fixedExpenses += item.monthlyAmount;
      else totals.variableExpenses += item.monthlyAmount;
    }
  }
  return totals;
}

export const STOCK_INVENTORY_CATEGORIES: StockCategory[] = [
  'insumo',
  'materia_prima',
  'produto_acabado',
  'mercadoria',
];

const STOCK_CATALOG_PRICING_CATEGORIES: StockCategory[] = [
  'insumo',
  'materia_prima',
  'mercadoria',
];

export function isStockCatalogPricingCategory(category: StockCategory): boolean {
  return STOCK_CATALOG_PRICING_CATEGORIES.includes(category);
}

/** Grava catálogo de preço quando o usuário cadastra valor (unitário ou total). */
export function captureCatalogPricingFromUserEdit(
  item: StockItem,
  patch: Partial<
    Pick<
      StockItem,
      | 'unitPrice'
      | 'purchasePrice'
      | 'priceInputMode'
      | 'unitsPurchased'
      | 'catalogUnitPrice'
      | 'catalogPurchasePrice'
      | 'catalogPriceInputMode'
    >
  >,
): Pick<
  StockItem,
  | 'catalogUnitPrice'
  | 'catalogPurchasePrice'
  | 'catalogPriceInputMode'
  | 'catalogUnitsAtPricing'
  | 'catalogMeasureAtPricing'
  | 'catalogPackageSizeAtPricing'
> {
  if (!isStockCatalogPricingCategory(item.category)) return {};

  const mode =
    patch.catalogPriceInputMode ??
    patch.priceInputMode ??
    item.catalogPriceInputMode ??
    item.priceInputMode ??
    'unit';
  const units =
    patch.unitsPurchased ?? (item.unitsPurchased > 0 ? item.unitsPurchased : 0);
  const measureQuantity =
    item.measureQuantity > 0 ? item.measureQuantity : 0;
  const packageSizeAtPricing =
    units > 0 && measureQuantity > 0
      ? units * measureQuantity
      : stockTotalMeasure(item);

  if (mode === 'total' && (patch.purchasePrice ?? item.purchasePrice) > 0) {
    const purchase = roundStockMoney(patch.purchasePrice ?? item.purchasePrice, 2);
    const unit =
      units > 0
        ? roundStockMoney(purchase / units, 6)
        : roundStockMoney(patch.unitPrice ?? item.unitPrice, 6);
    return {
      catalogPurchasePrice: purchase,
      catalogUnitPrice: unit > 0 ? unit : item.catalogUnitPrice,
      catalogPriceInputMode: 'total',
      catalogUnitsAtPricing: units > 0 ? units : item.catalogUnitsAtPricing,
      catalogMeasureAtPricing: measureQuantity > 0 ? measureQuantity : item.catalogMeasureAtPricing,
      catalogPackageSizeAtPricing:
        packageSizeAtPricing > 0 ? packageSizeAtPricing : item.catalogPackageSizeAtPricing,
    };
  }

  const unit = roundStockMoney(patch.unitPrice ?? item.unitPrice, 6);
  if (unit <= 0) return {};
  const purchase =
    units > 0 ? roundStockMoney(unit * units, 2) : roundStockMoney(item.purchasePrice, 2);
  return {
    catalogUnitPrice: unit,
    catalogPurchasePrice: purchase > 0 ? purchase : item.catalogPurchasePrice,
    catalogPriceInputMode: 'unit',
    catalogUnitsAtPricing: units > 0 ? units : item.catalogUnitsAtPricing,
    catalogMeasureAtPricing: measureQuantity > 0 ? measureQuantity : item.catalogMeasureAtPricing,
    catalogPackageSizeAtPricing:
      packageSizeAtPricing > 0 ? packageSizeAtPricing : item.catalogPackageSizeAtPricing,
  };
}

/** Modo de cadastro de valor — preferência explícita do usuário vence o catálogo congelado. */
export function resolveStockPriceInputMode(
  item: Pick<StockItem, 'priceInputMode' | 'catalogPriceInputMode'>,
): 'unit' | 'total' {
  if (item.priceInputMode === 'total' || item.priceInputMode === 'unit') {
    return item.priceInputMode;
  }
  return item.catalogPriceInputMode === 'total' ? 'total' : 'unit';
}

/** Restaura unitário/total a partir do catálogo (insumo / MP / mercadoria). */
export function applyCatalogStockPricing(item: StockItem): StockItem {
  if (!isStockCatalogPricingCategory(item.category)) return item;

  const mode = resolveStockPriceInputMode(item);
  const units = item.unitsPurchased > 0 ? item.unitsPurchased : 0;
  const catUnit = item.catalogUnitPrice;
  const catPurchase = item.catalogPurchasePrice;

  if (mode === 'total') {
    const purchasePrice = roundStockMoney(
      item.purchasePrice > 0
        ? item.purchasePrice
        : catPurchase != null && catPurchase > 0
          ? catPurchase
          : units > 0 && (catUnit ?? item.unitPrice) > 0
            ? (catUnit ?? item.unitPrice) * units
            : 0,
      2,
    );
    const unitPrice =
      units > 0 && purchasePrice > 0
        ? roundStockMoney(purchasePrice / units, 6)
        : catUnit != null && catUnit > 0
          ? roundStockMoney(catUnit, 6)
          : roundStockMoney(item.unitPrice, 6);
    return {
      ...item,
      priceInputMode: 'total',
      purchasePrice,
      unitPrice,
    };
  }

  const unitPrice =
    catUnit != null && catUnit > 0
      ? roundStockMoney(catUnit, 6)
      : deriveStockUnitPrice(item);
  const fromCatalogUnit = units > 0 ? roundStockMoney(unitPrice * units, 2) : 0;
  const purchasePrice = roundStockMoney(
    Math.max(
      fromCatalogUnit,
      item.purchasePrice > 0 ? item.purchasePrice : 0,
      catPurchase != null && catPurchase > 0 ? catPurchase : 0,
    ),
    2,
  );
  return {
    ...item,
    priceInputMode: 'unit',
    unitPrice,
    purchasePrice,
  };
}

/** Arredonda valores monetários / unitários para evitar drift de float (ex.: 5.7349999). */
export function roundStockMoney(value: number, decimals = 4): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Medida total do cadastro (qtd comprada × medida/un) — não muda ao repor estoque. */
export function catalogStockMeasure(
  item: Pick<StockItem, 'unitsPurchased' | 'measureQuantity'>,
): number {
  const units = item.unitsPurchased > 0 ? item.unitsPurchased : 0;
  const perUnit = item.measureQuantity > 0 ? item.measureQuantity : 0;
  if (units > 0 && perUnit > 0) return units * perUnit;
  if (units > 0) return units;
  return 0;
}

/** Medida/un zerada mas qtd comprada preenchida — ignora packageSize legado na exibição. */
export function isStockMeasureZeroedWithLegacy(
  item: Pick<StockItem, 'unitsPurchased' | 'measureQuantity' | 'packageUnit'>,
): boolean {
  if (item.packageUnit === 'un') return false;
  if (item.measureQuantity > 0) return false;
  return item.unitsPurchased > 0;
}

/** g/ml por unidade comprada (campo ou catálogo congelado). */
export function resolveMeasurePerUnitForReplenish(
  item: Pick<StockItem, 'measureQuantity' | 'catalogMeasureAtPricing'>,
): number {
  if (item.measureQuantity > 0) return item.measureQuantity;
  if (item.catalogMeasureAtPricing != null && item.catalogMeasureAtPricing > 0) {
    return item.catalogMeasureAtPricing;
  }
  return 0;
}

/** Estoque físico em g/ml só sobe no «Acrescentar» se medida/un estiver preenchida. */
export function canIncreasePhysicalMeasureOnReplenish(
  item: Pick<StockItem, 'measureQuantity' | 'packageUnit'>,
): boolean {
  if (item.packageUnit === 'un') return true;
  return item.measureQuantity > 0;
}

/** Pode usar «Acrescentar» (medida/un, qtd comprada ou cadastro vazio com medida no catálogo). */
export function isStockMeasureCadastroComplete(
  item: Pick<
    StockItem,
    'unitsPurchased' | 'measureQuantity' | 'packageUnit' | 'catalogMeasureAtPricing'
  >,
): boolean {
  if (item.packageUnit === 'un') {
    return item.unitsPurchased > 0;
  }
  if (item.measureQuantity > 0) return true;
  if (item.unitsPurchased > 0) return true;
  return true;
}

/** Estoque físico disponível (só packageSize; cadastro digitado não conta como saldo). */
export function stockOnHandMeasure(
  item: Pick<StockItem, 'unitsPurchased' | 'measureQuantity' | 'packageSize' | 'packageUnit'>,
): number {
  if (item.packageSize > 0) return item.packageSize;
  if (isStockMeasureZeroedWithLegacy(item)) return 0;
  return 0;
}

/** @deprecated Preferir stockOnHandMeasure (físico) ou catalogStockMeasure (cadastro). */
export function stockTotalMeasure(
  item: Pick<StockItem, 'unitsPurchased' | 'measureQuantity' | 'packageSize' | 'packageUnit'>,
): number {
  return stockOnHandMeasure(item);
}

/** Preço unitário de compra sem frete. */
export function deriveStockUnitPriceBase(
  item: Pick<StockItem, 'unitPrice' | 'purchasePrice' | 'unitsPurchased'>,
): number {
  if (item.unitPrice > 0) return roundStockMoney(item.unitPrice, 6);
  const units = item.unitsPurchased > 0 ? item.unitsPurchased : 0;
  if (units > 0 && item.purchasePrice > 0) {
    return roundStockMoney(item.purchasePrice / units, 6);
  }
  if (item.purchasePrice > 0) return roundStockMoney(item.purchasePrice, 6);
  return 0;
}

/** Multiplicador de frete sobre compra (1 + %/100). */
export function stockFreightMultiplier(
  item: Pick<StockItem, 'freightPercent'>,
): number {
  const p = typeof item.freightPercent === 'number' ? item.freightPercent : 0;
  if (!Number.isFinite(p) || p <= 0) return 1;
  return 1 + p / 100;
}

/** Deriva preço unitário (R$/un comprada) com frete. */
export function deriveStockUnitPrice(
  item: Pick<StockItem, 'unitPrice' | 'purchasePrice' | 'unitsPurchased' | 'freightPercent'>,
): number {
  return roundStockMoney(
    deriveStockUnitPriceBase(item) * stockFreightMultiplier(item),
    6,
  );
}

/** Garante coerência de medida; preços de insumo/MP vêm do catálogo quando existir. */
export function normalizeStockItem(item: StockItem): StockItem {
  let unitsPurchased = item.unitsPurchased > 0 ? item.unitsPurchased : 0;
  let measureQuantity = item.measureQuantity > 0 ? item.measureQuantity : 0;

  if (unitsPurchased <= 0 && measureQuantity <= 0 && item.packageSize > 0) {
    unitsPurchased = 1;
    measureQuantity = item.packageSize;
  }

  const catalogTotal = catalogStockMeasure({ unitsPurchased, measureQuantity });
  const packageSize =
    item.packageSize > 0
      ? item.packageSize
      : measureQuantity > 0 && catalogTotal > 0
        ? catalogTotal
        : 0;
  const withQty = { ...item, unitsPurchased, measureQuantity, packageSize };

  if (
    isStockCatalogPricingCategory(item.category) &&
    (item.catalogUnitPrice != null || item.catalogPurchasePrice != null)
  ) {
    return { ...applyCatalogStockPricing(withQty), packageSize };
  }

  const unitPrice = deriveStockUnitPriceBase({ ...withQty, unitsPurchased });
  const purchasePrice =
    unitsPurchased > 0 ? roundStockMoney(unitPrice * unitsPurchased, 2) : 0;

  return {
    ...withQty,
    unitPrice,
    purchasePrice,
    freightPercent:
      typeof item.freightPercent === 'number' && Number.isFinite(item.freightPercent)
        ? Math.max(0, item.freightPercent)
        : 0,
    licitanteInstitution: item.licitanteInstitution?.trim() || undefined,
    recoverableCredits: Array.isArray(item.recoverableCredits)
      ? item.recoverableCredits.map((c) => ({
          id: c.id || crypto.randomUUID(),
          name: String(c.name ?? ''),
          creditKind: String(c.creditKind ?? 'PIS/COFINS'),
          amount: Math.max(0, Number(c.amount) || 0),
          taxRegime: c.taxRegime,
          notes: c.notes,
        }))
      : [],
  };
}

/** Valor total pago (R$) = valor unitário × quantidade comprada (+ frete). */
export function stockPurchaseTotal(
  item: Pick<StockItem, 'unitPrice' | 'purchasePrice' | 'unitsPurchased' | 'freightPercent'>,
): number {
  let base = 0;
  if (item.purchasePrice > 0) base = item.purchasePrice;
  else {
    const units = item.unitsPurchased > 0 ? item.unitsPurchased : 0;
    if (units <= 0) return 0;
    base = deriveStockUnitPriceBase(item) * units;
  }
  return roundStockMoney(base * stockFreightMultiplier(item), 2);
}

export function createDefaultPricingWorkspace(companyName: string): PricingWorkspace {
  return {
    companyName,
    stockItems: [],
    serviceItems: [],
    costExpenses: [],
    credits: [],
    settings: {
      markupPercent: 30,
      marginPercent: 25,
      mode: 'margin_only',
      costAllocationMode: 'por_unidades_mes',
    },
    licitanteInstitutions: [],
    productOverrides: {},
    updatedAt: new Date().toISOString(),
  };
}

export function createEmptyStockItem(
  companyName: string,
  category: StockCategory,
  stockScopeProductId?: string,
): StockItem {
  const scope =
    stockScopeProductId && isStockProductScopedCategory(category)
      ? { stockScopeProductId }
      : {};
  return {
    id: crypto.randomUUID(),
    companyName,
    category,
    ...scope,
    name: '',
    sku: '',
    unitPrice: 0,
    purchasePrice: 0,
    unitsPurchased: 0,
    measureQuantity: 0,
    packageSize: 0,
    packageUnit: category === 'insumo' || category === 'materia_prima' ? 'm' : 'kg',
    directCost: 0,
    useBom: category === 'produto_acabado',
    bom: [],
    monthlyQty: 0,
    recipeYieldQty: 1,
    notes: '',
    freightPercent: 0,
    recoverableCredits: [],
    createdAt: new Date().toISOString(),
  };
}

export function createEmptyServiceItem(companyName: string): ServiceItem {
  return {
    id: crypto.randomUUID(),
    companyName,
    name: '',
    sku: '',
    directCost: 0,
    monthlyQty: 0,
    notes: '',
    createdAt: new Date().toISOString(),
  };
}
