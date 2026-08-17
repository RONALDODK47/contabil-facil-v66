import {
  convertMeasureQuantity,
  formatQtyUnit,
  priceFromMargin,
  priceFromMarkup,
  toBaseUnit,
} from './pricingCalculator';
import type { MeasureUnit } from './pricingTypes';

export type BasicCalcMode =
  | 'adicao'
  | 'subtracao'
  | 'multiplicacao'
  | 'divisao'
  | 'porcentagem';

/** @deprecated Use BasicCalcMode — alias legado para compatibilidade interna. */
export type MeasureCalculatorMode = BasicCalcMode;

export type PercentCalcType =
  | 'parte-do-valor'
  | 'quanto-e-percentual'
  | 'acrescimo-desconto'
  | 'markup'
  | 'margem';

export interface BasicCalcInput {
  mode: BasicCalcMode;
  a: number;
  b: number;
}

export interface BasicCalcResult {
  value: number;
  formula: string;
  error?: string;
}

/** Operações aritméticas básicas (+, −, ×, ÷) e porcentagem de um valor. */
export function calcBasic(input: BasicCalcInput): BasicCalcResult {
  const { mode, a, b } = input;

  if (mode === 'porcentagem') {
    const pct = calcPercent({ type: 'parte-do-valor', percent: a, baseValue: b });
    return {
      value: pct.primaryValue,
      formula: pct.formula,
      error: pct.error,
    };
  }

  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { value: 0, formula: '', error: 'Informe os dois valores.' };
  }

  switch (mode) {
    case 'adicao':
      return {
        value: a + b,
        formula: `${formatNumberLike(a)} + ${formatNumberLike(b)}`,
      };
    case 'subtracao':
      return {
        value: a - b,
        formula: `${formatNumberLike(a)} − ${formatNumberLike(b)}`,
      };
    case 'multiplicacao':
      return {
        value: a * b,
        formula: `${formatNumberLike(a)} × ${formatNumberLike(b)}`,
      };
    case 'divisao': {
      if (b === 0) {
        return { value: 0, formula: '', error: 'Divisão por zero não é permitida.' };
      }
      return {
        value: a / b,
        formula: `${formatNumberLike(a)} ÷ ${formatNumberLike(b)}`,
      };
    }
    default:
      return { value: 0, formula: '', error: 'Operação inválida.' };
  }
}

export interface PercentCalcInput {
  type: PercentCalcType;
  percent: number;
  baseValue: number;
  /** Só para acrescimo-desconto */
  increase?: boolean;
  /** Segundo valor (parte ou custo conforme o tipo) */
  secondValue?: number;
}

export interface PercentCalcResult {
  primaryValue: number;
  secondaryValue?: number;
  primaryLabel: string;
  secondaryLabel?: string;
  formula: string;
  error?: string;
}

export interface MeasureProrationInput {
  /** Valor total pago (ex.: conta de água R$ 150). */
  totalValue: number;
  /** Quantidade total que esse valor representa (ex.: 1.000 L no mês). */
  totalQty: number;
  totalUnit: MeasureUnit;
  usedQty: number;
  usedUnit: MeasureUnit;
}

export interface MeasureProrationResult {
  cost: number;
  unitCostInUsedUnit: number;
  formula: string;
  error?: string;
}

export interface CountProrationInput {
  totalValue: number;
  totalCount: number;
  usedCount: number;
}

export interface CountProrationResult {
  cost: number;
  unitCost: number;
  formula: string;
  error?: string;
}

export interface MeasureConversionInput {
  qty: number;
  fromUnit: MeasureUnit;
  toUnit: MeasureUnit;
}

export interface MeasureConversionResult {
  convertedQty: number;
  formula: string;
  error?: string;
}

export interface RuleOfThreeInput {
  referenceQty: number;
  referenceValue: number;
  targetQty: number;
}

export interface RuleOfThreeResult {
  targetValue: number;
  formula: string;
  error?: string;
}

const MEASURE_UNITS: MeasureUnit[] = ['ml', 'l', 'g', 'kg', 'cm', 'm'];
const COUNT_UNIT: MeasureUnit = 'un';

function isCountUnit(unit: MeasureUnit): boolean {
  return unit === 'un';
}

