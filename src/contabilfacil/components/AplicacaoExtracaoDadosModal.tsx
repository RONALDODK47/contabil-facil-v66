import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Folder, Loader2, ScanSearch } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  loadAplicacaoContasExtrato,
  upsertAplicacaoContaExtrato,
  type AplicacaoContaExtrato,
} from '../logic/aplicacaoExtratoStorage';
import {
  extractPdfText,
  parseAplicacaoExtratoText,
  type AplicacaoExtratoParseResult,
  type AplicacaoExtratoRow,
} from '../logic/aplicacaoExtratoParser';
import { convertPdfToImages, processOcrImages } from '../../lib/ocrSearchablePdf';
import ExtratoContaPicker, {
  buildPlanoNomeLookup,
  resolveContaNome,
  type ExtratoPlanoContaOption,
} from './ExtratoContaPicker';
import { readManagerData } from '../logic/companyWorkspace';
import { generateUUID } from '../../lib/uuid';

type Props = {
  selectedCompany: string;
  onClose: () => void;
};

/**
 * Layouts APRENDIDOS: cada item é a imagem do trecho do PDF que o parser já sabe
 * extrair. A pasta mostra só essas imagens — nada de lista textual. Layout novo
 * só entra aqui depois que o parser aprende a lê-lo.
 */
const LAYOUTS_APRENDIDOS: Array<{ id: string; nome: string; imagem: string }> = [
  {
    id: 'deposito_prazo',
    nome: 'Depósito a Prazo — Detalhado (Sicredinvest)',
    imagem: '/aplicacao-layout-sicredinvest-posicao-saque.png',
  },
  {
    id: 'movimento',
    nome: 'Movimento Poupança (Sicredi Poupança Integrada)',
    imagem: '/aplicacao-layout-sicredi-poupanca-movimento.png',
  },
];

/**
 * "Extração de Dados" da aba Extrato de Aplicações.
 *
 * Só duas coisas: o NOME da aplicação (que passa a existir como pasta, visível na
 * sub-aba "Pastas de Aplicações", ao lado de Conciliação) e a escolha do tipo de
 * PDF — sem texto (OCR) ou com texto. O ícone de pasta abre apenas a lista de
 * layouts que os parsers do sistema suportam.
 */
/** Resumo do que foi lido — inclui o bloco "Posição para Saque" quando existe. */
function resumoExtracao(result: AplicacaoExtratoParseResult, origem: string): string {
  const base = `${result.rows.length} lançamento(s) lidos${origem} (layout ${result.layout}).`;
  const p = result.posicaoSaque;
  if (!p) return base;
  const brl = (v: number | null) =>
    v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return (
    `${base} Posição em ${p.data}: Rend. Provisionados ${brl(p.rendimentosProvisionados)} · ` +
    `IRRF ${brl(p.provisaoIRRF)} · IOF ${brl(p.provisaoIOF)}. ` +
    'Saldo anterior e saldo final não são extraídos — digite nos cards do extrato.'
  );
}

