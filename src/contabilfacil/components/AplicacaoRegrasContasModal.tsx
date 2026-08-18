import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ListOrdered, Plus, Trash2, X } from 'lucide-react';
import { cn } from '../lib/utils';
import type {
  AplicacaoRegraConta,
  AplicacaoRegraContaNature,
} from '../logic/aplicacaoRegrasContasStorage';
import {
  addAplicacaoRegraConta,
  filterAplicacaoRegrasPorConta,
  findAplicacaoLinhasSemRegra,
  normalizeAplicacaoRegraTexto,
  removeAplicacaoRegrasPorConta,
  saveAplicacaoRegrasContas,
} from '../logic/aplicacaoRegrasContasStorage';
import {
  isClassificacaoHierarquica,
  resolveCodigoReduzidoDoPlano,
  sanitizeCodigoReduzido,
} from '../logic/planoContasMapper';
import { readManagerData } from '../logic/companyWorkspace';
import { CF_FORM_INPUT_LONG } from '../lib/formFieldClasses';
import ExtratoContaPicker from './ExtratoContaPicker';
import ExtratoHistoricoPicker from './ExtratoHistoricoPicker';

type PlanoOption = {
  code: string;
  name: string;
  codigoReduzido?: string;
  tipo?: 'S' | 'A';
};

export type AplicacaoRegrasContasModalProps = {
  open: boolean;
  company: string;
  /** Conta de aplicação ativa — análogo da conta banco na conciliação bancária. */
  contaAplicacao: string;
  /** TODAS as regras da empresa — a filtragem por aplicação é feita aqui dentro. */
  regras: AplicacaoRegraConta[];
  /** Amostra do extrato da aplicação para puxar históricos sem regra. */
  extratoSample?: Array<{ description: string; nature: AplicacaoRegraContaNature; value: number }>;
  onClose: () => void;
  onChange: (next: AplicacaoRegraConta[]) => void;
};

const INPUT_CLS = cn(CF_FORM_INPUT_LONG, 'max-w-none w-full h-[26px] text-[10px] uppercase');
const CONTENT_MAX = 'w-full max-w-3xl mx-auto';

type RegraRowProps = {
  regra: AplicacaoRegraConta;
  planoOptions: PlanoOption[];
  planoLookup: PlanoOption[];
  onUpdate: (id: string, patch: Partial<Omit<AplicacaoRegraConta, 'id'>>) => void;
  onRemove: (id: string) => void;
};

