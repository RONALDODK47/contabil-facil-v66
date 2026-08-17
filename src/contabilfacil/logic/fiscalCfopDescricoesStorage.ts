import { readManagerData, writeManagerData } from './companyWorkspace';
import type { FiscalCfopCatalogoImportado } from './fiscalCfopExcelImport';

export function loadFiscalCfopCatalogoImportado(company: string): FiscalCfopCatalogoImportado {
  const rows = readManagerData<Partial<FiscalCfopCatalogoImportado>>(company, 'fiscalCfopDescricoes');
  const stored = rows[0];
  if (!stored || typeof stored !== 'object') return {};
  const out: FiscalCfopCatalogoImportado = {};
  for (const [k, v] of Object.entries(stored)) {
    if (!v || typeof v !== 'object') continue;
    const grupo = String((v as { grupo?: unknown }).grupo ?? '').trim();
    const descricao = String((v as { descricao?: unknown }).descricao ?? '').trim();
    if (descricao) out[k] = { grupo, descricao };
  }
  return out;
}

export function saveFiscalCfopCatalogoImportado(company: string, catalogo: FiscalCfopCatalogoImportado): void {
  writeManagerData(company, 'fiscalCfopDescricoes', [catalogo]);
}
