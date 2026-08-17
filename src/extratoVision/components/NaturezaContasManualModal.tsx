import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, X, Info, BookOpen, Search, ChevronUp, ChevronDown } from 'lucide-react';
import type { VisionPlanoRow } from '../types/accounting';
import type { NaturezaManualEntry, NaturezaRegraFolder } from '../utils/naturezaManualConfig';
import { setActiveNaturezaManualEntries } from '../utils/naturezaManualConfig';
import PlanoGrupoSinteticoPicker from '../../contabilfacil/components/PlanoGrupoSinteticoPicker';
import type { ExtratoPlanoContaOption } from '../../contabilfacil/components/ExtratoContaPicker';
import { generateUUID } from '../../lib/uuid';

export type NaturezaContasManualModalProps = {
  open: boolean;
  planoRows: VisionPlanoRow[];
  /** Empresa aberta no Balancete — usada para pré-selecionar a pasta dela ao abrir. */
  empresaAtual: string;
  /** Todas as empresas cadastradas, para o multi-select de vínculo da pasta. */
  todasEmpresas: string[];
  folders: NaturezaRegraFolder[];
  onSaveFolder: (folder: NaturezaRegraFolder) => NaturezaRegraFolder;
  onDeleteFolder: (id: string) => void;
  onClose: () => void;
  /** ContabilFacil: visual técnico do módulo gerencial. */
  contabil?: boolean;
};

const NOVA_PASTA_ID = '__nova__';

function isContaSintetica(p: VisionPlanoRow): boolean {
  if (p.tipo === 'S') return true;
  if (p.tipo === 'A') return false;
  return !String(p.codigoReduzido ?? '').trim();
}

function normCls(cls: string): string {
  return cls.replace(/\./g, '').replace(/\s/g, '').trim();
}

function normEmpresa(empresa: string): string {
  return empresa.trim().toLowerCase();
}

function pastaVazia(): NaturezaRegraFolder {
  return { id: NOVA_PASTA_ID, nome: '', aplicarATodas: true, empresas: [], entries: [] };
}

function folderForEmpresa(
  empresa: string,
  folders: NaturezaRegraFolder[],
): NaturezaRegraFolder | undefined {
  const alvo = normEmpresa(empresa);
  if (!alvo) return undefined;
  const explicita = folders.find((f) => !f.aplicarATodas && f.empresas.includes(alvo));
  if (explicita) return explicita;
  return folders.find((f) => f.aplicarATodas);
}

