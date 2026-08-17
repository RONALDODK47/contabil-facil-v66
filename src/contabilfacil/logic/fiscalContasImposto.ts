export const FISCAL_IMPOSTOS = [
  'PIS',
  'COFINS',
  'ICMS',
  'IRRF',
  'CSLL',
  'SIMPLES_NACIONAL',
] as const;
export type FiscalImpostoId = (typeof FISCAL_IMPOSTOS)[number];

export type FiscalContaPar = {
  /** Contas para imposto / acumulador a recolher (passivo). */
  debito: string;
  credito: string;
  /** Contas para crédito tributário / imposto a recuperar (ativo). */
  debitoRecuperar: string;
  creditoRecuperar: string;
  /**
   * Só acumuladores: marca o código como valor só fiscal — sai da contagem de lançamentos
   * e não pode ser enviado ao balancete (fica numa tabela separada).
   */
  valorFiscal?: boolean;
};

export type FiscalContasImpostoConfig = Record<FiscalImpostoId, FiscalContaPar>;

export type FiscalContaParLancamento = Pick<FiscalContaPar, 'debito' | 'credito'>;

export const FISCAL_IMPOSTO_LABELS: Record<FiscalImpostoId, string> = {
  PIS: 'PIS / Pasep',
  COFINS: 'COFINS',
  ICMS: 'ICMS',
  IRRF: 'IRRF',
  CSLL: 'CSLL',
  SIMPLES_NACIONAL: 'Simples Nacional',
};

export function emptyFiscalContasImposto(): FiscalContasImpostoConfig {
  const vazio = (): FiscalContaPar => ({
    debito: '',
    credito: '',
    debitoRecuperar: '',
    creditoRecuperar: '',
  });
  return {
    PIS: vazio(),
    COFINS: vazio(),
    ICMS: vazio(),
    IRRF: vazio(),
    CSLL: vazio(),
    SIMPLES_NACIONAL: vazio(),
  };
}

/** Mapeia rótulo do SPED / importação para o imposto configurável. */
export function resolveFiscalImpostoId(impostoLabel: string): FiscalImpostoId | null {
  const t = impostoLabel.trim().toUpperCase();
  if (!t) return null;
  if (
    t.includes('SIMPLES') ||
    /\bDAS\b/.test(t) ||
    t.includes('PGDAS') ||
    t.includes('DOCUMENTO DE ARRECADACAO DO SIMPLES')
  ) {
    return 'SIMPLES_NACIONAL';
  }
  if (t.includes('PIS') || t.includes('PASEP')) return 'PIS';
  if (t.includes('COFINS')) return 'COFINS';
  if (t.includes('ICMS') || t.includes('IPI')) return 'ICMS';
  if (t.includes('IRRF') || t.includes('IR RETIDO')) return 'IRRF';
  if (t.includes('CSLL')) return 'CSLL';
  return null;
}

export function contasParaImposto(
  config: FiscalContasImpostoConfig,
  impostoLabel: string,
): FiscalContaPar {
  const id = resolveFiscalImpostoId(impostoLabel);
  if (!id) return emptyFiscalContasImposto().PIS;
  return config[id];
}

/** Par débito/crédito conforme natureza do lançamento (a recolher ou a recuperar). */
export function contasParaImpostoLancamento(
  config: FiscalContasImpostoConfig,
  impostoLabel: string,
  natureza: 'devedora' | 'credora',
): FiscalContaParLancamento {
  const par = contasParaImposto(config, impostoLabel);
  if (natureza === 'devedora') {
    return { debito: par.debitoRecuperar.trim(), credito: par.creditoRecuperar.trim() };
  }
  return { debito: par.debito.trim(), credito: par.credito.trim() };
}
