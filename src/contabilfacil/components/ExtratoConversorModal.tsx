import React, { useMemo, useState } from 'react';
import { Upload, Download, AlertCircle, CheckCircle2, Loader2, ArrowRight } from 'lucide-react';
import {
  convertPDFFileToJSON,
  convertJSONFileToStatement,
  validateBankStatement,
  BankStatementJSON,
  BankStatementMetadata,
} from '../../lib/extratoParser';
import { BankCode, BANK_FORMATS } from '../../lib/extratoParser/bankFormats';
import { bankStatementToOfx, downloadOfxFile } from '../../lib/extratoParser/toOfx';
import { BankSelector } from './BankSelector';
import { LayoutSelector } from './LayoutSelector';
import ExtratoContaPicker, { type ExtratoPlanoContaOption } from './ExtratoContaPicker';

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Aceita o valor digitado em qualquer formato comum (com ou sem separador de
// milhar, vírgula ou ponto como decimal): "1418,44", "1.418,44", "1418.44",
// "1418" — sem travar ou embaralhar o que o usuário está digitando.
function parseFlexibleBRLInput(raw: string): number {
  let s = raw.trim().replace(/[^\d.,-]/g, '');
  if (!s) return 0;

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    // Ponto = milhar, vírgula = decimal (ex.: "1.418,44")
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    // Só vírgula = decimal (ex.: "1418,44")
    s = s.replace(',', '.');
  } else if (hasDot) {
    // Só ponto: decimal se for o único e tiver até 2 dígitos depois
    // (ex.: "1418.44"); senão é separador de milhar (ex.: "1.418")
    const parts = s.split('.');
    if (parts.length > 2 || parts[parts.length - 1].length > 2) {
      s = s.replace(/\./g, '');
    }
  }

  const value = parseFloat(s);
  return Number.isFinite(value) ? value : 0;
}

interface ExtratoConversorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport?: (data: BankStatementJSON, contaBanco: string, bancoNome: string) => void;
  planoContaOptions?: ExtratoPlanoContaOption[];
}

type Step = 'bank' | 'layout' | 'upload' | 'result';

const INPUT_CLS =
  'w-full px-3 py-2 border border-brand-border bg-white text-[11px] font-mono text-brand-text placeholder:text-brand-text/40 outline-none focus:bg-brand-sidebar/30';