/** Rateia valor total pago pela quantidade usada na receita. */
export function prorateCostByMeasure(input: MeasureProrationInput): MeasureProrationResult {
  const { totalValue, totalQty, totalUnit, usedQty, usedUnit } = input;

  if (totalValue <= 0 || totalQty <= 0 || usedQty <= 0) {
    return {
      cost: 0,
      unitCostInUsedUnit: 0,
      formula: '',
      error: 'Informe valor pago, quantidade de referência e quantidade usada.',
    };
  }

  if (isCountUnit(totalUnit) || isCountUnit(usedUnit)) {
    return {
      cost: 0,
      unitCostInUsedUnit: 0,
      formula: '',
      error: 'Use o modo “Rateio por unidade (un)” para contagem.',
    };
  }

  const usedInTotalUnit = convertMeasureQuantity(usedQty, usedUnit, totalUnit);
  if (usedInTotalUnit === null) {
    return {
      cost: 0,
      unitCostInUsedUnit: 0,
      formula: '',
      error: 'Unidades incompatíveis — use a mesma família (volume, massa ou comprimento).',
    };
  }

  const totalBase = toBaseUnit(totalQty, totalUnit);
  const usedBase = toBaseUnit(usedQty, usedUnit);
  const cost = totalValue * (usedBase / totalBase);
  const unitCostInUsedUnit = cost / usedQty;

  return {
    cost,
    unitCostInUsedUnit,
    formula: `${formatCurrencyLike(totalValue)} ÷ ${formatQtyUnit(totalQty, totalUnit)} × ${formatQtyUnit(usedQty, usedUnit)}`,
  };
}

/** Rateia valor total por unidades contáveis (ex.: 3 ovos de 12 a R$ 15). */
export function prorateCostByCount(input: CountProrationInput): CountProrationResult {
  const { totalValue, totalCount, usedCount } = input;

  if (totalValue <= 0 || totalCount <= 0 || usedCount <= 0) {
    return {
      cost: 0,
      unitCost: 0,
      formula: '',
      error: 'Informe valor total, quantidade total e quantidade usada maiores que zero.',
    };
  }

  const unitCost = totalValue / totalCount;
  const cost = (usedCount / totalCount) * totalValue;

  return {
    cost,
    unitCost,
    formula: `${formatCurrencyLike(totalValue)} ÷ ${totalCount} un × ${usedCount} un`,
  };
}

/** Converte quantidade entre unidades compatíveis. */
export function convertMeasureAmount(input: MeasureConversionInput): MeasureConversionResult {
  const { qty, fromUnit, toUnit } = input;

  if (qty <= 0) {
    return { convertedQty: 0, formula: '', error: 'Informe uma quantidade maior que zero.' };
  }

  if (fromUnit === 'un' || toUnit === 'un') {
    if (fromUnit !== toUnit) {
      return {
        convertedQty: 0,
        formula: '',
        error: 'Conversão entre “un” e medidas (ml, kg…) não é permitida.',
      };
    }
    return { convertedQty: qty, formula: `${qty} un = ${qty} un` };
  }

  const converted = convertMeasureQuantity(qty, fromUnit, toUnit);
  if (converted === null) {
    return {
      convertedQty: 0,
      formula: '',
      error: 'Unidades incompatíveis — use a mesma família (volume, massa ou comprimento).',
    };
  }

  return {
    convertedQty: converted,
    formula: `${formatQtyUnit(qty, fromUnit)} = ${formatQtyUnit(converted, toUnit)}`,
  };
}

/** Regra de três: se X qty custa R$ Y, quanto custa Z qty? */
export function ruleOfThreeCost(input: RuleOfThreeInput): RuleOfThreeResult {
  const { referenceQty, referenceValue, targetQty } = input;

  if (referenceQty <= 0 || referenceValue <= 0 || targetQty <= 0) {
    return {
      targetValue: 0,
      formula: '',
      error: 'Informe quantidades e valor de referência maiores que zero.',
    };
  }

  const targetValue = (targetQty / referenceQty) * referenceValue;

  return {
    targetValue,
    formula: `${formatCurrencyLike(referenceValue)} ÷ ${referenceQty} × ${targetQty}`,
  };
}

