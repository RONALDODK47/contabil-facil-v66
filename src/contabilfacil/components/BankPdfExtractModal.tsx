/**
 * BankPdfExtractModal
 * Motor de extração de extratos bancários via servidor Python local (bank_pdf_extract).
 *
 * Fluxo:
 *  1. Envia o PDF para POST http://127.0.0.1:3001/preview  → tabela de linhas brutas
 *  2. Usuário mapeia colunas (data, histórico, débito, crédito) e escolhe linhas de cabeçalho
 *  3. Envia para POST http://127.0.0.1:3001/extract          → registros estruturados
 *  4. Converte para GenericOcrRow[] com flag _recorteFiel e chama onConfirm
 *
 * Substitui ExtratoLeitorRecortadorModal para dataType === 'extrato'.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import type { GenericOcrRow } from '../../lib/parcelamentoColunasExtract';
import { EXTRATO_RECORTE_FIEL_FLAG } from '../logic/extratoRecorteFielImport';
import type { ExtratoPlanoContaOption } from './ExtratoContaPicker';
import ExtratoContaPicker from './ExtratoContaPicker';
import {
  saveExtratoBancoParaImportacao,
} from '../logic/extratoOcrLayoutStorage';
import { flushPersistenceAfterCriticalWrite } from '../logic/eyeVisionPersistenceFlush';

const SERVER_URL = 'http://127.0.0.1:3001';

// ─── tipos ────────────────────────────────────────────────────────────────────

type ColRole = 'data' | 'historico' | 'debito' | 'credito' | 'complemento' | null;

interface ColMap {
  data: number;
  historico: number;
  debito: number;
  credito: number;
  complemento: number;
  skipHeaderRows: number;
}

export interface ExtractRecord {
  data: string | null;
  historico: string;
  valor_debito: number | null;
  valor_credito: number | null;
  codigo_historico: string | null;
  complemento: string | null;
}

interface LearnedLayout {
  found: boolean;
  fingerprint: string;
  banco_nome: string;
  conta_banco: string;
  column_map: {
    date_col: number;
    historico_col: number;
    debito_col: number;
    credito_col: number;
    complemento_col: number;
  };
  skip_header_rows: number;
  times_used: number;
  thumbnail_url: string | null;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatValorBr(abs: number): string {
  return abs.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Aceita o valor digitado em qualquer formato comum (com ou sem separador de
// milhar, vírgula ou ponto como decimal).
function parseFlexibleBRLInput(raw: string): number {
  let s = raw.trim().replace(/[^\d.,-]/g, '');
  if (!s) return 0;

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    s = s.replace(',', '.');
  } else if (hasDot) {
    const parts = s.split('.');
    if (parts.length > 2 || parts[parts.length - 1].length > 2) {
      s = s.replace(/\./g, '');
    }
  }

  const value = parseFloat(s);
  return Number.isFinite(value) ? value : 0;
}

// Converte datas em formatos comuns (dd/mm/aaaa ou aaaa-mm-dd) para aaaa-mm-dd
// comparável lexicograficamente.
function toComparableDate(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = s.match(/^\d{4}-\d{2}-\d{2}$/);
  if (iso) return s;
  return null;
}

export function recordToGenericOcrRow(rec: ExtractRecord, idx: number): GenericOcrRow | null {
  const dv = rec.valor_debito;
  const cv = rec.valor_credito;
  if (dv == null && cv == null) return null;

  const isDebit = dv != null && dv !== 0 && (cv == null || cv === 0);
  const abs = isDebit ? Math.abs(dv!) : Math.abs(cv ?? 0);
  const nature: 'D' | 'C' = isDebit ? 'D' : 'C';
  const valorBr = formatValorBr(abs);

  // Histórico preferencial: campo historico + complemento se houver
  const hist = [rec.historico, rec.complemento].filter(Boolean).join(' ');

  const row: GenericOcrRow = {
    data: rec.data ?? '',
    descricao: hist || '',
    valorMisto: valorBr,
    natureza: nature,
    _linhaOcr: [rec.data, hist, isDebit ? `D ${valorBr}` : `C ${valorBr}`].filter(Boolean).join(' | '),
    _extratoOrdem: String(idx + 1),
    [EXTRATO_RECORTE_FIEL_FLAG]: '1',
  };
  if (nature === 'D') {
    row.valorDebito = valorBr;
    row.valorCredito = '';
  } else {
    row.valorCredito = valorBr;
    row.valorDebito = '';
  }
  return row;
}

/** Totais do placar da etapa de revisão (Créditos / Débitos / Saldo Final). */
export function computeReviewTotals(
  rows: GenericOcrRow[],
  saldoAnterior: number,
): { creditos: number; debitos: number; saldoFinal: number } {
  let creditos = 0;
  let debitos = 0;
  for (const row of rows) {
    creditos += parseFlexibleBRLInput(row.valorCredito || '');
    debitos += parseFlexibleBRLInput(row.valorDebito || '');
  }
  return { creditos, debitos, saldoFinal: saldoAnterior + creditos - debitos };
}

