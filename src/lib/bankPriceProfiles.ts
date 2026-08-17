import type { ProRataDieMode, SacInterestAccrual } from './loanCalculator';

/**
 * Perfis de referência PRICE (cadastro manual). Não há API com fórmula oficial por instituição.
 */
export interface PriceBankProfileDefinition {
  id: string;
  label: string;
  note: string;
  priceInterestAccrual: SacInterestAccrual;
  proRataDieMode: ProRataDieMode;
}

export const PRICE_BANK_PROFILES: PriceBankProfileDefinition[] = [
  {
    id: 'proRata30Linear',
    label: 'Mais espelho de extrato — d ÷ 30 linear',
    note: 'Juros do saldo com dias corridos ÷ 30, taxa composta apenas se escolher «Exponencial» no Pro rata Die.',
    priceInterestAccrual: 'proRataCorridos',
    proRataDieMode: 'linear',
  },
  {
    id: 'proRata30Composto',
    label: 'Pró-rata ÷30 e composto sobre a taxa mensal',
    note: 'SD x ((1+i)^(d/30)-1): comum onde o cronograma trabalha expoente sobre sub-períodos.',
    priceInterestAccrual: 'proRataCorridos',
    proRataDieMode: 'compound',
  },
  {
    id: 'mensalCheioLinear',
    label: 'Juros por competência cheia',
    note: 'Fator temporal 1 em cada período mensal sobre o saldo (sem proporcionalização por dias corridos nas parcelas).',
    priceInterestAccrual: 'mensalContrato',
    proRataDieMode: 'linear',
  },
  {
    id: 'mensalCheioComposto',
    label: 'Competência cheia · composto mensal sobre taxa efetiva',
    note: 'Base mensal inteira aplicada exponencialmente (menos habitual em PRICE Brasil).',
    priceInterestAccrual: 'mensalContrato',
    proRataDieMode: 'compound',
  },
  {
    id: 'proRataCivilLinear',
    label: 'Pró-rata dias ÷ dias do mês civil',
    note: 'Fator com denominador igual ao comprimento civil do vencimento; alternativa quando o contrato não usa ÷30 fixo.',
    priceInterestAccrual: 'proRataMesCivil',
    proRataDieMode: 'linear',
  },
  {
    id: 'proRataCivilComposto',
    label: 'Mês civil com taxa exponencial no sub-período',
    note: 'Mesmo denominador civil, modo composto quando aplicável.',
    priceInterestAccrual: 'proRataMesCivil',
    proRataDieMode: 'compound',
  },
];

export function getPriceProfileById(id: string): PriceBankProfileDefinition | undefined {
  return PRICE_BANK_PROFILES.find((p) => p.id === id);
}

export function matchPriceBankProfile(patch: {
  priceInterestAccrual: SacInterestAccrual;
  proRataDieMode: ProRataDieMode;
}): string | undefined {
  for (const p of PRICE_BANK_PROFILES) {
    if (
      p.priceInterestAccrual === patch.priceInterestAccrual &&
      p.proRataDieMode === patch.proRataDieMode
    ) {
      return p.id;
    }
  }
  return undefined;
}
