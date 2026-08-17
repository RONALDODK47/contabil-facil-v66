import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import type { Transaction } from '../types';
import {
  appendVisionConciliation,
  type SavedVisionConciliationLinha,
} from '../utils/saveVisionConciliation';
import { parseOfxToLedgerRows } from '../utils/ofxLedgerParser';
import { SidebarInfoHint } from '../../components/SidebarInfoHint';
export type VisionWorkspaceTab =
  | 'extrato'
  | 'conciliacao_dc'
  | 'balancete'
  | 'balanco'
  | 'dre'
  | 'dmpl'
  | 'dlpa'
  | 'nota_explicativa'
  | 'dfc'
  | 'plano_contas';

type LedgerRow = { data?: string; historico: string; debito: number; credito: number };

type ExtratoLineReconForm = {
  contaDebito: string;
  contaCredito: string;
  /** Texto do histórico contábil (nome da operação), ex.: VALOR DE EMPRESTIMO — destinado ao TXT Domínio. */
  historicoOperacao: string;
};

const extratoReconInputCls =
  'w-full min-w-[5.5rem] bg-slate-950 border border-slate-600 rounded-md py-1.5 px-2 text-[11px] font-mono text-slate-100 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none';

/** Uma linha do plano de contas importado (código + descrição). */
export type VisionPlanoRow = { codigo: string; nome: string };

/** Módulos que dependem do plano de contas NBC/CPC antes de exibir estrutura. */
const TAB_IDS_REQUIRING_PLANO: VisionWorkspaceTab[] = [
  'balancete',
  'balanco',
  'dre',
  'dmpl',
  'dlpa',
  'nota_explicativa',
  'dfc',
];

function tabRequiresImportedPlanoContas(tab: VisionWorkspaceTab): boolean {
  return TAB_IDS_REQUIRING_PLANO.includes(tab);
}

const MODULE_DEFS: Array<{
  id: VisionWorkspaceTab;
  label: string;
  icon: string;
  title?: string;
}> = [
  { id: 'extrato', label: 'Extrato', icon: 'fa-file-invoice' },
  { id: 'plano_contas', label: 'Plano de contas', icon: 'fa-sitemap' },
  { id: 'conciliacao_dc', label: 'Conciliação D/C', icon: 'fa-scale-balanced' },
  { id: 'balancete', label: 'Balancete', icon: 'fa-table-list' },
  { id: 'balanco', label: 'Balanço', icon: 'fa-chart-pie' },
  { id: 'dre', label: 'DRE', icon: 'fa-chart-line' },
  { id: 'dmpl', label: 'DMPL', icon: 'fa-book-open' },
  { id: 'dlpa', label: 'DLPA', icon: 'fa-coins' },
  { id: 'nota_explicativa', label: 'NE', icon: 'fa-note-sticky' },
  { id: 'dfc', label: 'DFC', icon: 'fa-right-left' },
];

/** Texto do import só na aba Plano de contas (evitar duplicar noutras vistas). */
const PLANO_CONTAS_IMPORT_LABEL = 'Importar plano de contas (Excel/CSV)';
const PLANO_CONTAS_IMPORT_HINT =
  '1ª linha: cabeçalho com colunas de código da conta e descrição/nome (demais colunas são ignoradas). Use o mesmo plano já alinhado às políticas da sua contabilidade.';

function parsePlanoContas(rows: unknown[][]): VisionPlanoRow[] {
  const out: VisionPlanoRow[] = [];
  if (!rows?.length) return out;
  const head = rows[0]?.map((c) => String(c ?? '').toLowerCase()) ?? [];
  let ci = head.findIndex((h) => /\bconta\b|cod|c[oó]digo|codigo|\bnr\b/.test(h));
  let ni = head.findIndex((h) => /descri|nome|denom/i.test(h));
  const slice = ci >= 0 && ni >= 0 ? rows.slice(1) : rows;
  if (ci < 0) ci = 0;
  if (ni < 0) ni = 1;
  for (const row of slice) {
    if (!Array.isArray(row)) continue;
    const codigo = String(row[ci] ?? '').trim();
    const nome = String(row[ni] ?? '').trim();
    if (!codigo && !nome) continue;
    out.push({ codigo: codigo || '—', nome: nome || '—' });
  }
  return out;
}

