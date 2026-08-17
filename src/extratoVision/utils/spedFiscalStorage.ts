import type { SpedFiscalResumoArquivo } from './spedFiscalParser';

const KEY = 'extratoVision.spedFiscalUltimos';

export type SpedFiscalUltimosSalvos = {
  contrib?: SpedFiscalResumoArquivo;
  icms?: SpedFiscalResumoArquivo;
  updatedAt: string;
};

export function readSpedFiscalUltimos(): SpedFiscalUltimosSalvos | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SpedFiscalUltimosSalvos;
  } catch {
    return null;
  }
}

export function saveSpedFiscalUltimos(resumos: SpedFiscalResumoArquivo[]): void {
  // ⚠️ DISABLED: Salva SOMENTE no Docker, não em localStorage
  void resumos;
}
