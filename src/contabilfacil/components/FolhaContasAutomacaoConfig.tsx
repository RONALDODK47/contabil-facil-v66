import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Plus, Trash2, Pencil, Check, X as XIcon, Save, Layers, Info } from 'lucide-react';
import { cn } from '../lib/utils';
import { CF_FORM_INPUT_LONG } from '../lib/formFieldClasses';
import {
  loadFolhaRegras,
  saveFolhaRegras,
  addFolhaRegra,
  removeFolhaRegra,
  updateFolhaRegra,
  type FolhaRegra,
} from '../logic/folhaContasAutomacaoStorage';
import { construirHistoricosFolha } from '../logic/folhaContasAutomacaoStorage';
// `FolhaHistoricoOpcao` estende ExtratoHistoricoPadrao com o destino — o picker só lê os campos comuns.
import ExtratoContaPicker, { type ExtratoPlanoContaOption } from './ExtratoContaPicker';
import ExtratoHistoricoPicker from './ExtratoHistoricoPicker';
import { normalizeExtratoMatchText } from '../logic/extratoRegrasContasStorage';
import {
  agruparRubricasPorDestino,
  classificarRubricaDestino,
  folhaDestinoLabel,
  getFolhaDestino,
  type FolhaDestinoDef,
  type FolhaDestinoId,
} from '../logic/folhaRubricaTaxonomia';
import { Repeat } from 'lucide-react';

const INPUT_CLS = cn(
  CF_FORM_INPUT_LONG,
  'max-w-none w-full h-[26px] text-[10px] uppercase font-mono border-brand-border bg-white',
);

type FolhaHistoricoSample = {
  description: string;
  /** Tipo da rubrica — determina a natureza contábil exibida no picker. */
  tipo?: 'PROVENTOS' | 'DESCONTOS' | 'INFORMATIVA';
};

type Props = {
  selectedCompany: string;
  /** Amostras de lançamentos da folha importada — alimenta o seletor "Puxar histórico". */
  folhaRelatorio?: FolhaHistoricoSample[];
  /** Contas analíticas para seleção (sem sintéticas filtradas). */
  planoOptions?: ExtratoPlanoContaOption[];
  /** Plano completo incluindo sintéticas — usado para exibir hierarquia no picker (igual conciliação). */
  planoLookupOptions?: ExtratoPlanoContaOption[];
  onChange?: (regras: FolhaRegra[]) => void;
};

// ---------------------------------------------------------------------------
// Linha editável inline
// ---------------------------------------------------------------------------
type EditableRowProps = {
  regra: FolhaRegra;
  planoOptions: ExtratoPlanoContaOption[];
  planoLookup: ExtratoPlanoContaOption[];
  onSave: (id: string, patch: Partial<Omit<FolhaRegra, 'id'>>) => void;
  onRemove: (id: string) => void;
};