// ─── labels das roles ─────────────────────────────────────────────────────────

const ROLE_LABELS: Record<NonNullable<ColRole>, string> = {
  data: 'Data',
  historico: 'Histórico',
  debito: 'Débito',
  credito: 'Crédito',
  complemento: 'Complemento',
};

// ─── props ────────────────────────────────────────────────────────────────────

type Props = {
  file: File;
  title: string;
  companyName?: string;
  planoContaOptions?: ExtratoPlanoContaOption[];
  initialDataInicio?: string;
  initialDataFim?: string;
  initialBancoNome?: string;
  initialContaBanco?: string;
  onCancel: () => void;
  onConfirm: (rows: GenericOcrRow[], meta?: any) => void;
};

// ─── componente ───────────────────────────────────────────────────────────────

export function BankPdfExtractModal({
  file,
  title,
  companyName = '',
  planoContaOptions = [],
  initialDataInicio = '',
  initialDataFim = '',
  initialBancoNome = '',
  initialContaBanco = '',
  onCancel,
  onConfirm,
}: Props) {
  // etapa: 'preview' | 'mapping' | 'extracting' | 'review'
  const [stage, setStage] = useState<'loading' | 'mapping' | 'extracting' | 'review' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Filtro de período (opcional) — definido na etapa anterior, no conversor de
  // OCR; esta tela só o repassa ao servidor.
  const filtroDataInicio = initialDataInicio;
  const filtroDataFim = initialDataFim;

  // Saldo anterior + totais (mostrados após a extração)
  const [saldoAnteriorText, setSaldoAnteriorText] = useState('');
  const [saldoAnterior, setSaldoAnterior] = useState<number>(0);
  const [reviewRows, setReviewRows] = useState<GenericOcrRow[]>([]);
  const [reviewMeta, setReviewMeta] = useState<any>(null);

  // Resultado do /preview
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [totalCols, setTotalCols] = useState(0);
  const [previewStats, setPreviewStats] = useState<Record<string, number>>({});

  // Mapeamento de colunas
  const [colRoles, setColRoles] = useState<(ColRole)[]>([]);
  const [skipRows, setSkipRows] = useState(0);
  // Papel aplicado ao clicar no cabeçalho de uma coluna ainda não mapeada. O
  // mapeamento chega pronto do layout aprendido pelo OCR; o clique serve para
  // acertar a coluna de data quando o layout é novo.
  const selectedRole: ColRole = 'data';

  // Banco / conta (para salvar na conciliação) — normalmente já vêm preenchidos
  // da etapa anterior de upload (Identificação do Extrato).
  const [bancoNome, setBancoNome] = useState(initialBancoNome);
  const [contaBanco, setContaBanco] = useState(initialContaBanco);

  // Layout reconhecido pelo OCR (mapeamento aprendido de uma extração anterior)
  const [learnedLayout, setLearnedLayout] = useState<LearnedLayout | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Pré-carrega o saldo anterior salvo (se houver)
  useEffect(() => {
    const saldoRaw = localStorage.getItem('saldo_anterior');
    const val = saldoRaw ? parseFloat(saldoRaw) || 0 : 0;
    if (val > 0) {
      setSaldoAnterior(val);
      setSaldoAnteriorText(formatValorBr(val));
    }
  }, []);

  // Carregar preview ao montar
  useEffect(() => {
    let active = true;
    setStage('loading');
    setErrorMsg('');

    const load = async () => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('max_rows', '2000');
      fd.append('use_ocr', 'auto');

      try {
        const res = await fetch(`${SERVER_URL}/preview`, { method: 'POST', body: fd });
        if (!active) return;
        if (!res.ok) {
          setErrorMsg(`Servidor retornou status ${res.status}. Verifique se o servidor Python está rodando.`);
          setStage('error');
          return;
        }
        const data = await res.json() as {
          rows: string[][];
          columns: number;
          stats: Record<string, number>;
          error?: string;
          learned?: LearnedLayout | null;
        };
        if (!active) return;
        if (data.error) {
          setErrorMsg(data.error);
          setStage('error');
          return;
        }
        setPreviewRows(data.rows ?? []);
        setTotalCols(data.columns ?? 0);
        setPreviewStats(data.stats ?? {});

        const learned = data.learned && data.learned.found ? data.learned : null;
        setLearnedLayout(learned);

        if (learned) {
          // Layout já conhecido pelo OCR: preenche automaticamente o mapeamento de colunas,
          // banco e conta — o usuário só confere e confirma, sem selecionar de novo.
          const cols = Array.from({ length: data.columns ?? 0 }, () => null as ColRole);
          const map = learned.column_map;
          if (map.date_col >= 0 && map.date_col < cols.length) cols[map.date_col] = 'data';
          if (map.historico_col >= 0 && map.historico_col < cols.length) cols[map.historico_col] = 'historico';
          if (map.debito_col >= 0 && map.debito_col < cols.length) cols[map.debito_col] = 'debito';
          if (map.credito_col >= 0 && map.credito_col < cols.length) cols[map.credito_col] = 'credito';
          if (map.complemento_col >= 0 && map.complemento_col < cols.length) cols[map.complemento_col] = 'complemento';
          setColRoles(cols);
          setSkipRows(learned.skip_header_rows ?? 0);
          if (learned.banco_nome) setBancoNome(learned.banco_nome);
          if (learned.conta_banco) setContaBanco(learned.conta_banco);

          // Extração instantânea: como o OCR já reconhece o layout (colunas, banco
          // e conta preenchidos automaticamente), extrai direto — nem chega a
          // mostrar a tela de mapeamento, que só seria refeita manualmente.
          // Usa os valores recém-lidos do servidor diretamente (não o state, que
          // ainda não foi commitado neste ponto) para evitar falso aviso de
          // "mapeie as colunas" por causa da corrida com o React.
          const instantMap: ColMap = {
            data: map.date_col,
            historico: map.historico_col,
            debito: map.debito_col,
            credito: map.credito_col,
            complemento: map.complemento_col,
            skipHeaderRows: learned.skip_header_rows ?? 0,
          };
          const canInstantExtract =
            !!learned.banco_nome && !!learned.conta_banco &&
            instantMap.data >= 0 && instantMap.historico >= 0 &&
            (instantMap.debito >= 0 || instantMap.credito >= 0);

          if (canInstantExtract) {
            void runExtraction(instantMap, learned.banco_nome, learned.conta_banco);
          } else {
            setStage('mapping');
          }
        } else {
          setColRoles(Array.from({ length: data.columns ?? 0 }, () => null));
          setStage('mapping');
        }
      } catch (e) {
        if (!active) return;
        setErrorMsg(
          `Não foi possível conectar ao servidor Python (${SERVER_URL}).\n` +
          `Inicie o servidor com:\n  cd conversor/bank_pdf_extract\n  .venv\\Scripts\\activate\n  uvicorn main:app --host 127.0.0.1 --port 3001`,
        );
        setStage('error');
      }
    };

    void load();
    return () => { active = false; };
  }, [file]);

  // Limpa mensagem de sucesso após 5s
  useEffect(() => {
    if (!successMsg) return;
    const t = setTimeout(() => setSuccessMsg(''), 5000);
    return () => clearTimeout(t);
  }, [successMsg]);

  const assignRole = useCallback((colIdx: number) => {
    if (!selectedRole) return;
    setColRoles((prev) => {
      const next = [...prev];
      // Remove a mesma role de outra coluna (unicidade)
      for (let i = 0; i < next.length; i++) {
        if (next[i] === selectedRole) next[i] = null;
      }
      next[colIdx] = selectedRole;
      return next;
    });
  }, [selectedRole]);

  const removeRole = useCallback((colIdx: number) => {
    setColRoles((prev) => {
      const next = [...prev];
      next[colIdx] = null;
      return next;
    });
  }, []);

  const buildColMap = (): ColMap => {
    const findCol = (role: ColRole) => colRoles.findIndex((r) => r === role);
    return {
      data: findCol('data'),
      historico: findCol('historico'),
      debito: findCol('debito'),
      credito: findCol('credito'),
      complemento: findCol('complemento'),
      skipHeaderRows: skipRows,
    };
  };

  const canConfirm = () => {
    const map = buildColMap();
    return map.data >= 0 && map.historico >= 0 && (map.debito >= 0 || map.credito >= 0);
  };

  const runExtraction = async (map: ColMap, bancoNomeArg: string, contaBancoArg: string) => {
    setStage('extracting');
    setErrorMsg('');

    const fd = new FormData();
    fd.append('file', file);
    fd.append('date_col', String(map.data));
    fd.append('historico_col', String(map.historico));
    fd.append('debito_col', String(map.debito));
    fd.append('credito_col', String(map.credito));
    fd.append('complemento_col', String(map.complemento));
    fd.append('skip_header_rows', String(map.skipHeaderRows));
    fd.append('use_ocr', 'auto');
    fd.append('max_rows', '20000');
    fd.append('banco_nome', bancoNomeArg.trim());
    fd.append('conta_banco', contaBancoArg.trim());

    try {
      const res = await fetch(`${SERVER_URL}/extract`, { method: 'POST', body: fd });
      if (!res.ok) {
        setErrorMsg(`Servidor retornou status ${res.status}.`);
        setStage('mapping');
        return;
      }
      const data = await res.json() as { records: ExtractRecord[]; count: number; error?: string };
      if (data.error) {
        setErrorMsg(data.error);
        setStage('mapping');
        return;
      }
      const records = data.records ?? [];
      if (records.length === 0) {
        setErrorMsg('Nenhum registro válido extraído. Revise o mapeamento de colunas e linhas de cabeçalho.');
        setStage('mapping');
        return;
      }

      let filteredRecords = records;
      if (filtroDataInicio || filtroDataFim) {
        filteredRecords = records.filter((rec) => {
          const d = toComparableDate(rec.data);
          if (!d) return true; // não filtra o que não conseguimos interpretar
          if (filtroDataInicio && d < filtroDataInicio) return false;
          if (filtroDataFim && d > filtroDataFim) return false;
          return true;
        });
      }

      const genericRows: GenericOcrRow[] = [];
      for (let i = 0; i < filteredRecords.length; i++) {
        const r = recordToGenericOcrRow(filteredRecords[i]!, i);
        if (r) genericRows.push(r);
      }

      if (genericRows.length === 0) {
        setErrorMsg('Nenhum lançamento com valor válido foi encontrado. Verifique as colunas de Débito/Crédito ou o período informado.');
        setStage('mapping');
        return;
      }

      const meta = { saldoAnterior: saldoAnterior > 0.0001 ? saldoAnterior : null };
      setReviewRows(genericRows);
      setReviewMeta(meta);
      setStage('review');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStage('mapping');
    }
  };

  const handleExtract = async () => {
    if (!canConfirm()) {
      setErrorMsg('Mapeie pelo menos: Data, Histórico e Débito ou Crédito.');
      return;
    }
    if (!bancoNome.trim() || !contaBanco.trim()) {
      setErrorMsg('Informe o Nome do banco e a Conta contábil antes de confirmar.');
      return;
    }
    await runExtraction(buildColMap(), bancoNome, contaBanco);
  };

  // Totais ao vivo na tela de mapeamento, calculados a partir das colunas
  // marcadas como Débito/Crédito (ignorando as linhas de cabeçalho).
  const mappingTotals = useMemo(() => {
    const debitoCol = colRoles.findIndex((r) => r === 'debito');
    const creditoCol = colRoles.findIndex((r) => r === 'credito');
    let creditos = 0;
    let debitos = 0;
    if (debitoCol >= 0 || creditoCol >= 0) {
      previewRows.forEach((row, ri) => {
        if (ri < skipRows) return;
        if (debitoCol >= 0) debitos += parseFlexibleBRLInput(row[debitoCol] ?? '');
        if (creditoCol >= 0) creditos += parseFlexibleBRLInput(row[creditoCol] ?? '');
      });
    }
    return { creditos, debitos, saldoFinal: saldoAnterior + creditos - debitos };
  }, [previewRows, colRoles, skipRows, saldoAnterior]);

  const reviewTotals = useMemo(
    () => computeReviewTotals(reviewRows, saldoAnterior),
    [reviewRows, saldoAnterior],
  );

  const handleConfirmImport = () => {
    // Salva banco/conta para a conciliação
    if (companyName.trim()) {
      saveExtratoBancoParaImportacao(companyName, bancoNome, contaBanco);
      void flushPersistenceAfterCriticalWrite();
    }
    onConfirm(reviewRows, reviewMeta);
  };

  // ─── render ─────────────────────────────────────────────────────────────────

  const roleOfCol = (i: number): ColRole => colRoles[i] ?? null;

  return (
    <div className="fixed inset-0 z-[120] bg-brand-bg font-sans text-brand-text flex flex-col antialiased overflow-hidden">

      {/* Toasts */}
      <div className="fixed top-5 right-5 z-[130] flex flex-col gap-2.5 max-w-md pointer-events-none">
        {successMsg && (
          <div className="flex items-start gap-3 bg-white border border-emerald-900/40 shadow-[2px_2px_0_0_#141414] p-4 text-emerald-700 pointer-events-auto">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <p className="text-[11px] text-brand-text/60">{successMsg}</p>
          </div>
        )}
        {errorMsg && (
          <div className="flex items-start gap-3 bg-white border border-rose-400/60 shadow-[2px_2px_0_0_#141414] p-4 text-rose-700 pointer-events-auto">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <pre className="text-[11px] whitespace-pre-wrap leading-normal">{errorMsg}</pre>
          </div>
        )}
      </div>

      {/* Header */}
      <header className="bg-white border-b border-brand-border px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wider text-brand-text">{title}</h2>
          <p className="text-[11px] text-brand-text/50 font-mono mt-0.5">{file.name}</p>
        </div>
        <button type="button" onClick={onCancel} className="technical-button px-4 py-2 text-xs font-bold">
          Cancelar
        </button>
      </header>

      {/* Body */}
      <main className="flex-1 min-h-0 overflow-auto px-6 py-5 flex flex-col gap-5">

        {/* Loading */}
        {stage === 'loading' && (
          <div className="flex flex-col items-center justify-center gap-4 py-20">
            <Loader2 className="w-8 h-8 animate-spin text-brand-text/50" />
            <p className="text-xs text-brand-text/60">Enviando PDF ao servidor de extração…</p>
          </div>
        )}

        {/* Error */}
        {stage === 'error' && (
          <div className="flex flex-col items-center gap-4 py-10">
            <AlertCircle className="w-8 h-8 text-rose-500" />
            <pre className="text-xs text-rose-700 bg-rose-50 border border-rose-200 p-4 rounded whitespace-pre-wrap max-w-xl">{errorMsg}</pre>
            <button type="button" onClick={onCancel} className="technical-button px-4 py-2 text-xs font-bold">
              Fechar
            </button>
          </div>
        )}

        {/* Extracting */}
        {stage === 'extracting' && (
          <div className="flex flex-col items-center justify-center gap-4 py-20">
            <Loader2 className="w-8 h-8 animate-spin text-brand-text/50" />
            <p className="text-xs text-brand-text/60">Extraindo lançamentos…</p>
          </div>
        )}

        {/* Mapping */}
        {stage === 'mapping' && (
          <>
            {/* Layout reconhecido pelo OCR */}
            {learnedLayout && (
              <div className="flex items-center gap-4 bg-emerald-50 border border-emerald-300 p-4">
                {learnedLayout.thumbnail_url && (
                  <img
                    src={`${SERVER_URL}${learnedLayout.thumbnail_url}`}
                    alt="Layout reconhecido"
                    className="w-16 h-20 object-cover border border-emerald-300 bg-white shrink-0"
                  />
                )}
                <div className="flex-1">
                  <p className="text-xs font-black uppercase tracking-wider text-emerald-800 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" /> Layout reconhecido pelo OCR
                  </p>
                  <p className="text-[11px] text-emerald-700/80 mt-1">
                    {learnedLayout.banco_nome || 'Banco já visto'}
                    {learnedLayout.times_used > 0 ? ` · usado ${learnedLayout.times_used}x` : ' · layout nativo do servidor'} ·
                    {' '}colunas preenchidas automaticamente. Confira e confirme abaixo.
                  </p>
                </div>
              </div>
            )}

            {/* Stats */}
            {Object.keys(previewStats).length > 0 && (
              <div className="flex gap-3 flex-wrap text-[10px] font-mono text-brand-text/50">
                {Object.entries(previewStats).map(([k, v]) => (
                  <span key={k} className="bg-brand-sidebar border border-brand-border px-2 py-1">
                    {k}: {v}
                  </span>
                ))}
              </div>
            )}

            {/* Banco + Conta — só aparece aqui se não veio preenchido da etapa
                anterior de upload (Identificação do Extrato). */}
            {!contaBanco.trim() && (
            <div className="bg-white border border-brand-border p-4 flex flex-col gap-3">
              <h3 className="text-xs font-bold text-brand-text/60 uppercase tracking-wider">Identificação do Extrato</h3>
              <div className="flex flex-wrap gap-3">
                <div className="flex flex-col gap-1 min-w-[180px]">
                  <label className="text-[11px] font-semibold text-brand-text/70">Nome do banco</label>
                  <input
                    type="text"
                    value={bancoNome}
                    onChange={(e) => setBancoNome(e.target.value)}
                    placeholder="Ex: Bradesco, Itaú, Santander…"
                    className="technical-input text-xs px-2 py-1.5"
                  />
                </div>
                <div className="flex flex-col gap-1 min-w-[200px]">
                  <label className="text-[11px] font-semibold text-brand-text/70">Conta contábil do banco</label>
                  <ExtratoContaPicker
                    value={contaBanco}
                    onChange={setContaBanco}
                    options={planoContaOptions}
                  />
                </div>
              </div>
            </div>
            )}

            {/* Saldo anterior + Totais ao vivo (Débito/Crédito mapeados) */}
            {(colRoles.includes('debito') || colRoles.includes('credito')) && (
              <div className="grid grid-cols-4 gap-2">
                <div className="border border-brand-border bg-white p-1.5 text-center">
                  <label className="block text-[8px] font-bold uppercase tracking-wide text-brand-text/50">Saldo Anterior</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={saldoAnteriorText}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setSaldoAnteriorText(raw);
                      setSaldoAnterior(parseFlexibleBRLInput(raw));
                    }}
                    onBlur={() => {
                      if (saldoAnteriorText.trim()) {
                        setSaldoAnteriorText(formatValorBr(saldoAnterior));
                      }
                    }}
                    placeholder="0,00"
                    className="w-full text-center bg-transparent text-[12px] font-bold font-mono text-brand-text outline-none"
                  />
                </div>
                <div className="border border-brand-border bg-white p-1.5 text-center">
                  <p className="text-[8px] font-bold uppercase tracking-wide text-brand-text/50">Créditos</p>
                  <p className="text-[12px] font-bold font-mono text-emerald-700">{formatValorBr(mappingTotals.creditos)}</p>
                </div>
                <div className="border border-brand-border bg-white p-1.5 text-center">
                  <p className="text-[8px] font-bold uppercase tracking-wide text-brand-text/50">Débitos</p>
                  <p className="text-[12px] font-bold font-mono text-rose-700">{formatValorBr(mappingTotals.debitos)}</p>
                </div>
                <div className="border border-brand-border bg-brand-border p-1.5 text-center">
                  <p className="text-[8px] font-bold uppercase tracking-wide text-brand-bg/70">Saldo Final</p>
                  <p className="text-[12px] font-bold font-mono text-brand-bg">{formatValorBr(mappingTotals.saldoFinal)}</p>
                </div>
              </div>
            )}

            {/* Tabela de preview — cresce para ocupar o que sobra da janela, com
                piso de 20 lançamentos visíveis antes de precisar rolar. */}
            <div className="bg-white border border-brand-border overflow-x-auto overflow-y-auto flex-1 min-h-[520px]">
              <table className="w-full text-[11px] font-mono border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-brand-sidebar">
                    <th className="border border-brand-border px-2 py-1 text-brand-text/50 text-[10px] w-8">#</th>
                    {Array.from({ length: totalCols }, (_, ci) => {
                      const role = roleOfCol(ci);
                      return (
                        <th
                          key={ci}
                          className={`border border-brand-border px-2 py-1 cursor-pointer select-none transition-colors ${
                            role
                              ? 'bg-brand-sidebar text-brand-text font-black'
                              : 'text-brand-text/60 hover:bg-brand-sidebar/50'
                          }`}
                          onClick={() => {
                            if (role) removeRole(ci);
                            else assignRole(ci);
                          }}
                          title={role ? `Clique para remover: ${ROLE_LABELS[role]}` : `Clique para marcar como: ${selectedRole ? ROLE_LABELS[selectedRole] : '—'}`}
                        >
                          {role ? ROLE_LABELS[role] : `col ${ci}`}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, ri) => (
                    <tr
                      key={ri}
                      className={ri < skipRows ? 'opacity-30 line-through bg-gray-50' : 'hover:bg-brand-sidebar/30'}
                    >
                      <td className="border border-brand-border px-2 py-0.5 text-brand-text/30 text-[9px] text-center">{ri + 1}</td>
                      {Array.from({ length: totalCols }, (_, ci) => {
                        const role = roleOfCol(ci);
                        return (
                          <td
                            key={ci}
                            className={`border border-brand-border px-2 py-0.5 whitespace-nowrap ${
                              role ? 'bg-brand-sidebar/40' : ''
                            }`}
                          >
                            {row[ci] ?? ''}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {previewRows.length === 0 && (
                <p className="text-xs text-brand-text/50 text-center py-8">Nenhuma linha encontrada no preview.</p>
              )}
            </div>
          </>
        )}

        {/* Review: saldo anterior + totais + confirmação final */}
        {stage === 'review' && (
          <div className="bg-white border border-brand-border p-4 flex flex-col gap-4 flex-1 min-h-0">
            <div className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="w-4 h-4" />
              <p className="text-xs font-bold uppercase tracking-wide">
                {reviewRows.length} lançamento(s) extraído(s)
              </p>
            </div>

            <div className="grid grid-cols-4 gap-2">
              <div className="border border-brand-border bg-white p-1.5 text-center">
                <label className="block text-[8px] font-bold uppercase tracking-wide text-brand-text/50">Saldo Anterior</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={saldoAnteriorText}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setSaldoAnteriorText(raw);
                    setSaldoAnterior(parseFlexibleBRLInput(raw));
                  }}
                  onBlur={() => {
                    if (saldoAnteriorText.trim()) {
                      setSaldoAnteriorText(formatValorBr(saldoAnterior));
                    }
                  }}
                  placeholder="0,00"
                  className="w-full text-center bg-transparent text-[12px] font-bold font-mono text-brand-text outline-none"
                />
              </div>
              <div className="border border-brand-border bg-white p-1.5 text-center">
                <p className="text-[8px] font-bold uppercase tracking-wide text-brand-text/50">Créditos</p>
                <p className="text-[12px] font-bold font-mono text-emerald-700">{formatValorBr(reviewTotals.creditos)}</p>
              </div>
              <div className="border border-brand-border bg-white p-1.5 text-center">
                <p className="text-[8px] font-bold uppercase tracking-wide text-brand-text/50">Débitos</p>
                <p className="text-[12px] font-bold font-mono text-rose-700">{formatValorBr(reviewTotals.debitos)}</p>
              </div>
              <div className="border border-brand-border bg-brand-border p-1.5 text-center">
                <p className="text-[8px] font-bold uppercase tracking-wide text-brand-bg/70">Saldo Final</p>
                <p className="text-[12px] font-bold font-mono text-brand-bg">{formatValorBr(reviewTotals.saldoFinal)}</p>
              </div>
            </div>

            <div className="border-t border-brand-border pt-3 flex-1 min-h-0 overflow-y-auto divide-y divide-brand-border/20">
              {reviewRows.map((row, idx) => (
                <div key={idx} className="flex justify-between gap-2 py-1.5 text-[10px] font-mono hover:bg-brand-sidebar/30">
                  <span className="text-brand-text/50 shrink-0">{row.data}</span>
                  <span className="flex-1 truncate text-brand-text" title={row.descricao}>{row.descricao}</span>
                  <span className={`shrink-0 font-bold ${row.natureza === 'C' ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {row.natureza === 'C' ? '+' : '-'}{row.valorMisto}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      {(stage === 'mapping' || stage === 'extracting') && (
        <footer className="bg-white border-t border-brand-border py-4 px-6 shrink-0 flex items-center justify-between gap-4">
          <p className="text-xs text-brand-text/50">
            {previewRows.length} linha(s) no preview · {totalCols} coluna(s)
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="technical-button px-4 py-2 text-xs font-bold">
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void handleExtract()}
              disabled={!canConfirm() || stage === 'extracting'}
              className="technical-button-primary px-4 py-2 text-xs font-bold disabled:opacity-40 flex items-center gap-2"
            >
              {stage === 'extracting' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              OK — Importar lançamentos
            </button>
          </div>
        </footer>
      )}

      {stage === 'review' && (
        <footer className="bg-white border-t border-brand-border py-4 px-6 shrink-0 flex items-center justify-between gap-4">
          <p className="text-xs text-brand-text/50">{reviewRows.length} lançamento(s)</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setStage('mapping')} className="technical-button px-4 py-2 text-xs font-bold">
              ← Voltar
            </button>
            <button
              type="button"
              onClick={handleConfirmImport}
              className="technical-button-primary px-4 py-2 text-xs font-bold"
            >
              Confirmar Importação
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