export default function NaturezaContasManualModal({
  open,
  planoRows,
  empresaAtual,
  todasEmpresas,
  folders,
  onSaveFolder,
  onDeleteFolder,
  onClose,
  contabil = false,
}: NaturezaContasManualModalProps) {
  const [draft, setDraft] = useState<NaturezaRegraFolder>(pastaVazia());
  const [novaClassificacao, setNovaClassificacao] = useState('');
  const [novaNatureza, setNovaNatureza] = useState<'D' | 'C'>('D');
  const [infoAberto, setInfoAberto] = useState<string | null>(null);
  /** Contas escolhidas mas ainda não confirmadas como override — permite selecionar várias. */
  const [contasSelecionadas, setContasSelecionadas] = useState<{ classificacao: string; nome?: string }[]>([]);
  /** Nome manual do grupo — obrigatório quando há 2+ contas selecionadas (não há uma única classificação para representar o conjunto). */
  const [nomeGrupo, setNomeGrupo] = useState('');
  /** Entrada (grupo com 2+ contas) cujo detalhe está aberto — mostra a classificação de cada conta. */
  const [detalheEntryId, setDetalheEntryId] = useState<string | null>(null);
  /** Mostrar sugestões de contas ao digitar descrição */
  const [mostrarSugestoes, setMostrarSugestoes] = useState(false);
  /** Abrir modal de seleção do Plano de Contas Sintético */
  const [modalPlanoAberto, setModalPlanoAberto] = useState(false);
  /** Termo de busca dentro do modal do Plano de Contas Sintético */
  const [buscaPlanoModal, setBuscaPlanoModal] = useState('');

  // Ao abrir a modal, seleciona a pasta da empresa atual
  // Só roda quando o modal abre ou a empresa muda
  useEffect(() => {
    if (!open) return;
    // Não reseta se já existe uma pasta com ID real (foi salva)
    if (draft.id !== NOVA_PASTA_ID) return;
    const atual = folderForEmpresa(empresaAtual, folders);
    setDraft(atual ? { ...atual, empresas: [...atual.empresas], entries: [...atual.entries] } : pastaVazia());
  }, [open, empresaAtual]);

  const planoOptions: ExtratoPlanoContaOption[] = useMemo(
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

  /** Apenas contas SINTÉTICAS do plano de contas para a regra de Natureza das Contas */
  const planoSinteticoRows = useMemo(
    () => planoRows.filter(isContaSintetica),
    [planoRows],
  );

  const planoSinteticoRowsFiltradas = useMemo(() => {
    const q = buscaPlanoModal.trim().toLowerCase();
    if (!q) return planoSinteticoRows;
    return planoSinteticoRows.filter(
      (p) => p.nome.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q),
    );
  }, [planoSinteticoRows, buscaPlanoModal]);

  if (!open) return null;

  const nomeDaClassificacao = (cls: string): string | undefined =>
    planoRows.find((p) => normCls(p.codigo) === normCls(cls))?.nome;

  const detalheEntry = detalheEntryId ? draft.entries.find((e) => e.id === detalheEntryId) : undefined;

  const trocarPasta = (id: string) => {
    setInfoAberto(null);

    if (id === NOVA_PASTA_ID) {
      setDraft(pastaVazia());
      return;
    }

    if (id === draft.id) {
      return;
    }

    const alvo = folders.find((f) => f.id === id);
    if (alvo) {
      setDraft({ ...alvo, empresas: [...alvo.empresas], entries: [...alvo.entries] });
    }
  };

  /** Adiciona a conta escolhida no picker à seleção pendente. */
  const adicionarContaNaSelecao = () => {
    const cls = novaClassificacao.trim();
    if (!cls) return;
    const clsNorm = normCls(cls);
    setContasSelecionadas((prev) =>
      prev.some((c) => normCls(c.classificacao) === clsNorm)
        ? prev
        : [...prev, { classificacao: cls, nome: nomeDaClassificacao(cls) }],
    );
    setNovaClassificacao('');
  };

  /** Busca e adiciona automaticamente contas SINTÉTICAS que têm a descrição/código digitado. */
  const adicionarContasPorDescricao = () => {
    const descricao = novaClassificacao.trim().toLowerCase();
    if (!descricao) return;

    // Encontra apenas CONTAS SINTÉTICAS cuja descrição ou código CONTENHA o texto digitado
    const contasComDescricao = planoSinteticoRows.filter(
      (p) => p.nome.toLowerCase().includes(descricao) || p.codigo.toLowerCase().includes(descricao),
    );

    if (contasComDescricao.length === 0) {
      alert(`Nenhuma conta sintética encontrada com a busca "${novaClassificacao}"`);
      return;
    }

    setContasSelecionadas((prev) => {
      const novas = [...prev];
      const codigosExistentes = new Set(prev.map((c) => normCls(c.classificacao)));

      contasComDescricao.forEach((conta) => {
        const clsNorm = normCls(conta.codigo);
        if (!codigosExistentes.has(clsNorm)) {
          novas.push({
            classificacao: conta.codigo,
            nome: conta.nome,
          });
          codigosExistentes.add(clsNorm);
        }
      });

      return novas.sort((a, b) =>
        a.classificacao.localeCompare(b.classificacao, 'pt-BR', { numeric: true }),
      );
    });

    setNovaClassificacao('');
  };

  const removerContaDaSelecao = (classificacao: string) => {
    setContasSelecionadas((prev) => prev.filter((c) => c.classificacao !== classificacao));
  };

  const podeAdicionarOverride =
    contasSelecionadas.length > 0 &&
    (contasSelecionadas.length === 1 || nomeGrupo.trim().length > 0);

  /** Confirma a seleção pendente como um override — uma conta só ou um grupo nomeado com várias. */
  const adicionarOverride = () => {
    if (!podeAdicionarOverride) return;
    const isGrupo = contasSelecionadas.length > 1;
    const classificacoes = contasSelecionadas.map((c) => c.classificacao);
    const classificacoesNorm = new Set(classificacoes.map(normCls));

    // Remove essas classificações de outras entradas existentes (evita duas regras para a
    // mesma conta); descarta entradas que ficarem sem nenhuma classificação restante.
    const entriesAjustadas = draft.entries
      .map((e) => ({
        ...e,
        classificacoes: e.classificacoes.filter((c) => !classificacoesNorm.has(normCls(c))),
      }))
      .filter((e) => e.classificacoes.length > 0);

    const novaEntry: NaturezaManualEntry = {
      id: generateUUID(),
      classificacoes,
      nome: isGrupo ? nomeGrupo.trim() : nomeGrupo.trim() || contasSelecionadas[0].nome,
      natureza: novaNatureza,
    };

    // Preserva a ordem exata na sequência informada pelo usuário (sem reordenação automática)
    const nextEntries = [...entriesAjustadas, novaEntry];

    setDraft((prev) => ({ ...prev, entries: nextEntries }));
    setContasSelecionadas([]);
    setNomeGrupo('');
    setNovaClassificacao('');
  };

  const moverParaCima = (idx: number) => {
    if (idx <= 0) return;
    setDraft((prev) => {
      const copy = [...prev.entries];
      const temp = copy[idx - 1];
      copy[idx - 1] = copy[idx];
      copy[idx] = temp;
      return { ...prev, entries: copy };
    });
  };

  const moverParaBaixo = (idx: number) => {
    setDraft((prev) => {
      if (idx >= prev.entries.length - 1) return prev;
      const copy = [...prev.entries];
      const temp = copy[idx + 1];
      copy[idx + 1] = copy[idx];
      copy[idx] = temp;
      return { ...prev, entries: copy };
    });
  };


  const removerOverride = (id: string) => {
    setDraft((prev) => ({ ...prev, entries: prev.entries.filter((e) => e.id !== id) }));
    if (detalheEntryId === id) setDetalheEntryId(null);
  };

  /** Remove uma única conta de dentro de um grupo (via modal de detalhe) — some o grupo se ficar vazio. */
  const removerContaDoGrupo = (entryId: string, classificacao: string) => {
    setDraft((prev) => ({
      ...prev,
      entries: prev.entries
        .map((e) =>
          e.id === entryId
            ? { ...e, classificacoes: e.classificacoes.filter((c) => c !== classificacao) }
            : e,
        )
        .filter((e) => e.classificacoes.length > 0),
    }));
  };

  const toggleEmpresa = (empresa: string) => {
    const alvo = normEmpresa(empresa);
    setDraft((prev) => ({
      ...prev,
      empresas: prev.empresas.includes(alvo)
        ? prev.empresas.filter((e) => e !== alvo)
        : [...prev.empresas, alvo],
    }));
  };

  const podeSalvar = draft.nome.trim().length > 0 && (draft.aplicarATodas || draft.empresas.length > 0);

  const salvar = () => {
    if (!podeSalvar) return;
    // Pasta nova: nunca envia o sentinel "__nova__" como id — deixa o backend gerar um UUID real.
    // Enviar o sentinel faria a pasta ser salva com id === NOVA_PASTA_ID, colidindo com a opção
    // "+ Nova pasta" no <select> (mesmo value) e quebrando a seleção/exibição da pasta.
    const payload = draft.id === NOVA_PASTA_ID ? { ...draft, id: '' } : draft;
    const pastaSalva = onSaveFolder(payload);
    setDraft(pastaSalva);
    setActiveNaturezaManualEntries(pastaSalva.entries);
  };

  const excluir = () => {
    if (draft.id === NOVA_PASTA_ID) return;
    if (!window.confirm(`Excluir a pasta "${draft.nome}"? As empresas vinculadas perdem esses overrides.`)) return;
    onDeleteFolder(draft.id);
    setDraft(pastaVazia());
    onClose();
  };

  const overlayClass = contabil
    ? 'fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-brand-text/40'
    : 'fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70';

  const shellClass = contabil
    ? 'w-full max-w-2xl max-h-[88vh] overflow-hidden flex flex-col technical-panel bg-brand-bg shadow-[8px_8px_0_0_#141414]'
    : 'w-full max-w-2xl max-h-[88vh] overflow-hidden flex flex-col rounded-2xl border border-violet-500/40 bg-slate-900 shadow-2xl';

  const headerClass = contabil
    ? 'px-4 py-3 border-b border-brand-border flex items-start justify-between gap-2 bg-brand-sidebar/40'
    : 'px-4 py-3 border-b border-slate-700 flex items-start justify-between gap-2';

  const titleClass = contabil
    ? 'text-[10px] font-black uppercase tracking-widest text-brand-text'
    : 'text-sm font-black text-violet-200 uppercase tracking-wide';

  const subtitleClass = contabil
    ? 'text-[9px] font-bold uppercase opacity-50 mt-1 leading-relaxed max-w-md'
    : 'text-[10px] text-slate-400 mt-1 leading-relaxed max-w-md';

  const bodyClass = contabil
    ? 'flex-1 overflow-y-auto p-4 space-y-4 bg-brand-bg'
    : 'flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3';

  const footerClass = contabil
    ? 'px-4 py-3 border-t border-brand-border flex flex-wrap gap-2 justify-end bg-brand-sidebar/30'
    : 'px-4 py-3 border-t border-slate-700 flex flex-wrap gap-2 justify-end';

  const sectionClass = contabil
    ? 'technical-panel p-3 bg-brand-sidebar/15 space-y-2'
    : 'rounded-lg border border-slate-700 bg-slate-950/60 p-3 space-y-2';

  const labelHint = contabil
    ? 'text-[9px] font-bold uppercase opacity-50'
    : 'text-[10px] text-slate-500';

  const inputClass = contabil
    ? 'w-full px-2 py-1.5 bg-white border border-brand-border text-xs font-mono font-bold focus:outline-none focus:ring-1 focus:ring-brand-border'
    : 'w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-xs';

  return (
    <div
      className={overlayClass}
      role="dialog"
      aria-modal="true"
      aria-labelledby="natureza-manual-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={shellClass} onClick={(e) => e.stopPropagation()}>
        <div className={headerClass}>
          <div>
            <h2 id="natureza-manual-title" className={titleClass}>
              Configuração da natureza das contas
            </h2>
            <p className={subtitleClass}>
              As regras ficam em <strong>pastas</strong> compartilháveis entre empresas que usam o
              mesmo tipo de plano de contas (os grupos podem mudar de empresa para empresa). Escolha
              uma pasta existente ou crie uma nova, marque se ela vale para todas as empresas ou só
              para as selecionadas, e defina a natureza (Devedora/Credora) das contas sintéticas. Contas com
              sinal <strong>(−)</strong> na descrição têm natureza <strong>invertida</strong> em relação à conta pai.
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
          <div className={sectionClass}>
            <p className={labelHint}>Pasta de regras</p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Pasta de regras"
                value={draft.id}
                onChange={(e) => trocarPasta(e.target.value)}
                className={inputClass + ' max-w-[220px]'}
              >
                <option value={NOVA_PASTA_ID}>+ Nova pasta</option>
                {/* Mostrar pasta do draft se tem ID real */}
                {draft.id !== NOVA_PASTA_ID && (
                  <option value={draft.id}>
                    {draft.nome} {draft.aplicarATodas ? '(todas)' : `(${draft.empresas.length} empresa[s])`}
                  </option>
                )}
                {/* Outras pastas salvas — exclui a do draft para não duplicar a option acima */}
                {folders
                  .filter((f) => f.id !== draft.id)
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome} {f.aplicarATodas ? '(todas)' : `(${f.empresas.length} empresa[s])`}
                    </option>
                  ))}
              </select>
              <input
                type="text"
                value={draft.nome}
                onChange={(e) => setDraft((prev) => ({ ...prev, nome: e.target.value }))}
                placeholder="Nome da pasta (ex.: Plano padrão CPC)"
                className={inputClass + ' flex-1 min-w-[180px]'}
              />
              {draft.id !== NOVA_PASTA_ID && (
                <button
                  type="button"
                  onClick={excluir}
                  className="text-red-700 hover:text-red-600 p-1.5 border border-red-700/40 hover:border-red-600 shrink-0"
                  aria-label={`Excluir pasta ${draft.nome}`}
                  title="Excluir esta pasta"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>

            <label className="flex items-center gap-2 text-[10px] font-bold uppercase mt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.aplicarATodas}
                onChange={(e) => setDraft((prev) => ({ ...prev, aplicarATodas: e.target.checked }))}
              />
              Aplicar a todas as empresas
            </label>

            {!draft.aplicarATodas && (
              <div className="mt-2 border border-brand-border/40 max-h-32 overflow-y-auto divide-y divide-brand-border/20">
                {todasEmpresas.length === 0 ? (
                  <p className="text-[9px] uppercase opacity-60 p-2 text-center">Nenhuma empresa cadastrada.</p>
                ) : (
                  todasEmpresas.map((empresa) => (
                    <label
                      key={empresa}
                      className="flex items-center gap-2 px-2 py-1 text-[9px] font-bold uppercase cursor-pointer hover:bg-brand-sidebar/20"
                    >
                      <input
                        type="checkbox"
                        checked={draft.empresas.includes(normEmpresa(empresa))}
                        onChange={() => toggleEmpresa(empresa)}
                      />
                      {empresa}
                    </label>
                  ))
                )}
              </div>
            )}
          </div>

          <div className={sectionClass}>
            <p className={labelHint}>Adicionar override (Contas Sintéticas)</p>
            <p className={labelHint + ' normal-case opacity-70'}>
              Selecione a conta sintética ou digite o código/descrição para adicionar.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <div className="w-80 shrink-0">
                <PlanoGrupoSinteticoPicker
                  value={novaClassificacao}
                  options={planoOptions}
                  placeholder="Buscar classificação ou nome..."
                  onChange={(classificacao) => {
                    setNovaClassificacao(classificacao);
                  }}
                />
              </div>

              <select
                aria-label="Natureza"
                value={novaNatureza}
                onChange={(e) => setNovaNatureza(e.target.value === 'C' ? 'C' : 'D')}
                className="h-[26px] border border-brand-border/50 bg-white px-2 text-[9px] font-bold uppercase"
              >
                <option value="D">Devedora</option>
                <option value="C">Credora</option>
              </select>

              <button
                type="button"
                onClick={() => {
                  if (!novaClassificacao.trim()) return;
                  const cls = novaClassificacao.trim();
                  const clsNorm = normCls(cls);
                  setContasSelecionadas((prev) =>
                    prev.some((c) => normCls(c.classificacao) === clsNorm)
                      ? prev
                      : [...prev, { classificacao: cls, nome: nomeDaClassificacao(cls) }],
                  );
                  setNovaClassificacao('');
                }}
                disabled={!novaClassificacao.trim()}
                className="h-[26px] px-3 bg-black hover:bg-neutral-800 text-white flex items-center justify-center text-[10px] font-black uppercase disabled:opacity-40 transition-colors cursor-pointer shrink-0"
              >
                + ADD
              </button>
            </div>

            {contasSelecionadas.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {contasSelecionadas.map((c) => (
                  <span
                    key={c.classificacao}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono font-bold bg-brand-sidebar/40 border border-brand-border/40"
                  >
                    {c.classificacao}
                    <button
                      type="button"
                      onClick={() => removerContaDaSelecao(c.classificacao)}
                      aria-label={`Remover ${c.classificacao} da seleção`}
                      className="hover:text-red-700"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {contasSelecionadas.length > 1 && (
              <input
                type="text"
                value={nomeGrupo}
                onChange={(e) => setNomeGrupo(e.target.value)}
                placeholder="Nome do grupo (obrigatório com 2+ contas) — ex.: Custos de produção"
                className={inputClass}
              />
            )}

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Natureza"
                value={novaNatureza}
                onChange={(e) => setNovaNatureza(e.target.value === 'C' ? 'C' : 'D')}
                className="h-[22px] border border-brand-border/50 bg-white px-1.5 text-[9px] font-bold uppercase"
              >
                <option value="D">Devedora</option>
                <option value="C">Credora</option>
              </select>
              <button
                type="button"
                onClick={adicionarOverride}
                disabled={!podeAdicionarOverride}
                className="technical-button-primary h-[22px] px-2 flex items-center gap-1 text-[9px] font-black uppercase disabled:opacity-40 cursor-pointer"
              >
                <Plus size={12} />
                Adicionar override
              </button>
            </div>


          </div>

          <div className={sectionClass}>
            <p className={labelHint}>Overrides cadastrados ({draft.entries.length})</p>
            {draft.entries.length === 0 ? (
              <p className="text-[10px] opacity-60 text-center py-4 uppercase font-bold">
                Nenhuma conta classificada manualmente ainda.
              </p>
            ) : (
              <div className="border border-brand-border/40 divide-y divide-brand-border/30">
                {draft.entries.map((entry, idx) => {
                  const isGrupo = entry.classificacoes.length > 1;
                  return (
                    <div
                      key={entry.id}
                      className="p-2 flex flex-col gap-1.5 relative hover:bg-brand-sidebar/20 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          {isGrupo ? (
                            <button
                              type="button"
                              onClick={() => setDetalheEntryId(entry.id)}
                              className="text-left w-full"
                              title="Ver as contas deste grupo"
                            >
                              <div className="text-[10px] font-black uppercase underline decoration-dotted underline-offset-2">
                                {entry.nome || '(grupo sem nome)'}
                              </div>
                              <div className="text-[9px] uppercase opacity-70">
                                {entry.classificacoes.length} contas — clique para ver
                              </div>
                            </button>
                          ) : (
                            <>
                              <div className="text-[10px] font-mono font-black">{entry.classificacoes[0]}</div>
                              {entry.nome && (
                                <div className="text-[9px] uppercase opacity-70 truncate">{entry.nome}</div>
                              )}
                            </>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <div className="flex items-center gap-0.5 border-r border-brand-border/30 pr-1.5 mr-0.5">
                            <button
                              type="button"
                              onClick={() => moverParaCima(idx)}
                              disabled={idx === 0}
                              className="p-0.5 border border-brand-border/40 bg-white hover:bg-brand-sidebar/60 disabled:opacity-20 text-brand-dark transition-colors cursor-pointer"
                              title="Subir na sequência"
                              aria-label="Subir na sequência"
                            >
                              <ChevronUp size={11} />
                            </button>
                            <button
                              type="button"
                              onClick={() => moverParaBaixo(idx)}
                              disabled={idx === draft.entries.length - 1}
                              className="p-0.5 border border-brand-border/40 bg-white hover:bg-brand-sidebar/60 disabled:opacity-20 text-brand-dark transition-colors cursor-pointer"
                              title="Descer na sequência"
                              aria-label="Descer na sequência"
                            >
                              <ChevronDown size={11} />
                            </button>
                          </div>
                          <span
                            className={`text-[9px] font-black uppercase px-1.5 py-0.5 ${
                              entry.natureza === 'D'
                                ? 'bg-sky-700 text-white'
                                : 'bg-amber-700 text-white'
                            }`}
                          >
                            {entry.natureza === 'D' ? 'Devedora' : 'Credora'}
                          </span>
                          <button
                            type="button"
                            onClick={() => setInfoAberto(infoAberto === entry.id ? null : entry.id)}
                            className="text-brand-border hover:text-white p-1 transition-colors"
                            aria-label={`Informações sobre ${entry.nome ?? entry.classificacoes[0]}`}
                            title="Informações sobre natureza invertida"
                          >
                            <Info size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => removerOverride(entry.id)}
                            className="text-red-700 hover:text-red-600 p-1 cursor-pointer"
                            aria-label={`Remover ${entry.nome ?? entry.classificacoes[0]}`}
                            title="Remover"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>



                      {infoAberto === entry.id && (
                        <div className="absolute top-full left-0 right-0 mt-1 z-10 bg-brand-bg border border-brand-border p-2 rounded text-[9px] leading-relaxed shadow-lg">
                          <p className="font-bold uppercase mb-1">Natureza invertida (−)</p>
                          <p className="opacity-80">
                            Esta conta tem a natureza invertida em relação à conta pai. Contas com o sinal <strong>(−)</strong> na descrição indicam que sua natureza é <strong>oposta</strong> da natureza normal do grupo. O sistema respeita esse indicador e trata a conta com natureza invertida.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className={footerClass}>
          {draft.id !== NOVA_PASTA_ID && (
            <button
              type="button"
              onClick={excluir}
              className="text-red-700 hover:text-red-600 px-3 py-1.5 text-[10px] font-bold uppercase mr-auto"
            >
              Excluir pasta
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="technical-button px-3 py-1.5 text-[10px] font-bold uppercase"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={salvar}
            disabled={!podeSalvar}
            className="technical-button-primary px-4 py-1.5 text-[10px] font-black uppercase disabled:opacity-40"
          >
            Salvar
          </button>
        </div>
      </div>

      {detalheEntry && (
        <div
          className="fixed inset-0 z-[10010] flex items-center justify-center p-4 bg-black/60"
          role="dialog"
          aria-modal="true"
          onClick={() => setDetalheEntryId(null)}
        >
          <div
            className={
              contabil
                ? 'w-full max-w-md max-h-[70vh] overflow-hidden flex flex-col technical-panel bg-brand-bg shadow-[6px_6px_0_0_#141414]'
                : 'w-full max-w-md max-h-[70vh] overflow-hidden flex flex-col rounded-xl border border-violet-500/40 bg-slate-900 shadow-2xl'
            }
            onClick={(e) => e.stopPropagation()}
          >
            <div className={headerClass}>
              <div className="min-w-0">
                <h3 className={titleClass}>{detalheEntry.nome || '(grupo sem nome)'}</h3>
                <p className={contabil ? 'text-[9px] font-bold uppercase opacity-50 mt-1' : 'text-[10px] text-slate-400 mt-1'}>
                  {detalheEntry.classificacoes.length} conta(s) atrelada(s) a esta natureza (
                  {detalheEntry.natureza === 'D' ? 'Devedora' : 'Credora'}).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetalheEntryId(null)}
                className={
                  contabil
                    ? 'p-1 border border-brand-border hover:bg-brand-border hover:text-brand-bg transition-colors shrink-0'
                    : 'text-slate-400 hover:text-white text-lg leading-none px-2 shrink-0'
                }
                aria-label="Fechar detalhe do grupo"
              >
                {contabil ? <X size={16} strokeWidth={2.5} /> : '×'}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-brand-border/30">
              {detalheEntry.classificacoes.map((cls) => (
                <div key={cls} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-[10px] font-mono font-black">{cls}</div>
                    <div className="text-[9px] uppercase opacity-70 truncate">
                      {nomeDaClassificacao(cls) ?? '—'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removerContaDoGrupo(detalheEntry.id, cls)}
                    className="text-red-700 hover:text-red-600 p-1 shrink-0"
                    aria-label={`Remover ${cls} do grupo`}
                    title="Remover esta conta do grupo"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
            <div className={footerClass}>
              <button
                type="button"
                onClick={() => setDetalheEntryId(null)}
                className="technical-button px-3 py-1.5 text-[10px] font-bold uppercase"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal do Plano de Contas Sintético com Barra de Pesquisa */}
      {modalPlanoAberto && (
        <div
          className="fixed inset-0 z-[10020] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => {
            setModalPlanoAberto(false);
            setBuscaPlanoModal('');
          }}
        >
          <div
            className="bg-white border border-brand-border w-full max-w-xl shadow-2xl flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cabecalho do Modal */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-brand-sidebar border-b border-brand-border shrink-0">
              <div className="flex items-center gap-2">
                <BookOpen size={16} className="text-brand-dark" />
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-brand-dark">
                    Plano de Contas — Somente Contas Sintéticas
                  </h3>
                  <p className="text-[9px] opacity-70 uppercase font-mono">
                    Clique em uma conta sintética para adicionar ao override de natureza
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setModalPlanoAberto(false);
                  setBuscaPlanoModal('');
                }}
                className="p-1 hover:bg-brand-border/20 text-brand-dark transition-colors"
                aria-label="Fechar modal plano de contas"
              >
                <X size={16} />
              </button>
            </div>

            {/* Barra de Pesquisas */}
            <div className="p-3 border-b border-brand-border bg-gray-50/50 shrink-0">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  autoFocus
                  value={buscaPlanoModal}
                  onChange={(e) => setBuscaPlanoModal(e.target.value)}
                  placeholder="Pesquisar código ou descrição da conta sintética (ex: 1.01 ou CUSTOS)..."
                  className="w-full pl-8 pr-8 py-1.5 text-xs font-mono border border-brand-border focus:outline-none focus:ring-1 focus:ring-brand-dark"
                />
                {buscaPlanoModal && (
                  <button
                    type="button"
                    onClick={() => setBuscaPlanoModal('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            {/* Lista de Contas Sinteticas */}
            <div className="flex-1 overflow-y-auto divide-y divide-brand-border/20 p-1">
              {planoSinteticoRowsFiltradas.length === 0 ? (
                <div className="p-8 text-center text-xs opacity-60 font-mono">
                  Nenhuma conta sintética encontrada para "{buscaPlanoModal}".
                </div>
              ) : (
                planoSinteticoRowsFiltradas.map((conta) => {
                  const jaSelecionada = contasSelecionadas.some(
                    (c) => normCls(c.classificacao) === normCls(conta.codigo),
                  );
                  return (
                    <div
                      key={conta.codigo}
                      onClick={() => {
                        if (!jaSelecionada) {
                          setContasSelecionadas((prev) => [
                            ...prev,
                            { classificacao: conta.codigo, nome: conta.nome },
                          ]);
                        }
                        setModalPlanoAberto(false);
                        setBuscaPlanoModal('');
                      }}
                      className={`flex items-center justify-between px-3 py-2 cursor-pointer transition-colors text-xs font-mono ${
                        jaSelecionada
                          ? 'bg-blue-50/80 text-blue-900 font-bold border-l-4 border-l-blue-600'
                          : 'hover:bg-brand-sidebar/30 text-gray-800'
                      }`}
                    >
                      <div className="flex items-baseline gap-3 min-w-0">
                        <span className="font-bold shrink-0 text-brand-dark">{conta.codigo}</span>
                        <span className="truncate font-sans font-medium">{conta.nome}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        {conta.nivel && (
                          <span className="text-[9px] px-1.5 py-0.5 bg-gray-100 border border-gray-200 text-gray-600 font-sans">
                            Nível {conta.nivel}
                          </span>
                        )}
                        {jaSelecionada ? (
                          <span className="text-[9px] font-bold text-blue-700 bg-blue-100 px-1.5 py-0.5 uppercase">
                            Selecionada
                          </span>
                        ) : (
                          <span className="text-[9px] font-bold text-gray-500 hover:text-brand-dark uppercase">
                            Selecionar
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Rodape do Modal */}
            <div className="px-4 py-2 border-t border-brand-border bg-gray-50 text-[10px] text-gray-500 font-mono flex items-center justify-between shrink-0">
              <span>{planoSinteticoRowsFiltradas.length} de {planoSinteticoRows.length} contas sintéticas</span>
              <button
                type="button"
                onClick={() => {
                  setModalPlanoAberto(false);
                  setBuscaPlanoModal('');
                }}
                className="px-3 py-1 bg-gray-200 hover:bg-gray-300 font-bold uppercase text-gray-700 text-[9px] cursor-pointer"
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
