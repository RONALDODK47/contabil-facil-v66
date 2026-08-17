import type { VisionBalanceteRow, VisionPlanoRow } from '../types/accounting';
import { getClassificacao } from './demonstracoesContabeis';
import { type PeriodoMensal } from './balanceteComparativoMensal';
import {
  type AutomacaoContaConfig,
  type AutomacaoContaPapel,
  normClsAutomacao,
  resolverContaAutomacao,
  resolverDataAutomacao,
  rowFromVinculo,
} from './automatizacaoContaConfig';
import { aplicarLancamentosNoRazao } from './balanceteAutoCorrecao';
import { filtrarRazaoPorPeriodo, montarBalanceteComPeriodo } from './razaoContabil';
import { criarParLancamento } from './balanceteLancamentos';

/** Papéis de custo com cálculo automático (custo = faturamento × %). */
const CUSTO_PAPEIS: { papel: AutomacaoContaPapel; label: string }[] = [
  { papel: 'custo_cmv', label: 'CMV' },
  { papel: 'custo_cpv', label: 'CPV' },
  { papel: 'custo_servicos', label: 'Custo dos serviços' },
  { papel: 'custo_outros', label: 'Outros custos' },
];

function parLancamento(
  contaDeb: VisionBalanceteRow,
  contaCred: VisionBalanceteRow,
  valor: number,
  data: string,
  historico: string,
  ordem: number,
  importId: string,
): VisionBalanceteRow[] {
  return criarParLancamento({ contaDeb, contaCred, valor, data, historico, ordem, importId });
}

/**
 * Total de créditos do mês na conta de faturamento (bruto, sem subtrair débitos).
 * Usado como teto do custo: quando a conta de custo é a MESMA conta de faturamento
 * (débitos de custo lançados nela), usar o líquido (créd. − déb.) seria circular —
 * o próprio custo já lançado reduziria a base usada para calcular o próximo custo.
 */
function creditoBrutoNoMes(row: VisionBalanceteRow): number {
  return Math.max(0, row.credito ?? 0);
}

function fmtMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Lança custo = faturamento × porcentagem/100 para cada mês do comparativo.
 * Exige D, C, porcentagem > 0 e conta de faturamento na configuração de custos.
 */
