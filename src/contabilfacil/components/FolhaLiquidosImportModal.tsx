import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { FileUp, Loader2, Users, X } from 'lucide-react';
import { cn } from '../lib/utils';
import type { ExtratoRegraConta } from '../logic/extratoRegrasContasStorage';
import { REGRA_COMPETENCIA_JANELA_PADRAO } from '../logic/extratoRegrasContasStorage';
import type { ParsedFolhaLiquidos } from '../logic/folhaLiquidosParser';
import { competenciaOrdem, extractFolhaLiquidosDoPdf } from '../logic/folhaLiquidosParser';
import type {
  FolhaEstrategia,
  FolhaLinhaExtrato,
  PlanoFolha,
} from '../logic/folhaLiquidosRegras';
import { montarPlanoFolha, regrasDaFolha } from '../logic/folhaLiquidosRegras';
import { isClassificacaoHierarquica, sanitizeCodigoReduzido } from '../logic/planoContasMapper';
import ExtratoContaPicker from './ExtratoContaPicker';
import { formatValorBR } from './ExtratoLancamentoValorPicker';
import type { PlanoOption } from './ExtratoRegrasContasModal';

export type FolhaLiquidosImportModalProps = {
  open: boolean;
  /** Conta banco (código reduzido) a que as regras pertencem. */
  contaBanco: string;
  bancoLabel: string;
  planoOptions: PlanoOption[];
  planoLookupOptions?: PlanoOption[];
  extratoSample: FolhaLinhaExtrato[];
  onClose: () => void;
  /** Grava as regras montadas (sem id — o storage gera). */
  onImportar: (regras: Array<Omit<ExtratoRegraConta, 'id'>>) => void;
};

const ESTRATEGIAS: Array<{ id: FolhaEstrategia; label: string; hint: string }> = [
  {
    id: 'auto',
    label: 'Automático',
    hint: 'Procura o nome (encurtando até achar); se não achar, tenta o documento; por último, o valor da competência.',
  },
  {
    id: 'historico',
    label: 'Só histórico',
    hint: 'Casa sempre pelo nome do funcionário no histórico — encurtando o nome até encontrar.',
  },
  {
    id: 'documento',
    label: 'Só identidade/CPF',
    hint: 'Procura o documento no histórico, aceitando número mascarado (só o começo ou só o fim visível).',
  },
  {
    id: 'valor',
    label: 'Só valor da competência',
    hint: 'Casa pelo valor exato do líquido, restrito às datas da competência.',
  },
];

/** Rótulo formal de como o funcionário é localizado no extrato. */
const CRITERIO_LABEL: Record<string, string> = {
  historico: 'Histórico do extrato',
  documento: 'Identidade / CPF',
  valor: 'Valor do líquido',
};

const CRITERIO_BADGE: Record<string, string> = {
  historico: 'bg-brand-text text-white',
  documento: 'bg-indigo-600 text-white',
  valor: 'bg-emerald-600 text-white',
};

