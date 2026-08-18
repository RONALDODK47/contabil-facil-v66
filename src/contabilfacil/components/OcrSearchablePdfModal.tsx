import React, { useEffect, useMemo, useState } from 'react';
import { Upload, FileText, Loader2, Download, X, ExternalLink, FolderOpen } from 'lucide-react';
import { convertPdfToImages, processOcrImages, type OcrImagem } from '../../lib/ocrSearchablePdf';
import { cn } from '../lib/utils';
import ExtratoContaPicker, { type ExtratoPlanoContaOption, buildPlanoNomeLookup, resolveContaNome } from './ExtratoContaPicker';

type Props = {
  onClose: () => void;
  onComplete: (
    file: File | null,
    text: string,
    pdfUrl: string | null,
    dataInicio?: string,
    dataFim?: string,
    bancoNome?: string,
    contaBanco?: string,
    /** PDF original (sem a camada de OCR). A extração de lançamentos deve usar este:
     *  o servidor faz o próprio OCR e o PDF "searchable" já vem re-renderizado, o que
     *  fazia sumir lançamentos de valor pequeno (ex.: tarifas "TAR PIX"). */
    originalFile?: File | null,
  ) => void;
  planoContaOptions?: ExtratoPlanoContaOption[];
};

const OCR_SERVER_URL = 'http://127.0.0.1:3001';

interface LearnedLayoutInfo {
  fingerprint: string;
  banco_nome: string;
  conta_banco: string;
  times_used: number;
  updated_at: string | null;
  sample_file_name: string | null;
  thumbnail_url: string | null;
}

