import { useMemo, useState, useCallback } from 'react';
import { X } from 'lucide-react';
import type { VisionBalanceteRow, VisionPlanoRow } from '../types/accounting';
import { parseBrDateToTime } from '../utils/dateBounds';
import { buildPlanoLookup, findPlanoRow } from '../utils/razaoContabil';
import { sanitizeCodigoReduzido } from '../../contabilfacil/logic/planoContasMapper';
import ExtratoContaPicker, { type ExtratoPlanoContaOption } from '../../contabilfacil/components/ExtratoContaPicker';

export type ExcluirMesesContasModalProps = {
  open: boolean;
  onClose: () => void;
  razaoRows: VisionBalanceteRow[];
  planoRows?: VisionPlanoRow[];
  onRazaoRowsChange: (rows: VisionBalanceteRow[]) => void;
  /** ContabilFacil: visual técnico do módulo gerencial. */
  contabil?: boolean;
};

/** Converte DD/MM/AAAA (razão) <-> AAAA-MM-DD (input type="date"). */
function brToDate(val: string): string {
  if (!val) return '';
  const partes = val.split('/');
  return partes.length === 3 ? `${partes[2]}-${partes[1]}-${partes[0]}` : val;
}

function dateToBr(val: string): string {
  if (!val) return '';
  const partes = val.split('-');
  return partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : val;
}

function dentroDoPeriodo(data: string | undefined, deTime: number, ateTime: number): boolean {
  if (!data) return false;
  const t = parseBrDateToTime(data);
  if (t === null) return false;
  // Inclui o dia inteiro de "ateTime" (até 23:59:59)
  const ateTimeFimDoDia = ateTime + (24 * 60 * 60 * 1000) - 1;
  return t >= deTime && t <= ateTimeFimDoDia;
}

