import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Info, Plus, Trash2, X } from 'lucide-react';
import type { VisionBalanceteRow, VisionPlanoRow } from '../types/accounting';
import {
  PAPEIS_AUTOMACAO_UI,
  type AutomacaoContaConfig,
  type AutomacaoContaPapel,
  type AutomacaoContaPapelConfig,
  type AutomacaoContaVinculo,
  type AutomacaoEmprestimoColigada,
  isAnoNoPeriodoFechado,
  isDataNoPeriodoFechado,
  isValidBrDate,
  parseBrDateToIso,
  newEmprestimoColigadaId,
  papelConfigurado,
  readAutomatizacaoContaConfig,
  saveAutomatizacaoContaConfig,
  savePapelAutomatizacaoContaConfig,
  vinculoFromCodigoManual,
} from '../utils/automatizacaoContaConfig';
import {
  belongsToCompany,
  loadCompaniesRegistry,
  normalizeCompanyName,
} from '../../contabilfacil/logic/companyWorkspace';
import { loadContractsFromBrowserStorage } from '../../lib/savedContractStorage';
import { listAiColigadasParaIa } from '../../contabilfacil/logic/aiInteligenciaStorage';
import ExtratoContaPicker, { type ExtratoPlanoContaOption } from '../../contabilfacil/components/ExtratoContaPicker';
import LancamentoEmprestimoEditor from './LancamentoEmprestimoEditor';

type Surface = 'vision' | 'contabilfacil';

function buildPlanoOptions(planoRows: VisionPlanoRow[]): ExtratoPlanoContaOption[] {
  return planoRows.map((p) => ({
    code: p.codigo,
    name: p.nome,
    codigoReduzido: p.codigoReduzido,
    tipo: p.tipo,
    nivel: p.nivel,
  }));
}

function aplicarVinculoManual(
  codigo: string,
  planoRows: VisionPlanoRow[],
  aplicar: (v: AutomacaoContaVinculo | undefined) => void,
): string | null {
  const t = codigo.trim();
  if (!t) {
    aplicar(undefined);
    return null;
  }
  const res = vinculoFromCodigoManual(t, planoRows);
  if ('erro' in res) return res.erro;
  aplicar(res.vinculo);
  return null;
}

type Props = {
  open: boolean;
  onClose: () => void;
  planoRows: VisionPlanoRow[];
  /** Razão completo — usado para achar dias invertidos no zeramento e compensação. */
  razaoRows?: VisionBalanceteRow[];
  empresaNome: string;
  onSaved?: (config: AutomacaoContaConfig) => void;
  /** Chamado quando o zeramento/compensação gera lançamentos e os adiciona ao razão. */
  onRazaoRowsChange?: (rows: VisionBalanceteRow[]) => void;
  surface?: Surface;
  abrirSubOverlay?: 'custo' | 'coligadas' | 'emprestimo' | 'zeramento' | 'compensacao_banco' | null;
  /** Período confirmado no balancete (De/Até) — usado para limitar os períodos da compensação. */
  periodoDe?: string;
  periodoAte?: string;
};

function VinculoLadoField({
  lado,
  tituloLado,
  hintLado,
  vinculo,
  planoOptions,
  onApplyCodigo,
  onClear,
  contabil,
}: {
  lado: 'debito' | 'credito';
  tituloLado: string;
  hintLado: string;
  vinculo?: AutomacaoContaVinculo;
  planoOptions: ExtratoPlanoContaOption[];
  onApplyCodigo: (codigo: string, lado: 'debito' | 'credito') => string | null;
  onClear: (lado: 'debito' | 'credito') => void;
  contabil: boolean;
}) {
  const ladoBadgeClass =
    lado === 'debito'
      ? contabil
        ? 'bg-red-800 text-white'
        : 'bg-red-600/80 text-white'
      : contabil
        ? 'bg-emerald-800 text-white'
        : 'bg-emerald-600/80 text-white';

  const btnSecondary = contabil
    ? 'technical-button text-[10px] py-1 px-2'
    : 'px-2 py-1 rounded-lg border border-slate-600 text-slate-400 text-[10px] uppercase';

  return (
    <div
      className={
        contabil
          ? 'border border-brand-border/40 bg-white p-3 space-y-2'
          : 'rounded-lg border border-slate-700/80 bg-slate-950/40 p-2.5 space-y-2'
      }
    >
      <div className="flex items-start gap-2">
        <span className={`shrink-0 px-1.5 py-0.5 text-[9px] font-black uppercase ${ladoBadgeClass}`}>
          {tituloLado}
        </span>
        <p className={contabil ? 'text-[9px] font-bold uppercase opacity-50 leading-snug flex-1' : 'text-[10px] text-slate-500 leading-snug flex-1'}>
          {hintLado}
        </p>
      </div>
      <div className="space-y-1">
        <label className={contabil ? 'block text-[9px] font-bold uppercase opacity-50' : 'sr-only'}>
          Código {tituloLado}
        </label>
        <ExtratoContaPicker
          value={vinculo?.codigo ?? ''}
          options={planoOptions}
          includeSinteticas
          showNomeInline
          placeholder="Selecione a conta..."
          ariaLabel={`Código reduzido ${tituloLado}`}
          onChange={(code) => onApplyCodigo(code, lado)}
          bgWhite
        />
      </div>
      {vinculo && (
        <button type="button" onClick={() => onClear(lado)} className={btnSecondary}>
          Limpar
        </button>
      )}
    </div>
  );
}

function ContaUnicaField({
  titulo,
  hint,
  vinculo,
  planoOptions,
  onApplyCodigo,
  onClear,
  contabil,
}: {
  titulo: string;
  hint: string;
  vinculo?: AutomacaoContaVinculo;
  planoOptions: ExtratoPlanoContaOption[];
  onApplyCodigo: (codigo: string) => string | null;
  onClear: () => void;
  contabil: boolean;
}) {
  const btnSecondary = contabil
    ? 'technical-button text-[10px] py-1 px-2'
    : 'px-2 py-1 rounded-lg border border-slate-600 text-slate-400 text-[10px] uppercase';

  return (
    <div
      className={
        contabil
          ? 'border border-brand-border/40 bg-white p-3 space-y-2'
          : 'rounded-lg border border-slate-700/80 bg-slate-950/40 p-2.5 space-y-2'
      }
    >
      <div>
        <p className={contabil ? 'text-[9px] font-black uppercase' : 'text-[10px] font-bold text-violet-200'}>
          {titulo}
        </p>
        <p className={contabil ? 'text-[9px] font-bold uppercase opacity-50 leading-snug' : 'text-[10px] text-slate-500 leading-snug'}>
          {hint}
        </p>
      </div>
      <ExtratoContaPicker
        value={vinculo?.codigo ?? ''}
        options={planoOptions}
        includeSinteticas
        showNomeInline
        placeholder="Selecione a conta..."
        ariaLabel={titulo}
        onChange={(code) => onApplyCodigo(code)}
        bgWhite
      />
      {vinculo && (
        <button type="button" onClick={onClear} className={btnSecondary}>
          Limpar
        </button>
      )}
    </div>
  );
}

