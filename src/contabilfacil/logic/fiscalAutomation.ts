import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';
import type { SpedInvoice } from '../components/fiscal/types';
import { readManagerData, writeManagerData, flushManagerDataWrites } from './companyWorkspace';
import { normalizeRazaoImport } from './contabilPipeline';
import { loadFiscalAcumuladorRegras } from './fiscalAcumuladorRegrasStorage';
import { buildRazaoFromFiscalInvoices, mergeFiscalRazaoComExistente } from './fiscalToRazao';

/** "Mandar para o Balancete" do Fiscal: aplica as regras cadastradas (débito+crédito) em
 * cada nota/apuração já importada e lança no razão. Notas sem regra ficam de fora — o
 * chamador recebe a lista de pendências para avisar o usuário. */
export function postFiscalNoRazao(companyName: string): { gerados: number; pendencias: string[] } {
  const saved = readManagerData<{ invoices?: SpedInvoice[] }>(companyName, 'spedParserProData')[0];
  const invoices = saved?.invoices ?? [];
  const regras = loadFiscalAcumuladorRegras(companyName);

  const { rows, gerados, semRegra } = buildRazaoFromFiscalInvoices(invoices, regras);

  const pendencias = semRegra
    .slice(0, 5)
    .map(
      (inv) =>
        `Sem regra (débito+crédito) para: ${inv.description} · ${inv.participantName}${
          inv.cfop ? ` · CFOP ${inv.cfop}` : ''
        }`,
    );
  if (semRegra.length > 5) pendencias.push(`+ ${semRegra.length - 5} nota(s)/apuração(ões) sem regra.`);

  if (gerados <= 0) return { gerados: 0, pendencias };

  const existente = readManagerData<VisionBalanceteRow>(companyName, 'razao');
  const merged = normalizeRazaoImport(mergeFiscalRazaoComExistente(existente, rows));
  writeManagerData(companyName, 'razao', merged);
  flushManagerDataWrites();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('contabilfacil-razao-updated', { detail: { company: companyName } }),
    );
  }
  return { gerados, pendencias };
}
