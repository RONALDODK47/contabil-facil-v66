import { useEffect, useMemo, useState } from 'react';
import { BookMarked, Copy, Download, FileText, Scale } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  CF_FIELD_COL,
  CF_FIELD_ROW,
  CF_FORM_INPUT_LONG,
  CF_FORM_INPUT_MED,
  CF_FORM_INPUT_MONEY,
  CF_FORM_INPUT_NUM,
  CF_FORM_INPUT_SHORT,
  CF_FORM_SELECT,
  CF_LABEL,
} from '../lib/formFieldClasses';
import {
  NOTA_ATIVIDADE_LABELS,
  NOTA_ENDIVIDAMENTO_LABELS,
  NOTA_REGIME_LABELS,
  type NotaEndividamentoTipo,
  type NotaExplicativaAtividade,
  type NotaExplicativaEmpresaDados,
  type NotaExplicativaProfile,
} from '../logic/notaExplicativaTypes';
import { gerarNotaExplicativa, notaExplicativaTextoCompleto, validarDadosMinimos } from '../logic/notaExplicativaEngine';
import { loadNotaExplicativaProfile, saveNotaExplicativaProfile } from '../logic/notaExplicativaStorage';
import NotaExplicativaBalanceteImportPanel from './NotaExplicativaBalanceteImportPanel';

type InnerTab = 'dados' | 'nota' | 'cpcs';

const INNER_TABS: { id: InnerTab; label: string; icon: typeof FileText }[] = [
  { id: 'dados', label: 'Dados da empresa', icon: FileText },
  { id: 'nota', label: 'Nota gerada', icon: BookMarked },
  { id: 'cpcs', label: 'CPCs aplicáveis', icon: Scale },
];

const ATIVIDADES = Object.keys(NOTA_ATIVIDADE_LABELS) as NotaExplicativaAtividade[];
const ENDIVIDAMENTO_TIPOS = Object.keys(NOTA_ENDIVIDAMENTO_LABELS) as NotaEndividamentoTipo[];

type Props = {
  selectedCompany: string;
};