const FolhaRegraEditableRow = memo(function FolhaRegraEditableRow({
  regra,
  planoOptions,
  planoLookup,
  onSave,
  onRemove,
}: EditableRowProps) {
  const [editing, setEditing] = useState(false);
  const [descDraft, setDescDraft] = useState(regra.descricao);
  const [debitoDraft, setDebitoDraft] = useState(regra.contaDebito);
  const [creditoDraft, setCreditoDraft] = useState(regra.contaCredito);

  // Reset drafts when editing starts
  const startEdit = () => {
    setDescDraft(regra.descricao);
    setDebitoDraft(regra.contaDebito);
    setCreditoDraft(regra.contaCredito);
    setEditing(true);
  };

  const commitEdit = () => {
    const desc = descDraft.trim();
    const deb = debitoDraft.trim();
    const cred = creditoDraft.trim();
    if (desc && deb && cred) {
      onSave(regra.id, { descricao: desc, contaDebito: deb, contaCredito: cred });
    }
    setEditing(false);
  };

  const cancelEdit = () => setEditing(false);

  return (
    <li className="border border-brand-border/40 p-2.5 bg-white space-y-2">
      {editing ? (
        <>
          <div>
            <label className="text-[8px] font-bold uppercase text-brand-text/45 block mb-0.5">
              Histórico / Descrição
            </label>
            <input
              type="text"
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              className={INPUT_CLS}
              aria-label="Histórico da regra"
              onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 min-w-0">
              <label className="text-[8px] font-bold uppercase text-rose-700/70 block mb-0.5">
                Conta Débito
              </label>
              {planoOptions.length > 0 ? (
                <ExtratoContaPicker
                  value={debitoDraft}
                  options={planoOptions}
                  lookupOptions={planoLookup}
                  showNomeInline
                  includeSinteticas
                  placeholder="Cód. Débito"
                  ariaLabel="Conta débito da regra"
                  onChange={setDebitoDraft}
                />
              ) : (
                <input
                  type="text"
                  value={debitoDraft}
                  onChange={(e) => setDebitoDraft(e.target.value)}
                  placeholder="Cód. Débito"
                  className={INPUT_CLS}
                />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <label className="text-[8px] font-bold uppercase text-emerald-700/70 block mb-0.5">
                Conta Crédito
              </label>
              {planoOptions.length > 0 ? (
                <ExtratoContaPicker
                  value={creditoDraft}
                  options={planoOptions}
                  lookupOptions={planoLookup}
                  showNomeInline
                  includeSinteticas
                  placeholder="Cód. Crédito"
                  ariaLabel="Conta crédito da regra"
                  onChange={setCreditoDraft}
                />
              ) : (
                <input
                  type="text"
                  value={creditoDraft}
                  onChange={(e) => setCreditoDraft(e.target.value)}
                  placeholder="Cód. Crédito"
                  className={INPUT_CLS}
                />
              )}
            </div>
            <div className="flex gap-1 shrink-0">
              <button
                type="button"
                onClick={commitEdit}
                className="technical-button text-[8px] py-1 px-2 inline-flex items-center gap-1 text-emerald-800 border-emerald-300 hover:bg-emerald-50"
              >
                <Check size={11} /> Salvar
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className="technical-button text-[8px] py-1 px-2 inline-flex items-center gap-1"
              >
                <XIcon size={11} />
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0 space-y-0.5">
            <p className="text-[10px] font-bold font-mono uppercase truncate text-brand-text" title={regra.descricao}>
              {regra.descricao}
            </p>
            {regra.destino && (
              <p className="text-[8px] font-black uppercase tracking-wider text-indigo-700 inline-flex items-center gap-1">
                <Layers size={9} aria-hidden /> Histórico único ·{' '}
                {folhaDestinoLabel(regra.destino)}
              </p>
            )}
            {regra.destino && getFolhaDestino(regra.destino)?.compensaAutomaticamenteCom ? (
              <p className="text-[8px] font-black uppercase tracking-wider text-amber-800 inline-flex items-center gap-1">
                <Repeat size={9} aria-hidden /> Gera lançamento de compensação
              </p>
            ) : null}
            <p className="text-[8px] font-mono text-brand-text/55">
              <span className="text-rose-700 font-bold">D: {regra.contaDebito}</span>
              <span className="mx-1.5 text-brand-text/30">·</span>
              <span className="text-emerald-700 font-bold">C: {regra.contaCredito}</span>
            </p>
          </div>
          <div className="flex gap-1 shrink-0">
            <button
              type="button"
              onClick={startEdit}
              className="technical-button text-[8px] py-1 px-2 inline-flex items-center gap-1"
            >
              <Pencil size={10} /> Editar
            </button>
            <button
              type="button"
              onClick={() => onRemove(regra.id)}
              className="technical-button text-[8px] py-1 px-2 inline-flex items-center gap-1 text-rose-800 border-rose-300 hover:bg-rose-50"
            >
              <Trash2 size={10} />
            </button>
          </div>
        </div>
      )}
    </li>
  );
});

// ---------------------------------------------------------------------------
// Painel principal
// ---------------------------------------------------------------------------
export default function FolhaContasAutomacaoPanel({
  selectedCompany,
  folhaRelatorio = [],
  planoOptions = [],
  planoLookupOptions,
  onChange,
}: Props) {
  const [regras, setRegras] = useState<FolhaRegra[]>(() => loadFolhaRegras(selectedCompany));

  // Reload when company changes
  useEffect(() => {
    const loaded = loadFolhaRegras(selectedCompany);
    setRegras(loaded);
    onChange?.(loaded);
  }, [selectedCompany, onChange]);

  const persist = useCallback(
    (next: FolhaRegra[]) => {
      setRegras(next);
      onChange?.(next);
    },
    [onChange],
  );

  // --- Draft state for new rule form ---
  const [draftDesc, setDraftDesc] = useState('');
  const [draftDebito, setDraftDebito] = useState('');
  const [draftCredito, setDraftCredito] = useState('');
  const [historicoPick, setHistoricoPick] = useState('');
  const [draftDestino, setDraftDestino] = useState<FolhaDestinoId | null>(null);
  const [addError, setAddError] = useState('');
  const [savedOk, setSavedOk] = useState(false);

  const destinoSelecionado: FolhaDestinoDef | undefined = draftDestino
    ? getFolhaDestino(draftDestino)
    : undefined;

  /**
   * Históricos únicos detectados na folha importada. Cada entrada reúne TODAS as rubricas cujo
   * lançamento vai para o mesmo par débito/crédito — salário base, saldo de salário, DSR,
   * hora extra e gratificação viram uma linha só, com um débito e um crédito a informar.
   */
  const destinosDetectados = useMemo(() => {
    const destinos = agruparRubricasPorDestino(
      folhaRelatorio.map((r) => ({ descricao: String(r.description ?? ''), tipo: r.tipo })),
    );
    return destinos.map((d) => ({
      ...d,
      /** Já existe histórico único cadastrado para este destino? */
      coberto: regras.some((r) => r.destino === d.destino.id),
    }));
  }, [folhaRelatorio, regras]);

  /**
   * Opções do seletor "Puxar histórico da folha" — já consolidadas por destino contábil
   * (ver `construirHistoricosFolha`), e não uma linha por rubrica.
   */
  const padroesHistorico = useMemo(
    () => construirHistoricosFolha(folhaRelatorio, regras),
    [folhaRelatorio, regras],
  );

  /** Descrição exibida no seletor → destino, para saber o que foi escolhido. */
  const destinoPorLabel = useMemo(() => {
    const map = new Map<string, FolhaDestinoId>();
    for (const opcao of padroesHistorico) {
      if (opcao.destino) map.set(opcao.descricao, opcao.destino);
    }
    return map;
  }, [padroesHistorico]);

  const handleAdd = useCallback(() => {
    const desc = draftDesc.trim();
    const deb = draftDebito.trim();
    const cred = draftCredito.trim();
    if (!desc) { setAddError('Informe o histórico / descrição.'); return; }
    if (!deb) { setAddError('Informe a conta débito.'); return; }
    if (!cred) { setAddError('Informe a conta crédito.'); return; }
    setAddError('');
    persist(
      addFolhaRegra(selectedCompany, {
        descricao: desc,
        contaDebito: deb,
        contaCredito: cred,
        ...(draftDestino ? { destino: draftDestino } : {}),
      }),
    );
    setDraftDesc('');
    setDraftDebito('');
    setDraftCredito('');
    setHistoricoPick('');
    setDraftDestino(null);
  }, [draftDesc, draftDebito, draftCredito, draftDestino, persist, selectedCompany]);

  /** Carrega um histórico único no formulário — só faltam as duas contas. */
  const handlePickDestino = useCallback((destino: FolhaDestinoDef) => {
    setDraftDestino(destino.id);
    setDraftDesc(destino.label);
    setHistoricoPick('');
    setAddError('');
  }, []);

  const handleClearDestino = useCallback(() => {
    setDraftDestino(null);
    setDraftDesc('');
  }, []);

  const handleSave = useCallback(
    (id: string, patch: Partial<Omit<FolhaRegra, 'id'>>) => {
      persist(updateFolhaRegra(selectedCompany, id, patch));
    },
    [persist, selectedCompany],
  );

  const handleRemove = useCallback(
    (id: string) => {
      persist(removeFolhaRegra(selectedCompany, id));
    },
    [persist, selectedCompany],
  );

  const handleRemoveAll = () => {
    if (regras.length === 0) return;
    if (!window.confirm(`Remover todas as ${regras.length} regra(s) da folha? Essa ação não pode ser desfeita.`)) return;
    persist(saveFolhaRegras(selectedCompany, []));
  };

  const handleSalvar = () => {
    saveFolhaRegras(selectedCompany, regras);
    setSavedOk(true);
    setTimeout(() => setSavedOk(false), 2000);
  };

  return (
    <div className="technical-panel shadow-[4px_4px_0_0_#141414] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-brand-border bg-brand-sidebar/30 flex items-center gap-2">
        <BookOpen size={14} className="opacity-60 shrink-0" />
        <div>
          <h3 className="text-[10px] font-black uppercase tracking-widest">Regras de contas — Folha</h3>
          <p className="text-[9px] font-bold uppercase opacity-50 mt-0.5">
            Puxe o histórico ou digite e informe débito + crédito por rubrica.
          </p>
        </div>
      </div>

      {/* Formulário de Nova Regra */}
      <div className="p-4 border-b border-brand-border/40 bg-brand-sidebar/10 space-y-3">
        <p className="text-[9px] font-black uppercase tracking-widest text-brand-text/60">Nova regra</p>

        {/* Histórico selecionado — mostra o que ele cobre e a contrapartida esperada */}
        {destinoSelecionado && (
          <div className="max-w-2xl border border-indigo-300 bg-indigo-50/60 p-2.5 space-y-1">
            <div className="flex items-start gap-2">
              <Info size={11} className="text-indigo-700 shrink-0 mt-0.5" aria-hidden />
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-[9px] font-black uppercase tracking-wider text-indigo-900">
                  Histórico único · {destinoSelecionado.label}
                </p>
                <p className="text-[9px] text-brand-text/70 leading-relaxed">{destinoSelecionado.descricao}</p>
                <p className="text-[8px] font-mono uppercase text-brand-text/60">
                  <span className="text-rose-700 font-bold">D: {destinoSelecionado.sugestaoDebito}</span>
                  <span className="mx-1.5 text-brand-text/30">·</span>
                  <span className="text-emerald-700 font-bold">C: {destinoSelecionado.sugestaoCredito}</span>
                </p>
                {destinoSelecionado.compensaAutomaticamenteCom ? (
                  <p className="text-[8px] text-amber-800 leading-relaxed flex items-start gap-1">
                    <Repeat size={9} className="shrink-0 mt-0.5" aria-hidden />
                    <span>
                      Gera também um lançamento de compensação: a conta de débito desta regra é
                      zerada contra a conta de recolhimento de «
                      {folhaDestinoLabel(destinoSelecionado.compensaAutomaticamenteCom)}». Cadastre
                      esse histórico também, senão a conta a recuperar fica com saldo.
                    </span>
                  </p>
                ) : null}
                {(() => {
                  const detectado = destinosDetectados.find((d) => d.destino.id === destinoSelecionado.id);
                  if (!detectado || detectado.rubricas.length === 0) return null;
                  return (
                    <p className="text-[8px] text-brand-text/55 font-mono leading-relaxed">
                      Cobre {detectado.rubricas.length} rubrica(s) desta folha: {detectado.rubricas.join(' · ')}
                    </p>
                  );
                })()}
              </div>
              <button
                type="button"
                onClick={handleClearDestino}
                className="technical-button text-[8px] py-0.5 px-1.5 shrink-0"
                aria-label="Remover histórico selecionado"
              >
                <XIcon size={10} />
              </button>
            </div>
          </div>
        )}

        {/* Historico picker */}
        {padroesHistorico.length > 0 && (
          <div className="space-y-1 max-w-2xl">
            <label className="text-[8px] font-bold uppercase text-brand-text/50 block">
              Puxar histórico da folha ({padroesHistorico.length} sem regra)
            </label>
            <p className="text-[8px] text-brand-text/45 leading-relaxed">
              As rubricas já vêm agrupadas: cada histórico reúne todos os lançamentos que vão
              para o mesmo débito e crédito. Só aparecem separadas as rubricas que o sistema
              não conseguiu classificar.
            </p>
            <ExtratoHistoricoPicker
              padroes={padroesHistorico}
              value={historicoPick}
              placeholder="Buscar histórico da folha…"
              onSelect={(hit) => {
                setHistoricoPick(`${hit.nature}|${hit.descricao}`);
                setDraftDesc(hit.descricao);
                // Histórico consolidado → a regra vale para o destino inteiro; rubrica avulsa
                // (não classificada) → regra por texto, como antes.
                setDraftDestino(destinoPorLabel.get(hit.descricao) ?? null);
                setAddError('');
              }}
              onClear={() => {
                setHistoricoPick('');
                setDraftDesc('');
              }}
            />
          </div>
        )}

        {/* Historico manual */}
        <div className="space-y-1 max-w-2xl">
          <label className="text-[8px] font-bold uppercase text-brand-text/50 block">
            Histórico / Descrição (texto que identifica o lançamento)
          </label>
          <input
            type="text"
            value={draftDesc}
            onChange={(e) => { setDraftDesc(e.target.value); setHistoricoPick(''); setDraftDestino(null); setAddError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
            placeholder="Ex.: SALÁRIOS, INSS, FGTS, PROLABORE…"
            className={INPUT_CLS}
            aria-label="Histórico da nova regra"
          />
        </div>

        {/* Debito + Credito + ADD */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end max-w-2xl">
          <div className="flex-1 min-w-[160px]">
            <div className="grid grid-cols-[minmax(64px,1fr)_minmax(0,2fr)] gap-1 mb-0.5">
              <p className="text-[8px] font-bold uppercase text-rose-700/70">Cód. débito</p>
              <p className="text-[8px] font-bold uppercase text-brand-text/40">Conta</p>
            </div>
            {planoOptions.length > 0 ? (
              <ExtratoContaPicker
                value={draftDebito}
                options={planoOptions}
                lookupOptions={planoLookupOptions ?? planoOptions}
                showNomeInline
                includeSinteticas
                placeholder="Cód. Débito"
                ariaLabel="Conta débito (nova regra)"
                onChange={(code) => { setDraftDebito(code); setAddError(''); }}
              />
            ) : (
              <input
                type="text"
                value={draftDebito}
                onChange={(e) => { setDraftDebito(e.target.value); setAddError(''); }}
                placeholder="Cód. Débito"
                className={INPUT_CLS}
                aria-label="Conta débito"
              />
            )}
          </div>

          <div className="flex-1 min-w-[160px]">
            <div className="grid grid-cols-[minmax(64px,1fr)_minmax(0,2fr)] gap-1 mb-0.5">
              <p className="text-[8px] font-bold uppercase text-emerald-700/70">Cód. crédito</p>
              <p className="text-[8px] font-bold uppercase text-brand-text/40">Conta</p>
            </div>
            {planoOptions.length > 0 ? (
              <ExtratoContaPicker
                value={draftCredito}
                options={planoOptions}
                lookupOptions={planoLookupOptions ?? planoOptions}
                showNomeInline
                includeSinteticas
                placeholder="Cód. Crédito"
                ariaLabel="Conta crédito (nova regra)"
                onChange={(code) => { setDraftCredito(code); setAddError(''); }}
              />
            ) : (
              <input
                type="text"
                value={draftCredito}
                onChange={(e) => { setDraftCredito(e.target.value); setAddError(''); }}
                placeholder="Cód. Crédito"
                className={INPUT_CLS}
                aria-label="Conta crédito"
              />
            )}
          </div>

          <button
            type="button"
            onClick={handleAdd}
            disabled={!draftDesc.trim() || !draftDebito.trim() || !draftCredito.trim()}
            className="technical-button-primary text-[9px] py-1 px-4 shrink-0 inline-flex items-center justify-center gap-1 disabled:opacity-40 min-h-[26px] w-full sm:w-auto"
          >
            <Plus size={12} aria-hidden />
            ADD
          </button>
        </div>

        {addError && (
          <p className="text-[9px] text-rose-700 font-bold uppercase">{addError}</p>
        )}
      </div>

      {/* Lista de regras */}
      <div className="p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-brand-text/60">
            Regras cadastradas · {regras.length}
          </p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleSalvar}
              className={cn(
                'technical-button text-[8px] py-1 px-2 inline-flex items-center gap-1 font-bold',
                savedOk
                  ? 'text-emerald-800 border-emerald-400 bg-emerald-50'
                  : 'text-brand-text border-brand-border',
              )}
              title="Salvar todas as regras"
            >
              {savedOk ? <Check size={11} /> : <Save size={11} />}
              {savedOk ? 'Salvo!' : 'Salvar regras'}
            </button>
            {regras.length > 0 && (
              <button
                type="button"
                onClick={handleRemoveAll}
                className="technical-button text-[8px] py-1 px-2 inline-flex items-center gap-1 text-rose-800 border-rose-300 hover:bg-rose-50"
              >
                <Trash2 size={11} /> Remover todas
              </button>
            )}
          </div>
        </div>

        {regras.length === 0 ? (
          <p className="text-[10px] text-brand-text/45 italic text-center py-8">
            Nenhuma regra cadastrada. Puxe um histórico da folha ou preencha o formulário acima.
          </p>
        ) : (
          <ul className="space-y-2 max-h-[560px] overflow-y-auto overscroll-contain pr-0.5">
            {regras.map((regra) => (
              <FolhaRegraEditableRow
                key={regra.id}
                regra={regra}
                planoOptions={planoOptions}
                planoLookup={planoLookupOptions ?? planoOptions}
                onSave={handleSave}
                onRemove={handleRemove}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
