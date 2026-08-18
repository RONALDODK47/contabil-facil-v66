import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Copy, ListOrdered, Plus, Trash2, X } from 'lucide-react';
import { cn } from '../lib/utils';
import type { ExtratoRegraConta, ExtratoRegraContaNature } from '../logic/extratoRegrasContasStorage';
import {
  addExtratoRegraConta,
  filterExtratoRegrasPorBanco,
  loadExtratoRegrasBancoSelecionado,
  normalizeExtratoRegraTexto,
  normContaBancoCode,
  replicateExtratoRegrasParaBanco,
  saveExtratoRegrasBancoSelecionado,
  saveExtratoRegrasContas,
} from '../logic/extratoRegrasContasStorage';
import { setExtratoContaBancoAtiva } from '../logic/extratoOcrLayoutStorage';
import {
  isClassificacaoHierarquica,
  resolveCodigoReduzidoDoPlano,
  sanitizeCodigoReduzido,
} from '../logic/planoContasMapper';
import {
  findUncoveredExtratoRows,
} from '../logic/extratoRegrasCobertura';
import { CF_FORM_INPUT_LONG } from '../lib/formFieldClasses';
import ExtratoContaPicker from './ExtratoContaPicker';
import ExtratoHistoricoPicker from './ExtratoHistoricoPicker';

export type PlanoOption = {
  code: string;
  name: string;
  codigoReduzido?: string;
  tipo?: 'S' | 'A';
  nivel?: number;
  /** Grupo contábil (ATIVO, PASSIVO, etc.). */
  group?: 'ATIVO' | 'PASSIVO' | 'PATRIMONIO_LIQUIDO' | 'RECEITA' | 'DESPESA' | 'CUSTO';
};

export type ExtratoRegrasContasModalProps = {
  open: boolean;
  company: string;
  regras: ExtratoRegraConta[];
  /** Contas de contrapartida (sem banco/caixa). */
  planoOptions: PlanoOption[];
  /** Plano ampliado para resolver nomes (inclui sintéticas). */
  planoLookupOptions?: PlanoOption[];
  /** Contas banco do plano (para configurar o lado banco). */
  bancoOptions: PlanoOption[];
  defaultContaBanco?: string;
  /** Amostra do extrato para puxar históricos sem regra. */
  extratoSample?: Array<{ description: string; nature: string; value: number }>;
  onClose: () => void;
  onChange: (next: ExtratoRegraConta[]) => void;
  /** Chamado quando a conta banco da conciliação é definida/alterada. */
  onContaBancoChange?: (contaBanco: string) => void;
  onReaplicar?: () => void | Promise<void>;
};

const INPUT_REGRA_CLS = cn(
  CF_FORM_INPUT_LONG,
  'max-w-none w-full h-[26px] text-[10px] uppercase',
);

/** Evita formulário esticado em monitores largos. */
const REGRAS_CONTENT_MAX = 'w-full max-w-3xl mx-auto';

type RegraEditableRowProps = {
  regra: ExtratoRegraConta;
  planoOptions: PlanoOption[];
  planoLookup: PlanoOption[];
  onUpdate: (id: string, patch: Partial<Omit<ExtratoRegraConta, 'id'>>) => void;
  onRemove: (id: string) => void;
};