export default function NotaExplicativaTab({ selectedCompany }: Props) {
  const [innerTab, setInnerTab] = useState<InnerTab>('dados');
  const [profile, setProfile] = useState<NotaExplicativaProfile>(() =>
    loadNotaExplicativaProfile(selectedCompany),
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setProfile(loadNotaExplicativaProfile(selectedCompany));
    setInnerTab('dados');
  }, [selectedCompany]);

  const gerado = useMemo(() => gerarNotaExplicativa(profile), [profile]);
  const avisos = useMemo(() => validarDadosMinimos(profile.dados), [profile.dados]);
  const textoCompleto = useMemo(() => notaExplicativaTextoCompleto(gerado.secoes), [gerado.secoes]);

  const patchDados = (patch: Partial<NotaExplicativaEmpresaDados>) => {
    setProfile((prev) => {
      const next = { ...prev, dados: { ...prev.dados, ...patch } };
      saveNotaExplicativaProfile(selectedCompany, next);
      return next;
    });
  };

  const toggleAtividade = (atv: NotaExplicativaAtividade) => {
    const set = new Set(profile.dados.atividades);
    if (set.has(atv)) {
      if (set.size > 1) set.delete(atv);
    } else {
      set.add(atv);
    }
    patchDados({ atividades: Array.from(set) });
  };

  const toggleTipoEndividamento = (tipo: NotaEndividamentoTipo) => {
    const set = new Set(profile.dados.tiposEndividamento);
    if (set.has(tipo)) set.delete(tipo);
    else set.add(tipo);
    patchDados({ tiposEndividamento: Array.from(set) });
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(textoCompleto);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleDownload = () => {
    const blob = new Blob([textoCompleto], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nota-explicativa-${profile.dados.exercicio || 'exercicio'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="p-4 bg-brand-sidebar/20 border border-brand-border text-xs space-y-1">
        <span className="font-bold uppercase tracking-widest">Notas Explicativas — CPC / NBC TG</span>
        <p className="opacity-60 text-[9px] leading-relaxed">
          Preencha os dados da empresa, atividades e endividamento (empréstimos e financiamentos). Para entidades
          imunes ou isentas, selecione o regime correspondente e informe o fundamento legal. Cada modalidade de
          endividamento aciona CPCs específicos.
        </p>
      </div>

      <div className="flex flex-wrap border border-brand-border bg-brand-sidebar/20 shadow-[2px_2px_0_0_#141414]">
        {INNER_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setInnerTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-[10px] font-black uppercase tracking-widest border-r border-brand-border last:border-r-0 transition-all',
                innerTab === tab.id ? 'bg-brand-bg text-brand-text' : 'opacity-50 hover:opacity-100',
              )}
            >
              <Icon size={12} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {avisos.length > 0 && innerTab !== 'cpcs' && (
        <div className="border border-amber-700/40 bg-amber-500/10 px-4 py-2 text-[9px] font-bold uppercase text-amber-900">
          Pendências: {avisos.join(' · ')}
        </div>
      )}

      {innerTab === 'dados' && (
        <div className="space-y-6">
          <NotaExplicativaBalanceteImportPanel onApply={patchDados} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="technical-panel p-6 space-y-4">
              <h4 className="text-[10px] font-black uppercase tracking-widest border-b border-brand-border pb-2">
                Identificação
              </h4>
              <div className={CF_FIELD_COL}>
                <label htmlFor="ne-razao-social" className={CF_LABEL}>
                  Razão social
                </label>
                <input
                  id="ne-razao-social"
                  name="razaoSocial"
                  aria-label="Razão social"
                  className={CF_FORM_INPUT_LONG}
                  value={profile.dados.razaoSocial}
                  onChange={(e) => patchDados({ razaoSocial: e.target.value.toUpperCase() })}
                />
              </div>
              <div className={CF_FIELD_COL}>
                <label htmlFor="ne-nome-fantasia" className={CF_LABEL}>
                  Nome fantasia
                </label>
                <input
                  id="ne-nome-fantasia"
                  name="nomeFantasia"
                  aria-label="Nome fantasia"
                  className={CF_FORM_INPUT_MED}
                  value={profile.dados.nomeFantasia}
                  onChange={(e) => patchDados({ nomeFantasia: e.target.value })}
                />
              </div>
              <div className={CF_FIELD_COL}>
                <label htmlFor="ne-cnpj" className={CF_LABEL}>
                  CNPJ
                </label>
                <input
                  id="ne-cnpj"
                  name="cnpj"
                  aria-label="CNPJ"
                  className={CF_FORM_INPUT_MED}
                  value={profile.dados.cnpj}
                  onChange={(e) => patchDados({ cnpj: e.target.value })}
                  placeholder="00.000.000/0001-00"
                />
              </div>
              <div className={CF_FIELD_ROW}>
                <div className={CF_FIELD_COL}>
                  <label htmlFor="ne-exercicio" className={CF_LABEL}>
                    Exercício
                  </label>
                  <input
                    id="ne-exercicio"
                    name="exercicio"
                    aria-label="Exercício"
                    className={CF_FORM_INPUT_MED}
                    value={profile.dados.exercicio}
                    onChange={(e) => patchDados({ exercicio: e.target.value })}
                  />
                </div>
                <div className={CF_FIELD_COL}>
                  <label htmlFor="ne-encerramento" className={CF_LABEL}>
                    Encerramento
                  </label>
                  <input
                    id="ne-encerramento"
                    name="dataEncerramento"
                    aria-label="Data de encerramento"
                    className={CF_FORM_INPUT_MED}
                    value={profile.dados.dataEncerramento}
                    onChange={(e) => patchDados({ dataEncerramento: e.target.value })}
                  />
                </div>
              </div>
              <div className={CF_FIELD_ROW}>
                <div className={CF_FIELD_COL}>
                  <label htmlFor="ne-municipio" className={CF_LABEL}>
                    Município
                  </label>
                  <input
                    id="ne-municipio"
                    name="municipio"
                    aria-label="Município"
                    className={CF_FORM_INPUT_MED}
                    value={profile.dados.municipio}
                    onChange={(e) => patchDados({ municipio: e.target.value })}
                  />
                </div>
                <div className={CF_FIELD_COL}>
                  <label htmlFor="ne-uf" className={CF_LABEL}>
                    UF
                  </label>
                  <input
                    id="ne-uf"
                    name="uf"
                    aria-label="UF"
                    className={CF_FORM_INPUT_SHORT}
                    value={profile.dados.uf}
                    maxLength={2}
                    onChange={(e) => patchDados({ uf: e.target.value.toUpperCase() })}
                  />
                </div>
              </div>
            </div>

            <div className="technical-panel p-6 space-y-4">
              <h4 className="text-[10px] font-black uppercase tracking-widest border-b border-brand-border pb-2">
                Atividades e regime
              </h4>
              <fieldset className="space-y-2 border-0 p-0 m-0">
                <legend className={CF_LABEL}>Atividades econômicas (combine se necessário)</legend>
                {ATIVIDADES.map((atv) => (
                  <label
                    key={atv}
                    className="flex items-start gap-2 text-[10px] font-bold uppercase cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      name={`atividade-${atv}`}
                      aria-label={NOTA_ATIVIDADE_LABELS[atv]}
                      checked={profile.dados.atividades.includes(atv)}
                      onChange={() => toggleAtividade(atv)}
                      className="mt-0.5"
                    />
                    <span>{NOTA_ATIVIDADE_LABELS[atv]}</span>
                  </label>
                ))}
              </fieldset>
              <div className={CF_FIELD_COL}>
                <label htmlFor="ne-regime" className={CF_LABEL}>
                  Regime tributário
                </label>
                <select
                  id="ne-regime"
                  name="regime"
                  aria-label="Regime tributário"
                  className={CF_FORM_SELECT}
                  value={profile.dados.regime}
                  onChange={(e) =>
                    patchDados({
                      regime: e.target.value as NotaExplicativaEmpresaDados['regime'],
                    })
                  }
                >
                  {Object.entries(NOTA_REGIME_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-[10px] font-bold uppercase cursor-pointer">
                <input
                  type="checkbox"
                  name="auditoriaIndependente"
                  aria-label="Demonstrações auditadas por auditor independente"
                  checked={profile.dados.auditoriaIndependente}
                  onChange={(e) => patchDados({ auditoriaIndependente: e.target.checked })}
                />
                Demonstrações auditadas por auditor independente
              </label>
              {(profile.dados.regime === 'imune' || profile.dados.regime === 'isenta') && (
                <div className={CF_FIELD_COL}>
                  <label htmlFor="ne-fundamento-imunidade" className={CF_LABEL}>
                    Fundamento legal (imunidade / isenção)
                  </label>
                  <textarea
                    id="ne-fundamento-imunidade"
                    name="fundamentoImunidadeIsencao"
                    aria-label="Fundamento legal da imunidade ou isenção"
                    className={CF_FORM_INPUT_LONG + ' min-h-[72px] h-auto py-1.5'}
                    value={profile.dados.fundamentoImunidadeIsencao}
                    onChange={(e) => patchDados({ fundamentoImunidadeIsencao: e.target.value })}
                    placeholder="Ex.: Art. 150, VI, alínea c, CF/88 — templos de qualquer culto"
                  />
                </div>
              )}
              <div className={CF_FIELD_ROW}>
                <div className={CF_FIELD_COL}>
                  <label htmlFor="ne-capital-social" className={CF_LABEL}>
                    Capital social (R$)
                  </label>
                  <input
                    id="ne-capital-social"
                    name="capitalSocial"
                    aria-label="Capital social em reais"
                    className={CF_FORM_INPUT_MONEY}
                    value={profile.dados.capitalSocial}
                    onChange={(e) => patchDados({ capitalSocial: e.target.value })}
                  />
                </div>
                <div className={CF_FIELD_COL}>
                  <label htmlFor="ne-patrimonio-liquido" className={CF_LABEL}>
                    Patrimônio líquido (R$)
                  </label>
                  <input
                    id="ne-patrimonio-liquido"
                    name="patrimonioLiquido"
                    aria-label="Patrimônio líquido em reais"
                    className={CF_FORM_INPUT_MONEY}
                    value={profile.dados.patrimonioLiquido}
                    onChange={(e) => patchDados({ patrimonioLiquido: e.target.value })}
                  />
                </div>
              </div>
              <div className={CF_FIELD_ROW}>
                <div className={CF_FIELD_COL}>
                  <label htmlFor="ne-receita-bruta" className={CF_LABEL}>
                    Receita bruta exercício (R$)
                  </label>
                  <input
                    id="ne-receita-bruta"
                    name="receitaBrutaExercicio"
                    aria-label="Receita bruta do exercício em reais"
                    className={CF_FORM_INPUT_MONEY}
                    value={profile.dados.receitaBrutaExercicio}
                    onChange={(e) => patchDados({ receitaBrutaExercicio: e.target.value })}
                  />
                </div>
                <div className={CF_FIELD_COL}>
                  <label htmlFor="ne-num-empregados" className={CF_LABEL}>
                    Nº empregados (média)
                  </label>
                  <input
                    id="ne-num-empregados"
                    name="numeroEmpregados"
                    aria-label="Número de empregados na média"
                    className={CF_FORM_INPUT_NUM}
                    value={profile.dados.numeroEmpregados}
                    onChange={(e) => patchDados({ numeroEmpregados: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="technical-panel p-6 space-y-4">
            <h4 className="text-[10px] font-black uppercase tracking-widest border-b border-brand-border pb-2">
              Empréstimos e financiamentos
            </h4>
            <p className="text-[9px] opacity-60 leading-relaxed">
              Indique se a empresa possui empréstimos e/ou financiamentos e marque as modalidades contratadas. Cada
              opção altera os CPCs aplicáveis e o texto da nota explicativa.
            </p>
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 text-[10px] font-bold uppercase cursor-pointer">
                <input
                  type="checkbox"
                  name="possuiEmprestimos"
                  aria-label="Possui empréstimos bancários"
                  checked={profile.dados.possuiEmprestimos}
                  onChange={(e) => patchDados({ possuiEmprestimos: e.target.checked })}
                />
                Possui empréstimos bancários
              </label>
              <label className="flex items-center gap-2 text-[10px] font-bold uppercase cursor-pointer">
                <input
                  type="checkbox"
                  name="possuiFinanciamentos"
                  aria-label="Possui financiamentos"
                  checked={profile.dados.possuiFinanciamentos}
                  onChange={(e) => patchDados({ possuiFinanciamentos: e.target.checked })}
                />
                Possui financiamentos
              </label>
            </div>

            {(profile.dados.possuiEmprestimos || profile.dados.possuiFinanciamentos) && (
              <>
                <fieldset className="space-y-2 border border-brand-border/30 p-4">
                  <legend className={CF_LABEL + ' px-1'}>Modalidades e peculiaridades (CPCs)</legend>
                  {ENDIVIDAMENTO_TIPOS.map((tipo) => (
                    <label
                      key={tipo}
                      className="flex items-start gap-2 text-[10px] font-bold uppercase cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        name={`endividamento-${tipo}`}
                        aria-label={NOTA_ENDIVIDAMENTO_LABELS[tipo]}
                        checked={profile.dados.tiposEndividamento.includes(tipo)}
                        onChange={() => toggleTipoEndividamento(tipo)}
                        className="mt-0.5"
                      />
                      <span>{NOTA_ENDIVIDAMENTO_LABELS[tipo]}</span>
                    </label>
                  ))}
                </fieldset>

                <div className={CF_FIELD_ROW}>
                  {profile.dados.possuiEmprestimos && (
                    <>
                      <div className={CF_FIELD_COL}>
                        <label htmlFor="ne-emp-cp" className={CF_LABEL}>
                          Empréstimos — circulante (R$)
                        </label>
                        <input
                          id="ne-emp-cp"
                          name="saldoEmprestimosCP"
                          aria-label="Empréstimos circulante em reais"
                          className={CF_FORM_INPUT_MONEY}
                          value={profile.dados.saldoEmprestimosCP}
                          onChange={(e) => patchDados({ saldoEmprestimosCP: e.target.value })}
                        />
                      </div>
                      <div className={CF_FIELD_COL}>
                        <label htmlFor="ne-emp-lp" className={CF_LABEL}>
                          Empréstimos — não circulante (R$)
                        </label>
                        <input
                          id="ne-emp-lp"
                          name="saldoEmprestimosLP"
                          aria-label="Empréstimos não circulante em reais"
                          className={CF_FORM_INPUT_MONEY}
                          value={profile.dados.saldoEmprestimosLP}
                          onChange={(e) => patchDados({ saldoEmprestimosLP: e.target.value })}
                        />
                      </div>
                    </>
                  )}
                  {profile.dados.possuiFinanciamentos && (
                    <>
                      <div className={CF_FIELD_COL}>
                        <label htmlFor="ne-fin-cp" className={CF_LABEL}>
                          Financiamentos — circulante (R$)
                        </label>
                        <input
                          id="ne-fin-cp"
                          name="saldoFinanciamentosCP"
                          aria-label="Financiamentos circulante em reais"
                          className={CF_FORM_INPUT_MONEY}
                          value={profile.dados.saldoFinanciamentosCP}
                          onChange={(e) => patchDados({ saldoFinanciamentosCP: e.target.value })}
                        />
                      </div>
                      <div className={CF_FIELD_COL}>
                        <label htmlFor="ne-fin-lp" className={CF_LABEL}>
                          Financiamentos — não circulante (R$)
                        </label>
                        <input
                          id="ne-fin-lp"
                          name="saldoFinanciamentosLP"
                          aria-label="Financiamentos não circulante em reais"
                          className={CF_FORM_INPUT_MONEY}
                          value={profile.dados.saldoFinanciamentosLP}
                          onChange={(e) => patchDados({ saldoFinanciamentosLP: e.target.value })}
                        />
                      </div>
                    </>
                  )}
                </div>

                <div className={CF_FIELD_COL}>
                  <label htmlFor="ne-endiv-obs" className={CF_LABEL}>
                    Observações (garantias, covenants, taxas)
                  </label>
                  <textarea
                    id="ne-endiv-obs"
                    name="endividamentoObservacoes"
                    aria-label="Observações sobre endividamento"
                    className={CF_FORM_INPUT_LONG + ' min-h-[56px] h-auto py-1.5'}
                    value={profile.dados.endividamentoObservacoes}
                    onChange={(e) => patchDados({ endividamentoObservacoes: e.target.value })}
                  />
                </div>
              </>
            )}

            <button
              type="button"
              onClick={() => setInnerTab('nota')}
              className="technical-button-primary w-full text-[10px] font-black uppercase tracking-widest py-2"
            >
              Gerar nota explicativa
            </button>
          </div>
        </div>
      )}

      {innerTab === 'nota' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 justify-end">
            <button
              type="button"
              onClick={handleCopy}
              className="technical-button text-[10px] font-bold uppercase flex items-center gap-1.5 px-3 py-1.5"
            >
              <Copy size={12} />
              {copied ? 'Copiado!' : 'Copiar texto'}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="technical-button-primary text-[10px] font-bold uppercase flex items-center gap-1.5 px-3 py-1.5"
            >
              <Download size={12} />
              Exportar .txt
            </button>
          </div>
          <div className="space-y-6">
            {gerado.secoes.map((sec) => (
              <article
                key={sec.id}
                className="technical-panel p-6 bg-white space-y-3 shadow-[4px_4px_0_0_#141414]"
              >
                <header className="border-b border-brand-border/30 pb-2">
                  <h3 className="text-xs font-black uppercase tracking-wide">{sec.titulo}</h3>
                  <p className="text-[8px] font-mono text-slate-500 mt-1">
                    {sec.cpcs.map((c) => c.codigo).join(' · ')}
                  </p>
                </header>
                <p className="text-[10px] leading-relaxed whitespace-pre-wrap text-slate-800">{sec.corpo}</p>
              </article>
            ))}
          </div>
        </div>
      )}

      {innerTab === 'cpcs' && (
        <div className="technical-panel p-6 space-y-4">
          <p className="text-[9px] font-bold uppercase opacity-60">
            Normas selecionadas conforme atividades ({profile.dados.atividades.length}), regime (
            {NOTA_REGIME_LABELS[profile.dados.regime]}) e endividamento (
            {profile.dados.possuiEmprestimos || profile.dados.possuiFinanciamentos
              ? `${profile.dados.tiposEndividamento.length} modalidade(s)`
              : 'nenhum'}
            ).
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {gerado.cpcsAplicaveis.map((cpc) => (
              <div key={cpc.codigo} className="border border-brand-border/30 p-3 bg-brand-sidebar/10">
                <div className="text-[10px] font-black uppercase">{cpc.codigo}</div>
                <div className="text-[9px] font-bold mt-0.5">{cpc.titulo}</div>
                <p className="text-[8px] opacity-70 mt-1 leading-snug">{cpc.escopo}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