export function VisionWorkspaceNav({
  active,
  onChange,
  hasPlanoContas,
}: {
  active: VisionWorkspaceTab;
  onChange: (t: VisionWorkspaceTab) => void;
  /** Quando false, módulos que exigem plano aparecem bloqueados até haver importação. */
  hasPlanoContas: boolean;
}) {
  return (
    <nav
      aria-label="Módulos Extrato Vision"
      className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide w-full items-center"
    >
      {MODULE_DEFS.map((m) => {
        const needsPlano = tabRequiresImportedPlanoContas(m.id);
        const locked = needsPlano && !hasPlanoContas;
        const activeLocked = active === m.id && locked;
        return (
          <button
            key={m.id}
            type="button"
            title={
              locked
                ? 'Importe o plano de contas na aba «Plano de contas» (único local com upload do ficheiro).'
                : undefined
            }
            onClick={() => onChange(m.id)}
            className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] sm:text-xs font-black uppercase tracking-tight transition-all border ${
              activeLocked
                ? 'bg-amber-900/95 border-amber-500 text-amber-50 shadow-lg shadow-amber-900/30'
                : active === m.id
                  ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/40'
                  : locked
                    ? 'bg-slate-950/80 border-slate-700 text-slate-600 hover:border-amber-700/60 hover:text-amber-200/90'
                    : 'bg-slate-900/60 border-slate-600 text-slate-400 hover:bg-slate-700 hover:text-white'
            }`}
          >
            {locked ? (
              <i className="fas fa-lock opacity-90 text-[10px]" aria-hidden />
            ) : (
              <i className={`fas ${m.icon} opacity-90`} aria-hidden />
            )}
            {m.label}
          </button>
        );
      })}
    </nav>
  );
}

function PanelShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-auto bg-slate-950 px-4 py-6">
      <div className="max-w-5xl mx-auto w-full space-y-6">
        <div className="border-b border-slate-800 pb-4">
          <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
            <i className="fas fa-folder-open text-blue-400" /> {title}
          </h2>
          <p className="text-slate-500 text-sm mt-1">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function PlanoContasRequiredGate({
  targetModuleLabel,
  onGoToPlanoContasTab,
}: {
  targetModuleLabel: string;
  onGoToPlanoContasTab: () => void;
}) {
  return (
    <PanelShell
      title="Importe o plano de contas primeiro"
      subtitle="Conformidade com a estrutura contábil brasileira (NBC TG · CPC)."
    >
      <div className="rounded-xl border border-amber-600/45 bg-amber-950/25 p-4 text-sm text-amber-100/95 space-y-3">
        <p className="font-black uppercase text-xs tracking-wider text-amber-300/95">Passo obrigatório</p>
        <p className="text-slate-200 text-xs leading-relaxed">
          O módulo <strong className="text-white">«{targetModuleLabel}»</strong> usa a classificação de contas da sua
          empresa para posicionar saldos nas demonstrações financeiras (balancete, balanço, DRE, DMPL, DLPA, notas e DFC)
          de forma coerente com a <strong className="text-slate-100">NBC TG</strong> e os <strong className="text-slate-100">CPC</strong>{' '}
          aplicáveis (ex.: <strong className="text-slate-100">CPC 26</strong> para o conjunto de DF).
        </p>
        <p className="text-slate-400 text-[11px] leading-relaxed">
          A importação do arquivo do plano de contas (Excel/CSV) existe <strong className="text-slate-300">apenas</strong>{' '}
          na aba <strong className="text-slate-200">Plano de contas</strong>. Depois de carregar o ficheiro lá, o cadeado
          desaparece na barra e pode voltar a abrir <strong className="text-slate-200">{targetModuleLabel}</strong>.
        </p>
        <button
          type="button"
          onClick={onGoToPlanoContasTab}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-blue-900/30 transition hover:bg-blue-500"
        >
          <i className="fas fa-sitemap" aria-hidden />
          Ir para Plano de contas
        </button>
      </div>
    </PanelShell>
  );
}

/** Upload de ficheiros (Excel/CSV, OFX/QFX onde aplicável). */
function ImportBanner({
  onFile,
  accept,
  hint,
  label,
}: {
  label: string;
  hint: string;
  accept: string;
  onFile: (file: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-2xl border border-dashed border-slate-600 bg-slate-900/70 p-6">
      <p className="text-slate-300 text-sm font-semibold mb-2">{label}</p>
      <p className="text-slate-500 text-xs mb-4">{hint}</p>
      <input aria-label={label} title={label} ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-5 py-2.5 rounded-xl uppercase tracking-wider transition-all"
      >
        <i className="fas fa-upload mr-2" />
        Escolher arquivo
      </button>
    </div>
  );
}

export function VisionAccountingWorkspace({
  tab,
  extratoTotals,
  validTransactionsLength,
  planoRows,
  onPlanoRowsChange,
  conciliationEmpresa,
  onConciliationEmpresaChange,
  extratoFileName,
  onGoToPlanoContasTab,
  extratoTransactions,
}: {
  tab: VisionWorkspaceTab;
  extratoTotals: { credits: number; debits: number; net: number };
  validTransactionsLength: number;
  planoRows: VisionPlanoRow[];
  onPlanoRowsChange: (rows: VisionPlanoRow[]) => void;
  conciliationEmpresa: string;
  onConciliationEmpresaChange: (value: string) => void;
  extratoFileName?: string | null;
  onGoToPlanoContasTab: () => void;
  extratoTransactions: Transaction[];
}) {
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[]>([]);
  const [extratoLineReconById, setExtratoLineReconById] = useState<
    Record<string, ExtratoLineReconForm>
  >({});

  const extratoTxKey = useMemo(
    () => extratoTransactions.map((t) => t.id).join('\0'),
    [extratoTransactions]
  );

  useEffect(() => {
    setExtratoLineReconById((prev) => {
      const next: Record<string, ExtratoLineReconForm> = {};
      for (const t of extratoTransactions) {
        const p = prev[t.id];
        next[t.id] = p ?? { contaDebito: '', contaCredito: '', historicoOperacao: '' };
      }
      return next;
    });
  }, [extratoTxKey, extratoTransactions]);

  const ledgerTotals = useMemo(() => {
    return ledgerRows.reduce(
      (a, r) => {
        a.debito += r.debito;
        a.credito += r.credito;
        return a;
      },
      { debito: 0, credito: 0 }
    );
  }, [ledgerRows]);

  const onLedgerImport = useCallback(async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (ext !== 'ofx' && ext !== 'qfx') {
      alert('Apenas arquivos OFX/QFX são aceitos nesta importação.');
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      alert('Não foi possível ler o ficheiro OFX/QFX.');
      return;
    }
    const parsed = parseOfxToLedgerRows(text);
    if (!parsed.length) {
      alert(
        'Nenhuma transação OFX encontrada. Confirme um ficheiro .ofx/.qfx do banco com blocos <STMTTRN> e valores <TRNAMT>.'
      );
      return;
    }
    setLedgerRows(parsed);
  }, []);

  const onPlanoImport = useCallback(
    async (file: File) => {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const name = wb.SheetNames[0];
      const sheet = name ? wb.Sheets[name] : null;
      if (!sheet) {
        alert('Planilha vazia ou inválida.');
        return;
      }
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
      const parsed = parsePlanoContas(rows);
      if (!parsed.length) {
        alert('Não foi encontrada nenhuma linha válida de plano de contas. Confira código e descrição no arquivo.');
        return;
      }
      onPlanoRowsChange(parsed);
    },
    [onPlanoRowsChange]
  );

  if (tab === 'extrato') return null;

  if (tabRequiresImportedPlanoContas(tab) && planoRows.length === 0) {
    const mod = MODULE_DEFS.find((m) => m.id === tab);
    return <PlanoContasRequiredGate targetModuleLabel={mod?.label ?? tab} onGoToPlanoContasTab={onGoToPlanoContasTab} />;
  }

  if (tab === 'conciliacao_dc') {
    const diffDeb = ledgerTotals.debito - extratoTotals.debits;
    const diffCred = ledgerTotals.credito - extratoTotals.credits;
    const absOk = Math.abs(diffDeb) < 0.02 && Math.abs(diffCred) < 0.02;

    return (
      <PanelShell
        title="Conciliação com OFX importado (D/C)"
        subtitle="Importe um OFX/QFX do banco para conciliar; classifique cada linha Vision e grave quando os totais coincidirem."
      >
        <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-5 max-w-2xl">
          <h3 className="text-blue-400 text-xs font-black uppercase mb-3">Importado</h3>
          <ImportBanner
            label="Importar OFX (banco)"
            hint="OFX/QFX: exportação do home banking — movimentos com data, memo e valores (TRNAMT)."
            accept=".ofx,.qfx"
            onFile={onLedgerImport}
          />
          <p className="text-slate-500 text-[11px] mt-3">{ledgerRows.length} linhas com valores</p>
          <div className="space-y-2 font-mono text-sm mt-3">
            <div className="flex justify-between gap-8">
              <span className="text-slate-500">Soma débitos</span>
              <span className="text-red-400 font-bold tabular-nums">
                {ledgerTotals.debito.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </span>
            </div>
            <div className="flex justify-between gap-8">
              <span className="text-slate-500">Soma créditos</span>
              <span className="text-emerald-400 font-bold tabular-nums">
                {ledgerTotals.credito.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-5 space-y-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-black uppercase tracking-wider text-cyan-400/95">
                Movimentos extraídos — conciliação linha a linha
              </h3>
              <SidebarInfoHint label="Como conciliar linha a linha" align="left">
                <p className="leading-snug">
                  Cada linha do extrato Vision aparece com descrição bancária e valor. Preencha conta de débito, conta
                  de crédito e o nome da operação em texto (histórico do lançamento, ex.:{' '}
                  <strong className="text-slate-300">VALOR DE EMPRESTIMO</strong>) como deve sair no TXT Domínio antes
                  de fechar com o importado (OFX/razão).
                </p>
              </SidebarInfoHint>
            </div>
          </div>
          {extratoTransactions.length === 0 ? (
            <p className="text-amber-200/90 text-sm py-6 text-center">
              Extraia um extrato na aba <strong className="text-white">Extrato</strong> para listar as movimentações aqui.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-800 max-h-[55vh] overflow-y-auto custom-scrollbar">
              <table className="w-full min-w-[960px] text-left text-[11px]">
                <thead className="bg-slate-800 text-slate-400 sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="p-2 font-bold whitespace-nowrap w-24">Data</th>
                    <th className="p-2 font-bold min-w-[140px]">Histórico</th>
                    <th className="p-2 font-bold text-right whitespace-nowrap w-28">Valor</th>
                    <th className="p-2 font-bold text-center w-24">Tipo</th>
                    <th className="p-2 font-bold min-w-[120px]">Conta débito</th>
                    <th className="p-2 font-bold min-w-[120px]">Conta crédito</th>
                    <th className="p-2 font-bold min-w-[180px] whitespace-nowrap">Nome da operação (TXT)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {extratoTransactions.map((t) => {
                    const r = extratoLineReconById[t.id] ?? {
                      contaDebito: '',
                      contaCredito: '',
                      historicoOperacao: '',
                    };
                    return (
                      <tr key={t.id} className="bg-slate-950/40 align-top hover:bg-slate-900/60">
                        <td className="p-2 font-mono text-slate-400 whitespace-nowrap">{t.data}</td>
                        <td className="p-2 text-slate-300 whitespace-normal break-words">{t.historico}</td>
                        <td className="p-2 text-right font-mono font-bold whitespace-nowrap">
                          <span className={t.cd === 'C' ? 'text-emerald-400' : 'text-red-400'}>
                            {t.valor.toLocaleString('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                              signDisplay: 'always',
                            })}
                          </span>
                        </td>
                        <td className="p-2 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                              t.cd === 'C' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
                            }`}
                          >
                            {t.cd === 'C' ? 'C' : 'D'}
                          </span>
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            aria-label={`Conta débito — ${t.historico.slice(0, 40)}`}
                            placeholder="Ex.: 1.1.02.01"
                            className={extratoReconInputCls}
                            value={r.contaDebito}
                            onChange={(e) =>
                              setExtratoLineReconById((prev) => ({
                                ...prev,
                                [t.id]: { ...r, contaDebito: e.target.value },
                              }))
                            }
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            aria-label={`Conta crédito — ${t.historico.slice(0, 40)}`}
                            placeholder="Ex.: 2.1.01.05"
                            className={extratoReconInputCls}
                            value={r.contaCredito}
                            onChange={(e) =>
                              setExtratoLineReconById((prev) => ({
                                ...prev,
                                [t.id]: { ...r, contaCredito: e.target.value },
                              }))
                            }
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            aria-label={`Histórico da operação (TXT Domínio) — ${t.historico.slice(0, 40)}`}
                            placeholder="Ex.: VALOR DE EMPRESTIMO"
                            maxLength={200}
                            autoComplete="off"
                            className={extratoReconInputCls}
                            value={r.historicoOperacao}
                            onChange={(e) =>
                              setExtratoLineReconById((prev) => ({
                                ...prev,
                                [t.id]: { ...r, historicoOperacao: e.target.value },
                              }))
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-400">
              Salvar conciliação
            </h3>
            <SidebarInfoHint label="Quando o botão Salvar fica ativo" align="left">
              <p className="leading-snug">
                Ativa quando há transações no extrato e razão importado, quando totais de débito/crédito do importado
                coincidem com os do extrato (tolerância de centavos) e quando o nome da empresa está preenchido.
              </p>
            </SidebarInfoHint>
          </div>
          <div className="space-y-1">
            <label htmlFor="vision-conciliation-empresa" className="text-[11px] text-slate-500 uppercase tracking-widest">
              Nome da empresa
            </label>
            <input
              id="vision-conciliation-empresa"
              type="text"
              value={conciliationEmpresa}
              onChange={(e) => onConciliationEmpresaChange(e.target.value)}
              placeholder="Ex.: Empresa demonstrações Ltda."
              autoComplete="organization"
              className="w-full bg-slate-950 border border-slate-600 rounded-lg py-2.5 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none"
            />
          </div>
          <button
            type="button"
            disabled={
              !absOk ||
              !conciliationEmpresa.trim() ||
              ledgerRows.length === 0 ||
              validTransactionsLength === 0
            }
            onClick={() => {
              try {
                const detalhesPorLinha: SavedVisionConciliationLinha[] = extratoTransactions.map((t) => {
                  const r = extratoLineReconById[t.id] ?? {
                    contaDebito: '',
                    contaCredito: '',
                    historicoOperacao: '',
                  };
                  return {
                    id: t.id,
                    data: t.data,
                    historico: t.historico,
                    valor: t.valor,
                    cd: t.cd,
                    contaDebito: r.contaDebito,
                    contaCredito: r.contaCredito,
                    historicoOperacao: r.historicoOperacao,
                  };
                });
                appendVisionConciliation({
                  empresa: conciliationEmpresa.trim(),
                  extratoDebits: extratoTotals.debits,
                  extratoCredits: extratoTotals.credits,
                  razaoDebitoTotal: ledgerTotals.debito,
                  razaoCreditoTotal: ledgerTotals.credito,
                  deltaDeb: diffDeb,
                  deltaCred: diffCred,
                  movExtratoCount: validTransactionsLength,
                  linhasImportadasCount: ledgerRows.length,
                  arquivoExtratoNome: extratoFileName ?? undefined,
                  detalhesPorLinha,
                });
                alert(
                  `Conciliação salva para «${conciliationEmpresa.trim()}». Os registros ficam armazenados neste navegador (memória local).`
                );
              } catch {
                alert('Não foi possível salvar. Verifique o armazenamento local do navegador ou tente novamente.');
              }
            }}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-500 disabled:pointer-events-none disabled:opacity-40"
          >
            <i className="fas fa-floppy-disk" aria-hidden />
            Salvar conciliação
          </button>
        </div>

        {ledgerRows.length > 0 && (
          <div className="rounded-xl border border-slate-800 overflow-hidden max-h-[280px] overflow-y-auto custom-scrollbar">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-slate-800 text-slate-400 sticky top-0">
                <tr>
                  <th className="p-2 font-bold">Histórico</th>
                  <th className="p-2 text-right font-bold">Débito</th>
                  <th className="p-2 text-right font-bold">Crédito</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {ledgerRows.slice(0, 200).map((r, i) => (
                  <tr key={`${r.historico}-${i}`} className="bg-slate-950/60">
                    <td className="p-2 text-slate-300 whitespace-normal">{r.data ? `${r.data} · ` : ''}{r.historico}</td>
                    <td className="p-2 text-right text-red-400 font-mono">{r.debito > 0 ? r.debito.toFixed(2) : '—'}</td>
                    <td className="p-2 text-right text-emerald-400 font-mono">{r.credito > 0 ? r.credito.toFixed(2) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PanelShell>
    );
  }

  if (tab === 'plano_contas') {
    return (
      <PanelShell
        title="Plano de contas"
        subtitle="Plano oficial da empresa (analítico/sintético), base para classificação nas demonstrações NBC TG / CPC."
      >
        <ImportBanner
          label={PLANO_CONTAS_IMPORT_LABEL}
          hint={PLANO_CONTAS_IMPORT_HINT}
          accept=".xlsx,.xls,.csv"
          onFile={onPlanoImport}
        />
        {planoRows.length > 0 ? (
          <div className="rounded-xl border border-slate-800 max-h-[50vh] overflow-auto custom-scrollbar">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-800 text-slate-400 sticky top-0">
                <tr>
                  <th className="p-3 font-bold">Conta</th>
                  <th className="p-3 font-bold">Descrição</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {planoRows.slice(0, 500).map((r, i) => (
                  <tr key={`${r.codigo}-${i}`} className="bg-slate-900/60">
                    <td className="p-3 font-mono text-cyan-300">{r.codigo}</td>
                    <td className="p-3 text-slate-300">{r.nome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-slate-500 text-[10px] p-3">Mostrando até 500 linhas.</p>
          </div>
        ) : (
          <p className="text-slate-600 text-sm">Nenhum plano carregado ainda.</p>
        )}
      </PanelShell>
    );
  }

  const staticCopy: Partial<Record<VisionWorkspaceTab, { title: string; subtitle: string; body: string }>> = {
    balancete: {
      title: 'Balancete de verificação',
      subtitle: 'Estrutura de conferência de saldos (NBC TG · relação com o plano de contas importado).',
      body:
        'Use relatório sintético ou analítico com colunas conta, descrição, saldo inicial, débito, crédito e saldo final. O plano importado ancora a hierarquia de contas às práticas da sua contabilidade e ao arcabouço legal brasileiro.',
    },
    balanco: {
      title: 'Balanço patrimonial',
      subtitle: 'Ativo, passivo e patrimônio líquido (CPC 26 · apresentação das demonstrações financeiras).',
      body: 'As naturezas e grupos seguem a classificação admitida no Brasil; amarração aos saldos do balancete e ao plano de contas carregado evita “templates” genéricos incompatíveis com a sua empresa.',
    },
    dre: {
      title: 'DRE — resultado',
      subtitle: 'Demonstração do resultado do período (CPC 26 · receitas, custos e despesas).',
      body: 'A DRE por função ou natureza respeita o mapeamento das contas de resultado do seu plano; importe balancetes e razão de apoio em paralelo na Conciliação D/C quando precisar.',
    },
    dmpl: {
      title: 'DMPL — mutações do PL',
      subtitle: 'Demonstração das mutações do patrimônio líquido (CPC 26).',
      body: 'Destaques de capital, reservas, ajustes e lucros/prejuízos acumulados dependem da estrutura do seu plano e das políticas contábeis adotadas.',
    },
    dlpa: {
      title: 'DLPA — distribuição de lucros',
      subtitle: 'Destinação do lucro líquido (Lei das S.A. e práticas societárias).',
      body: 'Estruture com base na apuração oficial; o extrato bancário apoia a conferência de dividendos e juros sobre capital próprio.',
    },
    nota_explicativa: {
      title: 'Notas explicativas',
      subtitle: 'Informações qualitativas e quantitativas exigidas pelas NBC TG / CPC.',
      body: 'As notas completam as demonstrações e referenciam saldos e políticas; use os mesmos códigos de conta do plano importado para rastreabilidade.',
    },
    dfc: {
      title: 'DFC — fluxo de caixa',
      subtitle: 'Método direto ou indireto (CPC 03 · convergência com saldos de caixa e bancos).',
      body: 'O extrato importado na aba Extrato alimenta a visão operacional do caixa; a Conciliação D/C aproxima movimentos bancários dos lançamentos contábeis.',
    },
  };

  const cfg = staticCopy[tab];
  if (!cfg) return null;

  return (
    <PanelShell title={cfg.title} subtitle={cfg.subtitle}>
      <p className="text-slate-400 text-sm leading-relaxed">{cfg.body}</p>
      <ImportBanner
        label="Importar planilha de apoio (opcional)"
        hint={`Formatos .xlsx, .xls, .csv compatíveis com o layout esperado para ${cfg.title}.`}
        accept=".xlsx,.xls,.csv"
        onFile={() =>
          alert(
          'Layout específico desta demonstração será validado nas próximas versões; use Conciliação D/C ou importe dados tabulados apoiados no plano de contas.'
        )
        }
      />
    </PanelShell>
  );
}