const AplicacaoRegraEditableRow = memo(function AplicacaoRegraEditableRow({
  regra,
  planoOptions,
  planoLookup,
  onUpdate,
  onRemove,
}: RegraRowProps) {
  const [descricaoDraft, setDescricaoDraft] = useState(regra.descricao);

  useEffect(() => {
    setDescricaoDraft(regra.descricao);
  }, [regra.descricao]);

  const commitDescricao = useCallback(() => {
    const manual = descricaoDraft.trim();
    if (!normalizeAplicacaoRegraTexto(manual) || manual === regra.descricao) {
      setDescricaoDraft(regra.descricao);
      return;
    }
    onUpdate(regra.id, { descricao: manual, nome: manual.slice(0, 40) });
  }, [descricaoDraft, onUpdate, regra.descricao, regra.id]);

  return (
    <li className="border border-brand-border/40 p-2.5 bg-white space-y-2">
      <div className="space-y-2 max-w-2xl">
        <div className="min-w-0">
          <label
            htmlFor={`aplic-regra-desc-${regra.id}`}
            className="font-bold uppercase text-brand-text/45 block text-[8px] mb-0.5"
          >
            Histórico no extrato
          </label>
          <input
            id={`aplic-regra-desc-${regra.id}`}
            type="text"
            value={descricaoDraft}
            onChange={(e) => setDescricaoDraft(e.target.value)}
            onBlur={commitDescricao}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
            className={INPUT_CLS}
            aria-label={`Descrição da regra ${regra.descricao}`}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="w-full sm:w-[88px] shrink-0">
          <p className="font-bold uppercase text-brand-text/45 block text-[8px] mb-0.5">Natureza</p>
          <div className="grid grid-cols-2 border border-brand-border h-[26px]">
            <button
              type="button"
              onClick={() => onUpdate(regra.id, { nature: 'D' })}
              className={cn(
                'flex-1 text-[8px] font-black uppercase',
                regra.nature === 'D' ? 'bg-red-600 text-white' : 'bg-transparent',
              )}
              aria-pressed={regra.nature === 'D'}
            >
              Débito
            </button>
            <button
              type="button"
              onClick={() => onUpdate(regra.id, { nature: 'C' })}
              className={cn(
                'flex-1 text-[8px] font-black uppercase',
                regra.nature === 'C' ? 'bg-blue-600 text-white' : 'bg-transparent',
              )}
              aria-pressed={regra.nature === 'C'}
            >
              Crédito
            </button>
          </div>
        </div>
        <div className="w-full sm:flex-1 sm:min-w-[200px] sm:max-w-[340px]">
          <div className="grid grid-cols-[minmax(72px,1fr)_minmax(0,2fr)] gap-1 mb-0.5">
            <p className="font-bold uppercase text-brand-text/45 text-[8px]">Cód. reduzido</p>
            <p className="font-bold uppercase text-brand-text/45 text-[8px]">Descrição da conta</p>
          </div>
          <ExtratoContaPicker
            value={regra.contaContrapartida}
            options={planoOptions}
            lookupOptions={planoLookup}
            includeSinteticas
            showNomeInline
            placeholder="Código…"
            ariaLabel={`Contrapartida da regra ${regra.descricao}`}
            onChange={(code) => onUpdate(regra.id, { contaContrapartida: code })}
          />
          {isClassificacaoHierarquica(regra.contaContrapartida) ? (
            <span className="block text-[8px] text-rose-700 font-bold uppercase mt-0.5">
              Classificação inválida — use código reduzido
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => onRemove(regra.id)}
          className="technical-button text-[8px] py-1 px-2 inline-flex items-center justify-center gap-1 w-full sm:w-auto shrink-0 min-h-[26px]"
        >
          <Trash2 size={11} aria-hidden="true" />
          Remover
        </button>
      </div>
    </li>
  );
});

/**
 * Regras de conciliação de aplicações — MESMAS regras da conciliação de extrato
 * bancário (ExtratoRegrasContasModal): histórico + natureza D/C + uma contrapartida
 * em código reduzido. O lado fixo aqui é a conta de aplicação, no lugar do banco.
 */
export default memo(function AplicacaoRegrasContasModal({
  open,
  company,
  contaAplicacao,
  regras,
  extratoSample = [],
  onClose,
  onChange,
}: AplicacaoRegrasContasModalProps) {
  const [draftDescricao, setDraftDescricao] = useState('');
  const [draftNature, setDraftNature] = useState<AplicacaoRegraContaNature>('D');
  const [draftConta, setDraftConta] = useState('');
  const [addError, setAddError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [padraoHistoricoPick, setPadraoHistoricoPick] = useState('');

  const planoAll = useMemo<PlanoOption[]>(() => {
    if (!open || !company) return [];
    return readManagerData<PlanoOption>(company, 'plano').map((a) => ({
      code: a.code,
      name: a.name,
      codigoReduzido: a.codigoReduzido,
      tipo: a.tipo,
    }));
  }, [company, open]);

  const planoOptions = useMemo(() => planoAll.filter((a) => a.tipo !== 'S'), [planoAll]);

  useEffect(() => {
    if (!open) return;
    setDraftDescricao('');
    setDraftNature('D');
    setDraftConta('');
    setAddError('');
    setSearchTerm('');
    setPadraoHistoricoPick('');
  }, [open, contaAplicacao]);

  const toReduzido = useCallback(
    (code: string) => resolveCodigoReduzidoDoPlano(code, planoAll),
    [planoAll],
  );

  const regrasDaConta = useMemo(
    () => filterAplicacaoRegrasPorConta(regras, contaAplicacao),
    [regras, contaAplicacao],
  );

  const filteredRegras = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return regrasDaConta;
    return regrasDaConta.filter((r) =>
      `${r.descricao} ${r.nome} ${r.contaContrapartida}`.toLowerCase().includes(term),
    );
  }, [regrasDaConta, searchTerm]);

  const semRegra = useMemo(
    () => findAplicacaoLinhasSemRegra(extratoSample, regrasDaConta),
    [extratoSample, regrasDaConta],
  );

  const padroesHistorico = useMemo(() => {
    const map = new Map<
      string,
      { descricao: string; nature: AplicacaoRegraContaNature; ocorrencias: number }
    >();
    for (const row of semRegra) {
      const descricao = String(row.description ?? '').replace(/\s+/g, ' ').trim();
      if (!descricao) continue;
      const key = `${row.nature}|${descricao.toUpperCase()}`;
      const cur = map.get(key);
      if (cur) cur.ocorrencias += 1;
      else map.set(key, { descricao, nature: row.nature, ocorrencias: 1 });
    }
    return [...map.values()].sort((a, b) => b.ocorrencias - a.ocorrencias);
  }, [semRegra]);

  const handleAdd = useCallback(() => {
    const descricao = draftDescricao.trim();
    const contraRed = toReduzido(draftConta) || sanitizeCodigoReduzido(draftConta);
    if (!contaAplicacao.trim()) {
      setAddError('Selecione uma conta de aplicação primeiro!');
      return;
    }
    if (!normalizeAplicacaoRegraTexto(descricao)) {
      setAddError('Informe o histórico do extrato de aplicação!');
      return;
    }
    if (!contraRed) {
      setAddError(
        isClassificacaoHierarquica(draftConta)
          ? 'PROIBIDO usar classificação (ex.: 1.1.10.100.001). Selecione o CÓDIGO REDUZIDO.'
          : 'Informe o código reduzido da contrapartida.',
      );
      return;
    }
    setAddError('');
    onChange(
      addAplicacaoRegraConta(company, {
        nome: descricao.slice(0, 40),
        descricao,
        nature: draftNature,
        contaAplicacao,
        contaContrapartida: contraRed,
      }),
    );
    setDraftDescricao('');
    setDraftNature('D');
    setDraftConta('');
    setPadraoHistoricoPick('');
  }, [company, contaAplicacao, draftConta, draftDescricao, draftNature, onChange, toReduzido]);

  const handleRemove = useCallback(
    (id: string) => {
      onChange(saveAplicacaoRegrasContas(company, regras.filter((r) => r.id !== id)));
    },
    [company, onChange, regras],
  );

  const handleUpdate = useCallback(
    (id: string, patch: Partial<Omit<AplicacaoRegraConta, 'id'>>) => {
      const next = regras.map((r) => {
        if (r.id !== id) return r;
        const descricao = patch.descricao !== undefined ? patch.descricao.trim() : r.descricao;
        const contraRaw = patch.contaContrapartida ?? r.contaContrapartida;
        const contraRed = toReduzido(contraRaw) || sanitizeCodigoReduzido(contraRaw);
        if (!normalizeAplicacaoRegraTexto(descricao) || !contraRed) return r;
        return {
          ...r,
          ...patch,
          descricao,
          nome: (patch.nome ?? descricao).slice(0, 40),
          nature: patch.nature === 'C' ? ('C' as const) : patch.nature === 'D' ? ('D' as const) : r.nature,
          contaContrapartida: contraRed,
        };
      });
      onChange(saveAplicacaoRegrasContas(company, next));
    },
    [company, onChange, regras, toReduzido],
  );

  const handleRemoveTodas = useCallback(() => {
    if (regrasDaConta.length === 0) return;
    const msg = `Remover todas as ${regrasDaConta.length} regra(s) da aplicação ${contaAplicacao}? Esta ação não pode ser desfeita.`;
    if (!window.confirm(msg)) return;
    onChange(removeAplicacaoRegrasPorConta(company, contaAplicacao));
  }, [company, contaAplicacao, onChange, regrasDaConta.length]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[81] flex items-center justify-center p-3 bg-black/50">
      <div
        className="technical-panel shadow-[6px_6px_0_0_#141414] w-full max-w-4xl max-h-[92vh] h-[92vh] min-h-0 flex flex-col overflow-hidden"
        role="dialog"
        aria-labelledby="aplicacao-regras-contas-title"
      >
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-brand-border bg-brand-sidebar/40 shrink-0">
          <div className="flex-1 min-w-0">
            <h2
              id="aplicacao-regras-contas-title"
              className="text-sm font-black uppercase tracking-widest inline-flex items-center gap-2"
            >
              <ListOrdered size={16} aria-hidden="true" />
              Regras de Contas {contaAplicacao ? ` · ${contaAplicacao}` : ''}
            </h2>
            {contaAplicacao && (
              <span className="ml-2 px-2 py-0.5 bg-brand-border text-brand-bg text-[8px] font-black uppercase tracking-tighter">
                Aplicação Atual
              </span>
            )}
            <p className="text-[9px] text-slate-600 mt-0.5 leading-snug">
              Cadastro manual — puxe históricos do extrato de aplicação ou digite a descrição e a
              contrapartida (código reduzido).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-500 hover:text-red-600 shrink-0"
            aria-label="Fechar"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-scroll overscroll-contain px-3">
          <div className={cn('flex flex-col min-h-0 border-b border-brand-border/40', CONTENT_MAX)}>
            <div className="p-3 space-y-2 shrink-0">
              <p className="text-[9px] font-black uppercase tracking-widest text-brand-text/60">
                Nova regra · contrapartida (código reduzido) · {contaAplicacao || 'sem aplicação'}
              </p>
              {semRegra.length > 0 ? (
                <p className="text-[8px] text-amber-800">
                  {semRegra.length} padrão(ões) do extrato ainda sem regra.
                </p>
              ) : extratoSample.length > 0 ? (
                <p className="text-[8px] text-green-800">
                  Todos os lançamentos do extrato têm regra nesta aplicação.
                </p>
              ) : null}

              <div className="space-y-3 max-w-2xl">
                {padroesHistorico.length > 0 ? (
                  <div className="space-y-1">
                    <label
                      htmlFor="aplic-regra-padrao-historico"
                      className="text-[8px] font-bold uppercase text-brand-text/50 block"
                    >
                      Puxar histórico do extrato ({padroesHistorico.length} sem regra)
                    </label>
                    <ExtratoHistoricoPicker
                      buttonId="aplic-regra-padrao-historico"
                      padroes={padroesHistorico}
                      value={padraoHistoricoPick}
                      disabled={!contaAplicacao}
                      placeholder="Buscar histórico do extrato…"
                      onSelect={(hit) => {
                        setPadraoHistoricoPick(`${hit.nature}|${hit.descricao}`);
                        setDraftDescricao(hit.descricao);
                        setDraftNature(hit.nature);
                        setAddError('');
                      }}
                      onClear={() => {
                        setPadraoHistoricoPick('');
                        setDraftDescricao('');
                      }}
                    />
                  </div>
                ) : null}

                <div className="space-y-1">
                  <label
                    htmlFor="aplic-regra-historico-nova"
                    className="text-[8px] font-bold uppercase text-brand-text/50 block"
                  >
                    Histórico no extrato (texto que identifica o lançamento)
                  </label>
                  <input
                    id="aplic-regra-historico-nova"
                    type="text"
                    aria-label="Histórico no extrato de aplicação"
                    value={draftDescricao}
                    onChange={(e) => {
                      setDraftDescricao(e.target.value);
                      setPadraoHistoricoPick('');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAdd();
                      }
                    }}
                    placeholder="Ex.: CAPITALIZ. REND, RESGATE, APLICAÇÃO, IRRF…"
                    className={INPUT_CLS}
                    disabled={!contaAplicacao}
                  />
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                  <div className="w-full sm:w-[88px] shrink-0">
                    <p className="text-[8px] font-bold uppercase text-brand-text/50 mb-0.5">Natureza</p>
                    <div className="flex border border-brand-border h-[26px]">
                      <button
                        type="button"
                        onClick={() => setDraftNature('D')}
                        disabled={!contaAplicacao}
                        className={cn(
                          'flex-1 text-[8px] font-black uppercase',
                          draftNature === 'D' ? 'bg-red-600 text-white' : 'bg-transparent',
                        )}
                      >
                        D
                      </button>
                      <button
                        type="button"
                        onClick={() => setDraftNature('C')}
                        disabled={!contaAplicacao}
                        className={cn(
                          'flex-1 text-[8px] font-black uppercase',
                          draftNature === 'C' ? 'bg-blue-600 text-white' : 'bg-transparent',
                        )}
                      >
                        C
                      </button>
                    </div>
                  </div>

                  <div className="w-full sm:flex-1 sm:min-w-[200px] sm:max-w-[340px]">
                    <div className="grid grid-cols-[minmax(72px,1fr)_minmax(0,2fr)] gap-1 mb-0.5">
                      <p className="text-[8px] font-bold uppercase text-brand-text/50">Cód. reduzido</p>
                      <p className="text-[8px] font-bold uppercase text-brand-text/50">
                        Descrição da conta
                      </p>
                    </div>
                    <ExtratoContaPicker
                      value={draftConta}
                      options={planoOptions}
                      lookupOptions={planoAll}
                      includeSinteticas
                      showNomeInline
                      placeholder="Código…"
                      ariaLabel="Conta contrapartida (código reduzido)"
                      onChange={(code) => {
                        setDraftConta(code);
                        setAddError('');
                      }}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleAdd}
                    disabled={!contaAplicacao.trim()}
                    className="technical-button-primary text-[9px] py-1 px-4 shrink-0 inline-flex items-center justify-center gap-1 disabled:opacity-40 min-h-[26px] w-full sm:w-auto"
                  >
                    <Plus size={12} aria-hidden="true" />
                    ADD
                  </button>
                  {addError ? (
                    <p className="text-[9px] text-rose-700 font-bold uppercase w-full mt-1">
                      {addError}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="p-3 pt-0 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-brand-text/60">
                  Regras desta aplicação · {regrasDaConta.length}
                </p>
                {regrasDaConta.length > 0 ? (
                  <button
                    type="button"
                    onClick={handleRemoveTodas}
                    className="technical-button text-[8px] py-1 px-2 inline-flex items-center gap-1 shrink-0 text-rose-800 border-rose-300 hover:bg-rose-50"
                    title="Remove todas as regras desta aplicação"
                  >
                    <Trash2 size={11} aria-hidden="true" />
                    Remover todas
                  </button>
                ) : null}
              </div>
              {regrasDaConta.length === 0 ? (
                <p className="text-[10px] text-brand-text/45 italic text-center py-8">
                  Nenhuma regra para esta aplicação. Cadastre manualmente acima ou puxe um histórico
                  do extrato.
                </p>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="Buscar por nome ou código…"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className={INPUT_CLS}
                    aria-label="Buscar regras"
                  />
                  <ul className="space-y-2">
                    {filteredRegras.map((regra) => (
                      <AplicacaoRegraEditableRow
                        key={regra.id}
                        regra={regra}
                        planoOptions={planoOptions}
                        planoLookup={planoAll}
                        onUpdate={handleUpdate}
                        onRemove={handleRemove}
                      />
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="p-3 border-t border-brand-border flex justify-end gap-2 shrink-0 bg-brand-bg">
          <button type="button" onClick={onClose} className="technical-button text-[10px] py-1 px-3">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
});