export function OcrSearchablePdfModal({ onClose, onComplete, planoContaOptions = [] }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ text: string; pdfUrl: string | null } | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [bancoNome, setBancoNome] = useState('');
  const [bancoNomeAuto, setBancoNomeAuto] = useState(true);
  const [contaBanco, setContaBanco] = useState('');

  const planoNomeLookup = useMemo(() => buildPlanoNomeLookup(planoContaOptions), [planoContaOptions]);

  const handleContaBancoChange = (code: string) => {
    setContaBanco(code);
    if (!bancoNomeAuto) return;
    const nome = resolveContaNome(planoNomeLookup, code, planoContaOptions).replace(/^banco\s+/i, '').trim();
    setBancoNome(nome);
  };

  const handleBancoNomeChange = (value: string) => {
    setBancoNomeAuto(false);
    setBancoNome(value);
  };

  // Pasta de layouts que o OCR já aprendeu a extrair (servidor Python local)
  const [learnedLayouts, setLearnedLayouts] = useState<LearnedLayoutInfo[]>([]);
  const [learnedLoadError, setLearnedLoadError] = useState<string | null>(null);
  const [showLearnedFolder, setShowLearnedFolder] = useState(false);

  const loadLearnedLayouts = () => {
    fetch(`${OCR_SERVER_URL}/layouts`)
      .then((res) => res.json())
      .then((data: { layouts: LearnedLayoutInfo[] }) => {
        setLearnedLayouts(data.layouts ?? []);
        setLearnedLoadError(null);
      })
      .catch(() => {
        setLearnedLoadError('Servidor OCR local indisponível — inicie com "npm run dev".');
      });
  };

  useEffect(() => {
    loadLearnedLayouts();
  }, []);

  // Layouts aprendidos não podem ser excluídos pela interface: apagar um layout
  // faria o OCR esquecer o mapeamento de colunas daquele banco e obrigaria a
  // remapear tudo de novo no próximo extrato.

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setError(null);
    setResult(null);
  };

  const handleProcess = async () => {
    if (!file) return;
    setIsProcessing(true);
    setProgress(0);
    setError(null);

    try {
      let images: OcrImagem[] = [];
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        images = await convertPdfToImages(file);
      } else {
        const reader = new FileReader();
        const imageData = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('Falha ao ler imagem.'));
          reader.readAsDataURL(file);
        });
        images = [imageData];
      }

      const { text, pdfBlob } = await processOcrImages(images, (p) => setProgress(p));
      const pdfUrl = URL.createObjectURL(pdfBlob);
      setResult({ text, pdfUrl });
      
      const newName = file.name.slice(0, file.name.lastIndexOf('.')) + '_searchable.pdf';
      const searchableFile = new File([pdfBlob], newName, { type: 'application/pdf' });
      
      onComplete(searchableFile, text, pdfUrl, dataInicio || undefined, dataFim || undefined, bancoNome || undefined, contaBanco || undefined, file);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao processar OCR.';
      setError(message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setResult(null);
    setError(null);
    setProgress(0);
    setDataInicio('');
    setDataFim('');
    setBancoNome('');
    setBancoNomeAuto(true);
    setContaBanco('');
  };

  if (isMinimized) {
    return (
      <div className="fixed bottom-6 right-6 z-[999] bg-brand-bg border-2 border-brand-border p-4 shadow-[4px_4px_0_0_#101010] flex items-center gap-3 select-none animate-fade-in">
        <div className="flex items-center gap-2">
          {isProcessing ? (
            <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin" />
          ) : (
            <div className="w-3 h-3 rounded-full bg-emerald-500" />
          )}
          <span className="text-[10px] font-black uppercase tracking-wider text-brand-text">
            {isProcessing ? `OCR em Andamento: ${progress}%` : 'OCR Concluído'}
          </span>
        </div>
        <div className="flex gap-1.5 ml-2">
          <button
            type="button"
            onClick={() => setIsMinimized(false)}
            className="text-[9px] uppercase font-bold border border-brand-border bg-white text-brand-text px-2.5 py-1 hover:bg-brand-sidebar transition-all cursor-pointer font-sans"
          >
            Maximizar
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-[9px] uppercase font-bold border border-brand-border hover:bg-rose-50 hover:text-rose-600 px-2 py-1 transition-all cursor-pointer font-sans"
            title="Fechar OCR"
          >
            Fechar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-brand-bg border border-brand-border shadow-[8px_8px_0_0_#101010] p-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-black uppercase tracking-[0.25em]">Conversor de Extratos sem Texto (OCR)</h2>
            <p className="text-[10px] text-brand-text/60 mt-1">Use este módulo para arquivos sem texto selecionável. O resultado gera PDF pesquisável e texto extraído.</p>
          </div>
          <div className="flex items-center gap-3">
            {isProcessing && (
              <button
                type="button"
                onClick={() => setIsMinimized(true)}
                className="text-brand-text/60 hover:text-brand-text text-sm font-black border border-brand-border/40 hover:border-brand-border px-2 py-0.5 transition-all cursor-pointer font-sans"
                title="Minimizar progresso"
              >
                —
              </button>
            )}
            <button onClick={onClose} className="text-brand-text text-lg font-bold leading-none cursor-pointer">×</button>
          </div>
        </div>

        {/* Identificação do Extrato */}
        <div className="border border-brand-border bg-white p-3 flex flex-col gap-3">
          <label className="block text-[10px] font-bold uppercase tracking-wide text-brand-text/60">
            Identificação do Extrato
          </label>
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1 min-w-[180px]">
              <label className="text-[9px] font-bold uppercase tracking-wide text-brand-text/50">Nome do banco</label>
              <input
                type="text"
                value={bancoNome}
                onChange={(e) => handleBancoNomeChange(e.target.value)}
                placeholder="Ex: Bradesco, Itaú, Santander…"
                className="w-full px-3 py-2 border border-brand-border bg-white text-[11px] font-mono text-brand-text outline-none focus:bg-brand-sidebar/30"
              />
            </div>
            <div className="flex flex-col gap-1 min-w-[200px]">
              <label className="text-[9px] font-bold uppercase tracking-wide text-brand-text/50">
                Conta contábil do banco <span className="text-rose-700">*</span>
              </label>
              <ExtratoContaPicker
                value={contaBanco}
                options={planoContaOptions}
                onChange={handleContaBancoChange}
                includeSinteticas
                showNomeInline
                bgWhite
                placeholder="Código reduzido da conta bancária…"
                ariaLabel="Conta do banco no plano de contas"
              />
            </div>
          </div>
          {!contaBanco.trim() && (
            <p className="text-[10px] text-rose-700">Informe a conta do banco para liberar o upload do arquivo.</p>
          )}
        </div>

        <label
          htmlFor="ocr-file-input"
          className={cn(
            'block border border-dashed border-brand-border bg-white p-8 text-center',
            contaBanco.trim() ? 'cursor-pointer hover:bg-brand-sidebar/30' : 'opacity-40 cursor-not-allowed pointer-events-none',
          )}
        >
          <Upload className="w-10 h-10 mx-auto mb-2 text-brand-text/40" />
          <input
            type="file"
            id="ocr-file-input"
            accept="application/pdf,image/*"
            onChange={handleFileChange}
            disabled={!contaBanco.trim()}
            className="hidden"
          />
          <span className="text-[11px] text-brand-text/60">Clique ou arraste um arquivo PDF ou imagem</span>
          {file && <p className="text-[11px] mt-2 font-bold font-mono">{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</p>}
        </label>

        {/* Filtro de período a extrair */}
        <div className="border border-brand-border bg-white p-3">
          <label className="block text-[10px] font-bold uppercase tracking-wide text-brand-text/60 mb-1">
            Filtrar por período (opcional)
          </label>
          <p className="text-[10px] text-brand-text/50 mb-2">
            Se o arquivo tiver mais de um mês, informe as datas para extrair só o intervalo desejado. Deixe em branco para extrair tudo.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[9px] font-bold uppercase tracking-wide text-brand-text/50 mb-1">De</label>
              <input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                max={dataFim || undefined}
                className="w-full px-3 py-2 border border-brand-border bg-white text-[11px] font-mono text-brand-text outline-none focus:bg-brand-sidebar/30"
              />
            </div>
            <div>
              <label className="block text-[9px] font-bold uppercase tracking-wide text-brand-text/50 mb-1">Até</label>
              <input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                min={dataInicio || undefined}
                className="w-full px-3 py-2 border border-brand-border bg-white text-[11px] font-mono text-brand-text outline-none focus:bg-brand-sidebar/30"
              />
            </div>
          </div>
        </div>

        {/* Pasta de layouts que o OCR já aprendeu a extrair */}
        <div className="border border-brand-border bg-brand-bg">
          <button
            type="button"
            onClick={() => {
              setShowLearnedFolder((v) => !v);
              loadLearnedLayouts();
            }}
            className="w-full flex items-center gap-2 p-4 hover:bg-brand-sidebar/40 transition-colors"
          >
            <FolderOpen size={14} className="text-brand-text/60" />
            <h3 className="text-[9px] font-bold uppercase tracking-widest text-brand-text/60">
              Layouts Aprendidos
            </h3>
            <span className="text-[9px] font-mono text-brand-text/40">({learnedLayouts.length})</span>
            <span className="ml-auto text-[9px] font-mono text-brand-text/40">
              {showLearnedFolder ? '▲ fechar' : '▼ abrir'}
            </span>
          </button>

          {showLearnedFolder && (
            <div className="p-4 pt-0 space-y-3">
              {learnedLoadError && (
                <p className="text-[10px] text-brand-text/50 font-mono">{learnedLoadError}</p>
              )}

              {!learnedLoadError && learnedLayouts.length === 0 && (
                <p className="text-[10px] text-brand-text/50 font-mono">
                  Nenhum layout aprendido ainda. Ao extrair um extrato aqui pelo OCR, o servidor guarda
                  o layout aqui (logo, nome do banco e colunas — sem dados sensíveis) e reconhece automaticamente
                  da próxima vez.
                </p>
              )}

              {learnedLayouts.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {learnedLayouts.map((layout) => (
                    <div
                      key={layout.fingerprint}
                      className="relative group border border-brand-border bg-brand-sidebar p-2 flex flex-col gap-1.5"
                      title={layout.sample_file_name ?? ''}
                    >
                      <div className="w-full aspect-[5/2] bg-white border border-brand-border overflow-hidden flex items-center justify-center">
                        {layout.thumbnail_url ? (
                          <img
                            src={`${OCR_SERVER_URL}${layout.thumbnail_url}`}
                            alt={layout.banco_nome || 'Layout aprendido'}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <FileText size={20} className="text-brand-text/30" />
                        )}
                      </div>
                      <p className="text-[9px] font-black uppercase truncate">{layout.banco_nome || 'Banco não identificado'}</p>
                      <p className="text-[9px] font-mono text-brand-text/50">usado {layout.times_used}x</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {isProcessing && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] font-bold text-brand-text/70">
              <span>Processando OCR</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 bg-brand-sidebar border border-brand-border overflow-hidden rounded-none">
              <div style={{ width: `${progress}%` }} className="h-full bg-brand-border transition-all" />
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-600/10 border border-red-700 text-red-800 text-[10px]">
            {error}
          </div>
        )}

        {result ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 p-3 bg-brand-sidebar border border-brand-border">
              <p className="text-[10px] font-bold uppercase">OCR concluído</p>
              <div className="flex gap-2">
                <a href={result.pdfUrl ?? undefined} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-[10px] uppercase font-bold border border-brand-border px-3 py-2 hover:bg-brand-border hover:text-brand-bg transition-all">
                  <ExternalLink size={12} /> Abrir PDF
                </a>
                <a 
                  href={result.pdfUrl ?? undefined} 
                  download={file ? file.name.slice(0, file.name.lastIndexOf('.')) + '_pesquisavel.pdf' : 'ocr_pesquisavel.pdf'}
                  className="inline-flex items-center gap-2 text-[10px] uppercase font-bold border border-brand-border px-3 py-2 bg-brand-text text-brand-bg hover:bg-brand-border hover:text-brand-bg transition-all cursor-pointer"
                >
                  <Download size={12} /> Baixar PDF com Texto
                </a>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                const blob = new Blob([result.text], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'ocr_extrato.txt';
                a.click();
              }}
              className="w-full flex items-center justify-center gap-2 border border-brand-border bg-brand-bg text-[10px] font-bold uppercase py-3 hover:bg-brand-border hover:text-brand-bg transition-all"
            >
              <FileText size={14} /> Baixar Texto OCR
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleProcess}
            disabled={!file || isProcessing}
            className={cn(
              'w-full flex items-center justify-center gap-2 px-4 py-3 text-[10px] font-bold uppercase transition-all',
              !file || isProcessing
                ? 'border border-brand-border bg-brand-sidebar text-brand-text/50 cursor-not-allowed'
                : 'border border-brand-border bg-brand-bg hover:bg-brand-border hover:text-brand-bg',
            )}
          >
            <Upload size={14} /> Iniciar OCR
          </button>
        )}

        <div className="flex justify-end gap-2 pt-4 border-t border-brand-border">
          <button type="button" onClick={handleReset} className="technical-button text-[10px] py-2 px-4">
            Limpar
          </button>
          <button type="button" onClick={onClose} className="technical-button-primary text-[10px] py-2 px-4">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
