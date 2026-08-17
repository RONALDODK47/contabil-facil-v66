import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Calculator,
  Download,
  FileText,
  Info,
  Layers,
  MapPin,
  Package,
  Percent,
  Plus,
  Receipt,
  ScrollText,
  Search,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { FreeNumericInput } from './FreeNumericInput';
import { patchDebugContext } from '../agent/debugContext';
import { ModulePageHeader } from './ModulePageHeader';
import PricingCalculationsPanel from './pricing/PricingCalculationsPanel';
import PricingInfoModal from './pricing/PricingInfoModal';
import PricingPrecificacaoReportPanel from './pricing/PricingPrecificacaoReportPanel';
import PricingPrecificacaoVirtualTable from './pricing/PricingPrecificacaoVirtualTable';
import PricingRoaVirtualTable from './pricing/PricingRoaVirtualTable';
import PricingIcmsEstadosPanel from './PricingIcmsEstadosPanel';
import PricingDrePanel from './pricing/PricingDrePanel';
import { CfSegmentedControl } from './CfSegmentedControl';
import {
  CF_FIELD_COL,
  CF_FIELD_COL_CONTROLS,
  CF_FIELD_INLINE,
  CF_FIELD_ROW,
  CF_INPUT_MED,
  CF_INPUT_MONEY,
  CF_INPUT_NUM,
  CF_INPUT_SHORT,
  CF_LABEL,
  CF_SELECT,
  CF_SELECT_MEASURE,
  CF_SELECT_RESPONSIVE,
  CF_SELECT_WIDE_RESPONSIVE,
} from '../lib/formFieldClasses';
import {
  cn,
  formatCurrency,
  formatStockNumberForInput,
  parseLocaleNumber,
} from '../lib/utils';
import { sanitizeNumericDraft } from '../../lib/localeNumber';
import {
  usePricingModuleState,
  type PricingMainTab,
} from '../logic/usePricingModuleState';
import {
  CREDITS_HELP_BODY,
  CREDITS_HELP_TITLE,
  COSTS_EXPENSES_HELP_BODY,
  COSTS_EXPENSES_HELP_TITLE,
  MARKUP_MARGIN_HELP_BODY,
  MARKUP_MARGIN_HELP_TITLE,
  ROA_HELP_BODY,
  ROA_HELP_TITLE,
  stockCategoryHelpBody,
  stockCategoryHelpTitle,
} from '../logic/pricingHelpContent';
import type {
  BomLine,
  CostExpenseItem,
  CostExpenseKind,
  MeasureUnit,
  PricingMode,
  PricingSegment,
  StockCategory,
  StockItem,
  StockItemCredit,
} from '../logic/pricingTypes';
import {
  BOM_LINE_UNIT_OPTIONS,
  COST_EXPENSE_KIND_LABELS,
  computeCostExpenseKindTotals,
  MEASURE_UNIT_LABELS,
  PRICING_SEGMENT_FILTERS,
  PRICING_SEGMENT_LABELS,
  STOCK_CATEGORY_LABELS,
  STOCK_INVENTORY_CATEGORIES,
  STOCK_MEASURE_UNIT_OPTIONS,
  captureCatalogPricingFromUserEdit,
  deriveStockUnitPrice,
  deriveStockUnitPriceBase,
  roundStockMoney,
  stockFreightMultiplier,
  stockPurchaseTotal,
  catalogStockMeasure,
  stockOnHandMeasure,
  stockTotalMeasure,
  isStockProductScopedCategory,
  stockItemMatchesProductScope,
  STOCK_PRODUCT_SCOPE_ALL,
  STOCK_PRODUCT_SCOPE_UNLINKED,
} from '../logic/pricingTypes';
import {
  computeStockCreditsSummary,
  listLicitanteInstitutions,
  stockItemCreditsTotal,
  stockMatchesLicitanteFilter,
} from '../logic/pricingStockCredits';
import { computePricingDre } from '../logic/pricingDre';
import {
  downloadPricingPdf,
  type PricingPdfSection,
} from '../../lib/pricingPdfExporter';
import {
  bomLineCost,
  computeDashboardBySegment,
  computeDashboardFromBreakdownRows,
  computeDashboardSummary,
  computeMaterialCost,
  computePricingBreakdowns,
  resolveSellingUnitPrice,
  sortByRentability,
  computeStockRemainingAfterBom,
  defaultBomUnitForStock,
  effectiveProjectionQty,
  cloneBomLines,
  compositionCostSummary,
  compositionCostSummaryForStockItem,
  compositionMaterialTotalFromBom,
  materialUnitCostFromCompositionTotal,
  resolveRecipeQuantityBase,
  monthlyQtyLooksLikeRecipeYield,
  resolveRecipeBatchYield,
  resolveRecipeYieldQty,
  resolveStockUnitPriceFromPurchase,
  validateBomMaterialCoverage,
  buildStockItemsForBomUsage,
  bomSourcesForProduct,
  collectWorkspaceMaterialShortages,
  resolveReplenishShortageForStockItem,
  stockItemDepletedByBom,
  workspaceWithRecipeDoubles,
} from '../logic/pricingCalculator';

import type { CompanyWorkspaceControls } from '../types/companyWorkspaceControls';
import { ActiveCompanySelector } from './ActiveCompanySelector';

export interface PricingModuleProps extends CompanyWorkspaceControls {
  storageVersion?: number;
}

/** Abas do catálogo de estoque (categorias + itens esgotados pela composição). */
type StockCatalogTab = StockCategory | 'faltantes';

const STOCK_CATALOG_TABS: { id: StockCatalogTab; label: string }[] = [
  ...STOCK_INVENTORY_CATEGORIES.map((cat) => ({
    id: cat as StockCatalogTab,
    label: STOCK_CATEGORY_LABELS[cat],
  })),
  { id: 'faltantes', label: 'Produtos/Mercadorias faltantes' },
];

const MAIN_TABS: { id: PricingMainTab; label: string; icon: typeof Package }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'estoque', label: 'Estoque', icon: Package },
  { id: 'custos', label: 'Custos e Despesas', icon: Receipt },
  { id: 'creditos', label: 'Créditos', icon: Layers },
  { id: 'dre', label: 'DRE', icon: ScrollText },
  { id: 'precificacao', label: 'Precificação', icon: Percent },
  { id: 'comparacao-aliquotas', label: 'Comparação alíquotas', icon: MapPin },
  { id: 'calculos', label: 'Cálculos', icon: Calculator },
  { id: 'roa', label: 'ROA', icon: TrendingUp },
];

type PriceEntryMode = 'unit' | 'total';
type MeasureEntryMode = 'per_unit' | 'total';

function stockMeasureUnit(unit: MeasureUnit): MeasureUnit {
  return STOCK_MEASURE_UNIT_OPTIONS.includes(unit) ? unit : 'un';
}

function measureLabelForUnit(unit: MeasureUnit): string {
  if (unit === 'un') return 'unidades';
  if (unit === 'l') return 'litros';
  if (unit === 'ml') return 'ml';
  if (unit === 'kg') return 'kg';
  if (unit === 'g') return 'g';
  if (unit === 'm') return 'metros';
  if (unit === 'cm') return 'centímetros';
  return unit;
}

/** Total do cadastro de preço: R$/un × qtd comprada ou total digitado (modo Total R$). */
function catalogPriceTotalDisplay(
  item: Pick<StockItem, 'unitPrice' | 'purchasePrice' | 'unitsPurchased'>,
  priceEntryMode: PriceEntryMode,
  unitPriceRaw: string,
  priceTotalRaw: string,
): number {
  const units = item.unitsPurchased > 0 ? item.unitsPurchased : 0;
  if (priceEntryMode === 'total') {
    const typed = parseLocaleNumber(priceTotalRaw, 0);
    if (typed > 0) return roundStockMoney(typed, 2);
    return item.purchasePrice > 0 ? roundStockMoney(item.purchasePrice, 2) : 0;
  }
  const typedUnit = parseLocaleNumber(unitPriceRaw, 0);
  const unit = typedUnit > 0 ? typedUnit : deriveStockUnitPriceBase(item);
  if (units > 0 && unit > 0) return roundStockMoney(unit * units, 2);
  return 0;
}

/** R$/un do cadastro — no modo total = total ÷ qtd comprada. */
function catalogUnitPriceDisplay(
  item: Pick<StockItem, 'unitPrice' | 'purchasePrice' | 'unitsPurchased'>,
  priceEntryMode: PriceEntryMode,
  unitPriceRaw: string,
  priceTotalRaw: string,
): number {
  const units = item.unitsPurchased > 0 ? item.unitsPurchased : 0;
  if (priceEntryMode === 'unit') {
    const typed = parseLocaleNumber(unitPriceRaw, 0);
    return typed > 0 ? roundStockMoney(typed, 6) : deriveStockUnitPriceBase(item);
  }
  const total = catalogPriceTotalDisplay(item, priceEntryMode, unitPriceRaw, priceTotalRaw);
  if (units > 0 && total > 0) return roundStockMoney(total / units, 6);
  return deriveStockUnitPriceBase(item);
}

function patchStockPricing(
  item: StockItem,
  patch: Partial<Pick<StockItem, 'unitPrice' | 'unitsPurchased' | 'purchasePrice' | 'priceInputMode'>>,
): Partial<StockItem> {
  const next = { ...item, ...patch };
  const unitsPurchased = next.unitsPurchased > 0 ? next.unitsPurchased : 0;

  if (patch.purchasePrice !== undefined && patch.unitPrice === undefined) {
    const purchasePrice = patch.purchasePrice > 0 ? roundStockMoney(patch.purchasePrice, 2) : 0;
    const unitPrice =
      unitsPurchased > 0
        ? roundStockMoney(purchasePrice / unitsPurchased, 6)
        : roundStockMoney(purchasePrice, 6);
    const priced = {
      ...patch,
      unitsPurchased,
      unitPrice,
      purchasePrice,
      priceInputMode: patch.priceInputMode ?? 'total',
    } as Partial<StockItem>;
    return {
      ...priced,
      ...captureCatalogPricingFromUserEdit(item, priced),
    };
  }

  const unitPrice =
    patch.unitPrice !== undefined
      ? roundStockMoney(patch.unitPrice, 6)
      : deriveStockUnitPrice(next);
  const purchasePrice =
    unitsPurchased > 0 ? roundStockMoney(unitPrice * unitsPurchased, 2) : 0;
  const priced = {
    ...patch,
    unitsPurchased,
    unitPrice,
    purchasePrice,
    priceInputMode: patch.priceInputMode ?? 'unit',
  } as Partial<StockItem>;
  return {
    ...priced,
    ...captureCatalogPricingFromUserEdit(item, priced),
  };
}

/** Medida (cm/m/L/ml/kg/g) só para rateio na BOM — não altera valor unitário nem total pago. */
function patchStockMeasure(
  item: StockItem,
  patch: Partial<Pick<StockItem, 'measureQuantity' | 'packageUnit' | 'packageSize'>>,
): Partial<StockItem> {
  const next = { ...item, ...patch };
  const measureQuantity =
    patch.measureQuantity !== undefined
      ? Math.max(0, patch.measureQuantity)
      : next.measureQuantity > 0
        ? next.measureQuantity
        : 0;
  const units = next.unitsPurchased > 0 ? next.unitsPurchased : 0;
  const zeroedWithLegacy =
    next.packageUnit !== 'un' &&
    measureQuantity <= 0 &&
    (units > 0 || next.packageSize > 0);
  const packageSize =
    patch.packageSize !== undefined
      ? Math.max(0, patch.packageSize)
      : zeroedWithLegacy
        ? 0
        : units > 0 && measureQuantity > 0
          ? catalogStockMeasure({ unitsPurchased: units, measureQuantity })
          : Math.max(0, next.packageSize);
  return { ...patch, measureQuantity, packageSize };
}

/** Aplica preço + medida e recalcula packageSize (medida total = qtd comprada × medida/un). */
function patchStockPurchaseAndMeasure(
  item: StockItem,
  pricingPatch: Partial<Pick<StockItem, 'unitPrice' | 'unitsPurchased' | 'purchasePrice'>>,
  measurePatch?: Partial<Pick<StockItem, 'measureQuantity' | 'packageUnit'>>,
): Partial<StockItem> {
  const priced = patchStockPricing(item, pricingPatch);
  const next = { ...item, ...priced, ...(measurePatch ?? {}) };
  const measured = patchStockMeasure(next, measurePatch ?? {});
  return { ...priced, ...measured };
}

function formatMeasureFormula(
  perUnit: number,
  unitsPurchased: number,
  total: number,
  measureUnit: MeasureUnit,
): string {
  if (perUnit <= 0 || unitsPurchased <= 0 || total <= 0) return '';
  return `${formatMeasureQty(perUnit, measureUnit)}/un × ${unitsPurchased} un = ${formatMeasureQty(total, measureUnit)}`;
}

function formatMeasureQty(value: number, unit: MeasureUnit): string {
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, '');
  return `${rounded} ${unit}`;
}

