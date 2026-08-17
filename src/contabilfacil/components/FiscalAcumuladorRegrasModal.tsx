import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ListOrdered, Plus, Trash2, X } from 'lucide-react';
import { cn } from '../lib/utils';
import type {
  FiscalAcumuladorRegra,
  FiscalAcumuladorRegraNature,
} from '../logic/fiscalAcumuladorRegrasStorage';
import {
  addFiscalAcumuladorRegra,
  removeFiscalAcumuladorRegra,
  saveFiscalAcumuladorRegras,
} from '../logic/fiscalAcumuladorRegrasStorage';
import { normalizeExtratoMatchText, normalizeExtratoRegraTexto } from '../logic/extratoRegrasContasStorage';
import { CF_FORM_INPUT_LONG, CF_SELECT_WIDE } from '../lib/formFieldClasses';
import ExtratoContaPicker, { type ExtratoPlanoContaOption } from './ExtratoContaPicker';
import ExtratoHistoricoPicker, { type ExtratoHistoricoPadrao } from './ExtratoHistoricoPicker';
import type { FiscalAcumuladorGroup } from '../logic/fiscalAcumuladorModel';
import type { SpedInvoice } from './fiscal/types';
import { sanitizeCfop } from './fiscal/spedParser';

export type FiscalAcumuladorOption = { key: string; label: string };

export type FiscalAcumuladorRegrasModalProps = {
  open: boolean;
  company: string;
  regras: FiscalAcumuladorRegra[];
  planoOptions: ExtratoPlanoContaOption[];
  acumuladores: FiscalAcumuladorGroup[];
  nfAcumuladores?: FiscalAcumuladorOption[];
  /** Códigos do "Resumo por Acumulador" (Sistema Domínio) — alimenta o seletor "Puxar por Acumulador". */
  acumuladorResumoOptions?: FiscalAcumuladorOption[];
  /** Notas fiscais já importadas — alimenta os seletores de histórico/CFOP (mesmo esquema da conciliação de extrato). */
  invoices?: SpedInvoice[];
  tituloModal?: string;
  isNotasFiscais?: boolean;
  onClose: () => void;
  onChange: (next: FiscalAcumuladorRegra[]) => void;
};

const INPUT_REGRA_CLS = cn(
  CF_FORM_INPUT_LONG,
  'max-w-none w-full h-[28px] text-[10px] uppercase font-mono border-brand-border bg-white',
);