export function ExtratoConversorModal({ isOpen, onClose, onImport, planoContaOptions = [] }: ExtratoConversorModalProps) {
  const [step, setStep] = useState<Step>('bank');
  const [selectedBank, setSelectedBank] = useState<BankCode | null>(null);
  const [selectedLayout, setSelectedLayout] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<BankStatementJSON | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<Partial<BankStatementMetadata>>({});
  const [contaBanco, setContaBanco] = useState('');
  const [validation, setValidation] = useState<any>(null);
  const [saldoAnterior, setSaldoAnterior] = useState<number>(0);
  const [saldoAnteriorText, setSaldoAnteriorText] = useState('');
  const [filtroDataInicio, setFiltroDataInicio] = useState('');
  const [filtroDataFim, setFiltroDataFim] = useState('');

  const totals = useMemo(() => {
    if (!result) return { creditos: 0, debitos: 0, saldoFinal: 0 };
    let creditos = 0;
    let debitos = 0;
    for (const tx of result.transactions) {
      if (tx.amount >= 0) creditos += tx.amount;
      else debitos += Math.abs(tx.amount);
    }
    return { creditos, debitos, saldoFinal: saldoAnterior + creditos - debitos };
  }, [result, saldoAnterior]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      const isPdf = selectedFile.type === 'application/pdf';
      const isJson = selectedFile.type === 'application/json' || selectedFile.name.endsWith('.json');

      if (isPdf || (isJson && selectedBank === 'INFINITE_PAY')) {
        setFile(selectedFile);
        setError(null);
        setResult(null);
      } else {
        const formats = selectedBank === 'INFINITE_PAY' ? 'PDF ou JSON' : 'PDF';
        setError(`Por favor selecione um arquivo ${formats} válido`);
      }
    }
  };

  const handleConvert = async () => {
    if (!file) {
      setError('Por favor selecione um arquivo');
      return;
    }

    if (!contaBanco.trim()) {
      setError('Selecione a conta do banco (plano de contas) antes de converter');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const isJson = file.type === 'application/json' || file.name.endsWith('.json');

      let data: BankStatementJSON;
      if (isJson) {
        data = await convertJSONFileToStatement(file, {}, selectedBank ?? undefined);
      } else {
        data = await convertPDFFileToJSON(file, {}, selectedBank ?? undefined, selectedLayout ?? undefined);
      }

      if (filtroDataInicio || filtroDataFim) {
        const transactionsFiltradas = data.transactions.filter((tx) => {
          if (filtroDataInicio && tx.date < filtroDataInicio) return false;
          if (filtroDataFim && tx.date > filtroDataFim) return false;
          return true;
        });
        data = { ...data, transactions: transactionsFiltradas };
      }

      const validationResult = validateBankStatement(data);

      setResult(data);
      setValidation(validationResult);

      if (!validationResult.valid) {
        setError(
          `Conversão realizada com avisos: ${validationResult.errors.join(', ')}`
        );
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Erro ao converter arquivo'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadOfx = () => {
    if (!result) return;
    const ofx = bankStatementToOfx(result.transactions, result.metadata, saldoAnterior);
    downloadOfxFile(ofx, `extrato_${result.metadata.bank_name.replace(/\s+/g, '_')}_${new Date().getTime()}.ofx`);
  };

  const handleImport = () => {
    if (result && onImport) {
      const bankName = selectedBank ? BANK_FORMATS[selectedBank]?.displayName || String(selectedBank) : '';
      const bName = result.metadata.bank_name || bankName || '';
      onImport(result, contaBanco, bName);
      onClose();
    }
  };

  const handleSelectBank = (bankCode: BankCode) => {
    setSelectedBank(bankCode);
    setStep('layout');
  };

  const handleSelectLayout = (layoutId: string) => {
    setSelectedLayout(layoutId);
    setStep('upload');
  };

  const handleBackToBank = () => {
    setSelectedBank(null);
    setSelectedLayout(null);
    setStep('bank');
  };

  const handleBackToLayout = () => {
    setSelectedLayout(null);
    setStep('layout');
  };

  const handleReset = () => {
    setStep('bank');
    setSelectedBank(null);
    setSelectedLayout(null);
    setFile(null);
    setResult(null);
    setError(null);
    setValidation(null);
    setMetadata({});
    setSaldoAnterior(0);
    setSaldoAnteriorText('');
    setFiltroDataInicio('');
    setFiltroDataFim('');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-brand-bg border border-brand-border shadow-[4px_4px_0_0_#141414] max-w-2xl w-full max-h-[90vh] overflow-y-auto font-sans text-brand-text">
        {/* Header com progress */}
        <div className="bg-white border-b border-brand-border px-6 py-4 sticky top-0 z-10">
          <h2 className="text-sm font-black uppercase tracking-wider">Conversor de Extratos Bancários com Texto</h2>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-brand-text/50 mt-2">
            <span className={step === 'bank' ? 'text-brand-text' : ''}>1. Banco</span>
            <ArrowRight className="w-3 h-3" />
            <span className={step === 'layout' ? 'text-brand-text' : ''}>2. Layout</span>
            <ArrowRight className="w-3 h-3" />
            <span className={step === 'upload' || step === 'result' ? 'text-brand-text' : ''}>
              3. Arquivo
            </span>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {/* Etapa 1: Seleção de Banco */}
          {step === 'bank' && (
            <div className="space-y-4">
              <BankSelector onSelect={handleSelectBank} selectedBank={selectedBank ?? undefined} />
            </div>
          )}

          {/* Etapa 2: Seleção de Layout */}
          {step === 'layout' && selectedBank && (
            <div className="space-y-4">
              <LayoutSelector
                bankCode={selectedBank}
                onSelect={handleSelectLayout}
                onBack={handleBackToBank}
                selectedLayout={selectedLayout ?? undefined}
              />
            </div>
          )}

          {/* Etapa 3: Upload e Conversão */}
          {(step === 'upload' || step === 'result') && selectedBank && !result ? (
            <div className="space-y-4">
              {/* Info do banco e layout selecionados */}
              <div className="border border-brand-border bg-brand-sidebar px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide">
                      {selectedBank} · {selectedLayout || 'Layout selecionado'}
                    </p>
                    <p className="text-[10px] text-brand-text/60 mt-0.5">Etapa 3 de 3 — Upload do arquivo PDF</p>
                  </div>
                  <button onClick={handleBackToLayout} className="technical-button text-[9px] px-2 py-1">
                    ← Voltar
                  </button>
                </div>
              </div>

              {/* File Upload */}
              <label
                htmlFor="file-input"
                className="block border border-dashed border-brand-border bg-white p-8 text-center cursor-pointer hover:bg-brand-sidebar/30"
              >
                <Upload className="w-10 h-10 mx-auto mb-2 text-brand-text/40" />
                <input
                  type="file"
                  accept={selectedBank === 'INFINITE_PAY' ? '.pdf,.json' : '.pdf'}
                  onChange={handleFileSelect}
                  className="hidden"
                  id="file-input"
                />
                <span className="text-[11px] text-brand-text/60">
                  Clique ou arraste um arquivo {selectedBank === 'INFINITE_PAY' ? 'PDF ou JSON' : 'PDF'}
                </span>
                {file && <p className="text-[11px] mt-2 font-bold font-mono">{file.name}</p>}
              </label>

              {/* Filtro de Período */}
              <div className="border border-brand-border bg-white p-3">
                <label className="block text-[10px] font-bold uppercase tracking-wide text-brand-text/60 mb-1">
                  Filtrar por período (opcional)
                </label>
                <p className="text-[10px] text-brand-text/50 mb-2">
                  Se o arquivo tiver mais de um mês, informe as datas para extrair só o intervalo desejado. Deixe em branco para extrair tudo.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[9px] font-bold uppercase tracking-wide text-brand-text/50 mb-1">
                      De
                    </label>
                    <input
                      type="date"
                      value={filtroDataInicio}
                      onChange={(e) => setFiltroDataInicio(e.target.value)}
                      max={filtroDataFim || undefined}
                      className={INPUT_CLS}
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold uppercase tracking-wide text-brand-text/50 mb-1">
                      Até
                    </label>
                    <input
                      type="date"
                      value={filtroDataFim}
                      onChange={(e) => setFiltroDataFim(e.target.value)}
                      min={filtroDataInicio || undefined}
                      className={INPUT_CLS}
                    />
                  </div>
                </div>
              </div>

              {/* Conta do Banco */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-brand-text/60 mb-1">
                  Conta do Banco (Plano de Contas) <span className="text-rose-700">*</span>
                </label>
                <ExtratoContaPicker
                  value={contaBanco}
                  options={planoContaOptions}
                  onChange={setContaBanco}
                  includeSinteticas
                  showNomeInline
                  bgWhite
                  placeholder="Código reduzido da conta bancária…"
                  ariaLabel="Conta do banco no plano de contas"
                />
                {!contaBanco.trim() && (
                  <p className="text-[10px] text-rose-700 mt-1">Campo obrigatório</p>
                )}
              </div>

              {error && (
                <div className="border border-rose-400/60 bg-white shadow-[2px_2px_0_0_#141414] p-3 flex gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-rose-700">{error}</p>
                </div>
              )}

              <button
                onClick={handleConvert}
                disabled={!file || !contaBanco.trim() || loading}
                className="technical-button-primary w-full py-2.5 flex items-center justify-center gap-2 disabled:opacity-40"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Convertendo…
                  </>
                ) : (
                  'Converter PDF'
                )}
              </button>
            </div>
          ) : result ? (
            <div className="space-y-4">
              {/* Success Message */}
              <div className="border border-emerald-900/40 bg-white shadow-[2px_2px_0_0_#141414] p-3 flex gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                <div className="text-[11px] text-emerald-700">
                  <p className="font-bold uppercase tracking-wide">Conversão concluída com sucesso!</p>
                  <p className="text-brand-text/70">{result.transactions.length} transações convertidas</p>
                </div>
              </div>

              {/* Result Preview */}
              <div className="border border-brand-border bg-white">
                <div className="bg-brand-sidebar border-b border-brand-border px-3 py-2">
                  <h3 className="text-[10px] font-bold uppercase tracking-wide">Resumo do extrato</h3>
                </div>
                <div className="p-4 space-y-1.5 text-[11px] font-mono">
                  <p>
                    <span className="text-brand-text/50 uppercase text-[9px] tracking-wide">Banco</span>{' '}
                    {result.metadata.bank_name}
                  </p>
                  <p>
                    <span className="text-brand-text/50 uppercase text-[9px] tracking-wide">Conta</span>{' '}
                    {result.metadata.account_number}
                  </p>
                  <p>
                    <span className="text-brand-text/50 uppercase text-[9px] tracking-wide">Período</span>{' '}
                    {result.metadata.period}
                  </p>
                  <p>
                    <span className="text-brand-text/50 uppercase text-[9px] tracking-wide">Transações</span>{' '}
                    {result.transactions.length}
                  </p>
                </div>

                {/* Saldo Anterior */}
                <div className="px-4 pb-4">
                  <label className="block text-[10px] font-bold uppercase tracking-wide text-brand-text/60 mb-1">
                    Saldo Anterior (R$)
                  </label>
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
                        setSaldoAnteriorText(formatBRL(saldoAnterior));
                      }
                    }}
                    className={INPUT_CLS}
                    placeholder="0,00"
                  />
                </div>

                {/* Totais */}
                <div className="px-4 pb-4 grid grid-cols-3 gap-2">
                  <div className="border border-brand-border bg-white p-2 text-center">
                    <p className="text-[9px] font-bold uppercase tracking-wide text-brand-text/50">Créditos</p>
                    <p className="text-[12px] font-bold font-mono text-emerald-700">
                      {formatBRL(totals.creditos)}
                    </p>
                  </div>
                  <div className="border border-brand-border bg-white p-2 text-center">
                    <p className="text-[9px] font-bold uppercase tracking-wide text-brand-text/50">Débitos</p>
                    <p className="text-[12px] font-bold font-mono text-rose-700">
                      {formatBRL(totals.debitos)}
                    </p>
                  </div>
                  <div className="border border-brand-border bg-brand-border p-2 text-center">
                    <p className="text-[9px] font-bold uppercase tracking-wide text-brand-bg/70">Saldo Final</p>
                    <p className="text-[12px] font-bold font-mono text-brand-bg">
                      {formatBRL(totals.saldoFinal)}
                    </p>
                  </div>
                </div>

                {/* Todas as transações */}
                <div className="border-t border-brand-border">
                  <div className="bg-brand-sidebar px-3 py-2 border-b border-brand-border">
                    <h4 className="text-[10px] font-bold uppercase tracking-wide">
                      Todas as transações ({result.transactions.length})
                    </h4>
                  </div>
                  <div className="max-h-64 overflow-y-auto divide-y divide-brand-border/20">
                    {result.transactions.map((tx, idx) => (
                      <div key={idx} className="flex justify-between gap-2 px-3 py-1.5 text-[10px] font-mono hover:bg-brand-sidebar/30">
                        <span className="text-brand-text/50 shrink-0">{tx.date}</span>
                        <span className="flex-1 truncate text-brand-text" title={tx.description}>
                          {tx.description}
                        </span>
                        <span className={`shrink-0 font-bold ${tx.amount >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {tx.amount >= 0 ? '+' : ''}{tx.amount.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {validation?.warnings.length > 0 && (
                <div className="border border-amber-500/50 bg-white shadow-[2px_2px_0_0_#141414] p-3 text-[11px] text-amber-800">
                  <p className="font-bold uppercase tracking-wide text-[10px]">Avisos</p>
                  <ul className="list-disc list-inside mt-1 space-y-0.5">
                    {validation.warnings.slice(0, 3).map((w: string, i: number) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-2">
                <button
                  onClick={handleDownloadOfx}
                  className="technical-button-primary flex-1 py-2.5 flex items-center justify-center gap-2"
                >
                  <Download className="w-3.5 h-3.5" />
                  Baixar OFX
                </button>
                {onImport && (
                  <button
                    onClick={handleImport}
                    className="technical-button-secondary flex-1 py-2.5"
                  >
                    Importar para Conciliação
                  </button>
                )}
                <button
                  onClick={handleReset}
                  className="technical-button flex-1 py-2.5"
                >
                  Novo
                </button>
              </div>
            </div>
          ) : null}

          {/* Botão Fechar - só mostra se não estiver em resultado */}
          {result === null && (
            <button
              onClick={onClose}
              className="technical-button w-full py-2.5"
            >
              Fechar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
