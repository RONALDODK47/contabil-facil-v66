import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';
import { filtrarRazaoPorPeriodo } from '../../extratoVision/utils/razaoContabil';
import { companyStorageSlug, normalizeCompanyName } from './companyWorkspace';
import { buildTxtPlusFromRazaoVision, encontrarLancamentosNaoExportados } from './dominioTxtIO';

export type BalancetePeriodo = { de: string; ate: string };

/** Descrição de um lançamento do razão que ficou de fora do TXT exportado. */
export type LancamentoNaoExportado = {
  data: string;
  conta: string;
  historico: string;
  valor: number;
};

function descreverNaoExportados(rows: VisionBalanceteRow[]): LancamentoNaoExportado[] {
  return rows.map((r) => ({
    data: r.data ?? '—',
    conta: r.codigo || r.classificacao || '—',
    historico: r.nome || r.historico || 'LANCAMENTO',
    valor: Math.max(r.debito ?? 0, r.credito ?? 0),
  }));
}

/** Nome do TXT de exportação do balancete — inclui a empresa para não precisar renomear. */
export function buildBalanceteTxtFilename(companyName: string): string {
  const slug = companyStorageSlug(companyName) || 'EMPRESA';
  return `Balancete_${slug}.txt`;
}

/**
 * Prepara o TXT+ Domínio só com lançamentos dentro do período De/Até do balancete
 * que o usuário está visualizando — nunca exporta o razão inteiro.
 */
export function prepareBalanceteTxtExport(
  razaoRows: VisionBalanceteRow[],
  periodo: BalancetePeriodo | null | undefined,
  companyName: string,
): {
  content: string;
  filename: string;
  count: number;
  periodo: BalancetePeriodo;
  naoExportados: LancamentoNaoExportado[];
} {
  const de = periodo?.de?.trim() ?? '';
  const ate = periodo?.ate?.trim() ?? '';
  if (!de || !ate) {
    throw new Error(
      'Confirme o período De/Até do balancete antes de exportar. Só entram lançamentos dessa janela.',
    );
  }

  const noPeriodo = filtrarRazaoPorPeriodo(razaoRows, de, ate);
  if (noPeriodo.length === 0) {
    throw new Error(
      `Nenhum lançamento entre ${de} e ${ate} para exportar. Ajuste o período do balancete.`,
    );
  }

  const empresa = normalizeCompanyName(companyName);
  if (!empresa || empresa === 'SEM EMPRESA') {
    throw new Error('Selecione a empresa antes de exportar o balancete.');
  }

  const content = buildTxtPlusFromRazaoVision(noPeriodo);
  if (!content.trim()) {
    throw new Error(
      `Nenhuma partida dobrada válida entre ${de} e ${ate}. ` +
        'O Domínio exige conta de débito e de crédito em cada linha — confira se os lançamentos têm as duas contas.',
    );
  }

  const naoExportados = descreverNaoExportados(encontrarLancamentosNaoExportados(noPeriodo));

  return {
    content,
    filename: buildBalanceteTxtFilename(empresa),
    count: noPeriodo.length,
    periodo: { de, ate },
    naoExportados,
  };
}
