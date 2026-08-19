import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';
import { readManagerData, writeManagerData, writeManagerDataNow, flushManagerDataWrites } from './companyWorkspace';
import { normalizeRazaoImport } from './contabilPipeline';
import { isExtratoLancamentoConciliado, type ExtratoBankRow } from './extratoConciliacaoBank';
import {
  buildRazaoFromExtratoLancamentos,
  contarEquivalentesDeOutrasOrigensDoUltimoMerge,
  mergeExtratoRazaoComExistente,
  type ConflitoDadoBalancete,
} from './extratoToRazao';

/**
 * Publica no balancete/razao apenas linhas conciliadas do extrato.
 * Nao altera saldo anterior, saldo final OCR nem os lancamentos do extrato importado.
 *
 * Remove TODOS os lançamentos antigos das contas afetadas e substitui pelos novos.
 */
export function postExtratoConciliadosNoRazao(
  companyName: string,
  extratoRows?: ExtratoBankRow[],
  forceOverwrite = false,
  /** Ver `removerEquivalentesDeOutrasOrigens` no merge — vem de confirmacao do usuario. */
  removerEquivalentesDeOutrasOrigens = false,
): {
  gerados: number;
  conflitos?: ConflitoDadoBalancete[];
  contasAfetadas?: string[];
  /** Conciliados recebidos nesta chamada (base para conferir com a aba de conciliacao). */
  conciliadosRecebidos: number;
  /** Conciliados que nao viraram partida — devolvido para o usuario ver o porque. */
  ignorados: { id: string; descricao: string; motivo: string }[];
  /** Linhas de outra origem, com o mesmo conteudo, que ficariam em dobro no balancete. */
  equivalentesDeOutrasOrigens: number;
} {
  const rows = extratoRows ?? readManagerData<ExtratoBankRow>(companyName, 'extrato');
  const conciliados = rows.filter(isExtratoLancamentoConciliado);
  const { rows: razaoRows, gerados, ignorados } = buildRazaoFromExtratoLancamentos(conciliados);

  const existente = readManagerData<VisionBalanceteRow>(companyName, 'razao');
  
  // Extrai contas afetadas para informar ao usuário
  const contasAfetadas = new Set<string>();
  for (const r of razaoRows) {
    if (r.codigo) {
      contasAfetadas.add(r.codigo);
    }
  }

  const merged = mergeExtratoRazaoComExistente(existente, razaoRows, forceOverwrite, {
    removerEquivalentesDeOutrasOrigens,
  });
  const equivalentesDeOutrasOrigens = contarEquivalentesDeOutrasOrigensDoUltimoMerge();
  const normalized = normalizeRazaoImport(merged);
  writeManagerDataNow(companyName, 'razao', normalized);
  flushManagerDataWrites();
  dispatchRazaoUpdated(companyName);

  return {
    gerados,
    contasAfetadas: Array.from(contasAfetadas),
    conciliadosRecebidos: conciliados.length,
    ignorados,
    equivalentesDeOutrasOrigens,
  };
}

function dispatchRazaoUpdated(companyName: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('contabilfacil-razao-updated', { detail: { company: companyName } }),
  );
}