import { assertSomenteCodigoReduzido, sanitizeCodigoReduzido } from './planoContasMapper';
import { readManagerData, writeManagerData } from './companyWorkspace';
import {
  emptyHonorariosContasAutomacao,
  type HonorariosContasAutomacaoConfig,
} from './honorariosContasAutomacao';

function loadPlanoCompletoForContaResolve(companyName: string): Array<{
  code: string;
  name: string;
  codigoReduzido?: string;
  tipo?: string;
}> {
  return readManagerData<{
    code?: string;
    name?: string;
    codigoReduzido?: string;
    tipo?: string;
  }>(companyName, 'plano')
    .map((r) => ({
      code: String(r.code ?? '').trim(),
      name: String(r.name ?? '').trim(),
      codigoReduzido: sanitizeCodigoReduzido(r.codigoReduzido),
      tipo: r.tipo,
    }))
    .filter((r) => r.code || r.codigoReduzido);
}

export function loadHonorariosContasAutomacao(companyName: string): HonorariosContasAutomacaoConfig {
  const base = emptyHonorariosContasAutomacao();
  const plano = loadPlanoCompletoForContaResolve(companyName);
  const rows = readManagerData<Partial<HonorariosContasAutomacaoConfig>>(
    companyName,
    'honorariosContasAutomacao',
  );
  const stored = rows[0];
  if (!stored || typeof stored !== 'object') return base;
  const debito = String(stored.debito ?? '').trim();
  const credito = String(stored.credito ?? '').trim();
  return {
    debito: debito ? assertSomenteCodigoReduzido(debito, plano) : '',
    credito: credito ? assertSomenteCodigoReduzido(credito, plano) : '',
  };
}

export function saveHonorariosContasAutomacao(
  companyName: string,
  config: HonorariosContasAutomacaoConfig,
): void {
  writeManagerData(companyName, 'honorariosContasAutomacao', [config]);
}
