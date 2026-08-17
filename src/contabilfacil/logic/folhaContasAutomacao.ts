export const FOLHA_RUBRICAS = [
  'SALARIO',
  'PROLABORE',
  'INSS_RECOLHER',
  'INSS_RECUPERAR',
  'FGTS_RECOLHER',
  'FGTS_RECUPERAR',
  'IRRF_RECOLHER',
  'IRRF_RECUPERAR',
] as const;

export type FolhaRubricaId = (typeof FOLHA_RUBRICAS)[number];

export type FolhaContaPar = {
  debito: string;
  credito: string;
};

export type FolhaContasAutomacaoConfig = Record<FolhaRubricaId, FolhaContaPar>;

export const FOLHA_RUBRICA_LABELS: Record<FolhaRubricaId, string> = {
  SALARIO: 'Salários / remuneração',
  PROLABORE: 'Pró-labore',
  INSS_RECOLHER: 'INSS a recolher',
  INSS_RECUPERAR: 'INSS a recuperar / compensar',
  FGTS_RECOLHER: 'FGTS a recolher',
  FGTS_RECUPERAR: 'FGTS a recuperar / compensar',
  IRRF_RECOLHER: 'IRRF a recolher',
  IRRF_RECUPERAR: 'IRRF a recuperar / compensar',
};

export function emptyFolhaContasAutomacao(): FolhaContasAutomacaoConfig {
  return {
    SALARIO: { debito: '', credito: '' },
    PROLABORE: { debito: '', credito: '' },
    INSS_RECOLHER: { debito: '', credito: '' },
    INSS_RECUPERAR: { debito: '', credito: '' },
    FGTS_RECOLHER: { debito: '', credito: '' },
    FGTS_RECUPERAR: { debito: '', credito: '' },
    IRRF_RECOLHER: { debito: '', credito: '' },
    IRRF_RECUPERAR: { debito: '', credito: '' },
  };
}

function normFolhaTexto(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function isRecuperarFolha(t: string): boolean {
  return /RECUPER|COMPENS|CREDITO|CREDOR|SALDO\s+CRED|A\s+RECUPERAR|A\s+COMPENSAR/.test(t);
}

/** Classifica histórico do relatório folha / holerite para rubrica contábil. */
export function resolveFolhaRubrica(description: string): FolhaRubricaId | null {
  const t = normFolhaTexto(description);
  if (!t) return null;

  if (/PRO\s*[- ]?LABORE|PROLABORE/.test(t)) return 'PROLABORE';

  if (/FGTS/.test(t)) {
    return isRecuperarFolha(t) ? 'FGTS_RECUPERAR' : 'FGTS_RECOLHER';
  }

  if (/INSS|GPS|PREVIDENCIA|ENCARGO\s+SOCIAL/.test(t)) {
    return isRecuperarFolha(t) ? 'INSS_RECUPERAR' : 'INSS_RECOLHER';
  }

  if (/IRRF|IMPOSTO\s+DE\s+RENDA|IR\s+RETIDO|RETENCAO\s+IR/.test(t)) {
    return isRecuperarFolha(t) ? 'IRRF_RECUPERAR' : 'IRRF_RECOLHER';
  }

  if (
    /SALARIO|SALARIOS|ORDENADO|REMUNERAC|FOLHA\s+PAG|HOLERITE|13\s*O|DECIMO|FERIAS|RESCISAO|ADIANTAMENTO/.test(
      t,
    )
  ) {
    return 'SALARIO';
  }

  return null;
}

export function contasParaFolhaRubrica(
  config: FolhaContasAutomacaoConfig,
  rubrica: FolhaRubricaId,
): FolhaContaPar {
  return config[rubrica];
}
