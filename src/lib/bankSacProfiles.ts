import type { ProRataDieMode, SacInterestAccrual, SacMoneyRoundingMode } from './loanCalculator';

/**
 * Perfis de referência SAC (cadastro manual): não há API pública brasileira com a fórmula exata
 * que cada instituição aplica aos contratos. Use estes cenários típicos e ajuste com o carnê do seu banco.
 */
export interface SacBankProfileDefinition {
  id: string;
  label: string;
  note: string;
  sacInterestAccrual: SacInterestAccrual;
  proRataDieMode: ProRataDieMode;
  sacMoneyRounding: SacMoneyRoundingMode;
}

/** Parâmetros SAC do motor PRONAMPE — escolhidos pelo indexador, não pelo perfil manual. */
export const PRONAMPE_SAC_PROFILE_ID = 'pronampeSelicOver';

const PRONAMPE_SAC_PROFILE: SacBankProfileDefinition = {
  id: PRONAMPE_SAC_PROFILE_ID,
  label: 'PRONAMPE — Selic Over (DU + fatores)',
  note: 'Selic série 11 em DU; spread composto; carência capitalizada; amortização SAC = saldo incorporado ÷ parcelas restantes.',
  sacInterestAccrual: 'mensalContrato',
  proRataDieMode: 'compound',
  sacMoneyRounding: 'halfAwayFromZero',
};

/** Perfis exibidos no painel manual (sem PRONAMPE — isso fica no indexador). */
export const SAC_BANK_PROFILES: SacBankProfileDefinition[] = [
  {
    id: 'mensalLinearMeiaDistancia',
    label: 'Mais comum (referência SAC)',
    note: 'Juros = saldo x taxa a.m. x 1 por competência; amortização constante rounded meia-distância; última parcela ajuste.',
    sacInterestAccrual: 'mensalContrato',
    proRataDieMode: 'linear',
    sacMoneyRounding: 'halfAwayFromZero',
  },
  {
    id: 'linearDiasDiv30',
    note: 'Juros proporcionais a dias corridos ÷30 (contratos com pró-rata mensal).',
    label: 'Juros proporcionais (d ÷ 30), linear',
    sacInterestAccrual: 'proRataCorridos',
    proRataDieMode: 'linear',
    sacMoneyRounding: 'halfAwayFromZero',
  },
  {
    id: 'compostoDiasDiv30',
    label: 'Juros proporcionais (d ÷ 30), compostos na taxa mensal',
    note: 'SD x ((1+i)^(d/30) - 1); usado em alguns cronogramas quando o extrato trabalha expoente sobre sub-períodos.',
    sacInterestAccrual: 'proRataCorridos',
    proRataDieMode: 'compound',
    sacMoneyRounding: 'halfAwayFromZero',
  },
  {
    id: 'linearMesCivil',
    label: 'Juros proporcionais ao mês civil',
    note: 'Fator = dias no período ÷ dias do mês civil de referência (vencimento); evita sempre dividir por 30.',
    sacInterestAccrual: 'proRataMesCivil',
    proRataDieMode: 'linear',
    sacMoneyRounding: 'halfAwayFromZero',
  },
  {
    id: 'compostoMesCivil',
    label: 'Pró-rata mês civil, composto na taxa',
    note: 'Mesmo denominador civil, com expoente no sub-período (modelo menos usual).',
    sacInterestAccrual: 'proRataMesCivil',
    proRataDieMode: 'compound',
    sacMoneyRounding: 'halfAwayFromZero',
  },
  {
    id: 'mensalTruncate',
    label: 'Mensal + amortização truncada (centavos)',
    note: 'Amortização e saldos truncados em centavos (pula para baixo): útil quando o carnê coincide com esse critério.',
    sacInterestAccrual: 'mensalContrato',
    proRataDieMode: 'linear',
    sacMoneyRounding: 'truncateCentavos',
  },
];

export function getPronampeSacProfile(): SacBankProfileDefinition {
  return PRONAMPE_SAC_PROFILE;
}

export function getSacProfileById(id: string): SacBankProfileDefinition | undefined {
  if (id === PRONAMPE_SAC_PROFILE_ID || id === 'bbPronampeSelicOver') {
    return PRONAMPE_SAC_PROFILE;
  }
  return SAC_BANK_PROFILES.find((p) => p.id === id);
}

/** Id do perfil pré-definido cujos campos coincidem com `patch`; ou `undefined` se for combinação manual. */
export function matchSacBankProfile(patch: {
  sacInterestAccrual: SacInterestAccrual;
  proRataDieMode: ProRataDieMode;
  sacMoneyRounding: SacMoneyRoundingMode;
}): string | undefined {
  if (
    PRONAMPE_SAC_PROFILE.sacInterestAccrual === patch.sacInterestAccrual &&
    PRONAMPE_SAC_PROFILE.proRataDieMode === patch.proRataDieMode &&
    PRONAMPE_SAC_PROFILE.sacMoneyRounding === patch.sacMoneyRounding
  ) {
    return undefined;
  }
  for (const p of SAC_BANK_PROFILES) {
    if (
      p.sacInterestAccrual === patch.sacInterestAccrual &&
      p.proRataDieMode === patch.proRataDieMode &&
      p.sacMoneyRounding === patch.sacMoneyRounding
    ) {
      return p.id;
    }
  }
  return undefined;
}