function PapelEditor({
  papel,
  titulo,
  hint,
  debHint,
  credHint,
  info,
  config,
  planoRows,
  onChange,
  contabil,
}: {
  papel: AutomacaoContaPapel;
  titulo: string;
  hint: string;
  debHint: string;
  credHint: string;
  info: string;
  config?: AutomacaoContaPapelConfig;
  planoRows: VisionPlanoRow[];
  onChange: (p: AutomacaoContaPapel, cfg: AutomacaoContaPapelConfig | undefined) => void;
  contabil: boolean;
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [pctDraft, setPctDraft] = useState(() =>
    config?.porcentagemCusto != null ? String(config.porcentagemCusto) : '',
  );

  React.useEffect(() => {
    setPctDraft(config?.porcentagemCusto != null ? String(config.porcentagemCusto) : '');
  }, [config?.porcentagemCusto]);

  const planoOptions = useMemo(() => buildPlanoOptions(planoRows), [planoRows]);

  const sectionClass = contabil
    ? 'technical-panel p-4 bg-brand-sidebar/15 space-y-3'
    : 'rounded-lg border border-slate-700 bg-slate-950/60 p-3 space-y-2';

  const labelTitle = contabil
    ? 'text-[10px] font-black uppercase tracking-widest text-brand-text'
    : 'text-[11px] font-bold text-violet-200';

  const labelHint = contabil
    ? 'text-[9px] font-bold uppercase opacity-50 leading-snug'
    : 'text-[10px] text-slate-500 leading-snug';

  const inputClass = contabil
    ? 'w-full px-2 py-1.5 bg-white border border-brand-border text-xs font-mono font-bold focus:outline-none focus:ring-1 focus:ring-brand-border'
    : 'w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-xs';

  const patch = (patchCfg: Partial<AutomacaoContaPapelConfig>) => {
    const next: AutomacaoContaPapelConfig = {
      ...config,
      ...patchCfg,
    };
    delete next.classificacao;
    delete next.codigo;
    delete next.nome;
    if (!next.debito?.classificacao && !next.credito?.classificacao) {
      onChange(papel, undefined);
      return;
    }
    onChange(papel, next);
  };

  const setLado = (lado: 'debito' | 'credito', v: AutomacaoContaVinculo | undefined) => {
    if (!v) {
      const next = { ...config };
      if (lado === 'debito') delete next.debito;
      else delete next.credito;
      patch(next);
      return;
    }
    patch(lado === 'debito' ? { debito: v } : { credito: v });
  };

  const aplicarPorcentagem = () => {
    const raw = pctDraft.trim().replace(',', '.');
    const next: AutomacaoContaPapelConfig = { ...(config ?? {}) };
    if (!raw) {
      delete next.porcentagemCusto;
    } else {
      const n = parseFloat(raw);
      if (!Number.isFinite(n) || n <= 0) return;
      next.porcentagemCusto = Math.min(100, n);
    }
    delete next.classificacao;
    delete next.codigo;
    delete next.nome;
    if (
      !next.debito?.classificacao &&
      !next.credito?.classificacao &&
      !next.porcentagemCusto &&
      !next.contaFaturamento
    ) {
      onChange(papel, undefined);
      return;
    }
    onChange(papel, next);
  };

  const setFaturamento = (v: AutomacaoContaVinculo | undefined) => {
    const next: AutomacaoContaPapelConfig = { ...(config ?? {}) };
    if (!v) delete next.contaFaturamento;
    else next.contaFaturamento = v;
    delete next.classificacao;
    delete next.codigo;
    delete next.nome;
    if (
      !next.debito?.classificacao &&
      !next.credito?.classificacao &&
      !next.porcentagemCusto &&
      !next.contaFaturamento
    ) {
      onChange(papel, undefined);
      return;
    }
    onChange(papel, next);
  };

  return (
    <div className={sectionClass}>
      <div>
        <div className="flex items-center gap-2">
          <p className={labelTitle}>{titulo}</p>
          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            className={
              contabil
                ? 'h-6 w-6 border border-brand-border flex items-center justify-center hover:bg-brand-sidebar/20'
                : 'h-6 w-6 rounded border border-slate-600 flex items-center justify-center hover:bg-slate-800'
            }
            title="Como a automação usa este bloco"
            aria-label={`Informações de ${titulo}`}
          >
            <Info size={12} />
          </button>
        </div>
        <p className={labelHint}>{hint}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <VinculoLadoField
          lado="debito"
          tituloLado="Débito"
          hintLado={debHint}
          vinculo={config?.debito}
          planoOptions={planoOptions}
          onApplyCodigo={(cod, lado) => aplicarVinculoManual(cod, planoRows, (v) => setLado(lado, v))}
          onClear={(lado) => setLado(lado, undefined)}
          contabil={contabil}
        />
        <VinculoLadoField
          lado="credito"
          tituloLado="Crédito"
          hintLado={credHint}
          vinculo={config?.credito}
          planoOptions={planoOptions}
          onApplyCodigo={(cod, lado) => aplicarVinculoManual(cod, planoRows, (v) => setLado(lado, v))}
          onClear={(lado) => setLado(lado, undefined)}
          contabil={contabil}
        />
      </div>

      {papel.startsWith('custo') && (
        <div
          className={
            contabil
              ? 'space-y-3 pt-1 border-t border-brand-border/20'
              : 'space-y-3 pt-1 border-t border-slate-700/50'
          }
        >
          <p className={labelHint}>
            Cálculo automático: custo = faturamento do mês × porcentagem (não é o saldo acumulado). Informe D, C, %
            e conta de faturamento.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div
              className={
                contabil
                  ? 'border border-brand-border/40 bg-white p-3 space-y-2'
                  : 'rounded-lg border border-slate-700/80 bg-slate-950/40 p-2.5 space-y-2'
              }
            >
              <label className={contabil ? 'block text-[9px] font-bold uppercase opacity-50' : 'text-[10px] text-slate-400'}>
                Porcentagem do custo (%)
              </label>
              <div className="flex flex-wrap gap-2 items-end">
                <input
                  type="text"
                  inputMode="decimal"
                  value={pctDraft}
                  onChange={(e) => setPctDraft(e.target.value)}
                  onBlur={aplicarPorcentagem}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      aplicarPorcentagem();
                    }
                  }}
                  placeholder="Ex.: 65"
                  className={inputClass}
                  aria-label="Porcentagem do custo"
                />
              </div>
              {config?.porcentagemCusto != null && config.porcentagemCusto > 0 && (
                <p className="text-[10px] font-mono text-green-800">{config.porcentagemCusto}% salvo</p>
              )}
            </div>
            <ContaUnicaField
              titulo="Conta de faturamento"
              hint="Receita usada como base (créditos − débitos do mês)"
              vinculo={config?.contaFaturamento}
              planoOptions={planoOptions}
              onApplyCodigo={(cod) => aplicarVinculoManual(cod, planoRows, setFaturamento)}
              onClear={() => setFaturamento(undefined)}
              contabil={contabil}
            />
          </div>
        </div>
      )}

      {infoOpen && (
        <div
          className={
            contabil
              ? 'fixed inset-0 z-[220] flex items-center justify-center p-4 bg-brand-text/40'
              : 'fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/70'
          }
          onClick={() => setInfoOpen(false)}
        >
          <div
            className={
              contabil
                ? 'w-full max-w-xl technical-panel shadow-[8px_8px_0_0_#141414] bg-brand-bg'
                : 'w-full max-w-xl rounded-xl border border-slate-700 bg-slate-900'
            }
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={
                contabil
                  ? 'px-4 py-3 border-b border-brand-border flex items-start justify-between gap-2 bg-brand-sidebar/30'
                  : 'px-4 py-3 border-b border-slate-700 flex items-start justify-between gap-2'
              }
            >
              <h3 className={contabil ? 'text-[10px] font-black uppercase tracking-widest' : 'text-sm font-bold'}>
                {titulo} — como a automação usa
              </h3>
              <button
                type="button"
                onClick={() => setInfoOpen(false)}
                className={
                  contabil
                    ? 'p-1 border border-brand-border hover:bg-brand-border hover:text-brand-bg'
                    : 'px-2 text-slate-400 hover:text-white'
                }
                aria-label="Fechar explicação"
              >
                {contabil ? <X size={14} /> : '×'}
              </button>
            </div>
            <div className={contabil ? 'p-4 space-y-2' : 'p-4 space-y-2 text-slate-200'}>
              {info.split('\n').map((line, i) => {
                const t = line.trim();
                if (!t) return <div key={i} className="h-2" />;
                if (t.endsWith(':')) {
                  return (
                    <p key={i} className={contabil ? 'text-[10px] font-black uppercase tracking-wide' : 'text-xs font-bold uppercase'}>
                      {t}
                    </p>
                  );
                }
                if (t.startsWith('• ')) {
                  return (
                    <p key={i} className={contabil ? 'text-[10px] pl-3 border-l-2 border-brand-border/30' : 'text-xs pl-3 border-l-2 border-slate-600'}>
                      {t.slice(2)}
                    </p>
                  );
                }
                return <p key={i} className={contabil ? 'text-[10px]' : 'text-xs'}>{t}</p>;
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ColigadaEmprestimoEditor({
  item,
  empresas,
  planoRows,
  contabil,
  onChange,
  onRemove,
}: {
  item: AutomacaoEmprestimoColigada;
  empresas: string[];
  planoRows: VisionPlanoRow[];
  contabil: boolean;
  onChange: (patch: Partial<AutomacaoEmprestimoColigada>) => void;
  onRemove: () => void;
}) {
  const planoOptions = useMemo(() => buildPlanoOptions(planoRows), [planoRows]);

  const boxClass = contabil
    ? 'border border-brand-border/40 bg-white p-3 space-y-2'
    : 'rounded-lg border border-slate-700/80 bg-slate-950/40 p-2.5 space-y-2';

  const inputClass = contabil
    ? 'w-full px-2 py-1.5 bg-white border border-brand-border text-xs font-mono font-bold focus:outline-none focus:ring-1 focus:ring-brand-border'
    : 'w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-xs';

  const setLado = (lado: 'debito' | 'credito', v: AutomacaoContaVinculo | undefined) => {
    if (!v) {
      const next = { ...item };
      if (lado === 'debito') delete next.debito;
      else delete next.credito;
      onChange(next);
      return;
    }
    onChange(lado === 'debito' ? { debito: v } : { credito: v });
  };

  return (
    <div className={boxClass}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[180px]">
          <label className={contabil ? 'block text-[9px] font-bold uppercase opacity-50 mb-1' : 'sr-only'}>
            Empresa coligada
          </label>
          <select
            value={item.empresaColigada}
            onChange={(e) => onChange({ empresaColigada: e.target.value })}
            className={inputClass}
            aria-label="Empresa coligada"
          >
            <option value="">Selecione a empresa…</option>
            {empresas.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
            {item.empresaColigada && !empresas.includes(item.empresaColigada) ? (
              <option value={item.empresaColigada}>{item.empresaColigada}</option>
            ) : null}
          </select>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className={
            contabil
              ? 'technical-button text-[10px] p-1.5 text-rose-700'
              : 'p-1.5 rounded border border-slate-600 text-rose-400'
          }
          title="Remover vínculo"
          aria-label="Remover empréstimo coligada"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <VinculoLadoField
          lado="debito"
          tituloLado="Débito"
          hintLado="D — conta na empresa atual (ex.: mútuo a receber / coligada)"
          vinculo={item.debito}
          planoOptions={planoOptions}
          onApplyCodigo={(cod, lado) => aplicarVinculoManual(cod, planoRows, (v) => setLado(lado, v))}
          onClear={(lado) => setLado(lado, undefined)}
          contabil={contabil}
        />
        <VinculoLadoField
          lado="credito"
          tituloLado="Crédito"
          hintLado="C — contrapartida (ex.: banco / caixa / mútuo a pagar)"
          vinculo={item.credito}
          planoOptions={planoOptions}
          onApplyCodigo={(cod, lado) => aplicarVinculoManual(cod, planoRows, (v) => setLado(lado, v))}
          onClear={(lado) => setLado(lado, undefined)}
          contabil={contabil}
        />
      </div>
    </div>
  );
}

function formatBrDateMask(val: string): string {
  const clean = val.replace(/\D/g, '').slice(0, 8);
  if (clean.length >= 5) {
    return `${clean.slice(0, 2)}/${clean.slice(2, 4)}/${clean.slice(4)}`;
  }
  if (clean.length >= 3) {
    return `${clean.slice(0, 2)}/${clean.slice(2)}`;
  }
  return clean;
}

function SubOverlay({
  title,
  onClose,
  contabil,
  children,
  widthClass,
}: {
  title: string;
  onClose: () => void;
  contabil: boolean;
  children: React.ReactNode;
  widthClass?: string;
}) {
  // z-[205]: acima do modal base (z-200), mas abaixo do painel de busca do
  // ExtratoContaPicker (portal em document.body, z-[220]) — senão o dropdown
  // de contas abre escondido atrás deste overlay e parece "não funcionar".
  const overlayClass = contabil
    ? 'fixed inset-0 z-[205] flex items-center justify-center p-4 bg-brand-text/50'
    : 'fixed inset-0 z-[205] flex items-center justify-center p-4 bg-black/80';
  const shellClass = contabil
    ? `w-full ${widthClass ?? 'max-w-2xl'} max-h-[88vh] overflow-hidden flex flex-col technical-panel shadow-[8px_8px_0_0_#141414] bg-brand-bg`
    : `w-full ${widthClass ?? 'max-w-lg'} max-h-[88vh] overflow-hidden flex flex-col rounded-2xl border border-violet-500/40 bg-slate-900 shadow-2xl`;
  const headerClass = contabil
    ? 'px-4 py-3 border-b border-brand-border flex items-center justify-between gap-2 bg-brand-sidebar/40 shrink-0'
    : 'px-4 py-3 border-b border-slate-700 flex items-center justify-between gap-2 shrink-0';
  return (
    <div
      className={overlayClass}
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={shellClass} onClick={(e) => e.stopPropagation()}>
        <div className={headerClass}>
          <h3
            className={
              contabil
                ? 'text-[10px] font-black uppercase tracking-widest'
                : 'text-sm font-black text-violet-200 uppercase tracking-wide'
            }
          >
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className={
              contabil
                ? 'p-1 border border-brand-border hover:bg-brand-border hover:text-brand-bg transition-colors'
                : 'text-slate-400 hover:text-white text-lg leading-none px-2'
            }
            aria-label="Fechar"
          >
            {contabil ? <X size={16} strokeWidth={2.5} /> : '×'}
          </button>
        </div>
        <div className={contabil ? 'flex-1 overflow-y-auto p-4 bg-brand-bg' : 'flex-1 overflow-y-auto custom-scrollbar p-4'}>
          {children}
        </div>
      </div>
    </div>
  );
}

function PapelResumoRow({
  titulo,
  hint,
  configurado,
  onAbrir,
  contabil,
  pillTrueLabel = 'Configurado',
  pillFalseLabel = 'Não configurado',
  buttonLabel = 'Configurar',
}: {
  titulo: string;
  hint: string;
  configurado: boolean;
  onAbrir: () => void;
  contabil: boolean;
  pillTrueLabel?: string;
  pillFalseLabel?: string;
  buttonLabel?: string;
}) {
  const sectionClass = contabil
    ? 'technical-panel p-3 bg-brand-sidebar/15 flex items-center justify-between gap-3'
    : 'rounded-lg border border-slate-700 bg-slate-950/60 p-3 flex items-center justify-between gap-3';
  const labelTitle = contabil
    ? 'text-[10px] font-black uppercase tracking-widest text-brand-text'
    : 'text-[11px] font-bold text-violet-200';
  const labelHint = contabil
    ? 'text-[9px] font-bold uppercase opacity-50 leading-snug'
    : 'text-[10px] text-slate-500 leading-snug';
  const pillClass = configurado
    ? contabil
      ? 'text-[8px] font-black uppercase text-green-800 bg-green-50 border border-green-800/30 px-1.5 py-0.5 shrink-0'
      : 'text-[8px] font-black uppercase text-emerald-300 bg-emerald-950/50 border border-emerald-700 px-1.5 py-0.5 shrink-0'
    : contabil
      ? 'text-[8px] font-black uppercase opacity-40 border border-brand-border/30 px-1.5 py-0.5 shrink-0'
      : 'text-[8px] font-black uppercase text-slate-500 border border-slate-700 px-1.5 py-0.5 shrink-0';
  return (
    <div className={sectionClass}>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className={labelTitle}>{titulo}</p>
          <span className={pillClass}>{configurado ? pillTrueLabel : pillFalseLabel}</span>
        </div>
        <p className={`${labelHint} truncate`}>{hint}</p>
      </div>
      <button
        type="button"
        onClick={onAbrir}
        className={
          contabil
            ? 'technical-button-primary text-[10px] px-4 py-1.5 shrink-0'
            : 'px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-black uppercase shrink-0'
        }
      >
        {buttonLabel}
      </button>
    </div>
  );
}

// ─── Zeramento das Contas de Resultado ────────────────────────────────────────

function gerarLancamentosZeramento(params: {
  razaoRows: VisionBalanceteRow[];
  planoRows: VisionPlanoRow[];
  dataZeramento: string;
  contaResultadoReduzido: string;
}): { lancamentos: VisionBalanceteRow[]; resumo: string[]; erros: string[] } {
  const { razaoRows, planoRows, dataZeramento, contaResultadoReduzido } = params;

  const redNorm = (s: string) => s.replace(/\D/g, '').replace(/^0+/, '') || '0';
  const clsNorm = (s: string) => s.replace(/\./g, '').trim();

  // Find the "Resultado do Exercício" account in plano
  const contaResultado = planoRows.find(
    (p) => p.codigoReduzido && redNorm(p.codigoReduzido) === redNorm(contaResultadoReduzido),
  );
  if (!contaResultado) {
    return { lancamentos: [], resumo: [], erros: [`Conta resultado não encontrada: ${contaResultadoReduzido}`] };
  }
  const resultadoClassificacao = contaResultado.codigo;
  // resultadoNome intentionally unused (only resultadoClassificacao needed for matching)
  void contaResultado.nome;

  // Aggregate saldo by analytic account from razaoRows
  const saldoMap = new Map<string, { classificacao: string; nome: string; codigoReduzido: string; saldo: number }>();
  for (const r of razaoRows) {
    const cls = (r.classificacao || r.codigo || '').trim();
    if (!cls) continue;
    const planoRow = planoRows.find(
      (p) =>
        clsNorm(p.codigo) === clsNorm(cls) ||
        (p.codigoReduzido && redNorm(p.codigoReduzido) === redNorm(r.codigo || '')),
    );
    if (!planoRow) continue;
    if (planoRow.tipo === 'S') continue; // skip synthetic

    const root = clsNorm(planoRow.codigo)[0] ?? '';
    const isReceita = root === '3';
    const isDespesa = /^[4567]/.test(root);
    if (!isReceita && !isDespesa) continue;
    // Skip the resultado account itself
    if (clsNorm(planoRow.codigo) === clsNorm(resultadoClassificacao)) continue;

    const key = clsNorm(planoRow.codigo);
    const cur = saldoMap.get(key);
    if (cur) {
      cur.saldo += (r.debito ?? 0) - (r.credito ?? 0);
    } else {
      saldoMap.set(key, {
        classificacao: planoRow.codigo,
        nome: planoRow.nome,
        codigoReduzido: planoRow.codigoReduzido ?? '',
        saldo: (r.debito ?? 0) - (r.credito ?? 0),
      });
    }
  }

  const lancamentos: VisionBalanceteRow[] = [];
  const resumo: string[] = [];
  let totalResultado = 0;

  for (const { classificacao, nome, saldo } of saldoMap.values()) {
    if (Math.abs(saldo) < 0.005) continue;

    const root = clsNorm(classificacao)[0] ?? '';
    // Receitas: saldo credor (negative in signed D-C) → debit them to zero → D receita / C resultado
    // Despesas: saldo devedor (positive in signed D-C) → credit them to zero → D resultado / C despesa
    // saldo = D - C; receitas accumulated negatively (more C), despesas positively (more D)

    if (root === '3') {
      // Receita: normal saldo is credora (C), so accumulated = negative (more C than D)
      // To zero: D the receita account, C the resultado
      const valorAbsoluto = Math.abs(saldo);
      lancamentos.push({
        codigo: saldo > 0 ? contaResultadoReduzido : (planoRows.find(p => clsNorm(p.codigo) === clsNorm(classificacao))?.codigoReduzido ?? ''),
        classificacao,
        nome,
        data: dataZeramento,
        debito: valorAbsoluto,
        credito: 0,
        saldoInicial: 0,
        saldoFinal: 0,
        contaDeb: planoRows.find(p => clsNorm(p.codigo) === clsNorm(classificacao))?.codigoReduzido ?? '',
        contaCred: contaResultadoReduzido,
        isReconciliation: true,
        importId: `zeramento-${dataZeramento}`,
      });
      totalResultado -= valorAbsoluto; // C resultado
      resumo.push(`D ${classificacao} ${nome} / C Resultado · R$ ${valorAbsoluto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
    } else {
      // Despesa: normal saldo is devedora (D), accumulated = positive
      const valorAbsoluto = Math.abs(saldo);
      lancamentos.push({
        codigo: planoRows.find(p => clsNorm(p.codigo) === clsNorm(classificacao))?.codigoReduzido ?? '',
        classificacao,
        nome,
        data: dataZeramento,
        debito: 0,
        credito: valorAbsoluto,
        saldoInicial: 0,
        saldoFinal: 0,
        contaDeb: contaResultadoReduzido,
        contaCred: planoRows.find(p => clsNorm(p.codigo) === clsNorm(classificacao))?.codigoReduzido ?? '',
        isReconciliation: true,
        importId: `zeramento-${dataZeramento}`,
      });
      totalResultado += valorAbsoluto; // D resultado
      resumo.push(`D Resultado / C ${classificacao} ${nome} · R$ ${valorAbsoluto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
    }
  }

  // The final "Resultado do Exercício" balancing entry
  if (Math.abs(totalResultado) > 0.005) {
    const natureza = totalResultado > 0 ? 'Lucro (C Resultado)' : 'Prejuízo (D Resultado)';
    resumo.unshift(`Resultado apurado: R$ ${Math.abs(totalResultado).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} — ${natureza}`);
  }

  if (lancamentos.length === 0) {
    return { lancamentos: [], resumo: [], erros: ['Nenhuma conta de resultado com saldo para zerar no razão carregado.'] };
  }

  return { lancamentos, resumo, erros: [] };
}

function ZeramentoResultadoEditor({
  planoRows,
  razaoRows,
  contabil,
  onGerarLancamentos,
}: {
  planoRows: VisionPlanoRow[];
  razaoRows: VisionBalanceteRow[];
  contabil: boolean;
  onGerarLancamentos: (lancamentos: VisionBalanceteRow[]) => void;
}) {
  const [dataZeramento, setDataZeramento] = useState('');
  const [contaResultado, setContaResultado] = useState('');
  const [preview, setPreview] = useState<{ resumo: string[]; erros: string[] } | null>(null);
  const [aplicado, setAplicado] = useState(false);

  const planoOptions: ExtratoPlanoContaOption[] = useMemo(
    () => buildPlanoOptions(planoRows),
    [planoRows],
  );

  const labelHint = contabil
    ? 'text-[9px] font-bold uppercase opacity-50 leading-snug'
    : 'text-[10px] text-slate-500 leading-snug';
  const inputClass = contabil
    ? 'w-full px-2 py-1.5 bg-white border border-brand-border text-xs font-mono font-bold focus:outline-none focus:ring-1 focus:ring-brand-border'
    : 'w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-xs';

  const brToIso = (v: string) => {
    const p = v.split('/');
    return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : v;
  };
  const isoToBr = (v: string) => {
    const p = v.split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : v;
  };

  const handlePreview = () => {
    if (!dataZeramento || !isValidBrDate(dataZeramento)) {
      setPreview({ resumo: [], erros: ['Informe uma data válida no formato DD/MM/AAAA.'] });
      return;
    }
    if (!contaResultado.trim()) {
      setPreview({ resumo: [], erros: ['Informe o código reduzido da conta "Resultado do Exercício".'] });
      return;
    }
    const result = gerarLancamentosZeramento({ razaoRows, planoRows, dataZeramento, contaResultadoReduzido: contaResultado });
    setPreview({ resumo: result.resumo, erros: result.erros });
    setAplicado(false);
  };

  const handleAplicar = () => {
    if (!dataZeramento || !isValidBrDate(dataZeramento) || !contaResultado.trim()) return;
    const result = gerarLancamentosZeramento({ razaoRows, planoRows, dataZeramento, contaResultadoReduzido: contaResultado });
    if (result.erros.length > 0 || result.lancamentos.length === 0) return;
    onGerarLancamentos(result.lancamentos);
    setAplicado(true);
    setPreview((prev) => prev ? { ...prev, resumo: [`✓ ${result.lancamentos.length} lançamento(s) adicionados ao razão.`, ...prev.resumo] } : null);
  };

  return (
    <div className="space-y-4">
      <p className={labelHint}>
        Informe a <strong>data do zeramento</strong> (ex.: 31/12/2024) e a conta <strong>Resultado do Exercício</strong>.
        O sistema apura o saldo de todas as contas de receita (grupo 3) e despesa (grupos 4–7) e gera
        os lançamentos de encerramento que as zeram, debitando ou creditando a conta resultado.
      </p>

      <div className={contabil ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : 'space-y-3'}>
        <div className="space-y-1">
          <label className={contabil ? 'text-[8px] font-black uppercase text-brand-text/50 block' : 'text-[9px] text-slate-500 block'}>
            Data do zeramento
          </label>
          <input
            type="date"
            value={brToIso(dataZeramento)}
            onChange={(e) => { setDataZeramento(isoToBr(e.target.value)); setPreview(null); setAplicado(false); }}
            className={inputClass}
          />
          {dataZeramento && !isValidBrDate(dataZeramento) && (
            <p className="text-[8px] text-rose-700 font-bold">Data inválida.</p>
          )}
        </div>

        <div className="space-y-1">
          <label className={contabil ? 'text-[8px] font-black uppercase text-brand-text/50 block' : 'text-[9px] text-slate-500 block'}>
            Conta Resultado do Exercício (cód. reduzido)
          </label>
          <ExtratoContaPicker
            value={contaResultado}
            options={planoOptions}
            includeSinteticas
            showNomeInline
            placeholder="Código…"
            ariaLabel="Conta Resultado do Exercício"
            onChange={(code) => { setContaResultado(code); setPreview(null); setAplicado(false); }}
          />
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          onClick={handlePreview}
          disabled={razaoRows.length === 0}
          className={
            contabil
              ? 'technical-button text-[9px] py-1 px-4 inline-flex items-center gap-1 disabled:opacity-40'
              : 'px-4 py-1.5 rounded border border-slate-600 text-slate-300 text-[10px] font-bold uppercase disabled:opacity-40'
          }
        >
          Visualizar
        </button>
        {preview && preview.erros.length === 0 && preview.resumo.length > 0 && !aplicado && (
          <button
            type="button"
            onClick={handleAplicar}
            className={
              contabil
                ? 'technical-button-primary text-[9px] py-1 px-4 inline-flex items-center gap-1'
                : 'px-4 py-1.5 rounded bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-black uppercase'
            }
          >
            Aplicar no razão
          </button>
        )}
      </div>

      {razaoRows.length === 0 && (
        <p className="text-[9px] italic opacity-50">Carregue o razão antes de gerar o zeramento.</p>
      )}

      {preview && (
        <div className={contabil ? 'border border-brand-border bg-brand-bg p-3 space-y-1.5' : 'border border-slate-700 bg-slate-950/50 rounded-lg p-3 space-y-1.5'}>
          {preview.erros.length > 0 ? (
            preview.erros.map((e, i) => (
              <p key={i} className="text-[9px] text-rose-700 font-bold">{e}</p>
            ))
          ) : (
            <>
              <p className={contabil ? 'text-[9px] font-black uppercase tracking-widest text-brand-text/60' : 'text-[10px] font-bold text-violet-300'}>
                Lançamentos a gerar · {preview.resumo.length - 1}
              </p>
              <ul className="max-h-[200px] overflow-y-auto space-y-0.5">
                {preview.resumo.map((line, i) => (
                  <li key={i} className={contabil ? `text-[8px] font-mono ${i === 0 ? 'font-black text-brand-text' : 'text-brand-text/60'}` : `text-[9px] font-mono ${i === 0 ? 'text-white font-bold' : 'text-slate-400'}`}>
                    {line}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Compensação Banco Credor (banco ↔ conta garantida) ───────────────────────

function CompensacaoBancoCredorEditor({
  planoRows,
  contabil,
  empresaNome,
}: {
  planoRows: VisionPlanoRow[];
  contabil: boolean;
  empresaNome: string;
}) {
  // Carrega as contas salvas ao montar — sobrevive a recargas de página.
  const [contaBanco, setContaBanco] = useState(() => {
    return readAutomatizacaoContaConfig(empresaNome).compensacaoBancoConfig?.contaBanco ?? '';
  });
  const [contaGarantida, setContaGarantida] = useState(() => {
    return readAutomatizacaoContaConfig(empresaNome).compensacaoBancoConfig?.contaGarantida ?? '';
  });

  const planoOptions: ExtratoPlanoContaOption[] = useMemo(() => buildPlanoOptions(planoRows), [planoRows]);

  const labelHint = contabil
    ? 'text-[9px] font-bold uppercase opacity-50 leading-snug'
    : 'text-[10px] text-slate-500 leading-snug';

  /** Persiste as contas sempre que o usuário as altera. */
  const persistContas = (banco: string, garantida: string) => {
    const current = readAutomatizacaoContaConfig(empresaNome);
    const next: AutomacaoContaConfig = { ...current };
    if (banco.trim() && garantida.trim()) {
      next.compensacaoBancoConfig = { contaBanco: banco.trim(), contaGarantida: garantida.trim() };
    } else {
      delete next.compensacaoBancoConfig;
    }
    saveAutomatizacaoContaConfig(empresaNome, next);
  };

  return (
    <div className="space-y-4">
      <p className={labelHint}>
        Quando a conta do banco fecha o mês <strong>credora (C)</strong>, gera automaticamente a
        <strong> utilização</strong> (D banco / C conta garantida) e, no mês seguinte, a
        <strong> devolução</strong> (D conta garantida / C banco) — mês a mês, até a conta deixar de fechar credora.
        Selecione as duas contas abaixo e clique em <strong>Aplicar Automação</strong> na aba do balancete para gerar os lançamentos.
      </p>

      <div className={contabil ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : 'space-y-3'}>
        <div className="space-y-1">
          <label className={contabil ? 'text-[8px] font-black uppercase text-brand-text/50 block' : 'text-[9px] text-slate-500 block'}>
            Conta do banco
          </label>
          <ExtratoContaPicker
            value={contaBanco}
            options={planoOptions}
            includeSinteticas={false}
            showNomeInline
            placeholder="Selecione a conta banco…"
            ariaLabel="Conta do banco"
            onChange={(code) => {
              setContaBanco(code);
              persistContas(code, contaGarantida);
            }}
          />
        </div>

        <div className="space-y-1">
          <label className={contabil ? 'text-[8px] font-black uppercase text-brand-text/50 block' : 'text-[9px] text-slate-500 block'}>
            Conta garantida (contrapartida)
          </label>
          <ExtratoContaPicker
            value={contaGarantida}
            options={planoOptions}
            includeSinteticas={false}
            showNomeInline
            placeholder="Selecione a conta garantida…"
            ariaLabel="Conta garantida"
            onChange={(code) => {
              setContaGarantida(code);
              persistContas(contaBanco, code);
            }}
          />
        </div>
      </div>

      <p className={contabil ? 'text-[8px] text-green-800 font-bold' : 'text-[9px] text-emerald-400 font-bold'}>
        {contaBanco && contaGarantida
          ? '✓ Contas salvas. Clique em "Aplicar Automação" no balancete para gerar os lançamentos.'
          : 'Selecione as duas contas para habilitar a automação.'}
      </p>
    </div>
  );
}

export function AutomatizacaoContaConfigModal({
  open,
  onClose,
  planoRows,
  razaoRows = [],
  empresaNome,
  onSaved,
  onRazaoRowsChange,
  surface = 'contabilfacil',
  abrirSubOverlay,
  periodoDe,
  periodoAte,
}: Props) {
  const contabil = surface === 'contabilfacil';

  const [draft, setDraft] = useState<AutomacaoContaConfig>(() =>
    readAutomatizacaoContaConfig(empresaNome),
  );
  const [dataModoErro, setDataModoErro] = useState<string | null>(null);
  const [papelAberto, setPapelAberto] = useState<AutomacaoContaPapel | null>(null);
  const [coligadasAberto, setColigadasAberto] = useState(false);
  const [zeramentoAberto, setZeramentoAberto] = useState(false);
  const [lancamentoEmprestimoAberto, setLancamentoEmprestimoAberto] = useState(false);
  const [compensacaoBancoAberto, setCompensacaoBancoAberto] = useState(false);

  useEffect(() => {
    if (open && abrirSubOverlay) {
      if (abrirSubOverlay === 'custo') {
        setPapelAberto('custo_cmv');
      } else if (abrirSubOverlay === 'coligadas') {
        setColigadasAberto(true);
      } else if (abrirSubOverlay === 'emprestimo') {
        setLancamentoEmprestimoAberto(true);
      } else if (abrirSubOverlay === 'zeramento') {
        setZeramentoAberto(true);
      } else if (abrirSubOverlay === 'compensacao_banco') {
        setCompensacaoBancoAberto(true);
      }
    } else if (!open) {
      setPapelAberto(null);
      setColigadasAberto(false);
      setLancamentoEmprestimoAberto(false);
      setZeramentoAberto(false);
      setCompensacaoBancoAberto(false);
    }
  }, [open, abrirSubOverlay]);

  useEffect(() => {
    const sync = () => {
      setDraft(readAutomatizacaoContaConfig(empresaNome));
    };
    window.addEventListener('contabilfacil:config-updated', sync);
    return () => window.removeEventListener('contabilfacil:config-updated', sync);
  }, [empresaNome]);

  const papeisCusto = useMemo(() => PAPEIS_AUTOMACAO_UI.filter((p) => p.id.startsWith('custo')), []);
  const papeisOutros = useMemo(() => PAPEIS_AUTOMACAO_UI.filter((p) => !p.id.startsWith('custo')), []);

  const reload = useCallback(() => {
    setDraft(readAutomatizacaoContaConfig(empresaNome));
    setDataModoErro(null);
    setPapelAberto(null);
    setColigadasAberto(false);
    setLancamentoEmprestimoAberto(false);
  }, [empresaNome]);

  React.useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  /** Salva a conta assim que o usuário escolhe débito/crédito/% — sem precisar de botão Aplicar. */
  const setPapel = (papel: AutomacaoContaPapel, cfg: AutomacaoContaPapelConfig | undefined) => {
    const saved = savePapelAutomatizacaoContaConfig(empresaNome, papel, cfg);
    setDraft((prev) => {
      const merged: AutomacaoContaConfig = { ...prev };
      if (saved[papel]) merged[papel] = saved[papel];
      else delete merged[papel];
      return merged;
    });
    onSaved?.(saved);
  };

  const empresasDisponiveis = useMemo(() => {
    const registry = loadCompaniesRegistry().map((c) => c.name);
    const ia = listAiColigadasParaIa(empresaNome).map((c) => normalizeCompanyName(c.nome));
    const atual = normalizeCompanyName(empresaNome);
    const set = new Set<string>();
    for (const n of [...registry, ...ia]) {
      if (n && n !== atual) set.add(n);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [empresaNome, open]);

  /** Contratos de empréstimo já cadastrados na empresa atual (aba Empréstimos). */
  const contratosEmprestimo = useMemo(() => {
    if (!open) return [];
    return loadContractsFromBrowserStorage().filter((c) => belongsToCompany(c.companyName, empresaNome));
  }, [empresaNome, open, lancamentoEmprestimoAberto]);

  const coligadas = draft.emprestimoColigadas ?? [];

  /** Persiste a lista de coligadas — chamado a cada alteração (sem botão Aplicar). */
  const persistColigadas = (list: AutomacaoEmprestimoColigada[]) => {
    const current = readAutomatizacaoContaConfig(empresaNome);
    const next = { ...current, emprestimoColigadas: list };
    saveAutomatizacaoContaConfig(empresaNome, next);
    setDraft((prev) => ({ ...prev, emprestimoColigadas: list }));
    onSaved?.(next);
  };

  const upsertColigada = (id: string, patch: Partial<AutomacaoEmprestimoColigada>) => {
    const list = [...(draft.emprestimoColigadas ?? [])];
    const idx = list.findIndex((c) => c.id === id);
    if (idx < 0) return;
    list[idx] = { ...list[idx], ...patch };
    persistColigadas(list);
  };

  const addColigada = () => {
    const list = [
      ...(draft.emprestimoColigadas ?? []),
      {
        id: newEmprestimoColigadaId(),
        empresaColigada: empresasDisponiveis[0] ?? '',
      },
    ];
    persistColigadas(list);
  };

  const removeColigada = (id: string) => {
    const list = (draft.emprestimoColigadas ?? []).filter((c) => c.id !== id);
    persistColigadas(list);
  };

  const aplicarPeriodoLancamento = () => {
    const current = readAutomatizacaoContaConfig(empresaNome);
    const start = (draft.dataInicio ?? '').trim();
    const end = (draft.dataFim ?? '').trim();

    if (!start || !end) {
      setDataModoErro('O período de lançamento (Data Inicial e Data Final) é obrigatório.');
      return;
    }

    if (!isValidBrDate(start) || !isValidBrDate(end)) {
      setDataModoErro('Informe datas válidas no formato DD/MM/AAAA.');
      return;
    }

    if (isDataNoPeriodoFechado(start, current)) {
      setDataModoErro(
        `A data inicial ${start} está no período fechado (antes de ${current.periodoFechadoAte}).`,
      );
      return;
    }

    const startIso = parseBrDateToIso(start);
    const endIso = parseBrDateToIso(end);
    if (startIso > endIso) {
      setDataModoErro('A data inicial não pode ser maior que a data final.');
      return;
    }

    setDataModoErro(null);
    const next: AutomacaoContaConfig = {
      ...current,
      dataModo: 'ultimo_dia_mes',
      dataInicio: start,
      dataFim: end,
    };
    delete next.dataFixa;
    delete next.anoLancamento;

    saveAutomatizacaoContaConfig(empresaNome, next);
    setDraft((prev) => {
      const merged: AutomacaoContaConfig = {
        ...prev,
        dataModo: 'ultimo_dia_mes',
        dataInicio: start,
        dataFim: end,
      };
      delete merged.dataFixa;
      delete merged.anoLancamento;
      return merged;
    });
    onSaved?.(next);
  };

  if (!open) return null;

  const overlayClass = contabil
    ? 'fixed inset-0 z-[200] flex items-center justify-center p-4 bg-brand-text/40'
    : 'fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70';

  const shellClass = contabil
    ? 'w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col technical-panel shadow-[8px_8px_0_0_#141414]'
    : 'w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col rounded-2xl border border-violet-500/40 bg-slate-900 shadow-2xl';

  const headerClass = contabil
    ? 'px-4 py-3 border-b border-brand-border flex items-start justify-between gap-2 bg-brand-sidebar/40'
    : 'px-4 py-3 border-b border-slate-700 flex items-start justify-between gap-2';

  const titleClass = contabil
    ? 'text-[10px] font-black uppercase tracking-widest text-brand-text'
    : 'text-sm font-black text-violet-200 uppercase tracking-wide';

  const subtitleClass = contabil
    ? 'text-[9px] font-bold uppercase opacity-50 mt-1'
    : 'text-[10px] text-slate-400 mt-1';

  const bodyClass = contabil
    ? 'flex-1 overflow-y-auto p-4 space-y-4 bg-brand-bg'
    : 'flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3';

  const footerClass = contabil
    ? 'px-4 py-3 border-t border-brand-border flex flex-wrap gap-2 justify-end bg-brand-sidebar/30'
    : 'px-4 py-3 border-t border-slate-700 flex flex-wrap gap-2 justify-end';

  const sectionClass = contabil
    ? 'technical-panel p-4 bg-brand-sidebar/15 space-y-3'
    : 'rounded-lg border border-slate-700 bg-slate-950/60 p-3 space-y-2';

  const labelTitle = contabil
    ? 'text-[10px] font-black uppercase tracking-widest text-brand-text'
    : 'text-[11px] font-bold text-violet-200';

  const labelHint = contabil
    ? 'text-[9px] font-bold uppercase opacity-50 leading-snug'
    : 'text-[10px] text-slate-500 leading-snug';

  const inputClass = contabil
    ? 'w-full px-2 py-1.5 bg-white border border-brand-border text-xs font-mono font-bold focus:outline-none focus:ring-1 focus:ring-brand-border'
    : 'w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-xs';

  const papelAbertoDef = papelAberto ? PAPEIS_AUTOMACAO_UI.find((p) => p.id === papelAberto) : undefined;

  return (
    <>
    <div
      className={overlayClass}
      role="dialog"
      aria-modal="true"
      aria-labelledby="automacao-config-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={shellClass} onClick={(e) => e.stopPropagation()}>
        <div className={headerClass}>
          <div>
            <h2 id="automacao-config-title" className={titleClass}>
              Configuração de automação
            </h2>
            <p className={subtitleClass}>
              Empresa: {empresaNome.trim() || 'Padrão'} · D e C nos blocos abaixo. Caixa e despesa de ajuste são
              identificados automaticamente no plano.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={
              contabil
                ? 'p-1 border border-brand-border hover:bg-brand-border hover:text-brand-bg transition-colors'
                : 'text-slate-400 hover:text-white text-lg leading-none px-2'
            }
            aria-label="Fechar"
          >
            {contabil ? <X size={16} strokeWidth={2.5} /> : '×'}
          </button>
        </div>
        <div className={bodyClass}>
          {/* O Período Fechado agora é exibido e controlado diretamente no cabeçalho do software (ModuleShell) */}

          <div className={sectionClass}>
            <p className={labelTitle}>Data dos lançamentos</p>
            <p className={labelHint}>
              A automação sempre lança no último dia do mês do período (garantida, clientes, mútuo, custos).
              Não se aplica a empréstimo entre coligadas — nessas a data vem do lançamento bancário.
            </p>
            <p
              className={
                contabil
                  ? 'text-[10px] font-mono font-bold text-green-800 bg-green-50 border border-green-800/30 px-2 py-1 inline-block'
                  : 'text-[10px] text-emerald-300/90 font-mono'
              }
            >
              Último dia do mês (padrão) — fixo
            </p>

            <div
              className={
                contabil
                  ? 'pt-2 border-t border-brand-border/20 space-y-2'
                  : 'pt-2 border-t border-slate-700/50 space-y-2'
              }
            >
              <label className={contabil ? 'block text-[9px] font-bold uppercase opacity-50' : 'text-[10px] text-slate-400'}>
                Período de lançamento (Obrigatório)
              </label>
              <p className={labelHint}>
                Escolha o intervalo de datas (dia/mês/ano) em que a automação vai gerar lançamentos.
              </p>
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex flex-col gap-1">
                  <span className="text-[8px] uppercase opacity-65 font-bold">Data Inicial</span>
                  <input
                    type="text"
                    value={draft.dataInicio ?? ''}
                    onChange={(e) => {
                      const masked = formatBrDateMask(e.target.value);
                      setDraft((prev) => ({ ...prev, dataInicio: masked }));
                      if (dataModoErro) setDataModoErro(null);
                    }}
                    placeholder="DD/MM/AAAA"
                    className={inputClass}
                    aria-label="Data de início da automação"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[8px] uppercase opacity-65 font-bold">Data Final</span>
                  <input
                    type="text"
                    value={draft.dataFim ?? ''}
                    onChange={(e) => {
                      const masked = formatBrDateMask(e.target.value);
                      setDraft((prev) => ({ ...prev, dataFim: masked }));
                      if (dataModoErro) setDataModoErro(null);
                    }}
                    placeholder="DD/MM/AAAA"
                    className={inputClass}
                    aria-label="Data final da automação"
                  />
                </div>
                <button
                  type="button"
                  onClick={aplicarPeriodoLancamento}
                  className={
                    contabil
                      ? 'technical-button-primary text-[10px] px-4 py-1.5'
                      : 'px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-black uppercase'
                  }
                >
                  Aplicar período
                </button>
              </div>
              {dataModoErro && <p className="text-[10px] font-bold text-rose-600">{dataModoErro}</p>}
              {!dataModoErro && draft.dataInicio && draft.dataFim && (
                <p
                  className={
                    contabil
                      ? 'text-[10px] font-mono font-bold text-green-800 bg-green-50 border border-green-800/30 px-2 py-1 inline-block'
                      : 'text-[10px] text-emerald-300/90 font-mono bg-emerald-950/20 border border-emerald-500/20 px-2 py-1 rounded'
                  }
                >
                  ✓ Período ativo: {draft.dataInicio} até {draft.dataFim}
                </p>
              )}
            </div>
          </div>

          {papeisOutros.map((p) => (
            <PapelResumoRow
              key={p.id}
              titulo={p.titulo}
              hint={p.hint}
              configurado={papelConfigurado(draft, p.id)}
              onAbrir={() => setPapelAberto(p.id)}
              contabil={contabil}
            />
          ))}

          <PapelResumoRow
            titulo="Custo"
            hint="Custo da mercadoria/produto vendido ou dos serviços prestados. Escolha o tipo ao abrir. Opcional: % sobre faturamento para lançar custo automaticamente."
            configurado={papeisCusto.some((p) => papelConfigurado(draft, p.id))}
            onAbrir={() => setPapelAberto((atual) => atual ?? papeisCusto[0].id)}
            contabil={contabil}
          />

          <PapelResumoRow
            titulo="Empréstimo entre coligadas"
            hint="Vínculo D/C por empresa coligada já cadastrada. Data vem do lançamento bancário."
            configurado={coligadas.length > 0}
            onAbrir={() => setColigadasAberto(true)}
            contabil={contabil}
          />

          <PapelResumoRow
            titulo="Empréstimo bancário"
            hint="Correção monetária e ajuste de juros para empréstimos bancários. Selecione os empréstimos já lançados e configure as contas."
            configurado={false}
            onAbrir={() => setLancamentoEmprestimoAberto(true)}
            contabil={contabil}
          />

          <PapelResumoRow
            titulo="Zeramento das contas de resultado"
            hint="Gera lançamentos de encerramento do exercício: zera receitas e despesas na conta Resultado do Exercício pela data informada."
            configurado={false}
            onAbrir={() => setZeramentoAberto(true)}
            contabil={contabil}
          />

          <PapelResumoRow
            titulo="Compensação Banco Credor"
            hint="Quando a conta do banco fecha o mês credora (C), lança utilização/devolução contra a conta garantida escolhida — mesma lógica do ciclo automático banco/garantida."
            configurado={false}
            onAbrir={() => setCompensacaoBancoAberto(true)}
            contabil={contabil}
          />
        </div>
        <div className={footerClass}>
          <button
            type="button"
            onClick={onClose}
            className={contabil ? 'technical-button-primary text-[10px] px-6' : 'px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-black uppercase'}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>

    {papelAbertoDef && (
      <SubOverlay
        title={papelAbertoDef.id.startsWith('custo_') ? 'Custo' : papelAbertoDef.titulo}
        onClose={() => setPapelAberto(null)}
        contabil={contabil}
      >
        {papelAbertoDef.id.startsWith('custo_') && (
          <div className="mb-3">
            <label className={contabil ? 'block text-[9px] font-bold uppercase opacity-50 mb-1' : 'block text-[10px] text-slate-400 mb-1'}>
              Tipo de custo
            </label>
            <select
              value={papelAbertoDef.id}
              onChange={(e) => setPapelAberto(e.target.value as AutomacaoContaPapel)}
              className={
                contabil
                  ? 'w-full border border-brand-border bg-white px-2 py-1.5 text-[11px] font-mono'
                  : 'w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-slate-100'
              }
              aria-label="Tipo de custo"
            >
              {papeisCusto.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.titulo}
                  {papelConfigurado(draft, p.id) ? ' ✓' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        <PapelEditor
          papel={papelAbertoDef.id}
          titulo={papelAbertoDef.titulo}
          hint={papelAbertoDef.hint}
          debHint={papelAbertoDef.debHint}
          credHint={papelAbertoDef.credHint}
          info={papelAbertoDef.info}
          config={draft[papelAbertoDef.id]}
          planoRows={planoRows}
          onChange={setPapel}
          contabil={contabil}
        />
      </SubOverlay>
    )}

    {zeramentoAberto && (
      <SubOverlay
        title="Zeramento das contas de resultado"
        onClose={() => setZeramentoAberto(false)}
        contabil={contabil}
      >
        <ZeramentoResultadoEditor
          planoRows={planoRows}
          razaoRows={razaoRows}
          contabil={contabil}
          onGerarLancamentos={(lancamentos) => {
            onRazaoRowsChange?.(lancamentos);
            setZeramentoAberto(false);
          }}
        />
      </SubOverlay>
    )}

    {compensacaoBancoAberto && (
      <SubOverlay
        title="Compensação Banco Credor"
        onClose={() => setCompensacaoBancoAberto(false)}
        contabil={contabil}
      >
        <CompensacaoBancoCredorEditor
          planoRows={planoRows}
          contabil={contabil}
          empresaNome={empresaNome}
        />
      </SubOverlay>
    )}

    {coligadasAberto && (
      <SubOverlay title="Empréstimo entre coligadas" onClose={() => setColigadasAberto(false)} contabil={contabil} widthClass="max-w-4xl">
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <p className={labelHint}>
              Escolha a empresa coligada já cadastrada e informe D e C. O sistema confere se bate com a
              outra empresa; se não bater, busca o lançamento correspondente. A data vem do próprio
              lançamento do banco (não usa a opção de data acima).
            </p>
            <button
              type="button"
              onClick={addColigada}
              className={
                contabil
                  ? 'technical-button text-[10px] inline-flex items-center gap-1 shrink-0'
                  : 'px-2 py-1 rounded-lg border border-slate-600 text-slate-300 text-[10px] uppercase inline-flex items-center gap-1 shrink-0'
              }
            >
              <Plus size={12} />
              Adicionar
            </button>
          </div>

          {empresasDisponiveis.length === 0 && (
            <p className="text-[9px] opacity-60">
              Nenhuma outra empresa no sistema. Cadastre a coligada no ContábilFácil ou na Inteligência IA.
            </p>
          )}

          {coligadas.map((item) => (
            <ColigadaEmprestimoEditor
              key={item.id}
              item={item}
              empresas={empresasDisponiveis}
              planoRows={planoRows}
              contabil={contabil}
              onChange={(patch) => upsertColigada(item.id, patch)}
              onRemove={() => removeColigada(item.id)}
            />
          ))}

        </div>
      </SubOverlay>
    )}

    {lancamentoEmprestimoAberto && (
      <SubOverlay
        title="Empréstimo bancário"
        onClose={() => setLancamentoEmprestimoAberto(false)}
        contabil={contabil}
        widthClass="max-w-4xl"
      >
        <LancamentoEmprestimoEditor
          empresaNome={empresaNome}
          planoRows={planoRows}
          contratos={contratosEmprestimo}
          razaoRows={razaoRows}
          contabil={contabil}
          onRazaoRowsChange={onRazaoRowsChange}
        />
      </SubOverlay>
    )}
    </>
  );
}
