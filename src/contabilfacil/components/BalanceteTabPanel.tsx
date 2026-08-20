import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, Filter, FileText, X, FileCode, Trash2 } from 'lucide-react';
import type { VisionBalanceteRow } from '../../extratoVision/types/accounting';
import ContabilBalanceteComparativo from './ContabilBalanceteComparativo';
import { parseBrDateToTime } from '../../extratoVision/utils/dateBounds';
import { extrairPeriodoRazao } from '../logic/balancetePeriodoView';
import { cn } from '../lib/utils';
import { accountPlansToVisionPlano } from '../logic/contabilPipeline';
import type {
  OrigemBalanceteId,
  OrigemBalanceteResumo,
} from '../logic/origensBalancete';
import {
  readPersistedLocalStorageJson,
  writePersistedLocalStorageJson,
} from '../../lib/persistentLocalStorage';

type AccountPlan = {
  code: string;
  name: string;
  codigoReduzido?: string;
  tipo?: 'S' | 'A';
  nivel?: number;
};

type FolhaRelatorioRow = {
  id: string;
  date: string;
  description: string;
  debito: number;
  credito: number;
};

export interface BalanceteTabPanelProps {
  selectedCompany: string;
  planoContas: AccountPlan[];
  razaoRows: VisionBalanceteRow[];
  onRazaoRowsChange: (rows: VisionBalanceteRow[]) => void;
  folhaRelatorio?: FolhaRelatorioRow[];
  importedTxts?: Array<{ id: string; filename: string; months: string[]; importedAt: string }>;
  onDeleteImportedTxt?: (id: string) => void;
  /** O que cada aba (Folha, Conciliação, Fiscal…) publicou no balancete. */
  origensBalancete?: OrigemBalanceteResumo[];
  onExcluirOrigemBalancete?: (id: OrigemBalanceteId) => void;
  /** Período De/Até confirmado (o que está sendo visualizado) — usado na exportação TXT. */
  onPeriodoConfirmadoChange?: (periodo: { de: string; ate: string } | null) => void;
  /** Logs da última importação de balancete. */
  importedLogs?: string[];
}

function folhaRelatorioToVision(rows: FolhaRelatorioRow[]): VisionBalanceteRow[] {
  return rows.map((r, index) => ({
    codigo: '',
    nome: r.description.toUpperCase(),
    data: r.date,
    ordem: index + 1,
    debito: r.debito,
    credito: r.credito,
    saldoInicial: 0,
    saldoFinal: 0,
  }));
}

function brToDate(val: string): string {
  if (!val) return '';
  const parts = val.split('/');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return val;
}

function dateToBr(val: string): string {
  if (!val) return '';
  const parts = val.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return val;
}

/**
 * Chave SEM os prefixos "contabilfacil_"/"gc_auth_"/"cf-autobot-" — esses são
 * tratados como "dados leves do navegador" e o sistema desabilitou a gravação
 * real deles no localStorage (fica só em memória da aba, perdido ao recarregar
 * — ver src/lib/safeLocalStorage.ts). Usando o caminho "operacional" (igual ao
 * resto da config do Balancete/automação), o valor vai para o Docker/Eye Vision
 * e volta corretamente depois de um F5 ou de "Atualizar".
 */
const PERIODO_STORAGE_KEY = 'extratoVision_balancete_periodo_de_ate_v1';

type PeriodoSalvo = { de: string; ate: string };
type PeriodoPersistPayload = Record<string, PeriodoSalvo>;

function normEmpresaChave(companyName: string): string {
  return companyName.trim().toLowerCase() || '__default__';
}

/** Última data De/Até acessada pelo usuário no balancete desta empresa — sobrevive a "Atualizar" e recargas. */
function lerPeriodoSalvo(companyName: string): PeriodoSalvo | null {
  if (!companyName) return null;
  const all = readPersistedLocalStorageJson<PeriodoPersistPayload>(PERIODO_STORAGE_KEY, {});
  const entry = all[normEmpresaChave(companyName)];
  if (entry && typeof entry.de === 'string' && typeof entry.ate === 'string' && entry.de && entry.ate) {
    return { de: entry.de, ate: entry.ate };
  }
  return null;
}

function salvarPeriodo(companyName: string, periodo: PeriodoSalvo | null): void {
  if (!companyName) return;
  const all = readPersistedLocalStorageJson<PeriodoPersistPayload>(PERIODO_STORAGE_KEY, {});
  const key = normEmpresaChave(companyName);
  if (!periodo) {
    delete all[key];
  } else {
    all[key] = periodo;
  }
  writePersistedLocalStorageJson(PERIODO_STORAGE_KEY, all);
}