export default memo(function FiscalAcumuladorRegrasModal({
  open,
  company,
  regras,
  planoOptions,
  acumuladores,
  nfAcumuladores = [],
  acumuladorResumoOptions = [],
  invoices = [],
  tituloModal = 'Regras de contas',
  isNotasFiscais = false,
  onClose,
  onChange,
}: FiscalAcumuladorRegrasModalProps) {
  const [scopeKey, setScopeKey] = useState('');
  const [filterImpostoTipo, setFilterImpostoTipo] = useState<'todos' | 'a_recolher' | 'a_recuperar'>('todos');
  const [historicoPick, setHistoricoPick] = useState('');
  const [cfopPick, setCfopPick] = useState('');
  const [acumuladorPick, setAcumuladorPick] = useState('');

  const [draftDescricao, setDraftDescricao] = useState('');
  const [draftNature, setDraftNature] = useState<FiscalAcumuladorRegraNature>('D');
  const [draftImpostoTipo, setDraftImpostoTipo] = useState<'a_recolher' | 'a_recuperar'>('a_recolher');
  const [draftDebito, setDraftDebito] = useState('');
  const [draftCredito, setDraftCredito] = useState('');

  useEffect(() => {
    if (!open) return;
    setScopeKey('');
    setFilterImpostoTipo('todos');
    setHistoricoPick('');
    setCfopPick('');
    setAcumuladorPick('');
    setDraftDescricao('');
    setDraftNature('D');
    setDraftImpostoTipo('a_recolher');
    setDraftDebito('');
    setDraftCredito('');
  }, [open]);

  // Sincroniza o tipo de imposto/operação do formulário de criação com o filtro selecionado no topo
  useEffect(() => {
    if (filterImpostoTipo === 'a_recuperar') {
      setDraftImpostoTipo('a_recuperar');
    } else if (filterImpostoTipo === 'a_recolher') {
      setDraftImpostoTipo('a_recolher');
    }
  }, [filterImpostoTipo]);

  const regrasFiltradas = useMemo(() => {
    return regras.filter((r) => {
      if (scopeKey && r.acumuladorKey && r.acumuladorKey !== scopeKey) return false;
      if (filterImpostoTipo !== 'todos') {
        if (r.impostoTipo && r.impostoTipo !== filterImpostoTipo) return false;
      }
      return true;
    });
  }, [regras, scopeKey, filterImpostoTipo]);

  /** Uma partida (histórico/CFOP) já tem regra se algum texto cadastrado bate como substring — mesma lógica de matchFiscalAcumuladorRegra. */
  const jaCoberto = useCallback(
    (texto: string) => {
      const norm = normalizeExtratoMatchText(texto);
      return regrasFiltradas.some((r) => r.descricao && norm.includes(r.descricao));
    },
    [regrasFiltradas],
  );

  /**
   * Puxar histórico (fornecedor/participante) das notas fiscais já importadas.
   * Só faz sentido na aba de REGRAS DE NOTAS — na aba de Impostos o usuário
   * cadastra regra por TIPO DE IMPOSTO (ver padroesImposto), não por fornecedor.
   */
  const padroesHistorico = useMemo(() => {
    if (!isNotasFiscais || invoices.length === 0) return [] as ExtratoHistoricoPadrao[];
    const map = new Map<string, ExtratoHistoricoPadrao>();
    for (const inv of invoices) {
      const texto = (inv.participantName || '').replace(/\s+/g, ' ').trim();
      if (!texto) continue;
      const nature: 'D' | 'C' = inv.type === 'entrada' ? 'D' : 'C';
      const key = `${nature}|${texto.toUpperCase()}`;
      const cur = map.get(key);
      if (cur) cur.ocorrencias += 1;
      else map.set(key, { descricao: texto, nature, ocorrencias: 1 });
    }
    return [...map.values()]
      .filter((p) => !jaCoberto(p.descricao))
      .sort((a, b) => b.ocorrencias - a.ocorrencias);
  }, [invoices, jaCoberto, isNotasFiscais]);

  /** Puxar por CFOP das notas fiscais já importadas — idem, só faz sentido em Regras de Notas. */
  const padroesCfop = useMemo(() => {
    if (!isNotasFiscais || invoices.length === 0) return [] as ExtratoHistoricoPadrao[];
    const map = new Map<string, ExtratoHistoricoPadrao>();
    for (const inv of invoices) {
      const cfop = sanitizeCfop(inv.cfop);
      if (!cfop) continue;
      const nature: 'D' | 'C' = inv.type === 'entrada' ? 'D' : 'C';
      const descricao = `CFOP ${cfop}`;
      const key = `${nature}|${descricao}`;
      const cur = map.get(key);
      if (cur) cur.ocorrencias += 1;
      else map.set(key, { descricao, nature, ocorrencias: 1 });
    }
    return [...map.values()]
      .filter((p) => !jaCoberto(p.descricao))
      .sort((a, b) => b.ocorrencias - a.ocorrencias);
  }, [invoices, jaCoberto, isNotasFiscais]);

  /**
   * Puxar por ACUMULADOR (código/descrição do "Resumo por Acumulador" do Sistema Domínio) —
   * mesmo esquema do "Puxar por CFOP", só que usando o código de acumulador em vez do CFOP.
   */
  const padroesAcumulador = useMemo(() => {
    if (!isNotasFiscais || acumuladorResumoOptions.length === 0) return [] as ExtratoHistoricoPadrao[];
    const map = new Map<string, ExtratoHistoricoPadrao>();
    for (const a of acumuladorResumoOptions) {
      const descricao = a.label.trim();
      if (!descricao) continue;
      const key = `D|${descricao}`;
      const cur = map.get(key);
      if (cur) cur.ocorrencias += 1;
      else map.set(key, { descricao, nature: 'D', ocorrencias: 1 });
    }
    return [...map.values()]
      .filter((p) => !jaCoberto(p.descricao))
      .sort((a, b) => b.ocorrencias - a.ocorrencias);
  }, [acumuladorResumoOptions, jaCoberto, isNotasFiscais]);

  /**
   * Puxar por TIPO DE IMPOSTO (PIS/COFINS/ICMS/ISS/CSLL/IRPJ/SIMPLES) — só faz
   * sentido na aba de Regras de Impostos. Usa a mesma lista de tipos passada
   * em nfAcumuladores (que na tela de Impostos já traz cada tributo).
   */
  const padroesImposto = useMemo(() => {
    if (isNotasFiscais || nfAcumuladores.length === 0) return [] as ExtratoHistoricoPadrao[];
    return nfAcumuladores
      .map((a): ExtratoHistoricoPadrao => ({ descricao: a.label, nature: 'D', ocorrencias: 1 }))
      .filter((p) => !jaCoberto(p.descricao));
  }, [nfAcumuladores, jaCoberto, isNotasFiscais]);

  const persist = useCallback(
    (next: FiscalAcumuladorRegra[]) => {
      onChange(saveFiscalAcumuladorRegras(company, next));
    },
    [company, onChange],
  );

  const handleAdd = useCallback(() => {
    const descricao = normalizeExtratoRegraTexto(draftDescricao);
    const contaDebito = draftDebito.trim();
    const contaCredito = draftCredito.trim();
    const activeTipo = filterImpostoTipo !== 'todos' ? filterImpostoTipo : draftImpostoTipo;

    // No Fiscal a regra sempre precisa das duas pontas (débito e crédito) — diferente da
    // conciliação de extrato, que só precisa da conta de contrapartida.
    if (!descricao || !contaDebito || !contaCredito) return;

    persist(
      addFiscalAcumuladorRegra(company, {
        nome: descricao.slice(0, 40),
        descricao,
        nature: draftNature,
        contaContrapartida: contaDebito,
        contaDebito,
        contaCredito,
        acumuladorKey: scopeKey || undefined,
        impostoTipo: activeTipo,
      }),
    );

    setDraftDescricao('');
    setDraftNature('D');
    setDraftDebito('');
    setDraftCredito('');
    setHistoricoPick('');
    setCfopPick('');
    setAcumuladorPick('');
  }, [company, draftCredito, draftDebito, draftDescricao, draftImpostoTipo, draftNature, filterImpostoTipo, persist, scopeKey]);

  const handleRemove = useCallback(
    (id: string) => {
      persist(removeFiscalAcumuladorRegra(company, id));
    },
    [company, persist],
  );

  const contaLabel = useCallback(
    (code: string) => {
      if (!code) return '---';
      const hit = planoOptions.find((p) => p.code === code);
      return hit ? `${hit.code} — ${hit.name}` : code;
    },
    [planoOptions],
  );

  const acumuladorLabel = useCallback(
    (key: string) => {
      const nfHit = nfAcumuladores.find((a) => a.key === key);
      if (nfHit) return nfHit.label;
      const hit = acumuladores.find((a) => a.key === key);
      if (!hit) return key;
      return `${hit.item.registro} · ${hit.item.codigo} · ${hit.item.descricao.slice(0, 32)}`;
    },
    [acumuladores, nfAcumuladores],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[81] flex items-center justify-center p-4 bg-black/50">
      <div
        className="technical-panel bg-white border border-brand-border shadow-[6px_6px_0_0_#141414] w-full max-w-5xl max-h-[90vh] flex flex-col rounded-none"
        role="dialog"
        aria-labelledby="fiscal-acumulador-regras-title"
      >
        {/* Header Superior */}
        <div className="flex items-start justify-between gap-3 p-4 border-b border-brand-border bg-brand-sidebar/40">
          <div className="flex-1 min-w-0">
            <h2
              id="fiscal-acumulador-regras-title"
              className="text-sm font-black uppercase tracking-widest inline-flex items-center gap-2 text-brand-text font-mono"
            >
              <ListOrdered size={16} aria-hidden="true" />
              {tituloModal}
            </h2>
            <p className="text-[10px] text-slate-600 mt-1 leading-snug max-w-xl font-mono">
              {isNotasFiscais ? (
                <>Cadastre palavras do fornecedor/histórico e defina o lançamento contábil para <strong>ENTRADAS</strong> ou <strong>SAÍDAS</strong>.</>
              ) : (
                <>Cadastre palavras do fornecedor/histórico e informe se o imposto é <strong>A RECOLHER</strong> ou <strong>A RECUPERAR</strong> com suas contas contábeis.</>
              )}
            </p>

            {/* Selects de Filtros Superiores */}
            <div className="mt-3 flex flex-wrap gap-3 max-w-3xl">
              <div className="flex-1 min-w-[220px]">
                <label className="block text-[8px] font-bold uppercase opacity-50 mb-1 font-mono">
                  Acumulador / CFOP (opcional)
                </label>
                <select
                  aria-label="Acumulador das regras"
                  value={scopeKey}
                  onChange={(e) => setScopeKey(e.target.value)}
                  className={cn(CF_SELECT_WIDE, 'text-[10px] w-full font-mono bg-white border-brand-border')}
                >
                  <option value="">Todas as regras / todos os acumuladores</option>
                  {nfAcumuladores.length > 0 ? (
                    <optgroup label={isNotasFiscais ? 'Notas fiscais (CFOP)' : 'Tipos de imposto'}>
                      {nfAcumuladores.map((a) => (
                        <option key={a.key} value={a.key}>
                          {a.label}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {acumuladores.length > 0 ? (
                    <optgroup label="Apuração SPED">
                      {acumuladores.map((a) => (
                        <option key={a.id} value={a.key}>
                          {a.item.registro} · {a.item.codigo} — {a.item.descricao.slice(0, 40)}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </div>

              <div className="w-56 shrink-0">
                <label className="block text-[8px] font-bold uppercase opacity-50 mb-1 font-mono">
                  {isNotasFiscais ? 'Filtrar por Operação' : 'Filtrar por Imposto / Apuração'}
                </label>
                <select
                  value={filterImpostoTipo}
                  onChange={(e) => setFilterImpostoTipo(e.target.value as 'todos' | 'a_recolher' | 'a_recuperar')}
                  className={cn(CF_SELECT_WIDE, 'text-[10px] w-full font-mono bg-white border-brand-border font-bold')}
                >
                  {isNotasFiscais ? (
                    <>
                      <option value="todos">Todas as operações</option>
                      <option value="a_recuperar">Entradas</option>
                      <option value="a_recolher">Saídas</option>
                    </>
                  ) : (
                    <>
                      <option value="todos">Todos os tipos de imposto</option>
                      <option value="a_recolher">Impostos a Recolher</option>
                      <option value="a_recuperar">Impostos a Recuperar</option>
                    </>
                  )}
                </select>
              </div>
            </div>
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

        {/* Formulário de Nova Regra */}
        <div className="p-4 border-b border-brand-border/40 space-y-3 bg-brand-sidebar/10">
          <p className="text-[9px] font-black uppercase tracking-widest text-brand-text/70 font-mono flex items-center gap-2">
            <span>Nova regra</span>
            {scopeKey ? <span>· {acumuladorLabel(scopeKey)}</span> : <span>· global</span>}
            {filterImpostoTipo !== 'todos' ? (
              <span className={`px-1.5 py-0.5 border text-[8px] font-bold uppercase ${
                filterImpostoTipo === 'a_recuperar' ? 'bg-blue-50 text-blue-800 border-blue-200' : 'bg-purple-50 text-purple-800 border-purple-200'
              }`}>
                [{isNotasFiscais
                  ? (filterImpostoTipo === 'a_recuperar' ? 'ENTRADA' : 'SAÍDA')
                  : (filterImpostoTipo === 'a_recuperar' ? 'A RECUPERAR' : 'A RECOLHER')
                }]
              </span>
            ) : null}
          </p>

          {padroesImposto.length > 0 && (
            <div className="max-w-2xl">
              <div className="space-y-1">
                <label
                  htmlFor="fiscal-regra-imposto"
                  className="text-[8px] font-bold uppercase text-brand-text/50 block"
                >
                  Puxar por tipo de imposto ({padroesImposto.length} sem regra)
                </label>
                <ExtratoHistoricoPicker
                  buttonId="fiscal-regra-imposto"
                  padroes={padroesImposto}
                  value={historicoPick}
                  placeholder="Buscar imposto (PIS, COFINS, ICMS, ISS...)…"
                  onSelect={(hit) => {
                    setHistoricoPick(hit.descricao);
                    setDraftDescricao(hit.descricao);
                  }}
                  onClear={() => {
                    setHistoricoPick('');
                    setDraftDescricao('');
                  }}
                />
              </div>
            </div>
          )}

          {(padroesHistorico.length > 0 || padroesCfop.length > 0 || padroesAcumulador.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-w-4xl">
              {padroesHistorico.length > 0 ? (
                <div className="space-y-1">
                  <label
                    htmlFor="fiscal-regra-historico"
                    className="text-[8px] font-bold uppercase text-brand-text/50 block"
                  >
                    Puxar histórico das notas ({padroesHistorico.length} sem regra)
                  </label>
                  <ExtratoHistoricoPicker
                    buttonId="fiscal-regra-historico"
                    padroes={padroesHistorico}
                    value={historicoPick}
                    placeholder="Buscar fornecedor/histórico…"
                    onSelect={(hit) => {
                      const key = `${hit.nature}|${hit.descricao}`;
                      setHistoricoPick(key);
                      setCfopPick('');
                      setAcumuladorPick('');
                      setDraftDescricao(hit.descricao);
                      if (filterImpostoTipo === 'todos') {
                        setDraftImpostoTipo(hit.nature === 'D' ? 'a_recuperar' : 'a_recolher');
                      }
                    }}
                    onClear={() => {
                      setHistoricoPick('');
                      setDraftDescricao('');
                    }}
                  />
                </div>
              ) : null}

              {padroesCfop.length > 0 ? (
                <div className="space-y-1">
                  <label
                    htmlFor="fiscal-regra-cfop"
                    className="text-[8px] font-bold uppercase text-brand-text/50 block"
                  >
                    Puxar por CFOP ({padroesCfop.length} sem regra)
                  </label>
                  <ExtratoHistoricoPicker
                    buttonId="fiscal-regra-cfop"
                    padroes={padroesCfop}
                    value={cfopPick}
                    placeholder="Buscar CFOP…"
                    onSelect={(hit) => {
                      const key = `${hit.nature}|${hit.descricao}`;
                      setCfopPick(key);
                      setHistoricoPick('');
                      setAcumuladorPick('');
                      setDraftDescricao(hit.descricao);
                      if (filterImpostoTipo === 'todos') {
                        setDraftImpostoTipo(hit.nature === 'D' ? 'a_recuperar' : 'a_recolher');
                      }
                    }}
                    onClear={() => {
                      setCfopPick('');
                      setDraftDescricao('');
                    }}
                  />
                </div>
              ) : null}

              {padroesAcumulador.length > 0 ? (
                <div className="space-y-1">
                  <label
                    htmlFor="fiscal-regra-acumulador"
                    className="text-[8px] font-bold uppercase text-brand-text/50 block"
                  >
                    Puxar por Acumulador ({padroesAcumulador.length} sem regra)
                  </label>
                  <ExtratoHistoricoPicker
                    buttonId="fiscal-regra-acumulador"
                    padroes={padroesAcumulador}
                    value={acumuladorPick}
                    placeholder="Buscar acumulador…"
                    onSelect={(hit) => {
                      const key = `${hit.nature}|${hit.descricao}`;
                      setAcumuladorPick(key);
                      setHistoricoPick('');
                      setCfopPick('');
                      setDraftDescricao(hit.descricao);
                      if (filterImpostoTipo === 'todos') {
                        setDraftImpostoTipo(hit.nature === 'D' ? 'a_recuperar' : 'a_recolher');
                      }
                    }}
                    onClear={() => {
                      setAcumuladorPick('');
                      setDraftDescricao('');
                    }}
                  />
                </div>
              ) : null}
            </div>
          )}

          <div className="flex flex-col gap-2 w-full">
            <div>
              <label className="block text-[8px] font-bold uppercase opacity-60 mb-0.5 font-mono">
                Texto / Histórico / Fornecedor
              </label>
              <input
                type="text"
                aria-label="Texto para casar"
                value={draftDescricao}
                onChange={(e) => {
                  setDraftDescricao(e.target.value);
                  setHistoricoPick('');
                  setCfopPick('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAdd();
                  }
                }}
                placeholder={isNotasFiscais ? "FORNECEDOR, COMPRA, VENDA…" : "PIS, COFINS, ICMS, FORNECEDOR…"}
                className={INPUT_REGRA_CLS}
              />
            </div>

            <div className="flex flex-col sm:flex-row items-end gap-2 w-full">
              <div className="flex-1 min-w-[160px]">
                <label className="block text-[8px] font-bold uppercase opacity-60 mb-0.5 font-mono text-rose-700">
                  Conta Débito
                </label>
                {planoOptions.length > 0 ? (
                  <ExtratoContaPicker
                    value={draftDebito}
                    options={planoOptions}
                    lookupOptions={planoOptions}
                    placeholder="Cód. Débito"
                    ariaLabel="Conta Débito"
                    onChange={setDraftDebito}
                  />
                ) : (
                  <input
                    type="text"
                    value={draftDebito}
                    onChange={(e) => setDraftDebito(e.target.value)}
                    placeholder="Cód. Débito"
                    className={INPUT_REGRA_CLS}
                  />
                )}
              </div>

              <div className="flex-1 min-w-[160px]">
                <label className="block text-[8px] font-bold uppercase opacity-60 mb-0.5 font-mono text-emerald-700">
                  Conta Crédito
                </label>
                {planoOptions.length > 0 ? (
                  <ExtratoContaPicker
                    value={draftCredito}
                    options={planoOptions}
                    lookupOptions={planoOptions}
                    placeholder="Cód. Crédito"
                    ariaLabel="Conta Crédito"
                    onChange={setDraftCredito}
                  />
                ) : (
                  <input
                    type="text"
                    value={draftCredito}
                    onChange={(e) => setDraftCredito(e.target.value)}
                    placeholder="Cód. Crédito"
                    className={INPUT_REGRA_CLS}
                  />
                )}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-end gap-2 w-full">
              <div className="w-32 shrink-0">
                <label className="block text-[8px] font-bold uppercase opacity-60 mb-0.5 font-mono text-purple-700">
                  {isNotasFiscais ? 'Operação' : 'Tipo Imposto'}
                </label>
                <select
                  aria-label={isNotasFiscais ? 'Operação' : 'Tipo do Imposto'}
                  value={draftImpostoTipo}
                  onChange={(e) => setDraftImpostoTipo(e.target.value as 'a_recolher' | 'a_recuperar')}
                  disabled={filterImpostoTipo !== 'todos'}
                  className={cn(CF_SELECT_WIDE, 'h-[28px] text-[10px] w-full font-mono bg-white border-brand-border font-bold disabled:bg-slate-100 disabled:opacity-80')}
                >
                  {isNotasFiscais ? (
                    <>
                      <option value="a_recuperar">ENTRADA</option>
                      <option value="a_recolher">SAÍDA</option>
                    </>
                  ) : (
                    <>
                      <option value="a_recolher">A RECOLHER</option>
                      <option value="a_recuperar">A RECUPERAR</option>
                    </>
                  )}
                </select>
              </div>

              <div className="w-24 shrink-0">
                <label className="block text-[8px] font-bold uppercase opacity-60 mb-0.5 font-mono">
                  Natureza
                </label>
                <select
                  aria-label="Natureza"
                  value={draftNature}
                  onChange={(e) => setDraftNature(e.target.value as FiscalAcumuladorRegraNature)}
                  className={cn(CF_SELECT_WIDE, 'h-[28px] text-[10px] w-full font-mono bg-white border-brand-border')}
                >
                  <option value="D">Débito</option>
                  <option value="C">Crédito</option>
                </select>
              </div>
            </div>

            <button
              type="button"
              onClick={handleAdd}
              disabled={!draftDescricao.trim() || !draftDebito.trim() || !draftCredito.trim()}
              title="Preencha o texto e as duas contas (débito e crédito) para adicionar"
              className="technical-button-primary text-[10px] h-[28px] px-3.5 flex items-center justify-center gap-1 font-bold disabled:opacity-40 w-full sm:w-auto sm:self-end"
            >
              <Plus size={13} />
              <span>Adicionar</span>
            </button>
          </div>
        </div>

        {/* Lista de Regras Cadastradas */}
        <div className="flex-1 overflow-y-auto p-4">
          {regrasFiltradas.length === 0 ? (
            <p className="text-[10px] text-slate-500 uppercase text-center py-8 font-mono">
              Nenhuma regra cadastrada
              {filterImpostoTipo !== 'todos'
                ? (isNotasFiscais
                    ? ` para ${filterImpostoTipo === 'a_recuperar' ? 'entradas' : 'saídas'}`
                    : ` para impostos ${filterImpostoTipo === 'a_recuperar' ? 'a recuperar' : 'a recolher'}`)
                : ''}.
            </p>
          ) : (
            <ul className="space-y-2">
              {regrasFiltradas.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 p-2.5 border border-brand-border/40 bg-white text-[10px] font-mono shadow-[1px_1px_0_0_#141414]"
                >
                  <div className="flex items-center gap-2">
                    <span className={`font-black uppercase px-2 py-0.5 border ${
                      r.impostoTipo === 'a_recuperar'
                        ? 'bg-blue-50 text-blue-800 border-blue-200'
                        : 'bg-purple-50 text-purple-800 border-purple-200'
                    }`}>
                      {isNotasFiscais
                        ? (r.impostoTipo === 'a_recuperar' ? 'ENTRADA' : 'SAÍDA')
                        : (r.impostoTipo === 'a_recuperar' ? 'A RECUPERAR' : 'A RECOLHER')}
                    </span>

                    <span className={`font-bold uppercase px-1.5 py-0.5 border text-[9px] ${
                      r.nature === 'D' ? 'bg-rose-50 text-rose-800 border-rose-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    }`}>
                      {r.nature === 'D' ? 'DÉBITO' : 'CRÉDITO'}
                    </span>

                    <span className="font-bold text-brand-text">{r.descricao}</span>
                  </div>

                  <div className="flex items-center gap-4 text-brand-text/80">
                    {r.contaDebito ? (
                      <span className="text-rose-700 font-bold">
                        Débito: {contaLabel(r.contaDebito)}
                      </span>
                    ) : null}

                    {r.contaCredito ? (
                      <span className="text-emerald-700 font-bold">
                        Crédito: {contaLabel(r.contaCredito)}
                      </span>
                    ) : null}

                    {!r.contaDebito && !r.contaCredito && r.contaContrapartida ? (
                      <span>
                        Contrapartida: {contaLabel(r.contaContrapartida)}
                      </span>
                    ) : null}

                    {r.acumuladorKey ? (
                      <span className="text-[8px] uppercase bg-brand-sidebar px-1.5 py-0.5 border border-brand-border">
                        {acumuladorLabel(r.acumuladorKey)}
                      </span>
                    ) : (
                      <span className="text-[8px] uppercase opacity-40">[global]</span>
                    )}

                    <button
                      type="button"
                      onClick={() => handleRemove(r.id)}
                      className="p-1 text-red-700 hover:bg-red-50 border border-transparent hover:border-red-200"
                      aria-label="Remover regra"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="p-3 border-t border-brand-border flex justify-end gap-2 bg-brand-sidebar/20">
          <button type="button" onClick={onClose} className="technical-button text-[10px] px-4 py-2 font-bold">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
});