export default memo(function FolhaLiquidosImportModal({
  open,
  contaBanco,
  bancoLabel,
  planoOptions,
  planoLookupOptions,
  extratoSample,
  onClose,
  onImportar,
}: FolhaLiquidosImportModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState('');
  const [parsed, setParsed] = useState<ParsedFolhaLiquidos | null>(null);
  const [competenciasOff, setCompetenciasOff] = useState<Set<string>>(new Set());
  const [estrategia, setEstrategia] = useState<FolhaEstrategia>('auto');
  const [contaPadrao, setContaPadrao] = useState('');

  const competenciasSelecionadas = useMemo(
    () =>
      (parsed?.competencias ?? [])
        .map((c) => c.competencia)
        .filter((c) => !competenciasOff.has(c)),
    [parsed, competenciasOff],
  );

  const plano: PlanoFolha | null = useMemo(() => {
    if (!parsed || parsed.competencias.length === 0) return null;
    return montarPlanoFolha({
      parsed,
      competenciasSelecionadas,
      extrato: extratoSample,
      estrategia,
      contaPadrao: sanitizeCodigoReduzido(contaPadrao) || contaPadrao.trim(),
    });
  }, [parsed, competenciasSelecionadas, extratoSample, estrategia, contaPadrao]);

  const totalRegras = useMemo(() => {
    if (!plano) return 0;
    return plano.funcionarios.reduce((acc, f) => {
      if (!f.conta.trim()) return acc;
      return acc + (f.estrategia === 'valor' ? f.competencias.length : 1);
    }, 0);
  }, [plano]);

  /**
   * Uma linha por funcionário × competência — é o que o usuário confere antes
   * de importar: de qual mês é o lançamento, de quem, o documento e o valor.
   */
  const linhasPrevia = useMemo(() => {
    const linhas = (plano?.funcionarios ?? []).flatMap((f) =>
      f.competencias.map((c) => ({
        chave: f.chave,
        nome: f.nome,
        identidade: f.identidade,
        competencia: c.competencia,
        valor: c.valor,
        estrategia: f.estrategia,
        motivo: f.motivo,
        correspondencias: c.correspondencias,
      })),
    );
    return linhas.sort(
      (a, b) =>
        competenciaOrdem(a.competencia) - competenciaOrdem(b.competencia) ||
        a.nome.localeCompare(b.nome, 'pt-BR'),
    );
  }, [plano]);

  const contaFaltando = (plano?.funcionarios ?? []).some((f) => !f.conta.trim());

  const handleArquivo = useCallback(async (file: File | null) => {
    if (!file) return;
    setLendo(true);
    setErro('');
    setParsed(null);
    setCompetenciasOff(new Set());
    try {
      const result = await extractFolhaLiquidosDoPdf(file);
      if (result.competencias.length === 0) {
        setErro(result.issues[0] || 'Não foi possível ler os líquidos deste PDF.');
        return;
      }
      setParsed(result);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao ler o PDF.');
    } finally {
      setLendo(false);
    }
  }, []);

  const handleImportar = useCallback(() => {
    if (!plano || !contaBanco.trim()) return;
    const regras = regrasDaFolha({
      plano,
      contaBanco,
      janela: REGRA_COMPETENCIA_JANELA_PADRAO,
    });
    if (regras.length === 0) {
      setErro('Nenhuma regra para importar — informe a conta de contrapartida.');
      return;
    }
    onImportar(regras);
  }, [contaBanco, onImportar, plano]);

  if (!open) return null;

  const contaPadraoInvalida =
    contaPadrao.trim().length > 0 &&
    (isClassificacaoHierarquica(contaPadrao) || !sanitizeCodigoReduzido(contaPadrao));

  return (
    <div className="fixed inset-0 z-[86] flex items-center justify-center p-3 bg-black/50">
      <div
        className="technical-panel shadow-[6px_6px_0_0_#141414] w-full max-w-5xl max-h-[92vh] h-[92vh] min-h-0 flex flex-col overflow-hidden"
        role="dialog"
        aria-labelledby="folha-liquidos-title"
      >
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-brand-border bg-brand-sidebar/40 shrink-0">
          <div className="flex-1 min-w-0">
            <h2
              id="folha-liquidos-title"
              className="text-sm font-black uppercase tracking-widest inline-flex items-center gap-2"
            >
              <Users size={16} aria-hidden="true" />
              Importar Relatório de Líquidos (folha)
            </h2>
            <p className="text-[9px] text-slate-600 mt-0.5 leading-snug">
              Gera regras de conciliação por funcionário — banco {bancoLabel || '(sem banco)'}. O
              PDF pode ter várias competências.
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

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-3">
          {/* 1 — arquivo */}
          <div className="border border-brand-border/50 bg-white p-3 space-y-2">
            <p className="text-[9px] font-black uppercase tracking-wider">1 · Arquivo PDF</p>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => {
                  void handleArquivo(e.target.files?.[0] ?? null);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={lendo}
                className="technical-button text-[9px] py-1 px-3 inline-flex items-center gap-1 disabled:opacity-40"
              >
                {lendo ? (
                  <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                ) : (
                  <FileUp size={12} aria-hidden="true" />
                )}
                {lendo ? 'Lendo PDF…' : 'Escolher PDF'}
              </button>
              {parsed ? (
                <span className="text-[9px] font-semibold text-brand-text/70 break-all">
                  {parsed.fileName} · {parsed.empresa || 'empresa não identificada'} ·{' '}
                  {parsed.competencias.length} competência(s)
                </span>
              ) : null}
            </div>
            {erro ? (
              <p role="alert" className="text-[9px] font-bold uppercase text-rose-700 leading-snug">
                {erro}
              </p>
            ) : null}
            {parsed?.issues.length ? (
              <ul className="text-[8px] text-amber-800 leading-snug list-disc pl-4">
                {parsed.issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            ) : null}
          </div>

          {parsed && parsed.competencias.length > 0 ? (
            <>
              {/* 2 — competências */}
              <div className="border border-brand-border/50 bg-white p-3 space-y-2">
                <p className="text-[9px] font-black uppercase tracking-wider">
                  2 · Competências a importar
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {parsed.competencias.map((c) => {
                    const ativa = !competenciasOff.has(c.competencia);
                    return (
                      <button
                        key={c.competencia}
                        type="button"
                        aria-pressed={ativa}
                        onClick={() =>
                          setCompetenciasOff((prev) => {
                            const next = new Set(prev);
                            if (next.has(c.competencia)) next.delete(c.competencia);
                            else next.add(c.competencia);
                            return next;
                          })
                        }
                        className={cn(
                          'text-[9px] font-black uppercase px-2 py-1 border border-brand-border tabular-nums',
                          ativa ? 'bg-brand-text text-white' : 'bg-white text-brand-text/50',
                        )}
                        title={`${c.itens.length} funcionário(s)${
                          c.total !== null ? ` · total ${formatValorBR(c.total)}` : ''
                        }`}
                      >
                        {c.competencia} · {c.itens.length}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 3 — estratégia */}
              <div className="border border-brand-border/50 bg-white p-3 space-y-2">
                <p className="text-[9px] font-black uppercase tracking-wider">
                  3 · Como procurar no extrato
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {ESTRATEGIAS.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      aria-pressed={estrategia === e.id}
                      onClick={() => setEstrategia(e.id)}
                      className={cn(
                        'text-[9px] font-black uppercase px-2 py-1 border border-brand-border',
                        estrategia === e.id ? 'bg-brand-text text-white' : 'bg-white',
                      )}
                    >
                      {e.label}
                    </button>
                  ))}
                </div>
                <p className="text-[8px] text-brand-text/60 leading-snug">
                  {ESTRATEGIAS.find((e) => e.id === estrategia)?.hint}
                </p>
                <p className="text-[8px] text-brand-text/50 leading-snug">
                  A busca de cada competência vale do próprio mês em diante — a folha de 01/2026 é
                  procurada em 01, 02, 03… e assim por diante.
                </p>
              </div>

              {/* 4 — conta */}
              <div className="border border-brand-border/50 bg-white p-3 space-y-2">
                <p className="text-[9px] font-black uppercase tracking-wider">
                  4 · Conta de contrapartida (código reduzido)
                </p>
                <p className="text-[8px] text-brand-text/55 leading-snug">
                  Aplicada a todos os funcionários da folha.
                </p>
                <div className="max-w-md">
                  <ExtratoContaPicker
                    value={contaPadrao}
                    options={planoOptions}
                    lookupOptions={planoLookupOptions}
                    includeSinteticas
                    showNomeInline
                    placeholder="Código…"
                    ariaLabel="Conta de contrapartida padrão da folha"
                    onChange={(code) => setContaPadrao(code)}
                  />
                </div>
                {contaPadraoInvalida ? (
                  <p className="text-[9px] font-bold uppercase text-rose-700">
                    Use o código reduzido — classificação (ex.: 2.1.10…) é proibida.
                  </p>
                ) : null}
              </div>

              {/* 5 — prévia: competência, funcionário, documento e valor */}
              <div className="border border-brand-border/50 bg-white p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-[9px] font-black uppercase tracking-wider">
                    5 · Prévia · {plano?.funcionarios.length ?? 0} funcionário(s) ·{' '}
                    {totalRegras} regra(s)
                  </p>
                  {contaFaltando ? (
                    <span className="text-[8px] font-black uppercase text-amber-800 border border-amber-300 bg-amber-50 px-1.5 py-0.5">
                      Informe a conta de contrapartida no passo 4
                    </span>
                  ) : null}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[9px] border-collapse min-w-[760px]">
                    <thead>
                      <tr className="bg-brand-sidebar/40 text-left">
                        <th className="p-1 font-black uppercase text-[8px] w-[80px]">Competência</th>
                        <th className="p-1 font-black uppercase text-[8px]">Funcionário</th>
                        <th className="p-1 font-black uppercase text-[8px]">Identidade / CPF</th>
                        <th className="p-1 font-black uppercase text-[8px] w-[230px]">
                          Critério de identificação
                        </th>
                        <th className="p-1 font-black uppercase text-[8px] text-right w-[100px]">
                          Valor
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {linhasPrevia.map((linha) => (
                        <tr
                          key={`${linha.chave}|${linha.competencia}`}
                          className="border-t border-brand-border/30"
                        >
                          <td className="p-1 font-bold tabular-nums">{linha.competencia}</td>
                          <td className="p-1 font-bold uppercase">{linha.nome}</td>
                          <td className="p-1 tabular-nums text-brand-text/70">
                            {linha.identidade || '—'}
                          </td>
                          <td className="p-1">
                            <span
                              className={cn(
                                'text-[7px] font-black uppercase px-1 py-0.5',
                                CRITERIO_BADGE[linha.estrategia],
                              )}
                            >
                              {CRITERIO_LABEL[linha.estrategia]}
                            </span>
                            <span className="block text-[8px] text-brand-text/55 leading-snug">
                              {linha.motivo}
                            </span>
                            <span
                              className={cn(
                                'block text-[8px] font-bold leading-snug',
                                linha.correspondencias > 0 ? 'text-green-800' : 'text-amber-800',
                              )}
                              title={`Lançamentos do extrato aberto que esta linha identificaria, de ${linha.competencia} em diante`}
                            >
                              {linha.correspondencias > 0
                                ? `${linha.correspondencias} correspondência(s) de ${linha.competencia} em diante`
                                : `Sem correspondência de ${linha.competencia} em diante`}
                            </span>
                          </td>
                          <td className="p-1 text-right font-black tabular-nums">
                            {formatValorBR(linha.valor)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}
        </div>

        <div className="p-3 border-t border-brand-border flex justify-end gap-2 shrink-0 bg-brand-bg">
          <button type="button" onClick={onClose} className="technical-button text-[10px] py-1 px-3">
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleImportar}
            disabled={!plano || totalRegras === 0 || !contaBanco.trim()}
            className="technical-button-primary text-[10px] py-1 px-4 disabled:opacity-40"
          >
            Importar {totalRegras > 0 ? `${totalRegras} regra(s)` : ''}
          </button>
        </div>
      </div>
    </div>
  );
});