export default function BalanceteTabPanel({
  selectedCompany,
  planoContas,
  razaoRows,
  onRazaoRowsChange,
  folhaRelatorio = [],
  importedTxts = [],
  onDeleteImportedTxt,
  origensBalancete = [],
  onExcluirOrigemBalancete,
  onPeriodoConfirmadoChange,
  importedLogs = [],
}: BalanceteTabPanelProps) {
  const [showTxtsModal, setShowTxtsModal] = useState(false);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [periodoDe, setPeriodoDe] = useState('');
  const [periodoAte, setPeriodoAte] = useState('');
  const [periodoConfirmado, setPeriodoConfirmado] = useState<{ de: string; ate: string } | null>(null);
  const [periodToolbar, setPeriodToolbar] = useState<React.ReactNode>(null);
  const razaoLenAnterior = useRef(0);
  /** Usuário clicou OK/Limpar — não sobrescrever De/Até em imports seguintes. */
  const periodoManualRef = useRef(false);
  const onPeriodoConfirmadoChangeRef = useRef(onPeriodoConfirmadoChange);
  onPeriodoConfirmadoChangeRef.current = onPeriodoConfirmadoChange;

  const planoVision = useMemo(() => accountPlansToVisionPlano(planoContas), [planoContas]);
  const folhaVision = useMemo(() => folhaRelatorioToVision(folhaRelatorio), [folhaRelatorio]);
  const periodoRazao = useMemo(() => extrairPeriodoRazao(razaoRows), [razaoRows]);

  /**
   * Meses de cada TXT importado, calculados ao vivo a partir dos lançamentos que
   * ainda existem em razaoRows (por importId) — em vez do valor congelado no
   * momento do import. Evita a divergência entre o modal ("TXTs Importados") e o
   * balancete real quando lançamentos são apagados/substituídos depois (exclusão
   * de período, reimportação, etc.).
   */
  const mesesPorImportId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of razaoRows) {
      if (!row.importId || !row.data) continue;
      const parts = row.data.split('/');
      if (parts.length !== 3) continue;
      const mes = `${parts[1]}/${parts[2]}`;
      const set = map.get(row.importId) ?? [];
      if (!set.includes(mes)) set.push(mes);
      map.set(row.importId, set);
    }
    for (const [id, meses] of map) {
      map.set(
        id,
        meses.sort((a, b) => {
          const [ma, ya] = a.split('/');
          const [mb, yb] = b.split('/');
          return ya === yb ? ma.localeCompare(mb) : ya.localeCompare(yb);
        }),
      );
    }
    return map;
  }, [razaoRows]);

  /**
   * A sincronização com o backend (Docker/Eye Vision) é assíncrona e só termina
   * alguns segundos depois do boot da página — dispara "contabilfacil:data-hydrated"
   * quando conclui. Sem isso, a leitura abaixo roda ANTES do período salvo chegar
   * na memória e sempre encontra vazio, mesmo já tendo sido salvo antes do reload.
   */
  const [hydrationTick, setHydrationTick] = useState(0);
  useEffect(() => {
    const onHydrated = () => setHydrationTick((n) => n + 1);
    window.addEventListener('contabilfacil:data-hydrated', onHydrated);
    return () => window.removeEventListener('contabilfacil:data-hydrated', onHydrated);
  }, []);

  useEffect(() => {
    razaoLenAnterior.current = 0;
    setPeriodToolbar(null);
  }, [selectedCompany]);

  useEffect(() => {
    // Restaura a última data De/Até acessada pelo usuário nesta empresa —
    // sobrevive a "Atualizar" e a recargas da página. Só cai no intervalo
    // min–max automático se não houver nada salvo.
    const salvo = lerPeriodoSalvo(selectedCompany);
    if (salvo) {
      periodoManualRef.current = true;
      setPeriodoDe(salvo.de);
      setPeriodoAte(salvo.ate);
      setPeriodoConfirmado(salvo);
    } else {
      periodoManualRef.current = false;
      setPeriodoDe('');
      setPeriodoAte('');
      setPeriodoConfirmado(null);
    }
  }, [selectedCompany, hydrationTick]);

  useEffect(() => {
    onPeriodoConfirmadoChangeRef.current?.(periodoConfirmado);
  }, [periodoConfirmado]);

  /** Após importar TXT ou carregar razão salvo, aplica o intervalo min–max automaticamente
   *  — só quando o usuário nunca definiu (ou tinha salvo) um período nesta empresa. */
  useEffect(() => {
    if (razaoRows.length === 0) {
      razaoLenAnterior.current = 0;
      return;
    }
    const { min, max } = periodoRazao;
    if (!min || !max) return;

    const len = razaoRows.length;
    const primeiraCarga = razaoLenAnterior.current === 0 && len > 0;
    razaoLenAnterior.current = len;

    if (primeiraCarga && !periodoManualRef.current) {
      setPeriodoDe(min);
      setPeriodoAte(max);
      setPeriodoConfirmado({ de: min, ate: max });
      salvarPeriodo(selectedCompany, { de: min, ate: max });
    }
  }, [razaoRows, periodoRazao.min, periodoRazao.max, selectedCompany]);

  const aplicarPeriodo = useCallback(() => {
    const de = periodoDe.trim();
    const ate = periodoAte.trim();
    if (!de || !ate) {
      window.alert('Informe a data De e a data Até para exibir o balancete.');
      return;
    }
    const tDe = parseBrDateToTime(de);
    const tAte = parseBrDateToTime(ate);
    if (tDe === null || tAte === null) {
      window.alert('Datas inválidas. Use o formato DD/MM/AAAA (ex.: 01/12/2024).');
      return;
    }
    if (tDe > tAte) {
      window.alert('A data De não pode ser posterior à data Até.');
      return;
    }
    periodoManualRef.current = true;
    setPeriodoConfirmado({ de, ate });
    salvarPeriodo(selectedCompany, { de, ate });
  }, [periodoDe, periodoAte, selectedCompany]);

  /**
   * "Limpar" esvazia só os campos De/Até.
   *
   * Antes ele também zerava `periodoConfirmado`, e como TODO o resto da aba
   * (balancete, Configuração, Exportar PDF, PDF Invertidas, Aplicar Automações)
   * só é montado quando existe período confirmado, a tela inteira sumia: sobrava
   * a barra de datas e nada mais. Limpar os campos para digitar outro período não
   * é motivo para desmontar a aba — o balancete segue no período atual até o
   * usuário informar um novo e clicar em OK.
   */
  const limparPeriodo = useCallback(() => {
    periodoManualRef.current = false;
    setPeriodoDe('');
    setPeriodoAte('');
  }, []);

  const temRazao = razaoRows.length > 0;
  const temPlano = planoContas.length > 0;

  return (
    <div className="space-y-6">
      <div className="p-4 bg-brand-sidebar/35 border border-brand-border text-xs flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 min-w-0">
        <div className="min-w-0">
          <span className="font-bold">Balancete</span>
          <p className="opacity-60 text-[9px]">
            De/Até é só a janela do filtro. As colunas do comparativo ignoram meses/anos sem
            lançamento (D/C) — ex.: De 26/06/2001 e Até 26/06/2029 com movimento só em 06/2026 →
            aparece só a coluna 06/2026.
          </p>
        </div>
        <div className="flex flex-col gap-2 shrink-0 self-start sm:self-center">
          <div className="text-[10px] bg-red-800 text-white font-mono px-2 py-0.5 animate-pulse rounded-none border border-red-950">
            REGRA REVERSA: Naturezas invertidas em vermelho forte
          </div>
        </div>
      </div>

      {/* O filtro de período fica sempre visível, mesmo sem razão/plano
          importados: esconder o painel deixava a aba sem nenhuma opção à mostra. */}
      <div
        className={cn(
          'technical-panel p-4 space-y-3 min-w-0',
          !periodoConfirmado && 'border-amber-600/50 bg-amber-50/30',
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Filter size={14} className="opacity-50" />
          <span className="text-[10px] font-black uppercase tracking-widest">
            Período <span className="text-amber-700">*</span>
          </span>
          {temRazao && (
            <span className="text-[9px] font-mono bg-brand-border text-brand-bg px-2 py-0.5 font-bold">
              {razaoRows.length.toLocaleString('pt-BR')} lançamento(s) no razão
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-3">

          <div>
            <label className="text-[9px] font-bold uppercase tracking-wider opacity-60 mb-1 block">De</label>
            <input aria-label="De"
              type="date"
              value={brToDate(periodoDe)}
              onChange={(e) => setPeriodoDe(dateToBr(e.target.value))}
              className="w-40 border border-brand-border bg-brand-bg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand-border"
            />
          </div>
          <div>
            <label className="text-[9px] font-bold uppercase tracking-wider opacity-60 mb-1 block">Até</label>
            <input aria-label="Até"
              type="date"
              value={brToDate(periodoAte)}
              onChange={(e) => setPeriodoAte(dateToBr(e.target.value))}
              className="w-40 border border-brand-border bg-brand-bg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand-border"
            />
          </div>
          <button
            type="button"
            onClick={aplicarPeriodo}
            disabled={!periodoDe.trim() || !periodoAte.trim()}
            className="technical-button-primary px-4 py-2 text-[10px] font-black uppercase disabled:opacity-40"
          >
            OK
          </button>
          {(periodoDe || periodoAte || periodoConfirmado) && (
            <button
              type="button"
              onClick={limparPeriodo}
              className="technical-button-secondary px-3 py-2 text-[10px] font-bold uppercase"
            >
              Limpar
            </button>
          )}
        </div>
        {periodToolbar && (
          <div className="w-full min-w-0">{periodToolbar}</div>
        )}
        {periodoRazao.min && periodoRazao.max ? (
          <p className="text-[9px] font-mono text-slate-600">
            Lançamentos no razão: <strong>{periodoRazao.min}</strong> a{' '}
            <strong>{periodoRazao.max}</strong>
            {!periodoConfirmado ? ' — confirme De/Até e clique OK' : ' · colunas só nesses meses com movimento'}
          </p>
        ) : null}
      </div>

      {!temRazao && !temPlano && (
        <div className="technical-panel p-12 text-center text-[10px] font-bold uppercase tracking-widest text-slate-400">
          Importe o plano de contas e os lançamentos (TXT Domínio) para montar o balancete.
        </div>
      )}

      {temRazao && !periodoConfirmado && (
        <div className="technical-panel p-10 text-center space-y-3 border-amber-600/40 bg-amber-50/20">
          <Calendar size={32} className="mx-auto opacity-40" />
          <p className="text-sm font-black uppercase tracking-tight">Montando balancete…</p>
          <p className="text-[10px] opacity-70 max-w-md mx-auto leading-relaxed">
            {razaoRows.length.toLocaleString('pt-BR')} lançamento(s) importado(s).
            {periodoRazao.min && periodoRazao.max ? (
              <>
                {' '}
                Período detectado: <strong>{periodoRazao.min}</strong> a <strong>{periodoRazao.max}</strong>.
              </>
            ) : (
              <> Informe <strong>De</strong> e <strong>Até</strong> e clique em <strong>OK</strong>.</>
            )}
          </p>
        </div>
      )}

      {(
        // Monta mesmo com razão vazio/zerado (não só quando temRazao): é este
        // componente que empurra a toolbar (Configuração/Exportar PDF/PDF
        // Invertidas/Aplicar Automações) pro slot acima via setPeriodToolbar,
        // ANTES do seu próprio "early return" de tela vazia — sem montar, a
        // toolbar inteira sumia junto com o balancete zerado.
        // Fica visível mesmo sem período confirmado e sem lançamentos: o
        // comparativo mostra um aviso no topo e mantém todas as opções
        // (filtros, busca, tela cheia, configurações) à mostra.
        <div className="-mx-4 md:-mx-6 -mb-4 md:-mb-6">
          <ContabilBalanceteComparativo
            razaoRows={razaoRows}
            planoRows={planoVision}
            onRazaoRowsChange={onRazaoRowsChange}
            periodoDe={periodoConfirmado?.de ?? periodoRazao.min ?? ''}
            periodoAte={periodoConfirmado?.ate ?? periodoRazao.max ?? ''}
            folhaRows={folhaVision}
            fiscalRows={[]}
            empresaNome={selectedCompany}
            setPeriodToolbar={setPeriodToolbar}
            docsImportadosCount={importedTxts.length + origensBalancete.length}
            onAbrirDocsImportados={() => setShowTxtsModal(true)}
            importedLogs={importedLogs}
            onAbrirLogs={() => setShowLogsModal(true)}
          />
        </div>
      )}

      {showTxtsModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="technical-panel w-full max-w-2xl bg-brand-bg shadow-xl flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="p-4 border-b border-brand-border bg-brand-sidebar/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-brand-text" />
                <h2 className="text-xs font-black uppercase tracking-widest">
                  Docs. Importados no Balancete
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowTxtsModal(false)}
                className="text-brand-text/60 hover:text-brand-text p-1 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            
            {/* Body */}
            <div className="p-4 overflow-y-auto space-y-3 flex-1">
              <p className="text-[10px] opacity-75 leading-relaxed">
                Tudo o que entrou neste balancete: os arquivos importados e o que cada aba publicou.
                Excluir remove os lançamentos daquela origem, sem tocar nas demais.
              </p>

              {origensBalancete.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-brand-text/60">
                    Publicado pelas abas · {origensBalancete.length}
                  </p>
                  <div className="border border-brand-border divide-y divide-brand-border">
                    {origensBalancete.map((o) => (
                      <div
                        key={o.origem.id}
                        className="p-3 flex items-center justify-between gap-4 bg-brand-sidebar/5 hover:bg-brand-sidebar/10 transition-colors"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <FileCode size={14} className="opacity-70 shrink-0" />
                            <span className="text-xs font-mono font-bold truncate block">
                              {o.origem.rotulo}
                            </span>
                            <span className="text-[9px] uppercase font-bold text-brand-text/45 shrink-0">
                              aba {o.origem.aba}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-2 text-[9px] text-brand-text/60">
                            <span>
                              Lançamentos:{' '}
                              <strong className="font-mono text-brand-text">
                                {Math.round(o.linhas / 2).toLocaleString('pt-BR')}
                              </strong>
                            </span>
                            <span>·</span>
                            <span>
                              Meses:{' '}
                              <strong className="bg-brand-border text-brand-bg px-1 font-bold">
                                {o.meses.join(', ') || 'Sem data'}
                              </strong>
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Excluir do balancete tudo que veio de «${o.origem.rotulo}»?\n\n` +
                                  `${Math.round(o.linhas / 2)} lançamento(s) serão removidos do razão. ` +
                                  `Os dados na aba ${o.origem.aba} continuam lá — dá para publicar de novo.`,
                              )
                            ) {
                              onExcluirOrigemBalancete?.(o.origem.id);
                            }
                          }}
                          className="text-red-700 hover:text-red-600 hover:bg-red-50 p-1.5 border border-transparent hover:border-red-200 transition-all shrink-0"
                          title={`Excluir os lançamentos de ${o.origem.rotulo}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-[9px] font-black uppercase tracking-widest text-brand-text/60">
                Arquivos importados · {importedTxts.length}
              </p>
              
              {importedTxts.length === 0 ? (
                <div className="text-center py-6 text-[10px] uppercase font-bold text-slate-400">
                  Nenhum arquivo importado no momento.
                </div>
              ) : (
                <div className="border border-brand-border divide-y divide-brand-border">
                  {importedTxts.map((txt) => (
                    <div key={txt.id} className="p-3 flex items-center justify-between gap-4 bg-brand-sidebar/5 hover:bg-brand-sidebar/10 transition-colors">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <FileCode size={14} className="opacity-70 shrink-0" />
                          <span className="text-xs font-mono font-bold truncate block">{txt.filename}</span>
                        </div>
                        <div className="flex flex-wrap gap-2 text-[9px] text-brand-text/60">
                          <span>Importado em: <strong className="font-mono text-brand-text">{txt.importedAt}</strong></span>
                          <span>·</span>
                          <span>Meses: <strong className="bg-brand-border text-brand-bg px-1 font-bold">{(mesesPorImportId.get(txt.id) ?? []).join(', ') || 'Sem lançamentos'}</strong></span>
                        </div>
                      </div>
                      
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Tem certeza que deseja excluir o arquivo "${txt.filename}"? Os lançamentos deste arquivo serão removidos.`)) {
                            onDeleteImportedTxt?.(txt.id);
                          }
                        }}
                        className="text-red-700 hover:text-red-600 hover:bg-red-50 p-1.5 border border-transparent hover:border-red-200 transition-all shrink-0"
                        title="Excluir do balancete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            {/* Footer */}
            <div className="p-3 border-t border-brand-border bg-brand-sidebar/10 flex justify-end">
              <button
                type="button"
                onClick={() => setShowTxtsModal(false)}
                className="technical-button px-4 py-1.5 text-[10px] font-black uppercase"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {showLogsModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="technical-panel w-full max-w-2xl bg-brand-bg shadow-xl flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="p-4 border-b border-brand-border bg-brand-sidebar/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileCode size={16} className="text-brand-text" />
                <h2 className="text-xs font-black uppercase tracking-widest">
                  Logs da Importação
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowLogsModal(false)}
                className="text-brand-text/60 hover:text-brand-text p-1 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 overflow-y-auto space-y-2 flex-1 font-mono text-[9px]">
              {importedLogs.length === 0 ? (
                <div className="text-center py-6 text-[10px] uppercase font-bold text-slate-400">
                  Nenhum log disponível no momento.
                </div>
              ) : (
                importedLogs.map((log, idx) => (
                  <div key={idx} className="text-brand-text/70 leading-relaxed whitespace-pre-wrap break-words">
                    {log}
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-brand-border bg-brand-sidebar/10 flex justify-end">
              <button
                type="button"
                onClick={() => setShowLogsModal(false)}
                className="technical-button px-4 py-1.5 text-[10px] font-black uppercase"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