/** Cálculos com porcentagem (markup, margem, parte do valor, etc.). */
export function calcPercent(input: PercentCalcInput): PercentCalcResult {
  const { type, percent, baseValue, increase, secondValue } = input;

  switch (type) {
    case 'parte-do-valor': {
      if (baseValue <= 0 || percent < 0) {
        return emptyPercentError('Informe valor base e percentual.');
      }
      const result = baseValue * (percent / 100);
      return {
        primaryValue: result,
        primaryLabel: 'Resultado',
        formula: `${percent}% de ${formatCurrencyLike(baseValue)}`,
      };
    }
    case 'quanto-e-percentual': {
      const part = secondValue ?? 0;
      if (part <= 0 || baseValue <= 0) {
        return emptyPercentError('Informe a parte e o valor total de referência.');
      }
      const pct = (part / baseValue) * 100;
      return {
        primaryValue: pct,
        primaryLabel: 'Percentual',
        formula: `${formatCurrencyLike(part)} ÷ ${formatCurrencyLike(baseValue)} × 100`,
      };
    }
    case 'acrescimo-desconto': {
      if (baseValue <= 0) {
        return emptyPercentError('Informe o valor base.');
      }
      const factor = (increase ?? true) ? 1 + percent / 100 : 1 - percent / 100;
      if (factor < 0) {
        return emptyPercentError('Desconto maior que 100% não é permitido.');
      }
      const result = baseValue * factor;
      const delta = result - baseValue;
      return {
        primaryValue: result,
        secondaryValue: delta,
        primaryLabel: (increase ?? true) ? 'Valor com acréscimo' : 'Valor com desconto',
        secondaryLabel: (increase ?? true) ? 'Acréscimo' : 'Desconto',
        formula: `${formatCurrencyLike(baseValue)} ${(increase ?? true) ? '+' : '−'} ${percent}%`,
      };
    }
    case 'markup': {
      if (baseValue <= 0) {
        return emptyPercentError('Informe o custo.');
      }
      const price = priceFromMarkup(baseValue, percent);
      return {
        primaryValue: price,
        secondaryValue: price - baseValue,
        primaryLabel: 'Preço de venda',
        secondaryLabel: 'Lucro',
        formula: `${formatCurrencyLike(baseValue)} + ${percent}% markup`,
      };
    }
    case 'margem': {
      if (baseValue <= 0) {
        return emptyPercentError('Informe o custo.');
      }
      if (percent >= 100) {
        return emptyPercentError('Margem deve ser menor que 100%.');
      }
      const price = priceFromMargin(baseValue, percent);
      const achievedMargin = price > 0 ? ((price - baseValue) / price) * 100 : 0;
      return {
        primaryValue: price,
        secondaryValue: achievedMargin,
        primaryLabel: 'Preço de venda',
        secondaryLabel: 'Margem sobre preço',
        formula: `${formatCurrencyLike(baseValue)} ÷ (1 − ${percent}%)`,
      };
    }
    default:
      return emptyPercentError('Tipo de cálculo inválido.');
  }
}

function emptyPercentError(message: string): PercentCalcResult {
  return {
    primaryValue: 0,
    primaryLabel: '',
    formula: '',
    error: message,
  };
}

/** Custo por unidade base (ml, g, cm) a partir do total pago. */
export function unitCostFromTotal(
  totalValue: number,
  totalQty: number,
  unit: MeasureUnit,
): { unitCostPerBase: number; unitLabel: string; error?: string } {
  if (totalValue <= 0 || totalQty <= 0) {
    return { unitCostPerBase: 0, unitLabel: '', error: 'Informe valor e quantidade totais.' };
  }
  if (unit === 'un') {
    return {
      unitCostPerBase: totalValue / totalQty,
      unitLabel: 'un',
    };
  }
  const base = toBaseUnit(totalQty, unit);
  const baseUnit = unit === 'kg' || unit === 'g' ? 'g' : unit === 'l' || unit === 'ml' ? 'ml' : 'cm';
  return {
    unitCostPerBase: totalValue / base,
    unitLabel: baseUnit,
  };
}

function formatCurrencyLike(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatNumberLike(value: number): string {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 6 });
}

export { MEASURE_UNITS, COUNT_UNIT };