export default function ExcluirMesesContasModal({
  open,
  onClose,
  razaoRows,
  planoRows,
  onRazaoRowsChange,
  contabil = false,
}: ExcluirMesesContasModalProps) {
  const [modo, setModo] = useState<'periodo' | 'contas' | 'automatizados'>('periodo');

  const planoLookup = useMemo(() => (planoRows ? buildPlanoLookup(planoRows) : undefined), [planoRows]);

  /** Mesmas opções (plano de contas completo) usadas no picker de conciliação/edição de lançamento. */
  const planoContaOptions: ExtratoPlanoContaOption[] = useMemo(
    () =>
      (planoRows ?? []).map((p) => ({
        code: p.codigo,
        name: p.nome,
        codigoReduzido: p.codigoReduzido,
        tipo: p.tipo,
        nivel: p.nivel,
      })),
    [planoRows],
  );

  /** Resolve o CÓDIGO REDUZIDO da conta de um lançamento — nunca a classificação. */
  const obterCodigoReduzido = useCallback(
    (r: VisionBalanceteRow): string => {
      if (planoRows && planoLookup) {
        const p = findPlanoRow(r, planoRows, planoLookup);
        const red = sanitizeCodigoReduzido(p?.codigoReduzido);
        if (red) return red;
      }
      // Fallback: o próprio código do lançamento, se já parecer um reduzido (sem pontos).
      const rawCode = (r.codigo ?? '').trim();
      if (rawCode && !rawCode.includes('.')) return sanitizeCodigoReduzido(rawCode) ?? rawCode.replace(/\D/g, '');
      return '';
    },
    [planoRows, planoLookup],
  );

  const [automatizadosDe, setAutomatizadosDe] = useState('');
  const [automatizadosAte, setAutomatizadosAte] = useState('');

  const [periodoDe, setPeriodoDe] = useState('');
  const [periodoAte, setPeriodoAte] = useState('');

  const [contaSelecionada, setContaSelecionada] = useState<string>('');
  const [contasDe, setContasDe] = useState('');
  const [contasAte, setContasAte] = useState('');

  const periodoValido = useMemo(() => {
    const de = parseBrDateToTime(periodoDe);
    const ate = parseBrDateToTime(periodoAte);
    if (de === null || ate === null || de > ate) return null;
    return { de, ate };
  }, [periodoDe, periodoAte]);

  const contasPeriodoValido = useMemo(() => {
    // Se ambos vazios: excluir todo o período
    if (!contasDe && !contasAte) return { de: 0, ate: Number.MAX_SAFE_INTEGER };
    // Se ambos preenchidos: validar se formam um intervalo válido
    if (contasDe && contasAte) {
      const de = parseBrDateToTime(contasDe);
      const ate = parseBrDateToTime(contasAte);
      if (de === null || ate === null || de > ate) return null;
      return { de, ate };
    }
    // Se apenas um preenchido: usar aquele e ignorar o outro
    if (contasDe) {
      const de = parseBrDateToTime(contasDe);
      if (de === null) return null;
      return { de, ate: Number.MAX_SAFE_INTEGER };
    }
    if (contasAte) {
      const ate = parseBrDateToTime(contasAte);
      if (ate === null) return null;
      return { de: 0, ate };
    }
    return null;
  }, [contasDe, contasAte]);

  const qtdAfetadaPeriodo = useMemo(() => {
    if (!periodoValido) return 0;
    return razaoRows.filter((r) => dentroDoPeriodo(r.data, periodoValido.de, periodoValido.ate)).length;
  }, [razaoRows, periodoValido]);

  const lancamentosAutomatizados = useMemo(
    () => razaoRows.filter((r) => r.isReconciliation),
    [razaoRows],
  );

  const automatizadosPeriodoValido = useMemo(() => {
    if (!automatizadosDe && !automatizadosAte) return { de: 0, ate: Number.MAX_SAFE_INTEGER };
    const de = parseBrDateToTime(automatizadosDe);
    const ate = parseBrDateToTime(automatizadosAte);
    if (de === null || ate === null || de > ate) return null;
    return { de, ate };
  }, [automatizadosDe, automatizadosAte]);

  const qtdAfetadaAutomatizados = useMemo(() => {
    if (!automatizadosPeriodoValido) return 0;
    return lancamentosAutomatizados.filter((r) =>
      dentroDoPeriodo(r.data, automatizadosPeriodoValido.de, automatizadosPeriodoValido.ate),
    ).length;
  }, [lancamentosAutomatizados, automatizadosPeriodoValido]);

  /** Lançamentos do razão cuja conta (código reduzido) é a selecionada. */
  const lancamentosDaContaSelecionada = useMemo(() => {
    if (!contaSelecionada) return [];
    return razaoRows.filter((r) => obterCodigoReduzido(r) === contaSelecionada);
  }, [razaoRows, contaSelecionada, obterCodigoReduzido]);

  /** Total de lançamentos na conta, independente do período escolhido. */
  const qtdTotalNaConta = lancamentosDaContaSelecionada.length;

  const qtdAfetadaContas = useMemo(() => {
    if (!contaSelecionada || !contasPeriodoValido) return 0;
    return lancamentosDaContaSelecionada.filter((r) =>
      dentroDoPeriodo(r.data, contasPeriodoValido.de, contasPeriodoValido.ate),
    ).length;
  }, [lancamentosDaContaSelecionada, contaSelecionada, contasPeriodoValido]);

  const nomeContaSelecionada = useMemo(() => {
    const opt = planoContaOptions.find((o) => sanitizeCodigoReduzido(o.codigoReduzido) === contaSelecionada);
    return opt?.name ?? '';
  }, [planoContaOptions, contaSelecionada]);

  if (!open) return null;

  const excluirPeriodo = () => {
    if (!periodoValido) return;
    if (
      !window.confirm(
        `Excluir PERMANENTEMENTE ${qtdAfetadaPeriodo} lançamento(s) de ${periodoDe} até ${periodoAte}? Essa ação não pode ser desfeita — será preciso reimportar o TXT desse período se precisar dele de volta.`,
      )
    ) {
      return;
    }
    const restantes = razaoRows.filter(
      (r) => !dentroDoPeriodo(r.data, periodoValido.de, periodoValido.ate),
    );
    onRazaoRowsChange(restantes);
    setPeriodoDe('');
    setPeriodoAte('');
  };

  const excluirContas = () => {
    if (!contasPeriodoValido || !contaSelecionada) return;
    const periodoTxt = contasDe && contasAte ? ` entre ${contasDe} e ${contasAte}` : ' (todo o período)';
    if (
      !window.confirm(
        `Excluir PERMANENTEMENTE ${qtdAfetadaContas} lançamento(s) da conta "${nomeContaSelecionada}"${periodoTxt}? Essa ação não pode ser desfeita.`,
      )
    ) {
      return;
    }
    const restantes = razaoRows.filter(
      (r) =>
        !(
          obterCodigoReduzido(r) === contaSelecionada &&
          dentroDoPeriodo(r.data, contasPeriodoValido.de, contasPeriodoValido.ate)
        ),
    );
    onRazaoRowsChange(restantes);
    setContaSelecionada('');
    setContasDe('');
    setContasAte('');
  };

  const excluirTodosAutomatizados = () => {
    if (lancamentosAutomatizados.length === 0) return;
    if (
      !window.confirm(
        `Excluir PERMANENTEMENTE TODOS os ${lancamentosAutomatizados.length} lançamento(s) automatizados (de qualquer aba)? Essa ação não pode ser desfeita.`,
      )
    ) {
      return;
    }
    const restantes = razaoRows.filter((r) => !r.isReconciliation);
    onRazaoRowsChange(restantes);
    setAutomatizadosDe('');
    setAutomatizadosAte('');
  };

  const excluirAutomatizadosPeriodo = () => {
    if (!automatizadosPeriodoValido || qtdAfetadaAutomatizados === 0) return;
    const periodoTxt =
      automatizadosDe && automatizadosAte ? ` entre ${automatizadosDe} e ${automatizadosAte}` : '';
    if (
      !window.confirm(
        `Excluir PERMANENTEMENTE ${qtdAfetadaAutomatizados} lançamento(s) automatizado(s)${periodoTxt}? Essa ação não pode ser desfeita.`,
      )
    ) {
      return;
    }
    const restantes = razaoRows.filter(
      (r) =>
        !(
          r.isReconciliation &&
          dentroDoPeriodo(r.data, automatizadosPeriodoValido.de, automatizadosPeriodoValido.ate)
        ),
    );
    onRazaoRowsChange(restantes);
    setAutomatizadosDe('');
    setAutomatizadosAte('');
  };

  const overlay = contabil
    ? 'fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-brand-text/40'
    : 'fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70';
  const panel = contabil
    ? 'technical-panel w-full max-w-xl max-h-[85vh] flex flex-col shadow-[6px_6px_0_0_#141414] bg-brand-bg'
    : 'w-full max-w-xl max-h-[85vh] flex flex-col rounded-xl border border-slate-700 bg-slate-950 shadow-2xl';
  const head = contabil
    ? 'flex items-start justify-between gap-3 p-4 border-b border-brand-border'
    : 'flex items-start justify-between gap-3 p-4 border-b border-slate-700';
  const tabBtn = (active: boolean) =>
    contabil
      ? `px-3 py-2 text-[10px] font-black uppercase tracking-widest border-b-2 ${
          active ? 'border-red-700 text-red-700' : 'border-transparent opacity-50'
        }`
      : `px-3 py-2 text-[10px] font-black uppercase tracking-widest border-b-2 ${
          active ? 'border-red-500 text-red-400' : 'border-transparent text-slate-500'
        }`;
  const dateInputCls =
    'w-full border border-brand-border bg-white px-2 py-1.5 text-[11px] font-mono';

  return (
    <div
      className={overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Excluir lançamentos do razão"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={panel} onClick={(e) => e.stopPropagation()}>
        <div className={head}>
          <div>
            <h2 className="text-sm font-black uppercase tracking-tight">Excluir lançamentos</h2>
            <p className="text-[9px] font-mono opacity-60 mt-1 max-w-md">
              Remove LANÇAMENTOS do razão permanentemente (a conta em si continua no plano de
              contas) — use quando um período foi importado errado/duplicado, ou para limpar os
              lançamentos de uma conta específica antes de reimportar.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={
              contabil
                ? 'p-1 border border-brand-border hover:bg-brand-border hover:text-brand-bg transition-colors shrink-0'
                : 'p-2 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 shrink-0'
            }
            aria-label="Fechar"
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        <div className={`flex ${contabil ? 'border-b border-brand-border' : 'border-b border-slate-700'}`}>
          <button type="button" className={tabBtn(modo === 'periodo')} onClick={() => setModo('periodo')}>
            Excluir período inteiro
          </button>
          <button type="button" className={tabBtn(modo === 'contas')} onClick={() => setModo('contas')}>
            Excluir lançamentos por conta
          </button>
          <button
            type="button"
            className={tabBtn(modo === 'automatizados')}
            onClick={() => setModo('automatizados')}
          >
            Lançamentos automatizados
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          {modo === 'periodo' ? (
            <>
              <p className="text-[9px] font-bold uppercase opacity-60">
                Informe o período (data inicial e final) a excluir de vez do razão
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="text-[9px] font-bold uppercase opacity-60 mb-1 block">De</label>
                  <input
                    type="date"
                    value={brToDate(periodoDe)}
                    onChange={(e) => setPeriodoDe(dateToBr(e.target.value))}
                    className={dateInputCls}
                  />
                </div>
                <div>
                  <label className="text-[9px] font-bold uppercase opacity-60 mb-1 block">Até</label>
                  <input
                    type="date"
                    value={brToDate(periodoAte)}
                    onChange={(e) => setPeriodoAte(dateToBr(e.target.value))}
                    className={dateInputCls}
                  />
                </div>
              </div>
              {periodoDe && periodoAte && !periodoValido ? (
                <p className="text-[10px] text-red-700 font-bold">
                  Data "De" não pode ser depois da data "Até".
                </p>
              ) : null}
              {periodoValido ? (
                <p className="text-[10px] font-mono opacity-70">
                  {qtdAfetadaPeriodo} lançamento(s) serão excluídos nesse período.
                </p>
              ) : null}
              <button
                type="button"
                disabled={!periodoValido || qtdAfetadaPeriodo === 0}
                onClick={excluirPeriodo}
                className="technical-button px-4 py-2 text-[10px] font-black uppercase border-red-800 text-red-800 disabled:opacity-40"
              >
                Excluir {qtdAfetadaPeriodo > 0 ? `${qtdAfetadaPeriodo} lançamento(s)` : 'período'}
              </button>
            </>
          ) : modo === 'contas' ? (
            <>
              <p className="text-[9px] font-bold uppercase opacity-60">
                1. Escolha a conta
              </p>
              <ExtratoContaPicker
                value={contaSelecionada}
                options={planoContaOptions}
                includeSinteticas
                onChange={setContaSelecionada}
                placeholder="Buscar conta por código reduzido ou nome…"
                ariaLabel="Conta a excluir"
              />
              {contaSelecionada ? (
                <p className="text-[10px] font-mono opacity-70">
                  <strong>{qtdTotalNaConta}</strong> lançamento(s) no total em <strong>{nomeContaSelecionada}</strong>.
                </p>
              ) : null}

              {contaSelecionada ? (
                <>
                  <p className="text-[9px] font-bold uppercase opacity-60 pt-2">
                    2. Escolha o período a excluir
                  </p>
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label className="text-[9px] font-bold uppercase opacity-60 mb-1 block">De</label>
                      <input
                        type="date"
                        value={brToDate(contasDe)}
                        onChange={(e) => setContasDe(dateToBr(e.target.value))}
                        className={dateInputCls}
                      />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold uppercase opacity-60 mb-1 block">Até</label>
                      <input
                        type="date"
                        value={brToDate(contasAte)}
                        onChange={(e) => setContasAte(dateToBr(e.target.value))}
                        className={dateInputCls}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setContasDe('');
                        setContasAte('');
                      }}
                      className="text-[9px] font-bold uppercase px-3 py-1.5 rounded border border-brand-border text-brand-text hover:bg-brand-border hover:text-white transition-colors"
                      title="Limpar datas para excluir TODOS os lançamentos da conta"
                    >
                      Limpar
                    </button>
                  </div>
                  {contasDe && contasAte && !contasPeriodoValido ? (
                    <p className="text-[10px] text-red-700 font-bold">
                      Data "De" não pode ser depois da data "Até".
                    </p>
                  ) : null}
                  {contasPeriodoValido ? (
                    <p className="text-[10px] font-mono opacity-70">
                      {qtdAfetadaContas} lançamento(s) de <strong>{nomeContaSelecionada}</strong>
                      {contasDe && contasAte ? ` entre ${contasDe} e ${contasAte}` : ' (TODOS os períodos)'}
                      {' '}serão excluídos.
                    </p>
                  ) : null}
                </>
              ) : null}

              <button
                type="button"
                disabled={!contaSelecionada || !contasPeriodoValido || qtdAfetadaContas === 0}
                onClick={excluirContas}
                className="technical-button px-4 py-2 text-[10px] font-black uppercase border-red-800 text-red-800 disabled:opacity-40"
              >
                Excluir {qtdAfetadaContas > 0 ? `${qtdAfetadaContas} lançamento(s)` : 'lançamentos da conta'}
              </button>
            </>
          ) : (
            <>
              <p className="text-[9px] font-bold uppercase opacity-60">
                Lançamentos gravados automaticamente no razão — por qualquer aba (Automação, Zeramento,
                Transferência de lançamentos, Empréstimo, manual).
              </p>
              <p className="text-[10px] font-mono opacity-70">
                {lancamentosAutomatizados.length} lançamento(s) automatizado(s) no total.
              </p>
              <button
                type="button"
                disabled={lancamentosAutomatizados.length === 0}
                onClick={excluirTodosAutomatizados}
                className="technical-button px-4 py-2 text-[10px] font-black uppercase border-red-800 text-red-800 disabled:opacity-40"
              >
                Excluir TODOS ({lancamentosAutomatizados.length})
              </button>

              <p className="text-[9px] font-bold uppercase opacity-60 pt-3 border-t border-brand-border/20">
                Ou exclua só um mês/período específico (deixe em branco para excluir todos)
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="text-[9px] font-bold uppercase opacity-60 mb-1 block">De</label>
                  <input
                    type="date"
                    value={brToDate(automatizadosDe)}
                    onChange={(e) => setAutomatizadosDe(dateToBr(e.target.value))}
                    className={dateInputCls}
                  />
                </div>
                <div>
                  <label className="text-[9px] font-bold uppercase opacity-60 mb-1 block">Até</label>
                  <input
                    type="date"
                    value={brToDate(automatizadosAte)}
                    onChange={(e) => setAutomatizadosAte(dateToBr(e.target.value))}
                    className={dateInputCls}
                  />
                </div>
              </div>
              {automatizadosDe && automatizadosAte && !automatizadosPeriodoValido ? (
                <p className="text-[10px] text-red-700 font-bold">
                  Data "De" não pode ser depois da data "Até".
                </p>
              ) : null}
              {automatizadosPeriodoValido ? (
                <p className="text-[10px] font-mono opacity-70">
                  {qtdAfetadaAutomatizados} lançamento(s) automatizado(s) serão excluídos
                  {automatizadosDe && automatizadosAte ? ` entre ${automatizadosDe} e ${automatizadosAte}` : ''}.
                </p>
              ) : null}
              <button
                type="button"
                disabled={!automatizadosPeriodoValido || qtdAfetadaAutomatizados === 0}
                onClick={excluirAutomatizadosPeriodo}
                className="technical-button px-4 py-2 text-[10px] font-black uppercase border-red-800 text-red-800 disabled:opacity-40"
              >
                Excluir {qtdAfetadaAutomatizados > 0 ? `${qtdAfetadaAutomatizados} lançamento(s)` : 'do período'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
