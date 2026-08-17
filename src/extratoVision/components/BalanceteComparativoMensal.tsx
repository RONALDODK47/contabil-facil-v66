import React, {
  memo,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import type { VisionBalanceteRow, VisionPlanoRow } from '../types/accounting';
import {
  buildPeriodosMensaisEntreDatas,
  filtrarPeriodosComMovimentoNasLinhas,
  montarComparativoMensalAsync,
  type LinhaComparativoMensal,
  type PeriodoMensal,
  type SaldoMensalCelula,
} from '../utils/balanceteComparativoMensal';
import { aplicarLancamentosNoRazao } from '../utils/balanceteAutoCorrecao';
import {
  deveUsarWorkerComparativo,
  montarComparativoNoWorker,
} from '../utils/comparativoMensalWorkerClient';
import {
  deduplicarLinhasBanco,
  executarCicloGarantidaDiario,
  isContaBancoLinha,
  isLancamentoCompensacaoGarantida,
} from '../utils/balanceteGarantidaBanco';
import {
  executarAutomatizacaoCompleta,
  isDetalheErroAutomatizacao,
  type ResultadoAutomatizacaoCompleta,
} from '../utils/balanceteAutomatizacaoCompleta';
import {
  executarAutomatizacaoNoWorker,
  workerAutomacaoDisponivel,
} from '../utils/automacaoBalanceteWorkerClient';
import { readFiscalContaMap } from '../utils/fiscalContaMapping';
import { enriquecerContrapartidasCompostas } from '../utils/dominioLancamentosTxt';
import { contasSaoIguaisEDevemSerLimpa } from '../utils/balanceteLancamentos';
import { exportAutomatizacaoBalancetePdf } from '../utils/balanceteAutomatizacaoPdf';
import { exportBalanceteComparativoPdf } from '../utils/balanceteComparativoPdf';
import { exportBalanceteInvertidasPdf } from '../utils/balanceteInvertidasPdf';
import { getNaturezaEsperada, isContaNaturezaAmbigua } from '../utils/naturezaContabil';
import { calcularIndicesFinanceiros, type IndicesFinanceiros } from '../utils/indicesFinanceiros';
import { parseBrDateToTime } from '../utils/dateBounds';
import ComparativoVirtualBody from '../../contabilfacil/components/ComparativoVirtualBody';
import { RazaoContaRateioModal } from '../../contabilfacil/components/RazaoContaRateioModal';
import type { LancamentosTransferencia } from '../../contabilfacil/components/RazaoContaRateioModal';
import ExtratoContaPicker, { type ExtratoPlanoContaOption } from '../../contabilfacil/components/ExtratoContaPicker';
import { emitTabBotResult } from '../../contabilfacil/tabBot/tabBotBridge';
import { useVirtualWindow } from '../../contabilfacil/lib/useVirtualWindow';
import { AutomatizacaoContaConfigModal } from './AutomatizacaoContaConfigModal';
import {
  RazaoContaLancamentosModal,
  chaveLancamentoRazao,
  coletarLancamentosCausaRaizInvertidos,
  contaTemRazaoInvertido,
  type RazaoContaModo,
} from './RazaoContaLancamentosModal';
import {
  type AutomacaoContaConfig,
  isValidBrDate,
  PAPEIS_AUTOMACAO_UI,
  papeisConfiguradosCount,
  readAutomatizacaoContaConfig,
} from '../utils/automatizacaoContaConfig';
import { auditarBalanceteContinuo } from '../utils/auditoriaBalanceteContinua';
import { readReceitaFederalRegras } from '../utils/receitaFederalRegras';
import { filtrarRazaoPorPeriodo, montarBalanceteComPeriodo, extrairPeriodoRazao } from '../utils/razaoContabil';
import {
  readNaturezaManualEntries,
  readNaturezaFolders,
  upsertNaturezaFolder,
  deleteNaturezaFolder,
  setActiveNaturezaManualEntries,
  type NaturezaRegraFolder,
} from '../utils/naturezaManualConfig';
import NaturezaContasManualModal from './NaturezaContasManualModal';
import ExcluirMesesContasModal from './ExcluirMesesContasModal';
import { loadCompaniesRegistry, belongsToCompany } from '../../contabilfacil/logic/companyWorkspace';
import { normalizeExtratoContaParaGravacao } from '../../contabilfacil/logic/planoContasMapper';
import { detectarLancamentosSemContrapartida } from '../../contabilfacil/logic/dominioTxtIO';
import { removerDuplicatasCodigoInconsistente } from '../../contabilfacil/logic/contabilPipeline';
import { executarLancamentoCustoPorFaturamento } from '../utils/balanceteCustoFaturamento';
import { executarEmprestimoEntreColigadas } from '../utils/balanceteAutomatizacaoColigadas';
import { aplicarCorrecaoEmprestimo } from '../../contabilfacil/logic/loanCorrecaoAutomation';
import { loadContractsFromBrowserStorage } from '../../lib/savedContractStorage';
import {
  lerLoanScheduleBalanceCache,
  saldoTabelaNaData,
  saldoCurtoTabelaNaData,
  saldoLongoTabelaNaData,
} from '../../contabilfacil/logic/loanScheduleBalanceCache';
import { parseISO } from 'date-fns';

/**
 * Linha do razão exibida em "Somente Razão" que pode ser uma CÓPIA (merge de
 * duas pernas débito+crédito), não a mesma referência do objeto em `razaoRows`.
 * `__origKeyDeb`/`__origKeyCred` guardam a chave de identidade (getRazaoRowKey) do
 * lançamento real de onde veio cada lado, para permitir localizá-lo na hora de
 * salvar uma edição direta.
 */
type RazaoRowComOrigem = VisionBalanceteRow & {
  __origKeyDeb?: string;
  __origKeyCred?: string;
};

type Props = {
  razaoRows: VisionBalanceteRow[];
  planoRows: VisionPlanoRow[];
  onRazaoRowsChange: (rows: VisionBalanceteRow[]) => void;
  /** Período confirmado no filtro superior (só monta após OK no pai). */
  periodoDe: string;
  periodoAte: string;
  folhaRows?: VisionBalanceteRow[];
  fiscalRows?: VisionBalanceteRow[];
  empresaNome?: string;
  /** ContabilFacil: mesma lógica, visual técnico do módulo gerencial. */
  surface?: 'vision' | 'contabilfacil';
  /** ContabilFacil: injeta filtro e ações no card de período do pai. */
  setPeriodToolbar?: (node: React.ReactNode | null) => void;
  /** ContabilFacil: quantidade de docs. importados (TXT) — mostra o item no menu Configuração. */
  docsImportadosCount?: number;
  /** ContabilFacil: abre o modal de "Docs. Importados" (mantido no componente pai). */
  onAbrirDocsImportados?: () => void;
  /** ContabilFacil: logs da importação de balancete. */
  importedLogs?: string[];
  /** ContabilFacil: abre o modal de logs. */
  onAbrirLogs?: () => void;
};

const COLS_FIXAS = 9;

/** Só erros críticos na tela; contas OK e avisos informativos ficam no PDF. */
function coletarErrosRestantes(resultado: ResultadoAutomatizacaoCompleta): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (texto: string) => {
    const t = texto.trim();
    if (!t || seen.has(t)) return;
    if (/sem saldo credor|zerado|pr[oó]ximo m[eê]s/i.test(t)) return;
    if (!isDetalheErroAutomatizacao(t)) return;
    seen.add(t);
    out.push(t);
  };
  resultado.erros.forEach(add);
  (resultado.advertencias ?? []).forEach((a) => add(a.textoCompleto));
  return out;
}

function parseValorBusca(raw: string): number {
  const t = raw.trim();
  if (!t) return 0;
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number(norm);
  return Number.isFinite(n) ? n : 0;
}