export function executarLancamentoCustoPorFaturamento(params: {
  periodos: PeriodoMensal[];
  razaoRows: VisionBalanceteRow[];
  planoRows: VisionPlanoRow[];
  contaConfig?: AutomacaoContaConfig;
  onProgress?: (msg: string) => void;
}): { razao: VisionBalanceteRow[]; lancamentos: VisionBalanceteRow[]; detalhes: string[] } {
  const { periodos, planoRows, contaConfig = {}, onProgress } = params;
  // Base sem NENHUM lançamento de custo automático (de qualquer papel/rodada) — usada
  // para calcular faturamento e débito já existente. Fica sempre "limpa": se dois papéis
  // (ex.: CMV e Outros custos) apontarem para a mesma conta de destino, o processamento
  // de um não contamina o cálculo do outro nesta mesma execução.
  const razaoBase = params.razaoRows.filter((r) => !(r.importId ?? '').startsWith('custo-auto-'));
  // Acumula os lançamentos gerados — é o que volta no final (grava no razão).
  let razaoAtual = razaoBase;
  const lancamentos: VisionBalanceteRow[] = [];
  const detalhes: string[] = [];
  let ordem = 950_000;

  for (const { papel, label } of CUSTO_PAPEIS) {
    const cfgCustos = contaConfig[papel];
    const pct = cfgCustos?.porcentagemCusto ?? 0;
    const vincFat = cfgCustos?.contaFaturamento;

    if (!cfgCustos || pct <= 0 || !vincFat?.classificacao?.trim()) continue;

    const contaCusto = resolverContaAutomacao(papel, contaConfig, planoRows, undefined, 'debito');
    const contaContra = resolverContaAutomacao(papel, contaConfig, planoRows, undefined, 'credito');

    if (!contaCusto || !contaContra) {
      detalhes.push(
        `${label} (% faturamento): informe conta D (custo) e C (contrapartida) para lançar o custo calculado.`,
      );
      continue;
    }

    const clsCusto = normClsAutomacao(getClassificacao(contaCusto));

    for (const periodo of periodos) {
      onProgress?.(`${label} × faturamento · ${periodo.label}`);

      const razaoPeriodo = filtrarRazaoPorPeriodo(razaoBase, periodo.de, periodo.ate);
      const balanceteMes = montarBalanceteComPeriodo(
        razaoBase,
        razaoPeriodo,
        planoRows,
        periodo.de,
        periodo.ate,
      );

      const clsFat = normClsAutomacao(vincFat.classificacao);
      const rowFat =
        balanceteMes.find(
          (r) => r.tipo !== 'S' && normClsAutomacao(getClassificacao(r)) === clsFat,
        ) ?? rowFromVinculo(vincFat, planoRows, balanceteMes);

      if (!rowFat) {
        detalhes.push(`${label} (${periodo.label}): conta de faturamento não encontrada no balancete.`);
        continue;
      }

      const faturamento = creditoBrutoNoMes(rowFat);
      if (faturamento < 0.05) {
        detalhes.push(
          `${label} (${periodo.label}): faturamento R$ ${fmtMoeda(faturamento)} — sem lançamento.`,
        );
        continue;
      }

      const valorAlvo = Math.round(faturamento * (pct / 100) * 100) / 100;
      if (valorAlvo < 0.05) continue;

      // Débito já existente (manual/outra origem) na conta de destino do custo —
      // o lançamento automático completa só a diferença até o alvo (faturamento × %),
      // para não ultrapassar o teto configurado quando já houver algo lançado na conta.
      const rowCusto = balanceteMes.find(
        (r) => r.tipo !== 'S' && normClsAutomacao(getClassificacao(r)) === clsCusto,
      );
      const debitoExistente = Math.max(0, rowCusto?.debito ?? 0);
      const valorCusto = Math.round(Math.max(0, valorAlvo - debitoExistente) * 100) / 100;

      if (valorCusto < 0.05) {
        detalhes.push(
          debitoExistente > 0.005
            ? `${label} (${periodo.label}): conta de custo já tem R$ ${fmtMoeda(debitoExistente)} em débito — cobre o alvo de R$ ${fmtMoeda(valorAlvo)} (${pct}% × faturamento) — nada lançado.`
            : `${label} (${periodo.label}): faturamento R$ ${fmtMoeda(faturamento)} × ${pct}% = R$ ${fmtMoeda(valorAlvo)} — abaixo do mínimo para lançar.`,
        );
        continue;
      }

      const data = resolverDataAutomacao(periodo, contaConfig);
      const importId = `custo-auto-${papel}-${periodo.de}_${periodo.ate}`;
      const hist = `[Auto ${label.toLowerCase()}] ${pct}% × faturamento ${vincFat.classificacao} (${periodo.label})`;
      const par = parLancamento(contaCusto, contaContra, valorCusto, data, hist, ordem, importId);
      ordem += 2;

      lancamentos.push(...par);
      razaoAtual = aplicarLancamentosNoRazao(razaoAtual, par);
      detalhes.push(
        debitoExistente > 0.005
          ? `${label} (${periodo.label}): alvo R$ ${fmtMoeda(valorAlvo)} (${pct}% × R$ ${fmtMoeda(faturamento)}) − R$ ${fmtMoeda(debitoExistente)} já debitado = R$ ${fmtMoeda(valorCusto)} lançado.`
          : `${label} (${periodo.label}): faturamento R$ ${fmtMoeda(faturamento)} × ${pct}% = R$ ${fmtMoeda(valorCusto)}.`,
      );
    }
  }

  return { razao: razaoAtual, lancamentos, detalhes };
}