/** Resumo compacto exibido na lista do catálogo de estoque. */
function StockCatalogStats({
  item,
  allItems,
  className,
}: {
  item: StockItem;
  allItems: StockItem[];
  className?: string;
}) {
  const measureUnit = stockMeasureUnit(item.packageUnit);
  const unitsTotal = item.unitsPurchased > 0 ? item.unitsPurchased : 0;
  const measurePerUnit = item.measureQuantity > 0 ? item.measureQuantity : 0;
  const measureTotal = catalogStockMeasure(item);
  const pricePerUnit = deriveStockUnitPrice(item);
  const valueTotal = stockPurchaseTotal(item);
  const isFinishedWithBom = item.category === 'produto_acabado' && item.useBom;
  const stockByIdCatalog = new Map(allItems.map((s) => [s.id, s]));
  const bomSummary = isFinishedWithBom
    ? compositionCostSummaryForStockItem(item, stockByIdCatalog)
    : null;
  const bomMaterialTotal = bomSummary?.recipeBatchTotalCost ?? 0;
  const bomUnitCost = bomSummary?.unitMaterialCost ?? 0;
  const finishedDirectCost =
    item.category === 'produto_acabado' && !item.useBom && item.directCost > 0
      ? item.directCost
      : 0;
  const displayMeasurePerUnit = measurePerUnit;
  const displayMeasureTotal = measureTotal;
  const displayValuePerUnit = pricePerUnit;
  const displayValueTotal = valueTotal;

  const statRow = (label: string, value: string, bold = false) => (
    <div className="grid grid-cols-[52px_1fr] gap-1 items-baseline">
      <span className="text-[7px] font-black uppercase opacity-45 text-left">{label}</span>
      <span className={cn('text-[8px] text-right tabular-nums', bold && 'font-black text-[9px]')}>{value}</span>
    </div>
  );

  return (
    <div
      className={cn(
        'shrink-0 w-full sm:w-[152px] border border-brand-border/30 bg-white/80 px-2 py-1.5 space-y-1',
        className,
      )}
    >
      {item.category !== 'produto_acabado' ? (
        <>
          {statRow(
            'Med. un',
            displayMeasurePerUnit > 0
              ? `${formatMeasureQty(displayMeasurePerUnit, measureUnit)}/un`
              : '—',
          )}
          {statRow(
            'Med. tot',
            displayMeasureTotal > 0
              ? formatMeasureQty(displayMeasureTotal, measureUnit)
              : '—',
          )}
          {statRow('Un. un', '1 un')}
          {statRow('Un. tot', unitsTotal > 0 ? `${unitsTotal} un` : '—')}
        </>
      ) : (
        <>
          {statRow('Modo', item.useBom ? 'Composição' : 'Manual')}
          {statRow(
            'Rend.',
            resolveRecipeYieldQty(item) > 0 ? `${resolveRecipeYieldQty(item)} un/rec` : '—',
          )}
          {statRow(
            'Qtd/mês',
            item.monthlyQty > 0 ? `${item.monthlyQty} un` : '—',
          )}
        </>
      )}
      <div className="border-t border-brand-border/20 pt-1 space-y-0.5">
        {isFinishedWithBom ? (
          <>
            {statRow(
              'Custo/un',
              bomUnitCost > 0 ? formatCurrency(bomUnitCost) : '—',
            )}
            {statRow(
              'Mat. tot',
              bomMaterialTotal > 0 ? formatCurrency(bomMaterialTotal) : '—',
              true,
            )}
          </>
        ) : item.category === 'produto_acabado' ? (
          <>
            {statRow('Custo', finishedDirectCost > 0 ? `${formatCurrency(finishedDirectCost)}/un` : '—')}
            {statRow('Manual', finishedDirectCost > 0 ? formatCurrency(finishedDirectCost) : '—', true)}
          </>
        ) : (
          <>
            {statRow(
              'V. unit',
              displayValuePerUnit > 0 ? `${formatCurrency(displayValuePerUnit)}/un` : '—',
            )}
            {statRow(
              'V. total',
              displayValueTotal > 0 ? formatCurrency(displayValueTotal) : '—',
              true,
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StockInfoCard({
  title,
  value,
  hint,
  emptyHint,
  compact = false,
}: {
  title: string;
  value: string | null;
  hint?: string;
  emptyHint?: string;
  /** Mesmo tamanho, só título e valor (sem texto explicativo). */
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'border border-brand-border bg-white/90 px-2 py-2 shadow-[2px_2px_0_0_rgba(20,20,20,0.08)]',
        compact
          ? 'w-[140px] h-[52px] flex flex-col justify-center gap-1 shrink-0'
          : 'inline-block w-fit min-w-[108px] max-w-[168px] space-y-0.5',
      )}
    >
      <p className="text-[8px] font-black uppercase tracking-wide opacity-50 leading-tight">{title}</p>
      <p className="text-[11px] font-mono font-black tabular-nums">{value ?? '—'}</p>
      {!compact && (hint || emptyHint) ? (
        <p className="text-[7px] font-bold uppercase opacity-45 leading-snug">
          {value ? hint : emptyHint ?? hint}
        </p>
      ) : null}
    </div>
  );
}

function StockMeasureInfoCards({
  item,
  measureUnit,
  measureQuantity,
  purchaseTotal,
}: {
  item: StockItem;
  measureUnit: MeasureUnit;
  measureQuantity: number;
  purchaseTotal: number;
}) {
  const units = item.unitsPurchased > 0 ? item.unitsPurchased : 0;
  const measureTotal = catalogStockMeasure(item);
  const purchaseTotalPaid = purchaseTotal > 0 ? purchaseTotal : stockPurchaseTotal(item);

  return (
    <div className="md:col-span-2 flex flex-wrap gap-2 pt-1">
      <StockInfoCard
        compact
        title="Medida / un"
        value={measureQuantity > 0 ? `${formatMeasureQty(measureQuantity, measureUnit)}/un` : null}
      />
      <StockInfoCard
        compact
        title="Qtd comprada"
        value={units > 0 ? `${units} un` : null}
      />
      {measureTotal > 0 && measureQuantity > 0 ? (
        <StockInfoCard
          compact
          title="Medida total"
          value={formatMeasureQty(measureTotal, measureUnit)}
        />
      ) : null}
      <StockInfoCard
        title="Valor total pago (R$)"
        value={purchaseTotalPaid > 0 ? formatCurrency(purchaseTotalPaid) : null}
      />
    </div>
  );
}

function InfoButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Ajuda"
      className="w-7 h-7 border border-brand-border flex items-center justify-center hover:bg-brand-sidebar/40"
    >
      <Info size={14} />
    </button>
  );
}

export default function PricingModule({
  selectedCompany,
  companyOptions,
  onCompanyChange,
  onCreateCompany,
  onRenameCompany,
  onDeleteCompany,
  storageVersion,
}: PricingModuleProps) {
  const [mainTab, setMainTab] = useState<PricingMainTab>('dashboard');
  const [stockFilter, setStockFilter] = useState<StockCatalogTab>('insumo');

  useEffect(() => {
    const tabMeta = MAIN_TABS.find((t) => t.id === mainTab);
    patchDebugContext({
      module: 'pricing' as any,
      moduleLabel: 'Precificação',
      subTab: mainTab,
      subTabLabel: tabMeta?.label ?? mainTab,
      company: selectedCompany || undefined,
    });
  }, [mainTab, selectedCompany]);

  /** PA cujo estoque de insumo/MP está sendo exibido. */
  const [stockProductScopeId, setStockProductScopeId] = useState<string>(STOCK_PRODUCT_SCOPE_ALL);
  const [legacyBulkAssignPaId, setLegacyBulkAssignPaId] = useState<string>('');
  const [selectedStockIds, setSelectedStockIds] = useState<string[]>([]);
  const [costSegmentFilter, setCostSegmentFilter] = useState<PricingSegment>('produto_acabado');
  const [costKindFilter, setCostKindFilter] = useState<'todos' | CostExpenseKind>('todos');
  const [creditSegmentFilter, setCreditSegmentFilter] = useState<PricingSegment | 'geral'>('geral');
  const [licitanteFilter, setLicitanteFilter] = useState('');
  const [pricingFilter, setPricingFilter] = useState<PricingSegment | 'all'>('all');
  const [precificacaoView, setPrecificacaoView] = useState<'tabela' | 'relatorio'>('tabela');
  const [search, setSearch] = useState('');
  const [editingStockId, setEditingStockId] = useState<string | null>(null);
  const [unitPriceRaw, setUnitPriceRaw] = useState('');
  const [unitPriceTyping, setUnitPriceTyping] = useState(false);
  const [priceEntryMode, setPriceEntryMode] = useState<PriceEntryMode>('unit');
  const [priceTotalRaw, setPriceTotalRaw] = useState('');
  const [priceTotalTyping, setPriceTotalTyping] = useState(false);
  const [measureEntryMode, setMeasureEntryMode] = useState<MeasureEntryMode>('per_unit');
  const [measurePerUnitRaw, setMeasurePerUnitRaw] = useState('');
  const [measurePerUnitTyping, setMeasurePerUnitTyping] = useState(false);
  const [measureTotalRaw, setMeasureTotalRaw] = useState('');
  const [measureTotalTyping, setMeasureTotalTyping] = useState(false);
  const [helpModal, setHelpModal] = useState<'credits' | 'markup' | 'costs' | 'roa' | null>(null);
  const [stockHelpCategory, setStockHelpCategory] = useState<StockCategory | null>(null);
  const [pdfCategories, setPdfCategories] = useState<PricingSegment[]>([]);
  const [dashboardScope, setDashboardScope] = useState<PricingSegment | 'geral'>('geral');
  const [dashboardProductId, setDashboardProductId] = useState('');
  const [recipeBaseVersion, setRecipeBaseVersion] = useState(0);
  const recipeScaleBaselineRef = useRef<{
    bom: BomLine[];
    productionQty: number;
  } | null>(null);
  const {
    workspace,
    updateWorkspace,
    upsertStock,
    removeStock,
    removeStocks,
    addStockMaterialShortfalls,
    addStockMaterialShortfallsForProduct,
    addAllWorkspaceMaterialShortfalls,
    replenishSingleStockItem,
    addStock,
    upsertCostExpense,
    removeCostExpense,
    updateSettings,
  } = usePricingModuleState({ selectedCompany, storageVersion });

  const editingStock = useMemo(
    () => workspace.stockItems.find((s) => s.id === editingStockId) ?? null,
    [workspace.stockItems, editingStockId],
  );

  const finishedProducts = useMemo(
    () => workspace.stockItems.filter((s) => s.category === 'produto_acabado'),
    [workspace.stockItems],
  );

  const hasUnscopedMaterials = useMemo(
    () =>
      workspace.stockItems.some(
        (s) =>
          isStockProductScopedCategory(s.category) && !s.stockScopeProductId,
      ),
    [workspace.stockItems],
  );

  const showProductStockScope =
    stockFilter === 'insumo' || stockFilter === 'materia_prima';

  const stockScopeProductName = useMemo(() => {
    if (stockProductScopeId === STOCK_PRODUCT_SCOPE_ALL) return 'Todos';
    if (stockProductScopeId === STOCK_PRODUCT_SCOPE_UNLINKED) return 'Sem produto acabado';
    const pa = finishedProducts.find((p) => p.id === stockProductScopeId);
    return pa?.name?.trim() || 'Produto acabado';
  }, [stockProductScopeId, finishedProducts]);

  const licitanteOptions = useMemo(
    () => listLicitanteInstitutions(workspace),
    [workspace],
  );

  const stockCreditsSummary = useMemo(
    () => computeStockCreditsSummary(workspace, creditSegmentFilter),
    [workspace, creditSegmentFilter],
  );

  const registerLicitanteInstitution = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const existing = workspace.licitanteInstitutions ?? [];
      const upper = trimmed.toUpperCase();
      if (existing.some((x) => x.toUpperCase() === upper)) return;
      updateWorkspace({
        ...workspace,
        licitanteInstitutions: [...existing, trimmed].sort((a, b) =>
          a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }),
        ),
      });
    },
    [workspace.licitanteInstitutions, updateWorkspace],
  );

  const showLicitanteFilter =
    stockFilter === 'produto_acabado' ||
    stockFilter === 'mercadoria' ||
    stockFilter === 'faltantes';

  useEffect(() => {
    if (!showProductStockScope) return;
    if (finishedProducts.length === 0 && !hasUnscopedMaterials) {
      setStockProductScopeId('');
      return;
    }
    const validIds = new Set<string>([
      STOCK_PRODUCT_SCOPE_ALL,
      ...finishedProducts.map((p) => p.id),
      STOCK_PRODUCT_SCOPE_UNLINKED,
    ]);
    if (!stockProductScopeId || !validIds.has(stockProductScopeId)) {
      setStockProductScopeId(STOCK_PRODUCT_SCOPE_ALL);
    }
    if (!legacyBulkAssignPaId || !finishedProducts.some((p) => p.id === legacyBulkAssignPaId)) {
      setLegacyBulkAssignPaId(finishedProducts[0]?.id ?? '');
    }
  }, [
    showProductStockScope,
    finishedProducts,
    hasUnscopedMaterials,
    stockProductScopeId,
    legacyBulkAssignPaId,
  ]);

  useEffect(() => {
    setEditingStockId(null);
    setSelectedStockIds([]);
  }, [stockFilter, stockProductScopeId]);

  useEffect(() => {
    if (mainTab !== 'estoque') setEditingStockId(null);
  }, [mainTab]);

  const workspaceForPricing = useMemo(() => {
    const zeros = new Map(workspace.stockItems.map((s) => [s.id, 0] as const));
    return workspaceWithRecipeDoubles(workspace, zeros);
  }, [workspace]);

  const pricingBreakdowns = useMemo(
    () => computePricingBreakdowns(workspaceForPricing),
    [workspaceForPricing],
  );

  const pricingDashboard = useMemo(
    () => computeDashboardSummary(pricingBreakdowns, workspaceForPricing),
    [pricingBreakdowns, workspaceForPricing],
  );

  const pricingDashboardBySegment = useMemo(
    () => computeDashboardBySegment(pricingBreakdowns, workspaceForPricing),
    [pricingBreakdowns, workspaceForPricing],
  );

  const dashboardBreakdownsInScope = useMemo(() => {
    if (dashboardScope === 'geral') return pricingBreakdowns;
    return pricingBreakdowns.filter((b) => b.category === dashboardScope);
  }, [dashboardScope, pricingBreakdowns]);

  useEffect(() => {
    if (dashboardScope === 'geral') {
      setDashboardProductId('');
      return;
    }
    setDashboardProductId((prev) => {
      if (prev && dashboardBreakdownsInScope.some((b) => b.productId === prev)) return prev;
      return dashboardBreakdownsInScope[0]?.productId ?? '';
    });
  }, [dashboardScope, dashboardBreakdownsInScope]);

  const activeDashboardBreakdownRows = useMemo(() => {
    if (dashboardScope === 'geral') return pricingBreakdowns;
    if (!dashboardProductId) return [];
    const row = pricingBreakdowns.find((b) => b.productId === dashboardProductId);
    return row ? [row] : [];
  }, [dashboardScope, dashboardProductId, pricingBreakdowns]);

  const activeDashboard = useMemo(
    () => computeDashboardFromBreakdownRows(activeDashboardBreakdownRows, workspaceForPricing),
    [activeDashboardBreakdownRows, workspaceForPricing],
  );

  const dashboardScopeLabel =
    dashboardScope === 'geral'
      ? 'Geral'
      : activeDashboard.selectedProductName
        ? `${PRICING_SEGMENT_LABELS[dashboardScope]} · ${activeDashboard.selectedProductName}`
        : PRICING_SEGMENT_LABELS[dashboardScope];

  const dashboardProductSelectLabel =
    dashboardScope === 'produto_acabado'
      ? 'Produto acabado'
      : dashboardScope === 'mercadoria'
        ? 'Mercadoria'
        : 'Serviço';

  const pricingRoaRanking = useMemo(
    () => sortByRentability(pricingBreakdowns, true),
    [pricingBreakdowns],
  );

  const pricingParamsPreview = useMemo(() => {
    const sample = pricingBreakdowns.find((b) => b.materialCost > 0);
    if (!sample) return null;
    const cost = sample.totalUnitCost;
    const settings = workspace.settings;
    const sale = resolveSellingUnitPrice(cost, settings);
    return { cost, sale, name: sample.name };
  }, [pricingBreakdowns, workspace.settings]);

  const costKindTotals = useMemo(
    () => computeCostExpenseKindTotals(workspace.costExpenses, costSegmentFilter),
    [workspace.costExpenses, costSegmentFilter],
  );

  useEffect(() => {
    if (!editingStockId) {
      recipeScaleBaselineRef.current = null;
      return;
    }
    const item = workspace.stockItems.find((s) => s.id === editingStockId);
    if (!item || item.category !== 'produto_acabado' || !item.useBom) {
      recipeScaleBaselineRef.current = null;
      return;
    }
    const baseBom =
      item.recipeQuantityBaseBom && item.recipeQuantityBaseBom.length > 0
        ? cloneBomLines(item.recipeQuantityBaseBom)
        : cloneBomLines(item.bom);
    const baseQty =
      item.recipeQuantityBaseProductionQty != null && item.recipeQuantityBaseProductionQty > 0
        ? item.recipeQuantityBaseProductionQty
        : resolveRecipeYieldQty(item);
    recipeScaleBaselineRef.current = { bom: baseBom, productionQty: baseQty };
    setRecipeBaseVersion((v) => v + 1);
    // Só leitura do cadastro salvo — não reescreve BOM/rendimento/qtd do PA ao abrir a aba.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingStockId]);

  const editingStockView = useMemo(() => {
    if (!editingStock) return null;
    const base = recipeScaleBaselineRef.current;
    if (!base || editingStock.category !== 'produto_acabado' || !editingStock.useBom) {
      return editingStock;
    }
    return {
      ...editingStock,
      bom: cloneBomLines(base.bom),
    };
  }, [editingStock, recipeBaseVersion]);

  /** PA com BOM — insumo/MP e listas veem consumo atualizado (PA em edição usa qtd/mês e composição ao vivo). */
  const stockItemsForBomUsage = useMemo(() => {
    const stockView = editingStockView;
    const editingLive =
      editingStockId && editingStock && stockView
        ? {
            ...editingStock,
            bom: stockView.bom,
            recipeYieldQty: stockView.recipeYieldQty ?? editingStock.recipeYieldQty,
            monthlyQty: editingStock.monthlyQty,
          }
        : null;
    return buildStockItemsForBomUsage(workspace.stockItems, {
      editingProductId: editingStockId,
      editingProductLive: editingLive,
    });
  }, [workspace.stockItems, editingStockId, editingStock, editingStockView, recipeBaseVersion]);

  const bomSources = useMemo(() => {
    if (editingStock?.category === 'produto_acabado') {
      return bomSourcesForProduct(workspace.stockItems, editingStock.id);
    }
    return workspace.stockItems.filter(
      (s) => s.category === 'insumo' || s.category === 'materia_prima',
    );
  }, [workspace.stockItems, editingStock]);

  useEffect(() => {
    const item = editingStockId
      ? workspace.stockItems.find((s) => s.id === editingStockId)
      : null;
    setPriceEntryMode(item?.priceInputMode === 'total' ? 'total' : 'unit');
    setMeasureEntryMode('per_unit');
    setUnitPriceTyping(false);
    setPriceTotalTyping(false);
    setMeasurePerUnitTyping(false);
    setMeasureTotalTyping(false);
  }, [editingStockId]);

  useEffect(() => {
    if (!unitPriceTyping) {
      const value = editingStock ? resolveStockUnitPriceFromPurchase(editingStock) : 0;
      setUnitPriceRaw(formatStockNumberForInput(value, 6));
    }
  }, [editingStock, unitPriceTyping]);

  useEffect(() => {
    if (!priceTotalTyping) {
      const value = editingStock ? stockPurchaseTotal(editingStock) : 0;
      setPriceTotalRaw(formatStockNumberForInput(value, 2));
    }
  }, [editingStock, priceTotalTyping]);

  useEffect(() => {
    if (!measurePerUnitTyping) {
      const value = editingStock?.measureQuantity ?? 0;
      setMeasurePerUnitRaw(formatStockNumberForInput(value, 6));
    }
  }, [editingStock, measurePerUnitTyping]);

  useEffect(() => {
    if (!measureTotalTyping) {
      const value = editingStock ? catalogStockMeasure(editingStock) : 0;
      setMeasureTotalRaw(formatStockNumberForInput(value, 6));
    }
  }, [editingStock, measureTotalTyping]);

  const valorMercadoriaSugerido = useMemo(() => {
    const mercadorias = pricingBreakdowns.filter((b) => b.category === 'mercadoria');
    if (mercadorias.length === 0) return 0;
    const top = [...mercadorias].sort((a, b) => b.finalPrice - a.finalPrice)[0];
    return top?.finalPrice > 0 ? top.finalPrice : top?.materialCost ?? 0;
  }, [pricingBreakdowns]);

  const filteredBreakdowns = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return pricingBreakdowns.filter((b) => {
      if (pricingFilter !== 'all' && b.category !== pricingFilter) return false;
      if (!needle) return true;
      return b.name.toLowerCase().includes(needle);
    });
  }, [pricingBreakdowns, pricingFilter, search]);

  const exportPdf = (section: PricingPdfSection) => {
    const dreGeral = computePricingDre(pricingBreakdowns, workspace, 'geral');
    downloadPricingPdf({
      companyName: selectedCompany,
      section,
      categories: pdfCategories.length > 0 ? pdfCategories : undefined,
      breakdowns: pricingBreakdowns,
      dashboard: pricingDashboard,
      workspace: {
        stockItems: workspace.stockItems,
        serviceItems: workspace.serviceItems,
        settings: workspace.settings,
        productOverrides: workspace.productOverrides,
      },
      stockRows: workspace.stockItems.map((s) => ({
        name: s.name,
        category: STOCK_CATEGORY_LABELS[s.category],
        package: `${s.unitsPurchased || 0} un × ${s.measureQuantity || 0} ${s.packageUnit} (${stockTotalMeasure(s)} ${s.packageUnit})`,
        purchase: formatCurrency(s.purchasePrice),
      })),
      costRows: workspace.costExpenses.map((c) => ({
        type: `${c.type === 'custo' ? 'Custo' : 'Despesa'} · ${PRICING_SEGMENT_LABELS[c.segment]} · ${COST_EXPENSE_KIND_LABELS[c.kind === 'variavel' ? 'variavel' : 'fixo']}`,
        name: c.name,
        amount: formatCurrency(c.monthlyAmount),
      })),
      creditRows: workspace.credits.map((c) => ({
        name: c.name,
        kind: c.creditKind,
        amount: formatCurrency(c.monthlyAmount),
        segments: c.applicableSegments.map((s) => PRICING_SEGMENT_LABELS[s]).join(', ') || 'Todos',
      })),
      dreRows: dreGeral.lines.map((line) => ({
        label: line.label,
        value: formatCurrency(Math.abs(line.value)),
      })),
    });
  };

  const PdfExportBar = ({ section }: { section: PricingPdfSection }) => (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[9px] font-bold uppercase opacity-50">Exportar PDF:</span>
      {PRICING_SEGMENT_FILTERS.map((cat) => (
        <label key={cat} className="flex items-center gap-1 text-[9px] font-mono">
          <input aria-label="Exportar PDF:"
            type="checkbox"
            checked={pdfCategories.includes(cat)}
            onChange={(e) =>
              setPdfCategories((prev) =>
                e.target.checked ? [...prev, cat] : prev.filter((c) => c !== cat),
              )
            }
          />
          {PRICING_SEGMENT_LABELS[cat]}
        </label>
      ))}
      <button type="button" onClick={() => exportPdf(section)} className="technical-button-primary text-[9px] py-1 px-3 flex items-center gap-1">
        <Download size={12} /> PDF
      </button>
    </div>
  );

  const renderDashboard = () => (
    <div className="space-y-6">
      <PdfExportBar section="dashboard" />

      <div className="cf-scroll-tabs flex flex-wrap gap-1 border border-brand-border p-1 bg-brand-sidebar/20">
        {(
          [
            { id: 'geral' as const, label: 'Geral' },
            ...PRICING_SEGMENT_FILTERS.map((seg) => ({
              id: seg,
              label: PRICING_SEGMENT_LABELS[seg],
            })),
          ] as const
        ).map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setDashboardScope(id)}
            className={cn(
              'px-3 py-1.5 text-[9px] font-black uppercase tracking-wide shrink-0',
              dashboardScope === id
                ? 'bg-brand-border text-brand-bg shadow-[2px_2px_0_0_rgba(0,0,0,0.15)]'
                : 'opacity-55 hover:opacity-100',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="technical-panel p-4 shadow-[3px_3px_0_0_#141414]">
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end justify-between gap-3 mb-4">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest mb-1">
              Dashboard — {dashboardScopeLabel}
            </p>
            <p className="text-[8px] font-bold uppercase opacity-45">
              Card vermelho = custos + despesas cadastrados (sempre iguais) + material mensal total
              (un. × qtd/mês). Nas subabas, só o material muda ao trocar produto/mercadoria/serviço.
            </p>
          </div>
          {dashboardScope !== 'geral' ? (
            <label className="flex flex-col gap-1 min-w-[12rem] w-full sm:w-auto shrink-0">
              <span className={CF_LABEL}>{dashboardProductSelectLabel}</span>
              <select
                aria-label={`Selecionar ${dashboardProductSelectLabel.toLowerCase()} no dashboard`}
                className={CF_SELECT_WIDE_RESPONSIVE}
                value={dashboardProductId}
                onChange={(e) => setDashboardProductId(e.target.value)}
                disabled={dashboardBreakdownsInScope.length === 0}
              >
                {dashboardBreakdownsInScope.length === 0 ? (
                  <option value="">Nenhum item cadastrado</option>
                ) : (
                  dashboardBreakdownsInScope.map((b) => (
                    <option key={b.productId} value={b.productId}>
                      {b.name?.trim() || 'Sem nome'}
                    </option>
                  ))
                )}
              </select>
            </label>
          ) : null}
        </div>
        {dashboardScope !== 'geral' && dashboardBreakdownsInScope.length === 0 ? (
          <p className="text-[10px] uppercase text-slate-400 font-bold mb-4">
            Cadastre um item neste segmento para ver o dashboard detalhado.
          </p>
        ) : null}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {[
            {
              label: 'Custos + Despesas + Material (mês)',
              value: activeDashboard.totalConsolidatedCosts,
              tone: 'text-red-700',
            },
            {
              label: 'Receita projetada',
              value: activeDashboard.totalMonthlyRevenue,
              tone: 'text-blue-700',
            },
            {
              label: activeDashboard.isProfit ? 'Lucro projetado' : 'Prejuízo projetado',
              value: activeDashboard.totalMonthlyProfit,
              tone: activeDashboard.isProfit ? 'text-emerald-700' : 'text-red-800',
            },
          ].map((card) => (
            <div key={card.label} className="border border-brand-border/20 p-4">
              <p className="text-[9px] font-black uppercase tracking-widest opacity-50">{card.label}</p>
              <p className={cn('text-xl font-black mt-2', card.tone)}>{formatCurrency(card.value)}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-[10px] font-mono border-t border-brand-border/15 pt-4">
          <div className="flex justify-between gap-2">
            <span className="opacity-50">Custos (cadastrados)</span>
            <span className="font-bold">{formatCurrency(activeDashboard.totalCosts)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="opacity-50">Despesas (cadastradas)</span>
            <span className="font-bold">{formatCurrency(activeDashboard.totalExpenses)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="opacity-50">
              {dashboardScope === 'geral' ? 'Custos rateados (todos)' : 'Custos rateados (item)'}
            </span>
            <span className="font-bold">{formatCurrency(activeDashboard.productAllocatedCosts)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="opacity-50">
              {dashboardScope === 'geral' ? 'Despesas rateadas (todos)' : 'Despesas rateadas (item)'}
            </span>
            <span className="font-bold">{formatCurrency(activeDashboard.productAllocatedExpenses)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="opacity-50">Material total (mês)</span>
            <span className="font-bold">{formatCurrency(activeDashboard.totalMaterialCost)}</span>
          </div>
          {activeDashboard.materialUnitCost != null ? (
            <div className="flex justify-between gap-2">
              <span className="opacity-50">Material (R$/un.)</span>
              <span className="font-bold">{formatCurrency(activeDashboard.materialUnitCost)}</span>
            </div>
          ) : null}
          {activeDashboard.acquisitionUnitCost != null ? (
            <div className="flex justify-between gap-2">
              <span className="opacity-50">Aquisição unit. (R$/un.)</span>
              <span className="font-bold">{formatCurrency(activeDashboard.acquisitionUnitCost)}</span>
            </div>
          ) : null}
          <div className="flex justify-between gap-2">
            <span className="opacity-50">Valor em estoque (ref.)</span>
            <span>{formatCurrency(activeDashboard.totalStockInventory)}</span>
          </div>
          <div className="flex justify-between gap-2 text-emerald-700">
            <span className="opacity-70">Créditos</span>
            <span>-{formatCurrency(activeDashboard.totalCredits)}</span>
          </div>
        </div>
      </div>

      {dashboardScope === 'geral' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {pricingDashboardBySegment.map((seg) => (
            <button
              key={seg.segment}
              type="button"
              onClick={() => setDashboardScope(seg.segment)}
              className="technical-panel p-5 shadow-[3px_3px_0_0_#141414] space-y-3 text-left hover:bg-brand-sidebar/10 transition-colors"
            >
              <div className="flex items-center justify-between border-b border-brand-border/20 pb-2">
                <p className="text-[10px] font-black uppercase tracking-widest">{seg.label}</p>
                <span className="text-[9px] font-mono opacity-50">{seg.itemCount} item(ns)</span>
              </div>
              <div className="space-y-2 text-[10px] font-mono">
                <div className="flex justify-between font-black text-red-700">
                  <span>Custo total</span>
                  <span>{formatCurrency(seg.totalConsolidatedCosts)}</span>
                </div>
                <div className="flex justify-between opacity-70">
                  <span>Custos + despesas rateados</span>
                  <span>
                    {formatCurrency(seg.productAllocatedCosts + seg.productAllocatedExpenses)}
                  </span>
                </div>
                <div className="flex justify-between opacity-70">
                  <span>Material (mês)</span>
                  <span>{formatCurrency(seg.totalMaterialCost)}</span>
                </div>
                <div className="flex justify-between font-bold pt-2 border-t border-brand-border/10">
                  <span>Receita/mês</span>
                  <span>{formatCurrency(seg.totalMonthlyRevenue)}</span>
                </div>
                <div
                  className={cn(
                    'flex justify-between font-black',
                    seg.isProfit ? 'text-emerald-700' : 'text-red-700',
                  )}
                >
                  <span>Lucro/mês</span>
                  <span>{formatCurrency(seg.totalMonthlyProfit)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );

  const preserveRecipeBomBaseline = () => {
    const baselineBom = recipeScaleBaselineRef.current
      ? cloneBomLines(recipeScaleBaselineRef.current.bom)
      : null;
    if (recipeScaleBaselineRef.current && baselineBom) {
      recipeScaleBaselineRef.current = {
        ...recipeScaleBaselineRef.current,
        bom: baselineBom,
      };
      setRecipeBaseVersion((v) => v + 1);
    }
  };

  /** Repõe só estoque (insumo/MP); composição do PA permanece a que você digitou. */
  const replenishStockShortfalls = (
    shortages: Parameters<typeof addStockMaterialShortfalls>[0],
  ) => {
    addStockMaterialShortfalls(shortages);
    preserveRecipeBomBaseline();
  };

  /** Repõe só insumo/MP listados no aviso deste produto acabado (composição + qtd/mês). */
  const replenishCurrentProductShortfalls = (
    product: StockItem,
    bomOverride: BomLine[],
  ) => {
    addStockMaterialShortfallsForProduct(product, { bomOverride });
    preserveRecipeBomBaseline();
  };

  const patchEditingStock = (patch: Partial<StockItem>) => {
    if (!editingStock) return;
    const next: StockItem = { ...editingStock, ...patch };
    if (patch.bom !== undefined) {
      const baseBom = cloneBomLines(next.bom);
      const yieldQty = resolveRecipeYieldQty(next) > 0 ? resolveRecipeYieldQty(next) : 1;
      recipeScaleBaselineRef.current = { bom: baseBom, productionQty: yieldQty };
      setRecipeBaseVersion((v) => v + 1);
      next.recipeQuantityBaseBom = baseBom;
      next.recipeQuantityBaseProductionQty = yieldQty;
      next.recipeYieldQty = yieldQty;
    }
    if (patch.monthlyQty !== undefined || patch.recipeYieldQty !== undefined) {
      setRecipeBaseVersion((v) => v + 1);
    }
    upsertStock(next);
  };

  const assignStockItemScope = useCallback(
    (item: StockItem, productId: string | undefined) => {
      if (!isStockProductScopedCategory(item.category)) return;
      upsertStock({ ...item, stockScopeProductId: productId });
      if (productId) setStockProductScopeId(productId);
    },
    [upsertStock],
  );

  const assignLegacyItemsToProduct = useCallback(
    (itemsToAssign: StockItem[], productId: string) => {
      if (!productId) return;
      for (const item of itemsToAssign) {
        if (isStockProductScopedCategory(item.category) && !item.stockScopeProductId) {
          upsertStock({ ...item, stockScopeProductId: productId });
        }
      }
      setStockProductScopeId(productId);
      setSelectedStockIds([]);
    },
    [upsertStock],
  );

  const assignSelectedLegacyToProduct = useCallback(
    (itemsToAssign: StockItem[], productId: string, selectedIds: string[]) => {
      if (!productId || selectedIds.length === 0) return;
      const selected = new Set(selectedIds);
      assignLegacyItemsToProduct(
        itemsToAssign.filter((item) => selected.has(item.id)),
        productId,
      );
    },
    [assignLegacyItemsToProduct],
  );

  const deleteStockItems = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      removeStocks(ids);
      if (editingStockId && ids.includes(editingStockId)) setEditingStockId(null);
      setSelectedStockIds((prev) => prev.filter((id) => !ids.includes(id)));
    },
    [removeStocks, editingStockId],
  );

  const renderStockEditor = () => {
    if (!editingStock) {
      return (
        <p className="text-[10px] font-bold uppercase text-slate-400 py-12 text-center">
          Selecione um item ou clique em Novo para cadastrar.
        </p>
      );
    }

    const stockView = editingStockView ?? editingStock;
    const isBomProduct = editingStock.category === 'produto_acabado';
    const isMercadoria = editingStock.category === 'mercadoria';
    const usesBomComposition = isBomProduct && editingStock.useBom;
    const stockById = new Map(workspace.stockItems.map((s) => [s.id, s]));
    const baseForMaterial =
      recipeScaleBaselineRef.current && usesBomComposition
        ? { ...editingStock, bom: cloneBomLines(recipeScaleBaselineRef.current.bom) }
        : editingStock;
    const bomMaterial = isBomProduct
      ? computeMaterialCost(baseForMaterial, stockById)
      : null;
    const recipeYieldForBom = resolveRecipeYieldQty(stockView);
    const bomMaterialTotal = usesBomComposition
      ? compositionMaterialTotalFromBom(stockView.bom, stockById)
      : 0;
    const bomUnitCost = usesBomComposition
      ? materialUnitCostFromCompositionTotal(bomMaterialTotal, recipeYieldForBom)
      : bomMaterial
        ? bomMaterial.cost
        : 0;
    const bomSummary = usesBomComposition
      ? compositionCostSummary(stockView.bom, stockById, recipeYieldForBom)
      : null;
    const bomMaterialCoverage =
      usesBomComposition && editingStock
        ? validateBomMaterialCoverage(
            {
              ...editingStock,
              bom: stockView.bom,
              recipeYieldQty: stockView.recipeYieldQty,
            },
            stockItemsForBomUsage,
          )
        : null;
    const unitsPurchased = editingStock.unitsPurchased > 0 ? editingStock.unitsPurchased : 0;
    const measureQuantity = editingStock.measureQuantity > 0 ? editingStock.measureQuantity : 0;
    const cadastroPriceTotalBase = catalogPriceTotalDisplay(
      editingStock,
      priceEntryMode,
      unitPriceRaw,
      priceTotalRaw,
    );
    const cadastroPriceTotal = roundStockMoney(
      cadastroPriceTotalBase * stockFreightMultiplier(editingStock),
      2,
    );
    const cadastroUnitPriceBase = catalogUnitPriceDisplay(
      editingStock,
      priceEntryMode,
      unitPriceRaw,
      priceTotalRaw,
    );
    const cadastroUnitPrice = roundStockMoney(
      cadastroUnitPriceBase * stockFreightMultiplier(editingStock),
      6,
    );
    const measureUnit = stockMeasureUnit(editingStock.packageUnit);
    const measureLabel = measureLabelForUnit(measureUnit);
    const isMeasureCategory =
      editingStock.category === 'insumo' || editingStock.category === 'materia_prima';

    return (
      <div className="space-y-3 p-2 sm:p-3 border border-brand-border/30 bg-brand-sidebar/10">
        {isMeasureCategory && finishedProducts.length > 0 && (
          <label className={CF_FIELD_COL}>
            <span className={CF_LABEL}>
              Vincular a produto acabado
              {!editingStock.stockScopeProductId ? (
                <span className="ml-1 normal-case font-mono text-[8px] text-amber-900">
                  (legado — escolha um PA)
                </span>
              ) : null}
            </span>
            <select
              aria-label="Vincular a produto acabado"
              className={CF_SELECT_RESPONSIVE}
              value={editingStock.stockScopeProductId ?? ''}
              onChange={(e) => {
                const next = e.target.value || undefined;
                assignStockItemScope(editingStock, next);
              }}
            >
              <option value="">Compartilhado (legado)</option>
              {finishedProducts.map((pa) => (
                <option key={pa.id} value={pa.id}>
                  {pa.name?.trim() || 'Sem nome'}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className={CF_FIELD_ROW}>
          <label className={CF_FIELD_COL}>
            <span className={CF_LABEL}>Nome</span>
            <input aria-label="Nome" className={CF_INPUT_MED} value={editingStock.name} onChange={(e) => patchEditingStock({ name: e.target.value })} />
          </label>
          <label className={CF_FIELD_COL}>
            <span className={CF_LABEL}>Código SKU</span>
            <input aria-label="Código SKU" className={CF_INPUT_SHORT} value={editingStock.sku} onChange={(e) => patchEditingStock({ sku: e.target.value })} />
          </label>
          <label className={CF_FIELD_COL}>
            <span className={CF_LABEL}>Frete (%)</span>
            <FreeNumericInput
              aria-label="Frete percentual sobre compra"
              className={CF_INPUT_NUM}
              placeholder="0"
              value={editingStock.freightPercent ?? 0}
              onChange={(freightPercent) =>
                patchEditingStock({ freightPercent: Math.max(0, freightPercent) })
              }
            />
          </label>
          {isBomProduct && usesBomComposition && (
            <>
              <label className={CF_FIELD_COL}>
                <span className={CF_LABEL}>Rendimento (un./receita)</span>
                <FreeNumericInput aria-label="Rendimento (un./receita)"
                  inputMode="numeric"
                  className={CF_INPUT_NUM}
                  placeholder="7"
                  value={stockView.recipeYieldQty ?? 1}
                  onChange={(recipeYieldQty) => {
                    const yieldQty = recipeYieldQty > 0 ? recipeYieldQty : 1;
                    if (recipeScaleBaselineRef.current) {
                      recipeScaleBaselineRef.current = {
                        ...recipeScaleBaselineRef.current,
                        productionQty: yieldQty,
                      };
                      setRecipeBaseVersion((v) => v + 1);
                    }
                    patchEditingStock({
                      recipeYieldQty: yieldQty,
                      recipeQuantityBaseProductionQty: yieldQty,
                    });
                  }}
                />
              </label>
              <label className={CF_FIELD_COL}>
                <span className={CF_LABEL}>Qtd/mês (vendas)</span>
                <FreeNumericInput aria-label="Qtd/mês (vendas)"
                  inputMode="numeric"
                  className={CF_INPUT_NUM}
                  placeholder="100"
                  value={stockView.monthlyQty}
                  onChange={(monthlyQty) => patchEditingStock({ monthlyQty })}
                />
              </label>
            </>
          )}
        </div>
        {isBomProduct && usesBomComposition && monthlyQtyLooksLikeRecipeYield(editingStock) && (
          <p className="text-[9px] font-bold uppercase text-amber-900 bg-amber-50 border border-amber-700/40 px-2 py-1.5">
            Qtd/mês ({editingStock.monthlyQty}) está igual ao rendimento ({resolveRecipeYieldQty(editingStock)}).
            Informe quantos pudins vende no mês (ex.: 100) — senão os custos fixos ficam altos demais por unidade.
          </p>
        )}
        {bomMaterialCoverage && !bomMaterialCoverage.ok && bomMaterialCoverage.shortages.length > 0 && (
          <div
            className="flex flex-col h-[220px] min-h-[220px] max-h-[220px] shrink-0 text-[9px] font-bold uppercase text-red-900 bg-red-50 border border-red-700/40 overflow-hidden"
            role="alert"
          >
            <div className="shrink-0 px-2 pt-2 pb-1 space-y-1.5">
              <p className="normal-case">
                Com o estoque atual dá para fazer até{' '}
                <span className="font-black">{bomMaterialCoverage.maxFinishedFromStock} un.</span> de produto
                acabado
                {bomMaterialCoverage.monthlyQty > 0
                  ? ` (meta do mês: ${bomMaterialCoverage.monthlyQty} un.)`
                  : null}
                .
              </p>
              <p>
                Para {bomMaterialCoverage.monthlyQty > 0
                  ? `${bomMaterialCoverage.monthlyQty} un./mês (${bomMaterialCoverage.batchesPerMonth.toFixed(2)} receitas de ${bomMaterialCoverage.batchYield} un.)`
                  : `rendimento de ${bomMaterialCoverage.batchYield} un./receita`}
                , faltam insumos e matéria-prima no estoque (só repõe estoque; a composição não muda). Cadastre mais
                estoque ou reduza a qtd/mês:
              </p>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2">
              <ul className="list-disc pl-4 space-y-1 normal-case font-mono text-[8px]">
                {bomMaterialCoverage.shortages.map((s) => (
                  <li key={s.stockItemId}>
                    <span>
                      {s.name} ({STOCK_CATEGORY_LABELS[s.category]}): na receita{' '}
                      {s.perRecipeLabel ?? '—'} · no mês precisa {s.requiredLabel}, disponível {s.availableLabel} —
                      faltam {s.shortfallLabel}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="shrink-0 px-2 py-2 border-t border-red-700/25 bg-red-50">
              <button
                type="button"
                className="technical-button text-[8px] py-1 px-2 w-full normal-case"
                onClick={(e) => {
                  e.stopPropagation();
                  replenishCurrentProductShortfalls(
                    {
                      ...editingStock,
                      bom: stockView.bom,
                      recipeYieldQty: stockView.recipeYieldQty ?? editingStock.recipeYieldQty,
                      monthlyQty: editingStock.monthlyQty,
                    },
                    stockView.bom,
                  );
                }}
              >
                Acrescentar
              </button>
            </div>
          </div>
        )}
          {!isBomProduct && (
            <div className="space-y-0.5">
              <div className={CF_FIELD_ROW}>
                <div className={CF_FIELD_COL_CONTROLS}>
                  <span className={CF_LABEL}>Valor (R$)</span>
                  <div className={CF_FIELD_INLINE}>
                    <CfSegmentedControl<PriceEntryMode>
                      aria-label="Modo de valor"
                      value={priceEntryMode}
                      onChange={(mode) => {
                        if (!editingStock) return;
                        setPriceEntryMode(mode);
                        setUnitPriceTyping(false);
                        setPriceTotalTyping(false);
                        const units =
                          editingStock.unitsPurchased > 0 ? editingStock.unitsPurchased : 0;
                        if (mode === 'total') {
                          const purchase =
                            stockPurchaseTotal(editingStock) > 0
                              ? stockPurchaseTotal(editingStock)
                              : units > 0 && editingStock.unitPrice > 0
                                ? editingStock.unitPrice * units
                                : editingStock.purchasePrice;
                          const priced = patchStockPricing(editingStock, {
                            purchasePrice: purchase,
                            priceInputMode: 'total',
                          });
                          patchEditingStock(priced);
                          setPriceTotalRaw(
                            formatStockNumberForInput(
                              priced.purchasePrice ?? purchase,
                              2,
                            ),
                          );
                        } else {
                          const priced = patchStockPricing(editingStock, {
                            unitPrice: resolveStockUnitPriceFromPurchase(editingStock),
                            priceInputMode: 'unit',
                          });
                          patchEditingStock(priced);
                          setUnitPriceRaw(
                            formatStockNumberForInput(priced.unitPrice ?? 0, 6),
                          );
                        }
                      }}
                      options={[
                        { value: 'unit', label: 'R$/un', title: 'Unitário (R$/un)' },
                        { value: 'total', label: 'Total R$', title: 'Total (R$)' },
                      ]}
                    />
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label="Preço unitário ou total do produto"
                      className={CF_INPUT_MONEY}
                      value={priceEntryMode === 'unit' ? unitPriceRaw : priceTotalRaw}
                      placeholder={priceEntryMode === 'unit' ? '12,50' : '150,00'}
                      onFocus={() => {
                        if (priceEntryMode === 'unit') setUnitPriceTyping(true);
                        else setPriceTotalTyping(true);
                      }}
                      onChange={(e) => {
                        const raw = sanitizeNumericDraft(e.target.value);
                        if (priceEntryMode === 'unit') {
                          setUnitPriceRaw(raw);
                        } else {
                          setPriceTotalRaw(raw);
                        }
                      }}
                      onBlur={() => {
                        setUnitPriceTyping(false);
                        setPriceTotalTyping(false);
                        const raw = priceEntryMode === 'unit' ? unitPriceRaw : priceTotalRaw;
                        if (priceEntryMode === 'unit') {
                          patchEditingStock(
                            patchStockPricing(editingStock, {
                              unitPrice: parseLocaleNumber(raw),
                              priceInputMode: 'unit',
                            }),
                          );
                        } else {
                          patchEditingStock(
                            patchStockPricing(editingStock, {
                              purchasePrice: parseLocaleNumber(raw),
                              priceInputMode: 'total',
                            }),
                          );
                        }
                      }}
                    />
                  </div>
                </div>
                <label className={CF_FIELD_COL}>
                  <span className={CF_LABEL}>Qtd comprada (un)</span>
                  <FreeNumericInput aria-label="Qtd comprada (un)"
                    inputMode="numeric"
                    className={CF_INPUT_NUM}
                    placeholder="24"
                    value={unitsPurchased}
                    hideZeroWhenBlurred={unitsPurchased <= 0}
                    onChange={(units) => {
                      const nextUnits = units < 0 ? 0 : units;
                      if (measureEntryMode === 'total') {
                        const total = parseLocaleNumber(measureTotalRaw, 0);
                        if (total > 0 && nextUnits > 0) {
                          patchEditingStock(
                            patchStockPurchaseAndMeasure(
                              editingStock,
                              { unitsPurchased: nextUnits },
                              { measureQuantity: total / nextUnits },
                            ),
                          );
                          return;
                        }
                      }
                      patchEditingStock(
                        patchStockPurchaseAndMeasure(editingStock, { unitsPurchased: nextUnits }),
                      );
                    }}
                  />
                </label>
                {isMercadoria ? (
                  <label className={CF_FIELD_COL}>
                    <span className={CF_LABEL}>Qtd/mês (vendas)</span>
                    <FreeNumericInput aria-label="Qtd/mês (vendas)"
                      inputMode="numeric"
                      className={CF_INPUT_NUM}
                      placeholder="10"
                      value={stockView.monthlyQty}
                      onChange={(monthlyQty) => patchEditingStock({ monthlyQty })}
                    />
                  </label>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <StockInfoCard
                  title="Total (R$)"
                  value={
                    cadastroPriceTotal > 0 ? formatCurrency(cadastroPriceTotal) : null
                  }
                  hint={
                    priceEntryMode === 'unit' && unitsPurchased > 0 && cadastroUnitPrice > 0
                      ? `${formatCurrency(cadastroUnitPrice)}/un × ${unitsPurchased} un`
                      : priceEntryMode === 'total' && unitsPurchased > 0 && cadastroPriceTotal > 0
                        ? `${formatCurrency(cadastroPriceTotal)} ÷ ${unitsPurchased} un = ${formatCurrency(cadastroUnitPrice)}/un`
                        : undefined
                  }
                />
              </div>
            </div>
          )}
          {isBomProduct && (
            <div className="md:col-span-2 space-y-3 border border-brand-border/20 bg-white/50 px-3 py-3">
              <p className="text-[9px] font-black uppercase opacity-50">Como informar o custo do produto?</p>
              <div className="flex flex-wrap gap-1 border border-brand-border p-1 bg-brand-sidebar/10">
                <button
                  type="button"
                  onClick={() => patchEditingStock({ useBom: true })}
                  className={cn(
                    'flex-1 min-w-[140px] px-3 py-1.5 text-[9px] font-bold uppercase',
                    usesBomComposition ? 'bg-brand-border text-brand-bg' : 'opacity-60 hover:opacity-100',
                  )}
                >
                  Composição (insumos / MP)
                </button>
                <button
                  type="button"
                  onClick={() => patchEditingStock({ useBom: false })}
                  className={cn(
                    'flex-1 min-w-[140px] px-3 py-1.5 text-[9px] font-bold uppercase',
                    !usesBomComposition ? 'bg-brand-border text-brand-bg' : 'opacity-60 hover:opacity-100',
                  )}
                >
                  Custo manual (sem estoque)
                </button>
              </div>
              {usesBomComposition ? (
                <div className="space-y-2">
                  {stockView.bom.map((line, idx) => {
                    const lineCost = bomLineCost(
                      stockById,
                      line.quantity,
                      line.unit,
                      line.stockItemId,
                    );
                    return (
                      <div key={idx} className={`${CF_FIELD_ROW} items-center`}>
                        <select aria-label="Insumo da composição" className="flex-1 min-w-[140px] border border-brand-border px-2 py-1.5 text-[10px] font-mono" value={line.stockItemId} onChange={(e) => {
                          const bom = [...stockView.bom];
                          const src = stockById.get(e.target.value);
                          bom[idx] = {
                            ...bom[idx],
                            stockItemId: e.target.value,
                            unit: defaultBomUnitForStock(src),
                          };
                          patchEditingStock({ bom });
                        }}>
                          <option value="">Selecione...</option>
                          {bomSources.map((s) => <option key={s.id} value={s.id}>{s.name} ({STOCK_CATEGORY_LABELS[s.category]})</option>)}
                        </select>
                        <FreeNumericInput
                          aria-label="Quantidade do insumo na composição"
                          className={`${CF_INPUT_NUM} w-[64px]`}
                          value={line.quantity}
                          onChange={(quantity) => {
                            const bom = [...stockView.bom];
                            bom[idx] = { ...bom[idx], quantity };
                            patchEditingStock({ bom });
                          }}
                        />
                        <select
                          aria-label="Unidade de medida do insumo"
                          className={`${CF_SELECT_MEASURE} min-w-[88px]`}
                          value={line.unit}
                          title="Mesmas unidades de insumo/MP: cm, m, L, ml, kg, g + un"
                          onChange={(e) => {
                            const bom = [...stockView.bom];
                            bom[idx] = { ...bom[idx], unit: e.target.value as MeasureUnit };
                            patchEditingStock({ bom });
                          }}
                        >
                          {BOM_LINE_UNIT_OPTIONS.map((u) => (
                            <option key={u} value={u}>
                              {MEASURE_UNIT_LABELS[u]}
                            </option>
                          ))}
                        </select>
                        <span className="text-[10px] font-mono font-black tabular-nums min-w-[72px] text-right">
                          {lineCost > 0 ? formatCurrency(lineCost) : '—'}
                        </span>
                        <button type="button" title="Remover insumo" className="p-1.5 border border-red-300 text-red-700" onClick={() => patchEditingStock({ bom: stockView.bom.filter((_, i) => i !== idx) })}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    className="technical-button text-[9px] py-1 px-2"
                    onClick={() =>
                      patchEditingStock({
                        bom: [...stockView.bom, { stockItemId: '', quantity: 0, unit: 'un' }],
                      })
                    }
                  >
                    + Insumo na composição
                  </button>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <StockInfoCard
                      compact
                      title="Qtd. receita (rendimento)"
                      value={
                        bomSummary && bomSummary.recipeYieldQty > 0
                          ? `${bomSummary.recipeYieldQty} un.`
                          : '—'
                      }
                      hint="Unidades que esta receita produz por lote"
                    />
                    <StockInfoCard
                      compact
                      title="Custo material total (receita)"
                      value={bomMaterialTotal > 0 ? formatCurrency(bomMaterialTotal) : '—'}
                      hint={
                        bomSummary
                          ? `Soma das linhas da composição (${stockView.bom.filter((l) => l.stockItemId).length} itens)`
                          : undefined
                      }
                    />
                    <StockInfoCard
                      compact
                      title="Custo material (1 un.)"
                      value={bomUnitCost > 0 ? formatCurrency(bomUnitCost) : '—'}
                      hint={
                        bomSummary && bomMaterialTotal > 0
                          ? `${formatCurrency(bomMaterialTotal)} ÷ ${bomSummary.recipeYieldQty} un. = precificação`
                          : 'Total da receita ÷ rendimento'
                      }
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className={CF_FIELD_ROW}>
                    <label className="space-y-0.5 block flex-1 min-w-[140px]">
                      <span className="text-[9px] font-black uppercase">Custo do produto (R$/un)</span>
                      <FreeNumericInput aria-label="Custo do produto (R$/un)"
                        className={CF_INPUT_MONEY}
                        placeholder="12,50"
                        value={editingStock.directCost}
                        onChange={(directCost) => patchEditingStock({ directCost })}
                      />
                    </label>
                    <label className={CF_FIELD_COL}>
                      <span className={CF_LABEL}>Qtd/mês (vendas)</span>
                      <FreeNumericInput aria-label="Qtd/mês (vendas)"
                        inputMode="numeric"
                        className={CF_INPUT_NUM}
                        placeholder="100"
                        value={stockView.monthlyQty}
                        onChange={(monthlyQty) => patchEditingStock({ monthlyQty })}
                      />
                    </label>
                  </div>
                  <StockInfoCard
                    compact
                    title="Custo informado"
                    value={editingStock.directCost > 0 ? formatCurrency(editingStock.directCost) : null}
                  />
                </div>
              )}
            </div>
          )}
          {isMeasureCategory ? (
            <div className="space-y-0.5">
              <div className={CF_FIELD_ROW}>
                <label className={CF_FIELD_COL}>
                  <span className={CF_LABEL}>Medida</span>
                  <select
                    className={CF_SELECT_MEASURE}
                    value={measureUnit}
                    aria-label="Unidade de medida"
                    onChange={(e) => {
                      patchEditingStock(
                        patchStockMeasure(editingStock, { packageUnit: e.target.value as MeasureUnit }),
                      );
                    }}
                  >
                    {STOCK_MEASURE_UNIT_OPTIONS.map((u) => (
                      <option key={u} value={u}>
                        {MEASURE_UNIT_LABELS[u]}
                      </option>
                    ))}
                  </select>
                </label>
                <div className={CF_FIELD_COL_CONTROLS}>
                  <span className={CF_LABEL}>Quantidade ({measureLabel})</span>
                  <div className={CF_FIELD_INLINE}>
                    <CfSegmentedControl<MeasureEntryMode>
                      aria-label="Modo de quantidade"
                      value={measureEntryMode}
                      onChange={(mode) => {
                        setMeasureEntryMode(mode);
                        if (mode === 'total') {
                          const total = catalogStockMeasure(editingStock);
                          setMeasureTotalRaw(total > 0 ? String(total) : '');
                          setMeasureTotalTyping(false);
                        } else {
                          const per = editingStock.measureQuantity;
                          setMeasurePerUnitRaw(per > 0 ? String(per) : '');
                          setMeasurePerUnitTyping(false);
                        }
                      }}
                      options={[
                        { value: 'per_unit', label: 'Unit.', title: 'Quantidade unitária' },
                        { value: 'total', label: 'Total', title: 'Quantidade total' },
                      ]}
                    />
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label="Quantidade ou medida do produto"
                      autoComplete="off"
                      className={cn(
                        CF_INPUT_NUM,
                        'cf-no-number-spin',
                        measureEntryMode === 'total' && 'w-[5.5rem]',
                      )}
                      value={measureEntryMode === 'per_unit' ? measurePerUnitRaw : measureTotalRaw}
                      placeholder={measureEntryMode === 'per_unit' ? '0' : '0'}
                      onFocus={() => {
                        if (measureEntryMode === 'per_unit') setMeasurePerUnitTyping(true);
                        else setMeasureTotalTyping(true);
                      }}
                      onChange={(e) => {
                        const raw = sanitizeNumericDraft(e.target.value);
                        if (measureEntryMode === 'per_unit') {
                          setMeasurePerUnitRaw(raw);
                        } else {
                          setMeasureTotalRaw(raw);
                        }
                      }}
                      onBlur={() => {
                        setMeasurePerUnitTyping(false);
                        setMeasureTotalTyping(false);
                        const raw =
                          measureEntryMode === 'per_unit' ? measurePerUnitRaw : measureTotalRaw;
                        const empty =
                          !raw.trim() || raw.trim() === '-' || raw.trim() === ',' || raw.trim() === '.';
                        if (measureEntryMode === 'per_unit') {
                          if (empty) {
                            patchEditingStock(
                              patchStockPurchaseAndMeasure(editingStock, {}, { measureQuantity: 0 }),
                            );
                            return;
                          }
                          patchEditingStock(
                            patchStockPurchaseAndMeasure(editingStock, {}, {
                              measureQuantity: parseLocaleNumber(raw, 0),
                            }),
                          );
                        } else if (empty) {
                          patchEditingStock(
                            patchStockPurchaseAndMeasure(editingStock, {}, { measureQuantity: 0 }),
                          );
                        } else {
                          const total = parseLocaleNumber(raw, 0);
                          if (unitsPurchased > 0) {
                            patchEditingStock(
                              patchStockPurchaseAndMeasure(editingStock, {}, {
                                measureQuantity: total / unitsPurchased,
                              }),
                            );
                          } else {
                            patchEditingStock(
                              patchStockMeasure(editingStock, {
                                measureQuantity: 0,
                                packageSize: total,
                              }),
                            );
                          }
                        }
                      }}
                    />
                  </div>
                </div>
              </div>
              <StockMeasureInfoCards
                item={editingStock}
                measureUnit={measureUnit}
                measureQuantity={measureQuantity}
                purchaseTotal={cadastroPriceTotal}
              />
            </div>
          ) : isMercadoria ? (
            <div>
              <div className={CF_FIELD_ROW}>
                <label className={CF_FIELD_COL}>
                  <span className={CF_LABEL}>Qtd total (un)</span>
                  <div className={`${CF_INPUT_NUM} bg-white font-bold flex items-center justify-end`}>
                    {unitsPurchased > 0 ? unitsPurchased : '—'}
                  </div>
                </label>
                <label className={CF_FIELD_COL}>
                  <span className={CF_LABEL}>Valor total (R$)</span>
                  <div className={`${CF_INPUT_MONEY} bg-brand-sidebar/30 font-black flex items-center justify-end`}>
                    {cadastroPriceTotal > 0 ? formatCurrency(cadastroPriceTotal) : '—'}
                  </div>
                </label>
              </div>
            </div>
          ) : null}
        {(isBomProduct || isMercadoria) && (
          <label className={CF_FIELD_COL}>
            <span className={CF_LABEL}>Licitação — instituição licitante</span>
            <input
              aria-label="Instituição licitante"
              className={CF_INPUT_MED}
              list="licitante-institutions-list"
              placeholder="Ex.: Prefeitura, Hospital, Escola..."
              value={editingStock.licitanteInstitution ?? ''}
              onChange={(e) =>
                patchEditingStock({ licitanteInstitution: e.target.value || undefined })
              }
              onBlur={(e) => registerLicitanteInstitution(e.target.value)}
            />
            <datalist id="licitante-institutions-list">
              {licitanteOptions.map((inst) => (
                <option key={inst} value={inst} />
              ))}
            </datalist>
          </label>
        )}
        <div className="border border-brand-border/40 bg-white/60 p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={CF_LABEL}>Créditos a recuperar (neste item)</span>
            <button
              type="button"
              className="technical-button-primary text-[9px] py-1 px-2 flex items-center gap-1"
              onClick={() => {
                const credit: StockItemCredit = {
                  id: crypto.randomUUID(),
                  name: '',
                  creditKind: 'PIS/COFINS',
                  amount: 0,
                  taxRegime: 'Lucro Real',
                };
                patchEditingStock({
                  recoverableCredits: [...(editingStock.recoverableCredits ?? []), credit],
                });
              }}
            >
              <Plus size={12} /> Crédito
            </button>
          </div>
          {(editingStock.recoverableCredits ?? []).length === 0 ? (
            <p className="text-[9px] uppercase opacity-50 font-bold">
              Nenhum crédito neste item. Cadastre aqui; a aba Créditos consolida o total.
            </p>
          ) : (
            <>
              <div
                className={cn(
                  'space-y-2 min-h-0',
                  (editingStock.recoverableCredits ?? []).length >= 4 &&
                    'max-h-[11.5rem] overflow-y-auto overflow-x-hidden overscroll-contain pr-0.5',
                )}
              >
                {(editingStock.recoverableCredits ?? []).map((credit) => (
                  <div key={credit.id} className={CF_FIELD_ROW}>
                    <input
                      className={CF_INPUT_MED}
                      placeholder="Nome / referência"
                      value={credit.name}
                      onChange={(e) => {
                        const next = (editingStock.recoverableCredits ?? []).map((c) =>
                          c.id === credit.id ? { ...c, name: e.target.value } : c,
                        );
                        patchEditingStock({ recoverableCredits: next });
                      }}
                    />
                    <input
                      className={CF_INPUT_MED}
                      placeholder="Tipo (ICMS, PIS...)"
                      value={credit.creditKind}
                      onChange={(e) => {
                        const next = (editingStock.recoverableCredits ?? []).map((c) =>
                          c.id === credit.id ? { ...c, creditKind: e.target.value } : c,
                        );
                        patchEditingStock({ recoverableCredits: next });
                      }}
                    />
                    <FreeNumericInput
                      className={CF_INPUT_MONEY}
                      placeholder="Valor (R$)"
                      value={credit.amount}
                      onChange={(amount) => {
                        const next = (editingStock.recoverableCredits ?? []).map((c) =>
                          c.id === credit.id ? { ...c, amount: Math.max(0, amount) } : c,
                        );
                        patchEditingStock({ recoverableCredits: next });
                      }}
                    />
                    <select
                      aria-label="Regime tributário do crédito"
                      className={CF_SELECT}
                      value={credit.taxRegime ?? 'Lucro Real'}
                      onChange={(e) => {
                        const next = (editingStock.recoverableCredits ?? []).map((c) =>
                          c.id === credit.id ? { ...c, taxRegime: e.target.value } : c,
                        );
                        patchEditingStock({ recoverableCredits: next });
                      }}
                    >
                      <option>Simples Nacional</option>
                      <option>Lucro Presumido</option>
                      <option>Lucro Real</option>
                    </select>
                    <button
                      type="button"
                      className="text-red-700 text-[9px] font-bold shrink-0"
                      onClick={() =>
                        patchEditingStock({
                          recoverableCredits: (editingStock.recoverableCredits ?? []).filter(
                            (c) => c.id !== credit.id,
                          ),
                        })
                      }
                    >
                      Excluir
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-[9px] font-mono opacity-60 pt-1 border-t border-brand-border/15 shrink-0">
                Total neste item: {formatCurrency(stockItemCreditsTotal(editingStock))}
              </p>
            </>
          )}
        </div>
      </div>
    );
  };

  const itemForCatalogStats = (item: StockItem): StockItem =>
    stockItemsForBomUsage.find((s) => s.id === item.id) ?? item;

  const depletedStockIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of workspace.stockItems) {
      if (stockItemDepletedByBom(itemForCatalogStats(item), stockItemsForBomUsage)) {
        ids.add(item.id);
      }
    }
    return ids;
  }, [workspace.stockItems, stockItemsForBomUsage]);

  const workspaceMaterialShortages = useMemo(
    () => collectWorkspaceMaterialShortages(stockItemsForBomUsage),
    [stockItemsForBomUsage],
  );

  const shortfallByStockId = useMemo(() => {
    const map = new Map(
      workspaceMaterialShortages.map((s) => [s.stockItemId, s] as const),
    );
    for (const item of workspace.stockItems) {
      if (item.category !== 'insumo' && item.category !== 'materia_prima' && item.category !== 'mercadoria') {
        continue;
      }
      const view = stockItemsForBomUsage.find((s) => s.id === item.id) ?? item;
      const resolved = resolveReplenishShortageForStockItem(view, stockItemsForBomUsage);
      if (!resolved) continue;
      const prev = map.get(item.id);
      if (!prev || resolved.shortfallQty > prev.shortfallQty) {
        map.set(item.id, resolved);
      }
    }
    return map;
  }, [workspaceMaterialShortages, workspace.stockItems, stockItemsForBomUsage]);

  const renderEstoque = () => {
    const isFaltantesTab = stockFilter === 'faltantes';
    const items = isFaltantesTab
      ? workspace.stockItems.filter((s) => {
          if (!depletedStockIds.has(s.id)) return false;
          if (licitanteFilter && (s.category === 'produto_acabado' || s.category === 'mercadoria')) {
            return stockMatchesLicitanteFilter(s, licitanteFilter);
          }
          return true;
        })
      : workspace.stockItems.filter((s) => {
          if (s.category !== stockFilter || depletedStockIds.has(s.id)) return false;
          if (showProductStockScope && stockProductScopeId) {
            if (!stockItemMatchesProductScope(s, stockProductScopeId)) return false;
          }
          if (licitanteFilter && (s.category === 'produto_acabado' || s.category === 'mercadoria')) {
            if (!stockMatchesLicitanteFilter(s, licitanteFilter)) return false;
          }
          return true;
        });
    const activeTabLabel =
      STOCK_CATALOG_TABS.find((t) => t.id === stockFilter)?.label ?? STOCK_CATEGORY_LABELS.insumo;
    const visibleItemIds = items.map((item) => item.id);
    const selectedVisibleIds = selectedStockIds.filter((id) => visibleItemIds.includes(id));
    const allVisibleSelected = items.length > 0 && selectedVisibleIds.length === items.length;
    const unscopedVisibleItems = items.filter(
      (item) => isStockProductScopedCategory(item.category) && !item.stockScopeProductId,
    );
    const showLegacyLinkScope =
      stockProductScopeId === STOCK_PRODUCT_SCOPE_UNLINKED ||
      stockProductScopeId === STOCK_PRODUCT_SCOPE_ALL;
    const showLegacyLinkBar =
      showProductStockScope &&
      finishedProducts.length > 0 &&
      !isFaltantesTab &&
      showLegacyLinkScope &&
      unscopedVisibleItems.length > 0;
    const selectedUnscopedCount = items.filter(
      (item) =>
        selectedVisibleIds.includes(item.id) &&
        isStockProductScopedCategory(item.category) &&
        !item.stockScopeProductId,
    ).length;
    const showItemLinkRow = (item: StockItem) =>
      showProductStockScope &&
      finishedProducts.length > 0 &&
      isStockProductScopedCategory(item.category) &&
      !item.stockScopeProductId &&
      showLegacyLinkScope;

    const renderShortfallActions = (itemId: string, compact = false) => {
      const showOnFaltantes = isFaltantesTab && depletedStockIds.has(itemId);
      const showOnCategory = !isFaltantesTab && shortfallByStockId.has(itemId);
      if (!showOnFaltantes && !showOnCategory) return null;
      return (
        <div className={compact ? 'px-3 pb-2 bg-red-50/40' : undefined}>
          <button
            type="button"
            className={cn(
              'font-bold uppercase text-red-900 technical-button normal-case w-full',
              compact ? 'text-[8px] py-1 px-2' : 'text-[9px] py-1 px-2',
            )}
            onClick={(e) => {
              e.stopPropagation();
              replenishSingleStockItem(itemId);
            }}
          >
            Acrescentar
          </button>
        </div>
      );
    };

    return (
      <div className="space-y-4">
        <PdfExportBar section="estoque" />
        <div className="cf-scroll-tabs flex gap-1 border border-brand-border p-1 bg-brand-sidebar/20">
          {STOCK_CATALOG_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStockFilter(tab.id)}
              className={cn(
                'shrink-0 whitespace-nowrap px-3 py-2 sm:py-1.5 text-[9px] font-bold uppercase cf-touch-target sm:min-h-0',
                stockFilter === tab.id ? 'bg-brand-border text-brand-bg' : 'opacity-60',
                tab.id === 'faltantes' && depletedStockIds.size > 0 && stockFilter !== 'faltantes' && 'text-red-800',
              )}
            >
              {tab.label}
              {tab.id === 'faltantes' && depletedStockIds.size > 0 ? (
                <span className="ml-1 font-mono">({depletedStockIds.size})</span>
              ) : null}
            </button>
          ))}
        </div>
        {showProductStockScope && (
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 px-1 w-full">
            <label className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 text-[9px] font-bold uppercase min-w-0 w-full sm:w-auto">
              <span className="shrink-0 opacity-70">Estoque do produto:</span>
              {finishedProducts.length === 0 && !hasUnscopedMaterials ? (
                <span className="text-amber-900 normal-case text-[10px] leading-snug">
                  Cadastre um produto acabado para separar o estoque por receita.
                </span>
              ) : (
                <select
                  aria-label="Alternar estoque por produto acabado"
                  className={CF_SELECT_WIDE_RESPONSIVE}
                  value={stockProductScopeId}
                  onChange={(e) => setStockProductScopeId(e.target.value)}
                >
                  <option value={STOCK_PRODUCT_SCOPE_ALL}>Todos</option>
                  {finishedProducts.map((pa) => (
                    <option key={pa.id} value={pa.id}>
                      {pa.name?.trim() || 'Sem nome'}
                    </option>
                  ))}
                  <option value={STOCK_PRODUCT_SCOPE_UNLINKED}>Sem produto acabado</option>
                </select>
              )}
            </label>
            {stockProductScopeId === STOCK_PRODUCT_SCOPE_ALL ? (
              <span className="text-[8px] sm:text-[8px] font-mono uppercase opacity-50 leading-snug">
                Todos os insumos/MP · use «Sem produto acabado» para vincular
              </span>
            ) : stockProductScopeId === STOCK_PRODUCT_SCOPE_UNLINKED ? (
              <span className="text-[8px] font-mono uppercase opacity-50 leading-snug">
                Itens sem PA — vincule abaixo ou no editor
              </span>
            ) : stockProductScopeId ? (
              <span className="text-[8px] font-mono uppercase opacity-50 leading-snug">
                Insumos/MP só deste PA · {stockScopeProductName}
              </span>
            ) : null}
          </div>
        )}
        {showLegacyLinkBar ? (
          <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 px-3 py-3 sm:py-2 border border-amber-300/60 bg-amber-50/50 rounded-lg">
            <span className="text-[9px] font-bold uppercase text-amber-950 shrink-0">
              Vincular a produto acabado:
            </span>
            <select
              aria-label="Produto acabado para vincular itens sem PA"
              className={CF_SELECT_WIDE_RESPONSIVE}
              value={legacyBulkAssignPaId}
              onChange={(e) => setLegacyBulkAssignPaId(e.target.value)}
            >
              {finishedProducts.map((pa) => (
                <option key={pa.id} value={pa.id}>
                  {pa.name?.trim() || 'Sem nome'}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="technical-button text-[8px] py-2 sm:py-1 px-2 uppercase w-full sm:w-auto cf-touch-target sm:min-h-0"
              disabled={!legacyBulkAssignPaId || selectedUnscopedCount === 0}
              onClick={() =>
                assignSelectedLegacyToProduct(items, legacyBulkAssignPaId, selectedVisibleIds)
              }
            >
              Vincular selecionados ({selectedUnscopedCount})
            </button>
            <button
              type="button"
              className="technical-button text-[8px] py-2 sm:py-1 px-2 uppercase w-full sm:w-auto cf-touch-target sm:min-h-0"
              disabled={!legacyBulkAssignPaId}
              onClick={() => assignLegacyItemsToProduct(unscopedVisibleItems, legacyBulkAssignPaId)}
            >
              Vincular todos da lista ({unscopedVisibleItems.length})
            </button>
          </div>
        ) : null}
        {showLicitanteFilter ? (
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 px-1 w-full">
            <label className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 text-[9px] font-bold uppercase min-w-0 w-full sm:w-auto">
              <span className="shrink-0 opacity-70">Empresa licitante:</span>
              <select
                aria-label="Filtrar estoque por instituição licitante"
                className={CF_SELECT_WIDE_RESPONSIVE}
                value={licitanteFilter}
                onChange={(e) => setLicitanteFilter(e.target.value)}
              >
                <option value="">Todas</option>
                {licitanteOptions.map((inst) => (
                  <option key={inst} value={inst}>
                    {inst}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        {isFaltantesTab && workspaceMaterialShortages.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="technical-button text-[9px] py-1 px-2"
              onClick={(e) => {
                e.stopPropagation();
                addAllWorkspaceMaterialShortfalls();
              }}
            >
              Acrescentar tudo
            </button>
          </div>
        )}
        {isFaltantesTab && (
          <p className="text-[9px] font-bold uppercase text-red-900/90 px-1">
            Estoque físico zerado pela composição. «Acrescentar» no card repõe só aquele item; «Acrescentar tudo»
            repõe todos os faltantes de uma vez.
          </p>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div
            className={cn(
              'lg:col-span-5 technical-panel shadow-[3px_3px_0_0_#141414] overflow-hidden module-panel-scroll module-panel-scroll-fluid min-w-0',
              editingStockId && 'hidden lg:flex lg:flex-col',
            )}
          >
            <div className="px-3 sm:px-4 py-3 border-b border-brand-border flex justify-between items-center shrink-0 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] font-black uppercase truncate">{activeTabLabel}</span>
                {!isFaltantesTab ? (
                  <InfoButton onClick={() => setStockHelpCategory(stockFilter as StockCategory)} />
                ) : null}
              </div>
              {!isFaltantesTab ? (
                <button
                  type="button"
                  className="technical-button-primary text-[9px] py-2 sm:py-1 px-2 flex items-center gap-1 shrink-0 cf-touch-target sm:min-h-0"
                  disabled={
                    showProductStockScope &&
                    !stockProductScopeId &&
                    finishedProducts.length > 0
                  }
                  title={
                    showProductStockScope &&
                    !stockProductScopeId &&
                    finishedProducts.length > 0
                      ? 'Selecione o produto acabado acima'
                      : undefined
                  }
                  onClick={() => {
                    const scopeForNew =
                      showProductStockScope &&
                      stockProductScopeId &&
                      stockProductScopeId !== STOCK_PRODUCT_SCOPE_UNLINKED &&
                      stockProductScopeId !== STOCK_PRODUCT_SCOPE_ALL
                        ? stockProductScopeId
                        : undefined;
                    const id = addStock(stockFilter as StockCategory, scopeForNew);
                    setEditingStockId(id);
                  }}
                >
                  <Plus size={12} /> Novo
                </button>
              ) : null}
            </div>
            {!isFaltantesTab && items.length > 0 ? (
              <div className="px-3 py-2 border-b border-brand-border/20 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 bg-brand-sidebar/10 shrink-0">
                <label className="flex items-center gap-1.5 text-[9px] font-bold uppercase cursor-pointer shrink-0 cf-touch-target sm:min-h-0 py-1">
                  <input
                    type="checkbox"
                    className="shrink-0 size-4 sm:size-3.5"
                    checked={allVisibleSelected}
                    onChange={(e) => {
                      setSelectedStockIds(e.target.checked ? visibleItemIds : []);
                    }}
                    aria-label="Marcar todos os itens visíveis"
                  />
                  Marcar todos
                </label>
                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    className="technical-button text-[8px] py-2 sm:py-1 px-2 uppercase text-red-900 w-full sm:w-auto cf-touch-target sm:min-h-0"
                    disabled={selectedVisibleIds.length === 0}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Excluir ${selectedVisibleIds.length} item(ns) selecionado(s)?`,
                        )
                      ) {
                        return;
                      }
                      deleteStockItems(selectedVisibleIds);
                    }}
                  >
                    Excluir selecionados ({selectedVisibleIds.length})
                  </button>
                  <button
                    type="button"
                    className="technical-button text-[8px] py-2 sm:py-1 px-2 uppercase text-red-900 w-full sm:w-auto cf-touch-target sm:min-h-0"
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Excluir todos os ${items.length} itens da lista «${activeTabLabel} · ${stockScopeProductName}»?`,
                        )
                      ) {
                        return;
                      }
                      deleteStockItems(visibleItemIds);
                    }}
                  >
                    Excluir todos ({items.length})
                  </button>
                </div>
              </div>
            ) : null}
            <div className="module-panel-scroll-body">
              {items.length === 0 ? (
                <p className="p-8 text-center text-[10px] uppercase text-slate-400">
                  {isFaltantesTab
                    ? 'Nenhum item esgotado pela composição.'
                    : showProductStockScope && finishedProducts.length === 0
                      ? 'Cadastre um produto acabado na aba correspondente.'
                      : showProductStockScope && stockProductScopeId
                        ? `Nenhum ${STOCK_CATEGORY_LABELS[stockFilter as StockCategory]} em «${stockScopeProductName}». Clique em Novo.`
                        : 'Nenhum item.'}
                </p>
              ) : (
                items.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      'border-b border-brand-border/10',
                      editingStockId === item.id && 'bg-brand-sidebar/40',
                      selectedVisibleIds.includes(item.id) && 'bg-brand-sidebar/15',
                    )}
                  >
                    <div className="flex items-start gap-2 px-2 sm:px-3 py-2.5 min-w-0">
                      {!isFaltantesTab ? (
                        <input
                          type="checkbox"
                          className="mt-1 shrink-0 size-4 sm:size-3.5"
                          checked={selectedStockIds.includes(item.id)}
                          onChange={(e) => {
                            setSelectedStockIds((prev) =>
                              e.target.checked
                                ? [...prev, item.id]
                                : prev.filter((id) => id !== item.id),
                            );
                          }}
                          aria-label={`Selecionar ${item.name || 'item'}`}
                        />
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setEditingStockId(item.id)}
                        className="flex-1 min-w-0 text-left hover:opacity-80 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 cf-touch-target sm:min-h-0 py-1"
                      >
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <span className="text-[11px] font-mono font-bold break-words sm:truncate block">
                            {item.name || 'Sem nome'}
                          </span>
                          <span
                            className="text-[8px] font-mono opacity-50 uppercase break-words sm:truncate block"
                            title={`${STOCK_CATEGORY_LABELS[item.category]}${item.sku ? ` · SKU ${item.sku}` : ''}`}
                          >
                            {STOCK_CATEGORY_LABELS[item.category]}
                            {item.sku ? ` · SKU ${item.sku}` : ''}
                            {(item.category === 'produto_acabado' || item.category === 'mercadoria') &&
                            item.licitanteInstitution
                              ? ` · ${item.licitanteInstitution}`
                              : ''}
                            {showProductStockScope &&
                            isStockProductScopedCategory(item.category) &&
                            stockProductScopeId === STOCK_PRODUCT_SCOPE_ALL &&
                            !item.stockScopeProductId
                              ? ' · sem PA'
                              : ''}
                          </span>
                        </div>
                        <StockCatalogStats
                          item={itemForCatalogStats(item)}
                          allItems={stockItemsForBomUsage}
                        />
                      </button>
                    </div>
                    {showItemLinkRow(item) ? (
                      <div className="px-2 sm:px-3 pb-2 bg-amber-50/30">
                        <select
                          aria-label={`Vincular ${item.name || 'item'} a produto acabado`}
                          className={`${CF_SELECT_RESPONSIVE} text-[9px] py-1 sm:py-0.5`}
                          value=""
                          onChange={(e) => {
                            const productId = e.target.value;
                            if (productId) assignStockItemScope(item, productId);
                          }}
                        >
                          <option value="">Vincular a produto acabado…</option>
                          {finishedProducts.map((pa) => (
                            <option key={pa.id} value={pa.id}>
                              {pa.name?.trim() || 'Sem nome'}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                    {renderShortfallActions(item.id, true)}
                  </div>
                ))
              )}
            </div>
          </div>
          <div
            className={cn(
              'lg:col-span-7 technical-panel shadow-[3px_3px_0_0_#141414] module-panel-scroll module-panel-scroll-fluid module-panel-scroll-fluid--editor min-w-0',
              !editingStockId && 'hidden lg:flex lg:flex-col',
            )}
          >
            <div className="px-3 sm:px-4 py-3 border-b border-brand-border flex flex-wrap justify-between items-center shrink-0 gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {editingStock ? (
                  <button
                    type="button"
                    className="lg:hidden technical-button text-[9px] py-1.5 px-2 flex items-center gap-1 shrink-0 cf-touch-target"
                    onClick={() => setEditingStockId(null)}
                    aria-label="Voltar à lista de estoque"
                  >
                    <ArrowLeft size={14} aria-hidden />
                    Lista
                  </button>
                ) : null}
                <span className="text-[10px] font-black uppercase min-w-0 truncate">
                  Editor
                  {editingStock && (isFaltantesTab || editingStock.category !== stockFilter) ? (
                    <span className="opacity-50 font-mono normal-case">
                      {' '}
                      · {editingStock.name || 'Sem nome'} ({STOCK_CATEGORY_LABELS[editingStock.category]})
                    </span>
                  ) : null}
                </span>
              </div>
              {editingStock && (
                <button
                  type="button"
                  className="text-red-700 text-[9px] font-bold uppercase flex items-center gap-1 cf-touch-target sm:min-h-0 py-1.5 sm:py-0"
                  onClick={() => {
                    removeStock(editingStock.id);
                    setEditingStockId(null);
                  }}
                >
                  <Trash2 size={12} /> Excluir
                </button>
              )}
            </div>
            <div className="module-panel-scroll-body px-3 sm:px-4 py-3">
              {renderStockEditor()}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderCostForm = (type: 'custo' | 'despesa', segment: PricingSegment) => {
    const items = workspace.costExpenses.filter((c) => {
      if (c.type !== type || c.segment !== segment) return false;
      if (costKindFilter === 'todos') return true;
      return (c.kind === 'variavel' ? 'variavel' : 'fixo') === costKindFilter;
    });
    const add = () => {
      const item: CostExpenseItem = {
        id: crypto.randomUUID(),
        companyName: selectedCompany,
        type,
        segment,
        name: '',
        category: '',
        monthlyAmount: 0,
        kind: costKindFilter === 'variavel' ? 'variavel' : 'fixo',
        notes: '',
        createdAt: new Date().toISOString(),
      };
      upsertCostExpense(item);
    };

    return (
      <div className="technical-panel shadow-[3px_3px_0_0_#141414] overflow-hidden module-panel-scroll min-w-0">
        <div className="px-4 py-3 border-b border-brand-border flex justify-between shrink-0">
          <span className="text-[10px] font-black uppercase">{type === 'custo' ? 'Custos' : 'Despesas'} · {PRICING_SEGMENT_LABELS[segment]}</span>
          <button type="button" onClick={add} aria-label={`Adicionar ${type === 'custo' ? 'custo' : 'despesa'}`} className="technical-button text-[9px] py-1 px-2"><Plus size={12} aria-hidden /></button>
        </div>
        <div className="module-panel-scroll-body divide-y divide-brand-border/10">
          {items.length === 0 ? (
            <p className="p-6 text-center text-[10px] uppercase text-slate-400">
              {costKindFilter === 'todos'
                ? 'Nenhum lançamento neste segmento.'
                : `Nenhum lançamento ${COST_EXPENSE_KIND_LABELS[costKindFilter].toLowerCase()} neste segmento.`}
            </p>
          ) : items.map((item) => (
            <div key={item.id} className="p-3 space-y-2 border-b border-brand-border/10 last:border-b-0">
              <div className={CF_FIELD_ROW}>
                <input aria-label="Nome do lançamento" className={CF_INPUT_MED} placeholder="Nome" value={item.name} onChange={(e) => upsertCostExpense({ ...item, name: e.target.value })} />
                <FreeNumericInput aria-label="Valor mensal" className={CF_INPUT_MONEY} placeholder="Valor/mês" value={item.monthlyAmount} onChange={(monthlyAmount) => upsertCostExpense({ ...item, monthlyAmount })} />
                <select
                  aria-label="Classificação fixo ou variável"
                  className={CF_SELECT}
                  value={item.kind === 'variavel' ? 'variavel' : 'fixo'}
                  onChange={(e) =>
                    upsertCostExpense({
                      ...item,
                      kind: e.target.value as CostExpenseKind,
                    })
                  }
                >
                  <option value="fixo">{COST_EXPENSE_KIND_LABELS.fixo}</option>
                  <option value="variavel">{COST_EXPENSE_KIND_LABELS.variavel}</option>
                </select>
                <button type="button" className="shrink-0 text-red-700 text-[9px] font-bold px-1 self-center" onClick={() => removeCostExpense(item.id)}>Excluir</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderCustos = () => (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black uppercase">Custos e despesas</span>
          <InfoButton onClick={() => setHelpModal('costs')} />
        </div>
        <PdfExportBar section="custos" />
      </div>
      <p className="text-[10px] opacity-60 uppercase font-bold">
        Lance custos e despesas mensais por segmento. Classifique cada lançamento como fixo ou variável.
        Na precificação, o total do segmento é rateado entre produtos/mercadorias com qtd/mês informada.
      </p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {(
          [
            { label: 'Custos fixos', value: costKindTotals.fixedCosts, tone: 'text-red-800' },
            { label: 'Custos variáveis', value: costKindTotals.variableCosts, tone: 'text-red-700' },
            { label: 'Despesas fixas', value: costKindTotals.fixedExpenses, tone: 'text-amber-900' },
            { label: 'Despesas variáveis', value: costKindTotals.variableExpenses, tone: 'text-amber-800' },
          ] as const
        ).map((card) => (
          <div key={card.label} className="technical-panel p-4 shadow-[2px_2px_0_0_#141414]">
            <span className="text-[9px] font-black uppercase opacity-60 block mb-1">
              {card.label} · {PRICING_SEGMENT_LABELS[costSegmentFilter]}
            </span>
            <span className={cn('text-lg font-black font-mono', card.tone)}>
              {formatCurrency(card.value)}
            </span>
          </div>
        ))}
      </div>
      <div className="technical-panel shadow-[3px_3px_0_0_#141414] overflow-hidden">
        <div className="flex flex-wrap border-b border-brand-border bg-brand-sidebar/20">
          {PRICING_SEGMENT_FILTERS.map((seg) => (
            <button
              key={seg}
              type="button"
              onClick={() => setCostSegmentFilter(seg)}
              className={cn(
                'flex-1 min-w-[120px] px-4 py-3 text-[10px] font-black uppercase tracking-wide border-r border-brand-border/30 last:border-r-0 transition-colors',
                costSegmentFilter === seg
                  ? 'bg-brand-border text-brand-bg'
                  : 'opacity-60 hover:opacity-100 hover:bg-brand-sidebar/40',
              )}
            >
              {PRICING_SEGMENT_LABELS[seg]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1 border-b border-brand-border/30 px-3 py-2 bg-brand-sidebar/10">
          <span className="text-[9px] font-bold uppercase opacity-50 self-center mr-1 shrink-0">
            Filtrar:
          </span>
          {(
            [
              { id: 'todos' as const, label: 'Todos' },
              { id: 'fixo' as const, label: COST_EXPENSE_KIND_LABELS.fixo },
              { id: 'variavel' as const, label: COST_EXPENSE_KIND_LABELS.variavel },
            ] as const
          ).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setCostKindFilter(id)}
              className={cn(
                'px-3 py-1.5 text-[9px] font-black uppercase tracking-wide shrink-0',
                costKindFilter === id
                  ? 'bg-brand-border text-brand-bg'
                  : 'opacity-55 hover:opacity-100 border border-brand-border/40',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4 bg-brand-sidebar/5 items-start">
          <div className="min-w-0">{renderCostForm('custo', costSegmentFilter)}</div>
          <div className="min-w-0">{renderCostForm('despesa', costSegmentFilter)}</div>
        </div>
      </div>
    </div>
  );

  const renderCreditos = () => {
    const scopeLabel =
      creditSegmentFilter === 'geral'
        ? 'Geral'
        : PRICING_SEGMENT_LABELS[creditSegmentFilter];
    const creditTabs: { id: PricingSegment | 'geral'; label: string }[] = [
      { id: 'geral', label: 'Geral' },
      { id: 'produto_acabado', label: PRICING_SEGMENT_LABELS.produto_acabado },
      { id: 'mercadoria', label: PRICING_SEGMENT_LABELS.mercadoria },
    ];
    const rowsByItem = new Map<string, typeof stockCreditsSummary.rows>();
    for (const row of stockCreditsSummary.rows) {
      const key = row.stockItemId;
      const list = rowsByItem.get(key) ?? [];
      list.push(row);
      rowsByItem.set(key, list);
    }

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase">Créditos recuperáveis</span>
            <InfoButton onClick={() => setHelpModal('credits')} />
          </div>
          <PdfExportBar section="creditos" />
        </div>
        <p className="text-[10px] opacity-60 uppercase font-bold">
          Visão consolidada dos créditos cadastrados no estoque (por item). Para incluir ou alterar,
          use o editor de cada produto ou mercadoria na aba Estoque.
        </p>
        <div className="technical-panel shadow-[3px_3px_0_0_#141414] overflow-hidden">
          <div className="flex flex-wrap border-b border-brand-border bg-brand-sidebar/20">
            {creditTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCreditSegmentFilter(tab.id)}
                className={cn(
                  'flex-1 min-w-[120px] px-4 py-3 text-[10px] font-black uppercase tracking-wide border-r border-brand-border/30 last:border-r-0 transition-colors',
                  creditSegmentFilter === tab.id
                    ? 'bg-brand-border text-brand-bg'
                    : 'opacity-60 hover:opacity-100 hover:bg-brand-sidebar/40',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="p-4 bg-brand-sidebar/5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="technical-panel p-4 shadow-[2px_2px_0_0_#141414]">
                <span className="text-[9px] font-black uppercase opacity-60 block mb-1">
                  Total · {scopeLabel}
                </span>
                <span className="text-xl font-black font-mono">
                  {formatCurrency(stockCreditsSummary.total)}
                </span>
              </div>
              <div className="technical-panel p-4 shadow-[2px_2px_0_0_#141414]">
                <span className="text-[9px] font-black uppercase opacity-60 block mb-1">
                  Produto acabado
                </span>
                <span className="text-lg font-black font-mono">
                  {formatCurrency(stockCreditsSummary.bySegment.produto_acabado)}
                </span>
              </div>
              <div className="technical-panel p-4 shadow-[2px_2px_0_0_#141414]">
                <span className="text-[9px] font-black uppercase opacity-60 block mb-1">
                  Mercadoria
                </span>
                <span className="text-lg font-black font-mono">
                  {formatCurrency(stockCreditsSummary.bySegment.mercadoria)}
                </span>
              </div>
            </div>
            {stockCreditsSummary.rows.length === 0 ? (
              <p className="text-center text-[10px] uppercase text-slate-400 py-8">
                Nenhum crédito cadastrado neste escopo. Abra um item no Estoque e adicione créditos a
                recuperar.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {[...rowsByItem.entries()].map(([itemId, rows]) => {
                  const first = rows[0];
                  const itemTotal = rows.reduce((s, r) => s + r.amount, 0);
                  return (
                    <div
                      key={itemId}
                      className="technical-panel p-4 shadow-[2px_2px_0_0_#141414] space-y-2 min-w-0"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="text-[11px] font-black uppercase block truncate">
                            {first.stockName}
                          </span>
                          <span className="text-[8px] font-mono opacity-50 uppercase">
                            {STOCK_CATEGORY_LABELS[first.category]}
                          </span>
                        </div>
                        <span className="text-sm font-black font-mono shrink-0">
                          {formatCurrency(itemTotal)}
                        </span>
                      </div>
                      <ul className="space-y-1 border-t border-brand-border/20 pt-2">
                        {rows.map((row, idx) => (
                          <li
                            key={`${row.stockItemId}-${row.creditKind}-${idx}`}
                            className="flex justify-between gap-2 text-[9px] font-mono"
                          >
                            <span className="truncate opacity-80">
                              {row.creditKind}
                              {row.name ? ` · ${row.name}` : ''}
                            </span>
                            <span className="shrink-0 font-bold">{formatCurrency(row.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderComparacaoAliquotas = () => (
    <PricingIcmsEstadosPanel
      selectedCompany={selectedCompany}
      valorBaseSugerido={valorMercadoriaSugerido}
    />
  );

  const renderDre = () => (
    <PricingDrePanel
      breakdowns={pricingBreakdowns}
      workspace={workspaceForPricing}
      companyName={selectedCompany}
      onExportPdf={() => exportPdf('dre')}
    />
  );

  const renderPrecificacao = () => (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black uppercase">Parâmetros globais</span>
          <InfoButton onClick={() => setHelpModal('markup')} />
        </div>
        <PdfExportBar section="precificacao" />
      </div>
      <div className="technical-panel p-3 shadow-[3px_3px_0_0_#141414] flex flex-wrap items-end gap-x-4 gap-y-2">
        <label className={CF_FIELD_COL}>
          <span className="text-[9px] font-black uppercase">Markup %</span>
          <FreeNumericInput aria-label="Markup %"
            className={CF_INPUT_NUM}
            value={workspace.settings.markupPercent}
            onChange={(markupPercent) => updateSettings({ markupPercent })}
            disabled={workspace.settings.mode === 'margin_only'}
            title={workspace.settings.mode === 'margin_only' ? 'Inativo na regra “Somente margem de lucro”' : undefined}
          />
        </label>
        <label className={CF_FIELD_COL}>
          <span className="text-[9px] font-black uppercase">Margem lucro %</span>
          <FreeNumericInput aria-label="Margem lucro %"
            className={CF_INPUT_NUM}
            value={workspace.settings.marginPercent}
            onChange={(marginPercent) => updateSettings({ marginPercent })}
            disabled={workspace.settings.mode === 'markup_only'}
            title={workspace.settings.mode === 'markup_only' ? 'Inativo na regra “Somente markup”' : undefined}
          />
        </label>
        <label className={CF_FIELD_COL}>
          <span className="text-[9px] font-black uppercase">Regra de preço</span>
          <select aria-label="Regra de preço" className="w-full sm:w-[220px] border border-brand-border px-1.5 py-1.5 sm:py-1 text-[10px] font-mono" value={workspace.settings.mode} onChange={(e) => updateSettings({ mode: e.target.value as PricingMode })}>
            <option value="markup_only">Somente markup</option>
            <option value="margin_only">Somente margem de lucro</option>
            <option value="both">Markup + margem (os dois no preço)</option>
          </select>
        </label>
      </div>
      {pricingParamsPreview ? (
        <p className="text-[10px] text-slate-600 font-bold max-w-3xl leading-relaxed">
          {workspace.settings.mode === 'both' ? (
            <>
              Preço = custo material (un.) × (1 + {workspace.settings.markupPercent}%) ÷ (1 −{' '}
              {workspace.settings.marginPercent}%).
            </>
          ) : workspace.settings.mode === 'markup_only' ? (
            <>Preço = custo material (un.) × (1 + {workspace.settings.markupPercent}%).</>
          ) : (
            <>Preço = custo material (un.) ÷ (1 − {workspace.settings.marginPercent}%).</>
          )}{' '}
          Exemplo ({pricingParamsPreview.name || 'produto'}):{' '}
          <span className="text-brand-black">
            {formatCurrency(pricingParamsPreview.cost)} → {formatCurrency(pricingParamsPreview.sale)}
          </span>
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 items-center">
        {(['all', ...PRICING_SEGMENT_FILTERS] as const).map((f) => (
          <button key={f} type="button" onClick={() => setPricingFilter(f)} className={cn('px-3 py-1 text-[9px] font-bold uppercase border', pricingFilter === f ? 'bg-brand-border text-brand-bg border-brand-border' : 'border-brand-border/30')}>
            {f === 'all' ? 'Todos' : PRICING_SEGMENT_LABELS[f]}
          </button>
        ))}
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 opacity-40" size={14} />
          <input className="w-full pl-8 pr-2 py-1.5 border border-brand-border text-[10px] font-mono" aria-label="Buscar produto" placeholder="Buscar produto..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-brand-border/20 pb-2">
        <button
          type="button"
          onClick={() => setPrecificacaoView('tabela')}
          className={cn(
            'px-3 py-1.5 text-[9px] font-black uppercase border flex items-center gap-1.5',
            precificacaoView === 'tabela'
              ? 'bg-brand-border text-brand-bg border-brand-border'
              : 'border-brand-border/30',
          )}
        >
          <Percent size={12} />
          Tabela
        </button>
        <button
          type="button"
          onClick={() => setPrecificacaoView('relatorio')}
          className={cn(
            'px-3 py-1.5 text-[9px] font-black uppercase border flex items-center gap-1.5',
            precificacaoView === 'relatorio'
              ? 'bg-brand-border text-brand-bg border-brand-border'
              : 'border-brand-border/30',
          )}
        >
          <FileText size={12} />
          Relatório do cálculo
        </button>
      </div>

      {precificacaoView === 'relatorio' ? (
        <PricingPrecificacaoReportPanel
          companyName={selectedCompany}
          breakdowns={filteredBreakdowns}
          workspace={workspaceForPricing}
          settings={workspace.settings}
        />
      ) : null}

      {precificacaoView === 'tabela' ? (
      <div className="technical-panel shadow-[3px_3px_0_0_#141414] overflow-hidden">
        <PricingPrecificacaoVirtualTable
          rows={filteredBreakdowns}
          workspace={workspaceForPricing}
          mode={workspace.settings.mode}
        />
      </div>
      ) : null}
    </div>
  );

  const renderCalculos = () => <PricingCalculationsPanel />;

  const renderRoa = () => (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black uppercase">Rentabilidade (ROA)</span>
          <InfoButton onClick={() => setHelpModal('roa')} />
        </div>
        <PdfExportBar section="roa" />
      </div>
      <p className="text-[10px] opacity-60 uppercase font-bold">Produtos menos rentáveis primeiro (ROA = lucro ÷ custo)</p>
      <div className="technical-panel shadow-[3px_3px_0_0_#141414] overflow-hidden min-w-0">
        <PricingRoaVirtualTable rows={pricingRoaRanking} />
      </div>
    </div>
  );

  return (
    <div className="p-3 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-4 sm:space-y-6 overflow-x-hidden">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <ModulePageHeader
          title="Precificação"
          subtitle="Custos, estoque e formação de preço"
          actions={
            <button
              type="button"
              onClick={() => exportPdf('all')}
              className="technical-button-primary text-[10px] flex items-center justify-center gap-2 w-full sm:w-auto cf-touch-target sm:min-h-0"
            >
              <Download size={14} /> Exportar relatório completo
            </button>
          }
        />
        <ActiveCompanySelector
          className="w-full sm:w-72 shrink-0"
          selectedCompany={selectedCompany}
          companyOptions={companyOptions}
          onCompanyChange={onCompanyChange}
          onCreateCompany={onCreateCompany}
          onRenameCompany={onRenameCompany}
          onDeleteCompany={onDeleteCompany}
          deleteConfirmMessage={(company) =>
            `Excluir «${company}»?\n\nOs dados de precificação deste sindicato serão removidos. Não afeta empresas do Gerencial.`
          }
        />
      </div>

      <div className="cf-scroll-tabs flex gap-1 border border-brand-border p-1 bg-brand-sidebar/20">
        {MAIN_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setMainTab(id)}
            className={cn(
              'flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 sm:py-2 text-[9px] font-bold uppercase tracking-wide cf-touch-target sm:min-h-0',
              mainTab === id
                ? 'bg-brand-border text-brand-bg shadow-[2px_2px_0_0_rgba(0,0,0,0.15)]'
                : 'opacity-60 hover:opacity-100',
            )}
          >
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      {mainTab === 'dashboard' && renderDashboard()}
      {mainTab === 'estoque' && renderEstoque()}
      {mainTab === 'custos' && renderCustos()}
      {mainTab === 'creditos' && renderCreditos()}
      {mainTab === 'dre' && renderDre()}
      {mainTab === 'precificacao' && renderPrecificacao()}
      {mainTab === 'comparacao-aliquotas' && renderComparacaoAliquotas()}
      {mainTab === 'calculos' && renderCalculos()}
      {mainTab === 'roa' && renderRoa()}

      <PricingInfoModal
        open={helpModal === 'roa'}
        title={ROA_HELP_TITLE}
        body={ROA_HELP_BODY}
        onClose={() => setHelpModal(null)}
      />
      <PricingInfoModal
        open={helpModal === 'costs'}
        title={COSTS_EXPENSES_HELP_TITLE}
        body={COSTS_EXPENSES_HELP_BODY}
        onClose={() => setHelpModal(null)}
      />
      <PricingInfoModal
        open={helpModal === 'credits'}
        title={CREDITS_HELP_TITLE}
        body={CREDITS_HELP_BODY}
        onClose={() => setHelpModal(null)}
      />
      <PricingInfoModal
        open={helpModal === 'markup'}
        title={MARKUP_MARGIN_HELP_TITLE}
        body={MARKUP_MARGIN_HELP_BODY}
        onClose={() => setHelpModal(null)}
      />
      {stockHelpCategory ? (
        <PricingInfoModal
          open
          title={stockCategoryHelpTitle(stockHelpCategory)}
          body={stockCategoryHelpBody(stockHelpCategory)}
          onClose={() => setStockHelpCategory(null)}
        />
      ) : null}
    </div>
  );
}