/** yyyy-mm-dd (input type=date) → DD/MM/AAAA */
function buscaDateToBr(val: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(val);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** DD/MM/AAAA → yyyy-mm-dd (input type=date) */
function buscaBrToDate(val: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(val);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

function fmtMoedaIndices(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtIndiceDecimal(v: number | null): string {
  return v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtIndicePercentual(v: number | null): string {
  return v == null ? '—' : `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function IndicesFinanceirosModal({
  open,
  onClose,
  indices,
  contabil,
}: {
  open: boolean;
  onClose: () => void;
  indices: IndicesFinanceiros | null;
  contabil: boolean;
}) {
  if (!open) return null;

  const overlayClass = contabil
    ? 'fixed inset-0 z-[200] flex items-center justify-center p-4 bg-brand-text/40'
    : 'fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70';
  const shellClass = contabil
    ? 'w-full max-w-2xl max-h-[88vh] overflow-hidden flex flex-col technical-panel shadow-[8px_8px_0_0_#141414] bg-brand-bg'
    : 'w-full max-w-2xl max-h-[88vh] overflow-hidden flex flex-col rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl';
  const headerClass = contabil
    ? 'px-4 py-3 border-b border-brand-border flex items-center justify-between gap-2 bg-brand-sidebar/40 shrink-0'
    : 'px-4 py-3 border-b border-slate-700 flex items-center justify-between gap-2 shrink-0';

  const grupoRow = (label: string, valor: number | undefined) => (
    <div className="flex items-center justify-between text-[11px] py-1.5 border-b border-slate-700/40 last:border-0">
      <span className="opacity-70">{label}</span>
      <span className="font-mono font-bold">R$ {fmtMoedaIndices(valor ?? 0)}</span>
    </div>
  );

  const indiceCard = (
    titulo: string,
    valor: string,
    formula: string,
    leitura: string,
  ) => (
    <div className={contabil ? 'technical-panel p-3 bg-brand-sidebar/15' : 'rounded-lg border border-slate-700 bg-slate-950/60 p-3'}>
      <p className="text-[9px] font-black uppercase tracking-widest opacity-60">{titulo}</p>
      <p className="text-2xl font-black font-mono mt-1">{valor}</p>
      <p className="text-[9px] opacity-50 mt-1">{formula}</p>
      <p className="text-[10px] mt-1.5 opacity-80">{leitura}</p>
    </div>
  );

  return (
    <div className={overlayClass} role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={shellClass} onClick={(e) => e.stopPropagation()}>
        <div className={headerClass}>
          <div>
            <h3 className={contabil ? 'text-[10px] font-black uppercase tracking-widest' : 'text-sm font-bold'}>
              Índices financeiros
            </h3>
            {indices && <p className="text-[9px] opacity-50 mt-0.5">Posição em {indices.dataReferencia}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className={contabil ? 'p-1 border border-brand-border hover:bg-brand-border hover:text-brand-bg' : 'px-2 text-slate-400 hover:text-white'}
            aria-label="Fechar"
          >
            ×
          </button>
        </div>
        <div className={contabil ? 'flex-1 overflow-y-auto p-4 space-y-4 bg-brand-bg' : 'flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4'}>
          {!indices ? (
            <p className="text-[11px] opacity-60">Sem dados suficientes no razão para calcular os índices.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {indiceCard(
                  'Liquidez corrente',
                  fmtIndiceDecimal(indices.liquidezCorrente),
                  'Ativo circulante ÷ Passivo circulante',
                  (indices.liquidezCorrente ?? 0) >= 1
                    ? 'Tem mais a receber no curto prazo do que a pagar.'
                    : 'Tem mais a pagar no curto prazo do que a receber.',
                )}
                {indiceCard(
                  'Liquidez seca',
                  fmtIndiceDecimal(indices.liquidezSeca),
                  '(Ativo circulante − Estoques) ÷ Passivo circulante',
                  'Igual à liquidez corrente, mas sem contar com a venda do estoque.',
                )}
                {indiceCard(
                  'Liquidez geral',
                  fmtIndiceDecimal(indices.liquidezGeral),
                  '(Ativo circ. + não circ.) ÷ (Passivo circ. + não circ.)',
                  'Capacidade de pagar tudo que deve com tudo que tem, no longo prazo.',
                )}
                {indiceCard(
                  'Endividamento geral',
                  fmtIndicePercentual(indices.endividamentoGeral),
                  '(Passivo circ. + não circ.) ÷ Ativo total',
                  'Quanto do ativo total é financiado por dívida (terceiros).',
                )}
              </div>

              <div className={contabil ? 'technical-panel p-3 bg-brand-sidebar/15' : 'rounded-lg border border-slate-700 bg-slate-950/60 p-3'}>
                <p className="text-[9px] font-black uppercase tracking-widest opacity-60 mb-2">Composição usada no cálculo</p>
                {grupoRow('Ativo circulante', indices.ativoCirculante)}
                {grupoRow('  dos quais Estoques', indices.estoques)}
                {grupoRow('Ativo não circulante', indices.ativoNaoCirculante)}
                {grupoRow('Ativo total', indices.ativoTotal)}
                {grupoRow('Passivo circulante', indices.passivoCirculante)}
                {grupoRow('Passivo não circulante', indices.passivoNaoCirculante)}
                {grupoRow('Patrimônio líquido', indices.patrimonioLiquido)}
              </div>
              <p className="text-[9px] opacity-40">
                Liquidez geral usa todo o ativo não circulante como aproximação do realizável a longo
                prazo — o plano de contas não separa isso do imobilizado/intangível.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultadoAutomatizacaoCompacto({ resultado }: { resultado: ResultadoAutomatizacaoCompleta }) {
  const errosRestantes = useMemo(() => coletarErrosRestantes(resultado), [resultado]);

  if (!errosRestantes.length) {
    return (
      <p className="text-[10px] text-emerald-400/90 w-full">
        {resultado.mensagem}
        {resultado.contasCorrigidas.length > 0 && (
          <span className="text-emerald-500/70">
            {' '}
            · {resultado.contasCorrigidas.length} conta(s) — detalhes no PDF Relatório
          </span>
        )}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-start gap-2 w-full">
      <p className="text-[10px] text-slate-500 shrink-0 max-w-[220px] leading-snug">
        {resultado.lancamentosGerados.length > 0
          ? `${resultado.lancamentosGerados.length} lançamento(s) gravado(s).`
          : 'Automatização concluída com pendências.'}
      </p>
      <div
        className="w-[148px] h-[148px] shrink-0 overflow-hidden rounded-md border-2 border-red-500 bg-red-950/50 shadow-inner shadow-red-900/30 flex flex-col"
        title="Erros que ainda restam — lista completa no PDF Relatório"
      >
        <p className="text-[8px] font-black uppercase tracking-wider text-red-300 bg-red-900/60 px-1.5 py-1 border-b border-red-500/50 text-center">
          {errosRestantes.length} erro(s)
        </p>
        <ul className="flex-1 overflow-y-auto custom-scrollbar px-1.5 py-1 space-y-1 text-[8px] leading-tight text-red-200">
          {errosRestantes.map((linha, i) => (
            <li key={`err-c-${i}`} className="break-words">
              {linha}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-[9px] text-slate-500 self-end">
        Relatório (PDF) traz contas corrigidas e todas as advertências.
      </p>
    </div>
  );
}

function CelulaSaldoMes({ cel, contabil }: { cel: SaldoMensalCelula | null | undefined; contabil?: boolean }) {
  if (!cel) {
    return <span className={contabil ? 'text-slate-400' : 'text-slate-500'}>—</span>;
  }
  if (cel.valor < 0.001) {
    return (
      <span className={`font-mono ${contabil ? 'text-slate-500' : 'text-slate-400'}`}>
        0,00
      </span>
    );
  }
  const valorFmt = cel.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const invertida = cel.invertido === true;
  const natClass = invertida
    ? contabil
      ? 'text-red-900 bg-red-200 px-0.5'
      : 'text-red-100 bg-red-800 px-1'
    : cel.natureza === 'D'
      ? contabil
        ? 'text-slate-800'
        : 'text-slate-200'
      : contabil
        ? 'text-emerald-800'
        : 'text-emerald-300';
  const valorClass = invertida
    ? contabil
      ? 'font-bold text-red-900'
      : 'text-red-50 font-bold'
    : contabil
      ? 'font-bold text-brand-text'
      : 'text-white font-bold';
  return (
    <span
      className={`inline-flex items-baseline justify-end gap-1 whitespace-nowrap ${contabil ? 'font-mono' : ''} ${invertida ? (contabil ? 'ring-1 ring-red-700 rounded-sm px-0.5' : '') : ''
        }`}
    >
      <span className={valorClass}>{valorFmt}</span>
      <span className={`text-[10px] font-black uppercase ${natClass}`}>{cel.natureza}</span>
    </span>
  );
}

/** Largura padrão da coluna Descrição — fixa, para a coluna não "dançar" durante
 * a rolagem virtualizada (ver comentário em `descricaoNomeCompleto` no pai).
 * O nome é truncado com reticências e o título mostra o texto inteiro. */
const DESCRICAO_COL_W = 'w-[220px] min-w-[220px] max-w-[220px]';
/** Modo "Nomes completos": a coluna acompanha o maior nome (sem `max-w`), e o
 * texto NÃO é truncado — a tabela rola na horizontal. Antes esta era só outra
 * largura fixa (420px), então nome mais longo que isso continuava abreviado,
 * que é exatamente o que a opção promete evitar. Altura da linha continua fixa
 * porque o texto segue em uma única linha (`whitespace-nowrap`). */
const DESCRICAO_COL_W_COMPLETO = 'w-auto min-w-[420px] whitespace-nowrap';

const ComparativoLinha = memo(function ComparativoLinha({
  linha,
  periodos,
  mesRef,
  contabil = false,
  fixedHeight = false,
  onAbrirRazao,
  diasInvertidosFilter = false,
  descricaoNomeCompleto = false,
}: {
  linha: LinhaComparativoMensal;
  periodos: PeriodoMensal[];
  mesRef: string;
  contabil?: boolean;
  fixedHeight?: boolean;
  onAbrirRazao?: (linha: LinhaComparativoMensal, modo: RazaoContaModo) => void;
  diasInvertidosFilter?: boolean;
  descricaoNomeCompleto?: boolean;
}) {
  const natEsp = linha.naturezaCodigo ?? 'D';
  const natLabel = linha.naturezaLabel ?? 'Conta';

  // Nível hierárquico: número de segmentos na classificação (ex: "2.1.5" = 3)
  const nivelCls = (linha.classificacao || '').split('.').filter(Boolean).length || 1;
  const isSintetica = linha.tipo === 'S';
  // Grupos principais: ATIVO, PASSIVO, PL, RECEITA, CUSTO, DESPESA (nível 1 — 1 segmento)
  const isGrupoPrincipal = isSintetica && nivelCls === 1;
  // Sub-grupos diretos do grupo principal (nível 2)
  const isSubGrupo = isSintetica && nivelCls === 2;
  // Sintéticas intermediárias (nível 3)
  const isSinteticaMid = isSintetica && nivelCls === 3;

  // Hierarquia visual: grupo principal > subgrupo > sintética mid > sintética deep > analítica
  // Usa ! (important) para sobrescrever o font-size definido em .technical-grid-row (index.css).
  const fontSizeRow = isGrupoPrincipal
    ? '!text-[17px]'
    : isSubGrupo
      ? '!text-[15px]'
      : isSinteticaMid
        ? '!text-[13px]'
        : isSintetica
          ? '!text-[12px]'
          : '!text-[11px]';

  const fontWeightRow = isGrupoPrincipal
    ? '!font-black tracking-wide'
    : isSubGrupo
      ? '!font-black'
      : isSintetica
        ? '!font-bold'
        : '!font-normal';

  // Usa só cel.invertido (já calculado por detectarInversao, que trata sintéticas,
  // dedutoras "(-)", redutoras de PL e contas de natureza ambígua). Comparar
  // cel.natureza !== natEsp direto aqui ignorava essas exceções e sinalizava
  // sintéticas e contas corretas como "invertida" por engano.
  const celulaInvertida = (cel: SaldoMensalCelula | null | undefined) =>
    !!(cel && cel.valor >= 0.01 && cel.invertido === true);

  const invertidoPeriodo = periodos.some((p) => celulaInvertida(linha.saldosPorMes[p.label]));
  // Quando filtro de "dias invertidos" está ativo, força cor vermelha mesmo sem inversão no saldo final
  const deveAparecerEmVermelho = invertidoPeriodo || diasInvertidosFilter;

  const rowClass = deveAparecerEmVermelho
    ? contabil
      ? 'technical-grid-row bg-red-200 border-l-4 border-l-red-800'
      : 'bg-red-950/70 hover:bg-red-900/80 border-l-4 border-l-red-600'
    : contabil
      ? 'technical-grid-row'
      : 'hover:bg-slate-700/30 bg-slate-950/40';

  const hlClass = (active: boolean) =>
    contabil ? (active ? 'bg-brand-sidebar/50' : '') : active ? 'bg-cyan-950/25' : '';

  const cellPad = fixedHeight ? 'px-2 py-1 leading-tight' : 'p-2';

  const linkContaClass = onAbrirRazao
    ? contabil
      ? 'font-mono font-bold cursor-pointer underline decoration-dotted underline-offset-2 hover:opacity-80 text-left w-full'
      : 'font-mono text-blue-300 cursor-pointer underline decoration-dotted underline-offset-2 hover:opacity-80 text-left w-full'
    : '';

  const linkClsClass = onAbrirRazao
    ? contabil
      ? 'font-mono cursor-pointer underline decoration-dotted underline-offset-2 hover:opacity-80 text-left w-full'
      : 'font-mono text-cyan-400 cursor-pointer underline decoration-dotted underline-offset-2 hover:opacity-80 text-left w-full'
    : '';

  const abrir = (modo: RazaoContaModo) => onAbrirRazao?.(linha, modo);

  return (
    <tr
      className={`${rowClass} ${fontSizeRow} ${fontWeightRow}${fixedHeight ? ' h-10 max-h-10 overflow-hidden' : ''}`}
      title={
        invertidoPeriodo
          ? `Saldo credor/devedor diverge da natureza ${natLabel} (CPC) — confira todos os meses em vermelho`
          : undefined
      }
    >
      <td className={`${cellPad} font-mono ${contabil ? 'font-bold' : 'text-blue-300'}`}>
        {onAbrirRazao ? (
          <button
            type="button"
            className={linkContaClass}
            title="Abrir razão pelo código"
            onClick={() => abrir('codigo')}
          >
            {linha.codigo}
          </button>
        ) : (
          linha.codigo
        )}
      </td>
      <td className={`${cellPad} font-mono ${contabil ? '' : 'text-cyan-400'}`}>
        {onAbrirRazao ? (
          <button
            type="button"
            className={linkClsClass}
            title="Abrir razão pela classificação"
            onClick={() => abrir('classificacao')}
          >
            {linha.classificacao || '—'}
          </button>
        ) : (
          linha.classificacao || '—'
        )}
      </td>
      <td
        className={`${cellPad} uppercase ${isSintetica ? 'font-bold' : ''} ${contabil ? 'italic' : 'text-slate-200'} ${descricaoNomeCompleto ? DESCRICAO_COL_W_COMPLETO : DESCRICAO_COL_W} align-middle`}
      >
        <div className={`flex items-center gap-2 ${descricaoNomeCompleto ? '' : 'min-w-0'}`}>
          <span
            className={
              descricaoNomeCompleto
                ? 'whitespace-nowrap'
                : 'truncate whitespace-nowrap overflow-hidden min-w-0'
            }
            title={linha.nome}
          >
            {linha.nome}
          </span>
          {invertidoPeriodo && (
            <span
              className={
                contabil
                  ? 'shrink-0 text-[8px] font-black text-red-900 bg-red-300 px-1 uppercase'
                  : 'shrink-0 inline-flex px-1.5 py-0.5 rounded text-[8px] font-black bg-red-700 text-white border border-red-500 uppercase'
              }
            >
              Invertida
            </span>
          )}
        </div>
      </td>
      <td className={`${cellPad} text-center whitespace-nowrap`}>
        {linha.tipo === 'S' ? (contabil ? 'S' : (
          <span
            translate="no"
            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30"
          >
            Sintética
          </span>
        )) : contabil ? 'A' : (
          <span
            translate="no"
            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
          >
            Analítica
          </span>
        )}
      </td>
      {periodos.map((p, idx) => {
        const det = linha.detalhePorMes[p.label];
        const dataMes = det?.data || p.de;
        const hl = hlClass(p.label === mesRef);
        return (
          <React.Fragment key={`${linha.chave}-m-${p.label}`}>
            <td
              className={`${cellPad} font-mono whitespace-nowrap ${hl} ${contabil ? '' : 'text-violet-300'}`}
              title={`Data referência ${p.label}`}
            >
              {dataMes}
            </td>
            <td className={`${cellPad} text-right font-mono ${hl} ${contabil ? '' : 'text-slate-300'}`}>{det?.si ?? '—'}</td>
            <td className={`${cellPad} text-right font-mono ${hl} ${contabil ? '' : 'text-red-400'}`}>{det?.deb ?? '—'}</td>
            <td className={`${cellPad} text-right font-mono ${hl} ${contabil ? '' : 'text-emerald-400'}`}>{det?.cred ?? '—'}</td>
            <td
              className={`${cellPad} text-right font-mono whitespace-nowrap ${hl} ${celulaInvertida(linha.saldosPorMes[p.label])
                ? contabil
                  ? 'bg-red-200/90'
                  : 'bg-red-950/50'
                : ''
                }`}
            >
              <CelulaSaldoMes cel={linha.saldosPorMes[p.label]} contabil={contabil} />
            </td>
          </React.Fragment>
        );
      })}
      <td className={`${cellPad} text-center whitespace-nowrap ${contabil ? '' : 'sticky right-0 bg-slate-950/95 z-[1]'}`}>
        <span
          translate="no"
          className={
            contabil
              ? 'inline-flex items-center gap-1 font-bold text-[10px]'
              : `inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border ${natEsp === 'D'
                ? 'bg-red-500/10 text-red-300 border-red-500/30'
                : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
              }`
          }
          title={`Natureza da conta: ${natLabel} (CPC)`}
        >
          {natEsp}
          <span className="font-normal opacity-90">{natLabel}</span>
        </span>
      </td>
    </tr>
  );
});

function ComparativoMensalInner({
  razaoRows,
  planoRows,
  onRazaoRowsChange,
  periodoDe,
  periodoAte,
  folhaRows = [],
  fiscalRows = [],
  empresaNome = '',
  surface = 'vision',
  setPeriodToolbar,
  docsImportadosCount = 0,
  onAbrirDocsImportados,
  importedLogs = [],
  onAbrirLogs,
}: Props) {
  const contabil = surface === 'contabilfacil';
  const [telaCheia, setTelaCheia] = useState(false);
  const [filtroNome, setFiltroNome] = useState('');
  const filtroDeferred = useDeferredValue(filtroNome);
  const [filtroSomenteInvertidas, setFiltroSomenteInvertidas] = useState(false);
  const [filtroSomenteDiasInvertidos, setFiltroSomenteDiasInvertidos] = useState(false);
  // Largura da coluna Descrição é sempre FIXA (nunca calculada a partir do texto
  // visível) — a tabela é virtualizada, então só as linhas na tela entram no DOM;
  // com largura automática, o navegador recalculava a coluna a cada linha nova
  // que entrava/saía durante o scroll, fazendo a tabela inteira "pular" para os
  // lados. Alternar este estado só troca QUAL largura fixa é usada.
  const [descricaoNomeCompleto, setDescricaoNomeCompleto] = useState(false);
  const [buscaTipo, setBuscaTipo] = useState<
    'conta' | 'historico' | 'valor' | 'sem_contrapartida'
  >('conta');
  const [modoView, setModoView] = useState<'balancete' | 'razao'>('balancete');
  const [buscaTexto, setBuscaTexto] = useState('');
  const [buscaValor, setBuscaValor] = useState('');
  const [buscaDataDe, setBuscaDataDe] = useState('');
  const [buscaDataAte, setBuscaDataAte] = useState('');
  const buscaTextoDeferred = useDeferredValue(buscaTexto);
  const buscaValorDeferred = useDeferredValue(buscaValor);
  const somenteComMovimento = true;
  const incluirPlanoCompleto = false;
  const [linhas, setLinhas] = useState<LinhaComparativoMensal[]>([]);
  const [calculando, setCalculando] = useState(false);
  const [progresso, setProgresso] = useState('');
  const [progressoAutomacao, setProgressoAutomacao] = useState('');
  const [processandoGarantida, setProcessandoGarantida] = useState(false);
  const automacaoAbortRef = useRef<AbortController | null>(null);
  const [resultadoCiclo, setResultadoCiclo] = useState<ResultadoAutomatizacaoCompleta | null>(null);
  const [automacaoConcluida, setAutomacaoConcluida] = useState(false);
  /** Força remontagem do comparativo após gravar lançamentos no razão. */
  const [comparativoRefreshSeq, setComparativoRefreshSeq] = useState(0);
  const [configContasOpen, setConfigContasOpen] = useState(false);
  const [opcaoAutomacao, setOpcaoAutomacao] = useState('custo');
  const [subOverlayInicial, setSubOverlayInicial] = useState<'custo' | 'coligadas' | 'emprestimo' | 'zeramento' | 'compensacao_banco' | null>(null);
  const [compensacaoDataDialogOpen, setCompensacaoDataDialogOpen] = useState(false);
  const [compensacaoDataInput, setCompensacaoDataInput] = useState('');
  const [rateioModalOpen, setRateioModalOpen] = useState(false);
  const [contaInvertidaParaRateio, setContaInvertidaParaRateio] = useState<{
    codigo: string;
    classificacao: string;
    nome: string;
    saldoFinal: number;
  } | null>(null);
  const [lancamentosRateio, setLancamentosRateio] = useState<LancamentosTransferencia>({
    todos: [],
    invertidos: [],
    saldoAnterior: 0,
  });
  const [naturezaManualSeq, setNaturezaManualSeq] = useState(0);
  const [naturezaManualModalOpen, setNaturezaManualModalOpen] = useState(false);
  const [configMenuOpen, setConfigMenuOpen] = useState(false);
  const [excluirMesesContasOpen, setExcluirMesesContasOpen] = useState(false);
  const [indicesFinanceirosOpen, setIndicesFinanceirosOpen] = useState(false);
  const [razaoContaOpen, setRazaoContaOpen] = useState(false);
  const [contaRazaoSelecionada, setContaRazaoSelecionada] = useState<LinhaComparativoMensal | null>(
    null,
  );
  const [razaoContaModo, setRazaoContaModo] = useState<RazaoContaModo>('classificacao');
  const [contaConfig, setContaConfig] = useState<AutomacaoContaConfig>(() =>
    readAutomatizacaoContaConfig(empresaNome),
  );
  const [lancamentoEditandoDireto, setLancamentoEditandoDireto] = useState<VisionBalanceteRow | null>(null);
  const [editDataDireto, setEditDataDireto] = useState('');
  const [editHistoricoDireto, setEditHistoricoDireto] = useState('');
  const [editContaDebDireto, setEditContaDebDireto] = useState('');
  const [editContaCredDireto, setEditContaCredDireto] = useState('');
  const [editValorDireto, setEditValorDireto] = useState('');
  const [editOrdemDireto, setEditOrdemDireto] = useState('');
  const [selectedEntriesToPair, setSelectedEntriesToPair] = useState<Set<string>>(new Set());

  useEffect(() => {
    setContaConfig(readAutomatizacaoContaConfig(empresaNome));
  }, [empresaNome]);

  // Clear selection when we change search type
  useEffect(() => {
    setSelectedEntriesToPair(new Set());
  }, [buscaTipo]);

  const qtdContasConfig = useMemo(() => papeisConfiguradosCount(contaConfig), [contaConfig]);

  const planoContaOptionsDirectEdit: ExtratoPlanoContaOption[] = useMemo(
    () =>
      planoRows.map((p) => ({
        code: p.codigo,
        name: p.nome,
        codigoReduzido: p.codigoReduzido,
        tipo: p.tipo,
        nivel: p.nivel,
      })),
    [planoRows],
  );

  /**
   * Conta Débito / Conta Crédito só podem exibir o código REDUZIDO — nunca a
   * classificação, nem inteira ("1.1.1.01.00001") nem achatada ("1110100001").
   * Dados antigos e importações mais frágeis gravam a classificação achatada em
   * `codigo`; aqui ela é traduzida de volta para o reduzido pelo plano. Quando
   * não dá para resolver, devolve vazio (a célula mostra "—") em vez de exibir
   * um número que não corresponde a conta nenhuma.
   */
  const resolverCodigoReduzido = useMemo(() => {
    const porClassificacao = new Map<string, string>();
    const reduzidosValidos = new Set<string>();
    for (const p of planoRows) {
      const reduzido = (p.codigoReduzido ?? '').trim();
      if (!reduzido) continue;
      reduzidosValidos.add(reduzido);
      const clsDigits = (p.codigo ?? '').replace(/\D/g, '');
      if (clsDigits) porClassificacao.set(clsDigits, reduzido);
    }

    return (raw: string | undefined): string => {
      const t = (raw ?? '').trim();
      if (!t) return '';

      const resolvido = normalizeExtratoContaParaGravacao(t, planoContaOptionsDirectEdit);
      if (resolvido && !resolvido.includes('.')) return resolvido;

      const digits = t.replace(/\D/g, '');
      if (!digits) return '';

      // Classificação (com ou sem pontos) → reduzido da mesma conta no plano.
      const doPlano = porClassificacao.get(digits);
      if (doPlano) return doPlano;

      // Já é um reduzido conhecido, ou curto o bastante para ser um.
      if (reduzidosValidos.has(digits)) return digits;
      if (!t.includes('.') && digits.length <= 7) return digits;

      return '';
    };
  }, [planoRows, planoContaOptionsDirectEdit]);

  /**
   * Overrides manuais de natureza (D/C) por conta sintética. Primados de forma
   * síncrona no corpo do render (não em useEffect) para que qualquer cálculo do
   * mesmo ciclo — inclusive nos modais filhos renderizados abaixo — já enxergue
   * os overrides atualizados via naturezaContabil.ts.
   */
  const naturezaManualEntries = useMemo(() => {
    const entries = readNaturezaManualEntries(empresaNome);
    setActiveNaturezaManualEntries(entries);
    return entries;
  }, [empresaNome, naturezaManualSeq]);

  /** Pastas de regras de natureza (compartilháveis entre empresas de mesmo plano de contas). */
  const naturezaFolders = useMemo(() => readNaturezaFolders(), [naturezaManualSeq]);

  /** Recarrega ao abrir o modal — pega empresas cadastradas depois do mount. */
  const todasEmpresas = useMemo(
    () => loadCompaniesRegistry().map((c) => c.name),
    [naturezaManualModalOpen],
  );

  const salvarNaturezaFolder = useCallback((folder: NaturezaRegraFolder): NaturezaRegraFolder => {
    const pastaSalva = upsertNaturezaFolder(folder);
    setNaturezaManualSeq((n) => n + 1);
    return pastaSalva;
  }, []);

  const excluirNaturezaFolder = useCallback((id: string) => {
    deleteNaturezaFolder(id);
    setNaturezaManualSeq((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!telaCheia) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTelaCheia(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [telaCheia]);

  const periodosBase = useMemo(
    () => buildPeriodosMensaisEntreDatas(periodoDe, periodoAte, razaoRows),
    [periodoDe, periodoAte, razaoRows],
  );

  /**
   * Só exibe colunas depois do cálculo filtrado por D/C real.
   * Nunca usa periodosBase na grade (evita mostrar 06/2001 fantasma enquanto calcula).
   */
  const [periodosVisiveis, setPeriodosVisiveis] = useState<PeriodoMensal[]>([]);
  const periodosSelecionados = periodosVisiveis;

  useEffect(() => {
    setPeriodosVisiveis([]);
    setResultadoCiclo(null);
    setAutomacaoConcluida(false);
  }, [periodoDe, periodoAte, periodosBase]);

  const mesRef = periodosSelecionados[periodosSelecionados.length - 1]?.label ?? '';

  const dataReferenciaIndices =
    periodosSelecionados[periodosSelecionados.length - 1]?.ate ?? '';

  const indicesFinanceiros: IndicesFinanceiros | null = useMemo(() => {
    if (!indicesFinanceirosOpen || !dataReferenciaIndices || !razaoRows.length) return null;
    return calcularIndicesFinanceiros(razaoRows, planoRows, dataReferenciaIndices);
  }, [indicesFinanceirosOpen, dataReferenciaIndices, razaoRows, planoRows]);

  const buildKey = useMemo(() => {
    const r0 = razaoRows[0];
    const rN = razaoRows[razaoRows.length - 1];
    const step = Math.max(1, Math.floor(razaoRows.length / 24));
    let movHash = 0;
    for (let i = 0; i < razaoRows.length; i += step) {
      const r = razaoRows[i];
      movHash += Math.round(((r.debito ?? 0) + (r.credito ?? 0)) * 100);
    }
    return [
      razaoRows.length,
      r0?.data,
      rN?.data,
      movHash,
      planoRows.length,
      periodoDe,
      periodoAte,
      somenteComMovimento,
      incluirPlanoCompleto,
      periodosBase.map((p) => p.label).join(','),
      comparativoRefreshSeq,
      naturezaManualSeq,
    ].join('|');
  }, [
    razaoRows,
    planoRows.length,
    periodoDe,
    periodoAte,
    somenteComMovimento,
    incluirPlanoCompleto,
    periodosBase,
    comparativoRefreshSeq,
    naturezaManualSeq,
  ]);

  useEffect(() => {
    if (!razaoRows.length || !periodosBase.length) {
      setLinhas([]);
      setPeriodosVisiveis([]);
      setCalculando(false);
      return;
    }

    let cancelled = false;
    const ac = new AbortController();
    const totalMeses = periodosBase.length;
    setCalculando(true);
    setProgresso(`Mês 0/${totalMeses}…`);
    setLinhas([]);
    setPeriodosVisiveis([]);

    let ultimoProgresso = '';
    const onProgress = (mes: number, total: number) => {
      if (cancelled) return;
      const pct = total > 0 ? Math.round((mes / total) * 100) : 0;
      const msg = `Processando ${mes}/${total} (${pct}%)…`;
      if (msg !== ultimoProgresso) {
        ultimoProgresso = msg;
        setProgresso(msg);
      }
    };

    const aplicarResultado = (res: { periodos: PeriodoMensal[]; linhas: LinhaComparativoMensal[] }) => {
      if (cancelled) return;
      // De/Até amplo (ex. 2001–2029) NÃO gera colunas civis: só meses com D/C real.
      const doRazao = buildPeriodosMensaisEntreDatas(periodoDe, periodoAte, razaoRows);
      const permitidos = new Set(doRazao.map((p) => p.label));
      const candidatos = (res.periodos.length ? res.periodos : doRazao).filter((p) =>
        permitidos.has(p.label),
      );
      const periodosOk = filtrarPeriodosComMovimentoNasLinhas(
        candidatos.length ? candidatos : doRazao,
        res.linhas,
      );
      startTransition(() => {
        setPeriodosVisiveis(periodosOk);
        setLinhas(res.linhas);
        setProgresso('');
        setCalculando(false);
      });
    };

    const usarWorker = deveUsarWorkerComparativo(razaoRows.length, periodosBase.length);
    const promessa = usarWorker
      ? montarComparativoNoWorker({
        razaoRows,
        planoRows,
        periodos: periodosBase,
        dataDe: periodoDe,
        dataAte: periodoAte,
        somenteComMovimento,
        incluirPlanoCompleto,
        naturezaManualEntries,
        onProgress,
        signal: ac.signal,
      })
      : montarComparativoMensalAsync({
        razaoRows,
        planoRows,
        periodos: periodosBase,
        dataDe: periodoDe,
        dataAte: periodoAte,
        somenteComMovimento,
        incluirPlanoCompleto,
        naturezaManualEntries,
        onProgress,
        yieldEntreMeses: async () => {
          await new Promise<void>((r) => setTimeout(r, 0));
        },
      });

    promessa
      .then((res) => aplicarResultado(res))
      .catch((err: unknown) => {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        setProgresso('');
        setCalculando(false);
      });

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [
    buildKey,
    razaoRows,
    planoRows,
    periodosBase,
    periodoDe,
    periodoAte,
    somenteComMovimento,
    incluirPlanoCompleto,
    naturezaManualEntries,
  ]);

  /** Auditoria contínua (CPC + regras RF) no último mês do comparativo. */
  const auditoriaContinua = useMemo(() => {
    if (!razaoRows.length || !periodosSelecionados.length || calculando) return null;
    const ultimo = periodosSelecionados[periodosSelecionados.length - 1];
    const razaoPeriodo = filtrarRazaoPorPeriodo(razaoRows, ultimo.de, ultimo.ate);
    const bal = montarBalanceteComPeriodo(razaoRows, razaoPeriodo, planoRows, ultimo.de, ultimo.ate);
    return auditarBalanceteContinuo({ balanceteRows: bal, empresaNome, mesRef: ultimo.label });
  }, [razaoRows, planoRows, periodosSelecionados, empresaNome, buildKey, calculando]);

  /**
   * Busca avançada por histórico e/ou valor e/ou período — procura nos lançamentos
   * (razaoRows), não nas linhas agregadas do comparativo, e devolve o conjunto de
   * contas (classificação/código) que têm ao menos um lançamento batendo nos
   * critérios escolhidos. "Conta" usa o filtro de nome já existente (filtroNome).
   */
  const buscaAvancadaContas = useMemo(() => {
    if (buscaTipo === 'conta') return null;

    // Modo "sem contrapartida": detecção precisa de lançamentos sem par
    // (agrupamento por data+ordem ou data+valor exato) — devolve o conjunto
    // de contas com pelo menos um lançamento nessa situação.
    if (buscaTipo === 'sem_contrapartida') {
      const semPar = detectarLancamentosSemContrapartida(razaoRows);
      const contasSemPar = new Set<string>();
      for (const r of semPar) {
        const cls = (r.classificacao ?? '').trim();
        const cod = (r.codigo ?? '').trim();
        if (cls) contasSemPar.add(cls);
        if (cod) contasSemPar.add(cod);
      }
      return contasSemPar;
    }

    // "texto" (histórico) só existe como campo editável no modo 'historico' — em
    // 'valor' o input nem aparece, então um texto deixado de uma busca anterior não
    // pode continuar filtrando por baixo dos panos (senão a busca por valor "some").
    const texto = buscaTipo === 'historico' ? buscaTextoDeferred.trim().toLowerCase() : '';
    const valorNum = parseValorBusca(buscaValorDeferred);
    const deTs = parseBrDateToTime(buscaDataDe);
    const ateTs = parseBrDateToTime(buscaDataAte);

    const temFiltro = texto !== '' || valorNum > 0.005 || deTs !== null || ateTs !== null;
    if (!temFiltro) return null;

    const contas = new Set<string>();
    for (const r of razaoRows) {
      if (texto && !(r.nome ?? '').toLowerCase().includes(texto)) continue;
      if (valorNum > 0.005) {
        const bateDeb = Math.abs((r.debito ?? 0) - valorNum) <= 0.005;
        const bateCred = Math.abs((r.credito ?? 0) - valorNum) <= 0.005;
        if (!bateDeb && !bateCred) continue;
      }
      if (deTs !== null || ateTs !== null) {
        const dTs = parseBrDateToTime(r.data ?? '');
        if (dTs === null) continue;
        if (deTs !== null && dTs < deTs) continue;
        if (ateTs !== null && dTs > ateTs) continue;
      }
      const cls = (r.classificacao ?? '').trim();
      const cod = (r.codigo ?? '').trim();
      if (cls) contas.add(cls);
      if (cod) contas.add(cod);
    }
    return contas;
  }, [buscaTipo, buscaTextoDeferred, buscaValorDeferred, buscaDataDe, buscaDataAte, razaoRows]);

  const linhasFiltradas = useMemo(() => {
    let resultado = linhas;

    // Filtro de nome/classificação/código — só se aplica no modo "conta"; nos
    // outros modos o texto ficaria "vazando" de uma busca anterior e travando os
    // resultados de histórico/valor/sem contrapartida por baixo dos panos.
    const q = buscaTipo === 'conta' ? filtroDeferred.trim().toLowerCase() : '';
    if (q) {
      resultado = resultado.filter(
        (linha) =>
          linha.nome.toLowerCase().includes(q) ||
          linha.classificacao.toLowerCase().includes(q) ||
          linha.codigo.toLowerCase().includes(q),
      );
    }

    // Busca avançada (histórico / valor / data), fora do modo "conta"
    if (buscaAvancadaContas) {
      resultado = resultado.filter(
        (linha) =>
          buscaAvancadaContas.has(linha.classificacao.trim()) ||
          buscaAvancadaContas.has(linha.codigo.trim()),
      );
    }

    // Filtro: CONTAS SALDO MÊS INVERTIDO (saldo final do mês está invertido)
    if (filtroSomenteInvertidas) {
      resultado = resultado.filter((linha) =>
        periodosSelecionados.some((p) => {
          const cel = linha.saldosPorMes[p.label];
          return cel && cel.valor >= 0.01 && cel.invertido === true;
        }),
      );
    }

    // Filtro: CONTAS COM RAZÃO INVERTIDO (teve dias invertidos mas nenhum mês fechou invertido)
    // Mostra APENAS contas analíticas (tipo !== 'S') com dias invertidos, destacadas em vermelho
    if (filtroSomenteDiasInvertidos) {
      resultado = resultado.filter((linha) => {
        // Mostrar APENAS contas analíticas (não sintéticas)
        if (linha.tipo === 'S') return false;

        // Os dois filtros são mutuamente exclusivos na UI, então a exclusão aqui
        // precisa usar EXATAMENTE o mesmo critério de inclusão do filtro "Contas
        // saldo mês invertido" (períodos selecionados + saldo relevante). Antes
        // varria TODOS os meses da linha e aceitava célula invertida de saldo ~0:
        // conta nessa situação era descartada aqui e também não aparecia no outro
        // filtro (que exige valor >= 0,01), sumindo das duas visões.
        const fechouMesInvertido = periodosSelecionados.some((p) => {
          const cel = linha.saldosPorMes[p.label];
          return cel && cel.valor >= 0.01 && cel.invertido === true;
        });
        if (fechouMesInvertido) return false;

        // Mesma regra que pinta os lançamentos causa-raiz de vermelho no Razão:
        // saldo de ABERTURA carregado da linha "SALDO ANTERIOR" do razão (que
        // guarda o valor em `saldoInicial`, não em débito/crédito) e só acusa o
        // lançamento cuja própria natureza é contrária à da conta. Antes daqui
        // saía um acumulado que ignorava a abertura, e conta que só tinha saldo
        // anterior + um crédito normal aparecia como invertida.
        return contaTemRazaoInvertido(linha, razaoRows, periodoDe, periodoAte, planoRows);
      });
    }

    return resultado;
  }, [linhas, filtroDeferred, buscaAvancadaContas, filtroSomenteInvertidas, filtroSomenteDiasInvertidos, periodosSelecionados, razaoRows, planoRows, periodoDe, periodoAte]);

  /**
   * Modo "Razão": lançamentos individuais (não agregados por conta) dentro do
   * período do balancete. A busca por valor/histórico/conta filtra cada
   * LANÇAMENTO diretamente — diferente do modo "Balancete", onde a mesma busca
   * só serve pra decidir quais CONTAS aparecem (buscaAvancadaContas).
   *
   * Destaca em vermelho os lançamentos causa-raiz da inversão (mesma regra do
   * modal do Razão). O filtro "Contas com razão invertido" existe só no Balancete.
   */
  const { razaoDoBalanceteFiltrado, chavesLancamentosInvertidosRazao } = useMemo(() => {
    const vazio = {
      razaoDoBalanceteFiltrado: [] as VisionBalanceteRow[],
      chavesLancamentosInvertidosRazao: new Set<string>(),
    };
    if (modoView !== 'razao') return vazio;

    // Todos os lançamentos do período — sem restringir às contas que sobraram
    // no balancete (que já pode estar filtrado por "somente com movimento" ou
    // por uma busca anterior). O modo Razão é pra ver TUDO que caiu no período.
    let resultado = filtrarRazaoPorPeriodo(razaoRows, periodoDe, periodoAte);

    if (buscaTipo === 'sem_contrapartida') {
      resultado = detectarLancamentosSemContrapartida(resultado);
    } else if (buscaTipo === 'conta') {
      const q = filtroDeferred.trim().toLowerCase();
      if (q) {
        resultado = resultado.filter(
          (r) =>
            (r.codigo ?? '').toLowerCase().includes(q) ||
            (r.classificacao ?? '').toLowerCase().includes(q),
        );
      }
    } else {
      // historico / valor — filtra o LANÇAMENTO em si, não a conta onde ele está.
      const texto = buscaTipo === 'historico' ? buscaTextoDeferred.trim().toLowerCase() : '';
      const valorNum = parseValorBusca(buscaValorDeferred);
      const deTs = parseBrDateToTime(buscaDataDe);
      const ateTs = parseBrDateToTime(buscaDataAte);

      if (texto) {
        resultado = resultado.filter((r) => (r.nome ?? '').toLowerCase().includes(texto));
      }
      if (valorNum > 0.005) {
        resultado = resultado.filter((r) => {
          const bateDeb = Math.abs((r.debito ?? 0) - valorNum) <= 0.005;
          const bateCred = Math.abs((r.credito ?? 0) - valorNum) <= 0.005;
          return bateDeb || bateCred;
        });
      }
      if (deTs !== null || ateTs !== null) {
        resultado = resultado.filter((r) => {
          const dTs = parseBrDateToTime(r.data ?? '');
          if (dTs === null) return false;
          if (deTs !== null && dTs < deTs) return false;
          if (ateTs !== null && dTs > ateTs) return false;
          return true;
        });
      }
    }

    const seen = new Set<string>();
    const contasBase: LinhaComparativoMensal[] = [];
    for (const r of resultado) {
      const cls = (r.classificacao || '').trim();
      const cod = (r.codigo || '').trim();
      const key = cls || cod;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      contasBase.push({
        chave: key,
        codigo: cod,
        classificacao: cls,
        nome: r.nome || r.historico || '',
        tipo: 'A',
        saldosPorMes: {},
        detalhePorMes: {},
      });
    }

    const chavesInvertidos = coletarLancamentosCausaRaizInvertidos(
      contasBase,
      razaoRows,
      periodoDe,
      periodoAte,
      planoRows,
    );

    return {
      razaoDoBalanceteFiltrado: resultado,
      chavesLancamentosInvertidosRazao: chavesInvertidos,
    };
  }, [
    modoView,
    razaoRows,
    planoRows,
    periodoDe,
    periodoAte,
    buscaTipo,
    filtroDeferred,
    buscaTextoDeferred,
    buscaValorDeferred,
    buscaDataDe,
    buscaDataAte,
  ]);

  /**
   * Agrupa lançamentos pareados (débito + crédito da mesma transação) em uma
   * única linha para exibição no modo "Somente Razão".
   *
   * A chave de pareamento usa `data + ordem` (ambos os lados da mesma partida
   * compartilham a mesma ordem), não o nome — no razão do Domínio, a linha de
   * débito pode ter histórico completamente diferente da linha de crédito.
   * Fallback: `data + valor` quando não há ordem.
   *
   * No modo "sem_contrapartida" não agrupa — o usuário precisa ver e selecionar
   * as linhas individuais para parear manualmente.
   */
  /**
   * Chave estável por IDENTIDADE do objeto — não por posição num array nem por conteúdo.
   * Usada tanto para a `key` do React na lista "sem contrapartida" quanto para casar a
   * seleção do checkbox com o clique em "Parear selecionados".
   *
   * Já tentamos basear a chave num índice (`razaoRows.indexOf`/Map por referência), mas duas
   * listas derivadas de `razaoRows` por memos DIFERENTES (`razaoDisplayRows` e o índice) podem,
   * por algum motivo ainda não isolado nesta base (dados antigos duplicados, edições manuais
   * anteriores etc.), acabar carregando objetos que não são a MESMA referência mesmo
   * representando a mesma linha — o índice por referência então falhava silenciosamente pra
   * essas linhas e caía num fallback por conteúdo, que colidia sempre que duas linhas eram
   * idênticas (lançamentos duplicados, justamente o caso mais comum em "sem contrapartida").
   * Isso gerava chaves React duplicadas, quebrava a seleção dos checkboxes (marcava as duas
   * linhas de uma vez) e — com volume grande de dados — chegou a travar a aba inteira.
   *
   * Corrigido de vez com um WeakMap: cada objeto de linha recebe um ID único na PRIMEIRA vez
   * que é visto, não importa de qual lista/memo veio — não depende de índice nem de conteúdo,
   * então nunca colide, mesmo com linhas 100% idênticas.
   */
  const razaoRowKeyCacheRef = useRef(new WeakMap<VisionBalanceteRow, string>());
  const razaoRowKeySeqRef = useRef(0);

  const getRazaoRowKey = useCallback((row: VisionBalanceteRow) => {
    const cache = razaoRowKeyCacheRef.current;
    let key = cache.get(row);
    if (!key) {
      key = `razao-row-${razaoRowKeySeqRef.current++}`;
      cache.set(row, key);
    }
    return key;
  }, []);

  const razaoDisplayRows = useMemo(() => {
    if (modoView !== 'razao') return [] as VisionBalanceteRow[];
    if (buscaTipo === 'sem_contrapartida') return razaoDoBalanceteFiltrado;

    const src = razaoDoBalanceteFiltrado;
    const used = new Set<number>();
    const out: RazaoRowComOrigem[] = [];

    // Débito e crédito nunca podem ser a mesma conta — se o fallback (codigo)
    // faz as duas pernas caírem na mesma conta (dado de origem sem a
    // contrapartida real), é melhor mostrar o crédito vazio do que inventar
    // uma partida fechada contra si mesma.
    const semMesmaConta = contasSaoIguaisEDevemSerLimpa;

    // Cada linha exibida aqui é uma CÓPIA (spread) — nunca a mesma referência de
    // objeto que está em `razaoRows` — porque o merge acima combina duas pernas
    // (débito + crédito) numa única linha visual. Marcamos aqui de qual objeto
    // original (por identidade, via getRazaoRowKey) vieram o lado débito e o
    // lado crédito, para que a edição direta consiga localizar e atualizar os
    // lançamentos reais em `razaoRows` depois (edição por referência falhava
    // silenciosamente e o valor salvo "voltava" ao original).
    const withOrigem = (row: VisionBalanceteRow, debRow?: VisionBalanceteRow, credRow?: VisionBalanceteRow): RazaoRowComOrigem => ({
      ...row,
      __origKeyDeb: debRow ? getRazaoRowKey(debRow) : undefined,
      __origKeyCred: credRow ? getRazaoRowKey(credRow) : undefined,
    });

    // ── Passo 1: pareamento por data + ordem (mais confiável) ──────────────
    for (let i = 0; i < src.length; i++) {
      if (used.has(i)) continue;
      const a = src[i];
      if (a.ordem == null || !Number.isFinite(a.ordem)) continue;
      const aDeb = a.debito ?? 0;
      const aCred = a.credito ?? 0;
      if (aDeb === 0 && aCred === 0) continue;

      for (let j = i + 1; j < src.length; j++) {
        if (used.has(j)) continue;
        const b = src[j];
        if (b.ordem !== a.ordem || b.data !== a.data) continue;
        const bDeb = b.debito ?? 0;
        const bCred = b.credito ?? 0;
        if (bDeb === 0 && bCred === 0) continue;

        // Um lado deve ser débito e o outro crédito
        if (aDeb > 0 && bCred > 0 && Math.abs(aDeb - bCred) < 0.01 && aCred === 0 && bDeb === 0) {
          out.push(withOrigem({
            ...a,
            credito: bCred,
            ...semMesmaConta(a.contaDeb || a.codigo || '', b.contaCred || b.codigo || ''),
            codigo: a.codigo || '',
          }, a, b));
          used.add(i);
          used.add(j);
          break;
        }
        if (bDeb > 0 && aCred > 0 && Math.abs(bDeb - aCred) < 0.01 && aDeb === 0 && bCred === 0) {
          out.push(withOrigem({
            ...b,
            credito: aCred,
            ...semMesmaConta(b.contaDeb || b.codigo || '', a.contaCred || a.codigo || ''),
            codigo: b.codigo || '',
          }, b, a));
          used.add(i);
          used.add(j);
          break;
        }
      }
    }

    // ── Passo 2: fallback por data + valor (para linhas sem ordem) ─────────
    for (let i = 0; i < src.length; i++) {
      if (used.has(i)) continue;
      const a = src[i];
      const aDeb = a.debito ?? 0;
      const aCred = a.credito ?? 0;
      if (aDeb === 0 && aCred === 0) {
        used.add(i);
        out.push(withOrigem({ ...a, contaDeb: '', contaCred: '' }, a, a));
        continue;
      }
      const aVal = aDeb > 0 ? aDeb : aCred;
      let paired = false;

      // Tenta parear por data+valor mesmo quando a linha TEM ordem — o Passo 1
      // só pareia ordem idêntica, mas as duas pernas de uma mesma partida às
      // vezes vêm com ordens diferentes (ex.: débito na ordem N, crédito na
      // ordem N+1). Restringir isso a "só linhas sem ordem" fazia pares assim
      // ficarem com "—" na contrapartida mesmo tendo par real (o mesmo caso que
      // detectarLancamentosSemContrapartida já resolve via data+valor sem essa
      // restrição — ver dominioTxtIO.ts).
      for (let j = i + 1; j < src.length; j++) {
        if (used.has(j)) continue;
        const b = src[j];
        if (b.data !== a.data) continue;
        const bDeb = b.debito ?? 0;
        const bCred = b.credito ?? 0;
        if (bDeb === 0 && bCred === 0) continue;

        const bVal = bDeb > 0 ? bDeb : bCred;
        if (Math.abs(aVal - bVal) > 0.01) continue;

        if (aDeb > 0 && bCred > 0 && aCred === 0 && bDeb === 0) {
          out.push(withOrigem({
            ...a,
            credito: bCred,
            ...semMesmaConta(a.contaDeb || a.codigo || '', b.contaCred || b.codigo || ''),
            codigo: a.codigo || '',
          }, a, b));
          used.add(i);
          used.add(j);
          paired = true;
          break;
        }
        if (bDeb > 0 && aCred > 0 && aDeb === 0 && bCred === 0) {
          out.push(withOrigem({
            ...b,
            credito: aCred,
            ...semMesmaConta(b.contaDeb || b.codigo || '', a.contaCred || a.codigo || ''),
            codigo: b.codigo || '',
          }, b, a));
          used.add(i);
          used.add(j);
          paired = true;
          break;
        }
      }

      if (!paired) {
        used.add(i);
        // Se a linha já traz contaDeb E contaCred preenchidos (ex.: lançamentos
        // gerados por "Mandar para o Balancete" da conciliação), exibe ambos
        // diretamente — não limpar o lado oposto só porque não achou um par
        // separado no array. Essa era a causa do "–" em Conta Débito/Crédito
        // para lançamentos auto-contidos.
        const jaTemAmbas = !!(a.contaDeb?.trim()) && !!(a.contaCred?.trim()) && a.contaDeb.trim() !== a.contaCred.trim();
        if (jaTemAmbas) {
          out.push(withOrigem({ ...a }, a, a));
        } else {
          out.push(withOrigem({
            ...a,
            ...semMesmaConta(
              aDeb > 0 ? (a.contaDeb || a.codigo || '') : '',
              aCred > 0 ? (a.contaCred || a.codigo || '') : '',
            ),
          }, a, a));
        }
      }
    }

    // ── Passo 3: partidas compostas (N-para-1 / 1-para-N) por data ─────────
    // O que sobrou do Passo 1/2 ainda pode ter contrapartida real — só que
    // dividida em várias pernas (ex.: 1 pagamento de DARF = crédito único que
    // cobre 2 débitos, COFINS + PIS, cuja soma bate exatamente). Preenche a
    // conta que falta em cada linha (sem fundir em uma só, já que N pernas não
    // cabem numa linha) usando o mesmo utilitário de subset-sum do detector de
    // "sem contrapartida" — antes disso essas linhas ficavam com "—" mesmo
    // tendo par real, porque nada aqui tentava combinar múltiplas pernas.
    const enriquecidas = enriquecerContrapartidasCompostas(
      out.map((r) => ({ ...r })),
    );

    return enriquecidas;
  }, [modoView, buscaTipo, razaoDoBalanceteFiltrado, getRazaoRowKey]);

  const totalRows = modoView === 'razao' ? razaoDisplayRows.length : linhasFiltradas.length;

  /** Todos os bancos do comparativo (ignora filtro de tela — automatiza todos). */
  const todasLinhasBanco = useMemo(() => deduplicarLinhasBanco(linhas), [linhas]);

  const temRelatorios = folhaRows.length > 0 || fiscalRows.length > 0;

  const baixarRelatorioPdf = useCallback(
    (resultado: ResultadoAutomatizacaoCompleta) => {
      exportAutomatizacaoBalancetePdf({
        resultado,
        empresa: empresaNome,
        periodoDe,
        periodoAte,
      });
    },
    [empresaNome, periodoDe, periodoAte],
  );

  const exportarPdfBalancete = useCallback(() => {
    if (calculando || linhas.length === 0) {
      window.alert('Aguarde o comparativo terminar de montar para exportar o PDF.');
      return;
    }
    const exportLinhas = filtroDeferred.trim() ? linhasFiltradas : linhas;
    exportBalanceteComparativoPdf({
      linhas: exportLinhas,
      periodos: periodosSelecionados,
      empresa: empresaNome,
      periodoDe,
      periodoAte,
      auditoria: auditoriaContinua,
    });
  }, [
    calculando,
    linhas,
    linhasFiltradas,
    filtroDeferred,
    periodosSelecionados,
    empresaNome,
    periodoDe,
    periodoAte,
    auditoriaContinua,
  ]);

  const exportarPdfInvertidas = useCallback(() => {
    if (!razaoRows.length) {
      window.alert('Importe o razão antes de exportar.');
      return;
    }
    exportBalanceteInvertidasPdf({
      razaoRows,
      planoRows,
      empresa: empresaNome,
    });
  }, [razaoRows, planoRows, empresaNome]);

  const handleAutomatizar = useCallback(() => {
    if (!todasLinhasBanco.length && !temRelatorios) {
      window.alert(
        'Importe o razão (conta banco) ou relatórios na aba Folha/Fiscal para automatizar.',
      );
      return;
    }
    automacaoAbortRef.current?.abort();
    const ac = new AbortController();
    automacaoAbortRef.current = ac;

    setProcessandoGarantida(true);
    setProgressoAutomacao('Iniciando…');
    setResultadoCiclo(null);
    setAutomacaoConcluida(false);

    const fiscalContaMap = readFiscalContaMap(empresaNome);
    const receitaFederalStore = readReceitaFederalRegras(empresaNome);
    const baseParams = {
      linhasComparativo: linhas,
      periodos: periodosSelecionados,
      razaoRows,
      planoRows,
      folhaRows,
      fiscalRows,
      fiscalContaMap,
      contaConfig,
      receitaFederalStore,
      empresaNome,
      signal: ac.signal,
      onProgress: (p: { fase: string; atual: number; total: number; mensagem: string }) => {
        const pct = p.total > 0 ? Math.round((p.atual / p.total) * 100) : 0;
        const label =
          p.fase === 'folha_fiscal'
            ? 'Folha/Fiscal'
            : p.fase === 'banco'
              ? 'Banco/garantida'
              : 'Gravando';
        startTransition(() => {
          setProgressoAutomacao(`${label} ${pct}% · ${p.mensagem}`);
        });
      },
    };

    const finalizar = (resultado: ResultadoAutomatizacaoCompleta) => {
      if (ac.signal.aborted) return;
      setResultadoCiclo(resultado);
      setAutomacaoConcluida(true);
      setProcessandoGarantida(false);
      setProgressoAutomacao('');
      if (resultado.lancamentosGerados.length) {
        setComparativoRefreshSeq((n) => n + 1);
      }
    };

    const run = workerAutomacaoDisponivel()
      ? executarAutomatizacaoNoWorker(baseParams).then(({ resultado, lancamentosNovos }) => {
        if (lancamentosNovos.length) {
          startTransition(() => {
            setProgressoAutomacao('Gravando lançamentos no razão…');
          });
          onRazaoRowsChange(aplicarLancamentosNoRazao(razaoRows, lancamentosNovos));
        }
        return resultado;
      })
      : Promise.resolve(
        executarAutomatizacaoCompleta({
          ...baseParams,
          empresaNome,
        }),
      ).then((resultado) => {
        if (resultado.lancamentosGerados.length) {
          onRazaoRowsChange(aplicarLancamentosNoRazao(razaoRows, resultado.lancamentosGerados));
        }
        return resultado;
      });

    run.then(finalizar)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error(err);
        window.alert(
          err instanceof Error ? err.message : 'Falha na automatização. Tente novamente.',
        );
        setProcessandoGarantida(false);
        setProgressoAutomacao('');
      });
  }, [
    linhas,
    todasLinhasBanco.length,
    temRelatorios,
    periodosSelecionados,
    razaoRows,
    planoRows,
    folhaRows,
    fiscalRows,
    empresaNome,
    contaConfig,
    onRazaoRowsChange,
  ]);

  /**
   * Executa a automação selecionada no dropdown diretamente, sem abrir o modal de configuração.
   * Custo e Coligadas rodam as funções de automação diretamente.
   * Empréstimo Bancário roda a correção para todos os contratos configurados.
   * Zeramento abre o sub-overlay (precisa de data e conta do usuário).
   */
  /**
   * Ação manual (não roda sozinha no carregamento — apagar lançamento é irreversível):
   * detecta e remove lançamentos duplicados por reimportação com o código da conta em
   * formato diferente (ex.: "8" vs "0000008" — TXT+ Domínio zero-preenche, um import por
   * OCR/recorte do mesmo período pode gravar sem padding, dobrando o débito/crédito do mês).
   * Mostra quantas linhas seriam removidas e pede confirmação antes de gravar.
   */
  const handleCorrigirDuplicatasCodigo = useCallback(() => {
    if (!razaoRows.length) {
      window.alert('Nenhum lançamento no razão para verificar.');
      return;
    }
    const limpo = removerDuplicatasCodigoInconsistente(razaoRows);
    const removidos = razaoRows.length - limpo.length;
    if (removidos <= 0) {
      window.alert('Nenhuma duplicata de código de conta encontrada.');
      return;
    }
    if (
      !window.confirm(
        `${removidos} lançamento(s) duplicado(s) encontrado(s) (mesma data/valor/conta, mas código gravado em formatos diferentes — ex.: "8" e "0000008"). Remover e recalcular o saldo?`,
      )
    ) {
      return;
    }
    onRazaoRowsChange(limpo);
    setComparativoRefreshSeq((n) => n + 1);
    window.alert(`✓ ${removidos} lançamento(s) duplicado(s) removido(s).`);
  }, [razaoRows, onRazaoRowsChange]);

  const handleAplicarAutomacao = useCallback(() => {
    if (!razaoRows.length) {
      window.alert('Importe o razão antes de executar a automação.');
      return;
    }

    if (opcaoAutomacao === 'custo') {
      // Usa a lógica já existente: lança só a diferença entre o alvo e o débito já existente na conta de custo
      const result = executarLancamentoCustoPorFaturamento({
        periodos: periodosSelecionados,
        razaoRows,
        planoRows,
        contaConfig,
      });
      if (result.lancamentos.length > 0) {
        onRazaoRowsChange(aplicarLancamentosNoRazao(razaoRows, result.lancamentos));
        setComparativoRefreshSeq((n) => n + 1);
        window.alert(`✓ ${result.lancamentos.length} lançamento(s) de custo gravado(s) no razão.`);
      } else {
        const msg = result.detalhes.length
          ? result.detalhes.join('\n')
          : 'Nenhum lançamento gerado. Verifique a configuração de automação (Custo).';
        window.alert(msg);
      }
    } else if (opcaoAutomacao === 'coligadas') {
      const result = executarEmprestimoEntreColigadas({
        periodos: periodosSelecionados,
        razaoRows,
        planoRows,
        contaConfig,
        empresaNome,
      });
      if (result.lancamentos.length > 0) {
        onRazaoRowsChange(aplicarLancamentosNoRazao(razaoRows, result.lancamentos));
        setComparativoRefreshSeq((n) => n + 1);
        window.alert(`✓ ${result.lancamentos.length} lançamento(s) de coligadas gravado(s) no razão.`);
      } else {
        const msg = result.detalhes.length
          ? result.detalhes.join('\n')
          : 'Nenhum lançamento gerado. Verifique a configuração de automação (Coligadas).';
        window.alert(msg);
      }
    } else if (opcaoAutomacao === 'emprestimo') {
      const cfg = readAutomatizacaoContaConfig(empresaNome);
      const loanConfigs = cfg.lancamentosEmprestimo ?? [];
      if (!loanConfigs.length) {
        window.alert(
          'Nenhum empréstimo bancário configurado.\nAcesse Configuração → Empréstimo Bancário para configurar.',
        );
        return;
      }
      const contratos = loadContractsFromBrowserStorage().filter((c) =>
        belongsToCompany(c.companyName, empresaNome),
      );
      let novoRazao = razaoRows;
      let totalLancamentos = 0;
      const avisos: string[] = [];
      for (const loanCfg of loanConfigs) {
        const contrato = contratos.find((c) => c.id === loanCfg.contratoId);
        if (!contrato) {
          avisos.push(`Contrato "${loanCfg.contratoId}" não encontrado.`);
          continue;
        }
        const cache = lerLoanScheduleBalanceCache(contrato.companyName, contrato.id);
        const periodo = extrairPeriodoRazao(novoRazao);
        const refDate = periodo.max ? parseISO(periodo.max) : new Date();
        const saldoTabela = saldoTabelaNaData(cache, refDate);
        const saldoCurto = saldoCurtoTabelaNaData(cache, refDate);
        const saldoLongo = saldoLongoTabelaNaData(cache, refDate);
        const result = aplicarCorrecaoEmprestimo(
          novoRazao,
          contrato,
          planoRows,
          {
            contaContrato: loanCfg.contaContrato,
            contaCurto: loanCfg.contaCurto,
            contaLongo: loanCfg.contaLongo,
            contaCorrecaoMonetaria: loanCfg.contaCorrecaoMonetaria,
            contaEstornoJurosAproDebit: loanCfg.contaEstornoJurosAproDebit,
            contaEstornoJurosAproCredit: loanCfg.contaEstornoJurosAproCredit,
            contaEstornoJurosDebito: loanCfg.contaEstornoJurosDebito,
            contaEstornoJurosCredito: loanCfg.contaEstornoJurosCredito,
            contaAjusteCredor: loanCfg.contaAjusteCredor,
            contaAjusteDevedor: loanCfg.contaAjusteDevedor,
          },
          saldoTabela,
          saldoCurto,
          saldoLongo,
        );
        if (result.novaRazao) {
          novoRazao = result.novaRazao;
          totalLancamentos += result.lancamentosDetalhe?.length ?? 0;
        }
        if (result.pendencias.length) {
          avisos.push(...result.pendencias);
        }
      }
      if (totalLancamentos > 0) {
        onRazaoRowsChange(novoRazao);
        setComparativoRefreshSeq((n) => n + 1);
        const extra = avisos.length ? `\n\nAvisos:\n${avisos.join('\n')}` : '';
        window.alert(`✓ ${totalLancamentos} lançamento(s) de correção de empréstimo bancário gravado(s) no razão.${extra}`);
      } else {
        const msg = avisos.length
          ? avisos.join('\n')
          : 'Nenhum lançamento gerado. Verifique a configuração de empréstimo bancário.';
        window.alert(msg);
      }
    } else if (opcaoAutomacao === 'zeramento') {
      // Zeramento precisa de data e conta informados pelo usuário — abre o sub-overlay
      setSubOverlayInicial('zeramento');
      setConfigContasOpen(true);
    } else if (opcaoAutomacao === 'compensacao_banco') {
      // Compensação Banco Credor — verifica se contas já estão configuradas
      const cfg = readAutomatizacaoContaConfig(empresaNome);
      const bancoCfg = cfg.compensacaoBancoConfig;
      if (!bancoCfg?.contaBanco || !bancoCfg?.contaGarantida) {
        // Contas não configuradas — abre o sub-overlay de configuração
        setSubOverlayInicial('compensacao_banco');
        setConfigContasOpen(true);
      } else {
        // Contas já configuradas — abre diálogo para informar a data dos lançamentos
        setCompensacaoDataInput('');
        setCompensacaoDataDialogOpen(true);
      }
    }
  }, [
    opcaoAutomacao,
    razaoRows,
    planoRows,
    periodosSelecionados,
    contaConfig,
    empresaNome,
    onRazaoRowsChange,
  ]);

  /**
   * Executa a compensação banco credor. `dataInicio` (DD/MM/AAAA) é a data a
   * partir da qual o banco passa a ser analisado — não a data dos lançamentos.
   */
  const handleConfirmarCompensacao = useCallback((dataInicio: string) => {
    setCompensacaoDataDialogOpen(false);
    const cfg = readAutomatizacaoContaConfig(empresaNome);
    const bancoCfg = cfg.compensacaoBancoConfig;
    if (!bancoCfg?.contaBanco || !bancoCfg?.contaGarantida) {
      window.alert('Configure as contas da Compensação Banco Credor antes de aplicar.');
      return;
    }

    const rowFromReduzido = (codigo: string): VisionBalanceteRow | null => {
      const p = planoRows.find((x) => (x.codigoReduzido ?? '').trim() === codigo.trim());
      if (!p) return null;
      return { codigo: p.codigoReduzido ?? p.codigo, classificacao: p.codigo, nome: p.nome, tipo: p.tipo ?? 'A', saldoInicial: 0, debito: 0, credito: 0, saldoFinal: 0 };
    };

    const bancoRow = rowFromReduzido(bancoCfg.contaBanco);
    const garantidaRow = rowFromReduzido(bancoCfg.contaGarantida);
    if (!bancoRow || !garantidaRow) {
      window.alert('Uma ou ambas as contas configuradas não foram encontradas no plano de contas.');
      return;
    }

    // Idempotência: remove os lançamentos de execuções ANTERIORES desta mesma
    // automação ANTES de calcular. Duas correções aqui:
    // 1) A limpeza era por faixa de `ordem` (940.000–949.999) — faixa que a
    //    automação de Empréstimo entre Coligadas também usa, então aplicar a
    //    compensação apagava silenciosamente os lançamentos das coligadas. Agora
    //    filtra pelo importId da própria automação ("garantida-banco:").
    // 2) A limpeza acontecia DEPOIS do cálculo, então o ciclo enxergava o banco
    //    já corrigido pela rodada anterior e devolvia "nenhum lançamento gerado" —
    //    a automação só funcionava uma vez.
    // Reconhece pelo importId E pelo histórico "[Auto] Utilização/Devolução garantia":
    // razão exportado e reimportado perde o importId, e essas linhas voltariam a ser
    // lidas como movimento real do banco — inflando o saldo do dia a cada rodada.
    const razaoSemAnteriores = razaoRows.filter((r) => !isLancamentoCompensacaoGarantida(r));

    // Compensa DIA A DIA a partir da data informada: cada dia em que o banco fecha
    // credor recebe a utilização naquele mesmo dia e a devolução no dia seguinte.
    // O ciclo mensal só olhava o fechamento do mês e empilhava tudo no último dia,
    // deixando o banco credor durante o mês inteiro — que é o que precisa cobrir.
    const resultado = executarCicloGarantidaDiario({
      bancoRow,
      garantidaRow,
      razaoRows: razaoSemAnteriores,
      dataInicio,
    });
    if (!resultado.ok) {
      window.alert(resultado.mensagem);
      return;
    }

    const novoRazao = aplicarLancamentosNoRazao(razaoSemAnteriores, resultado.lancamentosGerados);
    onRazaoRowsChange(novoRazao);
    setComparativoRefreshSeq((n) => n + 1);
    window.alert(
      `✓ ${resultado.lancamentosGerados.length} lançamento(s) de compensação banco credor gravado(s) no razão.`,
    );
  }, [empresaNome, planoRows, razaoRows, onRazaoRowsChange]);

  const comparativoColSpan = useMemo(
    () => 4 + periodosSelecionados.length * 5,
    [periodosSelecionados.length],
  );

  const virtual = useVirtualWindow(linhasFiltradas.length, {
    rowHeightPx: 40,
    overscan: 8,
    threshold: 40,
    resetKey: `${linhasFiltradas.length}:${periodosSelecionados.length}:${filtroDeferred}`,
  });

  const abrirRazaoConta = useCallback((linha: LinhaComparativoMensal, modo: RazaoContaModo) => {
    setContaRazaoSelecionada(linha);
    setRazaoContaModo(modo);
    setRazaoContaOpen(true);
  }, []);

  const parseValorInputDireto = (raw: string): number => {
    const s = raw.trim();
    if (!s) return 0;
    const n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? Math.abs(n) : 0;
  };

  const fmtMoneyDireto = (n: number): string => {
    if (!Number.isFinite(n) || Math.abs(n) < 0.005) return '—';
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const brToIsoDireto = (val: string): string => {
    if (!val) return '';
    const p = val.split('/');
    if (p.length === 3 && p[2].length === 4) return `${p[2]}-${p[1]}-${p[0]}`;
    return '';
  };

  const isoToBrDireto = (val: string): string => {
    if (!val) return '';
    const p = val.split('-');
    if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`;
    return val;
  };

  // A linha clicada em "Somente Razão" quase sempre é uma CÓPIA (merge de
  // débito+crédito em `razaoDisplayRows`), não a mesma referência do objeto em
  // `razaoRows`. Usa a chave de origem gravada por `withOrigem` (getRazaoRowKey)
  // para achar o lançamento real; se não houver tag (ex.: view "sem contrapartida",
  // onde a linha É a própria referência), cai no fallback por identidade direta.
  const localizarLinhaPorOrigem = useCallback(
    (row: VisionBalanceteRow, origKey: string | undefined, excluir?: VisionBalanceteRow): VisionBalanceteRow | undefined => {
      if (origKey) {
        const achada = razaoRows.find((r) => r !== excluir && getRazaoRowKey(r) === origKey);
        if (achada) return achada;
      }
      if (row !== excluir && razaoRows.includes(row)) return row;
      return undefined;
    },
    [razaoRows, getRazaoRowKey],
  );

  // Localiza, na `razaoRows` real, a linha que forneceu o lado débito e a que
  // forneceu o lado crédito de uma linha exibida (que pode ser um merge de
  // duas). Usado tanto para pré-preencher o modal quanto para salvar de volta —
  // antes essa lógica de `primarioKey`/`parKey` estava duplicada nas duas
  // funções, agora vive num só lugar.
  const resolverParDaLinha = useCallback(
    (row: VisionBalanceteRow): { primaria: VisionBalanceteRow | undefined; par: VisionBalanceteRow | undefined; eraDebito: boolean } => {
      const tags = row as RazaoRowComOrigem;
      const eraDebito = row.debito > 0;
      const primarioKey = eraDebito ? tags.__origKeyDeb : tags.__origKeyCred;
      const parKey = eraDebito ? tags.__origKeyCred : tags.__origKeyDeb;
      const primaria = localizarLinhaPorOrigem(row, primarioKey);
      const par = parKey && parKey !== primarioKey ? localizarLinhaPorOrigem(row, parKey, primaria) : undefined;
      return { primaria, par, eraDebito };
    },
    [localizarLinhaPorOrigem],
  );

  const abrirEdicaoDireta = (row: VisionBalanceteRow) => {
    setLancamentoEditandoDireto(row);
    setEditDataDireto(row.data || '');
    setEditHistoricoDireto(row.nome || '');

    // Mesmo resolvedor da tabela — o modal não pode abrir com um código
    // diferente do que a linha mostra.
    const resolverConta = resolverCodigoReduzido;

    const { par } = resolverParDaLinha(row);

    // Determine both accounts — sempre resolve para código reduzido do plano
    let contaDeb = resolverConta(row.contaDeb) || (row.debito > 0 ? resolverConta(row.codigo) : '');
    let contaCred = resolverConta(row.contaCred) || (row.credito > 0 ? resolverConta(row.codigo) : '');

    if (par) {
      // If we have a pair, use both accounts
      if (row.debito > 0 && par.credito > 0) {
        contaDeb = resolverConta(row.contaDeb) || resolverConta(row.codigo);
        contaCred = resolverConta(par.contaCred) || resolverConta(par.codigo);
      } else if (row.credito > 0 && par.debito > 0) {
        contaDeb = resolverConta(par.contaDeb) || resolverConta(par.codigo);
        contaCred = resolverConta(row.contaCred) || resolverConta(row.codigo);
      }
    }

    // Nunca pré-preencher o modal com a mesma conta nos dois lados — um
    // lançamento de perna única não pode aparecer fechado contra si mesmo.
    // Preserva o lado que veio da própria linha clicada (mais confiável) e
    // limpa o lado que veio do par/fallback.
    if (contaDeb && contaCred && contaDeb === contaCred) {
      if (row.debito > 0) contaCred = '';
      else contaDeb = '';
    }

    setEditContaDebDireto(contaDeb);
    setEditContaCredDireto(contaCred);
    setEditValorDireto(fmtMoneyDireto(row.debito > 0 ? row.debito : row.credito).replace('—', ''));
    setEditOrdemDireto(row.ordem?.toString() || '');
  };

  const fecharEdicaoDireta = () => {
    setLancamentoEditandoDireto(null);
    setEditDataDireto('');
    setEditHistoricoDireto('');
    setEditContaDebDireto('');
    setEditContaCredDireto('');
    setEditValorDireto('');
    setEditOrdemDireto('');
  };

  const salvarEdicaoDireta = () => {
    if (!lancamentoEditandoDireto) return;
    const valor = parseValorInputDireto(editValorDireto);
    const eraDebito = lancamentoEditandoDireto.debito > 0;
    const novaData = editDataDireto.trim() || lancamentoEditandoDireto.data;
    const novoNome = editHistoricoDireto.trim().toUpperCase() || lancamentoEditandoDireto.nome;
    let novaContaDeb = editContaDebDireto.trim() || undefined;
    let novaContaCred = editContaCredDireto.trim() || undefined;
    // Nunca gravar débito e crédito na mesma conta — preserva o lado que
    // representa o próprio lançamento sendo editado e limpa o outro.
    if (novaContaDeb && novaContaCred && novaContaDeb === novaContaCred) {
      if (eraDebito) novaContaCred = undefined;
      else novaContaDeb = undefined;
    }
    const novaOrdem = editOrdemDireto.trim() !== '' ? parseInt(editOrdemDireto.trim(), 10) : undefined;

    // Classificação hierárquica (ex: "2.1.5.01") só deve ser sobrescrita quando o novo
    // código resolva uma classificação com ponto. Linhas de automação (FOLHA-AUTO,
    // FISCAL-AUTO, HONOR-AUTO, etc.) usam `classificacao` como marcador de identidade —
    // sobrescrever com o código da conta destrói esse marcador e impede que o próximo
    // "Mandar para o Balancete" remova as linhas antigas, gerando duplicatas sem contrapartida.
    const resolverClassificacaoDireta = (novoCod: string | undefined, original: string | undefined): string | undefined => {
      if (novoCod && novoCod.includes('.')) return novoCod; // já é classificação hierárquica
      // Preserva original se for um marcador de automação (não é só dígitos/pontos)
      if (original && /[A-Za-z]/.test(original)) return original;
      return novoCod ?? original;
    };

    // `lancamentoEditandoDireto` normalmente é uma CÓPIA (merge de débito+crédito
    // em `razaoDisplayRows`), nunca a mesma referência de objeto presente em
    // `razaoRows` — por isso localiza o lançamento real pela chave de origem
    // (`__origKeyDeb`/`__origKeyCred`) em vez de comparar por `===`, que sempre
    // falhava e fazia a edição "não colar" (voltava pro valor antigo ao salvar).
    const { primaria: primarioResolvido, par } = resolverParDaLinha(lancamentoEditandoDireto);
    const primario = primarioResolvido ?? lancamentoEditandoDireto;

    const atualizado: VisionBalanceteRow = {
      ...primario,
      data: novaData,
      nome: novoNome,
      contaDeb: novaContaDeb,
      contaCred: novaContaCred,
      codigo: eraDebito ? (novaContaDeb ?? primario.codigo) : (novaContaCred ?? primario.codigo),
      classificacao: eraDebito
        ? resolverClassificacaoDireta(novaContaDeb, primario.classificacao)
        : resolverClassificacaoDireta(novaContaCred, primario.classificacao),
      debito: eraDebito ? valor : 0,
      credito: eraDebito ? 0 : valor,
      ordem: novaOrdem,
    };

    let novasLinhas = razaoRows.map((r) => (r === primario ? atualizado : r));

    if (par) {
      const parAtualizado: VisionBalanceteRow = {
        ...par,
        data: novaData,
        nome: novoNome,
        contaDeb: novaContaDeb,
        contaCred: novaContaCred,
        codigo: eraDebito ? (novaContaCred ?? par.codigo) : (novaContaDeb ?? par.codigo),
        classificacao: eraDebito
          ? resolverClassificacaoDireta(novaContaCred, par.classificacao)
          : resolverClassificacaoDireta(novaContaDeb, par.classificacao),
        debito: eraDebito ? 0 : valor,
        credito: eraDebito ? valor : 0,
        ordem: novaOrdem,
      };
      novasLinhas = novasLinhas.map((r) => (r === par ? parAtualizado : r));
    }

    onRazaoRowsChange(novasLinhas);
    fecharEdicaoDireta();
    setComparativoRefreshSeq((n) => n + 1);
  };

  const handleAplicarRateio = useCallback(
    (novasLinhas: VisionBalanceteRow[], lancamentosRemovidos: VisionBalanceteRow[]) => {
      // Rateio/zerar só ADICIONA pares (removidos vazio); transferência move (remove+adiciona).
      if (novasLinhas.length === 0 && lancamentosRemovidos.length === 0) return;

      // Chave IMUNE ao enriquecimento de plano: `filtrarContasAnaliticas` (via
      // `enrichNomeDoPlano`) reescreve `classificacao` (sempre) e `codigo`/`nome`
      // (quando vazios) das linhas antes de chegarem no modal de reclassificação —
      // então uma chave baseada em codigo/classificacao cru nunca batia com a linha
      // original em `razaoRows`, e NADA era removido da origem (o saldo continuava
      // invertido) enquanto as linhas transferidas eram inseridas no destino a cada
      // tentativa, duplicando o valor lá. `ordem` (sequencial Domínio) + data +
      // débito/crédito identificam o lançamento sem depender de conta/classificação.
      const chave = (r: VisionBalanceteRow) =>
        r.ordem != null && Number.isFinite(r.ordem)
          ? `ord:${r.data || ''}|${r.ordem}|${r.debito || 0}|${r.credito || 0}`
          : `sem-ord:${r.data || ''}|${r.nome || ''}|${r.debito || 0}|${r.credito || 0}`;

      // Contagem por chave (não Set) — se duas linhas distintas colidirem na mesma
      // chave, remove só a MESMA quantidade de instâncias presentes em
      // `lancamentosRemovidos`, nunca todas as ocorrências da conta inteira.
      const restantesParaRemover = new Map<string, number>();
      for (const r of lancamentosRemovidos) {
        const k = chave(r);
        restantesParaRemover.set(k, (restantesParaRemover.get(k) ?? 0) + 1);
      }

      const razaoFiltrado =
        restantesParaRemover.size > 0
          ? razaoRows.filter((r) => {
              const k = chave(r);
              const restante = restantesParaRemover.get(k);
              if (!restante) return true;
              restantesParaRemover.set(k, restante - 1);
              return false;
            })
          : razaoRows;

      const resultado = [...razaoFiltrado, ...novasLinhas];

      onRazaoRowsChange(resultado);
      setRateioModalOpen(false);
      setContaInvertidaParaRateio(null);
      setLancamentosRateio({ todos: [], invertidos: [], saldoAnterior: 0 });
      // Força remontagem do comparativo
      setComparativoRefreshSeq((n) => n + 1);
    },
    [razaoRows, onRazaoRowsChange],
  );

  const renderComparativoRow = useCallback(
    (props: {
      linha: LinhaComparativoMensal;
      periodos: PeriodoMensal[];
      mesRef: string;
      contabil: boolean;
      fixedHeight?: boolean;
    }) => (
      <ComparativoLinha
        {...props}
        onAbrirRazao={abrirRazaoConta}
        diasInvertidosFilter={filtroSomenteDiasInvertidos}
        descricaoNomeCompleto={descricaoNomeCompleto}
      />
    ),
    [abrirRazaoConta, filtroSomenteDiasInvertidos, descricaoNomeCompleto],
  );

  const handleAutomatizarRef = useRef(handleAutomatizar);
  const baixarRelatorioPdfRef = useRef(baixarRelatorioPdf);
  const exportarPdfBalanceteRef = useRef(exportarPdfBalancete);
  const exportarPdfInvertidasRef = useRef(exportarPdfInvertidas);
  const resultadoCicloRef = useRef(resultadoCiclo);
  handleAutomatizarRef.current = handleAutomatizar;
  baixarRelatorioPdfRef.current = baixarRelatorioPdf;
  exportarPdfBalanceteRef.current = exportarPdfBalancete;
  exportarPdfInvertidasRef.current = exportarPdfInvertidas;

  const processandoGarantidaRef = useRef(processandoGarantida);
  processandoGarantidaRef.current = processandoGarantida;
  resultadoCicloRef.current = resultadoCiclo;

  useEffect(() => {
    const onBotRun = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: string; id?: string }>).detail;
      if (detail?.tab !== 'manager' || !detail.id) return;
      const botRequestId = detail.id;

      if (!todasLinhasBanco.length && !temRelatorios) {
        emitTabBotResult(botRequestId, {
          ok: false,
          summary: 'Importe razão (banco) ou relatórios Folha/Fiscal antes do bot.',
          details: ['Abra Gerencial → Balancete comparativo com dados carregados.'],
        });
        return;
      }

      setResultadoCiclo(null);
      handleAutomatizarRef.current();

      void (async () => {
        const deadline = Date.now() + 180_000;
        let sawProcessing = false;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 400));
          if (processandoGarantidaRef.current) sawProcessing = true;
          const r = resultadoCicloRef.current;
          if (r) {
            const erros = coletarErrosRestantes(r);
            emitTabBotResult(botRequestId, {
              ok: erros.length === 0,
              summary:
                (r.lancamentosGerados?.length ?? 0) > 0
                  ? `${r.lancamentosGerados.length} lançamento(s) gerado(s) no razão.`
                  : 'Automatização concluída — confira o comparativo.',
              details: [...(r.detalhes?.slice(0, 12) ?? []), ...erros.slice(0, 6)],
              data: { lancamentos: r.lancamentosGerados?.length ?? 0 },
            });
            return;
          }
          if (sawProcessing && !processandoGarantidaRef.current) {
            emitTabBotResult(botRequestId, {
              ok: false,
              summary: 'Automatização encerrada sem resultado — veja alertas na tela.',
            });
            return;
          }
        }
        emitTabBotResult(botRequestId, {
          ok: false,
          summary: 'Timeout — automatização demorou demais.',
        });
      })();
    };

    window.addEventListener('contabilfacil-tab-bot-run', onBotRun);
    return () => window.removeEventListener('contabilfacil-tab-bot-run', onBotRun);
  }, [todasLinhasBanco.length, temRelatorios]);
  resultadoCicloRef.current = resultadoCiclo;

  const podeExportarPdf = linhas.length > 0 && !calculando && !processandoGarantida;

  const periodToolbarKey = useMemo(
    () =>
      [
        filtroNome,
        filtroSomenteInvertidas ? 1 : 0,
        filtroSomenteDiasInvertidos ? 1 : 0,
        calculando ? 1 : 0,
        processandoGarantida ? 1 : 0,
        progressoAutomacao,
        qtdContasConfig,
        linhas.length,
        todasLinhasBanco.length,
        temRelatorios ? 1 : 0,
        automacaoConcluida ? 1 : 0,
        resultadoCiclo ? 1 : 0,
        podeExportarPdf ? 1 : 0,
        naturezaManualEntries.length,
        configMenuOpen ? 1 : 0,
        opcaoAutomacao,
      ].join('\0'),
    [
      filtroNome,
      filtroSomenteInvertidas,
      filtroSomenteDiasInvertidos,
      calculando,
      processandoGarantida,
      progressoAutomacao,
      qtdContasConfig,
      linhas.length,
      todasLinhasBanco.length,
      temRelatorios,
      automacaoConcluida,
      resultadoCiclo,
      podeExportarPdf,
      naturezaManualEntries.length,
      configMenuOpen,
      opcaoAutomacao,
    ],
  );

  const periodToolbarNode = useMemo(
    () => (
      <div className="flex flex-col gap-3 w-full min-w-0 pt-3 border-t border-brand-border/30">
        <div className="flex flex-wrap items-stretch sm:items-center gap-2 w-full min-w-0">
          <div className="relative">
            <button
              type="button"
              disabled={processandoGarantida || calculando}
              onClick={() => setConfigMenuOpen((v) => !v)}
              className={`technical-button-secondary px-3 sm:px-4 py-2 text-[10px] font-black uppercase text-center whitespace-normal sm:whitespace-nowrap ${qtdContasConfig > 0 || naturezaManualEntries.length > 0 ? 'border-violet-700 text-violet-800' : ''
                }`}
              title="Configuração"
            >
              Configuração
            </button>
            {configMenuOpen && (
              <>
                <div className="fixed inset-0 z-[299]" onClick={() => setConfigMenuOpen(false)} />
                <div className="absolute left-0 top-full mt-1 z-[300] w-64 technical-panel bg-brand-bg shadow-[4px_4px_0_0_#141414] border border-brand-border">
                  <button
                    type="button"
                    onClick={() => {
                      setConfigContasOpen(true);
                      setConfigMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 text-[10px] font-black uppercase hover:bg-brand-sidebar/30 flex items-center justify-between"
                  >
                    Automação
                    {qtdContasConfig > 0 && (
                      <span className="text-[9px] font-bold normal-case text-green-700">
                        {qtdContasConfig}/{PAPEIS_AUTOMACAO_UI.length}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNaturezaManualModalOpen(true);
                      setConfigMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 text-[10px] font-black uppercase hover:bg-brand-sidebar/30 border-t border-brand-border/30 flex items-center justify-between"
                  >
                    Natureza das contas
                    {naturezaManualEntries.length > 0 && (
                      <span className="text-[9px] font-bold normal-case text-green-700">
                        {naturezaManualEntries.length}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExcluirMesesContasOpen(true);
                      setConfigMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 text-[10px] font-black uppercase hover:bg-brand-sidebar/30 border-t border-brand-border/30 text-red-800"
                  >
                    Excluir período / contas
                  </button>
                  {onAbrirDocsImportados && docsImportadosCount > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        onAbrirDocsImportados();
                        setConfigMenuOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 text-[10px] font-black uppercase hover:bg-brand-sidebar/30 border-t border-brand-border/30 flex items-center justify-between"
                    >
                      Docs. Importados
                      <span className="text-[9px] font-bold normal-case text-green-700">
                        {docsImportadosCount}
                      </span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
          {onAbrirLogs && importedLogs.length > 0 && (
            <button
              type="button"
              onClick={onAbrirLogs}
              className="technical-button-secondary px-3 sm:px-4 py-2 text-[10px] font-black uppercase whitespace-nowrap"
              title="Ver logs da importação de balancete"
            >
              Logs
            </button>
          )}
          <button
            type="button"
            disabled={!podeExportarPdf}
            onClick={() => exportarPdfBalanceteRef.current()}
            className="technical-button-primary px-3 sm:px-5 py-2 text-[10px] font-black uppercase whitespace-nowrap disabled:opacity-40"
            title="PDF do comparativo mensal, auditoria RF/CPC e contas invertidas (*)"
          >
            Exportar PDF
          </button>
          <button
            type="button"
            disabled={!razaoRows.length || calculando}
            onClick={() => exportarPdfInvertidasRef.current()}
            className="technical-button-secondary px-3 sm:px-4 py-2 text-[10px] font-black uppercase whitespace-nowrap disabled:opacity-40"
            title="PDF só com contas de natureza invertida, mês a mês"
          >
            PDF Invertidas
          </button>
          <div className="flex items-center gap-1">
            <select
              value={opcaoAutomacao}
              onChange={(e) => setOpcaoAutomacao(e.target.value)}
              className={
                contabil
                  ? 'h-[30px] px-2 bg-white border border-brand-border text-[10px] font-bold focus:outline-none'
                  : 'h-[30px] px-2 bg-slate-900 border border-slate-600 rounded text-white text-[10px] font-bold focus:outline-none focus:border-violet-500'
              }
              aria-label="Selecionar tipo de automação"
            >
              <option value="custo">Custo</option>
              <option value="coligadas">Empréstimo entre Coligadas</option>
              <option value="emprestimo">Empréstimo Bancário</option>
              <option value="zeramento">Zeramento das Contas de Resultado</option>
              <option value="compensacao_banco">Compensação Banco Credor</option>
            </select>
            <button
              type="button"
              disabled={calculando || processandoGarantida}
              onClick={handleAplicarAutomacao}
              className={
                contabil
                  ? 'technical-button-primary h-[30px] px-3 text-[10px] font-black uppercase whitespace-nowrap disabled:opacity-40'
                  : 'h-[30px] px-3 rounded bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-black uppercase whitespace-nowrap disabled:opacity-40'
              }
              title={
                opcaoAutomacao === 'zeramento' || opcaoAutomacao === 'compensacao_banco'
                  ? 'Abre configuração para informar contas e gerar os lançamentos'
                  : 'Executa a automação selecionada e grava os lançamentos no razão'
              }
            >
              Aplicar Automações
            </button>
          </div>
        </div>
      </div>
    ),
    [periodToolbarKey],
  );

  useEffect(() => {
    if (!contabil || !setPeriodToolbar) return;
    setPeriodToolbar(periodToolbarNode);
    return () => {
      setPeriodToolbar(null);
    };
  }, [contabil, setPeriodToolbar, periodToolbarNode]);

  if (!razaoRows.length) {
    return <p className="text-[11px] text-slate-400">Importe o razão com datas para o comparativo.</p>;
  }

  if (calculando && !periodosSelecionados.length) {
    return (
      <p className="text-[11px] text-slate-400">
        Montando comparativo… {progresso || 'filtrando meses com movimento…'}
      </p>
    );
  }

  if (!periodosSelecionados.length) {
    return (
      <p className="text-[11px] text-amber-300/90">
        Nenhum mês com débito/crédito entre {periodoDe} e {periodoAte}. Ajuste o período ou importe o razão.
      </p>
    );
  }

  return (
    <div
      className={
        telaCheia
          ? `fixed inset-0 z-[350] flex flex-col gap-3 overflow-hidden p-3 ${contabil ? 'bg-brand-bg' : 'bg-slate-950'}`
          : 'relative space-y-3'
      }
    >
      {!contabil && (
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/15 p-3 space-y-2">
          <p className="text-[10px] text-slate-400">
            <strong className="text-cyan-300">Modo comparativo</strong> · {periodoDe} a {periodoAte} ·{' '}
            {periodosSelecionados.length} mês(es)
          </p>
          <div className="flex flex-col gap-3 min-w-0">
            <div className="w-full min-w-0 max-w-md">
              <label className="text-[10px] font-bold uppercase mb-1 block opacity-60">Filtrar conta</label>
              <input
                type="text"
                value={filtroNome}
                onChange={(e) => setFiltroNome(e.target.value)}
                placeholder="Nome ou classificação"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs"
              />
            </div>
            <div className="flex flex-wrap items-stretch sm:items-center gap-2 w-full min-w-0">
              <div className="relative">
                <button
                  type="button"
                  disabled={processandoGarantida || calculando}
                  onClick={() => setConfigMenuOpen((v) => !v)}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border text-[11px] font-black uppercase tracking-wide transition-all ${qtdContasConfig > 0 || naturezaManualEntries.length > 0
                    ? 'border-violet-400/60 bg-violet-950/40 text-violet-200 hover:bg-violet-900/50'
                    : 'border-slate-600 bg-slate-900/80 text-slate-300 hover:border-violet-500/40'
                    }`}
                >
                  Configuração
                </button>
                {configMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-[299]" onClick={() => setConfigMenuOpen(false)} />
                    <div className="absolute left-0 top-full mt-1 z-[300] w-64 rounded-lg border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">
                      <button
                        type="button"
                        onClick={() => {
                          setConfigContasOpen(true);
                          setConfigMenuOpen(false);
                        }}
                        className="w-full text-left px-3 py-2.5 text-[11px] font-black uppercase text-slate-200 hover:bg-slate-800 flex items-center justify-between"
                      >
                        Automação
                        {qtdContasConfig > 0 && (
                          <span className="text-[10px] font-bold normal-case text-emerald-400">
                            {qtdContasConfig}/{PAPEIS_AUTOMACAO_UI.length}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setNaturezaManualModalOpen(true);
                          setConfigMenuOpen(false);
                        }}
                        className="w-full text-left px-3 py-2.5 text-[11px] font-black uppercase text-slate-200 hover:bg-slate-800 border-t border-slate-700 flex items-center justify-between"
                      >
                        Natureza das contas
                        {naturezaManualEntries.length > 0 && (
                          <span className="text-[10px] font-bold normal-case text-emerald-400">
                            {naturezaManualEntries.length}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setExcluirMesesContasOpen(true);
                          setConfigMenuOpen(false);
                        }}
                        className="w-full text-left px-3 py-2.5 text-[11px] font-black uppercase text-red-400 hover:bg-slate-800 border-t border-slate-700"
                      >
                        Excluir período / contas
                      </button>
                    </div>
                  </>
                )}
              </div>
              <button
                type="button"
                disabled={processandoGarantida || calculando || (!todasLinhasBanco.length && !temRelatorios)}
                onClick={handleAutomatizar}
                className="px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-[11px] font-black uppercase tracking-wide"
              >
                {processandoGarantida ? progressoAutomacao || 'Automatizando…' : 'Automatizar'}
              </button>
              <button
                type="button"
                disabled={!automacaoConcluida || !resultadoCiclo}
                onClick={() => resultadoCiclo && baixarRelatorioPdf(resultadoCiclo)}
                className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[11px] font-black uppercase tracking-wide border transition-all ${automacaoConcluida && resultadoCiclo
                  ? 'bg-emerald-600 hover:bg-emerald-500 border-emerald-400 text-white'
                  : 'bg-slate-800/80 border-slate-600 text-slate-500 cursor-not-allowed'
                  }`}
              >
                Relatório
              </button>
              <button
                type="button"
                disabled={!periodosSelecionados.length || !razaoRows.length}
                onClick={() => setIndicesFinanceirosOpen(true)}
                className="px-5 py-2.5 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] font-black uppercase tracking-wide"
                title="Índices financeiros (liquidez e endividamento) da empresa"
              >
                Índices financeiros
              </button>
            </div>
          </div>
          <p className="text-[10px] text-slate-500 w-full">
            Use <strong className="text-violet-300">Configuração de automação</strong> para fixar contas da automatização.
          </p>
        </div>
      )}

      <AutomatizacaoContaConfigModal
        open={configContasOpen}
        onClose={() => {
          setConfigContasOpen(false);
          setSubOverlayInicial(null);
        }}
        planoRows={planoRows}
        razaoRows={razaoRows}
        empresaNome={empresaNome}
        onSaved={setContaConfig}
        onRazaoRowsChange={onRazaoRowsChange}
        surface={contabil ? 'contabilfacil' : 'vision'}
        abrirSubOverlay={subOverlayInicial}
        periodoDe={periodoDe}
        periodoAte={periodoAte}
      />
      {compensacaoDataDialogOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-label="Data dos lançamentos">
          <div className={contabil ? 'bg-white border border-brand-border shadow-lg w-full max-w-sm p-6 space-y-4' : 'bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4'}>
            <h2 className={contabil ? 'text-[11px] font-black uppercase tracking-widest text-brand-text' : 'text-sm font-black uppercase tracking-widest text-white'}>
              Compensação Banco Credor
            </h2>
            <p className={contabil ? 'text-[9px] font-bold uppercase opacity-50 leading-snug' : 'text-[10px] text-slate-400 leading-snug'}>
              A partir desta data o sistema analisa o banco dia a dia: todo dia que fechar credor
              recebe a utilização naquele mesmo dia, e a devolução entra no dia seguinte.
            </p>
            <div className="space-y-1">
              <label className={contabil ? 'text-[8px] font-black uppercase text-brand-text/50 block' : 'text-[9px] text-slate-500 block'}>
                Analisar a partir de (DD/MM/AAAA)
              </label>
              <input
                type="date"
                value={compensacaoDataInput}
                onChange={(e) => setCompensacaoDataInput(e.target.value)}
                autoFocus
                className={contabil ? 'w-full px-2 py-1.5 bg-white border border-brand-border text-xs font-mono font-bold focus:outline-none focus:ring-1 focus:ring-brand-border' : 'w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-xs'}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setCompensacaoDataDialogOpen(false)}
                className={contabil ? 'technical-button text-[9px] py-1 px-4' : 'px-4 py-1.5 rounded border border-slate-600 text-slate-300 text-[10px] font-bold uppercase'}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!compensacaoDataInput}
                onClick={() => {
                  // input type=date retorna yyyy-mm-dd; converter para DD/MM/AAAA
                  const parts = compensacaoDataInput.split('-');
                  const dataBr = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : compensacaoDataInput;
                  if (!isValidBrDate(dataBr)) {
                    window.alert('Data inválida. Informe no formato DD/MM/AAAA.');
                    return;
                  }
                  handleConfirmarCompensacao(dataBr);
                }}
                className={contabil ? 'technical-button-primary text-[9px] py-1 px-4 disabled:opacity-40' : 'px-4 py-1.5 rounded bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-black uppercase disabled:opacity-40'}
              >
                Aplicar Automação
              </button>
            </div>
          </div>
        </div>
      )}
      <IndicesFinanceirosModal
        open={indicesFinanceirosOpen}
        onClose={() => setIndicesFinanceirosOpen(false)}
        indices={indicesFinanceiros}
        contabil={contabil}
      />
      <NaturezaContasManualModal
        open={naturezaManualModalOpen}
        onClose={() => setNaturezaManualModalOpen(false)}
        planoRows={planoRows}
        empresaAtual={empresaNome}
        todasEmpresas={todasEmpresas}
        folders={naturezaFolders}
        onSaveFolder={salvarNaturezaFolder}
        onDeleteFolder={excluirNaturezaFolder}
        contabil={contabil}
      />
      <ExcluirMesesContasModal
        open={excluirMesesContasOpen}
        onClose={() => setExcluirMesesContasOpen(false)}
        razaoRows={razaoRows}
        planoRows={planoRows}
        onRazaoRowsChange={onRazaoRowsChange}
        contabil={contabil}
      />
      <RazaoContaLancamentosModal
        open={razaoContaOpen}
        onClose={() => {
          setRazaoContaOpen(false);
          setContaRazaoSelecionada(null);
        }}
        razaoRows={razaoRows}
        planoRows={planoRows}
        conta={contaRazaoSelecionada}
        modo={razaoContaModo}
        periodoDe={periodoDe}
        periodoAte={periodoAte}
        surface={contabil ? 'contabilfacil' : 'vision'}
        onRazaoRowsChange={onRazaoRowsChange}
        onAbrirTransferencia={(conta, lancamentos) => {
          setContaInvertidaParaRateio({
            codigo: conta.codigo || '',
            classificacao: conta.classificacao || '',
            nome: conta.nome || 'SEM NOME',
            saldoFinal: 0,
          });
          setLancamentosRateio(lancamentos);
          setRateioModalOpen(true);
        }}
      />
      <RazaoContaRateioModal
        isOpen={rateioModalOpen}
        onClose={() => {
          setRateioModalOpen(false);
          setContaInvertidaParaRateio(null);
          setLancamentosRateio({ todos: [], invertidos: [], saldoAnterior: 0 });
        }}
        contaInvertida={contaInvertidaParaRateio}
        lancamentos={lancamentosRateio}
        razaoCompleto={razaoRows}
        planoContas={planoRows.map((p) => ({
          code: p.codigo,
          name: p.nome,
          codigoReduzido: p.codigoReduzido,
          tipo: p.tipo,
          nivel: p.nivel,
        }))}
        onAplicarRateio={handleAplicarRateio}
      />
      {resultadoCiclo && <ResultadoAutomatizacaoCompacto resultado={resultadoCiclo} />}

      {calculando && linhas.length === 0 ? (
        <div
          className={
            (contabil
              ? 'technical-panel p-8 text-center text-[10px] font-mono uppercase opacity-60'
              : 'rounded-xl border border-slate-800 p-8 text-center text-slate-400 text-sm') +
            (telaCheia ? ' flex-1' : '')
          }
        >
          Montando comparativo…
          {progresso ? (
            <p className="mt-2 text-[9px] font-mono normal-case tracking-normal">{progresso}</p>
          ) : null}
        </div>
      ) : (
        <div
          className={
            (contabil
              ? 'module-table-viewport-stacked notranslate'
              : 'module-table-viewport-stacked rounded-xl border border-slate-800 notranslate') +
            (telaCheia ? ' flex-1 min-h-0' : '')
          }
          style={telaCheia ? { height: 'auto', maxHeight: 'none' } : undefined}
        >
          <div
            className={`flex items-center gap-1.5 p-1 shrink-0 ${contabil ? 'border-b border-brand-border bg-brand-sidebar/60' : 'border-b border-slate-800 bg-slate-950'}`}
          >
            <label
              className={`text-[9px] font-bold uppercase tracking-wide opacity-60 ${contabil ? '' : 'text-slate-400'}`}
            >
              Visualizar
            </label>
            <select
              value={modoView}
              onChange={(e) => {
                const next = e.target.value as typeof modoView;
                if (next === 'razao') {
                  // Filtros de invertidos são só do Balancete.
                  setFiltroSomenteInvertidas(false);
                  setFiltroSomenteDiasInvertidos(false);
                }
                // "Sem Contrapartida" só existe no modo Somente Razão
                if (next === 'balancete' && buscaTipo === 'sem_contrapartida') {
                  setBuscaTipo('conta');
                }
                setModoView(next);
              }}
              className={
                contabil
                  ? 'border border-brand-border bg-brand-bg text-[9px] font-bold uppercase px-1.5 py-1'
                  : 'text-[9px] font-bold uppercase px-1.5 py-1 rounded border border-slate-600 bg-slate-950 text-slate-200'
              }
              title="Balancete (agrupado por conta) ou Somente Razão (lançamento por lançamento)"
            >
              <option value="balancete">Balancete</option>
              <option value="razao">Somente Razão</option>
            </select>
          </div>
          <div
            className={`flex flex-wrap items-center gap-1.5 p-1 shrink-0 ${contabil ? 'border-b border-brand-border bg-brand-sidebar' : 'border-b border-slate-800 bg-slate-900'}`}
          >
            <select
              value={buscaTipo}
              onChange={(e) => {
                const next = e.target.value as typeof buscaTipo;
                if (next !== 'historico') setBuscaTexto('');
                if (next !== 'conta') setFiltroNome('');
                setBuscaTipo(next);
              }}
              className={
                contabil
                  ? 'border border-brand-border bg-brand-bg text-[9px] font-bold uppercase px-1.5 py-1'
                  : 'text-[9px] font-bold uppercase px-1.5 py-1 rounded border border-slate-600 bg-slate-950 text-slate-200'
              }
              title="O que pesquisar"
            >
              <option value="conta">Conta</option>
              <option value="historico">Histórico</option>
              <option value="valor">Valor</option>
              {modoView === 'razao' && <option value="sem_contrapartida">Sem Contrapartida</option>}
            </select>

            {(buscaTipo === 'conta' || buscaTipo === 'historico') && (
              <input
                type="text"
                value={buscaTipo === 'conta' ? filtroNome : buscaTexto}
                onChange={(e) =>
                  buscaTipo === 'conta' ? setFiltroNome(e.target.value) : setBuscaTexto(e.target.value)
                }
                placeholder={buscaTipo === 'conta' ? 'Nome, código ou classificação…' : 'Histórico do lançamento…'}
                className={
                  contabil
                    ? 'border border-brand-border bg-brand-bg text-[10px] font-mono px-2 py-1 w-40 sm:w-56'
                    : 'text-[10px] px-2 py-1 w-40 sm:w-56 rounded border border-slate-600 bg-slate-950 text-slate-200'
                }
              />
            )}

            {(buscaTipo === 'historico' || buscaTipo === 'valor') && (
              <input
                type="text"
                inputMode="decimal"
                value={buscaValor}
                onChange={(e) => setBuscaValor(e.target.value)}
                placeholder="Valor (ex: 1234,56)"
                className={
                  contabil
                    ? 'border border-brand-border bg-brand-bg text-[10px] font-mono px-2 py-1 w-28 text-right'
                    : 'text-[10px] px-2 py-1 w-28 text-right rounded border border-slate-600 bg-slate-950 text-slate-200'
                }
              />
            )}

            {(buscaTipo === 'historico' || buscaTipo === 'valor') && (
              <>
                <input
                  type="date"
                  value={buscaBrToDate(buscaDataDe)}
                  onChange={(e) => setBuscaDataDe(buscaDateToBr(e.target.value))}
                  className={
                    contabil
                      ? 'border border-brand-border bg-brand-bg text-[10px] font-mono px-1.5 py-1'
                      : 'text-[10px] px-1.5 py-1 rounded border border-slate-600 bg-slate-950 text-slate-200'
                  }
                  title="Data de"
                />
                <span className="text-[9px] opacity-50">até</span>
                <input
                  type="date"
                  value={buscaBrToDate(buscaDataAte)}
                  onChange={(e) => setBuscaDataAte(buscaDateToBr(e.target.value))}
                  className={
                    contabil
                      ? 'border border-brand-border bg-brand-bg text-[10px] font-mono px-1.5 py-1'
                      : 'text-[10px] px-1.5 py-1 rounded border border-slate-600 bg-slate-950 text-slate-200'
                  }
                  title="Data até"
                />
              </>
            )}

            {modoView === 'balancete' && (
              <>
                <label
                  className={`flex items-center gap-1.5 text-[9px] font-bold uppercase whitespace-nowrap ${filtroSomenteDiasInvertidos ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                    }`}
                  title={
                    filtroSomenteDiasInvertidos
                      ? 'Desmarque "Contas com razão invertido" para usar este filtro — os dois são mutuamente exclusivos.'
                      : undefined
                  }
                >
                  <input
                    type="checkbox"
                    checked={filtroSomenteInvertidas}
                    disabled={filtroSomenteDiasInvertidos}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setFiltroSomenteDiasInvertidos(false);
                      }
                      setFiltroSomenteInvertidas(e.target.checked);
                    }}
                    className="w-3.5 h-3.5 border border-brand-border bg-brand-bg disabled:cursor-not-allowed"
                  />
                  <span>Contas saldo mês invertido</span>
                </label>
                <label
                  className={`flex items-center gap-1.5 text-[9px] font-bold uppercase whitespace-nowrap ${filtroSomenteInvertidas ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                    }`}
                  title={
                    filtroSomenteInvertidas
                      ? 'Desmarque "Contas saldo mês invertido" para usar este filtro — os dois são mutuamente exclusivos.'
                      : undefined
                  }
                >
                  <input
                    type="checkbox"
                    checked={filtroSomenteDiasInvertidos}
                    disabled={filtroSomenteInvertidas}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setFiltroSomenteInvertidas(false);
                      }
                      setFiltroSomenteDiasInvertidos(e.target.checked);
                    }}
                    className="w-3.5 h-3.5 border border-brand-border bg-brand-bg disabled:cursor-not-allowed"
                  />
                  <span>Contas com razão invertido</span>
                </label>
                <label
                  className="flex items-center gap-1.5 text-[9px] font-bold uppercase whitespace-nowrap cursor-pointer"
                  title="Mostra o nome inteiro de cada conta, sem abreviar: a coluna Descrição acompanha o maior nome e a tabela rola na horizontal. Desmarcado, a coluna tem largura fixa e os nomes longos são abreviados com reticências."
                >
                  <input
                    type="checkbox"
                    checked={descricaoNomeCompleto}
                    onChange={(e) => setDescricaoNomeCompleto(e.target.checked)}
                    className="w-3.5 h-3.5 border border-brand-border bg-brand-bg"
                  />
                  <span>Nomes completos</span>
                </label>
              </>
            )}

            {(filtroNome ||
              buscaTexto ||
              buscaValor ||
              buscaDataDe ||
              buscaDataAte) && (
                <button
                  type="button"
                  onClick={() => {
                    setFiltroNome('');
                    setBuscaTexto('');
                    setBuscaValor('');
                    setBuscaDataDe('');
                    setBuscaDataAte('');
                  }}
                  className={
                    contabil
                      ? 'technical-button-secondary text-[9px] font-bold uppercase px-2 py-1'
                      : 'text-[9px] font-bold uppercase px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-800'
                  }
                >
                  Limpar
                </button>
              )}

            <button
              type="button"
              onClick={() => setTelaCheia((v) => !v)}
              title={telaCheia ? 'Sair da tela cheia (Esc)' : 'Tela cheia'}
              className={
                (contabil
                  ? 'technical-button-secondary p-1'
                  : 'p-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-800') + ' ml-auto'
              }
            >
              {telaCheia ? <Minimize2 size={12} aria-hidden /> : <Maximize2 size={12} aria-hidden />}
            </button>
          </div>
          <div
            ref={virtual.useVirtual ? virtual.scrollRef : undefined}
            onScroll={virtual.useVirtual ? virtual.onScroll : undefined}
            className={`module-table-viewport-scroll ${contabil ? '' : 'custom-scrollbar'}`}
          >
            {modoView === 'razao' ? (
              <div className="space-y-2">
                {buscaTipo === 'sem_contrapartida' && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={selectedEntriesToPair.size !== 2}
                      onClick={() => {
                        // Pair the two selected entries!
                        const selectedKeys = Array.from(selectedEntriesToPair);
                        if (selectedKeys.length !== 2) return;

                        // Find the selected entries in razaoRows by key
                        const entries = razaoRows.filter((r) => selectedKeys.includes(getRazaoRowKey(r)));

                        if (entries.length !== 2) return;

                        // Calculate a new unique ordem number: max existing ordem + 1
                        const maxOrdem = razaoRows.reduce((max, r) => Math.max(max, r.ordem ?? 0), 0);
                        const newOrdem = maxOrdem + 1;

                        // Use the first entry's date, or if they are different, ask? No, just pick one, or allow user to edit later.
                        const newData = entries[0].data || entries[1].data || '';

                        // Update both entries
                        const novasLinhas = razaoRows.map((r) => {
                          if (selectedKeys.includes(getRazaoRowKey(r))) {
                            return {
                              ...r,
                              data: newData,
                              ordem: newOrdem,
                            };
                          }
                          return r;
                        });

                        onRazaoRowsChange(novasLinhas);
                        setSelectedEntriesToPair(new Set());
                        setComparativoRefreshSeq((n) => n + 1);
                      }}
                      className={contabil
                        ? 'technical-button-primary px-4 py-2 text-[10px] font-bold uppercase disabled:opacity-40'
                        : 'px-4 py-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-[10px] font-bold uppercase disabled:opacity-40'}
                    >
                      Parear selecionados ({selectedEntriesToPair.size}/2)
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedEntriesToPair(new Set())}
                      className={contabil
                        ? 'technical-button-secondary px-4 py-2 text-[10px] font-bold uppercase'
                        : 'px-4 py-2 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 text-[10px] font-bold uppercase'}
                    >
                      Limpar seleção
                    </button>
                  </div>
                )}
                <table className="w-full text-left text-[11px] min-w-max border-collapse">
                  <thead className={contabil ? 'technical-grid-header sticky top-0 z-10' : 'bg-slate-800 text-slate-400 sticky top-0 z-10'}>
                    <tr>
                      {buscaTipo === 'sem_contrapartida' && (
                        <th translate="no" className="p-2 font-bold min-w-[40px]">Selec</th>
                      )}
                      <th translate="no" className="p-2 font-bold min-w-[92px]">Data</th>
                      <th translate="no" className="p-2 font-bold min-w-[60px]">Ordem</th>
                      <th translate="no" className="p-2 font-bold min-w-[84px]">Conta Débito</th>
                      <th translate="no" className="p-2 font-bold min-w-[84px]">Conta Crédito</th>
                      <th translate="no" className="p-2 font-bold min-w-[260px]">Histórico</th>
                      <th translate="no" className="p-2 font-bold text-right min-w-[110px]">Débito</th>
                      <th translate="no" className="p-2 font-bold text-right min-w-[110px]">Crédito</th>
                    </tr>
                  </thead>
                  <tbody>
                    {razaoDisplayRows.map((r, idx) => {
                      const invertido = chavesLancamentosInvertidosRazao.has(chaveLancamentoRazao(r));
                      const rowClass = invertido
                        ? (contabil
                          ? 'bg-red-200 border-l-4 border-l-red-800 text-red-900'
                          : 'bg-red-950/70 border-l-4 border-l-red-600 text-red-50')
                        : (idx % 2 === 1 ? (contabil ? 'bg-brand-sidebar/20' : 'bg-slate-900/40') : '');
                      const rowKey = getRazaoRowKey(r);
                      // Última linha de defesa: nunca exibir a mesma conta em débito e
                      // crédito, mesmo que os dados cheguem assim de alguma etapa anterior.
                      const displayContaDebBruta = resolverCodigoReduzido(
                        r.contaDeb || ((r.debito ?? 0) > 0 ? r.codigo : '') || '',
                      );
                      const displayContaCredBruta = resolverCodigoReduzido(
                        r.contaCred || ((r.credito ?? 0) > 0 ? r.codigo : '') || '',
                      );
                      const { contaDeb: displayContaDeb, contaCred: displayContaCred } = contasSaoIguaisEDevemSerLimpa(
                        displayContaDebBruta,
                        displayContaCredBruta,
                      );

                      return (
                        <tr
                          key={rowKey}
                          className={`${rowClass} cursor-pointer hover:opacity-80 transition-opacity`}
                          title={invertido ? 'Lançamento invertido (causa-raiz da inversão de natureza)' : undefined}
                          onClick={(e) => {
                            // If clicked on checkbox, don't trigger row click
                            if ((e.target as HTMLElement).tagName === 'INPUT') return;
                            // Todos os modos abrem o modal de edição direta com débito/crédito/histórico
                            abrirEdicaoDireta(r);
                          }}
                        >
                          {buscaTipo === 'sem_contrapartida' && (
                            <td className="p-2">
                              <input
                                type="checkbox"
                                checked={selectedEntriesToPair.has(rowKey)}
                                onChange={(e) => {
                                  const newSet = new Set(selectedEntriesToPair);
                                  if (e.target.checked) {
                                    newSet.add(rowKey);
                                  } else {
                                    newSet.delete(rowKey);
                                  }
                                  setSelectedEntriesToPair(newSet);
                                }}
                                className="w-4 h-4"
                              />
                            </td>
                          )}
                          <td className="p-2 font-mono whitespace-nowrap">{r.data ?? '—'}</td>
                          <td className="p-2 font-mono whitespace-nowrap">{r.ordem ?? '—'}</td>
                          <td className="p-2 font-mono whitespace-nowrap">{displayContaDeb || '—'}</td>
                          <td className="p-2 font-mono whitespace-nowrap">{displayContaCred || '—'}</td>
                          <td className="p-2">
                            {r.nome || r.historico || 'LANÇAMENTO'}
                            {invertido ? (
                              <span className={`ml-1.5 text-[8px] font-black uppercase ${contabil ? 'text-red-800' : 'text-red-300'}`}>
                                Invertido
                              </span>
                            ) : null}
                          </td>
                          <td className="p-2 text-right font-mono">
                            {r.debito ? r.debito.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}
                          </td>
                          <td className="p-2 text-right font-mono">
                            {r.credito ? r.credito.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                    {razaoDisplayRows.length === 0 && (
                      <tr>
                        <td colSpan={buscaTipo === 'sem_contrapartida' ? 8 : 7} className="p-4 text-center opacity-50 text-[10px]">
                          Nenhum lançamento encontrado.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <table className="w-full text-left text-[11px] min-w-max border-collapse">
                <thead className={contabil ? 'technical-grid-header sticky top-0 z-10' : 'bg-slate-800 text-slate-400 sticky top-0 z-10'}>
                  <tr>
                    <th translate="no" className="p-2 font-bold min-w-[84px]">
                      Código
                    </th>
                    <th translate="no" className="p-2 font-bold min-w-[100px]">
                      Classificação
                    </th>
                    <th
                      translate="no"
                      className={`p-2 font-bold ${descricaoNomeCompleto ? DESCRICAO_COL_W_COMPLETO : DESCRICAO_COL_W}`}
                    >
                      Descrição
                    </th>
                    <th translate="no" className="p-2 font-bold text-center w-24">
                      Tipo
                    </th>
                    {periodosSelecionados.map((p) => {
                      const hl = contabil
                        ? p.label === mesRef
                          ? 'bg-brand-sidebar/60'
                          : ''
                        : p.label === mesRef
                          ? 'text-cyan-300 bg-cyan-950/40'
                          : '';
                      return (
                        <React.Fragment key={`h-${p.label}`}>
                          <th translate="no" className={`p-2 font-bold whitespace-nowrap min-w-[92px] ${hl}`}>
                            Data {p.label}
                          </th>
                          <th translate="no" className={`p-2 font-bold text-right whitespace-nowrap min-w-[140px] ${hl}`}>
                            Saldo Anterior {p.label}
                          </th>
                          <th translate="no" className={`p-2 font-bold text-right whitespace-nowrap min-w-[110px] ${hl}`}>
                            D {p.label}
                          </th>
                          <th translate="no" className={`p-2 font-bold text-right whitespace-nowrap min-w-[110px] ${hl}`}>
                            C {p.label}
                          </th>
                          <th translate="no" className={`p-2 font-bold text-right whitespace-nowrap min-w-[110px] ${hl}`}>
                            SF {p.label}
                          </th>
                        </React.Fragment>
                      );
                    })}
                    <th
                      translate="no"
                      className={`p-2 font-bold text-center w-20 ${contabil ? '' : 'sticky right-0 bg-slate-800 z-[11]'}`}
                    >
                      Natureza
                    </th>
                  </tr>
                </thead>
                <ComparativoVirtualBody
                  linhas={linhasFiltradas}
                  periodos={periodosSelecionados}
                  mesRef={mesRef}
                  contabil={contabil}
                  virtual={virtual}
                  colSpan={comparativoColSpan}
                  renderRow={renderComparativoRow}
                />
              </table>
            )}
          </div>
          {totalRows > 0 && (
            <p
              className={`module-table-viewport-footer text-[9px] p-2 border-t ${contabil ? 'border-brand-border font-mono opacity-60 bg-white' : 'text-slate-500 border-slate-800 bg-slate-950/95'
                }`}
            >
              {totalRows.toLocaleString('pt-BR')} {modoView === 'razao' ? 'lançamento(s)' : 'conta(s)'}
              {modoView === 'balancete' && virtual.useVirtual ? ' · scroll virtual (só linhas visíveis na tela)' : ''}
            </p>
          )}
        </div>
      )}

      {lancamentoEditandoDireto ? (
        <div
          className={contabil ? 'fixed inset-0 z-[240] flex items-center justify-center p-4 bg-brand-text/50' : 'fixed inset-0 z-[240] flex items-center justify-center p-4 bg-black/80'}
          role="dialog"
          aria-modal="true"
          aria-label="Editar lançamento"
          onClick={(e) => {
            if (e.target === e.currentTarget) fecharEdicaoDireta();
          }}
        >
          <div
            className={
              contabil
                ? 'technical-panel w-full max-w-md p-5 space-y-4 shadow-[6px_6px_0_0_#141414] bg-brand-bg'
                : 'w-full max-w-md p-5 space-y-4 rounded-xl border border-slate-700 bg-slate-950 shadow-2xl'
            }
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className={contabil ? 'text-sm font-black uppercase tracking-tight' : 'text-sm font-black uppercase tracking-tight text-cyan-200'}>
                Editar lançamento
              </h3>
              <button
                type="button"
                onClick={fecharEdicaoDireta}
                className={contabil ? 'technical-button-secondary p-1.5' : 'p-1.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-800'}
                aria-label="Fechar edição"
              >
                ×
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[9px] font-bold uppercase tracking-wider opacity-60">Data</label>
                <input
                  type="date"
                  value={brToIsoDireto(editDataDireto)}
                  onChange={(e) => setEditDataDireto(isoToBrDireto(e.target.value))}
                  className={contabil ? 'w-full text-[11px] font-mono bg-brand-bg border border-brand-border px-2 py-1.5 outline-none' : 'w-full text-[11px] font-mono bg-white/5 border border-slate-600 px-2 py-1.5 outline-none text-white rounded'}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-bold uppercase tracking-wider opacity-60">Histórico</label>
                <input
                  type="text"
                  value={editHistoricoDireto}
                  onChange={(e) => setEditHistoricoDireto(e.target.value)}
                  className={contabil ? 'w-full text-[11px] font-mono bg-brand-bg border border-brand-border px-2 py-1.5 outline-none' : 'w-full text-[11px] font-mono bg-white/5 border border-slate-600 px-2 py-1.5 outline-none text-white rounded'}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[9px] font-bold uppercase tracking-wider opacity-60">Conta débito</label>
                  <ExtratoContaPicker
                    ariaLabel="Conta débito - editar lançamento"
                    options={planoContaOptionsDirectEdit}
                    value={editContaDebDireto}
                    onChange={setEditContaDebDireto}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-bold uppercase tracking-wider opacity-60">Conta crédito</label>
                  <ExtratoContaPicker
                    ariaLabel="Conta crédito - editar lançamento"
                    options={planoContaOptionsDirectEdit}
                    value={editContaCredDireto}
                    onChange={setEditContaCredDireto}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-bold uppercase tracking-wider opacity-60">Valor</label>
                <input
                  type="text"
                  value={editValorDireto}
                  onChange={(e) => setEditValorDireto(e.target.value)}
                  placeholder="0,00"
                  className={contabil ? 'w-full text-[11px] font-mono bg-brand-bg border border-brand-border px-2 py-1.5 outline-none' : 'w-full text-[11px] font-mono bg-white/5 border border-slate-600 px-2 py-1.5 outline-none text-white rounded'}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-bold uppercase tracking-wider opacity-60">Ordem (para parear lançamentos complementares)</label>
                <input
                  type="number"
                  value={editOrdemDireto}
                  onChange={(e) => setEditOrdemDireto(e.target.value)}
                  placeholder="Número da ordem"
                  className={contabil ? 'w-full text-[11px] font-mono bg-brand-bg border border-brand-border px-2 py-1.5 outline-none' : 'w-full text-[11px] font-mono bg-white/5 border border-slate-600 px-2 py-1.5 outline-none text-white rounded'}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-brand-border">
              <button
                type="button"
                onClick={fecharEdicaoDireta}
                className={contabil ? 'technical-button-secondary px-4 py-2 text-[10px] font-bold uppercase' : 'px-4 py-2 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 text-[10px] font-bold uppercase'}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={salvarEdicaoDireta}
                className={contabil ? 'technical-button-primary px-4 py-2 text-[10px] font-bold uppercase' : 'px-4 py-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-[10px] font-bold uppercase'}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const BalanceteComparativoMensal = memo(ComparativoMensalInner);