const ExtratoRegraContaEditableRow = memo(function ExtratoRegraContaEditableRow({
  regra,
  planoOptions,
  planoLookup,
  onUpdate,
  onRemove,
}: RegraEditableRowProps) {
  const [descricaoDraft, setDescricaoDraft] = useState(regra.descricao);

  useEffect(() => {
    setDescricaoDraft(regra.descricao);
  }, [regra.descricao]);

  const commitDescricao = useCallback(() => {
    const descricaoManual = descricaoDraft.trim();
    if (!normalizeExtratoRegraTexto(descricaoManual) || descricaoManual === regra.descricao) {
      setDescricaoDraft(regra.descricao);
      return;
    }
    onUpdate(regra.id, { descricao: descricaoManual, nome: descricaoManual.slice(0, 40) });
  }, [descricaoDraft, onUpdate, regra.descricao, regra.id]);

  return (
    <li className="border border-brand-border/40 p-2.5 bg-white space-y-2">
      <div className="space-y-2 max-w-2xl">
        <div className="min-w-0">
          <label
            htmlFor={`regra-desc-${regra.id}`}
            className="font-bold uppercase text-brand-text/45 block text-[8px] mb-0.5"
          >
            Histórico no extrato
          </label>
          <input
            id={`regra-desc-${regra.id}`}
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
            className={INPUT_REGRA_CLS}
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

export default memo(function ExtratoRegrasContasModal({
  open,
  company,
  regras,
  planoOptions,
  planoLookupOptions,
  bancoOptions,
  defaultContaBanco = '',
  extratoSample = [],
  onClose,
  onChange,
  onContaBancoChange,
  onReaplicar,
}: ExtratoRegrasContasModalProps) {
  const [selectedBanco, setSelectedBanco] = useState(defaultContaBanco);
  const [draftDescricao, setDraftDescricao] = useState('');
  const [draftNature, setDraftNature] = useState<ExtratoRegraContaNature>('D');
  const [draftConta, setDraftConta] = useState('');
  const [bancoSavedOk, setBancoSavedOk] = useState(false);
  const [addError, setAddError] = useState('');
  const [replicateTarget, setReplicateTarget] = useState('');
  const [replicateMsg, setReplicateMsg] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [padraoHistoricoPick, setPadraoHistoricoPick] = useState('');
  const regrasListRef = useRef<HTMLDivElement>(null);

  const allPlano = useMemo(() => [...bancoOptions, ...planoOptions], [bancoOptions, planoOptions]);
  const planoLookup = useMemo(
    () => (planoLookupOptions?.length ? planoLookupOptions : allPlano),
    [allPlano, planoLookupOptions],
  );

  const toReduzido = useCallback(
    (code: string) => resolveCodigoReduzidoDoPlano(code, allPlano),
    [allPlano],
  );

  const matchBancoCode = useCallback(
    (code: string) => {
      if (!code.trim()) return '';
      const asRed = toReduzido(code);
      if (asRed) return asRed;
      const exactRed = bancoOptions.find(
        (b) => sanitizeCodigoReduzido(b.codigoReduzido) === sanitizeCodigoReduzido(code),
      );
      if (exactRed) return sanitizeCodigoReduzido(exactRed.codigoReduzido) || '';
      const byClassif = bancoOptions.find((b) => b.code === code);
      if (byClassif) return sanitizeCodigoReduzido(byClassif.codigoReduzido) || '';
      return sanitizeCodigoReduzido(code) || '';
    },
    [bancoOptions, toReduzido],
  );

  useEffect(() => {
    // Sync selectedBanco with defaultContaBanco when it changes (e.g., after importing a statement).
    if (!defaultContaBanco) return;
    const resolved = matchBancoCode(defaultContaBanco);
    if (!resolved) return;
    // Compare by digits only to avoid spurious updates from formatting differences
    const normResolved = resolved.replace(/\D/g, '');
    const normCurrent = selectedBanco.replace(/\D/g, '');
    if (normResolved && normResolved !== normCurrent) {
      setSelectedBanco(resolved);
      // Persist selection
      saveExtratoRegrasBancoSelecionado(company, resolved);
      const bancoOpt = bancoOptions.find(
        (b) => sanitizeCodigoReduzido(b.codigoReduzido) === resolved || b.code === resolved,
      );
      setExtratoContaBancoAtiva(company, resolved, bancoOpt?.name);
      onContaBancoChange?.(resolved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedBanco não deve ser dep (loop)
  }, [defaultContaBanco, matchBancoCode, company, bancoOptions, onContaBancoChange]);

  const companyWhenOpenedRef = useRef(company);

  useEffect(() => {
    if (!open) {
      companyWhenOpenedRef.current = company;
      return;
    }
    if (companyWhenOpenedRef.current !== company) {
      companyWhenOpenedRef.current = company;
      onClose();
    }
  }, [open, company, onClose]);

  useEffect(() => {
    if (!open) return;

    const saved = loadExtratoRegrasBancoSelecionado(company, defaultContaBanco);
    const pick =
      matchBancoCode(defaultContaBanco) ||
      matchBancoCode(saved) ||
      (bancoOptions[0] ? sanitizeCodigoReduzido(bancoOptions[0].codigoReduzido) || '' : '') ||
      '';
    setSelectedBanco(pick);
    if (pick) saveExtratoRegrasBancoSelecionado(company, pick);
    setDraftDescricao('');
    setDraftNature('D');
    setDraftConta('');
    setPadraoHistoricoPick('');
    setBancoSavedOk(false);
    setAddError('');
    setReplicateTarget('');
    setReplicateMsg('');
    // Migração/consolidação roda no ManagerModule ao carregar — não repetir aqui (evita freeze e sobrescrever exclusões).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset UI ao abrir
  }, [open, company, defaultContaBanco, bancoOptions, matchBancoCode]);

  const regrasDoBanco = useMemo(
    () => filterExtratoRegrasPorBanco(regras, selectedBanco),
    [regras, selectedBanco],
  );
  const filteredRegrasDoBanco = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return regrasDoBanco;
    return regrasDoBanco.filter((regra) => {
      const desc = (regra.descricao || '').toLowerCase();
      const nome = (regra.nome || '').toLowerCase();
      const conta = (regra.contaContrapartida || '').toLowerCase();
      return desc.includes(term) || nome.includes(term) || conta.includes(term);
    });
  }, [regrasDoBanco, searchTerm]);

  const uncoveredRows = useMemo(
    () => findUncoveredExtratoRows(extratoSample, regrasDoBanco),
    [extratoSample, regrasDoBanco],
  );

  const padroesHistoricoExtrato = useMemo(() => {
    // Agrupamento EXATO: chave = natureza + descrição original (sem normalizar/fundir textos diferentes).
    // Isso garante que "2x" significa exatamente 2 lançamentos com o MESMO texto no extrato,
    // evitando que descrições diferentes caiam na mesma entrada e gerem regra errada.
    const map = new Map<
      string,
      { descricao: string; nature: ExtratoRegraContaNature; ocorrencias: number }
    >();
    for (const row of uncoveredRows) {
      const nature: ExtratoRegraContaNature = row.nature === 'C' ? 'C' : 'D';
      const descricaoOriginal = String(row.description ?? '').replace(/\s+/g, ' ').trim();
      if (!descricaoOriginal) continue;
      // Chave exata: natureza + texto original (case-insensitive para evitar duplicatas triviais)
      const key = `${nature}|${descricaoOriginal.toUpperCase()}`;
      const cur = map.get(key);
      if (cur) {
        cur.ocorrencias += 1;
      } else {
        map.set(key, { descricao: descricaoOriginal, nature, ocorrencias: 1 });
      }
    }
    return [...map.values()].sort((a, b) => b.ocorrencias - a.ocorrencias);
  }, [uncoveredRows]);

  const outrosBancos = useMemo(() => {
    const atual = sanitizeCodigoReduzido(selectedBanco) || selectedBanco.trim();
    return bancoOptions.filter((b) => {
      const red = sanitizeCodigoReduzido(b.codigoReduzido) || '';
      return red && red !== atual;
    });
  }, [bancoOptions, selectedBanco]);

  const applyContaBanco = useCallback(
    (code: string) => {
      const resolved = matchBancoCode(code);
      if (!resolved) {
        setAddError('Use o CÓDIGO REDUZIDO da conta banco — classificação (ex.: 1.1.10…) é proibida.');
        return;
      }
      setSelectedBanco(resolved);
      saveExtratoRegrasBancoSelecionado(company, resolved);
      const bancoOpt = bancoOptions.find(
        (b) => sanitizeCodigoReduzido(b.codigoReduzido) === resolved || b.code === code,
      );
      setExtratoContaBancoAtiva(company, resolved, bancoOpt?.name);
      // Notify parent about bank change to refresh rules display
      onContaBancoChange?.(resolved);
      // Also increment tick in ManagerModule via callback (handled there)
      setBancoSavedOk(true);
      setAddError('');
      window.setTimeout(() => setBancoSavedOk(false), 2500);
    },
    [bancoOptions, company, matchBancoCode, onContaBancoChange],
  );

  /** Permite apagar o campo e digitar outro código; só confirma quando o reduzido é válido. */
  const handleBancoChange = useCallback(
    (code: string) => {
      const trimmed = code.trim();
      if (!trimmed) {
        setSelectedBanco('');
        setAddError('');
        setBancoSavedOk(false);
        return;
      }
      if (isClassificacaoHierarquica(trimmed)) {
        setSelectedBanco(trimmed);
        setAddError('Use o CÓDIGO REDUZIDO da conta banco — classificação é proibida.');
        return;
      }
      const resolved = matchBancoCode(trimmed);
      if (resolved && sanitizeCodigoReduzido(resolved)) {
        applyContaBanco(resolved);
        return;
      }
      // Digitação parcial — mantém o que o usuário digitou sem travar
      setSelectedBanco(trimmed);
      setAddError('');
    },
    [applyContaBanco, matchBancoCode],
  );

  const handleReplicate = useCallback(() => {
    const target = sanitizeCodigoReduzido(replicateTarget) || matchBancoCode(replicateTarget);
    const origem = sanitizeCodigoReduzido(selectedBanco) || matchBancoCode(selectedBanco);
    if (!origem) {
      setReplicateMsg('Selecione o banco de origem (conta ativa) com as regras.');
      return;
    }
    if (!target) {
      setReplicateMsg('Escolha o banco de destino (código reduzido).');
      return;
    }
    if (normContaBancoCode(origem) === normContaBancoCode(target)) {
      setReplicateMsg('Origem e destino são o mesmo banco.');
      return;
    }
    // Usa as regras visíveis na tela (não só o storage) — evita falha silenciosa.
    const sourceRules =
      regrasDoBanco.length > 0
        ? regrasDoBanco
        : filterExtratoRegrasPorBanco(regras, origem);
    if (sourceRules.length === 0) {
      setReplicateMsg(
        'Não há regras neste banco para replicar. Cadastre regras no banco de origem primeiro.',
      );
      return;
    }
    const result = replicateExtratoRegrasParaBanco(company, origem, target, sourceRules);
    onChange(result.regras);
    const destLabel =
      bancoOptions.find((b) => sanitizeCodigoReduzido(b.codigoReduzido) === target)?.name || target;
    if (result.added === 0) {
      setReplicateMsg(
        result.skipped > 0
          ? `Nada novo: ${result.skipped} regra(s) já existiam em ${destLabel}.`
          : 'Nenhuma regra replicada.',
      );
      setReplicateTarget('');
      return;
    }
    setReplicateMsg(
      `Replicadas ${result.added} regra(s) para ${target} — ${destLabel}` +
      (result.skipped ? ` (${result.skipped} já existiam)` : ''),
    );
    setReplicateTarget('');
  }, [
    bancoOptions,
    company,
    matchBancoCode,
    onChange,
    regras,
    regrasDoBanco,
    replicateTarget,
    selectedBanco,
  ]);

  const persist = useCallback(
    (next: ExtratoRegraConta[]) => {
      onChange(saveExtratoRegrasContas(company, next, undefined, { consolidate: false }));
    },
    [company, onChange],
  );

  const handleRemove = useCallback(
    (id: string) => {
      const next = regras.filter((r) => r.id !== id);
      onChange(saveExtratoRegrasContas(company, next, undefined, { consolidate: false }));
    },
    [company, onChange, regras],
  );

  const handleUpdateRegra = useCallback(
    (id: string, patch: Partial<Omit<ExtratoRegraConta, 'id'>>) => {
      const next = regras.map((r) => {
        if (r.id !== id) return r;
        const descricao = patch.descricao !== undefined ? patch.descricao.trim() : r.descricao;
        const contraRaw = patch.contaContrapartida ?? r.contaContrapartida;
        const contraRed = toReduzido(contraRaw) || sanitizeCodigoReduzido(contraRaw);
        if (!normalizeExtratoRegraTexto(descricao) || !contraRed) return r;
        const nature: ExtratoRegraContaNature =
          patch.nature === 'C' ? 'C' : patch.nature === 'D' ? 'D' : r.nature;
        return {
          ...r,
          ...patch,
          descricao,
          nome: (patch.nome ?? descricao).slice(0, 40),
          nature,
          contaContrapartida: contraRed,
        };
      });
      onChange(saveExtratoRegrasContas(company, next, undefined, { consolidate: false }));
    },
    [company, onChange, regras, toReduzido],
  );

  const handleAdd = useCallback(() => {
    const descricao = draftDescricao.trim();
    const contraRed = toReduzido(draftConta) || sanitizeCodigoReduzido(draftConta);
    if (!selectedBanco.trim()) {
      setAddError('Selecione uma conta banco primeiro!');
      return;
    }
    if (!normalizeExtratoRegraTexto(descricao)) {
      setAddError('Informe o histórico no extrato!');
      return;
    }
    if (!contraRed) {
      setAddError(
        isClassificacaoHierarquica(draftConta)
          ? 'PROIBIDO usar classificação (ex.: 2.1.10.100.001). Selecione o CÓDIGO REDUZIDO.'
          : 'Informe o código reduzido da contrapartida.',
      );
      return;
    }
    setAddError('');
    persist(
      addExtratoRegraConta(company, {
        nome: descricao.slice(0, 40),
        descricao,
        nature: draftNature,
        contaBanco: selectedBanco.trim(),
        contaContrapartida: contraRed,
      }),
    );
    setDraftDescricao('');
    setDraftNature('D');
    setDraftConta('');
    setPadraoHistoricoPick('');
  }, [company, draftConta, draftDescricao, draftNature, persist, selectedBanco, toReduzido]);

  const contraDigitadaInvalida = useMemo(() => {
    const raw = draftConta.trim();
    if (!raw) return false;
    return !Boolean(toReduzido(raw) || sanitizeCodigoReduzido(raw));
  }, [draftConta, toReduzido]);

  const bancoLabel = useCallback(
    (code: string) => {
      const red = sanitizeCodigoReduzido(code) || code;
      const hit =
        bancoOptions.find((p) => sanitizeCodigoReduzido(p.codigoReduzido) === red) ||
        bancoOptions.find((p) => p.code === code);
      if (!hit) return red;
      const r = sanitizeCodigoReduzido(hit.codigoReduzido);
      return r ? `${r} — ${hit.name}` : `${hit.code} — ${hit.name}`;
    },
    [bancoOptions],
  );

  const handleRemoveAllDoBanco = useCallback(() => {
    if (regrasDoBanco.length === 0 || !selectedBanco.trim()) return;
    const label = bancoLabel(selectedBanco);
    const msg = `Remover todas as ${regrasDoBanco.length} regra(s) do banco ${label}? Esta ação não pode ser desfeita.`;
    if (!window.confirm(msg)) return;
    const norm = normContaBancoCode(selectedBanco);
    const next = regras.filter((r) => normContaBancoCode(r.contaBanco) !== norm);
    onChange(saveExtratoRegrasContas(company, next, undefined, { consolidate: false }));
  }, [bancoLabel, company, onChange, regras, regrasDoBanco.length, selectedBanco]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[81] flex items-center justify-center p-3 bg-black/50">
      <div
        className="technical-panel shadow-[6px_6px_0_0_#141414] w-full max-w-4xl max-h-[92vh] h-[92vh] min-h-0 flex flex-col overflow-hidden"
        role="dialog"
        aria-labelledby="extrato-regras-contas-title"
      >
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-brand-border bg-brand-sidebar/40 shrink-0">
          <div className="flex-1 min-w-0">
            <h2
              id="extrato-regras-contas-title"
              className="text-sm font-black uppercase tracking-widest inline-flex items-center gap-2"
            >
              <ListOrdered size={16} aria-hidden="true" />
              Regras de Contas {selectedBanco ? ` · ${bancoLabel(selectedBanco)}` : ''}
            </h2>
            {selectedBanco && (
              <span className="ml-2 px-2 py-0.5 bg-brand-border text-brand-bg text-[8px] font-black uppercase tracking-tighter">
                Banco Atual
              </span>
            )}
            <p className="text-[9px] text-slate-600 mt-0.5 leading-snug">
              Cadastro manual — puxe históricos do extrato ou digite a descrição e a contrapartida
              (código reduzido).
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

        {/* Corpo rolável: banco + regras */}
        <div className="flex-1 min-h-0 overflow-y-scroll overscroll-contain px-3">
          <div className={cn('p-3 border-b border-brand-border bg-white space-y-2', REGRAS_CONTENT_MAX)}>
            <div className="flex items-center gap-2 flex-wrap">
              <Building2 size={14} className="text-brand-text/70 shrink-0" aria-hidden="true" />
              <p className="text-[9px] font-black uppercase tracking-wider">
                Conta contábil do banco
              </p>
              {bancoSavedOk ? (
                <span className="text-[8px] font-bold uppercase text-green-700 border border-green-600 bg-green-50 px-1.5 py-0.5">
                  Salva para conciliação
                </span>
              ) : null}
            </div>
            <p className="text-[9px] text-brand-text/55 leading-snug max-w-2xl">
              Banco selecionado para estas regras (baseado no extrato importado).
            </p>
            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-1.5 min-w-0">
                <div className="flex items-center gap-3 px-3 py-2 bg-brand-sidebar/20 border border-brand-border/40">
                   <div className="w-1.5 h-1.5 rounded-full bg-green-600 animate-pulse" />
                   <p className="text-[10px] font-mono font-black uppercase text-brand-text/90">
                     {selectedBanco ? bancoLabel(selectedBanco) : 'Nenhum banco vinculado'}
                   </p>
                </div>
              </div>

              {selectedBanco && sanitizeCodigoReduzido(selectedBanco) && outrosBancos.length > 0 ? (
                <div className="space-y-1.5 min-w-0 border border-brand-border/40 p-2 bg-brand-sidebar/10">
                  <p className="text-[9px] font-black uppercase tracking-wider text-brand-text/70">
                    Replicar regras para outro banco
                  </p>
                  <p className="text-[8px] text-brand-text/50 leading-snug">
                    Copia as {regrasDoBanco.length} regra(s) deste banco (sem duplicar).
                  </p>
                  <div className="flex gap-2 items-stretch">
                    <div className="flex-1 min-w-0">
                      <ExtratoContaPicker
                        value={replicateTarget}
                        options={outrosBancos}
                        placeholder="Banco de destino (código reduzido)…"
                        ariaLabel="Banco de destino para replicar regras"
                        onChange={(code) => {
                          setReplicateTarget(code);
                          setReplicateMsg('');
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleReplicate}
                      disabled={!replicateTarget.trim() || regrasDoBanco.length === 0}
                      className="technical-button text-[9px] py-1 px-3 inline-flex items-center justify-center gap-1 disabled:opacity-40 shrink-0"
                    >
                      <Copy size={12} aria-hidden="true" />
                      Replicar
                    </button>
                  </div>
                  {replicateMsg ? (
                    <p className="text-[9px] font-bold text-green-800 uppercase leading-snug">
                      {replicateMsg}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className={cn('flex flex-col min-h-0 border-b border-brand-border/40', REGRAS_CONTENT_MAX)}>
            <div className="p-3 space-y-2 shrink-0">
              <p className="text-[9px] font-black uppercase tracking-widest text-brand-text/60">
                Nova regra · contrapartida (código reduzido) ·{' '}
                {bancoLabel(selectedBanco) || 'sem banco'}
              </p>
              {uncoveredRows.length > 0 ? (
                <p className="text-[8px] text-amber-800">
                  {uncoveredRows.length} padrão(ões) do extrato ainda sem regra.
                </p>
              ) : extratoSample.length > 0 ? (
                <p className="text-[8px] text-green-800">
                  Todos os lançamentos do extrato têm regra neste banco.
                </p>
              ) : null}
              <div className="space-y-3 max-w-2xl">
                {padroesHistoricoExtrato.length > 0 ? (
                  <div className="space-y-1">
                    <label
                      htmlFor="regra-padrao-historico"
                      className="text-[8px] font-bold uppercase text-brand-text/50 block"
                    >
                      Puxar histórico do extrato ({padroesHistoricoExtrato.length} sem regra)
                    </label>
                    <ExtratoHistoricoPicker
                      buttonId="regra-padrao-historico"
                      padroes={padroesHistoricoExtrato}
                      value={padraoHistoricoPick}
                      disabled={!selectedBanco}
                      placeholder="Buscar histórico do extrato…"
                      onSelect={(hit) => {
                        const key = `${hit.nature}|${hit.descricao}`;
                        setPadraoHistoricoPick(key);
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
                    htmlFor="regra-historico-nova"
                    className="text-[8px] font-bold uppercase text-brand-text/50 block"
                  >
                    Histórico no extrato (texto que identifica o lançamento)
                  </label>
                  <input
                    id="regra-historico-nova"
                    type="text"
                    aria-label="Histórico no extrato"
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
                    placeholder="Ex.: PIX EMITIDO, TARIFA, PAGAMENTO FORNECEDOR…"
                    className={INPUT_REGRA_CLS}
                    disabled={!selectedBanco}
                  />
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                  <div className="w-full sm:w-[88px] shrink-0">
                    <p className="text-[8px] font-bold uppercase text-brand-text/50 mb-0.5">
                      Natureza
                    </p>
                    <div className="flex border border-brand-border h-[26px]">
                      <button
                        type="button"
                        onClick={() => setDraftNature('D')}
                        disabled={!selectedBanco}
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
                        disabled={!selectedBanco}
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
                      <p className="text-[8px] font-bold uppercase text-brand-text/50">
                        Cód. reduzido
                      </p>
                      <p className="text-[8px] font-bold uppercase text-brand-text/50">
                        Descrição da conta
                      </p>
                    </div>
                    <ExtratoContaPicker
                      value={draftConta}
                      options={planoOptions}
                      lookupOptions={planoLookup}
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
                    disabled={!selectedBanco.trim()}
                    className="technical-button-primary text-[9px] py-1 px-4 shrink-0 inline-flex items-center justify-center gap-1 disabled:opacity-40 min-h-[26px] w-full sm:w-auto"
                  >
                    <Plus size={12} aria-hidden="true" />
                    ADD
                  </button>
                  {contraDigitadaInvalida ? (
                    <p className="text-[9px] text-rose-700 font-bold uppercase w-full mt-1">
                      Informe um código reduzido numérico da contrapartida.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            <div
              id="regras-do-banco-lista"
              ref={regrasListRef}
              className="p-3 pt-0 space-y-2 scroll-mt-2 transition-shadow"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-brand-text/60">
                  Regras deste banco · {regrasDoBanco.length}
                </p>
                {regrasDoBanco.length > 0 ? (
                  <button
                    type="button"
                    onClick={handleRemoveAllDoBanco}
                    className="technical-button text-[8px] py-1 px-2 inline-flex items-center gap-1 shrink-0 text-rose-800 border-rose-300 hover:bg-rose-50"
                    title="Remove todas as regras deste banco"
                  >
                    <Trash2 size={11} aria-hidden="true" />
                    Remover todas
                  </button>
                ) : null}
              </div>
              {regrasDoBanco.length > 0 ? (
                <p className="text-[8px] text-brand-text/50 leading-snug">
                  Edite descrição, natureza ou contrapartida diretamente em cada regra. As alterações
                  são salvas ao sair do campo ou ao trocar a conta.
                </p>
              ) : null}
              {regrasDoBanco.length === 0 ? (
                <p className="text-[10px] text-brand-text/45 italic text-center py-8">
                  Nenhuma regra para este banco. Cadastre manualmente abaixo ou puxe um histórico
                  do extrato.
                </p>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="text"
                      placeholder="Buscar por nome ou código…"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className={INPUT_REGRA_CLS}
                      aria-label="Buscar regras"
                    />
                  </div>
                  <ul className="space-y-2">
                    {filteredRegrasDoBanco.map((regra) => (
                      <ExtratoRegraContaEditableRow
                        key={regra.id}
                        regra={regra}
                        planoOptions={planoOptions}
                        planoLookup={planoLookup}
                        onUpdate={handleUpdateRegra}
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
          {onReaplicar ? (
            <button
              type="button"
              onClick={() => {
                if (selectedBanco.trim()) applyContaBanco(selectedBanco);
                // Próximo tick: options do Manager já refletem o banco/regras salvos
                window.setTimeout(() => {
                  void Promise.resolve(onReaplicar()).finally(() => {
                    onClose();
                  });
                }, 80);
              }}
              disabled={regras.length === 0 && !selectedBanco.trim()}
              className="technical-button-primary text-[10px] py-1 px-4 disabled:opacity-40"
              title="Aplica as contas das regras na tabela de conciliação (débito/crédito)"
            >
              Salvar e aplicar na conciliação
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
});