export default function AplicacaoExtracaoDadosModal({ selectedCompany, onClose }: Props) {
  const [contas, setContas] = useState<AplicacaoContaExtrato[]>(() =>
    loadAplicacaoContasExtrato(selectedCompany),
  );
  const [activeContaId, setActiveContaId] = useState<string>(() => contas[0]?.id ?? '');
  const [novaContaNome, setNovaContaNome] = useState('');
  /** Conta contábil (código reduzido) da aplicação — análogo da conta banco na conciliação. */
  const [contaContabilInput, setContaContabilInput] = useState('');
  const [layoutsOpen, setLayoutsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const inputPdfOcrRef = useRef<HTMLInputElement>(null);
  const inputPdfTextoRef = useRef<HTMLInputElement>(null);

  const activeConta = useMemo(
    () => contas.find((c) => c.id === activeContaId) ?? null,
    [contas, activeContaId],
  );

  /** Plano de contas da empresa — mesma fonte do modal de Regras de Conciliação. */
  const planoAll = useMemo<ExtratoPlanoContaOption[]>(() => {
    if (!selectedCompany) return [];
    return readManagerData<ExtratoPlanoContaOption>(selectedCompany, 'plano').map((a) => ({
      code: a.code,
      name: a.name,
      codigoReduzido: a.codigoReduzido,
      tipo: a.tipo,
    }));
  }, [selectedCompany]);

  const planoOptions = useMemo(() => planoAll.filter((a) => a.tipo !== 'S'), [planoAll]);
  const planoNomeLookup = useMemo(() => buildPlanoNomeLookup(planoAll), [planoAll]);

  useEffect(() => {
    setContaContabilInput(activeConta?.contaContabil ?? '');
  }, [activeConta?.id, activeConta?.contaContabil]);

  const contaContabil = contaContabilInput.trim();
  /** Só extrai com nome E conta contábil — sem a conta não dá para saber débito/crédito. */
  const podeExtrair = Boolean(activeConta && contaContabil);

  const handleEscolherContaContabil = (code: string) => {
    setContaContabilInput(code);
    const alvo = code.trim();

    // A conta contábil identifica a aplicação. Se já existe uma pasta com essa
    // conta, ela vira a ativa aqui mesmo — é o que substitui a antiga lista de
    // botões com os nomes das aplicações: escolher a conta já diz em qual pasta
    // os lançamentos vão entrar.
    const existente = alvo
      ? contas.find((c) => (c.contaContabil ?? '').trim() === alvo)
      : undefined;
    if (existente) {
      setActiveContaId(existente.id);
      setNovaContaNome('');
      setStatusMsg(`Aplicação "${existente.nome}" selecionada pela conta ${alvo}.`);
      return;
    }

    // Escolher a conta já batiza a aplicação com o nome dela ("1051" →
    // "SICREDINVEST AUTOMATICO"): é esse o nome que se quer em 99% dos casos, e
    // digitá-lo de novo à mão só abre espaço para divergir da conta. Só
    // preenche o campo vazio — nome já digitado é escolha do usuário e fica.
    if (!activeConta && !novaContaNome.trim()) {
      const nomeConta = resolveContaNome(planoNomeLookup, code, planoAll).trim();
      if (nomeConta) setNovaContaNome(nomeConta);
    }

    if (!activeConta) return;
    setContas(
      upsertAplicacaoContaExtrato(selectedCompany, {
        id: activeConta.id,
        nome: activeConta.nome,
        contaContabil: code.trim(),
      }),
    );
    setStatusMsg(`Conta contábil ${code.trim() || '—'} vinculada a "${activeConta.nome}".`);
  };

  const handleCriarConta = () => {
    const nome = novaContaNome.trim();
    if (!nome) return;

    // O id é gerado AQUI, não descoberto depois pelo nome: com duas aplicações
    // de mesmo nome, procurar por nome devolvia a antiga, e a extração seguinte
    // ia empilhar os lançamentos em cima dela. Criar é sempre criar uma pasta
    // nova e vazia — quem quer continuar numa existente escolhe a conta acima.
    const id = generateUUID();
    setContas(upsertAplicacaoContaExtrato(selectedCompany, { id, nome, contaContabil, rows: [] }));
    setActiveContaId(id);
    setNovaContaNome('');
    const repetida = contas.some((c) => c.nome.trim().toUpperCase() === nome.toUpperCase());
    setStatusMsg(
      repetida
        ? `Aplicação "${nome}" criada (já existia outra com esse nome) — os lançamentos vão para a nova, vazia.`
        : `Aplicação "${nome}" criada — já aparece na sub-aba Pastas de Aplicações.`,
    );
  };

  const aplicarRows = (rows: AplicacaoExtratoRow[], saldoAnterior?: number | null) => {
    if (!activeConta) {
      setStatusMsg('Informe o nome da aplicação antes de extrair.');
      return false;
    }
    const next = upsertAplicacaoContaExtrato(selectedCompany, {
      id: activeConta.id,
      nome: activeConta.nome,
      contaContabil,
      saldoAnteriorManual: saldoAnterior ?? activeConta.saldoAnteriorManual,
      rows: [...activeConta.rows, ...rows],
    });
    setContas(next);
    return true;
  };

  /**
   * PDF escaneado/imagem — o OCR lê. Aceita também PDF com texto: antes de
   * gastar minutos rasterizando e reconhecendo, tenta o texto nativo, que é
   * instantâneo e mais fiel (o OCR troca dígito e come vírgula). Só cai para o
   * OCR quando o texto nativo não rende lançamento nenhum — que é justamente o
   * caso do PDF que é só imagem. Assim este botão serve para qualquer extrato,
   * e escolher o botão "errado" não estraga a extração.
   */
  const handlePdfOcr = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !podeExtrair) {
      if (!podeExtrair) setStatusMsg('Informe o nome e a conta contábil da aplicação antes de extrair.');
      return;
    }
    setBusy(true);
    setProgress(0);
    setStatusMsg('Verificando se o PDF já tem texto...');
    try {
      let result = parseAplicacaoExtratoText(await extractPdfText(file));
      let via = ' (texto nativo — OCR não foi preciso)';

      if (result.rows.length === 0) {
        setStatusMsg('Sem texto nativo — convertendo PDF em imagens...');
        const images = await convertPdfToImages(file);
        setStatusMsg('Reconhecendo texto (OCR)...');
        const { text } = await processOcrImages(images, setProgress);
        result = parseAplicacaoExtratoText(text);
        via = ' via OCR';
      }

      if (!aplicarRows(result.rows, result.saldoAnterior ?? undefined)) return;
      setStatusMsg(resumoExtracao(result, via));
    } catch (err) {
      setStatusMsg(`Erro no OCR: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  /** PDF com texto nativo — não precisa de OCR. */
  const handlePdfTexto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !podeExtrair) {
      if (!podeExtrair) setStatusMsg('Informe o nome e a conta contábil da aplicação antes de extrair.');
      return;
    }
    setBusy(true);
    setStatusMsg('Extraindo texto do PDF...');
    try {
      let result = parseAplicacaoExtratoText(await extractPdfText(file));
      let via = '';

      // Escolher este botão para um PDF escaneado devolvia zero lançamento sem
      // explicar por quê. Em vez de falhar calado, faz o OCR.
      if (result.rows.length === 0) {
        setProgress(0);
        setStatusMsg('PDF sem texto selecionável — reconhecendo com OCR...');
        const images = await convertPdfToImages(file);
        const { text } = await processOcrImages(images, setProgress);
        result = parseAplicacaoExtratoText(text);
        via = ' via OCR (o PDF não tinha texto)';
      }

      if (!aplicarRows(result.rows, result.saldoAnterior ?? undefined)) return;
      setStatusMsg(resumoExtracao(result, via));
    } catch (err) {
      setStatusMsg(`Erro ao ler o PDF: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const botaoClass =
    'w-full flex items-center justify-between px-4 py-3 bg-brand-bg border border-brand-border hover:bg-brand-border hover:text-brand-bg transition-all text-[10px] font-bold uppercase tracking-widest disabled:opacity-40 disabled:hover:bg-brand-bg disabled:hover:text-brand-text';

  return (
    <div
      className="fixed inset-0 z-[240] flex items-center justify-center p-4 bg-brand-text/50"
      role="dialog"
      aria-modal="true"
      aria-label="Extração de dados de aplicações"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="technical-panel w-full max-w-xl p-5 space-y-4 shadow-[6px_6px_0_0_#141414] bg-brand-bg max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-black uppercase tracking-tight">Extração de Dados</h3>
            <p className="text-[9px] font-mono opacity-60 mt-0.5">
              Nome da aplicação · PDF com texto ou sem texto (OCR)
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setLayoutsOpen((v) => !v)}
              className={cn(
                'technical-button-secondary p-1.5',
                layoutsOpen && 'bg-brand-border text-brand-bg',
              )}
              title="Layouts aprendidos (imagens)"
              aria-label="Ver layouts aprendidos"
              aria-expanded={layoutsOpen}
            >
              <Folder size={14} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="technical-button-secondary p-1.5"
              aria-label="Fechar extração de dados"
            >
              ×
            </button>
          </div>
        </div>

        {layoutsOpen && (
          <div className="technical-panel p-4 space-y-2 bg-brand-sidebar/10">
            <h4 className="text-[9px] font-black uppercase tracking-widest text-brand-border">
              Layouts aprendidos
            </h4>
            {LAYOUTS_APRENDIDOS.length === 0 ? (
              <p className="text-[9px] font-mono opacity-60">Nenhum layout aprendido ainda.</p>
            ) : (
              <ul className="space-y-2">
                {LAYOUTS_APRENDIDOS.map((l) => (
                  <li key={l.id} className="border border-brand-border/30 bg-white p-1.5">
                    <img
                      src={l.imagem}
                      alt={`Layout aprendido: ${l.nome}`}
                      className="w-full"
                      loading="lazy"
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Nome da aplicação */}
        <div className="technical-panel p-4 space-y-2 bg-brand-sidebar/10">
          <h4 className="text-[9px] font-black uppercase tracking-widest text-brand-border">
            Nome da Aplicação
          </h4>
          {/* A aplicação criada não fica listada aqui: ela é salva como pasta na
              sub-aba "Pastas de Aplicações", que é onde se consulta. Escolher a
              conta contábil abaixo já seleciona a pasta correspondente. */}
          <p className="text-[9px] font-mono opacity-60">
            {activeConta
              ? `Lançamentos vão para a pasta "${activeConta.nome}".`
              : 'Escolha a conta contábil abaixo. Se ainda não houver pasta para ela, dê o nome e crie — a aplicação é salva na sub-aba "Pastas de Aplicações".'}
          </p>
          <div className="pt-1 space-y-0.5">
            <div className="grid grid-cols-[minmax(72px,1fr)_minmax(0,2fr)] gap-1">
              <p className="text-[8px] font-bold uppercase text-brand-text/50">Cód. reduzido</p>
              <p className="text-[8px] font-bold uppercase text-brand-text/50">Descrição da conta</p>
            </div>
            <ExtratoContaPicker
              value={contaContabilInput}
              options={planoOptions}
              lookupOptions={planoAll}
              includeSinteticas
              showNomeInline
              placeholder="Código…"
              ariaLabel="Conta contábil da aplicação (código reduzido)"
              onChange={handleEscolherContaContabil}
            />
          </div>
          <p className="text-[8px] font-mono opacity-60">
            A conta da aplicação é o outro lado do lançamento — igual à conta do banco na
            conciliação. Se ela entra a débito ou a crédito é a natureza escolhida em "Regras de
            Conciliação".
          </p>
          <div className="flex gap-2 pt-1">
            <input
              type="text"
              aria-label="Nome da aplicação"
              value={novaContaNome}
              onChange={(e) => setNovaContaNome(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleCriarConta();
                }
              }}
              placeholder="EX: SICREDINVEST EXCLUSIVO"
              className="flex-1 px-3 py-2 bg-white border border-brand-border text-[10px] font-mono font-bold uppercase outline-none"
            />
            <button type="button" onClick={handleCriarConta} className="technical-button px-3 text-[9px]">
              Criar
            </button>
          </div>
        </div>

        {/* Tipo de PDF — só liberado depois de escolher/criar o nome da aplicação. */}
        <div className="space-y-2">
          {!podeExtrair && (
            <p className="text-[9px] font-black uppercase tracking-widest text-red-700">
              Informe o nome e a conta contábil da aplicação para liberar a extração.
            </p>
          )}
          <button
            type="button"
            onClick={() => inputPdfOcrRef.current?.click()}
            disabled={busy || !podeExtrair}
            className={botaoClass}
            title={
              podeExtrair
                ? 'PDF escaneado / imagem — o OCR lê os lançamentos'
                : 'Escolha o nome e a conta contábil da aplicação primeiro'
            }
          >
            <span>Escolher PDF (OCR — sem texto)</span>
            <ScanSearch size={14} />
          </button>
          <button
            type="button"
            onClick={() => inputPdfTextoRef.current?.click()}
            disabled={busy || !podeExtrair}
            className={botaoClass}
            title={
              podeExtrair
                ? 'PDF com texto selecionável — leitura direta, sem OCR'
                : 'Escolha o nome e a conta contábil da aplicação primeiro'
            }
          >
            <span>Escolher PDF (com texto)</span>
            <FileText size={14} />
          </button>

          <input ref={inputPdfOcrRef} type="file" accept=".pdf" className="hidden" onChange={handlePdfOcr} />
          <input ref={inputPdfTextoRef} type="file" accept=".pdf" className="hidden" onChange={handlePdfTexto} />
        </div>

        {busy && (
          <div className="flex items-center gap-2 text-[10px] font-mono">
            <Loader2 size={14} className="animate-spin" />
            <span>{progress > 0 ? `OCR ${Math.round(progress)}%` : 'Processando...'}</span>
          </div>
        )}
        {statusMsg && (
          <p className="text-[9px] font-mono opacity-70 border-t border-brand-border/30 pt-2">{statusMsg}</p>
        )}
      </div>
    </div>
  );
}
