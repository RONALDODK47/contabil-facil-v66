export type HonorariosContaPar = {
  debito: string;
  credito: string;
};

export type HonorariosContasAutomacaoConfig = HonorariosContaPar;

export function emptyHonorariosContasAutomacao(): HonorariosContasAutomacaoConfig {
  return { debito: '', credito: '' };
}

export function honorariosContasProntas(config: HonorariosContasAutomacaoConfig): boolean {
  return Boolean(config.debito.trim() && config.credito.trim());
}
