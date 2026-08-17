import type { VisionBalanceteRow, VisionPlanoRow } from '../types/accounting';
import { getClassificacao } from './demonstracoesContabeis';
import {
  type LinhaComparativoMensal,
  type PeriodoMensal,
  chaveContaComparativo,
} from './balanceteComparativoMensal';
import { type AutomacaoContaConfig } from './automatizacaoContaConfig';
import { isContaCaixaOuFundoLinha } from './balanceteGarantidaBanco';
import { aplicarLancamentosNoRazao, gerarPagamentoCaixa, gerarReforcoCaixa } from './balanceteAutoCorrecao';
import { enrichNaturezaSaldoImportado, isContaPassivoPorNome } from './naturezaContabil';
import { filtrarRazaoPorPeriodo, montarBalanceteComPeriodo } from './razaoContabil';

function normCls(cls: string): string {
  return cls.replace(/\./g, '').replace(/\s/g, '');
}

function linhasAlvoCaixaMutuo(linhas: LinhaComparativoMensal[]): LinhaComparativoMensal[] {
  return linhas.filter((l) => {
    if (l.tipo === 'S') return false;
    if (isContaCaixaOuFundoLinha(l)) return true;
    const n = (l.nome ?? '').toLowerCase();
    return /emprestimo|empr[eé]stimo|m[uú]tuo|mutuo|financiamento/i.test(n);
  });
}

/**
 * Empréstimo/mútuo credor → pagamento via caixa (ou cliente/mútuo se caixa insuficiente).
 * Usa saldos já calculados no comparativo (sem remontar balancete por conta).
 */
export function executarAutomatizacaoCaixaMutuo(params: {
  linhasComparativo: LinhaComparativoMensal[];
  periodos: PeriodoMensal[];
  razaoRows: VisionBalanceteRow[];
  planoRows: VisionPlanoRow[];
  contaConfig?: AutomacaoContaConfig;
  onProgress?: (msg: string) => void;
}): { razao: VisionBalanceteRow[]; lancamentos: VisionBalanceteRow[]; detalhes: string[] } {
  const alvo = linhasAlvoCaixaMutuo(params.linhasComparativo);
  const { periodos, planoRows, contaConfig } = params;
  let razaoAtual = params.razaoRows;
  const lancamentos: VisionBalanceteRow[] = [];
  const detalhes: string[] = [];

  if (!alvo.length) {
    return { razao: razaoAtual, lancamentos, detalhes };
  }

  for (const periodo of periodos) {
    const mesLabel = periodo.label;
    params.onProgress?.(`Caixa/empréstimo · ${mesLabel}`);

    const razaoPeriodo = filtrarRazaoPorPeriodo(razaoAtual, periodo.de, periodo.ate);
    const balanceteMesRaw = montarBalanceteComPeriodo(
      razaoAtual,
      razaoPeriodo,
      planoRows,
      periodo.de,
      periodo.ate,
    );
    const balanceteMes = balanceteMesRaw.map((r) => enrichNaturezaSaldoImportado(r, balanceteMesRaw));
    const lancamentosMes: VisionBalanceteRow[] = [];

    for (const linha of alvo) {
      const cel = linha.saldosPorMes[mesLabel];
      const rowBal =
        balanceteMes.find((r) => r.tipo !== 'S' && chaveContaComparativo(r) === linha.chave) ??
        balanceteMes.find(
          (r) => r.tipo !== 'S' && normCls(getClassificacao(r)) === normCls(linha.classificacao || ''),
        );
      if (!rowBal) continue;

      if (isContaCaixaOuFundoLinha(linha)) {
        const maiorEmp = Math.max(
          0,
          ...alvo
            .filter((l) => !isContaCaixaOuFundoLinha(l))
            .map((l) => {
              const c = l.saldosPorMes[mesLabel];
              return c && c.natureza === 'C' ? c.valor : 0;
            }),
        );
        if (maiorEmp < 0.05) continue;
        const ref = gerarReforcoCaixa({
          caixa: rowBal,
          valor: maiorEmp,
          balanceteMes,
          planoRows,
          periodo,
          mesRef: mesLabel,
          contaConfig,
        });
        if (ref.lancamentos.length) {
          lancamentosMes.push(...ref.lancamentos);
          detalhes.push(`${mesLabel} · ${linha.nome}: ${ref.msg}`);
        }
        continue;
      }

      if (!cel || cel.valor < 0.05 || cel.natureza !== 'C') continue;
      if (!isContaPassivoPorNome(rowBal) && !/emprestimo|mutuo|m[uú]tuo/i.test(linha.nome ?? '')) {
        continue;
      }

      const pag = gerarPagamentoCaixa({
        row: rowBal,
        diferenca: cel.valor,
        balanceteMes,
        planoRows,
        periodo,
        mesRef: mesLabel,
        contaConfig,
      });
      if (pag.lancamentos.length) {
        lancamentosMes.push(...pag.lancamentos);
        detalhes.push(`${mesLabel} · ${linha.nome}: ${pag.msg}`);
      }
    }

    if (lancamentosMes.length) {
      lancamentos.push(...lancamentosMes);
      razaoAtual = aplicarLancamentosNoRazao(razaoAtual, lancamentosMes);
    }
  }

  if (lancamentos.length) {
    detalhes.unshift(`Caixa/empréstimo: ${lancamentos.length} lançamento(s).`);
  }

  return { razao: razaoAtual, lancamentos, detalhes };
}
